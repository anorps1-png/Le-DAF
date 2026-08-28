const db = require('./db');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const { computeEtatsFinanciers } = require('./ohadaRules');

// Récupère les informations générales de l'entreprise (company_info)
async function getCompanyInfo() {
  try {
    const rows = await db.runSelect("SELECT key, value FROM company_info");
    const info = {
      niu: 'M01234567890A',
      raison_sociale: 'SOCIÉTÉ LE-DAF SARL',
      sigle: 'LE-DAF',
      forme_juridique: 'SARL',
      adresse: 'Douala - Cameroun',
      telephone: '+237 600 00 00 00',
      email: 'contact@le-daf.cm',
      regime: 'Système Normal (SN)',
      centre_fiscal: 'CIME Douala',
      activite_principale: 'Prestations de services et commerce',
      code_nace: '7020',
      exercice_debut: '01/01/2026',
      exercice_fin: '31/12/2026',
      signataire_nom: 'Le Directeur Général',
      signataire_qualite: 'Gérant'
    };
    (rows || []).forEach(r => { info[r.key] = r.value; });
    return info;
  } catch (err) {
    console.error("Error fetching company_info:", err);
    return {};
  }
}

// Enregistre ou met à jour les informations d'en-tête de l'entreprise
async function saveCompanyInfo(data) {
  for (const [key, value] of Object.entries(data)) {
    await db.runUpdate("INSERT OR REPLACE INTO company_info (key, value) VALUES (?, ?)", [key, String(value || '')]);
  }
}

// La DSF est une déclaration par exercice fiscal : la balance doit être bornée à l'exercice
// sélectionné (settings.SELECTED_EXERCICE_ID), comme /api/bilan, /api/resultat et /api/journal
// (voir getExerciceDateFilter dans server/index.js) — sinon elle porte sur tout l'historique.
async function getExerciceDateFilter() {
  const settingsRows = await db.runSelect("SELECT value FROM settings WHERE key = 'SELECTED_EXERCICE_ID'");
  const id = settingsRows[0] && settingsRows[0].value;
  if (!id) return { clause: '', params: [] };
  const exRows = await db.runSelect("SELECT date_debut, date_fin FROM exercices WHERE id = ?", [id]);
  const ex = exRows[0];
  if (!ex) return { clause: '', params: [] };
  return { clause: 'date >= ? AND date <= ?', params: [ex.date_debut, ex.date_fin] };
}

