import { estimateSmsSegments, estimateMessageCost, estimateCallCost } from '../economics/telecomCosting.js';
test('GSM and Unicode segment boundaries',()=>{
 expect(estimateSmsSegments('a'.repeat(160)).segments).toBe(1);
 expect(estimateSmsSegments('a'.repeat(161)).segments).toBe(2);
 expect(estimateSmsSegments('漢'.repeat(70)).segments).toBe(1);
 expect(estimateSmsSegments('漢'.repeat(71)).segments).toBe(2);
 expect(estimateSmsSegments('😀'.repeat(35)).segments).toBe(1);
 expect(estimateSmsSegments('😀'.repeat(36)).segments).toBe(2);
});
test('extended GSM characters consume two units and must not be split',()=>{
 expect(estimateSmsSegments('^'.repeat(80)).segments).toBe(1);
 expect(estimateSmsSegments('^'.repeat(153)).segments).toBe(3);
});
test('toll-free US/Canada concatenation has smaller payload capacity',()=>{
 expect(estimateSmsSegments('a'.repeat(306)).segments).toBe(2);
 expect(estimateSmsSegments('a'.repeat(306),{tollFreeUsCanada:true}).segments).toBe(3);
});
test('carrier fee is per segment; MMS uses its own per-message rate',()=>{
 expect(estimateMessageCost({body:'a'.repeat(161),baseRate:.0083,carrierRate:.0045}).estimatedUsd).toBeCloseTo(.0256);
 expect(estimateMessageCost({body:'a'.repeat(161),mediaCount:2,baseRate:.022,carrierRate:.01}).estimatedUsd).toBeCloseTo(.032);
});
test('forwarding includes both separately rounded legs',()=>{
 expect(estimateCallCost([{seconds:61,ratePerMinute:.0085},{seconds:61,ratePerMinute:.014}])).toBeCloseTo(.045);
});
test('unknown rates fail instead of being presented as zero-cost usage',()=>{
 expect(()=>estimateMessageCost({body:'hello',baseRate:.0083})).toThrow('carrierRate');
 expect(()=>estimateCallCost([{seconds:-1,ratePerMinute:.014}])).toThrow('seconds');
});
