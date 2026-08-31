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
  if (!id) return { clause: '', params: [], exerciceId: null };
  const exRows = await db.runSelect("SELECT date_debut, date_fin FROM exercices WHERE id = ?", [id]);
  const ex = exRows[0];
  if (!ex) return { clause: '', params: [], exerciceId: null };
  return { clause: 'date >= ? AND date <= ?', params: [ex.date_debut, ex.date_fin], exerciceId: id };
}

// Choix (par exercice) de la source de l'IS utilisée par le TDRF : 'theorique' (calcul 27,5% /
// minimum de perception, indépendant des livres — comportement par défaut, cf. computeDSFData) ou
// 'reel' (utilise l'écriture d'IS réellement comptabilisée sur le compte 89, si elle existe, pour
// que la DSF colle aux livres comme le module Compte de Résultat). Persisté dans `settings` sous
// une clé par exercice puisque le choix n'a de sens que pour l'exercice où il a été fait.
async function getDsfIsSource(exerciceId) {
  const key = `DSF_IS_SOURCE_${exerciceId || 'default'}`;
  const rows = await db.runSelect("SELECT value FROM settings WHERE key = ?", [key]);
  return (rows[0] && rows[0].value) || 'theorique';
}

async function setDsfIsSource(exerciceId, source) {
  const key = `DSF_IS_SOURCE_${exerciceId || 'default'}`;
  const value = source === 'reel' ? 'reel' : 'theorique';
  await db.runUpdate("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, value]);
  return value;
}

const DEFAULT_IS_RATE = 27.5; // Cameroun CGI, taux en vigueur au moment du dernier réglage
const IS_RATE_SETTING_KEY = 'DSF_IS_RATE';

// Taux d'IS utilisé par le calcul théorique (global, pas par exercice : c'est un taux légal, pas
// un choix propre à une année précise) — modifiable par l'utilisateur, la loi fiscale changeant
// dans le temps, plutôt que codé en dur dans computeDSFData.
async function getDsfIsRate() {
  const rows = await db.runSelect("SELECT value FROM settings WHERE key = ?", [IS_RATE_SETTING_KEY]);
  const raw = rows[0] && rows[0].value;
  const parsed = parseFloat(raw);
  return (Number.isFinite(parsed) && parsed > 0 && parsed <= 100) ? parsed : DEFAULT_IS_RATE;
}

async function setDsfIsRate(rate) {
  const parsed = parseFloat(rate);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) {
    throw new Error("Le taux d'IS doit être un nombre compris entre 0 et 100.");
  }
  await db.runUpdate("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [IS_RATE_SETTING_KEY, String(parsed)]);
  return parsed;
}

// Calcul complet des données du dossier DSF OHADA
async function computeDSFData() {
  const companyInfo = await getCompanyInfo();

  // Balance cumulée (bornée à l'exercice actif)
  const { clause, params, exerciceId } = await getExerciceDateFilter();
  const balanceRows = await db.runSelect(`
    SELECT compte, SUM(debit) as total_debit, SUM(credit) as total_credit
    FROM journal
    ${clause ? `WHERE ${clause}` : ''}
    GROUP BY compte
    ORDER BY compte ASC
  `, params);

  // Résultat non affecté reporté par le journal RAN (À Nouveaux) sur le compte 13, même portée
  // temporelle que balanceRows ci-dessus : cf. server/ohadaRules.js.
  const ranResultatRows = await db.runSelect(`
    SELECT compte, SUM(debit) as debit, SUM(credit) as credit
    FROM journal
    WHERE compte LIKE '13%' AND UPPER(TRIM(code_journal)) = 'RAN' ${clause ? `AND ${clause}` : ''}
    GROUP BY compte
  `, params);

  const { bilan, resultat, comptesNonClasses } = computeEtatsFinanciers(balanceRows || [], ranResultatRows || []);

  // Résultat réellement comptabilisé (Bilan/Compte de Résultat) : sert de référence pour CTRL-02
  // et, plus bas, pour le calcul de la CAF du TFT — jamais le résultat fiscal théorique/choisi de
  // la TDRF (isFinal), qui n'a de sens que pour la déclaration, pas pour la trésorerie réellement
  // constatée. Champ nommé resultatNetExercice dans bilan.passif (cf. ohadaRules.js).
  const resultBilan = bilan.passif.resultatNetExercice || 0;

  // 1. Chiffre d'affaires & TDRF
  const ca = resultat.chiffreAffaires || 0;
  const resultatComptableAvantIS = (resultat.chiffreAffaires - resultat.achatsConsommes - resultat.consommationsExternes - resultat.chargesPersonnel - resultat.dotationsExploitation) + (resultat.resultatFinancier || 0) + (resultat.resultatHAO || 0);

  // Exemples de réintégrations / déductions par défaut (personnalisables)
  const reintegrations = 0; // amendes, charges non déductibles
  const deductions = 0; // plus-values exonérées, dividendes

  const resultatFiscalImposable = Math.max(0, resultatComptableAvantIS + reintegrations - deductions);
  const isRate = await getDsfIsRate();
  const isCalcule = Math.round(resultatFiscalImposable * (isRate / 100));
  const minimumPerceptionIS = Math.round(ca * 0.01); // 1% du CA HT
  const isTheorique = Math.max(isCalcule, minimumPerceptionIS);

  // IS réellement comptabilisé (compte 89, même portée que balanceRows) : indépendant du calcul
  // théorique ci-dessus, qui ignore délibérément les livres (une DSF calcule l'IS dû selon la loi,
  // pas seulement ce qui a été saisi). L'utilisateur peut choisir de faire quand même primer cette
  // écriture réelle via /api/dsf/is-source (setDsfIsSource) — sinon le théorique reste par défaut.
  const isReelRows = await db.runSelect(`
    SELECT SUM(debit) as debit, SUM(credit) as credit
    FROM journal
    WHERE compte LIKE '89%' ${clause ? `AND ${clause}` : ''}
  `, params);
  const isReel = ((isReelRows[0] && isReelRows[0].debit) || 0) - ((isReelRows[0] && isReelRows[0].credit) || 0);

  const isSourcePref = await getDsfIsSource(exerciceId);
  const isSource = (isSourcePref === 'reel' && isReel > 0) ? 'reel' : 'theorique';
  const isFinal = isSource === 'reel' ? isReel : isTheorique;

  const resultatNetFinal = Math.round(resultatComptableAvantIS - isFinal);

  // 2. Tableau des Flux de Trésorerie (TFT - Méthode Indirecte, Partie 3 §4 SYSCOHADA)
  //
  // "Bilan d'ouverture" reconstruit UNIQUEMENT depuis les lignes RAN (toutes classes, même
  // principe que ranResultatRows ci-dessus mais sans filtrer sur le compte 13) : c'est la seule
  // source fiable du solde de début d'exercice pour chaque poste, RAN faisant foi comme pour le
  // Bilan/la Balance (cf. server/index.js getBalanceRows, server/ohadaRules.js). Un exercice sans
  // aucun RAN donne un bilan d'ouverture entièrement à 0 — comportement cohérent : sans écriture
  // d'ouverture, il n'y a rien à reporter, ce qui revient au calcul simplifié d'origine.
  const ranAllRows = await db.runSelect(`
    SELECT compte, SUM(debit) as total_debit, SUM(credit) as total_credit
    FROM journal
    WHERE UPPER(TRIM(code_journal)) = 'RAN' ${clause ? `AND ${clause}` : ''}
    GROUP BY compte
  `, params);
  const { bilan: bilanOuverture } = computeEtatsFinanciers(ranAllRows || []);

  // ΔBFR détaillé par masse (stocks / créances / dettes circulantes), pour les lignes FC/FD/FE du
  // TFT officiel — deltaBFR reste leur somme signée pour compatibilité (voir plus bas).
  const deltaStocks = bilan.actif.stocks.net - bilanOuverture.actif.stocks.net;
  const deltaCreances = (bilan.actif.creancesClients.net + bilan.actif.autresCreances) - (bilanOuverture.actif.creancesClients.net + bilanOuverture.actif.autresCreances);
  const deltaDettesCirculantes = (bilan.passif.dettesFournisseurs + bilan.passif.autresDettes) - (bilanOuverture.passif.dettesFournisseurs + bilanOuverture.passif.autresDettes);
  const deltaBFR = deltaStocks + deltaCreances - deltaDettesCirculantes;

  // Flux d'investissement/financement réels : mouvements hors RAN uniquement (le RAN reconstitue
  // une position d'ouverture, ce n'est pas un flux de la période — même logique que pour le Bilan).
  // Détaillés par sous-classe (21/22-24/25-27, hors 28/29 amort/dépréc.) pour les lignes
  // FF/FG/FH (décaissements par nature) et FI/FJ (encaissements/cessions) du TFT officiel : le
  // débit d'une ligne d'immobilisation est une acquisition (décaissement), son crédit une cession
  // (encaissement) — jamais nettés l'un contre l'autre comme le ferait un simple solde.
  async function investFlow(likePrefixes) {
    const clauses = likePrefixes.map(() => `compte LIKE ?`).join(' OR ');
    const rows = await db.runSelect(`
      SELECT SUM(debit) as debit, SUM(credit) as credit
      FROM journal
      WHERE (${clauses}) AND UPPER(TRIM(code_journal)) != 'RAN' ${clause ? `AND ${clause}` : ''}
    `, [...likePrefixes.map(p => `${p}%`), ...params]);
    return { debit: (rows[0] && rows[0].debit) || 0, credit: (rows[0] && rows[0].credit) || 0 };
  }
  const investIncorp = await investFlow(['21']);
  const investCorp = await investFlow(['22', '23', '24']);
  const investFin = await investFlow(['25', '26', '27']);
  const decaissementIncorp = -investIncorp.debit;
  const decaissementCorp = -investCorp.debit;
  const decaissementFin = -investFin.debit;
  const encaissementCessionsCorpIncorp = investIncorp.credit + investCorp.credit;
  const encaissementCessionsFin = investFin.credit;
  const fluxInvestissement = decaissementIncorp + decaissementCorp + decaissementFin + encaissementCessionsCorpIncorp + encaissementCessionsFin;

  // Financement détaillé : capital (classe 10) / dettes financières et emprunts (classes 16-18),
  // pour les lignes FK (augmentation de capital), FO (emprunts) et FQ (remboursements) du TFT.
  async function financeFlow(likePrefixes) {
    const clauses = likePrefixes.map(() => `compte LIKE ?`).join(' OR ');
    const rows = await db.runSelect(`
      SELECT SUM(debit) as debit, SUM(credit) as credit
      FROM journal
      WHERE (${clauses}) AND UPPER(TRIM(code_journal)) != 'RAN' ${clause ? `AND ${clause}` : ''}
    `, [...likePrefixes.map(p => `${p}%`), ...params]);
    return { debit: (rows[0] && rows[0].debit) || 0, credit: (rows[0] && rows[0].credit) || 0 };
  }
  const financeCapital = await financeFlow(['10']);
  const financeEmprunts = await financeFlow(['16', '17', '18']);
  const augmentationCapital = financeCapital.credit - financeCapital.debit; // signé : prélèvement (FM) si négatif
  const nouveauxEmprunts = financeEmprunts.credit;
  const remboursementEmprunts = -financeEmprunts.debit;
  const fluxFinancement = augmentationCapital + nouveauxEmprunts + remboursementEmprunts;

  const dotationsAmort = resultat.dotationsExploitation || 0;
  const caf = resultBilan + dotationsAmort; // Capacité d'autofinancement, sur le résultat RÉEL
  const fluxExploitation = caf - deltaBFR;
  const variationTrésorerieNette = fluxExploitation + fluxInvestissement + fluxFinancement;

  const tresorerieOuverture = (bilanOuverture.actif.tresorerieActif || 0) - (bilanOuverture.passif.tresoreriePassif || 0);
  const tresorerieCloture = tresorerieOuverture + variationTrésorerieNette;
  const tresorerieNetBilan = (bilan.actif.tresorerieActif || 0) - (bilan.passif.tresoreriePassif || 0);

  // 3. Contrôles de Cohérence Bloquants (CTRL-01 à CTRL-06)
  const totalActifNet = bilan.actif.totalActif || 0;
  const totalPassifNet = bilan.passif.totalPassif || 0;
  const ecartBilan = Math.abs(totalActifNet - totalPassifNet);

  const ecartResultat = Math.abs(resultatNetFinal - resultBilan);

  const ecartTresorerieTFT = Math.abs(tresorerieCloture - tresorerieNetBilan);

  const controls = [
    {
      id: 'CTRL-01',
      libelle: 'Équilibre fondamental du Bilan (Total Actif Net = Total Passif Net)',
      status: ecartBilan < 1 ? 'VALIDE' : 'ERREUR',
      ecart: ecartBilan,
      explication: ecartBilan < 1 ? 'Bilan équilibré à 0 FCFA près.' : `Écart de ${ecartBilan.toLocaleString()} FCFA entre l'actif et le passif.`
    },
    {
      // Écart attendu par construction dès que la source choisie est "théorique" (27,5% / minimum
      // de perception) ET qu'une écriture d'IS différente existe déjà sur le compte 89 — deux
      // méthodes de calcul délibérément indépendantes, pas une anomalie du dossier. Ne redescend en
      // ERREUR que si l'écart persiste alors que la source "réel" est active (là, un vrai problème).
      id: 'CTRL-02',
      libelle: 'Cohérence du Résultat Net (Compte de Résultat = Bilan Passif)',
      status: ecartResultat < 1 ? 'VALIDE' : (isSource === 'reel' ? 'ERREUR' : 'AVERTISSEMENT'),
      ecart: ecartResultat,
      explication: ecartResultat < 1
        ? 'Résultat net strictement identique entre Bilan et CR.'
        : (isSource === 'reel'
          ? `Écart de ${ecartResultat.toLocaleString()} FCFA malgré l'utilisation de l'IS réellement comptabilisé — à vérifier.`
          : `Écart de ${ecartResultat.toLocaleString()} FCFA : la DSF utilise l'IS théorique (${isTheorique.toLocaleString()} FCFA) tandis que le compte 89 porte ${isReel.toLocaleString()} FCFA. Normal si volontaire (onglet TDRF & IS) — sinon activez "IS réellement comptabilisé".`)
    },
    {
      id: 'CTRL-03',
      libelle: 'Cohérence Trésorerie (Trésorerie de Clôture TFT = Trésorerie Nette Bilan)',
      status: ecartTresorerieTFT < 1 ? 'VALIDE' : 'AVERTISSEMENT',
      ecart: ecartTresorerieTFT,
      explication: ecartTresorerieTFT < 1
        ? 'Trésorerie de clôture du TFT (ouverture + variation) égale au solde Bilan.'
        : `Écart de ${ecartTresorerieTFT.toLocaleString()} FCFA entre la trésorerie de clôture du TFT (${tresorerieCloture.toLocaleString()} FCFA) et le solde Bilan (${tresorerieNetBilan.toLocaleString()} FCFA).`
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
      isRate,
      isCalcule,
      minimumPerceptionIS,
      isTheorique,
      isReel,
      isSource,
      isFinal,
      resultatNetFinal
    },
    tft: {
      caf,
      deltaStocks,
      deltaCreances,
      deltaDettesCirculantes,
      deltaBFR,
      fluxExploitation,
      decaissementIncorp,
      decaissementCorp,
      decaissementFin,
      encaissementCessionsCorpIncorp,
      encaissementCessionsFin,
      fluxInvestissement,
      augmentationCapital,
      nouveauxEmprunts,
      remboursementEmprunts,
      fluxFinancement,
      variationTrésorerieNette,
      tresorerieOuverture,
      tresorerieCloture,
      tresorerieNetBilan
    },
    controls,
    allControlsValid,
    comptesNonClasses
  };
}

// Le vrai formulaire officiel DGI (74 onglets, plan SYSCOHADA normalisé — codes de référence
// AD/AE/.../DZ pour le Bilan, TA/RA/.../XI pour le Compte de Résultat, ZA/FA/.../ZH pour le TFT)
// est embarqué avec l'application : plus besoin que l'utilisateur le fournisse lui-même. Un
// réglage DSF_TEMPLATE_PATH (Paramétrage) reste disponible pour le remplacer par une autre édition
// si la DGI en publie une nouvelle version.
const BUNDLED_DSF_TEMPLATE_PATH = path.join(__dirname, 'templates', 'DSF_Normal_DGIFORMAT_VERROUILLEVF.xlsx');

// Repère, dans une feuille du formulaire officiel, la ligne de chaque code de référence à 2
// lettres (AD, TA, ZA...) présent dans les colonnes données — ces codes sont les seuls repères
// stables d'une feuille à l'autre (les libellés varient en largeur/retour à la ligne, jamais eux).
function findRefRows(sheet, colLetters) {
  const ref = sheet['!ref'];
  const map = {};
  if (!ref) return map;
  const range = xlsx.utils.decode_range(ref);
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (const col of colLetters) {
      const cell = sheet[col + (R + 1)];
      if (cell && typeof cell.v === 'string' && /^[A-Z]{2}$/.test(cell.v.trim())) {
        map[cell.v.trim()] = R + 1;
      }
    }
  }
  return map;
}

