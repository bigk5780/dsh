// preload.cjs —— 渲染层与宿主唯一的桥梁：只暴露几个开关。
// 用 CJS 是因为 Electron 的 preload 在 contextIsolation 下必须是可 require 的脚本。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gp', {
  /** 鼠标进入/离开宠物命中区时切换"这一块能不能点" */
  setInteractive(value) {
    ipcRenderer.send('gp-set-interactive', Boolean(value));
  },
  /**
   * 拖拽三件套：按**屏幕坐标**挪窗。
   * 为什么不用 `-webkit-app-region: drag`：那个要求窗口可聚焦/已聚焦，
   * 而这是 `focusable: false` 的置顶窗，实测按上去没反应。手动拖完全绕开这个限制。
   */
  dragStart() {
    ipcRenderer.send('gp-drag-start');
  },
  dragMove() {
    ipcRenderer.send('gp-drag-move');
  },
  dragEnd() {
    ipcRenderer.send('gp-drag-end');
  },
  /** 需要程序化移动窗口时用 */
  setPosition(x, y) {
    ipcRenderer.send('gp-set-position', x, y);
  },
  /** 退出这个小窗 */
  quit() {
    ipcRenderer.send('gp-quit');
  },
});