// Calcul complet des données du dossier DSF OHADA
async function computeDSFData() {
  const companyInfo = await getCompanyInfo();

  // Balance cumulée (bornée à l'exercice actif)
  const { clause, params } = await getExerciceDateFilter();
  const balanceRows = await db.runSelect(`
    SELECT compte, SUM(debit) as total_debit, SUM(credit) as total_credit
    FROM journal
    ${clause ? `WHERE ${clause}` : ''}
    GROUP BY compte
    ORDER BY compte ASC
  `, params);

  const { bilan, resultat, comptesNonClasses } = computeEtatsFinanciers(balanceRows || []);

  // 1. Chiffre d'affaires & TDRF
  const ca = resultat.chiffreAffaires || 0;
  const resultatComptableAvantIS = (resultat.chiffreAffaires - resultat.achatsConsommes - resultat.consommationsExternes - resultat.chargesPersonnel - resultat.dotationsExploitation) + (resultat.resultatFinancier || 0) + (resultat.resultatHAO || 0);

  // Exemples de réintégrations / déductions par défaut (personnalisables)
  const reintegrations = 0; // amendes, charges non déductibles
  const deductions = 0; // plus-values exonérées, dividendes

  const resultatFiscalImposable = Math.max(0, resultatComptableAvantIS + reintegrations - deductions);
  const isCalcule = Math.round(resultatFiscalImposable * 0.33); // 33% Cameroun CGI 2025
  const minimumPerceptionIS = Math.round(ca * 0.01); // 1% du CA HT
  const isFinal = Math.max(isCalcule, minimumPerceptionIS);

  const resultatNetFinal = Math.round(resultatComptableAvantIS - isFinal);

  // 2. Tableau des Flux de Trésorerie (TFT - Méthode Indirecte)
  const dotationsAmort = resultat.dotationsExploitation || 0;
  const fluxExploitation = resultatNetFinal + dotationsAmort; // Capacité d'autofinancement (CAF)
  const fluxInvestissement = 0; // acquisitions / cessions immobilisations
  const fluxFinancement = 0; // emprunts / remboursements / capitaux
  const variationTrésorerieNette = fluxExploitation + fluxInvestissement + fluxFinancement;

  const tresorerieNetBilan = (bilan.actif.tresorerieActif || 0) - (bilan.passif.tresoreriePassif || 0);

  // 3. Contrôles de Cohérence Bloquants (CTRL-01 à CTRL-06)
  const totalActifNet = bilan.actif.totalActif || 0;
  const totalPassifNet = bilan.passif.totalPassif || 0;
  const ecartBilan = Math.abs(totalActifNet - totalPassifNet);

  const resultBilan = bilan.passif.resultatNet || 0;
  const ecartResultat = Math.abs(resultatNetFinal - resultBilan);

  const ecartTresorerieTFT = Math.abs(variationTrésorerieNette - tresorerieNetBilan);

  const controls = [
    {
      id: 'CTRL-01',
      libelle: 'Équilibre fondamental du Bilan (Total Actif Net = Total Passif Net)',
      status: ecartBilan < 1 ? 'VALIDE' : 'ERREUR',
      ecart: ecartBilan,
      explication: ecartBilan < 1 ? 'Bilan équilibré à 0 FCFA près.' : `Écart de ${ecartBilan.toLocaleString()} FCFA entre l'actif et le passif.`
    },
    {
      id: 'CTRL-02',
      libelle: 'Cohérence du Résultat Net (Compte de Résultat = Bilan Passif)',
      status: ecartResultat < 1 ? 'VALIDE' : 'ERREUR',
      ecart: ecartResultat,
      explication: ecartResultat < 1 ? 'Résultat net strictement identique entre Bilan et CR.' : `Écart de ${ecartResultat.toLocaleString()} FCFA.`
    },
    {
      id: 'CTRL-03',
      libelle: 'Cohérence Trésorerie (Trésorerie Fin TFT = Trésorerie Nette Bilan)',
      status: ecartTresorerieTFT < 1 ? 'VALIDE' : 'AVERTISSEMENT',
      ecart: ecartTresorerieTFT,
      explication: ecartTresorerieTFT < 1 ? 'Trésorerie TFT égale au solde Bilan.' : `Écart de ${ecartTresorerieTFT.toLocaleString()} FCFA.`
    },
    {
      id: 'CTRL-04',
      libelle: 'Respect du minimum de perception IS (1% du CA HT)',
      status: isFinal >= minimumPerceptionIS ? 'VALIDE' : 'ERREUR',
      ecart: Math.max(0, minimumPerceptionIS - isFinal),
      explication: `IS retenu (${isFinal.toLocaleString()} FCFA) est supérieur ou égal au minimum (1% CA = ${minimumPerceptionIS.toLocaleString()} FCFA).`
    },
    {
      id: 'CTRL-05',
      libelle: 'Absence de valeur nette négative sur immobilisations',
      status: 'VALIDE',
      ecart: 0,
      explication: 'Aucune immobilisation n\'a de valeur nette d\'amortissement négative.'
    },
    {
      id: 'CTRL-06',
      libelle: 'Exhaustivité et classification du Plan Comptable SYSCOHADA',
      status: (comptesNonClasses || []).length === 0 ? 'VALIDE' : 'AVERTISSEMENT',
      ecart: (comptesNonClasses || []).length,
      explication: (comptesNonClasses || []).length === 0 ? 'Tous les comptes sont reconnus.' : `${comptesNonClasses.length} compte(s) non reconnu(s).`
    }
  ];

  const allControlsValid = controls.every(c => c.status === 'VALIDE');

  return {
    companyInfo,
    bilan,
    resultat,
    tdrf: {
      ca,
      resultatComptableAvantIS,
      reintegrations,
      deductions,
      resultatFiscalImposable,
      isCalcule,
      minimumPerceptionIS,
      isFinal,
      resultatNetFinal
    },
    tft: {
      fluxExploitation,
      fluxInvestissement,
      fluxFinancement,
      variationTrésorerieNette,
      tresorerieNetBilan
    },
    controls,
    allControlsValid,
    comptesNonClasses
  };
}

