import fs from 'node:fs';
import path from 'node:path';

export function canonicalDirectory(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) return '';
  try { const real = fs.realpathSync(value); return fs.statSync(real).isDirectory() ? real : ''; }
  catch { return ''; }
}

export function workspacePath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\u0000-\u001f]/.test(value)) return '';
  return canonicalDirectory(value) || path.normalize(value);
}

export function agentWorkspace(agent) {
  return workspacePath(agent?.session?.header?.cwd || agent?.session?.cwd || '');
}

export function sessionKey(value) {
  const key = String(value || '').trim();
  return key.startsWith('session-') ? key.slice(8) : key;
}

export function nativeSessionId(agent) {
  for (const key of ['id', 'sessionId', 'key', 'sessionKey', 'sid']) {
    const value = agent?.session?.[key];
    if (typeof value === 'string' && value) return value;
  }
  return typeof agent?.id === 'string' ? agent.id : '';
}
export function sessionId(agent) { return sessionKey(nativeSessionId(agent)); }
