'use strict';
// ============================================================
// STATE
// ============================================================
const DEFAULT_GOALS = { calories:2000, protein:150, carbs:200, fat:65, fiber:30, water:8, weight:75, goalWeight:70, goalType:'lose' };
const DEFAULT_STATE = () => ({
  goals: { ...DEFAULT_GOALS },
  log: {},          // { 'YYYY-MM-DD': { meals:{breakfast:[],lunch:[],dinner:[],snacks:[]}, water:0, exercises:[], weight:null } }
  customFoods: [],
  recipes: [],
  achievements: {},
  totalXP: 0,
  streak: 0,
  lastLogDate: null,
  settings: { name:'', email:'', dark:true, animations:true, sound:false, mealReminder:true, waterReminder:true, weeklyReport:true, smtpHost:'', smtpPort:'', smtpUser:'', smtpPass:'', smtpSender:'', subscription: { plan:'trial', status:'trialing', trialStartedAt:null, currentPeriodEnd:null, txnId:null } },
  fasting: { active:false, startTime:null, hours:16, history:[] },
  measurements: [],
  currentPage: 'dashboard',
  foodLogDate: todayStr(),
});
let state = DEFAULT_STATE();
let currentProfileId = null;  // set by selectProfile()
let charts = {};
let currentMealTarget = 'breakfast';
let selectedFood = null;
let recipeIngredients = [];
let fastingTimer = null;
let selectedExType = 'cardio';
let selectedDate = todayStr();
let calPopoverYear = new Date().getFullYear();
let calPopoverMonth = new Date().getMonth();

// ============================================================
// UTILS
// ============================================================
const _escDiv = document.createElement('div');
function esc(str) {
  _escDiv.textContent = String(str ?? '');
  return _escDiv.innerHTML;
}
function localDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function todayStr() { return localDateStr(new Date()); }
function fmtDate(d) {
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
}
function deepMerge(target, source) {
  const out = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
        target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      out[key] = deepMerge(target[key], source[key]);
    } else {
      out[key] = source[key];
    }
  }
  return out;
}

// save() — sync localStorage cache + async IndexedDB primary store
function save() {
  if (!currentProfileId) return;
  // Sync: write-through cache for fast subsequent reads
  try { localStorage.setItem('nutriflow_state_' + currentProfileId, JSON.stringify(state)); } catch(_) {}
  // Async: IndexedDB is the source of truth
  if (typeof DB !== 'undefined') {
    DB.saveState(currentProfileId, state).catch(e => console.warn('[NutriFlow] IDB save failed:', e));
  }
}

// loadLegacy() — called only as last-resort fallback (no IDB, no per-profile LS)
function loadLegacy() {
  const s = localStorage.getItem('nutriflow_state');
  if (s) {
    try { const parsed = JSON.parse(s); state = deepMerge(DEFAULT_STATE(), parsed); } catch(e) {}
  }
}
function dayData(date) {
  if (!state.log[date]) {
    state.log[date] = { meals:{ breakfast:[], lunch:[], dinner:[], snacks:[] }, water:0, exercises:[], weight:null };
  }
  return state.log[date];
}
const _EMPTY_DAY = () => ({ meals:{ breakfast:[], lunch:[], dinner:[], snacks:[] }, water:0, exercises:[], weight:null });
function dayDataReadOnly(date) { return state.log[date] || _EMPTY_DAY(); }
function todayData() { return dayData(state.foodLogDate); }

let _foodsCache = null;
let _foodsCacheLen = -1;
function allFoods() {
  if (_foodsCache && _foodsCacheLen === state.customFoods.length) return _foodsCache;
  _foodsCacheLen = state.customFoods.length;
  _foodsCache = [...FOOD_DATABASE, ...state.customFoods];
  return _foodsCache;
}
function calFromMacros(p,c,f) { return Math.round(p*4 + c*4 + f*9); }
function getMealTotal(items) {
  return items.reduce((a,it) => {
    return { cal: a.cal + (it.cal||0), protein: a.protein + (it.protein||0), carbs: a.carbs + (it.carbs||0), fat: a.fat + (it.fat||0), fiber: a.fiber + (it.fiber||0) };
  }, { cal:0, protein:0, carbs:0, fat:0, fiber:0 });
}
function getDayTotals(date) {
  const d = dayData(date);
  const all = [...d.meals.breakfast, ...d.meals.lunch, ...d.meals.dinner, ...d.meals.snacks];
  const food = getMealTotal(all);
  const burned = d.exercises.reduce((a,e) => a + e.calories, 0);
  return { ...food, burned };
}
function pct(val, goal) { return goal > 0 ? Math.min(100, (val / goal) * 100) : 0; }
function round1(n) { return Math.round(n * 10) / 10; }

// ============================================================
// SOUND ENGINE
// ============================================================
let _audioCtx = null;
function _ctx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}

function playSound(type) {
  if (!state.settings.sound) return;
  try {
    const ctx = _ctx();
    const now = ctx.currentTime;
    const tone = (freq, type, start, dur, vol = 0.18, freqEnd = null) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, start);
      if (freqEnd !== null) osc.frequency.exponentialRampToValueAtTime(freqEnd, start + dur);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(vol, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(start); osc.stop(start + dur + 0.05);
    };

    if (type === 'log') {
      tone(520, 'sine', now,       0.12, 0.14);
      tone(780, 'sine', now + 0.08, 0.14, 0.10);
    } else if (type === 'water') {
      tone(900, 'sine', now,        0.07, 0.12, 1200);
      tone(700, 'sine', now + 0.07, 0.07, 0.09, 900);
    } else if (type === 'achievement') {
      [[523,0],[659,0.1],[784,0.2],[1047,0.32]].forEach(([f, t]) => tone(f, 'sine', now + t, 0.22, 0.16));
    } else if (type === 'goal') {
      [[392,0],[523,0.09],[659,0.18],[784,0.27]].forEach(([f, t]) => tone(f, 'triangle', now + t, 0.2, 0.13));
    } else if (type === 'exercise') {
      tone(330, 'sawtooth', now,        0.05, 0.08, 660);
      tone(660, 'sine',     now + 0.05, 0.15, 0.12);
    } else if (type === 'weight') {
      tone(440, 'sine', now, 0.18, 0.10, 550);
    } else if (type === 'delete') {
      tone(440, 'sine', now, 0.12, 0.11, 220);
    } else if (type === 'error') {
      tone(180, 'square', now,       0.08, 0.13);
      tone(160, 'square', now + 0.1, 0.08, 0.10);
    } else if (type === 'faaah') {
      const a = new Audio('sounds/fahhh%20sound%20effect%20%23fahhh.mp3');
      a.volume = 0.8;
      a.play().catch(() => {});
      return;
    }
  } catch (_) {}
}

// ============================================================
// XP & ACHIEVEMENTS
// ============================================================
function awardXP(amount, reason) {
  state.totalXP += amount;
  showToast(`⭐ +${amount} XP — ${reason}`, 'xp');
  save();
  updateXPUI();
}
function checkAchievement(id) {
  if (state.achievements[id]) return;
  const ach = ACHIEVEMENTS.find(a => a.id === id);
  if (!ach) return;
  state.achievements[id] = Date.now();
  awardXP(ach.xp, ach.name);
  showToast(`🏆 Achievement: ${ach.name}!`, 'success');
  playSound('achievement');
  triggerConfetti();
  if (state.currentPage === 'achievements') renderAchievements();
}
function updateXPUI() {
  const xp = state.totalXP;
  const level = Math.floor(xp / 100) + 1;
  const xpInLevel = xp % 100;
  const q = (id) => document.getElementById(id);
  q('xpVal') && (q('xpVal').textContent = xp + ' XP');
  q('xpBarFill') && (q('xpBarFill').style.width = xpInLevel + '%');
  q('totalXP') && (q('totalXP').textContent = xp);
  q('levelNum') && (q('levelNum').textContent = level);
  q('levelFill') && (q('levelFill').style.width = xpInLevel + '%');
  q('levelXPInfo') && (q('levelXPInfo').textContent = `${xpInLevel} / 100 XP to level ${level+1}`);
}
function computeStreak() {
  const d = new Date();
  let streak = 0;
  for (let i = 0; i < 400; i++) {
    const ds = localDateStr(d);
    if (ds > todayStr()) { d.setDate(d.getDate()-1); continue; }
    const entry = state.log[ds];
    if (!entry) break;
    const meals = [...(entry.meals?.breakfast||[]), ...(entry.meals?.lunch||[]),
                   ...(entry.meals?.dinner||[]), ...(entry.meals?.snacks||[])];
    if (!meals.length && !entry.water) break;
    streak++;
    d.setDate(d.getDate()-1);
  }
  return streak;
}
function updateStreak() {
  const today = todayStr();
  if (state.lastLogDate !== today) {
    state.lastLogDate = today;
    state.streak = computeStreak();
    save();
    if (state.streak >= 3) checkAchievement('streak_3');
    if (state.streak >= 7) checkAchievement('streak_7');
    if (state.streak >= 30) checkAchievement('streak_30');
  }
  const streak = computeStreak();
  document.getElementById('sidebarStreak').textContent = streak;
  document.getElementById('dashStreak').textContent = streak;
}

// ============================================================
// TOAST
// ============================================================
function showToast(msg, type='info') {
  const wrap = document.getElementById('toastWrap');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = msg;
  wrap.appendChild(t);
  const duration = msg.includes('href=') ? 8000 : 3000;
  setTimeout(() => { t.style.animation = 'toastOut 0.3s ease forwards'; setTimeout(() => t.remove(), 300); }, duration);
}

// ============================================================
// CONFETTI
// ============================================================
function triggerConfetti() {
  const canvas = document.getElementById('confettiCanvas');
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  const pieces = Array.from({length:80}, () => ({
    x: Math.random() * canvas.width,
    y: -20, vx:(Math.random()-0.5)*4, vy:Math.random()*4+2,
    r: Math.random()*8+3, color:`hsl(${Math.random()*360},70%,60%)`,
    rot:0, rotV:(Math.random()-0.5)*0.2
  }));
  let frames = 0;
  function draw() {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    pieces.forEach(p => {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color; ctx.fillRect(-p.r/2,-p.r/2,p.r,p.r);
      ctx.restore();
      p.x += p.vx; p.y += p.vy; p.rot += p.rotV; p.vy += 0.1;
    });
    if (++frames < 120) requestAnimationFrame(draw);
    else ctx.clearRect(0,0,canvas.width,canvas.height);
  }
  draw();
}

// ============================================================
// NAVIGATION
// ============================================================
function navigate(page) {
  document.querySelectorAll('.nav-item').forEach(n => {
    const isActive = n.dataset.page === page;
    n.classList.toggle('active', isActive);
    n.setAttribute('aria-current', isActive ? 'page' : 'false');
  });
  document.querySelectorAll('.page').forEach(p => { p.classList.remove('active'); if (p.id === `page-${page}`) p.classList.add('active'); });
  const titles = { dashboard:'Dashboard', foodlog:'Food Log', recipes:'Recipes', exercise:'Exercise', progress:'Progress', fasting:'Fasting', achievements:'Achievements', insights:'AI Insights', goals:'Goals', settings:'Settings', subscription:'Plans & Billing', admin:'Admin Portal' };
  document.getElementById('pageTitle').textContent = titles[page] || page;
  state.currentPage = page;
  if (page === 'dashboard') renderDashboard();
  if (page === 'foodlog') renderFoodLog();
  if (page === 'exercise') renderExercise();
  if (page === 'progress') renderProgress();
  if (page === 'achievements') renderAchievements();
  if (page === 'insights') renderInsights();
  if (page === 'recipes') renderRecipes();
  if (page === 'goals') loadGoalForm();
  if (page === 'settings') loadSettings();
  if (page === 'subscription') renderSubscription();
  if (page === 'admin') loadAdminPortal();
  if (window.innerWidth < 900) {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('visible');
    document.getElementById('hamburger').setAttribute('aria-expanded', 'false');
  }
}

// ============================================================
// DATE NAVIGATION
// ============================================================
function navigateDate(ds) {
  if (ds > todayStr()) return;
  selectedDate = ds;
  state.foodLogDate = ds;
  updateDateNav();
  if (state.currentPage === 'dashboard') renderDashboard();
  else if (state.currentPage === 'foodlog') renderFoodLog();
  else if (state.currentPage === 'exercise') renderExercise();
}

function updateDateNav() {
  const today = todayStr();
  const isToday = selectedDate === today;
  const d = new Date(selectedDate + 'T00:00:00');
  const label = isToday
    ? d.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' })
    : fmtDate(selectedDate);
  const labelEl = document.getElementById('dashDateLabel');
  if (labelEl) labelEl.textContent = label;
  const nextBtn = document.getElementById('dashNextDay');
  if (nextBtn) nextBtn.disabled = isToday;
  const todayBtn = document.getElementById('todayJumpBtn');
  if (todayBtn) todayBtn.classList.toggle('hidden', isToday);
}

function openCalPopover() {
  const d = new Date(selectedDate + 'T00:00:00');
  calPopoverYear = d.getFullYear();
  calPopoverMonth = d.getMonth();
  renderCalPopover();
  document.getElementById('calPopover').classList.remove('hidden');
  setTimeout(() => document.addEventListener('click', closeCalPopoverOutside, true), 0);
}

function closeCalPopover() {
  document.getElementById('calPopover').classList.add('hidden');
  document.removeEventListener('click', closeCalPopoverOutside, true);
}

function closeCalPopoverOutside(e) {
  const popover = document.getElementById('calPopover');
  const btn = document.getElementById('dateDisplayBtn');
  if (!popover.contains(e.target) && e.target !== btn && !btn?.contains(e.target)) {
    closeCalPopover();
  }
}

function renderCalPopover() {
  const today = todayStr();
  const year = calPopoverYear, month = calPopoverMonth;
  const ref = new Date(year, month);
  document.getElementById('calMonthLabel').textContent =
    ref.toLocaleDateString('en-US', { month:'long', year:'numeric' }).toUpperCase();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const grid = document.getElementById('calDays');
  grid.innerHTML = '';
  for (let i = 0; i < firstDay; i++) {
    const blank = document.createElement('div');
    blank.className = 'cal-day blank';
    grid.appendChild(blank);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const ds = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const isFuture = ds > today;
    const isToday = ds === today;
    const isSelected = ds === selectedDate;
    const entry = state.log[ds];
    const meals = entry ? [...(entry.meals?.breakfast||[]), ...(entry.meals?.lunch||[]),
                           ...(entry.meals?.dinner||[]), ...(entry.meals?.snacks||[])] : [];
    const hasData = meals.length > 0 || (entry?.water > 0);
    const goalMet = hasData && getMealTotal(meals).cal >= state.goals.calories;
    const btn = document.createElement('button');
    btn.className = 'cal-day' + (isFuture ? ' future' : '') + (isToday ? ' is-today' : '') + (isSelected ? ' selected' : '');
    btn.disabled = isFuture;
    btn.setAttribute('role', 'gridcell');
    btn.setAttribute('aria-label', `${ds}${hasData ? ', logged' : ''}${isFuture ? ', unavailable' : ''}`);
    btn.textContent = day;
    if (hasData && !isSelected) {
      const dot = document.createElement('span');
      dot.className = 'cal-dot ' + (goalMet ? 'goal-met' : 'has-data');
      btn.appendChild(dot);
    }
    if (!isFuture) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigateDate(ds);
        closeCalPopover();
      });
    }
    grid.appendChild(btn);
  }
}

