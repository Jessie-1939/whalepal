# dsh-whalepal-bridge

把 **DeepSeek Harness (DSH)** 的 agent 状态推给桌面宠物应用「鲸伴 WhalePal」（[WhalePal](https://github.com/Jessie-1939/whalepal)）。
鲸伴是一个独立的桌面宠物（Electron 应用，单独安装）；本插件只负责把 agent 状态送给它。
装了这个插件，鲸伴不必再靠截屏猜——她直接知道 agent 在思考、在跑哪个工具、报错了、还是正在等你确认。
DSH 没开的时候鲸伴照常用，两者互不依赖。

## 它做什么

订阅 DSH 的公开事件，把状态 POST 到本机回环地址：

| DSH 事件 | 推给鲸伴的状态 |
| --- | --- |
| `agent/session-start` | `session-start` |
| `agent/status` | `busy` / `idle` |
| `tools/pre-execute` | `tool`（带工具名，以及截断到 90 字的命令/路径） |
| `tools/result` | `tool-done` / `error` |
| `agent/error` | `error`（带错误摘要） |
| `agent/turn-stopping` | `turn-end`（她在旁边庆祝一下） |
| `approval/request` | `waiting-approval`（她提醒你"在等你确认"） |

## 安装

```sh
# 从 npm（若已发布）
dsh plugin --profile web add dsh-whalepal-bridge

# 或直接从 GitHub 安装这个 monorepo 里的子包
dsh plugin --profile web add github:Jessie-1939/whalepal#path:/packages/dsh-bridge
```

装好后确认它进了 profile 的层栈（`dsh plugin --profile web ls`，或看
`$DSH_HOME/profiles/web/package.json` 里的 `dsh.profile.bundles`），然后重启 `dsh web`。
鲸伴端在 设置 → 陪伴 → 「DSH 桥接（本机回环）」里打开开关即可（默认开，端口 8787）。

卸载：

```sh
dsh plugin --profile web remove dsh-whalepal-bridge
```

## 配置

`cordis.patch.yml` 里可以改推送地址（**只接受回环地址**，其他地址一律拒绝发送）：

```yaml
- insert:
    - id: whalepal-bridge
      name: dsh-whalepal-bridge
      config:
        endpoint: http://127.0.0.1:8787/dsh-state
```

## 隐私

- **只往 `127.0.0.1` / `localhost` 发**：`normalizeEndpoint()` 会拒绝任何非回环地址，插件直接不工作；
- **不读消息内容**：只取工具名与一段截断到 90 字的命令/路径（用于让桌宠知道"在干什么"）；
- **无遥测、无云端请求、不落盘**；
- 鲸伴没开时静默失败（每 5 分钟最多写一条 debug 日志），绝不影响 DSH 自身运行。

## 许可

MIT。
