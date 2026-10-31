"""Tests for the device's play queue and how it drives Spotify. Run: python -m unittest discover tests"""
import random
import unittest
from unittest.mock import MagicMock, patch

from flask import Flask

from app.services import play_queue
from app.services.play_queue import PlayQueue


def tracks(n, prefix='t'):
    return [{'id': f'{prefix}{i}', 'uri': f'spotify:track:{prefix}{i}', 'name': f'Song {i}', 'artists': ['A']}
            for i in range(n)]


def names(entries):
    return [e['id'] for e in entries]


class PlayQueueTest(unittest.TestCase):
    def test_in_order_without_shuffle(self):
        q = PlayQueue()
        q.load(tracks(5), {'name': 'P'})
        self.assertEqual(q.current['id'], 't0')
        self.assertEqual(names(q.context_queue), ['t1', 't2', 't3', 't4'])

    def test_shuffle_starts_on_a_random_song_and_plays_every_other_one(self):
        starts = set()
        for seed in range(20):
            q = PlayQueue(shuffle=True, rng=random.Random(seed))
            q.load(tracks(10))
            starts.add(q.current['id'])
            self.assertEqual(sorted(names(q.context_queue) + [q.current['id']]), sorted(names(tracks(10))))
        self.assertGreater(len(starts), 3, 'shuffle should not always start on the same song')

    def test_window_and_following_spotify(self):
        q = PlayQueue()
        q.load(tracks(5))
        uris, offset = q.build_window()
        self.assertEqual(offset, 0)
        self.assertEqual(len(uris), 5)

        self.assertTrue(q.observe('spotify:track:t2'))        # skipped twice
        self.assertEqual(q.current['id'], 't2')
        self.assertEqual(names(q.history), ['t0', 't1'])
        self.assertEqual(names(q.context_queue), ['t3', 't4'])

        self.assertTrue(q.observe('spotify:track:t1'))        # previous
        self.assertEqual(q.current['id'], 't1')
        self.assertEqual(names(q.context_queue), ['t2', 't3', 't4'])

        self.assertFalse(q.observe('spotify:track:t1'))       # same song
        self.assertIsNone(q.observe('spotify:track:other'))   # not ours

    def test_follows_spotify_playing_another_version_of_a_song(self):
        q = PlayQueue()
        q.load(tracks(3))
        q.build_window()
        self.assertTrue(q.observe('spotify:track:other-id', 'Song 1', 'A'))
        self.assertEqual(q.current['id'], 't1')
        self.assertFalse(q.observe('spotify:track:other-id', 'Song 1', 'A'))
        self.assertIsNone(q.observe('spotify:track:other-id', 'Song 1', 'Someone else'))

    def test_next_in_queue_plays_before_the_playlist(self):
        q = PlayQueue()
        q.load(tracks(3))
        q.add({'id': 'x', 'uri': 'spotify:track:x'})
        q.add({'id': 'y', 'uri': 'spotify:track:y'}, play_next=True)
        uris, offset = q.build_window()
        self.assertEqual(uris, ['spotify:track:t0', 'spotify:track:y', 'spotify:track:x',
                                'spotify:track:t1', 'spotify:track:t2'])
        q.observe('spotify:track:y')
        self.assertEqual(names(q.user_queue), ['x'])
        q.observe('spotify:track:x')
        q.observe('spotify:track:x')
        self.assertEqual(q.user_queue, [])
        self.assertEqual(names(q.context_queue), ['t1', 't2'])

    def test_previous_puts_a_queued_song_back_in_next_in_queue(self):
        q = PlayQueue()
        q.load(tracks(3))
        q.add({'id': 'x', 'uri': 'spotify:track:x'})
        q.build_window()
        q.observe('spotify:track:x')
        q.observe('spotify:track:t0')
        self.assertEqual(names(q.user_queue), ['x'])

    def test_remove_move_clear_jump(self):
        q = PlayQueue()
        q.load(tracks(6))
        q.add({'id': 'x', 'uri': 'spotify:track:x'})
        q.add({'id': 'y', 'uri': 'spotify:track:y'})
        uid = lambda section, i: section[i]['uid']

        q.remove(uid(q.context_queue, 0))
        self.assertEqual(names(q.context_queue), ['t2', 't3', 't4', 't5'])
        q.move(uid(q.context_queue, 3), 0)
        self.assertEqual(names(q.context_queue), ['t5', 't2', 't3', 't4'])
        q.move(uid(q.user_queue, 0), 99)
        self.assertEqual(names(q.user_queue), ['y', 'x'])

        q.jump(uid(q.context_queue, 2))                       # tap t3
        self.assertEqual(q.current['id'], 't3')
        self.assertEqual(names(q.context_queue), ['t4'])
        self.assertEqual(names(q.user_queue), ['y', 'x'], '"Next in queue" survives jumping in the playlist')

        q.clear_user_queue()
        self.assertEqual(q.user_queue, [])
        with self.assertRaises(KeyError):
            q.remove('missing')

    def test_shuffle_on_then_off_resumes_original_order(self):
        q = PlayQueue(rng=random.Random(1))
        q.load(tracks(8), start_index=2)
        q.set_shuffle(True)
        self.assertEqual(sorted(names(q.context_queue)), sorted(['t0', 't1', 't3', 't4', 't5', 't6', 't7']))
        q.set_shuffle(False)
        self.assertEqual(names(q.context_queue), ['t3', 't4', 't5', 't6', 't7'])

    def test_repeat_playlist_starts_over(self):
        q = PlayQueue(repeat='context')
        q.load(tracks(2))
        q.build_window()
        q.observe('spotify:track:t1')
        self.assertEqual(names(q.context_queue), ['t0', 't1'])
        self.assertTrue(q.needs_refill())

    def test_no_repeat_ends(self):
        q = PlayQueue()
        q.load(tracks(2))
        q.build_window()
        q.observe('spotify:track:t1')
        self.assertEqual(q.context_queue, [])
        self.assertFalse(q.needs_refill())

    def test_large_playlists_are_sent_in_windows(self):
        q = PlayQueue()
        q.load(tracks(250))
        uris, offset = q.build_window()
        self.assertEqual(len(uris), 1 + play_queue.WINDOW_AHEAD)
        for i in range(1, play_queue.WINDOW_AHEAD):
            q.observe(f'spotify:track:t{i}')
        self.assertTrue(q.needs_refill())
        uris, offset = q.build_window()
        self.assertEqual(uris[offset], 'spotify:track:t99')
        self.assertEqual(len(uris) - offset - 1, play_queue.WINDOW_AHEAD)

    def test_edits_beyond_the_window_need_no_restart(self):
        q = PlayQueue()
        q.load(tracks(250))
        q.build_window()
        q.remove(q.context_queue[200]['uid'])
        self.assertIsNone(q.rebuild_window_if_changed())
        q.remove(q.context_queue[0]['uid'])
        self.assertIsNotNone(q.rebuild_window_if_changed())


