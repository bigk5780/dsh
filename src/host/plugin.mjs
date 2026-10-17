// plugin.mjs —— 宿主半侧的装配与循环。
//
// 一条自动链，全程零点击：
//   每 checkIntervalMs 探一次前台窗口
//     → 命中游戏（白名单/全屏策略）就开始计时
//     → 到点就：截屏 → 交给模型看图 → 拿回一句台词
//     → 写进 /state，浏览器里的桌宠自己念出来
//   切走游戏 / 关掉开关 → 立刻停手（不再截屏、不再调模型）
import { createReadStream, readdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adviseOnce, inspectVision } from './advise.mjs';
import { capturePng, detectForeground } from './collect.mjs';
import { DEFAULTS, KEEP_API_KEY, matchesGame, normalizeConfig } from './config.mjs';
import { readUserConfig, writeUserConfig } from './config-store.mjs';
import { startOverlayWindow } from './desktop-window.mjs';
import { redactVisionApi, testCustomApi } from './vision-api.mjs';
import { CompanionState } from './state.mjs';
import { moodOf, pickAnimation } from '../shared/agent.mjs';

export const ROUTE_PREFIX = '/dsh-game-pet-7341';

/** 包根目录：/anim/<名>.webm 与置顶小窗那一页都从这里读。 */
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ANIMATION_DIR = path.join(PACKAGE_ROOT, 'assets', 'webm');
const OVERLAY_HTML = path.join(PACKAGE_ROOT, 'runtime', 'overlay', 'overlay.html');
/** 窗口位置单独存一份（用户拖过就该记住，不该改写 profile 的 patch） */
const POSITION_FILE = path.join(process.env.DSH_HOME || path.join(homedir(), '.dsh'), 'dsh-game-pet-window.json');

/**
 * 自带动画清单（只算一次）。
 * 为什么要暴露给小窗：小窗要按"本地到底有哪些素材"来排回落链——
 * 本地没有的动画就别去试它（否则要等 404/超时才回落，观感是"卡一下才出小人"）。
 */
const BUNDLED_ANIMATIONS = (() => {
  try {
    return readdirSync(ANIMATION_DIR)
      .filter((name) => name.toLowerCase().endsWith('.webm'))
      .map((name) => name.slice(0, -'.webm'.length));
  } catch {
    return [];
  }
})();

/** /state 只暴露这几片（内部状态整包不出门）。 */
const STATE_KEYS = ['presence', 'advice', 'lastError', 'pet'];

/**
 * 插件入口。
 * @param ctx Cordis 上下文（webServer / llm / agentDefaultModel 已由 inject 声明）
 * @param config 这一行的 config（**第二个参数**！Cordis 不允许直接读 ctx.config，
 *   直接读会抛 `cannot get property "config" without inject` 并把整个插件挂掉——
 *   DSH 的插件契约是 `apply(ctx, config)`，见官方 cordis-plugin-development/references/host-plugin.md）
 */
