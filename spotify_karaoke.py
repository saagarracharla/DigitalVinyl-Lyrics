from flask import Flask, jsonify, request
import spotipy
from spotipy.oauth2 import SpotifyOAuth
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = Flask(__name__)

# Spotify connection with environment variables
try:
    sp = spotipy.Spotify(auth_manager=SpotifyOAuth(
        client_id=os.getenv('SPOTIFY_CLIENT_ID'),
        client_secret=os.getenv('SPOTIFY_CLIENT_SECRET'),
        redirect_uri=os.getenv('SPOTIFY_REDIRECT_URI'),
        scope='user-read-playback-state user-read-currently-playing'
    ))
    sp.current_user()
    print("✅ Spotify connected successfully")
except Exception as e:
    print(f"❌ Spotify connection failed: {e}")
    print("Make sure your .env file has the correct Spotify credentials")
    sp = None

@app.route('/')
def index():
    return '''
<!DOCTYPE html>
<html>
<head>
    <title>🎤 Spotify Karaoke</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap');
        
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body { 
            font-family: 'Inter', sans-serif;
            background: linear-gradient(135deg, #1ed760 0%, #1db954 25%, #191414 75%, #000000 100%);
            color: white;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 20px;
        }
        
        .container { max-width: 900px; width: 100%; display: flex; flex-direction: column; align-items: center; gap: 30px; }
        
        .header { text-align: center; margin-top: 40px; }
        .header h1 { font-size: 3.5rem; font-weight: 700; background: linear-gradient(45deg, #1ed760, #ffffff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 10px; }
        
        .track-info { 
            background: rgba(0,0,0,0.7); backdrop-filter: blur(20px); padding: 30px 40px; border-radius: 20px; 
            border: 1px solid rgba(255,255,255,0.1); text-align: center; width: 100%; box-shadow: 0 20px 40px rgba(0,0,0,0.3);
        }
        
        .track-name { font-size: 2rem; font-weight: 600; margin-bottom: 8px; }
        .artist-name { font-size: 1.2rem; color: #b3b3b3; font-weight: 300; margin-bottom: 20px; }
        
        .progress-bar { width: 100%; height: 6px; background: rgba(255,255,255,0.2); border-radius: 3px; margin: 20px 0; }
        .progress { height: 100%; background: linear-gradient(90deg, #1ed760, #1db954); width: 0%; transition: width 0.1s ease; border-radius: 3px; }
        
        .lyrics-container {
            background: rgba(0,0,0,0.6); backdrop-filter: blur(15px); padding: 40px; border-radius: 25px;
            border: 1px solid rgba(255,255,255,0.1); width: 100%; min-height: 300px; display: flex;
            flex-direction: column; justify-content: center; align-items: center; text-align: center;
        }
        
        .current-line { font-size: 2.8rem; font-weight: 600; line-height: 1.2; margin-bottom: 20px; transition: all 0.3s ease; }
        .next-line { font-size: 1.8rem; font-weight: 400; opacity: 0.6; line-height: 1.3; }
        
        .highlighted-word { color: #1ed760; text-shadow: 0 0 15px rgba(30, 215, 96, 0.8); font-weight: 700; }
        .upcoming-word { opacity: 0.4; }
        
        .status { position: absolute; top: 20px; right: 20px; padding: 8px 16px; background: rgba(30, 215, 96, 0.2); border: 1px solid #1ed760; border-radius: 20px; font-size: 0.9rem; }
    </style>
</head>
<body>
    <div class="status" id="status">🎵 Loading...</div>
    
    <div class="container">
        <div class="header">
            <h1>🎤 Spotify Karaoke</h1>
        </div>
        
        <div class="track-info">
            <div class="track-name" id="trackName">Start playing a song on Spotify!</div>
            <div class="artist-name" id="artistName"></div>
            <div class="progress-bar">
                <div class="progress" id="progress"></div>
            </div>
        </div>
        
        <div class="lyrics-container">
            <div class="current-line" id="currentLine">🎵 Your lyrics will appear here</div>
            <div class="next-line" id="nextLine"></div>
        </div>
    </div>

    <script>
        let lyrics = [];
        let currentTrackId = null;

        async function updateAll() {
            try {
                const response = await fetch('/current-track');
                const data = await response.json();
                
                if (data.is_playing) {
                    document.getElementById('trackName').textContent = data.track_name;
                    document.getElementById('artistName').textContent = `by ${data.artist}`;
                    document.getElementById('status').textContent = '🎵 Playing';
                    
                    const progress = (data.progress_ms / data.duration_ms) * 100;
                    document.getElementById('progress').style.width = progress + '%';
                    
                    if (currentTrackId !== data.track_name) {
                        currentTrackId = data.track_name;
                        await loadLyrics(data.track_name, data.artist);
                    }
                    
                    updateLyrics(data.progress_ms);
                } else {
                    document.getElementById('status').textContent = '⏸️ Paused';
                }
            } catch (error) {
                document.getElementById('status').textContent = '❌ Error';
            }
        }

        async function loadLyrics(track, artist) {
            try {
                const response = await fetch(`/lyrics?track=${encodeURIComponent(track)}&artist=${encodeURIComponent(artist)}`);
                const data = await response.json();
                lyrics = data.lines || [];
            } catch (error) {
                lyrics = [];
            }
        }

        function updateLyrics(progressMs) {
            if (lyrics.length === 0) {
                document.getElementById('currentLine').innerHTML = '🎵 No lyrics available';
                document.getElementById('nextLine').innerHTML = '';
                return;
            }

            let currentLineIndex = -1;
            
            for (let i = 0; i < lyrics.length; i++) {
                const lineTime = lyrics[i].startTimeMs;
                const nextLineTime = i + 1 < lyrics.length ? lyrics[i + 1].startTimeMs : lineTime + 8000;
                
                if (progressMs >= lineTime && progressMs < nextLineTime) {
                    currentLineIndex = i;
                    break;
                }
            }
            
            if (currentLineIndex >= 0) {
                const currentLyric = lyrics[currentLineIndex];
                const nextLyric = currentLineIndex + 1 < lyrics.length ? lyrics[currentLineIndex + 1] : null;
                
                const words = currentLyric.words.split(' ');
                const nextLineTime = nextLyric ? nextLyric.startTimeMs : currentLyric.startTimeMs + 6000;
                const lineDuration = nextLineTime - currentLyric.startTimeMs;
                const wordDuration = lineDuration / words.length;
                const lineProgress = progressMs - currentLyric.startTimeMs;
                const currentWordIndex = Math.floor(lineProgress / wordDuration);
                
                let highlightedLine = '';
                words.forEach((word, index) => {
                    if (index <= currentWordIndex) {
                        highlightedLine += `<span class="highlighted-word">${word}</span> `;
                    } else {
                        highlightedLine += `<span class="upcoming-word">${word}</span> `;
                    }
                });
                
                document.getElementById('currentLine').innerHTML = highlightedLine;
                document.getElementById('nextLine').innerHTML = nextLyric ? nextLyric.words : '';
            } else {
                if (progressMs < lyrics[0].startTimeMs) {
                    document.getElementById('currentLine').innerHTML = '🎵 Music starting...';
                    document.getElementById('nextLine').innerHTML = lyrics[0].words;
                } else {
                    document.getElementById('currentLine').innerHTML = '🎤 Song continues...';
                    document.getElementById('nextLine').innerHTML = '';
                }
            }
        }

        setInterval(updateAll, 500);
        updateAll();
    </script>
</body>
</html>
    '''

