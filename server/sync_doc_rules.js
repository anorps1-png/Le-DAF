const db = require('./db');

db.all("SELECT id, title, content FROM knowledge_docs", (err, docs) => {
  if (err || !docs) return;

  let totalInserted = 0;

  db.serialize(() => {
    docs.forEach(doc => {
      const lines = doc.content.split('\n');
      lines.forEach(line => {
        let account = null;

        const mAccount = line.match(/(?:compte\s*)?([267]\d{3,5})/i);
        if (mAccount) {
          account = mAccount[1];
          if (account.length === 4) account = account + '00';

          let cleanLine = line
            .replace(/(?:compte|s'imputent|obligatoirement|au|du|de|la|les|des|doivent être enregistrés|s'enregistrent|et|à|dans|le|compte n°|\d{4,8}|[-*•\d\.\:\(\)])+/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();

          const keywords = cleanLine.split(/[,;/]+/);
          keywords.forEach(kw => {
            const pattern = kw.trim().toLowerCase();
            if (pattern.length >= 3 && !/^\d+$/.test(pattern) && !['achats', 'recettes', 'prestations', 'produits', 'charges'].includes(pattern)) {
              db.run(
                "INSERT OR IGNORE INTO business_rules (doc_id, pattern, condition_type, target_account, confidence_score, auto_learned, description) VALUES (?, ?, 'contains', ?, 1.00, 0, ?)",
                [doc.id, pattern, account, `Extrait directement du document "${doc.title}"`]
              );
              totalInserted++;
            }
          });
        }
      });
    });

    console.log("Document knowledge extraction complete!");
  });
});
