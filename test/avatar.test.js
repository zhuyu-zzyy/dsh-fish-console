import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { openModel } from '../lib/avatar/core.js';
import { createController, inferEmotion } from '../lib/avatar/controller.js';
import { createPlayer, referenceCards, referencePose, sampleCurve } from '../lib/avatar/actions.js';
import { createAvatarPlayer } from '../lib/avatar/scenes.js';
import { parseCue } from '../lib/avatar/cues.js';
import { createVoice } from '../lib/avatar/voice.js';

const modelDir = new URL('../lib/avatar/model/', import.meta.url);
const read = (name) => fs.readFile(new URL(name, modelDir));
test('随包的 MOC3 真正驱动左右眼、嘴型、两颊、头转和发梢', async () => {
  const manifest = JSON.parse(await read('fish.model3.json')),
    f = manifest.FileReferences;
  const model = await openModel(await read('../purism.wasm'), await read(f.Moc));
  await Promise.all(
    [
      f.DisplayInfo,
      f.Physics,
      ...f.Textures,
      ...f.Expressions.map((e) => e.File),
      ...Object.values(f.Motions)
        .flat()
        .map((m) => m.File),
    ].map(read),
  );
  assert.equal(model.meshes.length, 65);
  assert.equal(model.indexes.size, 17);
  const points = (id) => [...model.meshes.find((m) => m.id === id).xy],
    height = (id) => {
      const y = points(id).filter((_, i) => i % 2);
      return Math.max(...y) - Math.min(...y);
    };
  model.update({});
  const right = points('EyeWhiteR'),
    left = points('EyeWhiteL'),
    face = points('Face');
  model.update({ ParamEyeLOpen: 0 });
  assert.ok(height('EyeWhiteL') < 0.001);
  assert.deepEqual(points('EyeWhiteR'), right);
  model.update({ ParamEyeROpen: 0, ParamEyeLOpen: 1 });
  assert.ok(height('EyeWhiteR') < 0.001);
  assert.deepEqual(points('EyeWhiteL'), left);
  assert.ok(height('MouthInside') < 0.001);
  model.update({ ParamMouthOpenY: 1 });
  assert.ok(height('MouthInside') > 0.025);
  const open = points('MouthInside');
  model.update({ ParamMouthForm: 1 });
  assert.notDeepEqual(points('MouthInside'), open);
  const back = points('HairBack');
  model.update({ ParamHairSwing: 0.8 });
  assert.notDeepEqual(points('HairBack'), back);
  model.update({ ParamAngleX: 25 });
  const turned = points('Face');
  assert.notDeepEqual(turned, face);
  // Cheek and center vertices move by different amounts at the same height.
  const dx = face.filter((_, i) => i % 2 === 0).map((v, i) => turned[i * 2] - v);
  assert.ok(Math.max(...dx) - Math.min(...dx) > 0.01);
  for (const param of ['ParamAngleY', 'ParamAngleZ', 'ParamBodyAngleX', 'ParamEyeBallX', 'ParamEyeBallY']) {
    const old = points('IrisL');
    model.update({ [param]: param.includes('EyeBall') ? 1 : 9 });
    assert.notDeepEqual(points('IrisL'), old, param);
  }
  assert.ok(model.meshes.every((m) => m.triangles.length > 0 && m.xy.every(Number.isFinite)));
});
test('眼部与口腔使用各自的遮罩，姿态参数维持两侧独立', async () => {
  const model = await openModel(await read('../purism.wasm'), await read('fish.moc3'));
  const piece = (name) => model.meshes.find((m) => m.id === name);
  const points = (name) => [...piece(name).xy];
  const opacity = (name) => model.opacities[piece(name).index];
  for (const side of ['L', 'R']) {
    for (const id of ['Iris', 'Pupil', 'Glint']) {
      assert.deepEqual(
        piece(id + side).masks.map((i) => model.meshes[i].id),
        ['EyeWhite' + side],
      );
    }
  }
  for (const name of ['Teeth', 'Tongue'])
    assert.deepEqual(
      piece(name).masks.map((i) => model.meshes[i].id),
      ['MouthInside'],
    );
  model.update({});
  const rightHand = points('PalmR'),
    leftHand = points('PalmL'),
    skirt = points('Dress'),
    lowerLid = points('LowerLidR');
  assert.equal(opacity('ClosedLidL'), 0);
  model.update({ ParamEyeLOpen: 0, ParamEyeSmile: 0.85, ParamArmL: 1 });
  assert.equal(opacity('ClosedLidL'), 1);
  assert.equal(opacity('ClosedLidR'), 0);
  assert.equal(opacity('IrisL'), 0);
  assert.equal(opacity('LidSkinL'), 1);
  assert.equal(opacity('LidSkinR'), 0);
  assert.notDeepEqual(points('LowerLidR'), lowerLid);
  assert.notDeepEqual(points('PalmL'), leftHand);
  assert.deepEqual(points('PalmR'), rightHand);
  assert.deepEqual(points('Dress'), skirt);
});
test('六态立绘的半眨眼移动眼睑、保留虹膜形状；转头与回答的视线动作由模型驱动', async () => {
  const model = await openModel(await read('../purism.wasm'), await read('fish.moc3'));
  const points = (id) => Array.from(model.meshes.find((mesh) => mesh.id === id).xy);
  const height = (id) => {
    const y = points(id).filter((_, i) => i % 2);
    return Math.max(...y) - Math.min(...y);
  };
  model.update({});
  const rightEye = points('EyeWhiteR'),
    irisHeight = height('IrisL'),
    aperture = height('EyeWhiteL');
  model.update({ ParamEyeLOpen: 0.5 });
  assert.ok(Math.abs(height('IrisL') - irisHeight) < 0.0001);
  assert.ok(Math.abs(height('EyeWhiteL') - aperture / 2) < 0.001);
  assert.deepEqual(points('EyeWhiteR'), rightEye);
  const iris = points('IrisL');
  model.update({ ParamEyeBallX: 0.68, ParamMouthOpenY: 0.81 });
  assert.notDeepEqual(points('IrisL'), iris);
  assert.ok(height('MouthInside') > 0.025);
  const refs = JSON.parse(await read('fish.model3.json')).FileReferences.Motions;
  const curves = async (name) => JSON.parse(await read(refs[name][0].File)).Curves;
  assert.ok((await curves('speak')).some((curve) => curve.Id === 'ParamEyeBallX'));
  assert.ok((await curves('ponder')).some((curve) => curve.Id === 'ParamAngleX' && curve.Segments.some((v) => v < 0)));
});
async function motionAssets() {
  const refs = JSON.parse(await read('fish.model3.json')).FileReferences;
  const motions = Object.fromEntries(
    await Promise.all(
      Object.entries(refs.Motions).map(async ([id, [motion]]) => [id, JSON.parse(await read(motion.File))]),
    ),
  );
  return { motions, expressions: {}, physics: JSON.parse(await read(refs.Physics)).PhysicsSettings[0] };
}
test('四个标准关键姿态来自动作文件，贝塞尔关键点与 Cubism 元数据一致', async () => {
  const assets = await motionAssets();
  assert.equal(Object.keys(assets.motions).length, 10);
  for (const motion of Object.values(assets.motions)) {
    const total = motion.Curves.reduce((count, c) => count + (c.Segments.length - 2) / 7, 0);
    assert.equal(total, motion.Meta.TotalSegmentCount);
    assert.equal(3 * total + motion.Curves.length, motion.Meta.TotalPointCount);
    for (const curve of motion.Curves) {
      const s = curve.Segments;
      assert.equal(s[0], 0);
      assert.equal(s.at(-2), motion.Meta.Duration);
      for (let i = 2; i < s.length; i += 7) assert.equal(s[i], 1);
    }
  }
  const pose = (id) => referencePose(id, assets);
  assert.equal(referenceCards.length, 4);
  for (const [id, left, right] of [
    ['front', 1, 1],
    ['blink', 0, 0],
  ]) {
    assert.equal(pose(id).ParamEyeLOpen, left);
    assert.equal(pose(id).ParamEyeROpen, right);
  }
  assert.equal(pose('glance').ParamMouthOpenY, 0.81);
  assert.equal(pose('glance').ParamEyeBallX, 0.68);
  assert.equal(pose('turn').ParamAngleX, -26);
  assert.equal(pose('turn').ParamAngleZ, 13);
  const bezier = { Segments: [0, 0, 1, 1 / 3, 0, 2 / 3, 1, 1, 1] };
  assert.equal(sampleCurve(bezier, 0.25), 0.15625);
});
test('统一表情入口播放四个立姿动作，拒绝不兼容场景和忙碌时试播', async () => {
  let time = 0;
  const controller = createController({ now: () => time, publish() {}, speak() {}, cancel() {} });
  controller.reset();
  const player = createAvatarPlayer(controller, () => 0, false, { now: () => time, hour: () => 14 });
  const assets = await motionAssets();
  for (const { id, peak } of referenceCards) {
    assert.equal(player.expression('action:' + id), true);
    assert.deepEqual(player.frame(time + peak * 1000, assets), referencePose(id, assets));
    time += 5000;
  }
  assert.equal(player.expression('happy'), false);
  assert.equal(player.expression('unknown'), false);
  player.select('swing');
  assert.equal(player.expression('action:blink'), false);
  assert.equal(player.scene(time), 'swing', '不支持的选项不得切走当前场景');
  assert.equal(player.expression('happy'), true);
  player.select('sleep');
  assert.equal(player.expression('happy'), false);
  assert.equal(player.expression('closed'), true);
  controller.listen(true);
  assert.equal(player.expression('action:blink'), false);
  assert.equal(player.expression('auto'), true);
  controller.listen(false);
  assert.equal(player.expression('action:blink'), true);
});

