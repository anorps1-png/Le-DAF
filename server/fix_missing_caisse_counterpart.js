// One-off correction: 192 historical règlements (avances versées aux fournisseurs après réception
// de facture, confirmé par l'utilisateur) ne débitent que le compte Fournisseurs (40100000) sous
// le journal CA, sans jamais créditer la Caisse en contrepartie — 14 594 185 FCFA de paiements
// jamais reflétés comme sortie de trésorerie. Ce script ajoute la ligne de contrepartie manquante
// (crédit 571100, même date, même montant) pour chacune, et regroupe chaque paire sous un piece_id
// dédié pour que l'équilibre débit=crédit soit vérifiable écriture par écriture (voir /api/audit).
const db = require('./db.js');

db.serialize(() => {
  db.get("SELECT COALESCE(MAX(piece_id), 0) as maxId FROM journal", [], (err, row) => {
    if (err) { console.error(err); process.exit(1); }
    let pieceCounter = row.maxId || 0;

    db.all(
      "SELECT id, date, compte_tiers, libelle, n_facture, reference, debit FROM journal WHERE code_journal='CA' AND compte='40100000' AND debit > 0 ORDER BY id",
      [],
      (err2, rows) => {
        if (err2) { console.error(err2); process.exit(1); }
        console.log('Lignes à compléter:', rows.length);

        db.run('BEGIN TRANSACTION');
        const updatePiece = db.prepare('UPDATE journal SET piece_id = ? WHERE id = ?');
        const insertLine = db.prepare(`
          INSERT INTO journal (code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference, debit, credit, piece_id)
          VALUES ('CA', '', ?, '571100', ?, ?, ?, ?, 0, ?, ?)
        `);

        let total = 0;
        rows.forEach(r => {
          pieceCounter++;
          updatePiece.run(pieceCounter, r.id);
          insertLine.run(
            r.date,
            r.compte_tiers,
            `Mouvement de caisse (avance/règlement fournisseur - contrepartie automatique) - ${r.libelle}`,
            r.n_facture,
            r.reference,
            r.debit,
            pieceCounter
          );
          total += r.debit;
        });

        updatePiece.finalize();
        insertLine.finalize(err3 => {
          if (err3) {
            db.run('ROLLBACK', () => { console.error(err3); process.exit(1); });
            return;
          }
          db.run('COMMIT', err4 => {
            if (err4) { console.error(err4); process.exit(1); }
            console.log('Terminé. Lignes de contrepartie créées:', rows.length, '- Montant total:', total);
            process.exit(0);
          });
        });
      }
    );
  });
});
