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
                scope='user-read-playback-state user-read-currently-playing user-modify-playback-state'
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
