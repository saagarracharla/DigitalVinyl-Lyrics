/**
 * Full Spotify Player with Web Playback SDK
 * Circular screen optimized for 1080x1080
 */
class SpotifyPlayer {
    constructor() {
        // State
        this.currentTrack = null;
        this.lyrics = [];
        this.currentLyricIndex = -1;
        this.isVinylMode = false;
        this.vinylState = 'idle'; // idle, track-info, lyrics, browsing
        this.browsingState = null; // playlists, albums, tracks, search
        this.browsingData = [];
        this.selectedIndex = 0;
        
        // Web Playback SDK
        this.player = null;
        this.deviceId = null;
        this.accessToken = null;
        this.isSDKReady = false;
        
        // Progress tracking
        this.actualCurrentPosition = 0;
        this.lastUpdateTime = 0;
        this.smoothProgressInterval = null;
        this.lyricsUpdateInterval = null; // For continuous lyric updates
        this.isDragging = false;
        this.justSeeked = false;
        this.seekPosition = 0;
        this.gestureStartPosition = 0;
        this.totalAngleChange = 0;
        this.lastAngle = 0;
        this.centerX = 0;
        this.centerY = 0;
        
        this.initializeElements();
        this.bindEvents();
        this.initializeWebPlaybackSDK();
        
        console.log('🎵 Spotify Player initialized');
    }
    
    initializeElements() {
        // Normal mode
        this.statusEl = document.getElementById('status');
        this.progressContainer = document.getElementById('progressContainer');
        this.progressFill = document.getElementById('progressFill');
        this.lyricsContainer = document.getElementById('lyricsContainer');
        this.vinylBtn = document.getElementById('vinylBtn');
        this.refreshBtn = document.getElementById('refreshBtn');
        
        // Vinyl mode
        this.vinylMode = document.getElementById('vinylMode');
        this.vinylCircle = document.querySelector('.vinyl-circle');
        this.albumArt = document.getElementById('albumArt');
        this.albumOverlay = document.getElementById('albumOverlay');
        this.trackInfo = document.getElementById('trackInfo');
        this.lyricDisplay = document.getElementById('lyricDisplay');
        this.browsingDisplay = document.getElementById('browsingDisplay');
        this.vinylArtist = document.getElementById('vinylArtist');
        this.vinylTitle = document.getElementById('vinylTitle');
        this.previousLyric = document.getElementById('previousLyric');
        this.currentLyric = document.getElementById('currentLyric');
        this.nextLyric = document.getElementById('nextLyric');
        this.browsingItems = document.getElementById('browsingItems');
        this.browsingHeader = document.getElementById('browsingHeader');
        this.browsingLoading = document.getElementById('browsingLoading');
        
        // Controls
        this.prevBtn = document.getElementById('prevBtn');
        this.playPauseBtn = document.getElementById('playPauseBtn');
        this.nextBtn = document.getElementById('nextBtn');
        this.menuBtn = document.getElementById('menuBtn');
        this.backBtn = document.getElementById('backBtn');
        this.navMenu = document.getElementById('navMenu');
        
        // Timestamps
        this.seekTimestamp = document.getElementById('seekTimestamp');
        this.pauseTimestamp = document.getElementById('pauseTimestamp');
        
        // Progress ring
        this.progressRing = document.getElementById('progressRing');
        this.progressCircumference = 2 * Math.PI * 535;
        
        // Search
        this.searchModal = document.getElementById('searchModal');
        this.searchInput = document.getElementById('searchInput');
        this.searchResults = document.getElementById('searchResults');
        
        // Playback state
        this.currentPlaylistId = null;
        this.currentPlaylistTracks = [];
    }
    
