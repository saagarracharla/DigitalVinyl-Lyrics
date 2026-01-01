/**
 * Production Vinyl Karaoke Player
 * Optimized for 1080x1080 Raspberry Pi deployment
 */
class VinylKaraokeApp {
    constructor() {
        this.currentTrack = null;
        this.lyrics = [];
        this.currentLyricIndex = -1;
        this.isVinylMode = false;
        this.vinylState = 'idle'; // idle, track-info, lyrics
        this.wasPlaying = false; // Track previous playing state
        
        this.initializeElements();
        this.bindEvents();
        this.startPolling();
        
        console.log('🎤 Vinyl Karaoke initialized');
    }
    
    initializeElements() {
        // UI Elements
        this.statusEl = document.getElementById('status');
        this.progressContainer = document.getElementById('progressContainer');
        this.progressFill = document.getElementById('progressFill');
        this.lyricsContainer = document.getElementById('lyricsContainer');
        
        // Vinyl Mode Elements
        this.vinylMode = document.getElementById('vinylMode');
        this.albumArt = document.getElementById('albumArt');
        this.albumOverlay = document.getElementById('albumOverlay');
        this.trackInfo = document.getElementById('trackInfo');
        this.lyricDisplay = document.getElementById('lyricDisplay');
        this.vinylArtist = document.getElementById('vinylArtist');
        this.vinylTitle = document.getElementById('vinylTitle');
        this.previousLyric = document.getElementById('previousLyric');
        this.currentLyric = document.getElementById('currentLyric');
        this.nextLyric = document.getElementById('nextLyric');
        
        // Control Buttons
        this.prevBtn = document.getElementById('prevBtn');
        this.playPauseBtn = document.getElementById('playPauseBtn');
        this.nextBtn = document.getElementById('nextBtn');
        
        // Progress Ring
        this.progressRing = document.getElementById('progressRing');
        this.progressCircumference = 2 * Math.PI * 535; // radius = 535
        
        // Touch gesture properties
        this.isDragging = false;
        this.totalAngleChange = 0; // Track cumulative angle change
        this.lastAngle = 0;
        this.centerX = 0;
        this.centerY = 0;
        this.seekPosition = 0;
        
        // Buttons
        this.vinylBtn = document.getElementById('vinylBtn');
        this.refreshBtn = document.getElementById('refreshBtn');
    }
    
    bindEvents() {
        this.vinylBtn.addEventListener('click', () => this.toggleVinylMode());
        this.refreshBtn.addEventListener('click', () => location.reload());
        
        // Playback controls
        this.prevBtn.addEventListener('click', () => this.previousTrack());
        this.playPauseBtn.addEventListener('click', () => this.playPause());
        this.nextBtn.addEventListener('click', () => this.nextTrack());
        
        // Touch gestures for vinyl circle
        this.vinylCircle = document.querySelector('.vinyl-circle');
        this.vinylCircle.addEventListener('touchstart', (e) => this.handleTouchStart(e));
        this.vinylCircle.addEventListener('touchmove', (e) => this.handleTouchMove(e));
        this.vinylCircle.addEventListener('touchend', (e) => this.handleTouchEnd(e));
        
        // Mouse events for desktop testing
        this.vinylCircle.addEventListener('mousedown', (e) => this.handleMouseStart(e));
        this.vinylCircle.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.vinylCircle.addEventListener('mouseup', (e) => this.handleMouseEnd(e));
    }
    
    startPolling() {
        setInterval(() => this.checkCurrentTrack(), 500);
    }
    
    async checkCurrentTrack() {
        try {
            const response = await fetch('/current-track');
            const data = await response.json();
            
            const currentlyPlaying = data.is_playing;
            
            if (!currentlyPlaying) {
                if (this.wasPlaying) {
                    console.log('Playback paused');
                    this.wasPlaying = false;
                }
                this.handleNoPlayback();
                return;
            }
            
            // Detect resume from pause
            if (!this.wasPlaying && currentlyPlaying && this.currentTrack) {
                console.log('Playback resumed - transitioning to lyrics');
                this.wasPlaying = true;
                
                // If in vinyl mode with lyrics loaded, go back to lyrics immediately
                if (this.isVinylMode && this.lyrics.length > 0 && this.vinylState === 'track-info') {
                    this.transitionToVinylLyrics();
                }
            } else if (currentlyPlaying) {
                this.wasPlaying = true;
            }
            
            // New track detected
            if (!this.currentTrack || 
                this.currentTrack.artist !== data.artist || 
                this.currentTrack.track_name !== data.track_name) {
                
                this.wasPlaying = true;
                await this.handleNewTrack(data);
                return;
            }
            
            // Update timing only if playing
            if (currentlyPlaying) {
                this.updateTiming(data);
            }
            
        } catch (error) {
            console.error('Polling error:', error);
        }
    }
    
