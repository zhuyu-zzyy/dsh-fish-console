import { resolveRole } from './roles.js';
import { describeAgent } from './catalog.js';
import { privateRevision, privateSections } from './private-profile.js';
import { identifyPrivateInput, privateRouteRevision } from './private-routing.js';
import { createHash } from 'node:crypto';

const contextSources = new Set(['runtime-context', 'tool-registry']);
const witness = value => createHash('sha256').update(String(value)).digest('hex');
// Retain only the native source header needed for verification, never the
// user's private message body while awaiting the live plugin configuration.
function evidenceOf(message) {
  const kind = message.source?.kind;
  const raw = Array.isArray(message.content) ? message.content.find(item => item?.type === 'text')?.text : message.content;
  const text = typeof raw === 'string' ? raw.slice(0, 256) : '';
  let prefix = '';
  if (kind === 'qq' && text.startsWith('【QQ私聊】\n')) prefix = '【QQ私聊】\n';
  if (kind === 'bili-duty-scan') for (const [start, end] of [
    ['⚠️ 这一轮只有', '私信转来的一条视频：'],
    ['⚠️ 这一轮只是', '在 **B站 私信**里跟你说了一句话（没带视频）：'],
  ]) {
    if (!text.startsWith(start)) continue;
    const index = text.indexOf(end, start.length);
    if (index >= 0) prefix = text.slice(0, index + end.length);
    break;
  }
  return { role: 'user', source: { kind }, content: prefix };
}

export function createPrivateRuntime({ getConfig, getCatalog, getRoutes, verifyRoutes }) {
  const claims = new WeakMap();
  return {
    claim({ agent, message, turn } = {}) {
      if (!agent || !message || !Number.isSafeInteger(turn) || message.role !== 'user' || contextSources.has(message.source?.kind)) return;
      try {
        const config = getConfig(); if (!config) return;
        const catalog = getCatalog(agent), descriptor = catalog.lookup(describeAgent(agent).id) || describeAgent(agent);
        const resolved = resolveRole(config, descriptor, catalog.lookup), role = resolved.role;
        if (!role?.privateChat.enabled) { claims.delete(agent); return; }
        const routes = getRoutes(), revision = privateRevision(role), routeRevision = privateRouteRevision(routes);
        let frame = claims.get(agent);
        if (!frame || frame.turn !== turn) {
          frame = { turn, revision, routeRevision, blocked: false, count: 0, channels: new Set(), evidence: [], authorized: !verifyRoutes };
          if (verifyRoutes) frame.claimRoutes = Promise.resolve().then(() => verifyRoutes()).catch(() => null);
          claims.set(agent, frame);
        }
        frame.count++;
        if (frame.count > 128 || frame.revision !== revision || frame.routeRevision !== routeRevision) frame.blocked = true;
        if (verifyRoutes) {
          if (!frame.blocked) frame.evidence.push(evidenceOf(message));
          frame.authorized = false;
        } else {
          const identity = identifyPrivateInput(role, descriptor, message, routes);
          if (!identity) frame.blocked = true;
          else { frame.channels.add(identity.channel); if (identity.channel === 'bili') frame.biliUidHash = witness(role.privateChat.bili.uid); }
        }
      } catch { claims.set(agent, { turn, blocked: true }); }
    },
    async verify(agent, role) {
      if (!verifyRoutes) return this.current(agent, role);
      const frame = agent && claims.get(agent);
      if (!frame || frame.blocked || !role?.privateChat.enabled || agent.phase?.kind !== 'running' || agent.phase.turn !== frame.turn || frame.revision !== privateRevision(role)) return null;
      try {
        const atClaim = await frame.claimRoutes;
        const live = await verifyRoutes();
        if (claims.get(agent) !== frame || agent.phase?.kind !== 'running' || agent.phase.turn !== frame.turn) return null;
        const config = getConfig(), catalog = getCatalog(agent), descriptor = catalog.lookup(describeAgent(agent).id) || describeAgent(agent);
        const resolved = config && resolveRole(config, descriptor, catalog.lookup).role;
        if (!atClaim || !live || !resolved || resolved.id !== role.id || privateRevision(resolved) !== frame.revision
          || privateRouteRevision(getRoutes()) !== frame.routeRevision
          || privateRouteRevision(atClaim) !== privateRouteRevision(live)) {
          frame.blocked = true; frame.authorized = false; return null;
        }
        const channels = new Set();
        for (const message of frame.evidence) {
          const identity = identifyPrivateInput(resolved, descriptor, message, live);
          if (!identity) { frame.blocked = true; frame.authorized = false; return null; }
          channels.add(identity.channel);
        }
        frame.channels = channels; frame.authorized = channels.size > 0;
        if (channels.has('bili')) frame.biliUidHash = witness(resolved.privateChat.bili.uid);
        return this.current(agent, resolved);
      } catch { frame.blocked = true; frame.authorized = false; return null; }
    },
    current(agent, role) {
      if (!agent || !role?.privateChat.enabled) return null;
      const phase = agent.phase, frame = claims.get(agent);
      if (phase?.kind !== 'running' || frame?.turn !== phase.turn || frame.blocked || !frame.authorized || !frame.channels?.size || frame.revision !== privateRevision(role)) return null;
      try { if (frame.routeRevision !== privateRouteRevision(getRoutes())) return null; } catch { return null; }
      frame.applied = true;
      return { roleId: role.id, revision: frame.revision, channel: [...frame.channels].sort().join('+'), sections: privateSections(role) };
    },
    denyTool(exec, role) {
      const current = this.current(exec.agent, role);
      const frame = claims.get(exec.agent);
      if (!current && !(frame?.applied && exec.agent?.phase?.kind === 'running' && exec.agent.phase.turn === frame.turn)) return undefined;
      if (['bili_reply', 'bili_send_dynamic', 'bili_config', 'bili_setup'].includes(exec.name)) return '本轮是本人专属私聊，不能在此轮发布公开评论、动态或改动平台路由。';
      if (exec.name === 'bili_send_message') {
        const uid = role?.privateChat.bili.uid;
        if (!current?.channel.split('+').includes('bili') || !uid || witness(uid) !== frame.biliUidHash || (exec.arguments?.uid !== undefined && String(exec.arguments.uid) !== uid)) return '私聊回复只能发回已识别的本人 B站私信账号。';
      }
      return undefined;
    },
  };
}
