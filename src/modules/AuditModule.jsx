import { useState, useEffect } from 'react';
import { ShieldAlert, BrainCircuit, CheckCircle, AlertTriangle } from 'lucide-react';

export const AuditModule = () => {
  const [anomalies, setAnomalies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeAnomaly, setActiveAnomaly] = useState(null);
  const [aiAdvice, setAiAdvice] = useState(null);
  const [loadingAi, setLoadingAi] = useState(false);

  useEffect(() => {
    fetchAudit();
  }, []);

  const fetchAudit = async () => {
    setLoading(true);
    try {
      const res = await fetch('http://localhost:3001/api/audit');
      const data = await res.json();
      setAnomalies(data);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const askAdvice = async (anomalyGroup, ligne) => {
    setActiveAnomaly(ligne);
    setAiAdvice(null);
    setLoadingAi(true);
    try {
      const res = await fetch('http://localhost:3001/api/audit/advice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anomaly: { type: anomalyGroup.type, rule: anomalyGroup.description, data: ligne } })
      });
      const data = await res.json();
      setAiAdvice(data);
    } catch (e) {
      console.error(e);
    }
    setLoadingAi(false);
  };

  const applyCorrection = async () => {
    if (!aiAdvice?.sql) return;
    try {
      const res = await fetch('http://localhost:3001/api/audit/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: aiAdvice.sql })
      });
      const data = await res.json();
      if (data.success) {
        alert("Correction appliquée avec succès !");
        setActiveAnomaly(null);
        setAiAdvice(null);
        fetchAudit(); // Rafraichir les anomalies
      } else {
        alert("Erreur: " + data.error);
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <ShieldAlert size={32} color="var(--color-primary)" />
        <div>
          <h1 style={{ margin: 0, fontSize: '1.75rem', color: 'var(--color-text-main)' }}>Audit et Conformité OHADA</h1>
          <p style={{ margin: '0.25rem 0 0 0', color: 'var(--color-text-muted)' }}>Détection des anomalies et corrections assistées par IA</p>
        </div>
      </div>

      {loading ? (
        <p>Analyse de la base de données en cours...</p>
      ) : anomalies.length === 0 ? (
        <div style={{ background: '#ecfdf5', padding: '2rem', borderRadius: '1rem', textAlign: 'center', color: '#065f46' }}>
          <CheckCircle size={48} style={{ margin: '0 auto 1rem auto' }} />
          <h3>Aucune anomalie détectée !</h3>
          <p>Votre comptabilité semble parfaitement conforme aux règles OHADA de base.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {anomalies.map((group, i) => (
            <div key={i} style={{ background: 'white', borderRadius: '1rem', padding: '1.5rem', boxShadow: 'var(--shadow-sm)' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#b91c1c', marginTop: 0 }}>
                <AlertTriangle size={20} /> {group.type}
              </h3>
              <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>{group.description}</p>
              
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--color-border)', textAlign: 'left' }}>
                    <th style={{ padding: '0.5rem' }}>ID / Date</th>
                    <th style={{ padding: '0.5rem' }}>Compte</th>
                    <th style={{ padding: '0.5rem' }}>Libellé</th>
                    <th style={{ padding: '0.5rem' }}>Débit / Crédit</th>
                    <th style={{ padding: '0.5rem' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {group.data.map((ligne, j) => (
                    <tr key={j} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '0.5rem' }}>{ligne.id || '-'} <br/><span style={{ color: 'gray', fontSize: '0.75rem'}}>{ligne.date || '-'}</span></td>
                      <td style={{ padding: '0.5rem', fontWeight: 'bold' }}>{ligne.compte}</td>
                      <td style={{ padding: '0.5rem' }}>{ligne.libelle || '-'}</td>
                      <td style={{ padding: '0.5rem' }}>D: {ligne.debit || 0} <br/>C: {ligne.credit || 0}</td>
                      <td style={{ padding: '0.5rem' }}>
                        <button 
                          onClick={() => askAdvice(group, ligne)}
                          style={{ background: 'rgba(var(--color-primary-rgb), 0.1)', color: 'var(--color-primary)', border: 'none', padding: '0.5rem 1rem', borderRadius: '0.5rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                        >
                          <BrainCircuit size={16} /> Demander à l'IA
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* Modal IA */}
      {activeAnomaly && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'white', padding: '2rem', borderRadius: '1rem', maxWidth: '600px', width: '90%' }}>
            <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <BrainCircuit color="var(--color-primary)" /> Analyse de l'Agent Comptable
            </h3>
            
            {loadingAi ? (
              <p>L'IA analyse la conformité OHADA et prépare une correction...</p>
            ) : aiAdvice ? (
              <div>
                <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '0.5rem', marginBottom: '1.5rem', lineHeight: 1.5 }}>
                  {aiAdvice.analyse}
                </div>
                {aiAdvice.sql && (
                  <div style={{ marginBottom: '1.5rem' }}>
                    <p style={{ fontWeight: 'bold', margin: '0 0 0.5rem 0' }}>Correction proposée :</p>
                    <code style={{ background: '#1e293b', color: '#a5b4fc', padding: '0.75rem', borderRadius: '0.5rem', display: 'block', fontSize: '0.85rem' }}>
                      {aiAdvice.sql}
                    </code>
                  </div>
                )}
                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                  <button onClick={() => setActiveAnomaly(null)} style={{ padding: '0.75rem 1.5rem', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: '0.5rem', cursor: 'pointer' }}>
                    Annuler
                  </button>
                  <button 
                    onClick={applyCorrection}
                    disabled={!aiAdvice.sql}
                    style={{ padding: '0.75rem 1.5rem', background: 'var(--color-primary)', color: 'white', border: 'none', borderRadius: '0.5rem', cursor: aiAdvice.sql ? 'pointer' : 'not-allowed', opacity: aiAdvice.sql ? 1 : 0.5 }}
                  >
                    Approuver et Corriger
                  </button>
                </div>
              </div>
            ) : (
              <p>Erreur lors de la communication avec l'IA.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
