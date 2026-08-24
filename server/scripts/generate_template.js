const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

const templatesDir = path.join(__dirname, 'public', 'templates');
if (!fs.existsSync(templatesDir)) {
  fs.mkdirSync(templatesDir, { recursive: true });
}

// Données démo pour le modèle de saisie de factures et reçus de paiement
const invoiceData = [
  {
    "Date": "2026-05-10",
    "Type_Piece": "Achat",
    "Numero_Facture": "FA-2026-088",
    "Facture_Associee": "",
    "Nom_Tiers": "ORANGE CI",
    "Libelle_Facture": "Abonnement Internet Fibre & Lignes Flotte Mai 2026",
    "Montant_HT": 150000,
    "Taux_TVA": 19.25,
    "Montant_TTC": 178875,
    "Mode_Paiement": "Banque",
    "Statut_Paiement": "Payé",
    "Montant_Paye": 178875
  },
  {
    "Date": "2026-05-12",
    "Type_Piece": "Achat",
    "Numero_Facture": "FA-2026-104",
    "Facture_Associee": "",
    "Nom_Tiers": "TOTAL ENERGIES",
    "Libelle_Facture": "Carburant Véhicules de Service & Cartes Pass",
    "Montant_HT": 80000,
    "Taux_TVA": 19.25,
    "Montant_TTC": 95400,
    "Mode_Paiement": "Caisse",
    "Statut_Paiement": "Payé",
    "Montant_Paye": 95400
  },
  {
    "Date": "2026-05-15",
    "Type_Piece": "Vente",
    "Numero_Facture": "VT-2026-015",
    "Facture_Associee": "",
    "Nom_Tiers": "SOCIETE KOUASSI & FILS",
    "Libelle_Facture": "Prestation de conseil et assistance comptable",
    "Montant_HT": 500000,
    "Taux_TVA": 19.25,
    "Montant_TTC": 596250,
    "Mode_Paiement": "Banque",
    "Statut_Paiement": "Partiel",
    "Montant_Paye": 300000
  },
  {
    "Date": "2026-05-18",
    "Type_Piece": "Achat",
    "Numero_Facture": "LOYER-0526",
    "Facture_Associee": "",
    "Nom_Tiers": "SCI LES PALMIERS",
    "Libelle_Facture": "Loyer Mensuel Siège Social Mai 2026",
    "Montant_HT": 350000,
    "Taux_TVA": 0,
    "Montant_TTC": 350000,
    "Mode_Paiement": "Banque",
    "Statut_Paiement": "Non payé",
    "Montant_Paye": 0
  },
  {
    "Date": "2026-05-25",
    "Type_Piece": "Reçu Achat",
    "Numero_Facture": "REC-0526-001",
    "Facture_Associee": "LOYER-0526",
    "Nom_Tiers": "SCI LES PALMIERS",
    "Libelle_Facture": "Reçu de paiement du Loyer Mai 2026 sur facture antérieure LOYER-0526",
    "Montant_HT": 0,
    "Taux_TVA": 0,
    "Montant_TTC": 350000,
    "Mode_Paiement": "Banque",
    "Statut_Paiement": "Payé",
    "Montant_Paye": 350000
  },
  {
    "Date": "2026-05-28",
    "Type_Piece": "Reçu Vente",
    "Numero_Facture": "REC-VT-002",
    "Facture_Associee": "VT-2026-015",
    "Nom_Tiers": "SOCIETE KOUASSI & FILS",
    "Libelle_Facture": "Reçu d'encaissement solde sur facture antérieure VT-2026-015",
    "Montant_HT": 0,
    "Taux_TVA": 0,
    "Montant_TTC": 296250,
    "Mode_Paiement": "Banque",
    "Statut_Paiement": "Payé",
    "Montant_Paye": 296250
  }
];