test('随机立姿定时播放不同的完整动作，不重置场景轮换，忙碌暂停且手动选择可退出', async () => {
  let time = 0, draws = 0;
  const samples = [0.99, 0, 0.99, 0, 0.4, 0, 0, 0];
  const controller = createController({ now: () => time, publish() {}, speak() {}, cancel() {} });
  controller.reset();
  const player = createAvatarPlayer(controller, () => 0, false, {
    now: () => time, hour: () => 14, random: () => samples[draws++] ?? 0,
  });
  const assets = await motionAssets();
  assert.equal(player.expression('random'), true);
  for (const [index, id] of ['turn', 'glance', 'blink', 'front'].entries()) {
    time = index * 6000;
    assert.equal(player.scene(time), 'main');
    player.frame(time, assets);
    const peak = referenceCards.find(card => card.id === id).peak;
    assert.deepEqual(player.frame(time + peak * 1000, assets), referencePose(id, assets));
    player.frame(time + 5999, assets);
    assert.equal(draws, (index + 1) * 2, '每次动作完整播放，间隔内不得重抽');
  }
  time = 24000;
  assert.equal(player.scene(time), 'swing', '随机动作不得把自动场景轮换一直推迟');
  controller.listen(true);
  time = 30000;
  assert.equal(player.scene(time), 'main');
  player.frame(time, assets);
  assert.equal(draws, 8, '录音期间不得随机选动作');
  controller.listen(false);
  time = 30001;
  player.scene(time);
  assert.deepEqual(player.frame(time, assets), referencePose('front', assets));
  assert.equal(draws, 10, '空闲后恢复随机播放');
  assert.equal(player.expression('action:glance'), true);
  assert.deepEqual(player.frame(time + 660, assets), referencePose('glance', assets));
  time += 12000;
  player.scene(time);
  player.frame(time, assets);
  assert.equal(draws, 10, '手动动作应退出随机模式');
  player.select('main');
  player.expression('random');
  player.frame(time, assets);
  time += 30000;
  assert.equal(player.scene(time), 'main', '随机表情不得改掉手动固定的立姿场景');
  player.expression('auto');
  const stopped = draws;
  player.frame(time, assets);
  assert.equal(draws, stopped, '场景默认应停止随机播放');
});

