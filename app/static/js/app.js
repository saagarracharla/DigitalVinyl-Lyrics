/**
 * Digital Vinyl: a circular Spotify player with synced lyrics.
 * Built for a round 1080x1080 display; the layout scales with the circle.
 */

const DEVICE_NAME = 'Digital Vinyl';

const SPIN_DEGREES_PER_MS = 360 / 20000;   // one turn every 20s while playing
const SEEK_MS_PER_DEGREE = 30000 / 360;    // a full turn of the record seeks 30s
const TAP_MAX_DEGREES = 3;                 // turning less than this counts as a tap
const MIN_SEEK_MS = 500;                   // smaller net drags don't seek
const ART_INTRO_MS = 4000;                 // show the cover this long before lyrics on a new track
const SEEK_SETTLE_MS = 2000;               // after seeking, ignore stale positions for this long
const SYNC_INTERVAL_MS = 1000;
const TOAST_MS = 2600;

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
            'libraryBtn', 'prevBtn', 'playPauseBtn', 'nextBtn', 'toast'
        ].map(id => [id, document.getElementById(id)]));
        this.el.chips = [...document.querySelectorAll('.chip')];

        this.bindEvents();
        requestAnimationFrame(now => this.frame(now));

        // Show whatever is playing right away (even on another device), then keep in sync
        this.sync();
        setInterval(() => this.sync(), SYNC_INTERVAL_MS);
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

        this.isPlaying = playback.isPlaying;
        this.el.player.classList.toggle('is-playing', this.isPlaying);
        this.el.playPauseBtn.setAttribute('aria-label', this.isPlaying ? 'Pause' : 'Play');
        this.updateView();
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

        // Each new record starts on its cover, then moves to lyrics
        this.introUntil = performance.now() + ART_INTRO_MS;
        clearTimeout(this.introTimer);
        this.introTimer = setTimeout(() => this.updateView(), ART_INTRO_MS);

        this.fetchLyrics(track);
        this.highlightPlayingRows();
    }

    clearTrack() {
        if (!this.track) return;
        this.track = null;
        this.isPlaying = false;
        this.lyrics = [];
        this.el.lyricsLines.innerHTML = '';
        this.el.player.classList.remove('is-playing');
        this.updateView();
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
        if (this.lastFrameTime !== null && this.isPlaying && !this.drag && !reducedMotion.matches) {
            this.rotation = (this.rotation + (now - this.lastFrameTime) * SPIN_DEGREES_PER_MS) % 360;
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
    }

    // ---------- Lyrics ----------

    async fetchLyrics(track) {
        try {
            const params = new URLSearchParams({ track: track.name, artist: track.artist });
            if (track.durationMs) {
                params.set('duration_ms', track.durationMs);
            }
            const response = await fetch(`/lyrics?${params}`);
            const data = await response.json();

            // The track may have changed while this was loading
            if (this.track !== track) return;

            this.lyrics = data.lines || [];
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
        } catch (error) {
            console.error('Lyrics error:', error);
        }
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
        drag.positionMs = clamp(drag.startPositionMs + drag.totalDegrees * SEEK_MS_PER_DEGREE, 0, this.track.durationMs);
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
        if (!this.isPlaying) {
            this.playPause();
            return;
        }
        if (this.lyrics.length === 0) {
            this.showToast('No lyrics for this song');
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
                this.isPlaying = data.action === 'playing';
                this.el.player.classList.toggle('is-playing', this.isPlaying);
                this.updateView();
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
            if (item.kind === 'playlist') {
                // Playlists start shuffled; if shuffle fails, still play
                await this.postJson('/api/shuffle', { state: true, device_id: deviceId }, 'PUT')
                    .catch(error => console.warn('Shuffle failed:', error));
            }
            await this.postJson('/api/play', { type: item.kind, id: item.id, device_id: deviceId });
            this.showLyrics = true;
            this.closeLibrary();
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
    }

    loadLibraryTab(tab) {
        this.libraryTab = tab;
        this.setActiveChip(tab);
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
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'row';
            row.dataset.uri = item.uri || '';
            row.innerHTML = `
                <span class="row-art" style="background-image: url('${escapeHtml(art)}')"></span>
                <span class="row-text">
                    <span class="row-title">${escapeHtml(item.name)}</span>
                    <span class="row-meta">${escapeHtml(meta)}</span>
                </span>
            `;
            row.addEventListener('click', () => this.play({ kind, id: item.id }));
            return row;
        }));
        this.highlightPlayingRows();
        this.el.libraryList.scrollTop = 0;
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
        const playing = [this.track?.uri, this.track?.contextUri].filter(Boolean);
        this.el.libraryList.querySelectorAll('.row[data-uri]').forEach(row => {
            row.classList.toggle('playing', playing.includes(row.dataset.uri));
        });
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