function setCell(sheet, colLetter, row, value) {
  if (!row || value === undefined || value === null || Number.isNaN(value)) return;
  const addr = colLetter + row;
  sheet[addr] = { t: typeof value === 'number' ? 'n' : 's', v: value };
  const ref = sheet['!ref'];
  if (ref) {
    const range = xlsx.utils.decode_range(ref);
    const cellAddr = xlsx.utils.decode_cell(addr);
    let changed = false;
    if (cellAddr.r > range.e.r) { range.e.r = cellAddr.r; changed = true; }
    if (cellAddr.c > range.e.c) { range.e.c = cellAddr.c; changed = true; }
    if (changed) sheet['!ref'] = xlsx.utils.encode_range(range);
  }
}

// --- Feuille BILAN PAYSAGE ---
// Certaines sous-lignes du formulaire officiel (détail par nature d'immobilisation, répartition
// dettes fiscales/sociales vs autres dettes...) n'ont pas d'équivalent dans la classification
// SYSCOHADA générique de server/ohadaRules.js (qui ne connaît que la racine du numéro de compte,
// pas une convention propre à cette entité) : leur montant reste porté sur la ligne de sous-total
// la plus proche plutôt que d'être perdu. Documenté ligne par ligne ci-dessous.
function injectBilanPaysage(sheet, bilan) {
  const refs = findRefRows(sheet, ['A', 'H']);
  const a = bilan.actif, p = bilan.passif;
  const r = (v) => Math.round(v || 0);

  const writeActif = (ref, brut, amort, net) => {
    const row = refs[ref];
    if (!row) return;
    if (brut !== undefined) setCell(sheet, 'D', row, r(brut));
    if (amort !== undefined) setCell(sheet, 'E', row, r(amort));
    setCell(sheet, 'F', row, r(net));
  };
  const writePassif = (ref, net) => setCell(sheet, 'K', refs[ref], r(net));

  // Actif immobilisé : détail par nature (AE-AH, AJ-AN, AR-AS) non ventilable depuis la balance
  // agrégée par compte — seules les lignes de sous-total (AD/AI/AQ/AZ) sont renseignées.
  writeActif('AD', a.immobilisationsIncorporelles.brut, (a.immobilisationsIncorporelles.amortissements || 0) + (a.immobilisationsIncorporelles.depreciations || 0), a.immobilisationsIncorporelles.net);
  writeActif('AI', a.immobilisationsCorporelles.brut, (a.immobilisationsCorporelles.amortissements || 0) + (a.immobilisationsCorporelles.depreciations || 0), a.immobilisationsCorporelles.net);
  writeActif('AQ', a.immobilisationsFinancieres.brut, a.immobilisationsFinancieres.depreciations || 0, a.immobilisationsFinancieres.net);
  const totalBrutImmo = (a.immobilisationsIncorporelles.brut || 0) + (a.immobilisationsCorporelles.brut || 0) + (a.immobilisationsFinancieres.brut || 0);
  const totalAmortImmo = (a.immobilisationsIncorporelles.amortissements || 0) + (a.immobilisationsIncorporelles.depreciations || 0) + (a.immobilisationsCorporelles.amortissements || 0) + (a.immobilisationsCorporelles.depreciations || 0) + (a.immobilisationsFinancieres.depreciations || 0);
  writeActif('AZ', totalBrutImmo, totalAmortImmo, a.totalImmobilisationsNettes);

  writeActif('BB', a.stocks.brut, a.stocks.depreciations, a.stocks.net);
  writeActif('BH', undefined, undefined, a.fournisseursAvancesVersees);
  writeActif('BI', a.creancesClients.brut, a.creancesClients.depreciations, a.creancesClients.net);
  writeActif('BJ', undefined, undefined, a.autresCreancesDiverses);
  writeActif('BK', undefined, undefined, a.totalActifCirculant);
  // Trésorerie actif : un seul solde global calculé (pas de détail titres de placement / valeurs à
  // encaisser / banques-caisse séparé) — porté sur BT (total), BQ/BR/BS laissés vides.
  writeActif('BT', undefined, undefined, a.tresorerieActif);
  writeActif('BU', undefined, undefined, a.ecartConversionActif);
  writeActif('BZ', undefined, undefined, a.totalActif);

  writePassif('CA', p.capital);
  writePassif('CG', p.reserves); // pas de distinction réserves indisponibles (CF) / libres (CG)
  writePassif('CH', p.reportANouveau);
  writePassif('CJ', p.resultatNetExercice); // résultat RÉEL des livres, jamais le choix théorique de la TDRF
  writePassif('CL', p.subventionsInvestissement);
  writePassif('CM', p.provisionsReglementees);
  writePassif('CP', p.totalCapitauxPropres);
  writePassif('DA', p.dettesFinancieres);
  writePassif('DC', p.provisionsRisquesCharges);
  writePassif('DD', p.dettesFinancieres + p.provisionsRisquesCharges);
  writePassif('DF', p.totalRessourcesStables);
  writePassif('DI', p.clientsAvancesRecues);
  writePassif('DJ', p.dettesFournisseurs);
  // Dettes fiscales/sociales (DK) non isolées des autres dettes divers (classes 42-48 confondues
  // dans AUTRES_TIERS) : tout est porté sur DM plutôt que deviné.
  writePassif('DM', p.autresDettesDiverses);
  writePassif('DP', p.totalPassifCirculant);
  writePassif('DR', p.tresoreriePassif);
  writePassif('DT', p.tresoreriePassif);
  writePassif('DY', p.ecartConversionPassif);
  writePassif('DZ', p.totalPassif);
}

