import { useState, useEffect, useMemo, Fragment } from 'react';
import { Users, AlertTriangle, Pencil, CheckCircle, X, GitMerge, Trash2, CreditCard, Search, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { getAccountLabel } from '../utils/ohadaPlan';
import { AccountPicker } from '../components/AccountPicker';
import { adminFetch } from '../utils/adminAuth';

export const TiersModule = () => {
  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [glComptes, setGlComptes] = useState([]);
  const [customAccounts, setCustomAccounts] = useState({});
  const [saisieConfig, setSaisieConfig] = useState(null);
  const [selectedNoms, setSelectedNoms] = useState([]);
  const [expandedNom, setExpandedNom] = useState(null);
  const [releve, setReleve] = useState(null);
  const [releveLoading, setReleveLoading] = useState(false);
  const [selectedLigneIds, setSelectedLigneIds] = useState([]);
  const [bulkDeletingLignes, setBulkDeletingLignes] = useState(false);
  const [editingNom, setEditingNom] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [bulkCompte, setBulkCompte] = useState('');
  const [bulkApplying, setBulkApplying] = useState(false);
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeKeepNom, setMergeKeepNom] = useState('');
  const [merging, setMerging] = useState(false);
  const [actionMsg, setActionMsg] = useState(null);
  const [reglementModal, setReglementModal] = useState(null);
  const [reglementSubmitting, setReglementSubmitting] = useState(false);

  // Filtres d'affichage : Tous, Clients (41x), Fournisseurs (40x)
  const [activeTab, setActiveTab] = useState('tous'); // 'tous' | 'clients' | 'fournisseurs'
  const [searchQuery, setSearchQuery] = useState('');

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
    fetch('/api/journal/config-saisie')
      .then(res => res.json())
      .then(data => setSaisieConfig(data))
      .catch(e => console.error(e));
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

  // Distinction nette entre Clients (41x) et Fournisseurs (40x)
  const clients = useMemo(() => tiers.filter(t => t.type === 'Client' || String(t.compte_comptable || '').startsWith('41')), [tiers]);
  const fournisseurs = useMemo(() => tiers.filter(t => t.type === 'Fournisseur' || String(t.compte_comptable || '').startsWith('40')), [tiers]);
  const totalCreances = useMemo(() => clients.reduce((acc, c) => acc + (c.solde || 0), 0), [clients]);
  const totalDettes = useMemo(() => fournisseurs.reduce((acc, f) => acc + (f.solde || 0), 0), [fournisseurs]);

  // Filtrage combiné par onglet et recherche textuelle
  const displayedTiers = useMemo(() => {
    let list = tiers;
    if (activeTab === 'clients') {
      list = clients;
    } else if (activeTab === 'fournisseurs') {
      list = fournisseurs;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(t =>
        (t.nom && t.nom.toLowerCase().includes(q)) ||
        (t.compte_comptable && String(t.compte_comptable).toLowerCase().includes(q))
      );
    }
    return list;
  }, [tiers, activeTab, clients, fournisseurs, searchQuery]);

  const toggleSelected = (nom) => {
    setSelectedNoms(prev => prev.includes(nom) ? prev.filter(n => n !== nom) : [...prev, nom]);
    setMergeMode(false);
  };

  const toggleExpand = (nom) => {
    setSelectedLigneIds([]); // Réinitialise la sélection de lignes à chaque changement de tiers
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
      setActionMsg({ type: 'success', text: 'Tiers modifié avec succès.' });
      setEditingNom(null);
      setEditForm(null);
      loadTiers();
    } catch (e) {
      setActionMsg({ type: 'error', text: 'Impossible de joindre le serveur.' });
    }
  };

  const isAchatJournal = (code) => {
    if (!code) return false;
    const clean = String(code).trim().toUpperCase();
    if (/^(AC|ACH|HA)/i.test(clean) || clean.includes('ACH')) return true;
    return (saisieConfig?.journaux_achats || []).some(j => clean.includes(j.toUpperCase()));
  };

  const openReglementModal = (ligne, tier) => {
    const defaultMode = 'Caisse';
    const journalReglement = (saisieConfig?.journaux_caisse && saisieConfig.journaux_caisse[0]) || 'CAISPH';
    const compteTresorerie = (saisieConfig?.comptes_caisse && saisieConfig.comptes_caisse[0]?.compte) || '57111001';
    setReglementModal({
      ligneId: ligne.id,
      nomTiers: tier.nom,
      compteTiers: tier.compte_comptable || ligne.compte || '401100',
      nFacture: ligne.n_facture || ligne.reference || '',
      libelleFacture: ligne.libelle || '',
      montant: Math.round(Number(ligne.credit || 0)),
      mode: defaultMode,
      compteTresorerie,
      journalReglement,
      dateReglement: new Date().toISOString().split('T')[0],
      reference: ligne.n_facture ? `REG-${ligne.n_facture}` : 'REGLEMENT'
    });
  };

  const handleModeChange = (newMode) => {
    if (!reglementModal) return;
    if (newMode === 'Banque') {
      const jBq = (saisieConfig?.journaux_banque && saisieConfig.journaux_banque[0]) || 'BQ';
      const cBq = (saisieConfig?.comptes_banque && saisieConfig.comptes_banque[0]?.compte) || '521100';
      setReglementModal({
        ...reglementModal,
        mode: 'Banque',
        journalReglement: jBq,
        compteTresorerie: cBq
      });
    } else {
      const jCaisse = (saisieConfig?.journaux_caisse && saisieConfig.journaux_caisse[0]) || 'CAISPH';
      const cCaisse = (saisieConfig?.comptes_caisse && saisieConfig.comptes_caisse[0]?.compte) || '57111001';
      setReglementModal({
        ...reglementModal,
        mode: 'Caisse',
        journalReglement: jCaisse,
        compteTresorerie: cCaisse
      });
    }
  };

  const submitReglement = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!reglementModal || !reglementModal.montant || Number(reglementModal.montant) <= 0) {
      setActionMsg({ type: 'error', text: 'Veuillez saisir un montant de règlement valide.' });
      return;
    }
    setReglementSubmitting(true);
    setActionMsg(null);
    try {
      const res = await adminFetch('/api/tiers/reglement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ligne_facture_id: reglementModal.ligneId,
          nom_tiers: reglementModal.nomTiers,
          compte_tiers: reglementModal.compteTiers,
          montant: Number(reglementModal.montant),
          date_reglement: reglementModal.dateReglement,
          compte_tresorerie: reglementModal.compteTresorerie,
          code_journal_reglement: reglementModal.journalReglement,
          libelle: `Règlement Facture ${reglementModal.nFacture ? reglementModal.nFacture + ' - ' : ''}${reglementModal.nomTiers}`.trim(),
          reference: reglementModal.reference,
          mode_paiement: reglementModal.mode
        })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setActionMsg({ type: 'error', text: data.error || 'Erreur lors de l\'enregistrement du règlement.' });
      } else {
        setActionMsg({ type: 'success', text: data.message || 'Règlement enregistré avec succès.' });
        setReglementModal(null);
        if (expandedNom) {
          setReleveLoading(true);
          fetch(`/api/tiers/${encodeURIComponent(expandedNom)}/releve`)
            .then(r => r.json())
            .then(d => setReleve(d))
            .catch(() => setReleve({ error: 'Impossible de recharger le relevé.' }))
            .finally(() => setReleveLoading(false));
        }
        loadTiers();
      }
    } catch (err) {
      console.error(err);
      setActionMsg({ type: 'error', text: 'Erreur réseau lors de l\'enregistrement du règlement.' });
    } finally {
      setReglementSubmitting(false);
    }
  };

  // Suppression unitaire d'une ligne d'écriture
  const deleteLigneReleve = async (ligneId) => {
    if (!window.confirm("Êtes-vous sûr de vouloir supprimer cette ligne d'écriture ?\n\nSa contrepartie au sein du même journal d'achat/vente sera supprimée pour éliminer le doublon, mais tout règlement de trésorerie attaché restera intact.")) {
      return;
    }
    setActionMsg(null);
    try {
      const res = await adminFetch(`/api/tiers/ligne/${ligneId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || data.error) {
        setActionMsg({ type: 'error', text: data.error || 'Erreur lors de la suppression de la ligne.' });
        return;
      }
      setActionMsg({
        type: 'success',
        text: `Écriture supprimée (${data.deletedCount} ligne(s) au total avec contrepartie). Tout règlement rattaché est préservé.`
      });
      setSelectedLigneIds(prev => prev.filter(id => id !== ligneId));
      if (expandedNom) {
        setReleveLoading(true);
        fetch(`/api/tiers/${encodeURIComponent(expandedNom)}/releve`)
          .then(r => r.json())
          .then(d => setReleve(d))
          .catch(() => setReleve({ error: 'Impossible de recharger le relevé.' }))
          .finally(() => setReleveLoading(false));
      }
      loadTiers();
    } catch (err) {
      console.error(err);
      setActionMsg({ type: 'error', text: 'Erreur réseau lors de la suppression.' });
    }
  };

  // Suppression multiple de lignes sélectionnées pour ce client / fournisseur
  const deleteSelectedLignes = async () => {
    if (selectedLigneIds.length === 0) return;
    const count = selectedLigneIds.length;
    if (!window.confirm(`Êtes-vous sûr de vouloir supprimer ces ${count} écriture(s) ?\n\nLeurs contreparties au sein du même journal seront également supprimées pour équilibrer les soldes, tandis que les règlements de trésorerie (comptes 5xx) resteront intacts.`)) {
      return;
    }
    setBulkDeletingLignes(true);
    setActionMsg(null);
    try {
      const res = await adminFetch('/api/tiers/lignes/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedLigneIds })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setActionMsg({ type: 'error', text: data.error || 'Erreur lors de la suppression multiple des écritures.' });
      } else {
        setActionMsg({
          type: 'success',
          text: `Suppression réussie : ${data.deletedCount} ligne(s) supprimée(s) au total (${data.requestedCount} sélectionnée(s) + ${data.counterpartsCount || 0} contrepartie(s)). Tout règlement de trésorerie est resté intact.`
        });
        setSelectedLigneIds([]);
        if (expandedNom) {
          setReleveLoading(true);
          fetch(`/api/tiers/${encodeURIComponent(expandedNom)}/releve`)
            .then(r => r.json())
            .then(d => setReleve(d))
            .catch(() => setReleve({ error: 'Impossible de recharger le relevé.' }))
            .finally(() => setReleveLoading(false));
        }
        loadTiers();
      }
    } catch (err) {
      console.error(err);
      setActionMsg({ type: 'error', text: 'Erreur réseau lors de la suppression multiple.' });
    } finally {
      setBulkDeletingLignes(false);
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

  // Calcul totaux des lignes sélectionnées dans le relevé
  const selectedLignesDebit = useMemo(() => {
    if (!releve?.lignes || selectedLigneIds.length === 0) return 0;
    return releve.lignes
      .filter(l => selectedLigneIds.includes(l.id))
      .reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
  }, [releve, selectedLigneIds]);

  const selectedLignesCredit = useMemo(() => {
    if (!releve?.lignes || selectedLigneIds.length === 0) return 0;
    return releve.lignes
      .filter(l => selectedLigneIds.includes(l.id))
      .reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
  }, [releve, selectedLigneIds]);

  return (
    <div className="card">
      <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Users style={{ color: 'var(--color-primary)' }} />
        Gestion des Tiers (Clients & Fournisseurs OHADA)
      </h3>

      {/* Cartes récapitulatives avec distinction claire */}
      <div className="module-grid">
        <div
          className="card"
          onClick={() => setActiveTab('clients')}
          style={{
            background: activeTab === 'clients' ? 'rgba(59, 130, 246, 0.12)' : 'rgba(255,255,255,0.4)',
            border: activeTab === 'clients' ? '2px solid #3b82f6' : '1px solid var(--color-border)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            position: 'relative'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#1d4ed8' }}>
              <ArrowDownRight size={18} /> Créances Clients (Comptes 41x)
            </h4>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, background: '#dbeafe', color: '#1e40af', padding: '0.15rem 0.5rem', borderRadius: '9999px' }}>
              Classe 41
            </span>
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 'bold', color: 'var(--color-text-main)' }}>
            {totalCreances.toLocaleString()} FCFA
          </div>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', margin: '0.5rem 0 1rem' }}>
            {clients.length} client(s) enregistrés
          </p>
          <button
            className={`btn ${activeTab === 'clients' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ width: '100%', fontSize: '0.85rem' }}
            onClick={(e) => { e.stopPropagation(); setActiveTab('clients'); }}
          >
            {activeTab === 'clients' ? '✓ Affichage des Clients actif' : 'Filtrer sur les Clients (41x)'}
          </button>
        </div>

        <div
          className="card"
          onClick={() => setActiveTab('fournisseurs')}
          style={{
            background: activeTab === 'fournisseurs' ? 'rgba(147, 51, 234, 0.12)' : 'rgba(255,255,255,0.4)',
            border: activeTab === 'fournisseurs' ? '2px solid #8b5cf6' : '1px solid var(--color-border)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            position: 'relative'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#6d28d9' }}>
              <ArrowUpRight size={18} /> Dettes Fournisseurs (Comptes 40x)
            </h4>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, background: '#ede9fe', color: '#5b21b6', padding: '0.15rem 0.5rem', borderRadius: '9999px' }}>
              Classe 40
            </span>
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 'bold', color: 'var(--color-text-main)' }}>
            {totalDettes.toLocaleString()} FCFA
          </div>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', margin: '0.5rem 0 1rem' }}>
            {fournisseurs.length} fournisseur(s) enregistrés
          </p>
          <button
            className={`btn ${activeTab === 'fournisseurs' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ width: '100%', fontSize: '0.85rem' }}
            onClick={(e) => { e.stopPropagation(); setActiveTab('fournisseurs'); }}
          >
            {activeTab === 'fournisseurs' ? '✓ Affichage des Fournisseurs actif' : 'Filtrer sur les Fournisseurs (40x)'}
          </button>
        </div>
      </div>

      {/* Barre d'onglets et recherche pour distinguer clairement clients et fournisseurs */}
      <div style={{ marginTop: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
          {/* Onglets de distinction */}
          <div style={{ display: 'inline-flex', background: 'var(--color-bg-subtle, rgba(0,0,0,0.05))', padding: '0.25rem', borderRadius: 'var(--radius-md, 8px)', gap: '0.25rem' }}>
            <button
              type="button"
              onClick={() => setActiveTab('tous')}
              style={{
                padding: '0.45rem 1rem',
                fontSize: '0.85rem',
                fontWeight: 600,
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                background: activeTab === 'tous' ? 'var(--color-surface, #ffffff)' : 'transparent',
                color: activeTab === 'tous' ? 'var(--color-text-main)' : 'var(--color-text-muted)',
                boxShadow: activeTab === 'tous' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.15s'
              }}
            >
              📋 Tous les tiers ({tiers.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('clients')}
              style={{
                padding: '0.45rem 1rem',
                fontSize: '0.85rem',
                fontWeight: 600,
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                background: activeTab === 'clients' ? '#2563eb' : 'transparent',
                color: activeTab === 'clients' ? '#ffffff' : '#2563eb',
                boxShadow: activeTab === 'clients' ? '0 1px 3px rgba(37,99,235,0.3)' : 'none',
                transition: 'all 0.15s'
              }}
            >
              👤 Clients (Comptes 41x) ({clients.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('fournisseurs')}
              style={{
                padding: '0.45rem 1rem',
                fontSize: '0.85rem',
                fontWeight: 600,
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                background: activeTab === 'fournisseurs' ? '#7c3aed' : 'transparent',
                color: activeTab === 'fournisseurs' ? '#ffffff' : '#7c3aed',
                boxShadow: activeTab === 'fournisseurs' ? '0 1px 3px rgba(124,58,237,0.3)' : 'none',
                transition: 'all 0.15s'
              }}
            >
              🏢 Fournisseurs (Comptes 40x) ({fournisseurs.length})
            </button>
          </div>

          {/* Recherche rapide */}
          <div style={{ position: 'relative', width: '280px' }}>
            <Search size={15} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
            <input
              type="text"
              className="input"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Rechercher nom, compte 411/401..."
              style={{ width: '100%', paddingLeft: '2.2rem', paddingRight: '0.75rem', fontSize: '0.85rem' }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                style={{ position: 'absolute', right: '0.5rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Barre d'action groupée pour les tiers (rattachement compte / fusion) */}
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
        ) : displayedTiers.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', background: 'rgba(255,255,255,0.5)', borderRadius: 'var(--radius-md)' }}>
            <AlertTriangle size={32} color="var(--color-warning)" style={{ margin: '0 auto 1rem' }} />
            <p>
              {searchQuery ? 'Aucun tiers ne correspond à votre recherche.' : (activeTab === 'clients' ? 'Aucun client (compte 41x) trouvé.' : (activeTab === 'fournisseurs' ? 'Aucun fournisseur (compte 40x) trouvé.' : 'Aucun tiers trouvé dans la base.'))}
            </p>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
              Utilisez le module d'importation Excel pour ajouter vos clients et fournisseurs ou ajustez vos critères de filtrage.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
                  <th style={{ padding: '0.75rem 0', width: '2rem' }}>
                    <input
                      type="checkbox"
                      checked={displayedTiers.length > 0 && selectedNoms.length === displayedTiers.length}
                      onChange={e => setSelectedNoms(e.target.checked ? displayedTiers.map(t => t.nom) : [])}
                    />
                  </th>
                  <th>Catégorie Tiers</th>
                  <th>Nom / Raison Sociale</th>
                  <th>Compte Collectif</th>
                  <th>Solde Comptable</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayedTiers.map(t => {
                  const isEditing = editingNom === t.nom;
                  const isExpanded = expandedNom === t.nom;
                  const isClient = t.type === 'Client' || String(t.compte_comptable || '').startsWith('41');
                  const isFournisseur = t.type === 'Fournisseur' || String(t.compte_comptable || '').startsWith('40');

                  return (
                    <Fragment key={t.id || t.nom}>
                      <tr
                        style={{
                          borderBottom: '1px solid rgba(0,0,0,0.05)',
                          cursor: isEditing ? 'default' : 'pointer',
                          background: isExpanded ? 'rgba(59,130,246,0.05)' : 'transparent'
                        }}
                        onClick={() => !isEditing && toggleExpand(t.nom)}
                      >
                        <td style={{ padding: '0.75rem 0' }} onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={selectedNoms.includes(t.nom)} onChange={() => toggleSelected(t.nom)} />
                        </td>

                        {/* Badge de distinction claire Client (41x) vs Fournisseur (40x) */}
                        <td>
                          {isClient ? (
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.35rem',
                              padding: '0.2rem 0.65rem',
                              borderRadius: '9999px',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              background: 'rgba(37, 99, 235, 0.1)',
                              color: '#1d4ed8',
                              border: '1px solid rgba(37, 99, 235, 0.25)'
                            }}>
                              👤 Client (41x)
                            </span>
                          ) : isFournisseur ? (
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.35rem',
                              padding: '0.2rem 0.65rem',
                              borderRadius: '9999px',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              background: 'rgba(124, 58, 237, 0.1)',
                              color: '#6d28d9',
                              border: '1px solid rgba(124, 58, 237, 0.25)'
                            }}>
                              🏢 Fournisseur (40x)
                            </span>
                          ) : (
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.35rem',
                              padding: '0.2rem 0.65rem',
                              borderRadius: '9999px',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              background: 'rgba(107, 114, 128, 0.1)',
                              color: '#4b5563',
                              border: '1px solid rgba(107, 114, 128, 0.25)'
                            }}>
                              {t.type || 'Autre'}
                            </span>
                          )}
                        </td>

                        <td style={{ fontWeight: 600 }}>
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

                        {/* Compte comptable avec préfixe clair */}
                        <td onClick={e => isEditing && e.stopPropagation()}>
                          {isEditing ? (
                            <AccountPicker
                              value={editForm.compte_comptable}
                              onChange={v => setEditForm({ ...editForm, compte_comptable: v })}
                              accounts={accountOptions}
                              style={{ width: '140px' }}
                            />
                          ) : (
                            <span style={{
                              fontFamily: 'monospace',
                              fontWeight: 600,
                              background: isClient ? '#eff6ff' : (isFournisseur ? '#f5f3ff' : 'transparent'),
                              color: isClient ? '#1e40af' : (isFournisseur ? '#5b21b6' : 'inherit'),
                              padding: '0.15rem 0.45rem',
                              borderRadius: '4px'
                            }}>
                              {t.compte_comptable}
                            </span>
                          )}
                        </td>

                        {/* Solde avec précision de la nature Créance / Dette */}
                        <td>
                          <div style={{ fontWeight: 600, color: (t.solde || 0) > 0 ? (isClient ? '#059669' : '#dc2626') : 'inherit' }}>
                            {(t.solde || 0).toLocaleString()} FCFA
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                            {isClient ? (t.solde > 0 ? 'Créance nette client' : 'Solde client') : (t.solde > 0 ? 'Dette nette fournisseur' : 'Solde fournisseur')}
                          </div>
                        </td>

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

                      {/* Relevé de compte détaillé du tiers sélectionné */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={6} style={{ padding: '0.75rem 1rem 1.25rem 2.5rem', background: 'rgba(0,0,0,0.015)' }}>
                            {releveLoading ? (
                              <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>Chargement du relevé...</span>
                            ) : releve && releve.error ? (
                              <span style={{ fontSize: '0.85rem', color: '#b91c1c' }}>{releve.error}</span>
                            ) : releve ? (
                              <div>
                                {/* En-tête de la fiche de relevé */}
                                <div style={{
                                  marginBottom: '0.75rem',
                                  padding: '0.6rem 0.9rem',
                                  background: isClient ? 'rgba(37, 99, 235, 0.05)' : 'rgba(124, 58, 237, 0.05)',
                                  borderLeft: `4px solid ${isClient ? '#2563eb' : '#7c3aed'}`,
                                  borderRadius: 'var(--radius-md, 6px)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  flexWrap: 'wrap',
                                  gap: '0.5rem'
                                }}>
                                  <div>
                                    <strong style={{ fontSize: '0.9rem', color: isClient ? '#1d4ed8' : '#6d28d9' }}>
                                      {isClient ? `👤 Fiche Compte Client (41x) : ${t.nom}` : `🏢 Fiche Compte Fournisseur (40x) : ${t.nom}`}
                                    </strong>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                                      Compte collectif : <code style={{ fontWeight: 600 }}>{releve.compte_comptable || t.compte_comptable}</code>
                                      {isClient
                                        ? ' • Règle OHADA : Débit = Facturé | Crédit = Encaissé | Solde positif = Créance due'
                                        : ' • Règle OHADA : Crédit = Acheté / Facturé | Débit = Réglé | Solde positif = Dette due'}
                                    </div>
                                  </div>
                                  <div style={{ textAlign: 'right' }}>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Solde net dû : </span>
                                    <strong style={{ fontSize: '1rem', color: (releve.solde_du || 0) > 0 ? (isClient ? '#059669' : '#dc2626') : 'inherit' }}>
                                      {(releve.solde_du || 0).toLocaleString()} FCFA
                                    </strong>
                                  </div>
                                </div>

                                {/* BARRE D'ACTIONS GROUPÉES POUR LA SUPPRESSION MULTIPLE DE LIGNES */}
                                {selectedLigneIds.length > 0 && (
                                  <div style={{
                                    marginBottom: '0.75rem',
                                    padding: '0.6rem 1rem',
                                    background: 'rgba(239, 68, 68, 0.08)',
                                    border: '1px solid rgba(239, 68, 68, 0.35)',
                                    borderRadius: 'var(--radius-md, 8px)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    flexWrap: 'wrap',
                                    gap: '0.75rem'
                                  }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.85rem' }}>
                                      <strong style={{ color: '#b91c1c', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                        <Trash2 size={15} />
                                        {selectedLigneIds.length} écriture(s) sélectionnée(s)
                                      </strong>
                                      <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
                                        Total Débit : <strong>{selectedLignesDebit.toLocaleString()} FCFA</strong> | Total Crédit : <strong>{selectedLignesCredit.toLocaleString()} FCFA</strong>
                                      </span>
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                      <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={() => setSelectedLigneIds([])}
                                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                                      >
                                        Tout désélectionner
                                      </button>
                                      <button
                                        type="button"
                                        disabled={bulkDeletingLignes}
                                        onClick={deleteSelectedLignes}
                                        style={{
                                          padding: '0.4rem 0.9rem',
                                          fontSize: '0.82rem',
                                          background: '#dc2626',
                                          color: '#ffffff',
                                          border: 'none',
                                          borderRadius: '6px',
                                          cursor: bulkDeletingLignes ? 'not-allowed' : 'pointer',
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: '0.35rem',
                                          fontWeight: 600,
                                          boxShadow: '0 2px 4px rgba(220, 38, 38, 0.3)'
                                        }}
                                      >
                                        <Trash2 size={14} />
                                        {bulkDeletingLignes ? 'Suppression en cours...' : `Supprimer les ${selectedLigneIds.length} écritures`}
                                      </button>
                                    </div>
                                  </div>
                                )}

                                <div style={{ overflowX: 'auto' }}>
                                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.8rem', minWidth: '750px' }}>
                                    <thead>
                                      <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                                        {/* Checkbox Tout sélectionner pour la suppression multiple */}
                                        <th style={{ padding: '0.4rem 0.5rem 0.4rem 0.2rem', width: '2rem' }}>
                                          <input
                                            type="checkbox"
                                            checked={releve.lignes.length > 0 && selectedLigneIds.length === releve.lignes.length}
                                            onChange={e => setSelectedLigneIds(e.target.checked ? releve.lignes.map(l => l.id) : [])}
                                            title="Sélectionner / Désélectionner toutes les lignes pour suppression multiple"
                                          />
                                        </th>
                                        <th style={{ padding: '0.4rem 0.5rem' }}>Date</th>
                                        <th style={{ padding: '0.4rem 0.5rem' }}>Journal</th>
                                        <th style={{ padding: '0.4rem 0.5rem' }}>Compte</th>
                                        <th style={{ padding: '0.4rem 0.5rem' }}>Libellé</th>
                                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>Débit</th>
                                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>Crédit</th>
                                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>Solde progressif</th>
                                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'center', minWidth: '6.5rem' }}>Actions</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {!!releve.solde_ouverture && (
                                        <tr style={{ fontStyle: 'italic', color: 'var(--color-text-muted)' }}>
                                          <td></td>
                                          <td colSpan={6} style={{ padding: '0.4rem 0.5rem' }}>Solde d'ouverture (reporté)</td>
                                          <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', fontWeight: 500 }}>{releve.solde_ouverture.toLocaleString()}</td>
                                          <td></td>
                                        </tr>
                                      )}
                                      {releve.lignes.length === 0 ? (
                                        <tr><td colSpan={9} style={{ padding: '1rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>Aucune écriture pour ce tiers sur la période sélectionnée.</td></tr>
                                      ) : releve.lignes.map(l => {
                                        const isLineSelected = selectedLigneIds.includes(l.id);
                                        return (
                                          <tr
                                            key={l.id}
                                            style={{
                                              borderBottom: '1px solid rgba(0,0,0,0.04)',
                                              background: isLineSelected ? 'rgba(239, 68, 68, 0.06)' : 'transparent'
                                            }}
                                          >
                                            {/* Checkbox de sélection de ligne */}
                                            <td style={{ padding: '0.4rem 0.5rem 0.4rem 0.2rem' }}>
                                              <input
                                                type="checkbox"
                                                checked={isLineSelected}
                                                onChange={e => {
                                                  e.stopPropagation();
                                                  setSelectedLigneIds(prev => prev.includes(l.id) ? prev.filter(x => x !== l.id) : [...prev, l.id]);
                                                }}
                                                title="Sélectionner cette écriture pour suppression multiple"
                                              />
                                            </td>
                                            <td style={{ padding: '0.4rem 0.5rem' }}>{l.date}</td>
                                            <td style={{ padding: '0.4rem 0.5rem' }}>
                                              <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{l.code_journal}</span>
                                            </td>
                                            <td style={{ padding: '0.4rem 0.5rem' }}>
                                              <span style={{ fontFamily: 'monospace' }}>{l.compte}</span>
                                            </td>
                                            <td style={{ padding: '0.4rem 0.5rem' }}>{l.libelle}</td>
                                            <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{l.debit > 0 ? l.debit.toLocaleString() : ''}</td>
                                            <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{l.credit > 0 ? l.credit.toLocaleString() : ''}</td>
                                            <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', fontWeight: 500 }}>{l.solde_progressif.toLocaleString()}</td>
                                            <td style={{ padding: '0.4rem 0.5rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                              {isAchatJournal(l.code_journal) && Number(l.credit || 0) > 0 && (
                                                l.statut_lettrage === 'lettre' ? (
                                                  <span
                                                    style={{
                                                      display: 'inline-flex',
                                                      alignItems: 'center',
                                                      gap: '0.2rem',
                                                      fontSize: '0.72rem',
                                                      fontWeight: 600,
                                                      color: '#059669',
                                                      background: 'rgba(16, 185, 129, 0.1)',
                                                      padding: '0.15rem 0.4rem',
                                                      borderRadius: '4px',
                                                      marginRight: '0.4rem'
                                                    }}
                                                    title={`Facture réglée (Lettrage ${l.code_lettrage || ''})`}
                                                  >
                                                    <CheckCircle size={11} /> Réglé
                                                  </span>
                                                ) : (
                                                  <button
                                                    type="button"
                                                    onClick={() => openReglementModal(l, t)}
                                                    title="Régler cette facture fournisseur"
                                                    className="btn btn-secondary"
                                                    style={{
                                                      padding: '0.2rem 0.5rem',
                                                      fontSize: '0.75rem',
                                                      marginRight: '0.4rem',
                                                      display: 'inline-flex',
                                                      alignItems: 'center',
                                                      gap: '0.25rem',
                                                      background: 'rgba(79, 70, 229, 0.1)',
                                                      color: 'var(--color-primary, #4f46e5)',
                                                      border: '1px solid rgba(79, 70, 229, 0.2)'
                                                    }}
                                                  >
                                                    <CreditCard size={12} /> Régler
                                                  </button>
                                                )
                                              )}
                                              <button
                                                type="button"
                                                onClick={() => deleteLigneReleve(l.id)}
                                                title="Supprimer cette écriture et sa contrepartie"
                                                style={{
                                                  background: 'none',
                                                  border: 'none',
                                                  color: 'var(--color-error, #ef4444)',
                                                  cursor: 'pointer',
                                                  padding: '0.25rem',
                                                  borderRadius: '4px',
                                                  display: 'inline-flex',
                                                  alignItems: 'center',
                                                  justifyContent: 'center'
                                                }}
                                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'}
                                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                              >
                                                <Trash2 size={14} />
                                              </button>
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                    {releve.lignes.length > 0 && (
                                      <tfoot>
                                        <tr style={{ borderTop: '2px solid var(--color-border)', fontWeight: 'bold' }}>
                                          <td colSpan={7} style={{ padding: '0.5rem', textAlign: 'right' }}>Solde final</td>
                                          <td style={{ padding: '0.5rem', textAlign: 'right' }}>{releve.solde_final.toLocaleString()}</td>
                                          <td></td>
                                        </tr>
                                      </tfoot>
                                    )}
                                  </table>
                                </div>
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

        {/* Modal de règlement pour les factures fournisseurs */}
        {reglementModal && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.5)',
              backdropFilter: 'blur(3px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000
            }}
            onClick={() => !reglementSubmitting && setReglementModal(null)}
          >
            <div
              style={{
                background: 'var(--color-surface, #ffffff)',
                color: 'var(--color-text, #111827)',
                borderRadius: 'var(--radius-lg, 12px)',
                padding: '1.75rem',
                width: '90%',
                maxWidth: '520px',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)',
                border: '1px solid var(--color-border, #e5e7eb)'
              }}
              onClick={e => e.stopPropagation()}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', borderBottom: '1px solid var(--color-border, #e5e7eb)', paddingBottom: '0.75rem' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <CreditCard size={20} color="var(--color-primary, #4f46e5)" />
                    Règlement Facture Fournisseur
                  </h3>
                  <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--color-text-muted, #6b7280)' }}>
                    Fournisseur : <strong>{reglementModal.nomTiers}</strong>
                    {reglementModal.nFacture ? ` • Facture N° ${reglementModal.nFacture}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setReglementModal(null)}
                  disabled={reglementSubmitting}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted, #6b7280)', padding: '0.25rem' }}
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={submitReglement} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* Mode de règlement */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.4rem' }}>
                    Mode de règlement *
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className={reglementModal.mode === 'Caisse' ? 'btn btn-primary' : 'btn btn-secondary'}
                      onClick={() => handleModeChange('Caisse')}
                      style={{ padding: '0.5rem', fontSize: '0.875rem', justifyContent: 'center' }}
                    >
                      💵 Caisse
                    </button>
                    <button
                      type="button"
                      className={reglementModal.mode === 'Banque' ? 'btn btn-primary' : 'btn btn-secondary'}
                      onClick={() => handleModeChange('Banque')}
                      style={{ padding: '0.5rem', fontSize: '0.875rem', justifyContent: 'center' }}
                    >
                      🏦 Banque / Virement
                    </button>
                  </div>
                </div>

                {/* Journal de trésorerie & Compte */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.3rem' }}>
                      Code Journal *
                    </label>
                    <select
                      className="input"
                      value={reglementModal.journalReglement}
                      onChange={e => setReglementModal({ ...reglementModal, journalReglement: e.target.value })}
                      style={{ width: '100%', padding: '0.45rem', fontSize: '0.85rem' }}
                    >
                      {(reglementModal.mode === 'Banque' ? (saisieConfig?.journaux_banque || ['BQ']) : (saisieConfig?.journaux_caisse || ['CA', 'CAISPH', 'CAISPR'])).map(j => (
                        <option key={j} value={j}>{j}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.3rem' }}>
                      Compte Trésorerie *
                    </label>
                    {((reglementModal.mode === 'Banque' ? saisieConfig?.comptes_banque : saisieConfig?.comptes_caisse) || []).length > 0 ? (
                      <select
                        className="input"
                        value={reglementModal.compteTresorerie}
                        onChange={e => setReglementModal({ ...reglementModal, compteTresorerie: e.target.value })}
                        style={{ width: '100%', padding: '0.45rem', fontSize: '0.85rem' }}
                      >
                        {((reglementModal.mode === 'Banque' ? saisieConfig?.comptes_banque : saisieConfig?.comptes_caisse) || []).map(c => (
                          <option key={c.compte} value={c.compte}>
                            {c.compte} - {c.libelle || c.compte}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        className="input"
                        value={reglementModal.compteTresorerie}
                        onChange={e => setReglementModal({ ...reglementModal, compteTresorerie: e.target.value })}
                        placeholder={reglementModal.mode === 'Banque' ? '521100' : '571100'}
                        style={{ width: '100%', padding: '0.45rem', fontSize: '0.85rem' }}
                      />
                    )}
                  </div>
                </div>

                {/* Montant & Date */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.3rem' }}>
                      Montant à régler (FCFA) *
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      className="input"
                      value={reglementModal.montant}
                      onChange={e => setReglementModal({ ...reglementModal, montant: e.target.value })}
                      style={{ width: '100%', padding: '0.45rem', fontSize: '0.85rem', fontWeight: 600 }}
                      required
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.3rem' }}>
                      Date de règlement *
                    </label>
                    <input
                      type="date"
                      className="input"
                      value={reglementModal.dateReglement}
                      onChange={e => setReglementModal({ ...reglementModal, dateReglement: e.target.value })}
                      style={{ width: '100%', padding: '0.45rem', fontSize: '0.85rem' }}
                      required
                    />
                  </div>
                </div>

                {/* Référence de paiement */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.3rem' }}>
                    Référence / N° Pièce
                  </label>
                  <input
                    type="text"
                    className="input"
                    value={reglementModal.reference}
                    onChange={e => setReglementModal({ ...reglementModal, reference: e.target.value })}
                    placeholder="Ex: CHQ-00124, REC-984..."
                    style={{ width: '100%', padding: '0.45rem', fontSize: '0.85rem' }}
                  />
                </div>

                {/* Récapitulatif comptable */}
                <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(79, 70, 229, 0.05)', borderRadius: 'var(--radius-md, 8px)', border: '1px dashed var(--color-primary-light, #c7d2fe)', fontSize: '0.8rem', color: 'var(--color-text-muted, #4b5563)' }}>
                  <div><strong>Écriture générée automatiquement :</strong></div>
                  <div>• Débit Fournisseur {reglementModal.compteTiers} ({reglementModal.nomTiers}) : {Number(reglementModal.montant || 0).toLocaleString()} FCFA</div>
                  <div>• Crédit Trésorerie {reglementModal.compteTresorerie} : {Number(reglementModal.montant || 0).toLocaleString()} FCFA</div>
                </div>

                {/* Boutons d'action */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setReglementModal(null)}
                    disabled={reglementSubmitting}
                    style={{ padding: '0.45rem 0.9rem', fontSize: '0.85rem' }}
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={reglementSubmitting || !reglementModal.montant || Number(reglementModal.montant) <= 0}
                    style={{ padding: '0.45rem 1rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                  >
                    <CheckCircle size={15} />
                    {reglementSubmitting ? 'Enregistrement...' : 'Valider le règlement'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
