from flask import jsonify
import requests
import re

class LyricsService:
    def __init__(self):
        self.base_url = "https://lrclib.net/api"
    
    def get_lyrics(self, artist, title):
        """Fetch synced lyrics from LRCLib API"""
        try:
            # Clean artist and title for API
            clean_artist = self._clean_search_term(artist)
            clean_title = self._clean_search_term(title)
            
            # Try LRCLib API
            url = f"{self.base_url}/get"
            params = {
                'artist_name': clean_artist,
                'track_name': clean_title
            }
            
            response = requests.get(url, params=params, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if data.get('syncedLyrics'):
                    parsed_lyrics = self._parse_lrc(data['syncedLyrics'])
                    return jsonify({
                        'success': True,
                        'lyrics': parsed_lyrics,
                        'source': 'lrclib'
                    })
            
            return jsonify({
                'success': False,
                'error': 'No synced lyrics found'
            })
            
        except Exception as e:
            return jsonify({
                'success': False,
                'error': str(e)
            })
    
    def _clean_search_term(self, term):
        """Clean search terms for better API matching"""
        # Remove common suffixes and prefixes
        term = re.sub(r'\s*\(.*?\)\s*', '', term)  # Remove parentheses
        term = re.sub(r'\s*\[.*?\]\s*', '', term)  # Remove brackets
        term = re.sub(r'\s*-\s*.*$', '', term)     # Remove everything after dash
        return term.strip()
    
    def _parse_lrc(self, lrc_content):
        """Parse LRC format into timed lyrics"""
        lines = []
        for line in lrc_content.split('\n'):
            line = line.strip()
            if not line:
                continue
            
            # Match [mm:ss.xx] format
            match = re.match(r'\[(\d+):(\d+)\.(\d+)\](.*)', line)
            if match:
                minutes = int(match.group(1))
                seconds = int(match.group(2))
                centiseconds = int(match.group(3))
                text = match.group(4).strip()
                
                if text:  # Only include non-empty lyrics
                    time_ms = (minutes * 60 + seconds) * 1000 + centiseconds * 10
                    lines.append({
                        'time': time_ms,
                        'text': text
                    })
        
        return lines
