const xlsx = require('xlsx');
const db = require('./db.js');
const { computeEtatsFinanciers } = require('./ohadaRules.js');

async function testExport() {
  try {
    const journalRows = await db.runSelect("SELECT * FROM journal ORDER BY date ASC, id ASC");
    const balanceRows = await db.runSelect(`
      SELECT compte, SUM(debit) as total_debit, SUM(credit) as total_credit
      FROM journal
      GROUP BY compte
      ORDER BY compte ASC
    `);

    const { bilan, resultat } = computeEtatsFinanciers(balanceRows);

    const wb = xlsx.utils.book_new();

    // 1. BILAN SYSCOHADA
    const bilanAoa = [
      ["BILAN SYSCOHADA (FCFA)"],
      ["ACTIF", "Brut", "Amort./Dép.", "Net", "", "PASSIF", "Net"],
      ["ACTIF IMMOBILISÉ", "", "", "", "", "CAPITAUX PROPRES & RESSOURCES STABLES", ""],
      ["Immobilisations Incorporelles", bilan.actif.immobilisationsIncorporelles.brut, bilan.actif.immobilisationsIncorporelles.amort, bilan.actif.immobilisationsIncorporelles.net, "", "Capital, Réserves & Reports", bilan.passif.capitalEtReserves],
      ["Immobilisations Corporelles", bilan.actif.immobilisationsCorporelles.brut, bilan.actif.immobilisationsCorporelles.amort, bilan.actif.immobilisationsCorporelles.net, "", "Résultat Net de l'exercice", bilan.passif.resultatNet],
      ["Immobilisations Financières", bilan.actif.immobilisationsFinancieres.brut, bilan.actif.immobilisationsFinancieres.amort, bilan.actif.immobilisationsFinancieres.net, "", "TOTAL CAPITAUX PROPRES", bilan.passif.totalCapitauxPropres],
      ["TOTAL ACTIF IMMOBILISÉ", bilan.actif.totalImmobilisationsNettes, 0, bilan.actif.totalImmobilisationsNettes, "", "", ""],
      ["ACTIF CIRCULANT", "", "", "", "", "PASSIF CIRCULANT", ""],
      ["Stocks & En-cours", bilan.actif.stocks.brut, bilan.actif.stocks.amort, bilan.actif.stocks.net, "", "Dettes Fournisseurs & Comptes rattachés", bilan.passif.dettesFournisseurs],
      ["Créances Clients & Comptes rattachés", bilan.actif.creancesClients.brut, bilan.actif.creancesClients.amort, bilan.actif.creancesClients.net, "", "Dettes Fiscales & Sociales", bilan.passif.dettesFiscalesSociales],
      ["Autres Créances", bilan.actif.autresCreances, 0, bilan.actif.autresCreances, "", "Autres Dettes Circulantes", bilan.passif.autresDettes],
      ["TOTAL ACTIF CIRCULANT", bilan.actif.totalActifCirculant, 0, bilan.actif.totalActifCirculant, "", "TOTAL PASSIF CIRCULANT", bilan.passif.totalPassifCirculant],
      ["TRÉSORERIE ACTIF", "", "", "", "", "TRÉSORERIE PASSIF", ""],
      ["Banques, Chèques, Caisse", bilan.actif.tresorerieActif, 0, bilan.actif.tresorerieActif, "", "Banques, Découverts & Concours bancaires", bilan.passif.tresoreriePassif],
      ["TOTAL TRÉSORERIE ACTIF", bilan.actif.tresorerieActif, 0, bilan.actif.tresorerieActif, "", "TOTAL TRÉSORERIE PASSIF", bilan.passif.tresoreriePassif],
      ["TOTAL GÉNÉRAL ACTIF", "", "", bilan.actif.totalActif, "", "TOTAL GÉNÉRAL PASSIF", bilan.passif.totalPassif]
    ];
    const wsBilan = xlsx.utils.aoa_to_sheet(bilanAoa);
    xlsx.utils.book_append_sheet(wb, wsBilan, "Bilan_SYSCOHADA");

    // 2. COMPTE DE RÉSULTAT
    const resultatAoa = [
      ["COMPTE DE RÉSULTAT SYSCOHADA (SIG)"],
      ["Libellé du poste", "Montant (FCFA)"],
      ["Chiffre d'Affaires (Ventes 70)", resultat.chiffreAffaires],
      ["- Achats Consommés de marchandises & matières (60)", resultat.achatsConsommes],
      ["= MARGE BRUTE D'EXPLOITATION", resultat.chiffreAffaires - resultat.achatsConsommes],
      ["- Consommations Extérieures (61 à 65)", resultat.consommationsExternes],
      ["= VALEUR AJOUTÉE", resultat.valeurAjoutee],
      ["- Charges de Personnel (66)", resultat.chargesPersonnel],
      ["= EXCÉDENT BRUT D'EXPLOITATION (EBE)", resultat.excedentBrutExploitation],
      ["- Dotations aux Amortissements & Provisions (68)", resultat.dotationsExploitation],
      ["= RÉSULTAT D'EXPLOITATION", resultat.resultatExploitation],
      ["+ Résultat Financier", resultat.resultatFinancier],
      ["+ Résultat HAO (Hors Activités Ordinaires)", resultat.resultatHAO],
      ["- Impôts sur les bénéfices (89)", resultat.impotBefices],
      ["= RÉSULTAT NET DE L'EXERCICE", resultat.resultatNet]
    ];
    const wsResultat = xlsx.utils.aoa_to_sheet(resultatAoa);
    xlsx.utils.book_append_sheet(wb, wsResultat, "Compte_de_Resultat");

    // 3. BALANCE GÉNÉRALE
    const balanceAoa = [
      ["BALANCE GÉNÉRALE DES COMPTES SYSCOHADA"],
      ["Compte", "Intitulé", "Cumul Débit", "Cumul Crédit", "Solde Débiteur", "Solde Créditeur"]
    ];
    balanceRows.forEach(r => {
      const solde = (r.total_debit || 0) - (r.total_credit || 0);
      balanceAoa.push([
        r.compte,
        "Compte " + r.compte,
        r.total_debit || 0,
        r.total_credit || 0,
        solde > 0 ? solde : 0,
        solde < 0 ? Math.abs(solde) : 0
      ]);
    });
    const wsBalance = xlsx.utils.aoa_to_sheet(balanceAoa);
    xlsx.utils.book_append_sheet(wb, wsBalance, "Balance_Generale");

    // 4. JOURNAL GÉNÉRAL
    const journalAoa = [
      ["JOURNAL GÉNÉRAL DES ÉCRITURES"],
      ["ID", "Date", "Code Journal", "Budget", "N° Compte", "Compte Tiers", "Libellé écriture", "N° Facture", "Référence", "Débit", "Crédit"]
    ];
    journalRows.forEach(r => {
      journalAoa.push([
        r.id,
        r.date,
        r.code_journal,
        r.poste_budgetaire,
        r.compte,
        r.compte_tiers,
        r.libelle,
        r.n_facture,
        r.reference,
        r.debit || 0,
        r.credit || 0
      ]);
    });
    const wsJournal = xlsx.utils.aoa_to_sheet(journalAoa);
    xlsx.utils.book_append_sheet(wb, wsJournal, "Journal_General");

    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    console.log("Export test generated workbook buffer size:", buf.length, "bytes");
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

testExport();
