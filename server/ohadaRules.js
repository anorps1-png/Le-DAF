// Règles métiers de comptabilisation SYSCOHADA — moteur de classification des comptes.
//
// Source : Guide d'application du SYSCOHADA (Partie 1 "Opérations courantes" + Partie 3
// chapitre 1 "Présentation des états financiers"). Ces règles sont celles de l'Acte uniforme
// relatif au droit comptable : elles sont donc génériques et valables pour toute entité de
// l'espace OHADA, quel que soit son plan comptable propre.
//
// Le plan comptable spécifique à une entreprise (les intitulés de comptes personnalisés,
// table `chart_of_accounts`) ne change jamais CES règles : il ne fait qu'ajouter des libellés
// lisibles à des comptes qui, numériquement, respectent toujours la structure décimale du
// SYSCOHADA (voir Partie 1, Chapitre 1 : les subdivisions au-delà de 4 chiffres sont libres,
// mais la racine à 2-4 chiffres reste imposée). Classifier un compte revient donc toujours à
// faire correspondre le préfixe numérique le plus long possible à une règle ci-dessous — jamais
// à connaître par avance la liste des comptes d'une entreprise donnée.

// ---------------------------------------------------------------------------------------------
// Bilan — classification des comptes de situation (classes 1 à 5)
// ---------------------------------------------------------------------------------------------
// Chaque règle associe un préfixe de compte à une catégorie. La correspondance se fait sur le
// préfixe le plus long/spécifique d'abord (ex : "499" avant "49", "49" avant "4").
const BILAN_RULES = [
  // Classe 1 — Ressources stables (Partie 1, Ch.1 §1.1 ; Partie 3 §2.3)
  { prefix: '10', category: 'CAPITAL' },
  { prefix: '11', category: 'RESERVES' },
  { prefix: '12', category: 'REPORT_A_NOUVEAU' },
  { prefix: '13', category: 'RESULTAT_NET_BILAN' },
  { prefix: '14', category: 'SUBVENTIONS_INVESTISSEMENT' },
  { prefix: '15', category: 'PROVISIONS_REGLEMENTEES' }, // dont amortissements dérogatoires (151), plus-values à réinvestir (152)
  { prefix: '16', category: 'DETTES_FINANCIERES' },
  { prefix: '17', category: 'DETTES_FINANCIERES' }, // dettes de location-acquisition
  { prefix: '18', category: 'DETTES_FINANCIERES' }, // dettes liées à des participations
  { prefix: '19', category: 'PROVISIONS_RISQUES' }, // provisions pour risques et charges à plus d'un an

  // Classe 2 — Actif immobilisé (Ch.5)
  { prefix: '21', category: 'IMMO_INCORPORELLES' },
  { prefix: '22', category: 'IMMO_CORPORELLES' },
  { prefix: '23', category: 'IMMO_CORPORELLES' },
  { prefix: '24', category: 'IMMO_CORPORELLES' },
  { prefix: '25', category: 'IMMO_FINANCIERES' },
  { prefix: '26', category: 'IMMO_FINANCIERES' },
  { prefix: '27', category: 'IMMO_FINANCIERES' },
  { prefix: '28', category: 'AMORTISSEMENTS' }, // soustractif à l'actif (§6.2)
  { prefix: '29', category: 'DEPRECIATIONS_IMMO' }, // soustractif à l'actif (§6.3)

  // Classe 3 — Stocks (Ch.2 §2, Ch.6 §1)
  { prefix: '39', category: 'DEPRECIATIONS_STOCKS' }, // avant '3' générique : soustractif
  { prefix: '3', category: 'STOCKS' },

  // Classe 4 — Tiers. 401/411 gèrent leur propre retournement de signe dans le calcul (§2, §4).
  { prefix: '401', category: 'FOURNISSEURS' },
  { prefix: '402', category: 'FOURNISSEURS' }, // effets à payer
  { prefix: '408', category: 'FOURNISSEURS' }, // factures non parvenues
  { prefix: '411', category: 'CLIENTS' },
  { prefix: '412', category: 'CLIENTS' }, // effets à recevoir
  { prefix: '413', category: 'CLIENTS' }, // chèques/effets/cartes impayés
  { prefix: '414', category: 'CLIENTS' }, // créances sur cessions courantes d'immobilisations
  { prefix: '415', category: 'CLIENTS' }, // effets escomptés non échus
  { prefix: '416', category: 'CLIENTS' }, // clients douteux
  { prefix: '418', category: 'CLIENTS' }, // clients, factures à établir
  { prefix: '419', category: 'CLIENTS' }, // clients créditeurs (avances reçues) — signe opposé, géré par le calcul
  { prefix: '4198', category: 'AUTRES_TIERS' }, // R.R.R. à accorder — reste générique (dette envers client)
  { prefix: '499', category: 'PROVISIONS_CT' }, // provisions pour risques à court terme (Tiers) — toujours passif (§6.4)
  { prefix: '49', category: 'DEPRECIATIONS_TIERS' }, // soustractif à l'actif (créances/stocks tiers)
  { prefix: '478', category: 'ECART_CONVERSION_ACTIF' }, // pied de bilan (§7.2.3)
  { prefix: '479', category: 'ECART_CONVERSION_PASSIF' },
  { prefix: '40', category: 'AUTRES_TIERS' },
  { prefix: '41', category: 'AUTRES_TIERS' },
  { prefix: '42', category: 'AUTRES_TIERS' },
  { prefix: '43', category: 'AUTRES_TIERS' },
  { prefix: '44', category: 'AUTRES_TIERS' }, // État (TVA, impôts) — la TVA nette y reste, cf. §2.4
  { prefix: '45', category: 'AUTRES_TIERS' }, // organismes internationaux — absent de l'ancien code
  { prefix: '46', category: 'AUTRES_TIERS' },
  { prefix: '47', category: 'AUTRES_TIERS' }, // comptes transitoires hors 478/479
  { prefix: '48', category: 'AUTRES_TIERS' }, // créances/dettes sur immobilisations (le signe naturel du solde suffit à les ranger correctement)

  // Classe 5 — Trésorerie (Ch.4). 599 est une provision (passif), 590-598 une dépréciation (actif, soustractif).
  { prefix: '599', category: 'PROVISIONS_CT' }, // provisions pour risques à caractère financier (§6.4)
  { prefix: '59', category: 'DEPRECIATIONS_TRESORERIE' },
  { prefix: '5', category: 'TRESORERIE' },
];

