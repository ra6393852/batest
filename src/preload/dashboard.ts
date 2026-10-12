import { contextBridge, ipcRenderer } from 'electron';
import type { AnalyzerAPI, CollectorStatus } from '../shared/types';
const api: AnalyzerAPI = {
  snapshot: (roomId, shoeId) => ipcRenderer.invoke('analyzer:snapshot', roomId, shoeId),
  open: mode => ipcRenderer.invoke('browser:open', mode),
  closeBrowser: () => ipcRenderer.invoke('browser:close'),
  confirm: (id, accept) => ipcRenderer.invoke('analyzer:confirm', id, accept),
  exportCSV: (roomId, shoeId) => ipcRenderer.invoke('analyzer:export', roomId, shoeId),
  importProfile: () => ipcRenderer.invoke('browser:profile'),
  setBrowserBounds: bounds => ipcRenderer.send('browser:bounds', bounds),
  onChange: callback => { const listener = () => callback(); ipcRenderer.on('analyzer:changed', listener); return () => ipcRenderer.removeListener('analyzer:changed', listener); },
  onStatus: callback => { const listener = (_event: unknown, status: CollectorStatus) => callback(status); ipcRenderer.on('collector:status', listener); return () => ipcRenderer.removeListener('collector:status', listener); },
};
contextBridge.exposeInMainWorld('analyzer', Object.freeze(api));
