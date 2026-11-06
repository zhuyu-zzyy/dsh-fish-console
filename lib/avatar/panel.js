import { createController, labels } from './controller.js';
import { referenceCards } from './actions.js';
import { createAvatarPlayer, idleScenes, sceneExpressions } from './scenes.js';
import { mountRenderer } from './renderer.js';
import { createVoice } from './voice.js';
import { idleRotation, rotationLimits, validateIdleRotation } from './idle-rotation.js';

const emotions = {
  neutral: '平静',
  happy: '开心',
  curious: '好奇',
  thinking: '思索',
  surprised: '惊讶',
  confused: '疑惑',
  sad: '难过',
};
const button = {
  border: '1px solid #909ac560',
  background: 'transparent',
  color: 'inherit',
  borderRadius: 6,
  fontSize: 12,
  padding: '3px 8px',
  cursor: 'pointer',
};
const fallback = new URL('./model/portrait.png', import.meta.url).href;

// Multiple chat panes share one EventSource instead of exhausting the browser's per-origin connections.
const petListeners = new Set();
let petEvents,
  petStatus = null;
function watchDesktop(callback) {
  petListeners.add(callback);
  if (petStatus) callback(petStatus);
  if (!petEvents) {
    petEvents = new EventSource('/fish-console/avatar/pet-updates');
    petEvents.onmessage = (e) => {
      try {
        petStatus = JSON.parse(e.data);
      } catch {
        return;
      }
      for (const listener of petListeners) listener(petStatus);
    };
  }
  return () => {
    petListeners.delete(callback);
    if (!petListeners.size) {
      petEvents.close();
      petEvents = undefined;
      petStatus = null;
    }
  };
}
async function desktopAction(data) {
  const res = await fetch('/fish-console/avatar/pet', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || '桌宠操作失败');
  return result;
}
export function avatarPanel(React) {
  const h = React.createElement;
  return function Panel({ sessionId, feed, running }) {
    const [open, setOpen] = React.useState(true),
      [large, setLarge] = React.useState(false),
      [voiceOn, setVoiceOn] = React.useState(false);
    const [pet, setPet] = React.useState(null),
      [moving, setMoving] = React.useState(false),
      [pendingDefault, setPendingDefault] = React.useState(null),
      [petError, setPetError] = React.useState('');
    const detached = pet?.sessionId === sessionId;
    const [ready, setReady] = React.useState(false),
      [notice, setNotice] = React.useState(''),
      [fault, setFault] = React.useState('');
    const [view, setView] = React.useState({ state: 'IDLE', emotion: 'neutral', tool: '', caption: '' });
    const [mode, setMode] = React.useState('auto'), [scene, setScene] = React.useState('main'),
      [expression, setExpression] = React.useState('auto');
    const [showRotation, setShowRotation] = React.useState(false),
      [rotationDraft, setRotationDraft] = React.useState(() => idleRotation()),
      [savingRotation, setSavingRotation] = React.useState(false),
      [rotationMessage, setRotationMessage] = React.useState('');
    const rotationDirty = React.useRef(false), rotation = React.useRef(idleRotation());
    const root = React.useRef(null),
      canvas = React.useRef(null),
      voice = React.useRef(null),
      player = React.useRef(null),
      initialRunning = React.useRef(running);
    React.useEffect(() => watchDesktop(setPet), []);
    React.useEffect(() => {
      rotation.current = idleRotation(pet?.rotation);
      player.current?.rotation(rotation.current);
      if (!rotationDirty.current) setRotationDraft(rotation.current);
    }, [pet?.rotation?.swing, pet?.rotation?.eat_rice]);
    React.useEffect(() => {
      if (!pet?.canAutoOpen) return;
      const dock = root.current;
      const pane = dock?.closest('[data-conversation-session]');
      if (!pane) return;
      let requested = false;
      const tryOpen = (event) => {
        if (requested || document.hidden || !document.hasFocus() || !dock.getClientRects().length) return;
        // When several chats are visible, wait for the user to focus or click one of them.
        const visible = [...document.querySelectorAll('[data-conversation-session]')].filter(
          (other) => other.getClientRects().length,
        );
        if (visible.length > 1 && !pane.contains(document.activeElement) &&
            !(event?.target instanceof Node && pane.contains(event.target))) return;
        requested = true;
        desktopAction({ action: 'autoOpen', sessionId, voice: open && voiceOn }).catch((e) => setPetError(e.message));
      };
      const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) tryOpen(); });
      observer.observe(dock);
      pane.addEventListener('focusin', tryOpen);
      pane.addEventListener('pointerdown', tryOpen);
      window.addEventListener('focus', tryOpen);
      document.addEventListener('visibilitychange', tryOpen);
      return () => {
        observer.disconnect();
        pane.removeEventListener('focusin', tryOpen);
        pane.removeEventListener('pointerdown', tryOpen);
        window.removeEventListener('focus', tryOpen);
        document.removeEventListener('visibilitychange', tryOpen);
      };
    }, [pet?.canAutoOpen, sessionId, open, voiceOn]);
    // The native window stays bound even when the chat UI is hidden. Forward DSH's own microphone indication.
    React.useEffect(() => {
      if (!detached) return;
      const pane = root.current?.closest('[data-conversation-session]');
      const composer = pane?.querySelector('[data-conversation-region="composer"]');
      if (!composer || pane.dataset.conversationSession !== sessionId) return;
      const binding = { sessionId, generation: pet.generation };
      let last = false,
        serial = Promise.resolve();
      const update = (value) => {
        if (last === value) return;
        last = value;
        serial = serial.then(() => desktopAction({ ...binding, action: 'listen', value })).catch(() => {});
      };
      const scan = () =>
        update(
          !!composer.querySelector(
            '[data-voice-activity="recording"],[data-voice-activity="requesting"],[data-voice-activity="transcribing"]',
          ),
        );
      const observer = new MutationObserver(scan);
      observer.observe(composer, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-voice-activity'],
      });
      scan();
      return () => {
        observer.disconnect();
        if (last) update(false);
      };
    }, [detached, pet?.generation, sessionId]);
    React.useEffect(() => {
      if (!open || detached) return;
      const lifetime = new AbortController();
      let live = true,
        releaseFeed,
        micObserver;
      const publish = (v) => {
        if (live) setView(v);
      };
      const controller = createController({
        publish,
        speak: (text) => speaker.enqueue(text),
        cancel: () => speaker.cancel(),
      });
      const speaker = createVoice({
        sessionId,
        playback: (v) => controller.playback(v),
        notice: (m) => {
          if (live) setNotice(m);
        },
      });
      voice.current = speaker;
      setReady(false);
      setFault('');
      setNotice('');
      setVoiceOn(false);
      // Subscribe even if WebGL is unavailable, to keep the accessible status and voice controls usable.
      if (!document.hidden) releaseFeed = controller.watch(feed, initialRunning.current);
      const clock = setInterval(() => controller.tick(), 250);
      const occurrence = root.current?.closest('[data-conversation-session]');
      const composer = occurrence || root.current?.parentElement;
      if (composer && occurrence?.dataset.conversationSession === sessionId) {
        const scan = () =>
          controller.listen(
            !!composer.querySelector(
              '[data-voice-activity="recording"],[data-voice-activity="requesting"],[data-voice-activity="transcribing"]',
            ),
          );
        micObserver = new MutationObserver(scan);
        micObserver.observe(composer, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['data-voice-activity'],
        });
        scan();
      }
      const visibility = () => {
        if (document.hidden) {
          releaseFeed?.();
          releaseFeed = undefined;
          controller.reset();
          speaker.disable();
          setVoiceOn(false);
        } else if (!releaseFeed) releaseFeed = controller.watch(feed);
      };
      document.addEventListener('visibilitychange', visibility);
      const lost = (e) => {
        e.preventDefault();
        if (live) {
          setReady(false);
          setFault('图形上下文已中断，收起再展开可重新加载。');
        }
      };
      const node = canvas.current;
      node.addEventListener('webglcontextlost', lost);
      setMode('auto');
      setExpression('auto');
      const performer = createAvatarPlayer(
        controller,
        () => speaker.level(),
        matchMedia('(prefers-reduced-motion: reduce)').matches,
        { rotation: rotation.current, onMode: value => { if (live) setMode(value); } },
      );
      player.current = performer;
      const input = event => {
        const node = event.target instanceof Element ? event.target : null;
        if (node?.closest('[data-conversation-region="composer"]') &&
            node.closest('[data-conversation-session]')?.dataset.conversationSession === sessionId) performer.wake();
      };
      const inputEvents = ['beforeinput', 'input', 'compositionstart', 'paste'];
      for (const type of inputEvents) document.addEventListener(type, input, true);
      mountRenderer(node, lifetime.signal, performer.frame, {
        scene: performer.scene, onScene: id => { if (live) setScene(id); },
        onSceneError: message => { if (live) setNotice(message); },
      })
        .then(() => {
          if (live) setReady(true);
        })
        .catch((e) => {
          if (live) setFault(e.message);
        });
      return () => {
        live = false;
        clearInterval(clock);
        for (const type of inputEvents) document.removeEventListener(type, input, true);
        releaseFeed?.();
        micObserver?.disconnect();
        document.removeEventListener('visibilitychange', visibility);
        node.removeEventListener('webglcontextlost', lost);
        lifetime.abort();
        speaker.dispose();
        voice.current = null;
        player.current = null;
      };
    }, [sessionId, feed, open, detached]);
    const toggleVoice = async () => {
      const speaker = voice.current;
      if (!speaker) return;
      if (voiceOn) {
        speaker.disable();
        setVoiceOn(false);
        return;
      }
      try {
        if ((await speaker.enable()) === false) return;
        if (voice.current === speaker) {
          setVoiceOn(true);
          setNotice('');
        }
      } catch (e) {
        if (voice.current === speaker) setNotice(e.message);
      }
    };
    const desktop = async (action, value) => {
      if (moving) return;
      setMoving(true);
      setPetError('');
      if (action === 'setDefault') setPendingDefault(value);
      const wanted = !!(open && voiceOn),
        speaker = voice.current;
      const transferring = action === 'open' || (action === 'setDefault' && value && !pet.sessionId);
      if (transferring && wanted) {
        speaker?.disable();
        setVoiceOn(false);
      }
      try {
        setPet(
          await desktopAction({
            action, value,
            sessionId,
            generation: pet?.generation,
            voice: wanted,
          }),
        );
      } catch (e) {
        setPetError(e.message);
        if (transferring && wanted && speaker && voice.current === speaker) {
          try {
            if (await speaker.enable()) setVoiceOn(true);
          } catch {}
        }
      } finally {
        setMoving(false);
        setPendingDefault(null);
      }
    };
    const saveRotation = async () => {
      if (savingRotation) return;
      try {
        const value = validateIdleRotation({ swing: Number(rotationDraft.swing), eat_rice: Number(rotationDraft.eat_rice) });
        setSavingRotation(true);
        setRotationMessage('正在保存…');
        const state = await desktopAction({ action: 'setRotation', value });
        rotationDirty.current = false;
        setRotationDraft(state.rotation);
        setPet(state);
        setRotationMessage('已保存，桌宠与聊天面板同步生效。');
      } catch (error) { setRotationMessage(error.message); }
      finally { setSavingRotation(false); }
    };
    return h(
      'section',
      {
        ref: root,
        'aria-label': '小肥鱼角色',
        'data-fish-avatar-session': sessionId,
        style: {
          border: '1px solid #919ac64a',
          borderRadius: 12,
          background: 'linear-gradient(112deg,#849ede20,#a5b9ed0e)',
          margin: '5px 0',
          overflow: 'hidden',
        },
      },
      h(
        'div',
        { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '5px 10px' } },
        h('strong', { style: { fontSize: 13 } }, '小肥鱼'),
        detached &&
          h(
            'span',
            { role: 'status', style: { fontSize: 12 } },
            pet.ready ? '已在桌面 · 跟随此会话' : '正在打开桌宠…',
          ),
        open &&
          !detached &&
          h(
            'span',
            { role: 'status', style: { fontSize: 12, opacity: 0.75 } },
            labels[view.state],
            ' · ',
            emotions[view.emotion],
          ),
        h('span', { style: { flex: 1 } }),
        pet?.rotation && h('button', {
          type: 'button', style: button, 'aria-expanded': showRotation, onClick: () => setShowRotation(!showRotation),
        }, '轮换时间'),
        pet?.supported &&
          h('label', { style: { fontSize: 12, cursor: 'pointer' } },
            h('input', {
              type: 'checkbox', checked: pendingDefault ?? pet.desktopByDefault, disabled: moving,
              onChange: (e) => desktop('setDefault', e.target.checked),
            }), '默认使用桌宠模式'),
        pet?.supported &&
          h(
            'button',
            { type: 'button', style: button, disabled: moving, onClick: () => desktop(detached ? 'close' : 'open') },
            moving ? '请稍候…' : detached ? '收回桌宠' : pet.sessionId ? '桌宠跟随此会话' : '桌宠模式',
          ),
        open &&
          !detached &&
          h(
            'button',
            { type: 'button', style: button, 'aria-pressed': large, onClick: () => setLarge(!large) },
            large ? '还原大小' : '放大角色',
          ),
        !detached &&
          h(
            'button',
            { type: 'button', style: button, 'aria-expanded': open, onClick: () => setOpen(!open) },
            open ? '收起角色' : '展开角色',
          ),
      ),
      petError && h('div', { role: 'status', style: { padding: '3px 10px' } }, petError),
      showRotation && h('div', { role: 'group', 'aria-label': '自动轮换时间', style: { padding: '5px 12px 9px', fontSize: 12 } },
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' } },
          ...Object.entries({ swing: '荡秋千', eat_rice: '吃白米饭' }).map(([id, label]) => h('label', { key: id },
            label, ' ', h('input', {
              type: 'number', min: rotationLimits.min, max: rotationLimits.max, step: 1, required: true,
              value: rotationDraft[id], disabled: savingRotation,
              style: { width: 72, font: 'inherit', color: 'inherit', background: 'transparent', border: '1px solid #909ac580', borderRadius: 4, padding: 3 },
              onChange: event => {
                rotationDirty.current = true;
                setRotationDraft(current => ({ ...current, [id]: event.target.value }));
                setRotationMessage('');
              },
            }), ' 秒')),
          h('button', { type: 'button', style: button, disabled: savingRotation, onClick: saveRotation }, '保存轮换时间'),
        ),
        h('div', { style: { marginTop: 5, opacity: .75 } }, '每项 5–3600 秒，自动模式下生效。夜间空闲两分钟后进入睡觉。'),
        rotationMessage && h('div', { role: 'status', style: { marginTop: 4 } }, rotationMessage),
      ),
      open &&
        !detached &&
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 12, padding: '0 12px 8px' } },
          h(
            'div',
            {
              style: {
                position: 'relative',
                width: large ? 'min(37%, 310px)' : 'clamp(90px,17vw,150px)',
                height: scene === 'sleep' ? 'auto' : large ? 'clamp(160px,38vh,360px)' : 'clamp(110px,19vh,170px)',
                aspectRatio: scene === 'sleep' ? '3 / 2' : undefined,
                flexShrink: 0,
              },
            },
            !ready &&
              h('img', {
                src: fallback,
                alt: '小肥鱼正面立绘',
                style: { width: '100%', height: '100%', objectFit: 'contain' },
              }),
            h('canvas', {
              ref: canvas,
              'aria-label': '小肥鱼动态角色',
              style: { position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: ready ? 1 : 0 },
            }),
          ),
          h(
            'div',
            { style: { minWidth: 0, flex: '1', fontSize: 12, lineHeight: 1.5 } },
            view.tool && h('div', { 'data-fish-tool': true }, '工具 · ', view.tool),
            view.progress && h('div', { role: 'status' }, '进度 · ', view.progress),
            h(
              'div',
              { style: { maxHeight: '4.5em', overflow: 'auto', overflowWrap: 'anywhere' } },
              view.caption || '用当前聊天输入框和我说话。点输入框的麦克风，说完后发送。',
            ),
            h(
              'div',
              { style: { display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' } },
              h(
                'button',
                { type: 'button', style: button, 'aria-pressed': voiceOn, onClick: toggleVoice },
                voiceOn ? '关闭朗读' : '开启朗读',
              ),
              voiceOn &&
                h('button', { type: 'button', style: button, onClick: () => voice.current?.cancel() }, '停止播报'),
            ),
            large &&
              ready &&
              h(
                'details',
                { style: { marginTop: 7 } },
                h('summary', { style: { cursor: 'pointer' } }, '试动作'),
                h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 5 } },
                  h('label', null, '待机场景 ', h('select', {
                    value: mode, disabled: view.state !== 'IDLE', onChange: e => player.current?.select(e.target.value),
                  }, ...[['auto','自动'], ['main','聊天立姿'], ...Object.entries(idleScenes).map(([id,s]) => [id,s.label])]
                    .map(([value,label]) => h('option', { key: value, value }, label)))),
                  h('label', null, '场景表情 ', h('select', {
                    value: expression, disabled: scene === 'main' || scene === 'sleep',
                    onChange: e => { setExpression(e.target.value); player.current?.expression(e.target.value); },
                  }, ...Object.entries({ auto: '场景默认', neutral: '自然', ...sceneExpressions })
                    .map(([value,label]) => h('option', { key: value, value }, label)))),
                ),
                h(
                  'div',
                  { style: { display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 5 } },
                  ...referenceCards.map((card) =>
                    h(
                      'button',
                      {
                        key: card.id,
                        type: 'button',
                        style: button,
                        disabled: view.state !== 'IDLE',
                        onClick: () => player.current?.preview(card.id),
                      },
                      card.label,
                    ),
                  ),
                ),
              ),
            (!feed || notice || fault) &&
              h(
                'div',
                { role: 'status', style: { marginTop: 4 } },
                [!feed && '当前 DSH 未提供会话事件。', notice, fault].filter(Boolean).join(' '),
              ),
          ),
        ),
    );
  };
}
