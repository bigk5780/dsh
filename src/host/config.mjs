// config.mjs —— 插件配置的形状、默认值与容错归一化。
//
// 配置活在 cordis.patch.yml 的 row config 里（用户那份 patch 层在升级后依然保留），
// 所以这里只做「缺省回落 + 类型纠偏」，绝不因为一个字段写错就让插件装不上。

export const DEFAULTS = {
  /** 总开关：关掉就不探窗口、不截屏、不调模型 */
  enabled: true,
  /** 游戏白名单：进程名（可带/不带 .exe，大小写不敏感）或窗口标题关键字。
   *  空数组 = 任何前台窗口都算（连看视频也会跟你唠，慎用）。 */
  games: [],
  /** 全屏游戏才发言？false = 窗口化 / 无边框也算 */
  requireFullscreen: false,
  /** 前台窗口最小化的（比如切回桌面）不算在玩游戏 */
  ignoreMinimized: true,
  /** 多久看一眼游戏（毫秒）——检测很便宜（一次 PowerShell 调用），默认 5 秒 */
  checkIntervalMs: 5000,
  /** 多久说一句话（毫秒），默认 45 秒。这就是"自动"的节奏，也是花钱的节奏 */
  intervalSec: 45,
  /** 一段话最少持续多久才允许下一句（毫秒） */
  minGapMs: 8000,
  /** 一段时间不说话（毫秒）之后，下次开口先重新"看"一眼画面。
   *  默认 0 = 每句都重新截屏看图（最准也最贵）。 */
  snapshotTtlMs: 0,
  /** 单次生成超时（毫秒） */
  timeoutMs: 45000,
  /** 截整屏（false = 只截游戏窗口，画面更干净、token 更省） */
  captureFullScreen: false,
  /** 最多回传多少张截图当"最近画面"上下文（0 = 不回溯） */
  historyLimit: 6,
  /** 看图/出主意用的模型；留空 = 跟随当前对话用的模型 */
  provider: '',
  model: '',
  /** 识图那一步用的模型（把截图转成文字描述）。留空 = 自动探测：先试 dsh-vision-router 的
   *  直连视觉路由 vision-http，再找注册表里声明支持图片输入的模型。
   *  ⚠️ 别填 `deepseek-vision` 这类"自动识图包装"：那类包装是靠让模型发起识图工具调用来工作的，
   *  插件直接把图塞给它，模型会把工具调用标记当正文吐出来（气泡里就出现"代码"）。 */
  visionProvider: '',
  visionModel: '',
  /** 自己填一个视觉模型 API（OpenAI / Anthropic 兼容）当识图后端。
   *  填了且 enabled 就**排在最前面**用，探测不到注册表模型时这是唯一的出路。
   *  apiKey 以明文存在 $DSH_HOME/dsh-game-pet.json（本机文件），界面只回"有没有"。 */
  visionApi: {
    enabled: false,
    baseURL: '',
    model: '',
    apiKey: '',
    /** 'openai' = POST <base>/chat/completions；'anthropic' = POST <base>/v1/messages */
    format: 'openai',
    maxTokens: 1024,
  },
  /** 浮层形态：'window' = 独立透明置顶小窗（能盖在别的应用上层、可拖动）；'browser' = 只画在 DSH 网页里 */
  overlay: 'window',
  /** 置顶小窗位置（虚拟屏坐标，左上角）；null = 自动放在主屏右下角 */
  windowX: null,
  windowY: null,
  /** 人设：决定它怎么说话 */
  persona: '',
  /** 已经玩多久之后才开口（毫秒）——刚开游戏别急着插嘴 */
  warmupMs: 15000,
};

