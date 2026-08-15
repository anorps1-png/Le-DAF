const PDFDocument = require('pdfkit');
const fs = require('fs');

const doc = new PDFDocument({ margin: 30, size: 'A4' });
const writeStream = fs.createWriteStream('test_output.pdf');
doc.pipe(writeStream);

doc.fontSize(16).text('BALANCE GÉNÉRALE DES COMPTES SYSCOHADA', { align: 'center' });
doc.fontSize(10).text('Généré par Agent DAF / Le-DAF', { align: 'center' });
doc.moveDown();

doc.fontSize(10).text('Compte | Intitulé | Debit | Credit | Solde D | Solde C', { underline: true });
doc.moveDown(0.5);

doc.text('40100000 | FOURNISSEURS D\'EXPLOITATION | 14 695 185 | 14 695 185 | 0 | 0');
doc.text('571100   | CAISSE PRINCIPALE             | 14 695 185 | 14 695 185 | 0 | 0');

doc.end();

writeStream.on('finish', () => {
  console.log('PDF generated successfully!');
  process.exit(0);
});
