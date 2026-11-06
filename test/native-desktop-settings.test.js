import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { createDesktopPet } from '../lib/avatar/desktop-host.js';
import { readJson, updateJson } from '../lib/json-store.js';

const run = promisify(execFile);
const avatar = fileURLToPath(new URL('../lib/avatar/', import.meta.url));
const wait = async (condition, message) => {
  const deadline = Date.now() + 6000;
  while (!condition()) {
    if (Date.now() > deadline) throw Error(message);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
};
test('全局桌宠无会话启动、感知并行任务，自动换聊天保留草稿与设置并跨启动保存', {
  skip: process.platform !== 'darwin' || process.env.FISH_CONSOLE_NATIVE_LAYOUT !== '1', timeout: 60000,
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fish-desktop-settings-'));
  const desktop = path.join(root, 'desktop'), file = path.join(root, 'desktop-pet.json');
  const domain = 'local.dsh.fish-console.settings-test.' + randomUUID(), cleanup = [], events = new Map();
  let child, pet, reply, serial = 0;
  const start = () => {
    const saved = readJson(file);
    return createDesktopPet({ on: (name, listener) => events.set(name, listener), effect: fn => cleanup.push(fn()) }, {
      ...saved, supported: true,
      saveSession: id => updateJson(file, value => ({ ...value, lastSessionId: id }), path.join(root, 'backups'), 'pet'),
      saveRotation: rotation => updateJson(file, value => ({ ...value, rotation }), path.join(root, 'backups'), 'pet'),
      launch() {
        child = spawn(path.join(desktop, 'FishPet'), [root], { stdio: ['pipe', 'pipe', 'ignore'] });
        createInterface({ input: child.stdout }).on('line', line => { const message = JSON.parse(line); if (message.kind === 'globalProbeResult') reply = message; });
        return child;
      },
    });
  };
  const control = (name, value) => pet.control(undefined, pet.status().generation, name, value);
  const probe = async () => {
    const id = ++serial; child.stdin.write(JSON.stringify({ kind: 'globalReadProbe', id }) + '\n');
    await wait(() => reply?.id === id, '原生桌宠没有返回聊天状态'); return reply;
  };
  try {
    await cp(avatar, root, { recursive: true });
    const source = path.join(desktop, 'FishPet.m');
    await writeFile(source, (await readFile(source, 'utf8')).replaceAll('DSHFishPet', domain)
      .replaceAll('NSUserDefaults.standardUserDefaults', `[[NSUserDefaults alloc] initWithSuiteName:@"${domain}"]`));
    await run('sh', [path.join(desktop, 'build.sh')]);
    await appendFile(path.join(desktop, 'pet.js'), `
const settingsReceive = window.fishReceive;
window.fishReceive = message => {
  settingsReceive(message);
  if (message.kind === 'nativeSettingsProbe') {
    $('scale').value = 65; $('scale').dispatchEvent(new Event('input'));
    $('words').value = '保留我的聊天草稿';
    $('swingSeconds').value = 160; $('eatSeconds').value = 20;
    $('swingSeconds').dispatchEvent(new Event('input', { bubbles: true }));
  }
  // Read after the renderer has consumed the latest chat/activity changes.
  if (message.kind === 'globalReadProbe') requestAnimationFrame(() => requestAnimationFrame(() => post({ kind: 'globalProbeResult', id: message.id,
    text: $('words').value, target: $('chatTarget').textContent, sendDisabled: $('send').disabled,
    swing: $('swingSeconds').value, mode: $('scene').value, scene: $('avatar').dataset.fishScene,
    expression: $('expression').value })));
};
`);
    await writeFile(file, JSON.stringify({ desktopByDefault: true, rotation: { swing: 84, eat_rice: 36 } }));
    pet = start();
    await pet.autoOpen();
    await wait(() => pet.status().view, '桌宠没有报告初始状态');
    assert.equal(pet.status().controls, true);
    assert.equal(pet.status().global, true); assert.equal(pet.status().sessionId, null);
    assert.equal((await probe()).sendDisabled, true);
    pet.foreground('session-A');
    assert.equal(readJson(file).lastSessionId, 'session-A');
    assert.equal((await control('scale', 55)).view.scale, 55);
    assert.equal((await control('voice', true)).view.voice, true);
    assert.equal((await control('voice', false)).view.voice, false);
    await control('scene', 'swing');
    await wait(() => pet.status().view.scene === 'swing', '远程场景没有切换');
    assert.equal((await control('expression', 'random')).view.expression, 'random');
    await assert.rejects(control('expression', 'action:blink'), /不支持这个表情/);
    assert.equal(pet.status().view.expression, 'random');
    events.get('session/event')({ id: 'session-A' }, { type: 'turn/start', data: { turn: 1 } });
    await wait(() => pet.status().view.state === 'THINKING', '会话活动未更新桌宠状态');
    events.get('session/event')({ id: 'session-background' }, { type: 'turn/start', data: { turn: 1 } });
    events.get('session/event')({ id: 'session-background' }, { type: 'tool/call', data: { turn: 1, callId: 'tool', name: '后台工具' } });
    await wait(() => pet.status().view.state === 'TOOL_CALLING', '后台任务未反映到全局桌宠');
    assert.equal(pet.status().activity.count, 2);
    await assert.rejects(control('scene', 'eat_rice'), /回复或录音结束/);
    events.get('session/event')({ id: 'session-background' }, { type: 'turn/end', data: { turn: 1 } });
    await wait(() => pet.status().view.state === 'THINKING', '仍有任务时不应回到待机');
    events.get('session/event')({ id: 'session-A' }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
    await wait(() => pet.status().view.state === 'IDLE', '回复结束后未回到空闲');
    await control('scene', 'eat_rice');
    await wait(() => pet.status().view.scene === 'eat_rice', '切换聊天前吃饭场景尚未显示');
    await control('expression', 'random');
    child.stdin.write(JSON.stringify({ kind: 'nativeSettingsProbe' }) + '\n');
    await wait(() => pet.status().view.scale === 65, '原生设置未反向同步到工作区');
    const oldGeneration = pet.status().generation;
    pet.foreground('session-B');
    assert.equal(pet.status().generation, oldGeneration, '换聊天不能重建桌宠');
    assert.equal(readJson(file).lastSessionId, 'session-B');
    const after = await probe();
    assert.equal(after.text, '保留我的聊天草稿'); assert.equal(after.swing, '160');
    assert.equal(after.mode, 'eat_rice'); assert.equal(after.expression, 'random');
    assert.equal(after.scene, 'eat_rice', '切换聊天后仍应渲染手选场景');
    assert.equal(pet.status().view.mode, 'eat_rice', '工作区也应保留手选场景');
    assert.match(after.target, /会话 B/); assert.equal(after.sendDisabled, false);
    assert.throws(() => pet.control(undefined, oldGeneration - 1, 'scale', 90), { httpStatus: 409 });
    await pet.close(undefined, pet.status().generation);
    assert.deepEqual(readJson(file).rotation, { swing: 160, eat_rice: 20 }, '收回时必须保存原生表单草稿');
    assert.equal(readJson(file).desktopByDefault, true);
    cleanup.splice(0).forEach(dispose => dispose());
    pet = start();
    await pet.autoOpen();
    await wait(() => pet.status().view, '重启后未同步状态');
    assert.equal(pet.status().sessionId, 'session-B');
    assert.equal(pet.status().view.scale, 65);
    assert.deepEqual(pet.status().rotation, { swing: 160, eat_rice: 20 });
    await pet.close(undefined, pet.status().generation);
    assert.equal((await pet.autoOpen()).opened, false, '手动收回后本次运行不应自动弹出');
  } finally {
    cleanup.forEach(dispose => dispose());
    await run('/usr/bin/defaults', ['delete', domain]).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});
