import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8').replace('  function Section() {', '  globalThis.ScreenPageForTest = ScreenPage;\n  function Section() {');
const clone = x => structuredClone(x);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(done => setImmediate(done)); };
function harness({ navigation = true, biliSection = true, dom, observerClass,
  roleSnapshot,
  sessions = [{ id: 'local', title: '专用会话' }, { id: 'other', title: '其他会话' }, { id: 'bili', title: '刷B站内容' }] } = {}) {
  const server = { config: { version: 1, enabled: false, sessions: ['local'] }, revision: 1, capabilities: { openPermissions: true }, posts: [], gets: 0, fail: false, failureMessage: '路由拒绝', saveGate: null, readGate: null, captureGate: null, permissionsResponse: null, screenResponse: null };
  const snapshot = () => ({ ok: true, protocolVersion: 1, runtimeVersion: '0.5.5', capabilities: clone(server.capabilities), config: clone(server.config), baseRevision: String(server.revision), status: { supported: true, available: true, busy: false, lastCapture: null }, screenIssues: clone(server.screenIssues) });
  const rawResponse = ({ status, raw }) => ({ ok: status >= 200 && status < 300, status, text: async () => raw, json: () => { throw new Error('客户端必须先读取响应文本并检查协议'); } });
  const response = value => rawResponse({ status: value.ok === false ? 400 : 200, raw: JSON.stringify(value) });
  const fetch = async (url, options) => {
    if (!options?.method) {
      if (url === '/fish-console/config') return response(roleSnapshot || { ok: true, protocolVersion: 7, baseRevision: 'roles', config: {
        version: 7, roles: [{ id: 'role-default', label: '角色', selfName: '鱼', ownerName: '用户', persona: '测试', privateChat: { enabled: false, ownerName: '', persona: '', localSessions: [], bili: { uid: '', sessionId: '' }, qq: { number: '', sessionId: '' } } }],
        bindings: { workspaces: [] }
      }, sessions: [], workspaces: [] });
      server.gets++; if (server.screenResponse) return rawResponse(server.screenResponse);
      const value = snapshot(); if (server.readGate) { const gate = server.readGate; server.readGate = null; await gate.promise; }
      return response(value);
    }
    const body = JSON.parse(options.body); server.posts.push({ url, body });
    if (url.endsWith('/config')) {
      if (server.saveGate) { const gate = server.saveGate; server.saveGate = null; await gate.promise; }
      if (server.fail) return response({ ok: false, error: server.failureMessage, screenIssues: server.screenIssues });
      if (body.baseRevision !== String(server.revision)) return response({ ok: false, error: '版本冲突' });
      server.config = clone(body.config); server.revision++; return response(snapshot());
    }
    if (url.endsWith('/open-permissions')) return server.permissionsResponse ? rawResponse(server.permissionsResponse) : response({ ok: true, message: '已打开屏幕录制设置' });
    if (url.endsWith('/pause')) { server.config.enabled = false; server.revision++; return response(snapshot()); }
    if (url.endsWith('/capture')) {
      const value = { ...snapshot(), preview: { dataUrl: 'data:image/png;base64,TEST' } };
      if (server.captureGate) { const gate = server.captureGate; server.captureGate = null; await gate.promise; }
      return response(value);
    }
    throw new Error(url);
  };
  let renderer, plugin;
  const registrations = new Map(), navigations = [], globalTimers = new Map(); let globalTimerId = 0;
  const slots = {
    entries(name) {
      if (name === 'sidebar.settings') return navigation ? [{ store: { create: () => ({ actions: { openSection: id => navigations.push(id) } }) } }] : [];
      if (name === 'settings.section') return [{ options: { id: 'fish-console', label: '大肥鱼工作区' } }, ...(biliSection ? [{ options: { id: 'bili-scroll', label: '刷B站' } }] : [])];
      return [];
    },
    inject: (_name, fn) => fn(),
    register(options, component) { registrations.set(options.id || options.name, { options, component }); return () => {}; },
  };
  const React = {
    useState(initial) { const r = renderer, i = r.index++; if (!(i in r.values)) r.values[i] = typeof initial === 'function' ? initial() : initial; return [r.values[i], next => { r.values[i] = typeof next === 'function' ? next(r.values[i]) : next; }]; },
    useRef(initial) { const r = renderer, i = r.index++; if (!(i in r.values)) r.values[i] = { current: initial }; return r.values[i]; },
    useEffect(fn, deps) { const r = renderer, i = r.index++; const old = r.effects[i]; if (!old || !deps || deps.some((x, j) => x !== old.deps[j])) r.scheduled.push(() => { old?.cleanup?.(); r.effects[i] = { deps, cleanup: fn() }; }); },
    useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot(); },
    createElement(type, props, ...children) { return { type, props: props || {}, children }; }
  };
  const sandbox = {
    window: { __ModuleLoader__: { load: spec => { plugin = spec.factory(() => React); } } }, structuredClone, fetch,
    document: dom || { querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} },
    MutationObserver: observerClass || class { observe() {} disconnect() {} },
    setInterval: fn => { const timers = renderer?.timers || globalTimers; const id = ++globalTimerId; timers.set(id, fn); return id; },
    clearInterval: id => { globalTimers.delete(id); for (const r of renderers) r.timers.delete(id); },
    setTimeout: fn => { globalTimers.set(++globalTimerId, fn); return globalTimerId; }, clearTimeout: id => globalTimers.delete(id),
  };
  const renderers = [];
  vm.runInNewContext(source, sandbox);
  plugin.apply({ get: key => key === 'slots' ? slots : undefined, effect: fn => fn() });
  const mount = async (component = sandbox.ScreenPageForTest) => {
    const current = { values: [], index: 0, effects: [], scheduled: [], timers: new Map() }; renderers.push(current);
    let tree;
    const render = () => {
      renderer = current; current.index = 0;
      tree = component({ active: true, sessions });
      const pending = current.scheduled; current.scheduled = []; pending.forEach(fn => fn()); renderer = undefined; return tree;
    };
    const nodes = () => { const out = []; const visit = x => { if (Array.isArray(x)) return x.forEach(visit); if (x && typeof x === 'object') { out.push(x); visit(x.children); } }; visit(tree); return out; };
    const text = x => x == null || x === false ? '' : Array.isArray(x) ? x.map(text).join('') : typeof x === 'object' ? text(x.children) : String(x);
    const button = label => nodes().find(n => n.type === 'button' && text(n) === label);
    const master = () => nodes().find(n => n.type === 'input' && n.props.type === 'checkbox');
    const labels = () => nodes().filter(n => n.type === 'label');
    const ui = { render, master, button, labels, text: () => text(tree), poll: () => [...current.timers.values()].forEach(fn => fn()), unmount: () => current.effects.forEach(e => e?.cleanup?.()) };
    render(); await tick(); render(); return ui;
  };
  return { server, mount, registrations, navigations };
}

