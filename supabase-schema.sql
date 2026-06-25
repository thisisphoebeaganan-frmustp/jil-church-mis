-- ═══════════════════════════════════════════════════════════════
-- CHURCH MIS — SUPABASE DATABASE SCHEMA WITH FULL RBAC
-- Run this entire file in your Supabase SQL Editor
-- Project: https://supabase.com → SQL Editor → New Query → Paste → Run
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────
-- 1. ROLES TABLE (hierarchy levels)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
  id         SERIAL PRIMARY KEY,
  role_name  TEXT NOT NULL UNIQUE,
  level      INTEGER NOT NULL,  -- 1=Regular, 2=Admin, 3=Super Admin
  description TEXT
);

INSERT INTO roles (role_name, level, description) VALUES
  ('Life Group Leader', 1, 'Can manage their own life groups, members, attendance'),
  ('Cell Coordinator',  1, 'Same as Life Group Leader'),
  ('Zone Leader',       2, 'Can view and manage multiple leaders'' data in their zone'),
  ('MIS Manager',       2, 'Can manage all data, generate reports, manage leaders'),
  ('Super Admin',       3, 'Full access to everything including user management')
ON CONFLICT (role_name) DO NOTHING;

-- ─────────────────────────────────────────
-- 2. PERMISSIONS TABLE
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS permissions (
  id            SERIAL PRIMARY KEY,
  resource_name TEXT NOT NULL,   -- e.g. 'members', 'lifegroups', 'reports', 'users'
  action        TEXT NOT NULL,   -- 'read', 'write', 'delete', 'manage_users'
  description   TEXT,
  UNIQUE(resource_name, action)
);

INSERT INTO permissions (resource_name, action, description) VALUES
  -- Level 1 (Regular) permissions
  ('own_lifegroups',  'read',         'Read their own life groups'),
  ('own_lifegroups',  'write',        'Create/edit their own life groups'),
  ('own_members',     'read',         'Read members in their own life groups'),
  ('own_members',     'write',        'Add/edit members in their own life groups'),
  ('own_members',     'delete',       'Remove members from their own life groups'),
  ('own_attendance',  'read',         'Read attendance for their groups'),
  ('own_attendance',  'write',        'Log attendance for their groups'),
  ('teachings',       'read',         'View teaching library'),
  ('teachings',       'write',        'Add custom teachings'),
  ('reminders',       'read',         'View their reminders'),
  ('reminders',       'write',        'Add/edit their reminders'),
  ('bible_study_log', 'read',         'View their bible study logs'),
  ('bible_study_log', 'write',        'Log bible study sessions'),
  ('ai_coach',        'read',         'Use AI pastoral coach'),
  -- Level 2 (Admin) permissions — inherited + extra
  ('all_lifegroups',  'read',         'Read ALL life groups church-wide'),
  ('all_members',     'read',         'Read ALL members church-wide'),
  ('all_attendance',  'read',         'Read ALL attendance records'),
  ('all_members',     'write',        'Edit any member record'),
  ('reports',         'read',         'Generate and export reports'),
  ('reports',         'write',        'Create custom reports'),
  ('dashboard_admin', 'read',         'View admin hub dashboard'),
  -- Level 3 (Super Admin) permissions — inherited + extra
  ('users',           'read',         'View all user accounts'),
  ('users',           'write',        'Create/edit user accounts'),
  ('users',           'delete',       'Deactivate user accounts'),
  ('roles',           'write',        'Assign roles to users'),
  ('all_data',        'delete',       'Delete any record'),
  ('system',          'manage',       'Full system management')
ON CONFLICT (resource_name, action) DO NOTHING;

-- ─────────────────────────────────────────
-- 3. ROLE_PERMISSIONS (junction table)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       INTEGER REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- Level 1 gets basic own-data permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.level = 1
  AND p.resource_name IN ('own_lifegroups','own_members','own_attendance',
                           'teachings','reminders','bible_study_log','ai_coach')
ON CONFLICT DO NOTHING;

