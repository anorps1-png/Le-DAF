const sqlite3 = require('sqlite3').verbose();
const dbPath = 'C:/Users/USER/Desktop/Compta 26.sqlite';
const db = new sqlite3.Database(dbPath);

db.all("SELECT name, sql FROM sqlite_master WHERE type='table'", (err, rows) => {
  if (err) console.error(err);
  else {
    console.log('Tables:');
    rows.forEach(r => console.log(r.name));
  }
  db.close();
});
