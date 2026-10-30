-- ====================================================================
-- SCRIPT DE MIGRATION SUPABASE MULTI-DOSSIERS POUR AGENT OHADA (LE-DAF)
-- Exécutez ce script dans l'Éditeur SQL (SQL Editor) de votre projet Supabase.
-- ====================================================================

-- ====================================================================
-- ⚡ CAS 1 : VOS TABLES EXISTENT DÉJÀ DANS SUPABASE ?
-- Exécutez simplement ces quelques lignes ci-dessous (mise à jour non destructive) :
-- ====================================================================
ALTER TABLE public.journal ADD COLUMN IF NOT EXISTS dossier_id TEXT DEFAULT 'defaut';
ALTER TABLE public.journal ADD COLUMN IF NOT EXISTS statut_lettrage TEXT DEFAULT 'non_lettre';
ALTER TABLE public.journal ADD COLUMN IF NOT EXISTS code_lettrage TEXT;
ALTER TABLE public.journal ADD COLUMN IF NOT EXISTS date_lettrage TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.journal ADD COLUMN IF NOT EXISTS auteur_lettrage TEXT;
ALTER TABLE public.journal ADD COLUMN IF NOT EXISTS date_echeance TEXT;
ALTER TABLE public.journal ADD COLUMN IF NOT EXISTS date_reglement TEXT;
ALTER TABLE public.journal ADD COLUMN IF NOT EXISTS mode_paiement TEXT;
ALTER TABLE public.journal ADD COLUMN IF NOT EXISTS reference_banque TEXT;
ALTER TABLE public.journal ADD COLUMN IF NOT EXISTS statut_validation TEXT DEFAULT 'valide';
ALTER TABLE public.journal ADD COLUMN IF NOT EXISTS validateur TEXT;
ALTER TABLE public.journal ADD COLUMN IF NOT EXISTS date_validation TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.journal ADD COLUMN IF NOT EXISTS motif_rejet TEXT;
ALTER TABLE public.journal ADD COLUMN IF NOT EXISTS centre_de_cout TEXT;
ALTER TABLE public.journal ADD COLUMN IF NOT EXISTS tva_taux NUMERIC;
ALTER TABLE public.journal ADD COLUMN IF NOT EXISTS tva_montant NUMERIC;
ALTER TABLE public.journal ADD COLUMN IF NOT EXISTS piece_jointe TEXT;

ALTER TABLE public.tiers ADD COLUMN IF NOT EXISTS dossier_id TEXT DEFAULT 'defaut';
ALTER TABLE public.exercices ADD COLUMN IF NOT EXISTS dossier_id TEXT DEFAULT 'defaut';
ALTER TABLE public.chart_of_accounts ADD COLUMN IF NOT EXISTS dossier_id TEXT DEFAULT 'defaut';
ALTER TABLE public.business_rules ADD COLUMN IF NOT EXISTS dossier_id TEXT DEFAULT 'defaut';
ALTER TABLE public.deleted_records ADD COLUMN IF NOT EXISTS dossier_id TEXT DEFAULT 'defaut';

CREATE INDEX IF NOT EXISTS idx_journal_dossier ON public.journal(dossier_id);
CREATE INDEX IF NOT EXISTS idx_journal_lettrage ON public.journal(statut_lettrage, code_lettrage);
CREATE INDEX IF NOT EXISTS idx_tiers_dossier ON public.tiers(dossier_id);
CREATE INDEX IF NOT EXISTS idx_exercices_dossier ON public.exercices(dossier_id);
CREATE INDEX IF NOT EXISTS idx_accounts_dossier ON public.chart_of_accounts(dossier_id);
CREATE INDEX IF NOT EXISTS idx_rules_dossier ON public.business_rules(dossier_id);
CREATE INDEX IF NOT EXISTS idx_deleted_records_dossier ON public.deleted_records(dossier_id);

-- ====================================================================
-- 🚀 CAS 2 : CRÉATION NEUVE OU RÉINITIALISATION COMPLÈTE DU PROJET SUPABASE
-- Si vous créez un nouveau projet Supabase, vous pouvez exécuter le script intégral ci-après :
-- ====================================================================

/*
DROP TABLE IF EXISTS public.journal;
DROP TABLE IF EXISTS public.tiers;
DROP TABLE IF EXISTS public.exercices;
DROP TABLE IF EXISTS public.chart_of_accounts;
DROP TABLE IF EXISTS public.business_rules;
DROP TABLE IF EXISTS public.deleted_records;

-- 1. Table Journal (Écritures Comptables OHADA cloisonnées par dossier)
CREATE TABLE public.journal (
  id UUID PRIMARY KEY,
  dossier_id TEXT NOT NULL DEFAULT 'defaut',
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
CREATE INDEX idx_journal_dossier ON public.journal(dossier_id);
CREATE INDEX idx_journal_updated_at ON public.journal(updated_at);

-- 2. Table Tiers (Clients / Fournisseurs)
CREATE TABLE public.tiers (
  id UUID PRIMARY KEY,
  dossier_id TEXT NOT NULL DEFAULT 'defaut',
  type TEXT,
  nom TEXT NOT NULL,
  compte_comptable TEXT,
  solde NUMERIC DEFAULT 0,
  statut TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT unique_dossier_tier_nom UNIQUE (dossier_id, nom)
);
CREATE INDEX idx_tiers_dossier ON public.tiers(dossier_id);

-- 3. Table Exercices Comptables
CREATE TABLE public.exercices (
  id UUID PRIMARY KEY,
  dossier_id TEXT NOT NULL DEFAULT 'defaut',
  libelle TEXT NOT NULL,
  date_debut TEXT NOT NULL,
  date_fin TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_exercices_dossier ON public.exercices(dossier_id);

-- 4. Table Plan Comptable Personnalisé (Clé composite dossier + compte)
CREATE TABLE public.chart_of_accounts (
  dossier_id TEXT NOT NULL DEFAULT 'defaut',
  compte TEXT NOT NULL,
  libelle TEXT NOT NULL,
  source_doc_id BIGINT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (dossier_id, compte)
);
CREATE INDEX idx_accounts_dossier ON public.chart_of_accounts(dossier_id);

-- 5. Table Règles Métiers & Apprentissages ML
CREATE TABLE public.business_rules (
  id UUID PRIMARY KEY,
  dossier_id TEXT NOT NULL DEFAULT 'defaut',
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
CREATE INDEX idx_rules_dossier ON public.business_rules(dossier_id);

-- 6. Table de traçabilité des suppressions par dossier
CREATE TABLE public.deleted_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id TEXT NOT NULL DEFAULT 'defaut',
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_deleted_records_dossier ON public.deleted_records(dossier_id);
CREATE INDEX idx_deleted_records_deleted_at ON public.deleted_records(deleted_at);

-- Désactiver RLS (Row Level Security) pour permettre l'accès Push/Pull sans restriction par clé Anon
ALTER TABLE public.journal DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiers DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercices DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.chart_of_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_rules DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.deleted_records DISABLE ROW LEVEL SECURITY;

-- Accorder tous les droits au rôle public anon
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;
*/
