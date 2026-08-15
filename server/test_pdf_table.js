const PDFDocument = require('pdfkit');
const fs = require('fs');

const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
const writeStream = fs.createWriteStream('test_table_output.pdf');
doc.pipe(writeStream);

// Header
doc.fontSize(16).fillColor('#0f172a').text('BALANCE GÉNÉRALE DES COMPTES', { align: 'center' });
doc.fontSize(9).fillColor('#64748b').text('Format Sage 100 / SYSCOHADA — Exécution Réelle', { align: 'center' });
doc.moveDown(1);

// Table geometry
const startX = 30;
let startY = doc.y;
const colWidths = [80, 260, 110, 110, 110, 110]; // Total = 780pt (A4 landscape width = 841.89)

// Draw Header Box
doc.rect(startX, startY, 780, 25).fillAndStroke('#f1f5f9', '#cbd5e1');
doc.fillColor('#0f172a').fontSize(9).font('Helvetica-Bold');

let currX = startX;
const headers = ['N° Compte', 'Intitulé des comptes', 'Mvt Débit', 'Mvt Crédit', 'Solde Débiteur', 'Solde Créditeur'];
headers.forEach((h, i) => {
  const align = i >= 2 ? 'right' : 'left';
  doc.text(h, currX + 5, startY + 7, { width: colWidths[i] - 10, align });
  currX += colWidths[i];
});

startY += 25;

// Sample Row
const sampleRows = [
  { compte: '40100000', label: 'FOURNISSEURS D\'EXPLOITATION', d: 14695185, c: 14695185, sd: 0, sc: 0 },
  { compte: '42200000', label: 'PERSONNEL, RÉMUNÉRATIONS DUES', d: 101000, c: 101000, sd: 0, sc: 0 },
  { compte: '571100', label: 'CAISSE PRINCIPALE', d: 14695185, c: 14695185, sd: 0, sc: 0 },
];

doc.font('Helvetica').fontSize(8.5);

sampleRows.forEach(r => {
  doc.rect(startX, startY, 780, 20).stroke('#e2e8f0');
  let x = startX;
  doc.fillColor('#1e293b').text(r.compte, x + 5, startY + 5, { width: colWidths[0] - 10, align: 'left' });
  x += colWidths[0];
  doc.text(r.label, x + 5, startY + 5, { width: colWidths[1] - 10, align: 'left' });
  x += colWidths[1];
  doc.text(r.d ? r.d.toLocaleString() : '', x + 5, startY + 5, { width: colWidths[2] - 10, align: 'right' });
  x += colWidths[2];
  doc.text(r.c ? r.c.toLocaleString() : '', x + 5, startY + 5, { width: colWidths[3] - 10, align: 'right' });
  x += colWidths[3];
  doc.text(r.sd ? r.sd.toLocaleString() : '', x + 5, startY + 5, { width: colWidths[4] - 10, align: 'right' });
  x += colWidths[4];
  doc.text(r.sc ? r.sc.toLocaleString() : '', x + 5, startY + 5, { width: colWidths[5] - 10, align: 'right' });
  
  startY += 20;
});

// Subtotal Row
doc.rect(startX, startY, 780, 22).fillAndStroke('#f8fafc', '#cbd5e1');
doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(8.5);
doc.text('40', startX + 5, startY + 6, { width: colWidths[0] - 10, align: 'left' });
doc.text('***SOUS-TOTAL FOURNISSEURS', startX + colWidths[0] + 5, startY + 6, { width: colWidths[1] - 10, align: 'left' });
doc.text('14 695 185', startX + colWidths[0] + colWidths[1] + 5, startY + 6, { width: colWidths[2] - 10, align: 'right' });
doc.text('14 695 185', startX + colWidths[0] + colWidths[1] + colWidths[2] + 5, startY + 6, { width: colWidths[3] - 10, align: 'right' });

doc.end();

writeStream.on('finish', () => {
  console.log('PDF table generated successfully!');
  process.exit(0);
});