test('本地试动作只在待机时接管画面，回复和静音停顿立即取回口型，工具状态使用独立视线路径', async () => {
  const assets = await motionAssets();
  let state = 'IDLE',
    since = 0,
    level = null,
    gesture = null;
  const player = createPlayer({ pose: () => ({ state, since, emotion: 'neutral', dt: 0.05, gesture }) }, () => level);
  assert.equal(player.preview('blink', 0), true);
  const hold = player.frame(600, assets);
  assert.equal(hold.ParamEyeLOpen, 0);
  assert.equal(hold.ParamEyeROpen, 0);
  state = 'SPEAKING';
  since = 650;
  level = 0.72;
  assert.equal(player.frame(660, assets).ParamMouthOpenY, 0.72);
  level = 0;
  assert.equal(player.frame(695, assets).ParamMouthOpenY, 0);
  assert.equal(player.preview('glance', 700), false);
  state = 'TOOL_CALLING';
  since = 800;
  let out;
  for (let t = 800; t < 1700; t += 25) out = player.frame(t, assets);
  assert.ok(out.ParamEyeBallY < -0.35);
  assert.equal(out.ParamMouthOpenY, 0);
  state = 'THINKING';
  since = 1700;
  for (let t = 1700; t <= 2900; t += 25) out = player.frame(t, assets);
  assert.ok(out.ParamAngleX < -19);
  assert.ok(out.ParamEyeBallX < 0);
  state = 'IDLE';
  since = 3000;
  gesture = { id: 'blink', at: 3000 };
  out = player.frame(3150, assets);
  assert.equal(out.ParamEyeROpen, 0);
  assert.equal(out.ParamEyeLOpen, 0);
  const reduced = createPlayer(
    { pose: () => ({ state: 'SPEAKING', since: 0, emotion: 'neutral', dt: 0.05 }) },
    () => 0.43,
    true,
  );
  const still = reduced.frame(600, assets);
  assert.equal(still.ParamAngleX, 0);
  assert.equal(still.ParamEyeBallX, 0);
  assert.equal(still.ParamMouthOpenY, 0.43);
});

