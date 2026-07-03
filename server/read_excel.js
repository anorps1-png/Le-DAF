const xlsx = require('xlsx');
const path = 'C:\\Users\\USER\\Desktop\\ANCIEN DD\\Docs excel\\Compta 25.xlsx';

try {
  const workbook = xlsx.readFile(path);
  const sheetName = workbook.SheetNames[0];
  const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
  
  if (data.length > 0) {
    console.log("Headers:");
    console.log(data[0]);
    console.log("First row of data:");
    console.log(data[1]);
  } else {
    console.log("Empty sheet");
  }
} catch (e) {
  console.error("Error reading file:", e.message);
}
