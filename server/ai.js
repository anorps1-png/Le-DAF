const db = require('./db');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

async function getSettings() {
  return new Promise((resolve) => {
    db.all("SELECT key, value FROM settings", (err, rows) => {
      if (err) rows = [];
      const settings = {};
      (rows || []).forEach(r => { if (r && r.key) settings[r.key] = r.value; });

      // Priorité aux variables d'environnement sur Vercel / Cloud si définies
      settings.DEFAULT_AI = (process.env.DEFAULT_AI || process.env.LLM_PROVIDER || settings.DEFAULT_AI || 'gemini').toLowerCase().trim();
      settings.GEMINI_API_KEY = (process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || settings.GEMINI_API_KEY || '').trim();
      settings.GEMINI_MODEL = (process.env.GEMINI_MODEL || settings.GEMINI_MODEL || 'gemini-1.5-flash').trim();

      settings.OPENAI_API_KEY = (process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY || settings.OPENAI_API_KEY || '').trim();
      settings.OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || settings.OPENAI_BASE_URL || '').trim();
      settings.OPENAI_MODEL = (process.env.OPENAI_MODEL || process.env.LLM_MODEL || settings.OPENAI_MODEL || 'gpt-3.5-turbo').trim();

      settings.DEEPSEEK_API_KEY = (process.env.DEEPSEEK_API_KEY || process.env.VITE_DEEPSEEK_API_KEY || settings.DEEPSEEK_API_KEY || '').trim();
      settings.DEEPSEEK_MODEL = (process.env.DEEPSEEK_MODEL || settings.DEEPSEEK_MODEL || 'deepseek-chat').trim();

      settings.GROQ_API_KEY = (process.env.GROQ_API_KEY || settings.GROQ_API_KEY || '').trim();

      resolve(settings);
    });
  });
}

async function getFinancialContext() {
  return new Promise(async (resolve, reject) => {
    try {
      const settingsRows = await db.runSelect("SELECT value FROM settings WHERE key = 'SELECTED_EXERCICE_ID'");
      const id = settingsRows[0] && settingsRows[0].value;
      let exFilter = "";
      let exParams = [];
      let exercice = null;
      if (id) {
        const exRows = await db.runSelect("SELECT libelle, date_debut, date_fin FROM exercices WHERE id = ?", [id]);
        if (exRows[0]) {
          exFilter = "WHERE date >= ? AND date <= ?";
          exParams = [exRows[0].date_debut, exRows[0].date_fin];
          exercice = exRows[0];
        }
      }

      const tiersQuery = `
        SELECT 
          compte_tiers as nom,
          MAX(compte) as compte,
          (SUM(debit) - SUM(credit)) as solde,
          CASE WHEN substr(MAX(compte), 1, 2) = '41' THEN 'Client' ELSE 'Fournisseur' END as type
        FROM journal
        WHERE compte_tiers IS NOT NULL AND compte_tiers != ''
          AND (compte LIKE '40%' OR compte LIKE '41%')
          ${exFilter ? `AND ${exFilter.replace('WHERE ', '')}` : ''}
        GROUP BY compte_tiers
      `;
      const tiers = await db.runSelect(tiersQuery, exParams);
      const journal = await db.runSelect(`SELECT * FROM journal ${exFilter} ORDER BY date DESC, created_at DESC, id DESC LIMIT 500`, exParams);
      resolve({ tiers, journal, exercice });
    } catch (err) {
      reject(err);
    }
  });
}

// Le Cerveau IA ne doit jamais proposer de modification (INSERT/UPDATE/DELETE) portant sur une
// écriture en dehors de l'exercice actuellement ouvert : le serveur (`/api/audit/apply`) rejette de
// toute façon l'action après coup, mais lui donner la borne exacte évite de lui faire perdre un
// aller-retour à proposer une requête vouée à l'échec, et lui permet d'expliquer la limite à
// l'utilisateur plutôt que de simplement échouer.
function buildExerciceRule(exercice) {
  if (exercice) {
    return `RÈGLE ABSOLUE - EXERCICE OUVERT : l'exercice actuellement ouvert est "${exercice.libelle}" (du ${exercice.date_debut} au ${exercice.date_fin}). Toute requête SQL de modification que tu proposes (INSERT/UPDATE/DELETE sur 'journal') doit porter exclusivement sur des écritures dont la date est comprise dans cet intervalle. Ne propose jamais de créer, modifier ou supprimer une écriture datée en dehors de cet exercice, même si l'utilisateur le demande explicitement : le serveur refusera la requête. Si l'action demandée concerne un autre exercice, explique-le à l'utilisateur au lieu de proposer une requête.`;
  }
  return `RÈGLE ABSOLUE - AUCUN EXERCICE OUVERT : aucun exercice comptable n'est actuellement sélectionné dans l'application. Tu ne peux proposer AUCUNE modification (INSERT/UPDATE/DELETE) tant qu'un exercice n'est pas ouvert : informes-en l'utilisateur au lieu de proposer une requête.`;
}

async function getBusinessMemoryContext() {
  return new Promise((resolve) => {
    db.all("SELECT * FROM business_rules WHERE is_active = 1 ORDER BY confidence_score DESC, occurrences DESC LIMIT 300", (err, rules) => {
      if (err) rules = [];
      db.all("SELECT title, category, content FROM knowledge_docs ORDER BY id DESC", (err, docs) => {
        if (err) docs = [];
        
        let memoryText = "--- MÉMOIRE ET RÈGLES MÉTIER DE L'ENTREPRISE (DAF BRAIN) ---\n";
        
        if (docs.length > 0) {
          memoryText += "DOCUMENTS DE RÉFÉRENCE & PLAN COMPTABLE CHARGÉS EN MÉMOIRE (HÔPITAL / SYSCOHADA) :\n";
          docs.forEach(d => {
            memoryText += `\n=== DOCUMENT : [${d.category}] ${d.title} ===\n${d.content}\n`;
          });
        }
        
        if (rules.length > 0) {
          memoryText += "\nRÈGLES D'IMPUTATION & GESTION ENREGISTRÉES EN MÉMOIRE :\n";
          rules.forEach(r => {
            const src = r.auto_learned ? "Appris via ML" : "Document / Règle Métier";
            memoryText += `- Motif/Mot-clé: "${r.pattern}" ➔ Compte: ${r.target_account || 'N/A'}, Journal: ${r.target_journal || 'N/A'}, TVA: ${r.vat_rate || 0}% (Confiance: ${(r.confidence_score * 100).toFixed(0)}%, Source: ${src}${r.description ? `, ${r.description}` : ''})\n`;
          });
        }
        
        if (docs.length === 0 && rules.length === 0) {
          memoryText += "Aucune règle spécifique enregistrée pour le moment.\n";
        }
        
        resolve(memoryText);
      });
    });
  });
}