    handleNoPlayback() {
        this.statusEl.textContent = '🎵 Play a song in Spotify to start';
        this.progressContainer.style.display = 'none';
        
        if (this.isVinylMode && this.vinylState === 'lyrics') {
            console.log('Paused - showing track info');
            // When paused, go back to track info but keep progress
            this.lyricDisplay.classList.remove('visible');
            this.trackInfo.classList.add('visible');
            this.albumArt.classList.remove('blurred');
            this.albumOverlay.classList.remove('visible');
            this.vinylState = 'track-info';
            // Progress ring stays where it was
        }
    }
    
    async handleNewTrack(trackData) {
        this.currentTrack = trackData;
        this.currentLyricIndex = -1;
        
        // Clear old lyrics immediately to prevent showing previous song lyrics
        this.lyrics = [];
        this.clearLyrics();
        
        // Update UI
        this.statusEl.textContent = `🎵 ${trackData.artist} - ${trackData.track_name}`;
        this.progressContainer.style.display = 'block';
        
        // Vinyl Mode: Always start with clear album art and track info
        if (this.isVinylMode) {
            this.showVinylTrackInfo(trackData);
        }
        
        // Fetch lyrics
        await this.fetchLyrics(trackData);
    }
    
    async fetchLyrics(trackData) {
        try {
            const response = await fetch(`/lyrics?track=${encodeURIComponent(trackData.track_name)}&artist=${encodeURIComponent(trackData.artist)}`);
            const data = await response.json();
            
            if (data.lines && data.lines.length > 0) {
                this.lyrics = data.lines;
                this.renderLyrics();
                
                // Vinyl Mode: Transition to lyrics after 5 seconds
                if (this.isVinylMode) {
                    setTimeout(() => this.transitionToVinylLyrics(), 5000);
                }
            } else {
                this.lyrics = [];
                this.statusEl.textContent = '❌ No lyrics found';
                
                // Vinyl Mode: Keep showing album art and track info (no transition)
                console.log('No lyrics found - staying in track info mode');
            }
        } catch (error) {
            console.error('Lyrics error:', error);
            this.lyrics = [];
            
            // Vinyl Mode: Keep showing album art and track info on error
            console.log('Lyrics error - staying in track info mode');
        }
    }
    
