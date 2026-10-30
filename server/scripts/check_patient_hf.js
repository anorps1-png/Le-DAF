const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('C:\\Users\\USER\\Desktop\\Compta 26.sqlite');

async function checkPatientLink() {
  const query = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  // Cherchons les factures avec Hors Facture TP et voyons s'il y a des écritures correspondantes dans le journal de caisse ou de banque
  const sample = await query(`
    SELECT n_facture, date, compte_tiers, credit as montant_hf
    FROM journal
    WHERE date >= '2026-09-01' AND date <= '2026-09-30'
      AND code_journal = 'VTE' AND compte = '41112001' AND credit > 0
    LIMIT 5
  `);

  for (const s of sample) {
    console.log(`\nRecherche pour facture ${s.n_facture} (montant HF = ${s.montant_hf}) :`);
    // Chercher dans tout le journal les écritures de même montant ou même date ou même n_facture
    const sameFact = await query("SELECT date, code_journal, compte, libelle, debit, credit FROM journal WHERE n_facture = ?", [s.n_facture]);
    console.table(sameFact);

    // Chercher si le montant_hf apparaît au débit ou crédit de la caisse à la même date
    const inCaisse = await query("SELECT date, code_journal, compte, libelle, debit, credit FROM journal WHERE date = ? AND (debit = ? OR credit = ?)", [s.date, s.montant_hf, s.montant_hf]);
    if (inCaisse.length > 0) {
      console.log(`Trouvé en caisse/autre pour le montant ${s.montant_hf} :`);
      console.table(inCaisse);
    }
  }

  db.close();
}

checkPatientLink().catch(console.error);
