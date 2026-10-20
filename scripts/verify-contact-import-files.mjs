import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const require = createRequire(new URL('../client/package.json', import.meta.url));
const Papa = require('papaparse');
const { parse: parseVCard } = require('vcard-parser');
const source = readFileSync(new URL('../client/src/components/ImportContactsModal.jsx', import.meta.url),'utf8');
const functions = source.slice(source.indexOf('function mapCSV'),source.indexOf('function canUseContactsPicker'));
const {mapCSV,mapVCF} = vm.runInNewContext(`${functions}; ({mapCSV,mapVCF});`,{parseVCard});
const plain = value => JSON.parse(JSON.stringify(value));
const card = (name,number,email) => `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${name}\r\nTEL;TYPE=CELL:${number}\r\nEMAIL:${email}\r\nEND:VCARD\r\n`;
test('real CSV parser preserves quoted names and multiple contact methods',()=>{
 const result = mapCSV(Papa.parse('Name,Phone,Email\n"Example, Alice","+15551234567; +15557654321",alice@example.com',{skipEmptyLines:true}).data);
 assert.deepEqual(plain(result),[{name:'Example, Alice',phones:['+15551234567','+15557654321'],emails:['alice@example.com']}]);
});
test('real VCF parser produces a readable single-contact preview',()=>{
 assert.deepEqual(plain(mapVCF(card('Alice Example','+15551234567','alice@example.com'))),[{name:'Alice Example',phones:['+15551234567'],emails:['alice@example.com']}]);
});
test('multi-contact VCF keeps each card separate',()=>{
 const result=mapVCF(card('Alice','+15551234567','alice@example.com')+card('Bob','+15557654321','bob@example.com'));
 assert.deepEqual(plain(result.map(c=>c.name)),['Alice','Bob']);
 assert.deepEqual(plain(result[1].phones),['+15557654321']);
});
test('empty or unrelated VCF contents cannot manufacture contacts',()=>{
 for(const text of ['', 'not a contact file', 'BEGIN:VCARD\nVERSION:3.0\nEND:VCARD']) assert.deepEqual(plain(mapVCF(text)),[]);
});
