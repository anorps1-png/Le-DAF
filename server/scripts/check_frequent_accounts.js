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
  console.log('=== COMPTES FREQUENTS PAR CATEGORIE ===');
  
  const c7 = await query("SELECT compte, round(sum(credit),2) as cr, count(*) as cnt FROM journal WHERE compte LIKE '7%' GROUP BY compte ORDER BY cnt DESC LIMIT 8");
  console.log('Produits (7) :');
  console.table(c7);

  const c6 = await query("SELECT compte, round(sum(debit),2) as db, count(*) as cnt FROM journal WHERE compte LIKE '6%' GROUP BY compte ORDER BY cnt DESC LIMIT 8");
  console.log('Charges (6) :');
  console.table(c6);

  const c5 = await query("SELECT compte, code_journal, round(sum(debit+credit),2) as total, count(*) as cnt FROM journal WHERE compte LIKE '5%' GROUP BY compte, code_journal ORDER BY cnt DESC LIMIT 8");
  console.log('Trésorerie (5) :');
  console.table(c5);

  const c4 = await query("SELECT compte, round(sum(debit+credit),2) as total, count(*) as cnt FROM journal WHERE compte LIKE '4%' GROUP BY compte ORDER BY cnt DESC LIMIT 8");
  console.log('Tiers (4) :');
  console.table(c4);

  db.close();
}

main().catch(console.error);
