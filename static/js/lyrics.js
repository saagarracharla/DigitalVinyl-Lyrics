/**
 * Lyrics Renderer - Handles lyric display and transitions
 * Responsibilities: DOM manipulation, multi-line display, state management
 * Does NOT handle timing or mood-specific animations
 */
class LyricsRenderer {
    constructor(container) {
        this.container = container;
        this.lyrics = [];
        this.currentIndex = -1;
        this.lyricElements = [];
    }
    
    setLyrics(lyrics) {
        this.lyrics = lyrics;
        this.currentIndex = -1;
        this.renderLyrics();
    }
    
    renderLyrics() {
        // Clear existing lyrics
        this.container.innerHTML = '';
        this.lyricElements = [];
        
        // Create lyric elements with frozen geometry
        this.lyrics.forEach((lyric, index) => {
            const element = document.createElement('div');
            element.className = 'lyric-line upcoming';
            element.textContent = lyric.text;
            element.dataset.index = index;
            
            this.container.appendChild(element);
            this.lyricElements.push(element);
        });
    }
    
    setActiveLyric(index) {
        if (index === this.currentIndex) return;
        
        // Clear previous states
        this.lyricElements.forEach((element, i) => {
            element.classList.remove('upcoming', 'active', 'passed');
            
            if (i < index) {
                element.classList.add('passed');
            } else if (i === index) {
                element.classList.add('active');
            } else {
                element.classList.add('upcoming');
            }
        });
        
        this.currentIndex = index;
        
        // Scroll active lyric into view (karaoke mode only)
        if (index >= 0 && index < this.lyricElements.length) {
            const activeElement = this.lyricElements[index];
            if (!document.body.classList.contains('speaker-mode')) {
                activeElement.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center'
                });
            }
        }
    }
    
    clear() {
        this.container.innerHTML = '';
        this.lyricElements = [];
        this.lyrics = [];
        this.currentIndex = -1;
    }
    
    // Get elements for external manipulation (moods)
    getCurrentElement() {
        if (this.currentIndex >= 0 && this.currentIndex < this.lyricElements.length) {
            return this.lyricElements[this.currentIndex];
        }
        return null;
    }
    
    getAllElements() {
        return this.lyricElements;
    }
}
