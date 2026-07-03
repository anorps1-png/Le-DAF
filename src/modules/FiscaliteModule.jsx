import { Calculator, Calendar, AlertTriangle } from 'lucide-react';

export const FiscaliteModule = () => (
  <div className="card">
    <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <Calculator style={{ color: 'var(--color-primary)' }} />
      Fiscalité, Social & Reporting
    </h3>

    <div className="module-grid" style={{ marginBottom: '2rem' }}>
      <div className="card" style={{ background: 'var(--color-error-bg)', border: '1px solid var(--color-error)' }}>
        <h4 style={{ color: 'var(--color-error)', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <AlertTriangle size={18} /> Échéance Fiscale Proche
        </h4>
        <p style={{ fontWeight: 600, fontSize: '1.125rem' }}>Déclaration Mensuelle (TVA, Acompte)</p>
        <p style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>Avant le 15 du mois</p>
        <button className="btn btn-primary" style={{ marginTop: '1rem', width: '100%', background: 'var(--color-error)', borderColor: 'var(--color-error)' }}>Générer et Télédéclarer</button>
      </div>

      <div className="card" style={{ background: 'var(--color-surface-hover)' }}>
        <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <Calendar size={18} /> Déclarations Sociales (CNPS)
        </h4>
        <p style={{ fontWeight: 600, fontSize: '1.125rem' }}>Cotisations Trimestrielles</p>
        <p style={{ fontSize: '0.875rem', marginTop: '0.5rem', color: 'var(--color-text-muted)' }}>Déjà soumise le 10</p>
        <div style={{ marginTop: '1rem', padding: '0.5rem', background: 'var(--color-success-bg)', color: 'var(--color-success)', borderRadius: 'var(--radius-sm)', textAlign: 'center', fontSize: '0.875rem', fontWeight: '500' }}>À jour</div>
      </div>
    </div>

    <div>
      <h4 style={{ marginBottom: '1rem' }}>Reporting & États Financiers (SYSCOHADA)</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
          <div>
            <div style={{ fontWeight: 500 }}>Bilan & Compte de Résultat (Provisoire)</div>
            <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>Généré le 01/07/2026 avec écritures d'inventaire</div>
          </div>
          <button className="btn btn-secondary">Voir le Rapport</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
          <div>
            <div style={{ fontWeight: 500 }}>Tableau de Bord d'Analyse Financière</div>
            <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>SIG, Ratios, Évolution du BFR</div>
          </div>
          <button className="btn btn-secondary">Ouvrir</button>
        </div>
      </div>
    </div>
  </div>
);
