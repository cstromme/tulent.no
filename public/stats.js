const LOCAL_STATS_KEY = 'tulent.local.stats.v1';
const LOCAL_AUTH_HASH_KEY = 'tulent.stats.auth.hash.v1';
const LOCAL_AUTH_SESSION_KEY = 'tulent.stats.auth.session.v1';

const loginCardEl = document.getElementById('login-card');
const statsCardEl = document.getElementById('stats-card');
const loginFormEl = document.getElementById('login-form');
const loginHelpEl = document.getElementById('login-help');
const loginErrorEl = document.getElementById('login-error');
const passwordEl = document.getElementById('password');
const logoutBtnEl = document.getElementById('logout-btn');
const statsSummaryEl = document.getElementById('stats-summary');
const statsWindowEl = document.getElementById('stats-window');
const dailyListEl = document.getElementById('daily-list');

let authHash = '';

async function main() {
  authHash = window.localStorage.getItem(LOCAL_AUTH_HASH_KEY) || '';
  if (!authHash) {
    loginHelpEl.textContent = 'Første gong her: vel eit passord for denne nettlesaren.';
  }

  loginFormEl.addEventListener('submit', onLoginSubmit);
  logoutBtnEl.addEventListener('click', onLogoutClick);

  const authed = window.sessionStorage.getItem(LOCAL_AUTH_SESSION_KEY) === '1';
  if (authed && authHash) {
    showStats();
    return;
  }
  showLogin();
}

function showLogin() {
  loginCardEl.hidden = false;
  statsCardEl.hidden = true;
  loginErrorEl.textContent = '';
  passwordEl.value = '';
}

function showStats() {
  loginCardEl.hidden = true;
  statsCardEl.hidden = false;
  renderStats();
}

async function onLoginSubmit(event) {
  event.preventDefault();
  loginErrorEl.textContent = '';

  const password = passwordEl.value || '';
  if (password.length < 4) {
    loginErrorEl.textContent = 'Passordet må vere minst 4 teikn.';
    return;
  }

  const enteredHash = await sha256Hex(password);
  if (!authHash) {
    authHash = enteredHash;
    window.localStorage.setItem(LOCAL_AUTH_HASH_KEY, authHash);
  } else if (enteredHash !== authHash) {
    loginErrorEl.textContent = 'Feil passord.';
    return;
  }

  window.sessionStorage.setItem(LOCAL_AUTH_SESSION_KEY, '1');
  showStats();
}

function onLogoutClick() {
  window.sessionStorage.removeItem(LOCAL_AUTH_SESSION_KEY);
  showLogin();
}

function renderStats() {
  const stats = readStats();
  const total = stats.totalVisits;
  const todayKey = getDayKey(new Date());
  const todayCount = stats.dailyVisits[todayKey] || 0;

  statsSummaryEl.textContent = `Totalt ${formatNumber(total)} lokale sidevisningar. I dag: ${formatNumber(todayCount)}.`;

  const first = stats.firstVisitAt ? formatTimestamp(stats.firstVisitAt) : 'ukjent';
  const last = stats.lastVisitAt ? formatTimestamp(stats.lastVisitAt) : 'ukjent';
  statsWindowEl.textContent = `Første registrerte besøk: ${first}. Siste registrerte besøk: ${last}.`;

  const rows = Object.entries(stats.dailyVisits)
    .sort((a, b) => a[0] < b[0] ? 1 : -1)
    .slice(0, 14);

  dailyListEl.innerHTML = '';
  if (rows.length === 0) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = 'Ingen lokale besøk registrert enno.';
    li.append(label);
    dailyListEl.appendChild(li);
    return;
  }

  for (const [day, count] of rows) {
    const li = document.createElement('li');
    const dayEl = document.createElement('span');
    dayEl.textContent = day;
    const countEl = document.createElement('span');
    countEl.textContent = formatNumber(count);
    li.append(dayEl, countEl);
    dailyListEl.appendChild(li);
  }
}

function readStats() {
  let parsed = {};
  try {
    const raw = window.localStorage.getItem(LOCAL_STATS_KEY);
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = {};
  }

  const daily = {};
  if (parsed && typeof parsed.dailyVisits === 'object' && parsed.dailyVisits !== null) {
    for (const [key, value] of Object.entries(parsed.dailyVisits)) {
      const n = Number.parseInt(String(value), 10);
      if (Number.isFinite(n) && n > 0) {
        daily[key] = n;
      }
    }
  }

  const total = Number.parseInt(String(parsed.totalVisits ?? '0'), 10);
  return {
    totalVisits: Number.isFinite(total) && total > 0 ? total : 0,
    firstVisitAt: typeof parsed.firstVisitAt === 'string' ? parsed.firstVisitAt : '',
    lastVisitAt: typeof parsed.lastVisitAt === 'string' ? parsed.lastVisitAt : '',
    dailyVisits: daily,
  };
}

function getDayKey(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Oslo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function formatTimestamp(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return 'ukjent';
  return new Intl.DateTimeFormat('nb-NO', {
    timeZone: 'Europe/Oslo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatNumber(value) {
  return new Intl.NumberFormat('nb-NO').format(value);
}

async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

main();
