import { captureCreatorReferral, currentCreatorReferral, clearCreatorReferral } from '../creatorReferral';
beforeEach(() => { clearCreatorReferral(); jest.useFakeTimers(); jest.setSystemTime(new Date('2026-11-09T12:00:00Z')); });
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); clearCreatorReferral(); });
test('captures first touch through both link forms and does not replace it', () => {
  expect(captureCreatorReferral({pathname: '/ref/creator_1', search: ''})).toBe('CREATOR_1');
  expect(captureCreatorReferral({pathname: '/register', search: '?ref=creator_2'})).toBe('CREATOR_1');
});
test('query link survives a module reload', () => {
  captureCreatorReferral({pathname: '/register', search: '?ref=creator_2'});
  jest.isolateModules(() => { expect(require('../creatorReferral').currentCreatorReferral()).toBe('CREATOR_2'); });
});
test('expires at 30 days and rejects future timestamps', () => {
  captureCreatorReferral({pathname: '/ref/creator_1', search: ''});
  jest.advanceTimersByTime(30 * 86400000);
  expect(currentCreatorReferral()).toBeNull();
  localStorage.setItem('chatforia.creatorReferral', JSON.stringify({code: 'CREATOR', savedAt: Date.now()+1000}));
  expect(currentCreatorReferral()).toBeNull();
});
test.each(['/ref/a', '/ref/abc/extra', '/ref/%ZZ', '/ref/%3Cscript%3E', '/login'])('ignores invalid path %s', pathname => {
  expect(captureCreatorReferral({pathname, search: '?ref=CREATOR'})).toBeNull();
});
test('denied storage still permits capture and clearing in memory', () => {
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
  jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
  expect(captureCreatorReferral({pathname: '/ref/creator_1', search: ''})).toBe('CREATOR_1');
  expect(currentCreatorReferral()).toBe('CREATOR_1');
  clearCreatorReferral();
  expect(currentCreatorReferral()).toBeNull();
});
