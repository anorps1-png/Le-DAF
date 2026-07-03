const db = require('./db');

db.all("SELECT substr(date, 3, 2) as mois, COUNT(*) as c FROM journal GROUP BY mois ORDER BY mois", (err, rows) => {
  if (err) console.error(err);
  else console.log(rows);
});
