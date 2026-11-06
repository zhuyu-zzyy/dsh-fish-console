import { watchDesktop, desktopAction } from './desktop-client.js?v=0.15.0';
import { expressionOptions, idleScenes } from './scenes.js';
import { idleRotation, validateIdleRotation, rotationLimits } from './idle-rotation.js';
import { labels } from './controller.js';

export function desktopSettings(React) {
  const h = React.createElement;
  const control = { color: 'inherit', background: 'transparent', border: '1px solid #8993ad70', borderRadius: 6, padding: '5px 8px', font: 'inherit' };
  const row = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, margin: '12px 0' };
  return function DesktopSettings({ active, sessions = [] }) {
    const [pet, setPet] = React.useState(null);
    const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [message, setMessage] = React.useState('');
    const [rotation, setRotation] = React.useState(idleRotation), dirty = React.useRef(false);
    const [scale, setScale] = React.useState(null), scaleDraft = React.useRef(null);
    React.useEffect(() => watchDesktop(setPet), []);
    React.useEffect(() => {
      if (!dirty.current && pet?.rotation) setRotation(pet.rotation);
    }, [pet?.rotation?.swing, pet?.rotation?.eat_rice]);
    if (!active) return null;
    if (!pet) return h('p', { role: 'status' }, '正在读取桌宠设置…');
    if (pet.protocolVersion !== 3) return h('p', { role: 'alert' }, '请重新加载控制台插件或重启 DSH，载入全局桌宠功能。');
    if (!pet.supported) return h('p', null, '桌宠目前支持 macOS。');
    const current = sessions.find(session => (session.nativeId || session.id) === pet.sessionId);
    const view = pet.view, live = pet.ready && pet.controls;
    const perform = async (data, success = '') => {
      if (busy) return;
      setBusy(true); setError(''); setMessage('');
      try { const value = await desktopAction(data); setPet(value); setMessage(success); return value; }
      catch (error) { setError(error.message); }
      finally { setBusy(false); }
    };
    const setControl = (name, value) => perform({ action: 'control', generation: pet.generation, name, value });
    const saveScale = async () => {
      if (scaleDraft.current === null || busy) return;
      const value = scaleDraft.current;
      scaleDraft.current = null;
      await setControl('scale', value);
      setScale(null);
    };
    const saveRotation = async () => {
      let value;
      try { value = validateIdleRotation({ swing: Number(rotation.swing), eat_rice: Number(rotation.eat_rice) }); }
      catch (error) { setError(error.message); return; }
      const saved = await perform({ action: 'setRotation', value }, '轮换时间已保存，桌宠同步生效。');
      if (saved) { dirty.current = false; setRotation(saved.rotation); }
    };
    const expressions = expressionOptions(view?.scene || 'main', view?.state || 'IDLE');
    const selectedExpression = expressions.some(choice => choice.value === view?.expression && !choice.disabled) ? view.expression : 'auto';
    return h('section', { 'aria-label': '桌宠设置' },
      h('p', null, '小肥鱼是全局桌宠，无需绑定会话。所有会话的任务状态都会同步到桌宠，聊天自动使用最近打开的会话。'),
      h('p', { role: 'status' }, pet.opened ? (pet.ready ? '全局桌宠已打开' : '正在打开桌宠…') + (view ? ' · ' + (labels[view.state] || '') : '') : '桌宠已收回'),
      pet.activity?.count > 0 && h('p', null, pet.activity.count + ' 个任务正在进行'),
      h('div', { style: row },
        h('button', { style: control, disabled: busy, onClick: () => perform({ action: 'open' }, '全局桌宠已打开。') }, pet.opened ? '显示桌宠' : '打开桌宠'),
        pet.opened && h('button', { style: control, disabled: busy, onClick: () => perform({ action: 'close', generation: pet.generation }, '桌宠已收回，可以在这里重新打开。') }, '收回桌宠')),
      h('p', { style: { opacity: .7, fontSize: 12 } }, pet.sessionId ? '聊天去向：' + (current?.title || pet.chatTitle || '最近打开的会话') + '。在 DSH 打开另一间会话时会自动切换。' : '打开任意 DSH 会话后，即可从桌宠聊天。'),
      h('label', { style: row }, h('input', { type: 'checkbox', checked: pet.desktopByDefault, disabled: busy,
        onChange: event => perform({ action: 'setDefault', value: event.target.checked }, '自动打开设置已保存。') }), '启动 DSH 时自动打开桌宠'),
      h('p', { style: { opacity: .7, fontSize: 12 } }, '没有打开会话也可以自动启动。手动收回后，本次运行不会自行弹出。'),
      h('h3', null, '外观与朗读'),
      !live && h('p', null, '打开桌宠后可调整大小、朗读和场景。'),
      h('label', { style: row }, '桌宠大小 ', h('input', { type: 'range', min: 20, max: 100, step: 1, value: scale ?? view?.scale ?? 100, disabled: busy || !live,
        onChange: event => { scaleDraft.current = Number(event.target.value); setScale(scaleDraft.current); },
        onPointerUp: saveScale, onKeyUp: saveScale, onBlur: saveScale }), h('output', null, (scale ?? view?.scale ?? 100) + '%')),
      h('div', { style: row }, h('button', { style: control, disabled: busy || !live, onClick: () => setControl('voice', !view?.voice) }, view?.voice ? '关闭朗读' : '开启朗读'),
        h('button', { style: control, disabled: busy || !live || !view?.voice, onClick: () => setControl('stopSpeech') }, '停止播报')),
      h('div', { style: row }, h('label', null, '待机场景 ', h('select', { style: control, value: view?.mode || 'auto', disabled: busy || !live || view?.state !== 'IDLE', onChange: event => setControl('scene', event.target.value) },
        ...[['auto', '自动'], ['main', '聊天立姿'], ...Object.entries(idleScenes).map(([id, scene]) => [id, scene.label])].map(([id, label]) => h('option', { key: id, value: id }, label)))),
        h('label', null, '场景表情 ', h('select', { style: control, value: selectedExpression, disabled: busy || !live, onChange: event => setControl('expression', event.target.value) },
          ...expressions.map(choice => h('option', { key: choice.value, value: choice.value, disabled: choice.disabled, style: choice.disabled ? { color: 'GrayText' } : {} }, choice.label))))),
      h('p', { style: { opacity: .7, fontSize: 12 } }, '随机播放只使用当前场景支持的表情或动作；灰色项暂不可用。回复或录音时暂停试播。'),
      h('h3', null, '自动轮换时间'),
      h('div', { style: row }, ...Object.entries({ swing: '荡秋千', eat_rice: '吃白米饭' }).map(([id, label]) => h('label', { key: id }, label, ' ',
        h('input', { style: { ...control, width: 90 }, type: 'number', min: rotationLimits.min, max: rotationLimits.max, step: 1, value: rotation[id], disabled: busy,
          onChange: event => { dirty.current = true; setRotation(current => ({ ...current, [id]: event.target.value })); setMessage(''); } }), ' 秒')),
        h('button', { style: control, disabled: busy, onClick: saveRotation }, '保存轮换时间')),
      h('p', { style: { opacity: .7, fontSize: 12 } }, '每项 5–3600 秒。保存后跨启动保留；夜间空闲两分钟后进入睡觉。'),
      busy && h('p', { role: 'status' }, '正在处理…'), message && h('p', { role: 'status' }, message),
      (error || pet.error) && h('p', { role: 'alert' }, error || pet.error));
  };
}
