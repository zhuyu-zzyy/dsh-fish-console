import path from 'node:path';
import { installedAdapters } from './adapters.js';
import { workspaceSessions } from './identity.js';
import { identityAdapters } from './identity-adapters.js';

export function nativeRequester(webServer, signal) {
  return async (route, body) => {
    if (typeof webServer.getOrigin !== 'function') throw new Error('DSH 未提供插件配置接口地址');
    const response = await fetch(new URL(route, webServer.getOrigin()), {
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]), redirect: 'error',
    });
    if (!response.ok) throw new Error(`插件接口暂不可用（HTTP ${response.status}）`);
    const text = await response.text();
    if (text.length > 262144) throw new Error('插件配置响应过大');
    const value = JSON.parse(text);
    if (value.ok !== true) throw new Error('插件未确认配置请求');
    return value;
  };
}

// Each adapter owns one plugin's compatibility rules. Runs are serialized and
// read the latest console configuration when their turn starts, including retries.
export function createIdentitySync({ ctx, home, getConfig, request, implementations = identityAdapters, versions }) {
  const controller = new AbortController();
  const invoke = request || nativeRequester(ctx.webServer, controller.signal);
  let tail = Promise.resolve();
  let snapshot = { state: 'pending', checkedAt: null, results: {} };
  let disposed = false;
  let queued = false;
  let extraAgents = [];
  async function run() {
    if (disposed) return snapshot;
    const config = getConfig();
    const candidates = extraAgents; extraAgents = [];
    if (!config.workspace) return snapshot = { state: 'unbound', checkedAt: new Date().toISOString(), results: {} };
    let sessions;
    try {
      sessions = workspaceSessions(ctx, config.workspace);
      for (const agent of candidates) {
        const additional = workspaceSessions(ctx, config.workspace, agent);
        sessions = { ids: [...new Set([...sessions.ids, ...additional.ids])], keys: new Set([...sessions.keys, ...additional.keys]) };
      }
    } catch {
      return snapshot = { state: 'unavailable', checkedAt: new Date().toISOString(), results: {}, message: '暂时无法确认工作区会话归属，未更新其他插件' };
    }
    const installed = versions ? versions() : installedAdapters(home, process.env.DSH_PROFILE || 'desktop');
    const entries = await Promise.all(Object.entries(implementations).map(async ([key, adapter]) => {
      const version = installed[key];
      if (!version?.compatible) return [key, { state: 'unsupported', message: version?.version ? `此版本尚未适配（${version.version}），未修改插件设置` : '未找到对应插件安装，暂未同步' }];
      try {
        const result = await adapter({ ctx, home, config, sessions, backupDir: path.join(home, 'fish-console', 'backups'), request: invoke });
        return [key, result];
      } catch {
        // Do not surface raw third-party errors, which can include configuration.
        return [key, { state: 'failed', message: '同步未完成；插件可能未启用、接口不可用或配置正在修改，将自动重试' }];
      }
    }));
    if (disposed) return snapshot;
    const results = Object.fromEntries(entries);
    const complete = entries.every(([, value]) => ['synced', 'aligned', 'not_bound', 'not_configured'].includes(value.state));
    snapshot = { state: complete ? 'complete' : 'attention', checkedAt: new Date().toISOString(), results };
    return snapshot;
  }
  return {
    status: () => structuredClone(snapshot),
    sync(extraAgent) {
      if (disposed) return Promise.resolve(snapshot);
      if (extraAgent) extraAgents.push(extraAgent);
      if (!queued) {
        queued = true;
        tail = tail.catch(() => {}).then(async () => { queued = false; return run(); });
      }
      return tail;
    },
    dispose() { disposed = true; extraAgents = []; controller.abort(); },
  };
}
