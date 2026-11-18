import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { probeDurationSec } from '../../utils/mediaProbe.js';

test('real audio probing rounds up fractional seconds and rejects invalid media', async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'stt-duration-test-'));
 try {
  const rate=8000,samples=8800; // 1.1 seconds of silent mono PCM
  const wav=Buffer.alloc(44+samples*2);
  wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);
  wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);
  wav.write('data',36);wav.writeUInt32LE(samples*2,40);
  const file=path.join(dir,'sample.wav');await writeFile(file,wav);
  expect(await probeDurationSec(file,{roundUp:true})).toBe(2);
  expect(await probeDurationSec(file)).toBe(1);
  await writeFile(file,'not audio');
  expect(await probeDurationSec(file,{roundUp:true})).toBeNull();
 } finally { await rm(dir,{recursive:true,force:true}); }
});