-- Level 2 gets Level 1 + admin permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.level = 2
  AND p.resource_name IN ('own_lifegroups','own_members','own_attendance',
                           'teachings','reminders','bible_study_log','ai_coach',
                           'all_lifegroups','all_members','all_attendance',
                           'reports','dashboard_admin')
ON CONFLICT DO NOTHING;

-- Level 3 gets everything
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.level = 3
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────
-- 4. PROFILES (extends Supabase auth.users)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT '',
  church      TEXT NOT NULL DEFAULT '',
  designation TEXT,
  role        TEXT,   -- self-reported label: Life Group Leader, Zone Leader, etc.
  ministry    TEXT,
  category    TEXT,  -- Men, Women, YAN, KKB, Children
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- 5. USER_ROLES (assigns roles to users)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_roles (
  id         SERIAL PRIMARY KEY,
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id    INTEGER REFERENCES roles(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES auth.users(id),
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, role_id)
);

-- ─────────────────────────────────────────
-- 6. LIFE GROUPS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lifegroups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  leader_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day        TEXT,
  time       TEXT,
  location   TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- 7. MEMBERS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS members (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  phone          TEXT,
  birthdate      DATE,
  lifegroup_id   UUID REFERENCES lifegroups(id) ON DELETE CASCADE,
  observation    TEXT,
  follow_up_date DATE,
  lg_only        BOOLEAN DEFAULT FALSE,
  ws_only        BOOLEAN DEFAULT FALSE,
  lg_and_ws      BOOLEAN DEFAULT FALSE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- 8. ATTENDANCE
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id     UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  lifegroup_id  UUID NOT NULL REFERENCES lifegroups(id) ON DELETE CASCADE,
  year          INTEGER NOT NULL,
  month         INTEGER NOT NULL,  -- 0-indexed (Jan=0)
  week          TEXT NOT NULL,     -- 'w1','w2','w3','w4','w5'
  present       BOOLEAN DEFAULT FALSE,
  logged_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(member_id, lifegroup_id, year, month, week)
);

