import { useState, useEffect } from 'react';
import { Calculator, Calendar, AlertTriangle, CheckCircle2, Plus, Trash2 } from 'lucide-react';

const currentMonth = () => new Date().toISOString().slice(0, 7);

const TvaPanel = () => {
  const [month, setMonth] = useState(currentMonth());
  const [tva, setTva] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    fetch(`/api/fiscalite/tva?month=${month}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) { setError(data.error); setTva(null); }
        else setTva(data);
      })
      .catch(() => setError('Connexion au serveur impossible.'))
      .finally(() => setLoading(false));
  }, [month]);

  return (
    <div>
      <div style={{ marginBottom: '1.5rem', maxWidth: '240px' }}>
        <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', fontWeight: 500 }}>Période</label>
        <input type="month" className="input" style={{ padding: '0.5rem', width: '100%' }} value={month} onChange={e => setMonth(e.target.value)} />
      </div>

      {loading && <p style={{ color: 'var(--color-text-muted)' }}>Calcul en cours...</p>}
      {error && <p style={{ color: 'var(--color-error)' }}>{error}</p>}

      {!loading && !error && tva && (
        <>
          <div className="module-grid">
            <div className="card" style={{ background: 'var(--color-surface-hover)' }}>
              <span style={{ display: 'block', fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>TVA Collectée (443)</span>
              <span style={{ fontSize: '1.375rem', fontWeight: 700 }}>{tva.collectee.toLocaleString()} FCFA</span>
            </div>
            <div className="card" style={{ background: 'var(--color-surface-hover)' }}>
              <span style={{ display: 'block', fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>TVA Déductible (445)</span>
              <span style={{ fontSize: '1.375rem', fontWeight: 700 }}>{tva.deductible.toLocaleString()} FCFA</span>
            </div>
          </div>

          <div className="card" style={{ marginTop: '1.5rem', background: tva.solde >= 0 ? 'var(--color-error-bg)' : 'var(--color-success-bg)' }}>
            <span style={{ display: 'block', fontSize: '0.9rem', fontWeight: 500, marginBottom: '0.35rem', color: tva.solde >= 0 ? 'var(--color-error)' : 'var(--color-success)' }}>
              {tva.solde >= 0 ? 'TVA à payer' : 'Crédit de TVA reportable'}
            </span>
            <span style={{ fontSize: '1.75rem', fontWeight: 800, color: tva.solde >= 0 ? 'var(--color-error)' : 'var(--color-success)' }}>
              {Math.abs(tva.solde).toLocaleString()} FCFA
            </span>
          </div>
        </>
      )}
    </div>
  );
};

const EcheancesPanel = () => {
  const [echeances, setEcheances] = useState([]);
  const [form, setForm] = useState({ libelle: '', date_echeance: '' });
  const [error, setError] = useState('');

  const load = () => {
    fetch('/api/fiscalite/echeances')
      .then(res => res.json())
      .then(data => setEcheances(Array.isArray(data) ? data : []))
      .catch(e => console.error(e));
  };

  useEffect(() => { load(); }, []);

  const addEcheance = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.libelle || !form.date_echeance) {
      setError('Libellé et date sont obligatoires.');
      return;
    }
    try {
      const res = await fetch('/api/fiscalite/echeances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (data.success) {
        setForm({ libelle: '', date_echeance: '' });
        load();
      } else {
        setError(data.error || "Erreur lors de l'ajout.");
      }
    } catch (e) {
      setError('Connexion au serveur impossible.');
    }
  };

  const toggleStatut = async (echeance) => {
    const next = echeance.statut === 'À faire' ? 'Soumis' : 'À faire';
    await fetch(`/api/fiscalite/echeances/${echeance.id}/statut`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ statut: next })
    }).catch(e => console.error(e));
    load();
  };

  const remove = async (id) => {
    await fetch(`/api/fiscalite/echeances/${id}`, { method: 'DELETE' }).catch(e => console.error(e));
    load();
  };

  return (
    <div>
      <form onSubmit={addEcheance} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '200px' }}>
          <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.8rem', fontWeight: 500 }}>Libellé</label>
          <input className="input" style={{ padding: '0.5rem', width: '100%' }} placeholder="Ex: TVA Juin 2026" value={form.libelle} onChange={e => setForm({ ...form, libelle: e.target.value })} />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.8rem', fontWeight: 500 }}>Échéance</label>
          <input type="date" className="input" style={{ padding: '0.5rem' }} value={form.date_echeance} onChange={e => setForm({ ...form, date_echeance: e.target.value })} />
        </div>
        <button type="submit" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Plus size={16} /> Ajouter
        </button>
      </form>
      {error && <p style={{ color: 'var(--color-error)', marginBottom: '1rem' }}>{error}</p>}

      {echeances.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '2rem' }}>Aucune échéance enregistrée.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {echeances.map(ec => (
            <div key={ec.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
              <div>
                <div style={{ fontWeight: 500 }}>{ec.libelle}</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>Échéance : {ec.date_echeance}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <button
                  onClick={() => toggleStatut(ec)}
                  className="btn"
                  style={{
                    padding: '0.4rem 0.85rem', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', fontWeight: 500, border: 'none', cursor: 'pointer',
                    background: ec.statut === 'Soumis' ? 'var(--color-success-bg)' : 'var(--color-warning-bg)',
                    color: ec.statut === 'Soumis' ? 'var(--color-success)' : 'var(--color-warning)'
                  }}
                >
                  {ec.statut === 'Soumis' ? <CheckCircle2 size={14} style={{ marginRight: '0.3rem', verticalAlign: 'text-bottom' }} /> : null}
                  {ec.statut}
                </button>
                <button onClick={() => remove(ec.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }} title="Supprimer">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const RapportsPanel = ({ onNavigate }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
      <div>
        <div style={{ fontWeight: 500 }}>Bilan</div>
        <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>Actif / Passif SYSCOHADA, calculé depuis le journal</div>
      </div>
      <button className="btn btn-secondary" onClick={() => onNavigate && onNavigate('saisie', { tab: 'bilan' })}>Voir le Bilan</button>
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
      <div>
        <div style={{ fontWeight: 500 }}>Compte de Résultat</div>
        <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>Cascade SIG : CA → Marge → VA → EBE → Résultat Net</div>
      </div>
      <button className="btn btn-secondary" onClick={() => onNavigate && onNavigate('saisie', { tab: 'resultat' })}>Voir le Résultat</button>
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
      <div>
        <div style={{ fontWeight: 500 }}>Analyse Financière &amp; KPIs</div>
        <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>SIG, ratios, équilibre financier (FRNG/BFR/Trésorerie)</div>
      </div>
      <button className="btn btn-secondary" onClick={() => onNavigate && onNavigate('analyse')}>Ouvrir</button>
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
      <div>
        <div style={{ fontWeight: 500 }}>Grand Livre</div>
        <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>Détail chronologique des écritures par compte</div>
      </div>
      <button className="btn btn-secondary" onClick={() => onNavigate && onNavigate('saisie', { tab: 'grandlivre' })}>Ouvrir</button>
    </div>
  </div>
);

export const FiscaliteModule = ({ onNavigate } = {}) => {
  const [tab, setTab] = useState('tva');

  return (
    <div className="card">
      <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Calculator style={{ color: 'var(--color-primary)' }} />
        Fiscalité &amp; Reporting
      </h3>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '1rem' }}>
        <button className={`btn ${tab === 'tva' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('tva')}>
          <Calculator size={16} style={{ marginRight: '0.4rem', verticalAlign: 'text-bottom' }} /> TVA
        </button>
        <button className={`btn ${tab === 'echeances' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('echeances')}>
          <Calendar size={16} style={{ marginRight: '0.4rem', verticalAlign: 'text-bottom' }} /> Échéances
        </button>
        <button className={`btn ${tab === 'rapports' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('rapports')}>
          <AlertTriangle size={16} style={{ marginRight: '0.4rem', verticalAlign: 'text-bottom' }} /> Rapports
        </button>
      </div>

      {tab === 'tva' && <TvaPanel />}
      {tab === 'echeances' && <EcheancesPanel />}
      {tab === 'rapports' && <RapportsPanel onNavigate={onNavigate} />}
    </div>
  );
};
