const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('C:\\Users\\USER\\Desktop\\Compta 26.sqlite');

async function checkAllMonths() {
  const query = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  const allMonths = await query(`
    SELECT 
      substr(date, 1, 7) as mois,
      COUNT(*) as nb_ecritures,
      SUM(credit) as total_hf_tp
    FROM journal
    WHERE compte = '41112001' AND libelle LIKE '%HORS FACTURE TP%' AND credit > 0
    GROUP BY substr(date, 1, 7)
    ORDER BY mois
  `);
  console.log('=== HORS FACTURE TP SUR TOUTE LA BASE ===');
  console.table(allMonths);

  const all7069 = await query(`
    SELECT 
      substr(date, 1, 7) as mois,
      COUNT(*) as nb_ecritures,
      SUM(debit) as total_7069
    FROM journal
    WHERE compte = '70690000'
    GROUP BY substr(date, 1, 7)
    ORDER BY mois
  `);
  console.log('\n=== COMPTE 70690000 AU DEBIT SUR TOUTE LA BASE ===');
  console.table(all7069);

  db.close();
}

checkAllMonths().catch(console.error);
