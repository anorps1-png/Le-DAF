const fs = require('fs');
const xlsx = require('xlsx');

// 1. Inspect Excel file sheets
const excelPath = "C:\\Users\\LA TCHAUX HOTEL\\Downloads\\DSF_Normal_DGIFORMAT_VERROUILLEVF.xlsx";
if (fs.existsSync(excelPath)) {
  const wb = xlsx.readFile(excelPath, { bookSheets: true });
  console.log('--- EXCEL DSF SHEETS ---');
  console.log('Sheet names count:', wb.SheetNames.length);
  console.log('Sheet names:', wb.SheetNames);
} else {
  console.log('Excel file not found at:', excelPath);
}
