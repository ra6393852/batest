import {it,expect} from 'vitest';
import {CaptureUpdates} from '../../src/main/capture-updates';
import type {CaptureInfo} from '../../src/shared/types';
it('keeps fresh observation status while omitting identical images, and sends changed or restored images',()=>{
  const updates=new CaptureUpdates(),first:CaptureInfo={enabled:true,state:'collecting',message:'ok',preview:'png',originalPreview:'original',capturedAt:'one'};
  expect(updates.next(first).preview).toBe('png');
  const reused=updates.next({...first,state:'blocked',message:'waiting',capturedAt:'two'});
  expect(reused.preview).toBeUndefined();expect(reused.previewUnchanged).toBe(true);expect(reused.capturedAt).toBe('two');
  expect(updates.next({...first,preview:'changed'}).preview).toBe('changed');
  expect(updates.next({...first,preview:undefined,originalPreview:undefined}).previewUnchanged).toBe(false);
  expect(updates.next(first).preview).toBe('png');
});
