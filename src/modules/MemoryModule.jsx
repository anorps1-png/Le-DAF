import { useState, useEffect } from 'react';
import { 
  BrainCircuit, FileText, UploadCloud, Plus, Trash2, 
  ToggleLeft, ToggleRight, Search, Sparkles, Cpu, CheckCircle2, 
  AlertCircle, RefreshCw, BookOpen, SlidersHorizontal, Lightbulb
} from 'lucide-react';

const ACCOUNT_LABELS = {
  '601100': 'Achats de Marchandises',
  '602100': 'Achats de Matières Premières & Intrants',
  '603100': 'Produits Pharmaceutiques & Médicaments',
  '603200': 'Dispositifs & Matériels Médicaux Consommables',
  '603300': 'Achats d\'Oxygène & Gaz Médicaux',
  '605100': 'Fournitures de Bureau & Linge Médical',
  '605200': 'Achats d\'Énergie & Carburants (Total, CIE, SODECI)',
  '622100': 'Honoraires Médecins, Avocats & Spécialistes',
  '623100': 'Publicité, Marketing & Communication',
  '625100': 'Voyages, Déplacements & Missions',
  '627100': 'Frais Bancaires & Commissions',
  '628100': 'Télécommunications & Internet (Orange, MTN, Fibre)',
  '631100': 'Primes d\'Assurances',
  '632100': 'Loyers & Charges Locatives',
  '638100': 'Entretien & Réparations',
  '638400': 'Traitement Déchets Infectieux (DASRI) & Stérilisation',
  '701100': 'Ventes de Marchandises',
  '706100': 'Prestations de Services Vendues',
  '706200': 'Recettes Soins, Consultations & Hospitalisations',
  '241100': 'Matériel & Équipements Biomédicaux'
};

const getAccountLabel = (account) => {
  if (!account) return 'Non défini';
  return ACCOUNT_LABELS[account] ? `${account} • ${ACCOUNT_LABELS[account]}` : account;
};

