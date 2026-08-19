import { useState, useEffect } from 'react';
import { Settings, Key, CheckCircle, Save, Database, Cloud, CloudOff, RefreshCw, Download, ArrowUpCircle, Laptop, ShieldCheck } from 'lucide-react';
import { getSupabaseConfig, saveSupabaseConfig } from '../utils/supabaseClient';

export const SettingsModule = () => {
  const [keys, setKeys] = useState({ 
    GEMINI_API_KEY: '', 
    OPENAI_API_KEY: '', 
    DEEPSEEK_API_KEY: '',
    OPENAI_BASE_URL: '',
    OPENAI_MODEL: '',
    DEFAULT_AI: 'gemini' 
  });

  const [supabaseConfig, setSupabaseConfig] = useState({
    url: '',
    key: '',
    autoSync: true
  });

  const [syncStatus, setSyncStatus] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedSupabase, setSavedSupabase] = useState(false);
  const [showSql, setShowSql] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  // Mises à jour & Multi-postes
  const [appVersion, setAppVersion] = useState('2.0.0');
  const [updateInfo, setUpdateInfo] = useState(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateMsg, setUpdateMsg] = useState('');

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => setKeys({ 
        GEMINI_API_KEY: data.GEMINI_API_KEY || '', 
        OPENAI_API_KEY: data.OPENAI_API_KEY || '', 
        DEEPSEEK_API_KEY: data.DEEPSEEK_API_KEY || '',
        OPENAI_BASE_URL: data.OPENAI_BASE_URL || '',
        OPENAI_MODEL: data.OPENAI_MODEL || '',
        DEFAULT_AI: data.DEFAULT_AI || 'gemini' 
      }))
      .catch(e => console.error(e));

    fetch('/api/system/version')
      .then(res => res.json())
      .then(data => { if (data && data.version) setAppVersion(data.version); })
      .catch(() => {});

    fetchSyncStatus();
  }, []);

  const handleCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    setUpdateMsg('');
    try {
      const res = await fetch('/api/system/check-update');
      const data = await res.json();
      setUpdateInfo(data);
      if (!data.hasUpdate) {
        setUpdateMsg(`Votre logiciel est à jour (v${data.currentVersion || appVersion}).`);
      }
    } catch (e) {
      setUpdateMsg("Impossible de vérifier les mises à jour (vérifiez votre connexion Internet).");
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleApplyUpdate = async () => {
    if (!updateInfo || !updateInfo.downloadUrl) return;
    setIsUpdating(true);
    setUpdateMsg("Téléchargement et installation de la mise à jour en cours... L'application va redémarrer.");
    try {
      const res = await fetch('/api/system/apply-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ downloadUrl: updateInfo.downloadUrl })
      });
      const data = await res.json();
      if (!res.ok) {
        setUpdateMsg(data.error || "Erreur lors de la mise à jour.");
        setIsUpdating(false);
      }
    } catch (e) {
      setUpdateMsg("Erreur de communication avec le serveur d'installation.");
      setIsUpdating(false);
    }
  };

  const fetchSyncStatus = () => {
    const localCfg = getSupabaseConfig();
    if (localCfg.url) {
      setSupabaseConfig({
        url: localCfg.url,
        key: localCfg.key ? '********' : '',
        autoSync: localCfg.autoSync
      });
    }

    fetch('/api/sync/status')
      .then(res => res.json())
      .then(data => {
        if (data && data.url) {
          setSupabaseConfig({
            url: data.url || localCfg.url,
            key: data.hasKey ? '********' : (localCfg.key ? '********' : ''),
            autoSync: data.autoSync !== undefined ? data.autoSync : localCfg.autoSync
          });
        }
        setSyncStatus(data);
      })
      .catch(() => {
        setSyncStatus({
          url: localCfg.url,
          hasKey: !!localCfg.key,
          autoSync: localCfg.autoSync,
          pendingCount: 0,
          lastLog: { message: localCfg.url ? 'Connecté en mode direct Supabase Cloud' : 'Supabase non configuré', status: localCfg.url ? 'success' : 'info' }
        });
      });
  };

  const handleSaveAI = async () => {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(keys)
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleSaveSupabase = async () => {
    const localCfg = getSupabaseConfig();
    const urlToSave = supabaseConfig.url;
    const keyToSave = (supabaseConfig.key && !supabaseConfig.key.includes('***')) ? supabaseConfig.key : localCfg.key;
    const autoSyncToSave = supabaseConfig.autoSync;

    // Enregistrement direct dans le navigateur (support Vercel & Offline)
    saveSupabaseConfig({ url: urlToSave, key: keyToSave, autoSync: autoSyncToSave });

    try {
      const payload = { url: urlToSave, autoSync: autoSyncToSave };
      if (keyToSave) payload.key = keyToSave;

      await fetch('/api/sync/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      console.warn("Serveur backend indisponible, configuration enregistrée localement:", e);
    }

    setSavedSupabase(true);
    setTimeout(() => setSavedSupabase(false), 3000);
    fetchSyncStatus();
  };

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch('/api/sync/trigger', { method: 'POST' });
      const data = await res.json();
      setSyncStatus(prev => ({ ...prev, lastLog: { message: data.message, status: data.status } }));
    } catch (e) {
      console.error(e);
    } finally {
      setIsSyncing(false);
      fetchSyncStatus();
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.5rem' }}>
      
      {/* CARD 1 : SYNCHRONISATION SUPABASE & MODE HORS-LIGNE */}
      <div className="card">
        <h3 style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-primary-dark)' }}>
          <Cloud style={{ color: 'var(--color-primary)' }} />
          Synchronisation Supabase (Cloud & Offline-First)
        </h3>

        <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--color-text-main)' }}>
              Mode de synchronisation :
            </span>
            <button
              className={`btn ${supabaseConfig.autoSync ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setSupabaseConfig({ ...supabaseConfig, autoSync: !supabaseConfig.autoSync })}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontSize: '0.85rem',
                background: supabaseConfig.autoSync ? 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)' : '#e2e8f0',
                borderColor: supabaseConfig.autoSync ? '#15803d' : '#cbd5e1',
                color: supabaseConfig.autoSync ? '#fff' : '#475569'
              }}
            >
              {supabaseConfig.autoSync ? <Cloud size={16} /> : <CloudOff size={16} />}
              {supabaseConfig.autoSync ? 'Auto-Sync Activé' : 'Mode 100% Local (Sync Désactivé)'}
            </button>
          </div>

          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
            {supabaseConfig.autoSync ? (
              '⚡ Vos travaux sont sauvegardés en local puis envoyés automatiquement sur Supabase dès qu\'Internet est disponible.'
            ) : (
              '🔒 Vos données restent exclusivement stockées sur votre PC dans SQLite. Aucune synchronisation distante.'
            )}
          </p>
        </div>

        <div style={{ marginBottom: '1.25rem' }}>
          <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 500, fontSize: '0.85rem' }}>URL du projet Supabase</label>
          <input 
            type="text" 
            className="input" 
            value={supabaseConfig.url}
            onChange={e => setSupabaseConfig({...supabaseConfig, url: e.target.value})}
            placeholder="https://xyz.supabase.co" 
          />
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 500, fontSize: '0.85rem' }}>Clé API Publique Supabase (Anon / Service Key)</label>
          <div style={{ position: 'relative' }}>
            <Key size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
            <input 
              type="password" 
              className="input" 
              style={{ paddingLeft: '2.25rem' }} 
              value={supabaseConfig.key}
              onChange={e => setSupabaseConfig({...supabaseConfig, key: e.target.value})}
              placeholder="eyJhbGciOiJIUzI1NiIsIn..." 
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
          <button className="btn btn-primary" onClick={handleSaveSupabase} style={{ flex: 1 }}>
            <Save size={16} /> Enregistrer Supabase
          </button>
          <button 
            className="btn btn-secondary" 
            onClick={handleManualSync} 
            disabled={isSyncing}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <RefreshCw size={16} className={isSyncing ? 'spin' : ''} /> ⚡ Synchroniser
          </button>
        </div>

        {savedSupabase && (
          <div style={{ marginBottom: '1rem', color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', fontWeight: 500 }}>
            <CheckCircle size={16} /> Configuration Supabase mise à jour.
          </div>
        )}

        {syncStatus && (
          <div style={{ padding: '0.75rem', background: '#f1f5f9', borderRadius: 'var(--radius-md)', fontSize: '0.8rem', border: '1px solid var(--color-border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
              <span>Modifications locales en attente :</span>
              <strong style={{ color: syncStatus.pendingCount > 0 ? 'var(--color-warning)' : 'var(--color-success)' }}>
                {syncStatus.pendingCount} écriture(s)
              </strong>
            </div>
            {syncStatus.lastLog && (
              <div style={{ color: 'var(--color-text-muted)', marginTop: '0.25rem', fontSize: '0.75rem' }}>
                Dernier statut : {syncStatus.lastLog.message}
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <a
              href="/api/sync/schema-script"
              download="supabase_schema.sql"
              className="btn btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', textDecoration: 'none' }}
            >
              <Download size={14} /> 📥 Télécharger le script SQL (.sql)
            </a>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setShowSql(!showSql);
              }}
              style={{ fontSize: '0.8rem' }}
            >
              {showSql ? 'Masquer le code SQL' : '📋 Afficher / Copier le Script SQL'}
            </button>
          </div>

          {showSql && (
            <div style={{ marginTop: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
                  Copiez ce code et collez-le dans le SQL Editor de Supabase :
                </span>
                <button
                  className="btn btn-primary"
                  style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
                  onClick={() => {
                    const sqlText = `-- SCRIPT SUPABASE AGENT OHADA\nCREATE TABLE IF NOT EXISTS public.journal ( id BIGINT PRIMARY KEY, code_journal TEXT, poste_budgetaire TEXT, date TEXT, compte TEXT, compte_tiers TEXT, libelle TEXT, n_facture TEXT, reference TEXT, debit NUMERIC DEFAULT 0, credit NUMERIC DEFAULT 0, piece_id BIGINT, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() );\nCREATE TABLE IF NOT EXISTS public.tiers ( id BIGINT PRIMARY KEY, type TEXT, nom TEXT UNIQUE, compte_comptable TEXT, solde NUMERIC DEFAULT 0, statut TEXT, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() );\nCREATE TABLE IF NOT EXISTS public.exercices ( id BIGINT PRIMARY KEY, libelle TEXT NOT NULL, date_debut TEXT NOT NULL, date_fin TEXT NOT NULL, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() );\nCREATE TABLE IF NOT EXISTS public.chart_of_accounts ( compte TEXT PRIMARY KEY, libelle TEXT NOT NULL, source_doc_id BIGINT, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() );\nCREATE TABLE IF NOT EXISTS public.business_rules ( id BIGINT PRIMARY KEY, doc_id BIGINT, pattern TEXT NOT NULL, condition_type TEXT DEFAULT 'contains', target_account TEXT, target_journal TEXT, vat_rate NUMERIC DEFAULT 0, confidence_score NUMERIC DEFAULT 1.0, auto_learned INT DEFAULT 0, occurrences INT DEFAULT 1, description TEXT, is_active INT DEFAULT 1, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() );\nALTER TABLE public.journal ENABLE ROW LEVEL SECURITY;\nALTER TABLE public.tiers ENABLE ROW LEVEL SECURITY;\nALTER TABLE public.exercices ENABLE ROW LEVEL SECURITY;\nALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;\nALTER TABLE public.business_rules ENABLE ROW LEVEL SECURITY;\nCREATE POLICY "Allow anonymous read access" ON public.journal FOR SELECT USING (true);\nCREATE POLICY "Allow anonymous insert access" ON public.journal FOR INSERT WITH CHECK (true);\nCREATE POLICY "Allow anonymous update access" ON public.journal FOR UPDATE USING (true);\nCREATE POLICY "Allow anonymous read access" ON public.tiers FOR SELECT USING (true);\nCREATE POLICY "Allow anonymous insert access" ON public.tiers FOR INSERT WITH CHECK (true);\nCREATE POLICY "Allow anonymous update access" ON public.tiers FOR UPDATE USING (true);\nCREATE POLICY "Allow anonymous read access" ON public.exercices FOR SELECT USING (true);\nCREATE POLICY "Allow anonymous insert access" ON public.exercices FOR INSERT WITH CHECK (true);\nCREATE POLICY "Allow anonymous update access" ON public.exercices FOR UPDATE USING (true);\nCREATE POLICY "Allow anonymous read access" ON public.chart_of_accounts FOR SELECT USING (true);\nCREATE POLICY "Allow anonymous insert access" ON public.chart_of_accounts FOR INSERT WITH CHECK (true);\nCREATE POLICY "Allow anonymous update access" ON public.chart_of_accounts FOR UPDATE USING (true);\nCREATE POLICY "Allow anonymous read access" ON public.business_rules FOR SELECT USING (true);\nCREATE POLICY "Allow anonymous insert access" ON public.business_rules FOR INSERT WITH CHECK (true);\nCREATE POLICY "Allow anonymous update access" ON public.business_rules FOR UPDATE USING (true);`;
                    navigator.clipboard.writeText(sqlText);
                    setCopiedSql(true);
                    setTimeout(() => setCopiedSql(false), 2500);
                  }}
                >
                  {copiedSql ? '✓ Copié !' : '📋 Copier tout'}
                </button>
              </div>
              <textarea
                readOnly
                className="input"
                style={{ fontFamily: 'monospace', fontSize: '0.75rem', height: '180px', background: '#0f172a', color: '#f8fafc', width: '100%' }}
                value={`-- SCRIPT SUPABASE AGENT OHADA (LE-DAF)
CREATE TABLE IF NOT EXISTS public.journal (
  id BIGINT PRIMARY KEY, code_journal TEXT, poste_budgetaire TEXT, date TEXT, compte TEXT, compte_tiers TEXT, libelle TEXT, n_facture TEXT, reference TEXT, debit NUMERIC DEFAULT 0, credit NUMERIC DEFAULT 0, piece_id BIGINT, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.tiers (
  id BIGINT PRIMARY KEY, type TEXT, nom TEXT UNIQUE, compte_comptable TEXT, solde NUMERIC DEFAULT 0, statut TEXT, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.exercices (
  id BIGINT PRIMARY KEY, libelle TEXT NOT NULL, date_debut TEXT NOT NULL, date_fin TEXT NOT NULL, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.chart_of_accounts (
  compte TEXT PRIMARY KEY, libelle TEXT NOT NULL, source_doc_id BIGINT, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.business_rules (
  id BIGINT PRIMARY KEY, doc_id BIGINT, pattern TEXT NOT NULL, condition_type TEXT DEFAULT 'contains', target_account TEXT, target_journal TEXT, vat_rate NUMERIC DEFAULT 0, confidence_score NUMERIC DEFAULT 1.0, auto_learned INT DEFAULT 0, occurrences INT DEFAULT 1, description TEXT, is_active INT DEFAULT 1, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE public.journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anonymous read access" ON public.journal FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert access" ON public.journal FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update access" ON public.journal FOR UPDATE USING (true);
CREATE POLICY "Allow anonymous read access" ON public.tiers FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert access" ON public.tiers FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update access" ON public.tiers FOR UPDATE USING (true);
CREATE POLICY "Allow anonymous read access" ON public.exercices FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert access" ON public.exercices FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update access" ON public.exercices FOR UPDATE USING (true);
CREATE POLICY "Allow anonymous read access" ON public.chart_of_accounts FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert access" ON public.chart_of_accounts FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update access" ON public.chart_of_accounts FOR UPDATE USING (true);
CREATE POLICY "Allow anonymous read access" ON public.business_rules FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert access" ON public.business_rules FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update access" ON public.business_rules FOR UPDATE USING (true);`}
              />
            </div>
          )}
        </div>
      </div>

      {/* CARD 2 : PARAMÈTRES IA (GEMINI, OPENAI, DEEPSEEK) */}
      <div className="card">
        <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Settings style={{ color: 'var(--color-primary)' }} />
          Paramètres Intelligence Artificielle (IA)
        </h3>
        
        <div>
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 500, fontSize: '0.85rem' }}>Clé API Google Gemini</label>
            <div style={{ position: 'relative' }}>
              <Key size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
              <input 
                type="password" 
                className="input" 
                style={{ paddingLeft: '2.25rem' }} 
                value={keys.GEMINI_API_KEY}
                onChange={e => setKeys({...keys, GEMINI_API_KEY: e.target.value})}
                placeholder="AIzaSy..." 
              />
            </div>
          </div>

          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 500, fontSize: '0.85rem' }}>Clé API OpenAI / Sublyx</label>
            <div style={{ position: 'relative' }}>
              <Key size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
              <input 
                type="password" 
                className="input" 
                style={{ paddingLeft: '2.25rem' }} 
                value={keys.OPENAI_API_KEY}
                onChange={e => setKeys({...keys, OPENAI_API_KEY: e.target.value})}
                placeholder="sk-..." 
              />
            </div>
          </div>

          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 500, fontSize: '0.85rem' }}>URL de Base OpenAI / Sublyx (Optionnel)</label>
            <input 
              type="text" 
              className="input" 
              value={keys.OPENAI_BASE_URL}
              onChange={e => setKeys({...keys, OPENAI_BASE_URL: e.target.value})}
              placeholder="https://api.openai.com/v1" 
            />
          </div>

          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 500, fontSize: '0.85rem' }}>Nom du Modèle OpenAI / Custom (Optionnel)</label>
            <input 
              type="text" 
              className="input" 
              value={keys.OPENAI_MODEL}
              onChange={e => setKeys({...keys, OPENAI_MODEL: e.target.value})}
              placeholder="gpt-3.5-turbo (ou gpt-4o, mistralai/..., etc.)" 
            />
          </div>

          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 500, fontSize: '0.85rem' }}>Clé API DeepSeek</label>
            <div style={{ position: 'relative' }}>
              <Key size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
              <input 
                type="password" 
                className="input" 
                style={{ paddingLeft: '2.25rem' }} 
                value={keys.DEEPSEEK_API_KEY}
                onChange={e => setKeys({...keys, DEEPSEEK_API_KEY: e.target.value})}
                placeholder="sk-..." 
              />
            </div>
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 500, fontSize: '0.85rem' }}>Modèle d'IA par défaut</label>
            <select 
              className="input" 
              value={keys.DEFAULT_AI}
              onChange={e => setKeys({...keys, DEFAULT_AI: e.target.value})}
            >
              <option value="gemini">Google Gemini 1.5 Flash (Recommandé)</option>
              <option value="openai">OpenAI GPT-3.5/GPT-4</option>
              <option value="deepseek">DeepSeek (Recommandé pour la comptabilité)</option>
            </select>
          </div>

          <button className="btn btn-primary" onClick={handleSaveAI}>
            <Save size={16} /> Sauvegarder les clés IA
          </button>

          {saved && (
            <div style={{ marginTop: '1rem', color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', fontWeight: 500 }}>
              <CheckCircle size={16} /> Clés IA enregistrées avec succès !
            </div>
          )}
        </div>
      </div>

      {/* Carte Mises à jour & Multi-postes */}
      <div className="card" style={{ marginTop: '1.5rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)' }}>
        <div style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Laptop size={22} style={{ color: 'var(--color-primary)' }} />
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600 }}>Déploiement Multi-Postes & Mises à Jour Automatiques</h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                  Version installée : <strong>v{appVersion}</strong>
                </span>
              </div>
            </div>

            <button 
              className="btn btn-secondary" 
              onClick={handleCheckUpdate} 
              disabled={isCheckingUpdate || isUpdating}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}
            >
              <RefreshCw size={14} className={isCheckingUpdate ? 'spin' : ''} />
              {isCheckingUpdate ? 'Vérification...' : '🔍 Vérifier les mises à jour'}
            </button>
          </div>

          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
            Ce logiciel fonctionne en réseau multi-postes : chaque ordinateur synchronise ses écritures via Supabase Cloud en toute sécurité tout en restant 100% opérationnel hors-ligne.
          </p>

          {updateMsg && (
            <div style={{ padding: '0.75rem 1rem', background: '#f8fafc', borderRadius: 'var(--radius-md)', fontSize: '0.85rem', marginBottom: '1rem', border: '1px solid var(--color-border)' }}>
              {updateMsg}
            </div>
          )}

          {updateInfo && updateInfo.hasUpdate && (
            <div style={{ padding: '1rem', background: '#ecfdf5', borderRadius: 'var(--radius-md)', border: '1px solid #a7f3d0', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#065f46', fontWeight: 600, marginBottom: '0.5rem' }}>
                <ArrowUpCircle size={18} /> Nouvelle version disponible : v{updateInfo.latestVersion}
              </div>
              {updateInfo.releaseNotes && (
                <div style={{ fontSize: '0.8rem', color: '#047857', marginBottom: '0.75rem' }}>
                  {updateInfo.releaseNotes}
                </div>
              )}
              <button 
                className="btn btn-primary" 
                onClick={handleApplyUpdate}
                disabled={isUpdating}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}
              >
                <ArrowUpCircle size={16} />
                {isUpdating ? 'Mise à jour en cours...' : `Mettre à jour vers v${updateInfo.latestVersion} maintenant`}
              </button>
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', paddingTop: '0.75rem', borderTop: '1px solid var(--color-border)' }}>
            <a 
              href="https://github.com/anorps1-png/Le-DAF/releases/latest/download/AgentOHADA-Setup.exe" 
              className="btn btn-secondary"
              target="_blank" 
              rel="noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', textDecoration: 'none' }}
            >
              <Download size={14} /> 📥 Télécharger le Setup d'installation pour un autre PC
            </a>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              <ShieldCheck size={14} style={{ color: 'var(--color-success)' }} />
              Base de données SQLite locale préservée lors de chaque mise à jour.
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};
