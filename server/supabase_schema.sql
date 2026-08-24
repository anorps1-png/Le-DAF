-- ====================================================================
-- SCRIPT DE MIGRATION SUPABASE PULL/PUSH POUR AGENT OHADA (LE-DAF)
-- Exécutez ce script dans l'Éditeur SQL (SQL Editor) de votre projet Supabase.
--
-- ATTENTION — MIGRATION UUID (v2) : ce script SUPPRIME et RECRÉE les tables ci-dessous avec
-- des id de type UUID (au lieu d'entiers auto-incrémentés), pour éliminer les collisions
-- d'id lors de la synchronisation entre plusieurs machines. Si des données existent déjà
-- dans ce projet Supabase, elles seront perdues par ce script : faites d'abord un export/
-- backup (dashboard Supabase → Database → Backups), puis effectuez un PUSH complet depuis
-- votre machine locale (déjà migrée vers des id UUID) juste après avoir exécuté ce script
-- pour repeupler la base à partir de la source de vérité locale.
-- ====================================================================

DROP TABLE IF EXISTS public.journal;
DROP TABLE IF EXISTS public.tiers;
DROP TABLE IF EXISTS public.exercices;
DROP TABLE IF EXISTS public.chart_of_accounts;
DROP TABLE IF EXISTS public.business_rules;

-- 1. Table Journal (Écritures Comptables OHADA)
CREATE TABLE public.journal (
  id UUID PRIMARY KEY,
  code_journal TEXT,
  poste_budgetaire TEXT,
  date TEXT,
  compte TEXT,
  compte_tiers TEXT,
  libelle TEXT,
  n_facture TEXT,
  reference TEXT,
  debit NUMERIC DEFAULT 0,
  credit NUMERIC DEFAULT 0,
  piece_id UUID,
  statut_lettrage TEXT DEFAULT 'non_lettre',
  code_lettrage TEXT,
  date_lettrage TIMESTAMP WITH TIME ZONE,
  auteur_lettrage TEXT,
  date_echeance TEXT,
  date_reglement TEXT,
  mode_paiement TEXT,
  reference_banque TEXT,
  statut_validation TEXT DEFAULT 'valide',
  validateur TEXT,
  date_validation TIMESTAMP WITH TIME ZONE,
  motif_rejet TEXT,
  centre_de_cout TEXT,
  tva_taux NUMERIC DEFAULT 0,
  tva_montant NUMERIC DEFAULT 0,
  piece_jointe TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Table Tiers (Clients / Fournisseurs)
CREATE TABLE public.tiers (
  id UUID PRIMARY KEY,
  type TEXT,
  nom TEXT UNIQUE,
  compte_comptable TEXT,
  solde NUMERIC DEFAULT 0,
  statut TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Table Exercices Comptables
CREATE TABLE public.exercices (
  id UUID PRIMARY KEY,
  libelle TEXT NOT NULL,
  date_debut TEXT NOT NULL,
  date_fin TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Table Plan Comptable Personnalisé (clé déjà textuelle, inchangée)
CREATE TABLE public.chart_of_accounts (
  compte TEXT PRIMARY KEY,
  libelle TEXT NOT NULL,
  source_doc_id BIGINT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Table Règles Métiers & Apprentissages ML
CREATE TABLE public.business_rules (
  id UUID PRIMARY KEY,
  doc_id BIGINT,
  pattern TEXT NOT NULL,
  condition_type TEXT DEFAULT 'contains',
  target_account TEXT,
  target_journal TEXT,
  vat_rate NUMERIC DEFAULT 0,
  confidence_score NUMERIC DEFAULT 1.0,
  auto_learned INT DEFAULT 0,
  occurrences INT DEFAULT 1,
  description TEXT,
  is_active INT DEFAULT 1,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ATTENTION : ce script ouvre l'accès complet (RLS désactivée + GRANT ALL à anon) à VOTRE
-- projet Supabase personnel. Ceci n'est sûr QUE si :
--   1. Ce projet Supabase est privé, dédié uniquement à votre propre synchronisation (pas
--      partagé entre plusieurs utilisateurs/entreprises non liés) ;
--   2. La clé "anon" de CE projet n'est JAMAIS codée en dur dans le code source de
--      l'application (elle doit être fournie via VITE_SUPABASE_ANON_KEY / réglages locaux) ;
--   3. Vous ne diffusez pas votre URL/clé Supabase à des tiers.
-- Ne réutilisez pas un projet Supabase partagé avec d'autres installations de l'application.

-- Désactiver RLS (Row Level Security) pour permettre l'accès Push/Pull sans restriction par clé Anon
ALTER TABLE public.journal DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiers DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercices DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.chart_of_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_rules DISABLE ROW LEVEL SECURITY;

-- Accorder tous les droits au rôle public anon
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;
