const express = require('express');
const cors = require('cors');
const multer = require('multer');
const xlsx = require('xlsx');
const { PDFParse } = require('pdf-parse');
const db = require('./db');
const { askAI, matchTransactionWithMemory, learnFromJournalData, friendlyAiErrorMessage } = require('./ai');

const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// Serve public/exports directory for generated files
const exportsDir = path.join(__dirname, 'public', 'exports');
if (!fs.existsSync(exportsDir)) {
  fs.mkdirSync(exportsDir, { recursive: true });
}
app.use('/public', express.static(path.join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage() });

// --- EXERCICES COMPTABLES ---
// journal.date reste une simple chaîne ISO (YYYY-MM-DD) : filtrer par exercice consiste à
// comparer cette chaîne (comparaison lexicographique valide pour ISO) aux bornes de l'exercice
// actif, sans avoir besoin d'une colonne exercice_id sur journal. L'exercice actif est une
// sélection globale côté serveur (clé 'SELECTED_EXERCICE_ID' dans settings) : les modules du
// front n'ont rien à transmettre, ils continuent d'appeler les mêmes routes qu'avant.
async function getActiveExercice() {
  const settingsRows = await db.runSelect("SELECT value FROM settings WHERE key = 'SELECTED_EXERCICE_ID'");
  const id = settingsRows[0] && settingsRows[0].value;
  if (!id) return null;
  const rows = await db.runSelect("SELECT id, libelle, date_debut, date_fin FROM exercices WHERE id = ?", [id]);
  return rows[0] || null;
}

// Retourne un fragment SQL prêt à insérer après WHERE/AND, et ses paramètres. Fragment vide si
// aucun exercice n'est sélectionné (comportement inchangé : tout le journal est pris en compte).
async function getExerciceDateFilter() {
  const ex = await getActiveExercice();
  if (!ex) return { clause: '', params: [] };
  return { clause: 'date >= ? AND date <= ?', params: [ex.date_debut, ex.date_fin] };
}

app.get('/api/exercices', (req, res) => {
  db.all("SELECT * FROM exercices ORDER BY date_debut DESC", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.post('/api/exercices', (req, res) => {
  const { libelle, date_debut, date_fin } = req.body;
  if (!libelle || !date_debut || !date_fin) {
    return res.status(400).json({ error: "Libellé, date de début et date de fin sont obligatoires." });
  }
  if (date_debut > date_fin) {
    return res.status(400).json({ error: "La date de début doit précéder la date de fin." });
  }
  db.run("INSERT INTO exercices (libelle, date_debut, date_fin) VALUES (?, ?, ?)", [libelle, date_debut, date_fin], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, id: this.lastID });
  });
});

app.delete('/api/exercices/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.runUpdate("DELETE FROM exercices WHERE id = ?", [id]);
    const active = await getActiveExercice();
    if (active && String(active.id) === String(id)) {
      await db.runUpdate("UPDATE settings SET value = '' WHERE key = 'SELECTED_EXERCICE_ID'");
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/exercices/select', (req, res) => {
  const { id } = req.body; // id vide/absent = désélectionner (revenir à "tout le journal")
  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('SELECTED_EXERCICE_ID', ?)", [id || ''], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.get('/api/exercices/active', async (req, res) => {
  try {
    res.json(await getActiveExercice());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- SETTINGS ROUTES ---
app.get('/api/settings', (req, res) => {
  db.all("SELECT key, value FROM settings", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const settings = {};
    rows.forEach(r => settings[r.key] = r.value);
    res.json(settings);
  });
});

app.post('/api/settings', (req, res) => {
  const { GEMINI_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY, DEFAULT_AI, OPENAI_BASE_URL, OPENAI_MODEL } = req.body;
  const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
  
  if (GEMINI_API_KEY !== undefined) stmt.run('GEMINI_API_KEY', GEMINI_API_KEY);
  if (OPENAI_API_KEY !== undefined) stmt.run('OPENAI_API_KEY', OPENAI_API_KEY);
  if (DEEPSEEK_API_KEY !== undefined) stmt.run('DEEPSEEK_API_KEY', DEEPSEEK_API_KEY);
  if (DEFAULT_AI !== undefined) stmt.run('DEFAULT_AI', DEFAULT_AI);
  if (OPENAI_BASE_URL !== undefined) stmt.run('OPENAI_BASE_URL', OPENAI_BASE_URL);
  if (OPENAI_MODEL !== undefined) stmt.run('OPENAI_MODEL', OPENAI_MODEL);
  
  stmt.finalize();
  res.json({ success: true });
});

// --- AI CHAT ROUTE ---
app.post('/api/chat', async (req, res) => {
  try {
    const { message, history } = req.body;
    const aiResponse = await askAI(message, history);
    if (aiResponse && typeof aiResponse === 'object') {
      res.json({ response: aiResponse.text, proposal: aiResponse.proposal });
    } else {
      res.json({ response: aiResponse });
    }
  } catch (error) {
    console.error("AI Error:", error);
    res.status(500).json({ error: error.message ? friendlyAiErrorMessage(error) : "Erreur de communication avec l'IA. Vérifiez vos clés API." });
  }
});

// --- IMPORT DATA ROUTE ---
// Les dates Excel arrivent dans des formes très variables selon le formatage de la cellule
// source (déjà vu en prod : "020126" pour le 02/01/2026, sans séparateur, ce qui cassait le tri
// chronologique du Grand Livre et le filtrage par exercice). On normalise systématiquement vers
// ISO YYYY-MM-DD à l'import, jamais après coup dans les requêtes de lecture.
function normalizeDate(value) {
  if (value === null || value === undefined || value === '') return '';

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();

  if (value instanceof Date && !isNaN(value)) {
    return value.toISOString().split('T')[0];
  }

  if (typeof value === 'number') {
    // Numéro de série Excel (jours écoulés depuis le 30/12/1899, avec le bug de l'an 1900).
    const excelEpoch = Date.UTC(1899, 11, 30);
    return new Date(excelEpoch + value * 86400000).toISOString().split('T')[0];
  }

  const str = String(value).trim();

  let m = str.match(/^(\d{2})(\d{2})(\d{2})$/); // DDMMYY sans séparateur
  if (m) {
    const [, dd, mm, yy] = m;
    const yyyy = parseInt(yy, 10) < 50 ? `20${yy}` : `19${yy}`;
    return `${yyyy}-${mm}-${dd}`;
  }

  m = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/); // DD/MM/YYYY
  if (m) {
    const [, dd, mm, yyyy] = m;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }

  m = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2})$/); // DD/MM/YY
  if (m) {
    const [, dd, mm, yy] = m;
    const yyyy = parseInt(yy, 10) < 50 ? `20${yy}` : `19${yy}`;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }

  // Format non reconnu : on garde la valeur brute plutôt que de perdre l'information,
  // mais elle ne triera/filtrera pas correctement tant qu'elle n'est pas corrigée à la main.
  return str;
}