function normalizeText(text) {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function determineSyscohadaAccount(libelle, compteTiers = '', isAchat = true) {
  const fullText = normalizeText(`${libelle} ${compteTiers}`);

  // PLAN COMPTABLE HOSPITALIER & SANTE (SYSCOHADA SPÉCIFIQUE HÔPITAUX)
  if (!isAchat) {
    // Recettes & Produits (Classe 7)
    if (fullText.includes('soins') || fullText.includes('consultation') || fullText.includes('hospitalisation') || fullText.includes('acte') || fullText.includes('chirurg') || fullText.includes('nuit')) {
      return { target_account: '706200', target_journal: 'VE', category: 'Recettes Soins & Hospitalisation (706200)' };
    }
    if (fullText.includes('conseil') || fullText.includes('prestation') || fullText.includes('service') || fullText.includes('etude') || fullText.includes('assistance') || fullText.includes('formation') || fullText.includes('expertise') || fullText.includes('maintenance')) {
      return { target_account: '706100', target_journal: 'VE', category: 'Prestations de Services Vendues (706100)' };
    }
    return { target_account: '701100', target_journal: 'VE', category: 'Ventes de Marchandises (701100)' };
  }

  // Achats & Charges Hôpital (Classe 6 SYSCOHADA)
  // 1. Médicaments, Vaccins, Pharmacie, Réactifs, Poches de Sang (603100)
  if (fullText.includes('medicament') || fullText.includes('pharmacie') || fullText.includes('vaccin') || fullText.includes('reactif') || fullText.includes('sang') || fullText.includes('serum') || fullText.includes('sirop') || fullText.includes('comprime')) {
    return { target_account: '603100', target_journal: 'AC', category: 'Achats de Produits Pharmaceutiques & Médicaments (603100)' };
  }

  // 2. Dispositifs Médicaux, Seringues, Compresses, Gants, Bandes, Pansements (603200)
  if (fullText.includes('dispositif medical') || fullText.includes('seringue') || fullText.includes('compresse') || fullText.includes('gant') || fullText.includes('bande') || fullText.includes('pansement') || fullText.includes('catheter') || fullText.includes('aiguille')) {
    return { target_account: '603200', target_journal: 'AC', category: 'Dispositifs & Matériels Médicaux Consommables (603200)' };
  }

  // 3. Oxygène Médical & Gaz Médicaux (603300)
  if (fullText.includes('oxygene') || fullText.includes('gaz medical') || fullText.includes('azote') || fullText.includes('bouteille d\'oxygene') || fullText.includes('bouteilles d\'oxygene') || fullText.includes('oxygene medical')) {
    return { target_account: '603300', target_journal: 'AC', category: 'Oxygène & Gaz Médicaux (603300)' };
  }

  // 4. Linge Médical, Blouses, Draps (605100)
  if (fullText.includes('linge') || fullText.includes('blouse') || fullText.includes('drap') || fullText.includes('uniforme medical')) {
    return { target_account: '605100', target_journal: 'AC', category: 'Linge Médical & Consommables (605100)' };
  }

  // 5. Honoraires Médecins Vacataires, Chirurgiens, Spécialistes (622100)
  if (fullText.includes('vacation') || fullText.includes('medecin') || fullText.includes('chirurgien') || fullText.includes('specialiste') || fullText.includes('docteur')) {
    return { target_account: '622100', target_journal: 'AC', category: 'Honoraires Médecins Vacataires & Spécialistes (622100)' };
  }

  // 6. DASRI, Traitement Déchets Infectieux & Stérilisation (638400)
  if (fullText.includes('dasri') || fullText.includes('infectieux') || fullText.includes('sterilisation') || fullText.includes('dechets medic')) {
    return { target_account: '638400', target_journal: 'AC', category: 'Traitement des Déchets Infectieux DASRI (638400)' };
  }

  // 7. Équipements & Matériel Biomédical Immobilisé (241100)
  if (fullText.includes('echographe') || fullText.includes('radio') || fullText.includes('scanner') || fullText.includes('irm') || fullText.includes('biomedical') || fullText.includes('equipement medical')) {
    return { target_account: '241100', target_journal: 'AC', category: 'Matériel & Équipements Biomédicaux (241100)' };
  }

  // Internet, Téléphonie, Flottes, Télécommunications
  if (fullText.includes('internet') || fullText.includes('fibre') || fullText.includes('telephone') || fullText.includes('flotte') || fullText.includes('lignes') || fullText.includes('abonnement') || fullText.includes('orange') || fullText.includes('mtn') || fullText.includes('moov') || fullText.includes('wave') || fullText.includes('telecom') || fullText.includes('wifi') || fullText.includes('recharge') || fullText.includes('forfait') || fullText.includes('data')) {
    return { target_account: '628100', target_journal: 'AC', category: 'Frais de Télécommunication & Internet (628100)' };
  }

  // 2. Énergie, Carburant, Carburant Véhicules, Électricité, Eau
  if (fullText.includes('carburant') || fullText.includes('essence') || fullText.includes('gazole') || fullText.includes('diesel') || fullText.includes('station') || fullText.includes('total') || fullText.includes('shell') || fullText.includes('cie') || fullText.includes('sodeci') || fullText.includes('electricite') || fullText.includes('eau') || fullText.includes('gaz') || fullText.includes('pass') || fullText.includes('cartes pass')) {
    return { target_account: '605200', target_journal: 'AC', category: 'Achats d\'Énergie & Carburants (605200)' };
  }

  // 3. Loyers, Baux, Charges Locatives
  if (fullText.includes('loyer') || fullText.includes('bail') || fullText.includes('location') || fullText.includes('palmiers') || fullText.includes('sci') || fullText.includes('batiment') || fullText.includes('bureau') || fullText.includes('locaux') || fullText.includes('immobilier')) {
    return { target_account: '632100', target_journal: 'AC', category: 'Loyers & Charges Locatives (632100)' };
  }

  // 4. Honoraires, Conseils, Audits, Assistance Juridique/Comptable
  if (fullText.includes('honoraire') || fullText.includes('conseil') || fullText.includes('audit') || fullText.includes('assistance') || fullText.includes('avocat') || fullText.includes('notaire') || fullText.includes('expert') || fullText.includes('cabinet') || fullText.includes('juridique') || fullText.includes('comptable') || fullText.includes('prestataire')) {
    return { target_account: '622100', target_journal: 'AC', category: 'Honoraires & Prestations d\'Études (622100)' };
  }

  // 5. Entretien, Réparations, Maintenance, Nettoyage, Gardiennage
  if (fullText.includes('entretien') || fullText.includes('reparation') || fullText.includes('maintenance') || fullText.includes('vidange') || fullText.includes('nettoyage') || fullText.includes('garage') || fullText.includes('pieces') || fullText.includes('gardiennage') || fullText.includes('securite')) {
    return { target_account: '638100', target_journal: 'AC', category: 'Entretien & Réparations (638100)' };
  }

  // 6. Déplacements, Missions, Voyage, Transport
  if (fullText.includes('deplacement') || fullText.includes('mission') || fullText.includes('voyage') || fullText.includes('hotel') || fullText.includes('billet') || fullText.includes('vol') || fullText.includes('taxi') || fullText.includes('transport') || fullText.includes('frais de port') || fullText.includes('livraison')) {
    return { target_account: '625100', target_journal: 'AC', category: 'Voyages & Déplacements (625100)' };
  }

  // 7. Assurance, Primes
  if (fullText.includes('assurance') || fullText.includes('prime') || fullText.includes('nsia') || fullText.includes('sanlam') || fullText.includes('allianz') || fullText.includes('saham') || fullText.includes('couverture')) {
    return { target_account: '631100', target_journal: 'AC', category: 'Primes d\'Assurances (631100)' };
  }

  // 8. Frais bancaires & commissions
  if (fullText.includes('frais banc') || fullText.includes('commission') || fullText.includes('tenue de compte') || fullText.includes('agios') || fullText.includes('virement')) {
    return { target_account: '627100', target_journal: 'BQ', category: 'Frais Bancaires & Commissions (627100)' };
  }

  // 9. Fournitures de bureau & petits matériels
  if (fullText.includes('fourniture') || fullText.includes('bureau') || fullText.includes('papeterie') || fullText.includes('ramme') || fullText.includes('cartouche') || fullText.includes('encre') || fullText.includes('toner') || fullText.includes('consommables') || fullText.includes('imprime')) {
    return { target_account: '605100', target_journal: 'AC', category: 'Fournitures de Bureau & Matériels (605100)' };
  }

  // 10. Publicité & Marketing
  if (fullText.includes('publicite') || fullText.includes('marketing') || fullText.includes('communication') || fullText.includes('spot') || fullText.includes('flyer') || fullText.includes('banniere') || fullText.includes('sponsoring') || fullText.includes('evenement')) {
    return { target_account: '623100', target_journal: 'AC', category: 'Publicité & Marketing (623100)' };
  }

  // 11. Matières premières & Intrants
  if (fullText.includes('matiere premiere') || fullText.includes('intrant') || fullText.includes('emballage') || fullText.includes('conditionnement')) {
    return { target_account: '602100', target_journal: 'AC', category: 'Achats de Matières Premières (602100)' };
  }

  // 12. Prestations de service générales / Sous-traitance
  if (fullText.includes('sous-traitance') || fullText.includes('soustraitance') || fullText.includes('travaux')) {
    return { target_account: '604100', target_journal: 'AC', category: 'Achats d\'Études & Prestations (604100)' };
  }

  return { target_account: '601100', target_journal: 'AC', category: 'Achats de Marchandises (601100)' };
}

async function matchTransactionWithMemory(libelle, compteTiers = '', isAchat = true) {
  return new Promise((resolve) => {
    db.all("SELECT * FROM business_rules WHERE is_active = 1 ORDER BY confidence_score DESC, occurrences DESC", (err, rules) => {
      const normLib = normalizeText(libelle);
      const normTiers = normalizeText(compteTiers);
      const fullSearch = `${normLib} ${normTiers}`;

      if (!err && rules && rules.length > 0) {
        for (const rule of rules) {
          const normPattern = normalizeText(rule.pattern);
          if (!normPattern) continue;

          let isMatch = false;
          if (rule.condition_type === 'exact') {
            isMatch = normLib === normPattern || normTiers === normPattern;
          } else if (rule.condition_type === 'starts_with') {
            isMatch = normLib.startsWith(normPattern) || normTiers.startsWith(normPattern);
          } else {
            // Default: 'contains'
            isMatch = fullSearch.includes(normPattern);
          }

          // Une règle ne doit jamais pointer vers un compte de tiers/trésorerie/capitaux : le
          // "target_account" représente la nature de la charge/produit (classes 2,3,6,7,8), jamais
          // sa contrepartie comptable. Filet de sécurité si une règle corrompue subsiste malgré
          // tout en base (ex: créée manuellement par erreur).
          const targetClasse = String(rule.target_account || '').charAt(0);
          if (['1', '4', '5', '9'].includes(targetClasse)) continue;

          if (isMatch) {
            const autoApply = (rule.confidence_score >= 0.80);
            return resolve({
              matched: true,
              rule,
              auto_apply: autoApply,
              target_account: rule.target_account,
              target_journal: rule.target_journal,
              vat_rate: rule.vat_rate || 0,
              confidence_score: rule.confidence_score,
              source: rule.auto_learned ? 'Machine Learning' : 'Règle Métier'
            });
          }
        }
      }

      // Si aucune règle spécifique dans la mémoire, appliquer la classification par nature d'opération SYSCOHADA
      const syscohadaClassif = determineSyscohadaAccount(libelle, compteTiers, isAchat);
      resolve({
        matched: true,
        auto_apply: true,
        target_account: syscohadaClassif.target_account,
        target_journal: syscohadaClassif.target_journal,
        vat_rate: 19.25,
        confidence_score: 0.90,
        source: `Classification Nature SYSCOHADA (${syscohadaClassif.category})`
      });
    });
  });
}

async function learnFromJournalData(entries, minOccurrencesForNewRule = 1) {
  if (!Array.isArray(entries) || entries.length === 0) return 0;
  
  const stopWords = new Set(['fact', 'facture', 'n°', 'no', 'du', 'au', 'de', 'la', 'le', 'les', 'des', 'pour', 'par', 'virement', 'cheque', 'reglement', 'paiment', 'achat', 'vente', 'duplicata']);
  const patternCounts = {};

  entries.forEach(entry => {
    const compte = String(entry.compte || entry.compte_comptable || '').trim();
    const libelle = String(entry.libelle || entry.designation || '').trim();
    const tiers = String(entry.compte_tiers || '').trim();
    const codeJournal = String(entry.code_journal || entry.journal || '').trim();

    if (!compte || (!libelle && !tiers)) return;

    // Ne jamais apprendre un compte de tiers/trésorerie/capitaux (classes 1,4,5,9) comme "nature"
    // de charge/produit : une écriture manuelle ou un journal brut contient toujours la ligne de
    // contrepartie (401 Fournisseurs, 411 Clients, 52/57 Trésorerie...) à côté de la ligne de
    // charge/produit réelle, et les deux partagent souvent le même libellé. Sans ce filtre, le
    // moteur apprenait à imputer des factures directement sur le compte Fournisseurs (ex: "ETS",
    // "sur" appris 355 fois vers 40100000 au lieu du compte de charge classe 6 attendu).
    const classe = compte.charAt(0);
    if (['1', '4', '5', '9'].includes(classe)) return;

    // Extraire les mots clés principaux (longueur >= 3)
    const tokens = `${libelle} ${tiers}`.split(/[\s,.;:\/\-\_\'\"]+/);
    tokens.forEach(rawToken => {
      const token = normalizeText(rawToken);
      if (token.length >= 3 && !stopWords.has(token) && !/^\d+$/.test(token)) {
        const key = `${token}|||${compte}|||${codeJournal}`;
        patternCounts[key] = (patternCounts[key] || 0) + 1;
      }
    });
  });

  // Résout chaque motif (classification SYSCOHADA sur 601100 comprise) avant toute requête SQL :
  // sur un gros import (des dizaines/centaines de milliers de motifs uniques), interroger et
  // écrire un par un est le vrai goulot d'étranglement (chaque round-trip + transaction implicite
  // a un coût fixe non négligeable). On regroupe donc la vérification d'existence en quelques
  // requêtes IN(...), puis toutes les écritures dans UNE seule transaction.
  const resolved = [];
  for (const key in patternCounts) {
    const count = patternCounts[key];
    let [pattern, compte, codeJournal] = key.split('|||');

    if (compte === '601100') {
      const sysClassif = determineSyscohadaAccount(pattern, '', true);
      if (sysClassif.target_account !== '601100') {
        compte = sysClassif.target_account;
        if (sysClassif.target_journal) codeJournal = sysClassif.target_journal;
      }
    }

    resolved.push({ pattern, compte, codeJournal, count, confidence: Math.min(0.98, 0.70 + (count * 0.05)) });
  }

  const existingByPattern = new Map();
  const distinctPatterns = [...new Set(resolved.map(r => r.pattern))];
  const LOOKUP_CHUNK = 500;
  for (let i = 0; i < distinctPatterns.length; i += LOOKUP_CHUNK) {
    const chunk = distinctPatterns.slice(i, i + LOOKUP_CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = await new Promise((res) => {
      db.all(`SELECT id, pattern, occurrences, confidence_score FROM business_rules WHERE pattern IN (${placeholders})`, chunk, (err, rows) => res(err ? [] : rows));
    });
    // Comme dans l'implémentation d'origine, l'appariement se fait sur le pattern seul (pas
    // compte+journal) : conserver ce comportement exact pour ne pas changer la logique métier.
    rows.forEach(r => { if (!existingByPattern.has(r.pattern)) existingByPattern.set(r.pattern, r); });
  }

  let learnedCount = 0;
  const toUpdate = [];
  const toInsert = [];
  for (const r of resolved) {
    const existing = existingByPattern.get(r.pattern);
    if (existing) {
      const newOcc = existing.occurrences + r.count;
      const newConf = Math.min(0.98, Math.max(existing.confidence_score, 0.75 + (newOcc * 0.04)));
      toUpdate.push([newOcc, newConf, r.compte, r.codeJournal || null, existing.id]);
    } else if (r.count >= minOccurrencesForNewRule) {
      // En dessous du seuil, un mot inédit n'est pas encore assez fiable pour devenir une règle
      // permanente (cf. l'explosion à 13k+ règles à occurrence unique observée sur des imports en
      // masse non supervisés) : on attend qu'il se répète avant de le mémoriser.
      toInsert.push([r.pattern, r.compte, r.codeJournal || null, r.confidence, r.count, `Appris automatiquement depuis journal Excel (${r.count} écriture(s))`]);
      learnedCount++;
    }
  }

  if (toUpdate.length > 0 || toInsert.length > 0) {
    await new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        if (toUpdate.length > 0) {
          const updStmt = db.prepare("UPDATE business_rules SET occurrences = ?, confidence_score = ?, target_account = ?, target_journal = COALESCE(?, target_journal) WHERE id = ?");
          toUpdate.forEach(params => updStmt.run(params));
          updStmt.finalize();
        }
        if (toInsert.length > 0) {
          const insStmt = db.prepare("INSERT INTO business_rules (pattern, condition_type, target_account, target_journal, confidence_score, auto_learned, occurrences, description) VALUES (?, 'contains', ?, ?, ?, 1, ?, ?)");
          toInsert.forEach(params => insStmt.run(params));
          insStmt.finalize();
        }
        db.run("COMMIT", (err) => err ? reject(err) : resolve());
      });
    });
  }

  return learnedCount;
}

