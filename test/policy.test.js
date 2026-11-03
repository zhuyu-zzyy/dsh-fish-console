import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanConfig, defaultConfig, defaultRole, resolveRole, roleRevision, roleSections } from '../lib/roles.js';
import { canonicalDirectory, workspacePath } from '../lib/paths.js';
import { applyAssembly, deniedTool } from '../lib/policy.js';
import { collectCatalog, createCatalogReader, validateBindings } from '../lib/catalog.js';

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-console-role-'));
  const a = path.join(home, 'a'), b = path.join(home, 'b'); fs.mkdirSync(a); fs.mkdirSync(b);
  const workA = fs.realpathSync(a), workB = fs.realpathSync(b);
  return { home, a: workA, b: workB, close: () => fs.rmSync(home, { recursive: true, force: true }) };
}
test('v3 配置迁移保留名字、人设和工具选择，只转为本控制台的角色绑定', () => {
  const f = fixture();
  try {
    const config = cleanConfig({ version: 3, workspace: f.a, selfName: '小肥鱼001', ownerName: '管理员', persona: '用户手写的完整人设', disabledTools: ['bash', 'remember'] });
    assert.equal(config.version, 5); assert.equal(config.roles[0].selfName, '小肥鱼001'); assert.equal(config.roles[0].persona, '用户手写的完整人设');
    assert.deepEqual(config.bindings.workspaces, [{ workspace: f.a, roleId: 'role-default' }]);
    assert.deepEqual(config.toolPolicies, [{ workspace: f.a, disabledTools: ['bash'] }]);
    assert.equal(config.bindings.sessions.length, 0);
    const old = cleanConfig({ workspace: f.a, persona: '# 旧名字', flags: { biliTools: false, memory: false, mood: false } });
    assert.equal(old.roles[0].selfName, '旧名字'); assert.ok(old.toolPolicies[0].disabledTools.includes('bili_scan'));
  } finally { f.close(); }
});
test('同一角色绑定多个工作区，单独会话可覆盖工作区；子代理继承不继承工具权限', () => {
  const f = fixture();
  try {
    const config = defaultConfig(); config.roles.push({ ...defaultRole('second'), selfName: '另一条鱼' });
    config.bindings.workspaces = [{ workspace: f.a, roleId: 'role-default' }, { workspace: f.b, roleId: 'role-default' }];
    config.bindings.sessions = [{ sessionId: 'parent', roleId: 'second' }];
    config.toolPolicies = [{ workspace: f.a, disabledTools: ['bash'] }];
    const parent = { id: 'parent', workspace: f.a }, child = { id: 'child', workspace: f.b, parentId: 'parent' };
    const lookup = id => id === 'parent' ? parent : undefined;
    assert.equal(resolveRole(config, { id: 'other', workspace: f.b }, lookup).role.id, 'role-default');
    const resolved = resolveRole(config, child, lookup); assert.equal(resolved.role.id, 'second'); assert.equal(resolved.source, 'parent');
    assert.equal(deniedTool('bash', config, child.workspace), false); assert.equal(deniedTool('bash', config, parent.workspace), true);
    config.bindings.sessions.push({ sessionId: 'child', roleId: 'role-default' });
    assert.equal(resolveRole(config, child, lookup).source, 'session');
  } finally { f.close(); }
});
test('父关系循环、未知角色和冲突绑定不会默默选择角色', () => {
  const config = defaultConfig(); const a = { id: 'a', parentId: 'b' }, b = { id: 'b', parentId: 'a' };
  assert.equal(resolveRole(config, a, id => id === 'a' ? a : b).status, 'unresolved');
  assert.throws(() => cleanConfig({ ...config, version: 99 }));
  assert.throws(() => cleanConfig({ ...config, bindings: { workspaces: [], sessions: [{ sessionId: 'a', roleId: 'missing' }] } }));
  assert.throws(() => cleanConfig({ ...config, bindings: { workspaces: [], sessions: [{ sessionId: 'a', roleId: 'role-default' }, { sessionId: 'session-a', roleId: 'role-default' }] } }));
  config.bindings.sessions = [{ sessionId: 'parent', roleId: 'role-default' }];
  assert.equal(resolveRole(config, { id: 'child', parentId: 'parent' }, () => ({ id: 'parent', ambiguous: true })).status, 'unresolved');
});
test('人设按字面渲染，重复组装不叠加，记忆和心情上下文保留', () => {
  const f = fixture();
  try {
    const config = defaultConfig(), role = { ...defaultRole(), selfName: '鱼{{字面}}', ownerName: '管理员', persona: '{{selfName}}对{{ownerName}}说话' };
    config.roles = [role]; config.toolPolicies = [{ workspace: f.a, disabledTools: ['bash', 'remember'] }];
    const input = { sections: [{ name: 'base', text: '基础' }], contexts: [{ name: 'memory', text: '旧记忆' }, { name: 'feiyu-mood', text: '心情' }], tools: [{ name: 'bash' }, { name: 'remember' }] };
    const resolution = { status: 'bound', role }, descriptor = { workspace: f.a };
    const first = applyAssembly(input, config, descriptor, resolution), second = applyAssembly(first, config, descriptor, resolution);
    assert.equal(second.sections.filter(s => s.name === 'fish-console.persona').length, 1);
    assert.equal(first.sections[1].text.includes('鱼{{字面}}对管理员说话'), true);
    assert.equal(first.sections.at(-1).interpolate, false); assert.deepEqual(first.contexts, input.contexts);
    assert.deepEqual(first.tools.map(t => t.name), ['remember']); assert.equal(input.tools.length, 2);
    assert.notEqual(roleRevision(role), roleRevision({ ...role, ownerName: '新称呼' }));
    assert.ok(roleSections(role)[0].text.includes(roleRevision(role)));
  } finally { f.close(); }
});
test('路径按真实工作区匹配；新绑定只接受 DSH 已知目标', () => {
  const f = fixture();
  try {
    const alias = path.join(f.home, 'alias'); fs.symlinkSync(f.a, alias); assert.equal(canonicalDirectory(alias), f.a);
    assert.equal(workspacePath('relative'), '');
    const config = defaultConfig(), ctx = { workspaceRegistry: { list: () => [{ path: f.a, title: 'A', sessionIds: ['session-a'] }] }, agents: { list: () => [] } };
    const catalog = collectCatalog(ctx); config.bindings.sessions = [{ sessionId: 'a', roleId: 'role-default' }];
    validateBindings(config, defaultConfig(), catalog);
    assert.equal(catalog.lookup('session-a').id, 'a');
    assert.throws(() => validateBindings({ ...config, bindings: { workspaces: [], sessions: [{ sessionId: 'unknown', roleId: 'role-default' }] } }, defaultConfig(), catalog));
    assert.throws(() => cleanConfig({ ...config, roles: [{ ...config.roles[0], ownerName: '称\n呼' }] }));
  } finally { f.close(); }
});
test('未加载会话通过只读头部与标题缓存显示名称、恢复父关系，不读取聊天正文', async () => {
  const f = fixture();
  try {
    let calls = 0;
    const ctx = { workspaceRegistry: { list: () => [{ path: f.a, sessionIds: ['parent'] }, { path: f.b, sessionIds: ['child'] }] }, agents: { list: () => [] },
      sessionQuery: { listSessions: async () => { calls++; return [{ header: { id: 'parent', cwd: f.a } }, { header: { id: 'child', cwd: f.b, parentSession: 'parent', origin: 'subagent' } }]; }, readSession: () => { throw new Error('must not read bodies'); } },
      sessionProjectionCache: { cachedSnapshot: (header, keys) => { assert.deepEqual(keys, ['title']); return { values: { title: header.id === 'parent' ? '父会话名字' : '子会话名字' } }; } } };
    const reader = createCatalogReader(ctx); await reader.refresh(); await reader.refresh();
    const catalog = reader.collect(); assert.equal(calls, 1); assert.equal(catalog.lookup('child').title, '子会话名字');
    const config = defaultConfig(); config.bindings.sessions = [{ sessionId: 'parent', roleId: 'role-default' }];
    assert.equal(resolveRole(config, catalog.lookup('child'), catalog.lookup).source, 'parent');
  } finally { f.close(); }
});
test('可选元数据服务使用宿主 lookup；缺少标题服务不会使头部索引失败', async () => {
  const headers = [{ header: { id: 'cold-parent', cwd: '/known' } }, { header: { id: 'cold-child', cwd: '/known', parentSession: 'cold-parent' } }];
  const serviceNames = ['sessions', 'sessionProjections', 'sessionQuery', 'sessionProjectionCache'];
  const services = { sessionQuery: { listSessions: async () => headers } };
  const ctx = new Proxy({
    get: name => services[name],
    workspaceRegistry: { list: () => [{ path: '/known', sessionIds: ['cold-parent', 'cold-child'] }] },
    agents: { list: () => [] },
  }, { get(target, key) { if (serviceNames.includes(key)) throw new Error('direct optional service access requires inject'); return Reflect.get(target, key); } });
  const reader = createCatalogReader(ctx); await reader.refresh();
  assert.equal(reader.status().available, true); assert.match(reader.status().message, /标题缓存不可用/);
  assert.equal(reader.collect().lookup('cold-child').parentId, 'cold-parent');
});
