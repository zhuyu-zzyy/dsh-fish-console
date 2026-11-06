import { agentWorkspace, canonicalDirectory, nativeSessionId, sessionId, sessionKey, workspacePath } from './paths.js';
import { privateSessionIds } from './private-profile.js';
import { resolveRole } from './roles.js';

// Cordis rejects direct reads of undeclared services in plugin fibers. Optional
// metadata must use its public lookup, without making these services mandatory.
function optionalService(ctx, name) {
  try { return typeof ctx.get === 'function' ? ctx.get(name) : ctx[name]; }
  catch { return undefined; }
}
export function describeAgent(agent) {
  const header = agent?.session?.header;
  return { id: sessionId(agent), nativeId: nativeSessionId(agent), workspace: agentWorkspace(agent), parentId: sessionKey(header?.parentSession), origin: header?.origin || (header?.delegationDepth > 0 ? 'subagent' : ''), live: true };
}
function titleOf(ctx, id, agent) {
  try {
    const sessions = optionalService(ctx, 'sessions');
    const projections = optionalService(ctx, 'sessionProjections');
    const session = agent?.session || sessions?.get(id) || sessions?.get('session-' + id);
    const state = session && projections?.stateOf(session, 'title');
    const value = typeof state === 'string' ? state : state?.title;
    if (typeof value === 'string' && value.trim()) return value.slice(0, 160);
  } catch {}
  return '';
}
export function collectCatalog(ctx, extraAgent, metadata = new Map(), includeTitles = false) {
  const workspaces = [], entries = new Map();
  let registryAvailable = true, agentsAvailable = true;
  try {
    for (const record of ctx.workspaceRegistry.list() || []) {
      const workspace = workspacePath(record.path);
      if (!workspace) continue;
      const ids = [...(record.sessionIds || [])].filter(id => typeof id === 'string');
      workspaces.push({ path: workspace, title: String(record.title || workspace).slice(0, 160), available: !!canonicalDirectory(workspace), sessionCount: ids.length });
      for (const nativeId of ids) {
        const id = sessionKey(nativeId);
        const previous = entries.get(id);
        entries.set(id, previous && previous.workspace !== workspace
          ? { ...previous, workspace: '', ambiguous: true }
          : { ...metadata.get(id), id, nativeId: metadata.get(id)?.nativeId || nativeId, workspace, parentId: metadata.get(id)?.parentId || '', origin: metadata.get(id)?.origin || '', live: false, known: true,
            ...(metadata.get(id)?.workspace && metadata.get(id).workspace !== workspace ? { ambiguous: true } : {}) });
      }
    }
  } catch { registryAvailable = false; }
  let agents = [];
  try { agents = ctx.agents.list() || []; } catch { agentsAvailable = false; }
  for (const agent of [...agents, ...(extraAgent ? [extraAgent] : [])]) {
    const descriptor = describeAgent(agent);
    if (!descriptor.id) continue;
    const previous = entries.get(descriptor.id);
    entries.set(descriptor.id, { ...previous, ...descriptor, known: true, ambiguous: previous?.ambiguous || false, title: (includeTitles && titleOf(ctx, descriptor.id, agent)) || previous?.title || metadata.get(descriptor.id)?.title || '' });
  }
  const sessions = [...entries.values()].map(s => ({ ...s, title: s.title || (includeTitles && titleOf(ctx, s.id)) || `会话 ${s.id.slice(0, 12)}` }));
  const byId = new Map(sessions.map(s => [s.id, s]));
  return { workspaces, sessions, registryAvailable, agentsAvailable, lookup: id => byId.get(sessionKey(id)) || metadata.get(sessionKey(id)), isLive: agent => agents.includes(agent) || extraAgent === agent };
}

// Cold session headers and title projections are read through host services,
// never by loading an Agent or opening/replaying private chat bodies ourselves.
export function createCatalogReader(ctx) {
  let metadata = new Map(), refreshedAt = 0, inFlight;
  let status = { available: false, message: '等待只读会话索引' };
  return {
    collect: (extraAgent, includeTitles = false) => collectCatalog(ctx, extraAgent, metadata, includeTitles),
    status: () => ({ ...status }),
    async refresh() {
      if (inFlight) return inFlight;
      if (Date.now() - refreshedAt < 15000) return;
      inFlight = (async () => {
        try {
          const query = optionalService(ctx, 'sessionQuery');
          const cache = optionalService(ctx, 'sessionProjectionCache');
          if (typeof query?.listSessions !== 'function') { status = { available: false, message: '此宿主未提供只读会话索引，未加载会话可能只显示 ID' }; return; }
          const records = await query.listSessions(AbortSignal.timeout(3000));
          const next = new Map();
          for (const record of records) {
            const header = record.header;
            if (!header?.id || typeof header.id !== 'string') continue;
            let title = '';
            try {
              const value = cache?.cachedSnapshot(header, ['title'])?.values?.title;
              title = typeof value === 'string' ? value : value?.title || '';
            } catch {}
            const id = sessionKey(header.id);
            next.set(id, { id, nativeId: header.id, workspace: workspacePath(header.cwd || ''), parentId: sessionKey(header.parentSession), origin: header.origin || '', title: String(title).slice(0, 160), live: false, known: true });
          }
          metadata = next;
          status = { available: true, message: typeof cache?.cachedSnapshot === 'function' ? '' : '标题缓存不可用，部分会话只显示 ID' };
        } catch { status = { available: false, message: '只读会话索引暂不可用，保留上次元数据；覆盖归属以可确认的会话为准' }; }
        finally { refreshedAt = Date.now(); }
      })().finally(() => { inFlight = undefined; });
      return inFlight;
    },
  };
}
export function validateBindings(config, previous, catalog) {
  const directories = new Set(catalog.workspaces.filter(w => w.available).map(w => w.path));
  const oldDirectories = new Set(previous.bindings.workspaces.map(b => b.workspace));
  for (const binding of config.bindings.workspaces) {
    if (!directories.has(binding.workspace) && !oldDirectories.has(binding.workspace)) throw new Error('新绑定只能选择 DSH 已登记且存在的工作区');
  }
  const oldPrivateSessions = new Set(previous.roles.flatMap(role => privateSessionIds(role.privateChat)));
  for (const role of config.roles.filter(role => role.privateChat.enabled)) {
    for (const id of privateSessionIds(role.privateChat)) {
      const descriptor = catalog.lookup(id);
      if (!descriptor && !oldPrivateSessions.has(id)) throw new Error('专属私聊只能选择 DSH 已知会话');
      if (descriptor && resolveRole(config, descriptor, catalog.lookup).role?.id !== role.id) throw new Error('专属私聊所在工作区必须先绑定到当前角色，不能覆盖其他角色');
    }
  }
}
