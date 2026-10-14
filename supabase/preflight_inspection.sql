-- ====================================================================
-- UPSHIFT: CONSOLIDATED PRODUCTION PREFLIGHT INSPECTION SCRIPT
-- ====================================================================
-- Purpose:
--   Comprehensive, strictly read-only inspection of the live database
--   state prior to applying security hardening migrations.
--
-- Safety Guarantees:
--   - Strictly read-only: Zero CREATE, ALTER, DROP, INSERT, UPDATE, DELETE,
--     GRANT, REVOKE, or temporary objects.
--   - Schema-safe: No static references to optional relations or columns;
--     safely tolerates missing tables or missing columns without crashing.
--   - Privacy-safe: Zero retrieval of emails, passwords, auth tokens,
--     or sensitive user profile data.
--
-- Execution Instructions:
--   1. Copy and paste this entire script into Supabase Dashboard -> SQL Editor.
--   2. Click "Run".
--   3. Review the tabular outputs in the "Results" panel.
--   4. Review the Section 6 diagnostic output in the "Messages" panel.
-- ====================================================================

-- --------------------------------------------------------------------
-- SECTION 1: Table Existence, OID, Ownership, and RLS State
-- --------------------------------------------------------------------
SELECT 
  t.table_name,
  (c.oid IS NOT NULL) AS table_exists,
  c.oid AS table_oid,
  CASE 
    WHEN c.oid IS NOT NULL THEN pg_get_userbyid(c.relowner) 
    ELSE NULL 
  END AS table_owner,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM (VALUES ('gigs'), ('profiles'), ('gig_candidates')) AS t(table_name)
LEFT JOIN pg_class c 
  ON c.oid = to_regclass('public.' || t.table_name);

-- --------------------------------------------------------------------
-- SECTION 2: Columns, Data Types, Nullability, and Defaults
-- --------------------------------------------------------------------
SELECT 
  table_schema,
  table_name,
  ordinal_position,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name IN ('gigs', 'profiles', 'gig_candidates')
ORDER BY table_name, ordinal_position;

-- --------------------------------------------------------------------
-- SECTION 3: Constraints (Accurately Linked by Table OID)
-- --------------------------------------------------------------------
SELECT 
  c.relname AS table_name,
  con.conname AS constraint_name,
  CASE con.contype
    WHEN 'p' THEN 'PRIMARY KEY'
    WHEN 'f' THEN 'FOREIGN KEY'
    WHEN 'u' THEN 'UNIQUE'
    WHEN 'c' THEN 'CHECK'
    ELSE con.contype::text
  END AS constraint_type,
  pg_get_constraintdef(con.oid, true) AS constraint_definition
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' 
  AND c.relname IN ('gigs', 'profiles', 'gig_candidates')
ORDER BY c.relname, con.contype, con.conname;

-- --------------------------------------------------------------------
-- SECTION 4: Existing Indexes
-- --------------------------------------------------------------------
SELECT 
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public' 
  AND tablename IN ('gigs', 'profiles', 'gig_candidates')
ORDER BY tablename, indexname;

-- --------------------------------------------------------------------
-- SECTION 5: Existing RLS Policies (Commands, Qual, and With-Check)
-- --------------------------------------------------------------------
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public' 
  AND tablename IN ('gigs', 'profiles', 'gig_candidates')
ORDER BY tablename, cmd, policyname;

-- --------------------------------------------------------------------
-- SECTION 6: Safe Gig Status Distribution Inspection
-- Uses conditional procedural logic with dynamic SQL:
--   - Does NOT reference public.gigs statically (prevents compile-time abort)
--   - Safely diagnoses missing table vs missing column vs NULL status value
--   - Aggregates status counts dynamically only when both table and column exist
--   - Check the "Messages" tab in Supabase SQL Editor for output.
-- --------------------------------------------------------------------
DO $$
DECLARE
  v_table_exists boolean;
  v_col_exists boolean;
  v_total_count bigint;
  v_null_count bigint;
  v_rec record;
