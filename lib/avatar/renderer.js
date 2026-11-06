import { openModel } from './core.js';

async function resource(url, signal, method) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('角色资源加载失败（' + res.status + '）');
  return res[method]();
}
function pipeline(gl) {
  const program = gl.createProgram();
  const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision ? 'highp' : 'mediump';
  for (const [type, source] of [
    [
      gl.VERTEX_SHADER,
      `attribute vec2 position,uv; uniform vec2 scale; varying ${precision} vec2 tex; void main(){gl_Position=vec4(position*scale,0.,1.);tex=vec2(uv.x,1.-uv.y);}`,
    ],
    [
      gl.FRAGMENT_SHADER,
      `precision ${precision} float; varying ${precision} vec2 tex; uniform sampler2D atlas; uniform float opacity; uniform bool maskPass; void main(){vec4 c=texture2D(atlas,tex);if(maskPass && c.a*opacity<0.35)discard;gl_FragColor=c*opacity;}`,
    ],
  ]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('无法启动角色 WebGL 渲染');
  gl.useProgram(program);
  return program;
}
async function loadActor(id, wasm, signal) {
  const entry = id === 'main' ? './model/fish.model3.json' : './scenes/' + id + '/' + id + '.model3.json';
  const manifest = new URL(entry, import.meta.url);
  const get = (file, method = 'json') => resource(new URL(file, manifest), signal, method);
  const { FileReferences: files } = await resource(manifest, signal, 'json');
  const [moc, blob, expressions, motions, physics] = await Promise.all([
    get(files.Moc, 'arrayBuffer'), get(files.Textures[0], 'blob'),
    Promise.all(files.Expressions.map(async (e) => {
      const data = await get(e.File);
      return [e.Name, id === 'main' ? data.Parameters : data];
    })),
    Promise.all(Object.entries(files.Motions).map(async ([name, entries]) => [name, await get(entries[0].File)])),
    files.Physics ? get(files.Physics) : null,
  ]);
  signal.throwIfAborted();
  const model = await openModel(wasm, moc);
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'premultiply' });
  return { id, model, bitmap, assets: {
    expressions: Object.fromEntries(expressions), motions: Object.fromEntries(motions), physics: physics?.PhysicsSettings[0],
  } };
}

