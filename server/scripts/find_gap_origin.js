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
  console.log('=== TOUS LES JOURNAUX ET COMPTES EN SEPTEMBRE 2026 ===');
  // Total des crédits et débits par compte en septembre 2026
  const comptesSept = await query(`
    SELECT code_journal, compte, round(sum(debit),2) as db, round(sum(credit),2) as cr, round(sum(credit)-sum(debit),2) as solde_cr
    FROM journal 
    WHERE date >= '2026-09-01' AND date <= '2026-09-30'
    GROUP BY code_journal, compte
    ORDER BY cr DESC
  `);
  console.table(comptesSept.filter(r => r.cr > 100000 || r.db > 100000));

  // Vérifier la somme de tous les crédits dans VTE
  const [totalCreditVTE] = await query("SELECT round(sum(credit),2) as cr, round(sum(debit),2) as db FROM journal WHERE date >= '2026-09-01' AND date <= '2026-09-30' AND code_journal = 'VTE'");
  console.log('Total VTE Septembre 2026 :', totalCreditVTE);

  // Vérifier 56 440 811 + 1 065 727 = 57 506 538
  // Y a-t-il des comptes ou combinaisons qui donnent 1 065 727 ou 57 506 538 ?
  console.log('Total crédits 7061 en septembre :', 56440811);
  console.log('Objectif HOSPIT Dashboard :', 57506538);
  console.log('Écart exact :', 57506538 - 56440811); // 1 065 727

  // Cherchons dans les autres journaux (CAISPH, CAISPR, CAIS C, etc.)
  const autresJournaux = await query(`
    SELECT code_journal, round(sum(debit),2) as db, round(sum(credit),2) as cr 
    FROM journal 
    WHERE date >= '2026-09-01' AND date <= '2026-09-30' AND code_journal != 'VTE'
    GROUP BY code_journal
  `);
  console.log('Autres journaux en septembre :');
  console.table(autresJournaux);

  db.close();
}

main().catch(console.error);
