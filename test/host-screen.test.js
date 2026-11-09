import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { defaultConfig } from '../lib/roles.js';

test('屏幕 HTTP 设置独立保存，默认禁用，限制本机、来源、方法并保护 CAS', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-console-host-screen-'));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  const disposers = [], routes = new Map(), definitions = new Map();
  try {
    fs.mkdirSync(path.join(home, 'fish-console'));
    const roleFile = path.join(home, 'fish-console/config.json');
    const original = Buffer.from(JSON.stringify(defaultConfig(), null, 2) + '\n');
    fs.writeFileSync(roleFile, original);
    const agent = { id: 'local', session: { id: 'local', header: { cwd: home } } };
    const ctx = {
      on: () => () => {},
      effect: fn => { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose); return dispose; },
      tools: {
        schemas: () => [...definitions.values()], guard: () => () => {},
        register: definition => { definitions.set(definition.name, definition); return () => definitions.delete(definition.name); },
      },
      agents: { list: () => [agent] }, systemPrompt: { assemble() {} }, llm: { stream() {} },
      get: name => name === 'llm' ? { resolveModelInfo: async () => { throw new Error('HTTP 设置测试不得调用模型'); } }
        : name === 'attachments' ? { saveImage: async () => { throw new Error('HTTP 设置测试不得保存图片'); } } : undefined,
      workspaceRegistry: { list: () => [{ path: home, sessionIds: ['local'] }] },
      webServer: { register: route => { routes.set(route.path, route.handler); return () => routes.delete(route.path); } },
    };
    const { apply } = await import('../lib/host.js?screen-route-test');
    apply(ctx);
    async function request(pathname, { method = 'GET', body, remoteAddress = '127.0.0.1', headers = {} } = {}) {
      const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
      req.url = pathname; req.method = method; req.socket = { remoteAddress };
      req.headers = { host: 'localhost:1', origin: 'http://localhost:1', 'content-type': 'application/json', ...headers };
      let code, value, responseHeaders;
      await routes.get(pathname)(req, { writeHead: (status, fields) => { code = status; responseHeaders = fields; }, end: text => { value = JSON.parse(text); } });
      return { code, value, headers: responseHeaders };
    }
    const initial = await request('/fish-console/screen');
    assert.equal(initial.code, 200); assert.equal(initial.value.protocolVersion, 1);
    assert.equal(initial.value.runtimeVersion, '0.15.2');
    assert.deepEqual(initial.value.screenIssues, []);
    assert.equal(initial.value.capabilities.openPermissions, process.platform === 'darwin');
    assert.deepEqual(initial.value.config, { version: 1, enabled: false, sessions: [] });
    assert.equal(initial.headers['cache-control'], 'no-store');
    assert.equal((await request('/fish-console/screen/preview')).value.preview, null);
    const post = (pathname, body, options = {}) => request(pathname, { method: 'POST', body, ...options });
    assert.equal((await post('/fish-console/screen/capture', { baseRevision: initial.value.baseRevision })).code, 400, '默认禁用时不得执行截图');

    for (const pathname of ['/fish-console/screen', '/fish-console/screen/config', '/fish-console/screen/capture', '/fish-console/screen/pause', '/fish-console/screen/preview', '/fish-console/screen/open-permissions']) {
      assert.equal((await request(pathname, { remoteAddress: '192.0.2.1' })).code, 403);
      assert.equal((await request(pathname, { headers: { host: 'attacker.invalid' } })).code, 403);
      assert.equal((await request(pathname, { method: 'DELETE' })).code, 405);
    }
    for (const pathname of ['/fish-console/screen/config', '/fish-console/screen/capture', '/fish-console/screen/pause', '/fish-console/screen/open-permissions']) {
      assert.equal((await request(pathname)).code, 405);
      assert.equal((await post(pathname, {}, { headers: { origin: 'https://attacker.invalid' } })).code, 403);
      assert.equal((await post(pathname, {}, { headers: { 'content-type': 'text/plain' } })).code, 415);
    }
    assert.equal((await post('/fish-console/screen', {})).code, 405);
    assert.equal((await post('/fish-console/screen/preview', {})).code, 405);

    const config = { version: 1, enabled: true, sessions: ['local'] };
    const saved = await post('/fish-console/screen/config', { config, baseRevision: initial.value.baseRevision });
    assert.equal(saved.code, 200); assert.deepEqual(saved.value.config, config);
    assert.equal(saved.value.runtimeVersion, initial.value.runtimeVersion);
    assert.deepEqual(saved.value.capabilities, initial.value.capabilities);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'fish-console/screen.json'), 'utf8')), config);
    assert.deepEqual(fs.readFileSync(roleFile), original, '屏幕设置不得改动角色配置字节');
    assert.equal((await post('/fish-console/screen/config', { config, baseRevision: initial.value.baseRevision })).code, 409);
    assert.equal((await post('/fish-console/screen/capture', { baseRevision: initial.value.baseRevision })).code, 409);

    const paused = await post('/fish-console/screen/pause', {});
    assert.equal(paused.code, 200); assert.equal(paused.value.config.enabled, false);
    assert.equal(paused.value.runtimeVersion, initial.value.runtimeVersion);
    assert.deepEqual(paused.value.config.sessions, ['local'], '紧急暂停保留明确授权列表');
    assert.equal((await post('/fish-console/screen/capture', { baseRevision: paused.value.baseRevision })).code, 400);
    assert.equal((await request('/fish-console/screen/preview')).value.preview, null);
    assert.deepEqual(fs.readFileSync(roleFile), original);
    const biliDir = path.join(home, 'bili-duty');
    fs.mkdirSync(biliDir);
    const biliFile = path.join(biliDir, 'config.json');
    fs.writeFileSync(biliFile, JSON.stringify({ targetSession: 'session-local' }));
    const overlapping = (await request('/fish-console/screen')).value;
    assert.deepEqual(overlapping.screenIssues.map(item => [item.kind, item.sessionId]), [['bili-target', 'local']]);
    const retry = () => post('/fish-console/screen/config', { config, baseRevision: overlapping.baseRevision });
    const denied = await retry();
    assert.equal(denied.code, 400);
    assert.deepEqual(denied.value.screenIssues, overlapping.screenIssues);
    assert.equal(JSON.parse(fs.readFileSync(biliFile)).targetSession, 'session-local');
    fs.writeFileSync(biliFile, JSON.stringify({ targetSession: 'session-other' }));
    const successful = await retry();
    assert.equal(successful.code, 200);
    assert.deepEqual(successful.value.config, config);
  } finally {
    for (const dispose of disposers.reverse()) dispose();
    if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
