import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFile, cp, mkdtemp, rm } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDesktopPet } from '../lib/avatar/desktop-host.js';

const avatar = fileURLToPath(new URL('../lib/avatar/', import.meta.url));
async function exerciseRotation() {
  const get = id => document.getElementById(id);
  const wait = async (condition, message) => {
    const until = performance.now() + 5000;
    while (!condition()) {
      if (performance.now() > until) throw Error(message);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  const edit = (swing, eat) => {
    get('swingSeconds').value = swing;
    get('eatSeconds').value = eat;
    get('swingSeconds').dispatchEvent(new Event('input', { bubbles: true }));
  };
  const save = (swing, eat) => {
    edit(swing, eat);
    get('rotationForm').requestSubmit();
  };
  if (get('swingSeconds').value !== '84') throw Error('初始设置未载入');
  get('avatar').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
  get('rotationSettings').open = true;
  save(10, 15);
  await wait(() => get('rotationStatus').textContent.startsWith('已保存'), '未收到原生保存确认');
  if (get('settings').hidden) throw Error('单独保存轮换时间不应关闭设置');
  window.webkit.messageHandlers.fishPet.postMessage({ kind: 'rotationProbePhase' });
  await wait(() => get('swingSeconds').value === '20' && get('eatSeconds').value === '25', '聊天设置未同步到桌宠');
  save(30, 35);
  await wait(() => get('rotationStatus').textContent === '模拟磁盘保存失败', '保存失败未展示');
  if (get('saveRotation').disabled || get('swingSeconds').value !== '30') throw Error('保存失败后不能继续修改草稿');
  get('rotationSettings').open = false;
  get('done').click();
  if (get('settings').hidden || !get('done').disabled) throw Error('完成应等待保存确认再关闭设置');
  await wait(() => get('rotationStatus').textContent === '模拟磁盘保存失败', '完成未展示保存失败');
  if (get('settings').hidden || !get('rotationSettings').open || get('done').disabled || get('swingSeconds').value !== '30')
    throw Error('完成保存失败后应保留草稿、展开错误并允许重试');
  for (const value of ['', 1, 5.5, 3601]) {
    edit(value, 45);
    get('rotationSettings').open = false;
    get('done').click();
    if (get('settings').hidden || !get('rotationSettings').open || get('done').disabled ||
        !get('rotationStatus').textContent.includes('5 到 3600 秒的整数')) throw Error('完成未阻止无效时长：' + value);
  }
  edit(40, 45);
  get('done').click();
  if (get('settings').hidden || !get('done').disabled) throw Error('完成在保存成功前关闭了设置');
  get('done').click();
  await wait(() => get('settings').hidden, '完成保存成功后未关闭设置');
  if (!get('rotationStatus').textContent.startsWith('已保存') || get('done').disabled) throw Error('完成保存结果未更新');
  get('avatar').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
  if (get('swingSeconds').value !== '40' || get('eatSeconds').value !== '45') throw Error('重新打开设置丢失已保存时长');
  get('done').click();
  if (!get('settings').hidden || get('done').disabled) throw Error('没有修改时完成应直接关闭设置');
  return 'passed';
}

test('原生轮换表单和完成按钮保存到宿主，完成等待确认、阻止无效值并保留失败草稿', {
  skip: process.platform !== 'darwin' || process.env.FISH_CONSOLE_NATIVE_LAYOUT !== '1', timeout: 30000,
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fish-native-rotation-'));
  const cleanup = [], observations = [], saves = [];
  let saved, timer;
  try {
    await cp(avatar, root, { recursive: true });
    await appendFile(path.join(root, 'desktop/pet.js'), '\nconst originalReceive = window.fishReceive;\n' +
      'window.fishReceive = async message => { originalReceive(message); if (message.kind !== "bind") return;\n' +
      'try { post({kind:"rotationProbe", result:await (' + exerciseRotation.toString() + ')()}); }' +
      'catch(error){post({kind:"rotationProbe", error:error.message});} };\n');
    let resolveResult, rejectResult;
    const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    // Install a handler immediately so launch failures do not leave an unhandled timeout rejection.
    result.catch(() => {});
    timer = setTimeout(() => rejectResult(new Error('原生轮换验收超时')), 22000);
    const pet = createDesktopPet({ on() {}, effect: setup => cleanup.push(setup()) }, {
      supported: true,
      saveRotation(value) {
        if (value.swing === 30) throw new Error('模拟磁盘保存失败');
        saved = value;
        saves.push(value);
      },
      launch() {
        const child = spawn(path.join(avatar, 'desktop/FishPet'), [root], { stdio: ['pipe', 'pipe', 'ignore'] });
        createInterface({ input: child.stdout }).on('line', line => {
          const message = JSON.parse(line);
          if (message.kind === 'rotationProbePhase') pet.setRotation({ swing: 20, eat_rice: 25 });
          if (message.kind === 'rotationProbe') resolveResult(message);
        });
        return child;
      },
    });
    pet.observe(state => observations.push(state.rotation));
    await pet.open('rotation-test');
    assert.deepEqual(await result, { kind: 'rotationProbe', result: 'passed' });
    assert.ok(observations.some(value => value.swing === 10 && value.eat_rice === 15));
    assert.deepEqual(saves, [{ swing: 10, eat_rice: 15 }, { swing: 20, eat_rice: 25 }, { swing: 40, eat_rice: 45 }]);
    assert.deepEqual(saved, { swing: 40, eat_rice: 45 });
    assert.deepEqual(pet.status().rotation, saved);
  } finally {
    clearTimeout(timer);
    cleanup.forEach(dispose => dispose());
    await rm(root, { recursive: true, force: true });
  }
});
