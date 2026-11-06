import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultConfig, defaultRole } from '../lib/roles.js';
import { identityTargets, moodWorkspaceKey } from '../lib/identity-targets.js';
import { syncMemory, planMood, syncMood, syncBili, syncQq } from '../lib/identity-adapters.js';
import { createIdentitySync, nativeRequester } from '../lib/identity-sync.js';

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-console-names-'));
  const config = defaultConfig(); config.roles[0].selfName = '小肥鱼001'; config.roles[0].ownerName = '老大';
  config.bindings.workspaces = [{ workspace: '/workspace-a', roleId: 'role-default' }];
  const sessions = [{ id: 'a', nativeId: 'session-a', workspace: '/workspace-a' }, { id: 'b', nativeId: 'session-b', workspace: '/workspace-b' }];
  const catalog = { sessions, registryAvailable: true, agentsAvailable: true, lookup: id => sessions.find(session => session.id === String(id).replace(/^session-/, '')) };
  return { home, config, catalog, targets: () => identityTargets(config, catalog), backupDir: path.join(home, 'backups'), close: () => fs.rmSync(home, { recursive: true, force: true }) };
}
test('记忆同步全局称呼和对应会话名字，保留其他字段、其他会话及历史正文；重复执行幂等', async () => {
  const f = fixture();
  try {
    const file = path.join(f.home, 'fish-memory-config.json');
    fs.writeFileSync(file, JSON.stringify({ userPronoun: '管理员', selfNames: { b: '别的鱼' }, ownerNames: { b: '别人', a: '旧称呼' }, other: { secret: 'KEEP-SECRET' }, sessions: { a: false } }));
    const history = path.join(f.home, 'fish-memory-history.json'); const bytes = Buffer.from('{"memories":[{"text":"小肥鱼001曾叫我管理员"}]}'); fs.writeFileSync(history, bytes);
    const args = { ...f, targets: f.targets() };
    assert.equal((await syncMemory(args)).state, 'synced');
    const saved = JSON.parse(fs.readFileSync(file)); assert.equal(saved.userPronoun, '老大');
    assert.equal(saved.selfNames['session-a'], '小肥鱼001'); assert.equal(saved.ownerNames.a, '老大'); assert.equal(saved.ownerNames['session-a'], '老大');
    assert.equal(saved.ownerNames.b, '别人'); assert.equal(saved.selfNames.b, '别的鱼'); assert.deepEqual(saved.sessions, { a: false }); assert.deepEqual(saved.other, { secret: 'KEEP-SECRET' });
    assert.deepEqual(fs.readFileSync(history), bytes); const count = fs.readdirSync(f.backupDir).length;
    await syncMemory(args); assert.equal(fs.readdirSync(f.backupDir).length, count);
    f.config.roles.push({ ...defaultRole('second'), selfName: '另一条鱼', ownerName: '另一位' }); f.config.bindings.workspaces.push({ workspace: '/workspace-b', roleId: 'second' });
    assert.equal((await syncMemory({ ...f, targets: f.targets() })).state, 'partial');
    const multi = JSON.parse(fs.readFileSync(file)); assert.equal(multi.userPronoun, '老大'); assert.equal(multi.ownerNames['session-b'], '另一位');
  } finally { f.close(); }
});
test('心情同步已有份和默认名字，不新增绑定、改昵称或重置稳定 ID；共享冲突保留', async () => {
  const f = fixture();
  try {
    let current = { 模式: 'workspace', selfName: '伙伴', ownerName: '用户', selfAliases: '原昵称', autoJudge: true, slots: [{ id: 'keep-ledger-id', 工作区: moodWorkspaceKey('/workspace-a'), sessions: [], selfName: '旧鱼', ownerName: '管理员' }] };
    const calls = [];
    const request = async (route, body) => { assert.equal(route, '/dsh-feiyu-mood/config'); if (body) { calls.push(body); current = { ...current, ...body }; } return { ok: true, config: structuredClone(current) }; };
    assert.equal((await syncMood({ ...f, targets: f.targets(), request })).state, 'synced');
    assert.equal(current.ownerName, '老大'); assert.equal(current.selfName, '小肥鱼001'); assert.equal(current.slots[0].ownerName, '老大');
    assert.equal(current.slots[0].id, 'keep-ledger-id'); assert.deepEqual(current.slots[0].sessions, []); assert.equal(current.selfAliases, '原昵称'); assert.equal(current.autoJudge, true);
    await syncMood({ ...f, targets: f.targets(), request }); assert.equal(calls.length, 1);
    const mixed = { ...current, 模式: 'session', slots: [{ id: 'mixed', sessions: ['session-a', 'session-b'], selfName: '保持名字' }] };
    const plan = planMood(mixed, f.targets()); assert.equal(plan.state, 'partial'); assert.deepEqual(plan.patch, {});
    const shared = { ...current, slots: [...current.slots, { id: 'unmanaged', 工作区: '--elsewhere--', sessions: [] }], ownerName: '原默认' };
    assert.equal(planMood(shared, f.targets()).patch.ownerName, undefined);
  } finally { f.close(); }
});
test('B站仅提交称呼补丁；全局多角色冲突不写；宿主未确认需要继续重试', async () => {
  const f = fixture();
  try {
    let current = { ownerName: '管理员', targetSession: 'outside', dynamicOn: true, hintPrompt: '保留任务提示' }, hostOk = false;
    const patches = [];
    const request = async (route, patch) => { assert.equal(route, '/api/bili-duty/config'); if (patch) { patches.push(patch); current = { ...current, ...patch }; } return { ok: true, config: structuredClone(current), host: { ok: hostOk } }; };
    const partial = await syncBili({ ...f, targets: f.targets(), request }); assert.equal(partial.needsHostRetry, true);
    hostOk = true; assert.equal((await syncBili({ ...f, targets: f.targets(), request, previous: partial })).state, 'synced');
    assert.deepEqual(patches, [{ ownerName: '老大' }, { ownerName: '老大' }]); assert.equal(current.targetSession, 'outside'); assert.equal(current.dynamicOn, true); assert.equal(current.hintPrompt, '保留任务提示');
    f.config.roles.push({ ...defaultRole('second'), ownerName: '别人' }); f.config.bindings.workspaces.push({ workspace: '/workspace-b', roleId: 'second' });
    assert.equal((await syncBili({ ...f, targets: f.targets(), request })).state, 'conflict'); assert.equal(patches.length, 2);
  } finally { f.close(); }
});
test('B站有效配置与磁盘配置不一致时停止名称同步，避免其整份写回覆盖自动任务', async () => {
  const f = fixture();
  try {
    fs.mkdirSync(path.join(f.home, 'bili-duty'));
    fs.writeFileSync(path.join(f.home, 'bili-duty/config.json'), JSON.stringify({ ownerName: '老大', targetSession: 'session-a', watchOn: true, dynamicAutoOn: true }));
    let writes = 0;
    const request = async (_route, body) => { if (body) writes++; return { ok: true, config: { ownerName: '用户', targetSession: '', watchOn: false, dynamicAutoOn: false } }; };
    const result = await syncBili({ ...f, targets: f.targets(), request });
    assert.equal(result.state, 'partial'); assert.match(result.message, /生效设置与保存设置不一致/); assert.equal(writes, 0);
  } finally { f.close(); }
});
test('QQ 只更新可归属的私聊称呼，群聊、开关和其他对象保留；未配置不创建', async () => {
  const f = fixture();
  try {
    const args = { ...f, targets: f.targets() };
    assert.equal((await syncQq(args)).state, 'not_configured');
    const file = path.join(f.home, 'qq-bridge-config.json'), rows = [{ 类型: '私聊', 号码: '1', 会话: 'session-a', 称呼: '管理员' }, { 类型: '群', 号码: '2', 会话: 'session-a', 称呼: '群里的人' }, { 类型: '私聊', 号码: '3', 会话: 'session-b', 称呼: '别人' }];
    fs.writeFileSync(file, JSON.stringify({ 绑定: rows, 令牌: 'KEEP-SECRET', 总开关: false, 称呼: '管理员' }));
    await syncQq(args); const saved = JSON.parse(fs.readFileSync(file));
    assert.equal(saved.绑定[0].称呼, '老大'); assert.deepEqual(saved.绑定.slice(1), rows.slice(1)); assert.equal(saved.称呼, '老大'); assert.equal(saved.总开关, false); assert.equal(saved.令牌, 'KEEP-SECRET');
  } finally { f.close(); }
});
test('同步队列使用最新保存角色；失败不暴露配置，未适配版本不调用写入器', async () => {
  const f = fixture();
  let manager;
  try {
    let config = f.config, release, reads = 0;
    const gate = new Promise(resolve => { release = resolve; }); const applied = [];
    manager = createIdentitySync({ ctx: { webServer: {} }, home: f.home, getConfig: () => config, getCatalog: async () => { if (++reads === 1) await gate; return f.catalog; },
      versions: () => ({ memory: { compatible: true }, mood: { compatible: true } }), implementations: {
        memory: async ({ targets }) => { applied.push(targets.globalOwner); return { state: 'synced' }; },
        mood: async () => { throw new Error('DO-NOT-EXPOSE-SECRET'); }, bili: () => { throw new Error('unsupported adapter must not run'); },
      } });
    const first = manager.sync(); await Promise.resolve(); config = structuredClone(config); config.roles[0].ownerName = '最新称呼'; const second = manager.sync(); release();
    await Promise.all([first, second]); assert.ok(applied.length); assert.ok(applied.every(name => name === '最新称呼'));
    const status = manager.status(); assert.equal(status.results.mood.state, 'failed'); assert.equal(status.results.bili.state, 'unsupported'); assert.ok(!JSON.stringify(status).includes('DO-NOT-EXPOSE-SECRET'));
  } finally { manager?.dispose(); f.close(); }
});
test('原生接口请求拒绝非本机地址，避免发送插件设置到外部', async () => {
  const request = nativeRequester({ getOrigin: () => 'https://example.com' }, new AbortController().signal);
  await assert.rejects(request('/config', { ownerName: '称呼' }), /必须在本机/);
});
