// One-off correction: 6 invoices imported before the business-rule fix had their charge line
// booked to 40100000 (Fournisseurs) instead of the correct classe-6 nature account, because the
// ML memory had learned a corrupted rule for common tokens ("ets", "sur"...). The counterpart
// (401100), payment and treasury lines of these same pieces are correct and untouched — only the
// mis-booked charge line's compte is corrected here, matching what the fixed classification engine
// now returns for the same libellé.
const db = require('./db.js');

const corrections = [
  { id: 1568, newCompte: '605100' }, // Achat papier echo et draps d'examen - REYNA EQUIPMENTS AND EVENT SARL
  { id: 1572, newCompte: '601100' }, // Achat accessoires de plomberie - ETS PLOMBERIE MODERNE EL HADJ
  { id: 1576, newCompte: '628100' }, // Abonnement canal + access - MELSAT (fact. 004667)
  { id: 1580, newCompte: '628100' }, // Abonnement canal + access - MELSAT (fact. 004518)
  { id: 1584, newCompte: '603200' }, // Achat compresseur clim - EJECO-FROID
  { id: 1588, newCompte: '601100' }, // Achat tube neon led - APOGEE ECLAIRAGE
];

db.serialize(() => {
  db.run('BEGIN TRANSACTION');
  const stmt = db.prepare('UPDATE journal SET compte = ? WHERE id = ? AND compte = ?');
  let errorOccurred = false;
  corrections.forEach(c => {
    stmt.run(c.newCompte, c.id, '40100000', function (err) {
      if (err) { errorOccurred = true; console.error('update error', c.id, err); }
      else if (this.changes !== 1) { errorOccurred = true; console.error('unexpected changes count for id', c.id, this.changes); }
    });
  });
  stmt.finalize(() => {
    if (errorOccurred) {
      db.run('ROLLBACK', () => { console.log('ROLLED BACK due to error'); process.exit(1); });
    } else {
      db.run('COMMIT', () => {
        console.log('Reclassification appliquée avec succès pour', corrections.length, 'lignes.');
        process.exit(0);
      });
    }
  });
});
