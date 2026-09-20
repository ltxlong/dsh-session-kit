import { MessageId, createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId, foldSurface } from '@deepseek-ai/dsh-session';
import { isAppendSurfaceEvent, isReplacementSurfaceEvent } from '@deepseek-ai/dsh-session/surface';
import { defineDomain } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn as childSpawn, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { constants as zlibConstants, zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { installMemoryFeature } from './memory.js';
import { installTaskFeature } from './task.js';

const require = createRequire(import.meta.url);
const name = 'dsh-session-kit';
const inject = ['webServer', 'sessionPersistence', 'workspaceRegistry', 'agents', 'sessions', 'storageDomain', 'systemPrompt', 'llm'];
const OPEN_ROUTE = '/dsh-session-kit/open-folder';
const DELETE_ROUTE = '/dsh-session-kit/delete';
const ARCHIVE_LIST_ROUTE = '/dsh-session-kit/archive/list';
const ARCHIVE_RESTORE_ROUTE = '/dsh-session-kit/archive/restore';
const ARCHIVE_DELETE_ROUTE = '/dsh-session-kit/archive/delete';
const ARCHIVE_PREVIEW_ROUTE = '/dsh-session-kit/archive/preview';
const TOOL_STATS_ROUTE = '/dsh-session-kit/tool-stats';
const COMPACTION_CONFIG_ROUTE = '/dsh-session-kit/compaction-config';
const REPAIR_SESSION_ROUTE = '/dsh-session-kit/repair-session';
const GLOBAL_PROMPT_ROUTE = '/dsh-session-kit/global-prompt';
const GLOBAL_PROMPT_SECTION = 'dsh-session-kit:global-prompt';
const GLOBAL_PROMPT_ORDER = 10;
const GLOBAL_PROMPT_MAX_TEXT_LENGTH = 200000;
const TURNS_DEL_PATH = '/dsh-turns-del';
const TURNS_DEL_TURN_PATH = '/dsh-turns-del/turn';
const REGENERATE_PATH = '/dsh-turns-del-regenerate';
const REGENERATE_TURN_PATH = '/dsh-turns-del-regenerate/turn';
const EDIT_REGENERATE_TURN_PATH = '/dsh-turns-del-edit-regenerate/turn';
const TURNS_DEL_PROVIDER = 'dsh-turns-del';
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
      taskVisible: z.boolean().optional()
    }),
    initial: {}
  },
  tables: {}
});
const globalPromptDomainSpec = defineDomain({
  name: 'dsh_session_kit_global_prompt',
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
const MAX_SESSION_BODY_BYTES = 65536;
const MAX_TURNS_DEL_BODY_BYTES = 512 * 1024;
const DEFAULT_ARCHIVE_PREVIEW_LIMIT = 30;
const MAX_ARCHIVE_PREVIEW_LIMIT = 100000;
const deletedSessionIds = new Set();

function normalizeSidebarEntries(value) {
  return {
    memoryVisible: value?.memoryVisible !== false,
    archiveVisible: value?.archiveVisible !== false,
    taskVisible: value?.taskVisible !== false
  };
}

/* 默认开启：未显式关闭即视为 true。 */
function normalizeTaskAutoInject(value) {
  return { enabled: value?.enabled !== false };
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

/* v3 墓碑：空 content 的 user/message 替换。
   - v3 禁止 assistant/message 作为替换且禁止其携带 sourceEventSeqs；system/message
     受"必须匹配 open step"的 artifact 级关系校验约束，turn/end 之后无法落盘。
   - user/message 替换无 turn/step 约束；两个官方适配器（pi-ai / deepseek）都会
     跳过空文本 user 消息，墓碑不进入模型上下文。
   - 元数据（turn/endTurn/regeneration）存于 source.summary 的 JSON：
     plugin source 白名单只允许 kind/plugin/form/sections/summary。 */
function turnsDelTombstoneMetaOf(event) {
  if (event.type !== 'user/message' || !isReplacementSurfaceEvent(event)) return undefined;
  const source = event.data?.source;
  if (source?.kind !== 'plugin' || source?.plugin !== TURNS_DEL_PROVIDER || source?.form !== 'notice') return undefined;
  if (!Array.isArray(event.data.content) || event.data.content.length !== 0) return undefined;
  let meta = {};
  try {
    const parsed = JSON.parse(source.summary ?? '');
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

/* 新运行时移除了 agent.runMaintenance：退化为“空闲时直接执行”的等效维护入口。
   无互斥租约，轮次手术与新一轮启动间存在极小竞态窗口，以执行前的忙闲检查收窄。 */
function runAgentMaintenance(agent, fn) {
  if (typeof agent?.runMaintenance === 'function') return agent.runMaintenance(fn);
  if (agent?.status === 'running' || hasInboxPending(agent)) throw new TurnsDelError('AGENT_BUSY', 'session is running; retry when it is idle');
  const controller = new AbortController();
  return fn(controller.signal);
}

function eventTurn(event) {
  if (event.type === 'assistant/message' || event.type === 'tool/result') return event.data.turn;
}

function turnBracket(events, turn, targetSeq) {
  const start = events.findLast((event) => event.seq <= targetSeq && event.type === 'turn/start' && event.data.turn === turn);
  const end = events.find((event) => event.seq >= targetSeq && event.type === 'turn/end' && event.data.turn === turn);
  return start === undefined || end === undefined ? undefined : { start: start.seq, end: end.seq };
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
  return events.find((event) => turnsDelTombstoneMetaOf(event)?.turn === turn);
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
  const currentNodes = session.surface.nodes;
  /* 新运行时把 system prompt 追加进首轮 bracket 内，而 node 0 受系统头保护：
     只能被恰好覆盖它的 system/message 重写。删除 span 必须排除 system 头，
     否则 append 阶段直接被 assertSystemHeadRewrite 拒绝。 */
  const headSeq = currentNodes[0];
  if (headSeq !== undefined && events[headSeq]?.type === 'system/message') originSeqs.delete(headSeq);
  const targetOnSurface = currentNodes.includes(targetSeq);
  if (options.requireTargetNode !== false && !targetOnSurface) throw new TurnsDelError('TURN_COMPACTED', `turn ${String(turn)} is no longer independently deletable`);
  const memo = new Map();
  const selected = [];

  for (const seq of currentNodes) {
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

function appendTurnTombstone(session, turn, selected, regeneration) {
  const message = createUserMessage({
    content: [],
    source: {
      kind: 'plugin',
      plugin: TURNS_DEL_PROVIDER,
      form: 'notice',
      summary: JSON.stringify({ turn, endTurn: turn, ...(regeneration === undefined ? {} : { regeneration }) })
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

  // Capture only completed turns. The loop then processes them in reverse order,
  // recreating the proven single-turn algorithm against the latest live surface
  // after every append. This prevents a replacement from targeting stale nodes.
  const requestedTurns = completedTurnsFrom(initialEvents, startTurn);
  if (requestedTurns.length === 0) throw new TurnsDelError('TURN_NOT_CLOSED', `turn ${String(startTurn)} is not closed`);

  const deletedTurns = [];
  const tombstoneSeqs = [];
  for (const turn of [...requestedTurns].reverse()) {
    signal.throwIfAborted();
    const events = sessionEvents(session);
    const currentSurface = new Set(session.surface.nodes);
    const clickedTarget = byTurn === undefined && turn === startTurn ? target : undefined;
    const assistant = clickedTarget ?? events.findLast((event) => event.type === 'assistant/message' && isAppendSurfaceEvent(event) && event.data.turn === turn && currentSurface.has(event.seq))
      ?? events.findLast((event) => event.type === 'assistant/message' && isAppendSurfaceEvent(event) && event.data.turn === turn);
    const existing = deletionTombstoneForTurn(events, turn);
    if (existing !== undefined) continue;

    const selectSeq = clickedTarget?.seq ?? assistant?.seq ?? turnEndSeq(events, turn);
    const selected = selectIndependentTurnSurface(session, events, turn, selectSeq, { requireTargetNode: clickedTarget !== undefined });
    signal.throwIfAborted();
    const tombstone = appendTurnTombstone(session, turn, selected, regeneration);
    deletedTurns.unshift(turn);
    tombstoneSeqs.unshift(tombstone.seq);
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
  return flush ? ctx.sessions.flush(session).then(() => result) : result;
}

async function deleteTurns(ctx, agent, assistantMessageId) {
  try {
    return await runAgentMaintenance(agent, (signal) => deleteTurnsUnderMaintenance(ctx, agent, assistantMessageId, signal));
  } catch (error) {
    if (error instanceof TurnsDelError) throw error;
    throw new TurnsDelError('AGENT_BUSY', error instanceof Error ? error.message : String(error));
  }
}

async function deleteTurnsByTurn(ctx, agent, turn) {
  try {
    return await runAgentMaintenance(agent, (signal) => deleteTurnsUnderMaintenance(ctx, agent, undefined, signal, { byTurn: turn }));
  } catch (error) {
    if (error instanceof TurnsDelError) throw error;
    throw new TurnsDelError('AGENT_BUSY', error instanceof Error ? error.message : String(error));
  }
}

function decodeTurnsDelRequest(value) {
  if (typeof value !== 'object' || value === null) throw new TypeError('request body must be an object');
  if (typeof value.sessionId !== 'string' || value.sessionId.length === 0) throw new TypeError('sessionId must be a non-empty string');
  if (typeof value.assistantMessageId !== 'string' || value.assistantMessageId.length === 0) throw new TypeError('assistantMessageId must be a non-empty string');
  return { sessionId: value.sessionId, assistantMessageId: value.assistantMessageId };
}

function decodeTurnRequest(value) {
  if (typeof value !== 'object' || value === null) throw new TypeError('request body must be an object');
  if (typeof value.sessionId !== 'string' || value.sessionId.length === 0) throw new TypeError('sessionId must be a non-empty string');
  if (!Number.isSafeInteger(value.turn) || value.turn < 0) throw new TypeError('turn must be a non-negative integer');
  return { sessionId: value.sessionId, turn: value.turn };
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

function userPromptForTurn(events, turn, targetSeq) {
  const bracket = turnBracket(events, turn, targetSeq);
  if (bracket === undefined) throw new TurnsDelError('TURN_NOT_CLOSED', `turn ${String(turn)} is not closed`);
  const prompts = events.filter((event) => event.type === 'user/message'
    && isAppendSurfaceEvent(event)
    && event.seq > bracket.start
    && event.seq < bracket.end
    && event.data.source?.kind === 'user');
  if (prompts.length === 0) throw new TurnsDelError('PROMPT_NOT_FOUND', `turn ${String(turn)} has no user prompt to regenerate`);
  if (prompts.length !== 1) throw new TurnsDelError('PROMPT_AMBIGUOUS', `turn ${String(turn)} has multiple user prompts and cannot be regenerated safely`);
  const content = prompts[0].data.content;
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
  const originalPrompt = userPromptForTurn(eventsSnapshot, turn, targetSeq);
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

async function regenerateTurns(ctx, agent, assistantMessageId, operationId) {
  try {
    return await runAgentMaintenance(agent, (signal) => regenerateTurnsUnderMaintenance(ctx, agent, assistantMessageId, operationId, signal));
  } catch (error) {
    if (error instanceof TurnsDelError) throw error;
    throw new TurnsDelError('AGENT_BUSY', error instanceof Error ? error.message : String(error));
  }
}

async function regenerateTurnsByTurn(ctx, agent, turn, operationId) {
  try {
    return await runAgentMaintenance(agent, (signal) => regenerateTurnsUnderMaintenance(ctx, agent, undefined, operationId, signal, { byTurn: turn }));
  } catch (error) {
    if (error instanceof TurnsDelError) throw error;
    throw new TurnsDelError('AGENT_BUSY', error instanceof Error ? error.message : String(error));
  }
}

async function editRegenerateTurnsByTurn(ctx, agent, turn, operationId, text) {
  try {
    return await runAgentMaintenance(agent, (signal) => regenerateTurnsUnderMaintenance(ctx, agent, undefined, operationId, signal, { byTurn: turn, editedText: text }));
  } catch (error) {
    if (error instanceof TurnsDelError) throw error;
    throw new TurnsDelError('AGENT_BUSY', error instanceof Error ? error.message : String(error));
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
      return respond(res, error.code === 'AGENT_BUSY' ? 423 : 409, { ok: false, error: { code: error.code, message: error.message } });
    }
    return respond(res, 400, { ok: false, error: { code: 'INVALID_REQUEST', message: error instanceof Error ? error.message : String(error) } });
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
  return handleTurnsDelAction(ctx, req, res, decodeRegenerateTurnRequest, (runtime, agent, input) => regenerateTurnsByTurn(runtime, agent, input.turn, input.operationId));
}

function handleEditRegenerateTurnsByTurn(ctx, req, res) {
  return handleTurnsDelAction(ctx, req, res, decodeEditRegenerateTurnRequest, (runtime, agent, input) => editRegenerateTurnsByTurn(runtime, agent, input.turn, input.operationId, input.text));
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

async function archivedSessionItems(ctx) {
  const archivedIds = [...ctx.workspaceRegistry.archivedSessionIds].filter((sessionId) => !deletedSessionIds.has(sessionId));
  const metas = new Map((await ctx.sessionPersistence.list()).map(persistenceHeaderOf).filter((meta) => !deletedSessionIds.has(meta.id)).map((meta) => [meta.id, meta]));
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

function decodeArchivePreviewRequest(value) {
  const id = decodeArchiveRequest(value);
  const offset = Number.isSafeInteger(value?.offset) && value.offset >= 0 ? value.offset : 0;
  const rawLimit = Number.isSafeInteger(value?.limit) && value.limit > 0 ? value.limit : DEFAULT_ARCHIVE_PREVIEW_LIMIT;
  const tocOffset = Number.isSafeInteger(value?.tocOffset) && value.tocOffset >= 0 ? value.tocOffset : 0;
  const rawTocLimit = Number.isSafeInteger(value?.tocLimit) && value.tocLimit > 0 ? value.tocLimit : 10;
  const search = typeof value?.search === 'string' ? value.search.slice(0, 2000).trim() : '';
  return { sessionId: id, offset, limit: Math.min(rawLimit, MAX_ARCHIVE_PREVIEW_LIMIT), tocOffset, tocLimit: Math.min(rawTocLimit, 100), search };
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
   只要出现这些键就一定是插件写入的——DSH 的 source 白名单里没有它们。 */
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

async function deleteArchivedSession(ctx, sessionId) {
  const agent = ctx.agents.get(sessionId);
  if (agent?.status === 'running') throw new ArchiveError('SESSION_RUNNING', `session "${sessionId}" is running`);
  const meta = await persistenceHeaderById(ctx.sessionPersistence, sessionId);
  if (meta !== undefined && typeof ctx.sessionPersistence.locate !== 'function') throw new ArchiveError('DELETE_UNSUPPORTED', 'session persistence backend does not expose artifact locations', 501);
  const location = meta ? ctx.sessionPersistence.locate(meta) : undefined;
  if (meta !== undefined && (location === undefined || typeof location.path !== 'string' || location.path.length === 0)) throw new ArchiveError('DELETE_UNSUPPORTED', 'session persistence backend does not expose per-session artifact locations', 501);
  const dir = location ? dirname(location.path) : undefined;
  deletedSessionIds.add(sessionId);
  try {
    if (dir && existsSync(dir)) await deleteStoppedSessionDirectory(dir);
    // Keep the archive marker after deletion so a still-cached persistence entry
    // cannot briefly reappear in the normal session list as a restored session.
    const archivedSessionIds = await setArchivedSessionIds(ctx, (ids) => ids.includes(sessionId) ? ids : [...ids, sessionId]);
    return { sessionId, archivedSessionIds, deleted: meta !== undefined, items: await archivedSessionItems(ctx) };
  } catch (error) {
    deletedSessionIds.delete(sessionId);
    throw error;
  }
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
  return handleArchiveAction(ctx, req, res, (sessionId) => deleteArchivedSession(ctx, sessionId), decodeArchiveRequest);
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
  /* 运行时开关值：pre-step 每轮读取，避免频繁查库。 */
  const taskAutoInjectRef = { value: normalizeTaskAutoInject(taskAutoInjectStore.global.get()).enabled };
  let compactionSettings = normalizeCompactionSettings(compactionStore.global.get());
  let globalPromptSettings = normalizeGlobalPromptSettings(globalPromptStore.global.get());
  const compactionController = createCompactionRuntimeController(ctx, () => compactionSettings);
  const globalPromptController = createGlobalPromptRuntimeController(ctx, () => globalPromptSettings);
  globalPromptController.apply();
  await compactionController.applyToLiveAgents().catch((error) => ctx.logger?.warn?.(`[${name}] initial compaction config apply failed:`, error));
  /* 记忆与任务功能互相独立：任一失败都不阻塞另一个，也不阻塞插件本体。 */
  const memoryStore = await installMemoryFeature(ctx).catch((error) => {
    ctx.logger?.warn?.(`[${name}] memory feature install failed:`, error);
    return undefined;
  });
  if (memoryStore !== undefined) {
    await installTaskFeature(ctx, memoryStore, { isAutoInjectEnabled: () => taskAutoInjectRef.value }).catch((error) => ctx.logger?.warn?.(`[${name}] task feature install failed:`, error));
  }

  const handle = (path, fn) => ctx.webServer.register({ kind: 'exact', path, handler: fn });
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
      if (dir && existsSync(dir)) await deleteStoppedSessionDirectory(dir);
      return respond(res, 200, { ok: true });
    } catch (error) {
      deletedSessionIds.delete(id);
      if (!wasArchived) await setArchivedSessionIds(ctx, (ids) => ids.filter((sessionId) => sessionId !== id)).catch(() => undefined);
      throw error;
    }
  })), `${name}: delete session route`);

  ctx.effect(function* () {
    yield async () => {
      compactionController.restoreEngines();
      await Promise.all([
        globalPromptController.dispose(),
        compactionStore.close(),
        sidebarEntriesStore.close(),
        globalPromptStore.close()
      ]);
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
    if (typeof body?.memoryVisible !== 'boolean' || typeof body?.archiveVisible !== 'boolean' || (body?.taskVisible !== undefined && typeof body.taskVisible !== 'boolean')) return respond(res, 400, { ok: false, error: 'invalid-sidebar-entries' });
    try {
      const current = sidebarEntriesStore.global.get();
      const value = {
        memoryVisible: body.memoryVisible,
        archiveVisible: body.archiveVisible,
        taskVisible: body.taskVisible === undefined ? current?.taskVisible !== false : body.taskVisible
      };
      await sidebarEntriesStore.global.set(value);
      return respond(res, 200, { ok: true, value });
    } catch (error) {
      ctx.logger?.warn?.(`[${name}] sidebar entries save failed:`, error);
      return respond(res, 500, { ok: false, error: 'sidebar-entries-failed' });
    }
  }), `${name}: sidebar entries HTTP route`);

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
  ctx.effect(() => handle(ARCHIVE_RESTORE_ROUTE, (req, res) => handleArchiveRestore(ctx, req, res)), `${name}: archive restore HTTP route`);
  ctx.effect(() => handle(ARCHIVE_DELETE_ROUTE, (req, res) => handleArchiveDelete(ctx, req, res)), `${name}: archive delete HTTP route`);
  ctx.effect(() => handle(ARCHIVE_PREVIEW_ROUTE, (req, res) => handleArchivePreview(ctx, req, res)), `${name}: archive preview HTTP route`);
  ctx.effect(() => handle(TOOL_STATS_ROUTE, (req, res) => handleToolStats(ctx, req, res)), `${name}: tool stats HTTP route`);
  ctx.effect(() => handle(REPAIR_SESSION_ROUTE, (req, res) => handleRepairSession(ctx, req, res)), `${name}: repair session HTTP route`);
  ctx.effect(() => handle(TURNS_DEL_PATH, (req, res) => handleTurnsDel(ctx, req, res)), `${name}: turns-del HTTP route`);
  ctx.effect(() => handle(TURNS_DEL_TURN_PATH, (req, res) => handleTurnsDelTurn(ctx, req, res)), `${name}: turns-del turn HTTP route`);
  ctx.effect(() => handle(REGENERATE_PATH, (req, res) => handleRegenerateTurns(ctx, req, res)), `${name}: turns-del regenerate HTTP route`);
  ctx.effect(() => handle(REGENERATE_TURN_PATH, (req, res) => handleRegenerateTurnsByTurn(ctx, req, res)), `${name}: turns-del regenerate turn HTTP route`);
  ctx.effect(() => handle(EDIT_REGENERATE_TURN_PATH, (req, res) => handleEditRegenerateTurnsByTurn(ctx, req, res)), `${name}: turns-del edit regenerate turn HTTP route`);
}
