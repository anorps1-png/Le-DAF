import { useState, useRef, useEffect } from 'react'
import './App.css'
import { LayoutDashboard, MessageSquare, FileText, Users, Landmark, Calculator, Settings, Bell, Search, BrainCircuit, Mic, Database, ShieldAlert } from 'lucide-react'

// Import Modules
import { TiersModule } from './modules/TiersModule';
import { TresoModule } from './modules/TresoModule';
import { FiscaliteModule } from './modules/FiscaliteModule';
import { SettingsModule } from './modules/SettingsModule';
import { ImportModule } from './modules/ImportModule';
import { ComptabiliteModule } from './modules/ComptabiliteModule';
import { AuditModule } from './modules/AuditModule';

const ChatbotIA = () => {
  const [messages, setMessages] = useState([
    { role: 'assistant', text: "Bonjour ! Je suis votre Agent Comptable OHADA 🤖.\n\nJe suis prêt à analyser vos comptes, lettrer vos factures, rapprocher vos banques et préparer vos déclarations fiscales. Que souhaitez-vous faire aujourd'hui ?" }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;
    
    const userMsg = input;
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('http://localhost:3001/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg })
      });
      const data = await res.json();
      if (data.response) {
        setMessages(prev => [...prev, { role: 'assistant', text: data.response }]);
      } else if (data.error) {
        setMessages(prev => [...prev, { role: 'assistant', text: `Erreur retournée par l'API : ${data.error}` }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', text: "Erreur de communication avec l'IA." }]);
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', text: "Impossible de joindre le serveur. Le backend est-il démarré ?" }]);
    }
    setLoading(false);
  };

  return (
    <div className="card" style={{ height: 'calc(100vh - 150px)', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
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
              {msg.text}
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
        <input 
          type="text" 
          className="input" 
          placeholder="Posez une question sur vos finances..." 
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyPress={e => e.key === 'Enter' && handleSend()}
          style={{ flex: 1 }} 
        />
        <button className="btn btn-primary" onClick={handleSend} disabled={loading}>Envoyer</button>
      </div>
    </div>
  );
};

const Dashboard = () => {
  return (
    <>
      <div className="module-grid">
        <div className="card stat-card" style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)', color: 'white', border: 'none' }}>
          <span className="stat-title" style={{ color: 'rgba(255,255,255,0.8)' }}>Trésorerie Globale (Toutes Banques)</span>
          <span className="stat-value" style={{ color: 'white' }}>15 450 000 FCFA</span>
          <span style={{ color: 'rgba(209, 250, 229, 0.9)', fontSize: '0.875rem', fontWeight: 500 }}>Situation saine</span>
        </div>
        <div className="card stat-card">
          <span className="stat-title">Dettes Fournisseurs (401xxx)</span>
          <span className="stat-value">4 230 000 FCFA</span>
          <span style={{ color: 'var(--color-error)', fontSize: '0.875rem', fontWeight: 500 }}>12 factures en attente</span>
        </div>
        <div className="card stat-card">
          <span className="stat-title">Créances Clients (411xxx)</span>
          <span className="stat-value">8 900 000 FCFA</span>
          <span style={{ color: 'var(--color-warning)', fontSize: '0.875rem', fontWeight: 500 }}>Besoin de recouvrement</span>
        </div>
      </div>
      <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
        <p style={{ fontSize: '1.25rem', marginBottom: '0.5rem', color: 'var(--color-text-main)', fontWeight: 600 }}>Synthèse Financière</p>
        Tableau de bord de performance (Chiffre d'Affaires, Marge, BFR) généré en temps réel par l'Agent OHADA.
      </div>
    </>
  );
};



function App() {
  const [activeModule, setActiveModule] = useState('ia');

  const renderContent = () => {
    switch (activeModule) {
      case 'dashboard': return <Dashboard />;
      case 'ia': return <ChatbotIA />;
      case 'saisie': return <ComptabiliteModule />;
      case 'tiers': return <TiersModule />;
      case 'treso': return <TresoModule />;
      case 'fiscalite': return <FiscaliteModule />;
      case 'import': return <ImportModule />;
      case 'audit': return <AuditModule />;
      case 'settings': return <SettingsModule />;
      default: return (
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <h2>Module en cours de développement</h2>
        </div>
      );
    }
  }

  const navItems = [
    { id: 'ia', label: 'Cerveau IA (Chat)', icon: <MessageSquare className="nav-icon" /> },
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
              onClick={() => setActiveModule(item.id)}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>
        
        <div className="sidebar-footer">
          <button className={`nav-item ${activeModule === 'settings' ? 'active' : ''}`} onClick={() => setActiveModule('settings')}>
            <Settings className="nav-icon" />
            Paramétrage IA
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <header className="header">
          <div className="header-title">
            {navItems.find(i => i.id === activeModule)?.label || 'Paramètres'}
          </div>
          
          <div className="header-actions">
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
