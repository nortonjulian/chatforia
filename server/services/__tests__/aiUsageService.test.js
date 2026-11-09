import { jest } from '@jest/globals';
const consume=jest.fn(); const release=jest.fn();
await jest.unstable_mockModule('../planUsageService.js',()=>({assertAndConsumeUsage:consume,releaseUsage:release}));
const {withRiaAllowance,assertAiPromptBudget,AI_MAX_PROMPT_BYTES}=await import('../aiUsageService.js');
beforeEach(()=>jest.resetAllMocks());
test('UTF-8 budget includes multibyte content and rejects before provider work',()=>{
 expect(()=>assertAiPromptBudget([{content:'a'.repeat(AI_MAX_PROMPT_BYTES)}])).not.toThrow();
 expect(()=>assertAiPromptBudget([{content:'😀'.repeat(AI_MAX_PROMPT_BYTES/4+1)}])).toThrow('too long');
});
test('exhausted AI allowance does not call the provider',async()=>{
 consume.mockRejectedValue(new Error('exhausted'));const provider=jest.fn();
 await expect(withRiaAllowance({id:1,plan:'PLUS'},provider)).rejects.toThrow('exhausted');
 expect(provider).not.toHaveBeenCalled();expect(release).not.toHaveBeenCalled();
});
test('failed AI call refunds the original calendar month across midnight',async()=>{
 jest.useFakeTimers();
 try {
  jest.setSystemTime(new Date('2026-11-30T23:59:59Z'));
  await expect(withRiaAllowance({id:1,plan:'PLUS'},async()=>{
   jest.setSystemTime(new Date('2026-12-01T00:00:01Z'));throw new Error('failed');
  })).rejects.toThrow('failed');
  expect(release.mock.calls[0][0].date.toISOString()).toBe('2026-11-30T23:59:59.000Z');
 } finally {jest.useRealTimers();}
});
