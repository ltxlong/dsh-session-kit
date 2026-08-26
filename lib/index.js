import { MessageId, createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId, foldSurface } from '@deepseek-ai/dsh-session';
import { isAppendSurfaceEvent, isReplacementSurfaceEvent } from '@deepseek-ai/dsh-session/surface';
import { defineDomain } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
import { existsSync } from 'node:fs';
import { spawn as childSpawn, spawnSync } from 'node:child_process';
import { dirname } from 'node:path';

const name = 'dsh-session-kit';
const inject = ['webServer', 'sessionPersistence', 'workspaceRegistry', 'agents', 'sessions', 'storageDomain', 'agentPresets', 'systemPrompt'];
const OPEN_ROUTE = '/dsh-session-kit/open-folder';
const DELETE_ROUTE = '/dsh-session-kit/delete';
const ARCHIVE_LIST_ROUTE = '/dsh-session-kit/archive/list';
const ARCHIVE_RESTORE_ROUTE = '/dsh-session-kit/archive/restore';
const ARCHIVE_DELETE_ROUTE = '/dsh-session-kit/archive/delete';
const ARCHIVE_PREVIEW_ROUTE = '/dsh-session-kit/archive/preview';
const TOOL_STATS_ROUTE = '/dsh-session-kit/tool-stats';
const COMPACTION_CONFIG_ROUTE = '/dsh-session-kit/compaction-config';
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
const TURNS_DEL_MODEL = 'tombstone';
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
const MAX_SESSION_BODY_BYTES = 65536;
const MAX_TURNS_DEL_BODY_BYTES = 512 * 1024;
const DEFAULT_ARCHIVE_PREVIEW_LIMIT = 30;
const MAX_ARCHIVE_PREVIEW_LIMIT = 100;
const deletedSessionIds = new Set();

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

