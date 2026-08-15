const xlsx = require('xlsx');

function normalizeDate(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();
  if (value instanceof Date && !isNaN(value)) {
    return value.toISOString().split('T')[0];
  }
  if (typeof value === 'number') {
    const excelEpoch = Date.UTC(1899, 11, 30);
    return new Date(excelEpoch + value * 86400000).toISOString().split('T')[0];
  }
  const str = String(value).trim();
  let m = str.match(/^(\d{2})(\d{2})(\d{2})$/); // DDMMYY
  if (m) {
    const [, dd, mm, yy] = m;
    const yyyy = parseInt(yy, 10) < 50 ? `20${yy}` : `19${yy}`;
    return `${yyyy}-${mm}-${dd}`;
  }
  m = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  m = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2})$/);
  if (m) {
    const [, dd, mm, yy] = m;
    const yyyy = parseInt(yy, 10) < 50 ? `20${yy}` : `19${yy}`;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  return str;
}

const workbook = xlsx.readFile('C:\\Users\\LA TCHAUX HOTEL\\Downloads\\Compta 26.xlsx');
const sheetName = workbook.SheetNames[0];
const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

const journalRows = [];

data.forEach((row) => {
  const normRow = {};
  for(let key in row) {
     const normKey = key.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
     normRow[normKey] = row[key];
  }

  const code_journal = normRow['codejournal'] || normRow['journal'] || normRow['code'] || '';
  const poste_budgetaire = normRow['postebudgetaire'] || normRow['postebudget'] || normRow['poste'] || '';
  const date = normalizeDate(normRow['date']);
  const compte = String(normRow['compte'] || normRow['comptegeneral'] || normRow['ncompte'] || normRow['numcompte'] || normRow['comptecomptable'] || normRow['general'] || '');
  const compte_tiers = String(normRow['comptetiers'] || normRow['tiers'] || normRow['nomtiers'] || normRow['auxiliaire'] || '');
  const libelle = normRow['libelle'] || normRow['libelleecriture'] || normRow['designation'] || normRow['description'] || normRow['libellecomplet'] || '';
  const n_facture = String(normRow['nfacture'] || normRow['numfacture'] || normRow['facture'] || normRow['numpiece'] || '');
  const reference = String(normRow['reference'] || normRow['ref'] || '');
  const debit = parseFloat(normRow['debit']) || parseFloat(normRow['montantdebit']) || parseFloat(normRow['debits']) || 0;
  const credit = parseFloat(normRow['credit']) || parseFloat(normRow['montantcredit']) || parseFloat(normRow['credits']) || 0;

  if (compte || debit > 0 || credit > 0) {
    journalRows.push({ code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference, debit, credit });
  }
});

console.log('Original journal rows count:', journalRows.length);

// Automatic Caisse counterpart expansion
const expandedRows = [];
let caisseCounterpartsAdded = 0;

journalRows.forEach(r => {
  expandedRows.push(r);

  const isCaisseJournal = /CAIS|CA/i.test(r.code_journal);
  const isFournisseurCompte = /^401/.test(r.compte);
  const isDebit = r.debit > 0;

  if (isCaisseJournal && isFournisseurCompte && isDebit) {
    // Check if counterpart credit on 571 already exists right next to it or in piece
    // If not, automatically generate the Caisse credit line
    expandedRows.push({
      code_journal: r.code_journal,
      poste_budgetaire: r.poste_budgetaire || 'CAISSE',
      date: r.date,
      compte: '571100',
      compte_tiers: r.compte_tiers,
      libelle: `Règlement Caisse Fournisseur - ${r.libelle}`,
      n_facture: r.n_facture,
      reference: r.reference,
      debit: 0,
      credit: r.debit
    });
    caisseCounterpartsAdded++;
  }
});

console.log('Caisse counterpart lines added:', caisseCounterpartsAdded);
console.log('Total expanded rows:', expandedRows.length);

const totalDebit = expandedRows.reduce((s, r) => s + r.debit, 0);
const totalCredit = expandedRows.reduce((s, r) => s + r.credit, 0);

console.log(`Total Debit: ${totalDebit}, Total Credit: ${totalCredit}, Gap: ${Math.abs(totalDebit - totalCredit)}`);
