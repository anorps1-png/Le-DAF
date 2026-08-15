const xlsx = require('xlsx');
const path = 'C:\\Users\\LA TCHAUX HOTEL\\Downloads\\Compta 26.xlsx';

try {
  const workbook = xlsx.readFile(path);
  console.log('Sheet names:', workbook.SheetNames);
  workbook.SheetNames.forEach(sheetName => {
    console.log(`\n--- SHEET: ${sheetName} ---`);
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
    console.log(`Total rows: ${data.length}`);
    console.log('First 15 rows:');
    console.log(JSON.stringify(data.slice(0, 15), null, 2));
  });
} catch (err) {
  console.error('Error reading Excel file:', err);
}
