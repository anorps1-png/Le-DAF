import { useState, useEffect, useRef, Fragment } from 'react';
import { BrainCircuit, Table, CheckCircle, Plus, Trash2, AlertTriangle, Pencil, X } from 'lucide-react';
import { getAccountLabel } from '../utils/ohadaPlan';

export const ComptabiliteModule = ({ initialTab, initialCompte } = {}) => {
  const [activeTab, setActiveTab] = useState(initialTab || 'saisie');
  const [glComptes, setGlComptes] = useState([]);
  const [glSelectedCompte, setGlSelectedCompte] = useState(initialCompte || '');
  const [glLedger, setGlLedger] = useState(null);
  const [glLoading, setGlLoading] = useState(false);
  const [glError, setGlError] = useState('');
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [highlightRowId, setHighlightRowId] = useState(null);
  const [editingRowId, setEditingRowId] = useState(null);
  const [editRowForm, setEditRowForm] = useState(null);
  const [rowActionStatus, setRowActionStatus] = useState('');
  const highlightedRowRef = useRef(null);
  const [manualHeader, setManualHeader] = useState({
    code_journal: 'OD',
    poste_budgetaire: '',
    date: new Date().toISOString().split('T')[0],
    n_facture: '',
    reference: ''
  });
  const emptyLine = () => ({ compte: '', compte_tiers: '', libelle: '', debit: '0', credit: '0' });
  const [manualLines, setManualLines] = useState([emptyLine(), emptyLine()]);
  const [manualStatus, setManualStatus] = useState('');
  const [memoryMatch, setMemoryMatch] = useState({});
  const [fetchError, setFetchError] = useState('');
  const [customAccounts, setCustomAccounts] = useState({});

  useEffect(() => {
    fetch('/api/chart-of-accounts')
      .then(res => res.json())
      .then(rows => {
        const map = {};
        (rows || []).forEach(r => { map[r.compte] = r.libelle; });
        setCustomAccounts(map);
      })
      .catch(e => console.error(e));
  }, []);

  const totalDebit = manualLines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalCredit = manualLines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const ecart = Math.round((totalDebit - totalCredit) * 100) / 100;
  const isBalanced = Math.abs(ecart) < 0.01 && totalDebit > 0;
  // Le journal Caisse suppose un mouvement de caisse même sans ligne 571100 saisie explicitement :
  // le serveur la complète automatiquement, donc une écriture "déséquilibrée" dans ce cas précis
  // reste soumettable (voir POST /api/journal côté serveur).
  const hasCaisseLine = manualLines.some(l => String(l.compte).startsWith('57'));
  const isCaisseAutoBalance = manualHeader.code_journal === 'CA' && !hasCaisseLine && !isBalanced && (totalDebit > 0 || totalCredit > 0);
  const canSubmit = isBalanced || isCaisseAutoBalance;

  const updateLine = (idx, patch) => {
    setManualLines(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  };
  const addLine = () => setManualLines(prev => [...prev, emptyLine()]);
  const removeLine = (idx) => setManualLines(prev => prev.length > 2 ? prev.filter((_, i) => i !== idx) : prev);

  const checkMemoryMatch = async (idx, lib, tiers) => {
    if (!lib || lib.length < 3) {
      setMemoryMatch(prev => ({ ...prev, [idx]: null }));
      return;
    }
    try {
      const res = await fetch('/api/memory/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ libelle: lib, compte_tiers: tiers })
      });
      const data = await res.json();
      if (data.matched) {
        setMemoryMatch(prev => ({ ...prev, [idx]: data }));
        if (data.auto_apply && data.target_account) {
          updateLine(idx, { compte: data.target_account });
        }
      } else {
        setMemoryMatch(prev => ({ ...prev, [idx]: null }));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchEtats = async (endpoint) => {
    setLoading(true);
    setFetchError('');
    try {
      const res = await fetch(`/api/${endpoint}`);
      const json = await res.json();
      if (!res.ok) {
        // Une réponse d'erreur du serveur n'a pas la forme attendue par l'onglet (tableau ou
        // objet selon le cas) : ne jamais l'assigner à data, sous peine de faire planter le
        // rendu (ex: data.forEach sur un objet {error: "..."}) et d'afficher une page blanche.
        throw new Error(json.error || `Erreur ${res.status}`);
      }
      setData(json);
    } catch (err) {
      console.error(err);
      // Idem si le serveur est injoignable (hors ligne, backend arrêté...) : on efface les
      // données de l'onglet précédent plutôt que de laisser une forme incompatible en mémoire.
      setData(null);
      setFetchError(err.message || 'Impossible de charger les données. Vérifiez que le serveur est démarré.');
    }
    setLoading(false);
  };

  useEffect(() => {
    if (activeTab === 'journal') fetchEtats('journal');
    if (activeTab === 'balance') fetchEtats('balance');
    if (activeTab === 'bilan') fetchEtats('bilan');
    if (activeTab === 'resultat') fetchEtats('resultat');
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'grandlivre') return;
    fetch('/api/grand-livre/comptes')
      .then(res => res.json())
      .then(rows => {
        const list = Array.isArray(rows) ? rows : [];
        setGlComptes(list);
        if (!glSelectedCompte && list.length > 0) setGlSelectedCompte(list[0].compte);
      })
      .catch(e => console.error(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (!glSelectedCompte || activeTab !== 'grandlivre') return;
    setGlLoading(true);
    setGlError('');
    fetch(`/api/grand-livre/${encodeURIComponent(glSelectedCompte)}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) { setGlError(data.error); setGlLedger(null); }
        else setGlLedger(data);
      })
      .catch(() => setGlError('Impossible de charger le Grand Livre. Vérifiez que le serveur est démarré.'))
      .finally(() => setGlLoading(false));
  }, [glSelectedCompte, activeTab]);

  const openGrandLivre = (compte) => {
    setGlSelectedCompte(compte);
    setActiveTab('grandlivre');
  };

  // Depuis le Grand Livre, ouvre l'écriture correspondante dans le Journal (mis en surbrillance
  // et scrollée en vue) où elle peut être modifiée ou supprimée.
  const openJournalEntry = (id) => {
    setEditingRowId(null);
    setHighlightRowId(id);
    setActiveTab('journal');
  };

  useEffect(() => {
    if (activeTab === 'journal' && highlightRowId && data && data.length && highlightedRowRef.current) {
      highlightedRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeTab, highlightRowId, data]);

  const startEditRow = (row) => {
    setRowActionStatus('');
    setEditingRowId(row.id);
    setEditRowForm({
      code_journal: row.code_journal || '',
      poste_budgetaire: row.poste_budgetaire || '',
      date: row.date || '',
      compte: row.compte || '',
      compte_tiers: row.compte_tiers || '',
      libelle: row.libelle || '',
      n_facture: row.n_facture || '',
      reference: row.reference || '',
      debit: row.debit || 0,
      credit: row.credit || 0
    });
  };

  const cancelEditRow = () => {
    setEditingRowId(null);
    setEditRowForm(null);
  };

  const saveEditRow = async (id) => {
    if (!editRowForm.compte || !editRowForm.libelle || !editRowForm.date) {
      setRowActionStatus('Erreur : Compte, libellé et date sont obligatoires.');
      return;
    }
    try {
      const res = await fetch(`/api/journal/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editRowForm)
      });
      const resData = await res.json();
      if (resData.success) {
        setEditingRowId(null);
        setEditRowForm(null);
        setRowActionStatus('Succès : Écriture modifiée. Mémoire Métier mise à jour 🧠.');
        fetchEtats('journal');
      } else {
        setRowActionStatus(`Erreur : ${resData.error}`);
      }
    } catch (err) {
      setRowActionStatus('Erreur : Connexion au serveur impossible.');
    }
  };

  const deleteRow = async (id) => {
    if (!window.confirm('Supprimer définitivement cette écriture ?')) return;
    try {
      const res = await fetch(`/api/journal/${id}`, { method: 'DELETE' });
      const resData = await res.json();
      if (resData.success) {
        setRowActionStatus('Succès : Écriture supprimée.');
        fetchEtats('journal');
      } else {
        setRowActionStatus(`Erreur : ${resData.error}`);
      }
    } catch (err) {
      setRowActionStatus('Erreur : Connexion au serveur impossible.');
    }
  };

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    if (!manualHeader.code_journal || !manualHeader.date) {
      setManualStatus('Erreur : Veuillez remplir tous les champs obligatoires.');
      return;
    }
    if (manualLines.some(l => !l.compte || !l.libelle)) {
      setManualStatus('Erreur : Chaque ligne doit avoir un compte et un libellé.');
      return;
    }
    if (!canSubmit) {
      setManualStatus(`Erreur : Écriture déséquilibrée (Débit ${totalDebit.toLocaleString()} ≠ Crédit ${totalCredit.toLocaleString()}).`);
      return;
    }
    setLoading(true);
    setManualStatus('Enregistrement de l\'écriture...');
    try {
      const res = await fetch('/api/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...manualHeader, lines: manualLines })
      });
      const data = await res.json();
      if (data.success) {
        setManualStatus('Succès : L\'écriture a été enregistrée. Apprentissage ML mis à jour 🧠.');

        // Apprentissage automatique d'une règle par ligne imputée pour le Cerveau Métier
        manualLines.forEach(l => {
          fetch('/api/memory/learn', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pattern: l.libelle,
              target_account: l.compte,
              target_journal: manualHeader.code_journal
            })
          }).catch(e => console.error("Erreur apprentissage ML:", e));
        });

        setManualLines([emptyLine(), emptyLine()]);
        setManualHeader(prev => ({ ...prev, n_facture: '', reference: '' }));
        setMemoryMatch({});
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
    if (fetchError && activeTab !== 'saisie' && activeTab !== 'grandlivre') {
      return (
        <div style={{ padding: '2rem', textAlign: 'center', background: 'rgba(239, 68, 68, 0.1)', color: '#b91c1c', borderRadius: 'var(--radius-md)' }}>
          <AlertTriangle size={32} style={{ margin: '0 auto 1rem' }} />
          <p style={{ fontWeight: 600 }}>Impossible de charger cet onglet</p>
          <p style={{ fontSize: '0.9rem' }}>{fetchError}</p>
        </div>
      );
    }

    switch (activeTab) {
      case 'saisie':
        return (
          <div style={{ maxWidth: '640px' }}>
            <div>
              <h4 style={{ marginBottom: '1rem', color: 'var(--color-primary-dark)' }}>Saisie manuelle d'écriture</h4>
              <form onSubmit={handleManualSubmit} style={{ background: 'rgba(255,255,255,0.3)', padding: '1.5rem', borderRadius: 'var(--radius-xl)', border: '1px solid var(--color-border)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', fontWeight: 500 }}>Code Journal *</label>
                    <select
                      className="input"
                      style={{ padding: '0.5rem' }}
                      value={manualHeader.code_journal}
                      onChange={e => setManualHeader({...manualHeader, code_journal: e.target.value})}
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
                      value={manualHeader.date}
                      onChange={e => setManualHeader({...manualHeader, date: e.target.value})}
                      required
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginBottom: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.75rem', fontWeight: 500 }}>Budget</label>
                    <input
                      type="text"
                      className="input"
                      style={{ padding: '0.5rem' }}
                      placeholder="Ex: ACHATS"
                      value={manualHeader.poste_budgetaire}
                      onChange={e => setManualHeader({...manualHeader, poste_budgetaire: e.target.value})}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.75rem', fontWeight: 500 }}>N° Fact.</label>
                    <input
                      type="text"
                      className="input"
                      style={{ padding: '0.5rem' }}
                      placeholder="FA-26-004"
                      value={manualHeader.n_facture}
                      onChange={e => setManualHeader({...manualHeader, n_facture: e.target.value})}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.75rem', fontWeight: 500 }}>Réf.</label>
                    <input
                      type="text"
                      className="input"
                      style={{ padding: '0.5rem' }}
                      placeholder="CHÈQUE 99"
                      value={manualHeader.reference}
                      onChange={e => setManualHeader({...manualHeader, reference: e.target.value})}
                    />
                  </div>
                </div>

                <div style={{ marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 500 }}>Lignes de l'écriture *</label>
                  <button
                    type="button"
                    onClick={addLine}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '0.3rem 0.6rem', cursor: 'pointer', fontSize: '0.8rem' }}
                  >
                    <Plus size={14} /> Ajouter une ligne
                  </button>
                </div>

                {manualLines.map((line, idx) => (
                  <div key={idx} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '0.75rem', marginBottom: '0.75rem', background: 'rgba(255,255,255,0.5)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <input
                        type="text"
                        className="input"
                        style={{ padding: '0.5rem' }}
                        placeholder="N° Compte *"
                        value={line.compte}
                        onChange={e => updateLine(idx, { compte: e.target.value })}
                      />
                      <input
                        type="text"
                        className="input"
                        style={{ padding: '0.5rem' }}
                        placeholder="Compte Tiers"
                        value={line.compte_tiers}
                        onChange={e => updateLine(idx, { compte_tiers: e.target.value })}
                      />
                    </div>

                    <input
                      type="text"
                      className="input"
                      style={{ padding: '0.5rem', width: '100%', marginBottom: '0.5rem' }}
                      placeholder="Libellé *"
                      value={line.libelle}
                      onChange={e => {
                        const val = e.target.value;
                        updateLine(idx, { libelle: val });
                        checkMemoryMatch(idx, val, line.compte_tiers);
                      }}
                    />
                    {memoryMatch[idx] && memoryMatch[idx].matched && (
                      <div style={{
                        marginBottom: '0.5rem',
                        padding: '0.4rem 0.75rem',
                        borderRadius: 'var(--radius-md)',
                        background: memoryMatch[idx].auto_apply ? '#dcfce7' : '#fef3c7',
                        color: memoryMatch[idx].auto_apply ? '#166534' : '#92400e',
                        fontSize: '0.8rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem'
                      }}>
                        <BrainCircuit size={16} />
                        <span>
                          {memoryMatch[idx].auto_apply ? (
                            <>🧠 <strong>Mémoire Métier (Auto-Imputé)</strong> : Compte <strong>{memoryMatch[idx].target_account}</strong> (Confiance: {(memoryMatch[idx].confidence_score * 100).toFixed(0)}%)</>
                          ) : (
                            <>💡 <strong>Suggestion Mémoire</strong> : Compte proposé <strong>{memoryMatch[idx].target_account}</strong></>
                          )}
                        </span>
                      </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: manualLines.length > 2 ? '1fr 1fr auto' : '1fr 1fr', gap: '0.5rem', alignItems: 'end' }}>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.75rem', fontWeight: 500 }}>Débit</label>
                        <input
                          type="number"
                          step="0.01"
                          className="input"
                          style={{ padding: '0.5rem' }}
                          placeholder="0"
                          value={line.debit}
                          onChange={e => updateLine(idx, { debit: e.target.value })}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.75rem', fontWeight: 500 }}>Crédit</label>
                        <input
                          type="number"
                          step="0.01"
                          className="input"
                          style={{ padding: '0.5rem' }}
                          placeholder="0"
                          value={line.credit}
                          onChange={e => updateLine(idx, { credit: e.target.value })}
                        />
                      </div>
                      {manualLines.length > 2 && (
                        <button
                          type="button"
                          onClick={() => removeLine(idx)}
                          style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', padding: '0.5rem' }}
                          title="Supprimer la ligne"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem',
                  padding: '0.75rem', borderRadius: 'var(--radius-md)', marginBottom: '1rem',
                  background: isBalanced ? 'rgba(34, 197, 94, 0.1)' : isCaisseAutoBalance ? 'rgba(59, 130, 246, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                  color: isBalanced ? '#15803d' : isCaisseAutoBalance ? '#1d4ed8' : '#b91c1c', fontSize: '0.85rem', fontWeight: 500
                }}>
                  <span>Débit : {totalDebit.toLocaleString()}</span>
                  <span>Crédit : {totalCredit.toLocaleString()}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    {isBalanced ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
                    {isBalanced
                      ? 'Équilibrée'
                      : isCaisseAutoBalance
                        ? `Compte Caisse (571100) mouvementé automatiquement pour ${Math.abs(ecart).toLocaleString()}`
                        : `Écart : ${Math.abs(ecart).toLocaleString()}`}
                  </span>
                </div>

                <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '0.5rem', opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? 'pointer' : 'not-allowed' }} disabled={!canSubmit}>
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
          <div>
            {rowActionStatus && (
              <div style={{
                marginBottom: '1rem', padding: '0.6rem 0.85rem', borderRadius: 'var(--radius-md)', fontSize: '0.85rem', fontWeight: 500,
                background: rowActionStatus.includes('Succès') ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                color: rowActionStatus.includes('Succès') ? '#15803d' : '#b91c1c'
              }}>
                {rowActionStatus}
              </div>
            )}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '1050px' }}>
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
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((row, idx) => {
                    const isEditing = editingRowId === row.id;
                    const isHighlighted = highlightRowId === row.id;
                    return (
                      <tr
                        key={idx}
                        ref={isHighlighted ? highlightedRowRef : null}
                        style={{
                          borderBottom: '1px solid rgba(0,0,0,0.05)',
                          background: isEditing ? 'rgba(59,130,246,0.08)' : isHighlighted ? 'rgba(250, 204, 21, 0.18)' : 'transparent'
                        }}
                      >
                        {isEditing ? (
                          <>
                            <td style={{ padding: '0.4rem 0.5rem 0.4rem 0' }}>
                              <input className="input" style={{ padding: '0.35rem', width: '80px' }} value={editRowForm.code_journal} onChange={e => setEditRowForm({ ...editRowForm, code_journal: e.target.value })} />
                            </td>
                            <td style={{ padding: '0.4rem 0.5rem' }}>
                              <input type="date" className="input" style={{ padding: '0.35rem', width: '130px' }} value={editRowForm.date} onChange={e => setEditRowForm({ ...editRowForm, date: e.target.value })} />
                            </td>
                            <td style={{ padding: '0.4rem 0.5rem' }}>
                              <input className="input" style={{ padding: '0.35rem', width: '90px' }} value={editRowForm.n_facture} onChange={e => setEditRowForm({ ...editRowForm, n_facture: e.target.value })} />
                            </td>
                            <td style={{ padding: '0.4rem 0.5rem' }}>
                              <input className="input" style={{ padding: '0.35rem', width: '90px' }} value={editRowForm.reference} onChange={e => setEditRowForm({ ...editRowForm, reference: e.target.value })} />
                            </td>
                            <td style={{ padding: '0.4rem 0.5rem' }}>
                              <input className="input" style={{ padding: '0.35rem', width: '90px' }} value={editRowForm.compte} onChange={e => setEditRowForm({ ...editRowForm, compte: e.target.value })} />
                            </td>
                            <td style={{ padding: '0.4rem 0.5rem' }}>
                              <input className="input" style={{ padding: '0.35rem', width: '110px' }} value={editRowForm.compte_tiers} onChange={e => setEditRowForm({ ...editRowForm, compte_tiers: e.target.value })} />
                            </td>
                            <td style={{ padding: '0.4rem 0.5rem' }}>
                              <input className="input" style={{ padding: '0.35rem', width: '180px' }} value={editRowForm.libelle} onChange={e => setEditRowForm({ ...editRowForm, libelle: e.target.value })} />
                            </td>
                            <td style={{ padding: '0.4rem 0.5rem' }}>
                              <input type="number" step="0.01" className="input" style={{ padding: '0.35rem', width: '100px' }} value={editRowForm.debit} onChange={e => setEditRowForm({ ...editRowForm, debit: e.target.value })} />
                            </td>
                            <td style={{ padding: '0.4rem 0.5rem' }}>
                              <input type="number" step="0.01" className="input" style={{ padding: '0.35rem', width: '100px' }} value={editRowForm.credit} onChange={e => setEditRowForm({ ...editRowForm, credit: e.target.value })} />
                            </td>
                            <td style={{ padding: '0.4rem 0.5rem', whiteSpace: 'nowrap' }}>
                              <button onClick={() => saveEditRow(row.id)} title="Enregistrer" style={{ background: 'none', border: 'none', color: 'var(--color-success)', cursor: 'pointer', padding: '0.3rem' }}>
                                <CheckCircle size={16} />
                              </button>
                              <button onClick={cancelEditRow} title="Annuler" style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '0.3rem' }}>
                                <X size={16} />
                              </button>
                            </td>
                          </>
                        ) : (
                          <>
                            <td style={{ padding: '0.75rem 0' }}>{row.code_journal}</td>
                            <td>{row.date}</td>
                            <td>{row.n_facture}</td>
                            <td>{row.reference}</td>
                            <td style={{ fontWeight: 500 }}>{row.compte}</td>
                            <td>{row.compte_tiers}</td>
                            <td>{row.libelle}</td>
                            <td>{row.debit > 0 ? row.debit.toLocaleString() : '-'}</td>
                            <td>{row.credit > 0 ? row.credit.toLocaleString() : '-'}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <button onClick={() => startEditRow(row)} title="Modifier" style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', padding: '0.3rem' }}>
                                <Pencil size={14} />
                              </button>
                              <button onClick={() => deleteRow(row.id)} title="Supprimer" style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', padding: '0.3rem' }}>
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );

      case 'grandlivre':
        return (
          <div>
            <div style={{ marginBottom: '1.5rem', maxWidth: '480px' }}>
              <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', fontWeight: 500 }}>Compte</label>
              <select
                className="input"
                style={{ padding: '0.5rem', width: '100%' }}
                value={glSelectedCompte}
                onChange={e => setGlSelectedCompte(e.target.value)}
              >
                {glComptes.length === 0 && <option value="">Aucun compte avec écritures</option>}
                {glComptes.map(c => (
                  <option key={c.compte} value={c.compte}>
                    {c.compte} - {getAccountLabel(c.compte, customAccounts)}
                  </option>
                ))}
              </select>
            </div>

            {glLoading && <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>Chargement du Grand Livre...</div>}

            {glError && (
              <div style={{ padding: '1.5rem', textAlign: 'center', background: 'rgba(239, 68, 68, 0.1)', color: '#b91c1c', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                <AlertTriangle size={28} />
                {glError}
              </div>
            )}

            {!glLoading && !glError && glLedger && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '900px', fontSize: '0.875rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                      <th style={{ padding: '0.75rem 0.5rem 0.75rem 0' }}>Date</th>
                      <th style={{ padding: '0.75rem 0.5rem' }}>Journal</th>
                      <th style={{ padding: '0.75rem 0.5rem' }}>N° Facture</th>
                      <th style={{ padding: '0.75rem 0.5rem' }}>Référence</th>
                      <th style={{ padding: '0.75rem 0.5rem' }}>Libellé</th>
                      <th style={{ padding: '0.75rem 0.5rem' }}>Tiers</th>
                      <th style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Débit</th>
                      <th style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Crédit</th>
                      <th style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Solde progressif</th>
                    </tr>
                  </thead>
                  <tbody>
                    {glLedger.lignes.length === 0 ? (
                      <tr>
                        <td colSpan="9" style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                          Aucune écriture pour ce compte sur la période sélectionnée.
                        </td>
                      </tr>
                    ) : glLedger.lignes.map(l => (
                      <tr
                        key={l.id}
                        onClick={() => openJournalEntry(l.id)}
                        title="Voir/modifier cette écriture dans le Journal"
                        style={{ borderBottom: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,0.03)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <td style={{ padding: '0.5rem 0.5rem 0.5rem 0' }}>{l.date}</td>
                        <td style={{ padding: '0.5rem' }}>{l.code_journal}</td>
                        <td style={{ padding: '0.5rem' }}>{l.n_facture}</td>
                        <td style={{ padding: '0.5rem' }}>{l.reference}</td>
                        <td style={{ padding: '0.5rem' }}>{l.libelle}</td>
                        <td style={{ padding: '0.5rem' }}>{l.compte_tiers}</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right' }}>{l.debit > 0 ? l.debit.toLocaleString() : ''}</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right' }}>{l.credit > 0 ? l.credit.toLocaleString() : ''}</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 500, color: l.solde_progressif >= 0 ? 'inherit' : 'var(--color-error)' }}>
                          {l.solde_progressif.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {glLedger.lignes.length > 0 && (
                    <tfoot>
                      <tr style={{ borderTop: '2px solid var(--color-border)', fontWeight: 'bold' }}>
                        <td colSpan="8" style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Solde final</td>
                        <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{glLedger.solde_final.toLocaleString()}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
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

        const getOhadaTitle = (compteStr) => {
          return getAccountLabel(compteStr, customAccounts);
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
                          <td style={{ padding: '0.4rem 0.5rem' }}>
                            <button
                              onClick={() => openGrandLivre(row.compte)}
                              style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-primary)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
                              title={`Voir le Grand Livre du compte ${row.compte}`}
                            >
                              {row.compte}
                            </button>
                          </td>
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

      case 'bilan': {
        const a = data.actif || {};
        const p = data.passif || {};
        const actifRows = [
          { label: 'Immobilisations brutes', value: a.immobilisationsBrutes || 0 },
          { label: 'Amortissements', value: -(a.amortissements || 0) },
          { label: 'Stocks', value: a.stocks || 0 },
          { label: 'Créances clients', value: a.creancesClients || 0 },
          { label: 'Autres créances', value: a.autresCreances || 0 },
          { label: 'Trésorerie', value: a.tresorerieActif || 0 },
        ];
        const passifRows = [
          { label: 'Capitaux propres', value: p.capitauxPropres || 0 },
          { label: "Résultat net de l'exercice", value: p.resultatNet || 0 },
          { label: 'Dettes fournisseurs', value: p.dettesFournisseurs || 0 },
          { label: 'Autres dettes', value: p.autresDettes || 0 },
          { label: 'Trésorerie passif', value: p.tresoreriePassif || 0 },
        ];
        const totalActif = a.total || 0;
        const totalPassif = p.total || 0;
        const equilibre = Math.abs(totalActif - totalPassif) < 1;

        return (
          <div>
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div style={{ flex: 1 }}>
                <h4 style={{ marginBottom: '1rem', color: 'var(--color-primary)' }}>ACTIF (Emplois)</h4>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <tbody>
                    {actifRows.map((row, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                        <td style={{ padding: '0.75rem 0' }}>{row.label}</td>
                        <td style={{ textAlign: 'right' }}>{row.value.toLocaleString()} FCFA</td>
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
                    {passifRows.map((row, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                        <td style={{ padding: '0.75rem 0' }}>{row.label}</td>
                        <td style={{ textAlign: 'right' }}>{row.value.toLocaleString()} FCFA</td>
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
            <div style={{
              marginTop: '1.5rem', padding: '0.75rem', borderRadius: 'var(--radius-md)', textAlign: 'center', fontWeight: 500,
              background: equilibre ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              color: equilibre ? '#15803d' : '#b91c1c'
            }}>
              {equilibre ? 'Bilan équilibré (Actif = Passif)' : `Bilan déséquilibré : écart de ${Math.abs(totalActif - totalPassif).toLocaleString()} FCFA`}
            </div>
          </div>
        );
      }

      case 'resultat': {
        const r = data || {};
        const rows = [
          { label: "Chiffre d'affaires", value: r.ca || 0 },
          { label: 'Achats', value: -(r.achats || 0) },
          { label: 'Marge brute', value: r.margeBrute || 0, strong: true },
          { label: 'Services extérieurs', value: -(r.servicesExterieurs || 0) },
          { label: 'Valeur ajoutée', value: r.valeurAjoutee || 0, strong: true },
          { label: 'Charges de personnel', value: -(r.chargesPersonnel || 0) },
          { label: "Excédent brut d'exploitation (EBE)", value: r.ebe || 0, strong: true },
          { label: 'Dotations aux amortissements', value: -(r.dotationsAmort || 0) },
          { label: "Résultat d'exploitation", value: r.resultatExploitation || 0, strong: true },
          { label: 'Autres produits', value: r.autresProduits || 0 },
          { label: 'Autres charges', value: -(r.autresCharges || 0) },
          ...(r.produitsHAO || r.chargesHAO ? [
            { label: 'Produits HAO', value: r.produitsHAO || 0 },
            { label: 'Charges HAO', value: -(r.chargesHAO || 0) },
          ] : []),
        ];
        const resultatNet = r.resultatNet || 0;

        return (
          <div style={{ maxWidth: '600px', margin: '0 auto' }}>
            <h4 style={{ marginBottom: '1.5rem', textAlign: 'center' }}>Compte de Résultat (SYSCOHADA)</h4>
            {rows.map((row, idx) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.6rem 0.25rem', borderBottom: '1px solid rgba(0,0,0,0.05)', fontWeight: row.strong ? 600 : 400 }}>
                <span>{row.label}</span>
                <span style={{ color: row.value >= 0 ? 'var(--color-success)' : 'var(--color-error)' }}>{row.value.toLocaleString()} FCFA</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem', marginTop: '1rem', background: 'rgba(255,255,255,0.6)', borderRadius: 'var(--radius-md)' }}>
              <span style={{ fontWeight: 'bold', fontSize: '1.125rem' }}>Résultat Net</span>
              <span style={{ fontWeight: 'bold', fontSize: '1.125rem', color: resultatNet >= 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
                {resultatNet.toLocaleString()} FCFA
              </span>
            </div>
          </div>
        );
      }
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
        <button className={`btn ${activeTab === 'grandlivre' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('grandlivre')}>Grand Livre</button>
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
