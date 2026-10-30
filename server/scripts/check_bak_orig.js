const sqlite3 = require('sqlite3').verbose();
const dbBak = new sqlite3.Database('C:/Users/USER/Desktop/Compta 26.sqlite.backup_avant_correctif_hf');

const query = (sql, params = []) => new Promise((resolve, reject) => {
  dbBak.all(sql, params, (err, rows) => {
    if (err) reject(err);
    else resolve(rows);
  });
});

async function main() {
  console.log('=== VERIFICATION DANS LA BASE DE BACKUP D ORIGINE ===');
  const hfOrig = await query(`
    SELECT code_journal, compte, count(*) as cnt, sum(debit) as db, sum(credit) as cr
    FROM journal
    WHERE date LIKE '2026-09%' AND (libelle LIKE '%HORS FACTURE TP%' OR libelle LIKE '%HORS FACTURE PATIENT%')
    GROUP BY code_journal, compte
  `);
  console.table(hfOrig);

  // Regarder une facture TP entière dans le backup d'origine
  const fSample = await query(`
    SELECT code_journal, compte, libelle, debit, credit 
    FROM journal 
    WHERE n_facture = 'FTP00140953'
  `);
  console.log('\nFacture FTP00140953 dans le backup d origine :');
  console.table(fSample);

  dbBak.close();
}

main().catch(console.error);
