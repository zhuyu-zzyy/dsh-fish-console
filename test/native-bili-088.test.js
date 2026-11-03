import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { defaultConfig } from '../lib/roles.js';
import { readEffectivePrivateRoutes, identifyPrivateInput } from '../lib/private-routing.js';
import { connectPrivateChannel } from '../lib/private-connect.js';

test('真实 B站 0.8.8 设置接口：热配置优先、私聊连接可回读，且不调用发信', { skip: !process.env.FISH_CONSOLE_BILI_ROOT, timeout: 10000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-console-native-bili-'));
  const oldHome = process.env.DSH_HOME, oldModules = process.env.DSH_HOST_MODULES, cleanups = [];
  process.env.DSH_HOME = home;
  if (process.env.FISH_CONSOLE_DSH_MODULES) process.env.DSH_HOST_MODULES = path.join(process.env.FISH_CONSOLE_DSH_MODULES, '@deepseek-ai');
  try {
    fs.mkdirSync(path.join(home, 'bili-duty'));
    fs.writeFileSync(path.join(home, 'bili-duty/config.json'), JSON.stringify({ dmUid: 111222333, targetSession: 'session-stale', autoMode: 'manual', dmMode: 'only', ownerName: '通用称呼', watchOn: false, watchAt: false }));
    const hot = { perDay: 2, mentionName: '', autoComment: false, dmUid: 555888999, targetSession: 'session-a', autoMode: 'manual', dmMode: 'only', ownerName: '通用称呼', watchOn: true, watchDm: true, watchAt: false, inboxOn: true, inboxUids: '', dynamicOn: false, dynamicAutoOn: false };
    const row = { ns: 'bili-scroll', revision: 'test', value: { ...hot }, user: { ...hot } };
    const routes = new Map(), tools = [];
    const ctx = { tools: { register: spec => { tools.push(spec.name); return () => {}; } },
      agents: { list: () => [] }, subagents: {}, llm: {},
      settings: { describe: () => [row], update: async (_ns, patch) => { Object.assign(hot, patch); Object.assign(row.value, patch); Object.assign(row.user, patch); } },
      effect: fn => { const off = fn(); if (typeof off === 'function') cleanups.push(off); return off; },
      webServer: { register: route => { routes.set(route.path, route.handler); return () => routes.delete(route.path); } } };
    const { apply } = await import(pathToFileURL(path.join(process.env.FISH_CONSOLE_BILI_ROOT, 'index.js')).href);
    apply(ctx, hot);
    const calls = [];
    const request = async (route, body) => {
      assert.equal(route, '/api/bili-duty/config'); calls.push(body ? 'POST' : 'GET');
      const req = Readable.from(body ? [JSON.stringify(body)] : []); req.method = body ? 'POST' : 'GET'; req.url = route;
      let code, value; await routes.get('/api/bili-duty')(req, { writeHead: status => { code = status; }, end: text => { value = JSON.parse(text); } });
      assert.equal(code, 200); assert.equal(value.ok, true); return value;
    };
    const versions = { bili: { compatible: true, version: '0.8.8' }, qq: { compatible: true } };
    const effective = await readEffectivePrivateRoutes(home, versions, request);
    assert.equal(effective.bili.config.dmUid, 555888999);
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'bili-duty/config.json'))).dmUid, 111222333);
    const config = defaultConfig(), role = config.roles[0], descriptor = { id: 'a', nativeId: 'session-a', workspace: home };
    role.privateChat = { ...role.privateChat, enabled: true, bili: { uid: '555888999', sessionId: 'a' } };
    config.bindings.sessions = [{ sessionId: 'a', roleId: role.id }];
    const catalog = { lookup: id => ['a', 'session-a'].includes(id) ? descriptor : undefined };
    const message = { role: 'user', source: { kind: 'bili-duty-scan' }, content: '⚠️ 这一轮只是通用称呼在 **B站 私信**里跟你说了一句话（没带视频）：正文' };
    assert.deepEqual(identifyPrivateInput(role, descriptor, message, effective), { channel: 'bili' });
    await assert.rejects(connectPrivateChannel({ channel: 'bili', role, config, catalog, routes: effective, home, request }), /生效设置与保存设置不一致/);
    assert.equal(calls.filter(method => method === 'POST').length, 0);
    // Simulate the user reconciling the plugin's own saved and active settings.
    fs.writeFileSync(path.join(home, 'bili-duty/config.json'), JSON.stringify((await request('/api/bili-duty/config')).config));
    const result = await connectPrivateChannel({ channel: 'bili', role, config, catalog, routes: effective, home, request });
    assert.equal(result.state, 'connected'); assert.equal(hot.dmUid, 555888999); assert.equal(hot.targetSession, 'session-a');
    assert.equal(hot.watchOn, true); assert.equal(hot.watchAt, false); assert.ok(tools.includes('bili_send_message'));
    assert.equal(calls.filter(method => method === 'POST').length, 1);
  } finally {
    for (const off of cleanups.reverse()) off();
    if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome;
    if (oldModules === undefined) delete process.env.DSH_HOST_MODULES; else process.env.DSH_HOST_MODULES = oldModules;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
