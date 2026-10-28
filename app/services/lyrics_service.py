from flask import jsonify
import re
import requests

# Matches one LRC timestamp, e.g. [01:23.45]. Metadata tags like [ar:Artist] don't match.
TIMESTAMP_RE = re.compile(r'\[(\d+):(\d+(?:\.\d+)?)\]')

# LRCLib often has several versions of a song (radio edit, remix, compilation).
# A result whose length is within this many seconds of the playing track counts as the same recording.
DURATION_TOLERANCE_S = 3

CACHE_MAX_ENTRIES = 500


class LyricsService:
    def __init__(self):
        self.base_url = "https://lrclib.net/api"
        self.session = requests.Session()
        self.session.headers['User-Agent'] = 'DigitalVinyl (https://github.com/saagarracharla)'
        self._cache = {}

    def get_lyrics(self, track, artist, duration_ms=None):
        """Get synced lyrics for a track, matching on duration when it's known."""
        duration_s = round(duration_ms / 1000) if duration_ms else None
        key = (track.lower(), artist.lower(), duration_s)

        if key not in self._cache:
            try:
                lines = self._fetch(track, artist, duration_s)
            except Exception as e:
                # Don't cache network errors or rate limits, so the next request retries
                print(f"Lyrics error: {e}")
                return jsonify({'lines': []})

            if len(self._cache) >= CACHE_MAX_ENTRIES:
                self._cache.pop(next(iter(self._cache)))
            self._cache[key] = lines

        return jsonify({'lines': self._cache[key]})

    def _fetch(self, track, artist, duration_s):
        response = self.session.get(
            f"{self.base_url}/search",
            params={'artist_name': artist, 'track_name': track},
            timeout=10,
        )
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
