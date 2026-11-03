import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoverage } from '../lib/coverage.js';
import { defaultConfig, defaultRole, roleSections } from '../lib/roles.js';

function fixture() {
  const config = defaultConfig(); config.roles.push({ ...defaultRole('second'), selfName: '第二条鱼' });
  config.bindings.sessions = [{ sessionId: 'a', roleId: 'role-default' }, { sessionId: 'b', roleId: 'second' }];
  const agent = { session: { id: 'a', header: {} } };
  const entries = { a: { id: 'a', live: true }, b: { id: 'b', live: true } };
  const catalog = { lookup: id => entries[String(id).replace(/^session-/, '')], isLive: value => value === agent };
  return { config, catalog, agent };
}
test('冻结请求只读检查；用户正文中的人设不能冒充已覆盖', () => {
  const { config, catalog } = fixture(), observer = createCoverage();
  const text = roleSections(config.roles[0]).map(s => s.text).join('\n');
  const request = Object.freeze({ sessionId: 'a', toolHistory: [], messages: Object.freeze([{ role: 'system', content: text }]) });
  const before = JSON.stringify(request); observer.observe(request, config, catalog); assert.equal(JSON.stringify(request), before);
  assert.equal(observer.snapshot(config).records[0].status, 'covered');
  observer.observe({ sessionId: 'a', toolHistory: [], messages: [{ role: 'user', content: [{ type: 'text', text }] }] }, config, catalog);
  assert.equal(observer.snapshot(config).records[1].status, 'uncovered');
});
test('相同模型的两个角色并发不会串号；显式未知会话不使用环境中的另一个会话', async () => {
  const { config, catalog, agent } = fixture(), observer = createCoverage();
  await Promise.all(['a', 'b'].map(async (id, index) => observer.observe({ sessionId: id, provider: 'same', model: 'same', system: roleSections(config.roles[index]).map(s => s.text).join('\n') }, config, catalog, agent)));
  observer.observe({ sessionId: 'TEST-SECRET', system: 'other', messages: [] }, config, catalog, agent);
  const result = observer.snapshot(config);
  assert.deepEqual(result.records.slice(0, 2).map(r => r.roleId), ['role-default', 'second']);
  assert.equal(result.records[2].status, 'unknown'); assert.equal(result.records[2].sessionId, null);
  assert.ok(!JSON.stringify(result).includes('TEST-SECRET'));
});
test('辅助调用显示未覆盖或归属不明，观察不改变原专用提示及输出约束', () => {
  const { config, catalog, agent } = fixture(), observer = createCoverage();
  const options = { system: '只输出 JSON', messages: [{ role: 'user', source: { kind: 'plugin', plugin: 'dsh-fish-memory' }, content: [{ type: 'text', text: 'PRIVATE-CHAT-TEXT' }] }] };
  const before = JSON.stringify(options); observer.observe(options, config, catalog, agent);
  observer.observe(options, config, catalog);
  const result = observer.snapshot(config);
  assert.equal(result.records[0].status, 'uncovered'); assert.equal(result.records[0].attribution, 'initiator'); assert.equal(result.records[0].category, 'memory');
  assert.equal(result.records[1].status, 'unknown'); assert.equal(JSON.stringify(options), before);
  assert.ok(!JSON.stringify(result).includes('PRIVATE-CHAT-TEXT')); assert.ok(!JSON.stringify(result).includes('只输出 JSON'));
});
test('组装尝试不算请求覆盖；记录有界，角色更新后旧记录失效', () => {
  const { config, catalog } = fixture(), observer = createCoverage(2);
  observer.assembly({ id: 'a' }, { role: config.roles[0] });
  assert.equal(observer.snapshot(config).records.length, 0);
  const system = roleSections(config.roles[0]).map(s => s.text).join('\n');
  for (let i = 0; i < 3; i++) observer.observe({ sessionId: 'a', system }, config, catalog);
  assert.equal(observer.snapshot(config).records.length, 2); assert.equal(observer.snapshot(config).counters.covered, 3);
  config.roles[0].selfName = '改名';
  assert.equal(observer.snapshot(config).records[0].currentRevision, false);
});
test('会话改绑其他角色或工作区后，历史成功请求不能作为当前覆盖证据', () => {
  const { config, catalog } = fixture(), observer = createCoverage();
  observer.observe({ sessionId: 'a', toolHistory: [], system: roleSections(config.roles[0]).map(s => s.text).join('\n') }, config, catalog);
  assert.equal(observer.snapshot(config, catalog).records[0].currentBinding, true);
  config.bindings.sessions[0].roleId = 'second';
  const history = observer.snapshot(config, catalog).records[0];
  assert.equal(history.currentRevision, true); assert.equal(history.currentBinding, false);
  config.bindings.sessions = config.bindings.sessions.filter(b => b.sessionId !== 'a');
  assert.equal(observer.snapshot(config, catalog).records[0].currentBinding, false);
  config.bindings.workspaces = [{ workspace: '/new-workspace', roleId: 'role-default' }];
  const moved = { ...catalog, lookup: id => id === 'a' ? { ...catalog.lookup(id), workspace: '/new-workspace' } : catalog.lookup(id) };
  assert.equal(observer.snapshot(config, moved).records[0].currentBinding, true);
});
