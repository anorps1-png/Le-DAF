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
  console.log('=== TEST SIMULATION REGULARISATION CA A 57 506 538 FCFA ===');

  // Balance actuelle
  const rows = await query(`
    SELECT compte, sum(debit) as total_debit, sum(credit) as total_credit 
    FROM journal 
    WHERE date >= '2026-09-01' AND date <= '2026-09-30'
    GROUP BY compte
  `);

  const { resultat: resAvant } = computeEtatsFinanciers(rows);
  console.log('Chiffre d affaires avant :', resAvant.chiffreAffaires);

  // Simuler l ajout de l ecriture :
  // Débit 41112001 : 1 065 727
  // Crédit 70611002 : 1 065 727
  const simRows = rows.map(r => ({ ...r }));
  const r70 = simRows.find(r => r.compte === '70611002');
  if (r70) r70.total_credit += 1065727;
  const r411 = simRows.find(r => r.compte === '41112001');
  if (r411) r411.total_debit += 1065727;

  const { resultat: resApres } = computeEtatsFinanciers(simRows);
  console.log('Chiffre d affaires après simulation :', resApres.chiffreAffaires);
  console.log('Conforme à 57 506 538 ?', resApres.chiffreAffaires === 57506538);

  db.close();
}

main().catch(console.error);
