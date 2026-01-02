# Circular Navigation System Guide

## Overview
Design patterns for navigating playlists, albums, and tracks on a circular screen.

## Navigation States

### 1. **Idle State** (Home)
- **Center**: Current track info or "Select to browse"
- **Ring**: Quick access items (Playlists, Albums, Search, Recently Played)
- **Gesture**: Rotate to highlight, tap center to enter

### 2. **Browsing State**
- **Center**: Selected item (playlist/album) with artwork
- **Ring**: Items in list (tracks or playlists)
- **Gesture**: Rotate to scroll, tap center to play, swipe inward to go back

### 3. **Playing State**
- **Center**: Album art (spinning vinyl)
- **Ring**: Progress indicator
- **Gesture**: Rotate to seek, tap center to show lyrics

### 4. **Lyrics State**
- **Center**: Current lyric line
- **Ring**: Progress indicator (subtle)
- **Gesture**: Tap center to go back to playing state

## Gesture Patterns

### Rotation (Browse)
```javascript
class CircularNavigation {
    constructor() {
        this.currentAngle = 0;
        this.items = [];
        this.selectedIndex = 0;
    }

    handleRotation(deltaAngle) {
        // Calculate rotation
        this.currentAngle += deltaAngle;
        
        // Map angle to item index
        const itemsPerRotation = this.items.length;
        const anglePerItem = 360 / itemsPerRotation;
        const normalizedAngle = ((this.currentAngle % 360) + 360) % 360;
        this.selectedIndex = Math.floor(normalizedAngle / anglePerItem);
        
        // Update UI
        this.updateSelection();
    }

    updateSelection() {
        // Highlight selected item
        this.items.forEach((item, index) => {
            const isSelected = index === this.selectedIndex;
            item.element.classList.toggle('selected', isSelected);
        });
    }
}
```

### Tap Center (Select/Play)
```javascript
handleCenterTap() {
    if (this.state === 'idle') {
        // Enter browsing mode
        this.enterBrowsingMode();
    } else if (this.state === 'browsing') {
        // Play selected item
        this.playSelectedItem();
    } else if (this.state === 'playing') {
        // Toggle lyrics
        this.toggleLyrics();
    }
}
```

### Swipe Inward (Back)
```javascript
handleSwipeInward() {
    if (this.state === 'browsing') {
        // Go back to idle
        this.enterIdleMode();
    } else if (this.state === 'playing') {
        // Go back to browsing
        this.enterBrowsingMode();
    }
}
```

## UI Components

### Radial Menu
```css
.radial-menu {
    position: relative;
    width: 100%;
    height: 100%;
    border-radius: 50%;
}

.radial-item {
    position: absolute;
    transform-origin: center;
    transition: transform 0.3s ease;
}

.radial-item.selected {
    transform: scale(1.2);
    z-index: 10;
}
```

### Carousel Browser
```css
.carousel-container {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: 50%;
}

.carousel-item {
    position: absolute;
    width: 80%;
    height: 80%;
    border-radius: 50%;
    transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
}

.carousel-item.active {
    transform: scale(1) translateZ(0);
    z-index: 5;
}

.carousel-item.next {
    transform: scale(0.8) translateX(30%) translateZ(-100px);
    opacity: 0.6;
}

.carousel-item.prev {
    transform: scale(0.8) translateX(-30%) translateZ(-100px);
    opacity: 0.6;
}
```

## Implementation Example

### HTML Structure
```html
<div class="circular-screen">
    <div class="navigation-container" id="navContainer">
        <!-- Radial menu items -->
        <div class="radial-item" data-index="0">Playlists</div>
        <div class="radial-item" data-index="1">Albums</div>
        <div class="radial-item" data-index="2">Search</div>
        <div class="radial-item" data-index="3">Recently Played</div>
    </div>
    
    <div class="center-content" id="centerContent">
        <!-- Current track or selected item -->
    </div>
    
    <div class="progress-ring">
        <!-- Circular progress indicator -->
    </div>
</div>
```

