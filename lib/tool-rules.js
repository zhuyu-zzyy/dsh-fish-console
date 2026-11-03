// These are transports or memory capabilities, not console-controlled skills.
export const protectedTool = name => name === 'run_code' || name === 'remember';

export function cleanToolNames(names) {
  if (!Array.isArray(names) || names.length > 1000 || names.some(n => typeof n !== 'string' || !n.trim() || n.length > 200 || /[\u0000-\u001f]/.test(n))) {
    throw new Error('工具列表无效');
  }
  return [...new Set(names)].filter(n => !protectedTool(n)).sort();
}
