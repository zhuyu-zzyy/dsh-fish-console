// One native pet and one status connection, shared by settings and the invisible
// host bridge. No renderer or audio player is mounted in a conversation.
const listeners = new Set();
let events, snapshot, polling, pollTimer, revision = 0, lastEvent = 0;
function publish(value) {
  snapshot = value;
  revision++;
  for (const listener of listeners) listener(snapshot);
}
async function refreshDesktop() {
  if (polling || !listeners.size) return;
  const request = new AbortController(), at = revision;
  polling = request;
  try {
    const response = await fetch('/fish-console/avatar/pet', { cache: 'no-store', signal: request.signal });
    const value = await response.json();
    if (response.ok && !request.signal.aborted && at === revision) publish(value);
  } catch { /* The next poll or event reconnect will retry. */ }
  finally { if (polling === request) polling = undefined; }
}
export function watchDesktop(callback) {
  listeners.add(callback);
  if (snapshot) callback(snapshot);
  if (!events) {
    events = new EventSource('/fish-console/avatar/pet-updates');
    events.onmessage = event => {
      let value;
      try { value = JSON.parse(event.data); } catch { return; }
      lastEvent = Date.now();
      publish(value);
    };
    // DSH's desktop protocol can lose a streaming connection during reload.
    // Read once on mount and recover quiet/broken streams without another UI mount.
    void refreshDesktop();
    pollTimer = setInterval(() => { if (Date.now() - lastEvent > 1500) void refreshDesktop(); }, 2000);
  }
  return () => {
    listeners.delete(callback);
    if (!listeners.size) {
      events?.close(); events = undefined; snapshot = undefined; lastEvent = 0;
      clearInterval(pollTimer); polling?.abort(); polling = undefined;
    }
  };
}

export async function desktopAction(data) {
  const at = revision;
  const response = await fetch('/fish-console/avatar/pet', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok || result.ok === false) throw new Error(result.error || '桌宠操作失败');
  if (at === revision && listeners.size) publish(result);
  return result;
}

export function installDesktopBridge({ doc = document, win = window, Observer = MutationObserver,
  watch = watchDesktop, action = desktopAction } = {}) {
  let pet, disposed = false, opening = false, listening = null, foreground = '', serial = Promise.resolve();
  const setListening = (sessionId, generation, value) => {
    const key = JSON.stringify([sessionId, generation, value]);
    if (listening === key) return;
    listening = key;
    serial = serial.then(() => disposed ? undefined : action({ action: 'listen', sessionId, generation, value })).catch(() => {});
  };
  const scan = event => {
    if (disposed || !pet) return;
    const panes = [...doc.querySelectorAll('[data-conversation-session]')].filter(pane => pane.getClientRects().length);
    // Focus chooses the recent chat only for composing a message. The pet's
    // lifetime and its global task activity do not depend on this chat.
    const pane = !doc.hidden && doc.hasFocus() && (panes.find(pane => event?.target && pane.contains(event.target))
      || panes.find(pane => pane.contains(doc.activeElement)) || (panes.length === 1 ? panes[0] : undefined));
    const recent = pane?.dataset?.conversationSession;
    if (recent && recent !== foreground) {
      foreground = recent;
      serial = serial.then(() => disposed ? undefined : action({ action: 'foreground', sessionId: recent }))
        .catch(() => { if (foreground === recent) foreground = ''; });
    }
    if (pet.sessionId) {
      const pane = panes.find(pane => pane.dataset.conversationSession === pet.sessionId);
      const composer = pane?.querySelector('[data-conversation-region="composer"]');
      setListening(pet.sessionId, pet.generation, !doc.hidden && !!composer?.querySelector(
        '[data-voice-activity="recording"],[data-voice-activity="requesting"],[data-voice-activity="transcribing"]'));
    }
    if (!pet.canAutoOpen || opening || doc.hidden || !doc.hasFocus()) return;
    opening = true;
    serial = serial.then(() => disposed ? undefined : action({ action: 'autoOpen' }))
      .catch(() => {}).finally(() => { opening = false; });
  };
  const off = watch(value => { pet = value; scan(); });
  const observer = new Observer(() => scan());
  observer.observe(doc.body, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['data-voice-activity', 'data-conversation-session', 'hidden'] });
  for (const name of ['focusin', 'pointerdown', 'visibilitychange']) doc.addEventListener(name, scan);
  win.addEventListener('focus', scan);
  return () => {
    disposed = true; off(); observer.disconnect();
    for (const name of ['focusin', 'pointerdown', 'visibilitychange']) doc.removeEventListener(name, scan);
    win.removeEventListener('focus', scan);
  };
}
