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
  console.log('=== VERIFICATION DES COMPTES DE CHARGES OU PRODUITS POTENTIELLEMENT LIES AUX RRR ===');
  // Tous les comptes mouvementés dans le journal
  const activeComptes = await query("SELECT DISTINCT compte FROM journal ORDER BY compte");
  console.log('Nombre total de comptes distincts mouvementés :', activeComptes.length);

  // Croisons avec chart_of_accounts
  const comptesWithLabels = await query(`
    SELECT j.compte, c.libelle, count(*) as cnt, round(sum(j.debit),2) as db, round(sum(j.credit),2) as cr
    FROM journal j
    LEFT JOIN chart_of_accounts c ON j.compte = c.compte
    WHERE c.libelle LIKE '%REMISE%' 
       OR c.libelle LIKE '%RABAIS%' 
       OR c.libelle LIKE '%RISTOURNE%' 
       OR c.libelle LIKE '%REDUC%'
       OR c.libelle LIKE '%PERTE%'
       OR c.libelle LIKE '%ABANDON%'
       OR c.libelle LIKE '%AVOIR%'
    GROUP BY j.compte
  `);
  console.log('Comptes mouvementés dont le libellé contient un terme de réduction :');
  console.table(comptesWithLabels);

  console.log('\n=== ANALYSE DE LA FACTURATION DANS HOSPIT : SONT-ELLES NETTES ? ===');
  // Regardons par exemple les libellés de vente dans VTE
  const vteSample = await query("SELECT libelle, count(*) as cnt FROM journal WHERE code_journal = 'VTE' GROUP BY substr(libelle, 1, 20) ORDER BY cnt DESC LIMIT 15");
  console.table(vteSample);

  db.close();
}

main().catch(console.error);