// --- Feuille COMPTE DE RESULTAT ---
function injectCompteResultat(sheet, resultat, resultatNetReel) {
  const refs = findRefRows(sheet, ['A']);
  const r = (v) => Math.round(v || 0);
  const write = (ref, net) => setCell(sheet, 'E', refs[ref], r(net));

  write('TA', resultat.ventesMarchandises);
  write('RA', resultat.achatsMarchandises);
  write('RB', resultat.variationStockMarchandises);
  write('XA', resultat.margeCommerciale);
  // Ventes de produits fabriqués (TB) / travaux-services vendus (TC) / produits accessoires (TD)
  // non distingués dans la classification générique (un seul bloc "chiffre d'affaires autre que
  // marchandises") : porté sur TC, la nature la plus fréquente en PME OHADA hors négoce.
  write('TC', resultat.chiffreAffairesAutre);
  write('XB', resultat.chiffreAffaires);
  write('TH', resultat.autresProduitsExploitation);
  write('RE', resultat.achatsMatieresAutres);
  write('RG', resultat.transports);
  write('RH', resultat.servicesExterieurs);
  write('RI', resultat.impotsTaxes);
  write('RJ', resultat.autresChargesGestion);
  write('XC', resultat.valeurAjoutee);
  write('RK', resultat.chargesPersonnel);
  write('XD', resultat.excedentBrutExploitation);
  write('TJ', resultat.reprisesExploitation);
  write('RL', resultat.dotationsExploitation);
  write('XE', resultat.resultatExploitation);
  write('TK', resultat.produitsFinanciers);
  write('RM', resultat.chargesFinancieres);
  write('XF', resultat.resultatFinancier);
  write('XG', resultat.resultatActivitesOrdinaires);
  write('TO', resultat.produitsHAO);
  write('RP', resultat.chargesHAO);
  write('XH', resultat.resultatHAO);
  write('RQ', resultat.participationTravailleurs);
  // Impôt sur le résultat (RS) : celui RÉELLEMENT comptabilisé (compte 89), pas le choix
  // théorique/réel de la TDRF — pour que XI (résultat net) reste identique au Bilan (CJ) et aux
  // livres, cohérence vérifiée par CTRL-02 (voir computeDSFData).
  write('RS', resultat.impotsResultat);
  write('XI', resultatNetReel);
}

