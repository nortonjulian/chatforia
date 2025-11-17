import { jest } from '@jest/globals';
import {
  setSocketIo,
  getIo,
  isReady,
  emitToUser,
  emitToUsers,
  emitToRoom,
  emitToChatRoom,
  _resetSocketBus,
} from '../socketBus.js';

const makeIo = () => {
  const emit = jest.fn();
  const to = jest.fn(() => ({ emit }));
  return { to, emit };
};

describe('socketBus', () => {
  beforeEach(() => {
    _resetSocketBus();
    jest.clearAllMocks();
  });

  it('setSocketIo registers io and default emitToUser implementation', () => {
    const io = makeIo();

    expect(getIo()).toBeNull();
    expect(isReady()).toBe(false);

    setSocketIo(io);

    expect(getIo()).toBe(io);
    expect(isReady()).toBe(true);

    // default emitToUser: uses io.to(`user:${uid}`).emit()
    emitToUser(123, 'ping', { foo: 'bar' });

    expect(io.to).toHaveBeenCalledWith('user:123');
    const emitFn = io.to.mock.results[0].value.emit;
    expect(emitFn).toHaveBeenCalledWith('ping', { foo: 'bar' });
  });

  it('setSocketIo uses custom emitToUser implementation when provided', () => {
    const customEmit = jest.fn();

    setSocketIo(null, customEmit); // no io, only custom impl

    emitToUser(7, 'custom_evt', { answer: 42 });

    expect(customEmit).toHaveBeenCalledWith(7, 'custom_evt', { answer: 42 });
  });

  it('emitToUser does nothing when _emitToUserImpl is not set', () => {
    // ensure reset state
    _resetSocketBus();

    // Should not throw
    expect(() => emitToUser(1, 'evt', {})).not.toThrow();
  });

  it('emitToUsers fans out to user rooms and emits event', () => {
    const io = makeIo();
    setSocketIo(io);

    emitToUsers([1, null, 2, undefined, 3], 'notify', { x: 1 });

    // Called once with filtered room list
    expect(io.to).toHaveBeenCalledWith([
      'user:1',
      'user:2',
      'user:3',
    ]);

    const emitFn = io.to.mock.results[0].value.emit;
    expect(emitFn).toHaveBeenCalledWith('notify', { x: 1 });
  });

  it('emitToUsers is a no-op when io is not set or rooms empty', () => {
    _resetSocketBus();

    // No io, should not throw or call anything
    expect(() => emitToUsers([1, 2], 'evt', {})).not.toThrow();

    const io = makeIo();
    setSocketIo(io);

    // Empty / all-null ids
    emitToUsers([null, undefined], 'evt', {});
    expect(io.to).not.toHaveBeenCalled();
  });

  it('emitToRoom emits to a specific room when io is set', () => {
    const io = makeIo();
    setSocketIo(io);

    emitToRoom(999, 'room_evt', { ok: true });

    expect(io.to).toHaveBeenCalledWith('999');
    const emitFn = io.to.mock.results[0].value.emit;
    expect(emitFn).toHaveBeenCalledWith('room_evt', { ok: true });
  });

  it('emitToRoom is a no-op when room is falsy or io not set', () => {
    const io = makeIo();
    setSocketIo(io);

    emitToRoom('', 'evt', {});
    emitToRoom(null, 'evt', {});
    _resetSocketBus();
    emitToRoom(123, 'evt', {});

    expect(io.to).not.toHaveBeenCalled();
  });

  it('emitToChatRoom emits to chatRoomId namespace as string', () => {
    const io = makeIo();
    setSocketIo(io);

    emitToChatRoom(0, 'chat_evt', { ok: true }); // 0 is allowed (== null check)
    emitToChatRoom(42, 'chat_evt2', { ok: false });

    expect(io.to).toHaveBeenCalledWith('0');
    expect(io.to).toHaveBeenCalledWith('42');

    const emitFirst = io.to.mock.results[0].value.emit;
    const emitSecond = io.to.mock.results[1].value.emit;

    expect(emitFirst).toHaveBeenCalledWith('chat_evt', { ok: true });
    expect(emitSecond).toHaveBeenCalledWith('chat_evt2', { ok: false });
  });

  it('emitToChatRoom is a no-op when chatRoomId is null/undefined or io not set', () => {
    const io = makeIo();
    setSocketIo(io);

    emitToChatRoom(null, 'evt', {});
    emitToChatRoom(undefined, 'evt', {});

    expect(io.to).not.toHaveBeenCalled();

    _resetSocketBus();

    // No io
    expect(() => emitToChatRoom(123, 'evt', {})).not.toThrow();
  });

  it('_resetSocketBus clears io and emitToUserImpl', () => {
    const io = makeIo();
    const customEmit = jest.fn();

    setSocketIo(io, customEmit);
    expect(getIo()).toBe(io);
    expect(isReady()).toBe(true);

    _resetSocketBus();

    expect(getIo()).toBeNull();
    expect(isReady()).toBe(false);

    // After reset, emitToUser should not call previous custom impl
    emitToUser(1, 'evt', {});
    expect(customEmit).not.toHaveBeenCalled();
  });
});
