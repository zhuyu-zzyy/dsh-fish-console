// Core Audio may add metadata chunks to a WAV. DSH accepts a canonical PCM16 mono header.
export function canonicalRecording(encoded) {
  if (typeof encoded !== 'string' || encoded.length > 1_500_000) throw new Error('录音超过 30 秒或格式不正确');
  const wav = Buffer.from(encoded, 'base64');
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('录音文件无效');
  let pcm,
    valid = false;
  for (let i = 12; i + 8 <= wav.length; ) {
    const n = wav.readUInt32LE(i + 4),
      at = i + 8,
      name = wav.toString('ascii', i, i + 4);
    if (at + n > wav.length) throw new Error('录音文件不完整');
    if (name === 'fmt ' && n >= 16) {
      const tag = wav.readUInt16LE(at);
      const linearPCM =
        tag === 1 ||
        (tag === 0xfffe &&
          n >= 40 &&
          wav.readUInt16LE(at + 18) === 16 &&
          wav.subarray(at + 24, at + 40).toString('hex') === '0100000000001000800000aa00389b71');
      valid =
        linearPCM &&
        wav.readUInt16LE(at + 12) === 2 &&
        wav.readUInt16LE(at + 2) === 1 &&
        wav.readUInt32LE(at + 4) === 16000 &&
        wav.readUInt16LE(at + 14) === 16;
    }
    if (name === 'data') pcm = wav.subarray(at, at + n);
    i = at + n + (n % 2);
  }
  if (!valid || !pcm?.length || pcm.length % 2 || pcm.length > 30 * 32000)
    throw new Error('需要 30 秒内的单声道 16 kHz PCM 录音');
  const buf = Buffer.alloc(44 + pcm.length);
  buf.write('RIFF');
  buf.writeUInt32LE(buf.length - 8, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(16000, 24);
  buf.writeUInt32LE(32000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(pcm.length, 40);
  pcm.copy(buf, 44);
  return buf.toString('base64');
}
