window.__ModuleLoader__.load({ id: 'dsh-fish-console', factory: require => {
  const React = require('react'), h = React.createElement;
  const control = { color: 'inherit', background: 'transparent', border: '1px solid var(--dsw-alias-border-l2, #888)', borderRadius: 6, padding: '5px 8px', boxSizing: 'border-box' };
  const muted = { opacity: .7, fontSize: 12 };
  const card = { border: '1px solid var(--dsw-alias-border-l2, #888)', borderRadius: 8, padding: 12, margin: '12px 0' };
  const categoryNames = { conversation: '常规会话', subagent: '子代理', memory: '记忆内部调用', mood: '心情内部调用', bili: 'B站内部调用', other: '其他调用' };
  const statusNames = { covered: '确认携带', uncovered: '未携带当前人设', unbound: '未绑定角色', unknown: '归属不明' };
  const sourceNames = { session: '会话单独绑定', workspace: '工作区绑定', parent: '继承父会话' };
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
    return h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, maxWidth: 550 } },
      h('span', { style: muted }, guide.instruction, ' 看到“自动刷会话：已保存”后返回。'),
      h('button', { style: control, onClick: () => {
        try { updateGuide({ ...guideState, returnScreen: true }); stopHighlight?.(); navigateSettings?.('fish-console'); setError(''); }
        catch { setError('请点击左侧“大肥鱼工作区”，再打开“屏幕感知”继续。'); }
      } }, '返回屏幕感知'),
      h('button', { style: control, onClick: endGuide }, '结束引导'),
      error && h('span', { role: 'alert' }, error));
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
    return h('div', { hidden: !active },
      h('p', null, '按需查看 Mac 主显示器。在授权会话中说“看看我现在的屏幕”，小肥鱼就可以获取当时的画面；本版不在后台定时采集。'),
      h('p', { style: muted }, '屏幕开关和会话勾选会即时保存。看到保存成功后即可关闭设置，无需点击上方“保存控制台设置”。'),
      error && h('p', { role: 'alert', style: { color: '#e88' } }, error),
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
      message && h('p', { role: 'status' }, message),
      !compatible && h('div', null, h('p', null, data ? '屏幕感知接口版本不匹配，请重新加载插件并刷新设置页。' : error ? '请重新加载插件后重试。' : '正在读取屏幕设置…'), h('button', { style: control, disabled: !!action, onClick: reload }, '重新读取屏幕设置')),
      compatible && h('div', null,
        h('div', { style: card },
          h('strong', null, action === 'config' ? '正在保存屏幕设置…' : data.config.enabled ? '屏幕感知已启用' : '屏幕感知已暂停'),
          !biliBlocked && !data.config.enabled && data.config.sessions.length > 0 && h('p', { role: 'status' }, '已选择会话，总开关仍关闭。勾选“启用按需屏幕感知”后会立即保存；保存成功后 AI 才能调用截图工具。'),
          h('p', { style: muted }, '采集范围：Mac 主显示器（包含该屏幕上可见的窗口）。'),
          status.message && h('p', null, status.message),
          status.supported === false && h('p', { role: 'alert' }, '当前系统暂不支持本版屏幕采集。'),
          status.supported !== false && status.available === false && h('p', { role: 'alert' }, 'AI 查看屏幕的工具能力暂不可用；本机预览仍可使用。是否支持图片会在实际调用时按所选会话的模型检查。'),
          h('label', null, h('input', { type: 'checkbox', checked: data.config.enabled, disabled: !!action || dirty || conflict || status.supported === false, onChange: e => edit({ enabled: e.target.checked }) }), ' 启用按需屏幕感知'),
          h('p', { style: muted }, '首次截图需要在 macOS 系统设置中授予屏幕录制权限。启用后还需勾选允许访问的会话，会话勾选也会即时保存。'),
          status.supported && !permissionsAvailable && h('p', { role: 'status' }, runtimeUpgradeMessage),
          status.supported && h('button', { style: control, disabled: !!action || !permissionsAvailable, onClick: openPermissions }, action === 'permissions' ? '正在打开系统设置…' : '打开 Mac 屏幕录制设置')),
        h('h3', null, '允许查看屏幕的会话'),
        h('p', { style: muted }, '建议选择专用本机会话。仅允许明确勾选的会话在本机用户发起的当前轮次查看；B站、QQ、后台任务和子代理不继承此权限。启用时和每次截图前后会核对平台路由，已绑定 QQ 或 B站任务的会话不能使用屏幕感知。'),
        !sessionMap.size && h('p', null, '暂时没有可选择的会话，请先在 DSH 中创建会话。'),
        ...[...sessionMap.values()].map(session => h('label', { key: session.id, style: { display: 'block', margin: '10px 0' } },
          h('input', { type: 'checkbox', checked: data.config.sessions.includes(session.id), disabled: !!action || dirty || conflict || (!!session.ambiguous || !!session.parentId || session.origin === 'subagent' || session.available === false) && !data.config.sessions.includes(session.id),
            onChange: e => edit({ sessions: e.target.checked ? [...editor.config.sessions, session.id] : editor.config.sessions.filter(id => id !== session.id) }) }), ' ', session.title || session.id,
          h('div', { style: { ...muted, marginLeft: 22 } }, session.workspace || '未分组', ' · ', session.id, session.parentId || session.origin === 'subagent' ? ' · 子代理会话不能使用屏幕工具' : ''))),
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, margin: '16px 0' } },
          dirty && h('button', { style: control, disabled: !!action || conflict, onClick: () => request('config') }, action === 'config' ? '正在保存…' : '重试保存屏幕设置'),
          h('button', { style: control, disabled: !!action, onClick: reload }, dirty ? '放弃屏幕草稿并重新读取' : '刷新屏幕设置'),
          h('button', { style: control, disabled: action === 'pause', onClick: () => request('pause') }, action === 'pause' ? '正在暂停…' : '立即暂停')),
        dirty && h('p', { style: muted }, action === 'config' ? '正在即时保存，请等待成功提示。开关和会话勾选显示当前已保存的状态。' : '上次修改尚未保存，开关和会话勾选显示当前已保存的状态。请重试保存，或放弃修改并重新读取；立即暂停仍可使用。'),
        conflict && h('p', { role: 'alert' }, '屏幕设置已在其他页面更新。你的草稿已保留，请重新读取后核对再保存。'),
        h('h3', null, '截图预览'),
        h('p', { style: muted }, '这里的预览只显示在本机，不调用模型。AI 在授权会话中查看时，截图会发送到该会话选择的模型服务，并可能作为 DSH 会话附件保留。日后把该会话接到 QQ 或 B站前，请先清理会话历史。本功能不主动调用长期记忆写入；其他记忆插件是否处理会话历史，取决于其设置。'),
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
          h('button', { style: control, disabled: !!action || !!status.busy || dirty || !data.config.enabled || !status.supported, onClick: () => request('capture') }, action === 'capture' || status.busy ? '正在采集…' : '立即截图预览'),
          h('button', { style: control, disabled: !!action || !capture, onClick: showPreview }, '查看最近截图'),
          preview && h('button', { style: control, onClick: () => setPreview(null) }, '隐藏预览')),
        status.lastError && h('p', { role: 'alert' }, '最近采集失败：' + status.lastError),
        capture && h('p', { style: muted }, '最近采集：' + new Date(capture.capturedAt).toLocaleString(), ' · ', capture.width, ' × ', capture.height, ' · ', Math.ceil(capture.bytes / 1024), ' KB · ', capture.delivery === 'model' ? '已生成模型图片附件' : '仅本机预览', capture.sessionId ? ' · ' + (sessionMap.get(capture.sessionId)?.title || capture.sessionId) : ''),
        preview?.dataUrl && h('img', { src: preview.dataUrl, alt: '最近一次屏幕截图预览', style: { display: 'block', maxWidth: '100%', maxHeight: 600, objectFit: 'contain', marginTop: 12, borderRadius: 6, border: control.border } })));
  }
  function Section() {
    const [data, setData] = React.useState(null), [draft, setDraft] = React.useState(null);
    const [roleId, setRoleId] = React.useState(''), [tab, setTab] = React.useState(guideState.returnScreen ? 'screen' : 'role'), [workspace, setWorkspace] = React.useState('');
    const [search, setSearch] = React.useState(''), [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [status, setStatus] = React.useState('');
    const accept = value => {
      setData(value);
      if (value.protocolVersion === 5) {
        setDraft(structuredClone(value.config));
        setRoleId(previous => value.config.roles.some(r => r.id === previous) ? previous : value.config.roles[0].id);
        setWorkspace(previous => previous || value.config.toolPolicies[0]?.workspace || value.workspaces[0]?.path || '');
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
    if (!data) return h('p', null, error || '正在读取控制台…');
    if (data.protocolVersion !== 5 || !draft) return h('p', { role: 'alert' }, '控制台接口已升级，请刷新设置页或重启 DSH 后使用。');
    const role = draft.roles.find(r => r.id === roleId) || draft.roles[0];
    const roleName = id => draft.roles.find(r => r.id === id)?.label || data.config.roles.find(r => r.id === id)?.label || id || '未绑定';
    const dirty = JSON.stringify(draft) !== JSON.stringify(data.config);
    const edit = fn => { setDraft(previous => fn(previous)); setStatus(''); };
    const editRole = patch => edit(c => ({ ...c, roles: c.roles.map(r => r.id === role.id ? { ...r, ...patch } : r) }));
    const editPrivate = patch => editRole({ privateChat: { ...role.privateChat, ...patch } });
    const setPrivateTarget = (channel, id) => edit(c => {
      const adding = channel !== 'local' || !c.roles.find(r => r.id === role.id).privateChat.localSessions.includes(id);
      const changed = c.roles.map(r => r.id !== role.id ? r : { ...r, privateChat: channel === 'local'
        ? { ...r.privateChat, localSessions: r.privateChat.localSessions.includes(id) ? r.privateChat.localSessions.filter(sid => sid !== id) : [...r.privateChat.localSessions, id] }
        : { ...r.privateChat, [channel]: { ...r.privateChat[channel], sessionId: id } } });
      return { ...c, roles: changed, bindings: { ...c.bindings, sessions: adding && id && !c.bindings.sessions.some(b => b.sessionId === id)
        ? [...c.bindings.sessions, { sessionId: id, roleId: role.id }] : c.bindings.sessions } };
    });
    const bindWorkspace = (target, checked) => edit(c => ({ ...c, bindings: { ...c.bindings, workspaces: [...c.bindings.workspaces.filter(b => b.workspace !== target), ...(checked ? [{ workspace: target, roleId: role.id }] : [])] } }));
    const bindSession = (target, checked) => edit(c => ({ ...c, bindings: { ...c.bindings, sessions: [...c.bindings.sessions.filter(b => b.sessionId !== target), ...(checked ? [{ sessionId: target, roleId: role.id }] : [])] } }));
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
    for (const b of [...draft.bindings.workspaces, ...draft.toolPolicies]) if (!workspaceMap.has(b.workspace)) workspaceMap.set(b.workspace, { path: b.workspace, title: b.workspace, available: false });
    const workspaces = [...workspaceMap.values()];
    const sessionMap = new Map((data.sessions || []).map(s => [s.id, s]));
    for (const b of draft.bindings.sessions) if (!sessionMap.has(b.sessionId)) sessionMap.set(b.sessionId, { id: b.sessionId, title: '暂不在 DSH 名单中的会话', workspace: '', roleStatus: 'unresolved' });
    const sessions = [...sessionMap.values()];
    const field = (label, value, onChange, maxLength, placeholder) => h('label', { style: { display: 'block', margin: '10px 0' } }, label, h('input', { style: { ...control, display: 'block', width: 'min(100%, 400px)', marginTop: 5 }, value, disabled: busy, maxLength, placeholder, onChange: e => onChange(e.target.value) }));
    const rolePage = h('div', null,
      field('角色名称（用于区分）', role.label, value => editRole({ label: value }), 40),
      h('div', { style: { display: 'flex', gap: 20, flexWrap: 'wrap' } }, field('它的名字', role.selfName, value => editRole({ selfName: value }), 16), field('它对我的称呼', role.ownerName, value => editRole({ ownerName: value }), 16)),
      h('h3', null, '统一人设'), h('p', { style: muted }, '正文可用 {{selfName}} 和 {{ownerName}} 引用名字与称呼。'),
      h('textarea', { style: { ...control, width: '100%' }, rows: 12, value: role.persona, disabled: busy, onChange: e => editRole({ persona: e.target.value }) }),
      h('p', { style: muted }, '完整人设由本控制台注入；名字和称呼在保存后同步到已适配插件。多角色共用的全局字段发生冲突时保留原值，并在下面提示。'),
      h('h3', null, '插件名字和称呼同步'),
      h('p', { style: muted }, '只同步名称配置；不改插件代码、历史记忆、任务目标、绑定和功能开关。记忆按会话同步，心情按已有份同步；全局默认值需要所有绑定角色的对应名字一致。心情里的“昵称”表示你怎么叫它，单独保留。'),
      h('button', { style: control, disabled: busy || dirty, onClick: syncNamesNow }, '重新同步名字和称呼'),
      dirty && h('p', { style: muted }, '先保存本页修改，再同步。'),
      data.identitySync?.message && h('p', { role: 'status' }, data.identitySync.message),
      ...Object.entries(data.identitySync?.results || {}).map(([key, item]) => h('div', { key, style: card }, h('strong', null, (pluginNames[key] || key) + ' · ' + (syncNames[item.state] || item.state)), h('div', { style: muted }, item.message))),
      !data.identitySync?.checkedAt && h('p', { style: muted }, '尚未同步，保存或点上方按钮后检查。'),
      data.identitySync?.checkedAt && h('p', { style: muted }, '最近检查：' + new Date(data.identitySync.checkedAt).toLocaleString()));
    const profile = role.privateChat;
    const privateSaved = data.privateChat?.find(item => item.roleId === role.id);
    const canChoosePrivate = session => !session.ambiguous && (!draft.bindings.sessions.some(b => b.sessionId === session.id && b.roleId !== role.id)) && (!session.roleId || session.roleId === role.id);
    const privatePage = h('div', null,
      h('p', null, '统一人设描述鱼是谁；这里补充“你是谁、你们的关系，以及只在与你私聊时使用的相处规则”。专属规则叠加在统一人设之后，不继承到子代理，也不写进群聊或插件的全局人设。'),
      h('label', null, h('input', { type: 'checkbox', checked: profile.enabled, disabled: busy, onChange: e => editPrivate({ enabled: e.target.checked }) }), ' 启用与我的私聊身份'),
      field('私聊时它怎么称呼我', profile.ownerName, value => editPrivate({ ownerName: value }), 16, '留空沿用：' + role.ownerName),
      h('label', { style: { display: 'block', margin: '12px 0' } }, '我的个人情况、与鱼的关系和专属相处规则',
        h('textarea', { style: { ...control, display: 'block', width: '100%', marginTop: 6 }, rows: 10, maxLength: 12000, disabled: busy, value: profile.persona,
          placeholder: '例如：我希望你了解的个人情况；我们之间的称呼、习惯；与你私聊时需要特别照顾的沟通方式。请按自己的意愿填写。', onChange: e => editPrivate({ persona: e.target.value }) })),
      h('p', { style: muted }, '可用 {{selfName}}、{{ownerName}} 引用本轮名字和私聊称呼。这里只保存你填写的内容，不预设你们的关系。'),
      h('details', { style: { margin: '16px 0' } }, h('summary', null, '本机 DSH 中与我私聊（可选，已选 ' + profile.localSessions.length + ' 间）'),
        h('p', { style: muted }, '可选择专用会话供你在 DSH 直接聊天。勾选会将未单独绑定的会话绑定到当前角色；其他角色的会话需先到会话绑定页调整。移除勾选只停用专属规则，不删除原会话或角色绑定。'),
        ...sessions.map(session => h('label', { key: session.id, style: { display: 'block', margin: '8px 0' } }, h('input', { type: 'checkbox', checked: profile.localSessions.includes(session.id), disabled: busy || (!profile.localSessions.includes(session.id) && !canChoosePrivate(session)), onChange: () => setPrivateTarget('local', session.id) }), ' ', session.title,
        h('span', { style: muted }, ' · ' + (session.workspace || '未分组')),
        privateSaved?.local.find(item => item.sessionId === session.id)?.conflict && h('div', { style: muted }, privateSaved.local.find(item => item.sessionId === session.id).conflict)))),
      h('h3', null, '绑定我的平台私信账号'),
      h('p', { style: muted }, '先填写账号、选择专用会话并保存，再点连接按钮。连接只配置入口，不发送测试私信。QQ 连接服务仍在通到QQ中设置；同一会话连接了群聊、其他人或公开任务时，会提示冲突。'),
      ...[['bili', 'B站', 'uid', 'B站 UID（数字账号）'], ['qq', 'QQ', 'number', '我的 QQ号']].map(([channel, label, key, inputLabel]) => {
        const binding = profile[channel], saved = privateSaved?.[channel];
        const suggestion = channel === 'bili' ? data.privateSuggestions?.bili : data.privateSuggestions?.qq?.[0];
        return h('div', { key: channel, style: card }, h('strong', null, label + ' 私信'),
          field(inputLabel, binding[key], value => editPrivate({ [channel]: { ...binding, [key]: value } }), channel === 'bili' ? 16 : 12),
          suggestion?.[key] && h('button', { style: control, disabled: busy, onClick: () => {
            edit(c => ({ ...c, roles: c.roles.map(r => r.id !== role.id ? r : { ...r, privateChat: { ...r.privateChat, [channel]: { ...r.privateChat[channel], [key]: suggestion[key] } } }) }));
            setStatus('已把插件现有账号填入草稿；请自行核对是否为本人，再保存。');
          } }, '填入插件当前账号（需你核对）'),
          h('label', { style: { display: 'block', margin: '12px 0' } }, label + ' 专用私聊会话 ',
            h('select', { style: { ...control, maxWidth: '100%' }, value: binding.sessionId, disabled: busy, onChange: e => setPrivateTarget(channel, e.target.value) }, h('option', { value: '' }, '请选择专用会话'),
              ...sessions.map(session => h('option', { key: session.id, value: session.id, disabled: session.id !== binding.sessionId && !canChoosePrivate(session) }, session.title + ' · ' + (session.workspace || '未分组'))))),
          h('button', { style: control, disabled: busy || dirty || !profile.enabled || !binding[key] || !binding.sessionId, onClick: () => connectPrivate(channel) }, channel === 'bili' ? '连接并启用 B站私信' : '保存到 QQ 私聊绑定'),
          saved && h('p', { style: muted }, saved.account ? saved.account + ' · ' : '', saved.message),
          channel === 'bili' && h('p', { style: muted }, 'B站当前插件共用一个互动入口。连接会启用本人私信接收；已有自动刷或公开互动正在使用入口时会拒绝覆盖。自动公开动态的原目标会保留。'));
      }),
      dirty && h('p', { style: muted }, '有未保存修改；请先保存控制台设置，平台连接按钮随后可用。'),
      h('p', { style: muted }, '仅凭聊天正文里自称本人、昵称或账号不能触发专属规则。规则在下一条来源可确认的新私聊中生效；关闭此身份只停止专属规则，不删除平台连接。'));
    const bindingsPage = h('div', null,
      h('p', null, '把当前角色绑定到工作区，或只绑定某个会话。单独会话绑定优先；子代理默认继承父会话角色，其后才使用工作区绑定。'),
      h('label', null, h('input', { type: 'checkbox', checked: draft.inheritParentRole, disabled: busy, onChange: e => edit(c => ({ ...c, inheritParentRole: e.target.checked })) }), ' 子代理继承父会话角色（工具权限仍按自身工作区）'),
      h('h3', null, '工作区绑定'),
      ...workspaces.map(w => {
        const binding = draft.bindings.workspaces.find(b => b.workspace === w.path);
        return h('label', { key: w.path, style: { display: 'block', margin: '12px 0' } }, h('input', { type: 'checkbox', checked: binding?.roleId === role.id, disabled: busy || (!w.available && binding?.roleId !== role.id), onChange: e => bindWorkspace(w.path, e.target.checked) }), ' ', w.title,
          h('div', { style: { ...muted, marginLeft: 22 } }, w.path, !w.available ? ' · 当前不可用' : '', binding && binding.roleId !== role.id ? ' · 已绑定 ' + roleName(binding.roleId) + '，勾选会改为当前角色' : ''));
      }),
      h('h3', null, '会话单独绑定'), field('搜索会话', search, setSearch, 160),
      data.catalog?.metadata?.message && h('p', { style: muted }, data.catalog.metadata.message),
      ...sessions.filter(s => [s.title, s.workspace, s.id].join(' ').toLowerCase().includes(search.toLowerCase())).map(s => {
        const binding = draft.bindings.sessions.find(b => b.sessionId === s.id);
        return h('label', { key: s.id, style: { display: 'block', margin: '12px 0' } }, h('input', { type: 'checkbox', checked: binding?.roleId === role.id, disabled: busy || s.ambiguous, onChange: e => bindSession(s.id, e.target.checked) }), ' ', s.title,
          h('div', { style: { ...muted, marginLeft: 22 } }, s.workspace || '未分组', ' · ', s.id, ' · 当前保存的归属：', s.roleId ? roleName(s.roleId) + '（' + (sourceNames[s.source] || s.source) + '）' : '未绑定'));
      }));
    const coverage = data.coverage || { records: [], counters: {}, categories: [] };
    const coveragePage = h('div', null,
      h('p', null, '覆盖检查对应已保存的设置。绑定或尝试注入后，仍需观察到实际请求，才会显示“确认携带”。'),
      h('p', { style: muted }, '只观察经过 DSH 模型入口的请求，不代表模型执行成功或一定遵循人设。仅保留本次加载后最近 ' + (coverage.limit || 200) + ' 条元数据，不保存聊天正文；不改写插件内部请求。'),
      (!data.capabilities?.modelEntry || coverage.observationErrors > 0) && h('p', { role: 'alert' }, '模型入口观察接口不可用或有观察失败；此时不能判断完整覆盖。'),
      ...coverage.categories.map(category => {
        const records = coverage.records.filter(r => r.category === category);
        const historical = records.filter(r => r.currentBinding === false || (r.roleId && !r.currentRevision));
        const current = records.filter(r => !historical.includes(r));
        return h('div', { key: category, style: card }, h('strong', null, categoryNames[category] || category), h('div', { style: muted }, records.length ? `当前设置下 ${current.length} 条观测：` + Object.keys(statusNames).map(state => `${statusNames[state]} ${current.filter(r => r.status === state).length}`).join('，') + (historical.length ? `；另有 ${historical.length} 条旧绑定／版本记录` : '') : '尚未观察到请求'));
      }),
      h('h3', null, '后台任务的会话归属'),
      h('p', { style: muted }, '以下只读检查插件保存的目标，不代表任务已执行。可以在本控制台单独绑定目标会话。'),
      ...(data.integrations?.tasks || []).map(task => h('div', { key: task.id, style: card }, h('strong', null, task.label),
        h('div', null, task.title || (task.sessionId ? task.sessionId : '插件自动挑选会话')), h('div', { style: muted }, task.workspace || '', task.enabled === false ? ' · 自动任务未开启' : ''),
        h('div', null, task.roleId ? '已配置角色：' + roleName(task.roleId) + '（待请求验证）' : task.state === 'automatic' ? '目标未固定，无法预先确认角色' : '目标未绑定角色或归属未知'),
        task.sessionId && sessionMap.has(task.sessionId) && h('button', { style: control, disabled: busy, onClick: () => { bindSession(task.sessionId, true); setStatus('已加入当前角色的会话绑定草稿，请保存。'); } }, '单独绑定到当前角色'))),
      ...(data.integrations?.notes || []).map((note, i) => h('p', { key: i, style: muted }, note.message)),
      h('h3', null, '会话检查'),
      ...sessions.map(s => {
        const last = s.lastRequest;
        const message = !s.roleId ? (s.roleStatus === 'unresolved' ? '归属不明' : '未绑定角色') : last ? (last.currentBinding === true && last.roleId === s.roleId && last.revision === s.revision ? statusNames[last.status] : '已有历史记录，等待当前角色的新请求') : s.assemblyAttempt?.roleId === s.roleId && s.assemblyAttempt?.revision === s.revision ? '已尝试注入，尚未观察到请求' : '已绑定，等待请求';
        return h('div', { key: s.id, style: { margin: '10px 0' } }, h('strong', null, s.title), ' · ', message, h('div', { style: muted }, s.roleId ? roleName(s.roleId) + ' · ' + (sourceNames[s.source] || s.source) : s.workspace));
      }),
      h('h3', null, '最近请求'),
      ...[...coverage.records].reverse().slice(0, 40).map(r => h('div', { key: r.id, style: card }, h('strong', null, (categoryNames[r.category] || r.category) + ' · ' + statusNames[r.status]),
        r.privateInput && h('div', null, '本人私聊规则：' + ({ covered: '确认携带', uncovered: '未携带', unexpected: '来源不符，需要检查' }[r.privateInput.status] || r.privateInput.status) + (r.privateInput.channel ? ' · ' + r.privateInput.channel : '')),
        h('div', null, r.reason), h('div', { style: muted }, r.sessionId ? (sessionMap.get(r.sessionId)?.title || r.sessionId) : '无可靠会话归属', r.roleId ? ' · 预期角色 ' + roleName(r.roleId) + ' · ' + r.revision : '', r.currentBinding === false ? ' · 旧绑定或版本记录' : r.roleId && !r.currentRevision ? ' · 非当前角色版本' : '', ' · ' + new Date(r.observedAt).toLocaleTimeString()))));
    const policy = draft.toolPolicies.find(p => p.workspace === workspace);
    const disabledTools = policy?.disabledTools || [];
    const toolMap = new Map((data.tools?.items || []).map(t => [t.name, t]));
    for (const name of disabledTools) if (!toolMap.has(name)) toolMap.set(name, { name, available: false });
    const toggleTool = (name, enabled) => edit(c => ({ ...c, toolPolicies: [...c.toolPolicies.filter(p => p.workspace !== workspace), { workspace, disabledTools: enabled ? disabledTools.filter(n => n !== name) : [...disabledTools, name] }] }));
    const toolsPage = h('div', null,
      h('p', null, '工具权限按工作区独立设置，不随角色或父会话继承。记忆和心情的后台服务照常运行。'),
      h('label', null, '工具权限工作区 ', h('select', { style: control, disabled: busy, value: workspace, onChange: e => setWorkspace(e.target.value) }, h('option', { value: '' }, '请选择'), ...workspaces.map(w => h('option', { key: w.path, value: w.path }, w.title)))),
      !data.capabilities?.toolGuard && h('p', { role: 'alert' }, '当前 DSH 缺少工具调用拦截接口，无法保证工具开关生效。'),
      h('p', { style: muted }, '工具清单来自当前已加载的工具。相同名字的工具无法按提供方区分；关闭工具不会停止插件的后台收发或定时任务。'),
      ...[...toolMap.values()].map(t => h('div', { key: t.name, style: { margin: '10px 0' } },
        h('label', null, h('input', { type: 'checkbox', checked: !disabledTools.includes(t.name), disabled: busy || !workspace || !data.capabilities?.toolGuard, onChange: e => toggleTool(t.name, e.target.checked) }), ' ', t.name, t.available === false ? '（当前不可见，保留设置）' : ''),
        t.description && h('div', { style: { ...muted, marginLeft: 22 } }, t.description))));
    const bound = [...draft.bindings.workspaces, ...draft.bindings.sessions].some(b => b.roleId === role.id);
    return h('div', { style: { padding: 16, maxWidth: 900, lineHeight: 1.6 } },
      h('h2', null, '统一角色控制台'), h('p', { style: muted }, '统一管理角色、绑定和工具权限，并同步插件名字与称呼；其他插件代码保持原样。'),
      data.configError && h('p', { role: 'alert' }, data.configError),
      data.catalog?.registryAvailable === false && h('p', { role: 'alert' }, 'DSH 工作区名单暂不可用，新绑定可能无法保存。'),
      h('div', { style: { position: 'sticky', top: 0, background: 'var(--dsw-alias-bg-layer-1, #292929)', padding: '10px 0', zIndex: 3, display: 'flex', gap: 8, flexWrap: 'wrap' } },
        h('button', { style: control, disabled: busy, onClick: save }, busy ? '处理中…' : '保存控制台设置'),
        h('button', { style: control, disabled: busy || dirty, onClick: refresh }, '刷新'),
        tab === 'screen' && h('span', { style: muted }, '屏幕设置即时保存，无需点击此处保存。'),
        dirty && h('button', { style: control, disabled: busy, onClick: () => { setDraft(structuredClone(data.config)); setError(''); setStatus('已撤销本页未保存修改'); } }, '撤销未保存修改'),
        dirty && h('span', null, '有未保存修改')),
      h('label', null, '当前编辑角色 ', h('select', { style: control, value: role.id, disabled: busy, onChange: e => setRoleId(e.target.value) }, ...draft.roles.map(r => h('option', { key: r.id, value: r.id }, r.label)))),
      ' ', h('button', { style: control, disabled: busy || draft.roles.length >= 32, onClick: () => {
        const id = 'role-' + Date.now().toString(36); edit(c => ({ ...c, roles: [...c.roles, { ...role, id, label: (role.label + '副本').slice(0, 40), privateChat: { ...structuredClone(role.privateChat), enabled: false, localSessions: [], bili: { uid: '', sessionId: '' }, qq: { number: '', sessionId: '' } } }] })); setRoleId(id);
      } }, '复制为新角色'),
      ' ', h('button', { style: control, disabled: busy || bound || draft.roles.length <= 1, onClick: () => { edit(c => ({ ...c, roles: c.roles.filter(r => r.id !== role.id) })); setRoleId(draft.roles.find(r => r.id !== role.id).id); } }, '删除未绑定角色'),
      h('p', { style: muted }, '当前角色绑定 ' + draft.bindings.workspaces.filter(b => b.roleId === role.id).length + ' 个工作区、' + draft.bindings.sessions.filter(b => b.roleId === role.id).length + ' 个单独会话。'),
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, margin: '16px 0' } }, ...[['role', '统一角色'], ['private', '与我私聊'], ['bindings', '会话绑定'], ['coverage', '覆盖检查'], ['tools', '工具权限'], ['screen', '屏幕感知']].map(([key, label]) => h('button', { key, style: { ...control, fontWeight: tab === key ? 700 : 400 }, 'aria-pressed': tab === key, onClick: () => setTab(key) }, label))),
      status && h('p', { role: 'status' }, status), error && h('p', { role: 'alert', style: { color: '#e88' } }, error),
      tab === 'role' ? rolePage : tab === 'private' ? privatePage : tab === 'bindings' ? bindingsPage : tab === 'coverage' ? coveragePage : tab === 'tools' ? toolsPage : null,
      h(ScreenPage, { active: tab === 'screen', sessions }));
  }
  let panelModule;
  function AvatarDock({ sessionId, avatarFeed, session }) {
    const [Panel, setPanel] = React.useState(null), [error, setError] = React.useState('');
    React.useEffect(() => {
      let live = true;
      panelModule ??= import('/fish-console/avatar/panel.js').then(module => module.avatarPanel(React));
      panelModule.then(view => { if (live) setPanel(() => view); }).catch(() => {
        panelModule = undefined;
        if (live) setError('小肥鱼角色资源尚未加载，请完整退出并重新打开 DeepSeek Harness。');
      });
      return () => { live = false; };
    }, []);
    return Panel ? h(Panel, { key: sessionId, sessionId, feed: avatarFeed, running: !!session?.running })
      : error ? h('small', { role: 'status' }, error) : null;
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
    slots.inject('conversation.input.dock', () => slots.register({ name: 'conversation.input.dock', id: 'fish-avatar', order: 50,
      inject: id => ({ avatarFeed: ctx.get('sessions')?.binding(id)?.eventSource }) }, AvatarDock));
    ctx.effect?.(() => () => { endGuide(); navigateSettings = undefined; });
  }
  return { apply, inject: ['slots'] };
}});
