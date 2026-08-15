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

console.log('Total rows loaded:', data.length);

const parsed = [];
let totalDebit = 0;
let totalCredit = 0;

data.forEach((row, i) => {
  const normRow = {};
  for(let key in row) {
     const normKey = key.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
     normRow[normKey] = row[key];
  }

  const code_journal = normRow['codejournal'] || '';
  const poste_budgetaire = normRow['postebudgetaire'] || '';
  const date = normalizeDate(normRow['date']);
  const compte = String(normRow['compte'] || normRow['comptegeneral'] || normRow['ncompte'] || normRow['numcompte'] || normRow['comptecomptable'] || '');
  const compte_tiers = String(normRow['comptetiers'] || '');
  const libelle = normRow['libelle'] || normRow['libelleecriture'] || normRow['designation'] || normRow['description'] || '';
  const n_facture = String(normRow['nfacture'] || normRow['numfacture'] || '');
  const reference = String(normRow['reference'] || '');
  const debit = parseFloat(normRow['debit']) || parseFloat(normRow['montantdebit']) || 0;
  const credit = parseFloat(normRow['credit']) || parseFloat(normRow['montantcredit']) || 0;

  totalDebit += debit;
  totalCredit += credit;

  if (i < 5) {
    console.log(`Row ${i+1}:`, { code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference, debit, credit });
  }
});

console.log(`\nTotal Debit: ${totalDebit}, Total Credit: ${totalCredit}, Gap: ${Math.abs(totalDebit - totalCredit)}`);