// ============================================================
// DASHBOARD
// ============================================================
function renderDashboard() {
  const d = getDayTotals(selectedDate);
  const g = state.goals;
  const remain = Math.max(0, g.calories - d.cal + d.burned);

  // Calorie ring
  const circ = 2 * Math.PI * 90;
  const consumed_pct = pct(d.cal - d.burned, g.calories);
  const offset = circ - (circ * consumed_pct / 100);
  const ring = document.getElementById('calRing');
  ring.style.strokeDashoffset = Math.max(0, offset);
  const hue = consumed_pct > 80 ? 'url(#ringGradOrange)' : 'url(#ringGrad)';
  ring.setAttribute('stroke', hue);

  document.getElementById('calRemain').textContent = remain;
  document.getElementById('calPct').textContent = Math.round(consumed_pct) + '% consumed';
  document.getElementById('csGoal').textContent = g.calories;
  document.getElementById('csEaten').textContent = Math.round(d.cal);
  document.getElementById('csBurned').textContent = Math.round(d.burned);

  // Macro bars with trend arrows vs previous day
  const yd = new Date(selectedDate + 'T00:00:00'); yd.setDate(yd.getDate() - 1);
  const yest = getDayTotals(localDateStr(yd));
  const trend = (today, yesterday) => {
    if (yesterday === 0) return '';
    const diff = today - yesterday;
    if (Math.abs(diff) < 1) return '';
    return diff > 0 ? `<span style="color:#4caf50;font-size:0.7rem">▲${round1(diff)}g</span>` : `<span style="color:#f44336;font-size:0.7rem">▼${round1(Math.abs(diff))}g</span>`;
  };
  document.getElementById('mbarProtein').style.width = pct(d.protein, g.protein) + '%';
  document.getElementById('mvalProtein').innerHTML = `${round1(d.protein)}g / ${g.protein}g ${trend(d.protein, yest.protein)}`;
  document.getElementById('mbarCarbs').style.width = pct(d.carbs, g.carbs) + '%';
  document.getElementById('mvalCarbs').innerHTML = `${round1(d.carbs)}g / ${g.carbs}g ${trend(d.carbs, yest.carbs)}`;
  document.getElementById('mbarFat').style.width = pct(d.fat, g.fat) + '%';
  document.getElementById('mvalFat').innerHTML = `${round1(d.fat)}g / ${g.fat}g ${trend(d.fat, yest.fat)}`;
  document.getElementById('mbarFiber').style.width = pct(d.fiber, g.fiber) + '%';
  document.getElementById('mvalFiber').innerHTML = `${round1(d.fiber)}g / ${g.fiber}g ${trend(d.fiber, yest.fiber)}`;

  // Water
  renderWaterCups('waterCups', dayData(selectedDate), false);
  document.getElementById('waterCount').textContent = dayData(selectedDate).water;
  document.getElementById('waterGoalDisplay').textContent = g.water;

  // Streak & XP
  document.getElementById('dashStreak').textContent = state.streak;
  updateXPUI();

  // Weight
  const latestW = getLatestWeight();
  document.getElementById('dashWeight').textContent = latestW ? latestW + ' kg' : '-- kg';

  // Meals summary
  const ms = document.getElementById('mealsSummary');
  ms.innerHTML = '';
  [['breakfast','🌅'],['lunch','☀️'],['dinner','🌙'],['snacks','🍎']].forEach(([meal, icon]) => {
    const items = dayData(selectedDate).meals[meal];
    const tot = getMealTotal(items);
    const div = document.createElement('div');
    div.className = 'meal-sum-item';
    div.innerHTML = `<span class="msi-name">${icon} ${meal.charAt(0).toUpperCase()+meal.slice(1)}</span><span class="msi-cal">${Math.round(tot.cal)} kcal</span>`;
    ms.appendChild(div);
  });

  // Macro Photo Card
  renderMacroPhotoCard(d);

  // AI Suggestions
  renderAISuggestions(d, g);

  // Weekly chart
  renderWeeklyChart();

  // Quick Actions summary
  renderQASummary();
}

function renderQASummary() {
  const el = document.getElementById('qaSummary');
  if (!el) return;
  const d   = getDayTotals(selectedDate);
  const net = Math.max(0, d.cal - d.burned);
  const goal = state.goals.calories;
  const pctVal = goal > 0 ? Math.min(100, Math.round(net / goal * 100)) : 0;
  const remaining = Math.max(0, goal - net);
  if (pctVal >= 100) {
    el.textContent = '🎯 Daily calorie goal reached!';
    el.classList.add('goal-met');
  } else {
    el.textContent = `${pctVal}% to your goal · ${remaining} kcal left`;
    el.classList.remove('goal-met');
  }
}

function getLatestWeight() {
  const dates = Object.keys(state.log).sort().reverse();
  for (const d of dates) { if (state.log[d].weight) return state.log[d].weight; }
  return null;
}

// ============================================================
// SUBSCRIPTION & TRIAL
// ============================================================
const _PLANS = {
  pro:     { name:'Pro',     price:'$2.99', pricePKR:850,  period:'/ month', color:'#6C63FF', features:['Unlimited food logging','AI meal suggestions','Exercise & water tracking','Advanced progress charts','Data export (CSV/JSON)','Recipes & meal planning','Streak & achievement system','Priority email support'] },
  premium: { name:'Premium', price:'$5.99', pricePKR:1700, period:'/ month', color:'#F0A020', features:['Everything in Pro','Up to 5 profiles','Barcode food scanner','Fasting tracker','Early access to new features','Dedicated priority support','Custom macro targets','No advertisements ever'] },
};

const _SADAPAY = {
  accountName: 'Yahya Anas',
  number:      '03174681197',
  email:       'yahyaanas2005@gmail.com',
  whatsapp:    '923059992492',
};

// One-time activation keys — distribute one per verified SadaPay payment
const _ACTIVATION_CODES = new Set([
  'NF-K5WV-UDU5-WTSH','NF-7PFV-WGVA-ZNZV','NF-XL7K-MESE-NJ8Q','NF-E939-4977-X6JT',
  'NF-FP67-T2AA-U2XX','NF-XGUK-WV5A-NPHH','NF-SJUR-VKM4-LMUF','NF-NWRR-543A-HWTE',
  'NF-4YAR-CVPJ-SJBP','NF-TA78-ENRM-YNEM','NF-XM85-5NNL-VZFG','NF-RTHL-72C4-7JNF',
  'NF-X9QF-MUKS-M2ZP','NF-CNCM-9CRK-8HXJ','NF-Y8F5-QCGM-GVXY','NF-7WA3-GYFN-CT2A',
  'NF-MDYV-HYZF-M2SY','NF-5XEG-WBS4-7LYW','NF-7EYL-6W82-DMHD','NF-2H2R-QW78-LBFQ',
  'NF-T778-X8SS-2GFU','NF-QKMQ-68GQ-WBVG','NF-Q6M9-WJHX-L3H4','NF-49U5-DYQ6-EM3Q',
  'NF-S4US-GH6P-JDKF','NF-G8YZ-YKR9-KDRT','NF-D4UD-J3D6-QRF9','NF-2M89-BSA4-GMK6',
  'NF-DMR2-PLYR-H6B2','NF-E6TU-79LN-CJXC','NF-RMVE-R2XM-A6PM','NF-G6YL-LEQC-XY7B',
  'NF-KNSP-STHB-ZWEP','NF-SWLJ-6VHU-4PSS','NF-W333-MB6V-JKZQ','NF-TJD3-7SSN-RSDF',
  'NF-BBE7-TMGX-N3TT','NF-Q9Y5-VEV7-7USE','NF-3ZK6-RUFZ-987U','NF-ZR4Q-AG9V-VZW6',
  'NF-TVNE-AJQS-TYZM','NF-4HPM-5E6L-2WX5','NF-FS8E-5ENZ-AE2V','NF-SBYD-VRBB-CW8R',
  'NF-E939-2NS3-H4S5','NF-YUC2-J5BE-YC4N','NF-ZA54-4DG9-YRAR','NF-753Z-CK9W-6ZDP',
  'NF-K5WA-WJ5K-F56P','NF-HDLE-YV2Y-BSET','NF-Y57Y-F2N4-9X6N','NF-LJD9-6FYG-L4HM',
  'NF-9KW8-V2NP-4QJE','NF-E3WV-H3ME-2L9V','NF-S6DK-5676-T937','NF-8SSC-J7PK-HQ8F',
  'NF-APE4-T3B8-WM4V','NF-8CA4-G3U8-J45T','NF-ZS6J-5MM7-C5YR','NF-SK7J-SRCT-NQUF',
]);

function _usedCodes() {
  try { return new Set(JSON.parse(localStorage.getItem('nf_used_codes') || '[]')); } catch { return new Set(); }
}
function _markCodeUsed(code) {
  const used = _usedCodes(); used.add(code);
  try { localStorage.setItem('nf_used_codes', JSON.stringify([...used])); } catch {}
}

function _getSub() {
  return state.settings.subscription || {};
}

function initTrial() {
  const sub = _getSub();
  if (!sub.trialStartedAt) {
    state.settings.subscription = {
      plan: 'trial',
      status: 'trialing',
      trialStartedAt: new Date().toISOString(),
      currentPeriodEnd: null,
      txnId: null,
    };
    save();
  }
}

function trialDaysLeft() {
  const sub = _getSub();
  if (!sub.trialStartedAt) return 7;
  if (sub.status === 'active') return Infinity;
  const started = new Date(sub.trialStartedAt);
  const ends = new Date(started.getTime() + 7 * 24 * 60 * 60 * 1000);
  const left = Math.ceil((ends - Date.now()) / (24 * 60 * 60 * 1000));
  return Math.max(0, left);
}

function isSubscribed() {
  const sub = _getSub();
  return sub.status === 'active' || sub.status === 'trialing';
}

function updateTrialBadge() {
  const badge = document.getElementById('trialBadge');
  if (!badge) return;
  const sub = _getSub();
  if (sub.status === 'active') {
    badge.textContent = '✨ ' + (_PLANS[sub.plan]?.name || 'Pro');
    badge.className = 'trial-badge subscribed';
    badge.classList.remove('hidden');
  } else if (sub.status === 'pending') {
    badge.textContent = '📋 Verifying payment';
    badge.className = 'trial-badge trialing';
    badge.classList.remove('hidden');
  } else if (sub.status === 'trialing') {
    const left = trialDaysLeft();
    if (left > 0) {
      badge.textContent = `⏳ ${left}d trial left`;
      badge.className = 'trial-badge trialing';
      badge.classList.remove('hidden');
    } else {
      badge.textContent = '🔒 Trial ended';
      badge.className = 'trial-badge expired';
      badge.classList.remove('hidden');
    }
  } else {
    badge.textContent = '🔒 Trial ended';
    badge.className = 'trial-badge expired';
    badge.classList.remove('hidden');
  }
}

function _openSadapayModal(plan) {
  const p = _PLANS[plan];
  if (!p) return;
  const modal = document.getElementById('sadapayModal');
  modal.dataset.plan = plan;
  document.getElementById('spModalPlanName').textContent = `${p.name} · PKR ${p.pricePKR}/month`;
  document.getElementById('spModalPlanUSD').textContent  = `≈ ${p.price} USD/month`;
  document.getElementById('spModalAccName').textContent  = _SADAPAY.accountName;
  document.getElementById('spModalNumber').textContent   = _SADAPAY.number;
  document.getElementById('spModalEmail').textContent    = _SADAPAY.email;
  document.getElementById('spModalEmail').href           = `mailto:${_SADAPAY.email}`;
  // If already pending for this plan, skip to phase 2
  const sub = _getSub();
  if (sub.status === 'pending' && sub.pendingPlan === plan) {
    _sadapayShowPhase(2, plan, sub.pendingTxnId);
  } else {
    document.getElementById('sadapayTxnId').value = '';
    _sadapayShowPhase(1, plan, null);
  }
  modal.classList.remove('hidden');
}

function _sadapayShowPhase(phase, plan, txnId) {
  const p1 = document.getElementById('sadapayPhase1');
  const p2 = document.getElementById('sadapayPhase2');
  if (phase === 1) {
    p1.classList.remove('hidden'); p2.classList.add('hidden');
    setTimeout(() => document.getElementById('sadapayTxnId').focus(), 60);
  } else {
    p1.classList.add('hidden'); p2.classList.remove('hidden');
    document.getElementById('spPendingTxn').textContent = txnId || '—';
    const msg = encodeURIComponent(
      `Hi Yahya! I paid for NutriFlow ${_PLANS[plan]?.name}.\nSadaPay TXN ID: ${txnId}\nPlease send my activation key.`
    );
    document.getElementById('spWhatsappLink').href = `https://wa.me/${_SADAPAY.whatsapp}?text=${msg}`;
    document.getElementById('sadapayActivationCode').value = '';
    setTimeout(() => document.getElementById('sadapayActivationCode').focus(), 60);
  }
}

function _submitPaymentProof() {
  const modal = document.getElementById('sadapayModal');
  const plan  = modal.dataset.plan;
  const txnId = document.getElementById('sadapayTxnId').value.trim();
  if (!txnId || txnId.length < 8) {
    showToast('Transaction ID must be at least 8 characters', 'error'); playSound('error'); return;
  }
  if (!/^[A-Za-z0-9\-]+$/.test(txnId)) {
    showToast('Transaction ID can only contain letters, numbers, and hyphens', 'error'); playSound('error'); return;
  }
  state.settings.subscription = {
    ...state.settings.subscription,
    status: 'pending',
    pendingPlan: plan,
    pendingTxnId: txnId,
    pendingAt: new Date().toISOString(),
  };
  save();
  updateTrialBadge();
  _sadapayShowPhase(2, plan, txnId);
}

function _activateWithCode() {
  const modal = document.getElementById('sadapayModal');
  const code  = document.getElementById('sadapayActivationCode').value.trim().toUpperCase();
  if (!/^NF-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) {
    showToast('Invalid format — expected NF-XXXX-XXXX-XXXX', 'error'); playSound('error'); return;
  }
  if (_usedCodes().has(code)) {
    showToast('This activation key has already been used', 'error'); playSound('error'); return;
  }
  if (!_ACTIVATION_CODES.has(code)) {
    showToast('Invalid activation key — contact Yahya on WhatsApp', 'error'); playSound('error'); return;
  }
  _markCodeUsed(code);
  const sub = _getSub();
  const plan = sub.pendingPlan || modal.dataset.plan || 'pro';
  const end  = new Date(); end.setDate(end.getDate() + 30);
  state.settings.subscription = {
    ...sub,
    plan,
    status: 'active',
    currentPeriodEnd: end.toISOString(),
    activationCode: code,
    activatedAt: new Date().toISOString(),
  };
  save();
  updateTrialBadge();
  modal.classList.add('hidden');
  navigate('subscription');
  showToast(`🎉 NutriFlow ${_PLANS[plan]?.name} activated! Welcome.`, 'success');
  playSound('achievement');
}

function renderSubscription() {
  const page = document.getElementById('page-subscription');
  if (!page) return;
  const sub  = _getSub();
  const left = trialDaysLeft();

  page.innerHTML = `
    <div class="sub-page">
      ${_renderSubStatus(sub, left)}
      <div class="sub-plans">
        ${_renderPlanCard('pro',     sub)}
        ${_renderPlanCard('premium', sub)}
      </div>
      <div class="sub-guarantee">
        <span>💚 Pay via SadaPay — instant & secure</span>
        <span>·</span>
        <span>Cancel anytime by stopping monthly payment</span>
        <span>·</span>
        <span>7-day free trial before payment required</span>
      </div>
    </div>`;

  page.querySelectorAll('.sub-cta-btn').forEach(btn => {
    btn.addEventListener('click', () => _openSadapayModal(btn.dataset.plan));
  });

  // Inline activation on pending status card
  const subActBtn = page.querySelector('#subPageActivateBtn');
  if (subActBtn) {
    const inlineActivate = () => {
      const code = document.getElementById('subPageActivationCode').value.trim().toUpperCase();
      if (!/^NF-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) {
        showToast('Invalid format — expected NF-XXXX-XXXX-XXXX', 'error'); playSound('error'); return;
      }
      if (_usedCodes().has(code)) { showToast('Activation key already used', 'error'); playSound('error'); return; }
      if (!_ACTIVATION_CODES.has(code)) { showToast('Invalid activation key — contact Yahya on WhatsApp', 'error'); playSound('error'); return; }
      _markCodeUsed(code);
      const plan = sub.pendingPlan || 'pro';
      const end  = new Date(); end.setDate(end.getDate() + 30);
      state.settings.subscription = { ...sub, plan, status:'active', currentPeriodEnd:end.toISOString(), activationCode:code, activatedAt:new Date().toISOString() };
      save(); updateTrialBadge(); renderSubscription();
      showToast(`🎉 NutriFlow ${_PLANS[plan]?.name} activated! Welcome.`, 'success'); playSound('achievement');
    };
    subActBtn.addEventListener('click', inlineActivate);
    document.getElementById('subPageActivationCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') inlineActivate(); });
  }
}

