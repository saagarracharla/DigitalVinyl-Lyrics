# 🎵 Digital Vinyl with Lyrics

A beautiful circular Spotify player that brings the classic vinyl experience to life with real-time synchronized lyrics. Designed for circular displays with touch controls and a stunning vinyl-style interface.

## Screenshots

### Album View
![Album View](app/Images/Album.png)

### Lyrics View  
![Lyrics View](app/Images/Lyrics.png)

## Features

- **Spinning record**: the album cover turns like vinyl while music plays. Drag it around to scrub through the song (a full turn is 30 seconds).
- **Synced lyrics**: lines scroll in time with the music over a colour taken from the album cover.
- **Your library**: playlists, saved albums, recently played and search, all inside the circle.
- **Queue**: see what's playing next, add songs with **+**, and tap a queued song to skip to it. Spotify's API can't remove or reorder queue items.
- **Settings**: lyrics background (album colour, spinning cover or black), text size, current-line-only lyrics, fading song info, auto-hiding buttons, spin speed, scrub speed, progress ring style, idle clock and more. Saved on the device.
- **Spotify Connect device**: shows up in Spotify as **Digital Vinyl**. It also follows music playing on your other devices.
- **Made for round screens**: designed at 1080×1080 and scales to any square window.
- **Free lyrics**: from [LRCLib](https://lrclib.net), no API key needed.

## Requirements

- Python 3.9+
- A Spotify account. Playing audio in the browser (Web Playback SDK) needs **Spotify Premium**. Without it, the app still shows lyrics and controls playback on your other devices.
- A Spotify app from the [Developer Dashboard](https://developer.spotify.com/dashboard). Apps in development mode only work for accounts you add under *User Management*.

## Setup

### 1. Install dependencies
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Set up Spotify API
1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create a new app
3. Copy your Client ID and Client Secret
4. Add `http://127.0.0.1:8888/callback` as a redirect URI

### 3. Configure environment variables
Create a `.env` file:
```
SPOTIFY_CLIENT_ID=your_client_id_here
SPOTIFY_CLIENT_SECRET=your_client_secret_here
SPOTIFY_REDIRECT_URI=http://127.0.0.1:8888/callback
```

### 4. Run the app
```bash
source .venv/bin/activate
python main.py
```

The first run opens a Spotify login in your browser. After that the login is saved in `.cache`.

The server only listens on `127.0.0.1` by default. See `.env.example` for `HOST`, `PORT` and `FLASK_DEBUG`.

### 5. Open browser
Visit: http://127.0.0.1:5004

## Usage

| Action | What it does |
|---|---|
| Drag around the record | Scrub forward or back |
| Tap the record | Switch between the cover and lyrics (tap a paused record to resume) |
| Top button | Open or close your library |
| Bottom buttons | Previous, play/pause, next |
| Library chips | Switch between Playlists, Albums, Recent and Queue; type in the search field to find songs |
| **+** on a song | Add it to the queue |
| Gear chip | Settings |

Playlists start in shuffle. On a keyboard: Space plays or pauses, ← / → skip back or forward 10 seconds, Esc closes the library.

## Architecture

### Backend
- **Flask** - Web framework
- **Spotipy** - Spotify Web API wrapper
- **LRCLib API** - Free synced lyrics

### Frontend
- **Spotify Web Playback SDK** - Real-time playback control
- **Vanilla JavaScript** - No frameworks, pure JS
- **CSS container query units** - one layout that scales with the circle

### Key Components
- `main.py` - Flask application and routes
- `app/services/spotify_service.py` - Spotify API integration
- `app/services/lyrics_service.py` - Lyrics fetching
- `app/static/js/app.js` - Frontend player logic
- `app/templates/index.html` - Main UI

## API Endpoints

- `GET /api/playlists` - Get user playlists
- `GET /api/playlist/<id>/tracks` - Get playlist tracks
- `GET /api/albums` - Get saved albums
- `GET /api/search?q=<query>` - Search tracks
- `POST /api/play` - Play track/album/playlist
- `GET /lyrics?track=<name>&artist=<artist>&duration_ms=<ms>` - Get synced lyrics (duration picks the matching version)
- `GET /api/access-token` - Get Web Playback SDK token
- `POST /api/transfer-playback` - Transfer to Web SDK device

## Technical Details

- **Real-time Updates**: Web Playback SDK events, plus a once-a-second sync that also follows playback on other devices
- **Lyrics Sync**: Millisecond-accurate timing with LRCLib
- **Circular Design**: Optimized for 1080x1080 circular displays

## Testing

End-to-end UI tests run the real page in headless Chrome against a fake Spotify backend (`tests/ui/mock.js`), so they never touch your Spotify account. They cover playback controls, tap and drag gestures, lyrics, the library, search, the queue, every setting, error messages and keyboard shortcuts.

```bash
source .venv/bin/activate
python tests/ui/serve.py &        # UI with the fake backend on http://127.0.0.1:5099
node tests/ui/run-tests.mjs       # needs Node 22+ and Google Chrome
```

Screenshots of each screen are saved to `tests/ui/shots/`. Set `CHROME_PATH` if Chrome isn't in the default macOS location.

## License

MIT License - feel free to use and modify!

---

**Built with ❤️ for music lovers who want to sing along!** 🎤
