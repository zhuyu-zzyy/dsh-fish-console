import path from 'node:path';
import { installedAdapters } from './adapters.js';
import { identityTargets } from './identity-targets.js';
import { identityAdapters } from './identity-adapters.js';
import { readEffectivePrivateRoutes } from './private-routing.js';

export function nativeRequester(webServer, signal) {
  return async (route, body) => {
    if (typeof webServer.getOrigin !== 'function') throw new Error('缺少本机接口地址');
    const origin = new URL(webServer.getOrigin());
    if (!['http:', 'https:'].includes(origin.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) || origin.username || origin.password) throw new Error('插件接口必须在本机');
    const response = await fetch(new URL(route, origin), {
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]), redirect: 'error',
    });
    if (!response.ok) throw new Error('插件设置接口不可用');
    const text = await response.text();
    if (text.length > 262144) throw new Error('插件设置响应过大');
    const value = JSON.parse(text);
    if (value.ok !== true) throw new Error('插件未确认请求');
    return value;
  };
}

// One reconciliation queue for all roles. Per-role background writers would
// fight over plugins' global fields; adapters receive the complete saved plan.
export function createIdentitySync({ ctx, home, getConfig, getCatalog, request, versions, implementations = identityAdapters }) {
  const controller = new AbortController(), invoke = request || nativeRequester(ctx.webServer, controller.signal);
  let disposed = false, tail = Promise.resolve(), queued = false, lastStarted = 0;
  let state = { state: 'pending', checkedAt: null, results: {} };
  async function run(restarts = 0) {
    if (disposed) return state;
    lastStarted = Date.now();
    const config = getConfig();
    if (!config) return state = { state: 'unavailable', checkedAt: new Date().toISOString(), results: {}, message: '控制台配置不可用，未同步插件设置' };
    const catalog = await getCatalog();
    if (disposed) return state;
    if (!catalog.registryAvailable || !catalog.agentsAvailable) return state = { state: 'unavailable', checkedAt: new Date().toISOString(), results: {}, message: '会话归属暂不可核对，未同步插件设置' };
    const installed = versions ? versions() : installedAdapters(home, process.env.DSH_PROFILE || 'desktop');
    const targets = identityTargets(config, catalog, await readEffectivePrivateRoutes(home, installed, invoke));
    if (!targets.active) return state = { state: 'unbound', checkedAt: new Date().toISOString(), results: {}, message: '尚未绑定角色，未同步插件设置' };
    const results = {};
    for (const [key, adapter] of Object.entries(implementations)) {
      if (disposed) return state;
      if (config !== getConfig()) {
        if (restarts < 2) return run(restarts + 1);
        return state = { state: 'attention', checkedAt: new Date().toISOString(), results, message: '控制台设置持续变化，等待下一轮按最新配置同步' };
      }
      if (!installed[key]?.compatible) {
        const version = installed[key];
        results[key] = { state: 'unsupported', message: version?.version
          ? `已安装版本 ${version.version} 尚未适配；已验证版本：${version.expected || '暂无'}，未修改设置`
          : '未安装或无法读取插件版本，未修改设置' };
        continue;
      }
      try { results[key] = await adapter({ home, backupDir: path.join(home, 'fish-console/backups'), targets, request: invoke, previous: state.results[key] }); }
      catch { results[key] = { state: 'failed', message: '同步未确认；接口不可用、配置格式变化或发生并发修改，可重试' }; }
    }
    if (!disposed && config !== getConfig() && restarts < 2) return run(restarts + 1);
    if (!disposed) state = { state: Object.values(results).every(r => ['synced', 'not_bound', 'not_configured'].includes(r.state)) ? 'complete' : 'attention', checkedAt: new Date().toISOString(), results };
    return state;
  }
  return {
    status: () => structuredClone(state),
    sync({ force = true } = {}) {
      if (disposed || (!force && Date.now() - lastStarted < 5000)) return Promise.resolve(state);
      if (!queued) {
        queued = true;
        tail = tail.catch(() => {}).then(async () => { queued = false; try { return await run(); } catch { return state = { state: 'unavailable', checkedAt: new Date().toISOString(), results: {}, message: '同步暂未确认，请重试' }; } });
      }
      return tail;
    },
    dispose() { disposed = true; controller.abort(); },
  };
}