### JavaScript
```javascript
class CircularNavigation {
    constructor() {
        this.state = 'idle'; // idle, browsing, playing, lyrics
        this.items = [];
        this.selectedIndex = 0;
        this.setupGestures();
    }

    setupGestures() {
        const container = document.getElementById('navContainer');
        
        // Rotation gesture
        let startAngle = 0;
        container.addEventListener('touchstart', (e) => {
            const touch = e.touches[0];
            startAngle = this.getAngle(touch.clientX, touch.clientY);
        });

        container.addEventListener('touchmove', (e) => {
            const touch = e.touches[0];
            const currentAngle = this.getAngle(touch.clientX, touch.clientY);
            const delta = currentAngle - startAngle;
            this.handleRotation(delta);
            startAngle = currentAngle;
        });

        // Center tap
        const center = document.getElementById('centerContent');
        center.addEventListener('click', () => this.handleCenterTap());
    }

    getAngle(x, y) {
        const rect = document.getElementById('navContainer').getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        return Math.atan2(y - centerY, x - centerX) * (180 / Math.PI);
    }

    handleRotation(delta) {
        const itemsPerRotation = this.items.length;
        const anglePerItem = 360 / itemsPerRotation;
        const itemDelta = Math.round(delta / anglePerItem);
        
        this.selectedIndex = (this.selectedIndex + itemDelta + itemsPerRotation) % itemsPerRotation;
        this.updateSelection();
    }

    updateSelection() {
        this.items.forEach((item, index) => {
            const angle = (360 / this.items.length) * index;
            item.element.style.transform = `rotate(${angle}deg) translateY(-40%) rotate(-${angle}deg)`;
            item.element.classList.toggle('selected', index === this.selectedIndex);
        });
    }

    handleCenterTap() {
        switch (this.state) {
            case 'idle':
                this.enterBrowsingMode();
                break;
            case 'browsing':
                this.playSelectedItem();
                break;
            case 'playing':
                this.toggleLyrics();
                break;
        }
    }

    async enterBrowsingMode() {
        this.state = 'browsing';
        const selected = this.items[this.selectedIndex];
        
        if (selected.type === 'playlist') {
            const tracks = await fetch(`/api/playlist/${selected.id}/tracks`).then(r => r.json());
            this.displayTracks(tracks);
        } else if (selected.type === 'album') {
            const tracks = await fetch(`/api/album/${selected.id}`).then(r => r.json());
            this.displayTracks(tracks.tracks.items);
        }
    }

    async playSelectedItem() {
        const selected = this.items[this.selectedIndex];
        await fetch('/api/play', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: selected.type, id: selected.id })
        });
        this.state = 'playing';
    }
}
```

## Visual Design

### Color Scheme
- **Background**: Deep black (#000000)
- **Primary**: Spotify Green (#1DB954)
- **Text**: White with opacity variations
- **Selection**: Glowing ring around selected item

### Typography
- **Center Text**: Large, bold (3-4rem)
- **Ring Items**: Medium (1.5-2rem)
- **Metadata**: Small (1rem)

### Animations
- **Rotation**: Smooth 60fps transitions
- **Selection**: Scale + glow effect
- **State Changes**: Fade transitions (0.5s)

## Best Practices

1. **Feedback**: Always provide visual feedback for gestures
2. **Haptics**: Use haptic feedback if hardware supports it
3. **Loading**: Show skeleton screens, not spinners
4. **Error Handling**: Graceful degradation for network errors
5. **Performance**: Use `transform` for animations, not `position`
6. **Accessibility**: Support keyboard navigation for testing

## Testing

- Test on actual circular screen (1080x1080)
- Verify gesture recognition accuracy
- Check animation smoothness (60fps)
- Test with various playlist/album sizes
- Verify state transitions