function harness() {
  let time = 1000,
    view,
    cb,
    revision = 0;
  let snap = { revision, change: { kind: 'replace', entries: [] }, entries: [] };
  const spoken = [],
    controller = createController({
      now: () => time,
      publish: (v) => (view = v),
      speak: (t) => spoken.push(t),
      cancel: () => {},
    });
  const feed = {
    getSnapshot: () => snap,
    subscribe: (f) => {
      cb = f;
      return () => {
        cb = null;
      };
    },
  };
  const push = (change) => {
    snap = { revision: ++revision, entries: change.entries || [], change };
    cb?.();
  };
  const append = (type, data) => push({ kind: 'append', entries: [{ event: { type, data, seq: revision + 1 } }] });
  return {
    controller,
    feed,
    spoken,
    push,
    append,
    get view() {
      return view;
    },
    advance(ms) {
      time += ms;
      controller.tick();
    },
  };
}
test('当前会话的并行工具、多步回复、语义动作和中断相互独立', () => {
  const h = harness(),
    off = h.controller.watch(h.feed);
  h.append('agent/inbox/spliced', { inserted: [{ source: { kind: 'user' } }] });
  assert.equal(h.view.state, 'LISTENING');
  h.append('turn/start', { turn: 1 });
  h.advance(250);
  assert.equal(h.view.state, 'THINKING');
  for (const id of ['a', 'b']) h.append('tool/call', { turn: 1, callId: id, name: '查资料' + id });
  h.append('tool/result', { turn: 1, message: { toolCallId: 'a' } });
  assert.equal(h.view.state, 'TOOL_CALLING');
  assert.equal(h.view.tool, '查资料b');
  h.append('tool/result', { turn: 1, message: { toolCallId: 'b' } });
  assert.equal(h.view.state, 'THINKING');
  h.append('assistant/live-chunk', {
    turn: 1,
    attemptId: 'try',
    chunk: { type: 'reasoning-delta', text: 'private' },
  });
  assert.equal(h.view.caption, '');
  h.append('assistant/live-chunk', {
    turn: 1,
    attemptId: 'try',
    chunk: { type: 'text-delta', text: '太好了！' },
  });
  assert.equal(h.view.emotion, 'happy');
  h.append('assistant/message', {
    turn: 1,
    message: {
      content: [
        { type: 'reasoning', text: 'private' },
        { type: 'text', text: '太好了！' },
      ],
    },
  });
  assert.deepEqual(h.spoken, ['太好了！']);
  h.push({ kind: 'settle-assistant', attemptId: 'try' });
  assert.equal(h.view.caption, '太好了！');
  h.append('fish-avatar/cue', { turn: 1, emotion: 'curious', action: 'nod', progress: '正在复核' });
  assert.equal(h.view.emotion, 'curious');
  assert.equal(h.spoken.at(-1), '正在复核');
  h.append('assistant/message', { turn: 1, message: { content: [{ type: 'text', text: '第二段。' }] } });
  h.controller.playback(true);
  h.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
  assert.equal(h.view.state, 'SPEAKING');
  h.controller.playback(false);
  assert.equal(h.view.state, 'IDLE');
  h.append('turn/start', { turn: 2 });
  h.append('tool/call', { turn: 1, callId: 'old', name: '前一轮' });
  assert.equal(h.view.tool, '');
  h.append('turn/end', { turn: 2, reason: { kind: 'error' } });
  assert.equal(h.view.state, 'ERROR');
  off();
  h.append('assistant/message', { turn: 2, message: { content: [{ type: 'text', text: '另一个会话' }] } });
  assert.equal(h.spoken.length, 3);
});
test('重连、翻阅历史、被放弃的草稿均不朗读旧内容', () => {
  const h = harness(),
    entry = {
      event: {
        type: 'assistant/message',
        seq: 1,
        data: { turn: 3, message: { content: [{ type: 'text', text: '历史' }] } },
      },
    };
  h.controller.watch(h.feed);
  h.push({ kind: 'prepend', entries: [entry] });
  h.push({ kind: 'replace', entries: [entry] });
  assert.equal(h.spoken.length, 0);
  h.append('assistant/live-chunk', {
    turn: 4,
    attemptId: 'retry',
    chunk: { type: 'text-delta', text: '暂定' },
  });
  assert.equal(h.view.caption, '暂定');
  h.push({ kind: 'settle-assistant', attemptId: 'retry' });
  assert.equal(h.spoken.length, 0);
  assert.equal(h.view.caption, '');
  h.push({
    kind: 'replace',
    entries: [
      { event: { type: 'turn/start', seq: 10, data: { turn: 5 } } },
      { event: { type: 'tool/call', seq: 11, data: { turn: 5, callId: 'lookup', name: '检索' } } },
    ],
  });
  assert.equal(h.view.state, 'TOOL_CALLING');
  assert.equal(h.view.tool, '检索');
  h.controller.listen(true);
  assert.equal(h.view.state, 'LISTENING');
  h.controller.listen(false);
  assert.equal(parseCue({ ParamAngleX: 42 }), null);
  assert.equal(parseCue({ action: 'happy' }), null);
  assert.equal(inferEmotion('我不确定。'), 'confused');
});
test('取消后迟到的语音响应不再播放', async () => {
  let resolve,
    count = 0;
  class FakeAudio {
    state = 'running';
    destination = {};
    resume() {}
    close() {
      return Promise.resolve();
    }
    createAnalyser() {
      return { fftSize: 256, connect() {}, disconnect() {} };
    }
    async decodeAudioData() {
      return {};
    }
    createBufferSource() {
      count++;
      return { connect() {}, start() {}, stop() {}, disconnect() {} };
    }
  }
  const voice = createVoice({
    Audio: FakeAudio,
    request: () =>
      new Promise((r) => {
        resolve = r;
      }),
    playback() {},
    notice() {},
  });
  await voice.enable();
  voice.enqueue('你好');
  voice.cancel();
  resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(12) });
  await new Promise((r) => setImmediate(r));
  assert.equal(count, 0);
  assert.equal(voice.level(), 0);
  voice.dispose();
});
