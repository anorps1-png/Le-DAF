const db = require('./db');

db.serialize(() => {
  db.run("DROP TABLE IF EXISTS journal", (err) => {
    if (err) console.error("Drop error:", err);
  });
  db.run(`CREATE TABLE journal (
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
  )`, (err) => {
    if (err) {
      console.error("Create error:", err);
    } else {
      console.log("Journal table recreated with new columns.");
    }
    process.exit(0);
  });
});
