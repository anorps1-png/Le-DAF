import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import { BrainCircuit, Table, CheckCircle, Plus, Trash2, AlertTriangle, Pencil, X, Download, RefreshCw } from 'lucide-react';
import { getAccountLabel } from '../utils/ohadaPlan';
import { fetchDirectSupabaseJournal, fetchDirectSupabaseTiers } from '../utils/supabaseClient';
import { AccountPicker } from '../components/AccountPicker';
import { adminFetch } from '../utils/adminAuth';

export const ComptabiliteModule = ({ initialTab, initialCompte, onTabChange } = {}) => {
  const [activeTab, setActiveTab] = useState(initialTab || 'saisie');

  // Changer d'exercice comptable force un remontage complet de ce module (voir App.jsx,
  // moduleKey inclut l'exercice actif, nécessaire pour que toutes les données affichées se
  // rafraîchissent). Sans ceci, ce remontage réinitialisait aussi l'onglet actif à 'saisie',
  // faisant perdre silencieusement la vue Balance/Bilan/Résultat en cours : on répercute donc
  // chaque changement d'onglet au parent (comptaInitialTab dans App.jsx) pour que le prochain
  // remontage reparte du même onglet plutôt que du défaut.
  useEffect(() => {
    onTabChange && onTabChange(activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);
  const [glComptes, setGlComptes] = useState([]);
  const [glSelectedCompte, setGlSelectedCompte] = useState(initialCompte || '');
  const [glSelectedJournal, setGlSelectedJournal] = useState('');
  // Le Grand Livre par compte et par journal sont deux axes de consultation indépendants et
  // mutuellement exclusifs : 'compte' affiche tout le compte sélectionné (tous journaux confondus),
  // 'journal' affiche tout le journal sélectionné (tous comptes confondus). Celui qu'on vient de
  // toucher devient prioritaire — c'est l'autre sélecteur qui est alors ignoré, jamais combiné.
  const [glFilterMode, setGlFilterMode] = useState('compte');
  const [glLedger, setGlLedger] = useState(null);
  const [glJournalLedger, setGlJournalLedger] = useState(null);
  const [glLoading, setGlLoading] = useState(false);
  const [glError, setGlError] = useState('');
  // Sélection multiple pour le changement de compte en masse : indépendante du mode d'affichage
  // (compte ou journal), remise à zéro dès que le filtre ou le contenu affiché change.
  const [selectedGlIds, setSelectedGlIds] = useState([]);
  const [glRefreshTick, setGlRefreshTick] = useState(0);
  const [bulkNewCompte, setBulkNewCompte] = useState('');
  const [bulkApplying, setBulkApplying] = useState(false);
  const [bulkMsg, setBulkMsg] = useState(null);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [highlightRowId, setHighlightRowId] = useState(null);
  const [editingRowId, setEditingRowId] = useState(null);
  const [editRowForm, setEditRowForm] = useState(null);
  // Contrepartie de la ligne en cours d'édition (voir GET/PUT /api/journal/:id/contrepartie) :
  // { compte, compte_tiers, libelle, existingId } — existingId non-null si une contrepartie liée
  // (même piece_id) a été trouvée et sera modifiée plutôt que dupliquée à l'enregistrement.
  const [editContrepartie, setEditContrepartie] = useState(null);
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
  const [bilanExpandedPoste, setBilanExpandedPoste] = useState(null);
  const [balanceFilterCompte, setBalanceFilterCompte] = useState('');
  const [balanceClassFilter, setBalanceClassFilter] = useState('');
  const [balanceFilter, setBalanceFilter] = useState('');
  const [balanceDateDebut, setBalanceDateDebut] = useState('');
  const [balanceDateFin, setBalanceDateFin] = useState('');
  const [journalCodes, setJournalCodes] = useState(['AC', 'VE', 'BQ', 'OD', 'CA', 'CAISPR']);
  const [customAccounts, setCustomAccounts] = useState({});
  const [journalSearch, setJournalSearch] = useState('');
  const [journalSearchDebounced, setJournalSearchDebounced] = useState('');
  const [journalPage, setJournalPage] = useState(1);
  const [journalPageSize, setJournalPageSize] = useState(50);
  const [showAllDates, setShowAllDates] = useState(false);
  // Le Journal est paginé côté serveur (un import volumineux, ex: 367 804 lignes, rend un fetch
  // complet trop lourd quelle que soit la machine) : ces totaux portent sur l'ENSEMBLE filtré côté
  // serveur, pas seulement la page affichée dans `data`.
  const [journalTotalCount, setJournalTotalCount] = useState(0);
  const [journalTotalDebit, setJournalTotalDebit] = useState(0);
  const [journalTotalCredit, setJournalTotalCredit] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => { setJournalSearchDebounced(journalSearch); setJournalPage(1); }, 350);
    return () => clearTimeout(t);
  }, [journalSearch]);

  // --- DSF OHADA STATES ---
  const [dsfSubTab, setDsfSubTab] = useState('controls');
  const [dsfData, setDsfData] = useState(null);
  const [companyForm, setCompanyForm] = useState({});
  const [savingDsfInfo, setSavingDsfInfo] = useState(false);
  const [isSourceBusy, setIsSourceBusy] = useState(false);
  const [isRateInput, setIsRateInput] = useState('');
  const [isRateBusy, setIsRateBusy] = useState(false);
  const [isRateMsg, setIsRateMsg] = useState(null);

  // --- LETTRAGE & ADVANCED STATES ---
  const [lettrageSubTab, setLettrageSubTab] = useState('lettrage'); // 'lettrage' | 'agee'
  const [lettrageEntries, setLettrageEntries] = useState([]);
  const [selectedLettrageIds, setSelectedLettrageIds] = useState([]);
  const [lettrageAccountFilter, setLettrageAccountFilter] = useState('');
  const [lettrageMsg, setLettrageMsg] = useState(null);

  const [balanceAgeeData, setBalanceAgeeData] = useState([]);
  const [balanceAgeeType, setBalanceAgeeType] = useState('client');

  const [statementLines, setStatementLines] = useState([]);
  const [journalBankLines, setJournalBankLines] = useState([]);
  const [rapprochementMsg, setRapprochementMsg] = useState(null);

  const fetchDsfData = () => {
    fetch('/api/dsf/data')
      .then(res => res.json())
      .then(data => {
        setDsfData(data);
        if (data.companyInfo) setCompanyForm(data.companyInfo);
        if (data.tdrf && data.tdrf.isRate !== undefined) setIsRateInput(String(data.tdrf.isRate));
      })
      .catch(e => console.error(e));
  };

  const handleSaveIsRate = async () => {
    setIsRateBusy(true);
    setIsRateMsg(null);
    try {
      const res = await fetch('/api/dsf/is-rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rate: parseFloat(isRateInput) })
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Erreur lors de l'enregistrement du taux.");
      if (result.data) {
        setDsfData(result.data);
        setIsRateInput(String(result.data.tdrf.isRate));
      }
      setIsRateMsg({ type: 'success', text: 'Taux mis à jour.' });
    } catch (e) {
      setIsRateMsg({ type: 'error', text: e.message });
    } finally {
      setIsRateBusy(false);
    }
  };

  const handleToggleIsSource = async (source) => {
    setIsSourceBusy(true);
    try {
      const res = await fetch('/api/dsf/is-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source })
      });
      const { data } = await res.json();
      if (data) setDsfData(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSourceBusy(false);
    }
  };

  const fetchLettrageEntries = () => {
    let url = '/api/lettrage/non-lettres';
    if (lettrageAccountFilter) url += `?account=${encodeURIComponent(lettrageAccountFilter)}`;
    fetch(url)
      .then(res => res.json())
      .then(data => setLettrageEntries(Array.isArray(data) ? data : []))
      .catch(e => console.error(e));
  };

  const fetchBalanceAgee = () => {
    fetch(`/api/echeances/balance-agee?type=${balanceAgeeType}`)
      .then(res => res.json())
      .then(data => setBalanceAgeeData(Array.isArray(data) ? data : []))
      .catch(e => console.error(e));
  };

  const fetchRapprochement = () => {
    fetch('/api/rapprochement/etat')
      .then(res => res.json())
      .then(data => {
        setStatementLines(data.statementLines || []);
        setJournalBankLines(data.journalBankLines || []);
      })
      .catch(e => console.error(e));
  };

  useEffect(() => {
    fetch('/api/chart-of-accounts')
      .then(res => res.json())
      .then(rows => {
        const map = {};
        (rows || []).forEach(r => { map[r.compte] = r.libelle; });
        setCustomAccounts(map);
      })
      .catch(e => console.error(e));

    fetch('/api/journals-list')
      .then(res => res.json())
      .then(codes => {
        if (Array.isArray(codes) && codes.length > 0) {
          setJournalCodes(codes);
        }
      })
      .catch(e => console.error(e));

    // Chargé ici (plutôt que seulement à l'ouverture de l'onglet Grand Livre) pour que le
    // sélecteur de compte de l'édition inline du Journal dispose déjà de la liste des comptes
    // réellement utilisés, sans attendre que l'utilisateur visite un autre onglet.
    fetch('/api/grand-livre/comptes')
      .then(res => res.json())
      .then(rows => {
        if (Array.isArray(rows)) setGlComptes(rows);
      })
      .catch(e => console.error(e));

    fetchDsfData();
  }, []);

  // Liste fusionnée pour le sélecteur de compte : les comptes réellement mouvementés (glComptes,
  // les seuls qu'on retrouve vraiment dans le Journal/Grand Livre) d'abord, complétés par les
  // intitulés personnalisés (customAccounts) pour ceux qui n'ont pas encore d'écriture.
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

  const fetchEtats = async (endpoint, forceAll = showAllDates, highlightId = null) => {
    setLoading(true);
    setFetchError('');
    try {
      let url = `/api/${endpoint}`;
      if (endpoint === 'journal') {
        // Pagination côté serveur : un fetch complet non paginé (ex: 367 804 lignes observées en
        // pratique) est trop lourd pour rester réactif, quelle que soit la machine. `highlightId`
        // demande au serveur la page qui contient précisément cette écriture (saut depuis le Grand
        // Livre), sinon on pagine normalement sur journalPage/journalPageSize.
        const qp = new URLSearchParams();
        if (forceAll) qp.set('all', '1');
        if (journalSearchDebounced) qp.set('search', journalSearchDebounced);
        if (highlightId) {
          qp.set('highlightId', highlightId);
          qp.set('limit', String(journalPageSize));
        } else {
          qp.set('limit', String(journalPageSize));
          qp.set('offset', String((journalPage - 1) * journalPageSize));
        }
        url = `/api/journal?${qp.toString()}`;
      } else if (endpoint === 'balance' && balanceDateDebut && balanceDateFin) {
        const qp = new URLSearchParams();
        qp.set('dateDebut', balanceDateDebut);
        qp.set('dateFin', balanceDateFin);
        url = `/api/balance?${qp.toString()}`;
      }
      const res = await fetch(url);
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch (e) {}

      if (res.ok && json !== null) {
        setData(Array.isArray(json) ? json : (json.error ? [] : json));
        if (endpoint === 'journal') {
          setJournalTotalCount(Number(res.headers.get('X-Total-Count')) || 0);
          setJournalTotalDebit(Number(res.headers.get('X-Total-Debit')) || 0);
          setJournalTotalCredit(Number(res.headers.get('X-Total-Credit')) || 0);
          const serverOffset = Number(res.headers.get('X-Offset'));
          if (highlightId && !isNaN(serverOffset)) {
            setJournalPage(Math.floor(serverOffset / journalPageSize) + 1);
          }
        }
        setLoading(false);
        return;
      }
    } catch (err) {
      console.warn(`Fetch /api/${endpoint} failed, falling back to direct Supabase query:`, err);
    }

    // Direct Supabase Browser Query Fallback for Vercel
    try {
      if (endpoint === 'journal') {
        const directJournal = await fetchDirectSupabaseJournal();
        setData(Array.isArray(directJournal) ? directJournal : []);
        setLoading(false);
        return;
      } else if (endpoint === 'tiers') {
        const directTiers = await fetchDirectSupabaseTiers();
        setData(Array.isArray(directTiers) ? directTiers : []);
        setLoading(false);
        return;
      }
    } catch (directErr) {
      console.error("Direct Supabase query error:", directErr);
    }

    setData([]);
    setFetchError('');
    setLoading(false);
  };

  useEffect(() => {
    if (activeTab === 'journal' && !highlightRowId) fetchEtats('journal', showAllDates);
    if (activeTab === 'balance') fetchEtats('balance');
    if (activeTab === 'bilan') fetchEtats('bilan');
    if (activeTab === 'resultat') fetchEtats('resultat');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, showAllDates, journalPage, journalPageSize, journalSearchDebounced, balanceDateDebut, balanceDateFin]);

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
    if (activeTab !== 'grandlivre') return;
    setSelectedGlIds([]);
    setBulkNewCompte('');
    setBulkMsg(null);

    if (glFilterMode === 'journal') {
      if (!glSelectedJournal) return;
      setGlLoading(true);
      setGlError('');
      setGlLedger(null);
      fetch(`/api/grand-livre/par-journal/${encodeURIComponent(glSelectedJournal)}`)
        .then(res => res.json())
        .then(data => {
          if (data.error) { setGlError(data.error); setGlJournalLedger(null); }
          else setGlJournalLedger(data);
        })
        .catch(() => setGlError('Impossible de charger le Grand Livre. Vérifiez que le serveur est démarré.'))
        .finally(() => setGlLoading(false));
      return;
    }

    if (!glSelectedCompte) return;
    setGlLoading(true);
    setGlError('');
    setGlJournalLedger(null);
    fetch(`/api/grand-livre/${encodeURIComponent(glSelectedCompte)}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) { setGlError(data.error); setGlLedger(null); }
        else setGlLedger(data);
      })
      .catch(() => setGlError('Impossible de charger le Grand Livre. Vérifiez que le serveur est démarré.'))
      .finally(() => setGlLoading(false));
  }, [glFilterMode, glSelectedCompte, glSelectedJournal, activeTab, glRefreshTick]);

  const toggleGlSelected = (id) => {
    setSelectedGlIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const applyBulkCompte = async () => {
    if (!bulkNewCompte.trim() || selectedGlIds.length === 0) return;
    setBulkApplying(true);
    setBulkMsg(null);
    try {
      const res = await adminFetch('/api/journal/bulk-compte', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedGlIds, compte: bulkNewCompte.trim() })
      });
      const result = await res.json();
      if (!res.ok || result.error) {
        setBulkMsg({ type: 'error', text: result.error || 'Erreur lors du changement de compte.' });
      } else {
        setBulkMsg({ type: 'success', text: `${result.changes} écriture(s) rattachée(s) au compte ${bulkNewCompte.trim()}.` });
        setSelectedGlIds([]);
        setBulkNewCompte('');
        setGlRefreshTick(t => t + 1);
      }
    } catch (e) {
      setBulkMsg({ type: 'error', text: 'Impossible de joindre le serveur.' });
    } finally {
      setBulkApplying(false);
    }
  };

  const openGrandLivre = (compte) => {
    setGlSelectedCompte(compte);
    setGlFilterMode('compte');
    setActiveTab('grandlivre');
  };

  // Depuis le Grand Livre, ouvre l'écriture correspondante dans le Journal (mis en surbrillance
  // et scrollée en vue) où elle peut être modifiée ou supprimée.
  const openJournalEntry = (id) => {
    setEditingRowId(null);
    // Réinitialise le filtre de recherche (immédiatement, sans attendre le debounce) pour ne pas
    // risquer que la ligne ciblée soit exclue du jeu filtré côté serveur.
    setJournalSearch('');
    setJournalSearchDebounced('');
    setHighlightRowId(id);
    setActiveTab('journal');
  };

  // Saut depuis le Grand Livre vers une écriture précise : avec la pagination côté serveur, on ne
  // peut plus retrouver sa page depuis une liste déjà chargée en mémoire — on redemande directement
  // au serveur la page qui la contient (voir highlightId dans fetchEtats / X-Offset).
  useEffect(() => {
    if (activeTab === 'journal' && highlightRowId) {
      fetchEtats('journal', showAllDates, highlightRowId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, highlightRowId]);

  useEffect(() => {
    if (activeTab === 'journal' && highlightRowId && Array.isArray(data) && data.length > 0) {
      const found = data.some(r => r.id === highlightRowId || String(r.id) === String(highlightRowId));
      if (found) {
        const timer = setTimeout(() => {
          if (highlightedRowRef.current) {
            highlightedRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 150);
        return () => clearTimeout(timer);
      }
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
    setEditContrepartie({ compte: '', compte_tiers: '', libelle: '', existingId: null });
    fetch(`/api/journal/${row.id}/contrepartie`)
      .then(res => res.json())
      .then(sibling => {
        if (sibling) {
          setEditContrepartie({
            compte: sibling.compte || '',
            compte_tiers: sibling.compte_tiers || '',
            libelle: sibling.libelle || '',
            existingId: sibling.id
          });
        }
      })
      .catch(() => {});
  };

  const cancelEditRow = () => {
    setEditingRowId(null);
    setEditRowForm(null);
    setEditContrepartie(null);
  };

  const saveEditRow = async (id) => {
    if (!editRowForm.compte || !editRowForm.libelle || !editRowForm.date) {
      setRowActionStatus('Erreur : Compte, libellé et date sont obligatoires.');
      return;
    }
    try {
      const body = { ...editRowForm };
      if (editContrepartie && editContrepartie.compte.trim()) {
        body.contrepartie = {
          compte: editContrepartie.compte.trim(),
          compte_tiers: editContrepartie.compte_tiers.trim() || undefined,
          libelle: editContrepartie.libelle.trim() || undefined
        };
      }
      const res = await adminFetch(`/api/journal/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const resData = await res.json();
      if (resData.success) {
        setEditingRowId(null);
        setEditRowForm(null);
        setEditContrepartie(null);
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
      const res = await adminFetch(`/api/journal/${id}`, { method: 'DELETE' });
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
      const res = await adminFetch('/api/journal', {
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
                      {journalCodes.map(code => (
                        <option key={code} value={code}>
                          {code} - {code === 'AC' ? 'Achat' : code === 'VE' ? 'Vente' : code === 'BQ' ? 'Banque' : code === 'OD' ? 'Opérations Diverses' : code === 'CA' ? 'Caisse' : code === 'CAISPR' ? 'Caisse Principale' : `Journal ${code}`}
                        </option>
                      ))}
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
                        list="chart-of-accounts-list"
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

      case 'journal': {
        // Le Journal est désormais paginé et recherché côté serveur (voir fetchEtats) : `data` ne
        // contient que la page courante, pas l'ensemble filtré. Les totaux/équilibre portent sur
        // journalTotalCount/Debit/Credit, renvoyés par le serveur sur l'ensemble filtré.
        const paginatedJournal = Array.isArray(data) ? data : [];
        const totalPages = Math.ceil(journalTotalCount / journalPageSize) || 1;
        const safePage = Math.min(Math.max(1, journalPage), totalPages);

        const totalJournalDebit = journalTotalDebit;
        const totalJournalCredit = journalTotalCredit;
        const journalEcart = Math.round((totalJournalDebit - totalJournalCredit) * 100) / 100;
        const isJournalEquilibre = Math.abs(journalEcart) < 0.01;

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

            {/* Barre de contrôle et recherche ultra-rapide */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem',
              marginBottom: '1.25rem', padding: '1rem', background: 'var(--color-bg-light)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: '280px' }}>
                <input
                  type="text"
                  className="input"
                  style={{ width: '100%', padding: '0.5rem 0.75rem', fontSize: '0.875rem' }}
                  placeholder="🔍 Filtrer par compte, libellé, n° facture, date..."
                  value={journalSearch}
                  onChange={e => { setJournalSearch(e.target.value); setJournalPage(1); }}
                />
                {journalSearch && (
                  <button className="btn btn-secondary" style={{ padding: '0.4rem 0.6rem' }} onClick={() => setJournalSearch('')}>
                    <X size={14} />
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className={`btn ${showAllDates ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: '0.8rem', padding: '0.45rem 0.75rem' }}
                  onClick={() => setShowAllDates(!showAllDates)}
                  title="Afficher toutes les écritures sans restriction d'exercice"
                >
                  {showAllDates ? '📅 Toutes les dates' : '📅 Filtré par exercice'}
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                  <span>Afficher :</span>
                  <select
                    className="input"
                    style={{ padding: '0.35rem 0.5rem', fontSize: '0.8rem', width: '85px' }}
                    value={journalPageSize}
                    onChange={e => { setJournalPageSize(Number(e.target.value)); setJournalPage(1); }}
                  >
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={250}>250</option>
                    <option value={500}>500</option>
                    <option value={1000}>1000</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Synthèse des montants et indicateurs */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem',
              marginBottom: '1.25rem'
            }}>
              <div className="card stat-card" style={{ padding: '0.75rem 1rem' }}>
                <span className="stat-title" style={{ fontSize: '0.75rem' }}>Total Écritures</span>
                <span className="stat-value" style={{ fontSize: '1.15rem' }}>
                  {journalTotalCount.toLocaleString()}
                </span>
              </div>
              <div className="card stat-card" style={{ padding: '0.75rem 1rem' }}>
                <span className="stat-title" style={{ fontSize: '0.75rem' }}>Total Débit</span>
                <span className="stat-value" style={{ fontSize: '1.15rem', color: 'var(--color-primary)' }}>
                  {totalJournalDebit.toLocaleString()} FCFA
                </span>
              </div>
              <div className="card stat-card" style={{ padding: '0.75rem 1rem' }}>
                <span className="stat-title" style={{ fontSize: '0.75rem' }}>Total Crédit</span>
                <span className="stat-value" style={{ fontSize: '1.15rem', color: 'var(--color-primary)' }}>
                  {totalJournalCredit.toLocaleString()} FCFA
                </span>
              </div>
              <div className="card stat-card" style={{
                padding: '0.75rem 1rem',
                background: isJournalEquilibre ? 'rgba(34, 197, 94, 0.05)' : 'rgba(239, 68, 68, 0.05)'
              }}>
                <span className="stat-title" style={{ fontSize: '0.75rem' }}>Équilibre Débit / Crédit</span>
                <span className="stat-value" style={{
                  fontSize: '1.15rem',
                  color: isJournalEquilibre ? 'var(--color-success)' : 'var(--color-error)'
                }}>
                  {isJournalEquilibre ? '✓ Équilibré' : `Écart : ${journalEcart.toLocaleString()} FCFA`}
                </span>
              </div>
            </div>

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
                  {paginatedJournal.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-text-muted)' }}>
                        {loading ? 'Chargement des écritures...' : 'Aucune écriture comptable trouvée.'}
                      </td>
                    </tr>
                  ) : (
                    paginatedJournal.map((row, idx) => {
                      const isEditing = editingRowId === row.id;
                      const isHighlighted = highlightRowId === row.id || String(highlightRowId) === String(row.id);
                      return (
                        <Fragment key={row.id || idx}>
                        <tr
                          ref={isHighlighted ? highlightedRowRef : null}
                          style={{
                            borderBottom: '1px solid rgba(0,0,0,0.05)',
                            background: isEditing ? 'rgba(59,130,246,0.08)' : isHighlighted ? '#fef3c7' : 'transparent',
                            boxShadow: isHighlighted ? '0 0 0 2px #d97706 inset' : 'none',
                            transition: 'all 0.3s ease'
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
                                <AccountPicker
                                  value={editRowForm.compte}
                                  onChange={v => setEditRowForm({ ...editRowForm, compte: v })}
                                  accounts={accountOptions}
                                  style={{ width: '110px' }}
                                />
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
                              <td>{row.debit > 0 ? Number(row.debit).toLocaleString() : '-'}</td>
                              <td>{row.credit > 0 ? Number(row.credit).toLocaleString() : '-'}</td>
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
                        {isEditing && editContrepartie && (
                          <tr style={{ background: 'rgba(59,130,246,0.04)', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                            <td colSpan={10} style={{ padding: '0.5rem 0.5rem 0.75rem 1.5rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.8rem' }}>
                                <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>
                                  ↳ Contrepartie {editContrepartie.existingId ? '(déjà liée)' : '(optionnel — laisser vide pour ne rien changer)'} :
                                </span>
                                <AccountPicker
                                  value={editContrepartie.compte}
                                  onChange={v => setEditContrepartie({ ...editContrepartie, compte: v })}
                                  accounts={accountOptions}
                                  style={{ width: '140px' }}
                                  placeholder="Compte contrepartie"
                                />
                                <input
                                  className="input"
                                  style={{ padding: '0.35rem', width: '140px' }}
                                  placeholder="Tiers (optionnel)"
                                  value={editContrepartie.compte_tiers}
                                  onChange={e => setEditContrepartie({ ...editContrepartie, compte_tiers: e.target.value })}
                                />
                                <input
                                  className="input"
                                  style={{ padding: '0.35rem', width: '200px' }}
                                  placeholder="Libellé (optionnel)"
                                  value={editContrepartie.libelle}
                                  onChange={e => setEditContrepartie({ ...editContrepartie, libelle: e.target.value })}
                                />
                              </div>
                            </td>
                          </tr>
                        )}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem',
                marginTop: '1.5rem', padding: '0.75rem 0'
              }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                  Page {safePage} sur {totalPages} ({journalTotalCount.toLocaleString()} écritures)
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem' }}
                    disabled={safePage <= 1}
                    onClick={() => setJournalPage(p => Math.max(1, p - 1))}
                  >
                    ← Précédent
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem' }}
                    disabled={safePage >= totalPages}
                    onClick={() => setJournalPage(p => Math.min(totalPages, p + 1))}
                  >
                    Suivant →
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      }

      case 'grandlivre': {
        const compteActif = glFilterMode === 'compte';
        const activeLabelStyle = { display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-primary)' };
        const inactiveLabelStyle = { display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', fontWeight: 500, color: 'var(--color-text-muted)' };

        return (
          <div>
            {/* Les deux filtres sont indépendants et mutuellement exclusifs : celui qu'on vient de
                changer devient prioritaire et affiche l'intégralité de sa sélection (tout le compte,
                ou tout le journal), l'autre sélecteur reste visible mais n'est pas appliqué. */}
            <div style={{ marginBottom: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <div style={{ maxWidth: '480px', flex: '1 1 320px' }}>
                <label style={compteActif ? activeLabelStyle : inactiveLabelStyle}>
                  Compte {compteActif ? '— filtre actif' : '(ignoré tant que le journal est prioritaire)'}
                </label>
                <select
                  className="input"
                  style={{ padding: '0.5rem', width: '100%', opacity: compteActif ? 1 : 0.55 }}
                  value={glSelectedCompte}
                  onChange={e => { setGlSelectedCompte(e.target.value); setGlFilterMode('compte'); }}
                >
                  {glComptes.length === 0 && <option value="">Aucun compte avec écritures</option>}
                  {glComptes.map(c => (
                    <option key={c.compte} value={c.compte}>
                      {c.compte} - {getAccountLabel(c.compte, customAccounts)}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ maxWidth: '220px', flex: '1 1 160px' }}>
                <label style={!compteActif ? activeLabelStyle : inactiveLabelStyle}>
                  Journal {!compteActif ? '— filtre actif' : '(ignoré tant que le compte est prioritaire)'}
                </label>
                <select
                  className="input"
                  style={{ padding: '0.5rem', width: '100%', opacity: compteActif ? 0.55 : 1 }}
                  value={glSelectedJournal}
                  onChange={e => {
                    setGlSelectedJournal(e.target.value);
                    setGlFilterMode(e.target.value ? 'journal' : 'compte');
                  }}
                  title="Afficher toutes les écritures de ce journal, tous comptes confondus"
                >
                  <option value="">Tous les journaux</option>
                  {journalCodes.map(code => (
                    <option key={code} value={code}>{code}</option>
                  ))}
                </select>
              </div>
            </div>

            {selectedGlIds.length > 0 && (
              <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: 'rgba(59, 130, 246, 0.08)', border: '1px solid var(--color-primary)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '0.85rem' }}>{selectedGlIds.length} écriture(s) sélectionnée(s)</strong>
                <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>Rattacher au compte :</span>
                <AccountPicker
                  value={bulkNewCompte}
                  onChange={setBulkNewCompte}
                  accounts={accountOptions}
                  style={{ width: '220px' }}
                />
                <button
                  className="btn btn-primary"
                  disabled={!bulkNewCompte.trim() || bulkApplying}
                  onClick={applyBulkCompte}
                  style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                >
                  {bulkApplying ? 'Application...' : `Appliquer à ${selectedGlIds.length} écriture(s)`}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => { setSelectedGlIds([]); setBulkNewCompte(''); }}
                  style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                >
                  Annuler la sélection
                </button>
              </div>
            )}

            {bulkMsg && (
              <div style={{ marginBottom: '1rem', padding: '0.6rem 1rem', borderRadius: 'var(--radius-md)', fontSize: '0.85rem', background: bulkMsg.type === 'error' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)', color: bulkMsg.type === 'error' ? '#b91c1c' : '#047857' }}>
                {bulkMsg.text}
              </div>
            )}

            {glLoading && <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>Chargement du Grand Livre...</div>}

            {glError && (
              <div style={{ padding: '1.5rem', textAlign: 'center', background: 'rgba(239, 68, 68, 0.1)', color: '#b91c1c', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                <AlertTriangle size={28} />
                {glError}
              </div>
            )}

            {!glLoading && !glError && compteActif && glLedger && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '900px', fontSize: '0.875rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                      <th style={{ padding: '0.75rem 0.5rem 0.75rem 0', width: '2rem' }}>
                        <input
                          type="checkbox"
                          checked={glLedger.lignes.length > 0 && selectedGlIds.length === glLedger.lignes.length}
                          onChange={e => setSelectedGlIds(e.target.checked ? glLedger.lignes.map(l => l.id) : [])}
                        />
                      </th>
                      <th style={{ padding: '0.75rem 0.5rem' }}>Date</th>
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
                    {!!glLedger.solde_ouverture && (
                      <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'rgba(0,0,0,0.02)', fontStyle: 'italic', color: 'var(--color-text-muted)' }}>
                        <td colSpan="9" style={{ padding: '0.5rem' }}>Solde d'ouverture (reporté des exercices antérieurs)</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 500 }}>{glLedger.solde_ouverture.toLocaleString()}</td>
                      </tr>
                    )}
                    {glLedger.lignes.length === 0 ? (
                      <tr>
                        <td colSpan="10" style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
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
                        <td style={{ padding: '0.5rem' }} onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={selectedGlIds.includes(l.id)} onChange={() => toggleGlSelected(l.id)} />
                        </td>
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
                        <td colSpan="9" style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Solde final</td>
                        <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{glLedger.solde_final.toLocaleString()}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}

            {!glLoading && !glError && !compteActif && glJournalLedger && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '900px', fontSize: '0.875rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                      <th style={{ padding: '0.75rem 0.5rem 0.75rem 0', width: '2rem' }}>
                        <input
                          type="checkbox"
                          checked={glJournalLedger.lignes.length > 0 && selectedGlIds.length === glJournalLedger.lignes.length}
                          onChange={e => setSelectedGlIds(e.target.checked ? glJournalLedger.lignes.map(l => l.id) : [])}
                        />
                      </th>
                      <th style={{ padding: '0.75rem 0.5rem' }}>Date</th>
                      <th style={{ padding: '0.75rem 0.5rem' }}>Compte</th>
                      <th style={{ padding: '0.75rem 0.5rem' }}>N° Facture</th>
                      <th style={{ padding: '0.75rem 0.5rem' }}>Référence</th>
                      <th style={{ padding: '0.75rem 0.5rem' }}>Libellé</th>
                      <th style={{ padding: '0.75rem 0.5rem' }}>Tiers</th>
                      <th style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Débit</th>
                      <th style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Crédit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {glJournalLedger.lignes.length === 0 ? (
                      <tr>
                        <td colSpan="9" style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                          Aucune écriture pour ce journal sur la période sélectionnée.
                        </td>
                      </tr>
                    ) : glJournalLedger.lignes.map(l => (
                      <tr
                        key={l.id}
                        onClick={() => openJournalEntry(l.id)}
                        title="Voir/modifier cette écriture dans le Journal"
                        style={{ borderBottom: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,0.03)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <td style={{ padding: '0.5rem' }} onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={selectedGlIds.includes(l.id)} onChange={() => toggleGlSelected(l.id)} />
                        </td>
                        <td style={{ padding: '0.5rem 0.5rem 0.5rem 0' }}>{l.date}</td>
                        <td style={{ padding: '0.5rem' }}>{l.compte} - {getAccountLabel(l.compte, customAccounts)}</td>
                        <td style={{ padding: '0.5rem' }}>{l.n_facture}</td>
                        <td style={{ padding: '0.5rem' }}>{l.reference}</td>
                        <td style={{ padding: '0.5rem' }}>{l.libelle}</td>
                        <td style={{ padding: '0.5rem' }}>{l.compte_tiers}</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right' }}>{l.debit > 0 ? l.debit.toLocaleString() : ''}</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right' }}>{l.credit > 0 ? l.credit.toLocaleString() : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                  {glJournalLedger.lignes.length > 0 && (
                    <tfoot>
                      <tr style={{ borderTop: '2px solid var(--color-border)', fontWeight: 'bold' }}>
                        <td colSpan="7" style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Totaux</td>
                        <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{glJournalLedger.total_debit.toLocaleString()}</td>
                        <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{glJournalLedger.total_credit.toLocaleString()}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </div>
        );
      }

      case 'balance': {
        const getOhadaTitle = (compteStr) => {
          return getAccountLabel(compteStr, customAccounts);
        };

        const searchCompte = balanceFilterCompte.trim().toLowerCase();
        const rawRows = Array.isArray(data) ? data : [];
        const filteredRows = rawRows.filter(row => {
          const compteStr = String(row.compte || '');
          const label = getOhadaTitle(compteStr).toLowerCase();
          
          const matchSearch = !searchCompte || compteStr.startsWith(searchCompte) || compteStr.includes(searchCompte) || label.includes(searchCompte);
          const matchClass = !balanceClassFilter || compteStr.startsWith(balanceClassFilter);

          return matchSearch && matchClass;
        });

        const groups = {};
        let bilan_anterieur = 0, bilan_debit = 0, bilan_credit = 0;
        let gestion_anterieur = 0, gestion_debit = 0, gestion_credit = 0;
        let grand_anterieur = 0, grand_debit = 0, grand_credit = 0;
        filteredRows.forEach(row => {
          const compteStr = String(row.compte);
          const root = compteStr.substring(0, 2);
          if (!groups[root]) {
            groups[root] = { rows: [], t_anterieur: 0, t_debit: 0, t_credit: 0 };
          }
          groups[root].rows.push(row);
          groups[root].t_anterieur += (row.solde_anterieur || 0);
          groups[root].t_debit += (row.total_debit || 0);
          groups[root].t_credit += (row.total_credit || 0);

          const rootClass = parseInt(compteStr.substring(0, 1), 10);
          if (rootClass >= 1 && rootClass <= 5) {
            bilan_anterieur += (row.solde_anterieur || 0);
            bilan_debit += (row.total_debit || 0);
            bilan_credit += (row.total_credit || 0);
          } else if (rootClass >= 6 && rootClass <= 9) {
            gestion_anterieur += (row.solde_anterieur || 0);
            gestion_debit += (row.total_debit || 0);
            gestion_credit += (row.total_credit || 0);
          }
          grand_anterieur += (row.solde_anterieur || 0);
          grand_debit += (row.total_debit || 0);
          grand_credit += (row.total_credit || 0);
        });

        return (
          <div style={{ overflowX: 'auto', background: 'white', padding: '1rem', borderRadius: 'var(--radius-md)' }}>
            <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
              <h2 style={{ margin: 0, color: 'var(--color-text-main)' }}>Balance des comptes</h2>
              <p style={{ margin: '0.25rem 0', color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>Complète - Format Sage 100 SYSCOHADA</p>
            </div>

            {/* BARRE DE FILTRAGE DE LA BALANCE PAR NUMÉRO DE COMPTE & CLASSE */}
            <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem', border: '1px solid var(--color-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 300px', display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--color-text-muted)' }}>
                      📅 Date début
                    </label>
                    <input
                      type="date"
                      className="input"
                      value={balanceDateDebut}
                      onChange={e => setBalanceDateDebut(e.target.value)}
                      style={{ padding: '0.5rem' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--color-text-muted)' }}>
                      📅 Date fin
                    </label>
                    <input
                      type="date"
                      className="input"
                      value={balanceDateFin}
                      onChange={e => setBalanceDateFin(e.target.value)}
                      style={{ padding: '0.5rem' }}
                    />
                  </div>
                  {(balanceDateDebut || balanceDateFin) && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => { setBalanceDateDebut(''); setBalanceDateFin(''); }}
                      title="Revenir à l'exercice ouvert"
                      style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem' }}
                    >
                      <X size={14} /> Réinitialiser
                    </button>
                  )}
                </div>

                <div style={{ flex: '1 1 260px', position: 'relative' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--color-text-muted)' }}>
                    🔍 Filtrer par N° de compte ou libellé :
                  </label>
                  <input
                    type="text"
                    className="input"
                    placeholder="Ex: 401, 571, 604, Fournisseur..."
                    value={balanceFilterCompte}
                    onChange={e => setBalanceFilterCompte(e.target.value)}
                    style={{ paddingRight: '2rem', width: '100%' }}
                  />
                  {balanceFilterCompte && (
                    <button
                      onClick={() => setBalanceFilterCompte('')}
                      style={{ position: 'absolute', right: '0.5rem', top: '1.85rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)', width: '100%', marginBottom: '0.25rem' }}>
                    Filtrer par classe :
                  </span>
                  {[
                    { id: '', label: 'Toutes' },
                    { id: '1', label: 'Cl. 1 Capitaux' },
                    { id: '2', label: 'Cl. 2 Immos' },
                    { id: '3', label: 'Cl. 3 Stocks' },
                    { id: '4', label: 'Cl. 4 Tiers' },
                    { id: '5', label: 'Cl. 5 Trésorerie' },
                    { id: '6', label: 'Cl. 6 Charges' },
                    { id: '7', label: 'Cl. 7 Produits' },
                  ].map(c => (
                    <button
                      key={c.id}
                      onClick={() => setBalanceClassFilter(c.id)}
                      className={`btn ${balanceClassFilter === c.id ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem', borderRadius: '12px' }}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {(balanceFilterCompte || balanceClassFilter) && (
                <div style={{ marginTop: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid var(--color-border)', fontSize: '0.8rem', color: 'var(--color-primary)', fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>Résultats : <strong>{filteredRows.length}</strong> compte(s) affiché(s) sur {rawRows.length}</span>
                  <button
                    onClick={() => { setBalanceFilterCompte(''); setBalanceClassFilter(''); }}
                    style={{ background: 'none', border: 'none', color: 'var(--color-error)', cursor: 'pointer', textDecoration: 'underline', fontSize: '0.8rem' }}
                  >
                    Effacer tous les filtres
                  </button>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem' }}>
              <div style={{ maxWidth: '320px', width: '100%' }}>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.8rem', fontWeight: 500, color: 'var(--color-text-muted)' }}>
                  Filtrer par n° de compte (préfixe)
                </label>
                <input
                  type="text"
                  className="input"
                  style={{ padding: '0.5rem' }}
                  placeholder="Ex : 601 ou 41"
                  value={balanceFilter}
                  onChange={e => setBalanceFilter(e.target.value)}
                  list="chart-of-accounts-list"
                />
              </div>
            </div>
            {balanceFilter && filteredRows.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                Aucun compte ne commence par « {balanceFilter} ».
              </div>
            ) : (
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
                  const subSoldeCumule = group.t_anterieur + (group.t_debit - group.t_credit);
                  return (
                    <Fragment key={root}>
                      {group.rows.map((row, idx) => {
                        const soldeCumule = (row.solde_anterieur || 0) + ((row.total_debit || 0) - (row.total_credit || 0));
                        return (
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
                            <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{row.solde_anterieur > 0 ? row.solde_anterieur.toLocaleString() : ''}</td>
                            <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{row.solde_anterieur < 0 ? Math.abs(row.solde_anterieur).toLocaleString() : ''}</td>
                            <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', borderLeft: '1px solid rgba(0,0,0,0.05)' }}>{row.total_debit > 0 ? row.total_debit.toLocaleString() : ''}</td>
                            <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', borderRight: '1px solid rgba(0,0,0,0.05)' }}>{row.total_credit > 0 ? row.total_credit.toLocaleString() : ''}</td>
                            <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{soldeCumule > 0 ? soldeCumule.toLocaleString() : ''}</td>
                            <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{soldeCumule < 0 ? Math.abs(soldeCumule).toLocaleString() : ''}</td>
                          </tr>
                        );
                      })}
                      <tr style={{ backgroundColor: '#f8fafc', fontWeight: 'bold' }}>
                        <td style={{ padding: '0.4rem 0.5rem' }}>{root}</td>
                        <td style={{ padding: '0.4rem 0.5rem' }}>***SOUS-TOTAL {getOhadaTitle(root)}</td>
                        <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{group.t_anterieur > 0 ? group.t_anterieur.toLocaleString() : ''}</td>
                        <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{group.t_anterieur < 0 ? Math.abs(group.t_anterieur).toLocaleString() : ''}</td>
                        <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{group.t_debit > 0 ? group.t_debit.toLocaleString() : ''}</td>
                        <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{group.t_credit > 0 ? group.t_credit.toLocaleString() : ''}</td>
                        <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{subSoldeCumule > 0 ? subSoldeCumule.toLocaleString() : ''}</td>
                        <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{subSoldeCumule < 0 ? Math.abs(subSoldeCumule).toLocaleString() : ''}</td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                {(() => {
                   const bs = bilan_anterieur + (bilan_debit - bilan_credit);
                   const gs = gestion_anterieur + (gestion_debit - gestion_credit);
                   const gs_tot = grand_anterieur + (grand_debit - grand_credit);
                   return (
                     <>
                        <tr style={{ borderTop: '2px solid var(--color-border)', fontWeight: 'bold' }}>
                          <td colSpan="2" style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Totaux comptes de bilan</td>
                          <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{bilan_anterieur > 0 ? bilan_anterieur.toLocaleString() : ''}</td>
                          <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{bilan_anterieur < 0 ? Math.abs(bilan_anterieur).toLocaleString() : ''}</td>
                          <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{bilan_debit > 0 ? bilan_debit.toLocaleString() : ''}</td>
                          <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{bilan_credit > 0 ? bilan_credit.toLocaleString() : ''}</td>
                          <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{bs > 0 ? bs.toLocaleString() : ''}</td>
                          <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{bs < 0 ? Math.abs(bs).toLocaleString() : ''}</td>
                        </tr>
                        <tr style={{ fontWeight: 'bold' }}>
                          <td colSpan="2" style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Totaux comptes de gestion</td>
                          <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{gestion_anterieur > 0 ? gestion_anterieur.toLocaleString() : ''}</td>
                          <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{gestion_anterieur < 0 ? Math.abs(gestion_anterieur).toLocaleString() : ''}</td>
                          <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{gestion_debit > 0 ? gestion_debit.toLocaleString() : ''}</td>
                          <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{gestion_credit > 0 ? gestion_credit.toLocaleString() : ''}</td>
                          <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{gs > 0 ? gs.toLocaleString() : ''}</td>
                          <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{gs < 0 ? Math.abs(gs).toLocaleString() : ''}</td>
                        </tr>
                        <tr style={{ borderTop: '2px solid var(--color-border)', borderBottom: '2px solid var(--color-border)', fontWeight: 'bold', backgroundColor: '#f1f5f9' }}>
                          <td colSpan="2" style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Totaux de la balance</td>
                          <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{grand_anterieur > 0 ? grand_anterieur.toLocaleString() : ''}</td>
                          <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{grand_anterieur < 0 ? Math.abs(grand_anterieur).toLocaleString() : ''}</td>
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
            )}
          </div>
        );
      }

      case 'bilan': {
        // Structure conforme au Guide d'application SYSCOHADA (voir server/ohadaRules.js) :
        // immobilisations nettes des amortissements ET des dépréciations, capitaux propres
        // distincts des dettes financières (16-18) et des provisions pour risques (19).
        const a = data?.actif || {};
        const p = data?.passif || {};
        const immoIncorp = a.immobilisationsIncorporelles || {};
        const immoCorp = a.immobilisationsCorporelles || {};
        const immoFin = a.immobilisationsFinancieres || {};
        const stocks = a.stocks || {};
        const creances = a.creancesClients || {};

        const details = data?.details || {};

        const actifRows = [
          { label: 'Immobilisations incorporelles (brut)', value: immoIncorp.brut || 0, posteKey: 'immobilisationsIncorporelles' },
          { label: 'Immobilisations corporelles (brut)', value: immoCorp.brut || 0, posteKey: 'immobilisationsCorporelles' },
          { label: 'Immobilisations financières (brut)', value: immoFin.brut || 0, posteKey: 'immobilisationsFinancieres' },
          { label: 'Amortissements', value: -((immoCorp.amortissements || 0)), negative: true, posteKey: 'immobilisationsCorporelles' },
          { label: 'Dépréciations sur immobilisations', value: -((immoIncorp.depreciations || 0) + (immoCorp.depreciations || 0) + (immoFin.depreciations || 0)), negative: true, posteKey: 'immobilisationsCorporelles' },
          { label: 'Immobilisations nettes', value: a.totalImmobilisationsNettes || 0, subtotal: true },
          { label: 'Stocks (brut)', value: stocks.brut || 0, posteKey: 'stocks' },
          { label: 'Dépréciations sur stocks', value: -(stocks.depreciations || 0), negative: true, posteKey: 'stocks' },
          { label: 'Créances clients (brut)', value: creances.brut || 0, posteKey: 'creancesClients' },
          { label: 'Dépréciations sur créances', value: -(creances.depreciations || 0), negative: true, posteKey: 'creancesClients' },
          { label: 'Autres créances', value: a.autresCreances || 0, posteKey: 'autresCreances' },
          { label: 'Total actif circulant', value: a.totalActifCirculant || 0, subtotal: true },
          { label: 'Trésorerie', value: a.tresorerieActif || 0, posteKey: 'tresorerieActif' },
          ...(a.ecartConversionActif ? [{ label: 'Écart de conversion actif', value: a.ecartConversionActif, posteKey: 'ecartConversionActif' }] : []),
        ];
        const passifRows = [
          { label: 'Capital', value: p.capital || 0, posteKey: 'capital' },
          { label: 'Réserves', value: p.reserves || 0, posteKey: 'reserves' },
          { label: 'Report à nouveau', value: p.reportANouveau || 0, posteKey: 'reportANouveau' },
          { label: "Résultat net de l'exercice", value: p.resultatNetExercice || 0, posteKey: 'resultatNetExercice' },
          { label: "Subventions d'investissement", value: p.subventionsInvestissement || 0, posteKey: 'subventionsInvestissement' },
          { label: 'Provisions réglementées', value: p.provisionsReglementees || 0, posteKey: 'provisionsReglementees' },
          { label: 'Total capitaux propres', value: p.totalCapitauxPropres || 0, subtotal: true },
          { label: 'Dettes financières', value: p.dettesFinancieres || 0, posteKey: 'dettesFinancieres' },
          { label: 'Provisions pour risques et charges', value: p.provisionsRisquesCharges || 0, posteKey: 'provisionsRisquesCharges' },
          { label: 'Total ressources stables', value: p.totalRessourcesStables || 0, subtotal: true },
          { label: 'Dettes fournisseurs', value: p.dettesFournisseurs || 0, posteKey: 'dettesFournisseurs' },
          { label: 'Autres dettes', value: p.autresDettes || 0, posteKey: 'autresDettes' },
          { label: 'Total passif circulant', value: p.totalPassifCirculant || 0, subtotal: true },
          { label: 'Trésorerie passif', value: p.tresoreriePassif || 0, posteKey: 'tresoreriePassif' },
          ...(p.ecartConversionPassif ? [{ label: 'Écart de conversion passif', value: p.ecartConversionPassif, posteKey: 'ecartConversionPassif' }] : []),
        ];
        const totalActif = a.totalActif || 0;
        const totalPassif = p.totalPassif || 0;
        const equilibre = Math.abs(totalActif - totalPassif) < 1;
        const nonClasses = data?.comptesNonClasses || [];

        const renderRow = (row, idx) => {
          const clickable = !row.subtotal && !!row.posteKey;
          const comptes = clickable ? (details[row.posteKey] || []) : [];
          const isExpanded = clickable && bilanExpandedPoste === row.posteKey;
          return (
            <Fragment key={idx}>
              <tr
                onClick={clickable ? () => setBilanExpandedPoste(isExpanded ? null : row.posteKey) : undefined}
                style={{
                  ...(row.subtotal
                    ? { borderTop: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)', fontWeight: 600, background: 'rgba(0,0,0,0.02)' }
                    : { borderBottom: '1px solid rgba(0,0,0,0.05)' }),
                  cursor: clickable ? 'pointer' : 'default',
                  background: isExpanded ? 'rgba(99, 102, 241, 0.08)' : (row.subtotal ? 'rgba(0,0,0,0.02)' : undefined),
                }}
                title={clickable ? 'Cliquer pour voir le détail des comptes' : undefined}
              >
                <td style={{ padding: '0.6rem 0', paddingLeft: row.subtotal ? 0 : '0.5rem', color: row.negative ? 'var(--color-text-muted)' : 'inherit' }}>
                  {clickable && <span style={{ display: 'inline-block', width: '1rem', color: 'var(--color-text-muted)' }}>{isExpanded ? '▾' : '▸'}</span>}
                  {row.label}
                </td>
                <td style={{ textAlign: 'right', color: row.negative ? 'var(--color-text-muted)' : 'inherit' }}>{row.value.toLocaleString()} FCFA</td>
              </tr>
              {isExpanded && (
                comptes.length > 0 ? comptes.map((c, ci) => (
                  <tr
                    key={`${idx}-${ci}`}
                    onClick={() => openGrandLivre(c.compte)}
                    style={{ background: 'rgba(0,0,0,0.015)', cursor: 'pointer', fontSize: '0.82rem' }}
                    title="Ouvrir le Grand Livre de ce compte"
                  >
                    <td style={{ padding: '0.35rem 0 0.35rem 2.25rem', color: 'var(--color-text-muted)' }}>
                      {c.compte} — {getAccountLabel(c.compte)}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--color-text-muted)' }}>
                      {(c.debit || 0).toLocaleString()} / {(c.credit || 0).toLocaleString()} FCFA
                    </td>
                  </tr>
                )) : (
                  <tr key={`${idx}-empty`}>
                    <td colSpan={2} style={{ padding: '0.35rem 0 0.35rem 2.25rem', color: 'var(--color-text-muted)', fontSize: '0.82rem', fontStyle: 'italic' }}>
                      Aucun compte détaillé pour ce poste.
                    </td>
                  </tr>
                )
              )}
            </Fragment>
          );
        };

        return (
          <div>
            <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '320px' }}>
                <h4 style={{ marginBottom: '1rem', color: 'var(--color-primary)' }}>ACTIF (Emplois)</h4>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                  <tbody>
                    {actifRows.map(renderRow)}
                    <tr style={{ fontWeight: 'bold', borderTop: '2px solid var(--color-border)' }}>
                      <td style={{ padding: '1rem 0' }}>TOTAL ACTIF</td>
                      <td style={{ textAlign: 'right' }}>{totalActif.toLocaleString()} FCFA</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div style={{ flex: 1, minWidth: '320px' }}>
                <h4 style={{ marginBottom: '1rem', color: 'var(--color-primary-dark)' }}>PASSIF (Ressources)</h4>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                  <tbody>
                    {passifRows.map(renderRow)}
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
            {nonClasses.length > 0 && (
              <div style={{ marginTop: '0.75rem', padding: '0.75rem', borderRadius: 'var(--radius-md)', background: 'rgba(245, 158, 11, 0.1)', color: '#92400e', fontSize: '0.85rem' }}>
                {nonClasses.length} compte(s) non reconnu(s) par le plan comptable SYSCOHADA, donc absent(s) du bilan ci-dessus : {nonClasses.join(', ')}
              </div>
            )}
          </div>
        );
      }

      case 'resultat': {
        // Cascade conforme au Guide d'application SYSCOHADA, Partie 3 §3.2 (voir server/ohadaRules.js) :
        // marge commerciale -> CA -> valeur ajoutée -> EBE -> résultat d'exploitation -> résultat
        // financier -> résultat des activités ordinaires -> résultat H.A.O. -> résultat net (après
        // participation des travailleurs et impôts sur le résultat, comptes 87 et 89).
        const r = data || {};
        const rows = [
          { label: 'Marge commerciale', value: r.margeCommerciale || 0, strong: true },
          { label: "Chiffre d'affaires", value: r.chiffreAffaires || 0 },
          { label: "Autres produits d'exploitation", value: r.autresProduitsExploitation || 0 },
          { label: 'Achats consommés', value: -(r.achatsConsommes || 0) },
          { label: 'Consommations externes', value: -(r.consommationsExternes || 0) },
          { label: 'Valeur ajoutée', value: r.valeurAjoutee || 0, strong: true },
          { label: 'Charges de personnel', value: -(r.chargesPersonnel || 0) },
          { label: "Excédent brut d'exploitation (EBE)", value: r.excedentBrutExploitation || 0, strong: true },
          { label: "Dotations d'exploitation (amortissements, dépréciations)", value: -(r.dotationsExploitation || 0) },
          { label: "Reprises d'exploitation", value: r.reprisesExploitation || 0 },
          { label: "Résultat d'exploitation", value: r.resultatExploitation || 0, strong: true },
          { label: 'Produits financiers', value: r.produitsFinanciers || 0 },
          { label: 'Charges financières', value: -(r.chargesFinancieres || 0) },
          { label: 'Résultat financier', value: r.resultatFinancier || 0, strong: true },
          { label: 'Résultat des activités ordinaires', value: r.resultatActivitesOrdinaires || 0, strong: true },
          ...(r.produitsHAO || r.chargesHAO ? [
            { label: 'Produits H.A.O.', value: r.produitsHAO || 0 },
            { label: 'Charges H.A.O.', value: -(r.chargesHAO || 0) },
            { label: 'Résultat H.A.O.', value: r.resultatHAO || 0, strong: true },
          ] : []),
          ...(r.participationTravailleurs ? [{ label: 'Participation des travailleurs', value: -(r.participationTravailleurs || 0) }] : []),
          { label: 'Impôts sur le résultat', value: -(r.impotsResultat || 0) },
        ];
        const resultatNet = r.resultatNet || 0;
        const nonClasses = r.comptesNonClasses || [];

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
            {nonClasses.length > 0 && (
              <div style={{ marginTop: '0.75rem', padding: '0.75rem', borderRadius: 'var(--radius-md)', background: 'rgba(245, 158, 11, 0.1)', color: '#92400e', fontSize: '0.85rem' }}>
                {nonClasses.length} compte(s) non reconnu(s) par le plan comptable SYSCOHADA, donc absent(s) du résultat ci-dessus : {nonClasses.join(', ')}
              </div>
            )}
          </div>
        );
      }

      case 'dsf': {
        const handleSaveCompanyInfo = async (e) => {
          e.preventDefault();
          setSavingDsfInfo(true);
          try {
            await fetch('/api/dsf/info', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(companyForm)
            });
            fetchDsfData();
          } catch (err) {
            console.error(err);
          } finally {
            setSavingDsfInfo(false);
          }
        };

        const tdrf = dsfData?.tdrf || {};
        const tft = dsfData?.tft || {};
        const controls = dsfData?.controls || [];

        return (
          <div style={{ background: 'white', padding: '1.25rem', borderRadius: 'var(--radius-md)' }}>
            {/* Header DSF */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '1rem' }}>
              <div>
                <h2 style={{ margin: 0, color: 'var(--color-primary-dark)', fontSize: '1.25rem', fontWeight: 700 }}>
                  Déclaration Statistique et Fiscale (DSF SYSCOHADA)
                </h2>
                <p style={{ margin: '0.25rem 0 0 0', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                  Conforme au SYSCOHADA Révisé 2017 & Décret N°2019/262 Cameroun (Plateforme HARMONY/FISCALIS DGI)
                </p>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <a
                  href="/api/export/dsf?format=excel"
                  className="btn btn-primary"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)', borderColor: '#15803d', textDecoration: 'none', color: '#fff', fontSize: '0.85rem', fontWeight: 600 }}
                >
                  <Download size={16} /> 📦 Exporter DSF Officielle DGI (.xlsx)
                </a>
                <a
                  href="/api/export/dsf?format=pdf"
                  className="btn btn-primary"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)', borderColor: '#b91c1c', textDecoration: 'none', color: '#fff', fontSize: '0.85rem', fontWeight: 600 }}
                >
                  <Download size={16} /> 📄 Exporter Dossier DSF (.pdf)
                </a>
              </div>
            </div>

            {/* Sub-tabs nav DSF */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', overflowX: 'auto', background: '#f8fafc', padding: '0.4rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
              <button className={`btn ${dsfSubTab === 'controls' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setDsfSubTab('controls')} style={{ fontSize: '0.8rem' }}>
                ✅ Contrôles & Cohérence ({controls.filter(c => c.status === 'VALIDE').length}/{controls.length})
              </button>
              <button className={`btn ${dsfSubTab === 'info' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setDsfSubTab('info')} style={{ fontSize: '0.8rem' }}>
                📋 En-tête & Renseignements R1/R2/R3
              </button>
              <button className={`btn ${dsfSubTab === 'tdrf' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setDsfSubTab('tdrf')} style={{ fontSize: '0.8rem' }}>
                ⚖️ TDRF & Calcul de l'IS ({tdrf.isRate || 27.5}%)
              </button>
              <button className={`btn ${dsfSubTab === 'tft' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setDsfSubTab('tft')} style={{ fontSize: '0.8rem' }}>
                🌊 Flux de Trésorerie (TFT)
              </button>
            </div>

            {/* Sub-tab 1: CONTRÔLES BLOQUANTS */}
            {dsfSubTab === 'controls' && (
              <div>
                <h4 style={{ marginBottom: '1rem', color: 'var(--color-text-main)' }}>Contrôles d'Équilibre et de Cohérence Inter-États (Bloquants DGI)</h4>
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  {controls.map(c => (
                    <div key={c.id} style={{ padding: '1rem', borderRadius: 'var(--radius-md)', background: c.status === 'VALIDE' ? '#f0fdf4' : c.status === 'ERREUR' ? '#fef2f2' : '#fffbe5', border: `1px solid ${c.status === 'VALIDE' ? '#bbf7d0' : c.status === 'ERREUR' ? '#fecaca' : '#fef3c7'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: c.status === 'VALIDE' ? '#15803d' : c.status === 'ERREUR' ? '#b91c1c' : '#b45309' }}>
                          [{c.id}] {c.libelle}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '0.2rem' }}>{c.explication}</div>
                      </div>
                      <span style={{ padding: '0.25rem 0.65rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700, background: c.status === 'VALIDE' ? '#16a34a' : c.status === 'ERREUR' ? '#dc2626' : '#d97706', color: '#fff' }}>
                        {c.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sub-tab 2: PAGE DE GARDE & INFO */}
            {dsfSubTab === 'info' && (
              <form onSubmit={handleSaveCompanyInfo} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.2rem' }}>Numéro Identifiant Unique (NIU) *</label>
                  <input type="text" className="input" value={companyForm.niu || ''} onChange={e => setCompanyForm({ ...companyForm, niu: e.target.value })} required />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.2rem' }}>Raison Sociale *</label>
                  <input type="text" className="input" value={companyForm.raison_sociale || ''} onChange={e => setCompanyForm({ ...companyForm, raison_sociale: e.target.value })} required />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.2rem' }}>Centre Fiscal Competent</label>
                  <select className="input" value={companyForm.centre_fiscal || ''} onChange={e => setCompanyForm({ ...companyForm, centre_fiscal: e.target.value })}>
                    <option value="DGE Douala/Yaoundé">DGE - Direction des Grandes Entreprises</option>
                    <option value="CIME Douala">CIME - Centre Impôts Moyennes Entreprises Douala</option>
                    <option value="CIME Yaoundé">CIME - Centre Impôts Moyennes Entreprises Yaoundé</option>
                    <option value="CDI Akwa">CDI - Centre Divisionnaire Akwa</option>
                    <option value="CSIPLI">CSIPLI - Professions Libérales</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.2rem' }}>Régime Comptable</label>
                  <select className="input" value={companyForm.regime || ''} onChange={e => setCompanyForm({ ...companyForm, regime: e.target.value })}>
                    <option value="Système Normal (SN)">Système Normal (SN - CA ≥ 50M FCFA)</option>
                    <option value="Système Minimal de Trésorerie (SMT)">Système Minimal de Trésorerie (SMT - CA &lt; 50M FCFA)</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.2rem' }}>Forme Juridique</label>
                  <input type="text" className="input" value={companyForm.forme_juridique || ''} onChange={e => setCompanyForm({ ...companyForm, forme_juridique: e.target.value })} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.2rem' }}>Nom du Signataire / Qualité</label>
                  <input type="text" className="input" value={companyForm.signataire_nom || ''} onChange={e => setCompanyForm({ ...companyForm, signataire_nom: e.target.value })} />
                </div>
                <div style={{ gridColumn: '1 / -1', marginTop: '0.5rem' }}>
                  <button type="submit" className="btn btn-primary" disabled={savingDsfInfo}>
                    {savingDsfInfo ? 'Enregistrement...' : 'Enregistrer les informations de garde'}
                  </button>
                </div>
              </form>
            )}

            {/* Sub-tab 3: TDRF & IS */}
            {dsfSubTab === 'tdrf' && (
              <div style={{ maxWidth: '650px' }}>
                <h4 style={{ marginBottom: '1rem' }}>Tableau de Détermination du Résultat Fiscal (TDRF)</h4>
                <div style={{ display: 'grid', gap: '0.5rem', fontSize: '0.85rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', background: '#f8fafc', borderRadius: '4px' }}>
                    <span>Chiffre d'Affaires HT (Ventes 70)</span>
                    <strong>{(tdrf.ca || 0).toLocaleString()} FCFA</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', background: '#f8fafc', borderRadius: '4px' }}>
                    <span>Résultat comptable avant IS</span>
                    <strong>{(tdrf.resultatComptableAvantIS || 0).toLocaleString()} FCFA</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', background: '#fffbe5', borderRadius: '4px' }}>
                    <span>+ Réintégrations extra-comptables (Amendes, charges non déductibles)</span>
                    <span>+{(tdrf.reintegrations || 0).toLocaleString()} FCFA</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', background: '#f0fdf4', borderRadius: '4px' }}>
                    <span>- Déductions extra-comptables (Plus-values exonérées, dividendes)</span>
                    <span>-{(tdrf.deductions || 0).toLocaleString()} FCFA</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem', background: '#e2e8f0', borderRadius: '4px', fontWeight: 700 }}>
                    <span>RÉSULTAT FISCAL IMPOSABLE</span>
                    <span>{(tdrf.resultatFiscalImposable || 0).toLocaleString()} FCFA</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <span>IS Calculé (
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="100"
                        value={isRateInput}
                        onChange={e => setIsRateInput(e.target.value)}
                        style={{ width: '55px', padding: '0.15rem 0.3rem', fontSize: '0.85rem', border: '1px solid var(--color-border)', borderRadius: '3px' }}
                      /> % sur résultat fiscal
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', marginLeft: '0.4rem' }}
                        disabled={isRateBusy || parseFloat(isRateInput) === tdrf.isRate}
                        onClick={handleSaveIsRate}
                      >
                        {isRateBusy ? '...' : 'Enregistrer'}
                      </button>
                      {isRateMsg && (
                        <span style={{ marginLeft: '0.4rem', fontSize: '0.72rem', color: isRateMsg.type === 'error' ? '#dc2626' : '#16a34a' }}>
                          {isRateMsg.text}
                        </span>
                      )}
                    </span>
                    <span>{(tdrf.isCalcule || 0).toLocaleString()} FCFA</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem' }}>
                    <span>Minimum de perception IS (1% du CA HT)</span>
                    <span>{(tdrf.minimumPerceptionIS || 0).toLocaleString()} FCFA</span>
                  </div>

                  {tdrf.isReel > 0 && (
                    <div style={{ padding: '0.75rem', background: '#f1f5f9', borderRadius: '4px', border: '1px dashed #94a3b8' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                        <span>IS réellement comptabilisé (compte 89)</span>
                        <strong>{tdrf.isReel.toLocaleString()} FCFA</strong>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>Source retenue pour la DSF :</span>
                        <button
                          type="button"
                          className={`btn ${tdrf.isSource === 'theorique' ? 'btn-primary' : 'btn-secondary'}`}
                          style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                          disabled={isSourceBusy}
                          onClick={() => handleToggleIsSource('theorique')}
                        >
                          Calcul théorique ({tdrf.isRate || 27.5}%)
                        </button>
                        <button
                          type="button"
                          className={`btn ${tdrf.isSource === 'reel' ? 'btn-primary' : 'btn-secondary'}`}
                          style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                          disabled={isSourceBusy}
                          onClick={() => handleToggleIsSource('reel')}
                        >
                          Réellement comptabilisé
                        </button>
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem', background: '#fee2e2', color: '#991b1b', borderRadius: '4px', fontWeight: 700, fontSize: '0.95rem' }}>
                    <span>IMPÔT SUR LES SOCIÉTÉS RETENU (IS){tdrf.isReel > 0 ? ` — ${tdrf.isSource === 'reel' ? 'réel' : 'théorique'}` : ''}</span>
                    <span>{(tdrf.isFinal || 0).toLocaleString()} FCFA</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem', background: '#dcfce7', color: '#166534', borderRadius: '4px', fontWeight: 700, fontSize: '0.95rem' }}>
                    <span>RÉSULTAT NET DE L'EXERCICE APRÈS IS</span>
                    <span>{(tdrf.resultatNetFinal || 0).toLocaleString()} FCFA</span>
                  </div>
                </div>
              </div>
            )}

            {/* Sub-tab 4: TFT */}
            {dsfSubTab === 'tft' && (
              <div style={{ maxWidth: '650px' }}>
                <h4 style={{ marginBottom: '1rem' }}>Tableau des Flux de Trésorerie (TFT - Méthode Indirecte)</h4>
                <div style={{ display: 'grid', gap: '0.5rem', fontSize: '0.85rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem' }}>
                    <span>Capacité d'Autofinancement (CAF)</span>
                    <span>{(tft.caf || 0).toLocaleString()} FCFA</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem' }}>
                    <span>- Variation du Besoin en Fonds de Roulement (ΔBFR)</span>
                    <span>{(tft.deltaBFR || 0).toLocaleString()} FCFA</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.6rem', background: '#f8fafc', borderRadius: '4px' }}>
                    <span>Flux de trésorerie provenant des activités d'exploitation</span>
                    <strong>{(tft.fluxExploitation || 0).toLocaleString()} FCFA</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.6rem', background: '#f8fafc', borderRadius: '4px' }}>
                    <span>Flux de trésorerie provenant des activités d'investissement</span>
                    <strong>{(tft.fluxInvestissement || 0).toLocaleString()} FCFA</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.6rem', background: '#f8fafc', borderRadius: '4px' }}>
                    <span>Flux de trésorerie provenant des activités de financement</span>
                    <strong>{(tft.fluxFinancement || 0).toLocaleString()} FCFA</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem', background: '#cbd5e1', borderRadius: '4px', fontWeight: 700, fontSize: '0.95rem' }}>
                    <span>VARIATION NETTE DE LA TRÉSORERIE DE L'EXERCICE</span>
                    <span>{(tft.variationTrésorerieNette || 0).toLocaleString()} FCFA</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem' }}>
                    <span>Trésorerie d'ouverture (reconstituée depuis le RAN)</span>
                    <span>{(tft.tresorerieOuverture || 0).toLocaleString()} FCFA</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem', background: '#dcfce7', color: '#166534', borderRadius: '4px', fontWeight: 700, fontSize: '0.95rem' }}>
                    <span>TRÉSORERIE DE CLÔTURE (TFT)</span>
                    <span>{(tft.tresorerieCloture || 0).toLocaleString()} FCFA</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.6rem', background: '#f1f5f9', borderRadius: '4px' }}>
                    <span>Trésorerie Nette au Bilan (Disponibilités − Concours bancaires)</span>
                    <strong>{(tft.tresorerieNetBilan || 0).toLocaleString()} FCFA</strong>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      }

      case 'lettrage': {
        const handleAutoLettrage = async () => {
          try {
            const res = await fetch('/api/lettrage/auto', { method: 'POST' });
            const data = await res.json();
            setLettrageMsg(data.message);
            fetchLettrageEntries();
          } catch (e) {
            console.error(e);
          }
        };

        const handleManuelLettrage = async () => {
          if (selectedLettrageIds.length === 0) return;
          try {
            const res = await fetch('/api/lettrage/manuel', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ lineIds: selectedLettrageIds, username: 'Comptable' })
            });
            const data = await res.json();
            setLettrageMsg(data.message);
            setSelectedLettrageIds([]);
            fetchLettrageEntries();
          } catch (e) {
            console.error(e);
          }
        };

        const handleCancelLettrage = async (code) => {
          try {
            const res = await fetch('/api/lettrage/annuler', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ codeLettrage: code })
            });
            const data = await res.json();
            setLettrageMsg(data.message);
            fetchLettrageEntries();
          } catch (e) {
            console.error(e);
          }
        };

        const selectedEntries = lettrageEntries.filter(l => selectedLettrageIds.includes(l.id));
        const sumDebit = selectedEntries.reduce((s, l) => s + (l.debit || 0), 0);
        const sumCredit = selectedEntries.reduce((s, l) => s + (l.credit || 0), 0);
        const ecartSel = Math.abs(sumDebit - sumCredit);

        return (
          <div style={{ background: 'white', padding: '1.25rem', borderRadius: 'var(--radius-md)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '1rem' }}>
              <div>
                <h2 style={{ margin: 0, color: 'var(--color-primary-dark)', fontSize: '1.25rem', fontWeight: 700 }}>
                  Lettrage & Échéances des Comptes Tiers (OHADA)
                </h2>
                <p style={{ margin: '0.25rem 0 0 0', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                  Gestion du lettrage automatique/manuel, des règlements fractionnés et suivi de la balance âgée
                </p>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className={`btn ${lettrageSubTab === 'lettrage' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setLettrageSubTab('lettrage'); fetchLettrageEntries(); }}>
                  🔗 Lettrage Tiers
                </button>
                <button className={`btn ${lettrageSubTab === 'agee' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setLettrageSubTab('agee'); fetchBalanceAgee(); }}>
                  📅 Balance Âgée & Relances
                </button>
              </div>
            </div>

            {lettrageMsg && (
              <div style={{ padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)', background: '#e0f2fe', color: '#0369a1', fontSize: '0.85rem', marginBottom: '1rem', fontWeight: 600 }}>
                {lettrageMsg}
              </div>
            )}

            {lettrageSubTab === 'lettrage' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem', background: '#f8fafc', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>Filtrer par Compte Tiers :</label>
                    <input
                      type="text"
                      className="input"
                      style={{ width: '160px', padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}
                      placeholder="Ex: 4111, 4011..."
                      value={lettrageAccountFilter}
                      onChange={e => setLettrageAccountFilter(e.target.value)}
                    />
                    <button className="btn btn-secondary" onClick={fetchLettrageEntries} style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }}>Filtrer</button>
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <button className="btn btn-primary" onClick={handleAutoLettrage} style={{ background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)', fontSize: '0.85rem' }}>
                      ⚡ Lettrage Automatique
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={handleManuelLettrage}
                      disabled={selectedLettrageIds.length === 0}
                      style={{ background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)', fontSize: '0.85rem' }}
                    >
                      🔗 Lettrer la Sélection ({selectedLettrageIds.length})
                    </button>
                  </div>
                </div>

                {selectedLettrageIds.length > 0 && (
                  <div style={{ padding: '0.6rem 1rem', background: ecartSel < 0.01 ? '#f0fdf4' : '#fffbe5', borderRadius: 'var(--radius-md)', marginBottom: '1rem', border: `1px solid ${ecartSel < 0.01 ? '#bbf7d0' : '#fef3c7'}`, display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                    <span>Débit Sélectionné : <strong>{sumDebit.toLocaleString()} FCFA</strong> | Crédit Sélectionné : <strong>{sumCredit.toLocaleString()} FCFA</strong></span>
                    <span style={{ fontWeight: 700, color: ecartSel < 0.01 ? '#15803d' : '#b45309' }}>
                      Écart : {ecartSel.toLocaleString()} FCFA {ecartSel < 0.01 ? '(Prêt à solder)' : '(Lettrage partiel)'}
                    </span>
                  </div>
                )}

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ background: '#f1f5f9', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                        <th style={{ padding: '0.5rem' }}></th>
                        <th style={{ padding: '0.5rem', textAlign: 'left' }}>Date</th>
                        <th style={{ padding: '0.5rem', textAlign: 'left' }}>Compte</th>
                        <th style={{ padding: '0.5rem', textAlign: 'left' }}>Facture / Réf</th>
                        <th style={{ padding: '0.5rem', textAlign: 'left' }}>Libellé</th>
                        <th style={{ padding: '0.5rem', textAlign: 'right' }}>Débit</th>
                        <th style={{ padding: '0.5rem', textAlign: 'right' }}>Crédit</th>
                        <th style={{ padding: '0.5rem', textAlign: 'center' }}>Statut</th>
                        <th style={{ padding: '0.5rem', textAlign: 'center' }}>Code</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lettrageEntries.map(l => {
                        const isChecked = selectedLettrageIds.includes(l.id);
                        return (
                          <tr
                            key={l.id}
                            style={{ borderBottom: '1px solid #e2e8f0', background: isChecked ? '#e0f2fe' : 'transparent', cursor: 'pointer' }}
                            onClick={() => {
                              setHighlightRowId(l.id);
                              setActiveTab('journal');
                            }}
                            title="Cliquer pour afficher cette écriture en surbrillance dans le Journal"
                          >
                            <td style={{ padding: '0.5rem', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={e => {
                                  if (e.target.checked) setSelectedLettrageIds([...selectedLettrageIds, l.id]);
                                  else setSelectedLettrageIds(selectedLettrageIds.filter(id => id !== l.id));
                                }}
                              />
                            </td>
                            <td style={{ padding: '0.5rem' }}>{l.date}</td>
                            <td style={{ padding: '0.5rem', fontWeight: 600 }}>{l.compte_tiers || l.compte}</td>
                            <td style={{ padding: '0.5rem' }}>{l.n_facture || l.reference || '-'}</td>
                            <td style={{ padding: '0.5rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                <span>{l.libelle}</span>
                                <span style={{ fontSize: '0.7rem', color: '#2563eb', fontWeight: 600 }}>↗ Journal</span>
                              </div>
                            </td>
                            <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: l.debit ? 600 : 400 }}>{l.debit ? l.debit.toLocaleString() : '-'}</td>
                            <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: l.credit ? 600 : 400 }}>{l.credit ? l.credit.toLocaleString() : '-'}</td>
                            <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                              <span style={{ padding: '0.2rem 0.5rem', borderRadius: '10px', fontSize: '0.7rem', fontWeight: 700, background: l.statut_lettrage === 'solde' ? '#16a34a' : l.statut_lettrage === 'partiel' ? '#d97706' : '#94a3b8', color: '#fff' }}>
                                {l.statut_lettrage || 'non_lettre'}
                              </span>
                            </td>
                            <td style={{ padding: '0.5rem', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                              {l.code_lettrage ? (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}>
                                  <strong style={{ color: '#1e40af', fontSize: '0.75rem' }}>{l.code_lettrage}</strong>
                                  <button onClick={() => handleCancelLettrage(l.code_lettrage)} title="Annuler le lettrage" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#dc2626', fontSize: '0.75rem', fontWeight: 'bold' }}>✕</button>
                                </div>
                              ) : '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {lettrageSubTab === 'agee' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h4>Balance Âgée Tiers</h4>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className={`btn ${balanceAgeeType === 'client' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setBalanceAgeeType('client'); fetchBalanceAgee(); }}>
                      Clients (Compte 411)
                    </button>
                    <button className={`btn ${balanceAgeeType === 'fournisseur' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setBalanceAgeeType('fournisseur'); fetchBalanceAgee(); }}>
                      Fournisseurs (Compte 401)
                    </button>
                  </div>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ background: '#f1f5f9', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                        <th style={{ padding: '0.6rem', textAlign: 'left' }}>Compte / Nom du Tiers</th>
                        <th style={{ padding: '0.6rem', textAlign: 'right' }}>Total Dû</th>
                        <th style={{ padding: '0.6rem', textAlign: 'right' }}>Non Échu</th>
                        <th style={{ padding: '0.6rem', textAlign: 'right', color: '#b45309' }}>1 - 30 Jours</th>
                        <th style={{ padding: '0.6rem', textAlign: 'right', color: '#c2410c' }}>31 - 60 Jours</th>
                        <th style={{ padding: '0.6rem', textAlign: 'right', color: '#b91c1c' }}>61 - 90 Jours</th>
                        <th style={{ padding: '0.6rem', textAlign: 'right', color: '#7f1d1d' }}>+ 90 Jours</th>
                      </tr>
                    </thead>
                    <tbody>
                      {balanceAgeeData.map(t => (
                        <tr key={t.compte} style={{ borderBottom: '1px solid #e2e8f0' }}>
                          <td style={{ padding: '0.6rem', fontWeight: 600 }}>{t.nom} ({t.compte})</td>
                          <td style={{ padding: '0.6rem', textAlign: 'right', fontWeight: 700 }}>{t.totalDu.toLocaleString()} FCFA</td>
                          <td style={{ padding: '0.6rem', textAlign: 'right' }}>{t.nonEchu.toLocaleString()} FCFA</td>
                          <td style={{ padding: '0.6rem', textAlign: 'right', color: t.retard0_30 > 0 ? '#b45309' : undefined }}>{t.retard0_30.toLocaleString()} FCFA</td>
                          <td style={{ padding: '0.6rem', textAlign: 'right', color: t.retard31_60 > 0 ? '#c2410c' : undefined }}>{t.retard31_60.toLocaleString()} FCFA</td>
                          <td style={{ padding: '0.6rem', textAlign: 'right', color: t.retard61_90 > 0 ? '#b91c1c' : undefined }}>{t.retard61_90.toLocaleString()} FCFA</td>
                          <td style={{ padding: '0.6rem', textAlign: 'right', fontWeight: t.retard90Plus > 0 ? 700 : 400, color: t.retard90Plus > 0 ? '#7f1d1d' : undefined }}>{t.retard90Plus.toLocaleString()} FCFA</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      }

      case 'rapprochement': {
        const handleMatchBank = async (statementId, journalId) => {
          try {
            const res = await fetch('/api/rapprochement/match', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ statementId, journalId })
            });
            const data = await res.json();
            setRapprochementMsg(data.message);
            fetchRapprochement();
          } catch (e) {
            console.error(e);
          }
        };

        return (
          <div style={{ background: 'white', padding: '1.25rem', borderRadius: 'var(--radius-md)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '1rem' }}>
              <div>
                <h2 style={{ margin: 0, color: 'var(--color-primary-dark)', fontSize: '1.25rem', fontWeight: 700 }}>
                  Rapprochement Bancaire (Compte 52 / 56)
                </h2>
                <p style={{ margin: '0.25rem 0 0 0', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                  Concordance entre le relevé bancaire réel et les écritures du journal de banque
                </p>
              </div>

              <button className="btn btn-secondary" onClick={fetchRapprochement} style={{ fontSize: '0.85rem' }}>
                <RefreshCw size={14} /> Actualiser l'état
              </button>
            </div>

            {rapprochementMsg && (
              <div style={{ padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)', background: '#f0fdf4', color: '#15803d', fontSize: '0.85rem', marginBottom: '1rem', fontWeight: 600 }}>
                {rapprochementMsg}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
              {/* Colonne 1: Relevé de Banque */}
              <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '1rem', background: '#f8fafc' }}>
                <h4 style={{ margin: '0 0 1rem 0', color: '#1e3a8a' }}>📋 Relevé Bancaire (Banque)</h4>
                {statementLines.length === 0 ? (
                  <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>Aucune ligne de relevé bancaire importée.</p>
                ) : (
                  <div style={{ display: 'grid', gap: '0.5rem', maxHeight: '400px', overflowY: 'auto' }}>
                    {statementLines.map(s => (
                      <div key={s.id} style={{ padding: '0.6rem', borderRadius: '4px', background: s.statut_matching === 'rapproche' ? '#dcfce7' : '#ffffff', border: '1px solid #cbd5e1', fontSize: '0.8rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                          <span>{s.date_operation}</span>
                          <span style={{ color: s.credit > 0 ? '#16a34a' : '#dc2626' }}>
                            {s.credit > 0 ? `+${s.credit.toLocaleString()}` : `-${s.debit.toLocaleString()}`} FCFA
                          </span>
                        </div>
                        <div style={{ color: 'var(--color-text-muted)', margin: '0.2rem 0' }}>{s.libelle}</div>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: s.statut_matching === 'rapproche' ? '#15803d' : '#b45309' }}>
                          {s.statut_matching === 'rapproche' ? '✓ Rapproché' : 'En attente de matching'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Colonne 2: Journal de Banque 52 */}
              <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '1rem', background: '#f8fafc' }}>
                <h4 style={{ margin: '0 0 1rem 0', color: '#15803d' }}>📚 Écritures Journal de Banque (Compte 52)</h4>
                <div style={{ display: 'grid', gap: '0.5rem', maxHeight: '400px', overflowY: 'auto' }}>
                  {journalBankLines.map(j => (
                    <div key={j.id} style={{ padding: '0.6rem', borderRadius: '4px', background: j.reference_banque ? '#dcfce7' : '#ffffff', border: '1px solid #cbd5e1', fontSize: '0.8rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                        <span>{j.date} - {j.compte}</span>
                        <span style={{ color: j.debit > 0 ? '#16a34a' : '#dc2626' }}>
                          {j.debit > 0 ? `+${j.debit.toLocaleString()}` : `-${j.credit.toLocaleString()}`} FCFA
                        </span>
                      </div>
                      <div style={{ color: 'var(--color-text-muted)', margin: '0.2rem 0' }}>{j.libelle}</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.4rem' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: j.reference_banque ? '#15803d' : '#b45309' }}>
                          {j.reference_banque ? `✓ ${j.reference_banque}` : 'Non rapproché'}
                        </span>
                        {!j.reference_banque && statementLines.filter(s => s.statut_matching !== 'rapproche').length > 0 && (
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '0.15rem 0.4rem', fontSize: '0.7rem' }}
                            onClick={() => {
                              const unMatched = statementLines.find(s => s.statut_matching !== 'rapproche');
                              if (unMatched) handleMatchBank(unMatched.id, j.id);
                            }}
                          >
                            Matching auto
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      }
    }
  };

  const handleExport = (exportType, format = 'excel') => {
    let url = `/api/export/etats-financiers?type=${exportType}&format=${format}`;
    if (activeTab === 'balance') {
      if (balanceFilterCompte) url += `&search=${encodeURIComponent(balanceFilterCompte)}`;
      if (balanceClassFilter) url += `&classe=${encodeURIComponent(balanceClassFilter)}`;
      if (balanceDateDebut && balanceDateFin) {
        url += `&dateDebut=${encodeURIComponent(balanceDateDebut)}&dateFin=${encodeURIComponent(balanceDateFin)}`;
      }
    }
    // Le bouton annonce "respecte les filtres actifs" : sans ça, exporter depuis l'onglet Journal
    // ignorait silencieusement la recherche tapée à l'écran et le bouton "Toutes les dates", renvoyant
    // un fichier différent de ce qui était affiché.
    if (activeTab === 'journal') {
      if (journalSearchDebounced) url += `&search=${encodeURIComponent(journalSearchDebounced)}`;
      if (showAllDates) url += `&all=1`;
    }
    window.location.href = url;
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Table style={{ color: 'var(--color-primary)' }} />
          Comptabilité & États Financiers
        </h3>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary"
            onClick={() => handleExport('pack', 'excel')}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)', borderColor: '#15803d', color: '#fff', fontWeight: 600, fontSize: '0.85rem' }}
            title="Exporter l'ensemble des états financiers en Excel (.xlsx)"
          >
            <Download size={16} /> 📦 Pack Excel (.xlsx)
          </button>
          <button
            className="btn btn-primary"
            onClick={() => handleExport('pack', 'pdf')}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)', borderColor: '#b91c1c', color: '#fff', fontWeight: 600, fontSize: '0.85rem' }}
            title="Exporter l'ensemble des états financiers en PDF (.pdf)"
          >
            <Download size={16} /> 📄 Pack PDF (.pdf)
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '2rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto' }}>
          <button className={`btn ${activeTab === 'saisie' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('saisie')}>Saisie / Upload</button>
          <button className={`btn ${activeTab === 'journal' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('journal')}>Journal</button>
          <button className={`btn ${activeTab === 'grandlivre' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('grandlivre')}>Grand Livre</button>
          <button className={`btn ${activeTab === 'balance' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('balance')}>Balance</button>
          <button className={`btn ${activeTab === 'bilan' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('bilan')}>Bilan</button>
          <button className={`btn ${activeTab === 'resultat' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('resultat')}>Compte de Résultat</button>
          <button className={`btn ${activeTab === 'dsf' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('dsf')} style={{ background: activeTab === 'dsf' ? 'linear-gradient(135deg, #1e40af 0%, #1e3a8a 100%)' : undefined, color: activeTab === 'dsf' ? '#fff' : undefined, fontWeight: 600 }}>📋 DSF OHADA</button>
          <button className={`btn ${activeTab === 'lettrage' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setActiveTab('lettrage'); fetchLettrageEntries(); }}>🔗 Lettrage & Échéances</button>
          <button className={`btn ${activeTab === 'rapprochement' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setActiveTab('rapprochement'); fetchRapprochement(); }}>🏦 Rapprochement Bancaire</button>
        </div>

        {['journal', 'grandlivre', 'balance', 'bilan', 'resultat'].includes(activeTab) && (
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button
              className="btn btn-secondary"
              onClick={() => handleExport(activeTab === 'grandlivre' ? 'journal' : activeTab, 'excel')}
              style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem' }}
              title="Exporter l'onglet au format Excel (respecte les filtres actifs)"
            >
              <Download size={14} /> Exporter Excel
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => handleExport(activeTab === 'grandlivre' ? 'journal' : activeTab, 'pdf')}
              style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', color: '#b91c1c', borderColor: '#fca5a5' }}
              title="Exporter l'onglet au format PDF (respecte les filtres actifs)"
            >
              <Download size={14} /> Exporter PDF
            </button>
          </div>
        )}
      </div>

      {/* Suggestions issues du plan comptable de l'entreprise chargé en mémoire (voir
          /api/chart-of-accounts) : la saisie reste libre, mais propose en priorité les comptes
          réellement utilisés par l'entité plutôt qu'une liste OHADA générique. Défini une seule
          fois ici (plutôt que dans un onglet précis) pour rester disponible quel que soit l'onglet
          actif, y compris l'édition inline du Journal. */}
      <datalist id="chart-of-accounts-list">
        {Object.entries(customAccounts).map(([compte, libelle]) => (
          <option key={compte} value={compte}>{compte} — {libelle}</option>
        ))}
      </datalist>

      <div style={{ minHeight: '400px' }}>
        {renderContent()}
      </div>
    </div>
  );
};
