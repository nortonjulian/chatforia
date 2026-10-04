import { attachVerifiedRegistrationPhone, phoneProofHash, REGISTRATION_PHONE_INTENT } from '../services/registrationPhone.js';
const phone='+14155550199';
const token='a'.repeat(64);
let proof, phoneRow, user, tx;
beforeEach(()=>{
 proof={id:1,phoneNumber:phone,phoneVerificationId:phoneProofHash(token),intent:REGISTRATION_PHONE_INTENT,
   verifiedAt:new Date(),consumedAt:null,expiresAt:new Date(Date.now()+60000)};
 user={id:7}; phoneRow=null;
 tx={
   $queryRaw:async()=>[],
   phoneVerificationRequest:{
     findUnique:async()=>proof,
     updateMany:async()=>{if(proof.consumedAt)return{count:0};proof.consumedAt=new Date();return{count:1};},
     update:async({data})=>Object.assign(proof,data),
   },
   user:{findFirst:async()=>null,update:async({data})=>Object.assign(user,data)},
   phone:{findUnique:async()=>phoneRow,create:async({data})=>phoneRow={id:2,...data},updateMany:async({data})=>{Object.assign(phoneRow,data);return{count:1};}},
 };
});
const attach=()=>attachVerifiedRegistrationPhone(tx,{userId:7,phone,phoneVerificationId:token});
test('valid proof attaches both phone records and is consumed',async()=>{
 await attach();expect(user.phoneNumber).toBe(phone);expect(user.phoneVerifiedAt).toBeInstanceOf(Date);
 expect(phoneRow.userId).toBe(7);expect(proof.consumedAt).toBeInstanceOf(Date);expect(proof.phoneId).toBe(2);
 await expect(attach()).rejects.toMatchObject({code:'invalid_phone_verification'});
});
test.each(['expired','consumed','unverified','wrong-phone','legacy-intent','missing'])('rejects %s proof',async(kind)=>{
 if(kind==='expired')proof.expiresAt=new Date(0);
 if(kind==='consumed')proof.consumedAt=new Date();
 if(kind==='unverified')proof.verifiedAt=null;
 if(kind==='wrong-phone')proof.phoneNumber='+14155550198';
 if(kind==='legacy-intent')proof.intent='legacy';
 if(kind==='missing')proof=null;
 await expect(attach()).rejects.toMatchObject({code:'invalid_phone_verification'});expect(user.phoneNumber).toBeUndefined();
});
test('an owned phone is not reassigned',async()=>{
 phoneRow={id:2,userId:99,optedOut:false};
 await expect(attach()).rejects.toMatchObject({code:'phone_already_in_use',status:409});expect(proof.consumedAt).toBeNull();
});
test('legacy user ownership also blocks attachment',async()=>{
 tx.user.findFirst=async()=>({id:99});
 await expect(attach()).rejects.toMatchObject({code:'phone_already_in_use'});expect(proof.consumedAt).toBeNull();
});
test('opted-out phones remain opted out',async()=>{
 phoneRow={id:2,userId:null,optedOut:true};
 await expect(attach()).rejects.toMatchObject({code:'phone_opted_out'});expect(proof.consumedAt).toBeNull();
});
test('a lost proof claim does not attach a phone',async()=>{
 tx.phoneVerificationRequest.updateMany=async()=>({count:0});
 await expect(attach()).rejects.toMatchObject({code:'invalid_phone_verification'});expect(phoneRow).toBeNull();
});
