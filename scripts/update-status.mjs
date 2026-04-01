import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const PUBLIC_DIR = path.join(ROOT, 'public');
const CAPACITY_CACHE_FILE = path.join(DATA_DIR, 'ship-capacities.json');
const STATUS_FILE = path.join(PUBLIC_DIR, 'status.json');

const OFFICIAL_URL = 'https://alesund.havn.no/skipstrafikk/mooringplan-cruise/';
const CRUISE_TIMETABLES_BASE = 'https://www.cruisetimetables.com';
const CRUISEDIG_ARRIVALS_URL = 'https://cruisedig.com/ports/alesund-norway/arrivals';
const CRUISEMAPPER_BASE = 'https://www.cruisemapper.com';
const CRUISEMAPPER_PORT_URL = `${CRUISEMAPPER_BASE}/ports/alesund-port-156`;
const DEFAULT_USER_AGENT = 'tulent.no/1.0 (+https://tulent.no)';
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const MONTH_SLUG = {
  '01': 'jan',
  '02': 'feb',
  '03': 'mar',
  '04': 'apr',
  '05': 'may',
  '06': 'jun',
  '07': 'jul',
  '08': 'aug',
  '09': 'sep',
  '10': 'oct',
  '11': 'nov',
  '12': 'dec',
};

const PHRASES = [
  {
    verdict: 'HEILT GREIT',
    messages: [
      'I dag e det såpass rolig at du kan gå opp trappene uten å føle du står i kø før landskamp på Colorline',
      'Det e nesten mistenkelig stille i dag i sentrum. I dag kan du lett droppe Moa',
      'Rolig dag i byn. Softis på Stuen eller?'
    ]
  },
  {
    verdict: 'LITT TULENT',
    messages: [
      'Det e litt liv i sentrum, men ikkje meir enn at du kan ta dej en kaffikopp i fred og ro',
      'Litt tulent e det no, men du treng ikkje stenge dej inne av den grunn',
      'Det svirra litt i gata i dag, men ikkje verre enn at det går an å oppføre sej normalt'
    ]
  },
  {
    verdict: 'TULENT',
    messages: [
      'No begynne det å tetne til. Best å vere litt tidlig ute om du skal ut i sentrum',
      'Ja no e det tulent, men du overleve nok',
      'Det e såpass med cruisefolk i dag at du bør ha litt tålmod og god gangfart'
    ]
  },
  {
    verdict: 'MYKJE TULENT',
    messages: [
      'I dag e det skikkeleg tulent. Ta djup pust og styr unna dei mest opplagte rutane',
      'No snakka vi kø, kø og litt meir kø. Best å planlegge før du fer ut',
      'Det e mykje tulent i dag. Sentrum blir ikkje akkurat privat eigedom for oss sunnmøringa'
    ]
  },
  {
    verdict: 'STEJKE TULENT',
    messages: [
      'I dag e det stejke tulent. Best å halde sej heime, ja',
      'Stejke tulent i dag. Dette e ein sånn dag der du tek alt du treng før du går ut døra og håpe på det beste',
      'Det e fullt trykk i byn i dag. Om du ikkje må ut, so må du kanskje ikkje ut'
    ]
  }
];

