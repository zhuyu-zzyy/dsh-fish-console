import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanScreenConfig, createScreenService, screenRouteIssues, SCREEN_TOOL } from '../lib/screen.js';

const imageBytes = Buffer.from('SYNTHETIC-SCREEN-CONTENT-NOT-A-REAL-SCREEN');
const imageFrame = () => ({ data: imageBytes, mediaType: 'image/png', width: 1200, height: 800 });
const agent = id => ({ session: { id, header: { cwd: os.tmpdir() }, requestHeader: () => ({ config: { provider: 'test-provider', model: 'vision-test' } }) }, phase: { kind: 'running', turn: 1 } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function fixture(fn, initial) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-screen-service-test-'));
  const file = path.join(home, 'fish-console', 'screen.json');
  if (initial !== undefined) { fs.mkdirSync(path.dirname(file)); fs.writeFileSync(file, typeof initial === 'string' ? initial : JSON.stringify(initial)); }
  const local = agent('local'), other = agent('other'), child = agent('child'); child.session.header.parentSession = 'local';
  const agents = [local, other, child], entries = new Map(agents.map(a => [a.session.id, { id: a.session.id, parentId: a.session.header.parentSession || '', live: true }]));
  const calls = { capture: 0, saveImage: 0, resolve: [], verify: [], unregister: 0 };
  let spec, mode = ['text', 'image'], captureImpl = async () => imageFrame(), resolveImpl, verifyImpl = async () => '', saveImageImpl;
  const attachments = { saveImage: async value => {
    calls.saveImage++; assert.deepEqual(value.data, imageBytes);
    if (saveImageImpl) await saveImageImpl();
    return { attachmentId: 'synthetic-image', mediaType: value.mediaType, width: 1200, height: 800, bytes: value.data.length };
  } };
  const llm = { resolveModelInfo: async (provider, model, signal) => {
    calls.resolve.push({ provider, model, signal });
    return resolveImpl ? resolveImpl() : { inputModalities: mode };
  } };
  const ctx = { get: key => ({ attachments, llm })[key], tools: {
    guard: () => {}, register: tool => { spec = tool; return () => { calls.unregister++; }; },
  } };
  const getCatalog = () => ({ lookup: id => entries.get(id), isLive: a => agents.includes(a) });
  let toolDenied = false;
  const service = createScreenService({ ctx, home, getCatalog, isToolDenied: () => toolDenied,
    getRouteIssues: async ids => {
      const issues = [];
      for (const id of ids) {
        calls.verify.push(id);
        const message = await verifyImpl(id);
        if (message) issues.push({ kind: 'unavailable', message });
      }
      return issues;
    },
    capture: { supported: true, capture: async options => { calls.capture++; return captureImpl(options); } } });
  const claim = (a = local, kind = 'user', turn = a.phase.turn) => service.claim({ agent: a, turn, message: { role: 'user', source: { kind }, content: 'text is not identity evidence' } });
  const enable = async (sessions = ['local']) => service.save({ version: 1, enabled: true, sessions }, service.snapshot().baseRevision);
  const execute = (a = local) => spec.execute({}, { agent: a, signal: new AbortController().signal });
  try {
    await fn({ service, file, calls, local, other, child, agents, entries, ctx, getCatalog, spec, claim, enable, execute,
      textOnly: () => { mode = ['text']; }, setCapture: fn => { captureImpl = fn; }, setResolve: fn => { resolveImpl = fn; },
      setVerify: fn => { verifyImpl = fn; }, setSaveImage: fn => { saveImageImpl = fn; }, denyTool: () => { toolDenied = true; } });
  } finally { service.dispose(); fs.rmSync(home, { recursive: true, force: true }); }
}

test('默认禁用不采集，未启用工具不可见；授权本机当前轮返回原生图片与时间', async () => fixture(async f => {
  assert.equal(f.spec.name, SCREEN_TOOL); assert.equal(f.service.snapshot().config.enabled, false); assert.equal(f.calls.capture, 0);
  const assembly = { sections: [], tools: [{ name: SCREEN_TOOL }, { name: 'remember' }] };
  assert.deepEqual(f.service.filterAssembly(assembly, f.local).tools, [{ name: 'remember' }]);
  await assert.rejects(f.execute(), /暂停/); assert.equal(f.calls.capture, 0);
  await f.enable(); f.claim();
  assert.equal(f.service.filterAssembly(assembly, f.local).tools, assembly.tools);
  const result = await f.execute();
  assert.equal(result.source, 'main-display'); assert.ok(!Number.isNaN(Date.parse(result.capturedAt)));
  assert.equal(result.image.attachmentId, 'synthetic-image'); assert.equal(f.calls.capture, 1); assert.equal(f.calls.saveImage, 1);
  assert.equal(f.calls.resolve[0].provider, 'test-provider'); assert.equal(f.calls.resolve[0].model, 'vision-test');
  const rendered = f.spec.output.render({}, result);
  assert.equal(rendered[1].type, 'image'); assert.equal(rendered[1].attachment, result.image);
  assert.equal(f.service.snapshot().status.lastCapture.delivery, 'model');
  assert.equal(f.service.snapshot().status.lastCapture.sessionId, 'local');
  const saved = fs.readFileSync(f.file, 'utf8');
  assert.deepEqual(JSON.parse(saved), { version: 1, enabled: true, sessions: ['local'] });
  assert.ok(!saved.includes(imageBytes.toString())); assert.ok(!saved.includes(imageBytes.toString('base64')));
}));

test('未授权会话、子代理、伪装代理及工作区关闭工具时均在采集前拒绝', async () => fixture(async f => {
  await f.enable(); f.claim(f.local); f.claim(f.other); f.claim(f.child);
  await assert.rejects(f.execute(f.other), /授权/);
  await assert.rejects(f.execute(f.child), /授权|子代理/);
  const spoof = { ...f.local, session: { ...f.local.session } }; f.claim(spoof);
  await assert.rejects(f.execute(spoof), /授权/);
  f.local.session.header.parentSession = 'parent';
  await assert.rejects(f.execute(), /子代理/); delete f.local.session.header.parentSession;
  f.local.session.header.delegationDepth = 1;
  await assert.rejects(f.execute(), /子代理/); delete f.local.session.header.delegationDepth;
  f.entries.set('local', { id: 'local', ambiguous: true });
  await assert.rejects(f.execute(), /授权/); f.entries.set('local', { id: 'local' });
  f.denyTool(); await assert.rejects(f.execute(), /关闭/);
  assert.equal(f.calls.capture, 0); assert.equal(f.calls.resolve.length, 0);
}));

test('平台消息混入、后台输入、旧轮次和新授权均不能沿用本机输入证据', async () => fixture(async f => {
  await f.enable(); f.claim(); f.claim(f.local, 'qq');
  await assert.rejects(f.execute(), /本机用户/);
  f.local.phase.turn = 2; f.claim(f.local, 'schedule');
  await assert.rejects(f.execute(), /本机用户/);
  f.local.phase.turn = 3; f.claim();
  f.local.phase.turn = 4;
  await assert.rejects(f.execute(), /本机用户/);
  f.claim(); await f.enable(['local', 'other']);
  await assert.rejects(f.execute(), /本机用户/);
  f.local.phase.turn = 5; f.claim(); f.local.phase.kind = 'idle';
  await assert.rejects(f.execute(), /本机用户/);
  assert.equal(f.calls.capture, 0); assert.equal(f.calls.resolve.length, 0);
}));

test('对话结束、下一轮等待输入和插件重载不关闭已保存的屏幕总开关', async () => fixture(async f => {
  await f.enable(); f.claim();
  const assembly = { sections: [], tools: [{ name: SCREEN_TOOL }] };
  assert.equal(f.service.filterAssembly(assembly, f.local).tools.length, 1);
  const saved = fs.readFileSync(f.file);
  f.local.phase.kind = 'idle';
  assert.equal(f.service.filterAssembly(assembly, f.local).tools.length, 0);
  assert.equal(f.service.snapshot().config.enabled, true);
  assert.deepEqual(fs.readFileSync(f.file), saved);
  f.local.phase = { kind: 'running', turn: 2 };
  assert.equal(f.service.filterAssembly(assembly, f.local).tools.length, 0);
  assert.equal(f.service.snapshot().config.enabled, true);
  assert.deepEqual(fs.readFileSync(f.file), saved);
  f.service.dispose();
  assert.deepEqual(fs.readFileSync(f.file), saved);
  const reloaded = createScreenService({ ctx: f.ctx, home: path.dirname(path.dirname(f.file)), getCatalog: f.getCatalog,
    capture: { supported: true, capture: async () => assert.fail('lifecycle checks must not capture screen') } });
  try {
    assert.deepEqual(reloaded.snapshot().config, { version: 1, enabled: true, sessions: ['local'] });
    assert.equal(reloaded.filterAssembly(assembly, f.local).tools.length, 0);
    assert.deepEqual(fs.readFileSync(f.file), saved);
    assert.equal(f.calls.capture, 0); assert.equal(f.calls.saveImage, 0);
  } finally { reloaded.dispose(); }
}));

test('正文自称本人不能获得屏幕权限；内部上下文不计作用户输入', async () => fixture(async f => {
  await f.enable();
  for (const kind of ['runtime-context', 'tool-registry']) f.claim(f.local, kind);
  await assert.rejects(f.execute(), /本机用户/);
  f.claim(f.local, 'bili-duty-scan');
  await assert.rejects(f.execute(), /本机用户/);
  assert.equal(f.calls.capture, 0);
}));

test('纯文本模型在截图前拒绝；模型检查期间轮次变化也不采集', async () => fixture(async f => {
  await f.enable(); f.claim(); f.textOnly();
  await assert.rejects(f.execute(), /未声明支持图片/); assert.equal(f.calls.capture, 0);
  const gate = deferred(), entered = deferred();
  f.setResolve(async () => { entered.resolve(); return gate.promise; });
  const request = f.execute(); await entered.promise;
  f.local.phase.turn = 2; gate.resolve({ inputModalities: ['image'] });
  await assert.rejects(request, /本机用户/); assert.equal(f.calls.capture, 0); assert.equal(f.calls.saveImage, 0);
}));

test('本机预览不调用模型或附件存储；暂停清空旧预览并阻止后续截图', async () => fixture(async f => {
  await f.enable();
  const result = await f.service.capturePreview(f.service.snapshot().baseRevision);
  assert.ok(result.preview.dataUrl.endsWith(imageBytes.toString('base64')));
  assert.equal(result.status.lastCapture.delivery, 'preview'); assert.equal(f.calls.resolve.length, 0); assert.equal(f.calls.saveImage, 0);
  f.service.pause(); assert.equal(f.service.preview(), null); assert.equal(f.service.snapshot().config.enabled, false);
  await assert.rejects(f.service.capturePreview(f.service.snapshot().baseRevision), /暂停/); assert.equal(f.calls.capture, 1);
  assert.equal(JSON.parse(fs.readFileSync(f.file)).enabled, false);
}));

test('暂停和保存授权都取消在途截图，即使采集器忽略取消也不返回图片', async () => {
  for (const action of ['pause', 'save']) await fixture(async f => {
    await f.enable(); f.claim();
    const entered = deferred(), gate = deferred(); let activeSignal;
    f.setCapture(async ({ signal }) => { activeSignal = signal; entered.resolve(); await gate.promise; return imageFrame(); });
    const request = f.execute(); await entered.promise;
    assert.equal(f.service.snapshot().status.busy, true);
    await assert.rejects(f.service.capturePreview(f.service.snapshot().baseRevision), /正在采集/);
    if (action === 'pause') f.service.pause(); else await f.enable(['other']);
    assert.equal(activeSignal.aborted, true); assert.equal(f.service.preview(), null);
    gate.resolve(); await assert.rejects(request, /取消/);
    assert.equal(f.calls.saveImage, 0); assert.equal(f.service.preview(), null); assert.equal(f.service.snapshot().status.busy, false);
  });
});

test('配置 CAS 拒绝旧页面与磁盘并发保存；紧急暂停保留磁盘最新授权名单', async () => fixture(async f => {
  const original = f.service.snapshot().baseRevision;
  await f.enable();
  await assert.rejects(f.service.save({ version: 1, enabled: true, sessions: ['other'] }, original), { httpStatus: 409 });
  const current = f.service.snapshot().baseRevision;
  const concurrent = { version: 1, enabled: true, sessions: ['other'] };
  fs.writeFileSync(f.file, JSON.stringify(concurrent));
  await assert.rejects(f.service.save({ version: 1, enabled: false, sessions: ['local'] }, current), { httpStatus: 409 });
  assert.deepEqual(JSON.parse(fs.readFileSync(f.file)), concurrent);
  const paused = f.service.pause();
  assert.deepEqual(paused.config, { version: 1, enabled: false, sessions: ['other'] });
  assert.deepEqual(JSON.parse(fs.readFileSync(f.file)), paused.config); assert.equal(f.calls.capture, 0);
}));

test('损坏或未来版本配置保持停用且不覆盖原文件', async () => {
  for (const initial of ['{broken-PRIVATE-CONFIG', { version: 2, enabled: true, sessions: ['local'] }]) await fixture(async f => {
    const before = fs.readFileSync(f.file);
    assert.equal(f.service.snapshot().config.enabled, false); assert.match(f.service.snapshot().status.lastError, /读取失败/);
    f.claim(); await assert.rejects(f.execute(), /暂停/);
    await assert.rejects(f.enable(), /读取失败/); f.service.pause();
    assert.deepEqual(fs.readFileSync(f.file), before); assert.equal(f.calls.capture, 0);
    assert.ok(!JSON.stringify(f.service.snapshot()).includes('PRIVATE-CONFIG'));
  }, initial);
});

test('新授权只接受已知且非歧义的独立会话；规范化后的空标识及重复值拒绝', async () => fixture(async f => {
  await assert.rejects(f.enable(['missing']), /已知/);
  await assert.rejects(f.enable(['child']), /子代理/);
  f.entries.set('other', { id: 'other', ambiguous: true });
  await assert.rejects(f.enable(['other']), /归属不明/);
  assert.throws(() => cleanScreenConfig({ version: 1, enabled: true, sessions: ['local', 'session-local'] }), /重复/);
  assert.throws(() => cleanScreenConfig({ version: 1, enabled: true, sessions: ['session-'] }), /会话/);
  assert.equal(f.calls.capture, 0);
}));

test('暂停后重新启用相同授权名单，旧轮次仍拒绝；新用户轮次可以再次查看', async () => fixture(async f => {
  await f.enable(); f.claim();
  await f.execute(); assert.equal(f.calls.capture, 1);
  f.service.pause(); await f.enable();
  await assert.rejects(f.execute(), /本机用户/); assert.equal(f.calls.capture, 1);
  // Even another claim in the old turn cannot revive a claim from before pause.
  f.claim(); await assert.rejects(f.execute(), /本机用户/); assert.equal(f.calls.capture, 1);
  f.local.phase.turn = 2; f.claim();
  await f.execute(); assert.equal(f.calls.capture, 2);
}));

test('等待会话核验时紧急暂停，原本已停用的配置也不能被等待中的保存重新启用', async () => fixture(async f => {
  const entered = deferred(), gate = deferred();
  f.setVerify(async () => { entered.resolve(); return gate.promise; });
  const before = f.service.snapshot(); assert.equal(before.config.enabled, false);
  const saving = f.service.save({ version: 1, enabled: true, sessions: ['local'] }, before.baseRevision);
  await entered.promise; f.service.pause(); gate.resolve('');
  await assert.rejects(saving, { httpStatus: 409 });
  assert.equal(f.service.snapshot().config.enabled, false);
  assert.equal(JSON.parse(fs.readFileSync(f.file)).enabled, false); assert.equal(f.calls.capture, 0);
}));

test('平台路由核验冲突拒绝保存及工具采集，且不改动已保存配置', async () => fixture(async f => {
  await f.enable(); f.claim();
  const before = fs.readFileSync(f.file);
  f.setVerify(async id => { assert.equal(id, 'local'); return '该会话已连接 QQ'; });
  await assert.rejects(f.enable(), /QQ/);
  assert.deepEqual(fs.readFileSync(f.file), before);
  await assert.rejects(f.execute(), /QQ/);
  assert.equal(f.calls.capture, 0); assert.equal(f.calls.resolve.length, 0); assert.equal(f.calls.saveImage, 0);
}));

test('采集后或存储后平台路由发生改变，当前结果与预览均不返回图片', async () => {
  for (const stage of ['captured', 'stored']) await fixture(async f => {
    await f.enable(); f.claim();
    let conflict = '';
    f.setVerify(async () => conflict);
    if (stage === 'captured') f.setCapture(async () => { conflict = '截图期间会话连接到 B站'; return imageFrame(); });
    else f.setSaveImage(async () => { conflict = '存储期间会话连接到 QQ'; });
    await assert.rejects(f.execute(), /会话连接/);
    assert.equal(f.calls.capture, 1); assert.equal(f.calls.saveImage, stage === 'stored' ? 1 : 0);
    assert.equal(f.service.preview(), null); assert.equal(f.service.snapshot().status.lastCapture, null);
  });
});

test('屏幕会话路由排除 QQ 私聊与群、B站任务及动态目标；正常独立会话允许', () => {
  const cases = [
    { qq: { config: { 绑定: [{ 类型: '私聊', 号码: '123', 会话: 'session-local' }] } } },
    { qq: { config: { 绑定: [{ 类型: '群', 号码: '456', 会话: 'local' }] } } },
    { qq: { config: { 私聊QQ: '123', 私聊会话: 'local' } } },
    { qq: { config: { 群号: '456', 群会话: 'local' } } },
    { bili: { config: { targetSession: 'session-local', autoMode: 'manual' } } },
    { bili: { config: { targetSession: 'other', dynamicSession: 'session-local' } } },
    { bili: { config: { watchOn: true } } },
    { bili: { config: { autoMode: 'valley' } } },
  ];
  for (const routes of cases) assert.ok(screenRouteIssues(['local'], routes).length, JSON.stringify(routes));
  assert.deepEqual(screenRouteIssues(['local'], {}), []);
  assert.deepEqual(screenRouteIssues(['local'], { qq: { config: { 绑定: [{ 类型: '私聊', 会话: 'other' }] } }, bili: { config: { targetSession: 'other', dynamicSession: 'another', autoMode: 'manual' } } }), []);
});

test('平台路由读取错误或 QQ 未知绑定格式均不能当作独立会话', () => {
  for (const routes of [
    { qq: { error: true } }, { bili: { error: true } },
    { qq: { config: { 绑定: 'unknown' } } }, { qq: { config: { 绑定: [null] } } },
  ]) assert.match(screenRouteIssues(['local'], routes)[0].message, /无法确认|格式未知/);
});

test('多选屏幕会话时指明具体冲突和字段，目标移走后原勾选可以通过', () => {
  const ids = ['a', 'b', 'c', 'd', 'managing'];
  const routes = { bili: { config: { targetSession: 'session-managing', dynamicSession: 'session-bili', autoMode: 'always' } } };
  const issues = () => screenRouteIssues(ids, routes).map(({ kind, sessionId }) => [kind, sessionId]);
  assert.deepEqual(issues(), [['bili-target', 'managing']]);
  routes.bili.config.dynamicSession = 'session-d';
  assert.deepEqual(issues(), [['bili-target', 'managing'], ['bili-dynamic', 'd']]);
  routes.bili.config.targetSession = routes.bili.config.dynamicSession = 'session-bili';
  assert.deepEqual(issues(), []);
  routes.bili.config.targetSession = '';
  assert.deepEqual(issues(), [['bili-automatic', undefined]]);
});
