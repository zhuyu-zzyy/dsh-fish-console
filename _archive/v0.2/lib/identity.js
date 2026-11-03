import { canonicalDirectory, agentWorkspace } from './policy.js';

export function sessionKey(value) {
  const key = String(value || '').trim();
  return key.startsWith('session-') ? key.slice(8) : key;
}

export function sessionId(agent) {
  for (const key of ['id', 'sessionId', 'key', 'sessionKey', 'sid']) {
    const value = agent?.session?.[key];
    if (typeof value === 'string' && value) return value;
  }
  return typeof agent?.id === 'string' ? agent.id : '';
}

export function workspaceSessions(ctx, workspace, extraAgent) {
  const records = ctx.workspaceRegistry.list();
  const target = records.find(record => canonicalDirectory(record.path) === workspace);
  if (!target) throw new Error('绑定的工作区已不在 DSH 名单中');
  const ids = new Set(target.sessionIds || []);
  const agents = [...(ctx.agents.list() || []), ...(extraAgent ? [extraAgent] : [])];
  for (const agent of agents) {
    if (agentWorkspace(agent) === workspace && sessionId(agent)) ids.add(sessionId(agent));
  }
  return { ids: [...ids], keys: new Set([...ids].map(sessionKey)) };
}

// Compatibility boundary for dsh-feiyu-mood 0.8.0's workspace slot key.
export function moodWorkspaceKey(workspace) {
  let readable = '';
  let separator = false;
  for (const char of String(workspace).split('')) {
    if ('/\\:'.includes(char)) {
      if (!separator) readable += '-';
      separator = true;
    } else {
      readable += /^[A-Za-z0-9._-]$/.test(char) ? char : '~' + char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
      separator = false;
    }
  }
  return '--' + (readable.replace(/^-+/, '') || 'root').slice(0, 251) + '--';
}
