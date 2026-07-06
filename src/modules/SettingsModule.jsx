import { useState, useEffect } from 'react';
import { Settings, Key, CheckCircle, Save } from 'lucide-react';

export const SettingsModule = () => {
  const [keys, setKeys] = useState({ 
    GEMINI_API_KEY: '', 
    OPENAI_API_KEY: '', 
    DEEPSEEK_API_KEY: '',
    OPENAI_BASE_URL: '',
    OPENAI_MODEL: '',
    DEFAULT_AI: 'gemini' 
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('http://localhost:3001/api/settings')
      .then(res => res.json())
      .then(data => setKeys({ 
        GEMINI_API_KEY: data.GEMINI_API_KEY || '', 
        OPENAI_API_KEY: data.OPENAI_API_KEY || '', 
        DEEPSEEK_API_KEY: data.DEEPSEEK_API_KEY || '',
        OPENAI_BASE_URL: data.OPENAI_BASE_URL || '',
        OPENAI_MODEL: data.OPENAI_MODEL || '',
        DEFAULT_AI: data.DEFAULT_AI || 'gemini' 
      }));
  }, []);

  const handleSave = async () => {
    await fetch('http://localhost:3001/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(keys)
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="card">
      <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Settings style={{ color: 'var(--color-primary)' }} />
        Paramètres du Système & Intelligence Artificielle
      </h3>
      
      <div style={{ maxWidth: '600px' }}>
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Clé API Google Gemini</label>
          <div style={{ position: 'relative' }}>
            <Key size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
            <input 
              type="password" 
              className="input" 
              style={{ paddingLeft: '2.5rem' }} 
              value={keys.GEMINI_API_KEY}
              onChange={e => setKeys({...keys, GEMINI_API_KEY: e.target.value})}
              placeholder="AIzaSy..." 
            />
          </div>
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Clé API OpenAI / Sublyx</label>
          <div style={{ position: 'relative' }}>
            <Key size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
            <input 
              type="password" 
              className="input" 
              style={{ paddingLeft: '2.5rem' }} 
              value={keys.OPENAI_API_KEY}
              onChange={e => setKeys({...keys, OPENAI_API_KEY: e.target.value})}
              placeholder="sk-..." 
            />
          </div>
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>URL de Base OpenAI / Sublyx</label>
          <input 
            type="text" 
            className="input" 
            value={keys.OPENAI_BASE_URL}
            onChange={e => setKeys({...keys, OPENAI_BASE_URL: e.target.value})}
            placeholder="https://api.openai.com/v1 (Laisser vide pour l'officiel, utiliser https://api.sublyx.org/v1 pour Sublyx)" 
          />
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Modèle OpenAI</label>
          <input 
            type="text" 
            className="input" 
            value={keys.OPENAI_MODEL}
            onChange={e => setKeys({...keys, OPENAI_MODEL: e.target.value})}
            placeholder="gpt-3.5-turbo (Laisser vide pour le modèle par défaut)" 
          />
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Clé API DeepSeek</label>
          <div style={{ position: 'relative' }}>
            <Key size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
            <input 
              type="password" 
              className="input" 
              style={{ paddingLeft: '2.5rem' }} 
              value={keys.DEEPSEEK_API_KEY}
              onChange={e => setKeys({...keys, DEEPSEEK_API_KEY: e.target.value})}
              placeholder="sk-..." 
            />
          </div>
        </div>

        <div style={{ marginBottom: '2rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Modèle d'IA par défaut</label>
          <select 
            className="input" 
            value={keys.DEFAULT_AI}
            onChange={e => setKeys({...keys, DEFAULT_AI: e.target.value})}
          >
            <option value="gemini">Google Gemini 1.5 Flash (Recommandé)</option>
            <option value="openai">OpenAI GPT-3.5/GPT-4</option>
            <option value="deepseek">DeepSeek (Recommandé pour la programmation et la comptabilité)</option>
          </select>
        </div>

        <button className="btn btn-primary" onClick={handleSave}>
          <Save size={18} /> Sauvegarder les clés
        </button>

        {saved && (
          <div style={{ marginTop: '1rem', color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 500 }}>
            <CheckCircle size={18} /> Paramètres enregistrés avec succès. L'Agent est prêt !
          </div>
        )}
      </div>
    </div>
  );
};
