import React from 'react';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import axiosClient from '@/api/axiosClient';
import SmsMessageMedia from '../SmsMessageMedia';
jest.mock('@/api/axiosClient', () => ({ __esModule: true, default: { get: jest.fn() } }));
let blobID;
beforeEach(() => {
 blobID=0;
 URL.createObjectURL=jest.fn(()=>`blob:sms-${++blobID}`);
 URL.revokeObjectURL=jest.fn();
 jest.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
});
afterEach(()=>{cleanup();jest.restoreAllMocks();jest.clearAllMocks();});
const props={messageId:166,mediaIndex:0,item:'https://media.example/opaque',accountKey:'65'};
const respond=(type)=>axiosClient.get.mockResolvedValue({data:new Blob(['media'],{type}),headers:{'content-type':type}});
test('authenticated audio response renders playable audio instead of an image',async()=>{
 respond('audio/mp4');render(<SmsMessageMedia {...props}/>);
 const audio=await screen.findByLabelText('Voice message');
 expect(audio.tagName).toBe('AUDIO');expect(audio.controls).toBe(true);
 expect(axiosClient.get).toHaveBeenCalledWith('/sms/media/166/0',expect.objectContaining({responseType:'blob',signal:expect.any(Object)}));
 expect(screen.queryByRole('img')).toBeNull();
});
test('image and video retain their appropriate controls',async()=>{
 respond('image/jpeg');const view=render(<SmsMessageMedia {...props}/>);
 expect((await screen.findByRole('img')).getAttribute('src')).toBe('blob:sms-1');
 respond('video/mp4');view.rerender(<SmsMessageMedia {...props} messageId={167}/>);
 expect((await screen.findByLabelText('Video attachment')).tagName).toBe('VIDEO');
 expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:sms-1');
});
test('failed attachment has a styled Retry loading control that only refetches media',async()=>{
 axiosClient.get.mockRejectedValueOnce(Error('offline'));render(<SmsMessageMedia {...props}/>);
 const alert=await screen.findByRole('alert');
 expect(alert.textContent).toContain("Couldn't load attachment.");
 const retry=screen.getByRole('button',{name:'Retry loading'});
 expect(retry.type).toBe('button');
 expect(retry.style.borderRadius).toBe('999px');
 respond('audio/mp4');fireEvent.click(retry);
 await screen.findByLabelText('Voice message');
 expect(axiosClient.get).toHaveBeenCalledTimes(2);
 expect(axiosClient.get.mock.calls.every(([url])=>url==='/sms/media/166/0')).toBe(true);
});
test('late previous-account response cannot render or allocate a media URL',async()=>{
 let resolve;axiosClient.get.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 const view=render(<SmsMessageMedia {...props}/>);respond('image/jpeg');
 view.rerender(<SmsMessageMedia {...props} accountKey="1"/>);await screen.findByRole('img');
 resolve({data:new Blob(['old'],{type:'audio/mp4'}),headers:{'content-type':'audio/mp4'}});
 await waitFor(()=>expect(URL.createObjectURL).toHaveBeenCalledTimes(1));expect(screen.queryByLabelText('Voice message')).toBeNull();
});
test('playing one SMS attachment pauses other SMS audio only',async()=>{
 respond('audio/mp4');render(<><SmsMessageMedia {...props}/><SmsMessageMedia {...props} messageId={167}/><audio aria-label="Ringtone"/></>);
 await waitFor(()=>expect(screen.getAllByLabelText('Voice message')).toHaveLength(2));
 const players=screen.getAllByLabelText('Voice message');fireEvent.play(players[0]);
 expect(players[1].pause).toHaveBeenCalled();
 // All media elements share the prototype spy: inspect receiver identities.
 const receivers=HTMLMediaElement.prototype.pause.mock.contexts;
 expect(receivers).toContain(players[1]);expect(receivers).not.toContain(screen.getByLabelText('Ringtone'));
});
test('unmount aborts pending retrieval and revokes loaded bytes',async()=>{
 respond('audio/mp4');const view=render(<SmsMessageMedia {...props}/>);await screen.findByLabelText('Voice message');
 const signal=axiosClient.get.mock.calls[0][1].signal;view.unmount();
 expect(signal.aborted).toBe(true);expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:sms-1');
});
