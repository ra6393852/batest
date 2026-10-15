import {test,expect} from 'vitest';
import {mkdtempSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {trustedLocalFile} from '../../src/main/trusted-renderer';
test('local renderer identity permits encoded file paths and rejects other files, origins, query and fragment',()=>{
  const dir=mkdtempSync(join(tmpdir(),'baccarat-path-'));
  try{const path=join(dir,'한글 space.html'),other=join(dir,'other.html');writeFileSync(path,'a');writeFileSync(other,'b');const trusted=trustedLocalFile(path),url=pathToFileURL(path).href;
    expect(trusted(url)).toBe(true);expect(trusted(url)).toBe(true);expect(trusted(url+'?extra=1')).toBe(false);expect(trusted(url+'#fragment')).toBe(false);
    expect(trusted(pathToFileURL(other).href)).toBe(false);expect(trusted('https://example.com')).toBe(false);expect(trusted('file://attacker/share')).toBe(false);
    // Non-Windows fixture demonstrates filesystem alias resolution without requiring elevated symlink permissions.
    if(process.platform!=='win32'){const alias=join(dir,'alias.html');symlinkSync(path,alias);expect(trusted(pathToFileURL(alias).href)).toBe(true);}
  }finally{rmSync(dir,{recursive:true,force:true});}
});
