import { useState, useEffect } from 'react';
import { 
  Calculator, PieChart, TrendingUp, AlertTriangle, CheckCircle2, 
  Plus, Edit2, Trash2, RefreshCw, Layers, DollarSign, ArrowUpRight, ArrowDownRight,
  Filter, Search
} from 'lucide-react';

export const BudgetModule = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('all'); // all, charge, produit, alerte
  const [searchQuery, setSearchQuery] = useState('');
  
  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({
    compte_racine: '',
    libelle: '',
    type: 'charge',
    montant_alloue: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const fetchBudgets = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/budgets');
      const json = await res.json();
      if (json && json.items) {
        setData(json);
      } else {
        setData({ items: [], synthese: {} });
      }
    } catch (e) {
      console.error("Erreur chargement budgets:", e);
      setData({ items: [], synthese: {} });
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchBudgets();
  }, []);

  const formatFCFA = (val) => {
    return new Intl.NumberFormat('fr-FR').format(Math.round(val || 0)) + ' FCFA';
  };

  const openCreateModal = () => {
    setEditItem(null);
    setForm({
      compte_racine: '',
      libelle: '',
      type: 'charge',
      montant_alloue: ''
    });
    setErrorMsg('');
    setModalOpen(true);
  };

  const openEditModal = (item) => {
    setEditItem(item);
    setForm({
      compte_racine: item.compte_racine,
      libelle: item.libelle,
      type: item.type,
      montant_alloue: item.montant_alloue
    });
    setErrorMsg('');
    setModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.compte_racine.trim() || !form.libelle.trim() || !form.montant_alloue) {
      setErrorMsg('Veuillez remplir tous les champs obligatoires.');
      return;
    }

    setSubmitting(true);
    setErrorMsg('');
    try {
      const payload = {
        compte_racine: form.compte_racine.trim(),
        libelle: form.libelle.trim(),
        type: form.type,
        montant_alloue: parseFloat(form.montant_alloue) || 0
      };
      if (editItem) {
        payload.id = editItem.id;
      }

      const res = await fetch('/api/budgets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await res.json();
      if (result.success) {
        setModalOpen(false);
        fetchBudgets();
      } else {
        setErrorMsg(result.error || "Erreur lors de l'enregistrement.");
      }
    } catch (e) {
      setErrorMsg("Erreur réseau lors de l'enregistrement.");
    }
    setSubmitting(false);
  };

  const handleDelete = async (id, libelle) => {
    if (window.confirm(`Voulez-vous supprimer l'enveloppe budgétaire "${libelle}" ?`)) {
      try {
        await fetch(`/api/budgets/${id}`, { method: 'DELETE' });
        fetchBudgets();
      } catch (e) {
        console.error("Erreur suppression budget:", e);
      }
    }
  };

  if (loading && !data) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
        <RefreshCw style={{ animation: 'spin 1.5s linear infinite', marginBottom: '1rem', width: '32px', height: '32px', color: 'var(--color-primary)' }} />
        <p>Calcul des consommations budgétaires en cours...</p>
      </div>
    );
  }

  const { items = [], synthese = {}, exercice = '' } = data || {};

  const filteredItems = items.filter(item => {
    const matchSearch = item.libelle.toLowerCase().includes(searchQuery.toLowerCase()) || 
                        item.compte_racine.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchSearch) return false;

    if (filterType === 'charge') return item.type === 'charge';
    if (filterType === 'produit') return item.type === 'produit';
    if (filterType === 'alerte') return item.statut === 'depassement' || item.statut === 'vigilance' || item.statut === 'retard';
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Header Banner */}
      <div className="card" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', color: '#fff', borderRadius: 'var(--radius-lg)', padding: '1.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1.5rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <PieChart style={{ color: '#38bdf8', width: '28px', height: '28px' }} />
              <h2 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 700 }}>Contrôle Budgétaire & Suivi des Écarts</h2>
            </div>
            <p style={{ color: '#94a3b8', margin: 0, fontSize: '0.95rem' }}>
              Suivi en temps réel des enveloppes allouées versus réalisations comptables ({exercice}).
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button 
              className="btn btn-secondary"
              onClick={fetchBudgets}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)' }}
            >
              <RefreshCw size={16} className={loading ? 'spin' : ''} /> Actualiser
            </button>
            <button 
              className="btn btn-primary"
              onClick={openCreateModal}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#38bdf8', color: '#0f172a', fontWeight: 700 }}
            >
              <Plus size={18} /> Nouveau Poste Budgétaire
            </button>
          </div>
        </div>
      </div>

      {/* KPI Cards Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.25rem' }}>
        
        {/* Budget Charges */}
        <div className="card" style={{ borderLeft: '4px solid #ef4444' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
            <div>
              <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Budget Charges Alloué</span>
              <h3 style={{ margin: '0.25rem 0 0 0', fontSize: '1.4rem', fontWeight: 700, color: '#1e293b' }}>
                {formatFCFA(synthese.totalChargesAlloue)}
              </h3>
            </div>
            <div style={{ background: '#fee2e2', padding: '0.5rem', borderRadius: 'var(--radius-md)', color: '#dc2626' }}>
              <ArrowDownRight size={22} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>
            <span>Consommé : <strong>{formatFCFA(synthese.totalChargesConsomme)}</strong></span>
            <span style={{ fontWeight: 700, color: synthese.tauxConsommationCharges > 100 ? '#ef4444' : '#059669' }}>
              {synthese.tauxConsommationCharges}%
            </span>
          </div>
          <div style={{ width: '100%', height: '6px', background: '#e2e8f0', borderRadius: '3px', marginTop: '0.4rem', overflow: 'hidden' }}>
            <div style={{ 
              width: `${Math.min(100, synthese.tauxConsommationCharges || 0)}%`, 
              height: '100%', 
              background: synthese.tauxConsommationCharges > 100 ? '#ef4444' : synthese.tauxConsommationCharges > 80 ? '#f59e0b' : '#10b981' 
            }} />
          </div>
        </div>

        {/* Reliquat Disponible */}
        <div className="card" style={{ borderLeft: '4px solid #10b981' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
            <div>
              <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Reliquat Charges Disponible</span>
              <h3 style={{ margin: '0.25rem 0 0 0', fontSize: '1.4rem', fontWeight: 700, color: synthese.reliquatCharges >= 0 ? '#10b981' : '#ef4444' }}>
                {formatFCFA(synthese.reliquatCharges)}
              </h3>
            </div>
            <div style={{ background: '#d1fae5', padding: '0.5rem', borderRadius: 'var(--radius-md)', color: '#059669' }}>
              <CheckCircle2 size={22} />
            </div>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', margin: '0.5rem 0 0 0' }}>
            {synthese.reliquatCharges >= 0 
              ? 'Capacité de dépenses d\'exploitation restante sous plafond.' 
              : 'Dépassement global du budget de fonctionnement alloué.'}
          </p>
        </div>

        {/* Objectif Ventes */}
        <div className="card" style={{ borderLeft: '4px solid #3b82f6' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
            <div>
              <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Objectif Ventes / Produits</span>
              <h3 style={{ margin: '0.25rem 0 0 0', fontSize: '1.4rem', fontWeight: 700, color: '#2563eb' }}>
                {formatFCFA(synthese.totalProduitsAlloue)}
              </h3>
            </div>
            <div style={{ background: '#dbeafe', padding: '0.5rem', borderRadius: 'var(--radius-md)', color: '#2563eb' }}>
              <ArrowUpRight size={22} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>
            <span>Réalisé : <strong>{formatFCFA(synthese.totalProduitsConsomme)}</strong></span>
            <span style={{ fontWeight: 700, color: synthese.tauxRealisationProduits >= 100 ? '#10b981' : '#f59e0b' }}>
              {synthese.tauxRealisationProduits}%
            </span>
          </div>
          <div style={{ width: '100%', height: '6px', background: '#e2e8f0', borderRadius: '3px', marginTop: '0.4rem', overflow: 'hidden' }}>
            <div style={{ 
              width: `${Math.min(100, synthese.tauxRealisationProduits || 0)}%`, 
              height: '100%', 
              background: synthese.tauxRealisationProduits >= 100 ? '#10b981' : '#3b82f6' 
            }} />
          </div>
        </div>

      </div>

      {/* Filter and Search Bar */}
      <div className="card" style={{ padding: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button 
              className={`btn ${filterType === 'all' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilterType('all')}
              style={{ fontSize: '0.85rem' }}
            >
              Toutes les lignes ({items.length})
            </button>
            <button 
              className={`btn ${filterType === 'charge' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilterType('charge')}
              style={{ fontSize: '0.85rem' }}
            >
              Charges (Cl. 6)
            </button>
            <button 
              className={`btn ${filterType === 'produit' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilterType('produit')}
              style={{ fontSize: '0.85rem' }}
            >
              Produits / Ventes (Cl. 7)
            </button>
            <button 
              className={`btn ${filterType === 'alerte' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilterType('alerte')}
              style={{ fontSize: '0.85rem', color: filterType === 'alerte' ? '#fff' : '#ef4444' }}
            >
              ⚠️ Lignes en alerte / dépassement
            </button>
          </div>

          <div style={{ position: 'relative', width: '280px' }}>
            <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
            <input 
              type="text" 
              className="input" 
              placeholder="Rechercher compte ou libellé..." 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ paddingLeft: '2.25rem', width: '100%', fontSize: '0.85rem' }}
            />
          </div>
        </div>
      </div>

      {/* Main Budget Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg-light)', borderBottom: '2px solid var(--color-border)' }}>
                <th style={{ padding: '0.85rem 1rem' }}>Compte Racine</th>
                <th style={{ padding: '0.85rem 1rem' }}>Poste / Libellé</th>
                <th style={{ padding: '0.85rem 1rem' }}>Type</th>
                <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>Budget Alloué</th>
                <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>Réalisé / Consommé</th>
                <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>Écart / Reliquat</th>
                <th style={{ padding: '0.85rem 1rem', width: '180px' }}>Exécution</th>
                <th style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>Statut</th>
                <th style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-text-muted)' }}>
                    Aucun poste budgétaire ne correspond aux critères de filtre.
                  </td>
                </tr>
              ) : (
                filteredItems.map(item => {
                  const isCharge = item.type === 'charge';
                  const ecartColor = isCharge 
                    ? (item.ecart >= 0 ? '#10b981' : '#ef4444')
                    : (item.ecart <= 0 ? '#10b981' : '#f59e0b');

                  let badgeStyle = { background: '#dcfce7', color: '#166534', label: 'Normal' };
                  if (item.statut === 'depassement') badgeStyle = { background: '#fee2e2', color: '#991b1b', label: 'Dépassement' };
                  else if (item.statut === 'vigilance') badgeStyle = { background: '#fef3c7', color: '#92400e', label: 'Vigilance (>80%)' };
                  else if (item.statut === 'atteint') badgeStyle = { background: '#dcfce7', color: '#166534', label: 'Objectif Atteint' };
                  else if (item.statut === 'en_cours') badgeStyle = { background: '#e0f2fe', color: '#075985', label: 'En Cours' };
                  else if (item.statut === 'retard') badgeStyle = { background: '#fef3c7', color: '#92400e', label: 'En Retard (<70%)' };

                  return (
                    <tr key={item.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <span style={{ 
                          fontFamily: 'monospace', 
                          fontWeight: 700, 
                          background: isCharge ? 'rgba(239, 68, 68, 0.1)' : 'rgba(59, 130, 246, 0.1)', 
                          color: isCharge ? '#dc2626' : '#2563eb',
                          padding: '0.2rem 0.5rem', 
                          borderRadius: '4px' 
                        }}>
                          {item.compte_racine}
                        </span>
                      </td>
                      <td style={{ padding: '0.85rem 1rem', fontWeight: 600 }}>
                        {item.libelle}
                      </td>
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <span style={{ 
                          fontSize: '0.75rem', 
                          padding: '0.15rem 0.5rem', 
                          borderRadius: '12px', 
                          background: isCharge ? '#f1f5f9' : '#eff6ff',
                          color: isCharge ? '#475569' : '#1d4ed8',
                          fontWeight: 600,
                          textTransform: 'uppercase'
                        }}>
                          {isCharge ? 'Charge' : 'Produit'}
                        </span>
                      </td>
                      <td style={{ padding: '0.85rem 1rem', textAlign: 'right', fontWeight: 600 }}>
                        {formatFCFA(item.montant_alloue)}
                      </td>
                      <td style={{ padding: '0.85rem 1rem', textAlign: 'right', fontWeight: 700, color: '#0f172a' }}>
                        {formatFCFA(item.consomme)}
                      </td>
                      <td style={{ padding: '0.85rem 1rem', textAlign: 'right', fontWeight: 700, color: ecartColor }}>
                        {formatFCFA(item.ecart)}
                      </td>
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <div style={{ flex: 1, height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ 
                              width: `${Math.min(100, item.taux_consommation)}%`, 
                              height: '100%', 
                              background: item.statut === 'depassement' ? '#ef4444' : item.statut === 'vigilance' ? '#f59e0b' : '#10b981' 
                            }} />
                          </div>
                          <span style={{ fontSize: '0.8rem', fontWeight: 700, minWidth: '42px', textAlign: 'right' }}>
                            {item.taux_consommation}%
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>
                        <span style={{ 
                          fontSize: '0.75rem', 
                          padding: '0.2rem 0.6rem', 
                          borderRadius: '12px', 
                          fontWeight: 700,
                          background: badgeStyle.background,
                          color: badgeStyle.color,
                          whiteSpace: 'nowrap'
                        }}>
                          {badgeStyle.label}
                        </span>
                      </td>
                      <td style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.4rem' }}>
                          <button 
                            className="btn btn-secondary"
                            onClick={() => openEditModal(item)}
                            style={{ padding: '0.35rem', color: '#2563eb' }}
                            title="Modifier ce budget"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button 
                            className="btn btn-secondary"
                            onClick={() => handleDelete(item.id, item.libelle)}
                            style={{ padding: '0.35rem', color: '#ef4444' }}
                            title="Supprimer ce budget"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Ajout / Modification */}
      {modalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ width: '480px', maxWidth: '90vw' }}>
            <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Calculator size={20} color="var(--color-primary)" />
              {editItem ? 'Modifier le Poste Budgétaire' : 'Nouveau Poste Budgétaire'}
            </h3>
            
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                  Compte Racine SYSCOHADA * (ex: 60, 61, 62, 66, 70...)
                </label>
                <input 
                  type="text" 
                  className="input" 
                  placeholder="ex: 628 ou 66" 
                  value={form.compte_racine}
                  onChange={e => setForm({ ...form, compte_racine: e.target.value })}
                  style={{ width: '100%', fontFamily: 'monospace' }}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                  Libellé du Poste *
                </label>
                <input 
                  type="text" 
                  className="input" 
                  placeholder="ex: Frais de Déplacement & Missions" 
                  value={form.libelle}
                  onChange={e => setForm({ ...form, libelle: e.target.value })}
                  style={{ width: '100%' }}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                    Type d'Enveloppe
                  </label>
                  <select 
                    className="input" 
                    value={form.type}
                    onChange={e => setForm({ ...form, type: e.target.value })}
                    style={{ width: '100%' }}
                  >
                    <option value="charge">Charge (Plafond de dépense)</option>
                    <option value="produit">Produit (Objectif de vente/recette)</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                    Montant Alloué (FCFA) *
                  </label>
                  <input 
                    type="number" 
                    className="input" 
                    placeholder="ex: 15000000" 
                    value={form.montant_alloue}
                    onChange={e => setForm({ ...form, montant_alloue: e.target.value })}
                    style={{ width: '100%' }}
                    required
                  />
                </div>
              </div>

              {errorMsg && (
                <div style={{ padding: '0.6rem', borderRadius: 'var(--radius-sm)', background: '#fee2e2', color: '#991b1b', fontSize: '0.85rem' }}>
                  {errorMsg}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={() => setModalOpen(false)}
                >
                  Annuler
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary"
                  disabled={submitting}
                >
                  {submitting ? 'Enregistrement...' : editItem ? 'Mettre à jour' : 'Créer l\'enveloppe'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
