const db = require('./db');

// --- LETTRAGE AUTOMATIQUE ---
async function performAutoLettrage() {
  // Récupérer toutes les écritures non lettrées sur les comptes de tiers (Classe 4 : 401*, 411*)
  const lines = await db.runSelect(`
    SELECT id, date, compte, compte_tiers, libelle, n_facture, reference, debit, credit, statut_lettrage
    FROM journal
    WHERE (compte LIKE '4%' OR compte_tiers LIKE '4%')
      AND (statut_lettrage IS NULL OR statut_lettrage = 'non_lettre' OR statut_lettrage = 'partiel')
    ORDER BY compte ASC, date ASC, id ASC
  `);

  if (!lines || lines.length === 0) {
    return { countMatched: 0, message: "Aucune écriture non lettrée disponible sur les comptes de tiers." };
  }

  // Obtenir le dernier numéro de lettrage
  const lastCodeRow = await db.runGet(`SELECT MAX(id) as max_id FROM journal WHERE code_lettrage IS NOT NULL`);
  let letterCounter = (lastCodeRow?.max_id || 0) + 1;

  let matchedCount = 0;
  const groupsByAccount = {};

  lines.forEach(l => {
    const accKey = l.compte_tiers || l.compte;
    if (!groupsByAccount[accKey]) groupsByAccount[accKey] = [];
    groupsByAccount[accKey].push(l);
  });

  for (const [acc, accLines] of Object.entries(groupsByAccount)) {
    const debits = accLines.filter(l => l.debit > 0);
    const credits = accLines.filter(l => l.credit > 0);

    // 1. Correspondance exacte par Montant et Référence / Facture
    for (const d of debits) {
      if (d._used) continue;

      const matchingCredit = credits.find(c => {
        if (c._used) return false;
        const sameAmount = Math.abs(c.credit - d.debit) < 0.01;
        const sameFacture = (d.n_facture && c.n_facture && d.n_facture === c.n_facture) ||
                            (d.reference && c.reference && d.reference === c.reference);
        return sameAmount || (sameFacture && sameAmount);
      });

      if (matchingCredit) {
        d._used = true;
        matchingCredit._used = true;

        const codeLettrage = `L-${new Date().getFullYear()}-${String(letterCounter++).padStart(4, '0')}`;
        const nowStr = new Date().toISOString();

        await db.runUpdate(`
          UPDATE journal
          SET code_lettrage = ?, statut_lettrage = 'solde', date_lettrage = ?, auteur_lettrage = 'Système (Auto)', updated_at = CURRENT_TIMESTAMP
          WHERE id IN (?, ?)
        `, [codeLettrage, nowStr, d.id, matchingCredit.id]);

        matchedCount += 2;
      }
    }
  }

  return {
    countMatched: matchedCount,
    message: matchedCount > 0 ? `${matchedCount} écritures ont été lettrées automatiquement avec succès.` : "Aucune nouvelle correspondance automatique n'a été trouvée."
  };
}

// --- LETTRAGE MANUEL DE SÉLECTION ---
async function performManuelLettrage(lineIds, username = 'Utilisateur') {
  if (!lineIds || !Array.isArray(lineIds) || lineIds.length === 0) {
    throw new Error("Veuillez sélectionner au moins une écriture à lettrer.");
  }

  const placeholders = lineIds.map(() => '?').join(',');
  const lines = await db.runSelect(`SELECT id, debit, credit FROM journal WHERE id IN (${placeholders})`, lineIds);

  const totalDebit = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (l.credit || 0), 0);

  const isSolde = Math.abs(totalDebit - totalCredit) < 0.01;
  const newStatus = isSolde ? 'solde' : 'partiel';

  const lastCodeRow = await db.runGet(`SELECT MAX(id) as max_id FROM journal WHERE code_lettrage IS NOT NULL`);
  let counter = (lastCodeRow?.max_id || 0) + 1;
  const codeLettrage = `L-${new Date().getFullYear()}-${String(counter).padStart(4, '0')}`;
  const nowStr = new Date().toISOString();

  await db.runUpdate(`
    UPDATE journal
    SET code_lettrage = ?, statut_lettrage = ?, date_lettrage = ?, auteur_lettrage = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id IN (${placeholders})
  `, [codeLettrage, newStatus, nowStr, username, ...lineIds]);

  return {
    success: true,
    codeLettrage,
    statut: newStatus,
    ecart: Math.abs(totalDebit - totalCredit),
    message: isSolde
      ? `Écritures lettrées et SOLDÉES sous le code ${codeLettrage}.`
      : `Écritures lettrées PARTIELLEMENT sous le code ${codeLettrage} (Écart: ${Math.abs(totalDebit - totalCredit).toLocaleString()} FCFA).`
  };
}

