const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('C:\\Users\\USER\\Desktop\\Compta 26.sqlite');

async function runFix() {
  const query = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });

  console.log('=== VÉRIFICATION AVANT CORRECTION ===');
  const beforeStats = await query(`
    SELECT 
      COUNT(*) as nb_lignes,
      SUM(debit) as total_montant
    FROM journal
    WHERE compte = '70690000' AND libelle LIKE '%HORS FACTURE TP%'
  `);
  console.log(`Lignes à corriger dans toute la base : ${beforeStats[0].nb_lignes} lignes pour un montant de ${beforeStats[0].total_montant} FCFA`);

  const septStats = await query(`
    SELECT 
      COUNT(*) as nb_lignes,
      SUM(debit) as total_montant
    FROM journal
    WHERE date >= '2026-09-01' AND date <= '2026-09-30'
      AND compte = '70690000' AND libelle LIKE '%HORS FACTURE TP%'
  `);
  console.log(`Dont en septembre 2026 : ${septStats[0].nb_lignes} lignes pour ${septStats[0].total_montant} FCFA`);

  const balanceBefore = await query(`
    SELECT SUM(debit) as total_db, SUM(credit) as total_cr, (SUM(debit) - SUM(credit)) as diff
    FROM journal
  `);
  console.log('Balance avant :', balanceBefore[0]);

  // Exécution de l'UPDATE
  console.log('\n=== APPLICATION DU CORRECTIF SUR LE JOURNAL ===');
  const result = await run(`
    UPDATE journal
    SET compte = '41111000'
    WHERE compte = '70690000' AND libelle LIKE '%HORS FACTURE TP%'
  `);
  console.log(`Lignes mises à jour : ${result.changes}`);

  console.log('\n=== VÉRIFICATION APRÈS CORRECTION ===');
  const remaining = await query(`
    SELECT COUNT(*) as nb_restantes
    FROM journal
    WHERE compte = '70690000' AND libelle LIKE '%HORS FACTURE TP%'
  `);
  console.log(`Lignes 70690000 HORS FACTURE TP restantes : ${remaining[0].nb_restantes}`);

  const balanceAfter = await query(`
    SELECT SUM(debit) as total_db, SUM(credit) as total_cr, (SUM(debit) - SUM(credit)) as diff
    FROM journal
  `);
  console.log('Balance après :', balanceAfter[0]);

  // Nouveau CA net pour septembre 2026
  const caSept = await query(`
    SELECT 
      SUM(credit) as ca_brut,
      SUM(debit) as deduire_7069,
      (SUM(credit) - SUM(debit)) as ca_net
    FROM journal
    WHERE date >= '2026-09-01' AND date <= '2026-09-30'
      AND compte LIKE '70%'
  `);
  console.log('\nNouveau CA Septembre 2026 :', caSept[0]);

  db.close();
}

runFix().catch(console.error);
