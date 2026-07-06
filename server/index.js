const express = require('express');
const cors = require('cors');
const multer = require('multer');
const xlsx = require('xlsx');
const db = require('./db');
const { askAI } = require('./ai');

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
    res.status(500).json({ error: error.message || "Erreur de communication avec l'IA. Vérifiez vos clés API." });
  }
});

// --- IMPORT DATA ROUTE ---
app.post('/api/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier fourni' });
  const type = req.body.type; // 'tiers', 'journal'

  try {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    if (type === 'tiers') {
      const stmt = db.prepare("INSERT INTO tiers (type, nom, compte_comptable, solde, statut) VALUES (?, ?, ?, ?, ?)");
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
        data.forEach(row => {
          const normRow = {};
          for(let key in row) {
             const normKey = key.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
             normRow[normKey] = row[key];
          }
          
          const code_journal = normRow['codejournal'] || '';
          const poste_budgetaire = normRow['postebudgetaire'] || '';
          const date = normRow['date'] || '';
          const compte = String(normRow['compte'] || normRow['comptegeneral'] || normRow['ncompte'] || normRow['numcompte'] || normRow['comptecomptable'] || '');
          const compte_tiers = String(normRow['comptetiers'] || '');
          const libelle = normRow['libelle'] || normRow['libelleecriture'] || normRow['designation'] || normRow['description'] || '';
          const n_facture = String(normRow['nfacture'] || normRow['numfacture'] || '');
          const reference = String(normRow['reference'] || '');
          const debit = parseFloat(normRow['debit']) || parseFloat(normRow['montantdebit']) || 0;
          const credit = parseFloat(normRow['credit']) || parseFloat(normRow['montantcredit']) || 0;
          
          if (compte || debit > 0 || credit > 0) {
            stmt.run(code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference, debit, credit);
            inserted++;
          }
        });
        stmt.finalize();
        db.run("COMMIT", (err) => {
          if (err) {
            console.error("COMMIT ERROR:", err);
            res.status(500).json({ error: 'Erreur lors de la sauvegarde en base.' });
          } else {
            res.json({ success: true, message: `${inserted} écritures importées avec succès.` });
          }
        });
      });
    } else {
      res.status(400).json({ error: 'Type d\'import non supporté' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture du fichier Excel.' });
  }
});

