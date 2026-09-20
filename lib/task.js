/**
 * dsh-session-kit · 任务档案
 *
 * 把任务全过程信息实时落盘到 sqlite，使其免疫跨会话边界与上下文压缩。
 * 设计文档：dsh-session-kit-任务档案方案.md
 *
 * 分层：
 *   · 归因引擎（纯函数，不碰 db）—— resolveItem / applyTodoWrite / attributeOperation
 *   · 采集接线 —— session/event、fs/observed、tools/post-execute 等
 *   · 读取工具 —— task_list / task_view / task_detail
 *   · 注入 —— task_inject + pre-step 提示
 *   · HTTP 路由 —— 供客户端弹窗
 *
 * 关键约束（详见设计文档）：
 *   · 实时捕获，不事后重放（tool/result 是可被压缩覆盖的可变 surface）
 *   · call_id 为幂等键，一切明细 upsert
 *   · 单事务写入（BEGIN IMMEDIATE ... COMMIT），不设事件缓冲表
 *   · 纯 CREATE TABLE IF NOT EXISTS，无迁移
 *   · 不设置任何连接级 PRAGMA（由 memory.js 负责）
 */

import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { defineTool } from '@deepseek-ai/dsh-tools';

export const TASKS_ROUTE = '/dsh-session-kit/tasks';
const PLUGIN_NAME = 'dsh-session-kit';
const TASK_ITEM_STATUSES = new Set(['pending', 'in_progress', 'completed', 'blocked', 'aborted']);
const TASK_STATUSES = new Set(['not_started', 'active', 'paused', 'completed', 'abandoned']);

/* 任务附加信息（summary）的字符上限，写入与前端输入框保持一致。 */
const TASK_SUMMARY_MAX_LENGTH = 5000;

/* 手动新建任务时可通过弹窗一次性录入的子任务上限。 */
const MANUAL_TASK_ITEM_LIMIT = 50;

/* 符号提取过滤：语言关键字与常见噪音标识符，避免污染「对象」字段。 */
const SYMBOL_STOP_WORDS = new Set([
  'If', 'Else', 'For', 'While', 'Switch', 'Case', 'Return', 'Function', 'Class', 'Const', 'Let', 'Var',
  'New', 'This', 'Null', 'True', 'False', 'Undefined', 'Async', 'Await', 'Try', 'Catch', 'Finally',
  'JSON', 'API', 'UI', 'CSS', 'HTML', 'HTTP', 'URL', 'SQL', 'ID', 'OK', 'NaN', 'Object', 'Array',
  'String', 'Number', 'Boolean', 'Promise', 'Error', 'Map', 'Set', 'Date', 'Math', 'RegExp',
  'React', 'Node', 'Test', 'Todo', 'TODO', 'NOTE', 'FIXME'
].map((word) => word.toLowerCase()));

/* 判断是否为应忽略的关键字/噪音词（大小写不敏感）。 */
function isSymbolStopWord(value) {
  return SYMBOL_STOP_WORDS.has(String(value ?? '').toLowerCase());
}

/* 库/宿主对象的方法调用前缀，如 react.createElement、console.log、Math.max，不属于「对象」。
   比较时统一小写，故此处全部以小写登记。 */
const SYMBOL_OWNER_STOP_WORDS = new Set([
  'react', 'reactdom', 'console', 'window', 'document', 'primitives', 'props', 'this', 'super',
  'math', 'json', 'object', 'array', 'string', 'number', 'boolean', 'promise', 'date', 'regexp',
  'process', 'buffer', 'fs', 'path', 'ctx', 't'
]);

/* 代码类扩展名：只有这些文件才从正文提取「对象」符号。
   非代码文件（.md/.txt/.csv/.json/.yml/.sql 等）不提取，避免把英文单词、数据值当符号。 */
const CODE_FILE_EXTENSIONS = new Set([
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts',
  'vue', 'svelte', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'styl',
  'py', 'rb', 'php', 'java', 'kt', 'kts', 'scala', 'groovy',
  'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'cs', 'go', 'rs', 'swift', 'm', 'mm',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'bat', 'cmd',
  'lua', 'pl', 'r', 'jl', 'dart', 'ex', 'exs', 'erl', 'hs', 'clj', 'el', 'vim'
]);

/**
 * 从对象的原始值里筛出「真正的符号名」，用于注入文本。
 * 背景：objects 的语义曾把文件路径/命令当对象（旧数据 67 条里 48 条如此），
 * 这类值与 content 重复，注入时展示纯属冗余。此处只保留像符号名的项。
 * @param {unknown} value 数据库里的 objects（JSON 字符串或数组）
 * @returns {string[]} 可直接展示的符号名
 */
function injectionSymbols(value) {
  const list = Array.isArray(value) ? value : (safeJsonParse(value, []) ?? []);
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const entry of list) {
    const symbol = String(entry ?? '').trim();
    if (symbol.length < 2 || symbol.length > 80) continue;
    /* 含路径分隔符、盘符、常见命令片段的一律视为「位置」而非「对象」。 */
    if (/[\\/]/.test(symbol)) continue;
    if (/^[A-Za-z]:$/.test(symbol)) continue;
    if (/\s/u.test(symbol)) continue;
    /* 工具参数名（旧 default 分支曾把参数键当对象：taskId / todos / description 等）。 */
    if (TOOL_ARGUMENT_NAMES.has(symbol)) continue;
    /* 常见 shell / PowerShell 命令与 cmdlet（旧 exec 分支曾把命令当对象）。 */
    if (/^(cd|pwd|ls|dir|cat|echo|node|npm|npx|git|curl|mkdir|rm|cp|mv|touch)$/i.test(symbol)) continue;
    if (/^(Get|Set|New|Remove|Select|Where|ForEach|Write|Read|Test|Start|Stop|Invoke)-/i.test(symbol)) continue;
    if (isSymbolStopWord(symbol)) continue;
    out.push(symbol);
    if (out.length >= 4) break;
  }
  return out;
}

/* 工具参数名：旧数据的 objects 里混入了这些（default 分支曾把参数键当对象），
   它们不是「对象」而是工具的入参名，注入时展示无定位价值。 */
const TOOL_ARGUMENT_NAMES = new Set([
  'taskId', 'itemId', 'sessionId', 'callId', 'id', 'name', 'text', 'content', 'body',
  'todos', 'status', 'itemStatus', 'note', 'summary', 'revision', 'paths', 'symbols',
  'description', 'prompt', 'subagent_type', 'run_in_background', 'file_path', 'old_string',
  'new_string', 'command', 'pattern', 'path', 'query', 'limit', 'offset', 'include', 'kinds',
  'sinceSeq', 'taskName', 'directoryName', 'directoryId', 'tags', 'memoryId', 'action'
]);

/* ────────────────────────────── 工具 ────────────────────────────── */

/**
 * 是否按代码文件处理（决定要不要从正文提取「对象」符号）。
 * 仅代码类文件才做符号提取：非代码内容（Markdown/CSV/SQL/纯文本等）里，
 * 「首字母大写」只是普通英文单词或数据值，提取出来全是噪音。
 * @param {string} filePath
 */
function isCodeFile(filePath) {
  const path = String(filePath ?? '');
  const match = path.match(/\.([A-Za-z0-9]+)$/u);
  if (match === null) return false;
  return CODE_FILE_EXTENSIONS.has(match[1].toLowerCase());
}

function now() {
  return Date.now();
}

function safeText(value, max = 1000) {
  if (value === undefined || value === null) return '';
  const text = String(value);
  return text.length > max ? text.slice(0, max) : text;
}