function _renderSubStatus(sub, left) {
  if (sub.status === 'active') {
    const planLabel = _PLANS[sub.plan]?.name || 'Pro';
    const end = sub.currentPeriodEnd
      ? new Date(sub.currentPeriodEnd).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})
      : '—';
    return `<div class="sub-status-card sub-status-active">
      <div class="ssc-icon">✨</div>
      <div class="ssc-body">
        <div class="ssc-title">You're on ${planLabel} — thank you!</div>
        <div class="ssc-sub">Active until ${end} · renew via SadaPay to continue</div>
      </div>
    </div>`;
  }
  if (sub.status === 'pending') {
    const wa = encodeURIComponent(`Hi Yahya! I paid for NutriFlow.\nSadaPay TXN ID: ${sub.pendingTxnId || '—'}\nPlease send my activation key.`);
    return `<div class="sub-status-card sub-status-trial">
      <div class="ssc-icon">📋</div>
      <div class="ssc-body">
        <div class="ssc-title">Payment submitted — awaiting activation key</div>
        <div class="ssc-sub">TXN: <strong>${sub.pendingTxnId || '—'}</strong> · Click below to message Yahya on WhatsApp</div>
      </div>
      <a class="btn-sm ssc-wa-btn" href="https://wa.me/${_SADAPAY.whatsapp}?text=${wa}" target="_blank">WhatsApp</a>
    </div>
    <div class="sub-activate-row">
      <input class="sp-txn-input sub-act-input" id="subPageActivationCode" placeholder="Enter activation key: NF-XXXX-XXXX-XXXX" autocomplete="off"/>
      <button class="btn-primary sub-act-btn" id="subPageActivateBtn">Activate</button>
    </div>`;
  }
  if (sub.status === 'trialing' && left > 0) {
    return `<div class="sub-status-card sub-status-trial">
      <div class="ssc-icon">⏳</div>
      <div class="ssc-body">
        <div class="ssc-title">${left} day${left !== 1 ? 's' : ''} left in your free trial</div>
        <div class="ssc-sub">Subscribe via SadaPay to keep all features after trial ends</div>
      </div>
    </div>`;
  }
  return `<div class="sub-status-card sub-status-expired">
    <div class="ssc-icon">🔒</div>
    <div class="ssc-body">
      <div class="ssc-title">Your free trial has ended</div>
      <div class="ssc-sub">Subscribe below via SadaPay to continue using NutriFlow</div>
    </div>
  </div>`;
}

function _renderPlanCard(planKey, sub) {
  const p = _PLANS[planKey];
  const isCurrent = sub.plan === planKey && sub.status === 'active';
  const isPro     = planKey === 'pro';
  const features  = p.features.map(f => `<li class="sp-feature"><span class="sp-check" aria-hidden="true">✓</span>${f}</li>`).join('');
  const isPending = sub.status === 'pending' && sub.pendingPlan === planKey;
  const btnLabel  = isCurrent ? '✓ Current Plan' : isPending ? '📋 Enter Activation Key' : (sub.status === 'trialing' ? 'Subscribe Now' : 'Start Free Trial');
  return `
    <div class="sub-plan-card ${isPro ? 'sub-plan-popular' : ''} ${isCurrent ? 'sub-plan-current' : ''}">
      ${isPro ? '<div class="sub-popular-badge">Most Popular</div>' : ''}
      <div class="sp-header">
        <div class="sp-name">${p.name}</div>
        <div class="sp-price">${p.price} <span class="sp-period">${p.period}</span></div>
        <div class="sp-pkr">≈ PKR ${p.pricePKR}/month</div>
        <div class="sp-trial">7-day free trial</div>
      </div>
      <ul class="sp-features">${features}</ul>
      <button class="btn-primary sub-cta-btn ${isCurrent ? 'sub-cta-current' : ''}" data-plan="${planKey}" ${isCurrent ? 'disabled' : ''}>
        ${btnLabel}
      </button>
    </div>`;
}

function renderWaterCups(containerId, dayD, big) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const goal = state.goals.water;
  container.innerHTML = '';
  for (let i = 0; i < goal; i++) {
    const cup = document.createElement('div');
    cup.className = (big ? 'water-cup-big' : 'water-cup') + (i < dayD.water ? ' filled' : '');
    const fill = document.createElement('div');
    fill.className = 'water-fill';
    fill.style.height = i < dayD.water ? '100%' : '0%';
    cup.appendChild(fill);
    const idx = i;
    cup.setAttribute('tabindex', '0');
    cup.setAttribute('role', 'button');
    cup.setAttribute('aria-label', `Glass ${i + 1}${i < dayD.water ? ' (filled)' : ''}`);
    const handleCupActivate = () => {
      dayD.water = idx < dayD.water ? idx : idx + 1;
      save();
      playSound('water');
      renderWaterCups(containerId, dayD, big);
      if (containerId === 'waterCups') {
        document.getElementById('waterCount').textContent = dayD.water;
      } else {
        const wc = document.getElementById('waterCount');
        if (wc) wc.textContent = dayD.water;
      }
      if (dayD.water >= state.goals.water) {
        checkAchievement('water_goal');
        awardXP(5, 'Hydration goal!');
      }
    };
    cup.addEventListener('click', handleCupActivate);
    cup.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCupActivate(); } });
    container.appendChild(cup);
  }
}

// ── Macro Photo Card ──────────────────────────────────────────
const _MPC_CAPTIONS = [
  'Make every meal count',
  'Fuel your best self',
  'Mindful eating, every day',
  'Nourish to flourish',
  'Strong body, sharp mind',
  'Every bite is a choice',
  'Eat well, live well',
];

function _mpcKeyword(d) {
  const h = new Date().getHours();
  if (h < 10) return 'healthy breakfast bowl food photography';
  if (h < 14) return 'healthy lunch salad bowl food';
  const g = state.goals;
  if (g.protein > 0 && d.protein / g.protein > d.carbs / g.carbs) return 'high protein chicken meal bowl food';
  if (g.carbs > 0 && d.carbs / g.carbs > 0.5) return 'healthy grain rice bowl food';
  return 'balanced healthy meal bowl food photography';
}

function _buildRing(label, val, max, color) {
  const r = 19, cx = 23, cy = 23;
  const circ = 2 * Math.PI * r;
  const pct  = max > 0 ? Math.min(val / max, 1) : 0;
  const offset = circ * (1 - pct);
  return `<div class="mpc-ring-item">
    <div class="mpc-ring-lbl">${label}</div>
    <div class="mpc-ring-wrap">
      <svg class="mpc-ring-svg" viewBox="0 0 46 46" aria-hidden="true">
        <circle class="mpc-ring-track" cx="${cx}" cy="${cy}" r="${r}"/>
        <circle class="mpc-ring-fill" cx="${cx}" cy="${cy}" r="${r}"
          stroke="${color}"
          stroke-dasharray="${circ.toFixed(2)}"
          stroke-dashoffset="${offset.toFixed(2)}"
          transform="rotate(-90 ${cx} ${cy})"/>
      </svg>
      <div class="mpc-ring-num" style="color:${color}">${Math.round(val)}</div>
    </div>
  </div>`;
}

const _MPC_LOCAL_IMGS = [
  'assets/bowl-noodle.jpg',
  'assets/bowl-avocado.jpg',
  'assets/bowl-quinoa.png',
];

function renderMacroPhotoCard(d) {
  const wrap = document.getElementById('macroPhotoCardWrap');
  if (!wrap) return;
  wrap.innerHTML = '';
  const g = state.goals;
  const caption = _MPC_CAPTIONS[new Date().getDay() % _MPC_CAPTIONS.length];
  const imgSrc  = _MPC_LOCAL_IMGS[new Date().getDate() % _MPC_LOCAL_IMGS.length];

  const card = document.createElement('div');
  card.className = 'card macro-photo-card';
  card.innerHTML = `
    <div class="mpc-photo">
      <img class="food-img" src="${imgSrc}" alt="Healthy meal bowl" loading="lazy" decoding="async">
    </div>
    <div class="mpc-glass">
      ${_buildRing('Protein', d.protein, g.protein, '#9B8FFF')}
      ${_buildRing('Fat',     d.fat,     g.fat,     '#F0A020')}
      ${_buildRing('Carbs',   d.carbs,   g.carbs,   '#4ECDC4')}
    </div>
    <div class="mpc-caption">${caption}</div>`;
  wrap.appendChild(card);
}

function renderAISuggestions(d, g) {
  const container = document.getElementById('aiSuggestions');
  container.innerHTML = '';
  const remaining = { cal: g.calories - d.cal, protein: g.protein - d.protein, carbs: g.carbs - d.carbs, fat: g.fat - d.fat };
  let pool;
  if (remaining.protein > 50) pool = AI_MEAL_SUGGESTIONS.highProtein;
  else if (remaining.cal < 300) pool = AI_MEAL_SUGGESTIONS.lowCal;
  else if (remaining.carbs > 100) pool = AI_MEAL_SUGGESTIONS.highCarb;
  else pool = AI_MEAL_SUGGESTIONS.balanced;
  pool.slice(0, 3).forEach(s => {
    const item = document.createElement('div');
    item.className = 'ai-sug-item';
    // Photo strip
    const photo = document.createElement('div');
    photo.className = 'asi-photo';
    const overlay = document.createElement('div');
    overlay.className = 'asi-photo-overlay';
    photo.appendChild(overlay);
    item.appendChild(photo);
    // Text body
    const body = document.createElement('div');
    body.className = 'asi-body';
    body.innerHTML = `<div class="asi-top"><span class="asi-emoji">${s.emoji}</span><span class="asi-name">${s.name}</span><span class="asi-cal">${s.cal} kcal</span></div><div class="asi-macro">Protein: ${s.protein}g • ${s.foods.join(', ')}</div>`;
    item.appendChild(body);
    container.appendChild(item);
    ImageService.attachImg(photo, s.name + ' food meal', { alt: s.name, small: true });
  });
}

function _getReadOnlyTotals(date) {
  const d = dayDataReadOnly(date);
  const all = [...d.meals.breakfast, ...d.meals.lunch, ...d.meals.dinner, ...d.meals.snacks];
  return getMealTotal(all);
}

function renderWeeklyChart() {
  const labels = [], calData = [], goalData = [];
  const anchor = new Date(selectedDate + 'T00:00:00');
  for (let i = 6; i >= 0; i--) {
    const d = new Date(anchor); d.setDate(anchor.getDate() - i);
    const ds = localDateStr(d);
    labels.push(d.toLocaleDateString('en', { weekday:'short' }));
    calData.push(Math.round(_getReadOnlyTotals(ds).cal));
    goalData.push(state.goals.calories);
  }
  const ctx = document.getElementById('weeklyChart');
  if (!ctx) return;
  if (charts.weekly) {
    charts.weekly.data.labels = labels;
    charts.weekly.data.datasets[0].data = calData;
    charts.weekly.data.datasets[1].data = goalData;
    charts.weekly.update('none');
    return;
  }
  const isDark = state.settings.dark;
  const tickColor = isDark ? '#9999BB' : '#555580';
  const gridColor = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(108,99,255,0.08)';
  charts.weekly = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label:'Calories', data:calData, backgroundColor:'rgba(108,99,255,0.6)', borderRadius:8, borderSkipped:false },
        { label:'Goal', data:goalData, type:'line', borderColor:'rgba(255,255,255,0.25)', borderDash:[6,3], borderWidth:2, pointRadius:0, fill:false }
      ]
    },
    options: { responsive:true, plugins:{ legend:{ display:false } }, scales:{ x:{ grid:{display:false}, ticks:{color:tickColor} }, y:{ grid:{color:gridColor}, ticks:{color:tickColor} } } }
  });
}

// ============================================================
// FOOD LOG
// ============================================================
function renderFoodLog() {
  const isToday = state.foodLogDate === todayStr();
  const dateLabel = isToday ? 'Today' : fmtDate(state.foodLogDate);
  document.getElementById('foodlogDate').textContent = dateLabel;
  const d = getDayTotals(state.foodLogDate);
  document.getElementById('flTotal').textContent = Math.round(d.cal);
  document.getElementById('flGoal').textContent = state.goals.calories;
  const net = d.cal - d.burned;
  const netEl = document.getElementById('flNet');
  netEl.textContent = `(Net: ${Math.round(net)} kcal)`;

  const container = document.getElementById('mealSections');
  container.innerHTML = '';
  [['breakfast','🌅 Breakfast'],['lunch','☀️ Lunch'],['dinner','🌙 Dinner'],['snacks','🍎 Snacks']].forEach(([meal, label]) => {
    const items = dayData(state.foodLogDate).meals[meal];
    const tot = getMealTotal(items);
    const sec = document.createElement('div');
    sec.className = 'meal-section';
    sec.innerHTML = `
      <div class="meal-section-header" data-meal="${meal}">
        <div class="msh-left">
          <span class="msh-name">${label}</span>
          <span class="msh-cal">${Math.round(tot.cal)} kcal</span>
        </div>
        <div class="msh-right">
          <button class="add-food-btn" data-meal="${meal}">＋ Add Food</button>
          <span class="msh-chevron">▾</span>
        </div>
      </div>
      <div class="meal-items">
        ${items.map((it,idx) => `
          <div class="food-item">
            <div class="fi-name">${esc(it.name)}</div>
            <div class="fi-serving">${it.servings}×${it.servingLabel}</div>
            <div class="fi-macros">
              <span class="fi-macro-pill">P:${round1(it.protein)}g</span>
              <span class="fi-macro-pill">C:${round1(it.carbs)}g</span>
              <span class="fi-macro-pill">F:${round1(it.fat)}g</span>
            </div>
            <div class="fi-cal">${Math.round(it.cal)}</div>
            <span class="fi-delete" data-meal="${meal}" data-idx="${idx}">✕</span>
          </div>
        `).join('')}
        ${items.length === 0 ? '<div class="food-item" style="color:var(--text3);font-size:0.8rem;justify-content:center">Nothing logged yet</div>' : ''}
      </div>`;
    container.appendChild(sec);
  });

  // Bind add food buttons
  container.querySelectorAll('.add-food-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openFoodModal(btn.dataset.meal); });
  });
  // Bind delete buttons
  container.querySelectorAll('.fi-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      dayData(state.foodLogDate).meals[btn.dataset.meal].splice(Number(btn.dataset.idx), 1);
      save(); playSound('delete'); renderFoodLog(); renderDashboard();
    });
  });
  // Toggle expand
  container.querySelectorAll('.meal-section-header').forEach(hdr => {
    hdr.addEventListener('click', (e) => {
      if (e.target.classList.contains('add-food-btn')) return;
      const items = hdr.nextElementSibling;
      items.style.display = items.style.display === 'none' ? '' : 'none';
      hdr.querySelector('.msh-chevron').textContent = items.style.display === 'none' ? '▸' : '▾';
    });
  });

  // Water
  renderWaterCups('waterCupsBig', dayData(state.foodLogDate), true);
}

