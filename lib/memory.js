import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { isAppendSurfaceEvent, isReplacementSurfaceEvent } from '@deepseek-ai/dsh-session/surface';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const MEMORY_ROUTE = '/dsh-session-kit/memory';
export const MEMORY_DISTILL_ROUTE = '/dsh-session-kit/memory/distill';
export { buildIndexTokens, buildQueryTerms, effectiveTokenizerVersion, ftsQuery };

const PLUGIN_NAME = 'dsh-session-kit';
const MEMORY_CONTEXT_PLUGIN = 'memory';
/* 记忆剔除 tombstone 与 turns-del 的空消息特征保持一致（空 assistant + replace），
   使用独立 provider/model 值以便审计时区分来源；deriveMessages 对空内容一律产出 null。 */
const MEMORY_EJECT_PROVIDER = 'dsh-session-kit-memory-eject';
const MEMORY_EJECT_MODEL = 'tombstone';
const MAX_BODY_BYTES = 768 * 1024;
const MAX_MEMORY_TEXT_LENGTH = 20000;
const MAX_DIRECTORY_NAME_LENGTH = 80;
const MAX_DIRECTORY_REMARK_LENGTH = 500;
const MAX_TAG_NAME_LENGTH = 32;
const MAX_TAGS_PER_MEMORY = 12;
const MAX_SNAPSHOT_MEMORIES = 1200;
const MAX_DISTILL_INPUT_CHARS = 14000;
const MAX_DISTILL_TOOL_ARG_CHARS = 1600;
const MAX_DISTILL_TOOL_RESULT_CHARS = 2200;
const DISTILL_TIMEOUT_MS = 300000;
const DISTILL_MAX_OUTPUT_TOKENS = 1024;
const RECALL_TIME_BUDGET_MS = 30_000;
const MEMORY_TOKEN_USAGE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
/* 单次召回注入总条数上限：既约束四段席位算术（段4 吸收前三段缺口），
   也约束 packHits 的最终打包条数；两者语义同一，共用一个常量。 */
const RECALL_MAX_ITEMS = 20;
/* 单条记忆注入截断上限：结构化记忆的“位置/对象”召回键行完整保留，
   “内容”正文（或非结构化整条）超限截断至该值并标注 id + memory_read 提示；
   记忆存储不限长（用户写多少存多少），注入体积由此保证。 */
const RECALL_ITEM_CONTENT_CHARS = 500;
const RECALL_SEGMENT_ITEMS = 5;
const EPHEMERAL_RECALL_ITEMS = 5;
/* v9 四段式注入：段1 底色（稳定层第一档，5 席）、段2 临时（不可见上下文补偿，5 席）、
   段3 混合竞争（5 席）、段4 纯永久兜底（固定 5 + 全部上游缺口）；候选充足时总注入恒 20。 */
const RECALL_DEDUP_MIN_CHARS = 24;
const RECALL_DEDUP_MAX_MESSAGE_CHARS = 50000;
/* diff 式剔除：正常输入轮召回结果即 top-k 相关性判定——上下文中已注入但本轮
   未进 top-k 的记忆直接剔除，弱输入轮（"继续""10px"）不参与判定、不动上下文。 */
const CUSTOM_TAG_EXACT_WEIGHT = 16;
const CUSTOM_TAG_PARTIAL_WEIGHT = 7;
const CUSTOM_TAG_MAX_WEIGHT = 28;
const CUSTOM_TAG_MAX_MATCHES = 64;
const PROFILE_TAG_MAX_WEIGHT = 4.5;
/* v9 结构分（累加制）：稳定层第一档/第二档标签的身份分，仅按记忆标签计算、与查询无关。 */
const STRUCTURE_TIER1_WEIGHT = 5;
const STRUCTURE_TIER1_MAX_WEIGHT = 20; /* 4 个第一档标签即满档（5×4=20），之后不再累加 */
const STRUCTURE_TIER2_WEIGHT = 3;
const STRUCTURE_TIER2_MAX_WEIGHT = 6;
/* 稳定层标签（时间权重分档 + 结构分身份）：第一档=底色 6 标签；第二档=5 标签；
   非稳定层=日常生活/工作项目，维持原有阶梯衰减（>120 天归零）。 */
const STABLE_TIER1_TAGS = new Set(['用户偏好', '用户画像', '项目画像', '项目架构', '项目约束', '模块路径']);
const STABLE_TIER2_TAGS = new Set(['项目场景', '模块约束', '项目摘要', '模块摘要', '接口摘要']);
const MEMORY_TOOL_DEFAULT_ITEMS = 10;
const MEMORY_TOOL_MAX_ITEMS = 50;
const CONVERSATION_SEARCH_DEFAULT_RESULTS = 10;
const CONVERSATION_SEARCH_MAX_RESULTS = 50;
const CONVERSATION_SEARCH_DEFAULT_SESSIONS = 50;
const CONVERSATION_SEARCH_TIME_DEFAULT_SESSIONS = 100;
const CONVERSATION_SEARCH_MAX_SESSIONS = 100;
const ACTIVE_RECALL_TOOL_NAMES = new Set(['memory_search', 'conversation_search']);
const DEFAULT_MEMORY_DIRECTORY_NAME = 'default';
const PROTECTED_MEMORY_DIRECTORY_NAMES = new Set([DEFAULT_MEMORY_DIRECTORY_NAME]);
const MEMORY_SETTING_AUTO_DISTILL = 'autoDistillEnabled';
const MEMORY_SETTING_ALL_SESSIONS_ENABLED = 'allSessionsEnabled';
const MEMORY_SETTING_FIRST_TURN_AUTO_MATCH = 'firstTurnAutoMatchEnabled';
const MEMORY_SETTING_FTS_TOKENIZER_VERSION = 'ftsTokenizerVersion';
const MEMORY_SETTING_DISTILL_MODEL_OVERRIDE = 'distillModelOverride';
const ACTIVITY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/* 进行中活动的兜底超时：任何 beginActivity 后未走到 finishActivity 的条目（异常逃逸、
   插件热重载导致 Map 残留等）超过此值即视为失败，落库并从"进行"列表移除，避免永久卡住。
   取蒸馏超时 + 60s 余量：蒸馏是最长的进行中活动，正常路径会先自行超时失败并收尾。 */
const ACTIVITY_STUCK_TIMEOUT_MS = DISTILL_TIMEOUT_MS + 60000;
const FTS_REBUILD_BATCH_SIZE = 200;
const SESSION_ID_RE = /^(session-)?[0-9a-fA-F-]+$/;
const STATUS_VALUES = new Set(['active', 'inactive']);
export const MEMORY_PRESET_TAGS = Object.freeze([
  '日常生活',
  '用户画像',
  '用户偏好',
  '工作项目',
  '项目画像',
  '项目场景',
  '项目架构',
  '项目约束',
  '模块路径',
  '模块约束',
  '项目摘要',
  '模块摘要',
  '接口摘要'
]);
const CODE_TAGS = new Set(['工作项目', '项目场景', '项目架构', '项目约束', '模块路径', '模块约束', '项目摘要', '模块摘要', '接口摘要']);
const RECALL_PROFILES = Object.freeze({
  general: ['工作项目', '项目画像', '用户画像', '用户偏好', '项目场景', '项目约束', '项目架构', '模块路径', '模块约束', '项目摘要', '模块摘要', '接口摘要', '日常生活'],
  code: ['工作项目', '项目画像', '项目场景', '项目约束', '项目架构', '模块路径', '模块约束', '项目摘要', '模块摘要', '接口摘要'],
  scene: ['工作项目', '项目画像', '用户画像', '用户偏好', '项目场景', '项目约束', '项目架构', '模块路径', '模块约束', '项目摘要', '模块摘要', '接口摘要', '日常生活'],
  constraint: ['项目约束', '模块约束', '用户画像', '项目画像', '用户偏好', '项目场景'],
  profile: ['用户画像', '用户偏好', '日常生活', '项目约束'],
  summary: ['项目摘要', '模块摘要', '项目场景', '项目架构', '接口摘要', '项目约束']
});
const RECALL_PROFILE_LABELS = Object.freeze({
  general: '默认相关',
  code: '代码定位',
  scene: '场景上下文',
  constraint: '约束偏好',
  profile: '用户画像',
  summary: '摘要聚合'
});
const SEP = '\u001f';

function respond(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  res.end(body);
}

function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolveBody, reject) => {
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
        resolveBody(text.trim() === '' ? {} : JSON.parse(text));
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

class MemoryError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'MemoryError';
    this.code = code;
    this.status = status;
  }
}

function now() {
  return Date.now();
}

function id(prefix) {
  return `${prefix}-${randomUUID()}`;
}

function normalizePlainText(value, maxLength = MAX_MEMORY_TEXT_LENGTH) {
  return typeof value === 'string' ? value.replace(/\u0000/g, '').trim().slice(0, maxLength) : '';
}

/* 活动日志摘要：完整写入（不做长度截断），长度交给展示侧处理（列表两行省略 + 悬浮显示全文 + 删除记忆可复制）。
   仅去控制字符并去除首尾空白。 */
function activitySummaryText(value) {
  return normalizePlainText(value, Number.MAX_SAFE_INTEGER);
}

function normalizeDirectoryName(value) {
  const name = normalizePlainText(value, MAX_DIRECTORY_NAME_LENGTH).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ');
  if (name.length === 0) throw new MemoryError('invalid-directory-name', 'directory name must not be empty');
  return name;
}

/* 目录备注：仅本地展示用途（项目卡片两行省略 + 悬浮提示全文），不参与召回与注入。
   去控制字符、限长截断；空串表示"无备注"（卡片不渲染备注区）。 */
function normalizeDirectoryRemark(value) {
  return normalizePlainText(value, MAX_DIRECTORY_REMARK_LENGTH);
}

function normalizeTagName(value) {
  const tag = normalizePlainText(value, MAX_TAG_NAME_LENGTH).replace(/[\r\n\t,;]+/g, ' ').replace(/\s+/g, ' ');
  if (tag.length === 0) return '';
  return tag;
}

function uniqueStrings(values, max = 200) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    const value = normalizePlainText(raw, 200);
    if (value.length === 0 || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeStatus(value, fallback = 'inactive') {
  if (value === 'active') return 'active';
  if (value === 'inactive' || value === 'paused') return 'inactive';
  return fallback === 'active' ? 'active' : 'inactive';
}

function normalizeHashText(text) {
  return normalizePlainText(text).replace(/\s+/g, ' ').toLocaleLowerCase();
}

function normalizeQueryIntentText(text) {
  return normalizePlainText(text, 1000)
    .toLocaleLowerCase()
    .replace(/[`'"“”‘’【】\[\]（）(){}<>]/gu, ' ')
    .replace(/[，,。.!！?？:：;；、|\\/]+/gu, ' ')
    .replace(/\b(please|pls|kindly|can you|could you|would you|help me|search|find|query|look up|what|which|show|tell me|summari[sz]e|summary|recap|history|activity|record|records|done|did|worked on|work|task|tasks|thing|things|progress|changed|completed)\b/giu, ' ')
    .replace(/(?:请|麻烦|帮我|帮忙|能不能|可以|一下|查一下|查询|搜索|找一下|看一下|告诉我|说说|总结|汇总|回顾|历史|记录|活动|情况|哪些|什么|啥|关于|有关|相关|方面|做了|干了|搞了|弄了|处理了|完成了|推进了|改了|写了|进行了|工作|事情|任务|进展|内容|一下子)/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function queryIntentTerms(text) {
  return extractSearchTerms(normalizeQueryIntentText(text)).sort();
}

function memoryHash(text) {
  return createHash('sha256').update(normalizeHashText(text), 'utf8').digest('hex');
}

function listFromSeparated(value) {
  if (typeof value !== 'string' || value.length === 0) return [];
  return value.split(SEP).map((item) => item.trim()).filter(Boolean);
}

function profileDirFromModule() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

function pluginDataDir() {
  const dir = join(profileDirFromModule(), '.dsh-session-kit');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function textBlocks(content) {
  if (!Array.isArray(content)) return '';
  const parts = [];
  const visit = (block) => {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    else if (block?.type === 'reasoning' && typeof block.text === 'string') parts.push(block.text);
    else if (block?.type === 'tool-call') {
      const args = typeof block.arguments === 'string' && block.arguments.trim().length > 0 ? ` ${truncateMiddle(block.arguments, MAX_DISTILL_TOOL_ARG_CHARS)}` : '';
      parts.push(`[工具调用:${block.name || 'unknown'}]${args}`);
    }
    else if (block?.type === 'tool-result' && Array.isArray(block.content)) block.content.forEach(visit);
  };
  content.forEach(visit);
  return parts.join('\n').trim();
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

async function persistenceHeaders(persistence, signal) {
  const entries = await persistence.list(isHandleStylePersistence(persistence) ? { signal } : signal);
  return entries.map(persistenceHeaderOf);
}

function isHumanSource(source) {
  return source?.kind === 'user' || source?.kind === 'user-rpc';
}

function isHumanMessage(message) {
  return isHumanSource(message?.source) && textBlocks(message.content).length > 0;
}

function sessionTitle(session) {
  const events = sessionEvents(session);
  const explicit = events.findLast((event) => event.type === 'session/title' && typeof event.data?.title === 'string')?.data?.title?.trim();
  if (explicit) return explicit;
  const firstPrompt = events.find((event) => event.type === 'user/message' && isHumanSource(event.data?.source));
  const text = textBlocks(firstPrompt?.data?.content).replace(/\s+/g, ' ').trim();
  if (text) return text.length > 60 ? `${text.slice(0, 60)}…` : text;
  const cwd = typeof session?.header?.cwd === 'string' ? basename(session.header.cwd) : '';
  return cwd || `Session ${String(session?.id ?? '').slice(0, 8)}`;
}

function turnTranscript(session, turn) {
  const events = sessionEvents(session);
  const start = events.find((event) => event.type === 'turn/start' && event.data?.turn === turn);
  const end = events.findLast((event) => event.type === 'turn/end' && event.data?.turn === turn);
  if (start === undefined || end === undefined || end.seq <= start.seq) return [];
  const rows = [];
  for (const event of events) {
    if (event.seq <= start.seq || event.seq >= end.seq) continue;
    if (event.type === 'user/message' && isAppendSurfaceEvent(event) && isHumanSource(event.data?.source)) {
      const text = textBlocks(event.data?.content);
      if (text) rows.push({ role: '用户', text });
      continue;
    }
    if (event.type === 'assistant/message' && isAppendSurfaceEvent(event)) {
      const text = textBlocks(event.data?.message?.content);
      if (text) rows.push({ role: '助手', text });
      continue;
    }
    if (event.type === 'tool/call' && event.data?.turn === turn) {
      const name = normalizePlainText(event.data?.name, 120) || 'unknown';
      const args = normalizePlainText(event.data?.arguments, MAX_DISTILL_TOOL_ARG_CHARS);
      rows.push({ role: '工具调用', text: args ? `${name}\n${args}` : name });
      continue;
    }
    if (event.type === 'tool/result' && event.data?.turn === turn) {
      const text = truncateMiddle(textBlocks(event.data?.message?.content), MAX_DISTILL_TOOL_RESULT_CHARS);
      if (text) rows.push({ role: '工具结果', text });
    }
  }
  return rows;
}

function truncateMiddle(text, maxChars) {
  const value = String(text ?? '');
  if (value.length <= maxChars) return value;
  const head = Math.max(0, Math.floor(maxChars * 0.62));
  const tail = Math.max(0, maxChars - head - 32);
  return `${value.slice(0, head)}\n…（中间已截断）…\n${value.slice(value.length - tail)}`;
}

function renderTranscript(rows) {
  return rows.map((row, index) => `### ${index + 1}. ${row.role}\n${row.text}`).join('\n\n');
}

function normalizeModelSelection(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || typeof value.provider !== 'string' || value.provider.trim() === '' || typeof value.model !== 'string' || value.model.trim() === '') {
    throw new MemoryError('invalid-model-selection', 'modelSelection must contain provider and model', 400);
  }
  const selection = { provider: value.provider.trim(), model: value.model.trim() };
  if (value.reasoningEffort !== undefined) {
    if (typeof value.reasoningEffort !== 'string' || value.reasoningEffort.trim() === '') throw new MemoryError('invalid-model-selection', 'reasoningEffort must be a non-empty string', 400);
    selection.reasoningEffort = value.reasoningEffort.trim();
  }
  return selection;
}

function routeForDistill(agent, session, override) {
  const candidates = [
    override,
    agent?.session?.requestHeader?.()?.config,
    session?.requestHeader?.()?.config,
    agent?.options
  ];
  for (const candidate of candidates) {
    if (typeof candidate?.provider === 'string' && candidate.provider.length > 0 && typeof candidate?.model === 'string' && candidate.model.length > 0) {
      return { provider: candidate.provider, model: candidate.model, ...(typeof candidate.reasoningEffort === 'string' && candidate.reasoningEffort.length > 0 ? { reasoningEffort: candidate.reasoningEffort } : {}) };
    }
  }
}

function stripCodeFence(text) {
  const value = String(text ?? '').trim();
  const fenced = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : value;
}

function parseJsonObject(text) {
  const raw = stripCodeFence(text);
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch {}
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
    } catch {}
  }
}

