import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerAvatar } from '../lib/avatar/host.js';
import { idleRotation, validateIdleRotation } from '../lib/avatar/idle-rotation.js';

test('轮换设置拒绝无效数值，旧设置和损坏字段使用默认值', () => {
  assert.deepEqual(idleRotation(), { swing: 84, eat_rice: 36 });
  assert.deepEqual(idleRotation({ swing: 15, eat_rice: 'bad' }), { swing: 15, eat_rice: 36 });
  for (const value of [null, [], {}, { swing: 5 }, { swing: 0, eat_rice: 20 },
    { swing: 5.5, eat_rice: 10 }, { swing: 15, eat_rice: 3601 }, { swing: '15', eat_rice: 10 },
    { swing: 15, eat_rice: Infinity }, { swing: 15, eat_rice: 10, other: true }]) {
    assert.throws(() => validateIdleRotation(value), { httpStatus: 400 });
  }
  assert.deepEqual(validateIdleRotation({ swing: 5, eat_rice: 3600 }), { swing: 5, eat_rice: 3600 });
});

test('HTTP 保存轮换时间并在重启后读取，保留桌宠默认模式，失败不发布成功状态', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-rotation-'));
  const file = path.join(directory, 'desktop-pet.json');
  const cleanup = [];
  const start = () => {
    const routes = new Map();
    registerAvatar({ on() {}, effect: setup => cleanup.push(setup()) },
      (url, handler) => routes.set(url, handler), async request => request.body,
      (response, code, value) => Object.assign(response, { code, value }), directory);
    return async (body) => {
      const response = {};
      await routes.get('/fish-console/avatar/pet')({ method: body ? 'POST' : 'GET', body }, response);
      return response.value;
    };
  };
  try {
    fs.writeFileSync(file, JSON.stringify({ desktopByDefault: true, preserved: 'keep' }));
    let request = start();
    assert.deepEqual((await request()).rotation, { swing: 84, eat_rice: 36 });
    const values = { swing: 120, eat_rice: 90 };
    assert.deepEqual((await request({ action: 'setRotation', value: values })).rotation, values);
    assert.deepEqual(JSON.parse(fs.readFileSync(file)), { desktopByDefault: true, preserved: 'keep', rotation: values });
    cleanup.splice(0).forEach(dispose => dispose());
    request = start();
    assert.deepEqual((await request()).rotation, values);
    assert.equal((await request()).desktopByDefault, true);
    const bytes = fs.readFileSync(file);
    await assert.rejects(request({ action: 'setRotation', value: { swing: 1, eat_rice: 1 } }), { httpStatus: 400 });
    assert.deepEqual(fs.readFileSync(file), bytes);
    fs.renameSync(file, file + '.good');
    fs.mkdirSync(file);
    await assert.rejects(request({ action: 'setRotation', value: { swing: 30, eat_rice: 30 } }));
    assert.deepEqual((await request()).rotation, values);
  } finally {
    cleanup.forEach(dispose => dispose());
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
