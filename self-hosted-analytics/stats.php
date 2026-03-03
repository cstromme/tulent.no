<?php

declare(strict_types=1);

// Read-only JSON summary for visits collected by track.php.

function open_db(string $path): SQLite3
{
    $db = new SQLite3($path);
    $db->busyTimeout(5000);
    return $db;
}

function scalar_query(SQLite3 $db, string $sql, int $default = 0): int
{
    $value = $db->querySingle($sql, false);
    if ($value === null || $value === false) {
        return $default;
    }
    return (int) $value;
}

function grouped_query(SQLite3 $db, string $sql): array
{
    $result = $db->query($sql);
    $rows = [];
    if ($result === false) {
        return $rows;
    }
    while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
        $rows[] = $row;
    }
    return $rows;
}

$apiKey = getenv('VISIT_STATS_KEY') ?: '';
$providedKey = $_GET['key'] ?? '';
if ($apiKey !== '' && !hash_equals($apiKey, (string) $providedKey)) {
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'forbidden']);
    exit;
}

if (!class_exists('SQLite3')) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'sqlite3 extension is required']);
    exit;
}

$dbPath = __DIR__ . '/visits.sqlite';
if (!is_file($dbPath)) {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'generatedAt' => gmdate('c'),
        'totalVisits' => 0,
        'visitsLast24h' => 0,
        'uniqueIpsLast24h' => 0,
        'topPaths' => [],
        'topReferrers' => [],
        'topCountries' => [],
        'topTimezones' => [],
        'dailyLast14d' => [],
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    exit;
}

$db = open_db($dbPath);
$now = time();
$oneDayAgo = $now - 86400;
$fourteenDaysAgo = $now - (14 * 86400);

$totalVisits = scalar_query($db, 'SELECT COUNT(*) FROM visits');
$visitsLast24h = scalar_query($db, 'SELECT COUNT(*) FROM visits WHERE created_at >= ' . $oneDayAgo);
$uniqueIpsLast24h = scalar_query($db, 'SELECT COUNT(DISTINCT ip) FROM visits WHERE created_at >= ' . $oneDayAgo);

$topPaths = grouped_query(
    $db,
    'SELECT path, COUNT(*) AS count
     FROM visits
     GROUP BY path
     ORDER BY count DESC
     LIMIT 10'
);

$topReferrers = grouped_query(
    $db,
    "SELECT referrer, COUNT(*) AS count
     FROM visits
     WHERE referrer != ''
     GROUP BY referrer
     ORDER BY count DESC
     LIMIT 10"
);

$topCountries = grouped_query(
    $db,
    "SELECT country, COUNT(*) AS count
     FROM visits
     WHERE country != ''
     GROUP BY country
     ORDER BY count DESC
     LIMIT 10"
);

$topTimezones = grouped_query(
    $db,
    "SELECT timezone, COUNT(*) AS count
     FROM visits
     WHERE timezone != ''
     GROUP BY timezone
     ORDER BY count DESC
     LIMIT 10"
);

$dailyLast14d = grouped_query(
    $db,
    'SELECT strftime("%Y-%m-%d", created_at, "unixepoch") AS day, COUNT(*) AS count
     FROM visits
     WHERE created_at >= ' . $fourteenDaysAgo . '
     GROUP BY day
     ORDER BY day ASC'
);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
echo json_encode([
    'generatedAt' => gmdate('c'),
    'totalVisits' => $totalVisits,
    'visitsLast24h' => $visitsLast24h,
    'uniqueIpsLast24h' => $uniqueIpsLast24h,
    'topPaths' => $topPaths,
    'topReferrers' => $topReferrers,
    'topCountries' => $topCountries,
    'topTimezones' => $topTimezones,
    'dailyLast14d' => $dailyLast14d,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
