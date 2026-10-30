const sqlite3 = require('sqlite3').verbose();
const dbPath = 'C:/Users/USER/Desktop/Compta 26.sqlite';
const db = new sqlite3.Database(dbPath);

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function run() {
  console.log('=== ECRITURES DANS CAISPR EN SEPTEMBRE 2026 ===');
  const caiRows = await query("SELECT date, code_journal, n_facture, reference, compte, libelle, debit, credit FROM journal WHERE code_journal = 'CAISPR' AND date LIKE '2026-09%' LIMIT 20");
  console.table(caiRows);

  console.log('\n=== COMPTES CONTREPARTIE DANS CAISPR EN SEPTEMBRE 2026 ===');
  const contreparties = await query("SELECT compte, round(sum(debit),2) as debit, round(sum(credit),2) as credit, count(*) as cnt FROM journal WHERE code_journal = 'CAISPR' AND date LIKE '2026-09%' GROUP BY compte");
  console.table(contreparties);

  console.log('\n=== RECHERCHE SPECIFIQUE FTP00140953 DANS TOUTE LA BASE ===');
  const ftpRows = await query("SELECT code_journal, date, n_facture, reference, compte, libelle, debit, credit FROM journal WHERE libelle LIKE '%140953%' OR n_facture LIKE '%140953%' OR reference LIKE '%140953%'");
  console.table(ftpRows);

  db.close();
}

run();
