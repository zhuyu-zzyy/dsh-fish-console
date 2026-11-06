import { resolveRole } from './roles.js';
import { sessionKey, workspacePath } from './paths.js';
import { inspectPrivateChannel, privateSessionConflict } from './private-routing.js';

export const identityKey = identity => JSON.stringify([identity.selfName, identity.ownerName]);
export function uniqueIdentity(values) {
  const identities = new Map(values.map(value => [identityKey(value), value]));
  return identities.size === 1 ? [...identities.values()][0] : null;
}

// Global plugin fields have one value, even when the console manages many roles.
// Only identities referenced by saved bindings participate in global defaults.
export function identityTargets(config, catalog, routes) {
  const ids = new Set(config.bindings.workspaces.map(b => b.roleId));
  const roles = config.roles.filter(role => ids.has(role.id));
  const owners = [...new Set(roles.map(role => role.ownerName))];
  const entries = new Map(catalog.sessions.map(session => [session.id, session]));
  for (const id of config.roles.flatMap(role => [...role.privateChat.localSessions, role.privateChat.bili.sessionId, role.privateChat.qq.sessionId]).filter(Boolean)) {
    const session = catalog.lookup(id);
    if (session) entries.set(session.id, session);
  }
  const sessions = [...entries.values()].flatMap(session => {
    const resolved = resolveRole(config, session, catalog.lookup);
    const role = resolved.role, profile = role?.privateChat;
    const personal = routes && profile?.enabled && !privateSessionConflict(role, session.id, routes) && (profile.localSessions.includes(session.id)
      || ['bili', 'qq'].some(channel => profile[channel].sessionId === session.id && inspectPrivateChannel(role, channel, routes).eligible));
    return resolved.role && session.origin !== 'subagent'
      ? [{ ...session, nativeId: session.nativeId || session.id, roleId: role.id, selfName: role.selfName, ownerName: personal && profile.ownerName ? profile.ownerName : role.ownerName }]
      : [];
  });
  const byId = new Map(sessions.map(session => [sessionKey(session.id), session]));
  return { config, catalog, active: roles.length > 0, sessions, lookup: id => byId.get(sessionKey(id)), globalOwner: owners.length === 1 ? owners[0] : null, globalIdentity: uniqueIdentity(roles) };
}

// Version-specific workspace key used by dsh-feiyu-mood 0.8.0.
export function moodWorkspaceKey(workspace) {
  let readable = '', separator = false;
  for (const char of String(workspace)) {
    if ('/\\:'.includes(char)) { if (!separator) readable += '-'; separator = true; }
    else { readable += /^[A-Za-z0-9._-]$/.test(char) ? char : '~' + char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'); separator = false; }
  }
  return '--' + (readable.replace(/^-+/, '') || 'root').slice(0, 251) + '--';
}
export function moodWorkspaceMatches(key, workspace) {
  return key?.startsWith('--') ? key === moodWorkspaceKey(workspace) : workspacePath(key) === workspace;
}
