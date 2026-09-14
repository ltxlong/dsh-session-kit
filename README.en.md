# dsh-session-kit

![](https://img.shields.io/badge/DeepSeek%20Harness-0.1.5-brightgreen?labelColor=4D6BFE&link=https%3A%2F%2Fgithub.com%2Fdeepseek-ai%2Fdeepseek-harness
) ![](https://badgen.net/npm/dt/dsh-session-kit)

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

## Note

If updating to dsh version 0.1.5 causes a session loading failure error, such as: History loading failed @deepseek-ai/dsh-session-format-v0-to-v1 refuses this format v0 Session, the solution is: 'Session Management' -> 'Repair Session' -> Click the 'Repair' button to fix the current session.

## example

<img width="2518" height="1594" alt="image" src="https://github.com/user-attachments/assets/9833ee58-89c2-4a21-93e6-44cf522907e3" />
<img width="2518" height="1594" alt="image" src="https://github.com/user-attachments/assets/783947f9-9753-42dd-b9ef-10f77d762638" />
<img width="2518" height="1594" alt="image" src="https://github.com/user-attachments/assets/4b68424a-7ddc-4db3-b862-5abd7ee279ae" />
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

The sidebar **Memory** button opens the memory-management dialog. All memory data lives in a local SQLite store at `<profile>/.dsh-session-kit/memory.sqlite` (WAL mode) with no external dependencies; the core logic lives in `lib/memory.js`.

- **Projects (memory_directories)**: memories are grouped per project with a built-in protected `default` project (cannot be renamed or deleted); each project can carry a list of session IDs for which it is auto-enabled.
- **Memories (memories)**: a body plus a status (`active` memories participate in recall / `inactive` memories are archived only); the normalized body is hashed with SHA-256 as a unique key, which inherently prevents duplicate writes.
- **Tags (memory_tags / memory_tag_links)**: 13 preset tags (user profile, user preferences, project profile, project architecture, project constraints, module paths, project scenarios, module constraints, project summary, module summary, API summary, work projects, daily life) plus custom tags, all with instant activation toggles; each memory carries at most 12 tags.
- **Session-project switches (memory_session_directories)**: records which projects each session has enabled.
- **Settings (memory_settings)**: auto-distill toggle, enable default for all sessions, per-turn project auto-matching, distill model override, and the tokenizer version stamp.
- **Activity log (memory_activity_logs)**: an audit trail of memory operations, retained for 7 days.

#### Write paths

Memories enter the store through three independent paths, ending in the persistent tables or the in-memory temporary pool:

**1. Tool writes (agent-initiated)** — the LLM writes through the `memory_add` / `memory_update` tools:

- The plugin validates synchronously and immediately returns `{accepted: true}`; the actual database write runs later in a FIFO background task queue — the tool result reaches the model first, and a failed write never interrupts the conversation (it is logged as a warning plus an activity-log entry, visible on the log page of the memory dialog);
- The target project is resolved by priority: explicit ID > by name (created if missing) > the single project enabled for this session > content-based guessing when several are enabled > fall back to `default`;
- When no tags are provided, the program classifies the body by keyword patterns (8 Chinese regex groups) and falls back to "work projects"; tags are restricted to the preset whitelist so the model cannot invent arbitrary ones.

**2. Manual writes from the UI** — create, edit, delete, and cross-project moves in the memory dialog execute synchronously and are logged; "store" promotes a temporary memory into the persistent tables and removes it from the temporary pool.

**3. Distillation (automatic)** — triggered when a turn ends normally (`turn/end` with reason completed) while auto-distill is on, queued serially per session:

- The full transcript of the turn (user / assistant / tool calls / tool results) is extracted;
- The session's model (or the distill model override from settings, with automatic fallback to the default route) outputs fixed JSON: `{"paths":[…],"symbols":[…],"content":"…"}`; tags are classified by the program from the body and never rely on model output;
- Content involving code, paths, or APIs is wrapped into a structured three-line body (`Location: …` / `Objects: …` / `Content: …`) for later path- and symbol-oriented retrieval;
- Distilled output first lands in the **temporary memory pool** (in memory, not persisted): bodies with the structured three-line format are activated immediately, plain bodies stay deactivated until manually confirmed; duplicates against the persistent store or the pool are merged automatically;
- Temporary memories carry source-session and source-turn metadata, used for cross-session compensation during recall (see below).

#### Recall pipeline

Recall is mounted before every turn request (`agent/pre-step`) and runs automatically with the user input as the query, within a budget of 30s and at most 20 hits.

**Preprocessing**

1. **Per-turn project auto-matching**: the input text is scored against project names and recent memory contents (enabled at ≥8 points); newly matched projects are auto-enabled for the session (at most 3 per turn) and announced at the top of the injected text;
2. **Context deduplication**: memories already present in the context are not injected again (matched both by injected hit IDs and by compressed body comparison).

**Candidate collection**

- Primary path: FTS5 + BM25. Chinese tokenization combines jieba tokens ∪ adjacent CJK bigrams ∪ alphanumeric runs into a derived token column; if jieba fails to load, the pipeline degrades to bigrams only;
- Fallback: when FTS is unavailable or yields nothing, a scored substring scan takes over;
- Supplementary: memories whose custom tag names match query terms enter directly;
- Query profiles: the query is classified by regex into one of six profiles (general / code / scenario / constraint / profile / summary), each with its own tag-weight table;
- Candidate admission (any of three): BM25 hit / custom tag hit / profile tag hit.

**Four-segment selection (v9)**

Candidates are split into a base pool (any tier-1 stable tag: user preferences, user profile, project profile, project architecture, project constraints, module paths) and a regular pool; each segment then competes with its own scoring matrix:

| Segment | Seats | Members | Score components |
|---|---|---|---|
| 1 Base | 5 | Base pool | BM25 + custom tag + profile tag + structure score (tier-1) + recency |
| 2 Temporary | 5 | Temporary pool | BM25 + custom tag + profile tag |
| 3 Mixed | 5 | Base remainder + regular pool | All components (both structure tiers, preventing tag-tier inversion) |
| 4 Fallback | 5–15 | Regular pool remainder | All components except the tier-1 structure score; seats absorb all upstream shortfalls |

When candidates are plentiful, total injection is a constant 20 hits. Component semantics:

- **BM25**: FTS relevance (0–8 points);
- **Custom tag**: exact/partial match between the query and custom tag names (exact 16, partial 7, capped at 28);
- **Profile tag**: tag weight under the detected query profile (capped at 4.5);
- **Structure score** (query-independent identity score): each tier-1 tag adds +5, capped at 20 (4 tags saturate); each tier-2 tag (project scenarios, module constraints, project summary, module summary, API summary) adds +3, capped at 6; the two tiers accumulate independently;
- **Recency decay** (tiered by the memory's tag tier): tier-1 ≤30 days 1.2 / ≤120 days 0.9 / older 0.55 floor (never reaches zero); tier-2 ≤7 days 1.1 → 0.25 floor; non-stable tiers decay to zero beyond 120 days.

Segment 2 is the **invisible-context compensation channel**: recent turns of this session are excluded until they leave the visible window (to avoid duplicating conversation history); only cross-session temporary memories and temporary memories from turns already swallowed by context compaction are admitted — the latter judged against the sequence number of the last compaction event. During packing, entries that no longer fit the character budget are skipped (order-preserving), and oversized memories are truncated with a marker.

**Injection format**

Hits are assembled into a single plugin-sourced user message inserted before the turn's user message: a numbered list (project / tags / update date + body) headed by the rule "when conflicting with the user's latest message, the user's message prevails". A snapshot of the hits (1:1 with the body) is persisted with the session events, powering the per-turn memory panel across restarts.

Each memory entry is limited to 500 characters. (If it exceeds the limit, it will be truncated and you'll be prompted to check the full text using the memory tool)

#### Diff-based ejection

Injected memories do not occupy the context forever. After each normal recall, a top-k semantic diff ejection runs:

- **Judgement**: memories recalled again this turn are kept (stabilizing the context prefix for prompt caching); injected memories that fail to make this turn's top-k are ejected;
- **Persistence**: implemented through durable surface replacements — partially surviving injection rows are rewritten in place to the remaining memories (snapshots trimmed in sync, keeping panel / body / context consistent); fully ejected rows are overwritten with an empty tombstone message and disappear from subsequent model context;
- **Weak-input protection**: weak inputs (short continuations like "continue" or "ok", bare numbers/units/code snippets) make recall unreliable, so such turns skip ejection entirely and never touch the context, preventing accidental ejection of active-topic memories;
- **Multi-step turns**: in-step recall inputs differ from the turn input, so ejection is skipped as well.

#### Memory tools

The plugin registers 5 memory tools for agents:

| Tool | Purpose | Notes |
|---|---|---|
| `memory_add` | Add a long-term memory | Asynchronous background write; use only when the user explicitly asks to remember or the information clearly needs long-term retention |
| `memory_update` | Update body / tags / status / project | Asynchronous background write |
| `memory_stop` | Deactivate a memory | Sets status to inactive: excluded from recall but kept in the store |
| `memory_read` | Read Memory | Read the full text of a memory |
| `memory_search` | Search the memory store on demand | Parses time expressions from the query (today / yesterday / the day before / last N days / this week / last week / this month / last month / exact dates); filters by project / tags / status; default 10 items, max 50 |
| `conversation_search` | Search past conversations across sessions | Scans live and persisted session logs with line-level lexical scoring; subagent sessions are excluded by default |

Repeated `memory_search` / `conversation_search` calls with identical arguments within the same turn are intercepted directly, telling the model to reuse the previous result.

#### Supporting mechanisms

- **FTS index lifecycle**: the tokenization pipeline is recorded as a version stamp in settings; on version changes (e.g. jieba availability switching) or row-count mismatches, a background batched rebuild starts (200 rows per batch, non-blocking, with substring fallback serving recall meanwhile); structural changes such as project renames or tag edits also trigger rebuilds; single-row writes during a rebuild are parked and replayed at finalization.
- **Activity log**: covers all memory adds/updates/deletes, distillation (tool / auto / manual triggers), project and tag operations, and promotions; failures are recorded with a dedicated reason; entries are retained for 7 days and cleaned up once at startup; escaped in-progress activities older than 6 minutes are reaped as failures by a fallback sweep, so the "in progress" list can never get stuck.
- **Recall panel**: each turn can expand a panel showing the memories actually carried in that turn's context (computed by replaying the session log; weak turns naturally inherit the background injection); injected snapshots persist across restarts, and later edits or deletions of memories do not alter past turns.

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

