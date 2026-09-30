# Changelog

本项目的重要变更记录。更细粒度的设计约定变更见 [docs/09-实现约定变更.md](docs/09-实现约定变更.md)。

## 未发布

### 新增

- **DeepSeek 供应商预设**：`deepseek-flash`（= DeepSeek-V4.1-Flash，原生支持图片输入、1M 上下文），
  Base URL `https://api.deepseek.com`。预设显式关闭思考模式——同一张真实截图实测
  **1.7s / 约 1.4k token**（默认思考模式 5.6s / 约 2.2k token，其中 727 是推理 token）。
  设置页「服务预设」一键切换；DeepSeek 的 API Key 与百炼/豆包各自独立，切换不互相覆盖。
- **token 用量记账**：每次云端调用的响应 `usage` 按「来源 × 日期」记入 `data/usage.json`
  （analyze / ask / summary / proactive / voice / test 六个来源），设置页展示累计输入 / 输出 / 缓存命中 token。
  只存数字，不含屏幕内容或对话原文。旧版 usage.json 的纯计数作为 legacy 基数保留。
- **系统信任库适配**：装了 Kaspersky 等会重签 HTTPS 证书的软件时，Node/Electron 会报
  `self signed certificate in certificate chain` 导致云端调用全挂。`启动鲸伴.vbs` 现在会用
  `--use-system-ca` 让 Electron 直接采用 Windows 信任库，并支持把系统根证书导出到
  `data/tls/windows-roots.pem` 兜底（`npm run start:ca` / `scripts/export-system-ca.ps1`）。

### 修复

- `addRecord` 只认归一化字段，直传 API 原始 `prompt_tokens` 时会静默记 0 → 两种写法都接受。
- 文本类云端调用（问答 / 摘要 / 搭话 / 台词）分别落在两个收集器里，引擎只 drain 自己的 →
  改为同时 drain 两个，避免这部分 token 永远不落盘。

## 0.1.0 — 2026-09-27 → 09-28

### 新增

- **桌宠本体**：透明置顶窗口（点击穿透 / 拖拽惯性 / 贴边吸附 / 位置持久化）、12 个姿势组
  （60+ 张立绘）、摸头/戳肚子/戳尾巴、三连击、右键菜单、气泡与粒子、3 分钟无互动原地打盹。
- **上下文引擎**：周期截屏（≤1280px）→ 感知哈希**窗口去重**（最近 6 张，LRU）→
  云端多模态理解（百炼 qwen3.8-omni-flash / Doubao / OpenAI 兼容）→ 事件落盘（含 `durationMs` 驻留时长）；
  画面无变化时只累加时长、不重复调用。
- **分层上下文**：L0 对话记忆 / L1 每日摘要（过去日期缓存）/ L2 事件明细；
  「现在/此刻」类提问才现场截一张图给模型（图片只在需要"看"的时刻进场）。
- **日历热力图**：按天聚合、按专注时长五档强度、单日时间线、按天摘要。
- **主动关怀与主动搭话**：久坐 25 分钟 / 深夜（安静时段）/ 回来打招呼；
  主动搭话默认沉默，云端模型必须显式调用 `send_message` 工具才会发送；
  设置内提供「让她现在说一句」手动自检（直接生成一句，不走门控）。
- **隐私**：唯一网络出口白名单（`net.js`）、关闭 Chromium 后台联网/组件更新/崩溃上报、
  单文件夹存储（`<应用目录>/data/`）、`npm run privacy` 审计脚本（当前文件 + 全部历史）。
- **界面**：设置页按 Apple Liquid Glass 重做（浅灰白地面 / 统一面板 / 发丝分隔线 / 单一强调色）；
  桌宠气泡与右键菜单为液态玻璃材质化动效；日历浅色热力图。
- **工程**：60+ 张素材随仓库分发、52 项单元测试、README 动图生成脚本（`npm run gif`）、
  CHANGELOG / CONTRIBUTING 拆分、`.gitattributes` 保护二进制资产。

### 修复（按发现顺序）

1. 单实例锁先于路径重定向执行 → 修复在 `%APPDATA%` 产生残留目录的问题。
2. 150% 缩放下高频 `setPosition` 导致窗口尺寸逐次 +1px 漂移 → 改用 `setBounds` 显式携带尺寸 + 尺寸自愈。
3. 立绘无法贴到屏幕顶边（窗口级边界限制）→ 改为按"立绘可视区域"贴边，气泡在贴顶时自动翻转到身体下方。
4. 启动时把上次退出的瞬时状态（phase/pose）固化恢复 → 启动一律从 idle 开始，由 tick/context 重新决定。
5. 工作姿势"同目录随机挑图"显得花哨 → 先改为确定性单图（矫枉过正，永远一张）→
   最终定为**语义分组 + 4 分钟轮换**（如写代码：调试 → 偷内存条 → 工具）。
6. `work-slack` 前缀误命中 `work-slack-phone` → 选图改为精确文件名优先、前缀兜底。
7. 隐私清理：业务空间专属域名从全部提交历史移除、作者邮箱改为 GitHub noreply、
   记忆体积面板移除无意义的对比行。

### 验证记录（当时的实测）

- `npm install`：Electron 37.10.3（下载走 npmmirror 镜像；npm 11 需手动放行安装脚本时执行
  `node node_modules/electron/install.js`）。
- `npm test`：52/52 通过；`npm run check`：40 个文件通过。
- 端到端（真实云端）：周期理解返回 `source: "cloud"`，activity/category/isWorking 判断正确，
  note 带人设口吻；「现在」类提问附带实时截图并基于画面作答；主动搭话工具门控与手动自检均实测通过。
- 全新克隆验证：从 GitHub clone → `npm install` → 52/52 测试 → 应用启动成功，
  `data/` 自动生成于克隆目录（单文件夹原则）。

## 0.0.x — 规划阶段（2026-09-27）

- 项目计划文档 docs/01–08（大纲、需求、架构、选型、交互、里程碑、验收、风险）与首次提交。