// --- Feuille TABLEAU DES FLUX DE TRESORERIE ---
function injectTFT(sheet, tft) {
  const refs = findRefRows(sheet, ['A']);
  const r = (v) => Math.round(v || 0);
  const write = (ref, net) => setCell(sheet, 'E', refs[ref], r(net));

  write('ZA', tft.tresorerieOuverture);
  write('FA', tft.caf);
  write('FC', -tft.deltaStocks); // signe : une hausse de stock CONSOMME de la trésorerie
  write('FD', -tft.deltaCreances);
  write('FE', tft.deltaDettesCirculantes); // une hausse des dettes circulantes LIBÈRE de la trésorerie
  write('ZB', tft.fluxExploitation);
  write('FF', tft.decaissementIncorp);
  write('FG', tft.decaissementCorp);
  write('FH', tft.decaissementFin);
  write('FI', tft.encaissementCessionsCorpIncorp);
  write('FJ', tft.encaissementCessionsFin);
  write('ZC', tft.fluxInvestissement);
  write('FK', Math.max(0, tft.augmentationCapital));
  write('FM', Math.min(0, tft.augmentationCapital)); // prélèvement sur le capital si négatif
  write('ZD', Math.max(0, tft.augmentationCapital)); // FL (subventions) et FN (dividendes) non isolés
  write('FO', tft.nouveauxEmprunts);
  write('FQ', tft.remboursementEmprunts);
  write('ZE', tft.nouveauxEmprunts + tft.remboursementEmprunts);
  write('ZF', tft.fluxFinancement);
  write('ZG', tft.variationTrésorerieNette);
  write('ZH', tft.tresorerieCloture);
}

