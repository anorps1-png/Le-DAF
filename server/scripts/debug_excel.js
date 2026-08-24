const xlsx = require('xlsx');
const path = 'C:\\Users\\USER\\Desktop\\ANCIEN DD\\Docs excel\\Compta 25.xlsx';

try {
  const workbook = xlsx.readFile(path);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  console.log("Range:", sheet['!ref']);
  
  const data = xlsx.utils.sheet_to_json(sheet, { defval: "" });
  console.log("Total rows found by sheet_to_json:", data.length);
  
  if (data.length > 0) {
    // Check the distribution of dates or the last few rows
    let lastRows = data.slice(-5);
    console.log("Last 5 rows:");
    console.log(lastRows);
    
    // Find rows around index where it might have stopped
    let months = {};
    data.forEach((row, idx) => {
      let dateVal = row['Date'] || row['date'] || '';
      if (dateVal) {
        let monthStr = String(dateVal).substring(2, 4); // Assuming DDMMYY like '070125'
        months[monthStr] = (months[monthStr] || 0) + 1;
      }
    });
    console.log("Row count by month string (index 2-3 of Date):", months);
  }
} catch (e) {
  console.error("Error reading file:", e.message);
}
