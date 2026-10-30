const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('C:/Users/USER/Desktop/Compta 26.sqlite');

db.all("SELECT libelle, count(*) as cnt, sum(debit) as total FROM journal WHERE compte = '70690000' AND date >= '2026-09-01' AND date <= '2026-09-30' GROUP BY libelle", (err, rows) => {
  if (err) console.error(err);
  else console.table(rows);
  db.close();
});