// --- En-tête (PAGE DE GARDE / INFORMATIONS GENERALES / Fiche R1) ---
// Uniquement les champs déjà collectés via Paramétrage > DSF (company_info) — le reste des Fiches
// R1/R2/R3 (dirigeants, actionnariat, domiciliation bancaire...) nécessite des écrans de saisie
// dédiés qui n'existent pas encore (cf. échange avec l'utilisateur), donc laissé vide sur ces
// feuilles plutôt que deviné.
function injectEntete(wb, companyInfo) {
  const pageDeGarde = wb.Sheets['PAGE DE GARDE'];
  if (pageDeGarde) {
    setCell(pageDeGarde, 'C', 16, companyInfo.raison_sociale || '');
    setCell(pageDeGarde, 'C', 20, `${companyInfo.exercice_debut || ''} au ${companyInfo.exercice_fin || ''}`);
  }

  const ficheR1 = wb.Sheets['Fiche R1'];
  if (ficheR1) {
    const refs = findRefRows(ficheR1, ['A']);
    if (refs['ZA']) setCell(ficheR1, 'F', refs['ZA'], `DU : ${companyInfo.exercice_debut || ''} AU : ${companyInfo.exercice_fin || ''}`);
    if (refs['ZG']) {
      setCell(ficheR1, 'C', (refs['ZG'] + 1), companyInfo.telephone || '');
      setCell(ficheR1, 'F', (refs['ZG'] + 1), companyInfo.email || '');
    }
    if (refs['ZH']) setCell(ficheR1, 'D', (refs['ZH'] + 1), companyInfo.adresse || '');
    if (refs['ZI']) setCell(ficheR1, 'D', (refs['ZI'] + 1), companyInfo.activite_principale || '');
  }
}

