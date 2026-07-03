import { useState } from 'react';
import { UploadCloud, CheckCircle, Database, Trash2, AlertTriangle } from 'lucide-react';

export const ImportModule = () => {
  const [file, setFile] = useState(null);
  const [type, setType] = useState('journal');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const handleUpload = async () => {
    if (!file) {
      setStatus('Veuillez sélectionner un fichier Excel.');
      return;
    }
    setLoading(true);
    setStatus('Importation en cours...');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);

    try {
      const res = await fetch('http://localhost:3001/api/import', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        setStatus(`Succès : ${data.message}`);
        setFile(null);
      } else {
        setStatus(`Erreur : ${data.error}`);
      }
    } catch (err) {
      setStatus('Erreur de connexion au serveur.');
    }
    setLoading(false);
  };

  const handleClearDB = async () => {
    if (!window.confirm("Êtes-vous sûr de vouloir vider intégralement la base de données (Journal et Tiers) ? Cette action est irréversible.")) {
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('http://localhost:3001/api/clear', { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setStatus(`Succès : ${data.message}`);
      } else {
        setStatus(`Erreur : ${data.error}`);
      }
    } catch (err) {
      setStatus('Erreur de connexion au serveur.');
    }
    setLoading(false);
  };

  return (
    <div className="card">
      <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Database style={{ color: 'var(--color-primary)' }} />
        Importation de Données (Excel)
      </h3>
      
      <div style={{ maxWidth: '600px' }}>
        <p style={{ color: 'var(--color-text-muted)', marginBottom: '2rem' }}>
          Importez vos fichiers Excel (.xlsx) pour alimenter la base de données de l'Agent. Vous pouvez importer votre Grand Livre, Balance, Journal ou Fichier Tiers.
        </p>

        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Type de données à importer</label>
          <select className="input" value={type} onChange={e => setType(e.target.value)}>
            <option value="journal">Journal Comptable (Grand Livre)</option>
            <option value="tiers">Fichier Tiers (Clients / Fournisseurs)</option>
            <option value="balance">Balance (Non implémenté)</option>
          </select>
        </div>

        <div 
          style={{ 
            border: '2px dashed var(--color-primary-light)', 
            borderRadius: 'var(--radius-lg)', 
            padding: '3rem 2rem', 
            textAlign: 'center', 
            marginBottom: '2rem', 
            background: 'rgba(255,255,255,0.4)',
            transition: 'all 0.3s'
          }}
        >
          <UploadCloud size={48} style={{ color: 'var(--color-primary)', margin: '0 auto 1rem' }} />
          <p style={{ fontWeight: 600, fontSize: '1.125rem' }}>Sélectionnez un fichier Excel</p>
          <input 
            type="file" 
            accept=".xlsx, .xls, .csv" 
            onChange={e => setFile(e.target.files[0])} 
            style={{ marginTop: '1rem', width: '100%', maxWidth: '300px' }} 
          />
        </div>

        <button className="btn btn-primary" onClick={handleUpload} disabled={loading || !file} style={{ width: '100%' }}>
          {loading ? 'Traitement en cours...' : 'Lancer l\'importation'}
        </button>

        {status && (
          <div style={{ 
            marginTop: '1rem', 
            padding: '1rem', 
            background: status.includes('Succès') ? 'var(--color-success-bg)' : 'var(--color-error-bg)',
            color: status.includes('Succès') ? 'var(--color-success)' : 'var(--color-error)',
            borderRadius: 'var(--radius-md)',
            display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 500
          }}>
            <CheckCircle size={18} /> {status}
          </div>
        )}

        <div style={{ marginTop: '3rem', borderTop: '1px solid var(--color-border)', paddingTop: '2rem' }}>
          <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#b91c1c', marginBottom: '1rem' }}>
            <AlertTriangle size={18} /> Zone de danger
          </h4>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
            Si vous souhaitez recommencer à zéro, vous pouvez vider intégralement la base de données. 
            Les prochaines importations viendront s'ajouter aux données existantes (mise à jour incrémentale).
          </p>
          <button 
            onClick={handleClearDB}
            disabled={loading}
            style={{ 
              background: '#fee2e2', 
              color: '#b91c1c', 
              border: '1px solid #fca5a5', 
              padding: '0.75rem 1.5rem', 
              borderRadius: 'var(--radius-md)', 
              cursor: 'pointer', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.5rem',
              fontWeight: 500
            }}
          >
            <Trash2 size={18} /> Vider la base de données
          </button>
        </div>
      </div>
    </div>
  );
};
