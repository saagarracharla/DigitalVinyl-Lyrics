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
    
    @app.route('/test')
    def test():
        return render_template('test.html')
    
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
    
    @app.route('/play-pause', methods=['POST'])
    def play_pause():
        return spotify_service.play_pause()
    
    @app.route('/next-track', methods=['POST'])
    def next_track():
        return spotify_service.next_track()
    
    @app.route('/previous-track', methods=['POST'])
    def previous_track():
        return spotify_service.previous_track()
    
    @app.route('/seek', methods=['POST'])
    def seek():
        position_ms = request.json.get('position_ms', 0)
        return spotify_service.seek_to_position(position_ms)
    
    # Browsing endpoints
    @app.route('/api/playlists')
    def get_playlists():
        limit = request.args.get('limit', 50, type=int)
        offset = request.args.get('offset', 0, type=int)
        return spotify_service.get_user_playlists(limit=limit, offset=offset)
    
    @app.route('/api/playlist/<playlist_id>/tracks')
    def get_playlist_tracks(playlist_id):
        limit = request.args.get('limit', 50, type=int)
        offset = request.args.get('offset', 0, type=int)
        return spotify_service.get_playlist_tracks(playlist_id, limit=limit, offset=offset)
    
    @app.route('/api/album/<album_id>')
    def get_album(album_id):
        return spotify_service.get_album_tracks(album_id)
    
    @app.route('/api/search')
    def search():
        query = request.args.get('q', '')
        search_type = request.args.get('type', 'track')
        limit = request.args.get('limit', 20, type=int)
        if not query:
            return jsonify({'error': 'Query parameter required'})
        return spotify_service.search(query, type=search_type, limit=limit)
    
    @app.route('/api/play', methods=['POST'])
    def play():
        data = request.json
        item_type = data.get('type')  # 'track', 'album', 'playlist'
        item_id = data.get('id')
        context_uri = data.get('context_uri')
        track_uris = data.get('track_uris')  # Array of track URIs for queue
        return spotify_service.play_item(item_type, item_id, context_uri, track_uris)
    
    @app.route('/api/queue', methods=['GET'])
    def get_queue():
        return spotify_service.get_queue()
    
    @app.route('/api/queue/add', methods=['POST'])
    def add_to_queue():
        data = request.json
        track_uri = data.get('track_uri')
        if not track_uri:
            return jsonify({'error': 'track_uri required'})
        return spotify_service.add_to_queue(track_uri)
    
    @app.route('/api/shuffle', methods=['PUT'])
    def set_shuffle():
        data = request.json
        state = data.get('state', False)
        return spotify_service.set_shuffle(state)
    
    @app.route('/api/repeat', methods=['PUT'])
    def set_repeat():
        data = request.json
        state = data.get('state', 'off')  # 'off', 'track', 'context'
        return spotify_service.set_repeat(state)
    
    @app.route('/api/albums')
    def get_saved_albums():
        limit = request.args.get('limit', 50, type=int)
        offset = request.args.get('offset', 0, type=int)
        return spotify_service.get_user_saved_albums(limit=limit, offset=offset)
    
    @app.route('/api/recently-played')
    def get_recently_played():
        limit = request.args.get('limit', 50, type=int)
        return spotify_service.get_recently_played(limit=limit)
    
    # Web Playback SDK endpoints
    @app.route('/api/access-token')
    def get_access_token():
        """Get access token for Web Playback SDK"""
        try:
            if not spotify_service.sp:
                return jsonify({'error': 'Spotify not connected'}), 500
            
            # Get cached token
            token_info = spotify_service.sp.auth_manager.get_cached_token()
            
            # Check if token exists and is not expired
            if token_info and not spotify_service.sp.auth_manager.is_token_expired(token_info):
                return jsonify({'access_token': token_info['access_token']})
            
            # If no token or expired, get a new one
            # This will trigger auth flow if needed
            token = spotify_service.sp.auth_manager.get_access_token(as_dict=False)
            if token:
                return jsonify({'access_token': token})
            else:
                return jsonify({'error': 'Failed to get access token'}), 500
        except Exception as e:
            return jsonify({'error': str(e)}), 500
    
    @app.route('/api/transfer-playback', methods=['PUT'])
    def transfer_playback():
        """Transfer playback to Web Playback SDK device"""
        try:
            data = request.json
            device_ids = data.get('device_ids', [])
            if device_ids:
                spotify_service.sp.transfer_playback(device_ids[0], force_play=False)
                return jsonify({'success': True})
            return jsonify({'error': 'No device IDs provided'}), 400
        except Exception as e:
            return jsonify({'error': str(e)}), 500
    
    return app

if __name__ == '__main__':
    app = create_app()
    app.run(debug=True, host='0.0.0.0', port=5004)  # 0.0.0.0 for Pi deployment