app.post('/api/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier fourni' });
  const type = req.body.type; // 'tiers', 'journal'

  try {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    if (type === 'tiers') {
      const stmt = db.prepare(`
        INSERT INTO tiers (type, nom, compte_comptable, solde, statut) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(nom) DO UPDATE SET
          type = excluded.type,
          compte_comptable = excluded.compte_comptable,
          solde = excluded.solde,
          statut = excluded.statut
      `);
      data.forEach(row => {
        // Normaliser les clés
        const normRow = {};
        for(let key in row) normRow[key.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()] = row[key];
        
        stmt.run(normRow['type'] || 'Client', normRow['nom'] || 'Inconnu', normRow['compte'] || '', parseFloat(normRow['solde']) || 0, 'Actif');
      });
      stmt.finalize();
      res.json({ success: true, message: `${data.length} tiers importés avec succès.` });
    } else if (type === 'journal') {
      db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        const stmt = db.prepare("INSERT INTO journal (code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference, debit, credit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        let inserted = 0;
        const journalRows = [];
        data.forEach(row => {
          const normRow = {};
          for(let key in row) {
             const normKey = key.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
             normRow[normKey] = row[key];
          }

          const code_journal = normRow['codejournal'] || '';
          const poste_budgetaire = normRow['postebudgetaire'] || '';
          const date = normalizeDate(normRow['date']);
          const compte = String(normRow['compte'] || normRow['comptegeneral'] || normRow['ncompte'] || normRow['numcompte'] || normRow['comptecomptable'] || '');
          const compte_tiers = String(normRow['comptetiers'] || '');
          const libelle = normRow['libelle'] || normRow['libelleecriture'] || normRow['designation'] || normRow['description'] || '';
          const n_facture = String(normRow['nfacture'] || normRow['numfacture'] || '');
          const reference = String(normRow['reference'] || '');
          const debit = parseFloat(normRow['debit']) || parseFloat(normRow['montantdebit']) || 0;
          const credit = parseFloat(normRow['credit']) || parseFloat(normRow['montantcredit']) || 0;

          if (compte || debit > 0 || credit > 0) {
            journalRows.push({ code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference, debit, credit });
            inserted++;
          }
        });

        // Un fichier journal complet doit rester équilibré dans son ensemble.
        const totalDebit = journalRows.reduce((s, r) => s + r.debit, 0);
        const totalCredit = journalRows.reduce((s, r) => s + r.credit, 0);
        if (Math.abs(totalDebit - totalCredit) > 0.01) {
          db.run("ROLLBACK");
          const gap = Math.round(Math.abs(totalDebit - totalCredit));
          const isDebitLarger = totalDebit > totalCredit;
          const targetAccount = isDebitLarger ? '401100' : '411100';
          const targetLabel = isDebitLarger 
            ? 'Régularisation Contrepartie Fournisseur (Équilibrage SYSCOHADA)' 
            : 'Régularisation Contrepartie Client (Équilibrage SYSCOHADA)';
          const codeJournal = isDebitLarger ? 'AC' : 'VE';
          const refDate = journalRows[0] ? journalRows[0].date : new Date().toISOString().split('T')[0];

          return res.status(400).json({
            error: `Fichier rejeté : le total des débits (${totalDebit.toLocaleString()}) ne correspond pas au total des crédits (${totalCredit.toLocaleString()}), écart de ${gap.toLocaleString()}. Corrigez le fichier avant de réimporter.`,
            imbalance: {
              totalDebit,
              totalCredit,
              gap,
              isDebitLarger,
              suggestedAccount: targetAccount,
              suggestedLabel: targetLabel,
              balancingRow: {
                code_journal: codeJournal,
                poste_budgetaire: 'RÉGULARISATION',
                date: refDate,
                compte: targetAccount,
                compte_tiers: isDebitLarger ? 'FOURNISSEUR RÉGULARISATION' : 'CLIENT RÉGULARISATION',
                libelle: targetLabel,
                n_facture: 'REG-AUTO',
                reference: 'EQUILIBRE-SYSCOHADA',
                debit: isDebitLarger ? 0 : gap,
                credit: isDebitLarger ? gap : 0
              }
            }
          });
        }

        journalRows.forEach(r => {
          stmt.run(r.code_journal, r.poste_budgetaire, r.date, r.compte, r.compte_tiers, r.libelle, r.n_facture, r.reference, r.debit, r.credit);
        });
        stmt.finalize();
        db.run("COMMIT", async (err) => {
          if (err) {
            console.error("COMMIT ERROR:", err);
            res.status(500).json({ error: 'Erreur lors de la sauvegarde en base.' });
          } else {
            // Apprentissage automatique des règles depuis le journal importé (ML)
            let learnedCount = 0;
            try {
              learnedCount = await learnFromJournalData(data);
            } catch (e) {
              console.error("Erreur apprentissage ML:", e);
            }

            let msg = `${inserted} écritures importées avec succès.`;
            if (learnedCount > 0) {
              msg += ` 🧠 La Mémoire Métier a appris ${learnedCount} nouvelle(s) règle(s) d'imputation !`;
            }
            res.json({ success: true, message: msg });
          }
        });
      });
    } else if (type === 'factures') {
      // Saisie automatique d'écritures comptables depuis le modèle Excel de factures
      db.serialize(async () => {
        const stmt = db.prepare("INSERT INTO journal (code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference, debit, credit, piece_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        let totalInvoices = 0;
        let totalEntriesCreated = 0;
        const journalEntriesForML = [];

        // Chaque facture/reçu forme une écriture (piece_id) distincte, pour permettre
        // à l'audit de vérifier l'équilibre débit=crédit par écriture.
        const maxPieceRow = await db.runSelect("SELECT COALESCE(MAX(piece_id), 0) as maxId FROM journal");
        let pieceCounter = (maxPieceRow[0] && maxPieceRow[0].maxId) || 0;
        const insertLine = (...args) => stmt.run(...args, pieceCounter);

        for (const row of data) {
          const normRow = {};
          for (let key in row) {
            const normKey = key.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
            normRow[normKey] = row[key];
          }

          const date = normalizeDate(normRow['date']) || new Date().toISOString().split('T')[0];
          const typePiece = String(normRow['typepiece'] || normRow['type'] || 'Achat').trim();
          const isRecu = typePiece.toLowerCase().includes('recu') || typePiece.toLowerCase().includes('reçu') || typePiece.toLowerCase().includes('reglement') || typePiece.toLowerCase().includes('paiement');
          const isAchat = !typePiece.toLowerCase().includes('vent');
          const numFacture = String(normRow['numerofacture'] || normRow['nfacture'] || normRow['ref'] || '');
          const factureAssociee = String(normRow['factureassociee'] || normRow['factureorig'] || normRow['nfactureassociee'] || normRow['factureref'] || '').trim();
          const nomTiers = String(normRow['nomtiers'] || normRow['tiers'] || normRow['fournisseur'] || normRow['client'] || 'TIERS DIVERS').trim();
          const libelleFacture = String(normRow['libellefacture'] || normRow['libelle'] || normRow['designation'] || 'Facture / Reçu sans libellé').trim();
          const montantHT = parseFloat(normRow['montantht']) || parseFloat(normRow['ht']) || 0;
          const tauxTVA = parseFloat(normRow['tauxtva']) || 0;
          let montantTTC = parseFloat(normRow['montantttc']) || parseFloat(normRow['ttc']) || 0;
          const modePaiement = String(normRow['modepaiement'] || normRow['paiement'] || 'Banque').trim();
          const statutPaiement = String(normRow['statutpaiement'] || normRow['statut'] || normRow['etat'] || 'Non payé').trim();
          let montantPaye = parseFloat(normRow['montantpaye']) || parseFloat(normRow['montantregle']) || parseFloat(normRow['paye']) || 0;

          if (isRecu) {
            if (montantPaye <= 0 && montantTTC > 0) montantPaye = montantTTC;
            if (montantPaye <= 0) continue;
          } else {
            if (montantHT <= 0 && montantTTC <= 0) continue;
          }

          let tvaAmount = 0;
          if (tauxTVA > 0 && montantHT > 0) {
            tvaAmount = Math.round(montantHT * (tauxTVA / 100));
            if (montantTTC <= 0) montantTTC = montantHT + tvaAmount;
          } else if (montantTTC > 0 && montantHT <= 0) {
            tvaAmount = 0;
          }

          // Ajustement automatique de montantPaye si statut est Payé mais montantPaye non saisi
          const normStatut = statutPaiement.toLowerCase();
          if ((normStatut.includes('paye') || normStatut.includes('regle')) && !normStatut.includes('non') && !normStatut.includes('partiel') && montantPaye <= 0) {
            montantPaye = montantTTC;
          }

          totalInvoices++;
          pieceCounter++;

          // Déterminer le compte de trésorerie (Banque 521100 / Caisse 571100)
          const isBanque = modePaiement.toLowerCase().includes('banq') || modePaiement.toLowerCase().includes('vire');
          const tresoAccount = isBanque ? '521100' : '571100';
          const tresoJournal = isBanque ? 'BQ' : 'CA';
          const refPiece = factureAssociee || numFacture;

          // SI C'EST UN REÇU DE PAIEMENT ISOLÉ SUR FACTURE ANTÉRIEURE
          if (isRecu) {
            if (isAchat) {
              // Reçu Achat / Règlement Fournisseur sur Facture Antérieure
              // Débit Fournisseur (401100) -> Diminution du solde Fournisseur
              insertLine(tresoJournal, 'FOURNISSEURS', date, '401100', nomTiers, `Paiement ${numFacture} (sur fact. ${refPiece})`, refPiece, modePaiement.toUpperCase(), montantPaye, 0);
              totalEntriesCreated++;

              // Crédit Trésorerie (521100/571100) -> Sortie d'argent
              insertLine(tresoJournal, 'TRÉSORERIE', date, tresoAccount, nomTiers, libelleFacture, refPiece, modePaiement.toUpperCase(), 0, montantPaye);
              totalEntriesCreated++;
            } else {
              // Reçu Vente / Encaissement Client sur Facture Antérieure
              // Débit Trésorerie (521100/571100) -> Entrée d'argent
              insertLine(tresoJournal, 'TRÉSORERIE', date, tresoAccount, nomTiers, libelleFacture, refPiece, modePaiement.toUpperCase(), montantPaye, 0);
              totalEntriesCreated++;

              // Crédit Client (411100) -> Diminution de la créance Client
              insertLine(tresoJournal, 'CLIENTS', date, '411100', nomTiers, `Encaissement ${numFacture} (sur fact. ${refPiece})`, refPiece, modePaiement.toUpperCase(), 0, montantPaye);
              totalEntriesCreated++;
            }
            continue;
          }

          // SI C'EST UNE FACTURE STANDARD (ACHAT OU VENTE)
          // Consulter la Mémoire Métier DAF & la Classification Nature SYSCOHADA
          const match = await matchTransactionWithMemory(libelleFacture, nomTiers, isAchat);
          let targetHTAccount = isAchat ? '601100' : '701100';
          let defaultJournal = isAchat ? 'AC' : 'VE';

          if (match && match.matched && match.target_account) {
            targetHTAccount = match.target_account;
            if (match.target_journal) defaultJournal = match.target_journal;
          }

          if (isAchat) {
            // 1. ÉCRITURE DE FACTURATION ACHAT (Journal AC)
            insertLine(defaultJournal, 'ACHATS', date, targetHTAccount, nomTiers, libelleFacture, numFacture, 'FACT-EXCEL', montantHT, 0);
            totalEntriesCreated++;
            journalEntriesForML.push({ libelle: libelleFacture, compte: targetHTAccount, code_journal: defaultJournal, compte_tiers: nomTiers });

            if (tvaAmount > 0) {
              insertLine(defaultJournal, 'TVA', date, '445200', nomTiers, `TVA (${tauxTVA}%) sur ${numFacture}`, numFacture, 'FACT-EXCEL', tvaAmount, 0);
              totalEntriesCreated++;
            }

            insertLine(defaultJournal, 'FOURNISSEURS', date, '401100', nomTiers, `Fact. Fournisseur ${nomTiers} - ${numFacture}`, numFacture, 'FACT-EXCEL', 0, montantTTC || montantHT);
            totalEntriesCreated++;

            // 2. ÉCRITURE DE RÈGLEMENT ACHAT (si payé totalement ou partiellement)
            if (montantPaye > 0) {
              insertLine(tresoJournal, 'FOURNISSEURS', date, '401100', nomTiers, `Paiement (${statutPaiement}) Fact. ${numFacture}`, numFacture, modePaiement.toUpperCase(), montantPaye, 0);
              totalEntriesCreated++;

              insertLine(tresoJournal, 'TRÉSORERIE', date, tresoAccount, nomTiers, `Règlement ${nomTiers} - ${numFacture}`, numFacture, modePaiement.toUpperCase(), 0, montantPaye);
              totalEntriesCreated++;
            }

          } else {
            // 1. ÉCRITURE DE FACTURATION VENTE (Journal VE)
            insertLine(defaultJournal, 'CLIENTS', date, '411100', nomTiers, `Fact. Client ${nomTiers} - ${numFacture}`, numFacture, 'FACT-EXCEL', montantTTC || montantHT, 0);
            totalEntriesCreated++;

            insertLine(defaultJournal, 'VENTES', date, targetHTAccount, nomTiers, libelleFacture, numFacture, 'FACT-EXCEL', 0, montantHT);
            totalEntriesCreated++;
            journalEntriesForML.push({ libelle: libelleFacture, compte: targetHTAccount, code_journal: defaultJournal, compte_tiers: nomTiers });

            if (tvaAmount > 0) {
              insertLine(defaultJournal, 'TVA', date, '443100', nomTiers, `TVA Facturée (${tauxTVA}%) sur ${numFacture}`, numFacture, 'FACT-EXCEL', 0, tvaAmount);
              totalEntriesCreated++;
            }

            // 2. ÉCRITURE D'ENCAISSEMENT VENTE (si encaissé totalement ou partiellement)
            if (montantPaye > 0) {
              insertLine(tresoJournal, 'TRÉSORERIE', date, tresoAccount, nomTiers, `Encaissement ${nomTiers} - ${numFacture}`, numFacture, modePaiement.toUpperCase(), montantPaye, 0);
              totalEntriesCreated++;

              insertLine(tresoJournal, 'CLIENTS', date, '411100', nomTiers, `Règlement Client (${statutPaiement}) Fact. ${numFacture}`, numFacture, modePaiement.toUpperCase(), 0, montantPaye);
              totalEntriesCreated++;
            }
          }
        }

        stmt.finalize();
        
        // Apprentissage automatique des nouvelles règles ML
        let learnedCount = 0;
        try {
          learnedCount = await learnFromJournalData(journalEntriesForML);
        } catch (e) {
          console.error("Erreur ML:", e);
        }

        let msg = `Génération automatique terminée : ${totalInvoices} facture(s) traitée(s), ${totalEntriesCreated} écriture(s) comptables équilibrées créées !`;
        if (learnedCount > 0) {
          msg += ` 🧠 La Mémoire Métier a appris ${learnedCount} nouvelle(s) règle(s) d'imputation !`;
        }
        res.json({ success: true, message: msg });
      });
    } else {
      res.status(400).json({ error: 'Type d\'import non supporté' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture du fichier Excel.' });
  }
});

// --- ROUTE DE GÉNÉRATION D'UN FICHIER EXCEL CORRIGÉ ET ÉQUILIBRÉ SYSCOHADA ---
app.post('/api/import/fix-excel', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier fourni' });

  try {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const rawData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    let totalDebit = 0;
    let totalCredit = 0;

    const parsedRows = rawData.map(row => {
      const normRow = {};
      for (let k in row) {
        const normKey = k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
        normRow[normKey] = row[k];
      }

      const debit = parseFloat(normRow['debit']) || parseFloat(normRow['montantdebit']) || 0;
      const credit = parseFloat(normRow['credit']) || parseFloat(normRow['montantcredit']) || 0;

      totalDebit += debit;
      totalCredit += credit;

      return row;
    });

    const gap = Math.round(Math.abs(totalDebit - totalCredit));
    const isDebitLarger = totalDebit > totalCredit;
    const targetAccount = isDebitLarger ? '401100' : '411100';
    const targetLabel = isDebitLarger 
      ? 'Régularisation Contrepartie Fournisseur (Équilibrage SYSCOHADA)' 
      : 'Régularisation Contrepartie Client (Équilibrage SYSCOHADA)';
    const codeJournal = isDebitLarger ? 'AC' : 'VE';

    if (gap > 0) {
      // Ajouter la ligne d'équilibrage réglementaire en partie double
      const balancingRow = {
        'Code_Journal': codeJournal,
        'Poste_Budgetaire': 'RÉGULARISATION',
        'Date': new Date().toISOString().split('T')[0],
        'Compte': targetAccount,
        'Compte_Tiers': isDebitLarger ? 'FOURNISSEUR RÉGULARISATION' : 'CLIENT RÉGULARISATION',
        'Libelle': targetLabel,
        'N_Facture': 'REG-AUTO',
        'Reference': 'EQUILIBRE-SYSCOHADA',
        'Debit': isDebitLarger ? 0 : gap,
        'Credit': isDebitLarger ? gap : 0
      };
      parsedRows.push(balancingRow);
    }

    const newSheet = xlsx.utils.json_to_sheet(parsedRows);
    const newWorkbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(newWorkbook, newSheet, "Journal_Équilibré");

    const excelBuffer = xlsx.write(newWorkbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="journal_equilibre_syscohada.xlsx"');
    res.send(excelBuffer);
  } catch (err) {
    console.error("Fix Excel Error:", err);
    res.status(500).json({ error: 'Erreur lors de la correction du fichier Excel.' });
  }
});

const handleFileUpload = (req, res, next) => {
  if (req.is('multipart/form-data')) {
    return upload.single('file')(req, res, next);
  }
  next();
};

// --- ROUTE D'ÉQUILIBRAGE ET D'IMPORTATION DIRECTE (AUTO-FIX AND IMPORT) ---
app.post('/api/import/auto-fix-and-import', handleFileUpload, async (req, res) => {
  try {
    const journalRows = [];
    let totalDebit = 0;
    let totalCredit = 0;

    if (req.file) {
      const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const rawData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

      rawData.forEach(row => {
        const normRow = {};
        for (let k in row) {
          const normKey = k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
          normRow[normKey] = row[k];
        }

        const code_journal = normRow['codejournal'] || 'AC';
        const poste_budgetaire = normRow['postebudgetaire'] || 'ACHATS';
        const date = normRow['date'] || new Date().toISOString().split('T')[0];
        const compte = String(normRow['compte'] || normRow['comptegeneral'] || normRow['ncompte'] || normRow['numcompte'] || '601100');
        const compte_tiers = String(normRow['comptetiers'] || '');
        const libelle = normRow['libelle'] || normRow['libelleecriture'] || normRow['designation'] || 'Écriture importée';
        const n_facture = String(normRow['nfacture'] || normRow['numfacture'] || '');
        const reference = String(normRow['reference'] || '');
        const debit = parseFloat(normRow['debit']) || parseFloat(normRow['montantdebit']) || 0;
        const credit = parseFloat(normRow['credit']) || parseFloat(normRow['montantcredit']) || 0;

        if (compte || debit > 0 || credit > 0) {
          journalRows.push({ code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference, debit, credit });
          totalDebit += debit;
          totalCredit += credit;
        }
      });
    } else if (req.body && Array.isArray(req.body.journalRows)) {
      req.body.journalRows.forEach(r => {
        journalRows.push(r);
        totalDebit += parseFloat(r.debit) || 0;
        totalCredit += parseFloat(r.credit) || 0;
      });
    } else {
      return res.status(400).json({ error: 'Aucun fichier ni écriture fournie.' });
    }

    const gap = Math.round(Math.abs(totalDebit - totalCredit));
    let balancingMessage = '';

    if (gap > 0) {
      const isDebitLarger = totalDebit > totalCredit;
      const targetAccount = isDebitLarger ? '401100' : '411100';
      const targetLabel = isDebitLarger 
        ? 'Régularisation Contrepartie Fournisseur (Équilibrage SYSCOHADA)' 
        : 'Régularisation Contrepartie Client (Équilibrage SYSCOHADA)';
      const codeJournal = isDebitLarger ? 'AC' : 'VE';
      const refDate = journalRows[0] ? journalRows[0].date : new Date().toISOString().split('T')[0];

      journalRows.push({
        code_journal: codeJournal,
        poste_budgetaire: 'RÉGULARISATION',
        date: refDate,
        compte: targetAccount,
        compte_tiers: isDebitLarger ? 'FOURNISSEUR RÉGULARISATION' : 'CLIENT RÉGULARISATION',
        libelle: targetLabel,
        n_facture: 'REG-AUTO',
        reference: 'EQUILIBRE-SYSCOHADA',
        debit: isDebitLarger ? 0 : gap,
        credit: isDebitLarger ? gap : 0
      });

      balancingMessage = ` (Ligne d'équilibrage de contrepartie de ${gap.toLocaleString()} FCFA insérée au compte ${targetAccount})`;
    }

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      const stmt = db.prepare("INSERT INTO journal (code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference, debit, credit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      
      journalRows.forEach(r => {
        stmt.run(r.code_journal, r.poste_budgetaire, r.date, r.compte, r.compte_tiers, r.libelle, r.n_facture, r.reference, r.debit, r.credit);
      });
      stmt.finalize();

      db.run("COMMIT", async (err) => {
        if (err) return res.status(500).json({ error: 'Erreur d\'enregistrement en base.' });
        
        let learnedCount = 0;
        try {
          learnedCount = await learnFromJournalData(journalRows);
        } catch (e) {
          console.error(e);
        }

        res.json({
          success: true,
          message: `Correction & Importation réussies : ${journalRows.length} écritures équilibrées sauvegardées !${balancingMessage}`
        });
      });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du traitement d\'auto-correction.' });
  }
});

