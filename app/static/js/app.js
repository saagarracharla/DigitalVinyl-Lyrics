/**
 * Digital Vinyl: a circular Spotify player with synced lyrics.
 * Built for a round 1080x1080 display; the layout scales with the circle.
 */

const DEVICE_NAME = 'Digital Vinyl';

const TAP_MAX_DEGREES = 3;                 // turning less than this counts as a tap
const MIN_SEEK_MS = 500;                   // smaller net drags don't seek
const ART_INTRO_MS = 4000;                 // show the cover this long before lyrics on a new track
const SEEK_SETTLE_MS = 2000;               // after seeking, ignore stale positions for this long
const SYNC_INTERVAL_MS = 1000;
const TOAST_MS = 2600;
const LYRICS_RETRY_MS = [3000, 8000, 20000]; // wait before each retry when the lyrics service fails
const AUTO_HIDE_MS = 5000;                 // song info / buttons fade after this long, when enabled

const SPIN_PERIOD_MS = { slow: 40000, normal: 20000, fast: 10000 };   // time for one full turn
const SETTINGS_STORAGE_KEY = 'digitalVinyl.settings';

// Everything on the Settings screen. Rendering, defaults and storage all come from this list.
const SETTINGS_SCHEMA = [
    { section: 'Lyrics', items: [
        { key: 'autoLyrics', type: 'toggle', default: true, label: 'Show lyrics automatically', description: 'Switch to lyrics a few seconds into each song' },
        { key: 'lyricsBackground', type: 'choice', default: 'album', label: 'Background',
          options: [['album', 'Album colour'], ['cover', 'Spinning cover'], ['black', 'Black']] },
        { key: 'lyricsSize', type: 'choice', default: 'medium', label: 'Text size',
          options: [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']] },
        { key: 'lyricsContext', type: 'toggle', default: true, label: 'Show surrounding lines', description: 'Turn off to see only the line being sung' },
    ] },
    { section: 'Now Playing', items: [
        { key: 'fadeSongInfo', type: 'toggle', default: false, label: 'Fade song info', description: 'Hide the title and artist after 5 seconds' },
        { key: 'spin', type: 'toggle', default: true, label: 'Spin the record' },
        { key: 'spinSpeed', type: 'choice', default: 'normal', label: 'Spin speed',
          options: [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']] },
        { key: 'vinylTexture', type: 'toggle', default: true, label: 'Grooves and shine', description: 'Record texture over the cover' },
    ] },
    { section: 'Controls', items: [
        { key: 'autoHideControls', type: 'toggle', default: false, label: 'Auto-hide buttons', description: 'Hide while playing; tap the record to bring them back' },
        { key: 'scrubSeconds', type: 'choice', default: '30', label: 'One turn of the record skips',
          options: [['15', '15 sec'], ['30', '30 sec'], ['60', '1 min']] },
    ] },
    { section: 'Display', items: [
        { key: 'showProgress', type: 'toggle', default: true, label: 'Progress ring' },
        { key: 'ringColor', type: 'choice', default: 'white', label: 'Ring colour',
          options: [['white', 'White'], ['green', 'Green'], ['album', 'Album']] },
        { key: 'idleClock', type: 'toggle', default: true, label: 'Clock when nothing is playing' },
    ] },
];
const SETTING_ITEMS = SETTINGS_SCHEMA.flatMap(group => group.items);
const DEFAULT_SETTINGS = Object.fromEntries(SETTING_ITEMS.map(item => [item.key, item.default]));

// Settings are a per-device preference, so browser storage is enough. It can be unavailable
// (private windows, blocked storage), in which case the defaults are used.
function loadSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
        const settings = { ...DEFAULT_SETTINGS };
        for (const item of SETTING_ITEMS) {
            const value = saved[item.key];
            const valid = item.type === 'toggle'
                ? typeof value === 'boolean'
                : item.options.some(([optionValue]) => optionValue === value);
            if (valid) settings[item.key] = value;
        }
        return settings;
    } catch (error) {
        return { ...DEFAULT_SETTINGS };
    }
}

function saveSettings(settings) {
    try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
        console.warn('Could not save settings:', error);
    }
}

const REPEAT_CYCLE = { off: 'context', context: 'track', track: 'off' };
const REPEAT_LABELS = { off: 'Repeat: off', context: 'Repeat: all', track: 'Repeat: one song' };

const ICON_REMOVE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="1.8" /><path d="M7.5 12h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>';
const ICON_HANDLE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16M4 12h16M4 16h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>';

const RING_RADIUS = 532;                   // matches the SVG in index.html (viewBox 1080)
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const LIBRARY_SOURCES = {
    playlists: { url: '/api/playlists?limit=50', kind: 'playlist' },
    albums: { url: '/api/albums?limit=50', kind: 'album' },
    recent: { url: '/api/recently-played?limit=50', kind: 'track' },
};

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// The SDK calls this global once it has loaded; it may fire before or after the player is constructed
const spotifySDKReady = new Promise(resolve => {
    window.onSpotifyWebPlaybackSDKReady = resolve;
});

// Escape text from the Spotify API (playlist names are user-written) before putting it in innerHTML
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
}

function formatTime(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

// Spotify returns images largest first; rows only need a small one
function smallImage(images) {
    if (!images || images.length === 0) return '';
    const small = images.find(image => image.width && image.width <= 300);
    return (small || images[images.length - 1] || images[0]).url || '';
}

// Hue and saturation of an album cover, weighted toward vivid mid-tone pixels
function coverHueSaturation(image) {
    const size = 24;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, size, size);
    const pixels = context.getImageData(0, 0, size, size).data;

    let r = 0, g = 0, b = 0, total = 0;
    for (let i = 0; i < pixels.length; i += 4) {
        const pr = pixels[i] / 255, pg = pixels[i + 1] / 255, pb = pixels[i + 2] / 255;
        const max = Math.max(pr, pg, pb), min = Math.min(pr, pg, pb);
        const lightness = (max + min) / 2;
        const saturation = max === min ? 0 : (max - min) / (1 - Math.abs(2 * lightness - 1));
        const weight = 0.05 + saturation * (1 - Math.abs(lightness - 0.5) * 2);
        r += pr * weight; g += pg * weight; b += pb * weight; total += weight;
    }
    r /= total; g /= total; b /= total;

    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const lightness = (max + min) / 2;
    if (max === min) return { hue: 0, saturation: 0 };
    const delta = max - min;
    const saturation = delta / (1 - Math.abs(2 * lightness - 1));
    let hue;
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    return { hue: (hue * 60 + 360) % 360, saturation };
}

