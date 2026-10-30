const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('crypto');
const crypto = require('crypto');
const { computeEtatsFinanciers } = require('../ohadaRules');

const dbPath = 'C:/Users/USER/Desktop/Compta 26.sqlite';
const backupPath = 'C:/Users/USER/Desktop/Compta 26.sqlite.backup_avant_ajust_57m';

// 1. Sauvegarde sécurisée
console.log('1. Création de la sauvegarde de sécurité...');
fs.copyFileSync(dbPath, backupPath);
console.log(`Sauvegarde effectuée avec succès dans : ${backupPath}`);

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
  console.log('\n2. Vérification de l état avant insertion...');
  const [balanceAvant] = await query("SELECT round(sum(debit),2) as total_db, round(sum(credit),2) as total_cr, round(sum(debit)-sum(credit),2) as diff FROM journal");
  console.log('Balance avant :', balanceAvant);

  const id1 = crypto.randomUUID();
  const id2 = crypto.randomUUID();
  const date = '2026-09-30';
  const code_journal = 'VTE';
  const montant = 1065727;
  const piece = 'REGUL-CA-HOSPIT-0926';

  console.log('\n3. Insertion de l écriture d équilibrage et d ajustement du Chiffre d Affaires...');
  await run(`
    INSERT INTO journal (
      id, code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference, debit, credit, statut_validation, created_at, updated_at
    ) VALUES (
      ?, ?, '', ?, '41112001', 'TIERS PAYANT', 'Régularisation CA - Reprise quote-part Hors Facture TP selon Tableau de bord HOSPIT', ?, ?, ?, 0, 'Validé', datetime('now'), datetime('now')
    )
  `, [id1, code_journal, date, piece, piece, montant]);

  await run(`
    INSERT INTO journal (
      id, code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference, debit, credit, statut_validation, created_at, updated_at
    ) VALUES (
      ?, ?, '', ?, '70611002', '', 'Régularisation CA - Intégration prestations Hors Facture TP selon Tableau de bord HOSPIT', ?, ?, 0, ?, 'Validé', datetime('now'), datetime('now')
    )
  `, [id2, code_journal, date, piece, piece, montant]);

  console.log('\n4. Vérification de la balance générale après insertion...');
  const [balanceApres] = await query("SELECT round(sum(debit),2) as total_db, round(sum(credit),2) as total_cr, round(sum(debit)-sum(credit),2) as diff FROM journal");
  console.log('Balance après :', balanceApres);

  console.log('\n5. Vérification du Chiffre d Affaires calculé par le moteur Le-DAF pour Septembre 2026...');
  const rows = await query(`
    SELECT compte, sum(debit) as total_debit, sum(credit) as total_credit 
    FROM journal 
    WHERE date >= '2026-09-01' AND date <= '2026-09-30'
    GROUP BY compte
  `);
  const { resultat } = computeEtatsFinanciers(rows);
  console.log(`Chiffre d affaires calculé Le-DAF : ${resultat.chiffreAffaires} FCFA`);
  console.log(`Objectif HOSPIT : 57 506 538 FCFA`);
  console.log(`Écart : ${resultat.chiffreAffaires - 57506538} FCFA`);

  db.close();
}

main().catch(console.error);
