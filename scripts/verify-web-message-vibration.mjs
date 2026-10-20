import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const load = async (path) => import(`data:text/javascript;base64,${Buffer.from(await source(path)).toString('base64')}`);
const { attachVisualAlerts } = await load('client/src/utils/visualAlerts.js');
const { supportsMessageVibration, vibrateIncomingMessage } = await load('client/src/utils/messageVibration.js');

function harness(options = {}) {
  const clock = Date.parse('2026-10-19T18:00:00Z');
  const events = new Map(), pulses = [], banners = [];
  const doc = new EventTarget();
  Object.assign(doc, { title: 'Chatforia', visibilityState: 'visible', hasFocus: () => true });
  const nav = { userActivation: { hasBeenActive: true }, vibrate: (value) => { pulses.push(value); return true; } };
  const socket = {
    on(event, handler) { if (!events.has(event)) events.set(event, new Set()); events.get(event).add(handler); },
    off(event, handler) { events.get(event)?.delete(handler); },
  };
  const prefs = { vibration: true, visual: false };
  const alerts = attachVisualAlerts({ socket, userId: 7, now: () => clock,
    document: doc, window: new EventTarget(), show: (banner) => banners.push(banner), hide() {},
    getEnabled: () => prefs.visual, getVibrationEnabled: () => prefs.vibration,
    vibrateMessage: () => vibrateIncomingMessage({ navigator: nav, document: doc }),
    ...options,
  });
  const row = (extra = {}) => ({ id: 20, sender: { id: 8 }, createdAt: new Date(clock + 1).toISOString(), ...extra });
  return { prefs, pulses, banners, doc, nav, alerts, row, events,
    emit(event = 'message:upsert', payload = row()) { for (const handler of events.get(event) || []) handler(payload); },
  };
}

