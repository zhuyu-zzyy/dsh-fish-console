import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanConfig, defaultConfig, defaultRole, resolveRole, roleRevision, roleSections } from '../lib/roles.js';
import { canonicalDirectory, workspacePath } from '../lib/paths.js';
import { applyAssembly } from '../lib/policy.js';
import { collectCatalog, createCatalogReader, validateBindings } from '../lib/catalog.js';

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-console-role-'));
  const a = path.join(home, 'a'), b = path.join(home, 'b'); fs.mkdirSync(a); fs.mkdirSync(b);
  const workA = fs.realpathSync(a), workB = fs.realpathSync(b);
  return { home, a: workA, b: workB, close: () => fs.rmSync(home, { recursive: true, force: true }) };
}
test('v3 配置迁移保留名字、人设和工作区绑定，移除旧工具禁用列表', () => {
  const f = fixture();
  try {
    const config = cleanConfig({ version: 3, workspace: f.a, selfName: '小肥鱼001', ownerName: '管理员', persona: '用户手写的完整人设', disabledTools: ['bash', 'remember'] });
    assert.equal(config.version, 7); assert.equal(config.roles[0].selfName, '小肥鱼001'); assert.equal(config.roles[0].persona, '用户手写的完整人设');
    assert.deepEqual(config.bindings.workspaces, [{ workspace: f.a, roleId: 'role-default' }]);
    assert.equal(Object.hasOwn(config, 'toolPolicies'), false);
    assert.equal(Object.hasOwn(config, 'disabledTools'), false);
    assert.equal(Object.hasOwn(config.bindings, 'sessions'), false);
    const old = cleanConfig({ workspace: f.a, persona: '# 旧名字', flags: { biliTools: false, memory: false, mood: false } });
    assert.equal(old.roles[0].selfName, '旧名字'); assert.equal(Object.hasOwn(old, 'toolPolicies'), false);
    assert.equal(Object.hasOwn(old, 'flags'), false);
  } finally { f.close(); }
});
test('角色只按自身工作区选择，新会话及子代理不受旧会话覆盖或父角色影响', () => {
  const f = fixture();
  try {
    const config = defaultConfig(); config.roles.push({ ...defaultRole('second'), selfName: '另一条鱼' });
    config.bindings.workspaces = [{ workspace: f.a, roleId: 'second' }, { workspace: f.b, roleId: 'role-default' }];
    const parent = { id: 'parent', workspace: f.a }, child = { id: 'child', workspace: f.b, parentId: 'parent' };
    const lookup = () => parent;
    for (const session of [{ id: 'new', workspace: f.b }, child]) {
      const result = resolveRole(config, session, lookup);
      assert.equal(result.role.id, 'role-default'); assert.equal(result.source, 'workspace');
    }
    assert.equal(resolveRole(config, parent, lookup).role.id, 'second');
    config.bindings.sessions = [{ sessionId: 'child', roleId: 'second' }];
    assert.equal(resolveRole(config, child, lookup).role.id, 'role-default');
    assert.throws(() => cleanConfig(config), /只支持工作区/);
  } finally { f.close(); }
});
test('v5 升级保留完整角色、私聊授权和工作区绑定，去除会话覆盖；歧义不猜测归属', () => {
  const config = defaultConfig(); config.version = 5; config.inheritParentRole = true;
  config.bindings.workspaces = [{ workspace: '/workspace', roleId: 'role-default' }];
  config.bindings.sessions = [{ sessionId: 'a', roleId: 'role-default' }];
  config.roles[0].privateChat.localSessions = ['a'];
  const upgraded = cleanConfig(config);
  assert.equal(upgraded.version, 7); assert.deepEqual(upgraded.roles, config.roles);
  assert.deepEqual(upgraded.bindings, { workspaces: config.bindings.workspaces });
  assert.equal(Object.hasOwn(upgraded, 'inheritParentRole'), false);
  assert.equal(resolveRole(upgraded, { id: 'a', workspace: '/workspace', ambiguous: true }).status, 'unresolved');
  assert.equal(resolveRole(upgraded, { id: 'a', workspace: '/elsewhere' }).status, 'unbound');
  assert.throws(() => cleanConfig({ ...config, version: 99 }));
  assert.throws(() => cleanConfig({ ...config, bindings: { workspaces: [], sessions: [{ sessionId: 'a', roleId: 'missing' }] } }));
  assert.throws(() => cleanConfig({ ...config, bindings: { workspaces: [], sessions: [{ sessionId: 'a', roleId: 'role-default' }, { sessionId: 'session-a', roleId: 'role-default' }] } }));
});
test('v6 升级清除工具策略，重复保存不能恢复禁用项，角色和私聊配置保留', () => {
  const legacy = defaultConfig(); legacy.version = 6;
  legacy.bindings.workspaces = [{ workspace: '/workspace', roleId: 'role-default' }];
  legacy.roles[0].privateChat = { ...legacy.roles[0].privateChat, enabled: true, persona: '保留私聊规则', localSessions: ['local'] };
  legacy.toolPolicies = [{ workspace: '/workspace', disabledTools: ['bash', 'bili_search', 'screen_observe'] }];
  const upgraded = cleanConfig(legacy);
  assert.equal(upgraded.version, 7);
  assert.deepEqual(upgraded.roles, legacy.roles); assert.deepEqual(upgraded.bindings, legacy.bindings);
  assert.equal(Object.hasOwn(upgraded, 'toolPolicies'), false);
  assert.deepEqual(cleanConfig({ ...upgraded, toolPolicies: legacy.toolPolicies }), upgraded);
  assert.deepEqual(cleanConfig({ ...legacy, toolPolicies: null }), upgraded);
});
test('人设按字面渲染，重复组装不叠加，记忆和心情上下文保留', () => {
  const f = fixture();
  try {
    const config = defaultConfig(), role = { ...defaultRole(), selfName: '鱼{{字面}}', ownerName: '管理员', persona: '{{selfName}}对{{ownerName}}说话' };
    config.roles = [role];
    const input = { sections: [{ name: 'base', text: '基础' }, { name: 'fish-console.tools', text: '旧版禁用提示' }], contexts: [{ name: 'memory', text: '旧记忆' }, { name: 'feiyu-mood', text: '心情' }], tools: Object.freeze([{ name: 'bash' }, { name: 'remember' }]) };
    const resolution = { status: 'bound', role };
    const first = applyAssembly(input, resolution), second = applyAssembly(first, resolution);
    assert.equal(second.sections.filter(s => s.name === 'fish-console.persona').length, 1);
    assert.equal(first.sections[1].text.includes('鱼{{字面}}对管理员说话'), true);
    assert.equal(first.sections.find(s => s.name === 'fish-console.identity').interpolate, false); assert.deepEqual(first.contexts, input.contexts);
    assert.equal(first.tools, input.tools); assert.equal(second.tools, input.tools);
    assert.equal(second.sections.some(s => s.name === 'fish-console.tools'), false);
    const unbound = applyAssembly(second, { status: 'unbound' });
    assert.equal(unbound.tools, input.tools); assert.deepEqual(unbound.sections, [input.sections[0]]);
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
    const catalog = collectCatalog(ctx); config.bindings.workspaces = [{ workspace: f.a, roleId: 'role-default' }];
    validateBindings(config, defaultConfig(), catalog);
    assert.equal(catalog.lookup('session-a').id, 'a');
    assert.throws(() => validateBindings({ ...config, bindings: { workspaces: [{ workspace: f.b, roleId: 'role-default' }] } }, defaultConfig(), catalog));
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
    const config = defaultConfig(); config.bindings.workspaces = [{ workspace: f.b, roleId: 'role-default' }];
    assert.equal(resolveRole(config, catalog.lookup('child'), catalog.lookup).source, 'workspace');
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

test('DSH 0.2.2 无 tools 的组装载荷保留上下文和变量，不伪造工具声明', () => {
  const config = defaultConfig();
  const assembly = Object.freeze({ sections: [], contexts: [{ name: 'memory', text: 'memory' }], variables: { keep: 'value' } });
  const result = applyAssembly(assembly, { status: 'bound', role: config.roles[0] });
  assert.equal(Object.hasOwn(result, 'tools'), false); assert.equal(result.contexts, assembly.contexts); assert.equal(result.variables, assembly.variables);
  assert.ok(result.sections.some(s => s.name === 'fish-console.persona'));
  assert.equal(result.sections.some(s => s.name === 'fish-console.tools'), false);
});
