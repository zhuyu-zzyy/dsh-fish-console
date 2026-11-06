import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { installedAdapters } from './adapters.js';
import { cleanConfig, CONFIG_VERSION, defaultConfig, resolveRole, roleRevision } from './roles.js';
import { applyAssembly } from './policy.js';
import { sessionId, sessionKey } from './paths.js';
import { createCatalogReader, describeAgent, validateBindings } from './catalog.js';
import { createCoverage } from './coverage.js';
import { inspectIntegrations } from './integrations.js';
import { createIdentitySync, nativeRequester } from './identity-sync.js';
import { createPrivateRuntime } from './private-runtime.js';
import { inspectPrivateChannel, privateSessionConflict, qqBindings, readEffectivePrivateRoutes, readPrivateRoutes } from './private-routing.js';
import { connectPrivateChannel } from './private-connect.js';
import { readJson, updateJson } from './json-store.js';
import { createScreenService, screenRouteIssues } from './screen.js';
import { createScreenPermissionGuide } from './screen-permissions.js';
import { registerAvatar } from './avatar/host.js';

export const name = 'fish-console';
export const RUNTIME_VERSION = '0.15.1';
export const inject = ['agents', 'tools', 'systemPrompt', 'llm', 'webServer', 'workspaceRegistry'];
const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const directory = path.join(dshHome, 'fish-console');
const configFile = path.join(directory, 'config.json');
const fingerprint = config => createHash('sha256').update(JSON.stringify(config)).digest('hex');
function load() {
  try {
    const value = readJson(configFile, undefined);
    let config = value ? cleanConfig(value) : defaultConfig();
    const retired = value?.bindings?.sessions?.length || 0;
    if (value && value.version !== CONFIG_VERSION) {
      updateJson(configFile, current => { config = cleanConfig(current); return config; }, path.join(directory, 'backups'), 'console-config-upgrade');
    }
    return { config, bindingMigration: retired ? `已备份旧配置并移除 ${retired} 个会话单独绑定，角色现在统一按工作区绑定。请在“工作区绑定”中查看当前归属。` : undefined };
  }
  catch { return { config: defaultConfig(), error: '控制台配置读取失败，已暂停角色应用；请检查备份和原配置' }; }
}
function stale() { return Object.assign(new Error('设置已由其他页面更新，请刷新后再保存'), { httpStatus: 409 }); }
async function readBody(req) {
  let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 1048576) throw new Error('请求过大'); }
  return JSON.parse(body || '{}');
}
function localRequest(req) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(String(req.socket?.remoteAddress || ''))
    && /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(String(req.headers.host || ''));
}
function respond(res, code, value) { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); }
export function apply(ctx) {
  const initial = load(); let config = initial.config, configError = initial.error;
  const coverage = createCoverage(); let observationErrors = 0;
  const catalogs = createCatalogReader(ctx);
  const versionsNow = () => installedAdapters(dshHome, process.env.DSH_PROFILE || 'desktop');
  const routesNow = () => readPrivateRoutes(dshHome, versionsNow());
  const privateRequests = new AbortController();
  const screenPermissions = createScreenPermissionGuide();
  const screenResponse = value => ({ ...value, runtimeVersion: RUNTIME_VERSION, capabilities: { openPermissions: screenPermissions.supported } });
  const privateRequest = nativeRequester(ctx.webServer, privateRequests.signal);
  const getRouteIssues = async ids => {
    if (!ids.length) return [];
    const versions = versionsNow(), routes = readPrivateRoutes(dshHome, versions);
    if (versions.bili?.version) {
      try {
        const live = (await privateRequest('/api/bili-duty/config')).config;
        if (!live || typeof live !== 'object' || Array.isArray(live)) throw new Error('unknown config');
        routes.bili = { ...routes.bili, error: false, config: live };
      } catch { routes.bili = { ...routes.bili, error: true }; }
    }
    return screenRouteIssues(ids, routes);
  };
  const screen = createScreenService({ ctx, home: dshHome, getCatalog: () => catalogs.collect(), getRouteIssues,
    isConfigUnavailable: () => !!configError });
  ctx.effect(() => () => screen.dispose());
  const effectiveRoutes = () => readEffectivePrivateRoutes(dshHome, versionsNow(), privateRequest);
  const privateRuntime = createPrivateRuntime({ getConfig: () => configError ? null : config, getCatalog: agent => catalogs.collect(agent), getRoutes: routesNow, verifyRoutes: effectiveRoutes });
  ctx.on('agent/inbox/claimed', payload => { privateRuntime.claim(payload); screen.claim(payload); });
  ctx.effect(() => () => privateRequests.abort());
  let privateConnecting = false;
  const identitySync = createIdentitySync({ ctx, home: dshHome, getConfig: () => configError ? null : config, getCatalog: async () => { await catalogs.refresh(); return catalogs.collect(); } });
  ctx.effect(() => {
    const timer = setInterval(() => { void identitySync.sync({ force: false }); }, 30000);
    timer.unref?.();
    return () => { clearInterval(timer); identitySync.dispose(); };
  });
  const capabilities = {
    promptAssembly: typeof ctx.systemPrompt?.assemble === 'function',
    modelEntry: typeof ctx.llm?.stream === 'function',
    toolGuard: typeof ctx.tools?.guard === 'function',
    initiator: typeof ctx.agents?.currentInitiator === 'function',
  };
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const result = await next();
    if (!context?.agent || configError) return screen.filterAssembly(result, context?.agent);
    await catalogs.refresh();
    const catalog = catalogs.collect(context.agent);
    const descriptor = catalog.lookup(sessionId(context.agent)) || describeAgent(context.agent);
    const initialResolution = descriptor.ambiguous ? { status: 'unresolved' } : resolveRole(config, descriptor, catalog.lookup);
    await privateRuntime.verify(context.agent, initialResolution.role);
    if (configError) return result;
    const latestCatalog = catalogs.collect(context.agent);
    const latestDescriptor = latestCatalog.lookup(sessionId(context.agent)) || describeAgent(context.agent);
    const resolution = latestDescriptor.ambiguous ? { status: 'unresolved' } : resolveRole(config, latestDescriptor, latestCatalog.lookup);
    const personal = privateRuntime.current(context.agent, resolution.role);
    const applied = applyAssembly(result, resolution, personal);
    coverage.assembly(latestDescriptor, resolution);
    if (resolution.role) void identitySync.sync({ force: false });
    return screen.filterAssembly(applied, context.agent);
  });
  // The Bili sender may default to its live dmUid, which can change without a
  // disk write. Recheck the route just before the synchronous tool guard runs.
  ctx.on('tools/pre-execute', async (exec, next) => {
    const decision = await next();
    if (exec.name === 'bili_send_message' && exec.agent && !configError) {
      const catalog = catalogs.collect(exec.agent), descriptor = catalog.lookup(sessionId(exec.agent)) || describeAgent(exec.agent);
      await privateRuntime.verify(exec.agent, resolveRole(config, descriptor, catalog.lookup).role);
    }
    return decision;
  });
  if (capabilities.toolGuard) ctx.tools.guard(exec => {
    if (configError) return undefined;
    const catalog = catalogs.collect(exec.agent), descriptor = catalog.lookup(sessionId(exec.agent)) || describeAgent(exec.agent);
    return privateRuntime.denyTool(exec, resolveRole(config, descriptor, catalog.lookup).role);
  });
  // Observation only: preserve both the frozen request object and next's stream.
  if (capabilities.modelEntry) ctx.on('llm/stream', (options, next) => {
    try {
      let initiator; try { initiator = ctx.agents.currentInitiator?.(); } catch {}
      const catalog = catalogs.collect();
      let personal;
      if (options.sessionId && Object.hasOwn(options, 'toolHistory')) {
        const agent = ctx.agents.list().find(agent => sessionId(agent) === sessionKey(options.sessionId));
        const descriptor = catalog.lookup(options.sessionId);
        if (agent && descriptor) personal = privateRuntime.current(agent, resolveRole(config, descriptor, catalog.lookup).role);
      }
      coverage.observe(options, config, catalog, initiator, personal);
    } catch { observationErrors++; }
    return next();
  });
  const snapshot = async (activeConfig = config) => {
    await catalogs.refresh();
    const catalog = catalogs.collect(undefined, true);
    const observations = coverage.snapshot(activeConfig, catalog);
    const sessions = catalog.sessions.map(session => {
      const resolved = session.ambiguous ? { status: 'unresolved' } : resolveRole(activeConfig, session, catalog.lookup);
      const last = [...observations.records].reverse().find(r => r.sessionId === session.id && ['conversation', 'subagent'].includes(r.category));
      return { ...session, roleId: resolved.role?.id || null, source: resolved.source || null, roleStatus: resolved.status, revision: resolved.role ? roleRevision(resolved.role) : null, lastRequest: last || null, assemblyAttempt: observations.attempts.find(a => a.sessionId === session.id) || null };
    });
    const versions = installedAdapters(dshHome, process.env.DSH_PROFILE || 'desktop');
    const privateRoutes = await effectiveRoutes();
    const privateChat = activeConfig.roles.map(role => ({ roleId: role.id, enabled: role.privateChat.enabled,
      local: role.privateChat.localSessions.map(id => ({ sessionId: id, conflict: privateSessionConflict(role, id, privateRoutes) })),
      bili: inspectPrivateChannel(role, 'bili', privateRoutes), qq: inspectPrivateChannel(role, 'qq', privateRoutes) }));
    return { coverage: { ...observations, observationErrors }, sessions, workspaces: catalog.workspaces, catalog: { registryAvailable: catalog.registryAvailable, agentsAvailable: catalog.agentsAvailable, metadata: catalogs.status() }, capabilities, integrations: inspectIntegrations(dshHome, versions, activeConfig, catalog), identitySync: identitySync.status(), privateChat };
  };
  const route = (pathname, handler) => ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: pathname, handler: async (req, res) => {
    try {
      if (!localRequest(req)) return respond(res, 403, { ok: false, error: '仅允许本机访问' });
      if (!['GET', 'POST'].includes(req.method)) return respond(res, 405, { ok: false, error: '不支持此方法' });
      if (req.method === 'POST') {
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return respond(res, 403, { ok: false, error: '来源不匹配' });
        if (String(req.headers['content-type'] || '').split(';')[0].trim() !== 'application/json') return respond(res, 415, { ok: false, error: '需要 JSON 请求' });
      }
      return await handler(req, res);
    } catch (error) { return respond(res, error.httpStatus || 400, { ok: false, error: error.message || '请求失败',
      ...(Array.isArray(error.screenIssues) ? { screenIssues: error.screenIssues } : {}) }); }
  }}));
  registerAvatar(ctx, route, readBody, respond, directory);
  route('/fish-console/screen', async (req, res) => {
    if (req.method !== 'GET') return respond(res, 405, { ok: false, error: '请使用 GET 读取屏幕设置' });
    const state = screen.snapshot();
    return respond(res, 200, { ok: true, ...screenResponse(state), screenIssues: await getRouteIssues(state.config.sessions) });
  });
  route('/fish-console/screen/config', async (req, res) => {
    if (req.method !== 'POST') return respond(res, 405, { ok: false, error: '保存屏幕设置需要 POST' });
    const body = await readBody(req); await catalogs.refresh();
    return respond(res, 200, { ok: true, ...screenResponse(await screen.save(body.config, body.baseRevision)) });
  });
  route('/fish-console/screen/capture', async (req, res) => {
    if (req.method !== 'POST') return respond(res, 405, { ok: false, error: '截图需要 POST' });
    const body = await readBody(req);
    if (body.baseRevision !== screen.snapshot().baseRevision) throw stale();
    return respond(res, 200, { ok: true, ...screenResponse(await screen.capturePreview(body.baseRevision)) });
  });
  route('/fish-console/screen/pause', async (req, res) => {
    if (req.method !== 'POST') return respond(res, 405, { ok: false, error: '暂停屏幕感知需要 POST' });
    return respond(res, 200, { ok: true, ...screenResponse(screen.pause()) });
  });
  route('/fish-console/screen/preview', async (req, res) => {
    if (req.method !== 'GET') return respond(res, 405, { ok: false, error: '请使用 GET 读取本机预览' });
    return respond(res, 200, { ok: true, preview: screen.preview() });
  });
  route('/fish-console/screen/open-permissions', async (req, res) => {
    if (req.method !== 'POST') return respond(res, 405, { ok: false, error: '打开屏幕录制设置需要 POST' });
    return respond(res, 200, { ok: true, ...await screenPermissions.open({ signal: privateRequests.signal }) });
  });
  route('/fish-console/config', async (req, res) => {
    if (req.method === 'GET') {
      const current = config;
      const routes = await effectiveRoutes();
      let qqSuggestions = [];
      try { qqSuggestions = qqBindings(routes.qq.config).filter(row => row.类型 === '私聊').map(row => ({ number: String(row.号码), sessionId: sessionKey(row.会话) })); } catch {}
      return respond(res, 200, { ok: true, protocolVersion: CONFIG_VERSION, config: current, baseRevision: fingerprint(current), configError, bindingMigration: initial.bindingMigration, privateSuggestions: { bili: routes.bili.compatible && routes.bili.config ? { uid: String(routes.bili.config.dmUid || ''), sessionId: sessionKey(routes.bili.config.targetSession) } : null, qq: routes.qq.compatible ? qqSuggestions : [] }, ...await snapshot(current) });
    }
    const body = await readBody(req);
    if (privateConnecting) return respond(res, 409, { ok: false, error: '私信连接正在处理，请完成后再保存控制台设置' });
    if (body.config?.version !== CONFIG_VERSION) return respond(res, 409, { ok: false, error: '控制台接口已升级，请刷新页面后再保存' });
    if (body.baseRevision !== fingerprint(config)) throw stale();
    const next = cleanConfig(body.config);
    await catalogs.refresh();
    validateBindings(next, config, catalogs.collect());
    updateJson(configFile, current => {
      const disk = Object.keys(current).length ? cleanConfig(current) : defaultConfig();
      if (fingerprint(disk) !== body.baseRevision) throw stale();
      return next;
    }, path.join(directory, 'backups'), 'console-config');
    config = next; configError = undefined;
    await identitySync.sync();
    return respond(res, 200, { ok: true, config: next, baseRevision: fingerprint(next), ...await snapshot(next) });
  });
  route('/fish-console/coverage', async (req, res) => {
    if (req.method !== 'GET') return respond(res, 405, { ok: false, error: '覆盖检查只读，请使用 GET' });
    return respond(res, 200, { ok: true, ...await snapshot() });
  });
  route('/fish-console/sync', async (req, res) => {
    if (req.method !== 'POST') return respond(res, 405, { ok: false, error: '名称同步需要 POST' });
    const body = await readBody(req);
    if (body.baseRevision !== fingerprint(config)) throw stale();
    if (configError) throw new Error('请先修复控制台配置后再同步');
    await identitySync.sync();
    return respond(res, 200, { ok: true, ...await snapshot() });
  });
  route('/fish-console/private-connect', async (req, res) => {
    if (req.method !== 'POST') return respond(res, 405, { ok: false, error: '连接私信需要 POST' });
    const body = await readBody(req);
    if (body.baseRevision !== fingerprint(config)) throw stale();
    if (configError || privateConnecting) throw new Error('配置不可用或已有连接正在处理，请稍后重试');
    const current = config, role = current.roles.find(role => role.id === body.roleId);
    if (!role) throw new Error('角色不存在');
    privateConnecting = true;
    try {
      await catalogs.refresh();
      const connection = await connectPrivateChannel({ channel: body.channel, role, config: current, catalog: catalogs.collect(), routes: await effectiveRoutes(), home: dshHome, request: privateRequest, isCurrent: () => current === config && !configError });
      await identitySync.sync();
      return respond(res, 200, { ok: true, connection, ...await snapshot() });
    } finally { privateConnecting = false; }
  });
}
