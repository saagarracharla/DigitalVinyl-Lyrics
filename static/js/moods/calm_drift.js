/**
 * Calm Drift Mood - Gentle breathing animation
 * Product-ready implementation with deterministic behavior
 */
const CalmDriftMood = {
    name: 'calmDrift',
    isActive: false,
    
    enter() {
        this.isActive = true;
        console.log('Calm Drift mood activated');
    },
    
    exit() {
        this.isActive = false;
        // Clean up any mood-specific styles
        const speakerLyric = document.querySelector('.speaker-lyric');
        if (speakerLyric) {
            speakerLyric.classList.remove('breathing');
        }
        console.log('Calm Drift mood deactivated');
    },
    
    onLyric(lyricLine, element) {
        if (!this.isActive || !element) return;
        
        // Apply calm breathing animation
        element.classList.add('breathing');
        
        // Optional: Add subtle emphasis for longer lines
        if (lyricLine.text.length > 50) {
            element.style.fontSize = '3.2rem';
        } else {
            element.style.fontSize = '3.5rem';
        }
    }
};

// Register the mood
if (typeof MoodRegistry === 'undefined') {
    window.MoodRegistry = {};
}

MoodRegistry.calmDrift = CalmDriftMood;
