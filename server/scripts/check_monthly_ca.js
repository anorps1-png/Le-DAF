const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('C:\\Users\\USER\\Desktop\\Compta 26.sqlite');

async function check() {
  const query = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  console.log('--- EXERCICES ---');
  const ex = await query("SELECT * FROM exercices");
  console.table(ex);

  console.log('--- SETTINGS ---');
  const st = await query("SELECT * FROM settings WHERE key LIKE '%EXERCICE%' OR key LIKE '%DATE%'");
  console.table(st);

  console.log('--- CA PAR MOIS (COMPTES 70%) ---');
  const monthly = await query(`
    SELECT 
      substr(date, 1, 7) as mois,
      SUM(credit) as cr,
      SUM(debit) as db,
      (SUM(credit) - SUM(debit)) as ca,
      COUNT(*) as nb_lignes
    FROM journal 
    WHERE compte LIKE '70%'
    GROUP BY substr(date, 1, 7)
    ORDER BY mois
  `);
  console.table(monthly);

  // Chercher exactement 56440811 dans différentes combinaisons de mois ou filtres
  for (const m of monthly) {
    if (m.ca === 56440811 || Math.abs(m.ca - 56440811) < 100) {
      console.log('Trouvé exactement dans le mois :', m);
    }
  }

  // Chercher si 56440811 est un mois sans le compte 70690000 (hors facture) ou avec
  const monthlySansAvoir = await query(`
    SELECT 
      substr(date, 1, 7) as mois,
      SUM(credit) as cr,
      SUM(debit) as db,
      (SUM(credit) - SUM(debit)) as ca
    FROM journal 
    WHERE compte LIKE '7061%'
    GROUP BY substr(date, 1, 7)
    ORDER BY mois
  `);
  console.log('--- CA PAR MOIS UNIQUEMENT 7061 (VENTES PATIENTS) ---');
  console.table(monthlySansAvoir);

  // Vérifier également les dates min et max
  const dateRange = await query("SELECT MIN(date) as min_date, MAX(date) as max_date, COUNT(*) as total_lignes FROM journal");
  console.log('Date range :', dateRange[0]);

  db.close();
}

check().catch(console.error);