// --- DATA ROUTES (TIERS & JOURNAL) ---
// Unifie les deux sources de tiers qui existaient séparément : le répertoire importé/saisi
// (table `tiers`) et les comptes 40/41 vus dans le journal sans fiche tiers correspondante.
// Le solde d'un tiers déjà présent dans `tiers` est toujours recalculé depuis le journal
// (jamais la valeur statique importée) pour ne jamais afficher un solde périmé.
app.get('/api/tiers', async (req, res) => {
  try {
    const { clause, params } = await getExerciceDateFilter();
    const exFilter = clause ? `AND ${clause}` : '';
    const rows = await db.runSelect(`
      SELECT
        t.id as id,
        t.nom as nom,
        t.compte_comptable as compte_comptable,
        COALESCE(j.solde, t.solde, 0) as solde,
        t.type as type
      FROM tiers t
      LEFT JOIN (
        SELECT compte_tiers, SUM(debit) - SUM(credit) as solde
        FROM journal
        WHERE compte_tiers IS NOT NULL AND compte_tiers != '' ${exFilter}
        GROUP BY compte_tiers
      ) j ON UPPER(TRIM(j.compte_tiers)) = UPPER(TRIM(t.nom))

      UNION ALL

      SELECT
        compte_tiers as id,
        compte_tiers as nom,
        MAX(compte) as compte_comptable,
        (SUM(debit) - SUM(credit)) as solde,
        CASE WHEN substr(MAX(compte), 1, 2) = '41' THEN 'Client' ELSE 'Fournisseur' END as type
      FROM journal
      WHERE compte_tiers IS NOT NULL AND compte_tiers != ''
        AND (compte LIKE '40%' OR compte LIKE '41%')
        AND UPPER(TRIM(compte_tiers)) NOT IN (SELECT UPPER(TRIM(nom)) FROM tiers)
        ${exFilter}
      GROUP BY compte_tiers

      ORDER BY type ASC, nom ASC
    `, [...params, ...params]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/journal', async (req, res) => {
  try {
    const { clause, params } = await getExerciceDateFilter();
    const rows = await db.runSelect(`SELECT * FROM journal ${clause ? `WHERE ${clause}` : ''} ORDER BY id DESC`, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Modifie une écriture du journal (accessible depuis le Journal, ou via le lien Grand Livre -> Journal).
// Ré-apprend la Mémoire Métier avec la nouvelle imputation (learnFromJournalData ignore déjà les
// comptes de tiers/trésorerie/capitaux, donc sans risque même si la ligne modifiée est une contrepartie).
app.put('/api/journal/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference, debit, credit } = req.body;
    if (!compte || !libelle || !date) {
      return res.status(400).json({ error: 'Compte, libellé et date sont obligatoires.' });
    }
    const result = await db.runUpdate(
      `UPDATE journal SET code_journal=?, poste_budgetaire=?, date=?, compte=?, compte_tiers=?, libelle=?, n_facture=?, reference=?, debit=?, credit=? WHERE id=?`,
      [code_journal || '', poste_budgetaire || '', date, compte, compte_tiers || '', libelle, n_facture || '', reference || '', Number(debit) || 0, Number(credit) || 0, id]
    );
    if (result.changes === 0) return res.status(404).json({ error: 'Écriture introuvable.' });

    try {
      await learnFromJournalData([{ libelle, compte, code_journal, compte_tiers }]);
    } catch (e) {
      console.error('Erreur apprentissage ML après modification:', e);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/journal/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.runUpdate('DELETE FROM journal WHERE id=?', [id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Écriture introuvable.' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- GRAND LIVRE ---
// Liste des comptes ayant des écritures (exercice actif), pour le sélecteur du Grand Livre.
app.get('/api/grand-livre/comptes', async (req, res) => {
  try {
    const { clause, params } = await getExerciceDateFilter();
    const rows = await db.runSelect(`
      SELECT compte, (SUM(debit) - SUM(credit)) as solde
      FROM journal
      ${clause ? `WHERE ${clause}` : ''}
      GROUP BY compte
      ORDER BY compte ASC
    `, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Écritures d'un compte, triées chronologiquement, avec solde progressif cumulé (SUM des lignes
// précédentes du même compte) — c'est la définition même d'un Grand Livre.
app.get('/api/grand-livre/:compte', async (req, res) => {
  try {
    const { compte } = req.params;
    const { clause, params } = await getExerciceDateFilter();
    const exFilter = clause ? `AND ${clause}` : '';
    const rows = await db.runSelect(`
      SELECT id, date, code_journal, n_facture, reference, libelle, compte_tiers, debit, credit
      FROM journal
      WHERE compte = ? ${exFilter}
      ORDER BY date ASC, id ASC
    `, [compte, ...params]);

    let solde = 0;
    const lignes = rows.map(r => {
      solde += (r.debit || 0) - (r.credit || 0);
      return { ...r, solde_progressif: solde };
    });

    res.json({ compte, lignes, solde_final: solde });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- FISCALITÉ ---
// TVA collectée (crédit classe 443) − TVA déductible (débit classe 445), pour un mois donné.
// La TVA est mensuelle par nature, indépendante de l'exercice comptable (annuel) : on filtre
// directement par mois plutôt que par l'exercice actif.
app.get('/api/fiscalite/tva', async (req, res) => {
  try {
    const month = req.query.month;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: "Paramètre 'month' requis au format YYYY-MM." });
    }
    const rows = await db.runSelect(`
      SELECT compte, SUM(debit) as total_debit, SUM(credit) as total_credit
      FROM journal
      WHERE date LIKE ? AND (compte LIKE '443%' OR compte LIKE '445%')
      GROUP BY compte
    `, [`${month}%`]);

    let collectee = 0, deductible = 0;
    rows.forEach(r => {
      const compte = String(r.compte);
      if (compte.startsWith('443')) collectee += (r.total_credit || 0) - (r.total_debit || 0);
      else if (compte.startsWith('445')) deductible += (r.total_debit || 0) - (r.total_credit || 0);
    });
    const solde = collectee - deductible; // positif = à payer, négatif = crédit de TVA reportable

    res.json({
      month,
      collectee,
      deductible,
      solde,
      aPayer: Math.max(0, solde),
      creditReportable: Math.max(0, -solde)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Échéances fiscales : suivi manuel du statut, aucun calcul automatique.
app.get('/api/fiscalite/echeances', (req, res) => {
  db.all("SELECT * FROM fiscal_echeances ORDER BY date_echeance ASC", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.post('/api/fiscalite/echeances', (req, res) => {
  const { libelle, date_echeance } = req.body;
  if (!libelle || !date_echeance) {
    return res.status(400).json({ error: "Libellé et date d'échéance sont obligatoires." });
  }
  db.run("INSERT INTO fiscal_echeances (libelle, date_echeance) VALUES (?, ?)", [libelle, date_echeance], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, id: this.lastID });
  });
});

app.post('/api/fiscalite/echeances/:id/statut', (req, res) => {
  const { statut } = req.body;
  if (!statut) return res.status(400).json({ error: "Statut requis." });
  db.run("UPDATE fiscal_echeances SET statut = ? WHERE id = ?", [statut, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.delete('/api/fiscalite/echeances/:id', (req, res) => {
  db.run("DELETE FROM fiscal_echeances WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// An écriture is one or more lines sharing a piece_id; it must balance (sum debit === sum credit)
// before it can be persisted, so the ledger never accepts a one-sided entry.
app.post('/api/journal', (req, res) => {
  const { code_journal, poste_budgetaire, date, n_facture, reference, lines } = req.body;

  // Le journal Caisse (CA) suppose un mouvement de caisse même si l'utilisateur n'a pas saisi
  // explicitement la ligne de contrepartie 571100 — une seule ligne suffit dans ce cas, la
  // contrepartie caisse étant complétée automatiquement plus bas.
  const minLines = code_journal === 'CA' ? 1 : 2;
  if (!code_journal || !date || !Array.isArray(lines) || lines.length < minLines) {
    return res.status(400).json({ error: `Code Journal, Date et au moins ${minLines} ligne(s) sont obligatoires.` });
  }

  for (const l of lines) {
    if (!l.compte || !l.libelle) {
      return res.status(400).json({ error: "Chaque ligne doit avoir un compte et un libellé." });
    }
  }

  let allLines = [...lines];
  let totalDebit = allLines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  let totalCredit = allLines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const gap = Math.round((totalDebit - totalCredit) * 100) / 100;

  // "En réalité le code journal caisse suppose qu'on ne va pas forcément écrire le compte caisse
  // en contrepartie mais il doit être mouvementé" : si aucune ligne ne touche déjà un compte de
  // caisse (classe 57) et que l'écriture est déséquilibrée, on complète automatiquement avec le
  // mouvement de caisse manquant plutôt que de rejeter l'écriture.
  if (code_journal === 'CA' && Math.abs(gap) > 0.01 && !allLines.some(l => String(l.compte).startsWith('57'))) {
    allLines.push({
      compte: '571100',
      compte_tiers: '',
      libelle: 'Mouvement de caisse (contrepartie automatique)',
      debit: gap < 0 ? Math.abs(gap) : 0,
      credit: gap > 0 ? gap : 0
    });
    totalDebit = allLines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
    totalCredit = allLines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  }

  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    return res.status(400).json({ error: `Écriture déséquilibrée : Débit ${totalDebit.toLocaleString()} ≠ Crédit ${totalCredit.toLocaleString()} (écart de ${Math.abs(totalDebit - totalCredit).toLocaleString()}).` });
  }

  db.get("SELECT COALESCE(MAX(piece_id), 0) + 1 as next_id FROM journal", (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    const piece_id = row.next_id;

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      const stmt = db.prepare(`
        INSERT INTO journal (code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference, debit, credit, piece_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      allLines.forEach(l => {
        stmt.run(
          code_journal,
          poste_budgetaire || '',
          date,
          String(l.compte),
          String(l.compte_tiers || ''),
          l.libelle,
          String(n_facture || ''),
          String(reference || ''),
          parseFloat(l.debit) || 0,
          parseFloat(l.credit) || 0,
          piece_id
        );
      });
      stmt.finalize();
      db.run("COMMIT", (commitErr) => {
        if (commitErr) {
          console.error(commitErr);
          return res.status(500).json({ error: commitErr.message });
        }
        res.json({ success: true, piece_id });
      });
    });
  });
});

app.get('/api/template', (req, res) => {
  const type = req.query.type;
  let headers = [];
  let sampleData = [];
  let filename = "";

  if (type === 'tiers') {
    headers = ['type', 'nom', 'compte', 'solde'];
    sampleData = [
      { type: 'Client', nom: 'SOCIETE ABC', compte: '411100', solde: 500000 },
      { type: 'Fournisseur', nom: 'FOURNISSEUR XYZ', compte: '401100', solde: -150000 }
    ];
    filename = 'template_tiers.xlsx';
  } else {
    // Default to journal
    headers = ['code_journal', 'poste_budgetaire', 'date', 'compte', 'compte_tiers', 'libelle', 'n_facture', 'reference', 'debit', 'credit'];
    sampleData = [
      { code_journal: 'AC', poste_budgetaire: 'ACHATS', date: '2026-05-01', compte: '601100', compte_tiers: '', libelle: 'Achat de marchandises', n_facture: 'FACT-001', reference: 'REF-99', debit: 250000, credit: 0 },
      { code_journal: 'AC', poste_budgetaire: 'ACHATS', date: '2026-05-01', compte: '401100', compte_tiers: 'FO-001', libelle: 'Dette Fournisseur', n_facture: 'FACT-001', reference: 'REF-99', debit: 0, credit: 250000 }
    ];
    filename = 'template_journal.xlsx';
  }

  try {
    const ws = xlsx.utils.json_to_sheet(sampleData, { header: headers });
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Template");
    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la génération du template." });
  }
});

app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const { clause, params } = await getExerciceDateFilter();
    const exFilter = clause ? `AND ${clause}` : '';

    const [tresoRows, dettesRows, creancesRows, caRows, chargesRows] = await Promise.all([
      db.runSelect(`SELECT (SUM(debit) - SUM(credit)) AS solde FROM journal WHERE (compte LIKE '52%' OR compte LIKE '57%') ${exFilter}`, params),
      db.runSelect(`SELECT (SUM(credit) - SUM(debit)) AS solde, COUNT(DISTINCT CASE WHEN n_facture != '' AND n_facture IS NOT NULL THEN n_facture END) AS count FROM journal WHERE compte LIKE '401%' ${exFilter}`, params),
      db.runSelect(`SELECT (SUM(debit) - SUM(credit)) AS solde, COUNT(DISTINCT CASE WHEN n_facture != '' AND n_facture IS NOT NULL THEN n_facture END) AS count FROM journal WHERE compte LIKE '411%' ${exFilter}`, params),
      db.runSelect(`SELECT (SUM(credit) - SUM(debit)) AS solde FROM journal WHERE compte LIKE '70%' ${exFilter}`, params),
      db.runSelect(`SELECT (SUM(debit) - SUM(credit)) AS solde FROM journal WHERE compte LIKE '6%' ${exFilter}`, params)
    ]);

    res.json({
      tresorerie: (tresoRows[0] && tresoRows[0].solde) || 0,
      dettes: Math.max(0, (dettesRows[0] && dettesRows[0].solde) || 0),
      factures_fournisseurs: (dettesRows[0] && dettesRows[0].count) || 0,
      creances: Math.max(0, (creancesRows[0] && creancesRows[0].solde) || 0),
      factures_clients: (creancesRows[0] && creancesRows[0].count) || 0,
      ca: Math.max(0, (caRows[0] && caRows[0].solde) || 0),
      charges: Math.max(0, (chargesRows[0] && chargesRows[0].solde) || 0)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Classification unique par nature de compte (débiteur/créditeur), partagée par /api/bilan,
// /api/resultat et /api/financial-analysis : ces trois routes affichaient chacune un "résultat net"
// calculé différemment à partir des mêmes données. En centralisant le calcul ici, elles ne peuvent
// plus diverger. Le résultat net est aussi injecté au passif (poste 13) pour que le bilan s'équilibre
// réellement (Total Actif = Total Passif), au lieu du pliage par signe de classe entière qui ignorait
// la distinction immobilisations/amortissements et mélangeait créances et dettes de la classe 4.
function computeFinancials(rows) {
  let capitauxPropres = 0;
  let immobilisationsBrutes = 0;
  let amortissements = 0;
  let stocks = 0;
  let creancesClients = 0;
  let dettesFournisseurs = 0;
  let autresCreances = 0;
  let autresDettes = 0;
  let tresorerieActif = 0;
  let tresoreriePassif = 0;

  let ca = 0;
  let autresProduits = 0;
  let produitsHAO = 0;
  let achats = 0;
  let servicesExterieurs = 0;
  let chargesPersonnel = 0;
  let dotationsAmort = 0;
  let autresCharges = 0;
  let chargesHAO = 0;

  (rows || []).forEach(r => {
    const compte = String(r.compte || '');
    const deb = r.total_debit || 0;
    const cred = r.total_credit || 0;
    const netDeb = deb - cred;
    const netCred = cred - deb;

    if (compte.startsWith('28')) { amortissements += netCred > 0 ? netCred : 0; }
    else if (compte.startsWith('1')) { capitauxPropres += netCred > 0 ? netCred : 0; }
    else if (compte.startsWith('2')) { immobilisationsBrutes += netDeb > 0 ? netDeb : 0; }
    else if (compte.startsWith('3')) { stocks += netDeb > 0 ? netDeb : 0; }
    else if (compte.startsWith('411')) {
      // Un compte client peut aussi finir créditeur (avance reçue) : le solde doit toujours
      // atterrir quelque part, jamais être ignoré selon son signe, sous peine de déséquilibrer le bilan.
      if (netDeb > 0) creancesClients += netDeb;
      if (netCred > 0) autresDettes += netCred;
    }
    else if (compte.startsWith('401')) {
      // Symétrique : un compte fournisseur peut finir débiteur (acompte versé) = une créance.
      if (netCred > 0) dettesFournisseurs += netCred;
      if (netDeb > 0) autresCreances += netDeb;
    }
    else if (['40', '41', '42', '43', '44', '46', '48'].some(p => compte.startsWith(p))) {
      // Reste des comptes de tiers (hors 401/411 déjà isolés) : chaque compte est classé
      // selon SA propre nature, jamais en nettant toute la classe 4 par un seul signe global.
      if (netDeb > 0) autresCreances += netDeb;
      if (netCred > 0) autresDettes += netCred;
    }
    else if (compte.startsWith('56')) { tresoreriePassif += netCred > 0 ? netCred : 0; }
    else if (['52', '53', '54', '57', '58'].some(p => compte.startsWith(p))) {
      // Une caisse/banque peut finir créditrice (découvert) : à traiter comme du passif de
      // trésorerie plutôt que de disparaître du bilan.
      if (netDeb > 0) tresorerieActif += netDeb;
      if (netCred > 0) tresoreriePassif += netCred;
    }
    else if (compte.startsWith('70')) { ca += netCred > 0 ? netCred : 0; }
    else if (compte.startsWith('81') || compte.startsWith('83') || compte.startsWith('89')) { chargesHAO += netDeb > 0 ? netDeb : 0; }
    else if (compte.startsWith('82') || compte.startsWith('84')) { produitsHAO += netCred > 0 ? netCred : 0; }
    else if (compte.startsWith('7')) { autresProduits += netCred > 0 ? netCred : 0; }
    else if (compte.startsWith('60')) { achats += netDeb > 0 ? netDeb : 0; }
    else if (compte.startsWith('61') || compte.startsWith('62') || compte.startsWith('63')) { servicesExterieurs += netDeb > 0 ? netDeb : 0; }
    else if (compte.startsWith('66')) { chargesPersonnel += netDeb > 0 ? netDeb : 0; }
    else if (compte.startsWith('68')) { dotationsAmort += netDeb > 0 ? netDeb : 0; }
    else if (compte.startsWith('6')) { autresCharges += netDeb > 0 ? netDeb : 0; }
  });

  const immobilisationsNettes = immobilisationsBrutes - amortissements;
  const actifCirculant = stocks + creancesClients + autresCreances;
  const passifCirculant = dettesFournisseurs + autresDettes;

  const totalProduits = ca + autresProduits + produitsHAO;
  const totalCharges = achats + servicesExterieurs + chargesPersonnel + dotationsAmort + autresCharges + chargesHAO;
  const resultatNet = totalProduits - totalCharges;

  const margeBrute = ca - achats;
  const valeurAjoutee = margeBrute - servicesExterieurs;
  const ebe = valeurAjoutee - chargesPersonnel;
  const resultatExploitation = ebe - dotationsAmort;

  const totalActif = immobilisationsNettes + actifCirculant + tresorerieActif;
  const totalPassif = capitauxPropres + resultatNet + passifCirculant + tresoreriePassif;

  return {
    capitauxPropres, immobilisationsBrutes, amortissements, immobilisationsNettes,
    stocks, creancesClients, dettesFournisseurs, autresCreances, autresDettes,
    tresorerieActif, tresoreriePassif, actifCirculant, passifCirculant, totalActif, totalPassif,
    ca, autresProduits, produitsHAO, achats, servicesExterieurs, chargesPersonnel,
    dotationsAmort, autresCharges, chargesHAO, totalProduits, totalCharges, resultatNet,
    margeBrute, valeurAjoutee, ebe, resultatExploitation,
    frng: (capitauxPropres + resultatNet) - immobilisationsNettes,
    bfr: actifCirculant - passifCirculant,
    tresorerieNette: tresorerieActif - tresoreriePassif
  };
}

async function getFinancialRows() {
  const { clause, params } = await getExerciceDateFilter();
  return db.runSelect(`
    SELECT compte, SUM(debit) as total_debit, SUM(credit) as total_credit
    FROM journal
    ${clause ? `WHERE ${clause}` : ''}
    GROUP BY compte
  `, params);
}

// --- MODULE D'ANALYSE FINANCIÈRE COMPLÈTE & INDICATEURS KPI SYSCOHADA ---
app.get('/api/financial-analysis', async (req, res) => {
  try {
    const rows = await getFinancialRows();
    const fin = computeFinancials(rows);
    const capPermanents = fin.capitauxPropres + fin.resultatNet;

    // Ratios
    const currentRatio = fin.passifCirculant > 0 ? ((fin.actifCirculant + fin.tresorerieActif) / fin.passifCirculant).toFixed(2) : '1.50';
    const quickRatio = fin.passifCirculant > 0 ? ((fin.creancesClients + fin.tresorerieActif) / fin.passifCirculant).toFixed(2) : '1.20';
    const cashRatio = fin.passifCirculant > 0 ? (fin.tresorerieActif / fin.passifCirculant).toFixed(2) : '0.80';
    const tauxMargeBrute = fin.ca > 0 ? ((fin.margeBrute / fin.ca) * 100).toFixed(1) : '0.0';
    const tauxMargeNette = fin.ca > 0 ? ((fin.resultatNet / fin.ca) * 100).toFixed(1) : '0.0';
    const dso = fin.ca > 0 ? Math.round((fin.creancesClients / (fin.ca * 1.1925)) * 365) : 30;
    const dpo = fin.achats > 0 ? Math.round((fin.dettesFournisseurs / (fin.achats * 1.1925)) * 365) : 45;

    // Score de santé financière sur 100
    let healthScore = 0;
    if (fin.frng >= 0) healthScore += 25;
    if (fin.tresorerieNette >= 0) healthScore += 25;
    if (fin.ebe >= 0) healthScore += 25;
    if (parseFloat(currentRatio) >= 1.0) healthScore += 25;

    res.json({
      equilibrium: {
        frng: fin.frng,
        bfr: fin.bfr,
        tresorerieNette: fin.tresorerieNette,
        capPermanents,
        actifImmobilise: fin.immobilisationsNettes,
        actifCirculant: fin.actifCirculant,
        passifCirculant: fin.passifCirculant,
        tresorerieActif: fin.tresorerieActif,
        tresoreriePassif: fin.tresoreriePassif
      },
      sig: {
        ca: fin.ca,
        achats: fin.achats,
        margeBrute: fin.margeBrute,
        tauxMargeBrute,
        servicesExterieurs: fin.servicesExterieurs,
        valeurAjoutee: fin.valeurAjoutee,
        chargesPersonnel: fin.chargesPersonnel,
        ebe: fin.ebe,
        dotationsAmort: fin.dotationsAmort,
        resultatExploitation: fin.resultatExploitation,
        resultatNet: fin.resultatNet,
        tauxMargeNette
      },
      ratios: {
        currentRatio,
        quickRatio,
        cashRatio,
        dso,
        dpo,
        healthScore
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- FINANCIAL STATEMENTS (ÉTATS FINANCIERS) ---
app.get('/api/balance', async (req, res) => {
  try {
    const { clause, params } = await getExerciceDateFilter();
    const rows = await db.runSelect(`
      SELECT compte,
             MAX(libelle) as intitule,
             SUM(debit) as total_debit,
             SUM(credit) as total_credit,
             (SUM(debit) - SUM(credit)) as solde
      FROM journal
      ${clause ? `WHERE ${clause}` : ''}
      GROUP BY compte
      ORDER BY compte ASC
    `, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/bilan', async (req, res) => {
  try {
    const rows = await getFinancialRows();
    const fin = computeFinancials(rows);
    res.json({
      actif: {
        immobilisationsBrutes: fin.immobilisationsBrutes,
        amortissements: fin.amortissements,
        immobilisationsNettes: fin.immobilisationsNettes,
        stocks: fin.stocks,
        creancesClients: fin.creancesClients,
        autresCreances: fin.autresCreances,
        actifCirculant: fin.actifCirculant,
        tresorerieActif: fin.tresorerieActif,
        total: fin.totalActif
      },
      passif: {
        capitauxPropres: fin.capitauxPropres,
        resultatNet: fin.resultatNet,
        dettesFournisseurs: fin.dettesFournisseurs,
        autresDettes: fin.autresDettes,
        passifCirculant: fin.passifCirculant,
        tresoreriePassif: fin.tresoreriePassif,
        total: fin.totalPassif
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/resultat', async (req, res) => {
  try {
    const rows = await getFinancialRows();
    const fin = computeFinancials(rows);
    res.json({
      ca: fin.ca,
      autresProduits: fin.autresProduits,
      produitsHAO: fin.produitsHAO,
      totalProduits: fin.totalProduits,
      achats: fin.achats,
      servicesExterieurs: fin.servicesExterieurs,
      chargesPersonnel: fin.chargesPersonnel,
      dotationsAmort: fin.dotationsAmort,
      autresCharges: fin.autresCharges,
      chargesHAO: fin.chargesHAO,
      totalCharges: fin.totalCharges,
      margeBrute: fin.margeBrute,
      valeurAjoutee: fin.valeurAjoutee,
      ebe: fin.ebe,
      resultatExploitation: fin.resultatExploitation,
      resultatNet: fin.resultatNet
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- AUDIT & CORRECTION ---
const { askAuditAI } = require('./ai');

app.get('/api/audit', async (req, res) => {
  const checks = [
    // 1. Tiers manquants
    db.runSelect("SELECT id, date, compte, libelle, debit, credit FROM journal WHERE (compte LIKE '40%' OR compte LIKE '41%') AND (compte_tiers IS NULL OR compte_tiers = '') LIMIT 20")
      .then(rows => rows.length > 0 ? { type: 'Tiers Manquant', description: 'Écritures sur comptes 40/41 sans compte tiers renseigné', data: rows } : null),

    // 2. Caisse négative
    db.runSelect("SELECT compte, SUM(debit)-SUM(credit) as solde FROM journal WHERE compte LIKE '57%' GROUP BY compte HAVING solde < 0")
      .then(rows => rows.length > 0 ? { type: 'Caisse Négative', description: 'Le solde de la caisse ne peut pas être créditeur', data: rows } : null),

    // 3. Comptes d'attente
    db.runSelect("SELECT compte, SUM(debit)-SUM(credit) as solde FROM journal WHERE compte LIKE '47%' GROUP BY compte HAVING solde != 0")
      .then(rows => rows.length > 0 ? { type: 'Comptes d\'attente (47)', description: 'Ces comptes doivent être soldés avant la clôture', data: rows } : null),

    // 4. Comptes invalides (trop courts ou lettres)
    db.runSelect("SELECT id, date, compte, libelle, debit, credit FROM journal WHERE length(compte) < 2 OR CAST(compte AS INTEGER) = 0 LIMIT 20")
      .then(rows => rows.length > 0 ? { type: 'Compte Invalide', description: 'La structure du compte ne respecte pas le format numérique standard', data: rows } : null),

    // 5. Déséquilibre global : le contrôle le plus fondamental d'une comptabilité en partie double
    db.runSelect("SELECT SUM(debit) as total_debit, SUM(credit) as total_credit FROM journal")
      .then(rows => {
        const { total_debit, total_credit } = rows[0] || {};
        const solde = (total_debit || 0) - (total_credit || 0);
        if (Math.abs(solde) <= 0.01) return null;
        return {
          type: 'Déséquilibre Global',
          description: `Le total des débits (${(total_debit || 0).toLocaleString()}) ne correspond pas au total des crédits (${(total_credit || 0).toLocaleString()}). En partie double, ces deux totaux doivent toujours être égaux.`,
          data: [{ id: '-', date: '-', compte: 'GLOBAL', libelle: 'Écart débit/crédit sur l\'ensemble du journal', debit: total_debit || 0, credit: total_credit || 0 }]
        };
      }),

    // 6. Écritures déséquilibrées : chaque piece_id (saisie manuelle ou import facture) doit s'équilibrer
    db.runSelect(`
      SELECT j.piece_id, MIN(j.date) as date, MIN(j.libelle) as libelle, SUM(j.debit) as debit, SUM(j.credit) as credit
      FROM journal j
      WHERE j.piece_id IS NOT NULL
      GROUP BY j.piece_id
      HAVING ABS(SUM(j.debit) - SUM(j.credit)) > 0.01
      LIMIT 20
    `).then(rows => rows.length > 0 ? {
      type: 'Écriture(s) Déséquilibrée(s)',
      description: 'Ces écritures (regroupées par pièce) ont un débit total différent du crédit total et doivent être corrigées.',
      data: rows.map(r => ({ id: r.piece_id, date: r.date, compte: '-', libelle: r.libelle, debit: r.debit, credit: r.credit }))
    } : null),
  ];

  try {
    const results = await Promise.all(checks);
    res.json(results.filter(Boolean));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/audit/advice', async (req, res) => {
  try {
    const { anomaly } = req.body;
    const advice = await askAuditAI(anomaly);
    res.json(advice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cette route exécute du SQL généré par une IA sans supervision humaine préalable de la requête
// elle-même (l'utilisateur approuve juste "la correction"). On applique donc plusieurs garde-fous
// en profondeur plutôt qu'une simple whitelist de verbes : une seule requête à la fois, ciblant
// uniquement les tables comptables (jamais settings/business_rules qui contiennent les clés API
// ou la config), avec WHERE obligatoire, exécutée dans une transaction annulée si trop de lignes
// seraient touchées (signe d'une clause WHERE erronée plutôt que d'une correction ciblée).
const AUDIT_APPLY_ALLOWED_TABLES = ['journal', 'tiers'];
const AUDIT_APPLY_MAX_AFFECTED_ROWS = 50;

app.post('/api/audit/apply', (req, res) => {
  const { sql } = req.body;
  const trimmed = sql ? sql.trim() : "";
  const sqlUpper = trimmed.toUpperCase();

  if (!sqlUpper.startsWith("UPDATE") && !sqlUpper.startsWith("INSERT") && !sqlUpper.startsWith("DELETE")) {
    return res.status(400).json({ error: "Seules les requêtes UPDATE, INSERT et DELETE sont autorisées." });
  }

  const singleStatement = trimmed.replace(/;\s*$/, '');
  if (singleStatement.includes(';')) {
    return res.status(400).json({ error: "Une seule requête à la fois est autorisée." });
  }

  const tableMatch = singleStatement.match(/^(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+["'`[]?(\w+)["'`\]]?/i);
  const table = tableMatch ? tableMatch[1].toLowerCase() : null;
  if (!table || !AUDIT_APPLY_ALLOWED_TABLES.includes(table)) {
    return res.status(400).json({ error: `Cette correction ne peut cibler que les tables : ${AUDIT_APPLY_ALLOWED_TABLES.join(', ')}.` });
  }

  if ((sqlUpper.startsWith("UPDATE") || sqlUpper.startsWith("DELETE")) && !/\bWHERE\b/i.test(singleStatement)) {
    return res.status(400).json({ error: "Une clause WHERE est obligatoire pour une correction UPDATE ou DELETE (pas de modification en masse)." });
  }

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    db.run(singleStatement, function (err) {
      if (err) {
        return db.run("ROLLBACK", () => res.status(500).json({ error: err.message }));
      }
      const changes = this.changes;
      if (changes > AUDIT_APPLY_MAX_AFFECTED_ROWS) {
        return db.run("ROLLBACK", () => res.status(400).json({
          error: `Correction annulée : ${changes} lignes auraient été affectées (maximum ${AUDIT_APPLY_MAX_AFFECTED_ROWS} pour une correction ciblée). Vérifiez la clause WHERE.`
        }));
      }
      db.run("COMMIT", (commitErr) => {
        if (commitErr) return res.status(500).json({ error: commitErr.message });
        res.json({ success: true, changes });
      });
    });
  });
});

app.delete('/api/clear', (req, res) => {
  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    db.run("DELETE FROM journal");
    db.run("DELETE FROM tiers");
    db.run("COMMIT", (err) => {
      if (err) {
        console.error("CLEAR DB ERROR:", err);
        res.status(500).json({ error: 'Erreur lors du nettoyage de la base.' });
      } else {
        res.json({ success: true, message: 'Base de données vidée avec succès.' });
      }
    });
  });
});

// --- MEMORY & BUSINESS RULES ROUTES ---

// 1. Get memory docs
app.get('/api/memory/docs', (req, res) => {
  db.all("SELECT id, title, filename, file_type, category, created_at FROM knowledge_docs ORDER BY id DESC", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// 2. Upload doc / text rule
// Un PDF ou un Excel est un format binaire : buffer.toString('utf-8') ne produit que du
// charabia illisible (déjà arrivé en prod, polluant business_rules de "règles" imparsables).
// On extrait donc le vrai texte selon le type de fichier avant de le stocker/parser.
async function extractFileContent(buffer, filename, mimetype) {
  const ext = (filename.split('.').pop() || '').toLowerCase();

  if (ext === 'pdf' || mimetype === 'application/pdf') {
    // pdf-parse v2 est une classe (API v1 "pdfParse(buffer)" abandonnée) : il faut instancier
    // PDFParse puis appeler getText(), et libérer le parseur ensuite.
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  }

  if (['xlsx', 'xls'].includes(ext) || (mimetype || '').includes('spreadsheet') || (mimetype || '').includes('excel')) {
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    return workbook.SheetNames
      .map(name => xlsx.utils.sheet_to_csv(workbook.Sheets[name], { FS: ' - ' }))
      .join('\n');
  }

  // .txt, .csv, .json et tout le reste : déjà du texte brut.
  return buffer.toString('utf-8');
}

app.post('/api/memory/upload-doc', upload.single('file'), async (req, res) => {
  try {
    const { title, category, rawText } = req.body;
    let content = rawText || '';
    let filename = 'Texte Saisi';
    let fileType = 'text/plain';

    if (req.file) {
      filename = req.file.originalname;
      fileType = req.file.mimetype;
      try {
        content = await extractFileContent(req.file.buffer, filename, fileType);
      } catch (extractErr) {
        console.error('Extraction error:', extractErr);
        return res.status(400).json({ error: `Impossible d'extraire le texte de "${filename}" : ${extractErr.message}` });
      }
    }

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Le contenu du document est vide.' });
    }

    const docTitle = title || filename;
    const docCategory = category || 'Procédure Comptable';

    db.run(
      "INSERT INTO knowledge_docs (title, filename, file_type, content, category) VALUES (?, ?, ?, ?, ?)",
      [docTitle, filename, fileType, content, docCategory],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        const docId = this.lastID;

        // Extraire automatiquement des règles métier à partir des motifs d'imputation dans le texte
        const lines = content.split('\n');
        let ruleCount = 0;
        lines.forEach(line => {
          const mAccount = line.match(/(?:compte\s*)?([267]\d{3,5})/i);
          if (mAccount) {
            let account = mAccount[1];
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
                  [docId, pattern, account, `Extrait directement du document: ${docTitle}`]
                );
                ruleCount++;
              }
            });
          }
        });

        res.json({ success: true, docId, message: `Document enregistré dans la mémoire. ${ruleCount > 0 ? ruleCount + ' règle(s) d\'imputation extraite(s) !' : ''}` });
      }
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Delete doc
app.delete('/api/memory/docs/:id', (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM knowledge_docs WHERE id = ?", [id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    db.run("DELETE FROM business_rules WHERE doc_id = ?", [id]);
    res.json({ success: true });
  });
});

// Plan comptable personnalisé : lu par le front (Balance) pour surcharger les intitulés OHADA
// par défaut. Reconstruit entièrement à chaque appel à partir des documents actuellement en
// mémoire, pour qu'ajouter ou supprimer un document se répercute simplement en relançant l'extraction.
app.get('/api/chart-of-accounts', (req, res) => {
  db.all("SELECT compte, libelle FROM chart_of_accounts", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.post('/api/memory/chart-of-accounts/refresh', async (req, res) => {
  try {
    const docs = await db.runSelect("SELECT id, title, filename, content FROM knowledge_docs");
    const entries = new Map(); // compte -> { libelle, source_doc_id }

    // Un document explicitement titré "plan comptable" est la nomenclature officielle, à traiter
    // en autorité : quand un même numéro de compte est aussi mentionné (souvent hors contexte,
    // dans un tableau d'exemple chiffré) par un autre document type "guide d'application", c'est
    // le plan comptable qui doit l'emporter. Traité en dernier pour écraser les conflits.
    const isPlanComptable = (doc) => /plan[\s\-]?comptable/i.test(`${doc.title || ''} ${doc.filename || ''}`);
    const orderedDocs = [...docs].sort((a, b) => (isPlanComptable(a) ? 1 : 0) - (isPlanComptable(b) ? 1 : 0));

    orderedDocs.forEach(doc => {
      String(doc.content || '').split('\n').forEach(line => {
        // Format attendu : "628100 - FRAIS DE TÉLÉCOMMUNICATIONS" (ou avec ':', ';', ',', tabulation),
        // parfois précédé d'une puce hiérarchique ("• 101 Capital social", "- 1011 Capital souscrit...").
        // Ancré en début de ligne (puces ignorées) pour ne pas confondre avec un numéro de compte cité
        // au milieu d'une phrase (déjà géré séparément par l'extraction de règles métier).
        // Le séparateur (classe [\s\-:;,\t]) et le libellé étaient auparavant capturés par deux
        // quantificateurs adjacents qui se recouvrent ([...]+ glouton suivi de .{3,120}? paresseux
        // ancré sur $) : sur un gros corpus réel (63k+ caractères), certaines lignes déclenchaient
        // un retour arrière catastrophique et gelaient tout le serveur (event loop bloqué). Le
        // libellé est donc capturé glouton jusqu'à la fin de ligne (sans ambiguïté de découpage),
        // et la limite de longueur appliquée après coup en JS plutôt que dans le motif.
        const m = line.match(/^\s*[•*\-–]?\s*(\d{2,8})[\s\-:;,\t]+(.+)$/);
        if (m) {
          let libelle = m[2].trim().toUpperCase();
          if (libelle.length > 120) libelle = libelle.slice(0, 120).trim();
          // Rejette les "libellés" trop chiffrés : un tableau multi-colonnes (montants, soldes
          // d'exemples chiffrés) mal linéarisé par l'extraction PDF finit souvent concaténé à la
          // suite d'un vrai début de libellé ("ACHATS MARCHANDISES   75 000 000   75 000 000") —
          // un véritable intitulé de compte est du texte, jamais majoritairement des chiffres.
          const digitRatio = (libelle.match(/\d/g) || []).length / libelle.length;
          if (libelle.length >= 3 && /[A-ZÀ-Ÿ]/.test(libelle) && digitRatio <= 0.15) {
            entries.set(m[1], { libelle, source_doc_id: doc.id });
          }
        }
      });
    });

    await db.runUpdate("DELETE FROM chart_of_accounts");
    // Sans transaction explicite, chaque INSERT est son propre commit (fsync individuel) : avec
    // plusieurs milliers d'entrées (plan comptable complet), cela pouvait prendre des dizaines de
    // minutes et donnait l'impression d'un serveur figé. Un seul commit pour tout le lot.
    await new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        const stmt = db.prepare("INSERT INTO chart_of_accounts (compte, libelle, source_doc_id) VALUES (?, ?, ?)");
        entries.forEach((v, compte) => stmt.run(compte, v.libelle, v.source_doc_id));
        stmt.finalize(err => {
          if (err) return reject(err);
          db.run('COMMIT', err2 => err2 ? reject(err2) : resolve());
        });
      });
    });

    res.json({
      success: true,
      count: entries.size,
      message: `${entries.size} intitulé(s) de compte extrait(s) depuis ${docs.length} document(s) en mémoire.`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Get business rules & ML learnings
app.get('/api/memory/rules', (req, res) => {
  db.all("SELECT * FROM business_rules ORDER BY is_active DESC, confidence_score DESC, occurrences DESC", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// 5. Add / Update business rule manually
app.post('/api/memory/rules', (req, res) => {
  const { id, pattern, condition_type, target_account, target_journal, vat_rate, confidence_score, description } = req.body;
  if (!pattern || !target_account) {
    return res.status(400).json({ error: 'Le motif/pattern et le compte comptable sont obligatoires.' });
  }

  if (id) {
    db.run(
      "UPDATE business_rules SET pattern = ?, condition_type = ?, target_account = ?, target_journal = ?, vat_rate = ?, confidence_score = ?, description = ? WHERE id = ?",
      [pattern.trim(), condition_type || 'contains', target_account.trim(), target_journal || null, parseFloat(vat_rate) || 0, parseFloat(confidence_score) || 1.0, description || '', id],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
      }
    );
  } else {
    db.run(
      "INSERT INTO business_rules (pattern, condition_type, target_account, target_journal, vat_rate, confidence_score, auto_learned, description) VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
      [pattern.trim(), condition_type || 'contains', target_account.trim(), target_journal || null, parseFloat(vat_rate) || 0, parseFloat(confidence_score) || 1.0, description || 'Règle créée manuellement'],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
      }
    );
  }
});

// 6. Toggle active status
app.post('/api/memory/rules/:id/toggle', (req, res) => {
  const { id } = req.params;
  db.run("UPDATE business_rules SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?", [id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// 7. Delete rule
app.delete('/api/memory/rules/:id', (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM business_rules WHERE id = ?", [id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// 8. Match transaction with memory (for real-time auto-imputation)
app.post('/api/memory/match', async (req, res) => {
  try {
    const { libelle, compte_tiers, is_achat } = req.body;
    const isAchat = is_achat !== undefined ? is_achat : true;
    const matchResult = await matchTransactionWithMemory(libelle, compte_tiers, isAchat);
    res.json(matchResult);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Learn single rule from manual entry confirmation
app.post('/api/memory/learn', async (req, res) => {
  try {
    const { pattern, target_account, target_journal, description } = req.body;
    if (!pattern || !target_account) return res.status(400).json({ error: 'Motif et compte requis.' });
    
    const count = await learnFromJournalData([{ libelle: pattern, compte: target_account, code_journal: target_journal }]);
    res.json({ success: true, message: 'Apprentissage enregistré dans la Mémoire Métier !' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Téléchargement des Modèles Excel (factures, journal, tiers)
app.get('/api/template/factures', (req, res) => {
  const templatePath = path.join(__dirname, 'public', 'templates', 'template_saisie_factures.xlsx');
  if (fs.existsSync(templatePath)) {
    res.download(templatePath, 'template_saisie_factures.xlsx');
  } else {
    res.status(404).json({ error: "Fichier modèle introuvable." });
  }
});

app.get('/api/template', (req, res) => {
  const type = req.query.type || 'factures';
  let filename = 'template_saisie_factures.xlsx';

  if (type === 'journal') filename = 'template_journal.xlsx';
  else if (type === 'tiers') filename = 'template_tiers.xlsx';
  else if (type === 'factures') filename = 'template_saisie_factures.xlsx';

  const templatePath = path.join(__dirname, 'public', 'templates', filename);
  if (fs.existsSync(templatePath)) {
    res.download(templatePath, filename);
  } else {
    res.status(404).json({ error: `Fichier modèle ${filename} introuvable.` });
  }
});

// Sert le frontend buildé (npm run build → dist/) depuis ce même serveur : en usage packagé
// (installateur Windows), un seul process/port suffit, pas besoin du serveur de dev Vite.
// N'a aucun effet en développement tant que dist/ n'existe pas.
const distDir = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api|\/public).*/, (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
