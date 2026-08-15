const { createClient } = require('@supabase/supabase-js');
const db = require('./db');

let supabaseClient = null;
let currentUrl = '';
let currentKey = '';
let syncInProgress = false;

// Lit la configuration Supabase depuis la table settings de SQLite
async function getSyncSettings() {
  try {
    const rows = await db.runSelect("SELECT key, value FROM settings WHERE key LIKE 'SUPABASE_%'");
    const settings = {};
    (rows || []).forEach(r => { settings[r.key] = r.value; });
    
    const url = (settings.SUPABASE_URL || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
    const key = (settings.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
    const autoSync = (settings.SUPABASE_AUTO_SYNC ?? process.env.SUPABASE_AUTO_SYNC ?? '1').trim() === '1';

    return { url, key, autoSync };
  } catch (err) {
    console.error('Error fetching Supabase settings:', err);
    return {
      url: (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim(),
      key: (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim(),
      autoSync: true
    };
  }
}

// Initialise le client Supabase si l'URL et la clé sont configurées
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

// Compte le nombre de modifications locales en attente de synchronisation
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

// Exécute la synchronisation bidirectionnelle (Push local -> Supabase / Pull Supabase -> local)
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
      message: 'Supabase non configuré (URL ou Clé API manquante)'
    };
  }

  const client = await getSupabaseClient();
  if (!client) {
    return {
      status: 'error',
      autoSyncEnabled: autoSync,
      message: 'Impossible de se connecter au client Supabase'
    };
  }

  syncInProgress = true;
  let pushedCount = 0;
  let pulledCount = 0;

  try {
    // 1. PUSH PHASE : Envoyer les données locales modifiées vers Supabase
    // A) Journal
    const unsyncedJournal = await db.runSelect(
      "SELECT id, code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference, debit, credit, piece_id, updated_at FROM journal WHERE synced_at IS NULL OR updated_at > synced_at LIMIT 200"
    );

    if (unsyncedJournal && unsyncedJournal.length > 0) {
      const payload = unsyncedJournal.map(r => ({
        id: r.id,
        code_journal: r.code_journal,
        poste_budgetaire: r.poste_budgetaire,
        date: r.date,
        compte: r.compte,
        compte_tiers: r.compte_tiers,
        libelle: r.libelle,
        n_facture: r.n_facture,
        reference: r.reference,
        debit: r.debit || 0,
        credit: r.credit || 0,
        piece_id: r.piece_id
      }));

      const { error } = await client.from('journal').upsert(payload, { onConflict: 'id' });
      if (error) throw new Error(`Push Journal Supabase: ${error.message}`);

      const ids = unsyncedJournal.map(r => r.id);
      const placeholders = ids.map(() => '?').join(',');
      await db.runUpdate(`UPDATE journal SET synced_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`, ids);
      pushedCount += unsyncedJournal.length;
    }

    // B) Tiers
    const unsyncedTiers = await db.runSelect(
      "SELECT id, type, nom, compte_comptable, solde, statut, updated_at FROM tiers WHERE synced_at IS NULL OR updated_at > synced_at LIMIT 100"
    );

    if (unsyncedTiers && unsyncedTiers.length > 0) {
      const payload = unsyncedTiers.map(r => ({
        id: r.id,
        type: r.type,
        nom: r.nom,
        compte_comptable: r.compte_comptable,
        solde: r.solde || 0,
        statut: r.statut
      }));

      const { error } = await client.from('tiers').upsert(payload, { onConflict: 'id' });
      if (error) throw new Error(`Push Tiers Supabase: ${error.message}`);

      const ids = unsyncedTiers.map(r => r.id);
      const placeholders = ids.map(() => '?').join(',');
      await db.runUpdate(`UPDATE tiers SET synced_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`, ids);
      pushedCount += unsyncedTiers.length;
    }

    // C) Exercices
    const unsyncedExercices = await db.runSelect(
      "SELECT id, libelle, date_debut, date_fin FROM exercices WHERE synced_at IS NULL OR updated_at > synced_at"
    );

    if (unsyncedExercices && unsyncedExercices.length > 0) {
      const payload = unsyncedExercices.map(r => ({
        id: r.id,
        libelle: r.libelle,
        date_debut: r.date_debut,
        date_fin: r.date_fin
      }));

      const { error } = await client.from('exercices').upsert(payload, { onConflict: 'id' });
      if (error) throw new Error(`Push Exercices Supabase: ${error.message}`);

      const ids = unsyncedExercices.map(r => r.id);
      const placeholders = ids.map(() => '?').join(',');
      await db.runUpdate(`UPDATE exercices SET synced_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`, ids);
      pushedCount += unsyncedExercices.length;
    }

    // D) Chart of Accounts
    const unsyncedAccounts = await db.runSelect(
      "SELECT compte, libelle, source_doc_id FROM chart_of_accounts WHERE synced_at IS NULL OR updated_at > synced_at"
    );

    if (unsyncedAccounts && unsyncedAccounts.length > 0) {
      const payload = unsyncedAccounts.map(r => ({
        compte: r.compte,
        libelle: r.libelle,
        source_doc_id: r.source_doc_id
      }));

      const { error } = await client.from('chart_of_accounts').upsert(payload, { onConflict: 'compte' });
      if (error) throw new Error(`Push Chart of Accounts Supabase: ${error.message}`);

      const comptes = unsyncedAccounts.map(r => r.compte);
      const placeholders = comptes.map(() => '?').join(',');
      await db.runUpdate(`UPDATE chart_of_accounts SET synced_at = CURRENT_TIMESTAMP WHERE compte IN (${placeholders})`, comptes);
      pushedCount += unsyncedAccounts.length;
    }

    // E) Business Rules
    const unsyncedRules = await db.runSelect(
      "SELECT id, doc_id, pattern, condition_type, target_account, target_journal, vat_rate, confidence_score, auto_learned, occurrences, description, is_active FROM business_rules WHERE synced_at IS NULL OR updated_at > synced_at"
    );

    if (unsyncedRules && unsyncedRules.length > 0) {
      const payload = unsyncedRules.map(r => ({
        id: r.id,
        doc_id: r.doc_id,
        pattern: r.pattern,
        condition_type: r.condition_type,
        target_account: r.target_account,
        target_journal: r.target_journal,
        vat_rate: r.vat_rate || 0,
        confidence_score: r.confidence_score || 1.0,
        auto_learned: r.auto_learned || 0,
        occurrences: r.occurrences || 1,
        description: r.description,
        is_active: r.is_active || 1
      }));

      const { error } = await client.from('business_rules').upsert(payload, { onConflict: 'id' });
      if (error) throw new Error(`Push Business Rules Supabase: ${error.message}`);

      const ids = unsyncedRules.map(r => r.id);
      const placeholders = ids.map(() => '?').join(',');
      await db.runUpdate(`UPDATE business_rules SET synced_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`, ids);
      pushedCount += unsyncedRules.length;
    }

    // Log success
    const msg = `Synchronisation réussie : ${pushedCount} élément(s) synchronisé(s) vers Supabase.`;
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
    const errMsg = `Erreur de synchronisation : ${err.message}`;
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

// Démarre la tâche de fond automatique pour synchroniser régulièrement (toutes les 30 secondes)
function startAutoSyncCron() {
  setInterval(async () => {
    const { autoSync, url, key } = await getSyncSettings();
    if (autoSync && url && key && !syncInProgress) {
      await performSync(false);
    }
  }, 30000); // 30s
}

module.exports = {
  getSyncSettings,
  getPendingLocalCount,
  performSync,
  startAutoSyncCron
};
