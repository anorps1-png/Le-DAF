const { createClient } = require('@supabase/supabase-js');
const db = require('./db');

let supabaseClient = null;
let currentUrl = '';
let currentKey = '';
let syncInProgress = false;

let syncProgress = {
  active: false,
  type: null,
  step: '',
  current: 0,
  total: 0,
  percentage: 0,
  status: 'idle',
  message: '',
  details: {}
};

function getSyncProgress() {
  return syncProgress;
}

function resetProgress(type) {
  syncProgress = {
    active: true,
    type,
    step: 'Initialisation de la synchronisation...',
    current: 0,
    total: 0,
    percentage: 0,
    status: 'running',
    message: '',
    details: {}
  };
}

function updateProgress(step, current, total, details = {}) {
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : (current > 0 ? 100 : 0);
  syncProgress = {
    ...syncProgress,
    active: true,
    step,
    current,
    total,
    percentage: pct,
    details: { ...syncProgress.details, ...details }
  };
}

function finishProgress(status, message, details = {}) {
  syncProgress = {
    ...syncProgress,
    active: false,
    percentage: status === 'success' ? 100 : syncProgress.percentage,
    status,
    message,
    details: { ...syncProgress.details, ...details }
  };
}

const isVercel = !!(process.env.VERCEL || process.env.NOW_BUILDER || process.env.VERCEL_ENV);

