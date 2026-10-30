const sqlite3 = require('sqlite3').verbose();
const dbPath = 'C:/Users/USER/Desktop/Compta 26.sqlite';
const db = new sqlite3.Database(dbPath);

const query = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) reject(err);
    else resolve(rows);
  });
});

async function main() {
  console.log('=== ANALYSE DETAILLEE DES 58 LIGNES HORS FACTURE TP EN SEPTEMBRE 2026 ===');
  const rows = await query(`
    SELECT id, date, code_journal, compte, compte_tiers, libelle, n_facture, debit, credit 
    FROM journal 
    WHERE date >= '2026-09-01' AND date <= '2026-09-30'
      AND code_journal = 'VTE'
      AND (libelle LIKE '%HORS FACTURE TP%' OR libelle LIKE '%HORS FACTURE PATIENT%')
    ORDER BY date
  `);
  console.log(`Nombre total de lignes Hors Facture en Septembre : ${rows.length}`);
  
  // Regroupons par type
  const hfTP = rows.filter(r => r.libelle.includes('HORS FACTURE TP'));
  const hfPatient = rows.filter(r => r.libelle.includes('HORS FACTURE PATIENT'));
  
  console.log(`\n--- HORS FACTURE TP : ${hfTP.length} lignes ---`);
  let totTP_deb = 0, totTP_cred = 0;
  hfTP.forEach(r => { totTP_deb += r.debit; totTP_cred += r.credit; });
  console.log(`Débit total TP : ${totTP_deb}, Crédit total TP : ${totTP_cred}`);

  console.log(`\n--- HORS FACTURE PATIENT : ${hfPatient.length} lignes ---`);
  let totPat_deb = 0, totPat_cred = 0;
  hfPatient.forEach(r => { totPat_deb += r.debit; totPat_cred += r.credit; });
  console.log(`Débit total Patient : ${totPat_deb}, Crédit total Patient : ${totPat_cred}`);

  // Regardons les pièces / n_facture des lignes TP
  const facturesTP = [...new Set(hfTP.map(r => r.n_facture).filter(Boolean))];
  console.log(`Nombre de factures TP distinctes : ${facturesTP.length}`);

  // Pour chaque facture TP, quelle est la ligne de prestation associée ?
  // Prenons les 10 premières factures TP
  for (const f of facturesTP.slice(0, 5)) {
    const fRows = await query(`SELECT id, compte, libelle, debit, credit FROM journal WHERE n_facture = ?`, [f]);
    console.log(`\nFacture ${f} :`);
    console.table(fRows);
  }

  db.close();
}

main().catch(console.error);
