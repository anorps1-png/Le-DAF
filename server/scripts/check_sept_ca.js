const sqlite3 = require('sqlite3').verbose();
const dbPath = 'C:/Users/USER/Desktop/Compta 26.sqlite';
const db = new sqlite3.Database(dbPath);

async function run() {
  db.get("SELECT round(sum(credit) - sum(debit), 2) as ca_net FROM journal WHERE compte LIKE '70%' AND date >= '2026-09-01' AND date <= '2026-09-30'", (err, row) => {
    console.log('Chiffre d affaires net compte 70 en Septembre 2026 dans Compta 26.sqlite :', row);
  });
}

run();