class VinylPlayer {
    constructor() {
        // Playback
        this.track = null;            // { key, name, artist, artists, art, durationMs, uri, contextUri }
        this.isPlaying = false;
        this.positionMs = 0;          // position at positionAt; interpolated between updates
        this.positionAt = performance.now();
        this.seekTarget = 0;
        this.seekSettleUntil = 0;

        // Lyrics
        this.lyrics = [];
        this.lyricsStatus = 'none';        // loading | ready | none | error
        this.lyricsRetryTimer = null;
        this.lyricIndex = -1;
        this.showLyrics = true;
        this.introUntil = 0;
        this.introTimer = null;

        // View
        this.view = 'idle';
        this.drag = null;
        this.rotation = 0;
        this.lastFrameTime = null;
        this.toastTimer = null;
        this.songInfoTimer = null;
        this.controlsTimer = null;
        this.controlsHiddenAtPointerDown = false;
        this.settings = loadSettings();

        // Queue: the device keeps its own (see app/services/play_queue.py)
        this.queue = null;            // last state from /api/queue
        this.queueDrag = null;
        this.reportedUri = null;
        this.queueReportTimer = null;
        this.queueReports = 0;

        // Library
        this.libraryTab = 'playlists';
        this.libraryRequest = 0;
        this.searchTimer = null;

        // Spotify
        this.player = null;
        this.deviceId = null;
        this.isSDKReady = false;

        this.el = Object.fromEntries([
            'player', 'disc', 'albumArt', 'progressFill', 'progressKnob', 'trackTitle', 'trackArtist',
            'lyricsView', 'lyricsLines', 'seekTime', 'seekTotal', 'library', 'searchInput', 'libraryList',
            'libraryBtn', 'prevBtn', 'playPauseBtn', 'nextBtn', 'toast', 'libraryTitle', 'idleTime', 'idleDate',
            'shuffleBtn', 'repeatBtn'
        ].map(id => [id, document.getElementById(id)]));
        this.el.chips = [...document.querySelectorAll('.chip')];

        this.bindEvents();
        this.applySettings();
        requestAnimationFrame(now => this.frame(now));

        // Show whatever is playing right away (even on another device), then keep in sync
        this.sync();
        this.refreshQueue();
        this.updateClock();
        setInterval(() => {
            this.sync();
            this.updateClock();
        }, SYNC_INTERVAL_MS);
        this.initializeWebPlaybackSDK();
    }

    bindEvents() {
        const { disc } = this.el;
        disc.addEventListener('pointerdown', e => this.handlePointerDown(e));
        disc.addEventListener('pointermove', e => this.handlePointerMove(e));
        disc.addEventListener('pointerup', e => this.handlePointerUp(e));
        disc.addEventListener('pointercancel', e => this.handlePointerUp(e));

        this.el.playPauseBtn.addEventListener('click', () => this.playPause());
        this.el.prevBtn.addEventListener('click', () => this.previousTrack());
        this.el.nextBtn.addEventListener('click', () => this.nextTrack());
        this.el.libraryBtn.addEventListener('click', () => this.toggleLibrary());
        this.el.shuffleBtn.addEventListener('click', () => this.toggleShuffle());
        this.el.repeatBtn.addEventListener('click', () => this.cycleRepeat());

        this.el.chips.forEach(chip => {
            chip.addEventListener('click', () => {
                this.el.searchInput.value = '';
                this.loadLibraryTab(chip.dataset.tab);
            });
        });
        this.el.searchInput.addEventListener('input', () => this.handleSearchInput());

        document.addEventListener('keydown', e => this.handleKeydown(e));
        window.addEventListener('resize', () => this.renderLyricPosition(true));

        // Browsers only allow audio after a user gesture; let the SDK use the first one
        document.addEventListener('pointerdown', () => this.player?.activateElement?.(), { capture: true });

        // Any touch brings auto-hidden buttons back
        this.el.player.addEventListener('pointerdown', () => {
            this.controlsHiddenAtPointerDown = this.el.player.classList.contains('controls-hidden');
            this.wakeControls();
        }, { capture: true });
    }

    // ---------- Spotify connection ----------

    async fetchAccessToken() {
        const response = await fetch('/api/access-token');
        const data = await response.json();
        if (data.error) {
            throw new Error(data.error);
        }
        return data.access_token;
    }

    async initializeWebPlaybackSDK() {
        try {
            // Check we can get a token before loading the player
            await this.fetchAccessToken();
            await spotifySDKReady;
            this.setupPlayer();
        } catch (error) {
            // Without the SDK, sync() keeps showing and controlling playback on other devices
            console.error('SDK initialization error:', error);
        }
    }

    setupPlayer() {
        this.player = new Spotify.Player({
            name: DEVICE_NAME,
            // The SDK calls this on connect and again whenever its token expires (hourly),
            // so fetch a fresh one each time instead of reusing the first
            getOAuthToken: cb => {
                this.fetchAccessToken()
                    .then(cb)
                    .catch(error => console.error('Failed to refresh access token:', error));
            },
            volume: 0.5
        });

        this.player.addListener('initialization_error', ({ message }) => console.error('SDK initialization error:', message));
        this.player.addListener('authentication_error', ({ message }) => console.error('SDK authentication error:', message));
        this.player.addListener('account_error', ({ message }) => {
            console.error('SDK account error:', message);
            this.showToast('Spotify Premium is needed to play on this device');
        });

        this.player.addListener('ready', ({ device_id }) => {
            console.log('✅ Web Playback SDK ready with Device ID:', device_id);
            this.deviceId = device_id;
            this.isSDKReady = true;
            this.transferPlayback(device_id);
        });
        this.player.addListener('not_ready', ({ device_id }) => {
            console.log('Device has gone offline:', device_id);
            this.isSDKReady = false;
        });
        this.player.addListener('player_state_changed', state => this.applySdkState(state));

        this.player.connect();
    }

