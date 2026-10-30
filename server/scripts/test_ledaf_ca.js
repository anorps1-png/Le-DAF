const sqlite3 = require('sqlite3').verbose();
const dbPath = 'C:/Users/USER/Desktop/Compta 26.sqlite';
const db = new sqlite3.Database(dbPath);
const { computeEtatsFinanciers } = require('../ohadaRules');

const query = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) reject(err);
    else resolve(rows);
  });
});

async function main() {
  // Balance des comptes en septembre 2026
  const rows = await query(`
    SELECT compte, sum(debit) as total_debit, sum(credit) as total_credit 
    FROM journal 
    WHERE date >= '2026-09-01' AND date <= '2026-09-30'
    GROUP BY compte
  `);

  const { resultat } = computeEtatsFinanciers(rows);
  console.log('=== RESULTAT LE-DAF POUR SEPTEMBRE 2026 ===');
  console.log('Chiffre d affaires calculé par Le-DAF :', resultat.chiffreAffaires);
  console.log('Détail ventesMarchandises :', resultat.ventesMarchandises);
  console.log('Détail chiffreAffairesAutre :', resultat.chiffreAffairesAutre);

  db.close();
}

main().catch(console.error);
