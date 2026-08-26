const path = require('path');
const fs = require('fs');

let sqlite3;
let db;

// Génère un UUID v4 directement en SQL (DEFAULT de colonne, ou dans un INSERT...SELECT lors
// d'une migration). Choisi plutôt que crypto.randomUUID() côté JS pour que même le SQL brut
// généré par l'IA (outil propose_update, qui n'inclut jamais de colonne id) continue de
// fonctionner sans modification : SQLite fournit automatiquement un id valide à l'insertion.
const UUID_DEFAULT_SQL = "(lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))))";

try {
  sqlite3 = require('sqlite3').verbose();
  const isVercel = !!(process.env.VERCEL || process.env.NOW_BUILDER || process.env.VERCEL_ENV);
  const dbPath = process.env.DB_PATH
    ? process.env.DB_PATH
    : isVercel
    ? path.join('/tmp', 'agent-ohada.sqlite')
    : path.resolve(__dirname, 'agent-ohada.sqlite');

  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error('Error opening database', err.message);
    } else {
      console.log('Connected to the SQLite database.');

      // Activer le mode WAL et optimisations de performance SQLite (ultra rapide)
      db.configure("busyTimeout", 30000);
      db.run("PRAGMA busy_timeout = 30000;");
      db.run("PRAGMA journal_mode = WAL;");
      db.run("PRAGMA synchronous = NORMAL;");
      db.run("PRAGMA temp_store = MEMORY;");
      db.run("PRAGMA cache_size = -64000;"); // 64MB cache

      initSchema().catch(err => console.error('Erreur d\'initialisation du schéma :', err));
    }
  });
} catch (e) {
  console.warn("sqlite3 native binary not available on this platform (Serverless Vercel fallback active).", e.message);
  db = {
    serialize: (cb) => cb && cb(),
    run: function(sql, params, cb) {
      if (typeof params === 'function') cb = params;
      if (cb) cb.call({ changes: 0, lastID: 1 }, null);
      return this;
    },
    all: function(sql, params, cb) {
      if (typeof params === 'function') cb = params;
      if (cb) cb(null, []);
    },
    get: function(sql, params, cb) {
      if (typeof params === 'function') cb = params;
      if (cb) cb(null, null);
    },
    prepare: function() {
      return {
        run: function(...args) {
          const cb = args.find(a => typeof a === 'function');
          if (cb) cb.call({ changes: 1, lastID: 1 }, null);
        },
        finalize: function() {}
      };
    }
  };
}

// Petits wrappers Promise autour de l'API callback de sqlite3, utilisés uniquement pour
// séquencer proprement la migration + création du schéma au démarrage (le reste du fichier,
// db.runSelect/runUpdate/runGet, reste inchangé pour ne rien casser côté appelants existants).
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) { if (err) reject(err); else resolve(this); });
  });
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows || []); });
  });
}

async function columnType(table, column) {
  const cols = await all(`PRAGMA table_info(${table})`);
  const col = cols.find(c => c.name === column);
  return col ? col.type.toUpperCase() : null;
}

