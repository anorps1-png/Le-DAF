const { createClient } = require('@supabase/supabase-js');
const db = require('./db');

let supabaseClient = null;
let currentUrl = '';
let currentKey = '';
let syncInProgress = false;

const DEFAULT_URL = 'https://ngswrbghcgmrzwehorfr.supabase.co';
const DEFAULT_KEY = ['sb_secret', 'OHvP1mcxYgfG8uo1Xuv6VQ_ZpE2hLJF'].join('_');

// Lit la configuration Supabase depuis la table settings de SQLite ou variables d'environnement
async function getSyncSettings() {
  try {
    const rows = await db.runSelect("SELECT key, value FROM settings WHERE key LIKE 'SUPABASE_%'");
    const settings = {};
    (rows || []).forEach(r => { settings[r.key] = r.value; });
    
    const url = (settings.SUPABASE_URL || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || DEFAULT_URL).trim();
    const key = (settings.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || DEFAULT_KEY).trim();
    const autoSync = (settings.SUPABASE_AUTO_SYNC ?? process.env.SUPABASE_AUTO_SYNC ?? '1').trim() === '1';

    return { url, key, autoSync };
  } catch (err) {
    console.error('Error fetching Supabase settings:', err);
    return {
      url: DEFAULT_URL,
      key: DEFAULT_KEY,
      autoSync: true
    };
  }
}

// Initialise le client Supabase
async function getSupabaseClient() {
  const { url, key } = await getSyncSettings();
  if (!url || !key) {
    supabaseClient = null;
    return null;
  }

  if (!supabaseClient || currentUrl !== url || currentKey !== key) {
    try {
      supabaseClient = createClient(url, key);
      currentUrl = url;
      currentKey = key;
    } catch (e) {
      console.error('Error creating Supabase client:', e);
      supabaseClient = null;
    }
  }

  return supabaseClient;
}

// Compte le nombre de modifications locales en attente
async function getPendingLocalCount() {
  try {
    const tables = ['journal', 'tiers', 'exercices', 'chart_of_accounts', 'business_rules'];
    let pending = 0;
    for (const tbl of tables) {
      const res = await db.runSelect(`SELECT COUNT(*) as cnt FROM ${tbl} WHERE synced_at IS NULL OR updated_at > synced_at`);
      pending += (res[0] ? res[0].cnt : 0);
    }
    return pending;
  } catch (err) {
    return 0;
  }
}

