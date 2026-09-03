import { useState, useRef, useEffect } from 'react'
import './App.css'
import { LayoutDashboard, MessageSquare, FileText, Users, Landmark, Calculator, Settings, Bell, Search, BrainCircuit, Mic, Database, ShieldAlert, TrendingUp, ChevronDown, Plus, CalendarRange, RotateCcw, ArrowLeft, Trash2, PieChart } from 'lucide-react'

// Import Modules
import { TiersModule } from './modules/TiersModule';
import { TresoModule } from './modules/TresoModule';
import { FiscaliteModule } from './modules/FiscaliteModule';
import { SettingsModule } from './modules/SettingsModule';
import { ImportModule } from './modules/ImportModule';
import { ComptabiliteModule } from './modules/ComptabiliteModule';
import { AuditModule } from './modules/AuditModule';
import { MemoryModule } from './modules/MemoryModule';
import { AnalyseFinanciereModule } from './modules/AnalyseFinanciereModule';
import { BudgetModule } from './modules/BudgetModule';
import { CashForecastModule } from './modules/CashForecastModule';
import { fetchDirectDashboardStats, fetchDirectSupabaseExercices } from './utils/supabaseClient';
import { adminFetch } from './utils/adminAuth';

// Sélecteur d'exercice comptable, visible en permanence dans le header : l'exercice actif est
// une sélection globale côté serveur (voir server/index.js getActiveExercice), donc changer de
// sélection ici ne fait que notifier le parent (qui force un remount des modules via `key`) —
// aucune donnée d'exercice n'a besoin d'être transmise aux modules eux-mêmes.
const ExerciceSelector = ({ onChange }) => {
  const [exercices, setExercices] = useState([]);
  const [active, setActive] = useState(null);
  const [open, setOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ libelle: '', date_debut: '', date_fin: '' });
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const [listRes, activeRes] = await Promise.all([
        fetch('/api/exercices').then(r => r.ok ? r.json() : []).catch(() => []),
        fetch('/api/exercices/active').then(r => r.ok ? r.json() : null).catch(() => null)
      ]);
      if (Array.isArray(listRes) && listRes.length > 0) {
        setExercices(listRes);
      } else {
        const directEx = await fetchDirectSupabaseExercices();
        setExercices(Array.isArray(directEx) ? directEx : []);
      }
      setActive(activeRes || null);
    } catch (e) {
      console.warn("Exercice load fallback:", e);
      const directEx = await fetchDirectSupabaseExercices();
      setExercices(Array.isArray(directEx) ? directEx : []);
    }
  };

  useEffect(() => { load(); }, []);

  const select = async (id) => {
    try {
      await fetch('/api/exercices/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id || '' })
      });
      setOpen(false);
      await load();
      onChange && onChange(id || null);
    } catch (e) {
      console.error(e);
    }
  };

  const deleteExercice = async (e, ex) => {
    e.stopPropagation();
    if (!window.confirm(`Supprimer l'exercice "${ex.libelle}" (${ex.date_debut} → ${ex.date_fin}) ? Les écritures elles-mêmes ne sont pas supprimées, seul le regroupement par exercice l'est.`)) return;
    try {
      await fetch(`/api/exercices/${ex.id}`, { method: 'DELETE' });
      const wasActive = active && active.id === ex.id;
      await load();
      if (wasActive) onChange && onChange(null);
    } catch (e) {
      console.error(e);
    }
  };

  const createExercice = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.libelle || !form.date_debut || !form.date_fin) {
      setError('Tous les champs sont obligatoires.');
      return;
    }
    try {
      const res = await fetch('/api/exercices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (data.success) {
        setForm({ libelle: '', date_debut: '', date_fin: '' });
        setShowForm(false);
        await select(data.id);
      } else {
        setError(data.error || 'Erreur lors de la création.');
      }
    } catch (e) {
      setError('Connexion au serveur impossible.');
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        className="btn btn-secondary"
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
        title="Exercice comptable actif — filtre les états financiers, la Balance, le Grand Livre, les Tiers et le Dashboard"
      >
        <CalendarRange size={16} />
        {active ? active.libelle : 'Tous les exercices'}
        <ChevronDown size={14} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 0.5rem)', right: 0, zIndex: 100,
          background: 'white', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-md)', minWidth: '260px', padding: '0.5rem'
        }}>
          <button
            onClick={() => select(null)}
            style={{ width: '100%', textAlign: 'left', padding: '0.5rem 0.75rem', background: !active ? 'rgba(59,130,246,0.1)' : 'transparent', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.85rem' }}
          >
            Tous les exercices (aucun filtre)
          </button>
          {exercices.map(ex => (
            <div
              key={ex.id}
              style={{ display: 'flex', alignItems: 'stretch', gap: '0.25rem', background: active && active.id === ex.id ? 'rgba(59,130,246,0.1)' : 'transparent', borderRadius: 'var(--radius-sm)' }}
            >
              <button
                onClick={() => select(ex.id)}
                style={{ flex: 1, textAlign: 'left', padding: '0.5rem 0.75rem', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '0.85rem' }}
              >
                {ex.libelle} <span style={{ color: 'var(--color-text-muted)' }}>({ex.date_debut} → {ex.date_fin})</span>
              </button>
              <button
                onClick={(e) => deleteExercice(e, ex)}
                title="Supprimer cet exercice"
                style={{ display: 'flex', alignItems: 'center', padding: '0 0.6rem', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}
                onMouseEnter={ev => ev.currentTarget.style.color = 'var(--color-error)'}
                onMouseLeave={ev => ev.currentTarget.style.color = 'var(--color-text-muted)'}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}

          <div style={{ borderTop: '1px solid var(--color-border)', marginTop: '0.5rem', paddingTop: '0.5rem' }}>
            {!showForm ? (
              <button
                onClick={() => setShowForm(true)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.75rem', background: 'transparent', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--color-primary)', fontWeight: 500 }}
              >
                <Plus size={14} /> Nouvel exercice
              </button>
            ) : (
              <form onSubmit={createExercice} style={{ padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <input className="input" placeholder="Libellé (ex: Exercice 2026)" value={form.libelle} onChange={e => setForm({ ...form, libelle: e.target.value })} style={{ padding: '0.4rem', fontSize: '0.8rem' }} />
                <input className="input" type="date" value={form.date_debut} onChange={e => setForm({ ...form, date_debut: e.target.value })} style={{ padding: '0.4rem', fontSize: '0.8rem' }} />
                <input className="input" type="date" value={form.date_fin} onChange={e => setForm({ ...form, date_fin: e.target.value })} style={{ padding: '0.4rem', fontSize: '0.8rem' }} />
                {error && <span style={{ color: 'var(--color-error)', fontSize: '0.75rem' }}>{error}</span>}
                <button type="submit" className="btn btn-primary" style={{ padding: '0.4rem', fontSize: '0.8rem' }}>Créer et sélectionner</button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const SyncHeaderStatus = ({ onClickSettings }) => {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    const check = () => {
      fetch('/api/sync/status')
        .then(r => r.json())
        .then(d => setStatus(d))
        .catch(e => console.error(e));
    };
    check();
    const interval = setInterval(check, 10000);
    return () => clearInterval(interval);
  }, []);

  if (!status) return null;

  if (!status.autoSync) {
    return (
      <div 
        onClick={onClickSettings}
        style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.35rem 0.75rem', borderRadius: '12px', background: '#f1f5f9', border: '1px solid #cbd5e1', fontSize: '0.75rem', fontWeight: 600, color: '#475569', cursor: 'pointer' }}
        title="La synchronisation automatique est désactivée. Cliquez pour ouvrir les Paramètres."
      >
        🔒 Mode 100% Local
      </div>
    );
  }

  if (!status.url || !status.hasKey) {
    return (
      <div 
        onClick={onClickSettings}
        style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.35rem 0.75rem', borderRadius: '12px', background: '#fffbe5', border: '1px solid #fef3c7', fontSize: '0.75rem', fontWeight: 600, color: '#b45309', cursor: 'pointer' }}
        title="Supabase non configuré. Cliquez pour paramétrer."
      >
        ⚠️ Supabase non configuré
      </div>
    );
  }

  const isPending = status.pendingCount > 0;
  return (
    <div 
      onClick={onClickSettings}
      style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.35rem 0.75rem', borderRadius: '12px', background: isPending ? '#fff7ed' : '#f0fdf4', border: `1px solid ${isPending ? '#ffedd5' : '#bbf7d0'}`, fontSize: '0.75rem', fontWeight: 600, color: isPending ? '#c2410c' : '#15803d', cursor: 'pointer' }}
      title={isPending ? `${status.pendingCount} écriture(s) locale(s) en attente de synchronisation` : 'Données locales entièrement synchronisées avec Supabase'}
    >
      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: isPending ? '#f97316' : '#22c55e', display: 'inline-block' }}></span>
      {isPending ? `🔴 ${status.pendingCount} en attente` : '🟢 Synchronisé avec Supabase'}
    </div>
  );
};

const defaultWelcomeMessage = [
  { role: 'assistant', text: "Bonjour ! Je suis votre Agent Comptable OHADA 🤖.\n\nJe suis prêt à analyser vos comptes, lettrer vos factures, rapprocher vos banques et préparer vos déclarations fiscales. Que souhaitez-vous faire aujourd'hui ?" }
];

// `messages`/`input`/`loading` sont levés dans App() (voir plus bas) et passés en props : App ne
// démonte jamais, contrairement à ce composant qui disparaît dès qu'on change de module dans la
// sidebar. Sans ça, une réponse IA qui arrive après que l'utilisateur a changé de page se heurtait
// à un setState sur un composant démonté (no-op silencieux) et était perdue.
const ChatbotIA = ({ messages, setMessages, input, setInput, loading, setLoading }) => {
  const messagesEndRef = useRef(null);
  const chatInputRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Redonne la main au champ de saisie à l'arrivée sur ce composant : `autoFocus` seul suffit en
  // théorie (ce composant est démonté/remonté à chaque changement de module), mais un focus
  // explicite est plus fiable dans un onglet navigateur classique (par opposition à l'app
  // Electron), où l'attribut HTML autoFocus est parfois silencieusement ignoré.
  useEffect(() => {
    chatInputRef.current?.focus();
  }, []);

  const handleResetChat = () => {
    if (window.confirm("Voulez-vous réinitialiser la discussion et démarrer une nouvelle conversation ?")) {
      setMessages(defaultWelcomeMessage);
      try {
        localStorage.removeItem('agent_ohada_chat_history');
      } catch (e) {}
      // window.confirm() est bloquant et rend la main au document une fois fermé, pas forcément
      // au champ de saisie : sans ce refocus explicite, l'utilisateur devait recliquer dans le
      // champ avant de pouvoir retaper quoi que ce soit après une réinitialisation.
      setTimeout(() => chatInputRef.current?.focus(), 50);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    
    const userMsg = input.trim();
    const currentHistory = [...messages, { role: 'user', text: userMsg }];
    
    setMessages(currentHistory);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: userMsg,
          history: currentHistory.map(m => ({
            role: m.role,
            content: m.text
          }))
        })
      });
      const data = await res.json();
      if (data && data.response) {
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          text: data.response,
          proposal: data.proposal,
          status: data.proposal ? 'pending' : null
        }]);
      } else if (data && data.error) {
        setMessages(prev => [...prev, { role: 'assistant', text: `Erreur retournée par l'API : ${data.error}` }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', text: "Erreur de communication avec l'IA." }]);
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', text: "Impossible de joindre le serveur. Le backend est-il démarré ?" }]);
    } finally {
      setLoading(false);
      setTimeout(() => chatInputRef.current?.focus(), 100);
    }
  };

  const handleApprove = async (index, sql) => {
    try {
      const res = await adminFetch('/api/audit/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql })
      });
      const data = await res.json();
      if (data.success) {
        setMessages(prev => prev.map((msg, i) => i === index ? { ...msg, status: 'approved' } : msg));
      } else {
        alert(`Erreur lors de l'exécution : ${data.error}`);
      }
    } catch (err) {
      alert("Erreur de connexion avec le serveur.");
    }
  };

  const handleReject = (index) => {
    setMessages(prev => prev.map((msg, i) => i === index ? { ...msg, status: 'rejected' } : msg));
  };

  return (
    <div className="card" style={{ height: 'calc(100vh - 150px)', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
      {/* Top Header Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.85rem 1.25rem', background: '#f8fafc', borderBottom: '1px solid var(--color-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, color: 'var(--color-primary-dark)', fontSize: '0.95rem' }}>
          <BrainCircuit size={20} color="var(--color-primary)" />
          Cerveau IA - Assistant Comptable OHADA
        </div>

        <button
          className="btn btn-secondary"
          onClick={handleResetChat}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', background: '#ffffff', borderColor: '#cbd5e1', color: 'var(--color-text-main)', fontWeight: 600 }}
          title="Effacer la discussion en cours et démarrer une nouvelle conversation"
        >
          <RotateCcw size={14} /> 🔄 Nouvelle Discussion
        </button>
      </div>

      <div style={{ flex: 1, padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {messages.map((msg, idx) => (
          <div key={idx} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{ 
              background: msg.role === 'user' ? 'rgba(255,255,255,0.95)' : 'rgba(241, 245, 249, 0.85)', 
              color: 'var(--color-text-main)', 
              padding: '1rem 1.25rem', 
              borderRadius: '1.25rem', 
              borderBottomRightRadius: msg.role === 'user' ? '0.25rem' : '1.25rem',
              borderBottomLeftRadius: msg.role === 'assistant' ? '0.25rem' : '1.25rem',
              maxWidth: '85%', 
              lineHeight: 1.6,
              boxShadow: '0 2px 5px rgba(0,0,0,0.02)',
              border: msg.role === 'user' ? '1px solid rgba(0,0,0,0.05)' : '1px solid rgba(var(--color-primary), 0.1)',
              whiteSpace: 'pre-wrap',
              backdropFilter: 'blur(10px)'
            }}>
              <div>{msg.text}</div>
              
              {msg.proposal && (
                <div style={{
                  marginTop: '1rem',
                  padding: '1rem',
                  background: 'rgba(15, 23, 42, 0.05)',
                  border: '1px solid rgba(15, 23, 42, 0.1)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '0.9rem'
                }}>
                  <div style={{ fontWeight: 600, color: 'var(--color-primary-dark)', display: 'flex', alignItems: 'center', gap: '0.25rem', marginBottom: '0.5rem' }}>
                    📌 Proposition de modification SQL
                  </div>
                  <code style={{ display: 'block', padding: '0.5rem', background: '#0f172a', color: '#f8fafc', borderRadius: '4px', fontFamily: 'monospace', marginBottom: '0.75rem', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
                    {msg.proposal.sql}
                  </code>
                  
                  {msg.status === 'pending' && (
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button 
                        onClick={() => handleApprove(idx, msg.proposal.sql)}
                        className="btn btn-primary"
                        style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                      >
                        ✔️ Approuver & Exécuter
                      </button>
                      <button 
                        onClick={() => handleReject(idx)}
                        className="btn btn-secondary"
                        style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)' }}
                      >
                        ❌ Rejeter
                      </button>
                    </div>
                  )}

                  {msg.status === 'approved' && (
                    <div style={{ color: '#16a34a', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      ✔️ Modification exécutée avec succès en base de données.
                    </div>
                  )}

                  {msg.status === 'rejected' && (
                    <div style={{ color: '#dc2626', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      ❌ Proposition rejetée.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{ background: 'rgba(241, 245, 249, 0.85)', color: 'var(--color-text-main)', padding: '1rem', borderRadius: '1.25rem', borderBottomLeftRadius: '0.25rem', border: '1px solid rgba(var(--color-primary), 0.1)' }}>
              Analyse en cours...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <div style={{ padding: '1.25rem', display: 'flex', gap: '0.75rem', alignItems: 'center', background: 'rgba(255,255,255,0.5)', backdropFilter: 'blur(10px)', borderTop: '1px solid rgba(255,255,255,0.5)' }}>
        <button className="btn" style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.8)', borderRadius: '50%' }}>
          <Mic size={20} color="var(--color-text-muted)" />
        </button>
        <textarea
          ref={chatInputRef}
          className="input"
          placeholder="Posez une question sur vos finances... (Maj+Entrée pour aller à la ligne)"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
            // Maj+Entrée : comportement natif du textarea (saut de ligne), rien à faire ici.
          }}
          rows={2}
          style={{ flex: 1, resize: 'none', maxHeight: '140px', overflowY: 'auto', fontFamily: 'inherit', lineHeight: 1.4 }}
          autoFocus
        />
        <button className="btn btn-primary" onClick={handleSend} disabled={loading} style={{ minWidth: '100px' }}>
          {loading ? 'Analyse...' : 'Envoyer'}
        </button>
      </div>
    </div>
  );
};

const Dashboard = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/dashboard/stats');
        if (res.ok) {
          const data = await res.json();
          if (data && typeof data.tresorerie === 'number') {
            setStats(data);
            setLoading(false);
            return;
          }
        }
      } catch (err) {
        console.warn("Erreur API stats dashboard, bascule sur Supabase direct:", err);
      }

      // Repli direct via le client Supabase (pour Vercel / hors-ligne)
      try {
        const directData = await fetchDirectDashboardStats();
        if (directData) {
          setStats(directData);
          setLoading(false);
          return;
        }
      } catch (directErr) {
        console.error("Erreur direct Supabase stats:", directErr);
      }

      // Valeurs par défaut sécurisées
      setStats({
        tresorerie: 0,
        dettes: 0,
        factures_fournisseurs: 0,
        creances: 0,
        factures_clients: 0,
        ca: 0,
        charges: 0
      });
      setLoading(false);
    };
    fetchStats();
  }, []);

  if (loading) {
    return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>Chargement de la vue d'ensemble...</div>;
  }

  const safeStats = stats || {
    tresorerie: 0,
    dettes: 0,
    factures_fournisseurs: 0,
    creances: 0,
    factures_clients: 0,
    ca: 0,
    charges: 0
  };

  const result = safeStats.ca - safeStats.charges;
  const marginPercent = safeStats.ca > 0 ? Math.round((result / safeStats.ca) * 100) : 0;

  return (
    <>
      <div className="module-grid">
        <div className="card stat-card" style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)', color: 'white', border: 'none' }}>
          <span className="stat-title" style={{ color: 'rgba(255,255,255,0.8)' }}>Trésorerie Globale (Toutes Banques)</span>
          <span className="stat-value" style={{ color: 'white' }}>{safeStats.tresorerie.toLocaleString()} FCFA</span>
          <span style={{ color: safeStats.tresorerie >= 0 ? 'rgba(209, 250, 229, 0.9)' : '#fca5a5', fontSize: '0.875rem', fontWeight: 500 }}>
            {safeStats.tresorerie >= 0 ? 'Situation saine' : 'Trésorerie déficitaire'}
          </span>
        </div>
        
        <div className="card stat-card">
          <span className="stat-title">Dettes Fournisseurs (401)</span>
          <span className="stat-value">{safeStats.dettes.toLocaleString()} FCFA</span>
          <span style={{ color: safeStats.factures_fournisseurs > 0 ? 'var(--color-error)' : 'var(--color-success)', fontSize: '0.875rem', fontWeight: 500 }}>
            {safeStats.factures_fournisseurs} facture(s) enregistrée(s)
          </span>
        </div>
        
        <div className="card stat-card">
          <span className="stat-title">Créances Clients (411)</span>
          <span className="stat-value">{safeStats.creances.toLocaleString()} FCFA</span>
          <span style={{ color: safeStats.factures_clients > 0 ? 'var(--color-warning)' : 'var(--color-success)', fontSize: '0.875rem', fontWeight: 500 }}>
            {safeStats.factures_clients} facture(s) en attente
          </span>
        </div>
      </div>

      <div className="card" style={{ padding: '2rem' }}>
        <h4 style={{ marginBottom: '1.5rem', color: 'var(--color-text-main)', fontSize: '1.25rem', fontWeight: 600 }}>Synthèse Financière Réelle</h4>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
          <div style={{ background: 'var(--color-bg-light)', padding: '1.5rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
            <span style={{ display: 'block', fontSize: '0.875rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>Chiffre d'Affaires (Ventes 70)</span>
            <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--color-success)' }}>{safeStats.ca.toLocaleString()} FCFA</span>
          </div>
          
          <div style={{ background: 'var(--color-bg-light)', padding: '1.5rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
            <span style={{ display: 'block', fontSize: '0.875rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>Charges d'Exploitation (Classe 6)</span>
            <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--color-error)' }}>{safeStats.charges.toLocaleString()} FCFA</span>
          </div>

          <div style={{ background: 'var(--color-bg-light)', padding: '1.5rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
            <span style={{ display: 'block', fontSize: '0.875rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>Marge / Résultat Net Brut</span>
            <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: result >= 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
              {result.toLocaleString()} FCFA
            </span>
            <span style={{ display: 'block', fontSize: '0.75rem', marginTop: '0.25rem', color: 'var(--color-text-muted)' }}>
              Taux de marge : {marginPercent}%
            </span>
          </div>
        </div>

        <p style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', textAlign: 'center' }}>
          ⚡ Les calculs ci-dessus sont synchronisés en temps réel à partir de votre journal général d'écritures.
        </p>
      </div>
    </>
  );
};



function App() {
  const [activeModule, setActiveModule] = useState('ia');
  const [activeExerciceId, setActiveExerciceId] = useState(null);
  // État du chat Cerveau IA, levé ici (plutôt que local à ChatbotIA) pour qu'il survive à un
  // changement de module pendant qu'une réponse est encore en cours de chargement.
  const [chatMessages, setChatMessages] = useState(() => {
    try {
      const saved = localStorage.getItem('agent_ohada_chat_history');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.error("Error reading chat history:", e);
    }
    return defaultWelcomeMessage;
  });
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem('agent_ohada_chat_history', JSON.stringify(chatMessages));
    } catch (e) {
      console.error("Error saving chat history:", e);
    }
  }, [chatMessages]);
  // État levé pour la navigation croisée entre modules (ex: un lien "Voir le Bilan" ou "Grand
  // Livre" depuis la Fiscalité, qui doit arriver sur le bon onglet de Compta & États Financiers) —
  // évite de dupliquer ces vues, chaque module reste la seule source de vérité pour son affichage.
  const [comptaInitialTab, setComptaInitialTab] = useState(null);
  // Pile de navigation pour le bouton "Retour" : mémorise, à chaque changement de page, la page
  // quittée (et son onglet Compta courant s'il s'agit de "saisie") pour pouvoir y revenir à
  // l'identique — sans ça, un lien croisé (ex: Fiscalité -> Bilan) est un aller simple, l'utilisateur
  // doit recliquer manuellement dans la sidebar pour revenir là où il était.
  const [navHistory, setNavHistory] = useState([]);

  const navigateTo = (moduleId, opts = {}) => {
    if (moduleId !== activeModule) {
      setNavHistory(h => [...h, { moduleId: activeModule, tab: activeModule === 'saisie' ? comptaInitialTab : null }]);
    }
    if (opts.tab !== undefined) setComptaInitialTab(opts.tab);
    setActiveModule(moduleId);
  };

  const goBack = () => {
    setNavHistory(h => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setComptaInitialTab(prev.tab);
      setActiveModule(prev.moduleId);
      return h.slice(0, -1);
    });
  };

  // Changer d'exercice ne fait pas redescendre de dates dans les modules : ils continuent
  // d'appeler les mêmes routes qu'avant (déjà filtrées côté serveur). On force juste un
  // remount du module actif via `key` pour qu'il relance son fetch initial.
  const moduleKey = `${activeModule}-${activeExerciceId || 'all'}`;

  const renderContent = () => {
    switch (activeModule) {
      case 'dashboard': return <Dashboard key={moduleKey} />;
      case 'ia': return <ChatbotIA
        messages={chatMessages} setMessages={setChatMessages}
        input={chatInput} setInput={setChatInput}
        loading={chatLoading} setLoading={setChatLoading}
      />;
      case 'saisie': return <ComptabiliteModule key={moduleKey} initialTab={comptaInitialTab} onTabChange={setComptaInitialTab} />;
      case 'tiers': return <TiersModule key={moduleKey} />;
      case 'treso': return <TresoModule key={moduleKey} />;
      case 'fiscalite': return <FiscaliteModule key={moduleKey} onNavigate={navigateTo} />;
      case 'import': return <ImportModule key={moduleKey} />;
      case 'audit': return <AuditModule key={moduleKey} />;
      case 'memory': return <MemoryModule key={moduleKey} />;
      case 'forecast': return <CashForecastModule key={moduleKey} />;
      case 'budget': return <BudgetModule key={moduleKey} />;
      case 'analyse': return <AnalyseFinanciereModule key={moduleKey} />;
      case 'settings': return <SettingsModule key={moduleKey} />;
      default: return (
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <h2>Module en cours de développement</h2>
        </div>
      );
    }
  }

  const navItems = [
    { id: 'ia', label: 'Cerveau IA (Chat)', icon: <MessageSquare className="nav-icon" /> },
    { id: 'memory', label: 'Mémoire Métier (Brain)', icon: <BrainCircuit className="nav-icon" /> },
    { id: 'forecast', label: 'Plan de Trésorerie (Forecast)', icon: <Landmark className="nav-icon" /> },
    { id: 'budget', label: 'Contrôle Budgétaire', icon: <PieChart className="nav-icon" /> },
    { id: 'analyse', label: 'Analyse Financière & KPIs', icon: <TrendingUp className="nav-icon" /> },
    { id: 'dashboard', label: 'Vue d\'ensemble', icon: <LayoutDashboard className="nav-icon" /> },
    { id: 'saisie', label: 'Compta & États Financiers', icon: <FileText className="nav-icon" /> },
    { id: 'tiers', label: 'Gestion des Tiers', icon: <Users className="nav-icon" /> },
    { id: 'treso', label: 'Trésorerie & Banque', icon: <Landmark className="nav-icon" /> },
    { id: 'fiscalite', label: 'Fiscalité & Reporting', icon: <Calculator className="nav-icon" /> },
    { id: 'import', label: 'Importation de Données', icon: <Database className="nav-icon" /> },
    { id: 'audit', label: 'Audit OHADA', icon: <ShieldAlert className="nav-icon" /> },
  ];

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <BrainCircuit size={32} color="var(--color-primary)" />
            Agent OHADA
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '0.25rem', fontWeight: 500 }}>Intelligence Comptable V2</div>
        </div>
        
        <nav className="sidebar-nav">
          {navItems.map(item => (
            <button
              key={item.id}
              className={`nav-item ${activeModule === item.id ? 'active' : ''}`}
              onClick={() => navigateTo(item.id)}
              style={{ position: 'relative' }}
            >
              {item.icon}
              {item.label}
              {item.id === 'ia' && chatLoading && activeModule !== 'ia' && (
                <span
                  title="Le Cerveau IA analyse toujours en arrière-plan"
                  style={{
                    position: 'absolute', right: '0.9rem', top: '50%', transform: 'translateY(-50%)',
                    width: '8px', height: '8px', borderRadius: '50%',
                    background: 'var(--color-primary)', animation: 'pulse 1.4s ease-in-out infinite'
                  }}
                />
              )}
            </button>
          ))}
        </nav>
        
        <div className="sidebar-footer">
          <button className={`nav-item ${activeModule === 'settings' ? 'active' : ''}`} onClick={() => navigateTo('settings')}>
            <Settings className="nav-icon" />
            Paramétrage IA
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <header className="header">
          <div className="header-title" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {navHistory.length > 0 && (
              <button
                className="btn btn-secondary"
                onClick={goBack}
                title="Retour à la page précédente"
                style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.4rem 0.7rem', fontSize: '0.8rem' }}
              >
                <ArrowLeft size={16} /> Retour
              </button>
            )}
            {navItems.find(i => i.id === activeModule)?.label || 'Paramètres'}
          </div>

          <div className="header-actions">
            <ExerciceSelector onChange={setActiveExerciceId} />
            <SyncHeaderStatus onClickSettings={() => navigateTo('settings')} />

            <div className="search-bar" style={{ position: 'relative' }}>
              <Search size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
              <input type="text" className="input" placeholder="Rechercher une écriture..." style={{ paddingLeft: '2.75rem', width: '300px' }} />
            </div>

            <button className="btn btn-secondary" style={{ padding: '0.6rem', borderRadius: '50%' }}>
              <Bell size={20} />
            </button>
            
            <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'var(--color-primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '1.1rem', boxShadow: 'var(--shadow-sm)' }}>
              AC
            </div>
          </div>
        </header>
        
        <div className="content-area">
          {renderContent()}
        </div>
      </main>
    </div>
  )
}

export default App