export function apply(ctx, config) {
  const state = new CompanionState();
  // 用户覆盖（设置页改的）叠在行配置之上：行配置是"出厂默认/部署默认"，用户改的进 config.json
  const settings = normalizeConfig({ ...(config ?? {}), ...readUserConfig() });
  const log = (level, message) => {
    const logger = ctx.logger ?? console;
    const fn = typeof logger[level] === 'function' ? logger[level].bind(logger) : null;
    if (fn) fn(`dsh-game-pet: ${message}`);
  };

  /** 一次游戏会话的运行态 */
  const session = {
    /** 当前生效的配置（/config 可热改） */
    settings,
    /** 正在玩的游戏（null = 没在玩） */
    detection: null,
    startedAt: 0,
    lastSpokeAt: 0,
    /** 最近几句说过的话，喂回下一次请求当上下文 */
    notes: [],
    busy: false,
    timer: null,
    /** 诊断用：最近一次失败原因 */
    lastError: null,
    /** 上一张截图的时间与描述（snapshotTtlMs 用的缓存） */
    snapshot: null,
  };

  // 上次拖到哪里，这次还放那里（patch 里的 windowX/windowY 优先）
  if (session.settings.windowX === null || session.settings.windowY === null) {
    const remembered = readPosition();
    if (remembered) session.settings = { ...session.settings, windowX: remembered.x, windowY: remembered.y };
  }

  publish();

  /** 检测节拍器：间隔可热改，所以留一个可重建的句柄（重建时先清旧的）。 */
  let checkTimer = null;
  const startTimer = () => {
    if (checkTimer) clearInterval(checkTimer);
    checkTimer = setInterval(() => {
      void tick();
    }, Math.max(1000, session.settings.checkIntervalMs));
  };
  startTimer();

  ctx.effect(
    () => () => {
      if (checkTimer) clearInterval(checkTimer);
      checkTimer = null;
      if (session.timer) clearTimeout(session.timer);
      session.timer = null;
    },
    'dsh-game-pet: automation loop',
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: async (req, res) => {
          try {
            const url = new URL(req.url ?? '/', 'http://127.0.0.1');
            await handleRoute(req, res, url);
          } catch (error) {
            sendJson(res, 500, { ok: false, reason: 'internal', message: errorText(error) });
          }
        },
      }),
    'dsh-game-pet: /dsh-game-pet-7341 routes',
  );

  // 置顶小窗：等 webServer 拿到端口后拉起（没有 Electron 就只告警，浏览器浮层照常）
  ctx.effect(() => {
    if (session.settings.overlay !== 'window') return () => {};
    let overlay = null;
    let cancelled = false;

    const waitForPort = async () => {
      for (let attempt = 0; attempt < 30 && !cancelled; attempt += 1) {
        const port = typeof ctx.webServer?.port === 'number' ? ctx.webServer.port : 0;
        if (port > 0) {
          overlay = startOverlayWindow({
            port,
            x: session.settings.windowX,
            y: session.settings.windowY,
            log,
          });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (!cancelled) log('warn', 'webServer 端口一直没就绪，置顶小窗没起来');
    };

    void waitForPort();
    return () => {
      cancelled = true;
      overlay?.stop();
    };
  }, 'dsh-game-pet: desktop overlay window');

  async function handleRoute(req, res, url) {
    const route = url.pathname.slice(ROUTE_PREFIX.length) || '/';
    const method = (req.method ?? 'GET').toUpperCase();

    if (method === 'GET' && (route === '/state' || route === '/')) {
      sendJson(res, 200, state.snapshot(STATE_KEYS), { 'cache-control': 'no-store' });
      return;
    }
    // 置顶小窗要加载的那一页（纯 DOM，无依赖）
    if (method === 'GET' && route === '/overlay') {
      await sendOverlayHtml(res);
      return;
    }
    // 小窗拖动后回传坐标 → 记住，下次启动还放那儿
    if (method === 'POST' && route === '/position') {
      const body = await readJson(req);
      const x = Number(body?.x);
      const y = Number(body?.y);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        session.settings = { ...session.settings, windowX: Math.round(x), windowY: Math.round(y) };
        savePosition(session.settings);
      }
      sendJson(res, 200, { ok: true });
      return;
    }
    // 小窗的存活探测：宿主在就 200，宿主没了它自己退出
    if (method === 'POST' && route === '/ping') {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (method === 'GET' && route === '/config') {
      sendJson(
        res,
        200,
        {
          ok: true,
          config: publicConfig(session.settings),
          defaults: DEFAULTS,
          userConfig: readUserConfig(),
        },
        { 'cache-control': 'no-store' },
      );
      return;
    }
    if (method === 'POST' && route === '/config') {
      const body = await readJson(req);
      const patch = body && typeof body === 'object' ? body : {};
      // 只接受已知字段，避免设置页之外的乱写污染配置
      const accepted = {};
      for (const key of Object.keys(DEFAULTS)) {
        if (Object.prototype.hasOwnProperty.call(patch, key)) accepted[key] = patch[key];
      }
      // apiKey 的哨兵值 __KEEP__ = "沿用已存的"，绝不能拿它覆盖真 Key
      if (accepted.visionApi && typeof accepted.visionApi === 'object' && accepted.visionApi.apiKey === KEEP_API_KEY) {
        accepted.visionApi = { ...accepted.visionApi, apiKey: session.settings.visionApi?.apiKey ?? '' };
      }
      session.settings = normalizeConfig({ ...session.settings, ...accepted });
      // 落盘（用户覆盖层），重启后仍然生效
      const persisted = writeUserConfig(accepted);
      session.detection = null;
      session.startedAt = 0;
      publish();
      reschedule();
      sendJson(res, 200, { ok: true, persisted, config: publicConfig(session.settings) });
      return;
    }
    // 设置页「识图」卡片用：现在到底认不认得出可用的识图模型，认出来的是哪些
    if (method === 'GET' && route === '/vision') {
      const report = await inspectVision({ ctx, config: session.settings });
      sendJson(res, 200, report, { 'cache-control': 'no-store' });
      return;
    }
    // 设置页「测一下这个视觉 API」：body 可带未保存的草稿，这样能先测再存
    if (method === 'POST' && route === '/vision/test') {
      const body = await readJson(req);
      const draft = body && typeof body === 'object' ? body : {};
      const merged = normalizeConfig({
        ...session.settings,
        visionApi: { ...session.settings.visionApi, ...draft },
      });
      if (merged.visionApi?.apiKey === KEEP_API_KEY) {
        merged.visionApi = { ...merged.visionApi, apiKey: session.settings.visionApi?.apiKey ?? '' };
      }
      const result = await testCustomApi({ api: merged.visionApi, timeoutMs: 20000 });
      sendJson(res, 200, result);
      return;
    }
    // 诊断用：立刻跑一轮（不看间隔、不写"间隔已满足"的状态），返回这一轮的结论
    if (method === 'POST' && route === '/once') {
      if (session.busy) {
        sendJson(res, 200, { ok: false, reason: 'busy', message: '上一轮还没跑完' });
        return;
      }
      const result = await runCycle({ force: true });
      sendJson(res, 200, result);
      return;
    }
    // 诊断用：只看一眼前台窗口，不截屏不调模型
    if (method === 'GET' && route === '/probe') {
      const detection = await detectForeground();
      sendJson(res, 200, { ok: true, detection, matched: isGame(detection) }, { 'cache-control': 'no-store' });
      return;
    }
    // 本插件自带的动画素材（可选）：命中就顺手，没放素材就 404，客户端会回落到 dsh-pet。
    if (method === 'GET' && route.startsWith('/anim/')) {
      await sendAnimation(res, route.slice('/anim/'.length));
      return;
    }
    sendJson(res, 404, { ok: false, reason: 'not-found', message: `no such route: ${route}` });
  }

  /** 探一次前台窗口，更新"在不在玩"的判定。 */
  async function tick() {
    if (!session.settings.enabled) {
      if (session.detection) {
        session.detection = null;
        session.startedAt = 0;
        publish();
      }
      return;
    }
    const detection = await detectForeground();
    const playing = isGame(detection);
    if (!playing) {
      if (session.detection) {
        log('info', `game left: ${session.detection.process}`);
        session.detection = null;
        session.startedAt = 0;
        session.notes = [];
        session.snapshot = null;
        publish();
      }
      return;
    }
    if (session.detection?.hwnd !== detection.hwnd) {
      log('info', `game detected: ${detection.title || detection.process}`);
      session.startedAt = Date.now();
      session.notes = [];
      session.snapshot = null;
      session.lastSpokeAt = 0;
    }
    session.detection = detection;
    publish();

    const now = Date.now();
    if (session.busy) return;
    if (now - session.startedAt < session.settings.warmupMs) return;
    if (session.lastSpokeAt && now - session.lastSpokeAt < session.settings.minGapMs) return;
    if (session.lastSpokeAt && now - session.lastSpokeAt < session.settings.intervalSec * 1000) return;
    await runCycle({ force: false });
  }

  /** 跑一轮：截屏 → 看图 → 说话。 */
  async function runCycle({ force }) {
    if (session.busy) return { ok: false, reason: 'busy' };
    session.busy = true;
    const startedAt = Date.now();
    let shot = null;
    try {
      const detection = session.detection ?? (await detectForeground());
      if (!session.settings.enabled && !force) return { ok: false, reason: 'disabled' };
      if (!force && !isGame(detection)) return { ok: false, reason: 'not-playing' };
      if (!session.detection) {
        session.detection = detection;
        session.startedAt = Date.now();
      }

      const selection = resolveSelection(ctx, session.settings);
      if (!selection.provider || !selection.model) {
        throw new Error('没有可用的模型：当前对话没选模型，插件配置里也没写 provider/model');
      }

      let image = null;
      const fresh = !session.snapshot || Date.now() - session.snapshot.at <= session.settings.snapshotTtlMs;
      if (fresh && session.snapshot) {
        image = session.snapshot.data;
      } else {
        const hwnd = session.settings.captureFullScreen ? 0 : Number(detection.hwnd ?? 0);
        shot = await capturePng({ hwnd });
        image = shot.data;
      }

      const result = await adviseOnce({
        ctx,
        config: session.settings,
        image,
        detection,
        notes: session.notes,
        elapsedMs: Date.now() - session.startedAt,
        selection,
      });

      if (!result.ok) {
        session.lastError = { at: Date.now(), reason: result.reason, message: result.message ?? '' };
        log('warn', `advice failed: ${result.reason} ${result.message ?? ''}`);
        // 识图失败时把"候选是怎么算出来的"打一行日志：这类问题光看报错没法定位
        if (result.reason === 'vision-failed' || result.reason === 'vision-model-missing') {
          try {
            const report = await inspectVision({ ctx, config: session.settings });
            log(
              'warn',
              `vision probe: providers=${JSON.stringify(report.providers)} candidates=${JSON.stringify(report.candidates)}`,
            );
          } catch {
            // 探测再失败就算了，别让它影响主流程
          }
        }
        publish();
        return { ok: false, ...session.lastError, elapsedMs: Date.now() - startedAt };
      }

      session.lastError = null;
      if (image) session.snapshot = { at: Date.now(), data: image, screen: result.screen };
      if (result.say) {
        // 历史里同时带上"当时画面"：这样下一句能接着上一幕讲，
        // 而不是每次都从零描述（实测这样建议更贴当前局面）。
        session.notes.push(result.screen ? `[画面] ${result.screen} → [我说] ${result.say}` : result.say);
        const limit = session.settings.historyLimit;
        if (limit > 0 && session.notes.length > limit) session.notes.splice(0, session.notes.length - limit);
      }
      // 先算"上一句到现在隔了多久"，再刷新 lastSpokeAt（否则永远是 0）
      const previousSpeakAt = session.lastSpokeAt;
      const idleSeconds = previousSpeakAt ? Math.round((Date.now() - previousSpeakAt) / 1000) : 0;
      session.lastSpokeAt = Date.now();
      const mood = moodOf({ say: result.say, idleSeconds });
      session.lastAdvice = {
        at: session.lastSpokeAt,
        say: result.say,
        screen: result.screen,
        mood,
        animation: pickAnimation({ mood, seed: session.lastSpokeAt }),
        game: detection.title || detection.process || '',
      };
      publish();
      log('info', `said: ${result.say}`);
      return { ok: true, screen: result.screen, say: result.say, mood, elapsedMs: Date.now() - startedAt };
    } catch (error) {
      session.lastError = { at: Date.now(), reason: 'cycle-error', message: errorText(error) };
      log('warn', `cycle failed: ${errorText(error)}`);
      publish();
      return { ok: false, ...session.lastError };
    } finally {
      if (shot) await shot.dispose();
      session.busy = false;
    }
  }

  function isGame(detection) {
    if (!detection?.available) return false;
    if (session.settings.ignoreMinimized && detection.minimized) return false;
    if (session.settings.requireFullscreen && !detection.fullscreen) return false;
    const list = session.settings.games;
    if (!Array.isArray(list) || list.length === 0) return true;
    return list.some((pattern) => matchesGame(pattern, detection));
  }

  function publish() {
    const detection = session.detection;
    state.write('presence', {
      playing: Boolean(detection),
      game: detection ? detection.title || detection.process || '' : '',
      process: detection?.process ?? '',
      fullscreen: Boolean(detection?.fullscreen),
      playingForSec: session.startedAt ? Math.round((Date.now() - session.startedAt) / 1000) : 0,
      busy: session.busy,
      enabled: session.settings.enabled,
      intervalSec: session.settings.intervalSec,
    });
    if (session.lastAdvice) state.write('advice', session.lastAdvice);
    state.write('lastError', session.lastError);
    // 小窗据此排回落链：本地有就直接用自己的素材，不去试不存在的地址
    state.write('pet', { bundled: BUNDLED_ANIMATIONS, idle: '待机呼吸休闲' });
  }

  function reschedule() {
    // 间隔改了：重建检测定时器（checkIntervalMs 是唯一的节拍器）
    startTimer();
  }
}

/** 模型选择：插件配置优先，留空跟随"当前对话用的模型"（与 dsh-pet 同一套候选链）。 */
function resolveSelection(ctx, config) {
  if (config.provider && config.model) return { provider: config.provider, model: config.model };
  try {
    const current = typeof ctx.get === 'function' ? ctx.get('agentDefaultModel', false) : null;
    const selection = current?.currentSelection?.();
    if (selection?.provider && selection?.model) return { provider: selection.provider, model: selection.model };
  } catch {
    // 拿不到就走空，由调用方报错
  }
  return { provider: config.provider, model: config.model };
}

/** 给前端/设置页的配置视图：apiKey 永远只回"有没有"，绝不回明文。 */
function publicConfig(config) {
  return {
    ...config,
    visionApi: redactVisionApi(config.visionApi),
  };
}

/** 把用户拖出来的窗口位置落盘（失败无所谓，只是下次位置回到默认）。 */
function savePosition(settings) {
  try {
    void mkdir(path.dirname(POSITION_FILE), { recursive: true }).then(() =>
      writeFile(
        POSITION_FILE,
        JSON.stringify({ x: settings.windowX, y: settings.windowY }, null, 1),
        'utf8',
      ),
    );
  } catch {
    // 存不下不影响运行
  }
}

/** 启动时读回上次的窗口位置（同步读：置顶窗拉起时就要用，不能等异步）。 */
function readPosition() {
  try {
    const parsed = JSON.parse(readFileSync(POSITION_FILE, 'utf8'));
    const x = Number(parsed?.x);
    const y = Number(parsed?.y);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x: Math.round(x), y: Math.round(y) };
  } catch {
    // 没存过就是没有
  }
  return null;
}

