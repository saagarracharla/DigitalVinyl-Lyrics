import json
import os
import re
import sqlite3
import threading
import time

from flask import jsonify
import requests

# Matches one LRC timestamp, e.g. [01:23.45]. Metadata tags like [ar:Artist] don't match.
TIMESTAMP_RE = re.compile(r'\[(\d+):(\d+(?:\.\d+)?)\]')

# LRCLib often has several versions of a song (radio edit, remix, compilation).
# A result whose length is within this many seconds of the playing track counts as the same recording.
DURATION_TOLERANCE_S = 3

# Lyrics are saved on disk, so songs heard before still have lyrics when LRCLib is down
CACHE_FILE = os.path.join(os.path.dirname(__file__), '..', '..', '.lyrics_cache.sqlite3')
# LRCLib keeps adding lyrics, so "no lyrics" is only remembered for a while
NO_LYRICS_RECHECK_S = 7 * 24 * 3600

# LRCLib often answers 429/5xx under load; a quick retry usually succeeds
RETRY_DELAYS_S = (0.5, 1.5)
RETRYABLE_STATUS = {429, 500, 502, 503, 504}

# When LRCLib keeps failing it's usually down for a while; pause before trying again rather
# than sending it more requests. The pause doubles with each failure, up to the maximum.
OUTAGE_PAUSE_S = 15
OUTAGE_PAUSE_MAX_S = 300


class LyricsService:
    def __init__(self, cache_file=CACHE_FILE):
        self.base_url = "https://lrclib.net/api"
        self.session = requests.Session()
        self.session.headers['User-Agent'] = 'DigitalVinyl (https://github.com/saagarracharla)'
        self._lock = threading.Lock()
        self._db = sqlite3.connect(cache_file, check_same_thread=False)
        self._db.execute('CREATE TABLE IF NOT EXISTS lyrics (key TEXT PRIMARY KEY, lines TEXT NOT NULL, fetched_at REAL NOT NULL)')
        self._db.commit()
        self._paused_until = 0
        self._failures = 0

    def get_lyrics(self, track, artist, duration_ms=None):
        """Get synced lyrics for a track, matching on duration when it's known."""
        duration_s = round(duration_ms / 1000) if duration_ms else None
        key = '\x00'.join([track.lower(), artist.lower(), str(duration_s)])

        cached = self._cache_get(key)
        if cached is not None:
            return jsonify({'lines': cached})

        wait = self._paused_until - time.monotonic()
        if wait > 0:
            return self._unavailable(wait)
        try:
            lines = self._fetch(track, artist, duration_s)
        except Exception as e:
            # Don't cache failures, and report them as errors so the client retries
            # instead of deciding the song has no lyrics
            self._failures += 1
            pause = min(OUTAGE_PAUSE_S * 2 ** (self._failures - 1), OUTAGE_PAUSE_MAX_S)
            self._paused_until = time.monotonic() + pause
            print(f"Lyrics error: {e} (pausing lookups for {pause}s)")
            return self._unavailable(pause)

        self._failures = 0
        self._cache_put(key, lines)
        return jsonify({'lines': lines})

    @staticmethod
    def _unavailable(retry_after_s):
        response = jsonify({'lines': [], 'error': 'Lyrics are unavailable right now', 'retry_after': round(retry_after_s)})
        return response, 503, {'Retry-After': str(max(1, round(retry_after_s)))}

    def _cache_get(self, key):
        with self._lock:
            row = self._db.execute('SELECT lines, fetched_at FROM lyrics WHERE key = ?', (key,)).fetchone()
        if not row:
            return None
        lines = json.loads(row[0])
        if not lines and time.time() - row[1] > NO_LYRICS_RECHECK_S:
            return None
        return lines

    def _cache_put(self, key, lines):
        with self._lock:
            self._db.execute('INSERT OR REPLACE INTO lyrics VALUES (?, ?, ?)', (key, json.dumps(lines), time.time()))
            self._db.commit()

    def _fetch(self, track, artist, duration_s):
        for delay in (*RETRY_DELAYS_S, None):
            try:
                response = self.session.get(
                    f"{self.base_url}/search",
                    params={'artist_name': artist, 'track_name': track},
                    timeout=10,
                )
                if response.status_code not in RETRYABLE_STATUS or delay is None:
                    break
            except requests.RequestException:
                if delay is None:
                    raise
            time.sleep(delay)
        response.raise_for_status()

        best = self._pick_best_match(response.json(), duration_s)
        return self._parse_lrc_content(best['syncedLyrics']) if best else []

    def _pick_best_match(self, results, duration_s):
        synced = [r for r in results if r.get('syncedLyrics') and not r.get('instrumental')]
        if not synced:
            return None
        if duration_s is None:
            return synced[0]

        closest = min(synced, key=lambda r: abs((r.get('duration') or 0) - duration_s))
        if abs((closest.get('duration') or 0) - duration_s) <= DURATION_TOLERANCE_S:
            return closest
        # No version is the same length, so the timings would drift; prefer no lyrics over wrong lyrics
        return None

    def _parse_lrc_content(self, lrc_text):
        """Parse LRC text into [{startTimeMs, words}], sorted by time.

        A line can carry several timestamps when it repeats, e.g. "[00:12.00][01:30.00]Chorus".
        """
        lines = []
        for raw in lrc_text.splitlines():
            stamps = TIMESTAMP_RE.findall(raw)
            if not stamps:
                continue
            words = TIMESTAMP_RE.sub('', raw).strip()
            if not words:
                continue
            for minutes, seconds in stamps:
                ms = int(int(minutes) * 60000 + float(seconds) * 1000)
                lines.append({'startTimeMs': ms, 'words': words})
        lines.sort(key=lambda line: line['startTimeMs'])
        return lines
