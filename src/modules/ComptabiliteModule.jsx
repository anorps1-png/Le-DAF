import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import { 
  BrainCircuit, Table, CheckCircle, Plus, Trash2, AlertTriangle, Pencil, X, 
  Download, RefreshCw, Zap, FileText, UploadCloud, ArrowRight, ShieldCheck, 
  Check, Info, Calculator, CreditCard, Banknote, Sparkles, FolderOpen, 
  ArrowDownLeft, ArrowUpRight, Wrench, HelpCircle, Save 
} from 'lucide-react';
import { getAccountLabel, cleanAccountLabel } from '../utils/ohadaPlan';
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
  const [glTiersList, setGlTiersList] = useState([]);
  const [glSelectedTier, setGlSelectedTier] = useState('');
  const [glTierLedger, setGlTierLedger] = useState(null);
  // Le Grand Livre par compte, par tiers (auxiliaire) et par journal sont trois axes de consultation indépendants :
  // 'compte' affiche le compte général sélectionné,
  // 'tiers' affiche le grand livre auxiliaire du tiers (mouvements sur comptes de tiers 4xx, hors contreparties),
  // 'journal' affiche toutes les écritures du journal sélectionné.
  const [glFilterMode, setGlFilterMode] = useState('compte');
  const [glLedger, setGlLedger] = useState(null);
  const [glJournalLedger, setGlJournalLedger] = useState(null);
  const [glLoading, setGlLoading] = useState(false);
  const [glError, setGlError] = useState('');
  // Sélection multiple pour le changement de compte en masse : indépendante du mode d'affichage
  // (compte ou journal), remise à zéro dès que le filtre ou le contenu affiché change.
  const [selectedGlIds, setSelectedGlIds] = useState([]);
  const [glRefreshTick, setGlRefreshTick] = useState(0);
  const [glPage, setGlPage] = useState(1);
  const [glPageSize, setGlPageSize] = useState(100);
  const [glEditForm, setGlEditForm] = useState({
    date: '',
    code_journal: '',
    compte: '',
    compte_tiers: '',
    libelle: '',
    n_facture: '',
    reference: '',
    poste_budgetaire: '',
    debit: '',
    credit: ''
  });
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
  const emptyLine = (d) => ({
    date: d || manualHeader.date || new Date().toISOString().split('T')[0],
    compte: '',
    compte_tiers: '',
    libelle: '',
    debit: '0',
    credit: '0'
  });
  const [manualLines, setManualLines] = useState([emptyLine(), emptyLine()]);
  const [manualStatus, setManualStatus] = useState('');
  const [memoryMatch, setMemoryMatch] = useState({});

  // --- NOUVEAU MODULE SAISIE / UPLOAD ---
  // Sous-modes : 'express' (Facture & Règlement en 1 Clic), 'libre' (Grille Multi-Lignes/OD), 'upload' (Import Fichiers)
  const [saisieSubMode, setSaisieSubMode] = useState('express');
  const [saisieConfig, setSaisieConfig] = useState(null);

  // Formulaire Express (Facture & Règlement en 1 Clic)
  const [expressForm, setExpressForm] = useState({
    type: 'achat', // 'achat' ou 'vente'
    date_facture: new Date().toISOString().split('T')[0],
    date_echeance: '',
    n_facture: '',
    reference: '',
    tiers_nom: '',
    tiers_compte: '401100',
    compte_charge_produit: '601100',
    libelle: '',
    montant_ht: '',
    taux_tva: 19.25,
    montant_tva: '',
    montant_ttc: '',
    poste_budgetaire: 'ACHATS',
    code_journal_facture: 'AC',
    // Règlement lié en 1 clic :
    regle_immediat: true,
    date_reglement: new Date().toISOString().split('T')[0],
    mode_reglement: 'caisse', // 'caisse' | 'banque' | 'mobile_money'
    code_journal_reglement: 'CA',
    compte_tresorerie: '57111001', // CAISSE PRINCIPALE (conforme balance réelle)
    montant_regle: '',
    reference_reglement: ''
  });
  const [expressLoading, setExpressLoading] = useState(false);
  const [expressResult, setExpressResult] = useState(null);
  const [expressError, setExpressError] = useState('');

  // Règlement lié en 1 Clic pour la Saisie Grille / OD
  const [gridRegleImmediat, setGridRegleImmediat] = useState(false);
  const [gridReglement, setGridReglement] = useState({
    date_reglement: new Date().toISOString().split('T')[0],
    mode_reglement: 'caisse', // 'caisse' | 'banque' | 'mobile_money'
    code_journal_reglement: 'CA',
    compte_tresorerie: '57111001',
    montant_regle: '',
    reference_reglement: '',
    compte_tiers_reglement: ''
  });

  // Upload intégré
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadType, setUploadType] = useState('factures');
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [uploadImbalance, setUploadImbalance] = useState(null);
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
    fetchSaisieConfig();
  }, []);

  const fetchSaisieConfig = async () => {
    try {
      const [cfgRes, balRes, chartRes] = await Promise.all([
        fetch('/api/journal/config-saisie').catch(() => null),
        fetch('/api/balance').catch(() => null),
        fetch('/api/chart-of-accounts').catch(() => null)
      ]);
      const cfg = cfgRes && cfgRes.ok ? await cfgRes.json() : null;
      const balRows = balRes && balRes.ok ? await balRes.json() : [];
      const chartRows = chartRes && chartRes.ok ? await chartRes.json() : [];

      // Dictionnaire complet du plan comptable (même source que la colonne Intitulé de la Balance)
      const chartMap = { ...customAccounts };
      (chartRows || []).forEach(r => {
        if (r.compte) chartMap[String(r.compte).trim()] = cleanAccountLabel(r.libelle);
      });
      if (Object.keys(chartMap).length > 0) {
        setCustomAccounts(prev => ({ ...prev, ...chartMap }));
      }

      // Extraire les comptes de trésorerie (Classe 5) directement présents dans la Balance
      const class5Bal = Array.isArray(balRows) ? balRows.filter(r => String(r.compte || '').startsWith('5')) : [];
      
      const balTresoMap = new Map();
      class5Bal.forEach(r => {
        const c = String(r.compte).trim();
        // L'intitulé STRICTEMENT identique à celui affiché dans la Balance (via getAccountLabel)
        const intituleBalance = cleanAccountLabel(getAccountLabel(c, chartMap));
        balTresoMap.set(c, {
          compte: c,
          libelle: intituleBalance || `COMPTE ${c}`,
          solde: r.solde_cumule || 0,
          is_in_balance: true
        });
      });

      // Si le backend a aussi fourni ses listes enrichies, on s'assure d'avoir les mêmes intitulés que la Balance
      (cfg?.comptes_caisse || []).forEach(acc => {
        const c = String(acc.compte).trim();
        const intituleBalance = cleanAccountLabel(getAccountLabel(c, chartMap)) || cleanAccountLabel(acc.libelle);
        if (!balTresoMap.has(c) && acc.is_in_balance) {
          balTresoMap.set(c, { ...acc, libelle: intituleBalance });
        } else if (balTresoMap.has(c)) {
          const cur = balTresoMap.get(c);
          balTresoMap.set(c, { ...cur, libelle: intituleBalance || cur.libelle });
        }
      });
      (cfg?.comptes_banque || []).forEach(acc => {
        const c = String(acc.compte).trim();
        const intituleBalance = cleanAccountLabel(getAccountLabel(c, chartMap)) || cleanAccountLabel(acc.libelle);
        if (!balTresoMap.has(c) && acc.is_in_balance) {
          balTresoMap.set(c, { ...acc, libelle: intituleBalance });
        } else if (balTresoMap.has(c)) {
          const cur = balTresoMap.get(c);
          balTresoMap.set(c, { ...cur, libelle: intituleBalance || cur.libelle });
        }
      });

      const allBalTreso = Array.from(balTresoMap.values());
      
      // Comptes Caisse STRICTEMENT issus de la balance (57...) avec intitulés de la balance
      const caisseFromBal = allBalTreso.filter(t => t.compte.startsWith('57'))
        .sort((a, b) => Math.abs(b.solde) - Math.abs(a.solde) || a.compte.localeCompare(b.compte));
      
      // Comptes Banque STRICTEMENT issus de la balance (52..., 51..., 53..., 54..., 56...) avec intitulés de la balance
      const banqueFromBal = allBalTreso.filter(t => /^(52|51|53|54|56)/.test(t.compte))
        .sort((a, b) => Math.abs(b.solde) - Math.abs(a.solde) || a.compte.localeCompare(b.compte));

      // Mobile money
      const momoFromBal = allBalTreso.filter(t => /^(55|5852)/.test(t.compte) || /money|orange|mtn/i.test(t.libelle));
      const momoFallback = [
        { compte: '55410001', libelle: cleanAccountLabel(getAccountLabel('55410001', chartMap)) || 'ORANGE MONEY SIM 1' },
        { compte: '55420001', libelle: cleanAccountLabel(getAccountLabel('55420001', chartMap)) || 'MTN MONEY SIM 1' }
      ];
      const momoList = momoFromBal.length ? momoFromBal : momoFallback;

      const enrichedConfig = {
        ...(cfg || {}),
        comptes_caisse: caisseFromBal.length ? caisseFromBal : (cfg?.comptes_caisse || [{ compte: '57111001', libelle: 'CAISSE PRINCIPALE' }]),
        comptes_banque: banqueFromBal.length ? banqueFromBal : (cfg?.comptes_banque || [{ compte: '52110017', libelle: 'UNICS' }]),
        comptes_mobile_money: momoList,
        all_tresorerie: allBalTreso.length ? allBalTreso : (cfg?.all_tresorerie || [])
      };

      setSaisieConfig(enrichedConfig);

      setExpressForm(prev => {
        const isAchat = prev.type === 'achat';
        const jf = isAchat ? (enrichedConfig.journaux_achats?.[0] || 'AC') : (enrichedConfig.journaux_ventes?.[0] || 'VE');
        const cp = isAchat ? (enrichedConfig.comptes_achats?.[0]?.compte || '601100') : (enrichedConfig.comptes_ventes?.[0]?.compte || '706100');
        const isBanque = prev.mode_reglement === 'banque';
        const isMoMo = prev.mode_reglement === 'mobile_money';
        const jr = isBanque 
          ? (enrichedConfig.journaux_banque?.[0] || 'BQ') 
          : (isMoMo ? (enrichedConfig.journaux_od?.[0] || 'OD') : (enrichedConfig.journaux_caisse?.[0] || 'CA'));
        
        const defaultCaisse = enrichedConfig.comptes_caisse?.[0]?.compte || '57111001';
        const defaultBanque = enrichedConfig.comptes_banque?.[0]?.compte || '52110017';
        const defaultMoMo = enrichedConfig.comptes_mobile_money?.[0]?.compte || '55410001';

        const ct = isBanque ? defaultBanque : (isMoMo ? defaultMoMo : defaultCaisse);
        const isOldDummy = prev.compte_tresorerie === '571100' || prev.compte_tresorerie === '521100' || !prev.compte_tresorerie;

        return {
          ...prev,
          code_journal_facture: prev.code_journal_facture || jf,
          compte_charge_produit: prev.compte_charge_produit || cp,
          code_journal_reglement: prev.code_journal_reglement || jr,
          compte_tresorerie: isOldDummy ? ct : prev.compte_tresorerie
        };
      });
    } catch (e) {
      console.error("Erreur config saisie:", e);
    }
  };

  const updateExpress = (field, value) => {
    setExpressForm(prev => {
      const next = { ...prev, [field]: value };
      
      if (field === 'type') {
        const isAchat = value === 'achat';
        next.poste_budgetaire = isAchat ? 'ACHATS' : 'VENTES';
        next.tiers_compte = isAchat ? '401100' : '411100';
        next.code_journal_facture = isAchat 
          ? (saisieConfig?.journaux_achats?.[0] || 'AC') 
          : (saisieConfig?.journaux_ventes?.[0] || 'VE');
        next.compte_charge_produit = isAchat
          ? (saisieConfig?.comptes_achats?.[0]?.compte || '601100')
          : (saisieConfig?.comptes_ventes?.[0]?.compte || '706100');
      }

      if (field === 'mode_reglement') {
        const isBanque = value === 'banque';
        const isMoMo = value === 'mobile_money';
        next.code_journal_reglement = isBanque 
          ? (saisieConfig?.journaux_banque?.[0] || 'BQ') 
          : (isMoMo ? (saisieConfig?.journaux_od?.[0] || 'OD') : (saisieConfig?.journaux_caisse?.[0] || 'CA'));
        next.compte_tresorerie = isBanque
          ? (saisieConfig?.comptes_banque?.[0]?.compte || '52110017')
          : (isMoMo ? (saisieConfig?.comptes_mobile_money?.[0]?.compte || '55410001') : (saisieConfig?.comptes_caisse?.[0]?.compte || '57111001'));
      }

      if (field === 'montant_ht' || field === 'taux_tva') {
        const ht = parseFloat(field === 'montant_ht' ? value : next.montant_ht) || 0;
        const tx = parseFloat(field === 'taux_tva' ? value : next.taux_tva) || 0;
        const tva = Math.round(ht * (tx / 100));
        const ttc = ht + tva;
        next.montant_tva = tva > 0 ? String(tva) : '0';
        next.montant_ttc = String(ttc);
        if (next.regle_immediat) {
          next.montant_regle = String(ttc);
        }
      }

      if (field === 'montant_ttc') {
        if (next.regle_immediat) {
          next.montant_regle = value;
        }
      }

      if (field === 'regle_immediat') {
        if (value) {
          next.montant_regle = next.montant_ttc || next.montant_ht || '';
        }
      }

      return next;
    });
  };

  const handleExpressSubmit = async (e) => {
    e.preventDefault();
    setExpressError('');
    setExpressResult(null);

    if (!expressForm.n_facture || !expressForm.date_facture || !expressForm.compte_charge_produit || !expressForm.libelle) {
      setExpressError('Veuillez renseigner tous les champs obligatoires (N° Facture, Date, Compte, Libellé).');
      return;
    }
    const ht = parseFloat(expressForm.montant_ht) || 0;
    const ttc = parseFloat(expressForm.montant_ttc) || ht;
    if (ttc <= 0) {
      setExpressError('Le montant doit être supérieur à zéro.');
      return;
    }

    setExpressLoading(true);
    try {
      const res = await adminFetch('/api/journal/facture-express', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(expressForm)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setExpressResult(data);
        setExpressForm(prev => ({
          ...prev,
          n_facture: '',
          reference: '',
          libelle: '',
          montant_ht: '',
          montant_tva: '',
          montant_ttc: '',
          montant_regle: '',
          reference_reglement: ''
        }));
        fetchSaisieConfig();
      } else {
        setExpressError(data.error || "Erreur lors de l'enregistrement de la facture.");
      }
    } catch (err) {
      setExpressError("Erreur de connexion avec le serveur.");
    } finally {
      setExpressLoading(false);
    }
  };

  // Résolution du compte bancaire et de l'intitulé associés au code journal sélectionné
  const getBankInfo = (code) => {
    if (!code) return null;
    const cleanCode = String(code).trim();
    if (saisieConfig?.journaux_banque_details) {
      const found = saisieConfig.journaux_banque_details.find(b => b.code_journal === cleanCode);
      if (found) return { compte: found.compte, nom: found.nom_banque, label: found.libelle_affiche };
    }
    // Recherche par numéro de compte / chiffres dans le code (ex: BQC015 -> 15 -> 52110015, BQC004 -> 52110004)
    const digits = cleanCode.replace(/\D/g, '');
    if (digits && saisieConfig?.comptes_banque) {
      const match = saisieConfig.comptes_banque.find(b => b.compte.endsWith(digits) || b.compte.includes(digits));
      if (match) {
        const cleanLib = cleanAccountLabel(match.libelle);
        return { compte: match.compte, nom: cleanLib, label: `${cleanCode} - Banque ${cleanLib} (${match.compte})` };
      }
    }
    // Fallback dynamique si journal BQ
    if (/^BQ/i.test(cleanCode) && saisieConfig?.comptes_banque?.[0]) {
      const firstBq = saisieConfig.comptes_banque[0];
      const cleanLib = cleanAccountLabel(firstBq.libelle);
      return { compte: firstBq.compte, nom: cleanLib, label: `${cleanCode} - Banque ${cleanLib} (${firstBq.compte})` };
    }
    return null;
  };

  const currentBankInfo = getBankInfo(manualHeader.code_journal);

  const handleJournalChange = (newJournalCode) => {
    setManualHeader(prev => {
      const isNewBank = /^BQ/i.test(newJournalCode);
      return {
        ...prev,
        code_journal: newJournalCode,
        poste_budgetaire: isNewBank && (!prev.poste_budgetaire || prev.poste_budgetaire === 'GENERAL' || prev.poste_budgetaire === 'TRESORERIE')
          ? 'BANQUE'
          : prev.poste_budgetaire
      };
    });

    // Si on bascule sur un journal bancaire, mettre à jour le compte banque présent dans les lignes existantes
    if (/^BQ/i.test(newJournalCode)) {
      const newBank = getBankInfo(newJournalCode);
      if (newBank && newBank.compte) {
        setManualLines(prevLines => {
          const hasBank = prevLines.some(l => /^(52|51)/.test(String(l.compte || '')));
          if (hasBank) {
            return prevLines.map(l => {
              if (/^(52|51)/.test(String(l.compte || ''))) {
                return {
                  ...l,
                  compte: newBank.compte,
                  libelle: l.libelle && (l.libelle.includes('Banque') || l.libelle.includes('Relevé') || l.libelle.includes('Mouvement') || l.libelle.includes('Contrepartie'))
                    ? `Relevé bancaire ${newBank.nom}`
                    : l.libelle
                };
              }
              return l;
            });
          }
          return prevLines;
        });
      }
    }
  };

  const addBankStatementLine = (type) => {
    const bqNom = currentBankInfo?.nom || 'Banque';
    const curDate = manualHeader.date || new Date().toISOString().split('T')[0];
    if (type === 'frais') {
      setManualLines(prev => [...prev, {
        date: curDate,
        compte: '627100',
        compte_tiers: '',
        libelle: `Frais & commissions bancaires (${bqNom})`,
        debit: '0',
        credit: '0'
      }]);
    } else if (type === 'tenue_compte') {
      setManualLines(prev => [...prev, {
        date: curDate,
        compte: '631810',
        compte_tiers: '',
        libelle: `Frais de tenue de compte / extrait (${bqNom})`,
        debit: '0',
        credit: '0'
      }]);
    } else if (type === 'agios') {
      setManualLines(prev => [...prev, {
        date: curDate,
        compte: '671210',
        compte_tiers: '',
        libelle: `Agios & intérêts débiteurs (${bqNom})`,
        debit: '0',
        credit: '0'
      }]);
    } else if (type === 'produit') {
      setManualLines(prev => [...prev, {
        date: curDate,
        compte: '771000',
        compte_tiers: '',
        libelle: `Intérêts créditeurs / produits bancaires (${bqNom})`,
        debit: '0',
        credit: '0'
      }]);
    } else if (type === 'virement') {
      setManualLines(prev => [...prev, {
        date: curDate,
        compte: '585000',
        compte_tiers: '',
        libelle: `Virement interne de trésorerie (${bqNom})`,
        debit: '0',
        credit: '0'
      }]);
    } else {
      setManualLines(prev => [...prev, {
        date: curDate,
        compte: '',
        compte_tiers: '',
        libelle: `Opération relevé bancaire ${bqNom}`,
        debit: '0',
        credit: '0'
      }]);
    }
  };

  const balanceManualLines = () => {
    const diff = Math.round((totalDebit - totalCredit) * 100) / 100;
    if (Math.abs(diff) < 0.01) return;

    const lastIdx = manualLines.length - 1;
    const lastLine = manualLines[lastIdx];
    const isLastEmpty = !lastLine.compte && !lastLine.libelle && Number(lastLine.debit) === 0 && Number(lastLine.credit) === 0;

    const bqInfo = getBankInfo(manualHeader.code_journal);
    let targetCompte = manualHeader.code_journal === 'AC' ? '401100' :
                       manualHeader.code_journal === 'VE' ? '411100' :
                       manualHeader.code_journal === 'CA' ? '571100' :
                       bqInfo ? bqInfo.compte :
                       /^BQ/i.test(manualHeader.code_journal) ? (saisieConfig?.comptes_banque?.[0]?.compte || '521100') : '471100';

    const contrepartieLibelle = bqInfo
      ? (diff > 0 ? `Sortie Banque ${bqInfo.nom} (débit relevé)` : `Entrée Banque ${bqInfo.nom} (crédit relevé)`)
      : `Contrepartie ${manualLines[0]?.libelle || 'écriture'}`;

    const lineDate = manualLines[lastIdx]?.date || manualHeader.date || new Date().toISOString().split('T')[0];

    if (diff > 0) {
      if (isLastEmpty) {
        updateLine(lastIdx, {
          date: lineDate,
          compte: targetCompte,
          libelle: contrepartieLibelle,
          debit: '0',
          credit: String(diff)
        });
      } else {
        setManualLines(prev => [...prev, {
          date: lineDate,
          compte: targetCompte,
          compte_tiers: '',
          libelle: contrepartieLibelle,
          debit: '0',
          credit: String(diff)
        }]);
      }
    } else {
      const absDiff = Math.abs(diff);
      if (isLastEmpty) {
        updateLine(lastIdx, {
          date: lineDate,
          compte: targetCompte,
          libelle: contrepartieLibelle,
          debit: String(absDiff),
          credit: '0'
        });
      } else {
        setManualLines(prev => [...prev, {
          date: lineDate,
          compte: targetCompte,
          compte_tiers: '',
          libelle: contrepartieLibelle,
          debit: String(absDiff),
          credit: '0'
        }]);
      }
    }
  };

  const applyPresetTemplate = (templateName) => {
    const curDate = manualHeader.date || new Date().toISOString().split('T')[0];
    if (templateName === 'paie') {
      setManualHeader(prev => ({ ...prev, code_journal: 'OD', poste_budgetaire: 'SALAIRES' }));
      setManualLines([
        { date: curDate, compte: '661100', compte_tiers: '', libelle: 'Rémunérations brutes du personnel', debit: '1000000', credit: '0' },
        { date: curDate, compte: '422000', compte_tiers: 'PERSONNEL', libelle: 'Salaires nets à payer', debit: '0', credit: '850000' },
        { date: curDate, compte: '431000', compte_tiers: 'CNPS', libelle: 'Cotisations sociales CNPS', debit: '0', credit: '100000' },
        { date: curDate, compte: '447000', compte_tiers: 'IMPOTS', libelle: 'Retenues fiscales IRPP / CAC', debit: '0', credit: '50000' }
      ]);
    } else if (templateName === 'amort') {
      setManualHeader(prev => ({ ...prev, code_journal: 'OD', poste_budgetaire: 'AMORTISSEMENTS' }));
      setManualLines([
        { date: curDate, compte: '681200', compte_tiers: '', libelle: 'Dotations aux amortissements immob. corporelles', debit: '250000', credit: '0' },
        { date: curDate, compte: '284100', compte_tiers: '', libelle: 'Amortissement du matériel & outillage', debit: '0', credit: '250000' }
      ]);
    } else if (templateName === 'banque') {
      // Sélectionne le journal de banque actif ou le premier journal bancaire disponible
      const bqJournal = (manualHeader.code_journal && /^BQ/i.test(manualHeader.code_journal))
        ? manualHeader.code_journal
        : (saisieConfig?.journaux_banque?.[0] || 'BQC015');
      const bqInfo = getBankInfo(bqJournal);
      const bqCompte = bqInfo?.compte || (saisieConfig?.comptes_banque?.[0]?.compte || '52110015');
      const bqNom = bqInfo?.nom || 'Banque';

      setManualHeader(prev => ({
        ...prev,
        code_journal: bqJournal,
        poste_budgetaire: 'BANQUE',
        reference: prev.reference || 'RELEVE BANCAIRE'
      }));

      // Structure pour la saisie des opérations de relevé bancaire (charges au Débit, compte Banque au Crédit)
      setManualLines([
        { date: curDate, compte: '627100', compte_tiers: '', libelle: `Frais & commissions bancaires (${bqNom})`, debit: '25000', credit: '0' },
        { date: curDate, compte: '445400', compte_tiers: '', libelle: 'TVA déductible sur prestations bancaires', debit: '4813', credit: '0' },
        { date: curDate, compte: bqCompte, compte_tiers: '', libelle: `Relevé bancaire ${bqNom} - Prélèvement frais & agios`, debit: '0', credit: '29813' }
      ]);
    } else if (templateName === 'virement_interne') {
      setManualHeader(prev => ({ ...prev, code_journal: 'OD', poste_budgetaire: 'TRESORERIE' }));
      setManualLines([
        { date: curDate, compte: '585000', compte_tiers: '', libelle: 'Virement de fonds interne (Approvisionnement Caisse)', debit: '500000', credit: '0' },
        { date: curDate, compte: '521100', compte_tiers: '', libelle: 'Retrait bancaire pour approvisionnement caisse', debit: '0', credit: '500000' }
      ]);
    }
  };

  const handleIntegratedUpload = async () => {
    if (!uploadFile) {
      setUploadStatus('Veuillez sélectionner un fichier.');
      return;
    }
    setUploadLoading(true);
    setUploadStatus('Importation et contrôle comptable en cours...');
    setUploadImbalance(null);

    const formData = new FormData();
    formData.append('file', uploadFile);
    formData.append('type', uploadType);

    try {
      const res = await fetch('/api/import', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        setUploadStatus(`Succès : ${data.message}`);
        setUploadFile(null);
        setUploadImbalance(null);
        fetchSaisieConfig();
      } else {
        setUploadStatus(`Erreur : ${data.error}`);
        if (data.imbalance) setUploadImbalance(data.imbalance);
      }
    } catch (e) {
      setUploadStatus('Erreur de communication avec le serveur.');
    } finally {
      setUploadLoading(false);
    }
  };

  const handleIntegratedAutoFix = async () => {
    setUploadLoading(true);
    setUploadStatus('Équilibrage en partie double et enregistrement en cours...');
    try {
      const formData = new FormData();
      if (uploadFile) formData.append('file', uploadFile);
      const res = await fetch('/api/import/auto-fix-and-import', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        setUploadStatus(`Succès : ${data.message}`);
        setUploadImbalance(null);
        setUploadFile(null);
        fetchSaisieConfig();
      } else {
        setUploadStatus(`Erreur : ${data.error || 'Erreur lors de la correction.'}`);
      }
    } catch (e) {
      setUploadStatus('Erreur de communication avec le serveur.');
    } finally {
      setUploadLoading(false);
    }
  };

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

  const getOhadaTitle = (compteStr) => {
    return cleanAccountLabel(getAccountLabel(compteStr, customAccounts));
  };

  const totalDebit = manualLines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalCredit = manualLines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const ecart = Math.round((totalDebit - totalCredit) * 100) / 100;
  const isBalanced = Math.abs(ecart) < 0.01 && totalDebit > 0;
  // Le journal Caisse suppose un mouvement de caisse même sans ligne 571100 saisie explicitement :
  // le serveur la complète automatiquement, donc une écriture "déséquilibrée" dans ce cas précis
  // reste soumettable (voir POST /api/journal côté serveur).
  const hasCaisseLine = manualLines.some(l => String(l.compte).startsWith('57'));
  const isCaisseAutoBalance = manualHeader.code_journal === 'CA' && !hasCaisseLine && !isBalanced && (totalDebit > 0 || totalCredit > 0);

  // De même, les journaux bancaires (BQ...) gèrent les opérations issues des relevés bancaires :
  // le compte bancaire relatif au journal sélectionné est mouvementé automatiquement en contrepartie
  // des charges (au Débit) ou des produits (au Crédit) saisis, même sans ligne 52/51 explicitement ajoutée.
  const isBankJournal = /^BQ/i.test(manualHeader.code_journal);
  const hasBankLine = manualLines.some(l => /^(52|51)/.test(String(l.compte || '')));
  const isBankAutoBalance = isBankJournal && !hasBankLine && !isBalanced && (totalDebit > 0 || totalCredit > 0);

  const canSubmit = isBalanced || isCaisseAutoBalance || isBankAutoBalance;

  const updateLine = (idx, patch) => {
    setManualLines(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  };
  const addLine = () => setManualLines(prev => [...prev, emptyLine(manualHeader.date)]);
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

    fetch('/api/grand-livre/tiers')
      .then(res => res.json())
      .then(rows => {
        const list = Array.isArray(rows) ? rows : [];
        setGlTiersList(list);
        if (!glSelectedTier && list.length > 0) setGlSelectedTier(list[0].nom);
      })
      .catch(e => console.error(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'grandlivre') return;
    setSelectedGlIds([]);
    setBulkMsg(null);
    setGlPage(1);

    if (glFilterMode === 'tiers') {
      if (!glSelectedTier) return;
      setGlLoading(true);
      setGlError('');
      setGlLedger(null);
      setGlJournalLedger(null);
      fetch(`/api/grand-livre/par-tiers/${encodeURIComponent(glSelectedTier)}`)
        .then(res => res.json())
        .then(data => {
          if (data.error) { setGlError(data.error); setGlTierLedger(null); }
          else setGlTierLedger(data);
        })
        .catch(() => setGlError('Impossible de charger le Grand Livre Auxiliaire. Vérifiez que le serveur est démarré.'))
        .finally(() => setGlLoading(false));
      return;
    }

    if (glFilterMode === 'journal') {
      if (!glSelectedJournal) return;
      setGlLoading(true);
      setGlError('');
      setGlLedger(null);
      setGlTierLedger(null);
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
    setGlTierLedger(null);
    fetch(`/api/grand-livre/${encodeURIComponent(glSelectedCompte)}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) { setGlError(data.error); setGlLedger(null); }
        else setGlLedger(data);
      })
      .catch(() => setGlError('Impossible de charger le Grand Livre. Vérifiez que le serveur est démarré.'))
      .finally(() => setGlLoading(false));
  }, [glFilterMode, glSelectedCompte, glSelectedJournal, glSelectedTier, activeTab, glRefreshTick]);

  const toggleGlSelected = (id) => {
    const next = selectedGlIds.includes(id) ? selectedGlIds.filter(x => x !== id) : [...selectedGlIds, id];
    setSelectedGlIds(next);

    if (next.length === 1) {
      const allRows = (glLedger?.lignes || []).concat(glJournalLedger?.lignes || []).concat(glTierLedger?.lignes || []);
      const row = allRows.find(l => l.id === next[0]);
      if (row) {
        setGlEditForm({
          date: row.date || '',
          code_journal: row.code_journal || '',
          compte: row.compte || '',
          compte_tiers: row.compte_tiers || '',
          libelle: row.libelle || '',
          n_facture: row.n_facture || '',
          reference: row.reference || '',
          poste_budgetaire: row.poste_budgetaire || '',
          debit: (row.debit !== undefined && row.debit !== null && Number(row.debit) > 0) ? String(row.debit) : '',
          credit: (row.credit !== undefined && row.credit !== null && Number(row.credit) > 0) ? String(row.credit) : ''
        });
      }
    } else if (next.length === 0) {
      setGlEditForm({
        date: '',
        code_journal: '',
        compte: '',
        compte_tiers: '',
        libelle: '',
        n_facture: '',
        reference: '',
        poste_budgetaire: '',
        debit: '',
        credit: ''
      });
    }
  };

  const applyBulkGlUpdate = async () => {
    if (selectedGlIds.length === 0) return;
    setBulkApplying(true);
    setBulkMsg(null);
    try {
      const updates = {};
      const isSingle = selectedGlIds.length === 1;
      const fields = ['date', 'code_journal', 'compte', 'compte_tiers', 'libelle', 'n_facture', 'reference', 'poste_budgetaire', 'debit', 'credit'];

      fields.forEach(f => {
        const val = glEditForm[f];
        if (val !== undefined && val !== null) {
          if (isSingle) {
            updates[f] = val;
          } else if (String(val).trim() !== '') {
            updates[f] = val;
          }
        }
      });

      if (Object.keys(updates).length === 0) {
        setBulkMsg({ type: 'error', text: 'Veuillez renseigner au moins un champ à modifier.' });
        setBulkApplying(false);
        return;
      }

      const res = await adminFetch('/api/journal/bulk-update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedGlIds, updates })
      });
      const result = await res.json();
      if (!res.ok || result.error) {
        setBulkMsg({ type: 'error', text: result.error || 'Erreur lors de la mise à jour.' });
      } else {
        setBulkMsg({ type: 'success', text: `Succès : ${result.changes} écriture(s) mise(s) à jour avec succès.` });
        setSelectedGlIds([]);
        setGlEditForm({ date: '', code_journal: '', compte: '', compte_tiers: '', libelle: '', n_facture: '', reference: '', poste_budgetaire: '', debit: '', credit: '' });
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
    setManualStatus(gridRegleImmediat ? "Enregistrement de l'écriture et de son règlement en 1 Clic..." : "Enregistrement de l'écriture...");
    try {
      const payload = {
        ...manualHeader,
        lines: manualLines.map(l => ({
          ...l,
          date: l.date || manualHeader.date
        })),
        regle_immediat: gridRegleImmediat,
        date_reglement: gridReglement.date_reglement || manualHeader.date,
        mode_reglement: gridReglement.mode_reglement,
        code_journal_reglement: gridReglement.code_journal_reglement,
        compte_tresorerie: gridReglement.compte_tresorerie,
        montant_regle: gridReglement.montant_regle || totalDebit,
        reference_reglement: gridReglement.reference_reglement,
        compte_tiers_reglement: gridReglement.compte_tiers_reglement
      };
      const res = await adminFetch('/api/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        const msgRegle = gridRegleImmediat && data.piece_id_reglement
          ? ` et son règlement en 1 Clic (${(gridReglement.mode_reglement || 'CAISSE').toUpperCase()}${data.code_lettrage ? `, lettrage ${data.code_lettrage}` : ''})`
          : '';
        setManualStatus(`Succès : L'écriture${msgRegle} a été enregistrée au Journal. Apprentissage ML mis à jour 🧠.`);

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

        setManualLines([emptyLine(manualHeader.date), emptyLine(manualHeader.date)]);
        setManualHeader(prev => ({ ...prev, n_facture: '', reference: '' }));
        setGridRegleImmediat(false);
        setGridReglement({
          date_reglement: new Date().toISOString().split('T')[0],
          mode_reglement: 'caisse',
          code_journal_reglement: 'CA',
          compte_tresorerie: saisieConfig?.comptes_caisse?.[0]?.compte || '57111001',
          montant_regle: '',
          reference_reglement: '',
          compte_tiers_reglement: ''
        });
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
      case 'saisie': {
        const expHt = parseFloat(expressForm.montant_ht) || 0;
        const expTva = parseFloat(expressForm.montant_tva) || 0;
        const expTtc = parseFloat(expressForm.montant_ttc) || (expHt + expTva);
        const expRegle = expressForm.regle_immediat ? (parseFloat(expressForm.montant_regle) || expTtc) : 0;
        const isAchat = expressForm.type === 'achat';

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Datalists pour autocomplétion rapide */}
            <datalist id="express-tiers-list">
              {(saisieConfig?.tiers || []).map(t => (
                <option key={t.id || t.nom} value={t.nom}>
                  {t.nom} ({t.type || 'Tiers'} — Compte: {t.compte_comptable || '401/411'})
                </option>
              ))}
            </datalist>

            <datalist id="express-comptes-list">
              {accountOptions.map(a => (
                <option key={a.compte} value={a.compte}>
                  {a.compte} — {a.libelle}
                </option>
              ))}
            </datalist>

            <datalist id="express-treso-list">
              {[
                ...(saisieConfig?.comptes_caisse || []),
                ...(saisieConfig?.comptes_banque || []),
                ...(saisieConfig?.comptes_mobile_money || []),
                ...(saisieConfig?.all_tresorerie || [])
              ].reduce((acc, curr) => {
                if (curr?.compte && !acc.some(x => x.compte === curr.compte)) acc.push(curr);
                return acc;
              }, []).map(a => (
                <option key={a.compte} value={a.compte}>
                  {a.compte} — {cleanAccountLabel(a.libelle)}
                </option>
              ))}
            </datalist>

            {/* Barre de navigation des modes de Saisie */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem',
              padding: '1rem 1.25rem', background: '#f8fafc', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{
                  background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)', color: '#fff',
                  width: '38px', height: '38px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  <Zap size={20} />
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--color-primary-dark)' }}>
                    Module Saisie & Upload Comptable
                  </h4>
                  <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                    Enregistrement de factures, règlements en 1 clic, écritures libres ou import de fichiers
                  </span>
                </div>
              </div>

              {/* Boutons de bascule de sous-mode */}
              <div style={{ display: 'flex', gap: '0.5rem', background: '#e2e8f0', padding: '0.25rem', borderRadius: 'var(--radius-md)' }}>
                <button
                  type="button"
                  onClick={() => setSaisieSubMode('express')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.45rem 0.9rem',
                    border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
                    background: saisieSubMode === 'express' ? '#ffffff' : 'transparent',
                    color: saisieSubMode === 'express' ? 'var(--color-primary-dark)' : 'var(--color-text-muted)',
                    boxShadow: saisieSubMode === 'express' ? '0 2px 6px rgba(0,0,0,0.08)' : 'none'
                  }}
                >
                  <Zap size={15} color={saisieSubMode === 'express' ? 'var(--color-primary)' : 'currentColor'} />
                  ⚡ Facture & Règlement (1 Clic)
                </button>

                <button
                  type="button"
                  onClick={() => setSaisieSubMode('libre')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.45rem 0.9rem',
                    border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
                    background: saisieSubMode === 'libre' ? '#ffffff' : 'transparent',
                    color: saisieSubMode === 'libre' ? 'var(--color-primary-dark)' : 'var(--color-text-muted)',
                    boxShadow: saisieSubMode === 'libre' ? '0 2px 6px rgba(0,0,0,0.08)' : 'none'
                  }}
                >
                  <FileText size={15} />
                  📝 Saisie Grille / OD et Règlement en 1 Clic
                </button>

                <button
                  type="button"
                  onClick={() => setSaisieSubMode('upload')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.45rem 0.9rem',
                    border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
                    background: saisieSubMode === 'upload' ? '#ffffff' : 'transparent',
                    color: saisieSubMode === 'upload' ? 'var(--color-primary-dark)' : 'var(--color-text-muted)',
                    boxShadow: saisieSubMode === 'upload' ? '0 2px 6px rgba(0,0,0,0.08)' : 'none'
                  }}
                >
                  <UploadCloud size={15} />
                  📁 Upload & Import Fichiers
                </button>
              </div>
            </div>

            {/* ======================================================== */}
            {/* MODE 1 : SAISIE EXPRESS FACTURE & RÈGLEMENT (1 CLIC)    */}
            {/* ======================================================== */}
            {saisieSubMode === 'express' && (
              <form onSubmit={handleExpressSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                
                {/* Sélecteur Achat / Vente */}
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-text-main)' }}>Type d'opération :</span>
                  <button
                    type="button"
                    onClick={() => updateExpress('type', 'achat')}
                    style={{
                      flex: 1, minWidth: '220px', padding: '0.75rem 1.25rem', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                      border: isAchat ? '2px solid #2563eb' : '1px solid var(--color-border)',
                      background: isAchat ? '#eff6ff' : '#ffffff',
                      color: isAchat ? '#1d4ed8' : 'var(--color-text-muted)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem',
                      fontWeight: 700, fontSize: '0.95rem', transition: 'all 0.2s'
                    }}
                  >
                    <ArrowDownLeft size={20} color={isAchat ? '#2563eb' : '#64748b'} />
                    🧾 Facture d'Achat (Fournisseur / Charge)
                  </button>

                  <button
                    type="button"
                    onClick={() => updateExpress('type', 'vente')}
                    style={{
                      flex: 1, minWidth: '220px', padding: '0.75rem 1.25rem', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                      border: !isAchat ? '2px solid #059669' : '1px solid var(--color-border)',
                      background: !isAchat ? '#f0fdf4' : '#ffffff',
                      color: !isAchat ? '#047857' : 'var(--color-text-muted)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem',
                      fontWeight: 700, fontSize: '0.95rem', transition: 'all 0.2s'
                    }}
                  >
                    <ArrowUpRight size={20} color={!isAchat ? '#059669' : '#64748b'} />
                    💰 Facture de Vente (Client / Prestation)
                  </button>
                </div>

                {/* Grille principale : Facture (Gauche) + Règlement en 1 Clic (Droite) */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.25rem' }}>
                  
                  {/* CARTE GAUCHE : DONNÉES FACTURE */}
                  <div style={{
                    background: '#ffffff', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)',
                    padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem', boxShadow: '0 4px 12px rgba(0,0,0,0.03)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', pb: '0.5rem', paddingBottom: '0.5rem' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.95rem', color: isAchat ? '#1e40af' : '#065f46', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <FileText size={18} />
                        Détails de la Facture
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <label style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Journal :</label>
                        <select
                          className="input"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', width: 'auto' }}
                          value={expressForm.code_journal_facture}
                          onChange={e => updateExpress('code_journal_facture', e.target.value)}
                        >
                          {(isAchat ? (saisieConfig?.journaux_achats || ['AC', 'ACH']) : (saisieConfig?.journaux_ventes || ['VE', 'VTE'])).map(j => (
                            <option key={j} value={j}>{j}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Date Facture + Échéance + N° Facture */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.2rem', fontSize: '0.75rem', fontWeight: 600 }}>Date Facture *</label>
                        <input
                          type="date"
                          className="input"
                          style={{ padding: '0.45rem', fontSize: '0.85rem' }}
                          value={expressForm.date_facture}
                          onChange={e => updateExpress('date_facture', e.target.value)}
                          required
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.2rem', fontSize: '0.75rem', fontWeight: 600 }}>N° Facture *</label>
                        <input
                          type="text"
                          className="input"
                          style={{ padding: '0.45rem', fontSize: '0.85rem' }}
                          placeholder="Ex: FA-2026-001"
                          value={expressForm.n_facture}
                          onChange={e => updateExpress('n_facture', e.target.value)}
                          required
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.2rem', fontSize: '0.75rem', fontWeight: 600 }}>Réf. Externe</label>
                        <input
                          type="text"
                          className="input"
                          style={{ padding: '0.45rem', fontSize: '0.85rem' }}
                          placeholder="BC / BL / Bon"
                          value={expressForm.reference}
                          onChange={e => updateExpress('reference', e.target.value)}
                        />
                      </div>
                    </div>

                    {/* Tiers (Nom + Compte) */}
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.5rem' }}>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.2rem', fontSize: '0.75rem', fontWeight: 600 }}>
                          {isAchat ? 'Fournisseur *' : 'Client / Tiers *'}
                        </label>
                        <input
                          type="text"
                          className="input"
                          list="express-tiers-list"
                          style={{ padding: '0.45rem', fontSize: '0.85rem' }}
                          placeholder={isAchat ? "Nom du Fournisseur" : "Nom du Client"}
                          value={expressForm.tiers_nom}
                          onChange={e => {
                            const val = e.target.value;
                            updateExpress('tiers_nom', val);
                            const found = (saisieConfig?.tiers || []).find(t => t.nom.toLowerCase() === val.trim().toLowerCase());
                            if (found && found.compte_comptable) {
                              updateExpress('tiers_compte', found.compte_comptable);
                            }
                          }}
                          required
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.2rem', fontSize: '0.75rem', fontWeight: 600 }}>Compte Tiers</label>
                        <input
                          type="text"
                          className="input"
                          list="express-comptes-list"
                          style={{ padding: '0.45rem', fontSize: '0.85rem' }}
                          value={expressForm.tiers_compte}
                          onChange={e => updateExpress('tiers_compte', e.target.value)}
                          placeholder={isAchat ? "401100" : "411100"}
                        />
                      </div>
                    </div>

                    {/* Compte Charge / Produit + Libellé */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                        <label style={{ fontSize: '0.75rem', fontWeight: 600 }}>
                          {isAchat ? 'Compte de Charge (Classe 6) *' : 'Compte de Produit (Classe 7) *'}
                        </label>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-primary)', fontWeight: 500 }}>
                          {getOhadaTitle(expressForm.compte_charge_produit) || ''}
                        </span>
                      </div>
                      <input
                        type="text"
                        className="input"
                        list="express-comptes-list"
                        style={{ padding: '0.45rem', fontSize: '0.85rem', width: '100%' }}
                        placeholder={isAchat ? "Ex: 601100, 604100..." : "Ex: 706100, 701100..."}
                        value={expressForm.compte_charge_produit}
                        onChange={e => updateExpress('compte_charge_produit', e.target.value)}
                        required
                      />

                      {/* Suggestions rapides de comptes */}
                      <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.35rem', flexWrap: 'wrap' }}>
                        {(isAchat 
                          ? (saisieConfig?.comptes_achats?.slice(0, 4) || [{ compte: '601100', libelle: 'Marchandises' }, { compte: '604100', libelle: 'Services' }, { compte: '605100', libelle: 'Fournitures' }])
                          : (saisieConfig?.comptes_ventes?.slice(0, 4) || [{ compte: '706100', libelle: 'Prestations de soins' }, { compte: '701100', libelle: 'Ventes marchandises' }])
                        ).map(sug => (
                          <button
                            key={sug.compte}
                            type="button"
                            onClick={() => updateExpress('compte_charge_produit', sug.compte)}
                            style={{
                              background: expressForm.compte_charge_produit === sug.compte ? '#dbeafe' : '#f1f5f9',
                              border: '1px solid #cbd5e1', borderRadius: '4px', padding: '0.15rem 0.4rem',
                              fontSize: '0.72rem', cursor: 'pointer', color: '#1e293b'
                            }}
                          >
                            {sug.compte} {sug.libelle ? `(${sug.libelle.substring(0, 15)})` : ''}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Libellé */}
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.2rem', fontSize: '0.75rem', fontWeight: 600 }}>Désignation / Libellé de l'opération *</label>
                      <input
                        type="text"
                        className="input"
                        style={{ padding: '0.45rem', fontSize: '0.85rem' }}
                        placeholder="Ex: Achat consommables de radiologie"
                        value={expressForm.libelle}
                        onChange={e => updateExpress('libelle', e.target.value)}
                        required
                      />
                    </div>

                    {/* Montants & TVA */}
                    <div style={{ background: '#f8fafc', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid #e2e8f0', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.2rem', fontSize: '0.75rem', fontWeight: 600 }}>Montant HT (FCFA) *</label>
                        <input
                          type="number"
                          step="0.01"
                          className="input"
                          style={{ padding: '0.45rem', fontSize: '0.9rem', fontWeight: 700 }}
                          placeholder="0"
                          value={expressForm.montant_ht}
                          onChange={e => updateExpress('montant_ht', e.target.value)}
                          required
                        />
                      </div>

                      <div>
                        <label style={{ display: 'block', marginBottom: '0.2rem', fontSize: '0.75rem', fontWeight: 600 }}>
                          Taux TVA
                        </label>
                        <div style={{ display: 'flex', gap: '0.25rem' }}>
                          <button
                            type="button"
                            onClick={() => updateExpress('taux_tva', 19.25)}
                            style={{
                              flex: 1, padding: '0.35rem 0.2rem', fontSize: '0.72rem', fontWeight: 600,
                              borderRadius: '4px', border: '1px solid #cbd5e1', cursor: 'pointer',
                              background: Number(expressForm.taux_tva) === 19.25 ? '#2563eb' : '#fff',
                              color: Number(expressForm.taux_tva) === 19.25 ? '#fff' : '#1e293b'
                            }}
                          >
                            19.25%
                          </button>
                          <button
                            type="button"
                            onClick={() => updateExpress('taux_tva', 0)}
                            style={{
                              flex: 1, padding: '0.35rem 0.2rem', fontSize: '0.72rem', fontWeight: 600,
                              borderRadius: '4px', border: '1px solid #cbd5e1', cursor: 'pointer',
                              background: Number(expressForm.taux_tva) === 0 ? '#10b981' : '#fff',
                              color: Number(expressForm.taux_tva) === 0 ? '#fff' : '#1e293b'
                            }}
                          >
                            0% (Exo)
                          </button>
                        </div>
                        <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', display: 'block', marginTop: '0.2rem' }}>
                          TVA: {(expTva || 0).toLocaleString()} FCFA
                        </span>
                      </div>

                      <div>
                        <label style={{ display: 'block', marginBottom: '0.2rem', fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-primary-dark)' }}>Total TTC (FCFA)</label>
                        <input
                          type="number"
                          step="0.01"
                          className="input"
                          style={{ padding: '0.45rem', fontSize: '1rem', fontWeight: 800, color: 'var(--color-primary-dark)', background: '#eff6ff' }}
                          value={expressForm.montant_ttc}
                          onChange={e => updateExpress('montant_ttc', e.target.value)}
                        />
                      </div>
                    </div>

                  </div>

                  {/* CARTE DROITE : RÈGLEMENT IMMÉDIAT EN 1 CLIC */}
                  <div style={{
                    background: expressForm.regle_immediat ? '#ffffff' : '#f8fafc',
                    borderRadius: 'var(--radius-lg)',
                    border: expressForm.regle_immediat ? '2px solid #3b82f6' : '1px dashed var(--color-border)',
                    padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem',
                    boxShadow: expressForm.regle_immediat ? '0 6px 18px rgba(59,130,246,0.1)' : 'none',
                    transition: 'all 0.2s'
                  }}>
                    
                    {/* Interrupteur Règlement en 1 Clic */}
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '0.75rem', borderRadius: 'var(--radius-md)',
                      background: expressForm.regle_immediat ? 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)' : '#e2e8f0',
                      border: '1px solid #bfdbfe'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Zap size={20} color={expressForm.regle_immediat ? '#2563eb' : '#64748b'} />
                        <div>
                          <strong style={{ fontSize: '0.9rem', color: expressForm.regle_immediat ? '#1e40af' : '#475569' }}>
                            ⚡ Règlement Immédiat en 1 Clic
                          </strong>
                          <span style={{ display: 'block', fontSize: '0.75rem', color: expressForm.regle_immediat ? '#3b82f6' : '#64748b' }}>
                            Génère l'écriture de caisse/banque & lettrage automatique
                          </span>
                        </div>
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={expressForm.regle_immediat}
                          onChange={e => updateExpress('regle_immediat', e.target.checked)}
                          style={{ width: '20px', height: '20px', cursor: 'pointer', accentColor: '#2563eb' }}
                        />
                      </label>
                    </div>

                    {expressForm.regle_immediat ? (
                      <>
                        {/* Mode Caisse vs Banque vs Mobile Money */}
                        <div>
                          <label style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.75rem', fontWeight: 600 }}>Mode de Règlement *</label>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.4rem' }}>
                            <button
                              type="button"
                              onClick={() => updateExpress('mode_reglement', 'caisse')}
                              style={{
                                padding: '0.55rem 0.4rem', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                                border: expressForm.mode_reglement === 'caisse' ? '2px solid #d97706' : '1px solid #cbd5e1',
                                background: expressForm.mode_reglement === 'caisse' ? '#fffbe8' : '#ffffff',
                                color: expressForm.mode_reglement === 'caisse' ? '#b45309' : '#64748b',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem',
                                fontWeight: 700, fontSize: '0.8rem'
                              }}
                            >
                              <Banknote size={15} /> 💵 Caisse
                            </button>

                            <button
                              type="button"
                              onClick={() => updateExpress('mode_reglement', 'banque')}
                              style={{
                                padding: '0.55rem 0.4rem', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                                border: expressForm.mode_reglement === 'banque' ? '2px solid #2563eb' : '1px solid #cbd5e1',
                                background: expressForm.mode_reglement === 'banque' ? '#eff6ff' : '#ffffff',
                                color: expressForm.mode_reglement === 'banque' ? '#1d4ed8' : '#64748b',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem',
                                fontWeight: 700, fontSize: '0.8rem'
                              }}
                            >
                              <CreditCard size={15} /> 🏦 Banque
                            </button>

                            <button
                              type="button"
                              onClick={() => updateExpress('mode_reglement', 'mobile_money')}
                              style={{
                                padding: '0.55rem 0.4rem', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                                border: expressForm.mode_reglement === 'mobile_money' ? '2px solid #059669' : '1px solid #cbd5e1',
                                background: expressForm.mode_reglement === 'mobile_money' ? '#f0fdf4' : '#ffffff',
                                color: expressForm.mode_reglement === 'mobile_money' ? '#047857' : '#64748b',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem',
                                fontWeight: 700, fontSize: '0.8rem'
                              }}
                            >
                              📱 Mobile Money
                            </button>
                          </div>
                        </div>

                        {/* Journal et Compte de Trésorerie */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.5rem' }}>
                          <div>
                            <label style={{ display: 'block', marginBottom: '0.2rem', fontSize: '0.75rem', fontWeight: 600 }}>Code Journal</label>
                            <select
                              className="input"
                              style={{ padding: '0.45rem', fontSize: '0.85rem', width: '100%' }}
                              value={expressForm.code_journal_reglement}
                              onChange={e => updateExpress('code_journal_reglement', e.target.value)}
                            >
                              <optgroup label="Journaux recommandés">
                                {(expressForm.mode_reglement === 'caisse' 
                                  ? (saisieConfig?.journaux_caisse || ['CA', 'CAISPR'])
                                  : expressForm.mode_reglement === 'mobile_money'
                                  ? (saisieConfig?.journaux_caisse || saisieConfig?.journaux_od || ['CA', 'OD'])
                                  : (saisieConfig?.journaux_banque || ['BQ'])
                                ).map(j => (
                                  <option key={j} value={j}>{j}</option>
                                ))}
                              </optgroup>
                              <optgroup label="Tous les journaux">
                                {(saisieConfig?.all_journals || ['CA', 'BQ', 'OD', 'AC', 'VE']).map(j => (
                                  <option key={'all-' + j} value={j}>{j}</option>
                                ))}
                              </optgroup>
                            </select>
                          </div>

                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                              <label style={{ fontSize: '0.75rem', fontWeight: 600 }}>Compte Trésorerie *</label>
                              <span style={{ fontSize: '0.78rem', color: '#1d4ed8', fontWeight: 700 }}>
                                {getOhadaTitle(expressForm.compte_tresorerie) || ''}
                              </span>
                            </div>

                            <div style={{ display: 'flex', gap: '0.3rem' }}>
                              <input
                                type="text"
                                className="input"
                                list="express-treso-list"
                                style={{ padding: '0.45rem', fontSize: '0.85rem', flex: 1, fontWeight: 700 }}
                                placeholder="N° Compte (ex: 57111001, 521100...)"
                                value={expressForm.compte_tresorerie}
                                onChange={e => updateExpress('compte_tresorerie', e.target.value)}
                                required
                              />

                              <select
                                className="input"
                                style={{ padding: '0.45rem 0.2rem', fontSize: '0.75rem', width: '38px', cursor: 'pointer' }}
                                value=""
                                title="Choisir dans la liste complète de trésorerie"
                                onChange={e => { if (e.target.value) updateExpress('compte_tresorerie', e.target.value); }}
                              >
                                <option value="">▼</option>
                                <optgroup label="Comptes Caisse de la Balance (57...)">
                                  {(saisieConfig?.comptes_caisse || []).map(acc => (
                                    <option key={'c-' + acc.compte} value={acc.compte}>
                                      {acc.compte} — {cleanAccountLabel(acc.libelle || getOhadaTitle(acc.compte))} {acc.solde !== undefined ? `(${Number(acc.solde).toLocaleString('fr-FR')} FCFA)` : ''}
                                    </option>
                                  ))}
                                </optgroup>
                                <optgroup label="Comptes Banque de la Balance (52... / 51...)">
                                  {(saisieConfig?.comptes_banque || []).map(acc => (
                                    <option key={'b-' + acc.compte} value={acc.compte}>
                                      {acc.compte} — {cleanAccountLabel(acc.libelle || getOhadaTitle(acc.compte))} {acc.solde !== undefined ? `(${Number(acc.solde).toLocaleString('fr-FR')} FCFA)` : ''}
                                    </option>
                                  ))}
                                </optgroup>
                                <optgroup label="Mobile Money & Portefeuilles (55...)">
                                  {(saisieConfig?.comptes_mobile_money || []).map(acc => (
                                    <option key={'m-' + acc.compte} value={acc.compte}>
                                      {acc.compte} — {cleanAccountLabel(acc.libelle || getOhadaTitle(acc.compte))} {acc.solde !== undefined && Number(acc.solde) !== 0 ? `(${Number(acc.solde).toLocaleString('fr-FR')} FCFA)` : ''}
                                    </option>
                                  ))}
                                </optgroup>
                                <optgroup label="Tous les comptes de trésorerie (Classe 5)">
                                  {(saisieConfig?.all_tresorerie || []).filter(acc => {
                                    const c = acc.compte;
                                    const inCaisse = (saisieConfig?.comptes_caisse || []).some(x => x.compte === c);
                                    const inBanque = (saisieConfig?.comptes_banque || []).some(x => x.compte === c);
                                    const inMomo = (saisieConfig?.comptes_mobile_money || []).some(x => x.compte === c);
                                    return !inCaisse && !inBanque && !inMomo;
                                  }).map(acc => (
                                    <option key={'all-t-' + acc.compte} value={acc.compte}>
                                      {acc.compte} — {cleanAccountLabel(acc.libelle || getOhadaTitle(acc.compte))}
                                    </option>
                                  ))}
                                </optgroup>
                              </select>
                            </div>

                            {/* Suggestions rapides des comptes réels de la balance */}
                            <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
                              {(expressForm.mode_reglement === 'caisse'
                                ? (saisieConfig?.comptes_caisse || [{ compte: '57111001', libelle: 'CAISSE PRINCIPALE' }])
                                : expressForm.mode_reglement === 'mobile_money'
                                ? (saisieConfig?.comptes_mobile_money || [{ compte: '55410001', libelle: 'ORANGE MONEY SIM 1' }, { compte: '55420001', libelle: 'MTN MONEY SIM 1' }])
                                : (saisieConfig?.comptes_banque || [{ compte: '52110017', libelle: 'UNICS' }])
                              ).map(sug => {
                                const isSelected = String(expressForm.compte_tresorerie).trim() === String(sug.compte).trim();
                                const cleanName = cleanAccountLabel(sug.libelle || getOhadaTitle(sug.compte));
                                return (
                                  <button
                                    key={sug.compte}
                                    type="button"
                                    onClick={() => updateExpress('compte_tresorerie', sug.compte)}
                                    style={{
                                      background: isSelected ? 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)' : '#ffffff',
                                      border: isSelected ? '1.5px solid #2563eb' : '1px solid #cbd5e1',
                                      borderRadius: '6px', padding: '0.25rem 0.5rem',
                                      fontSize: '0.72rem', cursor: 'pointer',
                                      color: isSelected ? '#1e40af' : '#1e293b',
                                      fontWeight: isSelected ? 700 : 500,
                                      boxShadow: isSelected ? '0 2px 4px rgba(37,99,235,0.15)' : 'none',
                                      display: 'inline-flex', alignItems: 'center', gap: '0.3rem'
                                    }}
                                    title={`${sug.compte} : ${cleanName}${sug.solde !== undefined ? ` (Solde: ${Number(sug.solde).toLocaleString('fr-FR')} FCFA)` : ''}`}
                                  >
                                    <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{sug.compte}</span>
                                    <span>{cleanName}</span>
                                    {sug.solde !== undefined && Number(sug.solde) !== 0 && (
                                      <span style={{ fontSize: '0.65rem', fontWeight: 600, color: sug.solde < 0 ? '#b91c1c' : '#047857' }}>
                                        ({Number(sug.solde).toLocaleString('fr-FR')} F)
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>

                        {/* Date Règlement + Montant Réglé */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                          <div>
                            <label style={{ display: 'block', marginBottom: '0.2rem', fontSize: '0.75rem', fontWeight: 600 }}>Date Règlement</label>
                            <input
                              type="date"
                              className="input"
                              style={{ padding: '0.45rem', fontSize: '0.85rem' }}
                              value={expressForm.date_reglement}
                              onChange={e => updateExpress('date_reglement', e.target.value)}
                            />
                          </div>

                          <div>
                            <label style={{ display: 'block', marginBottom: '0.2rem', fontSize: '0.75rem', fontWeight: 600 }}>Montant Réglé (FCFA)</label>
                            <input
                              type="number"
                              step="0.01"
                              className="input"
                              style={{ padding: '0.45rem', fontSize: '0.9rem', fontWeight: 700 }}
                              placeholder="Montant TTC"
                              value={expressForm.montant_regle}
                              onChange={e => updateExpress('montant_regle', e.target.value)}
                            />
                          </div>
                        </div>

                        {/* Référence Règlement */}
                        <div>
                          <label style={{ display: 'block', marginBottom: '0.2rem', fontSize: '0.75rem', fontWeight: 600 }}>Pièce Règlement (N° Reçu / Chèque)</label>
                          <input
                            type="text"
                            className="input"
                            style={{ padding: '0.45rem', fontSize: '0.85rem' }}
                            placeholder={expressForm.mode_reglement === 'caisse' ? "Reçu de caisse N°..." : "N° Chèque ou Réf Virement"}
                            value={expressForm.reference_reglement}
                            onChange={e => updateExpress('reference_reglement', e.target.value)}
                          />
                        </div>

                        {/* Lettrage Info */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: '#15803d', background: '#f0fdf4', padding: '0.4rem 0.6rem', borderRadius: '4px' }}>
                          <ShieldCheck size={16} />
                          <span>
                            {expRegle >= expTtc && expTtc > 0
                              ? "Facture soldée à 100% : un code de lettrage automatique sera apposé."
                              : expRegle > 0
                              ? `Règlement partiel : solde restant dû = ${(expTtc - expRegle).toLocaleString()} FCFA.`
                              : "En attente de saisie du montant réglé."}
                          </span>
                        </div>
                      </>
                    ) : (
                      <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                        <Info size={32} style={{ margin: '0 auto 0.5rem', opacity: 0.5 }} />
                        <p style={{ margin: 0, fontWeight: 500 }}>Facture enregistrée à terme (non réglée immédiatement)</p>
                        <span style={{ fontSize: '0.75rem', marginTop: '0.25rem', display: 'block' }}>
                          Une dette ou créance sera créée au compte de tiers {expressForm.tiers_compte || '401/411'}.
                        </span>
                      </div>
                    )}

                  </div>
                </div>

                {/* ======================================================== */}
                {/* APERÇU DU SCHÉMA COMPTABLE EN PARTIE DOUBLE              */}
                {/* ======================================================== */}
                <div style={{
                  background: '#f8fafc', borderRadius: 'var(--radius-lg)', border: '1px solid #cbd5e1',
                  padding: '1rem 1.25rem'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, fontSize: '0.85rem', color: '#334155' }}>
                      <Table size={16} color="var(--color-primary)" />
                      Aperçu des Écritures Comptables qui seront générées en base
                    </div>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#15803d', background: '#dcfce7', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                      ✓ Partie double équilibrée (SYSCOHADA)
                    </span>
                  </div>

                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', background: '#ffffff', borderRadius: '6px', overflow: 'hidden' }}>
                      <thead>
                        <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #cbd5e1', textAlign: 'left', color: '#475569' }}>
                          <th style={{ padding: '0.4rem 0.6rem' }}>Écriture / Journal</th>
                          <th style={{ padding: '0.4rem 0.6rem' }}>Date</th>
                          <th style={{ padding: '0.4rem 0.6rem' }}>Compte</th>
                          <th style={{ padding: '0.4rem 0.6rem' }}>Intitulé OHADA</th>
                          <th style={{ padding: '0.4rem 0.6rem' }}>Tiers</th>
                          <th style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>Débit</th>
                          <th style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>Crédit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* 1. FACTURE */}
                        {isAchat ? (
                          <>
                            <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                              <td rowSpan={expTva > 0 ? 3 : 2} style={{ padding: '0.5rem', fontWeight: 700, verticalAlign: 'top', background: '#eff6ff', color: '#1d4ed8' }}>
                                Facture Achat<br />
                                <span style={{ fontSize: '0.7rem', fontWeight: 500, color: '#64748b' }}>Journal [{expressForm.code_journal_facture || 'AC'}]</span>
                              </td>
                              <td style={{ padding: '0.4rem 0.6rem' }}>{expressForm.date_facture}</td>
                              <td style={{ padding: '0.4rem 0.6rem', fontWeight: 600 }}>{expressForm.compte_charge_produit || '601100'}</td>
                              <td style={{ padding: '0.4rem 0.6rem' }}>{expressForm.libelle || getOhadaTitle(expressForm.compte_charge_produit) || 'Charge'}</td>
                              <td style={{ padding: '0.4rem 0.6rem' }}>{expressForm.tiers_nom || '-'}</td>
                              <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>{expHt.toLocaleString()}</td>
                              <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>-</td>
                            </tr>
                            {expTva > 0 && (
                              <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                                <td style={{ padding: '0.4rem 0.6rem' }}>{expressForm.date_facture}</td>
                                <td style={{ padding: '0.4rem 0.6rem', fontWeight: 600 }}>445100</td>
                                <td style={{ padding: '0.4rem 0.6rem' }}>TVA déductible sur achats ({expressForm.taux_tva}%)</td>
                                <td style={{ padding: '0.4rem 0.6rem' }}>{expressForm.tiers_nom || '-'}</td>
                                <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>{expTva.toLocaleString()}</td>
                                <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>-</td>
                              </tr>
                            )}
                            <tr style={{ borderBottom: '2px solid #cbd5e1' }}>
                              <td style={{ padding: '0.4rem 0.6rem' }}>{expressForm.date_facture}</td>
                              <td style={{ padding: '0.4rem 0.6rem', fontWeight: 600 }}>{expressForm.tiers_compte || '401100'}</td>
                              <td style={{ padding: '0.4rem 0.6rem' }}>Fournisseurs d'exploitation</td>
                              <td style={{ padding: '0.4rem 0.6rem' }}>{expressForm.tiers_nom || '-'}</td>
                              <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>-</td>
                              <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', fontWeight: 700, color: '#2563eb' }}>{expTtc.toLocaleString()}</td>
                            </tr>
                          </>
                        ) : (
                          <>
                            <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                              <td rowSpan={expTva > 0 ? 3 : 2} style={{ padding: '0.5rem', fontWeight: 700, verticalAlign: 'top', background: '#f0fdf4', color: '#047857' }}>
                                Facture Vente<br />
                                <span style={{ fontSize: '0.7rem', fontWeight: 500, color: '#64748b' }}>Journal [{expressForm.code_journal_facture || 'VE'}]</span>
                              </td>
                              <td style={{ padding: '0.4rem 0.6rem' }}>{expressForm.date_facture}</td>
                              <td style={{ padding: '0.4rem 0.6rem', fontWeight: 600 }}>{expressForm.tiers_compte || '411100'}</td>
                              <td style={{ padding: '0.4rem 0.6rem' }}>Clients d'exploitation</td>
                              <td style={{ padding: '0.4rem 0.6rem' }}>{expressForm.tiers_nom || '-'}</td>
                              <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>{expTtc.toLocaleString()}</td>
                              <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>-</td>
                            </tr>
                            <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                              <td style={{ padding: '0.4rem 0.6rem' }}>{expressForm.date_facture}</td>
                              <td style={{ padding: '0.4rem 0.6rem', fontWeight: 600 }}>{expressForm.compte_charge_produit || '706100'}</td>
                              <td style={{ padding: '0.4rem 0.6rem' }}>{expressForm.libelle || getOhadaTitle(expressForm.compte_charge_produit) || 'Vente'}</td>
                              <td style={{ padding: '0.4rem 0.6rem' }}>{expressForm.tiers_nom || '-'}</td>
                              <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>-</td>
                              <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', fontWeight: 700, color: '#2563eb' }}>{expHt.toLocaleString()}</td>
                            </tr>
                            {expTva > 0 && (
                              <tr style={{ borderBottom: '2px solid #cbd5e1' }}>
                                <td style={{ padding: '0.4rem 0.6rem' }}>{expressForm.date_facture}</td>
                                <td style={{ padding: '0.4rem 0.6rem', fontWeight: 600 }}>443100</td>
                                <td style={{ padding: '0.4rem 0.6rem' }}>TVA facturée sur ventes ({expressForm.taux_tva}%)</td>
                                <td style={{ padding: '0.4rem 0.6rem' }}>{expressForm.tiers_nom || '-'}</td>
                                <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>-</td>
                                <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', fontWeight: 700, color: '#2563eb' }}>{expTva.toLocaleString()}</td>
                              </tr>
                            )}
                          </>
                        )}

                        {/* 2. RÈGLEMENT LIÉ (SI ACTIVÉ) */}
                        {expressForm.regle_immediat && expRegle > 0 && (
                          isAchat ? (
                            <>
                              <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                                <td rowSpan={2} style={{ padding: '0.5rem', fontWeight: 700, verticalAlign: 'top', background: '#fffbe8', color: '#b45309' }}>
                                  Règlement Lié<br />
                                  <span style={{ fontSize: '0.7rem', fontWeight: 500, color: '#64748b' }}>Journal [{expressForm.code_journal_reglement || 'CA'}]</span>
                                </td>
                                <td style={{ padding: '0.4rem 0.6rem' }}>{expressForm.date_reglement || expressForm.date_facture}</td>
                                <td style={{ padding: '0.4rem 0.6rem', fontWeight: 600 }}>{expressForm.tiers_compte || '401100'}</td>
                                <td style={{ padding: '0.4rem 0.6rem' }}>Règlement Fournisseur (dette apurée)</td>
                                <td style={{ padding: '0.4rem 0.6rem' }}>{expressForm.tiers_nom || '-'}</td>
                                <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>{expRegle.toLocaleString()}</td>
                                <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>-</td>
                              </tr>
                              <tr>
                                <td style={{ padding: '0.4rem 0.6rem' }}>{expressForm.date_reglement || expressForm.date_facture}</td>
                                <td style={{ padding: '0.4rem 0.6rem', fontWeight: 600 }}>{expressForm.compte_tresorerie || (expressForm.mode_reglement === 'banque' ? '52110017' : expressForm.mode_reglement === 'mobile_money' ? '55410001' : '57111001')}</td>
                                <td style={{ padding: '0.4rem 0.6rem' }}>{expressForm.mode_reglement === 'banque' ? 'Banque' : expressForm.mode_reglement === 'mobile_money' ? 'Mobile Money' : 'Caisse'} - {getOhadaTitle(expressForm.compte_tresorerie) || 'Trésorerie'} (décaissement)</td>
                                <td style={{ padding: '0.4rem 0.6rem' }}>{expressForm.tiers_nom || '-'}</td>
                                <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>-</td>
                                <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', fontWeight: 700, color: '#2563eb' }}>{expRegle.toLocaleString()}</td>
                              </tr>
                            </>
                          ) : (
                            <>
                              <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                                <td rowSpan={2} style={{ padding: '0.5rem', fontWeight: 700, verticalAlign: 'top', background: '#fffbe8', color: '#b45309' }}>
                                  Encaissement Lié<br />
                                  <span style={{ fontSize: '0.7rem', fontWeight: 500, color: '#64748b' }}>Journal [{expressForm.code_journal_reglement || 'CA'}]</span>
                                </td>
                                <td style={{ padding: '0.4rem 0.6rem' }}>{expressForm.date_reglement || expressForm.date_facture}</td>
                                <td style={{ padding: '0.4rem 0.6rem', fontWeight: 600 }}>{expressForm.compte_tresorerie || (expressForm.mode_reglement === 'banque' ? '52110017' : expressForm.mode_reglement === 'mobile_money' ? '55410001' : '57111001')}</td>
                                <td style={{ padding: '0.4rem 0.6rem' }}>{expressForm.mode_reglement === 'banque' ? 'Banque' : expressForm.mode_reglement === 'mobile_money' ? 'Mobile Money' : 'Caisse'} - {getOhadaTitle(expressForm.compte_tresorerie) || 'Trésorerie'} (encaissement)</td>
                                <td style={{ padding: '0.4rem 0.6rem' }}>{expressForm.tiers_nom || '-'}</td>
                                <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>{expRegle.toLocaleString()}</td>
                                <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>-</td>
                              </tr>
                              <tr>
                                <td style={{ padding: '0.4rem 0.6rem' }}>{expressForm.date_reglement || expressForm.date_facture}</td>
                                <td style={{ padding: '0.4rem 0.6rem', fontWeight: 600 }}>{expressForm.tiers_compte || '411100'}</td>
                                <td style={{ padding: '0.4rem 0.6rem' }}>Client (créance soldée)</td>
                                <td style={{ padding: '0.4rem 0.6rem' }}>{expressForm.tiers_nom || '-'}</td>
                                <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>-</td>
                                <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', fontWeight: 700, color: '#2563eb' }}>{expRegle.toLocaleString()}</td>
                              </tr>
                            </>
                          )
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Bouton d'action principal */}
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={expressLoading}
                    style={{
                      flex: 1, padding: '0.85rem 1.5rem', fontSize: '1rem', fontWeight: 700,
                      background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem',
                      boxShadow: '0 4px 15px rgba(37,99,235,0.3)', cursor: expressLoading ? 'not-allowed' : 'pointer'
                    }}
                  >
                    <Zap size={20} />
                    {expressLoading 
                      ? "Enregistrement en cours..." 
                      : expressForm.regle_immediat 
                        ? "⚡ Enregistrer la Facture & le Règlement en 1 Clic" 
                        : "Enregistrer la Facture (Non réglée)"}
                  </button>
                </div>

                {/* Notifications de résultat */}
                {expressResult && (
                  <div style={{
                    padding: '1rem 1.25rem', borderRadius: 'var(--radius-md)',
                    background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
                      <CheckCircle size={22} color="#16a34a" />
                      <div>
                        <div>{expressResult.message}</div>
                        {expressResult.lettrage && (
                          <span style={{ fontSize: '0.8rem', color: '#166534', fontWeight: 500 }}>
                            Code de lettrage créé : <strong>{expressResult.lettrage}</strong>
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setActiveTab('journal')}
                        style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
                      >
                        Consulter dans le Journal →
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setExpressResult(null)}
                        style={{ fontSize: '0.8rem', padding: '0.35rem 0.5rem' }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                )}

                {expressError && (
                  <div style={{
                    padding: '0.85rem 1.25rem', borderRadius: 'var(--radius-md)',
                    background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b',
                    display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, fontSize: '0.9rem'
                  }}>
                    <AlertTriangle size={20} color="#dc2626" />
                    {expressError}
                  </div>
                )}

              </form>
            )}

            {/* ======================================================== */}
            {/* MODE 2 : SAISIE GRILLE MULTI-LIGNES / OD                 */}
            {/* ======================================================== */}
            {saisieSubMode === 'libre' && (
              <form onSubmit={handleManualSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                
                {/* Modèles types rapides d'écritures */}
                <div style={{
                  background: '#f8fafc', padding: '0.85rem 1.25rem', borderRadius: 'var(--radius-md)',
                  border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap'
                }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-primary-dark)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <Sparkles size={16} /> Modèles Rapides :
                  </span>
                  <button
                    type="button"
                    onClick={() => applyPresetTemplate('paie')}
                    className="btn btn-secondary"
                    style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem', fontWeight: 600 }}
                  >
                    👥 OD de Salaires
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPresetTemplate('amort')}
                    className="btn btn-secondary"
                    style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem', fontWeight: 600 }}
                  >
                    📉 Amortissements (681 / 28x)
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPresetTemplate('banque')}
                    className={`btn ${isBankJournal ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem', fontWeight: 600 }}
                    title="Saisie des opérations d'un relevé bancaire (charges, produits, commissions)"
                  >
                    🏦 Banque (Relevé bancaire)
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPresetTemplate('virement_interne')}
                    className="btn btn-secondary"
                    style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem', fontWeight: 600 }}
                  >
                    🔄 Appro Caisse / Banque (585)
                  </button>
                </div>

                {/* En-tête de l'écriture */}
                <div style={{
                  background: '#ffffff', padding: '1.25rem', borderRadius: 'var(--radius-lg)',
                  border: '1px solid var(--color-border)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem'
                }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.2rem', fontSize: '0.75rem', fontWeight: 600 }}>Code Journal *</label>
                    <select
                      className="input"
                      style={{ padding: '0.45rem', fontSize: '0.85rem' }}
                      value={manualHeader.code_journal}
                      onChange={e => handleJournalChange(e.target.value)}
                    >
                      {journalCodes.map(code => {
                        const bqInfo = getBankInfo(code);
                        let label = `Journal ${code}`;
                        if (code === 'AC') label = 'AC - Journal des Achats';
                        else if (code === 'VE') label = 'VE - Journal des Ventes';
                        else if (code === 'CA' || code === 'CAISPR') label = `${code} - Caisse`;
                        else if (code === 'OD') label = 'OD - Opérations Diverses';
                        else if (bqInfo) label = bqInfo.label;
                        else if (/^BQ/i.test(code)) label = `${code} - Journal Banque`;
                        return (
                          <option key={code} value={code}>
                            {label}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', marginBottom: '0.2rem', fontSize: '0.75rem', fontWeight: 600 }}>Date *</label>
                    <input
                      type="date"
                      className="input"
                      style={{ padding: '0.45rem', fontSize: '0.85rem' }}
                      value={manualHeader.date}
                      onChange={e => {
                        const newDate = e.target.value;
                        const prevDate = manualHeader.date;
                        setManualHeader(prev => ({ ...prev, date: newDate }));
                        setManualLines(prevLines => prevLines.map(l => (!l.date || l.date === prevDate ? { ...l, date: newDate } : l)));
                      }}
                      required
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', marginBottom: '0.2rem', fontSize: '0.75rem', fontWeight: 600 }}>Poste Budgétaire</label>
                    <input
                      type="text"
                      className="input"
                      style={{ padding: '0.45rem', fontSize: '0.85rem' }}
                      placeholder="Ex: BANQUE"
                      value={manualHeader.poste_budgetaire}
                      onChange={e => setManualHeader({ ...manualHeader, poste_budgetaire: e.target.value })}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', marginBottom: '0.2rem', fontSize: '0.75rem', fontWeight: 600 }}>N° Pièce / Facture</label>
                    <input
                      type="text"
                      className="input"
                      style={{ padding: '0.45rem', fontSize: '0.85rem' }}
                      placeholder="FA-001"
                      value={manualHeader.n_facture}
                      onChange={e => setManualHeader({ ...manualHeader, n_facture: e.target.value })}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', marginBottom: '0.2rem', fontSize: '0.75rem', fontWeight: 600 }}>Référence</label>
                    <input
                      type="text"
                      className="input"
                      style={{ padding: '0.45rem', fontSize: '0.85rem' }}
                      placeholder="Ex: RELEVE-09"
                      value={manualHeader.reference}
                      onChange={e => setManualHeader({ ...manualHeader, reference: e.target.value })}
                    />
                  </div>
                </div>

                {/* Bannière Banque active & saisie rapide relevé bancaire */}
                {isBankJournal && currentBankInfo && (
                  <div style={{
                    padding: '0.75rem 1.25rem', background: '#f0fdfa',
                    border: '1.5px solid #99f6e4', borderRadius: 'var(--radius-lg)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.6rem'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <span style={{ fontSize: '1.25rem' }}>🏦</span>
                      <div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0f766e' }}>
                          Banque active : {currentBankInfo.nom} (Journal {manualHeader.code_journal})
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#115e59' }}>
                          Compte bancaire mouvementé : <strong>{currentBankInfo.compte}</strong> — Saisie issue du relevé bancaire
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#0f766e' }}>Ajouter opération relevé :</span>
                      <button
                        type="button"
                        onClick={() => addBankStatementLine('frais')}
                        className="btn btn-secondary"
                        style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem', fontWeight: 600, color: '#0f766e', borderColor: '#99f6e4' }}
                        title="Ajouter une charge : Frais de tenue de compte & commissions"
                      >
                        + Frais/Commissions (627)
                      </button>
                      <button
                        type="button"
                        onClick={() => addBankStatementLine('tenue_compte')}
                        className="btn btn-secondary"
                        style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem', fontWeight: 600, color: '#0f766e', borderColor: '#99f6e4' }}
                        title="Ajouter une charge : SMS Banking / Extrait de compte"
                      >
                        + SMS / Extrait (631)
                      </button>
                      <button
                        type="button"
                        onClick={() => addBankStatementLine('agios')}
                        className="btn btn-secondary"
                        style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem', fontWeight: 600, color: '#0f766e', borderColor: '#99f6e4' }}
                        title="Ajouter une charge financière : Agios & Intérêts débiteurs"
                      >
                        + Agios (671)
                      </button>
                      <button
                        type="button"
                        onClick={() => addBankStatementLine('produit')}
                        className="btn btn-secondary"
                        style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem', fontWeight: 600, color: '#047857', borderColor: '#6ee7b7' }}
                        title="Ajouter un produit : Intérêts créditeurs trimestriels"
                      >
                        + Intérêts crédit (771)
                      </button>
                      <button
                        type="button"
                        onClick={() => addBankStatementLine('virement')}
                        className="btn btn-secondary"
                        style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem', fontWeight: 600, color: '#1d4ed8', borderColor: '#bfdbfe' }}
                        title="Ajouter un virement interne de trésorerie"
                      >
                        + Virement (585)
                      </button>
                    </div>
                  </div>
                )}

                {/* Tableau des lignes */}
                <div style={{
                  background: '#ffffff', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)',
                  padding: '1.25rem', overflowX: 'auto'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--color-primary-dark)' }}>
                      Lignes d'imputation en partie double
                    </span>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        type="button"
                        onClick={balanceManualLines}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '0.3rem',
                          background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe',
                          padding: '0.35rem 0.75rem', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600
                        }}
                        title="Calcule l'écart et remplit la ligne d'équilibrage"
                      >
                        <Zap size={14} /> ⚡ Équilibrer l'écriture
                      </button>

                      <button
                        type="button"
                        onClick={addLine}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '0.3rem',
                          background: 'none', border: '1px solid var(--color-border)',
                          padding: '0.35rem 0.75rem', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500
                        }}
                      >
                        <Plus size={14} /> Ajouter une ligne
                      </button>
                    </div>
                  </div>

                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #cbd5e1', textAlign: 'left', color: '#475569' }}>
                        <th style={{ padding: '0.5rem', width: '13%' }}>Date *</th>
                        <th style={{ padding: '0.5rem', width: '18%' }}>N° Compte *</th>
                        <th style={{ padding: '0.5rem', width: '16%' }}>Compte Tiers</th>
                        <th style={{ padding: '0.5rem', width: '27%' }}>Libellé *</th>
                        <th style={{ padding: '0.5rem', width: '12%', textAlign: 'right' }}>Débit</th>
                        <th style={{ padding: '0.5rem', width: '12%', textAlign: 'right' }}>Crédit</th>
                        <th style={{ padding: '0.5rem', width: '2%', textAlign: 'center' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {manualLines.map((line, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '0.4rem 0.25rem' }}>
                            <input
                              type="date"
                              className="input"
                              style={{ padding: '0.4rem', fontSize: '0.8rem' }}
                              value={line.date || manualHeader.date}
                              onChange={e => updateLine(idx, { date: e.target.value })}
                              required
                            />
                          </td>

                          <td style={{ padding: '0.4rem 0.25rem' }}>
                            <input
                              type="text"
                              className="input"
                              list="express-comptes-list"
                              style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                              placeholder="N° Compte"
                              value={line.compte}
                              onChange={e => updateLine(idx, { compte: e.target.value })}
                            />
                            {line.compte && (
                              <span style={{ fontSize: '0.7rem', color: 'var(--color-primary)', display: 'block', marginTop: '0.15rem' }}>
                                {getOhadaTitle(line.compte) || ''}
                              </span>
                            )}
                          </td>

                          <td style={{ padding: '0.4rem 0.25rem' }}>
                            <input
                              type="text"
                              className="input"
                              list="express-tiers-list"
                              style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                              placeholder="Optionnel"
                              value={line.compte_tiers}
                              onChange={e => updateLine(idx, { compte_tiers: e.target.value })}
                            />
                          </td>

                          <td style={{ padding: '0.4rem 0.25rem' }}>
                            <input
                              type="text"
                              className="input"
                              style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                              placeholder="Libellé de l'écriture"
                              value={line.libelle}
                              onChange={e => {
                                const val = e.target.value;
                                updateLine(idx, { libelle: val });
                                checkMemoryMatch(idx, val, line.compte_tiers);
                              }}
                            />
                            {memoryMatch[idx] && memoryMatch[idx].matched && (
                              <span style={{ fontSize: '0.7rem', color: '#166534', background: '#dcfce7', padding: '0.1rem 0.3rem', borderRadius: '3px', display: 'inline-block', marginTop: '0.15rem' }}>
                                🧠 Suggéré : {memoryMatch[idx].target_account}
                              </span>
                            )}
                          </td>

                          <td style={{ padding: '0.4rem 0.25rem' }}>
                            <input
                              type="number"
                              step="0.01"
                              className="input"
                              style={{ padding: '0.4rem', fontSize: '0.85rem', textAlign: 'right', fontWeight: 600 }}
                              placeholder="0"
                              value={line.debit}
                              onChange={e => updateLine(idx, { debit: e.target.value })}
                            />
                          </td>

                          <td style={{ padding: '0.4rem 0.25rem' }}>
                            <input
                              type="number"
                              step="0.01"
                              className="input"
                              style={{ padding: '0.4rem', fontSize: '0.85rem', textAlign: 'right', fontWeight: 600 }}
                              placeholder="0"
                              value={line.credit}
                              onChange={e => updateLine(idx, { credit: e.target.value })}
                            />
                          </td>

                          <td style={{ padding: '0.4rem 0.25rem', textAlign: 'center' }}>
                            {manualLines.length > 2 && (
                              <button
                                type="button"
                                onClick={() => removeLine(idx)}
                                style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', padding: '0.2rem' }}
                                title="Supprimer cette ligne"
                              >
                                <Trash2 size={16} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Totaux & Équilibre */}
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem',
                    padding: '0.85rem 1rem', borderRadius: 'var(--radius-md)', marginTop: '1rem',
                    background: isBalanced ? '#f0fdf4' : (isCaisseAutoBalance || isBankAutoBalance) ? '#eff6ff' : '#fef2f2',
                    border: `1px solid ${isBalanced ? '#bbf7d0' : (isCaisseAutoBalance || isBankAutoBalance) ? '#bfdbfe' : '#fecaca'}`,
                    color: isBalanced ? '#15803d' : (isCaisseAutoBalance || isBankAutoBalance) ? '#1d4ed8' : '#b91c1c', fontSize: '0.9rem', fontWeight: 600
                  }}>
                    <div style={{ display: 'flex', gap: '1.5rem' }}>
                      <span>Total Débit : <strong>{totalDebit.toLocaleString()} FCFA</strong></span>
                      <span>Total Crédit : <strong>{totalCredit.toLocaleString()} FCFA</strong></span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      {(isBalanced || isCaisseAutoBalance || isBankAutoBalance) ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
                      {isBalanced
                        ? 'Écriture parfaitement équilibrée'
                        : isCaisseAutoBalance
                          ? `Contrepartie Caisse automatique pour ${Math.abs(ecart).toLocaleString()} FCFA`
                          : isBankAutoBalance
                            ? `Contrepartie Banque automatique (${currentBankInfo?.nom || 'Banque'} - ${currentBankInfo?.compte || '521xxx'}) pour ${Math.abs(ecart).toLocaleString()} FCFA (${ecart > 0 ? 'au Crédit (sortie)' : 'au Débit (entrée)'})`
                            : `Écart : ${Math.abs(ecart).toLocaleString()} FCFA`}
                    </div>
                  </div>
                </div>

                {/* ======================================================== */}
                {/* RÈGLEMENT EN 1 CLIC (LIÉ & LETTRÉ) DANS SAISIE GRILLE    */}
                {/* ======================================================== */}
                {(() => {
                  const tiersInLines = manualLines.filter(l => /^4/.test(String(l.compte || '').trim()));
                  const defaultTiers = tiersInLines[0];
                  const autoMontant = defaultTiers 
                    ? (parseFloat(defaultTiers.debit) || parseFloat(defaultTiers.credit) || totalDebit || 0)
                    : (totalDebit || 0);

                  return (
                    <div style={{
                      background: gridRegleImmediat ? 'linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%)' : '#f8fafc',
                      border: `1.5px solid ${gridRegleImmediat ? '#10b981' : '#e2e8f0'}`,
                      borderRadius: 'var(--radius-lg)',
                      padding: '1.25rem',
                      transition: 'all 0.2s ease',
                      boxShadow: gridRegleImmediat ? '0 4px 16px rgba(16, 185, 129, 0.08)' : 'none'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', margin: 0 }}>
                          <input
                            type="checkbox"
                            checked={gridRegleImmediat}
                            onChange={e => {
                              const checked = e.target.checked;
                              setGridRegleImmediat(checked);
                              if (checked) {
                                const defCompteTreso = gridReglement.mode_reglement === 'banque'
                                  ? (saisieConfig?.comptes_banque?.[0]?.compte || '52110017')
                                  : gridReglement.mode_reglement === 'mobile_money'
                                    ? (saisieConfig?.comptes_mobile_money?.[0]?.compte || '55410001')
                                    : (saisieConfig?.comptes_caisse?.[0]?.compte || '57111001');

                                setGridReglement(prev => ({
                                  ...prev,
                                  date_reglement: prev.date_reglement || manualHeader.date || new Date().toISOString().split('T')[0],
                                  compte_tresorerie: prev.compte_tresorerie || defCompteTreso,
                                  compte_tiers_reglement: prev.compte_tiers_reglement || (defaultTiers ? defaultTiers.compte : ''),
                                  montant_regle: prev.montant_regle || (autoMontant > 0 ? String(autoMontant) : ''),
                                  reference_reglement: prev.reference_reglement || (manualHeader.n_facture ? `REG-${manualHeader.n_facture}` : 'REGLEMENT')
                                }));
                              }
                            }}
                            style={{ width: '18px', height: '18px', accentColor: '#059669', cursor: 'pointer' }}
                          />
                          <div>
                            <span style={{
                              fontWeight: 700, fontSize: '0.95rem',
                              color: gridRegleImmediat ? '#065f46' : 'var(--color-primary-dark)',
                              display: 'flex', alignItems: 'center', gap: '0.4rem'
                            }}>
                              <Zap size={17} color={gridRegleImmediat ? '#059669' : '#64748b'} />
                              ⚡ Règlement Immédiat en 1 Clic
                            </span>
                            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', display: 'block' }}>
                              Génère automatiquement la pièce de règlement (trésorerie) en partie double et applique le lettrage comptable lié.
                            </span>
                          </div>
                        </label>

                        {gridRegleImmediat && (
                          <span style={{
                            fontSize: '0.75rem', fontWeight: 700, padding: '0.25rem 0.65rem',
                            borderRadius: '20px', background: '#dcfce7', color: '#15803d', border: '1px solid #86efac'
                          }}>
                            ✓ Règlement actif & lettrage automatique
                          </span>
                        )}
                      </div>

                      {gridRegleImmediat && (
                        <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid #bbf7d0', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                            {/* Mode de règlement */}
                            <div>
                              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem', color: '#065f46' }}>
                                Mode de Règlement *
                              </label>
                              <select
                                className="input"
                                style={{ padding: '0.45rem', fontSize: '0.85rem' }}
                                value={gridReglement.mode_reglement}
                                onChange={e => {
                                  const m = e.target.value;
                                  const isBq = m === 'banque';
                                  const isMo = m === 'mobile_money';
                                  const bqJournal = (manualHeader.code_journal && /^BQ/i.test(manualHeader.code_journal))
                                    ? manualHeader.code_journal
                                    : (saisieConfig?.journaux_banque?.[0] || 'BQ');
                                  const bqInfo = getBankInfo(bqJournal);
                                  const defJ = isBq ? bqJournal : (isMo ? 'OD' : 'CA');
                                  const defC = isBq
                                    ? (bqInfo?.compte || saisieConfig?.comptes_banque?.[0]?.compte || '52110015')
                                    : isMo
                                      ? (saisieConfig?.comptes_mobile_money?.[0]?.compte || '55410001')
                                      : (saisieConfig?.comptes_caisse?.[0]?.compte || '57111001');
                                  setGridReglement(prev => ({
                                    ...prev,
                                    mode_reglement: m,
                                    code_journal_reglement: defJ,
                                    compte_tresorerie: defC
                                  }));
                                }}
                              >
                                <option value="caisse">💵 Caisse (Journal CA)</option>
                                <option value="banque">🏦 Banque (Règlement Bancaire)</option>
                                <option value="mobile_money">📱 Mobile Money (Journal OD)</option>
                              </select>
                            </div>

                            {/* Compte de trésorerie */}
                            <div>
                              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem', color: '#065f46' }}>
                                Compte Trésorerie *
                              </label>
                              <input
                                type="text"
                                list="express-treso-comptes"
                                className="input"
                                style={{ padding: '0.45rem', fontSize: '0.85rem' }}
                                placeholder="57111001 / 52110015"
                                value={gridReglement.compte_tresorerie}
                                onChange={e => setGridReglement(prev => ({ ...prev, compte_tresorerie: e.target.value }))}
                              />
                            </div>

                            {/* Compte Tiers à solder/lettrer */}
                            <div>
                              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem', color: '#065f46' }}>
                                Compte Tiers à Solder / Lettrer
                              </label>
                              {tiersInLines.length > 0 ? (
                                <select
                                  className="input"
                                  style={{ padding: '0.45rem', fontSize: '0.85rem' }}
                                  value={gridReglement.compte_tiers_reglement || (defaultTiers ? defaultTiers.compte : '')}
                                  onChange={e => {
                                    const val = e.target.value;
                                    const matching = tiersInLines.find(l => l.compte === val);
                                    setGridReglement(prev => ({
                                      ...prev,
                                      compte_tiers_reglement: val,
                                      montant_regle: matching ? String(parseFloat(matching.debit) || parseFloat(matching.credit) || '') : prev.montant_regle
                                    }));
                                  }}
                                >
                                  {tiersInLines.map((tl, i) => (
                                    <option key={i} value={tl.compte}>
                                      {tl.compte} - {tl.compte_tiers || tl.libelle || `Ligne ${i + 1}`} ({((parseFloat(tl.debit) || parseFloat(tl.credit) || 0)).toLocaleString()} FCFA)
                                    </option>
                                  ))}
                                  <option value="">Autre compte tiers...</option>
                                </select>
                              ) : (
                                <input
                                  type="text"
                                  className="input"
                                  style={{ padding: '0.45rem', fontSize: '0.85rem' }}
                                  placeholder="Ex: 401100 ou 411100"
                                  value={gridReglement.compte_tiers_reglement}
                                  onChange={e => setGridReglement(prev => ({ ...prev, compte_tiers_reglement: e.target.value }))}
                                />
                              )}
                            </div>

                            {/* Montant Réglé */}
                            <div>
                              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem', color: '#065f46' }}>
                                Montant Réglé (FCFA)
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                className="input"
                                style={{ padding: '0.45rem', fontSize: '0.85rem', fontWeight: 700 }}
                                placeholder={String(autoMontant || 0)}
                                value={gridReglement.montant_regle}
                                onChange={e => setGridReglement(prev => ({ ...prev, montant_regle: e.target.value }))}
                              />
                            </div>

                            {/* Date Règlement */}
                            <div>
                              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem', color: '#065f46' }}>
                                Date du Règlement
                              </label>
                              <input
                                type="date"
                                className="input"
                                style={{ padding: '0.45rem', fontSize: '0.85rem' }}
                                value={gridReglement.date_reglement || manualHeader.date}
                                onChange={e => setGridReglement(prev => ({ ...prev, date_reglement: e.target.value }))}
                              />
                            </div>

                            {/* Référence / N° Pièce Règlement */}
                            <div>
                              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem', color: '#065f46' }}>
                                Pièce / Réf. Règlement
                              </label>
                              <input
                                type="text"
                                className="input"
                                style={{ padding: '0.45rem', fontSize: '0.85rem' }}
                                placeholder={manualHeader.n_facture ? `REG-${manualHeader.n_facture}` : 'REGLEMENT'}
                                value={gridReglement.reference_reglement}
                                onChange={e => setGridReglement(prev => ({ ...prev, reference_reglement: e.target.value }))}
                              />
                            </div>
                          </div>

                          <div style={{
                            fontSize: '0.8rem', color: '#166534', background: '#dcfce7',
                            padding: '0.6rem 0.85rem', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', gap: '0.5rem'
                          }}>
                            <Info size={16} />
                            <span>
                              <strong>Action en 1 Clic :</strong> À la validation, l'écriture principale de la grille sera créée et une écriture liée de règlement de <strong>{(parseFloat(gridReglement.montant_regle) || autoMontant || 0).toLocaleString()} FCFA</strong> sera générée dans le journal <strong>{gridReglement.code_journal_reglement || 'CA'}</strong> avec lettrage automatique immédiat.
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{
                    padding: '0.85rem',
                    fontSize: '0.95rem',
                    fontWeight: 700,
                    opacity: canSubmit ? 1 : 0.6,
                    cursor: canSubmit ? 'pointer' : 'not-allowed',
                    background: gridRegleImmediat ? 'linear-gradient(135deg, #059669 0%, #047857 100%)' : undefined,
                    boxShadow: gridRegleImmediat ? '0 4px 14px rgba(5,150,105,0.25)' : undefined,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem'
                  }}
                  disabled={!canSubmit || loading}
                >
                  {loading ? (
                    'Enregistrement en cours...'
                  ) : gridRegleImmediat ? (
                    <>
                      <Zap size={18} />
                      ⚡ Enregistrer la Grille & le Règlement en 1 Clic
                    </>
                  ) : (
                    'Enregistrer l\'écriture au Journal'
                  )}
                </button>

                {manualStatus && (
                  <div style={{
                    padding: '0.85rem', borderRadius: 'var(--radius-md)',
                    background: manualStatus.includes('Succès') ? '#f0fdf4' : '#fef2f2',
                    color: manualStatus.includes('Succès') ? '#15803d' : '#b91c1c',
                    fontWeight: 600, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem'
                  }}>
                    {manualStatus.includes('Succès') ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
                    {manualStatus}
                  </div>
                )}
              </form>
            )}

            {/* ======================================================== */}
            {/* MODE 3 : IMPORTATION & UPLOAD DIRECT DE FICHIERS         */}
            {/* ======================================================== */}
            {saisieSubMode === 'upload' && (
              <div style={{ background: '#ffffff', padding: '1.5rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div>
                  <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--color-primary-dark)', fontSize: '1.1rem' }}>
                    Importation de Fichiers Comptables (.xlsx, .xls, .csv)
                  </h4>
                  <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                    Téléversez vos fichiers pour alimenter automatiquement votre journal général d'écritures ou vos tiers.
                  </p>
                </div>

                {/* Modèles vierges à télécharger */}
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <a
                    href="/api/template/factures"
                    className="btn btn-primary"
                    style={{ textDecoration: 'none', fontSize: '0.85rem', padding: '0.5rem 1rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                  >
                    📄 Modèle Factures & Paiements (.xlsx)
                  </a>
                  <a
                    href="/api/template?type=journal"
                    className="btn btn-secondary"
                    style={{ textDecoration: 'none', fontSize: '0.85rem', padding: '0.5rem 1rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                  >
                    📥 Modèle Journal Général (.xlsx)
                  </a>
                  <a
                    href="/api/template?type=tiers"
                    className="btn btn-secondary"
                    style={{ textDecoration: 'none', fontSize: '0.85rem', padding: '0.5rem 1rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                  >
                    📥 Modèle Fichier Tiers (.xlsx)
                  </a>
                </div>

                {/* Type de données */}
                <div>
                  <label style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 600, fontSize: '0.85rem' }}>
                    Format et Type de données
                  </label>
                  <select
                    className="input"
                    value={uploadType}
                    onChange={e => setUploadType(e.target.value)}
                    style={{ width: '100%', fontSize: '0.9rem' }}
                  >
                    <option value="factures">🧾 Saisie Automatique de Factures (Génération partie double + TVA + ML)</option>
                    <option value="journal">Journal Comptable Général (Écritures brutes Débit/Crédit)</option>
                    <option value="journal_sage">Journal Sage 100 — Export "Impression des journaux"</option>
                    <option value="tiers">Fichier Tiers (Clients / Fournisseurs)</option>
                  </select>
                </div>

                {/* Drop Zone */}
                <div style={{
                  border: '2px dashed var(--color-primary-light)', borderRadius: 'var(--radius-lg)',
                  padding: '2.5rem 1.5rem', textAlign: 'center', background: '#f8fafc'
                }}>
                  <UploadCloud size={44} color="var(--color-primary)" style={{ margin: '0 auto 0.5rem' }} />
                  <p style={{ fontWeight: 700, margin: 0, fontSize: '1rem', color: '#1e293b' }}>
                    {uploadFile ? `Fichier sélectionné : ${uploadFile.name}` : "Déposez votre fichier Excel ou CSV ici"}
                  </p>
                  <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', display: 'block', marginTop: '0.25rem' }}>
                    Formats supportés : .xlsx, .xls, .csv (jusqu'à plusieurs centaines de milliers de lignes)
                  </span>
                  <input
                    type="file"
                    accept=".xlsx, .xls, .csv"
                    onChange={e => setUploadFile(e.target.files[0] || null)}
                    style={{ marginTop: '1rem' }}
                  />
                </div>

                {uploadFile && (
                  <button
                    type="button"
                    onClick={handleIntegratedUpload}
                    disabled={uploadLoading}
                    className="btn btn-primary"
                    style={{ padding: '0.8rem', fontSize: '0.95rem', fontWeight: 700 }}
                  >
                    {uploadLoading ? "Traitement et intégration en cours..." : `Lancer l'importation de ${uploadFile.name}`}
                  </button>
                )}

                {uploadStatus && (
                  <div style={{
                    padding: '0.85rem 1.25rem', borderRadius: 'var(--radius-md)',
                    background: uploadStatus.includes('Succès') ? '#f0fdf4' : '#fef2f2',
                    border: `1px solid ${uploadStatus.includes('Succès') ? '#bbf7d0' : '#fecaca'}`,
                    color: uploadStatus.includes('Succès') ? '#15803d' : '#991b1b',
                    fontWeight: 600, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem'
                  }}>
                    {uploadStatus.includes('Succès') ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
                    {uploadStatus}
                  </div>
                )}

                {/* Proposition de correction si déséquilibre */}
                {uploadImbalance && (
                  <div style={{
                    background: '#fffbe8', border: '2px solid #f59e0b', borderRadius: 'var(--radius-md)',
                    padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#b45309', fontWeight: 700 }}>
                      <Wrench size={20} />
                      Assistant DAF : Équilibrage automatique de partie double SYSCOHADA
                    </div>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: '#92400e' }}>
                      Votre fichier présente un écart de <strong>{Math.abs(uploadImbalance.gap || 0).toLocaleString()} FCFA</strong> (Débit: {uploadImbalance.totalDebit?.toLocaleString()} ≠ Crédit: {uploadImbalance.totalCredit?.toLocaleString()}).
                    </p>
                    <button
                      type="button"
                      onClick={handleIntegratedAutoFix}
                      disabled={uploadLoading}
                      className="btn btn-primary"
                      style={{ background: 'linear-gradient(135deg, #059669 0%, #047857 100%)', alignSelf: 'flex-start', fontWeight: 600 }}
                    >
                      <ShieldCheck size={16} /> Équilibrer & Importer en Base en 1 Clic
                    </button>
                  </div>
                )}
              </div>
            )}

          </div>
        );
      }

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
        const isCompteMode = glFilterMode === 'compte';
        const isTiersMode = glFilterMode === 'tiers';
        const isJournalMode = glFilterMode === 'journal';

        return (
          <div>
            {/* Barre de navigation entre les 3 modes du Grand Livre */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.75rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`btn ${isCompteMode ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setGlFilterMode('compte')}
                style={{ fontSize: '0.85rem', padding: '0.45rem 1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                📊 Grand Livre Général (par Compte)
              </button>
              <button
                type="button"
                className={`btn ${isTiersMode ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setGlFilterMode('tiers')}
                style={{ fontSize: '0.85rem', padding: '0.45rem 1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                👥 Grand Livre Auxiliaire (par Tiers)
              </button>
              <button
                type="button"
                className={`btn ${isJournalMode ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setGlFilterMode('journal')}
                style={{ fontSize: '0.85rem', padding: '0.45rem 1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                📕 Par Journal
              </button>
            </div>

            {/* Sélecteurs selon le mode actif */}
            <div style={{ marginBottom: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              {isCompteMode && (
                <div style={{ maxWidth: '520px', flex: '1 1 320px' }}>
                  <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-primary)' }}>
                    Compte Général (Classes 1 à 8)
                  </label>
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
              )}

              {isTiersMode && (
                <div style={{ maxWidth: '520px', flex: '1 1 320px' }}>
                  <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-primary)' }}>
                    Tiers (Comptes Tiers Clients 41 / Fournisseurs 40 — hors TVA et contreparties)
                  </label>
                  <select
                    className="input"
                    style={{ padding: '0.5rem', width: '100%' }}
                    value={glSelectedTier}
                    onChange={e => setGlSelectedTier(e.target.value)}
                  >
                    {glTiersList.length === 0 && <option value="">Aucun tiers mouvementé</option>}
                    {glTiersList.map(t => (
                      <option key={t.nom} value={t.nom}>
                        {t.nom} [{t.type || 'Tiers'}{t.compte_comptable ? ` - ${t.compte_comptable}` : ''}]
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {isJournalMode && (
                <div style={{ maxWidth: '320px', flex: '1 1 200px' }}>
                  <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-primary)' }}>
                    Journal Comptable
                  </label>
                  <select
                    className="input"
                    style={{ padding: '0.5rem', width: '100%' }}
                    value={glSelectedJournal}
                    onChange={e => setGlSelectedJournal(e.target.value)}
                  >
                    <option value="">Sélectionner un journal...</option>
                    {journalCodes.map(code => (
                      <option key={code} value={code}>{code}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {selectedGlIds.length > 0 && (
              <div style={{
                marginBottom: '1.25rem',
                padding: '1.25rem',
                background: '#f8fafc',
                border: '1.5px solid var(--color-primary)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <span style={{ fontSize: '1.25rem' }}>✏️</span>
                    <div>
                      <strong style={{ fontSize: '0.95rem', color: 'var(--color-primary-dark)' }}>
                        {selectedGlIds.length === 1
                          ? "Modifier l'écriture sélectionnée (toutes les colonnes)"
                          : `Modifier toutes les colonnes sur ${selectedGlIds.length} écritures sélectionnées`}
                      </strong>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                        {selectedGlIds.length === 1
                          ? "Modifiez directement les champs souhaités puis cliquez sur Enregistrer."
                          : "Renseignez uniquement les colonnes à modifier pour toutes les lignes sélectionnées (les champs laissés vides ne seront pas modifiés)."}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={bulkApplying}
                      onClick={applyBulkGlUpdate}
                      style={{ padding: '0.45rem 1rem', fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                    >
                      <Save size={16} /> {bulkApplying ? 'Enregistrement...' : `Enregistrer (${selectedGlIds.length})`}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        setSelectedGlIds([]);
                        setGlEditForm({ date: '', code_journal: '', compte: '', compte_tiers: '', libelle: '', n_facture: '', reference: '', poste_budgetaire: '', debit: '', credit: '' });
                      }}
                      style={{ padding: '0.45rem 0.8rem', fontSize: '0.85rem' }}
                    >
                      Annuler la sélection
                    </button>
                  </div>
                </div>

                {/* Grille de modification de toutes les colonnes */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                  gap: '0.75rem',
                  background: '#ffffff',
                  padding: '1rem',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid #e2e8f0'
                }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.2rem', color: '#475569' }}>
                      📅 Date
                    </label>
                    <input
                      type="date"
                      className="input"
                      style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                      value={glEditForm.date}
                      onChange={e => setGlEditForm(f => ({ ...f, date: e.target.value }))}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.2rem', color: '#475569' }}>
                      📕 Journal
                    </label>
                    <select
                      className="input"
                      style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                      value={glEditForm.code_journal}
                      onChange={e => setGlEditForm(f => ({ ...f, code_journal: e.target.value }))}
                    >
                      <option value="">{selectedGlIds.length > 1 ? '(Inchangé)' : 'Sélectionner...'}</option>
                      {journalCodes.map(code => (
                        <option key={code} value={code}>{code}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.2rem', color: '#475569' }}>
                      🔢 N° Compte
                    </label>
                    <input
                      type="text"
                      className="input"
                      list="express-comptes-list"
                      style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                      placeholder={selectedGlIds.length > 1 ? "Inchangé si vide" : "Ex: 601100"}
                      value={glEditForm.compte}
                      onChange={e => setGlEditForm(f => ({ ...f, compte: e.target.value }))}
                    />
                    {glEditForm.compte && (
                      <span style={{ fontSize: '0.7rem', color: 'var(--color-primary)', display: 'block', marginTop: '0.15rem' }}>
                        {getOhadaTitle(glEditForm.compte)}
                      </span>
                    )}
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.2rem', color: '#475569' }}>
                      👤 Compte Tiers
                    </label>
                    <input
                      type="text"
                      className="input"
                      list="express-tiers-list"
                      style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                      placeholder={selectedGlIds.length > 1 ? "Inchangé si vide" : "Ex: CLIENT / 401100"}
                      value={glEditForm.compte_tiers}
                      onChange={e => setGlEditForm(f => ({ ...f, compte_tiers: e.target.value }))}
                    />
                  </div>

                  <div style={{ gridColumn: 'span 2' }}>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.2rem', color: '#475569' }}>
                      📝 Libellé
                    </label>
                    <input
                      type="text"
                      className="input"
                      style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                      placeholder={selectedGlIds.length > 1 ? "Inchangé si vide" : "Libellé de l'écriture"}
                      value={glEditForm.libelle}
                      onChange={e => setGlEditForm(f => ({ ...f, libelle: e.target.value }))}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.2rem', color: '#475569' }}>
                      🧾 N° Facture / Pièce
                    </label>
                    <input
                      type="text"
                      className="input"
                      style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                      placeholder={selectedGlIds.length > 1 ? "Inchangé si vide" : "FA-001"}
                      value={glEditForm.n_facture}
                      onChange={e => setGlEditForm(f => ({ ...f, n_facture: e.target.value }))}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.2rem', color: '#475569' }}>
                      🏷️ Référence
                    </label>
                    <input
                      type="text"
                      className="input"
                      style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                      placeholder={selectedGlIds.length > 1 ? "Inchangé si vide" : "REF-001"}
                      value={glEditForm.reference}
                      onChange={e => setGlEditForm(f => ({ ...f, reference: e.target.value }))}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.2rem', color: '#475569' }}>
                      🏷️ Poste Budgétaire
                    </label>
                    <input
                      type="text"
                      className="input"
                      style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                      placeholder={selectedGlIds.length > 1 ? "Inchangé si vide" : "Ex: BANQUE / ACHATS"}
                      value={glEditForm.poste_budgetaire}
                      onChange={e => setGlEditForm(f => ({ ...f, poste_budgetaire: e.target.value }))}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.2rem', color: '#475569' }}>
                      ➕ Débit (FCFA)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      className="input"
                      style={{ padding: '0.4rem', fontSize: '0.85rem', textAlign: 'right', fontWeight: 600 }}
                      placeholder={selectedGlIds.length > 1 ? "Inchangé" : "0"}
                      value={glEditForm.debit}
                      onChange={e => setGlEditForm(f => ({ ...f, debit: e.target.value }))}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.2rem', color: '#475569' }}>
                      ➖ Crédit (FCFA)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      className="input"
                      style={{ padding: '0.4rem', fontSize: '0.85rem', textAlign: 'right', fontWeight: 600 }}
                      placeholder={selectedGlIds.length > 1 ? "Inchangé" : "0"}
                      value={glEditForm.credit}
                      onChange={e => setGlEditForm(f => ({ ...f, credit: e.target.value }))}
                    />
                  </div>
                </div>
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

            {!glLoading && !glError && isCompteMode && glLedger && (() => {
              const compLignes = glLedger.lignes || [];
              const totalGlPages = Math.ceil(compLignes.length / glPageSize) || 1;
              const safeGlPage = Math.min(Math.max(1, glPage), totalGlPages);
              const pagedLignes = compLignes.slice((safeGlPage - 1) * glPageSize, safeGlPage * glPageSize);
              return (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '900px', fontSize: '0.875rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                      <th style={{ padding: '0.75rem 0.5rem 0.75rem 0', width: '2rem' }}>
                        <input
                          type="checkbox"
                          checked={compLignes.length > 0 && selectedGlIds.length === compLignes.length}
                          onChange={e => setSelectedGlIds(e.target.checked ? compLignes.map(l => l.id) : [])}
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
                        <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 500 }}>{(glLedger.solde_ouverture ?? 0).toLocaleString()}</td>
                      </tr>
                    )}
                    {compLignes.length === 0 ? (
                      <tr>
                        <td colSpan="10" style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                          Aucune écriture pour ce compte sur la période sélectionnée.
                        </td>
                      </tr>
                    ) : pagedLignes.map(l => (
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
                        <td style={{ padding: '0.5rem', textAlign: 'right' }}>{(l.debit ?? 0) > 0 ? Number(l.debit).toLocaleString() : ''}</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right' }}>{(l.credit ?? 0) > 0 ? Number(l.credit).toLocaleString() : ''}</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 500, color: (l.solde_progressif ?? 0) >= 0 ? 'inherit' : 'var(--color-error)' }}>
                          {(l.solde_progressif ?? 0).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {compLignes.length > 0 && (
                    <tfoot>
                      <tr style={{ borderTop: '2px solid var(--color-border)', fontWeight: 'bold' }}>
                        <td colSpan="9" style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Solde final</td>
                        <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{(glLedger.solde_final ?? 0).toLocaleString()}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>

                {totalGlPages > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', padding: '0.5rem 0', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                      Page {safeGlPage} sur {totalGlPages} ({compLignes.length.toLocaleString()} écritures)
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <button className="btn btn-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem' }} disabled={safeGlPage <= 1} onClick={() => setGlPage(p => Math.max(1, p - 1))}>
                        ← Précédent
                      </button>
                      <button className="btn btn-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem' }} disabled={safeGlPage >= totalGlPages} onClick={() => setGlPage(p => Math.min(totalGlPages, p + 1))}>
                        Suivant →
                      </button>
                      <select className="input" style={{ padding: '0.3rem 0.5rem', fontSize: '0.85rem' }} value={glPageSize} onChange={e => { setGlPageSize(Number(e.target.value)); setGlPage(1); }}>
                        <option value={50}>50 / page</option>
                        <option value={100}>100 / page</option>
                        <option value={200}>200 / page</option>
                        <option value={500}>500 / page</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
              );
            })()}

            {!glLoading && !glError && isTiersMode && glTierLedger && (() => {
              const tierLignes = glTierLedger.lignes || [];
              const totalTierPages = Math.ceil(tierLignes.length / glPageSize) || 1;
              const safeTierPage = Math.min(Math.max(1, glPage), totalTierPages);
              const pagedTierLignes = tierLignes.slice((safeTierPage - 1) * glPageSize, safeTierPage * glPageSize);
              return (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '950px', fontSize: '0.875rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                      <th style={{ padding: '0.75rem 0.5rem 0.75rem 0', width: '2rem' }}>
                        <input
                          type="checkbox"
                          checked={tierLignes.length > 0 && selectedGlIds.length === tierLignes.length}
                          onChange={e => setSelectedGlIds(e.target.checked ? tierLignes.map(l => l.id) : [])}
                        />
                      </th>
                      <th style={{ padding: '0.75rem 0.5rem' }}>Date</th>
                      <th style={{ padding: '0.75rem 0.5rem' }}>Journal</th>
                      <th style={{ padding: '0.75rem 0.5rem' }}>Compte</th>
                      <th style={{ padding: '0.75rem 0.5rem' }}>N° Facture</th>
                      <th style={{ padding: '0.75rem 0.5rem' }}>Référence</th>
                      <th style={{ padding: '0.75rem 0.5rem' }}>Libellé</th>
                      <th style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Débit</th>
                      <th style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Crédit</th>
                      <th style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Solde progressif</th>
                      <th style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>Lettrage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!!glTierLedger.solde_ouverture && (
                      <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'rgba(0,0,0,0.02)', fontStyle: 'italic', color: 'var(--color-text-muted)' }}>
                        <td colSpan="9" style={{ padding: '0.5rem' }}>Solde d'ouverture (reporté des exercices antérieurs)</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 500 }}>{(glTierLedger.solde_ouverture ?? 0).toLocaleString()}</td>
                        <td></td>
                      </tr>
                    )}
                    {tierLignes.length === 0 ? (
                      <tr>
                        <td colSpan="11" style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                          Aucun mouvement sur les comptes de tiers pour "{glSelectedTier}" sur la période sélectionnée.
                        </td>
                      </tr>
                    ) : pagedTierLignes.map(l => (
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
                        <td style={{ padding: '0.5rem', fontWeight: 500 }}>{l.compte}</td>
                        <td style={{ padding: '0.5rem' }}>{l.n_facture}</td>
                        <td style={{ padding: '0.5rem' }}>{l.reference}</td>
                        <td style={{ padding: '0.5rem' }}>{l.libelle}</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right' }}>{(l.debit ?? 0) > 0 ? Number(l.debit).toLocaleString() : ''}</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right' }}>{(l.credit ?? 0) > 0 ? Number(l.credit).toLocaleString() : ''}</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 600, color: (l.solde_progressif ?? 0) >= 0 ? 'inherit' : 'var(--color-error)' }}>
                          {(l.solde_progressif ?? 0).toLocaleString()}
                        </td>
                        <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                          {l.statut_lettrage === 'lettre' ? (
                            <span style={{ fontSize: '0.75rem', padding: '0.15rem 0.4rem', borderRadius: '4px', background: 'rgba(16,185,129,0.15)', color: '#047857', fontWeight: 600 }}>
                              {l.code_lettrage || 'Lettré'}
                            </span>
                          ) : (
                            <span style={{ fontSize: '0.75rem', padding: '0.15rem 0.4rem', borderRadius: '4px', background: 'rgba(239,68,68,0.1)', color: '#b91c1c' }}>
                              Non lettré
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {tierLignes.length > 0 && (
                    <tfoot>
                      <tr style={{ borderTop: '2px solid var(--color-border)', fontWeight: 'bold' }}>
                        <td colSpan="7" style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Totaux / Solde final</td>
                        <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{(glTierLedger.total_debit ?? 0).toLocaleString()}</td>
                        <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{(glTierLedger.total_credit ?? 0).toLocaleString()}</td>
                        <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', color: (glTierLedger.solde_final ?? 0) >= 0 ? 'inherit' : 'var(--color-error)' }}>
                          {(glTierLedger.solde_final ?? 0).toLocaleString()}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  )}
                </table>

                {totalTierPages > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', padding: '0.5rem 0', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                      Page {safeTierPage} sur {totalTierPages} ({tierLignes.length.toLocaleString()} écritures)
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <button className="btn btn-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem' }} disabled={safeTierPage <= 1} onClick={() => setGlPage(p => Math.max(1, p - 1))}>
                        ← Précédent
                      </button>
                      <button className="btn btn-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem' }} disabled={safeTierPage >= totalTierPages} onClick={() => setGlPage(p => Math.min(totalTierPages, p + 1))}>
                        Suivant →
                      </button>
                      <select className="input" style={{ padding: '0.3rem 0.5rem', fontSize: '0.85rem' }} value={glPageSize} onChange={e => { setGlPageSize(Number(e.target.value)); setGlPage(1); }}>
                        <option value={50}>50 / page</option>
                        <option value={100}>100 / page</option>
                        <option value={200}>200 / page</option>
                        <option value={500}>500 / page</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
              );
            })()}

            {!glLoading && !glError && isJournalMode && glJournalLedger && (() => {
              const jourLignes = glJournalLedger.lignes || [];
              const totalJourPages = Math.ceil(jourLignes.length / glPageSize) || 1;
              const safeJourPage = Math.min(Math.max(1, glPage), totalJourPages);
              const pagedJourLignes = jourLignes.slice((safeJourPage - 1) * glPageSize, safeJourPage * glPageSize);
              return (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '900px', fontSize: '0.875rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                      <th style={{ padding: '0.75rem 0.5rem 0.75rem 0', width: '2rem' }}>
                        <input
                          type="checkbox"
                          checked={jourLignes.length > 0 && selectedGlIds.length === jourLignes.length}
                          onChange={e => setSelectedGlIds(e.target.checked ? jourLignes.map(l => l.id) : [])}
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
                    {jourLignes.length === 0 ? (
                      <tr>
                        <td colSpan="9" style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                          Aucune écriture pour ce journal sur la période sélectionnée.
                        </td>
                      </tr>
                    ) : pagedJourLignes.map(l => (
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
                        <td style={{ padding: '0.5rem', textAlign: 'right' }}>{(l.debit ?? 0) > 0 ? Number(l.debit).toLocaleString() : ''}</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right' }}>{(l.credit ?? 0) > 0 ? Number(l.credit).toLocaleString() : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                  {jourLignes.length > 0 && (
                    <tfoot>
                      <tr style={{ borderTop: '2px solid var(--color-border)', fontWeight: 'bold' }}>
                        <td colSpan="7" style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Totaux</td>
                        <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{(glJournalLedger.total_debit ?? 0).toLocaleString()}</td>
                        <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{(glJournalLedger.total_credit ?? 0).toLocaleString()}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>

                {totalJourPages > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', padding: '0.5rem 0', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                      Page {safeJourPage} sur {totalJourPages} ({jourLignes.length.toLocaleString()} écritures)
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <button className="btn btn-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem' }} disabled={safeJourPage <= 1} onClick={() => setGlPage(p => Math.max(1, p - 1))}>
                        ← Précédent
                      </button>
                      <button className="btn btn-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem' }} disabled={safeJourPage >= totalJourPages} onClick={() => setGlPage(p => Math.min(totalJourPages, p + 1))}>
                        Suivant →
                      </button>
                      <select className="input" style={{ padding: '0.3rem 0.5rem', fontSize: '0.85rem' }} value={glPageSize} onChange={e => { setGlPageSize(Number(e.target.value)); setGlPage(1); }}>
                        <option value={50}>50 / page</option>
                        <option value={100}>100 / page</option>
                        <option value={200}>200 / page</option>
                        <option value={500}>500 / page</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
              );
            })()}
          </div>
        );
      }

      case 'balance': {

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
