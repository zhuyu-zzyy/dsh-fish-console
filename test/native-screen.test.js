import test from 'node:test';
import { createTools, assemblePrompt, executeTool } from './dsh-runtime.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('屏幕工具通过真实 DSH 输出校验，图片路由、来源与暂停在采集前生效', { skip: !process.env.FISH_CONSOLE_DSH_MODULES }, async () => {
  const load = name => import(pathToFileURL(path.join(process.env.FISH_CONSOLE_DSH_MODULES, '@deepseek-ai', name, 'lib/index.js')).href);
  const [{ Context }, { ToolRuntime }, { SystemPrompt }, { LlmRuntime }, { createScreenService }] = await Promise.all([
    load('cordis'), load('dsh-tools'), load('dsh-system-prompt'), load('dsh-llm'), import('../lib/screen.js'),
  ]);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-console-native-screen-'));
  const context = new Context();
  new SystemPrompt(context, {});
  const tools = await createTools(context, ToolRuntime);
  const llm = new LlmRuntime(context);
  let captures = 0, stored = 0, modalities = ['text', 'image'];
  const image = { attachmentId: 'sha256:' + 'a'.repeat(64), mediaType: 'image/png', bytes: 68, width: 1, height: 1, name: 'screen.png' };
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCTsAAAAASUVORK5CYII=', 'base64');
  const agent = id => ({ id, session: { id, header: { cwd: home }, requestHeader: () => ({ config: { provider: 'isolated-provider', model: 'isolated-model' } }) }, options: {}, phase: { kind: 'running', turn: 1 } });
  const inside = agent('inside'), outside = agent('outside');
  const facade = {
    tools, agents: { list: () => [inside, outside] },
    effect: fn => context.effect(fn), on: context.on.bind(context),
    get: name => name === 'attachments' ? {
      imageLimits: { mediaTypes: ['image/png'], maxImageBytes: 5 * 1024 * 1024, maxMessageImageBytes: 5 * 1024 * 1024 },
      saveImage: async input => {
        stored++;
        assert.equal(input.mediaType, 'image/png');
        assert.deepEqual(input.data, png);
        return image;
      },
    } : name === 'llm' ? {
      resolveModelInfo: async (provider, model) => {
        assert.equal(provider, 'isolated-provider'); assert.equal(model, 'isolated-model');
        return { inputModalities: modalities };
      },
    } : undefined,
  };
  const descriptors = new Map([inside, outside].map(value => [value.id, { id: value.id, workspace: home }]));
  const service = createScreenService({
    ctx: facade, home,
    getCatalog: () => ({ lookup: id => descriptors.get(id), isLive: () => true }),
    capture: { supported: true, capture: async () => { captures++; return { data: png, mediaType: 'image/png', width: 1, height: 1 }; } },
  });
  const claim = (who, source = 'user') => service.claim({ agent: who, turn: who.phase.turn, message: { role: 'user', source: { kind: source }, content: [{ type: 'text', text: '看看当前屏幕' }] } });
  let callId = 0;
  const invoke = who => executeTool(tools, who, 'screen_observe', {}, 'screen-' + ++callId);
  try {
    assert.equal(llm.listProviders().length, 0, '隔离测试不得注册网络模型');
    await service.save({ version: 1, enabled: true, sessions: ['inside'] }, service.snapshot().baseRevision);
    assert.ok(tools.schemas(inside).some(tool => tool.name === 'screen_observe'));

    claim(outside);
    assert.equal((await invoke(outside)).isError, true);
    assert.equal(captures, 0, '未授权会话不得调用系统截图');

    claim(inside, 'qq');
    assert.equal((await invoke(inside)).isError, true);
    assert.equal(captures, 0, '平台输入不得复用本机屏幕权限');

    inside.phase.turn++;
    claim(inside);
    modalities = ['text'];
    assert.equal((await invoke(inside)).isError, true);
    assert.equal(captures, 0, '文字模型应在采集前得到拒绝');

    modalities = ['text', 'image'];
    const result = await invoke(inside);
    assert.equal(result.isError, false, JSON.stringify(result));
    const block = result.content.find(item => item.type === 'image');
    assert.deepEqual(block?.attachment, image, '真实工具运行时应接受标准图片附件输出');
    assert.equal(captures, 1); assert.equal(stored, 1);
    assert.equal(service.snapshot().status.lastCapture.delivery, 'model');

    // In PTC mode the host forwards successful nested-tool images as a user
    // context with this native source. It is tool context, not platform input.
    service.claim({ agent: inside, turn: inside.phase.turn, message: {
      role: 'user', source: { kind: 'ptc-mode' }, content: result.content,
    } });
    const afterPtcImage = await invoke(inside);
    assert.equal(afterPtcImage.isError, false, JSON.stringify(afterPtcImage));
    assert.ok(afterPtcImage.content.some(item => item.type === 'image'));
    assert.equal(captures, 2); assert.equal(stored, 2);

    await service.pause();
    assert.equal((await invoke(inside)).isError, true);
    assert.equal(captures, 2, '暂停后不得继续采集');
    assert.equal(llm.listProviders().length, 0);
  } finally {
    service.dispose(); await context.fiber.dispose();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('真实提示组装说明屏幕暂停状态与 native/PTC 调用方式，不向平台或子代理追加说明', { skip: !process.env.FISH_CONSOLE_DSH_MODULES }, async () => {
  const load = name => import(pathToFileURL(path.join(process.env.FISH_CONSOLE_DSH_MODULES, '@deepseek-ai', name, 'lib/index.js')).href);
  const [{ Context }, { ToolRuntime }, { SystemPrompt, renderPrompt }, { createScreenService }] = await Promise.all([
    load('cordis'), load('dsh-tools'), load('dsh-system-prompt'), import('../lib/screen.js'),
  ]);
  for (const mode of ['native', 'ptc']) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-console-screen-guidance-'));
    const context = new Context(), prompt = new SystemPrompt(context, {});
    if (mode === 'ptc') context.provide('ptcRuntime', {
      language: 'typescript', programFormat: 'function-body',
      execute: async () => { throw new Error('提示组装测试不能执行程序'); },
    });
    const tools = await createTools(context, ToolRuntime, mode);
    const inside = { id: 'inside', session: { id: 'inside', header: { cwd: home } }, options: {}, phase: { kind: 'running', turn: 1 } };
    const outside = { id: 'outside', session: { id: 'outside', header: { cwd: home } }, options: {}, phase: { kind: 'running', turn: 1 } };
    const facade = {
      tools,
      get: name => name === 'attachments' ? { saveImage: async () => { throw new Error('提示组装测试不能写图片'); } }
        : name === 'llm' ? { resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }) } : context.get(name),
    };
    const service = createScreenService({
      ctx: facade, home,
      getCatalog: () => ({ lookup: id => ['inside', 'outside'].includes(id) ? { id, workspace: home } : undefined, isLive: value => value === inside || value === outside }),
      capture: { supported: true, capture: async () => { throw new Error('提示组装测试不能截图'); } },
    });
    const detach = context.on('system-prompt/assemble', async (_assembly, assemblyContext, next) => service.filterAssembly(await next(), assemblyContext.agent));
    const claim = (agent, kind = 'user') => service.claim({ agent, turn: agent.phase.turn, message: { role: 'user', source: { kind }, content: [{ type: 'text', text: '请看屏幕' }] } });
    const assemble = agent => assemblePrompt(prompt, tools, agent);
    const guidance = assembly => assembly.sections.filter(section => section.name === 'fish-console.screen');
    try {
      await service.save({ version: 1, enabled: false, sessions: ['inside'] }, service.snapshot().baseRevision);
      claim(inside);
      const paused = await assemble(inside), pausedText = renderPrompt(paused);
      assert.equal(guidance(paused).length, 1, mode + ' 暂停时也应说明已安装功能的状态');
      assert.ok(pausedText.includes('屏幕感知已暂停'), pausedText);
      assert.ok(pausedText.includes('不要改用 shell'), pausedText);
      assert.ok(!paused.tools.some(tool => tool.name === 'screen_observe'), '暂停时不得重新暴露原生截图schema');
      assert.equal(guidance(service.filterAssembly(paused, inside)).length, 1, '重复组装只保留一段当前说明');

      claim(outside);
      assert.equal(guidance(await assemble(outside)).length, 0, '未配置会话不追加屏幕提示');
      inside.phase.turn++; claim(inside, 'qq');
      assert.equal(guidance(await assemble(inside)).length, 0, '平台输入轮次不追加本机提示');
      inside.phase.turn++; claim(inside, 'unrecognized-source');
      assert.equal(guidance(await assemble(inside)).length, 0, '未知来源不追加本机提示');
      inside.session.header.parentSession = 'parent';
      inside.phase.turn++; claim(inside);
      assert.equal(guidance(await assemble(inside)).length, 0, '子代理不继承屏幕说明');
      delete inside.session.header.parentSession;

      await service.save({ version: 1, enabled: true, sessions: ['inside'] }, service.snapshot().baseRevision);
      inside.phase.turn++; claim(inside);
      const enabled = await assemble(inside), enabledText = renderPrompt(enabled);
      assert.equal(guidance(enabled).length, 1);
      assert.ok(enabledText.includes('screen_observe'), enabledText);
      assert.ok(enabledText.includes('run_code'), enabledText);
      assert.ok(enabledText.includes('await tools.screen_observe({})'), enabledText);
      assert.ok(!guidance(enabled)[0].text.includes('屏幕感知已暂停'), '旧暂停说明必须被当前状态替换');
      if (mode === 'ptc') {
        assert.deepEqual(enabled.tools.map(tool => tool.name), ['run_code'], 'PTC 直接工具只展示传输工具');
        assert.ok(enabled.sections.find(section => section.name === 'tools:sdk')?.text.includes('screen_observe'), 'PTC 应在生成的SDK中保留截图函数声明');
      } else assert.ok(enabled.tools.some(tool => tool.name === 'screen_observe'), 'native 应直接展示获准工具');
    } finally {
      detach(); service.dispose(); await context.fiber.dispose(); fs.rmSync(home, { recursive: true, force: true });
    }
  }
});
