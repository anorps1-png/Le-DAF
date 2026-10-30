const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('C:/Users/USER/Desktop/Compta 26.sqlite');

db.all("SELECT DISTINCT compte FROM journal WHERE compte LIKE '7069%' OR compte LIKE '709%'", (err, rows) => {
  if (err) console.error(err);
  else console.log('Comptes 7069/709 dans le journal :', rows);
  db.close();
});
