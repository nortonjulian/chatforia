let unlocked = false;

/**
 * Call once after the first user interaction so browsers allow audio playback.
 * Tries the simplest "play a short file" first, then falls back to WebAudio.
 */
export function unlockAudio() {
  if (unlocked) return;

  // NOTE: match the exact case of the file that exists in /public/sounds/Message_Tones
  // Your catalog uses "Default.mp3", so use that here too.
  const probe = new Audio('/sounds/Message_Tones/Default.mp3');
  probe.volume = 0; // silent probe
  probe
    .play()
    .then(() => {
      probe.pause();
      probe.currentTime = 0;
      unlocked = true;
    })
    .catch(() => {
      // Approach 2: fallback to WebAudio unlock
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        osc.connect(ctx.destination);
        osc.start(0);
        osc.stop(0);
        unlocked = true;
      } catch {
        // ignore; will succeed after any later user gesture
      }
    });
}

/**
 * Fire-and-forget playback helper.
 * Returns the HTMLAudioElement so callers can pause/stop/loop control.
 * NOTE: This does NOT manage overlap; kept for non-preview sounds (e.g., chat send SFX).
 */
export function playSound(src, { volume = 1.0, loop = false } = {}) {
  const el = new Audio(src);
  el.volume = Math.max(0, Math.min(1, volume));
  el.loop = !!loop;
  el.play().catch(() => {
    // Autoplay can still be blocked until a user gesture; safe to ignore.
  });
  return el;
}

/** Optional tiny helper to safely stop and reset an <audio> element */
export function stopSound(audioEl) {
  if (!audioEl) return;
  try {
    audioEl.pause();
    audioEl.currentTime = 0;
  } catch {}
}

/* ------------------------------------------------------------------
 * SINGLETON PREVIEW CONTROLLER
 *  - Guarantees single-instance playback
 *  - Auto-stops after N seconds
 *  - Lets UIs subscribe to {playing, label}
 * ------------------------------------------------------------------ */

let _previewAudio = null;
let _previewTimer = null;
let _previewLabel = null;
const _previewSubs = new Set();

/** Notify subscribers with { playing: boolean, label: 'message'|'ring'|null } */
function _notifyPreview() {
  const payload = { playing: !!_previewAudio, label: _previewLabel };
  _previewSubs.forEach((cb) => {
    try { cb(payload); } catch {}
  });
}

/** Stop any active preview immediately */
export function stopPreview() {
  if (_previewTimer) {
    clearTimeout(_previewTimer);
    _previewTimer = null;
  }
  if (_previewAudio) {
    try {
      _previewAudio.pause();
      _previewAudio.currentTime = 0;
    } catch {}
    _previewAudio = null;
  }
  _previewLabel = null;
  _notifyPreview();
}

/**
 * Start a single-instance preview. Auto-stops after `seconds`.
 * @param {string} src - audio URL
 * @param {object} opts
 * @param {number} opts.seconds - duration to preview before auto-stop (default 3)
 * @param {number} opts.volume - 0..1 (default 0.7)
 * @param {string|null} opts.label - 'message'|'ring' or any tag for UI
 */
export function playPreview(src, { seconds = 3, volume = 0.7, label = null } = {}) {
  // Stop any existing preview first
  stopPreview();

  try {
    const el = new Audio(src);
    el.loop = false;
    el.volume = Math.max(0, Math.min(1, volume));
    _previewAudio = el;
    _previewLabel = label;

    el.onended = () => {
      // If it ended naturally, ensure cleanup
      stopPreview();
    };

    // Safety timer to cap the preview length
    _previewTimer = setTimeout(() => stopPreview(), Math.max(0.2, seconds) * 1000);

    el.play()
      .then(() => _notifyPreview())
      .catch(() => {
        // Autoplay or other failure — clean up
        stopPreview();
      });
  } catch {
    stopPreview();
  }
}

/** Subscribe to preview state changes. Returns an unsubscribe function. */
export function subscribePreview(cb) {
  _previewSubs.add(cb);
  // Push initial state
  cb({ playing: !!_previewAudio, label: _previewLabel });
  return () => _previewSubs.delete(cb);
}

/** Convenience getters for UI */
export function isPreviewing() { return !!_previewAudio; }
export function previewLabel() { return _previewLabel; }