async function main() {
  const argvDate = getArgValue('--date');
  const targetDate = argvDate || getTodayInOslo();
  const targetDateLabel = formatDateLabel(targetDate);

  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(PUBLIC_DIR, { recursive: true });

  const capacityCache = await loadJson(CAPACITY_CACHE_FILE, {});

  const officialHtml = await fetchText(OFFICIAL_URL);
  const officialCalls = parseOfficialMooringplan(officialHtml);
  const officialShips = officialCalls.get(targetDate) || [];

  let cruiseTimetablesPassengers = {};
  let cruiseTimetablesUrl = null;
  if (officialShips.length > 0) {
    cruiseTimetablesUrl = buildCruiseTimetablesUrl(targetDate);
    try {
      const dailyHtml = await fetchText(cruiseTimetablesUrl);
      const lines = extractLines(dailyHtml);
      cruiseTimetablesPassengers = findPassengersForShips(lines, officialShips, { requireMatchingDate: false, targetDate: null });
    } catch (error) {
      console.warn(`CruiseTimetables lookup failed: ${error.message}`);
    }
  }

  let cruiseDigPassengers = {};
  if (officialShips.length > 0) {
    const unresolvedShips = officialShips.filter((ship) => getMappedValue(cruiseTimetablesPassengers, ship) == null);
    if (unresolvedShips.length > 0) {
      try {
        cruiseDigPassengers = await findCruiseDigPassengers(targetDate, unresolvedShips);
      } catch (error) {
        console.warn(`CruiseDig lookup failed: ${error.message}`);
      }
    }
  }

  let cruiseMapperPassengers = {};
  if (officialShips.length > 0) {
    const unresolvedShips = officialShips.filter((ship) =>
      getMappedValue(cruiseTimetablesPassengers, ship) == null &&
      getMappedValue(cruiseDigPassengers, ship) == null
    );
    if (unresolvedShips.length > 0) {
      try {
        cruiseMapperPassengers = await findCruiseMapperPassengers(targetDate, unresolvedShips);
      } catch (error) {
        console.warn(`CruiseMapper lookup failed: ${error.message}`);
      }
    }
  }

  const resolvedShips = officialShips.map((ship) => {
    const normalized = normalizeShipName(ship);
    const fromDaily = getMappedValue(cruiseTimetablesPassengers, ship);
    const fromCruiseDig = getMappedValue(cruiseDigPassengers, ship);
    const fromCruiseMapper = getMappedValue(cruiseMapperPassengers, ship);
    const fromCache = capacityCache[normalized] ?? null;

    let passengers = null;
    let source = null;
    let approximate = true;

    if (fromDaily != null) {
      passengers = fromDaily;
      source = 'CruiseTimetables';
    } else if (fromCruiseDig != null) {
      passengers = fromCruiseDig;
      source = 'CruiseDig';
    } else if (fromCruiseMapper != null) {
      passengers = fromCruiseMapper;
      source = 'CruiseMapper';
    } else if (fromCache != null) {
      passengers = fromCache;
      source = 'local cache';
    }

    if (passengers != null) {
      capacityCache[normalized] = passengers;
    }

    return {
      name: ship,
      normalizedName: normalized,
      passengers,
      source,
      approximate,
    };
  });

  await writeJson(CAPACITY_CACHE_FILE, capacityCache);

  const knownPassengers = resolvedShips
    .filter((ship) => typeof ship.passengers === 'number')
    .reduce((sum, ship) => sum + ship.passengers, 0);
  const missingPassengerCount = resolvedShips.filter((ship) => ship.passengers == null).length;

  const assessment = buildAssessment({
    targetDate,
    ships: resolvedShips,
    knownPassengers,
    missingPassengerCount,
  });

  const payload = {
    siteTitle: 'Kor tulent e det i Ålesund i dag?',
    location: 'Alesund',
    date: targetDate,
    dateLabel: targetDateLabel,
    level: assessment.level,
    verdict: assessment.verdict,
    messages: assessment.messages,
    message: assessment.messages[0],
    explanation: assessment.explanation,
    shipsCount: resolvedShips.length,
    totalPassengers: knownPassengers,
    totalPassengersLabel: assessment.totalPassengersLabel,
    missingPassengerCount,
    updatedAt: new Date().toISOString(),
    ships: resolvedShips.map((ship) => ({
      name: ship.name,
      passengers: ship.passengers,
      passengersLabel: ship.passengers == null ? 'ukjent' : `ca. ${formatNumber(ship.passengers)}`,
      source: ship.source,
      approximate: ship.approximate,
    })),
    dataSources: {
      officialMooringplan: OFFICIAL_URL,
      dailyPassengers: cruiseTimetablesUrl,
      fallbackPassengers: CRUISEDIG_ARRIVALS_URL,
      cruiseMapperPortSchedule: officialShips.length > 0 ? buildCruiseMapperPortUrl(targetDate) : null,
    },
    notes: [
      'Skiplista kjem fra den offentlege mooringplanen til Ålesund havn',
      'Passasjertallet e estimert ut fra publiserte skipstall og skal lesast som sånn circa, ikkje fasit'
    ]
  };

  await writeJson(STATUS_FILE, payload);

  console.log(`Wrote ${STATUS_FILE}`);
  console.log(`${targetDate}: ${assessment.verdict} - ${assessment.totalPassengersLabel} cruisegjesta - ${resolvedShips.length} skip`);
}

function getArgValue(flag) {
  const arg = process.argv.find((entry) => entry === flag || entry.startsWith(`${flag}=`));
  if (!arg) return null;
  if (arg === flag) {
    const index = process.argv.indexOf(flag);
    return process.argv[index + 1] || null;
  }
  return arg.split('=').slice(1).join('=');
}

function getTodayInOslo() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Oslo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

