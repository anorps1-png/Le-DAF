// One-off cleanup: business_rules must only ever target a charge/produit "nature" account
// (classes 2,3,6,7,8). Rules pointing at classes 1 (capitaux), 4 (tiers), 5 (trésorerie) or 9 got
// learned from raw journal/manual entries that share the same libellé across both the charge line
// and its counterpart line (see learnFromJournalData in ai.js, now filtered at the source).
const db = require('./db.js');

db.all(
  "SELECT id, pattern, target_account, occurrences, auto_learned FROM business_rules WHERE substr(target_account,1,1) IN ('1','4','5','9')",
  [],
  (err, rows) => {
    if (err) { console.error(err); process.exit(1); }
    console.log('Règles corrompues trouvées:', rows.length);
    if (rows.length === 0) { process.exit(0); }

    const ids = rows.map(r => r.id);
    db.run(
      `DELETE FROM business_rules WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids,
      function (err) {
        if (err) { console.error(err); process.exit(1); }
        console.log('Règles supprimées:', this.changes);
        process.exit(0);
      }
    );
  }
);
