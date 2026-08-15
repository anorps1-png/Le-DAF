const db = require('./db.js');

db.serialize(() => {
  db.get("SELECT COUNT(*) as count FROM journal", [], (err, row) => {
    if (err) { console.error(err); return; }
    console.log('Total entries in journal:', row.count);
  });

  db.all("SELECT id, code_journal, date, compte, compte_tiers, libelle, debit, credit FROM journal WHERE libelle LIKE '%Régularisation%' OR (code_journal IN ('CA', 'CAISPR') AND compte='40100000')", [], (err, rows) => {
    if (err) { console.error(err); return; }
    console.log('Special/Unbalanced Caisse/Regularisation rows count:', rows.length);
    console.log('First 10 sample rows:');
    console.log(rows.slice(0, 10));
  });

  db.get("SELECT SUM(debit) as d, SUM(credit) as c FROM journal", [], (err, row) => {
    if (err) { console.error(err); return; }
    console.log(`Current DB Totals -> Debit: ${row.d}, Credit: ${row.c}, Gap: ${Math.abs(row.d - row.c)}`);
  });
});
