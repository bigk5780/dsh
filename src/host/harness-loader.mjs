// harness-loader.mjs —— 运行时找 DSH 自带的那几个包（@deepseek-ai/dsh-llm 等）。
//
// 为什么不能直接 `import '@deepseek-ai/dsh-llm'`：
//   插件装在 profile 的 node_modules（profiles/desktop/node_modules/dsh-game-pet），
//   而 DSH 的包在**安装目录**里（Desktop 是 app.asar 内部）。Node 从插件目录往上找
//   node_modules 永远找不到它们，静态 import 会让整个插件加载失败（实测：路由一条都注册不上）。
//   dsh-pet 能裸 import 是因为它自己就装在 DSH 安装目录旁边。
//
// 所以：先试裸解析（同装一处时最快），再依次探 DSH 安装目录（Electron 的 asar 路径可以
// 直接 import，实测通过；同时也兼容解包目录与 pnpm 布局）。
const cache = new Map();

/** 探测 DSH 安装根（含 dsh/package.json 的那一层）。全部从进程信息推导，不写死任何本机路径。 */
function candidates() {
  const list = [];
  const push = (value) => {
    if (typeof value === 'string' && value && !list.includes(value)) list.push(value);
  };
  // Electron 主进程/渲染进程：resources 目录旁边就是 app.asar
  push(process.resourcesPath ? `${process.resourcesPath}/app.asar` : undefined);
  push(process.resourcesPath);
  push(process.env.DSH_RESOURCES ? `${process.env.DSH_RESOURCES}/app.asar` : undefined);
  // Electron 子进程（desktop helper 之类）能拿到 execPath，推同级的 .resources/app.asar
  if (typeof process.execPath === 'string') {
    push(
      process.execPath.toLowerCase().endsWith('.exe')
        ? `${process.execPath.slice(0, -4)}.resources/app.asar`
        : undefined,
    );
  }
  // 应用根目录（desktop-host 的 argv 里就有 <app.asar>/dsh 这一项）
  push(process.env.DSH_APP_ROOT);
  return list;
}

/**
 * 解析 DSH 包，返回动态 import 的模块命名空间。
 * @param {string} spec 例如 '@deepseek-ai/dsh-llm'
 * @returns {Promise<any>}
 */
export async function loadDsh(spec) {
  if (cache.has(spec)) return cache.get(spec);
  const errors = [];

  // 1) 裸解析（插件与 DSH 装在一起时走这条）
  try {
    const mod = await import(spec);
    cache.set(spec, mod);
    return mod;
  } catch (error) {
    errors.push(`bare: ${error.code ?? error.name}`);
  }

  // 2) 从 DSH 安装目录解析出绝对路径再 import（asar 内也能 import，实测通过）
  const { createRequire } = await import('node:module');
  const { pathToFileURL } = await import('node:url');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const scoped = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];

  for (const root of candidates()) {
    // 2a) 标准布局：<root>/dsh/node_modules/<spec>
    for (const scopeDir of ['dsh/node_modules', 'node_modules']) {
      const entry = path.join(root, scopeDir, ...spec.split('/'), 'package.json');
      if (fs.existsSync(entry)) {
        const pkg = JSON.parse(fs.readFileSync(entry, 'utf8'));
        const main = typeof pkg.exports === 'object' && pkg.exports !== null
          ? pkg.exports['.']?.default ?? pkg.exports['.'] ?? pkg.main
          : pkg.main;
        if (typeof main === 'string') {
          const file = path.join(path.dirname(entry), main);
          try {
            const mod = await import(pathToFileURL(file).href);
            cache.set(spec, mod);
            return mod;
          } catch (error) {
            errors.push(`${file}: ${error.code ?? error.name} ${String(error.message).slice(0, 80)}`);
          }
        }
      }
    }
    // 2b) Node 自己的算法：锚在 <root>/dsh 上，让它顺着 node_modules 链找
    try {
      const anchor = path.join(root, 'dsh', 'package.json');
      if (fs.existsSync(anchor)) {
        const require = createRequire(anchor);
        const resolved = require.resolve(spec);
        const mod = await import(pathToFileURL(resolved).href);
        cache.set(spec, mod);
        return mod;
      }
    } catch (error) {
      errors.push(`require/${root}: ${error.code ?? error.name}`);
    }
  }

  throw new Error(`dsh-game-pet: 找不到 DSH 包 ${spec}（试过：${errors.join(' | ')}）`);
}
