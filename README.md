# dsh-session-kit

[English](README.en.md) | 中文

`dsh-session-kit` 是一个 DeepSeek Harness 插件，用于增强会话页的日常管理能力。它不修改 DSH 核心源码，而是通过官方扩展点为会话增加管理菜单、归档会话管理、轮次级删除/重新生成，以及右侧话题快捷导航。

## 安装

### 从 npm 安装（推荐）：

```
dsh plugin --profile web add dsh-session-kit
```

### 从 github 安装：

```
dsh plugin --profile web add github:ltxlong/dsh-session-kit
````

## 示例

<img width="2216" height="1407" alt="image" src="https://github.com/user-attachments/assets/08686071-aab4-4f7f-9e26-f059e7bf623b" />
<img width="2520" height="1556" alt="image" src="https://github.com/user-attachments/assets/f8706893-d0c5-4a27-b547-fe5377f33c86" />

## 功能概览

### 会话管理菜单

插件会在会话页头部增加 **会话管理** 按钮，菜单包含：

- **删除会话**：会话停止后，经确认删除当前会话；运行中的会话会被保护，不能删除。
- **统计调用**：统计当前会话的工具调用，并按工具名显示总数、成功、失败、未完成次数。
- **重新命名**：通过官方 Session API 修改当前会话标题。
- **分叉会话**：在当前轮次允许分叉时，从当前会话创建一个新会话。
- **归档会话**：把当前会话加入工作区归档列表，从侧边栏隐藏。
- **打开目录**：使用系统文件管理器打开当前会话日志目录。
- **导出会话**：调用 DSH Session Log 的导出能力。
- **归档管理**：进入归档会话管理弹窗。

### 归档会话管理

归档弹窗用于管理已经归档、也就是从侧边栏隐藏的会话：

- 按标题搜索归档会话；
- 不恢复会话也能直接在弹窗中预览内容；
- 在预览中展示工具调用统计；
- 支持分页加载更多预览消息；
- 支持把归档会话分叉到新聊天中继续；
- 支持恢复归档会话，让它重新出现在会话列表中；
- 支持打开归档会话所在文件夹；
- 支持确认后删除归档会话。

删除会话时，Windows/macOS 会尽量移动到系统回收站/废纸篓；没有系统回收站集成的平台会直接删除会话目录。正在运行的归档会话不会被删除。

### 轮次删除与重新生成

插件会在已完成的顶层助手轮次旁，以及部分失败轮次尾部增加操作：

- **此轮到后续全删除**：从选中的轮次开始，删除当前轮及其后所有已完成轮次在当前 conversation surface 与后续模型上下文中的内容；不会删除整个 Session。
- **重新生成**：先从选中轮次开始删除后续内容，再把该轮原始用户提问重新加入队列，让模型从该位置重新回答。

安全策略：

- 删除并不是直接抹掉 append-only 日志，而是追加持久的 replacement tombstone；tombstone 的 provider/model 为 `dsh-turns-del` / `tombstone`。
- 原始 append-only 事件仍保留在会话日志中；折叠后的 active surface 不再展示被删除范围，后续模型上下文也不再包含这些内容。
- 修改 live session 前会取得 Agent maintenance lease。
- 每个目标轮次都会验证是否仍然对应独立、连续的 surface 区间。如果该轮次已被压缩、与保留历史混合，或与已有删除范围重叠，操作会直接拒绝，而不会猜测处理。
- 成功返回前会执行 `sessions.flush()`。
- 重新生成会在 Agent 正在运行、输入队列有待处理内容、原始用户提问缺失/有歧义/不是纯文本时拒绝执行。

### 话题快捷导航

每个会话页右侧会显示类似 `chat.deepseek.com` 的 **话题** 导航：

- 默认收起为一列扁平线条标记；
- 鼠标悬浮或键盘聚焦后展开固定尺寸的可滚动面板；
- 用户提问以单行省略标题展示；
- 完整标题只通过系统 tooltip 显示；
- 滚动会话时自动高亮当前话题；
- 点击话题可平滑跳转；
- 屏幕宽度较小时自动隐藏。

## 文件结构

- `lib/index.js`：Host 路由、归档/会话操作、轮次删除与重新生成逻辑。
- `lib/client.js`：Web UI Slot、弹窗、话题导航、轮次操作、样式与 locale 字典。
- `cordis.patch.yml`：插件 bundle 插入 patch。
- `README.md` / `README.en.md`：中文与英文说明文档。

## 注意事项与限制

- 插件不修改 DSH 核心包。
- 整个会话删除在会话运行中始终禁用。
- 轮次删除/重新生成采取保守策略；遇到不安全或已压缩的历史会拒绝执行。
- 重新生成只支持重放选中轮次中唯一的纯文本用户提问。
- 即使 active surface 已不再显示被删除内容，原始 append-only 事件仍然保留在会话日志中。

## License

[MIT](LICENSE)
