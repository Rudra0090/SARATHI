(() => {
  'use strict';
  const KEY = 'sarathi.sprint1.v1'; // Preserve the original SARATHI storage key.
  const FOCUS_KEY = 'sarathi.focus.session.v1';
  let pendingStructuredMenu = null;
  let menuSuggestionRequested = false;
  const $ = id => document.getElementById(id);
  const today = () => localKey(new Date());
  const localKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const parseDate = s => { const [y,m,d] = String(s).split('-').map(Number); return new Date(y,(m||1)-1,d||1,12); };
  const plusDays = (s,n) => { const d=parseDate(s); d.setDate(d.getDate()+n); return localKey(d); };
  const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const minsLabel = n => { n=Math.max(0,Number(n)||0); return n<60?`${n}m`:`${Math.floor(n/60)}h${n%60?` ${n%60}m`:''}`; };
  const defaultState = () => ({version:2,categories:['Study','Project','Personal','Health','Other'],days:{},settings:{focusMinutes:25,weeklyTarget:15,waterTarget:2000,movementInterval:50},habits:[],templates:[],schedules:[],menus:{},menuArchive:[],reminderLog:{},notificationsEnabled:false});
  function load(){try{const old=JSON.parse(localStorage.getItem(KEY)||'null');if(old&&old.days&&typeof old.days==='object'){const d={...defaultState(),...old};d.settings={...defaultState().settings,...(old.settings||{})};d.categories=Array.isArray(old.categories)?old.categories:defaultState().categories;d.habits=Array.isArray(old.habits)?old.habits:[];d.templates=Array.isArray(old.templates)?old.templates:[];d.schedules=Array.isArray(old.schedules)?old.schedules:[];d.menus=old.menus&&typeof old.menus==='object'?old.menus:{};d.menuArchive=Array.isArray(old.menuArchive)?old.menuArchive:[];d.reminderLog=old.reminderLog&&typeof old.reminderLog==='object'?old.reminderLog:{};Object.values(d.days).forEach(day=>{day.tasks=Array.isArray(day.tasks)?day.tasks:[];day.waterLog=Array.isArray(day.waterLog)?day.waterLog:[];day.naps=Array.isArray(day.naps)?day.naps:[];if(!day.sleep||typeof day.sleep!=='object')day.sleep={};if(!day.sleep.bedtime&&day.sleepBedtime)day.sleep.bedtime=day.sleepBedtime;if(!day.sleep.wake&&day.sleepWake)day.sleep.wake=day.sleepWake;if(!day.sleep.quality&&day.sleepQuality)day.sleep.quality=day.sleepQuality;if(!day.review&&(day.reviewWentWell||day.reviewChallenges||day.tomorrowPrep||day.energy))day.review={notes:[day.reviewWentWell,day.reviewChallenges].filter(Boolean).join('\n'),tomorrow:day.tomorrowPrep||'',energy:day.energy||''};});return d;}return defaultState();}catch(e){console.warn('Stored SARATHI data could not be read',e);return defaultState();}}
  let state=load(), currentDate=today(), toastTimer;

  // Supabase cloud sync. Local storage remains the offline cache.
  const SARATHI_SUPABASE_URL = "https://hnzajsgjaafufsdvlsnz.supabase.co";
  const SARATHI_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_mvkw_qQjLS72_S27Ix_4pg_FhNdH8No";
  const SARATHI_SUPABASE_TABLE = "sarathi_state";
  let sarathiSupabase = null;
  let sarathiUser = null;
  let sarathiCloudReady = false;
  let sarathiCloudTimer = null;
  let sarathiCloudApplying = false;
  let sarathiCloudChannel = null;

  function setCloudStatus(message) {
    const node = document.getElementById('sarathi-cloud-status');
    if (node) node.textContent = message;
    const saveStatus = $('save-status');
    if (saveStatus && sarathiUser) saveStatus.textContent = message;
  }

  function createCloudPanel() {
    if (document.getElementById('sarathi-cloud-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'sarathi-cloud-panel';
    panel.innerHTML = `
      <div id="sarathi-account-backdrop" class="sarathi-account-backdrop" hidden>
        <section id="sarathi-account-dialog" class="sarathi-account-dialog" role="dialog"
          aria-modal="true" aria-labelledby="sarathi-account-title">
          <button id="sarathi-account-close" class="sarathi-account-close" type="button" aria-label="Close account panel">×</button>
          <div class="sarathi-account-arch">
            <div class="sarathi-account-emblem"><img src="assets/login/ratha-emblem.svg" alt="" width="62" height="62"></div>
            <h2 id="sarathi-account-title">SARATHI</h2>
            <p class="sarathi-account-welcome">Welcome</p>
            <p class="sarathi-account-subtitle">Sign in to continue your journey</p>
          </div>
          <div id="sarathi-cloud-status" class="sarathi-cloud-status" role="status" aria-live="polite">Connecting to Supabase…</div>
          <div id="sarathi-cloud-signed-out" class="sarathi-cloud-form">
            <label for="sarathi-cloud-email">Email address</label>
            <input id="sarathi-cloud-email" type="email" autocomplete="email" placeholder="you@example.com" aria-label="Account email">
            <label for="sarathi-cloud-password">Password</label>
            <input id="sarathi-cloud-password" type="password" autocomplete="current-password" placeholder="At least 6 characters" aria-label="Account password">
            <div class="sarathi-account-actions">
              <button id="sarathi-cloud-signin" type="button">Sign in</button>
              <button id="sarathi-cloud-register" type="button" class="secondary">Create account</button>
            </div>
          </div>
          <div id="sarathi-cloud-signed-in" class="sarathi-cloud-form" hidden>
            <p class="sarathi-account-signedin">Signed in as <strong id="sarathi-cloud-account"></strong></p>
            <button id="sarathi-cloud-signout" type="button" class="secondary">Sign out</button>
          </div>
          <div class="sarathi-account-scene" aria-hidden="true"><img src="assets/login/ratha-scene.svg" alt=""></div><p class="sarathi-account-footnote">Your progress, carried with you.</p>
        </section>
      </div>`;
    document.body.appendChild(panel);
    // Keep an account control in the shared header and a dedicated one in the visible Home hero.
    // The shared header may be hidden on Home, so the Home control must be independently present.
    const email = () => document.getElementById('sarathi-cloud-email').value.trim();
    const password = () => document.getElementById('sarathi-cloud-password').value;
    const backdrop = document.getElementById('sarathi-account-backdrop');
    const accountToggles = [
      document.getElementById('sarathi-account-toggle'),
      document.getElementById('sarathi-home-account-toggle')
    ].filter(Boolean);
    let lastAccountTrigger = accountToggles[0] || null;
    const close = () => {
      backdrop.hidden = true;
      if (lastAccountTrigger && lastAccountTrigger.isConnected) lastAccountTrigger.focus();
    };
    accountToggles.forEach(toggle => toggle.addEventListener('click', () => {
      lastAccountTrigger = toggle;
      backdrop.hidden = false;
      const signedOut = document.getElementById('sarathi-cloud-signed-out');
      if (signedOut && !signedOut.hidden) document.getElementById('sarathi-cloud-email').focus();
      else document.getElementById('sarathi-account-close').focus();
    }));
    document.getElementById('sarathi-account-close').addEventListener('click', close);
    backdrop.addEventListener('click', event => { if (event.target === backdrop) close(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !backdrop.hidden) close(); });

    document.getElementById('sarathi-cloud-signin').addEventListener('click', async () => {
      if (!sarathiSupabase) return setCloudStatus('Supabase is still loading. Please try again in a moment.');
      if (!email() || !password()) return setCloudStatus('Enter your full email address and password.');
      const button = document.getElementById('sarathi-cloud-signin');
      button.disabled = true;
      setCloudStatus('Signing in…');
      try {
        const { error } = await sarathiSupabase.auth.signInWithPassword({ email: email(), password: password() });
        if (error) setCloudStatus(supabaseErrorMessage(error));
      } catch (error) {
        console.error('SARATHI sign-in failed:', error);
        setCloudStatus(supabaseErrorMessage(error));
      } finally { button.disabled = false; }
    });

    document.getElementById('sarathi-cloud-register').addEventListener('click', async () => {
      if (!sarathiSupabase) return setCloudStatus('Supabase is still loading. Please try again in a moment.');
      const accountEmail = email();
      const accountPassword = password();
      if (!accountEmail) return setCloudStatus('Enter your full email address, for example you@example.com.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail)) return setCloudStatus('That email address looks incomplete. Include a domain such as @gmail.com.');
      if (!accountPassword) return setCloudStatus('Enter a password.');
      if (accountPassword.length < 6) return setCloudStatus('Use a password with at least 6 characters.');
      const button = document.getElementById('sarathi-cloud-register');
      button.disabled = true;
      setCloudStatus('Creating your account…');
      try {
        const { data, error } = await sarathiSupabase.auth.signUp({
          email: accountEmail,
          password: accountPassword,
          options: { emailRedirectTo: window.location.href.split('#')[0] }
        });
        if (error) {
          console.error('SARATHI signup failed:', error);
          setCloudStatus(supabaseErrorMessage(error));
          return;
        }
        if (data.user && !data.session) {
          setCloudStatus('Account request accepted. Check your inbox (and Spam) to confirm your email, then sign in. If this email was already registered, try Sign in.');
        } else if (data.session) {
          setCloudStatus('Account created and signed in. Your SARATHI cloud sync is ready.');
        } else {
          setCloudStatus('Signup request completed. Try signing in or check your email.');
        }
      } catch (error) {
        console.error('SARATHI signup failed:', error);
        setCloudStatus(supabaseErrorMessage(error));
      } finally { button.disabled = false; }
    });

    document.getElementById('sarathi-cloud-signout').addEventListener('click', async () => {
      if (!sarathiSupabase) return;
      try {
        const { error } = await sarathiSupabase.auth.signOut();
        if (error) setCloudStatus(supabaseErrorMessage(error));
        else setCloudStatus('Signed out. Your local data is still available on this device.');
      } catch (error) { setCloudStatus(supabaseErrorMessage(error)); }
    });
  }

  function supabaseErrorMessage(error) {
    const message = String(error?.message || 'Please try again.');
    if (/invalid login credentials/i.test(message)) return 'Email or password is incorrect. If this is your first time, create an account.';
    if (/email not confirmed/i.test(message)) return 'Your account exists, but email confirmation is pending. Open the confirmation email, then sign in.';
    if (/user already registered|already been registered|already exists/i.test(message)) return 'This email may already have an account. Try Sign in, or use the password reset option in Supabase if needed.';
    if (/invalid email/i.test(message)) return 'Enter a valid full email address, such as you@example.com.';
    if (/password should be at least/i.test(message)) return 'Use a password with at least 6 characters.';
    if (/row.level security|permission denied|not allowed/i.test(message)) return 'Supabase blocked this request. Check the sarathi_state table RLS policies.';
    if (/fetch|network/i.test(message)) return 'Network error. Local saving still works.';
    return `Supabase: ${message}`;
  }

  async function loadSupabaseScript() {
    if (window.supabase?.createClient) return;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Could not load Supabase client library.'));
      document.head.appendChild(script);
    });
    if (!window.supabase?.createClient) throw new Error('Supabase client library did not initialize.');
  }

  async function writeStateToCloud() {
    if (!sarathiUser || !sarathiSupabase) return;
    try {
      const payload = {
        user_id: sarathiUser.id,
        state: JSON.parse(JSON.stringify(state)),
        updated_at: new Date().toISOString()
      };
      const { error } = await sarathiSupabase
        .from(SARATHI_SUPABASE_TABLE)
        .upsert(payload, { onConflict: 'user_id' });
      if (error) throw error;
      setCloudStatus(`Synced to cloud · ${sarathiUser.email || 'signed in'}`);
    } catch (error) {
      console.error('SARATHI Supabase save failed.', error);
      setCloudStatus(`${supabaseErrorMessage(error)} Local save is still available.`);
    }
  }

  function queueCloudSave() {
    if (!sarathiCloudReady || !sarathiUser || sarathiCloudApplying) return;
    clearTimeout(sarathiCloudTimer);
    sarathiCloudTimer = setTimeout(() => { void writeStateToCloud(); }, 900);
  }

  function refreshActiveViewAfterCloudUpdate() {
    const activeView = document.body.dataset.sarathiView || 'home';
    if (activeView === 'dashboard') renderDashboard();
    else if (activeView === 'morning') renderMorning();
    else if (activeView === 'evening') renderEvening();
    else if (activeView === 'health') renderHealth();
    else if (activeView === 'sleep') renderSleep();
    else if (activeView === 'jala') renderJala();
  }

  async function handleSupabaseSignIn(user) {
    sarathiUser = user;
    sarathiCloudReady = false;
    sarathiCloudApplying = true;
    if (sarathiCloudChannel && sarathiSupabase) {
      await sarathiSupabase.removeChannel(sarathiCloudChannel);
      sarathiCloudChannel = null;
    }
    const signedOut = document.getElementById('sarathi-cloud-signed-out');
    const signedIn = document.getElementById('sarathi-cloud-signed-in');
    if (signedOut) signedOut.hidden = true;
    if (signedIn) signedIn.hidden = false;
    const account = document.getElementById('sarathi-cloud-account');
    if (account) account.textContent = user.email || 'Signed in';
    setCloudStatus('Checking cloud data…');

    try {
      const { data: row, error } = await sarathiSupabase
        .from(SARATHI_SUPABASE_TABLE)
        .select('state, updated_at')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;

      if (row && row.state && typeof row.state === 'object') {
        // Quiet restore: back up the local state, then load the cloud copy without a popup.
        try {
          localStorage.setItem(`${KEY}.pre-cloud-backup.${Date.now()}`, JSON.stringify(state));
        } catch (backupError) {
          console.warn('SARATHI could not create a local pre-cloud backup:', backupError);
        }
        state = { ...defaultState(), ...row.state };
        state.settings = { ...defaultState().settings, ...(row.state.settings || {}) };
        try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
        refreshActiveViewAfterCloudUpdate();
        setCloudStatus('Cloud data loaded on this device. A local backup was kept.');
      } else {
        await writeStateToCloud();
      }

      sarathiCloudReady = true;
      sarathiCloudApplying = false;
      sarathiCloudChannel = sarathiSupabase
        .channel(`sarathi-state-${user.id}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: SARATHI_SUPABASE_TABLE,
          filter: `user_id=eq.${user.id}`
        }, payload => {
          const incoming = payload.new?.state;
          if (!incoming || typeof incoming !== 'object' || JSON.stringify(incoming) === JSON.stringify(state)) return;
          sarathiCloudApplying = true;
          try { localStorage.setItem(`${KEY}.realtime-backup.${Date.now()}`, JSON.stringify(state)); } catch (_) {}
          state = { ...defaultState(), ...incoming };
          state.settings = { ...defaultState().settings, ...(incoming.settings || {}) };
          try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
          sarathiCloudApplying = false;
          setCloudStatus('Updated from cloud · latest saved data loaded');
          refreshActiveViewAfterCloudUpdate();
        })
        .subscribe(status => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn('SARATHI Supabase realtime status:', status);
            setCloudStatus('Cloud saving is available; enable Realtime for live updates.');
          }
        });
      setCloudStatus(`Connected · ${user.email || 'signed in'}`);
    } catch (error) {
      sarathiCloudApplying = false;
      sarathiCloudReady = false;
      console.error('SARATHI Supabase initialization failed.', error);
      setCloudStatus(`${supabaseErrorMessage(error)} Your local data is unchanged.`);
    }
  }

  async function initializeSarathiSupabase() {
    createCloudPanel();
    try {
      await loadSupabaseScript();
      sarathiSupabase = window.supabase.createClient(SARATHI_SUPABASE_URL, SARATHI_SUPABASE_PUBLISHABLE_KEY);
      const { data: { session }, error } = await sarathiSupabase.auth.getSession();
      if (error) throw error;
      sarathiSupabase.auth.onAuthStateChange((event, sessionNow) => {
        if (sessionNow?.user) {
          // Avoid doing cloud work directly inside the auth callback's internal lock.
          setTimeout(() => { void handleSupabaseSignIn(sessionNow.user); }, 0);
        } else {
          sarathiUser = null;
          sarathiCloudReady = false;
          sarathiCloudApplying = false;
          if (sarathiCloudChannel) {
            void sarathiSupabase.removeChannel(sarathiCloudChannel);
            sarathiCloudChannel = null;
          }
          const signedOut = document.getElementById('sarathi-cloud-signed-out');
          const signedIn = document.getElementById('sarathi-cloud-signed-in');
          if (signedOut) signedOut.hidden = false;
          if (signedIn) signedIn.hidden = true;
          setCloudStatus('Not signed in · data is saved on this device');
        }
      });
      if (!session?.user) setCloudStatus('Ready · sign in or create an account to sync devices');
    } catch (error) {
      console.error('Could not initialize SARATHI Supabase.', error);
      setCloudStatus('Could not load Supabase. Check your internet connection; local saving still works.');
    }
  }

  void initializeSarathiSupabase();
  // Home shows the real device date only; the temporary preview controls are removed.
  const homeDate=document.getElementById('home-date');
  const formatHomeDate = () => new Date().toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const updateHomeDate = () => { if (homeDate) homeDate.textContent = formatHomeDate(); };
  updateHomeDate();
  // Refresh shortly after local midnight so the date changes without a manual reload.
  function scheduleHomeDateRefresh(){
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1, 0, 0, 2);
    setTimeout(() => { updateHomeDate(); scheduleHomeDateRefresh(); }, Math.max(1000, next.getTime()-Date.now()));
  }
  scheduleHomeDateRefresh();
  function save(){
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      const s = $('save-status');
      if (s) s.textContent = sarathiUser && sarathiCloudReady ? 'Saved locally · syncing…' : 'Saved locally';
      queueCloudSave();
    } catch (e) {
      console.error('SARATHI save error:', e);
      toast('Storage is full. Export a backup before continuing.');
    }
  }
  function toast(msg,undoAction){const el=$('toast');el.replaceChildren(document.createTextNode(msg));if(typeof undoAction==='function'){const b=document.createElement('button');b.type='button';b.className='toast-undo';b.textContent='Undo';b.addEventListener('click',()=>{clearTimeout(toastTimer);el.classList.remove('show');undoAction();},{once:true});el.appendChild(b);}el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),typeof undoAction==='function'?6500:3200);}
  function day(key=today()){if(!state.days[key])state.days[key]={tasks:[],waterLog:[],naps:[],sleep:{},createdAt:new Date().toISOString()};const d=state.days[key];d.tasks ||= [];d.waterLog ||= [];d.naps ||= [];d.sleep ||= {};return d;}
  function duration(start,end){if(!start||!end)return null;const [sh,sm]=start.split(':').map(Number),[eh,em]=end.split(':').map(Number);let a=sh*60+sm,b=eh*60+em;if(b<=a)b+=1440;return b-a;}
  function taskStatus(t){return t.status || (t.completed?'completed':'planned');}
  function getOccurrence(s,key){if(key<s.startDate || (s.endDate&&key>s.endDate))return false;const delta=Math.round((parseDate(key)-parseDate(s.startDate))/86400000);switch(s.repeat){case'daily':return true;case'weekly':return delta%7===0;case'monthly':{const a=parseDate(key),b=parseDate(s.startDate);return a.getDate()===b.getDate();}case'custom':return delta%(Math.max(1,Number(s.interval)||1))===0;default:return key===s.startDate;}}
  function scheduledFor(key){return state.schedules.filter(s=>!s.archived&&getOccurrence(s,key));}
  function syncScheduled(key){const d=day(key);const existing=new Set(d.tasks.filter(t=>t.sourceId).map(t=>t.sourceId));scheduledFor(key).forEach(s=>{if(!existing.has(s.id))d.tasks.push({id:`occ-${s.id}-${key}`,sourceId:s.id,title:s.title,type:s.type||'task',minutes:Number(s.minutes)||0,actualMinutes:0,priority:s.priority||'Normal',category:s.category||'Other',status:'planned',notes:s.notes||'',time:s.time||'',reminder:s.reminder||'none',occurrenceDate:key,createdAt:new Date().toISOString()});});}
  function openView(name){document.querySelectorAll('[data-view]').forEach(v=>v.hidden=v.dataset.view!==name);document.body.dataset.sarathiView=name;document.documentElement.scrollTop=0;document.body.scrollTop=0;window.scrollTo({top:0,left:0,behavior:'auto'});const shell=document.querySelector('.page-shell');if(shell)shell.scrollTop=0;const main=document.querySelector('main');if(main)main.scrollTop=0;const active=document.querySelector('.workspace-view:not([hidden])');if(active)active.scrollTop=0;if(name==='dashboard')renderDashboard();if(name==='morning')renderMorning();if(name==='evening')renderEvening();if(name==='health')renderHealth();if(name==='sleep')renderSleep();if(name==='jala')renderJala();if(name==='ekagra')focusDraw();requestAnimationFrame(()=>{document.documentElement.scrollTop=0;document.body.scrollTop=0;window.scrollTo({top:0,left:0,behavior:'auto'});const shellNow=document.querySelector('.page-shell');if(shellNow)shellNow.scrollTop=0;const mainNow=document.querySelector('main');if(mainNow)mainNow.scrollTop=0;const viewNow=document.querySelector('.workspace-view:not([hidden])');if(viewNow)viewNow.scrollTop=0;});}
  // User-selectable presentation mode; existing app data and home navigation remain unchanged.
  const DEVICE_MODE_KEY = 'sarathi.device.mode.v1';
  function setDeviceMode(mode){
    const chosen = mode === 'mobile' ? 'mobile' : 'desktop';
    document.body.dataset.deviceMode = chosen;
    try { localStorage.setItem(DEVICE_MODE_KEY, chosen); } catch (_) {}
    document.querySelectorAll('[data-device-mode-choice]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.deviceModeChoice === chosen));
    });
  }
  let savedDeviceMode = 'desktop';
  try { savedDeviceMode = localStorage.getItem(DEVICE_MODE_KEY) || 'desktop'; } catch (_) {}
  setDeviceMode(savedDeviceMode);
  document.querySelectorAll('[data-device-mode-choice]').forEach(button => {
    button.addEventListener('click', () => setDeviceMode(button.dataset.deviceModeChoice));
  });
  // Compact, user-controlled minimizers for feature panels. This uses a separate
  // preference key and never touches SARATHI's existing personal-data storage.
  const PANEL_COLLAPSE_KEY = 'sarathi.panel.collapse.v1';
  let collapsedPanels = {};
  try { collapsedPanels = JSON.parse(localStorage.getItem(PANEL_COLLAPSE_KEY) || '{}') || {}; } catch (_) { collapsedPanels = {}; }
  function installPanelMinimizers() {
    const featurePanels = document.querySelectorAll('#view-dashboard .panel, .workspace-view .panel');
    featurePanels.forEach((panel, index) => {
      if (panel.classList.contains('daily-gita') || panel.querySelector('#menu-options-toggle') || panel.dataset.minimizerReady === 'true') return;
      const view = panel.closest('.workspace-view, #view-dashboard');
      const viewName = view?.dataset.view || view?.id || 'feature';
      const panelKey = panel.id || `${viewName}-panel-${index}`;
      panel.dataset.panelCollapseKey = panelKey;
      panel.dataset.minimizerReady = 'true';
      let heading = panel.querySelector(':scope > .section-heading');
      if (heading) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'panel-collapse-button';
        button.dataset.panelCollapseToggle = panelKey;
        heading.appendChild(button);
      } else {
        heading = document.createElement('div');
        heading.className = 'panel-collapse-heading';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'panel-collapse-button';
        button.dataset.panelCollapseToggle = panelKey;
        heading.appendChild(button);
        panel.insertBefore(heading, panel.firstChild);
      }
      applyPanelCollapsed(panel, Boolean(collapsedPanels[panelKey]));
    });
  }
  function applyPanelCollapsed(panel, collapsed) {
    const key = panel.dataset.panelCollapseKey;
    panel.classList.toggle('is-minimized', collapsed);
    const button = panel.querySelector(`[data-panel-collapse-toggle="${CSS.escape(key)}"]`);
    if (!button) return;
    button.textContent = collapsed ? '＋ Expand' : '− Minimize';
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Minimize'} ${panel.querySelector('h2')?.textContent?.trim() || 'feature panel'}`);
    button.title = collapsed ? 'Expand this section' : 'Minimize this section';
  }
  installPanelMinimizers();
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-panel-collapse-toggle]');
    if (!button) return;
    const panel = button.closest('.panel');
    if (!panel) return;
    const collapsed = !panel.classList.contains('is-minimized');
    const key = panel.dataset.panelCollapseKey;
    collapsedPanels[key] = collapsed;
    try { localStorage.setItem(PANEL_COLLAPSE_KEY, JSON.stringify(collapsedPanels)); } catch (_) {}
    applyPanelCollapsed(panel, collapsed);
  });
  document.body.dataset.sarathiView = 'home';
  document.querySelectorAll('[data-open-view]').forEach(b=>b.addEventListener('click',()=>openView(b.dataset.openView)));
  // Entrance layout: one shared rotation offset keeps all seven circles equally spaced.
  const ORBIT_LAYOUT_KEY = 'sarathi.orbit.layout.v1';
  const ORBIT_MOTION_KEY = 'sarathi.orbit.motion.v1';
  const orbitStage = document.querySelector('.orbit-stage');
  const layoutToggle = $('layout-edit-toggle');
  const motionToggle = $('orbit-motion-toggle');
  const orbitButtons = orbitStage ? Array.from(orbitStage.querySelectorAll('.orbit-button')) : [];
  let layoutEditing = false, orbitDrag = null, orbitRotation = 0;
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Home navigation is intentionally always animated; the Home screen no longer exposes motion/layout toggles.
  let orbitMotion = true;
  function setOrbitRadius() {
    if (!orbitStage) return;
    // CSS translateX(%) is relative to each button, not the orbit stage. Use a
    // pixel radius measured from the stage so every button follows the same circle.
    const radius = Math.min(orbitStage.clientWidth, orbitStage.clientHeight) * 0.39;
    orbitStage.style.setProperty('--orbit-radius', `${radius}px`, 'important');
  }
  function applyOrbitRotation(rotation) {
    orbitRotation = ((Number(rotation)||0)%360+360)%360;
    const step = 360 / Math.max(1, orbitButtons.length);
    setOrbitRadius();
    orbitButtons.forEach((button,index) => {
      const angle = -90 + index * step + orbitRotation;
      button.style.setProperty('--start-angle', `${angle}deg`);
      button.style.setProperty('--counter-start-angle', `${-angle}deg`);
      button.style.left='50%'; button.style.top='50%'; button.style.right='auto'; button.style.bottom='auto';
    });
  }
  if (orbitStage) window.addEventListener('resize', setOrbitRadius, {passive:true});
  function restoreOrbitLayout() {
    try {
      const saved = JSON.parse(localStorage.getItem(ORBIT_LAYOUT_KEY) || 'null');
      // Support older saved per-button angles by using the first saved angle only.
      if (saved && Number.isFinite(saved.rotation)) orbitRotation=saved.rotation;
      else if (saved && typeof saved==='object') {
        const first=Object.values(saved).find(Number.isFinite);
        if (Number.isFinite(first)) orbitRotation=first-(-90);
      }
    } catch(e) { console.warn('Saved circle layout could not be read.',e); }
    applyOrbitRotation(orbitRotation);
  }
  function saveOrbitLayout() {
    try { localStorage.setItem(ORBIT_LAYOUT_KEY, JSON.stringify({rotation:orbitRotation})); }
    catch(e) { toast('Circle layout could not be saved in this browser.'); }
  }
  function applyOrbitMotion() {
    document.body.classList.toggle('orbit-motion-off', !orbitMotion);
    if (motionToggle) { motionToggle.textContent=`Motion: ${orbitMotion?'on':'off'}`; motionToggle.setAttribute('aria-pressed',String(orbitMotion)); }
  }
  if (orbitStage) restoreOrbitLayout();
  if(motionToggle) motionToggle.addEventListener('click',()=>{orbitMotion=!orbitMotion;try{localStorage.setItem(ORBIT_MOTION_KEY,orbitMotion?'on':'off');}catch(e){}applyOrbitMotion();});
  applyOrbitMotion();

  document.querySelectorAll('[data-go-home],.brand').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();openView('home');}));
  document.querySelectorAll('[data-jump]').forEach(b=>b.addEventListener('click',()=>openView(b.dataset.jump)));
  function setupDate(id,callback,initial=today()){const el=$(id);el.value=initial;el.addEventListener('change',()=>{if(el.value)callback(el.value);});}
  setupDate('report-date',v=>{renderDashboard(v);},today());setupDate('history-date',v=>renderHistoryDay(v));setupDate('morning-date',v=>{currentDate=v;renderMorning();});setupDate('evening-date',v=>{currentDate=v;renderEvening();});setupDate('sleep-date',v=>{currentDate=v;renderSleep();});setupDate('jala-date',v=>renderJala(v));setupDate('menu-date',v=>renderMenuSuggestions(v),today());
  function renderCompass(key, tasks) {
    const panel = $('sarathi-compass-content');
    if (!panel) return;
    const pending = tasks.filter(t => taskStatus(t) !== 'completed');
    const priorityRank = value => ({high:0, normal:1, low:2}[String(value || 'Normal').toLowerCase()] ?? 1);
    const timed = pending.filter(t => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t.time || '')));
    const nowMinutes = key === today() ? new Date().getHours()*60 + new Date().getMinutes() : -1;
    const upcoming = timed.filter(t => { const [h,m] = t.time.split(':').map(Number); return nowMinutes < 0 || h*60+m >= nowMinutes; }).sort((a,b) => a.time.localeCompare(b.time));
    const highPriority = pending.filter(t => priorityRank(t.priority) === 0).sort((a,b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
    let chosen = upcoming[0] || highPriority[0] || pending.slice().sort((a,b) => priorityRank(a.priority)-priorityRank(b.priority) || (Number(a.minutes)||0)-(Number(b.minutes)||0))[0];
    if (chosen) {
      const why = upcoming.includes(chosen) ? `It is the next scheduled item${chosen.time ? ` at ${chosen.time}` : ''}.` : priorityRank(chosen.priority) === 0 ? 'It is marked high priority, so consider giving it attention first.' : 'It is still open. A small, focused start can make the plan easier to manage.';
      const durationText = Number(chosen.minutes) > 0 ? ` · about ${minsLabel(chosen.minutes)}` : '';
      panel.innerHTML = `<p class="compass-kicker">SUGGESTED NEXT ACTION</p><h3>${esc(chosen.title || 'Untitled task')}</h3><p>${esc(why)}${esc(durationText)}</p><div class="compass-meta"><span>${esc(chosen.priority || 'Normal')} priority</span><span>${esc(chosen.category || 'Other')}</span><span>${esc(taskStatus(chosen))}</span></div>`;
    } else if (tasks.length) {
      panel.innerHTML = `<p class="compass-kicker">PLAN COMPLETE</p><h3>You've completed the tasks recorded for this day.</h3><p>Take a short pause, or use Manana to capture what went well and prepare for the next day.</p><div class="compass-meta"><span>${tasks.length} task${tasks.length===1?'':'s'} reviewed</span><span>Nothing changed automatically</span></div>`;
    } else {
      panel.innerHTML = `<p class="compass-kicker">START SMALL</p><h3>Add one clear intention for this day.</h3><p>Choose something specific and manageable. Once you add tasks in Aarambha, Compass can help you prioritize them.</p><div class="compass-meta"><span>No task data for ${esc(key)}</span><span>No assumptions made</span></div>`;
    }
  }

  $('compass-open-plan')?.addEventListener('click', () => {
    const key = $('report-date').value || today();
    $('morning-date').value = key;
    openView('morning');
  });
  $('compass-open-focus')?.addEventListener('click', () => openView('ekagra'));

  function renderDashboard(key=$('report-date').value||today()){
    syncScheduled(key);const d=day(key),tasks=d.tasks,total=tasks.length,done=tasks.filter(t=>taskStatus(t)==='completed').length,planned=tasks.reduce((a,t)=>a+(+t.minutes||0),0),actual=tasks.reduce((a,t)=>a+(+t.actualMinutes||0),0);renderCompass(key,tasks);
    $('d-planned').textContent=total;$('d-completed').textContent=done;$('d-rate').textContent=total?`${Math.round(done/total*100)}%`:'—';$('d-plan-time').textContent=minsLabel(planned);$('d-actual-time').textContent=minsLabel(actual);
    const completion=total?Math.round(done/total*100):0;
    const ring=$('d-completion-ring');if(ring){ring.style.background=`conic-gradient(#4c8b4b 0 ${completion*3.6}deg,#e4d5b4 ${completion*3.6}deg 360deg)`;ring.setAttribute('aria-label',`${completion}% of planned tasks completed`);}
    const completeBar=$('d-completed-bar');if(completeBar)completeBar.style.width=`${completion}%`;
    const timeBar=$('d-time-bar');if(timeBar)timeBar.style.width=`${planned?Math.min(100,actual/planned*100):0}%`;
    const caption=$('d-completion-caption');if(caption)caption.textContent=total?`${done} of ${total} intentions completed`:'Plan a task to begin your daily progress.';
    const dots=$('d-planned-dots');if(dots)dots.innerHTML=Array.from({length:Math.min(total,10)},()=>'<span></span>').join('');
    const taskVisual=$('d-task-visual');if(taskVisual){const icons={'study':'▤','project':'⌘','reading':'▥','health':'✿','exercise':'↗','personal':'◈','other':'✦'};taskVisual.innerHTML=tasks.length?tasks.slice(0,6).map(t=>{const category=String(t.category||'Other'),keyCat=category.toLowerCase(),symbol=Object.keys(icons).find(k=>keyCat.includes(k));const isDone=taskStatus(t)==='completed';return `<div class="drishti-task-row"><span class="drishti-task-symbol" aria-hidden="true">${icons[symbol]||icons.other}</span><div><strong>${esc(t.title)}</strong><small>${esc(category)} · ${minsLabel(t.minutes||0)}</small></div><span class="drishti-task-state ${isDone?'is-done':''}">${isDone?'✓ Done':esc(taskStatus(t))}</span></div>`;}).join(''):'<p class="muted small-copy">No tasks planned for this date yet. Add intentions in Aarambha to see your day take shape here.</p>';if(tasks.length>6)taskVisual.insertAdjacentHTML('beforeend',`<p class="muted small-copy">Showing 6 of ${tasks.length} tasks · <button class="button button-small" data-jump="morning" type="button">View all</button></p>`);}
    const categories={};tasks.forEach(t=>{const cat=String(t.category||'Other');categories[cat]=(categories[cat]||0)+Math.max(0,Number(t.minutes)||0);});const categoryEntries=Object.entries(categories).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);const palette=['#4e8a4c','#dfa744','#4d91ce','#9b59b6','#c97856','#8b9a68','#7d7b74'];const focusDonut=$('d-focus-donut'),focusLegend=$('d-focus-legend');if(focusDonut){let acc=0;const totalM=categoryEntries.reduce((sum,x)=>sum+x[1],0);const slices=categoryEntries.map(([name,value],i)=>{const from=totalM?acc/totalM*100:0;acc+=value;const to=totalM?acc/totalM*100:100;return `${palette[i%palette.length]} ${from}% ${to}%`;});focusDonut.style.background=categoryEntries.length?`conic-gradient(${slices.join(',')})`:'conic-gradient(#e7dbc0 0 100%)';$('d-focus-total').textContent=minsLabel(planned);focusDonut.setAttribute('aria-label',categoryEntries.length?'Planned minutes distributed by task category':'No planned time recorded');}
    if(focusLegend)focusLegend.innerHTML=categoryEntries.length?categoryEntries.slice(0,5).map(([name,value],i)=>`<div class="drishti-legend-row"><span class="drishti-legend-dot" style="background:${palette[i%palette.length]}"></span><span>${esc(name)}</span><strong>${planned?Math.round(value/planned*100):0}%</strong></div>`).join(''):'<p class="muted small-copy">Add estimated minutes to tasks to compare categories.</p>';
    const focusNote=$('d-focus-note');if(focusNote)focusNote.textContent=categoryEntries.length?`${categoryEntries.length} task ${categoryEntries.length===1?'category':'categories'} represented · based on planned minutes.`:'Only real planned task data is shown; nothing is fabricated.';
    const sleep=d.sleep||{},dur=duration(sleep.bedtime,sleep.wake);$('health-snapshot').innerHTML=`<div class="list-row"><div><strong>Night sleep</strong><small>${dur===null?'Not recorded':`${minsLabel(dur)} · quality ${sleep.quality||'—'}/5`}</small></div></div><div class="list-row"><div><strong>Habits</strong><small>${state.habits.length?`${Object.values(d.habitChecks||{}).filter(Boolean).length} of ${state.habits.length} checked`:'No personal habits configured'}</small></div></div><div class="list-row"><div><strong>Hostel menu</strong><small>${state.menus[`${parseDate(key).getFullYear()}-${String(parseDate(key).getMonth()+1).padStart(2,'0')}`]?'Menu saved for this month':'Upload this month’s menu in Health'}</small></div></div>`;
    renderTrend();renderInsights();renderHistoryDay($('history-date').value||key);
  }
  function renderTrend(){const mode=$('trend-range').value||'daily',end=$('report-date').value||today(),rows=[];if(mode==='daily'){for(let i=6;i>=0;i--){const k=plusDays(end,-i),d=state.days[k],ts=d?.tasks||[],total=ts.length,done=ts.filter(t=>taskStatus(t)==='completed').length;rows.push({label:k.slice(5),total,done,k});}}else if(mode==='weekly'){for(let i=7;i>=0;i--){const endKey=plusDays(end,-i*7),startKey=plusDays(endKey,-6);let total=0,done=0;for(let j=0;j<7;j++){const d=state.days[plusDays(startKey,j)],ts=d?.tasks||[];total+=ts.length;done+=ts.filter(t=>taskStatus(t)==='completed').length;}rows.push({label:`${startKey.slice(5)}–${endKey.slice(5)}`,total,done,k:startKey});}}else{const anchor=parseDate(end);for(let i=11;i>=0;i--){const start=new Date(anchor.getFullYear(),anchor.getMonth()-i,1,12),next=new Date(start.getFullYear(),start.getMonth()+1,1,12);let total=0,done=0;for(let d=new Date(start);d<next;d.setDate(d.getDate()+1)){const ts=state.days[localKey(d)]?.tasks||[];total+=ts.length;done+=ts.filter(t=>taskStatus(t)==='completed').length;}rows.push({label:start.toLocaleDateString('en-US',{month:'short',year:'2-digit'}),total,done,k:localKey(start)});}}const max=Math.max(1,...rows.map(r=>r.total));$('trend-chart').innerHTML=rows.map(r=>`<div class="trend-col" title="${r.label}: ${r.done}/${r.total} completed"><div class="trend-bars"><span class="trend-total" style="height:${Math.max(2,r.total/max*100)}%"></span><span class="trend-done" style="height:${Math.max(0,r.done/max*100)}%"></span></div><small>${esc(r.label)}</small><b>${r.total?r.done+'/'+r.total:'—'}</b></div>`).join('');const used=rows.filter(r=>r.total),avg=used.length?Math.round(used.reduce((a,r)=>a+r.done/r.total*100,0)/used.length):null;$('trend-summary').textContent=used.length?`${used.length} ${mode==='daily'?'days':mode==='weekly'?'weeks':'months'} with task records · average completion ${avg}% · empty periods excluded.`:'No task history in this period yet.';}
  function renderInsights(){const records=Object.entries(state.days).filter(([k,d])=>k<=today()&&Array.isArray(d.tasks)&&d.tasks.length);const sleepPairs=records.map(([k,d])=>({k,mins:duration(d.sleep?.bedtime,d.sleep?.wake),rate:d.tasks.length?d.tasks.filter(t=>taskStatus(t)==='completed').length/d.tasks.length*100:null})).filter(x=>x.mins!==null&&x.rate!==null);let html=[];if(records.length>=3){const rates=records.map(([,d])=>d.tasks.filter(t=>taskStatus(t)==='completed').length/d.tasks.length*100);html.push(`<div class="insight-row"><strong>Recorded task completion</strong><span>${Math.round(rates.reduce((a,b)=>a+b,0)/rates.length)}% average across ${records.length} days</span></div>`);}if(sleepPairs.length>=5){const long=sleepPairs.filter(x=>x.mins>=420),short=sleepPairs.filter(x=>x.mins<420);if(long.length>=2&&short.length>=2){const avg=a=>Math.round(a.reduce((s,x)=>s+x.rate,0)/a.length);html.push(`<div class="insight-row"><strong>Sleep and task completion</strong><span>≥7 h: ${avg(long)}% (n=${long.length}); &lt;7 h: ${avg(short)}% (n=${short.length}). Association only; other factors may explain the difference.</span></div>`);}}$('personal-insights').innerHTML=html.length?html.join(''):'<p class="muted">Insights will appear after several days of records. No missing data is treated as a poor result.</p>';}
  function renderHistoryDay(key){const d=state.days[key];if(!d){$('history-day').innerHTML='<p class="muted">No records for this date.</p>';return;}const ts=d.tasks||[];const done=ts.filter(t=>taskStatus(t)==='completed').length;$('history-day').innerHTML=`<div class="list-row"><div><strong>${key}</strong><small>${done}/${ts.length} tasks completed</small></div><span>${ts.length?Math.round(done/ts.length*100)+'%':'—'}</span></div>${ts.map(t=>`<div class="list-row"><div><strong>${esc(t.title)}</strong><small>${esc(taskStatus(t))} · planned ${minsLabel(t.minutes)} / actual ${minsLabel(t.actualMinutes)}</small></div></div>`).join('')}`;}
  $('trend-range').addEventListener('change',renderTrend);$('report-date').addEventListener('change',()=>renderDashboard());$('history-date').addEventListener('change',e=>renderHistoryDay(e.target.value));
  function renderMorning(){const key=$('morning-date').value||today();currentDate=key;syncScheduled(key);save();const d=day(key);$('morning-items').innerHTML=d.tasks.length?d.tasks.map(t=>`<article class="task-row ${taskStatus(t)==='completed'?'task-done':''}" data-task="${esc(t.id)}"><div class="task-main"><label class="task-check"><input type="checkbox" data-action="done" ${taskStatus(t)==='completed'?'checked':''}><span><strong>${esc(t.title)}</strong><small>${esc(t.type||'task')} · ${esc(t.category||'Other')} · ${esc(t.priority||'Normal')}${t.time?' · '+esc(t.time):''}</small></span></label></div><div class="task-meta"><label class="field mini-field"><span>Actual minutes</span><input type="number" min="0" max="1440" data-action="actual" value="${Number(t.actualMinutes)||0}"></label><label class="field mini-field"><span>Status</span><select data-action="status"><option value="planned" ${taskStatus(t)==='planned'?'selected':''}>Planned</option><option value="completed" ${taskStatus(t)==='completed'?'selected':''}>Completed</option><option value="partial" ${taskStatus(t)==='partial'?'selected':''}>Partial</option><option value="unfinished" ${taskStatus(t)==='unfinished'?'selected':''}>Unfinished</option></select></label><button class="button button-small" data-action="edit">Edit</button><button class="button button-small" data-action="remove">Remove</button></div></article>`).join(''):'<p class="muted">Nothing planned for this day yet. Add a task here or schedule it for a future date.</p>';renderScheduleManager();}
  $('morning-items').addEventListener('change',e=>{const row=e.target.closest('[data-task]');if(!row)return;const t=day($('morning-date').value||today()).tasks.find(t=>t.id===row.dataset.task);if(!t)return;if(e.target.dataset.action==='done'){t.status=e.target.checked?'completed':'planned';t.completed=e.target.checked;}if(e.target.dataset.action==='status'){t.status=e.target.value;t.completed=e.target.value==='completed';}if(e.target.dataset.action==='actual')t.actualMinutes=Math.max(0,Number(e.target.value)||0);save();renderMorning();});
  $('morning-items').addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;const row=b.closest('[data-task]'),d=day($('morning-date').value||today()),t=d.tasks.find(x=>x.id===row.dataset.task);if(!t)return;if(b.dataset.action==='remove'){const index=d.tasks.findIndex(x=>x.id===row.dataset.task),removed=d.tasks[index];d.tasks=d.tasks.filter(x=>x.id!==row.dataset.task);save();renderMorning();renderDashboard();toast('Task removed.',()=>{d.tasks.splice(Math.min(index,d.tasks.length),0,removed);save();renderMorning();renderDashboard();});return;}else if(b.dataset.action==='edit'){const title=prompt('Edit this day’s task title:',t.title);if(title===null)return;if(!title.trim()){toast('Task title cannot be empty.');return;}const minutes=prompt('Estimated minutes for this day only:',String(t.minutes||0));if(minutes===null)return;t.title=title.trim();t.minutes=Math.max(0,Math.min(1440,Number(minutes)||0));}else return;save();renderMorning();});
  $('quick-task-form').addEventListener('submit',e=>{e.preventDefault();const key=$('morning-date').value||today();day(key).tasks.push({id:crypto.randomUUID?crypto.randomUUID():String(Date.now()),title:$('quick-title').value.trim(),type:'task',minutes:+$('quick-minutes').value||0,actualMinutes:0,priority:$('quick-priority').value,category:$('quick-category').value.trim()||'Other',status:'planned'});save();e.target.reset();$('quick-minutes').value=30;$('quick-category').value='Study';renderMorning();toast('Task added to the selected day.');});
  $('schedule-repeat').addEventListener('change',()=>{$('custom-repeat-row').hidden=$('schedule-repeat').value!=='custom';});
  $('schedule-form').addEventListener('submit',e=>{e.preventDefault();const start=$('schedule-date').value;if(!start)return;const repeat=$('schedule-repeat').value;const item={id:crypto.randomUUID?crypto.randomUUID():String(Date.now()),title:$('schedule-title').value.trim(),type:$('schedule-type').value,startDate:start,time:$('schedule-time').value,minutes:+$('schedule-minutes').value||0,priority:$('schedule-priority').value,category:$('schedule-category').value.trim()||'Other',repeat,interval:repeat==='custom'?Math.max(1,+$('schedule-interval').value||1):1,endDate:$('schedule-end').value,reminder:$('schedule-reminder').value,notes:$('schedule-notes').value.trim(),createdAt:new Date().toISOString()};if(item.endDate&&item.endDate<start){toast('Repeat end date must be on or after the start date.');return;}state.schedules.push(item);save();e.target.reset();$('schedule-date').value=today();$('schedule-minutes').value=30;$('schedule-category').value='Study';$('custom-repeat-row').hidden=true;renderScheduleManager();renderDashboard();toast('Schedule saved.');});
  function renderScheduleManager(){$('schedule-manager').innerHTML=state.schedules.filter(s=>!s.archived).length?state.schedules.filter(s=>!s.archived).map(s=>`<div class="list-row"><div><strong>${esc(s.title)}</strong><small>${esc(s.type)} · from ${s.startDate}${s.time?' · '+esc(s.time):''} · ${s.repeat==='none'?'one-time':`repeats ${s.repeat==='custom'?`every ${s.interval} days`:s.repeat}`}${s.endDate?' until '+s.endDate:''}</small></div><button class="button button-small" data-archive-schedule="${esc(s.id)}">Cancel</button></div>`).join(''):'<p class="muted">No future schedules yet.</p>';}
  $('schedule-manager').addEventListener('click',e=>{const b=e.target.closest('[data-archive-schedule]');if(!b)return;const s=state.schedules.find(x=>x.id===b.dataset.archiveSchedule);if(!s)return;s.archived=true;save();renderScheduleManager();renderDashboard();toast('Schedule cancelled.',()=>{s.archived=false;save();renderScheduleManager();renderDashboard();});});
  function renderEvening(){const key=$('evening-date').value||today();currentDate=key;syncScheduled(key);const d=day(key),ts=d.tasks,done=ts.filter(t=>taskStatus(t)==='completed'),planned=ts.reduce((a,t)=>a+(+t.minutes||0),0),actual=ts.reduce((a,t)=>a+(+t.actualMinutes||0),0);$('evening-summary-title').textContent=key===today()?"Today's results":`Results for ${key}`;$('evening-summary').innerHTML=`<div class="list-row"><div><strong>Tasks completed</strong><small>${done.length} of ${ts.length} planned</small></div><b>${ts.length?Math.round(done.length/ts.length*100)+'%':'—'}</b></div><div class="list-row"><div><strong>Planned vs actual time</strong><small>${minsLabel(planned)} planned · ${minsLabel(actual)} actual</small></div></div><div class="list-row"><div><strong>Partial / unfinished</strong><small>${ts.filter(t=>['partial','unfinished'].includes(taskStatus(t))).length} items</small></div></div>`;$('evening-energy').value=d.review?.energy||'';$('evening-focus').value=d.review?.concentration||'';$('evening-reason').value=d.review?.reason||'';$('evening-notes').value=d.review?.notes||'';$('evening-tomorrow').value=d.review?.tomorrow||'';const unfinished=ts.filter(t=>['partial','unfinished','planned'].includes(taskStatus(t)));$('unfinished-items').innerHTML=unfinished.length?unfinished.map(t=>`<div class="list-row"><div><strong>${esc(t.title)}</strong><small>${esc(taskStatus(t))}</small></div><button class="button button-small" data-carry="${esc(t.id)}">Move to tomorrow</button></div>`).join(''):'<p class="muted">No unfinished items recorded for this day.</p>';}
  $('evening-form').addEventListener('submit',e=>{e.preventDefault();const d=day($('evening-date').value||today());d.review={energy:$('evening-energy').value,concentration:$('evening-focus').value,reason:$('evening-reason').value,notes:$('evening-notes').value,tomorrow:$('evening-tomorrow').value,savedAt:new Date().toISOString()};save();toast('Daily review saved.');});
  $('unfinished-items').addEventListener('click',e=>{const b=e.target.closest('[data-carry]');if(!b)return;const from=$('evening-date').value||today(),to=plusDays(from,1),t=day(from).tasks.find(x=>x.id===b.dataset.carry);if(!t)return;if(t.sourceId&&scheduledFor(to).some(s=>s.id===t.sourceId)){toast('This recurring item is already scheduled for tomorrow; the original day record is retained.');return;}day(to).tasks.push({...t,id:crypto.randomUUID?crypto.randomUUID():String(Date.now()),sourceId:undefined,occurrenceDate:to,status:'planned',completed:false,actualMinutes:0,carriedFrom:from});save();toast(`Moved to ${to}; original record retained.`);renderEvening();});
  // Monthly vegetarian menu. PDF.js is used when available; other text files are read directly.
  const monthNames=['January','February','March','April','May','June','July','August','September','October','November','December'];$('menu-month').innerHTML=monthNames.map((m,i)=>`<option value="${String(i+1).padStart(2,'0')}">${m}</option>`).join('');$('menu-month').value=String(new Date().getMonth()+1).padStart(2,'0');$('menu-year').value=new Date().getFullYear();
  const scriptCache = {};
  function loadExternalScript(src, globalName) {
    if (window[globalName]) return Promise.resolve(window[globalName]);
    if (scriptCache[src]) return scriptCache[src];
    scriptCache[src] = new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.async=true;script.onload=()=>window[globalName]?resolve(window[globalName]):reject(new Error(`${globalName} unavailable`));script.onerror=()=>reject(new Error(`Could not load ${globalName}`));document.head.appendChild(script);});
    return scriptCache[src];
  }
  function parseStructuredWorkbook(XLSX, book) {
    const bySheet = {}; let totalDates = 0;
    for (const sheetName of book.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(book.Sheets[sheetName], {header:1, raw:false, defval:''});
      const norm = v => String(v ?? '').replace(/\s+/g,' ').trim().toLowerCase();
      const headerIndex = rows.findIndex(row => norm(row[0]) === 'day' && ['breakfast','lunch','snacks','dinner'].every(h => row.some(c => norm(c) === h)));
      if (headerIndex < 0) continue;
      const header = rows[headerIndex].map(norm), col = Object.fromEntries(['breakfast','lunch','snacks','dinner'].map(h => [h, header.indexOf(h)]));
      const days = {}; let currentDates = [];
      for (let i=headerIndex+1;i<rows.length;i++) {
        const row=rows[i]||[], first=String(row[0]??'').replace(/\n/g,' ').trim();
        const match=first.match(/\b(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?\b\s*[,/-]?\s*([\d,\s]+)/i);
        if(match){currentDates=[...new Set((match[1].match(/\d{1,2}/g)||[]).map(Number).filter(n=>n>=1&&n<=31))];for(const n of currentDates)if(!days[n])days[n]={breakfast:[],lunch:[],snacks:[],dinner:[]};}
        else if(first&&/^(day|breakfast|lunch|snacks|dinner)$/i.test(first)) currentDates=[];
        if(!currentDates.length)continue;
        for(const meal of ['breakfast','lunch','snacks','dinner']){const ci=col[meal];if(ci<0)continue;const cell=String(row[ci]??'').replace(/\s+/g,' ').trim();if(cell)for(const n of currentDates)if(!days[n][meal].includes(cell))days[n][meal].push(cell);}
      }
      const valid=Object.values(days).filter(d=>['breakfast','lunch','snacks','dinner'].some(m=>d[m].length)).length;
      if(valid){bySheet[sheetName]={sheetName,days};totalDates=Math.max(totalDates,valid);}
    }
    return Object.keys(bySheet).length?{format:'sarathi-menu-v1',sheets:bySheet,dayCount:totalDates,sourceSheets:book.SheetNames}:null;
  }
  function getStructuredDay(menu, date, messType='veg') {
    const dt=parseDate(date), sheets=menu?.structured?.sheets;
    if(!sheets)return null;
    const names=Object.keys(sheets), special=String(messType).startsWith('special-');
    const preferred=special
      ? names.find(n=>/^special$/i.test(n))
      : names.find(n=>/veg\s*&\s*non.?veg/i.test(n)) || names.find(n=>!/special/i.test(n));
    const sheet=preferred?sheets[preferred]:null, base=sheet?.days?.[dt.getDate()];
    if(!base)return null;
    return {breakfast:[...(base.breakfast||[])],lunch:[...(base.lunch||[])],snacks:[...(base.snacks||[])],dinner:[...(base.dinner||[])],sheetName:preferred};
  }
  function menuIsAnimal(item){return /\b(chicken|fish|prawn|shrimp|mutton|meat|seafood|egg|omelet|omelette|omlet)\b/i.test(item)||/\(\s*(?:non.?veg|nv)\s*\)/i.test(item)||/\bNV\b/i.test(item);}
  function cleanMenuItem(item){return String(item).replace(/\s*\(\s*(?:non.?veg|nv)\s*\)/ig,'').replace(/\s*\(\s*veg\s*\)/ig,'').replace(/\s+/g,' ').trim();}
  function filterMenuItems(items,messType,dayNum=null){
    const vegetarian=messType==='veg'||messType==='special-veg';
    const out=[];
    for(const raw of items||[]){
      // Split a cell into separate dishes, then choose the appropriate side of a veg/non-veg alternative.
      const chunks=String(raw).split(/,\s+(?=[A-Z])/).map(x=>x.trim()).filter(Boolean);
      for(let chunk of chunks){
        const dateMarker=chunk.match(/\(\s*(\d{1,2}(?:\s*,\s*\d{1,2})*)\s*\)/);
        if(dateMarker){const dates=dateMarker[1].split(',').map(v=>Number(v.trim())).filter(v=>v>=1&&v<=31);if(dayNum&&dates.length&&!dates.includes(Number(dayNum)))continue;chunk=chunk.replace(dateMarker[0],' ').replace(/\s+/g,' ').trim();}
        const alternatives=chunk.split(/\s*\/\s*/).map(x=>x.trim()).filter(Boolean);
        let choices=alternatives;
        if(alternatives.length>1){
          const vegChoices=alternatives.filter(x=>!menuIsAnimal(x)&&!/\b(?:non.?veg|NV)\b/i.test(x));
          const animalChoices=alternatives.filter(x=>menuIsAnimal(x)||/\b(?:non.?veg|NV)\b/i.test(x));
          if(vegetarian&&animalChoices.length&&vegChoices.length) choices=vegChoices;
          else if(vegetarian&&animalChoices.length&&!vegChoices.length) choices=[];
          else if(!vegetarian&&animalChoices.length&&vegChoices.length) choices=animalChoices;
        }
        for(const item of choices){
          if(vegetarian&&menuIsAnimal(item))continue;
          const cleaned=cleanMenuItem(item);
          if(cleaned&&!out.some(x=>x.toLowerCase()===cleaned.toLowerCase()))out.push(cleaned);
        }
      }
    }
    return out;
  }
  function mealRecommendations(items,messType,dayNum=null){
    const filtered=filterMenuItems(items,messType,dayNum).filter(Boolean);
    const isVeg=x=>/vegetable|veg|greens|spinach|carrot|beans|cabbage|gourd|bhindi|okra|salad|sambar|dal|dhal|lentil|sprout|chana|chickpea|rajma|paneer|curd|yogurt|buttermilk|fruit|millet|daliya|oats|idli|dosa|chapati|chapathi|roti|pulk|whole wheat|pongal|poha|sevai|upma|rice|rasam|poriyal|curry|pappu|chole|sorrel|gongura|ridge gourd|tomato/i.test(x);
    const protein=x=>/dal|dhal|lentil|sprout|chana|chickpea|rajma|paneer|curd|yogurt|milk|egg|chicken|fish|prawn|beans|pappu|chole|peanut/i.test(x);
    const grains=x=>/rice|roti|chapati|pulk|poori|puri|dosa|idli|poha|sevai|upma|pongal|daliya|paratha|bread|noodle|millet/i.test(x);
    const moderate=x=>/fried|bajji|bhajji|pakoda|puri|poori|fry|fryums|chips|samosa|puff|cake|payasam|custard|sweet|dessert|noodle|manchuria|paratha|bhature|vada pav/i.test(x);
    return {available:filtered,vegetables:filtered.filter(isVeg).slice(0,5),proteins:[...new Set(filtered.filter(protein))].slice(0,4),grains:[...new Set(filtered.filter(grains))].slice(0,4),moderate:[...new Set(filtered.filter(moderate))].slice(0,5)};
  }
  $('menu-file').addEventListener('change',async e=>{
    const f=e.target.files?.[0];if(!f)return;const name=f.name.toLowerCase();pendingStructuredMenu=null;
    try {
      if(f.type==='text/csv'||/\.(csv|txt|md)$/i.test(name)){$('menu-text').value=await f.text();$('menu-status').textContent=`Loaded text from ${f.name}. Review the extracted rows before saving.`;}
      else if(/\.pdf$/i.test(name)){
        if(!window.pdfjsLib)throw new Error('PDF text extraction library is unavailable');
        const data=new Uint8Array(await f.arrayBuffer());pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';const pdf=await pdfjsLib.getDocument({data}).promise;let text='';
        for(let p=1;p<=pdf.numPages;p++){const page=await pdf.getPage(p),content=await page.getTextContent();text+=`\n--- Page ${p} ---\n`+content.items.map(x=>x.str).join(' ')+'\n';$('menu-status').textContent=`Reading PDF page ${p} of ${pdf.numPages}…`;}
        $('menu-text').value=text;$('menu-status').textContent=`Extracted text from ${f.name}. Verify weekday and meal alignment against the original before saving.`;
      } else if(/\.(xlsx|xls|ods)$/i.test(name)) {
        $('menu-status').textContent='Reading spreadsheet rows and grouping each weekday with its meal columns…';
        const XLSX=await loadExternalScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js','XLSX');
        const bytes=new Uint8Array(await f.arrayBuffer()),book=XLSX.read(bytes,{type:'array'});
        pendingStructuredMenu=parseStructuredWorkbook(XLSX,book);let text='';
        book.SheetNames.forEach(sheetName=>{text+=`\n--- Sheet: ${sheetName} ---\n`+XLSX.utils.sheet_to_csv(book.Sheets[sheetName])+'\n';});$('menu-text').value=text;
        $('menu-status').textContent=pendingStructuredMenu?`Structured menu detected: ${pendingStructuredMenu.dayCount} calendar dates mapped to Breakfast, Lunch, Snacks and Dinner. Save the menu for date-specific recommendations.`:'Spreadsheet text extracted, but the weekday/meal table could not be mapped confidently. The app will disclose this instead of claiming undated options are today’s menu.';
      } else if(f.type.startsWith('image/')||/\.(png|jpe?g|webp)$/i.test(name)) {
        $('menu-status').textContent='Loading image text recognition. This may take a little time and requires an internet connection…';const Tesseract=await loadExternalScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js','Tesseract');const result=await Tesseract.recognize(f,'eng',{logger:m=>{if(m.status==='recognizing text')$('menu-status').textContent=`Reading menu image… ${Math.round((m.progress||0)*100)}%`;}});$('menu-text').value=result.data.text||'';$('menu-status').textContent=$('menu-text').value.trim()?`Extracted text from ${f.name}. OCR may make mistakes; verify names, dates and meal rows before saving.`:'No readable text found. Paste the menu text manually and save.';
      } else {$('menu-status').textContent='Unsupported file type. Choose PDF, image, CSV, text or spreadsheet, or paste menu text below.';}
    } catch(err) {console.error(err);$('menu-status').textContent='Automatic extraction failed or the reader could not load. You can still paste or edit the menu text below and save.';}
  });
  $('menu-text').addEventListener('input',()=>{ if(pendingStructuredMenu) pendingStructuredMenu=null; });
  $('menu-toggle').addEventListener('click',()=>{const panel=$('menu-upload-panel'),opening=panel.hidden;panel.hidden=!opening;$('menu-toggle').setAttribute('aria-expanded',String(opening));$('menu-toggle').textContent=opening?'− Close menu upload':'＋ Upload monthly menu';if(opening){const chosen=$('menu-view-select').value;if(chosen){const saved=state.menus[chosen];if(saved){$('menu-month').value=String(saved.month).padStart(2,'0');$('menu-year').value=saved.year;$('menu-text').value=saved.text||'';pendingStructuredMenu=saved.structured||null;$('menu-type').value=saved.type||'veg';}}}});
  const resetMenuSuggestion=()=>{menuSuggestionRequested=false;$('menu-suggestions').innerHTML='';};
  $('menu-get-suggestion').addEventListener('click',()=>{menuSuggestionRequested=true;renderMenuSuggestions($('menu-date').value||today());});
  $('menu-options-toggle').addEventListener('click',()=>{const content=$('menu-options-content'),opening=content.hidden;content.hidden=!opening;$('menu-options-toggle').setAttribute('aria-expanded',String(opening));$('menu-options-toggle').textContent=opening?'− Minimize':'+ Show options';});
  $('menu-type').addEventListener('change',resetMenuSuggestion);
  $('menu-meal-select').addEventListener('change',resetMenuSuggestion);
  $('menu-date').addEventListener('change',resetMenuSuggestion);
  $('menu-form').addEventListener('submit',e=>{e.preventDefault();const text=$('menu-text').value.trim();if(!text){$('menu-status').textContent='Choose a readable menu file or paste the menu text before saving.';return;}const k=`${$('menu-year').value}-${$('menu-month').value}`;if(state.menus[k]){if(!confirm(`A menu is already saved for ${k}. Replace it? The previous version will be archived in your backup.`))return;state.menuArchive ||= [];state.menuArchive.push({...state.menus[k],archivedAt:new Date().toISOString()});}state.menus[k]={key:k,month:+$('menu-month').value,year:+$('menu-year').value,text,structured:pendingStructuredMenu||state.menus[k]?.structured||undefined,type:$('menu-type').value,fileName:$('menu-file').files?.[0]?.name||state.menus[k]?.fileName||'',savedAt:new Date().toISOString()};save();renderMenuSelect(k);resetMenuSuggestion();$('menu-upload-panel').hidden=true;$('menu-toggle').setAttribute('aria-expanded','false');$('menu-toggle').textContent='＋ Upload monthly menu';toast('Monthly menu saved.');});
  function renderMenuSelect(selected){const sel=$('menu-view-select'),keys=Object.keys(state.menus).sort().reverse();sel.innerHTML=keys.length?keys.map(k=>`<option value="${k}">${monthNames[+k.slice(5)-1]} ${k.slice(0,4)}</option>`).join(''):'<option value="">No saved menus</option>';if(selected&&keys.includes(selected))sel.value=selected;sel.onchange=()=>{const m=state.menus[sel.value];if(m){$('menu-month').value=String(m.month).padStart(2,'0');$('menu-year').value=m.year;$('menu-text').value=m.text;pendingStructuredMenu=m.structured||null;$('menu-type').value=m.type||'veg';resetMenuSuggestion();}};}
  function renderMenuSuggestions(date=today()) {
    if(!menuSuggestionRequested){$('menu-suggestions').innerHTML='';return;}
    const dt=parseDate(date),k=`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`,m=state.menus[k];
    if(!m){$('menu-suggestions').innerHTML='<div class="menu-empty"><strong>No menu saved for this month</strong><p>Upload the published menu for this month. No dishes will be invented.</p></div>';return;}
    const weekday=dt.toLocaleDateString('en-US',{weekday:'long'}),messType=$('menu-type')?.value||m.type||'veg',mealKey=$('menu-meal-select')?.value||'breakfast',structured=getStructuredDay(m,date,messType);
    const labels={breakfast:'Breakfast',lunch:'Lunch',snacks:'Snacks',dinner:'Dinner'};
    const mealTitle=labels[mealKey]||'Breakfast';
    // Practical starting portions for generally healthy adults. These are not
    // individualized prescriptions: energy needs vary with body size, age, activity,
    // pregnancy/lactation, health conditions and clinician advice.
    const portionForItem=(item, meal)=>{
      const x=String(item).toLowerCase();
      if(/(fruit|banana|apple|orange|papaya|watermelon|guava|grapes|seasonal)/i.test(x)) return '1 medium fruit or about 1 small bowl (100–150 g); fruit contributes to the WHO daily fruit-and-vegetable goal.';
      if(/(salad|vegetable|veg curry|vegetable curry|greens|spinach|carrot|beans|cabbage|gourd|bhindi|okra|poriyal|sabzi)/i.test(x)) return 'About 1 cup cooked vegetables or a generous bowl of salad (roughly 100–150 g), depending on preparation.';
      if(/(dal|dhal|sambar|pappu|lentil|chana|chole|rajma|chickpea|sprout|beans curry)/i.test(x)) return 'About 1 small-to-medium bowl, 150–200 ml; choose this as a protein/legume accompaniment.';
      if(/(paneer|tofu)/i.test(x)) return 'A modest serving, around 75–100 g, alongside vegetables and a grain; actual needs vary.';
      if(/(chicken|fish|prawn|shrimp|mutton|meat|seafood)/i.test(x)) return 'A typical adult meal portion is around 100–120 g cooked, if this suits your dietary preference and health needs; prefer grilled, steamed or less-oily preparations when available.';
      if(/(egg|omelet|omelette|omlet)/i.test(x)) return 'Usually 1–2 eggs as one protein option, considering the rest of the meal and your personal health advice.';
      if(/(curd|yogurt|buttermilk|milk)/i.test(x)) return 'About 1 small glass/bowl (150–200 ml), if tolerated and consistent with your dietary needs.';
      if(/(rice|pulao|biryani|khichdi|pongal)/i.test(x)) return meal==='lunch'||meal==='dinner' ? 'Start with about 1 cup cooked (roughly 150–180 g); adjust to hunger and activity, and pair with vegetables plus dal/another protein.' : 'Start with about 1 medium bowl; pair with a protein-rich accompaniment if listed.';
      if(/(roti|chapati|chapathi|pulk|phulka|bread|paratha|poori|puri|dosa|idli|upma|poha|sevai|noodle|pasta|oats|daliya|millet)/i.test(x)) return /poori|puri|paratha|fried|bhature/i.test(x) ? 'Start with one standard serving; this item may be oil-rich, so avoid stacking several fried options in the same meal.' : 'Start with 1–2 medium pieces or one medium bowl, depending on the dish; pair with dal, sprouts, curd, egg or another protein if listed.';
      if(/(juice|sweet|cake|payasam|custard|dessert|laddu|gulab jamun|ice cream|sugar)/i.test(x)) return 'Optional small serving; keep sweetened foods/drinks occasional and limit free sugars across the day.';
      if(/(chips|pakoda|bajji|bhajji|samosa|puff|fryums|manchuria|vada)/i.test(x)) return 'If choosing this, keep to one small serving and balance it with a less-fried option; these foods can add substantial oil or salt.';
      return meal==='snacks' ? 'Choose one small serving at a time; prefer a fruit, nuts/legumes or another less-sugary, less-salty option when available.' : 'Take one standard mess serving and combine it with a listed vegetable and protein/legume option where available.';
    };
    const dailyPrinciples=()=>'<div class="menu-nutrition-targets"><strong>Daily balance check (general adult guidance)</strong><ul><li>Work towards at least <b>400 g fruit and vegetables</b> across the day.</li><li>Include whole grains and pulses/other protein sources for variety and fibre.</li><li>WHO advises adults to keep salt below <b>5 g/day</b> and free sugars below <b>10% of daily energy</b> (ideally below 5%). These totals include food prepared outside this one meal.</li></ul><span class="muted small-copy">Reference: WHO Healthy Diet (updated 26 Jan 2026). Quantities shown for individual dishes are practical starting portions, not exact nutrient calculations.</span></div>';
    if(structured){
      const raw=structured[mealKey]||[],available=filterMenuItems(raw,messType,dt.getDate());
      const rec=mealRecommendations(raw,messType,dt.getDate()),priority=[...new Set([...rec.vegetables,...rec.proteins,...rec.grains])].filter(x=>!rec.moderate.includes(x)).slice(0,3);
      const list=available.length?`<ol class="menu-item-order">${available.map(item=>`<li>${esc(item)}</li>`).join('')}</ol>`:'<p class="muted">No items for this meal match the selected mess type on this date. Check the original menu or choose another mess type.</p>';
      const recText=priority.length?`For this ${mealTitle.toLowerCase()}, prioritize ${priority.join(', ')} from today's actual menu. The portions below change with the dishes listed for ${date}.`:'Use the actual dishes listed below to build a balanced meal; the app could not confidently classify some items, so portion notes are conservative.';
      const typeLabel=messType==='special-veg'?'Special mess · Vegetarian':messType==='special-nonveg'?'Special mess · Non-vegetarian':messType==='nonveg'?'Regular mess · Non-vegetarian':'Regular mess · Vegetarian';
      const sleep=state.days[date]?.sleep||{},sleepMins=duration(sleep.bedtime,sleep.wake),context=sleepMins!==null&&sleepMins<420?'<p class="muted small-copy">Your recorded sleep was below the general adult 7-hour reference. Food cannot replace sleep.</p>':'';
      const portionRows=available.length?`<div class="menu-portion-list"><h4>Suggested quantities for today's dishes</h4><ul>${available.map(item=>`<li><strong>${esc(item)}</strong><span>${esc(portionForItem(item,mealKey))}</span></li>`).join('')}</ul></div>`:'<p class="muted">No menu items are available to calculate dish-specific suggestions for this meal.</p>';
      $('menu-suggestions').innerHTML=`<div class="menu-day-line"><strong>${weekday}, ${date}</strong><span>${esc(typeLabel)}</span></div><section class="menu-meal-card"><div class="menu-meal-heading"><span class="menu-step">1</span><div><h3>${mealTitle} menu</h3><p>These are the dishes parsed from the menu for the selected date.</p></div></div>${list}</section><section class="menu-recommendation-card"><div class="menu-meal-heading"><span class="menu-step">2</span><div><h3>Menu-based intake suggestion</h3><p>${esc(recText)}</p></div></div>${portionRows}<p class="muted small-copy">Choose a combination rather than eating every listed dish in full portions. Start with your usual serving, eat to comfortable fullness, and adjust for appetite, activity, allergies, dietary preference and clinician advice.</p></section>${dailyPrinciples()}${context}<p class="muted small-copy menu-source-links">Evidence basis: <a href="https://www.who.int/news-room/fact-sheets/detail/healthy-diet" target="_blank" rel="noopener noreferrer">WHO Healthy Diet</a> · <a href="https://nin.res.in/dietaryguidelines/pdfjs/locale/DGI_2024.pdf" target="_blank" rel="noopener noreferrer">ICMR-NIN Dietary Guidelines for Indians 2024</a>.</p>`;
      return;
    }
    $('menu-suggestions').innerHTML=`<div class="menu-advice"><strong>${weekday}, ${date}</strong><p><b>Daily meal mapping unavailable.</b> This upload does not contain a reliable date-to-meal table. SARATHI will not label undated items as today's menu. Upload the original XLSX with Day, Breakfast, Lunch, Snacks and Dinner columns, then save it.</p><details><summary>Review extracted menu text</summary><pre class="menu-extracted-text">${esc((m.text||'').slice(0,12000))}</pre></details><p class="muted small-copy">General guidance: <a href="https://www.who.int/en/news-room/fact-sheets/detail/healthy-diet" target="_blank" rel="noopener noreferrer">WHO Healthy Diet</a> · <a href="https://nin.res.in/dietaryguidelines/pdfjs/locale/DGI_2024.pdf" target="_blank" rel="noopener noreferrer">ICMR-NIN 2024</a>.</p></div>`;
  }
  function renderHealth(){const k=today(),d=day(k);$('habit-list').innerHTML=state.habits.length?state.habits.map(h=>`<div class="list-row"><label class="task-check"><input type="checkbox" data-habit-check="${esc(h.id)}" ${(d.habitChecks||{})[h.id]?'checked':''}><span><strong>${esc(h.title)}</strong></span></label><button class="button button-small" data-habit-delete="${esc(h.id)}">Remove</button></div>`).join(''):'<p class="muted">No habits added. You can leave this empty.</p>';renderMenuSelect();resetMenuSuggestion();}
  function renderJala(key=$('jala-date').value||today()){
    const d=day(key),total=(d.waterLog||[]).reduce((sum,w)=>sum+(Number(w.ml)||0),0),target=Math.max(0,Number(state.settings.waterTarget)||0),pct=target?Math.min(100,Math.round(total/target*100)):0;
    const fmt=n=>`${Math.round(n).toLocaleString()} ml`;
    $('jala-total').textContent=total>=1000?`${(total/1000).toFixed(total%1000?2:0)} L`:fmt(total);
    $('jala-target').value=target||'';
    $('jala-target-label').textContent=target?`of ${target.toLocaleString()} ml personal target`:'No target set';
    $('jala-progress-bar').style.width=`${pct}%`;
    $('jala-progress-copy').textContent=target?(total>=target?`Personal target reached · ${pct}%`:`${Math.max(0,target-total).toLocaleString()} ml remaining · ${pct}%`):'Set a personal target to see progress.';
    const ring=$('jala-ring-value'),circumference=2*Math.PI*48;
    ring.style.strokeDasharray=String(circumference);
    ring.style.strokeDashoffset=String(circumference-(pct/100)*circumference);
    $('jala-ring-percent').textContent=target?`${pct}%`:'—';
    $('jala-ring-wrap').setAttribute('aria-label',target?`${pct}% of personal daily target; ${fmt(total)} recorded.`:`${fmt(total)} recorded today. Set a target to show progress.`);
    $('jala-entry-count').textContent=`${d.waterLog.length} ${d.waterLog.length===1?'entry':'entries'}`;
    $('jala-analysis-total').textContent=fmt(total);
    $('jala-analysis-percent').textContent=target?`${pct}%`:'—';
    $('jala-analysis-remaining').textContent=target?fmt(Math.max(0,target-total)):'Set a target';
    $('jala-log').innerHTML=d.waterLog.length?[...d.waterLog].sort((a,b)=>String(b.at).localeCompare(String(a.at))).map(w=>`<div class="list-row"><div><strong>${Number(w.ml)||0} ml</strong><small>${new Date(w.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</small></div><button class="button button-small" data-jala-undo="${esc(w.id)}" type="button">Undo</button></div>`).join(''):'<p class="muted">No water recorded for this date.</p>';
    const bars=[];for(let i=6;i>=0;i--){const k=plusDays(key,-i),sum=(state.days[k]?.waterLog||[]).reduce((a,w)=>a+(Number(w.ml)||0),0);bars.push({k,sum});}
    const max=Math.max(1,target,...bars.map(x=>x.sum));$('jala-week-chart').innerHTML=bars.map(x=>`<div class="jala-day-bar" title="${x.k}: ${fmt(x.sum)}"><div class="jala-bar-track"><span style="height:${Math.max(x.sum?3:0,x.sum/max*100)}%"></span></div><b>${x.sum?`${(x.sum/1000).toFixed(x.sum%1000?1:0)}L`:'—'}</b><small>${x.k.slice(5)}</small></div>`).join('');
  }
  function addWater(amount,key=$('jala-date').value||today()){const ml=Math.round(Number(amount));if(!Number.isFinite(ml)||ml<1||ml>3000){toast('Enter an amount between 1 and 3000 ml.');return;}day(key).waterLog.push({id:String(Date.now()+Math.random()),ml,at:new Date().toISOString()});save();renderJala(key);}
  $('habit-form').addEventListener('submit',e=>{e.preventDefault();const title=$('habit-name').value.trim();if(!title)return;state.habits.push({id:crypto.randomUUID?crypto.randomUUID():String(Date.now()),title});$('habit-name').value='';save();renderHealth();renderDashboard();});$('habit-list').addEventListener('change',e=>{const id=e.target.dataset.habitCheck;if(!id)return;const d=day(today());d.habitChecks||={};d.habitChecks[id]=e.target.checked;save();renderHealth();renderDashboard();});$('habit-list').addEventListener('click',e=>{const b=e.target.closest('[data-habit-delete]');if(!b)return;const habit=state.habits.find(h=>h.id===b.dataset.habitDelete);if(!habit)return;const checks={};Object.entries(state.days).forEach(([key,d])=>{if(d.habitChecks&&Object.prototype.hasOwnProperty.call(d.habitChecks,habit.id))checks[key]=d.habitChecks[habit.id];});state.habits=state.habits.filter(h=>h.id!==habit.id);Object.values(state.days).forEach(d=>{if(d.habitChecks)delete d.habitChecks[habit.id];});save();renderHealth();renderDashboard();toast('Habit removed.',()=>{state.habits.push(habit);Object.entries(checks).forEach(([key,value])=>{state.days[key].habitChecks||={};state.days[key].habitChecks[habit.id]=value;});save();renderHealth();renderDashboard();});});
  $('view-jala').addEventListener('click',e=>{const preset=e.target.closest('[data-jala-preset]');if(preset){addWater(Number(preset.dataset.jalaPreset));}});
  const jalaAddToggle=$('jala-add-toggle'),jalaTargetToggle=$('jala-target-toggle');function toggleJalaPanel(which){const add=$('jala-custom-form'),targetForm=$('jala-target-form'),showAdd=which==='add'&&add.hidden,showTarget=which==='target'&&targetForm.hidden;add.hidden=!showAdd;targetForm.hidden=!showTarget;jalaAddToggle.setAttribute('aria-expanded',String(showAdd));jalaTargetToggle.setAttribute('aria-expanded',String(showTarget));if(showAdd)$('jala-custom-amount').focus();if(showTarget)$('jala-target').focus();}jalaAddToggle.addEventListener('click',()=>toggleJalaPanel('add'));jalaTargetToggle.addEventListener('click',()=>toggleJalaPanel('target'));$('jala-custom-form').addEventListener('submit',e=>{e.preventDefault();const amount=$('jala-custom-amount').value;addWater(amount);$('jala-custom-amount').value='';});$('jala-target-form').addEventListener('submit',e=>{e.preventDefault();const value=Number($('jala-target').value)||0;if(value&&(value<250||value>10000)){toast('Choose a target between 250 and 10000 ml, or leave it blank.');return;}state.settings.waterTarget=value;save();renderJala();$('jala-target-form').hidden=true;jalaTargetToggle.setAttribute('aria-expanded','false');toast(value?'Personal water target saved.':'Daily target cleared.');});$('jala-log').addEventListener('click',e=>{const b=e.target.closest('[data-jala-undo]');if(!b)return;const key=$('jala-date').value||today();day(key).waterLog=day(key).waterLog.filter(w=>w.id!==b.dataset.jalaUndo);save();renderJala(key);});
  function renderSleep(){const key=$('sleep-date').value||today(),d=day(key),s=d.sleep||{};$('sleep-bedtime').value=s.bedtime||'';$('sleep-wake').value=s.wake||'';$('sleep-quality').value=s.quality||'';updateSleepPreview();$('nap-list').innerHTML=d.naps.length?d.naps.map((n,i)=>`<div class="list-row"><div><strong>${esc(n.start)}–${esc(n.end)} · ${minsLabel(duration(n.start,n.end))}</strong><small>${esc(n.note||'Daytime sleep')}</small></div><button class="button button-small" data-remove-nap="${i}">Remove</button></div>`).join(''):'<p class="muted">No daytime sleep recorded for this date.</p>';renderSleepReport(key);}
  function updateSleepPreview(){const dur=duration($('sleep-bedtime').value,$('sleep-wake').value);$('sleep-duration-preview').textContent=dur===null?'Duration will be calculated automatically.':`Nighttime sleep duration: ${Math.floor(dur/60)} h ${dur%60} min`;}
  const daySleepToggle=$('day-sleep-toggle'),daySleepPanel=$('day-sleep-panel'),daySleepClose=$('day-sleep-close');function setDaySleepOpen(open){daySleepPanel.hidden=!open;daySleepToggle.setAttribute('aria-expanded',String(open));daySleepToggle.textContent=open?'− Hide daytime sleep':'＋ Add daytime sleep';if(open)$('nap-start').focus();}daySleepToggle.addEventListener('click',()=>setDaySleepOpen(daySleepPanel.hidden));daySleepClose.addEventListener('click',()=>setDaySleepOpen(false));
  ['sleep-bedtime','sleep-wake'].forEach(id=>$(id).addEventListener('input',updateSleepPreview));$('sleep-form').addEventListener('submit',e=>{e.preventDefault();const key=$('sleep-date').value||today(),dur=duration($('sleep-bedtime').value,$('sleep-wake').value);if(dur===null||dur>1440){toast('Check the bedtime and wake-up times.');return;}day(key).sleep={bedtime:$('sleep-bedtime').value,wake:$('sleep-wake').value,quality:+$('sleep-quality').value,updatedAt:new Date().toISOString()};save();renderSleep();toast('Sleep diary saved.');});$('nap-form').addEventListener('submit',e=>{e.preventDefault();const key=$('sleep-date').value||today(),dur=duration($('nap-start').value,$('nap-end').value);if(dur===null||dur>1440){toast('Check the nap times.');return;}day(key).naps.push({start:$('nap-start').value,end:$('nap-end').value,note:$('nap-note').value});save();e.target.reset();renderSleep();});$('nap-list').addEventListener('click',e=>{const b=e.target.closest('[data-remove-nap]');if(!b)return;const key=$('sleep-date').value||today(),naps=day(key).naps,index=+b.dataset.removeNap,removed=naps[index];if(!removed)return;naps.splice(index,1);save();renderSleep();toast('Nap record removed.',()=>{naps.splice(Math.min(index,naps.length),0,removed);save();renderSleep();});});$('sleep-trend-range').addEventListener('change',()=>renderSleepReport($('sleep-date').value||today()));
  function renderSleepReport(key){const d=day(key),s=d.sleep||{},dur=duration(s.bedtime,s.wake),count=Number($('sleep-trend-range').value||7),rows=[];for(let i=count-1;i>=0;i--){const k=plusDays(key,-i),ss=state.days[k]?.sleep||{},m=duration(ss.bedtime,ss.wake);if(m!==null)rows.push({k,m,quality:+ss.quality||null});}let assessment='Record nighttime sleep for a short, evidence-aware summary.';if(dur!==null){if(dur<420)assessment='Below the general 7-hour adult reference. One night alone does not establish a sleep problem.';else assessment='Meets the general 7-hour adult reference for duration; quality is self-rated.';if(+s.quality<=2)assessment+=' Your quality rating is low; observe whether this repeats.';}const naps=d.naps||[];$('sleep-report').innerHTML=`<div class="sleep-report-main"><div><span class="stat-label">Nighttime duration</span><strong>${dur===null?'—':minsLabel(dur)}</strong></div><div><span class="stat-label">Quality</span><strong>${s.quality?`${s.quality}/5`:'—'}</strong></div><div><span class="stat-label">Daytime sleep</span><strong>${naps.length?minsLabel(naps.reduce((a,n)=>a+(duration(n.start,n.end)||0),0)):'None logged'}</strong></div></div><p>${esc(assessment)}</p>`;$('sleep-trend').innerHTML=rows.length?rows.map(r=>`<div class="sleep-trend-row"><span>${r.k}</span><div class="sleep-track"><span style="width:${Math.min(100,r.m/600*100)}%"></span></div><strong>${minsLabel(r.m)}</strong><small>${r.quality?`Quality ${r.quality}/5`:''}</small></div>`).join(''):'<p class="muted">Sleep trends appear after records are saved.</p>';}
  // Optional browser notifications. In-page checks only run while the app is open.
  async function enableNotifications(){if(!('Notification'in window)){toast('This browser does not support notifications.');return;}const permission=await Notification.requestPermission();state.notificationsEnabled=permission==='granted';save();toast(state.notificationsEnabled?'Browser notifications enabled.':'Browser notifications were not enabled.');}
  function checkReminders(){if(document.hidden)return;const now=new Date(),key=today(),minute=now.getHours()*60+now.getMinutes();state.schedules.filter(s=>!s.archived&&s.reminder!=='none'&&s.time&&getOccurrence(s,key)).forEach(s=>{const tm=s.time.split(':').map(Number),target=tm[0]*60+tm[1]-(s.reminder==='at-time'?0:Number(s.reminder));const stamp=`${key}:${s.id}:${s.time}:${s.reminder}`;if(minute===target&&!state.reminderLog[stamp]){state.reminderLog[stamp]=true;save();toast(`Reminder: ${s.title}`);if(state.notificationsEnabled&&'Notification'in window&&Notification.permission==='granted')new Notification('SARATHI reminder',{body:s.title});}});}
  // Export/import preserves the original storage key and all recorded feature data.
  const exportButton=$('export-btn'), importButton=$('import-btn'), importInput=$('import-file'), notifyButton=$('notify-btn');
  if (exportButton) exportButton.addEventListener('click',()=>{
    let orbitLayout={},orbitMotionSetting='on';try{orbitLayout=JSON.parse(localStorage.getItem(ORBIT_LAYOUT_KEY)||'{}');orbitMotionSetting=localStorage.getItem(ORBIT_MOTION_KEY)||'on';}catch(e){}const exportPayload={...state,appPreferences:{orbitLayout,orbitMotion:orbitMotionSetting}};const blob=new Blob([JSON.stringify(exportPayload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=`sarathi-backup-${today()}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Backup exported. Keep it somewhere safe.');
  });
  if (importInput) importInput.addEventListener('change',async e=>{
    const f=e.target.files?.[0];if(!f)return;
    try {
      const imported=JSON.parse(await f.text());
      if(!imported||typeof imported!=='object'||!imported.days||typeof imported.days!=='object'||Array.isArray(imported.days)||!Array.isArray(imported.schedules||[])||(imported.menus!==undefined&&(!imported.menus||typeof imported.menus!=='object'))) throw Error('Invalid backup structure');
      if(!confirm('Import this backup and replace current SARATHI records in this browser? Export your current data first if you want to keep both.')) return;
      const base=defaultState();
      state={...base,...imported,settings:{...base.settings,...(imported.settings||{})},days:imported.days,habits:Array.isArray(imported.habits)?imported.habits:[],templates:Array.isArray(imported.templates)?imported.templates:[],schedules:Array.isArray(imported.schedules)?imported.schedules:[],menus:imported.menus&&typeof imported.menus==='object'?imported.menus:{},menuArchive:Array.isArray(imported.menuArchive)?imported.menuArchive:[],reminderLog:imported.reminderLog&&typeof imported.reminderLog==='object'?imported.reminderLog:{}};delete state.appPreferences;
      try { const prefs=imported.appPreferences||{}; if(prefs.orbitLayout&&typeof prefs.orbitLayout==='object')localStorage.setItem(ORBIT_LAYOUT_KEY,JSON.stringify(prefs.orbitLayout)); if(prefs.orbitMotion==='on'||prefs.orbitMotion==='off')localStorage.setItem(ORBIT_MOTION_KEY,prefs.orbitMotion); } catch(e) {}
      restoreOrbitLayout();applyOrbitMotion();save();renderAll();toast('Backup imported. Review your records before continuing.');
    } catch(err) { toast('Import failed: this file is not a valid SARATHI backup. Your current records were not replaced.'); }
    finally { e.target.value=''; }
  });
  if (importButton && importInput) importButton.addEventListener('click',()=>importInput.click());
  if (notifyButton) notifyButton.addEventListener('click',enableNotifications);
  function renderAll(){renderDashboard();renderMorning();renderEvening();renderHealth();renderSleep();renderJala();}
  // Existing saved records remain under the same key; create occurrences for today without overwriting them.
  syncScheduled(today());save();renderAll();setInterval(checkReminders,15000);
  // Ekagra dedicated focus timer: one duration input, Start and End controls, with a simple countdown timer.
  let focusInterval=null,focusEndsAt=0,focusRemaining=25*60,focusSessionStart=0,focusSessionPlanned=25*60;
  function focusDraw(){const s=Math.max(0,Math.ceil(focusRemaining)),m=String(Math.floor(s/60)).padStart(2,'0'),sec=String(s%60).padStart(2,'0');$('focus-display').textContent=`${m}:${sec}`;const running=!!focusInterval;$('focus-start').disabled=running;$('focus-end').disabled=!running;$('focus-duration').disabled=running;}
  function finishFocus(completed){if(!focusInterval)return;clearInterval(focusInterval);focusInterval=null;focusRemaining=completed?0:Math.max(0,Math.ceil((focusEndsAt-Date.now())/1000));const elapsed=Math.max(0,Math.round((Date.now()-focusSessionStart)/60000));if(elapsed>0){const d=day(today());d.focusSessions ||= [];d.focusSessions.push({startedAt:new Date(focusSessionStart).toISOString(),endedAt:new Date().toISOString(),plannedMinutes:Math.round(focusSessionPlanned/60),actualMinutes:elapsed,completed:!!completed});save();}focusDraw();$('focus-status').textContent=completed?'Session complete. Take a moment before starting another.':'Session ended.';toast(completed?'Ekagra session complete.':'Ekagra session ended.');if(completed&&state.notificationsEnabled&&'Notification'in window&&Notification.permission==='granted')new Notification('SARATHI · Ekagra',{body:'Your focus session is complete.'});}
  function focusTick(){focusRemaining=Math.max(0,Math.ceil((focusEndsAt-Date.now())/1000));focusDraw();if(focusRemaining<=0)finishFocus(true);}
  $('focus-duration').addEventListener('change',()=>{if(focusInterval)return;const mins=Math.max(1,Math.min(180,Number($('focus-duration').value)||25));$('focus-duration').value=mins;focusRemaining=mins*60;focusDraw();});
  $('focus-start').addEventListener('click',()=>{if(focusInterval)return;const mins=Math.max(1,Math.min(180,Number($('focus-duration').value)||25));$('focus-duration').value=mins;focusRemaining=mins*60;focusSessionPlanned=focusRemaining;focusSessionStart=Date.now();focusEndsAt=Date.now()+focusRemaining*1000;focusInterval=setInterval(focusTick,250);$('focus-status').textContent='Focus session running.';focusDraw();});
  $('focus-end').addEventListener('click',()=>finishFocus(false));focusDraw();

  // Daily Gita: use a validated 700-verse corpus in exact chapter/verse order.
  // Sanskrit text is sourced from Gita Bhawan's public corpus, with a secondary
  // Sanskrit corpus as fallback. Telugu meaning is taken from source data when
  // present; otherwise it is translated and cached, with that status disclosed.
  const GITA_CORPUS_URLS = [
    "assets/data/gita-corpus.json",
    "https://cdn.jsdelivr.net/gh/AdiyogiArts/gita-json@main/base.json",
    "https://gitabhawan.org.in/data/gita-corpus.json"
  ];
  // Prefer the bundled local corpus so daily verses work without third-party APIs.
  const GITA_CACHE_KEY = "sarathi.gita.corpus.v1";
  const GITA_ENGLISH_URLS = [
    "https://cdn.jsdelivr.net/gh/AdiyogiArts/gita-json@main/en.json",
    "https://raw.githubusercontent.com/AdiyogiArts/gita-json/main/en.json"
  ];
  const GITA_EPOCH = "2026-10-19"; // Day 1 = 1.1; then 1.2, 1.3 ... 18.78.
  const GITA_CHAPTER_VERSE_COUNTS = [47,72,43,42,29,47,30,28,34,42,55,20,34,27,20,24,28,78];

  function flattenVerseDataset(data) {
    if (Array.isArray(data?.verses)) return data.verses;
    if (Array.isArray(data?.chapters)) {
      const out = [];
      data.chapters.forEach(ch => (ch.verses || []).forEach(v => {
        const chapter = v.chapter ?? v.chapter_number ?? ch.chapter_number ?? ch.n;
        const verse = v.verse ?? v.verse_number;
        out.push({ ...v, chapter, verse, ref: v.ref || `${chapter}.${verse}` });
      }));
      return out;
    }
    // The secondary source stores verses in an object keyed like "1-1".
    if (data && typeof data === "object") {
      return Object.values(data).filter(v => v && typeof v === "object" &&
        (v.chapter != null || v.chapter_number != null) &&
        (v.sanskrit || v.slok || v.shloka));
    }
    return [];
  }

  function normalizeGitaCorpus(data) {
    const verses = flattenVerseDataset(data).map(v => {
      const chapter = Number(v.chapter ?? v.chapter_number);
      const verse = Number(v.verse ?? v.verse_number);
      const translations = v.translations && typeof v.translations === "object" ? v.translations : {};
      const translation = v.translation && typeof v.translation === "object" ? v.translation : {};
      const english = v.english || v.translation_english || translations.english ||
        translations.en || translation.english || "";
      const telugu = v.telugu || v.translation_telugu || translations.telugu ||
        translations.te || translation.telugu || translations.Telugu || "";
      return {
        ...v,
        chapter,
        verse,
        sanskrit: String(v.sanskrit || v.slok || v.shloka || "").trim(),
        english: typeof english === "string" ? english : (english?.text || english?.translation || english?.meaning || ""),
        telugu: typeof telugu === "string" ? telugu : (telugu?.text || telugu?.translation || telugu?.meaning || ""),
        ref: `${chapter}.${verse}`
      };
    }).filter(v => Number.isInteger(v.chapter) && v.chapter >= 1 && v.chapter <= 18 &&
      Number.isInteger(v.verse) && v.verse >= 1 && v.sanskrit);

    verses.sort((a, b) => a.chapter - b.chapter || a.verse - b.verse);

    // Validate the complete canonical sequence, not just the first and last IDs.
    // This catches gaps, duplicates, out-of-range verses, and partial source files.
    const expected = [];
    GITA_CHAPTER_VERSE_COUNTS.forEach((count, index) => {
      for (let n = 1; n <= count; n++) expected.push(`${index + 1}.${n}`);
    });
    const actual = verses.map(v => `${v.chapter}.${v.verse}`);
    if (expected.length !== 700 || actual.length !== 700 ||
        new Set(actual).size !== 700 ||
        actual.some((ref, index) => ref !== expected[index])) {
      throw new Error(`Gita corpus does not match the complete canonical sequence (found ${actual.length} verses)`);
    }
    return verses;
  }

  function localDayNumber(dateKey) {
    const parts = String(dateKey).split("-").map(Number);
    const epochParts = GITA_EPOCH.split("-").map(Number);
    if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return 0;
    const currentUtc = Date.UTC(parts[0], parts[1] - 1, parts[2]);
    const epochUtc = Date.UTC(epochParts[0], epochParts[1] - 1, epochParts[2]);
    return Math.max(0, Math.floor((currentUtc - epochUtc) / 86400000));
  }

  // Deterministic Devanagari-to-Telugu script conversion. This renders the
  // Sanskrit verse in Telugu script; it is not a translation of its meaning.
  function devanagariToTelugu(input) {
    const independent = {
      "अ":"అ","आ":"ఆ","इ":"ఇ","ई":"ఈ","उ":"ఉ","ऊ":"ఊ","ऋ":"ఋ","ॠ":"ౠ",
      "ऌ":"ఌ","ॡ":"ౡ","ए":"ఏ","ऐ":"ఐ","ओ":"ఓ","औ":"ఔ","ऍ":"ఎ","ऑ":"ఆ"
    };
    const consonants = {
      "क":"క","ख":"ఖ","ग":"గ","घ":"ఘ","ङ":"ఙ","च":"చ","छ":"ఛ","ज":"జ","झ":"ఝ","ञ":"ఞ",
      "ट":"ట","ठ":"ఠ","ड":"డ","ढ":"ఢ","ण":"ణ","त":"త","थ":"థ","द":"ద","ध":"ధ","न":"న",
      "प":"ప","फ":"ఫ","ब":"బ","भ":"భ","म":"మ","य":"య","र":"ర","ल":"ల","व":"వ",
      "श":"శ","ष":"ష","स":"స","ह":"హ","ळ":"ళ","क़":"ఖ","ख़":"ఖ","ग़":"గ","ज़":"జ","ड़":"డ","ढ़":"ఢ","फ़":"ఫ"
    };
    const matras = {
      "ा":"ా","ि":"ి","ी":"ీ","ु":"ు","ू":"ూ","ृ":"ృ","ॄ":"ౄ","ॢ":"ౢ","ॣ":"ౣ",
      "े":"ే","ै":"ై","ो":"ో","ौ":"ౌ","ॅ":"ె","ॉ":"ా","ं":"ం","ः":"ః","ँ":"ఁ",
      "्":"్","ऽ":"ఽ","।":"।","॥":"॥","॰":"॰"
    };
    const digits = {"०":"౦","१":"౧","२":"౨","३":"౩","४":"౪","५":"౫","६":"౬","७":"౭","८":"౮","९":"౯"};
    const specials = {"ॐ":"ఓం","॑":"","॒":"","॓":"","॔":""};
    let out = "";
    for (const c of Array.from(String(input || "").normalize("NFC"))) {
      if (Object.prototype.hasOwnProperty.call(independent, c)) out += independent[c];
      else if (Object.prototype.hasOwnProperty.call(consonants, c)) out += consonants[c];
      else if (Object.prototype.hasOwnProperty.call(matras, c)) out += matras[c];
      else if (Object.prototype.hasOwnProperty.call(digits, c)) out += digits[c];
      else if (Object.prototype.hasOwnProperty.call(specials, c)) out += specials[c];
      else out += c;
    }
    return out;
  }

  const GITA_TELUGU_CACHE_KEY = "sarathi.gita.telugu.meanings.v2";
  function readTeluguMeaningCache() {
    try {
      const data = JSON.parse(localStorage.getItem(GITA_TELUGU_CACHE_KEY) || "{}");
      return data && typeof data === "object" && !Array.isArray(data) ? data : {};
    } catch (_) { return {}; }
  }
  function saveTeluguMeaningCache(cache) {
    try { localStorage.setItem(GITA_TELUGU_CACHE_KEY, JSON.stringify(cache)); } catch (_) {}
  }
  function setGitaMeaningLabel(text) {
    const label = $("gita-bhavam-label");
    if (label) label.textContent = text;
  }
  function decodeTranslationText(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    const decoder = document.createElement("textarea");
    decoder.innerHTML = text;
    return decoder.value.trim();
  }

  async function translateGitaMeaning(verse) {
    const node = $("gita-bhavam");
    const cache = readTeluguMeaningCache();
    const key = `${verse.chapter}.${verse.verse}`;
    if (cache[key] && typeof cache[key] === "string") {
      setGitaMeaningLabel("తెలుగు భావం · యంత్ర అనువాదం");
      node.textContent = cache[key];
      return;
    }

    setGitaMeaningLabel("తెలుగు భావం · యంత్ర అనువాదం");
    node.textContent = "తెలుగు భావం లోడ్ అవుతోంది…";
    const sourceText = String(verse.english || verse.translations?.english || "").trim();
    if (!sourceText) {
      node.textContent = "ఈ శ్లోకానికి ధృవీకరించిన తెలుగు భావం ఈ మూలంలో అందుబాటులో లేదు.";
      setGitaMeaningLabel("తెలుగు భావం");
      return;
    }

    try {
      const endpoint = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(sourceText.slice(0, 480))}&langpair=en|te`;
      const response = await fetch(endpoint, {
        mode: "cors",
        cache: "default",
        signal: AbortSignal.timeout(9000)
      });
      if (!response.ok) throw new Error(`Translation service returned HTTP ${response.status}`);
      const payload = await response.json();
      const translated = decodeTranslationText(payload?.responseData?.translatedText);
      if (!translated || /MYMEMORY WARNING|PLEASE SELECT|NO QUERY/i.test(translated) ||
          translated.toLowerCase() === sourceText.toLowerCase()) {
        throw new Error("No usable Telugu translation returned");
      }
      cache[key] = translated;
      saveTeluguMeaningCache(cache);
      if (node.dataset.verseKey === key) node.textContent = translated;
    } catch (error) {
      console.warn("Telugu meaning could not be fetched for Gita verse", key, error);
      if (node.dataset.verseKey === key) {
        node.textContent = "ఈ శ్లోకానికి తెలుగు భావం ప్రస్తుతం అందుబాటులో లేదు. ఇంటర్నెట్ కనెక్షన్ ఉన్నప్పుడు మళ్లీ ప్రయత్నించండి.";
        setGitaMeaningLabel("తెలుగు భావం");
      }
    }
  }

  function renderGitaVerse(verse) {
    $("gita-loading").hidden = true;
    $("gita-fallback").hidden = true;
    $("gita-content").hidden = false;
    $("gita-sanskrit").textContent = verse.sanskrit || "";

    const suppliedTeluguScript = verse.telugu_script || verse.telugu_transliteration ||
      verse.transliteration?.telugu || verse.translations?.telugu_script || "";
    const teluguScript = suppliedTeluguScript || devanagariToTelugu(verse.sanskrit || "");
    const teluguScriptNode = $("gita-telugu-script");
    if (teluguScriptNode) {
      teluguScriptNode.textContent = teluguScript;
      teluguScriptNode.hidden = !teluguScript;
    }

    const key = `${verse.chapter}.${verse.verse}`;
    $("gita-ref").textContent = `భగవద్గీత ${key}`;
    const node = $("gita-bhavam");
    node.dataset.verseKey = key;

    const englishText = String(
      verse.english ||
      verse.translation_english ||
      verse.translations?.english ||
      verse.translations?.en ||
      ""
    ).trim();

    setGitaMeaningLabel("భావం");
    node.textContent = englishText ||
      "English meaning is currently unavailable. Please check your internet connection and refresh.";

    $("gita-source").href = verse.url ||
      `https://www.gitasupersite.iitk.ac.in/srimad?choose=1&etgb=1&field_chapter_value=${verse.chapter}&field_nsutra_value=${verse.verse}&language=dv&setgb=1`;
    $("gita-source").textContent = "మూల శ్లోకం / మూలం";
  }

  function readCachedGitaCorpus() {
    try {
      const raw = localStorage.getItem(GITA_CACHE_KEY);
      if (!raw) return null;
      return normalizeGitaCorpus(JSON.parse(raw));
    } catch (error) {
      console.warn("Cached Gita corpus is unavailable or invalid.", error);
      return null;
    }
  }

  function cacheGitaCorpus(data) {
    try { localStorage.setItem(GITA_CACHE_KEY, JSON.stringify(data)); }
    catch (error) { console.warn("Could not cache Gita corpus in this browser.", error); }
  }

  let gitaEnglishDataset = null;

  async function loadEnglishGitaDataset() {
    if (gitaEnglishDataset) return gitaEnglishDataset;

    let lastError = null;
    for (const url of GITA_ENGLISH_URLS) {
      try {
        const response = await fetch(url, {
          mode: "cors",
          cache: "no-cache",
          signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) throw new Error(`English Gita source returned HTTP ${response.status}`);
        const data = await response.json();
        if (!data || typeof data !== "object" || !data["1-1"]?.translation) {
          throw new Error("English Gita source has an unexpected format");
        }
        gitaEnglishDataset = data;
        return data;
      } catch (error) {
        lastError = error;
        console.warn("Could not load English Gita meanings from source; trying fallback.", url, error);
      }
    }
    throw lastError || new Error("English Gita meanings are unavailable");
  }

  async function loadDailyGita() {
    let verses = readCachedGitaCorpus();
    let lastError = null;

    // Once a complete corpus is cached, choose the day's verse locally.
    if (!verses) {
      for (const url of GITA_CORPUS_URLS) {
        try {
          const response = await fetch(url, {
            mode: "cors",
            cache: "no-cache",
            signal: AbortSignal.timeout(8000)
          });
          if (!response.ok) throw new Error(`Gita source returned HTTP ${response.status}`);
          const data = await response.json();
          verses = normalizeGitaCorpus(data);
          cacheGitaCorpus(data);
          break;
        } catch (error) {
          lastError = error;
          console.warn("A Gita source could not be loaded; trying the next source.", url, error);
        }
      }
    }

    if (verses && verses.length === 700) {
      try {
        const englishData = await loadEnglishGitaDataset();
        verses = verses.map(verse => {
          const key = `${verse.chapter}-${verse.verse}`;
          const entry = englishData[key];
          return {
            ...verse,
            english: String(entry?.translation || "").trim()
          };
        });
      } catch (error) {
        console.warn("English Gita meanings could not be loaded; Sanskrit verse will still display.", error);
      }

      const dayIndex = localDayNumber(localKey(new Date()));
      renderGitaVerse(verses[dayIndex % 700]);
      return;
    }

    console.error("Daily Gita could not load a complete corpus.", lastError);
    $("gita-loading").hidden = true;
    $("gita-content").hidden = true;
    $("gita-fallback").hidden = false;
    const fallback = $("gita-fallback");
    if (fallback) {
      fallback.querySelector(".gita-sanskrit")?.remove();
      fallback.querySelector(".gita-telugu-script")?.remove();
    }
    const fallbackRef = $("gita-fallback").querySelector(".gita-ref");
    if (fallbackRef) fallbackRef.textContent = "శ్లోకం అందుబాటులో లేదు";
    const fallbackMeaning = $("gita-fallback").querySelector("#gita-fallback-bhavam");
    if (fallbackMeaning) fallbackMeaning.textContent =
      "రోజువారీ శ్లోకాల డేటా లోడ్ కాలేదు. GitHub Pages లో assets/data/gita-corpus.json ఫైల్ ఉందో చూడండి; తర్వాత పేజీని రిఫ్రెష్ చేయండి.";
    $("gita-source").href = "https://gitabhawan.org.in/gita/research";
    $("gita-source").textContent = "మూల శ్లోకాల డేటా";
  }
  loadDailyGita();


})();