test('屏幕总开关及会话勾选即时保存，设置关闭重开仍保留成功结果', async () => {
    const { server, mount } = harness(); let ui = await mount();
    ui.master().props.onChange({ target: { checked: true } }); ui.render(); assert.equal(ui.master().props.checked, false); assert.equal(ui.master().props.disabled, true);
    await tick(); ui.render(); assert.equal(server.config.enabled, true); assert.equal(ui.master().props.checked, true); assert.match(ui.text(), /已即时保存并启用/); assert.equal(server.posts.length, 1);
    ui.unmount(); ui = await mount(); assert.equal(ui.master().props.checked, true);
    const other = ui.labels().find(n => n.children.includes('其他会话')); other.children.find(n => n?.type === 'input').props.onChange({ target: { checked: true } }); await tick(); ui.render(); assert.deepEqual(server.config.sessions, ['local', 'other']);
    assert.ok(server.posts.every(p => p.url === '/fish-console/screen/config')); ui.unmount();
});

test('服务端拒绝时不显示已启用，轮询保留失败原因，允许明确重试', async () => {
    const { server, mount } = harness(); const ui = await mount(); server.fail = true;
    ui.master().props.onChange({ target: { checked: true } }); await tick(); ui.render();
    assert.equal(server.config.enabled, false); assert.equal(ui.master().props.checked, false); assert.match(ui.text(), /未保存：路由拒绝/); assert.ok(ui.button('重试保存屏幕设置')); assert.equal(ui.master().props.disabled, true);
    ui.poll(); await tick(); ui.render(); assert.match(ui.text(), /未保存：路由拒绝/);
    server.fail = false; ui.button('重试保存屏幕设置').props.onClick(); await tick(); ui.render(); assert.equal(server.config.enabled, true); assert.equal(ui.master().props.checked, true); ui.unmount();
});

