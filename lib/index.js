import { MessageId, createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId, foldSurface } from '@deepseek-ai/dsh-session';
import { isAppendSurfaceEvent, isReplacementSurfaceEvent } from '@deepseek-ai/dsh-session/surface';
import { defineDomain } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn as childSpawn, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { constants as zlibConstants, zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installMemoryFeature } from './memory.js';
import { installTaskFeature } from './task.js';
import { filterTombstonesFromRequest } from './tombstone-filter.js';
import { fenceRoute } from './route-guard.js';

const require = createRequire(import.meta.url);
const name = 'dsh-session-kit';
const inject = ['webServer', 'sessionPersistence', 'workspaceRegistry', 'agents', 'sessions', 'storageDomain', 'systemPrompt', 'llm'];
const OPEN_ROUTE = '/dsh-session-kit/open-folder';
const DELETE_ROUTE = '/dsh-session-kit/delete';
/* 手动归档（v13.18）：客户端"归档会话"菜单改走本路由，以便在归档成功的同一刻
   记下真实来源与时间。此前客户端直连核心 ctx.workspaces.archiveSession()，
   宿主完全看不到这次操作，只能靠读列表时惰性补记 —— 而补记无法得知真实时刻。 */
const ARCHIVE_SESSION_ROUTE = '/dsh-session-kit/archive/session';
/* 收藏归档会话（v13.42）：POST { sessionId, favorite }。 */
const ARCHIVE_FAVORITE_ROUTE = '/dsh-session-kit/archive/favorite';
const ARCHIVE_LIST_ROUTE = '/dsh-session-kit/archive/list';
const ARCHIVE_RESTORE_ROUTE = '/dsh-session-kit/archive/restore';
const ARCHIVE_DELETE_ROUTE = '/dsh-session-kit/archive/delete';
const ARCHIVE_PREVIEW_ROUTE = '/dsh-session-kit/archive/preview';
const TOOL_STATS_ROUTE = '/dsh-session-kit/tool-stats';
const COMPACTION_CONFIG_ROUTE = '/dsh-session-kit/compaction-config';
const REPAIR_SESSION_ROUTE = '/dsh-session-kit/repair-session';
const GLOBAL_PROMPT_ROUTE = '/dsh-session-kit/global-prompt';
const MEMORY_STORAGE_ROUTE = '/dsh-session-kit/memory-storage';
const GLOBAL_PROMPT_SECTION = 'dsh-session-kit:global-prompt';
const GLOBAL_PROMPT_ORDER = 10;
const GLOBAL_PROMPT_MAX_TEXT_LENGTH = 200000;
const TURNS_DEL_PATH = '/dsh-turns-del';
const TURNS_DEL_RANGES_PATH = '/dsh-turns-del/ranges';
const TURNS_DEL_TURN_PATH = '/dsh-turns-del/turn';
const REGENERATE_PATH = '/dsh-turns-del-regenerate';
const REGENERATE_TURN_PATH = '/dsh-turns-del-regenerate/turn';
const EDIT_REGENERATE_TURN_PATH = '/dsh-turns-del-edit-regenerate/turn';
const TURNS_DEL_PROVIDER = 'dsh-session-kit-turns-del';
const SESSION_ID_RE = /^(session-)?[0-9a-fA-F-]+$/;
const COMPACTION_DEFAULT_THRESHOLD_RATIO = 0.8;
const COMPACTION_DEFAULT_RETAIN_RATIO = 0.16;
const COMPACTION_DEFAULT_MAX_TOKENS = 8192;
const COMPACTION_DEFAULT_RETRIES = 1;
const COMPACTION_DEFAULT_OVERFLOW_RETRIES = 1;
const DEFAULT_COMPACTION_VALUES = Object.freeze({
  thresholdRatio: COMPACTION_DEFAULT_THRESHOLD_RATIO,
  retainRatio: COMPACTION_DEFAULT_RETAIN_RATIO,
  maxTokens: COMPACTION_DEFAULT_MAX_TOKENS,
  compactionRetries: COMPACTION_DEFAULT_RETRIES,
  maxOverflowRetries: COMPACTION_DEFAULT_OVERFLOW_RETRIES
});
const COMPACTION_MIN_THRESHOLD_RATIO = 0.6;
const COMPACTION_MAX_THRESHOLD_RATIO = 0.9;
const COMPACTION_MIN_RETAIN_RATIO = 0.01;
const COMPACTION_MAX_RETAIN_RATIO = 0.3;
const COMPACTION_MIN_MAX_TOKENS = 256;
const COMPACTION_MAX_MAX_TOKENS = 65536;
const COMPACTION_MIN_RETRIES = 0;
const COMPACTION_MAX_RETRIES = 10;
const compactionConfigDomainSpec = defineDomain({
  name: 'dsh_session_kit_compaction_config',
  version: 1,
  global: {
    schema: z.object({
      enabled: z.boolean().optional(),
      thresholdRatio: z.number().optional(),
      retainRatio: z.number().optional(),
      maxTokens: z.number().optional(),
      compactionRetries: z.number().optional(),
      maxOverflowRetries: z.number().optional()
    }),
    initial: {}
  },
  tables: {}
});
const sidebarEntriesDomainSpec = defineDomain({
  name: 'dsh_session_kit_sidebar_entries',
  version: 1,
  global: {
    schema: z.object({
      memoryVisible: z.boolean().optional(),
      archiveVisible: z.boolean().optional(),
      taskVisible: z.boolean().optional(),
      leftNavEnabled: z.boolean().optional(),
      rightNavEnabled: z.boolean().optional(),
      /* 「会话里显示记忆 tab」开关（settings 的 session-kit 分节）。 */
      memoryTabVisible: z.boolean().optional()
    }),
    initial: {}
  },
  tables: {}
});
/* 对话操作按钮菜单（全局）：把一轮里的多个图标按钮收进一个「列表」菜单。
   两个开关各自独立：用户轮 / 助手轮可以只合并一侧。
   actions 存的是【动作 key 数组】，不是渲染结果 —— 前端按 key 查真实按钮组件，
   这样「选几个就渲染几个」，改少时被移除的按钮自然回到独立渲染，不会残留。 */
const dispatchMenuDomainSpec = defineDomain({
  name: 'dsh_session_kit_dispatch_menu',
  version: 1,
  global: {
    schema: z.object({
      userEnabled: z.boolean().optional(),
      assistantEnabled: z.boolean().optional(),
      userActions: z.array(z.string()).optional(),
      assistantActions: z.array(z.string()).optional(),
      /* 「会话输入框显示基于上下文的分叉会话按钮」开关（v12.75）：
         与两个菜单开关同域同模块（「对话操作按钮设置」里一个保存按钮统一提交），
         但语义独立 —— 它控制的不是轮次按钮收纳，而是输入框新增的分叉按钮。 */
      composerForkButtonEnabled: z.boolean().optional()
    }),
    initial: {}
  },
  tables: {}
});
const globalPromptDomainSpec = defineDomain({  name: 'dsh_session_kit_global_prompt',
  version: 1,
  global: {
    schema: z.object({
      enabled: z.boolean().optional(),
      text: z.string().optional()
    }),
    initial: {}
  },
  tables: {}
});
/* 任务自动注入开关（全局）。关闭后不再自动匹配注入未完成任务提示；
   模型仍可主动用 task_list / task_inject 查看与注入。 */
const taskAutoInjectDomainSpec = defineDomain({
  name: 'dsh_session_kit_task_auto_inject',
  version: 1,
  global: {
    schema: z.object({
      enabled: z.boolean().optional()
    }),
    initial: {}
  },
  tables: {}
});
/* 任务自动提取开关（v12.92，全局，默认关闭）：控制会话 todo 是否自动派生新任务
   档案；手动提取与已绑定任务的采集不受影响。 */
const taskAutoExtractDomainSpec = defineDomain({
  name: 'dsh_session_kit_task_auto_extract',
  version: 1,
  global: {
    schema: z.object({
      enabled: z.boolean().optional()
    }),
    initial: {}
  },
  tables: {}
});
/* 记忆数据保存目录（全局）。必须存在 storageDomain 而非 memory.sqlite 内：
   否则"库在哪"这个事实本身要存在库里，形成鸡生蛋问题。mode 为 default 时
   用 profile 下的 .dsh-session-kit；为 custom 时用 customPath 绝对路径。 */
const memoryStorageDomainSpec = defineDomain({
  name: 'dsh_session_kit_memory_storage',
  version: 1,
  global: {
    schema: z.object({
      mode: z.string().optional(),
      customPath: z.string().optional()
    }),
    initial: {}
  },
  tables: {}
});
/* 自动归档（v13.15）：DSH 启动时 + 每日各扫描一次全部工作区的会话，
   把【最后更新时间】超过 N 天的会话批量移入归档集（侧边栏隐藏），
   并把本轮结果留给客户端在右下角弹一次提醒。
   为什么必须存在 storageDomain：启用态、天数、上次扫描时间、上次归档清单
   都是"跨重启"的事实，不能只放内存。 */
const autoArchiveDomainSpec = defineDomain({
  name: 'dsh_session_kit_auto_archive',
  version: 1,
  global: {
    schema: z.object({
      enabled: z.boolean().optional(),
      /* 阈值天数：1–365，默认 30（保守值，见 normalizeAutoArchive）。 */
      idleDays: z.number().optional(),
      /* 上次真正执行扫描的时间戳，用于"每日一次"的节流判断。 */
      lastScanAt: z.number().optional(),
      /* 上次扫描的归档结果（客户端取走后置为已读，避免重复弹窗）。 */
      lastResultAt: z.number().optional(),
      lastResultIds: z.array(z.string()).optional(),
      lastResultPendingToast: z.boolean().optional()
    }),
    initial: {}
  },
  tables: {}
});
const AUTO_ARCHIVE_DEFAULT_IDLE_DAYS = 30;
const AUTO_ARCHIVE_MIN_IDLE_DAYS = 1;
const AUTO_ARCHIVE_MAX_IDLE_DAYS = 365;
/* 每日一次的扫描间隔：24h。登录态长期不关机的用户也能跨过阈值，
   只在启动时扫一次会漏掉"开机后再挂三天才过期"的会话。 */
const AUTO_ARCHIVE_SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000;

const MAX_SESSION_BODY_BYTES = 65536;
const MAX_TURNS_DEL_BODY_BYTES = 512 * 1024;
const DEFAULT_ARCHIVE_PREVIEW_LIMIT = 30;
const MAX_ARCHIVE_PREVIEW_LIMIT = 100000;
/* 目录（用户对话列表）单次返回上限：防御性上限，正常客户端请求 ≤100 条/页。 */
const MAX_ARCHIVE_PREVIEW_TOC_LIMIT = 1000;
const deletedSessionIds = new Set();

function normalizeSidebarEntries(value) {
  return {
    memoryVisible: value?.memoryVisible !== false,
    archiveVisible: value?.archiveVisible !== false,
    taskVisible: value?.taskVisible !== false,
    leftNavEnabled: value?.leftNavEnabled !== false,
    rightNavEnabled: value?.rightNavEnabled !== false,
    memoryTabVisible: value?.memoryTabVisible !== false
  };
}

/* 默认关闭（v12.91，用户要求）：未显式开启即视为 false。
   ⚠️ 已显式开启过的用户不受影响 —— 存储里是显式 true，读取不变。 */
function normalizeTaskAutoInject(value) {
  return { enabled: value?.enabled === true };
}

/* 自动归档设置归一化。enabled 默认 false（不主动替用户动归档集）；
   idleDays 缺省/非法/越界一律钳到 1–365，默认 30 —— 天数写错时宁可保守，
   也不要把用户刚用过的会话归档掉。 */
function normalizeAutoArchive(value) {
  const rawDays = Number(value?.idleDays);
  const idleDays = Number.isFinite(rawDays)
    ? Math.min(AUTO_ARCHIVE_MAX_IDLE_DAYS, Math.max(AUTO_ARCHIVE_MIN_IDLE_DAYS, Math.round(rawDays)))
    : AUTO_ARCHIVE_DEFAULT_IDLE_DAYS;
  return {
    enabled: value?.enabled === true,
    idleDays,
    lastScanAt: Number.isFinite(Number(value?.lastScanAt)) ? Number(value.lastScanAt) : 0,
    lastResultAt: Number.isFinite(Number(value?.lastResultAt)) ? Number(value.lastResultAt) : 0,
    lastResultIds: Array.isArray(value?.lastResultIds) ? value.lastResultIds.map(String) : [],
    lastResultPendingToast: value?.lastResultPendingToast === true
  };
}

/* 会话「最后更新时间」：人类真正发过话的时间。
   数据源优先级（与归档列表同源，避免两处口径漂移）：
     1. 投影缓存 sessionListMetadata.lastPromptAt —— 核心的列表口径，
        冷会话零 I/O 就能读到（实测 74 个会话全读 18ms）；
     2. header.createdAt 兜底（从未发言的空会话）；
     3. 以上都缺时（投影缓存未播种）由调用方回退读日志尾部。
   ⚠️ 不用日志目录 mtime：归档会话的日志目录常已被删，mtime 还会被
   无关文件写入刷新，用它判定"多久没说话"会误判。 */
function sessionLastActiveAt(header, values) {
  const createdAt = Number(header?.createdAt) || 0;
  const lastPromptAt = Number(values?.sessionListMetadata?.lastPromptAt) || 0;
  return Math.max(createdAt, lastPromptAt);
}

function autoArchiveStoreOf(store) {
  return normalizeAutoArchive(store.global.get());
}

/* ── 对话操作按钮菜单（dispatch menu）──
   两个开关默认【关闭】—— 用户没主动开启时，按钮照旧一字排开，行为零变化。
   动作 key 是前后端契约：
     用户轮  : edit / refresh / distill / delete
     助手轮  : refresh / distill / memory / delete
   顺序固定按声明顺序输出（不信任存储里的数组顺序），保证菜单项次序稳定。
   选了但已不存在的 key 直接丢弃（白名单过滤），避免菜单里出现空项。 */
const DISPATCH_USER_ACTIONS = Object.freeze(['edit', 'refresh', 'distill', 'delete']);
const DISPATCH_ASSISTANT_ACTIONS = Object.freeze(['refresh', 'distill', 'memory', 'delete']);
/* 未显式选择过时的默认全选 —— 开关刚打开就有完整菜单，不出现空菜单。 */
function normalizeDispatchActions(value, allowed) {
  const list = Array.isArray(value) ? value : undefined;
  if (list === undefined) return [...allowed];
  const wanted = new Set(list.map((item) => String(item ?? '').trim()).filter(Boolean));
  /* 空数组是合法选择（用户明确把菜单项全取消），不回落到全选。 */
  return allowed.filter((key) => wanted.has(key));
}
function normalizeDispatchMenu(value) {
  return {
    userEnabled: value?.userEnabled === true,
    assistantEnabled: value?.assistantEnabled === true,
    userActions: normalizeDispatchActions(value?.userActions, DISPATCH_USER_ACTIONS),
    assistantActions: normalizeDispatchActions(value?.assistantActions, DISPATCH_ASSISTANT_ACTIONS),
    /* 分叉按钮开关同样默认关闭：不显式开启时输入框不出现任何新按钮。 */
    /* v12.93：默认开启 —— 未显式关闭即视为开启；显式关闭过的用户不受影响。 */
    composerForkButtonEnabled: value?.composerForkButtonEnabled !== false
  };
}

const MEMORY_STORAGE_MODE_DEFAULT = 'default';
const MEMORY_STORAGE_MODE_CUSTOM = 'custom';

/* 记忆数据保存目录设置。mode 非 custom 一律回落到 default；
   custom 模式缺少可用路径时同样回落，避免把库指到空路径上。
   default 模式一律清空 customPath，防止旧路径残留在快照里造成误解。 */
function normalizeMemoryStorage(value) {
  const mode = value?.mode === MEMORY_STORAGE_MODE_CUSTOM ? MEMORY_STORAGE_MODE_CUSTOM : MEMORY_STORAGE_MODE_DEFAULT;
  const customPath = typeof value?.customPath === 'string' ? value.customPath.trim() : '';
  if (mode !== MEMORY_STORAGE_MODE_CUSTOM || customPath.length === 0) {
    return { mode: MEMORY_STORAGE_MODE_DEFAULT, customPath: '' };
  }
  return { mode, customPath };
}

/* Windows 路径大小写不敏感，判定"是否等于默认目录"必须按大小写无关比较，
   否则用户换个盘符/目录大小写就能把库指到默认目录，绕过守卫。
   同时容忍尾部分隔符差异：两侧归一化程度不同（一侧来自 join，一侧来自 resolve）。 */
