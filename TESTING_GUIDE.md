# Testing Guide: New Browsing Features

## Quick Start Testing

### 1. Start the Server

```bash
cd /Users/saagarracharla/Desktop/spotify-karaoke
python3 main.py
```

You should see:
```
✅ Spotify connected successfully
 * Running on http://127.0.0.1:5004
```

### 2. Open Browser

Visit: `http://localhost:5004`

**Note**: The first time you access it, Spotify will ask you to re-authenticate because we added new scopes. This is normal!

## Testing New API Endpoints

### Test 1: Get Your Playlists

Open browser console (F12) or use curl:

```bash
curl http://localhost:5004/api/playlists
```

Or in browser:
```javascript
fetch('/api/playlists')
  .then(r => r.json())
  .then(data => console.log(data))
```

**Expected**: JSON with your playlists:
```json
{
  "items": [
    {
      "id": "playlist_id",
      "name": "My Playlist",
      "images": [...],
      "tracks": {...}
    }
  ],
  "total": 10,
  "limit": 50,
  "offset": 0
}
```

### Test 2: Get Playlist Tracks

Replace `PLAYLIST_ID` with an actual playlist ID from Test 1:

```bash
curl http://localhost:5004/api/playlist/PLAYLIST_ID/tracks
```

Or in browser:
```javascript
fetch('/api/playlist/YOUR_PLAYLIST_ID/tracks')
  .then(r => r.json())
  .then(data => console.log(data))
```

**Expected**: JSON with playlist info and tracks

### Test 3: Search

```bash
curl "http://localhost:5004/api/search?q=beatles&type=track&limit=5"
```

Or in browser:
```javascript
fetch('/api/search?q=beatles&type=track&limit=5')
  .then(r => r.json())
  .then(data => console.log(data))
```

**Expected**: Search results with tracks

### Test 4: Get Saved Albums

```bash
curl http://localhost:5004/api/albums
```

Or in browser:
```javascript
fetch('/api/albums')
  .then(r => r.json())
  .then(data => console.log(data))
```

**Expected**: Your saved albums

### Test 5: Get Recently Played

```bash
curl http://localhost:5004/api/recently-played
```

Or in browser:
```javascript
fetch('/api/recently-played')
  .then(r => r.json())
  .then(data => console.log(data))
```

**Expected**: Recently played tracks

### Test 6: Play a Track/Album/Playlist

```bash
curl -X POST http://localhost:5004/api/play \
  -H "Content-Type: application/json" \
  -d '{"type": "track", "id": "TRACK_ID"}'
```

Or in browser:
```javascript
fetch('/api/play', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    type: 'track',  // or 'album' or 'playlist'
    id: 'YOUR_TRACK_ID'
  })
})
.then(r => r.json())
.then(data => console.log(data))
```

**Expected**: `{"action": "playing", "type": "track", "id": "..."}`

## Interactive Testing Page

I'll create a simple test page you can use to test all endpoints interactively.

