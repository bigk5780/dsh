// src/shared/agent.mjs —— 小鲸鱼娘的心情 → 播哪段动画。
//
// 为什么单独一个文件：'心情' 是纯函数（同样输入永远同样输出），
// 置顶小窗要按心情挑动画、宿主留痕用同一份，放一处避免两边漂移。

/** 动画名直接对应 dsh-pet 包内素材 assets/webm/<名>.webm。 */
export const ANIMATION_POOL = {
  think: ['工作状态-思考冒泡', '深度思考碎碎念', '原地漂浮踏步'],
  cheer: ['工作状态-雀跃庆祝', '点击回应-开心跃动', '轻快摇摆舞'],
  surprise: ['点击回应-害羞惊讶', '被吓一跳', '打瞌睡被惊醒'],
  bored: ['工作状态-原地踱步张望', '悠闲哼歌', '东张西望'],
  idle: ['待机呼吸休闲', '鲸鱼吐泡泡特效'],
};

/**
 * 选一段动画。
 * @param {{ mood?: string, seed?: number, index?: number }} input
 *   mood  ∈ think | cheer | surprise | bored | idle（不认识就按 idle）
 *   seed/index 让同一句话在两端算出同一个结果（种子取时间戳或计数都行）
 */
export function pickAnimation({ mood, seed = 0, index = 0 } = {}) {
  const pool = ANIMATION_POOL[mood] ?? ANIMATION_POOL.idle;
  const slot = Math.abs(Math.trunc(seed) + Math.trunc(index)) % pool.length;
  return pool[slot];
}

/**
 * 从这句话里读心情。顺序即优先级：惊呼 > 欢呼 > 提醒 > 闲聊。
 * 词表按"活泼鲸鱼娘"的口吻调过——语气词也算信号。
 * @param {{ say?: string, idleSeconds?: number }} input
 */
export function moodOf({ say = '', idleSeconds = 0 } = {}) {
  const text = String(say);
  // 惊呼 / 危险
  if (/呜哇|哇啊|哎呀|不好|危险|快躲|闪开|要死了|残血|紧急|来不及|小心|注意|别去/.test(text)) return 'surprise';
  // 欢呼 / 夸奖
  if (/好耶|耶！|厉害|漂亮|牛|赢了|过关|帅|不错|棒|稳了|成了|欸嘿|嘿嘿|好棒/.test(text)) return 'cheer';
  // 正经提醒
  if (/建议|可以|试试|记得|该|应该|换个|先|然后|下一步|快点/.test(text)) return 'think';
  if (idleSeconds > 30) return 'bored';
  return 'idle';
}
