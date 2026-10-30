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
  const cols = await query("PRAGMA table_info(chart_of_accounts)");
  console.log('Colonnes chart_of_accounts:', cols.map(c => c.name));

  const plan70 = await query("SELECT * FROM chart_of_accounts WHERE " + cols[1].name + " LIKE '70%' OR " + cols[1].name + " LIKE '7%' LIMIT 30");
  console.log('=== Plan comptable classe 7 ===');
  console.table(plan70);

  console.log('\n=== ECRITURES AVEC LIBELLES REMISE / RABAIS / RISTOURNE / REDUCTION ===');
  const remises = await query("SELECT code_journal, date, compte, libelle, debit, credit FROM journal WHERE libelle LIKE '%REMISE%' OR libelle LIKE '%RABAIS%' OR libelle LIKE '%RISTOURNE%' OR libelle LIKE '%REDUC%' LIMIT 20");
  console.table(remises);

  console.log('\n=== TOUS LES COMPTES 70 UTILISES DANS LE JOURNAL ===');
  const comptes70 = await query("SELECT compte, round(sum(debit),2) as debit, round(sum(credit),2) as credit, count(*) as cnt FROM journal WHERE compte LIKE '70%' GROUP BY compte");
  console.table(comptes70);

  db.close();
}

run().catch(console.error);