// Certains modèles (surtout via des proxys tiers qui n'implémentent pas correctement le
// function-calling OpenAI, cf. OPENAI_BASE_URL personnalisée) ne renvoient jamais de vrais
// `tool_calls` : ils répondent en texte brut, parfois SANS les balises ```proposal/```json
// attendues, et il arrive qu'ils répètent le même bloc JSON plusieurs fois dans une seule
// réponse (dégénérescence connue de certains LLM). Sans nettoyage robuste, l'utilisateur voit du
// JSON brut dupliqué au lieu d'une explication claire + d'un bouton d'approbation. On détecte donc
// aussi bien les blocs balisés que les objets JSON nus contenant "sql", et on retire TOUTES les
// occurrences trouvées du texte affiché (pas seulement la première), en ne gardant que la
// première comme proposition réelle.
function extractProposalFromText(rawText) {
  if (!rawText || typeof rawText !== 'string') return { text: rawText, proposal: null };

  const blockRegex = /```(?:proposal|json)?\s*(\{[\s\S]*?"sql"\s*:\s*[\s\S]*?\})\s*```|(\{(?:[^{}]|\{[^{}]*\})*"sql"\s*:\s*"(?:[^"\\]|\\.)*"(?:[^{}]|\{[^{}]*\})*\})/gi;

  let proposal = null;
  const snippets = [];
  let match;
  while ((match = blockRegex.exec(rawText)) !== null) {
    const jsonStr = match[1] || match[2];
    if (!jsonStr) continue;
    snippets.push(match[0]);
    if (!proposal) {
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed && parsed.sql) {
          let cleanSql = String(parsed.sql).trim();
          cleanSql = cleanSql.replace(/^```(?:sql)?\s*/i, '').replace(/\s*```$/i, '').trim();
          cleanSql = cleanSql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^--.*$/gm, '').trim();
          cleanSql = cleanSql.replace(/;\s*$/, '').trim();
          proposal = {
            sql: cleanSql,
            reason: parsed.reason || "Action comptable / financière proposée par l'IA"
          };
        }
      } catch (e) {
        // Bloc non parsable (JSON invalide/tronqué) : ignoré, on continue de chercher.
      }
    }
  }

  if (proposal) {
    let cleanText = rawText;
    snippets.forEach(snippet => { cleanText = cleanText.split(snippet).join(''); });
    cleanText = cleanText.trim();
    return {
      text: cleanText || "J'ai formulé la proposition suivante pour validation et exécution :",
      proposal
    };
  }

  return { text: rawText, proposal: null };
}

