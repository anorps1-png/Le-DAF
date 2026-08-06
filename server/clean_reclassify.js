const db = require('./db');

db.serialize(() => {
  db.run("UPDATE journal SET compte = '628100' WHERE (compte = '601100' OR compte LIKE '601%') AND (LOWER(libelle) LIKE '%internet%' OR LOWER(libelle) LIKE '%fibre%' OR LOWER(libelle) LIKE '%flotte%' OR LOWER(libelle) LIKE '%orange%' OR LOWER(libelle) LIKE '%telecom%')");
  db.run("UPDATE journal SET compte = '605200' WHERE (compte = '601100' OR compte LIKE '601%') AND (LOWER(libelle) LIKE '%carburant%' OR LOWER(libelle) LIKE '%essence%' OR LOWER(libelle) LIKE '%gazole%' OR LOWER(libelle) LIKE '%total%' OR LOWER(libelle) LIKE '%cie%' OR LOWER(libelle) LIKE '%sodeci%')");
  db.run("UPDATE journal SET compte = '632100' WHERE (compte = '601100' OR compte LIKE '601%') AND (LOWER(libelle) LIKE '%loyer%' OR LOWER(libelle) LIKE '%bail%' OR LOWER(libelle) LIKE '%palmiers%' OR LOWER(libelle) LIKE '%sci%')");
  db.run("UPDATE journal SET compte = '622100' WHERE (compte = '601100' OR compte LIKE '601%') AND (LOWER(libelle) LIKE '%honoraire%' OR LOWER(libelle) LIKE '%conseil%' OR LOWER(libelle) LIKE '%audit%' OR LOWER(libelle) LIKE '%assistance%')");
  db.run("UPDATE journal SET compte = '638100' WHERE (compte = '601100' OR compte LIKE '601%') AND (LOWER(libelle) LIKE '%entretien%' OR LOWER(libelle) LIKE '%reparation%' OR LOWER(libelle) LIKE '%vidange%')");
  console.log("Existing journal entries successfully reclassified into SYSCOHADA plan!");
});
