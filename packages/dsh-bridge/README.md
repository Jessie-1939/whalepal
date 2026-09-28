# dsh-whalepal-bridge

Pushes **DeepSeek Harness (DSH)** agent state to the [WhalePal](https://github.com/Jessie-1939/whalepal) desktop pet.
With this plugin the pet no longer has to guess from screenshots: she knows when the agent is thinking,
which tool it is running, when something failed, and when it is waiting for your approval.
WhalePal works fine when DSH is closed — the two are independent.

## What it does

It subscribes to public DSH events and POSTs a small state payload to a loopback address:

| DSH event | State sent to WhalePal |
| --- | --- |
| `agent/session-start` | `session-start` |
| `agent/status` | `busy` / `idle` |
| `tools/pre-execute` | `tool` (tool name + a command/path snippet cut to 90 chars) |
| `tools/result` | `tool-done` / `error` |
| `agent/error` | `error` (short error summary) |
| `agent/turn-stopping` | `turn-end` |
| `approval/request` | `waiting-approval` |

## Install

```sh
# from npm (once published)
dsh plugin --profile web add dsh-whalepal-bridge

# or straight from GitHub (subpackage of the monorepo)
dsh plugin --profile web add github:Jessie-1939/whalepal#path:/packages/dsh-bridge
```

Then restart `dsh web`. On the WhalePal side, keep 设置 → 陪伴 → "DSH 桥接（本机回环）" enabled
(default on, port 8787).

Uninstall:

```sh
dsh plugin --profile web remove dsh-whalepal-bridge
```

## Privacy

- **Loopback only**: `normalizeEndpoint()` rejects anything that is not `127.0.0.1` / `localhost`,
  and the plugin refuses to send at all in that case;
- **No message content**: only the tool name plus a 90-char command/path snippet;
- **No telemetry, no cloud calls, no files written**;
- When WhalePal is not running it fails silently (at most one debug log per 5 minutes)
  and never affects DSH itself.

## License

MIT.