function safeJsonParse(text, fallback) {
  if (typeof text !== 'string' || text.length === 0) return fallback;
  try {
    const value = JSON.parse(text);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 内容指纹：用于 todo 条目在整表替换下的身份识别。
    算法与 memory.js 的记忆指纹、index.js 的 repair id 保持同族（sha256 截断 16 位），
    全插件唯一实现点——手工建档与 todo 采集都必须经此函数，不得各自内联 createHash。 */
function contentHashOf(text) {
  return createHash('sha256').update(String(text ?? '')).digest('hex').slice(0, 16);
}

/* ────────────────────────── 归因引擎（纯函数） ────────────────────────── */

/**
 * 解析一条 todo 在已有条目中的对应项（三级降级匹配）。
 *
 * todo 是整表替换且条目无 ID，因此身份只能靠推断：
 *   ① content_hash 相同        —— 文案未变，最可靠
 *   ② ordinal 相同且未完成     —— 顺序未变
 *   ③ name 相同但 hash 不同    —— 文案被改写（已完成项）
 *   ④ 都不匹配                —— 新条目
 *
 * @param {{content: string, status: string}} todo
 * @param {number} index 该条在本次 todos 数组中的位置
 * @param {Array<object>} items 已有条目
 * @returns {{item: object|null, matched: 'hash'|'ordinal'|'rewrite'|null}}
 */
export function resolveItem(todo, index, items) {
  const list = Array.isArray(items) ? items : [];
  const hash = contentHashOf(todo?.content);
  const content = String(todo?.content ?? '');

  for (const item of list) {
    if (item.contentHash === hash) return { item, matched: 'hash' };
  }
  for (const item of list) {
    if (item.ordinal === index && item.status !== 'completed') return { item, matched: 'ordinal' };
  }
  for (const item of list) {
    if (item.name === content && item.contentHash !== hash) return { item, matched: 'rewrite' };
  }
  return { item: null, matched: null };
}

/**
 * 应用一次 todo/write 快照，产出新状态与变化清单。
 *
 * 引擎只计算、不写库；effects 描述"发生了什么变化"，由调用方落库。
 * 关键语义：
 *   · in_progress 转换点 = 归因区间起点（seqFrom）
 *   · completed 转换点   = 归因区间终点（seqTo）
 *   · completed → pending = 重新打开（seqTo 置 null）
 *   · 未出现在本次 todos 中的旧条目一律保留，绝不删除
 *
 * @param {{activeItemId: string|null, items: Array<object>}} state
 * @param {Array<{content: string, status: string}>} todos
 * @param {number} turn
 * @param {number} seq
 * @returns {{state: object, effects: Array<object>}}
 */
export function applyTodoWrite(state, todos, turn, seq) {
  const list = Array.isArray(todos) ? todos : [];
  const items = (state?.items ?? []).map((item) => ({ ...item }));
  const effects = [];
  let activeItemId = state?.activeItemId ?? null;
  const stamp = now();

  const claimed = new Set();

  list.forEach((todo, index) => {
    const status = TASK_ITEM_STATUSES.has(todo?.status) ? todo.status : 'pending';
    const content = String(todo?.content ?? '');
    const hash = contentHashOf(content);

    /* 已被本次快照占用过的条目不再参与匹配（防止重复绑定）。 */
    const available = items.filter((item) => !claimed.has(item.id));
    const { item, matched } = resolveItem(todo, index, available);

    if (item === null) {
      const created = {
        id: makeId('item'),
        name: content,
        status: 'pending',
        ordinal: index,
        contentHash: hash,
        seqFrom: null,
        seqTo: null,
        turnFrom: turn,
        turnTo: turn,
        isNew: true
      };
      items.push(created);
      claimed.add(created.id);
      effects.push({ kind: 'insert_item', item: created });
      if (status !== 'pending') applyStatus(created, status, seq, turn, effects, stamp);
      if (activeItemId === null && created.status === 'in_progress') activeItemId = created.id;
      return;
    }

    claimed.add(item.id);
    item.ordinal = index;
    if (item.contentHash !== hash) {
      /* 措辞被改写（hash 变化但定位到同一条）：更新指纹与名称。 */
      item.contentHash = hash;
      item.name = content;
      effects.push({ kind: 'update_item', id: item.id, patch: { contentHash: hash, name: content } });
    } else if (item.name !== content) {
      item.name = content;
    }
    item.turnTo = turn;

    if (item.status !== status) applyStatus(item, status, seq, turn, effects, stamp);
    if (item.status === 'in_progress') activeItemId = item.id;
    else if (activeItemId === item.id) activeItemId = null;
  });

  /* 旧条目保留：不出现在本次 todos 中的不动。 */
  return { state: { activeItemId, items }, effects };
}

/** 状态流转的副作用（区间开闭 + effects）。 */
function applyStatus(item, status, seq, turn, effects, stamp) {
  const previous = item.status;
  item.status = status;
  if (status === 'in_progress') {
    if (item.seqFrom === null || previous === 'completed' || previous === 'blocked') item.seqFrom = seq;
    item.seqTo = null;
    item.turnFrom = turn;
    effects.push({ kind: 'open_segment', id: item.id, seq, turn, at: stamp });
  } else if (status === 'completed') {
    item.seqTo = seq;
    item.turnTo = turn;
    effects.push({ kind: 'close_segment', id: item.id, seq, turn, at: stamp });
  } else if (status === 'pending' && previous === 'completed') {
    /* 回退 = 重新打开归因区间。 */
    item.seqTo = null;
    effects.push({ kind: 'reopen_segment', id: item.id, seq, at: stamp });
  } else {
    effects.push({ kind: 'update_item', id: item.id, patch: { status }, at: stamp });
  }
}

/**
 * 任务级状态推导：进度 100%（所有子任务 completed）→ completed，否则 → active。
 * 空任务（尚无子任务）视为 active，避免刚创建就被误判完成。
 *
 * @param {Array<object>} items
 * @returns {'active'|'completed'}
 */
export function deriveTaskStatus(items) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return 'active';
  return list.every((item) => item.status === 'completed') ? 'completed' : 'active';
}

/**
 * 把一个操作归因到某个子任务。
 *
 * 优先级：当前进行中 → 最近的未闭合项 → null（任务级，绝不丢数据）
 *
 * @param {{activeItemId: string|null, items: Array<object>}} state
 * @param {number} seq
 * @returns {string|null}
 */
export function attributeOperation(state, seq) {
  if (state?.activeItemId) {
    const active = (state.items ?? []).find((item) => item.id === state.activeItemId);
    if (active !== undefined) return active.id;
  }
  let best = null;
  for (const item of state?.items ?? []) {
    if (item.seqTo !== null && item.seqTo !== undefined) continue;
    if (item.seqFrom === null || item.seqFrom === undefined) continue;
    if (item.seqFrom > seq) continue;
    if (best === null || item.seqFrom > best.seqFrom) best = item;
  }
  return best === null ? null : best.id;
}

/* ────────────────────────── 建表与轻量迁移 ────────────────────────── */

/**
 * 建立任务档案的全部表。幂等：CREATE TABLE IF NOT EXISTS + 加列式迁移（无版本表）。
 * 注意：不设置任何连接级 PRAGMA（由 memory.js 负责）。
 */
export function ensureTaskSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id                   TEXT PRIMARY KEY,
      name                 TEXT NOT NULL,
      status               TEXT NOT NULL DEFAULT 'active',
      revision             INTEGER NOT NULL DEFAULT 0,
      project_name         TEXT,
      cwd                  TEXT,
      memory_directory_ids TEXT NOT NULL DEFAULT '[]',
      summary              TEXT,
      created_at           INTEGER NOT NULL,
      updated_at           INTEGER NOT NULL,
      closed_at            INTEGER,
      deleted_at           INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status_updated ON tasks(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_name);

    CREATE TABLE IF NOT EXISTS task_sessions (
      task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      first_at   INTEGER NOT NULL,
      last_at    INTEGER NOT NULL,
      turn_from  INTEGER,
      turn_to    INTEGER,
      PRIMARY KEY (task_id, session_id)
    );
    CREATE INDEX IF NOT EXISTS idx_task_sessions_session ON task_sessions(session_id);

    CREATE TABLE IF NOT EXISTS task_items (
      id           TEXT PRIMARY KEY,
      task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      ordinal      INTEGER NOT NULL DEFAULT 0,
      content_hash TEXT,
      session_id   TEXT,
      seq_from     INTEGER,
      seq_to       INTEGER,
      turn_from    INTEGER,
      turn_to      INTEGER,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_task_items_task ON task_items(task_id, ordinal);

    CREATE TABLE IF NOT EXISTS task_operations (
      call_id       TEXT PRIMARY KEY,
      task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      item_id       TEXT REFERENCES task_items(id) ON DELETE CASCADE,
      seq           INTEGER NOT NULL,
      at            INTEGER NOT NULL,
      turn          INTEGER,
      step          INTEGER,
      kind          TEXT NOT NULL,
      tool_name     TEXT,
      path          TEXT,
      path_version  INTEGER,
      objects       TEXT,
      content       TEXT,
      is_error      INTEGER NOT NULL DEFAULT 0,
      error_code    TEXT,
      result_digest TEXT,
      result_chars  INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_task_ops_task_at ON task_operations(task_id, at DESC);
    CREATE INDEX IF NOT EXISTS idx_task_ops_item ON task_operations(item_id, seq);
    CREATE INDEX IF NOT EXISTS idx_task_ops_path ON task_operations(path);

    CREATE TABLE IF NOT EXISTS task_pitfalls (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      item_id  TEXT REFERENCES task_items(id) ON DELETE CASCADE,
      kind     TEXT NOT NULL,
      detail   TEXT NOT NULL,
      evidence TEXT,
      at       INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_task_pitfalls_task ON task_pitfalls(task_id, at);
    CREATE INDEX IF NOT EXISTS idx_task_pitfalls_kind ON task_pitfalls(kind, at DESC);

    CREATE TABLE IF NOT EXISTS task_context_marks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      item_id    TEXT REFERENCES task_items(id) ON DELETE SET NULL,
      key        TEXT NOT NULL,
      value      TEXT,
      prev_value TEXT,
      at         INTEGER NOT NULL,
      seq        INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_task_ctx_task ON task_context_marks(task_id, at);

    CREATE TABLE IF NOT EXISTS task_pins (
      task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      session_id   TEXT NOT NULL,
      noted_at     INTEGER,
      note_count   INTEGER NOT NULL DEFAULT 0,
      injected_at  INTEGER,
      injected_seq INTEGER,
      PRIMARY KEY (task_id, session_id)
    );
  `);

  /* 软删除列（回收站）：老库补列。NULL=未删除，非空=进入垃圾桶的毫秒时间戳。 */
  const taskColumns = db.prepare('PRAGMA table_info(tasks)').all();
  if (!taskColumns.some((column) => column.name === 'deleted_at')) {
    db.exec('ALTER TABLE tasks ADD COLUMN deleted_at INTEGER');
  }
  /* 索引放在补列之后建，老库首次升级也能创建。 */
  db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_deleted_at ON tasks(deleted_at)');

  /* 老库删列：pinned_at 已移除（其排序职责由 noted_at 承担，见 matchTasksForSession）。
     SQLite 对 NOT NULL 列不支持 DROP COLUMN，故按删列的标准做法重建表并搬运数据。
     幂等：列已不存在则整段跳过；数据只搬仍在使用的列，pinned_at 本就丢弃。 */
  const pinColumns = db.prepare('PRAGMA table_info(task_pins)').all();
  if (pinColumns.some((column) => column.name === 'pinned_at')) {
    db.exec(`
      CREATE TABLE task_pins_rebuilt (
        task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        session_id   TEXT NOT NULL,
        noted_at     INTEGER,
        note_count   INTEGER NOT NULL DEFAULT 0,
        injected_at  INTEGER,
        injected_seq INTEGER,
        PRIMARY KEY (task_id, session_id)
      );
      INSERT INTO task_pins_rebuilt (task_id, session_id, noted_at, note_count, injected_at, injected_seq)
        SELECT task_id, session_id, noted_at, note_count, injected_at, injected_seq FROM task_pins;
      DROP TABLE task_pins;
      ALTER TABLE task_pins_rebuilt RENAME TO task_pins;
    `);
  }
}

/* ────────────────────────── 工具分类与提取 ────────────────────────── */

const READ_TOOLS = new Set(['read', 'grep', 'glob', 'read_image', 'list_dir']);
const WRITE_TOOLS = new Set(['write']);
const EDIT_TOOLS = new Set(['edit', 'str_replace_editor', 'multi_edit']);
const EXEC_TOOLS = new Set(['pwsh', 'bash', 'shell', 'run']);
const MEMORY_TOOLS = new Set(['memory_search', 'memory_read', 'memory_add', 'memory_stop', 'memory_update', 'memory_list']);

/** 工具名 → 操作类别。 */
function classifyTool(name) {
  const tool = String(name ?? '');
  if (READ_TOOLS.has(tool)) return 'read';
  if (WRITE_TOOLS.has(tool)) return 'write';
  if (EDIT_TOOLS.has(tool)) return 'edit';
  if (EXEC_TOOLS.has(tool)) return 'exec';
  if (MEMORY_TOOLS.has(tool)) return 'memory';
  return 'other';
}

function firstLine(text, max = 120) {
  const value = safeText(text, 4000).split(/\r?\n/u)[0] ?? '';
  return safeText(value.trim(), max);
}

/**
 * 剥离文本中的文件路径，避免路径片段被误当作「对象」符号。
 * 与记忆蒸馏 extractDistillPaths/stripDistillPaths 同一策略：路径属于「位置」而非「对象」。
 * @param {string} text
 * @returns {string} 路径被替换为空格后的文本
 */
function stripSymbolPaths(text) {
  let source = String(text ?? '');
  /* 路径字符集：遇到空白、引号、括号、逗号等即视为路径结束。
     任务侧输入常是紧凑代码片段（如 "lib/client.js 里的 renderDetail"），
     故不能沿用记忆侧「吃到行尾」的宽松写法，否则会连同后续符号一起吞掉。 */
  const PATH_CHARS = "[^\\s`'\"，。；;、,()（）\\[\\]{}<>|]+";
  const patterns = [
    /* Windows 绝对路径 */
    new RegExp(`[A-Za-z]:\\\\${PATH_CHARS}`, "g"),
    /* 常见项目相对路径前缀：src/xxx、lib/xxx、node_modules/xxx 等 */
    new RegExp(`(?<=^|[\\s\`'"（(])(?:src|lib|app|packages|node_modules|\\.dsh|components|pages)[\\\\/]${PATH_CHARS}`, "gi")
  ];
  for (const pattern of patterns) {
    source = source.replace(pattern, " ");
  }
  return source;
}

/**
 * 提取代码符号名（函数/方法/类/常量/CSS class），用于定位修改点。
 * 与记忆蒸馏的 symbols 语义一致：只收「类名、方法函数名」这类可定位标识符，不收文件路径。
 * 提取规则为记忆版与任务版的并集，并额外过滤语言关键字与库调用前缀。
 * @param {string} text 代码片段
 * @returns {string[]} 去重后的符号名
 */
function extractSymbols(text) {
  const raw = String(text ?? '');
  if (raw.length === 0) return [];
  /* 先剥路径：未剥离时 Windows 路径会被空格切出 Users/AppData 之类残片。 */
  const source = stripSymbolPaths(raw);
  const out = [];
  const seen = new Set();
  const push = (value) => {
    const symbol = String(value ?? '').trim();
    if (symbol.length < 2 || symbol.length > 80) return;
    /* 排除路径残片、语言关键字与常见噪音词。 */
    if (/[\\/]/.test(symbol)) return;
    if (isSymbolStopWord(symbol)) return;
    if (seen.has(symbol)) return;
    seen.add(symbol);
    out.push(symbol);
  };
  /* 1) 函数/方法调用与声明：name( / obj.method( —— 去掉后缀括号取标识符本身。
     跳过库调用（react.createElement 之类），它们不是「被修改的对象」。 */
  for (const match of source.matchAll(/\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*\(/g)) {
    const symbol = match[1];
    const owner = symbol.includes('.') ? symbol.split('.')[0] : '';
    if (owner && SYMBOL_OWNER_STOP_WORDS.has(owner.toLowerCase())) continue;
    push(symbol);
  }
  /* 2) 函数/类声明：function foo / class Foo / const foo = ( */
  for (const match of source.matchAll(/\b(?:function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g)) push(match[1]);
  for (const match of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>)/g)) push(match[1]);
  /* 3) 类名/常量：首字母大写的标识符、全大写常量。 */
  for (const match of source.matchAll(/\b([A-Z][A-Za-z0-9_$]{2,})\b/g)) push(match[1]);
  for (const match of source.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)) push(match[1]);
  /* 4) CSS class 与插件内部命名惯例（dsh-xxx 之类）。 */
  for (const match of source.matchAll(/\b(dsh-[a-z0-9-]{3,})\b/g)) push(match[1]);
  /* 注 1：记忆版另有「a/b 命名空间」规则，但那是路径形态，与任务侧「对象不含路径」的语义相悖，故不并入。
     注 2：曾试过「camelCase 裸标识符」规则以兜散文里直指的函数名，但它无法区分函数名与变量名
           （如 taskPageCount），而「对象」的用途是快速定位代码单元，变量名无此价值，故移除。 */
  return out.slice(0, 6);
}

/**
 * 从工具调用参数中提取 objects（符号名）与 content（做了什么）。
 * objects 语义与记忆一致：函数/组件/类名/接口名/CSS class 等可定位标识符，
 * 文件路径属于「位置」而非「对象」，故不计入。
 * @param {string} name 工具名
 * @param {string} rawArguments JSON 字符串
 */
function extractOperationArgs(name, rawArguments) {
  const args = safeJsonParse(rawArguments, {});
  const tool = String(name ?? '');
  switch (tool) {
    case 'read':
    case 'read_image': {
      const path = safeText(args.file_path, 500);
      return { objects: [], content: `读 ${path}` };
    }
    case 'write': {
      const path = safeText(args.file_path, 500);
      /* 新建文件的正文即修改点，从中取符号；非代码文件不提取（避免英文单词/数据值当符号）。 */
      return { objects: isCodeFile(path) ? extractSymbols(args.content) : [], content: `写 ${path}` };
    }
    case 'edit':
    case 'str_replace_editor':
    case 'multi_edit': {
      const path = safeText(args.file_path, 500);
      if (!isCodeFile(path)) return { objects: [], content: `编辑 ${path}` };
      /* 修改点集中在 old_string/new_string（multi_edit 为 edits[]）。 */
      const chunks = [args.old_string, args.new_string];
      if (Array.isArray(args.edits)) {
        for (const entry of args.edits.slice(0, 5)) {
          if (entry && typeof entry === 'object') chunks.push(entry.old_string, entry.new_string);
        }
      }
      return { objects: extractSymbols(chunks.filter((chunk) => typeof chunk === 'string').join('\n')), content: `编辑 ${path}` };
    }
    case 'grep': {
      /* pattern 即用户在检索的符号名，是最高频的定位手段，故单独处理：
         ① 按正则元字符切成若干 token；② 每个 token 若本身是标识符即采纳（grep 常搜裸函数名）；
         ③ 再叠加通用提取，兜住 pattern 里内嵌的完整代码形态。 */
      const pattern = safeText(args.pattern, 200);
      const tokens = pattern.split(/[\\^$.*+?()[\]{}|/\s]+/u)
        .filter((token) => /^[A-Za-z_$][\w$]*$/u.test(token))
        .filter((token) => token.length >= 2 && token.length <= 80)
        .filter((token) => !isSymbolStopWord(token));
      return { objects: [...new Set([...tokens, ...extractSymbols(pattern)])].slice(0, 6), content: `搜索 ${pattern}` };
    }
    case 'glob': {
      const pattern = safeText(args.pattern, 200);
      return { objects: [], content: `匹配 ${pattern}` };
    }
    case 'pwsh':
    case 'bash':
    case 'shell': {
      return { objects: [], content: `执行 ${firstLine(args.command, 120)}` };
    }
    case 'memory_search': {
      const query = safeText(args.query, 200);
      return { objects: [], content: `检索记忆 ${query}` };
    }
    case 'memory_add':
    case 'memory_update': {
      /* 记忆正文的 objects 即其「对象」字段，直接复用。 */
      const text = safeText(args.text, 4000);
      const symbols = safeJsonParse(text, null);
      const list = symbols && typeof symbols === 'object'
        ? (symbols['对象'] ?? symbols.symbols)
        : undefined;
      return { objects: Array.isArray(list) ? list.map((item) => safeText(item, 120)).filter(Boolean).slice(0, 6) : [], content: `${tool}` };
    }
    default: {
      /* 未知工具无法判断语义，objects 留空，避免把参数名误当对象。 */
      return { objects: [], content: tool };
    }
  }
}

/** 从工具结果中提取文本摘要。 */
function digestResult(result, limit = 500) {
  const content = result?.message?.content;
  if (!Array.isArray(content)) return { digest: '', chars: 0 };
  const parts = [];
  let chars = 0;
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
      chars += block.text.length;
    }
  }
  const text = parts.join('\n');
  return { digest: safeText(text, limit), chars };
}