test('即时保存期间不发新轮询，迟到读取不能覆盖正在保存的状态', async () => {
    const { server, mount } = harness(); const ui = await mount(); const read = deferred(), save = deferred();
    server.readGate = read; ui.poll(); server.saveGate = save;
    ui.master().props.onChange({ target: { checked: true } }); ui.render(); const reads = server.gets; ui.poll(); assert.equal(server.gets, reads);
    read.resolve(); await tick(); ui.render(); assert.equal(ui.master().props.disabled, true);
    save.resolve(); await tick(); ui.render(); assert.equal(ui.master().props.checked, true); ui.unmount();
});

test('立即暂停优先于正在采集的预览，迟到截图不能恢复启用显示', async () => {
    const { server, mount } = harness(); const ui = await mount();
    ui.master().props.onChange({ target: { checked: true } }); await tick(); ui.render();
    const capture = deferred(); server.captureGate = capture; ui.button('立即截图预览').props.onClick(); ui.render();
    ui.button('立即暂停').props.onClick(); await tick(); ui.render(); assert.equal(server.config.enabled, false); assert.match(ui.text(), /已暂停/);
    capture.resolve(); await tick(); ui.render(); assert.equal(ui.master().props.checked, false); assert.ok(!ui.text().includes('已生成本机预览')); ui.unmount();
});

test('立即暂停优先于等待中的启用保存，迟到响应不能恢复旧开关', async () => {
    const { server, mount } = harness(); const ui = await mount(); const save = deferred(); server.saveGate = save;
    ui.master().props.onChange({ target: { checked: true } }); ui.render(); ui.button('立即暂停').props.onClick(); await tick(); ui.render();
    save.resolve(); await tick(); ui.render(); assert.equal(server.config.enabled, false); assert.equal(ui.master().props.checked, false); assert.match(ui.text(), /已暂停/); ui.unmount();

});

test('B站冲突引导只导航到目标页，返回保留待启用设置且由用户明确重试', async () => {
    const { server, mount, registrations, navigations } = harness();
    let ui = await mount(); server.fail = true;
    server.failureMessage = 'B站正在自动选择会话，请先在 B站插件中指定独立目标会话';
    ui.master().props.onChange({ target: { checked: true } }); await tick(); ui.render();
    assert.match(ui.text(), /刷B站 → 日常/); assert.match(ui.text(), /自动刷在哪个会话/);
    assert.match(ui.text(), /刷B站内容/); assert.match(ui.text(), /自动刷会话：已保存/);
    const before = server.posts.length;
    ui.button('带我设置 B站目标会话').props.onClick();
    assert.deepEqual(navigations, ['bili-scroll']); assert.equal(server.posts.length, before);
    assert.equal(server.config.enabled, false); ui.unmount();

    const header = await mount(registrations.get('fish-screen-guide-return').component);
    assert.ok(header.button('返回屏幕感知')); header.button('返回屏幕感知').props.onClick();
    assert.deepEqual(navigations, ['bili-scroll', 'fish-console']); assert.equal(server.posts.length, before);
    header.unmount();
    const section = await mount(registrations.get('fish-console').component);
    assert.equal(section.button('屏幕感知').props['aria-pressed'], true);
    section.unmount();

    ui = await mount();
    assert.equal(ui.master().props.checked, false);
    assert.ok(ui.button('我已设置好，检查并继续启用'));
    assert.equal(server.posts.length, before);
    server.fail = false;
    ui.button('我已设置好，检查并继续启用').props.onClick(); await tick(); ui.render();
    assert.equal(server.posts.length, before + 1); assert.equal(server.config.enabled, true);
    assert.deepEqual(server.posts.at(-1).body.config.sessions, ['local']);
    assert.ok(server.posts.every(post => post.url === '/fish-console/screen/config'));
    assert.ok(!ui.button('我已设置好，检查并继续启用')); ui.unmount();
});

