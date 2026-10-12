export const SITE_URL = 'https://box-1515.com';
export function navigationAllowed(raw: string, hosts: string[]) {
  try { const url = new URL(raw); return url.protocol === 'https:' && !url.username && !url.password && !url.port && hosts.includes(url.hostname); }
  catch { return false; }
}
