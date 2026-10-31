// Test harness: a fake Spotify backend so every feature can be exercised without real playback.
// window.__calls records each request; window.__mock holds the fake playback state.
window.__calls = [];
window.__mock = {
    track: 'A', playing: true, positionMs: 20000, at: Date.now(),
    // The device's queue (see app/services/play_queue.py): entries are { uid, id }
    queueActive: true, shuffle: false, repeat: 'off', contextInfo: null, user: [], from: [],
    failNext: null, lyricsFail: 0, lyricsDelayMs: 0, lyricsFor: { A: true, B: true, C: false, D: true },
};
const art = color => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${color}"/></svg>`)}`;
const MOCK_TRACKS = {
    A: { id: 'A', name: 'Song A', artists: [{ name: 'Artist A' }], uri: 'spotify:track:A', duration_ms: 200000, album: { name: 'Album A', images: [{ url: art('#c0392b'), width: 64 }] } },
    B: { id: 'B', name: 'Song B', artists: [{ name: 'Artist B' }, { name: 'Guest' }], uri: 'spotify:track:B', duration_ms: 180000, album: { name: 'Album B', images: [{ url: art('#2471a3'), width: 64 }] } },
    C: { id: 'C', name: 'Song C <b>bold</b>', artists: [{ name: 'Artist C' }], uri: 'spotify:track:C', duration_ms: 150000, album: { name: 'Album C', images: [{ url: art('#229954'), width: 64 }] } },
    D: { id: 'D', name: 'Song D', artists: [{ name: 'Artist D' }], uri: 'spotify:track:D', duration_ms: 210000, album: { name: 'Album D', images: [{ url: art('#7d3c98'), width: 64 }] } },
};
const position = () => {
    const m = window.__mock;
    return Math.min(m.positionMs + (m.playing ? Date.now() - m.at : 0), MOCK_TRACKS[m.track].duration_ms);
};
const setPosition = ms => { window.__mock.positionMs = ms; window.__mock.at = Date.now(); };
const playTrack = id => { window.__mock.track = id; setPosition(0); window.__mock.playing = true; };
let uidCounter = 0;
const entry = id => ({ uid: `u${++uidCounter}`, id });
window.__setQueue = (ids, user = []) => { window.__mock.from = ids.map(entry); window.__mock.user = user.map(entry); };
window.__setQueue(['B', 'C', 'D']);
const queueState = () => {
    const m = window.__mock;
    const item = e => ({ ...summary(MOCK_TRACKS[e.id]), ...(m.queueActive ? { uid: e.uid } : {}) });
    return {
        active: m.queueActive, shuffle: m.shuffle, repeat: m.repeat, context: m.queueActive ? m.contextInfo : null,
        current: m.track ? summary(MOCK_TRACKS[m.track]) : null,
        next_in_queue: m.queueActive ? m.user.map(item) : [],
        next_from: (m.queueActive ? m.from : [...m.user, ...m.from]).map(item),
        next_from_total: m.from.length,
    };
};
const findEntry = uid => {
    const m = window.__mock;
    for (const section of [m.user, m.from]) {
        const i = section.findIndex(e => e.uid === uid);
        if (i >= 0) return { section, i };
    }
    return null;
};
const summary = t => ({ id: t.id, uri: t.uri, name: t.name, artists: t.artists.map(a => a.name), album: t.album.name, album_art: t.album.images[0].url, duration_ms: t.duration_ms });