    updateTiming(trackData) {
        if (!this.lyrics.length) return;
        
        const currentTime = trackData.progress_ms;
        const progress = trackData.progress_ms / trackData.duration_ms;
        
        // Update progress bar
        this.progressFill.style.width = `${progress * 100}%`;
        
        // Update circular progress ring in vinyl mode
        if (this.isVinylMode) {
            const offset = this.progressCircumference - (progress * this.progressCircumference);
            this.progressRing.style.strokeDashoffset = offset;
        }
        
        // Find current lyric
        const newIndex = this.findCurrentLyricIndex(currentTime);
        
        if (newIndex !== this.currentLyricIndex) {
            this.currentLyricIndex = newIndex;
            this.updateActiveLyric();
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
        // Update karaoke mode
        const lyricElements = this.lyricsContainer.querySelectorAll('.lyric-line');
        lyricElements.forEach((el, index) => {
            el.classList.toggle('active', index === this.currentLyricIndex);
        });
        
        // Scroll to active lyric
        if (this.currentLyricIndex >= 0 && !this.isVinylMode) {
            const activeElement = lyricElements[this.currentLyricIndex];
            if (activeElement) {
                activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
        
        // Update vinyl mode
        if (this.isVinylMode && this.vinylState === 'lyrics') {
            this.updateVinylLyrics();
        }
    }
    
    clearLyrics() {
        this.lyricsContainer.innerHTML = '';
        this.lyrics = [];
        this.currentLyricIndex = -1;
    }
    
    // VINYL MODE METHODS
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
        
        // If track is playing, show track info
        if (this.currentTrack) {
            this.showVinylTrackInfo(this.currentTrack);
            
            // If lyrics are loaded, transition after delay
            if (this.lyrics.length > 0) {
                setTimeout(() => this.transitionToVinylLyrics(), 3000);
            }
        }
        
        console.log('Vinyl mode activated');
    }
    
    exitVinylMode() {
        document.body.classList.remove('vinyl-active');
        this.vinylMode.style.display = 'none';
        this.vinylState = 'idle';
        
        console.log('Vinyl mode deactivated');
    }
    
    showVinylTrackInfo(trackData) {
        // Reset to track info state with clear album art
        this.vinylState = 'track-info';
        
        // Clear any existing lyrics display immediately
        this.previousLyric.textContent = '';
        this.currentLyric.textContent = '';
        this.nextLyric.textContent = '';
        this.previousLyric.classList.remove('visible');
        this.nextLyric.classList.remove('visible');
        
        // Set album art
        if (trackData.album_art) {
            this.albumArt.style.backgroundImage = `url(${trackData.album_art})`;
        }
        
        // Ensure album art is clear (not blurred)
        this.albumArt.classList.remove('blurred');
        this.albumOverlay.classList.remove('visible');
        
        // Set track info
        this.vinylArtist.textContent = trackData.artist;
        this.vinylTitle.textContent = trackData.track_name;
        
        // Show track info, hide lyrics
        this.trackInfo.classList.add('visible');
        this.lyricDisplay.classList.remove('visible');
        
        console.log('Vinyl: Showing clear album art with track info');
    }
    
    transitionToVinylLyrics() {
        if (this.vinylState !== 'track-info' || this.lyrics.length === 0) return;
        
        this.vinylState = 'lyrics';
        
        // Blur album art and show overlay
        this.albumArt.classList.add('blurred');
        this.albumOverlay.classList.add('visible');
        
        // Fade out track info, fade in lyrics
        this.trackInfo.classList.remove('visible');
        this.lyricDisplay.classList.add('visible');
        
        // Show current lyric if available
        if (this.currentLyricIndex >= 0) {
            this.updateVinylLyrics();
        }
        
        console.log('Vinyl: Transitioned to lyrics mode with blurred background');
    }
    
    updateVinylLyrics() {
        // Previous lyric
        if (this.currentLyricIndex > 0) {
            this.previousLyric.textContent = this.lyrics[this.currentLyricIndex - 1].words;
            this.previousLyric.classList.add('visible');
        } else {
            this.previousLyric.textContent = '';
            this.previousLyric.classList.remove('visible');
        }
        
        // Current lyric
        if (this.currentLyricIndex >= 0 && this.currentLyricIndex < this.lyrics.length) {
            this.currentLyric.textContent = this.lyrics[this.currentLyricIndex].words;
        }
        
        // Next lyric
        if (this.currentLyricIndex >= 0 && this.currentLyricIndex < this.lyrics.length - 1) {
            this.nextLyric.textContent = this.lyrics[this.currentLyricIndex + 1].words;
            this.nextLyric.classList.add('visible');
        } else {
            this.nextLyric.textContent = '';
            this.nextLyric.classList.remove('visible');
        }
    }
    
    resetVinylMode() {
        this.vinylState = 'idle';
        this.albumArt.classList.remove('blurred');
        this.albumOverlay.classList.remove('visible');
        this.trackInfo.classList.remove('visible');
        this.lyricDisplay.classList.remove('visible');
    }
    
    // PLAYBACK CONTROLS
    async playPause() {
        try {
            const response = await fetch('/play-pause', { method: 'POST' });
            const data = await response.json();
            
            console.log('Play/pause response:', data);
            
            if (data.action === 'paused') {
                this.playPauseBtn.textContent = '▶';
            } else if (data.action === 'playing') {
                this.playPauseBtn.textContent = '⏸';
            }
            
            // Force immediate state check after button press
            setTimeout(() => {
                this.checkCurrentTrack();
            }, 100);
            
        } catch (error) {
            console.error('Play/pause error:', error);
        }
    }
    
    async nextTrack() {
        try {
            await fetch('/next-track', { method: 'POST' });
            // Check for new track after delay
            setTimeout(() => this.checkCurrentTrack(), 500);
        } catch (error) {
            console.error('Next track error:', error);
        }
    }
    
    async previousTrack() {
        try {
            await fetch('/previous-track', { method: 'POST' });
            // Check for new track after delay
            setTimeout(() => this.checkCurrentTrack(), 500);
        } catch (error) {
            console.error('Previous track error:', error);
        }
    }
    
    // TOUCH GESTURE HANDLERS
    handleTouchStart(e) {
        if (!this.isVinylMode || !this.currentTrack) return;
        
        e.preventDefault();
        const touch = e.touches[0];
        this.startGesture(touch.clientX, touch.clientY);
    }
    
    handleTouchMove(e) {
        if (!this.isDragging) return;
        
        e.preventDefault();
        const touch = e.touches[0];
        this.updateGesture(touch.clientX, touch.clientY);
    }
    
    handleTouchEnd(e) {
        if (!this.isDragging) return;
        
        e.preventDefault();
        this.endGesture();
    }
    
    // MOUSE HANDLERS (for desktop testing)
    handleMouseStart(e) {
        if (!this.isVinylMode || !this.currentTrack) return;
        
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
        
        // Get vinyl circle center
        const rect = this.vinylCircle.getBoundingClientRect();
        this.centerX = rect.left + rect.width / 2;
        this.centerY = rect.top + rect.height / 2;
        
        // Calculate starting angle
        this.lastAngle = this.getAngle(x, y);
        
        // Show timestamp and enter seeking mode
        this.seekTimestamp = document.getElementById('seekTimestamp');
        this.seekTimestamp.classList.add('visible');
        
        // Visual feedback: clear album art, counterclockwise spin
        this.albumArt.classList.add('seeking');
        this.albumOverlay.classList.remove('visible');
        
        console.log('Started seeking gesture');
    }
    
    updateGesture(x, y) {
        const currentAngle = this.getAngle(x, y);
        let angleDiff = currentAngle - this.lastAngle;
        
        // Handle angle wraparound (crossing 180/-180 boundary)
        if (angleDiff > 180) angleDiff -= 360;
        if (angleDiff < -180) angleDiff += 360;
        
        // Accumulate total angle change
        this.totalAngleChange += angleDiff;
        this.lastAngle = currentAngle;
        
        // Much more sensitive: 1 full circle = 3 seconds rewind
        const rewindPerDegree = 3000 / 360; // 3 seconds per full circle
        const rewindAmount = Math.max(0, -this.totalAngleChange * rewindPerDegree);
        
        if (this.currentTrack) {
            const currentProgress = this.currentTrack.progress_ms || 0;
            this.seekPosition = Math.max(0, currentProgress - rewindAmount);
            
            // Update visual progress
            const progress = this.seekPosition / this.currentTrack.duration_ms;
            const offset = this.progressCircumference - (progress * this.progressCircumference);
            this.progressRing.style.strokeDashoffset = offset;
            
            // Rotate album art proportionally to gesture (counterclockwise)
            this.albumArt.style.transform = `rotate(${this.totalAngleChange}deg)`;
            
            // Update timestamp display
            this.seekTimestamp.textContent = this.formatTime(this.seekPosition);
        }
    }
    
    async endGesture() {
        this.isDragging = false;
        
        // Hide timestamp and exit seeking mode
        this.seekTimestamp.classList.remove('visible');
        this.albumArt.classList.remove('seeking');
        
        // Reset album art transform and restore animation
        this.albumArt.style.transform = '';
        
        // Restore previous state (blurred if in lyrics mode)
        if (this.vinylState === 'lyrics') {
            this.albumOverlay.classList.add('visible');
        }
        
        // Seek to position if significant change (more than 0.5 second)
        if (Math.abs(this.seekPosition - (this.currentTrack.progress_ms || 0)) > 500) {
            try {
                await fetch('/seek', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ position_ms: Math.floor(this.seekPosition) })
                });
                console.log('Seeked to:', this.formatTime(this.seekPosition));
            } catch (error) {
                console.error('Seek error:', error);
            }
        }
        
        console.log('Ended seeking gesture');
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

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new VinylKaraokeApp();
});
