import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAvatarPlayer, idleScenes, sceneExpressions } from '../lib/avatar/scenes.js';
import { createController } from '../lib/avatar/controller.js';
import { parseCue } from '../lib/avatar/cues.js';
import { openModel } from '../lib/avatar/core.js';
import { sampleCurve } from '../lib/avatar/actions.js';

const root = new URL('../lib/avatar/', import.meta.url);
const json = async url => JSON.parse(await readFile(url, 'utf8'));
async function assets(id) {
  const entry = new URL('scenes/' + id + '/' + id + '.model3.json', root);
  const { FileReferences: refs } = await json(entry);
  const expressions = Object.fromEntries(await Promise.all(refs.Expressions.map(async row =>
    [row.Name, await json(new URL(row.File, entry))])));
  return { refs, entry, expressions, motions: { idle: await json(new URL(refs.Motions.idle[0].File, entry)) } };
}
function run(reduced = false, hour = 14, options = {}) {
  let time = 0, sequence = 0;
  const controller = createController({ now: () => time, publish() {}, cancel() {}, speak() {} });
  controller.reset();
  const player = createAvatarPlayer(controller, () => 0, reduced, { ...options, now: () => time, hour: () => hour });
  return { player, controller, at(t) { time = t; return player.scene(t); },
    event(type, data) { controller.event({ seq: ++sequence, type, data }); } };
}

test('待机按时间与昼夜切换，消息、录音、工具、回答和错误都优先于预览', () => {
  const h = run(false, 22);
  assert.equal(h.at(19999), 'main'); assert.equal(h.at(20000), 'swing');
  assert.equal(h.at(103999), 'swing'); assert.equal(h.at(104000), 'eat_rice'); assert.equal(h.at(120000), 'sleep');
  assert.ok(h.player.select('swing'));
  h.event('agent/inbox/spliced', { inserted: [{ source: { kind: 'user' } }] });
  assert.equal(h.at(120001), 'main');
  h.event('turn/start', { turn: 'a' }); h.event('tool/call', { turn: 'a', callId: 'tool', name: '查资料' });
  assert.equal(h.at(121000), 'main'); assert.equal(h.player.select('sleep'), false);
  h.event('tool/result', { turn: 'a', message: { toolCallId: 'tool' } });
  h.controller.playback(true); h.event('turn/end', { turn: 'a', reason: { kind: 'completed' } });
  assert.equal(h.at(161000), 'main');
  h.controller.playback(false); assert.equal(h.at(161001), 'main');
  assert.equal(h.at(181001),'swing');
  h.controller.listen(true); assert.equal(h.at(181002),'main');
  h.controller.listen(false); h.event('turn/start',{turn:'b'}); h.event('turn/end',{turn:'b',reason:{kind:'error'}});
  assert.equal(h.at(400000),'main'); assert.equal(h.player.select('eat_rice'),false);
  assert.equal(run(false,14).at(140000),'swing');
  const r=run(true);assert.equal(r.at(300000),'main');assert.ok(r.player.select('sleep'));assert.equal(r.at(300001),'sleep');
});

test('轮换时长从第一次待机起生效，修改时当前场景重新计时，重复同步不延长停留', async () => {
  const h = run();
  h.player.rotation({ swing: 10, eat_rice: 15 });
  assert.equal(h.at(19999), 'main');
  assert.equal(h.at(20000), 'swing');
  assert.equal(h.at(29999), 'swing');
  assert.equal(h.at(30000), 'eat_rice');
  assert.equal(h.at(44999), 'eat_rice');
  assert.equal(h.at(45000), 'swing');
  assert.equal(h.at(55000), 'eat_rice');
  h.at(58000);
  h.player.rotation({ swing: 5, eat_rice: 8 });
  assert.equal(h.at(65999), 'eat_rice');
  h.player.rotation({ swing: 5, eat_rice: 8 });
  assert.equal(h.at(66000), 'swing');
  assert.equal(h.at(71000), 'eat_rice');
  h.player.wake();
  assert.equal(h.at(90999), 'main');
  assert.equal(h.at(91000), 'swing');
  assert.equal(h.at(96000), 'eat_rice');

  const art = await assets('eat_rice');
  h.player.select('eat_rice');
  h.player.frame(96000, art, 'eat_rice');
  const pose = h.player.frame(97300, art, 'eat_rice');
  h.player.rotation({ swing: 300, eat_rice: 600 });
  assert.deepEqual(h.player.frame(97300, art, 'eat_rice'), pose, '调整轮换不得改变 Motion 速度或手动场景');
  assert.equal(h.at(999999), 'eat_rice');
  const night = run(false, 23);
  night.player.rotation({ swing: 3600, eat_rice: 3600 });
  assert.equal(night.at(119999), 'swing');
  assert.equal(night.at(120000), 'sleep');
});

