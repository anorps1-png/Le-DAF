import { useState, useEffect, useMemo, Fragment } from 'react';
import { Users, AlertTriangle, Pencil, CheckCircle, X, GitMerge } from 'lucide-react';
import { getAccountLabel } from '../utils/ohadaPlan';
import { AccountPicker } from '../components/AccountPicker';

export const TiersModule = () => {
  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [glComptes, setGlComptes] = useState([]);
  const [customAccounts, setCustomAccounts] = useState({});
  const [selectedNoms, setSelectedNoms] = useState([]);
  const [expandedNom, setExpandedNom] = useState(null);
  const [releve, setReleve] = useState(null);
  const [releveLoading, setReleveLoading] = useState(false);
  const [editingNom, setEditingNom] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [bulkCompte, setBulkCompte] = useState('');
  const [bulkApplying, setBulkApplying] = useState(false);
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeKeepNom, setMergeKeepNom] = useState('');
  const [merging, setMerging] = useState(false);
  const [actionMsg, setActionMsg] = useState(null);

  const loadTiers = () => {
    setLoading(true);
    fetch('/api/tiers')
      .then(res => res.json())
      .then(data => {
        setTiers(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadTiers();
    fetch('/api/grand-livre/comptes')
      .then(res => res.json())
      .then(rows => { if (Array.isArray(rows)) setGlComptes(rows); })
      .catch(e => console.error(e));
    fetch('/api/chart-of-accounts')
      .then(res => res.json())
      .then(rows => {
        const map = {};
        (rows || []).forEach(r => { map[r.compte] = r.libelle; });
        setCustomAccounts(map);
      })
      .catch(e => console.error(e));
  }, []);

  const accountOptions = useMemo(() => {
    const map = new Map();
    (glComptes || []).forEach(c => {
      const compte = String(c.compte || '');
      if (compte) map.set(compte, getAccountLabel(compte, customAccounts));
    });
    Object.keys(customAccounts || {}).forEach(compte => {
      if (!map.has(compte)) map.set(compte, customAccounts[compte]);
    });
    return Array.from(map.entries())
      .map(([compte, libelle]) => ({ compte, libelle }))
      .sort((a, b) => a.compte.localeCompare(b.compte));
  }, [glComptes, customAccounts]);

  const clients = tiers.filter(t => t.type === 'Client');
  const fournisseurs = tiers.filter(t => t.type === 'Fournisseur');
  const totalCreances = clients.reduce((acc, c) => acc + (c.solde || 0), 0);
  const totalDettes = fournisseurs.reduce((acc, f) => acc + (f.solde || 0), 0);

  const toggleSelected = (nom) => {
    setSelectedNoms(prev => prev.includes(nom) ? prev.filter(n => n !== nom) : [...prev, nom]);
    setMergeMode(false);
  };

  const toggleExpand = (nom) => {
    if (expandedNom === nom) { setExpandedNom(null); setReleve(null); return; }
    setExpandedNom(nom);
    setReleve(null);
    setReleveLoading(true);
    fetch(`/api/tiers/${encodeURIComponent(nom)}/releve`)
      .then(res => res.json())
      .then(data => setReleve(data))
      .catch(() => setReleve({ error: 'Impossible de charger le relevé.' }))
      .finally(() => setReleveLoading(false));
  };

  const startEdit = (t) => {
    setActionMsg(null);
    setEditingNom(t.nom);
    setEditForm({ nom: t.nom, compte_comptable: t.compte_comptable || '' });
  };

  const cancelEdit = () => { setEditingNom(null); setEditForm(null); };

  const saveEdit = async (oldNom) => {
    if (!editForm.nom.trim()) { setActionMsg({ type: 'error', text: 'Le nom est obligatoire.' }); return; }
    try {
      const res = await fetch(`/api/tiers/${encodeURIComponent(oldNom)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nom: editForm.nom.trim(), compte_comptable: editForm.compte_comptable.trim() || null })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setActionMsg({ type: 'error', text: data.error || 'Erreur lors de la modification.' });
        return;
      }
      setActionMsg({ type: 'success', text: 'Tiers modifié.' });
      setEditingNom(null);
      setEditForm(null);
      loadTiers();
    } catch (e) {
      setActionMsg({ type: 'error', text: 'Impossible de joindre le serveur.' });
    }
  };

  const applyBulkCompte = async () => {
    if (!bulkCompte.trim() || selectedNoms.length === 0) return;
    setBulkApplying(true);
    setActionMsg(null);
    try {
      const res = await fetch('/api/tiers/bulk-compte', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noms: selectedNoms, compte_comptable: bulkCompte.trim() })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setActionMsg({ type: 'error', text: data.error || 'Erreur lors du changement de compte.' });
      } else {
        setActionMsg({ type: 'success', text: `${data.changes} tiers rattaché(s) au compte ${bulkCompte.trim()}.` });
        setSelectedNoms([]);
        setBulkCompte('');
        loadTiers();
      }
    } catch (e) {
      setActionMsg({ type: 'error', text: 'Impossible de joindre le serveur.' });
    } finally {
      setBulkApplying(false);
    }
  };

  const openMerge = () => {
    if (selectedNoms.length !== 2) return;
    setMergeKeepNom(selectedNoms[0]);
    setMergeMode(true);
  };

  const confirmMerge = async () => {
    const [a, b] = selectedNoms;
    const keepNom = mergeKeepNom;
    const mergeNom = keepNom === a ? b : a;
    setMerging(true);
    setActionMsg(null);
    try {
      const res = await fetch('/api/tiers/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keepNom, mergeNom })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setActionMsg({ type: 'error', text: data.error || 'Erreur lors de la fusion.' });
      } else {
        setActionMsg({ type: 'success', text: `Fusion effectuée : "${mergeNom}" a rejoint "${keepNom}" (${data.changes} écriture(s) rattachée(s)).` });
        setSelectedNoms([]);
        setMergeMode(false);
        if (expandedNom === mergeNom) { setExpandedNom(null); setReleve(null); }
        loadTiers();
      }
    } catch (e) {
      setActionMsg({ type: 'error', text: 'Impossible de joindre le serveur.' });
    } finally {
      setMerging(false);
    }
  };

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

        {selectedNoms.length > 0 && (
          <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: 'rgba(59, 130, 246, 0.08)', border: '1px solid var(--color-primary)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: '0.85rem' }}>{selectedNoms.length} tiers sélectionné(s)</strong>

            {!mergeMode && (
              <>
                <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>Rattacher au compte :</span>
                <AccountPicker value={bulkCompte} onChange={setBulkCompte} accounts={accountOptions} style={{ width: '220px' }} />
                <button
                  className="btn btn-primary"
                  disabled={!bulkCompte.trim() || bulkApplying}
                  onClick={applyBulkCompte}
                  style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                >
                  {bulkApplying ? 'Application...' : `Appliquer à ${selectedNoms.length} tiers`}
                </button>
                {selectedNoms.length === 2 && (
                  <button className="btn btn-secondary" onClick={openMerge} style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <GitMerge size={14} /> Fusionner ces 2 tiers
                  </button>
                )}
              </>
            )}

            {mergeMode && (
              <>
                <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>Nom à conserver :</span>
                {selectedNoms.map(n => (
                  <label key={n} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                    <input type="radio" name="mergeKeep" checked={mergeKeepNom === n} onChange={() => setMergeKeepNom(n)} />
                    {n}
                  </label>
                ))}
                <button className="btn btn-primary" disabled={merging} onClick={confirmMerge} style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>
                  {merging ? 'Fusion...' : 'Confirmer la fusion'}
                </button>
                <button className="btn btn-secondary" onClick={() => setMergeMode(false)} style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>Annuler</button>
              </>
            )}

            <button
              className="btn btn-secondary"
              onClick={() => { setSelectedNoms([]); setMergeMode(false); }}
              style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', marginLeft: 'auto' }}
            >
              Annuler la sélection
            </button>
          </div>
        )}

        {actionMsg && (
          <div style={{ marginBottom: '1rem', padding: '0.6rem 1rem', borderRadius: 'var(--radius-md)', fontSize: '0.85rem', background: actionMsg.type === 'error' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)', color: actionMsg.type === 'error' ? '#b91c1c' : '#047857' }}>
            {actionMsg.text}
          </div>
        )}

        {loading ? (
          <p>Chargement depuis la base de données...</p>
        ) : tiers.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', background: 'rgba(255,255,255,0.5)', borderRadius: 'var(--radius-md)' }}>
            <AlertTriangle size={32} color="var(--color-warning)" style={{ margin: '0 auto 1rem' }} />
            <p>Aucun tiers trouvé dans la base.</p>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>Utilisez le module d'importation Excel pour ajouter vos clients et fournisseurs.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
                  <th style={{ padding: '0.75rem 0', width: '2rem' }}>
                    <input
                      type="checkbox"
                      checked={tiers.length > 0 && selectedNoms.length === tiers.length}
                      onChange={e => setSelectedNoms(e.target.checked ? tiers.map(t => t.nom) : [])}
                    />
                  </th>
                  <th>Type</th>
                  <th>Nom</th>
                  <th>Compte</th>
                  <th>Solde</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tiers.map(t => {
                  const isEditing = editingNom === t.nom;
                  const isExpanded = expandedNom === t.nom;
                  return (
                    <Fragment key={t.id}>
                      <tr
                        style={{ borderBottom: '1px solid rgba(0,0,0,0.05)', cursor: isEditing ? 'default' : 'pointer', background: isExpanded ? 'rgba(59,130,246,0.05)' : 'transparent' }}
                        onClick={() => !isEditing && toggleExpand(t.nom)}
                      >
                        <td style={{ padding: '0.75rem 0' }} onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={selectedNoms.includes(t.nom)} onChange={() => toggleSelected(t.nom)} />
                        </td>
                        <td>{t.type}</td>
                        <td style={{ fontWeight: 500 }}>
                          {isEditing ? (
                            <input
                              className="input"
                              style={{ padding: '0.35rem', width: '180px' }}
                              value={editForm.nom}
                              onClick={e => e.stopPropagation()}
                              onChange={e => setEditForm({ ...editForm, nom: e.target.value })}
                            />
                          ) : t.nom}
                        </td>
                        <td onClick={e => isEditing && e.stopPropagation()}>
                          {isEditing ? (
                            <AccountPicker
                              value={editForm.compte_comptable}
                              onChange={v => setEditForm({ ...editForm, compte_comptable: v })}
                              accounts={accountOptions}
                              style={{ width: '140px' }}
                            />
                          ) : t.compte_comptable}
                        </td>
                        <td style={{ color: t.solde > 0 ? 'var(--color-success)' : 'inherit' }}>{(t.solde || 0).toLocaleString()} FCFA</td>
                        <td onClick={e => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                          {isEditing ? (
                            <>
                              <button onClick={() => saveEdit(t.nom)} title="Enregistrer" style={{ background: 'none', border: 'none', color: 'var(--color-success)', cursor: 'pointer', padding: '0.3rem' }}>
                                <CheckCircle size={16} />
                              </button>
                              <button onClick={cancelEdit} title="Annuler" style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '0.3rem' }}>
                                <X size={16} />
                              </button>
                            </>
                          ) : (
                            <button onClick={() => startEdit(t)} title="Modifier" style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', padding: '0.3rem' }}>
                              <Pencil size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={6} style={{ padding: '0.75rem 1rem 1.25rem 2.5rem', background: 'rgba(0,0,0,0.015)' }}>
                            {releveLoading ? (
                              <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>Chargement du relevé...</span>
                            ) : releve && releve.error ? (
                              <span style={{ fontSize: '0.85rem', color: '#b91c1c' }}>{releve.error}</span>
                            ) : releve ? (
                              <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.8rem', minWidth: '700px' }}>
                                  <thead>
                                    <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                                      <th style={{ padding: '0.4rem 0.5rem 0.4rem 0' }}>Date</th>
                                      <th style={{ padding: '0.4rem 0.5rem' }}>Journal</th>
                                      <th style={{ padding: '0.4rem 0.5rem' }}>Compte</th>
                                      <th style={{ padding: '0.4rem 0.5rem' }}>Libellé</th>
                                      <th style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>Débit</th>
                                      <th style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>Crédit</th>
                                      <th style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>Solde progressif</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {!!releve.solde_ouverture && (
                                      <tr style={{ fontStyle: 'italic', color: 'var(--color-text-muted)' }}>
                                        <td colSpan={6} style={{ padding: '0.4rem 0.5rem' }}>Solde d'ouverture (reporté)</td>
                                        <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', fontWeight: 500 }}>{releve.solde_ouverture.toLocaleString()}</td>
                                      </tr>
                                    )}
                                    {releve.lignes.length === 0 ? (
                                      <tr><td colSpan={7} style={{ padding: '1rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>Aucune écriture pour ce tiers sur la période sélectionnée.</td></tr>
                                    ) : releve.lignes.map(l => (
                                      <tr key={l.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                                        <td style={{ padding: '0.4rem 0.5rem 0.4rem 0' }}>{l.date}</td>
                                        <td style={{ padding: '0.4rem 0.5rem' }}>{l.code_journal}</td>
                                        <td style={{ padding: '0.4rem 0.5rem' }}>{l.compte}</td>
                                        <td style={{ padding: '0.4rem 0.5rem' }}>{l.libelle}</td>
                                        <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{l.debit > 0 ? l.debit.toLocaleString() : ''}</td>
                                        <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{l.credit > 0 ? l.credit.toLocaleString() : ''}</td>
                                        <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', fontWeight: 500 }}>{l.solde_progressif.toLocaleString()}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                  {releve.lignes.length > 0 && (
                                    <tfoot>
                                      <tr style={{ borderTop: '2px solid var(--color-border)', fontWeight: 'bold' }}>
                                        <td colSpan={6} style={{ padding: '0.5rem', textAlign: 'right' }}>Solde final</td>
                                        <td style={{ padding: '0.5rem', textAlign: 'right' }}>{releve.solde_final.toLocaleString()}</td>
                                      </tr>
                                    </tfoot>
                                  )}
                                </table>
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
