const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('C:\\Users\\USER\\Desktop\\Compta 26.sqlite');

async function getHorsFactureTP() {
  const query = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  // 1. Récapitulatif par Tiers Payant (Assurance)
  const parTiers = await query(`
    SELECT 
      COALESCE(compte_tiers, 'NON PRECISE') as assurance,
      COUNT(*) as nb_lignes,
      SUM(credit) as total_montant,
      MIN(date) as premiere_date,
      MAX(date) as derniere_date
    FROM journal
    WHERE date >= '2026-09-01' AND date <= '2026-09-30'
      AND code_journal = 'VTE' 
      AND compte = '41112001' 
      AND credit > 0
    GROUP BY compte_tiers
    ORDER BY total_montant DESC
  `);
  console.log('=== RECAPITULATIF PAR ASSURANCE / TIERS PAYANT ===');
  console.table(parTiers);

  // 2. Toutes les 58 lignes détaillées
  const allRows = await query(`
    SELECT 
      date,
      COALESCE(n_facture, '') as n_facture,
      COALESCE(compte_tiers, '') as assurance,
      libelle,
      credit as montant_fcfa
    FROM journal
    WHERE date >= '2026-09-01' AND date <= '2026-09-30'
      AND code_journal = 'VTE' 
      AND compte = '41112001' 
      AND credit > 0
    ORDER BY date ASC, credit DESC
  `);
  console.log(`\n=== DETAIL DES ${allRows.length} ECRITURES 'HORS FACTURE TP' ===`);
  console.log(JSON.stringify(allRows, null, 2));

  db.close();
}

getHorsFactureTP().catch(console.error);
