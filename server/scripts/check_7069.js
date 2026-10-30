const sqlite3 = require('sqlite3').verbose();
const dbPath = 'C:/Users/USER/Desktop/Compta 26.sqlite';
const db = new sqlite3.Database(dbPath);

db.all("SELECT compte, libelle FROM chart_of_accounts WHERE libelle LIKE '%REMISE%' OR libelle LIKE '%RABAIS%' OR libelle LIKE '%RISTOURNE%' OR libelle LIKE '%REDUC%' OR compte LIKE '709%' OR compte LIKE '7069%'", (err, rows) => {
  if (err) console.error(err);
  else {
    console.log('=== Comptes RRR dans chart_of_accounts ===');
    console.table(rows);
  }
  db.close();
});