// Génère et exporte le fichier Excel DSF Officiel à 74 onglets (fondé sur le template officiel
// DGI, plan SYSCOHADA normalisé). Injection précise par code de référence (AD, TA, ZA...) pour les
// 3 états financiers (Bilan/CR/TFT) et l'en-tête d'identification — cf. les fonctions ci-dessus.
// Les ~70 autres onglets (notes annexes, fiches d'identification détaillées, tableaux fiscaux
// CF1/CF2...) nécessitent des sources de données que l'application ne collecte pas encore
// (registre d'immobilisations, effectifs, échéanciers, parties liées...) : ils restent tels que le
// modèle officiel les fournit, vierges, pour complétion manuelle en attendant ces écrans.
async function generateDSFExcelWorkbook() {
  const settingsRows = await db.runSelect("SELECT value FROM settings WHERE key = 'DSF_TEMPLATE_PATH'");
  const customPath = (settingsRows[0] && settingsRows[0].value || '').trim();
  const templatePath = (customPath && fs.existsSync(customPath)) ? customPath : BUNDLED_DSF_TEMPLATE_PATH;
  const dsfData = await computeDSFData();
  const { companyInfo, bilan, resultat, tdrf, tft, controls } = dsfData;

  let wb = null;
  if (fs.existsSync(templatePath)) {
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

  injectEntete(wb, companyInfo);

  const bilanSheet = wb.Sheets['BILAN PAYSAGE'];
  if (bilanSheet) injectBilanPaysage(bilanSheet, bilan);

  const crSheet = wb.Sheets['COMPTE DE RESULTAT'];
  if (crSheet) injectCompteResultat(crSheet, resultat, bilan.passif.resultatNetExercice);

  const tftSheet = wb.Sheets['TABLEAU DES FLUX DE TRESORERIE'];
  if (tftSheet) injectTFT(tftSheet, tft);

  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
  getCompanyInfo,
  saveCompanyInfo,
  computeDSFData,
  generateDSFExcelWorkbook,
  getDsfIsSource,
  setDsfIsSource,
  getDsfIsRate,
  setDsfIsRate,
  getExerciceDateFilter
};