// Certains déploiements/modèles DeepSeek ne remplissent pas le champ structuré `tool_calls` de
// l'API OpenAI-compatible : ils renvoient leur propre balisage interne ("DSML", tokens spéciaux
// <｜...｜>) tel quel dans `content`. Sans traitement, ce texte brut s'affichait illisible dans le
// chat au lieu d'être exécuté (bug remonté par l'utilisateur). On le convertit ici vers la même
// structure `tool_calls` que l'API standard, pour qu'il soit exécuté exactement comme un appel
// d'outil natif au lieu d'être simplement affiché ou masqué.
function extractDsmlToolCalls(text) {
  if (!text || !/DSML/.test(text)) return null;
  const invokeRegex = /<｜｜DSML｜｜invoke name="([^"]+)">([\s\S]*?)<\/｜｜DSML｜｜invoke>/g;
  const paramRegex = /<｜｜DSML｜｜parameter name="([^"]+)"[^>]*>([\s\S]*?)<\/｜｜DSML｜｜parameter>/g;
  const calls = [];
  let cleanedText = text;
  let m;
  while ((m = invokeRegex.exec(text)) !== null) {
    const toolName = m[1];
    const body = m[2];
    const args = {};
    let pm;
    paramRegex.lastIndex = 0;
    while ((pm = paramRegex.exec(body)) !== null) {
      args[pm[1]] = pm[2].trim();
    }
    calls.push({ id: `dsml-${calls.length}`, type: 'function', function: { name: toolName, arguments: JSON.stringify(args) } });
    cleanedText = cleanedText.split(m[0]).join('');
  }
  if (calls.length === 0) return null;
  cleanedText = cleanedText.replace(/<\/?｜｜DSML｜｜tool_calls>/g, '').trim();
  return { calls, cleanedText };
}