function formatDateLabel(dateKey) {
  const date = new Date(`${dateKey}T12:00:00+01:00`);
  return new Intl.DateTimeFormat('nn-NO', {
    timeZone: 'Europe/Oslo',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

function buildCruiseTimetablesUrl(dateKey) {
  const [year, month, day] = dateKey.split('-');
  const monthSlug = MONTH_SLUG[month];
  if (!monthSlug) {
    throw new Error(`Unsupported month in date: ${dateKey}`);
  }
  return `${CRUISE_TIMETABLES_BASE}/alesundnorwayschedule-${day}${monthSlug}${year}.html`;
}

function buildCruiseMapperPortUrl(dateKey) {
  return `${CRUISEMAPPER_PORT_URL}?month=${dateKey.slice(0, 7)}`;
}

async function fetchText(url, options = {}) {
  const headers = {
    'user-agent': options.userAgent || DEFAULT_USER_AGENT,
    'accept-language': 'en,nb-NO;q=0.9,no-NO;q=0.8',
  };

  if (options.accept) {
    headers.accept = options.accept;
  }

  if (options.referer) {
    headers.referer = options.referer;
  }

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} from ${url}`);
  }

  return response.text();
}

function parseOfficialMooringplan(html) {
  const $ = cheerio.load(html);
  const callsByDate = new Map();

  $('a').each((_, link) => {
    const anchorText = $(link).text().replace(/\s+/g, ' ').trim();
    if (!/^Mooringplan\s*-/i.test(anchorText)) {
      return;
    }

    const surroundingText = $(link).parent().text().replace(/\s+/g, ' ').trim();
    if (/kansellert/i.test(surroundingText)) {
      return;
    }

    const coreText = anchorText
      .replace(/^Mooringplan\s*-\s*/i, '')
      .replace(/\s*\(PDF.*$/i, '')
      .trim();

    const parsed = parseOfficialLine(coreText);
    if (!parsed) {
      return;
    }

    for (const date of parsed.dates) {
      const existing = callsByDate.get(date) || [];
      const merged = [...existing, ...parsed.ships].filter(Boolean);
      callsByDate.set(date, uniqueShips(merged));
    }
  });

  return callsByDate;
}

function parseOfficialLine(line) {
  const rangeMatch = line.match(/^(\d{2}\.\d{2})\s*-\s*(\d{2}\.\d{2}\.\d{4})\s*-\s*(.+)$/);
  if (rangeMatch) {
    const [, startDdMm, endDdMmYyyy, shipPart] = rangeMatch;
    const year = endDdMmYyyy.slice(-4);
    const startDate = dotDateToIso(`${startDdMm}.${year}`);
    const endDate = dotDateToIso(endDdMmYyyy);
    return {
      dates: expandDateRange(startDate, endDate),
      ships: splitShipPart(shipPart),
    };
  }

  const singleMatch = line.match(/^(\d{2}\.\d{2}\.\d{4})\s*-\s*(.+)$/);
  if (singleMatch) {
    const [, dotDate, shipPart] = singleMatch;
    return {
      dates: [dotDateToIso(dotDate)],
      ships: splitShipPart(shipPart),
    };
  }

  return null;
}

function splitShipPart(shipPart) {
  return shipPart
    .split(/\s*-\s+/)
    .map(cleanShipName)
    .filter(Boolean);
}

function cleanShipName(name) {
  return name
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\bny\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueShips(ships) {
  const seen = new Set();
  const result = [];
  for (const ship of ships) {
    const normalized = normalizeShipName(ship);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(ship);
  }
  return result;
}

function dotDateToIso(dotDate) {
  const match = dotDate.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) {
    throw new Error(`Invalid dot date: ${dotDate}`);
  }
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

function expandDateRange(startIso, endIso) {
  const dates = [];
  const current = new Date(`${startIso}T12:00:00Z`);
  const end = new Date(`${endIso}T12:00:00Z`);

  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

function extractLines(html) {
  const $ = cheerio.load(html);
  return $.root()
    .text()
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function normalizeShipName(name) {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\bny\b/g, ' ')
    .replace(/\bms\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sameShipName(a, b) {
  const left = normalizeShipName(a);
  const right = normalizeShipName(b);
  return left === right || left.includes(right) || right.includes(left);
}

function parsePassengerLine(line) {
  const trimmed = line.trim();

  if (/^\d{1,3}(?:[.,]\d{3})*$/.test(trimmed)) {
    return Number(trimmed.replace(/[.,]/g, ''));
  }

  let match = trimmed.match(/\b(\d{1,3}(?:[.,]\d{3})*)\b\s*passengers?\b/i);
  if (match) {
    return Number(match[1].replace(/[.,]/g, ''));
  }

  match = trimmed.match(/^Pax:\s*(\d{1,3}(?:[.,]\d{3})*)$/i);
  if (match) {
    return Number(match[1].replace(/[.,]/g, ''));
  }

  return null;
}

function parseDateLineToIso(line) {
  const match = line.match(/^(\d{2})\s+([A-Za-z]{3})\s+(\d{4})\s+-/);
  if (!match) return null;

  const [, day, monthText, year] = match;
  const monthMap = {
    Jan: '01',
    Feb: '02',
    Mar: '03',
    Apr: '04',
    May: '05',
    Jun: '06',
    Jul: '07',
    Aug: '08',
    Sep: '09',
    Oct: '10',
    Nov: '11',
    Dec: '12',
  };

  const month = monthMap[capitalize(monthText.toLowerCase())];
  if (!month) return null;
  return `${year}-${month}-${day}`;
}

function capitalize(input) {
  return input.charAt(0).toUpperCase() + input.slice(1).toLowerCase();
}

function findPassengersForShips(lines, ships, options) {
  const result = {};
  const normalizedIndex = lines.map((line) => normalizeShipName(line));

  for (const ship of ships) {
    const target = normalizeShipName(ship);
    let fallbackPassenger = null;

    for (let i = 0; i < lines.length; i += 1) {
      const candidate = normalizedIndex[i];
      if (!(candidate === target || candidate.includes(target) || target.includes(candidate))) {
        continue;
      }

      let passenger = null;
      let nearbyDate = null;
      for (let j = i + 1; j <= Math.min(i + 8, lines.length - 1); j += 1) {
        passenger ??= parsePassengerLine(lines[j]);
        nearbyDate ??= parseDateLineToIso(lines[j]);
      }

      if (passenger == null) {
        continue;
      }

      if (!options.requireMatchingDate) {
        result[target] = passenger;
        break;
      }

      if (nearbyDate === options.targetDate) {
        result[target] = passenger;
        break;
      }

      fallbackPassenger ??= passenger;
    }

    if (result[target] == null && fallbackPassenger != null) {
      result[target] = fallbackPassenger;
    }
  }

  return result;
}

async function findCruiseDigPassengers(targetDate, ships) {
  const result = {};
  let nextUrl = CRUISEDIG_ARRIVALS_URL;
  let pageCount = 0;

  while (nextUrl && pageCount < 12) {
    pageCount += 1;
    const html = await fetchText(nextUrl);
    const lines = extractLines(html);
    const pageMatches = findPassengersForShips(lines, ships, { requireMatchingDate: true, targetDate });

    for (const ship of ships) {
      const value = getMappedValue(pageMatches, ship);
      if (value != null) {
        result[normalizeShipName(ship)] = value;
      }
    }

    if (ships.every((ship) => getMappedValue(result, ship) != null)) {
      break;
    }

    const $ = cheerio.load(html);
    let relNext = $('a[rel="next"]').attr('href') || null;
    if (!relNext) {
      $('a').each((_, link) => {
        const text = $(link).text().replace(/\s+/g, ' ').trim();
        if (!relNext && /next/i.test(text)) {
          relNext = $(link).attr('href') || null;
        }
      });
    }

    nextUrl = relNext ? new URL(relNext, CRUISEDIG_ARRIVALS_URL).toString() : null;
  }

  return result;
}

async function findCruiseMapperPassengers(targetDate, ships) {
  const result = {};
  const portUrl = buildCruiseMapperPortUrl(targetDate);
  const portHtml = await fetchText(portUrl, {
    userAgent: BROWSER_USER_AGENT,
    referer: CRUISEMAPPER_BASE,
    accept: 'text/html,application/xhtml+xml',
  });
  const shipPageUrls = parseCruiseMapperPortSchedule(portHtml, targetDate, ships);
  const shipPageCache = {};

  for (const ship of ships) {
    const shipUrl = getMappedValue(shipPageUrls, ship);
    if (!shipUrl) {
      continue;
    }

    if (shipPageCache[shipUrl] == null) {
      const shipHtml = await fetchText(shipUrl, {
        userAgent: BROWSER_USER_AGENT,
        referer: portUrl,
        accept: 'text/html,application/xhtml+xml',
      });
      shipPageCache[shipUrl] = parseCruiseMapperPassengerCount(shipHtml);
    }

    const passengers = shipPageCache[shipUrl];
    if (passengers != null) {
      result[normalizeShipName(ship)] = passengers;
    }
  }

  return result;
}

function parseCruiseMapperPortSchedule(html, targetDate, ships) {
  const $ = cheerio.load(html);
  const result = {};
  const targetDateLabel = formatCruiseMapperDate(targetDate);

  $('table.portItemSchedule tbody tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 2) {
      return;
    }

    const dateText = $(cells[0]).find('span').first().text().replace(/\s+/g, ' ').trim();
    if (dateText !== targetDateLabel) {
      return;
    }

    const shipLink = $(cells[1]).find('a[href*="/ships/"]').first();
    const shipName = shipLink.text().replace(/\s+/g, ' ').trim();
    const href = shipLink.attr('href');
    if (!shipName || !href) {
      return;
    }

    for (const ship of ships) {
      const normalized = normalizeShipName(ship);
      if (result[normalized]) {
        continue;
      }

      if (sameShipName(shipName, ship)) {
        result[normalized] = new URL(href, CRUISEMAPPER_BASE).toString();
      }
    }
  });

  return result;
}

function parseCruiseMapperPassengerCount(html) {
  const $ = cheerio.load(html);
  let passengers = null;

  $('table tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 2) {
      return;
    }

    const label = $(cells[0]).text().replace(/\s+/g, ' ').trim();
    if (!/^Passengers$/i.test(label)) {
      return;
    }

    passengers = parseCruiseMapperCapacity($(cells[1]).text().replace(/\s+/g, ' ').trim());
    return false;
  });

  return passengers;
}

function parseCruiseMapperCapacity(value) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  const rangeMatch = normalized.match(/^(\d{1,3}(?:[.,]\d{3})*|\d+)\s*(?:-|–|—|to)\s*(\d{1,3}(?:[.,]\d{3})*|\d+)$/i);
  if (rangeMatch) {
    const first = Number(rangeMatch[1].replace(/[.,]/g, ''));
    const second = Number(rangeMatch[2].replace(/[.,]/g, ''));
    return Math.max(first, second);
  }

  return parsePassengerLine(normalized);
}

function formatCruiseMapperDate(dateKey) {
  const [year, month, day] = dateKey.split('-');
  const monthNames = {
    '01': 'January',
    '02': 'February',
    '03': 'March',
    '04': 'April',
    '05': 'May',
    '06': 'June',
    '07': 'July',
    '08': 'August',
    '09': 'September',
    '10': 'October',
    '11': 'November',
    '12': 'December',
  };

  return `${Number(day)} ${monthNames[month]}, ${year}`;
}

function getMappedValue(map, shipName) {
  const normalized = normalizeShipName(shipName);
  if (map[normalized] != null) return map[normalized];
  for (const [key, value] of Object.entries(map)) {
    if (sameShipName(key, normalized)) {
      return value;
    }
  }
  return null;
}

function buildAssessment({ targetDate, ships, knownPassengers, missingPassengerCount }) {
  let level = 0;
  if (knownPassengers >= 8000) {
    level = 4;
  } else if (knownPassengers >= 4500) {
    level = 3;
  } else if (knownPassengers >= 1800) {
    level = 2;
  } else if (knownPassengers > 0 || ships.length > 0) {
    level = 1;
  }

  const phraseBucket = PHRASES[level];

  let explanation = '';
  if (ships.length === 0) {
    explanation = 'Ingen registrerte cruiseskip i dag.';
  } else if (missingPassengerCount === 0) {
    explanation = `${ships.length} skip i havn i dag, og sånn circa ${formatNumber(knownPassengers)} cruisegjesta`;
  } else if (knownPassengers > 0) {
    explanation = `${ships.length} skip i havn i dag. E fann passasjertall for ${ships.length - missingPassengerCount} av dem, så totalen e minimum ${formatNumber(knownPassengers)}`;
  } else {
    explanation = `${ships.length} skip i havn i dag, men passasjertalla mangla i kildene e bruka akkurat no`;
  }

  const totalPassengersLabel = missingPassengerCount === 0
    ? `ca. ${formatNumber(knownPassengers)}`
    : `minst ${formatNumber(knownPassengers)}`;

  return {
    level,
    verdict: phraseBucket.verdict,
    messages: phraseBucket.messages,
    explanation,
    totalPassengersLabel,
  };
}

function formatNumber(value) {
  return new Intl.NumberFormat('nb-NO').format(value);
}

async function loadJson(filePath, fallback) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
