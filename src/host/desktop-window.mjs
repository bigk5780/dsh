// desktop-window.mjs —— 把置顶小窗的 Electron 进程管起来。
//
// 只在 Windows/macOS/Linux 有图形界面时有用；找不到 Electron 就**只告警不影响浏览器浮层**
// （和 dsh-pet 同一套容错策略：桌面形态是加分项，不是唯一出路）。
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OVERLAY_DIR = path.resolve(HERE, '..', '..', 'runtime', 'overlay');

/** 找 Electron 可执行文件：环境变量 → DSH 自己下载的那份（dsh-pet 用的也是这个）。 */
function electronBinary() {
  const explicit = process.env.DSH_GAME_PET_ELECTRON || process.env.DSH_PET_ELECTRON_PATH;
  if (explicit && existsSync(explicit)) return explicit;
  const home = process.env.DSH_HOME;
  const candidates = [];
  if (home) {
    candidates.push(path.join(home, 'electron', 'electron.exe'));
    candidates.push(path.join(home, 'electron', 'Electron.app', 'Contents', 'MacOS', 'Electron'));
    candidates.push(path.join(home, 'electron', 'electron'));
  }
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'electron', 'electron.exe'));
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * 起一个小窗进程。
 * @param {{ host: string, port: number, width?: number, height?: number, x?: number|null, y?: number|null,
 *   onPosition?: (x: number, y: number) => void, log?: (level: string, message: string) => void }} options
 * @returns {{ stop: () => void, running: () => boolean }}
 */
export function startOverlayWindow(options) {
  const { host = '127.0.0.1', port, width = 340, height = 360, x = null, y = null, log } = options;
  const binary = electronBinary();
  if (!binary) {
    log?.('warn', '没找到 Electron 可执行文件，置顶小窗跳过（浏览器浮层照常工作）');
    return { stop: () => {}, running: () => false };
  }
  if (!existsSync(path.join(OVERLAY_DIR, 'main.mjs'))) {
    log?.('warn', `置顶小窗的宿主文件缺失：${OVERLAY_DIR}`);
    return { stop: () => {}, running: () => false };
  }

  const base = `http://${host}:${port}/dsh-game-pet-7341`;
  const env = {
    ...process.env,
    GP_OVERLAY_URL: `${base}/overlay`,
    GP_POS_URL: `${base}/position`,
    GP_PING_URL: `${base}/ping`,
    GP_WIDTH: String(width),
    GP_HEIGHT: String(height),
    GP_LOG_FILE: path.join(process.env.DSH_HOME || process.env.TEMP || '.', 'dsh-game-pet-window.log'),
  };
  if (x !== null && x !== undefined) env.GP_X = String(x);
  if (y !== null && y !== undefined) env.GP_Y = String(y);
  delete env.ELECTRON_RUN_AS_NODE;

  let child = null;
  let stopped = false;

  const launch = () => {
    if (stopped) return;
    child = spawn(binary, [path.join(OVERLAY_DIR, 'main.mjs')], {
      env,
      stdio: 'ignore',
      windowsHide: true,
      detached: false,
    });
    child.on('exit', (code) => {
      child = null;
      if (stopped) return;
      log?.('warn', `置顶小窗退出（code=${code}），2 秒后重新拉起`);
      setTimeout(launch, 2000);
    });
    child.on('error', (error) => {
      log?.('warn', `置顶小窗启动失败：${error.message}`);
    });
  };

  launch();

  return {
    stop() {
      stopped = true;
      try {
        child?.kill();
      } catch {
        // 退出失败无所谓，宿主进程结束时它会因为 ping 失败自己退
      }
      child = null;
    },
    running: () => child !== null,
  };
}

export { electronBinary };
