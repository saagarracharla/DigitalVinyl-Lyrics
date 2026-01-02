# Spotify Web Playback SDK Integration Guide

## Overview
This guide explains how to replace polling with the Spotify Web Playback SDK for real-time updates.

## Why Web Playback SDK?

### Current (Polling) ❌
```javascript
setInterval(updateAll, 500); // Polls every 500ms
```
- Inefficient
- Delayed updates
- Wastes resources
- Not real-time

### New (Web Playback SDK) ✅
```javascript
player.addListener('player_state_changed', (state) => {
    // Instant updates!
});
```
- Real-time events
- No polling needed
- Better performance
- Official Spotify solution

## Implementation Steps

### 1. Add SDK Script to HTML
Add to `app/templates/index.html`:
```html
<script src="https://sdk.scdn.co/spotify-player.js"></script>
```

### 2. Initialize Player
```javascript
window.onSpotifyWebPlaybackSDKReady = () => {
    const token = 'YOUR_ACCESS_TOKEN'; // Get from backend
    const player = new Spotify.Player({
        name: 'Circular Spotify Player',
        getOAuthToken: cb => { cb(token); },
        volume: 0.5
    });

    // Error handling
    player.addListener('initialization_error', ({ message }) => {
        console.error('Failed to initialize', message);
    });

    player.addListener('authentication_error', ({ message }) => {
        console.error('Failed to authenticate', message);
    });

    player.addListener('account_error', ({ message }) => {
        console.error('Failed to validate Spotify account', message);
    });

    // Ready
    player.addListener('ready', ({ device_id }) => {
        console.log('Ready with Device ID', device_id);
        // Transfer playback to this device
        transferPlayback(device_id);
    });

    // Not ready
    player.addListener('not_ready', ({ device_id }) => {
        console.log('Device ID has gone offline', device_id);
    });

    // Connect to the player!
    player.connect();
};
```

### 3. Listen for State Changes
```javascript
player.addListener('player_state_changed', (state) => {
    if (!state) {
        console.log('No state available');
        return;
    }

    const {
        current_track,
        position,
        duration,
        paused,
        shuffle,
        repeat_mode
    } = state;

    // Update UI instantly - no polling!
    updateUI({
        track: current_track.name,
        artist: current_track.artists[0].name,
        album_art: current_track.album.images[0].url,
        progress_ms: position,
        duration_ms: duration,
        is_playing: !paused
    });
});
```

### 4. Transfer Playback
```javascript
async function transferPlayback(deviceId) {
    await fetch('/api/transfer-playback', {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ device_ids: [deviceId] })
    });
}
```

### 5. Add Backend Endpoint
Add to `main.py`:
```python
@app.route('/api/transfer-playback', methods=['PUT'])
def transfer_playback():
    data = request.json
    device_ids = data.get('device_ids', [])
    try:
        spotify_service.sp.transfer_playback(device_ids[0] if device_ids else None)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)})
```

### 6. Get Access Token
Add endpoint to get access token:
```python
@app.route('/api/access-token')
def get_access_token():
    try:
        token = spotify_service.sp.auth_manager.get_access_token()
        return jsonify({'access_token': token})
    except Exception as e:
        return jsonify({'error': str(e)})
```

## Complete Integration Example

### Frontend (`app.js`)
```javascript
class SpotifyPlayer {
    constructor() {
        this.player = null;
        this.deviceId = null;
        this.accessToken = null;
    }

    async init() {
        // Get access token from backend
        const tokenResponse = await fetch('/api/access-token');
        const { access_token } = await tokenResponse.json();
        this.accessToken = access_token;

        // Wait for SDK to load
        if (window.Spotify) {
            this.setupPlayer();
        } else {
            window.onSpotifyWebPlaybackSDKReady = () => this.setupPlayer();
        }
    }

    setupPlayer() {
        this.player = new Spotify.Player({
            name: 'Circular Spotify Player',
            getOAuthToken: cb => { cb(this.accessToken); },
            volume: 0.5
        });

        // Event listeners
        this.player.addListener('ready', ({ device_id }) => {
            this.deviceId = device_id;
            this.transferPlayback(device_id);
        });

        this.player.addListener('player_state_changed', (state) => {
            this.handleStateChange(state);
        });

        this.player.connect();
    }

    async transferPlayback(deviceId) {
        await fetch('/api/transfer-playback', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_ids: [deviceId] })
        });
    }

    handleStateChange(state) {
        if (!state) return;

        const track = state.track_window.current_track;
        const position = state.position;
        const duration = state.duration;
        const paused = state.paused;

        // Update your UI here - instant, no polling!
        updateUI({
            track: track.name,
            artist: track.artists[0].name,
            album_art: track.album.images[0].url,
            progress_ms: position,
            duration_ms: duration,
            is_playing: !paused
        });
    }

    // Playback controls
    async togglePlay() {
        await this.player.togglePlay();
    }

    async nextTrack() {
        await this.player.nextTrack();
    }

    async previousTrack() {
        await this.player.previousTrack();
    }

    async seek(positionMs) {
        await this.player.seek(positionMs);
    }
}
```

## Migration Checklist

- [ ] Add SDK script to HTML
- [ ] Create access token endpoint
- [ ] Create transfer playback endpoint
- [ ] Initialize player in frontend
- [ ] Replace `setInterval` with event listeners
- [ ] Update UI update functions
- [ ] Test playback controls
- [ ] Remove old polling code

## Benefits

✅ **No Polling** - Zero `setInterval` calls
✅ **Real-Time** - Instant state updates
✅ **Better Performance** - Less CPU usage
✅ **Official Solution** - Supported by Spotify
✅ **Battery Friendly** - Important for hardware devices

## Notes

- Web Playback SDK requires Premium account
- Device must be active (not sleeping)
- Works best with Chrome/Edge (Safari has limitations)
- For Raspberry Pi, use Chromium browser

