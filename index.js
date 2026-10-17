// 宿主半侧入口：插件三件套（name / inject / apply）。
// 业务在 src/ 下：harness-loader.mjs（运行时找 DSH 包）→ collect.mjs（探游戏+截屏）
//   → advise.mjs（看图+出建议）→ plugin.mjs（循环与路由）。
//
// 这里刻意不 import 任何 @deepseek-ai/* 包：插件装在 profile 的 node_modules 里，
// 而 DSH 的包在安装目录（app.asar）内，静态裸 import 会解析失败、并且让整个插件**静默**不生效
// （表现：路由 404、页面毫无反应、日志里什么都没有）。需要 DSH 的东西一律走
// harness-loader.mjs 在运行时解析。
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { apply } from './src/host/plugin.mjs';

export const name = 'dsh-game-pet';

/** 需要的服务：webServer 起路由；llm 调模型；agentDefaultModel 拿"当前对话用的模型"当默认。
 *  attachments 是可选服务（ctx.get('attachments', false)），缺了也能跑（退化成纯文本）。 */
export const inject = ['webServer', 'llm', 'agentDefaultModel'];

/** 加载留痕：插件出问题时"到底有没有被加载"最难判断，所以直接写一行日志。
 *  位置：$DSH_HOME/dsh-game-pet.log（DSH_HOME 缺失时退到 ~/.dsh）。 */
function trace(line) {
  try {
    const home = process.env.DSH_HOME || path.join(homedir(), '.dsh');
    mkdirSync(home, { recursive: true });
    appendFileSync(path.join(home, 'dsh-game-pet.log'), `[${new Date().toISOString()}] ${line}\n`, 'utf8');
  } catch {
    // 日志失败不能影响插件本身
  }
}

trace(`module loaded (pid ${process.pid}, node ${process.version})`);

function applyLogged(ctx) {
  trace('apply() entered');
  try {
    apply(ctx);
    trace('apply() completed without throwing');
  } catch (error) {
    trace(`apply() threw: ${error?.stack ?? error}`);
    throw error;
  }
}

export { applyLogged as apply };
