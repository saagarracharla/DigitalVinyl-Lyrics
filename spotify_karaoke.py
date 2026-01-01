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
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Playfair+Display:wght@400;500;600;700;800;900&display=swap');
        
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body { 
            font-family: 'Inter', sans-serif;
            background: linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 25%, #2d2d2d 75%, #000000 100%);
            color: white;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 20px;
            overflow-x: hidden;
        }
        
        .container { 
            max-width: 1200px; 
            width: 100%; 
            display: flex; 
            flex-direction: column; 
            align-items: center; 
            gap: 40px; 
        }
        
        .header { 
            text-align: center; 
            margin-top: 40px; 
            position: relative;
        }
        
        .header h1 { 
            font-family: 'Playfair Display', serif;
            font-size: 4rem; 
            font-weight: 800; 
            background: linear-gradient(45deg, #ff6b6b, #4ecdc4, #45b7d1, #96ceb4, #feca57);
            background-size: 300% 300%;
            -webkit-background-clip: text; 
            -webkit-text-fill-color: transparent; 
            margin-bottom: 10px;
            animation: gradientShift 8s ease-in-out infinite;
            text-shadow: 0 0 30px rgba(255, 255, 255, 0.1);
        }
        
        @keyframes gradientShift {
            0%, 100% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
        }
        
        .track-info { 
            background: rgba(0,0,0,0.8); 
            backdrop-filter: blur(30px); 
            padding: 30px 50px; 
            border-radius: 25px; 
            border: 1px solid rgba(255,255,255,0.1); 
            text-align: center; 
            width: 100%; 
            box-shadow: 0 25px 50px rgba(0,0,0,0.5);
            position: relative;
            overflow: hidden;
        }
        
        .track-info::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent);
            animation: shimmer 3s infinite;
        }
        
        @keyframes shimmer {
            0% { left: -100%; }
            100% { left: 100%; }
        }
        
        .track-name { 
            font-family: 'Playfair Display', serif;
            font-size: 2.5rem; 
            font-weight: 700; 
            margin-bottom: 10px; 
            color: #ffffff;
            text-shadow: 0 2px 10px rgba(0,0,0,0.5);
        }
        
        .artist-name { 
            font-size: 1.4rem; 
            color: #b3b3b3; 
            font-weight: 400; 
            margin-bottom: 25px; 
            letter-spacing: 0.5px;
        }
        
        .progress-bar { 
            width: 100%; 
            height: 8px; 
            background: rgba(255,255,255,0.1); 
            border-radius: 4px; 
            margin: 25px 0; 
            overflow: hidden;
            box-shadow: inset 0 2px 4px rgba(0,0,0,0.3);
        }
        
        .progress { 
            height: 100%; 
            background: linear-gradient(90deg, #ff6b6b, #4ecdc4, #45b7d1);
            background-size: 200% 100%;
            width: 0%; 
            transition: width 0.1s ease; 
            border-radius: 4px;
            animation: progressGlow 2s ease-in-out infinite alternate;
        }
        
        @keyframes progressGlow {
            0% { box-shadow: 0 0 5px rgba(255, 107, 107, 0.5); background-position: 0% 50%; }
            100% { box-shadow: 0 0 20px rgba(69, 183, 209, 0.8); background-position: 100% 50%; }
        }
        
        .lyrics-stage {
            background: rgba(0,0,0,0.9);
            backdrop-filter: blur(40px);
            padding: 40px;
            border-radius: 30px;
            border: 1px solid rgba(255,255,255,0.05);
            width: 100%;
            height: 600px;
            display: flex;
            flex-direction: column;
            align-items: center;
            position: relative;
            overflow-y: auto;
            overflow-x: hidden;
            box-shadow: 0 30px 60px rgba(0,0,0,0.6);
            scroll-behavior: smooth;
        }
        
        .lyrics-container {
            width: 100%;
            max-width: 800px;
            display: flex;
            flex-direction: column;
            gap: 20px;
            padding: 20px 0;
        }
        
        .lyric-line {
            font-family: 'Inter', sans-serif;
            font-size: 1.8rem;
            font-weight: 400;
            line-height: 1.4;
            padding: 15px 20px;
            border-radius: 15px;
            transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            opacity: 0.3;
            text-align: center;
            cursor: pointer;
        }
        
        .lyric-line.active {
            opacity: 1;
            background: linear-gradient(135deg, rgba(255, 107, 107, 0.1), rgba(78, 205, 196, 0.1));
            border: 1px solid rgba(255, 107, 107, 0.3);
            font-weight: 600;
            font-size: 2.2rem;
            transform: scale(1.02);
            box-shadow: 0 10px 30px rgba(255, 107, 107, 0.2);
            color: #ffffff;
        }
        
        .lyric-line.passed {
            opacity: 0.5;
            color: #888;
        }
        
        .lyric-line.upcoming {
            opacity: 0.3;
            color: #666;
        }
        
        .current-line, .next-line {
            display: none;
        }
        
        .highlighted-word {
            background: linear-gradient(45deg, #ff6b6b, #4ecdc4, #45b7d1);
            background-size: 200% 200%;
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            font-weight: 800;
            text-shadow: none;
            animation: wordGlow 0.8s ease-in-out, gradientFlow 3s ease-in-out infinite;
            display: inline-block;
            transform: scale(1.05);
            filter: drop-shadow(0 0 10px rgba(255, 107, 107, 0.3));
        }
        
        @keyframes wordGlow {
            0% { transform: scale(1) translateY(0); }
            50% { transform: scale(1.1) translateY(-2px); }
            100% { transform: scale(1.05) translateY(0); }
        }
        
        @keyframes gradientFlow {
            0%, 100% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
        }
        
        .upcoming-word {
            opacity: 0.3;
            transition: all 0.3s ease;
            filter: blur(0.5px);
        }
        
        .line-transition {
            animation: lineSlideIn 0.8s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        @keyframes lineSlideIn {
            0% { 
                opacity: 0; 
                transform: translateY(30px) scale(0.95); 
                filter: blur(5px);
            }
            100% { 
                opacity: 1; 
                transform: translateY(0) scale(1); 
                filter: blur(0);
            }
        }
        
        .status { 
            position: fixed; 
            top: 30px; 
            right: 30px; 
            padding: 12px 24px; 
            background: rgba(0,0,0,0.8); 
            backdrop-filter: blur(20px);
            border: 1px solid rgba(255,255,255,0.1); 
            border-radius: 25px; 
            font-size: 0.9rem; 
            font-weight: 500;
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
            z-index: 1000;
        }
        
        .music-visualizer {
            position: absolute;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            gap: 3px;
            opacity: 0.3;
        }
        
        .bar {
            width: 3px;
            height: 20px;
            background: linear-gradient(to top, #ff6b6b, #4ecdc4);
            border-radius: 2px;
            animation: musicBars 1.5s ease-in-out infinite;
        }
        
        .bar:nth-child(2) { animation-delay: 0.1s; }
        .bar:nth-child(3) { animation-delay: 0.2s; }
        .bar:nth-child(4) { animation-delay: 0.3s; }
        .bar:nth-child(5) { animation-delay: 0.4s; }
        
        @keyframes musicBars {
            0%, 100% { height: 20px; }
            50% { height: 40px; }
        }
        
        @media (max-width: 768px) {
            .header h1 { font-size: 2.5rem; }
            .current-line { font-size: 2.2rem; }
            .next-line { font-size: 1.4rem; }
            .track-info, .lyrics-stage { padding: 30px 25px; }
        }
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
        
        <div class="lyrics-stage">
            <div class="lyrics-container" id="lyricsContainer">
                <div class="lyric-line">🎵 Your lyrics will appear here</div>
            </div>
            <div class="music-visualizer">
                <div class="bar"></div>
                <div class="bar"></div>
                <div class="bar"></div>
                <div class="bar"></div>
                <div class="bar"></div>
            </div>
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
                displayAllLyrics();
            } catch (error) {
                lyrics = [];
                displayAllLyrics();
            }
        }

        function displayAllLyrics() {
            const container = document.getElementById('lyricsContainer');
            
            if (lyrics.length === 0) {
                container.innerHTML = '<div class="lyric-line">🎵 No lyrics available</div>';
                return;
            }
            
            container.innerHTML = '';
            lyrics.forEach((lyric, index) => {
                const lineElement = document.createElement('div');
                lineElement.className = 'lyric-line upcoming';
                lineElement.textContent = lyric.words;
                lineElement.dataset.index = index;
                container.appendChild(lineElement);
            });
        }

        function updateLyrics(progressMs) {
            if (lyrics.length === 0) return;

            let currentLineIndex = -1;
            
            // Find current line
            for (let i = 0; i < lyrics.length; i++) {
                const lineTime = lyrics[i].startTimeMs;
                const nextLineTime = i + 1 < lyrics.length ? lyrics[i + 1].startTimeMs : lineTime + 8000;
                
                if (progressMs >= lineTime && progressMs < nextLineTime) {
                    currentLineIndex = i;
                    break;
                }
            }
            
            // Update all line states
            const allLines = document.querySelectorAll('.lyric-line');
            allLines.forEach((line, index) => {
                line.classList.remove('active', 'passed', 'upcoming');
                
                if (index === currentLineIndex) {
                    line.classList.add('active');
                    // Scroll to current line
                    line.scrollIntoView({ behavior: 'smooth', block: 'center' });
                } else if (index < currentLineIndex) {
                    line.classList.add('passed');
                } else {
                    line.classList.add('upcoming');
                }
            });
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