// Lit la configuration Supabase depuis la table settings de SQLite ou variables d'environnement.
// Aucune valeur par défaut : chaque déploiement doit configurer son propre projet Supabase
// (clé "anon", jamais une clé "sb_secret_...").
async function getSyncSettings() {
  try {
    const rows = await db.runSelect("SELECT key, value FROM settings WHERE key LIKE 'SUPABASE_%'");
    const settings = {};
    (rows || []).forEach(r => { settings[r.key] = r.value; });

    const url = (settings.SUPABASE_URL || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
    const key = (settings.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
    const autoSync = false; // Mode 100% Manuel : synchronisation en arrière-plan désactivée

    return { url, key, autoSync };
  } catch (err) {
    console.error('Error fetching Supabase settings:', err);
    return {
      url: '',
      key: '',
      autoSync: false
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

// Compte le nombre de modifications locales en attente d'envoi (PUSH)
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

// =========================================================================
// OPERATEUR PUSH : Envoie les modifications locales vers Supabase
// =========================================================================
async function performPush() {
  if (syncInProgress) {
    return { status: 'in_progress', message: 'Une opération de synchronisation est déjà en cours...' };
  }

  const client = await getSupabaseClient();
  if (!client) {
    return { status: 'error', message: 'Impossible d\'initialiser la connexion Supabase.' };
  }

  syncInProgress = true;
  resetProgress('push');
  let pushedCount = 0;
  const details = {};

  try {
    let pendingDeletes = [];
    let unsyncedJournal = [];
    let unsyncedTiers = [];
    let unsyncedExercices = [];
    let unsyncedAccounts = [];
    let unsyncedRules = [];

    try { pendingDeletes = (await db.runSelect("SELECT id, table_name, record_id FROM deleted_records WHERE synced_at IS NULL")) || []; } catch (e) {}
    try { unsyncedJournal = (await db.runSelect("SELECT id, code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference, debit, credit, piece_id, created_at FROM journal WHERE synced_at IS NULL OR updated_at > synced_at")) || []; } catch (e) {}
    try { unsyncedTiers = (await db.runSelect("SELECT id, type, nom, compte_comptable, solde, statut FROM tiers WHERE synced_at IS NULL OR updated_at > synced_at")) || []; } catch (e) {}
    try { unsyncedExercices = (await db.runSelect("SELECT id, libelle, date_debut, date_fin FROM exercices WHERE synced_at IS NULL OR updated_at > synced_at")) || []; } catch (e) {}
    try { unsyncedAccounts = (await db.runSelect("SELECT compte, libelle, source_doc_id FROM chart_of_accounts WHERE synced_at IS NULL OR updated_at > synced_at")) || []; } catch (e) {}
    try { unsyncedRules = (await db.runSelect("SELECT id, pattern, condition_type, target_account, target_journal, vat_rate, confidence_score, auto_learned, description, is_active FROM business_rules WHERE synced_at IS NULL OR updated_at > synced_at")) || []; } catch (e) {}

    const totalToPush = pendingDeletes.length + unsyncedJournal.length + unsyncedTiers.length + unsyncedExercices.length + unsyncedAccounts.length + unsyncedRules.length;

    if (totalToPush === 0) {
      const msg = "PUSH terminé : aucun élément local en attente d'envoi.";
      finishProgress('success', msg, details);
      return { status: 'success', pushedCount: 0, details, pendingCount: 0, timestamp: new Date().toISOString(), message: msg };
    }

    updateProgress(`Analyse des éléments locaux (${totalToPush} en attente)...`, 0, totalToPush);

    // 0) PUSH DELETES
    if (pendingDeletes.length > 0) {
      updateProgress(`Suppression distante de ${pendingDeletes.length} élément(s)...`, pushedCount, totalToPush);
      const tableGroups = {};
      for (const d of pendingDeletes) {
        if (!tableGroups[d.table_name]) tableGroups[d.table_name] = [];
        tableGroups[d.table_name].push(d);
      }

      for (const [tbl, list] of Object.entries(tableGroups)) {
        const idCol = (tbl === 'chart_of_accounts') ? 'compte' : 'id';
        const chunks = chunkArray(list, 500);
        for (const chunk of chunks) {
          // record_id est toujours du texte (UUID pour journal/tiers/exercices/business_rules,
          // code compte pour chart_of_accounts) : plus d'id numérique à convertir depuis la
          // migration UUID.
          const idsToDelete = chunk.map(item => String(item.record_id));
          const { error } = await client.from(tbl).delete().in(idCol, idsToDelete);

          const deletedPayload = chunk.map(item => ({
            table_name: item.table_name,
            record_id: String(item.record_id),
            deleted_at: new Date().toISOString()
          }));
          try {
            await client.from('deleted_records').upsert(deletedPayload);
          } catch (delLogErr) {
            console.warn("Deleted records remote log warning:", delLogErr.message);
          }

          if (!error) {
            const syncIds = chunk.map(c => c.id);
            const placeholders = syncIds.map(() => '?').join(',');
            await db.runUpdate(`UPDATE deleted_records SET synced_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`, syncIds);
            pushedCount += chunk.length;
            updateProgress(`Suppression distante... (${pushedCount}/${totalToPush})`, pushedCount, totalToPush);
          } else {
            console.warn(`Delete sync warning for ${tbl}:`, error.message);
          }
        }
      }
    }

    // A) PUSH Journal
    if (unsyncedJournal.length > 0) {
      let journalPushed = 0;
      const chunks = chunkArray(unsyncedJournal, 500);
      for (const chunk of chunks) {
        updateProgress(`Push Journal (${journalPushed + chunk.length}/${unsyncedJournal.length})...`, pushedCount, totalToPush);
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
          created_at: r.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString()
        }));

        const { error } = await client.from('journal').upsert(payload, { onConflict: 'id' });
        if (!error) {
          const ids = chunk.map(r => r.id);
          const placeholders = ids.map(() => '?').join(',');
          await db.runUpdate(`UPDATE journal SET synced_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`, ids);
          journalPushed += chunk.length;
          pushedCount += chunk.length;
          updateProgress(`Push Journal en cours (${pushedCount}/${totalToPush})...`, pushedCount, totalToPush);
        } else {
          console.warn("Journal Push warning:", error.message);
        }
      }
      details.journal = journalPushed;
    }

    // B) PUSH Tiers
    if (unsyncedTiers.length > 0) {
      let tiersPushed = 0;
      const chunks = chunkArray(unsyncedTiers, 500);
      for (const chunk of chunks) {
        updateProgress(`Push Tiers (${tiersPushed + chunk.length}/${unsyncedTiers.length})...`, pushedCount, totalToPush);
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
          tiersPushed += chunk.length;
          pushedCount += chunk.length;
          updateProgress(`Push Tiers en cours (${pushedCount}/${totalToPush})...`, pushedCount, totalToPush);
        } else {
          console.warn("Tiers Push warning:", error.message);
        }
      }
      details.tiers = tiersPushed;
    }

    // C) PUSH Exercices
    if (unsyncedExercices.length > 0) {
      updateProgress(`Push Exercices (${unsyncedExercices.length})...`, pushedCount, totalToPush);
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
        details.exercices = unsyncedExercices.length;
        pushedCount += unsyncedExercices.length;
        updateProgress(`Push Exercices terminé...`, pushedCount, totalToPush);
      }
    }

    // D) PUSH Chart of Accounts
    if (unsyncedAccounts.length > 0) {
      updateProgress(`Push Plan comptable (${unsyncedAccounts.length})...`, pushedCount, totalToPush);
      const payload = unsyncedAccounts.map(r => ({
        compte: r.compte,
        libelle: r.libelle,
        source_doc_id: r.source_doc_id || null,
        updated_at: new Date().toISOString()
      }));
      const { error } = await client.from('chart_of_accounts').upsert(payload, { onConflict: 'compte' });
      if (!error) {
        const ids = unsyncedAccounts.map(r => r.compte);
        const placeholders = ids.map(() => '?').join(',');
        await db.runUpdate(`UPDATE chart_of_accounts SET synced_at = CURRENT_TIMESTAMP WHERE compte IN (${placeholders})`, ids);
        details.chart_of_accounts = unsyncedAccounts.length;
        pushedCount += unsyncedAccounts.length;
        updateProgress(`Push Plan comptable terminé...`, pushedCount, totalToPush);
      }
    }

    // E) PUSH Business Rules
    if (unsyncedRules.length > 0) {
      updateProgress(`Push Règles métier (${unsyncedRules.length})...`, pushedCount, totalToPush);
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
        details.business_rules = unsyncedRules.length;
        pushedCount += unsyncedRules.length;
        updateProgress(`Push Règles métier terminé...`, pushedCount, totalToPush);
      }
    }

    const msg = `PUSH réussi : ${pushedCount} élément(s) envoyé(s) vers Supabase.`;
    await db.runUpdate(
      "INSERT INTO sync_logs (status, pushed_count, pulled_count, message) VALUES (?, ?, ?, ?)",
      ['success', pushedCount, 0, msg]
    );

    finishProgress('success', msg, details);
    const pending = await getPendingLocalCount();

    return {
      status: 'success',
      pushedCount,
      details,
      pendingCount: pending,
      timestamp: new Date().toISOString(),
      message: msg
    };
  } catch (err) {
    console.error("PUSH Error:", err);
    finishProgress('error', err.message, details);
    return { status: 'error', message: err.message };
  } finally {
    syncInProgress = false;
  }
}

