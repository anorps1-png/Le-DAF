const fs = require('fs');

const wddPath = 'C:\\Program Files\\HOSPIT\\HOSPIT.wdd';
const buf = fs.readFileSync(wddPath);

// Extract UTF-16LE strings
const str16 = buf.toString('utf16le');
const matches16 = str16.match(/[A-Za-z0-9_]{3,40}/g) || [];

const interesting = new Set();
const keywords = ['VENTE', 'FACTURE', 'CAISSE', 'RECETTE', 'PATIENT', 'ACTE', 'JOURNAL', 'COMPTA', 'REGLEMENT', 'ENCAISSE', 'PHARMACIE', 'HOSPIT', 'CONSULT'];

for (const m of matches16) {
  const upper = m.toUpperCase();
  for (const kw of keywords) {
    if (upper.includes(kw)) {
      interesting.add(upper);
    }
  }
}
console.log('Tables / Champs trouves (UTF-16LE) :', interesting.size);
console.log(Array.from(interesting).slice(0, 100));
