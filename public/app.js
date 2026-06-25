// ══════════════════════════════════════════════════════════
// CHURCH MIS — MAIN APPLICATION LOGIC
// ══════════════════════════════════════════════════════════

// ── SUPABASE CLIENT ──
let supabase;
try {
  supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
} catch(e) {
  console.error('Supabase init failed. Check config.js:', e);
}

// ── GLOBAL STATE ──
let currentUser = null;
let userProfile = null;
let lifegroups = [];
let members = [];
let attendance = {}; // {memberId: {lgId: {year: {month: {week: bool}}}}}
let teachings = [];
let reminders = [];
let bibleStudyLog = [];
let currentPage = 'dashboard';
let selectedCat = 'Men';
let memberTabFilter = 'all';
let teachingTabFilter = 'all';
let expandedLGId = null;

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

// ══════════════════════════════════════════════════════════
// STATUS / HELPERS
// ══════════════════════════════════════════════════════════
function calcStatus(memberId) {
  const total = getTotalAtt(memberId);
  if (total === 0) return 'invite';
  if (total <= 3) return 'firsttimer';
  if (total <= 13) return 'attendee';
  return 'member';
}
function getTotalAtt(memberId) {
  let n = 0;
  const mAtt = attendance[memberId] || {};
  for (const lgId in mAtt)
    for (const yr in mAtt[lgId])
      for (const mo in mAtt[lgId][yr])
        for (const wk in mAtt[lgId][yr][mo])
          if (mAtt[lgId][yr][mo][wk]) n++;
  return n;
}
function statusLabel(s){ return {invite:'Invite',firsttimer:'First Timer',attendee:'Attendee',member:'Member'}[s]||s; }
function statusBadge(s){
  const cls={invite:'b-invite',firsttimer:'b-firsttimer',attendee:'b-attendee',member:'b-member'};
  return `<span class="badge ${cls[s]}">${statusLabel(s)}</span>`;
}
function serviceBadge(m){
  if(m.lg_only) return `<span class="badge b-lgonly">LG Only</span>`;
  if(m.ws_only) return `<span class="badge b-wsonly">WS Only</span>`;
  if(m.lg_and_ws) return `<span class="badge b-both">LG + WS</span>`;
  return `<span class="badge" style="background:#f5f5f5;color:#999">Not Set</span>`;
}
function avatarColor(name) {
  const cols=['#1a5fa8','#4a7c59','#6b3fa0','#c47f17','#c0392b','#0369a1','#be185d','#0f766e'];
  let h=0; for(const c of (name||'?')) h=(h+c.charCodeAt(0))%cols.length; return cols[h];
}
function initials(name){ return (name||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); }
function weeksInMonth(year,month){
  const first=new Date(year,month,1).getDay();
  return Math.ceil((first+new Date(year,month+1,0).getDate())/7);
}
function toast(msg, dur=2500){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), dur);
}
function isSuperAdmin(){
  if(window.rbac) return window.rbac.isSuperAdmin();
  return currentUser?.email===window.APP_CONFIG?.superAdminEmail;
}
function isAdminLevel(){
  if(window.rbac) return window.rbac.isAdmin(); // level 2+
  return false;
}
function suggestCategory(birthdateVal, catSelectId){
  if(!birthdateVal) return;
  const age=Math.floor((new Date()-new Date(birthdateVal))/31557600000);
  const sel=document.getElementById(catSelectId); if(!sel) return;
  if(age<=12) sel.value='Children';
  else if(age<=24) sel.value='KKB';
  else if(age<=34) sel.value='YAN';
  // 35+: requires gender — leave for leader to choose
}

