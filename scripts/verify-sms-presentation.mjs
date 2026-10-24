import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = path => fs.readFileSync(new URL('../'+path, import.meta.url),'utf8');
const route = read('server/routes/conversations.js');
const helpers = route.slice(route.indexOf('function normalizeSmsMediaUrls('), route.indexOf('// keep digits and a leading +'));
const context = vm.createContext({URL});
vm.runInContext(helpers+'\nglobalThis.qa = {smsPreviewMediaKind,summarizeSmsMedia,buildSmsPreviewText,buildLastPreviewText};',context);
const {smsPreviewMediaKind:kind,summarizeSmsMedia:summary,buildSmsPreviewText:preview,buildLastPreviewText:appPreview}=context.qa;
const plain=value=>JSON.parse(JSON.stringify(value));
for (const [label, item, expected] of [
 ['stored outgoing M4A','https://media.example/files/voice-abc.m4a','audio'],
 ['signed M4A URL','https://media.example/files/voice.M4A?token=x','audio'],
 ['opaque incoming audio',{url:'https://api.twilio.com/Media/ME1',contentType:'audio/mp4'},'audio'],
 ['incoming MIME variant',{url:'https://api.twilio.com/Media/ME1',mimeType:'Audio/MP4; charset=binary'},'audio'],
 ['actual image',{url:'https://media.example/opaque',contentType:'image/jpeg'},'image'],
 ['image extension','https://media.example/picture.jpg','image'],
 ['video','https://media.example/clip.mp4','video'],
 ['unknown opaque attachment','https://api.twilio.com/Media/ME1','file'],
 ['explicit incompatible MIME',{url:'https://media.example/a.m4a',contentType:'text/plain'},'file'],
 ['generic MIME with extension',{url:'https://media.example/a.m4a',contentType:'application/octet-stream'},'audio'],
 ['absent URL',{},null],
]) test(label,()=>assert.equal(kind(item),expected));
test('audio-only summary has a voice-note label and no image thumbnail',()=>{
 const media=summary(['https://media.example/a.m4a']);
 assert.deepEqual(plain(media),{hasMedia:true,mediaCount:1,mediaKinds:['audio'],thumbUrl:null});
 assert.equal(preview({text:'',...media}),'Voice note');
});
test('legacy object maps and multiple audio attachments retain identifying metadata',()=>{
 const media=summary({0:{url:'https://twilio.example/opaque',contentType:'audio/mp4'},1:'https://media.example/b.mp3'});
 assert.equal(media.mediaCount,2);assert.deepEqual(plain(media.mediaKinds),['audio']);assert.equal(preview({text:'',...media}),'Voice note');
});
test('photo/video/file labels remain accurate and only images provide thumbnails',()=>{
 for(const [item,label,thumbnail] of [['https://media.example/a.png','Photo','https://media.example/a.png'],['https://media.example/a.mp4','Video',null],['https://media.example/opaque','Attachment',null]]){
  const media=summary([item]);assert.equal(preview({text:'',...media}),label);assert.equal(media.thumbUrl,thumbnail);
 }
});
test('mixed media keeps existing image priority; real text always takes priority',()=>{
 const media=summary(['https://media.example/a.m4a','https://media.example/p.png']);
 assert.equal(preview({text:'',...media}),'Photo');assert.equal(preview({text:'Do not replace this text',...media}),'Do not replace this text');
});
test('empty or malformed attachment list cannot manufacture a photo or voice note',()=>{
 for(const value of [null,[],[null,{},42],{}]){
  const media=summary(value);assert.equal(media.hasMedia,false);assert.equal(preview({text:'',...media}),'');
 }
});
test('app-to-app preview behavior remains unchanged; only SMS uses scoped formatter',()=>{
 assert.equal(appPreview({text:'',hasMedia:true,mediaKinds:['audio']}),'Audio');
 const smsRoute=route.slice(route.indexOf('const smsConvos = smsThreads.map'));
 assert.match(smsRoute,/const previewText = buildSmsPreviewText\(/);
 assert.doesNotMatch(route.slice(0,route.indexOf('const smsConvos = smsThreads.map')),/const previewText = buildSmsPreviewText\(/);
});
test('layout styles are scoped to SMS and preserve tall-thread scrolling',()=>{
 const css=read('client/src/pages/SmsLayout.css'),layout=read('client/src/pages/SmsLayout.jsx');
 assert.match(layout,/import '\.\/SmsLayout.css'/);
 assert.match(layout,/className="sms-thread-messages"/);
 assert.match(layout,/className="sms-thread-viewport"/);
 assert.match(css,/\.sms-thread-viewport\s*\{[^}]*overflow-x:\s*hidden[^}]*max-width:\s*100%/);
 assert.match(css,/\.sms-thread-messages\s*\{[^}]*margin-top: auto;[^}]*flex-shrink: 0/);
 assert.doesNotMatch(css,/column-reverse|justify-content:\s*flex-end|height:\s*100vh/);
});
test('audio-only surround uses actual loaded audio and excludes text/mixed-media bubbles',()=>{
 const css=read('client/src/pages/SmsLayout.css'),layout=read('client/src/pages/SmsLayout.jsx');
 assert.match(layout,/data-media-only=\{!hasText && !isEditing/);
 assert.match(css,/:has\(audio\[data-sms-audio\]\):not\(:has\(img, video, a\)\)/);
 assert.match(css,/background: transparent !important/);assert.match(css,/padding: 0 !important/);
});