function upload(gl, actor, signal) {
  const { model, bitmap } = actor;
  const buffers = [], texture = gl.createTexture();
  const release = () => {
    for (const b of buffers) gl.deleteBuffer(b);
    gl.deleteTexture(texture);
  };
  try {
    signal.throwIfAborted();
    if (model.meshes.some((m) => m.masks.length) && !gl.getContextAttributes()?.stencil)
      throw new Error('当前 WebGL 设备不支持角色遮罩');
    function buffer(target, values, mode) {
      const b = gl.createBuffer();
      buffers.push(b);
      gl.bindBuffer(target, b);
      gl.bufferData(target, values, mode);
      return b;
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    const parts = model.meshes.map(mesh => ({
      mesh, xy: buffer(gl.ARRAY_BUFFER, mesh.xy, gl.DYNAMIC_DRAW),
      uv: buffer(gl.ARRAY_BUFFER, mesh.uv, gl.STATIC_DRAW),
      triangles: buffer(gl.ELEMENT_ARRAY_BUFFER, mesh.triangles, gl.STATIC_DRAW),
    }));
    return { id: actor.id, model, assets: actor.assets, texture, parts, order: [...parts], release };
  } catch (error) {
    release();
    throw error;
  } finally {
    bitmap.close();
  }
}

export async function mountRenderer(canvas, signal, frame, options = {}) {
  const wasm = await resource(new URL('purism.wasm', import.meta.url), signal, 'arrayBuffer');
  const mainActor = await loadActor('main', wasm, signal);
  const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true, stencil: true });
  if (!gl) { mainActor.bitmap.close(); throw new Error('当前设备无法开启 WebGL'); }
  const main = upload(gl, mainActor, signal);
  const program = pipeline(gl);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const xy = gl.getAttribLocation(program, 'position'), uv = gl.getAttribLocation(program, 'uv');
  const opacity = gl.getUniformLocation(program, 'opacity'), maskPass = gl.getUniformLocation(program, 'maskPass');
  const scale = gl.getUniformLocation(program, 'scale');
  gl.enableVertexAttribArray(xy);
  gl.enableVertexAttribArray(uv);
  let idle, pending, failed, raf = 0, shown;
  const visibility = new ResizeObserver(() => {
    if (!raf && !signal.aborted && canvas.clientWidth && canvas.clientHeight) raf = requestAnimationFrame(render);
  });
  function release() {
    visibility.disconnect();
    cancelAnimationFrame(raf);
    pending?.abort();
    idle?.release();
    main.release();
    gl.deleteProgram(program);
  }
  signal.addEventListener('abort', release, { once: true });
  function loadScene(id) {
    const task = new AbortController();
    task.id = id;
    pending = task;
    loadActor(id, wasm, task.signal).then(actor => {
      const next = upload(gl, actor, task.signal);
      idle?.release();
      idle = next;
      failed = undefined;
    }).catch(error => {
      if (task.signal.aborted) return;
      failed = id;
      options.onSceneError?.(error.message || '无法加载待机场景');
    }).finally(() => { if (pending === task) pending = undefined; });
  }
  function draw(part, alpha) {
    gl.uniform1f(opacity, alpha);
    gl.bindBuffer(gl.ARRAY_BUFFER, part.xy);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, part.mesh.xy);
    gl.vertexAttribPointer(xy, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, part.uv);
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, part.triangles);
    gl.drawElements(gl.TRIANGLES, part.mesh.triangles.length, gl.UNSIGNED_SHORT, 0);
  }
  function render(time) {
    raf = 0;
    if (signal.aborted || gl.isContextLost() || !canvas.clientWidth || !canvas.clientHeight) return;
    const requested = options.scene?.(time) || 'main';
    if (pending && pending.id !== requested) { pending.abort(); pending = undefined; }
    if (failed !== requested) failed = undefined;
    if (requested !== 'main' && requested !== idle?.id && !pending && !failed) loadScene(requested);
    const actor = requested === idle?.id ? idle : main;
    const { model, assets, texture, parts, order } = actor;
    if (shown !== actor.id) {
      shown = actor.id;
      canvas.dataset.fishScene = shown;
      options.onScene?.(shown);
    }
    const fitDensity = Math.min(model.width / canvas.clientWidth, model.height / canvas.clientHeight);
    const dpr = Math.min(2, Math.max(window.devicePixelRatio || 1, fitDensity));
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const fit = Math.min(w / model.width, h / model.height) * 2 * model.pixelsPerUnit;
    gl.uniform2f(scale, fit / w, fit / h);
    model.update(frame(time, assets, actor.id));
    order.sort((a,b) => model.orders[a.mesh.index] - model.orders[b.mesh.index]);
    let writtenMask;
    for (const part of order) {
      const a = model.opacities[part.mesh.index];
      if (a <= .001) continue;
      if (part.mesh.masks.length) {
        gl.enable(gl.STENCIL_TEST);
        const key = part.mesh.masks.join(',');
        if (key !== writtenMask) {
          gl.stencilMask(0xff);
          gl.clear(gl.STENCIL_BUFFER_BIT);
          gl.stencilFunc(gl.ALWAYS, 1, 0xff);
          gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
          gl.colorMask(false, false, false, false);
          gl.uniform1i(maskPass, 1);
          for (const index of part.mesh.masks) draw(parts[index], model.opacities[index]);
          gl.uniform1i(maskPass, 0);
          gl.colorMask(true, true, true, true);
          gl.stencilMask(0);
          gl.stencilFunc(gl.EQUAL, 1, 0xff);
          gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
          writtenMask = key;
        }
      } else gl.disable(gl.STENCIL_TEST);
      draw(part, a);
    }
    raf = requestAnimationFrame(render);
  }
  visibility.observe(canvas);
  try { render(performance.now()); } catch (error) {
    signal.removeEventListener('abort', release);
    release();
    throw error;
  }
}