/** 把 row config 归一化：类型不对就回落默认值，不抛错。 */
export function normalizeConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const config = { ...DEFAULTS };

  config.enabled = boolean(source.enabled, DEFAULTS.enabled);
  config.requireFullscreen = boolean(source.requireFullscreen, DEFAULTS.requireFullscreen);
  config.ignoreMinimized = boolean(source.ignoreMinimized, DEFAULTS.ignoreMinimized);
  config.captureFullScreen = boolean(source.captureFullScreen, DEFAULTS.captureFullScreen);

  config.games = Array.isArray(source.games)
    ? source.games.filter((item) => typeof item === 'string' && item.trim() !== '').map((item) => item.trim())
    : DEFAULTS.games;

  config.checkIntervalMs = clampNumber(source.checkIntervalMs, DEFAULTS.checkIntervalMs, 1000, 120000);
  config.intervalSec = clampNumber(source.intervalSec, DEFAULTS.intervalSec, 5, 3600);
  config.minGapMs = clampNumber(source.minGapMs, DEFAULTS.minGapMs, 0, 600000);
  config.snapshotTtlMs = clampNumber(source.snapshotTtlMs, DEFAULTS.snapshotTtlMs, 0, 3600000);
  config.timeoutMs = clampNumber(source.timeoutMs, DEFAULTS.timeoutMs, 5000, 180000);
  config.historyLimit = clampNumber(source.historyLimit, DEFAULTS.historyLimit, 0, 50);
  config.warmupMs = clampNumber(source.warmupMs, DEFAULTS.warmupMs, 0, 600000);

  config.provider = typeof source.provider === 'string' ? source.provider.trim() : DEFAULTS.provider;
  config.model = typeof source.model === 'string' ? source.model.trim() : DEFAULTS.model;
  config.visionProvider = typeof source.visionProvider === 'string' ? source.visionProvider.trim() : DEFAULTS.visionProvider;
  config.visionModel = typeof source.visionModel === 'string' ? source.visionModel.trim() : DEFAULTS.visionModel;
  config.visionApi = normalizeVisionApi(source.visionApi, DEFAULTS.visionApi);
  config.overlay = source.overlay === 'browser' ? 'browser' : source.overlay === 'window' ? 'window' : DEFAULTS.overlay;
  config.windowX = optionalNumber(source.windowX, DEFAULTS.windowX);
  config.windowY = optionalNumber(source.windowY, DEFAULTS.windowY);
  config.persona = typeof source.persona === 'string' && source.persona.trim() !== '' ? source.persona.trim() : DEFAULTS.persona;

  return config;
}

/**
 * 白名单匹配：进程名（去掉 .exe、大小写不敏感）或窗口标题包含关键字即命中。
 * 空白名单 = 全部命中（由调用方决定要不要这么用）。
 */
export function matchesGame(pattern, detection) {
  if (!pattern) return true;
  const needle = pattern.toLowerCase().replace(/\.exe$/, '');
  const process = String(detection.process ?? '')
    .toLowerCase()
    .replace(/\.exe$/, '');
  const title = String(detection.title ?? '').toLowerCase();
  const cls = String(detection.class ?? '').toLowerCase();
  return process === needle || process.includes(needle) || title.includes(needle) || cls.includes(needle);
}

function boolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

/** apiKey 的哨兵值：设置页不改 Key 时回传它，表示"沿用已存的"。 */
export const KEEP_API_KEY = '__KEEP__';

function normalizeVisionApi(raw, fallback) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const apiKey = typeof source.apiKey === 'string' && source.apiKey !== KEEP_API_KEY ? source.apiKey.trim() : '';
  return {
    enabled: boolean(source.enabled, fallback.enabled),
    baseURL: typeof source.baseURL === 'string' ? source.baseURL.trim().replace(/\/+$/, '') : fallback.baseURL,
    model: typeof source.model === 'string' ? source.model.trim() : fallback.model,
    apiKey,
    format: source.format === 'anthropic' ? 'anthropic' : 'openai',
    maxTokens: clampNumber(source.maxTokens, fallback.maxTokens, 64, 32768),
  };
}

/** 可缺省的数字（窗口位置这类）：非数字一律当"没设置"。 */
function optionalNumber(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

function clampNumber(value, fallback, min, max) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}
