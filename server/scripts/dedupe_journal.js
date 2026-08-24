// One-off migration: the journal table contains the full journal imported 3 times in a row
// (497 groups tripled, 6 groups that legitimately repeat twice in the source data now appear 6x).
// This script keeps only the earliest (lowest-id) copy of each redundant import batch.
// A full backup is taken by the caller before running this script.
const db = require('./db.js');

db.serialize(() => {
  db.all(
    `SELECT date,compte,compte_tiers,libelle,n_facture,reference,code_journal,debit,credit,
            COUNT(*) as cnt, GROUP_CONCAT(id) as ids
     FROM journal
     GROUP BY date,compte,compte_tiers,libelle,n_facture,reference,code_journal,debit,credit
     HAVING cnt > 1`,
    [],
    (err, groups) => {
      if (err) { console.error(err); process.exit(1); }

      let toDelete = [];
      let keepCount = 0;
      for (const g of groups) {
        const ids = g.ids.split(',').map(Number).sort((a, b) => a - b);
        const keepN = g.cnt / 3;
        if (!Number.isInteger(keepN)) {
          console.error('UNEXPECTED non-multiple-of-3 group, aborting:', JSON.stringify(g));
          process.exit(1);
        }
        keepCount += keepN;
        toDelete = toDelete.concat(ids.slice(keepN));
      }
      console.log('Groups:', groups.length, '- ids to delete:', toDelete.length, '- ids kept from these groups:', keepCount);

      db.run('BEGIN TRANSACTION');
      const stmt = db.prepare('DELETE FROM journal WHERE id = ?');
      let errorOccurred = false;
      for (const id of toDelete) {
        stmt.run(id, (err) => { if (err) { errorOccurred = true; console.error('delete error', id, err); } });
      }
      stmt.finalize(() => {
        if (errorOccurred) {
          db.run('ROLLBACK', () => { console.log('ROLLED BACK due to error'); process.exit(1); });
        } else {
          db.run('COMMIT', () => {
            db.get('SELECT COUNT(*) as c FROM journal', [], (e, r) => {
              console.log('Final row count:', r.c);
              process.exit(0);
            });
          });
        }
      });
    }
  );
});