// --- DATA ROUTES (TIERS & JOURNAL) ---
app.get('/api/tiers', (req, res) => {
  db.all(`
    SELECT 
      compte_tiers as id,
      compte_tiers as nom,
      MAX(compte) as compte_comptable,
      (SUM(debit) - SUM(credit)) as solde,
      CASE WHEN substr(MAX(compte), 1, 2) = '41' THEN 'Client' ELSE 'Fournisseur' END as type
    FROM journal
    WHERE compte_tiers IS NOT NULL AND compte_tiers != ''
      AND (compte LIKE '40%' OR compte LIKE '41%')
    GROUP BY compte_tiers
    ORDER BY type ASC, nom ASC
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/journal', (req, res) => {
  db.all("SELECT * FROM journal ORDER BY id DESC", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/journal', (req, res) => {
  const { code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference, debit, credit } = req.body;
  
  if (!code_journal || !date || !compte || !libelle) {
    return res.status(400).json({ error: "Les champs Code Journal, Date, Compte et Libellé sont obligatoires." });
  }

  const query = `
    INSERT INTO journal (code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference, debit, credit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  
  db.run(query, [
    code_journal,
    poste_budgetaire || '',
    date,
    String(compte),
    String(compte_tiers || ''),
    libelle,
    String(n_facture || ''),
    String(reference || ''),
    parseFloat(debit) || 0,
    parseFloat(credit) || 0
  ], function(err) {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true, id: this.lastID });
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

app.get('/api/dashboard/stats', (req, res) => {
  db.serialize(() => {
    let stats = {
      tresorerie: 0,
      dettes: 0,
      factures_fournisseurs: 0,
      creances: 0,
      factures_clients: 0,
      ca: 0,
      charges: 0
    };

    let completed = 0;
    const checkComplete = () => {
      completed++;
      if (completed === 5) {
        res.json(stats);
      }
    };

    // 1. Trésorerie (Compte 52 Banque + 57 Caisse)
    db.get("SELECT (SUM(debit) - SUM(credit)) AS solde FROM journal WHERE compte LIKE '52%' OR compte LIKE '57%'", (err, row) => {
      if (!err && row) stats.tresorerie = row.solde || 0;
      checkComplete();
    });

    // 2. Dettes Fournisseurs (401)
    db.get("SELECT (SUM(credit) - SUM(debit)) AS solde, COUNT(DISTINCT CASE WHEN n_facture != '' AND n_facture IS NOT NULL THEN n_facture END) AS count FROM journal WHERE compte LIKE '401%'", (err, row) => {
      if (!err && row) {
        stats.dettes = Math.max(0, row.solde || 0);
        stats.factures_fournisseurs = row.count || 0;
      }
      checkComplete();
    });

    // 3. Créances Clients (411)
    db.get("SELECT (SUM(debit) - SUM(credit)) AS solde, COUNT(DISTINCT CASE WHEN n_facture != '' AND n_facture IS NOT NULL THEN n_facture END) AS count FROM journal WHERE compte LIKE '411%'", (err, row) => {
      if (!err && row) {
        stats.creances = Math.max(0, row.solde || 0);
        stats.factures_clients = row.count || 0;
      }
      checkComplete();
    });

    // 4. Chiffre d'Affaires (70)
    db.get("SELECT (SUM(credit) - SUM(debit)) AS solde FROM journal WHERE compte LIKE '70%'", (err, row) => {
      if (!err && row) stats.ca = Math.max(0, row.solde || 0);
      checkComplete();
    });

    // 5. Charges (6)
    db.get("SELECT (SUM(debit) - SUM(credit)) AS solde FROM journal WHERE compte LIKE '6%'", (err, row) => {
      if (!err && row) stats.charges = Math.max(0, row.solde || 0);
      checkComplete();
    });
  });
});

// --- FINANCIAL STATEMENTS (ÉTATS FINANCIERS) ---
app.get('/api/balance', (req, res) => {
  db.all(`
    SELECT compte, 
           MAX(libelle) as intitule,
           SUM(debit) as total_debit, 
           SUM(credit) as total_credit,
           (SUM(debit) - SUM(credit)) as solde
    FROM journal
    GROUP BY compte
    ORDER BY compte ASC
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/bilan', (req, res) => {
  db.all(`
    SELECT substr(compte, 1, 1) as classe, 
           SUM(debit) as total_debit, 
           SUM(credit) as total_credit,
           (SUM(debit) - SUM(credit)) as solde
    FROM journal
    WHERE substr(compte, 1, 1) IN ('1', '2', '3', '4', '5')
    GROUP BY classe
    ORDER BY classe ASC
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/resultat', (req, res) => {
  db.all(`
    SELECT substr(compte, 1, 1) as classe, 
           SUM(debit) as total_debit, 
           SUM(credit) as total_credit,
           (SUM(debit) - SUM(credit)) as solde
    FROM journal
    WHERE substr(compte, 1, 1) IN ('6', '7', '8')
    GROUP BY classe
    ORDER BY classe ASC
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

const PORT = 3001;
// --- AUDIT & CORRECTION ---
const { askAuditAI } = require('./ai');

app.get('/api/audit', (req, res) => {
  const anomalies = [];
  db.serialize(() => {
    // 1. Tiers manquants
    db.all("SELECT id, date, compte, libelle, debit, credit FROM journal WHERE (compte LIKE '40%' OR compte LIKE '41%') AND (compte_tiers IS NULL OR compte_tiers = '') LIMIT 20", (err, rows) => {
      if (!err && rows.length > 0) anomalies.push({ type: 'Tiers Manquant', description: 'Écritures sur comptes 40/41 sans compte tiers renseigné', data: rows });
    });

    // 2. Caisse négative
    db.all("SELECT compte, SUM(debit)-SUM(credit) as solde FROM journal WHERE compte LIKE '57%' GROUP BY compte HAVING solde < 0", (err, rows) => {
      if (!err && rows.length > 0) anomalies.push({ type: 'Caisse Négative', description: 'Le solde de la caisse ne peut pas être créditeur', data: rows });
    });

    // 3. Comptes d'attente
    db.all("SELECT compte, SUM(debit)-SUM(credit) as solde FROM journal WHERE compte LIKE '47%' GROUP BY compte HAVING solde != 0", (err, rows) => {
      if (!err && rows.length > 0) anomalies.push({ type: 'Comptes d\'attente (47)', description: 'Ces comptes doivent être soldés avant la clôture', data: rows });
    });

    // 4. Comptes invalides (trop courts ou lettres)
    db.all("SELECT id, date, compte, libelle, debit, credit FROM journal WHERE length(compte) < 2 OR CAST(compte AS INTEGER) = 0 LIMIT 20", (err, rows) => {
      if (!err && rows.length > 0) anomalies.push({ type: 'Compte Invalide', description: 'La structure du compte ne respecte pas le format numérique standard', data: rows });
    });

    // Send response after all queries
    setTimeout(() => res.json(anomalies), 200); // Simple hack instead of complex Promises for simplicity
  });
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

app.post('/api/audit/apply', (req, res) => {
  const { sql } = req.body;
  const sqlUpper = sql ? sql.trim().toUpperCase() : "";
  if (!sqlUpper.startsWith("UPDATE") && !sqlUpper.startsWith("INSERT") && !sqlUpper.startsWith("DELETE")) {
    return res.status(400).json({ error: "Seules les requêtes UPDATE, INSERT et DELETE sont autorisées." });
  }
  db.run(sql, function(err) {
    if (err) res.status(500).json({ error: err.message });
    else res.json({ success: true, changes: this.changes });
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

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