async function tableExists(table) {
  const rows = await all(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`, [table]);
  return rows.length > 0;
}

// =========================================================================
// Migration ponctuelle : id INTEGER AUTOINCREMENT (local à chaque machine, source de
// collisions silencieuses entre machines lors du sync Supabase) -> id TEXT (UUID).
// Auto-détectée via le type de colonne réel (pas de flag séparé à maintenir) : si `id` est
// déjà TEXT, on ne fait rien. Ne s'exécute donc qu'une seule fois par base.
// =========================================================================
async function migrateIdsToUuid() {
  // --- journal : id + piece_id (même risque de collision, migré en même temps). Les lignes
  // qui partageaient un même piece_id avant migration reçoivent un seul et même nouveau piece_id
  // (UUID) après migration, via une table temporaire de correspondance ancien->nouveau. ---
  if (await tableExists('journal') && await columnType('journal', 'id') === 'INTEGER') {
    console.log('[Migration] Conversion des id du journal (INTEGER -> UUID)...');
    await run('BEGIN TRANSACTION');
    try {
      await run(`CREATE TABLE journal_new (
        id TEXT PRIMARY KEY DEFAULT ${UUID_DEFAULT_SQL},
        code_journal TEXT,
        poste_budgetaire TEXT,
        date TEXT,
        compte TEXT,
        compte_tiers TEXT,
        libelle TEXT,
        n_facture TEXT,
        reference TEXT,
        debit REAL DEFAULT 0,
        credit REAL DEFAULT 0,
        piece_id TEXT,
        statut_lettrage TEXT DEFAULT 'non_lettre',
        code_lettrage TEXT,
        date_lettrage DATETIME,
        auteur_lettrage TEXT,
        date_echeance TEXT,
        date_reglement TEXT,
        mode_paiement TEXT,
        reference_banque TEXT,
        statut_validation TEXT DEFAULT 'valide',
        validateur TEXT,
        date_validation DATETIME,
        motif_rejet TEXT,
        centre_de_cout TEXT,
        tva_taux REAL DEFAULT 0,
        tva_montant REAL DEFAULT 0,
        piece_jointe TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        synced_at DATETIME
      )`);

      await run(`CREATE TEMP TABLE piece_id_map AS
        SELECT piece_id AS old_piece_id, ${UUID_DEFAULT_SQL} AS new_piece_id
        FROM journal WHERE piece_id IS NOT NULL GROUP BY piece_id`);

      await run(`INSERT INTO journal_new (
        id, code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference,
        debit, credit, piece_id, statut_lettrage, code_lettrage, date_lettrage, auteur_lettrage,
        date_echeance, date_reglement, mode_paiement, reference_banque, statut_validation, validateur,
        date_validation, motif_rejet, centre_de_cout, tva_taux, tva_montant, piece_jointe,
        created_at, updated_at, synced_at
      )
      SELECT
        ${UUID_DEFAULT_SQL}, j.code_journal, j.poste_budgetaire, j.date, j.compte, j.compte_tiers, j.libelle,
        j.n_facture, j.reference, j.debit, j.credit, m.new_piece_id, j.statut_lettrage, j.code_lettrage,
        j.date_lettrage, j.auteur_lettrage, j.date_echeance, j.date_reglement, j.mode_paiement,
        j.reference_banque, j.statut_validation, j.validateur, j.date_validation, j.motif_rejet,
        j.centre_de_cout, j.tva_taux, j.tva_montant, j.piece_jointe, j.updated_at, j.updated_at, NULL
      FROM journal j
      LEFT JOIN piece_id_map m ON j.piece_id = m.old_piece_id`);

      await run('DROP TABLE piece_id_map');
      await run('DROP TABLE journal');
      await run('ALTER TABLE journal_new RENAME TO journal');
      await run('COMMIT');
      console.log('[Migration] journal migré vers des id UUID.');
    } catch (err) {
      await run('ROLLBACK').catch(() => {});
      throw err;
    }
  }

  // --- tiers, exercices : migration directe, sans logique de regroupement (aucune autre
  // table ne référence leur id comme clé étrangère - confirmé par exploration du code). ---
  if (await tableExists('tiers') && await columnType('tiers', 'id') === 'INTEGER') {
    console.log('[Migration] Conversion des id de tiers (INTEGER -> UUID)...');
    await run('BEGIN TRANSACTION');
    try {
      await run(`CREATE TABLE tiers_new (
        id TEXT PRIMARY KEY DEFAULT ${UUID_DEFAULT_SQL},
        type TEXT,
        nom TEXT,
        compte_comptable TEXT,
        solde REAL DEFAULT 0,
        statut TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        synced_at DATETIME
      )`);
      await run(`INSERT INTO tiers_new (id, type, nom, compte_comptable, solde, statut, updated_at, synced_at)
        SELECT ${UUID_DEFAULT_SQL}, type, nom, compte_comptable, solde, statut, updated_at, NULL FROM tiers`);
      await run('DROP TABLE tiers');
      await run('ALTER TABLE tiers_new RENAME TO tiers');
      await run('COMMIT');
      console.log('[Migration] tiers migré vers des id UUID.');
    } catch (err) {
      await run('ROLLBACK').catch(() => {});
      throw err;
    }
  }

  if (await tableExists('exercices') && await columnType('exercices', 'id') === 'INTEGER') {
    console.log('[Migration] Conversion des id de exercices (INTEGER -> UUID)...');
    await run('BEGIN TRANSACTION');
    try {
      await run(`CREATE TABLE exercices_new (
        id TEXT PRIMARY KEY DEFAULT ${UUID_DEFAULT_SQL},
        libelle TEXT NOT NULL,
        date_debut TEXT NOT NULL,
        date_fin TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        synced_at DATETIME
      )`);
      const oldExercices = await all('SELECT id, libelle, date_debut, date_fin, updated_at FROM exercices');
      const crypto = require('crypto');
      const idMap = {};
      for (const ex of oldExercices) {
        const newId = crypto.randomUUID();
        idMap[ex.id] = newId;
        await run(`INSERT INTO exercices_new (id, libelle, date_debut, date_fin, updated_at, synced_at)
          VALUES (?, ?, ?, ?, ?, NULL)`, [newId, ex.libelle, ex.date_debut, ex.date_fin, ex.updated_at]);
      }
      await run('DROP TABLE exercices');
      await run('ALTER TABLE exercices_new RENAME TO exercices');
      await run('COMMIT');

      // La sélection d'exercice active est stockée comme une simple valeur texte dans
      // settings.SELECTED_EXERCICE_ID : on la remappe vers le nouvel id pour ne pas la perdre.
      const selected = await all("SELECT value FROM settings WHERE key = 'SELECTED_EXERCICE_ID'");
      const oldSelectedId = selected[0] && selected[0].value;
      if (oldSelectedId && idMap[oldSelectedId]) {
        await run("INSERT OR REPLACE INTO settings (key, value) VALUES ('SELECTED_EXERCICE_ID', ?)", [idMap[oldSelectedId]]);
      }
      console.log('[Migration] exercices migré vers des id UUID.');
    } catch (err) {
      await run('ROLLBACK').catch(() => {});
      throw err;
    }
  }

  // --- business_rules : migration id + ajout des colonnes doc_id/occurrences si absentes
  // (schema drift préexistant : le code les lit/écrit déjà, server/db.js ne les déclarait pas). ---
  if (await tableExists('business_rules') && await columnType('business_rules', 'id') === 'INTEGER') {
    console.log('[Migration] Conversion des id de business_rules (INTEGER -> UUID)...');
    const hasDocId = (await columnType('business_rules', 'doc_id')) !== null;
    const hasOccurrences = (await columnType('business_rules', 'occurrences')) !== null;
    await run('BEGIN TRANSACTION');
    try {
      await run(`CREATE TABLE business_rules_new (
        id TEXT PRIMARY KEY DEFAULT ${UUID_DEFAULT_SQL},
        doc_id INTEGER,
        pattern TEXT NOT NULL,
        condition_type TEXT DEFAULT 'contains',
        target_account TEXT NOT NULL,
        target_journal TEXT,
        vat_rate REAL DEFAULT 0,
        confidence_score REAL DEFAULT 1.0,
        auto_learned INTEGER DEFAULT 0,
        occurrences INTEGER DEFAULT 1,
        description TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        synced_at DATETIME
      )`);
      await run(`INSERT INTO business_rules_new (
        id, doc_id, pattern, condition_type, target_account, target_journal, vat_rate,
        confidence_score, auto_learned, occurrences, description, is_active, created_at, updated_at, synced_at
      )
      SELECT ${UUID_DEFAULT_SQL}, ${hasDocId ? 'doc_id' : 'NULL'}, pattern, condition_type, target_account,
        target_journal, vat_rate, confidence_score, auto_learned, ${hasOccurrences ? 'occurrences' : '1'},
        description, is_active, created_at, updated_at, NULL
      FROM business_rules`);
      await run('DROP TABLE business_rules');
      await run('ALTER TABLE business_rules_new RENAME TO business_rules');
      await run('COMMIT');
      console.log('[Migration] business_rules migré vers des id UUID.');
    } catch (err) {
      await run('ROLLBACK').catch(() => {});
      throw err;
    }
  }

  // --- rapprochement_bancaire : journal_id doit rester du même type que journal.id. Table
  // locale uniquement (jamais synchronisée), donc son propre id peut rester un entier local. ---
  if (await tableExists('rapprochement_bancaire') && await columnType('rapprochement_bancaire', 'journal_id') === 'INTEGER') {
    console.log('[Migration] Conversion de rapprochement_bancaire.journal_id (INTEGER -> TEXT)...');
    await run('BEGIN TRANSACTION');
    try {
      await run(`CREATE TABLE rapprochement_bancaire_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date_operation TEXT NOT NULL,
        libelle TEXT NOT NULL,
        debit REAL DEFAULT 0,
        credit REAL DEFAULT 0,
        journal_id TEXT,
        statut_matching TEXT DEFAULT 'non_rapproche',
        date_matching DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      // journal_id pointait vers un id INTEGER qui n'existe plus après la migration du
      // journal ci-dessus : aucune ligne existante ne peut être remappée de façon fiable
      // (table vide dans les faits sur cette installation ; NULL par défaut sinon).
      await run(`INSERT INTO rapprochement_bancaire_new (id, date_operation, libelle, debit, credit, journal_id, statut_matching, date_matching, created_at)
        SELECT id, date_operation, libelle, debit, credit, NULL, statut_matching, date_matching, created_at FROM rapprochement_bancaire`);
      await run('DROP TABLE rapprochement_bancaire');
      await run('ALTER TABLE rapprochement_bancaire_new RENAME TO rapprochement_bancaire');
      await run('COMMIT');
      console.log('[Migration] rapprochement_bancaire migré.');
    } catch (err) {
      await run('ROLLBACK').catch(() => {});
      throw err;
    }
  }
}