// ---------------------------------------------------------------------------------------------
// Compte de résultat — classification des comptes de gestion (classes 6, 7, 8)
// ---------------------------------------------------------------------------------------------
// Cascade en 5 blocs (Partie 3, §3.2) : marge commerciale, chiffre d'affaires, soldes
// intermédiaires des activités ordinaires, résultat H.A.O., résultat net.
const RESULTAT_RULES = [
  // Marge commerciale (isolée avant le reste des achats — §2.2)
  { prefix: '601', category: 'ACHATS_MARCHANDISES' },
  { prefix: '6031', category: 'VARIATION_STOCK_MARCHANDISES' },
  { prefix: '701', category: 'VENTES_MARCHANDISES' },

  // Reste du chiffre d'affaires (702-707)
  { prefix: '70', category: 'CHIFFRE_AFFAIRES_AUTRE' },

  // Achats consommés (601 à 608, y compris variations 603x) — totalité de la classe 60
  { prefix: '60', category: 'ACHATS_CONSOMMES' },

  // Autres produits d'exploitation entrant dans le calcul de la Valeur Ajoutée (71,72,73,75,781)
  { prefix: '71', category: 'AUTRES_PRODUITS_EXPLOITATION' },
  { prefix: '72', category: 'AUTRES_PRODUITS_EXPLOITATION' },
  { prefix: '73', category: 'AUTRES_PRODUITS_EXPLOITATION' },
  { prefix: '75', category: 'AUTRES_PRODUITS_EXPLOITATION' },
  { prefix: '781', category: 'AUTRES_PRODUITS_EXPLOITATION' },
  { prefix: '78', category: 'AUTRES_PRODUITS_EXPLOITATION' }, // autres transferts de charges

  // Consommations intermédiaires (61 à 65) — avant l'Excédent Brut d'Exploitation. Détaillées par
  // sous-classe (au lieu d'un seul bloc CONSOMMATIONS_EXTERNES) pour correspondre aux lignes
  // RG/RH/RI/RJ du Compte de Résultat SYSCOHADA officiel (transports / services extérieurs /
  // impôts et taxes / autres charges), tout en gardant leur somme disponible pour la Valeur
  // Ajoutée (voir consommationsExternes = somme des 4 dans le résultat retourné ci-dessous).
  { prefix: '61', category: 'TRANSPORTS' },
  { prefix: '62', category: 'SERVICES_EXTERIEURS' },
  { prefix: '63', category: 'SERVICES_EXTERIEURS' },
  { prefix: '64', category: 'IMPOTS_TAXES' },
  { prefix: '65', category: 'AUTRES_CHARGES_GESTION' },

  // Charges de personnel
  { prefix: '66', category: 'CHARGES_PERSONNEL' },

  // Dotations / reprises d'exploitation — après l'EBE (§7.2.3, poste RL/TJ)
  { prefix: '681', category: 'DOTATIONS_EXPLOITATION' },
  { prefix: '691', category: 'DOTATIONS_EXPLOITATION' },
  { prefix: '791', category: 'REPRISES_EXPLOITATION' },
  { prefix: '798', category: 'REPRISES_EXPLOITATION' },
  { prefix: '799', category: 'REPRISES_EXPLOITATION' },

  // Résultat financier
  { prefix: '67', category: 'CHARGES_FINANCIERES' },
  { prefix: '697', category: 'CHARGES_FINANCIERES' },
  { prefix: '77', category: 'PRODUITS_FINANCIERS' },
  { prefix: '797', category: 'PRODUITS_FINANCIERS' },
  { prefix: '787', category: 'PRODUITS_FINANCIERS' },

  // Résultat hors activités ordinaires (H.A.O.)
  { prefix: '81', category: 'CHARGES_HAO' },
  { prefix: '83', category: 'CHARGES_HAO' },
  { prefix: '85', category: 'CHARGES_HAO' }, // dotations HAO (851-854)
  { prefix: '82', category: 'PRODUITS_HAO' },
  { prefix: '84', category: 'PRODUITS_HAO' },
  { prefix: '86', category: 'PRODUITS_HAO' }, // reprises HAO (861-864)
  { prefix: '88', category: 'PRODUITS_HAO' }, // subventions d'équilibre

  // Lignes finales du résultat net (§7.2.3, hors résultat des activités ordinaires / H.A.O.)
  { prefix: '87', category: 'PARTICIPATION_TRAVAILLEURS' },
  { prefix: '89', category: 'IMPOTS_RESULTAT' },
];

