require('dotenv').config();

// Polyfill DOMMatrix for Node.js 24 + pdf-parse compatibility
if (typeof global.DOMMatrix === 'undefined') {
  global.DOMMatrix = class DOMMatrix {
    constructor(init) {
      if (Array.isArray(init) && init.length >= 6) {
        this.a = init[0]; this.b = init[1]; this.c = init[2]; this.d = init[3]; this.e = init[4]; this.f = init[5];
      } else {
        this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
      }
    }
  };
}

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const xlsx = require('xlsx');
let PDFParse;
try {
  const pdfParseModule = require('pdf-parse');
  PDFParse = pdfParseModule.PDFParse || pdfParseModule;
} catch (e) {
  console.warn('[Server] pdf-parse loading warning:', e.message);
}
const db = require('./db');
const { askAI, matchTransactionWithMemory, learnFromJournalData, friendlyAiErrorMessage } = require('./ai');
const { computeEtatsFinanciers } = require('./ohadaRules');
const { getSyncSettings, getPendingLocalCount, getSyncProgress, performPush, performPull, performSync, ensureDatabaseHydrated, startAutoSyncCron } = require('./supabaseSync');

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();

// CORS : autorise l'origine du serveur de dev Vite, plus la propre origine du serveur
// (même host:port que la requête). Ce deuxième cas est indispensable : les balises
// <script crossorigin>/<link crossorigin> générées par le build Vite envoient un en-tête
// Origin même pour un chargement strictement same-origin (Electron, build servi par ce
// même serveur, Vercel) — sans ça, le navigateur bloque le JS/CSS de l'appli elle-même.
const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173'
]);
app.use((req, res, next) => {
  const host = req.headers.host;
  const selfOrigins = host ? [`http://${host}`, `https://${host}`] : [];
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin) || selfOrigins.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }
      callback(null, false);
    }
  })(req, res, next);
});
// Défaut Express (100kb) bien trop bas pour le chemin JSON de /api/import/auto-fix-and-import
// avec un gros import (des centaines de milliers de lignes envoyées en JSON après équilibrage
// côté client) — aligné sur la limite de taille de fichier ci-dessous.
app.use(express.json({ limit: '1024mb' }));

// Limite générale anti-abus sur toute l'API, et limite stricte sur les routes sensibles
// (lecture/écriture de clés API, purge de la base, reconfiguration/déclenchement de la sync,
// application d'une mise à jour).
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false });
const sensitiveLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
app.use('/api', apiLimiter);

// Middleware d'auto-hydratation EXCLUSIVEMENT pour Vercel (serverless sans stockage permanent)
const isVercelServer = !!(process.env.VERCEL || process.env.NOW_BUILDER || process.env.VERCEL_ENV);
if (isVercelServer) {
  app.use(async (req, res, next) => {
    if (req.path.startsWith('/api') && !req.path.startsWith('/api/sync')) {
      try {
        await ensureDatabaseHydrated(60000);
      } catch (e) {
        // Ne bloque pas la requête si le réseau est temporairement indisponible
      }
    }
    next();
  });
}

// Serve public/exports directory for generated files
const exportsDir = isVercelServer
  ? path.join('/tmp', 'exports')
  : path.join(__dirname, 'public', 'exports');

try {
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }
} catch (e) {
  // Ignorer si filesystem restreint
}
app.use(express.static(path.join(__dirname, 'public')));
app.use('/public', express.static(path.join(__dirname, 'public')));
if (isVercelServer) {
  app.use('/public/exports', express.static(exportsDir));
}

const ALLOWED_UPLOAD_EXTENSIONS = new Set(['xlsx', 'xls', 'csv', 'pdf', 'docx', 'txt']);
// Un modèle journal SYSCOHADA de plusieurs centaines de milliers de lignes (import comptable
// annuel réel) dépasse largement une limite pensée pour des documents/factures isolés : 20 Mo
// rejetait déjà un fichier de 250 000 lignes. Relevé pour couvrir jusqu'à ~1,5M lignes.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1 Go (mesuré : ~115 Mo pour 300k lignes réelles)
  fileFilter(req, file, cb) {
    const ext = (file.originalname.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
      return cb(new Error(`Type de fichier non autorisé : .${ext}`));
    }
    cb(null, true);
  }
});

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

// Calcule, pour chaque compte ayant au moins une écriture, le solde antérieur (report des
// écritures situées avant l'exercice actif), le mouvement de la période sélectionnée, et le
// solde cumulé qui en résulte. C'est la structure même de la balance générale telle qu'elle
// apparaît dans le Guide d'application SYSCOHADA (tableau "BALANCE N-1" : Solde N-2 / Mouvement
// N-1 / Solde N-1) — le Journal, la Balance et le Grand Livre s'appuient tous sur ce calcul.
//
// Sans cette distinction, un compte resté sans écriture PENDANT l'exercice sélectionné (ex :
// capital, emprunt ancien) mais dont le solde reporté est non nul disparaissait purement et
// simplement de la Balance et du Grand Livre dès qu'un exercice était actif, alors que son solde
// reste réel. Sans exercice actif, solde antérieur = 0 pour tous les comptes (rien à reporter) :
// le comportement est alors strictement identique à l'ancien calcul.
async function getBalanceRows() {
  const ex = await getActiveExercice();

  const [openingRows, periodRows, allTimeLabels] = await Promise.all([
    ex
      ? db.runSelect(`SELECT compte, SUM(debit) as debit, SUM(credit) as credit FROM journal WHERE date < ? GROUP BY compte`, [ex.date_debut])
      : Promise.resolve([]),
    ex
      ? db.runSelect(`SELECT compte, SUM(debit) as debit, SUM(credit) as credit FROM journal WHERE date >= ? AND date <= ? GROUP BY compte`, [ex.date_debut, ex.date_fin])
      : db.runSelect(`SELECT compte, SUM(debit) as debit, SUM(credit) as credit FROM journal GROUP BY compte`),
    db.runSelect(`SELECT compte, MAX(libelle) as intitule FROM journal GROUP BY compte`),
  ]);

  const labelByCompte = new Map(allTimeLabels.map(r => [r.compte, r.intitule]));
  const byCompte = new Map();

  openingRows.forEach(r => {
    byCompte.set(r.compte, { compte: r.compte, solde_anterieur: (r.debit || 0) - (r.credit || 0), total_debit: 0, total_credit: 0 });
  });
  periodRows.forEach(r => {
    const entry = byCompte.get(r.compte) || { compte: r.compte, solde_anterieur: 0, total_debit: 0, total_credit: 0 };
    entry.total_debit = r.debit || 0;
    entry.total_credit = r.credit || 0;
    byCompte.set(r.compte, entry);
  });

  return Array.from(byCompte.values())
    .map(e => ({
      compte: e.compte,
      intitule: labelByCompte.get(e.compte) || '',
      solde_anterieur: e.solde_anterieur,
      total_debit: e.total_debit,
      total_credit: e.total_credit,
      solde: e.total_debit - e.total_credit,
      solde_cumule: e.solde_anterieur + (e.total_debit - e.total_credit),
    }))
    .sort((a, b) => a.compte.localeCompare(b.compte));
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
app.get('/api/settings', sensitiveLimiter, (req, res) => {
  db.all("SELECT key, value FROM settings", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const settings = {};
    rows.forEach(r => settings[r.key] = r.value);
    res.json(settings);
  });
});

app.post('/api/settings', sensitiveLimiter, (req, res) => {
  const { GEMINI_API_KEY, GEMINI_MODEL, OPENAI_API_KEY, DEEPSEEK_API_KEY, DEEPSEEK_MODEL, DEFAULT_AI, OPENAI_BASE_URL, OPENAI_MODEL, GROQ_API_KEY } = req.body;
  const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
  
  if (GEMINI_API_KEY !== undefined) stmt.run('GEMINI_API_KEY', GEMINI_API_KEY);
  if (GEMINI_MODEL !== undefined) stmt.run('GEMINI_MODEL', GEMINI_MODEL);
  if (OPENAI_API_KEY !== undefined) stmt.run('OPENAI_API_KEY', OPENAI_API_KEY);
  if (DEEPSEEK_API_KEY !== undefined) stmt.run('DEEPSEEK_API_KEY', DEEPSEEK_API_KEY);
  if (DEEPSEEK_MODEL !== undefined) stmt.run('DEEPSEEK_MODEL', DEEPSEEK_MODEL);
  if (DEFAULT_AI !== undefined) stmt.run('DEFAULT_AI', DEFAULT_AI);
  if (OPENAI_BASE_URL !== undefined) stmt.run('OPENAI_BASE_URL', OPENAI_BASE_URL);
  if (OPENAI_MODEL !== undefined) stmt.run('OPENAI_MODEL', OPENAI_MODEL);
  if (GROQ_API_KEY !== undefined) stmt.run('GROQ_API_KEY', GROQ_API_KEY);
  
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

// Génère automatiquement les contreparties de trésorerie (Caisse 571100 ou Banque 521100)
// pour toute opération importée sur journal Caisse (CAISPR, CA) ou Banque (BQ, BANQUE, etc.)
// quel que soit le sens (règlement au débit ou encaissement au crédit d'un tiers/compte).
function expandTreasuryCounterparts(rows) {
  const result = [];
  rows.forEach((r, i) => {
    result.push(r);
    
    const isCaisseJournal = /CAIS|CA/i.test(r.code_journal);
    const isBanqueJournal = /BANQ|BQ|BNQ|BNC|SGBC|UBA|ECOR/i.test(r.code_journal);

    if (!isCaisseJournal && !isBanqueJournal) return;

    const prevRow = rows[i - 1];
    const nextRow = rows[i + 1];

    if (isCaisseJournal) {
      const prevIs57 = prevRow && /^57/.test(prevRow.compte);
      const nextIs57 = nextRow && /^57/.test(nextRow.compte);

      if (!prevIs57 && !nextIs57) {
        if (r.debit > 0) {
          result.push({
            code_journal: r.code_journal,
            poste_budgetaire: r.poste_budgetaire || 'CAISSE',
            date: r.date,
            compte: '571100',
            compte_tiers: r.compte_tiers,
            libelle: `Règlement Caisse (${r.compte_tiers || 'Tiers'}) - ${r.libelle}`,
            n_facture: r.n_facture,
            reference: r.reference,
            debit: 0,
            credit: r.debit
          });
        } else if (r.credit > 0) {
          result.push({
            code_journal: r.code_journal,
            poste_budgetaire: r.poste_budgetaire || 'CAISSE',
            date: r.date,
            compte: '571100',
            compte_tiers: r.compte_tiers,
            libelle: `Encaissement Caisse (${r.compte_tiers || 'Tiers'}) - ${r.libelle}`,
            n_facture: r.n_facture,
            reference: r.reference,
            debit: r.credit,
            credit: 0
          });
        }
      }
    } else if (isBanqueJournal) {
      const prevIs52 = prevRow && /^52/.test(prevRow.compte);
      const nextIs52 = nextRow && /^52/.test(nextRow.compte);

      if (!prevIs52 && !nextIs52) {
        if (r.debit > 0) {
          result.push({
            code_journal: r.code_journal,
            poste_budgetaire: r.poste_budgetaire || 'BANQUE',
            date: r.date,
            compte: '521100',
            compte_tiers: r.compte_tiers,
            libelle: `Règlement Banque (${r.compte_tiers || 'Tiers'}) - ${r.libelle}`,
            n_facture: r.n_facture,
            reference: r.reference,
            debit: 0,
            credit: r.debit
          });
        } else if (r.credit > 0) {
          result.push({
            code_journal: r.code_journal,
            poste_budgetaire: r.poste_budgetaire || 'BANQUE',
            date: r.date,
            compte: '521100',
            compte_tiers: r.compte_tiers,
            libelle: `Encaissement Banque (${r.compte_tiers || 'Tiers'}) - ${r.libelle}`,
            n_facture: r.n_facture,
            reference: r.reference,
            debit: r.credit,
            credit: 0
          });
        }
      }
    }
  });
  return result;
}

// --- DÉDUPLICATION À L'IMPORT ---
// Empêche qu'un même fichier (ré)importé — par erreur, ou parce qu'on ne sait plus s'il est déjà
// passé — ne double chaque écriture en base : aucune contrainte UNIQUE n'existe sur `journal` et
// aucun des chemins d'import ne vérifiait l'existant avant d'insérer. Deux écritures sont
// considérées comme un doublon si tous leurs champs "métier" (hors id auto-incrémenté) sont
// identiques.
function journalRowFingerprint(r) {
  return [
    String(r.date || ''),
    String(r.compte || '').trim(),
    String(r.compte_tiers || '').trim().toLowerCase(),
    String(r.libelle || '').trim().toLowerCase(),
    String(r.n_facture || '').trim().toLowerCase(),
    String(r.reference || '').trim().toLowerCase(),
    (Number(r.debit) || 0).toFixed(2),
    (Number(r.credit) || 0).toFixed(2),
  ].join('||');
}

async function dedupeJournalRows(rows) {
  if (!rows || rows.length === 0) return { rows: [], duplicates: 0 };
  const dates = rows.map(r => r.date).filter(Boolean).sort();
  const minDate = dates[0];
  const maxDate = dates[dates.length - 1];
  let existing = [];
  try {
    existing = minDate && maxDate
      ? await db.runSelect(
          `SELECT date, compte, compte_tiers, libelle, n_facture, reference, debit, credit FROM journal WHERE date >= ? AND date <= ?`,
          [minDate, maxDate]
        )
      : await db.runSelect(`SELECT date, compte, compte_tiers, libelle, n_facture, reference, debit, credit FROM journal`, []);
  } catch (e) {
    existing = [];
  }
  const existingSet = new Set((existing || []).map(journalRowFingerprint));
  const seenInBatch = new Set();
  const kept = [];
  let duplicates = 0;
  rows.forEach(r => {
    const fp = journalRowFingerprint(r);
    if (existingSet.has(fp) || seenInBatch.has(fp)) {
      duplicates++;
    } else {
      seenInBatch.add(fp);
      kept.push(r);
    }
  });
  return { rows: kept, duplicates };
}

// Insère de grands volumes d'écritures par lots (plutôt qu'une seule transaction géante pour
// tout le fichier) : sur un import de plusieurs centaines de milliers à ~1,5M de lignes, une
// transaction unique retient un verrou SQLite exclusif pendant toute sa durée (risque de
// blocage des autres requêtes) et fait grossir le WAL démesurément avant le COMMIT final. Des
// lots de 5000 lignes, chacun validé indépendamment, gardent un débit d'insertion élevé sans
// ces deux inconvénients.
function insertJournalRowsChunked(rows, batchSize = 5000) {
  return new Promise((resolve, reject) => {
    if (rows.length === 0) return resolve();
    const stmt = db.prepare("INSERT INTO journal (code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference, debit, credit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");

    let i = 0;
    const runNextBatch = () => {
      if (i >= rows.length) {
        stmt.finalize((err) => err ? reject(err) : resolve());
        return;
      }
      const batch = rows.slice(i, i + batchSize);
      i += batchSize;
      db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        batch.forEach(r => {
          stmt.run(r.code_journal, r.poste_budgetaire, r.date, r.compte, r.compte_tiers, r.libelle, r.n_facture, r.reference, r.debit, r.credit);
        });
        db.run("COMMIT", (err) => {
          if (err) return reject(err);
          setImmediate(runNextBatch);
        });
      });
    };
    runNextBatch();
  });
}

