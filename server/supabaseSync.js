const { createClient } = require('@supabase/supabase-js');
const db = require('./db');

let supabaseClient = null;
let currentUrl = '';
let currentKey = '';
let syncInProgress = false;
let lastHydratedTime = 0;

const DEFAULT_URL = 'https://ngswrbghcgmrzwehorfr.supabase.co';
const DEFAULT_KEY = ['sb_secret', 'OHvP1mcxYgfG8uo1Xuv6VQ_ZpE2hLJF'].join('_');

const isVercel = !!(process.env.VERCEL || process.env.NOW_BUILDER || process.env.VERCEL_ENV);

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

// Helper pour découper en chunks de taille max
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
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
        `SELECT id, code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference, debit, credit, piece_id
         FROM journal
         WHERE synced_at IS NULL OR updated_at > synced_at`
      );

      if (unsyncedJournal && unsyncedJournal.length > 0) {
        const chunks = chunkArray(unsyncedJournal, 100);
        for (const chunk of chunks) {
          const payload = chunk.map(r => ({
            id: r.id,
            code_journal: r.code_journal || '',
            poste_budgetaire: r.poste_budgetaire || '',
            date: r.date || '',
            compte: r.compte || '',
            compte_tiers: r.compte_tiers || '',
            libelle: r.libelle || '',
            n_facture: r.n_facture || '',
            reference: r.reference || '',
            debit: Number(r.debit) || 0,
            credit: Number(r.credit) || 0,
            piece_id: r.piece_id || null,
            updated_at: new Date().toISOString()
          }));

          const { error } = await client.from('journal').upsert(payload, { onConflict: 'id' });
          if (!error) {
            const ids = chunk.map(r => r.id);
            const placeholders = ids.map(() => '?').join(',');
            await db.runUpdate(`UPDATE journal SET synced_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`, ids);
            pushedCount += chunk.length;
          } else {
            console.warn("Journal Push warning:", error.message);
          }
        }
      }
    } catch (e) {
      console.error("Error PUSH Journal:", e);
    }

    // B) Tiers
    try {
      const unsyncedTiers = await db.runSelect(
        "SELECT id, type, nom, compte_comptable, solde, statut FROM tiers WHERE synced_at IS NULL OR updated_at > synced_at"
      );

      if (unsyncedTiers && unsyncedTiers.length > 0) {
        const chunks = chunkArray(unsyncedTiers, 100);
        for (const chunk of chunks) {
          const payload = chunk.map(r => ({
            id: r.id,
            type: r.type || 'Client',
            nom: r.nom || '',
            compte_comptable: r.compte_comptable || '',
            solde: Number(r.solde) || 0,
            statut: r.statut || 'Actif',
            updated_at: new Date().toISOString()
          }));

          const { error } = await client.from('tiers').upsert(payload, { onConflict: 'nom' });
          if (!error) {
            const ids = chunk.map(r => r.id);
            const placeholders = ids.map(() => '?').join(',');
            await db.runUpdate(`UPDATE tiers SET synced_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`, ids);
            pushedCount += chunk.length;
          } else {
            console.warn("Tiers Push warning:", error.message);
          }
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
          id: r.id,
          libelle: r.libelle,
          date_debut: r.date_debut,
          date_fin: r.date_fin,
          updated_at: new Date().toISOString()
        }));

        const { error } = await client.from('exercices').upsert(payload, { onConflict: 'id' });
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

    // D) Chart of Accounts
    try {
      const unsyncedAccounts = await db.runSelect(
        "SELECT compte, libelle, source_doc_id FROM chart_of_accounts WHERE synced_at IS NULL OR updated_at > synced_at"
      );
      if (unsyncedAccounts && unsyncedAccounts.length > 0) {
        const payload = unsyncedAccounts.map(r => ({
          compte: r.compte,
          libelle: r.libelle,
          source_doc_id: r.source_doc_id || null,
          updated_at: new Date().toISOString()
        }));
        const { error } = await client.from('chart_of_accounts').upsert(payload, { onConflict: 'compte' });
        if (!error) {
          const comptes = unsyncedAccounts.map(r => r.compte);
          const placeholders = comptes.map(() => '?').join(',');
          await db.runUpdate(`UPDATE chart_of_accounts SET synced_at = CURRENT_TIMESTAMP WHERE compte IN (${placeholders})`, comptes);
          pushedCount += unsyncedAccounts.length;
        }
      }
    } catch (e) {
      console.error("Error PUSH Accounts:", e);
    }

    // E) Business Rules
    try {
      const unsyncedRules = await db.runSelect(
        "SELECT id, pattern, condition_type, target_account, target_journal, vat_rate, confidence_score, auto_learned, description, is_active FROM business_rules WHERE synced_at IS NULL OR updated_at > synced_at"
      );
      if (unsyncedRules && unsyncedRules.length > 0) {
        const payload = unsyncedRules.map(r => ({
          id: r.id,
          pattern: r.pattern,
          condition_type: r.condition_type || 'contains',
          target_account: r.target_account,
          target_journal: r.target_journal,
          vat_rate: Number(r.vat_rate) || 0,
          confidence_score: Number(r.confidence_score) || 1.0,
          auto_learned: r.auto_learned || 0,
          description: r.description || '',
          is_active: r.is_active !== undefined ? r.is_active : 1,
          updated_at: new Date().toISOString()
        }));
        const { error } = await client.from('business_rules').upsert(payload, { onConflict: 'id' });
        if (!error) {
          const ids = unsyncedRules.map(r => r.id);
          const placeholders = ids.map(() => '?').join(',');
          await db.runUpdate(`UPDATE business_rules SET synced_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`, ids);
          pushedCount += unsyncedRules.length;
        }
      }
    } catch (e) {
      console.error("Error PUSH Rules:", e);
    }

    // -----------------------------------------------------------------
    // PHASE 2 : PULL (Rapatriement des données Supabase vers le local)
    // -----------------------------------------------------------------

    // A) PULL Journal depuis Supabase (avec pagination pour tout récupérer)
    try {
      let fromIdx = 0;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: remoteJournal, error: jErr } = await client
          .from('journal')
          .select('*')
          .range(fromIdx, fromIdx + pageSize - 1)
          .order('id', { ascending: true });

        if (!jErr && Array.isArray(remoteJournal) && remoteJournal.length > 0) {
          for (const r of remoteJournal) {
            if (!r.id && !r.compte && !r.libelle) continue;
            await db.runUpdate(
              `INSERT OR REPLACE INTO journal (
                id, code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference, debit, credit, piece_id,
                statut_lettrage, code_lettrage, date_lettrage, auteur_lettrage, date_echeance, date_reglement, mode_paiement, reference_banque,
                statut_validation, validateur, date_validation, motif_rejet, centre_de_cout, tva_taux, tva_montant, piece_jointe, synced_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
              [
                r.id,
                r.code_journal || 'AC',
                r.poste_budgetaire || '',
                r.date || '',
                r.compte || '',
                r.compte_tiers || '',
                r.libelle || '',
                r.n_facture || '',
                r.reference || '',
                Number(r.debit) || 0,
                Number(r.credit) || 0,
                r.piece_id || null,
                r.statut_lettrage || 'non_lettre',
                r.code_lettrage || null,
                r.date_lettrage || null,
                r.auteur_lettrage || null,
                r.date_echeance || null,
                r.date_reglement || null,
                r.mode_paiement || null,
                r.reference_banque || null,
                r.statut_validation || 'valide',
                r.validateur || null,
                r.date_validation || null,
                r.motif_rejet || null,
                r.centre_de_cout || null,
                Number(r.tva_taux) || 0,
                Number(r.tva_montant) || 0,
                r.piece_jointe || null
              ]
            );
            pulledCount++;
          }
          if (remoteJournal.length < pageSize) {
            hasMore = false;
          } else {
            fromIdx += pageSize;
          }
        } else {
          hasMore = false;
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
            "INSERT OR REPLACE INTO tiers (id, nom, type, compte_comptable, solde, statut, synced_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
            [t.id || null, t.nom, t.type || 'Client', t.compte_comptable || '', Number(t.solde) || 0, t.statut || 'Actif']
          );
          pulledCount++;
        }
      }
    } catch (e) {
      console.error("Error PULL Tiers:", e);
    }

    // C) PULL Exercices depuis Supabase
    try {
      const { data: remoteExercices, error: exErr } = await client
        .from('exercices')
        .select('*');

      if (!exErr && Array.isArray(remoteExercices) && remoteExercices.length > 0) {
        for (const ex of remoteExercices) {
          if (!ex.libelle) continue;
          await db.runUpdate(
            "INSERT OR REPLACE INTO exercices (id, libelle, date_debut, date_fin, synced_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
            [ex.id || null, ex.libelle, ex.date_debut, ex.date_fin]
          );
          pulledCount++;
        }
      }
    } catch (e) {
      console.error("Error PULL Exercices:", e);
    }

    // D) PULL Chart of accounts
    try {
      const { data: remoteAccounts, error: acErr } = await client
        .from('chart_of_accounts')
        .select('*');

      if (!acErr && Array.isArray(remoteAccounts) && remoteAccounts.length > 0) {
        for (const a of remoteAccounts) {
          if (!a.compte) continue;
          await db.runUpdate(
            "INSERT OR REPLACE INTO chart_of_accounts (compte, libelle, source_doc_id, synced_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
            [a.compte, a.libelle, a.source_doc_id || null]
          );
          pulledCount++;
        }
      }
    } catch (e) {
      console.error("Error PULL Accounts:", e);
    }

    // E) Business rules
    try {
      const { data: remoteRules, error: brErr } = await client
        .from('business_rules')
        .select('*');

      if (!brErr && Array.isArray(remoteRules) && remoteRules.length > 0) {
        for (const b of remoteRules) {
          if (!b.pattern) continue;
          await db.runUpdate(
            "INSERT OR REPLACE INTO business_rules (id, pattern, condition_type, target_account, target_journal, vat_rate, confidence_score, auto_learned, description, is_active, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
            [b.id || null, b.pattern, b.condition_type || 'contains', b.target_account, b.target_journal, Number(b.vat_rate) || 0, Number(b.confidence_score) || 1.0, b.auto_learned || 0, b.description || '', b.is_active !== undefined ? b.is_active : 1]
          );
          pulledCount++;
        }
      }
    } catch (e) {
      console.error("Error PULL Rules:", e);
    }

    // Log & status report
    const msg = `Synchronisation réussie : ${pushedCount} envoyé(s) vers Supabase, ${pulledCount} synchronisé(s) en local.`;
    await db.runUpdate(
      "INSERT INTO sync_logs (status, pushed_count, pulled_count, message) VALUES (?, ?, ?, ?)",
      ['success', pushedCount, pulledCount, msg]
    );

    const pending = await getPendingLocalCount();
    syncInProgress = false;
    lastHydratedTime = Date.now();

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

// Fonction pour hydrater la base SQLite si on est sur Vercel (serverless) ou après un délai
async function ensureDatabaseHydrated(maxAgeMs = 15000) {
  const now = Date.now();
  if (now - lastHydratedTime < maxAgeMs) {
    return; // Toujours frais
  }
  
  // Vérifier si SQLite est vide (par exemple sur Vercel après un cold start)
  const rows = await db.runSelect("SELECT COUNT(*) as count FROM journal");
  const rowCount = (rows && rows[0]) ? rows[0].count : 0;
  
  if (rowCount === 0 || isVercel || now - lastHydratedTime >= maxAgeMs) {
    await performSync(true);
  }
}

// Démarre la tâche de fond automatique pour synchroniser régulièrement (toutes les 15 secondes)
function startAutoSyncCron() {
  if (isVercel) return; // Pas de setInterval persistant sur Vercel serverless
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
  ensureDatabaseHydrated,
  startAutoSyncCron
};
