const fs = require('fs');

const exePath = 'C:\\Program Files\\HOSPIT\\JORDAN.MEDICAL.SYSTEM.exe';
const fd = fs.openSync(exePath, 'r');
const stat = fs.statSync(exePath);
console.log('Taille exe :', stat.size);

// Read chunks and search
const chunkSize = 4 * 1024 * 1024;
const buf = Buffer.alloc(chunkSize);
let bytesRead = 0;
let offset = 0;

const targets = ['70690000', '7069', '41112001', 'HORS FACTURE', 'VTE', 'COMPTABILISATION', 'SCHEMA'];

while ((bytesRead = fs.readSync(fd, buf, 0, chunkSize, offset)) > 0) {
  const str = buf.slice(0, bytesRead).toString('latin1');
  const str16 = buf.slice(0, bytesRead).toString('utf16le');
  
  for (const t of targets) {
    if (str.includes(t)) {
      console.log(`Trouvé "${t}" (latin1) à l'offset ${offset}`);
      const idx = str.indexOf(t);
      console.log('Contexte :', str.substring(Math.max(0, idx - 80), Math.min(str.length, idx + 120)).replace(/[\r\n\x00-\x1f]/g, ' '));
    }
    if (str16.includes(t)) {
      console.log(`Trouvé "${t}" (utf16le) à l'offset ${offset}`);
      const idx = str16.indexOf(t);
      console.log('Contexte :', str16.substring(Math.max(0, idx - 80), Math.min(str16.length, idx + 120)).replace(/[\r\n\x00-\x1f]/g, ' '));
    }
  }
  offset += bytesRead - 1000;
  if (offset >= stat.size) break;
}

fs.closeSync(fd);
