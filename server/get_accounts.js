const db = require('./db');
db.all('SELECT DISTINCT compte FROM journal ORDER BY compte', function(err, rows) {
  console.log(JSON.stringify(rows.map(function(r) { return String(r.compte); })));
});
