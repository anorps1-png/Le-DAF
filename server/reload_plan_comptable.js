// One-off fix: knowledge_docs id=6 ("Plan-Comptable-OHADA-Reference.pdf") ended up with empty
// content (0 chars) even though the source file extracts cleanly (verified via test_pdf_extract.js
// — 63 572 chars, well-structured "10 Capital / • 101 Capital social / - 1011 Capital souscrit...").
// Deletes the empty row and re-inserts it with properly extracted content, WITHOUT going through
// the /api/memory/upload-doc HTTP route (which also auto-extracts business_rules from every 2/6/7
// -class account mention in the text — appropriate for a short procedure note, but this file is the
// entire official OHADA chart of accounts, so that side effect would flood business_rules with
// thousands of generic-word rules). Only knowledge_docs.content needs to change here; the account
// LABEL mapping is rebuilt separately by /api/memory/chart-of-accounts/refresh.
const fs = require('fs');
const { PDFParse } = require('pdf-parse');
const db = require('./db.js');

const FILE_PATH = 'C:\\Users\\USER\\Desktop\\ANCIEN DD\\PDF\\Plan Comptable OHADA.pdf';

(async () => {
  const buffer = fs.readFileSync(FILE_PATH);
  const parser = new PDFParse({ data: buffer });
  let text;
  try {
    const result = await parser.getText();
    text = result.text;
  } finally {
    await parser.destroy();
  }

  if (!text || !text.trim()) {
    console.error('Extraction toujours vide, abandon.');
    process.exit(1);
  }
  console.log('Texte extrait :', text.length, 'caractères');

  db.serialize(() => {
    db.run("DELETE FROM knowledge_docs WHERE id = 6");
    db.run("DELETE FROM business_rules WHERE doc_id = 6");
    db.run(
      "INSERT INTO knowledge_docs (id, title, filename, file_type, content, category) VALUES (6, ?, ?, ?, ?, ?)",
      ['Plan-Comptable-OHADA-Reference.pdf', 'Plan Comptable OHADA.pdf', 'application/pdf', text, 'Guide Imputation'],
      (err) => {
        if (err) { console.error(err); process.exit(1); }
        console.log('Document ré-inséré avec succès (id=6).');
        process.exit(0);
      }
    );
  });
})();
