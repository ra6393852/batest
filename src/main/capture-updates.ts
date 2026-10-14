import type {CaptureInfo} from '../shared/types';
// Send status/timestamps every observation, but unchanged PNGs only once.
export class CaptureUpdates {
  private preview?:string;
  private original?:string;
  next(info:CaptureInfo):CaptureInfo {
    const same=!!info.preview&&info.preview===this.preview&&info.originalPreview===this.original;
    this.preview=info.preview;this.original=info.originalPreview;
    return same?{...info,preview:undefined,originalPreview:undefined,previewUnchanged:true}:{...info,previewUnchanged:false};
  }
}
