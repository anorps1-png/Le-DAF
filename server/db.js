const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'agent-ohada.sqlite');

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
        credit REAL
      )`);

      // Insert default settings if empty
      db.get("SELECT COUNT(*) as count FROM settings", (err, row) => {
        if (!err && row.count === 0) {
          db.run("INSERT INTO settings (key, value) VALUES ('GEMINI_API_KEY', '')");
          db.run("INSERT INTO settings (key, value) VALUES ('OPENAI_API_KEY', '')");
          db.run("INSERT INTO settings (key, value) VALUES ('DEEPSEEK_API_KEY', '')");
          db.run("INSERT INTO settings (key, value) VALUES ('DEFAULT_AI', 'gemini')");
        }
      });
    });
  }
});

module.exports = db;
