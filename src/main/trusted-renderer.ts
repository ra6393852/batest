import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
// Windows may expand a DOS 8.3/alias executable path when constructing frame URLs.
// Resolve both to the same on-disk file; retain strict file/frame/sender checks.
export function trustedLocalFile(path:string){
  const expected=realpathSync(path);let accepted:string|undefined;
  return (raw:string)=>{
    if(raw===accepted)return true;
    try{const url=new URL(raw);if(url.protocol!=='file:'||url.hostname||url.search||url.hash)return false;
      if(realpathSync(fileURLToPath(url))!==expected)return false;accepted=raw;return true;
    }catch{return false;}
  };
}
