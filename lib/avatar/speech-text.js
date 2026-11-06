const graphemes = new Intl.Segmenter('zh', { granularity: 'grapheme' });
const emoji = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Regional_Indicator}\p{Emoji_Modifier}\u20e3]/u;

// Stage directions can span sentences, lines, and nested full- or half-width parentheses.
// Keep the original message for the caption and emotion engine; only the audio path calls this.
export function spokenText(value) {
  if (typeof value !== 'string') return '';
  const text = value
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^()]*\))*\)/gu, '$1')
    .replace(/```[\s\S]*?(?:```|$)/gu, ' 代码略 ');
  let depth = 0,
    words = '';
  for (const char of text) {
    if (char === '(' || char === '（') {
      if (!depth) words += ' ';
      depth++;
    } else if (char === ')' || char === '）') depth = Math.max(0, depth - 1);
    else if (!depth) words += char;
  }
  let result = '';
  for (const { segment } of graphemes.segment(words)) result += emoji.test(segment) ? ' ' : segment;
  return result
    .replace(/[*#`\u200d\ufe0e\ufe0f\u20e3]/gu, '')
    .replace(/[^\S\n]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/(?<=\p{Script=Han}) +(?=\p{Script=Han})/gu, '')
    .replace(/ +(?=[，。！？、,.!?～])/gu, '')
    .trim();
}

export function speechChunks(text) {
  return (spokenText(text).match(/[^。！？!?\n]{1,180}[。！？!?]?/gu) || [])
    .map((s) => s.trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
}
