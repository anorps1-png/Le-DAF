const db = require('./db');

const stopWords = ['and', 'mai', 'paiement', 'reyna', 'wanesi', 'event', 'fils', 'societe', 'sarl', 'siege', 'social', 'mensuel', 'vehicules', 'service', 'comptable', 'bouteilles', 'oxygene'];

db.serialize(() => {
  stopWords.forEach(word => {
    db.run("DELETE FROM business_rules WHERE LOWER(pattern) = ? AND auto_learned = 1", [word]);
  });
  console.log("Noisy ML rules cleaned up!");
});
