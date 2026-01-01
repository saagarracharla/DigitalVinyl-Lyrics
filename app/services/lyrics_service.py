from flask import jsonify
import requests

class LyricsService:
    def __init__(self):
        self.base_url = "https://lrclib.net/api"
    
    def get_lyrics(self, track, artist):
        """Get synced lyrics - matches working spotify_karaoke.py format"""
        try:
            url = f"{self.base_url}/search"
            params = {'artist_name': artist, 'track_name': track}
            
            response = requests.get(url, params=params, timeout=10)
            if response.status_code == 200:
                data = response.json()
                if data and len(data) > 0:
                    track_data = data[0]
                    if track_data.get('syncedLyrics'):
                        parsed_lyrics = self._parse_lrc_content(track_data['syncedLyrics'])
                        return jsonify({'lines': parsed_lyrics})
        except Exception as e:
            print(f"Lyrics error: {e}")
        
        # Fallback for no lyrics
        return jsonify({'lines': [{'startTimeMs': 0, 'words': f'🎵 No lyrics found for {track}'}]})
    
    def _parse_lrc_content(self, lrc_text):
        """Parse LRC format - exact copy from working version"""
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
