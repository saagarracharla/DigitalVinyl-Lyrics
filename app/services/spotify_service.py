from concurrent.futures import ThreadPoolExecutor
import json
import os
import threading
import time

from dotenv import load_dotenv
from flask import jsonify
import spotipy
from spotipy.oauth2 import SpotifyOAuth

from app.services.play_queue import PlayQueue, REPEAT_MODES

load_dotenv()

# Shuffle and repeat are remembered across restarts, like in Spotify
PLAYER_STATE_FILE = os.path.join(os.path.dirname(__file__), '..', '..', '.player_state.json')
PAGE_SIZE = 100
MAX_CONTEXT_TRACKS = 5000
# After the device sends a list, Spotify keeps reporting what played before until it switches,
# which can take a few seconds. Stop waiting for it after this long.
CONFIRM_TIMEOUT_S = 8

class SpotifyService:
    def __init__(self):
        self.sp = None
        self.device_id = None
        self._sent_at = 0
        self._confirmed = True    # Spotify has started playing the list the device last sent
        # Requests run on several threads; the queue and the playback commands that follow
        # from it must change together
        self.lock = threading.RLock()
        self.queue = PlayQueue(**self._load_player_state())
        self._initialize_spotify()
    
    def _initialize_spotify(self):
        """Initialize Spotify connection"""
        try:
            self.sp = spotipy.Spotify(auth_manager=SpotifyOAuth(
                client_id=os.getenv('SPOTIFY_CLIENT_ID'),
                client_secret=os.getenv('SPOTIFY_CLIENT_SECRET'),
                redirect_uri=os.getenv('SPOTIFY_REDIRECT_URI'),
                scope='user-read-playback-state user-read-currently-playing user-modify-playback-state user-read-private user-read-email playlist-read-private playlist-read-collaborative user-library-read user-top-read user-read-recently-played streaming'
            ))
            self.sp.current_user()
            print("✅ Spotify connected successfully")
        except Exception as e:
            print(f"❌ Spotify connection failed: {e}")
            self.sp = None
    
    def get_current_track(self):
        """Get the current track, whether playing or paused, on any device"""
        if not self.sp:
            return jsonify({'error': 'Spotify not connected', 'is_playing': False})
        
        try:
            playback = self.sp.current_playback()
            track = playback.get('item') if playback else None
            # Podcast episodes have no album or artists
            if not track or track.get('type') != 'track':
                return jsonify({'is_playing': False})
            
            images = track['album']['images']
            context = playback.get('context') or {}
            self.observe_playback(track['uri'], context.get('uri'), playback.get('progress_ms'),
                                  track['name'], track['artists'][0]['name'] if track['artists'] else None,
                                  context_verified=True)
            return jsonify({
                'track_name': track['name'],
                'artist': track['artists'][0]['name'],
                'artists': ', '.join(a['name'] for a in track['artists']),
                'uri': track['uri'],
                'context_uri': context.get('uri'),
                'progress_ms': playback['progress_ms'],
                'duration_ms': track['duration_ms'],
                'is_playing': playback['is_playing'],
                'album_art': images[0]['url'] if images else None
            })
        except Exception as e:
            return jsonify({'error': str(e), 'is_playing': False})
    
    def play_pause(self):
        """Toggle play/pause"""
        if not self.sp:
            return jsonify({'error': 'Spotify not connected'})
        
        try:
            current = self.sp.current_playback()
            if current and current.get('is_playing'):
                self.sp.pause_playback()
                return jsonify({'action': 'paused'})
            else:
                self.sp.start_playback()
                return jsonify({'action': 'playing'})
        except Exception as e:
            return jsonify({'error': str(e)})
    
    def next_track(self):
        """Skip to next track"""
        if not self.sp:
            return jsonify({'error': 'Spotify not connected'})
        
        try:
            self.sp.next_track()
            return jsonify({'action': 'next'})
        except Exception as e:
            return jsonify({'error': str(e)})
    
    def previous_track(self):
        """Skip to previous track"""
        if not self.sp:
            return jsonify({'error': 'Spotify not connected'})
        
        try:
            self.sp.previous_track()
            return jsonify({'action': 'previous'})
        except Exception as e:
            return jsonify({'error': str(e)})
    
    def seek_to_position(self, position_ms):
        """Seek to specific position in current track"""
        if not self.sp:
            return jsonify({'error': 'Spotify not connected'})
        
        try:
            self.sp.seek_track(position_ms)
            return jsonify({'action': 'seek', 'position_ms': position_ms})
        except Exception as e:
            return jsonify({'error': str(e)})
    
    def get_user_playlists(self, limit=50, offset=0):
        """Get user's playlists"""
        if not self.sp:
            return jsonify({'error': 'Spotify not connected'})
        
        try:
            playlists = self.sp.current_user_playlists(limit=limit, offset=offset)
            return jsonify({
                'items': playlists['items'],
                'total': playlists['total'],
                'limit': playlists['limit'],
                'offset': playlists['offset']
            })
        except Exception as e:
            return jsonify({'error': str(e)})
    
    def get_playlist_tracks(self, playlist_id, limit=50, offset=0):
        """Get tracks from a playlist"""
        if not self.sp:
            return jsonify({'error': 'Spotify not connected'})
        
        try:
            playlist = self.sp.playlist(playlist_id)
            tracks = self.sp.playlist_tracks(playlist_id, limit=limit, offset=offset)
            
            # Extract track objects, filtering out None/null tracks
            track_items = []
            for item in tracks['items']:
                if item and item.get('track'):
                    track = item['track']
                    # Only include tracks that have required fields
                    if track and track.get('id') and track.get('name'):
                        track_items.append(track)
            
            return jsonify({
                'playlist': {
                    'id': playlist['id'],
                    'name': playlist['name'],
                    'description': playlist.get('description', ''),
                    'images': playlist['images'],
                    'owner': playlist['owner']['display_name']
                },
                'tracks': {
                    'items': track_items,
                    'total': tracks['total'],
                    'limit': tracks['limit'],
                    'offset': tracks['offset']
                }
            })
        except Exception as e:
            return jsonify({'error': str(e)})
    
    def get_album_tracks(self, album_id):
        """Get tracks from an album"""
        if not self.sp:
            return jsonify({'error': 'Spotify not connected'})
        
        try:
            album = self.sp.album(album_id)
            tracks = self.sp.album_tracks(album_id)
            return jsonify({
                'album': {
                    'id': album['id'],
                    'name': album['name'],
                    'artists': album['artists'],
                    'images': album['images'],
                    'release_date': album.get('release_date', '')
                },
                'tracks': {
                    'items': tracks['items'],
                    'total': tracks['total']
                }
            })
        except Exception as e:
            return jsonify({'error': str(e)})
    
    def search(self, query, type='track', limit=20):
        """Search for tracks, artists, albums, or playlists"""
        if not self.sp:
            return jsonify({'error': 'Spotify not connected'})
        
        try:
            results = self.sp.search(q=query, type=type, limit=limit)
            return jsonify(results)
        except Exception as e:
            return jsonify({'error': str(e)})
    
    def play_item(self, item_type, item_id, context_uri=None, device_id=None):
        """Play a track, album, or playlist through the device's own queue"""
        if not self.sp:
            return jsonify({'error': 'Spotify not connected'})

        if context_uri and not item_id:
            # e.g. spotify:playlist:37i9dQZF1DXcBWIGoYBM5M
            parts = context_uri.split(':')
            item_type, item_id = (parts[1], parts[2]) if len(parts) == 3 else (None, None)
        if item_type not in ('track', 'album', 'playlist') or not item_id:
            return jsonify({'error': 'Invalid item type or context_uri'})

        try:
            tracks, context = self._fetch_tracks(item_type, item_id)
            if not tracks:
                return jsonify({'error': 'Nothing playable in that ' + item_type})
            with self.lock:
                if device_id:
                    self.device_id = device_id
                self.queue.load(tracks, context)
                # Spotify's own shuffle would reorder our list, so the device shuffles instead.
                # Turn it off first so the list starts in our order; that fails when no device is
                # active yet, so turn it off again once playback has started.
                try:
                    self.sp.shuffle(False, device_id=device_id)
                except Exception:
                    pass
                self._send_window(device_id)
                self.sp.shuffle(False, device_id=device_id)
                self.sp.repeat('track' if self.queue.repeat == 'track' else 'off', device_id=device_id)
            return jsonify({'action': 'playing', 'type': item_type, 'id': item_id})
        except Exception as e:
            return jsonify({'error': str(e)})

    def _fetch_tracks(self, item_type, item_id):
        """All playable tracks of a playlist, album or single track, plus the context they came from"""
        if item_type == 'track':
            return [self._summarize_track(self.sp.track(item_id))], None

        if item_type == 'album':
            album = self.sp.album(item_id)
            page = album['tracks']
            items = list(page['items'])
            while page.get('next'):
                page = self.sp.next(page)
                items.extend(page['items'])
            # Album tracks don't repeat the album's name and cover, so add them back
            tracks = [self._summarize_track(dict(t, album=album)) for t in items if t and t.get('uri')]
            return tracks, {'type': 'album', 'uri': album['uri'], 'name': album['name']}

        playlist = self.sp.playlist(item_id, fields='name,uri,tracks.total')
        total = min(playlist['tracks']['total'], MAX_CONTEXT_TRACKS)
        fields = 'items(is_local,track(id,uri,name,type,duration_ms,artists(name),album(name,images)))'

        def page(offset):
            return self.sp.playlist_items(item_id, limit=PAGE_SIZE, offset=offset, fields=fields,
                                          additional_types=('track',))['items']

        # Big playlists take many pages; fetch them in parallel so playback starts quickly
        with ThreadPoolExecutor(max_workers=4) as pool:
            pages = list(pool.map(page, range(0, total, PAGE_SIZE)))
        tracks = [
            self._summarize_track(item['track'])
            for items in pages for item in items
            # Local files and podcast episodes can't be played through the Web API
            if item and not item.get('is_local') and item.get('track')
            and item['track'].get('type') == 'track' and item['track'].get('id')
        ]
        return tracks, {'type': 'playlist', 'uri': playlist['uri'], 'name': playlist['name']}

    def _send_window(self, device_id=None, position_ms=0, paused=False):
        """Hand Spotify the queue's upcoming tracks, continuing from the current one"""
        uris, offset = self.queue.build_window()
        self._start(uris, offset, device_id, position_ms, paused)

    def _start(self, uris, offset, device_id=None, position_ms=0, paused=False):
        self.sp.start_playback(device_id=device_id or self.device_id, uris=uris,
                               offset={'position': offset}, position_ms=position_ms)
        self._sent_at = time.monotonic()
        self._confirmed = False
        if paused:
            self.sp.pause_playback(device_id=device_id or self.device_id)

    def _resync_after_edit(self, restart_current=False):
        """Send Spotify the edited queue, keeping the current song's position and play/pause state"""
        if not self.queue.active:
            return
        playback = self.sp.current_playback()
        if not playback or not playback.get('device'):
            return
        device_id = playback['device']['id']
        item = playback.get('item') or {}
        playing_uri = item.get('uri')
        if restart_current:
            # A different song is now current; start it from the beginning
            self._send_window(device_id, 0, paused=not playback['is_playing'])
            return
        # Catch up with any skips the queue hasn't heard about yet, so the list re-sent below
        # continues from the song that's really playing
        if playing_uri and self._accept_report(playing_uri, item.get('name')):
            self.queue.observe(playing_uri, *self._name_artist(item))
        window = self.queue.rebuild_window_if_changed()
        if window:
            self._start(*window, device_id, playback.get('progress_ms') or 0, paused=not playback['is_playing'])

    def observe_playback(self, uri, context_uri=None, position_ms=0, name=None, artist=None, context_verified=False):
        """Keep the queue in step with what Spotify is playing.

        The device hands Spotify a plain list of songs, which has no playlist or album context, so
        a context means another app started playback. Reports from the page aren't trusted for
        this (context_verified=False) and are checked with Spotify first.
        """
        if not uri:
            return
        with self.lock:
            if not self.queue.active:
                return
            if not self._accept_report(uri, name):
                return
            if context_uri and (context_verified or self._playback_started_elsewhere()):
                # Spotify's own queue is in charge now
                self.queue.active = False
                return
            moved = self.queue.observe(uri, name, artist)
            if moved and self.queue.needs_refill():
                self._send_window(None, position_ms or 0)

    def _accept_report(self, uri, name=None):
        """Whether to act on a report of what Spotify is playing. After the device sends a list,
        reports describe what played before it until Spotify confirms the new current song."""
        if self._confirmed:
            return True
        current = self.queue.current or {}
        if uri == current.get('uri') or (name and name == current.get('name')):
            self._confirmed = True
        elif time.monotonic() - self._sent_at > CONFIRM_TIMEOUT_S:
            # Spotify went somewhere else (e.g. a very quick skip); follow it from here
            self._confirmed = True
            return True
        return False

    def _playback_started_elsewhere(self):
        """Confirm with Spotify that another app started a playlist or album, rather than trusting
        a report that may predate the device's own list"""
        playback = self.sp.current_playback() or {}
        return bool((playback.get('context') or {}).get('uri'))

    @staticmethod
    def _name_artist(item):
        artists = item.get('artists') or []
        return item.get('name'), artists[0]['name'] if artists else None

    def get_user_saved_albums(self, limit=50, offset=0):
        """Get user's saved albums"""
        if not self.sp:
            return jsonify({'error': 'Spotify not connected'})
        
        try:
            albums = self.sp.current_user_saved_albums(limit=limit, offset=offset)
            return jsonify({
                'items': [item['album'] for item in albums['items']],
                'total': albums['total'],
                'limit': albums['limit'],
                'offset': albums['offset']
            })
        except Exception as e:
            return jsonify({'error': str(e)})
    
    def get_recently_played(self, limit=50):
        """Get recently played tracks"""
        if not self.sp:
            return jsonify({'error': 'Spotify not connected'})
        
        try:
            recent = self.sp.current_user_recently_played(limit=limit)
            return jsonify({
                'items': [item['track'] for item in recent['items']],
                'cursors': recent.get('cursors', {})
            })
        except Exception as e:
            return jsonify({'error': str(e)})
    
    def get_queue(self):
        """The queue as Spotify shows it: now playing, "Next in queue" and "Next from" """
        if not self.sp:
            return jsonify({'error': 'Spotify not connected'})

        try:
            with self.lock:
                if self.queue.active:
                    return jsonify(self.queue.to_json())
            # Playback was started elsewhere: show Spotify's own queue, which can't be edited
            data = self.sp.queue()
            playback = self.sp.current_playback() or {}
            current = data.get('currently_playing')
            return jsonify({
                'active': False,
                'shuffle': playback.get('shuffle_state', False),
                'repeat': playback.get('repeat_state', 'off'),
                'context': None,
                'current': self._summarize_track(current) if current else None,
                'next_in_queue': [],
                # Episodes and local files in the queue lack track fields
                'next_from': [self._summarize_track(t) for t in data.get('queue', []) if t and t.get('album')],
            })
        except Exception as e:
            return jsonify({'error': str(e)})

    def add_to_queue(self, track_uri, play_next=False):
        """Add a song to "Next in queue" (or to the front of it with play_next)"""
        if not self.sp:
            return jsonify({'error': 'Spotify not connected'})

        try:
            # Spotify accepts unknown URIs without complaint, so look the track up first
            track = self._summarize_track(self.sp.track(track_uri))
            with self.lock:
                if not self.queue.active:
                    self.sp.add_to_queue(track['uri'])
                    return jsonify({'success': True, 'track_uri': track['uri']})
                self.queue.add(track, play_next=play_next)
                self._resync_after_edit()
                return jsonify(self.queue.to_json())
        except Exception as e:
            return jsonify({'error': str(e)})

    def edit_queue(self, action, uid=None, index=None):
        """Remove, move, jump to, or clear queue entries"""
        if not self.sp:
            return jsonify({'error': 'Spotify not connected'})

        try:
            with self.lock:
                if not self.queue.active:
                    return jsonify({'error': 'This queue was started on another device and can\'t be edited here'})
                if action == 'remove':
                    self.queue.remove(uid)
                elif action == 'move':
                    self.queue.move(uid, int(index))
                elif action == 'clear':
                    self.queue.clear_user_queue()
                elif action == 'play':
                    self.queue.jump(uid)
                else:
                    return jsonify({'error': f'Unknown queue action: {action}'})
                self._resync_after_edit(restart_current=action == 'play')
                return jsonify(self.queue.to_json())
        except KeyError:
            return jsonify({'error': 'That song is no longer in the queue'})
        except Exception as e:
            return jsonify({'error': str(e)})

    def _summarize_track(self, track):
        album = track.get('album') or {}
        images = album.get('images') or []
        return {
            'id': track.get('id'),
            'uri': track.get('uri'),
            'name': track.get('name'),
            'artists': [a['name'] for a in track.get('artists', [])],
            'album': album.get('name'),
            'album_art': images[0]['url'] if images else None,
            'duration_ms': track.get('duration_ms')
        }
    
    def set_shuffle(self, state, device_id=None):
        """Shuffle the rest of the playlist (the device's queue), or Spotify's when it's in charge"""
        if not self.sp:
            return jsonify({'error': 'Spotify not connected'})

        try:
            with self.lock:
                self.queue.shuffle = bool(state)
                self._save_player_state()
                if not self.queue.active:
                    self.sp.shuffle(bool(state), device_id=device_id)
                    return jsonify({'success': True, 'shuffle': bool(state)})
                self.queue.set_shuffle(state)
                self._resync_after_edit()
                return jsonify(self.queue.to_json())
        except Exception as e:
            return jsonify({'error': str(e)})

    def set_repeat(self, state):
        """Set repeat: off, context (the whole playlist) or track"""
        if not self.sp:
            return jsonify({'error': 'Spotify not connected'})
        if state not in REPEAT_MODES:
            return jsonify({'error': f'Invalid repeat mode: {state}'})

        try:
            with self.lock:
                self.queue.repeat = state
                self._save_player_state()
                if not self.queue.active:
                    self.sp.repeat(state)
                    return jsonify({'success': True, 'repeat': state})
                # The device repeats the playlist itself; Spotify only handles repeating one song
                self.sp.repeat('track' if state == 'track' else 'off')
                self.queue.set_repeat(state)
                self._resync_after_edit()
                return jsonify(self.queue.to_json())
        except Exception as e:
            return jsonify({'error': str(e)})

    def _load_player_state(self):
        try:
            with open(PLAYER_STATE_FILE) as f:
                saved = json.load(f)
            repeat = saved.get('repeat') if saved.get('repeat') in REPEAT_MODES else 'off'
            return {'shuffle': saved.get('shuffle') is True, 'repeat': repeat}
        except (OSError, ValueError):
            return {'shuffle': False, 'repeat': 'off'}

    def _save_player_state(self):
        try:
            with open(PLAYER_STATE_FILE, 'w') as f:
                json.dump({'shuffle': self.queue.shuffle, 'repeat': self.queue.repeat}, f)
        except OSError as e:
            print(f"Couldn't save player state: {e}")