// ══════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════
function switchAuth(tab, el) {
  document.querySelectorAll('.auth-tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('auth-login').classList.toggle('hidden', tab!=='login');
  document.getElementById('auth-signup').classList.toggle('hidden', tab!=='signup');
}

async function doLogin(){
  const email=document.getElementById('login-email').value.trim();
  const pass=document.getElementById('login-password').value;
  const errEl=document.getElementById('login-error');
  errEl.style.display='none';
  if(!email||!pass){errEl.textContent='Please fill in all fields.';errEl.style.display='block';return;}
  const {data,error}=await supabase.auth.signInWithPassword({email,password:pass});
  if(error){errEl.textContent=error.message;errEl.style.display='block';return;}
  await onLogin(data.user);
}

async function doSignup(){
  const email=document.getElementById('signup-email').value.trim();
  const pass=document.getElementById('signup-password').value;
  const errEl=document.getElementById('signup-error');
  errEl.style.display='none';
  if(!email||!pass){errEl.textContent='Please fill in all fields.';errEl.style.display='block';return;}
  if(pass.length<6){errEl.textContent='Password must be at least 6 characters.';errEl.style.display='block';return;}
  const {data,error}=await supabase.auth.signUp({email,password:pass});
  if(error){errEl.textContent=error.message;errEl.style.display='block';return;}
  currentUser=data.user;
  showScreen('onboard');
}

async function doForgotPassword(){
  const email=prompt('Enter your email address:');
  if(!email) return;
  const {error}=await supabase.auth.resetPasswordForEmail(email);
  if(error) alert('Error: '+error.message);
  else alert('Password reset email sent! Check your inbox.');
}

async function doLogout(){
  await supabase.auth.signOut();
  currentUser=null; userProfile=null;
  lifegroups=[]; members=[]; attendance={};
  showScreen('auth');
}

async function onLogin(user){
  currentUser=user;
  window.rbac=new RBACService();
  await window.rbac.loadUserRole(supabase,user.id);
  const {data:profile}=await supabase.from('profiles').select('*').eq('id',user.id).single();
  if(!profile){showScreen('onboard');return;}
  userProfile=profile;
  await loadAllData();
  launchApp();
}

// ══════════════════════════════════════════════════════════
// ONBOARDING
// ══════════════════════════════════════════════════════════
function obStep(n){
  [1,2,3].forEach(i=>{
    document.getElementById(`ob-step${i}`).classList.toggle('hidden',i!==n);
  });
  const dots=document.querySelectorAll('#ob-dots .dot');
  dots.forEach((d,i)=>{
    d.classList.toggle('active',i<n);
    d.style.width=i===n-1?'20px':'8px';
    d.style.borderRadius=i===n-1?'4px':'50%';
  });
}
function selCat(el,cat){
  document.querySelectorAll('.cat-btn').forEach(b=>b.classList.remove('sel'));
  el.classList.add('sel'); selectedCat=cat;
}
async function finishOnboard(){
  const name=document.getElementById('ob-name').value.trim();
  const church=document.getElementById('ob-church').value.trim();
  if(!name||!church){toast('Name and church are required');return;}
  const profile={
    id:currentUser.id,
    name, church,
    designation:document.getElementById('ob-designation').value.trim(),
    role:document.getElementById('ob-role').value,
    ministry:document.getElementById('ob-ministry').value.trim(),
    category:selectedCat,
    created_at:new Date().toISOString()
  };
  const {error}=await supabase.from('profiles').upsert(profile);
  if(error){toast('Error saving profile: '+error.message);return;}
  userProfile=profile;

  // Create first life group
  const lgName=document.getElementById('ob-lgname').value.trim()||'My Life Group';
  const {data:lg,error:lge}=await supabase.from('lifegroups').insert({
    name:lgName,
    leader_id:currentUser.id,
    day:document.getElementById('ob-lgday').value,
    time:document.getElementById('ob-lgtime').value,
    location:document.getElementById('ob-lgloc').value.trim()||'TBD',
  }).select().single();
  if(!lge && lg) lifegroups=[lg];

  // Seed default teachings
  await supabase.from('teachings').insert(defaultTeachings().map(t=>({...t,leader_id:currentUser.id})));

  // Initialize RBAC before loadAllData so admin-level checks work immediately
  window.rbac=new RBACService();
  await window.rbac.loadUserRole(supabase,currentUser.id);

  await loadAllData();
  launchApp();
}

function defaultTeachings(){
  return[
    {title:'Foundations of Faith',category:'salvation',stage:'Early',description:'Core beliefs, prayer, and scripture basics.',resource:'Matthew 6:9-13',is_custom:false},
    {title:'Identity in Christ',category:'discipleship',stage:'Mid',description:'Who we are in Jesus — renewed identity.',resource:'2 Corinthians 5:17',is_custom:false},
    {title:'Invitation to Worship',category:'discipleship',stage:'Mid',description:'The importance and joy of corporate worship.',resource:'Psalm 122:1',is_custom:false},
    {title:'Serving Your Community',category:'discipleship',stage:'Mid',description:'Practical ways to serve and give back.',resource:'Mark 10:45',is_custom:false},
    {title:'Principles of Leadership',category:'leadership',stage:'Advanced',description:'Servant leadership for emerging leaders.',resource:'John 13:14',is_custom:false},
  ];
}

// ══════════════════════════════════════════════════════════
// DATA LOADING
// ══════════════════════════════════════════════════════════
async function loadAllData(){
  const uid=currentUser.id;
  const isAdmin=isAdminLevel()||isSuperAdmin(); // level 2+ sees all groups

  // Life groups
  let lgQ=supabase.from('lifegroups').select('*').order('name');
  if(!isAdmin) lgQ=lgQ.eq('leader_id',uid);
  const {data:lgs}=await lgQ;
  lifegroups=lgs||[];

  // Members
  const lgIds=lifegroups.map(l=>l.id);
  if(lgIds.length){
    const {data:mems}=await supabase.from('members').select('*').in('lifegroup_id',lgIds).order('name');
    members=mems||[];
  } else { members=[]; }

  // Attendance
  if(members.length){
    const mIds=members.map(m=>m.id);
    const {data:attRows}=await supabase.from('attendance').select('*').in('member_id',mIds);
    attendance={};
    (attRows||[]).forEach(row=>{
      if(!attendance[row.member_id]) attendance[row.member_id]={};
      if(!attendance[row.member_id][row.lifegroup_id]) attendance[row.member_id][row.lifegroup_id]={};
      if(!attendance[row.member_id][row.lifegroup_id][row.year]) attendance[row.member_id][row.lifegroup_id][row.year]={};
      if(!attendance[row.member_id][row.lifegroup_id][row.year][row.month]) attendance[row.member_id][row.lifegroup_id][row.year][row.month]={};
      attendance[row.member_id][row.lifegroup_id][row.year][row.month][row.week]=row.present;
    });
  }

  // Teachings
  const {data:tch}=await supabase.from('teachings').select('*').eq('leader_id',uid).order('title');
  teachings=tch||[];
  if(!teachings.length){
    const ins=defaultTeachings().map(t=>({...t,leader_id:uid}));
    const {data:newT}=await supabase.from('teachings').insert(ins).select();
    teachings=newT||[];
  }

  // Reminders
  const {data:rem}=await supabase.from('reminders').select('*').eq('leader_id',uid).order('datetime');
  reminders=rem||[];

  // Bible study log
  const {data:bsl}=await supabase.from('bible_study_log').select('*').in('lifegroup_id',lgIds).order('date',{ascending:false});
  bibleStudyLog=bsl||[];
}

// ══════════════════════════════════════════════════════════
// LAUNCH APP
// ══════════════════════════════════════════════════════════
function launchApp(){
  showScreen('app');
  updateSidebarUser();
  buildNav();
  showPage('dashboard');
}

function showScreen(name){
  document.getElementById('auth-screen').classList.toggle('hidden',name!=='auth');
  document.getElementById('onboard-screen').classList.toggle('hidden',name!=='onboard');
  document.getElementById('main-app').classList.toggle('hidden',name!=='app');
}

function updateSidebarUser(){
  const n=userProfile?.name||currentUser?.email||'Leader';
  const r=userProfile?.role||'Leader';
  const c=userProfile?.church||'My Church';
  ['sidebar-name','drawer-name'].forEach(id=>{ const el=document.getElementById(id); if(el) el.textContent=n; });
  ['sidebar-role','drawer-role'].forEach(id=>{ const el=document.getElementById(id); if(el) el.textContent=r; });
  ['sidebar-church','drawer-church'].forEach(id=>{ const el=document.getElementById(id); if(el) el.textContent=c; });
}

// ══════════════════════════════════════════════════════════
// NAV BUILD
// ══════════════════════════════════════════════════════════
const NAV_ITEMS = [
  {section:'My Ministry', items:[
    {id:'dashboard',icon:'ti-layout-dashboard',label:'Dashboard'},
    {id:'lifegroups',icon:'ti-users-group',label:'Life Groups'},
    {id:'members',icon:'ti-user-check',label:'All Members'},
    {id:'attendance',icon:'ti-calendar-check',label:'Attendance'},
  ]},
  {section:'Resources', items:[
    {id:'teachings',icon:'ti-book',label:'Teaching Library'},
    {id:'reminders',icon:'ti-bell',label:'Reminders'},
    {id:'ai-coach',icon:'ti-sparkles',label:'AI Pastor Coach'},
  ]},
  {section:'Admin', items:[
    {id:'admin-hub',icon:'ti-chart-bar',label:'Admin Hub'},
    {id:'settings',icon:'ti-settings',label:'Settings'},
  ]},
];

function buildNav(){
  const html=NAV_ITEMS.map(sect=>`
    <div class="nav-sect">
      <div class="nav-lbl">${sect.section}</div>
      ${sect.items.map(it=>`
        <div class="nav-item" id="nav-${it.id}" onclick="showPage('${it.id}');closeDrawer()">
          <i class="ti ${it.icon}"></i> ${it.label}
        </div>`).join('')}
    </div>`).join('');
  document.getElementById('sidebar-nav').innerHTML=html;
  document.getElementById('drawer-nav').innerHTML=html;
}

function setActiveNav(pageId){
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.querySelectorAll(`#nav-${pageId}`).forEach(n=>n.classList.add('active'));
  document.querySelectorAll('.bnav-item').forEach(b=>{
    b.classList.toggle('active', b.dataset.page===pageId);
  });
}

// ══════════════════════════════════════════════════════════
// DRAWER
// ══════════════════════════════════════════════════════════
function openDrawer(){
  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawer-overlay').classList.remove('hidden');
}
function closeDrawer(){
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.add('hidden');
}

// ══════════════════════════════════════════════════════════
// PAGE ROUTER
// ══════════════════════════════════════════════════════════
const PAGE_TITLES = {
  dashboard:'Dashboard', lifegroups:'Life Groups', members:'All Members',
  attendance:'Attendance', teachings:'Teaching Library', reminders:'Reminders',
  'ai-coach':'AI Pastor Coach', 'admin-hub':'Admin Hub', settings:'Settings',
};

function showPage(id){
  currentPage=id;
  setActiveNav(id);
  const title=PAGE_TITLES[id]||id;
  const tt=document.getElementById('topbar-title');
  const mt=document.getElementById('mobile-page-title');
  if(tt) tt.textContent=title;
  if(mt) mt.textContent=title;
  const actions=document.getElementById('topbar-actions');
  if(actions) actions.innerHTML='';
  const pages={
    dashboard: renderDashboard,
    lifegroups: renderLifeGroups,
    members: renderMembers,
    attendance: renderAttendance,
    teachings: renderTeachings,
    reminders: renderReminders,
    'ai-coach': renderAICoach,
    'admin-hub': renderAdminHub,
    settings: renderSettings,
  };
  const container=document.getElementById('page-container');
  if(container && pages[id]) { container.innerHTML=''; pages[id](); }
}

// ══════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════
function renderDashboard(){
  const actions=document.getElementById('topbar-actions');
  if(actions) actions.innerHTML=`
    <button class="btn btn-gold btn-sm" onclick="openAddMemberModal()"><i class="ti ti-plus"></i> Add Member</button>
    <button class="btn btn-outline btn-sm" onclick="openLogBSModal()"><i class="ti ti-book-2"></i> Log Study</button>`;

  const counts=getPipelineCounts();
  const total=members.length;
  const bsMonth=bibleStudyLog.filter(b=>new Date(b.date).getMonth()===new Date().getMonth()).length;
  const pending=members.filter(m=>m.follow_up_date&&new Date(m.follow_up_date)>=new Date().setHours(0,0,0,0)).length;

  document.getElementById('page-container').innerHTML=`
    ${buildReminderBanner()}
    <div class="section-hdr"><span class="sec-title">Member Pipeline</span></div>
    ${buildPipeline(counts)}
    <div class="stat-grid" style="margin-bottom:16px">
      <div class="stat-card"><div class="stat-label">Total Contacts</div><div class="stat-num">${total}</div><div class="stat-sub">All groups</div></div>
      <div class="stat-card"><div class="stat-label">Life Groups</div><div class="stat-num">${lifegroups.length}</div><div class="stat-sub">Active</div></div>
      <div class="stat-card"><div class="stat-label">Studies This Month</div><div class="stat-num">${bsMonth}</div><div class="stat-sub">Logged sessions</div></div>
      <div class="stat-card"><div class="stat-label">Follow-Ups Due</div><div class="stat-num" style="color:${pending>0?'var(--coral)':'var(--sage)'}">${pending}</div><div class="stat-sub">Pending</div></div>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <span class="sec-title">My Life Groups</span>
      <button class="btn btn-outline btn-sm" onclick="showPage('lifegroups')">View All</button>
    </div>
    <div id="lg-quick-grid"></div>
    <div style="margin-top:4px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <span class="sec-title">⚠️ Follow-Up Needed</span>
      </div>
      <div id="followup-list"></div>
    </div>
    <div style="margin-top:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <span class="sec-title">🚨 At-Risk This Month</span>
        <span class="text-xs text-muted">0 attendance in ${MONTHS[new Date().getMonth()]}</span>
      </div>
      <div id="atrisk-list"></div>
    </div>
    <div style="margin-top:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <span class="sec-title">🙏 Ready to Invite to Worship</span>
        <span class="text-xs text-muted">LG-only, ≥4 attendances</span>
      </div>
      <div id="ws-nudge-list"></div>
    </div>`;

  // Inject LG cards
  const lgGrid=document.getElementById('lg-quick-grid');
  lgGrid.innerHTML=lifegroups.map(lg=>{
    const cnt=members.filter(m=>m.lifegroup_id===lg.id).length;
    return `<div class="lg-card" onclick="showPage('lifegroups');expandedLGId='${lg.id}';renderLifeGroups()">
      <div class="lg-card-hdr">
        <div style="font-weight:700;font-size:14px">${lg.name}</div>
        <div style="font-size:11px;opacity:.65;margin-top:2px">${lg.day} · ${lg.time} · ${lg.location}</div>
      </div>
      <div class="lg-card-body">
        <span style="font-size:26px;font-weight:700;color:var(--navy);font-family:'Lora',serif">${cnt}</span>
        <span class="text-muted" style="margin-left:4px">members</span>
      </div>
    </div>`;
  }).join('')+`<div class="lg-card" onclick="openAddLGModal()" style="border-style:dashed;display:flex;align-items:center;justify-content:center;min-height:90px;color:var(--hint)">
    <div style="text-align:center;font-size:12px"><i class="ti ti-plus" style="font-size:24px;display:block;margin-bottom:4px"></i>New Life Group</div>
  </div>`;

  // Follow-up list
  const fuList=document.getElementById('followup-list');
  const now=new Date(); now.setHours(0,0,0,0);
  const fuMembers=members.filter(m=>m.follow_up_date&&new Date(m.follow_up_date)>=now).slice(0,6);
  if(!fuMembers.length){ fuList.innerHTML=`<p class="text-muted">No follow-ups pending. Great work! 🙌</p>`; }
  else fuList.innerHTML=fuMembers.map(m=>{
    const d=new Date(m.follow_up_date);
    const diff=Math.round((d-now)/86400000);
    const urg=diff===0?'🔴 Today':diff===1?'🟡 Tomorrow':`🟢 In ${diff} days`;
    const lg=lifegroups.find(l=>l.id===m.lifegroup_id);
    return `<div class="fu-card">
      <div class="fu-name">${m.name} <span style="float:right;font-size:11px;font-weight:400">${urg}</span></div>
      <div class="fu-detail">${statusLabel(calcStatus(m.id))} · ${lg?.name||'—'}</div>
    </div>`;
  }).join('');

  // At-risk members
  const arList=document.getElementById('atrisk-list');
  if(arList){
    const atRisk=getAtRiskMembers().slice(0,6);
    if(!atRisk.length) arList.innerHTML=`<p class="text-muted">No at-risk members. Everyone is engaged this month! 🙌</p>`;
    else arList.innerHTML=atRisk.map(m=>{
      const lg=lifegroups.find(l=>l.id===m.lifegroup_id);
      return `<div class="fu-card" style="border-left-color:var(--coral)">
        <div class="fu-name">${m.name} <span style="float:right;font-size:11px;font-weight:400;color:var(--coral)">Missed all of ${MONTHS[new Date().getMonth()]}</span></div>
        <div class="fu-detail">${statusLabel(calcStatus(m.id))} · ${lg?.name||'—'} · ${getTotalAtt(m.id)} total att.</div>
      </div>`;
    }).join('');
  }

  // WS nurture nudges
  const wsNudge=document.getElementById('ws-nudge-list');
  if(wsNudge){
    const toInvite=getWSNurtureMembers().slice(0,5);
    if(!toInvite.length) wsNudge.innerHTML=`<p class="text-muted">No LG-only members ready to invite yet, or all have been invited.</p>`;
    else wsNudge.innerHTML=toInvite.map(m=>{
      const lg=lifegroups.find(l=>l.id===m.lifegroup_id);
      return `<div class="fu-card" style="border-left-color:var(--sage)">
        <div class="fu-name">${m.name}
          <button class="btn btn-sm btn-outline" style="float:right;font-size:11px" onclick="markWSInvited('${m.id}')">Mark Invited</button>
        </div>
        <div class="fu-detail">${getTotalAtt(m.id)} attendances · LG Only · ${lg?.name||'—'}</div>
      </div>`;
    }).join('');
  }
}

function getAtRiskMembers(){
  const now=new Date(); const yr=now.getFullYear(); const mo=now.getMonth();
  return members.filter(m=>{
    if(getTotalAtt(m.id)===0) return false; // pure invites are not at-risk
    const mAtt=attendance[m.id]||{};
    let thisMonth=0;
    for(const lgId in mAtt){
      const row=mAtt[lgId]?.[yr]?.[mo];
      if(row) for(const wk in row) if(row[wk]) thisMonth++;
    }
    return thisMonth===0;
  });
}
function getWSNurtureMembers(){
  // LG-only members with ≥4 attendances who haven't been invited to WS yet
  return members.filter(m=>m.lg_only&&!m.ws_only&&!m.lg_and_ws&&!m.ws_invited&&getTotalAtt(m.id)>=4);
}
async function markWSInvited(mid){
  const today=new Date().toISOString().slice(0,10);
  const {error}=await supabase.from('members').update({ws_invited:true,ws_invite_date:today}).eq('id',mid);
  if(error){toast('Error: '+error.message);return;}
  const m=members.find(x=>x.id===mid);
  if(m){m.ws_invited=true;m.ws_invite_date=today;}
  toast('Marked as invited to worship service ✓');
  renderDashboard();
}

function getPipelineCounts(){
  const c={invite:0,firsttimer:0,attendee:0,member:0};
  members.forEach(m=>{const s=calcStatus(m.id);c[s]++;});
  return c;
}

function buildPipeline(counts){
  return `<div class="pipeline" style="margin-bottom:16px">
    <div class="pip-stage"><div class="pip-num">${counts.invite}</div><div class="pip-label">Invites</div></div>
    <div class="pip-stage"><div class="pip-num">${counts.firsttimer}</div><div class="pip-label">First Timers</div></div>
    <div class="pip-stage"><div class="pip-num">${counts.attendee}</div><div class="pip-label">Attendees</div></div>
    <div class="pip-stage"><div class="pip-num" style="color:var(--sage)">${counts.member}</div><div class="pip-label">Members</div></div>
  </div>`;
}

function buildReminderBanner(){
  const now=new Date();
  const upcoming=reminders.filter(r=>{
    if(r.done) return false;
    const d=new Date(r.datetime);
    const diff=(d-now)/(86400000);
    return diff>=0&&diff<=3;
  });
  if(!upcoming.length) return '';
  const r=upcoming[0];
  const lg=lifegroups.find(l=>l.id===r.lifegroup_id)||{name:''};
  const d=new Date(r.datetime);
  return `<div class="reminder-banner" style="margin-bottom:16px">
    <div class="rb-label">⏰ Upcoming Commitment</div>
    <div class="rb-main">${r.title}</div>
    <div class="rb-sub">${lg.name} · ${d.toLocaleDateString('en-PH',{weekday:'long',month:'short',day:'numeric'})} at ${d.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})} · ${r.location||''}</div>
  </div>`;
}

// ══════════════════════════════════════════════════════════
// LIFE GROUPS
// ══════════════════════════════════════════════════════════
function renderLifeGroups(){
  const actions=document.getElementById('topbar-actions');
  if(actions) actions.innerHTML=`<button class="btn btn-primary btn-sm" onclick="openAddLGModal()"><i class="ti ti-plus"></i> New Group</button>`;
  const c=document.getElementById('page-container');
  c.innerHTML=lifegroups.map(lg=>buildLGCard(lg)).join('')+
    `<button class="btn btn-outline btn-block" onclick="openAddLGModal()" style="margin-top:4px"><i class="ti ti-plus"></i> Add Life Group</button>`;
}

function buildLGCard(lg){
  const isOpen=expandedLGId===lg.id;
  const lgMembers=members.filter(m=>m.lifegroup_id===lg.id);
  return `<div class="lg-card">
    <div class="lg-card-hdr" onclick="toggleLG('${lg.id}')">
      <div style="display:flex;align-items:flex-start;justify-content:space-between">
        <div>
          <div style="font-weight:700;font-size:15px">${lg.name}</div>
          <div style="font-size:11px;opacity:.65;margin-top:3px">
            <i class="ti ti-calendar" style="font-size:12px"></i> ${lg.day} &nbsp;
            <i class="ti ti-clock" style="font-size:12px"></i> ${lg.time} &nbsp;
            <i class="ti ti-map-pin" style="font-size:12px"></i> ${lg.location}
          </div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <button class="btn btn-sm" style="background:rgba(255,255,255,.15);color:#fff;border:none" onclick="event.stopPropagation();openAddMemberModal('${lg.id}')"><i class="ti ti-plus"></i></button>
          <i class="ti ti-chevron-down" style="font-size:18px;transition:transform .2s;transform:${isOpen?'rotate(180deg)':'rotate(0)'}"></i>
        </div>
      </div>
    </div>
    <div style="display:${isOpen?'block':'none'}">
      ${buildLGMemberTable(lg, lgMembers)}
    </div>
  </div>`;
}

function toggleLG(lgId){
  expandedLGId=expandedLGId===lgId?null:lgId;
  renderLifeGroups();
}

function buildLGMemberTable(lg, lgMembers){
  const now=new Date(); const yr=now.getFullYear(); const mo=now.getMonth();
  const wks=weeksInMonth(yr,mo);
  if(!lgMembers.length) return `<div style="padding:16px;color:var(--muted);font-size:13px">No members yet. Add your first member to this group.</div>`;
  const rows=lgMembers.map(m=>{
    const status=calcStatus(m.id);
    const total=getTotalAtt(m.id);
    const pct=Math.min(100,Math.round((total/14)*100));
    const att=attendance[m.id]?.[lg.id]?.[yr]?.[mo]||{};
    const checks=Array.from({length:wks},(_,i)=>{
      const wk='w'+(i+1); const p=!!att[wk];
      return `<div class="att-check ${p?'present':''}" onclick="toggleAtt('${m.id}','${lg.id}',${yr},${mo},'${wk}')" title="Week ${i+1}">${p?'✓':''}</div>`;
    }).join('');
    const progressColor=status==='member'?'var(--sage)':status==='attendee'?'var(--blue)':'var(--amber)';
    return `<tr>
      <td><div class="flex items-center gap-8">
        <div class="avatar" style="background:${avatarColor(m.name)}">${initials(m.name)}</div>
        <div>
          <div class="fw-600" style="font-size:13px">${m.name}</div>
          <div class="text-xs" style="color:var(--hint)">${m.birthdate||'—'}</div>
        </div>
      </div></td>
      <td>${statusBadge(status)}</td>
      <td>${serviceBadge(m)}</td>
      <td style="min-width:110px">
        <div class="text-xs" style="color:var(--muted);margin-bottom:3px">${total}/14 · ${pct}%</div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${progressColor}"></div></div>
      </td>
      <td><div style="display:flex;gap:3px;flex-wrap:wrap">${checks}</div></td>
      <td><button class="btn-icon btn-sm" onclick="openMemberDetail('${m.id}')"><i class="ti ti-edit"></i></button></td>
    </tr>`;
  }).join('');
  return `<div class="table-wrap">
    <table class="data-table">
      <thead><tr><th>Member</th><th>Status</th><th>Service</th><th>Progress</th><th>${MONTHS[mo]} Attendance</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

// ══════════════════════════════════════════════════════════
// ATTENDANCE
// ══════════════════════════════════════════════════════════
function renderAttendance(){
  const now=new Date(); const yr=now.getFullYear();
  const c=document.getElementById('page-container');
  c.innerHTML=`
    <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap">
      <div style="flex:1;min-width:140px">
        <label style="font-size:12px;color:var(--muted);margin-bottom:4px;display:block">Life Group</label>
        <select id="att-lg" onchange="renderAttTable()" style="width:100%">
          <option value="">All Groups</option>
          ${lifegroups.map(l=>`<option value="${l.id}">${l.name}</option>`).join('')}
        </select>
      </div>
      <div style="flex:0 0 140px">
        <label style="font-size:12px;color:var(--muted);margin-bottom:4px;display:block">Month</label>
        <select id="att-mo" onchange="renderAttTable()" style="width:100%">
          ${MONTHS.map((m,i)=>`<option value="${i}" ${i===now.getMonth()?'selected':''}>${m}</option>`).join('')}
        </select>
      </div>
    </div>
    <div id="att-table"></div>`;
  renderAttTable();
}

function renderAttTable(){
  const lgSel=document.getElementById('att-lg')?.value;
  const moSel=parseInt(document.getElementById('att-mo')?.value??new Date().getMonth());
  const yr=new Date().getFullYear(); const wks=weeksInMonth(yr,moSel);
  let mems=members;
  if(lgSel) mems=mems.filter(m=>m.lifegroup_id===lgSel);
  const container=document.getElementById('att-table');
  if(!mems.length){container.innerHTML=`<p class="text-muted">No members found.</p>`;return;}
  const rows=mems.map(m=>{
    const att=attendance[m.id]?.[m.lifegroup_id]?.[yr]?.[moSel]||{};
    const lg=lifegroups.find(l=>l.id===m.lifegroup_id);
    const total=getTotalAtt(m.id);
    const checks=Array.from({length:wks},(_,i)=>{
      const wk='w'+(i+1);const p=!!att[wk];
      return `<td style="text-align:center;padding:6px 4px">
        <div class="att-check ${p?'present':''}" onclick="toggleAtt('${m.id}','${m.lifegroup_id}',${yr},${moSel},'${wk}')">${p?'✓':''}</div>
      </td>`;
    }).join('');
    return `<tr>
      <td><div class="flex items-center gap-8">
        <div class="avatar" style="background:${avatarColor(m.name)}">${initials(m.name)}</div>
        ${m.name}
      </div></td>
      <td style="font-size:11px;color:var(--muted)">${lg?.name||'—'}</td>
      <td>${statusBadge(calcStatus(m.id))}</td>
      ${checks}
      <td><strong>${total}</strong>/14</td>
      <td>${serviceBadge(m)}</td>
    </tr>`;
  }).join('');
  container.innerHTML=`<div class="table-wrap"><table class="data-table">
    <thead><tr><th>Member</th><th>Group</th><th>Status</th>
      ${Array.from({length:wks},(_,i)=>`<th style="text-align:center">Wk ${i+1}</th>`).join('')}
      <th>Total</th><th>Type</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

async function toggleAtt(memberId, lgId, year, month, week){
  if(!attendance[memberId]) attendance[memberId]={};
  if(!attendance[memberId][lgId]) attendance[memberId][lgId]={};
  if(!attendance[memberId][lgId][year]) attendance[memberId][lgId][year]={};
  if(!attendance[memberId][lgId][year][month]) attendance[memberId][lgId][year][month]={};
  const prev=!!attendance[memberId][lgId][year][month][week];
  const next=!prev;
  attendance[memberId][lgId][year][month][week]=next;

  // Upsert to Supabase
  await supabase.from('attendance').upsert({
    member_id:memberId, lifegroup_id:lgId,
    year:parseInt(year), month:parseInt(month), week,
    present:next
  },{onConflict:'member_id,lifegroup_id,year,month,week'});

  // Refresh current page
  if(currentPage==='attendance') renderAttTable();
  if(currentPage==='lifegroups') renderLifeGroups();
  if(currentPage==='dashboard') renderDashboard();
}

// ══════════════════════════════════════════════════════════
// MEMBERS
// ══════════════════════════════════════════════════════════
function renderMembers(){
  const actions=document.getElementById('topbar-actions');
  if(actions) actions.innerHTML=`<button class="btn btn-primary btn-sm" onclick="openAddMemberModal()"><i class="ti ti-plus"></i> Add</button>`;
  const c=document.getElementById('page-container');
  c.innerHTML=`
    <div class="search-wrap"><i class="ti ti-search"></i><input type="text" id="mem-search" placeholder="Search members..." oninput="refreshMembersTable()"></div>
    <div class="tab-row">
      <div class="tab active" onclick="setMemTab('all',this)">All</div>
      <div class="tab" onclick="setMemTab('invite',this)">Invites</div>
      <div class="tab" onclick="setMemTab('firsttimer',this)">First Timers</div>
      <div class="tab" onclick="setMemTab('attendee',this)">Attendees</div>
      <div class="tab" onclick="setMemTab('member',this)">Members</div>
    </div>
    <div id="mem-table"></div>`;
  refreshMembersTable();
}
function setMemTab(tab,el){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active'); memberTabFilter=tab; refreshMembersTable();
}
function refreshMembersTable(){
  const q=(document.getElementById('mem-search')?.value||'').toLowerCase();
  let mems=members.filter(m=>{
    if(q&&!m.name.toLowerCase().includes(q)) return false;
    if(memberTabFilter!=='all'&&calcStatus(m.id)!==memberTabFilter) return false;
    return true;
  });
  const rows=mems.map(m=>{
    const s=calcStatus(m.id); const total=getTotalAtt(m.id);
    const pct=Math.min(100,Math.round((total/14)*100));
    const lg=lifegroups.find(l=>l.id===m.lifegroup_id);
    return `<tr>
      <td><div class="flex items-center gap-8">
        <div class="avatar" style="background:${avatarColor(m.name)}">${initials(m.name)}</div>
        <div><div class="fw-600" style="font-size:13px">${m.name}</div>
          <div class="text-xs" style="color:var(--hint)">${m.phone||'—'}</div>
        </div>
      </div></td>
      <td class="text-xs" style="color:var(--muted)">${lg?.name||'—'}</td>
      <td>${statusBadge(s)}</td>
      <td style="min-width:90px">
        <div class="text-xs" style="color:var(--muted);margin-bottom:2px">${total}/14</div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:var(--sage)"></div></div>
      </td>
      <td>${serviceBadge(m)}</td>
      <td class="text-xs" style="color:var(--muted)">${m.follow_up_date||'—'}</td>
      <td><button class="btn-icon btn-sm" onclick="openMemberDetail('${m.id}')"><i class="ti ti-edit"></i></button></td>
    </tr>`;
  }).join('');
  document.getElementById('mem-table').innerHTML=`<div class="table-wrap"><table class="data-table">
    <thead><tr><th>Member</th><th>Group</th><th>Status</th><th>Progress</th><th>Service</th><th>Follow-Up</th><th></th></tr></thead>
    <tbody>${rows||'<tr><td colspan="7" class="text-muted" style="padding:16px">No members found.</td></tr>'}</tbody>
  </table></div>`;
}

// ══════════════════════════════════════════════════════════
// TEACHINGS
// ══════════════════════════════════════════════════════════
function renderTeachings(){
  const actions=document.getElementById('topbar-actions');
  if(actions) actions.innerHTML=`<button class="btn btn-primary btn-sm" onclick="openAddTeachingModal()"><i class="ti ti-plus"></i> Add</button>`;
  const c=document.getElementById('page-container');
  c.innerHTML=`<div class="tab-row">
    <div class="tab active" onclick="setTchTab('all',this)">All</div>
    <div class="tab" onclick="setTchTab('salvation',this)">Salvation</div>
    <div class="tab" onclick="setTchTab('discipleship',this)">Discipleship</div>
    <div class="tab" onclick="setTchTab('leadership',this)">Leadership</div>
    <div class="tab" onclick="setTchTab('custom',this)">My Custom</div>
  </div>
  <div id="tch-list"></div>`;
  refreshTeachings();
}
function setTchTab(tab,el){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active'); teachingTabFilter=tab; refreshTeachings();
}
function refreshTeachings(){
  const list=document.getElementById('tch-list');
  const filtered=teachingTabFilter==='all'?teachings:
    teachingTabFilter==='custom'?teachings.filter(t=>t.is_custom):
    teachings.filter(t=>t.category===teachingTabFilter);
  list.innerHTML=filtered.map(t=>`
    <div class="teaching-card">
      <div class="t-icon"><i class="ti ti-book-2"></i></div>
      <div style="flex:1">
        <div style="font-weight:700;font-size:14px;color:var(--navy)">${t.title}</div>
        <div class="text-xs" style="color:var(--muted);margin:2px 0">${t.stage} · ${t.resource}</div>
        <div style="font-size:13px;color:var(--text);margin-top:4px">${t.description}</div>
      </div>
      ${t.is_custom?`<button class="btn-icon btn-sm" onclick="deleteTeaching('${t.id}')"><i class="ti ti-trash" style="color:var(--coral)"></i></button>`:''}
    </div>`).join('')||`<p class="text-muted">No teachings in this category.</p>`;
}
async function deleteTeaching(id){
  if(!confirm('Delete this teaching?')) return;
  await supabase.from('teachings').delete().eq('id',id);
  teachings=teachings.filter(t=>t.id!==id);
  refreshTeachings();
}

// ══════════════════════════════════════════════════════════
// REMINDERS
// ══════════════════════════════════════════════════════════
function renderReminders(){
  const actions=document.getElementById('topbar-actions');
  if(actions) actions.innerHTML=`<button class="btn btn-outline btn-sm" onclick="openAddReminderModal()"><i class="ti ti-plus"></i> Add</button>`;
  const c=document.getElementById('page-container');
  if(!reminders.length){c.innerHTML=`<p class="text-muted">No reminders set. Add one to get notified before your life group sessions.</p>`;return;}
  c.innerHTML=reminders.map(r=>{
    const lg=lifegroups.find(l=>l.id===r.lifegroup_id)||{name:'All Groups'};
    const d=new Date(r.datetime);
    return `<div class="card" style="opacity:${r.done?.7:1}">
      <div class="flex gap-12 items-center">
        <input type="checkbox" ${r.done?'checked':''} onchange="toggleReminder('${r.id}',this.checked)" style="width:18px;height:18px;cursor:pointer">
        <div style="flex:1">
          <div style="font-weight:700;font-size:14px;${r.done?'text-decoration:line-through;color:var(--muted)':''}">${r.title}</div>
          <div class="text-xs" style="color:var(--muted);margin-top:3px">
            ${lg.name} · ${d.toLocaleDateString('en-PH',{weekday:'long',month:'short',day:'numeric'})} at ${d.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})}
            ${r.location?` · ${r.location}`:''}
          </div>
          ${r.notes?`<div class="text-xs" style="margin-top:5px;background:var(--bg);padding:6px 8px;border-radius:5px">${r.notes}</div>`:''}
        </div>
        <button class="btn-icon btn-sm" onclick="deleteReminder('${r.id}')"><i class="ti ti-trash" style="color:var(--coral)"></i></button>
      </div>
    </div>`;
  }).join('');
}
async function toggleReminder(id,done){
  await supabase.from('reminders').update({done}).eq('id',id);
  const r=reminders.find(r=>r.id===id); if(r) r.done=done;
  renderReminders();
}
async function deleteReminder(id){
  await supabase.from('reminders').delete().eq('id',id);
  reminders=reminders.filter(r=>r.id!==id);
  renderReminders();
}

// ══════════════════════════════════════════════════════════
// AI COACH
// ══════════════════════════════════════════════════════════
function renderAICoach(){
  document.getElementById('page-container').innerHTML=`
    <div class="card" style="margin-bottom:12px">
      <div class="text-muted" style="margin-bottom:10px">Ask anything about your life group, member needs, follow-up strategies, or teaching approaches — grounded in JIL's values and pastoral heart. I have full context of your current data.</div>
      <div id="ai-convo" style="min-height:60px;margin-bottom:10px"></div>
      <div class="flex gap-8">
        <input id="ai-input" placeholder="e.g. How should I approach a first-timer who missed 2 sessions?" style="flex:1" onkeydown="if(event.key==='Enter')askAI()">
        <button class="btn btn-primary" onclick="askAI()"><i class="ti ti-send"></i></button>
      </div>
    </div>
    <div style="margin-bottom:10px;font-weight:600;font-size:13px;color:var(--navy)">Quick Prompts</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <button class="btn btn-outline" onclick="quickAsk('Which members need a follow-up visit this week?')">Who needs follow-up?</button>
      <button class="btn btn-outline" onclick="quickAsk('Suggest a teaching for someone struggling with consistency.')">Teaching suggestion</button>
      <button class="btn btn-outline" onclick="quickAsk('Give me tips to gently invite my attendees to worship service.')">Worship invitation tips</button>
      <button class="btn btn-outline" onclick="quickAsk('How do I accurately track discipleship progress for my life group?')">Tracking best practices</button>
      <button class="btn btn-outline" onclick="quickAsk('How do I handle a member who has become spiritually cold?')">Spiritually cold member</button>
      <button class="btn btn-outline" onclick="quickAsk('What are the best practices for running a weekly bible study?')">Bible study tips</button>
    </div>`;
}
async function askAI(){
  const input=document.getElementById('ai-input');
  const q=input.value.trim(); if(!q) return;
  input.value='';
  const convo=document.getElementById('ai-convo');
  const counts=getPipelineCounts();
  const ctx=`You are an AI pastoral coach for the JIL (Jesus Is Lord) Church Worldwide Ministry Information System. JIL is a Filipino full-Gospel evangelical church founded in 1978 by Bro. Eddie Villanueva, with members in 60+ countries. Its mission is to bring all peoples to the kingdom of the living God through the saving, healing, delivering, and transforming power of the Lord Jesus Christ. Core values: Passionate Love for God, Love and Compassion for Others, Integrity, Faithfulness, Excellence.
Current data: ${members.length} members across ${lifegroups.length} life groups.
Pipeline: Invites: ${counts.invite}, First Timers: ${counts.firsttimer}, Attendees: ${counts.attendee}, Members: ${counts.member}.
Life groups: ${lifegroups.map(l=>l.name).join(', ')}.
Leader category: ${userProfile?.category||'not set'}. Ministry: ${userProfile?.ministry||'not set'}.
Status thresholds: First Timer = 1-3 attendances, Attendee = 4-13, Member = 14+.
Be warm, hopeful, faith-centered, and encouraging — never judgmental or condemning. Speak with a pastoral heart rooted in Scripture. Be sensitive to both English and Filipino/Tagalog-speaking users. Offer to pray when relevant. Answer concisely and practically. Use bullet points when helpful.`;
  convo.innerHTML+=`<div class="ai-msg user">${q}</div>
    <div class="ai-msg bot thinking" id="ai-thinking">Thinking...</div>`;
  convo.scrollTop=convo.scrollHeight;
  try{
    // Calls the Supabase Edge Function (api key stays server-side)
    const {data,error}=await supabase.functions.invoke('ai-coach',{
      body:{question:q,context:ctx}
    });
    const ans=data?.answer||'Unable to respond.';
    const el=document.getElementById('ai-thinking');
    if(el){el.classList.remove('thinking');el.innerHTML=ans.replace(/\n/g,'<br>').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\*(.*?)\*/g,'<em>$1</em>');}
    if(error) throw error;
  }catch(e){
    const el=document.getElementById('ai-thinking');
    if(el) el.innerHTML='Could not reach AI. Make sure the Edge Function is deployed and ANTHROPIC_API_KEY is set.';
  }
  convo.scrollTop=convo.scrollHeight;
}
function quickAsk(q){ document.getElementById('ai-input').value=q; askAI(); }

// ══════════════════════════════════════════════════════════
// ADMIN HUB
// ══════════════════════════════════════════════════════════
function renderAdminHub(){
  const counts=getPipelineCounts();
  const total=members.length;
  const cvRate=total?Math.round((counts.member/total)*100):0;
  const score=total?Math.round(((counts.member*3+counts.attendee*2+counts.firsttimer)/(total*3))*100):0;
  const scoreColor=score>=70?'var(--sage)':score>=40?'var(--amber)':'var(--coral)';
  const actions=document.getElementById('topbar-actions');
  if(actions) actions.innerHTML=`<button class="btn btn-outline btn-sm" onclick="exportReport()"><i class="ti ti-download"></i> Export</button>`;

  const lgRows=lifegroups.map(lg=>{
    const mems=members.filter(m=>m.lifegroup_id===lg.id);
    const s={invite:0,firsttimer:0,attendee:0,member:0};
    mems.forEach(m=>{const st=calcStatus(m.id);s[st]++;});
    return `<tr>
      <td><strong>${lg.name}</strong><br><span class="text-xs" style="color:var(--muted)">${lg.day} · ${lg.time}</span></td>
      <td>${mems.length}</td>
      <td>${s.invite}</td><td>${s.firsttimer}</td><td>${s.attendee}</td>
      <td><strong style="color:var(--sage)">${s.member}</strong></td>
    </tr>`;
  }).join('');

  document.getElementById('page-container').innerHTML=`
    <div class="stat-grid" style="margin-bottom:16px">
      <div class="stat-card"><div class="stat-label">Total Contacts</div><div class="stat-num">${total}</div><div class="stat-sub">Church-wide</div></div>
      <div class="stat-card"><div class="stat-label">Full Members</div><div class="stat-num">${counts.member}</div><div class="stat-sub">14+ attendances</div></div>
      <div class="stat-card"><div class="stat-label">Conversion Rate</div><div class="stat-num">${cvRate}%</div><div class="stat-sub">Invite → Member</div></div>
      <div class="stat-card"><div class="stat-label">Bible Studies</div><div class="stat-num">${bibleStudyLog.length}</div><div class="stat-sub">All time</div></div>
    </div>
    <div style="margin-bottom:10px;font-weight:700;font-size:14px;color:var(--navy)">Church-Wide Pipeline</div>
    ${buildPipeline(counts)}
    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><div class="card-title">Life Group Performance</div></div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Life Group</th><th>Total</th><th>Invites</th><th>1st Timers</th><th>Attendees</th><th>Members</th></tr></thead>
        <tbody>${lgRows||'<tr><td colspan="6" class="text-muted" style="padding:16px">No life groups yet.</td></tr>'}</tbody>
      </table></div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">Church Health Score</div></div>
      <div class="flex gap-16 items-center">
        <div class="health-ring" style="color:${scoreColor};border-color:${scoreColor}">${score}%</div>
        <div style="flex:1">
          <div class="progress-bar" style="height:10px;margin-bottom:8px"><div class="progress-fill" style="width:${score}%;background:${scoreColor}"></div></div>
          <div class="text-xs" style="color:var(--muted)">70%+ = Healthy · Based on pipeline distribution weighted by stage depth. Focus on moving First Timers and Attendees toward membership.</div>
        </div>
      </div>
    </div>
    ${buildDemographicBreakdown()}
    ${buildWSConversionPanel()}`;
}

function buildDemographicBreakdown(){
  const cats=['Men','Women','YAN','KKB','Children'];
  const data={};
  cats.forEach(c=>data[c]={total:0,firsttimer:0,attendee:0,member:0});
  data['Not Set']={total:0,firsttimer:0,attendee:0,member:0};
  members.forEach(m=>{
    const cat=m.category&&cats.includes(m.category)?m.category:'Not Set';
    data[cat].total++;
    const s=calcStatus(m.id);
    if(s==='member') data[cat].member++;
    else if(s==='attendee') data[cat].attendee++;
    else if(s==='firsttimer') data[cat].firsttimer++;
  });
  const keys=[...cats,'Not Set'].filter(c=>data[c].total>0);
  const rows=keys.map(c=>`<tr>
    <td>${c}</td>
    <td><strong>${data[c].total}</strong></td>
    <td>${data[c].firsttimer}</td>
    <td>${data[c].attendee}</td>
    <td style="color:var(--sage);font-weight:700">${data[c].member}</td>
  </tr>`).join('');
  return `<div class="card" style="margin-top:12px">
    <div class="card-header"><div class="card-title">Demographic Breakdown</div></div>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Category</th><th>Total</th><th>1st Timers</th><th>Attendees</th><th>Members</th></tr></thead>
      <tbody>${rows||'<tr><td colspan="5" class="text-muted" style="padding:16px">No category data yet. Update member profiles to see demographics.</td></tr>'}</tbody>
    </table></div>
  </div>`;
}

function buildWSConversionPanel(){
  const lgOnly=members.filter(m=>m.lg_only&&!m.ws_only&&!m.lg_and_ws);
  const invited=lgOnly.filter(m=>m.ws_invited);
  const converted=members.filter(m=>m.lg_and_ws).length;
  return `<div class="card" style="margin-top:12px">
    <div class="card-header"><div class="card-title">Worship Service Conversion</div></div>
    <div class="stat-grid" style="margin:0">
      <div class="stat-card"><div class="stat-label">LG Only</div><div class="stat-num">${lgOnly.length}</div><div class="stat-sub">Not yet in WS</div></div>
      <div class="stat-card"><div class="stat-label">WS Invited</div><div class="stat-num">${invited.length}</div><div class="stat-sub">Invitation sent</div></div>
      <div class="stat-card"><div class="stat-label">LG + WS</div><div class="stat-num" style="color:var(--sage)">${converted}</div><div class="stat-sub">Target reached</div></div>
    </div>
  </div>`;
}

function exportReport(){
  const now=new Date();
  const counts=getPipelineCounts();
  const rows=[
    ['Church MIS Report — '+now.toLocaleDateString()],[''],
    ['Leader',userProfile?.name||''],
    ['Church',userProfile?.church||''],
    [''],['=== PIPELINE ==='],
    ['Invites',counts.invite],['First Timers',counts.firsttimer],
    ['Attendees',counts.attendee],['Members',counts.member],
    [''],['=== LIFE GROUPS ==='],
    ['Group','Day','Time','Location','Total Members','Members']
  ];
  lifegroups.forEach(lg=>{
    const mems=members.filter(m=>m.lifegroup_id===lg.id);
    const memCount=mems.filter(m=>calcStatus(m.id)==='member').length;
    rows.push([lg.name,lg.day,lg.time,lg.location,mems.length,memCount]);
  });
  rows.push([''],['=== ALL MEMBERS ==='],
    ['Name','Life Group','Status','Total Attendance','Service Type','Follow-Up Date']);
  members.forEach(m=>{
    const lg=lifegroups.find(l=>l.id===m.lifegroup_id);
    const svc=m.lg_and_ws?'LG+WS':m.lg_only?'LG Only':m.ws_only?'WS Only':'Not Set';
    rows.push([m.name,lg?.name||'',statusLabel(calcStatus(m.id)),getTotalAtt(m.id),svc,m.follow_up_date||'']);
  });
  const csv=rows.map(r=>r.join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download=`church_mis_report_${now.toISOString().slice(0,10)}.csv`; a.click();
  toast('Report exported as CSV ✓');
}

// ══════════════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════════════
function renderSettings(){
  const u=userProfile||{};
  document.getElementById('page-container').innerHTML=`
    <div class="card">
      <div class="card-header"><div class="card-title">Profile Information</div></div>
      <div class="form-grid-2">
        <div class="form-row"><label>Full Name</label><input id="s-name" value="${u.name||''}"></div>
        <div class="form-row"><label>Church Name</label><input id="s-church" value="${u.church||''}"></div>
        <div class="form-row"><label>Designation</label><input id="s-desig" value="${u.designation||''}"></div>
        <div class="form-row"><label>Role</label><input id="s-role" value="${u.role||''}"></div>
        <div class="form-row"><label>Ministry</label><input id="s-ministry" value="${u.ministry||''}"></div>
        <div class="form-row"><label>Category</label><input id="s-cat" value="${u.category||''}"></div>
      </div>
      <button class="btn btn-primary" onclick="saveSettings()">Save Changes</button>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">Account</div></div>
      <div class="text-muted" style="margin-bottom:12px">Signed in as: ${currentUser?.email||''}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-outline" onclick="exportFullData()"><i class="ti ti-download"></i> Export Data</button>
        <button class="btn btn-danger" onclick="doLogout()"><i class="ti ti-logout"></i> Sign Out</button>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">Install App</div></div>
      <div class="text-muted" style="margin-bottom:12px">Install Church MIS on your device for offline access:</div>
      <div style="font-size:13px;line-height:1.8">
        <strong>Android:</strong> Tap the menu (⋮) → "Add to Home Screen"<br>
        <strong>iOS (Safari):</strong> Tap Share (↑) → "Add to Home Screen"<br>
        <strong>Desktop (Chrome/Edge):</strong> Click the install icon (⊕) in the address bar
      </div>
      <button class="btn btn-primary mt-12" onclick="triggerInstall()"><i class="ti ti-download"></i> Install Now</button>
    </div>`;
}
async function saveSettings(){
  const updates={
    name:document.getElementById('s-name').value,
    church:document.getElementById('s-church').value,
    designation:document.getElementById('s-desig').value,
    role:document.getElementById('s-role').value,
    ministry:document.getElementById('s-ministry').value,
    category:document.getElementById('s-cat').value,
  };
  const {error}=await supabase.from('profiles').update(updates).eq('id',currentUser.id);
  if(error){toast('Error: '+error.message);return;}
  Object.assign(userProfile,updates);
  updateSidebarUser(); toast('Settings saved ✓');
}
function exportFullData(){
  const data=JSON.stringify({userProfile,lifegroups,members,attendance,teachings,reminders,bibleStudyLog},null,2);
  const blob=new Blob([data],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download=`church_mis_backup_${new Date().toISOString().slice(0,10)}.json`; a.click();
  toast('Data exported ✓');
}

// PWA install prompt
let deferredInstall=null;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;});
function triggerInstall(){
  if(deferredInstall){deferredInstall.prompt();deferredInstall=null;}
  else toast('Use your browser menu to install the app.');
}

// ══════════════════════════════════════════════════════════
// MODALS
// ══════════════════════════════════════════════════════════
function openModal(html){
  document.getElementById('modal-content').innerHTML=`<div class="modal-handle"></div>${html}`;
  document.getElementById('modal-overlay').classList.remove('hidden');
}
function closeModal(){
  document.getElementById('modal-overlay').classList.add('hidden');
}

function openAddMemberModal(lgId){
  const lgOpts=lifegroups.map(l=>`<option value="${l.id}" ${l.id===lgId?'selected':''}>${l.name}</option>`).join('');
  openModal(`
    <h3>Add Member</h3>
    <div class="form-grid-2">
      <div class="form-row"><label>Full Name *</label><input id="am-name" placeholder="Full name"></div>
      <div class="form-row"><label>Phone</label><input id="am-phone" placeholder="09XX-XXX-XXXX" type="tel"></div>
    </div>
    <div class="form-grid-2">
      <div class="form-row"><label>Birthdate</label><input id="am-bdate" type="date" oninput="suggestCategory(this.value,'am-cat')"></div>
      <div class="form-row"><label>Life Group *</label><select id="am-lg">${lgOpts}</select></div>
    </div>
    <div class="form-row"><label>Key Observations / Current Struggles</label><textarea id="am-obs" rows="3" placeholder="e.g. Going through a difficult season, needs pastoral care..."></textarea></div>
    <div class="form-grid-2">
      <div class="form-row"><label>Follow-Up Date</label><input id="am-fu" type="date"></div>
      <div class="form-row"><label>Service Type</label>
        <select id="am-type">
          <option value="">Not Set</option>
          <option value="lgOnly">LG Only</option>
          <option value="wsOnly">WS Only</option>
          <option value="lgAndWs">LG + Worship Service</option>
        </select>
      </div>
    </div>
    <div class="form-row"><label>Demographic Category <span class="text-xs" style="color:var(--hint)">(auto-fills from birthdate for ≤34)</span></label>
      <select id="am-cat">
        <option value="">Not Set</option>
        <option value="Children">Children (≤12)</option>
        <option value="KKB">KKB (13–24)</option>
        <option value="YAN">YAN — Young Adults (25–34)</option>
        <option value="Men">Men (35+)</option>
        <option value="Women">Women (35+)</option>
      </select>
    </div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn btn-outline" style="flex:1" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" style="flex:2" onclick="saveMember()">Add Member</button>
    </div>`);
}

async function saveMember(){
  const name=document.getElementById('am-name').value.trim();
  if(!name){toast('Name is required');return;}
  const lgId=document.getElementById('am-lg').value;
  const type=document.getElementById('am-type').value;
  const {data,error}=await supabase.from('members').insert({
    name, phone:document.getElementById('am-phone').value,
    birthdate:document.getElementById('am-bdate').value||null,
    lifegroup_id:lgId,
    observation:document.getElementById('am-obs').value,
    follow_up_date:document.getElementById('am-fu').value||null,
    lg_only:type==='lgOnly', ws_only:type==='wsOnly', lg_and_ws:type==='lgAndWs',
    category:document.getElementById('am-cat').value||null,
    ws_invited:false,
  }).select().single();
  if(error){toast('Error: '+error.message);return;}
  members.push(data); closeModal();
  toast(`${name} added ✓`);
  if(currentPage==='dashboard') renderDashboard();
  if(currentPage==='lifegroups') renderLifeGroups();
  if(currentPage==='members') refreshMembersTable();
}

function openMemberDetail(mid){
  const m=members.find(x=>x.id===mid); if(!m) return;
  const lgOpts=lifegroups.map(l=>`<option value="${l.id}" ${l.id===m.lifegroup_id?'selected':''}>${l.name}</option>`).join('');
  const total=getTotalAtt(mid); const status=calcStatus(mid);
  openModal(`
    <h3>${m.name}</h3>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${statusBadge(status)} ${serviceBadge(m)} <span class="badge" style="background:var(--bg);color:var(--muted)">${total} attendance</span></div>
    <div class="form-grid-2">
      <div class="form-row"><label>Full Name</label><input id="ed-name" value="${m.name}"></div>
      <div class="form-row"><label>Phone</label><input id="ed-phone" value="${m.phone||''}"></div>
    </div>
    <div class="form-grid-2">
      <div class="form-row"><label>Birthdate</label><input id="ed-bdate" type="date" value="${m.birthdate||''}" oninput="suggestCategory(this.value,'ed-cat')"></div>
      <div class="form-row"><label>Life Group</label><select id="ed-lg">${lgOpts}</select></div>
    </div>
    <div class="form-row"><label>Key Observations / Struggles</label><textarea id="ed-obs" rows="3">${m.observation||''}</textarea></div>
    <div class="form-grid-2">
      <div class="form-row"><label>Follow-Up Date</label><input id="ed-fu" type="date" value="${m.follow_up_date||''}"></div>
      <div class="form-row"><label>Service Type</label>
        <select id="ed-type">
          <option value="">Not Set</option>
          <option value="lgOnly" ${m.lg_only?'selected':''}>LG Only</option>
          <option value="wsOnly" ${m.ws_only?'selected':''}>WS Only</option>
          <option value="lgAndWs" ${m.lg_and_ws?'selected':''}>LG + WS</option>
        </select>
      </div>
    </div>
    <div class="form-grid-2">
      <div class="form-row"><label>Demographic Category</label>
        <select id="ed-cat">
          <option value="">Not Set</option>
          <option value="Children" ${m.category==='Children'?'selected':''}>Children (≤12)</option>
          <option value="KKB" ${m.category==='KKB'?'selected':''}>KKB (13–24)</option>
          <option value="YAN" ${m.category==='YAN'?'selected':''}>YAN — Young Adults (25–34)</option>
          <option value="Men" ${m.category==='Men'?'selected':''}>Men (35+)</option>
          <option value="Women" ${m.category==='Women'?'selected':''}>Women (35+)</option>
        </select>
      </div>
      <div class="form-row"><label>WS Invited?</label>
        <div style="display:flex;align-items:center;gap:10px;margin-top:8px">
          <label style="display:flex;align-items:center;gap:6px;font-size:14px;font-weight:400">
            <input type="checkbox" id="ed-wsinv" ${m.ws_invited?'checked':''} style="width:16px;height:16px">
            Invited to worship service
          </label>
        </div>
      </div>
    </div>
    <div class="form-row" id="ws-date-row" style="${m.ws_invited?'':'display:none'}">
      <label>WS Invite Date</label>
      <input id="ed-wsdate" type="date" value="${m.ws_invite_date||''}">
    </div>
    <script>document.getElementById('ed-wsinv')?.addEventListener('change',function(){document.getElementById('ws-date-row').style.display=this.checked?'':'none';})<\/script>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn btn-danger btn-sm" onclick="deleteMember('${mid}')"><i class="ti ti-trash"></i></button>
      <div style="flex:1"></div>
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="updateMember('${mid}')">Save</button>
    </div>`);
}

async function updateMember(mid){
  const type=document.getElementById('ed-type').value;
  const updates={
    name:document.getElementById('ed-name').value,
    phone:document.getElementById('ed-phone').value,
    birthdate:document.getElementById('ed-bdate').value||null,
    lifegroup_id:document.getElementById('ed-lg').value,
    observation:document.getElementById('ed-obs').value,
    follow_up_date:document.getElementById('ed-fu').value||null,
    lg_only:type==='lgOnly', ws_only:type==='wsOnly', lg_and_ws:type==='lgAndWs',
    category:document.getElementById('ed-cat').value||null,
    ws_invited:document.getElementById('ed-wsinv')?.checked||false,
    ws_invite_date:document.getElementById('ed-wsdate')?.value||null,
  };
  const {error}=await supabase.from('members').update(updates).eq('id',mid);
  if(error){toast('Error: '+error.message);return;}
  const m=members.find(x=>x.id===mid); if(m) Object.assign(m,updates);
  closeModal(); toast('Saved ✓');
  if(currentPage==='lifegroups') renderLifeGroups();
  if(currentPage==='members') refreshMembersTable();
  if(currentPage==='dashboard') renderDashboard();
}

async function deleteMember(mid){
  if(!confirm('Remove this member? Their attendance records will also be deleted.')) return;
  await supabase.from('attendance').delete().eq('member_id',mid);
  await supabase.from('members').delete().eq('id',mid);
  members=members.filter(m=>m.id!==mid); delete attendance[mid];
  closeModal(); toast('Member removed');
  if(currentPage==='lifegroups') renderLifeGroups();
  if(currentPage==='members') refreshMembersTable();
  if(currentPage==='dashboard') renderDashboard();
}

function openAddLGModal(){
  openModal(`
    <h3>New Life Group</h3>
    <div class="form-row"><label>Name *</label><input id="lg-name" placeholder="e.g. The Upper Room"></div>
    <div class="form-grid-2">
      <div class="form-row"><label>Meeting Day</label>
        <select id="lg-day">${DAYS.map(d=>`<option>${d}</option>`).join('')}</select>
      </div>
      <div class="form-row"><label>Time</label><input id="lg-time" type="time" value="19:00"></div>
    </div>
    <div class="form-row"><label>Location / Venue</label><input id="lg-loc" placeholder="Address or landmark"></div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn btn-outline" style="flex:1" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" style="flex:2" onclick="saveLG()">Create Group</button>
    </div>`);
}
async function saveLG(){
  const name=document.getElementById('lg-name').value.trim();
  if(!name){toast('Name required');return;}
  const {data,error}=await supabase.from('lifegroups').insert({
    name, leader_id:currentUser.id,
    day:document.getElementById('lg-day').value,
    time:document.getElementById('lg-time').value,
    location:document.getElementById('lg-loc').value,
  }).select().single();
  if(error){toast('Error: '+error.message);return;}
  lifegroups.push(data); closeModal(); toast(`${name} created ✓`);
  if(currentPage==='lifegroups') renderLifeGroups();
  if(currentPage==='dashboard') renderDashboard();
}

function openAddTeachingModal(){
  openModal(`
    <h3>Add Teaching</h3>
    <div class="form-row"><label>Title *</label><input id="tc-title" placeholder="Teaching title"></div>
    <div class="form-grid-2">
      <div class="form-row"><label>Category</label>
        <select id="tc-cat"><option value="salvation">Salvation</option><option value="discipleship">Discipleship</option><option value="leadership">Leadership</option></select>
      </div>
      <div class="form-row"><label>Stage</label>
        <select id="tc-stage"><option>Early</option><option>Mid</option><option>Advanced</option></select>
      </div>
    </div>
    <div class="form-row"><label>Bible Reference</label><input id="tc-ref" placeholder="e.g. John 3:16"></div>
    <div class="form-row"><label>Description</label><textarea id="tc-desc" rows="3" placeholder="Brief overview..."></textarea></div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn btn-outline" style="flex:1" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" style="flex:2" onclick="saveTeaching()">Add Teaching</button>
    </div>`);
}
async function saveTeaching(){
  const title=document.getElementById('tc-title').value.trim();
  if(!title){toast('Title required');return;}
  const {data,error}=await supabase.from('teachings').insert({
    title, leader_id:currentUser.id,
    category:document.getElementById('tc-cat').value,
    stage:document.getElementById('tc-stage').value,
    resource:document.getElementById('tc-ref').value,
    description:document.getElementById('tc-desc').value,
    is_custom:true,
  }).select().single();
  if(error){toast('Error: '+error.message);return;}
  teachings.push(data); closeModal(); refreshTeachings(); toast('Teaching added ✓');
}

function openAddReminderModal(){
  const lgOpts=lifegroups.map(l=>`<option value="${l.id}">${l.name}</option>`).join('');
  openModal(`
    <h3>Add Reminder</h3>
    <div class="form-row"><label>Title *</label><input id="rm-title" placeholder="e.g. Wednesday Bible Study"></div>
    <div class="form-grid-2">
      <div class="form-row"><label>Life Group</label><select id="rm-lg">${lgOpts}</select></div>
      <div class="form-row"><label>Date &amp; Time</label><input id="rm-dt" type="datetime-local"></div>
    </div>
    <div class="form-row"><label>Location</label><input id="rm-loc" placeholder="Venue or address"></div>
    <div class="form-row"><label>Notes</label><textarea id="rm-notes" rows="2" placeholder="Preparation notes..."></textarea></div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn btn-outline" style="flex:1" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" style="flex:2" onclick="saveReminder()">Add Reminder</button>
    </div>`);
}
async function saveReminder(){
  const title=document.getElementById('rm-title').value.trim();
  if(!title){toast('Title required');return;}
  const {data,error}=await supabase.from('reminders').insert({
    title, leader_id:currentUser.id,
    lifegroup_id:document.getElementById('rm-lg').value,
    datetime:document.getElementById('rm-dt').value,
    location:document.getElementById('rm-loc').value,
    notes:document.getElementById('rm-notes').value,
    done:false,
  }).select().single();
  if(error){toast('Error: '+error.message);return;}
  reminders.push(data); closeModal(); toast('Reminder added ✓');
  if(currentPage==='reminders') renderReminders();
}

function openLogBSModal(){
  const lgOpts=lifegroups.map(l=>`<option value="${l.id}">${l.name}</option>`).join('');
  openModal(`
    <h3>Log Bible Study Session</h3>
    <div class="form-grid-2">
      <div class="form-row"><label>Life Group *</label><select id="bs-lg">${lgOpts}</select></div>
      <div class="form-row"><label>Date *</label><input id="bs-date" type="date" value="${new Date().toISOString().slice(0,10)}"></div>
    </div>
    <div class="form-row"><label>Topic / Teaching Used</label><input id="bs-topic" placeholder="e.g. Identity in Christ, Romans 8"></div>
    <div class="form-row"><label>Notes / Highlights</label><textarea id="bs-notes" rows="3" placeholder="Key takeaways, who attended, prayer requests..."></textarea></div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn btn-outline" style="flex:1" onclick="closeModal()">Cancel</button>
      <button class="btn btn-gold" style="flex:2" onclick="saveBS()">Log Session ✓</button>
    </div>`);
}
async function saveBS(){
  const {data,error}=await supabase.from('bible_study_log').insert({
    lifegroup_id:document.getElementById('bs-lg').value,
    leader_id:currentUser.id,
    date:document.getElementById('bs-date').value,
    topic:document.getElementById('bs-topic').value,
    notes:document.getElementById('bs-notes').value,
  }).select().single();
  if(error){toast('Error: '+error.message);return;}
  bibleStudyLog.unshift(data); closeModal(); toast('Session logged ✓');
  if(currentPage==='dashboard') renderDashboard();
}

// ══════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════
async function init(){
  if(!supabase){
    document.getElementById('auth-screen').innerHTML=`<div style="color:#fff;text-align:center;padding:40px;font-family:sans-serif">
      <h2 style="margin-bottom:12px">⚠️ Configuration Required</h2>
      <p>Please edit <code>config.js</code> and add your Supabase URL and API key.<br>See the README for instructions.</p>
    </div>`;
    return;
  }
  const {data:{session}}=await supabase.auth.getSession();
  if(session){
    currentUser=session.user;
    window.rbac=new RBACService();
    await window.rbac.loadUserRole(supabase,session.user.id);
    const {data:profile}=await supabase.from('profiles').select('*').eq('id',session.user.id).single();
    if(profile){ userProfile=profile; await loadAllData(); launchApp(); }
    else showScreen('onboard');
  } else {
    showScreen('auth');
  }
  supabase.auth.onAuthStateChange(async(event,session)=>{
    if(event==='SIGNED_OUT'){ showScreen('auth'); }
  });
}

// CSS helper for section titles
document.head.insertAdjacentHTML('beforeend',`<style>
.sec-title{font-size:14px;font-weight:700;color:var(--navy)}
.section-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
</style>`);

init();
