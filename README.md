# dsh-queue-director

A [DeepSeek Harness](https://github.com/deepseek-ai) web plugin that lets you **reorder queued messages** (up / down / top / bottom) before the agent processes them — handy when writing long articles or running a batch of prompts in your own preferred order.

## Features

- Each queued message gains `↑` / `↓` buttons; when the queue is expanded, `置顶` (top) / `置底` (bottom) chips appear as well.
- Built-in queue behaviors are preserved: preview, inline edit, remove, and send-now (steer).
- No server restart needed after an update: DSH's client HMR pushes the new bundle automatically (a hard refresh of the page is enough).

## How it works

- **Host half** (`lib/index.js`): registers one trusted HTTP endpoint `POST /queue-director/api/reorder`, which reorders pending inbox items via `agent.inbox.splice` — the same durable path the built-in `session.updateQueue` RPC uses, so the client snapshot refreshes automatically. The route uses the same browser-trust fence as dsh-better-sidebar (loopback / trusted hosts + same-origin checks).
- **Client half** (`lib/client.js`): shadows the built-in `conversation.input.dock` entry (`id: "queue"`, `priority: -1` — lowest renders), redrawing the queue strip with the extra reorder controls.
- No DSH source is modified; the plugin mounts as a bundle via `dsh.profile.bundles`.

## Requirements

- DeepSeek Harness web profile (`@deepseek-ai/dsh-web-app`), `dsh` launcher
- Node.js ≥ 20

## Install

From your DSH web profile directory (`$DSH_HOME/profiles/web`):

```sh
# 1. Add the plugin package (adjust the path to your checkout)
#    "dependencies": { "dsh-queue-director": "link:<path-to-this-repo>" }
# 2. Register the bundle in package.json:
#    "dsh": { "profile": { "bundles": [..., "dsh-queue-director"] } }
# 3. Install and restart
pnpm install
# restart `dsh web`, then hard-refresh the page (Cmd/Ctrl+Shift+R)
```

Or, once published to npm, use the official plugin command:

```sh
dsh plugin --profile web add dsh-queue-director
```

## Uninstall

```sh
cd "$DSH_HOME/profiles/web" && pnpm remove dsh-queue-director
# and remove "dsh-queue-director" from dsh.profile.bundles in package.json
```

## Development

- `lib/index.js` — host half (route + reorder logic; `reorderInbox` is exported for tests)
- `lib/client.js` — client half (`window.__ModuleLoader__.load` factory, no build step)
- `cordis.patch.yml` — bundle patch (inserts the plugin entry into the loader)

## License

[MIT](LICENSE)
