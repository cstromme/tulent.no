const verdictEl = document.getElementById('verdict');
const messageEl = document.getElementById('message');
const explanationEl = document.getElementById('explanation');
const metaEl = document.getElementById('meta');
const updatedEl = document.getElementById('updated');
const shipsWrapEl = document.getElementById('ships-wrap');
const shipsListEl = document.getElementById('ships');
const LOCAL_VISITS_KEY = 'tulent.local.pageviews';
const LOCAL_STATS_KEY = 'tulent.local.stats.v1';

async function main() {
  try {
    const response = await fetch(`./status.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Kunne ikkje lese status.json (${response.status})`);
    }

    const status = await response.json();
    render(status);
  } catch (error) {
    document.body.dataset.level = 'error';
    verdictEl.textContent = 'UVISST';
    messageEl.textContent = 'E fekk ikkje henta dagens dom akkurat no.';
    explanationEl.textContent = 'Sjekk at status.json er generert, eller køyr oppdateringsscriptet på nytt.';
    metaEl.textContent = error instanceof Error ? error.message : 'Ukjent feil';
    updatedEl.textContent = '';
  } finally {
    incrementLocalVisitCount();
  }
}

function render(status) {
  document.title = `${status.verdict} - tulent.no`;
  document.body.dataset.level = String(status.level);

  verdictEl.textContent = status.verdict;
  messageEl.textContent = pickMessage(status);
  explanationEl.textContent = status.explanation;

  const shipPart = `${status.shipsCount} ${pluralize(status.shipsCount, 'skip', 'skip')}`;
  const passengerPart = `${status.totalPassengersLabel} cruisegjesta`;
  metaEl.textContent = `${shipPart} - ${passengerPart}`;

  updatedEl.textContent = `Sist oppdatert ${formatTimestamp(status.updatedAt)}.`;

  shipsListEl.innerHTML = '';
  if (Array.isArray(status.ships) && status.ships.length > 0) {
    for (const ship of status.ships) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'ship-name';
      name.textContent = ship.name;

      const pax = document.createElement('span');
      pax.className = 'ship-pax';
      pax.textContent = ship.passengersLabel;

      li.append(name, pax);
      shipsListEl.appendChild(li);
    }

    shipsWrapEl.hidden = false;
  } else {
    shipsWrapEl.hidden = true;
  }
}

function pickMessage(status) {
  const messages = Array.isArray(status.messages)
    ? status.messages.filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
    : [];

  if (messages.length > 0) {
    return messages[Math.floor(Math.random() * messages.length)];
  }

  if (typeof status.message === 'string' && status.message.trim().length > 0) {
    return status.message;
  }

  return 'Ingen melding tilgjengeleg akkurat no.';
}

function formatTimestamp(isoString) {
  const date = new Date(isoString);
  return new Intl.DateTimeFormat('nb-NO', {
    timeZone: 'Europe/Oslo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function pluralize(count, singular, plural) {
  return count === 1 ? singular : plural;
}

function incrementLocalVisitCount() {
  try {
    const now = new Date().toISOString();
    const dayKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Oslo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    const rawStats = window.localStorage.getItem(LOCAL_STATS_KEY);
    const parsedStats = rawStats ? JSON.parse(rawStats) : {};
    const stats = parsedStats && typeof parsedStats === 'object' ? parsedStats : {};

    const raw = window.localStorage.getItem(LOCAL_VISITS_KEY);
    const legacyCount = Number.parseInt(raw ?? '0', 10);
    const statsCount = Number.parseInt(String(stats.totalVisits ?? '0'), 10);
    const baseCount = Math.max(
      Number.isFinite(legacyCount) && legacyCount > 0 ? legacyCount : 0,
      Number.isFinite(statsCount) && statsCount > 0 ? statsCount : 0
    );
    const next = baseCount + 1;

    const daily = stats.dailyVisits && typeof stats.dailyVisits === 'object' ? stats.dailyVisits : {};
    const dayCount = Number.parseInt(String(daily[dayKey] ?? '0'), 10);
    daily[dayKey] = (Number.isFinite(dayCount) && dayCount > 0 ? dayCount : 0) + 1;

    const firstVisitAt = typeof stats.firstVisitAt === 'string' && stats.firstVisitAt ? stats.firstVisitAt : now;
    const updatedStats = {
      version: 1,
      totalVisits: next,
      firstVisitAt,
      lastVisitAt: now,
      dailyVisits: daily,
    };

    window.localStorage.setItem(LOCAL_STATS_KEY, JSON.stringify(updatedStats));
    window.localStorage.setItem(LOCAL_VISITS_KEY, String(next));
  } catch {
    // Ignore local storage errors.
  }
}

main();
