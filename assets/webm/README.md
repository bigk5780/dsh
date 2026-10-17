# assets/webm —— 自带的桌宠动画（兜底素材）

这里的 10 段透明动画来自 **[dsh-pet](https://github.com/PC2005-cloud/dsh-pet)**（MIT 代码 /
素材允许开源使用、**禁止商用**），是从它的 `assets/webm/` 里挑出来的"游戏陪聊"相关动作：
待机、被吓一跳、思考、雀跃、开心、害羞、踱步、哼歌、东张西望、吐泡泡。

**为什么要自带**：早先本插件把形象完全押在 dsh-pet 的路由上，而 dsh-pet 一旦被停用/卸载，
`/dsh-pet-7340/thumb/...` 整条路由就没了——结果是"只剩一个气泡，小人不见了"（真踩过）。
现在改成：

1. 先读**本目录**（`/dsh-game-pet-7341/anim/<名>.webm`）；
2. 找不到再回落到 dsh-pet 的路由（用了 dsh-pet 自己的自定义动画时，那条路才是对的）；
3. 都没有就画一块占位（气泡照常说话）。

只要动作名对得上（`src/shared/agent.mjs` 里的 `ANIMATION_POOL`），就能直接跑。
想换素材：把自己的 `.webm`（VP9-alpha）放进这里，或放进 dsh-pet 的
`$DSH_HOME/dsh-pet/main-animation/webm/`。
