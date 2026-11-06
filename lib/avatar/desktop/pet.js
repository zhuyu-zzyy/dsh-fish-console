import { createController, labels } from '../controller.js';
import { createAvatarPlayer, expressionOptions, idleScenes } from '../scenes.js';
import { mountRenderer } from '../renderer.js';
import { createVoice } from '../voice.js';
import { idleRotation, validateIdleRotation } from '../idle-rotation.js';

const $ = (id) => document.getElementById(id);
const post = (data) => window.webkit.messageHandlers.fishPet.postMessage(data);
let generation = 0,
  seq = 0,
  voiceOn = false,
  pendingSend = '',
  nextId = 0,
  bubbleTimer,
  noticeTimer;
const audioJobs = new Map();
let rotationRequest = '', rotationDirty = false, finishAfterRotation = false, savedRotation = idleRotation();
let closeAfterRotation = false, closeRequestId = '';
let currentScene = 'main', currentState = 'IDLE', selectedExpression = 'auto';
let globalPet = false, chatSession = '', chatGeneration = 0;
function chatLabel(message) {
  chatSession = message.sessionId || '';
  chatGeneration = message.chatGeneration || 0;
  $('chatTarget').textContent = chatSession ? '发送到：' + (message.chatTitle || '最近打开的会话') : '先在 DSH 打开一间会话，即可在这里聊天';
  $('chatTarget').hidden = !globalPet;
}
const cannotSend = () => !!micState || !!pendingSend || (globalPet && !chatSession);
let lastView = '';
function viewSnapshot() {
  return { scale: $('scale').valueAsNumber, mode: $('scene').value || 'auto', scene: currentScene,
    expression: selectedExpression, state: currentState, voice: voiceOn };
}
function reportView() {
  if (!generation || !scaleReady) return;
  const view = viewSnapshot(), key = generation + '/' + JSON.stringify(view);
  if (key === lastView) return;
  lastView = key;
  post({ kind: 'view', generation, id: 'view', view });
}
function updateExpressionOptions() {
  const choices = expressionOptions(currentScene, currentState);
  for (const option of $('expression').options) {
    option.disabled = choices.find(choice => choice.value === option.value).disabled;
  }
  $('expression').value = choices.some(choice => choice.value === selectedExpression && !choice.disabled)
    ? selectedExpression : 'auto';
  $('expression').title = currentState === 'IDLE'
    ? '随机播放每隔约 6–10 秒切换，灰色选项不适用于当前场景' : '回复或录音期间暂停随机播放与手动试播';
}
function applyRotation(value) {
  savedRotation = idleRotation(value);
  player.rotation(savedRotation);
  if (!rotationDirty) {
    $('swingSeconds').value = savedRotation.swing;
    $('eatSeconds').value = savedRotation.eat_rice;
  }
}
function rotationBusy(busy) {
  for (const id of ['swingSeconds', 'eatSeconds', 'saveRotation']) $(id).disabled = busy;
  $('done').disabled = !!rotationRequest;
  $('done').textContent = rotationRequest ? '正在保存…' : '完成';
}
let scaleReady = false, lastLayout = '', rightDocked = false;
const pet = $('pet');
const edgePeek = $('edgePeek');
// Mouse clicks leave buttons focused in WKWebView, even after closing a panel.
// Only keyboard navigation should keep the toolbar revealed through focus.
pet.addEventListener('pointerdown', () => pet.classList.remove('keyboard-controls'), true);
document.addEventListener('keydown', e => {
  if (e.key === 'Tab') pet.classList.add('keyboard-controls');
});
window.addEventListener('blur', () => pet.classList.remove('keyboard-controls'));
function fitWindow() {
  if (!scaleReady) return;
  // The controls have their own width so wrapping can be measured even while the window is still compact.
  const expanded = !pet.hidden && !pet.classList.contains('compact');
  const height = expanded ? Math.ceil(pet.getBoundingClientRect().height) : 0;
  const scale = $('scale').valueAsNumber;
  const scene = $('avatar').dataset.fishScene || 'main';
  const key = scale + '/' + height + '/' + rightDocked + '/' + scene;
  if (key === lastLayout) return;
  lastLayout = key;
  post({ kind: 'layout', scale, expanded, height, docked: rightDocked, scene });
}
new ResizeObserver(fitWindow).observe(pet);
function layout() {
  if (!scaleReady) return;
  const scale = $('scale').valueAsNumber;
  // Only an explicit conversation or settings panel unfolds a parked pet. Background activity stays tucked away.
  pet.hidden = rightDocked && $('settings').hidden && $('compose').hidden;
  edgePeek.hidden = !pet.hidden;
  const expanded = ['settings', 'compose', 'bubble', 'notice'].some((id) => !$(id).hidden);
  const compact = scale < 100 && !expanded;
  pet.classList.toggle('compact', compact);
  pet.style.setProperty('--art-scale', scale / 100);
  pet.querySelector('nav').hidden = compact;
  $('more').hidden = !compact;
  $('percent').value = scale + '%';
  fitWindow();
  reportView();
}
function showSettings(show) {
  $('settings').hidden = !show;
  for (const id of ['actions', 'more']) $(id).setAttribute('aria-expanded', String(show));
  layout();
  if (show) $('scale').focus({ preventScroll: true });
}
$('scale').oninput = layout;
$('defaultMode').onchange = () => {
  $('defaultMode').disabled = true;
  post({ kind: 'setDefault', generation, id: String(++nextId), value: $('defaultMode').checked });
};
$('resetScale').onclick = () => {
  $('scale').value = 100;
  layout();
};
function finishSettings() {
  showSettings(false);
  (pet.hidden ? edgePeek : $('more').hidden ? $('actions') : $('more')).focus({ preventScroll: true });
}
function finishClose(error) {
  const id = closeRequestId;
  closeAfterRotation = false;
  closeRequestId = '';
  if (id) post({ kind: 'closeReady', generation, id, ...(error ? { error } : {}) });
  else if (!error) post({ kind: 'close' });
}
function closePet(id = '') {
  closeAfterRotation = true;
  if (id) closeRequestId = id;
  if (rotationRequest) return;
  if (rotationDirty) saveRotation();
  else finishClose();
}
$('done').onclick = () => {
  if (rotationDirty) saveRotation(true);
  else finishSettings();
};
let dockListening = false,
  recording = '',
  micState = '';
