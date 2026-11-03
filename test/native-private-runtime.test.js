import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { defaultConfig } from '../lib/roles.js';

test('真实 DSH AgentLoop 在领取输入后注入专属规则；模型入口只读确认且没有网络 provider', { skip: !process.env.FISH_CONSOLE_DSH_MODULES, timeout: 10000 }, async () => {
  const load = name => import(pathToFileURL(path.join(process.env.FISH_CONSOLE_DSH_MODULES, '@deepseek-ai', name, 'lib/index.js')).href);
  const [{ Context }, { AgentRegistry }, { SessionStore }, { SessionProjectionRegistry }, { AgentLoop }, { SystemPrompt }, { ToolRuntime }, { LlmRuntime }] = await Promise.all(['cordis', 'dsh-agent', 'dsh-session', 'dsh-session-projection', 'dsh-agent-loop', 'dsh-system-prompt', 'dsh-tools', 'dsh-llm'].map(load));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-console-native-private-')); process.env.DSH_HOME = home;
  const ctx = new Context();
  try {
    const workspace = fs.realpathSync(home), config = defaultConfig();
    config.bindings.sessions = [{ sessionId: 'native-private', roleId: 'role-default' }];
    config.roles[0].privateChat = { ...config.roles[0].privateChat, enabled: true, ownerName: '私聊测试称呼', persona: 'PRIVATE-NATIVE-RULE', localSessions: ['native-private'] };
    fs.mkdirSync(path.join(home, 'fish-console')); fs.writeFileSync(path.join(home, 'fish-console/config.json'), JSON.stringify(config));
    const agents = new AgentRegistry(ctx), sessions = new SessionStore(ctx), projections = new SessionProjectionRegistry(ctx);
    const prompt = new SystemPrompt(ctx, {}), tools = new ToolRuntime(ctx, {}), llm = new LlmRuntime(ctx);
    const loop = new AgentLoop(ctx, { agents: [], maxParallelToolCalls: 1 });
    const routes = new Map();
    const facade = { on: ctx.on.bind(ctx), effect: fn => ctx.effect(fn), agents, tools, llm, systemPrompt: prompt,
      workspaceRegistry: { list: () => [{ path: workspace, sessionIds: ['native-private'] }] }, webServer: { register: route => { routes.set(route.path, route.handler); return () => routes.delete(route.path); } } };
    const { apply } = await import('../lib/host.js'); apply(facade);
    const agent = await loop.create('native-private', { provider: 'no-provider-no-network', model: 'test' }, { cwd: workspace });
    agent.followup({ id: 'test-input', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '隔离测试，不发送到外部' }] });
    await agent.whenIdle();
    const req = Readable.from([]); req.method = 'GET'; req.headers = { host: 'localhost:1' }; req.socket = { remoteAddress: '127.0.0.1' }; let response;
    await routes.get('/fish-console/coverage')(req, { writeHead: () => {}, end: text => { response = JSON.parse(text); } });
    assert.equal(response.coverage.records.length, 1);
    assert.equal(response.coverage.records[0].privateInput.status, 'covered'); assert.equal(response.coverage.records[0].status, 'covered');
    assert.ok(!JSON.stringify(response.coverage).includes('PRIVATE-NATIVE-RULE')); assert.equal(response.coverage.observationErrors, 0);
    assert.equal(llm.listProviders().length, 0);
    assert.ok(sessions); assert.ok(projections);
  } finally { await ctx.fiber.dispose(); fs.rmSync(home, { recursive: true, force: true }); }
});
