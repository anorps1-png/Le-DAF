const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('C:\\Users\\USER\\Desktop\\Compta 26.sqlite');

async function analyse() {
  const query = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  console.log('=== ANALYSE DETAILLEE DU MOIS DE SEPTEMBRE 2026 ===');

  // 1. Tous les comptes mouvementés en septembre 2026
  const comptesSept = await query(`
    SELECT 
      compte,
      substr(compte, 1, 2) as classe,
      SUM(debit) as total_db,
      SUM(credit) as total_cr,
      (SUM(credit) - SUM(debit)) as solde_cr,
      (SUM(debit) - SUM(credit)) as solde_db,
      COUNT(*) as nb
    FROM journal
    WHERE date >= '2026-09-01' AND date <= '2026-09-30'
    GROUP BY compte
    ORDER BY total_cr DESC
  `);
  console.log('\n--- TOUS LES COMPTES MOUVEMENTES EN SEPTEMBRE 2026 ---');
  console.table(comptesSept);

  // 2. Répartition par code_journal en septembre 2026
  const journauxSept = await query(`
    SELECT 
      code_journal,
      COUNT(*) as nb,
      SUM(debit) as total_db,
      SUM(credit) as total_cr
    FROM journal
    WHERE date >= '2026-09-01' AND date <= '2026-09-30'
    GROUP BY code_journal
  `);
  console.log('\n--- PAR CODE JOURNAL (SEPTEMBRE 2026) ---');
  console.table(journauxSept);

  // 3. Répartition par jour en septembre 2026 des comptes 7061
  const ventesParJour = await query(`
    SELECT 
      date,
      SUM(credit) as vente_cr,
      SUM(debit) as vente_db,
      COUNT(*) as nb
    FROM journal
    WHERE date >= '2026-09-01' AND date <= '2026-09-30' AND compte LIKE '7061%'
    GROUP BY date
    ORDER BY date
  `);
  console.log('\n--- VENTES PAR JOUR (SEPTEMBRE 2026) ---');
  console.table(ventesParJour);

  // 4. Comptes de tiers mouvementés en septembre
  const tiersSept = await query(`
    SELECT 
      compte,
      COUNT(DISTINCT compte_tiers) as nb_tiers,
      SUM(debit) as db,
      SUM(credit) as cr,
      SUM(debit) - SUM(credit) as solde_db
    FROM journal
    WHERE date >= '2026-09-01' AND date <= '2026-09-30' AND (compte LIKE '41%' OR compte LIKE '40%')
    GROUP BY compte
  `);
  console.log('\n--- TIERS CLIENTS / FOURNISSEURS (SEPTEMBRE 2026) ---');
  console.table(tiersSept);

  // 5. Caisse et Banque en septembre
  const tresoSept = await query(`
    SELECT 
      compte,
      SUM(debit) as encaissements,
      SUM(credit) as decaissements,
      (SUM(debit) - SUM(credit)) as solde
    FROM journal
    WHERE date >= '2026-09-01' AND date <= '2026-09-30' AND (compte LIKE '57%' OR compte LIKE '52%')
    GROUP BY compte
  `);
  console.log('\n--- TRESORERIE ENCAISSEMENTS / DECAISSEMENTS (SEPTEMBRE 2026) ---');
  console.table(tresoSept);

  // 6. Y a-t-il des écritures en septembre avec un libellé ou compte particulier ?
  const ecrituresSpeciales = await query(`
    SELECT DISTINCT compte, libelle, debit, credit, date
    FROM journal
    WHERE date >= '2026-09-01' AND date <= '2026-09-30'
      AND (compte NOT LIKE '7061%' AND compte NOT LIKE '411%' AND compte NOT LIKE '571%')
    LIMIT 30
  `);
  console.log('\n--- ECRITURES SPECIALES (AUTRES COMPTES) ---');
  console.table(ecrituresSpeciales);

  // 7. Vérifier s'il y a des écritures le 31 août ou le 01 octobre qui pourraient être décalées
  const bordure = await query(`
    SELECT date, compte, SUM(credit) as cr, SUM(debit) as db, COUNT(*) as nb
    FROM journal
    WHERE date IN ('2026-08-31', '2026-10-01') AND compte LIKE '7061%'
    GROUP BY date, compte
  `);
  console.log('\n--- VENTES AUX BORDURES (31/08 et 01/10) ---');
  console.table(bordure);

  // 8. Calcul exact de l'écart : 57 506 538 - 56 440 811 = 1 065 727
  const ecart = 57506538 - 56440811;
  console.log(`\nECART : 57 506 538 - 56 440 811 = ${ecart} FCFA`);

  // Cherchons les combinaisons de montants ou sommes de journaux qui donnent exactement ou environ 1 065 727
  // Par exemple un compte ou un sous-total
  for (const c of comptesSept) {
    if (Math.abs(c.total_cr - ecart) < 10000 || Math.abs(c.total_db - ecart) < 10000 || Math.abs(c.solde_cr - ecart) < 10000 || Math.abs(c.solde_db - ecart) < 10000) {
      console.log(`>>> COMPTE CORRESPONDANT A L'ECART :`, c);
    }
  }

  db.close();
}

analyse().catch(console.error);