function samePath(left, right) {
  const strip = (value) => {
    const text = String(value ?? '');
    return text.length > 3 ? text.replace(/[\\/]+$/u, '') : text;
  };
  const a = strip(left);
  const b = strip(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/* profile 下的默认数据目录：与 memory.js 的 pluginDataDir 保持同一位置
   （<profile>/.dsh-session-kit）。此处只做路径推导，不创建目录。 */
function defaultMemoryDataDir() {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.dsh-session-kit');
}

/* 自定义目录校验：必须是绝对路径，且不能指向默认目录（等价于默认模式）。
   返回规范化后的绝对路径或错误码。 */
function resolveCustomMemoryDir(rawPath) {
  const text = typeof rawPath === 'string' ? rawPath.trim() : '';
  if (text.length === 0) return { error: 'invalid-memory-storage-path' };
  if (text.length > 1024) return { error: 'invalid-memory-storage-path' };
  if (!isAbsolute(text)) return { error: 'memory-storage-path-not-absolute' };
  let normalized;
  try {
    normalized = resolve(text);
  } catch {
    return { error: 'invalid-memory-storage-path' };
  }
  if (samePath(normalized, resolve(defaultMemoryDataDir()))) return { error: 'memory-storage-path-is-default' };
  return { value: normalized };
}

/* 保存时探测目录可用性：不存在则尝试创建，并写入一个探针文件确认可写。
   不做这道检查的话，用户填了不存在的盘符（如 Z:\mem）也能保存成功，
   重启后 MemoryStore 构造期的 mkdirSync 会抛错，导致记忆与任务功能整体不可用。
   探针文件用完立即删除，不污染用户目录。

   先做显式类型检查再建目录：路径已存在但**不是目录**（用户误填了某个文件，
   如 D:\notes.txt）时必须单独报错。虽然 mkdirSync 也会抛 EEXIST/ENOTDIR 拦住，
   但那样只能落到笼统的"目录不可用"，用户看不出真正原因是"这是个文件"。
   另外还要排除非目录的特殊路径（设备文件、符号链接指向文件等）。 */
function probeMemoryDir(dir) {
  try {
    const existing = statSync(dir, { throwIfNoEntry: false });
    if (existing !== undefined && !existing.isDirectory()) {
      return { error: 'memory-storage-path-not-a-directory' };
    }
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    /* 建目录后复核一次：路径的父级若是文件（file\sub），或存在同名特殊文件，
       mkdir 可能已通过但最终落点并非目录。 */
    const settled = statSync(dir, { throwIfNoEntry: false });
    if (settled === undefined || !settled.isDirectory()) {
      return { error: 'memory-storage-path-not-a-directory' };
    }
    const probe = join(dir, '.dsh-session-kit-write-probe');
    writeFileSync(probe, '');
    rmSync(probe, { force: true });
    return { ok: true };
  } catch (error) {
    const code = error?.code;
    if (code === 'EEXIST' || code === 'ENOTDIR') return { error: 'memory-storage-path-not-a-directory' };
    return { error: 'memory-storage-path-unusable', detail: error instanceof Error ? error.message : String(error) };
  }
}

/* 设置 → 实际数据目录。custom 模式路径不可用时回落默认目录，
   保证记忆功能始终有可用位置（坏设置不导致功能不可用）。 */
function memoryDataDirFor(settings) {
  if (settings?.mode === MEMORY_STORAGE_MODE_CUSTOM) {
    const resolved = resolveCustomMemoryDir(settings.customPath);
    if (resolved.value !== undefined) return resolved.value;
  }
  return defaultMemoryDataDir();
}

function respond(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  res.end(body);
}

function readJsonBody(req, maxBytes = MAX_SESSION_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const decoder = new TextDecoder();
    let text = '';
    let bytes = 0;
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      bytes += typeof chunk === 'string' ? new TextEncoder().encode(chunk).length : chunk.byteLength;
      if (bytes > maxBytes) {
        settled = true;
        reject(new TypeError('request body is too large'));
        return;
      }
      text += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        text += decoder.decode();
        resolve(JSON.parse(text));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function sessionIdOf(body) {
  const id = body?.sessionId;
  return typeof id === 'string' && SESSION_ID_RE.test(id) ? id : undefined;
}

function openSystemFolder(dir) {
  if (process.platform === 'win32') childSpawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref();
  else if (process.platform === 'darwin') childSpawn('open', [dir], { detached: true, stdio: 'ignore' }).unref();
  else childSpawn('xdg-open', [dir], { detached: true, stdio: 'ignore' }).unref();
}

function moveToSystemTrash(dir) {
  if (process.platform === 'win32') {
    const escapedPath = dir.replace(/'/g, "''");
    const script = `$p='${escapedPath}'; Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || 'recycle-bin-delete-failed');
    return;
  }
  if (process.platform === 'darwin') {
    const result = spawnSync('osascript', ['-e', `tell application "Finder" to delete POSIX file ${JSON.stringify(dir)}`], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || 'trash-delete-failed');
    return;
  }
  throw new Error('no-system-trash');
}

async function deleteStoppedSessionDirectory(dir) {
  if (process.platform === 'win32' || process.platform === 'darwin') return moveToSystemTrash(dir);
  const { rm } = await import('node:fs/promises');
  await rm(dir, { recursive: true, force: true });
}

class TurnsDelError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TurnsDelError';
    this.code = code;
  }
}

function sessionEvents(session) {
  if (session === undefined || session === null) return [];
  if (typeof session.snapshotEvents === 'function') {
    try {
      const value = session.snapshotEvents();
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }
  const legacy = session.events;
  return Array.isArray(legacy) ? legacy : [];
}

function isHandleStylePersistence(persistence) {
  return typeof persistence?.open === 'function' && typeof persistence?.readFrom !== 'function';
}

function persistenceHeaderOf(entry) {
  if (entry?.header !== undefined) return entry.header;
  return entry;
}

async function persistenceHeaderById(persistence, sessionId, options) {
  const entries = await persistence.list(options);
  return entries.map(persistenceHeaderOf).find((header) => header?.id === sessionId);
}

async function readPersistedSession(persistence, sessionId, options) {
  if (!isHandleStylePersistence(persistence)) {
    if (typeof persistence?.readFrom !== 'function') throw new TypeError('session persistence backend does not expose a session read API');
    return persistence.readFrom(sessionId, 0);
  }
  let handle;
  let failure;
  try {
    handle = await persistence.open(sessionId, 'read', options);
    return await handle.read(0, Number.MAX_SAFE_INTEGER, options);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch (error) {
        if (failure === undefined) throw error;
      }
    }
  }
}

/* v4 墓碑：user/message 的 surface replace 事件。
   - v4 拒绝通用 kind:'plugin' 包装，必须直接使用 producer-owned source kind。
   - user/message 替换无 turn/step 约束；墓碑内容不进模型上下文（见 tombstone-filter.js）。
   - 元数据（turn/endTurn/regeneration）存于 source.summary 的 JSON。
   识别口径以 source.kind 为准，content 写 [] 还是写可见文字都不影响识别。
   §旧数据兼容：v4 之前存在 dsh-turns-del / plugin:* 形态，且早期墓碑可能没有可识别
   kind；后者退回「空 content」历史判据，保证旧会话的 /ranges 仍可解析。 */
const TURNS_DEL_SOURCE_KINDS = new Set([
  TURNS_DEL_PROVIDER,
  'dsh-turns-del',
  'plugin:dsh-turns-del',
  'plugin:dsh-session-kit-turns-del'
]);
function turnsDelTombstoneMetaOf(event) {
  if (event.type !== 'user/message' || !isReplacementSurfaceEvent(event)) return undefined;
  const data = event.data;
  if (!Array.isArray(data?.content)) return undefined;
  const source = data?.source;
  const kind = source?.kind;
  const kindRecognized = typeof kind === 'string' && TURNS_DEL_SOURCE_KINDS.has(kind);
  if (!kindRecognized && data.content.length !== 0) return undefined;
  let meta = {};
  try {
    const parsed = JSON.parse(source?.summary ?? '');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed;
  } catch {}
  const turn = Number.isSafeInteger(meta.turn) && meta.turn >= 0 ? meta.turn : undefined;
  if (turn === undefined) return undefined;
  const endTurn = Number.isSafeInteger(meta.endTurn) && meta.endTurn >= turn ? meta.endTurn : turn;
  return { turn, endTurn, regeneration: meta.regeneration };
}

function isTurnsDelEvent(event) {
  return turnsDelTombstoneMetaOf(event) !== undefined;
}

function hasInboxPending(agent) {
  const inbox = agent?.inbox;
  if (inbox === undefined || inbox === null) return false;
  if (typeof inbox.hasPending === 'function') {
    try {
      return inbox.hasPending() === true;
    } catch {
      return false;
    }
  }
  if (inbox.hasPending === true) return true;
  return (Array.isArray(inbox.nextTurn) && inbox.nextTurn.length > 0)
    || (Array.isArray(inbox.nextStep) && inbox.nextStep.length > 0);
}

/* Prefer the Agent's atomic maintenance lock. A transient active-work race is
   awaited via whenIdle and retried; queued inbox messages remain queued and are
   processed after maintenance releases the lock. */
async function runAgentMaintenance(agent, fn) {
  if (typeof agent?.runMaintenance === 'function') {
    for (;;) {
      try {
        return await agent.runMaintenance(fn);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/already has active work/i.test(message) || typeof agent.whenIdle !== 'function') throw error;
        await agent.whenIdle();
      }
    }
  }
  if (agent?.status === 'running' || hasInboxPending(agent)) throw new TurnsDelError('AGENT_BUSY', 'session is running or has queued input; retry when it is idle');
  const controller = new AbortController();
  return fn(controller.signal);
}

function eventTurn(event) {
  if (event.type === 'assistant/message' || event.type === 'tool/result') return event.data.turn;
}

/* 轮次区间。手动停止时 turn/end 比 step/end 晚约 2ms 落盘，点击落在这个间隙里
   会取不到 turn/end（旧实现直接返回 undefined → TURN_NOT_CLOSED）。此时退化为
   “turn/start 之后到该轮最后一条事件”，让提问仍可被定位——删除路径本来就有
   同类兜底（turnEndSeq），这里补齐，避免刷新/编辑比删除更脆。 */
function turnBracket(events, turn, targetSeq) {
  const start = events.findLast((event) => event.seq <= targetSeq && event.type === 'turn/start' && event.data.turn === turn);
  if (start === undefined) return undefined;
  const end = events.find((event) => event.seq >= targetSeq && event.type === 'turn/end' && event.data.turn === turn);
  if (end !== undefined) return { start: start.seq, end: end.seq };
  const lastOfTurn = events.findLast((event) => event.data?.turn === turn && event.seq > start.seq);
  if (lastOfTurn === undefined) return undefined;
  return { start: start.seq, end: lastOfTurn.seq + 1 };
}

function surfaceOrigins(seq, events, memo, visiting = new Set()) {
  const cached = memo.get(seq);
  if (cached !== undefined) return cached;
  if (visiting.has(seq)) return new Set();
  visiting.add(seq);
  const event = events[seq];
  const origins = new Set();
  if (event !== undefined) {
    if (isAppendSurfaceEvent(event)) origins.add(seq);
    for (const source of event.sourceEventSeqs ?? []) {
      for (const origin of surfaceOrigins(source, events, memo, visiting)) origins.add(origin);
    }
  }
  visiting.delete(seq);
  memo.set(seq, origins);
  return origins;
}

function eventTurns(events) {
  const turns = new Map();
  let activeTurn;
  for (const event of events) {
    if (event.type === 'turn/start') {
      activeTurn = event.data.turn;
      continue;
    }
    const explicitTurn = eventTurn(event);
    if (explicitTurn !== undefined) turns.set(event.seq, explicitTurn);
    else if (activeTurn !== undefined) turns.set(event.seq, activeTurn);
    if (event.type === 'turn/end' && activeTurn === event.data.turn) activeTurn = undefined;
  }
  return turns;
}

function deletionTombstoneForOrigin(events, originSeq, memo) {
  return events.find((event) => isTurnsDelEvent(event) && surfaceOrigins(event.seq, events, memo).has(originSeq));
}

function deletionTombstoneForTurn(events, turn) {
  return events.find((event) => {
    const meta = turnsDelTombstoneMetaOf(event);
    return meta !== undefined && turn >= meta.turn && turn <= meta.endTurn;
  });
}

function completedTurnsFrom(events, startTurn) {
  return events
    .filter((event) => event.type === 'turn/end' && event.data.turn >= startTurn)
    .map((event) => event.data.turn);
}

function turnEndSeq(events, turn) {
  const end = events.find((event) => event.type === 'turn/end' && event.data.turn === turn);
  if (end === undefined) throw new TurnsDelError('TURN_NOT_CLOSED', `turn ${String(turn)} is not closed`);
  return end.seq;
}

function appendOriginsForTurn(events, turn, targetSeq) {
  const bracket = turnBracket(events, turn, targetSeq);
  if (bracket === undefined) throw new TurnsDelError('TURN_NOT_CLOSED', `turn ${String(turn)} is not closed`);
  return new Set(events
    .filter((event) => isAppendSurfaceEvent(event) && ((event.seq > bracket.start && event.seq < bracket.end) || eventTurn(event) === turn))
    .map((event) => event.seq));
}

function selectIndependentTurnSurface(session, events, turn, targetSeq, options = {}) {
  const originSeqs = appendOriginsForTurn(events, turn, targetSeq);
  /* 预检阶段传入模拟 surface：逐轮模拟替换，检查整批删除是否全部可行。 */
  const currentNodes = options.nodes ?? session.surface.nodes;
  /* node 0 受系统头保护：只能被恰好覆盖它的 system/message 重写。system prompt
     会在后续轮次被反复重写（7 → 43 → 67），最新节点成为 node 0，但它的 origin
     链仍指向首轮的 seq 7。因此仅“删除 headSeq 这个 origin”不够——删除首轮时
     node 0 会因 origin 7 命中而被选中。这里直接跳过受保护的 node 0：墓碑是
     user/message，永远不能覆盖系统头，保留它才是正确语义。 */
  const headSeq = currentNodes[0];
  const headProtected = headSeq !== undefined && events[headSeq]?.type === 'system/message';
  if (headProtected) originSeqs.delete(headSeq);
  const targetOnSurface = currentNodes.includes(targetSeq);
  if (options.requireTargetNode !== false && !targetOnSurface) throw new TurnsDelError('TURN_COMPACTED', `turn ${String(turn)} is no longer independently deletable`);
  const memo = new Map();
  const selected = [];

  for (const seq of currentNodes) {
    if (headProtected && seq === headSeq) continue;
    const origins = surfaceOrigins(seq, events, memo);
    const targetOrigins = [...origins].filter((origin) => originSeqs.has(origin));
    if (targetOrigins.length === 0) continue;
    if ([...origins].some((origin) => !originSeqs.has(origin))) throw new TurnsDelError('TURN_COMPACTED', `turn ${String(turn)} shares a compacted surface node`);
    selected.push(seq);
  }

  if (selected.length === 0) throw new TurnsDelError('TARGET_NOT_FOUND', `turn ${String(turn)} has no live surface nodes`);
  const positions = selected.map((seq) => currentNodes.indexOf(seq));
  const first = positions[0];
  if (first === undefined || positions.some((position, index) => position !== first + index)) throw new TurnsDelError('TURN_COMPACTED', `turn ${String(turn)} is not a contiguous surface span`);
  return selected;
}

/* 墓碑正文使用零宽空格（U+200B）而非空数组：
   - 空数组经各适配器压平后是空字符串，openai-responses 的字符串分支没有空判断，
     会发出 {input_text:''} —— 严格网关返回 400（content cannot be empty）。
   - U+200B 属 Unicode 格式字符（Cf），不在 trim() 移除的空白集合（Zs）内，
     因此非空，能通过所有 provider 的「内容不得为空」校验。
   - 视觉不可见，模型侧仅多一个无意义 token；插件在线时仍由 llm/stream 过滤掉，
     模型完全看不到。这样「插件停用」也不再触发 400。 */
const TOMBSTONE_PLACEHOLDER_TEXT = '\u200b';
function appendTurnTombstone(session, turn, endTurn, selected, regeneration) {
  const message = createUserMessage({
    content: [{ type: 'text', text: TOMBSTONE_PLACEHOLDER_TEXT }],
    source: {
      kind: TURNS_DEL_PROVIDER,
      form: 'notice',
      summary: JSON.stringify({ turn, endTurn, ...(regeneration === undefined ? {} : { regeneration }) })
    }
  });
  return session.append('user/message', message, {
    surfaceOp: { op: 'replace', startSeq: selected[0], endSeq: selected.at(-1) },
    sourceEventSeqs: selected
  });
}

function deleteTurnsUnderMaintenance(ctx, agent, assistantMessageId, signal, options = {}) {
  const { flush = true, regeneration } = options;
  signal.throwIfAborted();
  const session = agent.session;
  if (ctx.sessions.get(session.id) !== session) throw new TurnsDelError('TARGET_NOT_FOUND', `session "${session.id}" is no longer live`);

  const initialEvents = sessionEvents(session);
  const byTurn = typeof options.byTurn === 'number' && Number.isSafeInteger(options.byTurn) && options.byTurn >= 0 ? options.byTurn : undefined;
  const target = byTurn === undefined
    ? initialEvents.find((event) => event.type === 'assistant/message' && isAppendSurfaceEvent(event) && event.data.message.id === assistantMessageId)
    : initialEvents.findLast((event) => event.type === 'assistant/message' && isAppendSurfaceEvent(event) && event.data.turn === byTurn);
  if (target === undefined && byTurn === undefined) throw new TurnsDelError('TARGET_NOT_FOUND', `assistant message "${assistantMessageId}" was not found`);

  const startTurn = byTurn ?? target.data.turn;
  const targetSeq = target?.seq ?? turnEndSeq(initialEvents, startTurn);
  if (turnBracket(initialEvents, startTurn, targetSeq) === undefined) throw new TurnsDelError('TURN_NOT_CLOSED', `turn ${String(startTurn)} is not closed`);

  const targetMemo = new Map();
  const existingTarget = target === undefined ? undefined : deletionTombstoneForOrigin(initialEvents, target.seq, targetMemo);
  if (existingTarget !== undefined) {
    const existingMeta = turnsDelTombstoneMetaOf(existingTarget);
    return {
      turn: startTurn,
      endTurn: existingMeta?.endTurn ?? startTurn,
      seqs: [existingTarget.seq],
      deletedTurns: [],
      alreadyDeleted: true
    };
  }

  // Capture only completed turns and process them in reverse order, so an earlier
  // turn is always planned against the surface left by the later ones. Planning is
  // separated from appending so an impossible batch changes nothing (see below).
  const requestedTurns = completedTurnsFrom(initialEvents, startTurn);
  if (requestedTurns.length === 0) throw new TurnsDelError('TURN_NOT_CLOSED', `turn ${String(startTurn)} is not closed`);

  const initiallyDeletedTurns = new Set(requestedTurns.filter((turn) => deletionTombstoneForTurn(initialEvents, turn) !== undefined));
  const deletedTurns = [];
  const tombstoneSeqs = [];
  const rangeEndTurn = requestedTurns.at(-1);

  /* 两阶段执行：先在内存里对每一轮做一次模拟替换，确认整批删除都可行，
     再真正 append。否则从后往前逐轮写入时，靠后的轮次已经落盘，才在某一轮
     因压缩而失败——接口报错，模型上下文却已被改动（用户看到失败，实际已删）。 */
  const plan = [];
  {
    let simulated = [...session.surface.nodes];
    for (const turn of [...requestedTurns].reverse()) {
      signal.throwIfAborted();
      if (initiallyDeletedTurns.has(turn)) continue;
      const events = sessionEvents(session);
      const clickedTarget = byTurn === undefined && turn === startTurn ? target : undefined;
      const assistant = clickedTarget ?? events.findLast((event) => event.type === 'assistant/message' && isAppendSurfaceEvent(event) && event.data.turn === turn && simulated.includes(event.seq))
        ?? events.findLast((event) => event.type === 'assistant/message' && isAppendSurfaceEvent(event) && event.data.turn === turn);
      const selectSeq = clickedTarget?.seq ?? assistant?.seq ?? turnEndSeq(events, turn);
      const selected = selectIndependentTurnSurface(session, events, turn, selectSeq, {
        requireTargetNode: clickedTarget !== undefined,
        nodes: simulated
      });
      /* 模拟该轮替换后的 surface，供下一轮（更早的轮次）预检使用。 */
      const startIdx = simulated.indexOf(selected[0]);
      simulated = [...simulated.slice(0, startIdx), -1, ...simulated.slice(startIdx + selected.length)];
      plan.push({ turn, selected });
    }
  }

  /* 写入阶段：多个轮次的墓碑能否合并成一个？
     每轮的 i 遮蔽片段各自独立，但同一批删除里这些片段通常是紧邻的（轮与轮之间
     没有插进不删除的 surface 节点）。紧邻时一个 replace 就能覆盖整段，只需一个墓碑：
     原来逐轮写入会留下 N 份内容完全相同的墓碑（summary 都写同一对 turn/endTurn），
     既占日志又是纯冗余。因此先按真实 surface 校验片段是否构成连续区间，
     连续则合并为单个墓碑，否则退回逐轮写入（保持原有行为，绝不误伤夹层节点）。 */
  const realNodes = session.surface.nodes;
  const nodeIndex = new Map(realNodes.map((seq, index) => [seq, index]));
  const planSelected = plan.flatMap(({ selected }) => selected);
  /* ⚠️ plan 是逆序生成的（后轮先算），flatMap 拼出的 seq 顺序并非 surface 顺序。
     appendTurnTombstone 以 selected[0]/selected.at(-1) 作为 replace 的首尾端点，
     因此必须先按真实 surface 位置升序重排，否则会得到 startSeq > endSeq 的非法区间。 */
  const mergedSelected = planSelected
    .map((seq) => ({ seq, position: nodeIndex.get(seq) }))
    .filter((entry) => entry.position !== undefined)
    .sort((left, right) => left.position - right.position)
    .map((entry) => entry.seq);
  let canMerge = mergedSelected.length > 0 && mergedSelected.length === planSelected.length;
  if (canMerge) {
    const positions = mergedSelected.map((seq) => nodeIndex.get(seq));
    canMerge = positions.every((position, index) => index === 0 || position === positions[index - 1] + 1);
  }
  if (canMerge) {
    signal.throwIfAborted();
    const tombstone = appendTurnTombstone(session, startTurn, rangeEndTurn, mergedSelected, regeneration);
    for (const { turn } of [...plan].reverse()) deletedTurns.unshift(turn);
    tombstoneSeqs.unshift(tombstone.seq);
  } else {
    for (const { turn, selected } of plan) {
      signal.throwIfAborted();
      const tombstone = appendTurnTombstone(session, startTurn, rangeEndTurn, selected, regeneration);
      deletedTurns.unshift(turn);
      tombstoneSeqs.unshift(tombstone.seq);
    }
  }

  if (tombstoneSeqs.length === 0) return {
    turn: startTurn,
    endTurn: requestedTurns.at(-1) ?? startTurn,
    seqs: [],
    deletedTurns: [],
    alreadyDeleted: true
  };

  const result = {
    turn: startTurn,
    endTurn: requestedTurns.at(-1),
    seqs: tombstoneSeqs,
    deletedTurns,
    alreadyDeleted: false
  };
  if (!flush) return result;
  return ctx.sessions.flush(session).then((durable) => {
    if (durable !== true) throw new Error('session deletion was applied in memory but no persistence listener confirmed a durable flush');
    return result;
  });
}

async function deleteTurns(ctx, agent, assistantMessageId) {
  try {
    return await runAgentMaintenance(agent, (signal) => deleteTurnsUnderMaintenance(ctx, agent, assistantMessageId, signal));
  } catch (error) {
    if (error instanceof TurnsDelError) throw error;
    throw new TurnsDelError('DELETE_FAILED', error instanceof Error ? error.message : String(error));
  }
}

async function deleteTurnsByTurn(ctx, agent, turn) {
  try {
    return await runAgentMaintenance(agent, (signal) => deleteTurnsUnderMaintenance(ctx, agent, undefined, signal, { byTurn: turn }));
  } catch (error) {
    if (error instanceof TurnsDelError) throw error;
    throw new TurnsDelError('DELETE_FAILED', error instanceof Error ? error.message : String(error));
  }
}

function decodeTurnsDelRequest(value) {
  if (typeof value !== 'object' || value === null) throw new TypeError('request body must be an object');
  if (typeof value.sessionId !== 'string' || value.sessionId.length === 0) throw new TypeError('sessionId must be a non-empty string');
  if (typeof value.assistantMessageId !== 'string' || value.assistantMessageId.length === 0) throw new TypeError('assistantMessageId must be a non-empty string');
  return { sessionId: value.sessionId, assistantMessageId: value.assistantMessageId };
}

/* promptSeq 可选：用户消息行上的按钮会带上它所依附提问的 seq，用于在一轮多条
   提问时精确重发被点击的那一条；旧客户端不传则退回“最近一条”规则。 */
function decodePromptSeq(value) {
  if (value.promptSeq === undefined || value.promptSeq === null) return {};
  if (!Number.isSafeInteger(value.promptSeq) || value.promptSeq < 0) throw new TypeError('promptSeq must be a non-negative integer');
  return { promptSeq: value.promptSeq };
}

function decodeTurnRequest(value) {
  if (typeof value !== 'object' || value === null) throw new TypeError('request body must be an object');
  if (typeof value.sessionId !== 'string' || value.sessionId.length === 0) throw new TypeError('sessionId must be a non-empty string');
  if (!Number.isSafeInteger(value.turn) || value.turn < 0) throw new TypeError('turn must be a non-negative integer');
  return { sessionId: value.sessionId, turn: value.turn, ...decodePromptSeq(value) };
}

function decodeRegenerateRequest(value) {
  const input = decodeTurnsDelRequest(value);
  if (typeof value.operationId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(value.operationId)) throw new TypeError('operationId must contain 8-128 letters, digits, underscores, or hyphens');
  return { ...input, operationId: value.operationId };
}

function decodeRegenerateTurnRequest(value) {
  const input = decodeTurnRequest(value);
  if (typeof value.operationId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(value.operationId)) throw new TypeError('operationId must contain 8-128 letters, digits, underscores, or hyphens');
  return { ...input, operationId: value.operationId };
}

function decodeEditRegenerateTurnRequest(value) {
  const input = decodeRegenerateTurnRequest(value);
  if (typeof value.text !== 'string') throw new TypeError('text must be a string');
  const text = value.text;
  if (text.trim().length === 0) throw new TypeError('text must not be empty');
  if (text.length > 200000) throw new TypeError('text is too large');
  return { ...input, text };
}

/* 定位“该重发哪一条提问”。一轮里出现多条用户提问是正常现象——手动停止上一轮后
   新输入会被内核并入仍在跑的轮次（见 turn 10：1547 与 1603 同轮）。旧实现要求
   “恰好一条”，导致这类轮次的刷新/编辑必然抛 PROMPT_AMBIGUOUS；删除有兜底所以
   不受影响，这解释了“删除能用而刷新不能用”。
   选取规则：显式给了 promptSeq 就取那一条（用户消息行点哪条发哪条）；否则取
   targetSeq 之前最近的一条——即该助手消息实际回复的那条提问。 */
function userPromptForTurn(events, turn, targetSeq, promptSeq) {
  const bracket = turnBracket(events, turn, targetSeq);
  if (bracket === undefined) throw new TurnsDelError('TURN_NOT_CLOSED', `turn ${String(turn)} is not closed`);
  const prompts = events.filter((event) => event.type === 'user/message'
    && isAppendSurfaceEvent(event)
    && event.seq > bracket.start
    && event.seq < bracket.end
    && event.data.source?.kind === 'user');
  if (prompts.length === 0) throw new TurnsDelError('PROMPT_NOT_FOUND', `turn ${String(turn)} has no user prompt to regenerate`);
  let selected;
  if (promptSeq !== undefined) {
    selected = prompts.find((event) => event.seq === promptSeq);
    if (selected === undefined) throw new TurnsDelError('PROMPT_NOT_FOUND', `turn ${String(turn)} has no user prompt at seq ${String(promptSeq)}`);
  } else {
    const before = prompts.filter((event) => event.seq < targetSeq);
    selected = before.length > 0 ? before[before.length - 1] : prompts[prompts.length - 1];
  }
  const content = selected.data.content;
  if (!Array.isArray(content) || content.length === 0) throw new TurnsDelError('PROMPT_NOT_FOUND', `turn ${String(turn)} has an empty user prompt`);
  if (content.some((part) => part.type !== 'text')) throw new TurnsDelError('PROMPT_UNSUPPORTED', `turn ${String(turn)} has a non-text prompt that cannot be regenerated safely`);
  return content;
}

function regenerationTombstone(events, operationId) {
  return events.find((event) => turnsDelTombstoneMetaOf(event)?.regeneration?.operationId === operationId);
}

function replayMessageIdForOperation(events, operationId) {
  const replay = events.find((event) => event.type === 'agent/inbox/spliced' && event.data.inserted?.[0]?.source?.rpcId === `dsh-turns-del-regenerate:${operationId}`);
  return replay?.data.inserted?.[0]?.id;
}

async function regenerateTurnsUnderMaintenance(ctx, agent, assistantMessageId, operationId, signal, options = {}) {
  signal.throwIfAborted();
  const session = agent.session;
  if (ctx.sessions.get(session.id) !== session) throw new TurnsDelError('TARGET_NOT_FOUND', `session "${session.id}" is no longer live`);
  const byTurn = typeof options.byTurn === 'number' && Number.isSafeInteger(options.byTurn) && options.byTurn >= 0 ? options.byTurn : undefined;
  const editedText = typeof options.editedText === 'string' ? options.editedText : undefined;
  const promptSeq = Number.isSafeInteger(options.promptSeq) && options.promptSeq >= 0 ? options.promptSeq : undefined;
  const eventsSnapshot = sessionEvents(session);
  const prior = regenerationTombstone(eventsSnapshot, operationId);
  const priorReplayMessageId = replayMessageIdForOperation(eventsSnapshot, operationId);
  if (prior !== undefined && priorReplayMessageId !== undefined) {
    const related = eventsSnapshot
      .map((event) => ({ event, meta: turnsDelTombstoneMetaOf(event) }))
      .filter(({ meta }) => meta?.regeneration?.operationId === operationId)
      .map(({ event, meta }) => ({ event, meta }));
    return {
      deletion: {
        turn: Math.min(...related.map(({ meta }) => meta.turn)),
        endTurn: Math.max(...related.map(({ meta }) => meta.endTurn ?? meta.turn)),
        seqs: related.map(({ event }) => event.seq),
        deletedTurns: [],
        alreadyDeleted: true
      },
      replayMessageId: priorReplayMessageId,
      alreadyRegenerated: true
    };
  }
  // A crash after tombstones but before the inbox splice is recoverable: reuse
  // the durable operation id, finish the same deletion if necessary, and queue
  // exactly one fresh replay below.
  if (hasInboxPending(agent)) throw new TurnsDelError('QUEUE_NOT_EMPTY', 'cannot regenerate while queued input exists');
  const target = byTurn === undefined
    ? eventsSnapshot.find((event) => event.type === 'assistant/message'
      && isAppendSurfaceEvent(event)
      && event.data.message.id === assistantMessageId)
    : eventsSnapshot.findLast((event) => event.type === 'assistant/message'
      && isAppendSurfaceEvent(event)
      && event.data.turn === byTurn);
  if (target === undefined && byTurn === undefined) throw new TurnsDelError('TARGET_NOT_FOUND', `assistant message "${assistantMessageId}" was not found`);
  const turn = byTurn ?? target.data.turn;
  const targetSeq = target?.seq ?? turnEndSeq(eventsSnapshot, turn);
  const originalPrompt = userPromptForTurn(eventsSnapshot, turn, targetSeq, promptSeq);
  const prompt = editedText === undefined ? originalPrompt : [{ type: 'text', text: editedText }];
  const deletion = deleteTurnsUnderMaintenance(ctx, agent, assistantMessageId, signal, {
    flush: false,
    regeneration: { operationId },
    ...(byTurn === undefined ? {} : { byTurn })
  });
  signal.throwIfAborted();
  const replay = createUserMessage({
    content: prompt,
    source: { kind: 'user', rpcId: `dsh-turns-del-regenerate:${operationId}` }
  });
  agent.followup(replay);
  await ctx.sessions.flush(session);
  return { deletion, replayMessageId: replay.id, alreadyRegenerated: false };
}

/* 重新生成复用删除逻辑，失败原因必须原样透出：早前把一切非预期异常都归为
   AGENT_BUSY，导致“系统头保护”这类真实错误被显示成“任务正在运行”。 */
function regenerationFailure(error) {
  if (error instanceof TurnsDelError) return error;
  return new TurnsDelError('REGENERATE_FAILED', error instanceof Error ? error.message : String(error));
}

async function regenerateTurns(ctx, agent, assistantMessageId, operationId) {
  try {
    return await runAgentMaintenance(agent, (signal) => regenerateTurnsUnderMaintenance(ctx, agent, assistantMessageId, operationId, signal));
  } catch (error) {
    throw regenerationFailure(error);
  }
}

async function regenerateTurnsByTurn(ctx, agent, turn, operationId, promptSeq) {
  try {
    return await runAgentMaintenance(agent, (signal) => regenerateTurnsUnderMaintenance(ctx, agent, undefined, operationId, signal, { byTurn: turn, ...(promptSeq === undefined ? {} : { promptSeq }) }));
  } catch (error) {
    throw regenerationFailure(error);
  }
}

async function editRegenerateTurnsByTurn(ctx, agent, turn, operationId, text, promptSeq) {
  try {
    return await runAgentMaintenance(agent, (signal) => regenerateTurnsUnderMaintenance(ctx, agent, undefined, operationId, signal, { byTurn: turn, editedText: text, ...(promptSeq === undefined ? {} : { promptSeq }) }));
  } catch (error) {
    throw regenerationFailure(error);
  }
}

async function handleTurnsDelAction(ctx, req, res, decode, action) {
  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'POST' });
    res.end();
    return;
  }
  const contentType = req.headers?.['content-type'];
  if (typeof contentType !== 'string' || !contentType.toLowerCase().startsWith('application/json')) {
    return respond(res, 415, { ok: false, error: { code: 'INVALID_REQUEST', message: 'application/json required' } });
  }
  try {
    const input = decode(await readJsonBody(req, MAX_TURNS_DEL_BODY_BYTES));
    const agent = ctx.agents.get(SessionId(input.sessionId));
    if (agent === undefined) throw new TurnsDelError('TARGET_NOT_FOUND', `session "${input.sessionId}" is not active`);
    return respond(res, 200, { ok: true, value: await action(ctx, agent, input) });
  } catch (error) {
    if (error instanceof TurnsDelError) {
      return respond(res, error.code === 'AGENT_BUSY' ? 423 : error.code === 'DELETE_FAILED' ? 500 : 409, { ok: false, error: { code: error.code, message: error.message } });
    }
    return respond(res, 400, { ok: false, error: { code: 'INVALID_REQUEST', message: error instanceof Error ? error.message : String(error) } });
  }
}

async function handleTurnsDelRanges(ctx, req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405, { allow: 'GET' });
    res.end();
    return;
  }
  let sessionId;
  try {
    sessionId = new URL(req.url, 'http://localhost').searchParams.get('sessionId');
  } catch { sessionId = null; }
  if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) return respond(res, 400, { ok: false, error: 'invalid-session-id' });
  try {
    const live = ctx.sessions.get(sessionId);
    const events = live === undefined ? await persistedEventsForArchive(ctx, sessionId) : sessionEvents(live);
    const ranges = events
      .map((event) => turnsDelTombstoneMetaOf(event))
      .filter(Boolean)
      .map(({ turn, endTurn }) => ({ startTurn: turn, endTurn }))
      .sort((left, right) => left.startTurn - right.startTurn || left.endTurn - right.endTurn);
    const merged = [];
    for (const range of ranges) {
      const previous = merged.at(-1);
      if (previous !== undefined && range.startTurn <= previous.endTurn + 1) previous.endTurn = Math.max(previous.endTurn, range.endTurn);
      else merged.push({ ...range });
    }
    ctx.logger?.info?.(`[${name}] turns-del ranges: session=${sessionId} source=${live === undefined ? 'persisted' : 'live'} events=${events.length} ranges=${JSON.stringify(merged)}`);
    return respond(res, 200, { ok: true, value: merged });
  } catch (error) {
    const status = error instanceof ArchiveError ? error.status : 500;
    return respond(res, status, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

function handleTurnsDel(ctx, req, res) {
  return handleTurnsDelAction(ctx, req, res, decodeTurnsDelRequest, (runtime, agent, input) => deleteTurns(runtime, agent, MessageId(input.assistantMessageId)));
}

function handleTurnsDelTurn(ctx, req, res) {
  return handleTurnsDelAction(ctx, req, res, decodeTurnRequest, (runtime, agent, input) => deleteTurnsByTurn(runtime, agent, input.turn));
}

function handleRegenerateTurns(ctx, req, res) {
  return handleTurnsDelAction(ctx, req, res, decodeRegenerateRequest, (runtime, agent, input) => regenerateTurns(runtime, agent, MessageId(input.assistantMessageId), input.operationId));
}

function handleRegenerateTurnsByTurn(ctx, req, res) {
  return handleTurnsDelAction(ctx, req, res, decodeRegenerateTurnRequest, (runtime, agent, input) => regenerateTurnsByTurn(runtime, agent, input.turn, input.operationId, input.promptSeq));
}

function handleEditRegenerateTurnsByTurn(ctx, req, res) {
  return handleTurnsDelAction(ctx, req, res, decodeEditRegenerateTurnRequest, (runtime, agent, input) => editRegenerateTurnsByTurn(runtime, agent, input.turn, input.operationId, input.text, input.promptSeq));
}

class ArchiveError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = 'ArchiveError';
    this.code = code;
    this.status = status;
  }
}

function basenameOfPath(path) {
  if (typeof path !== 'string' || path.length === 0) return undefined;
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).at(-1);
}

function archivedHeaderTitle(sessionId, header) {
  const title = typeof header?.title === 'string' ? header.title.trim() : '';
  if (title) return title;
  return `Session ${String(sessionId).slice(0, 8)}`;
}

function archivedTitle(events, sessionId, header) {
  const explicit = events.findLast((event) => event.type === 'session/title' && typeof event.data.title === 'string')?.data.title?.trim();
  if (explicit) return explicit;
  const prompt = events.find((event) => event.type === 'user/message' && event.data.source?.kind === 'user' && Array.isArray(event.data.content));
  const text = prompt?.data.content?.filter((part) => part.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('').replace(/\s+/g, ' ').trim();
  if (text) return text.length > 60 ? `${text.slice(0, 60)}…` : text;
  return archivedHeaderTitle(sessionId, header);
}

function archivedUpdatedAt(header, events = []) {
  const promptAt = events.filter((event) => event.type === 'user/message' && event.data.source?.kind === 'user').at(-1)?.time ?? 0;
  return Math.max(header?.createdAt ?? 0, promptAt);
}

/* 旧版本日志（如 v0 迁移残留）在宿主严格校验下可能拒绝读取；转为可读的 422，而不是 500。 */
async function persistedEventsForArchive(ctx, sessionId) {
  try {
    return (await readPersistedSession(ctx.sessionPersistence, sessionId)).events;
  } catch (error) {
    if (error instanceof ArchiveError) throw error;
    const reason = (error instanceof Error ? error.message : String(error)).slice(0, 300);
    throw new ArchiveError('LOG_INCOMPATIBLE', `archived session log could not be read: ${reason}`, 422);
  }
}

function cachedProjectionValues(ctx, meta) {
  try {
    /* 优先使用完整快照；冷会话未播种时回退到标题前驱投影，避免把 cwd 当作会话标题。 */
    const cache = ctx.get?.('sessionProjectionCache');
    const block = meta?.isSeeded
      ? undefined
      : cache?.cachedSnapshot?.(meta, 0) ?? cache?.cachedPredecessorTitle?.(meta, 0);
    return block?.values && typeof block.values === 'object' ? block.values : undefined;
  } catch {
    return undefined;
  }
}

/* 自动归档专用的投影读取：不做 isSeeded 限制。
   ⚠️ 与 cachedProjectionValues 的差别是有意的：
     - 那个helper 服务于「用缓存推断标题」，种子会话（fork 继承）标题不可信，
       因此对 isSeeded 一律返回 undefined 交给上层深读；
     - 这里只取 `sessionListMetadata` / `turnOutline`，它们是折叠前缀的既成事实，
       种子会话与非种子会话都可信（核心自己的列表列就是这么读的）。

   ⚠️⚠️ 第二参数是「需要的投影键数组」，不是水位线 —— 传 0 是我上一版的错：
     核心签名是 cachedSnapshot(meta, keys?)，keys 决定 viewRecord 返回哪些行。
     传 0 不等于"要全部"，取回的行集合不可预期（实测 blank 判定因此失效，
     空会话仍被归档）。这里显式列出本扫描真正要用的键。 */
const AUTO_ARCHIVE_PROJECTION_KEYS = ['sessionListMetadata', 'turnOutline', 'title'];

function cachedListValues(ctx, meta) {
  try {
    const cache = ctx.get?.('sessionProjectionCache');
    const block = cache?.cachedSnapshot?.(meta, AUTO_ARCHIVE_PROJECTION_KEYS)
      ?? cache?.cachedPredecessorTitle?.(meta);
    return block?.values && typeof block.values === 'object' ? block.values : undefined;
  } catch {
    return undefined;
  }
}

/* 日志兜底：投影缓存缺行（例如缓存被清过、旧格式会话）时，
   读日志尾部找最后一条真人 user/message 的时间戳。

   ⚠️ 自动归档路径已【不再使用】本函数：归档要求"必须读到明确的 lastPromptAt"
   （见 collectAutoArchiveCandidates 的硬保险），空会话正因 lastPromptAt 为 null
   才被挡住，若再允许日志兜底就会经由 createdAt 把它放回来。
   保留本函数供其它诊断路径按需调用。 */
async function lastPromptAtFromLog(ctx, sessionId) {
  const events = (await readPersistedSession(ctx.sessionPersistence, String(sessionId))).events;
  if (!Array.isArray(events)) return 0;
  let latest = 0;
  for (const event of events) {
    if (event?.type !== 'user/message') continue;
    if (event.data?.source?.kind !== 'user') continue;
    const time = Number(event.time) || 0;
    if (time > latest) latest = time;
  }
  return latest;
}

function cachedTitle(values) {
  const title = values?.title;
  return typeof title === 'string' && title.trim() ? title.trim() : undefined;
}

function cachedUpdatedAt(header, values) {
  const lastPromptAt = values?.sessionListMetadata?.lastPromptAt;
  return Math.max(header?.createdAt ?? 0, Number.isFinite(lastPromptAt) ? lastPromptAt : 0);
}

function normalizeWorkspaceState(state) {
  const source = state && typeof state === 'object' ? state : {};
  const archivedSessionIds = Array.isArray(source.archivedSessionIds) ? source.archivedSessionIds : [];
  const workspaceIds = Array.isArray(source.workspaceIds) ? source.workspaceIds : [];
  return {
    ...source,
    initialized: source.initialized === true,
    workspaceIds,
    archivedSessionIds,
    ...(source.pendingMutation === undefined ? {} : { pendingMutation: source.pendingMutation })
  };
}

function updateWorkspaceRegistryArchiveCache(ctx, archivedSessionIds) {
  if (ctx.workspaceRegistry?.state && typeof ctx.workspaceRegistry.state === 'object') {
    ctx.workspaceRegistry.state = { ...ctx.workspaceRegistry.state, archivedSessionIds };
  }
}

function sameArchivedIds(left, right) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

async function setArchivedSessionIds(ctx, update) {
  const mutate = async () => {
    const workspaceDomain = ctx.storageDomain?.get?.('workspace');
    if (workspaceDomain !== undefined) {
      const global = workspaceDomain.global;
      const state = normalizeWorkspaceState(global.get());
      const archivedSessionIds = update([...state.archivedSessionIds]);
      if (sameArchivedIds(state.archivedSessionIds, archivedSessionIds)) return archivedSessionIds;
      await global.set({ ...state, archivedSessionIds });
      updateWorkspaceRegistryArchiveCache(ctx, archivedSessionIds);
      return archivedSessionIds;
    }
    if (typeof ctx.workspaceRegistry.requireState === 'function' && typeof ctx.workspaceRegistry.setState === 'function') {
      const state = ctx.workspaceRegistry.requireState();
      const archivedSessionIds = update([...state.archivedSessionIds]);
      if (sameArchivedIds(state.archivedSessionIds, archivedSessionIds)) return archivedSessionIds;
      await ctx.workspaceRegistry.setState({ ...state, archivedSessionIds });
      return archivedSessionIds;
    }
    throw new ArchiveError('ARCHIVE_UNAVAILABLE', 'workspace registry does not expose archive mutation hooks', 500);
  };
  if (typeof ctx.workspaceRegistry.enqueueOperation === 'function') return ctx.workspaceRegistry.enqueueOperation(mutate);
  return mutate();
}

/* ── 级联删除：收集并清理目标会话的子代理会话 ──
   删除会话时把该会话派生的子 agent 会话一并删除（含归档集移除 + 日志目录进回收站）。
   子会话识别：持久化 header 的 parentSession === 目标 id，或 origin === 'subagent' 且
   cwd 相同（one-shot spawn 子会话 header 可能不带 parentSession，但 cwd 继承自父会话）。
   逐层递归直到不再产生新 id（防御性处理更深层的孙代理）。 */
function collectChildSessionIds(headers, parentIds) {
  const current = new Set(parentIds);
  const direct = new Set();
  for (const meta of headers) {
    const id = String(meta?.id ?? '');
    if (!id || current.has(id)) continue;
    if (meta.parentSession !== undefined && current.has(String(meta.parentSession))) {
      direct.add(id);
      continue;
    }
    /* parentSession 缺失时的兜底：origin 标记为 subagent 且 cwd 与任一父会话一致。 */
    if (meta.origin === 'subagent' && meta.cwd !== undefined) {
      for (const parentId of current) {
        const parent = headers.find((header) => String(header?.id ?? '') === parentId);
        if (parent !== undefined && parent.cwd === meta.cwd) {
          direct.add(id);
          break;
        }
      }
    }
  }
  return [...direct];
}

async function persistedSessionHeaders(ctx) {
  const entries = await ctx.sessionPersistence.list();
  return entries.map(persistenceHeaderOf).filter((meta) => typeof meta?.id === 'string' && meta.id !== '' && !deletedSessionIds.has(meta.id));
}

/* 持久化列表不含「已创建但尚未落盘」的子会话，其 header 缓存在 ctx.sessions 里；
   这类会话没有日志目录，只需从归档集移除即可从列表消失。 */
async function allSessionHeadersIncludingLive(ctx) {
  const persisted = await persistedSessionHeaders(ctx);
  const byId = new Map(persisted.map((meta) => [String(meta.id), meta]));
  for (const session of ctx.sessions?.list?.() ?? []) {
    const id = String(session?.id ?? session?.header?.id ?? '');
    if (!id || byId.has(id) || deletedSessionIds.has(id)) continue;
    byId.set(id, session.header ?? { id });
  }
  return [...byId.values()];
}

async function collectSubagentDescendants(ctx, rootId) {
  const headers = await allSessionHeadersIncludingLive(ctx);
  const byId = new Map(headers.map((meta) => [String(meta.id), meta]));
  const collected = new Set();
  let frontier = new Set([String(rootId)]);
  for (let depth = 0; depth < 8 && frontier.size > 0; depth += 1) {
    const children = collectChildSessionIds(headers, [...frontier]);
    const fresh = children.filter((id) => !collected.has(id) && id !== String(rootId));
    if (fresh.length === 0) break;
    for (const id of fresh) collected.add(id);
    frontier = new Set(fresh);
  }
  return [...collected].filter((id) => byId.has(id)).map((id) => byId.get(id));
}

async function deleteSubagentSessionArtifacts(ctx, meta) {
  const sessionId = String(meta.id);
  /* 白名单防护：只删除确认存在于持久化/内存清单中的会话，catalog 里的陈旧 id 一律跳过。 */
  try {
    const known = await allSessionHeadersIncludingLive(ctx);
    if (!known.some((header) => String(header?.id ?? '') === sessionId)) {
      ctx.logger?.info?.(`[${name}] subagent cascade: ${sessionId} not in session inventory, skipped`);
      return false;
    }
  } catch (error) {
    ctx.logger?.warn?.(`[${name}] subagent cascade: inventory check failed for ${sessionId}:`, error);
  }
  let dir;
  try {
    const location = typeof ctx.sessionPersistence.locate === 'function' ? ctx.sessionPersistence.locate(meta) : undefined;
    if (location && typeof location.path === 'string' && location.path.length > 0) dir = dirname(location.path);
  } catch (error) {
    ctx.logger?.warn?.(`[${name}] subagent cascade: locate failed for ${sessionId}:`, error);
  }
  deletedSessionIds.add(sessionId);
  if (dir && existsSync(dir)) {
    try {
      await deleteStoppedSessionDirectory(dir);
      return true;
    } catch (error) {
      deletedSessionIds.delete(sessionId);
      ctx.logger?.warn?.(`[${name}] subagent cascade: artifact delete failed for ${sessionId}:`, error);
      return false;
    }
  }
  return true;
}

/* 回收站无法恢复精确文件名，raw 模式将 zstd 压缩日志解压后按 id 命名、整目录进回收站。
   日志为多帧 zstd 拼接（背靠背 zstd 帧，无间隔字段），单次 zstdDecompressSync 只解第一帧，
   复用 scanZstdFrames（修复会话功能的帧扫描器）取完整帧边界后逐帧解压拼接；
   末帧可能因正在追加写入而撕裂（tornStart）：跳过即可，不影响已解出的完整行。
   子会话 id 主要来自 subagent/catalog 的 data.childId。 */
function decodeConcatenatedZstdText(buf) {
  const { frames } = scanZstdFrames(buf);
  if (frames.length === 0) return buf.toString('utf8');
  const parts = frames.map((frame) => zstdDecompressSync(buf.subarray(frame.start, frame.end)));
  return Buffer.concat(parts).toString('utf8');
}

function extractSubagentCatalogIdsFromJsonlRows(rows) {
  const ids = new Set();
  for (const row of rows) {
    const type = typeof row?.type === 'string' ? row.type : typeof row?.data?.type === 'string' ? row.data.type : '';
    if (type === 'subagent/catalog') {
      const childId = String(row?.data?.childId ?? '');
      if (childId) ids.add(childId);
      /* 兼容旧字段路径：catalog / rows 数组 */
      const catalog = row?.data?.catalog;
      const rowsList = Array.isArray(catalog) ? catalog : Array.isArray(catalog?.rows) ? catalog.rows : Array.isArray(row?.data?.rows) ? row.data.rows : [];
      for (const entry of rowsList) {
        const legacyId = String(entry?.sessionId ?? entry?.childSessionId ?? entry?.id ?? '');
        if (legacyId) ids.add(legacyId);
      }
      continue;
    }
    if (type === 'subagent/descriptor') {
      const childId = String(row?.data?.descriptor?.sessionId ?? row?.data?.sessionId ?? '');
      if (childId) ids.add(childId);
    }
  }
  return [...ids];
}

/* persistence.list() 只返回 current 生成，旧生成日志里的子会话 id 会被遗漏；
   兜底策略：进程内 zstd 解压会话目录下所有 session.v*.jsonl.zstd（宿主 Node 24 自带
   zlib.zstdDecompressSync），直接解析原始行，不依赖外部 zstd.exe 与临时目录。 */
async function collectSubagentCatalogIdsRaw(ctx, sessionId) {
  try {
    const locate = typeof ctx.sessionPersistence.locate === 'function' ? ctx.sessionPersistence.locate : undefined;
    if (locate === undefined) return [];
    const meta = (await persistedSessionHeaders(ctx)).find((entry) => String(entry?.id ?? '') === String(sessionId));
    if (meta === undefined) return [];
    const location = locate(meta);
    const logPath = location?.path;
    if (typeof logPath !== 'string' || logPath.length === 0) return [];
    const sessionDir = dirname(logPath);
    if (!existsSync(sessionDir)) return [];
    const logs = readdirSync(sessionDir).filter((file) => /^session\.v\d+\.jsonl(\.zstd)?$/i.test(file));
    const ids = new Set();
    for (const file of logs) {
      const source = join(sessionDir, file);
      let text;
      try {
        text = file.toLowerCase().endsWith('.zstd')
          ? decodeConcatenatedZstdText(readFileSync(source))
          : readFileSync(source, 'utf8');
      } catch (error) {
        ctx.logger?.warn?.(`[${name}] subagent raw scan: decompress failed for ${source}:`, error);
        continue;
      }
      const rows = [];
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        try {
          rows.push(JSON.parse(trimmed));
        } catch {
          /* 撕裂行/损坏行：跳过 */
        }
      }
      for (const id of extractSubagentCatalogIdsFromJsonlRows(rows)) ids.add(id);
    }
    return [...ids];
  } catch (error) {
    ctx.logger?.warn?.(`[${name}] subagent raw scan failed for ${String(sessionId)}:`, error);
    return [];
  }
}

async function archivedSessionItems(ctx) {
  const archivedIds = [...ctx.workspaceRegistry.archivedSessionIds].filter((sessionId) => !deletedSessionIds.has(sessionId));
  const metas = new Map((await ctx.sessionPersistence.list()).map(persistenceHeaderOf).filter((meta) => !deletedSessionIds.has(meta.id)).map((meta) => [meta.id, meta]));
  /* 一次查全表的来源记录，避免在循环里逐条查库。
     ⚠️⚠️ 这里【只读不写】—— 不做任何"补记"（用户明确要求：
     之前就已归档的会话不要写进新表）。历史归档的真实来源与时刻无从得知，
     回填只能是猜测，且会污染「今天的归档」筛选。
     真正会写表的只有两处，都是"当下正在发生"的事件：
       1. 自动归档扫描成功 → source='auto' + 真实时间
       2. 手动归档路由成功 → source='manual' + 真实时间 */
  const archiveSources = readArchiveSources();
  const items = [];
  for (const sessionId of archivedIds) {
    const id = SessionId(sessionId);
    const live = ctx.sessions.get(id);
    const meta = live?.header ?? metas.get(id);
    if (meta === undefined) continue;
    const liveEvents = live === undefined
      ? undefined
      : typeof live.snapshotEvents === 'function'
        ? sessionEvents(live)
        : Array.isArray(live.events) ? live.events : undefined;
    const projections = liveEvents === undefined ? cachedProjectionValues(ctx, meta) : undefined;
    let title = liveEvents === undefined ? cachedTitle(projections) : archivedTitle(liveEvents, id, meta);
    let updatedAt = liveEvents === undefined ? cachedUpdatedAt(meta, projections) : archivedUpdatedAt(meta, liveEvents);
    if (liveEvents === undefined && title === undefined) {
      try {
        const persistedEvents = (await readPersistedSession(ctx.sessionPersistence, id)).events;
        if (Array.isArray(persistedEvents)) {
          title = archivedTitle(persistedEvents, id, meta);
          updatedAt = archivedUpdatedAt(meta, persistedEvents);
        }
      } catch (error) {
        ctx.logger?.debug?.(`[${name}] archived session title read failed for ${id}:`, error);
      }
    }
    items.push({
      sessionId: id,
      title: title ?? archivedHeaderTitle(id, meta),
      updatedAt,
      createdAt: meta.createdAt ?? 0,
      running: ctx.agents.get(id)?.status === 'running',
      missing: false,
      /* 归档来源（自动/手动）与归档时刻：来自本插件维护的 archive_records 表。
         ⚠️ 用户明确要求（v13.19）：表里没有记录的已归档会话，一律标记为「手动」。
         这类就是"插件升级前就已存在的旧归档" —— 我们不回填表（不伪造时刻），
         但在展示上归入 manual，因为自动归档是本插件新引入的能力，
         早于它存在的归档只可能是手动产物。
         archivedAt 只透传表里的真实值；无记录时不带该字段，
         前端因此不会把这类会话算进「今天的归档」。 */
      archiveSource: archiveSources.get(id)?.source ?? ARCHIVE_RECORD_SOURCE_MANUAL,
      ...(archiveSources.get(id)?.archivedAt ? { archivedAt: archiveSources.get(id).archivedAt } : {}),
      /* 收藏标记（v13.42）：前端据此把条目分流到"归档"或"收藏"两个视图。
         宿主不在这里做过滤 —— 让前端拿到全量再分，切换视图无需重新请求。 */
      favorite: archiveSources.get(id)?.favorite === true,
      ...(meta.cwd === undefined ? {} : { cwd: meta.cwd })
    });
  }
  items.sort((left, right) => right.updatedAt - left.updatedAt || String(left.sessionId).localeCompare(String(right.sessionId)));
  return items;
}

function decodeArchiveRequest(value) {
  const id = sessionIdOf(value);
  if (id === undefined) throw new TypeError('sessionId must be a valid session id');
  return SessionId(id);
}

/* 删除专用解码（v13.97）：多带一个 returnItems 开关。
   批量删除逐条调用本路由，只有最后一条需要拿回完整列表；
   其余传 returnItems:false 让服务端跳过「整份归档列表」的构建与传输。
   非法/缺省一律按 true 处理 —— 单条删除路径行为零变化。 */
function decodeArchiveDeleteRequest(value) {
  const id = sessionIdOf(value);
  if (id === undefined) throw new TypeError('sessionId must be a valid session id');
  return { sessionId: SessionId(id), returnItems: value?.returnItems !== false };
}

/* ── 自动归档：候选收集 + 批量执行 ──

   扫描目标是【全部工作区】的会话（用户明确要求，不按当前 cwd 过滤），
   但"全部工作区"不等于"磁盘上全部会话"：范围限定为 workspaceRegistry
   记账的那些会话，与用户侧边栏里看到的行完全一致；
   工作区之外的残留会话（实测 74 个里有 63 个这类孤儿）一律不碰。

   在此范围上再显式排除六类，任何一类卷进来都会造成"用户没预期的事"：
     1. 已在归档集里的（重复归档无意义，还会反复出现在提醒里）；
     2. 运行中的（核心 archiveSession 会抛 workspace/session-active；
        即便带 stopActivity 也是替用户掐断正在跑的任务，不能默认做）；
     3. 固定（pinned）的 —— 核心归档时会顺带把它从 pinnedSessionIds 剔掉，
        等于静默取消固定，属于隐性副作用，必须绕开；
     4. 子代理会话（origin==='subagent'）—— 它们是父会话派生的执行产物，
        归属应由父会话决定，由天数单独判定会把仍在用的父会话的助手卷走；
     5. 当前正在主视图打开的会话（retainedBy.mainView>0）—— 用户眼前这个
        会话突然从侧边栏消失会很突兀（只是"看过"也算在用）；
     6. 从未发过言的空会话（blank:true / turns:0）—— 没有"多久没对话"可言，
        且 DSH 注册工作区时会自动创建这类会话，按 createdAt 判定必然误伤。 */

/* 当前正在主视图里打开的会话集合。
   为何要排除：扫描在后台跑，若用户正盯着某个"很久没说话"的旧会话（只是看过没发言），
   突然把它从侧边栏归档掉会很突兀；用户视角的"我现在在用它"。
   判定与插件其它处同款：内核 list 快照无 current 字段，用 retainedBy.mainView > 0。 */
function openSessionIds(ctx) {
  const ids = new Set();
  try {
    const snapshot = ctx.sessions?.list?.getSnapshot?.();
    for (const [id, row] of Object.entries(snapshot?.byId ?? {})) {
      if ((row?.retainedBy?.mainView ?? 0) > 0) ids.add(String(id));
    }
  } catch {
    /* 快照不可用时返回空集 —— 宁可多归档一个，也不要让扫描整个失败。 */
  }
  return ids;
}

/* 空会话判定：核心的 sessionListMetadata.blank 是权威信号（"折叠前缀里
   没有任何轮次"）；turns===0 作为旧记录/字段缺失时的兜底。
   ⚠️ 这类会话 lastPromptAt 恒为 null，若让它落到 createdAt 兜底，就会把
   "创建了但一直没用"算成"闲置很久"。DSH 注册工作区时会自动建一个空会话，
   所以这不是罕见情况 —— 实测两个工作区各自贡献了一个。 */
function isBlankSession(values) {
  if (values?.sessionListMetadata?.blank === true) return true;
  const turns = values?.turnOutline?.turns;
  return Array.isArray(turns) && turns.length === 0;
}

/* 工作区记账的会话 id 集合（扫描范围）。
   ⚠️ 为什么不再用 sessionPersistence.list() 的全盘集合：
     实测 74 个磁盘会话里只有 11 个被工作区记账，其余 63 个是不属于任何
     工作区的孤儿（旧工作目录残留、迁移遗留等）——它们在侧边栏根本不可见。
     对这类会话做"闲置归档"等于在用户看不见的地方改状态，而且归档列表里
     会凭空多出用户从没见过的条目（实测就多出 2 个空会话）。
   数据源：workspaceRegistry.list() 的每个 workspace.sessionIds；
   拿不到时返回 undefined（**不是空集**）让调用方跳过本次扫描 ——
   宁可这次不归档，也不能因为读不到范围就退回"扫全盘"。 */
function workspaceAccountedSessionIds(ctx) {
  try {
    const registry = ctx.workspaceRegistry;
    if (registry === undefined) return undefined;
    const rows = typeof registry.list === 'function' ? registry.list() : undefined;
    if (!Array.isArray(rows)) return undefined;
    const ids = new Set();
    for (const row of rows) {
      for (const sid of Array.isArray(row?.sessionIds) ? row.sessionIds : []) ids.add(String(sid));
    }
    return ids;
  } catch {
    return undefined;
  }
}

async function collectAutoArchiveCandidates(ctx, { idleDays, now = Date.now(), archivedIds = new Set(), pinnedIds = new Set() }) {
  const cutoff = now - idleDays * 24 * 60 * 60 * 1000;
  const openIds = openSessionIds(ctx);
  const scopeIds = workspaceAccountedSessionIds(ctx);
  /* 读不到工作区范围就不扫（避免悄悄退回"全盘"语义）。 */
  if (scopeIds === undefined) return [];
  const headers = (await ctx.sessionPersistence.list())
    .map(persistenceHeaderOf)
    .filter((meta) => typeof meta?.id === 'string' && meta.id !== '' && !deletedSessionIds.has(meta.id));
  const candidates = [];
  for (const meta of headers) {
    const id = String(meta.id);
    /* 只认工作区记账过的会话 —— 侧边栏看得见的才有资格被归档。 */
    if (!scopeIds.has(id)) continue;
    if (archivedIds.has(id)) continue;
    if (pinnedIds.has(id)) continue;
    if (meta.origin === 'subagent') continue;
    if (openIds.has(id)) continue;
    if (ctx.agents.get(SessionId(id))?.status === 'running') continue;
    const values = cachedListValues(ctx, meta);
    /* 从未发过言的空会话不参与闲置判定：
       blank=true（核心专门标记"折叠前缀里没有任何轮次"）或 turns=0，
       其 lastPromptAt 为 null，若回退到 createdAt 就会把"创建满 N 天"错当成
       "闲置 N 天"。实测正是这一步把 2 个工作区初始化时自动创建的空会话归档了。 */
    if (isBlankSession(values)) continue;
    /* ⚠️ 硬保险：拿不到投影缓存时【无法证明】这个会话发过言 ——
       空白会话的 lastPromptAt 本身就是 null，若此时回退到 createdAt 判定，
       必然把它算成闲置。因此要求"必须读到明确的 lastPromptAt > 0"，
       读不到就跳过（宁可漏归档一个真闲置会话，也不误伤空会话）。
       日志兜底仍保留，但只在前一步确认它确实有缓存行时才有意义；
       这里选择更保守的策略：缓存缺失 → 直接不归档。 */
    const lastPromptAt = Number(values?.sessionListMetadata?.lastPromptAt) || 0;
    if (lastPromptAt <= 0) {
      ctx.logger?.debug?.(`[${name}] auto archive skipped ${id}: no projection lastPromptAt (cannot prove it was ever used)`);
      continue;
    }
    let lastActiveAt = sessionLastActiveAt(meta, values);
    /* 注：原「缓存缺时间就回退读日志」不再需要 —— 上面已要求必须读到
       lastPromptAt > 0，lastActiveAt 因此必然有效。保留日志兜底反而会让
       空会话经由 createdAt 混进来，故删除。 */
    if (lastActiveAt <= 0) continue;
    if (lastActiveAt > cutoff) continue;
    candidates.push({
      sessionId: id,
      title: cachedTitle(values) ?? archivedHeaderTitle(id, meta),
      lastActiveAt,
      idleDays: Math.floor((now - lastActiveAt) / (24 * 60 * 60 * 1000)),
      ...(meta.cwd === undefined ? {} : { cwd: meta.cwd })
    });
  }
  candidates.sort((left, right) => left.lastActiveAt - right.lastActiveAt);
  return candidates;
}

/* 批量归档：逐个走核心的 workspaceRegistry.archiveSession。
   ⚠️ 不直接 setArchivedSessionIds 批量覆写，原因有三：
     1. 核心路径会做"会话是否活跃"的完整校验，绕过它等于跳过一层保护；
     2. 核心在归档成功后会同步维护 pinned 集合与广播，覆写会漏掉；
     3. 单个失败（日志损坏、正在运行等）必须能被逐条隔离，
        不能让一个坏会话拖垮整批。
   返回真正成功的 id，供提醒与落库使用。 */
async function archiveSessionsBatch(ctx, sessionIds) {
  const archived = [];
  const failed = [];
  for (const rawId of sessionIds) {
    const id = String(rawId);
    try {
      await ctx.workspaceRegistry.archiveSession(SessionId(id));
      archived.push(id);
    } catch (error) {
      failed.push(id);
      ctx.logger?.warn?.(`[${name}] auto archive failed for ${id}:`, error);
    }
  }
  return { archived, failed };
}

/* ── 归档来源记录表（v13.16）──

   核心的 archivedSessionIds 只是一个字符串数组（结构由 @deepseek-ai/dsh-workspace
   定义，插件改不了），它不记录"这条是谁归档的、什么时候归档的"。于是归档列表里
   自动与手动混在一起、无从区分。
   这里在记忆库（与任务档案共用同一 SQLite 连接）新增一张小表补上这个事实：
       session_id  TEXT PRIMARY KEY   —— 会话 id（主键天然防重复）
       source      TEXT NOT NULL      —— 'auto' | 'manual'
       archived_at INTEGER NOT NULL   —— 归档时刻（毫秒）
   生命周期严格跟随核心归档集：归档时写入，恢复或删除时移除。

   ⚠️⚠️ 关于"历史归档不写表"（用户明确要求，v13.19）：
     插件升级前就已归档的会话，真实来源与时刻均无从得知，绝不回填。
     它们保持"表里没有记录"，由接口层统一兜底显示为「手动」——
     因为自动归档是后来才有的能力，早于它的归档只可能是手动产物。
     这样也不会污染「今天的归档」筛选。

   ⚠️ 表记录是"旁证"不是"真相"：即使它与 archivedSessionIds 短暂不一致，
   也只影响徽标显示，不参与任何归档判定。 */

/* 模块级 db 句柄：路由/扫描都在 apply 里，表在启动时建好且不变，
   用模块级变量避免把 db 参数穿透到每一个 helper（它们大多已有 3+ 参数）。 */
let archiveRecordsDb = null;

const ARCHIVE_RECORD_SOURCE_AUTO = 'auto';
const ARCHIVE_RECORD_SOURCE_MANUAL = 'manual';

function archiveRecordDb() {
  return archiveRecordsDb;
}

function ensureArchiveRecordTable(db) {
  if (db === undefined || db === null) return false;
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS archive_records (
        session_id TEXT PRIMARY KEY,
        source TEXT NOT NULL CHECK(source IN ('auto', 'manual')),
        archived_at INTEGER NOT NULL,
        favorite INTEGER NOT NULL DEFAULT 0
      );
    `);
    /* 兼容迁移（v13.42）：favorite 列是后加的，已有库里的 archive_records
       没有这一列。SQLite 不支持 ADD COLUMN IF NOT EXISTS，故先查 PRAGMA
       再决定是否补列 —— 重复执行安全。 */
    const columns = db.prepare('PRAGMA table_info(archive_records)').all().map((row) => String(row.name));
    if (!columns.includes('favorite')) {
      db.exec('ALTER TABLE archive_records ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0');
    }
    archiveRecordsDb = db;
    return true;
  } catch (error) {
    console.warn(`[${name}] archive_records table init failed:`, error);
    return false;
  }
}

/* 写入/覆盖一条归档来源记录。会话被重复归档时以最新一次为准。
   ⚠️ upsert 而非 insert：同一会话可能先被手动归档、恢复、再被自动归档，
   只保留最后一次的来源与时间才是用户想看到的。

   ⚠️⚠️ at 是【必填】参数，故意不给 Date.now() 默认值。
     默认值会让"漏传时间"静默变成"现在"，正是这种隐式兜底把几十个历史归档
     批量成同一秒、进而污染「今天的归档」筛选。时间非法时不写库 ——
     宁可不记，也不留假时刻。 */
function recordArchiveSource(sessionId, source, at) {
  const db = archiveRecordDb();
  if (db === null) return;
  const stamp = Number(at);
  if (!Number.isFinite(stamp) || stamp <= 0) {
    console.warn(`[${name}] archive record skipped for ${String(sessionId)}: invalid archived_at (${String(at)})`);
    return;
  }
  try {
    /* ⚠️ v13.42：upsert 时【不碰 favorite】。
       ON CONFLICT 分支只更新 source / archived_at，收藏状态保持原值 ——
       否则"恢复后再归档"会把用户的收藏标记静默清掉。 */
    db.prepare('INSERT INTO archive_records (session_id, source, archived_at) VALUES (?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET source = excluded.source, archived_at = excluded.archived_at').run(String(sessionId), source, stamp);
  } catch (error) {
    console.warn(`[${name}] archive record write failed for ${String(sessionId)}:`, error);
  }
}

/* 设置/清除收藏（v13.42）。
   收藏是 archive_records 上的一列，不是独立表：它与"该会话的归档来源记录"
   天然一一对应，且必须随记录一起被删除（恢复/删除会话时）。
   ⚠️ 若该会话在表里没有记录（插件升级前就存在的旧归档），这里会 INSERT
   一条兜底记录（source=manual、archived_at 沿用其归档时间或 0）——
   否则收藏无从落地。这不会污染「今天的归档」：archived_at 传 0 表示未知。 */
function setArchiveFavorite(sessionId, favorite, archivedAt = 0) {
  const db = archiveRecordDb();
  if (db === null) return false;
  const id = String(sessionId);
  const value = favorite === true ? 1 : 0;
  try {
    const existing = db.prepare('SELECT session_id FROM archive_records WHERE session_id = ?').get(id);
    if (existing === undefined) {
      const stamp = Number(archivedAt);
      db.prepare('INSERT INTO archive_records (session_id, source, archived_at, favorite) VALUES (?, ?, ?, ?)')
        .run(id, ARCHIVE_RECORD_SOURCE_MANUAL, Number.isFinite(stamp) && stamp > 0 ? stamp : 0, value);
    } else {
      db.prepare('UPDATE archive_records SET favorite = ? WHERE session_id = ?').run(value, id);
    }
    return true;
  } catch (error) {
    console.warn(`[${name}] archive favorite write failed for ${id}:`, error);
    return false;
  }
}

/* 会话离开归档集（恢复或删除）时清除对应记录。 */
function forgetArchiveSource(sessionId) {
  const db = archiveRecordDb();
  if (db === null) return;
  try {
    db.prepare('DELETE FROM archive_records WHERE session_id = ?').run(String(sessionId));
  } catch (error) {
    console.warn(`[${name}] archive record delete failed for ${String(sessionId)}:`, error);
  }
}

/* 会话被删除时清除它在「当前会话已启用项目」关联表里的记录（v13.73）。
   memory_session_directories 与 archive_records 共用同一个 SQLite 连接
   （memoryStore.db），所以这里直接拿 archiveRecordDb() 即可，无需再传 store。
   表可能不存在（记忆功能安装失败、或该版本未建表）：SQLite 会抛
   'no such table'，按"无记录可清"静默返回。 */
function forgetSessionDirectoryLinks(sessionId) {
  const db = archiveRecordDb();
  if (db === null) return;
  try {
    db.prepare('DELETE FROM memory_session_directories WHERE session_id = ?').run(String(sessionId));
  } catch (error) {
    /* 表不存在属预期情况（记忆功能未启用），不打警告刷屏；
       其他错误才值得记录。 */
    if (!/no such table/i.test(String(error?.message ?? ''))) {
      console.warn(`[${name}] memory session directory cleanup failed for ${String(sessionId)}:`, error);
    }
  }
}

/* 读出全部来源记录：sessionId -> { source, archivedAt, favorite }。
   一次查询拿全量（归档集通常几十到几百条），避免逐条查库。 */
function readArchiveSources() {
  const map = new Map();
  const db = archiveRecordDb();
  if (db === null) return map;
  try {
    for (const row of db.prepare('SELECT session_id, source, archived_at, favorite FROM archive_records').all()) {
      map.set(String(row.session_id), {
        source: String(row.source),
        archivedAt: Number(row.archived_at),
        favorite: Number(row.favorite) === 1
      });
    }
  } catch (error) {
    console.warn(`[${name}] archive records read failed:`, error);
  }
  return map;
}

/* 一次性对账：清掉已不在当前归档集的陈旧行。
   场景：会话在插件未运行期间被恢复/删除（那时没有钩子能通知到我们）。
   启动时跑一次即可。 */
function reconcileArchiveSources(archivedIds) {
  const db = archiveRecordDb();
  if (db === null) return 0;
  try {
    const keep = new Set([...archivedIds].map(String));
    const stale = db.prepare('SELECT session_id FROM archive_records').all()
      .map((row) => String(row.session_id))
      .filter((id) => !keep.has(id));
    if (stale.length === 0) return 0;
    const remove = db.prepare('DELETE FROM archive_records WHERE session_id = ?');
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const id of stale) remove.run(id);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return stale.length;
  } catch (error) {
    console.warn(`[${name}] archive record reconcile failed:`, error);
    return 0;
  }
}


function decodeArchivePreviewRequest(value) {
  const id = decodeArchiveRequest(value);
  const offset = Number.isSafeInteger(value?.offset) && value.offset >= 0 ? value.offset : 0;
  const rawLimit = Number.isSafeInteger(value?.limit) && value.limit > 0 ? value.limit : DEFAULT_ARCHIVE_PREVIEW_LIMIT;
  const tocOffset = Number.isSafeInteger(value?.tocOffset) && value.tocOffset >= 0 ? value.tocOffset : 0;
  const rawTocLimit = Number.isSafeInteger(value?.tocLimit) && value.tocLimit > 0 ? value.tocLimit : 10;
  const search = typeof value?.search === 'string' ? value.search.slice(0, 2000).trim() : '';
  return { sessionId: id, offset, limit: Math.min(rawLimit, MAX_ARCHIVE_PREVIEW_LIMIT), tocOffset, tocLimit: Math.min(rawTocLimit, MAX_ARCHIVE_PREVIEW_TOC_LIMIT), search };
}

function textBlocks(content) {
  if (!Array.isArray(content)) return '';
  const parts = [];
  const visit = (block) => {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    else if (block?.type === 'reasoning' && typeof block.text === 'string') parts.push(block.text);
    else if (block?.type === 'tool-call') parts.push([block.name, block.arguments].filter((value) => typeof value === 'string' && value.trim()).join('\n'));
    else if (block?.type === 'tool-result' && Array.isArray(block.content)) block.content.forEach(visit);
  };
  content.forEach(visit);
  return parts.map((part) => part.trim()).filter(Boolean).join('\n\n');
}

function toolNameOf(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : 'unknown';
}

function archivedToolCallStats(events) {
  const byName = new Map();
  const calls = new Map();
  const ensure = (name) => {
    const key = toolNameOf(name);
    let entry = byName.get(key);
    if (entry === undefined) {
      entry = { name: key, count: 0, success: 0, failed: 0, pending: 0 };
      byName.set(key, entry);
    }
    return entry;
  };
  const addCall = (name, callId) => {
    const id = typeof callId === 'string' && callId !== '' ? callId : undefined;
    if (id !== undefined && calls.has(id)) return;
    const entry = ensure(name);
    entry.count += 1;
    entry.pending += 1;
    if (id !== undefined) calls.set(id, { name: entry.name, settled: false });
  };
  const settleCall = (callId, failed) => {
    const id = typeof callId === 'string' && callId !== '' ? callId : undefined;
    if (id === undefined) return;
    const call = calls.get(id);
    if (call === undefined || call.settled) return;
    const entry = ensure(call.name);
    entry.pending = Math.max(0, entry.pending - 1);
    if (failed) entry.failed += 1;
    else entry.success += 1;
    call.settled = true;
  };
  for (const event of events) {
    if (event?.type === 'tool/call') {
      addCall(event.data?.name, event.data?.callId);
      continue;
    }
    if (event?.type === 'assistant/message') {
      const content = event.data?.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block?.type === 'tool-call') addCall(block.name, block.id);
      }
      continue;
    }
    if (event?.type === 'tool/result') {
      const block = Array.isArray(event.data?.message?.content) ? event.data.message.content.find((part) => part?.type === 'tool-result') : undefined;
      settleCall(block?.toolCallId ?? event.data?.message?.source?.callId, block?.isError === true);
    }
  }
  return [...byName.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

function previewItemFromEvent(event) {
  if (event.type === 'user/message') {
    if (event.data.source?.kind !== 'user') return undefined;
    const text = textBlocks(event.data.content);
    return text ? { role: 'user', seq: event.seq, time: event.time, text, title: text.replace(/\s+/g, ' ').trim().slice(0, 80) } : undefined;
  }
  if (event.type === 'assistant/message') {
    const text = textBlocks(event.data.message?.content);
    return text ? { role: 'assistant', seq: event.seq, time: event.time, text } : undefined;
  }
  if (event.type === 'tool/result') {
    const text = textBlocks(event.data.message?.content);
    return text ? { role: 'tool', seq: event.seq, time: event.time, text } : undefined;
  }
  return undefined;
}

async function previewArchivedSession(ctx, input) {
  const { sessionId, offset, limit, tocOffset, tocLimit, search = '' } = input;
  const live = ctx.sessions.get(sessionId);
  const meta = live?.header ?? await persistenceHeaderById(ctx.sessionPersistence, sessionId);
  if (meta === undefined) throw new ArchiveError('SESSION_NOT_FOUND', `archived session "${sessionId}" was not found`, 404);
  const liveEvents = live === undefined
    ? undefined
    : typeof live.snapshotEvents === 'function'
      ? sessionEvents(live)
      : Array.isArray(live.events) ? live.events : undefined;
  const events = liveEvents ?? await persistedEventsForArchive(ctx, sessionId);
  let surfaceNodes;
  try {
    surfaceNodes = foldSurface(events).nodes;
  } catch {
    surfaceNodes = events.filter((event) => event.surfaceOp === 'append').map((event) => event.seq);
  }
  const eventBySeq = new Map(events.map((event) => [event.seq, event]));
  const normalizedSearch = search.toLocaleLowerCase();
  const allMessages = [];
  for (const seq of surfaceNodes) {
    const event = eventBySeq.get(seq);
    const item = event === undefined ? undefined : previewItemFromEvent(event);
    if (item !== undefined) allMessages.push(item);
  }
  const indexedMessages = allMessages.map((item, index) => ({ ...item, displayIndex: index + 1, messageIndex: index }));
  const matchedMessages = normalizedSearch === ''
    ? indexedMessages
    : indexedMessages.filter((item) => `${item.role}\n${item.title ?? ''}\n${item.text}`.toLocaleLowerCase().includes(normalizedSearch));
  const matchedIndexedMessages = matchedMessages.map((item, index) => ({ ...item, matchIndex: index }));
  const messages = matchedIndexedMessages.slice(offset, offset + limit);
  const matchIndexBySeq = new Map(matchedIndexedMessages.map((item) => [item.seq, item.matchIndex]));
  const userMessages = indexedMessages.filter((item) => item.role === 'user');
  /* 目录条目附带 matchIndex：搜索态下客户端可直接按匹配列表空间换算页码；不在匹配集内的条目不带该字段 */
  const pagedUserMessages = userMessages.slice(tocOffset, tocOffset + tocLimit).map((item) => {
    const matchIndex = matchIndexBySeq.get(item.seq);
    return matchIndex === undefined ? item : { ...item, matchIndex };
  });
  return {
    sessionId,
    title: archivedTitle(events, sessionId, meta),
    updatedAt: archivedUpdatedAt(meta, events),
    createdAt: meta.createdAt ?? 0,
    ...(meta.cwd === undefined ? {} : { cwd: meta.cwd }),
    toolCalls: archivedToolCallStats(events),
    messages,
    userMessages: pagedUserMessages,
    totalMessages: indexedMessages.length,
    totalMatchedMessages: matchedIndexedMessages.length,
    totalUserMessages: userMessages.length,
    tocOffset,
    tocLimit,
    offset,
    nextOffset: offset + messages.length,
    limit,
    search,
    hasMore: offset + messages.length < matchedIndexedMessages.length,
    tocHasMore: tocOffset + pagedUserMessages.length < userMessages.length
  };
}

async function restoreArchivedSession(ctx, sessionId) {
  const live = ctx.sessions.get(sessionId);
  const meta = live?.header ?? await persistenceHeaderById(ctx.sessionPersistence, sessionId);
  if (meta === undefined) throw new ArchiveError('SESSION_NOT_FOUND', `archived session "${sessionId}" was not found`, 404);
  const archivedSessionIds = await setArchivedSessionIds(ctx, (ids) => ids.filter((id) => id !== sessionId));
  /* 会话已离开归档集，来源记录随之作废（用户要求"恢复即移除"）。 */
  forgetArchiveSource(sessionId);
  return { sessionId, archivedSessionIds, items: await archivedSessionItems(ctx) };
}

async function currentSessionToolStats(ctx, sessionId) {
  const live = ctx.sessions.get(sessionId);
  const meta = live?.header ?? await persistenceHeaderById(ctx.sessionPersistence, sessionId);
  if (meta === undefined) throw new ArchiveError('SESSION_NOT_FOUND', `session "${sessionId}" was not found`, 404);
  const liveEvents = live === undefined
    ? undefined
    : typeof live.snapshotEvents === 'function'
      ? sessionEvents(live)
      : Array.isArray(live.events) ? live.events : undefined;
  const events = liveEvents ?? await persistedEventsForArchive(ctx, sessionId);
  const toolCalls = archivedToolCallStats(events);
  return {
    sessionId,
    title: archivedTitle(events, sessionId, meta),
    updatedAt: archivedUpdatedAt(meta, events),
    createdAt: meta.createdAt ?? 0,
    ...(meta.cwd === undefined ? {} : { cwd: meta.cwd }),
    total: toolCalls.reduce((sum, entry) => sum + entry.count, 0),
    success: toolCalls.reduce((sum, entry) => sum + entry.success, 0),
    failed: toolCalls.reduce((sum, entry) => sum + entry.failed, 0),
    pending: toolCalls.reduce((sum, entry) => sum + entry.pending, 0),
    toolCalls
  };
}

/* ── 会话日志修复：清除 dsh-session-kit 历史上写进会话日志的污染 ──
   实测（2026-09-14 全库扫描 235 会话）插件留下四类污染：
     1. assistant/message.data 顶层：regeneration / endTurn（旧版轮次删除平铺的墓碑元数据）
     2. user/message.source 越界键：hitIds / snapshot / directoryIds / recall（记忆注入）
     3. 事件类型 memory/recall（旧版记忆召回自建事件）
     4. 轮次删除墓碑：assistant/message + surfaceOp.replace（遮蔽了原生 user/message）
   1、2 剥字段即可；3、4 需整行删除，因此必须重排 seq 并改写全部 seq 引用。
   实测：32 个含墓碑的 v0 会话原本 0 个可加载，修复后 27 个通过迁移链。
   墓碑策略=只删墓碑、保留被遮蔽的原生消息（恢复被删轮次的显示）。 */

const REPAIR_STRIPPED_SOURCE_KEYS = ['hitIds', 'snapshot', 'directoryIds', 'recall'];
const REPAIR_MESSAGE_EVENT_TYPES = new Set(['system/message', 'user/message', 'assistant/message', 'tool/result']);
/* 插件专有键：即使宿主在官方 source 上（rpcId 为普通 UUID、无法凭身份判定），
   只要出现这些键就一定是插件写入的——DSH 的 source 白名单里没有它们。
   仅覆盖历史形态：记忆注入的 hitIds/snapshot 现已迁入 source.sections（见 memory.js），
   而 sections 是 v4 合法标准字段（form:'snapshot' 的必需项），不得列入剥离名单。 */
const REPAIR_EXCLUSIVE_SOURCE_KEYS = ['hitIds', 'snapshot', 'directoryIds', 'recall'];
const REPAIR_STRIPPED_DATA_KEYS_BY_TYPE = { 'assistant/message': ['regeneration', 'endTurn'] };
const REPAIR_DROPPED_EVENT_TYPES = ['memory/recall'];
/* 与 memory.js 内部常量保持一致：注入用 plugin='memory'，剔除用 plugin='dsh-session-kit-memory-eject'。 */
const MEMORY_CONTEXT_PLUGIN_NAME = 'memory';
const MEMORY_EJECT_PLUGIN_NAME = 'dsh-session-kit-memory-eject';
const ZSTD_MAGIC = 4247762216;
const ZSTD_CHECKSUM_OPTIONS = { params: { [zlibConstants.ZSTD_c_checksumFlag]: 1 } };

/* 扫描完整 zstd 帧边界（不依赖任何包内私有实现）。 */
function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, tornStart: start };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`invalid zstd frame magic at byte ${offset}`);
    offset += 4;
    if (offset === buffer.length) return { frames, tornStart: start };
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) throw new Error(`reserved zstd frame-header bit at byte ${offset - 1}`);
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start };
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start };
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) throw new Error(`reserved zstd block type at byte ${offset - 3}`);
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start };
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start };
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return { frames };
}