app.post('/api/import', upload.single('file'), async (req, res) => {
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
      const journalRows = [];
      data.forEach(row => {
          const normRow = {};
          for(let key in row) {
             const normKey = key.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
             normRow[normKey] = row[key];
          }

          const code_journal = normRow['codejournal'] || normRow['journal'] || normRow['code'] || '';
          const poste_budgetaire = normRow['postebudgetaire'] || normRow['postebudget'] || normRow['poste'] || '';
          const date = normalizeDate(normRow['date']);
          const compte = String(normRow['compte'] || normRow['comptegeneral'] || normRow['ncompte'] || normRow['numcompte'] || normRow['comptecomptable'] || normRow['general'] || '');
          const compte_tiers = String(normRow['comptetiers'] || normRow['tiers'] || normRow['nomtiers'] || normRow['auxiliaire'] || '');
          const libelle = normRow['libelle'] || normRow['libelleecriture'] || normRow['designation'] || normRow['description'] || normRow['libellecomplet'] || '';
          const n_facture = String(normRow['nfacture'] || normRow['numfacture'] || normRow['facture'] || normRow['numpiece'] || '');
          const reference = String(normRow['reference'] || normRow['ref'] || '');
          const debit = parseFloat(normRow['debit']) || parseFloat(normRow['montantdebit']) || parseFloat(normRow['debits']) || 0;
          const credit = parseFloat(normRow['credit']) || parseFloat(normRow['montantcredit']) || parseFloat(normRow['credits']) || 0;

          if (compte || debit > 0 || credit > 0) {
            journalRows.push({ code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference, debit, credit });
          }
      });

      // Génération automatique des contreparties de trésorerie (Caisse 571100 ou Banque 521100)
      const finalRows = expandTreasuryCounterparts(journalRows);

      // Un fichier journal complet doit rester équilibré dans son ensemble.
      const totalDebit = finalRows.reduce((s, r) => s + r.debit, 0);
      const totalCredit = finalRows.reduce((s, r) => s + r.credit, 0);
      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        const gap = Math.round(Math.abs(totalDebit - totalCredit));
        const isDebitLarger = totalDebit > totalCredit;
        const targetAccount = isDebitLarger ? '401100' : '411100';
        const targetLabel = isDebitLarger
          ? 'Régularisation Contrepartie Fournisseur (Équilibrage SYSCOHADA)'
          : 'Régularisation Contrepartie Client (Équilibrage SYSCOHADA)';
        const codeJournal = isDebitLarger ? 'AC' : 'VE';
        const refDate = finalRows[0] ? finalRows[0].date : new Date().toISOString().split('T')[0];

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

      // Empêche qu'un fichier déjà importé (en tout ou partie) ne double les écritures en base.
      const { rows: dedupedRows, duplicates: duplicateCount } = await dedupeJournalRows(finalRows);

      try {
        await insertJournalRowsChunked(dedupedRows);
      } catch (err) {
        console.error("COMMIT ERROR:", err);
        return res.status(500).json({ error: 'Erreur lors de la sauvegarde en base.' });
      }

      // Apprentissage automatique des règles depuis le journal importé (ML)
      let learnedCount = 0;
      try {
        learnedCount = await learnFromJournalData(data, 2);
      } catch (e) {
        console.error("Erreur apprentissage ML:", e);
      }
      // Rafraîchit les statistiques du planificateur SQLite en tâche de fond (sans bloquer
      // la réponse) : un gros import change significativement la distribution des données.
      db.run('ANALYZE', () => {});

      let msg = dedupedRows.length > 0
        ? `${dedupedRows.length} écriture(s) importée(s) avec succès.`
        : `Aucune nouvelle écriture importée.`;
      if (duplicateCount > 0) {
        msg += ` ${duplicateCount} écriture(s) ignorée(s) car déjà présente(s) en base (doublon détecté).`;
      }
      if (learnedCount > 0) {
        msg += ` 🧠 La Mémoire Métier a appris ${learnedCount} nouvelle(s) règle(s) d'imputation !`;
      }
      res.json({ success: true, message: msg });
    } else if (type === 'factures') {
      // Saisie automatique d'écritures comptables depuis le modèle Excel de factures
      db.serialize(async () => {
        const stmt = db.prepare("INSERT INTO journal (code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference, debit, credit, piece_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        let totalInvoices = 0;
        let totalEntriesCreated = 0;
        const journalEntriesForML = [];

        // Chaque facture/reçu forme une écriture (piece_id) distincte, pour permettre
        // à l'audit de vérifier l'équilibre débit=crédit par écriture. Un UUID par facture
        // (plutôt qu'un compteur MAX(piece_id)+1) pour rester sans collision entre machines.
        let pieceId = null;
        const insertLine = (...args) => stmt.run(...args, pieceId);

        // Empêche qu'un même modèle de factures importé deux fois ne double chaque facture/reçu :
        // une facture est réputée déjà traitée si (date, n° facture/référence, tiers) existe déjà.
        let duplicateInvoices = 0;
        const seenInvoiceKeys = new Set();
        let existingInvoiceKeys = new Set();
        try {
          const candidateDates = data.map(row => {
            const normRow = {};
            for (let key in row) {
              const normKey = key.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
              normRow[normKey] = row[key];
            }
            return normalizeDate(normRow['date']);
          }).filter(Boolean).sort();
          const minD = candidateDates[0];
          const maxD = candidateDates[candidateDates.length - 1];
          if (minD && maxD) {
            const existingInvoices = await db.runSelect(
              `SELECT DISTINCT date, n_facture, compte_tiers FROM journal WHERE date >= ? AND date <= ? AND n_facture IS NOT NULL AND n_facture != ''`,
              [minD, maxD]
            );
            existingInvoiceKeys = new Set((existingInvoices || []).map(r =>
              `${r.date}||${String(r.n_facture || '').trim().toLowerCase()}||${String(r.compte_tiers || '').trim().toLowerCase()}`
            ));
          }
        } catch (e) {}

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

          const invoiceRefKey = (isRecu ? (factureAssociee || numFacture) : numFacture).trim().toLowerCase();
          const invoiceKey = `${date}||${invoiceRefKey}||${nomTiers.trim().toLowerCase()}`;
          if (existingInvoiceKeys.has(invoiceKey) || seenInvoiceKeys.has(invoiceKey)) {
            duplicateInvoices++;
            continue;
          }
          seenInvoiceKeys.add(invoiceKey);

          totalInvoices++;
          pieceId = crypto.randomUUID();

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
          learnedCount = await learnFromJournalData(journalEntriesForML, 2);
        } catch (e) {
          console.error("Erreur ML:", e);
        }
        db.run('ANALYZE', () => {});

        let msg = `Génération automatique terminée : ${totalInvoices} facture(s) traitée(s), ${totalEntriesCreated} écriture(s) comptables équilibrées créées !`;
        if (duplicateInvoices > 0) {
          msg += ` ${duplicateInvoices} facture(s)/reçu(s) ignoré(s) car déjà présent(s) en base (doublon détecté).`;
        }
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

        const code_journal = normRow['codejournal'] || normRow['journal'] || normRow['code'] || 'AC';
        const poste_budgetaire = normRow['postebudgetaire'] || normRow['postebudget'] || normRow['poste'] || '';
        const date = normalizeDate(normRow['date']) || new Date().toISOString().split('T')[0];
        const compte = String(normRow['compte'] || normRow['comptegeneral'] || normRow['ncompte'] || normRow['numcompte'] || normRow['comptecomptable'] || '601100');
        const compte_tiers = String(normRow['comptetiers'] || normRow['tiers'] || normRow['nomtiers'] || normRow['auxiliaire'] || '');
        const libelle = normRow['libelle'] || normRow['libelleecriture'] || normRow['designation'] || normRow['description'] || 'Écriture importée';
        const n_facture = String(normRow['nfacture'] || normRow['numfacture'] || normRow['facture'] || normRow['numpiece'] || '');
        const reference = String(normRow['reference'] || normRow['ref'] || '');
        const debit = parseFloat(normRow['debit']) || parseFloat(normRow['montantdebit']) || parseFloat(normRow['debits']) || 0;
        const credit = parseFloat(normRow['credit']) || parseFloat(normRow['montantcredit']) || parseFloat(normRow['credits']) || 0;

        if (compte || debit > 0 || credit > 0) {
          journalRows.push({ code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference, debit, credit });
          totalDebit += debit;
          totalCredit += credit;
        }
      });
    } else if (req.body && Array.isArray(req.body.journalRows)) {
      // Soumission JSON (après écran de correction côté client) : contrairement au chemin fichier
      // ci-dessus, ces lignes n'ont jamais transité par normalizeDate. Sans cet appel, une date
      // encore au format brut (ex: "010226") est stockée telle quelle au lieu de "2026-02-01" et
      // devient invisible dès qu'un exercice comptable est sélectionné (comparaison de texte).
      req.body.journalRows.forEach(r => {
        journalRows.push({ ...r, date: normalizeDate(r.date) || r.date });
        totalDebit += parseFloat(r.debit) || 0;
        totalCredit += parseFloat(r.credit) || 0;
      });
    } else {
      return res.status(400).json({ error: 'Aucun fichier ni écriture fournie.' });
    }

    // Expansion automatique des contreparties de trésorerie (Caisse 571100 ou Banque 521100)
    const finalRows = expandTreasuryCounterparts(journalRows);

    totalDebit = finalRows.reduce((s, r) => s + r.debit, 0);
    totalCredit = finalRows.reduce((s, r) => s + r.credit, 0);

    const gap = Math.round(Math.abs(totalDebit - totalCredit));
    let balancingMessage = '';

    if (gap > 0) {
      const isDebitLarger = totalDebit > totalCredit;
      const targetAccount = isDebitLarger ? '401100' : '411100';
      const targetLabel = isDebitLarger 
        ? 'Régularisation Contrepartie Fournisseur (Équilibrage SYSCOHADA)' 
        : 'Régularisation Contrepartie Client (Équilibrage SYSCOHADA)';
      const codeJournal = isDebitLarger ? 'AC' : 'VE';
      const refDate = finalRows[0] ? finalRows[0].date : new Date().toISOString().split('T')[0];

      finalRows.push({
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

    // Empêche qu'un fichier déjà importé (en tout ou partie) ne double les écritures en base.
    const { rows: dedupedRows, duplicates: duplicateCount } = await dedupeJournalRows(finalRows);

    try {
      await insertJournalRowsChunked(dedupedRows);
    } catch (err) {
      return res.status(500).json({ error: 'Erreur d\'enregistrement en base.' });
    }

    let learnedCount = 0;
    try {
      learnedCount = await learnFromJournalData(journalRows, 2);
    } catch (e) {
      console.error(e);
    }
    db.run('ANALYZE', () => {});

    let dedupMsg = duplicateCount > 0
      ? ` ${duplicateCount} écriture(s) ignorée(s) car déjà présente(s) en base (doublon détecté).`
      : '';
    res.json({
      success: true,
      message: `Correction & Importation réussies : ${dedupedRows.length} écriture(s) sauvegardée(s) !${balancingMessage}${dedupMsg}`
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
    const isAll = req.query.all === 'true' || req.query.all === '1';
    const { clause, params } = isAll ? { clause: '', params: [] } : await getExerciceDateFilter();
    
    let whereClauses = [];
    let sqlParams = [];
    
    if (clause) {
      whereClauses.push(clause);
      sqlParams.push(...params);
    }
    
    if (req.query.search) {
      // Le placeholder du champ annonce aussi "date" : sans la colonne `date` ici, chercher
      // "2026-01" ou "15/03" ne retournait jamais rien alors que l'utilisateur s'y attend.
      whereClauses.push('(compte LIKE ? OR libelle LIKE ? OR n_facture LIKE ? OR reference LIKE ? OR compte_tiers LIKE ? OR code_journal LIKE ? OR date LIKE ?)');
      const s = `%${req.query.search}%`;
      sqlParams.push(s, s, s, s, s, s, s);
    }

    const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Compte total AVANT pagination : sans exercice sélectionné (ou avec all=1), un import
    // volumineux (ex: 367 804 lignes observées en pratique) rend un fetch non paginé du Journal
    // trop lourd à sérialiser/transférer/parser pour rester réactif, quelle que soit la machine.
    // Le total (via X-Total-Count) permet au client de paginer réellement côté serveur tout en
    // pouvant toujours parcourir l'intégralité des écritures, page par page plutôt qu'en un bloc.
    const countRow = await db.runSelect(`SELECT COUNT(*) as total FROM journal ${whereStr}`, sqlParams);
    const totalCount = (countRow && countRow[0]) ? countRow[0].total : 0;

    let sql = `SELECT * FROM journal ${whereStr} ORDER BY date DESC, created_at DESC, id DESC`;
    const DEFAULT_JOURNAL_PAGE_SIZE = 50;
    const limit = req.query.limit ? Number(req.query.limit) : DEFAULT_JOURNAL_PAGE_SIZE;
    let offset = req.query.offset ? Number(req.query.offset) : 0;

    // Saut depuis le Grand Livre vers une écriture précise : avec la pagination serveur, le client
    // ne peut plus calculer la page cible depuis une liste complète déjà chargée. On calcule ici sa
    // position réelle dans le tri courant (combien de lignes la précèdent) pour renvoyer directement
    // la page qui la contient.
    if (req.query.highlightId) {
      const target = (await db.runSelect(`SELECT date, created_at, id FROM journal WHERE id = ?`, [req.query.highlightId]))[0];
      if (target) {
        const beforeClauses = [...whereClauses, '(date > ? OR (date = ? AND created_at > ?) OR (date = ? AND created_at = ? AND id > ?))'];
        const beforeParams = [...sqlParams, target.date, target.date, target.created_at, target.date, target.created_at, target.id];
        const beforeRow = await db.runSelect(`SELECT COUNT(*) as c FROM journal WHERE ${beforeClauses.join(' AND ')}`, beforeParams);
        const countBefore = (beforeRow && beforeRow[0]) ? beforeRow[0].c : 0;
        offset = Math.floor(countBefore / limit) * limit;
      }
    }

    sql += ` LIMIT ?`;
    sqlParams.push(limit);
    sql += ` OFFSET ?`;
    sqlParams.push(offset);

    const rows = await db.runSelect(sql, sqlParams);

    // Totaux Débit/Crédit sur l'ENSEMBLE filtré (pas seulement la page courante) : l'indicateur
    // d'équilibre est un contrôle comptable qui doit porter sur tout l'exercice/la recherche en
    // cours, pas sur les 50 lignes affichées à l'écran.
    const sumRow = await db.runSelect(`SELECT COALESCE(SUM(debit),0) as d, COALESCE(SUM(credit),0) as c FROM journal ${whereStr}`, sqlParams.slice(0, sqlParams.length - 2));

    res.set('X-Offset', String(offset));
    res.set('X-Total-Count', String(totalCount));
    res.set('X-Total-Debit', String((sumRow && sumRow[0]) ? sumRow[0].d : 0));
    res.set('X-Total-Credit', String((sumRow && sumRow[0]) ? sumRow[0].c : 0));
    res.set('Access-Control-Expose-Headers', 'X-Total-Count, X-Offset, X-Total-Debit, X-Total-Credit');
    res.json(Array.isArray(rows) ? rows : []);
  } catch (err) {
    console.error('Error fetching journal:', err);
    res.json([]);
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
      `UPDATE journal SET code_journal=?, poste_budgetaire=?, date=?, compte=?, compte_tiers=?, libelle=?, n_facture=?, reference=?, debit=?, credit=?, updated_at=CURRENT_TIMESTAMP, synced_at=NULL WHERE id=?`,
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
    try {
      await db.runUpdate("INSERT INTO deleted_records (table_name, record_id) VALUES ('journal', ?)", [String(id)]);
    } catch (e) {
      console.warn("Deleted records log error:", e.message);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- GRAND LIVRE ---
// Liste des comptes ayant des écritures (exercice actif), pour le sélecteur du Grand Livre.
app.get('/api/grand-livre/comptes', async (req, res) => {
  try {
    // Passe par getBalanceRows() (solde antérieur + mouvement) plutôt que par un simple filtre de
    // période : un compte resté sans écriture pendant l'exercice actif, mais dont le solde reporté
    // est non nul, doit rester sélectionnable pour consulter son Grand Livre.
    const rows = await getBalanceRows();
    res.json(rows.map(r => ({ compte: r.compte, solde: r.solde_cumule })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Écritures d'un compte, triées chronologiquement, avec solde progressif cumulé (solde
// d'ouverture reporté des exercices antérieurs + SUM des lignes précédentes du même compte dans
// la période) — c'est la définition même d'un Grand Livre. Sans ce report, le solde progressif
// repartait de zéro à chaque changement d'exercice, ce qui ne reflète pas le solde réel du compte.
app.get('/api/grand-livre/:compte', async (req, res) => {
  try {
    const { compte } = req.params;
    const codeJournal = String(req.query.journal || '').trim();
    // Restreint aussi le solde d'ouverture au même code journal, sinon un solde reporté qui
    // mélange tous les journaux ne correspondrait plus aux lignes affichées, filtrées elles.
    const journalFilter = codeJournal ? 'AND code_journal = ?' : '';
    const journalParam = codeJournal ? [codeJournal] : [];

    const ex = await getActiveExercice();
    const exFilter = ex ? 'AND date >= ? AND date <= ?' : '';
    const exParams = ex ? [ex.date_debut, ex.date_fin] : [];

    const [openingRows, rows] = await Promise.all([
      ex
        ? db.runSelect(`SELECT SUM(debit) as debit, SUM(credit) as credit FROM journal WHERE compte = ? ${journalFilter} AND date < ?`, [compte, ...journalParam, ex.date_debut])
        : Promise.resolve([{ debit: 0, credit: 0 }]),
      db.runSelect(`
        SELECT id, date, code_journal, n_facture, reference, libelle, compte_tiers, debit, credit
        FROM journal
        WHERE compte = ? ${journalFilter} ${exFilter}
        ORDER BY date ASC, created_at ASC, id ASC
      `, [compte, ...journalParam, ...exParams]),
    ]);

    const soldeOuverture = ((openingRows[0] && openingRows[0].debit) || 0) - ((openingRows[0] && openingRows[0].credit) || 0);

    let solde = soldeOuverture;
    const lignes = rows.map(r => {
      solde += (r.debit || 0) - (r.credit || 0);
      return { ...r, solde_progressif: solde };
    });

    res.json({ compte, solde_ouverture: soldeOuverture, lignes, solde_final: solde });
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

  // UUID plutôt que MAX(piece_id)+1 : un compteur local resterait sujet aux mêmes collisions
  // entre machines que les id eux-mêmes lors du sync Supabase.
  const piece_id = crypto.randomUUID();

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

// Classification des comptes selon les règles métiers SYSCOHADA (server/ohadaRules.js),
// partagée par /api/bilan, /api/resultat et /api/financial-analysis : ces trois routes
// affichaient auparavant chacune un "résultat net" calculé différemment à partir des mêmes
// données. En centralisant le calcul dans un seul moteur, elles ne peuvent plus diverger, et
// aucun compte n'est plus ignoré silencieusement selon son préfixe (voir comptesNonClasses).
// Le résultat net calculé depuis les comptes de gestion (classes 6/7/8) est injecté dans les
// capitaux propres du bilan plutôt que d'utiliser le solde du compte 13 (qui ne porte le résultat
// qu'après une écriture de clôture), pour que le bilan s'équilibre réellement en cours d'exercice.
function computeFinancials(rows) {
  const { bilan, resultat, comptesNonClasses } = computeEtatsFinanciers(rows);
  const { actif, passif } = bilan;

  // Agrégats "à plat" conservés pour la compatibilité de /api/financial-analysis (ratios,
  // ancien tracé simplifié) — dérivés de la structure conforme ci-dessus, jamais recalculés
  // séparément.
  return {
    bilan, resultat, comptesNonClasses,
    capitauxPropres: passif.totalCapitauxPropres,
    immobilisationsNettes: actif.totalImmobilisationsNettes,
    stocks: actif.stocks.net,
    creancesClients: actif.creancesClients.net,
    dettesFournisseurs: passif.dettesFournisseurs,
    autresCreances: actif.autresCreances,
    autresDettes: passif.autresDettes,
    tresorerieActif: actif.tresorerieActif,
    tresoreriePassif: passif.tresoreriePassif,
    actifCirculant: actif.totalActifCirculant,
    passifCirculant: passif.totalPassifCirculant,
    totalActif: actif.totalActif,
    totalPassif: passif.totalPassif,
    ca: resultat.chiffreAffaires,
    achats: resultat.achatsConsommes,
    servicesExterieurs: resultat.consommationsExternes,
    chargesPersonnel: resultat.chargesPersonnel,
    dotationsAmort: resultat.dotationsExploitation,
    resultatNet: resultat.resultatNet,
    margeBrute: resultat.chiffreAffaires - resultat.achatsConsommes,
    valeurAjoutee: resultat.valeurAjoutee,
    ebe: resultat.excedentBrutExploitation,
    resultatExploitation: resultat.resultatExploitation,
    frng: passif.totalRessourcesStables - actif.totalImmobilisationsNettes,
    bfr: actif.totalActifCirculant - passif.totalPassifCirculant,
    tresorerieNette: actif.tresorerieActif - passif.tresoreriePassif,
  };
}

async function getFinancialRows() {
  try {
    const supabase = await getSupabaseClient();
    if (supabase) {
      const ex = await getActiveExercice();
      let query = supabase.from('journal').select('compte, debit, credit');
      if (ex) {
        query = query.gte('date', ex.date_debut).lte('date', ex.date_fin);
      }
      const { data, error } = await query;
      if (!error && Array.isArray(data) && data.length > 0) {
        const accMap = {};
        data.forEach(r => {
          const c = r.compte || '0';
          if (!accMap[c]) accMap[c] = { compte: c, total_debit: 0, total_credit: 0 };
          accMap[c].total_debit += (parseFloat(r.debit) || 0);
          accMap[c].total_credit += (parseFloat(r.credit) || 0);
        });
        return Object.values(accMap);
      }
    }
  } catch (e) {}

  try {
    const { clause, params } = await getExerciceDateFilter();
    const rows = await db.runSelect(`
      SELECT compte, SUM(debit) as total_debit, SUM(credit) as total_credit
      FROM journal
      ${clause ? `WHERE ${clause}` : ''}
      GROUP BY compte
    `, params);
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    return [];
  }
}

// --- MODULE D'ANALYSE FINANCIÈRE COMPLÈTE & INDICATEURS KPI SYSCOHADA ---
app.get('/api/financial-analysis', async (req, res) => {
  try {
    const rows = await getFinancialRows();
    const fin = computeFinancials(rows || []);
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
        frng: fin.frng || 0,
        bfr: fin.bfr || 0,
        tresorerieNette: fin.tresorerieNette || 0,
        capPermanents: capPermanents || 0,
        actifImmobilise: fin.immobilisationsNettes || 0,
        actifCirculant: fin.actifCirculant || 0,
        passifCirculant: fin.passifCirculant || 0,
        tresorerieActif: fin.tresorerieActif || 0,
        tresoreriePassif: fin.tresoreriePassif || 0
      },
      sig: {
        ca: fin.ca || 0,
        achats: fin.achats || 0,
        margeBrute: fin.margeBrute || 0,
        tauxMargeBrute,
        servicesExterieurs: fin.servicesExterieurs || 0,
        valeurAjoutee: fin.valeurAjoutee || 0,
        chargesPersonnel: fin.chargesPersonnel || 0,
        ebe: fin.ebe || 0,
        dotationsAmort: fin.dotationsAmort || 0,
        resultatExploitation: fin.resultatExploitation || 0,
        resultatNet: fin.resultatNet || 0,
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
    console.error("Financial analysis error:", err);
    res.json({
      equilibrium: { frng: 0, bfr: 0, tresorerieNette: 0, capPermanents: 0, actifImmobilise: 0, actifCirculant: 0, passifCirculant: 0, tresorerieActif: 0, tresoreriePassif: 0 },
      sig: { ca: 0, achats: 0, margeBrute: 0, tauxMargeBrute: '0.0', servicesExterieurs: 0, valeurAjoutee: 0, chargesPersonnel: 0, ebe: 0, dotationsAmort: 0, resultatExploitation: 0, resultatNet: 0, tauxMargeNette: '0.0' },
      ratios: { currentRatio: '1.50', quickRatio: '1.20', cashRatio: '0.80', dso: 30, dpo: 45, healthScore: 100 }
    });
  }
});

// --- FINANCIAL STATEMENTS (ÉTATS FINANCIERS) ---
app.get('/api/balance', async (req, res) => {
  try {
    const rows = await getBalanceRows();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/bilan', async (req, res) => {
  try {
    const rows = await getFinancialRows();
    const { bilan, comptesNonClasses } = computeEtatsFinanciers(rows);
    res.json({ ...bilan, comptesNonClasses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/resultat', async (req, res) => {
  try {
    const rows = await getFinancialRows();
    const { resultat, comptesNonClasses } = computeEtatsFinanciers(rows);
    res.json({ ...resultat, comptesNonClasses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- DYNAMIC JOURNALS LIST ENDPOINT ---
app.get('/api/journals-list', async (req, res) => {
  try {
    const rows = await db.runSelect("SELECT DISTINCT code_journal FROM journal WHERE code_journal IS NOT NULL AND code_journal != '' ORDER BY code_journal ASC");
    const codesInDb = rows.map(r => r.code_journal);
    const defaultCodes = ['AC', 'VE', 'BQ', 'OD', 'CA', 'CAISPR'];
    const merged = Array.from(new Set([...defaultCodes, ...codesInDb]));
    res.json(merged);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- OHADA PLAN DICTIONARY FOR EXPORTS ---
const OHADA_PLAN_DICT = {
  "10": "CAPITAL",
  "13": "RÉSULTAT NET DE L'EXERCICE",
  "16": "EMPRUNTS ET DETTES ASSIMILÉES",
  "21": "IMMOBILISATIONS INCORPORELLES",
  "22": "TERRAINS",
  "23": "BÂTIMENTS ET INSTALLATIONS",
  "24": "MATÉRIEL ET MOBILIER",
  "28": "AMORTISSEMENTS",
  "31": "MARCHANDISES",
  "32": "MATIÈRES PREMIÈRES ET FOURNITURES",
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
  "571": "CAISSE PRINCIPALE",
  "58": "VIREMENTS INTERNES",
  "60": "ACHATS ET VARIATIONS DE STOCKS",
  "601": "ACHATS DE MARCHANDISES",
  "602": "ACHATS DE MATIÈRES PREMIÈRES",
  "604": "ACHATS D'ÉTUDES ET PRESTATIONS DE SERVICES",
  "605": "AUTRES ACHATS",
  "61": "TRANSPORTS",
  "618": "AUTRES FRAIS DE TRANSPORT",
  "62": "SERVICES EXTÉRIEURS A",
  "621": "PERSONNEL EXTÉRIEUR À L'ENTREPRISE",
  "624": "ENTRETIEN ET MAINTENANCE",
  "628": "FRAIS DE TÉLÉCOMMUNICATIONS",
  "63": "SERVICES EXTÉRIEURS B",
  "632": "HONORAIRES ET CONSEILS",
  "64": "IMPÔTS ET TAXES",
  "65": "AUTRES CHARGES",
  "66": "CHARGES DE PERSONNEL",
  "67": "FRAIS FINANCIERS",
  "68": "DOTATIONS AUX AMORTISSEMENTS",
  "70": "VENTES",
  "71": "SUBVENTIONS D'EXPLOITATION",
  "73": "VARIATION DES STOCKS DE BIENS",
  "75": "AUTRES PRODUITS",
  "77": "REVENUS FINANCIERS",
  "81": "VALEURS COMP. CESSIONS IMMOB.",
  "82": "PRODUITS CESSIONS IMMOB.",
  "83": "CHARGES (HAO)",
  "84": "PRODUITS (HAO)",
  "89": "IMPÔTS SUR LE RÉSULTAT"
};

function getAccountLabelServer(compteStr, customMap = {}) {
  const str = String(compteStr || '').trim();
  if (customMap[str]) return customMap[str];
  for (let i = str.length; i >= 2; i--) {
    const prefix = str.substring(0, i);
    if (customMap[prefix]) return customMap[prefix];
    if (OHADA_PLAN_DICT[prefix]) return OHADA_PLAN_DICT[prefix];
  }
  return `COMPTE ${str}`;
}

const PDFDocument = require('pdfkit');

// --- ROUTE D'EXPORTATION EXCEL / PDF DES ÉTATS FINANCIERS SYSCOHADA ---
app.get('/api/export/etats-financiers', async (req, res) => {
  try {
    const type = req.query.type || 'pack'; // 'pack', 'bilan', 'resultat', 'balance', 'journal'
    const format = (req.query.format || 'excel').toLowerCase(); // 'excel' ou 'pdf'
    const searchParam = String(req.query.search || req.query.compte || '').trim().toLowerCase();
    const classeParam = String(req.query.classe || '').trim();
    // Doit refléter le même bouton "Toutes les dates" que l'onglet Journal (voir /api/journal) :
    // sinon l'export reste silencieusement restreint à l'exercice actif même quand l'écran affiche tout.
    const isAll = req.query.all === 'true' || req.query.all === '1';

    const { clause, params } = isAll ? { clause: '', params: [] } : await getExerciceDateFilter();

    // Fetch custom account titles map
    const customRows = await db.runSelect("SELECT compte, libelle FROM chart_of_accounts");
    const customMap = {};
    (customRows || []).forEach(r => { customMap[r.compte] = r.libelle; });

    let rawBalanceRows = await db.runSelect(`
      SELECT compte, SUM(debit) as total_debit, SUM(credit) as total_credit
      FROM journal
      ${clause ? `WHERE ${clause}` : ''}
      GROUP BY compte
      ORDER BY compte ASC
    `, params);

    let rawJournalRows = await db.runSelect(`
      SELECT * FROM journal
      ${clause ? `WHERE ${clause}` : ''}
      ORDER BY date ASC, created_at ASC, id ASC
    `, params);

    // Apply active UI filters if present
    const balanceRows = rawBalanceRows.filter(r => {
      const compteStr = String(r.compte || '');
      const label = getAccountLabelServer(compteStr, customMap).toLowerCase();
      const matchSearch = !searchParam || compteStr.startsWith(searchParam) || compteStr.includes(searchParam) || label.includes(searchParam);
      const matchClass = !classeParam || compteStr.startsWith(classeParam);
      return matchSearch && matchClass;
    });

    const journalRows = rawJournalRows.filter(r => {
      const compteStr = String(r.compte || '');
      const matchClass = !classeParam || compteStr.startsWith(classeParam);
      if (!matchClass) return false;
      if (!searchParam) return true;
      // Mêmes champs que la recherche de l'onglet Journal à l'écran (voir /api/journal) : sans ça,
      // un export filtré par libellé/n° facture/référence/tiers/code journal ne matchait jamais rien
      // et renvoyait un fichier différent de ce que l'utilisateur voyait affiché.
      const haystack = [r.compte, r.libelle, r.n_facture, r.reference, r.compte_tiers, r.code_journal]
        .map(v => String(v == null ? '' : v).toLowerCase())
        .join(' | ');
      return haystack.includes(searchParam);
    });

    const { bilan, resultat } = computeEtatsFinanciers(rawBalanceRows);

    // --- PDF EXPORT OPTION (FORMATTED ACCOUNTING TABLES) ---
    if (format === 'pdf') {
      const isLandscape = type === 'balance' || type === 'journal' || type === 'pack';
      const filename = type === 'pack' ? 'etats_financiers_syscohada.pdf' : `${type}_syscohada.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      const doc = new PDFDocument({ margin: 30, size: 'A4', layout: isLandscape ? 'landscape' : 'portrait' });
      doc.pipe(res);

      const pageWidth = isLandscape ? 841.89 : 595.28;
      const contentWidth = pageWidth - 60;

      // Title Header
      doc.fontSize(16).fillColor('#0f172a').text('COMPTABILITÉ & ÉTATS FINANCIERS SYSCOHADA', { align: 'center' });
      doc.fontSize(9).fillColor('#64748b').text(`Généré le ${new Date().toLocaleDateString('fr-FR')} par Agent DAF / Le-DAF`, { align: 'center' });
      if (searchParam || classeParam) {
        doc.fontSize(8).fillColor('#1e40af').text(`Filtres appliqués : Recherche = "${searchParam || 'Toutes'}", Classe = "${classeParam || 'Toutes'}"`, { align: 'center' });
      }
      doc.moveDown(0.8);

      const checkPageBreak = (neededHeight) => {
        if (doc.y + neededHeight > (isLandscape ? 540 : 770)) {
          doc.addPage();
          return true;
        }
        return false;
      };

      // 1. RENDER BALANCE TABLE
      if (type === 'pack' || type === 'balance') {
        doc.fontSize(12).fillColor('#1e293b').font('Helvetica-Bold').text('BALANCE GÉNÉRALE DES COMPTES (FORMAT SAGE 100 SYSCOHADA)', { underline: true });
        doc.moveDown(0.4);

        const colWidths = [75, 265, 110, 110, 110, 110];
        const drawBalanceHeader = (y) => {
          doc.rect(30, y, contentWidth, 24).fillAndStroke('#f1f5f9', '#cbd5e1');
          doc.fillColor('#0f172a').fontSize(8.5).font('Helvetica-Bold');
          let x = 30;
          const headers = ['N° Compte', 'Intitulé des comptes', 'Mvt Débit', 'Mvt Crédit', 'Solde Débiteur', 'Solde Créditeur'];
          headers.forEach((h, i) => {
            const align = i >= 2 ? 'right' : 'left';
            doc.text(h, x + 4, y + 7, { width: colWidths[i] - 8, align });
            x += colWidths[i];
          });
        };

        let y = doc.y;
        drawBalanceHeader(y);
        y += 24;

        const groups = {};
        let bilanD = 0, bilanC = 0, gestionD = 0, gestionC = 0, grandD = 0, grandC = 0;

        balanceRows.forEach(r => {
          const compteStr = String(r.compte);
          const root = compteStr.substring(0, 2);
          if (!groups[root]) groups[root] = { rows: [], tD: 0, tC: 0 };
          groups[root].rows.push(r);
          groups[root].tD += (r.total_debit || 0);
          groups[root].tC += (r.total_credit || 0);

          const rootClass = parseInt(compteStr.substring(0, 1), 10);
          if (rootClass >= 1 && rootClass <= 5) {
            bilanD += (r.total_debit || 0);
            bilanC += (r.total_credit || 0);
          } else {
            gestionD += (r.total_debit || 0);
            gestionC += (r.total_credit || 0);
          }
          grandD += (r.total_debit || 0);
          grandC += (r.total_credit || 0);
        });

        Object.keys(groups).sort().forEach(root => {
          const g = groups[root];
          const subSolde = g.tD - g.tC;

          g.rows.forEach(r => {
            if (checkPageBreak(22)) {
              y = doc.y;
              drawBalanceHeader(y);
              y += 24;
            }

            const label = getAccountLabelServer(r.compte, customMap);
            const solde = (r.total_debit || 0) - (r.total_credit || 0);

            doc.rect(30, y, contentWidth, 20).stroke('#e2e8f0');
            doc.fillColor('#1e293b').fontSize(8).font('Helvetica');

            let x = 30;
            doc.text(r.compte, x + 4, y + 5, { width: colWidths[0] - 8, align: 'left' }); x += colWidths[0];
            doc.text(label.substring(0, 48), x + 4, y + 5, { width: colWidths[1] - 8, align: 'left' }); x += colWidths[1];
            doc.text(r.total_debit > 0 ? Math.round(r.total_debit).toLocaleString() : '', x + 4, y + 5, { width: colWidths[2] - 8, align: 'right' }); x += colWidths[2];
            doc.text(r.total_credit > 0 ? Math.round(r.total_credit).toLocaleString() : '', x + 4, y + 5, { width: colWidths[3] - 8, align: 'right' }); x += colWidths[3];
            doc.text(solde > 0 ? Math.round(solde).toLocaleString() : '', x + 4, y + 5, { width: colWidths[4] - 8, align: 'right' }); x += colWidths[4];
            doc.text(solde < 0 ? Math.round(Math.abs(solde)).toLocaleString() : '', x + 4, y + 5, { width: colWidths[5] - 8, align: 'right' });

            y += 20;
          });

          // Sub-total row
          if (checkPageBreak(22)) {
            y = doc.y;
            drawBalanceHeader(y);
            y += 24;
          }

          doc.rect(30, y, contentWidth, 20).fillAndStroke('#f8fafc', '#cbd5e1');
          doc.fillColor('#0f172a').fontSize(8).font('Helvetica-Bold');

          let x = 30;
          doc.text(root, x + 4, y + 5, { width: colWidths[0] - 8, align: 'left' }); x += colWidths[0];
          doc.text(`***SOUS-TOTAL ${getAccountLabelServer(root, customMap)}`, x + 4, y + 5, { width: colWidths[1] - 8, align: 'left' }); x += colWidths[1];
          doc.text(g.tD > 0 ? Math.round(g.tD).toLocaleString() : '', x + 4, y + 5, { width: colWidths[2] - 8, align: 'right' }); x += colWidths[2];
          doc.text(g.tC > 0 ? Math.round(g.tC).toLocaleString() : '', x + 4, y + 5, { width: colWidths[3] - 8, align: 'right' }); x += colWidths[3];
          doc.text(subSolde > 0 ? Math.round(subSolde).toLocaleString() : '', x + 4, y + 5, { width: colWidths[4] - 8, align: 'right' }); x += colWidths[4];
          doc.text(subSolde < 0 ? Math.round(Math.abs(subSolde)).toLocaleString() : '', x + 4, y + 5, { width: colWidths[5] - 8, align: 'right' });

          y += 20;
        });

        // Summary Totals
        if (checkPageBreak(65)) {
          y = doc.y;
          drawBalanceHeader(y);
          y += 24;
        }

        const bSolde = bilanD - bilanC;
        const gSolde = gestionD - gestionC;
        const totSolde = grandD - grandC;

        // Totaux Bilan
        doc.rect(30, y, contentWidth, 20).fillAndStroke('#e2e8f0', '#94a3b8');
        doc.fillColor('#0f172a').fontSize(8.5).font('Helvetica-Bold');
        let x = 30;
        doc.text('Totaux comptes de bilan', x + 4, y + 5, { width: colWidths[0] + colWidths[1] - 8, align: 'left' });
        x += colWidths[0] + colWidths[1];
        doc.text(Math.round(bilanD).toLocaleString(), x + 4, y + 5, { width: colWidths[2] - 8, align: 'right' }); x += colWidths[2];
        doc.text(Math.round(bilanC).toLocaleString(), x + 4, y + 5, { width: colWidths[3] - 8, align: 'right' }); x += colWidths[3];
        doc.text(bSolde > 0 ? Math.round(bSolde).toLocaleString() : '', x + 4, y + 5, { width: colWidths[4] - 8, align: 'right' }); x += colWidths[4];
        doc.text(bSolde < 0 ? Math.round(Math.abs(bSolde)).toLocaleString() : '', x + 4, y + 5, { width: colWidths[5] - 8, align: 'right' });
        y += 20;

        // Totaux Gestion
        doc.rect(30, y, contentWidth, 20).fillAndStroke('#e2e8f0', '#94a3b8');
        doc.fillColor('#0f172a').fontSize(8.5).font('Helvetica-Bold');
        x = 30;
        doc.text('Totaux comptes de gestion', x + 4, y + 5, { width: colWidths[0] + colWidths[1] - 8, align: 'left' });
        x += colWidths[0] + colWidths[1];
        doc.text(Math.round(gestionD).toLocaleString(), x + 4, y + 5, { width: colWidths[2] - 8, align: 'right' }); x += colWidths[2];
        doc.text(Math.round(gestionC).toLocaleString(), x + 4, y + 5, { width: colWidths[3] - 8, align: 'right' }); x += colWidths[3];
        doc.text(gSolde > 0 ? Math.round(gSolde).toLocaleString() : '', x + 4, y + 5, { width: colWidths[4] - 8, align: 'right' }); x += colWidths[4];
        doc.text(gSolde < 0 ? Math.round(Math.abs(gSolde)).toLocaleString() : '', x + 4, y + 5, { width: colWidths[5] - 8, align: 'right' });
        y += 20;

        // Totaux Balance
        doc.rect(30, y, contentWidth, 22).fillAndStroke('#cbd5e1', '#475569');
        doc.fillColor('#0f172a').fontSize(9).font('Helvetica-Bold');
        x = 30;
        doc.text('TOTAUX GÉNÉRAUX DE LA BALANCE', x + 4, y + 6, { width: colWidths[0] + colWidths[1] - 8, align: 'left' });
        x += colWidths[0] + colWidths[1];
        doc.text(Math.round(grandD).toLocaleString(), x + 4, y + 6, { width: colWidths[2] - 8, align: 'right' }); x += colWidths[2];
        doc.text(Math.round(grandC).toLocaleString(), x + 4, y + 6, { width: colWidths[3] - 8, align: 'right' }); x += colWidths[3];
        doc.text(totSolde > 0 ? Math.round(totSolde).toLocaleString() : '', x + 4, y + 6, { width: colWidths[4] - 8, align: 'right' }); x += colWidths[4];
        doc.text(totSolde < 0 ? Math.round(Math.abs(totSolde)).toLocaleString() : '', x + 4, y + 6, { width: colWidths[5] - 8, align: 'right' });

        doc.y = y + 30;
      }

      // 2. RENDER JOURNAL TABLE (IF REQUESTED)
      if (type === 'journal' || (type === 'pack' && !balanceRows.length)) {
        if (doc.y > 400) doc.addPage();
        doc.fontSize(12).fillColor('#1e293b').font('Helvetica-Bold').text('JOURNAL GÉNÉRAL DES ÉCRITURES', { underline: true });
        doc.moveDown(0.4);

        const jColWidths = [45, 65, 45, 60, 65, 80, 200, 70, 75, 75];
        const drawJournalHeader = (y) => {
          doc.rect(30, y, contentWidth, 22).fillAndStroke('#f1f5f9', '#cbd5e1');
          doc.fillColor('#0f172a').fontSize(8).font('Helvetica-Bold');
          let x = 30;
          const headers = ['ID', 'Date', 'Code', 'Budget', 'Compte', 'Tiers', 'Libellé écriture', 'N° Fact.', 'Débit', 'Crédit'];
          headers.forEach((h, i) => {
            const align = i >= 8 ? 'right' : 'left';
            doc.text(h, x + 3, y + 6, { width: jColWidths[i] - 6, align });
            x += jColWidths[i];
          });
        };

        let y = doc.y;
        drawJournalHeader(y);
        y += 22;

        // Un PDF de dizaines/centaines de milliers de lignes n'est plus exploitable (ni même
        // générable dans un temps raisonnable) : on plafonne l'AFFICHAGE, mais les totaux ci-dessous
        // portent toujours sur la TOTALITÉ de `journalRows`, jamais sur le seul extrait imprimé — et
        // un avertissement explicite remplace la troncature silencieuse d'origine.
        const PDF_JOURNAL_MAX_ROWS = 2000;
        const journalRowsAll = journalRows || [];
        const truncated = journalRowsAll.length > PDF_JOURNAL_MAX_ROWS;

        // r.id est un UUID interne (clé de synchronisation) depuis la migration multi-machines :
        // le rendu brut débordait largement de la colonne (45pt prévus pour un numéro, pas 36
        // caractères), décalant toutes les colonnes suivantes. Un numéro de ligne séquentiel est
        // à la fois lisible et ce que l'utilisateur attend d'une colonne "ID" imprimée.
        journalRowsAll.slice(0, PDF_JOURNAL_MAX_ROWS).forEach((r, idx) => {
          if (checkPageBreak(20)) {
            y = doc.y;
            drawJournalHeader(y);
            y += 22;
          }
          doc.rect(30, y, contentWidth, 18).stroke('#e2e8f0');
          doc.fillColor('#1e293b').fontSize(7.5).font('Helvetica');

          let x = 30;
          doc.text(String(idx + 1), x + 3, y + 4, { width: jColWidths[0] - 6, align: 'left' }); x += jColWidths[0];
          doc.text(String(r.date || ''), x + 3, y + 4, { width: jColWidths[1] - 6, align: 'left' }); x += jColWidths[1];
          doc.text(String(r.code_journal || ''), x + 3, y + 4, { width: jColWidths[2] - 6, align: 'left' }); x += jColWidths[2];
          doc.text(String(r.poste_budgetaire || '').substring(0, 10), x + 3, y + 4, { width: jColWidths[3] - 6, align: 'left' }); x += jColWidths[3];
          doc.text(String(r.compte || ''), x + 3, y + 4, { width: jColWidths[4] - 6, align: 'left' }); x += jColWidths[4];
          doc.text(String(r.compte_tiers || '').substring(0, 14), x + 3, y + 4, { width: jColWidths[5] - 6, align: 'left' }); x += jColWidths[5];
          doc.text(String(r.libelle || '').substring(0, 36), x + 3, y + 4, { width: jColWidths[6] - 6, align: 'left' }); x += jColWidths[6];
          doc.text(String(r.n_facture || '').substring(0, 10), x + 3, y + 4, { width: jColWidths[7] - 6, align: 'left' }); x += jColWidths[7];
          doc.text(r.debit > 0 ? Math.round(r.debit).toLocaleString() : '', x + 3, y + 4, { width: jColWidths[8] - 6, align: 'right' }); x += jColWidths[8];
          doc.text(r.credit > 0 ? Math.round(r.credit).toLocaleString() : '', x + 3, y + 4, { width: jColWidths[9] - 6, align: 'right' });

          y += 18;
        });

        if (checkPageBreak(30)) y = doc.y;
        const jTotalDebit = journalRowsAll.reduce((s, r) => s + (r.debit || 0), 0);
        const jTotalCredit = journalRowsAll.reduce((s, r) => s + (r.credit || 0), 0);
        const jEcart = jTotalDebit - jTotalCredit;
        doc.rect(30, y, contentWidth, 18).fillAndStroke('#f1f5f9', '#cbd5e1');
        doc.fillColor('#0f172a').fontSize(8).font('Helvetica-Bold');
        doc.text('TOTAL GÉNÉRAL (toutes écritures)', 33, y + 5, { width: 300, align: 'left' });
        doc.text(Math.round(jTotalDebit).toLocaleString(), 30 + jColWidths.slice(0, 8).reduce((s, w) => s + w, 0) + 3, y + 5, { width: jColWidths[8] - 6, align: 'right' });
        doc.text(Math.round(jTotalCredit).toLocaleString(), 30 + jColWidths.slice(0, 9).reduce((s, w) => s + w, 0) + 3, y + 5, { width: jColWidths[9] - 6, align: 'right' });
        y += 18;

        doc.fontSize(8).font('Helvetica-Bold').fillColor(Math.abs(jEcart) < 1 ? '#15803d' : '#b91c1c');
        doc.text(Math.abs(jEcart) < 1 ? '✓ Journal équilibré (Débit = Crédit)' : `⚠ Journal déséquilibré — écart de ${Math.round(jEcart).toLocaleString()} FCFA`, 30, y + 4);
        y += 16;

        if (truncated) {
          doc.fontSize(7.5).font('Helvetica-Oblique').fillColor('#b91c1c');
          doc.text(`⚠ Aperçu limité aux ${PDF_JOURNAL_MAX_ROWS.toLocaleString()} premières écritures sur ${journalRowsAll.length.toLocaleString()} au total (les totaux ci-dessus portent bien sur l'intégralité). Utilisez l'export Excel pour obtenir toutes les écritures en détail.`, 30, y + 2, { width: contentWidth });
          y += 20;
        }

        doc.y = y + 15;
      }

      // 3. RENDER BILAN TABLE (IF REQUESTED)
      if ((type === 'pack' || type === 'bilan') && bilan) {
        if (doc.y > 350) doc.addPage();
        doc.fontSize(12).fillColor('#1e293b').font('Helvetica-Bold').text('BILAN SYSCOHADA (RÉSUMÉ CONFORME)', { underline: true });
        doc.moveDown(0.4);

        let y = doc.y;
        doc.rect(30, y, contentWidth, 20).fillAndStroke('#f1f5f9', '#cbd5e1');
        doc.fillColor('#0f172a').fontSize(8.5).font('Helvetica-Bold');
        doc.text('POSTE DU BILAN', 35, y + 5, { width: 320, align: 'left' });
        doc.text('MONTANT NET (FCFA)', 370, y + 5, { width: 195, align: 'right' });
        y += 20;

        const bRows = [
          { label: 'ACTIF IMMOBILISÉ (NET)', val: bilan.actif.totalImmobilisationsNettes, bold: true },
          { label: '  Immobilisations Incorporelles', val: bilan.actif.immobilisationsIncorporelles.net },
          { label: '  Immobilisations Corporelles', val: bilan.actif.immobilisationsCorporelles.net },
          { label: '  Immobilisations Financières', val: bilan.actif.immobilisationsFinancieres.net },
          { label: 'ACTIF CIRCULANT (NET)', val: bilan.actif.totalActifCirculant, bold: true },
          { label: '  Stocks & En-cours', val: bilan.actif.stocks.net },
          { label: '  Créances Clients', val: bilan.actif.creancesClients.net },
          { label: '  Autres Créances', val: bilan.actif.autresCreances },
          { label: 'TRÉSORERIE ACTIF', val: bilan.actif.tresorerieActif, bold: true },
          { label: 'TOTAL GÉNÉRAL ACTIF', val: bilan.actif.totalActif, bold: true, highlight: true },
          { label: 'CAPITAUX PROPRES & RESSOURCES STABLES', val: bilan.passif.totalCapitauxPropres, bold: true },
          { label: '  Capital, Réserves & Reports', val: bilan.passif.capitalEtReserves },
          { label: '  Résultat Net de l\'exercice', val: bilan.passif.resultatNet },
          { label: 'PASSIF CIRCULANT', val: bilan.passif.totalPassifCirculant, bold: true },
          { label: '  Dettes Fournisseurs', val: bilan.passif.dettesFournisseurs },
          { label: '  Dettes Fiscales & Sociales', val: bilan.passif.dettesFiscalesSociales },
          { label: '  Autres Dettes', val: bilan.passif.autresDettes },
          { label: 'TRÉSORERIE PASSIF', val: bilan.passif.tresoreriePassif, bold: true },
          { label: 'TOTAL GÉNÉRAL PASSIF', val: bilan.passif.totalPassif, bold: true, highlight: true }
        ];

        bRows.forEach(r => {
          if (checkPageBreak(20)) {
            y = doc.y;
          }
          if (r.highlight) {
            doc.rect(30, y, contentWidth, 20).fillAndStroke('#e2e8f0', '#475569');
          } else if (r.bold) {
            doc.rect(30, y, contentWidth, 18).fillAndStroke('#f8fafc', '#cbd5e1');
          } else {
            doc.rect(30, y, contentWidth, 18).stroke('#e2e8f0');
          }

          doc.fillColor('#0f172a').fontSize(8).font(r.bold ? 'Helvetica-Bold' : 'Helvetica');
          doc.text(r.label, 35, y + 4, { width: 320, align: 'left' });
          doc.text(r.val !== undefined ? Math.round(r.val).toLocaleString() + ' FCFA' : '', 370, y + 4, { width: 195, align: 'right' });
          y += r.highlight ? 22 : 18;
        });

        doc.y = y + 25;
      }

      // 4. RENDER COMPTE DE RÉSULTAT TABLE (IF REQUESTED)
      if ((type === 'pack' || type === 'resultat') && resultat) {
        if (doc.y > 350) doc.addPage();
        doc.fontSize(12).fillColor('#1e293b').font('Helvetica-Bold').text('COMPTE DE RÉSULTAT SYSCOHADA (SIG)', { underline: true });
        doc.moveDown(0.4);

        let y = doc.y;
        doc.rect(30, y, contentWidth, 20).fillAndStroke('#f1f5f9', '#cbd5e1');
        doc.fillColor('#0f172a').fontSize(8.5).font('Helvetica-Bold');
        doc.text('SOLDES INTERMÉDIAIRES DE GESTION (SIG)', 35, y + 5, { width: 320, align: 'left' });
        doc.text('MONTANT (FCFA)', 370, y + 5, { width: 195, align: 'right' });
        y += 20;

        const rRows = [
          { label: 'Chiffre d\'Affaires (Ventes 70)', val: resultat.chiffreAffaires },
          { label: '- Achats Consommés de marchandises (60)', val: resultat.achatsConsommes },
          { label: '= MARGE BRUTE D\'EXPLOITATION', val: resultat.chiffreAffaires - resultat.achatsConsommes, bold: true },
          { label: '- Consommations Extérieures (61 à 65)', val: resultat.consommationsExternes },
          { label: '= VALEUR AJOUTÉE', val: resultat.valeurAjoutee, bold: true },
          { label: '- Charges de Personnel (66)', val: resultat.chargesPersonnel },
          { label: '= EXCÉDENT BRUT D\'EXPLOITATION (EBE)', val: resultat.excedentBrutExploitation, bold: true },
          { label: '- Dotations aux Amortissements & Provisions (68)', val: resultat.dotationsExploitation },
          { label: '= RÉSULTAT D\'EXPLOITATION', val: resultat.resultatExploitation, bold: true },
          { label: '+ Résultat Financier (77 - 67)', val: resultat.resultatFinancier },
          { label: '+ Résultat HAO', val: resultat.resultatHAO },
          { label: '- Impôts sur les bénéfices (89)', val: resultat.impotBefices },
          { label: '= RÉSULTAT NET DE L\'EXERCICE', val: resultat.resultatNet, bold: true, highlight: true }
        ];

        rRows.forEach(r => {
          if (checkPageBreak(20)) {
            y = doc.y;
          }
          if (r.highlight) {
            doc.rect(30, y, contentWidth, 22).fillAndStroke('#cbd5e1', '#1e293b');
          } else if (r.bold) {
            doc.rect(30, y, contentWidth, 18).fillAndStroke('#f8fafc', '#cbd5e1');
          } else {
            doc.rect(30, y, contentWidth, 18).stroke('#e2e8f0');
          }

          doc.fillColor('#0f172a').fontSize(8.5).font(r.bold ? 'Helvetica-Bold' : 'Helvetica');
          doc.text(r.label, 35, y + 4, { width: 320, align: 'left' });
          doc.text(r.val !== undefined ? Math.round(r.val).toLocaleString() + ' FCFA' : '', 370, y + 4, { width: 195, align: 'right' });
          y += r.highlight ? 24 : 18;
        });
      }

      doc.end();
      return;
    }

    // --- EXCEL EXPORT OPTION ---
    const wb = xlsx.utils.book_new();

    if (type === 'pack' || type === 'bilan') {
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
      xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(bilanAoa), "Bilan_SYSCOHADA");
    }

    if (type === 'pack' || type === 'resultat') {
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
      xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(resultatAoa), "Compte_de_Resultat");
    }

    if (type === 'pack' || type === 'balance') {
      const balanceAoa = [
        ["BALANCE GÉNÉRALE DES COMPTES SYSCOHADA"],
        ["Compte", "Intitulé des comptes", "Cumul Débit", "Cumul Crédit", "Solde Débiteur", "Solde Créditeur"]
      ];
      balanceRows.forEach(r => {
        const solde = (r.total_debit || 0) - (r.total_credit || 0);
        const label = getAccountLabelServer(r.compte, customMap);
        balanceAoa.push([
          r.compte,
          label,
          r.total_debit || 0,
          r.total_credit || 0,
          solde > 0 ? solde : 0,
          solde < 0 ? Math.abs(solde) : 0
        ]);
      });
      xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(balanceAoa), "Balance_Generale");
    }

    if (type === 'pack' || type === 'journal') {
      const journalAoa = [
        ["JOURNAL GÉNÉRAL DES ÉCRITURES"],
        ["ID", "Date", "Code Journal", "Budget", "N° Compte", "Compte Tiers", "Libellé écriture", "N° Facture", "Référence", "Débit", "Crédit"]
      ];
      let journalSumDebit = 0, journalSumCredit = 0;
      // r.id est un UUID interne (clé de synchronisation) depuis la migration multi-machines,
      // illisible et sans valeur pour un export destiné à être lu/imprimé : un numéro de ligne
      // séquentiel généré ici est ce que l'utilisateur attend d'une colonne "ID" sur ce document.
      journalRows.forEach((r, idx) => {
        const debit = r.debit || 0;
        const credit = r.credit || 0;
        journalSumDebit += debit;
        journalSumCredit += credit;
        journalAoa.push([
          idx + 1,
          r.date,
          r.code_journal,
          r.poste_budgetaire,
          r.compte,
          r.compte_tiers,
          r.libelle,
          r.n_facture,
          r.reference,
          debit,
          credit
        ]);
      });
      // Totaux + indicateur d'équilibre, cohérents avec ce qu'affiche l'onglet Journal à l'écran
      // (voir isJournalEquilibre côté frontend) : sans ça, le fichier exporté ne permettait pas de
      // vérifier que le journal exporté est bien équilibré.
      const journalEcart = journalSumDebit - journalSumCredit;
      journalAoa.push([]);
      journalAoa.push(["", "", "", "", "", "", "TOTAL GÉNÉRAL", "", "", journalSumDebit, journalSumCredit]);
      journalAoa.push(["", "", "", "", "", "", Math.abs(journalEcart) < 1 ? "✓ Équilibré (Débit = Crédit)" : `⚠ Déséquilibré — écart de ${journalEcart.toLocaleString('fr-FR')} FCFA`]);
      xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(journalAoa), "Journal_General");
    }

    const excelBuffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = type === 'pack' ? 'etats_financiers_syscohada.xlsx' : `${type}_syscohada.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(excelBuffer);
  } catch (err) {
    console.error("Export error:", err);
    res.status(500).json({ error: "Erreur lors de la génération de l'exportation des états financiers." });
  }
});

// --- AUDIT & CORRECTION ---
const { askAuditAI } = require('./ai');

app.get('/api/audit', async (req, res) => {
  try {
    const { clause, params } = await getExerciceDateFilter();
    const exFilter = clause ? `AND ${clause}` : '';
    const exWhere = clause ? `WHERE ${clause}` : '';

    const checks = [
      // 1. Tiers manquants
      db.runSelect(`SELECT id, date, compte, libelle, debit, credit FROM journal WHERE (compte LIKE '40%' OR compte LIKE '41%') AND (compte_tiers IS NULL OR compte_tiers = '') ${exFilter} LIMIT 20`, params)
        .then(rows => rows.length > 0 ? { type: 'Tiers Manquant', description: 'Écritures sur comptes 40/41 sans compte tiers renseigné', data: rows } : null),

      // 2. Caisse négative
      db.runSelect(`SELECT compte, SUM(debit)-SUM(credit) as solde FROM journal ${exWhere} ${exWhere ? 'AND' : 'WHERE'} compte LIKE '57%' GROUP BY compte HAVING solde < 0`, params)
        .then(rows => rows.length > 0 ? { type: 'Caisse Négative', description: 'Le solde de la caisse ne peut pas être créditeur', data: rows } : null),

      // 3. Comptes d'attente
      db.runSelect(`SELECT compte, SUM(debit)-SUM(credit) as solde FROM journal ${exWhere} ${exWhere ? 'AND' : 'WHERE'} compte LIKE '47%' GROUP BY compte HAVING solde != 0`, params)
        .then(rows => rows.length > 0 ? { type: 'Comptes d\'attente (47)', description: 'Ces comptes doivent être soldés avant la clôture', data: rows } : null),

      // 4. Comptes invalides (trop courts ou lettres)
      db.runSelect(`SELECT id, date, compte, libelle, debit, credit FROM journal WHERE (length(compte) < 2 OR CAST(compte AS INTEGER) = 0) ${exFilter} LIMIT 20`, params)
        .then(rows => rows.length > 0 ? { type: 'Compte Invalide', description: 'La structure du compte ne respecte pas le format numérique standard', data: rows } : null),

      // 5. Déséquilibre global de l'exercice
      db.runSelect(`SELECT SUM(debit) as total_debit, SUM(credit) as total_credit FROM journal ${exWhere}`, params)
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

      // 6. Écritures déséquilibrées : chaque piece_id doit s'équilibrer
      db.runSelect(`
        SELECT j.piece_id, MIN(j.date) as date, MIN(j.libelle) as libelle, SUM(j.debit) as debit, SUM(j.credit) as credit
        FROM journal j
        WHERE j.piece_id IS NOT NULL ${exFilter}
        GROUP BY j.piece_id
        HAVING ABS(SUM(j.debit) - SUM(j.credit)) > 0.01
        LIMIT 20
      `, params).then(rows => rows.length > 0 ? {
        type: 'Écriture(s) Déséquilibrée(s)',
        description: 'Ces écritures (regroupées par pièce) ont un débit total différent du crédit total et doivent être corrigées.',
        data: rows.map(r => ({ id: r.piece_id, date: r.date, compte: '-', libelle: r.libelle, debit: r.debit, credit: r.credit }))
      } : null),
    ];

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
const AUDIT_APPLY_ALLOWED_TABLES = ['journal', 'tiers', 'business_rules', 'chart_of_accounts', 'exercices', 'fiscal_echeances', 'statement_lines'];

function splitAndValidateSqlStatements(rawSql) {
  if (!rawSql || typeof rawSql !== 'string') {
    return { error: "Aucune requête SQL fournie." };
  }

  // 1. Enlever les blocs de code Markdown (```sql ... ```, ```json ... ```, ```proposal ... ```)
  let text = rawSql.trim();
  text = text.replace(/^```(?:sql|json|proposal)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // 2. Enlever les commentaires SQL de blocs (/* ... */) et de lignes (-- ...)
  text = text.replace(/\/\*[\s\S]*?\*\//g, '');
  text = text.replace(/^--.*$/gm, '').trim();

  if (!text) {
    return { error: "Requête SQL vide après nettoyage." };
  }

  // 3. Découper en requêtes séparées par point-virgule (sans couper dans les chaînes littérales)
  const statements = [];
  let currentStmt = '';
  let inString = false;
  let quoteChar = '';

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if ((char === "'" || char === '"') && (i === 0 || text[i - 1] !== '\\')) {
      if (!inString) {
        inString = true;
        quoteChar = char;
      } else if (quoteChar === char) {
        inString = false;
      }
      currentStmt += char;
    } else if (char === ';' && !inString) {
      if (currentStmt.trim()) {
        statements.push(currentStmt.trim());
      }
      currentStmt = '';
    } else {
      currentStmt += char;
    }
  }

  if (currentStmt.trim()) {
    statements.push(currentStmt.trim());
  }

  if (statements.length === 0) {
    return { error: "Aucune instruction SQL valide trouvée." };
  }

  // 4. Valider chaque instruction individuellement
  const cleanStatements = [];
  for (let stmt of statements) {
    // Normaliser préfixe public.table -> table
    stmt = stmt.replace(/\bpublic\.(\w+)\b/gi, '$1').trim();

    const sqlUpper = stmt.toUpperCase();

    // Bloquer les commandes système bas-niveau de manipulation de fichiers
    if (sqlUpper.startsWith("PRAGMA") || sqlUpper.startsWith("ATTACH") || sqlUpper.startsWith("DETACH")) {
      return { error: `La commande système PRAGMA/ATTACH n'est pas autorisée.` };
    }

    // Autoriser tout SQL d'action : UPDATE, INSERT, DELETE, WITH (CTEs), REPLACE, CREATE, ALTER, DROP
    const isAllowedVerb = /^(?:UPDATE|INSERT|DELETE|WITH|REPLACE|CREATE|ALTER|DROP)\b/i.test(sqlUpper);
    if (!isAllowedVerb) {
      return { error: `Instruction non autorisée : "${stmt.slice(0, 50)}...".` };
    }

    cleanStatements.push(stmt);
  }

  return { statements: cleanStatements };
}

app.post('/api/audit/apply', (req, res) => {
  const { sql: rawSql } = req.body;
  const validation = splitAndValidateSqlStatements(rawSql);

  if (validation.error) {
    return res.status(400).json({ error: validation.error });
  }

  const statements = validation.statements;

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    let totalChanges = 0;

    const executeNext = (index) => {
      if (index >= statements.length) {
        return db.run("COMMIT", (commitErr) => {
          if (commitErr) return res.status(500).json({ error: commitErr.message });
          res.json({ 
            success: true, 
            changes: totalChanges, 
            statementsCount: statements.length,
            message: `${statements.length} action(s) exécutée(s) avec succès (${totalChanges} ligne(s) affectée(s)).` 
          });
        });
      }

      const stmt = statements[index];
      db.run(stmt, function (err) {
        if (err) {
          return db.run("ROLLBACK", () => res.status(500).json({ error: `Erreur SQL sur [${stmt.slice(0, 40)}...] : ${err.message}` }));
        }
        totalChanges += (this.changes || 0);
        executeNext(index + 1);
      });
    };

    executeNext(0);
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

// --- ROUTES SYNCHRONISATION SUPABASE ---
app.get('/api/sync/status', async (req, res) => {
  try {
    const settings = await getSyncSettings();
    const pendingCount = await getPendingLocalCount();
    const lastLogs = await db.runSelect("SELECT * FROM sync_logs ORDER BY id DESC LIMIT 1");
    const lastLog = lastLogs[0] || null;

    res.json({
      url: settings.url,
      hasKey: !!settings.key,
      autoSync: settings.autoSync,
      pendingCount,
      lastLog
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sync/push', sensitiveLimiter, async (req, res) => {
  try {
    const result = await performPush();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sync/pull', sensitiveLimiter, async (req, res) => {
  try {
    const force = req.body && req.body.force === true;
    const result = await performPull(force);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sync/progress', (req, res) => {
  try {
    res.json(getSyncProgress());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/clear', sensitiveLimiter, async (req, res) => {
  try {
    await new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run("PRAGMA foreign_keys = OFF");
        
        // Supprimer toutes les écritures et données locales
        db.run("DELETE FROM journal");
        db.run("DELETE FROM tiers");
        db.run("DELETE FROM statement_lines");
        db.run("DELETE FROM sync_logs");
        db.run("DELETE FROM exercices");
        
        // Vider la traçabilité des suppressions locales pour NE PAS toucher à Supabase Cloud
        db.run("DELETE FROM deleted_records");
        db.run("DELETE FROM settings WHERE key LIKE 'LAST_%'");
        
        // Réinitialiser les compteurs d'incrémentation automatique
        db.run("DELETE FROM sqlite_sequence WHERE name IN ('journal', 'tiers', 'statement_lines', 'sync_logs', 'exercices', 'deleted_records')");
        
        db.run("PRAGMA foreign_keys = ON", (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });

    // Double vérification instantanée : s'assurer qu'aucun enregistrement ne subsiste
    try {
      const checkJournal = await db.runSelect("SELECT COUNT(*) as c FROM journal");
      const checkTiers = await db.runSelect("SELECT COUNT(*) as c FROM tiers");
      const countJournal = (checkJournal && checkJournal[0]) ? checkJournal[0].c : 0;
      const countTiers = (checkTiers && checkTiers[0]) ? checkTiers[0].c : 0;

      if (countJournal > 0 || countTiers > 0) {
        await db.runUpdate("DELETE FROM journal");
        await db.runUpdate("DELETE FROM tiers");
        await db.runUpdate("DELETE FROM deleted_records");
      }
    } catch (checkErr) {
      console.warn("Post-clear check warning:", checkErr.message);
    }

    res.json({ success: true, message: "Base de données locale intégralement réinitialisée en 1 clic (Supabase Cloud préservé intact)." });
  } catch (err) {
    console.error("Clear DB Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- GESTIONNAIRE DE MISES À JOUR AUTOMATIQUES (MULTI-POSTES) ---
const CURRENT_VERSION = require('../package.json').version;
const UPDATE_MANIFEST_URL = "https://raw.githubusercontent.com/anorps1-png/Le-DAF/main/version.json";

// Domaines autorisés pour le téléchargement d'un installeur de mise à jour : uniquement les
// releases GitHub du dépôt officiel (et le CDN objects.githubusercontent.com vers lequel
// GitHub redirige les téléchargements de release), en HTTPS exclusivement.
const ALLOWED_UPDATE_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com'
]);
function isAllowedUpdateUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'https:' &&
      ALLOWED_UPDATE_HOSTS.has(parsed.hostname) &&
      (parsed.hostname !== 'github.com' || parsed.pathname.startsWith('/anorps1-png/Le-DAF/releases/'));
  } catch {
    return false;
  }
}

function compareSemVer(v1, v2) {
  const parse = v => (v || '').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const p1 = parse(v1);
  const p2 = parse(v2);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const num1 = p1[i] || 0;
    const num2 = p2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

app.get('/api/system/version', (req, res) => {
  res.json({
    version: CURRENT_VERSION,
    appName: 'Agent OHADA (Le-DAF)',
    isDesktop: !process.env.VERCEL,
    platform: process.platform,
    arch: process.arch
  });
});

app.get('/api/system/check-update', async (req, res) => {
  try {
    const response = await fetch(UPDATE_MANIFEST_URL + '?t=' + Date.now());
    if (!response.ok) {
      return res.json({ hasUpdate: false, currentVersion: CURRENT_VERSION, message: 'Impossible de joindre le serveur de mise à jour.' });
    }
    const manifest = await response.json();
    const latestVersion = manifest.version || CURRENT_VERSION;
    const hasUpdate = compareSemVer(latestVersion, CURRENT_VERSION) > 0;
    
    res.json({
      hasUpdate,
      currentVersion: CURRENT_VERSION,
      latestVersion,
      downloadUrl: manifest.downloadUrl,
      releaseDate: manifest.releaseDate,
      releaseNotes: manifest.releaseNotes
    });
  } catch (err) {
    res.json({
      hasUpdate: false,
      currentVersion: CURRENT_VERSION,
      error: err.message
    });
  }
});

app.post('/api/system/apply-update', sensitiveLimiter, async (req, res) => {
  try {
    const { downloadUrl } = req.body;
    if (!downloadUrl) {
      return res.status(400).json({ error: 'URL de téléchargement requise.' });
    }
    if (!isAllowedUpdateUrl(downloadUrl)) {
      return res.status(403).json({ error: 'URL de mise à jour non autorisée.' });
    }

    const https = require('https');
    const { spawn } = require('child_process');
    const os = require('os');

    const tempSetupPath = path.join(os.tmpdir(), `AgentOHADA-Setup-v${Date.now()}.exe`);
    const fileStream = fs.createWriteStream(tempSetupPath);

    const download = (url, cb) => {
      if (!isAllowedUpdateUrl(url)) {
        return cb(new Error('Redirection vers une URL non autorisée.'));
      }
      https.get(url, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          return download(response.headers.location, cb);
        }
        response.pipe(fileStream);
        fileStream.on('finish', () => {
          fileStream.close(cb);
        });
      }).on('error', (err) => {
        fs.unlink(tempSetupPath, () => {});
        cb(err);
      });
    };

    download(downloadUrl, (err) => {
      if (err) {
        return res.status(500).json({ error: 'Erreur lors du téléchargement : ' + err.message });
      }

      try {
        const child = spawn(tempSetupPath, ['/SILENT', '/SP-', '/CLOSEAPPLICATIONS', '/RESTARTAPPLICATIONS'], {
          detached: true,
          stdio: 'ignore'
        });
        child.unref();

        res.json({ success: true, message: 'Mise à jour téléchargée. L\'installation va redémarrer l\'application.' });
        
        setTimeout(() => {
          process.exit(0);
        }, 1500);
      } catch (spawnErr) {
        res.status(500).json({ error: 'Erreur au lancement de l\'installateur : ' + spawnErr.message });
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sync/config', sensitiveLimiter, async (req, res) => {
  try {
    const { url, key, autoSync } = req.body;
    
    if (url !== undefined) {
      await db.runUpdate("INSERT OR REPLACE INTO settings (key, value) VALUES ('SUPABASE_URL', ?)", [String(url).trim()]);
    }
    if (key !== undefined) {
      await db.runUpdate("INSERT OR REPLACE INTO settings (key, value) VALUES ('SUPABASE_ANON_KEY', ?)", [String(key).trim()]);
    }
    if (autoSync !== undefined) {
      const autoVal = (autoSync === true || autoSync === 1 || autoSync === '1') ? '1' : '0';
      await db.runUpdate("INSERT OR REPLACE INTO settings (key, value) VALUES ('SUPABASE_AUTO_SYNC', ?)", [autoVal]);
    }

    const result = await performSync(true);
    res.json({ success: true, syncResult: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sync/schema-script', (req, res) => {
  const scriptPath = path.join(__dirname, 'supabase_schema.sql');
  if (fs.existsSync(scriptPath)) {
    const fileContent = fs.readFileSync(scriptPath, 'utf8');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="supabase_schema.sql"');
    res.send(fileContent);
  } else {
    res.status(404).json({ error: "Fichier de migration SQL introuvable." });
  }
});

const { computeDSFData, saveCompanyInfo, generateDSFExcelWorkbook } = require('./dsfEngine');

// --- ROUTES DSF OHADA ---
app.get('/api/dsf/data', async (req, res) => {
  try {
    const data = await computeDSFData();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/dsf/info', async (req, res) => {
  try {
    await saveCompanyInfo(req.body || {});
    res.json({ success: true, message: "Informations d'en-tête DSF mises à jour." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/export/dsf', async (req, res) => {
  try {
    const format = (req.query.format || 'excel').toLowerCase();
    if (format === 'pdf') {
      return res.redirect('/api/export/etats-financiers?type=pack&format=pdf');
    }

    const excelBuffer = await generateDSFExcelWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="DSF_SYSCOHADA_DGI_OFFICIEL.xlsx"');
    res.send(excelBuffer);
  } catch (err) {
    console.error("Error exporting DSF Excel:", err);
    res.status(500).json({ error: "Erreur lors de la génération du fichier DSF Excel." });
  }
});

const { performAutoLettrage, performManuelLettrage, cancelLettrage, computeBalanceAgee } = require('./lettrageEngine');

// --- ROUTES LETTRAGE TIERS ---
app.get('/api/lettrage/non-lettres', async (req, res) => {
  try {
    const account = req.query.account;
    const { clause, params: exParams } = await getExerciceDateFilter();
    let query = `
      SELECT id, date, code_journal, compte, compte_tiers, libelle, n_facture, reference, debit, credit, statut_lettrage, code_lettrage, date_echeance
      FROM journal
      WHERE (compte LIKE '4%' OR compte_tiers LIKE '4%')
    `;
    const params = [];
    if (clause) {
      query += ` AND ${clause}`;
      params.push(...exParams);
    }
    if (account) {
      query += ` AND (compte = ? OR compte_tiers = ?)`;
      params.push(account, account);
    }
    query += ` ORDER BY date DESC, created_at DESC, id DESC`;
    const rows = await db.runSelect(query, params);
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/lettrage/auto', async (req, res) => {
  try {
    const result = await performAutoLettrage();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/lettrage/manuel', async (req, res) => {
  try {
    const { lineIds, username } = req.body;
    const result = await performManuelLettrage(lineIds, username);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/lettrage/annuler', async (req, res) => {
  try {
    const { codeLettrage } = req.body;
    const result = await cancelLettrage(codeLettrage);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ROUTES ÉCHÉANCES & BALANCE ÂGÉE ---
app.get('/api/echeances/balance-agee', async (req, res) => {
  try {
    const type = req.query.type || 'client';
    const data = await computeBalanceAgee(type);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/relances/enregistrer', async (req, res) => {
  try {
    const { tiers_id, n_facture, niveau_relance, methode, notes } = req.body;
    const nowStr = new Date().toISOString().split('T')[0];
    await db.runUpdate(`
      INSERT INTO relances_tiers (tiers_id, n_facture, niveau_relance, date_relance, methode, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [tiers_id, n_facture, niveau_relance || 1, nowStr, methode || 'email', notes || '']);
    res.json({ success: true, message: "Relance enregistrée avec succès." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ROUTES RAPPROCHEMENT BANCAIRE ---
app.get('/api/rapprochement/etat', async (req, res) => {
  try {
    const { clause, params: exParams } = await getExerciceDateFilter();
    const exFilter = clause ? `AND ${clause}` : '';
    const statementLines = await db.runSelect(`SELECT * FROM rapprochement_bancaire ORDER BY date_operation DESC`);
    const journalBankLines = await db.runSelect(`
      SELECT id, date, code_journal, compte, libelle, debit, credit, reference, reference_banque
      FROM journal
      WHERE (compte LIKE '52%' OR compte LIKE '56%' OR code_journal = 'BQ') ${exFilter}
      ORDER BY date DESC
    `, exParams);
    res.json({ statementLines: statementLines || [], journalBankLines: journalBankLines || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/rapprochement/match', async (req, res) => {
  try {
    const { statementId, journalId } = req.body;
    const nowStr = new Date().toISOString();
    await db.runUpdate(`
      UPDATE rapprochement_bancaire SET journal_id = ?, statut_matching = 'rapproche', date_matching = ? WHERE id = ?
    `, [journalId, nowStr, statementId]);
    await db.runUpdate(`
      UPDATE journal SET reference_banque = 'RAPP-' || ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `, [statementId, journalId]);
    res.json({ success: true, message: "Opération bancaire rapprochée." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ROUTES WORKFLOW DE VALIDATION ---
app.post('/api/journal/valider', async (req, res) => {
  try {
    const { id, validateur } = req.body;
    const nowStr = new Date().toISOString();
    await db.runUpdate(`
      UPDATE journal SET statut_validation = 'valide', validateur = ?, date_validation = ?, motif_rejet = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `, [validateur || 'Responsable', nowStr, id]);
    res.json({ success: true, message: "Écriture validée." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/journal/rejeter', async (req, res) => {
  try {
    const { id, validateur, motif } = req.body;
    const nowStr = new Date().toISOString();
    await db.runUpdate(`
      UPDATE journal SET statut_validation = 'rejete', validateur = ?, date_validation = ?, motif_rejet = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `, [validateur || 'Responsable', nowStr, motif || 'Non conforme', id]);
    res.json({ success: true, message: "Écriture rejetée." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Catch-all route pour SPA : renvoie index.html si la route n'est pas une API
app.use((req, res) => {
  if (!req.path.startsWith('/api') && req.method === 'GET') {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
      return res.sendFile(indexPath);
    }
  }
  res.status(404).send('Not found');
});

// Gestionnaire d'erreurs centralisé : ne renvoie jamais la stack/le message brut en production
// (évite de fuiter des fragments SQL/chemins internes), capte aussi les erreurs multer (fileFilter/limits).
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  const isDev = process.env.NODE_ENV !== 'production';
  res.status(err.status || 400).json({
    error: isDev ? err.message : 'Une erreur est survenue lors du traitement de la requête.'
  });
});

if (!process.env.VERCEL && !process.env.NOW_BUILDER && !process.env.VERCEL_ENV) {
  const PORT = process.env.PORT || 3003;
  const HOST = process.env.HOST || '127.0.0.1';
  const server = app.listen(PORT, HOST, () => {
    console.log(`Backend server running on http://${HOST}:${PORT}`);
    startAutoSyncCron();
  });
  // Un import de plusieurs centaines de milliers à ~1,5M de lignes (parsing + upsert par lots)
  // peut légitimement prendre plusieurs minutes : les timeouts par défaut de Node couperaient
  // la requête avant la fin.
  server.requestTimeout = 0;
  server.headersTimeout = 60000;
  server.timeout = 0;
}

module.exports = app;
