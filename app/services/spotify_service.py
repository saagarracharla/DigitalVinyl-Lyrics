from flask import jsonify
import spotipy
from spotipy.oauth2 import SpotifyOAuth
import os
from dotenv import load_dotenv

load_dotenv()

class SpotifyService:
    def __init__(self):
        self.sp = None
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
        """Play a track, album, or playlist"""
        if not self.sp:
            return jsonify({'error': 'Spotify not connected'})
        
        try:
            if item_type == 'track':
                self.sp.start_playback(device_id=device_id, uris=[f'spotify:track:{item_id}'])
            elif item_type == 'album':
                self.sp.start_playback(device_id=device_id, context_uri=f'spotify:album:{item_id}')
            elif item_type == 'playlist':
                self.sp.start_playback(device_id=device_id, context_uri=f'spotify:playlist:{item_id}')
            elif context_uri:
                self.sp.start_playback(device_id=device_id, context_uri=context_uri)
            else:
                return jsonify({'error': 'Invalid item type or context_uri'})
            
            return jsonify({'action': 'playing', 'type': item_type, 'id': item_id})
        except Exception as e:
            return jsonify({'error': str(e)})
    
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
    
    def add_to_queue(self, track_uri):
        """Add a track to the queue"""
        if not self.sp:
            return jsonify({'error': 'Spotify not connected'})
        
        try:
            self.sp.add_to_queue(track_uri)
            return jsonify({'success': True, 'track_uri': track_uri})
        except Exception as e:
            return jsonify({'error': str(e)})
    
    def get_queue(self):
        """Get current queue (currently playing + next tracks)"""
        if not self.sp:
            return jsonify({'error': 'Spotify not connected'})
        
        try:
            data = self.sp.queue()
            current = data.get('currently_playing')
            return jsonify({
                'currently_playing': self._summarize_track(current) if current else None,
                # Episodes and local files in the queue lack track fields
                'queue': [self._summarize_track(t) for t in data.get('queue', []) if t and t.get('album')]
            })
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
        """Set shuffle state"""
        if not self.sp:
            return jsonify({'error': 'Spotify not connected'})
        
        try:
            self.sp.shuffle(state, device_id=device_id)
            return jsonify({'success': True, 'shuffle': state})
        except Exception as e:
            return jsonify({'error': str(e)})
    
    def set_repeat(self, state):
        """Set repeat state (off, track, context)"""
        if not self.sp:
            return jsonify({'error': 'Spotify not connected'})
        
        try:
            self.sp.repeat(state)
            return jsonify({'success': True, 'repeat': state})
        except Exception as e:
            return jsonify({'error': str(e)})
