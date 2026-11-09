import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopSettings } from '../lib/avatar/desktop-settings.js';
import { installDesktopBridge } from '../lib/avatar/desktop-client.js';

const tick = () => new Promise(setImmediate);
const text = node => node == null || node === false ? '' : Array.isArray(node) ? node.map(text).join('')
  : typeof node === 'object' ? text(node.children) : String(node);
function mount(Component, props) {
  const values = [], effects = [], queued = [];
  let index, tree;
  const React = {
    createElement(type, props, ...children) { return { type, props: props || {}, children }; },
    useState(initial) { const i = index++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial;
      return [values[i], next => { values[i] = typeof next === 'function' ? next(values[i]) : next; }]; },
    useRef(initial) { const [value] = React.useState({ current: initial }); return value; },
    useEffect(fn, deps) { const i = index++, old = effects[i];
      if (!old || deps.some((value, j) => value !== old.deps[j])) queued.push(() => { old?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; }); },
  };
  const View = Component(React);
  const render = () => { index = 0; tree = View(props); queued.splice(0).forEach(fn => fn()); };
  const nodes = () => { const result = []; const walk = node => {
    if (Array.isArray(node)) node.forEach(walk); else if (node && typeof node === 'object') { result.push(node); walk(node.children); }
  }; walk(tree); return result; };
  render();
  return { render, nodes, text: () => text(tree), button: label => nodes().find(node => node.type === 'button' && text(node) === label),
    input: type => nodes().find(node => node.type === 'input' && node.props.type === type),
    select: label => nodes().find(node => node.type === 'label' && text(node).startsWith(label)).children.find(node => node?.type === 'select'),
    unmount: () => effects.forEach(effect => effect?.cleanup?.()) };
}

test('工作区设置使用桌宠真实状态，无需会话选择、保存轮换、远程缩放并保留失败草稿', async t => {
  let source, closed = 0, fail = false;
  const calls = [];
  let state = { protocolVersion: 3, supported: true, opened: true, global: true, sessionId: 'session-A', lastSessionId: 'session-A', generation: 1,
    ready: true, controls: true, desktopByDefault: true, rotation: { swing: 160, eat_rice: 20 },
    view: { scale: 100, mode: 'swing', scene: 'swing', expression: 'auto', state: 'IDLE', voice: false } };
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    if (options?.method !== 'POST') return { ok: true, json: async () => structuredClone(state) };
    const data = JSON.parse(options.body); calls.push(data);
    if (fail) return { ok: false, json: async () => ({ error: '模拟保存失败' }) };
    if (data.action === 'open') state = { ...state, opened: true };
    if (data.action === 'close') state = { ...state, opened: false };
    if (data.action === 'setRotation') state = { ...state, rotation: data.value };
    if (data.action === 'control') state = { ...state, view: { ...state.view, [data.name]: data.value } };
    return { ok: true, json: async () => structuredClone(state) };
  });
  const previous = globalThis.EventSource;
  globalThis.EventSource = class { constructor() { source = this; } close() { closed++; } };
  t.after(() => { globalThis.EventSource = previous; });
  const ui = mount(desktopSettings, { active: true, sessions: [{ id: 'A', nativeId: 'session-A', title: '会话 A' }, { id: 'B', nativeId: 'session-B', title: '会话 B' }] });
  let unmounted = false; t.after(() => { if (!unmounted) ui.unmount(); });
  source.onmessage({ data: JSON.stringify(state) }); ui.render(); ui.render();
  assert.match(ui.text(), /会话 A/);
  assert.equal(ui.button('保存轮换时间').props.disabled, true);
  const options = ui.select('场景表情').children.flat();
  assert.equal(options.find(node => node.props.value === 'action:blink').props.disabled, true);
  assert.equal(options.find(node => node.props.value === 'random').props.disabled, false);
  assert.ok(!ui.nodes().some(node => node.type === 'label' && text(node).includes('跟随会话')));
  await ui.button('显示桌宠').props.onClick(); ui.render();
  assert.deepEqual(calls.at(-1), { action: 'open' });
  const slider = ui.input('range'); slider.props.onChange({ target: { value: '55' } }); ui.render();
  assert.equal(calls.length, 1, '拖动时保留草稿，松开才提交');
  await ui.input('range').props.onPointerUp(); ui.render();
  assert.deepEqual(calls.at(-1), { action: 'control', generation: 1, name: 'scale', value: 55 });
  assert.match(ui.text(), /55%/);
  const number = () => ui.nodes().filter(node => node.type === 'input' && node.props.type === 'number');
  number()[0].props.onChange({ target: { value: '180' } }); ui.render();
  assert.equal(ui.button('保存轮换时间').props.disabled, false);
  assert.match(ui.text(), /轮换时间有未保存修改/);
  source.onmessage({ data: JSON.stringify({ ...state, rotation: { swing: 200, eat_rice: 25 } }) }); ui.render(); ui.render();
  assert.equal(number()[0].props.value, '180', '后台更新不能冲掉未保存输入');
  fail = true; await ui.button('保存轮换时间').props.onClick(); ui.render();
  assert.match(ui.text(), /模拟保存失败/); assert.equal(number()[0].props.value, '180');
  fail = false; await ui.button('保存轮换时间').props.onClick(); ui.render();
  assert.deepEqual(calls.at(-1).value, { swing: 180, eat_rice: 20 });
  assert.match(ui.text(), /轮换时间已保存/);
  assert.equal(ui.button('保存轮换时间').props.disabled, true);
  source.onmessage({ data: JSON.stringify({ ...state, view: { ...state.view, state: 'LISTENING' } }) }); ui.render();
  assert.equal(ui.select('待机场景').props.disabled, true);
  assert.equal(ui.select('场景表情').children.flat().find(node => node.props.value === 'happy').props.disabled, true);
  ui.unmount(); unmounted = true; assert.equal(closed, 1);
});

