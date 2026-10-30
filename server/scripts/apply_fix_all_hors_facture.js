const sqlite3 = require('sqlite3').verbose();
const dbPath = 'C:/Users/USER/Desktop/Compta 26.sqlite';
const db = new sqlite3.Database(dbPath);

const query = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) reject(err);
    else resolve(rows);
  });
});

const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) reject(err);
    else resolve(this);
  });
});

async function main() {
  console.log('=== VERIFICATION AVANT RECLASSIFICATION ===');
  const [balanceAvant] = await query("SELECT round(sum(debit),2) as total_db, round(sum(credit),2) as total_cr, round(sum(debit)-sum(credit),2) as diff FROM journal");
  console.log('Balance avant :', balanceAvant);

  const [toFix] = await query("SELECT count(*) as cnt, round(sum(debit),2) as total FROM journal WHERE compte = '70690000' AND libelle LIKE '%HORS FACTURE%'");
  console.log(`Lignes 70690000 à reclasser vers 41111000 : ${toFix.cnt} (${toFix.total} FCFA)`);

  if (toFix.cnt > 0) {
    const res = await run("UPDATE journal SET compte = '41111000' WHERE compte = '70690000' AND libelle LIKE '%HORS FACTURE%'");
    console.log(`UPDATE effectue avec succes. Lignes modifiees : ${res.changes}`);
  }

  const [balanceApres] = await query("SELECT round(sum(debit),2) as total_db, round(sum(credit),2) as total_cr, round(sum(debit)-sum(credit),2) as diff FROM journal");
  console.log('Balance après :', balanceApres);

  const [restant7069] = await query("SELECT count(*) as cnt, round(sum(debit),2) as total FROM journal WHERE compte = '70690000'");
  console.log('Lignes restantes au compte 70690000 :', restant7069);

  // Vérifier le CA de Septembre 2026
  const [caSept] = await query("SELECT round(sum(credit)-sum(debit),2) as ca_net FROM journal WHERE compte LIKE '70%' AND date >= '2026-09-01' AND date <= '2026-09-30'");
  console.log('Chiffre d affaires classe 7 Septembre 2026 après correction :', caSept);

  db.close();
}

main().catch(console.error);