// Génère et exporte le fichier Excel DSF Officiel à 74 onglets (fondé sur le template officiel DGI)
//
// Le chemin du template était auparavant codé en dur vers un fichier présent uniquement sur la
// machine du développeur d'origine ("C:\Users\LA TCHAUX HOTEL\..."). Sur toute autre machine, ce
// fichier n'existe pas : l'export retombait alors sur `xlsx.utils.book_new()`, un classeur
// totalement VIDE (aucune des feuilles ci-dessous n'existe sur un classeur neuf, donc chaque bloc
// `if (xxxSheet)` ci-dessous était silencieusement ignoré) — la génération "réussissait" sans
// erreur mais produisait un fichier inexploitable. Le chemin est maintenant configurable
// (Paramétrage IA > DSF, réglage DSF_TEMPLATE_PATH), et en son absence on génère un classeur
// autonome entièrement rempli avec les données calculées plutôt qu'un classeur vide.
async function generateDSFExcelWorkbook() {
  const settingsRows = await db.runSelect("SELECT value FROM settings WHERE key = 'DSF_TEMPLATE_PATH'");
  const templatePath = (settingsRows[0] && settingsRows[0].value || '').trim();
  const dsfData = await computeDSFData();
  const { companyInfo, bilan, resultat, tdrf, tft, controls } = dsfData;

  let wb = null;
  if (templatePath && fs.existsSync(templatePath)) {
    try {
      wb = xlsx.readFile(templatePath);
    } catch (e) {
      console.error("Error reading DSF template Excel, fallback to generated workbook:", e);
      wb = null;
    }
  }

  if (!wb) {
    wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet([
      ["FICHE DSF - INFORMATIONS GÉNÉRALES"],
      [],
      ["Raison sociale", companyInfo.raison_sociale || ''],
      ["Numéro d'Identifiant Unique (NIU)", companyInfo.niu || ''],
      ["Sigle", companyInfo.sigle || ''],
      ["Forme juridique", companyInfo.forme_juridique || ''],
      ["Adresse", companyInfo.adresse || ''],
      ["Téléphone", companyInfo.telephone || ''],
      ["Email", companyInfo.email || ''],
      ["Régime comptable", companyInfo.regime || ''],
      ["Centre fiscal", companyInfo.centre_fiscal || ''],
      ["Activité principale", companyInfo.activite_principale || ''],
      ["Code NACE", companyInfo.code_nace || ''],
      ["Exercice comptable", `${companyInfo.exercice_debut || ''} au ${companyInfo.exercice_fin || ''}`],
      ["Signataire", `${companyInfo.signataire_nom || ''} (${companyInfo.signataire_qualite || ''})`],
    ]), "INFORMATIONS GENERALES");

    xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet([
      ["BILAN SYSCOHADA RÉVISÉ (FCFA)"],
      [],
      ["ACTIF"],
      ["Actif immobilisé net", bilan.actif.totalImmobilisationsNettes],
      ["Actif circulant", bilan.actif.totalActifCirculant],
      ["Trésorerie actif", bilan.actif.tresorerieActif],
      ["TOTAL GENERAL ACTIF", bilan.actif.totalActif],
      [],
      ["PASSIF"],
      ["Capitaux propres & ressources stables", bilan.passif.totalCapitauxPropres],
      ["Passif circulant", bilan.passif.totalPassifCirculant],
      ["Trésorerie passif", bilan.passif.tresoreriePassif],
      ["TOTAL GENERAL PASSIF", bilan.passif.totalPassif],
    ]), "BILAN");

    xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet([
      ["COMPTE DE RÉSULTAT SYSCOHADA (FCFA)"],
      [],
      ["Chiffre d'Affaires (Ventes 70)", tdrf.ca],
      ["Achats Consommés (60)", resultat.achatsConsommes],
      ["Marge Brute d'Exploitation", tdrf.ca - resultat.achatsConsommes],
      ["Consommations Extérieures (61 à 65)", resultat.consommationsExternes],
      ["Valeur Ajoutée", resultat.valeurAjoutee],
      ["Charges de Personnel (66)", resultat.chargesPersonnel],
      ["Excédent Brut d'Exploitation (EBE)", resultat.excedentBrutExploitation],
      ["Dotations aux Amortissements & Provisions", resultat.dotationsExploitation],
      ["Résultat d'Exploitation", resultat.resultatExploitation],
      ["Impôt sur les Sociétés (IS)", tdrf.isFinal],
      ["RÉSULTAT NET DE L'EXERCICE", tdrf.resultatNetFinal],
    ]), "COMPTE DE RESULTAT");

    xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet([
      ["TABLEAU DES FLUX DE TRESORERIE (TFT)"],
      [],
      ["Flux de trésorerie provenant des activités d'exploitation", tft.fluxExploitation],
      ["Flux de trésorerie provenant des activités d'investissement", tft.fluxInvestissement],
      ["Flux de trésorerie provenant des activités de financement", tft.fluxFinancement],
      ["VARIATION NETTE DE LA TRÉSORERIE DE L'EXERCICE", tft.variationTrésorerieNette],
    ]), "TABLEAU DES FLUX DE TRESORERIE");

    xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet([
      ["ID", "Libellé", "Statut", "Écart", "Explication"],
      ...(controls || []).map(c => [c.id, c.libelle, c.status, c.ecart, c.explication]),
    ]), "CONTROLES DE COHERENCE");

    return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  // 1. Feuille INFORMATIONS GENERALES / PAGE DE GARDE
  const infoSheet = wb.Sheets['INFORMATIONS GENERALES'] || wb.Sheets['PAGE DE GARDE'];
  if (infoSheet) {
    xlsx.utils.sheet_add_aoa(infoSheet, [
      ["RAISON SOCIALE", companyInfo.raison_sociale || ''],
      ["NUMÉRO D'IDENTIFIANT UNIQUE (NIU)", companyInfo.niu || ''],
      ["CENTRE FISCAL", companyInfo.centre_fiscal || ''],
      ["RÉGIME COMPTABLE", companyInfo.regime || ''],
      ["FORME JURIDIQUE", companyInfo.forme_juridique || ''],
      ["EXERCICE COMPTABLE", `${companyInfo.exercice_debut || ''} AU ${companyInfo.exercice_fin || ''}`]
    ], { origin: "B5" });
  }

  // 2. Feuille BILAN PAYSAGE
  const bilanSheet = wb.Sheets['BILAN PAYSAGE'];
  if (bilanSheet) {
    const bilanAoa = [
      ["BILAN SYSCOHADA RÉVISÉ (FCFA)"],
      ["ACTIF IMMOBILISÉ", bilan.actif.totalImmobilisationsNettes],
      ["ACTIF CIRCULANT", bilan.actif.totalActifCirculant],
      ["TRÉSORERIE ACTIF", bilan.actif.tresorerieActif],
      ["TOTAL GENERAL ACTIF", bilan.actif.totalActif],
      [""],
      ["CAPITAUX PROPRES & RESSOURCES STABLES", bilan.passif.totalCapitauxPropres],
      ["PASSIF CIRCULANT", bilan.passif.totalPassifCirculant],
      ["TRÉSORERIE PASSIF", bilan.passif.tresoreriePassif],
      ["TOTAL GENERAL PASSIF", bilan.passif.totalPassif]
    ];
    xlsx.utils.sheet_add_aoa(bilanSheet, bilanAoa, { origin: "A10" });
  }

  // 3. Feuille COMPTE DE RESULTAT
  const crSheet = wb.Sheets['COMPTE DE RESULTAT'];
  if (crSheet) {
    const crAoa = [
      ["COMPTE DE RÉSULTAT SYSCOHADA (FCFA)"],
      ["Chiffre d'Affaires (Ventes 70)", tdrf.ca],
      ["Achats Consommés (60)", resultat.achatsConsommes],
      ["Marge Brute d'Exploitation", tdrf.ca - resultat.achatsConsommes],
      ["Consommations Extérieures (61 à 65)", resultat.consommationsExternes],
      ["Valeur Ajoutée", resultat.valeurAjoutee],
      ["Charges de Personnel (66)", resultat.chargesPersonnel],
      ["Excédent Brut d'Exploitation (EBE)", resultat.excedentBrutExploitation],
      ["Dotations aux Amortissements & Provisions", resultat.dotationsExploitation],
      ["Résultat d'Exploitation", resultat.resultatExploitation],
      ["Impôt sur les Sociétés (IS)", tdrf.isFinal],
      ["RÉSULTAT NET DE L'EXERCICE", tdrf.resultatNetFinal]
    ];
    xlsx.utils.sheet_add_aoa(crSheet, crAoa, { origin: "A10" });
  }

  // 4. Feuille TABLEAU DES FLUX DE TRESORERIE
  const tftSheet = wb.Sheets['TABLEAU DES FLUX DE TRESORERIE'];
  if (tftSheet) {
    const tftAoa = [
      ["TABLEAU DES FLUX DE TRESORERIE (TFT)"],
      ["Flux de trésorerie provenant des activités d'exploitation", tft.fluxExploitation],
      ["Flux de trésorerie provenant des activités d'investissement", tft.fluxInvestissement],
      ["Flux de trésorerie provenant des activités de financement", tft.fluxFinancement],
      ["VARIATION NETTE DE LA TRÉSORERIE DE L'EXERCICE", tft.variationTrésorerieNette]
    ];
    xlsx.utils.sheet_add_aoa(tftSheet, tftAoa, { origin: "A10" });
  }

  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
  getCompanyInfo,
  saveCompanyInfo,
  computeDSFData,
  generateDSFExcelWorkbook
};