/* 判断一条 source 是否由 dsh-session-kit 写入。
   三种历史形态：
     - kind:'plugin' + plugin:'memory'（记忆注入）
     - kind:'plugin' + plugin:'dsh-session-kit-memory-eject'（记忆剔除）
     - kind:'user'  + rpcId:'dsh-turns-del-regenerate:*'（重新生成的重放提问，
       旧版曾把 recall 元数据挂在它的 source 上） */
function isKitAuthoredSource(source) {
  if (source === null || typeof source !== 'object') return false;
  if (source.kind === TURNS_DEL_PROVIDER || source.kind === 'dsh-turns-del' || source.kind === 'plugin:dsh-turns-del' || source.kind === 'plugin:dsh-session-kit-turns-del' || (typeof source.kind === 'string' && source.kind.startsWith('dsh-session-kit-'))) return true;
  if (source.kind === 'plugin') {
    return source.plugin === MEMORY_CONTEXT_PLUGIN_NAME
      || source.plugin === MEMORY_EJECT_PLUGIN_NAME
      || (typeof source.plugin === 'string' && source.plugin.startsWith('dsh-session-kit'))
      || source.plugin === TURNS_DEL_PROVIDER;
  }
  if (source.kind === 'user' && typeof source.rpcId === 'string') {
    return source.rpcId.startsWith('dsh-turns-del-regenerate:')
      || source.rpcId.startsWith('dsh-turns-del:');
  }
  return false;
}

