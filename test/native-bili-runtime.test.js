import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { defaultConfig } from '../lib/roles.js';

test('真实 DSH AgentLoop 使用 B站 0.8.8 生效路由注入私聊规则，无外部模型与私信', { skip: !process.env.FISH_CONSOLE_DSH_MODULES, timeout: 10000 }, async () => {
  const load = name => import(pathToFileURL(path.join(process.env.FISH_CONSOLE_DSH_MODULES, '@deepseek-ai', name, 'lib/index.js')).href);
  const [{ Context }, { AgentRegistry }, { SessionStore }, { SessionProjectionRegistry }, { AgentLoop }, { SystemPrompt }, { ToolRuntime }, { LlmRuntime }] = await Promise.all(['cordis', 'dsh-agent', 'dsh-session', 'dsh-session-projection', 'dsh-agent-loop', 'dsh-system-prompt', 'dsh-tools', 'dsh-llm'].map(load));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-console-native-bili-loop-')); process.env.DSH_HOME = home;
  const ctx = new Context();
  const originalFetch = globalThis.fetch;
  try {
    const workspace = fs.realpathSync(home), config = defaultConfig();
    config.roles[0].ownerName = '通用称呼';
    config.roles[0].privateChat = { ...config.roles[0].privateChat, enabled: true, ownerName: '专属称呼', persona: 'PRIVATE-BILI-NATIVE', bili: { uid: '555888999', sessionId: 'native-private' } };
    config.bindings.sessions = [{ sessionId: 'native-private', roleId: 'role-default' }];
    fs.mkdirSync(path.join(home, 'fish-console')); fs.writeFileSync(path.join(home, 'fish-console/config.json'), JSON.stringify(config));
    fs.mkdirSync(path.join(home, 'bili-duty')); fs.writeFileSync(path.join(home, 'bili-duty/config.json'), JSON.stringify({ dmUid: 111222333, targetSession: 'session-stale' }));
    const plugin = path.join(home, 'profiles/desktop/node_modules/dsh-bili-subagent'); fs.mkdirSync(plugin, { recursive: true });
    fs.writeFileSync(path.join(plugin, 'package.json'), JSON.stringify({ name: 'dsh-bili-subagent', version: '0.8.8' }));
    const live = { dmUid: 555888999, targetSession: 'native-private', dmMode: 'only', autoMode: 'manual', watchOn: true, watchAt: false, watchDm: true, inboxOn: true, inboxUids: '', ownerName: '通用称呼' };
    globalThis.fetch = async (url, options) => {
      assert.equal(String(url), 'http://127.0.0.1:7319/api/bili-duty/config'); assert.equal(options.method, 'GET');
      return new Response(JSON.stringify({ ok: true, config: live }), { headers: { 'content-type': 'application/json' } });
    };
    const agents = new AgentRegistry(ctx), sessions = new SessionStore(ctx), projections = new SessionProjectionRegistry(ctx);
    const prompt = new SystemPrompt(ctx, {}), tools = new ToolRuntime(ctx, {}), llm = new LlmRuntime(ctx), loop = new AgentLoop(ctx, { agents: [], maxParallelToolCalls: 1 });
    const routes = new Map(), origin = 'http://127.0.0.1:7319';
    const facade = { on: ctx.on.bind(ctx), effect: fn => ctx.effect(fn), agents, tools, llm, systemPrompt: prompt,
      workspaceRegistry: { list: () => [{ path: workspace, sessionIds: ['native-private'] }] }, webServer: { getOrigin: () => origin, register: route => { routes.set(route.path, route.handler); return () => routes.delete(route.path); } } };
    const { apply } = await import('../lib/host.js'); apply(facade);
    const agent = await loop.create('native-private', { provider: 'no-provider-no-network', model: 'test' }, { cwd: workspace });
    agent.followup({ id: 'test-bili-input', role: 'user', source: { kind: 'bili-duty-scan' }, content: [{ type: 'text', text: '⚠️ 这一轮只是通用称呼在 **B站 私信**里跟你说了一句话（没带视频）：测试，不发送到外部' }] });
    await agent.whenIdle();
    const req = Readable.from([]); req.method = 'GET'; req.headers = { host: 'localhost:1' }; req.socket = { remoteAddress: '127.0.0.1' }; let response;
    await routes.get('/fish-console/coverage')(req, { writeHead: () => {}, end: text => { response = JSON.parse(text); } });
    assert.equal(response.coverage.records[0].privateInput.status, 'covered');
    assert.equal(response.coverage.records[0].privateInput.channel, 'bili');
    assert.ok(!JSON.stringify(response.coverage).includes('PRIVATE-BILI-NATIVE'));
    assert.equal(llm.listProviders().length, 0); assert.ok(sessions); assert.ok(projections);
  } finally {
    await ctx.fiber.dispose();
    globalThis.fetch = originalFetch;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