test('Agent 场景提示只在本轮空闲后播放一轮，新输入可以取消，历史状态不能重放', async () => {
  const h=run(), art=await assets('eat_rice');
  assert.equal(parseCue({idleScene:'eat_rice',ParamMouthOpenY:1}),null);
  assert.equal(parseCue({idleScene:'sleep',idleExpression:'happy'}),null);
  assert.equal(parseCue({idleExpression:'content'}),null);
  h.event('turn/start',{turn:'a'});h.event('fish-avatar/cue',{turn:'a',idleScene:'eat_rice',idleExpression:'innocent'});
  assert.equal(h.at(1000),'main');h.controller.playback(true);
  h.event('turn/end',{turn:'a',reason:{kind:'completed'}});assert.equal(h.at(6000),'main');
  h.controller.playback(false);assert.equal(h.at(6001),'eat_rice');h.player.frame(6001,art,'eat_rice');
  assert.ok(h.player.frame(6351,art,'eat_rice').ParamBrowLY>0);
  const end = 6001 + art.motions.idle.Meta.Duration * 1000;
  assert.equal(h.at(end - 1),'eat_rice');assert.equal(h.at(end),'main');
  h.event('turn/start',{turn:'b'});h.event('fish-avatar/cue',{turn:'b',idleScene:'sleep'});
  h.player.wake();h.event('turn/end',{turn:'b',reason:{kind:'completed'}});
  assert.equal(h.at(10000),'main');h.controller.reset();assert.equal(h.at(10010),'main');
});

test('每个 Motion 和表情 ID 在对应 MOC3 中有绑定，模型在真实 Core 中响应全部动作轨', async () => {
  const wasm = await readFile(new URL('purism.wasm',root));
  for (const id of Object.keys(idleScenes)) {
    const a=await assets(id);
    await readFile(new URL(a.refs.Textures[0],a.entry));
    const model=await openModel(wasm,await readFile(new URL(a.refs.Moc,a.entry)));
    const motion=a.motions.idle;
    assert.equal(motion.Meta.Fps,30);assert.equal(motion.Meta.Loop,true);
    const ids=Object.keys(a.expressions);
    assert.deepEqual(new Set(ids),new Set(id==='sleep'?['closed']:Object.keys(sceneExpressions)));
    for(const exp of Object.values(a.expressions))for(const {Id} of exp.Parameters)assert.ok(model.indexes.has(Id),id+' '+Id);
    for(const curve of motion.Curves){
      assert.ok(model.indexes.has(curve.Id),id+' '+curve.Id);
      const segments=curve.Segments,values=[segments[1]];
      for(let i=2;i<segments.length;){const n=segments[i]===1?7:3;values.push(segments[i+n-1]);i+=n;}
      const snapshot = value => {
        model.update({[curve.Id]:value});
        return [...model.opacities,...model.meshes.flatMap(mesh=>Array.from(mesh.xy))];
      };
      const lo=snapshot(Math.min(...values)),hi=snapshot(Math.max(...values));
      assert.ok(hi.every(Number.isFinite));assert.ok(hi.some((v,i)=>Math.abs(v-lo[i])>1e-5),id+' inert '+curve.Id);
    }
  }
});

