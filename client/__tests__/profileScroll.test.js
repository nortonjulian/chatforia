/** @jest-environment jsdom */
import { getProfileScrollParent, scrollToProfileAnchor } from '@/utils/profileScroll';

describe('profile forwarding scroll positioning', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  test('selects drawer scroll container even before overflow exists', () => {
    const viewport = document.createElement('div');
    const anchor = document.createElement('div');
    viewport.style.overflowY = 'auto';
    viewport.append(anchor);
    document.body.append(viewport);
    expect(getProfileScrollParent(anchor)).toBe(viewport);
  });

  test('scrolls an initially zero-height drawer viewport to forwarding anchor', () => {
    const viewport = document.createElement('div');
    const anchor = document.createElement('div');
    viewport.style.overflowY = 'auto';
    viewport.append(anchor);
    document.body.append(viewport);

    Object.defineProperty(viewport, 'scrollHeight', { value: 0 });
    Object.defineProperty(viewport, 'clientHeight', { value: 0 });
    viewport.scrollTop = 0;

    viewport.getBoundingClientRect = () => ({ top: 100 });
    anchor.getBoundingClientRect = () => ({ top: 610 });
    const scrollTo = jest.fn(({ top }) => { viewport.scrollTop = top; });
    viewport.scrollTo = scrollTo;

    expect(scrollToProfileAnchor(anchor)).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith({ top: 498, behavior: 'auto' });
  });
});