/* 剥离一条事件上的越界字段，返回 { event, stripped }。
   - source 层：仅对插件自己写入的 source 生效（避免误删官方 plugin source）。
   - data 层：按事件类型匹配（assistant/message 的墓碑元数据）。 */
export function repairMessageIdentity(event) {
  if (!REPAIR_MESSAGE_EVENT_TYPES.has(event?.type)) return { event, repaired: false };
  const data = event?.data;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return { event, repaired: false };
  const message = event.type === 'user/message' ? data : data.message;
  if (message === null || typeof message !== 'object' || Array.isArray(message)) return { event, repaired: false };
  if (typeof message.id === 'string' && message.id.length > 0) return { event, repaired: false };
  const id = `repair-${event.type.replace('/', '-')}-${Number.isSafeInteger(event.seq) ? event.seq : 'unknown'}-${createHash('sha256').update(JSON.stringify(message)).digest('hex').slice(0, 16)}`;
  const nextMessage = { ...message, id: MessageId(id) };
  const nextData = event.type === 'user/message' ? nextMessage : { ...data, message: nextMessage };
  return { event: { ...event, data: nextData }, repaired: true };
}

function stripRepairFields(event) {
  const stripped = [];
  let nextEvent = event;

  const dataKeys = REPAIR_STRIPPED_DATA_KEYS_BY_TYPE[event?.type];
  if (Array.isArray(dataKeys) && event.data !== null && typeof event.data === 'object') {
    const present = dataKeys.filter((key) => Object.hasOwn(event.data, key));
    if (present.length > 0) {
      const nextData = { ...event.data };
      for (const key of present) delete nextData[key];
      nextEvent = { ...nextEvent, data: nextData };
      stripped.push(...present);
    }
  }

  const source = nextEvent.data?.source;
  if (source !== null && typeof source === 'object') {
    /* 判定规则分两种：
       1. 插件自己写的事件（plugin 名 / rpcId 前缀可确认身份）→ 剥离全部越界键
       2. 插件在官方消息上追加的专有键（如 recall 挂在官方 user source 上，
          rpcId 是普通 UUID、无法凭身份区分）→ 只剥离插件专有键，不动官方字段 */
    const authored = isKitAuthoredSource(source);
    const present = REPAIR_STRIPPED_SOURCE_KEYS.filter((key) => {
      if (!Object.hasOwn(source, key)) return false;
      if (authored) return true;
      return REPAIR_EXCLUSIVE_SOURCE_KEYS.includes(key);
    });
    if (present.length > 0) {
      const nextSource = { ...source };
      for (const key of present) delete nextSource[key];
      nextEvent = { ...nextEvent, data: { ...nextEvent.data, source: nextSource } };
      stripped.push(...present);
    }
  }

  return { event: nextEvent, stripped };
}

