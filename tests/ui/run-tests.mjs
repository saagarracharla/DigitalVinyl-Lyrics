// End-to-end UI tests: drives headless Chrome over the DevTools protocol against the
// fake Spotify backend in mock.js. Taps and drags are real mouse events.
//
//   python tests/ui/serve.py &      # serves the UI on :5099
//   node tests/ui/run-tests.mjs     # needs Node 22+ and Chrome; screenshots go to tests/ui/shots/
//
// Set CHROME_PATH if Chrome isn't in the default macOS location.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, 'shots');
const PROFILE = mkdtempSync(join(tmpdir(), 'digital-vinyl-ui-'));
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL_ = process.env.UI_TEST_URL || 'http://127.0.0.1:5099/';
const SIZE = 1080;
rmSync(SHOTS, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });

const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check', `--window-size=${SIZE},${SIZE}`, 'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, nextId = 1;
const pending = new Map();
function send(method, params = {}) {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function connect() {
    for (let i = 0; i < 50; i++) {
        try {
            const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
            const page = targets.find(t => t.type === 'page');
            if (page) {
                ws = new WebSocket(page.webSocketDebuggerUrl);
                await new Promise(r => ws.addEventListener('open', r, { once: true }));
                ws.addEventListener('message', e => {
                    const msg = JSON.parse(e.data);
                    if (msg.id && pending.has(msg.id)) {
                        const { resolve, reject } = pending.get(msg.id);
                        pending.delete(msg.id);
                        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
                    }
                    if (msg.method === 'Runtime.exceptionThrown') pageErrors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
                    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
                        const text = msg.params.args.map(a => a.value ?? a.description).join(' ');
                        const expected = ['mock: no SDK', 'SDK initialization', 'No active device found', 'Error: boom', 'Error: down'];
                        if (!expected.some(e => text.includes(e))) pageErrors.push(text);
                    }
                });
                return;
            }
        } catch { /* chrome still starting */ }
        await sleep(200);
    }
    throw new Error('Chrome did not start');
}