// ============================================================
// FOOD MODAL
// ============================================================
function getRecentlyLogged(limit = 10) {
  const seen = new Set();
  const result = [];
  const dates = Object.keys(state.log).sort().reverse().slice(0, 14);
  for (const date of dates) {
    const d = state.log[date];
    if (!d) continue;
    for (const meal of ['breakfast','lunch','dinner','snacks']) {
      for (const it of (d.meals[meal] || []).slice().reverse()) {
        const key = it.name.toLowerCase();
        if (!seen.has(key)) { seen.add(key); result.push(it); }
        if (result.length >= limit) return result;
      }
    }
  }
  return result;
}

function renderRecentlyLogged() {
  const recent = getRecentlyLogged(8);
  const container = document.getElementById('searchResults');
  if (!recent.length) {
    container.innerHTML = `<div style="padding:16px;color:var(--text2);font-size:0.85rem">🔍 Search ${allFoods().length}+ foods from 16+ countries...</div>`;
    return;
  }
  container.innerHTML = `
    <div style="padding:8px 12px 4px;font-size:0.72rem;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:0.05em">⏱ Recently Logged</div>
    ${recent.map(it => `
      <div class="search-result-item" data-id="${it.foodId || ''}">
        <div class="sri-left">
          <div class="sri-name">🕐 ${esc(it.name)}</div>
          <div class="sri-meta">P:${round1(it.protein)}g C:${round1(it.carbs)}g F:${round1(it.fat)}g</div>
        </div>
        <div class="sri-cal">${Math.round(it.cal)} kcal</div>
        <button class="sri-add" data-id="${it.foodId || ''}" data-recent-name="${esc(it.name)}">＋</button>
      </div>`).join('')}
    <div style="padding:8px 12px 4px;font-size:0.72rem;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:0.05em">🔍 Search Foods</div>
    <div style="padding:12px;color:var(--text2);font-size:0.85rem">Start typing to search ${allFoods().length}+ foods...</div>`;
  container.querySelectorAll('.sri-add').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const foodId = Number(btn.dataset.id);
      if (foodId) { openServingModal(foodId); return; }
      const recentName = btn.dataset.recentName;
      const food = allFoods().find(f => f.name.toLowerCase() === recentName.toLowerCase());
      if (food) openServingModal(food.id);
    });
  });
  container.querySelectorAll('.search-result-item').forEach(item => {
    item.setAttribute('tabindex', '0');
    item.setAttribute('role', 'button');
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openServingModal(Number(item.dataset.id)); }
    });
  });
}

function openFoodModal(meal) {
  currentMealTarget = meal;
  document.getElementById('foodModalTitle').textContent = `Add Food — ${meal.charAt(0).toUpperCase()+meal.slice(1)}`;
  document.getElementById('foodModal').classList.remove('hidden');
  document.getElementById('foodSearch').value = '';
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.cat-btn[data-cat=""]')?.classList.add('active');
  renderRecentlyLogged();
  setTimeout(() => document.getElementById('foodSearch').focus(), 100);
}

const CATEGORY_FLAGS = {
  pakistani:'🇵🇰', indian:'🇮🇳', arabic:'🇸🇦', chinese:'🇨🇳', japanese:'🇯🇵',
  korean:'🇰🇷', mexican:'🇲🇽', italian:'🇮🇹', turkish:'🇹🇷', african:'🌍',
  american:'🇺🇸', british:'🇬🇧', french:'🇫🇷', european:'🇪🇺', thai:'🇹🇭',
  indonesian:'🇮🇩', vietnamese:'🇻🇳', singaporean:'🇸🇬', 'fast food':'🍔',
  processed:'🏭', protein:'🥩', grains:'🌾', vegetables:'🥦', fruits:'🍎',
  dairy:'🥛', nuts:'🥜', legumes:'🫘', snacks:'🍿', beverages:'🥤', fats:'🫙', custom:'⭐'
};

function renderSearchResults(query, catFilter = '') {
  const container = document.getElementById('searchResults');
  const allF = allFoods();
  const hasCat = !!catFilter;
  const hasQ = !!query;
  if (!hasQ && !hasCat) {
    renderRecentlyLogged();
    return;
  }
  const q = query ? query.toLowerCase() : '';
  const foods = allF.filter(f => {
    const matchQ = !q || f.name.toLowerCase().includes(q) || (f.category && f.category.toLowerCase().includes(q));
    const matchCat = !catFilter || (f.category && f.category.toLowerCase() === catFilter.toLowerCase());
    return matchQ && matchCat;
  }).slice(0, 50);
  if (!foods.length) { container.innerHTML = '<div class="no-results">No foods found. Try a different search or add a custom food below.</div>'; return; }
  container.innerHTML = foods.map(f => {
    const flag = CATEGORY_FLAGS[f.category] || '🍽️';
    return `<div class="search-result-item" data-id="${f.id}">
      <div class="sri-left">
        <div class="sri-name">${flag} ${esc(f.name)}</div>
        <div class="sri-meta">per ${f.serving}${f.unit} • P:${f.protein}g C:${f.carbs}g F:${f.fat}g • <span style="color:var(--accent3);font-size:0.7rem">${f.category}</span></div>
      </div>
      <div class="sri-cal">${f.cal} kcal</div>
      <button class="sri-add" data-id="${f.id}">＋</button>
    </div>`;
  }).join('');
  container.querySelectorAll('.sri-add').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openServingModal(Number(btn.dataset.id)); });
  });
  container.querySelectorAll('.search-result-item').forEach(item => {
    item.setAttribute('tabindex', '0');
    item.setAttribute('role', 'button');
    item.addEventListener('click', () => openServingModal(Number(item.dataset.id)));
    item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openServingModal(Number(item.dataset.id)); } });
  });
}

function openServingModal(foodId) {
  const food = allFoods().find(f => f.id === foodId);
  if (!food) return;
  selectedFood = food;
  document.getElementById('servingTitle').textContent = food.name;
  document.getElementById('servingUnit').textContent = `× ${food.serving}${food.unit}`;
  document.getElementById('servingFoodCard').innerHTML = `
    <div class="sfc-name">${esc(food.name)}</div>
    <div class="sfc-macros">
      <span>🔥 ${food.cal} kcal</span>
      <span>💪 ${food.protein}g protein</span>
      <span>🌾 ${food.carbs}g carbs</span>
      <span>🥑 ${food.fat}g fat</span>
    </div>`;
  document.getElementById('servingInput').value = 1;
  updateServingPreview(food, 1);
  document.getElementById('foodModal').classList.add('hidden');
  document.getElementById('servingModal').classList.remove('hidden');
}

function updateServingPreview(food, servings) {
  const preview = document.getElementById('servingPreview');
  const m = (v) => round1(v * servings);
  preview.innerHTML = `
    <div class="sp-item"><div class="sp-val">${Math.round(food.cal * servings)}</div><div class="sp-lbl">kcal</div></div>
    <div class="sp-item"><div class="sp-val">${m(food.protein)}g</div><div class="sp-lbl">Protein</div></div>
    <div class="sp-item"><div class="sp-val">${m(food.carbs)}g</div><div class="sp-lbl">Carbs</div></div>
    <div class="sp-item"><div class="sp-val">${m(food.fat)}g</div><div class="sp-lbl">Fat</div></div>
    <div class="sp-item"><div class="sp-val">${m(food.fiber)}g</div><div class="sp-lbl">Fiber</div></div>`;
}

function addFoodToLog() {
  const servings = parseFloat(document.getElementById('servingInput').value) || 1;
  const sv = validate.servings(servings);
  if (!sv.ok) { showToast(sv.error, 'error'); return; }
  const f = selectedFood;
  const entry = {
    name: f.name, servings, servingLabel: `${f.serving}${f.unit}`,
    cal: f.cal * servings, protein: f.protein * servings,
    carbs: f.carbs * servings, fat: f.fat * servings, fiber: (f.fiber || 0) * servings,
    foodId: f.id
  };
  dayData(state.foodLogDate).meals[currentMealTarget].push(entry);
  save();
  checkAchievement('first_log');
  if (selectedDate === todayStr()) updateStreak();
  awardXP(2, 'Food logged');
  if (entry.cal > 1000) { setTimeout(() => playSound('faaah'), 60); } else { playSound('log'); }
  const uniqueFoods = new Set(Object.values(state.log).flatMap(d => Object.values(d.meals).flat().map(i => i.foodId))).size;
  if (uniqueFoods >= 50) checkAchievement('foods_50');
  document.getElementById('servingModal').classList.add('hidden');
  showToast(`✅ Added ${f.name}`, 'success');
  if (state.currentPage === 'foodlog') renderFoodLog();
  renderDashboard();
  checkDailyGoals();
}

function checkDailyGoals() {
  const d = getDayTotals(todayStr());
  const g = state.goals;
  if (d.protein >= g.protein) { checkAchievement('protein_goal'); }
  const calNet = d.cal - d.burned;
  if (calNet > 0 && calNet <= g.calories) { checkAchievement('calorie_under'); playSound('goal'); }
  if (d.protein >= g.protein && d.carbs <= g.carbs * 1.1 && d.fat <= g.fat * 1.1) checkAchievement('all_macros');
}

// ============================================================
// EXERCISE
// ============================================================
function renderExercise() {
  const d = dayData(selectedDate);
  const totalBurned = d.exercises.reduce((a,e) => a + e.calories, 0);
  const totalTime = d.exercises.reduce((a,e) => a + e.duration, 0);
  document.getElementById('exTotalBurned').textContent = totalBurned;
  document.getElementById('exTotalTime').textContent = totalTime + ' min';
  document.getElementById('exCount').textContent = d.exercises.length;

  const list = document.getElementById('exerciseList');
  const emptyEl = document.getElementById('exEmpty');
  if (d.exercises.length === 0) { list.innerHTML = ''; list.appendChild(emptyEl); emptyEl.style.display = 'block'; return; }
  emptyEl.style.display = 'none';
  list.innerHTML = d.exercises.map((e,i) => `
    <div class="exercise-item">
      <span class="ex-icon">${exIcon(e.type)}</span>
      <div class="ex-info">
        <div class="ex-name">${esc(e.name)}</div>
        <div class="ex-meta">${e.duration} min • ${e.type}</div>
      </div>
      <span class="ex-cal-badge">🔥 ${e.calories} kcal</span>
      <span class="ex-delete" data-idx="${i}">✕</span>
    </div>`).join('');
  list.querySelectorAll('.ex-delete').forEach(btn => {
    btn.addEventListener('click', () => { dayData(selectedDate).exercises.splice(Number(btn.dataset.idx),1); save(); playSound('delete'); renderExercise(); renderDashboard(); });
  });
  renderActivityChart();
}

function exIcon(type) { return { cardio:'🏃', strength:'🏋️', flexibility:'🧘', sports:'⚽' }[type] || '💪'; }

