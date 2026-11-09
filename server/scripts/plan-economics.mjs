// Offline scenario model. No database, credentials, provider calls or mutations.
import { PLAN_ENTITLEMENTS } from '../config/planEntitlements.js';
const prices = [['PLUS',7.99,1],['PREMIUM',12.99,1],['PREMIUM',119.99,12]];
const assumptions = {
  label: 'Illustrative US long-code costs, 2026-11-08; not a hard maximum or measured average',
  numberUsd:1.15, translationPerMillion:20, videoParticipantMinute:.004,
  smsBase:.0083, smsCarrierEstimate:.0045, mmsBase:.022, mmsCarrierEstimate:.01,
  pstnWithClientMinute:.018, forwardedPstnMinute:.0225,
  aiInputPerMillion:.40, aiOutputPerMillion:1.60, transcriptionMinuteEstimate:.006,
  storageReserve:{PLUS:.5,PREMIUM:1},
  exclusions:['international and special destinations','voice minute rounding beyond modeled whole-minute calls','inbound calls outside reserved paths','retries and failed calls with provider charges','free-user subsidy','refunds, disputes, tax and support','fixed overhead','eSIM costs'],
};
const scenarios=[
 {name:'25% of included usage',fraction:.25,smsSegments:1,aiInputTokens:8000},
 {name:'50% of included usage',fraction:.5,smsSegments:1,aiInputTokens:8000},
 {name:'100%, single-segment SMS',fraction:1,smsSegments:1,aiInputTokens:8000},
 {name:'100%, three-segment SMS and large AI prompts',fraction:1,smsSegments:3,aiInputTokens:35000},
];
const rows=[];
for(const [plan,price,months] of prices) for(const scenario of scenarios){
 const e=PLAN_ENTITLEMENTS[plan],f=scenario.fraction,a=assumptions;
 // 10% MMS share is a scenario assumption, not an observed traffic mix.
 const costs={
  number:a.numberUsd,
  translation:e.translationChars*f*a.translationPerMillion/1e6,
  messaging:e.smsMessages*f*(.9*scenario.smsSegments*(a.smsBase+a.smsCarrierEstimate)+.1*(a.mmsBase+a.mmsCarrierEstimate)),
  hostedVideo:e.hostedParticipantMinutes*f*a.videoParticipantMinute,
  pstn:e.pstnMinutes*f*a.pstnWithClientMinute,
  forwarding:e.forwardingMinutes*f*a.forwardedPstnMinute,
  ai:e.riaActions*f*(scenario.aiInputTokens*a.aiInputPerMillion+400*a.aiOutputPerMillion)/1e6,
  voicemail:e.voicemailTranscriptionMinutes*f*a.transcriptionMinuteEstimate,
  voiceNotes:(plan==='PREMIUM'?120:20)*f*a.transcriptionMinuteEstimate,
  storageReserve:a.storageReserve[plan],
 };
 const total=Object.values(costs).reduce((a,b)=>a+b,0);
 const web=(price*.964-.30)/months;
 const store=price*.85/months;
 rows.push({plan,price,months,scenario:scenario.name,costs,totalDirectCost:total,
  contributionWithoutAffiliate:{web:web-total,store:store-total},
  contributionWith20PercentNetAffiliate:{web:web*.8-total,store:store*.8-total},
  monthlyPriceNeededFor25PercentReserveWithAffiliate:{web:(total/.6+.30)/.964,store:total/(.85*.8*.75)},
 });
}
console.log(JSON.stringify({assumptions,scenarios,rows},null,2));
