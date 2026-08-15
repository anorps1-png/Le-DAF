const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const fs = require('fs');

const isVercel = !!(process.env.VERCEL || process.env.NOW_BUILDER || process.env.VERCEL_ENV);
const dbPath = isVercel
  ? path.join('/tmp', 'agent-ohada.sqlite')
  : path.resolve(__dirname, 'agent-ohada.sqlite');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database', err.message);
  } else {
    console.log('Connected to the SQLite database.');
    
    // Initialize Tables
    db.serialize(() => {
      // Settings Table (for API Keys)
      db.run(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )`);

      // Tiers Table (Clients/Fournisseurs)
      db.run(`CREATE TABLE IF NOT EXISTS tiers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT, -- 'Client' or 'Fournisseur'
        nom TEXT,
        compte_comptable TEXT,
        solde REAL DEFAULT 0,
        statut TEXT
      )`);

      // nom is the join key with journal.compte_tiers (GET /api/tiers unifies both sources on it),
      // so it must stay unique; this also lets the tiers import upsert instead of duplicating rows.
      db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tiers_nom ON tiers(nom)`);

      // Journal Table (Écritures Comptables)
      db.run(`CREATE TABLE IF NOT EXISTS journal (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code_journal TEXT,
        poste_budgetaire TEXT,
        date TEXT,
        compte TEXT,
        compte_tiers TEXT,
        libelle TEXT,
        n_facture TEXT,
        reference TEXT,
        debit REAL,
        credit REAL,
        piece_id INTEGER
      )`);

      // piece_id groups the debit/credit lines belonging to the same écriture so balance can be checked.
      // ADD COLUMN fails harmlessly (duplicate column) on databases created before this field existed.
      db.run(`ALTER TABLE journal ADD COLUMN piece_id INTEGER`, () => {});

      // Knowledge Docs Table (Documents de référence comptables)
      db.run(`CREATE TABLE IF NOT EXISTS knowledge_docs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        filename TEXT,
        file_type TEXT,
        content TEXT,
        category TEXT DEFAULT 'Général',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Intitulés de comptes personnalisés (plan comptable de l'entreprise), extraits des
      // documents de la Mémoire Métier. Complète/surcharge le plan OHADA par défaut codé en dur
      // dans ComptabiliteModule.jsx pour l'affichage de la Balance. Reconstruite entièrement à
      // chaque clic sur "Recalculer le plan comptable" (voir /api/chart-of-accounts/refresh).
      db.run(`CREATE TABLE IF NOT EXISTS chart_of_accounts (
        compte TEXT PRIMARY KEY,
        libelle TEXT NOT NULL,
        source_doc_id INTEGER
      )`);

      // Exercices comptables : journal.date reste une simple chaîne ISO (YYYY-MM-DD), donc le
      // filtrage par exercice se fait par comparaison lexicographique sur date_debut/date_fin
      // plutôt que par une colonne exercice_id sur journal (évite une migration/backfill).
      db.run(`CREATE TABLE IF NOT EXISTS exercices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        libelle TEXT NOT NULL,
        date_debut TEXT NOT NULL,
        date_fin TEXT NOT NULL
      )`);

      // Échéances fiscales : suivi manuel (statut coché à la main), pas de calcul automatique.
      db.run(`CREATE TABLE IF NOT EXISTS fiscal_echeances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        libelle TEXT NOT NULL,
        date_echeance TEXT NOT NULL,
        statut TEXT DEFAULT 'À faire'
      )`);

      // Business Rules & ML Memory Table (Règles métier & Apprentissages)
      db.run(`CREATE TABLE IF NOT EXISTS business_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id INTEGER,
        pattern TEXT NOT NULL,
        condition_type TEXT DEFAULT 'contains',
        target_account TEXT,
        target_journal TEXT,
        vat_rate REAL DEFAULT 0,
        confidence_score REAL DEFAULT 1.0,
        auto_learned INTEGER DEFAULT 0,
        occurrences INTEGER DEFAULT 1,
        description TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Table des informations d'en-tête d'entreprise (Page de garde DSF)
      db.run(`CREATE TABLE IF NOT EXISTS company_info (
        key TEXT PRIMARY KEY,
        value TEXT
      )`);

      // Table des logs de synchronisation Supabase
      db.run(`CREATE TABLE IF NOT EXISTS sync_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT,
        pushed_count INTEGER DEFAULT 0,
        pulled_count INTEGER DEFAULT 0,
        message TEXT
      )`);

      // Table du rapprochement bancaire
      db.run(`CREATE TABLE IF NOT EXISTS rapprochement_bancaire (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date_operation TEXT NOT NULL,
        libelle TEXT NOT NULL,
        debit REAL DEFAULT 0,
        credit REAL DEFAULT 0,
        journal_id INTEGER,
        statut_matching TEXT DEFAULT 'non_rapproche',
        date_matching DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Table du suivi des relances clients / fournisseurs
      db.run(`CREATE TABLE IF NOT EXISTS relances_tiers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tiers_id INTEGER,
        n_facture TEXT,
        niveau_relance INTEGER DEFAULT 1,
        date_relance TEXT,
        methode TEXT DEFAULT 'email',
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Migration dynamique des colonnes de suivi avancé sur la table journal (Lettrage, Échéance, Paiement, Validations, TVA, Analytique, Pièce jointe)
      db.all(`PRAGMA table_info(journal)`, (err, columns) => {
        if (!err && Array.isArray(columns)) {
          const colNames = columns.map(c => c.name);
          const journalCols = [
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
            { name: 'piece_jointe', type: 'TEXT' }
          ];

          journalCols.forEach(col => {
            if (!colNames.includes(col.name)) {
              db.run(`ALTER TABLE journal ADD COLUMN ${col.name} ${col.type}`, () => {});
            }
          });
        }
      });

      // Alter tables to add updated_at and synced_at tracking columns for Supabase sync
      ['journal', 'tiers', 'exercices', 'chart_of_accounts', 'business_rules'].forEach(tbl => {
        db.all(`PRAGMA table_info(${tbl})`, (err, columns) => {
          if (!err && Array.isArray(columns)) {
            const colNames = columns.map(c => c.name);
            if (!colNames.includes('updated_at')) {
              db.run(`ALTER TABLE ${tbl} ADD COLUMN updated_at DATETIME`, () => {});
            }
            if (!colNames.includes('synced_at')) {
              db.run(`ALTER TABLE ${tbl} ADD COLUMN synced_at DATETIME`, () => {});
            }
          }
        });
      });

      // Insert default settings if empty
      db.get("SELECT COUNT(*) as count FROM settings", (err, row) => {
        if (!err && row.count === 0) {
          db.run("INSERT INTO settings (key, value) VALUES ('GEMINI_API_KEY', '')");
          db.run("INSERT INTO settings (key, value) VALUES ('OPENAI_API_KEY', '')");
          db.run("INSERT INTO settings (key, value) VALUES ('DEEPSEEK_API_KEY', '')");
          db.run("INSERT INTO settings (key, value) VALUES ('DEFAULT_AI', 'gemini')");
          db.run("INSERT INTO settings (key, value) VALUES ('OPENAI_BASE_URL', '')");
          db.run("INSERT INTO settings (key, value) VALUES ('OPENAI_MODEL', '')");
          db.run("INSERT INTO settings (key, value) VALUES ('SUPABASE_URL', '')");
          db.run("INSERT INTO settings (key, value) VALUES ('SUPABASE_ANON_KEY', '')");
          db.run("INSERT INTO settings (key, value) VALUES ('SUPABASE_AUTO_SYNC', '1')");
        } else if (!err) {
          // Ensure new settings keys exist for backward compatibility
          db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('OPENAI_BASE_URL', '')");
          db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('OPENAI_MODEL', '')");
          db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('SELECTED_EXERCICE_ID', '')");
          db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('SUPABASE_URL', '')");
          db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('SUPABASE_ANON_KEY', '')");
          db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('SUPABASE_AUTO_SYNC', '1')");
        }
      });
    });
  }
});

db.runSelect = function (sql, params = []) {
  return new Promise((resolve, reject) => {
    if (!sql.trim().toUpperCase().startsWith('SELECT')) {
      return reject(new Error('Only SELECT queries are allowed via runSelect.'));
    }
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

db.runUpdate = function (sql, params = []) {
  return new Promise((resolve, reject) => {
    if (sql.trim().toUpperCase().startsWith('SELECT')) {
      return reject(new Error('SELECT queries should use runSelect.'));
    }
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
};

db.runGet = function (sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

module.exports = db;
