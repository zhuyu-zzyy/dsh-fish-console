import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createDesktopPet, petEvent } from '../lib/avatar/desktop-host.js';
import { canonicalRecording } from '../lib/avatar/desktop/recording.js';
import { speechChunks, spokenText } from '../lib/avatar/speech-text.js';
import { createVoice } from '../lib/avatar/voice.js';

const example =
  '在呢在呢！老大～（放下碗，颠颠儿地跑过来）🍚\n\n我小肥鱼001随时待命，老大有什么吩咐？嘿嘿（挺起小胸脯，摆了个自信pose）';
test('朗读先去掉括号和完整的 emoji，再分句；显示文本和编号不变', async () => {
  assert.deepEqual(speechChunks(example), [
    '在呢在呢！',
    '老大～',
    '我小肥鱼001随时待命，老大有什么吩咐？',
    '嘿嘿',
  ]);
  assert.deepEqual(speechChunks('A（拿起碗！\n(试试看)）B。👩🏾‍🔬🇨🇳1️⃣🫶🏽\n42。'), ['A B。', '42。']);
  assert.deepEqual(speechChunks('（挥手…）👋！'), []);
  assert.deepEqual(speechChunks('可以读[说明](https://example.invalid/a(b))。'), ['可以读说明。']);
  assert.equal(spokenText('在呢（还没写完。'), '在呢');
  let requests = 0;
  class Audio {
    state = 'running';
    destination = {};
    createAnalyser() {
      return { connect() {}, disconnect() {}, fftSize: 256 };
    }
    resume() {}
    close() {
      return Promise.resolve();
    }
  }
  const voice = createVoice({
    Audio,
    playback() {},
    notice() {},
    request: async () => {
      requests++;
      return { status: 204 };
    },
  });
  await voice.enable();
  voice.enqueue('（抬头）🍚');
  await new Promise(setImmediate);
  assert.equal(requests, 0);
  voice.enqueue(example);
  await new Promise(setImmediate);
  assert.equal(requests, 4);
  voice.dispose();
});
test('朗读开关随窗口所有权转移；新一轮取消旧声音时仍可开启朗读', async () => {
  let resume,
    calls = 0;
  class Audio {
    state = 'running';
    destination = {};
    createAnalyser() {
      return { connect() {}, disconnect() {} };
    }
    resume() {
      return new Promise((r) => (resume = r));
    }
    close() {
      return Promise.resolve();
    }
  }
  const speaker = createVoice({
    Audio,
    playback() {},
    notice() {},
    request: async () => {
      calls++;
      return { status: 204 };
    },
  });
  const pending = speaker.enable();
  speaker.disable();
  resume();
  assert.equal(await pending, false);
  speaker.enqueue('不应朗读');
  await new Promise(setImmediate);
  assert.equal(calls, 0);
  const next = speaker.enable();
  speaker.cancel();
  resume();
  assert.equal(await next, true);
  speaker.enqueue('这一轮');
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  speaker.dispose();
});
function recording() {
  const pcm = Buffer.from([0, 0, 1, 0]),
    buf = Buffer.alloc(60);
  buf.write('RIFF');
  buf.writeUInt32LE(52, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(16000, 24);
  buf.writeUInt32LE(32000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('JUNK', 36);
  buf.writeUInt32LE(4, 40);
  buf.write('data', 48);
  buf.writeUInt32LE(4, 52);
  pcm.copy(buf, 56);
  return buf;
}
test('桌宠录音转换为 DSH 接收的本地 PCM WAV，拒绝错误格式', () => {
  const input = recording(),
    out = Buffer.from(canonicalRecording(input.toString('base64')), 'base64');
  assert.equal(out.length, 48);
  assert.equal(out.toString('ascii', 36, 40), 'data');
  assert.deepEqual(out.subarray(44), input.subarray(56));
  input.writeUInt32LE(44100, 24);
  assert.throws(() => canonicalRecording(input.toString('base64')));
});
const wait = () => new Promise(setImmediate);
test('桌宠和聊天同步轮换设置，旧窗口和失败保存不能修改已生效的时长', async () => {
  const cleanup = [], updates = [], status = [];
  let saved, fail = false;
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stdin: new PassThrough(), kill() {} });
  child.stdin.on('data', line => updates.push(JSON.parse(line)));
  const pet = createDesktopPet({ on() {}, effect: setup => cleanup.push(setup()) }, {
    supported: true, rotation: { swing: 40, eat_rice: 30 },
    saveRotation(value) { if (fail) throw new Error('保存失败'); saved = value; },
    launch() { queueMicrotask(() => child.stdout.write('{"kind":"ready"}\n')); return child; },
  });
  try {
    pet.observe(value => status.push(value));
    await pet.open('A');
    const generation = pet.status().generation;
    assert.deepEqual(updates.find(m => m.kind === 'bind').rotation, { swing: 40, eat_rice: 30 });
    const change = (id, value, epoch = generation) => child.stdout.write(JSON.stringify({ kind: 'setRotation', id, generation: epoch, value }) + '\n');
    change('stale', { swing: 5, eat_rice: 5 }, generation - 1);
    change('valid', { swing: 90, eat_rice: 60 });
    await wait();
    assert.deepEqual(saved, { swing: 90, eat_rice: 60 });
    assert.deepEqual(status.at(-1).rotation, saved);
    assert.equal(updates.some(m => m.id === 'stale'), false);
    assert.equal(updates.at(-1).kind, 'rotationSaved');
    assert.equal(updates.at(-1).id, 'valid');
    pet.setRotation({ swing: 120, eat_rice: 45 });
    assert.deepEqual(updates.at(-1), { kind: 'rotation', generation, value: { swing: 120, eat_rice: 45 } });
    fail = true;
    change('failed', { swing: 15, eat_rice: 15 });
    await wait();
    assert.equal(updates.at(-1).error, '保存失败');
    assert.deepEqual(pet.status().rotation, { swing: 120, eat_rice: 45 });
    const copy = pet.status().rotation;
    copy.swing = 999;
    assert.equal(pet.status().rotation.swing, 120);
  } finally { cleanup.forEach(dispose => dispose()); }
});

