"""Tests for the lyrics service: matching, the disk cache and outage handling. No network."""
import os
import tempfile
import unittest
from unittest.mock import MagicMock, patch

import requests
from flask import Flask

from app.services import lyrics_service
from app.services.lyrics_service import LyricsService

FOUND = [{'syncedLyrics': '[00:01.00]hello\n[00:02.50]world', 'duration': 200}]


def response(status, body=None):
    r = MagicMock(status_code=status)
    r.json.return_value = body or []
    r.raise_for_status.side_effect = None if status < 400 else requests.HTTPError(str(status))
    return r


class LyricsServiceTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.cache_file = os.path.join(self.dir.name, 'lyrics.sqlite3')
        for name, value in [('RETRY_DELAYS_S', (0, 0))]:
            p = patch.object(lyrics_service, name, value)
            p.start()
            self.addCleanup(p.stop)
        ctx = Flask(__name__).app_context()
        ctx.push()
        self.addCleanup(ctx.pop)

    def service(self, *responses):
        s = LyricsService(cache_file=self.cache_file)
        s.session = MagicMock()
        s.session.get.side_effect = list(responses)
        return s

    def lines(self, result):
        r = result[0] if isinstance(result, tuple) else result
        return r.get_json()['lines']

    def test_parses_and_caches_on_disk_across_restarts(self):
        s = self.service(response(200, FOUND))
        self.assertEqual(self.lines(s.get_lyrics('T', 'A', 200000)), [{'startTimeMs': 1000, 'words': 'hello'}, {'startTimeMs': 2500, 'words': 'world'}])
        # A new instance (server restart) with LRCLib down still has them
        s2 = self.service(response(502))
        self.assertEqual(len(self.lines(s2.get_lyrics('t', 'a', 200000))), 2)
        s2.session.get.assert_not_called()

    def test_retries_then_reports_unavailable_without_caching(self):
        s = self.service(response(503), response(503), response(503))
        body, status, headers = s.get_lyrics('T', 'A', 200000)
        self.assertEqual(status, 503)
        self.assertIn('Retry-After', headers)
        self.assertEqual(s.session.get.call_count, 3)
        self.assertIsNone(s._cache_get('t\x00a\x00200'))

    def test_pauses_lookups_during_an_outage_then_recovers(self):
        s = self.service(response(502), response(502), response(502), response(200, FOUND))
        s.get_lyrics('T', 'A', 200000)
        body, status, _ = s.get_lyrics('Other', 'A', 200000)
        self.assertEqual(status, 503)
        self.assertEqual(s.session.get.call_count, 3, 'no new requests while paused')
        s._paused_until = 0
        self.assertEqual(len(self.lines(s.get_lyrics('T', 'A', 200000))), 2)
        self.assertEqual(s._failures, 0)

    def test_pause_grows_with_repeated_failures(self):
        s = self.service(*[response(502)] * 6)
        with patch.object(lyrics_service.time, 'monotonic', return_value=1000):
            s.get_lyrics('T', 'A')
            first = s._paused_until - 1000
            s._paused_until = 0
            s.get_lyrics('T', 'A')
            self.assertEqual(s._paused_until - 1000, first * 2)

    def test_no_lyrics_is_remembered_but_rechecked_later(self):
        s = self.service(response(200, []), response(200, FOUND))
        self.assertEqual(self.lines(s.get_lyrics('T', 'A', 200000)), [])
        self.assertEqual(self.lines(s.get_lyrics('T', 'A', 200000)), [])
        self.assertEqual(s.session.get.call_count, 1)
        with patch.object(lyrics_service.time, 'time', return_value=10**12):
            self.assertEqual(len(self.lines(s.get_lyrics('T', 'A', 200000))), 2)

    def test_prefers_the_version_with_the_same_length(self):
        versions = [{'syncedLyrics': '[00:01.00]radio edit', 'duration': 180},
                    {'syncedLyrics': '[00:01.00]album', 'duration': 201}]
        s = self.service(response(200, versions), response(200, versions))
        self.assertEqual(self.lines(s.get_lyrics('T', 'A', 200000))[0]['words'], 'album')
        self.assertEqual(self.lines(s.get_lyrics('T', 'A', 260000)), [], 'no version close enough')


if __name__ == '__main__':
    unittest.main()
