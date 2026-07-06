import { useState, useEffect, useRef, Fragment } from 'react';
import { FileText, BrainCircuit, Table, UploadCloud, CheckCircle } from 'lucide-react';

export const ComptabiliteModule = () => {
  const [activeTab, setActiveTab] = useState('saisie');
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef(null);
  const [uploadStatus, setUploadStatus] = useState('');
  const [manualData, setManualData] = useState({
    code_journal: 'OD',
    poste_budgetaire: '',
    date: new Date().toISOString().split('T')[0],
    compte: '',
    compte_tiers: '',
    libelle: '',
    n_facture: '',
    reference: '',
    debit: '0',
    credit: '0'
  });
  const [manualStatus, setManualStatus] = useState('');

  const fetchEtats = async (endpoint) => {
    setLoading(true);
    try {
      const res = await fetch(`http://localhost:3001/api/${endpoint}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (activeTab === 'journal') fetchEtats('journal');
    if (activeTab === 'balance') fetchEtats('balance');
    if (activeTab === 'bilan') fetchEtats('bilan');
    if (activeTab === 'resultat') fetchEtats('resultat');
  }, [activeTab]);

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploadStatus('Importation en cours...');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', 'journal'); // Treat uploaded file as a journal entry list (or invoices batch)

    try {
      const res = await fetch('http://localhost:3001/api/import', {
        method: 'POST',
        body: formData
      });
      const resData = await res.json();
      if (resData.success) {
        setUploadStatus(`Succès : ${resData.message}`);
        // Optionally switch to journal to see them
        setTimeout(() => setActiveTab('journal'), 2000);
      } else {
        setUploadStatus(`Erreur : ${resData.error}`);
      }
    } catch (err) {
      setUploadStatus('Erreur de connexion au serveur.');
    }
  };

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    if (!manualData.code_journal || !manualData.date || !manualData.compte || !manualData.libelle) {
      setManualStatus('Erreur : Veuillez remplir tous les champs obligatoires.');
      return;
    }
    setLoading(true);
    setManualStatus('Enregistrement de l\'écriture...');
    try {
      const res = await fetch('http://localhost:3001/api/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manualData)
      });
      const data = await res.json();
      if (data.success) {
        setManualStatus('Succès : L\'écriture a été enregistrée avec succès.');
        setManualData(prev => ({
          ...prev,
          compte: '',
          compte_tiers: '',
          libelle: '',
          n_facture: '',
          reference: '',
          debit: '0',
          credit: '0'
        }));
      } else {
        setManualStatus(`Erreur : ${data.error}`);
      }
    } catch (err) {
      setManualStatus('Erreur : Connexion au serveur impossible.');
    }
    setLoading(false);
  };

  const renderContent = () => {
    if (loading) return <div style={{ padding: '2rem', textAlign: 'center' }}>Chargement des données comptables...</div>;

    switch (activeTab) {
      case 'saisie':
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '2rem' }}>
            {/* Colonne 1 : Importation de fichiers */}
            <div>
              <h4 style={{ marginBottom: '1rem', color: 'var(--color-primary)' }}>Importation de fichiers</h4>
              <div 
                style={{ border: '2px dashed var(--color-primary-light)', borderRadius: 'var(--radius-xl)', padding: '4rem 2rem', textAlign: 'center', marginBottom: '2rem', background: 'rgba(255,255,255,0.4)', cursor: 'pointer', transition: 'all 0.3s' }} 
                onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.7)'} 
                onMouseOut={e => e.currentTarget.style.background = 'rgba(255,255,255,0.4)'}
                onClick={() => fileInputRef.current.click()}
              >
                <BrainCircuit size={56} style={{ color: 'var(--color-primary)', margin: '0 auto 1rem' }} />
                <p style={{ fontWeight: 600, fontSize: '1.25rem', color: 'var(--color-text-main)' }}>Déposez vos factures ou relevés bancaires</p>
                <p style={{ fontSize: '0.95rem', color: 'var(--color-text-muted)', maxWidth: '450px', margin: '0.5rem auto' }}>
                  L'Agent va extraire les données, les imputer dans les bons comptes SYSCOHADA et mettre à jour le Bilan et le Compte de Résultat automatiquement.
                </p>
                <button className="btn btn-primary" style={{ marginTop: '1.5rem' }}>Parcourir les documents</button>
                <input type="file" accept=".xlsx, .xls, .csv, .pdf" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileChange} />
              </div>

              {uploadStatus && (
                <div style={{ padding: '1rem', background: uploadStatus.includes('Succès') ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)', color: uploadStatus.includes('Succès') ? '#15803d' : '#b91c1c', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 500, justifyContent: 'center' }}>
                  <CheckCircle size={18} /> {uploadStatus}
                </div>
              )}
            </div>

            {/* Colonne 2 : Saisie Manuelle */}
            <div>
              <h4 style={{ marginBottom: '1rem', color: 'var(--color-primary-dark)' }}>Saisie manuelle d'écriture</h4>
              <form onSubmit={handleManualSubmit} style={{ background: 'rgba(255,255,255,0.3)', padding: '1.5rem', borderRadius: 'var(--radius-xl)', border: '1px solid var(--color-border)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', fontWeight: 500 }}>Code Journal *</label>
                    <select 
                      className="input" 
                      style={{ padding: '0.5rem' }}
                      value={manualData.code_journal} 
                      onChange={e => setManualData({...manualData, code_journal: e.target.value})}
                    >
                      <option value="AC">AC - Achat</option>
                      <option value="VE">VE - Vente</option>
                      <option value="BQ">BQ - Banque</option>
                      <option value="OD">OD - Opérations Diverses</option>
                      <option value="CA">CA - Caisse</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', fontWeight: 500 }}>Date *</label>
                    <input 
                      type="date" 
                      className="input" 
                      style={{ padding: '0.5rem' }}
                      value={manualData.date} 
                      onChange={e => setManualData({...manualData, date: e.target.value})} 
                      required 
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', fontWeight: 500 }}>N° Compte *</label>
                    <input 
                      type="text" 
                      className="input" 
                      style={{ padding: '0.5rem' }}
                      placeholder="Ex: 601100" 
                      value={manualData.compte} 
                      onChange={e => setManualData({...manualData, compte: e.target.value})} 
                      required 
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', fontWeight: 500 }}>Compte Tiers</label>
                    <input 
                      type="text" 
                      className="input" 
                      style={{ padding: '0.5rem' }}
                      placeholder="Ex: FO-001" 
                      value={manualData.compte_tiers} 
                      onChange={e => setManualData({...manualData, compte_tiers: e.target.value})} 
                    />
                  </div>
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', fontWeight: 500 }}>Libellé *</label>
                  <input 
                    type="text" 
                    className="input" 
                    style={{ padding: '0.5rem' }}
                    placeholder="Ex: Facture de marchandises" 
                    value={manualData.libelle} 
                    onChange={e => setManualData({...manualData, libelle: e.target.value})} 
                    required 
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginBottom: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.75rem', fontWeight: 500 }}>Budget</label>
                    <input 
                      type="text" 
                      className="input" 
                      style={{ padding: '0.5rem' }}
                      placeholder="Ex: ACHATS" 
                      value={manualData.poste_budgetaire} 
                      onChange={e => setManualData({...manualData, poste_budgetaire: e.target.value})} 
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.75rem', fontWeight: 500 }}>N° Fact.</label>
                    <input 
                      type="text" 
                      className="input" 
                      style={{ padding: '0.5rem' }}
                      placeholder="FA-26-004" 
                      value={manualData.n_facture} 
                      onChange={e => setManualData({...manualData, n_facture: e.target.value})} 
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.75rem', fontWeight: 500 }}>Réf.</label>
                    <input 
                      type="text" 
                      className="input" 
                      style={{ padding: '0.5rem' }}
                      placeholder="CHÈQUE 99" 
                      value={manualData.reference} 
                      onChange={e => setManualData({...manualData, reference: e.target.value})} 
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', fontWeight: 500 }}>Débit</label>
                    <input 
                      type="number" 
                      step="0.01" 
                      className="input" 
                      style={{ padding: '0.5rem' }}
                      placeholder="0" 
                      value={manualData.debit} 
                      onChange={e => setManualData({...manualData, debit: e.target.value})} 
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', fontWeight: 500 }}>Crédit</label>
                    <input 
                      type="number" 
                      step="0.01" 
                      className="input" 
                      style={{ padding: '0.5rem' }}
                      placeholder="0" 
                      value={manualData.credit} 
                      onChange={e => setManualData({...manualData, credit: e.target.value})} 
                    />
                  </div>
                </div>

                <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '0.5rem' }}>
                  Enregistrer
                </button>

                {manualStatus && (
                  <div style={{ 
                    marginTop: '1rem', 
                    padding: '0.75rem', 
                    background: manualStatus.includes('Succès') ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                    color: manualStatus.includes('Succès') ? '#15803d' : '#b91c1c',
                    borderRadius: 'var(--radius-md)',
                    display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 500, fontSize: '0.85rem'
                  }}>
                    <CheckCircle size={14} /> {manualStatus}
                  </div>
                )}
              </form>
            </div>
          </div>
        );

      case 'journal':
        return (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '900px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)', fontSize: '0.875rem', whiteSpace: 'nowrap' }}>
                  <th style={{ padding: '0.75rem 0' }}>Code Journal</th>
                  <th>Date</th>
                  <th>N° Facture</th>
                  <th>Référence</th>
                  <th>Compte</th>
                  <th>Compte Tiers</th>
                  <th>Libellé</th>
                  <th>Débit</th>
                  <th>Crédit</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                    <td style={{ padding: '0.75rem 0' }}>{row.code_journal}</td>
                    <td>{row.date}</td>
                    <td>{row.n_facture}</td>
                    <td>{row.reference}</td>
                    <td style={{ fontWeight: 500 }}>{row.compte}</td>
                    <td>{row.compte_tiers}</td>
                    <td>{row.libelle}</td>
                    <td>{row.debit > 0 ? row.debit.toLocaleString() : '-'}</td>
                    <td>{row.credit > 0 ? row.credit.toLocaleString() : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );

      case 'balance': {
        const groups = {};
        let bilan_debit = 0, bilan_credit = 0;
        let gestion_debit = 0, gestion_credit = 0;
        let grand_debit = 0, grand_credit = 0;

        data.forEach(row => {
          const compteStr = String(row.compte);
          const root = compteStr.substring(0, 2);
          if (!groups[root]) {
            groups[root] = { rows: [], t_debit: 0, t_credit: 0 };
          }
          groups[root].rows.push(row);
          groups[root].t_debit += (row.total_debit || 0);
          groups[root].t_credit += (row.total_credit || 0);

          const rootClass = parseInt(compteStr.substring(0, 1), 10);
          if (rootClass >= 1 && rootClass <= 5) {
            bilan_debit += (row.total_debit || 0);
            bilan_credit += (row.total_credit || 0);
          } else if (rootClass >= 6 && rootClass <= 9) {
            gestion_debit += (row.total_debit || 0);
            gestion_credit += (row.total_credit || 0);
          }
          grand_debit += (row.total_debit || 0);
          grand_credit += (row.total_credit || 0);
        });

        const ohadaPlan = {
          "10": "CAPITAL",
          "13": "RÉSULTAT NET DE L'EXERCICE",
          "16": "EMPRUNTS ET DETTES ASSIMILÉES",
          "21": "IMMOBILISATIONS INCORPORELLES",
          "22": "TERRAINS",
          "23": "BÂTIMENTS, INSTALLATIONS TECHNIQUES",
          "24": "MATÉRIEL, MOBILIER ET ACTIFS BIOLOGIQUES",
          "28": "AMORTISSEMENTS",
          "31": "MARCHANDISES",
          "32": "MATIÈRES PREMIÈRES ET FOURNITURES LIÉES",
          "40": "FOURNISSEURS ET COMPTES RATTACHÉS",
          "401": "FOURNISSEURS D'EXPLOITATION",
          "41": "CLIENTS ET COMPTES RATTACHÉS",
          "411": "CLIENTS",
          "42": "PERSONNEL",
          "422": "PERSONNEL, RÉMUNÉRATIONS DUES",
          "43": "ORGANISMES SOCIAUX",
          "44": "ÉTAT ET COLLECTIVITÉS PUBLIQUES",
          "46": "DÉBITEURS ET CRÉDITEURS DIVERS",
          "47": "COMPTES TRANSITOIRES OU D'ATTENTE",
          "48": "CRÉANCES ET DETTES (HAO)",
          "50": "TITRES DE PLACEMENT",
          "51": "VALEURS À L'ENCAISSEMENT",
          "52": "BANQUES",
          "53": "ÉTABLISSEMENTS FINANCIERS",
          "54": "INSTRUMENTS DE TRÉSORERIE",
          "56": "BANQUES, CRÉDITS DE TRÉSORERIE",
          "57": "CAISSE",
          "58": "RÉGIES D'AVANCES ET VIREMENTS INTERNES",
          "60": "ACHATS ET VARIATIONS DE STOCKS",
          "601": "ACHATS DE MARCHANDISES",
          "602": "ACHATS DE MATIÈRES PREMIÈRES ET FOURNITURES",
          "604": "ACHATS D'ÉTUDES ET PRESTATIONS DE SERVICES",
          "605": "AUTRES ACHATS",
          "61": "TRANSPORTS",
          "618": "AUTRES FRAIS DE TRANSPORT",
          "62": "SERVICES EXTÉRIEURS A",
          "621": "PERSONNEL EXTÉRIEUR À L'ENTREPRISE",
          "624": "ENTRETIEN, RÉPARATIONS ET MAINTENANCE",
          "628": "FRAIS DE TÉLÉCOMMUNICATIONS",
          "63": "SERVICES EXTÉRIEURS B",
          "632": "RÉMUNÉRATIONS D'INTERMÉDIAIRES ET HONORAIRES",
          "64": "IMPÔTS ET TAXES",
          "65": "AUTRES CHARGES",
          "66": "CHARGES DE PERSONNEL",
          "67": "FRAIS FINANCIERS",
          "68": "DOTATIONS AUX AMORTISSEMENTS",
          "70": "VENTES",
          "71": "SUBVENTIONS D'EXPLOITATION",
          "73": "VARIATION DES STOCKS DE BIENS ET SERVICES PRODUITS",
          "75": "AUTRES PRODUITS",
          "77": "REVENUS FINANCIERS",
          "81": "VALEURS COMP. DES CESSIONS D'IMMOB.",
          "82": "PRODUITS DES CESSIONS D'IMMOB.",
          "83": "CHARGES (HAO)",
          "84": "PRODUITS (HAO)",
          "89": "IMPÔTS SUR LE RÉSULTAT"
        };

        const getOhadaTitle = (compteStr) => {
          const str = String(compteStr);
          for (let i = str.length; i >= 2; i--) {
            const prefix = str.substring(0, i);
            if (ohadaPlan[prefix]) return ohadaPlan[prefix];
          }
          return `COMPTE ${str}`;
        };

        return (
          <div style={{ overflowX: 'auto', background: 'white', padding: '1rem', borderRadius: 'var(--radius-md)' }}>
            <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ margin: 0, color: 'var(--color-text-main)' }}>Balance des comptes</h2>
              <p style={{ margin: '0.25rem 0', color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>Complète - Format Sage 100</p>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '900px', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ color: 'var(--color-text-main)' }}>
                  <th rowSpan="2" style={{ padding: '0.5rem', borderBottom: '2px solid var(--color-border)', verticalAlign: 'bottom', width: '10%' }}>Numéro<br/>de<br/>compte</th>
                  <th rowSpan="2" style={{ padding: '0.5rem', borderBottom: '2px solid var(--color-border)', verticalAlign: 'bottom', width: '30%' }}>Intitulé des comptes</th>
                  <th colSpan="2" style={{ padding: '0.5rem', textAlign: 'center', borderBottom: '1px solid var(--color-border)' }}>Mouvements antérieurs</th>
                  <th colSpan="2" style={{ padding: '0.5rem', textAlign: 'center', borderBottom: '1px solid var(--color-border)', borderLeft: '1px solid var(--color-border)', borderRight: '1px solid var(--color-border)' }}>Mouvements</th>
                  <th colSpan="2" style={{ padding: '0.5rem', textAlign: 'center', borderBottom: '1px solid var(--color-border)' }}>Soldes cumulés</th>
                </tr>
                <tr style={{ color: 'var(--color-text-main)' }}>
                  <th style={{ padding: '0.5rem', textAlign: 'right', borderBottom: '2px solid var(--color-border)' }}>Débit</th>
                  <th style={{ padding: '0.5rem', textAlign: 'right', borderBottom: '2px solid var(--color-border)' }}>Crédit</th>
                  <th style={{ padding: '0.5rem', textAlign: 'right', borderBottom: '2px solid var(--color-border)', borderLeft: '1px solid var(--color-border)' }}>Débit</th>
                  <th style={{ padding: '0.5rem', textAlign: 'right', borderBottom: '2px solid var(--color-border)', borderRight: '1px solid var(--color-border)' }}>Crédit</th>
                  <th style={{ padding: '0.5rem', textAlign: 'right', borderBottom: '2px solid var(--color-border)' }}>Débit</th>
                  <th style={{ padding: '0.5rem', textAlign: 'right', borderBottom: '2px solid var(--color-border)' }}>Crédit</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(groups).sort().map(root => {
                  const group = groups[root];
                  const subSolde = group.t_debit - group.t_credit;
                  return (
                    <Fragment key={root}>
                      {group.rows.map((row, idx) => (
                        <tr key={`${root}-${idx}`} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                          <td style={{ padding: '0.4rem 0.5rem' }}>{row.compte}</td>
                          <td style={{ padding: '0.4rem 0.5rem' }}>{getOhadaTitle(row.compte)}</td>
                          <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}></td>
                          <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}></td>
                          <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', borderLeft: '1px solid rgba(0,0,0,0.05)' }}>{row.total_debit > 0 ? row.total_debit.toLocaleString() : ''}</td>
                          <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', borderRight: '1px solid rgba(0,0,0,0.05)' }}>{row.total_credit > 0 ? row.total_credit.toLocaleString() : ''}</td>
                          <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{row.solde > 0 ? row.solde.toLocaleString() : ''}</td>
                          <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{row.solde < 0 ? Math.abs(row.solde).toLocaleString() : ''}</td>
                        </tr>
                      ))}
                      <tr style={{ backgroundColor: '#f8fafc', fontWeight: 'bold' }}>
                        <td style={{ padding: '0.4rem 0.5rem' }}>{root}</td>
                        <td style={{ padding: '0.4rem 0.5rem' }}>***SOUS-TOTAL {getOhadaTitle(root)}</td>
                        <td style={{ padding: '0.4rem 0.5rem' }}></td>
                        <td style={{ padding: '0.4rem 0.5rem' }}></td>
                        <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{group.t_debit > 0 ? group.t_debit.toLocaleString() : ''}</td>
                        <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{group.t_credit > 0 ? group.t_credit.toLocaleString() : ''}</td>
                        <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{subSolde > 0 ? subSolde.toLocaleString() : ''}</td>
                        <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{subSolde < 0 ? Math.abs(subSolde).toLocaleString() : ''}</td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                {(() => {
                   const bs = bilan_debit - bilan_credit;
                   const gs = gestion_debit - gestion_credit;
                   const gs_tot = grand_debit - grand_credit;
                   return (
                     <>
                        <tr style={{ borderTop: '2px solid var(--color-border)', fontWeight: 'bold' }}>
                          <td colSpan="2" style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Totaux comptes de bilan</td>
                          <td colSpan="2"></td>
                          <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{bilan_debit > 0 ? bilan_debit.toLocaleString() : ''}</td>
                          <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{bilan_credit > 0 ? bilan_credit.toLocaleString() : ''}</td>
                          <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{bs > 0 ? bs.toLocaleString() : ''}</td>
                          <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{bs < 0 ? Math.abs(bs).toLocaleString() : ''}</td>
                        </tr>
                        <tr style={{ fontWeight: 'bold' }}>
                          <td colSpan="2" style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Totaux comptes de gestion</td>
                          <td colSpan="2"></td>
                          <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{gestion_debit > 0 ? gestion_debit.toLocaleString() : ''}</td>
                          <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{gestion_credit > 0 ? gestion_credit.toLocaleString() : ''}</td>
                          <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{gs > 0 ? gs.toLocaleString() : ''}</td>
                          <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{gs < 0 ? Math.abs(gs).toLocaleString() : ''}</td>
                        </tr>
                        <tr style={{ borderTop: '2px solid var(--color-border)', borderBottom: '2px solid var(--color-border)', fontWeight: 'bold', backgroundColor: '#f1f5f9' }}>
                          <td colSpan="2" style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Totaux de la balance</td>
                          <td colSpan="2"></td>
                          <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{grand_debit > 0 ? grand_debit.toLocaleString() : ''}</td>
                          <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{grand_credit > 0 ? grand_credit.toLocaleString() : ''}</td>
                          <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{gs_tot > 0 ? gs_tot.toLocaleString() : ''}</td>
                          <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{gs_tot < 0 ? Math.abs(gs_tot).toLocaleString() : ''}</td>
                        </tr>
                     </>
                   );
                })()}
              </tfoot>
            </table>
          </div>
        );
      }

      case 'bilan':
        // Séparer Actif (Classes 2,3,4,5 débits) et Passif (Classes 1,4,5 crédits) de manière simplifiée
        const actif = data.filter(d => ['2', '3'].includes(String(d.classe)));
        const passif = data.filter(d => ['1'].includes(String(d.classe)));
        const classe4 = data.find(d => String(d.classe) === '4') || { solde: 0 };
        const classe5 = data.find(d => String(d.classe) === '5') || { solde: 0 };
        
        if (classe4.solde > 0) actif.push({ classe: '4 (Créances)', solde: classe4.solde });
        else if (classe4.solde < 0) passif.push({ classe: '4 (Dettes)', solde: Math.abs(classe4.solde) });

        if (classe5.solde > 0) actif.push({ classe: '5 (Trésorerie Actif)', solde: classe5.solde });
        else if (classe5.solde < 0) passif.push({ classe: '5 (Trésorerie Passif)', solde: Math.abs(classe5.solde) });

        const totalActif = actif.reduce((acc, curr) => acc + (curr.solde || 0), 0);
        const totalPassif = passif.reduce((acc, curr) => acc + (curr.solde || 0), 0);

        return (
          <div style={{ display: 'flex', gap: '2rem' }}>
            <div style={{ flex: 1 }}>
              <h4 style={{ marginBottom: '1rem', color: 'var(--color-primary)' }}>ACTIF (Emplois)</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <tbody>
                  {actif.map((row, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                      <td style={{ padding: '0.75rem 0' }}>Classe {row.classe}</td>
                      <td style={{ textAlign: 'right' }}>{row.solde.toLocaleString()} FCFA</td>
                    </tr>
                  ))}
                  <tr style={{ fontWeight: 'bold', borderTop: '2px solid var(--color-border)' }}>
                    <td style={{ padding: '1rem 0' }}>TOTAL ACTIF</td>
                    <td style={{ textAlign: 'right' }}>{totalActif.toLocaleString()} FCFA</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div style={{ flex: 1 }}>
              <h4 style={{ marginBottom: '1rem', color: 'var(--color-primary-dark)' }}>PASSIF (Ressources)</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <tbody>
                  {passif.map((row, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                      <td style={{ padding: '0.75rem 0' }}>Classe {row.classe}</td>
                      <td style={{ textAlign: 'right' }}>{row.solde.toLocaleString()} FCFA</td>
                    </tr>
                  ))}
                  <tr style={{ fontWeight: 'bold', borderTop: '2px solid var(--color-border)' }}>
                    <td style={{ padding: '1rem 0' }}>TOTAL PASSIF</td>
                    <td style={{ textAlign: 'right' }}>{totalPassif.toLocaleString()} FCFA</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );

      case 'resultat':
        const charges = data.find(d => String(d.classe) === '6') || { solde: 0 };
        const produits = data.find(d => String(d.classe) === '7') || { solde: 0 };
        // Le solde d'un compte de produit est normalement créditeur (donc négatif dans notre calcul Débit - Crédit).
        const totalProduits = Math.abs(produits.total_credit - produits.total_debit) || 0; 
        const totalCharges = Math.abs(charges.total_debit - charges.total_credit) || 0;
        const resultatNet = totalProduits - totalCharges;

        return (
          <div style={{ maxWidth: '600px', margin: '0 auto' }}>
            <h4 style={{ marginBottom: '1.5rem', textAlign: 'center' }}>Compte de Résultat (SYSCOHADA)</h4>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
              <span>Total des Produits (Classe 7)</span>
              <span style={{ fontWeight: 500, color: 'var(--color-success)' }}>{totalProduits.toLocaleString()} FCFA</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
              <span>Total des Charges (Classe 6)</span>
              <span style={{ fontWeight: 500, color: 'var(--color-error)' }}>{totalCharges.toLocaleString()} FCFA</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem', marginTop: '1rem', background: 'rgba(255,255,255,0.6)', borderRadius: 'var(--radius-md)' }}>
              <span style={{ fontWeight: 'bold', fontSize: '1.125rem' }}>Résultat Net</span>
              <span style={{ fontWeight: 'bold', fontSize: '1.125rem', color: resultatNet >= 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
                {resultatNet.toLocaleString()} FCFA
              </span>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="card">
      <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Table style={{ color: 'var(--color-primary)' }} />
        Comptabilité & États Financiers
      </h3>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '1rem', overflowX: 'auto' }}>
        <button className={`btn ${activeTab === 'saisie' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('saisie')}>Saisie / Upload</button>
        <button className={`btn ${activeTab === 'journal' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('journal')}>Journal</button>
        <button className={`btn ${activeTab === 'balance' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('balance')}>Balance</button>
        <button className={`btn ${activeTab === 'bilan' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('bilan')}>Bilan</button>
        <button className={`btn ${activeTab === 'resultat' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('resultat')}>Compte de Résultat</button>
      </div>

      <div style={{ minHeight: '400px' }}>
        {renderContent()}
      </div>
    </div>
  );
};