class SpotifyServiceQueueTest(unittest.TestCase):
    """The service with a fake Spotify client: checks what gets sent to Spotify"""

    def setUp(self):
        from app.services import spotify_service
        patcher = patch.object(spotify_service.SpotifyService, '_initialize_spotify', lambda self: None)
        patcher.start()
        self.addCleanup(patcher.stop)
        # Don't read or write the real shuffle/repeat file
        for name, value in [('_load_player_state', lambda self: {'shuffle': False, 'repeat': 'off'}),
                            ('_save_player_state', lambda self: None)]:
            state_patch = patch.object(spotify_service.SpotifyService, name, value)
            state_patch.start()
            self.addCleanup(state_patch.stop)

        self.service = spotify_service.SpotifyService()
        self.sp = self.service.sp = MagicMock()
        items = [{'is_local': False, 'track': dict(t, type='track', artists=[{'name': 'A'}],
                                                    album={'name': 'Al', 'images': []}, duration_ms=1000)}
                 for t in tracks(150)]
        items.insert(3, {'is_local': True, 'track': {'id': None, 'uri': 'spotify:local:x', 'type': 'track'}})
        self.sp.playlist.return_value = {'name': 'Road Trip', 'uri': 'spotify:playlist:P', 'tracks': {'total': len(items)}}
        self.sp.playlist_items.side_effect = lambda pid, limit, offset, **kw: {'items': items[offset:offset + limit]}
        self.sp.current_playback.return_value = {'device': {'id': 'dev'}, 'progress_ms': 42000, 'is_playing': True}
        self.app = Flask(__name__)
        self.ctx = self.app.app_context()
        self.ctx.push()
        self.addCleanup(self.ctx.pop)

    def test_play_playlist_fetches_every_page_and_sends_an_ordered_list(self):
        self.service.play_item('playlist', 'P', device_id='dev')
        self.assertEqual(self.sp.playlist_items.call_count, 2)
        kwargs = self.sp.start_playback.call_args.kwargs
        self.assertEqual(kwargs['device_id'], 'dev')
        self.assertEqual(kwargs['uris'][0], 'spotify:track:t0')
        self.assertNotIn('spotify:local:x', kwargs['uris'])
        self.assertEqual(kwargs['offset'], {'position': 0})
        self.sp.shuffle.assert_called_with(False, device_id='dev')
        self.assertEqual(self.service.queue.context['name'], 'Road Trip')
        self.assertEqual(len(self.service.queue.context_queue), 149)

    def test_edit_restarts_at_the_same_position(self):
        self.service.play_item('playlist', 'P', device_id='dev')
        self.sp.start_playback.reset_mock()
        uid = self.service.queue.context_queue[0]['uid']
        data = self.service.edit_queue('remove', uid).get_json()
        self.assertEqual(data['next_from'][0]['id'], 't2')
        kwargs = self.sp.start_playback.call_args.kwargs
        self.assertEqual(kwargs['position_ms'], 42000)
        self.assertEqual(kwargs['uris'][1], 'spotify:track:t2')
        self.sp.pause_playback.assert_not_called()

    def test_edit_while_paused_stays_paused(self):
        self.service.play_item('playlist', 'P', device_id='dev')
        self.sp.current_playback.return_value = {'device': {'id': 'dev'}, 'progress_ms': 5000, 'is_playing': False}
        self.service.edit_queue('remove', self.service.queue.context_queue[0]['uid'])
        self.sp.pause_playback.assert_called_once()

    def test_jump_starts_that_song_from_the_beginning(self):
        self.service.play_item('playlist', 'P', device_id='dev')
        uid = self.service.queue.context_queue[4]['uid']
        self.service.edit_queue('play', uid)
        kwargs = self.sp.start_playback.call_args.kwargs
        self.assertEqual(kwargs['uris'][kwargs['offset']['position']], 'spotify:track:t5')
        self.assertEqual(kwargs['position_ms'], 0)

    def test_add_looks_up_the_track_first(self):
        self.service.play_item('playlist', 'P', device_id='dev')
        self.sp.track.side_effect = Exception('invalid id')
        data = self.service.add_to_queue('spotify:track:bogus').get_json()
        self.assertIn('error', data)
        self.assertEqual(self.service.queue.user_queue, [])

    def test_reports_wait_until_spotify_plays_the_sent_list(self):
        self.service.play_item('playlist', 'P', device_id='dev')
        # Spotify is still on the song from before, which is also further down the new list
        self.service.observe_playback('spotify:track:t7', name='Song 7', artist='A')
        self.assertEqual(self.service.queue.current['id'], 't0')
        # Once it reports the sent song, it's followed again
        self.service.observe_playback('spotify:track:t0', name='Song 0', artist='A')
        self.service.observe_playback('spotify:track:t1', name='Song 1', artist='A')
        self.assertEqual(self.service.queue.current['id'], 't1')

    def test_takeover_reported_before_confirmation_is_acted_on_later(self):
        self.service.play_item('playlist', 'P', device_id='dev')
        self.service.observe_playback('spotify:track:t5', 'spotify:playlist:P', context_verified=True)
        self.assertTrue(self.service.queue.active, 'probably the playlist from before the device took over')
        self.service._sent_at -= 60
        self.service.observe_playback('spotify:track:t5', 'spotify:playlist:P', context_verified=True)
        self.assertFalse(self.service.queue.active)

    def test_stale_report_right_after_playing_is_ignored(self):
        self.service.play_item('playlist', 'P', device_id='dev')
        self.sp.current_playback.return_value = {'item': {'uri': 'spotify:track:old'}, 'context': {'uri': 'spotify:playlist:old'}}
        self.service.observe_playback('spotify:track:old', 'spotify:playlist:old')
        self.assertTrue(self.service.queue.active)

    def test_stale_song_right_after_jumping_does_not_move_the_queue_back(self):
        self.service.play_item('playlist', 'P', device_id='dev')
        self.sp.current_playback.return_value = {'device': {'id': 'dev'}, 'progress_ms': 1000, 'is_playing': True,
                                                 'item': {'uri': 'spotify:track:t0'}}
        self.service.edit_queue('play', self.service.queue.context_queue[2]['uid'])
        # Spotify briefly still reports t0, which is now in the window's history
        self.service.observe_playback('spotify:track:t0')
        self.assertEqual(self.service.queue.current['id'], 't3')

    def test_previous_right_after_playing_is_followed(self):
        self.service.play_item('playlist', 'P', device_id='dev')
        self.service.observe_playback('spotify:track:t0')
        self.service.observe_playback('spotify:track:t1')
        self.service.observe_playback('spotify:track:t0')
        self.assertEqual(self.service.queue.current['id'], 't0')

    def test_skip_right_after_an_edit_is_followed(self):
        self.service.play_item('playlist', 'P', device_id='dev')
        self.service.observe_playback('spotify:track:t0')
        self.service.edit_queue('remove', self.service.queue.context_queue[0]['uid'])
        self.service.observe_playback('spotify:track:t0')
        self.service.observe_playback('spotify:track:t2')
        self.assertEqual(self.service.queue.current['id'], 't2')

    def test_edit_catches_up_with_a_skip_the_queue_missed(self):
        self.service.play_item('playlist', 'P', device_id='dev')
        self.service._confirmed = True
        self.sp.current_playback.return_value = {'device': {'id': 'dev'}, 'progress_ms': 1000, 'is_playing': True,
                                                 'item': {'uri': 'spotify:track:t1'}}
        self.service.edit_queue('remove', self.service.queue.context_queue[2]['uid'])
        kwargs = self.sp.start_playback.call_args.kwargs
        self.assertEqual(kwargs['uris'][kwargs['offset']['position']], 'spotify:track:t1')

    def test_report_not_confirmed_by_spotify_is_ignored(self):
        self.service.play_item('playlist', 'P', device_id='dev')
        self.service._confirmed = True
        # The page says another playlist started, but Spotify says our song is playing with no context
        self.sp.current_playback.return_value = {'item': {'uri': 'spotify:track:t0'}, 'context': None}
        self.service.observe_playback('spotify:track:zzz', 'spotify:album:other')
        self.assertTrue(self.service.queue.active)

    def test_same_playlist_started_elsewhere_also_hands_control_back(self):
        self.service.play_item('playlist', 'P', device_id='dev')
        self.service._confirmed = True
        # A phone starts the same playlist at a song that's also in the device's list
        self.service.observe_playback('spotify:track:t5', 'spotify:playlist:P', context_verified=True)
        self.assertFalse(self.service.queue.active)

    def test_playback_started_elsewhere_hands_control_back_to_spotify(self):
        self.service.play_item('playlist', 'P', device_id='dev')
        self.service._confirmed = True
        self.sp.current_playback.return_value = {'item': {'uri': 'spotify:track:zzz'}, 'context': {'uri': 'spotify:album:other'}}
        self.service.observe_playback('spotify:track:zzz', 'spotify:album:other')
        self.assertFalse(self.service.queue.active)
        self.sp.queue.return_value = {'currently_playing': None, 'queue': []}
        self.assertFalse(self.service.get_queue().get_json()['active'])
        self.assertIn('error', self.service.edit_queue('clear').get_json())

    def test_shuffle_and_repeat(self):
        self.service.play_item('playlist', 'P', device_id='dev')
        data = self.service.set_shuffle(True).get_json()
        self.assertTrue(data['shuffle'])
        self.assertNotEqual([t['id'] for t in data['next_from'][:10]], [f't{i}' for i in range(1, 11)])
        self.service.set_repeat('track')
        self.sp.repeat.assert_called_with('track')
        self.assertIn('error', self.service.set_repeat('sometimes').get_json())


if __name__ == '__main__':
    unittest.main()
