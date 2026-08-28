import { useState } from 'react';
import { 
  UploadCloud, CheckCircle, Database, Trash2, AlertTriangle, 
  Wrench, Download, RefreshCw, Scale, ShieldCheck, ArrowRight 
} from 'lucide-react';

export const ImportModule = () => {
  const [activeTab, setActiveTab] = useState('import'); // 'import', 'auto-fix'
  const [file, setFile] = useState(null);
  const [type, setType] = useState('journal');
  const [status, setStatus] = useState('');
  const [imbalanceData, setImbalanceData] = useState(null);
  const [loading, setLoading] = useState(false);

  // States pour la rubrique de correction autonome
  const [fixFile, setFixFile] = useState(null);
  const [fixStatus, setFixStatus] = useState('');
  const [fixImbalance, setFixImbalance] = useState(null);
  const [fixLoading, setFixLoading] = useState(false);

  const formatFCFA = (val) => {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'XOF', maximumFractionDigits: 0 }).format(val || 0);
  };

  const handleUpload = async () => {
    if (!file) {
      setStatus('Veuillez sélectionner un fichier Excel.');
      return;
    }
    setLoading(true);
    setStatus('Importation et analyse comptable en cours...');
    setImbalanceData(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);

    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        setStatus(`Succès : ${data.message}`);
        setFile(null);
        setImbalanceData(null);
      } else {
        setStatus(`Erreur : ${data.error}`);
        if (data.imbalance) {
          setImbalanceData(data.imbalance);
        }
      }
    } catch (err) {
      setStatus('Erreur de connexion au serveur.');
    }
    setLoading(false);
  };

  // Télécharger le fichier corrigé & équilibré
  const handleDownloadFixedExcel = async (targetFile) => {
    const f = targetFile || file || fixFile;
    if (!f) {
      setStatus("Veuillez d'abord sélectionner un fichier Excel.");
      return;
    }

    setLoading(true);
    setStatus("⏳ Génération du fichier Excel équilibré SYSCOHADA en cours...");
    const formData = new FormData();
    formData.append('file', f);

    try {
      const res = await fetch('/api/import/fix-excel', {
        method: 'POST',
        body: formData
      });

      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'journal_equilibre_syscohada.xlsx';
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        setStatus('Succès : Fichier Excel corrigé et équilibré téléchargé avec succès !');
      } else {
        setStatus("Erreur : Impossible de générer le fichier corrigé.");
      }
    } catch (e) {
      console.error(e);
      setStatus("Erreur de connexion réseau.");
    }
    setLoading(false);
  };

  // Appliquer la correction et importer en base en 1-clic
  const handleAutoFixAndImport = async (targetFile) => {
    const f = targetFile || file || fixFile;
    setLoading(true);
    setStatus('⏳ Équilibrage en partie double et enregistrement en base en cours...');

    try {
      let res;
      if (f) {
        const formData = new FormData();
        formData.append('file', f);
        res = await fetch('/api/import/auto-fix-and-import', {
          method: 'POST',
          body: formData
        });
      } else if (imbalanceData && imbalanceData.balancingRow) {
        res = await fetch('/api/import/auto-fix-and-import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ journalRows: [imbalanceData.balancingRow] })
        });
      } else {
        setStatus('Veuillez sélectionner un fichier à équilibrer.');
        setLoading(false);
        return;
      }

      const data = await res.json();
      if (data.success) {
        setStatus(`Succès : ${data.message}`);
        setImbalanceData(null);
        setFixImbalance(null);
      } else {
        setStatus(`Erreur : ${data.error || "Erreur lors de la correction automatique."}`);
      }
    } catch (e) {
      console.error(e);
      setStatus("Erreur réseau de communication avec le serveur.");
    }
    setLoading(false);
  };

  const handleClearDB = async () => {
    if (!window.confirm("Êtes-vous sûr de vouloir vider intégralement votre base de données locale (Journal, Tiers, Écritures) ?\n\nNote : Votre base de données Supabase Cloud sera préservée intacte.")) {
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/clear', { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setStatus(`Succès : ${data.message}`);
        setImbalanceData(null);
      } else {
        setStatus(`Erreur : ${data.error}`);
      }
    } catch (err) {
      setStatus('Erreur de connexion au serveur.');
    }
    setLoading(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Title & Header Banner */}
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
              justifyContent: 'center'
            }}>
              <Database size={32} color="#60a5fa" />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#f8fafc' }}>
                Importation & Correction de Données Excel
              </h2>
              <p style={{ margin: '0.25rem 0 0 0', color: '#94a3b8', fontSize: '0.9rem' }}>
                Alimentez la base de données, générez vos écritures automatiquement ou corrigez les fichiers déséquilibrés selon les règles de l'art SYSCOHADA.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button 
              className={`btn ${activeTab === 'import' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveTab('import')}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}
            >
              <UploadCloud size={18} /> Importation & Saisie
            </button>
            <button 
              className={`btn ${activeTab === 'auto-fix' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveTab('auto-fix')}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, background: activeTab === 'auto-fix' ? '#d97706' : undefined, borderColor: activeTab === 'auto-fix' ? '#d97706' : undefined }}
            >
              <Wrench size={18} /> Rubrique Correction & Équilibrage
            </button>
          </div>
        </div>
      </div>

      {/* TAB 1: IMPORTATION STANDARD */}
      {activeTab === 'import' && (
        <div className="card">
          <div style={{ maxWidth: '750px' }}>
            <h3 style={{ marginTop: 0, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.2rem' }}>
              <UploadCloud style={{ color: 'var(--color-primary)' }} />
              Importation de Fichiers Comptables (.xlsx)
            </h3>

            <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
              Importez vos fichiers Excel pour alimenter la base de données de l'Agent DAF. Vous pouvez télécharger ci-dessous les modèles officiels pré-formatés.
            </p>

            {/* Templates Download Section */}
            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
              <a 
                href="/api/template/factures"
                className="btn btn-primary" 
                style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', padding: '0.65rem 1.25rem', borderRadius: 'var(--radius-md)', background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)', color: '#fff', fontWeight: 600, boxShadow: '0 4px 12px rgba(37,99,235,0.2)' }}
              >
                📄 Modèle Excel Factures & Paiements (.xlsx)
              </a>
              <a 
                href="/api/template?type=journal"
                className="btn btn-secondary" 
                style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', border: '1px solid var(--color-border)', padding: '0.5rem 1rem', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-light)', color: 'var(--color-text-main)', fontWeight: 500 }}
              >
                📥 Modèle Journal Bruts
              </a>
              <a 
                href="/api/template?type=tiers"
                className="btn btn-secondary" 
                style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', border: '1px solid var(--color-border)', padding: '0.5rem 1rem', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-light)', color: 'var(--color-text-main)', fontWeight: 500 }}
              >
                📥 Modèle Tiers
              </a>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, fontSize: '0.9rem' }}>Type de données à importer</label>
              <select className="input" value={type} onChange={e => setType(e.target.value)} style={{ width: '100%', fontSize: '0.95rem' }}>
                <option value="factures">🧾 Saisie Automatique de Factures (Génération automatique d'écritures + ML)</option>
                <option value="journal">Journal Comptable Général (Écritures brutes)</option>
                <option value="journal_sage">Journal (Sage) — Export "Impression des journaux"</option>
                <option value="tiers">Fichier Tiers (Clients / Fournisseurs)</option>
              </select>

              {type === 'factures' && (
                <div style={{ marginTop: '0.75rem', padding: '0.75rem 1rem', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 'var(--radius-md)', color: '#1e40af', fontSize: '0.85rem' }}>
                  ⚡ <strong>Génération Automatique Partie Double :</strong> Chaque facture ou reçu importé générera l'écriture de Charge/Produit (via le Plan Comptable et la Mémoire Métier), la TVA (19.25%) et la contrepartie Tiers / Trésorerie équilibrée.
                </div>
              )}

              {type === 'journal_sage' && (
                <div style={{ marginTop: '0.75rem', padding: '0.75rem 1rem', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 'var(--radius-md)', color: '#1e40af', fontSize: '0.85rem' }}>
                  📘 <strong>Export Sage natif :</strong> déposez directement le fichier Excel généré par Sage 100
                  Comptabilité (menu Impressions &gt; Impression des journaux), sans le retravailler. Les codes
                  journaux sont lus automatiquement dans le fichier, quels qu'ils soient.
                </div>
              )}
            </div>

            <div 
              style={{ 
                border: '2px dashed var(--color-primary-light)', 
                borderRadius: 'var(--radius-lg)', 
                padding: '2.5rem 2rem', 
                textAlign: 'center', 
                marginBottom: '2rem', 
                background: 'rgba(255,255,255,0.5)',
                transition: 'all 0.3s'
              }}
            >
              <UploadCloud size={44} style={{ color: 'var(--color-primary)', margin: '0 auto 0.75rem' }} />
              <p style={{ fontWeight: 600, fontSize: '1.1rem', margin: 0 }}>Sélectionnez un fichier Excel</p>
              <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', display: 'block', marginTop: '0.25rem' }}>
                Formats pris en charge : .xlsx, .xls, .csv
              </span>
              <input 
                type="file" 
                accept=".xlsx, .xls, .csv" 
                onChange={e => setFile(e.target.files[0])} 
                style={{ marginTop: '1rem', width: '100%', maxWidth: '320px' }} 
              />
            </div>

            <button className="btn btn-primary" onClick={handleUpload} disabled={loading || !file} style={{ width: '100%', padding: '0.85rem', fontSize: '1rem', fontWeight: 600 }}>
              {loading ? 'Traitement & Contrôle comptable...' : 'Lancer l\'importation'}
            </button>

            {status && (
              <div style={{ 
                marginTop: '1.5rem', 
                padding: '1rem 1.25rem', 
                background: status.includes('Succès') ? '#f0fdf4' : '#fef2f2',
                color: status.includes('Succès') ? '#15803d' : '#991b1b',
                border: `1px solid ${status.includes('Succès') ? '#bbf7d0' : '#fecaca'}`,
                borderRadius: 'var(--radius-md)',
                display: 'flex', alignItems: 'center', gap: '0.75rem', fontWeight: 600, fontSize: '0.95rem'
              }}>
                {status.includes('Succès') ? <CheckCircle size={20} /> : <AlertTriangle size={20} />}
                <div>{status}</div>
              </div>
            )}

            {/* ASSISTANT DAF DE CORRECTION EN CAS DE DÉSÉQUILIBRE */}
            {imbalanceData && (
              <div style={{ 
                marginTop: '1.5rem', 
                background: '#fffbe8', 
                border: '2px solid #f59e0b', 
                borderRadius: 'var(--radius-lg)', 
                padding: '1.5rem',
                boxShadow: '0 10px 20px -5px rgba(245, 158, 11, 0.2)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                  <Wrench size={26} color="#d97706" />
                  <div>
                    <h4 style={{ margin: 0, fontSize: '1.15rem', color: '#b45309', fontWeight: 700 }}>
                      Assistant DAF : Proposition de Correction & Équilibrage SYSCOHADA
                    </h4>
                    <span style={{ fontSize: '0.85rem', color: '#92400e' }}>
                      Diagnostic en Partie Double de votre fichier déséquilibré
                    </span>
                  </div>
                </div>

                {/* Scorecards Débit/Crédit/Écart */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
                  <div style={{ background: '#ffffff', padding: '0.85rem 1rem', borderRadius: '8px', border: '1px solid #fcd34d' }}>
                    <div style={{ fontSize: '0.75rem', color: '#92400e', fontWeight: 600 }}>Total Débits Fichier</div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#dc2626' }}>{formatFCFA(imbalanceData.totalDebit)}</div>
                  </div>
                  <div style={{ background: '#ffffff', padding: '0.85rem 1rem', borderRadius: '8px', border: '1px solid #fcd34d' }}>
                    <div style={{ fontSize: '0.75rem', color: '#92400e', fontWeight: 600 }}>Total Crédits Fichier</div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#2563eb' }}>{formatFCFA(imbalanceData.totalCredit)}</div>
                  </div>
                  <div style={{ background: '#ffffff', padding: '0.85rem 1rem', borderRadius: '8px', border: '2px solid #f59e0b' }}>
                    <div style={{ fontSize: '0.75rem', color: '#b45309', fontWeight: 700 }}>⚡ Écart à Régulariser</div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#d97706' }}>{formatFCFA(imbalanceData.gap)}</div>
                  </div>
                </div>

                {/* Avis DAF & Règle SYSCOHADA */}
                <div style={{ background: 'rgba(255,255,255,0.7)', padding: '1rem', borderRadius: '8px', border: '1px dashed #d97706', marginBottom: '1.5rem', fontSize: '0.9rem', color: '#78350f' }}>
                  <strong>📜 Règle de l'Art SYSCOHADA :</strong>
                  <p style={{ margin: '0.35rem 0 0 0' }}>
                    Le total des débits excède le total des crédits de <strong>{formatFCFA(imbalanceData.gap)}</strong>. Conformément aux règles de partie double, le système propose de créer automatiquement la ligne de contrepartie créditeuse au compte <strong>{imbalanceData.suggestedAccount} ({imbalanceData.suggestedLabel})</strong>.
                  </p>
                </div>

                {/* Boutons d'Action */}
                <div style={{ display: 'flex', gap: '0.85rem', flexWrap: 'wrap' }}>
                  <button 
                    className="btn btn-primary" 
                    onClick={() => handleAutoFixAndImport()}
                    disabled={loading}
                    style={{ background: 'linear-gradient(135deg, #059669 0%, #047857 100%)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}
                  >
                    <ShieldCheck size={18} /> Équilibrer & Importer en Base (1 Clic)
                  </button>
                  <button 
                    className="btn btn-secondary" 
                    onClick={() => handleDownloadFixedExcel()}
                    disabled={loading}
                    style={{ background: '#ffffff', border: '1px solid #d97706', color: '#b45309', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}
                  >
                    <Download size={18} /> Télécharger l'Excel Corrigé & Équilibré (.xlsx)
                  </button>
                </div>
              </div>
            )}

            {/* Zone de Danger */}
            <div style={{ marginTop: '3rem', borderTop: '1px solid var(--color-border)', paddingTop: '2rem' }}>
              <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#b91c1c', marginBottom: '1rem' }}>
                <AlertTriangle size={18} /> Zone de réinitialisation
              </h4>
              <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
                Si vous souhaitez recommencer à zéro sur un nouveau dossier, vous pouvez vider la base de données.
              </p>
              <button 
                onClick={handleClearDB}
                disabled={loading}
                style={{ 
                  background: '#fee2e2', 
                  color: '#b91c1c', 
                  border: '1px solid #fca5a5', 
                  padding: '0.65rem 1.2rem', 
                  borderRadius: 'var(--radius-md)', 
                  cursor: 'pointer', 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '0.5rem',
                  fontWeight: 500
                }}
              >
                <Trash2 size={16} /> Vider la base de données
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: RUBRIQUE AUTONOME DE CORRECTION & ÉQUILIBRAGE EXCEL */}
      {activeTab === 'auto-fix' && (
        <div className="card">
          <div style={{ maxWidth: '800px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Scale size={28} color="#d97706" />
              <div>
                <h3 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700, color: 'var(--color-text-main)' }}>
                  Rubrique DAF : Diagnostic & Correction Autonome de Fichiers Excel
                </h3>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
                  Chargez n'importe quel fichier journal ou facture déséquilibré. L'outil calcule l'écart, génère la partie double réglementaire SYSCOHADA et vous produit un fichier Excel 100% équilibré.
                </p>
              </div>
            </div>

            {/* Drop Zone pour la correction */}
            <div 
              style={{ 
                border: '2px dashed #f59e0b', 
                borderRadius: 'var(--radius-lg)', 
                padding: '2.5rem 2rem', 
                textAlign: 'center', 
                marginBottom: '2rem', 
                background: '#fffbe8'
              }}
            >
              <Wrench size={48} style={{ color: '#d97706', margin: '0 auto 0.75rem' }} />
              <p style={{ fontWeight: 700, fontSize: '1.15rem', color: '#92400e', margin: 0 }}>
                Déposez votre fichier Excel à analyser ou corriger
              </p>
              <span style={{ fontSize: '0.85rem', color: '#b45309', display: 'block', marginTop: '0.25rem' }}>
                Convient aux journaux bruts, balances ou fichiers de factures déséquilibrés
              </span>
              <input 
                type="file" 
                accept=".xlsx, .xls, .csv" 
                onChange={e => {
                  setFixFile(e.target.files[0] || null);
                  setFixStatus('');
                }} 
                style={{ marginTop: '1.25rem', width: '100%', maxWidth: '340px' }} 
              />
            </div>

            {fixFile && (
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <button 
                  className="btn btn-primary" 
                  onClick={() => handleDownloadFixedExcel(fixFile)}
                  disabled={loading}
                  style={{ flex: 1, padding: '0.85rem', fontSize: '0.95rem', fontWeight: 600, background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                >
                  <Download size={18} /> Télécharger le Fichier Excel Corrigé & Équilibré (.xlsx)
                </button>
                <button 
                  className="btn btn-primary" 
                  onClick={() => handleAutoFixAndImport(fixFile)}
                  disabled={loading}
                  style={{ flex: 1, padding: '0.85rem', fontSize: '0.95rem', fontWeight: 600, background: 'linear-gradient(135deg, #059669 0%, #047857 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                >
                  <ShieldCheck size={18} /> Équilibrer & Importer en Base en 1 Clic
                </button>
              </div>
            )}

            {/* Règles de l'art comptable expliquées */}
            <div style={{ marginTop: '2.5rem', background: 'var(--color-bg-light)', padding: '1.5rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
              <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                📘 Principes de Correction Équilibre Partie Double (SYSCOHADA)
              </h4>
              <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.875rem', color: 'var(--color-text-muted)', lineHeight: '1.6' }}>
                <li><strong>Débit &gt; Crédit (Manque de Crédit) :</strong> L'écart est automatiquement affecté en contrepartie au compte <code>401100 (Fournisseurs - Dettes d'exploitation)</code> ou <code>471100 (Compte d'attente de régularisation)</code>.</li>
                <li><strong>Crédit &gt; Débit (Manque de Débit) :</strong> L'écart est automatiquement affecté au compte <code>411100 (Clients - Créances d'exploitation)</code>.</li>
                <li><strong>Légalité & Traçabilité :</strong> La ligne d'équilibrage est clairement identifiée sous le libellé <em>Régularisation Contrepartie (Équilibrage SYSCOHADA)</em> avec la référence <em>EQUILIBRE-SYSCOHADA</em>.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