// --- ANNULATION DE LETTRAGE ---
async function cancelLettrage(codeLettrage) {
  if (!codeLettrage) throw new Error("Code de lettrage requis.");

  await db.runUpdate(`
    UPDATE journal
    SET code_lettrage = NULL, statut_lettrage = 'non_lettre', date_lettrage = NULL, auteur_lettrage = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE code_lettrage = ?
  `, [codeLettrage]);

  return { success: true, message: `Le lettrage ${codeLettrage} a été annulé avec succès.` };
}

// --- CALCUL DE LA BALANCE ÂGÉE TIERS ---
async function computeBalanceAgee(typeTiers = 'client') {
  const prefix = typeTiers === 'client' ? '411%' : '401%';

  const lines = await db.runSelect(`
    SELECT j.id, j.date, j.compte, j.compte_tiers, j.libelle, j.n_facture, j.debit, j.credit, j.date_echeance, j.statut_lettrage, t.nom as nom_tiers
    FROM journal j
    LEFT JOIN tiers t ON (j.compte_tiers = t.compte_comptable OR j.compte = t.compte_comptable)
    WHERE (j.compte LIKE ? OR j.compte_tiers LIKE ?)
      AND (j.statut_lettrage IS NULL OR j.statut_lettrage != 'solde')
    ORDER BY j.date ASC
  `);

  const today = new Date();

  const tiersMap = {};

  (lines || []).forEach(l => {
    const key = l.compte_tiers || l.compte;
    const name = l.nom_tiers || key;

    if (!tiersMap[key]) {
      tiersMap[key] = {
        compte: key,
        nom: name,
        totalDu: 0,
        nonEchu: 0,
        retard0_30: 0,
        retard31_60: 0,
        retard61_90: 0,
        retard90Plus: 0,
        factures: []
      };
    }

    const netAmount = (l.debit || 0) - (l.credit || 0);
    const amount = typeTiers === 'client' ? netAmount : -netAmount;

    tiersMap[key].totalDu += amount;

    // Calcul de l'échéance et du retard
    let dueDate = l.date_echeance ? new Date(l.date_echeance) : new Date(l.date);
    if (!l.date_echeance) {
      dueDate.setDate(dueDate.getDate() + 30); // 30 jours par défaut
    }

    const diffTime = today - dueDate;
    const retardJours = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (retardJours <= 0) {
      tiersMap[key].nonEchu += amount;
    } else if (retardJours <= 30) {
      tiersMap[key].retard0_30 += amount;
    } else if (retardJours <= 60) {
      tiersMap[key].retard31_60 += amount;
    } else if (retardJours <= 90) {
      tiersMap[key].retard61_90 += amount;
    } else {
      tiersMap[key].retard90Plus += amount;
    }

    tiersMap[key].factures.push({
      id: l.id,
      date: l.date,
      n_facture: l.n_facture || l.libelle,
      montant: amount,
      date_echeance: dueDate.toISOString().split('T')[0],
      retardJours: Math.max(0, retardJours),
      statut_lettrage: l.statut_lettrage || 'non_lettre'
    });
  });

  return Object.values(tiersMap);
}

module.exports = {
  performAutoLettrage,
  performManuelLettrage,
  cancelLettrage,
  computeBalanceAgee
};