-- ─────────────────────────────────────────
-- 9. TEACHINGS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teachings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  leader_id   UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  category    TEXT,   -- salvation, discipleship, leadership
  stage       TEXT,   -- Early, Mid, Advanced
  resource    TEXT,   -- Bible verse
  description TEXT,
  is_custom   BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- 10. REMINDERS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reminders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  leader_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lifegroup_id UUID REFERENCES lifegroups(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  datetime     TIMESTAMPTZ,
  location     TEXT,
  notes        TEXT,
  done         BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- 11. BIBLE STUDY LOG
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bible_study_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lifegroup_id UUID NOT NULL REFERENCES lifegroups(id) ON DELETE CASCADE,
  leader_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  topic        TEXT,
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- 12. AUDIT LOG (tracks sensitive actions)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,   -- 'create','update','delete','login','role_change'
  resource   TEXT,            -- 'member','lifegroup', etc.
  resource_id TEXT,
  details    JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY (RLS) — Database-level enforcement
-- ═══════════════════════════════════════════════════════════════

-- Enable RLS on all tables
ALTER TABLE profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifegroups      ENABLE ROW LEVEL SECURITY;
ALTER TABLE members         ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance      ENABLE ROW LEVEL SECURITY;
ALTER TABLE teachings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE bible_study_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log       ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────
-- HELPER FUNCTIONS
-- ─────────────────────────────────────────

-- Get the current user's highest role level
CREATE OR REPLACE FUNCTION get_user_level(uid UUID)
RETURNS INTEGER AS $$
  SELECT COALESCE(MAX(r.level), 0)
  FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = uid;
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Check if current user has a specific permission
CREATE OR REPLACE FUNCTION has_permission(uid UUID, p_resource TEXT, p_action TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    JOIN role_permissions rp ON rp.role_id = r.id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = uid
      AND p.resource_name = p_resource
      AND p.action = p_action
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Check if user owns a life group
CREATE OR REPLACE FUNCTION owns_lifegroup(uid UUID, lg_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM lifegroups WHERE id = lg_id AND leader_id = uid);
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Check if user owns the lifegroup a member belongs to
CREATE OR REPLACE FUNCTION owns_member(uid UUID, m_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM members m
    JOIN lifegroups lg ON lg.id = m.lifegroup_id
    WHERE m.id = m_id AND lg.leader_id = uid
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- ─────────────────────────────────────────
-- RLS POLICIES: PROFILES
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "profiles_read" ON profiles;
CREATE POLICY "profiles_read" ON profiles
  FOR SELECT USING (
    id = auth.uid()  -- own profile
    OR get_user_level(auth.uid()) >= 2  -- Admin+ sees all
  );

DROP POLICY IF EXISTS "profiles_write" ON profiles;
CREATE POLICY "profiles_write" ON profiles
  FOR ALL USING (
    id = auth.uid()  -- own profile
    OR get_user_level(auth.uid()) >= 3  -- Super Admin manages all
  );

-- ─────────────────────────────────────────
-- RLS POLICIES: USER_ROLES
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "user_roles_read" ON user_roles;
CREATE POLICY "user_roles_read" ON user_roles
  FOR SELECT USING (
    user_id = auth.uid()
    OR get_user_level(auth.uid()) >= 2
  );

DROP POLICY IF EXISTS "user_roles_manage" ON user_roles;
CREATE POLICY "user_roles_manage" ON user_roles
  FOR ALL USING (get_user_level(auth.uid()) >= 3);  -- Super Admin only

-- ─────────────────────────────────────────
-- RLS POLICIES: LIFE GROUPS
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "lifegroups_select" ON lifegroups;
CREATE POLICY "lifegroups_select" ON lifegroups
  FOR SELECT USING (
    leader_id = auth.uid()              -- own groups
    OR get_user_level(auth.uid()) >= 2  -- Admin+ sees all
  );

DROP POLICY IF EXISTS "lifegroups_insert" ON lifegroups;
CREATE POLICY "lifegroups_insert" ON lifegroups
  FOR INSERT WITH CHECK (leader_id = auth.uid());

DROP POLICY IF EXISTS "lifegroups_update" ON lifegroups;
CREATE POLICY "lifegroups_update" ON lifegroups
  FOR UPDATE USING (
    leader_id = auth.uid()
    OR get_user_level(auth.uid()) >= 2
  );

DROP POLICY IF EXISTS "lifegroups_delete" ON lifegroups;
CREATE POLICY "lifegroups_delete" ON lifegroups
  FOR DELETE USING (
    leader_id = auth.uid()
    OR get_user_level(auth.uid()) >= 3  -- Super Admin can delete any
  );

-- ─────────────────────────────────────────
-- RLS POLICIES: MEMBERS
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "members_select" ON members;
CREATE POLICY "members_select" ON members
  FOR SELECT USING (
    owns_member(auth.uid(), id)
    OR get_user_level(auth.uid()) >= 2
  );

DROP POLICY IF EXISTS "members_insert" ON members;
CREATE POLICY "members_insert" ON members
  FOR INSERT WITH CHECK (
    owns_lifegroup(auth.uid(), lifegroup_id)
    OR get_user_level(auth.uid()) >= 2
  );

DROP POLICY IF EXISTS "members_update" ON members;
CREATE POLICY "members_update" ON members
  FOR UPDATE USING (
    owns_member(auth.uid(), id)
    OR get_user_level(auth.uid()) >= 2
  );

DROP POLICY IF EXISTS "members_delete" ON members;
CREATE POLICY "members_delete" ON members
  FOR DELETE USING (
    owns_member(auth.uid(), id)
    OR get_user_level(auth.uid()) >= 3
  );

-- ─────────────────────────────────────────
-- RLS POLICIES: ATTENDANCE
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "attendance_select" ON attendance;
CREATE POLICY "attendance_select" ON attendance
  FOR SELECT USING (
    owns_lifegroup(auth.uid(), lifegroup_id)
    OR get_user_level(auth.uid()) >= 2
  );

DROP POLICY IF EXISTS "attendance_write" ON attendance;
CREATE POLICY "attendance_write" ON attendance
  FOR ALL USING (
    owns_lifegroup(auth.uid(), lifegroup_id)
    OR get_user_level(auth.uid()) >= 2
  );

-- ─────────────────────────────────────────
-- RLS POLICIES: TEACHINGS
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "teachings_select" ON teachings;
CREATE POLICY "teachings_select" ON teachings
  FOR SELECT USING (
    leader_id = auth.uid()
    OR get_user_level(auth.uid()) >= 2
    OR is_custom = FALSE  -- default teachings visible to all
  );

DROP POLICY IF EXISTS "teachings_write" ON teachings;
CREATE POLICY "teachings_write" ON teachings
  FOR ALL USING (
    leader_id = auth.uid()
    OR get_user_level(auth.uid()) >= 3
  );

-- ─────────────────────────────────────────
-- RLS POLICIES: REMINDERS
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "reminders_policy" ON reminders;
CREATE POLICY "reminders_policy" ON reminders
  FOR ALL USING (
    leader_id = auth.uid()
    OR get_user_level(auth.uid()) >= 3
  );

-- ─────────────────────────────────────────
-- RLS POLICIES: BIBLE STUDY LOG
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "bsl_policy" ON bible_study_log;
CREATE POLICY "bsl_policy" ON bible_study_log
  FOR ALL USING (
    leader_id = auth.uid()
    OR get_user_level(auth.uid()) >= 2
  );

-- ─────────────────────────────────────────
-- RLS POLICIES: AUDIT LOG
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "audit_select" ON audit_log;
CREATE POLICY "audit_select" ON audit_log
  FOR SELECT USING (get_user_level(auth.uid()) >= 3);  -- Super Admin only

DROP POLICY IF EXISTS "audit_insert" ON audit_log;
CREATE POLICY "audit_insert" ON audit_log
  FOR INSERT WITH CHECK (TRUE);  -- any authenticated user can insert

-- ═══════════════════════════════════════════════════════════════
-- TRIGGER: auto-assign "Life Group Leader" role on signup
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  default_role_id INTEGER;
BEGIN
  SELECT id INTO default_role_id FROM roles WHERE role_name = 'Life Group Leader';
  INSERT INTO user_roles (user_id, role_id)
  VALUES (NEW.id, default_role_id)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ═══════════════════════════════════════════════════════════════
-- TRIGGER: audit log on member changes
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION log_member_change()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_log (user_id, action, resource, resource_id, details)
  VALUES (
    auth.uid(),
    TG_OP,
    'member',
    COALESCE(NEW.id::TEXT, OLD.id::TEXT),
    jsonb_build_object(
      'name', COALESCE(NEW.name, OLD.name),
      'lifegroup_id', COALESCE(NEW.lifegroup_id::TEXT, OLD.lifegroup_id::TEXT)
    )
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS members_audit ON members;
CREATE TRIGGER members_audit
  AFTER INSERT OR UPDATE OR DELETE ON members
  FOR EACH ROW EXECUTE FUNCTION log_member_change();

-- ═══════════════════════════════════════════════════════════════
-- HELPER VIEW: user_permissions (use in app to load permissions)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW user_permissions AS
SELECT
  ur.user_id,
  r.role_name,
  r.level AS role_level,
  p.resource_name,
  p.action
FROM user_roles ur
JOIN roles r ON r.id = ur.role_id
JOIN role_permissions rp ON rp.role_id = r.id
JOIN permissions p ON p.id = rp.permission_id;

-- Grant authenticated users access to view their own permissions
GRANT SELECT ON user_permissions TO authenticated;
GRANT SELECT ON roles TO authenticated;
GRANT SELECT ON permissions TO authenticated;
GRANT SELECT ON role_permissions TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- INDEXES for performance
-- ═══════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_lifegroups_leader    ON lifegroups(leader_id);
CREATE INDEX IF NOT EXISTS idx_members_lifegroup    ON members(lifegroup_id);
CREATE INDEX IF NOT EXISTS idx_attendance_member    ON attendance(member_id);
CREATE INDEX IF NOT EXISTS idx_attendance_lifegroup ON attendance(lifegroup_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user      ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_user           ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created        ON audit_log(created_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- DONE. Your RBAC schema is ready.
-- Next step: Go to Supabase → Authentication → Settings
--   and set your Site URL to your Vercel deployment URL.
-- ═══════════════════════════════════════════════════════════════
