# 🎤 Spotify Karaoke

A real-time karaoke app that syncs lyrics with your Spotify playback, featuring word-by-word highlighting just like Spotify's karaoke mode.

## Features

✅ **Real-time sync** with Spotify playback  
✅ **Word-by-word highlighting** with smooth transitions  
✅ **Free synced lyrics** from LRCLib API  
✅ **Beautiful UI** with glassmorphism design  
✅ **Two-line display** (current + next line preview)  
✅ **Progress bar** showing song position  
✅ **Automatic song detection** and lyrics loading  

## Setup

### 1. Clone the repository
```bash
git clone https://github.com/yourusername/spotify-karaoke.git
cd spotify-karaoke
```

### 2. Install dependencies
```bash
pip3 install -r requirements.txt
```

### 3. Set up Spotify API
1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create a new app
3. Copy your Client ID and Client Secret
4. Add `http://127.0.0.1:8888/callback` as a redirect URI

### 4. Configure environment variables
```bash
cp .env.example .env
```
Edit `.env` and add your Spotify credentials:
```
SPOTIFY_CLIENT_ID=your_client_id_here
SPOTIFY_CLIENT_SECRET=your_client_secret_here
SPOTIFY_REDIRECT_URI=http://127.0.0.1:8888/callback
```

### 5. Run the app
```bash
python3 spotify_karaoke.py
```

### 6. Open browser
Visit: http://127.0.0.1:5004

## Usage

1. **Play a song in Spotify**
2. **Watch the magic happen!** 🎵
3. Lyrics will sync automatically with word-by-word highlighting

## How It Works

- **Spotify API** detects your current playing song
- **LRCLib API** fetches free synced lyrics (no API key needed)
- **Real-time synchronization** updates lyrics every 500ms
- **Word highlighting** shows exactly where you are in the song

## Supported Songs

Works with thousands of popular songs that have synced lyrics in the LRCLib database. Try songs by:
- Ed Sheeran, Taylor Swift, Drake, The Weeknd, Dua Lipa, etc.

## Technical Details

- **Backend:** Flask + Spotipy
- **Frontend:** Vanilla JavaScript with modern CSS
- **Lyrics Source:** LRCLib (free, no registration required)
- **Sync Precision:** Millisecond-accurate timing

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - feel free to use and modify!

---

**Built with ❤️ for music lovers who want to sing along!** 🎤
