// vision-api.mjs —— 自己填一个"视觉模型 API"（OpenAI / Anthropic 兼容）当识图后端。
//
// 为什么要有这条路：DSH 的模型注册表里不一定有可用的识图模型（本机就踩过：探测不到就整句都发不出去）。
// 直接填端点最省事——本地 Ollama / LM Studio、或任何 OpenAI 兼容的视觉服务都能用，
// 不用等注册表里出现。
//
// 只做两件事：把一张 PNG 发给模型要一段描述；以及"测一下通不通"。
import { readFileSync } from 'node:fs';

const DEFAULT_TIMEOUT_MS = 60000;

/** 判断用户是否填了可用的自定义 API（baseURL 与 model 必填）。 */
export function customVisionReady(api) {
  return Boolean(api && api.enabled && api.baseURL && api.model);
}

/** 给设置页看的脱敏视图：Key 只回"有没有"，绝不回明文。 */
export function redactVisionApi(api) {
  return {
    enabled: Boolean(api?.enabled),
    baseURL: api?.baseURL ?? '',
    model: api?.model ?? '',
    format: api?.format ?? 'openai',
    maxTokens: api?.maxTokens ?? 1024,
    hasApiKey: Boolean(api?.apiKey),
  };
}

function headers(api) {
  const result = { 'content-type': 'application/json' };
  if (api.format === 'anthropic') {
    result['x-api-key'] = api.apiKey;
    result['anthropic-version'] = '2023-06-01';
  } else if (api.apiKey) {
    result.authorization = `Bearer ${api.apiKey}`;
  }
  return result;
}

function joinUrl(baseURL, path) {
  const trimmed = String(baseURL).replace(/\/+$/, '');
  return `${trimmed}${path}`;
}

/** 组装请求体：同一张图 + 同一段提示词，两种协议各一份。 */
function buildBody(api, imageBase64, prompt, { stream = false, maxTokens } = {}) {
  const tokens = maxTokens ?? api.maxTokens ?? 1024;
  if (api.format === 'anthropic') {
    return {
      model: api.model,
      max_tokens: tokens,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageBase64 } },
            { type: 'text', text: prompt },
          ],
        },
      ],
    };
  }
  return {
    model: api.model,
    max_tokens: tokens,
    stream,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
          { type: 'text', text: prompt },
        ],
      },
    ],
  };
}

/** 从两种协议的响应里抠出正文。 */
function extractText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  // OpenAI 兼容
  const choice = payload.choices?.[0];
  const fromChoice = choice?.message?.content ?? choice?.delta?.content ?? choice?.text;
  if (typeof fromChoice === 'string' && fromChoice.trim()) return fromChoice.trim();
  // Anthropic
  const blocks = payload.content;
  if (Array.isArray(blocks)) {
    const text = blocks
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('')
      .trim();
    if (text) return text;
  }
  // 推理型模型可能把内容放在 reasoning / analysis 里，content 为空串（实测遇到过）
  for (const field of ['reasoning', 'reasoning_content', 'analysis', 'thinking']) {
    const value = choice?.message?.[field] ?? payload[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  if (typeof payload.response === 'string') return payload.response.trim(); // Ollama 原生
  return '';
}

/**
 * 用自定义 API 描述一张图。
 * @param {{ api: any, image: Buffer, prompt: string, timeoutMs?: number, signal?: AbortSignal }} input
 * @returns {Promise<{ ok: true, text: string } | { ok: false, message: string }>}
 */
export async function describeWithCustomApi({ api, image, prompt, timeoutMs, signal }) {
  const path = api.format === 'anthropic' ? '/v1/messages' : '/chat/completions';
  const url = joinUrl(api.baseURL, path);
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const body = buildBody(api, image.toString('base64'), prompt);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: headers(api),
      body: JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(timeout),
    });
    const raw = await response.text();
    if (!response.ok) {
      return { ok: false, message: `HTTP ${response.status}：${raw.slice(0, 200)}` };
    }
    let payload = null;
    try {
      payload = JSON.parse(raw);
    } catch {
      // 非 JSON 就当纯文本（有些本地服务直接回文本）
      return raw.trim() ? { ok: true, text: raw.trim() } : { ok: false, message: '响应是空的' };
    }
    const text = extractText(payload);
    if (!text) return { ok: false, message: `响应里没有正文：${raw.slice(0, 200)}` };
    return { ok: true, text };
  } catch (error) {
    const message = error?.name === 'TimeoutError' ? `超时（${timeout}ms）` : String(error?.message ?? error);
    return { ok: false, message };
  }
}