/**
 * 操作明细去重聚合：同类操作（工具类别 + 目标 + 是否错误相同）合并为一条，
 * 保留首次出现的先后顺序并统计次数。
 * 目标 = path 优先，其次 content——多次读/写同一文件、重复执行同一条命令都只显示一行。
 *
 * @param {Array<{kind: string, toolName: string, path: string, content: string, isError: boolean}>} ops
 * @returns {Array<object>} 每条附加 count
 */
export function aggregateOperations(ops) {
  const list = Array.isArray(ops) ? ops : [];
  const out = [];
  const indexByKey = new Map();
  for (const op of list) {
    const target = String(op?.path || op?.content || '');
    const key = `${op?.kind ?? 'other'}\u0000${op?.isError ? 'err' : 'ok'}\u0000${target}`;
    const existing = indexByKey.get(key);
    if (existing === undefined) {
      indexByKey.set(key, out.length);
      out.push({ ...op, count: 1 });
    } else {
      const merged = out[existing];
      merged.count += 1;
      /* 合并对象：同一文件被多次编辑时各次改动的符号不同（如先后改了 renderDetail
         与 renderFilterButton），只留首次会丢信息，故取并集。 */
      const incoming = Array.isArray(op?.objects) ? op.objects : [];
      if (incoming.length > 0) {
        const seen = new Set(Array.isArray(merged.objects) ? merged.objects : []);
        const union = [...(Array.isArray(merged.objects) ? merged.objects : [])];
        for (const symbol of incoming) {
          if (seen.has(symbol)) continue;
          seen.add(symbol);
          union.push(symbol);
        }
        merged.objects = union;
      }
    }
  }
  return out;
}

/**
 * 踩坑明细去重聚合：同一子任务 + 同一描述（tool-error / repeat-failure 视为同类）
 * 合并为一条，保留首次出现的顺序并统计次数。
 * 说明：同类失败先记 tool-error，重复出现记 repeat-failure，展示时按描述归并，
 *      kind 取首次出现的值，避免同一类踩坑被拆成两行。
 *
 * @param {Array<{itemId: string|null, kind: string, detail: string}>} pits
 * @returns {Array<object>} 每条附加 count
 */
export function aggregatePitfalls(pits) {
  const list = Array.isArray(pits) ? pits : [];
  const out = [];
  const indexByKey = new Map();
  for (const pit of list) {
    const key = `${pit?.itemId ?? ''}\u0000${pit?.detail ?? ''}`;
    const existing = indexByKey.get(key);
    if (existing === undefined) {
      indexByKey.set(key, out.length);
      out.push({ ...pit, count: 1 });
    } else {
      out[existing].count += 1;
    }
  }
  return out;
}

/* ────────────────────────── 存储与采集 ────────────────────────── */

/**
 * 任务档案存储与采集。
 *
 * 采集原则（详见设计文档 Part C）：
 *   · 实时捕获，不事后重放
 *   · call_id 为幂等键，三事件（tool/call → tool/result → fs/observed）汇聚到一行
 *   · 单事务写入 BEGIN IMMEDIATE
 *   · 异常不外抛，只 warn
 */
export class TaskStore {
  constructor(ctx, db) {
    this.ctx = ctx;
    this.db = db;
    /** sessionId → { taskId, state, activeTurn } 运行时缓存（可重建） */
    this.sessions = new Map();
    /** cwd → projectName 缓存：避免 pre-step 每轮同步 spawn git 进程 */
    this.projectNameCache = new Map();
    this.closed = false;
    ensureTaskSchema(db);
    this.quiet(() => this.reapStale());
    this.quiet(() => this.syncTaskStatuses());
  }

  /* ── 基础工具 ── */

