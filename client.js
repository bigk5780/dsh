// client.js —— 浏览器半侧的桌宠 HUD（复用 dsh-pet 的动画素材与气泡外观）。
//
// 契约（见 DSH client-modules）：加载时注册一个惰性 factory，factory 返回插件三件套；
// react 由模块表提供，不打包。所有副作用（样式/定时器/监听）都进 ctx.effect，卸载即回收。
window.__ModuleLoader__.load({
  id: 'dsh-game-pet',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useEffect, useRef, useState } = React;

    const NS = 'dsh-game-pet';
    const ROUTE = '/dsh-game-pet-7341';
    /** 桌宠动画素材复用 dsh-pet 包里的 webm（插件自带则优先用自己的）。 */
    const PET_ROUTE = '/dsh-pet-7340';
    /** 没有 dsh-pet 时的兜底素材名（放包内 assets/webm/ 即可生效）。 */
    const FALLBACK_SAY = '说';
    const NOT_PLAYING_POLL_MS = 3000;
    /** 台词在屏幕上停留多久 */
    const BUBBLE_MS = 14000;

    const CSS = `
.${NS}-root{position:fixed;left:22px;bottom:22px;z-index:39;width:230px;display:flex;flex-direction:column;
  align-items:flex-start;gap:8px;pointer-events:none;transition:opacity .35s ease;}
.${NS}-root[data-visible="0"]{opacity:0;}
.${NS}-pet{position:relative;width:100%;}
.${NS}-pet video{display:block;width:100%;height:auto;filter:drop-shadow(0 6px 12px rgba(0,0,0,.28));}
.${NS}-fallback{width:100%;aspect-ratio:16/9;border-radius:12px;background:var(--dsw-alias-bg-secondary,rgba(0,0,0,.35));}
.${NS}-chip{display:inline-flex;align-items:center;gap:6px;font-size:11px;line-height:1;
  padding:5px 9px;border-radius:999px;background:var(--dsw-alias-bg-secondary,rgba(0,0,0,.45));
  color:var(--dsw-alias-text-secondary,#ddd);backdrop-filter:blur(6px);}
.${NS}-bubble{position:relative;max-width:100%;box-sizing:border-box;padding:11px 13px;border-radius:14px;
  background:var(--dsw-alias-bg-elevated,rgba(255,255,255,.96));color:var(--dsw-alias-text-primary,#1c1c1e);
  font-size:13.5px;line-height:1.5;box-shadow:0 8px 22px rgba(0,0,0,.22);transition:opacity .25s ease,transform .25s ease;}
.${NS}-bubble[data-on="0"]{opacity:0;transform:translateY(6px);}
.${NS}-bubble::after{content:'';position:absolute;left:26px;bottom:-7px;width:14px;height:14px;
  background:inherit;transform:rotate(45deg);border-radius:3px;}
.${NS}-say{word-break:break-word;}
.${NS}-screen{margin-top:6px;font-size:11px;color:var(--dsw-alias-text-secondary,#6b6b70);word-break:break-word;}
.${NS}-err{margin-top:6px;font-size:11px;color:var(--dsw-alias-text-danger,#c0392b);word-break:break-word;}

/* ── 设置页（settings.section）────────────────────────────────────────── */
.${NS}-cfg{max-width:720px;display:flex;flex-direction:column;gap:14px;
  color:var(--dsw-alias-text-primary,#1c1c1e);font-size:13px;}
.${NS}-cfg__note{font-size:12px;line-height:1.6;color:var(--dsw-alias-text-secondary,#6b6b70);
  background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.08));padding:9px 11px;border-radius:9px;}
.${NS}-card{border:1px solid var(--dsw-alias-border-secondary,rgba(127,127,127,.22));border-radius:11px;
  padding:12px 14px;display:flex;flex-direction:column;gap:11px;}
.${NS}-card__title{font-size:13px;font-weight:600;margin:0;}
.${NS}-row{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;}
.${NS}-row__label{width:132px;flex:0 0 auto;padding-top:5px;color:var(--dsw-alias-text-secondary,#6b6b70);}
.${NS}-row__body{flex:1 1 260px;min-width:220px;display:flex;flex-direction:column;gap:5px;}
.${NS}-hint{font-size:11.5px;line-height:1.55;color:var(--dsw-alias-text-secondary,#8a8a90);}
.${NS}-cfg input[type="text"],.${NS}-cfg input[type="number"],.${NS}-cfg select,.${NS}-cfg textarea{
  width:100%;box-sizing:border-box;padding:7px 9px;border-radius:8px;font-size:13px;
  background:var(--dsw-alias-bg-primary,rgba(255,255,255,.06));
  color:var(--dsw-alias-text-primary,#1c1c1e);
  border:1px solid var(--dsw-alias-border-primary,rgba(127,127,127,.35));outline:none;font-family:inherit;}
.${NS}-cfg textarea{min-height:64px;resize:vertical;line-height:1.5;}
.${NS}-cfg input:focus,.${NS}-cfg select:focus,.${NS}-cfg textarea:focus{
  border-color:var(--dsw-alias-brand-primary,#247bbf);}
.${NS}-switch{display:inline-flex;align-items:center;gap:8px;cursor:pointer;}
.${NS}-switch input{width:16px;height:16px;accent-color:var(--dsw-alias-brand-primary,#247bbf);}
.${NS}-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.${NS}-btn{padding:7px 14px;border-radius:8px;font-size:13px;cursor:pointer;font-family:inherit;
  border:1px solid var(--dsw-alias-border-primary,rgba(127,127,127,.35));
  background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.1));
  color:var(--dsw-alias-text-primary,#1c1c1e);}
.${NS}-btn:hover{border-color:var(--dsw-alias-brand-primary,#247bbf);}
.${NS}-btn[disabled]{opacity:.5;cursor:default;}
.${NS}-btn--primary{background:var(--dsw-alias-brand-primary,#247bbf);border-color:transparent;color:#fff;}
.${NS}-pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11.5px;
  background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.12));
  color:var(--dsw-alias-text-secondary,#6b6b70);}
.${NS}-pill--ok{background:rgba(46,160,67,.16);color:#2ea043;}
.${NS}-pill--bad{background:rgba(207,68,68,.16);color:#cf4444;}
.${NS}-out{font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word;
  background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.08));padding:9px 11px;border-radius:9px;
  max-height:190px;overflow:auto;}
.${NS}-mono{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;}
.${NS}-list{margin:0;padding-left:18px;font-size:12px;line-height:1.6;}
`;

    function installStyles() {
      const existing = document.querySelector(`style[data-plugin-css="${NS}"]`);
      if (existing) return () => {};
      const style = document.createElement('style');
      style.dataset.pluginCss = NS;
      style.textContent = CSS;
      document.head.appendChild(style);
      return () => style.remove();
    }

    function Companion() {
      // 一片状态装全部展示数据（frame = 游戏在不在，bubble = 这次要说的话）。
      // 合成一片是为了只有一个状态槽：这个组件要能被单独测，多片状态让"渲染时到底拿到什么"说不清。
      const [ui, setUi] = useState({ frame: null, bubble: null });
      const frame = ui.frame;
      const bubble = ui.bubble;
      const baseline = useRef(null);
      const timer = useRef(null);

      // 轮询 /state：counter 变了才处理（与 dsh-pet 同一套协议，前端不需要长连接）
      useEffect(() => {
        let disposed = false;
        let handle = null;
        const poll = async () => {
          let payload = null;
          try {
            const response = await fetch(`${ROUTE}/state`, { cache: 'no-store' });
            if (response.ok) payload = await response.json();
          } catch {
            payload = null;
          }
          if (disposed) return;
          const playing = Boolean(payload?.sections?.presence?.data?.playing);
          handle = window.setTimeout(poll, playing ? 1000 : NOT_PLAYING_POLL_MS);

          if (!payload?.sections) {
            setUi((previous) =>
              previous.frame?.playing ? { ...previous, frame: { ...previous.frame, playing: false } } : previous,
            );
            return;
          }
          if (baseline.current === null) {
            baseline.current = flattenCounters(payload);
            apply(payload);
            return;
          }
          if (!hasChanged(payload, baseline.current)) return;
          baseline.current = flattenCounters(payload);
          apply(payload);
        };

        const apply = (payload) => {
          const presence = payload.sections.presence?.data ?? { playing: false };
          const advice = payload.sections.advice;
          const lastError = payload.sections.lastError?.data;
          const counter = advice?.counter ?? 0;
          let bubble = null;
          if (advice && counter > 0 && advice.data?.say) {
            bubble = { ...advice.data, error: null, counter };
          } else if (lastError && !lastError.ok && lastError.message) {
            bubble = { say: '', screen: '', error: lastError.message, counter: lastError.at ?? Date.now() };
          }
          setUi((previous) => ({ frame: presence, bubble: bubble ?? previous.bubble }));
          if (bubble) {
            if (timer.current) window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => setUi((previous) => ({ ...previous, bubble: null })), BUBBLE_MS);
          }
        };

        void poll();
        return () => {
          disposed = true;
          if (handle) window.clearTimeout(handle);
          if (timer.current) window.clearTimeout(timer.current);
        };
      }, []);

      const playing = Boolean(frame?.playing);
      // 有话说、或者出错了要报——两者都算"该露脸"（只报错不出声时也得让人看见）
      const visible = playing || Boolean(bubble?.say) || Boolean(bubble?.error);
      const animation = bubble?.animation || '待机呼吸休闲';

      return h(
        'div',
        { className: `${NS}-root`, 'data-visible': visible ? '1' : '0', 'aria-live': 'polite' },
        h(
          'div',
          { className: `${NS}-bubble`, 'data-on': bubble?.say || bubble?.error ? '1' : '0' },
          h('div', { className: `${NS}-say` }, bubble?.say ?? ''),
          // 失败原因单独一行、小字（原文照说，不加"没看成"这种前缀；画面描述不进气泡）
          bubble?.error ? h('div', { className: `${NS}-err` }, bubble.error) : null,
        ),
        // 徽章只说游戏名；没在玩就整块不显示（不写"桌宠参谋：待机"这类招牌字）
        playing ? h('div', { className: `${NS}-chip` }, frame?.game || frame?.process || '') : null,
        h(PetSprite, { animation }),
      );
    }

    /**
     * 用一张 <video> 播透明 webm。素材三级回落：本插件自带 assets/webm/<名>.webm
     * → dsh-pet 的 /thumb/main/<名>.webm（复用桌宠素材，默认走这条）
     * → 都没有就画一块占位（气泡照常说话）。
     */
    function PetSprite({ animation }) {
      const sources = [
        `${ROUTE}/anim/${encodeURIComponent(animation)}.webm`,
        `${PET_ROUTE}/thumb/main/${encodeURIComponent(animation)}.webm`,
        `${PET_ROUTE}/thumb/main/${encodeURIComponent(FALLBACK_SAY)}.webm`,
      ];
      const [index, setIndex] = useState(0);
      useEffect(() => {
        setIndex(0);
      }, [animation]);
      if (index >= sources.length) return h('div', { className: `${NS}-fallback`, 'aria-hidden': true });
      const url = sources[index];
      return h(
        'div',
        { className: `${NS}-pet` },
        h('video', {
          key: url,
          src: url,
          autoPlay: true,
          loop: true,
          muted: true,
          playsInline: true,
          onError: () => setIndex((current) => current + 1),
          'aria-hidden': true,
        }),
      );
    }

    function flattenCounters(payload) {
      const flat = {};
      for (const [key, entry] of Object.entries(payload.sections ?? {})) {
        flat[key] = entry?.counter ?? 0;
      }
      return flat;
    }

    function hasChanged(payload, baseline) {
      for (const [key, entry] of Object.entries(payload.sections ?? {})) {
        if ((entry?.counter ?? 0) !== (baseline[key] ?? 0)) return true;
      }
      return false;
    }

    function truncate(text, max) {
      const value = String(text ?? '');
      return value.length > max ? `${value.slice(0, max - 1)}…` : value;
    }

    /**
     * 设置页「桌宠参谋」：所有可视化配置 + 自检。
     * 数据流：GET /config 拿生效值 → 改动就地 POST /config（宿主立即生效并落盘）→
     * 回读宿主归一化后的值，保证界面显示的永远是"真正在跑的那份"。
     */
    function SettingsSection() {
      const [config, setConfig] = useState(null);
      const [vision, setVision] = useState(null);
      const [error, setError] = useState(null);
      const [note, setNote] = useState(null);
      const [busy, setBusy] = useState(null);
      const [output, setOutput] = useState('');
      /** 视觉 API 的 Key 草稿：宿主从不回明文，所以这里只存用户这次输入的 */
      const [keyDraft, setKeyDraft] = useState('');
      /** 最近一次保存的结果：明晃晃挂在页面顶部，避免"以为存了其实没存" */
      const [saveState, setSaveState] = useState(null);
      const saveTimer = useRef(null);

      const load = async () => {
        try {
          const response = await fetch(`${ROUTE}/config`, { cache: 'no-store' });
          const payload = await response.json();
          if (!payload?.ok) throw new Error(payload?.message ?? '读取配置失败');
          setConfig(payload.config);
          setError(null);
        } catch (cause) {
          setError(String(cause?.message ?? cause));
        }
      };
      const loadVision = async () => {
        try {
          const response = await fetch(`${ROUTE}/vision`, { cache: 'no-store' });
          setVision(await response.json());
        } catch (cause) {
          setVision({ available: false, reason: String(cause?.message ?? cause) });
        }
      };

      useEffect(() => {
        void load();
        void loadVision();
        return () => {
          if (saveTimer.current) window.clearTimeout(saveTimer.current);
        };
      }, []);

      /** 本地先改（输入跟手），再节流落盘；返回宿主归一化后的值覆盖本地。 */
      const patch = (changes, { immediate = false, quiet = false } = {}) => {
        setConfig((previous) => ({ ...(previous ?? {}), ...changes }));
        const send = async () => {
          setBusy('save');
          setSaveState({ kind: 'saving', text: '保存中…' });
          try {
            const response = await fetch(`${ROUTE}/config`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(changes),
            });
            const payload = await response.json();
            if (!payload?.ok) throw new Error(payload?.message ?? '保存失败');
            setConfig(payload.config);
            setNote(
              payload.persisted
                ? '已保存并写入 config.json（重启后仍生效）'
                : '已生效，但写盘失败（重启后会丢）',
            );
            setSaveState(
              payload.persisted
                ? { kind: 'ok', text: `已保存 ${new Date().toLocaleTimeString()}（已写盘，重启后仍在）` }
                : { kind: 'warn', text: '已生效，但写盘失败：重启后会丢，请检查插件日志' },
            );
            setError(null);
          } catch (cause) {
            const text = String(cause?.message ?? cause);
            setError(text);
            setSaveState({ kind: 'bad', text: `保存失败：${text}` });
          } finally {
            setBusy(null);
          }
        };
        if (immediate) {
          if (saveTimer.current) window.clearTimeout(saveTimer.current);
          void send();
        } else if (!quiet) {
          if (saveTimer.current) window.clearTimeout(saveTimer.current);
          saveTimer.current = window.setTimeout(() => void send(), 450);
        }
      };

      const runNow = async () => {
        setBusy('once');
        setOutput('正在跑一轮（截屏 → 识图 → 出话）…');
        try {
          const response = await fetch(`${ROUTE}/once`, { method: 'POST' });
          const payload = await response.json();
          setOutput(
            payload.ok
              ? `成功\n看到：${payload.screen || '(无描述)'}\n台词：${payload.say}\n耗时 ${payload.elapsedMs} ms`
              : `失败（${payload.reason}）\n${payload.message ?? ''}\n耗时 ${payload.elapsedMs ?? '?'} ms`,
          );
        } catch (cause) {
          setOutput(`请求失败：${String(cause?.message ?? cause)}`);
        } finally {
          setBusy(null);
          void loadVision();
        }
      };

      const probeNow = async () => {
        setBusy('probe');
        try {
          const response = await fetch(`${ROUTE}/probe`, { cache: 'no-store' });
          const payload = await response.json();
          const detection = payload.detection ?? {};
          setOutput(
            detection.available
              ? `前台窗口：${detection.title || '(无标题)'}\n进程：${detection.process}\n全屏：${
                  detection.fullscreen ? '是' : '否'
                }\n本插件是否算作"在玩游戏"：${payload.matched ? '是' : '否（白名单没命中或要求全屏）'}`
              : `读不到前台窗口：${detection.error ?? '未知原因'}`,
          );
        } catch (cause) {
          setOutput(`请求失败：${String(cause?.message ?? cause)}`);
        } finally {
          setBusy(null);
        }
      };

      const field = (label, body, hint) =>
        h(
          'div',
          { className: `${NS}-row` },
          h('div', { className: `${NS}-row__label` }, label),
          h('div', { className: `${NS}-row__body` }, body, hint ? h('div', { className: `${NS}-hint` }, hint) : null),
        );

      const toggle = (key, label) =>
        h(
          'label',
          { className: `${NS}-switch` },
          h('input', {
            type: 'checkbox',
            checked: Boolean(config?.[key]),
            onChange: (event) => patch({ [key]: event.currentTarget.checked }, { immediate: true }),
          }),
          h('span', null, label),
        );

      const number = (key, min, max, step = 1) =>
        h('input', {
          type: 'number',
          min,
          max,
          step,
          value: config?.[key] ?? '',
          onChange: (event) => {
            const value = Number(event.currentTarget.value);
            if (Number.isFinite(value)) patch({ [key]: value });
          },
        });

      const text = (key, placeholder) =>
        h('input', {
          type: 'text',
          value: config?.[key] ?? '',
          placeholder,
          onChange: (event) => patch({ [key]: event.currentTarget.value }),
        });

      if (error && !config) {
        return h(
          'div',
          { className: `${NS}-cfg` },
          h('div', { className: `${NS}-out` }, `读不到插件配置：${error}\n（插件可能没挂上，或宿主还没重启）`),
        );
      }
      if (!config) {
        return h('div', { className: `${NS}-cfg` }, h('div', { className: `${NS}-hint` }, '正在读取桌宠参谋配置…'));
      }

      const visionPills = (vision?.candidates ?? []).map((candidate) =>
        h('span', { key: `${candidate.provider}/${candidate.model}`, className: `${NS}-pill` }, `${candidate.provider}/${candidate.model}`),
      );
      const visionApi = config.visionApi ?? {};
      const apiReady = Boolean(visionApi.enabled && visionApi.baseURL && visionApi.model);
      const patchVisionApi = (changes, options) => patch({ visionApi: { ...visionApi, ...changes } }, options);
      const alreadyHasKey = Boolean(vision?.customApi?.hasApiKey);

      /** 改 apiKey：留空表示沿用已存的（哨兵值），绝不把明文回填到输入框。 */
      const keyInput = h('input', {
        type: 'password',
        autoComplete: 'off',
        value: keyDraft,
        placeholder: alreadyHasKey ? '已保存（留空 = 不改；想清除就输入一个空格）' : '留空 = 不带鉴权（本地服务一般不用）',
        onChange: (event) => {
          const value = event.currentTarget.value;
          setKeyDraft(value);
          patchVisionApi({ apiKey: value === '' ? '__KEEP__' : value.trim() });
        },
      });

      const testApi = async () => {
        setBusy('vision-test');
        setOutput('正在测这个视觉 API（先发一张 1×1 的图，不行再退回纯文本 ping）…');
        try {
          const response = await fetch(`${ROUTE}/vision/test`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...visionApi, apiKey: keyDraft === '' ? '__KEEP__' : keyDraft.trim() }),
          });
          const payload = await response.json();
          setOutput(
            payload.ok
              ? `✅ 通了（${payload.mode === 'image' ? '带图请求成功' : '仅纯文本可用'}）\n模型回答：${payload.text}`
              : `❌ 不通\n${payload.message}`,
          );
        } catch (cause) {
          setOutput(`请求失败：${String(cause?.message ?? cause)}`);
        } finally {
          setBusy(null);
        }
      };

      return h(
        'div',
        { className: `${NS}-cfg` },
        h(
          'div',
          { className: `${NS}-note` },
          '打游戏时自动开口的桌宠参谋。下面改动会自动保存（写进 config.json，重启后仍在）；',
          '只有「浮层形态」和小窗位置要重启桌面应用才换得过来。想看它现在会说什么，点「立刻试一轮」。',
        ),

        // 保存结果明晃晃放在最上面：避免"以为存了其实没存"
        saveState
          ? h(
              'div',
              {
                className: `${NS}-out`,
                style:
                  saveState.kind === 'ok'
                    ? { color: '#2ea043' }
                    : saveState.kind === 'bad'
                      ? { color: '#cf4444' }
                      : saveState.kind === 'warn'
                        ? { color: '#d29922' }
                        : undefined,
              },
              saveState.text,
            )
          : null,

        h(
          'div',
          { className: `${NS}-card` },
          h('h3', { className: `${NS}-card__title` }, '开关与时机'),
          field('启用', toggle('enabled', '在玩游戏时自动开口')),
          field(
            '多久说一句',
            number('intervalSec', 5, 3600),
            '秒。这是说话的节奏，也是花钱的节奏（每句 = 1 次识图 + 1 次出话）。',
          ),
          field('开场预热', number('warmupMs', 0, 600000, 1000), '毫秒。刚开游戏先看一会儿再开口，默认 15000。'),
          field('最短间隔', number('minGapMs', 0, 600000, 500), '毫秒。两句话之间至少隔这么久。'),
          field('检测频率', number('checkIntervalMs', 1000, 120000, 500), '毫秒。多久探一次前台窗口（很便宜）。'),
          field('单次超时', number('timeoutMs', 5000, 180000, 1000), '毫秒。一次生成最多等多久。'),
        ),

        h(
          'div',
          { className: `${NS}-card` },
          h('h3', { className: `${NS}-card__title` }, '哪些游戏算'),
          field(
            '白名单',
            h('textarea', {
              value: (config.games ?? []).join('\n'),
              placeholder: '一行一个，进程名或窗口标题关键字\n例如：\nTerraria\nEldenRing\n原神',
              onChange: (event) =>
                patch({
                  games: event.currentTarget.value
                    .split('\n')
                    .map((line) => line.trim())
                    .filter(Boolean),
                }),
            }),
            '留空 = 任何前台窗口都算（看视频写文档也会跟你唠）。填了就只认命中的。',
          ),
          field('全屏才算', toggle('requireFullscreen', '只有全屏游戏才开口')),
          field('忽略最小化', toggle('ignoreMinimized', '窗口最小化时不算在玩')),
          field('截图范围', toggle('captureFullScreen', '截整个屏幕（默认只截游戏窗口）')),
        ),

        h(
          'div',
          { className: `${NS}-card` },
          h('h3', { className: `${NS}-card__title` }, '浮层（它住在哪儿）'),
          field(
            '形态',
            h(
              'select',
              {
                value: config.overlay ?? 'window',
                onChange: (event) => patch({ overlay: event.currentTarget.value }, { immediate: true }),
              },
              h('option', { value: 'window' }, '独立透明置顶小窗（可拖动，能盖在别的应用上）'),
              h('option', { value: 'browser' }, '只画在 DSH 网页里'),
            ),
            '改这一项要重启桌面应用才换得过来。',
          ),
          field(
            '小窗位置 X',
            h('input', {
              type: 'number',
              value: config.windowX ?? '',
              placeholder: '留空 = 自动右下角',
              onChange: (event) => {
                const raw = event.currentTarget.value;
                patch({ windowX: raw === '' ? null : Number(raw) });
              },
            }),
            '直接拖小窗会更省事，拖完自动记住。',
          ),
          field(
            '小窗位置 Y',
            h('input', {
              type: 'number',
              value: config.windowY ?? '',
              placeholder: '留空 = 自动右下角',
              onChange: (event) => {
                const raw = event.currentTarget.value;
                patch({ windowY: raw === '' ? null : Number(raw) });
              },
            }),
          ),
        ),

        h(
          'div',
          { className: `${NS}-card` },
          h('h3', { className: `${NS}-card__title` }, '模型'),
          field('出话模型 provider', text('provider', '留空 = 跟随当前对话'), '两项都填或都留空。'),
          field('出话模型 model', text('model', '例如 deepseek-flash')),
          field(
            '识图模型 provider',
            text('visionProvider', '留空 = 自动探测'),
            '留空时先试 dsh-vision-router 的直连视觉路由 vision-http，再找注册表里声明支持图片的模型。',
          ),
          field('识图模型 model', text('visionModel', '例如 ovh/Qwen3.5-397B-A17B')),
          h(
            'div',
            { className: `${NS}-row` },
            h('div', { className: `${NS}-row__label` }, '识图状态'),
            h(
              'div',
              { className: `${NS}-row__body` },
              h(
                'div',
                null,
                vision?.available
                  ? h('span', { className: `${NS}-pill ${NS}-pill--ok` }, '可用')
                  : h('span', { className: `${NS}-pill ${NS}-pill--bad` }, '不可用'),
                ' ',
                h('span', { className: `${NS}-hint` }, `注册的 provider：${(vision?.providers ?? []).join('、') || '（探测不到）'}`),
              ),
              visionPills.length
                ? h('ul', { className: `${NS}-list` }, visionPills.map((pill, index) => h('li', { key: index }, pill)))
                : h(
                    'div',
                    { className: `${NS}-hint` },
                    'DSH 的模型注册表里探测不到支持图片的模型（这台机器就是这样）。',
                    '插件会退到免费的匿名视觉模型兜底；想要更稳更快，在下面「视觉模型 API」里填一个自己的识图服务。',
                  ),
              vision?.usingFreeFallback && vision?.freeFallback
                ? h(
                    'div',
                    { className: `${NS}-hint` },
                    `当前兜底：${vision.freeFallback.model}（免注册免 Key，有速率限制，画质与稳定性不如自备服务）`,
                  )
                : null,
            ),
          ),
        ),

        h(
          'div',
          { className: `${NS}-card` },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
            h('h3', { className: `${NS}-card__title` }, '视觉模型 API（自己填一个）'),
            apiReady
              ? h('span', { className: `${NS}-pill ${NS}-pill--ok` }, '已启用，识图优先走它')
              : h('span', { className: `${NS}-pill` }, '未启用'),
          ),
          h(
            'div',
            { className: `${NS}-hint` },
            'DSH 的模型注册表里没有可用的识图模型时，这里就是出路：任何 OpenAI 兼容（或 Anthropic 风格）的',
            '视觉服务都能填——本地 Ollama / LM Studio、自建网关、云端 API 都行。填了并启用后，识图第一步优先走它，',
            '失败再退回落注册表候选。',
          ),
          field('启用', toggle('enabled', '用这个 API 做识图'), null),
          field(
            '接口地址',
            h('input', {
              type: 'text',
              value: visionApi.baseURL ?? '',
              placeholder: 'http://127.0.0.1:11434/v1',
              onChange: (event) => patchVisionApi({ baseURL: event.currentTarget.value.trim() }),
            }),
            '不带结尾斜杠。OpenAI 兼容会自动补 /chat/completions，Anthropic 风格补 /v1/messages。',
          ),
          field(
            '模型名',
            h('input', {
              type: 'text',
              value: visionApi.model ?? '',
              placeholder: '例如 qwen2.5vl / llava / gpt-4o-mini',
              onChange: (event) => patchVisionApi({ model: event.currentTarget.value.trim() }),
            }),
          ),
          field(
            'API Key',
            h(
              'div',
              { style: { display: 'flex', gap: 8, alignItems: 'center' } },
              h('div', { style: { flex: '1 1 auto' } }, keyInput),
              h(
                'button',
                {
                  className: `${NS}-btn`,
                  onClick: () => {
                    setKeyDraft('');
                    patchVisionApi({ apiKey: '' }, { immediate: true });
                  },
                  title: '清空已保存的 Key',
                },
                '清除',
              ),
            ),
            '只存在本机配置文件里（不会发给别人）。输入框永不回显明文，留空 = 不改。',
          ),
          field(
            '协议',
            h(
              'select',
              {
                value: visionApi.format ?? 'openai',
                onChange: (event) => patchVisionApi({ format: event.currentTarget.value }, { immediate: true }),
              },
              h('option', { value: 'openai' }, 'OpenAI 兼容（/chat/completions，最常见）'),
              h('option', { value: 'anthropic' }, 'Anthropic 风格（/v1/messages）'),
            ),
          ),
          field('最大输出', number('maxTokens', 64, 32768), null),
          h(
            'div',
            { className: `${NS}-actions` },
            h(
              'button',
              { className: `${NS}-btn`, onClick: testApi, disabled: busy === 'vision-test' },
              busy === 'vision-test' ? '正在测…' : '测一下通不通',
            ),
            h('span', { className: `${NS}-hint` }, '会先发一张 32×32 的测试图；服务不认图就退化成纯文本 ping。'),
          ),
        ),

        h(
          'div',
          { className: `${NS}-card` },
          h('h3', { className: `${NS}-card__title` }, '它怎么说话'),
          field(
            '人设',
            h('textarea', {
              value: config.persona ?? '',
              placeholder: '留空 = 内置人设（活泼小鲸鱼娘）',
              onChange: (event) => patch({ persona: event.currentTarget.value }),
            }),
            '留空用内置的：活泼小鲸鱼娘，给这款游戏的建议、不念屏幕。',
          ),
          field('上下文句数', number('historyLimit', 0, 50), '把最近几句话喂回去，让它接着上一幕讲；0 = 不带。'),
          field(
            '截图复用',
            number('snapshotTtlMs', 0, 3600000, 500),
            '毫秒。0 = 每句都重新截屏；调大则这段时间内复用上一张（更省，但可能对着旧画面说话）。',
          ),
        ),

        h(
          'div',
          { className: `${NS}-actions` },
          h(
            'button',
            { className: `${NS}-btn ${NS}-btn--primary`, onClick: runNow, disabled: busy === 'once' },
            busy === 'once' ? '正在跑…' : '立刻试一轮',
          ),
          h('button', { className: `${NS}-btn`, onClick: probeNow, disabled: busy === 'probe' }, '只看当前前台窗口'),
          h('button', { className: `${NS}-btn`, onClick: () => void loadVision() }, '刷新识图状态'),
          note ? h('span', { className: `${NS}-hint` }, note) : null,
          busy === 'save' ? h('span', { className: `${NS}-hint` }, '保存中…') : null,
        ),

        error ? h('div', { className: `${NS}-out` }, `出错了：${error}`) : null,
        output ? h('div', { className: `${NS}-out` }, output) : null,
      );
    }

    return {
      name: 'game-pet',
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(installStyles, 'dsh-game-pet: styles');
        // 只注册设置页。**不再往页面里插浮层**：桌宠住在独立透明置顶小窗里，
        // 网页里再来一个左下角的小人+气泡纯属重复（按用户要求去掉）。
        // 浮层那份实现还在（Companion / PetSprite），要恢复就把下面三行注释放开。
        // ctx.slots.inject('shell.overlay', function* () {
        //   yield ctx.slots.register({ name: 'shell.overlay', id: 'game-pet', order: 900 }, () => h(Companion, {}));
        // });
        ctx.slots.inject('settings.section', function* () {
          yield ctx.slots.register(
            { name: 'settings.section', id: 'game-pet-config', order: 31, label: () => '桌宠参谋' },
            SettingsSection,
          );
        });
      },
    };
  },
});