function setMic(state) {
  micState = state;
  const busy = !!state;
  $('mic').textContent = state === 'transcribing' ? '转写中' : busy ? '停止' : '录音';
  $('mic').disabled = state === 'transcribing';
  $('send').disabled = cannotSend();
  controller.listen(dockListening || busy || !!pendingSend);
}

function notice(text) {
  clearTimeout(noticeTimer);
  $('notice').textContent = text;
  $('notice').hidden = !text;
  layout();
  if (text)
    noticeTimer = setTimeout(() => {
      $('notice').hidden = true;
      layout();
    }, 6500);
}
function publish(v) {
  clearTimeout(bubbleTimer);
  currentState = v.state;
  updateExpressionOptions();
  $('state').textContent = labels[v.state];
  $('detail').textContent = v.tool
    ? '工具 · ' + v.tool
    : v.state === 'SPEAKING' || v.state === 'IDLE'
      ? v.caption || v.progress
      : v.progress || v.caption;
  $('stop').hidden = !(voiceOn && v.state === 'SPEAKING');
  $('bubble').hidden = v.state === 'IDLE' && !$('detail').textContent;
  layout();
  if (v.state === 'IDLE')
    bubbleTimer = setTimeout(() => {
      $('bubble').hidden = true;
      layout();
    }, 4200);
}
function requestAudio(_url, { body, signal }) {
  const id = String(++nextId),
    at = generation;
  return new Promise((resolve, reject) => {
    const abort = () => {
      audioJobs.delete(id);
      post({ kind: 'cancelSpeech', generation: at, id });
      reject(new DOMException('已取消', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    audioJobs.set(id, (m) => {
      signal.removeEventListener('abort', abort);
      audioJobs.delete(id);
      if (m.error) {
        reject(new Error(m.error));
        return;
      }
      resolve({
        ok: true,
        arrayBuffer: async () => Uint8Array.from(atob(m.audio), (c) => c.charCodeAt(0)).buffer,
      });
    });
    if (signal.aborted) {
      abort();
      return;
    }
    post({ kind: 'speech', generation: at, id, text: JSON.parse(body).text });
  });
}
const controller = createController({
  publish,
  speak: (text) => speaker.enqueue(text),
  cancel: () => speaker.cancel(),
});
const speaker = createVoice({ playback: (v) => controller.playback(v), notice, request: requestAudio });
function voiceLabel() {
  $('voice').textContent = voiceOn ? '关闭朗读' : '开启朗读';
  $('voice').setAttribute('aria-pressed', String(voiceOn));
  reportView();
}
async function setVoice(on) {
  const at = generation;
  if (!on) {
    voiceOn = false;
    speaker.disable();
    voiceLabel();
    return false;
  }
  try {
    if ((await speaker.enable()) === false || at !== generation) return false;
    voiceOn = true;
  } catch (e) {
    voiceOn = false;
    notice(e.message);
  }
  voiceLabel();
  return voiceOn;
}
async function applyControl(message) {
  let error;
  try {
    if (message.name === 'scale') {
      if (!Number.isInteger(message.value) || message.value < 20 || message.value > 100) throw new Error('桌宠大小应为 20%–100%');
      $('scale').value = message.value; layout();
    } else if (message.name === 'voice') {
      if (await setVoice(message.value) !== message.value) throw new Error('朗读未能开启，请检查桌宠提示后重试');
    } else if (message.name === 'stopSpeech') speaker.cancel();
    else if (message.name === 'scene') {
      if (!player.select(message.value)) throw new Error('等这次回复或录音结束后再切换待机场景');
    } else if (message.name === 'expression') chooseExpression(message.value);
    else throw new Error('未知的桌宠设置');
  } catch (failure) { error = failure.message; }
  reportView();
  post({ kind: 'controlResult', generation: message.generation, id: message.id, view: viewSnapshot(), ...(error ? { error } : {}) });
}
function event(e) {
  controller.event({ ...e, seq: ++seq });
}
window.fishReceive = (m) => {
  if (m.kind === 'initialScale') {
    $('scale').value = m.scale;
    rightDocked = m.docked === true;
    scaleReady = true;
    layout();
    return;
  }
  if (m.kind === 'rightDock') {
    rightDocked = m.docked;
    if (rightDocked && !micState) {
      $('compose').hidden = true;
      $('chat').setAttribute('aria-expanded', 'false');
    }
    showSettings(false);
    return;
  }
  if (m.kind === 'bind') {
    generation = m.generation;
    globalPet = m.global === true;
    chatLabel(m);
    $('defaultMode').checked = m.desktopByDefault === true;
    $('defaultMode').disabled = false;
    controller.reset();
    controller.ambient(m.ambient);
    player.wake();
    rotationRequest = '';
    finishAfterRotation = false;
    closeAfterRotation = false;
    closeRequestId = '';
    rotationDirty = false;
    applyRotation(m.rotation);
    rotationBusy(!m.rotation);
    $('rotationStatus').textContent = '';
    selectedExpression = 'auto';
    player.expression('auto');
    updateExpressionOptions();
    seq = 0;
    pendingSend = '';
    $('send').disabled = false;
    $('words').value = '';
    notice('');
    recording = '';
    dockListening = !!m.listening;
    $('mic').hidden = !m.canRecord;
    setMic('');
    if (m.active) {
      event({ type: 'turn/start', data: { turn: m.turn } });
      for (const tool of m.tools) event({ type: 'tool/call', data: tool });
    }
    controller.listen(dockListening);
    void setVoice(m.voice);
    return;
  }
  if (m.generation !== generation) return;
  if (m.kind === 'chatTarget') {
    const mode = $('scene').value;
    chatLabel(m);
    controller.reset();
    seq = 0;
    if (m.active) {
      event({ type: 'turn/start', data: { turn: m.turn } });
      for (const tool of m.tools) event({ type: 'tool/call', data: tool });
    }
    dockListening = false;
    setMic(micState);
    // Restore the user's scene after clearing the old chat. Active replies and
    // recording still take priority through select()'s activity check.
    player.select(mode);
    layout();
  } else if (m.kind === 'ambient') {
    controller.ambient(m.value);
  } else if (m.kind === 'notice') {
    notice(m.text);
  } else if (m.kind === 'control') {
    void applyControl(m);
  } else if (m.kind === 'prepareClose') {
    closePet(m.id);
  } else if (m.kind === 'rotation') {
    applyRotation(m.value);
  } else if (m.kind === 'rotationSaved' && m.id === rotationRequest) {
    const finish = finishAfterRotation && !m.error;
    rotationRequest = '';
    finishAfterRotation = false;
    rotationBusy(false);
    if (!m.error) rotationDirty = false;
    applyRotation(m.value);
    $('rotationStatus').textContent = m.error || '已保存，桌宠与工作区设置同步生效。';
    if (m.error) {
      $('rotationSettings').open = true;
      showSettings(true);
    }
    if (closeAfterRotation) finishClose(m.error);
    else if (finish) finishSettings();
    else layout();
  } else if (m.kind === 'defaultMode') {
    $('defaultMode').checked = m.value;
    $('defaultMode').disabled = false;
    if (m.error) notice(m.error);
  } else if (m.kind === 'event') {
    if (m.chatGeneration === undefined || m.chatGeneration === chatGeneration) event(m.event);
  }
  else if (m.kind === 'listen') {
    dockListening = !!m.value;
    controller.listen(dockListening || !!micState || !!pendingSend);
  } else if (m.kind === 'mic' && m.id === recording) {
    if (['failed', 'cancelled'].includes(m.state)) {
      recording = '';
      setMic('');
      if (m.error) notice(m.error);
    } else setMic(m.state);
  } else if (m.kind === 'transcript' && m.id === recording) {
    recording = '';
    setMic('');
    if (m.error) notice(m.error);
    else if (m.text?.trim()) {
      $('words').value = [$('words').value.trim(), m.text.trim()].filter(Boolean).join(' ');
      $('words').focus();
    } else notice('没有识别到文字，请再试一次。');
  } else if (m.kind === 'speechResult') audioJobs.get(m.id)?.(m);
  else if (m.kind === 'sent' && m.id === pendingSend) {
    pendingSend = '';
    controller.listen(dockListening || !!micState);
    $('send').disabled = cannotSend();
    if (m.error) notice(m.error);
    else if ($('words').value.trim() === m.text) $('words').value = '';
  }
};
let peekDragged = false;
for (const node of [$('avatar'), $('drag'), edgePeek]) {
  let pointer = null,
    lastX = 0,
    lastY = 0,
    downX = 0,
    downY = 0;
  const move = (phase, x, y) => {
    if (node === edgePeek && Math.max(Math.abs(x - downX), Math.abs(y - downY)) >= 4) peekDragged = true;
    post({ kind: 'drag', phase, x, y });
  };
  node.onpointerdown = (e) => {
    if (e.button !== 0 || pointer !== null) return;
    pointer = e.pointerId;
    downX = lastX = e.screenX;
    downY = lastY = e.screenY;
    if (node === edgePeek) peekDragged = false;
    node.setPointerCapture(pointer);
    move('start', lastX, lastY);
  };
  node.onpointermove = (e) => {
    if (pointer !== e.pointerId) return;
    lastX = e.screenX;
    lastY = e.screenY;
    move('move', lastX, lastY);
  };
  node.onpointerup = (e) => {
    if (pointer === e.pointerId) {
      pointer = null;
      move('end', e.screenX, e.screenY);
    }
  };
  node.onlostpointercapture = () => {
    if (pointer !== null) {
      pointer = null;
      move('end', lastX, lastY);
    }
  };
}
edgePeek.onclick = (e) => {
  if (e.detail === 0 || !peekDragged) $('chat').click();
};
edgePeek.oncontextmenu = (e) => {
  e.preventDefault();
  showSettings(true);
};
$('close').onclick = () => closePet();
$('voice').onclick = () => void setVoice(!voiceOn);
$('stop').onclick = () => speaker.cancel();
$('chat').onclick = () => {
  const show = $('compose').hidden;
  if (!show && rightDocked && micState) return;
  $('compose').hidden = !show;
  $('chat').setAttribute('aria-expanded', String(show));
  showSettings(false);
  if (show) {
    post({ kind: 'focus' });
    $('words').focus();
  } else if (pet.hidden) edgePeek.focus({ preventScroll: true });
};
$('words').addEventListener('keydown', (e) => {
  if (e.isComposing && e.key === 'Enter') e.stopPropagation();
  if (e.key === 'Escape' && !micState) $('chat').click();
});
$('mic').onclick = () => {
  if (!generation) return;
  if (recording) {
    post({ kind: 'stopRecord', generation, id: recording });
    return;
  }
  recording = String(++nextId);
  setMic('requesting');
  post({ kind: 'record', generation, id: recording });
};
$('compose').onsubmit = (e) => {
  e.preventDefault();
  const text = $('words').value.trim();
  if (!text || pendingSend || micState || !generation) return;
  if (globalPet && !chatSession) { notice('先在 DSH 打开一间会话，再从桌宠发送消息。'); return; }
  pendingSend = String(++nextId);
  player.wake();
  controller.listen(true);
  $('send').disabled = true;
  post({ kind: 'send', generation, id: pendingSend, text, sessionId: chatSession, chatGeneration });
};
const player = createAvatarPlayer(
  controller,
  () => speaker.level(),
  matchMedia('(prefers-reduced-motion: reduce)').matches,
  { onMode: mode => { $('scene').value = mode; reportView(); } },
);
$('rotationSettings').addEventListener('toggle', layout);
$('rotationForm').addEventListener('input', () => {
  rotationDirty = true;
  $('rotationStatus').textContent = '尚未保存，点击“完成”或收回桌宠时会保存。';
});
function saveRotation(finish = false) {
  if (rotationRequest || !generation) return;
  try {
    const value = validateIdleRotation({ swing: $('swingSeconds').valueAsNumber, eat_rice: $('eatSeconds').valueAsNumber });
    finishAfterRotation = finish;
    rotationRequest = String(++nextId);
    rotationBusy(true);
    $('rotationStatus').textContent = '正在保存…';
    post({ kind: 'setRotation', generation, id: rotationRequest, value });
  } catch (error) {
    rotationRequest = '';
    finishAfterRotation = false;
    rotationBusy(false);
    $('rotationSettings').open = true;
    $('rotationStatus').textContent = error.message;
    showSettings(true);
    if (closeAfterRotation) finishClose(error.message);
  }
  layout();
}
$('rotationForm').onsubmit = e => {
  e.preventDefault();
  saveRotation();
};
for (const [value, label] of Object.entries({ auto: '自动', main: '聊天立姿', ...Object.fromEntries(Object.entries(idleScenes).map(([id,s]) => [id,s.label])) })) {
  $('scene').add(new Option(label, value));
}
for (const { value, label } of expressionOptions(currentScene)) {
  $('expression').add(new Option(label, value));
}
updateExpressionOptions();
$('scene').onchange = () => {
  if (!player.select($('scene').value)) { $('scene').value = 'auto'; notice('等这次回复结束就可以试待机场景。'); }
};
function chooseExpression(value) {
  const choice = expressionOptions(currentScene, currentState).find(option => option.value === value);
  if (choice && !choice.disabled && player.expression(choice.value)) {
    // Actions play once. Restore the expression selection so the same action can be chosen again.
    if (!choice.action) selectedExpression = choice.value;
    else if (selectedExpression === 'random') selectedExpression = 'auto';
  } else throw new Error('当前场景或状态暂不支持这个表情');
  updateExpressionOptions();
  reportView();
}
$('expression').onchange = () => {
  try { chooseExpression($('expression').value); }
  catch (error) { notice(error.message); updateExpressionOptions(); }
};
$('words').addEventListener('input', () => player.wake());
$('more').onclick = () => showSettings(true);
$('actions').onclick = () => showSettings($('settings').hidden);
$('pet').oncontextmenu = (e) => {
  if (e.target.closest('input')) return;
  e.preventDefault();
  showSettings($('settings').hidden);
};
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('settings').hidden) {
    e.preventDefault();
    $('done').click();
  }
});
try {
  await mountRenderer($('avatar'), new AbortController().signal, player.frame, {
    scene: player.scene, onSceneError: notice, onScene: id => {
      currentScene = id;
      updateExpressionOptions();
      fitWindow();
      reportView();
    },
  });
  post({ kind: 'ready', saveBeforeClose: true, controls: true });
} catch (e) {
  post({ kind: 'error', message: e.message || '无法加载桌宠模型' });
}
