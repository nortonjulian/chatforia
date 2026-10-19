import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startVideoRingtone } from '../client/src/utils/videoRingtone.js';

function harness(options = {}) {
  const sounds = [], statuses = [];
  class Audio {
    constructor(src) { this.src = src; this.paused = true; this.currentTime = 9; this.plays = 0; this.pauses = 0; sounds.push(this); }
    play() { this.plays++; this.paused = false; return Promise.resolve(); }
    pause() { this.pauses++; this.paused = true; }
    removeAttribute(name) { if (name === 'src') this.src = ''; }
    load() { this.loaded = true; }
  }
  const start = extra => startVideoRingtone({ src: '/sounds/Ringtones/Classic.mp3', volume: 0.35,
    onStatus: value => statuses.push(value), AudioImpl: Audio, ...options, ...extra });
  return { sounds, statuses, Audio, start };
}
const flush = () => new Promise(setImmediate);

test('selected ringtone loops at the requested volume and stops/reset/releases on cleanup', async () => {
  const f = harness(), ring = f.start({ src: '/sounds/Ringtones/Digital Phone.mp3' }); await flush();
  assert.equal(f.sounds.length, 1); const audio = f.sounds[0];
  assert.equal(audio.src, '/sounds/Ringtones/Digital Phone.mp3'); assert.equal(audio.loop, true); assert.equal(audio.volume, 0.35);
  assert.deepEqual(f.statuses, ['playing']); ring.stop();
  assert.equal(audio.paused, true); assert.equal(audio.currentTime, 0); assert.equal(audio.src, ''); assert.equal(audio.loaded, true);
});
test('zero volume stays silent without allocating audio or showing a blocked warning', async () => {
  const f = harness(), ring = f.start({ volume: 0 }); ring.retry(); await flush();
  assert.equal(f.sounds.length, 0); assert.deepEqual(f.statuses, []); ring.stop();
});
test('volume is bounded without treating an explicit zero as the default', () => {
  for (const [input, expected] of [[-5, null], [5, 1], [NaN, 0.7]]) {
    const f = harness(), ring = f.start({ volume: input });
    if (expected === null) assert.equal(f.sounds.length, 0); else assert.equal(f.sounds[0].volume, expected);
    ring.stop();
  }
});
test('blocked autoplay is visible and a user-gesture retry reuses the one audio element', async () => {
  const f = harness(); let allow = false;
  f.Audio.prototype.play = function () { this.plays++; if (!allow) return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' })); this.paused = false; return Promise.resolve(); };
  const ring = f.start(); await flush(); assert.deepEqual(f.statuses, ['blocked']);
  allow = true; ring.retry(); await flush();
  assert.deepEqual(f.statuses, ['blocked', 'playing']); assert.equal(f.sounds.length, 1); assert.equal(f.sounds[0].plays, 2); ring.stop();
});
test('overlapping retry gestures cannot start overlapping play attempts', async () => {
  const f = harness(); let resolve;
  f.Audio.prototype.play = function () { this.plays++; return new Promise(r => { resolve = r; }); };
  const ring = f.start(); ring.retry(); ring.retry(); assert.equal(f.sounds[0].plays, 1);
  resolve(); await flush(); ring.stop();
});
test('late playback success after answer/cancel is silenced without reporting playing', async () => {
  const f = harness(); let resolve;
  f.Audio.prototype.play = function () { return new Promise(r => { resolve = () => { this.paused = false; r(); }; }); };
  const ring = f.start(); ring.stop(); resolve(); await flush();
  assert.equal(f.sounds[0].paused, true); assert.deepEqual(f.statuses, []);
});
test('late autoplay rejection after cleanup cannot show a stale enable button', async () => {
  const f = harness(); let reject;
  f.Audio.prototype.play = () => new Promise((_, r) => { reject = r; });
  const ring = f.start(); ring.stop(); reject(Object.assign(new Error(), { name: 'NotAllowedError' })); await flush();
  assert.deepEqual(f.statuses, []);
});
test('stopped controller cannot restart ringing and repeated stop is harmless', async () => {
  const f = harness(), ring = f.start(); await flush(); ring.stop(); const pauses = f.sounds[0].pauses;
  ring.stop(); ring.retry(); await flush(); assert.equal(f.sounds[0].plays, 1); assert.equal(f.sounds[0].pauses, pauses);
});
test('unavailable media is reported as an error without throwing into call actions', async () => {
  const f = harness(), ring = f.start({ AudioImpl: undefined }); await flush();
  assert.deepEqual(f.statuses, ['error']); ring.stop();
});
test('a synchronous media failure is reported and can be retried', async () => {
  const f = harness(); let fails = true;
  f.Audio.prototype.play = function () { if (fails) throw new Error('media error'); return Promise.resolve(); };
  const ring = f.start(); assert.deepEqual(f.statuses, ['error']); fails = false; ring.retry(); await flush();
  assert.deepEqual(f.statuses, ['error', 'playing']); ring.stop();
});
test('a rejected media request reports error rather than falsely reporting blocked autoplay', async () => {
  const f = harness(); f.Audio.prototype.play = () => Promise.reject(new Error('missing audio'));
  const ring = f.start(); await flush(); assert.deepEqual(f.statuses, ['error']); ring.stop();
});
test('constructor failure can recover on an explicit retry', async () => {
  const f = harness(); let attempts = 0;
  class Audio extends f.Audio { constructor(src) { if (++attempts === 1) throw new Error('unavailable'); super(src); } }
  const ring = f.start({ AudioImpl: Audio }); assert.deepEqual(f.statuses, ['error']); ring.retry(); await flush();
  assert.deepEqual(f.statuses, ['error', 'playing']); assert.equal(f.sounds.length, 1); ring.stop();
});
test('an old call finishing playback cannot affect a subsequent call ringer', async () => {
  const f = harness(); let finish;
  const first = f.start({ AudioImpl: class extends f.Audio { play() { return new Promise(resolve => { finish = resolve; }); } } });
  first.stop(); const second = f.start(); await flush(); finish(); await flush();
  assert.equal(f.sounds[0].paused, true); assert.equal(f.sounds[1].paused, false); assert.deepEqual(f.statuses, ['playing']); second.stop();
});
