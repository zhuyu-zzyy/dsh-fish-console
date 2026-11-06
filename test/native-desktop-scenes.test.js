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

// Runs inside the real bundled WKWebView after startup, using the production controls and pipe protocol.
async function exercise() {
  const canvas = document.getElementById('avatar');
  const select = document.getElementById('scene');
  const expression = document.getElementById('expression');
  const frames = [];
  const expressions = [];
  const applyExpression = player.expression;
  player.expression = value => {
    const accepted = applyExpression(value);
    if (accepted) expressions.push(value);
    return accepted;
  };
  function available(expected) {
    const actual = [...expression.options].filter(option => !option.disabled).map(option => option.value).sort();
    if (expression.disabled || expression.options.length !== 12 || JSON.stringify(actual) !== JSON.stringify([...expected, 'random'].sort())) {
      throw Error('表情选项可用性错误：' + actual.join(','));
    }
  }
  function express(value, accepted = true) {
    const count = expressions.length;
    expression.value = value;
    expression.dispatchEvent(new Event('change'));
    if (expressions.length !== count + Number(accepted)) throw Error('表情选择未正确分派：' + value);
  }
  function choose(value) {
    select.value = value;
    select.dispatchEvent(new Event('change'));
  }
  async function visible(id) {
    const deadline = performance.now() + 7000;
    while (canvas.dataset.fishScene !== id && performance.now() < deadline) {
      await new Promise(r => setTimeout(r, 25));
    }
    if (canvas.dataset.fishScene !== id) throw Error(id + ': ' + document.getElementById('notice').textContent);
    frames.push(id);
  }
  window.fishReceive({kind:'bind',generation:1,canRecord:false,active:false,voice:false});
  // An unfolded pane is needed when a user's saved desktop is parked at the right edge.
  canvas.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true}));
  if (document.getElementById('motions')) throw Error('旧的独立动作按钮尚未移除');
  const actions = ['action:front', 'action:blink', 'action:glance', 'action:turn'];
  available(['auto', ...actions]);
  for (const action of [...actions, 'action:blink']) {
    express(action);
    if (expression.value !== 'auto') throw Error('一次性动作未恢复选择，无法重复触发');
  }
  express('random');
  if (expression.value !== 'random') throw Error('随机模式未保持选中');
  express('action:blink');
  if (expression.value !== 'auto') throw Error('手动动作未退出随机模式');
  for (const id of ['swing','eat_rice','sleep']) {
    choose(id);
    await visible(id);
    available(id === 'sleep' ? ['auto', 'closed'] : ['auto', 'neutral', 'happy', 'innocent', 'content', 'drowsy', 'closed']);
    express('action:blink', false);
    if (canvas.dataset.fishScene !== id) throw Error('禁用动作切走了当前场景');
    if (id === 'swing') express('happy');
    if (id === 'eat_rice' && expression.value !== 'happy') throw Error('兼容场景切换丢失表情选择');
    if (id === 'sleep') {
      if (expression.value !== 'auto') throw Error('不兼容表情未显示场景默认');
      express('happy', false);
      express('closed');
    }
  }
  express('random');
  window.fishReceive({kind:'listen',generation:1,value:true});
  await visible('main');
  available(['auto']);
  if (expression.value !== 'random') throw Error('录音暂停时丢失随机模式');
  express('action:blink', false);
  window.fishReceive({kind:'listen',generation:1,value:false});
  available(['auto', ...actions]);
  choose('eat_rice');await visible('eat_rice');
  if (expression.value !== 'random') throw Error('切换场景后丢失随机模式');
  const event = (type,data) => window.fishReceive({kind:'event',generation:1,event:{type,data}});
  event('turn/start',{turn:'test'});await visible('main');
  event('fish-avatar/cue',{turn:'test',idleScene:'swing',idleExpression:'innocent'});
  event('turn/end',{turn:'test',reason:{kind:'completed'}});await visible('swing');
  await visible('main');
  if (expression.value !== 'random') throw Error('回复结束后丢失随机模式');
  express('auto');
  if (expression.value !== 'auto') throw Error('无法关闭随机模式');
  return { frames, expressions };
}

test('原生窗口表情菜单按场景置灰，随机模式跨场景与忙碌状态保留并可关闭', {
  skip: process.platform !== 'darwin' || process.env.FISH_CONSOLE_NATIVE_LAYOUT !== '1',
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(),'fish-idle-native-'));
  try {
    await cp(avatar,root,{recursive:true});
    await appendFile(path.join(root,'desktop/pet.js'), '\nconst originalReceive = window.fishReceive;\n' +
      'window.fishReceive = async message => { originalReceive(message); if (message.kind !== "initialScale") return;\n' +
      'try { post({kind:"idleProbe", result: await (' + exercise.toString() + ')()}); } ' +
      'catch(error){post({kind:"idleProbe", error:error.message});} $("close").click(); };\n');
    const {stdout}=await run(path.join(avatar,'desktop/FishPet'),[root],{timeout:40000});
    const result=stdout.trim().split('\n').map(s=>JSON.parse(s)).find(m=>m.kind==='idleProbe');
    assert.deepEqual(result?.result, {
      frames: ['swing','eat_rice','sleep','main','eat_rice','main','swing','main'],
      expressions: ['auto', 'action:front', 'action:blink', 'action:glance', 'action:turn', 'action:blink',
        'random', 'action:blink', 'happy', 'closed', 'random', 'auto'],
    }, stdout);
  } finally { await rm(root,{recursive:true,force:true}); }
});