  quiet(run) {
    try {
      return run();
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] task store: ${String(error?.message ?? error)}`);
      return undefined;
    }
  }

  tx(run) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = run();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* 已回滚 */
      }
      throw error;
    }
  }

  /* ── 会话运行时状态 ── */

  slotFor(sessionId) {
    let slot = this.sessions.get(sessionId);
    if (slot === undefined) {
      slot = { taskId: null, state: { activeItemId: null, items: [] }, activeTurn: null, calls: new Map() };
      this.sessions.set(sessionId, slot);
    }
    return slot;
  }

  /** 从库中重建某任务的归因状态（进程重启后恢复）。 */
  loadState(taskId) {
    const rows = this.db.prepare('SELECT * FROM task_items WHERE task_id = ? ORDER BY ordinal').all(taskId);
    let activeItemId = null;
    const items = rows.map((row) => {
      const item = {
        id: row.id,
        name: row.name,
        status: row.status,
        ordinal: row.ordinal,
        contentHash: row.content_hash,
        seqFrom: row.seq_from,
        seqTo: row.seq_to,
        turnFrom: row.turn_from,
        turnTo: row.turn_to
      };
      if (item.status === 'in_progress' && item.seqTo === null) activeItemId = item.id;
      return item;
    });
    return { activeItemId, items };
  }

  /** 找到当前会话关联的任务（优先运行时缓存，其次库）；回收站任务不可重新接收事件。 */
  taskIdForSession(sessionId) {
    const slot = this.sessions.get(sessionId);
    if (slot?.taskId) {
      const live = this.db.prepare('SELECT id FROM tasks WHERE id = ? AND deleted_at IS NULL').get(slot.taskId);
      if (live !== undefined) return slot.taskId;
      slot.taskId = null;
      slot.state = { activeItemId: null, items: [] };
    }
    const row = this.db.prepare(`
      SELECT ts.task_id FROM task_sessions ts
      JOIN tasks t ON t.id = ts.task_id
      WHERE ts.session_id = ? AND t.deleted_at IS NULL
      ORDER BY ts.last_at DESC LIMIT 1
    `).get(sessionId);
    if (row?.task_id === undefined) return null;
    const restored = this.slotFor(sessionId);
    restored.taskId = row.task_id;
    restored.state = this.loadState(row.task_id);
    return row.task_id;
  }

  /* ── 任务创建 ── */

  /**
   * 推导代码项目名。优先级：已有值（粘性）> git 仓库名 > cwd 目录名。
   * 仅在任务创建时计算一次。
   */
  deriveProjectName(cwd) {
    if (typeof cwd !== 'string' || cwd.length === 0) return null;
    if (this.projectNameCache.has(cwd)) return this.projectNameCache.get(cwd);
    const repoName = this.quiet(() => {
      const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
        cwd,
        encoding: 'utf8',
        timeout: 3000,
        windowsHide: true
      });
      if (result.status !== 0) return null;
      const root = String(result.stdout ?? '').trim();
      return root.length > 0 ? basename(root) : null;
    });
    const projectName = typeof repoName === 'string' && repoName.length > 0 ? repoName : basename(cwd);
    this.projectNameCache.set(cwd, projectName);
    return projectName;
  }

  createTask(session, name) {
    const sessionId = String(session?.id ?? '');
    const cwd = safeText(session?.header?.cwd, 1000) || null;
    const projectName = this.deriveProjectName(cwd);
    const id = makeId('task');
    const stamp = now();
    this.tx(() => {
      this.db.prepare(`
        INSERT INTO tasks (id, name, status, revision, project_name, cwd, memory_directory_ids, created_at, updated_at)
        VALUES (?, ?, 'active', 0, ?, ?, '[]', ?, ?)
      `).run(id, safeText(name, 500) || '未命名任务', projectName, cwd, stamp, stamp);
      this.db.prepare(`
        INSERT INTO task_sessions (task_id, session_id, first_at, last_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(task_id, session_id) DO UPDATE SET last_at = excluded.last_at
      `).run(id, sessionId, stamp, stamp);
    });
    const slot = this.slotFor(sessionId);
    slot.taskId = id;
    slot.state = { activeItemId: null, items: [] };
    return id;
  }

  /**
   * 手动创建任务（任务管理弹窗"新增任务"）：不绑定当前会话，可指定状态、附加信息与初始子任务。
   * 会话关联由后续注入或真实采集事件建立，无采集行为时任务保持"未进行"。
   * @param {string[]} items 初始子任务名列表（一律 pending，ordinal 按顺序）
   */
  createTaskManually({ name = '', status = 'not_started', summary = '', items = [] } = {}) {
    const safeStatus = TASK_STATUSES.has(status) ? status : 'active';
    const id = makeId('task');
    const stamp = now();
    /* 子任务名清洗：去空白、去重、限长、限量，避免空行与重复项。 */
    const itemNames = [];
    const seen = new Set();
    for (const raw of Array.isArray(items) ? items : []) {
      const text = safeText(raw, 500).trim();
      if (text === '' || seen.has(text)) continue;
      seen.add(text);
      itemNames.push(text);
      if (itemNames.length >= MANUAL_TASK_ITEM_LIMIT) break;
    }
    this.tx(() => {
      this.db.prepare(`
        INSERT INTO tasks (id, name, status, revision, project_name, cwd, memory_directory_ids, summary, created_at, updated_at)
        VALUES (?, ?, ?, 0, NULL, NULL, '[]', ?, ?, ?)
      `).run(id, safeText(name, 500).trim() || '未命名任务', safeStatus, safeText(summary, TASK_SUMMARY_MAX_LENGTH), stamp, stamp);
      /* 新建不关联任何会话：会话关联由「注入当前会话」（markInjected → touchSession）
         或该会话真实参与任务（事件归因 → touchSession）时建立。 */
      /* 初始子任务：状态一律 pending；content_hash 经 contentHashOf 统一生成，
         与 todo 采集同算法，便于后续按文案精确匹配（resolveItem 第①层）。 */
      itemNames.forEach((itemName, index) => {
        this.db.prepare(`
          INSERT INTO task_items (id, task_id, name, status, ordinal, content_hash, session_id,
                                  seq_from, seq_to, turn_from, turn_to, created_at, updated_at)
          VALUES (?, ?, ?, 'pending', ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)
        `).run(
          makeId('item'), id, itemName, index,
          contentHashOf(itemName),
          stamp, stamp
        );
      });
    });
    return id;
  }

  touchSession(taskId, sessionId, turn) {
    const stamp = now();
    this.db.prepare(`
      INSERT INTO task_sessions (task_id, session_id, first_at, last_at, turn_from, turn_to)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id, session_id) DO UPDATE SET
        last_at = excluded.last_at,
        turn_from = COALESCE(task_sessions.turn_from, excluded.turn_from),
        turn_to = excluded.turn_to
    `).run(taskId, sessionId, stamp, stamp, turn ?? null, turn ?? null);
  }

  /**
   * 手动从会话事件流提取任务档案（任务管理弹窗「提取当前会话任务」）。
   * 取会话里最后一条 todo/write，走与自动建档相同的消费路径，因此子任务内容一致。
   * 去重：该会话已有任务档案时不重复写入，直接返回已存在的任务。
   * @param {string} sessionId
   * @param {Array<object>} events 会话事件流（由调用方从活会话或持久化日志取得）
   */
  extractTaskFromSession(sessionId, events) {
    const sid = safeText(sessionId, 128);
    if (sid === '') return { ok: false, reason: 'no-session' };
    /* 去重一：会话已绑定任务（运行时缓存或库中记录）。 */
    const existing = this.taskIdForSession(sid);
    let injectedOnlyTaskId = null;
    if (existing !== null) {
      const row = this.db.prepare('SELECT name, deleted_at FROM tasks WHERE id = ?').get(existing);
      if (row !== undefined && row.deleted_at === null) {
        const pin = this.db.prepare('SELECT injected_at FROM task_pins WHERE task_id = ? AND session_id = ?').get(existing, sid);
        const captured = this.db.prepare(`
          SELECT 1 FROM task_items WHERE task_id = ? AND session_id = ? LIMIT 1
        `).get(existing, sid) !== undefined
          || this.db.prepare(`
            SELECT 1 FROM task_sessions WHERE task_id = ? AND session_id = ?
              AND (turn_from IS NOT NULL OR turn_to IS NOT NULL) LIMIT 1
          `).get(existing, sid) !== undefined;
        if (pin?.injected_at && !captured) injectedOnlyTaskId = existing;
        else return { ok: true, created: false, taskId: existing, name: row.name ?? '' };
      }
    }
    const list = Array.isArray(events) ? events : [];
    /* 分类给出具体原因，便于界面提示区分「读不到事件流」与「确实没有 todo」。 */
    if (list.length === 0) return { ok: false, reason: 'no-events' };
    const todoEvents = list.filter((event) => event?.type === 'todo/write');
    if (todoEvents.length === 0) return { ok: false, reason: 'no-todos' };
    /* 取最后一条含非空 todos 的 todo/write：任务档案以最新一次 todo 状态为准。 */
    let latest = null;
    let latestSeq = -Infinity;
    for (const event of todoEvents) {
      if (!Array.isArray(event?.data?.todos) || event.data.todos.length === 0) continue;
      const seq = Number.isSafeInteger(event?.seq) ? event.seq : -Infinity;
      if (latest === null || seq >= latestSeq) {
        latest = event;
        latestSeq = seq;
      }
    }
    if (latest === null) return { ok: false, reason: 'empty-todos' };
    const todos = latest.data.todos;
    const turn = Number.isSafeInteger(latest.data.turn) ? latest.data.turn : undefined;
    const name = safeText(todos.find((item) => item?.status === 'in_progress')?.content ?? todos[0]?.content ?? '', 500);
    const session = this.ctx?.sessions?.get?.(sid) ?? { id: sid };
    const cwd = safeText(session?.header?.cwd, 1000);
    const projectName = cwd ? (this.deriveProjectName(cwd) ?? '') : '';
    /* 去重二：同名任务仅在同项目/cwd内复用；跨项目同名任务新建，回收站不参与。 */
    const sameName = injectedOnlyTaskId === null
      ? this.db.prepare(`
          SELECT id FROM tasks
          WHERE name = ? AND deleted_at IS NULL
            AND ((? <> '' AND (project_name = ? OR cwd = ?))
              OR (? = '' AND EXISTS (
                SELECT 1 FROM task_sessions WHERE task_id = tasks.id AND session_id = ?
              )))
          ORDER BY updated_at DESC LIMIT 1
        `).get(name, projectName, projectName, cwd, projectName, sid)
      : undefined;
    const existingId = injectedOnlyTaskId ?? sameName?.id;
    if (existingId !== undefined && existingId !== null) {
      const valid = this.db.prepare('SELECT id FROM tasks WHERE id = ? AND deleted_at IS NULL').get(existingId);
      if (valid === undefined) return { ok: false, reason: 'task-not-found' };
    }
    /* 复用既有消费路径：写入子任务、绑定会话、按进度流转状态。
       强制目标确定后同步运行时槽，确保 applyTodoWrite 使用的是该任务的 item state，
       而不是此前会话槽中另一任务的状态。 */
    if (existingId !== undefined && existingId !== null) {
      const slot = this.slotFor(sid);
      slot.taskId = existingId;
      slot.state = this.loadState(existingId);
    }
    this.onTodoWrite(
      this.ctx?.sessions?.get?.(sid) ?? { id: sid },
      { seq: Number(latest.seq) || 0, data: { todos, turn, forcedTaskId: existingId } }
    );
    /* forcedTaskId 为空时由 onTodoWrite 新建，回查该会话最新绑定的任务。 */
    const taskId = existingId ?? this.taskIdForSession(sid);
    const row = taskId === null ? undefined : this.db.prepare('SELECT name FROM tasks WHERE id = ?').get(taskId);
    return { ok: true, created: existingId === undefined, taskId, name: row?.name ?? name, itemCount: todos.length };
  }

  /* ── 采集：todo/write ── */
  onTodoWrite(session, event) {
    const sessionId = String(session?.id ?? '');
    const todos = Array.isArray(event?.data?.todos) ? event.data.todos : [];
    const slot = this.slotFor(sessionId);
    if (Number.isSafeInteger(event?.data?.turn)) slot.activeTurn = event.data.turn;
    const turn = slot.activeTurn;
    const seq = Number(event?.seq) || 0;

    /* forcedTaskId：手动提取时外部已确定目标任务（含同名复用），但仍须验证
       任务存在且未进入回收站，避免任何内部调用把事件写入已删除档案。 */
    const forcedTaskId = safeText(event?.data?.forcedTaskId, 128);
    const forcedRow = forcedTaskId === '' ? undefined : this.db.prepare(
      'SELECT id FROM tasks WHERE id = ? AND deleted_at IS NULL'
    ).get(forcedTaskId);
    if (forcedTaskId !== '' && forcedRow === undefined) return;
    let taskId = forcedRow?.id ?? this.taskIdForSession(sessionId);
    if (taskId === null || taskId === '') {
      const name = safeText(todos.find((t) => t?.status === 'in_progress')?.content ?? todos[0]?.content ?? '', 500);
      taskId = this.createTask(session, name);
    }

    const { state, effects } = applyTodoWrite(slot.state, todos, turn, seq);
    slot.state = state;

    const stamp = now();
    this.tx(() => {
      this.touchSession(taskId, sessionId, turn);
      for (const effect of effects) {
        const item = effect.item ?? state.items.find((i) => i.id === effect.id);
        if (item === undefined) continue;
        if (effect.kind === 'insert_item') {
          this.db.prepare(`
            INSERT INTO task_items (id, task_id, name, status, ordinal, content_hash, session_id,
                                    seq_from, seq_to, turn_from, turn_to, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING
          `).run(
            item.id, taskId, item.name, item.status, item.ordinal ?? 0, item.contentHash ?? null, sessionId,
            item.seqFrom ?? null, item.seqTo ?? null, item.turnFrom ?? turn ?? null, item.turnTo ?? turn ?? null,
            stamp, stamp
          );
          continue;
        }
        this.db.prepare(`
          UPDATE task_items SET name = ?, status = ?, ordinal = ?, content_hash = ?,
            seq_from = ?, seq_to = ?, turn_from = ?, turn_to = ?, updated_at = ?
          WHERE id = ?
        `).run(
          item.name, item.status, item.ordinal ?? 0, item.contentHash ?? null,
          item.seqFrom ?? null, item.seqTo ?? null, item.turnFrom ?? null, item.turnTo ?? null,
          stamp, item.id
        );
      }

      /* 任务级状态随子任务自动流转：进度 100% → completed；有子任务被重新打开 → 回到 active；
         not_started 的任务一旦有子任务进行 → active。仅在相关状态间切换，
         不覆盖 paused/abandoned 等人为状态。 */
      const derivedStatus = deriveTaskStatus(state.items);
      const task = this.db.prepare('SELECT status FROM tasks WHERE id = ?').get(taskId);
      if (task !== undefined && task.status !== derivedStatus) {
        if (derivedStatus === 'completed' || task.status === 'completed' || task.status === 'not_started') {
          this.db.prepare('UPDATE tasks SET status = ?, closed_at = ?, updated_at = ? WHERE id = ?')
            .run(derivedStatus, derivedStatus === 'completed' ? stamp : null, stamp, taskId);
        }
      }
    });
  }

  /* ── 采集：tool/call ── */

  onToolCall(session, event) {
    const sessionId = String(session?.id ?? '');
    const data = event?.data ?? {};
    /* turn 追踪独立于任务绑定：会话首个事件（尚无任务）也要记录，供后续 todo/write 兜底。 */
    const slot = this.slotFor(sessionId);
    if (Number.isSafeInteger(data.turn)) slot.activeTurn = data.turn;

    const taskId = this.taskIdForSession(sessionId);
    if (taskId === null) return;
    const callId = safeText(data.callId, 128);
    if (!callId) return;

    const seq = Number(event?.seq) || 0;
    const tool = safeText(data.name, 128);
    const { objects, content } = extractOperationArgs(tool, data.arguments);
    const itemId = attributeOperation(slot.state, seq);
    const kind = classifyTool(tool);

    /* 暂存以便 tool/result 补全 */
    slot.calls.set(callId, { tool, turn: data.turn, step: data.step });

    this.tx(() => {
      this.db.prepare(`
        INSERT INTO task_operations (call_id, task_id, item_id, seq, at, turn, step, kind, tool_name, objects, content)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(call_id) DO UPDATE SET
          item_id = COALESCE(excluded.item_id, task_operations.item_id),
          objects = excluded.objects,
          content = excluded.content,
          kind = excluded.kind,
          tool_name = excluded.tool_name
      `).run(
        callId, taskId, itemId, seq, now(),
        Number.isSafeInteger(data.turn) ? data.turn : null,
        Number.isSafeInteger(data.step) ? data.step : null,
        kind, tool, JSON.stringify(objects), content
      );
    });
  }

  /* ── 采集：tool/result ── */

  onToolResult(session, event) {
    const sessionId = String(session?.id ?? '');
    const data = event?.data ?? {};
    const callId = safeText(data.message?.source?.callId ?? data.callId, 128);
    if (!callId) return;
    /* result 可能在 A→B 注入切换后才到达；归因必须跟随 call 时写入的 task_id，
       不能读取当前 session slot，否则错误/摘要会污染新任务 B。 */
    const operation = this.db.prepare('SELECT task_id, item_id, tool_name FROM task_operations WHERE call_id = ?').get(callId);
    if (operation === undefined) return;
    const taskId = operation.task_id;
    const isError = data.message?.content?.[0]?.isError === true || data.error !== undefined;
    const errorCode = safeText(data.error?.code, 128) || null;
    const { digest, chars } = digestResult({ message: data.message });

    this.tx(() => {
      this.db.prepare(`
        UPDATE task_operations SET is_error = ?, error_code = ?, result_digest = ?, result_chars = ?
        WHERE call_id = ? AND task_id = ?
      `).run(isError ? 1 : 0, errorCode, digest, chars, callId, taskId);

      if (isError) {
        const slot = this.slotFor(sessionId);
        const cached = slot.calls.get(callId);
        const itemId = operation.item_id ?? null;
        const detail = safeText(digest || errorCode || '工具执行失败', 500);
        /* 重复失败识别：同一子任务、同一失败描述已出现过则记为 repeat-failure。
           不依赖 error_code（多数工具错误无 code，旧写法 LIKE '%null%' 永远不命中）。 */
        const prior = this.db.prepare(`
          SELECT id FROM task_pitfalls
          WHERE task_id = ? AND kind IN ('tool-error', 'repeat-failure')
            AND item_id IS ? AND detail = ?
          LIMIT 1
        `).get(taskId, itemId, detail);
        this.db.prepare(`
          INSERT INTO task_pitfalls (task_id, item_id, kind, detail, evidence, at) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          taskId, itemId,
          prior === undefined ? 'tool-error' : 'repeat-failure',
          detail, `${cached?.tool ?? ''}:${errorCode ?? ''}`, now()
        );
      }
    });
  }

  /* ── 采集：fs/observed ── */

  onFsObserved(target, observation, actor) {
    try {
      const session = actor?.agent?.session;
      const sessionId = String(session?.id ?? '');
      if (!sessionId) return;
      const callId = safeText(actor?.callId, 128);
      if (!callId) return;
      const path = safeText(target?.displayPath ?? target?.path, 1000) || null;
      const version = Number.isFinite(observation?.version) ? observation.version : null;
      if (path === null) return;
      /* 文件观察可能晚于任务切换；先确认 call 属于哪个已存在的 operation，
         不读取当前 slot，也不让未知 callId 更新任意任务。 */
      const operation = this.db.prepare('SELECT task_id FROM task_operations WHERE call_id = ?').get(callId);
      if (operation === undefined) return;
      this.db.prepare(`
        UPDATE task_operations SET path = ?, path_version = ? WHERE call_id = ? AND task_id = ?
      `).run(path, version, callId, operation.task_id);
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] task fs/observed: ${String(error?.message ?? error)}`);
    }
  }

  /* ── 采集：turn 边界 ── */

  onTurnEnd(session, event) {
    const sessionId = String(session?.id ?? '');
    const taskId = this.taskIdForSession(sessionId);
    if (taskId === null) return;
    const data = event?.data ?? {};
    const reason = safeText(data.reason?.kind, 64);
    const turn = Number.isSafeInteger(data.turn) ? data.turn : null;
    const slot = this.slotFor(sessionId);
    if (Number.isSafeInteger(data.turn)) slot.activeTurn = data.turn;
    slot.calls.clear();

    this.tx(() => {
      /* 轮次边界顺带清理陈旧段，避免中途放弃的子任务永远卡在 in_progress。 */
      this.reapStale();
      this.touchSession(taskId, sessionId, turn);
      if (reason && reason !== 'completed') {
        this.db.prepare(`
          INSERT INTO task_pitfalls (task_id, item_id, kind, detail, evidence, at) VALUES (?, ?, 'turn-aborted', ?, ?, ?)
        `).run(taskId, null, `轮次以 ${reason} 结束`, `turn:${turn ?? ''}`, now());
      }
    });
  }

  /* ── 采集：记忆项目使用 ── */

  onMemoryToolUse(exec, result, next) {
    const tool = safeText(exec?.name, 128);
    if (MEMORY_TOOLS.has(tool)) {
      const sessionId = String(exec?.agent?.session?.id ?? '');
      const taskId = this.taskIdForSession(sessionId);
      if (taskId !== null) {
        const ids = this.extractDirectoryIds(exec, result);
        if (ids.length > 0) this.appendMemoryDirectories(taskId, ids);
      }
    }
    return next();
  }

  extractDirectoryIds(exec, result) {
    const found = new Set();
    const args = safeJsonParse(exec?.arguments, {});
    if (typeof args.directoryId === 'string' && args.directoryId) found.add(args.directoryId);
    if (typeof args.directory_id === 'string' && args.directory_id) found.add(args.directory_id);
    const content = result?.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type !== 'text' || typeof block.text !== 'string') continue;
        for (const match of block.text.matchAll(/dir-[0-9a-zA-Z-]{4,}/gu)) found.add(match[0]);
      }
    }
    return [...found];
  }

  appendMemoryDirectories(taskId, ids) {
    this.quiet(() => {
      const row = this.db.prepare('SELECT memory_directory_ids FROM tasks WHERE id = ?').get(taskId);
      if (row === undefined) return;
      const existing = safeJsonParse(row.memory_directory_ids, []);
      const merged = [...new Set([...(Array.isArray(existing) ? existing : []), ...ids])];
      this.db.prepare('UPDATE tasks SET memory_directory_ids = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(merged), now(), taskId);
    });
  }

  /* ── 陈旧段清理 ── */

  reapStale(maxAgeMs = 30 * 60 * 1000) {
    const cutoff = now() - maxAgeMs;
    this.db.prepare(`
      UPDATE task_items SET status = 'aborted', seq_to = NULL, updated_at = ?
      WHERE status = 'in_progress' AND updated_at < ?
    `).run(now(), cutoff);
  }

  /* ── 存量回填：子任务全部完成但任务仍 active（早于自动流转逻辑的任务） ── */

  syncTaskStatuses() {
    const stamp = now();
    this.db.prepare(`
      UPDATE tasks SET status = 'completed', closed_at = COALESCE(closed_at, ?), updated_at = ?
      WHERE status = 'active'
        AND (SELECT COUNT(*) FROM task_items WHERE task_id = tasks.id) > 0
        AND (SELECT COUNT(*) FROM task_items WHERE task_id = tasks.id AND status != 'completed') = 0
    `).run(stamp, stamp);
  }

  close() {
    this.closed = true;
    this.sessions.clear();
    this.projectNameCache.clear();
  }

  /* ────────────────────────── 读取 ────────────────────────── */

  /** 记忆项目 ID 数组 → 带名称的列表。 */
  memoryDirectoriesOf(taskId) {
    const row = this.db.prepare('SELECT memory_directory_ids FROM tasks WHERE id = ?').get(taskId);
    const ids = safeJsonParse(row?.memory_directory_ids, []);
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    return this.db.prepare(`SELECT id, name FROM memory_directories WHERE id IN (${placeholders})`).all(...ids)
      .map((entry) => ({ id: entry.id, name: entry.name }));
  }

  /**
   * 拼装任务列表的 WHERE 子句与参数。
   * status='all' 或省略 = 不过滤（客户端"全部"筛选显式传 'all'）；
   * keyword 对名称与项目名做子串匹配（与客户端原过滤字段一致）。
   */
  taskListClauses({ status, projectName, keyword } = {}) {
    /* 回收站任务（deleted_at 非空）不进入任何常规列表与计数，与筛选条件无关。 */
    const clauses = ['deleted_at IS NULL'];
    const params = [];
    if (typeof status === 'string' && status !== 'all' && TASK_STATUSES.has(status)) {
      clauses.push('status = ?');
      params.push(status);
    }
    if (typeof projectName === 'string' && projectName.length > 0) {
      clauses.push('project_name = ?');
      params.push(projectName);
    }
    const safeKeyword = safeText(keyword, 200).trim();
    if (safeKeyword.length > 0) {
      /* LIKE 特殊字符转义，避免用户输入的 % _ 被当作通配符。 */
      const pattern = `%${safeKeyword.replace(/[\\%_]/gu, (c) => `\\${c}`)}%`;
      clauses.push("(name LIKE ? ESCAPE '\\' OR IFNULL(project_name, '') LIKE ? ESCAPE '\\')");
      params.push(pattern, pattern);
    }
    return { where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
  }

  /** 当前筛选条件下的命中总数（不受分页 limit 影响）。 */
  countTasks(filters = {}) {
    const { where, params } = this.taskListClauses(filters);
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM tasks ${where}`).get(...params);
    return Number(row?.count) || 0;
  }

  /* 「全部」页签状态占比：各状态任务数（回收站任务不计入）。 */
  taskStatusCounts() {
    const counts = { not_started: 0, active: 0, paused: 0, completed: 0, abandoned: 0 };
    let total = 0;
    for (const row of this.db.prepare('SELECT status, COUNT(*) AS count FROM tasks WHERE deleted_at IS NULL GROUP BY status').all()) {
      if (counts[row.status] === undefined) continue;
      counts[row.status] = Number(row.count) || 0;
      total += counts[row.status];
    }
    return { counts, total };
  }

  listTasks({ status, projectName, keyword, limit = 20, offset = 0 } = {}) {
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const { where, params } = this.taskListClauses({ status, projectName, keyword });
    const rows = this.db.prepare(`
      SELECT * FROM tasks ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?
    `).all(...params, safeLimit, safeOffset);
    return this.mapTaskRows(rows);
  }

  /**
   * 批量统计并映射任务行（listTasks / listTrash 共用，避免每任务两条子查询的 N+1）。
   * deletedAt 对常规列表恒为 null，仅供回收站使用。
   */
  mapTaskRows(rows) {
    const itemCounts = new Map();
    const sessionCounts = new Map();
    if (rows.length > 0) {
      const placeholders = rows.map(() => '?').join(',');
      for (const row of this.db.prepare(`
        SELECT task_id,
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS done,
          SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress
        FROM task_items WHERE task_id IN (${placeholders}) GROUP BY task_id
      `).all(...rows.map((row) => row.id))) {
        itemCounts.set(row.task_id, row);
      }
      for (const row of this.db.prepare(`
        SELECT task_id, COUNT(*) AS count FROM task_sessions
        WHERE task_id IN (${placeholders}) GROUP BY task_id
      `).all(...rows.map((row) => row.id))) {
        sessionCounts.set(row.task_id, Number(row.count) || 0);
      }
    }

    return rows.map((row) => {
      const counts = itemCounts.get(row.id) ?? {};
      return {
        id: row.id,
        name: row.name,
        status: row.status,
        revision: row.revision,
        projectName: row.project_name ?? '',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        deletedAt: row.deleted_at ?? null,
        itemCounts: {
          total: Number(counts.total) || 0,
          done: Number(counts.done) || 0,
          inProgress: Number(counts.in_progress) || 0
        },
        sessionCount: sessionCounts.get(row.id) ?? 0
      };
    });
  }

  viewTask(taskId) {
    const task = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (task === undefined) return null;
    const items = this.db.prepare('SELECT * FROM task_items WHERE task_id = ? ORDER BY ordinal').all(taskId);
    const pitfallCounts = this.db.prepare(`
      SELECT kind, COUNT(*) AS count FROM task_pitfalls WHERE task_id = ? GROUP BY kind
    `).all(taskId);
    const sessions = this.db.prepare('SELECT * FROM task_sessions WHERE task_id = ? ORDER BY last_at DESC').all(taskId);

    /* 批量统计子任务的操作/踩坑数，避免每个子任务两条子查询（N+1）。 */
    const itemOps = new Map();
    const itemPits = new Map();
    for (const row of this.db.prepare(`
      SELECT item_id,
        COUNT(*) AS total,
        SUM(CASE WHEN kind = 'read' THEN 1 ELSE 0 END) AS reads,
        SUM(CASE WHEN kind IN ('write','edit') THEN 1 ELSE 0 END) AS writes
      FROM task_operations WHERE task_id = ? AND item_id IS NOT NULL GROUP BY item_id
    `).all(taskId)) {
      itemOps.set(row.item_id, row);
    }
    for (const row of this.db.prepare(`
      SELECT item_id, COUNT(*) AS count FROM task_pitfalls
      WHERE task_id = ? AND item_id IS NOT NULL GROUP BY item_id
    `).all(taskId)) {
      itemPits.set(row.item_id, Number(row.count) || 0);
    }

    return {
      id: task.id,
      name: task.name,
      status: task.status,
      revision: task.revision,
      projectName: task.project_name ?? '',
      cwd: task.cwd ?? '',
      summary: task.summary ?? '',
      createdAt: task.created_at,
      updatedAt: task.updated_at,
      memoryDirectories: this.memoryDirectoriesOf(taskId),
      sessions: sessions.map((row) => ({
        id: row.session_id,
        firstAt: row.first_at,
        lastAt: row.last_at,
        turnRange: [row.turn_from ?? null, row.turn_to ?? null]
      })),
      items: items.map((item) => {
        const ops = itemOps.get(item.id) ?? {};
        return {
          id: item.id,
          name: item.name,
          status: item.status,
          ordinal: item.ordinal,
          opCount: Number(ops.total) || 0,
          pitfallCount: itemPits.get(item.id) ?? 0,
          files: { read: Number(ops.reads) || 0, written: Number(ops.writes) || 0 },
          turnRange: [item.turn_from ?? null, item.turn_to ?? null]
        };
      }),
      pitfallSummary: pitfallCounts.map((row) => ({ kind: row.kind, count: Number(row.count) || 0 }))
    };
  }

  detailTask(taskId, { itemId, include = ['ops', 'pitfalls'], kinds, sinceSeq, limit = 50 } = {}) {
    const task = this.db.prepare('SELECT id, name, status FROM tasks WHERE id = ?').get(taskId);
    if (task === undefined) return null;
    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
    const result = { taskId: task.id, name: task.name, status: task.status, operations: [], pitfalls: [], contextMarks: [] };

    if (include.includes('ops')) {
      const clauses = ['task_id = ?'];
      const params = [taskId];
      if (typeof itemId === 'string' && itemId) {
        clauses.push('item_id = ?');
        params.push(itemId);
      }
      if (Array.isArray(kinds) && kinds.length > 0) {
        clauses.push(`kind IN (${kinds.map(() => '?').join(',')})`);
        params.push(...kinds);
      }
      if (Number.isSafeInteger(sinceSeq)) {
        clauses.push('seq > ?');
        params.push(sinceSeq);
      }
      const rows = this.db.prepare(`
        SELECT * FROM task_operations WHERE ${clauses.join(' AND ')} ORDER BY seq LIMIT ?
      `).all(...params, safeLimit);
      result.operations = aggregateOperations(rows.map((row) => ({
        callId: row.call_id,
        itemId: row.item_id,
        seq: row.seq,
        at: row.at,
        turn: row.turn,
        kind: row.kind,
        toolName: row.tool_name,
        path: row.path ?? '',
        objects: safeJsonParse(row.objects, []),
        content: row.content ?? '',
        isError: row.is_error === 1,
        errorCode: row.error_code ?? '',
        resultDigest: row.result_digest ?? ''
      })));
    }

    if (include.includes('pitfalls')) {
      const rows = this.db.prepare('SELECT * FROM task_pitfalls WHERE task_id = ? ORDER BY at').all(taskId);
      result.pitfalls = aggregatePitfalls(rows
        .filter((row) => (typeof itemId === 'string' && itemId ? row.item_id === itemId : true))
        .map((row) => ({ itemId: row.item_id ?? null, kind: row.kind, detail: row.detail, evidence: row.evidence ?? '', at: row.at })));
    }

    if (include.includes('context')) {
      const rows = this.db.prepare('SELECT * FROM task_context_marks WHERE task_id = ? ORDER BY at').all(taskId);
      result.contextMarks = rows.map((row) => ({ key: row.key, value: row.value, prevValue: row.prev_value, at: row.at }));
    }

    return result;
  }

  /* ── 人工更新（task_update 工具） ── */

  /**
   * 增量更新任务档案（乐观锁）：可补充 note、标记子任务状态（itemId + itemStatus）、
   * 调整任务状态（status）。全部变更在同一事务内完成。
   * 任务级状态：显式 status 优先；仅标记子任务时按进度自动流转（与 todo/write 一致）。
   */
  applyTaskUpdate(args, exec) {
    const taskId = safeText(args?.taskId, 128);
    const revision = Number(args?.revision);
    const task = this.db.prepare('SELECT revision, status, deleted_at FROM tasks WHERE id = ?').get(taskId);
    if (task === undefined) return { applied: false, revision: 0, conflict: false, notice: '未找到该任务。' };
    if (task.deleted_at !== null && task.deleted_at !== undefined) {
      return { applied: false, revision: Number(task.revision) || 0, conflict: false, notice: '任务已删除（在回收站中），不能编辑。' };
    }
    if (Number(task.revision) !== revision) {
      return {
        applied: false,
        revision: Number(task.revision) || 0,
        conflict: true,
        notice: `版本冲突：当前 revision=${task.revision}，请重新读取后再更新。`
      };
    }

    const stamp = now();
    const next = revision + 1;
    const applied = [];
    const itemId = safeText(args?.itemId, 128);
    const itemStatus = safeText(args?.itemStatus, 32);
    const failNotices = {
      'invalid-item-status': 'itemStatus 无效（pending | in_progress | completed | blocked | aborted），且必须与 itemId 一起提供。',
      'item-not-found': '未找到该子任务（不属于该任务）。',
      'invalid-status': 'status 无效（active | paused | completed | abandoned）。'
    };

    try {
      this.tx(() => {
        this.db.prepare('UPDATE tasks SET revision = ?, updated_at = ? WHERE id = ?').run(next, stamp, taskId);

        /* 改任务名 */
        const name = safeText(args?.name, 500).trim();
        if (name) {
          this.db.prepare('UPDATE tasks SET name = ?, updated_at = ? WHERE id = ?').run(name, stamp, taskId);
          applied.push('name');
        }

        /* 附加信息（summary，传空串表示清空） */
        if (args?.summary !== undefined) {
          this.db.prepare('UPDATE tasks SET summary = ?, updated_at = ? WHERE id = ?')
            .run(typeof args.summary === 'string' ? args.summary.slice(0, TASK_SUMMARY_MAX_LENGTH) : '', stamp, taskId);
          applied.push('summary');
        }

        if (typeof args?.note === 'string' && args.note.length > 0) {
          this.db.prepare(`
            INSERT INTO task_context_marks (task_id, item_id, key, value, prev_value, at, seq)
            VALUES (?, NULL, 'note', ?, NULL, ?, NULL)
          `).run(taskId, safeText(args.note, 2000), stamp);
          applied.push('note');
        }

        /* 子任务状态标记 */
        if (itemId || itemStatus) {
          if (!itemId || !TASK_ITEM_STATUSES.has(itemStatus)) throw new Error('invalid-item-status');
          const row = this.db.prepare('SELECT id FROM task_items WHERE id = ? AND task_id = ?').get(itemId, taskId);
          if (row === undefined) throw new Error('item-not-found');
          this.db.prepare('UPDATE task_items SET status = ?, updated_at = ? WHERE id = ?').run(itemStatus, stamp, itemId);
          applied.push(`itemStatus=${itemStatus}`);
        }

        /* 任务级状态：显式 status 优先；仅标记子任务时按进度自动流转兜底。 */
        const status = safeText(args?.status, 32);
        if (status) {
          if (!TASK_STATUSES.has(status)) throw new Error('invalid-status');
          this.db.prepare('UPDATE tasks SET status = ?, closed_at = ?, updated_at = ? WHERE id = ?')
            .run(status, status === 'completed' ? stamp : null, stamp, taskId);
          applied.push(`status=${status}`);
        } else if (itemId && itemStatus) {
          const items = this.db.prepare('SELECT status FROM task_items WHERE task_id = ?').all(taskId);
          const derived = deriveTaskStatus(items);
          if (task.status !== derived && (derived === 'completed' || task.status === 'completed' || task.status === 'not_started')) {
            this.db.prepare('UPDATE tasks SET status = ?, closed_at = ?, updated_at = ? WHERE id = ?')
              .run(derived, derived === 'completed' ? stamp : null, stamp, taskId);
          }
        }
      });
    } catch (error) {
      return {
        applied: false,
        revision: Number(task.revision) || 0,
        conflict: false,
        notice: failNotices[error?.message] ?? `更新失败：${String(error?.message ?? error)}`
      };
    }

    /* 同步运行时缓存，避免下一轮 todo/write 基于过期状态推导 */
    const sessionId = String(exec?.agent?.session?.id ?? '');
    const slot = this.sessions.get(sessionId);
    if (slot && itemId && itemStatus) {
      const item = slot.state.items.find((i) => i.id === itemId);
      if (item) item.status = itemStatus;
    }

    return { applied: true, revision: next, conflict: false, notice: `已更新（${applied.join('、') || 'revision'}）。` };
  }

  /* ── 删除任务 ── */

  /**
   * 彻底删除任务档案及其全部关联数据（显式逐表删，不依赖外键级联开关）。
   * 同时清理运行时缓存中的引用，避免后续事件把明细写到已不存在的任务上。
   * 仅应由回收站链路调用（purgeTask / purgeExpiredTrash）。
   */
  hardDeleteTask(taskId) {
    const task = this.db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId);
    if (task === undefined) return false;
    this.tx(() => {
      this.db.prepare('DELETE FROM task_operations WHERE task_id = ?').run(taskId);
      this.db.prepare('DELETE FROM task_pitfalls WHERE task_id = ?').run(taskId);
      this.db.prepare('DELETE FROM task_context_marks WHERE task_id = ?').run(taskId);
      this.db.prepare('DELETE FROM task_pins WHERE task_id = ?').run(taskId);
      this.db.prepare('DELETE FROM task_items WHERE task_id = ?').run(taskId);
      this.db.prepare('DELETE FROM task_sessions WHERE task_id = ?').run(taskId);
      this.db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
    });
    this.releaseTaskSlots(taskId);
    return true;
  }

  /** 解除运行时缓存对该任务的引用（软删与彻底删除共用）。 */
  releaseTaskSlots(taskId) {
    for (const slot of this.sessions.values()) {
      if (slot.taskId === taskId) {
        slot.taskId = null;
        slot.state = { activeItemId: null, items: [] };
        slot.calls.clear();
      }
    }
  }

  /**
   * 删除任务：软删除（移入回收站）。仅打 deleted_at 标记，子任务/操作明细/踩坑
   * 全部保留，供垃圾桶恢复；超过 30 天的由 purgeExpiredTrash 在打开任务管理时清除。
   * 运行时引用仍立即解除，避免后续事件把明细写进已删除的任务。
   */
  deleteTask(taskId) {
    const task = this.db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId);
    if (task === undefined) return false;
    const stamp = now();
    this.db.prepare('UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?').run(stamp, stamp, taskId);
    this.releaseTaskSlots(taskId);
    return true;
  }

  /* ── 回收站 ── */

  /** 回收站筛选：keyword 对名称与项目名做子串匹配（转义规则与任务列表一致）。 */
  trashListClauses({ keyword } = {}) {
    const clauses = ['deleted_at IS NOT NULL'];
    const params = [];
    const safeKeyword = safeText(keyword, 200).trim();
    if (safeKeyword.length > 0) {
      const pattern = `%${safeKeyword.replace(/[\\%_]/gu, (c) => `\\${c}`)}%`;
      clauses.push("(name LIKE ? ESCAPE '\\' OR IFNULL(project_name, '') LIKE ? ESCAPE '\\')");
      params.push(pattern, pattern);
    }
    return { where: `WHERE ${clauses.join(' AND ')}`, params };
  }

  /** 回收站命中总数（不受分页 limit 影响）。 */
  countTrash(filters = {}) {
    const { where, params } = this.trashListClauses(filters);
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM tasks ${where}`).get(...params);
    return Number(row?.count) || 0;
  }

  listTrash({ keyword, limit = 50, offset = 0 } = {}) {
    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const { where, params } = this.trashListClauses({ keyword });
    const rows = this.db.prepare(`
      SELECT * FROM tasks ${where} ORDER BY deleted_at DESC LIMIT ? OFFSET ?
    `).all(...params, safeLimit, safeOffset);
    return this.mapTaskRows(rows);
  }

  /**
   * 从回收站恢复任务。原状态为 active（进行中）的恢复为 paused（已暂停），
   * 避免恢复即后台续跑；其余状态原样保留。closed_at 不调整。
   */
  restoreTask(taskId) {
    const task = this.db.prepare('SELECT id, status FROM tasks WHERE id = ? AND deleted_at IS NOT NULL').get(taskId);
    if (task === undefined) return null;
    const status = task.status === 'active' ? 'paused' : task.status;
    this.db.prepare('UPDATE tasks SET deleted_at = NULL, status = ?, updated_at = ? WHERE id = ?').run(status, now(), taskId);
    return { restored: true, status };
  }

  /** 彻底清除回收站中超期（默认 30 天）的任务，返回清理数量。 */
  purgeExpiredTrash({ days = 30 } = {}) {
    const safeDays = Math.max(1, Number(days) || 30);
    const cutoff = now() - safeDays * 24 * 60 * 60 * 1000;
    const expired = this.db.prepare('SELECT id FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at <= ?').all(cutoff);
    let purged = 0;
    for (const row of expired) {
      if (this.hardDeleteTask(row.id)) purged += 1;
    }
    return purged;
  }

  /* ────────────────────────── 注入装配 ────────────────────────── */

  /**
   * 装配整个任务的完整档案文本。
   * 顺序刻意设计：被截断时从尾部丢（骨架优先于明细）。
   */
  buildInjectionText(taskId, maxChars = 50000) {
    /* 回收站任务可只读查看，但不能再次注入到会话。 */
    const liveTask = this.db.prepare('SELECT id FROM tasks WHERE id = ? AND deleted_at IS NULL').get(taskId);
    if (liveTask === undefined) return null;
    const view = this.viewTask(taskId);
    if (view === null) return null;
    const detail = this.detailTask(taskId, { include: ['ops', 'pitfalls', 'context'], limit: 200 });
    const lines = [];

    lines.push(`（以下内容来自任务档案，记录了当时的真实执行现场，不受当前会话上下文压缩影响）`);
    lines.push('');
    lines.push(`# 任务：${view.name}`);
    lines.push(`· 状态：${view.status}`);
    lines.push(`· 项目：${view.projectName || '（未识别）'}`);
    if (view.summary) lines.push(`· 说明：${view.summary}`);
    if (view.cwd) lines.push(`· 工作目录：${view.cwd}`);
    if (view.memoryDirectories.length > 0) {
      lines.push(`· 用过的记忆项目：${view.memoryDirectories.map((d) => d.name).join('、')}`);
    }
    lines.push(`· 时间跨度：${new Date(view.createdAt).toISOString()} ~ ${new Date(view.updatedAt).toISOString()}`);
    lines.push('');

    lines.push('## 子任务');
    for (const item of view.items) {
      lines.push(`- [${item.status}] ${item.name}（操作 ${item.opCount} 次，读 ${item.files.read} / 写 ${item.files.written}，坑 ${item.pitfallCount}）`);
    }
    lines.push('');

    lines.push('## 操作明细');
    for (const op of detail.operations) {
      const flag = op.isError ? ' [错误]' : '';
      const content = String(op.content ?? '');
      /* content 通常已含目标路径（如「编辑 X.js」），此时不再重复拼接 path。 */
      const path = op.path && !content.includes(op.path) ? ` ${op.path}` : '';
      const repeat = op.count > 1 ? ` ×${op.count}` : '';
      /* 对象（类名/函数名/CSS 类等符号）追加在末尾，供定位具体代码单元；
         旧数据里存的是路径/命令，与 content 重复，由 injectionSymbols 过滤掉。 */
      const symbols = injectionSymbols(op.objects).filter((s) => !content.includes(s));
      const objects = symbols.length > 0 ? ` → ${symbols.join(' · ')}` : '';
      lines.push(`- [${op.kind}]${flag}${repeat} ${content}${path}${objects}`);
      if (op.resultDigest) lines.push(`    ↳ ${firstLine(op.resultDigest, 160)}`);
    }
    lines.push('');

    if (detail.pitfalls.length > 0) {
      lines.push('## 踩坑');
      for (const pit of detail.pitfalls) {
        const repeat = pit.count > 1 ? ` ×${pit.count}` : '';
        lines.push(`- (${pit.kind})${repeat} ${pit.detail}`);
      }
      lines.push('');
    }

    if (detail.contextMarks.length > 0) {
      lines.push('## 上下文变更');
      for (const mark of detail.contextMarks) lines.push(`- ${mark.key}: ${mark.prevValue} → ${mark.value}`);
      lines.push('');
    }

    let text = lines.join('\n');
    if (text.length > maxChars) {
      text = `${text.slice(0, maxChars)}\n\n（档案过大已截断，完整内容可用 task_detail 分页查看）`;
    }
    return text;
  }

  /* ────────────────────────── 提示与注入状态 ────────────────────────── */

  pinFor(taskId, sessionId) {
    return this.db.prepare('SELECT * FROM task_pins WHERE task_id = ? AND session_id = ?').get(taskId, sessionId);
  }

  markNoted(taskId, sessionId) {
    /* pin 行可能不存在（首次提示），须先 upsert 再自增计数。 */
    this.db.prepare(`
      INSERT INTO task_pins (task_id, session_id, noted_at, note_count)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(task_id, session_id) DO UPDATE SET
        noted_at = excluded.noted_at,
        note_count = task_pins.note_count + 1
    `).run(taskId, sessionId, now());
  }

  markInjected(taskId, sessionId, seq) {
    if (sessionId === '') return;
    /* 注入即视为该会话参与任务：同时建立 task_sessions 关联，会话计数随之可见。 */
    this.touchSession(taskId, sessionId);
    this.db.prepare(`
      INSERT INTO task_pins (task_id, session_id, injected_at, injected_seq)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(task_id, session_id) DO UPDATE SET injected_at = excluded.injected_at, injected_seq = excluded.injected_seq
    `).run(taskId, sessionId, now(), seq ?? null);
    /* 注入切换工作目标：立即重绑运行时归因槽。taskIdForSession 优先读内存槽，
       不重绑的话，同进程内先做过任务 A 再注入 B 时，事件会继续归因到 A 直到重启。 */
    const slot = this.slotFor(sessionId);
    if (slot.taskId !== taskId) {
      slot.taskId = taskId;
      slot.state = this.loadState(taskId);
    }
  }

  /**
   * 本会话真正参与过的任务 id 集合：只认 task_sessions（写过 todo/轮次，或被注入）。
   *
   * 刻意不读 task_pins：那张表是「提示/注入」的 UI 状态，noted_at 仅表示"已提示过"，
   * 并不代表会话参与过任务。此前读它会把「只收到过提示」的会话误判为参与，
   * 而提示本身又会写 pin 行，形成自循环（提示→engaged 变大→更易被提示）。
   * 防重复提示由 pin.noted_at 单独负责，pin 优先匹配由 matchTasksForSession 单独负责，
   * 均不依赖本集合。
   */
  engagedTaskIdsForSession(sessionId) {
    const ids = new Set();
    for (const row of this.db.prepare('SELECT task_id FROM task_sessions WHERE session_id = ?').all(sessionId)) {
      ids.add(row.task_id);
    }
    return ids;
  }

  /**
   * 匹配候选任务：pin > 同项目活跃 > （语义检索留待二期）。
   */
  matchTasksForSession(session, limit = 2) {
    const sessionId = String(session?.id ?? '');
    const out = [];
    /* 只匹配「进行中」的任务：已暂停/已完成/已放弃都不再自动提示，
       未开始的任务通常还没有子任务，提示内容为空壳，故也不纳入。
       排序用 COALESCE(noted_at, injected_at)：noted_at 是"最近一次提示"，
       仅注入未提示的行（noted_at 为 NULL）回退到 injected_at，两者皆空则排最后。 */
    const pinned = this.db.prepare(`
      SELECT t.* FROM task_pins p JOIN tasks t ON t.id = p.task_id
      WHERE p.session_id = ? AND t.status = 'active' AND t.deleted_at IS NULL
      ORDER BY COALESCE(p.noted_at, p.injected_at, 0) DESC LIMIT ?
    `).all(sessionId, limit);
    for (const row of pinned) out.push(row);

    if (out.length < limit) {
      const cwd = safeText(session?.header?.cwd, 1000);
      const projectName = cwd ? (this.deriveProjectName(cwd) ?? '') : '';
      const rows = this.db.prepare(`
        SELECT * FROM tasks
        WHERE status = 'active' AND deleted_at IS NULL
          AND (id NOT IN (${out.length > 0 ? out.map(() => '?').join(',') : "''"}))
          AND (project_name = ? OR cwd = ?)
        ORDER BY updated_at DESC LIMIT ?
      `).all(...out.map((row) => row.id), projectName, cwd, limit - out.length);
      for (const row of rows) out.push(row);
    }
    return out.slice(0, limit);
  }
}

