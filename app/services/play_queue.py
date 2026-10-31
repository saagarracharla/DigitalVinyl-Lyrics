"""The device's own play queue.

Spotify's Web API can add to its queue but can't remove or reorder anything, so the device keeps
the queue itself and hands Spotify an explicit list of tracks to play (the "window"). Spotify then
handles next/previous and track changes on its own; whenever the queue is edited, the window is
sent again from the current track.

This module is pure state with no Spotify calls, so it can be tested on its own.
"""
import itertools
import random

HISTORY_IN_WINDOW = 10    # earlier tracks included in the window, so Previous works natively
WINDOW_AHEAD = 100        # upcoming tracks sent to Spotify at a time
HISTORY_MAX = 50
REPEAT_MODES = ('off', 'context', 'track')

_uid_counter = itertools.count(1)


def _entry(track, origin, index=None):
    """A queue entry: track fields plus a unique id, since the same song can appear twice."""
    entry = dict(track, uid=f'q{next(_uid_counter)}', origin=origin)
    if index is not None:
        entry['index'] = index       # position in the original playlist/album order
    return entry


def _matches(entry, uri, name=None, artist=None):
    """Whether Spotify's report is this entry. Spotify sometimes plays a different version of a song
    than the one requested (another ID for the same recording), so fall back to name and artist."""
    if entry['uri'] == uri:
        return True
    return bool(name) and entry.get('name') == name and (not artist or artist in (entry.get('artists') or []))


