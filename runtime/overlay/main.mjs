// main.mjs —— 桌宠浮层的「置顶小窗」宿主（极简 Electron 主进程）。
//
// 为什么需要它：浏览器里的浮层只能活在 DSH 窗口内，永远盖不到别的应用上面。
// 要让建议在玩游戏时真的看得见，必须开一个**透明、置顶、跳过任务栏**的小窗。
//
// 交互约定（与 dsh-pet 同一套思路）：
//   - 窗内只有"宠物身体命中区"可交互，其余透明像素一律点击穿透到下层应用；
//   - 默认 ignoreMouseEvents(true, {forward:true})：保留 mousemove 才能判断悬停；
//   - 渲染层检测到鼠标进入命中区 → 调 preload 暴露的 setInteractive(true) 翻成可交互；
//   - 拖拽用 -webkit-app-region: drag，窗口移动后把坐标回传宿主保存。
//
// 环境变量（由宿主半侧注入）：
//   GP_OVERLAY_URL  要加载的页面（宿主自己的 /overlay 路由）
//   GP_POS_URL      回传窗口坐标的接口（宿主 /position）
//   GP_PING_URL     存活探测接口（宿主 /ping）；探测失败即自行退出，不留孤儿窗
//   GP_X / GP_Y     窗口左上角坐标（虚拟屏坐标；缺省则右下角）
import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 小窗是独立进程，stdout 常常看不到；所以出错一律落盘一份，排障全靠它。 */
function trace(line) {
  try {
    const file = process.env.GP_LOG_FILE;
    if (!file) return;
    appendFileSync(file, `[${new Date().toISOString()}] ${line}\n`, 'utf8');
  } catch {
    // 日志失败不影响窗口
  }
}

process.on('uncaughtException', (error) => {
  trace(`uncaughtException: ${error?.stack ?? error}`);
});
process.on('unhandledRejection', (reason) => {
  trace(`unhandledRejection: ${reason?.stack ?? reason}`);
});

// 必须在 ready 之前调用（ready 之后调会抛）
app.disableHardwareAcceleration?.();

const url = process.env.GP_OVERLAY_URL;
const posUrl = process.env.GP_POS_URL;
const pingUrl = process.env.GP_PING_URL;
const width = Number(process.env.GP_WIDTH || 340);
const height = Number(process.env.GP_HEIGHT || 360);
const wantX = process.env.GP_X ? Number(process.env.GP_X) : null;
const wantY = process.env.GP_Y ? Number(process.env.GP_Y) : null;

trace(`boot pid=${process.pid} url=${url} size=${width}x${height} at=${wantX},${wantY}`);

if (!url) {
  trace('GP_OVERLAY_URL missing, exiting');
  console.error('dsh-game-pet overlay: GP_OVERLAY_URL is required');
  app.exit(2);
}

let win = null;
let interactive = false;
let moveTimer = null;
/** 拖拽锚点：按下时的屏幕光标位置 + 窗口位置 */
let dragAnchor = null;

function defaultPosition() {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.round(area.x + area.width - width - 24),
    y: Math.round(area.y + area.height - height - 24),
  };
}

async function post(url, body) {
  if (!url) return false;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function createWindow() {
  const fallback = defaultPosition();
  try {
    win = new BrowserWindow({
      width,
      height,
      x: wantX ?? fallback.x,
      y: wantY ?? fallback.y,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      focusable: false,
      show: false,
      webPreferences: {
        preload: path.join(path.dirname(fileURLToPath(import.meta.url)), 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
  } catch (error) {
    trace(`BrowserWindow creation failed: ${error?.stack ?? error}`);
    return null;
  }

  trace('BrowserWindow created');
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.webContents.on('did-fail-load', (_event, code, description, validatedUrl) => {
    trace(`did-fail-load code=${code} ${description} url=${validatedUrl}`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    trace(`render-process-gone ${JSON.stringify(details)}`);
  });
  win.webContents.on('console-message', (_event, level, message) => {
    trace(`renderer console[${level}]: ${message}`);
  });
  void win.loadURL(url).then(
    () => trace('loadURL resolved'),
    (error) => trace(`loadURL rejected: ${error?.message ?? error}`),
  );
  win.once('ready-to-show', () => {
    win?.showInactive();
    trace('ready-to-show -> showInactive');
  });
  if (process.env.GP_SHOW === '1') {
    win.showInactive();
    trace('GP_SHOW=1 -> showInactive immediately');
  }

  win.on('moved', () => {
    if (moveTimer) clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      if (!win) return;
      const [x, y] = win.getPosition();
      trace(`moved -> ${x},${y}`);
      void post(posUrl, { x, y });
    }, 400);
  });

  win.on('closed', () => {
    trace('window closed');
    win = null;
  });
  return win;
}

/**
 * 拖拽：**不用** `-webkit-app-region: drag`（那个要求窗口可聚焦/已聚焦，本窗是
 * `focusable: false` 的置顶窗，实测点了没反应），改成渲染层报指针位移、
 * 这里用**屏幕坐标**挪窗——完全不依赖 OSC 拖拽区域与焦点。
 */
function startDrag() {
  if (!win) return;
  dragAnchor = { cursor: screen.getCursorScreenPoint(), bounds: win.getBounds() };
  trace(`drag start at ${dragAnchor.cursor.x},${dragAnchor.cursor.y} window ${dragAnchor.bounds.x},${dragAnchor.bounds.y}`);
}

function moveDrag() {
  if (!win || !dragAnchor) return;
  const cursor = screen.getCursorScreenPoint();
  const x = dragAnchor.bounds.x + (cursor.x - dragAnchor.cursor.x);
  const y = dragAnchor.bounds.y + (cursor.y - dragAnchor.cursor.y);
  win.setPosition(Math.round(x), Math.round(y));
}

function endDrag() {
  if (!win || !dragAnchor) return;
  dragAnchor = null;
  const [x, y] = win.getPosition();
  trace(`drag end -> ${x},${y}`);
  void post(posUrl, { x, y });
}

app.whenReady().then(
  () => {
    trace('app ready');
    createWindow();

    ipcMain.on('gp-set-interactive', (_event, value) => {
      const next = Boolean(value);
      if (next === interactive) return;
      interactive = next;
      win?.setIgnoreMouseEvents(!next, { forward: true });
    });

    ipcMain.on('gp-set-position', (_event, x, y) => {
      win?.setPosition(Math.round(Number(x) || 0), Math.round(Number(y) || 0));
    });

    ipcMain.on('gp-drag-start', () => startDrag());
    ipcMain.on('gp-drag-move', () => moveDrag());
    ipcMain.on('gp-drag-end', () => endDrag());

    ipcMain.on('gp-quit', () => app.quit());

    // 宿主不在了就退出（每 15 秒探一次）；顺便把窗口状态记一行，排障用
    setInterval(() => {
      void (async () => {
        if (win) {
          trace(
            `state alive=${win.isVisible()} bounds=${JSON.stringify(win.getBounds())} onScreen=${win.isOnScreen?.()}`,
          );
        }
        const alive = await post(pingUrl, { pid: process.pid });
        if (!alive) app.quit();
      })();
    }, 15000);
  },
  (error) => trace(`app.whenReady rejected: ${error?.stack ?? error}`),
);

app.on('window-all-closed', () => app.quit());
