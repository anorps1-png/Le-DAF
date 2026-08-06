import { useState, useEffect } from 'react';
import { TrendingUp, BarChart3, ShieldCheck, Activity, DollarSign, PieChart, AlertCircle, ArrowUpRight, ArrowDownRight, Layers, Award } from 'lucide-react';

export const AnalyseFinanciereModule = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('summary');

  useEffect(() => {
    fetchAnalysis();
  }, []);

  const fetchAnalysis = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/financial-analysis');
      const json = await res.json();
      setData(json);
    } catch (e) {
      console.error("Erreur chargement analyse financière:", e);
    }
    setLoading(false);
  };

  const formatFCFA = (val) => {
    return new Intl.NumberFormat('fr-FR').format(Math.round(val || 0)) + ' FCFA';
  };

  if (loading) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
        <Activity style={{ animation: 'spin 1.5s linear infinite', marginBottom: '1rem', width: '32px', height: '32px', color: 'var(--color-primary)' }} />
        <p>Calcul des KPIs financiers et analyse SYSCOHADA en cours...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
        <AlertCircle style={{ color: 'var(--color-error)', width: '48px', height: '48px', marginBottom: '1rem' }} />
        <h3>Impossible de charger l'analyse financière</h3>
        <p style={{ color: 'var(--color-text-muted)' }}>Vérifiez que le serveur backend est démarré.</p>
        <button className="btn btn-primary" onClick={fetchAnalysis} style={{ marginTop: '1rem' }}>Réessayer</button>
      </div>
    );
  }

  const { equilibrium, sig, ratios } = data;
  const score = ratios.healthScore || 0;
  const scoreColor = score >= 75 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444';
  const scoreLabel = score >= 75 ? 'Excellente Santé Financière' : score >= 50 ? 'Santé Financière Modérée' : 'Vigilance Requise';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Header Banner */}
      <div className="card" style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', color: '#fff', borderRadius: 'var(--radius-lg)', padding: '1.75rem', position: 'relative', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1.5rem', position: 'relative', zIndex: 2 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <TrendingUp style={{ color: '#38bdf8', width: '28px', height: '28px' }} />
              <h2 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 700 }}>Analyse Financière & KPIs SYSCOHADA</h2>
            </div>
            <p style={{ color: '#94a3b8', margin: 0, fontSize: '0.95rem' }}>
              Diagnostic financier en temps réel, solde de trésorerie, FRNG, BFR et Soldes Intermédiaires de Gestion.
            </p>
          </div>

          {/* Health Score Badge */}
          <div style={{ background: 'rgba(255, 255, 255, 0.07)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255, 255, 255, 0.15)', borderRadius: 'var(--radius-lg)', padding: '1rem 1.5rem', textAlign: 'center', minWidth: '180px' }}>
            <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', fontWeight: 600, marginBottom: '0.25rem' }}>Score DAF Health</div>
            <div style={{ fontSize: '2.2rem', fontWeight: 800, color: scoreColor }}>{score}<span style={{ fontSize: '1rem', color: '#94a3b8' }}>/100</span></div>
            <div style={{ fontSize: '0.8rem', color: scoreColor, fontWeight: 600 }}>{scoreLabel}</div>
          </div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem', flexWrap: 'wrap' }}>
        <button 
          onClick={() => setActiveTab('summary')}
          style={{ padding: '0.65rem 1.25rem', borderRadius: 'var(--radius-md)', border: 'none', background: activeTab === 'summary' ? 'var(--color-primary)' : 'transparent', color: activeTab === 'summary' ? '#fff' : 'var(--color-text-muted)', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <Activity size={18} /> Synthèse & Équilibre (FRNG/BFR/TN)
        </button>
        <button 
          onClick={() => setActiveTab('sig')}
          style={{ padding: '0.65rem 1.25rem', borderRadius: 'var(--radius-md)', border: 'none', background: activeTab === 'sig' ? 'var(--color-primary)' : 'transparent', color: activeTab === 'sig' ? '#fff' : 'var(--color-text-muted)', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <BarChart3 size={18} /> SIG & Compte de Résultat
        </button>
        <button 
          onClick={() => setActiveTab('ratios')}
          style={{ padding: '0.65rem 1.25rem', borderRadius: 'var(--radius-md)', border: 'none', background: activeTab === 'ratios' ? 'var(--color-primary)' : 'transparent', color: activeTab === 'ratios' ? '#fff' : 'var(--color-text-muted)', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <PieChart size={18} /> Ratios & Délais (DSO / DPO)
        </button>
        <button 
          onClick={() => setActiveTab('diagnosis')}
          style={{ padding: '0.65rem 1.25rem', borderRadius: 'var(--radius-md)', border: 'none', background: activeTab === 'diagnosis' ? 'var(--color-primary)' : 'transparent', color: activeTab === 'diagnosis' ? '#fff' : 'var(--color-text-muted)', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <ShieldCheck size={18} /> Recommandations DAF
        </button>
      </div>

      {/* TAB 1: SYNTHÈSE & ÉQUILIBRE FINANCIER */}
      {activeTab === 'summary' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Top 3 Pillar Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
            
            {/* FRNG */}
            <div className="card" style={{ borderLeft: '4px solid #3b82f6' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                <div>
                  <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>FRNG (Fonds de Roulement)</span>
                  <h3 style={{ margin: '0.25rem 0 0 0', fontSize: '1.5rem', fontWeight: 700, color: equilibrium.frng >= 0 ? '#10b981' : '#ef4444' }}>
                    {formatFCFA(equilibrium.frng)}
                  </h3>
                </div>
                <div style={{ background: '#dbeafe', padding: '0.5rem', borderRadius: 'var(--radius-md)', color: '#2563eb' }}>
                  <Layers size={22} />
                </div>
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', margin: 0 }}>
                {equilibrium.frng >= 0 ? "✅ Ressources stables financent intégralement les emplois stables." : "⚠️ Excédent d'investissements non couvert par les capitaux permanents."}
              </p>
            </div>

            {/* BFR */}
            <div className="card" style={{ borderLeft: '4px solid #f59e0b' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                <div>
                  <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>BFR (Besoin en Fonds de Roulement)</span>
                  <h3 style={{ margin: '0.25rem 0 0 0', fontSize: '1.5rem', fontWeight: 700, color: '#f59e0b' }}>
                    {formatFCFA(equilibrium.bfr)}
                  </h3>
                </div>
                <div style={{ background: '#fef3c7', padding: '0.5rem', borderRadius: 'var(--radius-md)', color: '#d97706' }}>
                  <Activity size={22} />
                </div>
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', margin: 0 }}>
                Besoin de trésorerie généré par le décalage créances/stocks vs dettes fournisseurs.
              </p>
            </div>

            {/* TN */}
            <div className="card" style={{ borderLeft: `4px solid ${equilibrium.tresorerieNette >= 0 ? '#10b981' : '#ef4444'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                <div>
                  <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Trésorerie Nette (TN)</span>
                  <h3 style={{ margin: '0.25rem 0 0 0', fontSize: '1.5rem', fontWeight: 700, color: equilibrium.tresorerieNette >= 0 ? '#10b981' : '#ef4444' }}>
                    {formatFCFA(equilibrium.tresorerieNette)}
                  </h3>
                </div>
                <div style={{ background: equilibrium.tresorerieNette >= 0 ? '#d1fae5' : '#fee2e2', padding: '0.5rem', borderRadius: 'var(--radius-md)', color: equilibrium.tresorerieNette >= 0 ? '#059669' : '#dc2626' }}>
                  <DollarSign size={22} />
                </div>
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', margin: 0 }}>
                Formule fondamentale : TN = FRNG ({formatFCFA(equilibrium.frng)}) - BFR ({formatFCFA(equilibrium.bfr)}).
              </p>
            </div>

          </div>

          {/* Équilibre Visuel breakdown table */}
          <div className="card">
            <h3 style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.1rem' }}>
              <Layers style={{ color: 'var(--color-primary)' }} /> Décomposition du Bilan & Structure Financière
            </h3>
            
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ background: 'var(--color-bg-light)', borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>Masse Bilancielle</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Montant (FCFA)</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>Appréciation / Norme SYSCOHADA</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>Ressources Stables (Capitaux Propres & Dettes LMT - Cl. 1)</td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 600, color: '#2563eb' }}>{formatFCFA(equilibrium.capPermanents)}</td>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--color-text-muted)' }}>Couverture du haut de bilan</td>
                </tr>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>Emplois Stables (Actifs Immobilisés - Cl. 2)</td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 600 }}>{formatFCFA(equilibrium.actifImmobilise)}</td>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--color-text-muted)' }}>Investissements de structure</td>
                </tr>
                <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'rgba(59, 130, 246, 0.05)' }}>
                  <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: 'var(--color-primary)' }}>= FRNG (Fonds de Roulement)</td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700, color: equilibrium.frng >= 0 ? '#10b981' : '#ef4444' }}>{formatFCFA(equilibrium.frng)}</td>
                  <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: equilibrium.frng >= 0 ? '#10b981' : '#ef4444' }}>
                    {equilibrium.frng >= 0 ? 'Positif (Équilibre préservé)' : 'Négatif (Risque de sous-capitalisation)'}
                  </td>
                </tr>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '0.75rem 1rem', paddingLeft: '2rem' }}>• Actif Circulant HT (Stocks + Créances Clients)</td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>{formatFCFA(equilibrium.actifCirculant)}</td>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--color-text-muted)' }}>Emplois d'exploitation</td>
                </tr>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '0.75rem 1rem', paddingLeft: '2rem' }}>• Passif Circulant HT (Dettes Fournisseurs & Fiscales)</td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>{formatFCFA(equilibrium.passifCirculant)}</td>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--color-text-muted)' }}>Ressources d'exploitation</td>
                </tr>
                <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'rgba(245, 158, 11, 0.05)' }}>
                  <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: '#d97706' }}>= BFR (Besoin en Fonds de Roulement)</td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700, color: '#d97706' }}>{formatFCFA(equilibrium.bfr)}</td>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--color-text-muted)' }}>Besoin de financement du cycle d'exploitation</td>
                </tr>
                <tr style={{ background: equilibrium.tresorerieNette >= 0 ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)' }}>
                  <td style={{ padding: '0.85rem 1rem', fontWeight: 800, fontSize: '1rem' }}>= Trésorerie Nette (TN = FRNG - BFR)</td>
                  <td style={{ padding: '0.85rem 1rem', textAlign: 'right', fontWeight: 800, fontSize: '1rem', color: equilibrium.tresorerieNette >= 0 ? '#059669' : '#dc2626' }}>{formatFCFA(equilibrium.tresorerieNette)}</td>
                  <td style={{ padding: '0.85rem 1rem', fontWeight: 700, color: equilibrium.tresorerieNette >= 0 ? '#059669' : '#dc2626' }}>
                    {equilibrium.tresorerieNette >= 0 ? 'Trésorerie Saine & Disponible' : 'Tension de Trésorerie / Découvert'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

        </div>
      )}

      {/* TAB 2: SOLDES INTERMÉDIAIRES DE GESTION (SIG SYSCOHADA) */}
      {activeTab === 'sig' && (
        <div className="card">
          <h3 style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.1rem' }}>
            <BarChart3 style={{ color: 'var(--color-primary)' }} /> Soldes Intermédiaires de Gestion (SIG Cascade SYSCOHADA)
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            
            {/* CA */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.85rem 1rem', background: 'var(--color-bg-light)', borderRadius: 'var(--radius-md)', fontWeight: 600 }}>
              <span>Chiffre d'Affaires Ventes (Compte 70)</span>
              <span style={{ fontSize: '1.1rem', color: '#2563eb' }}>{formatFCFA(sig.ca)}</span>
            </div>

            {/* Marge Brute */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.85rem 1rem', background: 'rgba(37, 99, 235, 0.05)', borderRadius: 'var(--radius-md)', borderLeft: '4px solid #2563eb' }}>
              <div>
                <strong style={{ display: 'block', color: '#1e40af' }}>Marge Brute d'Exploitation</strong>
                <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>CA ({formatFCFA(sig.ca)}) - Achats ({formatFCFA(sig.achats)})</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e40af' }}>{formatFCFA(sig.margeBrute)}</div>
                <div style={{ fontSize: '0.8rem', color: '#2563eb', fontWeight: 600 }}>Taux : {sig.tauxMargeBrute}%</div>
              </div>
            </div>

            {/* Valeur Ajoutée */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.85rem 1rem', background: 'rgba(16, 185, 129, 0.05)', borderRadius: 'var(--radius-md)', borderLeft: '4px solid #10b981' }}>
              <div>
                <strong style={{ display: 'block', color: '#065f46' }}>Valeur Ajoutée (VA)</strong>
                <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Marge Brute - Services Extérieurs ({formatFCFA(sig.servicesExterieurs)})</span>
              </div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#065f46' }}>{formatFCFA(sig.valeurAjoutee)}</div>
            </div>

            {/* EBE */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.85rem 1rem', background: 'rgba(245, 158, 11, 0.05)', borderRadius: 'var(--radius-md)', borderLeft: '4px solid #f59e0b' }}>
              <div>
                <strong style={{ display: 'block', color: '#92400e' }}>Excédent Brut d'Exploitation (EBE)</strong>
                <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Valeur Ajoutée - Charges de Personnel ({formatFCFA(sig.chargesPersonnel)})</span>
              </div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#92400e' }}>{formatFCFA(sig.ebe)}</div>
            </div>

            {/* Résultat d'Exploitation */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.85rem 1rem', background: 'var(--color-bg-light)', borderRadius: 'var(--radius-md)' }}>
              <div>
                <strong>Résultat d'Exploitation (REX)</strong>
                <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', display: 'block' }}>EBE - Dotations Amortissements ({formatFCFA(sig.dotationsAmort)})</span>
              </div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{formatFCFA(sig.resultatExploitation)}</div>
            </div>

            {/* Résultat Net */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', background: sig.resultatNet >= 0 ? '#d1fae5' : '#fee2e2', borderRadius: 'var(--radius-md)', border: `1px solid ${sig.resultatNet >= 0 ? '#059669' : '#dc2626'}` }}>
              <div>
                <strong style={{ fontSize: '1.1rem', color: sig.resultatNet >= 0 ? '#065f46' : '#991b1b' }}>Résultat Net de l'Exercice (RN)</strong>
                <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', display: 'block' }}>Marge Nette globale : {sig.tauxMargeNette}%</span>
              </div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: sig.resultatNet >= 0 ? '#047857' : '#b91c1c' }}>
                {formatFCFA(sig.resultatNet)}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* TAB 3: RATIOS & DÉLAIS */}
      {activeTab === 'ratios' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.25rem' }}>
          
          {/* Liquidité Générale */}
          <div className="card">
            <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--color-text-muted)' }}>Ratio de Liquidité Générale</h4>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: parseFloat(ratios.currentRatio) >= 1.2 ? '#10b981' : '#f59e0b' }}>
              {ratios.currentRatio}
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: '0.5rem 0 0 0' }}>
              Norme &gt; 1.2. Capacité à rembourser les dettes à court terme avec les actifs à court terme.
            </p>
          </div>

          {/* Liquidité Réduite */}
          <div className="card">
            <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--color-text-muted)' }}>Ratio de Liquidité Réduite (Acid Test)</h4>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: '#2563eb' }}>
              {ratios.quickRatio}
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: '0.5rem 0 0 0' }}>
              Créances + Trésorerie / Passif Circulant (hors stocks).
            </p>
          </div>

          {/* DSO Délai Client */}
          <div className="card">
            <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--color-text-muted)' }}>DSO (Délai Moyen Client)</h4>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: ratios.dso <= 60 ? '#10b981' : '#ef4444' }}>
              {ratios.dso} <span style={{ fontSize: '1rem', color: 'var(--color-text-muted)' }}>jours</span>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: '0.5rem 0 0 0' }}>
              Temps moyen de recouvrement des factures clients.
            </p>
          </div>

          {/* DPO Délai Fournisseur */}
          <div className="card">
            <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--color-text-muted)' }}>DPO (Délai Moyen Fournisseur)</h4>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: '#f59e0b' }}>
              {ratios.dpo} <span style={{ fontSize: '1rem', color: 'var(--color-text-muted)' }}>jours</span>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: '0.5rem 0 0 0' }}>
              Durée moyenne de paiement des fournisseurs.
            </p>
          </div>

        </div>
      )}

      {/* TAB 4: RECOMMANDATIONS DAF */}
      {activeTab === 'diagnosis' && (
        <div className="card">
          <h3 style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.1rem' }}>
            <Award style={{ color: 'var(--color-primary)' }} /> Diagnostic & Recommandations Stratégiques du DAF IA
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            
            <div style={{ padding: '1rem', background: equilibrium.frng >= 0 ? '#d1fae5' : '#fee2e2', borderRadius: 'var(--radius-md)', borderLeft: `4px solid ${equilibrium.frng >= 0 ? '#10b981' : '#ef4444'}` }}>
              <h4 style={{ margin: '0 0 0.35rem 0', color: equilibrium.frng >= 0 ? '#065f46' : '#991b1b' }}>
                1. Équilibre du Haut de Bilan (FRNG)
              </h4>
              <p style={{ margin: 0, fontSize: '0.9rem', color: equilibrium.frng >= 0 ? '#047857' : '#b91c1c' }}>
                {equilibrium.frng >= 0 
                  ? `Votre Fonds de Roulement est positif (${formatFCFA(equilibrium.frng)}). Vos emplois durables sont sereinement financés par vos capitaux permanents.` 
                  : `Votre FRNG est négatif (${formatFCFA(equilibrium.frng)}). Vous financez des immobilisations avec du court terme. Augmentez les fonds propres ou contractez un emprunt MLT.`}
              </p>
            </div>

            <div style={{ padding: '1rem', background: ratios.dso > 60 ? '#fef3c7' : '#ecfdf5', borderRadius: 'var(--radius-md)', borderLeft: `4px solid ${ratios.dso > 60 ? '#f59e0b' : '#10b981'}` }}>
              <h4 style={{ margin: '0 0 0.35rem 0', color: ratios.dso > 60 ? '#92400e' : '#065f46' }}>
                2. Gestion du BFR et Délais de Recouvrement
              </h4>
              <p style={{ margin: 0, fontSize: '0.9rem', color: ratios.dso > 60 ? '#78350f' : '#047857' }}>
                Délai moyen de paiement client (DSO) : <strong>{ratios.dso} jours</strong>. 
                {ratios.dso > 60 
                  ? " Le délai de paiement dépassant 60 jours, mettez en place une relance automatique et exigez un acompte à la commande pour réduire le BFR." 
                  : " La rotation des créances clients est sous contrôle et conforme aux standards."}
              </p>
            </div>

            <div style={{ padding: '1rem', background: sig.ebe >= 0 ? '#eff6ff' : '#fee2e2', borderRadius: 'var(--radius-md)', borderLeft: `4px solid ${sig.ebe >= 0 ? '#3b82f6' : '#ef4444'}` }}>
              <h4 style={{ margin: '0 0 0.35rem 0', color: sig.ebe >= 0 ? '#1e40af' : '#991b1b' }}>
                3. Performance Économique & Marge (EBE)
              </h4>
              <p style={{ margin: 0, fontSize: '0.9rem', color: sig.ebe >= 0 ? '#1d4ed8' : '#b91c1c' }}>
                Votre Excédent Brut d'Exploitation s'élève à <strong>{formatFCFA(sig.ebe)}</strong> avec un taux de marge brute de <strong>{sig.tauxMargeBrute}%</strong>. 
                {sig.ebe >= 0 ? " La rentabilité d'exploitation brute est positive et permet d'amortir vos actifs." : " L'activité génère une perte brute. Réexaminez vos prix de vente ou vos coûts d'achat."}
              </p>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