window.fetch = async (url, options = {}) => {
    const u = new URL(url, location.href);
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    window.__calls.push({ method, path: u.pathname + u.search, body });
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    const m = window.__mock;
    if (m.failNext && u.pathname === m.failNext.path) {
        const error = m.failNext.error;
        m.failNext = null;
        return json({ error });
    }

    switch (u.pathname) {
        case '/api/access-token': return json({ error: 'mock: no SDK' }, 500);
        case '/current-track': {
            if (!m.track) return json({ is_playing: false });
            const t = MOCK_TRACKS[m.track];
            return json({ track_name: t.name, artist: t.artists[0].name, artists: t.artists.map(a => a.name).join(', '), uri: t.uri,
                context_uri: m.context || null, progress_ms: position(), duration_ms: t.duration_ms, is_playing: m.playing, album_art: t.album.images[0].url });
        }
        case '/lyrics': {
            if (m.lyricsDelayMs) await new Promise(r => setTimeout(r, m.lyricsDelayMs));
            // Simulates the lyrics service being down for the next N requests
            if (m.lyricsFail > 0) { m.lyricsFail--; return json({ lines: [], error: 'Lyrics are unavailable right now' }, 502); }
            const name = u.searchParams.get('track');
            const id = Object.keys(MOCK_TRACKS).find(k => MOCK_TRACKS[k].name === name);
            if (!m.lyricsFor[id]) return json({ lines: [] });
            return json({ lines: Array.from({ length: 60 }, (_, i) => ({ startTimeMs: i * 3000, words: `${name} line ${i + 1}` })) });
        }
        case '/api/playlists': return json({ items: [
            { id: 'P1', uri: 'spotify:playlist:P1', name: 'Road Trip', owner: { display_name: 'Tester' }, images: [{ url: art('#e67e22') }] },
            { id: 'P2', uri: 'spotify:playlist:P2', name: '<img src=x onerror="window.__xss=1">', owner: { display_name: 'Someone' }, images: [] },
        ] });
        case '/api/albums': return json({ items: [{ id: 'AL1', uri: 'spotify:album:AL1', name: 'Album A', artists: [{ name: 'Artist A' }], images: [{ url: art('#c0392b') }] }] });
        case '/api/recently-played': return json({ items: [MOCK_TRACKS.A, MOCK_TRACKS.B, MOCK_TRACKS.A, MOCK_TRACKS.C] });
        case '/api/search': return json({ tracks: { items: [MOCK_TRACKS.D, MOCK_TRACKS.B] } });
        case '/api/queue': return json(queueState());
        case '/api/queue/add': {
            const id = body.track_uri.split(':').pop();
            if (!MOCK_TRACKS[id]) return json({ error: 'invalid id' });
            m.user[body.play_next ? 'unshift' : 'push'](entry(id));
            return json(queueState());
        }
        case '/api/queue/remove': case '/api/queue/move': case '/api/queue/play': {
            if (!m.queueActive) return json({ error: "This queue was started on another device and can't be edited here" });
            const found = findEntry(body.uid);
            if (!found) return json({ error: 'That song is no longer in the queue' });
            const [e] = found.section.splice(found.i, 1);
            const action = u.pathname.split('/').pop();
            if (action === 'move') found.section.splice(body.index, 0, e);
            if (action === 'play') { found.section.splice(0, found.i); playTrack(e.id); }
            return json(queueState());
        }
        case '/api/queue/clear': m.user = []; return json(queueState());
        case '/api/now-playing': return json({ success: true });
        case '/api/shuffle': m.shuffle = body.state; if (body.state) m.from.reverse(); return json(queueState());
        case '/api/repeat': m.repeat = body.state; return json(queueState());
        case '/api/play':
            if (body.type === 'track') { playTrack(body.id); m.contextInfo = null; m.context = null; }
            else {
                m.context = `spotify:${body.type}:${body.id}`;
                m.contextInfo = { type: body.type, uri: m.context, name: body.type === 'playlist' ? 'Road Trip' : 'Album A' };
                playTrack('A');
                window.__setQueue(['B', 'C', 'D'], m.user.map(e => e.id));
            }
            m.queueActive = true;
            return json({ action: 'playing' });
        case '/next-track': { const next = m.user.shift() || m.from.shift(); if (next) playTrack(next.id); return json({ action: 'next' }); }
        case '/previous-track': setPosition(0); return json({ action: 'previous' });
        case '/play-pause': setPosition(position()); m.playing = !m.playing; return json({ action: m.playing ? 'playing' : 'paused' });
        case '/seek': setPosition(body.position_ms); return json({ action: 'seek' });
    }
    return json({ error: 'not mocked' }, 404);
};
