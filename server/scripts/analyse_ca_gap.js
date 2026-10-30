const path = require('path');
const fs = require('fs');

async function run() {
  // 1. Trouver le chemin de la base active
  const userDataDir = path.join(process.env.APPDATA || '', 'Agent financier');
  const cfgPath = path.join(userDataDir, 'active-db-config.json');
  let dbPath = path.join(userDataDir, 'agent-ohada.sqlite');
  if (fs.existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (cfg && cfg.dbPath) dbPath = cfg.dbPath;
    } catch (e) {}
  }
  console.log('Base de donnees active :', dbPath);

  const sqlite3 = require('sqlite3').verbose();
  const db = new sqlite3.Database(dbPath);

  const query = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  // Somme compte LIKE '70%'
  const ca70 = await query("SELECT SUM(credit) as total_credit, SUM(debit) as total_debit, (SUM(credit) - SUM(debit)) as solde FROM journal WHERE compte LIKE '70%'");
  console.log('Compte 70% :', ca70[0]);

  // Somme tous comptes classe 7
  const caAll7 = await query("SELECT SUM(credit) as total_credit, SUM(debit) as total_debit, (SUM(credit) - SUM(debit)) as solde FROM journal WHERE compte LIKE '7%'");
  console.log('Tous comptes 7% :', caAll7[0]);

  // Détail par compte de classe 7
  const detail7 = await query("SELECT compte, libelle, SUM(credit) as cr, SUM(debit) as db, (SUM(credit) - SUM(debit)) as solde, COUNT(*) as nb FROM journal WHERE compte LIKE '7%' GROUP BY compte ORDER BY solde DESC");
  console.log('\nDetail par compte classe 7 :');
  console.table(detail7);

  // Vérifier aussi les comptes de produits ou de vente non classés 7 (ex: 75, 77, 78...)
  const tousProduits = await query("SELECT substr(compte, 1, 2) as prefix, SUM(credit) - SUM(debit) as solde, COUNT(*) as nb FROM journal WHERE compte LIKE '7%' GROUP BY substr(compte, 1, 2)");
  console.table(tousProduits);

  // Vérifier s'il y a des écritures avec code_journal = 'VE' (Ventes)
  const journalVentes = await query("SELECT SUM(credit) as cr, SUM(debit) as db, (SUM(credit) - SUM(debit)) as solde, COUNT(*) as nb FROM journal WHERE code_journal = 'VE'");
  console.log('\nJournal VE (Ventes) total :', journalVentes[0]);

  const journalVentesParCompte = await query("SELECT compte, SUM(credit) as cr, SUM(debit) as db, (SUM(credit) - SUM(debit)) as solde FROM journal WHERE code_journal = 'VE' GROUP BY compte ORDER BY cr DESC LIMIT 10");
  console.table(journalVentesParCompte);

  // Vérifier l'écart mentionné par l'utilisateur : 57 506 538 - 56 440 811 = 1 065 727
  const ecart = 57506538 - 56440811;
  console.log(`\nEcart a expliquer : 57 506 538 - 56 440 811 = ${ecart} FCFA`);

  // Chercher si des écritures ou des sommes correspondent à cet écart (1 065 727 ou proche)
  const matchingEcart = await query("SELECT * FROM journal WHERE debit = ? OR credit = ? OR debit BETWEEN ? AND ? OR credit BETWEEN ? AND ?", [ecart, ecart, ecart - 100, ecart + 100, ecart - 100, ecart + 100]);
  console.log('Ecritures proches de 1 065 727 :', matchingEcart);

  // Vérifier aussi s'il y a un compte dont le solde vaut environ 1 065 727
  const soldesComptes = await query("SELECT compte, SUM(credit) - SUM(debit) as solde FROM journal GROUP BY compte HAVING ABS(solde - ?) < 50000", [ecart]);
  console.log('Comptes proches du montant de l ecart :', soldesComptes);

  // 2. Analyser le fichier Excel d'origine s'il existe
  const excelPath = 'C:\\Users\\USER\\Downloads\\template_journal.xlsx';
  if (fs.existsSync(excelPath)) {
    console.log('\n--- Analyse du fichier template_journal.xlsx ---');
    const xlsx = require('xlsx');
    const wb = xlsx.readFile(excelPath);
    console.log('Feuilles Excel :', wb.SheetNames);
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(sheet);
      console.log(`Feuille ${sheetName} : ${data.length} lignes`);
      let sumCredit70 = 0;
      let sumDebit70 = 0;
      let sumCreditAll7 = 0;
      let sumDebitAll7 = 0;
      let totalVentes = 0;
      data.forEach(r => {
        const compte = String(r['Compte'] || r['compte'] || r['N° Compte'] || r['Compte Général'] || '').trim();
        const cr = parseFloat(r['Crédit'] || r['Credit'] || r['credit'] || r['Montant Crédit'] || 0) || 0;
        const db = parseFloat(r['Débit'] || r['Debit'] || r['debit'] || r['Montant Débit'] || 0) || 0;
        if (compte.startsWith('70')) {
          sumCredit70 += cr;
          sumDebit70 += db;
        }
        if (compte.startsWith('7')) {
          sumCreditAll7 += cr;
          sumDebitAll7 += db;
        }
      });
      console.log(`Feuille ${sheetName} - Solde 70% : ${sumCredit70 - sumDebit70}`);
      console.log(`Feuille ${sheetName} - Solde 7% : ${sumCreditAll7 - sumDebitAll7}`);
    }
  } else {
    console.log('Fichier template_journal.xlsx non trouve a', excelPath);
  }

  db.close();
}

run().catch(console.error);
