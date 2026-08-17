const db = require('./db');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

async function getSettings() {
  return new Promise((resolve, reject) => {
    db.all("SELECT key, value FROM settings", (err, rows) => {
      if (err) reject(err);
      const settings = {};
      rows.forEach(r => settings[r.key] = r.value);
      resolve(settings);
    });
  });
}

async function getFinancialContext() {
  return new Promise((resolve, reject) => {
    const tiersQuery = `
      SELECT 
        compte_tiers as nom,
        MAX(compte) as compte,
        (SUM(debit) - SUM(credit)) as solde,
        CASE WHEN substr(MAX(compte), 1, 2) = '41' THEN 'Client' ELSE 'Fournisseur' END as type
      FROM journal
      WHERE compte_tiers IS NOT NULL AND compte_tiers != ''
        AND (compte LIKE '40%' OR compte LIKE '41%')
      GROUP BY compte_tiers
    `;
    db.all(tiersQuery, (err, tiers) => {
      if (err) return reject(err);
      db.all("SELECT * FROM journal", (err, journal) => {
        if (err) return reject(err);
        resolve({ tiers, journal });
      });
    });
  });
}

async function getBusinessMemoryContext() {
  return new Promise((resolve) => {
    db.all("SELECT * FROM business_rules WHERE is_active = 1 ORDER BY confidence_score DESC", (err, rules) => {
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

async function learnFromJournalData(entries) {
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

  let learnedCount = 0;
  for (const key in patternCounts) {
    const count = patternCounts[key];
    if (count >= 1) {
      let [pattern, compte, codeJournal] = key.split('|||');

      // Si le compte transmis est le compte générique 601100, affiner avec la classification SYSCOHADA par nature
      if (compte === '601100') {
        const sysClassif = determineSyscohadaAccount(pattern, '', true);
        if (sysClassif.target_account !== '601100') {
          compte = sysClassif.target_account;
          if (sysClassif.target_journal) codeJournal = sysClassif.target_journal;
        }
      }

      const confidence = Math.min(0.98, 0.70 + (count * 0.05));

      await new Promise((res) => {
        db.get("SELECT id, occurrences, confidence_score FROM business_rules WHERE pattern = ?", [pattern], (err, existing) => {
          if (!err && existing) {
            const newOcc = existing.occurrences + count;
            const newConf = Math.min(0.98, Math.max(existing.confidence_score, 0.75 + (newOcc * 0.04)));
            db.run("UPDATE business_rules SET occurrences = ?, confidence_score = ?, target_account = ?, target_journal = COALESCE(?, target_journal) WHERE id = ?", [newOcc, newConf, compte, codeJournal || null, existing.id], () => res());
          } else {
            db.run(
              "INSERT INTO business_rules (pattern, condition_type, target_account, target_journal, confidence_score, auto_learned, occurrences, description) VALUES (?, 'contains', ?, ?, ?, 1, ?, ?)",
              [pattern, compte, codeJournal || null, confidence, count, `Appris automatiquement depuis journal Excel (${count} écriture(s))`],
              () => {
                learnedCount++;
                res();
              }
            );
          }
        });
      });
    }
  }

  return learnedCount;
}

async function askAI(prompt, history = []) {
  const settings = await getSettings();
  const memoryContext = await getBusinessMemoryContext();
  
  if (settings.DEFAULT_AI === 'gemini' && settings.GEMINI_API_KEY) {
    const context = await getFinancialContext();
    const systemPrompt = `Tu es le DAF et Expert Comptable OHADA de l'entreprise. 
Sois EXTRÊMEMENT direct et va droit au but.

${memoryContext}

Nos livres de comptes :
- Tiers : ${JSON.stringify(context.tiers)}
- Journal : ${JSON.stringify(context.journal)}

Consignes :
1. Fournis une réponse chirurgicale. Calcule ce qui est demandé. Applique scrupuleusement la Mémoire Métier si elle correspond.
2. Utilise des tableaux Markdown.
3. Une seule phrase de conclusion.`;
    
    let historyText = "";
    if (history && history.length > 0) {
      // slice the last 6 messages to avoid too much text
      historyText = history.slice(-6).map(m => `${m.role === 'user' ? 'Utilisateur' : 'IA'}: ${m.content}`).join('\n') + '\n\n';
    }

    const genAI = new GoogleGenerativeAI(settings.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(`${systemPrompt}\n\nHistorique de la conversation :\n${historyText}Question actuelle: ${prompt}`);
    return { text: result.response.text(), proposal: null };
  } else if ((settings.DEFAULT_AI === 'openai' && settings.OPENAI_API_KEY) || (settings.DEFAULT_AI === 'deepseek' && settings.DEEPSEEK_API_KEY)) {
    // Agentic Loop with Tools for OpenAI Compatible endpoints
    const isDeepSeek = settings.DEFAULT_AI === 'deepseek';
    const openai = new OpenAI({ 
      apiKey: isDeepSeek ? settings.DEEPSEEK_API_KEY : settings.OPENAI_API_KEY,
      baseURL: isDeepSeek ? 'https://api.deepseek.com' : (settings.OPENAI_BASE_URL ? settings.OPENAI_BASE_URL.trim() : undefined)
    });
    const selectedModel = isDeepSeek ? "deepseek-chat" : (settings.OPENAI_MODEL ? settings.OPENAI_MODEL.trim() : (settings.OPENAI_BASE_URL ? undefined : "gpt-3.5-turbo"));

    const systemPrompt = `Tu es le DAF et Expert Comptable OHADA de l'entreprise. Tu es un agent autonome équipé d'outils.
Tu NE DOIS PAS inventer les chiffres. Tu DOIS interroger la base de données comptable.

Structure de la base de données :
1. Table 'journal' : id, code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference, debit, credit. (Ex: comptes de charges = 6%, produits = 7%)
2. Table 'tiers' : id, type, nom, compte_comptable, solde, statut.

Instructions :
- Règle N°1 : Utilise l'outil 'query_database' pour rechercher l'information dont tu as besoin dans les tables avant de répondre. S'il n'y a rien, dis-le.
- Règle N°2 : Si l'utilisateur te demande de faire une modification, d'ajouter, ou de corriger des données, tu dois utiliser l'outil 'propose_update'.
- Règle N°3 : Tu peux appeler 'query_database' plusieurs fois de suite si besoin (ex: vérifier une balance avant correction).
- Règle N°4 : Donne ta réponse finale à l'utilisateur de manière concise et professionnelle, avec des tableaux Markdown pour la présentation des chiffres.`;

    const tools = [
      {
        type: "function",
        function: {
          name: "query_database",
          description: "Exécute une requête SQL SELECT sur la base de données pour lire les écritures comptables (journal) ou les tiers.",
          parameters: {
            type: "object",
            properties: {
              sql: { type: "string", description: "La requête SQL SELECT. Ex: SELECT SUM(credit) FROM journal WHERE compte LIKE '7%'" }
            },
            required: ["sql"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "propose_update",
          description: "Propose une requête SQL de type UPDATE, INSERT ou DELETE. Obligatoire si l'utilisateur te demande de modifier la base. L'utilisateur devra l'approuver.",
          parameters: {
            type: "object",
            properties: {
              sql: { type: "string", description: "La requête SQL de modification." },
              reason: { type: "string", description: "L'explication métier de cette modification (ex: 'Correction du compte fournisseur selon le plan comptable OHADA')." }
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
      const recentHistory = history.slice(-10);
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
    const maxIterations = 6;

    while (iteration < maxIterations && !finalResponse) {
      iteration++;
      const completion = await openai.chat.completions.create({
        messages: messages,
        model: selectedModel,
        tools: tools,
        tool_choice: "auto",
      });

      const responseMessage = completion.choices[0].message;
      messages.push(responseMessage);

      if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        for (const toolCall of responseMessage.tool_calls) {
          if (toolCall.function.name === "query_database") {
            try {
              const args = JSON.parse(toolCall.function.arguments);
              let rows = await db.runSelect(args.sql);
              
              let toolResponse;
              if (rows.length > 50) {
                const truncated = rows.slice(0, 50);
                toolResponse = {
                  warning: `La requête a retourné ${rows.length} lignes. Les résultats ont été tronqués aux 50 premières lignes pour préserver la taille du contexte. Veuillez utiliser des agrégations SQL (ex: SUM, COUNT, GROUP BY) ou filtrer plus précisément (LIMIT, WHERE) pour vos analyses globales.`,
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
              finalResponse = {
                text: `J'ai formulé une proposition de modification pour la base de données :\n\n**Raison** : ${args.reason}\n**Requête** : \`${args.sql}\``,
                proposal: {
                  sql: args.sql,
                  reason: args.reason
                }
              };
            } catch (err) {
              finalResponse = { text: "Erreur lors de la proposition de mise à jour.", proposal: null };
            }
          } else if (toolCall.function.name === "generate_excel") {
            try {
              const args = JSON.parse(toolCall.function.arguments);
              const rows = await db.runSelect(args.sql);
              
              if (rows.length === 0) {
                throw new Error("Aucune donnée trouvée pour cette requête SQL.");
              }

              const xlsx = require('xlsx');
              const ws = xlsx.utils.json_to_sheet(rows);
              const wb = xlsx.utils.book_new();
              xlsx.utils.book_append_sheet(wb, ws, "Données");
              
              const filename = args.filename || `export_${Date.now()}.xlsx`;
              const filePath = path.join(__dirname, 'public', 'exports', filename);
              
              xlsx.writeFile(wb, filePath);
              
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
              
              if (rows.length === 0) {
                throw new Error("Aucune donnée trouvée pour générer le PDF.");
              }

              const PDFDocument = require('pdfkit');
              const doc = new PDFDocument({ margin: 50, size: 'A4' });
              
              const isVercelEnv = !!(process.env.VERCEL || process.env.NOW_BUILDER || process.env.VERCEL_ENV);
              const exportsBaseDir = isVercelEnv ? path.join('/tmp', 'exports') : path.join(__dirname, 'public', 'exports');
              try { if (!fs.existsSync(exportsBaseDir)) fs.mkdirSync(exportsBaseDir, { recursive: true }); } catch (e) {}
              const filename = args.filename || `rapport_${Date.now()}.pdf`;
              const filePath = path.join(exportsBaseDir, filename);
              const stream = fs.createWriteStream(filePath);
              
              doc.pipe(stream);
              
              // Titre et Date
              doc.fontSize(18).font('Helvetica-Bold').text(args.title || "Rapport Financier", { align: 'center' });
              doc.moveDown(0.5);
              doc.fontSize(9).font('Helvetica-Oblique').text(`Généré le : ${new Date().toLocaleString()}`, { align: 'right' });
              doc.moveDown(1.5);
              
              // Colonnes
              const keys = Object.keys(rows[0]);
              const colWidth = 500 / keys.length;
              let y = doc.y;
              
              // En-têtes du tableau
              doc.fontSize(9).font('Helvetica-Bold');
              keys.forEach((key, i) => {
                doc.text(key.toUpperCase(), 50 + (i * colWidth), y, { width: colWidth - 5, truncate: true });
              });
              
              // Ligne séparatrice
              doc.moveTo(50, y + 13).lineTo(550, y + 13).stroke();
              y += 20;
              
              // Données
              doc.font('Helvetica');
              rows.forEach((row) => {
                if (y > 750) {
                  doc.addPage();
                  y = 50;
                  
                  // Réécrire les en-têtes
                  doc.fontSize(9).font('Helvetica-Bold');
                  keys.forEach((key, i) => {
                    doc.text(key.toUpperCase(), 50 + (i * colWidth), y, { width: colWidth - 5, truncate: true });
                  });
                  doc.moveTo(50, y + 13).lineTo(550, y + 13).stroke();
                  y += 20;
                  doc.font('Helvetica');
                }
                
                keys.forEach((key, i) => {
                  const val = row[key] !== null && row[key] !== undefined ? String(row[key]) : "";
                  doc.text(val, 50 + (i * colWidth), y, { width: colWidth - 5, truncate: true });
                });
                y += 18;
              });
              
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
        finalResponse = { text: responseMessage.content, proposal: null };
      }
    }
    
    if (finalResponse && typeof finalResponse === 'object' && 'text' in finalResponse) {
      return finalResponse;
    }
    return { 
      text: typeof finalResponse === 'string' ? finalResponse : "Désolé, j'ai eu besoin de trop d'étapes de réflexion sans arriver à une conclusion.", 
      proposal: null 
    };
  } else {
    return { text: "Veuillez configurer vos clés API dans les paramètres pour activer l'IA.", proposal: null };
  }
}

async function askAuditAI(anomalyContext) {
  const settings = await getSettings();
  
  const systemPrompt = `Tu es le DAF et Expert Comptable OHADA de l'entreprise. 
Tu agis en tant qu'Auditeur. Voici une anomalie détectée dans notre journal comptable :
${JSON.stringify(anomalyContext)}

Ta mission :
1. Analyser brièvement le problème et donner la règle OHADA applicable.
2. Proposer une requête SQL de type "UPDATE" pour corriger le problème dans la table SQLite "journal".
IMPORTANT: La table journal a les colonnes suivantes : id, code_journal, poste_budgetaire, date, compte, compte_tiers, libelle, n_facture, reference, debit, credit.

Tu DOIS impérativement répondre UNIQUEMENT avec un objet JSON valide ayant la structure suivante, et rien d'autre (pas de markdown \`\`\`json) :
{
  "analyse": "Ton analyse et conseil...",
  "sql": "UPDATE journal SET compte = 'nouveau_compte' WHERE id = 123;"
}`;

  const prompt = "Analyse cette anomalie et donne la correction JSON.";

  try {
    let resultText = "";
    if (settings.DEFAULT_AI === 'gemini' && settings.GEMINI_API_KEY) {
      const genAI = new GoogleGenerativeAI(settings.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent(`${systemPrompt}\n\n${prompt}`);
      resultText = result.response.text();
    } else if (settings.DEFAULT_AI === 'openai' && settings.OPENAI_API_KEY) {
      const openai = new OpenAI({ 
        apiKey: settings.OPENAI_API_KEY,
        baseURL: settings.OPENAI_BASE_URL ? settings.OPENAI_BASE_URL.trim() : undefined
      });
      const completion = await openai.chat.completions.create({
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }],
        model: settings.OPENAI_MODEL ? settings.OPENAI_MODEL.trim() : (settings.OPENAI_BASE_URL ? undefined : "gpt-3.5-turbo"),
      });
      resultText = completion.choices[0].message.content;
    } else if (settings.DEFAULT_AI === 'deepseek' && settings.DEEPSEEK_API_KEY) {
      const deepseek = new OpenAI({ apiKey: settings.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com' });
      const completion = await deepseek.chat.completions.create({
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }],
        model: "deepseek-chat",
      });
      resultText = completion.choices[0].message.content;
    } else {
      return { analyse: "IA non configurée.", sql: null };
    }
    
    // Nettoyage au cas où l'IA renverrait du markdown
    resultText = resultText.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(resultText);
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
