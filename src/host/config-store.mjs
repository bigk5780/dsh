// config-store.mjs —— 用户改过的配置落盘，重启后还记得。
//
// 为什么不用"直接改 cordis.patch.yml"：那是插件行配置（属于代码/组合层，改了要重启；
// 而且用户手写的注释会被覆盖）。设置页的改动进这里，启动时读回来叠在行配置之上：
//   patch 行 config（基础） ← config.json（用户覆盖）
// 这样"设置页改的"和"手写 patch 改的"各归各位，互不破坏。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const HOME = process.env.DSH_HOME || path.join(homedir(), '.dsh');
const CONFIG_FILE = path.join(HOME, 'dsh-game-pet.json');

/** 读用户覆盖（没有/坏了都返回空对象，绝不抛）。 */
export function readUserConfig() {
  try {
    // 去掉 BOM：用户可能用记事本/PowerShell 编辑过这个文件，
    // 带 BOM 的 JSON.parse 会直接抛（踩过：PowerShell 的 utf8 编码会加 BOM）。
    const raw = readFileSync(CONFIG_FILE, 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** 写用户覆盖（整包写入；失败只返回 false，不抛）。 */
export function writeUserConfig(patch) {
  try {
    mkdirSync(HOME, { recursive: true });
    const next = { ...readUserConfig(), ...(patch && typeof patch === 'object' ? patch : {}) };
    writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

export { CONFIG_FILE };
