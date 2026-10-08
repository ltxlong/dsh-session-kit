# dsh-session-kit

[![](https://img.shields.io/badge/DeepSeek%20Harness->=0.2.0-brightgreen?labelColor=4D6BFE)](https://github.com/deepseek-ai/deepseek-harness) [![](https://badgen.net/npm/dt/dsh-session-kit)](https://www.npmjs.com/package/dsh-session-kit)

English | [中文](README.md)

`dsh-session-kit` is a DeepSeek Harness plugin that adds practical session utilities without patching DSH core code. It extends the conversation page with a session-management menu, archived-session tools, task management and task archives, runtime global prompt settings, runtime context compaction config, turn-level cleanup/regeneration actions, local memory management and recall, and a left-right-side topic navigator.

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

<img width="2518" height="1594" alt="image" src="https://github.com/user-attachments/assets/ffe483c4-08d2-4a1b-af51-c0694d323670" />
<img width="2518" height="1594" alt="image" src="https://github.com/user-attachments/assets/9009088c-24f1-4b71-af21-320f2d8571fb" />
<img width="2518" height="1594" alt="image" src="https://github.com/user-attachments/assets/4b68424a-7ddc-4db3-b862-5abd7ee279ae" />
<img width="2518" height="1594" alt="image" src="https://github.com/user-attachments/assets/8fca256c-8a6e-4820-a026-00fc013264d7" />
<img width="2518" height="1594" alt="image" src="https://github.com/user-attachments/assets/66843588-d7d2-4e15-b2e2-896560ad953e" />
<img width="2518" height="1594" alt="image" src="https://github.com/user-attachments/assets/6edb3176-9331-4328-a3dc-9aecf3d2cf01" />
<img width="2518" height="1594" alt="image" src="https://github.com/user-attachments/assets/6dc222a0-f432-4c93-a132-6886c98aeb33" />

## Features

### Session manager menu

The plugin adds a **Session manager** button to the conversation header. The menu provides:

* **Delete session**: deletes the current stopped session after confirmation. Running sessions are protected and cannot be deleted.
* **Memory manager**: can manage memory items, temporary memory, permanent memory, and memory tags.
* **Task manager**: view, create, extract, inject, and maintain task archives.
* **Call stats**: counts tool calls in the current session and groups them by tool name, including succeeded, failed, and pending calls.
* **Rename**: renames the current session through the official session API.
* **Fork session**: creates a new session from the current one when the current turn is forkable.
* **Archive session**: hides the current session from the sidebar by adding it to the workspace archive list.
* **Open folder**: opens the current session log directory in the system file manager.
* **Export session**: delegates to DSH Session Log export.
* **Global prompt**: configures an optional global system prompt that is injected at runtime; successful saves show a success notice and do not modify official code or config files.
* **Compaction config**: only overrides the current compaction engine at runtime; it does not modify official or preset config files.
* **Open archive**: opens the archived-session management dialog.

### Task management and task archives

Task management records a task end to end: subtasks, tool operations, observed files, pitfalls, and participating sessions. It shares one local SQLite database with memory management (default `<profile>/.dsh-session-kit/memory.sqlite`, following the memory storage directory setting).

#### Task statuses

Task progress and trash lifecycle are separate dimensions. There are five task statuses:

|Status|Meaning|
|-|-|
|`not_started`|Not started|
|`active`|In progress|
|`paused`|Paused|
|`completed`|Completed|
|`abandoned`|Abandoned|

Trash is not a task status. It is represented by `deleted_at`. Trashed tasks are excluded from the All tab, its status chart, and automatic hints.

#### Automatic recognition and synchronization

* The plugin listens to `todo/write`, `tool/call`, `tool/result`, `turn/end`, and file-observation events.
* When a session has no task binding, the first useful `todo/write` automatically creates a task and records the project derived from the session working directory.
* Todo entries are matched to existing subtasks using content, name, and ordinal as fallbacks; historical subtasks that disappear from a later Todo snapshot are retained so recorded operations are not lost.
* A task becomes `completed` automatically when all of its subtasks are completed; manual states such as `paused` and `abandoned` are not overwritten by automatic derivation.
* Tool calls, results, and file observations follow the task captured when the tool call was created, preventing late results from contaminating another task after a session switches tasks.

#### Automatic hints and full injection

Before each turn, the plugin can hint at most two already-engaged `active` tasks for the current session. The automatic hint contains only the task name, project, progress, and known pitfalls; **the full task archive is not automatically injected into context**.

When the model determines that the current request belongs to a task, it can call `task_inject`. The user can also click **Inject into current session** on a task card. The full archive is appended as a plugin-sourced user message and the task/session association is updated. Injecting another task switches the active task attribution for subsequent events.

#### Manual creation and extraction

* **New task** does not automatically bind to the current session; association begins when the task is injected or receives real task events.
* **Extract current session task** reads the latest non-empty Todo snapshot. A same-name task is reused only when its project or working directory matches and it is not in trash; a same-name task from another project creates a new archive.
* Missing session, event, or usable Todo data produces a specific reason; closed or archived sessions are read from persisted events when available.

#### Trash

Normal deletion moves a task to trash instead of immediately erasing its archive. Subtasks, operations, and pitfalls are retained:

* the delete confirmation says the task is purged automatically after 30 days;
* trash supports search, pagination, restore, and permanent deletion;
* restoring a task that was `active` changes it to `paused` so it does not resume automatically; other statuses are preserved;
* trashed tasks cannot be edited or injected and do not participate in automatic recognition or hints;
* the Task manager's All statistics exclude trashed tasks.

### Global prompt

**Session manager → Global prompt** opens the global prompt dialog:

* enable or disable the global prompt;
* edit the global prompt text;
* show a success notice after saving;
* the host registers the prompt into runtime system-prompt assembly through `ctx.systemPrompt.section()`;
* it does not modify official DSH code and does not overwrite the official `system-prompt` config;
* disabling, uninstalling, or not loading the plugin disposes/skips that runtime registration, so the prompt no longer takes effect.

### Archived-session manager

The archive dialog manages sessions that are archived/hidden from the sidebar:

* search archived sessions by title;
* preview archived session content in a modal without restoring it;
* show tool-call statistics in the preview;
* load preview messages incrementally;
* continue an archived session in a new chat by forking it;
* restore archived sessions back to the session list;
* open an archived session folder;
* delete archived sessions after confirmation.

Deletion uses the operating system trash on Windows/macOS. On platforms without a system trash integration, the session directory is removed directly. Running archived sessions are not deleted.

### Turn cleanup and regeneration

The plugin adds actions next to completed top-level assistant turns and supported failed-turn tails:

* **Delete from this turn onward** removes the selected turn and every later completed turn from the active conversation surface and future model context. It does not delete the whole session.
* **Regenerate** removes the selected turn and later turns, then queues the original user prompt again so the model can answer from that point.

Safety behavior:

* Turn removal is represented by durable replacement tombstones whose provider/model are `dsh-turns-del` / `tombstone`.
* The append-only session event log is preserved; deleted ranges are hidden from the folded surface instead of physically erased from history.
* The host takes the Agent maintenance lease before mutating a live session.
* The implementation validates that each target turn still maps to an independent, contiguous surface span. If the surface has been compacted, mixed with retained history, or already overlaps a deleted range, the action is rejected instead of guessing.
* Sessions are flushed before success is acknowledged.
* Regeneration is refused while the agent is running, while queued user input exists, or when the original prompt is missing, ambiguous, or not plain text.

### Topic quick navigator

Every conversation page gets a right-side **Topics** navigator inspired by `chat.deepseek.com`:

* collapsed state shows a vertical column of flat markers;
* hover/focus opens a fixed-size scrollable panel;
* user prompts are displayed as one-line ellipsized titles;
* full titles are exposed through native tooltips;
* the currently viewed topic is highlighted while scrolling;
* clicking a topic smoothly scrolls to it;
* the navigator hides on narrow screens.

### Memory management and recall

The sidebar **Memory** button opens the memory-management dialog. All memory data lives in a local SQLite store (WAL mode) with no external dependencies; the core logic lives in `lib/memory.js`. The default location is `<profile>/.dsh-session-kit/memory.sqlite`, and the settings page can switch it to any absolute custom directory (stored in the storage domain; a restart is required for the change to take effect).

* **Projects (memory_directories)**: memories are grouped per project with a built-in protected `default` project (cannot be renamed or deleted); each project can carry a list of session IDs for which it is auto-enabled.
* **Memories (memories)**: a body plus a status (`active` memories participate in recall / `inactive` memories are archived only); the normalized body is hashed with SHA-256 as a unique key, which inherently prevents duplicate writes; the `pinned` flag marks fixed recall; `event_time` / `valid_until` are optional fact times (see "Fact times" below).
* **Tags (memory_tags / memory_tag_links)**: 16 preset tags (user profile, user preferences, project profile, project architecture, project constraints, module paths, project scenarios, module constraints, project summary, module summary, API summary, interface constraints, troubleshooting records, decision records, work projects, daily life) plus custom tags, all with instant activation toggles; each memory carries at most 12 tags. Custom tags are the source of the `customTag` recall weight.
* **Session-project switches (memory_session_directories)**: records which projects each session has enabled.
* **Settings (memory_settings)**: auto-distill toggle, enable default for all sessions, per-turn project auto-matching, distill model override, recall mode and four-segment quotas, the tokenizer version stamp, and the embedding switch plus provider configuration.
* **Activity log (memory_activity_logs)**: an audit trail of memory operations, retained for 7 days.
* **Revision history (memory_revisions)**: old body snapshots are kept automatically when a memory is rewritten, and can be reviewed, restored, or deleted.
* **Relation edges (memory_edges / memory_edge_keys)**: associations between memories derived from the `位置`/`对象` fields of structured bodies (with an inverted key table for fast lookup), queried by `memory_relate`.
* **Memory vectors (memory_embeddings)**: optional semantic-search vectors, kept in their own table so the 4KB-per-row BLOBs never slow down ordinary queries.

#### Write paths

Memories enter the store through three independent paths, ending in the persistent tables or the in-memory temporary pool:

**1. Tool writes (agent-initiated)** — the LLM writes through the `memory_add` / `memory_update` tools:

* The plugin validates synchronously and immediately returns `{accepted: true}`; the actual database write runs later in a FIFO background task queue — the tool result reaches the model first, and a failed write never interrupts the conversation (it is logged as a warning plus an activity-log entry, visible on the log page of the memory dialog);
* The target project is resolved by priority: explicit ID > by name (created if missing) > the single project enabled for this session > content-based guessing when several are enabled > fall back to `default`;
* **Conflict adjudication before writing**: the program first searches the same project for similar existing memories (top 3) and, when candidates exist, asks the model to judge the relation — `update` rewrites an existing memory (keeping a revision automatically), `skip` treats the new body as semantically equivalent and adds nothing, and `add` proceeds with a new memory. When adjudication fails or finds no candidate it falls back to `add`, recording the missed reason in the activity log so you can later tell why that add was not deduplicated;
* Tags have three levels of precedence: tags given explicitly by the model > the fallback used when the user explicitly asked to remember (user preferences) > automatic keyword classification (Chinese regex), falling back to "work projects". Preset tags must match the whitelist so the model cannot invent plausible-looking stable tags, while descriptive tags are stored as custom tags with no whitelist filtering.

**2. Manual writes from the UI** — create, edit, delete, and cross-project moves in the memory dialog execute synchronously and are logged; "store" promotes a temporary memory into the persistent tables and removes it from the temporary pool.

**3. Distillation (automatic)** — triggered when a turn ends normally (`turn/end` with reason completed) while auto-distill is on, queued serially per session:

* The transcript of the turn is extracted (user / assistant / tool-call requests, **excluding tool result bodies**), together with path candidates (files read or written, grep targets) and symbol candidates (symbols found by grep, annotated with definition/call cues) offered to the model as references;
* The session's model (or the distill model override from settings, with automatic fallback to the default route) outputs fixed JSON: `{"位置":\[…],"对象":\[…],"内容":"…","踩坑":"…","tags":\[…],"eventTime":"…","validUntil":"…"}`; the English aliases `paths` / `symbols` / `content` / `pitfall` / `tags` / `event_time` / `valid_until` are also accepted. Tags follow the two-stage scheme (1-2 descriptive tags first, then mapped onto stable tags); the program only cleans and tiers them and never overrides the model's result. `eventTime` / `validUntil` are emitted only when the turn contains an explicit date or deadline, with relative expressions converted into concrete dates; otherwise the fields are omitted entirely (not null or empty). A failed parse drops that field rather than rejecting the whole memory;
* Content involving code, paths, or APIs is stored as the structured JSON format; paths and symbols are string arrays, content and pitfall may contain newlines, and unknown fields are preserved for future extension;
* Distilled output first lands in the **temporary memory pool** (in memory, not persisted), always created as `active`; duplicates against the persistent store or the pool are merged automatically (an identical entry in the pool only refreshes its timestamp and source turn instead of being added again);
* Only `text` blocks count as the distillation result, with **no fallback to `reasoning`** (otherwise reasoning drafts would be stored as memory bodies); a turn with no usable output is skipped and logged;
* Temporary memories carry source-session and source-turn metadata, used for cross-session compensation during recall (see below).

#### Recall pipeline

Recall is mounted before every turn request (`agent/pre-step`) and runs automatically with the user input as the query, within a budget of 30s. The default is up to 20 hits; you can also exclude temporary memories with a 15-hit total or use a custom total from 8 to 20. In custom mode, segment 1 is 3-5, segment 2 is 0-5, segment 3 is 0-5, and segment 4 is calculated as total minus segments 1-3 with a minimum of 3; segment 2 is forced to 0 when the total is at most 15, segment 3 is forced to 0 when the total is at most 10, and the four quotas always add up to the maximum.

**Preprocessing**

1. **Per-turn project auto-matching**: the input text is scored against project names and recent memory contents (enabled at ≥8 points); newly matched projects are auto-enabled for the session (at most 3 per turn) and announced at the top of the injected text;
2. **Context deduplication**: memories already present in the context are not injected again (matched both by injected hit IDs and by compressed body comparison).

**Candidate collection**

* Primary path: FTS5 + BM25. Chinese tokenization combines jieba tokens ∪ adjacent CJK bigrams ∪ alphanumeric runs into a derived token column; if jieba fails to load, the pipeline degrades to bigrams only;
* Fallback: when FTS is unavailable or yields nothing, a scored substring scan takes over;
* Supplementary: memories whose custom tag names match query terms enter directly;
* Base-pool direct read: memories carrying a tier-1 stable tag are pulled in by tag name without FTS or relevance admission;
* Vector channel (optional, off by default): cosine similarity between the query vector and stored vectors, dropping any candidate below 0.65. That threshold only governs whether the vector becomes a *candidate*; it is separate from the vector gate described below;
* Query profiles: the query is classified by regex into one of six profiles (general / code / scenario / constraint / profile / summary), each with its own tag-weight table;
* Candidate admission (any of three): BM25 hit / custom tag hit / profile tag hit.

**Four-segment selection**

Candidates are split into a base pool (any tier-1 stable tag: user preferences, user profile, project profile, project architecture, project constraints, module paths) and a regular pool; each segment then selects with its own ranking and admission rules:

|Segment|Seats|Members|Ranking and admission|
|-|-|-|-|
|1 Base|Default 5; custom 3-5|Base pool|**RRF ranking** (lexical + vector + tag lists); admission keeps the three-way relevance rule, and remaining seats are filled tag by tag in priority order. The **vector gate applies, the BM25 floor does not** — segment 1 is the identity channel, whose members are largely query-independent, so their BM25 scores are naturally low and a lexical floor would wipe the identity floor out|
|2 Temporary|Default 5; excluded mode 0; custom 0-5|Temporary pool|Keeps the v9 additive matrix (BM25 + custom tag + profile tag). Temporary memories are never persisted, carry no vectors, and their tags are always preset ones, so only the lexical list exists and RRF would degenerate to lexical order anyway|
|3 Mixed|Default 5; custom 0-5|Base remainder + regular pool|**RRF ranking**; admission = **BM25 ≥ 6 AND cosine ≥ 0.30** (both must pass)|
|4 Fallback|Calculated, minimum 3|Regular pool remainder|**RRF ranking**; admission same as segment 3; absorbs upstream shortages naturally|

The two admission gates for segments 3/4 (added in v10 — previously these two segments only competed inside their pools with no admission rule at all, so weakly-matching candidates still took seats):

* **BM25 floor (lexical)**: `bm25Weight ≥ 6` on the 0–8 scale (the "strong match" line). It only applies to rows that actually carry FTS information; rows without an FTS hit are left to the vector gate;
* **Vector gate (semantic)**: cosine similarity `≥ 0.30`. A candidate must pass both gates to take a seat in segment 3 or 4;
* **Degradation safety**: when embeddings are off, fail to initialize, a memory has no vector yet, or a score is malformed, the vector gate **admits everything** (better to over-admit than to block all). The BM25 floor is independent of embeddings and always applies.

RRF (Reciprocal Rank Fusion) fuses the three ranked lists by position only, never by raw score, so no manual weighting across incompatible scales is needed:

* Three lists: lexical (BM25 weight), vector (cosine), and custom-tag match strength (weight 0.5, as a supporting signal);
* Smoothing constant `k = 10`: RRF accumulates `1/(k + rank)` per list, so `k` only sets how strongly a top rank is favoured (smaller `k` favours the head, larger `k` flattens rank differences). It **never changes the order within a list**;
* Identity and recency scores become a **±10% multiplicative boost** — they nudge positions but can never override relevance consensus;
* With embeddings off, the vector list is simply empty and RRF degrades to a two-list lexical + tag fusion; ranking still works.

Component semantics:

* **BM25**: FTS relevance (0–8 points);
* **Custom tag**: exact/partial match between the query and custom tag names (exact 16, partial 7, capped at 28);
* **Profile tag**: tag weight under the detected query profile (capped at 4.5);
* **Structure score** (query-independent identity score): each tier-1 tag adds +5, capped at 20 (4 tags saturate); each tier-2 tag (project scenarios, module constraints, project summary, module summary, API summary, interface constraints, decision records) adds +3, capped at 6; the two tiers accumulate independently. The tier switches automatically with vector availability: the full values apply when vectors are unavailable (structure alone carries identity ranking), and drop to +2 / cap 8 once vectors work, handing the say back to query-relevance signals;
* **Vector**: cosine similarity. In segment 2's additive matrix it maps to 0–10 points (the same order of magnitude as BM25, below custom tags); segments 1/3/4 now use RRF, where cosine contributes as a *rank* and additionally serves as the gate for those segments;
* **Recency decay** (tiered by the memory's tag tier): tier-1 ≤30 days 1.2 / ≤120 days 0.9 / older 0.55 floor (never reaches zero); tier-2 ≤7 days 1.1 → 0.25 floor; non-stable tiers decay to zero beyond 120 days.

Segment 2 is the **invisible-context compensation channel**: recent turns of this session are excluded until they leave the visible window (to avoid duplicating conversation history); only cross-session temporary memories and temporary memories from turns already swallowed by context compaction are admitted — the latter judged against the sequence number of the last compaction event. During packing, entries that no longer fit the character budget are skipped (order-preserving), and oversized memories are truncated with a marker.

**Fact times (event time / valid until)**

A memory carries two kinds of time with different meanings; neither replaces the other:

* **Record time** (`created_at` / `updated_at`): when this memory was written and last changed;
* **Fact time** (`event_time` / `valid_until`): when the described fact happened or took effect, and when it is expected to stop holding.

* **Event time `event_time`** separates "when the fact happened" from "when the record was written". Delayed writes ("deployed v2 last Friday", recorded today) and revision noise (fixing a typo refreshes record time) both push record time away from the event, while event time does not move;
* **Valid until `valid_until`** lets memories such as "temporary workaround" or "valid this week" expire naturally. Once past, the memory is down-weighted in the four-segment ranking (multiplicative 0.5) and marked "expired" in both the injection text and the card — **down-weighted, never ejected**: it is a historical conclusion rather than noise, and remains the answer when asked "why was it decided that way";
* **Both columns are nullable**: empty means undeclared, and the whole pipeline then behaves exactly as before the field existed (no migration cost for existing memories; the read side treats them as "no fact time"). Times are interpreted in the local time zone and accept two precisions — `YYYY-MM-DD` (date-only: event time means the start of that day, valid until means 23:59:59 of that day) and `YYYY-MM-DD HH:MM` (minute precision: expiry happens at the exact given moment); expiry is judged against the current time. **Display precision follows the value**: whole-day values show only the date (`2026-09-29`), values with a declared clock show minutes too (`2026-09-29 14:30`) — so "it happened that day" is never rendered as "it happened at midnight";
* **Where values come from**: ① the model passes them explicitly to `memory_add` / `memory_update`; ② distillation extracts them when that turn contains an explicit date or deadline (relative expressions are converted into concrete dates; with no explicit time the fields are omitted entirely; the aliases `事件时间` / `失效时间` are recognized alongside `eventTime` / `validUntil`); ③ when conflict adjudication decides that a new memory supersedes an old one, the old memory automatically gets a valid-until — preferring the new memory's event time and falling back to the new memory's write time when it has none (a state-typed new memory has no event time, and the write time is the conservative bound of "the old fact no longer held by at least this moment"). An earlier valid-until already present is never pushed later;
* **Write validation**: malformed dates (such as 2026-02-30), out-of-range years, and a valid-until earlier than the event time are all rejected; passing an empty string to `memory_update` clears the field, while omitting it keeps the current value.

**Time search**: `memory_search` time-range filtering matches all four columns — both record times and both fact times — and hits when any of them falls inside the window. Searching "what happened last Friday" therefore finds a memory about that day even though it was recorded today, and searching "expiring at the end of this month" finds memories carrying a valid-until. Memories without fact times behave exactly as before.

**Fixed recall**

Each permanent memory has a 'fixed injection' switch. Once turned on, as long as the project that memory belongs to is activated in a session, that memory is guaranteed to be recalled. A fixed memory is still an ordinary memory: it competes in the four segments as usual without taking extra seats, and only those that miss every candidate channel are merged in after the four-segment selection. As a result the final injection may exceed the recall limit, which constrains the four-segment selection rather than the final count. Fixed memories are listed first so the model reads them early.

**Injection format**

Hits are assembled into a single plugin-sourced user message inserted before the turn's user message: a numbered list (project / tags / update date + body) headed by the rule "when conflicting with the user's latest message, the user's message prevails", with fixed-recall entries additionally tagged 【固定召回】. When fact times are declared, "Event: …; valid until: …" follows the update date, and a past valid-until is marked "(expired)". A snapshot of the hits (1:1 with the body) is persisted with the session events, powering the per-turn memory panel across restarts.

For structured memories, only the `content` field is limited to 500 characters during injection; paths, symbols, pitfall, and unknown fields are preserved. When it exceeds the limit, `content` is truncated and a marker is appended: "this memory is truncated · id: … · call the memory_read tool for the full text".

Beyond automatic recall, you can also inject a specific memory into the current session by hand from the memory dialog (through a separate source kind that bypasses recall and ejection), useful for putting one memory in front of the model temporarily.

#### Diff-based ejection

Injected memories do not occupy the context forever. After each normal recall, a top-k semantic diff ejection runs:

* **Judgement**: memories recalled again this turn are kept (stabilizing the context prefix for prompt caching); injected memories that fail to make this turn's top-k are ejected;
* **Persistence**: implemented through durable surface replacements — partially surviving injection rows are rewritten in place to the remaining memories (snapshots trimmed in sync, keeping panel / body / context consistent); fully ejected rows are overwritten with an empty tombstone message and disappear from subsequent model context;
* **Weak-input protection**: weak inputs (short continuations like "continue" or "ok", bare numbers/units/code snippets) make recall unreliable, so such turns skip ejection entirely and never touch the context, preventing accidental ejection of active-topic memories;
* **Multi-step turns**: in-step recall inputs differ from the turn input, so ejection is skipped as well.

#### Memory tools

The plugin registers 7 memory tools for agents:

|Tool|Purpose|Notes|
|-|-|-|
|`memory_add`|Add a long-term memory|Background write with conflict adjudication and hash dedup; use only when the user explicitly asks to remember or the information clearly needs long-term retention. Optional event time / valid until may be passed (see "Fact times")|
|`memory_update`|Update body / tags / status / project|Background write; can toggle fixed recall, and rewriting the body keeps a revision automatically; can set or clear the event time and valid until (omit to keep, empty string to clear)|
|`memory_stop`|Deactivate a memory|Sets status to inactive: excluded from recall but kept in the store|
|`memory_read`|Read Memory|Read the full text of a memory|
|`memory_search`|Search the memory store on demand|Parses time expressions from the query (today / yesterday / the day before / last N days / this week / last week / this month / last month / exact dates); the time window matches record times and fact times alike; filters by project / tags / status; default 10 items, max 50; results are rendered as related clusters built from relation edges|
|`memory_relate`|Explore structural links between memories|Starting from one memory, follows shared file paths / symbols to related memories (1 hop by default, up to 2); takes either `memoryId` or `query`. Complements `memory_search`: search matches by wording, relate matches by shared files or symbols|
|`conversation_search`|Search past conversations across sessions|Scans live and persisted session logs with line-level lexical scoring; subagent sessions are excluded by default|

Repeated `memory_search` / `conversation_search` calls with identical arguments within the same turn are intercepted directly, telling the model to reuse the previous result.

#### Supporting mechanisms

* **FTS index lifecycle**: the tokenization pipeline is recorded as a version stamp in settings; on version changes (e.g. jieba availability switching) or row-count mismatches, a background batched rebuild starts (200 rows per batch, non-blocking, with substring fallback serving recall meanwhile); structural changes such as project renames or tag edits also trigger rebuilds; single-row writes during a rebuild are parked and replayed at finalization.
* **Relation-edge lifecycle**: writing a memory extracts keys from its structured body (file paths normalized to lowercase, symbols lowercased), registers them in the inverted key table, and links edges both ways; stores of at most 1000 memories rebuild synchronously at startup, larger ones rebuild in the background (200 rows per batch), and `memory_relate` reports a clear degradation while a rebuild runs. Tag edges are off by default (tag edges far outnumber structural ones and would drown them out) and can be enabled in settings.
* **Vector backfill**: once embedding search is enabled, memories missing a vector are backfilled in the background (128 per batch) without blocking startup, with recall using pure lexical matching meanwhile; changing the model or dimensions keeps old vectors in place and recomputes through the model fingerprint, so an interrupted backfill resumes on the next start. The embedding input fingerprint covers tags and project name too — comparing the body hash alone would miss "body unchanged but tags changed".
* **Activity log**: covers all memory adds/updates/deletes, distillation (tool / auto / manual triggers), project and tag operations, and promotions; failures are recorded with a dedicated reason; entries are retained for 7 days and cleaned up once at startup; escaped in-progress activities older than 6 minutes are reaped as failures by a fallback sweep, so the "in progress" list can never get stuck.
* **Revision history**: rewriting a memory body automatically keeps the previous snapshot (including status and replacement origin), which can be reviewed, restored, or deleted per memory; each memory keeps a bounded number of revisions (50 by default, evicting the oldest beyond that).
* **Recall panel**: each turn can expand a panel showing the memories actually carried in that turn's context (computed by replaying the session log; weak turns naturally inherit the background injection); injected snapshots persist across restarts, and later edits or deletions of memories do not alter past turns. The panel also marks whether an entry was newly recalled this turn or already present last turn, and which segment it came from.
* **Session "Memory" view**: a new Memory tab in the conversation view shows this session's injections in three columns (fixed / automatic / manual), with a donut chart of the latest turn's composition (fixed vs automatic share) and keyword filtering. It shares the recall panel's data source (the same session-log replay), so it recomputes fully after a restart with no extra storage. The tab can be hidden in settings.

## Files

* `lib/index.js`: host routes, runtime global prompt registration, archive/session operations, turn deletion, and regeneration logic.
* `lib/client.js`: web UI slots, global-prompt dialog, other modals, topic navigator, turn actions, styles, and locale dictionaries.
* `lib/memory.js`: local memory store (SQLite), jieba/bigram tokenized recall, distillation, and background index rebuild logic.
* `lib/task.js`: task archive capture, status synchronization, task tools, automatic hints, injection, extraction, and trash routes.
* `cordis.patch.yml`: bundle insertion patch for the plugin.
* `README.md` / `README.en.md`: Chinese and English documentation.

## Notes and limits

* The plugin does not patch DSH core packages; the global prompt is registered at runtime through `systemPrompt.section()`, and the compaction threshold does not write official or user Agent preset files, so disabling/uninstalling the plugin restores the original DSH system prompt and compaction config.
* The memory store is a local SQLite file (default `<profile>/.dsh-session-kit/memory.sqlite`, configurable to a custom directory in settings); deleting projects or memories cannot be undone (rewriting a body keeps a revision, deleting a memory does not), and uninstalling the plugin does not remove the memory store file.
* Whole-session deletion is disabled while a session is running.
* Turn deletion/regeneration is intentionally conservative and may refuse unsafe or compacted histories.
* Regeneration only replays a single plain-text user prompt from the selected turn.
* Original append-only events remain in the session log even when the active surface no longer shows them.

## License

[MIT](LICENSE)