/* ────────────────────────── 工具注册 ────────────────────────── */

const TASK_TOOL_SOURCE = Object.freeze({ kind: 'plugin', plugin: PLUGIN_NAME });

function toolTextBlock(text) {
  return [{ type: 'text', text: String(text ?? '') }];
}

function renderTaskList(value) {
  if (!value.tasks.length) return '没有符合条件的任务。';
  const lines = value.tasks.map((task) => {
    const counts = task.itemCounts;
    return `· ${task.name} [${task.status}] 项目=${task.projectName || '未识别'} 进度=${counts.done}/${counts.total} 会话数=${task.sessionCount}\n  id=${task.id}`;
  });
  return lines.join('\n');
}

function renderTaskView(value) {
  const lines = [`任务：${value.name} [${value.status}] 项目=${value.projectName || '未识别'}`];
  if (value.summary) lines.push(`说明：${value.summary}`);
  if (value.memoryDirectories.length > 0) lines.push(`记忆项目：${value.memoryDirectories.map((d) => d.name).join('、')}`);
  lines.push(`子任务 ${value.items.length} 项：`);
  for (const item of value.items) {
    lines.push(`  - [${item.status}] ${item.name}（操作 ${item.opCount}，读 ${item.files.read}/写 ${item.files.written}，坑 ${item.pitfallCount}） id=${item.id}`);
  }
  if (value.pitfallSummary.length > 0) {
    lines.push(`坑汇总：${value.pitfallSummary.map((p) => `${p.kind}×${p.count}`).join('、')}`);
  }
  return lines.join('\n');
}

