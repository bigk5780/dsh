// state.mjs —— 宿主半侧 → 浏览器半侧的状态面（前端按 1 秒轮询拿它）。
//
// 每个叶子都是 { counter, data }：counter 只增不减，前端记住上一次的 counter，
// 变了才处理——和 dsh-pet 的 /state 同一套协议，前端不用建立长连接。
export class CompanionState {
  constructor() {
    this.seq = 0;
    this.sections = new Map();
  }

  write(key, data) {
    this.seq = Math.max(Date.now(), this.seq + 1);
    this.sections.set(key, { counter: this.seq, data });
  }

  /**
   * 给前端的快照。
   * @param {string[]} keys 白名单（前端只认这几片，不把内部状态整包漏出去）
   */
  snapshot(keys) {
    const sections = {};
    for (const key of keys) {
      const entry = this.sections.get(key);
      if (entry) sections[key] = entry;
    }
    return { sections };
  }
}