function classifyTags(text, transcriptText = '') {
  const haystack = `${text}\n${transcriptText}`;
  const tags = [];
  const add = (tag) => {
    if (!tags.includes(tag)) tags.push(tag);
  };
  if (/项目约束|项目规则|项目规范|全局约束|工作区约束|开发约束|会话约束/.test(haystack)) add('项目约束');
  if (/架构|目录结构|技术栈|组件关系|数据流|部署|启动流程|整体设计/.test(haystack)) add('项目架构');
  if (/约束|限制|必须|不能|不要|规范|规则|兼容|安全|权限|沙箱/.test(haystack)) add('模块约束');
  if (/接口|API|endpoint|route|schema|参数|返回|协议|事件|hook|ctx\.|agent\/pre-step|session\/event/i.test(haystack)) add('接口摘要');
  if (/[A-Za-z]:\\|(?:^|[\s`'"（(])(?:src|lib|app|packages|node_modules|\.dsh|components|pages)[\\/][\w.\\/ -]+|@[\w.-]+\//i.test(haystack)) add('模块路径');
  if (/生活|家庭|健康|饮食|运动|旅行|日常|习惯|个人/.test(haystack)) add('日常生活');
  if (/场景|上下文|背景|当前正在|持续优化|持续开发|项目状态|任务背景/.test(haystack)) add('项目场景');
  if (/工作|项目|客户|需求|计划|会议|任务|排期|交付|插件|代码|仓库/.test(haystack)) add('工作项目');
  return tags.length > 0 ? tags : ['工作项目'];
}

function normalizeTagNames(value, fallbackText = '', transcriptText = '') {
  const names = uniqueStrings(Array.isArray(value) ? value : [], MAX_TAGS_PER_MEMORY)
    .map(normalizeTagName)
    .filter((tag) => MEMORY_PRESET_TAGS.includes(tag));
  const unique = [...new Set(names)];
  return unique.length > 0 ? unique : classifyTags(fallbackText, transcriptText);
}

/* 蒸馏键清理：去重 + 清理；max 提供时限制条数（标签过滤语义），未提供时不限
   （蒸馏的位置/对象键全量保留，注入体积由注入侧内容限额保证）。 */
function normalizeDistillList(value, max) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\n,，;；]+/) : []) {
    const item = normalizePlainText(raw, Number.MAX_SAFE_INTEGER);
    if (item.length === 0 || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (max !== undefined && out.length >= max) break;
  }
  return out;
}

const STRUCTURED_MEMORY_FIELD_ALIASES = Object.freeze({
  paths: ['位置', 'paths'],
  symbols: ['对象', 'symbols'],
  content: ['内容', 'content'],
  pitfall: ['踩坑', 'pitfall']
});
const STRUCTURED_MEMORY_KNOWN_KEYS = new Set(Object.values(STRUCTURED_MEMORY_FIELD_ALIASES).flat());
const STRUCTURED_MEMORY_PAYLOAD_ONLY_KEYS = new Set(['summary', 'text', 'memory', 'pitfalls']);
const STRUCTURED_MEMORY_META_FIELD_VALUES = new Set(['位置', '对象', '内容', '踩坑']);

function cleanStructuredMemoryFieldValues(value) {
  return normalizeDistillList(value).filter((item) => !STRUCTURED_MEMORY_META_FIELD_VALUES.has(item));
}

function structuredMemoryField(value, field) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  for (const key of STRUCTURED_MEMORY_FIELD_ALIASES[field] ?? []) {
    if (Object.prototype.hasOwnProperty.call(value, key)) return value[key];
  }
  return undefined;
}

function structuredMemoryHasKnownField(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.keys(value).some((key) => STRUCTURED_MEMORY_KNOWN_KEYS.has(key));
}

function structuredMemoryExtras(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key]) => !STRUCTURED_MEMORY_KNOWN_KEYS.has(key) && !['__proto__', 'constructor', 'prototype'].includes(key)));
}

function structuredMemoryPayloadExtras(value) {
  return Object.fromEntries(Object.entries(structuredMemoryExtras(value)).filter(([key]) => !STRUCTURED_MEMORY_PAYLOAD_ONLY_KEYS.has(key)));
}

function structuredMemoryFields(value) {
  if (!structuredMemoryHasKnownField(value)) return undefined;
  const pathsValue = structuredMemoryField(value, 'paths');
  const symbolsValue = structuredMemoryField(value, 'symbols');
  const contentValue = structuredMemoryField(value, 'content');
  const pitfallValue = structuredMemoryField(value, 'pitfall');
  if (!Array.isArray(pathsValue) || !pathsValue.every((item) => typeof item === 'string')) return undefined;
  if (!Array.isArray(symbolsValue) || !symbolsValue.every((item) => typeof item === 'string')) return undefined;
  if (typeof contentValue !== 'string') return undefined;
  if (pitfallValue !== undefined && typeof pitfallValue !== 'string') return undefined;
  return {
    paths: cleanStructuredMemoryFieldValues(pathsValue),
    symbols: cleanStructuredMemoryFieldValues(symbolsValue),
    content: normalizePlainText(contentValue, Number.MAX_SAFE_INTEGER),
    pitfall: normalizePlainText(pitfallValue ?? '', Number.MAX_SAFE_INTEGER),
    extra: structuredMemoryExtras(value)
  };
}

function shouldUseStructuredContent(payload, transcriptText = '') {
  const paths = structuredMemoryField(payload, 'paths');
  const symbols = structuredMemoryField(payload, 'symbols');
  const content = structuredMemoryField(payload, 'content');
  if (Array.isArray(paths) && paths.length > 0) return true;
  if (Array.isArray(symbols) && symbols.length > 0) return true;
  const haystack = `${content ?? ''}\n${transcriptText}`;
  if (extractDistillPaths(haystack).length > 0) return true;
  if (extractDistillSymbols(haystack).length > 0) return true;
  if (detectRecallProfile(haystack) === 'code') return true;
  return /代码|插件|仓库|文件|路径|函数|方法|组件|class|css|接口|API|api|action|route|endpoint|slot|hook|事件|参数|返回|实现|修改|修复|优化|新增|调整|重构|排查|UI|数据库|SQLite|FTS|BM25|React|primitives|node\s+--check|\.[cm]?[jt]sx?\b/i.test(haystack);
}

function cleanDistillPath(value) {
  let text = normalizePlainText(value, Number.MAX_SAFE_INTEGER).replace(/[，。；;、)）\]}]+$/g, '');
  const fileExtension = text.match(/\.(?:[cm]?[jt]sx?|css|json|md|sqlite|db|html?|vue|svelte|py|rs|go|java|cs|cpp|c|h|hpp)\b/i);
  if (fileExtension?.index !== undefined) {
    text = text.slice(0, fileExtension.index + fileExtension[0].length);
  } else {
    text = text.replace(/\s+(?:中|里|内|上|下|新增|修复|修改|优化|调整|重构|实现|用于|负责|已|会|被|将|把|使).*$/u, '');
  }
  while (text && /[\\/]$/.test(text)) text = text.slice(0, -1);
  return text;
}

function extractDistillPaths(text) {
  const source = String(text ?? '');
  const matches = [];
  for (const match of source.matchAll(/[A-Za-z]:\\[^\r\n`'"，。；;、)）\]}]+/g)) matches.push(cleanDistillPath(match[0]));
  for (const match of source.matchAll(/(?:^|[\s`'"（(])((?:src|lib|app|packages|node_modules|\.dsh|components|pages)[\\/][^\r\n`'"，。；;、)）\]}]+)/gi)) matches.push(cleanDistillPath(match[1]));
  return normalizeDistillList(matches);
}

function stripDistillPaths(text) {
  let source = String(text ?? '');
  for (const filePath of extractDistillPaths(source)) source = source.replaceAll(filePath, ' ');
  return source;
}

function isUsefulDistillSymbol(value) {
  const text = normalizePlainText(value, 240);
  if (text.length < 2) return false;
  if (/^(Users|AppData|Local|Temp|Windows|Program|Files|JSON|API|UI|CSS|HTML|FTS|BM25|SQLite|React|Node|Markdown)$/i.test(text)) return false;
  if (/^\.[a-z0-9_-]+$/i.test(text) && !/^\.dsh-session-kit-/i.test(text)) return false;
  return true;
}

function extractDistillSymbols(text) {
  const source = stripDistillPaths(text);
  const matches = [];
  for (const match of source.matchAll(/\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?\s*\(/g)) matches.push(match[0].replace(/\s*\($/, ''));
  for (const match of source.matchAll(/\b[A-Z][A-Z0-9_]{2,}\b/g)) matches.push(match[0]);
  for (const match of source.matchAll(/\b[A-Z][A-Za-z0-9_$]{2,}\b/g)) matches.push(match[0]);
  for (const match of source.matchAll(/\.[a-z][a-z0-9_-]{2,}\b/g)) matches.push(match[0]);
  for (const match of source.matchAll(/\b[a-z][a-z0-9_-]{2,}\/[a-z][a-z0-9_/-]{2,}\b/gi)) matches.push(match[0]);
  return normalizeDistillList(matches.filter(isUsefulDistillSymbol));
}

function stripCodeLineRefs(text) {
  /* 剥离正文里的行号引用：Line 289 / line 4102-4105 / L289 / 第289行 / file.js:289。 */
  return String(text ?? '')
    .replace(/\s*[（(]?\b(?:Line|line|L)\s*\d+(?:\s*[-–~]\s*\d+)?\b[）)]?/g, '')
    .replace(/\s*[（(]?第\s*\d+\s*(?:[-–~]\s*\d+\s*)?行[）)]?/g, '')
    .replace(/([A-Za-z0-9_./\\-]+\.(?:[cm]?[jt]sx?|css|json|md|sql|vue|svelte|py))\s*:\s*\d+(?:\s*[-–~]\s*\d+)?/g, '$1');
}

function stripVerificationSentences(text) {
  /* 剥离“验证/烟测/node --check/xx/xx 通过”类完成证明句（按句切分，整句命中才删）。 */
  const sentences = String(text ?? '').split(/(?<=[。；;])/u);
  const kept = sentences.filter((sentence) => {
    const probe = sentence.trim();
    if (probe.length === 0) return false;
    if (/^验证[:：]/.test(probe)) return false;
    if (/(?:烟测|node\s+--check|npm\s+test|单元测试|回归测试|测试脚本).{0,80}?(?:通过|通过率|全通过|\d+\s*\/\s*\d+)/i.test(probe)) return false;
    if (/^\d+\s*\/\s*\d+\s*通过/.test(probe)) return false;
    return true;
  });
  return kept.join('').trim();
}

/* 结构化记忆正文：JSON 对象；中文 key 为规范输出，英文 key 可读入。
   已知字段：位置/paths、对象/symbols、内容/content、踩坑/pitfall；未知字段保留。 */
function structuredContentBody(paths, symbols, content, pitfall, extra = {}) {
  const body = {
    '位置': cleanStructuredMemoryFieldValues(paths),
    '对象': cleanStructuredMemoryFieldValues(symbols),
    '内容': normalizePlainText(content ?? '', Number.MAX_SAFE_INTEGER),
    '踩坑': normalizePlainText(pitfall ?? '', Number.MAX_SAFE_INTEGER)
  };
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (STRUCTURED_MEMORY_KNOWN_KEYS.has(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) continue;
    body[key] = value;
  }
  return JSON.stringify(body, null, 2);
}

/* 只解析严格 JSON 结构体；旧行前缀正文不再兼容，也不参与字段重排。 */
function parseStructuredMemoryBodyOnce(text) {
  const raw = normalizePlainText(text, Number.MAX_SAFE_INTEGER);
  if (raw.length === 0) return undefined;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  return structuredMemoryFields(parsed);
}

function parseStructuredMemoryBody(text) {
  return parseStructuredMemoryBodyOnce(text);
}

/* 蒸馏正文净化：先去行号、再去验证段（顺序固定：验证段可能含行号）。 */
function sanitizeDistilledContent(text) {
  const value = normalizePlainText(text, Number.MAX_SAFE_INTEGER);
  if (value.length === 0) return '';
  return normalizePlainText(stripVerificationSentences(stripCodeLineRefs(value)), Number.MAX_SAFE_INTEGER);
}

function formatDistilledContent(payload, transcriptText = '') {
  const payloadContent = structuredMemoryField(payload, 'content') ?? payload?.summary ?? payload?.text ?? payload?.memory ?? '';
  const rawPayloadContent = normalizePlainText(payloadContent, Number.MAX_SAFE_INTEGER);
  if (rawPayloadContent.length < 6) return '';
  const embedded = parseStructuredMemoryBody(rawPayloadContent);
  const content = sanitizeDistilledContent(embedded?.content ?? rawPayloadContent);
  if (content.length < 6) return '';
  const payloadPaths = normalizeDistillList(structuredMemoryField(payload, 'paths'));
  const payloadSymbols = normalizeDistillList(structuredMemoryField(payload, 'symbols'));
  const paths = payloadPaths.length > 0 ? payloadPaths : embedded?.paths ?? [];
  const symbols = payloadSymbols.length > 0 ? payloadSymbols : embedded?.symbols ?? [];
  const pitfallSource = structuredMemoryField(payload, 'pitfall') ?? payload?.pitfalls ?? embedded?.pitfall ?? '';
  const pitfall = sanitizeDistilledContent(normalizePlainText(pitfallSource, Number.MAX_SAFE_INTEGER));
  const structuredPayload = embedded !== undefined || shouldUseStructuredContent({ paths, symbols, content }, transcriptText);
  if (!structuredPayload) return content;
  return structuredContentBody(
    paths.length > 0 ? paths : extractDistillPaths(`${content}\n${transcriptText}`),
    symbols.length > 0 ? symbols : extractDistillSymbols(`${content}\n${transcriptText}`),
    content,
    pitfall,
    { ...structuredMemoryPayloadExtras(payload), ...(embedded?.extra ?? {}) }
  );
}

function normalizeDistilledMemoryText(text, transcriptText = '') {
  const raw = normalizePlainText(text, Number.MAX_SAFE_INTEGER);
  if (raw.length < 6) return '';
  const embedded = parseStructuredMemoryBody(raw);
  if (embedded !== undefined) {
    const content = sanitizeDistilledContent(embedded.content);
    const pitfall = sanitizeDistilledContent(embedded.pitfall);
    return structuredContentBody(embedded.paths, embedded.symbols, content, pitfall, embedded.extra);
  }
  const content = sanitizeDistilledContent(raw);
  if (content.length < 6) return '';
  if (!shouldUseStructuredContent({ content }, transcriptText)) return content;
  return structuredContentBody(
    extractDistillPaths(`${content}\n${transcriptText}`),
    extractDistillSymbols(`${content}\n${transcriptText}`),
    content,
    ''
  );
}

/* 结构化判定：只接受规范 JSON 对象，中文/英文 key 均可。 */
function structuredMemoryText(text) {
  return parseStructuredMemoryBody(text) !== undefined;
}

/* 所有写入入口共用：结构化 JSON 统一规范化；裸代码/项目正文自动包装为 JSON。 */
function normalizeMemoryBodyForWrite(text) {
  const raw = normalizePlainText(text, Number.MAX_SAFE_INTEGER);
  if (raw.length === 0) return '';
  const embedded = parseStructuredMemoryBody(raw);
  if (embedded !== undefined) {
    return structuredContentBody(
      embedded.paths,
      embedded.symbols,
      sanitizeDistilledContent(embedded.content),
      sanitizeDistilledContent(embedded.pitfall),
      embedded.extra
    );
  }
  let parsedJson;
  const looksLikeStructuredJson = /^[{[]/.test(raw) && /["']?(?:位置|paths|对象|symbols|内容|content|踩坑|pitfall)["']?\s*:/.test(raw);
  if (/^[{[]/.test(raw)) {
    try { parsedJson = JSON.parse(raw); } catch {}
    if (structuredMemoryHasKnownField(parsedJson)) throw new MemoryError('invalid-memory-json', 'structured memory JSON is invalid');
  }
  const structured = shouldUseStructuredContent({ content: raw }, '');
  if (/^[{[]/.test(raw) && (looksLikeStructuredJson || parsedJson === undefined && structured)) throw new MemoryError('invalid-memory-json', 'structured memory JSON is invalid');
  if (!structured) return raw;
  const content = sanitizeDistilledContent(raw);
  if (content.length === 0) return '';
  return structuredContentBody(
    extractDistillPaths(content),
    extractDistillSymbols(content),
    content,
    ''
  );
}

function parseDistillation(text, transcriptText) {
  const parsed = parseJsonObject(text);
  /* 不在这里截断 JSON 字段：生成侧保留完整多行正文；上下文体积由注入侧按 content 字段单条限额保证。 */
  const memory = parsed === undefined ? normalizeDistilledMemoryText(stripCodeFence(text), transcriptText) : formatDistilledContent(parsed, transcriptText);
  if (memory.length < 6) return undefined;
  return { memory, tags: normalizeTagNames(undefined, memory, transcriptText) };
}

function extractSearchTerms(text) {
  const raw = normalizePlainText(text, 2000).toLocaleLowerCase();
  const terms = [];
  const seen = new Set();
  const add = (term) => {
    const value = term.replace(/^[-_./\\#]+|[-_./\\#]+$/g, '').trim();
    if (value.length < 2 || seen.has(value)) return;
    seen.add(value);
    terms.push(value.slice(0, 48));
  };
  for (const match of raw.matchAll(/[\p{Script=Han}]{2,}/gu)) {
    const value = match[0];
    if (value.length <= 12) add(value);
    else {
      for (let offset = 0; offset < value.length && terms.length < 14; offset += 8) add(value.slice(offset, offset + 12));
    }
  }
  for (const match of raw.matchAll(/[a-z0-9_./\\#-]{2,}/g)) add(match[0]);
  return terms.slice(0, 18);
}

function ftsPhrase(term) {
  return `"${String(term).replace(/"/g, '""')}"`;
}

/* 中文分词管线：jieba 词元 ∪ CJK 相邻二元组 ∪ 英文数字 run，写入与查询两侧共用。
   node:sqlite 不支持自定义 FTS5 分词器，因此 tokens 作为派生列写入 FTS（unicode61 按空格切分），
   jieba 加载失败自动回退纯二元组；生效管线编码进版本戳，变化即触发 FTS 全量重建。 */
let jiebaInstance = null;
let jiebaLoadAttempted = false;
const JIEBA_VERSION = '2.0.2';
function loadJieba() {
  if (jiebaLoadAttempted) return jiebaInstance;
  jiebaLoadAttempted = true;
  try {
    const { Jieba } = require('@node-rs/jieba');
    const { dict } = require('@node-rs/jieba/dict');
    jiebaInstance = Jieba.withDict(new Uint8Array(dict));
  } catch (error) {
    jiebaInstance = null;
    globalThis.console?.warn?.(`[${PLUGIN_NAME}] @node-rs/jieba unavailable, falling back to CJK bigram tokenizer:`, error instanceof Error ? error.message : error);
  }
  return jiebaInstance;
}

function cjkBigrams(segment) {
  const grams = [];
  for (let i = 0; i < segment.length - 1; i++) grams.push(segment.slice(i, i + 2));
  return grams;
}

function pipelineTerms(text, maxTerms) {
  const raw = normalizePlainText(text, 2000).toLocaleLowerCase();
  const terms = [];
  const seen = new Set();
  const addTerm = (term) => {
    if (typeof term !== 'string') return;
    const value = term.trim();
    if (value.length < 2 || value.length > 48) return;
    if (seen.has(value)) return;
    seen.add(value);
    terms.push(value);
  };
  for (const match of raw.matchAll(/[\p{Script=Han}]{2,}/gu)) {
    const segment = match[0];
    const jieba = loadJieba();
    if (jieba) {
      try {
        for (const word of jieba.cut(segment, true)) addTerm(word);
      } catch { /* 运行期异常：本次仅产出二元组 */ }
    }
    for (const gram of cjkBigrams(segment)) addTerm(gram);
  }
  for (const match of raw.matchAll(/[a-z0-9_./\\#-]{2,}/g)) addTerm(match[0]);
  return terms.slice(0, maxTerms);
}

function buildIndexTokens(text) {
  return pipelineTerms(text, 4096).join(' ');
}

function buildQueryTerms(text) {
  return pipelineTerms(text, 24);
}

function effectiveTokenizerVersion() {
  const jieba = loadJieba();
  return jieba ? `jieba-${JIEBA_VERSION}` : 'bigram-v1';
}

function ftsTokensFor(body, tagNames, directoryName) {
  const parts = [buildIndexTokens(body)];
  if (tagNames) parts.push(tagNames);
  if (directoryName) parts.push(directoryName);
  const extra = cjkBigrams(`${tagNames ?? ''} ${directoryName ?? ''}`.trim());
  if (extra.length > 0) parts.push(extra.join(' '));
  return parts.filter(Boolean).join(' ');
}

function detectRecallProfile(text) {
  const value = normalizePlainText(text, 4000);
  if (/最近|这几天|近几天|今天|昨日|昨天|本周|这周|上周|这段时间|干了什么|做了什么|推进|进展|最近.*改|最近.*做/.test(value)) return 'scene';
  if (/在哪|哪里|哪个文件|文件|路径|函数|方法|组件|class|css|接口|API|api|action|route|endpoint|slot|hook|事件|参数|返回|实现|代码/.test(value)) return 'code';
  if (/约束|限制|规则|规范|必须|不能|不要|注意|兼容|权限|沙箱|默认行为/.test(value)) return 'constraint';
  if (/我的习惯|我的偏好|我喜欢|我之前说过|用户偏好|画像|个人|日常/.test(value)) return 'profile';
  if (/总结|摘要|概括|汇总|整体|架构|背景|上下文|场景|当前项目|项目情况/.test(value)) return 'summary';
  return 'general';
}

function recallProfileTags(profile) {
  return RECALL_PROFILES[profile] ?? RECALL_PROFILES.general;
}

function recallProfileWeights(profile) {
  const tags = recallProfileTags(profile);
  const weights = new Map();
  tags.forEach((tag, index) => weights.set(tag, Math.max(0.7, 3 - index * 0.18)));
  return weights;
}

/* 行标签解析在打分链路中被多次调用（自定义权重/结构分/时间分/池划分）：
   按 row 对象备忘一次解析结果（行对象每次召回新建，WeakMap 随 GC 回收）。 */
const ROW_TAG_NAMES_CACHE = new WeakMap();

function rowTagNames(row) {
  if (row === null || typeof row !== 'object') return [];
  const cached = ROW_TAG_NAMES_CACHE.get(row);
  if (cached !== undefined) return cached;
  const tags = listFromSeparated(row.tag_names);
  ROW_TAG_NAMES_CACHE.set(row, tags);
  return tags;
}

function tagWeightForRow(row, weights) {
  let weight = 0;
  for (const tag of rowTagNames(row)) weight += weights.get(tag) ?? 0;
  return Math.min(PROFILE_TAG_MAX_WEIGHT, weight);
}

function customTagMatchContext(queryText) {
  const terms = new Set();
  const raw = normalizePlainText(queryText, 2000);
  const normalized = normalizeQueryIntentText(raw);
  if (normalized.length >= 2) terms.add(normalized);
  for (const term of extractSearchTerms(raw)) terms.add(term.toLocaleLowerCase());
  for (const term of extractSearchTerms(normalized)) terms.add(term.toLocaleLowerCase());
  return {
    terms: [...terms].map((term) => normalizeHashText(term)).filter((term) => term.length >= 2),
    compactQuery: memoryDedupText(raw),
    /* 每次召回只算一次：紧凑查询预归一化 + 标签权重备忘，供逐行打分复用（热点优化） */
    compactQueryText: normalizePlainText(memoryDedupText(raw), 2000),
    tagWeightCache: new Map()
  };
}

function customTagContextHasQuery(context) {
  return Array.isArray(context?.terms) && context.terms.length > 0 || normalizePlainText(context?.compactQuery, 2000).length >= 2;
}

function customTagNameWeight(tag, context) {
  if (MEMORY_PRESET_TAGS.includes(tag)) return 0;
  /* 标签词表跨行高度重复：权重按 context 备忘，避免逐行重复归一化（热点优化） */
  if (context && !Array.isArray(context)) {
    context.tagWeightCache ??= new Map();
    const cached = context.tagWeightCache.get(tag);
    if (cached !== undefined) return cached;
    const weight = customTagNameWeightUncached(tag, context);
    context.tagWeightCache.set(tag, weight);
    return weight;
  }
  return customTagNameWeightUncached(tag, context);
}

function customTagNameWeightUncached(tag, context) {
  const terms = Array.isArray(context) ? context : Array.isArray(context?.terms) ? context.terms : [];
  const compactQuery = Array.isArray(context) ? '' : context?.compactQueryText ?? '';
  if (terms.length === 0 && compactQuery.length < 2) return 0;
  const normalizedTag = normalizeHashText(tag);
  if (!normalizedTag) return 0;
  const compactTag = memoryDedupText(tag);
  if (terms.includes(normalizedTag) || (compactTag.length >= 2 && compactQuery.includes(compactTag))) return CUSTOM_TAG_EXACT_WEIGHT;
  return terms.some((term) => normalizedTag.includes(term) || term.includes(normalizedTag)) ? CUSTOM_TAG_PARTIAL_WEIGHT : 0;
}

function customTagWeightForRow(row, context) {
  let weight = 0;
  for (const tag of rowTagNames(row)) weight += customTagNameWeight(tag, context);
  return Math.min(CUSTOM_TAG_MAX_WEIGHT, weight);
}

/* v9 结构分：稳定层标签的身份分（累加制、与查询无关）。
   第一档每个 +5（封顶 20，4 个标签满档），第二档每个 +3（封顶 6）；两档相互独立累加。 */
function structureWeightForRow(row) {
  let tier1 = 0;
  let tier2 = 0;
  for (const tag of rowTagNames(row)) {
    if (STABLE_TIER1_TAGS.has(tag)) tier1 += STRUCTURE_TIER1_WEIGHT;
    else if (STABLE_TIER2_TAGS.has(tag)) tier2 += STRUCTURE_TIER2_WEIGHT;
  }
  return {
    tier1: Math.min(STRUCTURE_TIER1_MAX_WEIGHT, tier1),
    tier2: Math.min(STRUCTURE_TIER2_MAX_WEIGHT, tier2)
  };
}

function mergeRecallRows(...groups) {
  const byId = new Map();
  for (const group of groups) {
    for (const row of Array.isArray(group) ? group : []) {
      const rowId = normalizePlainText(row?.id, 128);
      if (!rowId) continue;
      const existing = byId.get(rowId);
      if (existing === undefined || bm25Weight(row.rank) > bm25Weight(existing.rank)) byId.set(rowId, row);
    }
  }
  return [...byId.values()];
}

function recencyWeightForRow(row, startedAt = now()) {
  /* v9 分层时间权重：按记忆所属稳定层选用衰减曲线。
     第一档（STABLE_TIER1_TAGS）慢衰减+永久底分 0.55，永不归零；
     第二档底分 0.25；非稳定层（日常生活/工作项目/无标签）维持原阶梯 >120 天归零。
     临时记忆恒满格 1.2（由调用方保证不入本函数或按无标签处理——临时记忆参与段2竞争时
     时间分已从公式剔除，本函数仅供永久记忆分档路径调用）。 */
  const updatedAt = Number(row.updated_at) || 0;
  if (updatedAt <= 0) return 0;
  const tags = rowTagNames(row);
  const ageDays = Math.max(0, (startedAt - updatedAt) / 86400000);
  if (tags.some((tag) => STABLE_TIER1_TAGS.has(tag))) {
    if (ageDays <= 30) return 1.2;
    if (ageDays <= 120) return 0.9;
    return 0.55;
  }
  if (tags.some((tag) => STABLE_TIER2_TAGS.has(tag))) {
    if (ageDays <= 7) return 1.1;
    if (ageDays <= 30) return 0.9;
    if (ageDays <= 120) return 0.55;
    return 0.25;
  }
  if (ageDays <= 1) return 1.2;
  if (ageDays <= 7) return 0.9;
  if (ageDays <= 30) return 0.55;
  if (ageDays <= 120) return 0.25;
  return 0;
}

function bm25Weight(rank) {
  const value = Number(rank);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(8, -value));
}

/* v9：全量分量计算（每条候选只算一次，段无关），四段按各自矩阵选取子集求和。
   customContext 由调用方构建并传入（查询上下文构建是多轮归一化，禁止逐行重建）。 */
function scoreRowComponents(row, profile, startedAt, customContext) {
  const weights = recallProfileWeights(profile);
  const structure = structureWeightForRow(row);
  return {
    bm25: bm25Weight(row.rank),
    customTag: customTagWeightForRow(row, customContext),
    profileTag: tagWeightForRow(row, weights),
    structureTier1: structure.tier1,
    structureTier2: structure.tier2,
    recency: recencyWeightForRow(row, startedAt)
  };
}

/* 各段分量选择器（v8/v9 分段评分矩阵）：
   段1 底色：BM25+自定义+画像+结构一+时间(第一档曲线)——无第二档结构分（无该成员）；
   段2 临时：BM25+自定义+画像——无结构分（蒸馏自动标签质量参差）、无时间分（恒1.2零区分度）；
   段3 混合：全分量（结构一防第一档 vs 第二档倒挂）；
   段4 兜底：无结构一（成员不含第一档标签）。 */
const SEGMENT_COMPONENT_KEYS = {
  bottom: ['bm25', 'customTag', 'profileTag', 'structureTier1', 'recency'],
  ephemeral: ['bm25', 'customTag', 'profileTag'],
  mixed: ['bm25', 'customTag', 'profileTag', 'structureTier1', 'structureTier2', 'recency'],
  fallback: ['bm25', 'customTag', 'profileTag', 'structureTier2', 'recency']
};

/* v9 段准入判定（模块级）：BM25 命中 / 自定义标签命中 / 四画像下画像标签命中，三选一。 */
function rowMatchesQueryFn(row, customContext, profileWeights, allowProfileTagFallback) {
  return row.rank < 0
    || customTagWeightForRow(row, customContext) > 0
    || (allowProfileTagFallback && tagWeightForRow(row, profileWeights) > 0);
}

function rankRowsBySegment(rows, segment, profile, startedAt, customContext) {
  const keys = SEGMENT_COMPONENT_KEYS[segment] ?? SEGMENT_COMPONENT_KEYS.fallback;
  return rows
    .map((row) => {
      const parts = scoreRowComponents(row, profile, startedAt, customContext);
      let finalRank = 0;
      for (const key of keys) finalRank += parts[key];
      return { row, parts, finalRank };
    })
    .sort((left, right) => right.finalRank - left.finalRank
      || Number(left.row.rank ?? 0) - Number(right.row.rank ?? 0)
      || Number(right.row.updated_at ?? 0) - Number(left.row.updated_at ?? 0));
}

function rerankRecallRows(rows, profile, startedAt = now(), queryText = '') {
  /* 兼容入口（memory_search 等工具路径沿用）：全分量合成，等价于竞争段的完整矩阵。 */
  const customContext = customTagMatchContext(queryText);
  return rankRowsBySegment(rows, 'mixed', profile, startedAt, customContext)
    .map(({ row, parts }) => ({
      ...row,
      recall_profile: profile,
      ...parts,
      final_rank: parts.bm25 + parts.customTag + parts.profileTag + parts.structureTier1 + parts.structureTier2 + parts.recency
    }));
}

function profileAllowsTagFallback(profile) {
  return profile === 'scene' || profile === 'summary' || profile === 'constraint' || profile === 'profile';
}

function ftsQuery(text) {
  const terms = buildQueryTerms(text).filter((term) => !/^(the|and|for|with|from|this|that|http|https)$/.test(term));
  if (terms.length === 0) return '';
  /* 列过滤：只匹配派生词元列与标签/目录列，原文 body 列不参与（避免长 run 稀释 BM25） */
  return `{tokens tags directory} : (${terms.map(ftsPhrase).join(' OR ')})`;
}

function scoreFallback(row, terms) {
  const haystack = `${row.body}\n${row.directory_name ?? ''}\n${row.tag_names ?? ''}`.toLocaleLowerCase();
  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) score += CODE_TAGS.has(term) ? 4 : Math.max(1, Math.min(6, term.length));
  }
  return score;
}

function ephemeralRecallRow(item, terms) {
  const row = {
    id: item.id,
    persisted: false,
    body: item.text,
    status: normalizeStatus(item.status),
    directory_id: item.directoryId ?? null,
    directory_name: item.directoryName ?? null,
    tag_ids: '',
    tag_names: Array.isArray(item.tags) ? item.tags.join(SEP) : '',
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    rank: 0
  };
  const score = scoreFallback(row, terms);
  return { ...row, rank: score > 0 ? -score : 0 };
}

function formatDateShort(value) {
  const date = new Date(Number(value));
  if (!Number.isFinite(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function padDatePart(value) {
  return String(value).padStart(2, '0');
}

function formatLocalDateShort(value) {
  const date = new Date(Number(value));
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function formatLocalDateTimeShort(value) {
  const date = new Date(Number(value));
  if (!Number.isFinite(date.getTime())) return '';
  return `${formatLocalDateShort(value)} ${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;
}

function startOfLocalDay(value = now()) {
  const date = new Date(Number(value));
  if (!Number.isFinite(date.getTime())) return undefined;
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function rangeFromLocalDate(year, month, day) {
  const start = new Date(year, month - 1, day);
  if (start.getFullYear() !== year || start.getMonth() !== month - 1 || start.getDate() !== day) return undefined;
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.getTime(), end: end.getTime(), label: formatLocalDateShort(start.getTime()) };
}

function dayRange(offset, reference = now(), label = '') {
  const today = startOfLocalDay(reference);
  if (today === undefined) return undefined;
  const start = new Date(today);
  start.setDate(start.getDate() + offset);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.getTime(), end: end.getTime(), label: label || formatLocalDateShort(start.getTime()) };
}

function weekRange(offset, reference = now(), label = '') {
  const base = startOfLocalDay(reference);
  if (base === undefined) return undefined;
  const start = new Date(base);
  const mondayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayOffset + offset * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start: start.getTime(), end: end.getTime(), label: label || `${formatLocalDateShort(start.getTime())}~${formatLocalDateShort(end.getTime() - 1)}` };
}

function monthRange(offset, reference = now(), label = '') {
  const date = new Date(Number(reference));
  if (!Number.isFinite(date.getTime())) return undefined;
  const start = new Date(date.getFullYear(), date.getMonth() + offset, 1);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  return { start: start.getTime(), end: end.getTime(), label: label || `${formatLocalDateShort(start.getTime())}~${formatLocalDateShort(end.getTime() - 1)}` };
}

function parseCalendarDateRange(text, reference = now()) {
  const value = normalizePlainText(text, 160);
  const withYear = value.match(/(\d{4})\s*(?:年|-|\/|\.)\s*(\d{1,2})\s*(?:月|-|\/|\.)\s*(\d{1,2})\s*(?:日|号)?/u);
  if (withYear) return rangeFromLocalDate(Number(withYear[1]), Number(withYear[2]), Number(withYear[3]));
  const monthDay = value.match(/(?:^|[^\d])(\d{1,2})\s*(?:月|\/|\.)\s*(\d{1,2})\s*(?:日|号)?(?:$|[^\d])/u);
  if (monthDay) {
    const current = new Date(Number(reference));
    return rangeFromLocalDate(current.getFullYear(), Number(monthDay[1]), Number(monthDay[2]));
  }
  return undefined;
}

function parseNaturalTimeRange(text, reference = now()) {
  const value = normalizePlainText(text, 240);
  if (!value) return undefined;
  const recentDays = value.match(/(?:最近|近|过去)\s*(\d{1,3})\s*天/u);
  if (recentDays) {
    const days = Math.max(1, Math.min(120, Number(recentDays[1])));
    const start = dayRange(1 - days, reference, `最近${days}天`)?.start;
    const end = dayRange(1, reference)?.start;
    return start === undefined || end === undefined ? undefined : { start, end, label: `最近${days}天` };
  }
  const daysAgo = value.match(/(\d{1,3})\s*天前/u);
  if (daysAgo) return dayRange(-Math.max(0, Math.min(120, Number(daysAgo[1]))), reference, `${daysAgo[1]}天前`);
  if (/大前天|three days ago/i.test(value)) return dayRange(-3, reference, '大前天');
  if (/前天|before yesterday/i.test(value)) return dayRange(-2, reference, '前天');
  if (/昨日|昨天|yesterday/i.test(value)) return dayRange(-1, reference, '昨天');
  if (/今日|今天|today/i.test(value)) return dayRange(0, reference, '今天');
  if (/上周|last week/i.test(value)) return weekRange(-1, reference, '上周');
  if (/本周|这周|this week/i.test(value)) return weekRange(0, reference, '本周');
  if (/上月|上个月|last month/i.test(value)) return monthRange(-1, reference, '上月');
  if (/本月|这个月|this month/i.test(value)) return monthRange(0, reference, '本月');
  if (/最近|近几天|这几天|这段时间|recently/i.test(value)) {
    const start = dayRange(-6, reference, '最近7天')?.start;
    const end = dayRange(1, reference)?.start;
    return start === undefined || end === undefined ? undefined : { start, end, label: '最近7天' };
  }
  return parseCalendarDateRange(value, reference);
}

function parseTimeBoundary(text, boundary = 'start', reference = now()) {
  const value = normalizePlainText(text, 160);
  if (!value) return undefined;
  const natural = parseNaturalTimeRange(value, reference);
  if (natural !== undefined) return boundary === 'end' ? natural.end : natural.start;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resolveToolTimeRange(queryText, options = {}) {
  const fromText = normalizePlainText(options.from, 160);
  const toText = normalizePlainText(options.to, 160);
  if (fromText || toText) {
    const start = fromText ? parseTimeBoundary(fromText, 'start') : 0;
    const end = toText ? parseTimeBoundary(toText, 'end') : Number.MAX_SAFE_INTEGER;
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) return { start, end, label: `${fromText || '开始'}~${toText || '现在'}` };
    return undefined;
  }
  const hint = normalizePlainText(options.date ?? options.timeRange, 240);
  return parseNaturalTimeRange(hint || queryText);
}

function inTimeRange(value, range) {
  if (range === undefined) return true;
  const time = Number(value);
  return Number.isFinite(time) && time >= range.start && time < range.end;
}

function stripTimeQueryNoise(text, range) {
  const value = normalizePlainText(text, 1000);
  if (range === undefined) return value;
  return value
    .replace(/\d{4}\s*(?:年|-|\/|\.)\s*\d{1,2}\s*(?:月|-|\/|\.)\s*\d{1,2}\s*(?:日|号)?/gu, ' ')
    .replace(/(?:^|[^\d])\d{1,2}\s*(?:月|\/|\.)\s*\d{1,2}\s*(?:日|号)?(?:$|[^\d])/gu, ' ')
    .replace(/(?:最近|近|过去)\s*\d{1,3}\s*天|\d{1,3}\s*天前|大前天|前天|昨日|昨天|yesterday|今日|今天|today|上周|last week|本周|这周|this week|上月|上个月|last month|本月|这个月|this month|recently|最近|近几天|这几天|这段时间/giu, ' ')
    .replace(/干了什么|做了什么|做过什么|改了什么|完成了什么|推进了什么|有哪些|什么|回顾|总结|查一下|查询|搜索|历史|记录|活动|进展|情况/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clampToolLimit(value, fallback, max) {
  const number = Math.floor(Number(value));
  if (!Number.isSafeInteger(number) || number <= 0) return fallback;
  return Math.min(number, max);
}

function toolTextBlock(text) {
  return [{ type: 'text', text: String(text ?? '') }];
}

function normalizeToolSessionId(value, fallback = '') {
  const sessionId = normalizePlainText(value, 128) || normalizePlainText(fallback, 128);
  return SESSION_ID_RE.test(sessionId) ? sessionId : '';
}

function tokenCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : undefined;
}

const MEMORY_CREATION_METHODS = new Set(['', 'manual', 'auto-distill', 'manual-distill', 'memory_add', 'import']);

function normalizeCreationMethod(value) {
  const text = normalizePlainText(value, 32);
  return MEMORY_CREATION_METHODS.has(text) ? text : '';
}

function normalizeTokenUsage(usage) {
  if (usage === undefined || usage === null || typeof usage !== 'object') return undefined;
  const inputTokens = tokenCount(usage.inputTokens ?? usage.uncachedInputTokens);
  const outputTokens = tokenCount(usage.outputTokens);
  const cacheReadTokens = tokenCount(usage.cacheReadTokens);
  const cacheWriteTokens = tokenCount(usage.cacheWriteTokens);
  const reasoningTokens = tokenCount(usage.reasoningTokens);
  const derivedTotal = [inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens]
    .filter((value) => value !== undefined)
    .reduce((sum, value) => sum + value, 0);
  const totalTokens = tokenCount(usage.totalTokens) ?? (derivedTotal > 0 ? derivedTotal : undefined);
  if (totalTokens === undefined && inputTokens === undefined && outputTokens === undefined) return undefined;
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...(usage.estimated === true ? { estimated: true } : {})
  };
}

function rowTags(row) {
  const tagIds = listFromSeparated(row.tag_ids);
  const tags = listFromSeparated(row.tag_names);
  return { tagIds, tags };
}

function memoryFromRow(row, persisted = true) {
  const { tagIds, tags } = rowTags(row);
  return {
    id: row.id,
    persisted,
    text: row.body,
    status: normalizeStatus(row.status),
    directoryId: row.directory_id ?? null,
    directoryName: row.directory_name ?? null,
    tagIds,
    tags,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
    lastRecalledAt: Number(row.last_recalled_at) || 0,
     creationMethod: normalizeCreationMethod(row.creation_method)
  };
}

function compactMemory(memory) {
  return {
    id: String(memory.id),
    text: memory.text ?? '',
    status: normalizeStatus(memory.status),
    directoryId: memory.directoryId ?? '',
    directoryName: memory.directoryName ?? '',
    tags: Array.isArray(memory.tags) ? memory.tags : [],
    createdAt: Number(memory.createdAt) || 0,
    updatedAt: Number(memory.updatedAt) || 0,
    lastRecalledAt: Number(memory.lastRecalledAt) || 0,
    creationMethod: normalizeCreationMethod(memory.creationMethod)
  };
}

function renderMemoryInjection(hits) {
  const lines = [
    '以下是当前会话已启用记忆项目中召回的相关记忆。若与用户最新消息或显式指令冲突，以用户最新消息和显式指令为准。',
    ''
  ];
  if (hits.some((hit) => hit.truncated === true)) {
    lines.push('标注"已截断"的记忆仅含前缀；与当前任务相关时应调用 memory_read 工具（传对应 id）查看全文。', '');
  }
  hits.forEach((hit, index) => {
    const tags = hit.tags.length > 0 ? hit.tags.join('、') : '未标记';
    const date = formatDateShort(hit.updatedAt);
    lines.push(`${index + 1}. 目录：${hit.directoryName || '未命名目录'}；标签：${tags}${date ? `；更新：${date}` : ''}`);
    lines.push(hit.text);
    lines.push('');
  });
  return lines.join('\n').trim();
}

function memoryDedupText(value) {
  return normalizePlainText(value, RECALL_DEDUP_MAX_MESSAGE_CHARS)
    .toLocaleLowerCase()
    .replace(/[\s\u200b\u200c\u200d\ufeff]+/gu, '')
    .replace(/[`'"“”‘’【】\[\]（）(){}<>《》]/gu, '')
    .replace(/[，,。.!！?？:：;；、|\\/\-—_~]+/gu, '');
}

function memoryContentCandidates(text) {
  const raw = normalizePlainText(text, MAX_MEMORY_TEXT_LENGTH);
  const candidates = [];
  const add = (value) => {
    const normalized = memoryDedupText(value);
    if (normalized.length >= RECALL_DEDUP_MIN_CHARS && !candidates.includes(normalized)) candidates.push(normalized);
  };
  add(raw);
  const structured = parseStructuredMemoryBody(raw);
  if (structured !== undefined) add(structured.content);
  const parsed = parseJsonObject(raw);
  if (parsed !== undefined) {
    add(structuredMemoryField(parsed, 'content'));
    add(parsed.summary);
    add(parsed.text);
  }
  return candidates;
}

function existingMemoryHitIds(messages) {
  const ids = new Set();
  for (const message of Array.isArray(messages) ? messages : []) {
    const source = message?.source;
    if (source?.kind !== 'plugin' || source?.plugin !== MEMORY_CONTEXT_PLUGIN || !Array.isArray(source.hitIds)) continue;
    for (const idValue of source.hitIds) {
      const value = normalizePlainText(String(idValue ?? ''), 128);
      if (value) ids.add(value);
    }
  }
  return ids;
}

function existingMessageDedupText(messages) {
  const parts = [];
  let used = 0;
  const maxChars = RECALL_DEDUP_MAX_MESSAGE_CHARS;
  for (const message of Array.isArray(messages) ? messages : []) {
    const text = textBlocks(message?.content);
    if (!text) continue;
    const remaining = maxChars - used;
    if (remaining <= 0) break;
    const chunk = text.length > remaining ? text.slice(text.length - remaining) : text;
    parts.push(chunk);
    used += chunk.length;
  }
  return memoryDedupText(parts.join('\n\n'));
}

function filterFreshMemoryHits(hits, messages) {
  if (!Array.isArray(hits) || hits.length === 0) return [];
  const existingIds = existingMemoryHitIds(messages);
  const existingText = existingMessageDedupText(messages);
  return hits.filter((hit) => {
    const idValue = normalizePlainText(String(hit?.id ?? ''), 128);
    if (idValue && existingIds.has(idValue)) return false;
    if (!existingText) return true;
    return !memoryContentCandidates(hit?.text).some((candidate) => existingText.includes(candidate));
  });
}

function contextMemoryHitIds(messages) {
  const ids = [];
  const seen = new Set();
  for (const message of Array.isArray(messages) ? messages : []) {
    const source = message?.source;
    if (source?.kind !== 'plugin' || source?.plugin !== MEMORY_CONTEXT_PLUGIN || !Array.isArray(source.hitIds)) continue;
    for (const idValue of source.hitIds) {
      const idText = normalizePlainText(String(idValue ?? ''), 128);
      if (!idText || seen.has(idText)) continue;
      seen.add(idText);
      ids.push(idText);
    }
  }
  return ids;
}

/* 弱输入判定：短续作、纯应答、纯数值/单位/代码片段等。这类输入的召回结果与当前主题
   关联性弱，不能作为剔除已注入记忆的依据，否则"继续""10px"会把活跃主题记忆误剔。 */
function isWeakQueryText(text) {
  const raw = normalizePlainText(text, 2000);
  const compact = raw.replace(/\s+/g, '');
  if (compact.length === 0) return true;
  /* 有效内容太短（如"继续""好的""10px""1"） */
  if (compact.length < 6) return true;
  /* 纯续作/应答短语 */
  if (/^(继续|接着|请继续|继续吧|好的|嗯|哦|ok|okay|yes|no|是|不是|对|好|收到|了解了|明白了|知道了|吧|嗯嗯|继续请|请|然后呢|怎么办|为什么)[。.！!？?～~]*$/i.test(compact)) return true;
  /* 去掉数字/单位/标点/常见代码片段后没有实质内容 */
  const stripped = compact
    .replace(/[0-9a-fA-F]+/g, '')
    .replace(/(px|em|rem|vh|vw|%|ms|s|min|h|kb|mb|gb|pt|dp|sp)\b/gi, '')
    .replace(/[+\-*/=<>!&|^~%$/,;:."'`()[\]{}#@\\|?！，。；：""''（）【】<>《》—…·]+/g, '');
  if (stripped.replace(/\s/g, '').length < 4) return true;
  return false;
}

/* JSON 结构感知限额：只截断 content 字段，位置/对象/踩坑与未知字段完整保留。
   返回 { text, truncated }，truncated 仅表示 content 被截断。 */
function limitStructuredMemoryText(text, contentChars) {
  const raw = typeof text === 'string' ? text : String(text ?? '');
  const structured = parseStructuredMemoryBody(raw);
  if (structured !== undefined) {
    if (structured.content.length <= contentChars) return { text: raw, truncated: false };
    const limitedContent = structured.content.slice(0, contentChars);
    return {
      text: structuredContentBody(structured.paths, structured.symbols, limitedContent, structured.pitfall, structured.extra),
      truncated: true
    };
  }
  if (raw.length <= contentChars) return { text: raw, truncated: false };
  return { text: raw.slice(0, contentChars), truncated: true };
}

/* 注入侧包装：JSON content 超限时追加 id + memory_read 提示；位置/对象/踩坑及未知字段不参与 content 限额。 */
function truncateMemoryTextForInjection(id, text) {
  const { text: limited, truncated } = limitStructuredMemoryText(text, RECALL_ITEM_CONTENT_CHARS);
  if (!truncated) return { text: limited, truncated: false };
  return { text: `${limited}\n…（该记忆已截断 · id: ${id} · 调用 memory_read 工具可查看全文）`, truncated: true };
}

function packHits(rows, maxItems = RECALL_MAX_ITEMS) {
  /* v9：四段席位已在上游选定，条数即数量边界；
     单条体积由注入截断保证（JSON 的位置/对象/踩坑/未知字段完整保留，仅 content 受限 + memory_read 提示）。 */
  const hits = [];
  for (const row of rows) {
    if (hits.length >= maxItems) break;
    const item = memoryFromRow(row, row.persisted !== false);
    const { text, truncated } = truncateMemoryTextForInjection(item.id, item.text);
    hits.push({ ...item, text, truncated, rank: Number(row.rank ?? 0) });
  }
  return hits;
}

function renderMemoryToolList(memories) {
  if (!Array.isArray(memories) || memories.length === 0) return '未找到记忆。';
  return memories.map((memory, index) => {
    const tags = Array.isArray(memory.tags) && memory.tags.length > 0 ? memory.tags.join('、') : '未标记';
    const date = formatDateShort(memory.updatedAt);
    return `${index + 1}. ${memory.id} · ${memory.directoryName || '未命名目录'} · ${memory.status || 'inactive'} · ${tags}${date ? ` · ${date}` : ''}\n${memory.text || ''}`;
  }).join('\n\n');
}

function sessionEventTurn(event, activeTurn) {
  if (Number.isSafeInteger(event?.data?.turn)) return event.data.turn;
  return activeTurn;
}

/**
 * 纯会话日志计算：重放会话事件流，返回 turn -> hits 有序映射（记忆小面板取数）。
 *
 * 面板语义 = 该轮 turn/end 时模型上下文中真实携带的记忆：对 surface 逐事件重放
 * （append 加入存活集；replace 移除 [start..end] 并加入自身），在每个 turn/end
 * 快照当时存活的记忆注入行，并以注入消息的 source.snapshot（注入时命中记忆的
 * 结构化内容，与注入正文 1:1）展开为条目。由此：
 * - 弱输入轮不剔除 → 背景注入行存活 → 面板自然继承背景（无需继承判断）；
 * - 部分存活重写 → 重写行快照已同步为存活子集 → 面板与注入正文一致；
 * - 整条剔除/删除轮次 → 注入行随 tombstone 离开表面 → 面板不再显示；
 * - 临时记忆 → 快照随注入行持久化，重启后面板仍显示（注入行仍在上下文中）；
 * - 记忆编辑/删除 → 历史轮显示召回时快照（上下文注入行未变），新轮召回产生新快照。
 * 遗留注入（无快照的旧数据）产出 text 为空的条目，由 handler 以记忆库兜底解析。
 * 扫描结束时若仍有未闭合的 turn（流式中），同样为其建立快照。持久化在会话日志
 * 中，重启后可完整重算，不依赖数据库与内存。
 * @param events - 会话事件（sessionEvents(session) 结果）。
 * @returns Map<turn, Array<{id, text, directoryName, tags}>>（按注入顺序）。
 */
function foldTurnContextMemory(events) {
  const result = new Map();
  if (!Array.isArray(events) || events.length === 0) return result;
  const alive = new Set();
  const bySeq = new Map();
  let activeTurn;
  const collectAliveHits = () => {
    const hits = [];
    for (const seq of [...alive].sort((left, right) => left - right)) {
      const source = bySeq.get(seq)?.data?.source;
      if (source?.kind !== 'plugin' || source?.plugin !== MEMORY_CONTEXT_PLUGIN) continue;
      /* 行内 hitIds 是该行实际内容的权威清单（遗留重写行的快照可能仍是旧全量），
         快照仅为这些 id 提供召回时文本。 */
      const snapshots = new Map();
      if (Array.isArray(source.snapshot)) {
        for (const hit of source.snapshot) {
          const id = normalizePlainText(String(hit?.id ?? ''), 128);
          if (id) snapshots.set(id, hit);
        }
      }
      for (const idValue of Array.isArray(source.hitIds) ? source.hitIds : []) {
        const id = normalizePlainText(String(idValue ?? ''), 128);
        if (!id || hits.some((hit) => hit.id === id)) continue;
        const snapshot = snapshots.get(id);
        hits.push({ id, text: String(snapshot?.text ?? ''), directoryName: String(snapshot?.directoryName ?? ''), tags: Array.isArray(snapshot?.tags) ? snapshot.tags.map(String) : [] });
      }
    }
    return hits;
  };
  activeTurn = undefined;
  for (const event of events) {
    bySeq.set(event.seq, event);
    if (event.type === 'turn/start' && Number.isSafeInteger(event.data?.turn)) activeTurn = event.data.turn;
    if (isAppendSurfaceEvent(event)) alive.add(event.seq);
    else if (isReplacementSurfaceEvent(event)) {
      /* v3 起 replace op 键为 startSeq/endSeq；旧日志仍为 start/end，两者都接受 */
      const start = Number(event.surfaceOp?.startSeq ?? event.surfaceOp?.start);
      const end = Number(event.surfaceOp?.endSeq ?? event.surfaceOp?.end);
      if (Number.isSafeInteger(start) && Number.isSafeInteger(end)) {
        for (let seq = start; seq <= end; seq++) alive.delete(seq);
      }
      alive.add(event.seq);
    }
    if (event.type === 'turn/end' && activeTurn === event.data?.turn) {
      result.set(activeTurn, collectAliveHits());
      activeTurn = undefined;
    }
  }
  if (activeTurn !== undefined) result.set(activeTurn, collectAliveHits());
  return result;
}

function sessionFallbackTime(session) {
  const value = Number(session?.header?.createdAt ?? session?.createdAt ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function eventTimestamp(session, event) {
  const value = Number(event?.time);
  return Number.isFinite(value) ? value : sessionFallbackTime(session);
}

function searchableSessionRows(session) {
  const rows = [];
  const activeRecallCallIds = new Set();
  let activeTurn;
  for (const event of sessionEvents(session)) {
    if (event.type === 'turn/start' && Number.isSafeInteger(event.data?.turn)) activeTurn = event.data.turn;
    const turn = sessionEventTurn(event, activeTurn);
    const time = eventTimestamp(session, event);
    if (event.type === 'user/message') {
      const text = textBlocks(event.data?.content);
      if (text) rows.push({ session, turn, role: 'user', text, seq: Number(event.seq) || 0, time });
    } else if (event.type === 'assistant/message') {
      const text = textBlocks(event.data?.message?.content);
      if (text) rows.push({ session, turn, role: 'assistant', text, seq: Number(event.seq) || 0, time });
    } else if (event.type === 'tool/call') {
      const name = normalizePlainText(event.data?.name, 120) || 'unknown';
      const callId = normalizePlainText(event.data?.callId, 128);
      if (ACTIVE_RECALL_TOOL_NAMES.has(name)) {
        if (callId) activeRecallCallIds.add(callId);
        continue;
      }
      const args = normalizePlainText(event.data?.arguments, 1200);
      rows.push({ session, turn, role: 'tool-call', text: args ? `${name}\n${args}` : name, seq: Number(event.seq) || 0, time, callId });
    } else if (event.type === 'tool/result') {
      const callId = normalizePlainText(event.data?.message?.source?.callId, 128);
      if (callId && activeRecallCallIds.has(callId)) continue;
      const text = textBlocks(event.data?.message?.content);
      if (text) rows.push({ session, turn, role: 'tool-result', text, seq: Number(event.seq) || 0, time, callId });
    }
    if (event.type === 'turn/end' && activeTurn === event.data?.turn) activeTurn = undefined;
  }
  return rows;
}

function conversationRowDedupeKey(row) {
  const sessionId = String(row.session?.id ?? row.session?.header?.id ?? '');
  if (row.role === 'tool-result' && row.callId) return `${sessionId}:tool:${row.callId}`;
  return `${sessionId}:${Number.isSafeInteger(row.turn) ? row.turn : -1}:${row.role}:${String(row.text || '').slice(0, 80)}`;
}

function scoreConversationRow(row, terms, queryText, timeRange) {
  if (row.role === 'tool-result' && row.callId) return 0;
  const haystack = row.text.toLocaleLowerCase();
  const exact = queryText && haystack.includes(queryText.toLocaleLowerCase()) ? 12 : 0;
  const lexical = exact + terms.reduce((score, term) => score + (haystack.includes(term) ? Math.max(1, Math.min(6, term.length)) : 0), 0);
  if (lexical > 0) return lexical;
  return timeRange !== undefined && terms.length === 0 ? 1 : 0;
}

function compactConversationResult(row, score) {
  const session = row.session;
  const text = row.text.length > 700 ? `${row.text.slice(0, 680)}\n…（结果已截断）` : row.text;
  const time = Number(row.time) || 0;
  return {
    sessionId: String(session?.id ?? session?.header?.id ?? ''),
    title: sessionTitle(session),
    turn: Number.isSafeInteger(row.turn) ? row.turn : -1,
    role: row.role,
    text,
    time,
    date: formatLocalDateTimeShort(time),
    score: Math.round(score * 100) / 100
  };
}

function renderConversationToolList(results) {
  if (!Array.isArray(results) || results.length === 0) return '未找到跨会话结果。';
  return results.map((item, index) => `${index + 1}. ${item.sessionId} · ${item.title || '未命名会话'} · ${item.date || '-'} · turn ${item.turn} · ${item.role}\n${item.text}`).join('\n\n');
}

function normalizeActiveRecallArgs(toolName, args = {}) {
  const rawQuery = normalizePlainText(args.query, 1000);
  const timeRange = resolveToolTimeRange(rawQuery, args);
  const searchIntent = stripTimeQueryNoise(rawQuery, timeRange);
  const explicitDate = normalizePlainText(args.date ?? args.timeRange, 240);
  const relevant = {
    query: normalizeQueryIntentText(searchIntent),
    terms: queryIntentTerms(searchIntent),
    timeStart: timeRange?.start,
    timeEnd: timeRange?.end,
    explicitTime: Boolean(explicitDate || normalizePlainText(args.from, 160) || normalizePlainText(args.to, 160)),
    directoryId: normalizePlainText(args.directoryId, 128),
    directoryName: normalizeQueryIntentText(args.directoryName ?? args.directory),
    scope: normalizePlainText(args.scope, 16) || undefined,
    status: normalizePlainText(args.status, 16) || undefined,
    tags: normalizeDistillList(args.tags ?? args.tagNames, MAX_TAGS_PER_MEMORY).map(normalizeQueryIntentText).sort(),
    includeCurrent: args.includeCurrent === false ? false : undefined,
    includeSubagents: args.includeSubagents === true ? true : undefined,
    includeArchived: args.includeArchived === false ? false : undefined
  };
  return `${toolName}:${JSON.stringify(relevant)}`;
}

function activeRecallTurn(exec = {}) {
  const callId = normalizePlainText(exec.callId, 128);
  const events = sessionEvents(exec.agent?.session);
  if (callId) {
    const callEvent = events.findLast?.((event) => event.type === 'tool/call' && event.data?.callId === callId);
    if (Number.isSafeInteger(callEvent?.data?.turn)) return callEvent.data.turn;
  }
  const boundary = events.findLast?.((event) => event.type === 'turn/start' || event.type === 'turn/end');
  return Number.isSafeInteger(boundary?.data?.turn) ? boundary.data.turn : -1;
}

function lastHumanMessageText(events) {
  let text = '';
  for (const event of events) {
    if (event.type !== 'user/message' || !isAppendSurfaceEvent(event) || !isHumanSource(event.data?.source)) continue;
    const value = textBlocks(event.data?.content);
    if (value) text = value;
  }
  return text;
}

function activityUserMessageForToolCall(session, callId) {
  const normalizedCallId = normalizePlainText(callId, 128);
  const events = sessionEvents(session);
  const fallback = () => ({ callId: normalizedCallId, turn: undefined, text: lastHumanMessageText(events) });
  if (!normalizedCallId) return fallback();
  const callEvent = events.findLast?.((event) => event.type === 'tool/call' && event.data?.callId === normalizedCallId);
  if (callEvent === undefined) return fallback();
  const callSeq = Number(callEvent?.seq);
  const turn = Number.isSafeInteger(callEvent?.data?.turn) ? callEvent.data.turn : undefined;
  if (!Number.isSafeInteger(callSeq) || turn === undefined) return fallback();
  const start = events.findLast?.((event) => event.type === 'turn/start' && event.data?.turn === turn && Number(event.seq) < callSeq);
  if (start === undefined || !Number.isSafeInteger(Number(start.seq))) return fallback();
  return { callId: normalizedCallId, turn, text: lastHumanMessageText(events.filter((event) => {
    const seq = Number(event.seq);
    return Number.isSafeInteger(seq) && seq > Number(start.seq) && seq < callSeq;
  })) };
}

function activeRecallAlreadySatisfiedText(toolName) {
  return `${toolName} 已在本轮对话中执行过相同查询；请直接使用上一次工具结果回答，不要重复调用。`;
}

function autoMatchTextTerms(text) {
  return new Set(extractSearchTerms(normalizeQueryIntentText(text)).map((term) => normalizeHashText(term)).filter((term) => term.length >= 2));
}

function scoreDirectoryNameForAutoMatch(directory, textTerms, compactText) {
  const name = normalizePlainText(directory?.name, MAX_DIRECTORY_NAME_LENGTH);
  if (!name || PROTECTED_MEMORY_DIRECTORY_NAMES.has(name)) return 0;
  const normalizedName = normalizeHashText(name);
  const nameTerms = directoryNameTerms(name).map((term) => normalizeHashText(term)).filter((term) => term.length >= 2);
  let score = 0;
  if (normalizedName && compactText.includes(normalizedName)) score += 28 + Math.min(28, normalizedName.length);
  for (const term of nameTerms) {
    if (textTerms.has(term) || compactText.includes(term)) score += Math.max(6, Math.min(16, term.length * 2));
    else {
      for (const textTerm of textTerms) {
        if (term.includes(textTerm) || textTerm.includes(term)) {
          score += Math.max(3, Math.min(10, Math.min(term.length, textTerm.length) * 2));
          break;
        }
      }
    }
  }
  return score;
}

function autoMatchKeywordTerms(...values) {
  const stop = /^(default|memory|project|the|and|for|with|from|this|that|项目|记忆|会话|对话|开关|按钮|新增|添加|修改|调整|优化|当前|默认|启用|关闭|打开)$/;
  const terms = new Set();
  for (const value of values) {
    for (const term of extractSearchTerms(value)) {
      const normalized = normalizeHashText(term);
      if (normalized.length >= 2 && !stop.test(normalized)) terms.add(normalized);
    }
  }
  return [...terms].slice(0, 80);
}

function scoreMemoryRowForAutoMatch(row, textTerms, compactText) {
  const haystack = normalizeHashText(`${row?.body ?? ''}\n${row?.directory_name ?? ''}\n${row?.tag_names ?? ''}`);
  let score = 0;
  for (const term of textTerms) {
    if (haystack.includes(term)) score += Math.max(4, Math.min(14, term.length * 2));
  }
  for (const term of autoMatchKeywordTerms(row?.directory_name, row?.tag_names, row?.body)) {
    if (textTerms.has(term) || compactText.includes(term)) score += Math.max(6, Math.min(16, term.length * 2));
  }
  return score;
}

function autoMatchNoticeText(matchedDirectories) {
  const names = matchedDirectories.map((directory) => directory.name).filter(Boolean).join('、');
  return `对话自动匹配项目已启用：${names}。这些项目已为当前会话打开“当前会话已启用”开关。`;
}

function directoryNameTerms(name) {
  const normalized = normalizeHashText(name);
  const terms = new Set();
  if (normalized) terms.add(normalized);
  for (const term of extractSearchTerms(name)) terms.add(term.toLocaleLowerCase());
  for (const part of normalized.split(/[^0-9a-z\u3400-\u9fff]+/i)) {
    if (part.length >= 2) terms.add(part);
  }
  return [...terms].filter((term) => !/^(default|memory|project|the|and|for|with)$/.test(term));
}

function scoreDirectoryNameAgainstText(name, text) {
  if (PROTECTED_MEMORY_DIRECTORY_NAMES.has(name)) return 0;
  const haystack = normalizeHashText(text);
  if (!haystack) return 0;
  const normalizedName = normalizeHashText(name);
  let score = 0;
  if (normalizedName && haystack.includes(normalizedName)) score += 24 + Math.min(24, normalizedName.length);
  for (const term of directoryNameTerms(name)) {
    if (term === normalizedName) continue;
    if (haystack.includes(term)) score += Math.max(2, Math.min(10, term.length));
  }
  return score;
}

function guessDirectoryIdByContent(directoryRows, text) {
  let best;
  let bestScore = 0;
  for (const row of directoryRows) {
    const score = scoreDirectoryNameAgainstText(row.name, text);
    if (score > bestScore || (score === bestScore && score > 0 && Number(row.updated_at ?? 0) > Number(best?.updated_at ?? 0))) {
      best = row;
      bestScore = score;
    }
  }
  return bestScore >= 6 ? best?.id : undefined;
}

function lastCompletedTurn(session) {
  const event = sessionEvents(session).findLast((item) => item.type === 'turn/end' && item.data?.reason?.kind === 'completed' && Number.isSafeInteger(item.data?.turn));
  return event?.data?.turn;
}

function estimateTextTokens(text) {
  return Math.ceil(String(text ?? '').length / 4) + 8;
}

function estimateDistillUsage(prompt, output) {
  const inputTokens = estimateTextTokens(prompt);
  const outputTokens = String(output ?? '').trim().length === 0 ? 0 : estimateTextTokens(output);
  return normalizeTokenUsage({ inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, estimated: true });
}

export class MemoryStore {
  constructor(ctx) {
    this.ctx = ctx;
    this.ephemeral = new Map();
    this.distillQueues = new Map();
    this.activeRecallByTurn = new Map();
    this.ephemeralBoundaryCache = new Map();
    this.dbPath = join(pluginDataDir(), 'memory.sqlite');
    this.ftsAvailable = false;
    this.ftsMode = 'LIKE fallback';
    this.ftsRebuilding = false;
    this.ftsRebuildTimer = null;
    this.ftsRebuildRestart = false;
    this.ftsRebuildClosed = false;
    this.ftsRebuildCursor = '';
    this.ftsRebuildExpectedVersion = null;
    this.ftsPendingOps = new Map();
    this.activeActivities = new Map();
    this.toolWriteTimers = new Set();
    const sqlite = require('node:sqlite');
    this.db = new sqlite.DatabaseSync(this.dbPath);
    this.init();
  }

  init() {
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA temp_store = memory;
      CREATE TABLE IF NOT EXISTS memory_directories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        remark TEXT NOT NULL DEFAULT '',
        auto_session_ids TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        preset INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        directory_id TEXT NOT NULL REFERENCES memory_directories(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active', 'inactive')),
        content_hash TEXT NOT NULL UNIQUE,
        creation_method TEXT NOT NULL DEFAULT '' CHECK(creation_method IN ('', 'manual', 'auto-distill', 'manual-distill', 'memory_add', 'import')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_recalled_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS memory_tag_links (
        memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES memory_tags(id) ON DELETE CASCADE,
        PRIMARY KEY(memory_id, tag_id)
      );
      CREATE TABLE IF NOT EXISTS memory_session_directories (
        session_id TEXT NOT NULL,
        directory_id TEXT NOT NULL REFERENCES memory_directories(id) ON DELETE CASCADE,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(session_id, directory_id)
      );
      CREATE TABLE IF NOT EXISTS memory_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_activity_logs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        outcome TEXT NOT NULL,
        session_id TEXT,
        turn INTEGER,
        call_id TEXT,
        memory_id TEXT,
        summary TEXT,
        error_code TEXT,
        error_message TEXT,
        session_title TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_activity_logs_created ON memory_activity_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_memory_activity_logs_kind_created ON memory_activity_logs(kind, created_at);
      CREATE INDEX IF NOT EXISTS idx_memories_directory_status ON memories(directory_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memories_hash ON memories(content_hash);
      CREATE INDEX IF NOT EXISTS idx_memory_tags_name ON memory_tags(name);
      CREATE INDEX IF NOT EXISTS idx_memory_session_directories_session ON memory_session_directories(session_id, enabled);
      CREATE TABLE IF NOT EXISTS memory_token_usage (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        directory_id TEXT,
        session_id TEXT,
        memory_scope TEXT NOT NULL,
        memory_id TEXT,
        model TEXT,
        reasoning TEXT,
        tokens INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_token_usage_created ON memory_token_usage(created_at);
      CREATE INDEX IF NOT EXISTS idx_memory_token_usage_memory ON memory_token_usage(memory_id);
    `);
    /* last_recalled_at 迁移：早期库无该列则补列（NULL = 从未被召回）；同时处理
       2026-09-13 曾短暂存在的旧列名 last_hit_at（同义更名，数据随迁）。
       注意必须先于 ensureMemoryStatusSchema() 执行：其表重建路径的 INSERT
       ... SELECT 引用本列，旧 paused 库若先重建会因源表缺列而报错 */
    const memoryColumns = this.db.prepare("PRAGMA table_info(memories)").all().map((row) => row.name);
    if (memoryColumns.length > 0 && !memoryColumns.includes('last_recalled_at')) {
      if (memoryColumns.includes('last_hit_at')) {
        this.db.exec('ALTER TABLE memories RENAME COLUMN last_hit_at TO last_recalled_at');
      } else {
        this.db.exec('ALTER TABLE memories ADD COLUMN last_recalled_at INTEGER');
      }
    }
    if (memoryColumns.length > 0 && !memoryColumns.includes('creation_method')) {
      this.db.exec("ALTER TABLE memories ADD COLUMN creation_method TEXT NOT NULL DEFAULT '' CHECK(creation_method IN ('', 'manual', 'auto-distill', 'manual-distill', 'memory_add', 'import'))");
    }
    /* 旧库默认空；非法历史值收敛为空而非猜测来源。 */
    this.db.prepare("UPDATE memories SET creation_method = '' WHERE creation_method NOT IN ('', 'manual', 'auto-distill', 'manual-distill', 'memory_add', 'import')").run();
    /* 旧库默认空；若历史测试/手工写入过非法值，收敛为空而非猜测来源。 */
    this.db.prepare("UPDATE memories SET creation_method = '' WHERE creation_method NOT IN ('', 'manual', 'auto-distill', 'manual-distill', 'memory_add', 'import')").run();
    this.ensureMemoryStatusSchema();
    this.ensureTagStatusSchema();
    const activityColumns = this.db.prepare("PRAGMA table_info(memory_activity_logs)").all().map((row) => row.name);
    if (!activityColumns.includes('session_title')) this.db.exec('ALTER TABLE memory_activity_logs ADD COLUMN session_title TEXT');
    if (!activityColumns.includes('trigger_kind')) this.db.exec("ALTER TABLE memory_activity_logs ADD COLUMN trigger_kind TEXT NOT NULL DEFAULT 'manual'");
    const tokenUsageColumns = this.db.prepare("PRAGMA table_info(memory_token_usage)").all().map((row) => row.name);
    if (tokenUsageColumns.length > 0) {
      if (!tokenUsageColumns.includes('model')) this.db.exec('ALTER TABLE memory_token_usage ADD COLUMN model TEXT');
      if (!tokenUsageColumns.includes('reasoning')) this.db.exec('ALTER TABLE memory_token_usage ADD COLUMN reasoning TEXT');
    }
    /* 目录备注列迁移：旧库缺列时补默认空串，已有数据行不受影响（升级平滑过渡）。 */
    const directoryColumns = this.db.prepare("PRAGMA table_info(memory_directories)").all().map((row) => row.name);
    if (directoryColumns.length > 0 && !directoryColumns.includes('remark')) {
      this.db.exec("ALTER TABLE memory_directories ADD COLUMN remark TEXT NOT NULL DEFAULT ''");
    }
    this.ensureDefaultDirectory();
    this.ensurePresetTags();
    this.cleanupActivityLogs();
    this.initFts();
  }

  ensureMemoryStatusSchema() {
    const row = this.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memories'").get();
    const sql = typeof row?.sql === 'string' ? row.sql : '';
    const updateInvalidStatuses = this.db.prepare("UPDATE memories SET status = 'inactive' WHERE status NOT IN ('active', 'inactive')");
    updateInvalidStatuses.run();
    if (!sql.includes("'paused'") && sql.includes("'active'") && sql.includes("'inactive'")) return;
    /* 表重建包在显式事务内：exec 的多语句默认逐条自动提交，若 DROP 后、
       RENAME 前中断会留下"memories 不存在"的残局（下次启动被 CREATE TABLE
       IF NOT EXISTS 建成空表 = 记忆全丢）；BEGIN IMMEDIATE ... COMMIT 保证
       整串原子。PRAGMA foreign_keys 是连接级开关、不能在事务内切换，故置于
       事务外（关闭期间本段正处于重建，重建后立即恢复）。 */
    this.db.exec('PRAGMA foreign_keys = OFF');
    try {
      this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE memories_migrated (
          id TEXT PRIMARY KEY,
          directory_id TEXT NOT NULL REFERENCES memory_directories(id) ON DELETE CASCADE,
          body TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('active', 'inactive')),
          content_hash TEXT NOT NULL UNIQUE,
          creation_method TEXT NOT NULL DEFAULT '' CHECK(creation_method IN ('', 'manual', 'auto-distill', 'manual-distill', 'memory_add', 'import')),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          last_recalled_at INTEGER
        );
        INSERT INTO memories_migrated (id, directory_id, body, status, content_hash, creation_method, created_at, updated_at, last_recalled_at)
          SELECT id, directory_id, body, CASE WHEN status = 'active' THEN 'active' ELSE 'inactive' END, content_hash, creation_method, created_at, updated_at, last_recalled_at FROM memories;
        DROP TABLE memories;
        ALTER TABLE memories_migrated RENAME TO memories;
        CREATE INDEX IF NOT EXISTS idx_memories_directory_status ON memories(directory_id, status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_memories_hash ON memories(content_hash);
        COMMIT;
      `);
    } catch (error) {
      /* 事务中断则整体回滚（DROP 未生效，旧表原样保留），并把开关复位后抛出 */
      try { this.db.exec('ROLLBACK'); } catch {}
      this.db.exec('PRAGMA foreign_keys = ON');
      throw error;
    }
    this.db.exec('PRAGMA foreign_keys = ON');
  }

  ensureTagStatusSchema() {
    const columns = this.db.prepare("PRAGMA table_info(memory_tags)").all();
    if (!columns.some((column) => column.name === 'status')) {
      this.db.exec("ALTER TABLE memory_tags ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
    }
    this.db.prepare("UPDATE memory_tags SET status = 'active' WHERE preset = 1 OR status NOT IN ('active', 'inactive')").run();
  }

  initFts() {
    try {
      const expectedVersion = effectiveTokenizerVersion();
      const storedVersion = this.getSetting(MEMORY_SETTING_FTS_TOKENIZER_VERSION);
      const tableSql = this.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memory_fts'").get()?.sql || '';
      let rebuildNeeded = storedVersion !== expectedVersion || !tableSql.includes('tokens');
      if (!rebuildNeeded) {
        this.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(id UNINDEXED, body, tokens, tags, directory, tokenize = 'unicode61')");
        const ftsCount = Number(this.db.prepare('SELECT COUNT(*) AS count FROM memory_fts').get()?.count) || 0;
        const memoryCount = Number(this.db.prepare('SELECT COUNT(*) AS count FROM memories').get()?.count) || 0;
        rebuildNeeded = ftsCount !== memoryCount;
      }
      if (rebuildNeeded) {
        /* 后台分批重建：不阻塞启动，期间召回走子串兜底；版本戳在重建完成后写入 */
        this.startFtsRebuild();
        return;
      }
      this.ftsAvailable = true;
      this.ftsMode = 'FTS5 + jieba/二元组分词 + BM25';
    } catch (error) {
      try {
        this.db.exec('DROP TABLE IF EXISTS memory_fts');
      } catch { /* 忽略清理失败 */ }
      this.ftsAvailable = false;
      this.ftsMode = 'LIKE fallback';
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory FTS init failed, recall will use substring fallback:`, error);
    }
  }

  ensureDefaultDirectory() {
    /* 旧版 global 默认项目已废弃：打开旧库时连同类下记忆、会话开关与旧设置键一并清除 */
    this.db.prepare('DELETE FROM memory_directories WHERE name = ?').run('global');
    this.db.prepare("DELETE FROM memory_settings WHERE key = 'globalDirectoryEnabled'").run();
    this.ensureDirectory(DEFAULT_MEMORY_DIRECTORY_NAME);
  }

  ensurePresetTags() {
    const stamp = now();
    const insert = this.db.prepare("INSERT OR IGNORE INTO memory_tags (id, name, preset, status, created_at, updated_at) VALUES (?, ?, 1, 'active', ?, ?)");
    const update = this.db.prepare("UPDATE memory_tags SET preset = 1, status = 'active', updated_at = max(updated_at, ?) WHERE name = ?");
    for (const tag of MEMORY_PRESET_TAGS) {
      insert.run(id('tag'), tag, stamp, stamp);
      update.run(stamp, tag);
    }
  }

  getBooleanSetting(key, fallback = false) {
    const row = this.db.prepare('SELECT value FROM memory_settings WHERE key = ?').get(key);
    if (row === undefined) return fallback;
    return row.value === 'true';
  }

  getSetting(key) {
    const row = this.db.prepare('SELECT value FROM memory_settings WHERE key = ?').get(key);
    return row === undefined ? null : row.value;
  }

  setSetting(key, value) {
    const stamp = now();
    this.db.prepare(`
      INSERT INTO memory_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, stamp);
  }

  setBooleanSetting(key, value) {
    const stamp = now();
    this.db.prepare(`
      INSERT INTO memory_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value ? 'true' : 'false', stamp);
  }

  distillModelOverride() {
    const raw = this.getSetting(MEMORY_SETTING_DISTILL_MODEL_OVERRIDE);
    if (!raw) return undefined;
    try {
      return normalizeModelSelection(JSON.parse(raw));
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] invalid stored distill model override ignored:`, error);
      return undefined;
    }
  }

  setDistillModelOverride(value) {
    if (value === null || value === undefined) {
      this.db.prepare('DELETE FROM memory_settings WHERE key = ?').run(MEMORY_SETTING_DISTILL_MODEL_OVERRIDE);
      return;
    }
    const selection = normalizeModelSelection(value);
    this.setSetting(MEMORY_SETTING_DISTILL_MODEL_OVERRIDE, JSON.stringify(selection));
  }

  autoDistillEnabled() {
    return this.getBooleanSetting(MEMORY_SETTING_AUTO_DISTILL, true);
  }

  allSessionsEnabled() {
    return this.getBooleanSetting(MEMORY_SETTING_ALL_SESSIONS_ENABLED, true);
  }

  autoMatchEnabled() {
    return this.getBooleanSetting(MEMORY_SETTING_FIRST_TURN_AUTO_MATCH, true);
  }

  setFirstTurnAutoMatch(input = {}) {
    this.setBooleanSetting(MEMORY_SETTING_FIRST_TURN_AUTO_MATCH, input.enabled === true);
  }

  setAllSessionsEnabled(input = {}) {
    const enabled = input.enabled === true;
    this.setBooleanSetting(MEMORY_SETTING_ALL_SESSIONS_ENABLED, enabled);
    if (!enabled) {
      const directoryId = this.ensureDirectory(DEFAULT_MEMORY_DIRECTORY_NAME);
      this.db.prepare('DELETE FROM memory_session_directories WHERE directory_id = ?').run(directoryId);
    }
  }

  setAutoDistill(input = {}) {
    this.setBooleanSetting(MEMORY_SETTING_AUTO_DISTILL, input.enabled !== false);
  }

  cleanupActivityLogs() {
    try {
      const cutoff = now() - ACTIVITY_RETENTION_MS;
      this.db.prepare('DELETE FROM memory_activity_logs WHERE created_at < ?').run(cutoff);
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] activity log cleanup failed:`, error);
    }
  }

  /* 清空活动日志：只删已落库的历史记录（memory_activity_logs），不动内存中的 activeActivities，
     进行中的活动结束后仍会正常落库，避免"清空前启动、清空后完成"的操作凭空消失。 */
  clearActivityLogs() {
    const removed = this.db.prepare('DELETE FROM memory_activity_logs').run().changes;
    return { removed: Number(removed) || 0 };
  }

  beginActivity(kind, details = {}) {
    this.reapStuckActivities();
    const activity = { id: id('activity'), kind, status: 'running', triggerKind: ['auto', 'tool'].includes(details.triggerKind) ? details.triggerKind : 'manual', ...details, sessionTitle: details.sessionTitle || '', startedAt: now(), updatedAt: now() };
    this.activeActivities.set(activity.id, activity);
    return activity;
  }

  /* 进行中活动兜底清理：正常路径由 finishActivity 收尾，但异常逃逸（finishActivity 之外的
     未捕获分支）、插件热重载残留等会让条目永久留在内存 Map 里，"进行"列表无法自愈。
     按 ACTIVITY_STUCK_TIMEOUT_MS 扫描，超时条目按失败落库并移出；beginActivity 与
     读取 progress 快照前各触发一次，无需后台定时器。 */
  reapStuckActivities() {
    if (this.activeActivities.size === 0) return;
    const deadline = now() - ACTIVITY_STUCK_TIMEOUT_MS;
    for (const activity of [...this.activeActivities.values()]) {
      if (Number(activity.startedAt ?? 0) > deadline) continue;
      this.finishActivity(activity, 'failed', { errorCode: 'stuck-timeout', errorMessage: `activity stuck for over ${Math.round(ACTIVITY_STUCK_TIMEOUT_MS / 60000)} minutes and was reaped` });
    }
  }

  finishActivity(activity, outcome, details = {}) {
    if (!activity) return;
    this.activeActivities.delete(activity.id);
    if (activity.stuckReaped === true) return; /* 已被兜底清理落库（failed/stuck-timeout），挂起的原路径迟到完成时不再重复写一条 */
    const triggerKind = ['auto', 'tool'].includes(activity.triggerKind) ? activity.triggerKind : 'manual';
    try {
      this.db.prepare(`INSERT INTO memory_activity_logs (id, kind, outcome, session_id, turn, call_id, memory_id, summary, error_code, error_message, session_title, trigger_kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(activity.id, activity.kind, outcome, activity.sessionId ?? null, activity.turn ?? null, activity.callId ?? null, details.memoryId ?? activity.memoryId ?? null, details.summary ?? activity.summary ?? null, details.errorCode ?? null, details.errorMessage ?? null, activity.sessionTitle || null, triggerKind, now());
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] activity log write failed:`, error);
    } finally {
      if (outcome === 'failed' && details.errorCode === 'stuck-timeout') {
        activity.stuckReaped = true; /* 兜底落库成功后打标，拦截原路径迟到的重复 finishActivity */
      }
    }
  }

  activitySnapshot(view = 'progress', limit = 50, before) {
    if (view === 'progress') {
      this.reapStuckActivities();
      const items = [...this.activeActivities.values()];
      return { items, count: items.length, hasMore: false, nextBefore: null };
    }
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
    const rows = this.db.prepare('SELECT * FROM memory_activity_logs WHERE (? IS NULL OR created_at < ?) ORDER BY created_at DESC LIMIT ?').all(before ?? null, before ?? null, safeLimit + 1);
    const items = rows.slice(0, safeLimit).map((row) => ({ id: row.id, kind: row.kind, outcome: row.outcome, sessionId: row.session_id, sessionTitle: row.session_title || '', turn: row.turn, memoryId: row.memory_id, summary: row.summary, errorCode: row.error_code, errorMessage: row.error_message, triggerKind: ['auto', 'tool'].includes(row.trigger_kind) ? row.trigger_kind : 'manual', createdAt: row.created_at }));
    return { items, hasMore: rows.length > safeLimit, nextBefore: items.at(-1)?.createdAt ?? null };
  }

  close() {
    for (const timer of this.toolWriteTimers) clearTimeout(timer);
    this.toolWriteTimers.clear();
    this.ftsRebuildClosed = true;
    clearTimeout(this.ftsRebuildTimer);
    this.db?.close();
  }

  /* 后台分批重建入口：重建期间 ftsAvailable=false，召回自动走子串兜底；
     进行中再次触发（目录改名/标签变更等结构性事件）会置重启标记，让循环重走一轮以读取最新目录/标签名 */
  startFtsRebuild() {
    if (this.ftsRebuildClosed) return;
    if (this.ftsRebuilding) {
      this.ftsRebuildRestart = true;
      return;
    }
    this.beginFtsRebuild();
  }

  beginFtsRebuild() {
    this.db.exec('DROP TABLE IF EXISTS memory_fts');
    this.db.exec("CREATE VIRTUAL TABLE memory_fts USING fts5(id UNINDEXED, body, tokens, tags, directory, tokenize = 'unicode61')");
    this.ftsRebuilding = true;
    this.ftsRebuildRestart = false;
    this.ftsPendingOps.clear();
    this.ftsRebuildCursor = '';
    this.ftsRebuildExpectedVersion = effectiveTokenizerVersion();
    this.ftsAvailable = false;
    this.ftsMode = '索引重建中（召回暂用子串兜底）';
    this.ftsRebuildTimer = setTimeout(() => this.runFtsRebuildBatch(), 0);
  }

  runFtsRebuildBatch() {
    if (this.ftsRebuildClosed) return;
    if (this.ftsRebuildRestart) {
      this.beginFtsRebuild();
      return;
    }
    try {
      const rows = this.db.prepare(`
        SELECT m.id, m.body, d.name AS directory_name,
          COALESCE((SELECT GROUP_CONCAT(t.name, ' ') FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active'), '') AS tag_names
        FROM memories m JOIN memory_directories d ON d.id = m.directory_id
        WHERE m.id > ? ORDER BY m.id LIMIT ${FTS_REBUILD_BATCH_SIZE}
      `).all(this.ftsRebuildCursor);
      const insert = this.db.prepare('INSERT INTO memory_fts (id, body, tokens, tags, directory) VALUES (?, ?, ?, ?, ?)');
      for (const row of rows) {
        if (this.ftsPendingOps.get(row.id) === 'delete') {
          this.ftsPendingOps.delete(row.id);
          continue;
        }
        insert.run(row.id, row.body, ftsTokensFor(row.body, row.tag_names ?? '', row.directory_name ?? ''), row.tag_names ?? '', row.directory_name ?? '');
        this.ftsPendingOps.delete(row.id);
      }
      if (rows.length > 0) this.ftsRebuildCursor = rows[rows.length - 1].id;
      if (rows.length === FTS_REBUILD_BATCH_SIZE) {
        this.ftsRebuildTimer = setTimeout(() => this.runFtsRebuildBatch(), 0);
        return;
      }
    } catch (error) {
      this.ftsRebuilding = false;
      this.ftsAvailable = false;
      this.ftsMode = 'LIKE fallback';
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory FTS background rebuild failed; disabled FTS for this run:`, error);
      return;
    }
    /* 游标走完：处理重建期间的挂起增量，再清理幽灵行 */
    try {
      for (const [memoryId, op] of this.ftsPendingOps) {
        if (op === 'delete') {
          this.db.prepare('DELETE FROM memory_fts WHERE id = ?').run(memoryId);
        } else {
          const row = this.db.prepare(`
            SELECT m.id, m.body, d.name AS directory_name,
              COALESCE((SELECT GROUP_CONCAT(t.name, ' ') FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active'), '') AS tag_names
            FROM memories m JOIN memory_directories d ON d.id = m.directory_id
            WHERE m.id = ?
          `).get(memoryId);
          if (row !== undefined) this.db.prepare('INSERT INTO memory_fts (id, body, tokens, tags, directory) VALUES (?, ?, ?, ?, ?)').run(row.id, row.body, ftsTokensFor(row.body, row.tag_names ?? '', row.directory_name ?? ''), row.tag_names ?? '', row.directory_name ?? '');
        }
        this.ftsPendingOps.delete(memoryId);
      }
      this.db.exec('DELETE FROM memory_fts WHERE id NOT IN (SELECT id FROM memories)');
      this.ftsRebuilding = false;
      this.setSetting(MEMORY_SETTING_FTS_TOKENIZER_VERSION, this.ftsRebuildExpectedVersion);
      this.ftsAvailable = true;
      this.ftsMode = 'FTS5 + jieba/二元组分词 + BM25';
    } catch (error) {
      this.ftsRebuilding = false;
      this.ftsAvailable = false;
      this.ftsMode = 'LIKE fallback';
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory FTS background rebuild finalize failed:`, error);
    }
  }

  reindexMemory(memoryId) {
    if (this.ftsRebuilding) {
      /* 后台重建进行中：挂起单行索引，由重建收尾统一处理 */
      this.ftsPendingOps.set(memoryId, 'index');
      return;
    }
    if (!this.ftsAvailable) return;
    try {
      const row = this.db.prepare(`
        SELECT m.id, m.body, d.name AS directory_name,
          COALESCE((SELECT GROUP_CONCAT(t.name, ' ') FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active'), '') AS tag_names
        FROM memories m JOIN memory_directories d ON d.id = m.directory_id
        WHERE m.id = ?
      `).get(memoryId);
      this.db.prepare('DELETE FROM memory_fts WHERE id = ?').run(memoryId);
      if (row !== undefined) this.db.prepare('INSERT INTO memory_fts (id, body, tokens, tags, directory) VALUES (?, ?, ?, ?, ?)').run(row.id, row.body, ftsTokensFor(row.body, row.tag_names ?? '', row.directory_name ?? ''), row.tag_names ?? '', row.directory_name ?? '');
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory FTS row update failed; rebuilding index:`, error);
      this.startFtsRebuild();
    }
  }

  snapshot(sessionId = '') {
    const sid = typeof sessionId === 'string' ? sessionId : '';
    const allSessions = this.allSessionsEnabled();
    const directories = this.db.prepare(`
      SELECT d.*,
        (SELECT COUNT(*) FROM memories m WHERE m.directory_id = d.id) AS memory_count,
        (SELECT COUNT(*) FROM memories m WHERE m.directory_id = d.id AND m.status = 'active') AS active_memory_count,
        (SELECT enabled FROM memory_session_directories s WHERE s.session_id = ? AND s.directory_id = d.id) AS manual_enabled
      FROM memory_directories d
      ORDER BY CASE d.name WHEN 'default' THEN 0 ELSE 1 END, d.updated_at DESC, lower(d.name) ASC
    `).all(sid).map((row) => {
      const allSessionsForSession = allSessions && row.name === DEFAULT_MEMORY_DIRECTORY_NAME;
      const manualEnabled = allSessionsForSession || Number(row.manual_enabled) === 1;
      return {
        id: row.id,
        name: row.name,
        remark: normalizeDirectoryRemark(row.remark),
        autoForSession: false,
        allSessionsForSession,
        manualEnabled,
        enabledForSession: manualEnabled,
        memoryCount: Number(row.memory_count) || 0,
        activeMemoryCount: Number(row.active_memory_count) || 0,
        protected: PROTECTED_MEMORY_DIRECTORY_NAMES.has(row.name),
        createdAt: Number(row.created_at) || 0,
        updatedAt: Number(row.updated_at) || 0
      };
    });
    const presetTagOrder = new Map(MEMORY_PRESET_TAGS.map((tag, index) => [tag, index]));
    const tags = this.db.prepare('SELECT id, name, preset, status, created_at, updated_at FROM memory_tags').all().map((row) => ({
      id: row.id,
      name: row.name,
      preset: row.preset === 1,
      status: row.preset === 1 ? 'active' : normalizeStatus(row.status, 'active'),
      createdAt: Number(row.created_at) || 0,
      updatedAt: Number(row.updated_at) || 0
    })).sort((left, right) => {
      if (left.preset !== right.preset) return left.preset ? -1 : 1;
      if (left.preset && right.preset) return (presetTagOrder.get(left.name) ?? 999) - (presetTagOrder.get(right.name) ?? 999);
      if (left.status !== right.status) return left.status === 'active' ? -1 : 1;
      return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
    });
    const activeTagIdByName = new Map(tags.filter((tag) => tag.status === 'active').map((tag) => [tag.name, tag.id]));
    const persistedRows = this.db.prepare(`
      SELECT m.*, d.name AS directory_name,
        COALESCE((SELECT GROUP_CONCAT(t.id, char(31)) FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active'), '') AS tag_ids,
        COALESCE((SELECT GROUP_CONCAT(t.name, char(31)) FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active'), '') AS tag_names
      FROM memories m JOIN memory_directories d ON d.id = m.directory_id
      ORDER BY m.updated_at DESC
      LIMIT ?
    `).all(MAX_SNAPSHOT_MEMORIES);
    const memories = persistedRows.map((row) => memoryFromRow(row, true));
    for (const item of this.ephemeral.values()) {
      memories.push({
        id: item.id,
        persisted: false,
        text: item.text,
        status: normalizeStatus(item.status),
        directoryId: item.directoryId ?? null,
        directoryName: item.directoryName ?? null,
        tagIds: item.tags.map((tag) => activeTagIdByName.get(tag)).filter(Boolean),
        tags: item.tags.filter((tag) => activeTagIdByName.has(tag)),
        sourceSessionId: item.sourceSessionId,
        sourceSessionTitle: item.sourceSessionTitle,
        sourceTurn: item.sourceTurn,
        distillUsage: item.distillUsage,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        lastRecalledAt: item.lastRecalledAt ?? 0,
        creationMethod: normalizeCreationMethod(item.creationMethod)
      });
    }
    memories.sort((left, right) => right.updatedAt - left.updatedAt || String(left.id).localeCompare(String(right.id)));
    return {
      dbPath: this.dbPath,
      ftsEnabled: this.ftsAvailable,
      ftsMode: this.ftsMode,
      bm25Enabled: this.ftsAvailable,
      presetTags: MEMORY_PRESET_TAGS,
      autoDistillEnabled: this.autoDistillEnabled(),
      allSessionsDirectoryEnabled: allSessions,
      firstTurnAutoMatchEnabled: this.autoMatchEnabled(),
      distillModelOverride: this.distillModelOverride() ?? null,
      sessionId: sid,
      directories,
      tags,
      memories
    };
  }

  ensureDirectory(name, remark = '') {
    const directoryName = normalizeDirectoryName(name);
    const existing = this.db.prepare('SELECT * FROM memory_directories WHERE name = ?').get(directoryName);
    if (existing !== undefined) return existing.id;
    const stamp = now();
    const directoryId = id('dir');
    this.db.prepare('INSERT INTO memory_directories (id, name, remark, auto_session_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(directoryId, directoryName, normalizeDirectoryRemark(remark), '[]', stamp, stamp);
    return directoryId;
  }

  createDirectory(input = {}) {
    const activity = this.beginActivity('directory_create', { sessionTitle: '', summary: activitySummaryText(input.name), triggerKind: 'manual' });
    try {
      const directoryId = this.ensureDirectory(input.name, input.remark);
      this.finishActivity(activity, 'success', { summary: activitySummaryText(this.db.prepare('SELECT name FROM memory_directories WHERE id = ?').get(directoryId)?.name || input.name) });
    } catch (error) {
      this.finishActivity(activity, 'failed', { errorCode: error?.code, errorMessage: error?.message || String(error) });
      throw error;
    }
  }

  updateDirectory(input = {}) {
    const directoryId = normalizePlainText(input.directoryId, 128);
    const existing = this.db.prepare('SELECT * FROM memory_directories WHERE id = ?').get(directoryId);
    if (existing === undefined) throw new MemoryError('directory-not-found', 'directory was not found', 404);
    if (PROTECTED_MEMORY_DIRECTORY_NAMES.has(existing.name) && input.name !== undefined && normalizeDirectoryName(input.name) !== existing.name) throw new MemoryError('default-directory-readonly', 'default project cannot be renamed', 400);
    const nextName = input.name === undefined ? existing.name : normalizeDirectoryName(input.name);
    /* remark 未提供时保持原值；提供空串即清空备注。 */
    const nextRemark = input.remark === undefined ? normalizeDirectoryRemark(existing.remark) : normalizeDirectoryRemark(input.remark);
    const renamed = nextName !== existing.name;
    const remarkChanged = nextRemark !== normalizeDirectoryRemark(existing.remark);
    const summary = renamed ? `${existing.name} → ${nextName}` : nextName;
    const activity = this.beginActivity('directory_update', { sessionTitle: '', summary: activitySummaryText(summary), triggerKind: 'manual' });
    try {
      this.db.prepare('UPDATE memory_directories SET name = ?, remark = ?, auto_session_ids = ?, updated_at = ? WHERE id = ?')
        .run(nextName, nextRemark, '[]', now(), directoryId);
      this.startFtsRebuild();
      this.finishActivity(activity, 'success', { summary: activitySummaryText(remarkChanged && !renamed ? `${summary}（备注已更新）` : summary) });
    } catch (error) {
      this.finishActivity(activity, 'failed', { errorCode: error?.code, errorMessage: error?.message || String(error) });
      throw error;
    }
  }

  deleteDirectory(input = {}) {
    const directoryId = normalizePlainText(input.directoryId, 128);
    const directory = this.db.prepare('SELECT * FROM memory_directories WHERE id = ?').get(directoryId);
    if (directory === undefined) throw new MemoryError('directory-not-found', 'directory was not found', 404);
    if (PROTECTED_MEMORY_DIRECTORY_NAMES.has(directory.name)) throw new MemoryError('default-directory-readonly', 'default project cannot be deleted', 400);
    const count = Number(this.db.prepare('SELECT COUNT(*) AS count FROM memories WHERE directory_id = ?').get(directoryId)?.count) || 0;
    if (count > 0) throw new MemoryError('directory-has-memories', 'project still has memories and cannot be deleted', 409);
    const activity = this.beginActivity('directory_delete', { sessionTitle: '', summary: activitySummaryText(directory.name), triggerKind: 'manual' });
    try {
      this.db.prepare('DELETE FROM memory_directories WHERE id = ?').run(directoryId);
      this.startFtsRebuild();
      this.finishActivity(activity, 'success');
    } catch (error) {
      this.finishActivity(activity, 'failed', { errorCode: error?.code, errorMessage: error?.message || String(error) });
      throw error;
    }
  }

  ensureTags(tagNames) {
    const names = uniqueStrings(tagNames, MAX_TAGS_PER_MEMORY).map(normalizeTagName).filter(Boolean);
    const stamp = now();
    const insert = this.db.prepare("INSERT OR IGNORE INTO memory_tags (id, name, preset, status, created_at, updated_at) VALUES (?, ?, 0, 'active', ?, ?)");
    for (const tag of names) insert.run(id('tag'), tag, stamp, stamp);
    if (names.length === 0) return [];
    const rows = names.map((tag) => this.db.prepare("SELECT id, name FROM memory_tags WHERE name = ? AND status = 'active'").get(tag)).filter(Boolean);
    return rows.map((row) => ({ id: row.id, name: row.name }));
  }

  createTag(input = {}) {
    const name = normalizeTagName(input.name);
    if (!name) throw new MemoryError('invalid-tag-name', 'tag name must not be empty');
    const existing = this.db.prepare("SELECT id FROM memory_tags WHERE name = ? AND status = 'active'").get(name);
    const activity = this.beginActivity('tag_create', { sessionTitle: '', summary: activitySummaryText(name), triggerKind: 'manual' });
    try {
      this.ensureTags([name]);
      this.finishActivity(activity, existing !== undefined ? 'duplicate' : 'success');
    } catch (error) {
      this.finishActivity(activity, 'failed', { errorCode: error?.code, errorMessage: error?.message || String(error) });
      throw error;
    }
  }

  setTagStatus(input = {}) {
    const tagId = normalizePlainText(input.tagId, 128);
    const row = this.db.prepare('SELECT * FROM memory_tags WHERE id = ?').get(tagId);
    if (row === undefined) throw new MemoryError('tag-not-found', 'tag was not found', 404);
    if (row.preset === 1) return;
    const nextStatus = normalizeStatus(input.status, 'active');
    const statusText = { active: '已启用', inactive: '已停用' };
    const summary = `${row.name}：${statusText[row.status] || row.status} → ${statusText[nextStatus] || nextStatus}`;
    const activity = this.beginActivity('tag_update', { sessionTitle: '', summary: activitySummaryText(summary), triggerKind: 'manual' });
    try {
      this.db.prepare('UPDATE memory_tags SET status = ?, updated_at = ? WHERE id = ?').run(nextStatus, now(), tagId);
      this.startFtsRebuild();
      this.finishActivity(activity, 'success', { summary: activitySummaryText(summary) });
    } catch (error) {
      this.finishActivity(activity, 'failed', { errorCode: error?.code, errorMessage: error?.message || String(error) });
      throw error;
    }
  }

  deleteTag(input = {}) {
    const tagId = normalizePlainText(input.tagId, 128);
    const row = this.db.prepare('SELECT * FROM memory_tags WHERE id = ?').get(tagId);
    if (row === undefined) throw new MemoryError('tag-not-found', 'tag was not found', 404);
    if (row.preset === 1) throw new MemoryError('preset-tag-readonly', 'preset tags cannot be deleted');
    const activity = this.beginActivity('tag_delete', { sessionTitle: '', summary: activitySummaryText(row.name), triggerKind: 'manual' });
    try {
      this.db.prepare('DELETE FROM memory_tags WHERE id = ?').run(tagId);
      this.startFtsRebuild();
      this.finishActivity(activity, 'success');
    } catch (error) {
      this.finishActivity(activity, 'failed', { errorCode: error?.code, errorMessage: error?.message || String(error) });
      throw error;
    }
  }

  setMemoryTags(memoryId, tagNames) {
    const tags = this.ensureTags(tagNames);
    this.db.prepare('DELETE FROM memory_tag_links WHERE memory_id = ?').run(memoryId);
    const insert = this.db.prepare('INSERT OR IGNORE INTO memory_tag_links (memory_id, tag_id) VALUES (?, ?)');
    for (const tag of tags.slice(0, MAX_TAGS_PER_MEMORY)) insert.run(memoryId, tag.id);
  }

  persistentByHash(hash) {
    return this.db.prepare('SELECT id FROM memories WHERE content_hash = ?').get(hash)?.id;
  }

  addEphemeralMemory({ text, tags, session, sourceTurn, distillUsage, directoryId, creationMethod }) {
    const body = normalizePlainText(text, Number.MAX_SAFE_INTEGER);
    if (body.length < 6) return { status: 'skipped', reason: 'memory-too-short' };
    const hash = memoryHash(body);
    const persistentId = this.persistentByHash(hash);
    if (persistentId !== undefined) return { status: 'duplicate', memoryId: persistentId };
    for (const item of this.ephemeral.values()) {
      if (item.hash === hash) {
        item.updatedAt = now();
        const distilled = normalizeTokenUsage(distillUsage);
        if (distilled !== undefined) item.distillUsage = distilled;
        if (!item.creationMethod) item.creationMethod = normalizeCreationMethod(creationMethod);
        if (Number.isSafeInteger(sourceTurn)) item.sourceTurn = sourceTurn;
        return { status: 'duplicate', memoryId: item.id };
      }
    }
    const stamp = now();
    const resolvedDirectoryId = directoryId ? this.resolveToolDirectoryId({ directoryId }, String(session.id), body) : this.resolveToolDirectoryId({}, String(session.id), body);
    const directory = this.db.prepare('SELECT id, name FROM memory_directories WHERE id = ?').get(resolvedDirectoryId);
    const item = {
      id: id('mem'),
      text: body,
      tags: normalizeTagNames(tags, body),
      status: structuredMemoryText(body) ? 'active' : 'inactive',
      directoryId: directory?.id ?? null,
      directoryName: directory?.name ?? null,
      hash,
      sourceSessionId: String(session.id),
      sourceSessionTitle: sessionTitle(session),
      sourceTurn: Number.isSafeInteger(sourceTurn) ? sourceTurn : undefined,
       creationMethod: normalizeCreationMethod(creationMethod),
      distillUsage: normalizeTokenUsage(distillUsage),
      createdAt: stamp,
      updatedAt: stamp,
      lastRecalledAt: 0
    };
    this.ephemeral.set(item.id, item);
    return { status: 'created', memoryId: item.id, directoryId: item.directoryId ?? null };
  }

  createMemory(input = {}, options = {}) {
    const activity = options.logActivity === true ? this.beginActivity('memory_add', { sessionId: '', sessionTitle: '', summary: activitySummaryText(input.text), triggerKind: 'manual' }) : null;
    try {
      const directoryId = normalizePlainText(input.directoryId, 128);
      const directory = this.db.prepare('SELECT id FROM memory_directories WHERE id = ?').get(directoryId);
      if (directory === undefined) throw new MemoryError('directory-not-found', 'directory was not found', 404);
      const body = normalizeMemoryBodyForWrite(input.text);
      if (body.length < 6) throw new MemoryError('invalid-memory-text', 'memory text must not be empty');
      const hash = memoryHash(body);
      const duplicate = this.persistentByHash(hash);
      if (duplicate !== undefined) {
        this.finishActivity(activity, 'duplicate', { memoryId: duplicate, summary: activitySummaryText(body) });
        return duplicate;
      }
      const stamp = now();
      const persistentId = id('mem');
      /* UI 手动新建默认 manual；仅供未来导入入口以 options.creationMethod 显式标记 import。 */
      const creationMethod = normalizeCreationMethod(options.creationMethod) || 'manual';
      this.db.prepare('INSERT INTO memories (id, directory_id, body, status, content_hash, creation_method, created_at, updated_at, last_recalled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)')
        .run(persistentId, directoryId, body, normalizeStatus(input.status, 'active'), hash, creationMethod, stamp, stamp);
      this.setMemoryTags(persistentId, Array.isArray(input.tagNames) ? input.tagNames : []);
      this.reindexMemory(persistentId);
      this.finishActivity(activity, 'success', { memoryId: persistentId, summary: activitySummaryText(body) });
      return persistentId;
    } catch (error) {
      this.finishActivity(activity, 'failed', { errorCode: error?.code, errorMessage: error?.message || String(error) });
      throw error;
    }
  }

  persistMemory(input = {}, options = {}) {
    const activity = options.logActivity === true ? this.beginActivity('memory_add', { sessionId: '', sessionTitle: '', summary: activitySummaryText(input.text), triggerKind: 'manual' }) : null;
    try {
      const memoryId = normalizePlainText(input.memoryId, 128);
      const item = this.ephemeral.get(memoryId);
      if (item === undefined) throw new MemoryError('ephemeral-memory-not-found', 'ephemeral memory was not found', 404);
      if (activity !== null) {
        activity.sessionId = String(item.sourceSessionId || '');
        activity.sessionTitle = String(item.sourceSessionTitle || '');
      }
      const body = normalizeMemoryBodyForWrite(input.text ?? item.text);
      if (body.length < 6) throw new MemoryError('invalid-memory-text', 'memory text must not be empty');
      const directoryId = input.directoryId ? normalizePlainText(input.directoryId, 128) : this.resolveToolDirectoryId(input, item.sourceSessionId, body);
      const directory = this.db.prepare('SELECT id FROM memory_directories WHERE id = ?').get(directoryId);
      if (directory === undefined) throw new MemoryError('directory-not-found', 'directory was not found', 404);
      const hash = memoryHash(body);
      const duplicate = this.persistentByHash(hash);
      if (duplicate !== undefined) {
        this.ephemeral.delete(memoryId);
        this.finishActivity(activity, 'duplicate', { memoryId: duplicate, summary: activitySummaryText(body) });
        return duplicate;
      }
      const tagNames = Array.isArray(input.tagNames) ? input.tagNames : item.tags;
      const stamp = now();
      const persistentId = id('mem');
      /* 临时记忆转正：创建方式与 last_recalled_at 均随迁，保留最初来源。 */
      this.db.prepare('INSERT INTO memories (id, directory_id, body, status, content_hash, creation_method, created_at, updated_at, last_recalled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(persistentId, directoryId, body, normalizeStatus(input.status, 'active'), hash, normalizeCreationMethod(item.creationMethod), stamp, stamp, Number(item.lastRecalledAt) || 0);
      this.setMemoryTags(persistentId, tagNames);
      this.reindexMemory(persistentId);
      /* 蒸馏记忆转正：用量行的 memory_id 回填为持久化 id（原为临时 id） */
      try {
        this.db.prepare("UPDATE memory_token_usage SET memory_id = ? WHERE memory_id = ? AND kind IN ('auto-distill', 'manual-distill')").run(persistentId, memoryId);
      } catch (error) {
        this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory token usage relink failed:`, error);
      }
      this.ephemeral.delete(memoryId);
      this.finishActivity(activity, 'success', { memoryId: persistentId, summary: activitySummaryText(body) });
      return persistentId;
    } catch (error) {
      this.finishActivity(activity, 'failed', { errorCode: error?.code, errorMessage: error?.message || String(error) });
      throw error;
    }
  }

  updateMemory(input = {}, options = {}) {
    const memoryId = normalizePlainText(input.memoryId, 128);
    const ephemeral = this.ephemeral.get(memoryId);
    const manualActivity = options.logActivity === true ? this.beginActivity('memory_update', { memoryId, sessionId: ephemeral !== undefined ? String(ephemeral.sourceSessionId || '') : '', sessionTitle: ephemeral !== undefined ? String(ephemeral.sourceSessionTitle || '') : options.sessionTitle || '', summary: '' }) : null;
    if (ephemeral !== undefined) {
      try {
        if (input.text !== undefined) {
          const text = normalizeMemoryBodyForWrite(input.text);
          if (text.length < 6) throw new MemoryError('invalid-memory-text', 'memory text must not be empty');
          ephemeral.text = text;
          ephemeral.hash = memoryHash(text);
        }
        if (input.status !== undefined) ephemeral.status = normalizeStatus(input.status, ephemeral.status);
        if (Array.isArray(input.tagNames)) ephemeral.tags = uniqueStrings(input.tagNames, MAX_TAGS_PER_MEMORY).map(normalizeTagName).filter(Boolean);
        ephemeral.updatedAt = now();
        this.finishActivity(manualActivity, 'success', { memoryId, summary: activitySummaryText(ephemeral.text || '') });
      } catch (error) {
        this.finishActivity(manualActivity, 'failed', { memoryId, errorCode: error?.code, errorMessage: error?.message || String(error) });
        throw error;
      }
      return;
    }
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(memoryId);
    if (row === undefined) {
      this.finishActivity(manualActivity, 'failed', { memoryId, errorCode: 'memory-not-found', errorMessage: 'memory was not found' });
      throw new MemoryError('memory-not-found', 'memory was not found', 404);
    }
    try {
      const body = input.text === undefined ? row.body : normalizeMemoryBodyForWrite(input.text);
      if (body.length < 6) throw new MemoryError('invalid-memory-text', 'memory text must not be empty');
      const hash = memoryHash(body);
      const duplicate = this.persistentByHash(hash);
      if (duplicate !== undefined && duplicate !== memoryId) throw new MemoryError('duplicate-memory', 'a memory with the same text already exists', 409);
      const directoryId = input.directoryId === undefined ? row.directory_id : normalizePlainText(input.directoryId, 128);
      if (this.db.prepare('SELECT id FROM memory_directories WHERE id = ?').get(directoryId) === undefined) throw new MemoryError('directory-not-found', 'directory was not found', 404);
      const status = normalizeStatus(input.status, row.status);
      this.db.prepare('UPDATE memories SET directory_id = ?, body = ?, status = ?, content_hash = ?, updated_at = ? WHERE id = ?')
        .run(directoryId, body, status, hash, now(), memoryId);
      if (Array.isArray(input.tagNames)) this.setMemoryTags(memoryId, input.tagNames);
      this.reindexMemory(memoryId);
      this.finishActivity(manualActivity, 'success', { memoryId, summary: activitySummaryText(body) });
    } catch (error) {
      this.finishActivity(manualActivity, 'failed', { memoryId, errorCode: error?.code, errorMessage: error?.message || String(error) });
      throw error;
    }
  }

  deleteMemory(input = {}) {
    const memoryId = normalizePlainText(input.memoryId, 128);
    const ephemeral = this.ephemeral.get(memoryId);
    if (ephemeral !== undefined) {
      const activity = this.beginActivity('memory_delete', { memoryId, sessionId: String(ephemeral.sourceSessionId || ''), sessionTitle: String(ephemeral.sourceSessionTitle || ''), summary: activitySummaryText(ephemeral.text || ''), triggerKind: 'manual' });
      try {
        this.ephemeral.delete(memoryId);
        this.finishActivity(activity, 'success');
      } catch (error) {
        this.finishActivity(activity, 'failed', { errorCode: error?.code, errorMessage: error?.message || String(error) });
        throw error;
      }
      return;
    }
    const old = this.db.prepare('SELECT m.id, m.body, d.name AS directory_name FROM memories m LEFT JOIN memory_directories d ON d.id = m.directory_id WHERE m.id = ?').get(memoryId);
    if (old === undefined) return;
    const activity = this.beginActivity('memory_delete', { memoryId, sessionTitle: '', summary: activitySummaryText(old.body || ''), triggerKind: 'manual' });
    try {
      this.db.prepare('DELETE FROM memories WHERE id = ?').run(memoryId);
      if (this.ftsRebuilding) {
        this.ftsPendingOps.set(memoryId, 'delete');
      } else if (this.ftsAvailable) {
        try { this.db.prepare('DELETE FROM memory_fts WHERE id = ?').run(memoryId); }
        catch { this.startFtsRebuild(); }
      }
      this.finishActivity(activity, 'success', { memoryId, summary: activitySummaryText(old.body || '') });
    } catch (error) {
      this.finishActivity(activity, 'failed', { memoryId, errorCode: error?.code, errorMessage: error?.message || String(error) });
      throw error;
    }
  }

  setSessionDirectory(input = {}) {
    const sessionId = normalizePlainText(input.sessionId, 128);
    if (!SESSION_ID_RE.test(sessionId)) throw new MemoryError('invalid-session-id', 'sessionId is invalid');
    const directoryId = normalizePlainText(input.directoryId, 128);
    const directory = this.db.prepare('SELECT id, name FROM memory_directories WHERE id = ?').get(directoryId);
    if (directory === undefined) throw new MemoryError('directory-not-found', 'directory was not found', 404);
    if (directory.name === DEFAULT_MEMORY_DIRECTORY_NAME && this.allSessionsEnabled() && input.enabled !== true) return;
    if (input.enabled === true) {
      const stamp = now();
      this.db.prepare(`
        INSERT INTO memory_session_directories (session_id, directory_id, enabled, created_at, updated_at)
        VALUES (?, ?, 1, ?, ?)
        ON CONFLICT(session_id, directory_id) DO UPDATE SET enabled = 1, updated_at = excluded.updated_at
      `).run(sessionId, directoryId, stamp, stamp);
    } else {
      this.db.prepare('DELETE FROM memory_session_directories WHERE session_id = ? AND directory_id = ?').run(sessionId, directoryId);
    }
  }

  enabledDirectoryIds(sessionId) {
    const sid = String(sessionId ?? '');
    if (!sid) return [];
    const allSessions = this.allSessionsEnabled();
    const rows = this.db.prepare(`
      SELECT d.id, d.name,
        (SELECT enabled FROM memory_session_directories s WHERE s.session_id = ? AND s.directory_id = d.id) AS manual_enabled
      FROM memory_directories d
    `).all(sid);
    return rows.filter((row) => (allSessions && row.name === DEFAULT_MEMORY_DIRECTORY_NAME) || Number(row.manual_enabled) === 1).map((row) => row.id);
  }

  customTagCandidateRows(directoryIds, customContext, options = {}) {
    if (!Array.isArray(directoryIds) || directoryIds.length === 0 || !customTagContextHasQuery(customContext)) return [];
    const matchedTags = this.db.prepare("SELECT id, name FROM memory_tags WHERE preset = 0 AND status = 'active'").all()
      .map((row) => ({ ...row, match_weight: customTagNameWeight(row.name, customContext) }))
      .filter((row) => row.match_weight > 0)
      .sort((left, right) => right.match_weight - left.match_weight || String(left.name).localeCompare(String(right.name)))
      .slice(0, CUSTOM_TAG_MAX_MATCHES);
    if (matchedTags.length === 0) return [];
    const directoryPlaceholders = directoryIds.map(() => '?').join(', ');
    const tagPlaceholders = matchedTags.map(() => '?').join(', ');
    const status = normalizePlainText(options.status, 16);
    const statusSql = status && status !== 'all' ? 'AND m.status = ?' : '';
    const statusArgs = status && status !== 'all' ? [normalizeStatus(status, 'active')] : [];
    const timeRange = options.timeRange;
    const timeSql = timeRange !== undefined ? 'AND ((m.created_at >= ? AND m.created_at < ?) OR (m.updated_at >= ? AND m.updated_at < ?))' : '';
    const timeArgs = timeRange !== undefined ? [timeRange.start, timeRange.end, timeRange.start, timeRange.end] : [];
    return this.db.prepare(`
      SELECT m.*, d.name AS directory_name,
        COALESCE((SELECT GROUP_CONCAT(t.id, char(31)) FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active'), '') AS tag_ids,
        COALESCE((SELECT GROUP_CONCAT(t.name, char(31)) FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active'), '') AS tag_names,
        0 AS rank
      FROM memories m JOIN memory_directories d ON d.id = m.directory_id
      WHERE m.directory_id IN (${directoryPlaceholders}) ${statusSql} ${timeSql}
        AND EXISTS (SELECT 1 FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active' AND l.tag_id IN (${tagPlaceholders}))
    `).all(...directoryIds, ...statusArgs, ...timeArgs, ...matchedTags.map((row) => row.id));
  }

  /* 段1 底色候选：按第一档标签名无条件拉取已启用目录下的永久记忆，不经过 FTS 字面命中
     与查询相关性准入。理由：底色记忆的身份已由「目录（项目）归属 + 第一档标签」两者确认，
     段1 席位（5）独立于其它段，数量通常远小于席位；再叠加相关性筛选会把已确认归属的
     记忆误挡在场外（FTS 只匹配 tokens/tags/directory 三列，正文不参与，易漏召）。
     返回行 rank=0（无 BM25 信息），段1 竞争仍按结构分/画像分/时间分排序。 */
  bottomTagCandidateRows(directoryIds, activeTagNames, options = {}) {
    if (!Array.isArray(directoryIds) || directoryIds.length === 0) return [];
    const names = [...STABLE_TIER1_TAGS].filter((name) => activeTagNames.has(name));
    if (names.length === 0) return [];
    const directoryPlaceholders = directoryIds.map(() => '?').join(', ');
    const tagPlaceholders = names.map(() => '?').join(', ');
    const status = normalizePlainText(options.status, 16);
    const statusSql = status && status !== 'all' ? 'AND m.status = ?' : '';
    const statusArgs = status && status !== 'all' ? [normalizeStatus(status, 'active')] : [];
    return this.db.prepare(`
      SELECT m.*, d.name AS directory_name,
        COALESCE((SELECT GROUP_CONCAT(t.id, char(31)) FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active'), '') AS tag_ids,
        COALESCE((SELECT GROUP_CONCAT(t.name, char(31)) FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active'), '') AS tag_names,
        0 AS rank
      FROM memories m JOIN memory_directories d ON d.id = m.directory_id
      WHERE m.directory_id IN (${directoryPlaceholders}) ${statusSql}
        AND EXISTS (SELECT 1 FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active' AND t.name IN (${tagPlaceholders}))
    `).all(...directoryIds, ...statusArgs, ...names);
  }

  /* v9 出窗判定：单遍扫描会话事件流，产出
     boundary = 最后一条 compaction/summary（或 compaction/end）的 seq（无压缩记录时 null）
     turnStartSeqs = Map(turn → turn/start 的 seq)
     结果按 (sessionId, 事件流规模+临时池规模) 缓存，同一轮内不重复扫描。 */
  compactionSnapshot(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return { boundary: null, turnStartSeqs: new Map() };
    const stamp = `${sessionEvents(this.ctx.sessions?.get?.(sessionId)).length}:${this.ephemeral.size}`;
    const latest = this.ephemeralBoundaryCache.get(sessionId);
    if (latest !== undefined && latest.stamp === stamp) return latest.value;
    let boundary = null;
    const turnStartSeqs = new Map();
    try {
      for (const event of sessionEvents(this.ctx.sessions?.get?.(sessionId))) {
        if (event?.type === 'compaction/summary' || event?.type === 'compaction/end') {
          const seq = Number(event.seq);
          if (Number.isSafeInteger(seq)) boundary = boundary === null ? seq : Math.max(boundary, seq);
        } else if (event?.type === 'turn/start' && Number.isSafeInteger(event.data?.turn)) {
          const turn = event.data.turn;
          if (!turnStartSeqs.has(turn)) turnStartSeqs.set(turn, Number(event.seq));
        }
      }
    } catch {
      boundary = null;
      turnStartSeqs.clear();
    }
    const value = { boundary, turnStartSeqs };
    this.ephemeralBoundaryCache.set(sessionId, { stamp, value });
    return value;
  }

  /* 段2 临时候选行：准入 = 跨会话临时 ∪（本会话临时 ∧ 来源轮已出窗）；本会话未出窗丢弃；
     sourceTurn 缺失或非整数直接跳过（宁漏不补）；boundary 为 null（无压缩记录）时本会话
     临时记忆整体丢弃，跨会话不受影响。限定已启用目录；与查询零相关不入场。
     最终排序交给统一的段竞争（rankRowsBySegment），此处只做准入与候选行构建。 */
  ephemeralSegmentRows(sessionId, enabledSet, terms, customContext, profileWeights, allowProfileTagFallback, activeTagNames) {
    const { boundary, turnStartSeqs } = this.compactionSnapshot(sessionId);
    const rows = [];
    for (const item of this.ephemeral.values()) {
      if (item.status !== 'active' || !item.directoryId || !enabledSet.has(item.directoryId)) continue;
      const isCrossSession = sessionId.length === 0 || item.sourceSessionId !== sessionId;
      if (!isCrossSession) {
        /* 本会话临时：来源轮已出窗才准入（未出窗 = 与对话历史重复） */
        if (boundary === null) continue;
        const sourceTurn = Number(item.sourceTurn);
        if (!Number.isSafeInteger(sourceTurn)) continue;
        const turnStartSeq = turnStartSeqs.get(sourceTurn);
        if (turnStartSeq === undefined || turnStartSeq >= boundary) continue;
      }
      const row = ephemeralRecallRow({ ...item, tags: Array.isArray(item.tags) ? item.tags.filter((tag) => activeTagNames.has(tag)) : [] }, terms);
      if (!(row.rank < 0 || customTagWeightForRow(row, customContext) > 0 || (allowProfileTagFallback && tagWeightForRow(row, profileWeights) > 0))) continue;
      rows.push(row);
    }
    return rows;
  }

  recall(sessionId, queryText, options = {}) {
    /* v9 四段式注入：
       段1 底色 top-5（第一档标签的永久记忆，final_rank 内部竞争）
       段2 临时 top-5（不可见上下文补偿通道：跨会话 + 本会话已出窗，final_rank 竞争）
       段3 混合 top-5（底色剩余 + 非底色永久，final_rank 竞争）
       段4 纯永久兜底 5~15（仅非底色永久剩余；席位 = 固定5 + 段1/2/3 全部缺口）
       候选充足时总注入恒 20。 */
    const startedAt = now();
    const sessionIdText = String(sessionId ?? '');
    const deadline = startedAt + (options.timeBudgetMs ?? RECALL_TIME_BUDGET_MS);
    const enabled = this.enabledDirectoryIds(sessionId);
    if (enabled.length === 0 || now() > deadline) return [];
    const profile = options.profile ?? detectRecallProfile(queryText);
    const terms = extractSearchTerms(queryText);
    const profileTags = recallProfileTags(profile);
    if (terms.length === 0 && profileTags.length === 0) return [];
    const placeholders = enabled.map(() => '?').join(', ');
    const maxItems = options.maxItems ?? RECALL_MAX_ITEMS;
    const customContext = customTagMatchContext(queryText);
    const profileWeights = recallProfileWeights(profile);
    const allowProfileTagFallback = profileAllowsTagFallback(profile);
    const enabledSet = new Set(enabled);
    const activeTagNames = new Set(this.db.prepare("SELECT name FROM memory_tags WHERE status = 'active'").all().map((row) => row.name).filter(Boolean));
    const ephemeralRows = this.ephemeralSegmentRows(sessionIdText, enabledSet, terms, customContext, profileWeights, allowProfileTagFallback, activeTagNames);
    let customRows;
    const getCustomRows = () => {
      if (customRows === undefined) customRows = now() > deadline ? [] : this.customTagCandidateRows(enabled, customContext, { status: 'active' });
      return customRows;
    };
    /* 底色直取：段1 的身份确认通道，绕过 FTS 与相关性准入（见 bottomTagCandidateRows 注释） */
    let bottomCandidateRows;
    const getBottomRows = () => {
      if (bottomCandidateRows === undefined) bottomCandidateRows = now() > deadline ? [] : this.bottomTagCandidateRows(enabled, activeTagNames, { status: 'active' });
      return bottomCandidateRows;
    };
    /* 候选收集：FTS 主路 + LIKE 兜底路，不截断——全部候选进入统一三池划分后按段竞争 */
    let permanentRows = [];
    if (this.ftsAvailable) {
      const query = ftsQuery(queryText);
      if (query) {
        try {
          permanentRows = this.db.prepare(`
            SELECT m.*, d.name AS directory_name,
              COALESCE((SELECT GROUP_CONCAT(t.id, char(31)) FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active'), '') AS tag_ids,
              COALESCE((SELECT GROUP_CONCAT(t.name, char(31)) FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active'), '') AS tag_names,
              bm25(memory_fts) AS rank
            FROM memory_fts JOIN memories m ON memory_fts.id = m.id JOIN memory_directories d ON d.id = m.directory_id
            WHERE memory_fts MATCH ? AND m.status = 'active' AND m.directory_id IN (${placeholders})
            ORDER BY rank ASC
          `).all(query, ...enabled);
        } catch (error) {
          this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory FTS recall failed; using LIKE fallback:`, error);
          permanentRows = [];
        }
      }
    }
    if (permanentRows.length === 0 && now() <= deadline) {
      const rows = this.db.prepare(`
        SELECT m.*, d.name AS directory_name,
          COALESCE((SELECT GROUP_CONCAT(t.id, char(31)) FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active'), '') AS tag_ids,
          COALESCE((SELECT GROUP_CONCAT(t.name, char(31)) FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active'), '') AS tag_names,
          0 AS rank
        FROM memories m JOIN memory_directories d ON d.id = m.directory_id
        WHERE m.status = 'active' AND m.directory_id IN (${placeholders})
      `).all(...enabled)
        .map((row) => ({ ...row, rank: -scoreFallback(row, terms) }));
      permanentRows = rows.filter((row) => rowMatchesQueryFn(row, customContext, profileWeights, allowProfileTagFallback));
    }
    permanentRows = mergeRecallRows(permanentRows, getCustomRows(), getBottomRows());
    /* 三池划分 */
    const bottomPool = [];
    const regularPool = [];
    const seen = new Set();
    for (const row of permanentRows) {
      const id = normalizePlainText(row?.id, 128);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      if (rowTagNames(row).some((tag) => STABLE_TIER1_TAGS.has(tag))) bottomPool.push(row);
      else regularPool.push(row);
    }
    /* 四段构建：每段用本段矩阵竞争选拔 */
    const segment = (poolRows, segmentKey, count) => rankRowsBySegment(poolRows, segmentKey, profile, startedAt, customContext).slice(0, count).map((entry) => entry.row);
    const bottomCount = Math.min(RECALL_SEGMENT_ITEMS, bottomPool.length);
    const bottomRows = segment(bottomPool, 'bottom', bottomCount);
    const ephemeralCount = Math.min(EPHEMERAL_RECALL_ITEMS, ephemeralRows.length);
    const ephemeralSelected = ephemeralCount > 0 ? segment(ephemeralRows, 'ephemeral', ephemeralCount) : [];
    const bottomSet = new Set(bottomRows.map((row) => normalizePlainText(row.id, 128)));
    const mixedPool = [
      ...bottomPool.filter((row) => !bottomSet.has(normalizePlainText(row.id, 128))),
      ...regularPool
    ];
    const mixedCount = Math.min(RECALL_SEGMENT_ITEMS, mixedPool.length);
    const mixedRows = segment(mixedPool, 'mixed', mixedCount);
    const mixedSet = new Set(mixedRows.map((row) => normalizePlainText(row.id, 128)));
    const fallbackCount = RECALL_MAX_ITEMS - bottomRows.length - ephemeralSelected.length - mixedRows.length;
    const fallbackPool = regularPool.filter((row) => !mixedSet.has(normalizePlainText(row.id, 128)));
    const fallbackRows = segment(fallbackPool, 'fallback', fallbackCount);
    const combined = [...bottomRows, ...ephemeralSelected, ...mixedRows, ...fallbackRows];
    if (now() > deadline || combined.length === 0) return [];
    return packHits(combined, maxItems);
  }

  async distillTurn(session, turn, modelSelection, triggerKind = 'manual') {
    const rows = turnTranscript(session, turn);
    const firstUserText = rows.find((row) => row.role === '用户')?.text || '';
    const activity = this.beginActivity('distill', { sessionId: String(session?.id ?? ''), sessionTitle: sessionTitle(session), turn, summary: activitySummaryText(firstUserText), triggerKind });
    try {
      const result = await this.distillTurnCore(session, turn, modelSelection, triggerKind);
      const outcome = result?.status === 'created' ? 'success' : result?.status === 'duplicate' ? 'duplicate' : result?.status === 'skipped' ? 'skipped' : 'failed';
      this.finishActivity(activity, outcome, { memoryId: result?.memoryId, errorCode: result?.reason, errorMessage: result?.message });
      return result;
    } catch (error) {
      this.finishActivity(activity, 'failed', { errorCode: 'exception', errorMessage: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  async distillTurnCore(session, turn, modelSelection, triggerKind = 'manual') {
    const override = this.distillModelOverride();
    const primary = override ?? modelSelection;
    const primaryResult = await this.distillTurnAttempt(session, turn, primary, triggerKind);
    const retryable = override !== undefined && primary === override && (primaryResult.status === 'failed' || primaryResult.status === 'skipped' && primaryResult.reason === 'no-usable-output');
    if (!retryable) return primaryResult;
    const fallback = routeForDistill(this.ctx.agents?.get?.(session.id), session, modelSelection);
    if (fallback === undefined || (fallback.provider === override.provider && fallback.model === override.model && fallback.reasoningEffort === override.reasoningEffort)) return { ...primaryResult, retry: { attempted: false, reason: 'same-route' } };
    const fallbackResult = await this.distillTurnAttempt(session, turn, fallback, triggerKind);
    return { ...fallbackResult, retry: { attempted: true, kind: 'default', outcome: fallbackResult.status === 'created' || fallbackResult.status === 'duplicate' ? 'success' : 'failed' } };
  }

  async distillTurnAttempt(session, turn, modelSelection, triggerKind = 'manual') {
    const rows = turnTranscript(session, turn);
    const context = { sessionId: String(session?.id ?? ''), turn, rows: rows.length };
    if (!rows.some((row) => row.role === '用户') || rows.length === 0) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory distill skipped: no user transcript ${JSON.stringify(context)}`);
      return { status: 'skipped', reason: 'no-user-transcript', turn };
    }
    const transcriptText = truncateMiddle(renderTranscript(rows), MAX_DISTILL_INPUT_CHARS);
    context.transcriptLength = transcriptText.length;
    if (transcriptText.length < 20) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory distill skipped: transcript too short ${JSON.stringify(context)}`);
      return { status: 'skipped', reason: 'transcript-too-short', turn };
    }
    const agent = this.ctx.agents?.get?.(session.id);
    const route = routeForDistill(agent, session, modelSelection);
    if (route === undefined) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory distill skipped: no provider/model route ${JSON.stringify(context)}`);
      return { status: 'skipped', reason: 'no-route', turn };
    }
    context.route = route;
    this.ctx.logger?.info?.(`[${PLUGIN_NAME}] memory distill started ${JSON.stringify(context)}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('memory distillation timeout')), DISTILL_TIMEOUT_MS);
    try {
      const prompt = [
        '你是 dsh-session-kit 的本地记忆蒸馏器。请只从下面这一轮对话中提取一条对未来对话长期有用的记忆正文。',
        '要求：',
        '- 只保留稳定事实、用户偏好、项目场景、项目约束、项目架构、模块约束、接口、路径、函数、组件、类名、工作项目或日常生活信息。',
        '- 只输出记忆正文 JSON，不要输出 tags、memory、confidence 等记忆对象字段；标签会由程序根据正文自动分类。',
        '- JSON 固定格式：{"位置":["文件或项目路径"],"对象":["函数/组件/类名/接口名/API action/CSS class/事件/slot/hook"],"内容":"做了什么/约束/摘要/偏好","踩坑":"实际踩过的坑；没有则为空字符串"}；也接受 paths/symbols/content/pitfall 英文 key。',
        '- paths 用于文件路径、项目路径、模块路径；没有则输出空数组。',
        '- symbols 用于函数、组件、类名、接口名、API action、CSS class、事件、slot、hook、配置项、数据库表等；没有则输出空数组。',
        '- content 必须是一条简洁中文正文，说明做了什么、约束、摘要或偏好。',
        '- pitfall 只记录本轮真实发生过的排查失败、反直觉问题、容易重复踩的踩坑；没有实际踩坑过程时必须输出空字符串，不得猜测。',
        '- 代码/项目类记忆最终按规范 JSON 保存；未知字段可以保留，内容和踩坑允许使用换行。',
        '- 禁止写入源码行号（如 Line 289、第 289 行、client.js:289）；使用函数名、类名、字典键、CSS 选择器等稳定符号定位。',
        '- 禁止写入验证/完成证明段落（如 node --check 通过、烟测 43/43 通过）；这些不是长期知识。',
        '- 如果涉及代码修改、排查、UI 组件或接口，必须尽量填写 paths 和 symbols；只有本轮确实没有具体对象时才留空。',
        '- 不要记录一次性寒暄、临时状态、敏感密钥、无用过程。',
        '- 如果没有值得记忆的内容，输出 {"paths":[],"symbols":[],"content":""}。',
        '- 输出严格 JSON，不要 Markdown。',
        '',
        '会话：',
        `- ID: ${String(session.id)}`,
        `- 名称: ${sessionTitle(session)}`,
        '',
        '本轮对话：',
        transcriptText
      ].join('\n');
      const messages = [createUserMessage({
        content: [{ type: 'text', text: prompt }],
        source: { kind: 'plugin', plugin: PLUGIN_NAME, form: 'notice', summary: 'memory distill' }
      })];
      const assembler = new BlockAssembler();
      for await (const chunk of this.ctx.llm.stream({
        provider: route.provider,
        model: route.model,
        messages,
        maxTokens: DISTILL_MAX_OUTPUT_TOKENS,
        ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort }),
        sessionId: session.id,
        purpose: 'memory-distill',
        signal: controller.signal
      })) {
        controller.signal.throwIfAborted();
        assembler.push(chunk);
      }
      const blocks = assembler.blocks();
      const finish = assembler.finish ?? { kind: 'stop' };
      const blockTypes = blocks.map((block) => block.type);
      context.blockTypes = blockTypes;
      context.finish = finish.kind;
      if (finish.kind === 'error' || finish.kind === 'aborted') {
        const failureMessage = finish.failure?.message || `LLM stream finished with ${finish.kind}`;
        this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory distillation terminal failure ${JSON.stringify({ ...context, message: failureMessage, code: finish.failure?.code })}`);
        return { status: 'failed', reason: finish.kind === 'aborted' ? 'timeout' : 'llm-error', message: failureMessage, turn };
      }
      const textBlocks = blocks.filter((block) => block.type === 'text').map((block) => block.text).filter(Boolean);
      const reasoningBlocks = blocks.filter((block) => block.type === 'reasoning').map((block) => block.text).filter(Boolean);
      const output = (textBlocks.length > 0 ? textBlocks : reasoningBlocks).join('\n').trim();
      context.outputLength = output.length;
      this.ctx.logger?.info?.(`[${PLUGIN_NAME}] memory distillation output ${JSON.stringify({ ...context, textBlockCount: textBlocks.length, reasoningBlockCount: reasoningBlocks.length })}`);
      const distilled = parseDistillation(output, transcriptText);
      if (distilled === undefined) {
        this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory distill produced no usable memory ${JSON.stringify(context)}`);
        return { status: 'skipped', reason: 'no-usable-output', turn };
      }
      const distillUsage = normalizeTokenUsage(assembler.usage) ?? estimateDistillUsage(prompt, output);
      const stored = this.addEphemeralMemory({
        text: distilled.memory,
        tags: distilled.tags,
        session,
        sourceTurn: turn,
        creationMethod: triggerKind === 'auto' ? 'auto-distill' : 'manual-distill',
        distillUsage
      });
      if (stored?.status === 'created') {
        this.recordMemoryTokenUsage({
          kind: triggerKind === 'auto' ? 'auto-distill' : 'manual-distill',
          directoryId: stored.directoryId,
          sessionId: String(session.id),
          memoryScope: 'ephemeral',
          memoryId: stored.memoryId,
          model: `${route.provider}/${route.model}`,
          reasoning: route.reasoningEffort ?? null,
          tokens: distillUsage?.totalTokens,
          createdAt: now()
        });
        this.ctx.logger?.info?.(`[${PLUGIN_NAME}] memory distilled ${JSON.stringify({ ...context, status: 'created', memoryId: stored.memoryId, chars: distilled.memory.length })}`);
        return { status: 'created', memoryId: stored.memoryId, turn };
      }
      if (stored?.status === 'duplicate') {
        this.ctx.logger?.info?.(`[${PLUGIN_NAME}] memory distill duplicate ${JSON.stringify({ ...context, status: 'duplicate', memoryId: stored.memoryId })}`);
        return { status: 'duplicate', memoryId: stored.memoryId, turn };
      }
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory distill skipped after storage ${JSON.stringify({ ...context, status: stored?.status ?? 'unknown' })}`);
      return { status: 'skipped', reason: stored?.reason ?? 'storage-skipped', turn };
    } catch (error) {
      const timedOut = controller.signal.aborted;
      const reason = timedOut ? 'timeout' : 'llm-error';
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory distillation failed (${reason}) ${JSON.stringify({ ...context, message: error instanceof Error ? error.message : String(error) })}`);
      return { status: 'failed', reason, message: error instanceof Error ? error.message : String(error), turn };
    } finally {
      clearTimeout(timeout);
    }
  }

  /** 对话自动匹配项目：每轮以输入文本对项目名/记忆内容评分，仅对新命中且未启用的项目开启会话开关（每轮至多 3 个）。 */
  autoMatchDirectories(session, directText) {
    const sessionId = String(session?.id ?? '');
    if (!sessionId || !this.autoMatchEnabled()) return [];
    const compactText = normalizeHashText(normalizeQueryIntentText(directText));
    const textTerms = autoMatchTextTerms(directText);
    if (!compactText && textTerms.size === 0) return [];
    /* 增量语义：已启用（手动/自动/全部会话开关）的项目跳过，不重复写入、不重复通知 */
    const enabledBefore = new Set(this.enabledDirectoryIds(sessionId));
    const rows = this.db.prepare(`
      SELECT id, name, updated_at
      FROM memory_directories
      ORDER BY updated_at DESC, lower(name) ASC
    `).all();
    const scores = new Map(rows.map((row) => [row.id, scoreDirectoryNameForAutoMatch(row, textTerms, compactText)]));
    const memoryRows = this.db.prepare(`
      SELECT m.body, d.id AS directory_id, d.name AS directory_name,
        COALESCE((SELECT GROUP_CONCAT(t.name, char(31)) FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active'), '') AS tag_names
      FROM memories m JOIN memory_directories d ON d.id = m.directory_id
      WHERE m.status = 'active'
    `).all();
    for (const row of memoryRows) {
      if (PROTECTED_MEMORY_DIRECTORY_NAMES.has(row.directory_name)) continue;
      scores.set(row.directory_id, (scores.get(row.directory_id) ?? 0) + scoreMemoryRowForAutoMatch(row, textTerms, compactText));
    }
    const matches = rows
      .map((row) => ({ ...row, auto_match_score: scores.get(row.id) ?? 0 }))
      .filter((row) => row.auto_match_score >= 8)
      .filter((row) => !enabledBefore.has(row.id))
      .sort((left, right) => right.auto_match_score - left.auto_match_score || Number(right.updated_at ?? 0) - Number(left.updated_at ?? 0))
      .slice(0, 3);
    for (const match of matches) this.setSessionDirectory({ sessionId, directoryId: match.id, enabled: true });
    return matches.map((match) => ({ id: match.id, name: match.name }));
  }

  queueDistill(session, turn) {
    const key = String(session.id);
    this.ctx.logger?.info?.(`[${PLUGIN_NAME}] memory distill queued for session ${key} turn ${String(turn)}`);
    const previous = this.distillQueues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.distillTurn(session, turn, undefined, 'auto'));
    this.distillQueues.set(key, next);
    void next.catch((error) => {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory distillation queue failed:`, error);
    }).finally(() => {
      if (this.distillQueues.get(key) === next) this.distillQueues.delete(key);
    });
  }

  /**
   * diff 式剔除（top-k 语义）：把上下文中已注入、但本轮召回未进入 top-k 的记忆，
   * 从会话活动 surface 上剔除（surface replace 覆盖为空消息，deriveMessages 不再产出）。
   * 仍被召回的记忆原样保留（缓存前缀稳定）；部分存活的注入消息原地重写剩余内容。
   * 弱输入轮（weakQuery=true）召回不可靠，完全不参与判定、不动上下文。
   * @param session - live session。
   * @param hitIds - 本轮召回命中的记忆 id（来自原始召回，未做 fresh 过滤）。
   * @param weakQuery - 本轮用户输入是否弱输入。
   * @returns 实际剔除的记忆 id 列表（用于日志与调试）。
   */
  ejectStaleInjectedMemories(session, hitIds, weakQuery) {
    if (weakQuery) return [];
    const sessionId = String(session?.id ?? '');
    if (!normalizePlainText(sessionId, 128)) return [];
    const events = sessionEvents(session);
    const bySeq = new Map(events.map((event) => [event.seq, event]));
    const nodes = Array.isArray(session.surface?.nodes) ? session.surface.nodes : undefined;
    if (!Array.isArray(nodes)) return [];
    const injectedOnSurface = [];
    for (const seq of nodes) {
      const event = bySeq.get(seq);
      if (event?.type !== 'user/message' || !isAppendSurfaceEvent(event)) continue;
      const source = event.data?.source;
      if (source?.kind !== 'plugin' || source?.plugin !== MEMORY_CONTEXT_PLUGIN || !Array.isArray(source.hitIds)) continue;
      injectedOnSurface.push(event);
    }
    if (injectedOnSurface.length === 0) return [];

    /* top-k 判定：本轮召回命中的保留，未命中的剔除 */
    const hitSet = new Set((Array.isArray(hitIds) ? hitIds : []).map((id) => normalizePlainText(String(id ?? ''), 128)).filter(Boolean));
    const ejected = [];
    const survivorsBySeq = new Map();
    for (const event of injectedOnSurface) {
      const messageHitIds = event.data.source.hitIds.map((id) => normalizePlainText(String(id ?? ''), 128)).filter(Boolean);
      const survivors = messageHitIds.filter((id) => hitSet.has(id));
      if (survivors.length === messageHitIds.length) continue;
      for (const id of messageHitIds) if (!hitSet.has(id)) ejected.push(id);
      survivorsBySeq.set(event.seq, survivors);
    }
    if (ejected.length === 0) return [];

    /* 落盘：剔除。整条全灭 → surface replace 为空 user/message（tombstone：
       两个官方适配器都跳过空文本 user 消息，不进入模型上下文；
       v3 禁止空 assistant 替换，system/message 受 open-step 关系校验约束）；
       部分存活 → 原地重写为剩余记忆内容。 */
    for (const event of injectedOnSurface) {
      const survivors = survivorsBySeq.get(event.seq);
      if (survivors === undefined) continue;
      const source = event.data.source;
      if (survivors.length > 0) {
        const keptHits = survivors.map((id) => {
          const memory = this.memoryById(id);
          if (memory === undefined) return undefined;
          const limited = truncateMemoryTextForInjection(memory.id, memory.text ?? '');
          return {
            id: memory.id,
            text: limited.text,
            truncated: limited.truncated,
            directoryName: memory.directoryName ?? '',
            tags: Array.isArray(memory.tags) ? memory.tags : [],
            updatedAt: memory.updatedAt ?? 0
          };
        }).filter(Boolean);
        if (keptHits.length === 0) {
          session.append('user/message', createUserMessage({
            content: [],
            source: { kind: 'plugin', plugin: MEMORY_EJECT_PROVIDER }
          }), { surfaceOp: { op: 'replace', startSeq: event.seq, endSeq: event.seq }, sourceEventSeqs: [event.seq] });
          continue;
        }
        const text = renderMemoryInjection(keptHits);
        session.append('user/message', {
          ...event.data,
          content: [{ type: 'text', text }],
          /* 重写使用与首次注入相同的 JSON 解析/截断链，并用新正文重建快照，
             保证面板、注入正文与模型上下文三者一致。 */
          source: {
            ...source,
            hitIds: keptHits.map((hit) => hit.id),
            snapshot: keptHits.map((hit) => ({ id: hit.id, text: hit.text, directoryName: hit.directoryName, tags: hit.tags })),
            summary: `命中 ${keptHits.length} 条`
          }
        }, { surfaceOp: { op: 'replace', startSeq: event.seq, endSeq: event.seq }, sourceEventSeqs: [event.seq] });
      } else {
        session.append('user/message', createUserMessage({
          content: [],
          source: { kind: 'plugin', plugin: MEMORY_EJECT_PROVIDER }
        }), { surfaceOp: { op: 'replace', startSeq: event.seq, endSeq: event.seq }, sourceEventSeqs: [event.seq] });
      }
    }
    this.ctx.logger?.info?.(`[${PLUGIN_NAME}] memory eject: removed ${ejected.length} stale injected memories from session ${sessionId}`);
    return ejected;
  }

  async injectRecall(agent, claimedMessages, decision, signal, turn) {
    if (decision.kind !== 'enter' || signal?.aborted) return decision;
    const sessionId = String(agent?.session?.id ?? '');
    let baseContextMessages = [];
    try {
      baseContextMessages = typeof agent?.session?.deriveMessages === 'function' ? agent.session.deriveMessages() : [];
    } catch {
      baseContextMessages = [];
    }
    const contextMessages = (messages) => [...baseContextMessages, ...(Array.isArray(messages) ? messages : [])];
    /* 多 step 轮：本轮上下文已带记忆注入（上一 step 注入并已落盘），不重复注入，
       也不做剔除判定（step 内召回输入与轮输入不同，不是可靠的剔除依据）。 */
    if (contextMemoryHitIds(decision.messages).length > 0) {
      return decision;
    }
    const directText = claimedMessages.filter(isHumanMessage).map((message) => textBlocks(message.content)).join('\n\n').trim();
    if (!directText) {
      return decision;
    }
    const insertAt = decision.messages.findIndex(isHumanMessage);
    if (insertAt < 0) {
      return decision;
    }
    let matchedDirectories = [];
    try {
      matchedDirectories = this.autoMatchDirectories(agent.session, directText);
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] first-turn project auto-match failed:`, error);
    }
    let hits = [];
    let rawHitIds = [];
    try {
      hits = this.recall(agent.session.id, directText);
      rawHitIds = hits.map((hit) => hit.id);
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory recall failed:`, error);
    }
    /* 召回打点：本轮召回命中的记忆统一刷新 last_recalled_at。与工具写同模式走
       queueToolWrite 延迟队列（setTimeout(0) 宏任务执行，不阻塞当前流程）；
       只影响卡片展示，失败仅记 warn。临时记忆在内存对象上即时打点（快照读取
       依赖内存值，且无 I/O）；永久记忆批量 UPDATE 在队列中执行。 */
    const recalledStamp = now();
    try {
      const hitIds = [...new Set(hits.map((hit) => String(hit?.id ?? '')).filter(Boolean))];
      const ephemeralIds = new Set(this.ephemeral.keys());
      for (const hitId of hitIds) {
        if (!ephemeralIds.has(hitId)) continue;
        const item = this.ephemeral.get(hitId);
        if (item !== undefined) item.lastRecalledAt = recalledStamp;
      }
      const persistentIds = hitIds.filter((hitId) => !ephemeralIds.has(hitId));
      if (persistentIds.length > 0) {
        this.queueToolWrite(() => {
          /* 单语句批量刷新（同一时间戳，IN 列表一次原子提交）；
             召回上限 20 条远低于 SQLite 变量数上限，无需分片 */
          const placeholders = persistentIds.map(() => '?').join(', ');
          this.db.prepare(`UPDATE memories SET last_recalled_at = ? WHERE id IN (${placeholders})`)
            .run(recalledStamp, ...persistentIds);
        });
      }
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory last-recalled stamp failed:`, error);
    }
    if (signal?.aborted) return decision;
    /* diff 式剔除（top-k 语义）：弱输入轮（"继续""10px"等）召回不可靠，不动上下文；
       正常轮直接剔除本轮未进 top-k 的已注入记忆，再注入本轮新召回。 */
    const weakQuery = isWeakQueryText(directText);
    try {
      const ejected = this.ejectStaleInjectedMemories(agent.session, rawHitIds, weakQuery);
      if (ejected.length > 0) {
        baseContextMessages = typeof agent?.session?.deriveMessages === 'function' ? agent.session.deriveMessages() : baseContextMessages;
      }
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory eject failed:`, error);
    }
    hits = filterFreshMemoryHits(hits, contextMessages(decision.messages));
    if (hits.length === 0 && matchedDirectories.length === 0) {
      return decision;
    }
    const content = [
      matchedDirectories.length > 0 ? autoMatchNoticeText(matchedDirectories) : '',
      hits.length > 0 ? renderMemoryInjection(hits) : ''
    ].filter(Boolean).join('\n\n');
    const message = createUserMessage({
      content: [{ type: 'text', text: content }],
      source: {
        kind: 'plugin',
        plugin: MEMORY_CONTEXT_PLUGIN,
        form: 'notice',
        summary: matchedDirectories.length > 0 && hits.length > 0 ? `自动启用 ${matchedDirectories.length} 个项目，命中 ${hits.length} 条` : matchedDirectories.length > 0 ? `自动启用 ${matchedDirectories.length} 个项目` : `命中 ${hits.length} 条`,
        hitIds: hits.map((hit) => hit.id),
        /* 注入时命中记忆的结构化快照（与正文 1:1）：随注入事件持久化，供记忆
           小面板跨重启解析文本（含临时记忆），并保证面板文本 = 模型当时实际所见。 */
        snapshot: hits.map((hit) => ({ id: hit.id, text: hit.text ?? '', directoryName: hit.directoryName ?? '', tags: Array.isArray(hit.tags) ? hit.tags : [] })),
        directoryIds: [...new Set([...matchedDirectories.map((directory) => directory.id), ...hits.map((hit) => hit.directoryId)].filter(Boolean))]
      }
    });
    const messages = [...decision.messages.slice(0, insertAt), message, ...decision.messages.slice(insertAt)];
    return {
      ...decision,
      messages
    };
  }

  async withDistillSession(sessionId, callback) {
    const idText = normalizePlainText(sessionId, 128);
    if (!idText) throw new MemoryError('invalid-session-id', 'sessionId is invalid', 400);
    const live = this.ctx.sessions?.get?.(idText);
    if (live !== undefined) return callback(live);
    const persistence = this.ctx.sessionPersistence;
    if (isHandleStylePersistence(persistence)) {
      let handle;
      try {
        handle = await persistence.open(idText, 'read');
        const result = await handle.read(0, Number.MAX_SAFE_INTEGER);
        const events = Array.isArray(result?.events) ? result.events : [];
        const header = handle.header ?? { id: idText };
        const detached = Object.freeze({
          id: header.id ?? idText,
          header,
          snapshotEvents: () => events
        });
        return await callback(detached);
      } catch (error) {
        if (error instanceof MemoryError) throw error;
        if (error?.name === 'SessionPersistenceNotFoundError') throw new MemoryError('session-not-found', 'session was not found', 404);
        this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] cold session distill access failed for ${idText}:`, error);
        throw new MemoryError('session-unavailable', 'session could not be loaded for distillation', 503);
      } finally {
        try { await handle?.close?.(); } catch (error) { this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] cold session handle release failed for ${idText}:`, error); }
      }
    }
    if (typeof persistence?.borrowSession !== 'function') throw new MemoryError('session-unavailable', 'session is not loaded and cold-session access is unavailable', 503);
    let borrowed;
    try {
      borrowed = await persistence.borrowSession(idText);
      const detached = borrowed?.source === 'prepared' ? borrowed.preparedSession : this.ctx.sessions?.get?.(idText);
      if (detached === undefined) throw new MemoryError('session-not-found', 'session was not found', 404);
      return await callback(detached);
    } catch (error) {
      if (error instanceof MemoryError) throw error;
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] cold session distill access failed for ${idText}:`, error);
      throw new MemoryError('session-unavailable', 'session could not be loaded for distillation', 503);
    } finally {
      try { borrowed?.[Symbol.dispose]?.(); } catch (error) { this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] cold session lease release failed for ${idText}:`, error); }
    }
  }

  async handleActivity(req, res) {
    if (req.method !== 'GET') return respond(res, 405, { ok: false, error: { code: 'method-not-allowed', message: 'GET required' } });
    const url = new URL(req.url || '/dsh-session-kit/memory/activity', 'http://dsh.local');
    const view = url.searchParams.get('view') === 'logs' ? 'logs' : 'progress';
    const limit = Number(url.searchParams.get('limit') || 50);
    const before = url.searchParams.get('before');
    return respond(res, 200, { ok: true, value: this.activitySnapshot(view, limit, before ? Number(before) : undefined) });
  }

  async handle(req, res) {
    if (req.method === 'GET') {
      const url = new URL(req.url || MEMORY_ROUTE, 'http://dsh.local');
      const sessionId = normalizePlainText(url.searchParams.get('sessionId') ?? '', 128);
      return respond(res, 200, { ok: true, value: this.snapshot(sessionId) });
    }
    if (req.method !== 'POST') return respond(res, 405, { ok: false, error: { code: 'method-not-allowed', message: 'POST required' } });
    const contentType = req.headers?.['content-type'];
    if (typeof contentType !== 'string' || !contentType.toLowerCase().startsWith('application/json')) return respond(res, 415, { ok: false, error: { code: 'invalid-request', message: 'application/json required' } });
    try {
      const body = await readJsonBody(req);
      const action = typeof body?.action === 'string' ? body.action : 'snapshot';
      switch (action) {
        case 'snapshot': break;
        case 'turn-memory-hits': {
          const sessionId = normalizePlainText(body.sessionId, 128);
          const session = this.ctx.sessions?.get?.(sessionId);
          if (session === undefined) throw new MemoryError('session-not-found', 'session was not found', 404);
          let turn = Number(body.turn);
          if (!Number.isSafeInteger(turn) || turn < 0) {
            const messageId = normalizePlainText(body.messageId, 128);
            if (!messageId) throw new MemoryError('invalid-turn', 'turn or messageId is required', 400);
            turn = undefined;
            for (const event of sessionEvents(session)) {
              if (event.type !== 'assistant/message') continue;
              if (String(event.data?.message?.id ?? '') !== messageId) continue;
              if (Number.isSafeInteger(event.data?.turn)) {
                turn = event.data.turn;
                break;
              }
            }
            if (turn === undefined) throw new MemoryError('turn-not-found', 'turn was not found for the given messageId', 404);
          }
          /* 纯会话日志计算（无内存快照、无外部存储）：读时扫描召回记录解析
             展示来源（强轮自身 / 弱轮继承背景或显示自身，跳过已删除轮次），
             回退注入事件 hitIds（旧会话）；重启后可完整重算。 */
          const foldMap = foldTurnContextMemory(sessionEvents(session));
          const hits = foldMap.get(turn) ?? [];
          const memories = [];
          for (const hit of hits) {
            if (hit.text !== '') {
              memories.push(hit);
              continue;
            }
            /* 遗留注入（无快照）的兜底：以记忆库实时解析，查不到（已删）丢弃 */
            const memory = this.memoryById(hit.id);
            if (memory !== undefined) memories.push({ id: hit.id, text: memory.text ?? '', directoryName: memory.directoryName ?? '', tags: memory.tags ?? [] });
          }
          return respond(res, 200, { ok: true, value: { turn, hitIds: memories.map((memory) => memory.id), memories, mode: 'events' } });
        }
        case 'create-directory': this.createDirectory(body); break;
        case 'update-directory': this.updateDirectory(body); break;
        case 'delete-directory': this.deleteDirectory(body); break;
        case 'create-tag': this.createTag(body); break;
        case 'set-tag-status': this.setTagStatus(body); break;
        case 'clear-activity-logs': {
          const cleared = this.clearActivityLogs();
          return respond(res, 200, { ok: true, value: { ...this.snapshot(body?.sessionId), ...cleared } });
        }
        case 'cleanup-token-usage': return respond(res, 200, { ok: true, value: this.cleanupTokenUsage() });
        case 'usage-overview': return respond(res, 200, { ok: true, value: this.usageOverview() });
        case 'delete-tag': this.deleteTag(body); break;
        case 'create-memory': this.createMemory(body, { logActivity: true }); break;
        case 'persist-memory': this.persistMemory(body, { logActivity: true }); break;
        case 'update-memory': this.updateMemory(body, { logActivity: true }); break;
        case 'delete-memory': this.deleteMemory(body); break;
        case 'set-session-directory': this.setSessionDirectory(body); break;
        case 'set-auto-distill': this.setAutoDistill(body); break;
        case 'set-all-sessions-enabled': this.setAllSessionsEnabled(body); break;
        case 'set-first-turn-auto-match': this.setFirstTurnAutoMatch(body); break;
        case 'set-distill-model': this.setDistillModelOverride(body.modelSelection === null ? null : body.modelSelection); break;
        case 'debug-distill': {
          const sessionId = normalizePlainText(body.sessionId, 128);
          const session = this.ctx.sessions?.get?.(sessionId);
          const agent = this.ctx.agents?.get?.(sessionId);
          const lastTurn = session === undefined ? undefined : lastCompletedTurn(session);
          const turnRows = session !== undefined && lastTurn !== undefined ? turnTranscript(session, lastTurn) : [];
          const header = session?.requestHeader?.();
          return respond(res, 200, {
            ok: true,
            value: {
              sessionId,
              sessionFound: session !== undefined,
              agentFound: agent !== undefined,
              autoDistillEnabled: this.autoDistillEnabled(),
              firstTurnAutoMatchEnabled: this.autoMatchEnabled(),
              allSessionsDirectoryEnabled: this.allSessionsEnabled(),
              lastCompletedTurn: lastTurn,
              totalEvents: sessionEvents(session).length,
              turnEndEvents: sessionEvents(session).filter((e) => e.type === 'turn/end').length,
              turnEndCompleted: sessionEvents(session).filter((e) => e.type === 'turn/end' && e.data?.reason?.kind === 'completed').length,
              turnRowsCount: turnRows.length,
              turnRowsRoles: turnRows.map((r) => r.role),
              transcriptLength: turnRows.length > 0 ? truncateMiddle(renderTranscript(turnRows), MAX_DISTILL_INPUT_CHARS).length : 0,
              headerConfig: header?.config ? { provider: header.config.provider, model: header.config.model } : undefined,
              agentOptions: agent?.options ? { provider: agent.options.provider, model: agent.options.model } : undefined,
              route: agent !== undefined || session !== undefined ? routeForDistill(agent, session) : undefined
            }
          });
        }
        case 'distill-turn': {
          const sessionId = normalizePlainText(body.sessionId, 128);
          const requestedTurn = Number(body.turn);
          const messageId = normalizePlainText(body.messageId, 128);
          if ((!Number.isSafeInteger(requestedTurn) || requestedTurn < 0) && !messageId) throw new MemoryError('invalid-turn', 'turn or messageId is required', 400);
          const modelSelection = normalizeModelSelection(body.modelSelection);
          const distill = await this.withDistillSession(sessionId, async (session) => {
            let turn = requestedTurn;
            if (!Number.isSafeInteger(turn) || turn < 0) {
              /* assistant-actions slot 只提供 assistant messageId；在 live/cold session 中反查真实轮次。 */
              turn = undefined;
              for (const event of sessionEvents(session)) {
                if (event.type !== 'assistant/message') continue;
                if (String(event.data?.message?.id ?? '') !== messageId) continue;
                if (Number.isSafeInteger(event.data?.turn) && event.data.turn >= 0) {
                  turn = event.data.turn;
                  break;
                }
              }
              if (turn === undefined) throw new MemoryError('turn-not-found', 'turn was not found for the given messageId', 404);
            }
            if (!sessionEvents(session).some((event) => event.type === 'turn/end' && event.data?.turn === turn)) throw new MemoryError('turn-not-found', 'turn was not found', 404);
            return this.distillTurn(session, turn, modelSelection);
          });
          return respond(res, 200, { ok: true, value: { ...this.snapshot(sessionId), distill } });
        }
        case 'distill-now': {
          const sessionId = normalizePlainText(body.sessionId, 128);
          const modelSelection = normalizeModelSelection(body.modelSelection);
          const distill = await this.withDistillSession(sessionId, async (session) => {
            const turn = lastCompletedTurn(session);
            if (turn === undefined) throw new MemoryError('no-completed-turn', 'no completed turn was found', 409);
            return this.distillTurn(session, turn, modelSelection);
          });
          return respond(res, 200, { ok: true, value: { ...this.snapshot(sessionId), distill } });
        }
        default: throw new MemoryError('unknown-action', `unknown memory action: ${action}`);
      }
      return respond(res, 200, { ok: true, value: this.snapshot(body?.sessionId) });
    } catch (error) {
      if (error instanceof MemoryError) return respond(res, error.status, { ok: false, error: { code: error.code, message: error.message } });
      if (error instanceof TypeError || error instanceof SyntaxError) return respond(res, 400, { ok: false, error: { code: 'invalid-request', message: error.message } });
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory route failed:`, error);
      return respond(res, 500, { ok: false, error: { code: 'memory-failed', message: error instanceof Error ? error.message : String(error) } });
    }
  }

  memoryRow(memoryId) {
    const idText = normalizePlainText(memoryId, 128);
    if (!idText) return undefined;
    return this.db.prepare(`
      SELECT m.*, d.name AS directory_name,
        COALESCE((SELECT GROUP_CONCAT(t.id, char(31)) FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active'), '') AS tag_ids,
        COALESCE((SELECT GROUP_CONCAT(t.name, char(31)) FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active'), '') AS tag_names
      FROM memories m JOIN memory_directories d ON d.id = m.directory_id
      WHERE m.id = ?
    `).get(idText);
  }

  /* 记忆创建的 token 消耗记录：kind = auto-distill / manual-distill / memory_add。
     memory_add 无 LLM 调用，tokens/model 为 NULL；蒸馏记录成功那次尝试的用量与模型。 */
  recordMemoryTokenUsage({ kind, directoryId, sessionId, memoryScope, memoryId, model, reasoning, tokens, createdAt }) {
    try {
      this.db.prepare('INSERT INTO memory_token_usage (kind, directory_id, session_id, memory_scope, memory_id, model, reasoning, tokens, created_at, id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(kind, directoryId ?? null, sessionId ?? null, memoryScope, memoryId ?? null, model ?? null, reasoning ?? null, Number.isSafeInteger(tokens) ? tokens : null, createdAt ?? now(), id('mtu'));
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory token usage record failed:`, error);
    }
  }

  cleanupTokenUsage() {
    try {
      const cutoff = now() - MEMORY_TOKEN_USAGE_RETENTION_MS;
      const oldest = this.db.prepare('SELECT MIN(created_at) AS created_at FROM memory_token_usage').get()?.created_at;
      if (!Number.isFinite(Number(oldest)) || Number(oldest) >= cutoff) return { removed: 0 };
      const result = this.db.prepare('DELETE FROM memory_token_usage WHERE created_at < ?').run(cutoff);
      return { removed: Number(result.changes) || 0 };
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] token usage cleanup failed:`, error);
      return { removed: 0 };
    }
  }

  /* 总览聚合：今天/本周/本月/最近四个窗口（本地时区边界）。四窗口为嵌套包含
     关系，单次扫描（从最早窗口起点起）+ JS 单遍分桶：每行只遍历一次、对
     满足条件的窗口累加（窗口数恒定 4），替代原先 4 次全表查询取行物化。 */
  usageOverview() {
    const startOfDay = new Date(now());
    startOfDay.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfDay.getDate() - ((startOfDay.getDay() + 6) % 7));
    const startOfMonth = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1);
    const startOfRecent = now() - MEMORY_TOKEN_USAGE_RETENTION_MS;
    const scanFrom = Math.min(startOfMonth.getTime(), startOfRecent);
    const windows = [
      ['today', startOfDay.getTime()],
      ['week', startOfWeek.getTime()],
      ['month', startOfMonth.getTime()],
      ['recent', startOfRecent]
    ];
    const makeBucket = () => ({ total: 0, models: new Map(), kinds: new Map(), projects: new Map() });
    const buckets = { today: makeBucket(), week: makeBucket(), month: makeBucket(), recent: makeBucket() };
    const rows = this.db.prepare('SELECT kind, directory_id, model, created_at, tokens FROM memory_token_usage WHERE created_at >= ? AND tokens IS NOT NULL AND tokens > 0').all(scanFrom);
    for (const row of rows) {
      const tokens = Number(row.tokens) || 0;
      const model = row.model || '';
      const kind = row.kind || '';
      const project = row.directory_id || '';
      for (const [name, from] of windows) {
        if (Number(row.created_at) < from) continue;
        const bucket = buckets[name];
        bucket.total += tokens;
        bucket.models.set(model, (bucket.models.get(model) || 0) + tokens);
        bucket.kinds.set(kind, (bucket.kinds.get(kind) || 0) + tokens);
        bucket.projects.set(project, (bucket.projects.get(project) || 0) + tokens);
      }
    }
    const directoryNames = new Map(this.db.prepare('SELECT id, name FROM memory_directories').all().map((entry) => [entry.id, entry.name]));
    const ranked = (map, decorate) => [...map.entries()]
      .map(([key, value]) => ({ key, tokens: value, ...decorate(key) }))
      .sort((left, right) => right.tokens - left.tokens);
    return {
      today: { total: buckets.today.total, models: ranked(buckets.today.models, () => ({})), kinds: ranked(buckets.today.kinds, () => ({})), projects: ranked(buckets.today.projects, (key) => ({ directoryId: key, name: directoryNames.get(key) ?? null })) },
      week: { total: buckets.week.total, models: ranked(buckets.week.models, () => ({})), kinds: ranked(buckets.week.kinds, () => ({})), projects: ranked(buckets.week.projects, (key) => ({ directoryId: key, name: directoryNames.get(key) ?? null })) },
      month: { total: buckets.month.total, models: ranked(buckets.month.models, () => ({})), kinds: ranked(buckets.month.kinds, () => ({})), projects: ranked(buckets.month.projects, (key) => ({ directoryId: key, name: directoryNames.get(key) ?? null })) },
      recent: { total: buckets.recent.total, models: ranked(buckets.recent.models, () => ({})), kinds: ranked(buckets.recent.kinds, () => ({})), projects: ranked(buckets.recent.projects, (key) => ({ directoryId: key, name: directoryNames.get(key) ?? null })) }
    };
  }

  memoryById(memoryId) {
    const idText = normalizePlainText(memoryId, 128);
    const ephemeral = this.ephemeral.get(idText);
    if (ephemeral !== undefined) return compactMemory({
      id: ephemeral.id,
      text: ephemeral.text,
      status: ephemeral.status,
      directoryId: ephemeral.directoryId ?? '',
      directoryName: ephemeral.directoryName ?? '',
      tags: ephemeral.tags,
      createdAt: ephemeral.createdAt,
      updatedAt: ephemeral.updatedAt,
      lastRecalledAt: ephemeral.lastRecalledAt ?? 0,
       creationMethod: ephemeral.creationMethod
    });
    const row = this.memoryRow(idText);
    return row === undefined ? undefined : compactMemory(memoryFromRow(row, true));
  }

  resolveToolDirectoryId(input = {}, sessionId = '', text = '') {
    const directoryId = normalizePlainText(input.directoryId, 128);
    if (directoryId) {
      if (this.db.prepare('SELECT id FROM memory_directories WHERE id = ?').get(directoryId) === undefined) throw new MemoryError('directory-not-found', 'directory was not found', 404);
      return directoryId;
    }
    const directoryName = normalizePlainText(input.directoryName ?? input.directory, MAX_DIRECTORY_NAME_LENGTH);
    if (directoryName) return this.ensureDirectory(directoryName);
    const enabled = this.enabledDirectoryIds(sessionId);
    if (enabled.length === 1) return enabled[0];
    if (enabled.length > 1) {
      const placeholders = enabled.map(() => '?').join(', ');
      const rows = this.db.prepare(`SELECT id, name, updated_at FROM memory_directories WHERE id IN (${placeholders})`).all(...enabled);
      const nonDefaultRows = rows.filter((row) => !PROTECTED_MEMORY_DIRECTORY_NAMES.has(row.name));
      if (nonDefaultRows.length === 1) return nonDefaultRows[0].id;
      const guessed = guessDirectoryIdByContent(nonDefaultRows.length > 0 ? nonDefaultRows : rows, text);
      if (guessed) return guessed;
    }
    return this.ensureDirectory(DEFAULT_MEMORY_DIRECTORY_NAME);
  }

  /* 工具写操作异步队列：LLM 调用 memory_add/memory_update 时只做同步预校验并入队，
     实际写入在 setTimeout(0) 宏任务中执行（工具结果先送达 LLM，写库随后进行，FIFO 保序）。
     失败不再抛给对话流，只记 warn 日志与活动日志（可在记忆管理弹窗日志页查看）。 */
  queueToolWrite(run) {
    const timer = setTimeout(() => {
      this.toolWriteTimers.delete(timer);
      try {
        run();
      } catch (error) {
        this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] async memory tool write failed:`, error);
      }
    }, 0);
    this.toolWriteTimers.add(timer);
    if (typeof timer?.unref === 'function') timer.unref();
    return timer;
  }

  addToolMemory(input = {}, sessionId = '', activityContext = {}) {
    const userSummary = activityContext.userText || input.text || input.content;
    const activity = this.beginActivity('memory_add', { sessionId: '', sessionTitle: '', turn: activityContext.turn, callId: activityContext.callId, summary: activitySummaryText(userSummary), triggerKind: 'tool' });
    const body = normalizeMemoryBodyForWrite(input.text ?? input.content);
    if (body.length < 6) {
      this.finishActivity(activity, 'failed', { errorCode: 'invalid-memory-text', errorMessage: 'memory text must not be empty' });
      throw new MemoryError('invalid-memory-text', 'memory text must not be empty');
    }
    const run = () => {
      try {
        const hash = memoryHash(body);
        const duplicate = this.persistentByHash(hash);
        if (duplicate !== undefined) {
          this.finishActivity(activity, 'duplicate', { memoryId: duplicate });
          return;
        }
        const directoryId = this.resolveToolDirectoryId(input, sessionId, body);
        const tagNames = Array.isArray(input.tags) || Array.isArray(input.tagNames)
          ? uniqueStrings(input.tags ?? input.tagNames, MAX_TAGS_PER_MEMORY).map(normalizeTagName).filter(Boolean)
          : normalizeTagNames(undefined, body);
        const status = normalizeStatus(input.status, 'active');
        const stamp = now();
        const memoryId = id('mem');
        this.db.prepare('INSERT INTO memories (id, directory_id, body, status, content_hash, creation_method, created_at, updated_at, last_recalled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)')
          .run(memoryId, directoryId, body, status, hash, 'memory_add', stamp, stamp);
        this.setMemoryTags(memoryId, tagNames);
        this.reindexMemory(memoryId);
        this.recordMemoryTokenUsage({
          kind: 'memory_add',
          directoryId,
          sessionId,
          memoryScope: 'persistent',
          memoryId,
          tokens: null,
          createdAt: stamp
        });
        this.finishActivity(activity, 'success', { memoryId });
      } catch (error) {
        this.finishActivity(activity, 'failed', { errorCode: error?.code, errorMessage: error?.message || String(error) });
        throw error;
      }
    };
    this.queueToolWrite(run);
    return { accepted: true };
  }

  stopMemory(input = {}) {
    const memoryId = normalizePlainText(input.memoryId, 128);
    if (!memoryId) throw new MemoryError('invalid-memory-id', 'memoryId must not be empty', 400);
    this.updateMemory({ memoryId, status: 'inactive' });
    const memory = this.memoryById(memoryId);
    if (memory === undefined) throw new MemoryError('memory-not-found', 'memory was not found', 404);
    return memory;
  }

  updateToolMemory(input = {}, sessionId = '') {
    const memoryId = normalizePlainText(input.memoryId, 128);
    if (!memoryId) throw new MemoryError('invalid-memory-id', 'memoryId must not be empty', 400);
    const hasText = input.text !== undefined || input.content !== undefined;
    const hasStatus = input.status !== undefined;
    const hasTags = Array.isArray(input.tags) || Array.isArray(input.tagNames);
    const hasDirectory = input.directoryId !== undefined || input.directoryName !== undefined || input.directory !== undefined;
    if (!hasText && !hasStatus && !hasTags && !hasDirectory) throw new MemoryError('empty-update', 'provide text, tags, status, or directory to update', 400);
    const before = this.memoryById(memoryId);
    if (before === undefined) throw new MemoryError('memory-not-found', 'memory was not found', 404);
    const activity = this.beginActivity('memory_update', { sessionId: '', sessionTitle: '', memoryId, summary: activitySummaryText(before.text || `memory ${memoryId}`), triggerKind: 'tool' });
    const payload = { memoryId };
    if (hasText) payload.text = input.text ?? input.content;
    if (hasStatus) payload.status = input.status;
    if (hasTags) payload.tagNames = input.tags ?? input.tagNames;
    if (input.directoryId !== undefined) payload.directoryId = input.directoryId;
    else if (input.directoryName !== undefined || input.directory !== undefined) payload.directoryId = this.resolveToolDirectoryId(input);
    const run = () => {
      try {
        this.updateMemory(payload);
        const memory = this.memoryById(memoryId);
        if (memory === undefined) throw new MemoryError('memory-not-found', 'memory was not found', 404);
        this.finishActivity(activity, 'success', { memoryId, summary: activitySummaryText(memory.text) });
      } catch (error) {
        this.finishActivity(activity, 'failed', { memoryId, errorCode: error?.code, errorMessage: error?.message || String(error) });
        throw error;
      }
    };
    this.queueToolWrite(run);
    return { accepted: true };
  }

  activeRecallGuard(toolName, args = {}, exec = {}) {
    const sessionId = normalizeToolSessionId(exec.agent?.session?.id, args.sessionId);
    const turn = activeRecallTurn(exec);
    const key = `${sessionId || 'no-session'}:${turn}`;
    const stamp = now();
    const entry = this.activeRecallByTurn.get(key) ?? { signatures: new Set(), updatedAt: stamp };
    const signature = normalizeActiveRecallArgs(toolName, args);
    if (entry.signatures.has(signature)) {
      entry.updatedAt = stamp;
      this.activeRecallByTurn.set(key, entry);
      return { blocked: true, reason: 'duplicate' };
    }
    entry.signatures.add(signature);
    entry.updatedAt = stamp;
    this.activeRecallByTurn.set(key, entry);
    for (const [entryKey, value] of this.activeRecallByTurn) {
      if (this.activeRecallByTurn.size <= 200 && stamp - Number(value.updatedAt ?? 0) <= 3600000) continue;
      this.activeRecallByTurn.delete(entryKey);
    }
    return { blocked: false };
  }

  memorySearchDirectoryIds(input = {}, sessionId = '') {
    const directoryId = normalizePlainText(input.directoryId, 128);
    if (directoryId) {
      if (this.db.prepare('SELECT id FROM memory_directories WHERE id = ?').get(directoryId) === undefined) throw new MemoryError('directory-not-found', 'directory was not found', 404);
      return [directoryId];
    }
    const directoryName = normalizePlainText(input.directoryName ?? input.directory, MAX_DIRECTORY_NAME_LENGTH);
    if (directoryName) {
      const row = this.db.prepare('SELECT id FROM memory_directories WHERE lower(name) = lower(?)').get(directoryName);
      return row === undefined ? [] : [row.id];
    }
    if (input.scope === 'enabled') return this.enabledDirectoryIds(sessionId);
    return this.db.prepare('SELECT id FROM memory_directories').all().map((row) => row.id);
  }

  searchMemories(queryText, options = {}) {
    const startedAt = now();
    const limit = clampToolLimit(options.limit, MEMORY_TOOL_DEFAULT_ITEMS, MEMORY_TOOL_MAX_ITEMS);
    const sessionId = normalizeToolSessionId(options.sessionId, options.fallbackSessionId);
    const directoryIds = this.memorySearchDirectoryIds(options, sessionId);
    if (directoryIds.length === 0) return [];
    const timeRange = resolveToolTimeRange(queryText, options);
    const searchText = stripTimeQueryNoise(queryText, timeRange);
    const terms = extractSearchTerms(searchText);
    const query = ftsQuery(searchText);
    const placeholders = directoryIds.map(() => '?').join(', ');
    const status = normalizePlainText(options.status, 16);
    const statusSql = status && status !== 'all' ? 'AND m.status = ?' : '';
    const statusArgs = status && status !== 'all' ? [normalizeStatus(status, 'active')] : [];
    const timeSql = timeRange !== undefined ? 'AND ((m.created_at >= ? AND m.created_at < ?) OR (m.updated_at >= ? AND m.updated_at < ?))' : '';
    const timeArgs = timeRange !== undefined ? [timeRange.start, timeRange.end, timeRange.start, timeRange.end] : [];
    const customContext = customTagMatchContext(searchText || queryText);
    const customRows = this.customTagCandidateRows(directoryIds, customContext, { status, timeRange });
    let rows = [];
    if (this.ftsAvailable && query) {
      try {
        rows = mergeRecallRows(this.db.prepare(`
          SELECT m.*, d.name AS directory_name,
            COALESCE((SELECT GROUP_CONCAT(t.id, char(31)) FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active'), '') AS tag_ids,
            COALESCE((SELECT GROUP_CONCAT(t.name, char(31)) FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active'), '') AS tag_names,
            bm25(memory_fts) AS rank
          FROM memory_fts JOIN memories m ON memory_fts.id = m.id JOIN memory_directories d ON d.id = m.directory_id
          WHERE memory_fts MATCH ? AND m.directory_id IN (${placeholders}) ${statusSql} ${timeSql}
          ORDER BY rank ASC
        `).all(query, ...directoryIds, ...statusArgs, ...timeArgs), customRows);
      } catch (error) {
        this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory_search FTS failed; using fallback:`, error);
      }
    }
    if (rows.length === 0) {
      rows = this.db.prepare(`
        SELECT m.*, d.name AS directory_name,
          COALESCE((SELECT GROUP_CONCAT(t.id, char(31)) FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active'), '') AS tag_ids,
          COALESCE((SELECT GROUP_CONCAT(t.name, char(31)) FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active'), '') AS tag_names,
          0 AS rank
        FROM memories m JOIN memory_directories d ON d.id = m.directory_id
        WHERE m.directory_id IN (${placeholders}) ${statusSql} ${timeSql}
      `).all(...directoryIds, ...statusArgs, ...timeArgs)
        .map((row) => ({ ...row, rank: -scoreFallback(row, terms) }))
        .filter((row) => terms.length === 0 || row.rank < 0 || customTagWeightForRow(row, customContext) > 0 || timeRange !== undefined);
    }
    rows = mergeRecallRows(rows, customRows);
    const wantedTags = normalizeDistillList(options.tags ?? options.tagNames, MAX_TAGS_PER_MEMORY);
    if (wantedTags.length > 0) rows = rows.filter((row) => rowTagNames(row).some((tag) => wantedTags.includes(tag)));
    const profile = options.profile ?? detectRecallProfile(queryText);
    return rerankRecallRows(rows, profile, startedAt, searchText || queryText).slice(0, limit).map((row) => compactMemory(memoryFromRow(row, true)));
  }

  async searchConversations(queryText, options = {}) {
    const query = normalizePlainText(queryText, 1000);
    const timeRange = resolveToolTimeRange(query, options);
    const searchText = stripTimeQueryNoise(query, timeRange);
    const terms = extractSearchTerms(searchText);
    if (timeRange === undefined && searchText.length < 2 && terms.length === 0) return [];
    const limit = clampToolLimit(options.limit, CONVERSATION_SEARCH_DEFAULT_RESULTS, CONVERSATION_SEARCH_MAX_RESULTS);
    const sessionLimit = clampToolLimit(options.sessionLimit, timeRange === undefined ? CONVERSATION_SEARCH_DEFAULT_SESSIONS : CONVERSATION_SEARCH_TIME_DEFAULT_SESSIONS, CONVERSATION_SEARCH_MAX_SESSIONS);
    const includeSubagents = options.includeSubagents === true;
    const includeCurrent = options.includeCurrent !== false;
    const includeArchived = options.includeArchived !== false;
    const archivedSessionIds = new Set((this.ctx.workspaceRegistry?.archivedSessionIds ?? []).map(String));
    const currentSessionId = normalizeToolSessionId(options.currentSessionId, options.fallbackSessionId);
    const seen = new Set();
    const sessions = [];
    const shouldInclude = (session) => {
      const idText = String(session?.id ?? session?.header?.id ?? '');
      if (!idText || seen.has(idText)) return false;
      if (!includeCurrent && currentSessionId && idText === currentSessionId) return false;
      if (!includeArchived && archivedSessionIds.has(idText)) return false;
      if (!includeSubagents && (session?.header?.parentSession !== undefined || session?.header?.origin === 'subagent')) return false;
      return true;
    };
    for (const session of this.ctx.sessions?.list?.() ?? []) {
      if (sessions.length >= sessionLimit) break;
      if (!shouldInclude(session)) continue;
      seen.add(String(session.id ?? session.header?.id));
      sessions.push(session);
    }
    const persistence = this.ctx.sessionPersistence;
    const handleStylePersistence = isHandleStylePersistence(persistence);
    const canInspectColdSessions = typeof persistence?.list === 'function'
      && (handleStylePersistence || typeof persistence?.inspect === 'function');
    if (sessions.length < sessionLimit && canInspectColdSessions) {
      const headers = await persistenceHeaders(persistence, options.signal).catch((error) => {
        this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] conversation_search list failed:`, error);
        return [];
      });
      for (const header of [...headers].sort((left, right) => Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0))) {
        if (sessions.length >= sessionLimit) break;
        const idText = String(header?.id ?? '');
        if (!idText || seen.has(idText)) continue;
        if (!includeCurrent && currentSessionId && idText === currentSessionId) continue;
        if (!includeArchived && archivedSessionIds.has(idText)) continue;
        if (!includeSubagents && (header?.parentSession !== undefined || header?.origin === 'subagent')) continue;
        try {
          options.signal?.throwIfAborted?.();
          let session;
          if (handleStylePersistence) {
            let handle;
            let failure;
            try {
              handle = await persistence.open(idText, 'read', { signal: options.signal });
              const result = await handle.read(0, Number.MAX_SAFE_INTEGER, { signal: options.signal });
              const events = Array.isArray(result?.events) ? result.events : [];
              session = { id: header.id, header, events };
            } catch (error) {
              failure = error;
              throw error;
            } finally {
              try {
                await handle?.close?.();
              } catch (error) {
                if (failure === undefined) throw error;
              }
            }
          } else {
            const inspection = await persistence.inspect(idText, options.signal);
            const meta = persistenceHeaderOf(inspection?.meta);
            session = { id: meta.id, header: meta, events: inspection.events };
          }
          seen.add(idText);
          sessions.push(session);
        } catch (error) {
          if (options.signal?.aborted) throw error;
          this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] conversation_search cold session read failed for ${idText}:`, error);
        }
      }
    }
    const bestByKey = new Map();
    for (const session of sessions) {
      for (const row of searchableSessionRows(session)) {
        if (!inTimeRange(row.time, timeRange)) continue;
        const score = scoreConversationRow(row, terms, searchText, timeRange);
        if (score <= 0) continue;
        const key = conversationRowDedupeKey(row);
        const previous = bestByKey.get(key);
        if (previous === undefined || score > previous.score || (score === previous.score && Number(row.time ?? 0) > Number(previous.row.time ?? 0))) bestByKey.set(key, { row, score });
      }
    }
    const results = [...bestByKey.values()].map(({ row, score }) => compactConversationResult(row, score));
    return results.sort((left, right) => right.score - left.score || Number(right.time ?? 0) - Number(left.time ?? 0) || String(right.sessionId).localeCompare(String(left.sessionId))).slice(0, limit);
  }
}

function memoryItemSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string', required: true },
      text: { type: 'string', required: true },
      status: { type: 'string', required: true, enum: ['active', 'inactive'] },
      directoryId: { type: 'string', required: true },
      directoryName: { type: 'string', required: true },
      tags: { type: 'array', required: true, items: { type: 'string' } },
      createdAt: { type: 'integer', required: true },
      updatedAt: { type: 'integer', required: true },
      lastRecalledAt: { type: 'integer', required: true },
      creationMethod: { type: 'string', required: true, enum: ['', 'manual', 'auto-distill', 'manual-distill', 'memory_add', 'import'] }
    }
  };
}

function registerMemoryTools(ctx, store, tools) {
  if (typeof tools?.register !== 'function') return () => {};
  const memorySchema = memoryItemSchema();
  const memoryListSchema = {
    type: 'array',
    required: true,
    items: memorySchema
  };
  const conversationResultSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      sessionId: { type: 'string', required: true },
      title: { type: 'string', required: true },
      turn: { type: 'integer', required: true },
      role: { type: 'string', required: true },
      text: { type: 'string', required: true },
      time: { type: 'integer', required: true },
      date: { type: 'string', required: true },
      score: { type: 'number', required: true }
    }
  };
  const statusParam = { type: 'string', enum: ['active', 'inactive'], description: 'Memory status: active is recalled, inactive is stored but not recalled.' };
  const commonMemoryParams = {
    directoryId: { type: 'string', description: 'Existing memory project/directory id. Takes precedence over directoryName.' },
    directoryName: { type: 'string', description: 'Memory project/directory name. Created if missing.' },
    tags: { type: 'array', items: { type: 'string' }, description: 'Optional memory tags. If omitted, tags are inferred from text.' },
    status: statusParam
  };
  const disposers = [];
  disposers.push(tools.register(defineTool({
    name: 'memory_add',
    description: '新增一条长期记忆。只在用户明确要求记住、保存偏好/约束/项目事实，或当前信息明显需要长期保留时使用。默认写入当前会话启用的记忆项目，状态为 active。',
    parameters: {
      text: { type: 'string', required: true, description: '记忆正文。代码/项目相关内容使用 JSON 对象：{"位置":["..."],"对象":["..."],"内容":"...","踩坑":"..."}；也接受 paths/symbols/content/pitfall 英文 key；位置和对象必须是字符串数组，内容和踩坑允许换行；不要写源码行号或验证/测试通过段落。' },
      ...commonMemoryParams
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          accepted: { type: 'boolean', required: true }
        }
      },
      render: (_args, value) => toolTextBlock(value?.accepted === true
        ? '已受理，正在后台写入记忆。可用 memory_search 确认结果；若写入失败会记录在记忆管理弹窗的日志页。'
        : '已受理，正在后台写入记忆。')
    },
    execute(args, exec) {
      const sessionId = normalizeToolSessionId(args.sessionId, exec.agent?.session?.id);
      const activityContext = activityUserMessageForToolCall(exec.agent?.session, exec.callId);
      return store.addToolMemory(args, sessionId, activityContext);
    },
    presentCall: (args) => ({ card: 'generic', title: 'Memory add', kind: 'other', rawInput: args })
  })));
  disposers.push(tools.register(defineTool({
    name: 'memory_stop',
    description: '停用一条记忆，将状态改为 inactive；inactive 记忆不会参与自动召回，但仍保留在记忆库中。',
    parameters: {
      memoryId: { type: 'string', required: true, description: '要停用的记忆 id。' }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { memory: { ...memorySchema, required: true } }
      },
      render: (_args, value) => toolTextBlock(`已停用记忆：\n${renderMemoryToolList([value.memory])}`)
    },
    execute(args) {
      return { memory: store.stopMemory(args) };
    },
    presentCall: (args) => ({ card: 'generic', title: 'Memory disable', kind: 'other', rawInput: args })
  })));
  disposers.push(tools.register(defineTool({
    name: 'memory_search',
    description: '搜索本地记忆库。适合主动查询偏好、项目约束、代码位置、场景摘要、某天/昨天/最近保存过什么记忆，或需要确认已有记忆时使用。支持从 query 自动解析今天/昨天/前天/最近N天/本周/上周/本月/上月/具体日期。相同或语义等价查询会被去重；已有结果后不要重复调用。',
    parameters: {
      query: { type: 'string', required: true, description: '搜索关键词或问题，可包含今天/昨天/前天/最近N天/本周/上周/本月/上月/具体日期等时间表达。' },
      date: { type: 'string', description: '可选时间范围提示，例如 today、yesterday、今天、昨天、前天、最近7天、上周、2026-09-01；省略时从 query 自动解析。' },
      from: { type: 'string', description: '可选开始时间或日期，优先于 date/query 自动解析。' },
      to: { type: 'string', description: '可选结束时间或日期，优先于 date/query 自动解析；日期按当天结束处理。' },
      sessionId: { type: 'string', description: '可选会话 id；scope=enabled 时用它限定当前会话启用的记忆项目。默认使用当前会话。' },
      scope: { type: 'string', enum: ['all', 'enabled'], description: 'all 搜索全部记忆项目；enabled 仅搜索该会话启用的项目。默认 all。' },
      status: { type: 'string', enum: ['active', 'inactive', 'all'], description: '按状态过滤；默认 active。' },
      limit: { type: 'integer', description: `最多返回条数，最大 ${MEMORY_TOOL_MAX_ITEMS}。` },
      directoryId: { type: 'string', description: '按记忆项目 id 过滤。' },
      directoryName: { type: 'string', description: '按记忆项目名称过滤。' },
      tags: { type: 'array', items: { type: 'string' }, description: '按标签过滤，匹配任一标签。' }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          memories: memoryListSchema,
          count: { type: 'integer', required: true },
          notice: { type: 'string' }
        }
      },
      render: (_args, value) => toolTextBlock(value.notice || renderMemoryToolList(value.memories))
    },
    execute(args, exec) {
      const guard = store.activeRecallGuard('memory_search', args, exec);
      if (guard.blocked) {
        exec.concludeTurn?.();
        return { memories: [], count: 0, notice: activeRecallAlreadySatisfiedText('memory_search') };
      }
      const memories = store.searchMemories(args.query, {
        ...args,
        fallbackSessionId: exec.agent?.session?.id,
        status: args.status ?? 'active',
        scope: args.scope ?? 'all'
      });
      return { memories, count: memories.length };
    },
    presentCall: (args) => ({ card: 'generic', title: 'Memory search', kind: 'other', rawInput: args })
  })));
  disposers.push(tools.register(defineTool({
    name: 'memory_read',
    description: '查看一条记忆的完整正文。注入上下文中的记忆若标注"已截断"，且与当前任务相关，应调用本工具（传对应 id）获取全文后再继续。',
    parameters: {
      memoryId: { type: 'string', required: true, description: '要查看的记忆 id（来自注入条目标注的 id）。' }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          memory: { ...memorySchema, required: true },
          notice: { type: 'string' }
        }
      },
      render: (_args, value) => toolTextBlock(value.notice || renderMemoryToolList([value.memory]))
    },
    execute(args) {
      const memoryId = normalizePlainText(args.memoryId, 128);
      if (!memoryId) return { notice: 'memoryId 无效。' };
      const memory = store.memoryById(memoryId);
      if (memory === undefined || memory.status !== 'active') return { notice: '记忆不存在或未启用。' };
      return { memory };
    },
    presentCall: (args) => ({ card: 'generic', title: 'Memory view', kind: 'other', rawInput: args })
  })));
  disposers.push(tools.register(defineTool({
    name: 'memory_update',
    description: '更新一条已有记忆的正文、标签、状态或所属记忆项目。只在用户明确要求修正/更新记忆，或需要消除旧记忆冲突时使用。',
    parameters: {
      memoryId: { type: 'string', required: true, description: '要更新的记忆 id。' },
      text: { type: 'string', description: '新的记忆正文；不提供则不修改正文。代码/项目相关内容使用 JSON 对象：{"位置":["..."],"对象":["..."],"内容":"...","踩坑":"..."}；也接受 paths/symbols/content/pitfall 英文 key；位置和对象必须是字符串数组，内容和踩坑允许换行；不要写源码行号或验证/测试通过段落。' },
      ...commonMemoryParams
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { accepted: { type: 'boolean', required: true } }
      },
      render: (_args, value) => toolTextBlock(value?.accepted === true
        ? '已受理，正在后台更新记忆。可用 memory_search 确认结果；若写入失败会记录在记忆管理弹窗的日志页。'
        : '已受理，正在后台更新记忆。')
    },
    execute(args, exec) {
      return store.updateToolMemory(args, exec.agent?.session?.id);
    },
    presentCall: (args) => ({ card: 'generic', title: 'Memory update', kind: 'other', rawInput: args })
  })));
  disposers.push(tools.register(defineTool({
    name: 'conversation_search',
    description: '跨会话搜索历史对话、助手消息和工具轨迹。适合用户询问“之前/最近/上次/今天/昨天/前天/某天做过什么”、工作回顾，或需要从会话历史而非记忆库查找信息时使用。支持从 query 自动解析今天/昨天/前天/最近N天/本周/上周/本月/上月/具体日期。相同或语义等价查询会被去重；已有结果后不要重复调用。',
    parameters: {
      query: { type: 'string', required: true, description: '搜索关键词或问题，可包含今天/昨天/前天/最近N天/本周/上周/本月/上月/具体日期等时间表达；若只有时间问题，也会按时间范围返回历史活动。' },
      date: { type: 'string', description: '可选时间范围提示，例如 today、yesterday、今天、昨天、前天、最近7天、上周、2026-09-01；省略时从 query 自动解析。' },
      from: { type: 'string', description: '可选开始时间或日期，优先于 date/query 自动解析。' },
      to: { type: 'string', description: '可选结束时间或日期，优先于 date/query 自动解析；日期按当天结束处理。' },
      limit: { type: 'integer', description: `最多返回结果数，最大 ${CONVERSATION_SEARCH_MAX_RESULTS}。` },
      sessionLimit: { type: 'integer', description: `最多扫描会话数，最大 ${CONVERSATION_SEARCH_MAX_SESSIONS}。` },
      includeCurrent: { type: 'boolean', description: '是否包含当前会话，默认 true。' },
      includeSubagents: { type: 'boolean', description: '是否包含子代理/派生会话，默认 false。' },
      includeArchived: { type: 'boolean', description: '是否包含已归档会话，默认 true。' }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          results: { type: 'array', required: true, items: conversationResultSchema },
          count: { type: 'integer', required: true },
          notice: { type: 'string' }
        }
      },
      render: (_args, value) => toolTextBlock(value.notice || renderConversationToolList(value.results))
    },
    async execute(args, exec) {
      const guard = store.activeRecallGuard('conversation_search', args, exec);
      if (guard.blocked) {
        exec.concludeTurn?.();
        return { results: [], count: 0, notice: activeRecallAlreadySatisfiedText('conversation_search') };
      }
      const results = await store.searchConversations(args.query, {
        ...args,
        fallbackSessionId: exec.agent?.session?.id,
        currentSessionId: exec.agent?.session?.id,
        signal: exec.signal
      });
      return { results, count: results.length };
    },
    presentCall: (args) => ({ card: 'generic', title: 'Conversation search', kind: 'other', rawInput: args })
  })));
  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}

export async function installMemoryFeature(ctx) {
  const store = new MemoryStore(ctx);
  const handle = (path, handler) => ctx.webServer.register({ kind: 'exact', path, handler });
  ctx.effect(() => handle(MEMORY_ROUTE, (req, res) => store.handle(req, res)), `${PLUGIN_NAME}: memory HTTP route`);
  ctx.effect(() => handle(MEMORY_DISTILL_ROUTE, (req, res) => store.handle(req, res)), `${PLUGIN_NAME}: memory distill HTTP route`);
  ctx.effect(() => handle('/dsh-session-kit/memory/activity', (req, res) => store.handleActivity(req, res)), `${PLUGIN_NAME}: memory activity route`);
  const tools = ctx.get?.('tools', false);
  if (typeof tools?.register === 'function') ctx.effect(() => registerMemoryTools(ctx, store, tools), `${PLUGIN_NAME}: memory tools`);
  ctx.effect(function* () {
    yield () => store.close();
    yield ctx.on('session/event', (session, event) => {
      if (event.type !== 'turn/end') return;
      const reasonKind = event.data?.reason?.kind;
      const autoEnabled = store.autoDistillEnabled();
      ctx.logger?.info?.(`[${PLUGIN_NAME}] session/event turn/end received: session=${String(session?.id)} turn=${String(event.data?.turn)} reason=${String(reasonKind)} autoDistill=${autoEnabled ? 'on' : 'off'}`);
      if (reasonKind === 'completed' && autoEnabled) store.queueDistill(session, event.data.turn);
    });
    yield ctx.on('agent/pre-step', async ({ agent, messages, turn, signal }, next) => {
      const decision = await next();
      return store.injectRecall(agent, messages, decision, signal, turn);
    }, { prepend: true });
  }, `${PLUGIN_NAME}: memory runtime`);
  return store;
}
