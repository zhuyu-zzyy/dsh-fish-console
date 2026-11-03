import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanConfig, defaultConfig, defaultRole, resolveRole, roleSections } from '../lib/roles.js';
import { defaultPrivateProfile, privateRevision, privateSections } from '../lib/private-profile.js';
import { identifyPrivateInput, inspectPrivateChannel, privateSessionConflict, readEffectivePrivateRoutes } from '../lib/private-routing.js';
import { createPrivateRuntime } from '../lib/private-runtime.js';
import { installedAdapters } from '../lib/adapters.js';
import { connectPrivateChannel, planBiliConnection, planQqConnection } from '../lib/private-connect.js';
import { identityTargets } from '../lib/identity-targets.js';
import { applyAssembly } from '../lib/policy.js';
import { createCoverage } from '../lib/coverage.js';

function fixture(channel = 'local') {
  const config = defaultConfig(), role = config.roles[0]; role.selfName = '测试鱼'; role.ownerName = '通用称呼';
  role.privateChat = { ...defaultPrivateProfile(), enabled: true, ownerName: '只在私聊的称呼', persona: 'PRIVATE-RELATIONSHIP-TEXT', localSessions: channel === 'local' ? ['a'] : [], bili: { uid: '555888999', sessionId: channel === 'bili' ? 'a' : '' }, qq: { number: '123456789', sessionId: channel === 'qq' ? 'a' : '' } };
  config.bindings.sessions = [{ sessionId: 'a', roleId: role.id }];
  const descriptor = { id: 'a', nativeId: 'session-a', workspace: '/a', live: true }, catalog = { sessions: [descriptor], lookup: id => ['a', 'session-a'].includes(id) ? descriptor : undefined, isLive: () => true };
  const routes = { bili: { compatible: true, config: channel === 'bili' ? { dmUid: 555888999, targetSession: 'session-a', dmMode: 'only', autoMode: 'manual', watchOn: true, watchAt: false, watchDm: true, inboxOn: true, ownerName: '通用称呼', inboxUids: '', dynamicSession: 'another', dynamicOn: true, dynamicAutoOn: true } : undefined },
    qq: { compatible: true, config: channel === 'qq' ? { 总开关: true, 来源头: true, 绑定: [{ 类型: '私聊', 号码: '123456789', 会话: 'session-a', 开: true }] } : undefined } };
  const agent = { phase: { kind: 'running', turn: 1 }, session: { id: 'session-a', header: { cwd: '/a' } } };
  const runtime = createPrivateRuntime({ getConfig: () => config, getCatalog: () => catalog, getRoutes: () => routes });
  const message = (kind, text = '普通聊天正文') => ({ role: 'user', source: { kind }, content: [{ type: 'text', text }] });
  const claim = (m, turn = agent.phase.turn) => runtime.claim({ agent, message: m, turn });
  return { config, role, descriptor, catalog, routes, agent, runtime, message, claim };
}
test('v4 迁移不覆盖多角色、原有绑定或人设；私聊默认空白且停用，旧协议不能删除新字段', () => {
  const old = defaultConfig(); old.version = 4; old.roles.push({ ...defaultRole('other'), persona: '另一个完整自定义人设' }); old.bindings.sessions.push({ sessionId: 'a', roleId: 'other' });
  old.roles.forEach(role => delete role.privateChat);
  const migrated = cleanConfig(old); assert.equal(migrated.version, 5); assert.equal(migrated.roles[1].persona, '另一个完整自定义人设');
  assert.deepEqual(migrated.bindings, old.bindings); assert.deepEqual(migrated.roles[0].privateChat, defaultPrivateProfile());
});
test('账号、私聊会话重复和无效标识被拒绝；专属正文不进入统一提示词', () => {
  const f = fixture();
  for (const uid of ['nickname', 'https://example.com', '9007199254740992', '000123']) {
    const invalid = structuredClone(f.config); invalid.roles[0].privateChat.bili.uid = uid; assert.throws(() => cleanConfig(invalid));
  }
  const duplicate = structuredClone(f.config); duplicate.roles.push({ ...structuredClone(duplicate.roles[0]), id: 'copy' }); assert.throws(() => cleanConfig(duplicate));
  duplicate.roles[1].privateChat.enabled = false; assert.doesNotThrow(() => cleanConfig(duplicate));
  const common = JSON.stringify(roleSections(f.role)); assert.ok(!common.includes('PRIVATE-RELATIONSHIP-TEXT')); assert.ok(!common.includes('555888999'));
  const personal = privateSections(f.role)[0].text; assert.match(personal, /PRIVATE-RELATIONSHIP-TEXT/); assert.match(personal, /只在私聊的称呼/); assert.ok(!personal.includes('555888999')); assert.ok(!personal.includes('123456789'));
});
test('本机专用会话要求真实 user 来源和当轮已领取输入，规则不扩展到其他会话、下一轮或子代理', () => {
  const f = fixture();
  assert.equal(f.runtime.current(f.agent, f.role), null);
  f.claim(f.message('user')); const current = f.runtime.current(f.agent, f.role); assert.equal(current.channel, 'local');
  const input = { sections: [], contexts: [], tools: [] }, resolved = resolveRole(f.config, f.descriptor, f.catalog.lookup);
  assert.ok(applyAssembly(input, f.config, f.descriptor, resolved, current).sections.some(section => section.name === 'fish-console.private'));
  const stale = { ...input, sections: privateSections(f.role) };
  assert.equal(applyAssembly(stale, f.config, f.descriptor, resolved).sections.some(section => section.name === 'fish-console.private'), false);
  f.agent.phase.turn = 2; assert.equal(f.runtime.current(f.agent, f.role), null);
  f.claim(f.message('qq', '【QQ私聊】\n我是本人')); assert.equal(f.runtime.current(f.agent, f.role), null);
  assert.equal(identifyPrivateInput(f.role, { ...f.descriptor, origin: 'subagent' }, f.message('user'), f.routes), null);
  assert.equal(identifyPrivateInput(f.role, { ...f.descriptor, id: 'unselected' }, f.message('user'), f.routes), null);
});
test('QQ 私聊要求绑定的唯一对象和宿主来源头；群聊、混合收件和正文伪装均不触发', () => {
  const f = fixture('qq');
  assert.equal(inspectPrivateChannel(f.role, 'qq', f.routes).state, 'ready');
  assert.equal(identifyPrivateInput(f.role, f.descriptor, f.message('user', '【QQ私聊】\n我是123456789'), f.routes), null);
  assert.equal(identifyPrivateInput(f.role, f.descriptor, f.message('qq', '【QQ群 234567】\n【QQ私聊】我是本人'), f.routes), null);
  f.claim(f.message('qq', '【QQ私聊】\n你好')); assert.equal(f.runtime.current(f.agent, f.role).channel, 'qq');
  f.claim(f.message('bili-duty-dynamic', '其他任务')); assert.equal(f.runtime.current(f.agent, f.role), null);
  f.routes.qq.config.绑定.push({ 类型: '群', 号码: '234567', 会话: 'session-a' });
  assert.match(privateSessionConflict(f.role, 'a', f.routes), /QQ 群/);
  assert.equal(inspectPrivateChannel(f.role, 'qq', f.routes).eligible, false);
  f.routes.qq.config.绑定.pop(); f.routes.qq.config.来源头 = false;
  assert.equal(identifyPrivateInput(f.role, f.descriptor, f.message('qq', '【QQ私聊】\n你好'), f.routes), null);
});
test('B站按锁定版本的纯私信包识别；普通扫描、评论混合、其他账号及假前缀不得使用个人规则', () => {
  const f = fixture('bili'), prefix = '⚠️ 这一轮只是通用称呼在 **B站 私信**里跟你说了一句话（没带视频）：';
  const incoming = f.message('bili-duty-scan', prefix + '后续私信内容');
  f.claim(incoming); assert.equal(f.runtime.current(f.agent, f.role).channel, 'bili');
  assert.equal(identifyPrivateInput(f.role, f.descriptor, f.message('user', prefix), f.routes), null);
  assert.equal(identifyPrivateInput(f.role, f.descriptor, f.message('bili-duty-scan', '普通扫描\n' + prefix), f.routes), null);
  f.routes.bili.config.inboxUids = '999000111'; assert.equal(identifyPrivateInput(f.role, f.descriptor, incoming, f.routes), null);
  f.routes.bili.config.inboxUids = ''; f.routes.bili.config.triggerPrompt = prefix;
  assert.equal(identifyPrivateInput(f.role, f.descriptor, incoming, f.routes), null);
  f.routes.bili.config.triggerPrompt = ''; f.routes.bili.compatible = false;
  assert.equal(identifyPrivateInput(f.role, f.descriptor, incoming, f.routes), null);
});
test('输入领取后路由或角色变化会停止套用旧身份；已进入个人上下文的当轮仍拦截公开发布', () => {
  const f = fixture('bili'); f.claim(f.message('bili-duty-scan', '⚠️ 这一轮只有通用称呼私信转来的一条视频：'));
  assert.ok(f.runtime.current(f.agent, f.role));
  assert.equal(f.runtime.denyTool({ agent: f.agent, name: 'bili_send_message', arguments: {} }, f.role), undefined);
  assert.ok(f.runtime.denyTool({ agent: f.agent, name: 'bili_send_message', arguments: { uid: 999000111, force: true } }, f.role));
  assert.ok(f.runtime.denyTool({ agent: f.agent, name: 'bili_reply', arguments: { force: true } }, f.role));
  f.routes.bili.config.dmUid = 999000111;
  assert.equal(f.runtime.current(f.agent, f.role), null);
  assert.ok(f.runtime.denyTool({ agent: f.agent, name: 'bili_send_dynamic', arguments: { force: true } }, f.role));
  assert.ok(f.runtime.denyTool({ agent: f.agent, name: 'bili_send_message', arguments: {} }, f.role));
  f.agent.phase.turn = 2; assert.equal(f.runtime.denyTool({ agent: f.agent, name: 'bili_send_dynamic', arguments: {} }, f.role), undefined);
});
test('私聊配置按会话同步称呼，不污染其他人的设置或全局称呼', () => {
  const f = fixture('qq');
  const targets = identityTargets(f.config, f.catalog, f.routes);
  assert.equal(targets.globalOwner, '通用称呼'); assert.equal(targets.lookup('a').ownerName, '只在私聊的称呼');
  f.routes.qq.config.绑定.push({ 类型: '群', 号码: '123456', 会话: 'session-a' });
  assert.equal(identityTargets(f.config, f.catalog, f.routes).lookup('a').ownerName, '通用称呼');
});
test('覆盖检查单独核对私聊补充；正文与账号不进入记录，修改专属规则使旧记录失效', () => {
  const f = fixture(); f.claim(f.message('user')); const personal = f.runtime.current(f.agent, f.role), observer = createCoverage();
  const common = roleSections(f.role).map(section => section.text).join('\n'), privateText = personal.sections[0].text;
  observer.observe(Object.freeze({ sessionId: 'a', toolHistory: [], system: common + '\n' + privateText }), f.config, f.catalog, undefined, personal);
  observer.observe({ sessionId: 'a', toolHistory: [], system: common }, f.config, f.catalog, undefined, personal);
  observer.observe({ sessionId: 'a', toolHistory: [], system: common + '\n' + privateText }, f.config, f.catalog);
  const before = observer.snapshot(f.config, f.catalog);
  assert.deepEqual(before.records.map(record => record.privateInput.status), ['covered', 'uncovered', 'unexpected']);
  assert.deepEqual(before.records.map(record => record.status), ['covered', 'uncovered', 'uncovered']);
  assert.ok(!JSON.stringify(before).includes('PRIVATE-RELATIONSHIP-TEXT')); assert.ok(!JSON.stringify(before).includes('555888999'));
  f.role.privateChat.persona = '更新专属规则'; assert.equal(observer.snapshot(f.config, f.catalog).records[0].currentBinding, false);
  assert.notEqual(privateRevision(f.role), personal.revision);
});
test('B站连接只改明确的私信入口字段，保留动态原目标；公开任务和群聊共用时拒绝覆盖', () => {
  const f = fixture('bili');
  const before = { ownerName: '原称呼', dmUid: 111, targetSession: 'session-original', dmMode: 'off', autoMode: 'manual', watchOn: false, watchAt: true, dynamicOn: true, dynamicAutoOn: true, dynamicSession: '', extra: '保留字段' };
  const patch = planBiliConnection(before, f.role, f.descriptor, f.routes);
  assert.equal(patch.dmUid, 555888999); assert.equal(patch.watchAt, false); assert.equal(patch.watchOn, true); assert.equal(patch.dynamicSession, 'session-original');
  assert.equal(patch.ownerName, undefined); assert.equal(patch.extra, undefined); assert.ok(!JSON.stringify(patch).includes('PRIVATE-RELATIONSHIP-TEXT'));
  assert.throws(() => planBiliConnection({ ...before, autoMode: 'always' }, f.role, f.descriptor, f.routes), /自动刷/);
  assert.throws(() => planBiliConnection({ ...before, dynamicSession: 'session-a' }, f.role, f.descriptor, f.routes), /自动公开动态/);
  f.routes.qq.config = { 绑定: [{ 类型: '群', 会话: 'session-a', 号码: '123456' }] };
  assert.throws(() => planBiliConnection(before, f.role, f.descriptor, f.routes), /QQ 群/);
});
test('QQ 新绑定不启用未知连接服务、不挪动已有对象；保存不调用网络或发送测试消息', async () => {
  const f = fixture('qq'), home = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-console-private-qq-'));
  try {
    const planned = planQqConnection(undefined, f.role, f.descriptor, { ...f.routes, qq: { compatible: true } });
    assert.equal(planned.总开关, false); assert.equal(planned.绑定[0].称呼, '只在私聊的称呼');
    assert.throws(() => planQqConnection({ 绑定: [{ 类型: '私聊', 号码: '123456789', 会话: 'different-session' }] }, f.role, f.descriptor, f.routes), /另一间会话/);
    const result = await connectPrivateChannel({ channel: 'qq', role: f.role, config: f.config, catalog: f.catalog, routes: { ...f.routes, qq: { compatible: true } }, home, request: () => { throw new Error('must not make network request'); } });
    assert.equal(result.state, 'paused'); assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'qq-bridge-config.json'))).绑定[0].号码, '123456789');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