function isTurnsDelEvent(event) {
  return event.type === 'assistant/message'
    && isReplacementSurfaceEvent(event)
    && event.data.message.content.length === 0
    && event.data.message.source.provider === TURNS_DEL_PROVIDER
    && event.data.message.source.model === TURNS_DEL_MODEL;
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
  return events.find((event) => isTurnsDelEvent(event) && event.data.turn === turn);
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

function stepForTurn(events, turn) {
  const start = events.find((event) => event.type === 'turn/start' && event.data.turn === turn);
  const end = events.find((event) => event.type === 'turn/end' && event.data.turn === turn);
  let step = 0;
  for (const event of events) {
    if (start !== undefined && event.seq <= start.seq) continue;
    if (end !== undefined && event.seq >= end.seq) break;
    const candidate = event.data?.turn === turn && Number.isSafeInteger(event.data?.step) ? event.data.step : undefined;
    if (candidate !== undefined) step = candidate;
  }
  return step;
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

function appendTurnTombstone(session, turn, step, selected, regeneration) {
  return session.append('assistant/message', {
    turn,
    endTurn: turn,
    step,
    ...(regeneration === undefined ? {} : { regeneration }),
    message: createAssistantMessage({
      content: [],
      source: { provider: TURNS_DEL_PROVIDER, model: TURNS_DEL_MODEL }
    })
  }, {
    surfaceOp: { op: 'replace', start: selected[0], end: selected.at(-1) },
    sourceEventSeqs: selected
  });
}

function deleteTurnsUnderMaintenance(ctx, agent, assistantMessageId, signal, options = {}) {
  const { flush = true, regeneration } = options;
  signal.throwIfAborted();
  const session = agent.session;
  if (ctx.sessions.get(session.id) !== session) throw new TurnsDelError('TARGET_NOT_FOUND', `session "${session.id}" is no longer live`);

  const initialEvents = session.events;
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
  if (existingTarget !== undefined) return {
    turn: startTurn,
    endTurn: existingTarget.data.endTurn ?? startTurn,
    seqs: [existingTarget.seq],
    deletedTurns: [],
    alreadyDeleted: true
  };

  // Capture only completed turns. The loop then processes them in reverse order,
  // recreating the proven single-turn algorithm against the latest live surface
  // after every append. This prevents a replacement from targeting stale nodes.
  const requestedTurns = completedTurnsFrom(initialEvents, startTurn);
  if (requestedTurns.length === 0) throw new TurnsDelError('TURN_NOT_CLOSED', `turn ${String(startTurn)} is not closed`);

  const deletedTurns = [];
  const tombstoneSeqs = [];
  for (const turn of [...requestedTurns].reverse()) {
    signal.throwIfAborted();
    const events = session.events;
    const currentSurface = new Set(session.surface.nodes);
    const clickedTarget = byTurn === undefined && turn === startTurn ? target : undefined;
    const assistant = clickedTarget ?? events.findLast((event) => event.type === 'assistant/message' && isAppendSurfaceEvent(event) && event.data.turn === turn && currentSurface.has(event.seq))
      ?? events.findLast((event) => event.type === 'assistant/message' && isAppendSurfaceEvent(event) && event.data.turn === turn);
    const existing = deletionTombstoneForTurn(events, turn);
    if (existing !== undefined) continue;

    const selectSeq = clickedTarget?.seq ?? assistant?.seq ?? turnEndSeq(events, turn);
    const selected = selectIndependentTurnSurface(session, events, turn, selectSeq, { requireTargetNode: clickedTarget !== undefined });
    signal.throwIfAborted();
    const tombstone = appendTurnTombstone(session, turn, assistant?.data.step ?? stepForTurn(events, turn), selected, regeneration);
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
    return await agent.runMaintenance((signal) => deleteTurnsUnderMaintenance(ctx, agent, assistantMessageId, signal));
  } catch (error) {
    if (error instanceof TurnsDelError) throw error;
    throw new TurnsDelError('AGENT_BUSY', error instanceof Error ? error.message : String(error));
  }
}

async function deleteTurnsByTurn(ctx, agent, turn) {
  try {
    return await agent.runMaintenance((signal) => deleteTurnsUnderMaintenance(ctx, agent, undefined, signal, { byTurn: turn }));
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
  return events.find((event) => isTurnsDelEvent(event) && event.data.regeneration?.operationId === operationId);
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
  const prior = regenerationTombstone(session.events, operationId);
  const priorReplayMessageId = replayMessageIdForOperation(session.events, operationId);
  if (prior !== undefined && priorReplayMessageId !== undefined) {
    const related = session.events.filter((event) => isTurnsDelEvent(event) && event.data.regeneration?.operationId === operationId);
    return {
      deletion: {
        turn: Math.min(...related.map((event) => event.data.turn)),
        endTurn: Math.max(...related.map((event) => event.data.endTurn ?? event.data.turn)),
        seqs: related.map((event) => event.seq),
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
  if (agent.inbox.hasPending) throw new TurnsDelError('QUEUE_NOT_EMPTY', 'cannot regenerate while queued input exists');
  const target = byTurn === undefined
    ? session.events.find((event) => event.type === 'assistant/message'
      && isAppendSurfaceEvent(event)
      && event.data.message.id === assistantMessageId)
    : session.events.findLast((event) => event.type === 'assistant/message'
      && isAppendSurfaceEvent(event)
      && event.data.turn === byTurn);
  if (target === undefined && byTurn === undefined) throw new TurnsDelError('TARGET_NOT_FOUND', `assistant message "${assistantMessageId}" was not found`);
  const turn = byTurn ?? target.data.turn;
  const targetSeq = target?.seq ?? turnEndSeq(session.events, turn);
  const originalPrompt = userPromptForTurn(session.events, turn, targetSeq);
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
    return await agent.runMaintenance((signal) => regenerateTurnsUnderMaintenance(ctx, agent, assistantMessageId, operationId, signal));
  } catch (error) {
    if (error instanceof TurnsDelError) throw error;
    throw new TurnsDelError('AGENT_BUSY', error instanceof Error ? error.message : String(error));
  }
}

async function regenerateTurnsByTurn(ctx, agent, turn, operationId) {
  try {
    return await agent.runMaintenance((signal) => regenerateTurnsUnderMaintenance(ctx, agent, undefined, operationId, signal, { byTurn: turn }));
  } catch (error) {
    if (error instanceof TurnsDelError) throw error;
    throw new TurnsDelError('AGENT_BUSY', error instanceof Error ? error.message : String(error));
  }
}

async function editRegenerateTurnsByTurn(ctx, agent, turn, operationId, text) {
  try {
    return await agent.runMaintenance((signal) => regenerateTurnsUnderMaintenance(ctx, agent, undefined, operationId, signal, { byTurn: turn, editedText: text }));
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
  const cwdTitle = basenameOfPath(header?.cwd);
  if (cwdTitle) return cwdTitle;
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

function cachedProjectionValues(ctx, meta) {
  try {
    const block = ctx.get?.('sessionProjectionCache')?.cachedSnapshot?.(meta);
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

function sameArchivedIds(left, right) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

async function setArchivedSessionIds(ctx, update) {
  if (typeof ctx.workspaceRegistry.enqueueOperation !== 'function' || typeof ctx.workspaceRegistry.requireState !== 'function' || typeof ctx.workspaceRegistry.setState !== 'function') {
    throw new ArchiveError('ARCHIVE_UNAVAILABLE', 'workspace registry does not expose archive mutation hooks', 500);
  }
  return ctx.workspaceRegistry.enqueueOperation(async () => {
    const state = ctx.workspaceRegistry.requireState();
    const archivedSessionIds = update([...state.archivedSessionIds]);
    if (sameArchivedIds(state.archivedSessionIds, archivedSessionIds)) return archivedSessionIds;
    await ctx.workspaceRegistry.setState({ ...state, archivedSessionIds });
    return archivedSessionIds;
  });
}

async function archivedSessionItems(ctx) {
  const archivedIds = [...ctx.workspaceRegistry.archivedSessionIds].filter((sessionId) => !deletedSessionIds.has(sessionId));
  const metas = new Map((await ctx.sessionPersistence.list()).filter((meta) => !deletedSessionIds.has(meta.id)).map((meta) => [meta.id, meta]));
  const items = [];
  for (const sessionId of archivedIds) {
    const id = SessionId(sessionId);
    const live = ctx.sessions.get(id);
    const meta = live?.header ?? metas.get(id);
    if (meta === undefined) continue;
    const liveEvents = live?.events;
    const projections = liveEvents === undefined ? cachedProjectionValues(ctx, meta) : undefined;
    items.push({
      sessionId: id,
      title: liveEvents === undefined ? cachedTitle(projections) ?? archivedHeaderTitle(id, meta) : archivedTitle(liveEvents, id, meta),
      updatedAt: liveEvents === undefined ? cachedUpdatedAt(meta, projections) : archivedUpdatedAt(meta, liveEvents),
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
  return { sessionId: id, offset, limit: Math.min(rawLimit, MAX_ARCHIVE_PREVIEW_LIMIT) };
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
    return text ? { role: 'user', seq: event.seq, time: event.time, text } : undefined;
  }
  if (event.type === 'assistant/message') {
    if (isTurnsDelEvent(event)) return undefined;
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
  const { sessionId, offset, limit } = input;
  const live = ctx.sessions.get(sessionId);
  const meta = live?.header ?? (await ctx.sessionPersistence.list()).find((header) => header.id === sessionId);
  if (meta === undefined) throw new ArchiveError('SESSION_NOT_FOUND', `archived session "${sessionId}" was not found`, 404);
  const events = live?.events ?? (await ctx.sessionPersistence.readFrom(sessionId, 0)).events;
  let surfaceNodes;
  try {
    surfaceNodes = foldSurface(events).nodes;
  } catch {
    surfaceNodes = events.filter((event) => event.surfaceOp === 'append').map((event) => event.seq);
  }
  const eventBySeq = new Map(events.map((event) => [event.seq, event]));
  const messages = [];
  let cursor = Math.min(offset, surfaceNodes.length);
  while (cursor < surfaceNodes.length && messages.length < limit) {
    const event = eventBySeq.get(surfaceNodes[cursor]);
    const item = event === undefined ? undefined : previewItemFromEvent(event);
    if (item !== undefined) messages.push(item);
    cursor += 1;
  }
  return {
    sessionId,
    title: archivedTitle(events, sessionId, meta),
    updatedAt: archivedUpdatedAt(meta, events),
    createdAt: meta.createdAt ?? 0,
    ...(meta.cwd === undefined ? {} : { cwd: meta.cwd }),
    toolCalls: archivedToolCallStats(events),
    messages,
    offset,
    nextOffset: cursor,
    limit,
    hasMore: cursor < surfaceNodes.length
  };
}

async function restoreArchivedSession(ctx, sessionId) {
  const live = ctx.sessions.get(sessionId);
  const meta = live?.header ?? (await ctx.sessionPersistence.list()).find((header) => header.id === sessionId);
  if (meta === undefined) throw new ArchiveError('SESSION_NOT_FOUND', `archived session "${sessionId}" was not found`, 404);
  const archivedSessionIds = await setArchivedSessionIds(ctx, (ids) => ids.filter((id) => id !== sessionId));
  return { sessionId, archivedSessionIds, items: await archivedSessionItems(ctx) };
}

async function currentSessionToolStats(ctx, sessionId) {
  const live = ctx.sessions.get(sessionId);
  const meta = live?.header ?? (await ctx.sessionPersistence.list()).find((header) => header.id === sessionId);
  if (meta === undefined) throw new ArchiveError('SESSION_NOT_FOUND', `session "${sessionId}" was not found`, 404);
  const events = live?.events ?? (await ctx.sessionPersistence.readFrom(sessionId, 0)).events;
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

async function deleteArchivedSession(ctx, sessionId) {
  const agent = ctx.agents.get(sessionId);
  if (agent?.status === 'running') throw new ArchiveError('SESSION_RUNNING', `session "${sessionId}" is running`);
  const meta = (await ctx.sessionPersistence.list()).find((header) => header.id === sessionId);
  const location = meta ? ctx.sessionPersistence.locate(meta) : undefined;
  const dir = location ? dirname(location.path) : undefined;
  deletedSessionIds.add(sessionId);
  try {
    if (dir && existsSync(dir)) await deleteStoppedSessionDirectory(dir);
    const archivedSessionIds = await setArchivedSessionIds(ctx, (ids) => ids.filter((id) => id !== sessionId));
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

function compactionDefaultsFromConfig(config, agent) {
  const source = effectiveCompactionConfig(config, agent);
  return {
    thresholdRatio: rawRatio(source.thresholdRatio, COMPACTION_DEFAULT_THRESHOLD_RATIO),
    retainRatio: rawRatio(source.retainRatio, COMPACTION_DEFAULT_RETAIN_RATIO),
    maxTokens: rawPositiveInteger(source.maxTokens, COMPACTION_DEFAULT_MAX_TOKENS),
    compactionRetries: rawNonNegativeInteger(source.compactionRetries, COMPACTION_DEFAULT_RETRIES),
    maxOverflowRetries: rawNonNegativeInteger(source.maxOverflowRetries, COMPACTION_DEFAULT_OVERFLOW_RETRIES)
  };
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
  const requested = agentForSessionId(ctx, compactionSessionIdOf(req));
  if (requested !== undefined) return controller.defaultsForAgent(requested);
  const headers = await ctx.sessionPersistence.list();
  for (const header of headers) {
    const agent = agentForSessionId(ctx, header.id);
    if (agent !== undefined) return controller.defaultsForAgent(agent);
  }
  return DEFAULT_COMPACTION_VALUES;
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
  let disposeSection;
  const dispose = () => {
    if (disposeSection === undefined) return;
    disposeSection();
    disposeSection = undefined;
  };
  const apply = () => {
    const settings = settingsProvider();
    const text = typeof settings?.text === 'string' ? settings.text.trim() : '';
    dispose();
    if (!settings?.enabled || text.length === 0) return;
    disposeSection = ctx.systemPrompt.section({
      name: GLOBAL_PROMPT_SECTION,
      order: GLOBAL_PROMPT_ORDER,
      text
    });
  };
  return { apply, dispose, isActive: () => disposeSection !== undefined };
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

function cloneCompactionConfig(config, settings) {
  const source = config && typeof config === 'object' ? config : {};
  return Object.freeze({
    ...source,
    thresholdRatio: settings.thresholdRatio,
    retainRatio: settings.retainRatio,
    retainTokens: undefined,
    maxTokens: settings.maxTokens,
    compactionRetries: settings.compactionRetries,
    maxOverflowRetries: settings.maxOverflowRetries
  });
}

function createCompactionRuntimeController(ctx, settingsProvider) {
  const touched = new Set();
  const originals = new WeakMap();
  const defaultsByEngine = new WeakMap();
  let lastKnownDefaults = DEFAULT_COMPACTION_VALUES;
  const engineForAgent = (agent) => ctx.agentPresets?.serviceFor?.(agent, 'compaction');
  const configMatchesSettings = (config, settings) => {
    if (!settings?.enabled || !config || typeof config !== 'object') return false;
    const same = (left, right) => Number.isFinite(Number(left)) && Math.abs(Number(left) - Number(right)) < 1e-9;
    return same(config.thresholdRatio, settings.thresholdRatio)
      && same(config.retainRatio, settings.retainRatio)
      && same(config.maxTokens, settings.maxTokens)
      && same(config.compactionRetries, settings.compactionRetries)
      && same(config.maxOverflowRetries, settings.maxOverflowRetries);
  };
  const captureDefaults = (engine, agent, config = engine?.config) => {
    if (!engine || typeof engine !== 'object') return lastKnownDefaults;
    const cached = defaultsByEngine.get(engine);
    if (cached !== undefined) return cached;
    const settings = settingsProvider();
    const defaults = configMatchesSettings(config, settings) ? lastKnownDefaults : compactionDefaultsFromConfig(config, agent);
    defaultsByEngine.set(engine, defaults);
    lastKnownDefaults = defaults;
    return defaults;
  };
  const defaultsForAgent = (agent) => {
    const engine = engineForAgent(agent);
    if (!engine || typeof engine !== 'object' || engine.config === undefined) return lastKnownDefaults;
    const original = originals.get(engine)?.config;
    if (original !== undefined) return captureDefaults(engine, agent, original);
    return captureDefaults(engine, agent, engine.config);
  };
  const patchEngine = (engine, settings, agent) => {
    if (!engine || typeof engine !== 'object' || engine.config === undefined) return;
    if (!originals.has(engine)) {
      const originalConfig = engine.config;
      captureDefaults(engine, agent, originalConfig);
      originals.set(engine, { config: originalConfig });
      touched.add(engine);
    }
    engine.config = cloneCompactionConfig(engine.config, settings);
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
    const headers = await ctx.sessionPersistence.list();
    for (const header of headers) {
      const agent = ctx.agents.get(header.id);
      if (agent !== undefined) applyToAgent(agent);
    }
  };
  return { applyToAgent, applyToLiveAgents, restoreEngines, defaultsForAgent };
}

export { name, inject, TURNS_DEL_PATH, TURNS_DEL_TURN_PATH, REGENERATE_PATH, REGENERATE_TURN_PATH, EDIT_REGENERATE_TURN_PATH, TURNS_DEL_PROVIDER, TURNS_DEL_MODEL, TurnsDelError, deleteTurns, deleteTurnsByTurn, regenerateTurns, regenerateTurnsByTurn, editRegenerateTurnsByTurn, isTurnsDelEvent };

export async function apply(ctx) {
  const compactionStore = await ctx.storageDomain.open(compactionConfigDomainSpec);
  const globalPromptStore = await ctx.storageDomain.open(globalPromptDomainSpec);
  let compactionSettings = normalizeCompactionSettings(compactionStore.global.get());
  let globalPromptSettings = normalizeGlobalPromptSettings(globalPromptStore.global.get());
  const compactionController = createCompactionRuntimeController(ctx, () => compactionSettings);
  const globalPromptController = createGlobalPromptRuntimeController(ctx, () => globalPromptSettings);
  globalPromptController.apply();
  await compactionController.applyToLiveAgents().catch((error) => ctx.logger?.warn?.(`[${name}] initial compaction config apply failed:`, error));

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
    const meta = (await ctx.sessionPersistence.list()).find((header) => header.id === id);
    if (!meta) return respond(res, 404, { ok: false, error: 'session-not-found' });
    const location = ctx.sessionPersistence.locate(meta);
    const dir = location ? dirname(location.path) : undefined;
    if (!dir || !existsSync(dir)) return respond(res, 404, { ok: false, error: 'folder-not-found' });
    openSystemFolder(dir);
    return respond(res, 200, { ok: true });
  })), `${name}: open session folder route`);

  ctx.effect(() => handle(DELETE_ROUTE, (req, res) => route(req, res, async (id) => {
    const agent = ctx.agents.get(id);
    if (agent?.status === 'running') return respond(res, 409, { ok: false, error: 'session-running' });
    const meta = (await ctx.sessionPersistence.list()).find((header) => header.id === id);
    if (!meta && !agent) return respond(res, 404, { ok: false, error: 'session-not-found' });
    const location = meta ? ctx.sessionPersistence.locate(meta) : undefined;
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
    yield () => {
      compactionController.restoreEngines();
      globalPromptController.dispose();
      void compactionStore.close();
      void globalPromptStore.close();
    };
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
        if (!wasActive) globalPromptController.dispose();
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
  ctx.effect(() => handle(TURNS_DEL_PATH, (req, res) => handleTurnsDel(ctx, req, res)), `${name}: turns-del HTTP route`);
  ctx.effect(() => handle(TURNS_DEL_TURN_PATH, (req, res) => handleTurnsDelTurn(ctx, req, res)), `${name}: turns-del turn HTTP route`);
  ctx.effect(() => handle(REGENERATE_PATH, (req, res) => handleRegenerateTurns(ctx, req, res)), `${name}: turns-del regenerate HTTP route`);
  ctx.effect(() => handle(REGENERATE_TURN_PATH, (req, res) => handleRegenerateTurnsByTurn(ctx, req, res)), `${name}: turns-del regenerate turn HTTP route`);
  ctx.effect(() => handle(EDIT_REGENERATE_TURN_PATH, (req, res) => handleEditRegenerateTurnsByTurn(ctx, req, res)), `${name}: turns-del edit regenerate turn HTTP route`);
}
