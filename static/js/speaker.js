/**
 * Speaker Mode Controller - Dedicated display interface
 * Responsibilities: Single lyric display, UI hiding, mood integration
 * Hardware-safe: No layout animations, opacity-only transitions
 */
class SpeakerMode {
    constructor() {
        this.isActive = false;
        this.currentMood = null;
        this.speakerContainer = null;
        this.currentLyricElement = null;
    }
    
    enter(mood = 'calmDrift') {
        if (this.isActive) return;
        
        this.isActive = true;
        document.body.classList.add('speaker-mode');
        
        // Create speaker container in safe frame
        this.createSpeakerContainer();
        
        // Load and activate mood
        this.setMood(mood);
        
        console.log('Speaker mode activated with mood:', mood);
    }
    
    exit() {
        if (!this.isActive) return;
        
        this.isActive = false;
        document.body.classList.remove('speaker-mode');
        
        // Exit current mood
        if (this.currentMood && MoodRegistry[this.currentMood]) {
            MoodRegistry[this.currentMood].exit();
        }
        
        // Remove speaker container
        if (this.speakerContainer) {
            this.speakerContainer.remove();
            this.speakerContainer = null;
            this.currentLyricElement = null;
        }
        
        console.log('Speaker mode deactivated');
    }
    
    createSpeakerContainer() {
        // Remove existing container
        if (this.speakerContainer) {
            this.speakerContainer.remove();
        }
        
        // Create new container in safe frame
        this.speakerContainer = document.createElement('div');
        this.speakerContainer.className = 'safe-frame';
        this.speakerContainer.innerHTML = '<div class="speaker-lyric hidden"></div>';
        
        document.body.appendChild(this.speakerContainer);
        this.currentLyricElement = this.speakerContainer.querySelector('.speaker-lyric');
    }
    
    setMood(moodName) {
        // Exit current mood
        if (this.currentMood && MoodRegistry[this.currentMood]) {
            MoodRegistry[this.currentMood].exit();
        }
        
        // Enter new mood
        if (MoodRegistry[moodName]) {
            this.currentMood = moodName;
            MoodRegistry[moodName].enter();
        } else {
            console.warn('Mood not found:', moodName);
        }
    }
    
    showLyric(lyricLine) {
        if (!this.isActive || !this.currentLyricElement) return;
        
        // Update text content (frozen geometry)
        this.currentLyricElement.textContent = lyricLine.text;
        
        // Show with transition
        this.currentLyricElement.classList.remove('hidden');
        this.currentLyricElement.classList.add('visible');
        
        // Notify current mood
        if (this.currentMood && MoodRegistry[this.currentMood]) {
            MoodRegistry[this.currentMood].onLyric(lyricLine, this.currentLyricElement);
        }
    }
    
    hideLyric() {
        if (!this.isActive || !this.currentLyricElement) return;
        
        // Hide with transition
        this.currentLyricElement.classList.remove('visible');
        this.currentLyricElement.classList.add('hidden');
    }
    
    toggle() {
        if (this.isActive) {
            this.exit();
        } else {
            this.enter();
        }
    }
}