test('表情与动作叠加时保留眨眼、饭团阶梯及卧姿呼吸，低动态预览保持定姿', async () => {
  const swing=await assets('swing'), eat=await assets('eat_rice'), sleep=await assets('sleep');
  const h=run();h.player.select('swing');h.player.expression('drowsy');h.player.frame(0,swing,'swing');
  assert.equal(h.player.frame(500,swing,'swing').ParamEyeLOpen,.62);
  assert.equal(h.player.frame(76000/30,swing,'swing').ParamEyeLOpen,0);
  h.player.select('eat_rice');h.player.expression('content');h.player.frame(0,eat,'eat_rice');
  for(const loop of [0,1,2])for(const [f,v]of [[11,0],[12,1],[41,1],[42,0]]) {
    const p=h.player.frame(loop*eat.motions.idle.Meta.Duration*1000+f*1000/30,eat,'eat_rice');assert.equal(p.ParamEatBiteVisible,v);
    if(f===42)assert.equal(p.ParamMouthOpenY,1);
  }
  h.player.select('sleep');h.player.frame(0,sleep,'sleep');
  const resting=h.player.frame(1600,sleep,'sleep');
  assert.equal(resting.ParamBreath,.7);assert.equal(resting.ParamEyeLOpen,0);assert.equal(resting.ParamEyeROpen,0);
  const low=run(true);low.player.select('eat_rice');
  assert.equal(low.player.frame(0,eat,'eat_rice').ParamEatArmR,1);
  assert.equal(low.player.frame(2900,eat,'eat_rice').ParamEatArmR,1);
});

test('随机表情只使用场景已有资源，切换场景更新范围，睡觉保持闭眼且手选可停止', async () => {
  const swing = await assets('swing'), eat = await assets('eat_rice'), sleep = await assets('sleep');
  let draws = 0;
  const h = run(false, 14, { random: () => { draws++; return 0.999; } });
  h.player.select('swing');
  h.player.expression('random');
  h.player.frame(0, swing, 'swing');
  assert.equal(h.player.frame(500, swing, 'swing').ParamEyeLOpen, 0);
  assert.equal(h.player.frame(9000, swing, 'swing').ParamEyeLOpen, 0);
  assert.equal(draws, 2);
  assert.equal(h.at(10000), 'swing');
  h.player.frame(10000, swing, 'swing');
  assert.equal(h.player.frame(10500, swing, 'swing').ParamBrowLY, -0.19, '闭眼后应切换到不同的困倦表情');
  assert.equal(draws, 4);
  h.at(11000);
  h.player.select('eat_rice');
  h.player.frame(11000, eat, 'eat_rice');
  const eating = h.player.frame(11000 + 37000 / 30, eat, 'eat_rice');
  assert.equal(eating.ParamEyeLOpen, 0);
  assert.equal(eating.ParamEatArmR, 1, '随机表情不改变送饭动作与播放速度');
  h.at(14000);
  h.player.select('sleep');
  h.player.frame(14000, sleep, 'sleep');
  const beforeSleep = draws;
  for (const t of [14500, 24000, 60000]) {
    assert.equal(h.at(t), 'sleep');
    const pose = h.player.frame(t, sleep, 'sleep');
    assert.equal(pose.ParamEyeLOpen, 0);
    assert.equal(pose.ParamEyeROpen, 0);
  }
  assert.equal(draws, beforeSleep, '睡觉只有闭眼，不反复抽取或混入其他表情');
  h.player.select('swing');
  h.player.expression('innocent');
  h.player.frame(60000, swing, 'swing');
  assert.equal(h.player.frame(60500, swing, 'swing').ParamBrowLY, 0.34);
  h.player.frame(90000, swing, 'swing');
  assert.equal(draws, beforeSleep, '手动选择表情后停止随机');
});