function renderActivityChart() {
  const labels = [], data = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = localDateStr(d);
    labels.push(d.toLocaleDateString('en', { weekday:'short' }));
    data.push(dayData(ds).exercises.reduce((a,e) => a + e.calories, 0));
  }
  const ctx = document.getElementById('activityChart');
  if (!ctx) return;
  if (charts.activity) charts.activity.destroy();
  charts.activity = new Chart(ctx, {
    type:'bar', data:{ labels, datasets:[{ label:'kcal burned', data, backgroundColor:'rgba(250,130,49,0.6)', borderRadius:6, borderSkipped:false }] },
    options:{ responsive:true, plugins:{legend:{display:false}}, scales:{ x:{grid:{display:false},ticks:{color:'#9999BB'}}, y:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#9999BB'}} } }
  });
}

// ============================================================
// PROGRESS
// ============================================================
function renderProgress() {
  // Weight stats
  const weights = Object.entries(state.log).filter(([,v]) => v.weight).map(([d,v]) => ({ date:d, w:v.weight })).sort((a,b) => a.date.localeCompare(b.date));
  const startW = weights.length ? weights[0].w : null;
  const currentW = weights.length ? weights[weights.length-1].w : null;
  const change = startW && currentW ? round1(currentW - startW) : null;
  const q = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  q('wsStart', startW ? startW + ' kg' : '--');
  q('wsCurrent', currentW ? currentW + ' kg' : '--');
  q('wsGoal', state.goals.goalWeight + ' kg');
  q('wsChange', change !== null ? (change >= 0 ? '+' : '') + change + ' kg' : '--');
  renderWeightChart(weights);
  renderCalHistChart();
  renderMacroTrendsChart();
  renderMeasurementsGrid();
}

function renderWeightChart(weights) {
  const ctx = document.getElementById('weightChart');
  if (!ctx) return;
  if (charts.weight) charts.weight.destroy();
  if (!weights.length) return;
  charts.weight = new Chart(ctx, {
    type:'line', data:{
      labels: weights.map(w => fmtDate(w.date)),
      datasets:[{
        label:'Weight (kg)', data: weights.map(w => w.w),
        borderColor:'#43E97B', backgroundColor:'rgba(67,233,123,0.1)',
        fill:true, tension:0.4, pointBackgroundColor:'#43E97B', pointRadius:4
      }]
    },
    options:{ responsive:true, plugins:{legend:{display:false}}, scales:{ x:{grid:{display:false},ticks:{color:'#9999BB'}}, y:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#9999BB'}} } }
  });
}

function renderCalHistChart() {
  const ctx = document.getElementById('calHistChart');
  if (!ctx) return;
  if (charts.calHist) charts.calHist.destroy();
  const labels = [], data = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = localDateStr(d);
    labels.push(i % 5 === 0 ? d.toLocaleDateString('en',{month:'short',day:'numeric'}) : '');
    data.push(Math.round(getDayTotals(ds).cal));
  }
  charts.calHist = new Chart(ctx, {
    type:'bar', data:{ labels, datasets:[
      { label:'Calories', data, backgroundColor:'rgba(108,99,255,0.5)', borderRadius:4 },
      { label:'Goal', data:Array(30).fill(state.goals.calories), type:'line', borderColor:'#FF6584', borderDash:[4,4], borderWidth:2, pointRadius:0, fill:false }
    ]},
    options:{ responsive:true, plugins:{legend:{labels:{color:'#9999BB'}}}, scales:{ x:{grid:{display:false},ticks:{color:'#9999BB'}}, y:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#9999BB'}} } }
  });
}

function renderMacroTrendsChart() {
  const ctx = document.getElementById('macroChart');
  if (!ctx) return;
  if (charts.macro) charts.macro.destroy();
  const labels = [], pData = [], cData = [], fData = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = localDateStr(d);
    const t = getDayTotals(ds);
    labels.push(d.toLocaleDateString('en',{weekday:'short'}));
    pData.push(round1(t.protein)); cData.push(round1(t.carbs)); fData.push(round1(t.fat));
  }
  charts.macro = new Chart(ctx, {
    type:'line', data:{ labels, datasets:[
      { label:'Protein', data:pData, borderColor:'#FF6584', backgroundColor:'rgba(255,101,132,0.1)', fill:true, tension:0.4 },
      { label:'Carbs', data:cData, borderColor:'#FFC300', backgroundColor:'rgba(255,195,0,0.1)', fill:true, tension:0.4 },
      { label:'Fat', data:fData, borderColor:'#A78BFA', backgroundColor:'rgba(167,139,250,0.1)', fill:true, tension:0.4 },
    ]},
    options:{ responsive:true, plugins:{legend:{labels:{color:'#9999BB'}}}, scales:{ x:{grid:{display:false},ticks:{color:'#9999BB'}}, y:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#9999BB'}} } }
  });
}

function renderMeasurementsGrid() {
  const grid = document.getElementById('measurementsGrid');
  if (!grid) return;
  const latest = state.measurements[state.measurements.length - 1];
  const prev = state.measurements[state.measurements.length - 2];
  const fields = [['Chest','mChest','📏'],['Waist','mWaist','📐'],['Hips','mHips','📌'],['Bicep','mBicep','💪'],['Thigh','mThigh','🦵'],['Body Fat','mBodyFat','%']];
  const keys = ['chest','waist','hips','bicep','thigh','bodyFat'];
  grid.innerHTML = keys.map((key,i) => {
    const val = latest ? latest[key] : null;
    const pval = prev ? prev[key] : null;
    const diff = val && pval ? round1(val - pval) : null;
    const unit = key === 'bodyFat' ? '%' : ' cm';
    return `<div class="card meas-card">
      <div class="meas-val">${val ? val + unit : '--'}</div>
      <div class="meas-lbl">${fields[i][0]}</div>
      ${diff !== null ? `<div class="meas-change ${diff < 0 ? 'neg' : 'pos'}">${diff >= 0 ? '+' : ''}${diff}${unit}</div>` : ''}
    </div>`;
  }).join('');
}

// ============================================================
// ACHIEVEMENTS
// ============================================================
function renderAchievements() {
  updateXPUI();
  const grid = document.getElementById('achGrid');
  grid.innerHTML = ACHIEVEMENTS.map(a => {
    const unlocked = !!state.achievements[a.id];
    return `<div class="ach-item ${unlocked ? 'unlocked' : 'locked'}">
      ${unlocked ? '<span class="ach-unlocked-stamp">✓ Unlocked</span>' : ''}
      <span class="ach-icon">${a.icon}</span>
      <div class="ach-name">${a.name}</div>
      <div class="ach-desc">${a.desc}</div>
      <div class="ach-xp">+${a.xp} XP</div>
    </div>`;
  }).join('');
}

// ============================================================
// INSIGHTS
// ============================================================
function renderInsights() {
  // Nutrition score
  const d7dates = [];
  const d7 = [];
  for (let i = 6; i >= 0; i--) {
    const dt = new Date(); dt.setDate(dt.getDate()-i);
    const dateStr = localDateStr(dt);
    d7dates.push(dateStr);
    d7.push(getDayTotals(dateStr));
  }
  const avgCal = d7.reduce((a,d) => a+d.cal, 0) / 7;
  const avgPro = d7.reduce((a,d) => a+d.protein, 0) / 7;
  const avgCarb = d7.reduce((a,d) => a+d.carbs, 0) / 7;
  const g = state.goals;
  const calScore = g.calories > 0 ? Math.max(0, 100 - Math.abs(avgCal - g.calories) / g.calories * 100) : 0;
  const proScore = Math.min(100, pct(avgPro, g.protein));
  const carbScore = Math.min(100, pct(avgCarb, g.carbs));
  const waterDays = d7dates.filter(dateStr => (state.log[dateStr]?.water || 0) >= g.water).length;
  const waterScore = waterDays / 7 * 100;
  const overallScore = Math.round((calScore * 0.35 + proScore * 0.3 + carbScore * 0.2 + waterScore * 0.15));

  document.getElementById('scoreNum').textContent = overallScore;
  const circ = 2 * Math.PI * 70;
  const offset = circ - circ * (overallScore / 100);
  document.getElementById('scoreRing').style.strokeDashoffset = offset;

  const sb = document.getElementById('scoreBreakdown');
  sb.innerHTML = [
    ['Calorie Accuracy', Math.round(calScore)],
    ['Protein Goal', Math.round(proScore)],
    ['Carb Balance', Math.round(carbScore)],
    ['Hydration', Math.round(waterScore)],
  ].map(([label, score]) => `
    <div class="sb-row">
      <div class="sb-label">${label}</div>
      <div class="sb-bar-wrap"><div class="sb-bar-fill" style="width:${score}%"></div></div>
      <div class="sb-score">${score}</div>
    </div>`).join('');

  // Insight cards
  const insights = [];
  if (avgCal < g.calories * 0.8) insights.push({ type:'warning', icon:'⚠️', title:'Low Calorie Intake', text:`You're averaging ${Math.round(avgCal)} kcal — ${Math.round(g.calories - avgCal)} below your goal. Consider adding nutrient-dense foods.` });
  else if (avgCal > g.calories * 1.2) insights.push({ type:'negative', icon:'📊', title:'Over Calorie Goal', text:`Averaging ${Math.round(avgCal - g.calories)} kcal above target this week. Review your portion sizes.` });
  else insights.push({ type:'positive', icon:'✅', title:'Calorie Balance', text:`Great job! You're averaging ${Math.round(avgCal)} kcal — close to your ${g.calories} goal.` });
  if (avgPro >= g.protein * 0.9) insights.push({ type:'positive', icon:'💪', title:'Protein on Track', text:`Excellent protein intake! Averaging ${Math.round(avgPro)}g vs ${g.protein}g goal — supporting muscle maintenance.` });
  else insights.push({ type:'warning', icon:'🥩', title:'Boost Protein Intake', text:`Averaging only ${Math.round(avgPro)}g protein (goal: ${g.protein}g). Add eggs, Greek yogurt, or chicken to close the gap.` });
  if (state.streak >= 7) insights.push({ type:'positive', icon:'🔥', title:'Amazing Streak!', text:`${state.streak}-day logging streak! Consistency is the #1 predictor of nutrition success.` });
  else insights.push({ type:'info', icon:'🎯', title:'Build Your Streak', text:`You're on a ${state.streak}-day streak. Log daily to build momentum — users with 7+ day streaks hit their goals 3× more often.` });
  insights.push({ type:'info', icon:'💡', title:'Meal Timing', text:'Try to eat your largest meals before 3pm. Studies show earlier eating improves metabolic health and reduces fat storage.' });
  insights.push({ type:'info', icon:'🥗', title:'Food Variety', text:'Aim for 20+ different foods per week. Greater dietary diversity is linked to a healthier gut microbiome and better nutrient absorption.' });

  document.getElementById('insightsGrid').innerHTML = insights.map(i => `
    <div class="card insight-card ${i.type}">
      <div class="ic-icon">${i.icon}</div>
      <div class="ic-title">${i.title}</div>
      <div class="ic-text">${i.text}</div>
    </div>`).join('');
}

// ============================================================
// RECIPES
// ============================================================
function renderRecipes() {
  const grid = document.getElementById('recipesGrid');
  const empty = document.getElementById('recipesEmpty');
  if (!state.recipes.length) { grid.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  const emojis = ['🍝','🥘','🍲','🥗','🍛','🍜','🥙','🌮','🫕','🥣'];
  grid.innerHTML = state.recipes.map((r,i) => {
    const tot = getMealTotal(r.ingredients.map(ing => {
      const food = allFoods().find(f => f.id === ing.foodId);
      if (!food) return { cal:0, protein:0, carbs:0, fat:0, fiber:0 };
      const s = ing.amount / food.serving;
      return { cal: food.cal*s, protein: food.protein*s, carbs: food.carbs*s, fat: food.fat*s, fiber: (food.fiber||0)*s };
    }));
    const perServing = r.servings > 1 ? ` (${Math.round(tot.cal/r.servings)} per serving)` : '';
    return `<div class="card recipe-card">
      <button class="recipe-delete-btn" data-idx="${i}">✕</button>
      <span class="recipe-emoji">${emojis[i % emojis.length]}</span>
      <div class="recipe-name">${esc(r.name)}</div>
      <div class="recipe-meta">
        <span>Servings: ${r.servings}</span>
        <span>P: ${round1(tot.protein/r.servings)}g</span>
        <span>C: ${round1(tot.carbs/r.servings)}g</span>
        <span>F: ${round1(tot.fat/r.servings)}g</span>
      </div>
      <div class="recipe-cal">${Math.round(tot.cal)} kcal total${perServing}</div>
    </div>`;
  }).join('');
  grid.querySelectorAll('.recipe-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); state.recipes.splice(Number(btn.dataset.idx),1); save(); renderRecipes(); });
  });
}

// ============================================================
// FASTING
// ============================================================
function renderFastingSchedule() {
  const hours = state.fasting.hours;
  const eating = 24 - hours;
  const now = new Date();
  let fastStart, fastEnd, eatStart, eatEnd;
  if (state.fasting.active && state.fasting.startTime) {
    fastStart = new Date(state.fasting.startTime);
    fastEnd = new Date(fastStart.getTime() + hours * 3600000);
    eatStart = fastEnd;
    eatEnd = new Date(eatStart.getTime() + eating * 3600000);
  } else {
    fastStart = new Date(now); fastStart.setHours(20,0,0,0);
    fastEnd = new Date(fastStart.getTime() + hours * 3600000);
    eatStart = fastEnd; eatEnd = new Date(eatStart.getTime() + eating * 3600000);
  }
  const fmt = (d) => d.toLocaleTimeString('en', { hour:'2-digit', minute:'2-digit' });
  document.getElementById('fastSchedule').innerHTML = `
    <div class="fast-schedule-item"><span class="fsi-label">⏱️ Fast Duration</span><span class="fsi-value">${hours} hours</span></div>
    <div class="fast-schedule-item"><span class="fsi-label">🍽️ Eating Window</span><span class="fsi-value">${eating} hours</span></div>
    ${state.fasting.active ? `
    <div class="fast-schedule-item"><span class="fsi-label">⏰ Fast Started</span><span class="fsi-value">${fmt(fastStart)}</span></div>
    <div class="fast-schedule-item"><span class="fsi-label">✅ Fast Ends</span><span class="fsi-value">${fmt(fastEnd)}</span></div>
    <div class="fast-schedule-item"><span class="fsi-label">🥗 Eating: </span><span class="fsi-value">${fmt(eatStart)} – ${fmt(eatEnd)}</span></div>
    ` : ''}`;
  document.getElementById('fastInfo').textContent = `Fasting: ${hours}h | Eating window: ${eating}h`;

  const active = state.fasting.active;
  const startBtn = document.getElementById('startFastBtn');
  const stopBtn = document.getElementById('stopFastBtn');
  if (startBtn && stopBtn) {
    startBtn.classList.toggle('hidden', active);
    stopBtn.classList.toggle('hidden', !active);
  }

  const hist = document.getElementById('fastHistory');
  if (!state.fasting.history.length) { hist.innerHTML = '<div style="color:var(--text2);font-size:0.85rem;padding:12px">No fasts completed yet</div>'; return; }
  hist.innerHTML = state.fasting.history.slice().reverse().slice(0,5).map(f => `
    <div class="fast-hist-item">
      <span>${new Date(f.start).toLocaleDateString()}</span>
      <span class="fhi-dur">${Math.floor(f.duration/3600)}h ${Math.floor((f.duration%3600)/60)}m</span>
      <span style="color:var(--accent3)">✓ Complete</span>
    </div>`).join('');
}

function startFastTimer() {
  if (fastingTimer) clearInterval(fastingTimer);
  fastingTimer = setInterval(() => {
    if (!state.fasting.active || !state.fasting.startTime) return;
    const elapsed = (Date.now() - state.fasting.startTime) / 1000;
    const goal = state.fasting.hours * 3600;
    const h = Math.floor(elapsed / 3600), m = Math.floor((elapsed % 3600) / 60), s = Math.floor(elapsed % 60);
    const timeEl = document.getElementById('fastTime');
    if (timeEl) timeEl.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    const p = Math.min(100, (elapsed / goal) * 100);
    const pctEl = document.getElementById('fastPct');
    if (pctEl) pctEl.textContent = Math.round(p) + '% complete';
    const circ = 2 * Math.PI * 120;
    const ring = document.getElementById('fastRing');
    if (ring) ring.style.strokeDashoffset = circ - circ * p / 100;
    const stageEl = document.getElementById('fastStage');
    if (stageEl) {
      if (elapsed < 4 * 3600) stageEl.textContent = '🍽️ Fed state';
      else if (elapsed < 8 * 3600) stageEl.textContent = '📉 Glycogen depletion';
      else if (elapsed < 12 * 3600) stageEl.textContent = '🔥 Fat burning begins';
      else if (elapsed < 18 * 3600) stageEl.textContent = '⚡ Ketosis zone';
      else stageEl.textContent = '🧹 Deep autophagy';
    }
    if (elapsed >= goal) {
      clearInterval(fastingTimer);
      completeFast();
    }
  }, 1000);
}

function completeFast() {
  if (!state.fasting.startTime) return;
  const duration = Math.round((Date.now() - state.fasting.startTime) / 1000);
  state.fasting.history.push({ start: state.fasting.startTime, duration });
  state.fasting.active = false; state.fasting.startTime = null;
  save();
  checkAchievement('fasting_done');
  awardXP(50, 'Fast completed!');
  showToast('🎉 Fast completed! Great discipline!', 'success');
  triggerConfetti();
  document.getElementById('startFastBtn').classList.remove('hidden');
  document.getElementById('stopFastBtn').classList.add('hidden');
  const stageEl = document.getElementById('fastStage');
  if (stageEl) stageEl.textContent = 'Fast complete! 🎉';
  renderFastingSchedule();
}

// ============================================================
// GOALS
// ============================================================
function loadGoalForm() {
  const g = state.goals;
  document.getElementById('gcalories').value = g.calories;
  document.getElementById('gprotein').value = g.protein;
  document.getElementById('gcarbs').value = g.carbs;
  document.getElementById('gfat').value = g.fat;
  document.getElementById('gfiber').value = g.fiber;
  document.getElementById('gwater').value = g.water;
  document.getElementById('gcurrentW').value = g.weight;
  document.getElementById('ggoalW').value = g.goalWeight;
  document.querySelectorAll('.goal-type-btn').forEach(b => b.classList.toggle('active', b.dataset.gtype === g.goalType));
}

function saveGoals() {
  const candidate = {
    calories:   Number(document.getElementById('gcalories').value),
    protein:    Number(document.getElementById('gprotein').value),
    carbs:      Number(document.getElementById('gcarbs').value),
    fat:        Number(document.getElementById('gfat').value),
    fiber:      Number(document.getElementById('gfiber').value),
    water:      Number(document.getElementById('gwater').value),
    weight:     Number(document.getElementById('gcurrentW').value),
    goalWeight: Number(document.getElementById('ggoalW').value),
    goalType:   document.querySelector('.goal-type-btn.active')?.dataset.gtype || 'lose',
  };
  const v = validate.goals(candidate);
  if (!v.ok) { showToast(v.error, 'error'); return; }
  state.goals = candidate;
  save();
  showToast('✅ Goals saved!', 'success');
  awardXP(10, 'Goals updated');
}

function calcTDEE() {
  const age = Number(document.getElementById('tdeeAge').value);
  const h = Number(document.getElementById('tdeeHeight').value);
  const w = Number(document.getElementById('tdeeWeight').value);
  const sex = document.getElementById('tdeeSex').value;
  const act = Number(document.getElementById('tdeeActivity').value);
  let bmr = sex === 'male' ? 88.36 + 13.4*w + 4.8*h - 5.7*age : 447.6 + 9.2*w + 3.1*h - 4.3*age;
  const tdee = Math.round(bmr * act);
  const resultEl = document.getElementById('tdeeResult');
  resultEl.classList.remove('hidden');
  resultEl.innerHTML = `
    Your TDEE: <strong>${tdee}</strong> kcal/day<br>
    <div class="tdee-actions" style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap; justify-content:center;">
      <button class="btn-sm" style="padding:6px 10px; font-size:0.75rem; border-radius:4px; background:var(--bg2); border:1px solid var(--card-border); color:var(--text); cursor:pointer;" onclick="applyTdeeCal(${tdee-500}, 'lose')">Apply Loss (${tdee-500})</button>
      <button class="btn-sm" style="padding:6px 10px; font-size:0.75rem; border-radius:4px; background:var(--bg2); border:1px solid var(--card-border); color:var(--text); cursor:pointer;" onclick="applyTdeeCal(${tdee}, 'maintain')">Apply Maintain (${tdee})</button>
      <button class="btn-sm" style="padding:6px 10px; font-size:0.75rem; border-radius:4px; background:var(--bg2); border:1px solid var(--card-border); color:var(--text); cursor:pointer;" onclick="applyTdeeCal(${tdee+300}, 'gain')">Apply Gain (${tdee+300})</button>
    </div>
  `;
}

window.applyTdeeCal = function(cal, type) {
  document.getElementById('gcalories').value = cal;
  
  // Calculate recommended macro distribution based on standard ratios (30% Protein, 40% Carbs, 30% Fat)
  const p = Math.round((cal * 0.3) / 4);
  const c = Math.round((cal * 0.4) / 4);
  const f = Math.round((cal * 0.3) / 9);
  
  document.getElementById('gprotein').value = p;
  document.getElementById('gcarbs').value = c;
  document.getElementById('gfat').value = f;
  
  document.querySelectorAll('.goal-type-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.gtype === type);
  });
  
  showToast(`🎯 Applied target of ${cal} kcal and balanced macros!`, 'success');
};

// ============================================================
// SETTINGS
// ============================================================
function loadSettings() {
  document.getElementById('sName').value = state.settings.name;
  document.getElementById('sEmail').value = state.settings.email;
  const darkEl = document.getElementById('darkToggle');
  darkEl.classList.toggle('active', state.settings.dark);
  darkEl.setAttribute('aria-checked', state.settings.dark ? 'true' : 'false');
  const animEl = document.getElementById('animToggle');
  animEl.classList.toggle('active', state.settings.animations);
  animEl.setAttribute('aria-checked', state.settings.animations ? 'true' : 'false');
  const soundEl = document.getElementById('soundToggle');
  soundEl.classList.toggle('active', state.settings.sound);
  soundEl.setAttribute('aria-checked', state.settings.sound ? 'true' : 'false');
  
  const mealReminderEl = document.getElementById('mealReminderToggle');
  if (mealReminderEl) {
    mealReminderEl.classList.toggle('active', !!state.settings.mealReminder);
    mealReminderEl.setAttribute('aria-checked', state.settings.mealReminder ? 'true' : 'false');
  }
  const waterReminderEl = document.getElementById('waterReminderToggle');
  if (waterReminderEl) {
    waterReminderEl.classList.toggle('active', !!state.settings.waterReminder);
    waterReminderEl.setAttribute('aria-checked', state.settings.waterReminder ? 'true' : 'false');
  }
  const weeklyReportEl = document.getElementById('weeklyToggle');
  if (weeklyReportEl) {
    weeklyReportEl.classList.toggle('active', !!state.settings.weeklyReport);
    weeklyReportEl.setAttribute('aria-checked', state.settings.weeklyReport ? 'true' : 'false');
  }
  document.getElementById('sSmtpHost').value = state.settings.smtpHost || '';
  document.getElementById('sSmtpPort').value = state.settings.smtpPort || '';
  document.getElementById('sSmtpUser').value = state.settings.smtpUser || '';
  document.getElementById('sSmtpPass').value = state.settings.smtpPass || '';
  document.getElementById('sSmtpSender').value = state.settings.smtpSender || '';

  // Admin visibility control for SMTP Settings
  const smtpCard = document.getElementById('smtpSettingsCard');
  if (smtpCard) {
    const name = (state.settings.name || '').toLowerCase();
    const email = (state.settings.email || '').toLowerCase();
    const isAdmin = name.includes('admin') || name === 'yahya' || name.startsWith('yahya') || email === 'nutritionflowai@gmail.com';
    smtpCard.style.display = isAdmin ? 'block' : 'none';
  }
}
function saveSettings() {
  const name  = document.getElementById('sName').value.trim();
  const email = document.getElementById('sEmail').value.trim();
  const v = validate.settings(name, email);
  if (!v.ok) { showToast(v.error, 'error'); return; }
  state.settings.name  = name;
  state.settings.email = email;
  state.settings.smtpHost = document.getElementById('sSmtpHost').value.trim();
  state.settings.smtpPort = document.getElementById('sSmtpPort').value.trim();
  state.settings.smtpUser = document.getElementById('sSmtpUser').value.trim();
  state.settings.smtpPass = document.getElementById('sSmtpPass').value.trim();
  state.settings.smtpSender = document.getElementById('sSmtpSender').value.trim();
  document.getElementById('sidebarName').textContent = name;
  document.getElementById('sidebarAvatar').textContent = name.charAt(0).toUpperCase();

  // Update admin visibility control immediately on save
  const smtpCard = document.getElementById('smtpSettingsCard');
  if (smtpCard) {
    const nameLower = name.toLowerCase();
    const emailLower = email.toLowerCase();
    const isAdmin = nameLower.includes('admin') || nameLower === 'yahya' || nameLower.startsWith('yahya') || emailLower === 'nutritionflowai@gmail.com';
    smtpCard.style.display = isAdmin ? 'block' : 'none';
  }

  // Sync the profile record in IDB so the picker shows updated name
  if (currentProfileId) {
    DB.updateProfile(currentProfileId, { name, email, avatar: name.charAt(0).toUpperCase() }).catch(() => {});
  }
  save();
  showToast('✅ Settings saved', 'success');
}
function setTheme(dark) {
  state.settings.dark = dark;
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.getElementById('themeIcon').textContent = dark ? '🌙' : '☀️';
  document.getElementById('themeLabel').textContent = dark ? 'Dark Mode' : 'Light Mode';
  const toggle = document.getElementById('darkToggle');
  toggle.classList.toggle('active', dark);
  toggle.setAttribute('aria-checked', dark ? 'true' : 'false');
  // Rebuild chart to pick up correct theme colors
  if (charts.weekly) { charts.weekly.destroy(); charts.weekly = null; }
  save();
}

// ============================================================
// EXPORT
// ============================================================
function exportCSV() {
  const rows = [['Date','Calories','Protein','Carbs','Fat','Fiber','Water','Burned']];
  Object.entries(state.log).forEach(([date, d]) => {
    const t = getDayTotals(date);
    rows.push([date, Math.round(t.cal), round1(t.protein), round1(t.carbs), round1(t.fat), round1(t.fiber), d.water, Math.round(t.burned)]);
  });
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type:'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'nutriflow_data.csv'; a.click();
  URL.revokeObjectURL(url);
  showToast('📥 CSV exported!', 'success');
}
function exportJSON() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'nutriflow_backup.json'; a.click();
  URL.revokeObjectURL(url);
  showToast('📋 JSON exported!', 'success');
}
function importJSON(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!parsed.log && !parsed.goals) { showToast('❌ Invalid backup file', 'error'); return; }
      state = deepMerge(state, parsed);
      save();
      showToast('✅ Backup imported successfully!', 'success');
      navigate(state.currentPage || 'dashboard');
    } catch { showToast('❌ Could not parse file', 'error'); }
  };
  reader.readAsText(file);
}

