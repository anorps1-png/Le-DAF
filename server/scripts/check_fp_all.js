const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('C:/Users/USER/Desktop/Compta 26.sqlite');

db.all("SELECT id, date, code_journal, compte, libelle, debit, credit FROM journal WHERE libelle LIKE '%615488%' OR n_facture LIKE '%615488%'", (err, rows) => {
  if (err) console.error(err);
  else {
    console.log('Recherche 615488 :');
    console.table(rows);
  }
  db.close();
});
