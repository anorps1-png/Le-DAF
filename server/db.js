const path = require('path');
const fs = require('fs');

let sqlite3;
let db;

try {
  sqlite3 = require('sqlite3').verbose();
  const isVercel = !!(process.env.VERCEL || process.env.NOW_BUILDER || process.env.VERCEL_ENV);
  const dbPath = isVercel
    ? path.join('/tmp', 'agent-ohada.sqlite')
    : path.resolve(__dirname, 'agent-ohada.sqlite');

  db = new sqlite3.Database(dbPath, (err) => {
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

        db.run(`ALTER TABLE journal ADD COLUMN piece_id INTEGER`, () => {});

        // Knowledge Docs Table
        db.run(`CREATE TABLE IF NOT EXISTS knowledge_docs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT,
          filename TEXT,
          file_type TEXT,
          content TEXT,
          category TEXT DEFAULT 'Général',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS chart_of_accounts (
          compte TEXT PRIMARY KEY,
          libelle TEXT NOT NULL,
          source_doc_id INTEGER
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS exercices (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          libelle TEXT NOT NULL,
          date_debut TEXT NOT NULL,
          date_fin TEXT NOT NULL
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS fiscal_echeances (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          libelle TEXT NOT NULL,
          date_echeance TEXT NOT NULL,
          statut TEXT DEFAULT 'À faire'
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS business_rules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          pattern TEXT NOT NULL,
          condition_type TEXT DEFAULT 'contains',
          target_account TEXT NOT NULL,
          target_journal TEXT,
          vat_rate REAL DEFAULT 0,
          confidence_score REAL DEFAULT 1.0,
          auto_learned INTEGER DEFAULT 0,
          description TEXT,
          is_active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS sync_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          status TEXT,
          message TEXT,
          pushed_count INTEGER DEFAULT 0,
          pulled_count INTEGER DEFAULT 0
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS statement_lines (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date_operation TEXT NOT NULL,
          libelle TEXT NOT NULL,
          debit REAL DEFAULT 0,
          credit REAL DEFAULT 0,
          statut_matching TEXT DEFAULT 'non_rapproche',
          matched_journal_id INTEGER
        )`);

        // Migration dynamique des colonnes de suivi avancé
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
          if (!err && row && row.count === 0) {
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

db.runUpdate = function (sql, params = []) {
  return new Promise((resolve) => {
    if (sql.trim().toUpperCase().startsWith('SELECT')) {
      return resolve({ changes: 0, lastID: 0 });
    }
    db.run(sql, params, function (err) {
      if (err) resolve({ changes: 0, lastID: 0 });
      else resolve({ changes: this ? this.changes : 0, lastID: this ? this.lastID : 0 });
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
