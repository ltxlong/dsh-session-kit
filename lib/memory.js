import { BlockAssembler, createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm';
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
const MAX_TAG_NAME_LENGTH = 32;
const MAX_AUTO_SESSION_IDS = 200;
const MAX_TAGS_PER_MEMORY = 12;
const MAX_SNAPSHOT_MEMORIES = 1200;
const MAX_DISTILL_INPUT_CHARS = 14000;
const MAX_DISTILL_TOOL_ARG_CHARS = 1600;
const MAX_DISTILL_TOOL_RESULT_CHARS = 2200;
const DISTILL_TIMEOUT_MS = 30000;
const DISTILL_MAX_OUTPUT_TOKENS = 512;
const RECALL_TIME_BUDGET_MS = 80;
const RECALL_MAX_CANDIDATES = 40;
const RECALL_MAX_ITEMS = 10;
const RECALL_MAX_CHARS = 3600;
const RECALL_DEDUP_MIN_CHARS = 24;
const RECALL_DEDUP_MAX_MESSAGE_CHARS = 50000;
/* diff 式剔除：正常输入轮召回结果即 top-k 相关性判定——上下文中已注入但本轮
   未进 top-k 的记忆直接剔除，弱输入轮（"继续""10px"）不参与判定、不动上下文。 */
const CUSTOM_TAG_EXACT_WEIGHT = 16;
const CUSTOM_TAG_PARTIAL_WEIGHT = 7;
const CUSTOM_TAG_MAX_WEIGHT = 28;
const CUSTOM_TAG_MAX_MATCHES = 64;
const PROFILE_TAG_MAX_WEIGHT = 4.5;
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

function normalizeDirectoryName(value) {
  const name = normalizePlainText(value, MAX_DIRECTORY_NAME_LENGTH).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ');
  if (name.length === 0) throw new MemoryError('invalid-directory-name', 'directory name must not be empty');
  return name;
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

function normalizeSessionIds(value) {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\s,，;；]+/)
      : [];
  const out = [];
  const seen = new Set();
  for (const raw of source) {
    const value = normalizePlainText(raw, 200);
    if (value.length === 0 || !SESSION_ID_RE.test(value) || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= MAX_AUTO_SESSION_IDS) break;
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

function parseJsonArray(text) {
  if (typeof text !== 'string' || text.trim() === '') return [];
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
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

function routeForDistill(agent, session) {
  const candidates = [
    agent?.session?.requestHeader?.()?.config,
    session?.requestHeader?.()?.config,
    agent?.options
  ];
  for (const candidate of candidates) {
    if (typeof candidate?.provider === 'string' && candidate.provider.length > 0 && typeof candidate?.model === 'string' && candidate.model.length > 0) {
      return { provider: candidate.provider, model: candidate.model };
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

function normalizeDistillList(value, max = 12) {
  return uniqueStrings(Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\n,，;；]+/) : [], max)
    .map((item) => normalizePlainText(item, 240))
    .filter(Boolean);
}

function shouldUseStructuredContent(payload, transcriptText = '') {
  if (Array.isArray(payload?.paths) && payload.paths.length > 0) return true;
  if (Array.isArray(payload?.symbols) && payload.symbols.length > 0) return true;
  const haystack = `${payload?.content ?? ''}\n${transcriptText}`;
  if (extractDistillPaths(haystack).length > 0) return true;
  if (extractDistillSymbols(haystack).length > 0) return true;
  if (detectRecallProfile(haystack) === 'code') return true;
  return /代码|插件|仓库|文件|路径|函数|方法|组件|class|css|接口|API|api|action|route|endpoint|slot|hook|事件|参数|返回|实现|修改|修复|优化|新增|调整|重构|排查|UI|数据库|SQLite|FTS|BM25|React|primitives|node\s+--check|\.[cm]?[jt]sx?\b/i.test(haystack);
}

function cleanDistillPath(value) {
  let text = normalizePlainText(value, 320).replace(/[，。；;、)）\]}]+$/g, '');
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
  return normalizeDistillList(matches, 8);
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
  return normalizeDistillList(matches.filter(isUsefulDistillSymbol), 16);
}

function structuredContentBody(paths, symbols, content) {
  return [
    `位置：${paths.length > 0 ? paths.join('，') : '-'}`,
    `对象：${symbols.length > 0 ? symbols.join('，') : '-'}`,
    `内容：${content}`
  ].join('\n');
}

function formatDistilledContent(payload, transcriptText = '') {
  const content = normalizePlainText(payload?.content ?? payload?.summary ?? payload?.text ?? '', 1500);
  if (content.length < 6) return '';
  if (!shouldUseStructuredContent(payload, transcriptText)) return content;
  const paths = normalizeDistillList(payload?.paths, 8);
  const symbols = normalizeDistillList(payload?.symbols, 16);
  return structuredContentBody(
    paths.length > 0 ? paths : extractDistillPaths(`${content}\n${transcriptText}`),
    symbols.length > 0 ? symbols : extractDistillSymbols(`${content}\n${transcriptText}`),
    content
  );
}

function normalizeDistilledMemoryText(text, transcriptText = '') {
  const content = normalizePlainText(text, 1500);
  if (content.length < 6) return '';
  if (structuredMemoryText(content)) return content;
  if (!shouldUseStructuredContent({ content }, transcriptText)) return content;
  return structuredContentBody(
    extractDistillPaths(`${content}\n${transcriptText}`),
    extractDistillSymbols(`${content}\n${transcriptText}`),
    content
  );
}

function structuredMemoryText(text) {
  return /^位置：[^\n]*\n对象：[^\n]*\n内容：/.test(normalizePlainText(text, 2000));
}

function parseDistillation(text, transcriptText) {
  const parsed = parseJsonObject(text);
  const memory = normalizePlainText(parsed === undefined ? normalizeDistilledMemoryText(stripCodeFence(text), transcriptText) : formatDistilledContent(parsed, transcriptText), 1800);
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

function rowTagNames(row) {
  return listFromSeparated(row.tag_names);
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
    compactQuery: memoryDedupText(raw)
  };
}

function customTagContextHasQuery(context) {
  return Array.isArray(context?.terms) && context.terms.length > 0 || normalizePlainText(context?.compactQuery, 2000).length >= 2;
}

function customTagNameWeight(tag, context) {
  if (MEMORY_PRESET_TAGS.includes(tag)) return 0;
  const terms = Array.isArray(context) ? context : Array.isArray(context?.terms) ? context.terms : [];
  const compactQuery = Array.isArray(context) ? '' : normalizePlainText(context?.compactQuery, 2000);
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
  const updatedAt = Number(row.updated_at) || 0;
  if (updatedAt <= 0) return 0;
  const ageDays = Math.max(0, (startedAt - updatedAt) / 86400000);
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

function rerankRecallRows(rows, profile, startedAt = now(), queryText = '') {
  const weights = recallProfileWeights(profile);
  const customContext = customTagMatchContext(queryText);
  return [...rows]
    .map((row) => {
      const tagWeight = tagWeightForRow(row, weights);
      const customTagWeight = customTagWeightForRow(row, customContext);
      const recencyWeight = recencyWeightForRow(row, startedAt);
      return {
        ...row,
        recall_profile: profile,
        tag_weight: tagWeight,
        custom_tag_weight: customTagWeight,
        recency_weight: recencyWeight,
        final_rank: bm25Weight(row.rank) + customTagWeight + tagWeight + recencyWeight
      };
    })
    .sort((left, right) => right.final_rank - left.final_rank || Number(left.rank ?? 0) - Number(right.rank ?? 0) || Number(right.updated_at ?? 0) - Number(left.updated_at ?? 0));
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
    updatedAt: Number(row.updated_at) || 0
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
    updatedAt: Number(memory.updatedAt) || 0
  };
}

function renderMemoryInjection(hits) {
  const lines = [
    '以下是当前会话已启用记忆项目中召回的相关记忆。若与用户最新消息或显式指令冲突，以用户最新消息和显式指令为准。',
    ''
  ];
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
  const parsed = parseJsonObject(raw);
  if (parsed !== undefined) {
    add(parsed.content);
    add(parsed.summary);
    add(parsed.text);
  }
  const structured = raw.match(/^位置：[^\n]*\n对象：[^\n]*\n内容：([\s\S]+)$/);
  if (structured) add(structured[1]);
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

function packHits(rows, maxItems = RECALL_MAX_ITEMS, maxChars = RECALL_MAX_CHARS) {
  const hits = [];
  let used = 0;
  for (const row of rows) {
    if (hits.length >= maxItems) break;
    const item = memoryFromRow(row, row.persisted !== false);
    const overhead = 120 + (item.directoryName?.length ?? 0) + item.tags.join(',').length;
    const remaining = maxChars - used - overhead;
    if (remaining < 160) break;
    const truncated = item.text.length > remaining;
    const text = truncated ? `${item.text.slice(0, Math.max(80, remaining - 24))}\n…（该记忆已截断）` : item.text;
    hits.push({ ...item, text, truncated, rank: Number(row.rank ?? 0) });
    used += text.length + overhead;
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
      const start = Number(event.surfaceOp?.start);
      const end = Number(event.surfaceOp?.end);
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
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
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
      CREATE INDEX IF NOT EXISTS idx_memories_directory_status ON memories(directory_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memories_hash ON memories(content_hash);
      CREATE INDEX IF NOT EXISTS idx_memory_tags_name ON memory_tags(name);
      CREATE INDEX IF NOT EXISTS idx_memory_session_directories_session ON memory_session_directories(session_id, enabled);
    `);
    this.ensureMemoryStatusSchema();
    this.ensureTagStatusSchema();
    this.ensureDefaultDirectory();
    this.ensurePresetTags();
    this.initFts();
  }

  ensureMemoryStatusSchema() {
    const row = this.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memories'").get();
    const sql = typeof row?.sql === 'string' ? row.sql : '';
    const updateInvalidStatuses = this.db.prepare("UPDATE memories SET status = 'inactive' WHERE status NOT IN ('active', 'inactive')");
    updateInvalidStatuses.run();
    if (!sql.includes("'paused'") && sql.includes("'active'") && sql.includes("'inactive'")) return;
    this.db.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE memories_migrated (
        id TEXT PRIMARY KEY,
        directory_id TEXT NOT NULL REFERENCES memory_directories(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active', 'inactive')),
        content_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO memories_migrated (id, directory_id, body, status, content_hash, created_at, updated_at)
        SELECT id, directory_id, body, CASE WHEN status = 'active' THEN 'active' ELSE 'inactive' END, content_hash, created_at, updated_at FROM memories;
      DROP TABLE memories;
      ALTER TABLE memories_migrated RENAME TO memories;
      CREATE INDEX IF NOT EXISTS idx_memories_directory_status ON memories(directory_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memories_hash ON memories(content_hash);
      PRAGMA foreign_keys = ON;
    `);
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

  close() {
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
      const autoSessionIds = normalizeSessionIds(parseJsonArray(row.auto_session_ids));
      const allSessionsForSession = allSessions && row.name === DEFAULT_MEMORY_DIRECTORY_NAME;
      const autoForSession = sid.length > 0 && autoSessionIds.includes(sid);
      const manualEnabled = allSessionsForSession || Number(row.manual_enabled) === 1;
      return {
        id: row.id,
        name: row.name,
        autoSessionIds,
        autoForSession,
        allSessionsForSession,
        manualEnabled,
        enabledForSession: autoForSession || manualEnabled,
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
        updatedAt: item.updatedAt
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
      sessionId: sid,
      directories,
      tags,
      memories
    };
  }

  ensureDirectory(name, autoSessionIds = []) {
    const directoryName = normalizeDirectoryName(name);
    const existing = this.db.prepare('SELECT * FROM memory_directories WHERE name = ?').get(directoryName);
    if (existing !== undefined) return existing.id;
    const stamp = now();
    const directoryId = id('dir');
    this.db.prepare('INSERT INTO memory_directories (id, name, auto_session_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(directoryId, directoryName, JSON.stringify(normalizeSessionIds(autoSessionIds)), stamp, stamp);
    return directoryId;
  }

  createDirectory(input = {}) {
    this.ensureDirectory(input.name, input.autoSessionIds);
  }

  updateDirectory(input = {}) {
    const directoryId = normalizePlainText(input.directoryId, 128);
    const existing = this.db.prepare('SELECT * FROM memory_directories WHERE id = ?').get(directoryId);
    if (existing === undefined) throw new MemoryError('directory-not-found', 'directory was not found', 404);
    if (PROTECTED_MEMORY_DIRECTORY_NAMES.has(existing.name) && input.name !== undefined && normalizeDirectoryName(input.name) !== existing.name) throw new MemoryError('default-directory-readonly', 'default project cannot be renamed', 400);
    const nextName = input.name === undefined ? existing.name : normalizeDirectoryName(input.name);
    const nextAuto = input.autoSessionIds === undefined ? parseJsonArray(existing.auto_session_ids) : normalizeSessionIds(input.autoSessionIds);
    this.db.prepare('UPDATE memory_directories SET name = ?, auto_session_ids = ?, updated_at = ? WHERE id = ?')
      .run(nextName, JSON.stringify(nextAuto), now(), directoryId);
    this.startFtsRebuild();
  }

  deleteDirectory(input = {}) {
    const directoryId = normalizePlainText(input.directoryId, 128);
    const directory = this.db.prepare('SELECT * FROM memory_directories WHERE id = ?').get(directoryId);
    if (directory === undefined) throw new MemoryError('directory-not-found', 'directory was not found', 404);
    if (PROTECTED_MEMORY_DIRECTORY_NAMES.has(directory.name)) throw new MemoryError('default-directory-readonly', 'default project cannot be deleted', 400);
    const count = Number(this.db.prepare('SELECT COUNT(*) AS count FROM memories WHERE directory_id = ?').get(directoryId)?.count) || 0;
    if (count > 0) throw new MemoryError('directory-has-memories', 'project still has memories and cannot be deleted', 409);
    this.db.prepare('DELETE FROM memory_directories WHERE id = ?').run(directoryId);
    this.startFtsRebuild();
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
    this.ensureTags([name]);
  }

  setTagStatus(input = {}) {
    const tagId = normalizePlainText(input.tagId, 128);
    const row = this.db.prepare('SELECT * FROM memory_tags WHERE id = ?').get(tagId);
    if (row === undefined) throw new MemoryError('tag-not-found', 'tag was not found', 404);
    if (row.preset === 1) return;
    this.db.prepare('UPDATE memory_tags SET status = ?, updated_at = ? WHERE id = ?').run(normalizeStatus(input.status, 'active'), now(), tagId);
    this.startFtsRebuild();
  }

  deleteTag(input = {}) {
    const tagId = normalizePlainText(input.tagId, 128);
    const row = this.db.prepare('SELECT * FROM memory_tags WHERE id = ?').get(tagId);
    if (row === undefined) throw new MemoryError('tag-not-found', 'tag was not found', 404);
    if (row.preset === 1) throw new MemoryError('preset-tag-readonly', 'preset tags cannot be deleted');
    this.db.prepare('DELETE FROM memory_tags WHERE id = ?').run(tagId);
    this.startFtsRebuild();
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

  addEphemeralMemory({ text, tags, session, sourceTurn, distillUsage, directoryId }) {
    const body = normalizePlainText(text, 1800);
    if (body.length < 6) return;
    const hash = memoryHash(body);
    if (this.persistentByHash(hash) !== undefined) return;
    for (const item of this.ephemeral.values()) {
      if (item.hash === hash) {
        item.updatedAt = now();
        const distilled = normalizeTokenUsage(distillUsage);
        if (distilled !== undefined) item.distillUsage = distilled;
        if (Number.isSafeInteger(sourceTurn)) item.sourceTurn = sourceTurn;
        return item;
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
      distillUsage: normalizeTokenUsage(distillUsage),
      createdAt: stamp,
      updatedAt: stamp
    };
    this.ephemeral.set(item.id, item);
    return item;
  }

  createMemory(input = {}) {
    const directoryId = normalizePlainText(input.directoryId, 128);
    const directory = this.db.prepare('SELECT id FROM memory_directories WHERE id = ?').get(directoryId);
    if (directory === undefined) throw new MemoryError('directory-not-found', 'directory was not found', 404);
    const body = normalizePlainText(input.text);
    if (body.length < 6) throw new MemoryError('invalid-memory-text', 'memory text must not be empty');
    const hash = memoryHash(body);
    const duplicate = this.persistentByHash(hash);
    if (duplicate !== undefined) return duplicate;
    const stamp = now();
    const persistentId = id('mem');
    this.db.prepare('INSERT INTO memories (id, directory_id, body, status, content_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(persistentId, directoryId, body, normalizeStatus(input.status, 'active'), hash, stamp, stamp);
    this.setMemoryTags(persistentId, Array.isArray(input.tagNames) ? input.tagNames : []);
    this.reindexMemory(persistentId);
    return persistentId;
  }

  persistMemory(input = {}) {
    const memoryId = normalizePlainText(input.memoryId, 128);
    const item = this.ephemeral.get(memoryId);
    if (item === undefined) throw new MemoryError('ephemeral-memory-not-found', 'ephemeral memory was not found', 404);
    const directoryId = input.directoryId ? normalizePlainText(input.directoryId, 128) : this.resolveToolDirectoryId(input, item.sourceSessionId, body);
    const directory = this.db.prepare('SELECT id FROM memory_directories WHERE id = ?').get(directoryId);
    if (directory === undefined) throw new MemoryError('directory-not-found', 'directory was not found', 404);
    const body = normalizePlainText(input.text ?? item.text);
    if (body.length < 6) throw new MemoryError('invalid-memory-text', 'memory text must not be empty');
    const hash = memoryHash(body);
    const duplicate = this.persistentByHash(hash);
    if (duplicate !== undefined) {
      this.ephemeral.delete(memoryId);
      return duplicate;
    }
    const tagNames = Array.isArray(input.tagNames) ? input.tagNames : item.tags;
    const stamp = now();
    const persistentId = id('mem');
    this.db.prepare('INSERT INTO memories (id, directory_id, body, status, content_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(persistentId, directoryId, body, normalizeStatus(input.status, 'active'), hash, stamp, stamp);
    this.setMemoryTags(persistentId, tagNames);
    this.reindexMemory(persistentId);
    this.ephemeral.delete(memoryId);
    return persistentId;
  }

  updateMemory(input = {}) {
    const memoryId = normalizePlainText(input.memoryId, 128);
    const ephemeral = this.ephemeral.get(memoryId);
    if (ephemeral !== undefined) {
      if (input.text !== undefined) {
        const text = normalizePlainText(input.text, 1800);
        if (text.length < 6) throw new MemoryError('invalid-memory-text', 'memory text must not be empty');
        ephemeral.text = text;
        ephemeral.hash = memoryHash(text);
      }
      if (input.status !== undefined) ephemeral.status = normalizeStatus(input.status, ephemeral.status);
      if (Array.isArray(input.tagNames)) ephemeral.tags = uniqueStrings(input.tagNames, MAX_TAGS_PER_MEMORY).map(normalizeTagName).filter(Boolean);
      ephemeral.updatedAt = now();
      return;
    }
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(memoryId);
    if (row === undefined) throw new MemoryError('memory-not-found', 'memory was not found', 404);
    const body = input.text === undefined ? row.body : normalizePlainText(input.text);
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
  }

  deleteMemory(input = {}) {
    const memoryId = normalizePlainText(input.memoryId, 128);
    if (this.ephemeral.delete(memoryId)) return;
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(memoryId);
    if (this.ftsRebuilding) {
      /* 后台重建进行中：挂起删除，避免"先删行、后批又灌回旧数据"的幽灵行 */
      this.ftsPendingOps.set(memoryId, 'delete');
      return;
    }
    if (this.ftsAvailable) {
      try {
        this.db.prepare('DELETE FROM memory_fts WHERE id = ?').run(memoryId);
      } catch {
        this.startFtsRebuild();
      }
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
      SELECT d.id, d.name, d.auto_session_ids,
        (SELECT enabled FROM memory_session_directories s WHERE s.session_id = ? AND s.directory_id = d.id) AS manual_enabled
      FROM memory_directories d
    `).all(sid);
    return rows.filter((row) => (allSessions && row.name === DEFAULT_MEMORY_DIRECTORY_NAME) || Number(row.manual_enabled) === 1 || normalizeSessionIds(parseJsonArray(row.auto_session_ids)).includes(sid)).map((row) => row.id);
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
    const limit = Number.isSafeInteger(options.limit) && options.limit > 0 ? options.limit : RECALL_MAX_CANDIDATES;
    return this.db.prepare(`
      SELECT m.*, d.name AS directory_name,
        COALESCE((SELECT GROUP_CONCAT(t.id, char(31)) FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active'), '') AS tag_ids,
        COALESCE((SELECT GROUP_CONCAT(t.name, char(31)) FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active'), '') AS tag_names,
        0 AS rank
      FROM memories m JOIN memory_directories d ON d.id = m.directory_id
      WHERE m.directory_id IN (${directoryPlaceholders}) ${statusSql} ${timeSql}
        AND EXISTS (SELECT 1 FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active' AND l.tag_id IN (${tagPlaceholders}))
      ORDER BY m.updated_at DESC
      LIMIT ?
    `).all(...directoryIds, ...statusArgs, ...timeArgs, ...matchedTags.map((row) => row.id), limit);
  }

  recall(sessionId, queryText, options = {}) {
    const startedAt = now();
    const deadline = startedAt + (options.timeBudgetMs ?? RECALL_TIME_BUDGET_MS);
    const enabled = this.enabledDirectoryIds(sessionId);
    if (enabled.length === 0 || now() > deadline) return [];
    const profile = options.profile ?? detectRecallProfile(queryText);
    const terms = extractSearchTerms(queryText);
    const profileTags = recallProfileTags(profile);
    if (terms.length === 0 && profileTags.length === 0) return [];
    const placeholders = enabled.map(() => '?').join(', ');
    const candidateLimit = Math.max(RECALL_MAX_CANDIDATES, (options.maxItems ?? RECALL_MAX_ITEMS) * 8);
    const customContext = customTagMatchContext(queryText);
    const profileWeights = recallProfileWeights(profile);
    const enabledSet = new Set(enabled);
    const activeTagNames = new Set(this.db.prepare("SELECT name FROM memory_tags WHERE status = 'active'").all().map((row) => row.name).filter(Boolean));
    const allowProfileTagFallback = profileAllowsTagFallback(profile);
    const rowMatchesQuery = (row) => row.rank < 0 || customTagWeightForRow(row, customContext) > 0 || (allowProfileTagFallback && tagWeightForRow(row, profileWeights) > 0);
    const ephemeralRows = [...this.ephemeral.values()]
      .filter((item) => item.status === 'active' && item.directoryId && enabledSet.has(item.directoryId))
      .map((item) => ephemeralRecallRow({ ...item, tags: Array.isArray(item.tags) ? item.tags.filter((tag) => activeTagNames.has(tag)) : [] }, terms))
      .filter(rowMatchesQuery)
      .slice(0, candidateLimit);
    let customRows;
    const getCustomRows = () => {
      if (customRows === undefined) customRows = now() > deadline ? [] : this.customTagCandidateRows(enabled, customContext, { status: 'active', limit: candidateLimit });
      return customRows;
    };
    const pack = (rows) => now() > deadline ? [] : packHits(rerankRecallRows(rows, profile, startedAt, queryText), options.maxItems ?? RECALL_MAX_ITEMS, options.maxChars ?? RECALL_MAX_CHARS);
    if (this.ftsAvailable) {
      const query = ftsQuery(queryText);
      if (query) {
        try {
          const rows = this.db.prepare(`
            SELECT m.*, d.name AS directory_name,
              COALESCE((SELECT GROUP_CONCAT(t.id, char(31)) FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active'), '') AS tag_ids,
              COALESCE((SELECT GROUP_CONCAT(t.name, char(31)) FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active'), '') AS tag_names,
              bm25(memory_fts) AS rank
            FROM memory_fts JOIN memories m ON memory_fts.id = m.id JOIN memory_directories d ON d.id = m.directory_id
            WHERE memory_fts MATCH ? AND m.status = 'active' AND m.directory_id IN (${placeholders})
            ORDER BY rank ASC, m.updated_at DESC
            LIMIT ?
          `).all(query, ...enabled, candidateLimit);
          const hits = pack(mergeRecallRows(rows, getCustomRows(), ephemeralRows));
          if (hits.length > 0 || now() > deadline || !allowProfileTagFallback) return hits;
        } catch (error) {
          this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory FTS recall failed; using LIKE fallback:`, error);
        }
      }
    }
    if (now() > deadline) return [];
    const rows = mergeRecallRows(this.db.prepare(`
      SELECT m.*, d.name AS directory_name,
        COALESCE((SELECT GROUP_CONCAT(t.id, char(31)) FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active'), '') AS tag_ids,
        COALESCE((SELECT GROUP_CONCAT(t.name, char(31)) FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active'), '') AS tag_names,
        0 AS rank
      FROM memories m JOIN memory_directories d ON d.id = m.directory_id
      WHERE m.status = 'active' AND m.directory_id IN (${placeholders})
      ORDER BY m.updated_at DESC
      LIMIT 250
    `).all(...enabled)
      .map((row) => ({ ...row, rank: -scoreFallback(row, terms) }))
      .filter(rowMatchesQuery)
      .slice(0, candidateLimit), getCustomRows(), ephemeralRows);
    return pack(rows);
  }

  async distillTurn(session, turn) {
    const rows = turnTranscript(session, turn);
    if (!rows.some((row) => row.role === '用户') || rows.length === 0) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory distill skipped: no user transcript for session ${String(session?.id)} turn ${String(turn)} (rows=${rows.length})`);
      return;
    }
    const transcriptText = truncateMiddle(renderTranscript(rows), MAX_DISTILL_INPUT_CHARS);
    if (transcriptText.length < 20) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory distill skipped: transcript too short (${transcriptText.length} chars) for session ${String(session?.id)} turn ${String(turn)}`);
      return;
    }
    const agent = this.ctx.agents?.get?.(session.id);
    const route = routeForDistill(agent, session);
    if (route === undefined) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory distill skipped: no provider/model route for session ${String(session?.id)} turn ${String(turn)} (agent=${agent === undefined ? 'missing' : 'ok'}, header=${session?.requestHeader?.() === undefined ? 'missing' : 'ok'})`);
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('memory distillation timeout')), DISTILL_TIMEOUT_MS);
    try {
      const prompt = [
        '你是 dsh-session-kit 的本地记忆蒸馏器。请只从下面这一轮对话中提取一条对未来对话长期有用的记忆正文。',
        '要求：',
        '- 只保留稳定事实、用户偏好、项目场景、项目约束、项目架构、模块约束、接口、路径、函数、组件、类名、工作项目或日常生活信息。',
        '- 只输出记忆正文 JSON，不要输出 tags、memory、confidence 等记忆对象字段；标签会由程序根据正文自动分类。',
        '- JSON 固定格式：{"paths":["文件或项目路径"],"symbols":["函数/组件/类名/接口名/API action/CSS class/事件/slot/hook"],"content":"做了什么/约束/摘要/偏好"}。',
        '- paths 用于文件路径、项目路径、模块路径；没有则输出空数组。',
        '- symbols 用于函数、组件、类名、接口名、API action、CSS class、事件、slot、hook、配置项、数据库表等；没有则输出空数组。',
        '- content 必须是一条简洁中文正文，说明做了什么、约束、摘要或偏好。',
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
        sessionId: session.id,
        purpose: 'memory-distill',
        signal: controller.signal
      })) {
        controller.signal.throwIfAborted();
        assembler.push(chunk);
      }
      const output = assembler.blocks().filter((block) => block.type === 'text').map((block) => block.text).join('\n').trim();
      const distilled = parseDistillation(output, transcriptText);
      if (distilled === undefined) {
        this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory distill produced no usable memory for session ${String(session?.id)} turn ${String(turn)} (output=${output.length} chars)`);
        return;
      }
      this.addEphemeralMemory({
        text: distilled.memory,
        tags: distilled.tags,
        session,
        sourceTurn: turn,
        distillUsage: normalizeTokenUsage(assembler.usage) ?? estimateDistillUsage(prompt, output)
      });
      this.ctx.logger?.info?.(`[${PLUGIN_NAME}] memory distilled for session ${String(session?.id)} turn ${String(turn)} (${distilled.memory.length} chars, tags=${distilled.tags.join('/') || '-'})`);
    } catch (error) {
      if (!controller.signal.aborted) this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory distillation failed:`, error);
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
      ORDER BY m.updated_at DESC
      LIMIT 500
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
    const next = previous.catch(() => undefined).then(() => this.distillTurn(session, turn));
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

    /* 落盘：剔除。整条全灭 → surface replace 为空 assistant 消息（tombstone，
       deriveMessages 产出 null）；部分存活 → 原地重写为剩余记忆内容。 */
    for (const event of injectedOnSurface) {
      const survivors = survivorsBySeq.get(event.seq);
      if (survivors === undefined) continue;
      const source = event.data.source;
      if (survivors.length > 0) {
        const keptMessages = survivors.map((id) => this.memoryById(id)).filter(Boolean);
        if (keptMessages.length === 0) continue;
        const text = renderMemoryInjection(keptMessages.map((memory) => ({
          id: memory.id,
          text: memory.text ?? '',
          directoryName: memory.directoryName ?? '',
          tags: Array.isArray(memory.tags) ? memory.tags : [],
          updatedAt: memory.updatedAt ?? 0
        })));
        session.append('user/message', {
          ...event.data,
          content: [{ type: 'text', text }],
          /* 快照与重写后的 hitIds/正文保持 1:1：被剔除条目同步移出快照，
             保证面板（按快照展示）、注入正文与模型上下文三者一致。 */
          source: { ...source, hitIds: survivors, snapshot: Array.isArray(source.snapshot) ? source.snapshot.filter((hit) => survivors.includes(normalizePlainText(String(hit?.id ?? ''), 128))) : source.snapshot, summary: `命中 ${survivors.length} 条` }
        }, { surfaceOp: { op: 'replace', start: event.seq, end: event.seq }, sourceEventSeqs: [event.seq] });
      } else {
        session.append('assistant/message', {
          turn: event.data?.turn ?? 0,
          step: 0,
          message: createAssistantMessage({ content: [], source: { provider: MEMORY_EJECT_PROVIDER, model: MEMORY_EJECT_MODEL } })
        }, { surfaceOp: { op: 'replace', start: event.seq, end: event.seq }, sourceEventSeqs: [event.seq] });
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
        case 'delete-tag': this.deleteTag(body); break;
        case 'create-memory': this.createMemory(body); break;
        case 'persist-memory': this.persistMemory(body); break;
        case 'update-memory': this.updateMemory(body); break;
        case 'delete-memory': this.deleteMemory(body); break;
        case 'set-session-directory': this.setSessionDirectory(body); break;
        case 'set-auto-distill': this.setAutoDistill(body); break;
        case 'set-all-sessions-enabled': this.setAllSessionsEnabled(body); break;
        case 'set-first-turn-auto-match': this.setFirstTurnAutoMatch(body); break;
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
          const turn = Number(body.turn);
          if (!Number.isSafeInteger(turn) || turn < 0) throw new MemoryError('invalid-turn', 'turn must be a non-negative integer', 400);
          const session = this.ctx.sessions?.get?.(sessionId);
          if (session === undefined) throw new MemoryError('session-not-found', 'session was not found', 404);
          await this.distillTurn(session, turn);
          break;
        }
        case 'distill-now': {
          const sessionId = normalizePlainText(body.sessionId, 128);
          const session = this.ctx.sessions?.get?.(sessionId);
          const turn = lastCompletedTurn(session);
          if (session !== undefined && turn !== undefined) await this.distillTurn(session, turn);
          break;
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
      updatedAt: ephemeral.updatedAt
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

  addToolMemory(input = {}, sessionId = '') {
    const body = normalizePlainText(input.text ?? input.content, 1800);
    if (body.length < 6) throw new MemoryError('invalid-memory-text', 'memory text must not be empty');
    const hash = memoryHash(body);
    const duplicate = this.persistentByHash(hash);
    if (duplicate !== undefined) return { memory: this.memoryById(duplicate), duplicate: true };
    const directoryId = this.resolveToolDirectoryId(input, sessionId, body);
    const tagNames = Array.isArray(input.tags) || Array.isArray(input.tagNames)
      ? uniqueStrings(input.tags ?? input.tagNames, MAX_TAGS_PER_MEMORY).map(normalizeTagName).filter(Boolean)
      : normalizeTagNames(undefined, body);
    const status = normalizeStatus(input.status, 'active');
    const stamp = now();
    const memoryId = id('mem');
    this.db.prepare('INSERT INTO memories (id, directory_id, body, status, content_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(memoryId, directoryId, body, status, hash, stamp, stamp);
    this.setMemoryTags(memoryId, tagNames);
    this.reindexMemory(memoryId);
    return { memory: this.memoryById(memoryId), duplicate: false };
  }

  stopMemory(input = {}) {
    const memoryId = normalizePlainText(input.memoryId, 128);
    if (!memoryId) throw new MemoryError('invalid-memory-id', 'memoryId must not be empty', 400);
    this.updateMemory({ memoryId, status: 'inactive' });
    const memory = this.memoryById(memoryId);
    if (memory === undefined) throw new MemoryError('memory-not-found', 'memory was not found', 404);
    return memory;
  }

  updateToolMemory(input = {}) {
    const memoryId = normalizePlainText(input.memoryId, 128);
    if (!memoryId) throw new MemoryError('invalid-memory-id', 'memoryId must not be empty', 400);
    const payload = { memoryId };
    if (input.text !== undefined || input.content !== undefined) payload.text = input.text ?? input.content;
    if (input.status !== undefined) payload.status = input.status;
    if (Array.isArray(input.tags) || Array.isArray(input.tagNames)) payload.tagNames = input.tags ?? input.tagNames;
    if (input.directoryId !== undefined) payload.directoryId = input.directoryId;
    else if (input.directoryName !== undefined || input.directory !== undefined) payload.directoryId = this.resolveToolDirectoryId(input);
    if (Object.keys(payload).length <= 1) throw new MemoryError('empty-update', 'provide text, tags, status, or directory to update', 400);
    this.updateMemory(payload);
    const memory = this.memoryById(memoryId);
    if (memory === undefined) throw new MemoryError('memory-not-found', 'memory was not found', 404);
    return memory;
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
    const rowsForPack = Math.max(RECALL_MAX_CANDIDATES, limit * 8);
    const customContext = customTagMatchContext(searchText || queryText);
    const customRows = this.customTagCandidateRows(directoryIds, customContext, { status, timeRange, limit: rowsForPack });
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
          ORDER BY rank ASC, m.updated_at DESC
          LIMIT ?
        `).all(query, ...directoryIds, ...statusArgs, ...timeArgs, rowsForPack), customRows);
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
        ORDER BY m.updated_at DESC
        LIMIT 500
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
    if (sessions.length < sessionLimit && typeof this.ctx.sessionPersistence?.list === 'function' && typeof this.ctx.sessionPersistence?.inspect === 'function') {
      const headers = await this.ctx.sessionPersistence.list(options.signal).catch((error) => {
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
          const inspection = await this.ctx.sessionPersistence.inspect(idText, options.signal);
          const session = { id: inspection.meta.id, header: inspection.meta, events: inspection.events };
          seen.add(idText);
          sessions.push(session);
        } catch (error) {
          if (options.signal?.aborted) throw error;
          this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] conversation_search inspect failed for ${idText}:`, error);
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
      updatedAt: { type: 'integer', required: true }
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
      text: { type: 'string', required: true, description: '记忆正文。代码/项目相关内容建议使用“位置：...\n对象：...\n内容：...”格式。' },
      ...commonMemoryParams
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          memory: { ...memorySchema, required: true },
          duplicate: { type: 'boolean', required: true }
        }
      },
      render: (_args, value) => toolTextBlock(`${value.duplicate ? '已存在相同记忆，返回原记录：' : '已新增记忆：'}\n${renderMemoryToolList([value.memory])}`)
    },
    execute(args, exec) {
      const sessionId = normalizeToolSessionId(args.sessionId, exec.agent?.session?.id);
      return store.addToolMemory(args, sessionId);
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
    name: 'memory_update',
    description: '更新一条已有记忆的正文、标签、状态或所属记忆项目。只在用户明确要求修正/更新记忆，或需要消除旧记忆冲突时使用。',
    parameters: {
      memoryId: { type: 'string', required: true, description: '要更新的记忆 id。' },
      text: { type: 'string', description: '新的记忆正文；不提供则不修改正文。' },
      ...commonMemoryParams
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { memory: { ...memorySchema, required: true } }
      },
      render: (_args, value) => toolTextBlock(`已更新记忆：\n${renderMemoryToolList([value.memory])}`)
    },
    execute(args) {
      return { memory: store.updateToolMemory(args) };
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
