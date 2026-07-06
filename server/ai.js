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

async function askAI(prompt, history = []) {
  const settings = await getSettings();
  
  if (settings.DEFAULT_AI === 'gemini' && settings.GEMINI_API_KEY) {
    const context = await getFinancialContext();
    const systemPrompt = `Tu es le DAF et Expert Comptable OHADA de l'entreprise. 
Sois EXTRÊMEMENT direct et va droit au but.
Nos livres de comptes :
- Tiers : ${JSON.stringify(context.tiers)}
- Journal : ${JSON.stringify(context.journal)}

Consignes :
1. Fournis une réponse chirurgicale. Calcule ce qui est demandé.
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
              
              const filename = args.filename || `rapport_${Date.now()}.pdf`;
              const filePath = path.join(__dirname, 'public', 'exports', filename);
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
    return { analyse: "Erreur de l'IA: " + e.message, sql: null };
  }
}

module.exports = { askAI, askAuditAI, getSettings };
