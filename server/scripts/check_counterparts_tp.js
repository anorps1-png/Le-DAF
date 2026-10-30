const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('C:\\Users\\USER\\Desktop\\Compta 26.sqlite');

async function checkCounterparts() {
  const query = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  // Prenons 5 factures parmi les 58 et affichons TOUTES les lignes du journal ayant ce n_facture
  const sampleFactures = ['FTP00141012', 'FTP00141688', 'FTP00141483', 'FTP00141107', 'FTP00140953'];
  
  for (const nFact of sampleFactures) {
    console.log(`\n=== TOUTES LES LIGNES POUR LA FACTURE ${nFact} ===`);
    const lines = await query(`
      SELECT id, date, code_journal, compte, compte_tiers, libelle, debit, credit
      FROM journal
      WHERE n_facture = ?
      ORDER BY id
    `, [nFact]);
    console.table(lines);
  }

  // Vérifions aussi pour toutes les 58 factures quel est le schéma global
  const schemaSummary = await query(`
    SELECT 
      j2.compte as compte_contrepartie,
      COUNT(*) as nb_lignes,
      SUM(j2.debit) as total_debit,
      SUM(j2.credit) as total_credit
    FROM journal j1
    JOIN journal j2 ON j1.n_facture = j2.n_facture AND j1.id != j2.id
    WHERE j1.date >= '2026-09-01' AND j1.date <= '2026-09-30'
      AND j1.code_journal = 'VTE' 
      AND j1.compte = '41112001' 
      AND j1.credit > 0
    GROUP BY j2.compte
  `);
  console.log('\n=== COMPTES DE CONTREPARTIE DES FACTURES HORS FACTURE TP ===');
  console.table(schemaSummary);

  db.close();
}

checkCounterparts().catch(console.error);
