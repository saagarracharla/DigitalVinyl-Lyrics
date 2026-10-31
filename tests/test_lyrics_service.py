"""Tests for the lyrics service: LRCLib lookups, the disk cache and outage handling. No network."""
import os
import tempfile
import unittest
from unittest.mock import MagicMock, patch

import requests
from flask import Flask

from app.services import lyrics_service
from app.services.lyrics_service import LyricsService

RECORD = {'syncedLyrics': '[00:01.00]hello\n[00:02.50]world', 'duration': 200, 'instrumental': False}


def response(status, body=None, retry_after=None):
    r = MagicMock(status_code=status, headers={'Retry-After': str(retry_after)} if retry_after else {})
    r.json.return_value = body if body is not None else []
    r.raise_for_status.side_effect = None if status < 400 else requests.HTTPError(str(status))
    return r


class LyricsServiceTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.cache_file = os.path.join(self.dir.name, 'lyrics.sqlite3')
        for target, name, value in [(lyrics_service, 'RETRY_DELAYS_S', (0, 0)), (lyrics_service.time, 'sleep', lambda s: None)]:
            p = patch.object(target, name, value)
            p.start()
            self.addCleanup(p.stop)
        ctx = Flask(__name__).app_context()
        ctx.push()
        self.addCleanup(ctx.pop)

    def service(self, get=(), search=()):
        """A service whose LRCLib answers /api/get and /api/search from these lists, in order."""
        s = LyricsService(cache_file=self.cache_file)
        queues = {'/get': list(get), '/search': list(search)}
        s.session = MagicMock()
        s.session.get.side_effect = lambda url, params, timeout: queues['/get' if url.endswith('/get') else '/search'].pop(0)
        return s

    def calls(self, s, path):
        return [c for c in s.session.get.call_args_list if c.args[0].endswith(path)]

    def lines(self, result):
        r = result[0] if isinstance(result, tuple) else result
        return r.get_json()['lines']

    def test_direct_lookup_with_duration_and_album(self):
        s = self.service(get=[response(200, RECORD)])
        self.assertEqual(self.lines(s.get_lyrics('T', 'A', 200400, 'Al')), [{'startTimeMs': 1000, 'words': 'hello'}, {'startTimeMs': 2500, 'words': 'world'}])
        params = self.calls(s, '/get')[0].kwargs['params']
        self.assertEqual(params, {'track_name': 'T', 'artist_name': 'A', 'duration': 200, 'album_name': 'Al'})
        self.assertEqual(self.calls(s, '/search'), [])

    def test_falls_back_to_search_when_not_found(self):
        s = self.service(get=[response(404, {})], search=[response(200, [RECORD])])
        self.assertEqual(len(self.lines(s.get_lyrics('T (feat. X)', 'A', 200000))), 2)

    def test_instrumental_has_no_lyrics(self):
        s = self.service(get=[response(200, dict(RECORD, instrumental=True, syncedLyrics=None))])
        self.assertEqual(self.lines(s.get_lyrics('T', 'A', 200000)), [])

    def test_identifies_itself(self):
        self.assertRegex(LyricsService(cache_file=self.cache_file).session.headers['User-Agent'], r'^DigitalVinyl v[\d.]+ \(https://')

    def test_caches_on_disk_across_restarts(self):
        self.service(get=[response(200, RECORD)]).get_lyrics('T', 'A', 200000)
        s2 = self.service()
        self.assertEqual(len(self.lines(s2.get_lyrics('t', 'a', 200000))), 2)
        s2.session.get.assert_not_called()

    def test_retries_then_reports_unavailable_without_caching(self):
        s = self.service(get=[response(503)] * 3)
        body, status, headers = s.get_lyrics('T', 'A', 200000)
        self.assertEqual(status, 503)
        self.assertIn('Retry-After', headers)
        self.assertEqual(len(self.calls(s, '/get')), 3)
        self.assertIsNone(s._cache_get('t\x00a\x00200'))

    def test_short_retry_after_is_waited_out(self):
        s = self.service(get=[response(503, retry_after=1), response(200, RECORD)])
        with patch.object(lyrics_service.time, 'sleep') as sleep:
            self.assertEqual(len(self.lines(s.get_lyrics('T', 'A', 200000))), 2)
        self.assertGreaterEqual(sleep.call_args.args[0], 1)

    def test_long_retry_after_pauses_lookups_at_least_that_long(self):
        s = self.service(get=[response(429, retry_after=120)])
        with patch.object(lyrics_service.time, 'monotonic', return_value=1000):
            body, status, headers = s.get_lyrics('T', 'A', 200000)
            self.assertEqual(status, 503)
            self.assertGreaterEqual(s._paused_until - 1000, 120)
            self.assertGreaterEqual(int(headers['Retry-After']), 120)
        self.assertEqual(len(self.calls(s, '/get')), 1, "a long Retry-After isn't retried right away")

    def test_pauses_lookups_during_an_outage_then_recovers(self):
        s = self.service(get=[response(502)] * 3 + [response(200, RECORD)])
        s.get_lyrics('T', 'A', 200000)
        body, status, _ = s.get_lyrics('Other', 'A', 200000)
        self.assertEqual(status, 503)
        self.assertEqual(s.session.get.call_count, 3, 'no new requests while paused')
        s._paused_until = 0
        self.assertEqual(len(self.lines(s.get_lyrics('T', 'A', 200000))), 2)
        self.assertEqual(s._failures, 0)

    def test_pause_grows_with_repeated_failures(self):
        s = self.service(get=[response(502)] * 6)
        with patch.object(lyrics_service.time, 'monotonic', return_value=1000), \
             patch.object(lyrics_service.random, 'uniform', return_value=1):
            s.get_lyrics('T', 'A', 200000)
            first = s._paused_until - 1000
            s._paused_until = 0
            s.get_lyrics('T', 'A', 200000)
            self.assertEqual(s._paused_until - 1000, first * 2)

    def test_no_lyrics_is_remembered_but_rechecked_later(self):
        s = self.service(get=[response(404, {}), response(200, RECORD)], search=[response(200, [])])
        self.assertEqual(self.lines(s.get_lyrics('T', 'A', 200000)), [])
        self.assertEqual(self.lines(s.get_lyrics('T', 'A', 200000)), [])
        self.assertEqual(s.session.get.call_count, 2)
        with patch.object(lyrics_service.time, 'time', return_value=10**12):
            self.assertEqual(len(self.lines(s.get_lyrics('T', 'A', 200000))), 2)

    def test_search_prefers_the_version_with_the_same_length(self):
        versions = [{'syncedLyrics': '[00:01.00]radio edit', 'duration': 180},
                    {'syncedLyrics': '[00:01.00]album', 'duration': 201}]
        s = self.service(get=[response(404, {}), response(404, {})], search=[response(200, versions), response(200, versions)])
        self.assertEqual(self.lines(s.get_lyrics('T', 'A', 200000))[0]['words'], 'album')
        self.assertEqual(self.lines(s.get_lyrics('T', 'A', 260000)), [], 'no version close enough')


if __name__ == '__main__':
    unittest.main()
