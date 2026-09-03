import { useState, useEffect } from 'react';
import { 
  Landmark, TrendingUp, TrendingDown, AlertTriangle, ShieldCheck, 
  ArrowUpRight, ArrowDownRight, RefreshCw, Calendar, Sparkles, 
  Sliders, DollarSign, Activity, CheckCircle, Info
} from 'lucide-react';

export const CashForecastModule = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('grid'); // grid, simulation, recommendations
  
  // Simulator state
  const [simClientDelay, setSimClientDelay] = useState(0); // décalage jours (+/-)
  const [simSalesVariation, setSimSalesVariation] = useState(0); // % variation ventes (-20% à +20%)

  const fetchForecast = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/cash-forecast');
      const json = await res.json();
      if (json && json.projections) {
        setData(json);
      } else {
        setData(null);
      }
    } catch (e) {
      console.error("Erreur chargement forecast:", e);
      setData(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchForecast();
  }, []);

  const formatFCFA = (val) => {
    return new Intl.NumberFormat('fr-FR').format(Math.round(val || 0)) + ' FCFA';
  };

  if (loading && !data) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
        <RefreshCw style={{ animation: 'spin 1.5s linear infinite', marginBottom: '1rem', width: '32px', height: '32px', color: 'var(--color-primary)' }} />
        <p>Génération du plan prévisionnel et calcul des flux de trésorerie...</p>
      </div>
    );
  }

  const {
    soldeActuel = 0,
    creancesClients = 0,
    dettesFournisseurs = 0,
    projections = [],
    aiRecommendations = []
  } = data || {};

  // Simulation calculations
  const simulatedProjections = projections.map((p, idx) => {
    const salesFactor = 1 + (simSalesVariation / 100);
    const adjustedVentes = Math.round(p.encaissements.ventesPrevisionnelles * salesFactor);
    
    // Décalage client : si positif, réduit le recouvrement du mois courant et le reporte
    const delayFactor = Math.max(0.5, 1 - (simClientDelay * 0.01));
    const adjustedRecouvrement = Math.round(p.encaissements.recouvrementClients * delayFactor);
    const totalEnc = adjustedVentes + adjustedRecouvrement;

    const totalDec = p.decaissements.total;
    const variation = totalEnc - totalDec;
    
    // Recalcul chaîné du solde
    return {
      ...p,
      simulatedEncaissements: totalEnc,
      simulatedDecaissements: totalDec,
      simulatedVariation: variation
    };
  });

  // Re-calculate running cash for simulation
  let runningSimCash = soldeActuel;
  simulatedProjections.forEach(p => {
    p.simulatedSoldeDebut = runningSimCash;
    p.simulatedSoldeFin = runningSimCash + p.simulatedVariation;
    runningSimCash = p.simulatedSoldeFin;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Header Banner */}
      <div className="card" style={{ background: 'linear-gradient(135deg, #064e3b 0%, #0f172a 100%)', color: '#fff', borderRadius: 'var(--radius-lg)', padding: '1.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1.5rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <Landmark style={{ color: '#34d399', width: '28px', height: '28px' }} />
              <h2 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 700 }}>Plan de Trésorerie Prévisionnel (Cash Forecast)</h2>
            </div>
            <p style={{ color: '#a7f3d0', margin: 0, fontSize: '0.95rem' }}>
              Visibilité glissante à 4 mois sur vos flux de cash, atterrissage bancaire et alertes de liquidité IA.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <button 
              className="btn btn-secondary"
              onClick={fetchForecast}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)' }}
            >
              <RefreshCw size={16} className={loading ? 'spin' : ''} /> Recalculer
            </button>
          </div>
        </div>
      </div>

      {/* Top 3 Metric Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.25rem' }}>
        
        {/* Solde Disponible Actuel */}
        <div className="card" style={{ borderLeft: '4px solid #10b981' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Trésorerie Immédiate Disponible</span>
              <h3 style={{ margin: '0.25rem 0 0 0', fontSize: '1.6rem', fontWeight: 800, color: soldeActuel >= 0 ? '#059669' : '#dc2626' }}>
                {formatFCFA(soldeActuel)}
              </h3>
            </div>
            <div style={{ background: '#d1fae5', padding: '0.5rem', borderRadius: 'var(--radius-md)', color: '#059669' }}>
              <Landmark size={24} />
            </div>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', margin: '0.5rem 0 0 0' }}>
            Solde net consolidé des comptes banques (52) et caisses (57).
          </p>
        </div>

        {/* Créances Clients */}
        <div className="card" style={{ borderLeft: '4px solid #3b82f6' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Créances Clients à Recouvrer (411)</span>
              <h3 style={{ margin: '0.25rem 0 0 0', fontSize: '1.6rem', fontWeight: 800, color: '#2563eb' }}>
                {formatFCFA(creancesClients)}
              </h3>
            </div>
            <div style={{ background: '#dbeafe', padding: '0.5rem', borderRadius: 'var(--radius-md)', color: '#2563eb' }}>
              <ArrowUpRight size={24} />
            </div>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', margin: '0.5rem 0 0 0' }}>
            Réservoir d'encaissements futurs injecté dans la trajectoire de cash.
          </p>
        </div>

        {/* Dettes Fournisseurs */}
        <div className="card" style={{ borderLeft: '4px solid #f59e0b' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Dettes Fournisseurs à Régler (401)</span>
              <h3 style={{ margin: '0.25rem 0 0 0', fontSize: '1.6rem', fontWeight: 800, color: '#d97706' }}>
                {formatFCFA(dettesFournisseurs)}
              </h3>
            </div>
            <div style={{ background: '#fef3c7', padding: '0.5rem', borderRadius: 'var(--radius-md)', color: '#d97706' }}>
              <ArrowDownRight size={24} />
            </div>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', margin: '0.5rem 0 0 0' }}>
            Engagements de décaissement prioritaires pour préserver le crédit fournisseur.
          </p>
        </div>

      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem', flexWrap: 'wrap' }}>
        <button 
          onClick={() => setActiveTab('grid')}
          style={{
            padding: '0.65rem 1.25rem', borderRadius: 'var(--radius-md)', border: 'none',
            background: activeTab === 'grid' ? 'var(--color-primary)' : 'transparent',
            color: activeTab === 'grid' ? '#fff' : 'var(--color-text-muted)',
            fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem'
          }}
        >
          <Calendar size={18} /> Grille Prévisionnelle (4 Mois)
        </button>
        <button 
          onClick={() => setActiveTab('simulation')}
          style={{
            padding: '0.65rem 1.25rem', borderRadius: 'var(--radius-md)', border: 'none',
            background: activeTab === 'simulation' ? 'var(--color-primary)' : 'transparent',
            color: activeTab === 'simulation' ? '#fff' : 'var(--color-text-muted)',
            fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem'
          }}
        >
          <Sliders size={18} /> Simulateur de Scénarios Stress-Test
        </button>
        <button 
          onClick={() => setActiveTab('recommendations')}
          style={{
            padding: '0.65rem 1.25rem', borderRadius: 'var(--radius-md)', border: 'none',
            background: activeTab === 'recommendations' ? 'var(--color-primary)' : 'transparent',
            color: activeTab === 'recommendations' ? '#fff' : 'var(--color-text-muted)',
            fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem'
          }}
        >
          <Sparkles size={18} /> Conseils & Recommandations Copilote IA
        </button>
      </div>

      {/* Tab 1: Grille Prévisionnelle */}
      {activeTab === 'grid' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* 4-Month Cards Summary */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
            {projections.map(p => (
              <div 
                key={p.index} 
                className="card" 
                style={{ 
                  borderTop: `4px solid ${p.soldeFin >= 0 ? '#10b981' : '#ef4444'}`,
                  background: p.isCurrent ? 'rgba(59, 130, 246, 0.03)' : 'var(--color-bg-card)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <span style={{ fontWeight: 700, fontSize: '1rem' }}>{p.mois}</span>
                  {p.isCurrent && (
                    <span style={{ background: '#e0f2fe', color: '#0369a1', fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '12px', fontWeight: 700 }}>
                      Mois en cours
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.85rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--color-text-muted)' }}>
                    <span>Solde début :</span>
                    <span style={{ fontWeight: 600 }}>{formatFCFA(p.soldeDebut)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#059669' }}>
                    <span>(+) Entrées :</span>
                    <span style={{ fontWeight: 700 }}>+{formatFCFA(p.encaissements.total)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#dc2626' }}>
                    <span>(-) Sorties :</span>
                    <span style={{ fontWeight: 700 }}>-{formatFCFA(p.decaissements.total)}</span>
                  </div>
                  <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '0.5rem', marginTop: '0.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontWeight: 700 }}>Solde fin :</span>
                    <span style={{ fontSize: '1.2rem', fontWeight: 800, color: p.soldeFin >= 0 ? '#059669' : '#dc2626' }}>
                      {formatFCFA(p.soldeFin)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Detailed Forecast Table */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Détail des Lignes de Trésorerie par Mois</h3>
            </div>
            
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ background: 'var(--color-bg-light)', borderBottom: '2px solid var(--color-border)' }}>
                    <th style={{ padding: '0.85rem 1.25rem', textAlign: 'left' }}>Ligne de Flux</th>
                    {projections.map(p => (
                      <th key={p.index} style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>
                        {p.mois}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Solde Début */}
                  <tr style={{ background: 'rgba(59, 130, 246, 0.05)', fontWeight: 700, borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '0.75rem 1.25rem' }}>SOLDE D'OUVERTURE DE TRÉSORERIE</td>
                    {projections.map(p => (
                      <td key={p.index} style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                        {formatFCFA(p.soldeDebut)}
                      </td>
                    ))}
                  </tr>

                  {/* Section Entrées */}
                  <tr style={{ background: 'var(--color-bg-light)', fontWeight: 700, color: '#059669' }}>
                    <td colSpan={5} style={{ padding: '0.6rem 1.25rem', fontSize: '0.8rem', textTransform: 'uppercase' }}>
                      1. Flux Entrants (Encaissements Prévisionnels)
                    </td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '0.65rem 1.25rem', paddingLeft: '2rem' }}>• Recouvrement créances clients (411)</td>
                    {projections.map(p => (
                      <td key={p.index} style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>
                        {formatFCFA(p.encaissements.recouvrementClients)}
                      </td>
                    ))}
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '0.65rem 1.25rem', paddingLeft: '2rem' }}>• Ventes & Encaissements au comptant (70)</td>
                    {projections.map(p => (
                      <td key={p.index} style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>
                        {formatFCFA(p.encaissements.ventesPrevisionnelles)}
                      </td>
                    ))}
                  </tr>
                  <tr style={{ borderBottom: '2px solid var(--color-border)', background: 'rgba(16, 185, 129, 0.05)', fontWeight: 700, color: '#065f46' }}>
                    <td style={{ padding: '0.75rem 1.25rem' }}>SOUS-TOTAL ENCAISSEMENTS</td>
                    {projections.map(p => (
                      <td key={p.index} style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                        +{formatFCFA(p.encaissements.total)}
                      </td>
                    ))}
                  </tr>

                  {/* Section Sorties */}
                  <tr style={{ background: 'var(--color-bg-light)', fontWeight: 700, color: '#dc2626' }}>
                    <td colSpan={5} style={{ padding: '0.6rem 1.25rem', fontSize: '0.8rem', textTransform: 'uppercase' }}>
                      2. Flux Sortants (Décaissements Prévisionnels)
                    </td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '0.65rem 1.25rem', paddingLeft: '2rem' }}>• Règlements dettes fournisseurs (401)</td>
                    {projections.map(p => (
                      <td key={p.index} style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>
                        {formatFCFA(p.decaissements.fournisseurs)}
                      </td>
                    ))}
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '0.65rem 1.25rem', paddingLeft: '2rem' }}>• Salaires & Rémunérations (66)</td>
                    {projections.map(p => (
                      <td key={p.index} style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>
                        {formatFCFA(p.decaissements.salaires)}
                      </td>
                    ))}
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '0.65rem 1.25rem', paddingLeft: '2rem' }}>• Loyers, Énergie & Charges Externes (61/62)</td>
                    {projections.map(p => (
                      <td key={p.index} style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>
                        {formatFCFA(p.decaissements.chargesExternes)}
                      </td>
                    ))}
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '0.65rem 1.25rem', paddingLeft: '2rem' }}>• Fiscalité, TVA & Acomptes (44)</td>
                    {projections.map(p => (
                      <td key={p.index} style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>
                        {formatFCFA(p.decaissements.impotsTaxes)}
                      </td>
                    ))}
                  </tr>
                  <tr style={{ borderBottom: '2px solid var(--color-border)', background: 'rgba(239, 68, 68, 0.05)', fontWeight: 700, color: '#991b1b' }}>
                    <td style={{ padding: '0.75rem 1.25rem' }}>SOUS-TOTAL DÉCAISSEMENTS</td>
                    {projections.map(p => (
                      <td key={p.index} style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                        -{formatFCFA(p.decaissements.total)}
                      </td>
                    ))}
                  </tr>

                  {/* Variation nette */}
                  <tr style={{ borderBottom: '1px solid var(--color-border)', fontWeight: 600 }}>
                    <td style={{ padding: '0.75rem 1.25rem' }}>VARIATION NETTE DU MOIS</td>
                    {projections.map(p => (
                      <td key={p.index} style={{ padding: '0.75rem 1rem', textAlign: 'right', color: p.variationNette >= 0 ? '#059669' : '#dc2626' }}>
                        {p.variationNette >= 0 ? '+' : ''}{formatFCFA(p.variationNette)}
                      </td>
                    ))}
                  </tr>

                  {/* Solde de Clôture */}
                  <tr style={{ background: '#f8fafc', fontWeight: 800, fontSize: '1rem', borderTop: '2px solid var(--color-border)' }}>
                    <td style={{ padding: '0.9rem 1.25rem' }}>= SOLDE DE FIN DE MOIS (ATTERRISSAGE)</td>
                    {projections.map(p => (
                      <td key={p.index} style={{ padding: '0.9rem 1rem', textAlign: 'right', color: p.soldeFin >= 0 ? '#059669' : '#dc2626' }}>
                        {formatFCFA(p.soldeFin)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

        </div>
      )}

      {/* Tab 2: Simulation Stress-Test */}
      {activeTab === 'simulation' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          <div className="card">
            <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.1rem' }}>
              <Sliders size={20} color="var(--color-primary)" />
              Simulateur de Sensibilité & Scénarios Stress-Test
            </h3>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', marginTop: '-0.25rem' }}>
              Ajustez les curseurs ci-dessous pour tester immédiatement la résistance de votre trésorerie en cas de baisse d'activité ou de retards de paiement clients.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginTop: '1rem' }}>
              
              {/* Curseur 1: Retard client */}
              <div style={{ background: 'var(--color-bg-light)', padding: '1.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <label style={{ fontWeight: 600, fontSize: '0.9rem' }}>Retard additionnel de paiement client</label>
                  <span style={{ fontWeight: 700, color: simClientDelay > 0 ? '#dc2626' : '#2563eb' }}>
                    +{simClientDelay} jours
                  </span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="45" 
                  step="5" 
                  value={simClientDelay} 
                  onChange={e => setSimClientDelay(parseInt(e.target.value))}
                  style={{ width: '100%' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
                  <span>0 jour (normal)</span>
                  <span>+15j</span>
                  <span>+30j</span>
                  <span>+45j (retard sévère)</span>
                </div>
              </div>

              {/* Curseur 2: Variation des ventes */}
              <div style={{ background: 'var(--color-bg-light)', padding: '1.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <label style={{ fontWeight: 600, fontSize: '0.9rem' }}>Variation du Chiffre d'Affaires prévisionnel</label>
                  <span style={{ fontWeight: 700, color: simSalesVariation >= 0 ? '#059669' : '#dc2626' }}>
                    {simSalesVariation >= 0 ? '+' : ''}{simSalesVariation}%
                  </span>
                </div>
                <input 
                  type="range" 
                  min="-30" 
                  max="30" 
                  step="5" 
                  value={simSalesVariation} 
                  onChange={e => setSimSalesVariation(parseInt(e.target.value))}
                  style={{ width: '100%' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
                  <span>-30% (crise)</span>
                  <span>0% (neutre)</span>
                  <span>+30% (croissance)</span>
                </div>
              </div>

            </div>
          </div>

          {/* Résultat du scénario simulé */}
          <div className="card">
            <h4 style={{ margin: '0 0 1rem 0' }}>Impact sur l'Atterrissage de Fin de Période (M+3)</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
              {simulatedProjections.map(p => (
                <div key={p.index} style={{ padding: '1rem', borderRadius: 'var(--radius-md)', border: `1px solid ${p.simulatedSoldeFin >= 0 ? '#bbf7d0' : '#fecaca'}`, background: p.simulatedSoldeFin >= 0 ? '#f0fdf4' : '#fef2f2' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>{p.mois}</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 800, color: p.simulatedSoldeFin >= 0 ? '#15803d' : '#b91c1c' }}>
                    {formatFCFA(p.simulatedSoldeFin)}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
                    Écart vs scénario de base : {formatFCFA(p.simulatedSoldeFin - p.soldeFin)}
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* Tab 3: Recommandations IA */}
      {activeTab === 'recommendations' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {aiRecommendations.map((rec, idx) => {
            let bg = '#eff6ff';
            let border = '#3b82f6';
            let icon = <Info size={22} color="#2563eb" />;

            if (rec.type === 'danger') {
              bg = '#fee2e2';
              border = '#ef4444';
              icon = <AlertTriangle size={22} color="#dc2626" />;
            } else if (rec.type === 'warning') {
              bg = '#fef3c7';
              border = '#f59e0b';
              icon = <AlertTriangle size={22} color="#d97706" />;
            } else if (rec.type === 'success') {
              bg = '#d1fae5';
              border = '#10b981';
              icon = <CheckCircle size={22} color="#059669" />;
            }

            return (
              <div 
                key={idx} 
                className="card" 
                style={{ 
                  background: bg, 
                  borderLeft: `4px solid ${border}`,
                  padding: '1.25rem',
                  display: 'flex',
                  gap: '1rem',
                  alignItems: 'flex-start'
                }}
              >
                <div>{icon}</div>
                <div>
                  <h4 style={{ margin: '0 0 0.25rem 0', fontSize: '1.05rem', fontWeight: 700 }}>
                    {rec.titre}
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.9rem', color: '#1e293b' }}>
                    {rec.message}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
};
