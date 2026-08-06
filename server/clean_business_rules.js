const db = require('./db');
const { determineSyscohadaAccount } = require('./ai');

db.all("SELECT id, pattern, target_account FROM business_rules", (err, rules) => {
  if (err || !rules) return;

  let updatedCount = 0;
  db.serialize(() => {
    rules.forEach(rule => {
      const isAchat = !rule.target_account.startsWith('7');
      const sysClassif = determineSyscohadaAccount(rule.pattern, '', isAchat);
      if (sysClassif.target_account !== rule.target_account && sysClassif.target_account !== '601100' && sysClassif.target_account !== '701100') {
        db.run("UPDATE business_rules SET target_account = ?, target_journal = ? WHERE id = ?", [sysClassif.target_account, sysClassif.target_journal, rule.id]);
        console.log(`Updated Rule #${rule.id} ("${rule.pattern}"): ${rule.target_account} -> ${sysClassif.target_account}`);
        updatedCount++;
      }
    });
    console.log(`Total business_rules updated: ${updatedCount}`);
  });
});
