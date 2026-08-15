const xlsx = require('xlsx');

function normalizeDate(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();
  if (value instanceof Date && !isNaN(value)) return value.toISOString().split('T')[0];
  if (typeof value === 'number') {
    const excelEpoch = Date.UTC(1899, 11, 30);
    return new Date(excelEpoch + value * 86400000).toISOString().split('T')[0];
  }
  const str = String(value).trim();
  let m = str.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (m) {
    const [, dd, mm, yy] = m;
    const yyyy = parseInt(yy, 10) < 50 ? `20${yy}` : `19${yy}`;
    return `${yyyy}-${mm}-${dd}`;
  }
  return str;
}

const workbook = xlsx.readFile('C:\\Users\\LA TCHAUX HOTEL\\Downloads\\Compta 26.xlsx');
const sheetName = workbook.SheetNames[0];
const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

const journalRows = [];

data.forEach((row, idx) => {
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
    journalRows.push({ idx: idx+1, code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference, debit, credit });
  }
});

// Group by n_facture + libelle to check imbalances per transaction
const groups = {};
journalRows.forEach(r => {
  const key = `${r.code_journal}_${r.n_facture}_${r.libelle}`;
  if (!groups[key]) groups[key] = [];
  groups[key].push(r);
});

console.log('--- Checking Imbalanced Groups ---');
Object.keys(groups).forEach(key => {
  const rows = groups[key];
  const d = rows.reduce((s, r) => s + r.debit, 0);
  const c = rows.reduce((s, r) => s + r.credit, 0);
  
  // If we add caisse counterpart for 401 debit entries in CAISPR:
  let caisseCreditAdded = 0;
  rows.forEach(r => {
    if (/CAIS|CA/i.test(r.code_journal) && /^401/.test(r.compte) && r.debit > 0) {
      caisseCreditAdded += r.debit;
    }
  });

  const finalDiff = d - (c + caisseCreditAdded);
  if (Math.abs(finalDiff) > 0.01) {
    console.log(`Group [${key}]: original D=${d}, C=${c}, caisseAdded=${caisseCreditAdded}, finalDiff=${finalDiff}`);
    console.log('Rows:', JSON.stringify(rows, null, 2));
  }
});
