import { useState, useEffect } from 'react';
import { Users, AlertTriangle } from 'lucide-react';

export const TiersModule = () => {
  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('http://localhost:3001/api/tiers')
      .then(res => res.json())
      .then(data => {
        setTiers(data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  const clients = tiers.filter(t => t.type === 'Client');
  const fournisseurs = tiers.filter(t => t.type === 'Fournisseur');

  const totalCreances = clients.reduce((acc, c) => acc + (c.solde || 0), 0);
  const totalDettes = fournisseurs.reduce((acc, f) => acc + (f.solde || 0), 0);

  return (
    <div className="card">
      <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Users style={{ color: 'var(--color-primary)' }} />
        Gestion des Tiers (Synchronisé avec SQLite)
      </h3>
      
      <div className="module-grid">
        <div className="card" style={{ background: 'rgba(255,255,255,0.4)', backdropFilter: 'none' }}>
          <h4 style={{ marginBottom: '1rem' }}>Créances Clients</h4>
          <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--color-text-main)' }}>
            {totalCreances.toLocaleString()} FCFA
          </div>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>{clients.length} clients enregistrés</p>
          <button className="btn btn-primary" style={{ width: '100%' }}>Lancer les relances automatiques</button>
        </div>
        
        <div className="card" style={{ background: 'rgba(255,255,255,0.4)', backdropFilter: 'none' }}>
          <h4 style={{ marginBottom: '1rem' }}>Dettes Fournisseurs</h4>
          <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--color-text-main)' }}>
            {totalDettes.toLocaleString()} FCFA
          </div>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>{fournisseurs.length} fournisseurs enregistrés</p>
          <button className="btn btn-secondary" style={{ width: '100%' }}>Préparer les règlements</button>
        </div>
      </div>
      
      <div style={{ marginTop: '2rem' }}>
        <h4 style={{ marginBottom: '1rem' }}>Liste des Tiers</h4>
        {loading ? (
          <p>Chargement depuis la base de données...</p>
        ) : tiers.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', background: 'rgba(255,255,255,0.5)', borderRadius: 'var(--radius-md)' }}>
            <AlertTriangle size={32} color="var(--color-warning)" style={{ margin: '0 auto 1rem' }} />
            <p>Aucun tiers trouvé dans la base.</p>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>Utilisez le module d'importation Excel pour ajouter vos clients et fournisseurs.</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
                <th style={{ padding: '0.75rem 0' }}>Type</th>
                <th>Nom</th>
                <th>Compte</th>
                <th>Solde</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map(t => (
                <tr key={t.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                  <td style={{ padding: '0.75rem 0' }}>{t.type}</td>
                  <td style={{ fontWeight: 500 }}>{t.nom}</td>
                  <td>{t.compte_comptable}</td>
                  <td style={{ color: t.solde > 0 ? 'var(--color-success)' : 'inherit' }}>{t.solde.toLocaleString()} FCFA</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
