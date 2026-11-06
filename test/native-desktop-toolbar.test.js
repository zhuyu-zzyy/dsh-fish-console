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

// Exercise the production WebView and control handlers with isolated settings.
// Pointer hit testing is disabled so the user's current cursor cannot make the
// test pet hover; DOM pointer/keyboard events still reach the real handlers.
async function exerciseToolbar() {
  const get = id => document.getElementById(id), nav = document.querySelector('nav');
  const wait = () => new Promise(resolve => setTimeout(resolve, 250));
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  const visible = () => !nav.hidden && Number(getComputedStyle(nav).opacity) > .9;
  const pointer = id => {
    get(id).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
    get(id).focus();
    get(id).dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  };
  get('pet').style.pointerEvents = 'none';
  window.fishReceive({ kind: 'bind', generation: 1, active: false, tools: [], rotation: { swing: 160, eat_rice: 20 } });
  window.fishReceive({ kind: 'event', generation: 1, event: { type: 'turn/start', data: { turn: 1 } } });
  window.fishReceive({ kind: 'event', generation: 1, event: { type: 'tool/call', data: { turn: 1, callId: 'test-tool', name: 'bili_scan' } } });
  for (const scale of [100, 55]) {
    pointer('actions');
    get('scale').value = scale; get('scale').dispatchEvent(new Event('input'));
    await wait(); check(visible(), '设置打开时工具栏必须可用');
    pointer('done'); await wait();
    check(get('settings').hidden && get('compose').hidden, '设置或对话未关闭');
    check(!get('pet').matches(':hover'), '测试鼠标仍在桌宠上');
    check(document.activeElement.id === 'actions', '完成后没有复现按钮残留焦点');
    check(!visible(), scale + '%：鼠标操作后的残留焦点使顶部工具栏无法收起');
    check(!get('bubble').hidden && get('detail').textContent.includes('bili_scan'), '收起工具栏不应隐藏工具进度');

    pointer('chat'); await wait(); check(!get('compose').hidden && visible(), '对话展开时工具栏不可用');
    get('words').value = '保留草稿';
    pointer('chat'); await wait(); check(!visible(), '收起对话后工具栏仍常驻');
    check(get('words').value === '保留草稿', '收起工具栏丢失了对话草稿');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    get('actions').focus(); await wait(); check(visible(), '键盘导航时应显示工具栏');
    window.dispatchEvent(new Event('blur')); await wait(); check(!visible(), '离开桌宠窗口后工具栏仍常驻');
  }
}

test('顶部工具栏不会被鼠标残留焦点锁住；运行工具时可收起，对话与键盘导航仍可用', {
  skip: process.platform !== 'darwin' || process.env.FISH_CONSOLE_NATIVE_LAYOUT !== '1',
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fish-toolbar-'));
  const desktop = path.join(root, 'desktop'), domain = 'local.dsh.fish-console.toolbar-test.' + randomUUID();
  try {
    await cp(avatar, root, { recursive: true });
    const source = path.join(desktop, 'FishPet.m');
    await writeFile(source, (await readFile(source, 'utf8')).replaceAll('DSHFishPet', domain)
      .replaceAll('NSUserDefaults.standardUserDefaults', `[[NSUserDefaults alloc] initWithSuiteName:@"${domain}"]`));
    await run('sh', [path.join(desktop, 'build.sh')]);
    const js = path.join(desktop, 'pet.js');
    await writeFile(js, (await readFile(js, 'utf8')) + `
      const toolbarReceive = window.fishReceive;
      window.fishReceive = async msg => {
        toolbarReceive(msg);
        if (msg.kind !== 'initialScale') return;
        try { await (${exerciseToolbar.toString()})(); post({kind:'toolbarPassed'}); }
        catch (error) { post({kind:'toolbarFailed', message:error.message}); }
        $('close').click();
      };`);
    const { stdout } = await run(path.join(desktop, 'FishPet'), [root], { timeout: 20000 });
    const messages = stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.ok(messages.some(message => message.kind === 'toolbarPassed'), stdout);
  } finally {
    await run('/usr/bin/defaults', ['delete', domain]).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});
