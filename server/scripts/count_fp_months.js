const sqlite3 = require('sqlite3').verbose();
const dbPath = 'C:/Users/USER/Desktop/Compta 26.sqlite';
const db = new sqlite3.Database(dbPath);

db.all("SELECT substr(date, 1, 7) as mois, count(*) as cnt, round(sum(debit),2) as total FROM journal WHERE compte = '70690000' GROUP BY mois ORDER BY mois", (err, rows) => {
  if (err) console.error(err);
  else {
    console.log('=== Lignes restant dans 70690000 par mois (HORS FACTURE PATIENT) ===');
    console.table(rows);
  }
  db.close();
});
