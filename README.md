# ✝ Church MIS — Ministry Information System
## Full-stack PWA with Supabase + RBAC

### Tech Stack
- **Frontend**: Vanilla JS + HTML/CSS (PWA, installable)
- **Backend/DB**: Supabase (PostgreSQL + Auth + Row Level Security)
- **RBAC**: 3-level role hierarchy enforced at DB + App layer
- **Hosting**: Vercel (free)
- **AI**: Claude API (AI Pastor Coach)

---

## 🚀 DEPLOYMENT GUIDE (Step by Step)

### STEP 1 — Create a Supabase project (free)
1. Go to https://supabase.com → Sign up → New Project
2. Name it "church-mis", choose a region close to Philippines (Singapore)
3. Wait ~2 minutes for project to provision

### STEP 2 — Run the database schema
1. In Supabase → SQL Editor → New Query
2. Paste the entire contents of `supabase-schema.sql`
3. Click Run → you should see "Success"
4. Run a **second query** — paste `migrations/002_add_member_fields.sql` and Run
   (adds `category`, `ws_invited`, `ws_invite_date` columns to the members table)

### STEP 3 — Get your API keys
1. Supabase → Settings → API
2. Copy: Project URL (looks like https://xxxxx.supabase.co)
3. Copy: anon/public key (long string starting with eyJ...)

### STEP 4 — Configure the app
Edit `public/config.js`:
```js
window.SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
window.SUPABASE_ANON_KEY = 'eyJ...your-anon-key...';
window.APP_CONFIG = {
  superAdminEmail: 'your-admin@email.com',  // ← Your email
};
```

### STEP 5 — Deploy to Vercel (free)
Option A — Vercel CLI:
```bash
npm install -g vercel
cd church-mis
vercel --prod
```
Option B — Drag & Drop:
1. Go to https://vercel.com → New Project
2. Drag the entire `church-mis` folder
3. Vercel auto-detects the config

### STEP 6 — Set your Supabase Auth URL
1. Supabase → Authentication → URL Configuration
2. Set "Site URL" to your Vercel URL (e.g. https://church-mis.vercel.app)
3. Add it to "Redirect URLs" too

### STEP 7 — Deploy the AI Coach Edge Function (optional but recommended)
The AI Coach needs a Supabase Edge Function so the Anthropic API key never touches the browser.

```bash
# Install Supabase CLI if you haven't: https://supabase.com/docs/guides/cli
npm install -g supabase

# Login & link your project
supabase login
supabase link --project-ref zeaozwjhxhbigxiuunor

# Deploy the function
supabase functions deploy ai-coach --no-verify-jwt

# Set your Anthropic API key as a secret
supabase secrets set ANTHROPIC_API_KEY=sk-ant-YOUR-KEY-HERE
```
Get a free Anthropic API key at console.anthropic.com. Each conversation costs ~$0.001 with Haiku.

### STEP 8 — Make yourself Super Admin
After signing up in the app:
1. Supabase → Table Editor → user_roles
2. Find your user ID (from auth.users table)
3. Change role_id to 5 (Super Admin)
OR run SQL:
```sql
UPDATE user_roles
SET role_id = (SELECT id FROM roles WHERE role_name = 'Super Admin')
WHERE user_id = 'YOUR-USER-UUID-HERE';
```

---

## 🔐 ROLE HIERARCHY

| Level | Role | What they can do |
|-------|------|-----------------|
| 3 | Super Admin | Everything: user mgmt, role assignment, audit log, delete any data |
| 2 | MIS Manager / Zone Leader | See all groups, edit all members, view reports, admin hub |
| 1 | Life Group Leader / Cell Coordinator | Only their own groups, members, attendance |

### How RBAC is enforced (3 layers):
1. **Database RLS** — PostgreSQL Row Level Security blocks unauthorized DB queries
2. **App Middleware** — `rbac.js` checks permissions before any action
3. **UI Gating** — Buttons/fields show as read-only or locked for lower roles

---

## 📱 INSTALL AS APP

### Android
Browser menu (⋮) → "Add to Home Screen"

### iPhone (Safari only)
Share button (↑) → "Add to Home Screen"

### Desktop (Chrome/Edge)
Click the install icon (⊕) in the address bar

---

## 📁 FILE STRUCTURE
```
church-mis/
├── public/
│   ├── index.html          ← Main HTML (PWA shell)
│   ├── app.js              ← All app logic + RBAC integration
│   ├── rbac.js             ← Role-Based Access Control middleware
│   ├── config.js           ← ⚠️ Edit this with your Supabase keys
│   ├── sw.js               ← Service Worker (offline/PWA)
│   ├── manifest.json       ← PWA manifest (app icon, name, etc.)
│   └── icons/
│       ├── icon-192.png    ← App icon (Android/PWA)
│       └── icon-512.png    ← App icon (splash screen)
├── supabase/
│   └── functions/
│       └── ai-coach/
│           └── index.ts    ← Edge Function: AI proxy (keeps API key server-side)
├── migrations/
│   └── 002_add_member_fields.sql ← Adds category, ws_invited, ws_invite_date
├── supabase-schema.sql     ← Full DB schema + RBAC + RLS policies
├── vercel.json             ← Vercel deployment config
└── README.md               ← This file
```

---

## 🆓 COST BREAKDOWN (Everything FREE)
- Supabase Free Tier: 500MB DB, 50,000 auth users, 5GB bandwidth/month
- Vercel Free Tier: Unlimited deployments, custom domain
- Claude API: Small usage for AI Coach (~$0.01 per conversation)

For 1 church with <50 leaders and <1000 members: **$0/month**