/* 判定轮次删除墓碑：assistant/message + surfaceOp.replace + sourceEventSeqs。
   旧版用 assistant/message 承载替换，这是 v3 禁止的形态，也是迁移链拒绝的根因之一。
   注意：不要求 content 为空——部分墓碑带内容，同样是插件写入的替换事件。 */
function isTurnTombstoneEvent(event) {
  if (event?.type !== 'assistant/message') return false;
  const op = event.surfaceOp;
  if (op === null || typeof op !== 'object' || op.op !== 'replace') return false;
  return Array.isArray(event.sourceEventSeqs);
}

/* 惰性加载宿主的 v0 codec。插件与宿主同进程，可直接 import 宿主包。 */
let v0CodecPromise;
function loadV0Codec() {
  if (v0CodecPromise === undefined) {
    v0CodecPromise = import('@deepseek-ai/dsh-session-format-v0-to-v1').catch(() => undefined);
  }
  return v0CodecPromise;
}

function createV0DecoderSync(codecModule, header) {
  if (codecModule?.releasedV0SessionFormatCodec === undefined) return undefined;
  return codecModule.releasedV0SessionFormatCodec.createDecoder(header, 'recoverable');
}

/* 用宿主 decoder 展开每行产出的逻辑事件 seq，保证与宿主认知一致。 */
function decodeLineSeqsWith(decoder, lines) {
  const out = [];
  for (const line of lines) {
    const collected = [];
    const ctx = {
      emitEvent(event) { collected.push({ seq: event.seq, type: event.type }); },
      emitRun(run) {
        const expanded = typeof run?.expand === 'function' ? run.expand() : [];
        for (const event of expanded) collected.push({ seq: event.seq, type: event.type });
      }
    };
    try {
      decoder.decodeRow(JSON.parse(line), ctx);
    } catch {
      /* 解码失败的行走剥字段路径，不参与重编号 */
    }
    out.push(collected);
  }
  return out;
}

/* 重编号：改写所有已知承载 seq 的字段。 */
function renumberEvent(event, remap, seqsOfLine, dropSeqs) {
  if (Number.isSafeInteger(event.seq)) {
    event.seq = remap(event.seq);
  } else if (Number.isSafeInteger(event.seq0)) {
    /* 打包行（seq0 + dt）：seq0 重映射；若行内部分事件被删则裁剪 texts/dt。 */
    const oldSeqs = seqsOfLine.map((s) => s.seq);
    const keepIndexes = [];
    oldSeqs.forEach((s, index) => { if (!dropSeqs.has(s)) keepIndexes.push(index); });
    if (keepIndexes.length === oldSeqs.length) {
      event.seq0 = remap(event.seq0);
    } else if (keepIndexes.length > 0) {
      const data = event.data;
      if (Array.isArray(data?.dt) && Array.isArray(data?.texts)) {
        const absolute = [oldSeqs[0]];
        for (const delta of data.dt) absolute.push(absolute[absolute.length - 1] + delta);
        const keptAbsolute = keepIndexes.map((k) => absolute[k]).filter((v) => v !== undefined);
        const texts = keepIndexes.map((k) => data.texts[k]);
        const dt = [];
        for (let k = 1; k < keptAbsolute.length; k += 1) dt.push(keptAbsolute[k] - keptAbsolute[k - 1]);
        event.data = { ...data, dt, texts };
      }
      event.seq0 = remap(oldSeqs[keepIndexes[0]]);
    }
  }

  if (Array.isArray(event.sourceEventSeqs)) {
    event.sourceEventSeqs = event.sourceEventSeqs.map((item) =>
      Array.isArray(item) ? item.map(remap) : remap(item));
  }
  if (event.surfaceOp !== null && typeof event.surfaceOp === 'object') {
    for (const key of ['start', 'end', 'startSeq', 'endSeq']) {
      if (Number.isSafeInteger(event.surfaceOp[key])) event.surfaceOp[key] = remap(event.surfaceOp[key]);
    }
  }
  const data = event.data;
  if (data !== null && typeof data === 'object') {
    if (Array.isArray(data.messageSeqs)) data.messageSeqs = data.messageSeqs.map(remap);
    if (Array.isArray(data.shadowedSeqs)) data.shadowedSeqs = data.shadowedSeqs.map(remap);
    if (Number.isSafeInteger(data.start)) data.start = remap(data.start);
    if (Number.isSafeInteger(data.throughSeq)) data.throughSeq = remap(data.throughSeq);
    if (Number.isSafeInteger(data.sourceEventSeq)) data.sourceEventSeq = remap(data.sourceEventSeq);
  }
}

/**
 * 修复一个会话日志文件：清除插件历史污染。
 *
 * 两个层次：
 *   A. 剥字段（不需重编号）：source 越界键、data 越界键
 *   B. 删行 + 重编号：memory/recall 事件、轮次删除墓碑
 *
 * 重编号必须与宿主完全一致：v0 用 seq0+dt 把多个事件打包在一行，
 * 因此先用宿主的 v0 codec 展开，得到精确的「行 -> seq 列表」映射。
 * 墓碑策略为「只删墓碑、保留被遮蔽的原生消息」，即恢复被删轮次的显示。
 */