test('坐姿双手交替送饭，入口隐藏各自饭团，闭嘴咀嚼且大碗固定', async () => {
  const a = await assets('eat_rice');
  const model = await openModel(await readFile(new URL('purism.wasm', root)), await readFile(new URL(a.refs.Moc, a.entry)));
  const poses = [12, 37, 42, 55, 145, 150, 163, 190, 216].map(frame => {
    model.update(Object.fromEntries(a.motions.idle.Curves.map(curve => [curve.Id, sampleCurve(curve, frame / 30)])));
    return Object.fromEntries(model.meshes.map(mesh => {
      const xs = Array.from(mesh.xy).filter((_, index) => index % 2 === 0).map(value => value * model.pixelsPerUnit);
      const ys = Array.from(mesh.xy).filter((_, index) => index % 2 === 1).map(value => value * model.pixelsPerUnit);
      return [mesh.id, { left: Math.min(...xs), right: Math.max(...xs), bottom: Math.min(...ys), top: Math.max(...ys), opacity: model.opacities[mesh.index] }];
    }));
  });
  assert.ok(!poses[0].NearStick && !poses[0].FarStick);
  const rice = poses[1].RiceBite, mouth = poses[1].MouthInside;
  const centerX = (rice.left + rice.right) / 2, centerY = (rice.top + rice.bottom) / 2;
  assert.ok(mouth.top - mouth.bottom > 110, '张口高度与参考图的大口进饭一致');
  assert.ok(centerX > mouth.left && centerX < mouth.right && centerY > mouth.bottom && centerY < mouth.top, '饭团进入口腔范围');
  assert.ok(poses[1].HandR.top - poses[0].HandR.top > 80, '右手从碗口上抬送饭');
  assert.equal(poses[0].RiceBite.opacity, 1);
  assert.equal(poses[2].RiceBite.opacity, 0);
  assert.equal(poses[3].MouthInside.opacity, 0);
  const leftRice = poses[4].RiceBiteL, leftMouth = poses[4].MouthInside;
  const leftX = (leftRice.left + leftRice.right) / 2, leftY = (leftRice.top + leftRice.bottom) / 2;
  assert.ok(leftX > leftMouth.left && leftX < leftMouth.right && leftY > leftMouth.bottom && leftY < leftMouth.top, '左手饭团也应送入口腔');
  assert.equal(poses[4].RiceBite.opacity, 0);
  assert.equal(poses[4].RiceBiteL.opacity, 1);
  assert.equal(poses[5].RiceBiteL.opacity, 0);
  assert.equal(poses[6].MouthInside.opacity, 0);
  assert.equal(poses[7].RiceBiteL.opacity, 0);
  assert.equal(poses[8].RiceBiteL.opacity, 0);
  for (const pose of poses) for (const id of ['BowlRice', 'BowlFront']) assert.deepEqual(pose[id], poses[0][id], '坐姿大碗应保持固定');
  for (const id of ['JoyBurst', 'MunchL', 'MunchR']) assert.ok(poses[1][id].opacity > .9);
});

test('抓饭时掌背朝外指尖朝下，米饭前层遮挡指尖且碗沿在双手前方', async () => {
  const a = await assets('eat_rice');
  const model = await openModel(await readFile(new URL('purism.wasm', root)), await readFile(new URL(a.refs.Moc, a.entry)));
  const mesh = id => model.meshes.find(m => m.id === id);
  const pose = frame => model.update(Object.fromEntries(a.motions.idle.Curves.map(c => [c.Id, sampleCurve(c, frame / 30)])));
  // UV positions identify the same wrist and fingertip vertices throughout the rotation.
  const vertex = (m, u, v) => {
    const us = Array.from(m.uv).filter((_, i) => i % 2 === 0), vs = Array.from(m.uv).filter((_, i) => i % 2 === 1);
    const left = Math.min(...us), right = Math.max(...us), bottom = Math.min(...vs), top = Math.max(...vs);
    let nearest = 0, distance = Infinity;
    for (let i = 0; i < us.length; i++) {
      const d = ((us[i] - left) / (right - left) - u) ** 2 + ((top - vs[i]) / (top - bottom) - v) ** 2;
      if (d < distance) { distance = d; nearest = i; }
    }
    return () => [m.xy[nearest * 2] * model.pixelsPerUnit, m.xy[nearest * 2 + 1] * model.pixelsPerUnit];
  };
  for (const [side, grabFrame, feedFrame, u] of [['R', 12, 37, .65], ['L', 120, 145, .35]]) {
    const hand = mesh('Hand' + side), contact = mesh('RiceContact' + side);
    assert.ok(contact, side + ' 必须有固定在饭堆上的指尖遮挡层');
    assert.ok(model.orders[mesh('BowlRice').index] < model.orders[hand.index]);
    assert.ok(model.orders[hand.index] < model.orders[contact.index]);
    assert.ok(model.orders[contact.index] < model.orders[mesh('BowlFront').index]);
    const wrist = vertex(hand, u, .62), tip = vertex(hand, u, .96);
    pose(grabFrame);
    assert.ok(wrist()[1] - tip()[1] > 70, side + ' 抓饭时手腕应在指尖上方，不能沿用送饭方向平移');
    const contactXY = Array.from(contact.xy), xs = contactXY.filter((_, i) => i % 2 === 0).map(v => v * model.pixelsPerUnit);
    const ys = contactXY.filter((_, i) => i % 2 === 1).map(v => v * model.pixelsPerUnit);
    assert.ok(tip()[0] > Math.min(...xs) && tip()[0] < Math.max(...xs) && tip()[1] > Math.min(...ys) && tip()[1] < Math.max(...ys), side + ' 指尖进入米饭前层覆盖的区域');
    // The rice mound is offset from the canvas centre. Check the outer finger too:
    // a mirrored arm may put its centre in rice while its outside fingers cross the rim.
    const outerTip = vertex(hand, side === 'L' ? .7 : .3, .93)();
    const bowlXs = Array.from(mesh('BowlRice').xy).filter((_, i) => i % 2 === 0).map(v => v * model.pixelsPerUnit);
    const bowlLeft = Math.min(...bowlXs), bowlRight = Math.max(...bowlXs), rimMargin = (bowlRight - bowlLeft) * .1;
    assert.ok(outerTip[0] > bowlLeft + rimMargin && outerTip[0] < bowlRight - rimMargin, side + ' 外侧指尖应落在饭堆内部，不能压在碗的侧沿');
    pose(feedFrame);
    assert.ok(tip()[1] - wrist()[1] > 30, side + ' 抬手后手指随前臂转向嘴边');
    assert.deepEqual(Array.from(contact.xy), contactXY, '米饭遮挡应留在碗里，不能随手上抬');
  }
});

