// One WebAssembly instance owns one model. Dropping it releases the revived MOC and its arena.
export async function openModel(wasm, bytes) {
  const wasi = { fd_close: () => 8, fd_seek: () => 8, fd_write: () => 8 };
  const { instance } = await WebAssembly.instantiate(wasm, { wasi_snapshot_preview1: wasi });
  const c = instance.exports;
  c._initialize();
  const alloc = (size) => {
    const p = c.aligned_alloc(64, Math.ceil(size / 64) * 64);
    if (!p) throw new Error('角色模型内存不足');
    return p;
  };
  const raw = alloc(bytes.byteLength);
  new Uint8Array(c.memory.buffer, raw, bytes.byteLength).set(new Uint8Array(bytes));
  if (!c.csmHasMocConsistency(raw, bytes.byteLength)) throw new Error('角色 MOC3 校验失败');
  const moc = c.csmReviveMocInPlace(raw, bytes.byteLength);
  if (!moc) throw new Error('无法读取角色 MOC3');
  const size = c.csmGetSizeofModel(moc);
  const model = c.csmInitializeModelInPlace(moc, alloc(size), size);
  if (!model) throw new Error('角色网格初始化失败');
  const info = alloc(20);
  c.csmReadCanvasInfo(model, info, info + 8, info + 16);
  const memory = c.memory.buffer,
    utf8 = new TextDecoder();
  const u32 = (ptr, n) => new Uint32Array(memory, ptr, n);
  const f32 = (ptr, n) => new Float32Array(memory, ptr, n);
  const probe = new Uint8Array(memory);
  const id = (ptr) => utf8.decode(probe.subarray(ptr, probe.indexOf(0, ptr)));
  const params = c.csmGetParameterCount(model);
  const indexes = new Map(Array.from(u32(c.csmGetParameterIds(model), params), (p, i) => [id(p), i]));
  const values = f32(c.csmGetParameterValues(model), params);
  const count = c.csmGetDrawableCount(model);
  const table = (fn) => u32(c[fn](model), count);
  const names = table('csmGetDrawableIds'),
    lengths = table('csmGetDrawableVertexCounts');
  const coords = table('csmGetDrawableVertexPositions'),
    uv = table('csmGetDrawableVertexUvs');
  const indexCounts = table('csmGetDrawableIndexCounts'),
    indices = table('csmGetDrawableIndices');
  const maskCounts = table('csmGetDrawableMaskCounts'),
    maskIndices = table('csmGetDrawableMasks');
  const meshes = Array.from(names, (p, i) => ({
    id: id(p),
    index: i,
    xy: f32(coords[i], 2 * lengths[i]),
    uv: f32(uv[i], 2 * lengths[i]),
    triangles: new Uint16Array(memory, indices[i], indexCounts[i]),
    masks: Array.from(u32(maskIndices[i], maskCounts[i])),
  }));
  const orders = table('csmGetRenderOrders'),
    opacities = f32(c.csmGetDrawableOpacities(model), count);
  const [width, height, originX, originY, pixelsPerUnit] = f32(info, 5);
  return {
    meshes,
    orders,
    opacities,
    indexes,
    width,
    height,
    originX,
    originY,
    pixelsPerUnit,
    update(parameters) {
      for (const [name, value] of Object.entries(parameters)) {
        const index = indexes.get(name);
        if (index !== undefined && Number.isFinite(value)) values[index] = value;
      }
      c.csmUpdateModel(model);
    },
  };
}
