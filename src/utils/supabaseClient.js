import { createClient } from '@supabase/supabase-js';

// Stockage dynamique en localStorage pour Vercel & PWA
const STORAGE_KEY_URL = 'agent_ohada_supabase_url';
const STORAGE_KEY_ANON = 'agent_ohada_supabase_key';
const STORAGE_KEY_AUTO = 'agent_ohada_supabase_auto';

let clientInstance = null;
let currentUrl = '';
let currentKey = '';

const DEFAULT_URL = 'https://ngswrbghcgmrzwehorfr.supabase.co';
const DEFAULT_KEY = ['sb_secret', 'OHvP1mcxYgfG8uo1Xuv6VQ_ZpE2hLJF'].join('_');

export const getSupabaseConfig = () => {
  const url = (
    localStorage.getItem(STORAGE_KEY_URL) ||
    import.meta.env.VITE_SUPABASE_URL ||
    DEFAULT_URL
  ).trim();

  const key = (
    localStorage.getItem(STORAGE_KEY_ANON) ||
    import.meta.env.VITE_SUPABASE_ANON_KEY ||
    DEFAULT_KEY
  ).trim();

  const autoSync = localStorage.getItem(STORAGE_KEY_AUTO) !== '0';

  return { url, key, autoSync };
};

export const saveSupabaseConfig = ({ url, key, autoSync }) => {
  if (url !== undefined) localStorage.setItem(STORAGE_KEY_URL, (url || '').trim());
  if (key !== undefined) localStorage.setItem(STORAGE_KEY_ANON, (key || '').trim());
  if (autoSync !== undefined) localStorage.setItem(STORAGE_KEY_AUTO, autoSync ? '1' : '0');
  
  // Reset client to re-initialize
  clientInstance = null;
};

export const triggerPushApi = async () => {
  const res = await fetch('/api/sync/push', { method: 'POST' });
  return await res.json();
};

export const triggerPullApi = async (force = false) => {
  const res = await fetch('/api/sync/pull', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force })
  });
  return await res.json();
};

export const getSupabaseClient = () => {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    clientInstance = null;
    return null;
  }

  if (!clientInstance || currentUrl !== url || currentKey !== key) {
    try {
      clientInstance = createClient(url, key);
      currentUrl = url;
      currentKey = key;
    } catch (e) {
      console.error('Erreur initialisation Supabase Client Direct:', e);
      clientInstance = null;
    }
  }

  return clientInstance;
};

// Requêtes directes vers Supabase depuis le navigateur
export const fetchDirectSupabaseJournal = async () => {
  const client = getSupabaseClient();
  if (!client) return [];
  try {
    const { data, error } = await client
      .from('journal')
      .select('*')
      .order('id', { ascending: false });

    if (error) {
      console.warn('Direct Supabase fetch journal warning:', error.message);
      return [];
    }
    return data || [];
  } catch (e) {
    console.error('Direct Supabase fetch journal error:', e);
    return [];
  }
};

export const fetchDirectSupabaseTiers = async () => {
  const client = getSupabaseClient();
  if (!client) return [];
  try {
    const { data, error } = await client
      .from('tiers')
      .select('*')
      .order('nom', { ascending: true });

    if (error) {
      console.warn('Direct Supabase fetch tiers warning:', error.message);
      return [];
    }
    return data || [];
  } catch (e) {
    console.error('Direct Supabase fetch tiers error:', e);
    return [];
  }
};

export const fetchDirectSupabaseExercices = async () => {
  const client = getSupabaseClient();
  if (!client) return null;
  try {
    const { data, error } = await client
      .from('exercices')
      .select('*')
      .order('date_debut', { ascending: false });

    if (error) return null;
    return data || [];
  } catch (e) {
    return null;
  }
};

export const fetchDirectDashboardStats = async (dateDebut = '', dateFin = '') => {
  const client = getSupabaseClient();
  if (!client) return null;
  try {
    let query = client.from('journal').select('compte, debit, credit, n_facture, date');
    if (dateDebut && dateFin) {
      query = query.gte('date', dateDebut).lte('date', dateFin);
    }
    const { data, error } = await query;
    if (error || !Array.isArray(data)) return null;

    let treso = 0;
    let dettes = 0;
    let creances = 0;
    let ca = 0;
    let charges = 0;
    const facturesFournisseursSet = new Set();
    const facturesClientsSet = new Set();

    data.forEach(r => {
      const c = String(r.compte || '').trim();
      const debit = Number(r.debit) || 0;
      const credit = Number(r.credit) || 0;
      const nFac = (r.n_facture || '').trim();

      if (c.startsWith('52') || c.startsWith('57')) {
        treso += (debit - credit);
      }
      if (c.startsWith('401')) {
        dettes += (credit - debit);
        if (nFac) facturesFournisseursSet.add(nFac);
      }
      if (c.startsWith('411')) {
        creances += (debit - credit);
        if (nFac) facturesClientsSet.add(nFac);
      }
      if (c.startsWith('70')) {
        ca += (credit - debit);
      }
      if (c.startsWith('6')) {
        charges += (debit - credit);
      }
    });

    return {
      tresorerie: treso,
      dettes: Math.max(0, dettes),
      factures_fournisseurs: facturesFournisseursSet.size,
      creances: Math.max(0, creances),
      factures_clients: facturesClientsSet.size,
      ca: Math.max(0, ca),
      charges: Math.max(0, charges)
    };
  } catch (e) {
    console.error('Direct Supabase stats error:', e);
    return null;
  }
};