    async transferPlayback(deviceId) {
        try {
            await fetch('/api/transfer-playback', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ device_ids: [deviceId] })
            });
        } catch (error) {
            console.error('Transfer playback error:', error);
        }
    }

    // Playback is on this device: read state from the SDK. Otherwise ask the server.
    async sync() {
        try {
            if (this.isSDKReady) {
                const state = await this.player.getCurrentState();
                if (state) {
                    this.applySdkState(state);
                    return;
                }
            }
            const response = await fetch('/current-track');
            const data = await response.json();
            if (data.error) {
                console.error('Current track error:', data.error);
                return;
            }
            if (!data.track_name) {
                this.clearTrack();
                return;
            }
            this.applyPlayback({
                name: data.track_name,
                artist: data.artist,
                artists: data.artists || data.artist,
                art: data.album_art,
                durationMs: data.duration_ms,
                positionMs: data.progress_ms,
                isPlaying: data.is_playing,
                uri: data.uri,
                contextUri: data.context_uri
            });
        } catch (error) {
            console.error('Sync error:', error);
        }
    }

    applySdkState(state) {
        const track = state?.track_window?.current_track;
        if (!track) return;
        const images = [...(track.album?.images || [])].sort((a, b) => (b.width || 0) - (a.width || 0));
        this.applyPlayback({
            name: track.name,
            artist: track.artists[0]?.name || 'Unknown Artist',
            artists: track.artists.map(artist => artist.name).join(', '),
            art: images[0]?.url,
            durationMs: state.duration,
            positionMs: state.position,
            isPlaying: !state.paused,
            uri: track.uri,
            contextUri: state.context?.uri
        });
    }

    applyPlayback(playback) {
        const now = performance.now();
        const interpolated = this.currentPositionMs(now);
        const key = `${playback.name}\u0000${playback.artist}`;

        if (!this.track || this.track.key !== key) {
            this.loadTrack({ ...playback, key });
        } else if (!this.drag) {
            // Right after a seek, updates can still carry the old position; keep ours until they catch up
            const settling = now < this.seekSettleUntil && Math.abs(playback.positionMs - this.seekTarget) > 2000;
            this.setPosition(settling ? interpolated : playback.positionMs);
            if (!settling) this.seekSettleUntil = 0;
        }

        if (this.track.contextUri !== playback.contextUri || this.track.uri !== playback.uri) {
            this.track.contextUri = playback.contextUri;
            this.track.uri = playback.uri;
            this.highlightPlayingRows();
        }

        this.setPlaying(playback.isPlaying);

        if (playback.uri && playback.uri !== this.reportedUri) {
            this.reportedUri = playback.uri;
            this.reportNowPlaying(playback);
        }
    }

    // The server's queue follows Spotify from track to track. When playback is on this device the
    // page reads it from the SDK rather than the server, so tell the server about each new track.
    async reportNowPlaying(playback) {
        try {
            await this.postJson('/api/now-playing', {
                uri: playback.uri,
                name: playback.name,
                artist: playback.artist,
                context_uri: playback.contextUri || null,
                position_ms: Math.floor(playback.positionMs || 0)
            });
        } catch (error) {
            console.warn('Now playing report failed:', error);
        }
        this.refreshQueue();
    }

    loadTrack(track) {
        this.track = track;
        this.setPosition(track.positionMs);
        this.seekSettleUntil = 0;

        this.el.trackTitle.textContent = track.name;
        this.el.trackArtist.textContent = track.artists;
        this.el.albumArt.style.backgroundImage = track.art ? `url("${track.art}")` : '';
        this.applyAlbumColor(track.art);

        this.lyrics = [];
        this.lyricIndex = -1;
        this.el.lyricsLines.innerHTML = '';

        // Each new record starts on its cover. With "Show lyrics automatically" on it moves to
        // lyrics after the intro; tapping only changes the view for the current song.
        this.showLyrics = this.settings.autoLyrics;
        this.introUntil = performance.now() + ART_INTRO_MS;
        clearTimeout(this.introTimer);
        this.introTimer = setTimeout(() => this.updateView(), ART_INTRO_MS);

        this.fetchLyrics(track, 0);
        this.highlightPlayingRows();
        this.refreshSongInfoFade();
    }

    clearTrack() {
        if (!this.track) return;
        this.track = null;
        this.lyrics = [];
        this.lyricsStatus = 'none';
        clearTimeout(this.lyricsRetryTimer);
        this.el.lyricsLines.innerHTML = '';
        this.setPlaying(false);
    }

    setPlaying(isPlaying) {
        const changed = isPlaying !== this.isPlaying;
        this.isPlaying = isPlaying;
        this.el.player.classList.toggle('is-playing', isPlaying);
        this.el.playPauseBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
        this.updateView();
        if (changed) {
            this.refreshSongInfoFade();
            this.wakeControls();
        }
    }

    setPosition(ms) {
        this.positionMs = ms;
        this.positionAt = performance.now();
    }

    currentPositionMs(now = performance.now()) {
        if (this.drag) return this.drag.positionMs;
        const position = this.isPlaying ? this.positionMs + (now - this.positionAt) : this.positionMs;
        return this.track ? clamp(position, 0, this.track.durationMs) : position;
    }

    // ---------- Rendering ----------

    frame(now) {
        if (this.lastFrameTime !== null && this.isPlaying && !this.drag && this.settings.spin && !reducedMotion.matches) {
            const degreesPerMs = 360 / SPIN_PERIOD_MS[this.settings.spinSpeed];
            this.rotation = (this.rotation + (now - this.lastFrameTime) * degreesPerMs) % 360;
        }
        this.lastFrameTime = now;
        this.el.albumArt.style.transform = `rotate(${this.rotation}deg)`;

        if (this.track && this.track.durationMs > 0) {
            const position = this.currentPositionMs(now);
            this.renderProgress(position / this.track.durationMs);
            this.syncLyric(position);
        }
        requestAnimationFrame(next => this.frame(next));
    }

    renderProgress(fraction) {
        const f = clamp(fraction, 0, 1);
        this.el.progressFill.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - f);
        if (this.drag) {
            const angle = f * 2 * Math.PI;
            this.el.progressKnob.setAttribute('cx', 540 + RING_RADIUS * Math.sin(angle));
            this.el.progressKnob.setAttribute('cy', 540 - RING_RADIUS * Math.cos(angle));
        }
    }

    updateView() {
        let view = 'art';
        if (!this.track) {
            view = 'idle';
        } else if (this.showLyrics && this.isPlaying && this.lyrics.length > 0 && performance.now() >= this.introUntil) {
            view = 'lyrics';
        }
        if (view === this.view) return;
        this.view = view;
        this.el.player.dataset.view = view;
        if (view === 'lyrics') {
            this.renderLyricPosition(true);
        }
        this.refreshSongInfoFade();
    }

    // ---------- Lyrics ----------

    async fetchLyrics(track, attempt) {
        clearTimeout(this.lyricsRetryTimer);
        this.lyricsStatus = 'loading';
        let data;
        try {
            const params = new URLSearchParams({ track: track.name, artist: track.artist });
            if (track.durationMs) {
                params.set('duration_ms', track.durationMs);
            }
            const response = await fetch(`/lyrics?${params}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            data = await response.json();
        } catch (error) {
            if (this.track !== track) return;
            // A failed request doesn't mean the song has no lyrics, so try again shortly
            console.warn('Lyrics error:', error);
            if (attempt < LYRICS_RETRY_MS.length) {
                this.lyricsRetryTimer = setTimeout(() => this.fetchLyrics(track, attempt + 1), LYRICS_RETRY_MS[attempt]);
            } else {
                this.lyricsStatus = 'error';
            }
            return;
        }

        // The track may have changed while this was loading
        if (this.track !== track) return;

        this.lyrics = data.lines || [];
        this.lyricsStatus = this.lyrics.length > 0 ? 'ready' : 'none';
        this.lyricIndex = -1;
        this.el.lyricsLines.replaceChildren(...this.lyrics.map(line => {
            const element = document.createElement('div');
            element.className = 'lyric-line upcoming';
            element.textContent = line.words;
            return element;
        }));
        this.syncLyric(this.currentPositionMs());
        this.renderLyricPosition(true);
        this.updateView();
    }

    findLyricIndex(positionMs) {
        for (let i = this.lyrics.length - 1; i >= 0; i--) {
            if (positionMs >= this.lyrics[i].startTimeMs) {
                return i;
            }
        }
        return -1;
    }

    syncLyric(positionMs) {
        if (this.lyrics.length === 0) return;
        const index = this.findLyricIndex(positionMs);
        if (index !== this.lyricIndex) {
            this.lyricIndex = index;
            this.renderLyricPosition();
        }
    }

    // Colour past/current/upcoming lines and scroll the current one to the centre
    renderLyricPosition(instant = false) {
        const lines = this.el.lyricsLines.children;
        if (lines.length === 0) return;
        for (let i = 0; i < lines.length; i++) {
            lines[i].className = `lyric-line ${i < this.lyricIndex ? 'past' : i === this.lyricIndex ? 'current' : 'upcoming'}`;
        }
        const focus = lines[Math.max(this.lyricIndex, 0)];
        const centre = this.el.lyricsView.clientHeight * 0.47;
        const offset = centre - (focus.offsetTop + focus.offsetHeight / 2);
        this.el.lyricsLines.classList.toggle('instant', instant);
        this.el.lyricsLines.style.transform = `translateY(${offset}px)`;
    }

    // ---------- Album colour ----------

    applyAlbumColor(url) {
        if (!url) {
            this.setAlbumColor({ hue: 0, saturation: 0 });
            return;
        }
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => {
            if (this.track?.art !== url) return;
            try {
                this.setAlbumColor(coverHueSaturation(image));
            } catch (error) {
                this.setAlbumColor({ hue: 0, saturation: 0 });
            }
        };
        image.onerror = () => this.setAlbumColor({ hue: 0, saturation: 0 });
        image.src = url;
    }

    setAlbumColor({ hue, saturation }) {
        // Fixed lightness keeps white and dark lyric lines readable on any cover
        const s = saturation < 0.08 ? 0 : clamp(saturation * 100, 30, 70);
        this.el.player.style.setProperty('--album', `hsl(${hue.toFixed(0)} ${s.toFixed(0)}% 34%)`);
        this.el.player.style.setProperty('--album-deep', `hsl(${hue.toFixed(0)} ${s.toFixed(0)}% 16%)`);
    }

    // ---------- Record gestures ----------

    handlePointerDown(e) {
        if (!this.track || this.isLibraryOpen() || this.drag || e.button !== 0) return;
        e.preventDefault();
        // Keep receiving moves and the release even if the pointer leaves the circle
        this.el.disc.setPointerCapture(e.pointerId);

        const rect = this.el.disc.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const startPositionMs = this.currentPositionMs();
        this.drag = {
            pointerId: e.pointerId,
            centerX,
            centerY,
            lastAngle: Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180 / Math.PI,
            totalDegrees: 0,
            startPositionMs,
            positionMs: startPositionMs,
            seeking: false
        };
    }

    handlePointerMove(e) {
        const drag = this.drag;
        if (!drag || e.pointerId !== drag.pointerId) return;
        e.preventDefault();

        const angle = Math.atan2(e.clientY - drag.centerY, e.clientX - drag.centerX) * 180 / Math.PI;
        let delta = angle - drag.lastAngle;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        drag.lastAngle = angle;
        drag.totalDegrees += delta;
        this.rotation += delta;

        if (!drag.seeking && Math.abs(drag.totalDegrees) >= TAP_MAX_DEGREES) {
            drag.seeking = true;
            this.el.seekTotal.textContent = `/ ${formatTime(this.track.durationMs)}`;
            this.el.player.classList.add('is-seeking');
        }
        const msPerDegree = Number(this.settings.scrubSeconds) * 1000 / 360;
        drag.positionMs = clamp(drag.startPositionMs + drag.totalDegrees * msPerDegree, 0, this.track.durationMs);
        this.el.seekTime.textContent = formatTime(drag.positionMs);
    }

    handlePointerUp(e) {
        const drag = this.drag;
        if (!drag || e.pointerId !== drag.pointerId) return;
        e.preventDefault();
        this.drag = null;
        this.el.player.classList.remove('is-seeking');

        if (!drag.seeking) {
            if (e.type === 'pointerup') this.handleTap();
            return;
        }
        if (Math.abs(drag.positionMs - drag.startPositionMs) >= MIN_SEEK_MS) {
            this.seekTo(drag.positionMs);
        }
    }

    // Tap a stopped record to start it; tap a spinning one to switch between cover and lyrics
    handleTap() {
        if (this.controlsHiddenAtPointerDown) return;
        if (!this.isPlaying) {
            this.playPause();
            return;
        }
        if (this.lyrics.length === 0) {
            // Switch to lyrics as soon as they arrive
            if (this.lyricsStatus !== 'none') this.showLyrics = true;
            if (this.lyricsStatus === 'loading') {
                this.showToast('Finding lyrics…');
            } else if (this.lyricsStatus === 'error') {
                this.showToast('Lyrics unavailable, trying again…');
                this.fetchLyrics(this.track, 0);
            } else {
                this.showToast('No lyrics for this song');
            }
            return;
        }
        this.showLyrics = this.view !== 'lyrics';
        this.introUntil = 0;
        this.updateView();
    }

    // ---------- Playback controls ----------

    async seekTo(positionMs) {
        const ms = Math.floor(positionMs);
        this.setPosition(ms);
        this.seekTarget = ms;
        this.seekSettleUntil = performance.now() + SEEK_SETTLE_MS;
        try {
            // The SDK only controls playback that's on this device
            if (this.isSDKReady && await this.player.getCurrentState()) {
                await this.player.seek(ms);
            } else {
                await this.postJson('/seek', { position_ms: ms });
            }
        } catch (error) {
            console.error('Seek error:', error);
            this.showToast("Couldn't skip to that point");
        }
    }

    async playPause() {
        if (!this.track) return;
        try {
            if (this.isSDKReady && await this.player.getCurrentState()) {
                await this.player.togglePlay();
            } else {
                const data = await this.postJson('/play-pause');
                this.setPosition(this.currentPositionMs());
                this.setPlaying(data.action === 'playing');
            }
        } catch (error) {
            console.error('Play/pause error:', error);
            this.showToast("Couldn't reach Spotify");
        }
    }

    async nextTrack() {
        try {
            if (this.isSDKReady && await this.player.getCurrentState()) {
                await this.player.nextTrack();
            } else {
                await this.postJson('/next-track');
            }
        } catch (error) {
            console.error('Next track error:', error);
            this.showToast("Couldn't skip");
        }
    }

    async previousTrack() {
        try {
            if (this.isSDKReady && await this.player.getCurrentState()) {
                await this.player.previousTrack();
            } else {
                await this.postJson('/previous-track');
            }
        } catch (error) {
            console.error('Previous track error:', error);
            this.showToast("Couldn't go back");
        }
    }

    // POST/PUT JSON; throws on network errors and on {error} responses from the server
    async postJson(url, body, method = 'POST') {
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        const data = await response.json();
        if (!response.ok || data.error) {
            throw new Error(data.error || `HTTP ${response.status}`);
        }
        return data;
    }

    async play(item) {
        // Play on this device when it's connected, otherwise on whichever device is active
        const deviceId = this.isSDKReady ? this.deviceId : undefined;
        try {
            // Big playlists take a moment to load
            const slow = setTimeout(() => this.showToast('Loading…'), 600);
            try {
                await this.postJson('/api/play', { type: item.kind, id: item.id, device_id: deviceId });
            } finally {
                clearTimeout(slow);
            }
            this.closeLibrary();
            this.refreshQueue();
        } catch (error) {
            console.error('Play error:', error);
            this.showToast(/NO_ACTIVE_DEVICE|No active device/i.test(error.message)
                ? 'Open Spotify on a device first'
                : "Couldn't play that");
        }
    }

    // ---------- Library ----------

    isLibraryOpen() {
        return this.el.player.classList.contains('library-open');
    }

    toggleLibrary() {
        if (this.isLibraryOpen()) {
            this.closeLibrary();
        } else {
            this.openLibrary();
        }
    }

    openLibrary() {
        this.el.player.classList.add('library-open');
        this.el.library.setAttribute('aria-hidden', 'false');
        this.el.libraryBtn.setAttribute('aria-label', 'Close library');
        this.el.searchInput.value = '';
        this.loadLibraryTab(this.libraryTab);
    }

    closeLibrary() {
        this.el.player.classList.remove('library-open');
        this.el.library.setAttribute('aria-hidden', 'true');
        this.el.libraryBtn.setAttribute('aria-label', 'Open library');
        this.el.searchInput.blur();
        clearTimeout(this.searchTimer);
        this.wakeControls();
    }

    loadLibraryTab(tab) {
        this.libraryTab = tab;
        this.setActiveChip(tab);
        const showingSettings = tab === 'settings';
        this.el.library.classList.toggle('showing-settings', showingSettings);
        this.el.libraryTitle.textContent = showingSettings ? 'Settings' : 'Your Library';
        if (showingSettings) {
            this.libraryRequest++;   // drop any list still loading
            this.renderSettings();
            return;
        }
        if (tab === 'queue') {
            this.loadQueue();
            return;
        }
        const source = LIBRARY_SOURCES[tab];
        this.loadList(source.url, data => data.items, source.kind);
    }

    setActiveChip(tab) {
        this.el.chips.forEach(chip => {
            const active = chip.dataset.tab === tab;
            chip.classList.toggle('active', active);
            chip.setAttribute('aria-selected', String(active));
        });
    }

    handleSearchInput() {
        clearTimeout(this.searchTimer);
        const query = this.el.searchInput.value.trim();
        this.searchTimer = setTimeout(() => {
            if (query.length < 2) {
                this.loadLibraryTab(this.libraryTab);
                return;
            }
            this.setActiveChip(null);
            this.el.library.classList.remove('showing-settings');
            this.el.libraryTitle.textContent = 'Your Library';
            const params = new URLSearchParams({ q: query, type: 'track', limit: 20 });
            this.loadList(`/api/search?${params}`, data => data.tracks?.items, 'track', 'No results');
        }, 300);
    }

    async loadList(url, pickItems, kind, emptyMessage = 'Nothing here yet') {
        const request = ++this.libraryRequest;
        this.renderSkeleton();
        try {
            const response = await fetch(url);
            const data = await response.json();
            if (!response.ok || data.error) {
                throw new Error(data.error || `HTTP ${response.status}`);
            }
            // A newer tab or search replaced this one while it loaded
            if (request !== this.libraryRequest) return;

            const seen = new Set();
            const items = (pickItems(data) || []).filter(item => {
                // Recently played repeats songs; show each once
                if (!item?.id || seen.has(item.id)) return false;
                seen.add(item.id);
                return true;
            });
            this.renderList(items, kind, emptyMessage);
        } catch (error) {
            console.error('Library error:', error);
            if (request === this.libraryRequest) {
                this.renderListMessage("Couldn't load your library. Check your connection and try again.");
            }
        }
    }

    renderSkeleton() {
        this.el.libraryList.innerHTML = Array.from({ length: 6 }, () => `
            <div class="row skeleton"><span class="row-art"></span><span class="row-text"><span class="row-title"></span><span class="row-meta"></span></span></div>
        `).join('');
    }

    renderListMessage(message) {
        this.el.libraryList.innerHTML = `<div class="list-message">${escapeHtml(message)}</div>`;
    }

    renderList(items, kind, emptyMessage) {
        if (items.length === 0) {
            this.renderListMessage(emptyMessage);
            return;
        }
        this.el.libraryList.replaceChildren(...items.map(item => {
            const { art, meta } = this.describeItem(item, kind);
            return this.buildRow({
                art,
                title: item.name,
                meta,
                uri: item.uri,
                onSelect: () => this.play({ kind, id: item.id }),
                // Songs can go in the queue; playlists and albums can't
                onAdd: kind === 'track' && item.uri ? () => this.addToQueue(item.uri, item.name) : null
            });
        }));
        this.highlightPlayingRows();
        this.el.libraryList.scrollTop = 0;
    }

    buildRow({ art, title, meta, uri, onSelect, onAdd }) {
        const row = document.createElement('div');
        row.className = 'row';
        row.dataset.uri = uri || '';

        const main = document.createElement('button');
        main.type = 'button';
        main.className = 'row-main';
        main.innerHTML = `
            <span class="row-art" style="background-image: url('${escapeHtml(art)}')"></span>
            <span class="row-text">
                <span class="row-title">${escapeHtml(title)}</span>
                <span class="row-meta">${escapeHtml(meta)}</span>
            </span>
        `;
        main.addEventListener('click', onSelect);
        row.appendChild(main);

        if (onAdd) {
            const add = document.createElement('button');
            add.type = 'button';
            add.className = 'row-add';
            add.setAttribute('aria-label', `Add ${title} to queue`);
            add.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="1.8" /><path d="M12 7.5v9M7.5 12h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>';
            add.addEventListener('click', onAdd);
            row.appendChild(add);
        }
        return row;
    }

    // ---------- Queue ----------
    // The server keeps the queue; every change returns its new state, which is rendered as is.

    isShowingQueue() {
        return this.isLibraryOpen() && this.libraryTab === 'queue' && !this.el.searchInput.value.trim();
    }

    async refreshQueue() {
        try {
            const response = await fetch('/api/queue');
            const data = await response.json();
            if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
            this.applyQueue(data);
        } catch (error) {
            console.warn('Queue error:', error);
        }
    }

    applyQueue(state) {
        this.queue = state;
        // The server ignores reports for a moment after it re-sends the queue to Spotify, so if it
        // still disagrees with what's playing, tell it again shortly
        clearTimeout(this.queueReportTimer);
        // Spotify can play another version of a song under a different ID, so compare names too
        const disagrees = state.active && state.current && this.track
            && state.current.uri !== this.track.uri && state.current.name !== this.track.name;
        this.queueReports = disagrees ? (this.queueReports || 0) + 1 : 0;
        // A few tries is enough; a song that isn't in the queue at all (e.g. queued from a phone) stays unknown
        if (disagrees && this.queueReports <= 3) {
            this.queueReportTimer = setTimeout(() => {
                if (this.track) this.reportNowPlaying({ ...this.track, positionMs: this.currentPositionMs() });
            }, 3500);
        }
        this.renderModeButtons();
        this.highlightPlayingRows();
        // Don't redraw under a finger that's dragging a row
        if (this.isShowingQueue() && !this.queueDrag) this.renderQueue(state);
    }

    async loadQueue() {
        const request = ++this.libraryRequest;
        if (this.queue) this.renderQueue(this.queue); else this.renderSkeleton();
        try {
            const response = await fetch('/api/queue');
            const data = await response.json();
            if (!response.ok || data.error) {
                throw new Error(data.error || `HTTP ${response.status}`);
            }
            if (request !== this.libraryRequest) return;
            this.applyQueue(data);
        } catch (error) {
            console.error('Queue error:', error);
            if (request === this.libraryRequest) {
                this.renderListMessage("Couldn't load your queue. Start playing something first.");
            }
        }
    }

    renderQueue(state) {
        const upNext = state.next_in_queue || [];
        const nextFrom = state.next_from || [];
        if (!state.current && upNext.length === 0 && nextFrom.length === 0) {
            this.renderListMessage('Your queue is empty. Play a playlist, or add songs with + in search or Recent.');
            return;
        }
        const editable = state.active;
        const scroll = this.el.libraryList.scrollTop;
        const heading = (text, action) => {
            const wrap = document.createElement('div');
            wrap.className = 'queue-heading';
            const title = document.createElement('h3');
            title.className = 'settings-heading';
            title.textContent = text;
            wrap.appendChild(title);
            if (action) wrap.appendChild(action);
            return wrap;
        };
        const section = (entries, offset) => {
            const element = document.createElement('div');
            element.className = 'queue-section';
            entries.forEach((track, index) => element.appendChild(this.buildQueueRow(track, editable, offset + index)));
            return element;
        };

        const children = [];
        if (state.current) {
            const now = this.buildRow({
                art: state.current.album_art, title: state.current.name, meta: (state.current.artists || []).join(', '),
                uri: state.current.uri, onSelect: () => this.closeLibrary()
            });
            now.classList.add('playing');
            children.push(heading('Now playing'), now);
        }
        if (upNext.length > 0) {
            const clear = document.createElement('button');
            clear.type = 'button';
            clear.className = 'queue-clear';
            clear.textContent = 'Clear queue';
            clear.addEventListener('click', () => this.editQueue('clear'));
            children.push(heading('Next in queue', editable ? clear : null), section(upNext, 0));
        }
        if (nextFrom.length > 0) {
            const name = state.context?.name;
            children.push(heading(name ? `Next from: ${name}` : 'Next up'), section(nextFrom, upNext.length));
            const more = (state.next_from_total || 0) - nextFrom.length;
            if (more > 0) children.push(this.queueNote(`and ${more} more`));
        }
        if (!editable) {
            children.push(this.queueNote('Started on another device. Play a playlist here to edit the queue.'));
        }
        this.el.libraryList.replaceChildren(...children);
        this.el.libraryList.scrollTop = scroll;
    }

    queueNote(text) {
        const note = document.createElement('p');
        note.className = 'queue-note';
        note.textContent = text;
        return note;
    }

    buildQueueRow(track, editable, position) {
        const row = this.buildRow({
            art: track.album_art,
            title: track.name,
            meta: (track.artists || []).join(', '),
            uri: track.uri,
            // Spotify's own queue has no "play this item" command, so skip forward to it instead
            onSelect: editable ? () => this.jumpTo(track.uid) : () => this.skipAhead(position + 1)
        });
        if (!editable) return row;
        row.dataset.uid = track.uid;

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'row-remove';
        remove.setAttribute('aria-label', `Remove ${track.name} from queue`);
        remove.innerHTML = ICON_REMOVE;
        remove.addEventListener('click', () => {
            row.classList.add('removing');
            this.editQueue('remove', { uid: track.uid });
        });

        const handle = document.createElement('button');
        handle.type = 'button';
        handle.className = 'row-handle';
        handle.setAttribute('aria-label', `Drag to reorder ${track.name}`);
        handle.innerHTML = ICON_HANDLE;
        handle.addEventListener('pointerdown', e => this.startQueueDrag(e, row));

        row.append(remove, handle);
        return row;
    }

    async editQueue(action, body = {}) {
        try {
            this.applyQueue(await this.postJson(`/api/queue/${action}`, body));
        } catch (error) {
            console.error('Queue edit error:', error);
            this.showToast(error.message.includes('another device') ? error.message : "Couldn't change the queue");
            this.refreshQueue();
        }
    }

    async jumpTo(uid) {
        this.closeLibrary();
        await this.editQueue('play', { uid });
    }

    // Drag a row by its handle; other rows make room as it passes them
    startQueueDrag(e, row) {
        e.preventDefault();
        const pointerId = e.pointerId;
        const sectionEl = row.parentElement;
        this.queueDrag = { row, sectionEl, startY: e.clientY, startTop: row.offsetTop, startIndex: [...sectionEl.children].indexOf(row) };
        row.classList.add('dragging');

        // Listen on the window: moving the row in the DOM would drop pointer capture on the handle
        const move = event => {
            const drag = this.queueDrag;
            if (!drag || event.pointerId !== pointerId) return;
            // Swap with a neighbour once the finger passes its middle
            const siblings = [...sectionEl.children].filter(child => child !== row);
            const y = event.clientY;
            const before = siblings.find(child => {
                const box = child.getBoundingClientRect();
                return y < box.top + box.height / 2;
            });
            if (before !== row.nextElementSibling) {
                sectionEl.insertBefore(row, before || null);
            }
            row.style.transform = `translateY(${y - drag.startY - (row.offsetTop - drag.startTop)}px)`;

            // Scroll when dragging near the top or bottom of the list
            const list = this.el.libraryList.getBoundingClientRect();
            if (y < list.top + 40) this.el.libraryList.scrollTop -= 12;
            else if (y > list.bottom - 40) this.el.libraryList.scrollTop += 12;
        };
        const end = event => {
            if (event.pointerId !== pointerId) return;
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', end);
            window.removeEventListener('pointercancel', end);
            const drag = this.queueDrag;
            this.queueDrag = null;
            row.classList.remove('dragging');
            row.style.transform = '';
            const index = [...sectionEl.children].indexOf(row);
            if (drag && index !== drag.startIndex) {
                this.editQueue('move', { uid: row.dataset.uid, index });
            }
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
    }

    async addToQueue(uri, name) {
        try {
            const data = await this.postJson('/api/queue/add', { track_uri: uri });
            if ('active' in data) this.applyQueue(data);
            this.showToast(`Added ${name} to queue`);
        } catch (error) {
            console.error('Add to queue error:', error);
            this.showToast(/NO_ACTIVE_DEVICE|No active device/i.test(error.message)
                ? 'Start playing something first'
                : "Couldn't add to queue");
        }
    }

    // Used only for Spotify's own queue, which can't jump straight to an item
    async skipAhead(count) {
        this.closeLibrary();
        try {
            for (let i = 0; i < count; i++) {
                await this.postJson('/next-track');
            }
        } catch (error) {
            console.error('Skip ahead error:', error);
            this.showToast("Couldn't skip ahead");
        }
    }

    // ---------- Shuffle & repeat ----------

    renderModeButtons() {
        const shuffle = Boolean(this.queue?.shuffle);
        const repeat = this.queue?.repeat || 'off';
        this.el.shuffleBtn.setAttribute('aria-pressed', String(shuffle));
        this.el.shuffleBtn.setAttribute('aria-label', shuffle ? 'Shuffle: on' : 'Shuffle: off');
        this.el.repeatBtn.dataset.repeat = repeat;
        this.el.repeatBtn.setAttribute('aria-label', REPEAT_LABELS[repeat]);
    }

    async toggleShuffle() {
        const state = !this.queue?.shuffle;
        this.queue = { ...this.queue, shuffle: state };
        this.renderModeButtons();
        try {
            const data = await this.postJson('/api/shuffle', { state, device_id: this.isSDKReady ? this.deviceId : undefined }, 'PUT');
            if ('active' in data) this.applyQueue(data); else this.refreshQueue();
        } catch (error) {
            console.error('Shuffle error:', error);
            this.showToast("Couldn't change shuffle");
            this.refreshQueue();
        }
    }

    async cycleRepeat() {
        const state = REPEAT_CYCLE[this.queue?.repeat || 'off'];
        this.queue = { ...this.queue, repeat: state };
        this.renderModeButtons();
        try {
            const data = await this.postJson('/api/repeat', { state }, 'PUT');
            if ('active' in data) this.applyQueue(data); else this.refreshQueue();
        } catch (error) {
            console.error('Repeat error:', error);
            this.showToast("Couldn't change repeat");
            this.refreshQueue();
        }
    }

    describeItem(item, kind) {
        const artists = (item.artists || []).map(artist => artist.name).join(', ');
        if (kind === 'playlist') {
            const owner = item.owner?.display_name;
            return { art: smallImage(item.images), meta: owner ? `Playlist · ${owner}` : 'Playlist' };
        }
        if (kind === 'album') {
            return { art: smallImage(item.images), meta: `Album · ${artists}` };
        }
        return { art: smallImage(item.album?.images), meta: artists };
    }

    highlightPlayingRows() {
        if (this.libraryTab === 'queue' && !this.el.searchInput.value.trim()) return;
        const playing = [this.track?.uri, this.track?.contextUri, this.queue?.active && this.queue.context?.uri].filter(Boolean);
        this.el.libraryList.querySelectorAll('.row[data-uri]').forEach(row => {
            row.classList.toggle('playing', playing.includes(row.dataset.uri));
        });
    }

    // ---------- Settings ----------

    renderSettings() {
        const groups = SETTINGS_SCHEMA.map(group => {
            const section = document.createElement('section');
            section.className = 'settings-group';
            section.innerHTML = `<h3 class="settings-heading">${escapeHtml(group.section)}</h3>`;
            group.items.forEach(item => section.appendChild(this.renderSettingRow(item)));
            return section;
        });

        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'settings-reset';
        reset.textContent = 'Reset to defaults';
        reset.addEventListener('click', () => {
            this.settings = { ...DEFAULT_SETTINGS };
            saveSettings(this.settings);
            this.applySettings();
            this.renderSettings();
            this.showToast('Settings reset');
        });

        this.el.libraryList.replaceChildren(...groups, reset);
    }

    renderSettingRow(item) {
        const row = document.createElement('div');
        row.className = `setting setting-${item.type}`;
        const description = item.description ? `<span class="setting-description">${escapeHtml(item.description)}</span>` : '';
        row.innerHTML = `<span class="setting-text"><span class="setting-label">${escapeHtml(item.label)}</span>${description}</span>`;

        if (item.type === 'toggle') {
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'switch';
            toggle.setAttribute('role', 'switch');
            toggle.setAttribute('aria-label', item.label);
            toggle.setAttribute('aria-checked', String(this.settings[item.key]));
            toggle.addEventListener('click', () => {
                this.updateSetting(item.key, !this.settings[item.key]);
                toggle.setAttribute('aria-checked', String(this.settings[item.key]));
            });
            row.appendChild(toggle);
        } else {
            const choices = document.createElement('div');
            choices.className = 'segmented';
            choices.setAttribute('role', 'radiogroup');
            choices.setAttribute('aria-label', item.label);
            item.options.forEach(([value, label]) => {
                const option = document.createElement('button');
                option.type = 'button';
                option.textContent = label;
                option.setAttribute('role', 'radio');
                option.setAttribute('aria-checked', String(this.settings[item.key] === value));
                option.addEventListener('click', () => {
                    this.updateSetting(item.key, value);
                    choices.querySelectorAll('button').forEach(other => {
                        other.setAttribute('aria-checked', String(other === option));
                    });
                });
                choices.appendChild(option);
            });
            row.appendChild(choices);
        }
        return row;
    }

    updateSetting(key, value) {
        this.settings[key] = value;
        saveSettings(this.settings);
        this.applySettings();
    }

    // Most settings are plain CSS hooks on the player; the rest are read where they're used
    applySettings() {
        const { player } = this.el;
        const s = this.settings;
        player.dataset.lyricsBackground = s.lyricsBackground;
        player.dataset.lyricsSize = s.lyricsSize;
        player.dataset.ringColor = s.ringColor;
        player.classList.toggle('lyrics-focus', !s.lyricsContext);
        player.classList.toggle('no-texture', !s.vinylTexture);
        player.classList.toggle('no-progress', !s.showProgress);
        player.classList.toggle('no-clock', !s.idleClock);
        this.refreshSongInfoFade();
        this.wakeControls();
        // Text size changes line heights, so re-centre the current line
        requestAnimationFrame(() => this.renderLyricPosition(true));
    }

    // With "Fade song info" on, the title and artist fade out 5s after the cover appears
    refreshSongInfoFade() {
        clearTimeout(this.songInfoTimer);
        this.el.player.classList.remove('song-info-faded');
        if (this.settings.fadeSongInfo && this.isPlaying && this.view === 'art') {
            this.songInfoTimer = setTimeout(() => this.el.player.classList.add('song-info-faded'), AUTO_HIDE_MS);
        }
    }

    // With "Auto-hide buttons" on, buttons fade out after 5s without a touch while playing
    wakeControls() {
        clearTimeout(this.controlsTimer);
        this.el.player.classList.remove('controls-hidden');
        if (this.settings.autoHideControls && this.isPlaying && !this.isLibraryOpen()) {
            this.controlsTimer = setTimeout(() => this.el.player.classList.add('controls-hidden'), AUTO_HIDE_MS);
        }
    }

    updateClock() {
        const now = new Date();
        this.el.idleTime.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        this.el.idleDate.textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    }

    // ---------- Feedback & keyboard ----------

    showToast(message) {
        this.el.toast.textContent = message;
        this.el.toast.classList.add('visible');
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => this.el.toast.classList.remove('visible'), TOAST_MS);
    }

    handleKeydown(e) {
        if (e.key === 'Escape' && this.isLibraryOpen()) {
            this.closeLibrary();
            return;
        }
        const typing = e.target instanceof HTMLInputElement;
        if (typing || e.target instanceof HTMLButtonElement) return;
        if (e.key === ' ') {
            e.preventDefault();
            this.playPause();
        } else if (e.key === 'ArrowRight' && this.track) {
            this.seekTo(Math.min(this.currentPositionMs() + 10000, this.track.durationMs));
        } else if (e.key === 'ArrowLeft' && this.track) {
            this.seekTo(Math.max(this.currentPositionMs() - 10000, 0));
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new VinylPlayer();
});
