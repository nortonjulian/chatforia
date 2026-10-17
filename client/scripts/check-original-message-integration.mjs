// Run: node --experimental-vm-modules client/scripts/check-original-message-integration.mjs
import vm from 'node:vm';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import * as nodeCrypto from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/utils');
const privatePrefix = Buffer.from('302e020100300506032b656e04220420', 'hex');
const publicPrefix = Buffer.from('302a300506032b656e032100', 'hex');
function pair() {
 const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync('x25519');
 return { publicKey: new Uint8Array(publicKey.export({format:'der',type:'spki'}).subarray(-32)), secretKey: new Uint8Array(privateKey.export({format:'der',type:'pkcs8'}).subarray(-32)) };
}
const scalarMult = (sk, pk) => new Uint8Array(nodeCrypto.diffieHellman({
 privateKey: nodeCrypto.createPrivateKey({key:Buffer.concat([privatePrefix,Buffer.from(sk)]),format:'der',type:'pkcs8'}),
 publicKey: nodeCrypto.createPublicKey({key:Buffer.concat([publicPrefix,Buffer.from(pk)]),format:'der',type:'spki'})
}));
const sender=pair(), receiver=pair();
const b64=b=>Buffer.from(b).toString('base64');
let nacl={box:{keyPair:pair},scalarMult};
let naclUtil={decodeBase64:s=>new Uint8Array(Buffer.from(s,'base64')),encodeBase64:b64};
let implementation = 'native X25519 adapter (tweetnacl unavailable)';
try {
 const actual = await import('tweetnacl');
 const util = await import('tweetnacl-util');
 nacl = actual.default ?? actual;
 naclUtil = util.default ?? util;
 implementation = 'installed tweetnacl';
} catch {}
const context=vm.createContext({ crypto:nodeCrypto.webcrypto, TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,DataView,atob,btoa,Buffer,console:{log(){},warn(){},error(){}},setTimeout,clearTimeout });
const cache = new Map();
function synthetic(name, exports) { const mod=new vm.SyntheticModule(Object.keys(exports),function(){for(const [k,v] of Object.entries(exports))this.setExport(k,v);},{context,identifier:name}); return mod; }
const stubs={
 'tweetnacl':{default:nacl,...nacl},
 'tweetnacl-util':{default:naclUtil,...naclUtil},
 'idb-keyval':{get:async()=>null,set:async()=>{},del:async()=>{}},
 './keys.js':{loadKeysLocal:async()=>({privateKey:b64(sender.secretKey),publicKey:b64(sender.publicKey)}),clearKeysLocal:async()=>{}},
 './browserDeviceClient.js':{getOrCreateBrowserDeviceRecord:async()=>({}),getBrowserDevicePrivateKeyBytes:async()=>null}
};
async function load(filename) {
 if(cache.has(filename))return cache.get(filename);
 const mod=new vm.SourceTextModule(await fs.readFile(filename,'utf8'),{context,identifier:filename});cache.set(filename,mod);
 await mod.link(async(spec,ref)=>{
  if(stubs[spec])return synthetic(spec,stubs[spec]);
  return load(path.resolve(path.dirname(ref.identifier),spec));
 }); return mod;
}
const mod=await load(path.join(root,'encryptionClient.js')); await mod.evaluate();
const legacy=cache.get(path.join(root,'decryptionClient.js')).namespace;
const {encryptForSingleUser,decryptFetchedMessages}=mod.namespace;
const original='Hola, ¿cómo estás?\n日本語 👋', translated='Hello, how are you?\nJapanese 👋';
const payload=await encryptForSingleUser(translated,2,b64(receiver.publicKey),'en',null,original);
assert.equal(await legacy.decryptMessageForUserBrowser(payload.contentCiphertext,payload.encryptedKey,b64(receiver.secretKey),null,2),translated);
const [msg]=await decryptFetchedMessages([{id:1,encryptedPayloadForMe:payload}],b64(receiver.secretKey),null,2);
assert.equal(msg.decryptedContent,translated); assert.equal(msg.decryptedOriginalContent,original);
assert.equal(msg.decryptedOriginalKey,payload.encryptedKey);
const noOriginal=await encryptForSingleUser(original,2,b64(receiver.publicKey),'es');
assert.equal(JSON.parse(noOriginal.encryptedKey).originalContentCiphertext,undefined);
const [old]=await decryptFetchedMessages([{id:2,encryptedPayloadForMe:noOriginal}],b64(receiver.secretKey),null,2);
assert.equal(old.decryptedContent,original);assert.equal(old.decryptedOriginalContent,null);
const broken=JSON.parse(payload.encryptedKey);broken.originalContentCiphertext='broken';
const [damaged]=await decryptFetchedMessages([{id:1,encryptedPayloadForMe:{...payload,encryptedKey:JSON.stringify(broken)}}],b64(receiver.secretKey),null,2);
assert.equal(damaged.decryptedContent,translated);assert.equal(damaged.decryptedOriginalContent,null);
const [wrongUser]=await decryptFetchedMessages([{id:1,encryptedPayloadForMe:payload}],b64(receiver.secretKey),null,3);
assert.equal(wrongUser.decryptedContent,'[Encrypted – could not decrypt]');assert.equal(wrongUser.decryptedOriginalContent,null);
const updated=await encryptForSingleUser('Updated',2,b64(receiver.publicKey),'en',null,'Actualizado');
const [edit]=await decryptFetchedMessages([{...msg,encryptedPayloadForMe:updated,editedAt:'2026-10-17'}],b64(receiver.secretKey),null,2);
assert.equal(edit.decryptedOriginalContent,'Actualizado');assert.equal(edit.decryptedContent,'Updated');
const [deleted]=await decryptFetchedMessages([{...msg,deletedForAll:true}],b64(receiver.secretKey),null,2);
assert.equal(deleted.decryptedOriginalContent,null);
console.log('PASS: production web encrypt/decrypt roundtrip; unchanged legacy reader; legacy message; damaged optional original; wrong user; edited original; deleted original. ');
console.log('Crypto implementation:', implementation);
