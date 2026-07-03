import { Landmark, ArrowUpRight, ArrowDownRight, RefreshCw } from 'lucide-react';

export const TresoModule = () => (
  <div className="card">
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
      <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
        <Landmark style={{ color: 'var(--color-primary)' }} />
        Trésorerie & Banque
      </h3>
      <button className="btn btn-secondary"><RefreshCw size={16} /> Rapprochement Automatique (IA)</button>
    </div>
    
    <div className="module-grid" style={{ marginBottom: '2rem' }}>
      <div className="card" style={{ borderLeft: '4px solid var(--color-success)' }}>
        <span className="stat-title">Encaisse Globale</span>
        <span className="stat-value">15 450 000 FCFA</span>
      </div>
      <div className="card" style={{ borderLeft: '4px solid var(--color-primary)' }}>
        <span className="stat-title">Entrées Prévues (Semaine)</span>
        <span className="stat-value" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <ArrowUpRight color="var(--color-success)" /> 2 100 000 FCFA
        </span>
      </div>
      <div className="card" style={{ borderLeft: '4px solid var(--color-error)' }}>
        <span className="stat-title">Sorties Prévues (Semaine)</span>
        <span className="stat-value" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <ArrowDownRight color="var(--color-error)" /> 1 430 000 FCFA
        </span>
      </div>
    </div>

    <div style={{ overflowX: 'auto' }}>
      <h4 style={{ marginBottom: '1rem' }}>Situations Bancaires & Comptes de liaison</h4>
      <table style={{ width: '100%', minWidth: '600px', borderCollapse: 'collapse', textAlign: 'left' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
            <th style={{ padding: '0.75rem 0' }}>Banque</th>
            <th>Solde Comptable</th>
            <th>Solde Relevé</th>
            <th>Écart</th>
            <th>Action IA</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
            <td style={{ padding: '1rem 0', fontWeight: '500' }}>Société Générale (SGC)</td>
            <td>8 200 000 FCFA</td>
            <td>8 200 000 FCFA</td>
            <td style={{ color: 'var(--color-success)' }}>0</td>
            <td><span style={{ fontSize: '0.875rem', padding: '0.25rem 0.5rem', background: 'var(--color-success-bg)', color: 'var(--color-success)', borderRadius: 'var(--radius-sm)' }}>Lettré</span></td>
          </tr>
          <tr>
            <td style={{ padding: '1rem 0', fontWeight: '500' }}>Ecobank Cameroun</td>
            <td>7 250 000 FCFA</td>
            <td>7 500 000 FCFA</td>
            <td style={{ color: 'var(--color-warning)' }}>+250 000 FCFA</td>
            <td><button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem' }}>Analyser l'écart</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
);