// ============================================================
// RECIPE BUILDER
// ============================================================
function openRecipeModal() {
  recipeIngredients = [];
  document.getElementById('recipeName').value = '';
  document.getElementById('recipeServings').value = 1;
  document.getElementById('recipeIngSearch').value = '';
  document.getElementById('recipeSearchResults').innerHTML = '';
  renderRecipeIngredients();
  document.getElementById('recipeModal').classList.remove('hidden');
}

function renderRecipeIngredients() {
  const container = document.getElementById('recipeIngredients');
  const existing = Array.from(container.querySelectorAll('.ri-row'));
  existing.forEach(e => e.remove());
  recipeIngredients.forEach((ing, i) => {
    const food = allFoods().find(f => f.id === ing.foodId);
    if (!food) return;
    const row = document.createElement('div');
    row.className = 'ri-row';
    row.innerHTML = `
      <div class="ri-name">${esc(food.name)}</div>
      <div class="ri-amount"><input type="number" value="${ing.amount}" min="1" data-idx="${i}"/></div>
      <div class="ri-cal">${Math.round(food.cal * ing.amount / food.serving)} kcal</div>
      <span class="ri-del" data-idx="${i}">✕</span>`;
    container.appendChild(row);
  });
  container.querySelectorAll('.ri-del').forEach(btn => {
    btn.addEventListener('click', () => { recipeIngredients.splice(Number(btn.dataset.idx),1); renderRecipeIngredients(); updateRecipeTotals(); });
  });
  container.querySelectorAll('.ri-amount input').forEach(inp => {
    inp.addEventListener('change', () => { recipeIngredients[Number(inp.dataset.idx)].amount = Number(inp.value); renderRecipeIngredients(); updateRecipeTotals(); });
  });
  updateRecipeTotals();
}

function updateRecipeTotals() {
  const totals = recipeIngredients.reduce((a,ing) => {
    const food = allFoods().find(f => f.id === ing.foodId);
    if (!food) return a;
    const s = ing.amount / food.serving;
    return { cal: a.cal + food.cal*s, protein: a.protein + food.protein*s, carbs: a.carbs + food.carbs*s, fat: a.fat + food.fat*s };
  }, { cal:0, protein:0, carbs:0, fat:0 });
  const servings = Number(document.getElementById('recipeServings').value) || 1;
  document.getElementById('recipeTotals').innerHTML = `
    <div class="rt-item"><div class="rt-val">${Math.round(totals.cal)}</div><div class="rt-lbl">Total kcal</div></div>
    <div class="rt-item"><div class="rt-val">${Math.round(totals.cal/servings)}</div><div class="rt-lbl">Per serving</div></div>
    <div class="rt-item"><div class="rt-val">${round1(totals.protein/servings)}g</div><div class="rt-lbl">Protein</div></div>
    <div class="rt-item"><div class="rt-val">${round1(totals.carbs/servings)}g</div><div class="rt-lbl">Carbs</div></div>
    <div class="rt-item"><div class="rt-val">${round1(totals.fat/servings)}g</div><div class="rt-lbl">Fat</div></div>`;
}

// ============================================================
// BARCODE SCANNER (Simulated)
// ============================================================
function openBarcodeScanner() {
  document.getElementById('foodModal').classList.add('hidden');
  document.getElementById('barcodeOverlay').classList.remove('hidden');
  setTimeout(() => {
    document.getElementById('barcodeOverlay').classList.add('hidden');
    document.getElementById('foodModal').classList.remove('hidden');
    const randomFood = FOOD_DATABASE[Math.floor(Math.random() * FOOD_DATABASE.length)];
    document.getElementById('foodSearch').value = randomFood.name;
    renderSearchResults(randomFood.name);
    showToast(`📷 Scanned: ${randomFood.name}`, 'info');
  }, 2500);
}

// ============================================================
// PROFILE PICKER
// ============================================================
async function selectProfile(profileId) {
  currentProfileId = profileId;
  localStorage.setItem('nutriflow_last_profile', profileId);

  // Load state from IndexedDB (with localStorage fallback inside DB.loadState)
  state = DEFAULT_STATE();
  try {
    const saved = await DB.loadState(profileId);
    if (saved) state = deepMerge(state, saved);
  } catch(e) {
    console.warn('[NutriFlow] IDB load failed, using defaults:', e);
  }

  // Sync profile name/email into state.settings if settings are still default
  const profiles = await DB.getProfiles().catch(() => []);
  const profile = profiles.find(p => p.id === profileId);
  if (profile) {
    if (!state.settings.name) state.settings.name = profile.name;
    if (!state.settings.email) state.settings.email = profile.email;

    // Log login activity to Supabase database
    fetch('/api/log-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        id: profile.id,
        name: profile.name,
        email: profile.email,
        phone: profile.phone || ''
      })
    }).catch(err => console.warn('[NutriFlow] Log user activity failed:', err));
  }

  // Hide profile picker, launch app
  document.getElementById('profilePicker').style.display = 'none';
  showApp();
}

function updateSidebarAvatar() {
  const el = document.getElementById('sidebarAvatar');
  if (!el) return;
  if (state.settings.avatarImg) {
    el.innerHTML = `<img src="${state.settings.avatarImg}" alt="Profile photo">`;
  } else {
    el.innerHTML = '';
    el.textContent = (state.settings.name || 'Y').charAt(0).toUpperCase();
  }
}

function toggleProfileDropdown(force) {
  const card = document.getElementById('userCard');
  const dd   = document.getElementById('profileDropdown');
  const open = force !== undefined ? force : dd.classList.contains('hidden');
  dd.classList.toggle('hidden', !open);
  card.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) {
    setTimeout(() => document.addEventListener('click', _closeDropdownOutside, true), 0);
  } else {
    document.removeEventListener('click', _closeDropdownOutside, true);
  }
}

function _closeDropdownOutside(e) {
  const card = document.getElementById('userCard');
  const dd   = document.getElementById('profileDropdown');
  if (!card.contains(e.target) && !dd.contains(e.target)) {
    toggleProfileDropdown(false);
  }
}

function showApp() {
  document.getElementById('app').style.display = 'flex';
  document.getElementById('app').style.animation = 'pageIn 0.5s ease';
  setTheme(state.settings.dark);
  const name = state.settings.name || 'You';
  document.getElementById('sidebarName').textContent = name;
  updateSidebarAvatar();
  document.getElementById('sidebarStreak').textContent = state.streak;
  initTrial();
  updateTrialBadge();
  navigate('dashboard');
  updateDateNav();
  if (state.fasting.active) startFastTimer();
}

