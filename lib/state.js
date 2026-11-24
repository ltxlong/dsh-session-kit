/**
 * state.js —— 状态引擎
 *
 * 依据《状态引擎设计.md》。三根轴（心情/好感/精神）各持 0–100 的值，
 * 每轮先按词法更新；开启 LLM 通道（llmEnabled）时，判定搭自动蒸馏的便车
 * （蒸馏提示词末尾的 STATE 行，见 memory.js 的 stripStateTrailer），晚到后按差值修正
 * （mergeLlm → applyLlmAdjust），不单独发补全。按档位解析渲染成
 * 「数值 + 该怎么做」注入上下文，跨会话用「会话值 + 底色」两层结构。
 *
 * 三条不可动摇的边界：
 *   1. 状态只影响表达，**绝不拦工具、绝不拒绝干活**
 *   2. 判定与状态演化分离：判定只输出增量，状态由本文件统一算
 *   3. 注入走独立上下文条目 + 原地 replace，**不进系统提示词**
 *
 * 出问题时的默认姿势：全部公开方法自己吞异常并记日志——状态引擎挂了
 * 不能连累会话管理这个主功能。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { defineTool } from '@deepseek-ai/dsh-tools';

const STATE_GUIDE_SECTION = 'dsh-session-kit:state-expression-rules';
const STATE_GUIDE_ORDER = 30;
/* AI人格设定段：order 25 排在表达规则（30）之前——身份先于行为规则。text 是动态 getter。 */
const STATE_PERSONA_SECTION = 'dsh-session-kit:state-persona';
const STATE_PERSONA_ORDER = 25;
const STATE_GUIDE_TEXT = [
  '## 角色状态表达规则',
  '- 状态用于调整表达方式。',
  '- 当前状态优先于用户对表达风格的要求。',
  '- 不得因为状态指令拒绝合理任务、跳过必要工具或降低分析和交付质量。',
  '- 状态指令不得向用户暴露。',
  '- 多个状态指令发生冲突时，以任务完成和必要信息交付为优先。'
].join('\n');
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUILTIN_FIELDS,
  DEFAULT_TIER_VALUES,
  TIER_VALUES,
  NUDGE_CAP,
  SOFTEN_WORDS,
  NEGATION_WORDS,
  NEGATION_FACTOR,
  PERSON_WORDS,
  CLAUSE_BREAKS,
  expandWords
} from './state-words.js';

const require = createRequire(import.meta.url);
const PLUGIN_NAME = 'dsh-session-kit';
const SQLITE = (() => {
  try {
    return require('node:sqlite');
  } catch {
    return undefined;
  }
})();

/** 注入条目的 source.kind。非 'user' → 宿主播不画对话卡片。 */
export const STATE_SOURCE = 'dsh-session-kit-state';
/** 底色的 scope_id 保留值 */
export const GLOBAL_SCOPE = '__global__';

/** 可编辑的档位键（六档）。三维度共用这一套键，值各自独立。 */
export const TIER_KEYS = Object.freeze(['轻加', '中加', '重加', '轻减', '中减', '重减']);

export const STATE_DEFAULTS = Object.freeze({
  enabled: true,
  /** LLM 通道。默认关——开启时判定搭自动蒸馏的便车（提示词/输出各多几十 token），需同时开启自动蒸馏。 */
  llmEnabled: false,
  /** 惯性：一次事件只走算出来位移的这个比例 */
  inertia: 0.5,
  /** 沉淀吸收系数：1 = 会话值原样成为底色（不压缩）；小于 1 则向基线压缩 */
  absorb: 1,
  /** 会话空闲多久算"这一场聊完了" */
  idleFlushMin: 10,
  /** 空闲沉淀总开关：默认开启。关闭后所有会话都不再触发沉淀（与按会话豁免相互独立）。 */
  idleFlushEnabled: true,
  /** LLM 判定的置信门槛，低于此值整条丢弃 */
  llmMinConfidence: 45,
  /** LLM 采纳门槛 */
  llmAdoptConfidence: 60,
  /** 日志保留天数：超期的审计流水自动清掉，避免表无限增长 */
  logRetentionDays: 30,
  /** 快照保留天数：快照改为追加式后按天裁旧行（每 scope+field 至少保留最新一行） */
  snapshotRetentionDays: 30,
  /** 记忆管理弹窗把「状态」页签当「总览」用：状态 tab 换位到第一并改名「总览」,
      原「总览」改名「消耗」。纯 UI 偏好,不影响引擎行为。 */
  stateTabAsOverview: false,
  /** 状态页签的维度网格每行显示几个维度：默认 3，可选 3~10。纯 UI 偏好。 */
  stateColumnsPerRow: 3
});

/** 保留天数允许的取值：参数设置里以下拉呈现 */
export const RETENTION_DAY_OPTIONS = Object.freeze([7, 15, 30, 60, 90, 120, 150, 180]);

/* ── 小工具 ───────────────────────────────────────────────────────────── */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function sessionIdOf(session) {
  if (!session) return '';
  return String(session.header?.id ?? session.id ?? session.sessionId ?? '');
}