@app.route('/current-track')
def current_track():
    if not sp:
        return jsonify({'error': 'Spotify not connected', 'is_playing': False})
    
    try:
        playback = sp.current_playback()
        if playback and playback.get('is_playing'):
            track = playback['item']
            return jsonify({
                'track_name': track['name'],
                'artist': track['artists'][0]['name'],
                'progress_ms': playback['progress_ms'],
                'duration_ms': track['duration_ms'],
                'is_playing': True
            })
        return jsonify({'is_playing': False})
    except Exception as e:
        return jsonify({'error': str(e), 'is_playing': False})

@app.route('/lyrics')
def get_lyrics():
    track = request.args.get('track')
    artist = request.args.get('artist')
    
    if not track or not artist:
        return jsonify({'lines': []})
    
    lyrics = fetch_lyrics(track, artist)
    return jsonify({'lines': lyrics})

def fetch_lyrics(track, artist):
    try:
        import requests
        url = "https://lrclib.net/api/search"
        params = {'artist_name': artist, 'track_name': track}
        
        response = requests.get(url, params=params, timeout=10)
        if response.status_code == 200:
            data = response.json()
            if data and len(data) > 0:
                track_data = data[0]
                if track_data.get('syncedLyrics'):
                    return parse_lrc_content(track_data['syncedLyrics'])
    except Exception as e:
        print(f"Lyrics error: {e}")
    
    return [{'startTimeMs': 0, 'words': f'🎵 No lyrics found for {track}'}]

def parse_lrc_content(lrc_text):
    lines = []
    for line in lrc_text.split('\n'):
        if '[' in line and ']' in line and ':' in line:
            try:
                time_part = line.split(']')[0][1:]
                text_part = line.split(']')[1].strip()
                
                if ':' in time_part and text_part:
                    minutes, seconds = time_part.split(':')
                    ms = int(float(minutes) * 60000 + float(seconds) * 1000)
                    lines.append({'startTimeMs': ms, 'words': text_part})
            except:
                continue
    return lines

if __name__ == '__main__':
    print("🎤 Starting Spotify Karaoke...")
    print("Visit: http://127.0.0.1:5004")
    app.run(debug=True, port=5004, host='127.0.0.1')
