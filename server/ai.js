const db = require('./db');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');

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

async function askAI(prompt) {
  const settings = await getSettings();
  const context = await getFinancialContext();
  
  const systemPrompt = `Tu es le DAF et Expert Comptable OHADA de l'entreprise. 
Sois EXTRÊMEMENT direct et va droit au but. Pas de salutations à rallonge, pas de formules de politesse inutiles ("Bonjour, je suis ravi..."). Donne directement les chiffres et l'analyse.

Nos livres de comptes :
- Tiers : ${JSON.stringify(context.tiers)}
- Journal : ${JSON.stringify(context.journal)}

Consignes :
1. Fournis une réponse chirurgicale. Calcule ce qui est demandé (ex: classe 6 pour les charges, classe 7 pour les produits) et affiche le résultat immédiatement.
2. Utilise des tableaux Markdown pour la clarté.
3. Une seule phrase de conclusion ou de conseil à la fin, pas plus.`;

  if (settings.DEFAULT_AI === 'gemini' && settings.GEMINI_API_KEY) {
    const genAI = new GoogleGenerativeAI(settings.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(`${systemPrompt}\n\nQuestion de l'utilisateur: ${prompt}`);
    return result.response.text();
  } else if (settings.DEFAULT_AI === 'openai' && settings.OPENAI_API_KEY) {
    const openai = new OpenAI({ apiKey: settings.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
      ],
      model: "gpt-3.5-turbo",
    });
    return completion.choices[0].message.content;
  } else if (settings.DEFAULT_AI === 'deepseek' && settings.DEEPSEEK_API_KEY) {
    const deepseek = new OpenAI({ 
      apiKey: settings.DEEPSEEK_API_KEY, 
      baseURL: 'https://api.deepseek.com' 
    });
    const completion = await deepseek.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
      ],
      model: "deepseek-chat",
    });
    return completion.choices[0].message.content;
  } else {
    return "Veuillez configurer vos clés API (Gemini, OpenAI ou DeepSeek) dans les paramètres pour activer l'IA réelle.";
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
      const openai = new OpenAI({ apiKey: settings.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }],
        model: "gpt-3.5-turbo",
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
