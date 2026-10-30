const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('C:\\Users\\USER\\Desktop\\Compta 26.sqlite');

async function checkPatientHorsFacture() {
  const query = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  const sampleFact = 'FP00615443';
  const lines = await query("SELECT date, code_journal, compte, compte_tiers, libelle, debit, credit FROM journal WHERE n_facture = ?", [sampleFact]);
  console.log(`Lignes pour ${sampleFact} :`);
  console.table(lines);

  const sampleFact2 = 'FP00615568';
  const lines2 = await query("SELECT date, code_journal, compte, compte_tiers, libelle, debit, credit FROM journal WHERE n_facture = ?", [sampleFact2]);
  console.log(`Lignes pour ${sampleFact2} :`);
  console.table(lines2);

  db.close();
}

checkPatientHorsFacture().catch(console.error);