    bindEvents() {
        // Normal mode buttons
        this.vinylBtn?.addEventListener('click', () => this.toggleVinylMode());
        this.refreshBtn?.addEventListener('click', () => location.reload());
        
        // Playback controls
        this.prevBtn?.addEventListener('click', () => this.previousTrack());
        this.playPauseBtn?.addEventListener('click', () => this.playPause());
        this.nextBtn?.addEventListener('click', () => this.nextTrack());
        this.menuBtn?.addEventListener('click', () => this.toggleNavMenu());
        this.backBtn?.addEventListener('click', () => this.goBack());
        
        // Navigation menu
        this.navMenu?.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const action = e.target.dataset.action;
                this.handleNavAction(action);
            });
        });
        
        // Touch gestures
        this.vinylCircle?.addEventListener('touchstart', (e) => this.handleTouchStart(e));
        this.vinylCircle?.addEventListener('touchmove', (e) => this.handleTouchMove(e));
        this.vinylCircle?.addEventListener('touchend', (e) => this.handleTouchEnd(e));
        
        // Mouse events (desktop)
        this.vinylCircle?.addEventListener('mousedown', (e) => this.handleMouseStart(e));
        this.vinylCircle?.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.vinylCircle?.addEventListener('mouseup', (e) => this.handleMouseEnd(e));
        
        // Search
        this.searchInput?.addEventListener('input', (e) => this.handleSearchInput(e));
        this.searchInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.performSearch(this.searchInput.value);
            } else if (e.key === 'Escape') {
                this.closeSearch();
            }
        });
        
        // Click outside to close modals
        document.addEventListener('click', (e) => {
            if (this.searchModal && !this.searchModal.contains(e.target) && e.target !== this.menuBtn) {
                if (this.searchModal.style.display !== 'none') {
                    this.closeSearch();
                }
            }
        });
    }
    
    async initializeWebPlaybackSDK() {
        try {
            // Get access token
            const tokenResponse = await fetch('/api/access-token');
            const tokenData = await tokenResponse.json();
            
            if (tokenData.error) {
                console.error('Failed to get access token:', tokenData.error);
                // Fallback to polling
                this.startPollingFallback();
                return;
            }
            
            this.accessToken = tokenData.access_token;
            
            // Wait for SDK to load
            if (window.Spotify) {
                this.setupPlayer();
            } else {
                window.onSpotifyWebPlaybackSDKReady = () => this.setupPlayer();
            }
        } catch (error) {
            console.error('SDK initialization error:', error);
            this.startPollingFallback();
        }
    }
    
    setupPlayer() {
        this.player = new Spotify.Player({
            name: 'Circular Spotify Player',
            getOAuthToken: cb => { cb(this.accessToken); },
            volume: 0.5
        });
        
        // Error handling
        this.player.addListener('initialization_error', ({ message }) => {
            console.error('SDK initialization error:', message);
            this.startPollingFallback();
        });
        
        this.player.addListener('authentication_error', ({ message }) => {
            console.error('SDK authentication error:', message);
            this.startPollingFallback();
        });
        
        this.player.addListener('account_error', ({ message }) => {
            console.error('SDK account error:', message);
        });
        
        // Ready
        this.player.addListener('ready', ({ device_id }) => {
            console.log('✅ Web Playback SDK ready with Device ID:', device_id);
            this.deviceId = device_id;
            this.isSDKReady = true;
            this.transferPlayback(device_id);
        });
        
        // Not ready
        this.player.addListener('not_ready', ({ device_id }) => {
            console.log('Device has gone offline:', device_id);
        });
        
        // State changes - THIS REPLACES POLLING!
        this.player.addListener('player_state_changed', (state) => {
            if (!state) return;
            this.handlePlayerStateChange(state);
        });
        
        // Also poll for position updates to ensure lyrics stay in sync
        // Web Playback SDK events don't fire frequently enough for smooth lyric updates
        this.startLyricsUpdateInterval();
        
        // Connect
        this.player.connect().then(success => {
            if (success) {
                console.log('✅ Connected to Spotify!');
            }
        });
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
    
    handlePlayerStateChange(state) {
        if (!state || !state.track_window || !state.track_window.current_track) {
            console.log('No track in state');
                return;
            }
            
        const track = state.track_window.current_track;
        const position = state.position;
        const duration = state.duration;
        const paused = state.paused;
        
        // Check if new track - more robust comparison
        const isNewTrack = !this.currentTrack || 
            this.currentTrack.track_name !== track.name ||
            this.currentTrack.artist !== (track.artists[0]?.name || '');
        
        if (isNewTrack) {
            console.log('New track detected:', track.name, 'by', track.artists[0]?.name);
            this.handleNewTrack({
                track_name: track.name,
                artist: track.artists[0]?.name || 'Unknown Artist',
                album_art: track.album?.images?.[0]?.url,
                duration_ms: duration,
                progress_ms: position,
                is_playing: !paused
            });
        }
        
        // Update progress
        // If we just seeked, check if the position matches our seek (within 2 seconds)
        // If so, clear the justSeeked flag early to resume updates
        if (this.justSeeked && Math.abs(position - this.seekPosition) < 2000) {
            console.log('Seek confirmed, resuming updates');
            this.justSeeked = false;
            this.actualCurrentPosition = position;
            this.lastUpdateTime = Date.now();
        }
        
        if (!this.isDragging && !this.justSeeked) {
            this.actualCurrentPosition = position;
            this.lastUpdateTime = Date.now();
            const progress = position / duration;
            this.updateProgressBars(progress);
            
            if (!paused && !this.smoothProgressInterval) {
                this.startSmoothProgress(duration);
            } else if (paused) {
                this.stopSmoothProgress();
            }
            
            // Also update lyrics immediately when position changes (backup to interval)
            if (this.lyrics.length > 0) {
                const newIndex = this.findCurrentLyricIndex(position);
                if (newIndex !== this.currentLyricIndex) {
                    this.currentLyricIndex = newIndex;
                    this.updateActiveLyric();
                }
            }
        }
        
        // Note: Lyrics are updated via startLyricsUpdateInterval() for smoother updates
        // This event-based update is kept as backup but the interval is more reliable
        
        // Handle pause/play
        if (paused && this.vinylState === 'lyrics') {
            this.handlePause();
        } else if (!paused) {
                // Hide pause timestamp when resuming
            if (this.pauseTimestamp) {
                    this.pauseTimestamp.classList.remove('visible');
            }
                    // Resume album art spinning
            if (this.albumArt) {
                    this.albumArt.classList.remove('paused');
                }
                
            // If we have lyrics and were in track-info, transition to lyrics
            if (this.vinylState === 'track-info' && this.lyrics.length > 0) {
                    this.transitionToVinylLyrics();
                }
        }
        
        // Update play/pause button
        this.playPauseBtn.textContent = paused ? '▶' : '⏸';
    }
    
    startLyricsUpdateInterval() {
        // Update lyrics position every 100ms for smooth updates
        // This works alongside Web Playback SDK events
        if (this.lyricsUpdateInterval) {
            clearInterval(this.lyricsUpdateInterval);
        }
        
        this.lyricsUpdateInterval = setInterval(() => {
            if (!this.currentTrack || this.lyrics.length === 0 || this.isDragging) {
                return;
            }
            
            // Try to get position from Web Playback SDK first
            if (this.player && this.isSDKReady) {
                this.player.getCurrentState().then(state => {
                    if (state && !state.paused && state.position !== null && state.position !== undefined) {
                        const newIndex = this.findCurrentLyricIndex(state.position);
                        if (newIndex !== this.currentLyricIndex) {
                            this.currentLyricIndex = newIndex;
                            this.updateActiveLyric();
                        }
                    }
                }).catch(err => {
                    // If SDK fails, use interpolated position
                    if (this.actualCurrentPosition > 0 && this.lastUpdateTime > 0) {
                        const timeSinceUpdate = Date.now() - this.lastUpdateTime;
                        const interpolatedPosition = this.actualCurrentPosition + timeSinceUpdate;
                        const newIndex = this.findCurrentLyricIndex(interpolatedPosition);
                        if (newIndex !== this.currentLyricIndex) {
                            this.currentLyricIndex = newIndex;
                            this.updateActiveLyric();
                        }
                    }
                });
            } else {
                // Fallback: use interpolated position if SDK not available
                if (this.actualCurrentPosition > 0 && this.lastUpdateTime > 0) {
                    const timeSinceUpdate = Date.now() - this.lastUpdateTime;
                    const interpolatedPosition = this.actualCurrentPosition + timeSinceUpdate;
                    const newIndex = this.findCurrentLyricIndex(interpolatedPosition);
                    if (newIndex !== this.currentLyricIndex) {
                        this.currentLyricIndex = newIndex;
                        this.updateActiveLyric();
                    }
                }
            }
        }, 100); // Update every 100ms for smooth lyric transitions
    }
    
    startPollingFallback() {
        console.log('⚠️ Using polling fallback (SDK not available)');
        setInterval(() => this.checkCurrentTrack(), 500);
        // Also start lyrics update interval for fallback
        this.startLyricsUpdateInterval();
    }
    
    async checkCurrentTrack() {
        try {
            const response = await fetch('/current-track');
            const data = await response.json();
            
            if (data.error) {
                console.error('Current track error:', data.error);
                return;
            }
            
            if (data.is_playing) {
                // Check if new track - more robust comparison
                const isNewTrack = !this.currentTrack || 
                    this.currentTrack.track_name !== data.track_name ||
                    this.currentTrack.artist !== data.artist;
                
                if (isNewTrack) {
                    console.log('New track detected (polling):', data.track_name, 'by', data.artist);
                    await this.handleNewTrack(data);
                } else {
                    this.updateTiming(data);
                }
            } else {
                // Not playing - clear lyrics display if needed
                if (!this.isVinylMode && this.statusEl) {
                    this.statusEl.textContent = '⏸️ Paused';
                }
            }
        } catch (error) {
            console.error('Polling error:', error);
        }
    }
    
    updateTiming(trackData) {
        if (!this.isDragging && !this.justSeeked) {
            this.actualCurrentPosition = trackData.progress_ms;
            this.lastUpdateTime = Date.now();
            const progress = trackData.progress_ms / trackData.duration_ms;
            this.updateProgressBars(progress);
            
            if (!this.smoothProgressInterval) {
                this.startSmoothProgress(trackData.duration_ms);
            }
        }
        
        // Update lyrics - this is the main update path for polling fallback
        if (this.lyrics.length > 0 && !this.isDragging) {
            const newIndex = this.findCurrentLyricIndex(trackData.progress_ms);
            if (newIndex !== this.currentLyricIndex) {
                this.currentLyricIndex = newIndex;
                this.updateActiveLyric();
            }
        }
    }
    
    async handleNewTrack(trackData) {
        this.currentTrack = trackData;
        this.currentLyricIndex = -1;
        this.lyrics = [];
        this.clearLyrics();
        
        if (!this.isVinylMode) {
            this.statusEl.textContent = `🎵 ${trackData.artist} - ${trackData.track_name}`;
        }
        this.progressContainer.style.display = 'block';
        
        if (this.isVinylMode) {
            this.showVinylTrackInfo(trackData);
        }
        
        await this.fetchLyrics(trackData);
    }
    
    async fetchLyrics(trackData) {
        try {
            console.log('Fetching lyrics for:', trackData.track_name, 'by', trackData.artist);
            const response = await fetch(`/lyrics?track=${encodeURIComponent(trackData.track_name)}&artist=${encodeURIComponent(trackData.artist)}`);
            const data = await response.json();
            
            console.log('Lyrics response:', data);
            
            if (data.lines && data.lines.length > 0) {
                this.lyrics = data.lines;
                console.log(`Loaded ${this.lyrics.length} lyric lines`);
                this.renderLyrics();
                
                if (this.isVinylMode && this.vinylState === 'track-info') {
                    setTimeout(() => this.transitionToVinylLyrics(), 5000);
                }
            } else {
                console.log('No lyrics found for this track');
                if (!this.isVinylMode && this.statusEl) {
                    this.statusEl.textContent = `🎵 ${trackData.artist} - ${trackData.track_name} (No lyrics available)`;
                }
            }
        } catch (error) {
            console.error('Lyrics error:', error);
            if (!this.isVinylMode && this.statusEl) {
                this.statusEl.textContent = `🎵 ${trackData.artist} - ${trackData.track_name} (Lyrics error)`;
            }
        }
    }
    
    updateProgressBars(progress) {
        if (this.progressFill) {
            this.progressFill.style.width = `${progress * 100}%`;
        }
        
        if (this.isVinylMode && this.progressRing) {
            const offset = this.progressCircumference - (progress * this.progressCircumference);
            this.progressRing.style.strokeDashoffset = offset;
        }
    }
    
    startSmoothProgress(duration) {
        if (this.isDragging || this.justSeeked || this.smoothProgressInterval) return;
        
        this.smoothProgressInterval = setInterval(() => {
            if (this.isDragging || this.justSeeked || !this.currentTrack) {
                this.stopSmoothProgress();
                return;
            }
            
            const timeSinceUpdate = Date.now() - this.lastUpdateTime;
            const interpolatedPosition = this.actualCurrentPosition + timeSinceUpdate;
            const interpolatedProgress = Math.min(1, interpolatedPosition / duration);
            this.updateProgressBars(interpolatedProgress);
        }, 50);
    }
    
    stopSmoothProgress() {
        if (this.smoothProgressInterval) {
            clearInterval(this.smoothProgressInterval);
            this.smoothProgressInterval = null;
        }
    }
    
    findCurrentLyricIndex(currentTime) {
        for (let i = this.lyrics.length - 1; i >= 0; i--) {
            if (currentTime >= this.lyrics[i].startTimeMs) {
                return i;
            }
        }
        return -1;
    }
    
    renderLyrics() {
        this.lyricsContainer.innerHTML = '';
        this.lyrics.forEach((lyric, index) => {
            const element = document.createElement('div');
            element.className = 'lyric-line';
            element.textContent = lyric.words;
            element.dataset.index = index;
            this.lyricsContainer.appendChild(element);
        });
    }
    
    updateActiveLyric() {
        const lyricElements = this.lyricsContainer.querySelectorAll('.lyric-line');
        lyricElements.forEach((el, index) => {
            el.classList.toggle('active', index === this.currentLyricIndex);
        });
        
        if (this.currentLyricIndex >= 0 && !this.isVinylMode) {
            const activeElement = lyricElements[this.currentLyricIndex];
            if (activeElement) {
                activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
        
        if (this.isVinylMode && this.vinylState === 'lyrics') {
                this.updateVinylLyrics();
        }
    }
    
    clearLyrics() {
        this.lyricsContainer.innerHTML = '';
        this.lyrics = [];
        this.currentLyricIndex = -1;
    }
    
    // VINYL MODE
    toggleVinylMode() {
        this.isVinylMode = !this.isVinylMode;
        
        if (this.isVinylMode) {
            this.enterVinylMode();
        } else {
            this.exitVinylMode();
        }
        
        this.vinylBtn.classList.toggle('active', this.isVinylMode);
        this.vinylBtn.textContent = this.isVinylMode ? 'Exit Vinyl' : 'Vinyl Mode';
    }
    
    enterVinylMode() {
        document.body.classList.add('vinyl-active');
        this.vinylMode.style.display = 'flex';
        this.vinylState = 'idle';
        
        if (this.currentTrack) {
            this.showVinylTrackInfo(this.currentTrack);
            if (this.lyrics.length > 0) {
                setTimeout(() => this.transitionToVinylLyrics(), 3000);
            }
        }
    }
    
    exitVinylMode() {
        document.body.classList.remove('vinyl-active');
        this.vinylMode.style.display = 'none';
        this.vinylState = 'idle';
        this.hideBrowsing();
    }
    
    showVinylTrackInfo(trackData) {
        this.vinylState = 'track-info';
        this.hideBrowsing();
        
        this.previousLyric.textContent = '';
        this.currentLyric.textContent = '';
        this.nextLyric.textContent = '';
        this.previousLyric.classList.remove('visible');
        this.nextLyric.classList.remove('visible');
        
        if (trackData.album_art) {
            this.albumArt.style.backgroundImage = `url(${trackData.album_art})`;
        }
        
        this.albumArt.style.transform = '';
        this.albumArt.classList.remove('blurred', 'paused');
        this.albumOverlay.classList.remove('visible');
        
        this.vinylArtist.textContent = trackData.artist;
        this.vinylTitle.textContent = trackData.track_name;
        
        this.trackInfo.classList.add('visible');
        this.lyricDisplay.classList.remove('visible');
    }
    
    transitionToVinylLyrics() {
        if (this.vinylState !== 'track-info' || this.lyrics.length === 0) return;
        
        this.vinylState = 'lyrics';
        this.albumArt.classList.add('blurred');
        this.albumOverlay.classList.add('visible');
        this.albumArt.classList.remove('paused');
        
        // Hide pause timestamp when transitioning to lyrics
        if (this.pauseTimestamp) {
            this.pauseTimestamp.classList.remove('visible');
        }
        
        this.trackInfo.classList.remove('visible');
        this.lyricDisplay.classList.add('visible');
        
        if (this.currentLyricIndex >= 0) {
            this.updateVinylLyrics();
        }
    }
    
    handlePause() {
        this.lyricDisplay.classList.remove('visible');
        this.trackInfo.classList.add('visible');
        this.albumArt.classList.remove('blurred');
        this.albumOverlay.classList.remove('visible');
        this.albumArt.classList.add('paused');
        this.vinylState = 'track-info';
        
        if (this.actualCurrentPosition > 0) {
            this.pauseTimestamp.textContent = `⏸ ${this.formatTime(this.actualCurrentPosition)}`;
            this.pauseTimestamp.classList.add('visible');
        }
    }
    
    updateVinylLyrics() {
        if (this.currentLyricIndex === -1 && this.lyrics.length > 0) {
            this.previousLyric.textContent = '';
            this.previousLyric.classList.remove('visible');
            this.currentLyric.textContent = this.lyrics[0].words;
            this.currentLyric.style.opacity = '0.4';
            this.nextLyric.textContent = '';
            this.nextLyric.classList.remove('visible');
            return;
        }
        
        if (this.currentLyricIndex > 0) {
            this.previousLyric.textContent = this.lyrics[this.currentLyricIndex - 1].words;
            this.previousLyric.classList.add('visible');
        } else {
            this.previousLyric.textContent = '';
            this.previousLyric.classList.remove('visible');
        }
        
        if (this.currentLyricIndex >= 0 && this.currentLyricIndex < this.lyrics.length) {
            this.currentLyric.textContent = this.lyrics[this.currentLyricIndex].words;
            this.currentLyric.style.opacity = '1';
        } else {
            this.currentLyric.textContent = '';
        }
        
        if (this.currentLyricIndex >= 0 && this.currentLyricIndex < this.lyrics.length - 1) {
            this.nextLyric.textContent = this.lyrics[this.currentLyricIndex + 1].words;
            this.nextLyric.classList.add('visible');
        } else {
            this.nextLyric.textContent = '';
            this.nextLyric.classList.remove('visible');
        }
    }
    
    // BROWSING
    toggleNavMenu() {
        if (this.navMenu.style.display === 'none' || !this.navMenu.style.display) {
            this.navMenu.style.display = 'flex';
        } else {
            this.navMenu.style.display = 'none';
        }
    }
    
    async handleNavAction(action) {
        this.navMenu.style.display = 'none';
        
        switch (action) {
            case 'playlists':
                await this.browsePlaylists();
                break;
            case 'albums':
                await this.browseAlbums();
                break;
            case 'search':
                this.openSearch();
                break;
            case 'recent':
                await this.browseRecentlyPlayed();
                break;
        }
    }
    
    async browsePlaylists() {
        this.vinylState = 'browsing';
        this.browsingState = 'playlists';
        this.browsingHeader.textContent = 'Your Playlists';
        this.showBrowsing();
        this.browsingLoading.style.display = 'block';
        
        try {
            const response = await fetch('/api/playlists?limit=50');
            const data = await response.json();
            
            if (!response.ok) {
                const errorMsg = data.error || `HTTP ${response.status}: ${response.statusText}`;
                console.error('Playlists API error:', errorMsg, data);
                throw new Error(errorMsg);
            }
            
            if (data.error) {
                console.error('Playlists API returned error:', data.error);
                throw new Error(data.error);
            }
            
            if (!data.items) {
                console.warn('Playlists API returned unexpected format:', data);
                throw new Error('Unexpected response format');
            }
            
            this.browsingData = data.items || [];
            
            if (this.browsingData.length === 0) {
                this.browsingItems.innerHTML = '<div class="browsing-error">No playlists found. Create a playlist in Spotify first.</div>';
            } else {
                this.renderBrowsingItems();
            }
        } catch (error) {
            console.error('Error loading playlists:', error);
            let errorMsg = error.message || 'Failed to load playlists';
            
            // Provide helpful error messages
            if (errorMsg.includes('401') || errorMsg.includes('Unauthorized')) {
                errorMsg = 'Authentication required. Please refresh the page and re-authenticate with Spotify.';
            } else if (errorMsg.includes('403') || errorMsg.includes('Forbidden')) {
                errorMsg = 'Permission denied. Please re-authenticate with Spotify to grant playlist access.';
            } else if (errorMsg.includes('Spotify not connected')) {
                errorMsg = 'Spotify not connected. Please refresh the page and authenticate.';
            }
            
            this.browsingItems.innerHTML = `<div class="browsing-error">${errorMsg}<br><small>Check browser console (F12) for details.</small></div>`;
        } finally {
            this.browsingLoading.style.display = 'none';
        }
    }
    
    async browseAlbums() {
        this.vinylState = 'browsing';
        this.browsingState = 'albums';
        this.browsingHeader.textContent = 'Your Albums';
        this.showBrowsing();
        this.browsingLoading.style.display = 'block';
        
        try {
            const response = await fetch('/api/albums?limit=50');
            const data = await response.json();
            
            if (!response.ok || data.error) {
                throw new Error(data.error || `HTTP ${response.status}`);
            }
            
            this.browsingData = data.items || [];
            this.renderBrowsingItems();
        } catch (error) {
            console.error('Error loading albums:', error);
            const errorMsg = error.message || 'Failed to load albums';
            this.browsingItems.innerHTML = `<div class="browsing-error">${errorMsg}</div>`;
        } finally {
            this.browsingLoading.style.display = 'none';
        }
    }
    
    async browseRecentlyPlayed() {
        this.vinylState = 'browsing';
        this.browsingState = 'tracks';
        this.browsingHeader.textContent = 'Recently Played';
        this.showBrowsing();
        this.browsingLoading.style.display = 'block';
        
        try {
            const response = await fetch('/api/recently-played?limit=50');
            const data = await response.json();
            
            if (!response.ok || data.error) {
                throw new Error(data.error || `HTTP ${response.status}`);
            }
            
            this.browsingData = data.items || [];
            this.renderBrowsingItems();
        } catch (error) {
            console.error('Error loading recently played:', error);
            const errorMsg = error.message || 'Failed to load recently played';
            this.browsingItems.innerHTML = `<div class="browsing-error">${errorMsg}</div>`;
        } finally {
            this.browsingLoading.style.display = 'none';
        }
    }
    
    renderBrowsingItems() {
        this.browsingItems.innerHTML = '';
        this.selectedIndex = 0;
        
        if (!this.browsingData || this.browsingData.length === 0) {
            this.browsingItems.innerHTML = '<div class="browsing-error">No items to display</div>';
            return;
        }
        
        this.browsingData.forEach((item, index) => {
            if (!item) return; // Skip null items
            
            const element = document.createElement('div');
            element.className = 'browsing-item';
            if (index === 0) element.classList.add('selected');
            
            if (this.browsingState === 'playlists') {
                // Safe image URL extraction
                let imageUrl = '';
                if (item.images && Array.isArray(item.images) && item.images.length > 0 && item.images[0]) {
                    imageUrl = item.images[0].url || '';
                }
                element.innerHTML = `
                    <div class="browsing-item-art" style="background-image: url(${imageUrl})"></div>
                    <div class="browsing-item-info">
                        <div class="browsing-item-name">${item.name || 'Unknown Playlist'}</div>
                        <div class="browsing-item-meta">${item.tracks?.total || 0} tracks</div>
                    </div>
                `;
                element.addEventListener('click', () => this.playPlaylistShuffled(item.id));
            } else if (this.browsingState === 'albums') {
                // Safe image URL extraction
                let imageUrl = '';
                if (item.images && Array.isArray(item.images) && item.images.length > 0 && item.images[0]) {
                    imageUrl = item.images[0].url || '';
                }
                element.innerHTML = `
                    <div class="browsing-item-art" style="background-image: url(${imageUrl})"></div>
                    <div class="browsing-item-info">
                        <div class="browsing-item-name">${item.name || 'Unknown Album'}</div>
                        <div class="browsing-item-meta">${item.artists?.[0]?.name || 'Unknown Artist'}</div>
                    </div>
                `;
                element.addEventListener('click', () => this.playAlbum(item.id));
            } else if (this.browsingState === 'tracks') {
                // Handle track items - check for proper structure
                const trackName = item.name || 'Unknown Track';
                const artistName = (item.artists && item.artists.length > 0 && item.artists[0]?.name) ? item.artists[0].name : 'Unknown Artist';
                const imageUrl = (item.album?.images && item.album.images.length > 0 && item.album.images[0]?.url) ? item.album.images[0].url : '';
                const trackId = item.id;
                
                console.log('Rendering track:', { trackName, artistName, trackId, item });
                
                if (!trackId) {
                    console.warn('Track has no ID:', item);
                }
                
                element.innerHTML = `
                    <div class="browsing-item-art" style="background-image: url(${imageUrl})"></div>
                    <div class="browsing-item-info">
                        <div class="browsing-item-name">${trackName}</div>
                        <div class="browsing-item-meta">${artistName}</div>
                    </div>
                `;
                
                if (trackId) {
                    element.addEventListener('click', () => this.playTrack(trackId));
                } else {
                    element.style.opacity = '0.5';
                    element.style.cursor = 'not-allowed';
                    console.warn('Track has no ID, cannot play:', item);
                }
            }
            
            this.browsingItems.appendChild(element);
        });
    }
    
    async browsePlaylistTracks(playlistId) {
        this.browsingState = 'tracks';
        this.browsingHeader.textContent = 'Playlist Tracks';
        this.browsingLoading.style.display = 'block';
        
        // Store playlist ID and tracks for queue management
        this.currentPlaylistId = playlistId;
        
        try {
            // Fetch all tracks with pagination
            let allTracks = [];
            let offset = 0;
            const limit = 100;
            let total = 0;
            
            // First request to get total count and first batch
            const firstResponse = await fetch(`/api/playlist/${playlistId}/tracks?limit=${limit}&offset=0`);
            const firstData = await firstResponse.json();
            
            if (!firstResponse.ok || firstData.error) {
                throw new Error(firstData.error || `HTTP ${firstResponse.status}`);
            }
            
            total = firstData.tracks?.total || 0;
            console.log(`Playlist has ${total} total tracks`);
            
            // Add first batch
            allTracks = allTracks.concat(firstData.tracks?.items || []);
            offset = limit;
            
            // Fetch remaining pages
            while (offset < total && allTracks.length < total) {
                this.browsingLoading.textContent = `Loading tracks... ${allTracks.length}/${total}`;
                
                const response = await fetch(`/api/playlist/${playlistId}/tracks?limit=${limit}&offset=${offset}`);
                const data = await response.json();
                
                if (!response.ok || data.error) {
                    console.warn(`Error fetching page at offset ${offset}:`, data.error);
                    break; // Stop if we hit an error
                }
                
                const pageTracks = data.tracks?.items || [];
                allTracks = allTracks.concat(pageTracks);
                offset += limit;
                
                // Safety check to prevent infinite loops
                if (pageTracks.length === 0) {
                    break;
                }
            }
            
            console.log(`Fetched ${allTracks.length} tracks total (expected ${total})`);
            
            // Backend already returns tracks.items as direct track objects (not nested)
            // So we can use them directly
            this.browsingData = allTracks.filter(item => {
                // Filter out null/undefined items
                if (!item) {
                    return false;
                }
                
                // Backend already filters, but double-check for safety
                if (!item.id) {
                    return false;
                }
                
                // Ensure name exists (backend should have this, but be safe)
                if (!item.name) {
                    item.name = `Track ${item.id}`; // Fallback name
                }
                
                return true;
            });
            
            // Store tracks for queue management
            this.currentPlaylistTracks = this.browsingData;
            
            console.log(`Processed ${this.browsingData.length} valid tracks`);
            
            if (this.browsingData.length === 0) {
                this.browsingItems.innerHTML = '<div class="browsing-error">No tracks found in this playlist</div>';
            } else {
                this.renderBrowsingItems();
            }
        } catch (error) {
            console.error('Error loading playlist tracks:', error);
            const errorMsg = error.message || 'Failed to load tracks';
            this.browsingItems.innerHTML = `<div class="browsing-error">${errorMsg}</div>`;
        } finally {
            this.browsingLoading.style.display = 'none';
        }
    }
    
    showBrowsing() {
        this.trackInfo.classList.remove('visible');
        this.lyricDisplay.classList.remove('visible');
        this.browsingDisplay.style.display = 'flex';
        this.backBtn.style.display = 'block';
        // Add class to disable pointer events on vinyl circle
        this.vinylMode.classList.add('browsing-active');
    }
    
    hideBrowsing() {
        this.browsingDisplay.style.display = 'none';
        this.backBtn.style.display = 'none';
        this.browsingData = [];
        // Remove class to re-enable pointer events on vinyl circle
        this.vinylMode.classList.remove('browsing-active');
    }
    
    goBack() {
        if (this.browsingState === 'tracks' && this.browsingData.length > 0) {
            // Go back to playlists/albums
            if (this.browsingData[0]?.album) {
                this.browseAlbums();
            } else {
                this.browsePlaylists();
            }
        } else {
            // Go back to track info
            this.hideBrowsing();
            this.vinylState = 'track-info';
            if (this.currentTrack) {
                this.showVinylTrackInfo(this.currentTrack);
            }
        }
    }
    
    // SEARCH
    openSearch() {
        this.searchModal.style.display = 'flex';
        this.searchInput.focus();
    }
    
    closeSearch() {
        this.searchModal.style.display = 'none';
        this.searchInput.value = '';
        this.searchResults.innerHTML = '';
    }
    
    handleSearchInput(e) {
        const query = e.target.value.trim();
        if (query.length > 2) {
            clearTimeout(this.searchTimeout);
            this.searchTimeout = setTimeout(() => this.performSearch(query), 500);
        }
    }
    
    async performSearch(query) {
        if (!query) return;
        
        this.searchResults.innerHTML = '<div class="search-loading">Searching...</div>';
        
        try {
            const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&type=track&limit=20`);
            const data = await response.json();
            
            this.searchResults.innerHTML = '';
            
            if (data.tracks?.items?.length > 0) {
                data.tracks.items.forEach(track => {
                    if (!track || !track.id || !track.name) return; // Skip invalid tracks
                    
                    const element = document.createElement('div');
                    element.className = 'search-result-item';
                    
                    // Safe image URL extraction
                    let imageUrl = '';
                    if (track.album?.images && Array.isArray(track.album.images) && track.album.images.length > 0 && track.album.images[0]) {
                        imageUrl = track.album.images[0].url || '';
                    }
                    
                    const artistName = (track.artists && track.artists.length > 0 && track.artists[0]?.name) ? track.artists[0].name : 'Unknown Artist';
                    
                    element.innerHTML = `
                        <div class="search-result-art" style="background-image: url(${imageUrl})"></div>
                        <div class="search-result-info">
                            <div class="search-result-name">${track.name}</div>
                            <div class="search-result-artist">${artistName}</div>
                        </div>
                    `;
                    element.addEventListener('click', () => {
                        this.playTrack(track.id);
                        this.closeSearch();
                    });
                    this.searchResults.appendChild(element);
                });
            } else {
                this.searchResults.innerHTML = '<div class="search-no-results">No results found</div>';
            }
        } catch (error) {
            console.error('Search error:', error);
            this.searchResults.innerHTML = '<div class="search-error">Search failed</div>';
        }
    }
    
    // PLAYBACK CONTROLS
    async playPause() {
        if (this.player && this.isSDKReady) {
            await this.player.togglePlay();
        } else {
            try {
                const response = await fetch('/play-pause', { method: 'POST' });
                const data = await response.json();
                this.playPauseBtn.textContent = data.action === 'paused' ? '▶' : '⏸';
        } catch (error) {
            console.error('Play/pause error:', error);
            }
        }
    }
    
    async nextTrack() {
        if (this.player && this.isSDKReady) {
            await this.player.nextTrack();
        } else {
        try {
            await fetch('/next-track', { method: 'POST' });
        } catch (error) {
            console.error('Next track error:', error);
            }
        }
    }
    
    async previousTrack() {
        if (this.player && this.isSDKReady) {
            await this.player.previousTrack();
        } else {
        try {
            await fetch('/previous-track', { method: 'POST' });
        } catch (error) {
            console.error('Previous track error:', error);
            }
        }
    }
    
    async playTrack(trackId) {
        try {
            // If we're in a playlist context, play the playlist starting from this track
            if (this.currentPlaylistId && this.currentPlaylistTracks && this.currentPlaylistTracks.length > 0) {
                // Find the current track index
                const currentIndex = this.currentPlaylistTracks.findIndex(t => t.id === trackId);
                if (currentIndex >= 0) {
                    // Get all track URIs starting from the selected track
                    const trackUris = this.currentPlaylistTracks.slice(currentIndex).map(t => `spotify:track:${t.id}`);
                    console.log(`Playing track ${currentIndex + 1} of ${this.currentPlaylistTracks.length} from playlist, adding ${trackUris.length - 1} to queue`);
                    
                    // Play first track and add rest to queue
                    await fetch('/api/play', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            type: 'track', 
                            id: trackId,
                            track_uris: trackUris
                        })
                    });
                } else {
                    // Track not found in playlist, just play it normally
                    await fetch('/api/play', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ type: 'track', id: trackId })
                    });
                }
            } else {
                // Not in playlist context, just play the track
                await fetch('/api/play', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: 'track', id: trackId })
                });
            }
            
            this.hideBrowsing();
            this.vinylState = 'track-info';
        } catch (error) {
            console.error('Play track error:', error);
        }
    }
    
    async playAlbum(albumId) {
        try {
            await fetch('/api/play', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'album', id: albumId })
            });
            this.hideBrowsing();
            this.vinylState = 'track-info';
            // Clear playlist context when playing album
            this.currentPlaylistId = null;
            this.currentPlaylistTracks = [];
        } catch (error) {
            console.error('Play album error:', error);
        }
    }
    
    async playPlaylistShuffled(playlistId) {
        try {
            // First enable shuffle
            await fetch('/api/shuffle', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ state: true })
            });
            
            // Then play the playlist
            await fetch('/api/play', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'playlist', id: playlistId })
            });
            
            // Store playlist context for queue management
            this.currentPlaylistId = playlistId;
            
            this.hideBrowsing();
            this.vinylState = 'track-info';
            console.log('Playing playlist with shuffle:', playlistId);
        } catch (error) {
            console.error('Play playlist shuffled error:', error);
        }
    }
    
    // GESTURES (keeping existing gesture code)
    handleTouchStart(e) {
        if (!this.isVinylMode || !this.currentTrack || this.vinylState === 'browsing') return;
        e.preventDefault();
        this.startGesture(e.touches[0].clientX, e.touches[0].clientY);
    }
    
    handleTouchMove(e) {
        if (!this.isDragging) return;
        e.preventDefault();
        this.updateGesture(e.touches[0].clientX, e.touches[0].clientY);
    }
    
    handleTouchEnd(e) {
        if (!this.isDragging) return;
        e.preventDefault();
        this.endGesture();
    }
    
    handleMouseStart(e) {
        if (!this.isVinylMode || !this.currentTrack || this.vinylState === 'browsing') return;
        e.preventDefault();
        this.startGesture(e.clientX, e.clientY);
    }
    
    handleMouseMove(e) {
        if (!this.isDragging) return;
        e.preventDefault();
        this.updateGesture(e.clientX, e.clientY);
    }
    
    handleMouseEnd(e) {
        if (!this.isDragging) return;
        e.preventDefault();
        this.endGesture();
    }
    
    startGesture(x, y) {
        this.isDragging = true;
        this.totalAngleChange = 0;
        this.stopSmoothProgress();
        this.gestureStartPosition = this.actualCurrentPosition;
        
        const rect = this.vinylCircle.getBoundingClientRect();
        this.centerX = rect.left + rect.width / 2;
        this.centerY = rect.top + rect.height / 2;
        this.lastAngle = this.getAngle(x, y);
        
        this.seekTimestamp.classList.add('visible');
        this.albumArt.classList.add('seeking');
        this.albumOverlay.classList.remove('visible');
    }
    
    updateGesture(x, y) {
        const currentAngle = this.getAngle(x, y);
        let angleDiff = currentAngle - this.lastAngle;
        if (angleDiff > 180) angleDiff -= 360;
        if (angleDiff < -180) angleDiff += 360;
        
        this.totalAngleChange += angleDiff;
        this.lastAngle = currentAngle;
        
        const seekPerDegree = 30000 / 360;
        const seekAmount = this.totalAngleChange * seekPerDegree;
        
        if (this.currentTrack) {
            this.seekPosition = Math.max(0, Math.min(this.currentTrack.duration_ms, this.gestureStartPosition + seekAmount));
            this.actualCurrentPosition = this.seekPosition;
            const progress = this.seekPosition / this.currentTrack.duration_ms;
            this.updateProgressBars(progress);
            this.albumArt.style.transform = `rotate(${this.totalAngleChange}deg)`;
            this.seekTimestamp.textContent = this.formatTime(this.seekPosition);
            
            if (this.vinylState === 'lyrics' && this.lyrics.length > 0) {
                const seekLyricIndex = this.findCurrentLyricIndex(this.seekPosition);
                if (seekLyricIndex >= 0) {
                    this.currentLyricIndex = seekLyricIndex;
                    this.updateVinylLyrics();
                }
            }
        }
    }
    
    async endGesture() {
        this.isDragging = false;
        this.seekTimestamp.classList.remove('visible');
        this.albumArt.classList.remove('seeking');
        this.albumArt.style.transform = '';
        
        if (this.vinylState === 'lyrics') {
            this.albumOverlay.classList.add('visible');
        }
        
        if (Math.abs(this.seekPosition - this.gestureStartPosition) > 500) {
            try {
                const seekProgress = this.seekPosition / this.currentTrack.duration_ms;
                this.updateProgressBars(seekProgress);
                this.actualCurrentPosition = this.seekPosition;
                this.lastUpdateTime = Date.now();
                
                if (this.player && this.isSDKReady) {
                    await this.player.seek(this.seekPosition);
                } else {
                await fetch('/seek', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ position_ms: Math.floor(this.seekPosition) })
                });
                }
                
                this.justSeeked = true;
                this.stopSmoothProgress();
                
                // Set a shorter timeout, and also wait for SDK to confirm the seek
                // The SDK state update will clear justSeeked early if position matches
                setTimeout(() => {
                    if (this.justSeeked) {
                        console.log('Seek timeout - forcing resume');
                    this.actualCurrentPosition = this.seekPosition;
                    this.lastUpdateTime = Date.now();
                    this.justSeeked = false;
                        // Restart smooth progress if playing
                        if (this.currentTrack && !this.isDragging) {
                            this.startSmoothProgress(this.currentTrack.duration_ms);
                        }
                    }
                }, 2000); // Reduced from 4000 to 2000ms
            } catch (error) {
                console.error('Seek error:', error);
            }
        }
    }
    
    getAngle(x, y) {
        const dx = x - this.centerX;
        const dy = y - this.centerY;
        return Math.atan2(dy, dx) * (180 / Math.PI);
    }
    
    formatTime(ms) {
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new SpotifyPlayer();
});
