window.__ModuleLoader__.load({ id: 'dsh-fish-console', factory: require => {
  const React = require('react'), h = React.createElement;
  // The host owns the theme. Keep all console styles scoped, including the lazy desktop panel.
  const control = { boxSizing: 'border-box' };
  const muted = { color: 'var(--fc-muted)', fontSize: 12, lineHeight: 1.7 };
  const card = { border: '1px solid var(--fc-border)', borderRadius: 12, padding: 16, margin: '16px 0', minWidth: 0, background: 'var(--fc-card)' };
  const tabs = [['role', '统一角色'], ['private', '与我私聊'], ['bindings', '工作区绑定'], ['coverage', '覆盖检查'], ['screen', '屏幕感知'], ['desktop', '桌宠']];
  const consoleStyles = `
    .fish-console {
      --fc-text: var(--dsw-alias-label-primary, light-dark(#24262b, #f2f2f3));
      --fc-muted: var(--dsw-alias-label-secondary, light-dark(#626772, #b3b5bd));
      --fc-border: var(--dsw-alias-border-l2, light-dark(#dedfe5, #45464d));
      --fc-surface: var(--dsw-alias-bg-layer-2, light-dark(#fff, #2c2c2e));
      --fc-card: color-mix(in srgb, var(--fc-text) 2%, var(--fc-surface));
      --fc-hover: var(--dsw-alias-interactive-bg-hover, light-dark(#f0f1f5, #393a42));
      --fc-accent: var(--dsw-alias-brand-primary, light-dark(#5645d9, #a69aff));
      --fc-danger: var(--dsw-alias-label-error, light-dark(#bc3040, #ff9aa4));
      --fc-success: var(--dsw-alias-state-success-primary, light-dark(#217b50, #85cda8));
      --fc-warn: var(--dsw-alias-state-warn-label, light-dark(#8b5b0c, #e9be74));
      container: fish-console / inline-size;
      color: var(--fc-text); font: 14px/1.65 var(--dsw-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      width: 100%; max-width: 960px; min-width: 0; margin-inline: auto; padding: 16px 16px 32px;
      overflow-wrap: anywhere; box-sizing: border-box;
    }
    .fish-console *, .fish-console *::before, .fish-console *::after { box-sizing: border-box; }
    .fish-console [hidden] { display: none !important; }
    .fish-console h2 { font-size: 22px; line-height: 1.4; letter-spacing: -.3px; margin: 0 0 8px; font-weight: 650; }
    .fish-console h3 { font-size: 15px; line-height: 1.5; margin: 24px 0 10px; font-weight: 650; }
    .fish-console p { margin: 8px 0 12px; }
    .fish-console strong { font-weight: 600; }
    .fish-console button, .fish-console select, .fish-console textarea,
    .fish-console input:not([type=checkbox]):not([type=range]) {
      font: inherit; font-size: 13px; line-height: 1.5; color: var(--fc-text); background: var(--fc-surface);
      border: 1px solid var(--fc-border); border-radius: 8px; padding: 8px 11px; min-height: 36px; max-width: 100%;
      transition: background .15s ease, border-color .15s ease, box-shadow .15s ease;
    }
    .fish-console button { cursor: pointer; font-weight: 500; text-align: center; }
    .fish-console button:not(:disabled):hover { background: var(--fc-hover); border-color: color-mix(in srgb, var(--fc-text) 30%, var(--fc-border)); }
    .fish-console button:not(:disabled):active { background: color-mix(in srgb, var(--fc-text) 12%, var(--fc-surface)); }
    .fish-console :is(button, input, textarea, select, summary):focus-visible {
      outline: 2px solid var(--fc-accent); outline-offset: 3px;
    }
    .fish-console :is(input, textarea, select):focus { border-color: var(--fc-accent); }
    .fish-console :is(button, input, textarea, select):disabled { opacity: .45; cursor: not-allowed; }
    .fish-console :is(input, textarea)::placeholder { color: var(--fc-muted); opacity: .8; }
    .fish-console textarea { display: block; width: 100%; min-height: 180px; resize: vertical; }
    .fish-console input[type=checkbox] { width: 16px; height: 16px; margin: 0 7px 0 0; vertical-align: -3px; accent-color: var(--fc-accent); cursor: pointer; }
    .fish-console input[type=range] { accent-color: var(--fc-accent); min-width: 100px; max-width: 100%; }
    .fish-console select { cursor: pointer; text-overflow: ellipsis; }
    .fish-console option { color: var(--fc-text); background: var(--fc-surface); }
    .fish-console .fc-primary { background: var(--dsw-alias-button-primary-fill, #6754e8); color: var(--dsw-alias-label-primary-foreground, #fff); border-color: transparent; }
    .fish-console .fc-primary:not(:disabled):hover { background: var(--dsw-alias-button-primary-hover, #7563eb); border-color: transparent; }
    .fish-console .fc-danger:not(:disabled) { color: var(--fc-danger); }
    .fish-console .fc-danger:not(:disabled):hover { background: color-mix(in srgb, var(--fc-danger) 10%, var(--fc-surface)); border-color: var(--fc-danger); }
    .fish-console .fc-header { margin-bottom: 20px; }
    .fish-console .fc-header p { color: var(--fc-muted); font-size: 13px; margin: 0; }
    .fish-console .fc-toolbar { position: sticky; top: 0; z-index: 3; background: var(--fc-surface); padding: 12px; border: 1px solid var(--fc-border); border-radius: 10px; margin: 0 0 16px; }
    .fish-console .fc-toolbar-line, .fish-console .fc-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .fish-console .fc-save-state { margin-left: auto; font-size: 12px; color: var(--fc-muted); }
    .fish-console .fc-save-state[data-dirty=true] { color: var(--fc-warn); }
    .fish-console .fc-toolbar-note { font-size: 12px; color: var(--fc-muted); margin: 8px 0 0; }
    .fish-console .fc-role-picker { display: flex; flex-wrap: wrap; gap: 12px 16px; align-items: end; margin: 0 0 16px; }
    .fish-console .fc-role-picker .fc-field { flex: 1 1 200px; }
    .fish-console .fc-role-meta { margin: 0 0 18px; color: var(--fc-muted); font-size: 12px; }
    .fish-console .fc-tabs { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 4px; padding: 4px; border: 1px solid var(--fc-border); border-radius: 10px; background: var(--fc-card); margin: 0 0 20px; }
    .fish-console .fc-tabs button { border-color: transparent; background: transparent; padding: 8px 4px; min-width: 0; border-radius: 6px; white-space: nowrap; color: var(--fc-muted); }
    .fish-console .fc-tabs button[aria-selected=true] { color: var(--fc-text); background: var(--fc-surface); border-color: var(--fc-border); font-weight: 650; box-shadow: inset 0 -2px var(--fc-accent); }
    .fish-console .fc-card { background: var(--fc-card); border: 1px solid var(--fc-border); border-radius: 12px; padding: 16px; margin: 0 0 16px; min-width: 0; }
    .fish-console .fc-card > h3:first-child { margin-top: 0; }
    .fish-console .fc-card > :last-child { margin-bottom: 0; }
    .fish-console .fc-field { display: flex; flex-direction: column; gap: 7px; min-width: 0; font-size: 13px; font-weight: 500; margin: 0; }
    .fish-console .fc-field :is(input, select, textarea) { width: 100%; font-weight: 400; }
    .fish-console .fc-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .fish-console .fc-fields > .fc-wide { grid-column: 1 / -1; }
    .fish-console .fc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: 12px; margin-top: 12px; }
    .fish-console .fc-grid > .fc-card { margin: 0; }
    .fish-console .fc-card-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
    .fish-console .fc-badge { display: inline-block; font-size: 11px; font-weight: 500; padding: 2px 8px; border-radius: 6px; color: var(--fc-muted); background: var(--fc-hover); }
    .fish-console .fc-badge[data-tone=success] { color: var(--fc-success); background: color-mix(in srgb, var(--fc-success) 10%, var(--fc-surface)); }
    .fish-console .fc-badge[data-tone=warning] { color: var(--fc-warn); background: color-mix(in srgb, var(--fc-warn) 10%, var(--fc-surface)); }
    .fish-console [role=alert], .fish-console .fc-feedback { padding: 10px 12px; border: 1px solid var(--fc-border); border-radius: 8px; font-size: 13px; background: var(--fc-card); }
    .fish-console [role=alert] { color: var(--fc-danger); border-color: color-mix(in srgb, var(--fc-danger) 45%, var(--fc-border)); }
    .fish-console .fc-feedback[data-tone=success] { color: var(--fc-success); }
    .fish-console .fc-choice { display: block; border: 1px solid var(--fc-border); border-radius: 8px; padding: 12px; margin: 8px 0; cursor: pointer; }
    .fish-console .fc-choice:has(input:checked) { border-color: color-mix(in srgb, var(--fc-accent) 50%, var(--fc-border)); background: color-mix(in srgb, var(--fc-accent) 5%, var(--fc-surface)); }
    .fish-console .fc-choice:has(input:disabled) { cursor: default; }
    .fish-console .fc-choice:not(:has(input:disabled)):hover { background: var(--fc-hover); }
    .fish-console .fc-choice > div { margin-top: 4px; }
    .fish-console details { border: 1px solid var(--fc-border); border-radius: 10px; padding: 12px 14px; margin: 16px 0; }
    .fish-console summary { cursor: pointer; font-size: 13px; font-weight: 500; }
    .fish-console details[open] > summary { margin-bottom: 12px; }
    .fish-console .fc-empty { padding: 20px; border: 1px dashed var(--fc-border); border-radius: 10px; color: var(--fc-muted); font-size: 13px; }
    .fish-console .fc-desktop-row { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin: 12px 0; }
    .fish-console .fc-scale input { flex: 1; }
    .fish-console .fc-scale output { width: 44px; text-align: right; font-variant-numeric: tabular-nums; }
    .fish-console .fc-guide { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    @container fish-console (max-width: 460px) {
      .fish-console .fc-tabs { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .fish-console .fc-fields { grid-template-columns: 1fr; }
      .fish-console .fc-role-picker { align-items: stretch; }
      .fish-console .fc-role-picker .fc-field { flex-basis: 100%; }
      .fish-console .fc-save-state { flex-basis: 100%; margin-left: 0; }
    }
    @media (prefers-reduced-motion: reduce) { .fish-console * { transition: none !important; } }
  `;
  const categoryNames = { conversation: '常规会话', subagent: '子代理', memory: '记忆内部调用', mood: '心情内部调用', bili: 'B站内部调用', other: '其他调用' };
  const statusNames = { covered: '确认携带', uncovered: '未携带当前人设', unbound: '未绑定角色', unknown: '归属不明' };
  const sourceNames = { workspace: '工作区绑定' };
  const pluginNames = { memory: '鱼的记忆', mood: '鱼的心情', bili: '刷B站', qq: '通到 QQ' };
  const syncNames = { synced: '已同步', partial: '部分同步', failed: '未确认', conflict: '存在冲突', unsupported: '版本未适配', not_bound: '无对应绑定', not_configured: '未配置' };
  const runtimeUpgradeMessage = '应用后端尚未载入此功能，请完整退出并重新打开 DeepSeek Harness；只刷新设置页不够。';
  const serviceError = (message, code = 'invalid_service_response') => Object.assign(new Error(message), { code });
  let guideState = { active: false, returnScreen: false, draft: null }, navigateSettings, stopHighlight;
  const guideListeners = new Set();
  function updateGuide(value) { guideState = value; for (const listener of guideListeners) listener(value); }
  function endGuide() { stopHighlight?.(); stopHighlight = undefined; updateGuide({ active: false, returnScreen: false, draft: null }); }
  function locateBiliTarget(instruction) {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {};
    let target, note, previousOutline, previousOffset, timer;
    const find = () => {
      const panel = document.querySelector('[data-shortcut-modal="settings"]');
      const section = [...(panel?.querySelectorAll('[data-bd-sec][data-bd-in="daily"]') || [])]
        .find(node => node.querySelector('[data-bd-h]')?.textContent.trim() === '自动刷在哪个会话');
      const select = section?.querySelector('select[data-bd-input]');
      if (!select) return;
      target = section; previousOutline = section.style.outline; previousOffset = section.style.outlineOffset;
      section.style.outline = '2px solid #8ab4f8'; section.style.outlineOffset = '6px';
      if (instruction) {
        note = document.createElement('p');
        note.textContent = instruction;
        note.setAttribute('role', 'note');
        note.style.fontWeight = '600';
        select.before(note);
      }
      section.scrollIntoView({ block: 'center', behavior: 'smooth' }); select.focus({ preventScroll: true });
      observer.disconnect(); clearTimeout(timer);
    };
    const observer = new MutationObserver(find);
    observer.observe(document.body, { childList: true, subtree: true });
    timer = setTimeout(() => observer.disconnect(), 5000); find();
    return () => { observer.disconnect(); clearTimeout(timer); note?.remove(); if (target) { target.style.outline = previousOutline; target.style.outlineOffset = previousOffset; } };
  }
  function GuideActions() {
    const [guide, setGuide] = React.useState(guideState), [error, setError] = React.useState('');
    React.useEffect(() => { guideListeners.add(setGuide); return () => guideListeners.delete(setGuide); }, []);
    if (!guide.active) return null;
    return h('div', { className: 'fish-console', style: { maxWidth: 550, padding: 0 } }, h('style', null, consoleStyles), h('div', { className: 'fc-guide' },
      h('span', { style: muted }, guide.instruction, ' 看到“自动刷会话：已保存”后返回。'),
      h('button', { style: control, onClick: () => {
        try { updateGuide({ ...guideState, returnScreen: true }); stopHighlight?.(); navigateSettings?.('fish-console'); setError(''); }
        catch { setError('请点击左侧“大肥鱼工作区”，再打开“屏幕感知”继续。'); }
      } }, '返回屏幕感知'),
      h('button', { style: control, onClick: endGuide }, '结束引导'),
      error && h('span', { role: 'alert' }, error)));
  }
  async function json(url, body) {
    const response = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
    const text = await response.text();
    if (url === '/fish-console/screen/open-permissions' && [404, 405].includes(response.status)) throw serviceError(runtimeUpgradeMessage, 'runtime_upgrade_required');
    if (!text.trim()) throw serviceError('控制台服务没有返回有效结果，请完整退出并重新打开 DeepSeek Harness 后重试。');
    let value;
    try { value = JSON.parse(text); }
    catch { throw serviceError('控制台服务返回了非预期响应，请完整退出并重新打开 DeepSeek Harness 后重试。'); }
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.ok !== 'boolean') throw serviceError('控制台服务返回了非预期响应，请完整退出并重新打开 DeepSeek Harness 后重试。');
    if (!response.ok || !value.ok) {
      const error = new Error(value.error || '请求失败');
      if (Array.isArray(value.screenIssues)) error.screenIssues = value.screenIssues;
      throw error;
    }
    return value;
  }
  function ScreenPage({ active, sessions }) {
    const [data, setData] = React.useState(null), [editor, setEditor] = React.useState(guideState.returnScreen && guideState.draft ? structuredClone(guideState.draft) : null);
    const [action, setAction] = React.useState(''), [error, setError] = React.useState(''), [message, setMessage] = React.useState('');
    const [saveIssues, setSaveIssues] = React.useState(null);
    const [preview, setPreview] = React.useState(null);
    const generation = React.useRef(0), pending = React.useRef(false);
    const accept = (value, replaceDraft = false) => {
      setData(value);
      if (replaceDraft) setSaveIssues(null);
      else if (Array.isArray(value.screenIssues)) setSaveIssues(previous => {
        const ids = value.config?.sessions || [];
        return previous && previous.ids.length === ids.length && previous.ids.every(id => ids.includes(id)) ? null : previous;
      });
      if (value.config?.enabled === false) setPreview(null);
      if (value.protocolVersion !== 1 || !value.config) return;
      setEditor(previous => !previous || replaceDraft || JSON.stringify(previous.config) === JSON.stringify(previous.savedConfig)
        ? { config: structuredClone(value.config), savedConfig: structuredClone(value.config), baseRevision: value.baseRevision }
        : previous);
    };
    React.useEffect(() => {
      if (!active) return;
      let live = true;
      const load = async () => {
        if (pending.current) return;
        const started = generation.current;
        try { const value = await json('/fish-console/screen'); if (live && started === generation.current) accept(value); }
        catch (e) { if (live && started === generation.current) setError('屏幕感知接口暂不可用：' + e.message); }
      };
      void load();
      const timer = setInterval(load, 8000);
      return () => { live = false; clearInterval(timer); };
    }, [active]);
    const reload = async () => {
      const current = ++generation.current;
      pending.current = true; setAction('reload'); setError('');
      try { const value = await json('/fish-console/screen'); if (current === generation.current) { accept(value, true); endGuide(); setMessage('已读取保存的屏幕设置。'); } }
      catch (e) { if (current === generation.current) setError(e.message); }
      finally { if (current === generation.current) { generation.current++; pending.current = false; setAction(''); } }
    };
    const request = async (kind, nextEditor = editor) => {
      if (pending.current && kind !== 'pause') return;
      const current = ++generation.current;
      pending.current = true; setAction(kind); setError(''); setMessage('');
      try {
        const value = await json('/fish-console/screen/' + kind, kind === 'config'
          ? { config: nextEditor.config, baseRevision: nextEditor.baseRevision }
          : kind === 'capture' ? { baseRevision: data.baseRevision } : {});
        if (current !== generation.current) return;
        accept(value, kind !== 'capture');
        if (kind === 'pause') { endGuide(); setPreview(null); setMessage('屏幕感知已暂停，设置草稿已按保存值刷新。'); }
        else if (kind === 'capture') { setPreview(value.config?.enabled ? value.preview || null : null); setMessage('已生成本机预览，本次预览没有发送给模型。'); }
        else { endGuide(); setMessage(value.config?.enabled ? '屏幕设置已即时保存并启用；在授权会话中新发一条本机消息后生效。' : '屏幕设置已即时保存，当前保持暂停。'); }
      } catch (e) {
        if (current === generation.current) {
          if (kind === 'config') setSaveIssues(e.screenIssues ? { ids: nextEditor.config.sessions, issues: e.screenIssues } : null);
          setError((kind === 'config' ? '屏幕设置未保存：' : '') + e.message);
        }
      }
      finally { if (current === generation.current) { generation.current++; pending.current = false; setAction(''); } }
    };
    const showPreview = async () => {
      const current = ++generation.current;
      pending.current = true; setAction('preview'); setError('');
      try { const value = await json('/fish-console/screen/preview'); if (current === generation.current) { setPreview(value.preview || null); setMessage(value.preview ? '正在显示最近一次截图。' : '暂时没有可查看的截图。'); } }
      catch (e) { if (current === generation.current) setError(e.message); }
      finally { if (current === generation.current) { generation.current++; pending.current = false; setAction(''); } }
    };
    const dirty = !!editor && JSON.stringify(editor.config) !== JSON.stringify(editor.savedConfig);
    const conflict = !!editor && !!data && editor.baseRevision !== data.baseRevision;
    const edit = patch => {
      if (pending.current || dirty || conflict) return;
      const next = { ...editor, config: { ...editor.config, ...patch } };
      setEditor(next); setMessage('');
      void request('config', next);
    };
    const sessionMap = new Map(sessions.map(session => [session.id, session]));
    for (const id of editor?.config.sessions || []) if (!sessionMap.has(id)) sessionMap.set(id, { id, title: '当前名单中不可用的会话', available: false });
    const status = data?.status || {}, compatible = data?.protocolVersion === 1 && !!editor;
    const permissionsAvailable = data?.capabilities?.openPermissions === true;
    const capture = status.lastCapture;
    const chosen = editor?.config.sessions || [];
    const issues = (saveIssues?.issues ?? data?.screenIssues ?? []).filter(item => !item.sessionId || chosen.includes(item.sessionId));
    const targetIssue = issues.find(item => item.kind === 'bili-target');
    const legacyRouting = !saveIssues && !Array.isArray(data?.screenIssues);
    const automatic = issues.some(item => item.kind === 'bili-automatic') || (legacyRouting && error.includes('B站正在自动选择会话'));
    const biliBlocked = !!targetIssue || automatic || (legacyRouting && error.includes('已连接 B站任务'));
    const suggested = sessions.filter(s => s.title === '刷B站内容' && !chosen.includes(s.id) && !s.parentId && s.origin !== 'subagent' && !s.ambiguous && s.available !== false);
    const destination = suggested.length === 1 ? '「' + suggested[0].title + '」' : '一间没有勾选屏幕权限的 B站专用会话';
    let instruction = '在“自动刷在哪个会话”选择' + destination + '。';
    if (targetIssue) {
      const name = sessionMap.get(targetIssue.sessionId)?.title || targetIssue.sessionId;
      instruction = '把“自动刷在哪个会话”从「' + name + '」改为' + destination + '。';
    } else if (automatic) {
      instruction = '把“自动刷在哪个会话”从“（不选 = 自动挑最近聊过的）”改为' + destination + '。';
    }
    const retryEnable = () => {
      const next = { ...editor, config: { ...editor.config, enabled: true } };
      setEditor(next);
      return request('config', next);
    };
    const startBiliGuide = () => {
      try {
        if (typeof navigateSettings !== 'function') throw new Error('navigation unavailable');
        updateGuide({ active: true, returnScreen: false, draft: structuredClone(editor), instruction });
        navigateSettings('bili-scroll'); stopHighlight?.(); stopHighlight = locateBiliTarget(instruction);
      } catch { endGuide(); setError('暂时无法自动跳转。请点击左侧“刷B站” → “日常”。' + instruction + ' 等“自动刷会话：已保存”后返回这里重试。'); }
    };
    const openPermissions = async () => {
      if (pending.current) return;
      if (!permissionsAvailable) { setError(runtimeUpgradeMessage); return; }
      const current = ++generation.current; pending.current = true; setAction('permissions'); setError('');
      try { const value = await json('/fish-console/screen/open-permissions', {}); if (current === generation.current) setMessage(value.message); }
      catch (e) { if (current === generation.current) setError(e.code === 'runtime_upgrade_required' || e.code === 'invalid_service_response' ? e.message : '无法打开系统设置：' + e.message + '。请手动打开 macOS“系统设置 → 隐私与安全性 → 屏幕录制”。'); }
      finally { if (current === generation.current) { generation.current++; pending.current = false; setAction(''); } }
    };
    return h('div', { hidden: !active, role: 'tabpanel', id: 'fc-panel-screen', 'aria-labelledby': 'fc-tab-screen', tabIndex: 0 },
      h('p', null, '按需查看 Mac 主显示器。在授权会话中说“看看我现在的屏幕”，小肥鱼就可以获取当时的画面；本版不在后台定时采集。'),
      h('p', { style: muted }, '屏幕开关和会话勾选会即时保存。看到保存成功后即可关闭设置，无需点击上方“保存控制台设置”。'),
      error && h('p', { role: 'alert' }, error),
      ...issues.filter(item => ['bili-dynamic', 'qq', 'unavailable'].includes(item.kind)).map(item =>
        h('p', { key: item.kind + (item.sessionId || ''), role: 'status' },
          item.sessionId ? '「' + (sessionMap.get(item.sessionId)?.title || item.sessionId) + '」' : '', item.message)),
      compatible && (biliBlocked || (guideState.active && guideState.returnScreen)) && h('div', { style: { ...card, borderColor: '#8ab4f8' } },
        h('strong', null, biliBlocked ? (targetIssue ? 'B站自动刷和屏幕感知选中了同一间会话' : '为 B站自动刷选择专用会话') : '返回后检查并启用屏幕感知'),
        biliBlocked && h('ol', null,
          h('li', null, '打开“刷B站 → 日常”。', instruction),
          h('li', null, '等待顶部显示“自动刷会话：已保存”，再点“返回屏幕感知”。')),
        h('p', { style: muted }, '已勾选 ' + chosen.length + ' 间屏幕会话。点击“检查并继续启用”会重新核对 B站实际使用的目标。'),
        h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
          biliBlocked && h('button', { style: control, disabled: !!action, onClick: startBiliGuide }, '带我设置 B站目标会话'),
          h('button', { style: control, disabled: !!action || conflict || !chosen.length, onClick: retryEnable }, '我已设置好，检查并继续启用'))),
      message && h('p', { className: 'fc-feedback', role: 'status' }, message),
      !compatible && h('div', null, h('p', null, data ? '屏幕感知接口版本不匹配，请重新加载插件并刷新设置页。' : error ? '请重新加载插件后重试。' : '正在读取屏幕设置…'), h('button', { style: control, disabled: !!action, onClick: reload }, '重新读取屏幕设置')),
      compatible && h('div', null,
        h('div', { style: card },
          h('strong', null, action === 'config' ? '正在保存屏幕设置…' : data.config.enabled ? '屏幕感知已启用' : '屏幕感知已暂停'),
          !biliBlocked && !data.config.enabled && data.config.sessions.length > 0 && h('p', { role: 'status' }, '已选择会话，总开关仍关闭。勾选“启用按需屏幕感知”后会立即保存；保存成功后 AI 才能调用截图工具。'),
          h('p', { style: muted }, '采集范围：Mac 主显示器（包含该屏幕上可见的窗口）。'),
          status.message && h('p', null, status.message),
          status.supported === false && h('p', { role: 'alert' }, '当前系统暂不支持本版屏幕采集。'),
          status.supported !== false && status.available === false && h('p', { role: 'alert' }, 'AI 查看屏幕的工具能力暂不可用；本机预览仍可使用。是否支持图片会在实际调用时按所选会话的模型检查。'),
          h('label', { className: 'fc-choice' }, h('input', { type: 'checkbox', checked: data.config.enabled, disabled: !!action || dirty || conflict || status.supported === false, onChange: e => edit({ enabled: e.target.checked }) }), ' 启用按需屏幕感知'),
          h('p', { style: muted }, '首次截图需要在 macOS 系统设置中授予屏幕录制权限。启用后还需勾选允许访问的会话，会话勾选也会即时保存。'),
          status.supported && !permissionsAvailable && h('p', { role: 'status' }, runtimeUpgradeMessage),
          status.supported && h('button', { style: control, disabled: !!action || !permissionsAvailable, onClick: openPermissions }, action === 'permissions' ? '正在打开系统设置…' : '打开 Mac 屏幕录制设置')),
        h('h3', null, '允许查看屏幕的会话'),
        h('p', { style: muted }, '建议选择专用本机会话。仅允许明确勾选的会话在本机用户发起的当前轮次查看；B站、QQ、后台任务和子代理不继承此权限。启用时和每次截图前后会核对平台路由，已绑定 QQ 或 B站任务的会话不能使用屏幕感知。'),
        !sessionMap.size && h('p', null, '暂时没有可选择的会话，请先在 DSH 中创建会话。'),
        ...[...sessionMap.values()].map(session => h('label', { key: session.id, className: 'fc-choice' },
          h('input', { type: 'checkbox', checked: data.config.sessions.includes(session.id), disabled: !!action || dirty || conflict || (!!session.ambiguous || !!session.parentId || session.origin === 'subagent' || session.available === false) && !data.config.sessions.includes(session.id),
            onChange: e => edit({ sessions: e.target.checked ? [...editor.config.sessions, session.id] : editor.config.sessions.filter(id => id !== session.id) }) }), ' ', session.title || session.id,
          h('div', { style: { ...muted, marginLeft: 22 } }, session.workspace || '未分组', ' · ', session.id, session.parentId || session.origin === 'subagent' ? ' · 子代理会话不能使用屏幕工具' : ''))),
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, margin: '16px 0' } },
          dirty && h('button', { style: control, disabled: !!action || conflict, onClick: () => request('config') }, action === 'config' ? '正在保存…' : '重试保存屏幕设置'),
          h('button', { style: control, disabled: !!action, onClick: reload }, dirty ? '放弃屏幕草稿并重新读取' : '刷新屏幕设置'),
          h('button', { style: control, className: 'fc-danger', disabled: action === 'pause', onClick: () => request('pause') }, action === 'pause' ? '正在暂停…' : '立即暂停')),
        dirty && h('p', { style: muted }, action === 'config' ? '正在即时保存，请等待成功提示。开关和会话勾选显示当前已保存的状态。' : '上次修改尚未保存，开关和会话勾选显示当前已保存的状态。请重试保存，或放弃修改并重新读取；立即暂停仍可使用。'),
        conflict && h('p', { role: 'alert' }, '屏幕设置已在其他页面更新。你的草稿已保留，请重新读取后核对再保存。'),
        h('h3', null, '截图预览'),
        h('p', { style: muted }, '这里的预览只显示在本机，不调用模型。AI 在授权会话中查看时，截图会发送到该会话选择的模型服务，并可能作为 DSH 会话附件保留。日后把该会话接到 QQ 或 B站前，请先清理会话历史。本功能不主动调用长期记忆写入；其他记忆插件是否处理会话历史，取决于其设置。'),
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
          h('button', { style: control, className: 'fc-primary', disabled: !!action || !!status.busy || dirty || !data.config.enabled || !status.supported, onClick: () => request('capture') }, action === 'capture' || status.busy ? '正在采集…' : '立即截图预览'),
          h('button', { style: control, disabled: !!action || !capture, onClick: showPreview }, '查看最近截图'),
          preview && h('button', { style: control, onClick: () => setPreview(null) }, '隐藏预览')),
        status.lastError && h('p', { role: 'alert' }, '最近采集失败：' + status.lastError),
        capture && h('p', { style: muted }, '最近采集：' + new Date(capture.capturedAt).toLocaleString(), ' · ', capture.width, ' × ', capture.height, ' · ', Math.ceil(capture.bytes / 1024), ' KB · ', capture.delivery === 'model' ? '已生成模型图片附件' : '仅本机预览', capture.sessionId ? ' · ' + (sessionMap.get(capture.sessionId)?.title || capture.sessionId) : ''),
        preview?.dataUrl && h('img', { src: preview.dataUrl, alt: '最近一次屏幕截图预览', style: { display: 'block', maxWidth: '100%', maxHeight: 600, objectFit: 'contain', marginTop: 12, borderRadius: 8, border: card.border } })));
  }
  function Section() {
    const [data, setData] = React.useState(null), [draft, setDraft] = React.useState(null);
    const [roleId, setRoleId] = React.useState(''), [tab, setTab] = React.useState(guideState.returnScreen ? 'screen' : 'role');
    const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [status, setStatus] = React.useState('');
    const accept = value => {
      setData(value);
      if (value.protocolVersion === 7) {
        setDraft(structuredClone(value.config));
        setRoleId(previous => value.config.roles.some(r => r.id === previous) ? previous : value.config.roles[0].id);
      }
    };
    React.useEffect(() => { let active = true; json('/fish-console/config').then(value => { if (active) accept(value); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, []);
    React.useEffect(() => {
      let active = true;
      const timer = setInterval(() => json('/fish-console/coverage').then(value => {
        if (active) setData(previous => previous ? { ...previous, ...value } : previous);
      }).catch(() => {}), 8000);
      return () => { active = false; clearInterval(timer); };
    }, []);
    if (!data || data.protocolVersion !== 7 || !draft) return h('div', { className: 'fish-console' }, h('style', null, consoleStyles),
      h('p', { role: error || data ? 'alert' : 'status' }, error || (data ? '控制台接口已升级，请刷新设置页或重启 DSH 后使用。' : '正在读取控制台…')));
    const role = draft.roles.find(r => r.id === roleId) || draft.roles[0];
    const roleName = id => draft.roles.find(r => r.id === id)?.label || data.config.roles.find(r => r.id === id)?.label || id || '未绑定';
    const dirty = JSON.stringify(draft) !== JSON.stringify(data.config);
    const edit = fn => { setDraft(previous => fn(previous)); setStatus(''); };
    const editRole = patch => edit(c => ({ ...c, roles: c.roles.map(r => r.id === role.id ? { ...r, ...patch } : r) }));
    const editPrivate = patch => editRole({ privateChat: { ...role.privateChat, ...patch } });
    const setPrivateTarget = (channel, id) => edit(c => ({ ...c, roles: c.roles.map(r => r.id !== role.id ? r : { ...r, privateChat: channel === 'local'
      ? { ...r.privateChat, localSessions: r.privateChat.localSessions.includes(id) ? r.privateChat.localSessions.filter(sid => sid !== id) : [...r.privateChat.localSessions, id] }
      : { ...r.privateChat, [channel]: { ...r.privateChat[channel], sessionId: id } } }) }));
    const bindWorkspace = (target, checked) => edit(c => ({ ...c, bindings: { workspaces: [...c.bindings.workspaces.filter(b => b.workspace !== target), ...(checked ? [{ workspace: target, roleId: role.id }] : [])] } }));
    const save = async () => {
      setBusy(true); setError(''); setStatus('正在保存…');
      try { await json('/fish-console/config', { config: draft, baseRevision: data.baseRevision }); const saved = await json('/fish-console/config'); accept(saved); setStatus(saved.identitySync?.state === 'complete' ? '已保存；插件名字和称呼已同步，后续请求使用新角色规则。' : '控制台已保存；插件名称同步有待处理项，请查看下方结果。'); }
      catch (e) { setStatus(''); setError(e.message); } finally { setBusy(false); }
    };
    const refresh = async () => { setBusy(true); setError(''); try { accept(await json('/fish-console/config')); setStatus('已刷新'); } catch (e) { setError(e.message); } finally { setBusy(false); } };
    const syncNamesNow = async () => {
      setBusy(true); setError(''); setStatus('正在核对并同步插件名字和称呼…');
      try { const value = await json('/fish-console/sync', { baseRevision: data.baseRevision }); setData(previous => ({ ...previous, ...value })); setStatus(value.identitySync?.state === 'complete' ? '插件名字和称呼已同步。' : '同步已检查，请查看各插件结果。'); }
      catch (e) { setStatus(''); setError(e.message); } finally { setBusy(false); }
    };
    const connectPrivate = async channel => {
      setBusy(true); setError(''); setStatus('正在核对专用会话并保存私信连接…');
      try { const value = await json('/fish-console/private-connect', { baseRevision: data.baseRevision, roleId: role.id, channel }); setData(previous => ({ ...previous, ...value })); setStatus(value.connection.message); }
      catch (e) { setStatus(''); setError(e.message); } finally { setBusy(false); }
    };
    const workspaceMap = new Map((data.workspaces || []).map(w => [w.path, w]));
    for (const b of draft.bindings.workspaces) if (!workspaceMap.has(b.workspace)) workspaceMap.set(b.workspace, { path: b.workspace, title: b.workspace, available: false });
    const workspaces = [...workspaceMap.values()];
    const sessionMap = new Map((data.sessions || []).map(s => [s.id, s]));
    const sessions = [...sessionMap.values()];
    const field = (label, value, onChange, maxLength, placeholder) => h('label', { className: 'fc-field' }, label, h('input', { value, disabled: busy, maxLength, placeholder, onChange: e => onChange(e.target.value) }));
    const rolePage = h('div', null,
      h('section', { className: 'fc-card', 'aria-label': '角色信息' }, h('h3', null, '角色信息'),
        h('div', { className: 'fc-fields' },
          h('div', { className: 'fc-wide' }, field('角色名称（用于区分）', role.label, value => editRole({ label: value }), 40)),
          field('它的名字', role.selfName, value => editRole({ selfName: value }), 16), field('它对我的称呼', role.ownerName, value => editRole({ ownerName: value }), 16))),
      h('section', { className: 'fc-card', 'aria-labelledby': 'fc-persona-title' },
        h('h3', { id: 'fc-persona-title' }, '统一人设'), h('p', { id: 'fc-persona-help', style: muted }, '正文可用 {{selfName}} 和 {{ownerName}} 引用名字与称呼。'),
        h('textarea', { rows: 10, value: role.persona, disabled: busy, 'aria-labelledby': 'fc-persona-title', 'aria-describedby': 'fc-persona-help', onChange: e => editRole({ persona: e.target.value }) }),
        h('p', { style: muted }, '完整人设由本控制台注入；名字和称呼在保存后同步到已适配插件。多角色共用的全局字段发生冲突时保留原值，并在下面提示。')),
      h('section', { className: 'fc-card', 'aria-label': '插件名字和称呼同步' },
        h('h3', null, '插件名字和称呼同步'),
        h('p', { style: muted }, '保存后同步到已适配插件；共用名称发生冲突时，会保留原值并提示。'),
        h('div', { className: 'fc-actions' }, h('button', { style: control, disabled: busy || dirty, onClick: syncNamesNow }, '重新同步名字和称呼'),
          dirty && h('span', { style: muted }, '先保存本页修改，再同步。')),
        data.identitySync?.message && h('p', { role: 'status' }, data.identitySync.message),
        h('div', { className: 'fc-grid' }, ...Object.entries(data.identitySync?.results || {}).map(([key, item]) => h('div', { key, className: 'fc-card' },
          h('div', { className: 'fc-card-heading' }, h('strong', null, pluginNames[key] || key), h('span', { className: 'fc-badge', 'data-tone': item.state === 'synced' ? 'success' : ['partial', 'failed', 'conflict', 'unsupported'].includes(item.state) ? 'warning' : undefined }, syncNames[item.state] || item.state)),
          h('div', { style: muted }, item.message)))),
        h('details', null, h('summary', null, '同步范围与说明'), h('p', { style: muted }, '只同步名称配置；不改插件代码、历史记忆、任务目标、绑定和功能开关。记忆按会话同步，心情按已有份同步；全局默认值需要所有绑定角色的对应名字一致。心情里的“昵称”表示你怎么叫它，单独保留。')),
        !data.identitySync?.checkedAt && h('p', { style: muted }, '尚未同步，保存或点上方按钮后检查。'),
        data.identitySync?.checkedAt && h('p', { style: muted }, '最近检查：' + new Date(data.identitySync.checkedAt).toLocaleString())));
    const profile = role.privateChat;
    const privateSaved = data.privateChat?.find(item => item.roleId === role.id);
    const canChoosePrivate = session => !session.ambiguous && draft.bindings.workspaces.some(b => b.workspace === session.workspace && b.roleId === role.id);
    const privatePage = h('div', null,
      h('p', null, '统一人设描述鱼是谁；这里补充“你是谁、你们的关系，以及只在与你私聊时使用的相处规则”。专属规则叠加在统一人设之后，不继承到子代理，也不写进群聊或插件的全局人设。'),
      h('section', { className: 'fc-card', 'aria-label': '私聊身份与规则' },
      h('h3', null, '私聊身份与规则'),
      h('label', { className: 'fc-choice' }, h('input', { type: 'checkbox', checked: profile.enabled, disabled: busy, onChange: e => editPrivate({ enabled: e.target.checked }) }), ' 启用与我的私聊身份'),
      field('私聊时它怎么称呼我', profile.ownerName, value => editPrivate({ ownerName: value }), 16, '留空沿用：' + role.ownerName),
      h('label', { className: 'fc-field', style: { marginTop: 16 } }, '我的个人情况、与鱼的关系和专属相处规则',
        h('textarea', { rows: 10, maxLength: 12000, disabled: busy, value: profile.persona,
          placeholder: '例如：我希望你了解的个人情况；我们之间的称呼、习惯；与你私聊时需要特别照顾的沟通方式。请按自己的意愿填写。', onChange: e => editPrivate({ persona: e.target.value }) })),
      h('p', { style: muted }, '可用 {{selfName}}、{{ownerName}} 引用本轮名字和私聊称呼。这里只保存你填写的内容，不预设你们的关系。')),
      h('details', { style: { margin: '16px 0' } }, h('summary', null, '本机 DSH 中与我私聊（可选，已选 ' + profile.localSessions.length + ' 间）'),
        h('p', { style: muted }, '请先在工作区绑定页将会话所在工作区绑定到当前角色，再选择专用私聊会话。这里的勾选只控制专属私聊规则，不修改角色归属。'),
        !sessions.length && h('p', { className: 'fc-empty' }, '暂无会话。先在 DSH 中创建会话，再绑定对应工作区。'),
        ...sessions.map(session => h('label', { key: session.id, className: 'fc-choice' }, h('input', { type: 'checkbox', checked: profile.localSessions.includes(session.id), disabled: busy || (!profile.localSessions.includes(session.id) && !canChoosePrivate(session)), onChange: () => setPrivateTarget('local', session.id) }), ' ', session.title,
        h('span', { style: muted }, ' · ' + (session.workspace || '未分组')),
        privateSaved?.local.find(item => item.sessionId === session.id)?.conflict && h('div', { style: muted }, privateSaved.local.find(item => item.sessionId === session.id).conflict)))),
      h('h3', null, '绑定我的平台私信账号'),
      h('p', { style: muted }, '先填写账号、选择专用会话并保存，再点连接按钮。连接只配置入口，不发送测试私信。QQ 连接服务仍在通到QQ中设置；同一会话连接了群聊、其他人或公开任务时，会提示冲突。'),
      ...[['bili', 'B站', 'uid', 'B站 UID（数字账号）'], ['qq', 'QQ', 'number', '我的 QQ号']].map(([channel, label, key, inputLabel]) => {
        const binding = profile[channel], saved = privateSaved?.[channel];
        const suggestion = channel === 'bili' ? data.privateSuggestions?.bili : data.privateSuggestions?.qq?.[0];
        return h('div', { key: channel, style: card }, h('h3', { style: { marginTop: 0 } }, label + ' 私信'),
          field(inputLabel, binding[key], value => editPrivate({ [channel]: { ...binding, [key]: value } }), channel === 'bili' ? 16 : 12),
          suggestion?.[key] && h('button', { style: control, disabled: busy, onClick: () => {
            edit(c => ({ ...c, roles: c.roles.map(r => r.id !== role.id ? r : { ...r, privateChat: { ...r.privateChat, [channel]: { ...r.privateChat[channel], [key]: suggestion[key] } } }) }));
            setStatus('已把插件现有账号填入草稿；请自行核对是否为本人，再保存。');
          } }, '填入插件当前账号（需你核对）'),
          h('label', { className: 'fc-field', style: { margin: '16px 0' } }, label + ' 专用私聊会话 ',
            h('select', { style: control, value: binding.sessionId, disabled: busy, onChange: e => setPrivateTarget(channel, e.target.value) }, h('option', { value: '' }, '请选择专用会话'),
              ...sessions.map(session => h('option', { key: session.id, value: session.id, disabled: session.id !== binding.sessionId && !canChoosePrivate(session) }, session.title + ' · ' + (session.workspace || '未分组'))))),
          h('button', { style: control, disabled: busy || dirty || !profile.enabled || !binding[key] || !binding.sessionId, onClick: () => connectPrivate(channel) }, channel === 'bili' ? '连接并启用 B站私信' : '保存到 QQ 私聊绑定'),
          saved && h('p', { style: muted }, saved.account ? saved.account + ' · ' : '', saved.message),
          channel === 'bili' && h('p', { style: muted }, 'B站当前插件共用一个互动入口。连接会启用本人私信接收；已有自动刷或公开互动正在使用入口时会拒绝覆盖。自动公开动态的原目标会保留。'));
      }),
      dirty && h('p', { style: muted }, '有未保存修改；请先保存控制台设置，平台连接按钮随后可用。'),
      h('p', { style: muted }, '仅凭聊天正文里自称本人、昵称或账号不能触发专属规则。规则在下一条来源可确认的新私聊中生效；关闭此身份只停止专属规则，不删除平台连接。'));
    const bindingsPage = h('div', null,
      h('p', null, '将角色绑定到工作区后，其中的现有会话和新会话都会使用该角色。子代理也按自身工作区选择角色，无需逐个设置会话。'),
      h('h3', null, '工作区绑定'),
      !workspaces.length && h('p', { className: 'fc-empty' }, '暂无可绑定的工作区。先在 DSH 中创建或打开工作区，再刷新控制台。'),
      ...workspaces.map(w => {
        const binding = draft.bindings.workspaces.find(b => b.workspace === w.path);
        return h('label', { key: w.path, className: 'fc-choice' }, h('input', { type: 'checkbox', checked: binding?.roleId === role.id, disabled: busy || (!w.available && binding?.roleId !== role.id), onChange: e => bindWorkspace(w.path, e.target.checked) }), ' ', w.title,
          h('div', { style: { ...muted, marginLeft: 22 } }, w.path, !w.available ? ' · 当前不可用' : '', binding && binding.roleId !== role.id ? ' · 已绑定 ' + roleName(binding.roleId) + '，勾选会改为当前角色' : ''));
      }));
    const coverage = data.coverage || { records: [], counters: {}, categories: [] };
    const coveragePage = h('div', null,
      h('p', null, '覆盖检查对应已保存的设置。绑定或尝试注入后，仍需观察到实际请求，才会显示“确认携带”。'),
      h('p', { style: muted }, '只观察经过 DSH 模型入口的请求，不代表模型执行成功或一定遵循人设。仅保留本次加载后最近 ' + (coverage.limit || 200) + ' 条元数据，不保存聊天正文；不改写插件内部请求。'),
      (!data.capabilities?.modelEntry || coverage.observationErrors > 0) && h('p', { role: 'alert' }, '模型入口观察接口不可用或有观察失败；此时不能判断完整覆盖。'),
      h('div', { className: 'fc-grid' }, ...coverage.categories.map(category => {
        const records = coverage.records.filter(r => r.category === category);
        const historical = records.filter(r => r.currentBinding === false || (r.roleId && !r.currentRevision));
        const current = records.filter(r => !historical.includes(r));
        return h('div', { key: category, className: 'fc-card' }, h('strong', null, categoryNames[category] || category), h('div', { style: muted }, records.length ? `当前设置下 ${current.length} 条观测：` + Object.keys(statusNames).map(state => `${statusNames[state]} ${current.filter(r => r.status === state).length}`).join('，') + (historical.length ? `；另有 ${historical.length} 条旧绑定／版本记录` : '') : '尚未观察到请求'));
      })),
      h('h3', null, '后台任务的会话归属'),
      h('p', { style: muted }, '以下只读检查插件保存的目标，不代表任务已执行。目标会话使用其所在工作区绑定的角色。'),
      !data.integrations?.tasks?.length && h('p', { className: 'fc-empty' }, '暂无可检查的后台任务。'),
      ...(data.integrations?.tasks || []).map(task => h('div', { key: task.id, style: card }, h('strong', null, task.label),
        h('div', null, task.title || (task.sessionId ? task.sessionId : '插件自动挑选会话')), h('div', { style: muted }, task.workspace || '', task.enabled === false ? ' · 自动任务未开启' : ''),
        h('div', null, task.roleId ? '已配置角色：' + roleName(task.roleId) + '（待请求验证）' : task.state === 'automatic' ? '目标未固定，无法预先确认角色' : '目标未绑定角色或归属未知'),
        task.workspace && workspaceMap.get(task.workspace)?.available && h('button', { style: control, disabled: busy, onClick: () => { bindWorkspace(task.workspace, true); setStatus('已将目标所在工作区加入当前角色的绑定草稿，请保存；该工作区内的所有会话都会使用此角色。'); } }, '绑定所在工作区到当前角色'))),
      ...(data.integrations?.notes || []).map((note, i) => h('p', { key: i, style: muted }, note.message)),
      h('h3', null, '会话检查'),
      !sessions.length && h('p', { className: 'fc-empty' }, '暂无会话，创建会话后会在这里显示检查结果。'),
      ...sessions.map(s => {
        const last = s.lastRequest;
        const message = !s.roleId ? (s.roleStatus === 'unresolved' ? '归属不明' : '未绑定角色') : last ? (last.currentBinding === true && last.roleId === s.roleId && last.revision === s.revision ? statusNames[last.status] : '已有历史记录，等待当前角色的新请求') : s.assemblyAttempt?.roleId === s.roleId && s.assemblyAttempt?.revision === s.revision ? '已尝试注入，尚未观察到请求' : '已绑定，等待请求';
        return h('div', { key: s.id, className: 'fc-card' }, h('strong', null, s.title), ' · ', message, h('div', { style: muted }, s.roleId ? roleName(s.roleId) + ' · ' + (sourceNames[s.source] || s.source) : s.workspace));
      }),
      h('h3', null, '最近请求'),
      !coverage.records.length && h('p', { className: 'fc-empty' }, '尚未观察到请求。在已绑定的工作区发起对话后，结果会自动更新。'),
      ...[...coverage.records].reverse().slice(0, 40).map(r => h('div', { key: r.id, style: card }, h('strong', null, (categoryNames[r.category] || r.category) + ' · ' + statusNames[r.status]),
        r.privateInput && h('div', null, '本人私聊规则：' + ({ covered: '确认携带', uncovered: '未携带', unexpected: '来源不符，需要检查' }[r.privateInput.status] || r.privateInput.status) + (r.privateInput.channel ? ' · ' + r.privateInput.channel : '')),
        h('div', null, r.reason), h('div', { style: muted }, r.sessionId ? (sessionMap.get(r.sessionId)?.title || r.sessionId) : '无可靠会话归属', r.roleId ? ' · 预期角色 ' + roleName(r.roleId) + ' · ' + r.revision : '', r.currentBinding === false ? ' · 旧绑定或版本记录' : r.roleId && !r.currentRevision ? ' · 非当前角色版本' : '', ' · ' + new Date(r.observedAt).toLocaleTimeString()))));
    const bound = draft.bindings.workspaces.some(b => b.roleId === role.id);
    const globalTab = tab === 'screen' || tab === 'desktop';
    const changeTabByKey = event => {
      const current = tabs.findIndex(([key]) => key === tab);
      const next = { ArrowRight: (current + 1) % tabs.length, ArrowLeft: (current + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault(); setTab(tabs[next][0]);
      event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next]?.focus();
    };
    return h('div', { className: 'fish-console' },
      h('style', null, consoleStyles),
      h('header', { className: 'fc-header' }, h('h2', null, '统一角色控制台'), h('p', null, '统一管理角色和工作区绑定，并同步插件名字与称呼。')),
      data.configError && h('p', { role: 'alert' }, data.configError),
      data.bindingMigration && h('p', { role: 'status' }, data.bindingMigration),
      data.catalog?.registryAvailable === false && h('p', { role: 'alert' }, 'DSH 工作区名单暂不可用，新绑定可能无法保存。'),
      h('div', { className: 'fc-toolbar', 'aria-label': '控制台保存操作' },
        h('div', { className: 'fc-toolbar-line' },
          h('button', { className: 'fc-primary', disabled: busy || !dirty, onClick: save }, busy ? '处理中…' : '保存控制台设置'),
          h('button', { disabled: busy || dirty, title: dirty ? '先保存或撤销未保存修改，再刷新' : '重新读取控制台设置', onClick: refresh }, '刷新'),
          dirty && h('button', { disabled: busy, onClick: () => { setDraft(structuredClone(data.config)); setError(''); setStatus('已撤销本页未保存修改'); } }, '撤销未保存修改'),
          h('span', { className: 'fc-save-state', 'data-dirty': dirty, role: 'status' }, busy ? '正在处理…' : dirty ? '有未保存修改' : '角色设置已保存')),
        globalTab && h('p', { className: 'fc-toolbar-note' }, tab === 'screen' ? '屏幕设置即时保存，无需点击此处保存。' : '桌宠设置在下方直接生效，轮换时间单独保存。')),
      !globalTab && h('div', { className: 'fc-role-picker' },
      h('label', { className: 'fc-field' }, '当前编辑角色', h('select', { value: role.id, disabled: busy, onChange: e => { setRoleId(e.target.value); setStatus(''); } }, ...draft.roles.map(r => h('option', { key: r.id, value: r.id }, r.label)))),
      h('div', { className: 'fc-actions' }, h('button', { disabled: busy || draft.roles.length >= 32, title: draft.roles.length >= 32 ? '最多创建 32 个角色' : '复制人设，私聊账号与工作区绑定需重新设置', onClick: () => {
        const id = 'role-' + Date.now().toString(36); edit(c => ({ ...c, roles: [...c.roles, { ...role, id, label: (role.label + '副本').slice(0, 40), privateChat: { ...structuredClone(role.privateChat), enabled: false, localSessions: [], bili: { uid: '', sessionId: '' }, qq: { number: '', sessionId: '' } } }] })); setRoleId(id);
      } }, '复制为新角色'),
      h('button', { className: 'fc-danger', disabled: busy || bound || draft.roles.length <= 1, title: bound ? '先解除当前角色的工作区绑定' : draft.roles.length <= 1 ? '至少保留一个角色' : '删除后保存生效，保存前可以撤销', onClick: () => { edit(c => ({ ...c, roles: c.roles.filter(r => r.id !== role.id) })); setRoleId(draft.roles.find(r => r.id !== role.id).id); } }, '删除未绑定角色'))),
      !globalTab && h('p', { className: 'fc-role-meta' }, '当前角色绑定 ' + draft.bindings.workspaces.filter(b => b.roleId === role.id).length + ' 个工作区。', bound ? ' 解除绑定后可删除角色。' : draft.roles.length <= 1 ? ' 至少保留一个角色。' : ''),
      h('div', { className: 'fc-tabs', role: 'tablist', 'aria-label': '控制台功能' }, ...tabs.map(([key, label]) => h('button', {
        key, id: 'fc-tab-' + key, role: 'tab', 'aria-selected': tab === key, 'aria-controls': 'fc-panel-' + key,
        tabIndex: tab === key ? 0 : -1, onKeyDown: changeTabByKey, onClick: () => setTab(key),
      }, label))),
      status && h('p', { className: 'fc-feedback', role: 'status' }, status), error && h('p', { role: 'alert' }, error),
      ...[['role', rolePage], ['private', privatePage], ['bindings', bindingsPage], ['coverage', coveragePage]].map(([key, page]) =>
        h('div', { key, role: 'tabpanel', id: 'fc-panel-' + key, 'aria-labelledby': 'fc-tab-' + key, hidden: tab !== key, tabIndex: 0 }, tab === key ? page : null)),
      h(ScreenPage, { active: tab === 'screen', sessions }),
      h('div', { role: 'tabpanel', id: 'fc-panel-desktop', 'aria-labelledby': 'fc-tab-desktop', hidden: tab !== 'desktop', tabIndex: 0 },
        h(DesktopPage, { active: tab === 'desktop', sessions })));
  }
  let desktopModule;
  function DesktopPage({ active, sessions }) {
    const [Panel, setPanel] = React.useState(null), [error, setError] = React.useState('');
    React.useEffect(() => {
      if (!active) return;
      let live = true;
      desktopModule ??= import('/fish-console/avatar/desktop-settings.js?v=console-ui-1').then(module => module.desktopSettings(React));
      desktopModule.then(view => { if (live) { setPanel(() => view); setError(''); } }).catch(() => {
        desktopModule = undefined;
        if (live) setError('桌宠设置尚未加载，请重新加载控制台插件或重启 DSH。');
      });
      return () => { live = false; };
    }, [active]);
    return Panel ? h(Panel, { active, sessions })
      : active ? h('p', { role: error ? 'alert' : 'status' }, error || '正在加载桌宠设置…') : null;
  }
  function apply(ctx) {
    const slots = ctx.get('slots'); if (!slots) return;
    navigateSettings = id => {
      if (!slots.entries('settings.section').some(entry => entry.options?.id === id)) throw new Error('目标设置页尚未加载');
      const entry = slots.entries('sidebar.settings').find(item => typeof item.store?.create === 'function');
      const shell = entry?.store.create();
      if (typeof shell?.actions?.openSection !== 'function') throw new Error('宿主未提供设置页跳转接口');
      shell.actions.openSection(id);
    };
    slots.inject('settings.section', () => slots.register({ name: 'settings.section', id: 'fish-console', order: 55, label: () => '大肥鱼工作区' }, Section));
    slots.inject('settings.action', () => slots.register({ name: 'settings.action', id: 'fish-screen-guide-return', order: 10 }, GuideActions));
    ctx.effect?.(() => {
      let disposed = false, stop;
      import('/fish-console/avatar/desktop-client.js?v=0.15.0').then(module => {
        if (!disposed) stop = module.installDesktopBridge();
      }).catch(error => console.warn('[fish-console] 桌宠联动未加载', error));
      return () => { disposed = true; stop?.(); };
    });
    ctx.effect?.(() => () => { endGuide(); navigateSettings = undefined; });
  }
  return { apply, inject: ['slots'] };
}});