test('incoming message vibrates with visual alerts OFF; all aliases deduplicate', () => {
  const h = harness();
  h.emit('message:upsert', { item: h.row() });
  h.emit('message:new', { message: h.row() });
  h.emit('receive:message', { shaped: h.row() });
  assert.deepEqual(h.pulses, [150]);
  assert.equal(h.banners.length, 0);
});
test('visual alerts ON still produces only one banner and one vibration', () => {
  const h = harness(); h.prefs.visual = true;
  h.emit(); h.emit();
  assert.equal(h.banners.length, 1); assert.deepEqual(h.pulses, [150]);
});
test('OFF applies immediately; reenabling cannot replay a previously received message', () => {
  const h = harness(); h.prefs.vibration = false; h.emit();
  h.prefs.vibration = true; h.emit('message:new');
  assert.equal(h.pulses.length, 0);
  h.emit('message:upsert', h.row({ id: 21 }));
  assert.deepEqual(h.pulses, [150]);
});
for (const [name, extra] of [
  ['own message', { sender: { id: 7 } }],
  ['historical hydration', { createdAt: '2026-10-18T00:00:00Z' }],
  ['edited message', { editedAt: '2026-10-19T18:01:00Z' }],
  ['deleted message', { deletedForAll: true }],
  ['deleted timestamp', { deletedAt: '2026-10-19T18:00:00Z' }],
  ['expired message', { expiresAt: '2026-10-19T17:00:00Z' }],
  ['already read message', { readBy: [{ id: 7 }] }],
  ['invalid ID', { id: 0 }],
  ['missing sender', { sender: null }],
  ['missing timestamp', { createdAt: null }],
]) test(`${name} cannot vibrate`, () => {
  const h = harness(); h.emit('message:upsert', h.row(extra)); assert.equal(h.pulses.length, 0);
});
test('supported legacy sender metadata vibrates without modifying the payload', () => {
  const h = harness(); const row = h.row({ sender: null, senderId: 8 });
  const before = JSON.stringify(row); h.emit('message:new', row);
  assert.deepEqual(h.pulses, [150]); assert.equal(JSON.stringify(row), before);
});
test('calls and receipt events do not trigger message vibration', () => {
  const h = harness(); h.emit('video:incoming', { callId: 12, callerId: 8 });
  h.emit('message:read', { messageId: 20, readerId: 8 });
  assert.equal(h.pulses.length, 0); h.alerts.dispose();
});
test('hidden page does not vibrate and becoming visible does not replay aliases', () => {
  const h = harness(); h.doc.visibilityState = 'hidden'; h.emit();
  h.doc.visibilityState = 'visible'; h.emit('message:new');
  assert.equal(h.pulses.length, 0);
});
test('prior user interaction is required when the browser exposes activation state', () => {
  const h = harness(); h.nav.userActivation.hasBeenActive = false; h.emit();
  assert.equal(h.pulses.length, 0);
  h.nav.userActivation.hasBeenActive = true; h.emit('message:upsert', h.row({ id: 21 }));
  assert.deepEqual(h.pulses, [150]);
});
test('unsupported and malformed API values fail safely', () => {
  for (const nav of [undefined, {}, { vibrate: true }, { vibrate: null }]) {
    assert.equal(supportsMessageVibration(nav), false);
    assert.equal(vibrateIncomingMessage({ navigator: nav, document: { visibilityState: 'visible' } }), false);
  }
});
test('API refusal and thrown errors cannot interrupt notifications', () => {
  const h = harness(); h.prefs.visual = true;
  h.nav.vibrate = () => { throw new Error('device refusal'); };
  assert.doesNotThrow(() => h.emit()); assert.equal(h.banners.length, 1);
  assert.equal(vibrateIncomingMessage({ navigator: { vibrate: () => false }, document: h.doc }), false);
});
test('dispose removes exact listeners and prevents further vibration', () => {
  const h = harness(); h.alerts.dispose(); h.emit();
  assert.equal(h.pulses.length, 0);
  assert.ok([...h.events.values()].every((listeners) => listeners.size === 0));
});
test('separate account subscriptions do not suppress each other', () => {
  const a = harness(), b = harness(); a.emit(); b.emit();
  assert.deepEqual(a.pulses, [150]); assert.deepEqual(b.pulses, [150]);
});
test('actual mounted component uses current saved preference and rejects old-account callbacks', async () => {
  const refs = [], effects = []; let index = 0, captured, cleanup;
  let currentUser = { id: 7, a11yVibrate: true };
  const context = {
    useRef(initial) { const slot = index++; return refs[slot] ??= { current: initial }; },
    useEffect(callback) { effects.push(callback); },
    useUser: () => ({ currentUser }), useSocketRaw: () => ({}),
    useTranslation: () => ({ t: (_key, fallback) => fallback }),
    notifications: { show() {}, hide() {} }, flashIncomingCall() {}, vibrateIncomingMessage() {},
    attachVisualAlerts(options) { captured = options; return { dispose() {}, syncPreference() {} }; },
  };
  const code = (await source('client/src/components/VisualAlerts.jsx'))
    .replace(/^import .*;\r?\n/gm, '').replace('export default function VisualAlerts', 'function VisualAlerts');
  vm.createContext(context); vm.runInContext(`${code}\nthis.render = VisualAlerts;`, context);
  context.render(); cleanup = effects[0]();
  assert.equal(captured.getVibrationEnabled(), true);
  currentUser = { id: 7, a11yVibrate: false }; index = 0; context.render();
  assert.equal(captured.getVibrationEnabled(), false);
  currentUser = { id: 8, a11yVibrate: true }; index = 0; context.render();
  assert.equal(captured.getVibrationEnabled(), false); cleanup();
});

// Production SMS envelope has no app-to-app sender metadata.
const smsRow = (extra = {}) => ({ id: 20, threadId: 34, direction: 'in', body: '',
  createdAt: '2026-10-19T18:00:00.001Z', mediaUrls: ['https://media.example/voice.m4a'], ...extra });