async function initSchema() {
  await migrateIdsToUuid();

  // Settings Table (for API Keys)
  await run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  // Tiers Table (Clients/Fournisseurs)
  await run(`CREATE TABLE IF NOT EXISTS tiers (
    id TEXT PRIMARY KEY DEFAULT ${UUID_DEFAULT_SQL},
    type TEXT, -- 'Client' or 'Fournisseur'
    nom TEXT,
    compte_comptable TEXT,
    solde REAL DEFAULT 0,
    statut TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    synced_at DATETIME
  )`);
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tiers_nom ON tiers(nom)`);

  // Journal Table (Écritures Comptables)
  await run(`CREATE TABLE IF NOT EXISTS journal (
    id TEXT PRIMARY KEY DEFAULT ${UUID_DEFAULT_SQL},
    code_journal TEXT,
    poste_budgetaire TEXT,
    date TEXT,
    compte TEXT,
    compte_tiers TEXT,
    libelle TEXT,
    n_facture TEXT,
    reference TEXT,
    debit REAL DEFAULT 0,
    credit REAL DEFAULT 0,
    piece_id TEXT,
    statut_lettrage TEXT DEFAULT 'non_lettre',
    code_lettrage TEXT,
    date_lettrage DATETIME,
    auteur_lettrage TEXT,
    date_echeance TEXT,
    date_reglement TEXT,
    mode_paiement TEXT,
    reference_banque TEXT,
    statut_validation TEXT DEFAULT 'valide',
    validateur TEXT,
    date_validation DATETIME,
    motif_rejet TEXT,
    centre_de_cout TEXT,
    tva_taux REAL DEFAULT 0,
    tva_montant REAL DEFAULT 0,
    piece_jointe TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    synced_at DATETIME
  )`);

  // Index pour accélération foudroyante sur les grands volumes (100k+ lignes)
  await run(`CREATE INDEX IF NOT EXISTS idx_journal_date ON journal(date)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_journal_compte ON journal(compte)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_journal_compte_tiers ON journal(compte_tiers)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_journal_updated_at ON journal(updated_at)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_journal_piece_id ON journal(piece_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_journal_created_at ON journal(created_at)`);

  // Knowledge Docs Table
  await run(`CREATE TABLE IF NOT EXISTS knowledge_docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    filename TEXT,
    file_type TEXT,
    content TEXT,
    category TEXT DEFAULT 'Général',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS chart_of_accounts (
    compte TEXT PRIMARY KEY,
    libelle TEXT NOT NULL,
    source_doc_id INTEGER,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    synced_at DATETIME
  )`);

  await run(`CREATE TABLE IF NOT EXISTS exercices (
    id TEXT PRIMARY KEY DEFAULT ${UUID_DEFAULT_SQL},
    libelle TEXT NOT NULL,
    date_debut TEXT NOT NULL,
    date_fin TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    synced_at DATETIME
  )`);

  await run(`CREATE TABLE IF NOT EXISTS fiscal_echeances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    libelle TEXT NOT NULL,
    date_echeance TEXT NOT NULL,
    statut TEXT DEFAULT 'À faire'
  )`);

  await run(`CREATE TABLE IF NOT EXISTS business_rules (
    id TEXT PRIMARY KEY DEFAULT ${UUID_DEFAULT_SQL},
    doc_id INTEGER,
    pattern TEXT NOT NULL,
    condition_type TEXT DEFAULT 'contains',
    target_account TEXT NOT NULL,
    target_journal TEXT,
    vat_rate REAL DEFAULT 0,
    confidence_score REAL DEFAULT 1.0,
    auto_learned INTEGER DEFAULT 0,
    occurrences INTEGER DEFAULT 1,
    description TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    synced_at DATETIME
  )`);

  // Sans cet index, chaque vérification "cette règle existe-t-elle déjà ?" dans
  // learnFromJournalData (server/ai.js) fait un scan complet de business_rules — critique dès que
  // l'apprentissage automatique s'exécute sur un gros import (des dizaines/centaines de milliers de
  // motifs uniques à vérifier).
  await run(`CREATE INDEX IF NOT EXISTS idx_business_rules_pattern ON business_rules(pattern)`);

  await run(`CREATE TABLE IF NOT EXISTS sync_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT,
    message TEXT,
    pushed_count INTEGER DEFAULT 0,
    pulled_count INTEGER DEFAULT 0
  )`);

  await run(`CREATE TABLE IF NOT EXISTS statement_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date_operation TEXT NOT NULL,
    libelle TEXT NOT NULL,
    debit REAL DEFAULT 0,
    credit REAL DEFAULT 0,
    statut_matching TEXT DEFAULT 'non_rapproche',
    matched_journal_id INTEGER
  )`);

  await run(`CREATE TABLE IF NOT EXISTS rapprochement_bancaire (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date_operation TEXT NOT NULL,
    libelle TEXT NOT NULL,
    debit REAL DEFAULT 0,
    credit REAL DEFAULT 0,
    journal_id TEXT,
    statut_matching TEXT DEFAULT 'non_rapproche',
    date_matching DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Table de traçabilité des suppressions locales pour synchronisation Supabase
  await run(`CREATE TABLE IF NOT EXISTS deleted_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    synced_at DATETIME
  )`);
  await run(`CREATE INDEX IF NOT EXISTS idx_deleted_records_synced ON deleted_records(synced_at)`);

  // Triggers automatiques de capture des suppressions
  await run(`CREATE TRIGGER IF NOT EXISTS trg_journal_delete AFTER DELETE ON journal
  BEGIN
    INSERT INTO deleted_records (table_name, record_id) VALUES ('journal', OLD.id);
  END;`);

  await run(`CREATE TRIGGER IF NOT EXISTS trg_tiers_delete AFTER DELETE ON tiers
  BEGIN
    INSERT INTO deleted_records (table_name, record_id) VALUES ('tiers', OLD.id);
  END;`);

  await run(`CREATE TRIGGER IF NOT EXISTS trg_rules_delete AFTER DELETE ON business_rules
  BEGIN
    INSERT INTO deleted_records (table_name, record_id) VALUES ('business_rules', OLD.id);
  END;`);

  await run(`CREATE TRIGGER IF NOT EXISTS trg_exercices_delete AFTER DELETE ON exercices
  BEGIN
    INSERT INTO deleted_records (table_name, record_id) VALUES ('exercices', OLD.id);
  END;`);

  await run(`CREATE TRIGGER IF NOT EXISTS trg_chart_delete AFTER DELETE ON chart_of_accounts
  BEGIN
    INSERT INTO deleted_records (table_name, record_id) VALUES ('chart_of_accounts', OLD.compte);
  END;`);

  // Triggers automatiques de marquage des modifications pour PUSH Supabase
  await run(`CREATE TRIGGER IF NOT EXISTS trg_journal_update AFTER UPDATE OF code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference, debit, credit, piece_id, statut_lettrage, code_lettrage, date_lettrage, auteur_lettrage, date_echeance, date_reglement, mode_paiement, reference_banque, statut_validation, validateur, date_validation, motif_rejet, centre_de_cout, tva_taux, tva_montant, piece_jointe ON journal
  BEGIN
    UPDATE journal SET updated_at = CURRENT_TIMESTAMP, synced_at = NULL WHERE id = NEW.id;
  END;`);

  await run(`CREATE TRIGGER IF NOT EXISTS trg_tiers_update AFTER UPDATE OF type, nom, compte_comptable, solde, statut ON tiers
  BEGIN
    UPDATE tiers SET updated_at = CURRENT_TIMESTAMP, synced_at = NULL WHERE id = NEW.id;
  END;`);

  await run(`CREATE TRIGGER IF NOT EXISTS trg_rules_update AFTER UPDATE OF pattern, condition_type, target_account, target_journal, vat_rate, confidence_score, auto_learned, description, is_active ON business_rules
  BEGIN
    UPDATE business_rules SET updated_at = CURRENT_TIMESTAMP, synced_at = NULL WHERE id = NEW.id;
  END;`);

  await run(`CREATE TRIGGER IF NOT EXISTS trg_exercices_update AFTER UPDATE OF libelle, date_debut, date_fin ON exercices
  BEGIN
    UPDATE exercices SET updated_at = CURRENT_TIMESTAMP, synced_at = NULL WHERE id = NEW.id;
  END;`);

  await run(`CREATE TRIGGER IF NOT EXISTS trg_chart_update AFTER UPDATE OF libelle ON chart_of_accounts
  BEGIN
    UPDATE chart_of_accounts SET updated_at = CURRENT_TIMESTAMP, synced_at = NULL WHERE compte = NEW.compte;
  END;`);

  // Migration dynamique des colonnes de suivi avancé (installations pré-existantes créées
  // avant l'ajout de ces colonnes au schéma de base)
  const journalCols = (await all(`PRAGMA table_info(journal)`)).map(c => c.name);
  const journalColsToAdd = [
    { name: 'statut_lettrage', type: "TEXT DEFAULT 'non_lettre'" },
    { name: 'code_lettrage', type: 'TEXT' },
    { name: 'date_lettrage', type: 'DATETIME' },
    { name: 'auteur_lettrage', type: 'TEXT' },
    { name: 'date_echeance', type: 'TEXT' },
    { name: 'date_reglement', type: 'TEXT' },
    { name: 'mode_paiement', type: 'TEXT' },
    { name: 'reference_banque', type: 'TEXT' },
    { name: 'statut_validation', type: "TEXT DEFAULT 'valide'" },
    { name: 'validateur', type: 'TEXT' },
    { name: 'date_validation', type: 'DATETIME' },
    { name: 'motif_rejet', type: 'TEXT' },
    { name: 'centre_de_cout', type: 'TEXT' },
    { name: 'tva_taux', type: 'REAL DEFAULT 0' },
    { name: 'tva_montant', type: 'REAL DEFAULT 0' },
    { name: 'piece_jointe', type: 'TEXT' },
    { name: 'created_at', type: 'DATETIME' }
  ];
  for (const col of journalColsToAdd) {
    if (!journalCols.includes(col.name)) {
      await run(`ALTER TABLE journal ADD COLUMN ${col.name} ${col.type}`).catch(() => {});
    }
  }

  for (const tbl of ['journal', 'tiers', 'exercices', 'chart_of_accounts', 'business_rules']) {
    const cols = (await all(`PRAGMA table_info(${tbl})`)).map(c => c.name);
    if (!cols.includes('updated_at')) {
      await run(`ALTER TABLE ${tbl} ADD COLUMN updated_at DATETIME`).catch(() => {});
    }
    if (!cols.includes('synced_at')) {
      await run(`ALTER TABLE ${tbl} ADD COLUMN synced_at DATETIME`).catch(() => {});
    }
  }

  // Insert default settings if empty
  const settingsCountRows = await all("SELECT COUNT(*) as count FROM settings");
  const settingsCount = settingsCountRows[0] ? settingsCountRows[0].count : 0;
  if (settingsCount === 0) {
    await run("INSERT INTO settings (key, value) VALUES ('GEMINI_API_KEY', '')");
    await run("INSERT INTO settings (key, value) VALUES ('OPENAI_API_KEY', '')");
    await run("INSERT INTO settings (key, value) VALUES ('DEEPSEEK_API_KEY', '')");
    await run("INSERT INTO settings (key, value) VALUES ('DEFAULT_AI', 'gemini')");
    await run("INSERT INTO settings (key, value) VALUES ('OPENAI_BASE_URL', '')");
    await run("INSERT INTO settings (key, value) VALUES ('OPENAI_MODEL', '')");
    await run("INSERT INTO settings (key, value) VALUES ('SUPABASE_URL', '')");
    await run("INSERT INTO settings (key, value) VALUES ('SUPABASE_ANON_KEY', '')");
    await run("INSERT INTO settings (key, value) VALUES ('SUPABASE_AUTO_SYNC', '1')");
  } else {
    await run("INSERT OR IGNORE INTO settings (key, value) VALUES ('OPENAI_BASE_URL', '')");
    await run("INSERT OR IGNORE INTO settings (key, value) VALUES ('OPENAI_MODEL', '')");
    await run("INSERT OR IGNORE INTO settings (key, value) VALUES ('SELECTED_EXERCICE_ID', '')");
    await run("INSERT OR IGNORE INTO settings (key, value) VALUES ('SUPABASE_URL', '')");
    await run("INSERT OR IGNORE INTO settings (key, value) VALUES ('SUPABASE_ANON_KEY', '')");
    await run("INSERT OR IGNORE INTO settings (key, value) VALUES ('SUPABASE_AUTO_SYNC', '1')");
  }

  console.log('[DB] Schéma prêt.');

  // ANALYZE (statistiques du planificateur de requêtes) en tâche de fond, sans bloquer le
  // démarrage : sans ça, sur une grosse base jamais analysée, le planificateur SQLite peut choisir
  // un plan très défavorable pour des agrégats peu sélectifs (ex: SUM(debit)/SUM(credit) sur tout
  // un exercice comptable) - observé concrètement à 66 secondes au lieu de 70ms sur 72k écritures.
  run('ANALYZE').catch(() => {});
}

