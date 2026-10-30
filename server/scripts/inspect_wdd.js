const fs = require('fs');

const wddPath = 'C:\\Program Files\\HOSPIT\\HOSPIT.wdd';
if (fs.existsSync(wddPath)) {
  const buf = fs.readFileSync(wddPath);
  // Extract ASCII strings >= 4 chars
  const str = buf.toString('latin1');
  const matches = str.match(/[A-Za-z0-9_]{3,40}/g) || [];
  
  // Look for table names or relevant keywords
  const interesting = new Set();
  const keywords = ['VENTE', 'FACTURE', 'CAISSE', 'RECETTE', 'PATIENT', 'ACTE', 'JOURNAL', 'COMPTA', 'DEVI', 'REGLEMENT', 'ENCAISSE', 'PHARMACIE', 'HOSPIT', 'CONSULT'];
  
  for (const m of matches) {
    const upper = m.toUpperCase();
    for (const kw of keywords) {
      if (upper.includes(kw)) {
        interesting.add(upper);
      }
    }
  }
  console.log('Tables / Champs trouves dans HOSPIT.wdd :');
  console.log(Array.from(interesting).slice(0, 80));
} else {
  console.log('wdd not found');
}