test('默认模式跨启动生效，多个聊天只自动打开一只桌宠，收回后可手动重开', async () => {
  let saved = false;
  const children = [], cleanup = [];
  const ctx = { on() {}, effect: (setup) => cleanup.push(setup()) };
  const start = () => createDesktopPet(ctx, {
    supported: true,
    desktopByDefault: saved,
    saveDefault: (value) => { saved = value; },
    launch() {
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(), stdin: new PassThrough(), kill() {},
      });
      children.push(child);
      queueMicrotask(() => child.stdout.write('{"kind":"ready"}\n'));
      return child;
    },
  });
  try {
    let pet = start();
    assert.equal((await pet.autoOpen('A')).sessionId, null);
    assert.throws(() => pet.setDefault('', true));
    assert.equal(saved, false);
    assert.equal((await pet.setDefault('A', true)).sessionId, 'A');
    assert.equal(saved, true);
    assert.equal((await pet.autoOpen('B')).sessionId, 'A');
    pet.close('A', pet.status().generation);
    assert.equal((await pet.autoOpen('B')).sessionId, null);
    cleanup.pop()();

    pet = start();
    assert.equal(pet.status().canAutoOpen, true);
    const first = pet.autoOpen('B');
    assert.equal((await pet.autoOpen('C')).sessionId, 'B');
    assert.equal((await first).sessionId, 'B');
    assert.equal(children.length, 2);
    const child = children.at(-1), epoch = pet.status().generation, updates = [];
    child.stdin.on('data', (line) => updates.push(JSON.parse(line)));
    const toggle = (generation, value) =>
      child.stdout.write(JSON.stringify({ kind: 'setDefault', generation, id: 'settings', value }) + '\n');
    toggle(epoch - 1, false);
    toggle(epoch, false);
    await wait();
    assert.equal(saved, false);
    assert.equal(pet.status().desktopByDefault, false);
    assert.deepEqual(updates.filter((m) => m.kind === 'defaultMode').map((m) => m.value), [false]);
    pet.setDefault('B', true);
    assert.equal(updates.at(-1).value, true);
    children.at(-1).emit('exit'); // × on the native window
    assert.equal((await pet.autoOpen('C')).sessionId, null);
    assert.equal((await pet.open('C')).sessionId, 'C');
    pet.setDefault('C', false);
    assert.equal(pet.status().sessionId, 'C');
    cleanup.pop()();
    assert.equal(start().status().canAutoOpen, false);
  } finally {
    cleanup.forEach((dispose) => dispose());
  }
});

