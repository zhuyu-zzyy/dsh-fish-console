import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const loadDsh = name => import(pathToFileURL(path.join(process.env.FISH_CONSOLE_DSH_MODULES, '@deepseek-ai', name, 'lib/index.js')).href);

export async function createTools(ctx, ToolRuntime, mode = 'native') {
  const modern = typeof ToolRuntime.prototype.setExecutor === 'function';
  const tools = new ToolRuntime(ctx, modern ? {} : { mode });
  if (modern) {
    const { NativeToolExecutor, PtcExecutor } = await loadDsh('dsh-tool-executor-' + mode);
    tools.setExecutor(new (NativeToolExecutor || PtcExecutor)(ctx));
  }
  return tools;
}

export async function assemblePrompt(prompt, tools, agent) {
  const toolSet = await tools.resolve?.({ agent, modelSelection: { provider: 'test', model: 'test' }, signal: new AbortController().signal });
  try { return await prompt.assemble({ agent, scope: agent, ...(toolSet ? { toolSet } : {}) }); }
  finally { toolSet?.dispose(); }
}

export async function executeTool(tools, agent, name, args = {}, callId = 'test-call') {
  const signal = new AbortController().signal;
  if (typeof tools.setExecutor !== 'function') return tools.execute({ name, callId, agent, arguments: args, signal });
  const toolSet = await tools.resolve({ agent, modelSelection: { provider: 'test', model: 'test' }, signal });
  try {
    const batch = await tools.execute({ calls: [{ id: callId, name, arguments: JSON.stringify(args) }], agent, signal, toolSet });
    return batch.results[0].result;
  } finally { toolSet.dispose(); }
}
