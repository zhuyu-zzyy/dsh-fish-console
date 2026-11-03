import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { createCatalogReader } from '../lib/catalog.js';

test('真实 Cordis 插件内可选查询接口无需声明强依赖，冷会话标题可读取', { skip: !process.env.FISH_CONSOLE_DSH_MODULES }, async () => {
  const { Context } = await import(pathToFileURL(path.join(process.env.FISH_CONSOLE_DSH_MODULES, '@deepseek-ai/cordis/lib/index.js')).href);
  const ctx = new Context();
  ctx.provide('agents', { list: () => [] });
  ctx.provide('workspaceRegistry', { list: () => [{ path: os.tmpdir(), sessionIds: ['cold'] }] });
  let provider;
  await new Promise(resolve => {
    provider = ctx.plugin({ name: 'metadata-services-test', apply(child) {
      child.provide('sessionQuery', { listSessions: async () => [{ header: { id: 'cold', cwd: os.tmpdir() } }] });
      child.provide('sessionProjectionCache', { cachedSnapshot: () => ({ values: { title: '已缓存的冷会话标题' } }) });
      resolve();
    } });
  });
  let fiber;
  const reader = await new Promise((resolve, reject) => {
    fiber = ctx.plugin({ name: 'catalog-compatibility-test', inject: ['agents', 'workspaceRegistry'], apply(child) {
      try { assert.throws(() => child.sessionQuery, /without inject/); resolve(createCatalogReader(child)); }
      catch (error) { reject(error); }
    } });
  });
  try {
    await reader.refresh(); assert.equal(reader.status().available, true);
    assert.equal(reader.collect().lookup('cold').title, '已缓存的冷会话标题');
  } finally { await fiber.dispose(); await provider.dispose(); }
});

test('真实 DSH 组装器、工具运行时、LLM 入口：覆盖证据、complete 覆盖与只读观察', { skip: !process.env.FISH_CONSOLE_DSH_MODULES }, async () => {
  const load = name => import(pathToFileURL(path.join(process.env.FISH_CONSOLE_DSH_MODULES, '@deepseek-ai', name, 'lib/index.js')).href);
  const { Context } = await load('cordis'), { SystemPrompt, renderPrompt } = await load('dsh-system-prompt');
  const { ToolRuntime, defineTool } = await load('dsh-tools'), { LlmRuntime } = await load('dsh-llm');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-console-real-dsh-')); process.env.DSH_HOME = home;
  try {
    const workspace = fs.realpathSync(home); fs.mkdirSync(path.join(home, 'fish-console'));
    fs.writeFileSync(path.join(home, 'fish-console/config.json'), JSON.stringify({ version: 3, workspace, selfName: '真实运行时测试鱼', ownerName: '管理员', persona: '测试人格', disabledTools: ['bili_search'] }));
    const ctx = new Context(), prompt = new SystemPrompt(ctx, {}), tools = new ToolRuntime(ctx, {}), llm = new LlmRuntime(ctx);
    const inside = { id: 'inside', session: { id: 'inside', header: { cwd: workspace } } }, outside = { id: 'outside', session: { id: 'outside', header: { cwd: path.dirname(workspace) } } };
    const routes = new Map();
    const facade = { on: ctx.on.bind(ctx), tools, systemPrompt: prompt, llm, effect: fn => fn(), agents: { list: () => [inside, outside], currentInitiator: () => inside },
      workspaceRegistry: { list: () => [{ path: workspace, sessionIds: ['inside'] }] }, webServer: { register: route => { routes.set(route.path, route.handler); return () => {}; } } };
    const { apply } = await import('../lib/host.js'); apply(facade);
    prompt.context({ name: 'memory', order: 900, text: '保留记忆' }); prompt.context({ name: 'feiyu-mood', order: 901, text: '保留心情' });
    let called = 0;
    tools.register(defineTool({ name: 'bili_search', description: '无网络测试', parameters: {}, output: { schema: { type: 'string' }, render: (_a, value) => [{ type: 'text', text: value }] }, execute: async () => { called++; return 'ok'; } }));
    const assembly = await prompt.assemble({ agent: inside, scope: inside });
    assert.ok(renderPrompt(assembly).includes('真实运行时测试鱼')); assert.equal(assembly.contexts.length, 2); assert.equal(assembly.tools.length, 0);
    const other = await prompt.assemble({ agent: outside, scope: outside }); assert.ok(!renderPrompt(other).includes('真实运行时测试鱼')); assert.equal(other.tools.length, 1);
    const denied = await tools.execute({ name: 'bili_search', callId: '1', agent: inside, arguments: {}, signal: new AbortController().signal }); assert.equal(denied.isError, true); assert.equal(called, 0);
    async function enter(system) {
      const request = Object.freeze({ provider: 'no-provider-no-network', model: 'test', sessionId: 'inside', toolHistory: [], messages: Object.freeze([{ role: 'system', content: [{ type: 'text', text: system }] }]), signal: new AbortController().signal });
      const before = request.messages;
      for await (const chunk of llm.stream(request)) assert.equal(chunk.type, 'finish');
      assert.equal(request.messages, before); assert.ok(Object.isFrozen(request));
    }
    await enter(renderPrompt(assembly));
    prompt.section({ name: 'test-complete', complete: true, order: 1, text: '完整预设覆盖所有普通人设段' });
    const complete = await prompt.assemble({ agent: inside, scope: inside }); assert.equal(renderPrompt(complete), '完整预设覆盖所有普通人设段');
    await enter(renderPrompt(complete));
    const req = Readable.from([]); req.method = 'GET'; req.headers = { host: 'localhost:1' }; req.socket = { remoteAddress: '127.0.0.1' }; let response;
    await routes.get('/fish-console/coverage')(req, { writeHead: () => {}, end: text => { response = JSON.parse(text); } });
    assert.deepEqual(response.coverage.records.map(r => r.status), ['covered', 'uncovered']); assert.equal(response.coverage.observationErrors, 0);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
