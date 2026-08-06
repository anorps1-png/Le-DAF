const fs = require('fs');
const { PDFParse } = require('pdf-parse');

(async () => {
  const filePath = 'C:\\Users\\USER\\Desktop\\ANCIEN DD\\PDF\\Plan Comptable OHADA.pdf';
  const buffer = fs.readFileSync(filePath);
  console.log('buffer size:', buffer.length);
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    console.log('numpages:', result.pages ? result.pages.length : 'n/a');
    console.log('text length:', result.text ? result.text.length : 'NO TEXT FIELD');
    console.log('first 2000 chars:', JSON.stringify((result.text || '').slice(0, 2000)));
  } catch (e) {
    console.error('ERROR:', e.message);
  } finally {
    await parser.destroy();
  }
})();
