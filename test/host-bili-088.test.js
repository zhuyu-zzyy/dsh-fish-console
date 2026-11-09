import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultConfig } from '../lib/roles.js';

test('控制台组装与发送前守卫都读取 B站热路由，热配置改变后阻止旧身份外发', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-console-host-bili-')); process.env.DSH_HOME = home;
  const originalFetch = globalThis.fetch;
  try {
    const workspace = fs.realpathSync(home), config = defaultConfig(), role = config.roles[0];
    role.ownerName = '通用称呼'; role.privateChat = { ...role.privateChat, enabled: true, ownerName: '专属称呼', persona: 'PRIVATE-HOST-BILI', bili: { uid: '555888999', sessionId: 'a' } };
    config.bindings.workspaces = [{ workspace, roleId: role.id }];
    fs.mkdirSync(path.join(home, 'fish-console')); fs.writeFileSync(path.join(home, 'fish-console/config.json'), JSON.stringify(config));
    fs.mkdirSync(path.join(home, 'bili-duty')); fs.writeFileSync(path.join(home, 'bili-duty/config.json'), JSON.stringify({ dmUid: 111, targetSession: 'session-stale' }));
    const plugin = path.join(home, 'profiles/desktop/node_modules/dsh-bili-subagent'); fs.mkdirSync(plugin, { recursive: true }); fs.writeFileSync(path.join(plugin, 'package.json'), JSON.stringify({ name: 'dsh-bili-subagent', version: '0.9.2' }));
    const active = { dmUid: 555888999, targetSession: 'session-a', dmMode: 'only', autoMode: 'manual', watchOn: true, watchAt: false, watchDm: true, inboxOn: true, inboxUids: '', ownerName: '通用称呼' };
    globalThis.fetch = async (url, options) => {
      assert.equal(String(url), 'http://127.0.0.1:7319/api/bili-duty/config'); assert.equal(options.method, 'GET');
      return new Response(JSON.stringify({ ok: true, config: active }));
    };
    const events = new Map(), cleanups = []; let guard;
    const agent = { phase: { kind: 'running', turn: 1 }, session: { id: 'session-a', header: { cwd: workspace } } };
    const ctx = { on: (name, fn) => events.set(name, fn), effect: fn => { const off = fn(); if (typeof off === 'function') cleanups.push(off); },
      agents: { list: () => [agent] }, systemPrompt: { assemble() {} }, llm: { stream() {} },
      tools: { schemas: () => [], guard: fn => { guard = fn; } },
      workspaceRegistry: { list: () => [{ path: workspace, sessionIds: ['session-a'] }] },
      webServer: { getOrigin: () => 'http://127.0.0.1:7319', register: () => () => {} } };
    const { apply } = await import('../lib/host.js'); apply(ctx);
    events.get('agent/inbox/claimed')({ agent, turn: 1, message: { role: 'user', source: { kind: 'bili-duty-scan' }, content: '⚠️ 这一轮只是通用称呼在 **B站 私信**里跟你说了一句话（没带视频）：正文' } });
    const assembly = { sections: [], contexts: [], tools: [] };
    const result = await events.get('system-prompt/assemble')(assembly, { agent }, async () => assembly);
    assert.ok(result.sections.some(section => section.name === 'fish-console.private' && section.text.includes('PRIVATE-HOST-BILI')));
    const exec = { agent, name: 'bili_send_message', arguments: {} };
    await events.get('tools/pre-execute')(exec, async () => ({ kind: 'allow' })); assert.equal(guard(exec), undefined);
    active.dmUid = 999000111;
    await events.get('tools/pre-execute')(exec, async () => ({ kind: 'allow' })); assert.ok(guard(exec));
    assert.ok(guard({ agent, name: 'bili_reply', arguments: { force: true } }));
    for (const off of cleanups.reverse()) off();
  } finally { globalThis.fetch = originalFetch; fs.rmSync(home, { recursive: true, force: true }); }
});
