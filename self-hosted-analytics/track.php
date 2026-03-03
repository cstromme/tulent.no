<?php

declare(strict_types=1);

// Minimal first-party visit tracking endpoint.
// Stores visits in SQLite and returns a 1x1 transparent GIF.

function clamp_text(?string $value, int $maxLen): string
{
    if ($value === null) {
        return '';
    }
    $trimmed = trim($value);
    if (strlen($trimmed) <= $maxLen) {
        return $trimmed;
    }
    return substr($trimmed, 0, $maxLen);
}

function client_ip(): string
{
    $forwarded = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
    if ($forwarded !== '') {
        $parts = explode(',', $forwarded);
        return clamp_text($parts[0], 64);
    }
    return clamp_text($_SERVER['REMOTE_ADDR'] ?? '', 64);
}

function open_db(string $path): SQLite3
{
    $db = new SQLite3($path);
    $db->busyTimeout(5000);
    $db->exec('PRAGMA journal_mode = WAL;');
    $db->exec(
        'CREATE TABLE IF NOT EXISTS visits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at INTEGER NOT NULL,
            ip TEXT NOT NULL,
            country TEXT NOT NULL,
            path TEXT NOT NULL,
            referrer TEXT NOT NULL,
            language TEXT NOT NULL,
            timezone TEXT NOT NULL,
            user_agent TEXT NOT NULL
        );'
    );
    $db->exec('CREATE INDEX IF NOT EXISTS idx_visits_created_at ON visits(created_at);');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_visits_path ON visits(path);');
    return $db;
}

$dbPath = __DIR__ . '/visits.sqlite';
$path = clamp_text($_GET['path'] ?? '/', 255);
$referrer = clamp_text($_GET['ref'] ?? '', 1024);
$language = clamp_text($_GET['lang'] ?? '', 64);
$timezone = clamp_text($_GET['tz'] ?? '', 80);
$userAgent = clamp_text($_SERVER['HTTP_USER_AGENT'] ?? '', 512);
$ip = client_ip();
$country = clamp_text($_SERVER['HTTP_CF_IPCOUNTRY'] ?? ($_SERVER['GEOIP_COUNTRY_CODE'] ?? ''), 8);
$createdAt = time();

try {
    if (class_exists('SQLite3')) {
        $db = open_db($dbPath);
        $stmt = $db->prepare(
            'INSERT INTO visits (created_at, ip, country, path, referrer, language, timezone, user_agent)
             VALUES (:created_at, :ip, :country, :path, :referrer, :language, :timezone, :user_agent)'
        );
        $stmt->bindValue(':created_at', $createdAt, SQLITE3_INTEGER);
        $stmt->bindValue(':ip', $ip, SQLITE3_TEXT);
        $stmt->bindValue(':country', $country, SQLITE3_TEXT);
        $stmt->bindValue(':path', $path, SQLITE3_TEXT);
        $stmt->bindValue(':referrer', $referrer, SQLITE3_TEXT);
        $stmt->bindValue(':language', $language, SQLITE3_TEXT);
        $stmt->bindValue(':timezone', $timezone, SQLITE3_TEXT);
        $stmt->bindValue(':user_agent', $userAgent, SQLITE3_TEXT);
        $stmt->execute();
    }
} catch (Throwable $e) {
    // Don't break site rendering if tracking storage fails.
}

$gif = base64_decode('R0lGODlhAQABAPAAAAAAAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==');
header('Content-Type: image/gif');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
echo $gif;