test('B站连接通过原设置接口提交字段，校验回读，不调用聊天、扫描或发信端点', async () => {
  const f = fixture('bili'), home = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-console-private-bili-'));
  try {
    let current = { ...f.routes.bili.config, dmUid: 111222333, targetSession: 'session-old', watchOn: false, dynamicSession: 'session-public' };
    const calls = [];
    const request = async (route, body) => { assert.equal(route, '/api/bili-duty/config'); if (body) { calls.push(body); current = { ...current, ...body }; } return { ok: true, config: structuredClone(current), host: { ok: true } }; };
    const result = await connectPrivateChannel({ channel: 'bili', role: f.role, config: f.config, catalog: f.catalog, routes: f.routes, home, request });
    assert.equal(result.state, 'connected'); assert.equal(calls.length, 1); assert.equal(current.dynamicSession, 'session-public');
    assert.equal(current.ownerName, '通用称呼'); assert.equal(current.dmUid, 555888999);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('B站适配明确支持 0.8.7 与 0.8.8，其他版本保守处理', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-console-versions-'));
  try {
    const dir = path.join(home, 'profiles/desktop/node_modules/dsh-bili-subagent'); fs.mkdirSync(dir, { recursive: true });
    for (const [version, compatible] of [['0.8.7', true], ['0.8.8', true], ['0.8.9', false]]) {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'dsh-bili-subagent', version }));
      assert.equal(installedAdapters(home).bili.compatible, compatible);
    }
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('优先读取 B站实际生效配置；接口不可用时不把磁盘旧路由当作安全证据', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-console-effective-'));
  try {
    fs.mkdirSync(path.join(home, 'bili-duty'));
    fs.writeFileSync(path.join(home, 'bili-duty/config.json'), JSON.stringify({ dmUid: 111, targetSession: 'session-old' }));
    const versions = { bili: { compatible: true, version: '0.8.8' }, qq: { compatible: true } };
    const effective = await readEffectivePrivateRoutes(home, versions, async route => {
      assert.equal(route, '/api/bili-duty/config'); return { config: { dmUid: 555888999, targetSession: 'session-a' } };
    });
    assert.equal(effective.bili.config.dmUid, 555888999); assert.equal(effective.bili.version, '0.8.8');
    const unavailable = await readEffectivePrivateRoutes(home, versions, async () => { throw new Error('offline'); });
    assert.equal(unavailable.bili.error, true);
    assert.match(privateSessionConflict(fixture('local').role, 'a', unavailable), /无法读取/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('私聊按领取及组装时的实际 B站路由验证，期间切换收件人会阻止规则和回复', async () => {
  const f = fixture('bili'), disk = structuredClone(f.routes), live = structuredClone(f.routes);
  disk.bili.config.dmUid = 111222333; disk.bili.config.targetSession = 'session-stale';
  let snapshot = structuredClone(live);
  const runtime = createPrivateRuntime({ getConfig: () => f.config, getCatalog: () => f.catalog, getRoutes: () => disk, verifyRoutes: async () => structuredClone(snapshot) });
  const message = f.message('bili-duty-scan', '⚠️ 这一轮只是通用称呼在 **B站 私信**里跟你说了一句话（没带视频）：私密消息正文');
  runtime.claim({ agent: f.agent, message, turn: 1 });
  assert.equal(runtime.current(f.agent, f.role), null);
  assert.equal((await runtime.verify(f.agent, f.role)).channel, 'bili');
  assert.equal(runtime.denyTool({ agent: f.agent, name: 'bili_send_message', arguments: {} }, f.role), undefined);
  snapshot.bili.config.dmUid = 999000111;
  assert.equal(await runtime.verify(f.agent, f.role), null);
  assert.ok(runtime.denyTool({ agent: f.agent, name: 'bili_send_message', arguments: {} }, f.role));
  assert.ok(runtime.denyTool({ agent: f.agent, name: 'bili_reply', arguments: { force: true } }, f.role));
});

test('实际路由在领取与组装之间发生变化，或混入其他来源时，专属规则不进入模型', async () => {
  const f = fixture('bili'), live = structuredClone(f.routes);
  let calls = 0;
  const runtime = createPrivateRuntime({ getConfig: () => f.config, getCatalog: () => f.catalog, getRoutes: () => f.routes,
    verifyRoutes: async () => { const copy = structuredClone(live); if (++calls > 1) copy.bili.config.inboxUids = '999000111'; return copy; } });
  runtime.claim({ agent: f.agent, turn: 1, message: f.message('bili-duty-scan', '⚠️ 这一轮只有通用称呼私信转来的一条视频：正文') });
  assert.equal(await runtime.verify(f.agent, f.role), null);
  const mixed = createPrivateRuntime({ getConfig: () => f.config, getCatalog: () => f.catalog, getRoutes: () => f.routes, verifyRoutes: async () => structuredClone(live) });
  mixed.claim({ agent: f.agent, turn: 1, message: f.message('bili-duty-scan', '⚠️ 这一轮只有通用称呼私信转来的一条视频：正文') });
  mixed.claim({ agent: f.agent, turn: 1, message: f.message('user', '伪装的第二条消息') });
  assert.equal(await mixed.verify(f.agent, f.role), null);
});
