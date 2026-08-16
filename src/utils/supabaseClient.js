import { createClient } from '@supabase/supabase-js';

// Stockage dynamique en localStorage pour Vercel & PWA
const STORAGE_KEY_URL = 'agent_ohada_supabase_url';
const STORAGE_KEY_ANON = 'agent_ohada_supabase_key';
const STORAGE_KEY_AUTO = 'agent_ohada_supabase_auto';

let clientInstance = null;
let currentUrl = '';
let currentKey = '';

export const getSupabaseConfig = () => {
  const url = (
    localStorage.getItem(STORAGE_KEY_URL) ||
    import.meta.env.VITE_SUPABASE_URL ||
    ''
  ).trim();

  const key = (
    localStorage.getItem(STORAGE_KEY_ANON) ||
    import.meta.env.VITE_SUPABASE_ANON_KEY ||
    ''
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
