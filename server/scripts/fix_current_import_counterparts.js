const db = require('./db.js');

db.serialize(() => {
  db.run("BEGIN TRANSACTION");

  // 1. Delete synthetic regularisation row(s)
  db.run("DELETE FROM journal WHERE compte = '401100' OR compte_tiers = 'FOURNISSEUR RÉGULARISATION' OR n_facture = 'REG-AUTO'", function(err) {
    if (err) {
      console.error("Error deleting regularisation rows:", err);
      db.run("ROLLBACK");
      process.exit(1);
    }
    console.log(`Deleted ${this.changes} synthetic regularisation line(s).`);
  });

  // 2. Select all caisse debit rows lacking a 571 counterpart
  db.all(
    `SELECT id, code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference, debit 
     FROM journal 
     WHERE (code_journal LIKE '%CAIS%' OR code_journal = 'CA') AND debit > 0`,
    [],
    (err, rows) => {
      if (err) {
        console.error("Error fetching caisse rows:", err);
        db.run("ROLLBACK");
        process.exit(1);
      }

      console.log(`Found ${rows.length} caisse debit rows to evaluate.`);

      const stmt = db.prepare(`
        INSERT INTO journal (code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference, debit, credit)
        VALUES (?, ?, ?, '571100', ?, ?, ?, ?, 0, ?)
      `);

      let added = 0;
      let totalAmount = 0;

      rows.forEach(r => {
        // Create counterpart Caisse 571100 line
        const libelleCounterpart = `Règlement Caisse (${r.compte_tiers || 'Tiers'}) - ${r.libelle}`;
        stmt.run(
          r.code_journal,
          r.poste_budgetaire || 'CAISSE',
          r.date,
          r.compte_tiers,
          libelleCounterpart,
          r.n_facture,
          r.reference,
          r.debit
        );
        added++;
        totalAmount += r.debit;
      });

      stmt.finalize(err2 => {
        if (err2) {
          console.error("Error inserting counterparts:", err2);
          db.run("ROLLBACK");
          process.exit(1);
        }

        db.run("COMMIT", err3 => {
          if (err3) {
            console.error("Error committing transaction:", err3);
            process.exit(1);
          }
          console.log(`Successfully added ${added} real Caisse (571100) counterpart lines for a total of ${totalAmount.toLocaleString()} FCFA!`);

          db.get("SELECT COUNT(*) as total, SUM(debit) as d, SUM(credit) as c FROM journal", [], (e, res) => {
            console.log(`Final DB status -> Total lines: ${res.total}, Total Debit: ${res.d}, Total Credit: ${res.c}, Gap: ${Math.abs(res.d - res.c)}`);
            process.exit(0);
          });
        });
      });
    }
  );
});
