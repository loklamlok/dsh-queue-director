# dsh-queue-director

**[English](README.md) | [中文](README.zh.md)**

[DeepSeek Harness](https://github.com/deepseek-ai)（DSH）Web 插件：**调整排队消息的顺序**（上移 / 下移 / 置顶 / 置底），让 AI 按你想要的顺序处理排队中的指令——写长文、批量发指令时特别好用。

## 功能

- 每条排队消息旁新增 `↑` / `↓` 按钮；展开队列后还会显示 **置顶** / **置底** 按钮。
- **拖动排序**：按住消息行（或行首 `⠿` 把手）直接拖到队列中的任意位置。
- **全部置顶**：一键把所有排队消息立即交给 AI 处理（任务运行中可用）。
- **清空队列**：一键移除全部待处理消息（两次点击确认，防误删）。
- 保留 DSH 内置队列的全部能力：预览、行内编辑、删除、立即发送（steer）。
- 更新插件后无需重启服务器：DSH 的客户端热更新（HMR）会自动推送新版本（页面强制刷新一次即可）。

## 工作原理

- **宿主半**（`lib/index.js`）：注册一个受信任的 HTTP 端点 `POST /queue-director/api/reorder`，通过 `agent.inbox.splice` 重排待处理消息——与内置 `session.updateQueue` RPC 走同一条持久化通路，客户端快照自动刷新。路由使用与 dsh-better-sidebar 相同的浏览器信任围栏（回环地址 / 受信 Host + 同源校验）。
- **客户端半**（`lib/client.js`）：以 `priority: -1` 影内置的 `conversation.input.dock` 条目（id 为 `queue`，低优先级渲染），重绘排队条并附加排序控制。
- 不修改 DSH 任何源码，插件以组合包（bundle）形式通过 `dsh.profile.bundles` 挂载。

## 环境要求

- DSH web profile（`@deepseek-ai/dsh-web-app`）与 `dsh` 启动器
- Node.js ≥ 20

## 安装

在 DSH web profile 目录（`$DSH_HOME/profiles/web`）下：

```sh
# 1. 添加插件依赖（路径换成你的代码位置）
#    "dependencies": { "dsh-queue-director": "link:<插件路径>" }
# 2. 在 package.json 注册 bundle：
#    "dsh": { "profile": { "bundles": [..., "dsh-queue-director"] } }
# 3. 安装并重启
pnpm install
# 重启 `dsh web`，然后强制刷新页面（Cmd/Ctrl+Shift+R）
```

或者，发布到 npm 后可使用官方插件命令：

```sh
dsh plugin --profile web add dsh-queue-director
```

## 卸载

```sh
cd "$DSH_HOME/profiles/web" && pnpm remove dsh-queue-director
# 并从 package.json 的 dsh.profile.bundles 中删除 "dsh-queue-director"
```

## 开发

- `lib/index.js` — 宿主半（排序路由与重排逻辑；`reorderInbox` 已导出供测试使用）
- `lib/client.js` — 客户端半（`window.__ModuleLoader__.load` 工厂，无需构建步骤）
- `cordis.patch.yml` — bundle patch（把插件条目插入加载器）

## 协议

[MIT](LICENSE)
