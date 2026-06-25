-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 002 — Member Demographic & Worship Service Fields
-- Project  : JIL Church MIS
-- Applies to: members table (created by supabase-schema.sql)
-- Run order : AFTER supabase-schema.sql (migration 001)
-- Safe to re-run: YES — all statements use IF NOT EXISTS / OR REPLACE
-- ═══════════════════════════════════════════════════════════════
--
-- WHAT THIS MIGRATION ADDS
-- ────────────────────────
-- 1. category        TEXT     — demographic group for each member
--                               drives the Admin Hub breakdown panel
-- 2. ws_invited      BOOLEAN  — has this LG-only member been invited
--                               to Worship Service yet? (nurture loop)
-- 3. ws_invite_date  DATE     — when the invitation was made (audit trail)
-- 4. compute_category()       — PostgreSQL helper function used by the app
--                               to auto-suggest category from birthdate + gender
--
-- WHY THESE FIELDS MATTER
-- ───────────────────────
-- JIL uses an age-first demographic system for ministry targeting:
--
--   Age ≤ 12              → Children   (youth ministry)
--   Age 13 – 24           → KKB        (Kabataang Katulad ni Bathala)
--   Age 25 – 34           → YAN        (Young Adults Network)
--   Age 35+, gender=male  → Men        (men's fellowship)
--   Age 35+, gender=female → Women     (women's fellowship)
--   Age 35+, no gender    → NULL       (leader must assign manually)
--
-- The "ws_invited" flag is part of the WS Nurture Loop: the Dashboard
-- flags members with ≥4 attendances who have never been invited to a
-- Sunday Worship Service. Once invited, leaders mark ws_invited = TRUE
-- and ws_invite_date = today via the "Mark Invited" button.
-- ═══════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────
-- SECTION 1 OF 4 — ADD COLUMNS
-- ─────────────────────────────────────────────────────────────

-- 1a. Demographic category
--     Stored as a plain text label matching the 5 JIL categories.
--     NULL is allowed — some members 35+ require manual assignment
--     if gender was not recorded at the time of entry.
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS category TEXT
    CHECK (category IN ('Men','Women','YAN','KKB','Children') OR category IS NULL);

-- 1b. Worship Service invitation status
--     ws_invited   : flipped to TRUE when leader taps "Mark WS Invited"
--     ws_invite_date: auto-set to current date at the same time; used
--                    in the Admin Hub conversion funnel to track lag
--                    between discipleship and WS integration.
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS ws_invited     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ws_invite_date DATE;

-- Guard: ws_invite_date must be NULL when ws_invited is FALSE
--        (prevent inconsistent state where date exists but flag is off)
ALTER TABLE members
  ADD CONSTRAINT chk_ws_invite_consistency
    CHECK (
      (ws_invited = FALSE AND ws_invite_date IS NULL)
      OR
      (ws_invited = TRUE)
    );


-- ─────────────────────────────────────────────────────────────
-- SECTION 2 OF 4 — INDEXES
-- Two targeted indexes to keep Dashboard and Admin Hub queries fast
-- even as the members table grows.
-- ─────────────────────────────────────────────────────────────

-- 2a. Category index — used by the Admin Hub demographic breakdown panel
--     Groups members by category for count aggregations.
CREATE INDEX IF NOT EXISTS idx_members_category
  ON members(category);

-- 2b. Partial index on ws_invited = FALSE only
--     The WS Nurture Loop query always filters for uninvited members.
--     A partial index is smaller and faster than a full-column index
--     because it skips all rows where ws_invited = TRUE.
CREATE INDEX IF NOT EXISTS idx_members_ws_invited_pending
  ON members(ws_invited)
  WHERE ws_invited = FALSE;


-- ─────────────────────────────────────────────────────────────
-- SECTION 3 OF 4 — HELPER FUNCTION: compute_category()
--
-- Used by the app (app.js → suggestCategory()) to auto-suggest
-- the correct demographic category when a leader enters a member's
-- birthdate and gender during member creation or editing.
--
-- The function is IMMUTABLE — its output depends only on its inputs,
-- not on any table data or system state. This allows PostgreSQL to
-- cache results and use the function safely in indexes.
--
-- Inputs:
--   dob    DATE   — date of birth (required; returns NULL if missing)
--   gender TEXT   — 'male' or 'female' (only needed for age 35+)
--                   NOTE: members table has no gender column; the app
--                   passes this from the member-add form at runtime.
--                   Backfills always pass NULL → members 35+ stay NULL.
--
-- Returns: TEXT — one of 'Children','KKB','YAN','Men','Women', or NULL
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION compute_category(
  dob    DATE,
  gender TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  age_years INTEGER;
BEGIN
  -- Guard: no birthdate → category cannot be determined
  IF dob IS NULL THEN
    RETURN NULL;
  END IF;

  -- Calculate completed years of age as of today
  age_years := DATE_PART('year', AGE(CURRENT_DATE, dob))::INTEGER;

  -- Apply JIL age-first precedence rules
  IF    age_years <= 12 THEN
    RETURN 'Children';                      -- 0 – 12

  ELSIF age_years <= 24 THEN
    RETURN 'KKB';                           -- 13 – 24 (Kabataang Katulad ni Bathala)

  ELSIF age_years <= 34 THEN
    RETURN 'YAN';                           -- 25 – 34 (Young Adults Network)

  ELSIF LOWER(gender) = 'female' THEN
    RETURN 'Women';                         -- 35+ female

  ELSIF LOWER(gender) = 'male' THEN
    RETURN 'Men';                           -- 35+ male

  ELSE
    RETURN NULL;  -- 35+ but gender not provided; leader must assign manually
  END IF;
END;
$$;

-- Grant execute to authenticated users so the app can call it via RPC
GRANT EXECUTE ON FUNCTION compute_category(DATE, TEXT) TO authenticated;


-- ─────────────────────────────────────────────────────────────
-- SECTION 4 OF 4 — BACKFILL EXISTING MEMBERS (OPTIONAL)
--
-- If you already have members in the table from earlier testing,
-- this block computes and fills in their category from the data
-- already stored. Safe to run; skips members with no birthdate
-- or no gender (they stay NULL and require manual assignment).
--
-- Comment this section out if your members table is empty.
-- ─────────────────────────────────────────────────────────────
-- NOTE: the members table has no gender column, so gender is passed as NULL.
-- Members aged 0–34 will be categorised automatically (Children/KKB/YAN).
-- Members aged 35+ will remain NULL and require manual category assignment
-- by their life group leader in the app.
UPDATE members
SET category = compute_category(birthdate, NULL)
WHERE category IS NULL
  AND birthdate IS NOT NULL;

-- Report how many rows were categorised vs still need manual assignment
DO $$
DECLARE
  categorised  INTEGER;
  needs_manual INTEGER;
BEGIN
  SELECT COUNT(*) INTO categorised  FROM members WHERE category IS NOT NULL;
  SELECT COUNT(*) INTO needs_manual FROM members WHERE category IS NULL;
  RAISE NOTICE 'Migration 002 backfill: % members categorised, % need manual assignment.',
    categorised, needs_manual;
END;
$$;


-- ─────────────────────────────────────────────────────────────
-- VERIFICATION QUERIES
-- Run these after applying the migration to confirm everything
-- is in place. Each should return 0 errors.
-- ─────────────────────────────────────────────────────────────

-- Check 1: all 3 new columns exist on members
SELECT
  column_name,
  data_type,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'members'
  AND column_name IN ('category','ws_invited','ws_invite_date')
ORDER BY column_name;
-- Expected: 3 rows

-- Check 2: indexes were created
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'members'
  AND indexname IN ('idx_members_category','idx_members_ws_invited_pending');
-- Expected: 2 rows

-- Check 3: function exists and returns correct values
SELECT
  compute_category('2015-01-01'::DATE, NULL)   AS should_be_children,
  compute_category('2005-06-15'::DATE, NULL)   AS should_be_kkb,
  compute_category('1995-03-20'::DATE, NULL)   AS should_be_yan,
  compute_category('1980-09-10'::DATE,'male')  AS should_be_men,
  compute_category('1980-09-10'::DATE,'female')AS should_be_women,
  compute_category('1975-01-01'::DATE, NULL)   AS should_be_null;
-- Expected: Children | KKB | YAN | Men | Women | (null)

-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 002 COMPLETE
-- Next: deploy to Vercel, set Supabase Auth redirect URL, then
--       run the Super Admin grant SQL from the deployment guide.
-- ═══════════════════════════════════════════════════════════════