export const MemoryModule = () => {
  const [activeTab, setActiveTab] = useState('docs'); // 'docs', 'rules', 'ml', 'simulator'
  
  // States Documents
  const [docs, setDocs] = useState([]);
  const [docTitle, setDocTitle] = useState('');
  const [docCategory, setDocCategory] = useState('Procédure Comptable');
  const [rawText, setRawText] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [docMessage, setDocMessage] = useState(null);
  const [refreshingCoa, setRefreshingCoa] = useState(false);
  const [coaMessage, setCoaMessage] = useState(null);

  // States Règles
  const [rules, setRules] = useState([]);
  const [ruleSearch, setRuleSearch] = useState('');
  const [showAddRuleModal, setShowAddRuleModal] = useState(false);
  const [newRule, setNewRule] = useState({
    pattern: '',
    condition_type: 'contains',
    target_account: '',
    target_journal: 'AC',
    vat_rate: '0',
    confidence_score: '1.0',
    description: ''
  });

  // States Simulateur
  const [simLibelle, setSimLibelle] = useState('');
  const [simTiers, setSimTiers] = useState('');
  const [simResult, setSimResult] = useState(null);
  const [simulating, setSimulating] = useState(false);

  useEffect(() => {
    fetchDocs();
    fetchRules();
  }, []);

  const fetchDocs = async () => {
    try {
      const res = await fetch('/api/memory/docs');
      const data = await res.json();
      if (Array.isArray(data)) setDocs(data);
    } catch (e) {
      console.error("Erreur chargement docs:", e);
    }
  };

  const fetchRules = async () => {
    try {
      const res = await fetch('/api/memory/rules');
      const data = await res.json();
      if (Array.isArray(data)) setRules(data);
    } catch (e) {
      console.error("Erreur chargement règles:", e);
    }
  };

  // Reconstruit le plan comptable personnalisé (utilisé par la Balance) à partir des documents
  // actuellement en mémoire : ajouter ou supprimer un document, puis cliquer ici, suffit à
  // répercuter le changement — pas de synchronisation automatique en arrière-plan.
  const handleRefreshChartOfAccounts = async () => {
    setRefreshingCoa(true);
    setCoaMessage(null);
    try {
      const res = await fetch('/api/memory/chart-of-accounts/refresh', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setCoaMessage({ type: 'success', text: data.message });
      } else {
        setCoaMessage({ type: 'error', text: data.error || 'Erreur lors du recalcul.' });
      }
    } catch (e) {
      setCoaMessage({ type: 'error', text: 'Connexion au serveur impossible.' });
    }
    setRefreshingCoa(false);
  };

  const handleUploadDoc = async (e) => {
    e.preventDefault();
    if (!docTitle.trim() && !selectedFile && !rawText.trim()) {
      alert("Veuillez saisir un titre, saisir un texte ou choisir un fichier.");
      return;
    }

    setUploadingDoc(true);
    setDocMessage(null);

    const formData = new FormData();
    formData.append('title', docTitle || (selectedFile ? selectedFile.name : 'Règle Comptable'));
    formData.append('category', docCategory);
    formData.append('rawText', rawText);
    if (selectedFile) formData.append('file', selectedFile);

    try {
      const res = await fetch('/api/memory/upload-doc', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        setDocMessage({ type: 'success', text: data.message });
        setDocTitle('');
        setRawText('');
        setSelectedFile(null);
        fetchDocs();
        fetchRules();
      } else {
        setDocMessage({ type: 'error', text: data.error || "Erreur lors de l'enregistrement." });
      }
    } catch (err) {
      setDocMessage({ type: 'error', text: "Erreur serveur de communication." });
    }
    setUploadingDoc(false);
  };

  const handleDeleteDoc = async (id) => {
    if (!confirm("Supprimer ce document de la mémoire et les règles associées ?")) return;
    try {
      const res = await fetch(`/api/memory/docs/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        fetchDocs();
        fetchRules();
      }
    } catch (e) {
      alert("Erreur de suppression");
    }
  };

  const handleSaveRule = async (e) => {
    e.preventDefault();
    if (!newRule.pattern.trim() || !newRule.target_account.trim()) {
      alert("Le motif et le compte comptable sont requis.");
      return;
    }

    try {
      const res = await fetch('/api/memory/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRule)
      });
      const data = await res.json();
      if (data.success) {
        setShowAddRuleModal(false);
        setNewRule({
          pattern: '',
          condition_type: 'contains',
          target_account: '',
          target_journal: 'AC',
          vat_rate: '0',
          confidence_score: '1.0',
          description: ''
        });
        fetchRules();
      } else {
        alert(data.error || "Erreur sauvegarde règle");
      }
    } catch (err) {
      alert("Erreur réseau");
    }
  };

  const handleToggleRule = async (id) => {
    try {
      const res = await fetch(`/api/memory/rules/${id}/toggle`, { method: 'POST' });
      const data = await res.json();
      if (data.success) fetchRules();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteRule = async (id) => {
    if (!confirm("Supprimer définitivement cette règle de la mémoire ?")) return;
    try {
      const res = await fetch(`/api/memory/rules/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) fetchRules();
    } catch (e) {
      console.error(e);
    }
  };

  const handleRunSimulator = async () => {
    if (!simLibelle.trim()) return;
    setSimulating(true);
    setSimResult(null);
    try {
      const res = await fetch('/api/memory/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ libelle: simLibelle, compte_tiers: simTiers })
      });
      const data = await res.json();
      setSimResult(data);
    } catch (err) {
      setSimResult({ matched: false, error: err.message });
    }
    setSimulating(false);
  };

  const filteredRules = rules.filter(r => 
    r.pattern.toLowerCase().includes(ruleSearch.toLowerCase()) ||
    (r.target_account && r.target_account.includes(ruleSearch)) ||
    (r.description && r.description.toLowerCase().includes(ruleSearch.toLowerCase()))
  );

  const manualRules = filteredRules.filter(r => !r.auto_learned);
  const mlRules = filteredRules.filter(r => r.auto_learned);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Banner Title */}
      <div className="card" style={{ 
        background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', 
        color: '#fff', 
        padding: '1.75rem',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.4)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ 
              background: 'rgba(59, 130, 246, 0.2)', 
              border: '1px solid rgba(59, 130, 246, 0.4)', 
              padding: '0.85rem', 
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              justify: 'center'
            }}>
              <BrainCircuit size={32} color="#60a5fa" />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#f8fafc' }}>
                Mémoire Métier & Intelligence DAF
              </h2>
              <p style={{ margin: '0.25rem 0 0 0', color: '#94a3b8', fontSize: '0.9rem' }}>
                Chargez vos documents de référence, définissez vos règles d'imputation et laissez l'application apprendre de vos opérations (Machine Learning).
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <div style={{ background: 'rgba(255,255,255,0.06)', padding: '0.5rem 1rem', borderRadius: '8px', textAlign: 'center', border: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#60a5fa' }}>{docs.length}</div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Docs Référence</div>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.06)', padding: '0.5rem 1rem', borderRadius: '8px', textAlign: 'center', border: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#34d399' }}>{rules.length}</div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Règles Actives</div>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.06)', padding: '0.5rem 1rem', borderRadius: '8px', textAlign: 'center', border: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#a78bfa' }}>{rules.filter(r => r.auto_learned).length}</div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Apprises (ML)</div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1rem' }}>
          <button 
            className={`btn ${activeTab === 'docs' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('docs')}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: activeTab === 'docs' ? undefined : 'rgba(255,255,255,0.05)', color: '#fff', border: 'none' }}
          >
            <BookOpen size={16} /> Documents & Procédures ({docs.length})
          </button>
          <button 
            className={`btn ${activeTab === 'rules' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('rules')}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: activeTab === 'rules' ? undefined : 'rgba(255,255,255,0.05)', color: '#fff', border: 'none' }}
          >
            <SlidersHorizontal size={16} /> Règles d'Imputation ({manualRules.length})
          </button>
          <button 
            className={`btn ${activeTab === 'ml' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('ml')}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: activeTab === 'ml' ? undefined : 'rgba(255,255,255,0.05)', color: '#fff', border: 'none' }}
          >
            <Cpu size={16} /> Mémoire Apprentissage ML ({mlRules.length})
          </button>
          <button 
            className={`btn ${activeTab === 'simulator' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('simulator')}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: activeTab === 'simulator' ? undefined : 'rgba(255,255,255,0.05)', color: '#fff', border: 'none' }}
          >
            <Sparkles size={16} /> Simulateur / Test d'Imputation
          </button>
        </div>
      </div>

      {/* TAB 1: DOCUMENTS */}
      {activeTab === 'docs' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
          
          {/* Upload Form */}
          <div className="card">
            <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.1rem' }}>
              <UploadCloud size={20} color="var(--color-primary)" />
              Charger un Document ou une Règle Métier
            </h3>

            {docMessage && (
              <div style={{ 
                padding: '0.75rem 1rem', 
                borderRadius: 'var(--radius-md)', 
                marginBottom: '1rem',
                backgroundColor: docMessage.type === 'success' ? '#dcfce7' : '#fee2e2',
                color: docMessage.type === 'success' ? '#166534' : '#991b1b',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.9rem'
              }}>
                {docMessage.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                {docMessage.text}
              </div>
            )}

            <form onSubmit={handleUploadDoc} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                  Titre du Document / Procédure *
                </label>
                <input 
                  type="text" 
                  className="input" 
                  placeholder="ex: Guide Imputation Frais Généraux OHADA 2026"
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                  Catégorie
                </label>
                <select 
                  className="input" 
                  value={docCategory} 
                  onChange={(e) => setDocCategory(e.target.value)}
                  style={{ width: '100%' }}
                >
                  <option value="Procédure Comptable">Procédure Comptable Interne</option>
                  <option value="Guide Imputation">Guide d'Imputation & Plan de Comptes</option>
                  <option value="Règle Fiscale">Note Fiscale & TVA</option>
                  <option value="Politique Achats">Politique des Achats & Tiers</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                  Fichier Document (PDF, TXT, Excel/CSV)
                </label>
                <input 
                  type="file" 
                  className="input"
                  accept=".txt,.pdf,.csv,.xlsx,.xls,.json"
                  onChange={(e) => setSelectedFile(e.target.files[0] || null)}
                  style={{ width: '100%' }}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.25rem', display: 'block' }}>
                  Formats acceptés : PDF, TXT, CSV, Excel.
                </span>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                  Ou Saisie directe du texte des règles :
                </label>
                <textarea 
                  className="input" 
                  rows={4}
                  placeholder="Saisissez ici des règles sous forme de texte ou de liste, ex:&#10;- ORANGE => Compte 628100&#10;- TOTAL => Compte 605110 (Frais de carburant)"
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.85rem' }}
                />
              </div>

              <button type="submit" className="btn btn-primary" disabled={uploadingDoc} style={{ marginTop: '0.5rem' }}>
                {uploadingDoc ? (
                  <>
                    <RefreshCw size={16} className="spin" /> Extraction & Ingestion...
                  </>
                ) : (
                  <>
                    <UploadCloud size={16} /> Enregistrer dans le Cerveau Métier
                  </>
                )}
              </button>
            </form>
          </div>

          {/* List of Documents */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.1rem' }}>
                <FileText size={20} color="var(--color-primary)" />
                Documents Ingestés en Mémoire ({docs.length})
              </h3>
              <button
                type="button"
                onClick={handleRefreshChartOfAccounts}
                disabled={refreshingCoa}
                className="btn btn-secondary"
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}
                title="Reconstruit les intitulés de comptes affichés dans la Balance à partir des documents actuellement chargés (utile après un ajout ou une suppression de document)."
              >
                <RefreshCw size={14} className={refreshingCoa ? 'spin' : ''} />
                {refreshingCoa ? 'Recalcul...' : 'Recalculer le plan comptable'}
              </button>
            </div>

            {coaMessage && (
              <div style={{
                marginTop: '0.75rem', padding: '0.6rem 0.85rem', borderRadius: 'var(--radius-md)', fontSize: '0.85rem',
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                backgroundColor: coaMessage.type === 'success' ? '#dcfce7' : '#fee2e2',
                color: coaMessage.type === 'success' ? '#166534' : '#991b1b'
              }}>
                {coaMessage.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                {coaMessage.text}
              </div>
            )}

            {docs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--color-text-muted)' }}>
                <BookOpen size={40} style={{ opacity: 0.3, marginBottom: '1rem' }} />
                <p>Aucun document chargé dans la mémoire métier.</p>
                <span style={{ fontSize: '0.85rem' }}>Chargez votre premier guide d'imputation ci-contre pour alimenter l'IA.</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '420px', overflowY: 'auto' }}>
                {docs.map(doc => (
                  <div key={doc.id} style={{ 
                    padding: '1rem', 
                    borderRadius: 'var(--radius-md)', 
                    border: '1px solid var(--color-border)', 
                    background: 'var(--color-bg-light)',
                    display: 'flex',
                    alignItems: 'center',
                    justify: 'space-between'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <FileText size={24} color="#3b82f6" />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{doc.title}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.2rem' }}>
                          <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '0.1rem 0.5rem', borderRadius: '4px', marginRight: '0.5rem' }}>
                            {doc.category}
                          </span>
                          {doc.filename} • {new Date(doc.created_at).toLocaleDateString()}
                        </div>
                      </div>
                    </div>

                    <button 
                      className="btn btn-secondary" 
                      onClick={() => handleDeleteDoc(doc.id)}
                      style={{ padding: '0.4rem', color: '#ef4444' }}
                      title="Supprimer"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      )}

      {/* TAB 2: RULES */}
      {activeTab === 'rules' && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600 }}>Règles Métier d'Imputation Comptable</h3>
              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                Règles explicites d'imputation appliquées automatiquement lors du traitement des opérations.
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ position: 'relative', width: '250px' }}>
                <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                <input 
                  type="text" 
                  className="input" 
                  placeholder="Filtrer les règles..."
                  value={ruleSearch}
                  onChange={(e) => setRuleSearch(e.target.value)}
                  style={{ paddingLeft: '2.25rem', width: '100%', fontSize: '0.85rem' }}
                />
              </div>

              <button className="btn btn-primary" onClick={() => setShowAddRuleModal(true)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Plus size={16} /> Nouvelle Règle
              </button>
            </div>
          </div>

          {manualRules.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--color-text-muted)' }}>
              <SlidersHorizontal size={40} style={{ opacity: 0.3, marginBottom: '1rem' }} />
              <p>Aucune règle d'imputation manuelle enregistrée.</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--color-border)', background: 'var(--color-bg-light)' }}>
                    <th style={{ padding: '0.75rem' }}>Statut</th>
                    <th style={{ padding: '0.75rem' }}>Motif / Mot-clé</th>
                    <th style={{ padding: '0.75rem' }}>Condition</th>
                    <th style={{ padding: '0.75rem' }}>Compte Cible</th>
                    <th style={{ padding: '0.75rem' }}>Journal</th>
                    <th style={{ padding: '0.75rem' }}>TVA</th>
                    <th style={{ padding: '0.75rem' }}>Confiance</th>
                    <th style={{ padding: '0.75rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {manualRules.map(r => (
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)', opacity: r.is_active ? 1 : 0.5 }}>
                      <td style={{ padding: '0.75rem' }}>
                        <button 
                          onClick={() => handleToggleRule(r.id)} 
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        >
                          {r.is_active ? <ToggleRight size={26} color="#10b981" /> : <ToggleLeft size={26} color="#9ca3af" />}
                        </button>
                      </td>
                      <td style={{ padding: '0.75rem', fontWeight: 600 }}>
                        <span style={{ background: '#eff6ff', color: '#1d4ed8', padding: '0.25rem 0.6rem', borderRadius: '6px', fontFamily: 'monospace', fontSize: '0.9rem', border: '1px solid #bfdbfe' }}>
                          "{r.pattern}"
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem', fontWeight: 'bold', color: '#059669' }}>
                        <span style={{ background: '#ecfdf5', color: '#047857', padding: '0.25rem 0.6rem', borderRadius: '6px', border: '1px solid #a7f3d0', display: 'inline-block' }}>
                          {getAccountLabel(r.target_account)}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem', fontSize: '0.85rem', color: '#475569' }}>
                        <span style={{ background: '#f8fafc', padding: '0.2rem 0.5rem', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                          {r.description || 'Règle Document'}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem' }}>
                        <span style={{ background: '#f1f5f9', padding: '0.2rem 0.5rem', borderRadius: '4px', fontWeight: 600 }}>
                          {r.target_journal || 'AC'}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem' }}>
                        <span style={{ 
                          padding: '0.15rem 0.5rem', 
                          borderRadius: '12px', 
                          fontSize: '0.75rem', 
                          fontWeight: 'bold',
                          background: r.confidence_score >= 0.8 ? '#dcfce7' : '#fef3c7',
                          color: r.confidence_score >= 0.8 ? '#15803d' : '#b45309'
                        }}>
                          {(r.confidence_score * 100).toFixed(0)}%
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem' }}>
                        <button 
                          className="btn btn-secondary" 
                          onClick={() => handleDeleteRule(r.id)}
                          style={{ padding: '0.35rem', color: '#ef4444' }}
                          title="Supprimer"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: ML MEMORY */}
      {activeTab === 'ml' && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Cpu size={22} color="#a78bfa" />
                Mémoire d'Apprentissage Automatique (ML)
              </h3>
              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                Règles extraites automatiquement depuis vos journaux comptables importés et vos validations d'écritures.
              </p>
            </div>
          </div>

          {mlRules.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3.5rem 1rem', color: 'var(--color-text-muted)' }}>
              <BrainCircuit size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} />
              <p style={{ fontWeight: 600 }}>Le Cerveau ML est actuellement vierge.</p>
              <span style={{ fontSize: '0.85rem' }}>
                Importez un journal comptable au format Excel dans le module <strong>Importation de Données</strong> pour déclencher l'apprentissage automatique !
              </span>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--color-border)', background: 'var(--color-bg-light)' }}>
                    <th style={{ padding: '0.75rem' }}>Statut</th>
                    <th style={{ padding: '0.75rem' }}>Mot-clé Appris (ML)</th>
                    <th style={{ padding: '0.75rem' }}>Compte & Intitulé SYSCOHADA</th>
                    <th style={{ padding: '0.75rem' }}>Journal</th>
                    <th style={{ padding: '0.75rem' }}>Occurrences</th>
                    <th style={{ padding: '0.75rem' }}>Score Confiance ML</th>
                    <th style={{ padding: '0.75rem' }}>Auto-Imputation (≥80%)</th>
                    <th style={{ padding: '0.75rem' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {mlRules.map(r => (
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '0.75rem' }}>
                        <button 
                          onClick={() => handleToggleRule(r.id)} 
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        >
                          {r.is_active ? <ToggleRight size={26} color="#10b981" /> : <ToggleLeft size={26} color="#9ca3af" />}
                        </button>
                      </td>
                      <td style={{ padding: '0.75rem', fontWeight: 600 }}>
                        <span style={{ background: '#f3e8ff', color: '#7e22ce', padding: '0.25rem 0.6rem', borderRadius: '6px', fontFamily: 'monospace', fontSize: '0.9rem', border: '1px solid #e9d5ff' }}>
                          "{r.pattern}"
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem', fontWeight: 'bold', color: '#059669' }}>
                        <span style={{ background: '#ecfdf5', color: '#047857', padding: '0.25rem 0.6rem', borderRadius: '6px', border: '1px solid #a7f3d0', display: 'inline-block' }}>
                          {getAccountLabel(r.target_account)}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem' }}>
                        <span style={{ background: '#f1f5f9', padding: '0.2rem 0.5rem', borderRadius: '4px', fontWeight: 600 }}>
                          {r.target_journal || 'AC'}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem', fontWeight: 600 }}>
                        <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '0.1rem 0.5rem', borderRadius: '12px', fontSize: '0.8rem' }}>
                          {r.occurrences} fois
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <div style={{ flex: 1, height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${r.confidence_score * 100}%`, background: r.confidence_score >= 0.8 ? '#10b981' : '#f59e0b' }} />
                          </div>
                          <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>{(r.confidence_score * 100).toFixed(0)}%</span>
                        </div>
                      </td>
                      <td style={{ padding: '0.75rem' }}>
                        {r.confidence_score >= 0.8 ? (
                          <span style={{ background: '#dcfce7', color: '#166534', padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                            <CheckCircle2 size={12} /> Auto-Appliqué
                          </span>
                        ) : (
                          <span style={{ background: '#f1f5f9', color: '#64748b', padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.75rem' }}>
                            Suggestion seule
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '0.75rem' }}>
                        <button 
                          className="btn btn-secondary" 
                          onClick={() => handleDeleteRule(r.id)}
                          style={{ padding: '0.35rem', color: '#ef4444' }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: SIMULATOR */}
      {activeTab === 'simulator' && (
        <div className="card">
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.1rem' }}>
            <Sparkles size={20} color="var(--color-primary)" />
            Simulateur d'Imputation par la Mémoire Métier
          </h3>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginTop: '-0.5rem' }}>
            Saisissez le libellé d'une facture ou d'une opération pour tester quelle règle ou quel apprentissage ML sera appliqué en temps réel.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginTop: '1.5rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                  Libellé de l'Écriture / Facture *
                </label>
                <input 
                  type="text" 
                  className="input" 
                  placeholder="ex: Facture ORANGE CI Internet Mai 2026"
                  value={simLibelle}
                  onChange={(e) => setSimLibelle(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                  Nom du Tiers / Fournisseur (Optionnel)
                </label>
                <input 
                  type="text" 
                  className="input" 
                  placeholder="ex: ORANGE CI"
                  value={simTiers}
                  onChange={(e) => setSimTiers(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>

              <button 
                className="btn btn-primary" 
                onClick={handleRunSimulator}
                disabled={simulating || !simLibelle.trim()}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginTop: '0.5rem' }}
              >
                {simulating ? <RefreshCw size={16} className="spin" /> : <Sparkles size={16} />}
                Tester l'Imputation Automatique
              </button>
            </div>

            {/* Simulation Results */}
            <div style={{ 
              background: 'var(--color-bg-light)', 
              borderRadius: 'var(--radius-lg)', 
              padding: '1.5rem',
              border: '1px solid var(--color-border)',
              display: 'flex',
              flexDirection: 'column',
              justify: 'center'
            }}>
              {!simResult ? (
                <div style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>
                  <Lightbulb size={36} style={{ opacity: 0.4, marginBottom: '0.5rem' }} />
                  <p style={{ margin: 0, fontSize: '0.9rem' }}>Entrez un libellé à gauche et lancez le test.</p>
                </div>
              ) : simResult.matched ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#166534', fontWeight: 'bold' }}>
                    <CheckCircle2 size={22} color="#166534" />
                    Règle de Mémoire Trouvée !
                  </div>

                  <div style={{ background: '#fff', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>Motif Matché</span>
                      <span style={{ fontWeight: 'bold', color: '#2563eb' }}>"{simResult.rule.pattern}"</span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>Compte Comptable Suggéré</span>
                      <span style={{ fontWeight: 'bold', fontSize: '1.1rem', color: '#059669' }}>{simResult.target_account}</span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>Code Journal</span>
                      <span style={{ fontWeight: '600' }}>{simResult.target_journal || 'AC'}</span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>Score de Confiance</span>
                      <span style={{ fontWeight: 'bold', color: simResult.confidence_score >= 0.8 ? '#15803d' : '#b45309' }}>
                        {(simResult.confidence_score * 100).toFixed(0)}%
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>Source</span>
                      <span style={{ fontSize: '0.8rem', background: '#f3e8ff', color: '#6b21a8', padding: '0.1rem 0.5rem', borderRadius: '4px' }}>
                        {simResult.source}
                      </span>
                    </div>
                  </div>

                  <div style={{ 
                    padding: '0.75rem', 
                    borderRadius: 'var(--radius-md)', 
                    background: simResult.auto_apply ? '#dcfce7' : '#fef3c7',
                    color: simResult.auto_apply ? '#14532d' : '#78350f',
                    fontSize: '0.85rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}>
                    {simResult.auto_apply ? (
                      <>
                        <CheckCircle2 size={18} />
                        <strong>Auto-Imputation Activée (Confiance ≥ 80%)</strong> : Le compte {simResult.target_account} sera pré-rempli automatiquement sans intervention.
                      </>
                    ) : (
                      <>
                        <AlertCircle size={18} />
                        <strong>Suggestion Seule (Confiance &lt; 80%)</strong> : Le compte sera proposé comme suggestion à l'utilisateur.
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', color: '#991b1b', background: '#fee2e2', padding: '1.5rem', borderRadius: 'var(--radius-md)' }}>
                  <AlertCircle size={32} color="#991b1b" style={{ marginBottom: '0.5rem' }} />
                  <p style={{ margin: 0, fontWeight: 'bold' }}>Aucune règle de mémoire n'a correspondu.</p>
                  <span style={{ fontSize: '0.8rem', color: '#7f1d1d' }}>
                    L'application s'appuiera sur le plan comptable général ou posera la question à l'IA DAF.
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Rule Modal */}
      {showAddRuleModal && (
        <div style={{ 
          position: 'fixed', 
          inset: 0, 
          background: 'rgba(0,0,0,0.5)', 
          backdropFilter: 'blur(4px)', 
          display: 'flex', 
          alignItems: 'center', 
          justify: 'center',
          zIndex: 1000 
        }}>
          <div className="card" style={{ width: '500px', maxWidth: '90vw' }}>
            <h3 style={{ marginTop: 0 }}>Créer une Nouvelle Règle Métier</h3>
            <form onSubmit={handleSaveRule} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                  Motif / Mot-clé à rechercher *
                </label>
                <input 
                  type="text" 
                  className="input" 
                  placeholder="ex: ORANGE, LOYER, TOTAL, SODECI"
                  value={newRule.pattern}
                  onChange={(e) => setNewRule({ ...newRule, pattern: e.target.value })}
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                    Condition
                  </label>
                  <select 
                    className="input"
                    value={newRule.condition_type}
                    onChange={(e) => setNewRule({ ...newRule, condition_type: e.target.value })}
                    style={{ width: '100%' }}
                  >
                    <option value="contains">Contient le texte</option>
                    <option value="exact">Texte exact</option>
                    <option value="starts_with">Commence par</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                    Compte Comptable *
                  </label>
                  <input 
                    type="text" 
                    className="input" 
                    placeholder="ex: 628100 ou 605110"
                    value={newRule.target_account}
                    onChange={(e) => setNewRule({ ...newRule, target_account: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                    Code Journal Cible
                  </label>
                  <input 
                    type="text" 
                    className="input" 
                    placeholder="ex: AC, BQ, CA, HA"
                    value={newRule.target_journal}
                    onChange={(e) => setNewRule({ ...newRule, target_journal: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                    Taux de TVA (%)
                  </label>
                  <input 
                    type="number" 
                    className="input" 
                    placeholder="ex: 18"
                    value={newRule.vat_rate}
                    onChange={(e) => setNewRule({ ...newRule, vat_rate: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                  Description / Explication
                </label>
                <input 
                  type="text" 
                  className="input" 
                  placeholder="ex: Factures de télécommunication entreprise"
                  value={newRule.description}
                  onChange={(e) => setNewRule({ ...newRule, description: e.target.value })}
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddRuleModal(false)}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-primary">
                  Créer la Règle
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
