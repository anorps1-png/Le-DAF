// Plan comptable OHADA par défaut, utilisé comme filet de sécurité pour l'affichage des
// intitulés de compte (Balance, Grand Livre) quand aucun intitulé personnalisé n'a été extrait
// via la Mémoire Métier (voir /api/chart-of-accounts).
export const OHADA_PLAN = {
  "10": "CAPITAL",
  "13": "RÉSULTAT NET DE L'EXERCICE",
  "16": "EMPRUNTS ET DETTES ASSIMILÉES",
  "21": "IMMOBILISATIONS INCORPORELLES",
  "22": "TERRAINS",
  "23": "BÂTIMENTS, INSTALLATIONS TECHNIQUES",
  "24": "MATÉRIEL, MOBILIER ET ACTIFS BIOLOGIQUES",
  "28": "AMORTISSEMENTS",
  "31": "MARCHANDISES",
  "32": "MATIÈRES PREMIÈRES ET FOURNITURES LIÉES",
  "40": "FOURNISSEURS ET COMPTES RATTACHÉS",
  "401": "FOURNISSEURS D'EXPLOITATION",
  "41": "CLIENTS ET COMPTES RATTACHÉS",
  "411": "CLIENTS",
  "42": "PERSONNEL",
  "422": "PERSONNEL, RÉMUNÉRATIONS DUES",
  "43": "ORGANISMES SOCIAUX",
  "44": "ÉTAT ET COLLECTIVITÉS PUBLIQUES",
  "46": "DÉBITEURS ET CRÉDITEURS DIVERS",
  "47": "COMPTES TRANSITOIRES OU D'ATTENTE",
  "48": "CRÉANCES ET DETTES (HAO)",
  "50": "TITRES DE PLACEMENT",
  "51": "VALEURS À L'ENCAISSEMENT",
  "52": "BANQUES",
  "53": "ÉTABLISSEMENTS FINANCIERS",
  "54": "INSTRUMENTS DE TRÉSORERIE",
  "56": "BANQUES, CRÉDITS DE TRÉSORERIE",
  "57": "CAISSE",
  "58": "RÉGIES D'AVANCES ET VIREMENTS INTERNES",
  "60": "ACHATS ET VARIATIONS DE STOCKS",
  "601": "ACHATS DE MARCHANDISES",
  "602": "ACHATS DE MATIÈRES PREMIÈRES ET FOURNITURES",
  "604": "ACHATS D'ÉTUDES ET PRESTATIONS DE SERVICES",
  "605": "AUTRES ACHATS",
  "61": "TRANSPORTS",
  "618": "AUTRES FRAIS DE TRANSPORT",
  "62": "SERVICES EXTÉRIEURS A",
  "621": "PERSONNEL EXTÉRIEUR À L'ENTREPRISE",
  "624": "ENTRETIEN, RÉPARATIONS ET MAINTENANCE",
  "628": "FRAIS DE TÉLÉCOMMUNICATIONS",
  "63": "SERVICES EXTÉRIEURS B",
  "632": "RÉMUNÉRATIONS D'INTERMÉDIAIRES ET HONORAIRES",
  "64": "IMPÔTS ET TAXES",
  "65": "AUTRES CHARGES",
  "66": "CHARGES DE PERSONNEL",
  "67": "FRAIS FINANCIERS",
  "68": "DOTATIONS AUX AMORTISSEMENTS",
  "70": "VENTES",
  "71": "SUBVENTIONS D'EXPLOITATION",
  "73": "VARIATION DES STOCKS DE BIENS ET SERVICES PRODUITS",
  "75": "AUTRES PRODUITS",
  "77": "REVENUS FINANCIERS",
  "81": "VALEURS COMP. DES CESSIONS D'IMMOB.",
  "82": "PRODUITS DES CESSIONS D'IMMOB.",
  "83": "CHARGES (HAO)",
  "84": "PRODUITS (HAO)",
  "89": "IMPÔTS SUR LE RÉSULTAT"
};

// Le plan comptable personnalisé (customAccounts, extrait des documents de la Mémoire Métier)
// prime sur le plan OHADA par défaut, qui ne sert plus que de filet de sécurité.
export const getAccountLabel = (compteStr, customAccounts = {}) => {
  const str = String(compteStr);
  if (customAccounts[str]) return customAccounts[str];
  for (let i = str.length; i >= 2; i--) {
    const prefix = str.substring(0, i);
    if (customAccounts[prefix]) return customAccounts[prefix];
    if (OHADA_PLAN[prefix]) return OHADA_PLAN[prefix];
  }
  return `COMPTE ${str}`;
};
