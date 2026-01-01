from flask import Flask, render_template, jsonify, request
import os
from app.services.spotify_service import SpotifyService
from app.services.lyrics_service import LyricsService

def create_app():
    # Configure Flask to find templates and static files in app/ directory
    app = Flask(__name__, 
                template_folder='app/templates',
                static_folder='app/static')
    
    # Initialize services
    spotify_service = SpotifyService()
    lyrics_service = LyricsService()
    
    @app.route('/')
    def index():
        return render_template('index.html')
    
    @app.route('/current-track')
    def current_track():
        return spotify_service.get_current_track()
    
    @app.route('/lyrics')
    def get_lyrics():
        track = request.args.get('track')
        artist = request.args.get('artist')
        
        if not track or not artist:
            return jsonify({'lines': []})
        
        return lyrics_service.get_lyrics(track, artist)
    
    return app

if __name__ == '__main__':
    app = create_app()
    app.run(debug=True, host='0.0.0.0', port=5004)  # 0.0.0.0 for Pi deployment