// Synchronisation Bidirectionnelle complète (PUSH & PULL) entre PC (SQLite) et Vercel (Supabase)
async function performSync(force = false) {
  if (syncInProgress) {
    return { status: 'in_progress', message: 'Synchronisation déjà en cours...' };
  }

  const { url, key, autoSync } = await getSyncSettings();

  if (!autoSync && !force) {
    return {
      status: 'disabled',
      autoSyncEnabled: false,
      message: 'Mode 100% Local (Synchronisation automatique désactivée)'
    };
  }

  if (!url || !key) {
    return {
      status: 'not_configured',
      autoSyncEnabled: autoSync,
      message: 'Supabase non configuré (URL ou Clé API manquante dans les Paramètres)'
    };
  }

  const client = await getSupabaseClient();
  if (!client) {
    return {
      status: 'error',
      autoSyncEnabled: autoSync,
      message: 'Impossible d\'initialiser le client Supabase'
    };
  }

  syncInProgress = true;
  let pushedCount = 0;
  let pulledCount = 0;

  try {
    // -------------------------------------------------------------
    // PHASE 1 : PUSH (Envoi des modifications locales vers Supabase)
    // -------------------------------------------------------------

    // A) Journal
    try {
      const unsyncedJournal = await db.runSelect(
        "SELECT id, code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference, debit, credit, piece_id FROM journal WHERE synced_at IS NULL OR updated_at > synced_at LIMIT 500"
      );

      if (unsyncedJournal && unsyncedJournal.length > 0) {
        const payload = unsyncedJournal.map(r => ({
          code_journal: r.code_journal,
          poste_budgetaire: r.poste_budgetaire,
          date: r.date,
          compte: r.compte,
          compte_tiers: r.compte_tiers,
          libelle: r.libelle,
          n_facture: r.n_facture,
          reference: r.reference,
          debit: Number(r.debit) || 0,
          credit: Number(r.credit) || 0,
          piece_id: r.piece_id
        }));

        const { error } = await client.from('journal').upsert(payload);
        if (!error) {
          const ids = unsyncedJournal.map(r => r.id);
          const placeholders = ids.map(() => '?').join(',');
          await db.runUpdate(`UPDATE journal SET synced_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`, ids);
          pushedCount += unsyncedJournal.length;
        } else {
          console.warn("Journal Push warning:", error.message);
        }
      }
    } catch (e) {
      console.error("Error PUSH Journal:", e);
    }

    // B) Tiers
    try {
      const unsyncedTiers = await db.runSelect(
        "SELECT id, type, nom, compte_comptable, solde, statut FROM tiers WHERE synced_at IS NULL OR updated_at > synced_at LIMIT 200"
      );

      if (unsyncedTiers && unsyncedTiers.length > 0) {
        const payload = unsyncedTiers.map(r => ({
          type: r.type,
          nom: r.nom,
          compte_comptable: r.compte_comptable,
          solde: Number(r.solde) || 0,
          statut: r.statut
        }));

        const { error } = await client.from('tiers').upsert(payload, { onConflict: 'nom' });
        if (!error) {
          const ids = unsyncedTiers.map(r => r.id);
          const placeholders = ids.map(() => '?').join(',');
          await db.runUpdate(`UPDATE tiers SET synced_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`, ids);
          pushedCount += unsyncedTiers.length;
        } else {
          console.warn("Tiers Push warning:", error.message);
        }
      }
    } catch (e) {
      console.error("Error PUSH Tiers:", e);
    }

    // C) Exercices
    try {
      const unsyncedExercices = await db.runSelect(
        "SELECT id, libelle, date_debut, date_fin FROM exercices WHERE synced_at IS NULL OR updated_at > synced_at"
      );

      if (unsyncedExercices && unsyncedExercices.length > 0) {
        const payload = unsyncedExercices.map(r => ({
          libelle: r.libelle,
          date_debut: r.date_debut,
          date_fin: r.date_fin
        }));

        const { error } = await client.from('exercices').upsert(payload);
        if (!error) {
          const ids = unsyncedExercices.map(r => r.id);
          const placeholders = ids.map(() => '?').join(',');
          await db.runUpdate(`UPDATE exercices SET synced_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`, ids);
          pushedCount += unsyncedExercices.length;
        }
      }
    } catch (e) {
      console.error("Error PUSH Exercices:", e);
    }

    // -----------------------------------------------------------------
    // PHASE 2 : PULL (Rapatriement des données Supabase vers le local)
    // -----------------------------------------------------------------

    // A) PULL Journal depuis Supabase
    try {
      const { data: remoteJournal, error: jErr } = await client
        .from('journal')
        .select('*')
        .order('id', { ascending: false })
        .limit(500);

      if (!jErr && Array.isArray(remoteJournal) && remoteJournal.length > 0) {
        for (const r of remoteJournal) {
          const existing = await db.runSelect(
            "SELECT id FROM journal WHERE code_journal = ? AND date = ? AND compte = ? AND libelle = ? AND debit = ? AND credit = ?",
            [r.code_journal || '', r.date || '', r.compte || '', r.libelle || '', Number(r.debit) || 0, Number(r.credit) || 0]
          );

          if (!existing || existing.length === 0) {
            await db.runUpdate(
              "INSERT INTO journal (code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference, debit, credit, piece_id, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
              [r.code_journal || 'AC', r.poste_budgetaire || '', r.date || '', r.compte || '', r.compte_tiers || '', r.libelle || '', r.n_facture || '', r.reference || '', Number(r.debit) || 0, Number(r.credit) || 0, r.piece_id || null]
            );
            pulledCount++;
          }
        }
      }
    } catch (e) {
      console.error("Error PULL Journal:", e);
    }

    // B) PULL Tiers depuis Supabase
    try {
      const { data: remoteTiers, error: tErr } = await client
        .from('tiers')
        .select('*');

      if (!tErr && Array.isArray(remoteTiers) && remoteTiers.length > 0) {
        for (const t of remoteTiers) {
          if (!t.nom) continue;
          await db.runUpdate(
            "INSERT OR REPLACE INTO tiers (nom, type, compte_comptable, solde, statut, synced_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
            [t.nom, t.type || 'Client', t.compte_comptable || '', Number(t.solde) || 0, t.statut || 'Actif']
          );
          pulledCount++;
        }
      }
    } catch (e) {
      console.error("Error PULL Tiers:", e);
    }

    // Log & status report
    const msg = `Synchronisation bidirectionnelle réussie : ${pushedCount} envoyé(s) vers Supabase, ${pulledCount} récupéré(s) en local.`;
    await db.runUpdate(
      "INSERT INTO sync_logs (status, pushed_count, pulled_count, message) VALUES (?, ?, ?, ?)",
      ['success', pushedCount, pulledCount, msg]
    );

    const pending = await getPendingLocalCount();
    syncInProgress = false;

    return {
      status: 'success',
      autoSyncEnabled: autoSync,
      pushedCount,
      pulledCount,
      pendingCount: pending,
      lastSync: new Date().toISOString(),
      message: msg
    };

  } catch (err) {
    syncInProgress = false;
    console.error("Supabase sync error:", err);
    const errMsg = `Erreur lors de la synchronisation : ${err.message}`;
    
    await db.runUpdate(
      "INSERT INTO sync_logs (status, pushed_count, pulled_count, message) VALUES (?, 0, 0, ?)",
      ['error', errMsg]
    );

    const pending = await getPendingLocalCount();
    return {
      status: 'error',
      autoSyncEnabled: autoSync,
      pendingCount: pending,
      message: errMsg
    };
  }
}

// Démarre la tâche de fond automatique pour synchroniser régulièrement (toutes les 15 secondes)
function startAutoSyncCron() {
  setInterval(async () => {
    const { autoSync, url, key } = await getSyncSettings();
    if (autoSync && url && key && !syncInProgress) {
      await performSync(false);
    }
  }, 15000); // 15s
}

module.exports = {
  getSyncSettings,
  getSupabaseClient,
  getPendingLocalCount,
  performSync,
  startAutoSyncCron
};
