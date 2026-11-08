// Decision aid only: these alternatives are NOT imported by runtime entitlements.
// Rates and exclusions match docs/launch-economics-controls.md.
const packages = [
  { name: 'Price-preserving candidate', plan: 'PLUS', price: 7.99, annual: null,
    ai: 100, translation: 25000, hosted: 150, stt: 20, voicemail: 0 },
  { name: 'Price-preserving candidate', plan: 'PREMIUM', price: 12.99, annual: 119.99,
    ai: 100, translation: 25000, hosted: 200, stt: 60, voicemail: 30 },
  { name: 'More included usage candidate', plan: 'PLUS', price: 12.99, annual: null,
    ai: 200, translation: 50000, hosted: 250, stt: 20, voicemail: 0 },
  { name: 'More included usage candidate', plan: 'PREMIUM', price: 24.99, annual: 249.99,
    ai: 300, translation: 75000, hosted: 400, stt: 120, voicemail: 30 },
];
const rows=[];
for(const p of packages) for(const tokens of [8000,35000]) {
  const costs={ number:1.15, storageReserve:p.plan==='PLUS'?.5:1,
    ai:p.ai*(tokens*.4+400*1.6)/1e6, translation:p.translation*20/1e6,
    appCalls:p.hosted*.004, voiceNotes:p.stt*.006, voicemail:p.voicemail*.006 };
  const total=Object.values(costs).reduce((a,b)=>a+b,0);
  for(const [price,months] of [[p.price,1],...(p.annual?[[p.annual,12]]:[])]) {
    const web=(price*.964-.3)/months,store=price*.85/months;
    rows.push({package:p.name,plan:p.plan,price,months,inputTokensPerAction:tokens,costs,total,
      after20PercentNetCommission:{web:web*.8-total,store:store*.8-total},
      withoutCommission:{web:web-total,store:store-total}});
  }
}
console.log(JSON.stringify({
  warning:'Proposals only. Excludes phone/SMS traffic from base subscription: a separate funded offering and enforcement would need to be built first. No payment or entitlement behavior changes.',
  exclusions:['free users','tax/refunds/support','fixed overhead','storage/hosting above assumed reserve','international routes','eSIM'],
  packages,rows,
},null,2));