test('秋千沿前后方向改变透视，座板保持居中且两条绳顶固定', async () => {
  const a = await assets('swing');
  const model = await openModel(await readFile(new URL('purism.wasm', root)), await readFile(new URL(a.refs.Moc, a.entry)));
  const poses = [0, 1, 2, 3, 4].map(time => {
    model.update(Object.fromEntries(a.motions.idle.Curves.map(curve => [curve.Id, sampleCurve(curve, time)])));
    return Object.fromEntries(model.meshes.map(mesh => [mesh.id, Array.from(mesh.xy, value => value * model.pixelsPerUnit)]));
  });
  const seatBounds = poses.map(pose => {
    const xs = pose.Seat.filter((_, index) => index % 2 === 0);
    const min = Math.min(...xs), max = Math.max(...xs);
    return { center: (min + max) / 2, width: max - min };
  });
  const centers = seatBounds.map(seat => seat.center);
  assert.ok(Math.max(...centers) - Math.min(...centers) < 5, '前后摆动时座板横向漂移应小于 5 原画像素');
  assert.ok(seatBounds[2].width / seatBounds[0].width > 1.15, '向前时座板透视应明显放大');
  for (const id of ['RopeL', 'RopeR']) {
    const first = poses[0][id];
    const top = Math.max(...first.filter((_, index) => index % 2 === 1));
    const anchors = first.map((value, index) => index).filter(index => index % 2 === 1 && Math.abs(first[index] - top) < .1);
    for (const pose of poses) for (const index of anchors) {
      assert.ok(Math.abs(pose[id][index] - first[index]) < .05);
      assert.ok(Math.abs(pose[id][index - 1] - first[index - 1]) < .05);
    }
  }
});

test('睡觉以被面呼吸为主，床架固定且独立 Zzz 能浮现和淡出', async () => {
  const a = await assets('sleep');
  const model = await openModel(await readFile(new URL('purism.wasm', root)), await readFile(new URL(a.refs.Moc, a.entry)));
  const poses = [0, 1.7, 3.8].map(time => {
    model.update(Object.fromEntries(a.motions.idle.Curves.map(curve => [curve.Id, sampleCurve(curve, time)])));
    return Object.fromEntries(model.meshes.map(mesh => [mesh.id, {
      xy: Array.from(mesh.xy, value => value * model.pixelsPerUnit), opacity: model.opacities[mesh.index],
    }]));
  });
  for (const id of ['BedBack', 'Mattress', 'BedFootL', 'BedFootR']) {
    assert.ok(poses[0][id].xy.every((value, index) => Math.abs(value - poses[1][id].xy[index]) < .05), id + ' 应保持稳定');
  }
  const blanketRise = poses[1].Quilt.xy.filter((_, index) => index % 2 === 1)
    .map((value, index) => value - poses[0].Quilt.xy[index * 2 + 1]);
  assert.ok(Math.max(...blanketRise) >= 25, '被面起伏在桌宠尺寸下应至少约 5 像素');
  for (const id of ['ZzzSmall', 'ZzzMiddle', 'ZzzLarge']) {
    assert.ok(poses[1][id], id + ' 独立图层存在');
    assert.equal(poses[0][id].opacity, 0);
    assert.ok(poses[1][id].opacity > .7);
    assert.equal(poses[2][id].opacity, 0);
  }
});
