// collect.mjs —— 宿主半侧的"眼睛"：探当前前台窗口（是不是游戏）+ 截一张图。
//
// 设计要点：
//  - 只在 Windows 上工作（本机就是 Windows）。PowerShell 源刻意保持纯 ASCII，
//    中文（窗口标题）只作为数据回传，避免 OEM 代码页把脚本源码读坏。
//  - 截屏走 per-monitor DPI 感知的 CopyFromScreen（与 dsh-vision-router 同一套做法），
//    否则多屏/缩放下会截错区域。
//  - PowerShell 的 Add-Type 用 CodeDom 编译临时程序集，TEMP 含非 ASCII 字符会编译失败，
//    所以每次都在系统临时目录下开一个纯 ASCII 的 scratch 目录，并把 TEMP/TMP 指向它。
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PS1_PATH = path.join(HERE, 'helper-win.ps1');

/**
 * 探当前前台窗口。
 * @returns {Promise<{available: boolean, error?: string, hwnd?: number, pid?: number, process?: string,
 *   title?: string, class?: string, minimized?: boolean, fullscreen?: boolean, rect?: {x:number,y:number,w:number,h:number}}>}
 */
export async function detectForeground({ timeoutMs = 10000 } = {}) {
  if (process.platform !== 'win32') {
    return { available: false, error: `unsupported platform: ${process.platform}` };
  }
  const scratch = await mkdtemp(path.join(tmpdir(), 'dsh-game-pet-'));
  const target = path.join(scratch, 'window.json');
  try {
    // 走文件而不是 stdout：Windows PowerShell 5.1 的控制台编码会把中文标题写坏，
    // helper 直接把 UTF-8 JSON 落盘，这里按 UTF-8 读回来。
    await runHelper(['-Mode', 'detect', '-Out', target], { timeoutMs, scratchDir: scratch });
    const raw = await readFile(target, 'utf8');
    const line = raw.trim().split('\n').pop() ?? '';
    if (!line) return { available: false, error: 'helper produced no output' };
    return JSON.parse(line);
  } catch (error) {
    return { available: false, error: message(error) };
  } finally {
    await dispose(scratch);
  }
}

/**
 * 截一张 PNG。
 * @param {{ hwnd?: number, timeoutMs?: number }} options hwnd=0/缺省 → 整个虚拟屏；否则只截那个窗口。
 * @returns {Promise<{ path: string, bytes: number, data: Buffer, dispose: () => Promise<void> }>}
 */
export async function capturePng({ hwnd = 0, timeoutMs = 25000 } = {}) {
  if (process.platform !== 'win32') throw new Error(`unsupported platform: ${process.platform}`);
  const scratch = await mkdtemp(path.join(tmpdir(), 'dsh-game-pet-'));
  const target = path.join(scratch, 'shot.png');
  try {
    await runHelper(['-Mode', 'capture', '-Out', target, '-Hwnd', String(hwnd ?? 0)], {
      timeoutMs,
      scratchDir: scratch,
    });
    const data = await readFile(target);
    if (data.length === 0) throw new Error('capture produced an empty file');
    return { path: target, bytes: data.length, data, dispose: () => dispose(scratch) };
  } catch (error) {
    await dispose(scratch);
    throw error;
  }
}

function dispose(scratch) {
  return rm(scratch, { recursive: true, force: true }).catch(() => {});
}

/**
 * 跑一次 helper（-File 方式：注释与 here-string 都不会被命令行解析吃掉）。
 * scratchDir 只为 capture 准备：Add-Type 的 CodeDom 编译在 TEMP 含非 ASCII 时会失败。
 */
async function runHelper(args, { timeoutMs, scratchDir } = {}) {
  const options = { windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 };
  if (scratchDir) {
    options.cwd = scratchDir;
    options.env = { ...process.env, TEMP: scratchDir, TMP: scratchDir };
  }
  return execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', PS1_PATH, ...args],
    options,
  );
}

function execFileAsync(file, args, options) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function message(error) {
  if (error && typeof error === 'object') {
    const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : '';
    const base = error.message ? String(error.message) : String(error);
    return stderr ? `${base} :: ${stderr.split('\n').slice(-3).join(' ')}` : base;
  }
  return String(error);
}
