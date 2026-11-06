// Keep independent turn/tool identities for each task. Only names and counts
// reach the desktop; background chat text is never merged into another chat.
export function createGlobalActivity() {
  const tasks = new Map();
  return {
    seed(id, activity) {
      if (activity.active) tasks.set(id, { turn: activity.turn, tools: new Map(activity.tools.map(tool => [tool.callId, tool.name])) });
    },
    event(id, event) {
      const data = event?.data;
      if (!id || !data) return;
      let task = tasks.get(id);
      if (event.type === 'turn/start') {
        task = { turn: data.turn, tools: new Map() };
        tasks.set(id, task);
      } else {
        if (task && data.turn !== undefined && task.turn !== undefined && task.turn !== data.turn) return;
        if (event.type === 'turn/end') tasks.delete(id);
        else if (event.type === 'step/start' || event.type === 'tool/call') {
          if (!task) { task = { turn: data.turn, tools: new Map() }; tasks.set(id, task); }
          if (event.type === 'tool/call') task.tools.set(data.callId, data.name);
        } else if (event.type === 'tool/result') task?.tools.delete(data.message?.toolCallId ?? data.message?.source?.callId);
      }
    },
    snapshot() {
      const tools = [...new Set([...tasks.values()].flatMap(task => [...task.tools.values()]))].filter(name => typeof name === 'string');
      return { count: tasks.size, tools: tools.slice(0, 4), progress: tasks.size ? `${tasks.size} 个任务正在进行` : '' };
    },
  };
}