test('incoming SMS/MMS vibrates once with Visual alerts OFF and aliases deduplicate', () => {
  const h = harness(); const payload = {threadId: 34, message: smsRow()};
  const before = JSON.stringify(payload);
  h.emit('sms:message:new', payload); h.emit('sms_message_new', payload); h.emit('sms:message:new', payload);
  assert.deepEqual(h.pulses, [150]); assert.equal(h.banners.length, 0);
  assert.equal(JSON.stringify(payload), before);
});
test('fresh text-only SMS and string identifiers use the same short vibration', () => {
  const h = harness(); h.emit('sms:message:new', {threadId: '34', message: smsRow({id:'21',threadId:'34',body:'hello',mediaUrls:[]})});
  assert.deepEqual(h.pulses, [150]);
});
test('Visual alerts ON does not double SMS vibration or add an unrequested SMS banner', () => {
  const h = harness(); h.prefs.visual = true;
  h.emit('sms:message:new',{threadId:34,message:smsRow()});h.emit('sms_message_new',{threadId:34,message:smsRow()});
  assert.deepEqual(h.pulses,[150]); assert.equal(h.banners.length,0);
});
test('SMS vibration OFF applies immediately and reenabling cannot replay an alias', () => {
  const h = harness();h.prefs.vibration=false;h.emit('sms:message:new',{threadId:34,message:smsRow()});
  h.prefs.vibration=true;h.emit('sms_message_new',{threadId:34,message:smsRow()});
  assert.equal(h.pulses.length,0);h.emit('sms:message:new',{threadId:34,message:smsRow({id:21})});
  assert.deepEqual(h.pulses,[150]);
});
for(const [label,extra] of [
 ['own outgoing SMS',{direction:'out'}],['outbound SMS',{direction:'outbound-api'}],
 ['missing direction',{direction:null}],['historical SMS',{createdAt:'2026-10-18T18:00:00Z'}],
 ['missing timestamp',{createdAt:null}],['invalid message ID',{id:0}],['boolean message ID',{id:true}],
 ['invalid thread',{threadId:0}],['conflicting thread',{threadId:35}],
 ['edited SMS',{editedAt:'2026-10-19T18:01:00Z'}],['deleted SMS',{deletedAt:'2026-10-19T18:01:00Z'}],
 ['expired SMS',{expiresAt:'2026-10-19T17:00:00Z'}],
])test(`${label} cannot produce SMS vibration`,()=>{
 const h=harness();h.emit('sms:message:new',{threadId:34,message:smsRow(extra)});assert.equal(h.pulses.length,0);
});
test('SMS and app-message IDs cannot suppress each other',()=>{
 const h=harness();h.emit();h.emit('sms:message:new',{threadId:34,message:smsRow()});assert.deepEqual(h.pulses,[150,150]);
});
test('hidden SMS is not replayed on becoming visible',()=>{
 const h=harness();h.doc.visibilityState='hidden';h.emit('sms:message:new',{threadId:34,message:smsRow()});
 h.doc.visibilityState='visible';h.emit('sms_message_new',{threadId:34,message:smsRow()});assert.equal(h.pulses.length,0);
});
test('SMS without prior page interaction does not vibrate',()=>{
 const h=harness();h.nav.userActivation.hasBeenActive=false;
 h.emit('sms:message:new',{threadId:34,message:smsRow()});assert.equal(h.pulses.length,0);
});
test('SMS device refusal cannot interrupt socket delivery',()=>{
 const h=harness();h.nav.vibrate=()=>{throw Error('refused');};
 assert.doesNotThrow(()=>h.emit('sms:message:new',{threadId:34,message:smsRow()}));
});
test('SMS subscriptions are removed on cleanup and saved callbacks stay inactive',()=>{
 const h=harness();const callback=[...h.events.get('sms:message:new')][0];h.alerts.dispose();
 callback({threadId:34,message:smsRow()});h.emit('sms:message:new',{threadId:34,message:smsRow()});
 assert.equal(h.pulses.length,0);assert.ok([...h.events.values()].every(set=>set.size===0));
});

test('incoming call aliases still flash once and matching end stops the flash',()=>{
 let starts=0,stops=0;
 const h=harness({getFlashEnabled:()=>true,startCallFlash:()=>{starts++;return()=>{stops++;};}});
 h.emit('video:incoming',{callId:12,callerId:8});h.emit('call:incoming',{callId:12,callerId:8});
 assert.equal(starts,1);assert.equal(stops,0);assert.equal(h.pulses.length,0);
 h.emit('video:ended',{callId:12});assert.equal(stops,1);h.alerts.dispose();assert.equal(stops,1);
});