test('导航服务或B站设置页缺失时显示完整手动路径，不提交或丢失待重试设置', async () => {
    for (const options of [{ navigation: false }, { biliSection: false }]) {
      const { server, mount, navigations } = harness(options); const ui = await mount();
      server.fail = true; server.failureMessage = 'B站正在自动选择会话，请先指定独立目标会话';
      ui.master().props.onChange({ target: { checked: true } }); await tick(); ui.render();
      ui.button('带我设置 B站目标会话').props.onClick(); ui.render();
      assert.match(ui.text(), /暂时无法自动跳转/); assert.match(ui.text(), /自动刷在哪个会话/);
      assert.match(ui.text(), /刷B站内容/); assert.deepEqual(navigations, []);
      assert.equal(server.posts.length, 1); assert.equal(server.config.enabled, false);
      assert.ok(ui.button('重试保存屏幕设置')); ui.unmount();
    }
});

test('B站已固定到五间所选会话之一时，显示实际冲突和未勾选的去向，手动改完再启用原名单', async () => {
  const names = ['问候小肥鱼', '插件配置', '身份询问', '问候小肥鱼', 'Managing dsh-bili-subagent plugin', '刷B站内容'];
  const sessions = names.map((title, i) => ({ id: String(i), title }));
  const { server, mount, registrations } = harness({ sessions });
  const selected = sessions.slice(0, 5).map(s => s.id);
  server.config.sessions = selected;
  server.screenIssues = [{ kind: 'bili-target', sessionId: '4', message: '同时被选为屏幕会话和 B站自动刷会话' }];
  let ui = await mount();
  assert.match(ui.text(), /从「Managing dsh-bili-subagent plugin」改为「刷B站内容」/);
  assert.doesNotMatch(ui.text(), /自动挑最近聊过的/);
  ui.button('带我设置 B站目标会话').props.onClick();
  ui.unmount();
  const header = await mount(registrations.get('fish-screen-guide-return').component);
  assert.match(header.text(), /从「Managing dsh-bili-subagent plugin」改为「刷B站内容」/);
  server.screenIssues = []; // The user moves the Bili task in its own settings.
  header.button('返回屏幕感知').props.onClick(); header.unmount();
  ui = await mount();
  assert.equal(server.posts.length, 0);
  ui.button('我已设置好，检查并继续启用').props.onClick(); await tick(); ui.render();
  assert.deepEqual(server.config, { version: 1, enabled: true, sessions: selected });
  assert.deepEqual(server.posts.map(p => p.url), ['/fish-console/screen/config']);
  ui.unmount();
});

test('打开Mac权限设置只发送固定打开动作，不修改屏幕授权或采集屏幕', async () => {
    const { server, mount } = harness(); const ui = await mount();
    const before = clone(server.config);
    ui.button('打开 Mac 屏幕录制设置').props.onClick(); await tick(); ui.render();
    assert.deepEqual(server.config, before); assert.equal(server.posts.length, 1);
    assert.deepEqual(server.posts[0], { url: '/fish-console/screen/open-permissions', body: {} });
    assert.match(ui.text(), /已打开屏幕录制设置/); ui.unmount();
});

test('旧后端未声明权限跳转能力时明确要求完整重启，按钮和处理函数都不发送请求', async () => {
    const { server, mount } = harness(); server.capabilities = undefined;
    const ui = await mount(); const button = ui.button('打开 Mac 屏幕录制设置');
    assert.equal(button.props.disabled, true); assert.match(ui.text(), /应用后端尚未载入此功能/);
    assert.match(ui.text(), /完整退出并重新打开 DeepSeek Harness/); assert.match(ui.text(), /只刷新设置页不够/);
    button.props.onClick(); await tick(); ui.render();
    assert.equal(server.posts.length, 0); assert.equal(server.config.enabled, false); ui.unmount();
});