/** 置顶小窗那一页（纯静态 HTML）。 */
async function sendOverlayHtml(res) {
  try {
    const html = await readFile(OVERLAY_HTML);
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': html.length,
      'cache-control': 'no-store',
    });
    res.end(html);
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`dsh-game-pet: overlay.html 读不到（${errorText(error)}）`);
  }
}

/** 播一段自带动画：文件名限制成「字母数字下划线短横 + 中文 + .webm」，杜绝路径穿越。 */
async function sendAnimation(res, name) {
  const decoded = decodeURIComponent(name);
  if (!/^[\w\u4e00-\u9fa5-]+\.webm$/.test(decoded)) {
    sendJson(res, 400, { ok: false, reason: 'bad-name' });
    return;
  }
  const file = path.join(ANIMATION_DIR, decoded);
  if (!file.startsWith(ANIMATION_DIR)) {
    sendJson(res, 400, { ok: false, reason: 'bad-name' });
    return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    res.writeHead(200, {
      'content-type': 'video/webm',
      'content-length': info.size,
      'cache-control': 'public, max-age=86400',
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('dsh-game-pet: no bundled animation');
  }
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256 * 1024) throw new Error('request body too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

function sendJson(res, status, body, headers = {}) {
  const payload = Buffer.from(JSON.stringify(body ?? null), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    ...headers,
  });
  res.end(payload);
}

function errorText(error) {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}
