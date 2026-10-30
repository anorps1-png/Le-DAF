const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('C:\\Users\\USER\\Desktop\\Compta 26.sqlite');

db.all(`
  SELECT 
    COALESCE(compte_tiers, 'NON PRECISE') as assurance, 
    COUNT(*) as nb_lignes, 
    SUM(credit) as total_montant 
  FROM journal 
  WHERE date >= '2026-09-01' AND date <= '2026-09-30' 
    AND code_journal = 'VTE' 
    AND compte = '41112001' 
    AND credit > 0 
  GROUP BY compte_tiers 
  ORDER BY total_montant DESC
`, (err, rows) => {
  if (err) console.error(err);
  else {
    console.table(rows);
    let total = 0;
    rows.forEach(r => total += r.total_montant);
    console.log('TOTAL Hors Facture TP :', total, 'FCFA');
  }
  db.close();
});