test('空响应或非JSON响应显示服务诊断，不泄漏解析错误或误报屏幕录制权限问题', async () => {
    for (const reply of [
      { status: 404, raw: '' }, { status: 405, raw: '' },
      { status: 400, raw: '' }, { status: 200, raw: '' },
      { status: 500, raw: '<html>PRIVATE-INTERNAL-ERROR</html>' },
      { status: 200, raw: '{unfinished' },
    ]) {
      const { server, mount } = harness(); const ui = await mount(); const before = clone(server.config);
      server.permissionsResponse = reply;
      ui.button('打开 Mac 屏幕录制设置').props.onClick(); await tick(); ui.render();
      assert.match(ui.text(), /完整退出并重新打开 DeepSeek Harness/);
      if ([404, 405].includes(reply.status)) assert.match(ui.text(), /应用后端尚未载入此功能/);
      assert.doesNotMatch(ui.text(), /Unexpected|JSON input|PRIVATE-INTERNAL-ERROR|unfinished|Failed to execute/);
      assert.doesNotMatch(ui.text(), /无法打开系统设置：|请手动打开 macOS/);
      assert.deepEqual(server.config, before);
      assert.deepEqual(server.posts, [{ url: '/fish-console/screen/open-permissions', body: {} }]); ui.unmount();
    }
});

test('真实系统打开失败的JSON业务错误仍保留手动设置路径', async () => {
    const { server, mount } = harness(); const ui = await mount();
    server.permissionsResponse = { status: 400, raw: JSON.stringify({ ok: false, error: '系统设置未能启动' }) };
    ui.button('打开 Mac 屏幕录制设置').props.onClick(); await tick(); ui.render();
    assert.match(ui.text(), /系统设置未能启动/); assert.match(ui.text(), /请手动打开 macOS/);
    assert.doesNotMatch(ui.text(), /应用后端尚未载入此功能/); ui.unmount();
});

test('读取控制台空或非JSON结果时给出友好错误，不向页面抛原始JSON解析异常', async () => {
    for (const reply of [{ status: 200, raw: '' }, { status: 500, raw: '<html>INTERNAL-HTML</html>' }]) {
      const { server, mount } = harness(); server.screenResponse = reply; const ui = await mount();
      assert.match(ui.text(), /控制台服务/); assert.match(ui.text(), /完整退出并重新打开 DeepSeek Harness/);
      assert.doesNotMatch(ui.text(), /Unexpected|INTERNAL-HTML|Failed to execute/); assert.equal(server.posts.length, 0); ui.unmount();
    }
});

test('B站引导只滚动并聚焦正确字段，返回或结束时恢复高亮且不更改选择值', async () => {
    for (const completion of ['返回屏幕感知', '结束引导']) {
      const calls = { scroll: [], focus: [], observers: [], notes: [], removed: false };
      const select = { value: 'existing-bili-session', focus: options => calls.focus.push(clone(options)), before: note => calls.notes.push(note) };
      const section = {
        style: { outline: '1px solid original', outlineOffset: '2px' },
        querySelector: selector => selector === '[data-bd-h]' ? { textContent: ' 自动刷在哪个会话 ' } : selector === 'select[data-bd-input]' ? select : null,
        scrollIntoView: options => calls.scroll.push(clone(options)),
      };
      const unrelated = { querySelector: selector => selector === '[data-bd-h]' ? { textContent: '另一个设置' } : null };
      const panel = { querySelectorAll: selector => {
        assert.equal(selector, '[data-bd-sec][data-bd-in="daily"]');
        return [unrelated, section];
      } };
      const dom = { body: {}, createElement: () => ({ style: {}, setAttribute() {}, remove() { calls.removed = true; } }), querySelector: selector => {
        assert.equal(selector, '[data-shortcut-modal="settings"]'); return panel;
      } };
      const observerClass = class {
        constructor() { this.disconnected = 0; calls.observers.push(this); }
        observe(target, options) { assert.equal(target, dom.body); assert.equal(options.childList, true); assert.equal(options.subtree, true); }
        disconnect() { this.disconnected++; }
      };
      const { server, mount, registrations } = harness({ dom, observerClass });
      const ui = await mount(); server.fail = true;
      server.failureMessage = 'B站正在自动选择会话，请先指定独立目标会话';
      ui.master().props.onChange({ target: { checked: true } }); await tick(); ui.render();
      ui.button('带我设置 B站目标会话').props.onClick();
      assert.deepEqual(calls.scroll, [{ block: 'center', behavior: 'smooth' }]);
      assert.deepEqual(calls.focus, [{ preventScroll: true }]);
      assert.match(calls.notes[0].textContent, /自动挑最近聊过的.*改为「刷B站内容」/);
      assert.equal(select.value, 'existing-bili-session'); assert.equal(section.style.outline, '2px solid #8ab4f8');
      assert.equal(calls.observers.length, 1); assert.equal(calls.observers[0].disconnected, 1);
      const header = await mount(registrations.get('fish-screen-guide-return').component);
      header.button(completion).props.onClick();
      assert.equal(calls.removed, true);
      assert.deepEqual(section.style, { outline: '1px solid original', outlineOffset: '2px' });
      assert.ok(calls.observers[0].disconnected >= 2); assert.equal(select.value, 'existing-bili-session');
      assert.equal(server.posts.length, 1); assert.equal(server.config.enabled, false);
      header.unmount(); ui.unmount();
    }
});

