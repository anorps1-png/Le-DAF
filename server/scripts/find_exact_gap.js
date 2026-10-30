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
  const target = 57506538;
  const current70 = 56440811;
  const gap = target - current70; // 1065727
  console.log(`Cible: ${target}, Actuel 70: ${current70}, Écart: ${gap}`);

  // Cherchons toutes les sommes groupées par n_importe quelle colonne en septembre 2026
  console.log('\n--- 1. Écart vs Hors Facture TP ---');
  // Rappel : Hors Facture TP = 1 171 422
  console.log(`Hors Facture TP total = 1 171 422`);
  console.log(`Différence (1 171 422 - 1 065 727) = ${1171422 - 1065727}`); // 105 695

  // Cherchons dans les écritures de septembre si une ou plusieurs lignes valent 105 695 ou 1 065 727
  const r1 = await query("SELECT * FROM journal WHERE (debit BETWEEN 1065700 AND 1065750) OR (credit BETWEEN 1065700 AND 1065750)");
  console.log('Lignes proches de 1 065 727 :', r1);

  const r2 = await query("SELECT * FROM journal WHERE (debit BETWEEN 105650 AND 105750) OR (credit BETWEEN 105650 AND 105750)");
  console.log('Lignes proches de 105 695 :', r2);

  // Cherchons si des sous-totaux par poste_budgetaire, centre_de_cout ou code_journal correspondent
  const parPoste = await query("SELECT poste_budgetaire, sum(credit) as cr, sum(debit) as db FROM journal WHERE date LIKE '2026-09%' GROUP BY poste_budgetaire");
  console.table(parPoste);

  // Vérifier si le CA du tableau de bord de JORDAN.MEDICAL.SYSTEM inclut les encaissements ou les ventes TTC ou la pharmacie
  // Regardons les totaux par jour en septembre 2026
  const parJour = await query(`
    SELECT date, round(sum(credit),2) as vte_cr 
    FROM journal 
    WHERE date LIKE '2026-09%' AND code_journal = 'VTE' AND compte LIKE '7%'
    GROUP BY date
  `);
  console.log('Nb de jours de vente en septembre :', parJour.length);

  db.close();
}

main().catch(console.error);