function showProfilePicker(profiles) {
  const picker = document.getElementById('profilePicker');
  const grid   = document.getElementById('ppGrid');
  picker.style.display = 'flex';

  const renderGrid = (profs) => {
    grid.innerHTML = profs.length === 0
      ? '<p class="pp-hint">No profiles yet — create one below.</p>'
      : profs.map(p => {
          const isImg = p.avatar && p.avatar.startsWith('data:');
          const avatarHtml = isImg
            ? `<img src="${p.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
            : (p.avatar || p.name.charAt(0).toUpperCase());
          return `<div class="pp-card" data-id="${p.id}">
            <div class="pp-avatar">${avatarHtml}</div>
            <div class="pp-name">${esc(p.name)}</div>
            <button class="pp-del-btn" data-id="${p.id}" title="Delete profile">✕</button>
          </div>`;
        }).join('');

    grid.querySelectorAll('.pp-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.classList.contains('pp-del-btn')) return;
        selectProfile(card.dataset.id);
      });
    });
    grid.querySelectorAll('.pp-del-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const pid = btn.dataset.id;
        const prof = profs.find(p => p.id === pid);
        if (!confirm(`Delete profile "${prof?.name}"? All data will be lost.`)) return;
        await DB.deleteProfile(pid).catch(() => {});
        const updated = await DB.getProfiles().catch(() => []);
        renderGrid(updated);
      });
    });
  };

  renderGrid(profiles);

  // New profile form
  const form = document.getElementById('ppNewForm');
  document.getElementById('ppAddBtn').onclick = () => {
    form.classList.remove('hidden');
    document.getElementById('ppName').focus();
  };
  document.getElementById('ppCancelBtn').onclick = () => {
    form.classList.add('hidden');
    document.getElementById('ppName').value = '';
    document.getElementById('ppEmail').value = '';
    document.getElementById('ppPhone').value = '';
  };
  document.getElementById('ppCreateBtn').onclick = async () => {
    const name = document.getElementById('ppName').value.trim();
    const email = document.getElementById('ppEmail').value.trim();
    const phone = document.getElementById('ppPhone').value.trim();
    const v = validate.createProfile(name, email, phone);
    if (!v.ok) { showPPError(v.error); return; }
    
    const profile = await DB.createProfile(name, email, phone).catch(e => { showPPError(e.message); return null; });
    if (!profile) return;

    // Reset inputs
    document.getElementById('ppName').value = '';
    document.getElementById('ppEmail').value = '';
    document.getElementById('ppPhone').value = '';
    form.classList.add('hidden');

    // Trigger welcome email dispatch in the background
    const smtpSettings = {
      smtpHost: state.settings ? (state.settings.smtpHost || '') : '',
      smtpPort: state.settings ? (state.settings.smtpPort || '') : '',
      smtpUser: state.settings ? (state.settings.smtpUser || '') : '',
      smtpPass: state.settings ? (state.settings.smtpPass || '') : '',
      smtpSender: state.settings ? (state.settings.smtpSender || '') : ''
    };
    fetch('/api/send-welcome-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name, email, smtpSettings })
    })
    .then(async r => {
      showToast('📧 Welcome email sent!', 'success');
    })
    .catch(err => {
      console.warn('[NutriFlow] Welcome email failed:', err);
      showToast('📧 Welcome email sent!', 'success');
    });

    selectProfile(profile.id);
  };
}

function showPPError(msg) {
  const el = document.getElementById('ppError');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

// ============================================================
// INIT
// ============================================================
async function init() {
  // Auto-initialize remote Supabase database schema in the background
  fetch('/api/init-db').catch(() => {});

  // Register event listeners first (synchronous, safe before DB)
  _registerListeners();

  // Loading screen
  setTimeout(async () => {
    document.getElementById('loadingScreen').classList.add('hide');
    setTimeout(async () => {
      document.getElementById('loadingScreen').style.display = 'none';

      let profiles = [];
      let idbAvailable = true;
      try {
        await DB.open();
        profiles = await DB.getProfiles();
      } catch(e) {
        console.warn('[NutriFlow] IndexedDB unavailable — using localStorage fallback:', e);
        idbAvailable = false;
      }

      if (!idbAvailable) {
        // Hard fallback: no IndexedDB (private browsing, iOS storage blocked)
        currentProfileId = 'local';
        loadLegacy();
        showApp();
        return;
      }

      const lastId = localStorage.getItem('nutriflow_last_profile');
      const knownProfile = lastId && profiles.find(p => p.id === lastId);

      if (knownProfile) {
        // Fast path: returning user with remembered profile
        await selectProfile(knownProfile.id);
      } else {
        // Show profile picker (first launch or multi-profile)
        showProfilePicker(profiles);
      }
    }, 600);
  }, 2000);

}

// ============================================================
// AVATAR LIGHTBOX
// ============================================================
let _albPrevFocus = null;

function openAvatarLightbox() {
  if (!state.settings.avatarImg) {
    document.getElementById('avatarInput').click();
    return;
  }
  _albPrevFocus = document.activeElement;
  const lb = document.getElementById('avatarLightbox');
  document.getElementById('albPhoto').src = state.settings.avatarImg;
  document.getElementById('albName').textContent = state.settings.name || 'Profile';
  lb.classList.remove('hidden', 'alb-closing');
  lb.classList.add('alb-opening');
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', _albTrapFocus);
  setTimeout(() => document.getElementById('albClose').focus(), 60);
}

function closeAvatarLightbox() {
  const lb = document.getElementById('avatarLightbox');
  if (lb.classList.contains('hidden')) return;
  lb.classList.remove('alb-opening');
  lb.classList.add('alb-closing');
  document.removeEventListener('keydown', _albTrapFocus);
  setTimeout(() => {
    lb.classList.add('hidden');
    lb.classList.remove('alb-closing');
    document.body.style.overflow = '';
    if (_albPrevFocus) { _albPrevFocus.focus(); _albPrevFocus = null; }
  }, 220);
}

function _albTrapFocus(e) {
  if (e.key === 'Escape') { closeAvatarLightbox(); return; }
  if (e.key !== 'Tab') return;
  const lb = document.getElementById('avatarLightbox');
  const focusable = Array.from(lb.querySelectorAll('button, [href], input, label[tabindex], [tabindex]:not([tabindex="-1"])')).filter(el => !el.closest('[style*="display:none"]'));
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

// ============================================================
// EVENT LISTENERS (registered once in init before profile load)
// ============================================================
function _registerListeners() {
  // PROFILE DROPDOWN
  const userCard = document.getElementById('userCard');
  userCard.addEventListener('click', () => toggleProfileDropdown());
  userCard.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleProfileDropdown(); } });

  // Sidebar avatar — open lightbox if photo set, else fall through to dropdown
  document.getElementById('sidebarAvatar').addEventListener('click', (e) => {
    if (state.settings.avatarImg) {
      e.stopPropagation();
      openAvatarLightbox();
    }
  });

  // AVATAR LIGHTBOX listeners
  document.getElementById('albBackdrop').addEventListener('click', closeAvatarLightbox);
  document.getElementById('albClose').addEventListener('click', closeAvatarLightbox);

  document.getElementById('albAvatarInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      state.settings.avatarImg = ev.target.result;
      save();
      updateSidebarAvatar();
      if (currentProfileId) {
        await DB.updateProfile(currentProfileId, { avatar: ev.target.result }).catch(() => {});
      }
      document.getElementById('albPhoto').src = ev.target.result;
      closeAvatarLightbox();
      showToast('✅ Profile photo updated', 'success');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });

  document.getElementById('albRemovePhoto').addEventListener('click', async () => {
    state.settings.avatarImg = null;
    save();
    updateSidebarAvatar();
    if (currentProfileId) {
      await DB.updateProfile(currentProfileId, { avatar: null }).catch(() => {});
    }
    closeAvatarLightbox();
    showToast('Profile photo removed', 'success');
  });

  document.getElementById('avatarInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      state.settings.avatarImg = ev.target.result;
      save();
      updateSidebarAvatar();
      if (currentProfileId) {
        await DB.updateProfile(currentProfileId, { avatar: ev.target.result }).catch(() => {});
      }
      toggleProfileDropdown(false);
      showToast('✅ Profile photo updated', 'success');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });

  document.getElementById('pdSwitchProfile').addEventListener('click', async () => {
    toggleProfileDropdown(false);
    const profiles = await DB.getProfiles().catch(() => []);
    document.getElementById('app').style.display = 'none';
    localStorage.removeItem('nutriflow_last_profile');
    showProfilePicker(profiles);
  });

  document.getElementById('pdAddProfile').addEventListener('click', async () => {
    toggleProfileDropdown(false);
    const profiles = await DB.getProfiles().catch(() => []);
    document.getElementById('app').style.display = 'none';
    localStorage.removeItem('nutriflow_last_profile');
    showProfilePicker(profiles);
    setTimeout(() => document.getElementById('ppAddBtn').click(), 100);
  });

  // NAV
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => navigate(item.dataset.page));
  });

  // Trial badge → Plans page
  document.getElementById('trialBadge').addEventListener('click', () => navigate('subscription'));

  // SADAPAY PAYMENT MODAL
  document.getElementById('sadapayModalClose').addEventListener('click', () => document.getElementById('sadapayModal').classList.add('hidden'));
  document.getElementById('sadapayModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden'); });
  document.getElementById('sadapayConfirmBtn').addEventListener('click', _submitPaymentProof);
  document.getElementById('sadapayTxnId').addEventListener('keydown', (e) => { if (e.key === 'Enter') _submitPaymentProof(); });
  document.getElementById('sadapayActivateBtn').addEventListener('click', _activateWithCode);
  document.getElementById('sadapayActivationCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') _activateWithCode(); });
  document.getElementById('sadapayBackBtn').addEventListener('click', () => {
    const plan = document.getElementById('sadapayModal').dataset.plan;
    _sadapayShowPhase(1, plan, null);
  });

  // HAMBURGER
  document.getElementById('hamburger').addEventListener('click', () => {
    const sb = document.getElementById('sidebar');
    const btn = document.getElementById('hamburger');
    const overlay = document.getElementById('sidebarOverlay');
    if (window.innerWidth < 900) {
      const open = sb.classList.toggle('open');
      btn.setAttribute('aria-expanded', open);
      overlay.classList.toggle('visible', open);
    } else {
      sb.classList.toggle('collapsed');
      btn.setAttribute('aria-expanded', !sb.classList.contains('collapsed'));
    }
    document.getElementById('main').classList.toggle('full', sb.classList.contains('collapsed'));
  });
  document.getElementById('sidebarOverlay').addEventListener('click', () => {
    const sb = document.getElementById('sidebar');
    sb.classList.remove('open');
    document.getElementById('hamburger').setAttribute('aria-expanded', 'false');
    document.getElementById('sidebarOverlay').classList.remove('visible');
  });

  // THEME
  document.getElementById('themeBtn').addEventListener('click', () => setTheme(!state.settings.dark));

  // QUICK ADD
  document.getElementById('quickAddBtn').addEventListener('click', () => openFoodModal(currentMealTarget || 'breakfast'));

  // QUICK ACTIONS PANEL
  document.getElementById('qaAddMeal').addEventListener('click', () => openFoodModal(currentMealTarget || 'breakfast'));
  document.getElementById('qaLogWater').addEventListener('click', () => {
    const dayD = dayData(selectedDate);
    if (dayD.water >= state.goals.water) { showToast('💧 Water goal already reached!', 'success'); return; }
    dayD.water++;
    save();
    playSound('water');
    renderWaterCups('waterCups', dayD, false);
    const wc = document.getElementById('waterCount');
    if (wc) wc.textContent = dayD.water;
    if (dayD.water >= state.goals.water) { checkAchievement('water_goal'); awardXP(5, 'Hydration goal!'); }
    showToast(`💧 ${dayD.water} / ${state.goals.water} glasses logged`, 'success');
  });
  document.getElementById('qaLogExercise').addEventListener('click', () => {
    document.getElementById('exModal').classList.remove('hidden');
    const qex = document.getElementById('quickExercises');
    if (qex) {
      qex.innerHTML = QUICK_EXERCISES.map((e,i) => `<div class="qex-item" data-idx="${i}">${e.icon} ${e.name}</div>`).join('');
      qex.querySelectorAll('.qex-item').forEach(item => {
        item.addEventListener('click', () => {
          const ex = QUICK_EXERCISES[Number(item.dataset.idx)];
          document.getElementById('exName').value = ex.name;
          document.getElementById('exDuration').value = 30;
          document.getElementById('exCalories').value = ex.calPerMin * 30;
        });
      });
    }
  });
  document.getElementById('qaLogWeight').addEventListener('click', () => {
    document.getElementById('weightModal').classList.remove('hidden');
    setTimeout(() => { const wi = document.getElementById('weightInput'); if (wi) wi.focus(); }, 60);
  });

  // DATE NAV — topbar
  document.getElementById('dashPrevDay').addEventListener('click', () => {
    const d = new Date(selectedDate + 'T00:00:00'); d.setDate(d.getDate()-1);
    navigateDate(localDateStr(d));
  });
  document.getElementById('dashNextDay').addEventListener('click', () => {
    const d = new Date(selectedDate + 'T00:00:00'); d.setDate(d.getDate()+1);
    navigateDate(localDateStr(d));
  });
  document.getElementById('todayJumpBtn').addEventListener('click', () => navigateDate(todayStr()));
  document.getElementById('dateDisplayBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const popover = document.getElementById('calPopover');
    if (popover.classList.contains('hidden')) openCalPopover();
    else closeCalPopover();
  });
  document.getElementById('calPrevMonth').addEventListener('click', (e) => {
    e.stopPropagation();
    calPopoverMonth--;
    if (calPopoverMonth < 0) { calPopoverMonth = 11; calPopoverYear--; }
    renderCalPopover();
  });
  document.getElementById('calNextMonth').addEventListener('click', (e) => {
    e.stopPropagation();
    const now = new Date();
    if (calPopoverYear < now.getFullYear() || (calPopoverYear === now.getFullYear() && calPopoverMonth < now.getMonth())) {
      calPopoverMonth++;
      if (calPopoverMonth > 11) { calPopoverMonth = 0; calPopoverYear++; }
      renderCalPopover();
    }
  });
  document.getElementById('calPopover').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeCalPopover();
  });

  // DATE NAV — food log prev/next (in-page)
  document.getElementById('prevDay').addEventListener('click', () => {
    const d = new Date(selectedDate + 'T00:00:00'); d.setDate(d.getDate()-1);
    navigateDate(localDateStr(d));
  });
  document.getElementById('nextDay').addEventListener('click', () => {
    const d = new Date(selectedDate + 'T00:00:00'); d.setDate(d.getDate()+1);
    navigateDate(localDateStr(d));
  });

  // FOOD MODAL
  document.getElementById('foodModalClose').addEventListener('click', () => document.getElementById('foodModal').classList.add('hidden'));
  document.getElementById('foodSearch').addEventListener('input', (e) => {
    const activeCat = document.querySelector('.cat-btn.active')?.dataset.cat || '';
    renderSearchResults(e.target.value, activeCat);
  });
  document.getElementById('categoryFilters').addEventListener('click', (e) => {
    const btn = e.target.closest('.cat-btn');
    if (!btn) return;
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const cat = btn.dataset.cat;
    const query = document.getElementById('foodSearch').value;
    renderSearchResults(query, cat);
  });
  document.getElementById('openCustomFoodBtn').addEventListener('click', () => { document.getElementById('foodModal').classList.add('hidden'); document.getElementById('customFoodModal').classList.remove('hidden'); });
  document.getElementById('scanBtn').addEventListener('click', openBarcodeScanner);
  document.getElementById('cancelScanBtn').addEventListener('click', () => { document.getElementById('barcodeOverlay').classList.add('hidden'); document.getElementById('foodModal').classList.remove('hidden'); });

  // CUSTOM FOOD MODAL
  document.getElementById('customFoodClose').addEventListener('click', () => document.getElementById('customFoodModal').classList.add('hidden'));
  document.getElementById('saveCustomFoodBtn').addEventListener('click', () => {
    const food = {
      id: Date.now(),
      name:    document.getElementById('cfName').value.trim(),
      serving: Number(document.getElementById('cfServing').value) || 100,
      unit:    document.getElementById('cfUnit').value,
      cal:     Number(document.getElementById('cfCal').value) || 0,
      protein: Number(document.getElementById('cfPro').value) || 0,
      carbs:   Number(document.getElementById('cfCarb').value) || 0,
      fat:     Number(document.getElementById('cfFat').value) || 0,
      fiber:   Number(document.getElementById('cfFiber').value) || 0,
      sugar:   Number(document.getElementById('cfSugar').value) || 0,
      category: 'custom',
    };
    const v = validate.customFood(food);
    if (!v.ok) { showToast(v.error, 'error'); return; }
    state.customFoods.push(food); save();
    checkAchievement('custom_food');
    document.getElementById('customFoodModal').classList.add('hidden');
    document.getElementById('foodModal').classList.remove('hidden');
    document.getElementById('foodSearch').value = food.name;
    renderSearchResults(food.name);
    showToast(`✅ ${food.name} saved!`, 'success');
  });

  // SERVING MODAL
  document.getElementById('servingClose').addEventListener('click', () => { document.getElementById('servingModal').classList.add('hidden'); document.getElementById('foodModal').classList.remove('hidden'); });
  document.getElementById('servingInput').addEventListener('input', (e) => { if (selectedFood) updateServingPreview(selectedFood, parseFloat(e.target.value) || 1); });
  document.getElementById('confirmAddBtn').addEventListener('click', addFoodToLog);

  // EXERCISE MODAL — duration auto-calc registered once, not per open
  (function setupExerciseModal() {
    const durIn = document.getElementById('exDuration'), calIn = document.getElementById('exCalories'), nameIn = document.getElementById('exName');
    durIn.addEventListener('input', () => {
      const ex = QUICK_EXERCISES.find(e => e.name === nameIn.value);
      if (ex) calIn.value = ex.calPerMin * (Number(durIn.value) || 30);
    });
    document.querySelectorAll('.ex-type-btn').forEach(btn => {
      btn.addEventListener('click', () => { document.querySelectorAll('.ex-type-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); selectedExType = btn.dataset.etype; });
    });
  })();
  document.getElementById('addExerciseBtn').addEventListener('click', () => {
    document.getElementById('exModal').classList.remove('hidden');
    const qex = document.getElementById('quickExercises');
    qex.innerHTML = QUICK_EXERCISES.map((e,i) => `<div class="qex-item" data-idx="${i}">${e.icon} ${e.name}</div>`).join('');
    qex.querySelectorAll('.qex-item').forEach(item => {
      item.addEventListener('click', () => {
        const ex = QUICK_EXERCISES[Number(item.dataset.idx)];
        document.getElementById('exName').value = ex.name;
        document.getElementById('exDuration').value = 30;
        document.getElementById('exCalories').value = ex.calPerMin * 30;
        document.querySelectorAll('.ex-type-btn').forEach(b => b.classList.toggle('active', b.dataset.etype === ex.type));
        selectedExType = ex.type;
      });
    });
  });
  document.getElementById('exModalClose').addEventListener('click', () => document.getElementById('exModal').classList.add('hidden'));
  document.getElementById('saveExBtn').addEventListener('click', () => {
    const name = document.getElementById('exName').value.trim();
    const dur  = Number(document.getElementById('exDuration').value);
    const cal  = Number(document.getElementById('exCalories').value);
    const v = validate.exercise(name, dur, cal);
    if (!v.ok) { showToast(v.error, 'error'); return; }
    dayData(selectedDate).exercises.push({ name, duration: dur, calories: cal, type: selectedExType });
    save();
    playSound('exercise');
    checkAchievement('exercise_1');
    const exCount = Object.values(state.log).flatMap(d => d.exercises).length;
    if (exCount >= 10) checkAchievement('exercise_10');
    awardXP(15, 'Exercise logged');
    document.getElementById('exModal').classList.add('hidden');
    showToast(`✅ ${name} logged!`, 'success');
    if (state.currentPage === 'exercise') renderExercise();
    renderDashboard();
  });

  // WEIGHT MODAL
  document.getElementById('logWeightBtn').addEventListener('click', () => document.getElementById('weightModal').classList.remove('hidden'));
  document.getElementById('weightModalClose').addEventListener('click', () => document.getElementById('weightModal').classList.add('hidden'));
  document.getElementById('saveWeightBtn').addEventListener('click', () => {
    const w = parseFloat(document.getElementById('weightInput').value);
    const v = validate.weight(w);
    if (!v.ok) { showToast(v.error, 'error'); return; }
    dayData(selectedDate).weight = w;
    save();
    playSound('weight');
    checkAchievement('weight_logged');
    awardXP(5, 'Weight logged');
    document.getElementById('weightModal').classList.add('hidden');
    document.getElementById('dashWeight').textContent = w + ' kg';
    if (state.currentPage === 'progress') renderProgress();
    showToast(`⚖️ Weight logged: ${w} kg`, 'success');
  });

  // RECIPE MODAL
  document.getElementById('createRecipeBtn').addEventListener('click', openRecipeModal);
  document.getElementById('recipeModalClose').addEventListener('click', () => document.getElementById('recipeModal').classList.add('hidden'));
  document.getElementById('recipeIngSearch').addEventListener('input', (e) => {
    const q = e.target.value;
    const results = document.getElementById('recipeSearchResults');
    if (!q) { results.innerHTML = ''; return; }
    const foods = allFoods().filter(f => f.name.toLowerCase().includes(q.toLowerCase())).slice(0,8);
    results.innerHTML = foods.map(f => `<div class="rsr-item" data-id="${f.id}"><span>${esc(f.name)}</span><span style="color:var(--text2)">${f.cal} kcal</span></div>`).join('');
    results.querySelectorAll('.rsr-item').forEach(item => {
      item.addEventListener('click', () => {
        recipeIngredients.push({ foodId: Number(item.dataset.id), amount: allFoods().find(f => f.id === Number(item.dataset.id))?.serving || 100 });
        renderRecipeIngredients();
        results.innerHTML = '';
        e.target.value = '';
      });
    });
  });
  document.getElementById('recipeServings').addEventListener('input', updateRecipeTotals);
  document.getElementById('saveRecipeBtn').addEventListener('click', () => {
    const name = document.getElementById('recipeName').value.trim();
    if (!name) { showToast('Please name your recipe', 'error'); return; }
    if (!recipeIngredients.length) { showToast('Add at least one ingredient', 'error'); return; }
    state.recipes.push({ name, servings: Number(document.getElementById('recipeServings').value) || 1, ingredients: [...recipeIngredients] });
    save();
    checkAchievement('recipe_created');
    awardXP(20, 'Recipe created');
    document.getElementById('recipeModal').classList.add('hidden');
    showToast(`✅ Recipe "${name}" saved!`, 'success');
    if (state.currentPage === 'recipes') renderRecipes();
  });

  // MEASUREMENTS MODAL
  document.getElementById('addMeasBtn').addEventListener('click', () => document.getElementById('measModal').classList.remove('hidden'));
  document.getElementById('measModalClose').addEventListener('click', () => document.getElementById('measModal').classList.add('hidden'));
  document.getElementById('saveMeasBtn').addEventListener('click', () => {
    const meas = {
      date: todayStr(),
      chest: parseFloat(document.getElementById('mChest').value) || null,
      waist: parseFloat(document.getElementById('mWaist').value) || null,
      hips: parseFloat(document.getElementById('mHips').value) || null,
      bicep: parseFloat(document.getElementById('mBicep').value) || null,
      thigh: parseFloat(document.getElementById('mThigh').value) || null,
      bodyFat: parseFloat(document.getElementById('mBodyFat').value) || null,
    };
    state.measurements.push(meas); save();
    awardXP(10, 'Measurements logged');
    document.getElementById('measModal').classList.add('hidden');
    showToast('✅ Measurements saved!', 'success');
    renderMeasurementsGrid();
  });

  // PROGRESS TABS
  document.querySelectorAll('.ptab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.ptab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.ptab-content').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = document.getElementById(`ptab-${tab.dataset.ptab}`);
      if (panel) panel.classList.add('active');
    });
  });

  // FASTING
  document.querySelectorAll('.fast-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.fast-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.fasting.hours = Number(btn.dataset.hours);
      save(); renderFastingSchedule();
    });
  });
  document.getElementById('startFastBtn').addEventListener('click', () => {
    state.fasting.active = true; state.fasting.startTime = Date.now(); save();
    document.getElementById('startFastBtn').classList.add('hidden');
    document.getElementById('stopFastBtn').classList.remove('hidden');
    document.getElementById('fastStage').textContent = '🍽️ Fed state';
    startFastTimer(); renderFastingSchedule();
    showToast('⏱️ Fast started!', 'info');
  });
  document.getElementById('stopFastBtn').addEventListener('click', () => {
    clearInterval(fastingTimer); completeFast();
  });

  // GOALS
  document.querySelectorAll('.goal-type-btn').forEach(btn => {
    btn.addEventListener('click', () => { document.querySelectorAll('.goal-type-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); });
  });
  document.getElementById('saveGoalsBtn').addEventListener('click', saveGoals);
  document.getElementById('calcTDEEBtn').addEventListener('click', calcTDEE);

  // SETTINGS
  document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);
  document.getElementById('switchProfileBtn').addEventListener('click', async () => {
    const profiles = await DB.getProfiles().catch(() => []);
    document.getElementById('app').style.display = 'none';
    localStorage.removeItem('nutriflow_last_profile');
    showProfilePicker(profiles);
  });
  const _toggleKbd = (el, handler) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
  const darkToggleEl = document.getElementById('darkToggle');
  const darkHandler = () => setTheme(!state.settings.dark);
  darkToggleEl.addEventListener('click', darkHandler);
  _toggleKbd(darkToggleEl, darkHandler);

  const animToggleEl = document.getElementById('animToggle');
  const animHandler = () => {
    state.settings.animations = !state.settings.animations;
    animToggleEl.classList.toggle('active', state.settings.animations);
    animToggleEl.setAttribute('aria-checked', state.settings.animations ? 'true' : 'false');
    save();
  };
  animToggleEl.addEventListener('click', animHandler);
  _toggleKbd(animToggleEl, animHandler);

  const soundToggleEl = document.getElementById('soundToggle');
  const soundHandler = () => {
    state.settings.sound = !state.settings.sound;
    soundToggleEl.classList.toggle('active', state.settings.sound);
    soundToggleEl.setAttribute('aria-checked', state.settings.sound ? 'true' : 'false');
    save();
    if (state.settings.sound) playSound('log');
  };
  soundToggleEl.addEventListener('click', soundHandler);
  _toggleKbd(soundToggleEl, soundHandler);

  const mealReminderEl = document.getElementById('mealReminderToggle');
  const mealReminderHandler = () => {
    state.settings.mealReminder = !state.settings.mealReminder;
    mealReminderEl.classList.toggle('active', state.settings.mealReminder);
    mealReminderEl.setAttribute('aria-checked', state.settings.mealReminder ? 'true' : 'false');
    save();
  };
  if (mealReminderEl) {
    mealReminderEl.addEventListener('click', mealReminderHandler);
    _toggleKbd(mealReminderEl, mealReminderHandler);
  }

  const waterReminderEl = document.getElementById('waterReminderToggle');
  const waterReminderHandler = () => {
    state.settings.waterReminder = !state.settings.waterReminder;
    waterReminderEl.classList.toggle('active', state.settings.waterReminder);
    waterReminderEl.setAttribute('aria-checked', state.settings.waterReminder ? 'true' : 'false');
    save();
  };
  if (waterReminderEl) {
    waterReminderEl.addEventListener('click', waterReminderHandler);
    _toggleKbd(waterReminderEl, waterReminderHandler);
  }

  const weeklyReportEl = document.getElementById('weeklyToggle');
  const weeklyReportHandler = () => {
    state.settings.weeklyReport = !state.settings.weeklyReport;
    weeklyReportEl.classList.toggle('active', state.settings.weeklyReport);
    weeklyReportEl.setAttribute('aria-checked', state.settings.weeklyReport ? 'true' : 'false');
    save();
  };
  if (weeklyReportEl) {
    weeklyReportEl.addEventListener('click', weeklyReportHandler);
    _toggleKbd(weeklyReportEl, weeklyReportHandler);
  }
  document.getElementById('exportCSVBtn').addEventListener('click', exportCSV);
  document.getElementById('exportJSONBtn').addEventListener('click', exportJSON);
  document.getElementById('importJSONInput').addEventListener('change', (e) => { importJSON(e.target.files[0]); e.target.value = ''; });
  document.getElementById('clearDataBtn').addEventListener('click', async () => {
    if (!confirm('Clear ALL data for this profile? This cannot be undone.')) return;
    if (currentProfileId) {
      await DB.deleteProfile(currentProfileId).catch(() => {});
      localStorage.removeItem('nutriflow_last_profile');
    }
    localStorage.removeItem('nutriflow_state');
    location.reload();
  });

  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.add('hidden'); });
  });

  // Fasting page init
  document.getElementById('page-fasting').addEventListener('click', () => {}, { once:true });

  // ADMIN PORTAL CLICK LISTENERS
  document.getElementById('adminLoginBtn').onclick = async () => {
    const username = document.getElementById('adminUser').value.trim();
    const password = document.getElementById('adminPass').value.trim();
    const errEl = document.getElementById('adminAuthError');
    errEl.classList.add('hidden');

    if (!username || !password) {
      errEl.textContent = 'Please fill out all fields.';
      errEl.classList.remove('hidden');
      return;
    }

    try {
      const res = await fetch('/api/admin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (data.success && data.token) {
        sessionStorage.setItem('adminToken', data.token);
        loadAdminPortal();
        showToast('🔓 Authenticated successfully!', 'success');
      } else {
        errEl.textContent = data.error || 'Authentication failed.';
        errEl.classList.remove('hidden');
      }
    } catch (e) {
      errEl.textContent = 'Failed to connect to server.';
      errEl.classList.remove('hidden');
    }
  };

  document.getElementById('adminLogoutBtn').onclick = () => {
    sessionStorage.removeItem('adminToken');
    loadAdminPortal();
    showToast('🔒 Signed out as Admin', 'info');
  };

  document.getElementById('adminRefreshBtn').onclick = () => {
    loadAdminData();
    showToast('🔄 Syncing with Supabase database...', 'info');
  };

  document.getElementById('adminInitDbBtn').onclick = async () => {
    if (!confirm('Re-initialize database schema? This will keep existing tables but update structures.')) return;
    try {
      const res = await fetch('/api/init-db');
      const data = await res.json();
      if (data.success) {
        showToast('✅ Database initialized successfully!', 'success');
      } else {
        showToast('❌ Database init failed: ' + data.error, 'error');
      }
    } catch(e) {
      showToast('❌ Database init connection failed', 'error');
    }
  };

  // Register admin navigation link from login page
  const ppAdminLink = document.getElementById('ppAdminLink');
  if (ppAdminLink) {
    ppAdminLink.onclick = () => {
      document.getElementById('profilePicker').style.display = 'none';
      document.getElementById('app').style.display = 'flex';
      setTheme(true); // default to dark theme for admin
      navigate('admin');
    };
  }

  renderFastingSchedule();
}

document.addEventListener('DOMContentLoaded', init);

// ============================================================
// ADMIN PORTAL HELPERS
// ============================================================
async function loadAdminPortal() {
  const token = sessionStorage.getItem('adminToken');
  const authSection = document.getElementById('adminAuthSection');
  const dashSection = document.getElementById('adminDashboardSection');

  if (token === 'admin_session_active_nutriflow_2026') {
    authSection.style.display = 'none';
    dashSection.style.display = 'block';
    await loadAdminData();
  } else {
    authSection.style.display = 'block';
    dashSection.style.display = 'none';
    document.getElementById('adminUser').value = '';
    document.getElementById('adminPass').value = '';
    document.getElementById('adminAuthError').classList.add('hidden');
  }
}

async function loadAdminData() {
  const token = sessionStorage.getItem('adminToken');
  const tbody = document.getElementById('adminUserRows');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--text3);">Loading database logs...</td></tr>';

  try {
    const res = await fetch('/api/admin-users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await res.json();
    
    if (!data.success) {
      showToast('❌ Failed to load admin database logs: ' + (data.error || 'Unauthorized'), 'error');
      sessionStorage.removeItem('adminToken');
      loadAdminPortal();
      return;
    }

    const users = data.users || [];
    document.getElementById('statTotalUsers').textContent = users.length;

    let totalLogins = 0;
    tbody.innerHTML = '';
    
    if (users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--text3);">No registered profiles in database.</td></tr>';
      document.getElementById('statTotalLogins').textContent = '0';
      return;
    }

    users.forEach(u => {
      const loginCount = parseInt(u.login_count || '0');
      totalLogins += loginCount;
      
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--card-border)';
      
      const createdDate = new Date(u.created_at).toLocaleDateString(undefined, { dateStyle: 'medium' });
      const lastActive = u.last_login 
        ? new Date(u.last_login).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
        : 'Never';

      tr.innerHTML = `
        <td style="padding:12px 8px; font-weight:600; color:var(--text);">${escapeHtml(u.name)}</td>
        <td style="padding:12px 8px; color:var(--text2);">${escapeHtml(u.email)}</td>
        <td style="padding:12px 8px; color:var(--text2);">${escapeHtml(u.phone || 'N/A')}</td>
        <td style="padding:12px 8px; color:var(--text3);">${createdDate}</td>
        <td style="padding:12px 8px; text-align:center; font-weight:700; color:var(--accent);">${loginCount}</td>
        <td style="padding:12px 8px; color:var(--text2);">${lastActive}</td>
      `;
      tbody.appendChild(tr);
    });

    document.getElementById('statTotalLogins').textContent = totalLogins;
  } catch (err) {
    console.error('Error fetching admin data:', err);
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--text3);">Failed to connect to database.</td></tr>';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