test('无聊天角色面板时自动打开与麦克风联动仍有效，收回后不再自动打开，卸载清理监听', async () => {
  let observer, listener;
  const calls = [], events = new Map();
  let recording = false, focus = true;
  const pane = { dataset: { conversationSession: 'session-A' }, getClientRects: () => [1], contains: target => target === pane,
    querySelector: () => ({ querySelector: () => recording ? {} : null }) };
  const doc = { hidden: false, body: {}, activeElement: pane, hasFocus: () => focus, querySelectorAll: () => [pane],
    addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name) };
  const win = { addEventListener: (name, fn) => events.set('win-' + name, fn), removeEventListener: name => events.delete('win-' + name) };
  let disconnected = false, stopped = false;
  const stop = installDesktopBridge({ doc, win,
    Observer: class { constructor(fn) { observer = fn; } observe() {} disconnect() { disconnected = true; } },
    watch: fn => { listener = fn; return () => { stopped = true; }; }, action: async data => { calls.push(data); } });
  listener({ canAutoOpen: true, sessionId: null }); await tick();
  assert.deepEqual(calls, [{ action: 'foreground', sessionId: 'session-A' }, { action: 'autoOpen' }]);
  listener({ canAutoOpen: false, sessionId: 'session-A', generation: 1 }); await tick();
  recording = true; observer(); await tick();
  assert.deepEqual(calls.at(-1), { action: 'listen', sessionId: 'session-A', generation: 1, value: true });
  doc.hidden = true; events.get('visibilitychange')(); await tick(); assert.equal(calls.at(-1).value, false);
  doc.hidden = false; listener({ canAutoOpen: false, sessionId: null }); observer(); await tick();
  assert.equal(calls.filter(call => call.action === 'autoOpen').length, 1);
  focus = false; listener({ canAutoOpen: true, sessionId: null }); await tick();
  assert.equal(calls.filter(call => call.action === 'autoOpen').length, 1);
  stop(); assert.equal(events.size, 0); assert.ok(disconnected && stopped);
});

test('宿主事件流中断时仍刷新真实桌宠状态，迟到读取不能覆盖新事件', async t => {
  const { watchDesktop } = await import('../lib/avatar/desktop-client.js?v=0.15.0');
  let source, poll, state = { sessionId: null }, gate, opens = 0, closes = 0, clears = 0;
  const previous = globalThis.EventSource;
  globalThis.EventSource = class { constructor() { source = this; opens++; } close() { closes++; } };
  t.after(() => { globalThis.EventSource = previous; });
  t.mock.method(globalThis, 'setInterval', fn => { poll = fn; return 1; });
  t.mock.method(globalThis, 'clearInterval', () => { clears++; });
  t.mock.method(globalThis, 'fetch', async () => {
    const value = structuredClone(state);
    if (gate) await gate;
    return { ok: true, json: async () => value };
  });
  const seen = [], other = [];
  const off = watchDesktop(value => seen.push(value)), offOther = watchDesktop(value => other.push(value));
  try {
    await tick(); assert.equal(opens, 1); assert.equal(seen.at(-1).sessionId, null);
    state = { sessionId: 'A', view: { scale: 55 } }; poll(); await tick();
    assert.deepEqual(seen.at(-1), state); assert.deepEqual(other.at(-1), state);
    let resolve; gate = new Promise(done => { resolve = done; }); poll(); await tick();
    source.onmessage({ data: JSON.stringify({ sessionId: 'B', view: { scale: 65 } }) });
    resolve(); await tick(); assert.equal(seen.at(-1).sessionId, 'B');
  } finally { off(); offOther(); }
  assert.equal(closes, 1); assert.equal(clears, 1);
});

test('多会话界面点选最近会话会自动更新聊天去向，但不会切换桌宠模式或重复打开', async () => {
  let observer, listener;
  const calls = [], events = new Map();
  const pane = id => ({ dataset: { conversationSession: id }, getClientRects: () => [1], contains(target) { return target === this; }, querySelector: () => null });
  const first = pane('A'), second = pane('B');
  const doc = { hidden: false, body: {}, activeElement: first, hasFocus: () => true, querySelectorAll: () => [first, second],
    addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name) };
  const stop = installDesktopBridge({ doc, win: { addEventListener() {}, removeEventListener() {} },
    Observer: class { constructor(fn) { observer = fn; } observe() {} disconnect() {} },
    watch: fn => { listener = fn; return () => {}; }, action: async data => calls.push(data) });
  try {
    listener({ opened: true, global: true, canAutoOpen: false, sessionId: 'A', generation: 1 }); await tick();
    events.get('pointerdown')({ target: second }); doc.activeElement = second; observer(); await tick();
    assert.deepEqual(calls.filter(call => call.action === 'foreground').map(call => call.sessionId), ['A', 'B']);
    assert.ok(calls.every(call => call.action !== 'open' && call.action !== 'autoOpen'));
    doc.hidden = true; observer(); await tick();
    assert.equal(calls.filter(call => call.action === 'foreground').length, 2);
  } finally { stop(); }
});