// =========================================================================
// OPERATEUR PULL : Télécharge les données depuis Supabase vers SQLite local
// =========================================================================
async function performPull(force = false) {
  if (syncInProgress) {
    return { status: 'in_progress', message: 'Une opération de synchronisation est déjà en cours...' };
  }

  const client = await getSupabaseClient();
  if (!client) {
    return { status: 'error', message: 'Impossible d\'initialiser la connexion Supabase.' };
  }

  syncInProgress = true;
  resetProgress('pull');
  let pulledCount = 0;
  const details = {};

  try {
    updateProgress('Téléchargement des suppressions distantes...', 5, 100);
    // 0) PULL DELETES depuis Supabase
    try {
      const { data: remoteDeletes, error: delErr } = await client
        .from('deleted_records')
        .select('*');

      if (!delErr && Array.isArray(remoteDeletes) && remoteDeletes.length > 0) {
        const tableGroups = {};
        for (const d of remoteDeletes) {
          if (!d.table_name || !d.record_id) continue;
          if (!tableGroups[d.table_name]) tableGroups[d.table_name] = [];
          tableGroups[d.table_name].push(d.record_id);
        }

        for (const [tbl, ids] of Object.entries(tableGroups)) {
          const idCol = (tbl === 'chart_of_accounts') ? 'compte' : 'id';
          const chunks = chunkArray(ids, 500);
          for (const chunk of chunks) {
            const placeholders = chunk.map(() => '?').join(',');
            await db.runUpdate(`DELETE FROM ${tbl} WHERE ${idCol} IN (${placeholders})`, chunk);
          }
        }
      }
    } catch (e) {
      console.warn("Error PULL Deletes (table missing or query error):", e.message);
    }

    // A) PULL Journal depuis Supabase (avec pagination)
    updateProgress('Téléchargement du Journal comptable...', 15, 100);
    try {
      const lastPullRows = await db.runSelect("SELECT value FROM settings WHERE key = 'LAST_JOURNAL_PULL_AT'");
      const lastPullAt = force ? null : ((lastPullRows && lastPullRows[0]) ? lastPullRows[0].value : null);

      const localCountRows = await db.runSelect("SELECT COUNT(*) as count FROM journal");
      const localCount = (localCountRows && localCountRows[0]) ? localCountRows[0].count : 0;

      let fromIdx = 0;
      const pageSize = 1000;
      let hasMore = true;
      let latestUpdatedTimestamp = null;
      let journalPulled = 0;

      while (hasMore) {
        let query = client.from('journal').select('*');
        if (localCount > 0 && lastPullAt) {
          query = query.gt('updated_at', lastPullAt).order('updated_at', { ascending: true });
        } else {
          query = query.order('id', { ascending: true });
        }

        const { data: remoteJournal, error: jErr } = await query.range(fromIdx, fromIdx + pageSize - 1);

        if (!jErr && Array.isArray(remoteJournal) && remoteJournal.length > 0) {
          await new Promise((resolve, reject) => {
            db.serialize(() => {
              db.run("BEGIN TRANSACTION");
              const stmt = db.prepare(`INSERT OR REPLACE INTO journal (
                id, code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference, debit, credit, piece_id,
                statut_lettrage, code_lettrage, date_lettrage, auteur_lettrage, date_echeance, date_reglement, mode_paiement, reference_banque,
                statut_validation, validateur, date_validation, motif_rejet, centre_de_cout, tva_taux, tva_montant, piece_jointe, created_at, synced_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`);

              for (const r of remoteJournal) {
                if (!r.id && !r.compte && !r.libelle) continue;
                stmt.run([
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
                  r.piece_jointe || null,
                  r.created_at || null
                ]);
                journalPulled++;
                pulledCount++;
                if (r.updated_at && (!latestUpdatedTimestamp || r.updated_at > latestUpdatedTimestamp)) {
                  latestUpdatedTimestamp = r.updated_at;
                }
              }

              stmt.finalize();
              db.run("COMMIT", (err) => {
                if (err) reject(err);
                else resolve();
              });
            });
          });

          updateProgress(`Téléchargement Journal (${journalPulled} écritures)...`, Math.min(65, 15 + Math.round((journalPulled / Math.max(1, journalPulled + 200)) * 50)), 100);

          if (remoteJournal.length < pageSize) {
            hasMore = false;
          } else {
            fromIdx += pageSize;
          }
        } else {
          hasMore = false;
        }
      }

      details.journal = journalPulled;
      if (latestUpdatedTimestamp) {
        await db.runUpdate("INSERT OR REPLACE INTO settings (key, value) VALUES ('LAST_JOURNAL_PULL_AT', ?)", [latestUpdatedTimestamp]);
      }
    } catch (e) {
      console.error("Error PULL Journal:", e);
    }

    // B) PULL Tiers avec pagination
    updateProgress('Téléchargement des Tiers (Clients & Fournisseurs)...', 70, 100);
    try {
      let fromIdx = 0;
      const pageSize = 1000;
      let hasMore = true;
      let tiersPulled = 0;
      while (hasMore) {
        const { data: remoteTiers, error: tErr } = await client
          .from('tiers')
          .select('*')
          .range(fromIdx, fromIdx + pageSize - 1);

        if (!tErr && Array.isArray(remoteTiers) && remoteTiers.length > 0) {
          for (const t of remoteTiers) {
            if (!t.nom) continue;
            await db.runUpdate(
              "INSERT OR REPLACE INTO tiers (id, nom, type, compte_comptable, solde, statut, synced_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
              [t.id || null, t.nom, t.type || 'Client', t.compte_comptable || '', Number(t.solde) || 0, t.statut || 'Actif']
            );
            tiersPulled++;
            pulledCount++;
          }
          if (remoteTiers.length < pageSize) hasMore = false;
          else fromIdx += pageSize;
        } else {
          hasMore = false;
        }
      }
      details.tiers = tiersPulled;
    } catch (e) {
      console.error("Error PULL Tiers:", e);
    }

    // C) PULL Exercices avec pagination
    updateProgress('Téléchargement des Exercices comptables...', 82, 100);
    try {
      let fromIdx = 0;
      const pageSize = 1000;
      let hasMore = true;
      let exPulled = 0;
      while (hasMore) {
        const { data: remoteExercices, error: exErr } = await client
          .from('exercices')
          .select('*')
          .range(fromIdx, fromIdx + pageSize - 1);

        if (!exErr && Array.isArray(remoteExercices) && remoteExercices.length > 0) {
          for (const ex of remoteExercices) {
            if (!ex.libelle) continue;
            await db.runUpdate(
              "INSERT OR REPLACE INTO exercices (id, libelle, date_debut, date_fin, synced_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
              [ex.id || null, ex.libelle, ex.date_debut, ex.date_fin]
            );
            exPulled++;
            pulledCount++;
          }
          if (remoteExercices.length < pageSize) hasMore = false;
          else fromIdx += pageSize;
        } else {
          hasMore = false;
        }
      }
      details.exercices = exPulled;
    } catch (e) {
      console.error("Error PULL Exercices:", e);
    }

    // D) PULL Chart of accounts avec pagination
    updateProgress('Téléchargement du Plan Comptable SYSCOHADA...', 90, 100);
    try {
      let fromIdx = 0;
      const pageSize = 1000;
      let hasMore = true;
      let acPulled = 0;
      while (hasMore) {
        const { data: remoteAccounts, error: acErr } = await client
          .from('chart_of_accounts')
          .select('*')
          .range(fromIdx, fromIdx + pageSize - 1);

        if (!acErr && Array.isArray(remoteAccounts) && remoteAccounts.length > 0) {
          for (const a of remoteAccounts) {
            if (!a.compte) continue;
            await db.runUpdate(
              "INSERT OR REPLACE INTO chart_of_accounts (compte, libelle, source_doc_id, synced_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
              [a.compte, a.libelle, a.source_doc_id || null]
            );
            acPulled++;
            pulledCount++;
          }
          if (remoteAccounts.length < pageSize) hasMore = false;
          else fromIdx += pageSize;
        } else {
          hasMore = false;
        }
      }
      details.chart_of_accounts = acPulled;
    } catch (e) {
      console.error("Error PULL Accounts:", e);
    }

    // E) PULL Business rules avec pagination
    updateProgress('Téléchargement des Règles Métier & IA...', 96, 100);
    try {
      let fromIdx = 0;
      const pageSize = 1000;
      let hasMore = true;
      let brPulled = 0;
      while (hasMore) {
        const { data: remoteRules, error: brErr } = await client
          .from('business_rules')
          .select('*')
          .range(fromIdx, fromIdx + pageSize - 1);

        if (!brErr && Array.isArray(remoteRules) && remoteRules.length > 0) {
          for (const b of remoteRules) {
            if (!b.pattern) continue;
            await db.runUpdate(
              "INSERT OR REPLACE INTO business_rules (id, pattern, condition_type, target_account, target_journal, vat_rate, confidence_score, auto_learned, description, is_active, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
              [b.id || null, b.pattern, b.condition_type || 'contains', b.target_account, b.target_journal, Number(b.vat_rate) || 0, Number(b.confidence_score) || 1.0, b.auto_learned || 0, b.description || '', b.is_active !== undefined ? b.is_active : 1]
            );
            brPulled++;
            pulledCount++;
          }
          if (remoteRules.length < pageSize) hasMore = false;
          else fromIdx += pageSize;
        } else {
          hasMore = false;
        }
      }
      details.business_rules = brPulled;
    } catch (e) {
      console.error("Error PULL Rules:", e);
    }

    const msg = `PULL réussi : ${pulledCount} élément(s) téléchargé(s) depuis Supabase.`;
    await db.runUpdate(
      "INSERT INTO sync_logs (status, pushed_count, pulled_count, message) VALUES (?, ?, ?, ?)",
      ['success', 0, pulledCount, msg]
    );

    finishProgress('success', msg, details);
    const pending = await getPendingLocalCount();

    return {
      status: 'success',
      pulledCount,
      details,
      pendingCount: pending,
      timestamp: new Date().toISOString(),
      message: msg
    };
  } catch (err) {
    console.error("PULL Error:", err);
    finishProgress('error', err.message, details);
    return { status: 'error', message: err.message };
  } finally {
    syncInProgress = false;
  }
}

