-- ====================================================================
-- SCRIPT DE MIGRATION SUPABASE POUR APPLICATION AGENT OHADA (LE-DAF)
-- Exécutez ce script dans l'Éditeur SQL (SQL Editor) de votre projet Supabase.
-- ====================================================================

-- 1. Table Journal (Écritures Comptables Avancées)
CREATE TABLE IF NOT EXISTS public.journal (
  id BIGINT PRIMARY KEY,
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
  piece_id BIGINT,
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
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Table Tiers (Clients / Fournisseurs)
CREATE TABLE IF NOT EXISTS public.tiers (
  id BIGINT PRIMARY KEY,
  type TEXT,
  nom TEXT UNIQUE,
  compte_comptable TEXT,
  solde NUMERIC DEFAULT 0,
  statut TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Table Exercices Comptables
CREATE TABLE IF NOT EXISTS public.exercices (
  id BIGINT PRIMARY KEY,
  libelle TEXT NOT NULL,
  date_debut TEXT NOT NULL,
  date_fin TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Table Plan Comptable Personnalisé
CREATE TABLE IF NOT EXISTS public.chart_of_accounts (
  compte TEXT PRIMARY KEY,
  libelle TEXT NOT NULL,
  source_doc_id BIGINT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Table Règles Métiers & Apprentissages ML
CREATE TABLE IF NOT EXISTS public.business_rules (
  id BIGINT PRIMARY KEY,
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

-- Activer Row Level Security (RLS) avec politique de lecture/écriture publique
ALTER TABLE public.journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous read access" ON public.journal FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert access" ON public.journal FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update access" ON public.journal FOR UPDATE USING (true);

CREATE POLICY "Allow anonymous read access" ON public.tiers FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert access" ON public.tiers FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update access" ON public.tiers FOR UPDATE USING (true);

CREATE POLICY "Allow anonymous read access" ON public.exercices FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert access" ON public.exercices FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update access" ON public.exercices FOR UPDATE USING (true);

CREATE POLICY "Allow anonymous read access" ON public.chart_of_accounts FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert access" ON public.chart_of_accounts FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update access" ON public.chart_of_accounts FOR UPDATE USING (true);

CREATE POLICY "Allow anonymous read access" ON public.business_rules FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert access" ON public.business_rules FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update access" ON public.business_rules FOR UPDATE USING (true);
