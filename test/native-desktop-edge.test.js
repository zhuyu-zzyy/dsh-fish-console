import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const avatar = fileURLToPath(new URL('../lib/avatar/', import.meta.url));

// Executed inside the real pet WebView. Only pointer capture is stubbed for synthetic pointer events.
async function exerciseEdge(phase) {
  const get = (id) => document.getElementById(id);
  const peek = get('edgePeek');
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  const wait = async (predicate, label) => {
    for (let tries = 0; tries < 100; tries++) {
      if (predicate()) return;
      await delay(20);
    }
    throw new Error(label + ' (' + innerWidth + ' × ' + innerHeight + ')');
  };
  const drag = (node, dx, dy) => {
    node.setPointerCapture = () => {};
    for (const [type, x, y] of [['pointerdown', 0, 0], ['pointermove', dx, dy], ['pointerup', dx, dy]]) {
      node.dispatchEvent(new PointerEvent(type, { button: 0, pointerId: 3, screenX: 250 + x, screenY: 200 + y }));
    }
  };
  const measure = (tag) => window.webkit.messageHandlers.fishPet.postMessage({ kind: 'probeBounds', tag });
  if (phase === 3) {
    await wait(() => peek.hidden && innerWidth === 139, '普通模式没有记住');
    return;
  }
  if (phase === 2) {
    await wait(() => !peek.hidden && innerWidth === 35, '贴边状态没有恢复');
    measure('reopened');
    drag(peek, -24, 0);
    await delay(120);
    check(!peek.hidden, '小幅移动意外解除了贴边');
    drag(peek, -25, 0);
    await wait(() => peek.hidden && innerWidth === 139, '拉出后没有恢复 55%');
    return;
  }
  await wait(() => peek.hidden && innerWidth === 252, '初始普通模式');
  drag(get('avatar'), 8, 0); // Default placement is 20 points from the right.
  await delay(100);
  check(peek.hidden, '未到吸附范围就收起');
  drag(get('avatar'), 8, 0);
  await wait(() => !peek.hidden && innerWidth === 64, '放到右边没有收起');
  const gl = get('avatar').getContext('webgl'), draw = gl.drawElements;
  let draws = 0;
  gl.drawElements = function (...args) { draws++; return draw.apply(this, args); };
  const art = await fetch('right-peek.png');
  check(art.ok && (await art.blob()).type === 'image/png', '探头资源未加载');
  measure('docked');
  window.fishReceive({ kind: 'bind', generation: 1, active: false, canRecord: true, tools: [] });
  window.fishReceive({ kind: 'event', generation: 1, event: { type: 'turn/start', data: { turn: 1 } } });
  await delay(100);
  check(!peek.hidden && innerWidth === 64 && !get('bubble').hidden, '后台进度意外展开窗口');
  const atRest = draws;
  await delay(100);
  check(draws === atRest, '收起后仍在绘制全身模型');
  drag(peek, 0, -35);
  peek.dispatchEvent(new MouseEvent('click', { detail: 1 }));
  await delay(100);
  check(!peek.hidden, '竖向拖动被当成了点击');
  measure('vertical');
  drag(peek, 0, 0);
  peek.dispatchEvent(new MouseEvent('click', { detail: 1 }));
  await wait(() => !get('compose').hidden && innerWidth === 252, '点击探头没有打开对话');
  await wait(() => draws > atRest, '展开后全身模型没有恢复绘制');
  get('words').value = '草稿';
  get('chat').click();
  await wait(() => !peek.hidden && innerWidth === 64, '关闭对话后没有收起');
  peek.click();
  check(get('words').value === '草稿', '贴边丢失对话草稿');
  get('chat').click();
  peek.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await wait(() => !get('settings').hidden && innerWidth === 252, '右键没有打开设置');
  get('scale').value = 20;
  get('scale').dispatchEvent(new Event('input'));
  get('done').click();
  await wait(() => !peek.hidden && innerWidth === 24, '最小尺寸的探头不能拖动');
  measure('minimum');
  peek.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  get('scale').value = 55;
  get('scale').dispatchEvent(new Event('input'));
  get('done').click();
  await wait(() => !peek.hidden && innerWidth === 35, '收起后的尺寸没有随比例变化');
  measure('scaled');
}

test('右缘探头占用窄窗口，支持拖动、对话、设置和跨启动恢复', {
  skip: process.platform !== 'darwin' || process.env.FISH_CONSOLE_NATIVE_LAYOUT !== '1',
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fish-edge-'));
  const desktop = path.join(root, 'desktop');
  const domain = 'local.dsh.fish-console.edge-test.' + randomUUID();
  try {
    await cp(avatar, root, { recursive: true });
    // Exercise the production AppKit geometry with isolated preferences. Report the real NSPanel frame.
    const source = path.join(desktop, 'FishPet.m');
    const code = (await readFile(source, 'utf8')).replaceAll('DSHFishPet', domain)
      .replaceAll('NSUserDefaults.standardUserDefaults', `[[NSUserDefaults alloc] initWithSuiteName:@"${domain}"]`)
      .replace('NSString *kind = m[@"kind"];', `NSString *kind = m[@"kind"];
        if ([kind isEqual:@"probeBounds"]) {
          NSRect f = self.panel.frame, b = self.panel.screen.visibleFrame;
          emit(@{@"kind":kind, @"tag":m[@"tag"], @"gap":@(NSMaxX(b)-NSMaxX(f)),
                 @"width":@(NSWidth(f)), @"height":@(NSHeight(f)), @"y":@(NSMinY(f))});
          return;
        }`);
    await writeFile(source, code);
    await run('sh', [path.join(desktop, 'build.sh')]);
    const js = path.join(desktop, 'pet.js'), original = await readFile(js, 'utf8');
    const frames = new Map();
    for (const phase of [1, 2, 3]) {
      await writeFile(js, original + `
        const receivePet = window.fishReceive;
        window.fishReceive = async (msg) => {
          receivePet(msg);
          if (msg.kind !== 'initialScale') return;
          try { await (${exerciseEdge.toString()})(${phase}); post({kind:'probePassed'}); }
          catch (error) { post({kind:'probeFailed', message:error.message}); }
          $('close').click();
        };`);
      const { stdout } = await run(path.join(desktop, 'FishPet'), [root], { timeout: 20000 });
      const messages = stdout.trim().split('\n').map((s) => JSON.parse(s));
      assert.ok(messages.some((m) => m.kind === 'probePassed'), stdout);
      for (const frame of messages.filter((m) => m.kind === 'probeBounds')) {
        assert.equal(frame.gap, 0);
        frames.set(frame.tag, frame);
      }
    }
    assert.deepEqual([...frames.values()].map((f) => [f.width, f.height]), [[64, 92], [64, 92], [24, 34], [35, 50], [35, 50]]);
    assert.equal(frames.get('vertical').y - frames.get('docked').y, 35);
    assert.equal(frames.get('scaled').y, frames.get('reopened').y);
  } finally {
    await run('/usr/bin/defaults', ['delete', domain]).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});