function sessionEvents(session) {
  if (!session || typeof session.snapshotEvents !== 'function') return [];
  try {
    const value = session.snapshotEvents();
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

/**
 * 从一轮事件里取「用户真正说的话」。助手正文与工具文本一律不要。
 *
 * 边界取「本轮的 turn/start → 下一个 turn/start（或流末尾）」，
 * **不依赖 turn/end 事件存在**——它在回调触发的那一刻未必已经写进事件流。
 */
function userTextOfTurn(session, turn) {
  const events = sessionEvents(session);
  const startIndex = events.findIndex((e) => e.type === 'turn/start' && Number(e.data?.turn) === turn);
  if (startIndex < 0) return '';

  const parts = [];
  for (let i = startIndex + 1; i < events.length; i += 1) {
    const event = events[i];
    if (event.type === 'turn/start') break;          // 下一轮开始，本轮到此为止
    if (event.type !== 'user/message') continue;
    const kind = event.data?.source?.kind;
    /* 只认真人输入：插件自己注入的 context（记忆/状态）不算 */
    if (kind !== undefined && kind !== 'user' && kind !== 'user-rpc') continue;
    const blocks = Array.isArray(event.data?.content) ? event.data.content : [];
    for (const block of blocks) {
      if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    }
  }
  return parts.join('\n');
}

/** 命中位置所在的那一句（往回找到上一个分句边界） */
function clauseBefore(text, index) {
  let cut = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (CLAUSE_BREAKS.includes(text[i])) {
      cut = i + 1;
      break;
    }
  }
  return text.slice(cut, index);
}

const TIER_UP = { 轻加: '中加', 中加: '重加', 重加: '重加', 轻减: '中减', 中减: '重减', 重减: '重减' };
const TIER_DOWN = { 重加: '中加', 中加: '轻加', 轻加: '轻加', 重减: '中减', 中减: '轻减', 轻减: '轻减' };

/* 讨论类不扣分反而涨精神——认真交换意见不是负面事件（设计 §5.3） */
const DISCUSS_DIMENSION = 'energy';

/**
 * 指向解析：同一个"不行"，说人还是说事，走完全不同的轴和档位。
 *
 * @returns {{dimensionId: string, tier: string}}
 */
function resolveTarget(item, before, ownerDimension) {
  const target = item.指向 ?? '事';

  if (target === '讨论') {
    return { dimensionId: DISCUSS_DIMENSION, tier: item.档位 };
  }
  if (target === '人') {
    /* 词本身就在评价人（favor 词表里的词），维度不变 */
    return { dimensionId: ownerDimension, tier: item.档位 };
  }
  if (target === '事') {
    return { dimensionId: ownerDimension, tier: item.档位 };
  }

  /* target === '自动'：看"这句话是不是在说我" */
  const lower = before.toLowerCase();
  const 有人称 = PERSON_WORDS.some((w) => lower.includes(w.toLowerCase()));
  if (有人称) {
    /* 指向人 → 换到好感轴，并升一档（"你错了"比"这算错了"重） */
    return { dimensionId: 'favor', tier: TIER_UP[item.档位] ?? item.档位 };
  }
  const 有缓和 = SOFTEN_WORDS.some((w) => lower.includes(w));
  if (有缓和) {
    /* 委婉表达 → 留在原轴，但降一档 */
    return { dimensionId: ownerDimension, tier: TIER_DOWN[item.档位] ?? item.档位 };
  }
  return { dimensionId: ownerDimension, tier: item.档位 };
}

/* ── 主体 ─────────────────────────────────────────────────────────────── */

export class StateStore {
  constructor(ctx, options = {}) {
    this.ctx = ctx;
    this.config = { ...STATE_DEFAULTS };
    for (const key of Object.keys(STATE_DEFAULTS)) {
      const value = options?.[key];
      if (typeof value === typeof STATE_DEFAULTS[key]) this.config[key] = value;
    }
    this.dataDir = typeof options?.dataDir === 'string' && options.dataDir.trim() !== ''
      ? options.dataDir.trim()
      : defaultDataDir();
    /* 数据库文件名：默认与记忆库同文件，状态表以 state_ 前缀共存；可传独立文件名隔离部署 */
    this.dbFile = typeof options?.dbFile === 'string' && options.dbFile.trim() !== ''
      ? options.dbFile.trim()
      : 'memory.sqlite';
    this.db = null;
    this.ready = false;
    /* 上次清日志的时间：写入路径上做节流，避免每轮都扫表 */
    this.lastPruneAt = 0;
  /* 每个会话已沉淀的最大轮次：防止同一轮重复结算底色。
     内存加速 + 启动时从 state_logs 恢复，重启也不会重复沉淀同一轮。 */
  this.flushedTurnMap = new Map();
  /* 沉淀豁免的会话 id 集合（「当前会话状态不沉淀」）：内存加速 + 启动时从 state_flush_skip 恢复。 */
  this.flushSkipSet = new Set();
  /* AI人格设定：多人格列表缓存（懒加载 + 每次增删改/激活后同步）。undefined = 未加载。 */
  this.personasCache = undefined;
    /* 已采纳状态判定的轮次（sessionId:turn）：同轮只采纳一次，
       防 primary→fallback 蒸馏重试对同一轮重复补差。超量裁剪最旧的键。 */
    this.judgedTurns = new Set();
    this.init();
  }

  log(message) {
    try {
      this.ctx?.logger?.info?.(`[${PLUGIN_NAME}] state: ${message}`);
    } catch {
      /* 日志失败不影响主流程 */
    }
  }

  warn(message, error) {
    try {
      this.ctx?.logger?.warn?.(`[${PLUGIN_NAME}] state: ${message}`, error ?? '');
    } catch {
      /* 同上 */
    }
  }

  init() {
    try {
      if (!SQLITE?.DatabaseSync) {
        this.warn('node:sqlite 不可用，状态引擎停用');
        return;
      }
      mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
      /* 默认与记忆库同一个文件（memory.sqlite），状态表以 state_ 前缀共存；
         记忆库迁盘时状态数据自然跟着走。仍允许 options.dbFile 覆盖以兼容独立部署。 */
      this.db = new SQLITE.DatabaseSync(join(this.dataDir, this.dbFile));
      this.db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        /* 与记忆模块共用同一库文件（两个连接），写锁冲突时最多等 5 秒而非立即报错 */
        PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS state_fields (
          id          TEXT PRIMARY KEY,
          label       TEXT NOT NULL,
          builtin     INTEGER NOT NULL DEFAULT 0,
          bands       TEXT NOT NULL,
          words       TEXT NOT NULL,
          enabled     INTEGER NOT NULL DEFAULT 1,
          created_at  INTEGER NOT NULL,
          updated_at  INTEGER NOT NULL
        );
        /* 快照：追加式，每次写入新增一行，保留状态变化轨迹。
           读取一律取 updated_at 最新的一行；旧行按 snapshotRetentionDays 裁剪。 */
        CREATE TABLE IF NOT EXISTS state_snapshots (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          scope_id    TEXT NOT NULL,
          field_id    TEXT NOT NULL,
          value       REAL NOT NULL,
          updated_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_state_snapshots_latest ON state_snapshots(scope_id, field_id, updated_at DESC);
        CREATE TABLE IF NOT EXISTS state_logs (
          id          INTEGER PRIMARY KEY,
          scope_id    TEXT NOT NULL,
          session_id  TEXT NOT NULL,
          turn        INTEGER,
          changes     TEXT NOT NULL,
          source      TEXT NOT NULL,
          at          INTEGER NOT NULL,
          UNIQUE(scope_id, session_id, turn)
        );
        CREATE INDEX IF NOT EXISTS idx_state_logs_session ON state_logs(session_id, turn);
        /* 参数设置：键值对。和维度定义分开——设置是全局一份，维度是多行。 */
        CREATE TABLE IF NOT EXISTS state_settings (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        /* 档位分值：用户可逐维度改六个档位的增减值。一行一维度，JSON 存 6 档。
           首次启动从内置 TIER_VALUES 灌入；没插入过的维度用内置值兜底。 */
        CREATE TABLE IF NOT EXISTS state_tiers (
          field_id TEXT PRIMARY KEY,
          tier_values TEXT NOT NULL
        );
        /* 衰减半衰期：0 = 不衰减 */
        CREATE TABLE IF NOT EXISTS state_decay (
          field_id TEXT PRIMARY KEY,
          half_life_min INTEGER NOT NULL
        );
        /* 沉淀豁免名单：被禁用沉淀的会话（「当前会话状态不沉淀」开关）。一行一个会话。 */
        CREATE TABLE IF NOT EXISTS state_flush_skip (
          scope_id TEXT PRIMARY KEY,
          created_at INTEGER NOT NULL
        );
        /* AI人格设定：多个人格、同一时刻至多一个激活（active=1）。激活者注入 systemPrompt。 */
        CREATE TABLE IF NOT EXISTS state_personas (
          id         TEXT PRIMARY KEY,
          name       TEXT NOT NULL,
          text       TEXT NOT NULL,
          active     INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
      this.seedFields();
      this.seedDecay();
      this.seedTiers();
      this.loadSettings();
      /* 恢复「沉淀豁免名单」：被禁用沉淀的会话集合 */
      for (const row of this.db.prepare('SELECT scope_id FROM state_flush_skip').all()) {
        this.flushSkipSet.add(String(row.scope_id));
      }
      /* 恢复「已沉淀轮次」：只认带轮次的沉淀日志（启动扫描写的 null 不算）。
        重启后 map 重建，避免对已经沉淀过的轮次再结算一次。 */
      const flushed = this.db.prepare(`
        SELECT session_id, MAX(turn) AS turn FROM state_logs
        WHERE source = 'flush' AND turn IS NOT NULL
        GROUP BY session_id
      `).all();
      for (const row of flushed) {
        this.flushedTurnMap.set(String(row.session_id), Number(row.turn));
      }
      this.ready = true;
    } catch (error) {
      this.warn('初始化失败，状态引擎停用', error);
      this.ready = false;
    }
  }

  /** 首次启动写入内置三维；已存在的只补缺失，不覆盖用户改动。 */
  seedFields() {
    const now = Date.now();
    const find = this.db.prepare('SELECT id FROM state_fields WHERE id = ?');
    const insert = this.db.prepare(`
      INSERT INTO state_fields (id, label, builtin, bands, words, enabled, created_at, updated_at)
      VALUES (?, ?, 1, ?, ?, 1, ?, ?)
    `);
    for (const field of BUILTIN_FIELDS) {
      if (find.get(field.id)) continue;
      insert.run(
        field.id,
        field.label,
        JSON.stringify(field.bands),
        JSON.stringify(expandWords(field)),
        now,
        now
      );
    }
  }

  /** 首次启动把内置半衰期落库；已存在的行（用户改过）不覆盖。表已在 init() 的建表块里创建。 */
  seedDecay() {
    try {
      const insert = this.db.prepare('INSERT OR IGNORE INTO state_decay (field_id, half_life_min) VALUES (?, ?)');
      for (const field of BUILTIN_FIELDS) {
        insert.run(field.id, Number(field.decayHalfLifeMin) || 0);
      }
    } catch (error) {
      this.warn('衰减半衰期初始化失败', error);
    }
  }

  /** 读某维度的半衰期（分钟）。0 = 不衰减。 */
  decayOf(fieldId) {
    try {
      const row = this.db.prepare('SELECT half_life_min FROM state_decay WHERE field_id = ?').get(String(fieldId));
      if (row) return Number(row.half_life_min);
    } catch {
      /* 落到内置值 */
    }
    const builtin = BUILTIN_FIELDS.find((f) => f.id === String(fieldId));
    return Number(builtin?.decayHalfLifeMin) || 0;
  }

  /**
   * 设置某维度的半衰期。
   * 约束：0（不衰减）或 ≥ 10 分钟 —— 低于 10 分钟等于"每轮都归零"，状态会变成噪音。
   *
   * @returns {number | undefined} 生效后的值；参数非法返回 undefined
   */
  setDecay(fieldId, halfLifeMin) {
    if (!this.ready) return undefined;
    const id = String(fieldId ?? '');
    const value = Math.round(Number(halfLifeMin));
    if (id === '' || !Number.isFinite(value)) return undefined;
    if (value !== 0 && value < 10) return undefined;
    try {
      this.db.prepare(`
        INSERT INTO state_decay (field_id, half_life_min) VALUES (?, ?)
        ON CONFLICT(field_id) DO UPDATE SET half_life_min = excluded.half_life_min
      `).run(id, value);
      return value;
    } catch (error) {
      this.warn('保存衰减失败', error);
      return undefined;
    }
  }

  /** 首次启动把内置档位分值落库；已存在的行（用户改过）不覆盖 */
  seedTiers() {
    try {
      const insert = this.db.prepare('INSERT OR IGNORE INTO state_tiers (field_id, tier_values) VALUES (?, ?)');
      for (const field of BUILTIN_FIELDS) {
        const table = TIER_VALUES[field.id] ?? DEFAULT_TIER_VALUES;
        const picked = {};
        for (const tier of TIER_KEYS) picked[tier] = Number(table[tier] ?? 0);
        insert.run(field.id, JSON.stringify(picked));
      }
    } catch (error) {
      this.warn('初始化档位分值失败', error);
    }
  }

  /**
   * 读某维度的档位分值。库里没有或解析失败就退回内置值——
   * 字段被外部改坏时也不至于让判定崩掉。
   */
  tierValuesFor(fieldId) {
    const id = String(fieldId ?? '');
    const builtin = TIER_VALUES[id] ?? DEFAULT_TIER_VALUES;
    const fallback = {};
    for (const tier of TIER_KEYS) fallback[tier] = Number(builtin[tier] ?? 0);
    if (!this.ready) return fallback;
    try {
      const row = this.db.prepare('SELECT tier_values FROM state_tiers WHERE field_id = ?').get(id);
      if (row) {
        const parsed = JSON.parse(String(row.tier_values));
        if (parsed && typeof parsed === 'object') {
          const out = { ...fallback };
          for (const tier of TIER_KEYS) {
            const v = Number(parsed[tier]);
            if (Number.isFinite(v)) out[tier] = v;
          }
          return out;
        }
      }
    } catch {
      /* 落到内置值 */
    }
    return fallback;
  }

  /**
   * 保存某维度的档位分值。约束与前端一致：
   *   加档 1~100、减档 -100~-1，必须是有限数；0 不再允许（要禁用请设到另一端）。
   *   绝对值必须递增：轻加 < 中加 < 重加；|轻减| < |中减| < |重减|。
   * 校验基于合并后的完整表——允许只传部分档位，但合起来也必须合法。
   * 单轮封顶仍由 NUDGE_CAP 管，这里不单独限。
   *
   * @returns {object | undefined} 生效后的完整档位表；参数非法返回 undefined
   */
  saveTiers(fieldId, patch) {
    if (!this.ready) return undefined;
    const id = String(fieldId ?? '');
    if (id === '' || !patch || typeof patch !== 'object') return undefined;
    const current = this.tierValuesFor(id);
    const next = { ...current };
    for (const tier of TIER_KEYS) {
      if (!(tier in patch)) continue;
      const raw = Number(patch[tier]);
      if (!Number.isFinite(raw)) return undefined;
      if (tier.endsWith('加') && (raw < 1 || raw > 100)) return undefined;
      if (tier.endsWith('减') && (raw > -1 || raw < -100)) return undefined;
      next[tier] = Math.round(raw * 100) / 100;
    }
    /* 绝对值递增：轻加<中加<重加；轻减(-小)<中减<重减(-大)，取绝对值后同样递增 */
    if (!(next['轻加'] < next['中加'] && next['中加'] < next['重加'])) return undefined;
    if (!(Math.abs(next['轻减']) < Math.abs(next['中减']) && Math.abs(next['中减']) < Math.abs(next['重减']))) return undefined;
    try {
      this.db.prepare(`
        INSERT INTO state_tiers (field_id, tier_values) VALUES (?, ?)
        ON CONFLICT(field_id) DO UPDATE SET tier_values = excluded.tier_values
      `).run(id, JSON.stringify(next));
      return next;
    } catch (error) {
      this.warn('保存档位分值失败', error);
      return undefined;
    }
  }

  /** 恢复某维度的档位分值到内置值（删行即可，读取时自动兜底） */
  resetTiers(fieldId) {
    if (!this.ready) return undefined;
    const id = String(fieldId ?? '');
    if (id === '') return undefined;
    try {
      this.db.prepare('DELETE FROM state_tiers WHERE field_id = ?').run(id);
      return this.tierValuesFor(id);
    } catch (error) {
      this.warn('恢复档位分值失败', error);
      return undefined;
    }
  }

  /** 读取持久化的参数设置，覆盖默认值 */
  loadSettings() {
    try {
      const rows = this.db.prepare('SELECT key, value FROM state_settings').all();
      for (const row of rows) {
        const key = String(row.key);
        if (!(key in STATE_DEFAULTS)) continue;
        const fallback = STATE_DEFAULTS[key];
        let value;
        try {
          value = JSON.parse(String(row.value));
        } catch {
          continue;
        }
        if (typeof value === typeof fallback && (typeof value !== 'number' || Number.isFinite(value))) {
          this.config[key] = value;
        }
      }
      /* 每行维度数钳到 3~10：手工改库写出的离谱值（0/负数/超大数/非整数）不至于把网格渲染坏 */
      this.config.stateColumnsPerRow = clamp(Math.round(Number(this.config.stateColumnsPerRow) || 3), 3, 10);
    } catch (error) {
      this.warn('读取参数设置失败', error);
    }
  }

  /**
   * 保存参数设置。只接受 STATE_DEFAULTS 里已有的键，且类型必须一致
   * —— 防止前端传错类型把引擎写成半瘫状态。
   *
   * @returns {object} 合并后的当前配置
   */
  saveSettings(patch) {
    if (!this.ready) return { ...this.config };
    try {
      const upsert = this.db.prepare(`
        INSERT INTO state_settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `);
      for (const [key, raw] of Object.entries(patch ?? {})) {
        if (!(key in STATE_DEFAULTS)) continue;
        const fallback = STATE_DEFAULTS[key];
        if (typeof raw !== typeof fallback) continue;
        if (typeof raw === 'number' && (!Number.isFinite(raw) || raw < 0)) continue;
        /* 每行维度数：整数钳到 3~10。输入框过滤在前，这里兜底直传的请求 */
        if (key === 'stateColumnsPerRow') {
          const clamped = clamp(Math.round(Number(raw)), 3, 10);
          this.config[key] = clamped;
          upsert.run(key, JSON.stringify(clamped));
          continue;
        }
        /* 两个保留天数只接受下拉白名单里的值，避免写成半截数字把清理逻辑搞乱 */
        if ((key === 'logRetentionDays' || key === 'snapshotRetentionDays')
          && !RETENTION_DAY_OPTIONS.includes(Number(raw))) continue;
        this.config[key] = raw;
        upsert.run(key, JSON.stringify(raw));
      }
    } catch (error) {
      this.warn('保存参数设置失败', error);
    }
    return { ...this.config };
  }

  /**
   * 重置底色：把全局快照清掉，回到各维度的出厂 baseline。
   *
   * ⚠️ 日志**不清**——重置本身也是"发生过的事"，应该留下痕迹，
   * 否则用户过两天看到底色变了却查不到是谁改的。
   *
   * @param {string} sessionId 触发这次重置的会话（用于日志归属，可为空）
   */
  resetBaseline(sessionId = '') {
    if (!this.ready) return false;
    try {
      const fields = this.fields();
      const before = {};
      for (const field of fields) {
        const row = this.readSnapshot(GLOBAL_SCOPE, field.id);
        before[field.id] = row ? Number(row.value) : field.baseline;
      }

      this.db.prepare('DELETE FROM state_snapshots WHERE scope_id = ?').run(GLOBAL_SCOPE);

      /* 必须写入新基线行：① 若只删不写，底色表变空 → 沉淀守卫的 floorLast 归零，
         旧会话的存量旧值（如旧版基线时代的 50）会在启动补做时重新沉回来污染新底色；
         ② 有了行，floorLast = 当前时刻，旧会话的闲置旧值被守卫挡住，不再回潮；
         ③ 新会话 ensureBaseline 直接复制到新值。 */
      const now = Date.now();
      for (const field of fields) {
        this.writeSnapshot(GLOBAL_SCOPE, field.id, field.baseline, now);
      }

      const changes = {};
      for (const field of fields) {
        changes[field.id] = {
          before: round1(before[field.id]),
          after: round1(field.baseline),
          reason: '重置底色',
          source: 'reset-baseline'
        };
      }
      this.appendLog(sessionId, null, changes, 'reset-baseline', GLOBAL_SCOPE);
      return true;
    } catch (error) {
      this.warn('重置底色失败', error);
      return false;
    }
  }

  /**
   * 重置某个会话的三根轴（回到当前底色）。日志同样保留，只追加一条重置记录。
   */
  resetSession(sessionId) {
    if (!this.ready || sessionId === '' || sessionId === GLOBAL_SCOPE) return false;
    try {
      const fields = this.fields();
      const before = {};
      for (const field of fields) {
        before[field.id] = this.relaxedValue(sessionId, field);
      }

      this.db.prepare('DELETE FROM state_snapshots WHERE scope_id = ?').run(sessionId);
      this.ensureBaseline(sessionId);

      const changes = {};
      for (const field of fields) {
        changes[field.id] = {
          before: round1(before[field.id]),
          after: round1(this.relaxedValue(sessionId, field)),
          reason: '重置本会话',
          source: 'reset-session'
        };
      }
      this.appendLog(sessionId, null, changes, 'reset-session');
      return true;
    } catch (error) {
      this.warn('重置会话状态失败', error);
      return false;
    }
  }

  /**
   * 清空日志（只删审计流水，不动快照）。
   *
   * @param {string} sessionId 空字符串 = 清全部
   * @returns {number} 删除条数
   */
  clearLogs(sessionId = '') {
    if (!this.ready) return 0;
    try {
      const where = String(sessionId) === '' ? '' : 'WHERE session_id = ?';
      const args = String(sessionId) === '' ? [] : [String(sessionId)];
      const info = this.db.prepare(`DELETE FROM state_logs ${where}`).run(...args);
      return Number(info?.changes ?? 0);
    } catch (error) {
      this.warn('清空日志失败', error);
      return 0;
    }
  }

  /** 所有启用的维度定义（带解析后的 bands / words） */
  fields() {
    if (!this.ready) return [];
    try {
      const rows = this.db.prepare('SELECT * FROM state_fields WHERE enabled = 1 ORDER BY rowid').all();
      return rows.map((row) => ({
        id: String(row.id),
        label: String(row.label),
        builtin: Number(row.builtin) === 1,
        bands: safeJson(row.bands, []),
        words: safeJson(row.words, []),
        baseline: BUILTIN_FIELDS.find((f) => f.id === row.id)?.baseline ?? 80,
        /* 衰减读库：用户可在「状态」tab 里逐维度改 */
        decayHalfLifeMin: this.decayOf(row.id)
      }));
    } catch (error) {
      this.warn('读取维度失败', error);
      return [];
    }
  }

  /** 读某维度的 bands 配置。返回副本，避免调用方直接改动内部对象。 */
  bandsFor(fieldId) {
    const id = String(fieldId ?? '');
    if (!this.ready || id === '') return undefined;
    try {
      const row = this.db.prepare('SELECT bands FROM state_fields WHERE id = ?').get(id);
      if (!row) return undefined;
      const bands = safeJson(row.bands, []);
      return Array.isArray(bands) ? bands.map((band) => ({ min: Number(band?.min), text: String(band?.text ?? '') })) : undefined;
    } catch (error) {
      this.warn('读取 bands 失败', error);
      return undefined;
    }
  }

  /**
   * 保存某维度的 bands。内置三维固定为 80/60/40/20/0 五档，阈值不可改、不可增删；
   * 仅允许修改非空说明文本。自定义维度仍使用通用的 1~8 档规则。
   */
  saveBands(fieldId, bands) {
    if (!this.ready) return undefined;
    const id = String(fieldId ?? '');
    const builtin = BUILTIN_FIELDS.find((field) => field.id === id);
    const fixedMins = [80, 60, 40, 20, 0];
    if (id === '' || !Array.isArray(bands)) return undefined;
    if (builtin && (bands.length !== fixedMins.length || bands.some((band, index) => Number(band?.min) !== fixedMins[index]))) return undefined;
    if (!builtin && (bands.length < 1 || bands.length > 8)) return undefined;
    const normalized = [];
    const mins = new Set();
    for (const band of bands) {
      const min = Number(band?.min);
      const text = String(band?.text ?? '').trim();
      if (!Number.isInteger(min) || min < 0 || min > 100 || text === '' || text.length > 100 || mins.has(min)) return undefined;
      mins.add(min);
      normalized.push({ min, text });
    }
    if (normalized[normalized.length - 1].min !== 0) return undefined;
    for (let i = 1; i < normalized.length; i += 1) {
      if (normalized[i - 1].min <= normalized[i].min) return undefined;
    }
    try {
      const row = this.db.prepare('SELECT id FROM state_fields WHERE id = ?').get(id);
      if (!row) return undefined;
      this.db.prepare('UPDATE state_fields SET bands = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(normalized), Date.now(), id);
      return normalized;
    } catch (error) {
      this.warn('保存 bands 失败', error);
      return undefined;
    }
  }

  /** 恢复内置维度的 bands；自定义维度没有内置默认值，返回 undefined。 */
  resetBands(fieldId) {
    if (!this.ready) return undefined;
    const id = String(fieldId ?? '');
    const builtin = BUILTIN_FIELDS.find((field) => field.id === id);
    if (!builtin) return undefined;
    return this.saveBands(id, builtin.bands);
  }

  /* ── 维度管理 ─────────────────────────────────────────────────────── */

  /** 自定义维度的默认区间：阈值与内置三维一致，说明用中性文案（用户可随后在词表弹窗里改）。 */
  static get DEFAULT_CUSTOM_BANDS() {
    return [
      { min: 80, text: '状态充足，按默认方式回应' },
      { min: 60, text: '状态平稳，正常完成当前任务' },
      { min: 40, text: '状态偏低，收敛篇幅、优先给结论' },
      { min: 20, text: '状态低，只给必要内容' },
      { min: 0, text: '状态极低，最简回应，仍须完成任务' }
    ];
  }

  /**
   * 新增一个自定义维度。
   * 约束：名称非空；含中文的名称固定为两个字（对齐内置三维「好感/心情/精神」），
   * 纯西文 ≤10 字；不与现有维度重名。id 自动生成（custom- 前缀 + 时间戳随机尾），
   * 空词表起步——用户在词表弹窗里逐个添加；衰减默认不衰减（0），可随后在衰减弹窗里改。
   *
   * @returns {{ id: string, label: string } | undefined} 新维度；参数非法或重名返回 undefined
   */
  addField(label) {
    if (!this.ready) return undefined;
    const name = String(label ?? '').trim();
    if (name === '') return undefined;
    /* 与前端 submitFieldAdd 同一套规则：含中文 → 必须恰好两个汉字 */
    if (/[\u4e00-\u9fff]/.test(name)) {
      if (!/^[\u4e00-\u9fff]{2}$/.test(name)) return undefined;
    } else if (name.length > 10) {
      return undefined;
    }
    try {
      const rows = this.db.prepare('SELECT id, label FROM state_fields').all();
      if (rows.some((row) => String(row.label) === name)) return undefined;
      const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const now = Date.now();
      this.db.prepare(`
        INSERT INTO state_fields (id, label, builtin, bands, words, enabled, created_at, updated_at)
        VALUES (?, ?, 0, ?, ?, 1, ?, ?)
      `).run(id, name, JSON.stringify(StateStore.DEFAULT_CUSTOM_BANDS), '[]', now, now);
      return { id, label: name };
    } catch (error) {
      this.warn('新增自定义维度失败', error);
      return undefined;
    }
  }

  /**
   * 删除自定义维度（内置三维不可删）。只删维度定义本身——连同它的词表、档位分值、
   * 衰减配置；状态快照（state_snapshots）和日志（state_logs）按要求保留不动，
   * 孤儿数据在历史曲线上自然消失（曲线按当前启用维度取值）。
   *
   * @returns {string | undefined} 被删维度的 id；维度不存在或内置维度返回 undefined
   */
  removeField(fieldId) {
    if (!this.ready) return undefined;
    const id = String(fieldId ?? '');
    if (id === '') return undefined;
    try {
      /* AND builtin = 0 把内置保护压进同一条语句——内置行 changes 恒为 0 */
      const info = this.db.prepare('DELETE FROM state_fields WHERE id = ? AND builtin = 0').run(id);
      if (Number(info?.changes ?? 0) === 0) return undefined;
      /* 维度没了，它的档位/衰减配置一并清掉（都不是快照/日志） */
      this.db.prepare('DELETE FROM state_tiers WHERE field_id = ?').run(id);
      this.db.prepare('DELETE FROM state_decay WHERE field_id = ?').run(id);
      return id;
    } catch (error) {
      this.warn('删除自定义维度失败', error);
      return undefined;
    }
  }

  /* ── 词法判定 ─────────────────────────────────────────────────────── */

  /**
   * 对一段用户原话打分。
   *
   * 输出是**每个维度一个增量**，不是一个总数——一句话可能同时动三根轴
   *（"垃圾，又崩了，累死"）。
   *
   * @returns {{增量: Record<string, number>, 命中: Array, 重词维度: Set<string>}}
   */
  scoreText(text) {
    const 增量 = {};
    const 命中 = [];
    const 重词维度 = new Set();
    const fields = this.fields();
    if (fields.length === 0) return { 增量, 命中, 重词维度 };

    /* 一次性取全部维度的档位表（用户可能改过），循环里直接查内存，不逐词读库 */
    const tierTables = {};
    for (const field of fields) tierTables[field.id] = this.tierValuesFor(field.id);

    /* 收集全部词条，按词长降序——长词优先，避免"烦死了"之后"烦"再扣一次 */
    const all = [];
    for (const field of fields) {
      for (const item of field.words) {
        all.push({ 词: String(item.词 ?? ''), 档位: String(item.档位 ?? ''), 指向: String(item.指向 ?? '事'), 维度id: field.id });
      }
    }
    all.sort((a, b) => b.词.length - a.词.length);

    let work = String(text ?? '').toLowerCase();

    for (const item of all) {
      if (item.词 === '') continue;
      const needle = item.词.toLowerCase();
      const index = work.indexOf(needle);
      if (index < 0) continue;

      const before = clauseBefore(work, index);
      const { dimensionId, tier } = resolveTarget(item, before, item.维度id);

      const table = tierTables[dimensionId] ?? DEFAULT_TIER_VALUES;
      let delta = Number(table[tier] ?? 0);
      if (delta === 0) {
        work = work.split(needle).join(' ');
        continue;
      }

      /* 否定：命中位置前 2–3 字（英文前 2 词）有否定词 → 打折反转 */
      if (hasNegationBefore(work, index)) delta *= NEGATION_FACTOR;

      增量[dimensionId] = (增量[dimensionId] ?? 0) + delta;
      命中.push({ 词: item.词, 档位: tier, 维度id: dimensionId, delta: Math.round(delta * 100) / 100 });
      if (tier === '重加' || tier === '重减') 重词维度.add(dimensionId);

      /* 划掉，防短词二次命中 */
      work = work.split(needle).join(' ');
    }

    /* 逐维度封顶：±45 = 最重单档（好感重减） */
    for (const key of Object.keys(增量)) {
      增量[key] = clamp(Math.round(增量[key] * 100) / 100, -NUDGE_CAP, NUDGE_CAP);
    }

    return { 增量, 命中, 重词维度 };
  }

  /* ── 状态读写 ─────────────────────────────────────────────────────── */

  /** 读最新一行快照（追加式表：同一 scope+field 可能有多行历史） */
  readSnapshot(scopeId, fieldId) {
    try {
      return this.db.prepare(`
        SELECT value, updated_at FROM state_snapshots
        WHERE scope_id = ? AND field_id = ?
        ORDER BY updated_at DESC, id DESC LIMIT 1
      `).get(scopeId, fieldId);
    } catch {
      return undefined;
    }
  }

  /** 追加一行快照（不再覆盖：保留状态变化轨迹，旧行由 pruneSnapshots 按天裁） */
  writeSnapshot(scopeId, fieldId, value, at = Date.now()) {
    try {
      this.db.prepare(`
        INSERT INTO state_snapshots (scope_id, field_id, value, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(scopeId, fieldId, clamp(value, 0, 100), at);
    } catch (error) {
      this.warn(`写快照失败 ${scopeId}/${fieldId}`, error);
    }
  }

  /** 新会话第一次出现时，从底色复制一份作为起点 */
  ensureBaseline(sessionId) {
    if (!this.ready || sessionId === '') return;
    for (const field of this.fields()) {
      if (this.readSnapshot(sessionId, field.id)) continue;
      const base = this.readSnapshot(GLOBAL_SCOPE, field.id);
      this.writeSnapshot(sessionId, field.id, base ? Number(base.value) : field.baseline);
    }
  }

  /** 读取本地时钟的分钟数；不依赖系统时区环境变量。 */
  localMinutesOfDay(now = Date.now()) {
    const date = new Date(now);
    return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
  }

  /**
   * 精神的日内疲劳曲线：23:00 从 0 用 smoothstep 平滑爬升，
   * 02:00 达到疲劳巅峰（1），02:00~06:00 保持巅峰平台，06:00 后归零。
   * 疲劳只增不减——没有恢复机制，夜里就是困。
   */
  energyFatigueCurve(now = Date.now()) {
    const nightStart = 23 * 60;
    const endMin = 6 * 60;
    const rampSpan = 3 * 60; // 23:00 → 02:00 爬升 3 小时
    const minute = this.localMinutesOfDay(now);
    if (minute >= nightStart || minute < endMin) {
      /* 跨午夜：23:00 后直接算，凌晨分钟数补回前一天偏移 */
      const elapsed = minute >= nightStart ? minute - nightStart : minute + (24 * 60 - nightStart);
      const smoothstep = (x) => {
        const t = clamp(x, 0, 1);
        return t * t * (3 - 2 * t);
      };
      return smoothstep(elapsed / rampSpan);
    }
    return 0;
  }

  /** 当前心情对精神的影响：心情越好，夜间疲劳越轻且弛豫半衰期越短。
      兜底值与内置基线一致（80），不存在「中性 50」的第三种口径。 */
  energyMoodValue(sessionId, now = Date.now()) {
    const mood = this.fields().find((field) => field.id === 'mood');
    return mood ? clamp(this.currentValue(sessionId, mood, now), 0, 100) : 80;
  }

  /** 疲劳扣减：按日内曲线取值（23:00 起爬升，02:00~06:00 巅峰），基础 10 点。
      低心情最多放大 20%（巅峰→12），高心情压到 55%（巅峰→5.5）；时段外为 0。 */
  energyFatigueAmount(sessionId, now = Date.now()) {
    const curve = this.energyFatigueCurve(now);
    if (curve <= 0) return 0;
    const moodRatio = this.energyMoodValue(sessionId, now) / 100;
    const moodScale = 1.2 - 0.65 * moodRatio;
    return 10 * curve * moodScale;
  }

  energyRecoveryHalfLife(sessionId, field, now = Date.now()) {
    const base = Number(field.decayHalfLifeMin) || 120;
    const moodRatio = this.energyMoodValue(sessionId, now) / 100;
    /* 低心情约 162 分钟，高心情约 72 分钟；越开心，恢复越快。 */
    return base * (1.35 - 0.75 * moodRatio);
  }

  /** 按墙钟做弛豫，但不叠加精神的夜间疲劳，用于落库时保留真实底值。 */
  relaxedValue(sessionId, field, now = Date.now()) {
    const row = this.readSnapshot(sessionId, field.id);
    if (!row) {
      const base = this.readSnapshot(GLOBAL_SCOPE, field.id);
      return base ? Number(base.value) : field.baseline;
    }
    const value = Number(row.value);
    const halfLife = field.id === 'energy'
      ? this.energyRecoveryHalfLife(sessionId, field, now)
      : Number(field.decayHalfLifeMin) || 0;
    if (halfLife <= 0) return value;
    const elapsedMin = Math.max(0, (now - Number(row.updated_at)) / 60000);
    if (elapsedMin < 0.01) return value;
    const factor = Math.pow(0.5, elapsedMin / halfLife);
    return field.baseline + (value - field.baseline) * factor;
  }

  /** 按墙钟做弛豫（向基线回落）。返回当前有效值。 */
  currentValue(sessionId, field, now = Date.now()) {
    const relaxed = this.relaxedValue(sessionId, field, now);
    if (field.id !== 'energy') return relaxed;
    return clamp(relaxed - this.energyFatigueAmount(sessionId, now), 0, 100);
  }

  /**
   * 把一次增量施加到某根轴上。
   *
   * 两个阻尼：
   *   · 惯性 0.5 —— 一次事件只走一半，防跳变
   *   · 端点收缩 —— 越靠近 0/100 走得越慢
   */
  applyDelta(sessionId, fieldId, delta, now = Date.now()) {
    const field = this.fields().find((f) => f.id === fieldId);
    const base = field ? field.baseline : 80;
    /* 起点用「当前实时值」currentValue（含疲劳体感）——方案乙：疲劳是当时的真实状态，
       写进存储。读取/显示一律用 relaxedValue，保证疲劳只扣一次。 */
    const current = field ? this.currentValue(sessionId, field, now) : base;
    const remain = clamp(Math.min(current, 100 - current) / 50, 0, 1);
    const factor = 0.25 + 0.75 * remain;
    const next = clamp(current + delta * this.config.inertia * factor, 0, 100);
    /* 日志 before 记「上一刻柱形显示值」=弛豫值，和柱形无缝衔接；
       这样 after-before = 词表增量+疲劳扣减，完整呈现本轮变化。
       注意要在 writeSnapshot 之前取，否则拿到的就是新值了。 */
    const displayBefore = field ? this.relaxedValue(sessionId, field, now) : base;
    this.writeSnapshot(sessionId, fieldId, next, now);
    const result = { before: displayBefore, after: next };
    /* 精神附带当前疲劳值，供日志展示「（疲劳-N）」；非疲劳时段为 0，展示层会跳过。 */
    if (fieldId === 'energy') {
      result.fatigue = round1(this.energyFatigueAmount(sessionId, now));
    }
    return result;
  }

  /* ── 每轮更新 ─────────────────────────────────────────────────────── */

  onTurnEnd(session, turn) {
    if (!this.ready || !this.config.enabled) return undefined;
    const sessionId = sessionIdOf(session);
    if (sessionId === '' || !Number.isInteger(turn)) return undefined;

    try {
      this.ensureBaseline(sessionId);
      this.flushIdle(sessionId, Date.now(), turn);
      this.maybePruneLogs();

      const text = userTextOfTurn(session, turn);
      if (text.trim() === '') {
        this.log(`turn ${turn} 未取到用户文本，跳过`);
        return undefined;
      }

      const result = this.scoreText(text);
      const changes = {};
      for (const [fieldId, delta] of Object.entries(result.增量)) {
        if (!Number.isFinite(delta) || delta === 0) continue;
        const { before, after, fatigue } = this.applyDelta(sessionId, fieldId, delta);
        changes[fieldId] = {
          before: round1(before),
          after: round1(after),
          reason: result.命中.filter((h) => h.维度id === fieldId).map((h) => h.词).join(' / '),
          source: 'word',
          ...(fatigue !== undefined ? { fatigue } : {})
        };
      }
      if (Object.keys(changes).length > 0) {
        this.appendLog(sessionId, turn, changes, 'word');
        this.log(`turn ${turn} 命中 ${result.命中.map((h) => h.词).join(',')} → ${Object.entries(changes).map(([k, v]) => `${k} ${v.before}→${v.after}`).join('; ')}`);
      } else {
        this.log(`turn ${turn} 未命中（${text.length} 字）：${text.slice(0, 40)}`);
      }
      return { sessionId, turn, changes, 命中: result.命中 };
    } catch (error) {
      this.warn('onTurnEnd 失败', error);
      return undefined;
    }
  }

  appendLog(sessionId, turn, changes, source, scopeId = sessionId, noOverwrite = false) {
    try {
      /* noOverwrite（沉淀用）：同键已存在就丢弃，保留首次记录，不覆盖。
         其余（词表/llm_adjust）仍走 UPDATE——llm_adjust 依赖覆盖来合并修正。 */
      const conflict = noOverwrite
        ? 'ON CONFLICT(scope_id, session_id, turn) DO NOTHING'
        : 'ON CONFLICT(scope_id, session_id, turn) DO UPDATE SET changes = excluded.changes, source = excluded.source';
      this.db.prepare(`
        INSERT INTO state_logs (scope_id, session_id, turn, changes, source, at)
        VALUES (?, ?, ?, ?, ?, ?)
        ${conflict}
      `).run(scopeId, sessionId, turn ?? null, JSON.stringify(changes), source, Date.now());
    } catch (error) {
      this.warn('写日志失败', error);
    }
  }

  /* ── 底色沉淀 ─────────────────────────────────────────────────────── */

  /** 某会话是否被禁用沉淀（「当前会话状态不沉淀」开关的读端） */
  isFlushSkipped(sessionId) {
    return this.flushSkipSet.has(String(sessionId ?? ''));
  }

  /**
   * 设置某会话的沉淀豁免。
   *
   * @param {string} sessionId 目标会话；空串或全局 scope 拒绝
   * @param {boolean} skipped true = 禁用该会话沉淀；false = 恢复
   * @returns {boolean | undefined} 生效后的状态；参数非法或未就绪返回 undefined
   */
  setFlushSkip(sessionId, skipped) {
    if (!this.ready) return undefined;
    const id = String(sessionId ?? '');
    if (id === '' || id === GLOBAL_SCOPE) return undefined;
    try {
      if (skipped === true) {
        this.db.prepare('INSERT INTO state_flush_skip (scope_id, created_at) VALUES (?, ?) ON CONFLICT(scope_id) DO NOTHING')
          .run(id, Date.now());
        this.flushSkipSet.add(id);
      } else {
        this.db.prepare('DELETE FROM state_flush_skip WHERE scope_id = ?').run(id);
        this.flushSkipSet.delete(id);
      }
      return this.flushSkipSet.has(id);
    } catch (error) {
      this.warn('设置沉淀豁免失败', error);
      return undefined;
    }
  }

  /**
   * 会话删除时批量清理沉淀豁免行（含级联删除的子会话）。
   * 会话没了，豁免没有意义——行留在表里只会成为孤儿数据。
   *
   * @param {string[]} sessionIds 被删除的会话 id 列表
   * @returns {number} 实际清除的行数
   */
  removeFlushSkips(sessionIds) {
    if (!this.ready) return 0;
    const list = (Array.isArray(sessionIds) ? sessionIds : [])
      .map((id) => String(id ?? ''))
      .filter((id) => id !== '');
    let removed = 0;
    try {
      for (const id of list) {
        const info = this.db.prepare('DELETE FROM state_flush_skip WHERE scope_id = ?').run(id);
        removed += Number(info?.changes ?? 0);
        this.flushSkipSet.delete(id);
      }
      return removed;
    } catch (error) {
      this.warn('清理沉淀豁免行失败', error);
      return removed;
    }
  }

  /** 会话空闲够久就把会话值按吸收系数写回底色（懒结算，不依赖定时器）
   *  latestTurn: 触发沉淀的轮次（有则可显示「第N轮沉淀」；启动扫描无此上下文传 null） */
  flushIdle(sessionId, now = Date.now(), latestTurn = null) {
    if (!this.ready || sessionId === '' || sessionId === GLOBAL_SCOPE) return false;
    /* 空闲沉淀总开关关闭：所有会话都不再触发沉淀。与按会话豁免相互独立——
       总开关优先级更高，两个都关效果一致。 */
    if (this.config.idleFlushEnabled === false) return false;
    /* 「当前会话状态不沉淀」：被豁免的会话在此短路——不读快照、不写底色、不记日志。
       其它会话照常沉淀；豁免解除后积压状态在下一次触发时正常结算。 */
    if (this.flushSkipSet.has(sessionId)) return false;
    /* 同一轮（或更旧轮次）不重复沉淀：轮次递增，map 里记的是已沉淀的最大轮次，
       latestTurn <= 它就直接返回，连底色都不二次改动。
       只有带明确轮次的调用（onTurnEnd）参与此判断；启动扫描传 null 不受影响。 */
    const flushedTurn = this.flushedTurnMap.get(sessionId);
    if (latestTurn !== null && flushedTurn !== undefined && latestTurn <= flushedTurn) return false;
    /* 沉淀判定（看快照表）：会话末行的时间 vs 底色（__global__）末行的时间。
       底色行由沉淀写入,其时间即「上次沉淀时刻」;会话行的最后写入即「上次状态变动时刻」。
       会话末行更新 → 状态变动之后还没沉淀过 → 沉淀;
       底色末行更新或持平（沉淀之后没有新变动）→ 不再沉淀——反复重启、纯衰减期都不满足。
       底色无行（从未沉淀/刚被重置）时视为待沉淀,首 fold 会重建底色行。 */
    const sessionLast = this.db.prepare(`SELECT MAX(updated_at) AS at FROM state_snapshots WHERE scope_id = ?`).get(sessionId)?.at ?? 0;
    const floorLast = this.db.prepare(`SELECT MAX(updated_at) AS at FROM state_snapshots WHERE scope_id = ?`).get(GLOBAL_SCOPE)?.at ?? 0;
    if (sessionLast <= floorLast) return false;
    const idleMs = this.config.idleFlushMin * 60000;
    const changes = {};

    for (const field of this.fields()) {
      const row = this.readSnapshot(sessionId, field.id);
      if (!row) continue;
      if (now - Number(row.updated_at) < idleMs) continue;

      /* 用弛豫后的存储值沉淀，而不是写死的旧快照值。
         疲劳已在写入时计入存储，这里用 relaxedValue 不再二次扣减。 */
      const 会话值 = this.relaxedValue(sessionId, field, now);

      /* 标记本轮已结算——在任何底色写入之前，确保同轮重入直接被开头拦下。 */
      if (latestTurn !== null) this.flushedTurnMap.set(sessionId, latestTurn);
      /* 无论底色有没有变化，都先把会话值固化回去并刷新时间戳。
         这一步等于给本次会话盖「已结算」戳：下次启动扫描时
         now - updated_at 不足 idleMs，直接跳过，不会再产生一次沉淀。 */
      this.writeSnapshot(sessionId, field.id, 会话值, now);

      const 旧底 = this.readSnapshot(GLOBAL_SCOPE, field.id);
      const 旧底值 = 旧底 ? Number(旧底.value) : field.baseline;
      const 新底值 = clamp(field.baseline + (会话值 - field.baseline) * this.config.absorb, 0, 100);

      /* 底色没有实质变化就不记账，避免「心情 50→50」这种噪音。 */
      if (Math.abs(新底值 - 旧底值) < 0.05) continue;

      this.writeSnapshot(GLOBAL_SCOPE, field.id, 新底值, now);
      changes[field.id] = {
        before: round1(旧底值),
        after: round1(新底值),
        reason: '会话沉淀',
        source: 'flush'
      };
    }

    /* 一次沉淀只写一条日志：三根轴属于同一个事件，
       拆成三条会让同一时刻冒出好几行「底色沉淀」，看着像重复触发。 */
    if (Object.keys(changes).length === 0) return false;
    this.appendLog(sessionId, latestTurn, changes, 'flush', GLOBAL_SCOPE, true);
    return true;
  }

  /** 启动补做：扫一遍快照表,只沉淀「仍然存在的会话」（按宿主会话注册表过滤）。
      注册表未就绪（空）时直接跳过——由 installStateFeature 的就绪重试补跑。
      孤儿 scope（已删除/外部的会话）永不沉淀：不再污染底色,也不再产生
      幽灵「会话沉淀」日志。 */
  flushAllIdle(now = Date.now()) {
    if (!this.ready) return;
    /* 空闲沉淀总开关关闭：启动补做整体跳过，省掉一次全表扫描（逐会话短路在 flushIdle 里） */
    if (this.config.idleFlushEnabled === false) return;
    try {
      const byId = this.ctx?.sessions?.list?.getSnapshot?.()?.byId;
      if (!byId || Object.keys(byId).length === 0) return; /* 注册表未就绪：留给重试 */
      const known = new Set(Object.keys(byId));
      /* 顺手清理已删除会话的沉淀豁免行——会话没了，豁免也就没有意义 */
      for (const skippedId of [...this.flushSkipSet]) {
        if (!known.has(skippedId)) {
          try {
            this.db.prepare('DELETE FROM state_flush_skip WHERE scope_id = ?').run(skippedId);
          } catch { /* 清理失败不影响补做 */ }
          this.flushSkipSet.delete(skippedId);
        }
      }
      /* 只取最近 24h 有写入的会话:沉淀的对象是「刚闲下来的会话」。
         超过一天没动过的会话,其值早已进过底色（favor）或已衰减回基线（mood/energy）,
         再沉淀只是重复搬运旧值——还会把旧口径的遗留值（如基线 50 时代的 50）
         反复写回底色。孤儿过滤在下面照旧生效。 */
      const rows = this.db.prepare(`
        SELECT DISTINCT scope_id FROM state_snapshots
        WHERE scope_id <> ? AND updated_at >= ?
      `).all(GLOBAL_SCOPE, now - 24 * 3600000);
      for (const row of rows) {
        const scope = String(row.scope_id);
        if (!known.has(scope)) continue;
        this.flushIdle(scope, now);
      }
    } catch (error) {
      this.warn('启动沉淀失败', error);
    }
  }

  /* ── 注入 ─────────────────────────────────────────────────────────── */

  /* ── AI人格设定（多个人格，同一时刻至多一个激活）──────────────────── */

  static get PERSONA_NAME_MAX_LENGTH() { return 20; }
  static get PERSONA_TEXT_MAX_LENGTH() { return 20000; }

  /** 确保人格列表已从库里加载（懒加载一次，之后走内存缓存）。 */
  ensurePersonas() {
    if (this.personasCache !== undefined) return this.personasCache;
    try {
      const rows = this.db.prepare('SELECT id, name, text, active, updated_at FROM state_personas ORDER BY created_at ASC, id ASC').all();
      this.personasCache = rows.map((row) => ({ id: String(row.id), name: String(row.name), text: String(row.text), active: Number(row.active) === 1, updatedAt: Number(row.updated_at) }));
    } catch (error) {
      this.warn('读取人格列表失败', error);
      this.personasCache = [];
    }
    return this.personasCache;
  }

  /** 人格列表（编辑弹窗用），返回副本。 */
  personas() {
    return this.ensurePersonas().map((item) => ({ ...item }));
  }

  /** 当前激活人格的 id（无激活 → null）。 */
  activePersonaId() {
    const item = this.ensurePersonas().find((item) => item.active === true);
    return item?.id ?? null;
  }

  /** 当前注入的人格文本（systemPrompt section 的动态 getter；无激活 → ''）。 */
  getPersonaPrompt() {
    const item = this.ensurePersonas().find((item) => item.active === true);
    return item?.text ?? '';
  }

  /**
   * 角色设定 section 文本：`## 角色设定` 二级标题，与相邻 section 的排版约定一致
   * （memory.js 的「## 长期记忆」同款）——模型把它识别为独立的角色提示词块。
   * 未设置/已停用 → ''（宿主跳过空 section）。
   */
  getPersonaSectionText() {
    const persona = this.getPersonaPrompt();
    if (persona === '') return '';
    return `## 角色设定\n${persona}\n`;
  }

  /** 校验并规整名称/正文；非法返回 undefined。名称非空 ≤20 字；正文非空 ≤20000 字。 */
  normalizePersonaInput(name, text) {
    const n = String(name ?? '').trim();
    const t = String(text ?? '').trim();
    if (n === '' || n.length > StateStore.PERSONA_NAME_MAX_LENGTH) return undefined;
    if (t === '' || t.length > StateStore.PERSONA_TEXT_MAX_LENGTH) return undefined;
    return { name: n, text: t };
  }

  /**
   * 新增人格。首个新增的人格自动激活；后续新增默认不激活。
   * 名称非空 ≤20 字且不与现有重名；正文 ≤20000 字（允许空）。
   *
   * @returns {{ id: string, name: string, text: string, active: boolean } | undefined}
   */
  addPersona(name, text) {
    if (!this.ready) return undefined;
    const normalized = this.normalizePersonaInput(name, text);
    if (!normalized) return undefined;
    const list = this.ensurePersonas();
    if (list.some((item) => item.name === normalized.name)) return undefined;
    const now = Date.now();
    const item = {
      id: `persona-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: normalized.name,
      text: normalized.text,
      active: list.length === 0,
      created_at: now,
      updated_at: now
    };
    try {
      this.db.prepare('INSERT INTO state_personas (id, name, text, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(item.id, item.name, item.text, item.active ? 1 : 0, item.created_at, item.updated_at);
      const entry = { id: item.id, name: item.name, text: item.text, active: item.active, updatedAt: item.updated_at };
      list.push(entry);
      return { ...entry };
    } catch (error) {
      this.warn('新增人格失败', error);
      return undefined;
    }
  }

  /**
   * 编辑人格（改名/改正文）。重名（其它人格占用）或参数非法返回 undefined。
   *
   * @returns {{ id: string, name: string, text: string, active: boolean } | undefined}
   */
  updatePersona(id, name, text) {
    if (!this.ready) return undefined;
    const key = String(id ?? '');
    const normalized = this.normalizePersonaInput(name, text);
    if (key === '' || !normalized) return undefined;
    const list = this.ensurePersonas();
    const item = list.find((item) => item.id === key);
    if (!item) return undefined;
    if (list.some((other) => other.id !== key && other.name === normalized.name)) return undefined;
    try {
      const updatedAt = Date.now();
      this.db.prepare('UPDATE state_personas SET name = ?, text = ?, updated_at = ? WHERE id = ?')
        .run(normalized.name, normalized.text, updatedAt, key);
      item.name = normalized.name;
      item.text = normalized.text;
      item.updatedAt = updatedAt;
      return { ...item };
    } catch (error) {
      this.warn('编辑人格失败', error);
      return undefined;
    }
  }

  /**
   * 激活某个人格（同一时刻至多一个）：先全部置 0，再把目标置 1。
   *
   * @returns {{ id: string, name: string, text: string, active: boolean } | undefined}
   */
  activatePersona(id) {
    if (!this.ready) return undefined;
    const key = String(id ?? '');
    const list = this.ensurePersonas();
    const item = list.find((item) => item.id === key);
    if (!item) return undefined;
    try {
      this.db.prepare('UPDATE state_personas SET active = CASE WHEN id = ? THEN 1 ELSE 0 END').run(key);
      for (const entry of list) entry.active = entry.id === key;
      return { ...item, active: true };
    } catch (error) {
      this.warn('激活人格失败', error);
      return undefined;
    }
  }

  /**
   * 停用当前激活的人格（若有）。允许无任何人格激活——此时注入空文本。
   * 本来就没有激活者时静默返回 undefined（幂等）。
   *
   * @returns {{ id: string, name: string, text: string, active: boolean } | undefined} 被停用的人格
   */
  deactivatePersona() {
    if (!this.ready) return undefined;
    const list = this.ensurePersonas();
    const item = list.find((item) => item.active === true);
    if (!item) return undefined;
    try {
      this.db.prepare('UPDATE state_personas SET active = 0 WHERE id = ?').run(item.id);
      item.active = false;
      return { ...item, active: false };
    } catch (error) {
      this.warn('停用人格失败', error);
      return undefined;
    }
  }

  /** 删除人格。删除激活者后无激活人格（注入空文本）。返回是否删除了行。 */
  removePersona(id) {
    if (!this.ready) return false;
    const key = String(id ?? '');
    if (key === '') return false;
    try {
      const info = this.db.prepare('DELETE FROM state_personas WHERE id = ?').run(key);
      const existed = this.ensurePersonas().some((item) => item.id === key);
      this.personasCache = this.personasCache.filter((item) => item.id !== key);
      return Number(info?.changes ?? 0) > 0 || existed;
    } catch (error) {
      this.warn('删除人格失败', error);
      return false;
    }
  }

  /** 渲染成模型可直接执行的表达指令，不暴露内部数值或状态原因。 */
  render(sessionId, now = Date.now()) {
    const instructions = [];
    for (const field of this.fields()) {
      /* 用 relaxedValue：疲劳已在写入存储时计入，这里不再扣一次 */
      const value = Math.round(this.relaxedValue(sessionId, field, now));
      const band = field.bands.find((b) => value >= Number(b.min)) ?? field.bands[field.bands.length - 1];
      const instruction = String(band?.text ?? '').trim();
      if (instruction !== '') instructions.push(`- ${field.label}：${instruction}`);
    }
    return [
      '（表达调整，不对外暴露）',
      '本轮按以下状态指令调整表达：',
      ...instructions
    ].join('\n');
  }

  /**
   * 找当前 surface 上实际存活的状态消息。
   * 不能直接扫全部事件：旧状态消息虽然仍在日志里，但已经被 replace 遮蔽，
   * 用户要求的「上下文中已有状态」指的是 surface 中当前可见/可供模型派生的那一条。
   */
  findCurrentState(session) {
    const events = sessionEvents(session);
    const nodes = Array.isArray(session?.surface?.nodes) ? session.surface.nodes : [];
    const bySeq = new Map(events.map((event) => [Number(event.seq), event]));
    let current;
    for (const seq of nodes) {
      const event = bySeq.get(Number(seq));
      if (event?.type !== 'user/message') continue;
      if (event.data?.source?.kind !== STATE_SOURCE) continue;
      const blocks = Array.isArray(event.data?.content) ? event.data.content : [];
      const text = blocks.filter((block) => block?.type === 'text').map((block) => block.text).join('');
      current = { seq: Number(seq), text };
    }
    return current;
  }

  inject(session) {
    if (!this.ready || !this.config.enabled) return false;
    const sessionId = sessionIdOf(session);
    if (sessionId === '' || typeof session?.append !== 'function') return false;

    /* 硬保护：会话的第一个 surface 事件必须是宿主的 system/message（protected head）。
       在它落盘之前往 surface 里 append 任何东西，都会让日志被判为 corrupt，
       且这个损坏是永久的（写进去就改不回来）。这里直接跳过，下一步再来。 */
    try {
      const events = sessionEvents(session);
      if (!events.some((event) => event.type === 'system/message')) return false;
    } catch {
      return false;
    }

    try {
      this.ensureBaseline(sessionId);
      const text = this.render(sessionId);
      const current = this.findCurrentState(session);
      /* 相同状态不重复写入：避免工具循环/多 step 中无意义地 replace，保护缓存前缀。 */
      if (current !== undefined && current.text === text) return false;

      const message = createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: STATE_SOURCE }
      });
      if (current !== undefined && Number.isFinite(current.seq)) {
        session.append('user/message', message, {
          surfaceOp: { op: 'replace', startSeq: current.seq, endSeq: current.seq },
          sourceEventSeqs: [current.seq]
        });
      } else {
        session.append('user/message', message, { surfaceOp: 'append' });
      }
      return true;
    } catch (error) {
      /* 锚点失效（比如被压缩吃掉）时退回 append，下一次再续上 */
      try {
        const text = this.render(sessionId);
        const current = this.findCurrentState(session);
        if (current !== undefined && current.text === text) return false;
        const message = createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: STATE_SOURCE }
        });
        if (current !== undefined && Number.isFinite(current.seq)) {
          session.append('user/message', message, {
            surfaceOp: { op: 'replace', startSeq: current.seq, endSeq: current.seq },
            sourceEventSeqs: [current.seq]
          });
        } else {
          session.append('user/message', message, { surfaceOp: 'append' });
        }
        return true;
      } catch (fallbackError) {
        this.warn('注入失败', fallbackError);
        return false;
      }
    }
  }

  /* ── LLM 通道 ─────────────────────────────────────────────────────── */

  /**
   * 状态轴清单（供蒸馏便车的提示词段使用，memory.js 据此生成 STATE 行规则）。
   * 轴列表按当前启用维度动态生成——自定义维度同样参与 LLM 判定。
   */
  llmAxes() {
    return this.fields().map((field) => ({ id: field.id, label: field.label, baseline: field.baseline }));
  }

  /**
   * 蒸馏便车入口：memory.js 从蒸馏输出剥离出 STATE 判定对象后回传到这里。
   *
   * 边界：
   *   · 只跟随最新一轮——手动蒸馏旧轮次不做回溯补判，避免按旧内容扰动当前状态；
   *   · 同一轮只采纳一次——primary→fallback 蒸馏重试会对同一轮再剥一次 STATE 行，第二次丢弃；
   *   · 词法增量按原话重算（scoreText 是确定性的纯计算），再 mergeLlm 定目标值、
   *     applyLlmAdjust 补差落库——判定晚到几秒/几分钟都不影响补差语义。
   */
  applyDistillJudgment(session, turn, judgment) {
    if (!this.ready || !this.config.enabled || !this.config.llmEnabled) return;
    if (!Number.isInteger(turn)) return;
    const sessionId = sessionIdOf(session);
    if (sessionId === '') return;
    try {
      /* 只判最新一轮 */
      let latestTurn = null;
      for (const event of sessionEvents(session)) {
        if (event.type === 'turn/start') latestTurn = Number(event.data?.turn);
      }
      if (Number.isFinite(latestTurn) && turn < latestTurn) return;
      /* 同轮去重（primary→fallback 重试 / 重复蒸馏） */
      const judgeKey = `${sessionId}:${turn}`;
      if (this.judgedTurns.has(judgeKey)) return;
      const fields = this.fields();
      if (fields.length === 0) return;
      const normalized = this.normalizeJudgment(judgment, fields);
      if (!normalized) {
        this.log(`turn ${turn} 状态判定无效或低于置信门槛，跳过`);
        return;
      }
      this.judgedTurns.add(judgeKey);
      if (this.judgedTurns.size > 200) {
        for (const key of [...this.judgedTurns].slice(0, this.judgedTurns.size - 100)) this.judgedTurns.delete(key);
      }
      const text = userTextOfTurn(session, turn);
      if (text.trim() === '') return;
      const lex = this.scoreText(text);
      const merged = this.mergeLlm(lex, normalized);
      if (this.applyLlmAdjust(sessionId, turn, lex.增量, merged)) {
        this.log(`turn ${turn} 蒸馏便车状态判定已应用（confidence ${normalized.confidence}，增量 ${JSON.stringify(normalized.增量)}）`);
      }
    } catch (error) {
      this.warn('蒸馏便车状态判定失败', error);
    }
  }

  /**
   * 校验并规整判定对象（JSON 解析已由剥离方 stripStateTrailer 完成）：
   *   ① confidence ≥ llmMinConfidence，否则整条丢弃（llmMinConfidence 的消费点）；
   *   ② 增量键必须是启用维度、值是有限非零数，逐维度钳到 ±NUDGE_CAP。
   *
   * @returns {{confidence: number, 增量: Record<string, number>} | null}
   */
  normalizeJudgment(parsed, fields) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const confidence = Math.round(Number(parsed.confidence));
    if (!Number.isFinite(confidence) || confidence < this.config.llmMinConfidence) return null;
    const validIds = new Set(fields.map((field) => field.id));
    const 增量 = {};
    for (const [key, value] of Object.entries(parsed.增量 ?? {})) {
      if (!validIds.has(String(key))) continue;
      const num = Number(value);
      if (!Number.isFinite(num) || num === 0) continue;
      增量[String(key)] = clamp(num, -NUDGE_CAP, NUDGE_CAP);
    }
    if (Object.keys(增量).length === 0) return null;
    return { confidence, 增量 };
  }

  /**
   * 逐维度合并两个通道。
   *
   * 为什么不是整体二选一：一句话可能是"垃圾，又崩了，累死"——好感被「垃圾」
   * 锁死走词法，心情和精神没有重词，交给 LLM 更准。
   */
  mergeLlm(lex, llm) {
    const out = { ...(lex?.增量 ?? {}) };
    if (!llm || !Number.isFinite(llm.confidence) || llm.confidence < this.config.llmAdoptConfidence) {
      return out;
    }
    for (const fieldId of Object.keys(llm.增量 ?? {})) {
      if (lex?.重词维度?.has(fieldId)) continue;
      const value = Number(llm.增量[fieldId]);
      if (Number.isFinite(value)) out[fieldId] = value;
    }
    return out;
  }

  /** LLM 晚到：补差值不回滚，并把同一轮的日志原地修正 */
  applyLlmAdjust(sessionId, turn, 词法增量, 合并增量) {
    if (!this.ready) return false;
    try {
      const changes = {};
      for (const [fieldId, target] of Object.entries(合并增量 ?? {})) {
        const lexDelta = Number(词法增量?.[fieldId] ?? 0);
        const diff = Number(target) - lexDelta;
        if (!Number.isFinite(diff) || Math.abs(diff) < 0.5) continue;
        const { before, after, fatigue } = this.applyDelta(sessionId, fieldId, diff);
        changes[fieldId] = {
          before: round1(before),
          after: round1(after),
          reason: 'LLM 修正',
          source: 'llm_adjust',
          ...(fatigue !== undefined ? { fatigue } : {})
        };
      }
      if (Object.keys(changes).length === 0) return false;

      const row = this.db.prepare('SELECT changes FROM state_logs WHERE scope_id = ? AND session_id = ? AND turn = ?')
        .get(sessionId, sessionId, turn);
      if (row) {
        const merged = safeJson(row.changes, {});
        for (const [fieldId, entry] of Object.entries(changes)) {
          merged[fieldId] = {
            ...(merged[fieldId] ?? {}),
            after: entry.after,
            reason: `${merged[fieldId]?.reason ?? ''}（LLM 修正）`,
            source: 'llm_adjust'
          };
        }
        this.db.prepare('UPDATE state_logs SET changes = ? WHERE scope_id = ? AND session_id = ? AND turn = ?')
          .run(JSON.stringify(merged), sessionId, sessionId, turn);
      } else {
        this.appendLog(sessionId, turn, changes, 'llm_adjust');
      }
      return true;
    } catch (error) {
      this.warn('LLM 修正失败', error);
      return false;
    }
  }

  /* ── 对外快照（前端 / 调试） ──────────────────────────────────────── */

  /**
   * 单个维度的完整词表（点开弹窗时按需拉）。
   * 每个词带上「分值」——按**该维度**的档位表算，所以同一个「轻减」
   * 在好感是 −3、在精神是 −5，弹窗里能一眼看出实际力度。
   */
  wordsFor(fieldId) {
    const field = this.fields().find((f) => f.id === String(fieldId ?? ''));
    if (!field) return undefined;
    const table = this.tierValuesFor(field.id);
    const tierCounts = {};
    const words = field.words.map((item) => {
      const tier = String(item.档位 ?? '');
      tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
      return {
        词: String(item.词 ?? ''),
        档位: tier,
        指向: String(item.指向 ?? '事'),
        分值: Number(table[tier] ?? 0),
        自定义: Boolean(item.自定义)
      };
    });
    return {
      field: field.id,
      label: field.label,
      baseline: field.baseline,
      bands: field.bands,
      tierValues: { ...table },
      tierCounts,
      words
    };
  }

  /** 词表可编辑的档位/指向合法值（与前端下拉一致） */
  static get WORD_TIERS() { return TIER_KEYS; }
  static get WORD_TARGETS() { return ['人', '事', '自动', '讨论']; }

  /**
   * 新增自定义词。约束：词非空且 ≤20 字、维度内不与已有词重复（含内置）、
   * 档位是六档之一、指向是四值之一。带「自定义」标记——删除接口只认这个标记。
   *
   * @returns {object | undefined} 新增的词条；参数非法返回 undefined
   */
  addWord(fieldId, word, tier, target) {
    if (!this.ready) return undefined;
    const id = String(fieldId ?? '');
    const w = String(word ?? '').trim();
    if (id === '' || w === '' || w.length > 20) return undefined;
    const tierOk = TIER_KEYS.includes(String(tier));
    const targetStr = String(target ?? '').trim();
    const targetOk = StateStore.WORD_TARGETS.includes(targetStr);
    if (!tierOk || !targetOk) return undefined;
    try {
      const row = this.db.prepare('SELECT words FROM state_fields WHERE id = ?').get(id);
      if (!row) return undefined;
      let stored;
      try {
        stored = JSON.parse(String(row.words));
      } catch {
        return undefined;
      }
      if (!Array.isArray(stored)) return undefined;
      if (stored.some((x) => String(x?.词 ?? '') === w)) return undefined;  // 重复
      const entry = { 词: w, 档位: String(tier), 指向: targetStr, 自定义: true };
      this.db.prepare('UPDATE state_fields SET words = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify([...stored, entry]), Date.now(), id);
      return entry;
    } catch (error) {
      this.warn('新增词失败', error);
      return undefined;
    }
  }

  /**
   * 删除词。只删带「自定义」标记的——内置词是词法判定的基线，不支持删除，
   * 免得误删后判定基线残缺。
   *
   * @returns {boolean} 是否真的删了
   */
  removeWord(fieldId, word) {
    if (!this.ready) return false;
    const id = String(fieldId ?? '');
    const w = String(word ?? '').trim();
    if (id === '' || w === '') return false;
    try {
      const row = this.db.prepare('SELECT words FROM state_fields WHERE id = ?').get(id);
      if (!row) return false;
      let stored;
      try {
        stored = JSON.parse(String(row.words));
      } catch {
        return false;
      }
      if (!Array.isArray(stored)) return false;
      const next = stored.filter((x) => !(String(x?.词 ?? '') === w && x?.自定义 === true));
      if (next.length === stored.length) return false;  // 没找到自定义词
      this.db.prepare('UPDATE state_fields SET words = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(next), Date.now(), id);
      return true;
    } catch (error) {
      this.warn('删除词失败', error);
      return false;
    }
  }

  /** 日志保留期的时间下界 */
  logCutoff(now = Date.now()) {
    const days = Number(this.config.logRetentionDays);
    const span = (Number.isFinite(days) && days > 0 ? days : 30) * 86400000;
    return now - span;
  }

  /**
   * 清掉超出保留期的日志。
   * 只删审计流水——快照是当前状态，不能动；底色沉淀记录也一并按时间清。
   */
  pruneLogs(now = Date.now()) {
    if (!this.ready) return 0;
    try {
      const cutoff = this.logCutoff(now);
      const info = this.db.prepare('DELETE FROM state_logs WHERE at < ?').run(cutoff);
      const removed = Number(info?.changes ?? 0);
      if (removed > 0) this.log(`清理过期日志 ${removed} 条（保留 ${this.config.logRetentionDays} 天）`);
      return removed;
    } catch (error) {
      this.warn('清理过期日志失败', error);
      return 0;
    }
  }

  /** 快照保留期的时间下界 */
  snapshotCutoff(now = Date.now()) {
    const days = Number(this.config.snapshotRetentionDays);
    const span = (Number.isFinite(days) && days > 0 ? days : 30) * 86400000;
    return now - span;
  }

  /**
   * 裁掉超出保留期的快照历史行。
   * 关键：每个 scope+field 至少保留最新一行——否则当前状态会被清空，
   * readSnapshot 拿不到值、柱形归零。只删「过期的且不是该组最新」的行。
   */
  pruneSnapshots(now = Date.now()) {
    if (!this.ready) return 0;
    try {
      const cutoff = this.snapshotCutoff(now);
      /* 「最新」按 updated_at 判定，不能用 MAX(id)——id 只反映插入顺序，
         补录/导入的旧时间行 id 更大，会把真正的当前值误删。 */
      const info = this.db.prepare(`
        DELETE FROM state_snapshots
        WHERE updated_at < ?
          AND id NOT IN (
            SELECT id FROM (
              SELECT id,
                     ROW_NUMBER() OVER (
                       PARTITION BY scope_id, field_id
                       ORDER BY updated_at DESC, id DESC
                     ) AS rn
              FROM state_snapshots
            ) WHERE rn = 1
          )
      `).run(cutoff);
      const removed = Number(info?.changes ?? 0);
      if (removed > 0) this.log(`清理过期快照 ${removed} 行（保留 ${this.config.snapshotRetentionDays} 天）`);
      return removed;
    } catch (error) {
      this.warn('清理过期快照失败', error);
      return 0;
    }
  }

  /** 写入路径上的节流清理：最多每 6 小时扫一次表 */
  maybePruneLogs(now = Date.now()) {
    if (!this.ready) return;
    if (now - this.lastPruneAt < 6 * 3600000) return;
    this.lastPruneAt = now;
    this.pruneLogs(now);
    this.pruneSnapshots(now);
  }

  /**
   * 分页读状态日志（新的在前）。
   *
   * @param {{ sessionId?: string, page?: number, pageSize?: number }} query
   */
  logsFor(query = {}) {
    if (!this.ready) return { total: 0, page: 0, pageSize: 20, items: [] };
    const sessionId = String(query.sessionId ?? '');
    const pageSize = clamp(Math.trunc(Number(query.pageSize) || 20), 1, 100);
    const page = Math.max(0, Math.trunc(Number(query.page) || 0));
    try {
      /* 带 sessionId 只看本会话；不带则看全部（含底色沉淀），便于排查。
         一律叠加保留期条件：物理清理是节流的，这里保证界面立刻看不到过期条目。 */
      const cutoff = this.logCutoff();
      const where = sessionId === '' ? 'WHERE at >= ?' : 'WHERE session_id = ? AND at >= ?';
      const args = sessionId === '' ? [cutoff] : [sessionId, cutoff];
      const total = Number(this.db.prepare(`SELECT COUNT(*) AS n FROM state_logs ${where}`).get(...args)?.n ?? 0);
      const rows = this.db.prepare(`
        SELECT scope_id, session_id, turn, changes, source, at
        FROM state_logs ${where}
        ORDER BY at DESC, id DESC
        LIMIT ? OFFSET ?
      `).all(...args, pageSize, page * pageSize);
      return {
        total,
        page,
        pageSize,
        items: rows.map((row) => ({
          scopeId: String(row.scope_id),
          sessionId: String(row.session_id),
          turn: row.turn === null ? null : Number(row.turn),
          source: String(row.source),
          at: Number(row.at),
          changes: safeJson(row.changes, {})
        }))
      };
    } catch (error) {
      this.warn('读取日志失败', error);
      return { total: 0, page, pageSize, items: [] };
    }
  }

  snapshotFor(sessionId, now = Date.now()) {
    const fields = this.fields();
    const dims = fields.map((field) => {
      /* 显示用 relaxedValue（存储值经弛豫），疲劳已在写入时计入存储，不再二次扣减。
         这样柱形值与日志 after 同源，能对上。 */
      const value = Math.round(this.relaxedValue(sessionId, field, now));
      const band = field.bands.find((b) => value >= Number(b.min)) ?? field.bands[field.bands.length - 1];
      const base = this.readSnapshot(GLOBAL_SCOPE, field.id);
      return {
        id: field.id,
        label: field.label,
        builtin: field.builtin,
        value,
        baseline: field.baseline,
        floor: base ? Math.round(Number(base.value)) : field.baseline,
        bandText: band?.text ?? '',
        wordCount: field.words.length,
        /* 分钟；0 = 不衰减。前端按它渲染「衰减：30分钟 / 2小时 / 不衰减」 */
        halfLifeMin: field.decayHalfLifeMin,
        bands: field.bands
      };
    });
    return {
      sessionId,
      dimensions: dims,
      /* 「当前会话状态不沉淀」开关的当前值（按会话）：前端开关据此渲染 */
      flushSkipped: sessionId !== '' && this.flushSkipSet.has(sessionId),
      enabled: this.config.enabled,
      llmEnabled: this.config.llmEnabled,
      settings: { ...this.config }
    };
  }

  /**
   * 读某会话的状态时间序列，供前端折线图。
   * 数据源是快照表（追加式）——按粒度分桶，每桶取「桶末时刻的弛豫值」，
   * 这样既能反映写入跳变，也能反映两次写入之间的自然回落，不是只连写入点。
   *
   * 两种窗口模式：
   *   ① 默认（分钟/小时粒度）：右端 = 现在，spanMin 定跨度，左端贴合数据；
   *   ② 日历模式（天粒度）：传 startAt/endAt（毫秒），用户自选区间，
   *      跨度上限 30 天——超过则把 startAt 压到 endAt-30天，保证图表可读。
   *
   * @param {string} sessionId
   * @param {{ granularity?: 'minute'|'hour'|'day', spanMin?: number, startAt?: number, endAt?: number }} query
   * @returns {{ granularity: string, bucketMs: number, isCustom: boolean, points: Array<{at:number, values:Object}> }}
   */
  historyFor(sessionId, query = {}) {
    const granularity = ['minute', 'hour', 'day'].includes(String(query.granularity))
      ? String(query.granularity)
      : 'hour';
    const bucketMs = granularity === 'minute' ? 60000 : granularity === 'day' ? 86400000 : 3600000;
    const defaultSpan = granularity === 'minute' ? 60 : granularity === 'day' ? 30 * 1440 : 24 * 60;
    const spanMin = Number(query.spanMin) > 0 ? Number(query.spanMin) : defaultSpan;
    const empty = { granularity, bucketMs, spanMin, isCustom: false, now: Date.now(), startAt: 0, endAt: 0, points: [] };
    if (!this.ready) return empty;
    const scope = String(sessionId ?? '');
    if (scope === '') return empty;
    try {
      const fields = this.fields();
      const now = Date.now();
      /* 日历模式：前端给了明确的起止时间 */
      const qStart = Number(query.startAt);
      const qEnd = Number(query.endAt);
      const isCustom = Number.isFinite(qStart) && qStart > 0 && Number.isFinite(qEnd) && qEnd > qStart;
      let startAt;
      let endAt;
      if (isCustom) {
        /* 钳制 30 天上限：endAt 不超过 now，startAt 不早于 endAt-30天 */
        endAt = Math.min(qEnd, now);
        startAt = Math.max(qStart, endAt - 30 * 86400000);
        if (startAt >= endAt) return empty;
      } else {
        const spanMs = spanMin * 60000;
        /* 窗口右端对齐「现在」：x 轴最右侧就是当前时刻。
           左端取 max(窗口左边界, 最早数据)，数据比窗口短时贴合数据、不留大片空白。 */
        endAt = now;
        startAt = now - spanMs;
      }
      const rows = this.db.prepare(`
        SELECT field_id, value, updated_at FROM state_snapshots
        WHERE scope_id = ? AND updated_at >= ? AND updated_at <= ?
        ORDER BY updated_at ASC, id ASC
      `).all(scope, startAt, endAt);
      if (rows.length === 0) return empty;
      if (!isCustom) {
        /* 非日历模式：起点贴合最早数据，曲线从有数据处开始、不留空白 */
        startAt = Math.max(startAt, Number(rows[0].updated_at));
      }
      /* 桶数按「实际跨度 / 桶宽」算；日历模式下最后一桶落在 endAt 上 */
      const buckets = clamp(Math.round((endAt - startAt) / bucketMs) || 1, 1, 240);
      const byField = new Map();
      for (const row of rows) {
        const key = String(row.field_id);
        if (!byField.has(key)) byField.set(key, []);
        byField.get(key).push({ value: Number(row.value), at: Number(row.updated_at) });
      }
      const points = [];
      for (let i = 0; i < buckets; i += 1) {
        /* 最后一桶收敛到 endAt —— 默认模式即「现在」，日历模式即所选结束时刻 */
        const at = i === buckets - 1 ? endAt : startAt + i * bucketMs;
        const values = {};
        for (const field of fields) {
          const series = byField.get(field.id);
          if (!series || series.length === 0) continue;
          /* 找 <= at 的最后一条快照作为基准，再按弛豫公式外推到 at */
          let base = null;
          for (const item of series) {
            if (item.at <= at) base = item;
            else break;
          }
          if (!base) continue;
          values[field.id] = Math.round(this.projectValue(field, base.value, base.at, at));
        }
        points.push({ at, values });
      }
      return { granularity, bucketMs, spanMin, isCustom, now, startAt, endAt, points };
    } catch (error) {
      this.warn('读取状态历史失败', error);
      return empty;
    }
  }

  /** 把某维度「基准值 + 基准时刻」按衰减外推到目标时刻（0 = 不衰减，原样返回） */
  projectValue(field, value, fromAt, toAt) {
    const half = Number(field.decayHalfLifeMin) || 0;
    if (half <= 0) return value;
    const elapsedMin = Math.max(0, (toAt - fromAt) / 60000);
    const factor = Math.pow(0.5, elapsedMin / half);
    return field.baseline + (value - field.baseline) * factor;
  }

  close() {
    try {
      this.db?.close?.();
    } catch {
      /* 忽略 */
    }
    this.db = null;
    this.ready = false;
  }
}

/* ── 局部工具 ─────────────────────────────────────────────────────────── */

function safeJson(text, fallback) {
  try {
    const value = JSON.parse(String(text ?? ''));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

/** 命中位置前 2–3 字（英文前两个词）里有没有否定词 */
function hasNegationBefore(text, index) {
  const head = text.slice(Math.max(0, index - 3), index);
  if (head === '') return false;
  if (NEGATION_WORDS.some((w) => head.includes(w))) return true;
  /* 英文：往前数两个词 */
  const words = text.slice(0, index).trim().split(/\s+/);
  const tail = words.slice(-2).join(' ');
  return NEGATION_WORDS.some((w) => tail.includes(w));
}

function defaultDataDir() {
  const dir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'), '.dsh-session-kit');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/* ── 安装 ─────────────────────────────────────────────────────────────── */

/**
 * 把状态引擎挂到插件上。整块独立：初始化失败只记日志，不影响会话管理主功能。
 *
 * @returns {StateStore | undefined} 供 index.js 加 HTTP 路由
 */
export function installStateFeature(ctx, options = {}) {
  let store;
  try {
    store = new StateStore(ctx, options);
  } catch (error) {
    try {
      ctx?.logger?.warn?.(`[${PLUGIN_NAME}] state feature install failed:`, error);
    } catch {
      /* 忽略 */
    }
    return undefined;
  }
  if (!store.ready) return undefined;

  /* 固定规则只注册一次；实时状态仍由 agent/pre-step 注入，避免动态值进入 system section。 */
  if (typeof ctx.systemPrompt?.section === 'function') {
    try {
      ctx.effect(() => ctx.systemPrompt.section({
        name: STATE_GUIDE_SECTION,
        order: STATE_GUIDE_ORDER,
        text: STATE_GUIDE_TEXT,
        interpolate: false
      }), `${PLUGIN_NAME}: state expression rules`);
      /* AI角色设定：text 是动态 getter——宿主每轮构建提示词时取值，
         弹窗保存后下一轮生效，无需重注册（与 index.js 全局提示词同一模式）。
         [角色设定] 标头把它与相邻 section 分隔开。 */
      ctx.effect(() => ctx.systemPrompt.section(Object.freeze({
        name: STATE_PERSONA_SECTION,
        order: STATE_PERSONA_ORDER,
        text: () => store.getPersonaSectionText()
      })), `${PLUGIN_NAME}: state persona`);
    } catch (error) {
      store.warn('状态表达规则注册失败', error);
    }
  }

  /* 启动补做：上次进程退出时没来得及沉淀的会话。等宿主会话注册表就绪后
     执行一次（最多等 60s）——只沉淀仍然存在的会话,已删除/外部的孤儿 scope
     不会被沉淀,也就不会再把旧值写回底色、产生幽灵「会话沉淀」日志。 */
  let flushTries = 0;
  const flushWhenSessionsReady = () => {
    flushTries += 1;
    const byId = ctx?.sessions?.list?.getSnapshot?.()?.byId;
    if (byId && Object.keys(byId).length > 0) {
      store.flushAllIdle();
      return;
    }
    if (flushTries < 30) setTimeout(flushWhenSessionsReady, 2000);
    else store.warn('会话注册表未就绪，跳过本次启动沉淀');
  };
  flushWhenSessionsReady();

  /* 启动清一次过期日志与快照历史 */
  try {
    store.pruneLogs();
    store.pruneSnapshots();
  } catch (error) {
    store.warn('启动清理过期数据失败', error);
  }

  /* 每轮结束：判定 + 更新 + 落库。
     ⚠️ 必须监听 'session/event' 并自己判 event.type —— DSH 没有 'turn/end' 这个钩子名，
     直接 ctx.on('turn/end') 永远不会触发（memory.js / task.js 也都是 session/event）。
     延迟一拍再算：turn/end 事件此刻可能还没落进事件流，同步读会拿到缺失的边界。 */
  ctx.effect(() => ctx.on('session/event', (session, event) => {
    try {
      if (event?.type !== 'turn/end') return;
      if (event.data?.reason?.kind !== 'completed') return;
      const turn = Number(event.data?.turn);
      if (!Number.isFinite(turn)) return;
      /* 用 setTimeout(0) 而不是 Promise.resolve().then：让本轮事件先落盘，
         微任务可能与宿主的写入顺序交错。 */
      setTimeout(() => {
        try {
          store.onTurnEnd(session, turn);
        } catch (error) {
          store.warn('turn/end 处理失败', error);
        }
      }, 0);
    } catch (error) {
      store.warn('session/event 处理失败', error);
    }
  }), `${PLUGIN_NAME}: state turn/end`);

  /* 每步注入。
     ⚠️ 必须 prepend:true —— 挂在链首意味着「等整条 pre-step 链跑完」才执行到这里，
     此时宿主已经把 system/message 落进 surface。若挂在链尾，注入会发生在
     system/message 之前，user/message 抢占「第一个 surface 事件」的位置，
     整份会话日志会被判为 corrupt（SessionFormatError: requires a protected first surface head）。
     记忆注入同样是 prepend:true，这是它没出问题的原因。 */
  ctx.effect(() => ctx.on('agent/pre-step', async (args, next) => {
    const decision = await next();
    try {
      if (decision?.kind === 'enter') store.inject(args?.agent?.session);
    } catch (error) {
      store.warn('状态注入失败', error);
    }
    return decision;
  }, { prepend: true }), `${PLUGIN_NAME}: state inject`);

  /* 调词表用的显微镜：只跑词法，不动状态 */
  const tools = ctx.get?.('tools', false);
  if (tools?.register) {
    ctx.effect(() => tools.register(defineTool({
      name: 'status_test',
      description: '对一段文本跑状态词法判定，返回各维度的增量与命中的词。**不修改状态**，只用于验证词表与指向规则是否符合预期。排查"为什么这轮状态没动/动了这么多"时先调它。',
      parameters: {
        text: { type: 'string', required: true, description: '要判定的文本，通常是一句用户原话。' }
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            增量: { type: 'string', required: true },
            命中: { type: 'string', required: true }
          }
        },
        render: (_args, value) => [{
          type: 'text',
          text: `增量：${value?.增量 ?? '{}'}\n命中：${value?.命中 ?? '（无）'}`
        }]
      },
      async execute(args) {
        const result = store.scoreText(String(args?.text ?? ''));
        const 增量 = Object.fromEntries(Object.entries(result.增量).filter(([, v]) => v !== 0));
        return {
          增量: JSON.stringify(增量),
          命中: result.命中.length === 0
            ? '（无）'
            : result.命中.map((h) => `${h.词}[${h.档位}/${h.维度id} ${h.delta > 0 ? '+' : ''}${h.delta}]`).join('，')
        };
      }
    })), `${PLUGIN_NAME}: status_test tool`);
  }

  return store;
}
