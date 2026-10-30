const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('C:\\Users\\USER\\Desktop\\Compta 26.sqlite');

async function find105k() {
  const query = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  console.log('=== RECHERCHE DU MONTANT 105 695 FCFA ===');

  // Lignes exactes de 105 695
  const exact = await query("SELECT * FROM journal WHERE debit = 105695 OR credit = 105695");
  console.log('Lignes exactes 105 695 :', exact);

  // Somme par facture dans VTE égale à 105 695
  const parFacture = await query(`
    SELECT n_facture, date, libelle, SUM(debit) as db, SUM(credit) as cr
    FROM journal
    WHERE date >= '2026-09-01' AND date <= '2026-09-30' AND code_journal = 'VTE'
    GROUP BY n_facture
    HAVING cr = 105695 OR db = 105695
  `);
  console.log('Factures de montant 105 695 :', parFacture);

  // Regarder les factures dont le montant est proche de 105 695
  const proches = await query(`
    SELECT n_facture, date, libelle, SUM(credit) as cr
    FROM journal
    WHERE date >= '2026-09-01' AND date <= '2026-09-30' AND code_journal = 'VTE'
    GROUP BY n_facture
    HAVING cr BETWEEN 105000 AND 106000
  `);
  console.log('Factures proches :', proches);

  // Regarder dans VTE les lignes avec 41112001 au crédit :
  // Quelle est la somme des 41112001 au crédit ? 1 171 422
  // Si on fait 1 171 422 - 1 065 727 = 105 695 !
  // Y a-t-il dans les 58 lignes de 41112001 au crédit une ou plusieurs lignes qui valent 105 695 ?
  const cr411 = await query(`
    SELECT id, n_facture, date, compte_tiers, libelle, credit
    FROM journal
    WHERE date >= '2026-09-01' AND date <= '2026-09-30' AND code_journal = 'VTE' AND compte = '41112001' AND credit > 0
  `);
  console.log(`Total lignes 41112001 cr : ${cr411.length}`);
  
  // Chercher des sous-ensembles de cr411 qui somment à 105 695
  for (let i = 0; i < cr411.length; i++) {
    if (cr411[i].credit === 105695) {
      console.log('Ligne 41112001 égale à 105 695 :', cr411[i]);
    }
    for (let j = i + 1; j < cr411.length; j++) {
      if (cr411[i].credit + cr411[j].credit === 105695) {
        console.log('2 Lignes 41112001 qui somment à 105 695 :', cr411[i], cr411[j]);
      }
    }
  }

  // Regarder aussi s'il y a des écritures avec date_validation ou sans date ou le 30/09
  const dernierJour = await query(`
    SELECT date, SUM(credit) as cr, SUM(debit) as db
    FROM journal
    WHERE date = '2026-09-30' AND code_journal = 'VTE'
  `);
  console.log('VTE au 30 septembre 2026 :', dernierJour[0]);

  // Regarder les factures du 30 septembre
  const fact30 = await query(`
    SELECT SUM(credit) as total_7061
    FROM journal
    WHERE date = '2026-09-30' AND compte LIKE '7061%'
  `);
  console.log('Ventes 7061 au 30/09 :', fact30[0]);

  db.close();
}

find105k().catch(console.error);