test('单桌宠只跟随选中会话；切换会取消旧请求，拒绝旧窗口发信，不重播历史', async () => {
  const seen = [],
    prompts = [],
    handlers = {},
    clean = [];
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stdin: new PassThrough(),
    kill() {
      this.killed = true;
    },
  });
  child.stdin.on('data', (s) => seen.push(JSON.parse(s)));
  const history = [
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '不应朗读的历史' }] } } },
    { type: 'turn/start', data: { turn: 7 } },
    { type: 'tool/call', data: { turn: 7, callId: 'x', name: '检查', args: { secret: 1 } } },
  ];
  const session = { id: 'A', seq: history.length, snapshotEvents: (s, e) => history.slice(s, e) };
  const ctx = {
    on: (n, fn) => (handlers[n] = fn),
    effect: (fn) => clean.push(fn()),
    agents: { get: (id) => (id === 'A' ? { session } : undefined) },
    get: (n) =>
      n === 'sessionController'
        ? {
            prompt: async (r) => {
              prompts.push(r);
            },
          }
        : undefined,
  };
  let signal, finish;
  const pet = createDesktopPet(ctx, {
    supported: true,
    launch: () => child,
    synthesize: (_text, s) => {
      signal = s;
      return new Promise((resolve) => (finish = resolve));
    },
  });
  const output = (m) => child.stdout.write(JSON.stringify(m) + '\n');
  const first = pet.open('A', true);
  output({ kind: 'ready' });
  await first;
  const a = seen[0];
  assert.equal(a.kind, 'bind');
  assert.equal(a.active, true);
  assert.equal(a.tools[0].name, '检查');
  assert.ok(!JSON.stringify(seen).includes('不应朗读'));
  assert.ok(!JSON.stringify(seen).includes('secret'));
  handlers['session/event'](
    { id: 'B' },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '另一个会话' }] } } },
  );
  assert.equal(seen.length, 1);
  handlers['agent/assistant-stream']({
    agent: { session },
    frame: { type: 'chunk', attemptId: 'a', turn: 7, chunk: { type: 'reasoning-delta', text: '隐藏' } },
  });
  assert.equal(seen.length, 1);
  handlers['agent/assistant-stream']({
    agent: { session },
    frame: { type: 'chunk', turn: 7, chunk: { type: 'text-delta', text: '在呢' } },
  });
  assert.equal(seen.at(-1).event.data.chunk.text, '在呢');
  output({ kind: 'speech', generation: a.generation, id: 's', text: '老大' });
  await wait();
  assert.ok(signal);
  const b = await pet.open('B', true);
  assert.ok(signal.aborted);
  finish(Buffer.from('stale'));
  await wait();
  assert.ok(!seen.some((m) => m.kind === 'speechResult'));
  output({ kind: 'send', generation: a.generation, id: 'old', text: '错发' });
  output({ kind: 'send', generation: b.generation, id: 'new', text: '你好' });
  await wait();
  assert.deepEqual(
    prompts.map((p) => [p.sessionId, p.content[0].text]),
    [['B', '你好']],
  );
  assert.equal(pet.close('A', a.generation).sessionId, 'B');
  assert.equal(pet.close('B', b.generation).sessionId, null);
  assert.equal(child.killed, true);
  clean.forEach((f) => f());
});
test('桌宠投影只保留公开文字，不转发思考、工具参数和工具输出', () => {
  const e = petEvent({
    type: 'assistant/message',
    data: {
      turn: 1,
      message: {
        content: [
          { type: 'reasoning', text: 'hidden' },
          { type: 'text', text: '（动作）🍚你好' },
          { type: 'tool-call', arguments: 'private' },
        ],
      },
    },
  });
  assert.deepEqual(e.data.message.content, [{ type: 'text', text: '（动作）🍚你好' }]);
  assert.equal(petEvent({ type: 'developer/message', data: { text: 'internal' } }), undefined);
});
