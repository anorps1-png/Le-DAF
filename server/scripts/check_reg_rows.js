const db = require('./db.js');

db.all("SELECT id, code_journal, date, compte, compte_tiers, libelle, debit, credit FROM journal WHERE libelle LIKE '%Régularisation%' OR n_facture = 'REG-AUTO' OR compte IN ('401100', '411100')", [], (err, rows) => {
  if (err) { console.error(err); return; }
  console.log('Regularisation rows:', rows);
});