const instructionsData = [
  { "Champ": "Date", "Description": "Date de la pièce au format YYYY-MM-DD (ex: 2026-05-10)", "Obligatoire": "Oui" },
  { "Champ": "Type_Piece", "Description": "'Achat' (facture fournisseur), 'Vente' (facture client), 'Reçu Achat' (règlement sur facture antérieure d'achat) ou 'Reçu Vente' (encaissement sur facture antérieure de vente)", "Obligatoire": "Oui" },
  { "Champ": "Numero_Facture", "Description": "N° de la facture ou du reçu (ex: FA-2026-088 ou REC-001)", "Obligatoire": "Oui" },
  { "Champ": "Facture_Associee", "Description": "N° de la facture antérieure concernée par le reçu (pour apurer le solde de la facture originale)", "Obligatoire": "Oui (si Reçu)" },
  { "Champ": "Nom_Tiers", "Description": "Nom du Fournisseur ou du Client (utilisé par la Mémoire Métier ML)", "Obligatoire": "Oui" },
  { "Champ": "Libelle_Facture", "Description": "Description précise de l'opération", "Obligatoire": "Oui" },
  { "Champ": "Montant_HT", "Description": "Montant Hors Taxe en FCFA (0 si Reçu de paiement isolé)", "Obligatoire": "Oui" },
  { "Champ": "Taux_TVA", "Description": "Taux de TVA en % (ex: 19.25 pour 19.25% ou 0 si exonéré)", "Obligatoire": "Non (0 par défaut)" },
  { "Champ": "Montant_TTC", "Description": "Montant TTC total en FCFA", "Obligatoire": "Oui" },
  { "Champ": "Mode_Paiement", "Description": "'Banque' ou 'Caisse'", "Obligatoire": "Oui" },
  { "Champ": "Statut_Paiement", "Description": "'Payé' (règlement total), 'Partiel' (règlement partiel) ou 'Non payé'", "Obligatoire": "Oui" },
  { "Champ": "Montant_Paye", "Description": "Montant réellement payé/encaissé en FCFA (égal au montant du reçu s'il s'agit d'un reçu isolé)", "Obligatoire": "Oui" }
];

// 1. Template Factures et Reçus
const wbFactures = xlsx.utils.book_new();
const wsInvoices = xlsx.utils.json_to_sheet(invoiceData);
wsInvoices['!cols'] = [
  { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 25 }, { wch: 55 },
  { wch: 15 }, { wch: 10 }, { wch: 15 }, { wch: 15 }, { wch: 16 }, { wch: 16 }
];
const wsInstructions = xlsx.utils.json_to_sheet(instructionsData);
wsInstructions['!cols'] = [{ wch: 18 }, { wch: 75 }, { wch: 12 }];
xlsx.utils.book_append_sheet(wbFactures, wsInvoices, "Saisie Factures");
xlsx.utils.book_append_sheet(wbFactures, wsInstructions, "Mode d'emploi");
xlsx.writeFile(wbFactures, path.join(templatesDir, 'template_saisie_factures.xlsx'));

// 2. Template Journal (Écritures Brutes)
const wbJournal = xlsx.utils.book_new();
const journalData = [
  { "Code_Journal": "AC", "Date": "2026-05-10", "Compte": "628100", "Compte_Tiers": "ORANGE CI", "Libelle": "Frais Internet Fibre Mai 2026", "N_Facture": "FA-088", "Reference": "EXCEL", "Debit": 150000, "Credit": 0 },
  { "Code_Journal": "AC", "Date": "2026-05-10", "Compte": "445200", "Compte_Tiers": "ORANGE CI", "Libelle": "TVA Déductible 19.25%", "N_Facture": "FA-088", "Reference": "EXCEL", "Debit": 28875, "Credit": 0 },
  { "Code_Journal": "AC", "Date": "2026-05-10", "Compte": "401100", "Compte_Tiers": "ORANGE CI", "Libelle": "Fournisseur Orange CI", "N_Facture": "FA-088", "Reference": "EXCEL", "Debit": 0, "Credit": 178875 }
];
const wsJournal = xlsx.utils.json_to_sheet(journalData);
wsJournal['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 35 }, { wch: 15 }, { wch: 12 }, { wch: 14 }, { wch: 14 }];
xlsx.utils.book_append_sheet(wbJournal, wsJournal, "Journal Écritures");
xlsx.writeFile(wbJournal, path.join(templatesDir, 'template_journal.xlsx'));

// 3. Template Tiers (Clients / Fournisseurs)
const wbTiers = xlsx.utils.book_new();
const tiersData = [
  { "Type": "Fournisseur", "Nom": "ORANGE CI", "Compte": "401100", "Solde": 0 },
  { "Type": "Fournisseur", "Nom": "TOTAL ENERGIES", "Compte": "401101", "Solde": 0 },
  { "Type": "Client", "Nom": "SOCIETE KOUASSI & FILS", "Compte": "411100", "Solde": 0 }
];
const wsTiers = xlsx.utils.json_to_sheet(tiersData);
wsTiers['!cols'] = [{ wch: 15 }, { wch: 30 }, { wch: 15 }, { wch: 15 }];
xlsx.utils.book_append_sheet(wbTiers, wsTiers, "Répertoire Tiers");
xlsx.writeFile(wbTiers, path.join(templatesDir, 'template_tiers.xlsx'));

console.log('Les 3 modèles Excel ont été générés avec succès dans :', templatesDir);