/**
 * 纯文本对话（出话那一步走同一条自定义 API）。
 * 和识图共用一套端点/Key/协议，只是不带图——这样"一个 Key 全包"，不依赖 DSH 会话里的模型。
 * @param {{ api: any, system: string, prompt: string, timeoutMs?: number, maxTokens?: number }} input
 * @returns {Promise<{ ok: true, text: string } | { ok: false, message: string }>}
 */
export async function chatWithCustomApi({ api, system, prompt, timeoutMs, maxTokens }) {
  const path = api.format === 'anthropic' ? '/v1/messages' : '/chat/completions';
  const url = joinUrl(api.baseURL, path);
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const tokens = maxTokens ?? api.maxTokens ?? 1024;

  const body =
    api.format === 'anthropic'
      ? {
          model: api.model,
          max_tokens: tokens,
          system,
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        }
      : {
          model: api.model,
          max_tokens: tokens,
          stream: false,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
        };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: headers(api),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    const raw = await response.text();
    if (!response.ok) return { ok: false, message: `HTTP ${response.status}：${raw.slice(0, 200)}` };
    let payload = null;
    try {
      payload = JSON.parse(raw);
    } catch {
      return raw.trim() ? { ok: true, text: raw.trim() } : { ok: false, message: '响应是空的' };
    }
    const text = extractText(payload);
    if (!text) return { ok: false, message: `响应里没有正文：${raw.slice(0, 200)}` };
    return { ok: true, text };
  } catch (error) {
    const message = error?.name === 'TimeoutError' ? `超时（${timeout}ms）` : String(error?.message ?? error);
    return { ok: false, message };
  }
}

/**
 * 连通性自检：先发一张 32×32 的测试图真看一眼（成本≈0）。
 * 为什么不是 1×1：有些视觉后端读不了 1×1 的 PNG（实测 OVH 匿名端点直接 400
 * "broken data stream"），那会把"其实能用的服务"误判成不通，所以用一张正常的小图。
 * 服务不认图就退化成纯文本 ping，至少能确认端点与鉴权是对的。
 * @param {{ api: any, timeoutMs?: number }} input
 */
export async function testCustomApi({ api, timeoutMs = 20000 }) {
  if (!api?.baseURL) return { ok: false, message: '还没填接口地址' };
  if (!api?.model) return { ok: false, message: '还没填模型名' };

  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAACESURBVFhH7dFBCsAgDETRHsz7n6J3SclCkPKjpi1oYRZv6eSDx1mKraQABSggHWB2DNG7SCqAjkXoPZkKoAOzaK+1fwCNZtFu1Q2gsado3ylg3wAaeYNuOH2BAroBjsayaLcaBjganUV7rX8EVHQgQu9JKsDRsTt6F0kHfE0BClgcUOwCO5sXy45ZFqUAAAAASUVORK5CYII=',
    'base64',
  );
  const withImage = await describeWithCustomApi({
    api,
    image: pixel,
    prompt: '这是一张 1×1 的测试图片。用一个词回答你看到了什么即可。',
    timeoutMs,
  });
  if (withImage.ok) return { ok: true, mode: 'image', text: withImage.text };

  // 退化：只测端点与鉴权（不带图）
  const path = api.format === 'anthropic' ? '/v1/messages' : '/chat/completions';
  try {
    const response = await fetch(joinUrl(api.baseURL, path), {
      method: 'POST',
      headers: headers(api),
      body: JSON.stringify(
        api.format === 'anthropic'
          ? { model: api.model, max_tokens: 16, messages: [{ role: 'user', content: 'ping' }] }
          : { model: api.model, max_tokens: 16, messages: [{ role: 'user', content: 'ping' }] },
      ),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const raw = await response.text();
    if (response.ok) {
      return {
        ok: true,
        mode: 'text-only',
        text: `端点与鉴权可用，但带图请求失败：${withImage.message}`,
      };
    }
    return { ok: false, message: `带图失败：${withImage.message}；纯文本也失败：HTTP ${response.status} ${raw.slice(0, 160)}` };
  } catch (error) {
    return { ok: false, message: `带图失败：${withImage.message}；纯文本失败：${String(error?.message ?? error)}` };
  }
}

/** 读一个本地图片文件做"真拿一张图测"（设置页那条路留用）。 */
export function readImageFile(file) {
  try {
    return readFileSync(file);
  } catch {
    return null;
  }
}
