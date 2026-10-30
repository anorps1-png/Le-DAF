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
  console.log('=== 1. TOUTES LES LIGNES SUR DES COMPTES 70...9... (RRR EN CLASSE 7) ===');
  const rrrComptes = await query(`
    SELECT code_journal, date, compte, libelle, debit, credit 
    FROM journal 
    WHERE compte LIKE '70%9%' OR compte LIKE '709%'
    ORDER BY date
  `);
  console.log('Nombre de lignes trouvées :', rrrComptes.length);
  console.table(rrrComptes.slice(0, 20));

  console.log('\n=== 2. RECHERCHE PAR MOTS-CLÉS DE RRR DANS LES LIBELLES DE TOUTE LA BASE ===');
  const keywords = ['R.R.R', 'RRR', 'RABAIS', 'RISTOURNE', 'REDUCTION', 'GRATUITE', 'AVOIR', 'GESTIONNAIRE', 'EXONERATION'];
  for (const kw of keywords) {
    const rows = await query(`
      SELECT code_journal, date, compte, libelle, debit, credit 
      FROM journal 
      WHERE UPPER(libelle) LIKE UPPER(?)
      LIMIT 10
    `, [`%${kw}%`]);
    console.log(`\nMot-clé "${kw}" : ${rows.length} résultat(s)`);
    if (rows.length > 0) console.table(rows);
  }

  console.log('\n=== 3. CHERCHER DANS LES COMPTES 419 (AVOIRS / RRR A ACCORDER) ===');
  const c419 = await query(`
    SELECT code_journal, date, compte, libelle, debit, credit 
    FROM journal 
    WHERE compte LIKE '419%'
  `);
  console.log('Lignes compte 419% :', c419.length);
  if (c419.length > 0) console.table(c419);

  console.log('\n=== 4. CHERCHER DANS LE JOURNAL DES VENTES (VTE) LES LIGNES AU DEBIT AUTRES QUE 411 ===');
  const vteDebitsNon411 = await query(`
    SELECT compte, COUNT(*) as cnt, round(SUM(debit), 2) as total_debit, substr(libelle, 1, 30) as exemple_libelle
    FROM journal 
    WHERE code_journal = 'VTE' AND compte NOT LIKE '411%' AND debit > 0
    GROUP BY compte
  `);
  console.log('Débits non 411 dans VTE :');
  console.table(vteDebitsNon411);

  console.log('\n=== 5. CHERCHER DANS LES OD (OPERATIONS DIVERSES) LES ECRITURES DE REGULARISATION OU REDUCTION ===');
  const odRows = await query(`
    SELECT code_journal, date, compte, libelle, debit, credit 
    FROM journal 
    WHERE code_journal IN ('OD', 'O D', 'OD CS') AND (compte LIKE '7%' OR compte LIKE '411%' OR compte LIKE '65%')
    LIMIT 20
  `);
  console.log('Lignes OD concernant classe 7 ou 411 :');
  console.table(odRows);

  db.close();
}

main().catch(console.error);
