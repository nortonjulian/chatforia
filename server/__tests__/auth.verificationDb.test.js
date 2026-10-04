import crypto from 'node:crypto';
import prisma from '../utils/prismaClient.js';
import { resetDb } from './helpers/testServer.js';
import { consumeEmailVerification, createPhoneVerification, consumePhoneVerification } from '../services/authVerification.js';

const phone='+14155550199';
const issue=()=>createPhoneVerification({phone,pendingRegistration:null,consentTextVersion:'test',ipAddress:null,userAgent:null});
beforeEach(async()=>{ await resetDb(); });

test('database locks allow exactly one email-token completion',async()=>{
 const suffix=crypto.randomBytes(5).toString('hex');
 const user=await prisma.user.create({data:{username:`verify_${suffix}`,email:`verify_${suffix}@example.com`,passwordHash:'oauth'}});
 await prisma.verificationToken.create({data:{userId:user.id,type:'email',tokenHash:'test-hash',expiresAt:new Date(Date.now()+60000)}});
 const results=await Promise.all([consumeEmailVerification(user.id,'test-hash'),consumeEmailVerification(user.id,'test-hash')]);
 expect(results.filter(Boolean)).toHaveLength(1);
 expect((await prisma.user.findUnique({where:{id:user.id}})).emailVerifiedAt).not.toBeNull();
});

test('database locks allow exactly one SMS-code completion',async()=>{
 const issued=await issue();
 const results=await Promise.all([consumePhoneVerification(phone,issued.code),consumePhoneVerification(phone,issued.code)]);
 expect(results.filter(r=>r.status===200)).toHaveLength(1);
 expect(await prisma.phoneOtp.count({where:{phone}})).toBe(1);
});

test('concurrent wrong attempts cannot bypass the five-attempt limit',async()=>{
 const issued=await issue(); const wrong=issued.code==='111111'?'222222':'111111';
 await Promise.all(Array.from({length:5},()=>consumePhoneVerification(phone,wrong)));
 expect((await prisma.phoneOtp.findUnique({where:{id:issued.id}})).attempts).toBe(5);
 expect((await consumePhoneVerification(phone,issued.code)).status).toBe(429);
});

test('concurrent requests enforce the hourly phone limit',async()=>{
 const results=await Promise.all(Array.from({length:6},issue));
 expect(results.filter(r=>r.status===200)).toHaveLength(5);
 expect(results.filter(r=>r.status===429)).toHaveLength(1);
});

test('an expired SMS code cannot be consumed',async()=>{
 const issued=await issue();
 await prisma.phoneOtp.update({where:{id:issued.id},data:{expiresAt:new Date(0)}});
 expect((await consumePhoneVerification(phone,issued.code)).status).toBe(400);
});
