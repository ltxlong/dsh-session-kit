# dsh-session-kit

English | [中文](README.md)

`dsh-session-kit` is a DeepSeek Harness plugin that adds practical session utilities without patching DSH core code. It extends the conversation page with a session-management menu, archived-session tools, runtime global prompt settings, runtime context compaction config, turn-level cleanup/regeneration actions, local memory management and recall, and a right-side topic navigator.

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

<img width="2518" height="1594" alt="image" src="https://github.com/user-attachments/assets/9833ee58-89c2-4a21-93e6-44cf522907e3" />
<img width="2518" height="1594" alt="image" src="https://github.com/user-attachments/assets/783947f9-9753-42dd-b9ef-10f77d762638" />
<img width="2518" height="1594" alt="image" src="https://github.com/user-attachments/assets/dbccfb91-1215-4617-9e87-6cbd74b89b38" />
<img width="2518" height="1594" alt="image" src="https://github.com/user-attachments/assets/6edb3176-9331-4328-a3dc-9aecf3d2cf01" />

## Features

### Session manager menu

The plugin adds a **Session manager** button to the conversation header. The menu provides:

- **Delete session**: deletes the current stopped session after confirmation. Running sessions are protected and cannot be deleted.
- **Memory manager**: can manage memory items, temporary memory, permanent memory, and memory tags.
- **Call stats**: counts tool calls in the current session and groups them by tool name, including succeeded, failed, and pending calls.
- **Rename**: renames the current session through the official session API.
- **Fork session**: creates a new session from the current one when the current turn is forkable.
- **Archive session**: hides the current session from the sidebar by adding it to the workspace archive list.
- **Open folder**: opens the current session log directory in the system file manager.
- **Export session**: delegates to DSH Session Log export.
- **Global prompt**: configures an optional global system prompt that is injected at runtime; successful saves show a success notice and do not modify official code or config files.
- **Compaction config**: only overrides the current compaction engine at runtime; it does not modify official or preset config files.
- **Open archive**: opens the archived-session management dialog.

### Global prompt

**Session manager → Global prompt** opens the global prompt dialog:

- enable or disable the global prompt;
- edit the global prompt text;
- show a success notice after saving;
- the host registers the prompt into runtime system-prompt assembly through `ctx.systemPrompt.section()`;
- it does not modify official DSH code and does not overwrite the official `system-prompt` config;
- disabling, uninstalling, or not loading the plugin disposes/skips that runtime registration, so the prompt no longer takes effect.

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

### Memory management and recall

The sidebar **Memory** button opens the memory-management dialog, which manages a local SQLite memory store (`<profile>/.dsh-session-kit/memory.sqlite`):

- **Projects**: memories are grouped per project with a built-in `default` project; create/rename/delete projects and configure auto-enabled session IDs per project;
- **Temporary / permanent memories**: each turn distills one temporary memory that stays volatile until explicitly stored; support activate/deactivate, editing, cross-project moves, and deletion;
- **Tags**: preset tags (user profile, project constraints, module paths, ...) plus custom tags with instant activation toggles;
- **Activation ratio**: a donut chart at the bottom of the navigation shows the live active ratio of permanent memories;
- **Recall switches**: auto-distill every turn, enable the default project for all sessions, and auto-match projects on each turn (incremental: only newly matched projects are enabled and announced).

Recall runs automatically on every user turn: jieba + CJK bigram tokenization, FTS5 BM25 relevance ranking, tag-profile weighting, and recency decay; matched memories are injected into the model context per turn, weak turns inherit the previous turn's memories, and a substring scan takes over whenever FTS is unavailable. The index is rebuilt in the background in batches per tokenizer version stamp without blocking startup.

A `memory_search` tool is also provided for agents to search memories on demand, and each turn shows a panel of the memories actually carried in that turn's context. Injected hits are snapshotted into the session log, so the panel survives restarts (including ephemeral-memory hits), and later edits or deletions of memories do not alter past turns.

## Files

- `lib/index.js`: host routes, runtime global prompt registration, archive/session operations, turn deletion, and regeneration logic.
- `lib/client.js`: web UI slots, global-prompt dialog, other modals, topic navigator, turn actions, styles, and locale dictionaries.
- `lib/memory.js`: local memory store (SQLite), jieba/bigram tokenized recall, distillation, and background index rebuild logic.
- `cordis.patch.yml`: bundle insertion patch for the plugin.
- `README.md` / `README.en.md`: Chinese and English documentation.

## Notes and limits

- The plugin does not patch DSH core packages; the global prompt is registered at runtime through `systemPrompt.section()`, and the compaction threshold does not write official or user Agent preset files, so disabling/uninstalling the plugin restores the original DSH system prompt and compaction config.
- The memory store is a local SQLite file (`<profile>/.dsh-session-kit/memory.sqlite`); deleting projects or memories cannot be undone, and uninstalling the plugin does not remove the memory store file.
- Whole-session deletion is disabled while a session is running.
- Turn deletion/regeneration is intentionally conservative and may refuse unsafe or compacted histories.
- Regeneration only replays a single plain-text user prompt from the selected turn.
- Original append-only events remain in the session log even when the active surface no longer shows them.

## License

[MIT](LICENSE)