test('角色页只按工作区绑定，私聊选择不创建会话覆盖且限制到当前角色工作区', async () => {
  const { defaultConfig } = await import('../lib/roles.js');
  const config = defaultConfig(); config.bindings.workspaces = [{ workspace: '/a', roleId: 'role-default' }];
  const roleSnapshot = { ok: true, protocolVersion: 7, baseRevision: 'roles', config,
    workspaces: [{ path: '/a', title: '工作区 A', available: true }, { path: '/b', title: '工作区 B', available: true }],
    sessions: [{ id: 'a', title: '私聊 A', workspace: '/a' }, { id: 'b', title: '私聊 B', workspace: '/b' }] };
  const { mount, registrations, server } = harness({ roleSnapshot });
  const ui = await mount(registrations.get('fish-console').component);
  assert.equal(ui.button('工具权限'), undefined);
  ui.button('工作区绑定').props.onClick(); ui.render();
  assert.ok(!ui.text().includes('会话单独绑定')); assert.ok(!ui.text().includes('搜索会话'));
  assert.equal(ui.labels().filter(n => n.children.some(c => c?.type === 'input' && c.props.type === 'checkbox')).length, 2);
  ui.button('与我私聊').props.onClick(); ui.render();
  const checkbox = title => ui.labels().find(n => n.children.includes(title)).children.find(n => n?.type === 'input');
  assert.equal(checkbox('私聊 A').props.disabled, false); assert.equal(checkbox('私聊 B').props.disabled, true);
  checkbox('私聊 A').props.onChange(); ui.render();
  await ui.button('保存控制台设置').props.onClick();
  const sent = server.posts[0].body.config;
  assert.deepEqual(sent.bindings, { workspaces: config.bindings.workspaces });
  assert.deepEqual(sent.roles[0].privateChat.localSessions, ['a']);
  assert.equal(Object.hasOwn(sent.bindings, 'sessions'), false); ui.unmount();
});

test('旧版控制台协议只提示刷新，不能继续编辑或保存工具策略', async () => {
  const { mount, registrations } = harness({ roleSnapshot: { ok: true, protocolVersion: 6, config: { toolPolicies: [] } } });
  const ui = await mount(registrations.get('fish-console').component);
  assert.match(ui.text(), /接口已升级/);
  assert.equal(ui.button('保存控制台设置'), undefined); assert.equal(ui.button('工具权限'), undefined);
  ui.unmount();
});

test('只在工作区设置提供桌宠入口，不再注册聊天输入框角色面板', async () => {
  const { registrations, mount } = harness();
  assert.equal([...registrations.values()].some(entry => entry.options.name === 'conversation.input.dock'), false);
  const ui = await mount(registrations.get('fish-console').component);
  assert.ok(ui.button('桌宠'));
  ui.button('桌宠').props.onClick(); ui.render();
  assert.match(ui.text(), /桌宠设置在下方直接生效/);
  ui.unmount();
});
