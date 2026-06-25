// ═══════════════════════════════════════════════════════════════
// CHURCH MIS — RBAC MIDDLEWARE (rbac.js)
// Role hierarchy enforcement at the application layer.
// This mirrors the database-level RLS policies in the UI.
// ═══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────
// ROLE DEFINITIONS (must match DB roles table)
// ─────────────────────────────────────────────
const ROLE_LEVELS = {
  'Life Group Leader': 1,
  'Cell Coordinator':  1,
  'Zone Leader':       2,
  'MIS Manager':       2,
  'Super Admin':       3,
};

// Permission matrix — what each level can do
// Higher levels inherit all lower-level permissions.
const PERMISSION_MATRIX = {
  // resource → action → minimum role level required
  own_lifegroups:  { read: 1, write: 1, delete: 1 },
  own_members:     { read: 1, write: 1, delete: 1 },
  own_attendance:  { read: 1, write: 1 },
  teachings:       { read: 1, write: 1 },
  reminders:       { read: 1, write: 1, delete: 1 },
  bible_study_log: { read: 1, write: 1 },
  ai_coach:        { read: 1 },
  // Admin-level
  all_lifegroups:  { read: 2 },
  all_members:     { read: 2, write: 2 },
  all_attendance:  { read: 2 },
  reports:         { read: 2, write: 2 },
  dashboard_admin: { read: 2 },
  // Super Admin only
  users:           { read: 3, write: 3, delete: 3 },
  roles:           { write: 3 },
  all_data:        { delete: 3 },
  system:          { manage: 3 },
};

// ─────────────────────────────────────────────
// RBAC SERVICE CLASS
// ─────────────────────────────────────────────
class RBACService {
  constructor() {
    this.currentUserLevel = 0;
    this.currentRoleName  = null;
    this.permissions      = []; // loaded from DB
    this.userId           = null;
  }

  // Called after login — loads user's role from DB
  async loadUserRole(supabaseClient, userId) {
    this.userId = userId;
    const { data, error } = await supabaseClient
      .from('user_roles')
      .select('roles(role_name, level)')
      .eq('user_id', userId);

    if (error || !data?.length) {
      // Default to lowest level if no role found
      this.currentUserLevel = 1;
      this.currentRoleName = 'Life Group Leader';
      return;
    }

    // Find highest role level (a user could have multiple roles)
    let maxLevel = 0;
    let topRole = 'Life Group Leader';
    data.forEach(ur => {
      const role = ur.roles;
      if (role && role.level > maxLevel) {
        maxLevel = role.level;
        topRole = role.role_name;
      }
    });
    this.currentUserLevel = maxLevel;
    this.currentRoleName  = topRole;

    // Load permissions from the view
    const { data: perms } = await supabaseClient
      .from('user_permissions')
      .select('resource_name, action')
      .eq('user_id', userId);
    this.permissions = perms || [];
  }

  // ─── CORE PERMISSION CHECK (Bottom-Up Inheritance) ───
  // A level 2 user automatically passes level 1 checks.
  // A level 3 user passes all checks.
  can(resource, action) {
    const required = PERMISSION_MATRIX[resource]?.[action];
    if (required === undefined) return false; // unknown permission = deny
    return this.currentUserLevel >= required;
  }

  // Shorthand checks
  isLevel(level)    { return this.currentUserLevel >= level; }
  isRegular()       { return this.currentUserLevel >= 1; }
  isAdmin()         { return this.currentUserLevel >= 2; }
  isSuperAdmin()    { return this.currentUserLevel >= 3; }

  // Ownership checks (combined with level)
  canReadMember(memberId, memberLgId, userLgIds) {
    if (this.isAdmin()) return true;
    return userLgIds.includes(memberLgId); // own group only
  }
  canEditMember(memberId, memberLgId, userLgIds) {
    if (this.isAdmin()) return true;
    return userLgIds.includes(memberLgId);
  }
  canDeleteMember(memberId, memberLgId, userLgIds) {
    if (this.isSuperAdmin()) return true;
    return userLgIds.includes(memberLgId);
  }
  canEditLifeGroup(lgLeaderId) {
    if (this.isAdmin()) return true;
    return lgLeaderId === this.userId;
  }

