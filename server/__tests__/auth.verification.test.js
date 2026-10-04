import { jest } from '@jest/globals';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

let db;
let queue = Promise.resolve();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const matches = (row, where) => Object.entries(where).every(([key, value]) => {
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return (!('gt' in value) || row[key] > value.gt) && (!('lt' in value) || row[key] < value.lt);
  }
  return row[key] === value;
});
function table(rows) {
  return {
    async findFirst({ where }) { return rows.filter(r => matches(r, where)).sort((a,b) => b.id-a.id)[0] ?? null; },
    async findUnique({ where }) { return rows.find(r => matches(r, where)) ?? null; },
    async count({ where }) { return rows.filter(r => matches(r, where)).length; },
    async updateMany({ where, data }) { const found = rows.filter(r => matches(r,where)); for (const row of found) Object.assign(row,data); return { count: found.length }; },
    async update({ where, data }) { const row=rows.find(r => matches(r,where)); if (!row) throw new Error('Missing'); Object.assign(row,data); return row; },
    async create({ data }) { const row={ id: rows.length+1, createdAt: new Date(), attempts:0, ...data }; rows.push(row); return row; },
  };
}
const prisma = {
  $transaction(fn) {
    const run=queue.then(async()=> {
      const snapshot=structuredClone(db);
      const tx={ $queryRaw: jest.fn(async()=>[]), user:table(db.users), verificationToken:table(db.tokens), phoneOtp:table(db.otps), smsConsent:table(db.consents), phoneVerificationRequest:table(db.proofs) };
      try { return await fn(tx); } catch(error) { db=snapshot; throw error; }
    });
    queue=run.catch(()=>{});
    return run;
  },
};
jest.unstable_mockModule(fileURLToPath(new URL('../utils/prismaClient.js',import.meta.url)),()=>({default:prisma}));
const { consumeEmailVerification, createPhoneVerification, consumePhoneVerification }=await import('../services/authVerification.js');
const phone='+14155551234';
beforeEach(()=> { db={users:[{id:1,email:'verify@example.com',isBanned:false,deletedAt:null}],tokens:[],otps:[],consents:[],proofs:[]}; queue=Promise.resolve(); });
const issue=()=>createPhoneVerification({phone,pendingRegistration:{username:'example'},consentTextVersion:'v1',ipAddress:null,userAgent:null});
const emailToken=()=>db.tokens.push({id:1,userId:1,type:'email',tokenHash:'hashed',usedAt:null,expiresAt:new Date(Date.now()+60000),createdAt:new Date()});

test('one email token has one winner under concurrent completion',async()=>{
 emailToken(); expect(await Promise.all([consumeEmailVerification(1,'hashed'),consumeEmailVerification(1,'hashed')])).toEqual([true,false]);
 expect(db.users[0].emailVerifiedAt).toBeInstanceOf(Date);
});
test.each(['missing','banned','deleted','expired','used','wrong'])('rejects %s email verification',async(kind)=>{
 emailToken(); if(kind==='missing')db.users=[];
 if(kind==='banned')db.users[0].isBanned=true;
 if(kind==='deleted')db.users[0].deletedAt=new Date();
 if(kind==='expired')db.tokens[0].expiresAt=new Date(0);
 if(kind==='used')db.tokens[0].usedAt=new Date();
 expect(await consumeEmailVerification(1,kind==='wrong'?'other':'hashed')).toBe(false);
});
test('new SMS codes are six digits and stored only as hashes',async()=>{
 const issued=await issue(); expect(issued.code).toMatch(/^\d{6}$/);
 expect(db.otps[0].otpCode).toBe(`sha256:${hash(issued.code)}`);
 expect(db.otps[0].otpCode).not.toBe(issued.code);
});
test('one SMS code has one concurrent winner and retains its rate-limit record',async()=>{
 const issued=await issue(); const results=await Promise.all([consumePhoneVerification(phone,issued.code),consumePhoneVerification(phone,issued.code)]);
 expect(results.map(r=>r.status)).toEqual([200,400]); expect(db.otps).toHaveLength(1);
 expect(results[0].pendingRegistration).toBeNull();
 expect(results[0].phoneVerificationId).toMatch(/^[a-f0-9]{64}$/);
 expect(db.proofs[0].phoneVerificationId).toBe(hash(results[0].phoneVerificationId));
 expect(db.consents[0].pendingRegistration).toBeUndefined();
});
test('five concurrent wrong guesses exhaust the code',async()=>{
 const issued=await issue(); const wrong=issued.code==='111111'?'222222':'111111';
 const results=await Promise.all(Array.from({length:5},()=>consumePhoneVerification(phone,wrong)));
 expect(results.map(r=>r.status)).toEqual([400,400,400,400,429]);
 expect((await consumePhoneVerification(phone,issued.code)).status).toBe(429);
});
test('expired codes cannot be spent',async()=>{
 const issued=await issue(); db.otps[0].expiresAt=new Date(0);
 expect((await consumePhoneVerification(phone,issued.code)).status).toBe(400);
});
test('legacy plaintext codes remain usable once',async()=>{
 db.consents.push({id:1,phone,createdAt:new Date()});
 db.otps.push({id:1,phone,otpCode:'123456',attempts:0,createdAt:new Date(),expiresAt:new Date(Date.now()+60000)});
 expect((await consumePhoneVerification(phone,'123456')).status).toBe(200);
 expect((await consumePhoneVerification(phone,'123456')).status).toBe(400);
});
test('new issuance invalidates older codes',async()=>{
 const first=await issue(); const second=await issue();
 if(first.code!==second.code)expect((await consumePhoneVerification(phone,first.code)).status).toBe(400);
 expect((await consumePhoneVerification(phone,second.code)).status).toBe(200);
 expect(db.otps).toHaveLength(2);
});
test('concurrent issuance enforces five requests per hour',async()=>{
 const results=await Promise.all(Array.from({length:6},issue));
 expect(results.map(r=>r.status)).toEqual([200,200,200,200,200,429]);
 expect(db.otps).toHaveLength(5); expect(db.consents).toHaveLength(5);
});