function renderTaskDetail(value) {
  const lines = [`任务：${value.name}`];
  if (value.operations.length > 0) {
    lines.push(`操作明细 ${value.operations.length} 条：`);
    for (const op of value.operations) {
      const repeat = op.count > 1 ? `（×${op.count}）` : '';
      lines.push(`  - [${op.kind}]${op.isError ? '[错误]' : ''}${repeat} ${op.content}${op.path ? ` → ${op.path}` : ''}`);
    }
  }
  if (value.pitfalls.length > 0) {
    lines.push(`踩坑 ${value.pitfalls.length} 条：`);
    for (const pit of value.pitfalls) {
      const repeat = pit.count > 1 ? ` ×${pit.count}` : '';
      lines.push(`  - (${pit.kind})${repeat} ${pit.detail}`);
    }
  }
  return lines.join('\n');
}

function registerTaskTools(ctx, store, tools) {
  const disposers = [];
  /* DSH 的工具必须经 defineTool 包装（与 memory.js 一致）；直接传裸对象会被校验拒绝。 */
  const register = (definition) => {
    const dispose = tools.register(defineTool(definition));
    if (typeof dispose === 'function') disposers.push(dispose);
  };

  register({
    name: 'task_list',
    description: '列出任务档案（每任务一行摘要）。任务档案记录了任务全过程的文件读写、操作与踩坑，用于跨会话或上下文压缩后恢复任务上下文。',
    parameters: {
      status: { type: 'string', description: 'active | paused | completed | abandoned，默认 active' },
      projectName: { type: 'string', description: '按代码项目名过滤' },
      limit: { type: 'integer', description: '最多返回条数，默认 20' }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tasks: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                name: { type: 'string', required: true },
                status: { type: 'string', required: true },
                projectName: { type: 'string', required: true },
                updatedAt: { type: 'integer', required: true },
                sessionCount: { type: 'integer', required: true },
                itemCounts: {
                  type: 'object',
                  required: true,
                  additionalProperties: false,
                  properties: {
                    total: { type: 'integer', required: true },
                    done: { type: 'integer', required: true },
                    inProgress: { type: 'integer', required: true }
                  }
                }
              }
            }
          },
          count: { type: 'integer', required: true }
        }
      },
      render: (_args, value) => toolTextBlock(renderTaskList(value))
    },
    async execute(args) {
      const tasks = store.listTasks({ ...(args ?? {}), status: args?.status ?? 'active' });
      return { tasks, count: tasks.length };
    },
    presentCall: (args) => ({ card: 'generic', title: 'Task list', kind: 'other', rawInput: args ?? {} })
  });

  register({
    name: 'task_view',
    description: '查看任务的骨架：元信息、记忆项目、涉及会话、子任务列表（含操作与踩坑计数，不展开明细）。',
    parameters: {
      taskId: { type: 'string', required: true, description: '任务 id' }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          found: { type: 'boolean', required: true },
          id: { type: 'string', required: true },
          name: { type: 'string', required: true },
          status: { type: 'string', required: true },
          projectName: { type: 'string', required: true },
          rendered: { type: 'string', required: true }
        }
      },
      render: (_args, value) => toolTextBlock(value.rendered)
    },
    async execute(args) {
      const value = store.viewTask(safeText(args?.taskId, 128));
      if (value === null) return { found: false, id: safeText(args?.taskId, 128), name: '', status: '', projectName: '', rendered: '未找到该任务。' };
      return {
        found: true,
        id: value.id,
        name: value.name,
        status: value.status,
        projectName: value.projectName,
        rendered: renderTaskView(value)
      };
    },
    presentCall: (args) => ({ card: 'generic', title: 'Task view', kind: 'other', rawInput: args ?? {} })
  });

  register({
    name: 'task_detail',
    description: '查看任务的明细：某个子任务（或全部）的操作记录、踩坑与上下文变更。返回量较大，建议先用 task_view 定位。',
    parameters: {
      taskId: { type: 'string', required: true, description: '任务 id' },
      itemId: { type: 'string', description: '子任务 id，省略则返回全任务' },
      limit: { type: 'integer', description: '最多返回操作条数，默认 50' }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          found: { type: 'boolean', required: true },
          rendered: { type: 'string', required: true }
        }
      },
      render: (_args, value) => toolTextBlock(value.rendered)
    },
    async execute(args) {
      const value = store.detailTask(safeText(args?.taskId, 128), {
        itemId: args?.itemId === undefined ? undefined : safeText(args.itemId, 128),
        limit: args?.limit
      });
      if (value === null) return { found: false, rendered: '未找到该任务。' };
      return { found: true, rendered: renderTaskDetail(value) };
    },
    presentCall: (args) => ({ card: 'generic', title: 'Task detail', kind: 'other', rawInput: args ?? {} })
  });

  register({
    name: 'task_inject',
    description: '把任务的完整档案注入当前会话上下文（含全部子任务、操作明细、踩坑）。用于跨会话或上下文压缩后恢复任务现场。',
    parameters: {
      taskId: { type: 'string', required: true, description: '任务 id' }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          injected: { type: 'boolean', required: true },
          approxChars: { type: 'integer', required: true },
          notice: { type: 'string', required: true }
        }
      },
      render: (_args, value) => toolTextBlock(value.notice)
    },
    async execute(args, exec) {
      const taskId = safeText(args?.taskId, 128);
      const text = store.buildInjectionText(taskId);
      if (text === null) return { injected: false, approxChars: 0, notice: '未找到该任务。' };
      const session = exec?.agent?.session;
      if (session !== undefined && typeof session.append === 'function') {
        const seq = store.appendInjection(session, taskId, text);
        if (seq !== null) store.markInjected(taskId, String(session.id ?? ''), seq);
      }
      return {
        injected: true,
        approxChars: text.length,
        notice: `已注入任务档案（约 ${text.length} 字符）。任务全过程信息现已在本会话上下文中。`
      };
    },
    presentCall: (args) => ({ card: 'generic', title: 'Task inject', kind: 'other', rawInput: args ?? {} })
  });

  register({
    name: 'task_update',
    description: '增量更新任务档案（乐观锁）。用于模型主动补充观察（note）、设置附加信息（summary）、重命名（name）、标记子任务状态（itemId + itemStatus）或调整任务状态（status）；不支持整表替换。',
    parameters: {
      taskId: { type: 'string', required: true, description: '任务 id' },
      revision: { type: 'integer', required: true, description: '当前 revision，冲突时需重新读取' },
      name: { type: 'string', description: '任务新名称' },
      summary: { type: 'string', description: '任务附加信息/说明（传空串清空）' },
      note: { type: 'string', description: '要补充的说明' },
      itemId: { type: 'string', description: '子任务 id（与 itemStatus 一起提供）' },
      itemStatus: { type: 'string', description: '子任务新状态：pending | in_progress | completed | blocked | aborted' },
      status: { type: 'string', description: '任务新状态：active | paused | completed | abandoned' }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          applied: { type: 'boolean', required: true },
          revision: { type: 'integer', required: true },
          conflict: { type: 'boolean', required: true },
          notice: { type: 'string', required: true }
        }
      },
      render: (_args, value) => toolTextBlock(value.notice)
    },
    async execute(args, exec) {
      return store.applyTaskUpdate(args ?? {}, exec);
    },
    presentCall: (args) => ({ card: 'generic', title: 'Task update', kind: 'other', rawInput: args ?? {} })
  });

  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}