  // UI visibility helpers (visible but edit-restricted)
  // Returns: 'full' | 'readonly' | 'hidden'
  getAccess(resource, action) {
    if (this.can(resource, action)) return 'full';
    // Admin can see everything but may not have write on some
    if (this.isAdmin() && action === 'read') return 'full';
    if (this.isRegular() && action === 'read') return 'readonly';
    return 'hidden';
  }

  getRoleLabel() { return this.currentRoleName || 'User'; }
  getRoleLevel() { return this.currentUserLevel; }

  getRoleBadgeHTML() {
    const colors = {
      1: { bg: '#e8f1fb', text: '#1a5fa8', label: 'Leader' },
      2: { bg: '#fef3d8', text: '#c47f17', label: 'Admin' },
      3: { bg: '#fde8e6', text: '#c0392b', label: 'Super Admin' },
    };
    const c = colors[this.currentUserLevel] || colors[1];
    return `<span class="badge" style="background:${c.bg};color:${c.text}">${this.currentRoleName}</span>`;
  }
}

// ─────────────────────────────────────────────
// MIDDLEWARE GATE — wraps actions with permission checks
// Usage: gate('members','write', () => doAction())
// ─────────────────────────────────────────────
function gate(resource, action, fn, onDenied) {
  return function(...args) {
    if (!window.rbac?.can(resource, action)) {
      if (onDenied) {
        onDenied();
      } else {
        showAccessDenied(resource, action);
      }
      return;
    }
    return fn.apply(this, args);
  };
}

function showAccessDenied(resource, action) {
  const msg = {
    3: 'This action requires Super Admin access.',
    2: 'This action requires Admin or higher access.',
    1: 'You do not have permission to perform this action.',
  };
  const required = PERMISSION_MATRIX[resource]?.[action] || 1;
  const el = document.getElementById('toast');
  if (el) {
    el.textContent = '🔒 ' + (msg[required] || 'Permission denied.');
    el.classList.add('show');
    el.style.background = 'var(--coral)';
    setTimeout(() => {
      el.classList.remove('show');
      el.style.background = '';
    }, 3000);
  }
}

// ─────────────────────────────────────────────
// AUDIT LOGGER — logs sensitive actions to DB
// ─────────────────────────────────────────────
async function auditLog(supabaseClient, action, resource, resourceId, details = {}) {
  try {
    await supabaseClient.from('audit_log').insert({
      user_id:     window.rbac?.userId,
      action,
      resource,
      resource_id: resourceId?.toString(),
      details,
    });
  } catch(e) {
    console.warn('Audit log failed:', e);
  }
}

// ─────────────────────────────────────────────
// USER MANAGEMENT HELPERS (Super Admin only)
// ─────────────────────────────────────────────
async function assignRole(supabaseClient, targetUserId, roleName) {
  if (!window.rbac?.isSuperAdmin()) { showAccessDenied('roles','write'); return false; }
  const { data: role } = await supabaseClient
    .from('roles').select('id').eq('role_name', roleName).single();
  if (!role) return false;
  // Remove existing roles first
  await supabaseClient.from('user_roles').delete().eq('user_id', targetUserId);
  // Assign new role
  const { error } = await supabaseClient.from('user_roles').insert({
    user_id:     targetUserId,
    role_id:     role.id,
    assigned_by: window.rbac?.userId,
  });
  if (!error) {
    await auditLog(supabaseClient, 'role_change', 'user', targetUserId, { new_role: roleName });
  }
  return !error;
}

async function deactivateUser(supabaseClient, targetUserId) {
  if (!window.rbac?.isSuperAdmin()) { showAccessDenied('users','delete'); return false; }
  const { error } = await supabaseClient
    .from('profiles').update({ is_active: false }).eq('id', targetUserId);
  if (!error) {
    await auditLog(supabaseClient, 'deactivate', 'user', targetUserId);
  }
  return !error;
}

// ─────────────────────────────────────────────
// GLOBAL INIT — attach to window
// ─────────────────────────────────────────────
window.RBACService   = RBACService;
window.gate          = gate;
window.auditLog      = auditLog;
window.assignRole    = assignRole;
window.deactivateUser = deactivateUser;
window.ROLE_LEVELS   = ROLE_LEVELS;
