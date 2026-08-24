const db = require('./db.js');

db.all("SELECT compte, libelle FROM chart_of_accounts LIMIT 20", [], (err, rows) => {
  if (err) { console.error(err); return; }
  console.log('chart_of_accounts count:', rows.length);
  console.log('Sample rows:', rows.slice(0, 10));
});
