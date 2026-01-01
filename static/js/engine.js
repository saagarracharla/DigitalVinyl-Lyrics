/**
 * Timing Engine - Core synchronization logic
 * Responsibilities: Track playback, determine active lyrics, emit events
 * Does NOT handle styling or DOM manipulation
 */
class TimingEngine {
    constructor() {
        this.currentTrack = null;
        this.lyrics = [];
        this.currentLyricIndex = -1;
        this.isPlaying = false;
        this.listeners = {};
        
        // Start polling
        this.startPolling();
    }
    
    // Event system
    on(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    }
    
    emit(event, data) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(callback => callback(data));
        }
    }
    
    startPolling() {
        setInterval(() => {
            this.checkCurrentTrack();
        }, 500);
    }
    
    async checkCurrentTrack() {
        try {
            const response = await fetch('/current-track');
            const data = await response.json();
            
            if (!data.playing) {
                this.handleNoPlayback();
                return;
            }
            
            // New track detected
            if (!this.currentTrack || 
                this.currentTrack.artist !== data.artist || 
                this.currentTrack.title !== data.title) {
                
                this.handleNewTrack(data);
                return;
            }
            
            // Update timing for current track
            this.updateTiming(data);
            
        } catch (error) {
            console.error('Polling error:', error);
        }
    }
    
    handleNoPlayback() {
        if (this.isPlaying) {
            this.isPlaying = false;
            this.emit('playbackStopped');
        }
    }
    
    async handleNewTrack(trackData) {
        this.currentTrack = trackData;
        this.currentLyricIndex = -1;
        this.isPlaying = true;
        
        this.emit('trackChanged', trackData);
        
        // Fetch lyrics
        try {
            const response = await fetch(`/lyrics/${encodeURIComponent(trackData.artist)}/${encodeURIComponent(trackData.title)}`);
            const lyricsData = await response.json();
            
            if (lyricsData.success) {
                this.lyrics = lyricsData.lyrics;
                this.emit('lyricsLoaded', this.lyrics);
            } else {
                this.lyrics = [];
                this.emit('lyricsError', lyricsData.error);
            }
        } catch (error) {
            this.lyrics = [];
            this.emit('lyricsError', error.message);
        }
    }
    
    updateTiming(trackData) {
        if (!this.lyrics.length) return;
        
        const currentTime = trackData.progress_ms;
        const newIndex = this.findCurrentLyricIndex(currentTime);
        
        if (newIndex !== this.currentLyricIndex) {
            const oldIndex = this.currentLyricIndex;
            this.currentLyricIndex = newIndex;
            
            // Exit previous lyric
            if (oldIndex >= 0 && oldIndex < this.lyrics.length) {
                this.emit('lyricExit', {
                    index: oldIndex,
                    line: this.lyrics[oldIndex]
                });
            }
            
            // Enter new lyric
            if (newIndex >= 0 && newIndex < this.lyrics.length) {
                this.emit('lyricEnter', {
                    index: newIndex,
                    line: this.lyrics[newIndex]
                });
            }
        }
        
        // Emit timing update
        this.emit('timingUpdate', {
            currentTime,
            progress: trackData.progress_ms / trackData.duration_ms,
            currentIndex: this.currentLyricIndex
        });
    }
    
    findCurrentLyricIndex(currentTime) {
        for (let i = this.lyrics.length - 1; i >= 0; i--) {
            if (currentTime >= this.lyrics[i].time) {
                return i;
            }
        }
        return -1;
    }
    
    // Public API
    getCurrentLyric() {
        if (this.currentLyricIndex >= 0 && this.currentLyricIndex < this.lyrics.length) {
            return this.lyrics[this.currentLyricIndex];
        }
        return null;
    }
    
    getAllLyrics() {
        return this.lyrics;
    }
    
    getCurrentTrack() {
        return this.currentTrack;
    }
}
