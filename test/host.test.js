import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { defaultConfig } from '../lib/roles.js';

async function request(routes, pathname, method = 'GET', body) {
  const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
  req.method = method; req.socket = { remoteAddress: '127.0.0.1' }; req.headers = { host: 'localhost:1', origin: 'http://localhost:1', 'content-type': 'application/json' };
  let code, value; await routes.get(pathname)(req, { writeHead: c => { code = c; }, end: text => { value = JSON.parse(text); } }); return { code, value };
}
for (const legacyVersion of [5, 6]) test(`v${legacyVersion} 升级取消工具禁用，配置保存、工作区绑定、覆盖检查和 CAS 保持有效`, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-console-host-')); process.env.DSH_HOME = home;
  try {
    const a = fs.realpathSync(home), b = path.join(home, 'other'); fs.mkdirSync(b);
    fs.mkdirSync(path.join(home, 'fish-console'));
    const legacy = defaultConfig(); legacy.version = legacyVersion;
    Object.assign(legacy.roles[0], { selfName: '原来的鱼', ownerName: '管理员', persona: '手写人设' });
    legacy.bindings = { workspaces: [{ workspace: a, roleId: 'role-default' }], ...(legacyVersion === 5 ? { sessions: [{ sessionId: 'a', roleId: 'role-default' }] } : {}) };
    legacy.toolPolicies = [{ workspace: a, disabledTools: ['bash'] }];
    const legacyBytes = Buffer.from(JSON.stringify(legacy));
    fs.writeFileSync(path.join(home, 'fish-console/config.json'), legacyBytes);
    const files = ['fish-memory-config.json', 'feiyu-mood/config.json', 'bili-duty/config.json', 'qq-bridge-config.json'];
    const originals = files.map(file => {
      const full = path.join(home, file); fs.mkdirSync(path.dirname(full), { recursive: true }); const bytes = Buffer.from('{"name":"OTHER-PLUGIN-MUST-NOT-CHANGE","secret":"TEST-SECRET"}'); fs.writeFileSync(full, bytes); return bytes;
    });
    let guard;
    const events = new Map(), routes = new Map();
    const agents = [{ id: 'a', session: { id: 'a', header: { cwd: a } } }, { id: 'b', session: { id: 'b', header: { cwd: b } } }];
    const ctx = { on: (name, fn) => events.set(name, fn), effect: fn => fn(),
      systemPrompt: { assemble() {} }, llm: { stream() {} },
      agents: { list: () => agents, currentInitiator: () => agents[0] },
      tools: { schemas: () => [{ name: 'bash' }, { name: 'remember' }], guard: fn => { guard = fn; } },
      workspaceRegistry: { list: () => [{ path: a, title: 'A', sessionIds: ['a'] }, { path: b, title: 'B', sessionIds: ['b'] }] },
      webServer: { register: route => { routes.set(route.path, route.handler); return () => {}; }, getOrigin: () => { throw new Error('must not call plugin HTTP APIs'); } } };
    const { apply } = await import(`../lib/host.js?tool-migration-${legacyVersion}`); apply(ctx);
    const initial = (await request(routes, '/fish-console/config')).value;
    assert.equal(initial.protocolVersion, 7); assert.equal(initial.config.roles[0].selfName, '原来的鱼');
    if (legacyVersion === 5) assert.match(initial.bindingMigration, /移除 1 个/);
    else assert.equal(initial.bindingMigration, undefined);
    assert.equal(Object.hasOwn(initial.config, 'toolPolicies'), false);
    assert.equal(Object.hasOwn(initial, 'tools'), false);
    assert.deepEqual(initial.config.bindings, { workspaces: legacy.bindings.workspaces });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'fish-console/config.json'))), initial.config);
    const backups = path.join(home, 'fish-console/backups');
    assert.deepEqual(fs.readFileSync(path.join(backups, fs.readdirSync(backups)[0])), legacyBytes);
    assert.equal((await request(routes, '/fish-console/config', 'POST', { config: legacy, baseRevision: initial.baseRevision })).code, 409);
    const config = structuredClone(initial.config); config.roles[0].selfName = '统一的新名字'; config.bindings.workspaces.push({ workspace: b, roleId: 'role-default' });
    const saved = await request(routes, '/fish-console/config', 'POST', { config, baseRevision: initial.baseRevision }); assert.equal(saved.code, 200);
    const duplicate = await request(routes, '/fish-console/config', 'POST', { config: initial.config, baseRevision: initial.baseRevision }); assert.equal(duplicate.code, 409);
    assert.equal((await request(routes, '/fish-console/config', 'POST', { version: 3 })).code, 409);
    assert.equal((await request(routes, '/fish-console/sync', 'POST', {})).code, 409);
    const assembly = { sections: [], contexts: [{ name: 'memory', text: 'preserved' }], tools: [{ name: 'bash' }, { name: 'remember' }] };
    const built = await events.get('system-prompt/assemble')(assembly, { agent: agents[1] }, async () => assembly);
    assert.ok(built.sections.some(s => s.text.includes('统一的新名字'))); assert.equal(built.tools.length, 2);
    assert.equal(guard({ name: 'bash', agent: agents[0] }), undefined); assert.equal(guard({ name: 'bash', agent: agents[1] }), undefined);
    const formerlyDenied = await events.get('system-prompt/assemble')(assembly, { agent: agents[0] }, async () => assembly);
    assert.deepEqual(formerlyDenied.tools, assembly.tools);
    assert.equal(formerlyDenied.sections.some(section => section.name === 'fish-console.tools'), false);
    const options = Object.freeze({ sessionId: 'b', toolHistory: [], messages: [{ role: 'system', content: built.sections.map(s => s.text).join('\n') }] });
    const stream = (async function* () { yield 'untouched'; })(); let nextCalls = 0;
    const returned = events.get('llm/stream')(options, () => { nextCalls++; return stream; }); assert.equal(returned, stream); assert.equal(nextCalls, 1);
    const check = (await request(routes, '/fish-console/coverage')).value;
    assert.equal(check.coverage.records[0].status, 'covered'); assert.equal(check.coverage.records[0].roleId, 'role-default');
    assert.ok(!JSON.stringify(check.coverage).includes('TEST-SECRET'));
    const privateConfig = structuredClone(config);
    privateConfig.roles[0].privateChat = { ...privateConfig.roles[0].privateChat, enabled: true, ownerName: '仅本机私聊', persona: 'PRIVATE-ONLY-SPEC', localSessions: ['b'] };
    assert.equal((await request(routes, '/fish-console/config', 'POST', { config: { ...privateConfig, version: 4 }, baseRevision: saved.value.baseRevision })).code, 409);
    const privateSaved = await request(routes, '/fish-console/config', 'POST', { config: privateConfig, baseRevision: saved.value.baseRevision }); assert.equal(privateSaved.code, 200);
    assert.equal((await request(routes, '/fish-console/private-connect', 'GET')).code, 405);
    assert.equal((await request(routes, '/fish-console/private-connect', 'POST', { roleId: 'role-default', channel: 'qq', baseRevision: 'stale' })).code, 409);
    assert.equal((await request(routes, '/fish-console/private-connect', 'POST', { roleId: 'role-default', channel: 'qq', baseRevision: privateSaved.value.baseRevision })).code, 400);
    agents[1].phase = { kind: 'running', turn: 1 };
    events.get('agent/inbox/claimed')({ agent: agents[1], turn: 1, message: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '直接聊天' }] } });
    const personal = await events.get('system-prompt/assemble')(assembly, { agent: agents[1] }, async () => assembly);
    assert.ok(personal.sections.some(s => s.name === 'fish-console.private' && s.text.includes('PRIVATE-ONLY-SPEC')));
    assert.ok(guard({ name: 'bili_reply', agent: agents[1], arguments: { force: true } }));
    events.get('llm/stream')(Object.freeze({ sessionId: 'b', toolHistory: [], system: personal.sections.map(s => s.text).join('\n') }), () => stream);
    const privateCheck = (await request(routes, '/fish-console/coverage')).value;
    assert.equal(privateCheck.coverage.records.at(-1).privateInput.status, 'covered'); assert.ok(!JSON.stringify(privateCheck.coverage).includes('PRIVATE-ONLY-SPEC'));
    agents[1].phase.turn = 2;
    assert.equal((await events.get('system-prompt/assemble')(personal, { agent: agents[1] }, async () => personal)).sections.some(s => s.name === 'fish-console.private'), false);
    for (let i = 0; i < files.length; i++) assert.deepEqual(fs.readFileSync(path.join(home, files[i])), originals[i]);
    assert.ok(fs.readdirSync(path.join(home, 'fish-console/backups')).length);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