/* ────────────────────────── HTTP 路由 ────────────────────────── */

function respond(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readJsonBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('payload-too-large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.length === 0) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error('invalid-json'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * 取会话事件流：优先活会话（含本轮未落盘事件），回退到持久化日志。
 * 参照 index.js 的 sessionEvents/persistedEventsForArchive 写法。
 */
async function sessionEventsForExtract(store, sessionId) {
  const ctx = store?.ctx;
  const live = ctx?.sessions?.get?.(sessionId);
  if (live !== undefined && live !== null) {
    if (typeof live.snapshotEvents === 'function') {
      try {
        const value = live.snapshotEvents();
        if (Array.isArray(value)) return value;
      } catch { /* 回退到 events */ }
    }
    if (Array.isArray(live.events)) return live.events;
  }
  /* 冷/归档会话没有 live binding 时读取持久化日志，避免“明明有历史却 no-events”。 */
  const persistence = ctx?.sessionPersistence;
  try {
    if (typeof persistence?.readFrom === 'function') {
      const snapshot = await persistence.readFrom(sessionId, 0);
      return Array.isArray(snapshot?.events) ? snapshot.events : Array.isArray(snapshot) ? snapshot : [];
    }
    if (typeof persistence?.open === 'function') {
      const handle = await persistence.open(sessionId, 'read');
      try {
        const snapshot = await handle.read(0, Number.MAX_SAFE_INTEGER);
        return Array.isArray(snapshot?.events) ? snapshot.events : Array.isArray(snapshot) ? snapshot : [];
      } finally {
        await handle.close?.();
      }
    }
  } catch {
    /* 路由层保持 no-events 语义，具体持久化错误不泄漏给客户端。 */
  }
  return [];
}

function createTaskRoute(store) {
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const action = url.searchParams.get('action') ?? 'list';
      if (req.method === 'GET') {
        if (action === 'list') {
          const filters = {
            status: url.searchParams.get('status') ?? 'active',
            projectName: url.searchParams.get('projectName') ?? undefined,
            keyword: url.searchParams.get('keyword') ?? undefined
          };
          return respond(res, 200, { ok: true, value: {
            tasks: store.listTasks({
              ...filters,
              limit: Number(url.searchParams.get('limit')) || undefined,
              offset: Number(url.searchParams.get('offset')) || 0
            }),
            total: store.countTasks(filters)
          } });
        }
        if (action === 'view') {
          const value = store.viewTask(safeText(url.searchParams.get('taskId'), 128));
          if (value === null) return respond(res, 404, { ok: false, error: 'task-not-found' });
          return respond(res, 200, { ok: true, value });
        }
        if (action === 'detail') {
          /* include 逗号分隔；缺省沿用 detailTask 的默认（ops, pitfalls）。 */
          const includeParam = url.searchParams.get('include');
          const include = typeof includeParam === 'string' && includeParam.length > 0
            ? includeParam.split(',').map((part) => part.trim()).filter(Boolean)
            : undefined;
          const value = store.detailTask(safeText(url.searchParams.get('taskId'), 128), {
            itemId: url.searchParams.get('itemId') ?? undefined,
            include,
            limit: Number(url.searchParams.get('limit')) || undefined
          });
          if (value === null) return respond(res, 404, { ok: false, error: 'task-not-found' });
          return respond(res, 200, { ok: true, value });
        }
        if (action === 'trash') {
          const filters = { keyword: url.searchParams.get('keyword') ?? undefined };
          return respond(res, 200, { ok: true, value: {
            tasks: store.listTrash({
              ...filters,
              limit: Number(url.searchParams.get('limit')) || undefined,
              offset: Number(url.searchParams.get('offset')) || 0
            }),
            total: store.countTrash(filters)
          } });
        }
        if (action === 'stats') {
          return respond(res, 200, { ok: true, value: store.taskStatusCounts() });
        }
        return respond(res, 400, { ok: false, error: 'unknown-action' });
      }
      if (req.method === 'POST') {
        const body = await readJsonBody(req);
        if (body.action === 'inject') {
          const taskId = safeText(body.taskId, 128);
          const sessionId = safeText(body.sessionId, 128);
          const text = store.buildInjectionText(taskId);
          if (text === null) return respond(res, 404, { ok: false, error: 'task-not-found' });
          let seq = null;
          const session = store.ctx?.sessions?.get?.(sessionId);
          if (session !== undefined && typeof store.appendInjection === 'function') {
            seq = store.appendInjection(session, taskId, text);
            if (seq !== null) store.markInjected(taskId, sessionId, seq);
          }
          return respond(res, 200, { ok: true, value: { approxChars: text.length, injected: session !== undefined } });
        }
        if (body.action === 'update') {
          const task = store.db.prepare('SELECT revision FROM tasks WHERE id = ?').get(safeText(body.taskId, 128));
          if (task === undefined) return respond(res, 404, { ok: false, error: 'task-not-found' });
          return respond(res, 200, { ok: true, value: { revision: Number(task.revision) || 0 } });
        }
        if (body.action === 'updateTask') {
          const result = store.applyTaskUpdate({
            taskId: safeText(body.taskId, 128),
            revision: Number(body.revision),
            name: body.name,
            status: body.status,
            summary: body.summary
          }, undefined);
          if (!result.applied) return respond(res, 400, { ok: false, error: 'update-failed', value: result });
          return respond(res, 200, { ok: true, value: result });
        }
        if (body.action === 'createTask') {
          const id = store.createTaskManually({
            name: body.name,
            status: body.status,
            summary: body.summary,
            items: Array.isArray(body.items) ? body.items : []
          });
          return respond(res, 200, { ok: true, value: { id } });
        }
        if (body.action === 'extractSessionTask') {
          const sessionId = safeText(body.sessionId, 128);
          const events = await sessionEventsForExtract(store, sessionId);
          const result = store.extractTaskFromSession(sessionId, events);
          if (!result.ok) return respond(res, 400, { ok: false, error: result.reason, value: result });
          return respond(res, 200, { ok: true, value: result });
        }
        if (body.action === 'deleteTask') {
          const deleted = store.deleteTask(safeText(body.taskId, 128));
          if (!deleted) return respond(res, 404, { ok: false, error: 'task-not-found' });
          return respond(res, 200, { ok: true, value: { deleted: true } });
        }
        if (body.action === 'restoreTask') {
          const result = store.restoreTask(safeText(body.taskId, 128));
          if (result === null) return respond(res, 404, { ok: false, error: 'task-not-found' });
          return respond(res, 200, { ok: true, value: result });
        }
        if (body.action === 'purgeTask') {
          const purged = store.hardDeleteTask(safeText(body.taskId, 128));
          if (!purged) return respond(res, 404, { ok: false, error: 'task-not-found' });
          return respond(res, 200, { ok: true, value: { purged: true } });
        }
        if (body.action === 'purgeTrash') {
          const purged = store.purgeExpiredTrash({ days: Number(body.days) || undefined });
          return respond(res, 200, { ok: true, value: { purged } });
        }
        return respond(res, 400, { ok: false, error: 'unknown-action' });
      }
      return respond(res, 405, { ok: false, error: 'method-not-allowed' });
    } catch (error) {
      return respond(res, 500, { ok: false, error: String(error?.message ?? error) });
    }
  };
}