export async function repairSessionLogFile(filePath, { commit = true } = {}) {
  const bytes = readFileSync(filePath);
  const { frames, tornStart } = scanZstdFrames(bytes);
  if (frames.length === 0) throw new Error('session log has no complete zstd frame');
  if (tornStart !== undefined) throw new Error(`session log has an incomplete final frame at byte ${tornStart}`);

  const parts = frames.map((frame) => zstdDecompressSync(bytes.subarray(frame.start, frame.end)).toString('utf8'));
  const headerText = parts[0];
  if (headerText.length === 0 || headerText.indexOf('\n') !== headerText.length - 1) {
    throw new Error('session log first frame is not exactly one header line');
  }
  const header = JSON.parse(headerText);

  /* 收集全部物理行（按原顺序），供删行与重编号使用。 */
  const lines = [];
  for (let index = 1; index < parts.length; index += 1) {
    const raw = parts[index];
    if (raw.length === 0) continue;
    for (const line of raw.split('\n')) if (line.length > 0) lines.push(line);
  }

  /* 需要重编号时才展开：用宿主 codec 得到每行产出的 seq。 */
  const needsRenumber = lines.some((line) => {
    const event = JSON.parse(line);
    return REPAIR_DROPPED_EVENT_TYPES.includes(event.type) || isTurnTombstoneEvent(event);
  });

  const removedKeys = new Map();
  const droppedTypes = new Map();
  let repairedEvents = 0;
  let repairedMessageIds = 0;

  // ── A. 补消息身份 + 剥字段（逐行，不改变行数）──
  const strippedLines = lines.map((line) => {
    const parsed = JSON.parse(line);
    const identity = repairMessageIdentity(parsed);
    const { event: nextEvent, stripped } = stripRepairFields(identity.event);
    if (!identity.repaired && stripped.length === 0) return { line, event: parsed };
    if (identity.repaired) repairedMessageIds += 1;
    for (const key of stripped) removedKeys.set(key, (removedKeys.get(key) ?? 0) + 1);
    repairedEvents += 1;
    return { line: JSON.stringify(nextEvent), event: nextEvent };
  });

  // ── B. 删行 + 重编号 ──
  let dropSeqs = new Set();
  let seqMap = null;
  let lineSeqs = null;
  if (needsRenumber) {
    const codecModule = await loadV0Codec();
    const decoder = createV0DecoderSync(codecModule, header);
    if (decoder === undefined) {
      throw new Error('session format codec unavailable; cannot renumber dropped events safely');
    }
    lineSeqs = decodeLineSeqsWith(decoder, strippedLines.map((x) => x.line));

    // 要删的 seq：memory/recall 整行 + 墓碑自身（保留其遮蔽的原生消息）
    for (let i = 0; i < strippedLines.length; i += 1) {
      const event = strippedLines[i].event;
      if (REPAIR_DROPPED_EVENT_TYPES.includes(event.type)) {
        droppedTypes.set(event.type, (droppedTypes.get(event.type) ?? 0) + 1);
        for (const s of lineSeqs[i] ?? []) dropSeqs.add(s.seq);
      } else if (isTurnTombstoneEvent(event)) {
        droppedTypes.set('turn-tombstone', (droppedTypes.get('turn-tombstone') ?? 0) + 1);
        for (const s of lineSeqs[i] ?? []) dropSeqs.add(s.seq);
      }
    }
    if (dropSeqs.size > 0) {
      seqMap = new Map();
      let next = 0;
      for (const list of lineSeqs) {
        for (const s of list) {
          if (!dropSeqs.has(s.seq)) { seqMap.set(s.seq, next); next += 1; }
        }
      }
    }
  }

  // ── 组装输出行 ──
  const outLines = [];
  for (let i = 0; i < strippedLines.length; i += 1) {
    const { line, event } = strippedLines[i];
    if (seqMap === null) { outLines.push(JSON.stringify(event)); continue; }

    const seqsOfLine = lineSeqs[i] ?? [];
    // 整行删除：该行产出的所有 seq 都在待删集合
    if (seqsOfLine.length > 0 && seqsOfLine.every((s) => dropSeqs.has(s.seq))) continue;

    const target = JSON.parse(strippedLines[i].line);
    const remap = (n) => seqMap.get(n) ?? n;
    renumberEvent(target, remap, seqsOfLine, dropSeqs);
    repairedEvents += 1;
    outLines.push(JSON.stringify(target));
  }

  const changed = repairedEvents > 0;
  if (!changed) {
    return { changed: false, repairedEvents: 0, repairedMessageIds: 0, removed: {}, dropped: {} };
  }

  /* 保持宿主格式：首帧仅含 header，事件写入后续独立 frame。 */
  const headerFrame = zstdCompressSync(Buffer.from(`${JSON.stringify(header)}\n`, 'utf8'), ZSTD_CHECKSUM_OPTIONS);
  const nextBytes = outLines.length === 0
    ? headerFrame
    : Buffer.concat([
      headerFrame,
      zstdCompressSync(Buffer.from(`${outLines.join('\n')}\n`, 'utf8'), ZSTD_CHECKSUM_OPTIONS)
    ]);
  if (commit) {
    const tempPath = `${filePath}.repairing`;
    writeFileSync(tempPath, nextBytes);
    try {
      renameSync(tempPath, filePath);
    } catch (error) {
      try { rmSync(tempPath, { force: true }); } catch { /* 清理失败不掩盖原错误 */ }
      throw error;
    }
  }
  return {
    changed: true,
    repairedEvents,
    repairedMessageIds,
    bytes: nextBytes,
    removed: Object.fromEntries(removedKeys),
    dropped: Object.fromEntries(droppedTypes)
  };
}

