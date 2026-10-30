const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('C:\\Users\\USER\\Desktop\\Compta 26.sqlite');

async function check411Credit() {
  const query = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  console.log('=== LIGNES AVEC 41112001 AU CREDIT DANS VTE (SEPTEMBRE 2026) ===');
  const rows = await query(`
    SELECT id, date, compte, compte_tiers, libelle, debit, credit
    FROM journal
    WHERE date >= '2026-09-01' AND date <= '2026-09-30' AND code_journal = 'VTE' AND compte = '41112001' AND credit > 0
    LIMIT 20
  `);
  console.table(rows);

  const stats = await query(`
    SELECT 
      COUNT(*) as nb_lignes,
      SUM(credit) as total_credit,
      MIN(credit) as min_cr,
      MAX(credit) as max_cr
    FROM journal
    WHERE date >= '2026-09-01' AND date <= '2026-09-30' AND code_journal = 'VTE' AND compte = '41112001' AND credit > 0
  `);
  console.log('Stats 41112001 au crédit :', stats[0]);

  // Regarder la contrepartie de ces lignes dans VTE
  // Les dates et numéros de factures
  const facturesWith411Cr = await query(`
    SELECT DISTINCT n_facture, date, libelle, credit
    FROM journal
    WHERE date >= '2026-09-01' AND date <= '2026-09-30' AND code_journal = 'VTE' AND compte = '41112001' AND credit > 0
    LIMIT 10
  `);
  console.log('Factures concernées :');
  console.table(facturesWith411Cr);

  // Vérifier aussi les 189 lignes de 70690000 au débit (2 126 335)
  console.log('\n=== LIGNES 70690000 AU DEBIT DANS VTE (SEPTEMBRE 2026) ===');
  const stats7069 = await query(`
    SELECT 
      COUNT(*) as nb_lignes,
      SUM(debit) as total_debit
    FROM journal
    WHERE date >= '2026-09-01' AND date <= '2026-09-30' AND code_journal = 'VTE' AND compte = '70690000'
  `);
  console.log('Stats 70690000 au débit :', stats7069[0]);

  const sample7069 = await query(`
    SELECT id, date, compte, libelle, debit, credit
    FROM journal
    WHERE date >= '2026-09-01' AND date <= '2026-09-30' AND code_journal = 'VTE' AND compte = '70690000'
    LIMIT 10
  `);
  console.table(sample7069);

  db.close();
}

check411Credit().catch(console.error);