// Synchronisation complète (PUSH puis PULL)
async function performSync(force = false, isFullSync = false) {
  const pushRes = await performPush();
  const pullRes = await performPull(force || isFullSync);

  return {
    status: (pushRes.status === 'error' || pullRes.status === 'error') ? 'error' : 'success',
    pushedCount: pushRes.pushedCount || 0,
    pulledCount: pullRes.pulledCount || 0,
    pushDetails: pushRes.details || {},
    pullDetails: pullRes.details || {},
    message: `Synchronisation manuelle : ${pushRes.pushedCount || 0} envoyé(s), ${pullRes.pulledCount || 0} téléchargé(s).`
  };
}

// Synchronisation automatique désactivée : Mode 100% Manuel (PUSH & PULL manuels à la demande)
function startAutoSyncCron() {
  console.log("Mode 100% Manuel : synchronisation en arrière-plan désactivée (PUSH et PULL manuels uniquement).");
}

let lastHydratedAt = 0;

async function ensureDatabaseHydrated(maxAgeMs = 60000) {
  if (!isVercel) return;
  const now = Date.now();
  if (now - lastHydratedAt < maxAgeMs) {
    return;
  }
  try {
    const journalCheck = await db.runSelect("SELECT COUNT(*) as count FROM journal");
    const count = (journalCheck && journalCheck[0]) ? journalCheck[0].count : 0;
    if (count === 0 || (now - lastHydratedAt >= maxAgeMs)) {
      console.log("[Vercel] Auto-hydrating SQLite /tmp from Supabase...");
      await performPull(false);
      lastHydratedAt = Date.now();
    }
  } catch (err) {
    console.error("[Vercel] Error during Supabase hydration:", err.message);
  }
}

module.exports = {
  getSyncSettings,
  getSupabaseClient,
  getPendingLocalCount,
  getSyncProgress,
  performPush,
  performPull,
  performSync,
  ensureDatabaseHydrated,
  startAutoSyncCron
};
