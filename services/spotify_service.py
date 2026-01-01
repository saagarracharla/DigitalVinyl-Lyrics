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
        """Initialize Spotify connection with environment variables"""
        try:
            self.sp = spotipy.Spotify(auth_manager=SpotifyOAuth(
                client_id=os.getenv('SPOTIFY_CLIENT_ID'),
                client_secret=os.getenv('SPOTIFY_CLIENT_SECRET'),
                redirect_uri=os.getenv('SPOTIFY_REDIRECT_URI'),
                scope='user-read-playback-state user-read-currently-playing'
            ))
            self.sp.current_user()
            print("✅ Spotify connected successfully")
        except Exception as e:
            print(f"❌ Spotify connection failed: {e}")
            self.sp = None
    
    def get_current_track(self):
        """Get current playing track with timing information"""
        if not self.sp:
            return jsonify({'error': 'Spotify not connected'})
        
        try:
            current = self.sp.current_playback()
            if not current or not current.get('is_playing'):
                return jsonify({'playing': False})
            
            track = current['item']
            return jsonify({
                'playing': True,
                'artist': track['artists'][0]['name'],
                'title': track['name'],
                'progress_ms': current['progress_ms'],
                'duration_ms': track['duration_ms'],
                'timestamp': current['timestamp']
            })
        except Exception as e:
            return jsonify({'error': str(e)})