/* 修复前用真实迁移链验证文件可加载，修复后再验一次。 */
async function verifySessionLogLoadable(ctx, sessionId) {
  try {
    const snapshot = await readPersistedSession(ctx.sessionPersistence, sessionId);
    return { ok: true, events: Array.isArray(snapshot?.events) ? snapshot.events.length : 0 };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/* 定位会话实际存在的日志文件。
   注意：不能用 locate(meta) 的返回路径——它硬编码当前格式版本
   （logPath -> generationLogPath(..., SESSION_FORMAT_VERSION, ...)），
   对 v0 老会话会返回 session.v3.jsonl.zstd，而真实文件是 session.jsonl.zstd。
   本功能恰恰主要修 v0 老会话，因此必须扫描目录取真实文件。 */
function resolveSessionLogFiles(ctx, meta) {
  const dir = typeof ctx.sessionPersistence.locate === 'function'
    ? dirname(ctx.sessionPersistence.locate(meta)?.path ?? '')
    : undefined;
  if (typeof dir !== 'string' || dir.length === 0 || !existsSync(dir)) return [];
  let entries;
  try { entries = readdirSync(dir); } catch { return []; }
  const files = entries
    /* 世代文件名形如 session.jsonl.zstd / session.v3.jsonl.zstd，
       注意版本号在 .jsonl 之前，正则必须允许中间段。 */
    .filter((name) => /^session(\.v\d+)?\.jsonl(\.zstd)?$/.test(name))
    .map((name) => join(dir, name))
    .filter((file) => { try { return statSync(file).isFile(); } catch { return false; } });
  /* 优先修复旧格式（低版本号）文件：它们才是迁移链拒绝的对象。 */
  const versionOf = (file) => {
    const m = /\.v(\d+)\.jsonl/.exec(file);
    return m === null ? 0 : Number(m[1]);
  };
  return files.sort((a, b) => versionOf(a) - versionOf(b));
}

function repairBackupRoot() {
  const root = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim().length > 0
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh');
  return join(root, 'recovery-backups', `message-id-repair-${new Date().toISOString().replace(/[:.]/g, '-')}`);
}

async function repairCurrentSession(ctx, sessionId) {
  const agent = ctx.agents.get(sessionId);
  if (agent?.status === 'running') throw new ArchiveError('SESSION_RUNNING', `session "${sessionId}" is running`);
  /* 跨平台安全护栏：会话在宿主进程内处于打开（绑定）状态时拒绝修复。
     Windows 上改名会因文件占用失败（EBUSY，安全失败）；
     POSIX（macOS/Linux）上更危险——改名会成功，但宿主继续写入已解除
     链接的旧 inode，表面正常、重启后丢追加数据（静默分叉）。
     会话管理菜单本身只在当前会话可用，用户切走后即可修复。 */
  if (ctx.sessions.get(sessionId) !== undefined) {
    throw new ArchiveError('SESSION_LIVE', `session "${sessionId}" is open in the host; switch to another session before repairing`, 409);
  }
  const meta = await persistenceHeaderById(ctx.sessionPersistence, sessionId);
  if (meta === undefined) throw new ArchiveError('SESSION_NOT_FOUND', `session "${sessionId}" was not found`, 404);
  const files = resolveSessionLogFiles(ctx, meta);
  if (files.length === 0) {
    throw new ArchiveError('REPAIR_UNSUPPORTED', 'no readable session log artifact was found for this session', 501);
  }

  const before = await verifySessionLogLoadable(ctx, sessionId);

  /* 修复所有存在的世代文件（同一会话可能同时留有 v0 与 v3 两份）。 */
  const applied = [];
  let repairedEvents = 0;
  let repairedMessageIds = 0;
  const removed = {};
  const dropped = {};
  let primaryPath;
  const backupDir = repairBackupRoot();
  mkdirSync(backupDir, { recursive: true });
  const repairs = [];
  for (const file of files) {
    const backupPath = join(backupDir, basename(file));
    copyFileSync(file, backupPath);
    const result = await repairSessionLogFile(file, { commit: false });
    repairs.push({ file, result });
  }
  for (const { file, result } of repairs) {
    if (result.changed) {
      primaryPath = primaryPath ?? file;
      repairedEvents += result.repairedEvents;
      repairedMessageIds += result.repairedMessageIds ?? 0;
      for (const [key, count] of Object.entries(result.removed ?? {})) removed[key] = (removed[key] ?? 0) + count;
      for (const [key, count] of Object.entries(result.dropped ?? {})) dropped[key] = (dropped[key] ?? 0) + count;
      applied.push(file);
    }
  }

  const temporary = [];
  try {
    for (const { file, result } of repairs) {
      if (!result.changed) continue;
      const tempPath = `${file}.repairing`;
      writeFileSync(tempPath, result.bytes);
      temporary.push({ file, tempPath });
    }
    for (const { file, tempPath } of temporary) renameSync(tempPath, file);
  } catch (error) {
    for (const { file, tempPath } of temporary) {
      try { if (existsSync(tempPath)) rmSync(tempPath, { force: true }); } catch { /* 保留原错误 */ }
      try { copyFileSync(join(backupDir, basename(file)), file); } catch { /* 尽力回滚 */ }
    }
    throw error;
  }

  const after = applied.length > 0 ? await verifySessionLogLoadable(ctx, sessionId) : before;
  if (!after.ok && applied.length > 0) {
    for (const file of applied) {
      try { copyFileSync(join(backupDir, basename(file)), file); } catch { /* 保留验证错误 */ }
    }
    throw new ArchiveError('REPAIR_FAILED', `session repair verification failed: ${after.error}`, 500);
  }

  return {
    sessionId,
    filePath: primaryPath ?? files[0],
    backupDir,
    fileCount: files.length,
    repairedFiles: applied.length,
    changed: applied.length > 0,
    repairedEvents,
    repairedMessageIds,
    removed,
    dropped,
    loadableBefore: before.ok,
    loadableAfter: after.ok,
    errorBefore: before.ok ? undefined : before.error,
    errorAfter: after.ok ? undefined : after.error
  };
}

async function deleteArchivedSession(ctx, sessionId, { returnItems = true } = {}) {
  const agent = ctx.agents.get(sessionId);
  if (agent?.status === 'running') throw new ArchiveError('SESSION_RUNNING', `session "${sessionId}" is running`);
  const meta = await persistenceHeaderById(ctx.sessionPersistence, sessionId);
  if (meta !== undefined && typeof ctx.sessionPersistence.locate !== 'function') throw new ArchiveError('DELETE_UNSUPPORTED', 'session persistence backend does not expose artifact locations', 501);
  const location = meta ? ctx.sessionPersistence.locate(meta) : undefined;
  if (meta !== undefined && (location === undefined || typeof location.path !== 'string' || location.path.length === 0)) throw new ArchiveError('DELETE_UNSUPPORTED', 'session persistence backend does not expose per-session artifact locations', 501);
  const dir = location ? dirname(location.path) : undefined;
  deletedSessionIds.add(sessionId);
  try {
    /* 级联收集须在父日志目录进回收站之前完成（catalog 兜底要读父日志）。 */
    const cascadeDeleted = await cascadeDeleteSubagentSessions(ctx, sessionId);
    if (dir && existsSync(dir)) await deleteStoppedSessionDirectory(dir);
    // Keep the archive marker after deletion so a still-cached persistence entry
    // cannot briefly reappear in the normal session list as a restored session.
    const archivedSessionIds = await setArchivedSessionIds(ctx, (ids) => ids.includes(sessionId) ? ids : [...ids, sessionId]);
    /* 会话已被删除，来源记录没有意义（用户要求"删除即移除"）。
       注意这不是"归档"而是"删除"，故只清记录、不写新记录。 */
    forgetArchiveSource(sessionId);
    /* 同理清理该会话的「当前会话已启用项目」关联行（v13.73）：
       memory_session_directories.session_id 是裸 TEXT 列，没有外键能指向
       宿主的会话存储（跨库），所以不会自动级联。不清的话这些行会永久留在
       表里成为孤儿 —— 虽然不影响功能（读取恒按当前 session_id 过滤），
       但会持续累积垃圾数据。
       ⚠️ 只清【被删除的会话】，不能监听 agent/disposed 来做 ——
       分叉、插件热重载、seedForkContext 都会触发 dispose，那样会误删
       活跃会话的记录。删除入口只有这里（含批量删除，它在客户端循环调用
       同一个删除路由），所以挂在这一处即可覆盖全部情况。 */
    forgetSessionDirectoryLinks(sessionId);
    /* ── returnItems（v13.97）──
       批量删除是在客户端逐条调本路由的，而每条的响应都带「整份归档列表」
       （archivedSessionIds + items，各 O(M)）。客户端只保留最后一份用于刷新，
       前面 N-1 份是纯浪费：N 次全量列表重建 + N 份全量 JSON 传输（O(N×M)）。
       现在客户端除最后一条外都传 returnItems:false，本函数跳过这两块的构建，
       响应退化成几十字节；列表由最后一条（或收尾的一次 list）统一刷新。
       默认 true —— 单条删除路径与任何既有调用方行为完全不变。 */
    return {
      sessionId,
      deleted: meta !== undefined,
      ...(returnItems
        ? { archivedSessionIds, items: await archivedSessionItems(ctx) }
        : {}),
      ...(cascadeDeleted.length > 0 ? { cascadeDeletedSubagentSessions: cascadeDeleted } : {})
    };
  } catch (error) {
    deletedSessionIds.delete(sessionId);
    throw error;
  }
}

/* 删除会话时级联删除其子代理会话（归档集移除 + 日志目录进回收站）。
   子会话来源三路：持久化 header 的 parentSession/origin + cwd 兜底、live 内存会话 header、
   父会话 subagent/catalog（含 raw JSONL 兜底解析，覆盖旧生成日志）。
   收集失败不阻塞删除主体；逐个清理失败仅记日志并继续。 */
/* 从父会话的 subagent/catalog 与 subagent/descriptor 事件收集子会话 id；
   持久化 API 读取失败或为空时回退 raw JSONL 解析（覆盖旧生成日志）。 */
async function collectSubagentCatalogIds(ctx, sessionId) {
  const ids = new Set();
  try {
    const handle = await ctx.sessionPersistence.open(String(sessionId), 'read');
    try {
      const result = await handle.read(0, Number.MAX_SAFE_INTEGER);
      const events = Array.isArray(result?.events) ? result.events : [];
      for (const event of events) {
        if (event?.type === 'subagent/catalog') {
          /* 实测 durable 行形如 {childId, childCreatedAt, mode, label}；保留旧字段路径兼容。 */
          const childId = String(event.data?.childId ?? '');
          if (childId) ids.add(childId);
          const catalog = event.data?.catalog;
          const rowsList = Array.isArray(catalog) ? catalog : Array.isArray(catalog?.rows) ? catalog.rows : Array.isArray(event.data?.rows) ? event.data.rows : [];
          for (const entry of rowsList) {
            const legacyId = String(entry?.sessionId ?? entry?.childSessionId ?? entry?.id ?? '');
            if (legacyId) ids.add(legacyId);
          }
        }
        if (event?.type === 'subagent/descriptor') {
          const childId = String(event.data?.descriptor?.sessionId ?? event.data?.sessionId ?? '');
          if (childId) ids.add(childId);
        }
      }
    } finally {
      await handle.close();
    }
  } catch (error) {
    ctx.logger?.debug?.(`[${name}] subagent catalog read failed for ${String(sessionId)}:`, error);
  }
  if (ids.size === 0) {
    for (const id of await collectSubagentCatalogIdsRaw(ctx, sessionId)) ids.add(id);
  }
  return [...ids];
}

async function cascadeDeleteSubagentSessions(ctx, rootId) {
  const collected = new Map();
  try {
    const headers = await allSessionHeadersIncludingLive(ctx);
    const rootIdText = String(rootId);
    for (const id of collectChildSessionIds(headers, [rootIdText])) {
      const meta = headers.find((header) => String(header?.id ?? '') === id);
      if (meta !== undefined) collected.set(id, meta);
    }
    for (const childMeta of collectSubagentDescendants(ctx, rootIdText)) {
      const id = String(childMeta?.id ?? childMeta);
      if (!collected.has(id)) collected.set(id, childMeta);
    }
    for (const id of await collectSubagentCatalogIds(ctx, rootIdText)) {
      if (!collected.has(String(id))) collected.set(String(id), { id: String(id) });
    }
  } catch (error) {
    ctx.logger?.warn?.(`[${name}] subagent cascade collect failed for ${String(rootId)}:`, error);
  }
  if (collected.size === 0) return [];
  const removed = [];
  try {
    await setArchivedSessionIds(ctx, (ids) => ids.filter((sessionId) => !collected.has(String(sessionId))));
  } catch (error) {
    ctx.logger?.warn?.(`[${name}] subagent cascade archive-set cleanup failed for ${String(rootId)}:`, error);
  }
  for (const [sessionId, meta] of collected) {
    try {
      const deleted = await deleteSubagentSessionArtifacts(ctx, meta);
      /* 子会话同样要清「当前会话已启用项目」关联行（v13.73）。
         父会话的清理在 deleteArchivedSession 里，但级联删除的子会话
         不会各自走那条路径，必须在这里补上，否则删了整棵子树却只清掉根节点。 */
      if (deleted) {
        forgetSessionDirectoryLinks(sessionId);
        removed.push(sessionId);
      }
    } catch (error) {
      ctx.logger?.warn?.(`[${name}] subagent cascade delete failed for ${sessionId}:`, error);
    }
  }
  if (removed.length > 0) ctx.logger?.info?.(`[${name}] session ${String(rootId)} deleted with ${removed.length} subagent session(s): ${removed.join(', ')}`);
  return removed;
}

async function handleArchiveAction(ctx, req, res, action, decode = () => undefined) {
  if (req.method !== 'POST') return respond(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required' } });
  const contentType = req.headers?.['content-type'];
  if (typeof contentType !== 'string' || !contentType.toLowerCase().startsWith('application/json')) return respond(res, 415, { ok: false, error: { code: 'INVALID_REQUEST', message: 'application/json required' } });
  try {
    const input = decode(await readJsonBody(req, MAX_SESSION_BODY_BYTES));
    return respond(res, 200, { ok: true, value: await action(input) });
  } catch (error) {
    if (error instanceof ArchiveError) return respond(res, error.status, { ok: false, error: { code: error.code, message: error.message } });
    if (error instanceof TypeError || error instanceof SyntaxError) return respond(res, 400, { ok: false, error: { code: 'INVALID_REQUEST', message: error.message } });
    return respond(res, 500, { ok: false, error: { code: 'ARCHIVE_FAILED', message: error instanceof Error ? error.message : String(error) } });
  }
}

function handleArchiveList(ctx, req, res) {
  return handleArchiveAction(ctx, req, res, () => archivedSessionItems(ctx));
}

function handleArchiveRestore(ctx, req, res) {
  return handleArchiveAction(ctx, req, res, (sessionId) => restoreArchivedSession(ctx, sessionId), decodeArchiveRequest);
}

function handleArchiveDelete(ctx, req, res) {
  return handleArchiveAction(ctx, req, res, (input) => deleteArchivedSession(ctx, input.sessionId, { returnItems: input.returnItems }), decodeArchiveDeleteRequest);
}

function handleArchivePreview(ctx, req, res) {
  return handleArchiveAction(ctx, req, res, (input) => previewArchivedSession(ctx, input), decodeArchivePreviewRequest);
}

function handleToolStats(ctx, req, res) {
  return handleArchiveAction(ctx, req, res, (sessionId) => currentSessionToolStats(ctx, sessionId), decodeArchiveRequest);
}

function handleRepairSession(ctx, req, res) {
  return handleArchiveAction(ctx, req, res, (sessionId) => repairCurrentSession(ctx, sessionId), decodeArchiveRequest);
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function clampInteger(value, fallback, min, max) {
  return Math.trunc(clampNumber(value, fallback, min, max));
}

function rawRatio(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 1 ? number : fallback;
}

function rawPositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function rawNonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function compactionTargetForAgent(agent) {
  const routed = agent?.session?.requestHeader?.()?.config;
  if (typeof routed?.provider === 'string' && routed.provider.length > 0 && typeof routed?.model === 'string' && routed.model.length > 0) {
    return { provider: routed.provider, model: routed.model };
  }
  const provider = agent?.options?.provider;
  const model = agent?.options?.model;
  if (typeof provider === 'string' && provider.length > 0 && typeof model === 'string' && model.length > 0) return { provider, model };
}

function effectiveCompactionConfig(config, agent) {
  const source = config && typeof config === 'object' ? config : {};
  const target = compactionTargetForAgent(agent);
  const override = target && Array.isArray(source.modelPolicies)
    ? source.modelPolicies.find((policy) => policy?.provider === target.provider && policy?.model === target.model)
    : undefined;
  return override && typeof override === 'object' ? { ...source, ...override } : source;
}

function compactionDefaultsFromConfig(config) {
  // Read only the live engine's top-level resolved config.  Model-specific
  // policies are runtime overrides, not the baseline values shown as
  // "official defaults" in the settings dialog.
  const source = config && typeof config === 'object' ? config : {};
  return {
    thresholdRatio: rawRatio(source.thresholdRatio, COMPACTION_DEFAULT_THRESHOLD_RATIO),
    retainRatio: rawRatio(source.retainRatio, COMPACTION_DEFAULT_RETAIN_RATIO),
    maxTokens: rawPositiveInteger(source.maxTokens, COMPACTION_DEFAULT_MAX_TOKENS),
    compactionRetries: rawNonNegativeInteger(source.compactionRetries, COMPACTION_DEFAULT_RETRIES),
    maxOverflowRetries: rawNonNegativeInteger(source.maxOverflowRetries, COMPACTION_DEFAULT_OVERFLOW_RETRIES)
  };
}

async function installedCompactionDefaults() {
  try {
    const modulePath = require.resolve('@deepseek-ai/dsh-compaction-basic');
    const moduleUrl = pathToFileURL(modulePath);
    const mtime = statSync(modulePath).mtimeMs;
    moduleUrl.searchParams.set('mtime', String(mtime));
    const module = await import(moduleUrl.href);
    const Engine = module.BasicCompactionEngine ?? module.default;
    if (typeof Engine !== 'function') return DEFAULT_COMPACTION_VALUES;
    const engine = new Engine({ reflect: { provide() {} } }, { auto: false });
    return compactionDefaultsFromConfig(engine.config);
  } catch {
    return DEFAULT_COMPACTION_VALUES;
  }
}

function compactionSessionIdOf(req) {
  try {
    const id = new URL(req.url || COMPACTION_CONFIG_ROUTE, 'http://dsh.local').searchParams.get('sessionId');
    return typeof id === 'string' && SESSION_ID_RE.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

function agentForSessionId(ctx, id) {
  if (!id) return undefined;
  return ctx.agents.get(id) ?? ctx.agents.get(SessionId(id));
}

async function compactionDefaultsForRequest(ctx, controller, req) {
  // Re-read the installed official compaction-basic defaults for every dialog
  // request, without sampling live agents whose modelPolicies or plugin-applied
  // overrides can change the baseline labels.
  return installedCompactionDefaults();
}

function normalizeCompactionSettings(value, defaults = DEFAULT_COMPACTION_VALUES) {
  const retainRatio = clampNumber(value?.retainRatio, defaults.retainRatio, COMPACTION_MIN_RETAIN_RATIO, COMPACTION_MAX_RETAIN_RATIO);
  const thresholdRatio = clampNumber(value?.thresholdRatio, defaults.thresholdRatio, COMPACTION_MIN_THRESHOLD_RATIO, COMPACTION_MAX_THRESHOLD_RATIO);
  return {
    enabled: value?.enabled === true,
    thresholdRatio,
    retainRatio,
    maxTokens: clampInteger(value?.maxTokens, defaults.maxTokens, COMPACTION_MIN_MAX_TOKENS, COMPACTION_MAX_MAX_TOKENS),
    compactionRetries: clampInteger(value?.compactionRetries, defaults.compactionRetries, COMPACTION_MIN_RETRIES, COMPACTION_MAX_RETRIES),
    maxOverflowRetries: clampInteger(value?.maxOverflowRetries, defaults.maxOverflowRetries, COMPACTION_MIN_RETRIES, COMPACTION_MAX_RETRIES)
  };
}

function normalizeGlobalPromptSettings(value) {
  const text = typeof value?.text === 'string' ? value.text.slice(0, GLOBAL_PROMPT_MAX_TEXT_LENGTH) : '';
  return {
    enabled: value?.enabled === true,
    text
  };
}

function validateGlobalPromptSettings(value) {
  if (typeof value?.enabled !== 'boolean') return 'invalid-enabled';
  if (typeof value?.text !== 'string') return 'invalid-text';
  if (value.text.length > GLOBAL_PROMPT_MAX_TEXT_LENGTH) return 'text-too-large';
}

function createGlobalPromptRuntimeController(ctx, settingsProvider) {
  let disposeRootSection;
  const agentFibers = new Map();
  const pendingDisposals = new Set();
  const currentText = () => {
    const settings = settingsProvider();
    const text = typeof settings?.text === 'string' ? settings.text.trim() : '';
    return settings?.enabled && text.length > 0 ? text : '';
  };
  const section = Object.freeze({
    name: GLOBAL_PROMPT_SECTION,
    order: GLOBAL_PROMPT_ORDER,
    text: currentText
  });
  const disposeAgent = (agent) => {
    const fiber = agentFibers.get(agent);
    if (fiber === undefined) return;
    agentFibers.delete(agent);
    const task = Promise.resolve(fiber.dispose()).catch((error) => {
      ctx.logger?.warn?.(`[${name}] global prompt agent cleanup failed:`, error);
    });
    pendingDisposals.add(task);
    void task.finally(() => pendingDisposals.delete(task));
  };
  const installAgent = (agent) => {
    if (agent === undefined || agentFibers.has(agent) || typeof agent.ctx?.inject !== 'function') return;
    const fiber = agent.ctx.inject(['systemPrompt'], (scope) => {
      scope.systemPrompt.section(section);
    });
    agentFibers.set(agent, fiber);
  };
  const apply = () => {
    if (disposeRootSection === undefined && typeof ctx.systemPrompt?.section === 'function') disposeRootSection = ctx.systemPrompt.section(section);
    if (typeof ctx.agents?.list === 'function') {
      for (const agent of ctx.agents.list()) installAgent(agent);
    }
  };
  const dispose = () => {
    if (disposeRootSection !== undefined) {
      disposeRootSection();
      disposeRootSection = undefined;
    }
    for (const agent of Array.from(agentFibers.keys())) disposeAgent(agent);
  };
  return { apply, dispose, installAgent, disposeAgent, isActive: () => currentText().length > 0 || disposeRootSection !== undefined || agentFibers.size > 0 };
}

function validateCompactionSettings(value) {
  if (typeof value?.enabled !== 'boolean') return 'invalid-enabled';
  if (typeof value?.thresholdRatio !== 'number' || !Number.isFinite(value.thresholdRatio) || value.thresholdRatio < COMPACTION_MIN_THRESHOLD_RATIO || value.thresholdRatio > COMPACTION_MAX_THRESHOLD_RATIO) return 'invalid-threshold-ratio';
  if (typeof value?.retainRatio !== 'number' || !Number.isFinite(value.retainRatio) || value.retainRatio < COMPACTION_MIN_RETAIN_RATIO || value.retainRatio > COMPACTION_MAX_RETAIN_RATIO) return 'invalid-retain-ratio';
  if (value.retainRatio >= value.thresholdRatio) return 'retain-ratio-not-less-than-threshold';
  if (!Number.isInteger(value?.maxTokens) || value.maxTokens < COMPACTION_MIN_MAX_TOKENS || value.maxTokens > COMPACTION_MAX_MAX_TOKENS) return 'invalid-max-tokens';
  if (!Number.isInteger(value?.compactionRetries) || value.compactionRetries < COMPACTION_MIN_RETRIES || value.compactionRetries > COMPACTION_MAX_RETRIES) return 'invalid-compaction-retries';
  if (!Number.isInteger(value?.maxOverflowRetries) || value.maxOverflowRetries < COMPACTION_MIN_RETRIES || value.maxOverflowRetries > COMPACTION_MAX_RETRIES) return 'invalid-max-overflow-retries';
}

function patchCompactionPolicy(policy, settings) {
  const { retainTokens: _retainTokens, ...rest } = policy && typeof policy === 'object' ? policy : {};
  return Object.freeze({
    ...rest,
    thresholdRatio: settings.thresholdRatio,
    retainRatio: settings.retainRatio,
    maxTokens: settings.maxTokens,
    compactionRetries: settings.compactionRetries,
    maxOverflowRetries: settings.maxOverflowRetries
  });
}

function cloneCompactionConfig(config, settings, agent) {
  const source = config && typeof config === 'object' ? config : {};
  const base = patchCompactionPolicy(source, settings);
  const target = compactionTargetForAgent(agent);
  if (!target || !Array.isArray(source.modelPolicies)) return base;
  return Object.freeze({
    ...base,
    modelPolicies: Object.freeze(source.modelPolicies.map((policy) => {
      if (policy?.provider === target.provider && policy?.model === target.model) return patchCompactionPolicy(policy, settings);
      return policy;
    }))
  });
}

function createCompactionRuntimeController(ctx, settingsProvider) {
  const touched = new Set();
  const originals = new WeakMap();
  const engineForAgent = (agent) => ctx.get?.('agentPresets')?.serviceFor?.(agent, 'compaction') ?? ctx.get?.('compaction');
  const patchEngine = (engine, settings, agent) => {
    if (!engine || typeof engine !== 'object' || engine.config === undefined) return;
    if (!originals.has(engine)) {
      originals.set(engine, { config: engine.config });
      touched.add(engine);
    }
    engine.config = cloneCompactionConfig(engine.config, settings, agent);
  };
  const restoreEngines = () => {
    for (const engine of touched) {
      const original = originals.get(engine);
      if (original !== undefined) {
        engine.config = original.config;
        originals.delete(engine);
      }
    }
    touched.clear();
  };
  const applyToAgent = (agent) => {
    const settings = settingsProvider();
    if (!settings.enabled) return;
    patchEngine(engineForAgent(agent), settings, agent);
  };
  const applyToLiveAgents = async () => {
    const settings = settingsProvider();
    if (!settings.enabled) {
      restoreEngines();
      return;
    }
    const agents = typeof ctx.agents?.list === 'function' ? ctx.agents.list() : [];
    for (const agent of agents) applyToAgent(agent);
  };
  return { applyToAgent, applyToLiveAgents, restoreEngines };
}

export { name, inject, TURNS_DEL_PATH, TURNS_DEL_TURN_PATH, REGENERATE_PATH, REGENERATE_TURN_PATH, EDIT_REGENERATE_TURN_PATH, TURNS_DEL_PROVIDER, TurnsDelError, deleteTurns, deleteTurnsByTurn, regenerateTurns, regenerateTurnsByTurn, editRegenerateTurnsByTurn, isTurnsDelEvent };

export async function apply(ctx) {
  const compactionStore = await ctx.storageDomain.open(compactionConfigDomainSpec);
  const sidebarEntriesStore = await ctx.storageDomain.open(sidebarEntriesDomainSpec);
  const globalPromptStore = await ctx.storageDomain.open(globalPromptDomainSpec);
  const taskAutoInjectStore = await ctx.storageDomain.open(taskAutoInjectDomainSpec);
  const taskAutoExtractStore = await ctx.storageDomain.open(taskAutoExtractDomainSpec);
  const memoryStorageStore = await ctx.storageDomain.open(memoryStorageDomainSpec);
  const dispatchMenuStore = await ctx.storageDomain.open(dispatchMenuDomainSpec);
  const autoArchiveStore = await ctx.storageDomain.open(autoArchiveDomainSpec);
  /* 运行时开关值：pre-step 每轮读取，避免频繁查库。 */
  const taskAutoInjectRef = { value: normalizeTaskAutoInject(taskAutoInjectStore.global.get()).enabled };
  const taskAutoExtractRef = { value: normalizeTaskAutoInject(taskAutoExtractStore.global.get()).enabled };
  /* 记忆数据目录：仅启动时解析一次。改动后需重启 DSH 才生效（不热切换连接，
     避免与复用同一 db 句柄的 task 档案功能产生竞态）。 */
  const memoryStorageSettings = normalizeMemoryStorage(memoryStorageStore.global.get());
  /* 启动时实际生效的目录，用于判断保存后是否需要提示重启。 */
  const activeMemoryDataDir = memoryDataDirFor(memoryStorageSettings);
  let compactionSettings = normalizeCompactionSettings(compactionStore.global.get());
  let globalPromptSettings = normalizeGlobalPromptSettings(globalPromptStore.global.get());
  const compactionController = createCompactionRuntimeController(ctx, () => compactionSettings);
  const globalPromptController = createGlobalPromptRuntimeController(ctx, () => globalPromptSettings);
  globalPromptController.apply();
  await compactionController.applyToLiveAgents().catch((error) => ctx.logger?.warn?.(`[${name}] initial compaction config apply failed:`, error));
  /* 记忆与任务功能互相独立：任一失败都不阻塞另一个，也不阻塞插件本体。 */
  const memoryStore = await installMemoryFeature(ctx, { dataDir: memoryDataDirFor(memoryStorageSettings) }).catch((error) => {
    ctx.logger?.warn?.(`[${name}] memory feature install failed:`, error);
    return undefined;
  });
  if (memoryStore !== undefined) {
    await installTaskFeature(ctx, memoryStore, {
      isAutoInjectEnabled: () => taskAutoInjectRef.value,
      isAutoExtractEnabled: () => taskAutoExtractRef.value
    }).catch((error) => ctx.logger?.warn?.(`[${name}] task feature install failed:`, error));
  }

  /* 归档来源记录表：与记忆/任务共用同一个 SQLite 连接（memoryStore.db）。
     记忆功能没装成功时 db 为 undefined，此时归档照常工作、只是不记来源。 */
  const archiveDb = memoryStore?.db;
  const archiveDbReady = ensureArchiveRecordTable(archiveDb);
  if (!archiveDbReady) {
    /* 表没建成的原因必须可见 —— 表缺失时自动归档仍会执行、只是不记来源，
       用户看到的现象正是"点了立即扫描，表里却没数据"。 */
    ctx.logger?.warn?.(`[${name}] archive_records table unavailable (memoryStore=${memoryStore === undefined ? 'missing' : 'present'}, db=${archiveDb === undefined ? 'undefined' : 'ok'})`);
  } else {
    /* 启动对账：插件未运行时被恢复/删除的会话不会触发钩子，
       它们的陈旧行靠这里清掉。 */
    const dropped = reconcileArchiveSources(ctx.workspaceRegistry?.archivedSessionIds ?? []);
    if (dropped > 0) ctx.logger?.info?.(`[${name}] dropped ${dropped} stale archive record(s)`);
  }

  /* ── 自动归档运行时（v13.15）──
     与记忆/任务功能完全独立：这里任何失败都只影响归档，不影响插件本体。
     执行时机 = 启动立即一次 + 每日一次（不是每轮对话，避免无谓 IO）。
     并发保护：手动「立即扫描」与定时扫描可能同时到达，用 running 标志让
     后到者直接跳过（不重叠跑两遍归档）。 */
  let autoArchiveRunning = false;
  const runAutoArchiveScan = async () => {
    if (autoArchiveRunning) return { skipped: 'running' };
    autoArchiveRunning = true;
    try {
      const settings = autoArchiveStoreOf(autoArchiveStore);
      /* 默认关闭：未开启时绝不碰归档集 —— 手动「立即扫描」同样受此约束，
         否则「关着开关点一下按钮」也会真的归档，开关就形同虚设。 */
      if (settings.enabled !== true) {
        return { disabled: true, archived: [], candidates: [] };
      }
      const archivedIds = new Set((ctx.workspaceRegistry?.archivedSessionIds ?? []).map(String));
      const pinnedIds = new Set((ctx.workspaceRegistry?.pinnedSessionIds ?? []).map(String));
      const candidates = await collectAutoArchiveCandidates(ctx, {
        idleDays: settings.idleDays,
        archivedIds,
        pinnedIds
      });
      const { archived, failed } = await archiveSessionsBatch(ctx, candidates.map((item) => item.sessionId));
      /* 记录来源：这批是自动归档 —— 逐条写 'auto' 与真实时刻。
         只记真正成功的（archived）；失败的会话没进归档集，不该留记录。 */
      const archivedAt = Date.now();
      for (const id of archived) recordArchiveSource(id, ARCHIVE_RECORD_SOURCE_AUTO, archivedAt);
      ctx.logger?.info?.(`[${name}] auto archive scan: archived=${archived.length} sourceRecorded=${archiveRecordDb() === null ? 'no(table unavailable)' : 'yes'} at=${archivedAt}`);
      const byId = new Map(candidates.map((item) => [item.sessionId, item]));
      const now = archivedAt;
      await autoArchiveStore.global.set({
        ...settings,
        lastScanAt: now,
        lastResultAt: now,
        lastResultIds: archived,
        /* 只有真的归档了才算"有新结果要提醒"；空扫描不打扰用户。 */
        lastResultPendingToast: archived.length > 0
      });
      if (archived.length > 0) {
        ctx.logger?.info?.(`[${name}] auto archived ${archived.length} idle session(s) (idle ≥ ${settings.idleDays} days)`);
      }
      if (failed.length > 0) {
        ctx.logger?.warn?.(`[${name}] auto archive skipped ${failed.length} session(s)`);
      }
      /* 推送结果给所有打开的前端（v13.26）：这是轮询的替代品 ——
         扫描结束的这一刻主动送达，客户端无需反复询问。
         只在真的归档了才推：0 归档时前端也不该弹窗。 */
      if (archived.length > 0) {
        broadcastAutoArchiveResult({ type: 'result', value: autoArchivePayload() });
      }
      return {
        archived,
        failed,
        candidates: candidates.map((item) => ({ ...item, archived: byId.has(item.sessionId) && archived.includes(item.sessionId) })),
        idleDays: settings.idleDays,
        at: now
      };
    } catch (error) {
      ctx.logger?.warn?.(`[${name}] auto archive scan failed:`, error);
      throw error;
    } finally {
      autoArchiveRunning = false;
    }
  };

  /* 启动即扫 + 每日扫描：定时器必须挂在 ctx.effect 里，插件停用/卸载时能清掉，
     否则停用插件后仍会后台归档（用户完全看不见的地方改状态）。

     ⚠️ 首次扫描【不做启动延迟、不等 24h 节流】（用户明确要求）：
       - 延迟扫描的危险窗口：DSH 刚起来用户正打字准备发消息，扫描此时才跑，
         就可能把「他正准备继续用的那个旧会话」归档掉，看起来像是输入时被抢走；
       - 启动即扫一次，把"哪些会话过期"在一个用户还没开始操作的时刻结算完，
         之后当天的扫描都不会再碰这些会话（它们已进归档集，被排除规则挡掉）。
     所以：启动时无条件扫一次（仅受 enabled 开关约束），此后每 24h 一次。 */
  ctx.effect(() => {
    let timer;
    const scheduleNext = () => {
      timer = setTimeout(() => {
        void runAutoArchiveScan().catch(() => undefined).finally(() => {
          if (timer !== undefined) scheduleNext();
        });
      }, AUTO_ARCHIVE_SCAN_INTERVAL_MS);
      /* 长间隔定时器不阻塞进程退出（Node 的 unref），插件卸载时也能安全清掉。 */
      timer?.unref?.();
    };
    /* 首次扫描：同步排进微任务队列（apply 已 await 完，此时会话列表与投影缓存
       均已就绪；collectAutoArchiveCandidates 只读不写）。用 setTimeout(0) 而非
       直接 await，是为了不把插件 apply 的完成拖在这条链上。 */
    const startup = setTimeout(() => {
      void runAutoArchiveScan().catch(() => undefined);
      scheduleNext();
    }, 0);
    startup?.unref?.();
    return () => {
      clearTimeout(startup);
      clearTimeout(timer);
    };
  }, `${name}: auto archive scheduler`);

  /* 权鉴方案（v6.6.1）：所有 exact 路由的唯一注册入口。
     包装层做两件事，且都发生在 handler 读取 body 之前：
       1. fenceRoute 的鉴权（owner-only + fail-closed，细节见 route-guard.js）；
       2. POST 强制 application/json —— 此前 compaction-config / sidebar-entries /
          task-auto-inject / task-auto-extract / dispatch-menu / memory-storage /
          global-prompt 这 7 条只按 body 内容校验，text/plain 的浏览器简单请求
          能绕过预检直接写入（跨站 CSRF 面）。

     ⚠️ 新增 HTTP 路由必须用本 handle()：handle('/dsh-session-kit/xxx', async (req, res) => {...})
        绝不可直接调用 ctx.webServer.register，否则该路由没有任何鉴权。
        二进制/流式上行路由传第三个参数 { jsonBody: false } 豁免内容类型门禁
        （鉴权仍保留）。细节与自检方法见 route-guard.js 文件头「新增 HTTP 路由时必读」。 */
  const handle = (path, fn, options) => ctx.webServer.register({
    kind: 'exact',
    path,
    handler: (req, res) => {
      if (!fenceRoute({ ctx, req, res, respond, jsonBody: options?.jsonBody !== false })) return undefined;
      return fn(req, res);
    }
  });
  const route = async (req, res, action) => {
    if (req.method !== 'POST') return respond(res, 405, { ok: false, error: 'method-not-allowed' });
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return respond(res, 400, { ok: false, error: 'bad-request' });
    }
    const id = sessionIdOf(body);
    if (!id) return respond(res, 400, { ok: false, error: 'invalid-session-id' });
    try {
      return await action(id, res);
    } catch (error) {
      ctx.logger?.warn?.(`[${name}] route failed:`, error);
      return respond(res, 500, { ok: false, error: 'operation-failed' });
    }
  };

  ctx.effect(() => handle(OPEN_ROUTE, (req, res) => route(req, res, async (id) => {
    const meta = await persistenceHeaderById(ctx.sessionPersistence, id);
    if (!meta) return respond(res, 404, { ok: false, error: 'session-not-found' });
    const location = typeof ctx.sessionPersistence.locate === 'function' ? ctx.sessionPersistence.locate(meta) : undefined;
    const dir = location?.path ? dirname(location.path) : undefined;
    if (!dir || !existsSync(dir)) return respond(res, 404, { ok: false, error: 'folder-not-found' });
    openSystemFolder(dir);
    return respond(res, 200, { ok: true });
  })), `${name}: open session folder route`);

  ctx.effect(() => handle(DELETE_ROUTE, (req, res) => route(req, res, async (id) => {
    const agent = ctx.agents.get(id);
    if (agent?.status === 'running') return respond(res, 409, { ok: false, error: 'session-running' });
    const meta = await persistenceHeaderById(ctx.sessionPersistence, id);
    if (!meta && !agent) return respond(res, 404, { ok: false, error: 'session-not-found' });
    if (meta !== undefined && typeof ctx.sessionPersistence.locate !== 'function') return respond(res, 501, { ok: false, error: 'delete-unsupported' });
    const location = meta ? ctx.sessionPersistence.locate(meta) : undefined;
    if (meta !== undefined && (location === undefined || typeof location.path !== 'string' || location.path.length === 0)) return respond(res, 501, { ok: false, error: 'delete-unsupported' });
    const dir = location ? dirname(location.path) : undefined;
    const wasArchived = ctx.workspaceRegistry.archivedSessionIds.includes(id);
    deletedSessionIds.add(id);
    try {
      await ctx.workspaceRegistry.archiveSession(id);
      /* 级联收集须在父日志目录进回收站之前完成（catalog 兜底要读父日志）。 */
      const cascadeDeleted = await cascadeDeleteSubagentSessions(ctx, id);
      if (dir && existsSync(dir)) await deleteStoppedSessionDirectory(dir);
      return respond(res, 200, { ok: true, ...(cascadeDeleted.length > 0 ? { cascadeDeletedSubagentSessions: cascadeDeleted } : {}) });
    } catch (error) {
      deletedSessionIds.delete(id);
      if (!wasArchived) await setArchivedSessionIds(ctx, (ids) => ids.filter((sessionId) => sessionId !== id)).catch(() => undefined);
      throw error;
    }
  })), `${name}: delete session route`);

  /* llm/stream 墓碑过滤：在请求进入任何 provider 适配器之前剔除非模型可见的墓碑消息。
     - 宿主各渠道对「空 content」的容忍不一致（如 openai-responses 会把 "" 转成
       {type:'input_text',text:''} 仍发送，严格网关会二次校验并返回 400），
       因此不能依赖下游丢弃，必须在此主动剔除。
     - listener 拿到的 options 已被 agent-loop 冻结（markAgentLoopRequest），
       过滤器内部按需构造新对象，绝不原地改写。
     - 失败降级：过滤属优化项，异常时放行原请求，不阻断对话。 */
  ctx.effect(() => ctx.on('llm/stream', (options, next) => {
    let filtered = options;
    try {
      filtered = filterTombstonesFromRequest(options);
    } catch (error) {
      ctx.logger?.warn?.(`[${name}] tombstone request filter failed:`, error);
    }
    return next(filtered);
  }, { prepend: true }), `${name}: llm/stream tombstone filter`);

  ctx.effect(function* () {
    yield async () => {
      compactionController.restoreEngines();
      /* ⚠️ 五个 storage domain 必须【全部】关闭后再让插件卸载，否则残留两个：
         此前这里只关了 compaction / sidebarEntries / globalPrompt 三个，
         taskAutoInjectStore 与 memoryStorageStore 从未关闭 —— 它们的记录连同
         facility 的 reserved 名字一起留在内存里。停用插件不重启、再启用时，
         apply() 重跑 → storageDomain.open(taskAutoInjectDomainSpec) 撞上
         reserve 里的同名条目 → 抛 `already-open: domain
         'dsh_session_kit_task_auto_inject' is already open`，用户看到的就是
         「停用-激活插件时报错…（需要重启才行）」：只有重启进程才清空 reserved，
         这正是该报错的唯一成因。
         关闭是幂等的（Domain.close 内部 disposal ??= runClose），
         与 facility 兜底的 closeAll() 重复调用无害。
         ⚠️ 用 allSettled 而非 all：任何一个关闭失败都不该连累其余四个，
         否则同样会留下未关闭的名字、让下一次启用再次撞 already-open。 */
      const closers = [
        ['globalPromptController', () => globalPromptController.dispose()],
        ['compactionStore', () => compactionStore.close()],
        ['sidebarEntriesStore', () => sidebarEntriesStore.close()],
        ['globalPromptStore', () => globalPromptStore.close()],
        ['taskAutoInjectStore', () => taskAutoInjectStore.close()],
        ['taskAutoExtractStore', () => taskAutoExtractStore.close()],
        ['memoryStorageStore', () => memoryStorageStore.close()],
        ['dispatchMenuStore', () => dispatchMenuStore.close()],
        ['autoArchiveStore', () => autoArchiveStore.close()]
      ];
      const settled = await Promise.allSettled(closers.map(([, close]) => Promise.resolve().then(close)));
      settled.forEach((result, index) => {
        if (result.status === 'rejected') {
          ctx.logger?.warn?.(`[${name}] ${closers[index][0]} dispose failed:`, result.reason);
        }
      });
    };
    yield ctx.on('agent/created', ({ agent }) => {
      try {
        globalPromptController.installAgent(agent);
      } catch (error) {
        ctx.logger?.warn?.(`[${name}] global prompt install failed:`, error);
      }
    });
    yield ctx.on('agent/disposed', ({ agent }) => {
      globalPromptController.disposeAgent(agent);
    });
    yield ctx.on('agent/pre-step', ({ agent }, next) => {
      try {
        compactionController.applyToAgent(agent);
      } catch (error) {
        ctx.logger?.warn?.(`[${name}] compaction config apply failed:`, error);
      }
      return next();
    }, { prepend: true });
  }, `${name}: runtime compaction config`);

  ctx.effect(() => handle(COMPACTION_CONFIG_ROUTE, async (req, res) => {
    let defaults = DEFAULT_COMPACTION_VALUES;
    try {
      defaults = await compactionDefaultsForRequest(ctx, compactionController, req);
    } catch (error) {
      ctx.logger?.warn?.(`[${name}] compaction defaults lookup failed:`, error);
    }
    if (req.method === 'GET') {
      compactionSettings = normalizeCompactionSettings(compactionStore.global.get(), defaults);
      return respond(res, 200, { ok: true, value: compactionSettings, defaults });
    }
    if (req.method !== 'POST') return respond(res, 405, { ok: false, error: 'method-not-allowed' });
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return respond(res, 400, { ok: false, error: 'bad-request' });
    }
    const submitted = {
      enabled: body?.enabled,
      thresholdRatio: body?.thresholdRatio,
      retainRatio: body?.retainRatio,
      maxTokens: body?.maxTokens,
      compactionRetries: body?.compactionRetries,
      maxOverflowRetries: body?.maxOverflowRetries
    };
    const validationError = validateCompactionSettings(submitted);
    if (validationError !== undefined) return respond(res, 400, { ok: false, error: validationError });
    try {
      compactionSettings = normalizeCompactionSettings(submitted, defaults);
      await compactionStore.global.set(compactionSettings);
      await compactionController.applyToLiveAgents();
      return respond(res, 200, { ok: true, value: compactionSettings, defaults });
    } catch (error) {
      ctx.logger?.warn?.(`[${name}] compaction config save failed:`, error);
      return respond(res, 500, { ok: false, error: 'compaction-config-failed' });
    }
  }), `${name}: compaction config HTTP route`);

  ctx.effect(() => handle('/dsh-session-kit/sidebar-entries', async (req, res) => {
    if (req.method === 'GET') return respond(res, 200, { ok: true, value: normalizeSidebarEntries(sidebarEntriesStore.global.get()) });
    if (req.method !== 'POST') return respond(res, 405, { ok: false, error: 'method-not-allowed' });
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return respond(res, 400, { ok: false, error: 'bad-request' });
    }
    if (typeof body?.memoryVisible !== 'boolean' || typeof body?.archiveVisible !== 'boolean' || (body?.taskVisible !== undefined && typeof body.taskVisible !== 'boolean') || (body?.leftNavEnabled !== undefined && typeof body.leftNavEnabled !== 'boolean') || (body?.rightNavEnabled !== undefined && typeof body.rightNavEnabled !== 'boolean') || (body?.memoryTabVisible !== undefined && typeof body.memoryTabVisible !== 'boolean')) return respond(res, 400, { ok: false, error: 'invalid-sidebar-entries' });
    try {
      const current = sidebarEntriesStore.global.get();
      const value = {
        memoryVisible: body.memoryVisible,
        archiveVisible: body.archiveVisible,
        taskVisible: body.taskVisible === undefined ? current?.taskVisible !== false : body.taskVisible,
        leftNavEnabled: body.leftNavEnabled === undefined ? current?.leftNavEnabled !== false : body.leftNavEnabled,
        rightNavEnabled: body.rightNavEnabled === undefined ? current?.rightNavEnabled !== false : body.rightNavEnabled,
        /* 缺省回落 true（默认显示记忆 tab），与 normalizeSidebarEntries 的默认一致。 */
        memoryTabVisible: body.memoryTabVisible === undefined ? current?.memoryTabVisible !== false : body.memoryTabVisible
      };
      await sidebarEntriesStore.global.set(value);
      return respond(res, 200, { ok: true, value });
    } catch (error) {
      ctx.logger?.warn?.(`[${name}] sidebar entries save failed:`, error);
      return respond(res, 500, { ok: false, error: 'sidebar-entries-failed' });
    }
  }), `${name}: sidebar entries HTTP route`);

  /* 自动归档设置 + 结果（v13.15）。
     GET          → { enabled, idleDays, lastScanAt, lastResult{...} }
     POST action=save     → 保存开关与天数
     POST action=scan     → 立即扫描一次（同样受 enabled 开关约束；
                            关闭时只回报 disabled，不改归档集）
     POST action=ack      → 客户端已展示过提醒，清掉 pendingToast
     ⚠️ 新路由必须走本 handle()（鉴权 + content-type 门禁），不可直接 webServer.register。 */
  /* ── 自动归档结果推送（SSE，v13.26）──
     代替原先前端每 30s 一次的轮询。
     为什么改用推送：自动归档一天触发一次（启动时 + 每 24h），
     30s 轮询意味着 2880 次请求里 2879 次都在问"有没有新结果"，
     而且从扫描完成到弹窗出现最多要等 30 秒。
     宿主的扫描本来就在本进程内，扫描结束的那一刻直接把结果写进
     各条打开的 SSE 连接即可 —— 零延迟、无无效请求。
     连接集合是内存态：客户端断开（刷新/关页）时移除，不需要持久化。 */
  const autoArchiveStreams = new Set();
  const broadcastAutoArchiveResult = (payload) => {
    const frame = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of autoArchiveStreams) {
      try {
        res.write(frame);
      } catch (error) {
        /* 单条连接写失败只影响它自己，不影响其它订阅者。 */
        autoArchiveStreams.delete(res);
        ctx.logger?.debug?.(`[${name}] auto archive stream write failed:`, error);
      }
    }
  };

  ctx.effect(() => handle('/dsh-session-kit/auto-archive/stream', (req, res) => {
    if (req.method !== 'GET') return respond(res, 405, { ok: false, error: 'method-not-allowed' });
    /* SSE 响应头：禁缓存、保持长连接。X-Accel-Buffering 是给反向代理看的，
       本地直连无害。 */
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    });
    /* 首帧立即发一次当前状态：客户端刚连上时若已有待提醒结果，不必等下一次扫描。 */
    try {
      res.write(`data: ${JSON.stringify({ type: 'snapshot', value: autoArchivePayload() })}\n\n`);
    } catch { /* 连接已断，交给 close 处理 */ }
    autoArchiveStreams.add(res);
    /* 心跳：30s 一次注释帧，防止中间层因空闲断流（SSE 的标准做法）。 */
    const heartbeat = setInterval(() => {
      try {
        res.write(': keep-alive\n\n');
      } catch {
        clearInterval(heartbeat);
        autoArchiveStreams.delete(res);
      }
    }, 30_000);
    heartbeat?.unref?.();
    const cleanup = () => {
      clearInterval(heartbeat);
      autoArchiveStreams.delete(res);
    };
    req.on('close', cleanup);
    req.on('error', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
    return undefined;
  }), `${name}: auto archive SSE stream`);

  const autoArchivePayload = () => {
    const settings = autoArchiveStoreOf(autoArchiveStore);
    return {
      enabled: settings.enabled,
      idleDays: settings.idleDays,
      lastScanAt: settings.lastScanAt,
      lastResult: settings.lastResultPendingToast
        ? {
          at: settings.lastResultAt,
          sessionIds: settings.lastResultIds,
          pendingToast: true
        }
        : { at: settings.lastResultAt, sessionIds: settings.lastResultIds, pendingToast: false }
    };
  };

  ctx.effect(() => handle('/dsh-session-kit/auto-archive', async (req, res) => {
    if (req.method === 'GET') return respond(res, 200, { ok: true, value: autoArchivePayload() });
    if (req.method !== 'POST') return respond(res, 405, { ok: false, error: 'method-not-allowed' });
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return respond(res, 400, { ok: false, error: 'bad-request' });
    }
    const action = typeof body?.action === 'string' ? body.action : 'save';
    try {
      if (action === 'save') {
        const current = autoArchiveStoreOf(autoArchiveStore);
        if (typeof body?.enabled !== 'boolean') return respond(res, 400, { ok: false, error: 'invalid-auto-archive' });
        const rawDays = Number(body?.idleDays);
        const idleDays = Number.isFinite(rawDays)
          ? Math.min(AUTO_ARCHIVE_MAX_IDLE_DAYS, Math.max(AUTO_ARCHIVE_MIN_IDLE_DAYS, Math.round(rawDays)))
          : current.idleDays;
        const next = { ...current, enabled: body.enabled, idleDays };
        await autoArchiveStore.global.set(next);
        return respond(res, 200, { ok: true, value: autoArchivePayload() });
      }
      if (action === 'scan') {
        const result = await runAutoArchiveScan();
        return respond(res, 200, { ok: true, value: { ...autoArchivePayload(), scan: result } });
      }
      if (action === 'ack') {
        const current = autoArchiveStoreOf(autoArchiveStore);
        await autoArchiveStore.global.set({ ...current, lastResultPendingToast: false });
        return respond(res, 200, { ok: true, value: autoArchivePayload() });
      }
      return respond(res, 400, { ok: false, error: 'unknown-action' });
    } catch (error) {
      ctx.logger?.warn?.(`[${name}] auto archive action failed:`, error);
      return respond(res, 500, { ok: false, error: 'auto-archive-failed' });
    }
  }), `${name}: auto archive HTTP route`);


  /* 任务自动注入开关：GET 读当前值，POST 写新值（必须是布尔）。 */
  ctx.effect(() => handle('/dsh-session-kit/task-auto-inject', async (req, res) => {
    if (req.method === 'GET') return respond(res, 200, { ok: true, value: normalizeTaskAutoInject(taskAutoInjectStore.global.get()) });
    if (req.method !== 'POST') return respond(res, 405, { ok: false, error: 'method-not-allowed' });
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return respond(res, 400, { ok: false, error: 'bad-request' });
    }
    if (typeof body?.enabled !== 'boolean') return respond(res, 400, { ok: false, error: 'invalid-task-auto-inject' });
    try {
      const value = { enabled: body.enabled };
      await taskAutoInjectStore.global.set(value);
      taskAutoInjectRef.value = value.enabled;
      return respond(res, 200, { ok: true, value });
    } catch (error) {
      ctx.logger?.warn?.(`[${name}] task auto inject save failed:`, error);
      return respond(res, 500, { ok: false, error: 'task-auto-inject-failed' });
    }
  }), `${name}: task auto inject HTTP route`);

  /* 任务自动提取开关（v12.92）：GET 读当前值，POST 写新值（必须是布尔）。
     关闭时会话 todo 不再自动派生新任务档案（手动提取不受影响）。 */
  ctx.effect(() => handle('/dsh-session-kit/task-auto-extract', async (req, res) => {
    if (req.method === 'GET') return respond(res, 200, { ok: true, value: normalizeTaskAutoInject(taskAutoExtractStore.global.get()) });
    if (req.method !== 'POST') return respond(res, 405, { ok: false, error: 'method-not-allowed' });
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return respond(res, 400, { ok: false, error: 'bad-request' });
    }
    if (typeof body?.enabled !== 'boolean') return respond(res, 400, { ok: false, error: 'invalid-task-auto-extract' });
    try {
      const value = { enabled: body.enabled };
      await taskAutoExtractStore.global.set(value);
      taskAutoExtractRef.value = value.enabled;
      return respond(res, 200, { ok: true, value });
    } catch (error) {
      ctx.logger?.warn?.(`[${name}] task auto extract save failed:`, error);
      return respond(res, 500, { ok: false, error: 'task-auto-extract-failed' });
    }
  }), `${name}: task auto extract HTTP route`);

  /* 对话操作按钮菜单：GET 读当前值，POST 整体写（缺省字段保持原值）。 */
  ctx.effect(() => handle('/dsh-session-kit/dispatch-menu', async (req, res) => {
    if (req.method === 'GET') return respond(res, 200, { ok: true, value: normalizeDispatchMenu(dispatchMenuStore.global.get()) });
    if (req.method !== 'POST') return respond(res, 405, { ok: false, error: 'method-not-allowed' });
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return respond(res, 400, { ok: false, error: 'bad-request' });
    }
    for (const key of ['userEnabled', 'assistantEnabled', 'composerForkButtonEnabled']) {
      if (body?.[key] !== undefined && typeof body[key] !== 'boolean') return respond(res, 400, { ok: false, error: 'invalid-dispatch-menu' });
    }
    for (const key of ['userActions', 'assistantActions']) {
      if (body?.[key] === undefined) continue;
      if (!Array.isArray(body[key]) || body[key].some((item) => typeof item !== 'string')) {
        return respond(res, 400, { ok: false, error: 'invalid-dispatch-menu' });
      }
    }
    try {
      const current = normalizeDispatchMenu(dispatchMenuStore.global.get());
      const value = {
        userEnabled: body?.userEnabled === undefined ? current.userEnabled : body.userEnabled,
        assistantEnabled: body?.assistantEnabled === undefined ? current.assistantEnabled : body.assistantEnabled,
        userActions: body?.userActions === undefined ? current.userActions : body.userActions,
        assistantActions: body?.assistantActions === undefined ? current.assistantActions : body.assistantActions,
        composerForkButtonEnabled: body?.composerForkButtonEnabled === undefined ? current.composerForkButtonEnabled : body.composerForkButtonEnabled
      };
      await dispatchMenuStore.global.set(value);
      return respond(res, 200, { ok: true, value: normalizeDispatchMenu(value) });
    } catch (error) {
      ctx.logger?.warn?.(`[${name}] dispatch menu save failed:`, error);
      return respond(res, 500, { ok: false, error: 'dispatch-menu-failed' });
    }
  }), `${name}: dispatch menu HTTP route`);

  /* 记忆数据保存目录：GET 读当前设置 + 默认/生效目录；POST 写设置。
     只改配置，不搬数据、不切连接；restartRequired 表示本次改动需重启 DSH 才生效。 */
  ctx.effect(() => handle(MEMORY_STORAGE_ROUTE, async (req, res) => {
    if (req.method === 'GET') {
      const value = normalizeMemoryStorage(memoryStorageStore.global.get());
      return respond(res, 200, {
        ok: true,
        value: {
          ...value,
          defaultPath: defaultMemoryDataDir(),
          activePath: activeMemoryDataDir,
          restartRequired: false
        }
      });
    }
    if (req.method !== 'POST') return respond(res, 405, { ok: false, error: 'method-not-allowed' });
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return respond(res, 400, { ok: false, error: 'bad-request' });
    }
    if (body?.mode !== MEMORY_STORAGE_MODE_DEFAULT && body?.mode !== MEMORY_STORAGE_MODE_CUSTOM) {
      return respond(res, 400, { ok: false, error: 'invalid-memory-storage-mode' });
    }
    const value = body.mode === MEMORY_STORAGE_MODE_CUSTOM
      ? { mode: MEMORY_STORAGE_MODE_CUSTOM, customPath: typeof body?.customPath === 'string' ? body.customPath.trim() : '' }
      : { mode: MEMORY_STORAGE_MODE_DEFAULT, customPath: '' };
    if (value.mode === MEMORY_STORAGE_MODE_CUSTOM) {
      const resolved = resolveCustomMemoryDir(value.customPath);
      if (resolved.error !== undefined) return respond(res, 400, { ok: false, error: resolved.error });
      value.customPath = resolved.value;
      const probe = probeMemoryDir(value.customPath);
      if (probe.error !== undefined) {
        ctx.logger?.warn?.(`[${name}] memory storage dir rejected ${value.customPath}: ${probe.error}${probe.detail === undefined ? '' : ` (${probe.detail})`}`);
        return respond(res, 400, { ok: false, error: probe.error });
      }
    }
    try {
      await memoryStorageStore.global.set(value);
      const restartRequired = !samePath(memoryDataDirFor(value), activeMemoryDataDir);
      ctx.logger?.info?.(`[${name}] memory storage dir set to ${memoryDataDirFor(value)} (restartRequired=${restartRequired})`);
      return respond(res, 200, {
        ok: true,
        value: {
          ...value,
          defaultPath: defaultMemoryDataDir(),
          activePath: activeMemoryDataDir,
          restartRequired
        }
      });
    } catch (error) {
      ctx.logger?.warn?.(`[${name}] memory storage save failed:`, error);
      return respond(res, 500, { ok: false, error: 'memory-storage-failed' });
    }
  }), `${name}: memory storage HTTP route`);

  ctx.effect(() => handle(GLOBAL_PROMPT_ROUTE, async (req, res) => {
    if (req.method === 'GET') {
      globalPromptSettings = normalizeGlobalPromptSettings(globalPromptStore.global.get());
      return respond(res, 200, { ok: true, value: globalPromptSettings });
    }
    if (req.method !== 'POST') return respond(res, 405, { ok: false, error: 'method-not-allowed' });
    let body;
    try {
      body = await readJsonBody(req, GLOBAL_PROMPT_MAX_TEXT_LENGTH * 4 + 4096);
    } catch {
      return respond(res, 400, { ok: false, error: 'bad-request' });
    }
    const submitted = {
      enabled: body?.enabled,
      text: body?.text
    };
    const validationError = validateGlobalPromptSettings(submitted);
    if (validationError !== undefined) return respond(res, 400, { ok: false, error: validationError });
    const previousSettings = globalPromptSettings;
    const wasActive = globalPromptController.isActive();
    try {
      globalPromptSettings = normalizeGlobalPromptSettings(submitted);
      globalPromptController.apply();
      await globalPromptStore.global.set(globalPromptSettings);
      return respond(res, 200, { ok: true, value: globalPromptSettings });
    } catch (error) {
      globalPromptSettings = previousSettings;
      try {
        globalPromptController.apply();
      } catch (restoreError) {
        if (!wasActive) void globalPromptController.dispose();
        ctx.logger?.warn?.(`[${name}] global prompt restore failed:`, restoreError);
      }
      ctx.logger?.warn?.(`[${name}] global prompt save failed:`, error);
      return respond(res, 500, { ok: false, error: 'global-prompt-failed' });
    }
  }), `${name}: global prompt HTTP route`);

  ctx.effect(() => handle(ARCHIVE_LIST_ROUTE, (req, res) => handleArchiveList(ctx, req, res)), `${name}: archive list HTTP route`);
  /* 手动归档路由：调核心 archiveSession 成功后，立刻写一条带真实时间的 manual 记录。 */
  ctx.effect(() => handle(ARCHIVE_SESSION_ROUTE, (req, res) => route(req, res, async (id) => {
    await ctx.workspaceRegistry.archiveSession(SessionId(id));
    recordArchiveSource(id, ARCHIVE_RECORD_SOURCE_MANUAL, Date.now());
    return respond(res, 200, { ok: true, value: { sessionId: id, archivedSessionIds: [...ctx.workspaceRegistry.archivedSessionIds] } });
  })), `${name}: manual archive HTTP route`);
  /* 收藏切换（v13.42）：只改 archive_records.favorite，不动归档集本身 ——
     "收藏"是归档列表之上的一个视图分类，不是另一种归档状态。 */
  ctx.effect(() => handle(ARCHIVE_FAVORITE_ROUTE, async (req, res) => {
    if (req.method !== 'POST') return respond(res, 405, { ok: false, error: 'method-not-allowed' });
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return respond(res, 400, { ok: false, error: 'bad-request' });
    }
    const id = sessionIdOf(body);
    if (!id) return respond(res, 400, { ok: false, error: 'invalid-session-id' });
    if (typeof body?.favorite !== 'boolean') return respond(res, 400, { ok: false, error: 'invalid-favorite' });
    /* 只有确实在归档集里的会话才谈得上"收藏的归档"。 */
    const archived = (ctx.workspaceRegistry?.archivedSessionIds ?? []).map(String);
    if (!archived.includes(String(id))) return respond(res, 404, { ok: false, error: 'session-not-archived' });
    /* 旧归档在表里可能没有记录，此时用它的归档时间（若有）作兜底写入。 */
    const source = readArchiveSources().get(String(id));
    const ok = setArchiveFavorite(id, body.favorite, source?.archivedAt ?? 0);
    if (!ok) return respond(res, 500, { ok: false, error: 'favorite-failed' });
    return respond(res, 200, { ok: true, value: { sessionId: String(id), favorite: body.favorite } });
  }), `${name}: archive favorite HTTP route`);
  ctx.effect(() => handle(ARCHIVE_RESTORE_ROUTE, (req, res) => handleArchiveRestore(ctx, req, res)), `${name}: archive restore HTTP route`);
  ctx.effect(() => handle(ARCHIVE_DELETE_ROUTE, (req, res) => handleArchiveDelete(ctx, req, res)), `${name}: archive delete HTTP route`);
  ctx.effect(() => handle(ARCHIVE_PREVIEW_ROUTE, (req, res) => handleArchivePreview(ctx, req, res)), `${name}: archive preview HTTP route`);
  ctx.effect(() => handle(TOOL_STATS_ROUTE, (req, res) => handleToolStats(ctx, req, res)), `${name}: tool stats HTTP route`);
  ctx.effect(() => handle(REPAIR_SESSION_ROUTE, (req, res) => handleRepairSession(ctx, req, res)), `${name}: repair session HTTP route`);
  ctx.effect(() => handle(TURNS_DEL_RANGES_PATH, (req, res) => handleTurnsDelRanges(ctx, req, res)), `${name}: turns-del ranges HTTP route`);
  ctx.effect(() => handle(TURNS_DEL_PATH, (req, res) => handleTurnsDel(ctx, req, res)), `${name}: turns-del HTTP route`);
  ctx.effect(() => handle(TURNS_DEL_TURN_PATH, (req, res) => handleTurnsDelTurn(ctx, req, res)), `${name}: turns-del turn HTTP route`);
  ctx.effect(() => handle(REGENERATE_PATH, (req, res) => handleRegenerateTurns(ctx, req, res)), `${name}: turns-del regenerate HTTP route`);
  ctx.effect(() => handle(REGENERATE_TURN_PATH, (req, res) => handleRegenerateTurnsByTurn(ctx, req, res)), `${name}: turns-del regenerate turn HTTP route`);
  ctx.effect(() => handle(EDIT_REGENERATE_TURN_PATH, (req, res) => handleEditRegenerateTurnsByTurn(ctx, req, res)), `${name}: turns-del edit regenerate turn HTTP route`);
}
