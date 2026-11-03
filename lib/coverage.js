import { roleRevision, roleSections, resolveRole } from './roles.js';
import { describeAgent } from './catalog.js';
import { sessionKey } from './paths.js';
import { privateRevision } from './private-profile.js';

function contentText(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n');
}
function effectiveSystem(options) {
  if (typeof options.system === 'string') return options.system;
  return contentText([...(options.messages || [])].reverse().find(m => m.role === 'system')?.content);
}
function categoryOf(options, session) {
  if (Object.hasOwn(options, 'toolHistory') && options.sessionId) return session?.origin === 'subagent' ? 'subagent' : 'conversation';
  const plugin = [...(options.messages || [])].reverse().find(m => m.role === 'user' && m.source?.kind === 'plugin')?.source?.plugin;
  return ({ 'dsh-fish-memory': 'memory', 'dsh-feiyu-mood': 'mood', 'dsh-bili-subagent': 'bili' })[plugin] || 'other';
}
export function createCoverage(limit = 200) {
  const records = [], attempts = new Map();
  const startedAt = new Date().toISOString();
  let sequence = 0;
  const counters = { covered: 0, uncovered: 0, unbound: 0, unknown: 0 };
  return {
    assembly(descriptor, resolution) {
      if (!descriptor.id) return;
      attempts.delete(descriptor.id);
      attempts.set(descriptor.id, { sessionId: descriptor.id, roleId: resolution.role?.id, revision: resolution.role ? roleRevision(resolution.role) : null, attemptedAt: new Date().toISOString() });
      if (attempts.size > limit) attempts.delete(attempts.keys().next().value);
    },
    observe(options, config, catalog, initiator, personal) {
      let descriptor, attribution = 'none';
      const explicit = typeof options.sessionId === 'string' && sessionKey(options.sessionId);
      if (explicit) { descriptor = catalog.lookup(explicit); attribution = 'sessionId'; }
      else if (initiator) {
        const current = describeAgent(initiator);
        const known = catalog.lookup(current.id);
        if (known?.live && !known.ambiguous && catalog.isLive?.(initiator)) { descriptor = known; attribution = 'initiator'; }
      }
      const category = categoryOf(options, descriptor);
      const resolution = descriptor && !descriptor.ambiguous ? resolveRole(config, descriptor, catalog.lookup) : null;
      let status, reason, privateInput;
      if (!descriptor || descriptor.ambiguous || resolution?.status === 'unresolved') {
        status = 'unknown'; reason = '无法可靠确认会话或角色归属';
      } else if (resolution.status !== 'bound') {
        status = 'unbound'; reason = '此会话未绑定统一角色';
      } else {
        const system = effectiveSystem(options);
        status = roleSections(resolution.role).every(section => system.includes(section.text)) ? 'covered' : 'uncovered';
        reason = status === 'covered' ? '在模型入口确认系统输入包含当前版本的完整角色及身份' : '已归属角色，但请求未携带当前版本的完整人设';
        if (personal) {
          const carried = personal.sections.every(section => system.includes(section.text));
          privateInput = { status: carried ? 'covered' : 'uncovered', roleId: personal.roleId, revision: personal.revision, channel: personal.channel };
          if (!carried) { status = 'uncovered'; reason = '本轮已识别本人私聊，但模型输入缺少当前专属规则'; }
        } else if (system.includes('<fish-console-private ')) {
          privateInput = { status: 'unexpected' }; status = 'uncovered'; reason = '未识别为本人私聊，却发现专属规则标记，请检查输入来源';
        }
      }
      counters[status]++;
      records.push({ id: ++sequence, observedAt: new Date().toISOString(), category, status, reason, sessionId: descriptor?.id || null, explicitUnresolved: !!explicit && !descriptor, roleId: resolution?.role?.id || null, revision: resolution?.role ? roleRevision(resolution.role) : null, attribution, frozen: Object.isFrozen(options), ...(privateInput ? { privateInput } : {}) });
      if (records.length > limit) records.shift();
    },
    snapshot(config, catalog) {
      const current = new Map(config.roles.map(r => [r.id, roleRevision(r)]));
      return { startedAt, limit, counters: { ...counters }, categories: ['conversation', 'subagent', 'memory', 'mood', 'bili', 'other'], records: records.map(r => {
        const descriptor = r.sessionId && catalog?.lookup(r.sessionId);
        const resolved = descriptor && resolveRole(config, descriptor, catalog.lookup);
        let currentBinding = resolved && resolved.status !== 'unresolved'
          ? (resolved.role?.id || null) === r.roleId && (!r.roleId || current.get(r.roleId) === r.revision)
          : null;
        if (r.privateInput?.revision && resolved?.role && (!resolved.role.privateChat.enabled || r.privateInput.revision !== privateRevision(resolved.role))) currentBinding = false;
        return { ...r, currentRevision: !!r.roleId && current.get(r.roleId) === r.revision, currentBinding };
      }), attempts: [...attempts.values()].map(a => ({ ...a })) };
    },
  };
}
