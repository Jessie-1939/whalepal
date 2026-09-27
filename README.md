# 鲸伴 WhalePal · 桌面 AI 伙伴

> 一只住在你桌面、能自由走动、被拖拽互动，并且「看得懂你在忙什么」的鲸鱼伙伴。

**鲸伴 = MineContext 的「理解」 × 鲸鱼娘的「陪伴」**

- 理解侧（借鉴 [MineContext](https://github.com/volcengine/MineContext)）：周期截屏 → 感知哈希去重 → **云端视觉模型**理解你在做什么 → 本地事件记录 → 今日摘要与上下文问答。
- 陪伴侧（借鉴 [dsh-whale-musume](https://github.com/Sutera-Diffusus/dsh-whale-musume)）：透明置顶桌宠，桌面漫游、拖拽惯性、待机/工作状态联动、分区互动、养成成就、主动关怀。

## 三条硬约定

1. **模型分析全部在云端完成**：使用 OpenAI 兼容接口（Doubao / OpenAI / 自定义），本项目不运行本地模型。未配置 API Key 时使用「基础感知」（仅按前台窗口标题做关键词分类，不消耗调用），保证桌宠基础联动可用。
2. **only one 文件夹**：代码、配置、截图、事件、缓存、日志全部收纳在应用自己的文件夹内。打包分发为绿色 zip（推荐）时，`<应用目录>/data/` 就是全部运行数据的唯一去处；不写入系统图片 / 文档 / AppData 等位置。
3. **本机 PowerShell 采用 PowerShell 7**：前台窗口探测优先调用 `pwsh.exe`，找不到时回退 Windows PowerShell 5.1。

## 已实现（M1–M4）

- 桌宠窗口：透明置顶、点击穿透、桌面漫游（边界反弹）、拖拽惯性 + 贴边吸附 + 位置持久化、托盘显示/隐藏与「找回桌宠」。
- 姿态系统：idle / walk / work / sleep / happy / shy / eat / celebrate / carried / angry 十种姿势；`assets/poses/<姿势>/` 放入立绘即生效，缺素材自动 emoji 占位。
- 互动：摸头 / 戳肚子 / 戳尾巴三区、三连击彩蛋、右键菜单（投喂 / 夸夸 / 戳一下 / 今日摘要 / 设置 / 回到原位 / 暂停走动 / 隐藏）。
- 上下文引擎：60s 可调周期截屏（≤1280px）、感知哈希去重、云端视觉模型分析、失败自动降级、JSONL 事件存储与裁剪、调用次数统计。
- 陪伴联动：工作姿势 + 「工作中」光晕、深夜自动打盹、台词气泡、粒子特效、深夜静默。
- 主动关怀：久坐 25 分钟提醒（1 小时内不重复）、深夜劝休息（每晚一次）、离开 3 分钟后回来打招呼（总冷却 15 分钟）。
- 主动搭话（工具门控）：默认沉默；云端模型必须显式调用 `send_message` 工具才会开口，`stay_silent` 即保持安静；结合对话记忆、未回应超时（TIMEOUT_SIGNAL）与环境门控，避免无意义聊天。
- 人设 PERSONA_LOAD：鲸鱼娘（聪明懒散、傲娇但甜、只用中文、喜欢米饭、拒绝被说胖、超时信号），作用于全部云端输出与本地兜底语气。
- 对话记忆：`data/dialogue.jsonl` 记录双方发言与关键互动；问答、摘要、主动判断均携带最近对话，不会「忘记自己刚问过什么」。
- 养成：心情 / 好感 / 饱食度 / 等级 Lv1–7 / 陪伴时长、8 个成就、成长日记，全部本地持久化。
- 设置面板：陪伴 / 上下文 / 云端模型 / 对话 / 数据 / 关于 六个分区；模型连接测试、立即理解一次（含缩略图）、今日摘要、上下文问答、数据统计与清空、开机自启开关。

## 快速开始

```powershell
npm install
npm start
```

首次运行会在应用目录生成 `data/`（配置、事件、截图等都在这里）。

```powershell
npm test        # 状态机 / 感知哈希 / 分类器 单元测试
npm run check   # 全量语法检查
npm run dist    # 打包：dist/ 下产出 zip（绿色单文件夹）与 NSIS 安装包
```

### 立绘素材

把鲸鱼娘仓库（Sutera-Diffusus/dsh-whale-musume）的立绘按其含义拷贝进
`src/renderer/pet/assets/poses/<姿势>/`（姿势目录见该目录下的 README），
再放一张 `logo.png` 作为托盘图标即可。素材许可证核查见 M0 清单。

## 数据目录（only one 文件夹）

```
<应用目录>/data/
├─ config.json           # 全部设置（含 API Key，仅存本机）
├─ growth.json           # 养成数据
├─ usage.json            # 云端调用统计
├─ events.jsonl          # 上下文事件
├─ screenshots/latest.jpg# 最新一张截图（可关）
├─ scripts/              # 前台窗口探测脚本（首次运行自动生成）
├─ electron/             # Electron/Chromium 缓存（重定向至此）
├─ logs/                 # 应用日志
└─ crash/                # 崩溃转储
```

## 规划文档

| 文档 | 内容 |
| --- | --- |
| [docs/01-项目大纲.md](docs/01-项目大纲.md) | 项目定位、愿景、范围、成功标准 |
| [docs/02-需求规格.md](docs/02-需求规格.md) | 功能需求 FR-\* 与非功能需求 NFR-\* |
| [docs/03-系统架构.md](docs/03-系统架构.md) | 总体架构、模块职责、数据流、IPC、单文件夹布局 |
| [docs/04-技术选型与集成方案.md](docs/04-技术选型与集成方案.md) | 技术栈决策、融合映射、素材复用、云端模型与成本 |
| [docs/05-桌宠交互与陪伴设计.md](docs/05-桌宠交互与陪伴设计.md) | 状态机、物理参数、互动、关怀规则、养成数值 |
| [docs/06-开发计划与里程碑.md](docs/06-开发计划与里程碑.md) | M0–M5 里程碑与任务清单 |
| [docs/07-验收标准.md](docs/07-验收标准.md) | 逐模块验收清单 |
| [docs/08-风险与架构决策.md](docs/08-风险与架构决策.md) | 风险登记与 ADR |
| [docs/09-实现约定变更.md](docs/09-实现约定变更.md) | 云端模型 / 单文件夹 / PowerShell 7 的约定记录 |

## 验证记录（2026-09-27）

- [x] `npm install`：Electron 37.10.3 安装成功（下载经 npmmirror 镜像；npm 11 需手动放行
  install 脚本时执行 `node node_modules/electron/install.js` 即可）。
- [x] `npm test`：19/19 通过（状态机 / 感知哈希 / 分类器）。
- [x] `npm run check`：23 个文件语法检查通过。
- [x] 冒烟运行：截屏 → 感知哈希去重 → 基础感知分析 → 事件写入 `data/events.jsonl`，
  全链路通畅（`WHALEPAL_SMOKE=1` 可复现）。
- [x] 前台窗口探测：PowerShell 7 正确识别前台窗口（QQ / ChatGPT / Electron 等），
  中文标题 UTF-8 解码正常。
- [x] 实机渲染：鲸鱼娘立绘 + 对话气泡在透明置顶窗口中正确显示（截图为证），
  44 张立绘 + logo 已按姿势目录导入。
- [x] only one 文件夹：运行后所有落盘均在 `<应用目录>/data/` 内；
  `%LOCALAPPDATA%`、TEMP、图片/文档目录均无新增文件。
- 已修复两个实际缺陷：
  1. 单实例锁先于路径重定向执行，导致修复前产生了一个空目录
     `%APPDATA%\WhalePal`（现已不再创建；若想彻底清理可执行
     `Remove-Item "$env:APPDATA\WhalePal"`）。
  2. 150% 缩放下高频 `setPosition` 会让窗口尺寸逐次 +1px 漂移，
     现已改用 `setBounds` 显式携带尺寸，并加了尺寸自愈与位置钳制。
- [ ] 需要你补充的一步：填入云端模型 API Key（设置 → 云端模型 → 测试连接），
  然后「立即理解一次」应返回云端结果；不填时走基础感知，功能不受影响。

## 参考项目与致谢

| 项目 | 参考点 |
| --- | --- |
| volcengine/MineContext（Apache-2.0） | 上下文工程管线（截屏→理解→存储→摘要/问答） |
| Sutera-Diffusus/dsh-whale-musume | 桌宠表现层与养成设计，立绘素材来源 |
| dleaf6211-hash / luweiyabo 的 dsh-whale-pet | 双形态、状态感知、屏幕漫游思路 |
| Zguangliang/dsh-maid-whale-suite | 皮肤整合参考 |

细节与署名见 [NOTICE](NOTICE)。

## 许可证

MIT License，见 [LICENSE](LICENSE)。