/* ────────────────────────── 提示注入 ────────────────────────── */

const TASK_CONTEXT_PLUGIN = `${PLUGIN_NAME}-tasks`;

/** 构造会进入会话表面的任务 user 消息，统一保证消息身份存在。 */
export function createTaskContextMessage(text, taskId) {
  return createUserMessage({
    source: {
      kind: 'plugin',
      plugin: TASK_CONTEXT_PLUGIN,
      ...(taskId === undefined ? {} : { taskId })
    },
    content: [{ type: 'text', text }]
  });
}

export function appendTaskInjection(session, taskId, text) {
  if (typeof session?.append !== 'function') return null;
  const message = createTaskContextMessage(text, taskId);
  const result = session.append('user/message', message, { surfaceOp: 'append' });
  return Number(result?.seq ?? NaN) >= 0 ? Number(result.seq) : null;
}

/**
 * 在 pre-step 阶段注入任务提示（每会话仅一次，压缩后重置）。
 *
 * 提示只是"提示位"，不注入档案本体——档案由 task_inject 手动注入。
 */
export function injectTaskHints(store, agent, claimedMessages, decision, signal, turn, options = {}) {
  if (decision?.kind !== 'enter') return decision;
  /* 自动注入开关（任务管理弹窗左下角）：关闭后不再自动提示未完成任务。
     模型仍可主动 task_list / task_inject。 */
  if (options.isAutoInjectEnabled?.() === false) return decision;
  const session = agent?.session;
  if (session === undefined) return decision;
  const sessionId = String(session.id ?? '');
  if (!sessionId) return decision;

  /* 只做「跨会话发现」：提示本会话尚未参与过、但同项目仍活跃的任务。
     engaged（本会话在 task_sessions 里有记录：写过 todo/轮次，或被注入过）在此是**排除条件**——
     本会话正在做的任务不需提醒，模型自己看得到会话里的 todo。
     相比之下，「同会话内被打断后续接」属于任务提醒，不是本功能的目标场景，故不覆盖。
     限 1 条 + 每会话只提示一次（pin.noted_at），旧任务不会顶到用户新需求前面。 */
  const engaged = store.quiet(() => store.engagedTaskIdsForSession(sessionId)) ?? new Set();
  /* 本会话已绑定任务（engaged 非空）说明它有自己的工作目标，不再做跨会话发现：
     否则会话里已开着新任务，却仍提示旧任务，属于噪音，也可能把模型带偏到旧任务上。
     需要主动查看旧任务时用 task_list / task_inject，不依赖自动提示。 */
  if (engaged.size > 0) return decision;
  const candidates = (store.quiet(() => store.matchTasksForSession(session, 2)) ?? []).slice(0, 1);
  if (candidates.length === 0) return decision;

  const notices = [];
  for (const task of candidates) {
    const pin = store.quiet(() => store.pinFor(task.id, sessionId));
    /* 本会话已提示过该任务则跳过，保证每会话每任务只提示一次。 */
    if (pin?.noted_at) continue;
    const view = store.quiet(() => store.viewTask(task.id));
    if (view === null) continue;
    const done = view.items.filter((item) => item.status === 'completed').length;
    const current = view.items.find((item) => item.status === 'in_progress');
    const pitfallCount = view.pitfallSummary.reduce((sum, entry) => sum + entry.count, 0);
    notices.push([
      `（可选后台提示，优先级低于当前用户需求）存在未完任务：《${view.name}》`,
      `  · 项目：${view.projectName || '未识别'}`,
      `  · 进度：${view.items.length} 个子任务，已完成 ${done}${current ? `，当前「${current.name}」` : ''}`,
      `  · 已知坑：${pitfallCount} 处`,
      `  · 请先完整响应当前最新用户需求，不要因本提示直接开始该任务。`,
      `  · 仅当用户需求确实属于该任务时，才调用 task_inject 读取完整档案（taskId=${view.id}）。`,
      `  · 当前需求完成后，如需继续该任务，可再调用 task_inject。`
    ].join('\n'));
    store.quiet(() => store.markNoted(task.id, sessionId));
  }

  if (notices.length === 0) return decision;
  const message = createTaskContextMessage(notices.join('\n\n'));
  return { ...decision, messages: [...decision.messages, message] };
}

/* ────────────────────────── 装配 ────────────────────────── */

/**
 * 安装任务档案功能。
 *
 * @param ctx 插件上下文
 * @param store 现有 MemoryStore（复用其 db 句柄——同库不同表）
 * @param options.hooks 运行时配置读取器；options.isAutoInjectEnabled() 为 false 时停止自动注入
 */
export async function installTaskFeature(ctx, store, options = {}) {
  if (store?.db === undefined) {
    ctx.logger?.warn?.(`[${PLUGIN_NAME}] task feature skipped: memory store db unavailable`);
    return undefined;
  }
  const isAutoInjectEnabled = typeof options?.isAutoInjectEnabled === 'function' ? options.isAutoInjectEnabled : undefined;
  const taskStore = new TaskStore(ctx, store.db);
  /* 注入消息的写入器：以 user 消息形式落到会话日志，并返回其 seq。 */
  taskStore.appendInjection = appendTaskInjection;

  ctx.effect(() => () => taskStore.close(), `${PLUGIN_NAME}: task store close`);

  ctx.effect(function* () {
    yield ctx.on('session/event', (session, event) => {
      const type = event?.type;
      if (type !== 'todo/write' && type !== 'tool/call' && type !== 'tool/result' && type !== 'turn/end') return;
      taskStore.quiet(() => {
        if (type === 'todo/write') taskStore.onTodoWrite(session, event);
        else if (type === 'tool/call') taskStore.onToolCall(session, event);
        else if (type === 'tool/result') taskStore.onToolResult(session, event);
        else taskStore.onTurnEnd(session, event);
      });
    });
    yield ctx.on('fs/observed', (target, observation, actor) => taskStore.onFsObserved(target, observation, actor));
  }, `${PLUGIN_NAME}: task capture`);

  const tools = ctx.get?.('tools', false);
  if (typeof tools?.register === 'function') {
    ctx.effect(() => registerTaskTools(ctx, taskStore, tools), `${PLUGIN_NAME}: task tools`);
  }

  ctx.effect(() => {
    if (typeof ctx.webServer?.register !== 'function') return () => {};
    return ctx.webServer.register({ kind: 'exact', path: TASKS_ROUTE, handler: createTaskRoute(taskStore) });
  }, `${PLUGIN_NAME}: task route`);

  ctx.effect(function* () {
    yield ctx.on('agent/pre-step', async ({ agent, messages, turn, signal }, next) => {
      const decision = await next();
      return injectTaskHints(taskStore, agent, messages, decision, signal, turn, { isAutoInjectEnabled });
    }, { prepend: false });
  }, `${PLUGIN_NAME}: task hints`);

  return taskStore;
}
