const express = require('express');
const cors = require('cors');
const multer = require('multer');
const xlsx = require('xlsx');
const db = require('./db');
const { askAI } = require('./ai');

const app = express();
app.use(cors());
app.use(express.json());

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
  const { GEMINI_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY, DEFAULT_AI } = req.body;
  const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
  
  if (GEMINI_API_KEY !== undefined) stmt.run('GEMINI_API_KEY', GEMINI_API_KEY);
  if (OPENAI_API_KEY !== undefined) stmt.run('OPENAI_API_KEY', OPENAI_API_KEY);
  if (DEEPSEEK_API_KEY !== undefined) stmt.run('DEEPSEEK_API_KEY', DEEPSEEK_API_KEY);
  if (DEFAULT_AI !== undefined) stmt.run('DEFAULT_AI', DEFAULT_AI);
  
  stmt.finalize();
  res.json({ success: true });
});

// --- AI CHAT ROUTE ---
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    const aiResponse = await askAI(message);
    res.json({ response: aiResponse });
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
  if (!sql || !sql.toUpperCase().startsWith("UPDATE")) {
    return res.status(400).json({ error: "Seules les requêtes UPDATE sont autorisées pour la correction." });
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