class PlayQueue:
    def __init__(self, shuffle=False, repeat='off', rng=None):
        self.shuffle = shuffle
        self.repeat = repeat
        self.rng = rng or random.Random()
        self.active = False          # False when playback was started somewhere else
        self.context = None          # {'uri', 'name', 'type'} of the playlist/album, if any
        self.source = []             # the context's tracks in their original order
        self.history = []
        self.current = None
        self.user_queue = []         # "Next in queue": songs the listener added
        self.context_queue = []      # "Next from": the rest of the playlist/album, in play order
        self._last_context_index = -1
        self._window = []            # entries last sent to Spotify
        self._offset = 0             # index of the current track in the window

    # ---------- Loading ----------

    def load(self, tracks, context=None, start_index=None):
        """Start playing a list of tracks. "Next in queue" carries over, as in Spotify."""
        if not tracks:
            raise ValueError('Nothing to play')
        if self.current:
            self._push_history(self.current)
        self.source = list(tracks)
        self.context = context
        self.active = True

        if start_index is None:
            start_index = self.rng.randrange(len(tracks)) if self.shuffle else 0
        start_index = max(0, min(start_index, len(tracks) - 1))
        self._set_current(_entry(tracks[start_index], 'context', start_index))
        self.context_queue = self._context_after(start_index)

    def _context_after(self, index):
        """The context tracks that follow `index`, shuffled or in order."""
        if self.shuffle:
            rest = [_entry(t, 'context', i) for i, t in enumerate(self.source) if i != index]
            self.rng.shuffle(rest)
            return rest
        return [_entry(t, 'context', i) for i, t in enumerate(self.source) if i > index]

    def _refill_for_repeat(self):
        """With repeat on, the playlist starts over once it runs out."""
        if self.repeat == 'context' and self.source and not self.context_queue:
            cycle = [_entry(t, 'context', i) for i, t in enumerate(self.source)]
            if self.shuffle:
                self.rng.shuffle(cycle)
            self.context_queue = cycle

    def _set_current(self, entry):
        self.current = entry
        if entry.get('origin') == 'context' and 'index' in entry:
            self._last_context_index = entry['index']

    def _push_history(self, entry):
        self.history.append(entry)
        del self.history[:-HISTORY_MAX]

    # ---------- The window sent to Spotify ----------

    def upcoming(self):
        return self.user_queue + self.context_queue

    def build_window(self):
        """Return (uris, offset): the tracks to hand Spotify and where the current one is."""
        self._refill_for_repeat()
        earlier = self.history[-HISTORY_IN_WINDOW:]
        self._window = earlier + [self.current] + self.upcoming()[:WINDOW_AHEAD]
        self._offset = len(earlier)
        return [e['uri'] for e in self._window], self._offset

    def rebuild_window_if_changed(self):
        """After an edit, return the new (uris, offset) if Spotify needs it, or None when the tracks
        Spotify already has from the current one onward are unchanged (e.g. an edit far down the list)."""
        old_window, old_offset = self._window, self._offset
        uris, offset = self.build_window()
        if [e['uid'] for e in self._window[offset:]] == [e['uid'] for e in old_window[old_offset:]]:
            self._window, self._offset = old_window, old_offset
            return None
        return uris, offset

    def needs_refill(self):
        """Spotify is near the end of the window but the queue has more."""
        remaining = len(self._window) - 1 - self._offset
        return remaining <= 1 and len(self.upcoming()) > remaining

    def observe(self, uri, name=None, artist=None):
        """Follow Spotify to the track it's now playing (name and artist help match other versions).

        Returns True if the queue moved, False if nothing changed, and None if the track isn't
        one of ours (played from another app, or something added to Spotify's own queue).
        """
        if not self.active or not self.current:
            return None
        if _matches(self.current, uri, name, artist):
            return False
        window = self._window
        # Spotify is playing ahead of us (next, or a track ended) ...
        for j in range(self._offset + 1, len(window)):
            if _matches(window[j], uri, name, artist):
                for entry in window[self._offset + 1:j + 1]:
                    self._advance_to(entry)
                self._offset = j
                self._refill_for_repeat()
                return True
        # ... or behind (previous)
        for j in range(self._offset - 1, -1, -1):
            if _matches(window[j], uri, name, artist):
                for _ in range(self._offset - j):
                    self._step_back()
                self._offset = j
                return True
        return None

    def _advance_to(self, entry):
        self._remove_uid(entry['uid'])
        self._push_history(self.current)
        self._set_current(entry)

    def _step_back(self):
        if not self.history:
            return
        # The track we leave goes back to the front of the list it came from
        target = self.user_queue if self.current.get('origin') == 'queue' else self.context_queue
        target.insert(0, self.current)
        self._set_current(self.history.pop())

    # ---------- Editing ----------

    def add(self, track, play_next=False):
        entry = _entry(track, 'queue')
        if play_next:
            self.user_queue.insert(0, entry)
        else:
            self.user_queue.append(entry)
        return entry

    def remove(self, uid):
        if not self._remove_uid(uid):
            raise KeyError(uid)

    def move(self, uid, to_index):
        """Move an entry within its own section ("Next in queue" or "Next from")."""
        for section in (self.user_queue, self.context_queue):
            for i, entry in enumerate(section):
                if entry['uid'] == uid:
                    section.pop(i)
                    section.insert(max(0, min(to_index, len(section))), entry)
                    return
        raise KeyError(uid)

    def clear_user_queue(self):
        self.user_queue = []

    def jump(self, uid):
        """Play an upcoming entry now, skipping the ones before it in its section."""
        for section in (self.user_queue, self.context_queue):
            for i, entry in enumerate(section):
                if entry['uid'] == uid:
                    del section[:i + 1]
                    self._push_history(self.current)
                    self._set_current(entry)
                    self._refill_for_repeat()
                    return
        raise KeyError(uid)

    def set_shuffle(self, state):
        """Spotify-style: shuffling mixes the rest of the playlist; turning it off resumes the
        original order after the last playlist track played. "Next in queue" is untouched."""
        self.shuffle = bool(state)
        if self.source:
            self.context_queue = self._context_after(self._last_context_index)

    def set_repeat(self, mode):
        if mode not in REPEAT_MODES:
            raise ValueError(mode)
        self.repeat = mode
        self._refill_for_repeat()

    def _remove_uid(self, uid):
        for section in (self.user_queue, self.context_queue):
            for i, entry in enumerate(section):
                if entry['uid'] == uid:
                    section.pop(i)
                    return True
        return False

    # ---------- Output ----------

    def to_json(self, limit=WINDOW_AHEAD):
        return {
            'active': self.active,
            'shuffle': self.shuffle,
            'repeat': self.repeat,
            'context': self.context,
            'current': self.current,
            'next_in_queue': self.user_queue,
            'next_from': self.context_queue[:limit],
            'next_from_total': len(self.context_queue),
        }