BEGIN
  -- 1. Verify table existence safely
  SELECT (to_regclass('public.gigs') IS NOT NULL) INTO v_table_exists;

  IF NOT v_table_exists THEN
    RAISE NOTICE '=======================================================';
    RAISE NOTICE 'SECTION 6 DIAGNOSTIC:';
    RAISE NOTICE 'Table "public.gigs" DOES NOT EXIST.';
    RAISE NOTICE '=======================================================';
    RETURN;
  END IF;

  -- 2. Verify column existence safely
  SELECT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'gigs' 
      AND column_name = 'status'
  ) INTO v_col_exists;

  IF NOT v_col_exists THEN
    EXECUTE 'SELECT count(*) FROM public.gigs' INTO v_total_count;
    RAISE NOTICE '=======================================================';
    RAISE NOTICE 'SECTION 6 DIAGNOSTIC:';
    RAISE NOTICE 'Table "public.gigs" EXISTS (Total rows: %).', v_total_count;
    RAISE NOTICE 'Column "status" DOES NOT EXIST on "public.gigs".';
    RAISE NOTICE '=======================================================';
    RETURN;
  END IF;

  -- 3. Both table and column exist: run dynamic status aggregation
  EXECUTE 'SELECT count(*) FROM public.gigs' INTO v_total_count;
  EXECUTE 'SELECT count(*) FROM public.gigs WHERE status IS NULL' INTO v_null_count;

  RAISE NOTICE '=======================================================';
  RAISE NOTICE 'SECTION 6 DIAGNOSTIC:';
  RAISE NOTICE 'Table "public.gigs" and column "status" BOTH EXIST.';
  RAISE NOTICE 'Total rows in public.gigs: %', v_total_count;
  RAISE NOTICE 'Rows where status IS NULL: %', v_null_count;
  RAISE NOTICE '-------------------------------------------------------';
  RAISE NOTICE 'STATUS DISTRIBUTION BREAKDOWN:';

  FOR v_rec IN 
    EXECUTE '
      SELECT 
        CASE 
          WHEN status IS NULL THEN ''[NULL_VALUE]'' 
          ELSE status::text 
        END AS status_val,
        count(*) AS cnt
      FROM public.gigs
      GROUP BY 1
      ORDER BY count(*) DESC
    '
  LOOP
    RAISE NOTICE '  - Status "%": % rows', v_rec.status_val, v_rec.cnt;
  END LOOP;
  RAISE NOTICE '=======================================================';
END $$;

-- --------------------------------------------------------------------
-- SECTION 7: Effective Privileges for anon and authenticated
-- Evaluates real effective privileges (including inherited from PUBLIC)
-- Uses OIDs directly so non-existent relations or roles never cause errors.
-- --------------------------------------------------------------------
SELECT 
  r.rolname AS role_name,
  c.relname AS table_name,
  has_table_privilege(r.oid, c.oid, 'SELECT') AS can_select,
  has_table_privilege(r.oid, c.oid, 'INSERT') AS can_insert,
  has_table_privilege(r.oid, c.oid, 'UPDATE') AS can_update,
  has_table_privilege(r.oid, c.oid, 'DELETE') AS can_delete,
  has_table_privilege(r.oid, c.oid, 'TRUNCATE') AS can_truncate
FROM pg_roles r
CROSS JOIN pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE r.rolname IN ('anon', 'authenticated')
  AND n.nspname = 'public'
  AND c.relname IN ('gigs', 'profiles', 'gig_candidates')
ORDER BY c.relname, r.rolname;

-- --------------------------------------------------------------------
-- SECTION 8: Relevant Function Definitions, Owners, and Execution Privileges
-- --------------------------------------------------------------------
SELECT 
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_userbyid(p.proowner) AS function_owner,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  p.prosecdef AS is_security_definer,
  CASE 
    WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') 
    THEN has_function_privilege('anon', p.oid, 'EXECUTE') 
    ELSE false 
  END AS anon_can_execute,
  CASE 
    WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') 
    THEN has_function_privilege('authenticated', p.oid, 'EXECUTE') 
    ELSE false 
  END AS auth_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' 
  AND p.proname IN ('is_admin', 'handle_new_user', 'protect_profile_role', 'check_email_role')
ORDER BY p.proname;

-- --------------------------------------------------------------------
-- SECTION 9: Database Triggers on public.profiles and auth.users
-- Uses system catalog with pg_get_triggerdef for complete declarations.
-- --------------------------------------------------------------------
SELECT 
  n.nspname AS schema_name,
  c.relname AS table_name,
  t.tgname AS trigger_name,
  p.proname AS function_called,
  t.tgenabled AS trigger_enabled,
  pg_get_triggerdef(t.oid, true) AS trigger_definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE NOT t.tgisinternal
  AND n.nspname IN ('public', 'auth')
  AND c.relname IN ('profiles', 'users')
ORDER BY n.nspname, c.relname, t.tgname;
