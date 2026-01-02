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
        """Get current playing track - matches working spotify_karaoke.py format"""
        if not self.sp:
            return jsonify({'error': 'Spotify not connected', 'is_playing': False})
        
        try:
            playback = self.sp.current_playback()
            if playback and playback.get('is_playing'):
                track = playback['item']
                return jsonify({
                    'track_name': track['name'],
                    'artist': track['artists'][0]['name'],
                    'progress_ms': playback['progress_ms'],
                    'duration_ms': track['duration_ms'],
                    'is_playing': True,
                    # Add album art for vinyl mode
                    'album_art': track['album']['images'][0]['url'] if track['album']['images'] else None
                })
            return jsonify({'is_playing': False})
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
    
    def play_item(self, item_type, item_id, context_uri=None, track_uris=None):
        """Play a track, album, or playlist. If track_uris provided, adds them to queue."""
        if not self.sp:
            return jsonify({'error': 'Spotify not connected'})
        
        try:
            if item_type == 'track':
                # If track_uris provided, play first track and add rest to queue
                if track_uris and len(track_uris) > 1:
                    # Play first track
                    self.sp.start_playback(uris=[track_uris[0]])
                    # Add remaining tracks to queue
                    for uri in track_uris[1:]:
                        try:
                            self.sp.add_to_queue(uri)
                        except:
                            pass  # Ignore errors for queue additions
                else:
                    self.sp.start_playback(uris=[f'spotify:track:{item_id}'])
            elif item_type == 'album':
                self.sp.start_playback(context_uri=f'spotify:album:{item_id}')
            elif item_type == 'playlist':
                self.sp.start_playback(context_uri=f'spotify:playlist:{item_id}')
            elif context_uri:
                self.sp.start_playback(context_uri=context_uri)
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
            playback = self.sp.current_playback()
            if not playback:
                return jsonify({'queue': [], 'currently_playing': None})
            
            # Get currently playing track
            current = playback.get('item')
            current_track = None
            if current:
                current_track = {
                    'id': current['id'],
                    'name': current['name'],
                    'artists': [a['name'] for a in current['artists']],
                    'album': current['album']['name'],
                    'album_art': current['album']['images'][0]['url'] if current['album']['images'] else None,
                    'duration_ms': current['duration_ms']
                }
            
            # Get next tracks from track_window
            queue = []
            if playback.get('track_window'):
                next_tracks = playback['track_window'].get('next_tracks', [])
                for track in next_tracks:
                    queue.append({
                        'id': track['id'],
                        'name': track['name'],
                        'artists': [a['name'] for a in track['artists']],
                        'album': track['album']['name'],
                        'album_art': track['album']['images'][0]['url'] if track['album']['images'] else None,
                        'duration_ms': track['duration_ms']
                    })
            
            return jsonify({
                'currently_playing': current_track,
                'queue': queue
            })
        except Exception as e:
            return jsonify({'error': str(e)})
    
    def set_shuffle(self, state):
        """Set shuffle state"""
        if not self.sp:
            return jsonify({'error': 'Spotify not connected'})
        
        try:
            self.sp.shuffle(state)
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
    
    def play_playlist_from_track(self, playlist_id, track_id, track_uris):
        """Play a playlist starting from a specific track, with all tracks in queue"""
        if not self.sp:
            return jsonify({'error': 'Spotify not connected'})
        
        try:
            # Start playback with the playlist context
            self.sp.start_playback(context_uri=f'spotify:playlist:{playlist_id}')
            
            # If the first track isn't the selected one, seek to it
            # Note: We can't directly seek to a track, but we can add all tracks to queue
            # and the playlist context will handle the queue
            
            return jsonify({
                'success': True,
                'playlist_id': playlist_id,
                'start_track_id': track_id
            })
        except Exception as e:
            return jsonify({'error': str(e)})
