import { ipcRenderer } from 'electron';
import { demoProfile, ObservationTracker, readDOM } from '../collector/dom';
import type { AdapterProfile } from '../shared/types';
// Isolated preload: the remote page receives no Node API, IPC, or privileged global.
window.addEventListener('DOMContentLoaded', async () => {
  const config: { mode: 'demo' | 'site'; profile: AdapterProfile | null } = await ipcRenderer.invoke('collector:config');
  const profile = config.mode === 'demo' ? demoProfile : config.profile;
  if (!profile) return;
  const tracker = new ObservationTracker();
  let busy = false;
  const scan = async () => {
    if (busy) return;
    busy = true;
    try {
      const rows = readDOM(document, profile, config.mode === 'demo' ? 'demo' : 'dom');
      if (!rows.length && !profile.ocr) ipcRenderer.send('collector:empty');
      const fresh = tracker.filter(rows);
      if (fresh.length) await ipcRenderer.invoke('collector:observations', fresh);
      if (config.mode === 'site' && profile.ocr) {
        const image = document.querySelector(profile.ocr.imageSelector);
        const marker = document.querySelector(profile.ocr.roundSelector);
        const round = Number(marker?.getAttribute(profile.ocr.roundAttribute));
        const room = document.querySelector(profile.roomSelector), shoe = document.querySelector(profile.shoeSelector);
        const rect = image?.getBoundingClientRect();
        if (rect && rect.width && rect.height && round > 0 && Number.isInteger(round) && room && shoe) {
          await ipcRenderer.invoke('collector:ocr', {
            roomId: room.getAttribute(profile.roomIdAttribute), roomName: room.textContent?.trim(),
            shoeId: shoe.getAttribute(profile.shoeIdAttribute), round,
            rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
          });
        }
      }
    } catch {
      ipcRenderer.send('collector:failed');
    } finally { busy = false; }
  };
  const interval = setInterval(() => { void scan(); }, 1000);
  void scan();
  window.addEventListener('pagehide', () => clearInterval(interval), { once: true });
});
