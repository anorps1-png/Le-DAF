const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('C:\\Users\\USER\\Desktop\\Compta 26.sqlite');

async function analyseVTE() {
  const query = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  console.log('=== ANALYSE DU JOURNAL VTE EN SEPTEMBRE 2026 ===');

  const vteParCompte = await query(`
    SELECT 
      compte,
      SUM(debit) as db,
      SUM(credit) as cr,
      COUNT(*) as nb
    FROM journal
    WHERE date >= '2026-09-01' AND date <= '2026-09-30' AND code_journal = 'VTE'
    GROUP BY compte
    ORDER BY cr DESC
  `);
  console.table(vteParCompte);

  // Somme totale des crédits 7061 : 56 440 811
  // Somme totale des débits 70690000 : 2 126 335
  // Total net 70 : 56 440 811 - 2 126 335 = 54 314 476
  // Que contient VTE en débit et en crédit ?
  // Débits de VTE :
  // Normalement, dans un journal des ventes :
  // Débit = Clients (41111000 : Clients au comptant / patients, 41112001 : Tiers payant / Prises en charge)
  // Crédit = Ventes (7061...) + Éventuelle TVA (443...) ou Hors facture (7069...)
  
  const vteDebits = await query(`
    SELECT 
      compte,
      SUM(debit) as db,
      COUNT(*) as nb
    FROM journal
    WHERE date >= '2026-09-01' AND date <= '2026-09-30' AND code_journal = 'VTE' AND debit > 0
    GROUP BY compte
    ORDER BY db DESC
  `);
  console.log('\n--- DEBITS DE VTE (CLIENTS / TIERS PAYANT) ---');
  console.table(vteDebits);

  const vteCredits = await query(`
    SELECT 
      compte,
      SUM(credit) as cr,
      COUNT(*) as nb
    FROM journal
    WHERE date >= '2026-09-01' AND date <= '2026-09-30' AND code_journal = 'VTE' AND credit > 0
    GROUP BY compte
    ORDER BY cr DESC
  `);
  console.log('\n--- CREDITS DE VTE (PRODUITS / VENTES) ---');
  console.table(vteCredits);

  // Regarder aussi dans les autres journaux (CAISPR, CAISPH, CAIS C) s'il y a des ventes ou des encaissements directs
  const ventesAutresJournaux = await query(`
    SELECT 
      code_journal,
      compte,
      SUM(credit) as cr,
      SUM(debit) as db,
      COUNT(*) as nb
    FROM journal
    WHERE date >= '2026-09-01' AND date <= '2026-09-30' AND code_journal != 'VTE' AND compte LIKE '7%'
    GROUP BY code_journal, compte
  `);
  console.log('\n--- COMPTES 7 EN DEHORS DE VTE ---');
  console.table(ventesAutresJournaux);

  // Total débit 411 dans VTE
  // Total crédit 411 dans VTE
  // Regardons si la différence entre le CA du tableau de bord (57 506 538) et Le-DAF (56 440 811) = 1 065 727
  // vient de :
  // 1) 56 440 811 + un élément précis = 57 506 538 ?
  // Regardons les encaissements ou caisses :
  // Dans CAISPH (Caisse Pharmacie) : total = 1 314 481
  // Dans CAIS C (Caisse ...) : total = 1 328 514
  // Regardons si 57 506 538 correspond au total des débits clients ou des factures émises
  const totalDebitsClientsVTE = await query(`
    SELECT 
      SUM(debit) as total_debit_vte,
      SUM(CASE WHEN compte = '41111000' THEN debit ELSE 0 END) as clients_patients,
      SUM(CASE WHEN compte = '41112001' THEN debit ELSE 0 END) as tiers_payant
    FROM journal
    WHERE date >= '2026-09-01' AND date <= '2026-09-30' AND code_journal = 'VTE'
  `);
  console.log('\n--- TOTAL DEBITS VTE ---', totalDebitsClientsVTE[0]);

  db.close();
}

analyseVTE().catch(console.error);