async function askAI(prompt, history = []) {
  const settings = await getSettings();
  const memoryContext = await getBusinessMemoryContext();
  
  if (settings.DEFAULT_AI === 'gemini' && settings.GEMINI_API_KEY) {
    const context = await getFinancialContext();
    const systemPrompt = `Tu es le DAF Principal et Expert-Comptable OHADA / SYSCOHADA de l'entreprise.
Tu as TOUS LES POUVOIRS d'analyse, d'audit, de pilotage financier, de saisie et de correction sur l'ensemble de la comptabilité.

Structure de nos livres et données comptables :
- Tiers (Clients/Fournisseurs) : ${JSON.stringify(context.tiers)}
- Journal d'écritures : ${JSON.stringify(context.journal.slice(-100))}
- Tables accessibles : 'journal', 'tiers', 'chart_of_accounts', 'business_rules', 'fiscal_echeances', 'exercices', 'statement_lines'.

${memoryContext}

${buildExerciceRule(context.exercice)}

Consignes & Règle d'or de sécurité :
1. Tu as le pouvoir de concevoir toute action comptable : passer des écritures complètes en partie double (Débit/Crédit), corriger des comptes, lettrer des factures, créer des tiers, ajuster la trésorerie.
2. TOUTE MODIFICATION ou INSERTION dans la base de données nécessite l'autorisation de l'utilisateur. Pour toute action de modification, inclus impérativement à la toute fin de ta réponse un bloc de proposition au format JSON suivant :
\`\`\`proposal
{
  "sql": "Requête SQL (ou plusieurs requêtes séparées par ; pour une écriture en partie double)",
  "reason": "Explication claire et concise du motif comptable"
}
\`\`\`
3. Fournis une réponse chirurgicale et professionnelle avec des tableaux Markdown pour la présentation des chiffres.`;
    
    let historyText = "";
    if (history && history.length > 0) {
      historyText = history.slice(-8).map(m => `${m.role === 'user' ? 'Utilisateur' : 'DAF IA'}: ${m.content}`).join('\n') + '\n\n';
    }

    const geminiModel = settings.GEMINI_MODEL || "gemini-1.5-flash";
    const genAI = new GoogleGenerativeAI(settings.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: geminiModel });
    const result = await model.generateContent(`${systemPrompt}\n\nHistorique :\n${historyText}Question de l'utilisateur : ${prompt}`);
    const rawResultText = result.response.text();
    return extractProposalFromText(rawResultText);
  } else if (settings.OPENAI_API_KEY || settings.DEEPSEEK_API_KEY || settings.GROQ_API_KEY) {
    const isDeepSeek = settings.DEFAULT_AI === 'deepseek';
    const isGroq = settings.DEFAULT_AI === 'groq';

    let apiKey = settings.OPENAI_API_KEY;
    let baseURL = settings.OPENAI_BASE_URL && settings.OPENAI_BASE_URL.trim() ? settings.OPENAI_BASE_URL.trim() : undefined;
    let selectedModel = settings.OPENAI_MODEL && settings.OPENAI_MODEL.trim() ? settings.OPENAI_MODEL.trim() : "gpt-3.5-turbo";

    if (isDeepSeek) {
      apiKey = settings.DEEPSEEK_API_KEY || apiKey;
      baseURL = 'https://api.deepseek.com';
      selectedModel = settings.DEEPSEEK_MODEL || 'deepseek-chat';
    } else if (isGroq) {
      apiKey = settings.GROQ_API_KEY || apiKey;
      baseURL = 'https://api.groq.com/openai/v1';
      selectedModel = settings.OPENAI_MODEL || 'llama-3.3-70b-versatile';
    }

    const openai = new OpenAI({ apiKey, baseURL });

    const activeExSettingRows = await db.runSelect("SELECT value FROM settings WHERE key = 'SELECTED_EXERCICE_ID'");
    const activeExId = activeExSettingRows[0] && activeExSettingRows[0].value;
    const activeExRows = activeExId
      ? await db.runSelect("SELECT libelle, date_debut, date_fin FROM exercices WHERE id = ?", [activeExId])
      : [];
    const activeExercice = activeExRows[0] || null;

    const systemPrompt = `Tu es le DAF Principal et Expert-Comptable OHADA / SYSCOHADA de l'entreprise.
Tu as TOUS LES POUVOIRS d'analyse, d'audit, de pilotage financier, de saisie et de correction sur l'ensemble de la base comptable.

Structure complète de la base de données :
1. Table 'journal' : id, code_journal (AC, VE, BQ, CA, OD), poste_budgetaire, date (YYYY-MM-DD), compte, compte_tiers, libelle, n_facture, reference, debit, credit, statut_validation.
2. Table 'tiers' : id, type ('Client' ou 'Fournisseur'), nom, compte_comptable (ex: 411100, 401100), solde, statut.
3. Table 'chart_of_accounts' : compte (ex: 601100), libelle, source_doc_id.
4. Table 'business_rules' : id, pattern, condition_type, target_account, target_journal, vat_rate, confidence_score, auto_learned, description, is_active.
5. Table 'fiscal_echeances' : id, libelle, date_limite, type_impot, statut, montant_estime.
6. Table 'exercices' : id, libelle, date_debut, date_fin.
7. Table 'rapprochement_bancaire' : id, date_operation, libelle, debit, credit, journal_id (référence journal.id une fois rapprochée), statut_matching, date_matching.

${memoryContext}

${buildExerciceRule(activeExercice)}

Instructions :
- Règle N°1 : Rédige dès le premier coup des requêtes SQL ciblées et agrégées (SUM, COUNT, GROUP BY, WHERE précis) pour limiter les étapes et économiser les tokens.
- Règle N°2 : Tu as le pouvoir de proposer TOUTE modification, saisie en partie double, lettrage, rééquilibrage ou correction via l'outil 'propose_update'. L'utilisateur devra obligatoirement l'approuver avant son exécution en base.
- Règle N°3 : Pour les écritures en partie double (Débit + Crédit), inclus plusieurs requêtes INSERT séparées par des points-virgules dans 'sql'.
- Règle N°4 : Réponds de manière concise, rigoureuse et professionnelle avec des tableaux Markdown.
- Règle N°5 : L'outil 'propose_update' ne doit JAMAIS être utilisé pour une écriture datée en dehors de l'exercice ouvert précisé ci-dessus (le serveur la refuserait de toute façon) — dans ce cas, explique la limite à l'utilisateur au lieu d'appeler l'outil.`;

    const tools = [
      {
        type: "function",
        function: {
          name: "query_database",
          description: "Exécute une requête SQL SELECT sur la base de données pour lire les écritures comptables (journal), les tiers, le plan comptable, les règles ou les états financiers.",
          parameters: {
            type: "object",
            properties: {
              sql: { type: "string", description: "La requête SQL SELECT. Ex: SELECT * FROM journal WHERE compte LIKE '6%'" }
            },
            required: ["sql"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "propose_update",
          description: "Propose une requête SQL (UPDATE, INSERT, DELETE) ou un ensemble de requêtes séparées par ';' pour passer une écriture en partie double, modifier ou corriger des données. L'utilisateur devra l'approuver avant son application.",
          parameters: {
            type: "object",
            properties: {
              sql: { type: "string", description: "La ou les requêtes SQL (ex: INSERT INTO journal ...; INSERT INTO journal ...; ou UPDATE journal ... WHERE id = ...;)" },
              reason: { type: "string", description: "L'explication métier claire de cette opération comptable pour validation humaine." }
            },
            required: ["sql", "reason"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "generate_excel",
          description: "Génère un fichier Excel (.xlsx) à partir d'une requête SQL SELECT et retourne un lien de téléchargement.",
          parameters: {
            type: "object",
            properties: {
              sql: { type: "string", description: "Requête SQL SELECT pour extraire les données. Ex: SELECT * FROM journal WHERE date LIKE '2026-05%'" },
              filename: { type: "string", description: "Le nom souhaité pour le fichier Excel. Ex: export_mai.xlsx" }
            },
            required: ["sql", "filename"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "generate_pdf",
          description: "Génère un rapport financier au format PDF contenant un tableau à partir d'une requête SQL SELECT et retourne un lien de téléchargement.",
          parameters: {
            type: "object",
            properties: {
              sql: { type: "string", description: "Requête SQL SELECT pour extraire les données. Ex: SELECT compte, libelle, debit, credit FROM journal LIMIT 50" },
              title: { type: "string", description: "Le titre à afficher sur le rapport PDF. Ex: Balance Comptable - Mai 2026" },
              filename: { type: "string", description: "Le nom souhaité pour le fichier PDF. Ex: balance_mai.pdf" }
            },
            required: ["sql", "title", "filename"]
          }
        }
      }
    ];

    let messages = [
      { role: "system", content: systemPrompt }
    ];

    if (history && history.length > 0) {
      const recentHistory = history.slice(-6);
      recentHistory.forEach(msg => {
        if (msg.role === 'user' || msg.role === 'assistant') {
          messages.push({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: msg.content
          });
        }
      });
    }

    if (messages[messages.length - 1]?.content !== prompt) {
      messages.push({ role: "user", content: prompt });
    }

    let finalResponse = null;
    let iteration = 0;
    const maxIterations = 6; // Valeur initiale économe en tokens

    while (iteration < maxIterations && !finalResponse) {
      iteration++;
      const isLastIteration = iteration >= maxIterations - 1;
      const completion = await openai.chat.completions.create({
        messages: messages,
        model: selectedModel,
        tools: isLastIteration ? undefined : tools,
        tool_choice: isLastIteration ? undefined : "auto",
      });

      if (!completion || !completion.choices || !completion.choices[0]) {
        throw new Error("L'API d'IA n'a retourné aucune réponse valide (Vérifiez la clé API, le quota ou l'URL du service dans les paramètres).");
      }

      const responseMessage = completion.choices[0].message;

      if ((!responseMessage.tool_calls || responseMessage.tool_calls.length === 0) && responseMessage.content) {
        const dsml = extractDsmlToolCalls(responseMessage.content);
        if (dsml) {
          responseMessage.tool_calls = dsml.calls;
          responseMessage.content = dsml.cleanedText;
        }
      }

      messages.push(responseMessage);

      if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        for (const toolCall of responseMessage.tool_calls) {
          if (toolCall.function.name === "query_database") {
            try {
              const args = JSON.parse(toolCall.function.arguments);

              // 'settings' contient les clés API en clair (Gemini/OpenAI/DeepSeek/Supabase) :
              // le SQL exécuté ici peut être influencé par du contenu non fiable (documents
              // importés, libellés du journal repris dans le contexte), donc jamais lisible
              // via cet outil, même en lecture seule.
              let rows;
              if (/\b(settings|sqlite_master|sqlite_sequence)\b/i.test(args.sql)) {
                rows = [];
                messages.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  name: toolCall.function.name,
                  content: JSON.stringify({ error: "Accès refusé : cette table n'est pas accessible via query_database." })
                });
                continue;
              }
              rows = await db.runSelect(args.sql);

              let toolResponse;
              if (rows.length > 25) {
                const truncated = rows.slice(0, 25);
                toolResponse = {
                  warning: `Résultat tronqué aux 25 premières lignes sur ${rows.length} pour préserver les tokens. Utilisez des agrégations (SUM, COUNT, GROUP BY) ou une clause WHERE plus ciblée si nécessaire.`,
                  data: truncated
                };
              } else {
                toolResponse = rows;
              }

              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                name: toolCall.function.name,
                content: JSON.stringify(toolResponse)
              });
            } catch (err) {
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                name: toolCall.function.name,
                content: JSON.stringify({ error: err.message })
              });
            }
          } else if (toolCall.function.name === "propose_update") {
            try {
              const args = JSON.parse(toolCall.function.arguments);
              let cleanSql = (args.sql || "").trim();
              cleanSql = cleanSql.replace(/^```(?:sql)?\s*/i, '').replace(/\s*```$/i, '').trim();
              cleanSql = cleanSql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^--.*$/gm, '').trim();
              cleanSql = cleanSql.replace(/;\s*$/, '').trim();
              
              finalResponse = {
                text: args.reason || "Je propose d'exécuter la correction suivante sur votre base de données :",
                proposal: {
                  sql: cleanSql,
                  reason: args.reason || "Mise à jour comptable conforme OHADA."
                }
              };
            } catch (err) {
              finalResponse = { text: "Erreur lors de la proposition de mise à jour.", proposal: null };
            }
          } else if (toolCall.function.name === "generate_excel") {
            try {
              const args = JSON.parse(toolCall.function.arguments);
              const rows = await db.runSelect(args.sql);
              
              const filename = args.filename || `export_${Date.now()}.xlsx`;
              const exportPath = path.join(__dirname, 'public', 'exports');
              if (!fs.existsSync(exportPath)) {
                fs.mkdirSync(exportPath, { recursive: true });
              }
              
              const fullPath = path.join(exportPath, filename);
              const xlsx = require('xlsx');
              const ws = xlsx.utils.json_to_sheet(rows);
              const wb = xlsx.utils.book_new();
              xlsx.utils.book_append_sheet(wb, ws, "Données");
              xlsx.writeFile(wb, fullPath);
              
              const downloadUrl = `http://localhost:3001/public/exports/${filename}`;
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                name: toolCall.function.name,
                content: JSON.stringify({ success: true, downloadUrl })
              });
            } catch (err) {
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                name: toolCall.function.name,
                content: JSON.stringify({ error: err.message })
              });
            }
          } else if (toolCall.function.name === "generate_pdf") {
            try {
              const args = JSON.parse(toolCall.function.arguments);
              const rows = await db.runSelect(args.sql);
              
              const filename = args.filename || `rapport_${Date.now()}.pdf`;
              const exportPath = path.join(__dirname, 'public', 'exports');
              if (!fs.existsSync(exportPath)) {
                fs.mkdirSync(exportPath, { recursive: true });
              }
              
              const fullPath = path.join(exportPath, filename);
              const PDFDocument = require('pdfkit');
              const doc = new PDFDocument({ margin: 30, size: 'A4' });
              const stream = fs.createWriteStream(fullPath);
              doc.pipe(stream);
              
              doc.fontSize(16).text(args.title || "Rapport Financier", { align: 'center' });
              doc.moveDown();
              
              if (rows.length > 0) {
                const headers = Object.keys(rows[0]);
                let y = doc.y;
                doc.fontSize(10).font('Helvetica-Bold');
                headers.forEach((h, i) => {
                  doc.text(h, 30 + i * 80, y);
                });
                doc.moveDown();
                doc.font('Helvetica');
                
                rows.slice(0, 30).forEach(r => {
                  y = doc.y;
                  headers.forEach((h, i) => {
                    doc.text(String(r[h] || ''), 30 + i * 80, y);
                  });
                  doc.moveDown(0.5);
                });
              } else {
                doc.text("Aucune donnée trouvée.");
              }
              
              doc.end();
              
              await new Promise((resolve) => stream.on('finish', resolve));
              
              const downloadUrl = `http://localhost:3001/public/exports/${filename}`;
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                name: toolCall.function.name,
                content: JSON.stringify({ success: true, downloadUrl })
              });
            } catch (err) {
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                name: toolCall.function.name,
                content: JSON.stringify({ error: err.message })
              });
            }
          }
        }
      } else {
        finalResponse = extractProposalFromText(responseMessage.content);
      }
    }
    
    // Récupérer le dernier message de l'assistant si disponible
    if (!finalResponse) {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant' && messages[i].content) {
          finalResponse = extractProposalFromText(messages[i].content);
          break;
        }
      }
    }

    return { 
      text: typeof finalResponse === 'string' ? finalResponse : (finalResponse?.text || "Analyse terminée avec succès."), 
      proposal: finalResponse?.proposal || null 
    };
  } else {
    return { text: "Veuillez configurer vos clés API dans les paramètres pour activer l'IA.", proposal: null };
  }
}

