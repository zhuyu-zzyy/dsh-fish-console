import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { appendFile, cp, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const avatar = fileURLToPath(new URL('../lib/avatar/', import.meta.url));
// Exercise real controls at the saved scale, without changing macOS preferences or binding a user's chat.
const probe = `
const receive = window.fishReceive;
window.fishReceive = async (message) => {
  receive(message);
  if (message.kind !== 'initialScale') return;
  const rows = [];
  async function measure(above, below) {
    const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
    const deadline = performance.now() + 1500;
    do {
      await new Promise(requestAnimationFrame);
    } while (Math.abs(innerHeight - Math.ceil(rect('#pet').height)) > 1 && performance.now() < deadline);
    const art = rect('#avatar');
    const last = below ? rect(below) : art;
    rows.push([art.top - rect(above).bottom, below ? last.top - art.bottom : null, innerHeight - last.bottom]);
  }
  document.querySelector('#avatar').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
  await measure('#settings');
  document.querySelector('#rotationSettings').open = true;
  await measure('#settings');
  document.querySelector('#rotationSettings').open = false;
  document.querySelector('#chat').click();
  await measure('nav', '#compose');
  document.querySelector('#actions').click();
  await measure('#settings', '#compose');
  window.webkit.messageHandlers.fishPet.postMessage({ kind: 'layoutProbe', rows });
  document.querySelector('#close').click();
};`;

test('原生桌宠的工具栏、设置和输入框随人物排列，窗口没有额外留白', {
  skip: process.platform !== 'darwin' || process.env.FISH_CONSOLE_NATIVE_LAYOUT !== '1',
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fish-pet-layout-'));
  try {
    await cp(avatar, root, { recursive: true });
    await appendFile(path.join(root, 'desktop/pet.js'), '\n' + probe);
    const { stdout } = await run(path.join(avatar, 'desktop/FishPet'), [root], { timeout: 20000 });
    const result = stdout.trim().split('\n').map((line) => JSON.parse(line)).find((m) => m.kind === 'layoutProbe');
    assert.equal(result?.rows.length, 4, stdout);
    for (const row of result.rows) {
      for (const gap of row.filter((value) => value !== null)) {
        assert.ok(gap >= 0 && gap <= 8, `unexpected layout gaps (points): ${JSON.stringify(row)}`);
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
