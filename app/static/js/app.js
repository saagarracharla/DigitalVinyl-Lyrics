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
        this.currentLyric = document.getElementById('currentLyric');
        
        // Buttons
        this.vinylBtn = document.getElementById('vinylBtn');
        this.refreshBtn = document.getElementById('refreshBtn');
    }
    
    bindEvents() {
        this.vinylBtn.addEventListener('click', () => this.toggleVinylMode());
        this.refreshBtn.addEventListener('click', () => location.reload());
    }
    
    startPolling() {
        setInterval(() => this.checkCurrentTrack(), 500);
    }
    
    async checkCurrentTrack() {
        try {
            const response = await fetch('/current-track');
            const data = await response.json();
            
            if (!data.is_playing) {
                this.handleNoPlayback();
                return;
            }
            
            // New track detected
            if (!this.currentTrack || 
                this.currentTrack.artist !== data.artist || 
                this.currentTrack.track_name !== data.track_name) {
                
                await this.handleNewTrack(data);
                return;
            }
            
            // Update timing
            this.updateTiming(data);
            
        } catch (error) {
            console.error('Polling error:', error);
        }
    }
    
    handleNoPlayback() {
        this.statusEl.textContent = '🎵 Play a song in Spotify to start';
        this.progressContainer.style.display = 'none';
        this.clearLyrics();
        
        if (this.isVinylMode) {
            this.resetVinylMode();
        }
    }
    
    async handleNewTrack(trackData) {
        this.currentTrack = trackData;
        this.currentLyricIndex = -1;
        
        // Update UI
        this.statusEl.textContent = `🎵 ${trackData.artist} - ${trackData.track_name}`;
        this.progressContainer.style.display = 'block';
        
        // Vinyl Mode: Show track info and album art
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
                
                // Vinyl Mode: Transition to lyrics after delay
                if (this.isVinylMode) {
                    setTimeout(() => this.transitionToVinylLyrics(), 3000);
                }
            } else {
                this.lyrics = [];
                this.statusEl.textContent = '❌ No lyrics found';
            }
        } catch (error) {
            console.error('Lyrics error:', error);
            this.lyrics = [];
        }
    }
    
    updateTiming(trackData) {
        if (!this.lyrics.length) return;
        
        const currentTime = trackData.progress_ms;
        const progress = trackData.progress_ms / trackData.duration_ms;
        
        // Update progress bar
        this.progressFill.style.width = `${progress * 100}%`;
        
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
        if (this.isVinylMode && this.vinylState === 'lyrics' && this.currentLyricIndex >= 0) {
            const currentLyricText = this.lyrics[this.currentLyricIndex].words;
            this.currentLyric.textContent = currentLyricText;
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
        this.vinylState = 'track-info';
        
        // Set album art
        if (trackData.album_art) {
            this.albumArt.style.backgroundImage = `url(${trackData.album_art})`;
        }
        
        // Set track info
        this.vinylArtist.textContent = trackData.artist;
        this.vinylTitle.textContent = trackData.track_name;
        
        // Show track info
        this.trackInfo.classList.add('visible');
        this.lyricDisplay.classList.remove('visible');
        
        console.log('Vinyl: Showing track info');
    }
    
    transitionToVinylLyrics() {
        if (this.vinylState !== 'track-info') return;
        
        this.vinylState = 'lyrics';
        
        // Blur album art and show overlay
        this.albumArt.classList.add('blurred');
        this.albumOverlay.classList.add('visible');
        
        // Fade out track info, fade in lyrics
        this.trackInfo.classList.remove('visible');
        this.lyricDisplay.classList.add('visible');
        
        // Show current lyric if available
        if (this.currentLyricIndex >= 0) {
            this.currentLyric.textContent = this.lyrics[this.currentLyricIndex].words;
        }
        
        console.log('Vinyl: Transitioned to lyrics mode');
    }
    
    resetVinylMode() {
        this.vinylState = 'idle';
        this.albumArt.classList.remove('blurred');
        this.albumOverlay.classList.remove('visible');
        this.trackInfo.classList.remove('visible');
        this.lyricDisplay.classList.remove('visible');
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new VinylKaraokeApp();
});