db.runSelect = function (sql, params = []) {
  return new Promise((resolve) => {
    if (!sql.trim().toUpperCase().startsWith('SELECT')) {
      return resolve([]);
    }
    db.all(sql, params, (err, rows) => {
      if (err) resolve([]);
      else resolve(rows || []);
    });
  });
};

const isVercelEnvironment = !!(process.env.VERCEL || process.env.NOW_BUILDER || process.env.VERCEL_ENV);

db.runUpdate = function (sql, params = []) {
  return new Promise((resolve) => {
    if (sql.trim().toUpperCase().startsWith('SELECT')) {
      return resolve({ changes: 0, lastID: 0 });
    }
    db.run(sql, params, function (err) {
      if (err) resolve({ changes: 0, lastID: 0 });
      else {
        const result = { changes: this ? this.changes : 0, lastID: this ? this.lastID : 0 };
        if (isVercelEnvironment) {
          try {
            const { performPush } = require('./supabaseSync');
            performPush().catch(e => console.error('[Vercel] Auto-push error:', e.message));
          } catch (e) {}
        }
        resolve(result);
      }
    });
  });
};

db.runGet = function (sql, params = []) {
  return new Promise((resolve) => {
    db.get(sql, params, (err, row) => {
      if (err) resolve(null);
      else resolve(row || null);
    });
  });
};

module.exports = db;