const pageErrors = [];
const results = [];
function check(name, ok, detail) {
    results.push({ ok: Boolean(ok), name, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ' — ' + JSON.stringify(detail)}`);
}
async function js(expression) {
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
}
async function waitFor(expression, ms = 8000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (await js(`return Boolean(${expression});`)) return true;
        await sleep(100);
    }
    return false;
}
async function mouse(type, x, y, buttons = 1) {
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 });
}
async function tap(x, y) {
    await mouse('mouseMoved', x, y, 0);
    await mouse('mousePressed', x, y);
    await sleep(40);
    await mouse('mouseReleased', x, y, 0);
    await sleep(150);
}
// Drag along an arc around the centre, in degrees (0 = right, 90 = down), radius r
async function arcDrag(fromDeg, toDeg, r = 300, { holdCheck } = {}) {
    const c = SIZE / 2, steps = 24;
    const at = d => [c + r * Math.cos(d * Math.PI / 180), c + r * Math.sin(d * Math.PI / 180)];
    const [x0, y0] = at(fromDeg);
    await mouse('mouseMoved', x0, y0, 0);
    await mouse('mousePressed', x0, y0);
    for (let i = 1; i <= steps; i++) {
        const [x, y] = at(fromDeg + (toDeg - fromDeg) * i / steps);
        await mouse('mouseMoved', x, y);
        await sleep(12);
    }
    const during = holdCheck ? await js(holdCheck) : null;
    const [x1, y1] = at(toDeg);
    await mouse('mouseReleased', x1, y1, 0);
    await sleep(200);
    return during;
}
async function shot(name) {
    await sleep(900);   // let fades and panel transitions finish
    await js(`document.getElementById('toast').classList.remove('visible');`);
    await sleep(300);
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
}
async function center(selector) {
    return js(`const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2];`);
}

// Page-side helpers, installed after every load
const HELPERS = `
window.$ = s => document.querySelector(s); window.$$ = s => [...document.querySelectorAll(s)];
window.P = document.getElementById('player');
window.calls = p => __calls.filter(c => c.path.startsWith(p));
window.clearCalls = () => { __calls.length = 0; };
window.titles = () => $$('#libraryList .row-title').map(e => e.textContent);
window.view = () => P.dataset.view;
window.pos = () => { const m = __mock; return m.positionMs + (m.playing ? Date.now() - m.at : 0); };
`;
async function load({ settings } = {}) {
    await send('Page.navigate', { url: URL_ });
    await sleep(300);
    await js(`localStorage.clear(); ${settings ? `localStorage.setItem('digitalVinyl.settings', ${JSON.stringify(JSON.stringify(settings))});` : ''}`);
    await send('Page.reload', { ignoreCache: true });
    await sleep(600);
    await js(HELPERS);
    await waitFor(`$('#trackTitle').textContent === 'Song A'`, 5000);
}
async function openTab(tab) {
    await js(`if (!P.classList.contains('library-open')) $('#libraryBtn').click(); $('.chip[data-tab="${tab}"]').click();`);
    await waitFor(`!$('#libraryList .skeleton') && $('#libraryList').children.length > 0`, 4000);
}
async function closeLibrary() {
    await js(`if (P.classList.contains('library-open')) $('#libraryBtn').click();`);
    await sleep(400);
}
async function setSetting(label, value) {
    await openTab('settings');
    await js(`
        const row = $$('.setting').find(r => r.querySelector('.setting-label').textContent === ${JSON.stringify(label)});
        const sw = row.querySelector('.switch');
        if (sw) { if ((sw.getAttribute('aria-checked') === 'true') !== ${JSON.stringify(value)}) sw.click(); }
        else row.querySelectorAll('.segmented button').forEach(b => { if (b.textContent === ${JSON.stringify(value)}) b.click(); });
    `);
    await closeLibrary();
}
const DISC_TAP = [540, 640];

async function run() {
    await connect();
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: SIZE, height: SIZE, deviceScaleFactor: 1, mobile: false });

    // ---------- Startup ----------
    await load();
    check('loads current song from sync', await js(`return $('#trackTitle').textContent;`) === 'Song A');
    check('starts on the cover', await js(`return view();`) === 'art');
    check('album colour taken from cover (red)', await js(`return /^hsl\\((35\\d|[0-9]|1\\d) /.test(P.style.getPropertyValue('--album'));`), await js(`return P.style.getPropertyValue('--album');`));
    await shot('01-now-playing');
    check('switches to lyrics after 4s intro', await waitFor(`view() === 'lyrics'`, 6000));
    check('current lyric matches playback position', await js(`return $('.lyric-line.current')?.textContent === 'Song A line ' + (Math.floor(pos() / 3000) + 1);`), await js(`return [$('.lyric-line.current')?.textContent, pos()];`));
    // The scroll animates for ~0.5s whenever the line changes, so wait for it to settle
    check('current line centred', await waitFor(`(() => { const r = $('.lyric-line.current')?.getBoundingClientRect(); if (!r) return false; const c = (r.top + r.height / 2) / innerHeight; return c > 0.43 && c < 0.51; })()`, 3000), await js(`const r = $('.lyric-line.current').getBoundingClientRect(); return (r.top + r.height / 2) / innerHeight;`));
    await shot('02-lyrics');
    check('record spins while playing', await js(`const a = $('#albumArt').style.transform; await new Promise(r => setTimeout(r, 600)); return a !== $('#albumArt').style.transform;`));
    check('progress ring advances', await js(`const a = $('#progressFill').style.strokeDashoffset; await new Promise(r => setTimeout(r, 600)); return Number($('#progressFill').style.strokeDashoffset) < Number(a);`));

    // ---------- Transport ----------
    await js(`clearCalls(); $('#playPauseBtn').click();`);
    check('pause → /play-pause, cover view, Play label', await waitFor(`calls('/play-pause').length === 1 && !P.classList.contains('is-playing') && view() === 'art' && $('#playPauseBtn').getAttribute('aria-label') === 'Play'`));
    check('record stops when paused', await js(`const a = $('#albumArt').style.transform; await new Promise(r => setTimeout(r, 400)); return a === $('#albumArt').style.transform;`));
    await shot('03-paused');
    await js(`$('#playPauseBtn').click();`);
    check('play → back to lyrics', await waitFor(`P.classList.contains('is-playing') && view() === 'lyrics'`));
    await js(`clearCalls(); $('#prevBtn').click();`);
    check('previous → /previous-track', await waitFor(`calls('/previous-track').length === 1`));
    await js(`clearCalls(); $('#nextBtn').click();`);
    check('next → /next-track, loads Song B', await waitFor(`calls('/next-track').length === 1 && $('#trackTitle').textContent === 'Song B'`));
    check('all artists shown', await js(`return $('#trackArtist').textContent;`) === 'Artist B, Guest');
    check('new song starts on cover', await js(`return view();`) === 'art');
    check('album colour follows new cover (blue)', await js(`return /^hsl\\(2\\d\\d /.test(P.style.getPropertyValue('--album'));`));

    // ---------- Tap ----------
    check('Song B moves to lyrics after intro', await waitFor(`view() === 'lyrics'`, 6000));
    await tap(...DISC_TAP);
    check('tap on lyrics → cover', await waitFor(`view() === 'art'`, 1000));
    await sleep(4500);
    check('stays on cover for the rest of this song', await js(`return view();`) === 'art');
    await js(`$('#nextBtn').click();`);
    await waitFor(`$('#trackTitle').textContent === 'Song C <b>bold</b>'`);
    check('song without lyrics stays on cover', await js(`await new Promise(r => setTimeout(r, 4500)); return view();`) === 'art');
    await tap(...DISC_TAP);
    check('tap on song without lyrics → "No lyrics" toast', await waitFor(`$('#toast').classList.contains('visible') && $('#toast').textContent === 'No lyrics for this song'`, 1500));
    await js(`$('#nextBtn').click();`);
    check('Show lyrics automatically: next song goes to lyrics even after a tap to cover', await waitFor(`$('#trackTitle').textContent === 'Song D' && view() === 'lyrics'`, 7000));
    await js(`clearCalls(); $('#playPauseBtn').click();`);
    await waitFor(`!P.classList.contains('is-playing')`);
    await tap(...DISC_TAP);
    check('tap a paused record → resumes', await waitFor(`calls('/play-pause').length === 2 && P.classList.contains('is-playing')`, 2000));

    // ---------- Lyrics service failures ----------
    await js(`clearCalls(); __mock.lyricsFail = 1; __mock.track = 'A'; __mock.positionMs = 20000; __mock.at = Date.now();`);
    await waitFor(`$('#trackTitle').textContent === 'Song A'`);
    check('lyrics request fails → retried, lyrics appear without changing song', await waitFor(`calls('/lyrics').length === 2 && view() === 'lyrics'`, 8000), await js(`return [calls('/lyrics').length, view()];`));
    await js(`__mock.lyricsDelayMs = 2500; __mock.track = 'B'; __mock.positionMs = 20000; __mock.at = Date.now();`);
    await waitFor(`$('#trackTitle').textContent === 'Song B'`);
    await tap(...DISC_TAP);
    check('tap while lyrics are loading → "Finding lyrics…", not "No lyrics"', await waitFor(`$('#toast').classList.contains('visible') && $('#toast').textContent === 'Finding lyrics…'`, 1500), await js(`return $('#toast').textContent;`));
    check('lyrics show once loaded', await waitFor(`view() === 'lyrics'`, 7000));
    await js(`__mock.lyricsDelayMs = 0;`);

    // ---------- Drag to seek ----------
    await js(`__mock.track = 'A'; __mock.positionMs = 60000; __mock.at = Date.now(); __mock.queue = ['B','C','D'];`);
    await waitFor(`$('#trackTitle').textContent === 'Song A'`);
    await sleep(500);
    let before = await js(`return pos();`);
    await js(`clearCalls();`);
    const during = await arcDrag(-90, 0, 300, { holdCheck: `return { seeking: P.classList.contains('is-seeking'), readout: $('#seekTime').textContent, total: $('#seekTotal').textContent, knob: getComputedStyle($('#progressKnob')).opacity };` });
    check('while dragging: seeking state, readout, green handle', during.seeking && during.knob === '1' && during.total === '/ 3:20', during);
    check('quarter turn clockwise seeks +7.5s (30s/turn)', await waitFor(`calls('/seek').length === 1`) && Math.abs(await js(`return calls('/seek')[0].body.position_ms;`) - before - 7500) < 1200, { before, seek: await js(`return calls('/seek')[0]?.body.position_ms;`) });
    check('seeking state cleared after release', !(await js(`return P.classList.contains('is-seeking');`)));
    before = await js(`return pos();`);
    await js(`clearCalls();`);
    await arcDrag(0, -90);
    check('quarter turn anticlockwise seeks −7.5s', await waitFor(`calls('/seek').length === 1`) && Math.abs(before - await js(`return calls('/seek')[0].body.position_ms;`) - 7500) < 1200, { before, seek: await js(`return calls('/seek')[0]?.body.position_ms;`) });
    before = await js(`return pos();`);
    await js(`clearCalls();`);
    await arcDrag(-90, 90);   // half turn
    check('half turn seeks +15s', await waitFor(`calls('/seek').length === 1`) && Math.abs(await js(`return calls('/seek')[0].body.position_ms;`) - before - 15000) < 1500, { before, seek: await js(`return calls('/seek')[0]?.body.position_ms;`) });
    await js(`clearCalls();`);
    await arcDrag(-90, -89);
    check('tiny wobble does not seek', (await js(`await new Promise(r => setTimeout(r, 400)); return calls('/seek').length;`)) === 0);
    // Release outside the circle (corner of the square)
    await js(`clearCalls();`);
    await mouse('mouseMoved', 540, 260, 0); await mouse('mousePressed', 540, 260);
    for (let i = 1; i <= 10; i++) { await mouse('mouseMoved', 540 + i * 50, 260 - i * 8); await sleep(10); }
    await mouse('mouseMoved', 1075, 5); await mouse('mouseReleased', 1075, 5, 0); await sleep(300);
    check('drag released outside the circle still ends and seeks', await js(`return calls('/seek').length === 1 && !P.classList.contains('is-seeking');`));

    // ---------- Keyboard ----------
    await js(`clearCalls(); document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));`);
    check('Space toggles play', await waitFor(`calls('/play-pause').length === 1`));
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));`);
    await waitFor(`P.classList.contains('is-playing')`);
    before = await js(`return pos();`);
    await js(`clearCalls(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));`);
    check('→ skips forward 10s', await waitFor(`calls('/seek').length === 1`) && Math.abs(await js(`return calls('/seek')[0].body.position_ms;`) - before - 10000) < 1500);
    await js(`clearCalls(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));`);
    check('← skips back 10s', await waitFor(`calls('/seek').length === 1`));

    // ---------- Library ----------
    await openTab('playlists');
    check('library opens, transport hidden', await js(`return P.classList.contains('library-open') && getComputedStyle($('.transport')).pointerEvents === 'none';`));
    check('playlists render with owner', await js(`return titles().length === 2 && $('#libraryList .row-meta').textContent === 'Playlist · Tester';`));
    check('script in playlist name shown as text, not run', await js(`return titles()[1].startsWith('<img') && !window.__xss;`));
    check('no + on playlists', await js(`return $$('#libraryList .row-add').length === 0;`));
    await shot('04-library');
    await openTab('albums');
    check('albums render', await js(`return $('#libraryList .row-meta')?.textContent;`) === 'Album · Artist A');
    await openTab('recent');
    check('recent drops repeats (4 → 3) and has + buttons', await js(`return titles().length === 3 && $$('#libraryList .row-add').length === 3;`));
    check('playing song highlighted green', await js(`return $$('#libraryList .row.playing .row-title').map(e => e.textContent).join();`) === 'Song A');
    await js(`clearCalls(); const i = $('#searchInput'); i.value = 'dr'; i.dispatchEvent(new Event('input'));`);
    check('search as you type', await waitFor(`titles().join() === 'Song D,Song B' && $$('.chip.active').length === 0`));
    await shot('05-search');
    await js(`const i = $('#searchInput'); i.value = ''; i.dispatchEvent(new Event('input'));`);
    check('clearing search returns to the tab', await waitFor(`$('.chip.active')?.dataset.tab === 'recent' && titles().length === 3`));
    await js(`clearCalls(); $$('#libraryList .row-add')[2].click();`);
    check('+ adds to queue with confirmation', await waitFor(`calls('/api/queue/add')[0]?.body.track_uri === 'spotify:track:C' && $('#toast').textContent.startsWith('Added Song C')`));

    // ---------- Queue ----------
    await openTab('queue');
    check('queue shows Now playing + Next up', await js(`return $$('#libraryList .settings-heading').map(h => h.textContent).join();`) === 'Now playing,Next up');
    check('queue contents incl. added song', await js(`return titles().join('|');`) === 'Song A|Song B|Song C <b>bold</b>|Song D|Song C <b>bold</b>', await js(`return titles();`));
    check('only now playing is green; no + in queue', await js(`return $$('#libraryList .row.playing').length === 1 && $$('#libraryList .row')[0].classList.contains('playing') && !$('#libraryList .row-add');`));
    await shot('06-queue');
    await js(`clearCalls(); $$('#libraryList .row-main')[2].click();`);
    check('tap 2nd queued song → skips twice, closes library', await waitFor(`calls('/next-track').length === 2 && !P.classList.contains('library-open') && $('#trackTitle').textContent === 'Song C <b>bold</b>'`));

    // ---------- Playing from the library ----------
    await openTab('playlists');
    await js(`clearCalls(); $$('#libraryList .row-main')[0].click();`);
    check('playlist: shuffle then play, library closes', await waitFor(`calls('/api/play').length === 1`) && await js(`return calls('/api/shuffle')[0]?.body.state === true && calls('/api/play')[0].body.type === 'playlist' && !P.classList.contains('library-open');`));
    await waitFor(`$('#trackTitle').textContent === 'Song A'`);
    await sleep(1200);
    await openTab('playlists');
    check('playing playlist highlighted green', await waitFor(`$$('#libraryList .row.playing .row-title').map(e => e.textContent).join() === 'Road Trip'`, 3000));
    await openTab('albums');
    await js(`clearCalls(); $$('#libraryList .row-main')[0].click();`);
    check('album plays without shuffle', await waitFor(`calls('/api/play').length === 1`) && await js(`return calls('/api/shuffle').length === 0 && calls('/api/play')[0].body.type === 'album';`));

    // ---------- Error handling ----------
    await openTab('recent');
    await js(`__mock.failNext = { path: '/api/play', error: 'Player command failed: No active device found' }; $$('#libraryList .row-main')[1].click();`);
    check('no active device → helpful toast', await waitFor(`$('#toast').textContent === 'Open Spotify on a device first'`));
    await openTab('recent');
    await js(`__mock.failNext = { path: '/api/queue/add', error: 'boom' }; $$('#libraryList .row-add')[0].click();`);
    check('queue add failure → toast', await waitFor(`$('#toast').textContent === "Couldn't add to queue"`));
    await js(`__mock.failNext = { path: '/api/playlists', error: 'down' };`);
    await openTab('playlists');
    check('library failure → message', await js(`return $('#libraryList .list-message')?.textContent.startsWith("Couldn't load");`));
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));`);
    check('Esc closes library', !(await js(`return P.classList.contains('library-open');`)));

    // ---------- Idle ----------
    await js(`__mock.track = null;`);
    check('nothing playing → idle screen, transport hidden', await waitFor(`view() === 'idle' && getComputedStyle($('.transport')).opacity === '0'`, 4000));
    check('idle clock shows time and date', await js(`return getComputedStyle($('#idleClock')).display !== 'none' && /\\d:\\d\\d/.test($('#idleTime').textContent) && $('#idleDate').textContent.length > 5;`), await js(`return [$('#idleTime').textContent, $('#idleDate').textContent];`));
    await shot('07-idle-clock');
    check('tapping idle record does nothing', await js(`clearCalls(); return true;`) && (await tap(...DISC_TAP), await js(`return calls('/play-pause').length === 0 && view() === 'idle';`)));
    await js(`__mock.track = 'A'; __mock.playing = true; __mock.positionMs = 30000; __mock.at = Date.now();`);
    check('music returns → cover', await waitFor(`view() === 'art' && $('#trackTitle').textContent === 'Song A'`, 4000));

    // ---------- Settings screen ----------
    await openTab('settings');
    check('settings screen: title, sections, search hidden', await js(`return $('#libraryTitle').textContent === 'Settings' && $$('.settings-heading').map(h => h.textContent).join() === 'Lyrics,Now Playing,Controls,Display' && getComputedStyle($('.search-field')).display === 'none';`));
    check('14 settings rendered', await js(`return $$('.setting').length;`) === 14);
    await shot('08-settings');
    await openTab('playlists');
    check('leaving settings restores title and search', await js(`return $('#libraryTitle').textContent === 'Your Library' && getComputedStyle($('.search-field')).display !== 'none';`));
    await closeLibrary();

    // Show lyrics automatically: off
    await setSetting('Show lyrics automatically', false);
    await js(`__mock.track = 'B'; __mock.positionMs = 10000; __mock.at = Date.now();`);
    await waitFor(`$('#trackTitle').textContent === 'Song B'`);
    check('auto lyrics off: new song stays on cover', await js(`await new Promise(r => setTimeout(r, 5000)); return view();`) === 'art');
    await tap(...DISC_TAP);
    check('auto lyrics off: tap shows lyrics', await waitFor(`view() === 'lyrics'`, 1500));
    await js(`$('#nextBtn').click();`);
    await waitFor(`$('#trackTitle').textContent !== 'Song B'`);
    check('auto lyrics off: next song back on cover', await js(`await new Promise(r => setTimeout(r, 5000)); return view();`) === 'art');
    await openTab('albums');
    await js(`$$('#libraryList .row-main')[0].click();`);
    check('auto lyrics off: playing from library stays on cover', await js(`await new Promise(r => setTimeout(r, 5200)); return view();`) === 'art');
    await setSetting('Show lyrics automatically', true);
    // The setting applies from the next song
    await js(`__mock.track = 'B'; __mock.positionMs = 40000; __mock.at = Date.now(); __mock.queue = ['C','D'];`);
    check('auto lyrics back on: next song goes to lyrics', await waitFor(`$('#trackTitle').textContent === 'Song B' && view() === 'lyrics'`, 7000));

    // Lyrics background
    await setSetting('Background', 'Spinning cover');
    check('background: spinning cover (blurred art, no colour layer)', await js(`await new Promise(r => setTimeout(r, 900)); return getComputedStyle($('.lyrics-backdrop')).opacity === '0' && getComputedStyle($('#albumArt')).filter.includes('blur');`), await js(`return [getComputedStyle($('.lyrics-backdrop')).opacity, getComputedStyle($('#albumArt')).filter];`));
    check('spinning cover: art keeps spinning behind lyrics', await js(`const a = $('#albumArt').style.transform; await new Promise(r => setTimeout(r, 500)); return a !== $('#albumArt').style.transform;`));
    check('spinning cover: upcoming lines switch to dim white', await js(`return getComputedStyle($('.lyric-line.upcoming')).color.startsWith('rgba(255, 255, 255');`));
    await shot('09-lyrics-spinning-cover');
    await setSetting('Background', 'Black');
    check('background: black', await js(`await new Promise(r => setTimeout(r, 900)); return getComputedStyle($('.lyrics-backdrop')).backgroundColor;`) === 'rgb(18, 18, 18)');
    await setSetting('Background', 'Album colour');

    // Text size
    const size = async label => { await setSetting('Text size', label); return js(`return parseFloat(getComputedStyle($('.lyric-line')).fontSize);`); };
    const small = await size('Small'), medium = await size('Medium'), large = await size('Large');
    check('text size small < medium < large', small < medium && medium < large, { small, medium, large });
    check('large text: current line still centred', await waitFor(`(() => { const r = $('.lyric-line.current')?.getBoundingClientRect(); if (!r) return false; const c = (r.top + r.height / 2) / innerHeight; return c > 0.43 && c < 0.51; })()`, 3000), await js(`const r = $('.lyric-line.current').getBoundingClientRect(); return (r.top + r.height / 2) / innerHeight;`));
    await size('Medium');

    // Surrounding lines
    await setSetting('Show surrounding lines', false);
    check('surrounding lines off: only current line visible (once any crossfade settles)', await waitFor(`$$('.lyric-line').filter(l => getComputedStyle(l).opacity !== '0').length === 1 && $('.lyric-line.current') && getComputedStyle($('.lyric-line.current')).opacity === '1'`, 2500),
        await js(`return { view: view(), visible: $$('.lyric-line').map((l, i) => [i, l.className, getComputedStyle(l).opacity]).filter(x => x[2] !== '0'), focusClass: P.classList.contains('lyrics-focus') };`));
    await shot('10-lyrics-current-line-only');
    await setSetting('Show surrounding lines', true);

    // Now Playing settings (from the cover view)
    await tap(...DISC_TAP);
    await waitFor(`view() === 'art'`);
    await setSetting('Fade song info', true);
    check('fade song info: visible at first', await js(`return !P.classList.contains('song-info-faded');`));
    check('fade song info: hidden after 5s', await waitFor(`P.classList.contains('song-info-faded') && getComputedStyle($('.now-playing')).opacity === '0'`, 7500));
    await shot('11-cover-song-info-faded');
    await js(`$('#playPauseBtn').click();`);
    check('fade song info: comes back when paused', await waitFor(`!P.classList.contains('song-info-faded')`, 1500));
    await js(`$('#playPauseBtn').click();`);
    await waitFor(`P.classList.contains('is-playing')`);
    await setSetting('Fade song info', false);

    await setSetting('Spin the record', false);
    check('spin off: record still', await js(`const a = $('#albumArt').style.transform; await new Promise(r => setTimeout(r, 500)); return a === $('#albumArt').style.transform;`));
    await setSetting('Spin the record', true);
    const rate = async () => js(`const deg = () => parseFloat($('#albumArt').style.transform.match(/-?[\\d.]+/)[0]); const a = deg(); await new Promise(r => setTimeout(r, 1000)); return ((deg() - a) + 360) % 360;`);
    const normalRate = await rate();
    await setSetting('Spin speed', 'Fast');
    const fastRate = await rate();
    await setSetting('Spin speed', 'Slow');
    const slowRate = await rate();
    check('spin speed: slow < normal < fast (~9/18/36 °/s)', slowRate < normalRate && normalRate < fastRate && Math.abs(normalRate - 18) < 4, { slowRate, normalRate, fastRate });
    await setSetting('Spin speed', 'Normal');

    await setSetting('Grooves and shine', false);
    check('grooves and shine off', await js(`return getComputedStyle($('.grooves')).display === 'none' && getComputedStyle($('.sheen')).display === 'none';`));
    await setSetting('Grooves and shine', true);
    check('grooves and shine back on', await js(`return getComputedStyle($('.grooves')).display !== 'none';`));

    // Controls
    await setSetting('Auto-hide buttons', true);
    check('auto-hide: buttons hidden after 5s of no touch', await waitFor(`P.classList.contains('controls-hidden') && getComputedStyle($('.transport')).opacity === '0' && getComputedStyle($('.transport')).pointerEvents === 'none'`, 7500));
    const viewBefore = await js(`return view();`);
    await tap(...DISC_TAP);
    check('auto-hide: first tap only brings buttons back', await js(`return !P.classList.contains('controls-hidden') && view() === ${JSON.stringify(viewBefore)};`));
    await tap(...DISC_TAP);
    check('auto-hide: next tap works normally', await js(`return view() !== ${JSON.stringify(viewBefore)};`));
    await js(`$('#playPauseBtn').click();`);
    check('auto-hide: buttons stay while paused', await js(`await new Promise(r => setTimeout(r, 6000)); return !P.classList.contains('controls-hidden');`));
    await js(`$('#playPauseBtn').click();`);
    await setSetting('Auto-hide buttons', false);

    await setSetting('One turn of the record skips', '1 min');
    await tap(...DISC_TAP); await waitFor(`view() === 'art'`, 1000);
    before = await js(`return pos();`);
    await js(`clearCalls();`);
    await arcDrag(-90, 0);
    check('scrub 1 min/turn: quarter turn seeks +15s', await waitFor(`calls('/seek').length === 1`) && Math.abs(await js(`return calls('/seek')[0].body.position_ms;`) - before - 15000) < 1500, { before, seek: await js(`return calls('/seek')[0]?.body.position_ms;`) });
    await setSetting('One turn of the record skips', '15 sec');
    before = await js(`return pos();`);
    await js(`clearCalls();`);
    await arcDrag(-90, 0);
    check('scrub 15s/turn: quarter turn seeks +3.75s', await waitFor(`calls('/seek').length === 1`) && Math.abs(await js(`return calls('/seek')[0].body.position_ms;`) - before - 3750) < 1200);
    await setSetting('One turn of the record skips', '30 sec');

    await setSetting('Shuffle playlists', false);
    await openTab('playlists');
    await js(`clearCalls(); $$('#libraryList .row-main')[0].click();`);
    check('shuffle off: playlist plays without shuffle', await waitFor(`calls('/api/play').length === 1`) && await js(`return calls('/api/shuffle').length === 0;`));
    await setSetting('Shuffle playlists', true);

    // Display
    await setSetting('Progress ring', false);
    check('progress ring off', await js(`return getComputedStyle($('.progress-ring')).visibility === 'hidden';`));
    await setSetting('Progress ring', true);
    await setSetting('Ring colour', 'Green');
    check('ring colour green', await js(`return getComputedStyle($('#progressFill')).stroke;`) === 'rgb(30, 215, 96)');
    await setSetting('Ring colour', 'Album');
    check('ring colour from album', await js(`const s = getComputedStyle($('#progressFill')).stroke; return s !== 'rgb(255, 255, 255)' && s !== 'rgb(30, 215, 96)';`), await js(`return getComputedStyle($('#progressFill')).stroke;`));
    await setSetting('Ring colour', 'White');
    check('ring colour white', await js(`return getComputedStyle($('#progressFill')).stroke;`) === 'rgb(255, 255, 255)');

    await setSetting('Clock when nothing is playing', false);
    await js(`__mock.track = null;`);
    await waitFor(`view() === 'idle'`, 4000);
    check('clock off: idle shows record icon instead', await js(`return getComputedStyle($('#idleClock')).display === 'none' && getComputedStyle($('.idle-icon')).display !== 'none';`));
    await shot('12-idle-no-clock');
    await js(`__mock.track = 'A'; __mock.playing = true;`);
    await waitFor(`view() !== 'idle'`, 4000);

    // Persistence + reset
    await setSetting('Ring colour', 'Green');
    await setSetting('Text size', 'Large');
    await send('Page.reload', {});
    await sleep(800);
    await js(HELPERS);
    check('settings survive reload', await js(`return P.dataset.ringColor === 'green' && P.dataset.lyricsSize === 'large';`));
    await js(`localStorage.setItem('digitalVinyl.settings', JSON.stringify({ ringColor: 'purple', spin: 'yes', lyricsSize: 'small' }));`);
    await send('Page.reload', {});
    await sleep(800);
    await js(HELPERS);
    check('invalid saved values fall back to defaults', await js(`return P.dataset.ringColor === 'white' && P.dataset.lyricsSize === 'small';`));
    await openTab('settings');
    await js(`$('.settings-reset').click();`);
    check('reset to defaults', await js(`const s = JSON.parse(localStorage.getItem('digitalVinyl.settings')); return s.lyricsSize === 'medium' && s.ringColor === 'white' && s.autoLyrics === true && $('#toast').textContent === 'Settings reset';`));
    await closeLibrary();

    check('no unexpected page errors', pageErrors.length === 0, pageErrors);
}

try {
    await run();
} catch (error) {
    check('suite crashed', false, error.stack);
} finally {
    const failed = results.filter(r => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    try { ws?.close(); } catch { }
    chrome.kill();
    await sleep(300);
    rmSync(PROFILE, { recursive: true, force: true });
    process.exit(failed.length ? 1 : 0);
}
