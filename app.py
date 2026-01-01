from flask import Flask, render_template
from services.spotify_service import SpotifyService
from services.lyrics_service import LyricsService

app = Flask(__name__)

# Initialize services
spotify_service = SpotifyService()
lyrics_service = LyricsService()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/current-track')
def current_track():
    return spotify_service.get_current_track()

@app.route('/lyrics/<artist>/<title>')
def get_lyrics(artist, title):
    return lyrics_service.get_lyrics(artist, title)

if __name__ == '__main__':
    app.run(debug=True, host='127.0.0.1', port=5004)
