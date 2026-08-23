# dsh-session-kit

English | [中文](README.md)

`dsh-session-kit` is a DeepSeek Harness plugin that adds practical session utilities without patching DSH core code. It extends the conversation page with a session-management menu, archived-session tools, turn-level cleanup/regeneration actions, and a right-side topic navigator.

## Install

### From npm (recommended):

```
dsh plugin --profile web add dsh-session-kit
```

### From github:

```
dsh plugin --profile web add github:ltxlong/dsh-session-kit
````

## example

<img width="2520" height="1556" alt="image" src="https://github.com/user-attachments/assets/391d3c03-7b12-48c8-ab18-493fea5ff1c6" />

## Features

### Session manager menu

The plugin adds a **Session manager** button to the conversation header. The menu provides:

- **Delete session**: deletes the current stopped session after confirmation. Running sessions are protected and cannot be deleted.
- **Call stats**: counts tool calls in the current session and groups them by tool name, including succeeded, failed, and pending calls.
- **Rename**: renames the current session through the official session API.
- **Fork session**: creates a new session from the current one when the current turn is forkable.
- **Archive session**: hides the current session from the sidebar by adding it to the workspace archive list.
- **Open folder**: opens the current session log directory in the system file manager.
- **Export session**: delegates to DSH Session Log export.
- **Open archive**: opens the archived-session management dialog.

### Archived-session manager

The archive dialog manages sessions that are archived/hidden from the sidebar:

- search archived sessions by title;
- preview archived session content in a modal without restoring it;
- show tool-call statistics in the preview;
- load preview messages incrementally;
- continue an archived session in a new chat by forking it;
- restore archived sessions back to the session list;
- open an archived session folder;
- delete archived sessions after confirmation.

Deletion uses the operating system trash on Windows/macOS. On platforms without a system trash integration, the session directory is removed directly. Running archived sessions are not deleted.

### Turn cleanup and regeneration

The plugin adds actions next to completed top-level assistant turns and supported failed-turn tails:

- **Delete from this turn onward** removes the selected turn and every later completed turn from the active conversation surface and future model context. It does not delete the whole session.
- **Regenerate** removes the selected turn and later turns, then queues the original user prompt again so the model can answer from that point.

Safety behavior:

- Turn removal is represented by durable replacement tombstones whose provider/model are `dsh-turns-del` / `tombstone`.
- The append-only session event log is preserved; deleted ranges are hidden from the folded surface instead of physically erased from history.
- The host takes the Agent maintenance lease before mutating a live session.
- The implementation validates that each target turn still maps to an independent, contiguous surface span. If the surface has been compacted, mixed with retained history, or already overlaps a deleted range, the action is rejected instead of guessing.
- Sessions are flushed before success is acknowledged.
- Regeneration is refused while the agent is running, while queued user input exists, or when the original prompt is missing, ambiguous, or not plain text.

### Topic quick navigator

Every conversation page gets a right-side **Topics** navigator inspired by `chat.deepseek.com`:

- collapsed state shows a vertical column of flat markers;
- hover/focus opens a fixed-size scrollable panel;
- user prompts are displayed as one-line ellipsized titles;
- full titles are exposed through native tooltips;
- the currently viewed topic is highlighted while scrolling;
- clicking a topic smoothly scrolls to it;
- the navigator hides on narrow screens.

## Files

- `lib/index.js`: host routes, archive/session operations, turn deletion, and regeneration logic.
- `lib/client.js`: web UI slots, modals, topic navigator, turn actions, styles, and locale dictionaries.
- `cordis.patch.yml`: bundle insertion patch for the plugin.
- `README.md` / `README.zh.md`: English and Chinese documentation.

## Notes and limits

- The plugin does not patch DSH core packages.
- Whole-session deletion is disabled while a session is running.
- Turn deletion/regeneration is intentionally conservative and may refuse unsafe or compacted histories.
- Regeneration only replays a single plain-text user prompt from the selected turn.
- Original append-only events remain in the session log even when the active surface no longer shows them.
