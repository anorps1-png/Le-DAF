const db = require('./db');
db.serialize(() => {
  db.run('DELETE FROM journal', (err) => {
    if (err) console.error(err);
    else console.log('Journal cleared.');
    process.exit(0);
  });
});