// Trie chaque table par longueur de préfixe décroissante une seule fois, pour que la
// correspondance "la plus spécifique d'abord" (ex: 6031 avant 60, 401 avant 40) soit fiable
// quel que soit l'ordre de déclaration ci-dessus.
const byPrefixLengthDesc = (a, b) => b.prefix.length - a.prefix.length;
const SORTED_BILAN_RULES = [...BILAN_RULES].sort(byPrefixLengthDesc);
const SORTED_RESULTAT_RULES = [...RESULTAT_RULES].sort(byPrefixLengthDesc);

function matchRule(compte, sortedRules) {
  const str = String(compte || '');
  for (const rule of sortedRules) {
    if (str.startsWith(rule.prefix)) return rule.category;
  }
  return null;
}

function classifyBilan(compte) {
  return matchRule(compte, SORTED_BILAN_RULES);
}

function classifyResultat(compte) {
  return matchRule(compte, SORTED_RESULTAT_RULES);
}

// ---------------------------------------------------------------------------------------------
// Agrégation — construit le Bilan et le Compte de Résultat conformes à partir de la balance
// (compte, total_debit, total_credit). Ne connaît rien du plan comptable propre à l'entreprise :
// seule la racine numérique du compte compte. Aucune catégorie ne "disparaît" silencieusement —
// tout compte non reconnu par les deux classifications est renvoyé dans `comptesNonClasses`.
//
// ranResultatRows (optionnel) : lignes de compte 13 "Résultat net de l'exercice" provenant
// spécifiquement d'une écriture À Nouveau (journal RAN) — c'est-à-dire le résultat non affecté
// d'un exercice antérieur, reporté tel quel à l'ouverture de celui-ci. Un compte 13 alimenté par
// tout AUTRE journal reste ignoré par BILAN_RULES (RESULTAT_NET_BILAN ci-dessous) : ce serait une
// écriture de clôture de l'exercice EN COURS, qui doublonnerait le résultat déjà recalculé depuis
// les classes 6/7/8. Seul un RAN représente un vrai élément de capitaux propres d'ouverture ; il
// est donc traité ici comme un report à nouveau (même masse, même ligne d'affichage).
function computeEtatsFinanciers(rows, ranResultatRows = []) {
  const b = {
    // valeurs brutes accumulées par catégorie, avant mise en forme
    capital: 0, reserves: 0, reportANouveau: 0, subventionsInvestissement: 0, provisionsReglementees: 0,
    dettesFinancieres: 0, provisionsRisques: 0,
    immoIncorpBrut: 0, immoCorpBrut: 0, immoFinBrut: 0,
    amortissements: 0, depreciationsImmo: 0,
    stocksBrut: 0, depreciationsStocks: 0,
    fournisseursCredit: 0, fournisseursDebitReverse: 0,
    clientsDebit: 0, clientsCreditReverse: 0,
    autresTiersDebit: 0, autresTiersCredit: 0,
    depreciationsTiers: 0, provisionsCT: 0,
    tresorerieDebit: 0, tresorerieCredit: 0, depreciationsTresorerie: 0,
    ecartConversionActif: 0, ecartConversionPassif: 0,
  };

  const r = {
    achatsMarchandises: 0, variationStockMarchandises: 0, ventesMarchandises: 0,
    chiffreAffairesAutre: 0, achatsConsommes: 0,
    autresProduitsExploitation: 0,
    transports: 0, servicesExterieurs: 0, impotsTaxes: 0, autresChargesGestion: 0,
    chargesPersonnel: 0,
    dotationsExploitation: 0, reprisesExploitation: 0,
    chargesFinancieres: 0, produitsFinancieres: 0,
    chargesHAO: 0, produitsHAO: 0,
    participationTravailleurs: 0, impotsResultat: 0,
  };

  const comptesNonClasses = [];

  // Détail par compte de chaque masse agrégée (clés miroir de `b`/`r` ci-dessus), pour permettre au
  // frontend d'afficher les comptes qui composent un poste du Bilan/Résultat au clic (drill-down).
  const details = {};
  const resultatDetails = [];
  const pushDetail = (bucket, compte, debit, credit) => {
    if (!details[bucket]) details[bucket] = [];
    details[bucket].push({ compte, debit, credit });
  };

  (rows || []).forEach(row => {
    const compte = String(row.compte || '');
    const debit = row.total_debit || 0;
    const credit = row.total_credit || 0;
    const netDeb = debit - credit;
    const netCred = credit - debit;

    const bilanCat = classifyBilan(compte);
    const resultatCat = classifyResultat(compte);

    if (bilanCat) {
      switch (bilanCat) {
        case 'CAPITAL': b.capital += netCred; pushDetail('capital', compte, debit, credit); break;
        case 'RESERVES': b.reserves += netCred; pushDetail('reserves', compte, debit, credit); break;
        case 'REPORT_A_NOUVEAU': b.reportANouveau += netCred; pushDetail('reportANouveau', compte, debit, credit); break; // signé : + si créditeur, - si débiteur
        case 'RESULTAT_NET_BILAN': break; // ignoré : le résultat net réel vient du compte de résultat (voir plus bas)
        case 'SUBVENTIONS_INVESTISSEMENT': b.subventionsInvestissement += netCred; pushDetail('subventionsInvestissement', compte, debit, credit); break;
        case 'PROVISIONS_REGLEMENTEES': b.provisionsReglementees += netCred; pushDetail('provisionsReglementees', compte, debit, credit); break;
        case 'DETTES_FINANCIERES': b.dettesFinancieres += netCred; pushDetail('dettesFinancieres', compte, debit, credit); break;
        case 'PROVISIONS_RISQUES': b.provisionsRisques += netCred; pushDetail('provisionsRisques', compte, debit, credit); break;
        case 'IMMO_INCORPORELLES': b.immoIncorpBrut += netDeb; pushDetail('immoIncorpBrut', compte, debit, credit); break;
        case 'IMMO_CORPORELLES': b.immoCorpBrut += netDeb; pushDetail('immoCorpBrut', compte, debit, credit); break;
        case 'IMMO_FINANCIERES': b.immoFinBrut += netDeb; pushDetail('immoFinBrut', compte, debit, credit); break;
        case 'AMORTISSEMENTS': b.amortissements += netCred; pushDetail('amortissements', compte, debit, credit); break;
        case 'DEPRECIATIONS_IMMO': b.depreciationsImmo += netCred; pushDetail('depreciationsImmo', compte, debit, credit); break;
        case 'STOCKS': b.stocksBrut += netDeb; pushDetail('stocksBrut', compte, debit, credit); break;
        case 'DEPRECIATIONS_STOCKS': b.depreciationsStocks += netCred; pushDetail('depreciationsStocks', compte, debit, credit); break;
        case 'FOURNISSEURS':
          // Un compte fournisseur normalement créditeur (dette) peut finir débiteur (avance versée) :
          // chaque signe doit atterrir dans sa masse propre, jamais être ignoré (§2 Achats/Ventes).
          if (netCred > 0) { b.fournisseursCredit += netCred; pushDetail('fournisseursCredit', compte, debit, credit); }
          if (netDeb > 0) { b.fournisseursDebitReverse += netDeb; pushDetail('fournisseursDebitReverse', compte, debit, credit); }
          break;
        case 'CLIENTS':
          // Symétrique : un compte client normalement débiteur (créance) peut finir créditeur
          // (avance reçue) — compte 419 (§1 Plan de comptes, constantes de numérotation).
          if (netDeb > 0) { b.clientsDebit += netDeb; pushDetail('clientsDebit', compte, debit, credit); }
          if (netCred > 0) { b.clientsCreditReverse += netCred; pushDetail('clientsCreditReverse', compte, debit, credit); }
          break;
        case 'AUTRES_TIERS':
          if (netDeb > 0) { b.autresTiersDebit += netDeb; pushDetail('autresTiersDebit', compte, debit, credit); }
          if (netCred > 0) { b.autresTiersCredit += netCred; pushDetail('autresTiersCredit', compte, debit, credit); }
          break;
        case 'DEPRECIATIONS_TIERS': b.depreciationsTiers += netCred; pushDetail('depreciationsTiers', compte, debit, credit); break;
        case 'PROVISIONS_CT': b.provisionsCT += netCred; pushDetail('provisionsCT', compte, debit, credit); break;
        case 'TRESORERIE':
          // Une banque/caisse normalement débitrice peut finir créditrice (découvert) : traitée
          // comme du passif de trésorerie plutôt que d'être ignorée (§4 Opérations de trésorerie).
          if (netDeb > 0) { b.tresorerieDebit += netDeb; pushDetail('tresorerieDebit', compte, debit, credit); }
          if (netCred > 0) { b.tresorerieCredit += netCred; pushDetail('tresorerieCredit', compte, debit, credit); }
          break;
        case 'DEPRECIATIONS_TRESORERIE': b.depreciationsTresorerie += netCred; pushDetail('depreciationsTresorerie', compte, debit, credit); break;
        case 'ECART_CONVERSION_ACTIF': b.ecartConversionActif += netDeb; pushDetail('ecartConversionActif', compte, debit, credit); break;
        case 'ECART_CONVERSION_PASSIF': b.ecartConversionPassif += netCred; pushDetail('ecartConversionPassif', compte, debit, credit); break;
        default: break;
      }
    }

    if (resultatCat) {
      resultatDetails.push({ compte, debit, credit });
      switch (resultatCat) {
        case 'ACHATS_MARCHANDISES': r.achatsMarchandises += netDeb; break;
        case 'VARIATION_STOCK_MARCHANDISES': r.variationStockMarchandises += netDeb; break;
        case 'VENTES_MARCHANDISES': r.ventesMarchandises += netCred; break;
        case 'CHIFFRE_AFFAIRES_AUTRE': r.chiffreAffairesAutre += netCred; break;
        case 'ACHATS_CONSOMMES': r.achatsConsommes += netDeb; break;
        case 'AUTRES_PRODUITS_EXPLOITATION': r.autresProduitsExploitation += netCred; break;
        case 'TRANSPORTS': r.transports += netDeb; break;
        case 'SERVICES_EXTERIEURS': r.servicesExterieurs += netDeb; break;
        case 'IMPOTS_TAXES': r.impotsTaxes += netDeb; break;
        case 'AUTRES_CHARGES_GESTION': r.autresChargesGestion += netDeb; break;
        case 'CHARGES_PERSONNEL': r.chargesPersonnel += netDeb; break;
        case 'DOTATIONS_EXPLOITATION': r.dotationsExploitation += netDeb; break;
        case 'REPRISES_EXPLOITATION': r.reprisesExploitation += netCred; break;
        case 'CHARGES_FINANCIERES': r.chargesFinancieres += netDeb; break;
        case 'PRODUITS_FINANCIERS': r.produitsFinancieres += netCred; break;
        case 'CHARGES_HAO': r.chargesHAO += netDeb; break;
        case 'PRODUITS_HAO': r.produitsHAO += netCred; break;
        case 'PARTICIPATION_TRAVAILLEURS': r.participationTravailleurs += netDeb; break;
        case 'IMPOTS_RESULTAT': r.impotsResultat += netDeb; break;
        default: break;
      }
    }

    if (!bilanCat && !resultatCat && compte) {
      comptesNonClasses.push(compte);
    }
  });

  (ranResultatRows || []).forEach(row => {
    const compte = String(row.compte || '');
    const debit = row.debit || 0;
    const credit = row.credit || 0;
    b.reportANouveau += credit - debit;
    pushDetail('reportANouveau', compte, debit, credit);
  });

  // --- Compte de résultat : cascade Partie 3 §3.2 ---
  // Chaque compte n'est classé que sous UNE seule catégorie (préfixe le plus spécifique) : 601 et
  // 6031 tombent dans ACHATS_MARCHANDISES / VARIATION_STOCK_MARCHANDISES (pour la marge
  // commerciale) plutôt que dans le générique ACHATS_CONSOMMES ('60'). Pour la Valeur Ajoutée, qui
  // porte sur la totalité des comptes 601 à 608 (§3.2), il faut donc les additionner explicitement :
  // ils font partie des deux calculs à la fois, sans y être comptés une seconde fois l'un dans
  // l'autre.
  const achatsConsommesTotal = r.achatsMarchandises + r.variationStockMarchandises + r.achatsConsommes;
  const margeCommerciale = r.ventesMarchandises - r.achatsMarchandises - r.variationStockMarchandises;
  const chiffreAffaires = r.ventesMarchandises + r.chiffreAffairesAutre;
  const consommationsExternes = r.transports + r.servicesExterieurs + r.impotsTaxes + r.autresChargesGestion;
  const valeurAjoutee = (chiffreAffaires + r.autresProduitsExploitation) - achatsConsommesTotal - consommationsExternes;
  const excedentBrutExploitation = valeurAjoutee - r.chargesPersonnel;
  const resultatExploitation = excedentBrutExploitation - r.dotationsExploitation + r.reprisesExploitation;
  const resultatFinancier = r.produitsFinancieres - r.chargesFinancieres;
  const resultatActivitesOrdinaires = resultatExploitation + resultatFinancier;
  const resultatHAO = r.produitsHAO - r.chargesHAO;
  const resultatNet = resultatActivitesOrdinaires + resultatHAO - r.participationTravailleurs - r.impotsResultat;

  const resultat = {
    ventesMarchandises: r.ventesMarchandises,
    achatsMarchandises: r.achatsMarchandises,
    variationStockMarchandises: r.variationStockMarchandises,
    chiffreAffairesAutre: r.chiffreAffairesAutre,
    margeCommerciale,
    chiffreAffaires,
    autresProduitsExploitation: r.autresProduitsExploitation,
    achatsConsommes: achatsConsommesTotal,
    // Composante brute de achatsConsommes (achats hors marchandises, ligne RE "Autres achats" du
    // DSF officiel) : achatsConsommes reste le TOTAL (marchandises + variation + celle-ci), déjà
    // utilisé ailleurs (dsfEngine.js, ComptabiliteModule.jsx) — ne pas les confondre.
    achatsMatieresAutres: r.achatsConsommes,
    consommationsExternes,
    transports: r.transports,
    servicesExterieurs: r.servicesExterieurs,
    impotsTaxes: r.impotsTaxes,
    autresChargesGestion: r.autresChargesGestion,
    valeurAjoutee,
    chargesPersonnel: r.chargesPersonnel,
    excedentBrutExploitation,
    dotationsExploitation: r.dotationsExploitation,
    reprisesExploitation: r.reprisesExploitation,
    resultatExploitation,
    produitsFinanciers: r.produitsFinancieres,
    chargesFinancieres: r.chargesFinancieres,
    resultatFinancier,
    resultatActivitesOrdinaires,
    produitsHAO: r.produitsHAO,
    chargesHAO: r.chargesHAO,
    resultatHAO,
    participationTravailleurs: r.participationTravailleurs,
    impotsResultat: r.impotsResultat,
    resultatNet,
  };

  // --- Bilan : masses Partie 3 §2 ---
  const immobilisationsIncorporelles = {
    brut: b.immoIncorpBrut,
    // Les comptes 28/29 démembrent 21 à 27 confondus : on ne peut pas répartir précisément
    // amortissements/dépréciations entre incorporel/corporel/financier depuis la seule balance
    // agrégée par racine de compte. On rattache donc l'ensemble aux immobilisations corporelles,
    // masse la plus fréquemment concernée en pratique, plutôt que de le faire disparaître.
    amortissements: 0,
    depreciations: 0,
    net: b.immoIncorpBrut,
  };
  const totalAmortDeprecCorpIncorp = b.amortissements + b.depreciationsImmo;
  const immobilisationsCorporelles = {
    brut: b.immoCorpBrut,
    amortissements: b.amortissements,
    depreciations: b.depreciationsImmo,
    net: b.immoCorpBrut - totalAmortDeprecCorpIncorp,
  };
  const immobilisationsFinancieres = {
    brut: b.immoFinBrut,
    depreciations: 0,
    net: b.immoFinBrut,
  };
  // Compense le rattachement ci-dessus : le net global reste exact même si la ventilation par
  // sous-masse incorporel/corporel est approximative.
  const totalImmobilisationsNettes = (b.immoIncorpBrut + b.immoCorpBrut + b.immoFinBrut) - totalAmortDeprecCorpIncorp;
  immobilisationsCorporelles.net = totalImmobilisationsNettes - immobilisationsIncorporelles.net - immobilisationsFinancieres.net;

  const stocks = { brut: b.stocksBrut, depreciations: b.depreciationsStocks, net: b.stocksBrut - b.depreciationsStocks };

  // Les dépréciations de créances (comptes 49, hors 499) sont connues globalement mais pas
  // ventilables par nature de tiers depuis la seule balance agrégée : elles s'imputent
  // entièrement sur les créances clients, qui en sont le cas d'usage dominant (§6.3). Le net
  // n'est volontairement jamais plafonné à zéro : la contrepartie de cette dépréciation (compte
  // 6594) a déjà réduit le résultat, donc le capital des masses actif/passif reste équilibré
  // uniquement si aucune valeur n'est perdue en route par un plafonnement artificiel.
  const creancesClientsBrut = b.clientsDebit;
  const creancesClients = {
    brut: creancesClientsBrut,
    depreciations: b.depreciationsTiers,
    net: creancesClientsBrut - b.depreciationsTiers,
  };

  const autresCreances = b.fournisseursDebitReverse + b.autresTiersDebit;
  const totalActifCirculant = stocks.net + creancesClients.net + autresCreances;

  const tresorerieActifNet = b.tresorerieDebit - b.depreciationsTresorerie;
  const tresoreriePassif = b.tresorerieCredit;

  const totalCapitauxPropres = b.capital + b.reserves + b.reportANouveau + resultatNet
    + b.subventionsInvestissement + b.provisionsReglementees;
  const totalRessourcesStables = totalCapitauxPropres + b.dettesFinancieres + b.provisionsRisques + b.provisionsCT;

  const dettesFournisseurs = b.fournisseursCredit;
  const autresDettes = b.clientsCreditReverse + b.autresTiersCredit;
  const totalPassifCirculant = dettesFournisseurs + autresDettes;

  const totalActif = totalImmobilisationsNettes + totalActifCirculant + tresorerieActifNet + b.ecartConversionActif;
  const totalPassif = totalRessourcesStables + totalPassifCirculant + tresoreriePassif + b.ecartConversionPassif;

  // Détail par compte de chaque ligne du Bilan telle qu'affichée côté frontend (voir renderRow dans
  // ComptabiliteModule.jsx) : permet le drill-down au clic sans dupliquer la logique de classement
  // ci-dessus — chaque poste regroupe exactement les mêmes buckets `details.*` que ceux utilisés
  // pour calculer sa valeur agrégée.
  const dget = (bucket) => details[bucket] || [];
  const posteDetails = {
    immobilisationsIncorporelles: dget('immoIncorpBrut'),
    immobilisationsCorporelles: [...dget('immoCorpBrut'), ...dget('amortissements'), ...dget('depreciationsImmo')],
    immobilisationsFinancieres: dget('immoFinBrut'),
    stocks: [...dget('stocksBrut'), ...dget('depreciationsStocks')],
    creancesClients: [...dget('clientsDebit'), ...dget('depreciationsTiers')],
    autresCreances: [...dget('fournisseursDebitReverse'), ...dget('autresTiersDebit')],
    tresorerieActif: [...dget('tresorerieDebit'), ...dget('depreciationsTresorerie')],
    ecartConversionActif: dget('ecartConversionActif'),

    capital: dget('capital'),
    reserves: dget('reserves'),
    reportANouveau: dget('reportANouveau'),
    resultatNetExercice: resultatDetails,
    subventionsInvestissement: dget('subventionsInvestissement'),
    provisionsReglementees: dget('provisionsReglementees'),
    dettesFinancieres: dget('dettesFinancieres'),
    provisionsRisquesCharges: [...dget('provisionsRisques'), ...dget('provisionsCT')],
    dettesFournisseurs: dget('fournisseursCredit'),
    autresDettes: [...dget('clientsCreditReverse'), ...dget('autresTiersCredit')],
    tresoreriePassif: dget('tresorerieCredit'),
    ecartConversionPassif: dget('ecartConversionPassif'),
  };

  const bilan = {
    actif: {
      immobilisationsIncorporelles,
      immobilisationsCorporelles,
      immobilisationsFinancieres,
      totalImmobilisationsNettes,
      stocks,
      creancesClients,
      autresCreances,
      // Composantes d'autresCreances, exposées séparément pour les lignes DSF officielles qui les
      // distinguent (BH "Fournisseurs avances versées" vs BJ "Autres créances") — autresCreances
      // reste leur somme, inchangé, pour la compatibilité des appelants existants.
      fournisseursAvancesVersees: b.fournisseursDebitReverse,
      autresCreancesDiverses: b.autresTiersDebit,
      totalActifCirculant,
      tresorerieActif: tresorerieActifNet,
      ecartConversionActif: b.ecartConversionActif,
      totalActif,
    },
    passif: {
      capital: b.capital,
      reserves: b.reserves,
      reportANouveau: b.reportANouveau,
      resultatNetExercice: resultatNet,
      subventionsInvestissement: b.subventionsInvestissement,
      provisionsReglementees: b.provisionsReglementees,
      totalCapitauxPropres,
      dettesFinancieres: b.dettesFinancieres,
      provisionsRisquesCharges: b.provisionsRisques + b.provisionsCT,
      totalRessourcesStables,
      dettesFournisseurs,
      autresDettes,
      // Composantes d'autresDettes, exposées séparément pour DI "Clients, avances reçues" vs DM
      // "Autres dettes" du DSF officiel — autresDettes reste leur somme, inchangé.
      clientsAvancesRecues: b.clientsCreditReverse,
      autresDettesDiverses: b.autresTiersCredit,
      totalPassifCirculant,
      tresoreriePassif,
      ecartConversionPassif: b.ecartConversionPassif,
      totalPassif,
    },
    details: posteDetails,
  };

  return { bilan, resultat, comptesNonClasses };
}

module.exports = { classifyBilan, classifyResultat, computeEtatsFinanciers };