async function askAuditAI(anomalyContext) {
  const settings = await getSettings();

  const auditExSettingRows = await db.runSelect("SELECT value FROM settings WHERE key = 'SELECTED_EXERCICE_ID'");
  const auditExId = auditExSettingRows[0] && auditExSettingRows[0].value;
  const auditExRows = auditExId
    ? await db.runSelect("SELECT libelle, date_debut, date_fin FROM exercices WHERE id = ?", [auditExId])
    : [];
  const auditActiveExercice = auditExRows[0] || null;

  const systemPrompt = `Tu es le DAF et Expert Comptable OHADA de l'entreprise.
Tu agis en tant qu'Auditeur. Voici une anomalie détectée dans notre journal comptable :
${JSON.stringify(anomalyContext)}

Ta mission :
1. Analyser brièvement le problème et donner la règle OHADA applicable.
2. Proposer une requête SQL de type "UPDATE" pour corriger le problème dans la table SQLite "journal".
IMPORTANT: La table journal a les colonnes suivantes : id, code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference, debit, credit.

${buildExerciceRule(auditActiveExercice)}
Si l'écriture concernée par l'anomalie est datée en dehors de cet exercice, ne propose aucun SQL : indique-le dans "analyse" à la place.

Tu DOIS impérativement répondre UNIQUEMENT avec un objet JSON valide ayant la structure suivante, et rien d'autre (pas de markdown \`\`\`json) :
{
  "analyse": "Ton analyse et conseil...",
  "sql": "UPDATE journal SET compte = 'nouveau_compte' WHERE id = 123;"
}`;

  const prompt = "Analyse cette anomalie et donne la correction JSON.";

  try {
    let resultText = "";
    if (settings.DEFAULT_AI === 'gemini' && settings.GEMINI_API_KEY) {
      const geminiModel = settings.GEMINI_MODEL || "gemini-1.5-flash";
      const genAI = new GoogleGenerativeAI(settings.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: geminiModel });
      const result = await model.generateContent(`${systemPrompt}\n\n${prompt}`);
      resultText = result.response.text();
    } else if (settings.OPENAI_API_KEY || settings.DEEPSEEK_API_KEY || settings.GROQ_API_KEY) {
      const isDeepSeek = settings.DEFAULT_AI === 'deepseek';
      const isGroq = settings.DEFAULT_AI === 'groq';

      let apiKey = settings.OPENAI_API_KEY;
      let baseURL = settings.OPENAI_BASE_URL && settings.OPENAI_BASE_URL.trim() ? settings.OPENAI_BASE_URL.trim() : undefined;
      let selectedModel = settings.OPENAI_MODEL && settings.OPENAI_MODEL.trim() ? settings.OPENAI_MODEL.trim() : "gpt-3.5-turbo";

      if (isDeepSeek) {
        apiKey = settings.DEEPSEEK_API_KEY || apiKey;
        baseURL = 'https://api.deepseek.com';
        selectedModel = settings.DEEPSEEK_MODEL || 'deepseek-chat';
      } else if (isGroq) {
        apiKey = settings.GROQ_API_KEY || apiKey;
        baseURL = 'https://api.groq.com/openai/v1';
        selectedModel = settings.OPENAI_MODEL || 'llama-3.3-70b-versatile';
      }

      const openai = new OpenAI({ apiKey, baseURL });
      const completion = await openai.chat.completions.create({
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }],
        model: selectedModel,
      });
      if (!completion || !completion.choices || !completion.choices[0]) {
        throw new Error("L'API LLM n'a pas retourné de réponse valide. Vérifiez votre clé API, modèle ou quota.");
      }
      resultText = completion.choices[0].message.content;
    } else {
      return { analyse: "IA non configurée.", sql: null };
    }
    
    // Nettoyage au cas où l'IA renverrait du markdown
    resultText = resultText.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(resultText);
    if (parsed && parsed.sql && typeof parsed.sql === 'string') {
      let cleanSql = parsed.sql.trim();
      cleanSql = cleanSql.replace(/^```(?:sql)?\s*/i, '').replace(/\s*```$/i, '').trim();
      cleanSql = cleanSql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^--.*$/gm, '').trim();
      cleanSql = cleanSql.replace(/;\s*$/, '').trim();
      parsed.sql = cleanSql;
    }
    return parsed;
  } catch (e) {
    console.error("Audit AI Error:", e);
    return { analyse: "Erreur de l'IA: " + friendlyAiErrorMessage(e), sql: null };
  }
}

// Les appels IA (Gemini/OpenAI/DeepSeek) sont la seule fonctionnalité de l'app qui a besoin
// d'Internet ; sans cette détection, une coupure réseau remonte comme une erreur technique
// brute (ENOTFOUND, fetch failed...) au lieu d'un message compréhensible par l'utilisateur.
function isNetworkError(err) {
  const code = err && err.code;
  const msg = String((err && err.message) || '').toLowerCase();
  const networkCodes = ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'];
  return networkCodes.includes(code) || msg.includes('fetch failed') || msg.includes('network');
}

function friendlyAiErrorMessage(err) {
  if (isNetworkError(err)) {
    return "Impossible de contacter le service IA : vérifiez votre connexion Internet (cette fonctionnalité est la seule à en avoir besoin).";
  }
  return err.message;
}

module.exports = { askAI, askAuditAI, getSettings, getBusinessMemoryContext, matchTransactionWithMemory, learnFromJournalData, determineSyscohadaAccount, friendlyAiErrorMessage };
