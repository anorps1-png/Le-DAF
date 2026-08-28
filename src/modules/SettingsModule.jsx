import { useState, useEffect, useRef } from 'react';
import { Settings, Key, CheckCircle, Save, Database, Cloud, CloudOff, RefreshCw, Download, ArrowUpCircle, Laptop, ShieldCheck, FolderOpen, FilePlus, FolderSync, AlertCircle } from 'lucide-react';
import { getSupabaseConfig, saveSupabaseConfig } from '../utils/supabaseClient';
import SyncProgressModal from '../components/SyncProgressModal';

// La version Electron dispose déjà d'un vrai dialogue système (menu Fichier > Ouvrir/Nouveau,
// electron/main.cjs) qui redémarre toute l'application pour garantir un état 100% propre. Cette
// carte est l'équivalent pour la version navigateur (pas de dialogue système ni de process à
// relancer possible depuis un onglet web) : upload/téléchargement + bascule à chaud côté serveur
// (server/db.js, db.switchDatabase). Masquée en Electron pour ne pas dupliquer le menu natif.
const isElectronApp = typeof window !== 'undefined' && !!(window.electronAPI && window.electronAPI.isElectron);

export const SettingsModule = () => {
  const [keys, setKeys] = useState({ 
    GEMINI_API_KEY: '', 
    OPENAI_API_KEY: '', 
    DEEPSEEK_API_KEY: '',
    OPENAI_BASE_URL: '',
    OPENAI_MODEL: '',
    DEFAULT_AI: 'gemini' 
  });

  const [dsfTemplatePath, setDsfTemplatePath] = useState('');
  const [savedDsf, setSavedDsf] = useState(false);

  // Dossier comptable actif (version web de "Ouvrir"/"Nouveau fichier comptable...")
  const [dbInfo, setDbInfo] = useState(null);
  const [dbList, setDbList] = useState([]);
  const [newDbName, setNewDbName] = useState('');
  const [newDbFolder, setNewDbFolder] = useState('');
  const [isDbBusy, setIsDbBusy] = useState(false);
  const [dbActionMsg, setDbActionMsg] = useState(null);
  const dbFileInputRef = useRef(null);

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
      .then(data => {
        setKeys({
          GEMINI_API_KEY: data.GEMINI_API_KEY || '',
          OPENAI_API_KEY: data.OPENAI_API_KEY || '',
          DEEPSEEK_API_KEY: data.DEEPSEEK_API_KEY || '',
          OPENAI_BASE_URL: data.OPENAI_BASE_URL || '',
          OPENAI_MODEL: data.OPENAI_MODEL || '',
          DEFAULT_AI: data.DEFAULT_AI || 'gemini'
        });
        setDsfTemplatePath(data.DSF_TEMPLATE_PATH || '');
      })
      .catch(e => console.error(e));

    fetch('/api/system/version')
      .then(res => res.json())
      .then(data => { if (data && data.version) setAppVersion(data.version); })
      .catch(() => {});

    fetchSyncStatus();
    if (!isElectronApp) fetchDbInfo();
  }, []);

  const fetchDbInfo = () => {
    fetch('/api/db/info').then(res => res.json()).then(setDbInfo).catch(() => {});
    fetch('/api/db/list').then(res => res.json()).then(data => setDbList(Array.isArray(data) ? data : [])).catch(() => {});
  };

  const reloadAfterDbSwitch = (successText) => {
    setDbActionMsg({ type: 'success', text: `${successText} Rechargement de l'application...` });
    setTimeout(() => window.location.reload(), 1200);
  };

  const handleOpenDbFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!window.confirm(`Ouvrir "${file.name}" comme dossier comptable actif ? L'application va se recharger sur ces données.`)) {
      e.target.value = '';
      return;
    }
    setIsDbBusy(true);
    setDbActionMsg(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/db/open', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur à l'ouverture du fichier.");
      reloadAfterDbSwitch(`Dossier comptable "${data.name}" ouvert.`);
    } catch (err) {
      setDbActionMsg({ type: 'error', text: err.message });
      setIsDbBusy(false);
    } finally {
      e.target.value = '';
    }
  };

  const handleCreateDb = async () => {
    const name = newDbName.trim();
    if (!name) return;
    const folder = newDbFolder.trim();
    const emplacementTxt = folder ? `dans "${folder}"` : `à l'emplacement par défaut`;
    if (!window.confirm(`Créer le nouveau dossier comptable "${name}" ${emplacementTxt} (base vide, plan comptable OHADA de base) et y basculer ? L'application va se recharger.`)) return;
    setIsDbBusy(true);
    setDbActionMsg(null);
    try {
      const res = await fetch('/api/db/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, folder: folder || undefined })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur à la création du dossier comptable.');
      reloadAfterDbSwitch(`Dossier comptable "${data.name}" créé.`);
    } catch (err) {
      setDbActionMsg({ type: 'error', text: err.message });
      setIsDbBusy(false);
    }
  };

  const handleSwitchDb = async (targetPath, name) => {
    if (!window.confirm(`Basculer vers le dossier comptable "${name}" ? L'application va se recharger.`)) return;
    setIsDbBusy(true);
    setDbActionMsg(null);
    try {
      const res = await fetch('/api/db/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: targetPath })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur lors du changement de dossier comptable.');
      reloadAfterDbSwitch(`Dossier comptable "${data.name}" activé.`);
    } catch (err) {
      setDbActionMsg({ type: 'error', text: err.message });
      setIsDbBusy(false);
    }
  };

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

  const handleSaveDsf = async () => {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ DSF_TEMPLATE_PATH: dsfTemplatePath })
    });
    setSavedDsf(true);
    setTimeout(() => setSavedDsf(false), 3000);
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

  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [lastActionResult, setLastActionResult] = useState(null);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncModalType, setSyncModalType] = useState('push');

  const handlePush = async () => {
    setIsPushing(true);
    setSyncModalType('push');
    setShowSyncModal(true);
    setLastActionResult(null);
    try {
      const res = await fetch('/api/sync/push', { method: 'POST' });
      const data = await res.json();
      setLastActionResult(data);
    } catch (e) {
      console.error(e);
      setLastActionResult({ status: 'error', message: 'Erreur lors du PUSH : ' + e.message });
    } finally {
      setIsPushing(false);
      fetchSyncStatus();
    }
  };

  const handlePull = async (force = false) => {
    setIsPulling(true);
    setSyncModalType('pull');
    setShowSyncModal(true);
    setLastActionResult(null);
    try {
      const res = await fetch('/api/sync/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force })
      });
      const data = await res.json();
      setLastActionResult(data);
    } catch (e) {
      console.error(e);
      setLastActionResult({ status: 'error', message: 'Erreur lors du PULL : ' + e.message });
    } finally {
      setIsPulling(false);
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

        {/* COMMANDES DE SYNCHRONISATION MANUELLE (PUSH & PULL) */}
        <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', marginBottom: '1.5rem' }}>
          <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem', color: 'var(--color-primary-dark)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Database size={18} />
            Commandes de Synchronisation Manuelle
          </h4>
          <p style={{ margin: '0 0 1rem 0', fontSize: '0.8rem', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
            Le mode automatique est désactivé pour un contrôle total. Utilisez les boutons ci-dessous pour envoyer vos modifications vers Supabase ou télécharger les nouveautés distantes.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
            <button
              className="btn btn-primary"
              onClick={handlePush}
              disabled={isPushing || isPulling}
              style={{
                background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                padding: '0.75rem 1rem',
                fontWeight: 600
              }}
            >
              <ArrowUpCircle size={18} className={isPushing ? 'spin' : ''} />
              {isPushing ? 'Envoi PUSH en cours...' : 'PUSH (Envoyer)'}
            </button>

            <button
              className="btn btn-secondary"
              onClick={() => handlePull(false)}
              disabled={isPushing || isPulling}
              style={{
                background: 'linear-gradient(135deg, #4f46e5 0%, #4338ca 100%)',
                borderColor: '#4338ca',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                padding: '0.75rem 1rem',
                fontWeight: 600
              }}
            >
              <Download size={18} className={isPulling ? 'spin' : ''} />
              {isPulling ? 'Téléchargement PULL...' : 'PULL (Télécharger)'}
            </button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', fontSize: '0.8rem' }}>
            <span>Écritures locales en attente d'envoi (PUSH) :</span>
            <span style={{
              background: syncStatus?.pendingCount > 0 ? '#fef3c7' : '#dcfce7',
              color: syncStatus?.pendingCount > 0 ? '#92400e' : '#166534',
              padding: '0.2rem 0.6rem',
              borderRadius: '1rem',
              fontWeight: 700
            }}>
              {syncStatus?.pendingCount || 0} en attente
            </span>
          </div>

          <div style={{ marginTop: '0.75rem', textAlign: 'right' }}>
            <button
              onClick={() => handlePull(true)}
              disabled={isPushing || isPulling}
              style={{ background: 'none', border: 'none', color: '#6366f1', textDecoration: 'underline', cursor: 'pointer', fontSize: '0.75rem' }}
            >
              ⚡ Forcer un PULL complet de toutes les tables
            </button>
          </div>
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
            <Save size={16} /> Enregistrer la Configuration Supabase
          </button>
        </div>

        {savedSupabase && (
          <div style={{ marginBottom: '1rem', color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', fontWeight: 500 }}>
            <CheckCircle size={16} /> Configuration Supabase mise à jour.
          </div>
        )}

        {lastActionResult && (
          <div style={{
            padding: '0.75rem',
            background: lastActionResult.status === 'success' ? '#ecfdf5' : '#fef2f2',
            borderRadius: 'var(--radius-md)',
            fontSize: '0.8rem',
            border: `1px solid ${lastActionResult.status === 'success' ? '#a7f3d0' : '#fecaca'}`,
            color: lastActionResult.status === 'success' ? '#065f46' : '#991b1b',
            marginBottom: '1rem'
          }}>
            <strong>{lastActionResult.message}</strong>
            {lastActionResult.details && (
              <div style={{ fontSize: '0.75rem', marginTop: '0.3rem', opacity: 0.9 }}>
                Détails : {JSON.stringify(lastActionResult.details)}
              </div>
            )}
          </div>
        )}

        {syncStatus && syncStatus.lastLog && (
          <div style={{ padding: '0.75rem', background: '#f1f5f9', borderRadius: 'var(--radius-md)', fontSize: '0.8rem', border: '1px solid var(--color-border)' }}>
            <div style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>
              Dernier journal : {syncStatus.lastLog.message} ({syncStatus.lastLog.timestamp || 'Récents'})
            </div>
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
                    const sqlText = `-- SCRIPT SUPABASE AGENT OHADA\nCREATE TABLE IF NOT EXISTS public.journal ( id UUID PRIMARY KEY, code_journal TEXT, poste_budgetaire TEXT, date TEXT, compte TEXT, compte_tiers TEXT, libelle TEXT, n_facture TEXT, reference TEXT, debit NUMERIC DEFAULT 0, credit NUMERIC DEFAULT 0, piece_id UUID, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() );\nCREATE TABLE IF NOT EXISTS public.tiers ( id UUID PRIMARY KEY, type TEXT, nom TEXT UNIQUE, compte_comptable TEXT, solde NUMERIC DEFAULT 0, statut TEXT, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() );\nCREATE TABLE IF NOT EXISTS public.exercices ( id UUID PRIMARY KEY, libelle TEXT NOT NULL, date_debut TEXT NOT NULL, date_fin TEXT NOT NULL, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() );\nCREATE TABLE IF NOT EXISTS public.chart_of_accounts ( compte TEXT PRIMARY KEY, libelle TEXT NOT NULL, source_doc_id BIGINT, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() );\nCREATE TABLE IF NOT EXISTS public.business_rules ( id UUID PRIMARY KEY, doc_id BIGINT, pattern TEXT NOT NULL, condition_type TEXT DEFAULT 'contains', target_account TEXT, target_journal TEXT, vat_rate NUMERIC DEFAULT 0, confidence_score NUMERIC DEFAULT 1.0, auto_learned INT DEFAULT 0, occurrences INT DEFAULT 1, description TEXT, is_active INT DEFAULT 1, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() );\nALTER TABLE public.journal ENABLE ROW LEVEL SECURITY;\nALTER TABLE public.tiers ENABLE ROW LEVEL SECURITY;\nALTER TABLE public.exercices ENABLE ROW LEVEL SECURITY;\nALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;\nALTER TABLE public.business_rules ENABLE ROW LEVEL SECURITY;\nCREATE POLICY "Allow anonymous read access" ON public.journal FOR SELECT USING (true);\nCREATE POLICY "Allow anonymous insert access" ON public.journal FOR INSERT WITH CHECK (true);\nCREATE POLICY "Allow anonymous update access" ON public.journal FOR UPDATE USING (true);\nCREATE POLICY "Allow anonymous read access" ON public.tiers FOR SELECT USING (true);\nCREATE POLICY "Allow anonymous insert access" ON public.tiers FOR INSERT WITH CHECK (true);\nCREATE POLICY "Allow anonymous update access" ON public.tiers FOR UPDATE USING (true);\nCREATE POLICY "Allow anonymous read access" ON public.exercices FOR SELECT USING (true);\nCREATE POLICY "Allow anonymous insert access" ON public.exercices FOR INSERT WITH CHECK (true);\nCREATE POLICY "Allow anonymous update access" ON public.exercices FOR UPDATE USING (true);\nCREATE POLICY "Allow anonymous read access" ON public.chart_of_accounts FOR SELECT USING (true);\nCREATE POLICY "Allow anonymous insert access" ON public.chart_of_accounts FOR INSERT WITH CHECK (true);\nCREATE POLICY "Allow anonymous update access" ON public.chart_of_accounts FOR UPDATE USING (true);\nCREATE POLICY "Allow anonymous read access" ON public.business_rules FOR SELECT USING (true);\nCREATE POLICY "Allow anonymous insert access" ON public.business_rules FOR INSERT WITH CHECK (true);\nCREATE POLICY "Allow anonymous update access" ON public.business_rules FOR UPDATE USING (true);`;
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
  id UUID PRIMARY KEY, code_journal TEXT, poste_budgetaire TEXT, date TEXT, compte TEXT, compte_tiers TEXT, libelle TEXT, n_facture TEXT, reference TEXT, debit NUMERIC DEFAULT 0, credit NUMERIC DEFAULT 0, piece_id UUID, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.tiers (
  id UUID PRIMARY KEY, type TEXT, nom TEXT UNIQUE, compte_comptable TEXT, solde NUMERIC DEFAULT 0, statut TEXT, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.exercices (
  id UUID PRIMARY KEY, libelle TEXT NOT NULL, date_debut TEXT NOT NULL, date_fin TEXT NOT NULL, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.chart_of_accounts (
  compte TEXT PRIMARY KEY, libelle TEXT NOT NULL, source_doc_id BIGINT, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.business_rules (
  id UUID PRIMARY KEY, doc_id BIGINT, pattern TEXT NOT NULL, condition_type TEXT DEFAULT 'contains', target_account TEXT, target_journal TEXT, vat_rate NUMERIC DEFAULT 0, confidence_score NUMERIC DEFAULT 1.0, auto_learned INT DEFAULT 0, occurrences INT DEFAULT 1, description TEXT, is_active INT DEFAULT 1, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
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
            <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 500, fontSize: '0.85rem' }}>Modèle & Cerveau d'IA par défaut</label>
            <select 
              className="input" 
              value={keys.DEFAULT_AI}
              onChange={e => setKeys({...keys, DEFAULT_AI: e.target.value})}
            >
              <option value="gemini">Google Gemini (Recommandé)</option>
              <option value="openai">OpenAI (GPT-4o, GPT-3.5, Custom Model)</option>
              <option value="deepseek">DeepSeek (Recommandé pour la comptabilité)</option>
              <option value="groq">Groq (Llama-3.3 70B ultra rapide)</option>
              <option value="openrouter">OpenRouter / Serveur LLM Personnalisé</option>
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

      {/* CARD : MODÈLE DSF OFFICIEL (DGI) */}
      <div className="card">
        <h3 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Database style={{ color: 'var(--color-primary)' }} />
          Modèle DSF Officiel (DGI)
        </h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1.25rem' }}>
          Si vous disposez du fichier Excel officiel de la DSF fourni par la DGI (mise en page exacte,
          74 onglets verrouillés), indiquez son chemin complet ci-dessous : l'export DSF y injectera
          automatiquement vos données. Sans ce fichier, l'export génère un classeur Excel autonome
          entièrement rempli avec les mêmes données, dans une mise en page simplifiée.
        </p>
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 500, fontSize: '0.85rem' }}>Chemin du fichier modèle (.xlsx)</label>
          <input
            type="text"
            className="input"
            value={dsfTemplatePath}
            onChange={e => setDsfTemplatePath(e.target.value)}
            placeholder="C:\Chemin\Vers\DSF_Normal_DGIFORMAT.xlsx"
          />
        </div>
        <button className="btn btn-primary" onClick={handleSaveDsf}>
          <Save size={16} /> Sauvegarder le modèle DSF
        </button>
        {savedDsf && (
          <div style={{ marginTop: '1rem', color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', fontWeight: 500 }}>
            <CheckCircle size={16} /> Chemin du modèle DSF enregistré !
          </div>
        )}
      </div>

      {/* CARD : DOSSIER COMPTABLE ACTIF (multi-entreprises façon Sage Saari, version web) */}
      {!isElectronApp && (
        <div className="card">
          <h3 style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FolderOpen style={{ color: 'var(--color-primary)' }} />
            Dossier Comptable Actif
          </h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1.25rem' }}>
            Chaque fichier .sqlite est un dossier comptable d'entreprise indépendant, comme dans Sage
            Saari. Ouvrez un fichier existant, créez-en un nouveau (base vide, plan comptable OHADA de
            base), ou basculez entre les dossiers déjà utilisés sur ce poste.
          </p>

          <div style={{ background: '#f8fafc', padding: '0.85rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', marginBottom: '1.25rem', fontSize: '0.85rem' }}>
            Dossier actif : <strong>{dbInfo && dbInfo.name ? dbInfo.name : '...'}</strong>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
            <button
              className="btn btn-secondary"
              disabled={isDbBusy}
              onClick={() => dbFileInputRef.current && dbFileInputRef.current.click()}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}
            >
              <FolderOpen size={16} /> Ouvrir un fichier comptable...
            </button>
            <input
              ref={dbFileInputRef}
              type="file"
              accept=".sqlite,.sqlite3,.db"
              style={{ display: 'none' }}
              onChange={handleOpenDbFile}
            />
            <a
              href="/api/db/download"
              download
              className="btn btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', textDecoration: 'none' }}
            >
              <Download size={16} /> Télécharger le dossier actif
            </a>
          </div>

          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 500, fontSize: '0.85rem' }}>Créer un nouveau dossier comptable</label>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <input
                type="text"
                className="input"
                value={newDbName}
                onChange={e => setNewDbName(e.target.value)}
                placeholder="Nom de l'entreprise"
                style={{ flex: 1 }}
              />
              <button className="btn btn-primary" onClick={handleCreateDb} disabled={isDbBusy || !newDbName.trim()}>
                <FilePlus size={16} /> Créer
              </button>
            </div>
            <input
              type="text"
              className="input"
              value={newDbFolder}
              onChange={e => setNewDbFolder(e.target.value)}
              placeholder={dbInfo && dbInfo.defaultFolder ? `Emplacement (optionnel) - vide = ${dbInfo.defaultFolder}` : 'Emplacement (optionnel) - dossier complet, ex : C:\\Comptes\\MonEntreprise'}
              style={{ fontSize: '0.8rem' }}
            />
          </div>

          {dbList.length > 0 && (
            <div>
              <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 500, fontSize: '0.85rem' }}>Dossiers comptables déjà utilisés sur ce poste</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {dbList.map(f => (
                  <div key={f.path} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0.75rem', background: f.active ? '#ecfdf5' : '#f8fafc', border: `1px solid ${f.active ? '#a7f3d0' : 'var(--color-border)'}`, borderRadius: 'var(--radius-md)', fontSize: '0.85rem' }}>
                    <span>
                      {f.name} {f.active && <strong style={{ color: 'var(--color-success)' }}>(actif)</strong>}
                      <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>{f.folder}</div>
                    </span>
                    {!f.active && (
                      <button
                        className="btn btn-secondary"
                        disabled={isDbBusy}
                        onClick={() => handleSwitchDb(f.path, f.name)}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                      >
                        <FolderSync size={14} /> Basculer
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {dbActionMsg && (
            <div style={{
              marginTop: '1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.85rem',
              fontWeight: 500,
              color: dbActionMsg.type === 'success' ? 'var(--color-success)' : '#dc2626'
            }}>
              {dbActionMsg.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
              {dbActionMsg.text}
            </div>
          )}
        </div>
      )}

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

      {/* MODAL DE PROGRESSION SYNCHRONISATION TEMPS RÉEL */}
      <SyncProgressModal
        isOpen={showSyncModal}
        type={syncModalType}
        onClose={() => setShowSyncModal(false)}
      />
    </div>
  );
};
