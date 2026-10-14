import { BlockAssembler, createUserMessage, createSystemMessage } from '@deepseek-ai/dsh-llm';
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
const MEMORY_CONTEXT_SOURCE = 'dsh-session-kit-memory-context';
/* 用户显式要求记住时追加的提示消息来源（仅本插件识别，用于避免同一用户消息重复追加提示）。 */
const MEMORY_REQUEST_SOURCE = 'dsh-session-kit-memory-request';
/* 提示消息正文的固定指纹：用于识别本插件自己写下的提示行，不随文案改动失效。 */
const MEMORY_REQUEST_MARKER = 'dsh-session-kit:memory-request';
const MEMORY_DISTILL_SOURCE = 'dsh-session-kit-memory-distill';
const MEMORY_MANUAL_SOURCE = 'dsh-session-kit-memory-manual';
/* 记忆剔除 tombstone 与 turns-del 的空消息特征保持一致（空 assistant + replace），
   使用独立 provider/model 值以便审计时区分来源；deriveMessages 对空内容一律产出 null。 */
const MEMORY_EJECT_PROVIDER = 'dsh-session-kit-memory-eject';
const MEMORY_EJECT_MODEL = 'tombstone';
/* 判定一条 message source 是否由本插件写入的记忆注入。
   只认自定义 producer kind（v4 起 source.kind 必须是生产者自有标识）；
   不再兼容历史上的 kind:'plugin' + plugin:'memory' 形态——旧格式的注入行
   在读取端已无法解析出 hitIds/snapshot，继续识别只会让它们进入剔除流程
   并写出空 tombstone，故在此彻底排除。 */
function hasMemorySource(source, kind) {
  return source?.kind === kind;
}

/* ── 注入 source 的私有元数据统一存进 sections（form: 'snapshot'）──
   命中 id 与结构化快照以 JSON 文本段随注入事件持久化；正文仍在 message.content，
   模型可见部分完全不受影响（source 不参与 provider 序列化）。
   ContextFormed 是判别联合：form:'snapshot' 只接受 sections，form:'notice' 只接受
   summary，两者的字段不通用，故 snapshot 形态不再携带 summary。
   读取端只解析 sections，不再认顶层平铺字段与历史旧格式。 */
const SECTION_HIT_IDS = 'hitIds';
const SECTION_SNAPSHOT = 'snapshot';
/* 折叠行摘要存于私有段内：snapshot 形态没有 summary 字段，摘要改由快照推导。 */
const SECTION_SUMMARY = 'summary';
function safeJsonArray(value) {
  try {
    const text = JSON.stringify(Array.isArray(value) ? value : []);
    return typeof text === 'string' ? text : '[]';
  } catch {
    return '[]';
  }
}
function safeJsonText(value) {
  try {
    const text = JSON.stringify(typeof value === 'string' ? value : '');
    return typeof text === 'string' ? text : '""';
  } catch {
    return '""';
  }
}
function buildMemorySections(hitIds, snapshot, summary) {
  return [
    { name: SECTION_HIT_IDS, text: safeJsonArray(hitIds) },
    { name: SECTION_SNAPSHOT, text: safeJsonArray(snapshot) },
    { name: SECTION_SUMMARY, text: safeJsonText(summary) }
  ];
}
function buildMemorySource(input) {
  const { kind, hitIds, snapshot, summary } = input;
  return {
    kind,
    form: 'snapshot',
    sections: buildMemorySections(hitIds, snapshot, summary)
  };
}
function readMemorySectionArray(source, name) {
  if (!Array.isArray(source?.sections)) return [];
  const section = source.sections.find((entry) => entry?.name === name);
  if (section === undefined || typeof section.text !== 'string' || section.text.length === 0) return [];
  try {
    const parsed = JSON.parse(section.text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function readMemoryHitIds(source) {
  return readMemorySectionArray(source, SECTION_HIT_IDS);
}
function readMemorySnapshot(source) {
  return readMemorySectionArray(source, SECTION_SNAPSHOT);
}
/* 摘要读取（供未来 UI/调试；当前插件内部不消费，仅保证信息不丢）。 */
function readMemorySummary(source) {
  if (!Array.isArray(source?.sections)) return '';
  const section = source.sections.find((entry) => entry?.name === SECTION_SUMMARY);
  if (section === undefined || typeof section.text !== 'string' || section.text.length === 0) return '';
  try {
    const parsed = JSON.parse(section.text);
    return typeof parsed === 'string' ? parsed : '';
  } catch {
    return '';
  }
}
const MAX_BODY_BYTES = 768 * 1024;
const MAX_MEMORY_TEXT_LENGTH = 20000;
const MAX_DIRECTORY_NAME_LENGTH = 80;
const MAX_DIRECTORY_REMARK_LENGTH = 500;
const MAX_TAG_NAME_LENGTH = 32;
const MAX_TAGS_PER_MEMORY = 12;
/* 自定义标签复用阈值：短标签长度下限 + 允许的长度差。
   "蒸馏"→"蒸馏逻辑"（差 2）合并；"UI" 过短不参与合并；"UI样式"/"性能优化" 非子串不合并。 */
const TAG_REUSE_MIN_CHARS = 3;
const TAG_REUSE_MAX_LENGTH_DELTA = 2;
/* 防标签爆炸：蒸馏提示词展示的已有自定义标签目录上限（按引用数取最高频的词），
   以及包含归并的最小短边（低于该长度不做归并，防「UI」「任务」吞并无关标签）。 */
const MAX_TAG_CATALOG_SIZE = 80;
const TAG_MERGE_MIN_SHORT_SIDE = 4;
const MAX_SNAPSHOT_MEMORIES = 1200;
const MAX_DISTILL_INPUT_CHARS = 14000;
const MAX_DISTILL_TOOL_ARG_CHARS = 1600;
const DISTILL_TIMEOUT_MS = 300000;
/* 蒸馏输出上限。原为 1024，但输出含 位置/对象/内容/踩坑/tags 五个字段：
   工具候选变多后（位置可达 20+ 条路径、对象 20+ 符号），1024 token 会在 JSON 中途截断，
   截断的 JSON 触发上游 provider 校验失败（表现为 llm-error: Unexpected non-whitespace
   character after JSON）。提高上限以容纳完整结构化输出。 */
const DISTILL_MAX_OUTPUT_TOKENS = 3072;
/* 交给模型的工具候选上限：避免 prompt 膨胀并诱导模型逐条罗列（见 distillTurnAttempt 注释）。 */
const MAX_DISTILL_PATH_CANDIDATES = 8;
const MAX_DISTILL_SYMBOL_CANDIDATES = 12;
const RECALL_TIME_BUDGET_MS = 30_000;
const MEMORY_TOKEN_USAGE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
/* 单次召回注入总条数上限：既约束四段席位算术（段4 吸收前三段缺口），
   也约束 packHits 的最终打包条数；两者语义同一，共用一个常量。 */
const RECALL_MAX_ITEMS = 20;
/* 单条记忆注入截断上限（v12 起按【每个字段】独立适用）：string 超长截断、
   string[] 整体序列化超长截断；纯文本记忆整条适用该值。
   记忆存储不限长（用户写多少存多少），注入体积由此保证；截断只发生在注入时刻，
   库内正文不动，被截字段随「已截断」标注 + memory_read 提示可查全文。 */
const RECALL_ITEM_CONTENT_CHARS = 500;
const RECALL_SEGMENT_ITEMS = 5;
const EPHEMERAL_RECALL_ITEMS = 5;
/* v9 四段式注入：段1 底色（稳定层第一档，5 席）、段2 临时（不可见上下文补偿，5 席）、
   段3 混合竞争（5 席）、段4 纯永久兜底（固定 5 + 全部上游缺口）；候选充足时总注入恒 20。 */
/* ── 关系检索（memory_relate）──
   从结构化记忆的 `位置`/`对象` 共享推导记忆间的关系边，供按需工具查询。
   设计约束（均有实测依据）：
   - 不进召回管线：注入通道是零和（20 席），图在那里只是席位竞争者；
   - 不用 PPR：PPR 分数是概率分布（Σ=1），单点分数随库规模按 1/N 漂移；
   - 标签边默认关闭：实测标签边 448 条 vs 结构边 48 条 = 9:1，会淹没结构边。 */
const MEMORY_RELATE_DEFAULT_ITEMS = 10;
const MEMORY_RELATE_MAX_ITEMS = 30;
const MEMORY_RELATE_MAX_HOPS = 2;
/* 库规模 ≤ 该值时启动期同步重建边；超过则后台分批（照抄 FTS 重建模式）。
   阈值依据：实测 1000 条约 18ms（无感），3000 条约 62ms（开始可感）。 */
const MEMORY_EDGE_SYNC_REBUILD_MAX = 1000;
/* 后台分批大小：实测批次 200 时全部批次 < 16ms（一帧），用户无感。 */
const MEMORY_EDGE_REBUILD_BATCH_SIZE = 200;
const MEMORY_EDGE_DEFAULT_KINDS = Object.freeze(['same_file', 'same_symbol']);
const MEMORY_EDGE_ALL_KINDS = Object.freeze(['same_file', 'same_symbol', 'same_tag']);
const MEMORY_SETTING_EDGE_TAG_EDGES = 'edgeTagEdgesEnabled';
const MEMORY_SETTING_EDGE_INDEX_VERSION = 'memoryEdgeIndexVersion';
const MEMORY_EDGE_INDEX_VERSION = '2';

/* ── Embedding 语义检索（可选功能，默认关闭）──
   设计要点（均有实测/源码依据）：
   - 独立表 memory_embeddings：避免 10 处 SELECT m.* 被 4KB/条 BLOB 拖慢；
   - 独立字段 row.vectorScore：余弦不能写进 row.rank（会被 bm25Weight clamp 到 [0,8] 并与 BM25 混量纲）；
   - 不加独立召回额度：向量与现有通道检索同一批记忆，需要的是"排序话语权"而非"保证席位"；
   - 回填必须批量：实测 1000 条逐条需 3.3 分钟，批量 32 条/次仅 6.4 秒（30 倍差距）。 */
const MEMORY_VECTOR_MAX_WEIGHT = 10;      /* vector 分量封顶：与 bm25(0~8) 同量级，低于 customTag(28) */
const MEMORY_VECTOR_MIN_SCORE = 0.65;     /* 余弦准入阈值：只设 top-K 总会返回"最近的一条"，哪怕不相关 */
const MEMORY_EMBEDDING_BATCH_SIZE = 32;   /* 单次 embedding 调用条数（批量是最大杠杆：1000 条逐条 3.3min vs 批量 6.4s） */
/* 回填一律走后台分批（见 initMemoryEmbeddings 注释：init 无法 await）。
   每批处理 BATCH_SIZE × BACKFILL_MULTIPLIER 条待回填记忆。 */
const MEMORY_EMBEDDING_BACKFILL_MULTIPLIER = 4;
const MEMORY_EMBEDDING_TIMEOUT_REMOTE = 30_000;
const MEMORY_EMBEDDING_TIMEOUT_LOCAL = 5_000;        /* 本地【推理】超时 */
/* 本地【模型加载】超时：首次使用要从 HuggingFace 下载权重（数百 MB），
   用推理的 5 秒会把正常的首次加载判成失败，故单独放宽到 5 分钟。 */
const MEMORY_EMBEDDING_TIMEOUT_LOCAL_LOAD = 300_000;
const MEMORY_EMBEDDING_MAX_RETRY = 2;     /* 远程 API 失败重试次数（本地不重试） */
/* 可重试的 4xx：408 请求超时、429 限流 —— 都是瞬时状态，重试有意义。
   其余 4xx（400 参数 / 401 鉴权 / 403 权限 / 404 路径）重试注定得到同样结果，
   只会让用户白等退避（实测 401 多等 2.7s、404 多等 5.3s）；5xx 属服务端瞬时故障，仍重试。 */
const MEMORY_EMBEDDING_RETRYABLE_STATUS = new Set([408, 429]);
const MEMORY_SETTING_EMBEDDING_ENABLED = 'embeddingEnabled';
const MEMORY_SETTING_EMBEDDING_PROVIDER = 'embeddingProvider';
/* 模型指纹（内部状态，不上 UI）——照 ftsTokenizerVersion 先例 */
const MEMORY_SETTING_EMBEDDING_MODEL = 'embeddingModel';
/* 实测维度（内部状态，不上 UI）。存成 `model#实测维度@当时的配置维度`：
   用来在「用户没填维度」时让配置侧指纹与写入侧（实测）指纹同源，
   同时保证"用户改了配置维度"仍能触发重算（配置维度一变就丢弃实测值）。 */
const MEMORY_SETTING_EMBEDDING_DETECTED = 'embeddingDetected';

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
/* 结构分（身份分）权重：随 embedding 可用性切换。
   为什么分两档：结构分是「与查询无关的身份分」，它会与「与查询相关的语义分」（vector）争夺排序话语权。
   - embedding 未启用/不可用：语义分缺席（恒 0），结构分需要独自承担「身份记忆不漏」的排序职责 → 用满档。
   - embedding 已启用且可用：语义分参与竞争，若结构分仍用满档会压过语义分（旧值 20 vs bm25 8 的失衡）
     → 降到与 bm25 同量级，把话语权让给查询相关信号。
   注意：这只影响【排序】，不影响段1 的准入（准入走标签存在性，见 bottomRowIsRelevant）。 */
const STRUCTURE_TIER1_WEIGHT_FULL = 5;
const STRUCTURE_TIER1_MAX_WEIGHT_FULL = 20;
const STRUCTURE_TIER1_WEIGHT_REDUCED = 2;
const STRUCTURE_TIER1_MAX_WEIGHT_REDUCED = 8;
/* 默认（未显式传入时）取降档值——召回路径一定会传，这里只是给直调兜底。 */
const STRUCTURE_TIER1_WEIGHT = STRUCTURE_TIER1_WEIGHT_REDUCED;
const STRUCTURE_TIER1_MAX_WEIGHT = STRUCTURE_TIER1_MAX_WEIGHT_REDUCED;
const STRUCTURE_TIER2_WEIGHT = 3;
const STRUCTURE_TIER2_MAX_WEIGHT = 6;
/* 稳定层标签（时间权重分档 + 结构分身份）：第一档=底色 6 标签；第二档=5 标签；
   非稳定层=日常生活/工作项目，维持原有阶梯衰减（>120 天归零）。
   新增标签的分档依据：接口约束与接口摘要同族、决策记录与项目架构同族，均属长期
   资产故进第二档；排查记录是过程性内容、随时间贬值属合理，故意不进稳定层。 */
const STABLE_TIER1_TAGS = new Set(['用户偏好', '用户画像', '项目画像', '项目架构', '项目约束', '模块路径']);
const STABLE_TIER2_TAGS = new Set(['项目场景', '模块约束', '项目摘要', '模块摘要', '接口摘要', '接口约束', '决策记录']);
const MEMORY_TOOL_DEFAULT_ITEMS = 10;
const MEMORY_TOOL_MAX_ITEMS = 50;
/* ── 用户显式「记住」请求 ──
   判定只作用于用户手打原文（见 humanTextOfMessage），且必须落在句子首部：
   「记住」「帮我记」这类请求是祈使句开头，而「我记住了」「记住了先这样」是回应/收尾，
   句中提及（「你上次怎么记住的」）更不是请求。故前导语允许，位置不宽松。 */
const MEMORY_REQUEST_MAX_LENGTH = 2000;
/* ── 判定用的三块正则 ──
   前缀（可选的礼貌/意愿外壳）与动词（请求核心）分开写：中文里「帮我」「请」「我希望你」
   可以叠加也可以省略，而动词必须存在。动词表要覆盖「记/记住/记下/记一下/记下来」这组
   同源变体——最初只列了「记住/记得/记下」，导致「帮我记一下 X」整体不匹配。 */
/* 前缀 = 可叠加的礼貌/意愿/时间指示外壳。中文里这些词常组合出现
   （「这次也帮我记一下」「以后每次都记住」），故用重复组；但组内每一项都必须
   是可跳过的修饰语，否则「这次」「你」这类指示词会把请求整句挡掉。
   不包含名词「记忆」：像「选拔记忆」「查看记忆」这类短语不能被判成保存请求。 */
const MEMORY_REQUEST_PREFIX = '(?:(?:请|麻烦|帮我|帮忙|给我|替我|你要|你得|一定要|千万|务必|以后|之后|下次|每次都|这次|然后|另外|还有|顺便|也|再|都|就|先|我(?:想|要|希望|要求|请求)(?:你)?|请求你|你)\\s*)*';
/* 动词 = 核心词 + 可选动词后缀（先长后短，避免「记一下」被「记」+「一下」拆错）。
   后缀含「了」：「记住了」按用户要求要算记忆请求（光杆 → 追问），
   而「记住了先这样」「记下了吧」这类带收尾语气词的由 STOPWORDS 整体否决。
   除「记」族外还收「保存/存/收藏/别忘」这组同义说法，它们同样表达长期留存意图。

   ⚠️「记忆」「记录」的约束（用户明确要求）：
   这两个词本身是名词（「记忆 tab」「记录日志」），不能作为裸动词使用——
   否则「记忆tab除了现在显示的数据…」会被判成「记」+ 正文「忆tab…」的保存请求。
   因此它们只认两种搭配：① 带「一下」后缀（记忆一下 / 记录一下）；
   ② 带明确的请求前缀（给我记忆一下 / 帮我记录 / 请记录一下）。
   裸「记忆」「记录」一律不匹配，由 REQUEST_VERB_BARE 单独表达。 */
const MEMORY_REQUEST_VERB_WORD = '(?:保存下来|保存|存一下|存|收藏|别忘了|别忘记|不要忘记|记住|记得|记下来|记一下|记下|记着|记牢|记好|记忆一下|记录一下)';
/* 裸「记」：必须排除「记忆」「记录」开头的场景，故加否定前瞻。
   这样「记忆一下」不会退化成「记」+「忆一下」，而是由上面的长词整体命中。 */
const MEMORY_REQUEST_VERB_BARE = '(?:记(?!忆|录)|记忆一下|记录一下)';
/* 请求前缀（与 PREFIX 同源，用于「前缀 + 名词动词」这一搭配）。 */
const MEMORY_REQUEST_PREFIX_GROUP = '(?:请|麻烦|帮我|帮忙|给我|替我|你要|你得|一定要|千万|务必|以后|之后|下次|每次都|这次|然后|另外|还有|顺便|也|再|都|就|先|我(?:想|要|希望|要求|请求)(?:你)?|请求你|你)';
/* 完整动词：无前缀时用受限词表；有前缀时允许「记忆」「记录」直接跟在后面。
   顺序很关键——「记忆一下/记录一下」必须排在「记忆/记录」之前，否则短词先命中。 */
const MEMORY_REQUEST_VERB = `(?:${MEMORY_REQUEST_VERB_WORD}|(?:${MEMORY_REQUEST_PREFIX_GROUP})\\s*(?:记忆|记录)|${MEMORY_REQUEST_VERB_BARE})\\s*(?:下来|一下|住|下|了|好|着)?`;
/* 永久化/长期化限定词，可出现在动词前。 */
const MEMORY_REQUEST_QUALIFIER = '(?:永久|长期|永远|一直|务必|每次)';
/* 分隔符：冒号/逗号/顿号/句号/分号/破折号等，**可省略**。
   用户往往不打标点（「帮我记一下 我叫喵喵」「帮我记住我的时区是 UTC+8」），
   故这里是「可选 + 零宽」，靠后面的贪婪正文兜住内容；正文不许以分隔符或空白开头。 */
const MEMORY_REQUEST_SEPARATOR = '[:：,，、。.；;!！~～\\-—]?';
/* 正文：紧跟动词之后的内容。只要不是纯分隔符/语气词，就当作要记的对象。 */
const MEMORY_REQUEST_BODY = '(?<body>[\\s\\S]+)';
/* 形态一：请求动词 +（可省分隔符）+ 对象（帮我记住 X、记住：X、帮我记一下 X） */
const MEMORY_REQUEST_BODY_PATTERN = new RegExp(`^${MEMORY_REQUEST_PREFIX}${MEMORY_REQUEST_QUALIFIER}?\\s*${MEMORY_REQUEST_VERB}\\s*${MEMORY_REQUEST_SEPARATOR}\\s*${MEMORY_REQUEST_BODY}$`);
/* 形态二：对象 + 请求动词收尾（把这个 API 地址记住、这段配置记一下） */
const MEMORY_REQUEST_TAIL_PATTERN = new RegExp(`^${MEMORY_REQUEST_PREFIX}(?<lead>[\\s\\S]{1,120}?)\\s*(?:要|得|请)?(?:给我|帮我)?${MEMORY_REQUEST_VERB}\\s*[。.!！~～]?$`);
const MEMORY_REQUEST_PATTERNS = [MEMORY_REQUEST_BODY_PATTERN, MEMORY_REQUEST_TAIL_PATTERN];
/* 光杆请求（只有前缀 + 可选符号，没有任何对象）：「记住：」「帮我记一下，」「记住了」。
   它必须与「有对象」区分开：用户点名的形式应被识别为「记忆请求」，
   但没有可落库的对象——此时不写记忆，只提示模型追问用户要记什么。 */
const MEMORY_REQUEST_BARE = new RegExp(`^${MEMORY_REQUEST_PREFIX}${MEMORY_REQUEST_QUALIFIER}?\\s*${MEMORY_REQUEST_VERB}\\s*${MEMORY_REQUEST_SEPARATOR}\\s*[。.!！?？~～]*$`);
/* 正文必须是「真内容」：不能只是前缀/动词的零碎残留。
   正则回溯时前缀组会把「帮我」吐回来、动词后缀会把「一下」吐回来当正文
   （实测「帮我记」→ body「帮我」、「记一下」→ body「一下」），这类碎片必须否决。
   碎片表 = 外壳词 + 动词后缀 + 语气词，单独列出以便随前缀表一起维护。 */
const MEMORY_REQUEST_FRAGMENTS = [
  '请', '麻烦', '帮我', '帮忙', '给我', '替我', '你要', '你得', '一定要', '千万', '务必',
  '以后', '之后', '下次', '每次都', '这次', '然后', '另外', '还有', '顺便', '都', '就', '先',
  '我', '你', '我们', '你们', '想', '要', '希望', '要求', '请求',
  '记住', '记得', '记忆', '记下', '记着', '记牢', '记好', '记录', '记',
  '一下', '下来', '住', '下', '好', '着', '了', '个', '的', '吧', '啊', '呀', '哦', '嗯', '吗', '呢'
];
const MEMORY_REQUEST_BODY_REJECT = new RegExp(`^(?:${MEMORY_REQUEST_FRAGMENTS.join('|')}){1,4}$`);
/* 允许尾部带标点的碎片正文（「一下,」）。 */
const MEMORY_REQUEST_FRAGMENT_ONLY = new RegExp(`^(?:${MEMORY_REQUEST_FRAGMENTS.join('|')}|[。.!！?？~～,，、;；:：\\s])+$`);
/* 带收尾语气词的光杆（「记住了先这样」「记下了吧」）不是请求；但纯「记住了」按用户要求算请求。 */
const MEMORY_REQUEST_STOPWORDS = /^(?:(?:保存下来|保存|存一下|存|收藏|别忘了|别忘记|不要忘记|记住|记得|记忆|记下来|记一下|记下|记着|记牢|记好|记录|记)\s*(?:下来|一下|住|下|了|好|着|起来)?\s*)?(?:先这样|就这样|这条|这个|这些|吧|啊|呀|哦|嗯|的|吗|呢)[。.!！?？~～,，、;；:：]*$/;
/* 否定前缀：不记住 / 别保存 / 不用记 —— 明确"不要记忆"的指令不得反向建记忆。 */
const MEMORY_REQUEST_NEGATION = /(?:不|别|勿|无需|不用|不要|没必要|不必|禁止)\s*(?:再)?\s*(?:用|要|得|需要)?\s*(?:记住|记下|记得|记录|保存|存|收藏|提醒)/;
/* 句中从句/条件/举例/评述语境：这些位置的「记住」不是面向助手的请求。
   末段覆盖「记住密码这种设计不安全」这类陈述句——它把「记住 X」当话题评述。
   注意必须要求「这种/这个 + 判断词」紧邻（中间只允许极短的名词），
   否则会误伤正常请求：「请记住这个项目用 pnpm 而不是 npm」里
   「这个」与「不是」隔了整个名词短语，属于真请求，不能否决。 */
const MEMORY_REQUEST_GUARD = /(?:如果|假如|要是|假设|一旦|无论|不管|是否|所谓|比如|例如|除非|能否|可否|怎么|如何|为什么|谁|什么|哪里|何时)[\s\S]{0,12}(?:记住|记下|记得|记录|保存)|(?:记住|记下|记得|记录)\s*(?:密码|用户|输入)?\s*(?:这种|这类|那个)[^\s，,。.]{0,6}(?:是|不|很|太|会|能|应该|需要|危险|安全|重要|麻烦)/;
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
const MEMORY_SETTING_RECALL_SETTINGS = 'recallSettings';
const DEFAULT_RECALL_SETTINGS = Object.freeze({ mode: 'default', maxItems: 20, segments: Object.freeze({ segment1: 5, segment2: 5, segment3: 5, segment4: 5 }) });
const EXCLUDE_TEMPORARY_RECALL_SETTINGS = Object.freeze({ mode: 'exclude-temporary', maxItems: 15, segments: Object.freeze({ segment1: 5, segment2: 0, segment3: 5, segment4: 5 }) });
const ACTIVITY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/* 每条记忆的正文修订保留条数（超出裁掉最旧的；≤0 或非法值视为不限制）。 */
const MEMORY_REVISION_CAP_DEFAULT = 50;
/* 新增记忆前的冲突裁决：检索候选条数上限与 LLM 输出上限。 */
/* 新增记忆前的冲突裁决：只看同一记忆项目内的前 N 条候选。 */
const MEMORY_CONFLICT_CANDIDATES = 3;
/* 与蒸馏路径（DISTILL_MAX_OUTPUT_TOKENS = 3072）对齐。原先 1200 对推理模型不够：
   reasoning 块先占用输出预算，预算被吃光时 text 块为空，裁决输出解析不出动作，
   冲突检测就会静默降级为「直接新增」——表现为日志里的 memory_conflict_missed。 */
const MEMORY_CONFLICT_MAX_OUTPUT_TOKENS = 3072;
const MEMORY_CONFLICT_TIMEOUT_MS = 30 * 1000;
/* 裁决改写了既有记忆时，往会话里落一条提示（模型可见），让用户与模型都知道这次新增被合并了。 */
const MEMORY_CONFLICT_SOURCE = 'dsh-session-kit-memory-conflict';
function conflictNoticeText(action, memoryId, reason) {
  const why = reason ? `（${reason}）` : '';
  if (action === 'update') {
    return [
      `${MEMORY_CONFLICT_SOURCE} · 本次 memory_add 已判定为「更新既有记忆」而非新增${why}。`,
      `目标记忆 id：${memoryId}。已把新信息合并进该记忆的正文（旧正文已存档为历史版本，可在记忆管理弹窗查看或恢复）。`,
      '无需再调用 memory_add 重复写入同一事实；如需读取最新正文可用 memory_read。'
    ].join('\n');
  }
  return [
    `${MEMORY_CONFLICT_SOURCE} · 本次 memory_add 已判定为「与既有记忆语义等价」，未新增${why}。`,
    `等价记忆 id：${memoryId}。如需修正其表述，请用 memory_update。`
  ].join('\n');
}
/* 宽容地读模型输出里的 action 取值：只要能看出它写了 add/update/skip 就算是「有明确判断」。
   用于区分「模型确实判为全新」与「输出根本没解析出来」——后者才算冲突检测失效。 */
function readConflictActionToken(output) {
  const raw = stripCodeFence(String(output ?? '').trim());
  const parsed = parseJsonObject(raw);
  if (parsed !== undefined && typeof parsed.action === 'string') {
    const action = parsed.action.trim().toLowerCase();
    if (['add', 'update', 'skip'].includes(action)) return action;
  }
  const loose = /"action"\s*:\s*"(add|update|skip)"/i.exec(raw);
  return loose === null ? '' : loose[1].toLowerCase();
}

/* 冲突检测未生效日志的正文：写清触发原因与细节，便于排查。 */
function conflictMissedText(reason, detail, candidateCount) {
  const labels = {
    'candidate-search-failed': '候选检索失败',
    'no-model-route': '取不到模型路由',
    'llm-failed': '模型调用失败',
    'llm-timeout': '模型调用超时',
    /* 空输出与「有输出但解析不出动作」是两种根因：前者多为推理模型把输出预算
       耗在 reasoning 上，后者是模型没按 JSON 契约作答。分开记才能直接定位。 */
    'empty-output': '模型输出为空（无 text 块）',
    'unparsed-output': '模型输出无法解析',
    /* 裁决期间目标记忆被用户停用：放弃合并改走新增，避免覆盖用户的停用决定。 */
    'target-inactive': '目标记忆在裁决期间被停用'
  };
  const lines = [
    `冲突检测未生效：${labels[reason] ?? reason}`,
    '本次 memory_add 已按「全新记忆」直接写入（未做相似记忆合并）。'
  ];
  if (Number.isSafeInteger(candidateCount) && candidateCount > 0) lines.push(`当时检索到 ${candidateCount} 条相似候选，但未能判定关系。`);
  const detailText = normalizePlainText(detail, 400);
  if (detailText) lines.push(`细节：${detailText}`);
  return lines.join('\n');
}

/* 冲突裁决提示词：要求只输出规范 JSON，禁止分析草稿。 */
/* 冲突裁决提示：拆成 { instructions, data } 两段（v12.21）。
   原因同蒸馏：某些 provider 强制要求首条消息为 system，整段塞进 user 会被直接拒绝
   （workbuddy: first message is not system prompt）。instructions → system，
   data（新记忆 + 相似旧记忆）→ user。 */
function buildMemoryConflictPrompt(body, candidates) {
  const list = candidates.map((item, index) => {
    const tags = Array.isArray(item.tags) && item.tags.length > 0 ? item.tags.join('、') : '未标记';
    return `[${index + 1}] id=${item.id}；项目：${item.directoryName || '未命名'}；标签：${tags}\n${item.text}`;
  }).join('\n\n');
  return {
    instructions: [
      '你在为长期记忆库做「新增前去重」判定。会在下一条消息里收到待写入的新记忆，以及同一记忆项目内按关键词检索到的相似旧记忆。',
      '',
      '## 你的任务',
      '逐条判断新记忆与这些旧记忆的关系，选一个动作：',
      '- `skip`：新记忆与某条旧记忆**语义等价**（只是换了个说法），无需新增也无需改写 → 给出该条 `memoryId`。',
      '- `update`：新记忆是某条旧记忆的**更新、修正或补充**（同一件事的进展/纠正/追加），应当合并进去 →',
      '  给出该条 `memoryId` 与 `text`（**改写后的完整正文**）。',
      '  改写要求：保留旧记忆中仍然成立的内容，只改需要改的部分，不要丢掉其它有效信息；',
      '  正文风格与新记忆保持一致（代码类用 JSON 结构，生活类用纯文本）。',
      '- `add`：新记忆是全新信息 → 直接新增。',
      '  若新记忆**替代**了某条旧记忆（旧记忆描述的状态/方案/目标已不再成立，例如「用 A 方案」被「改用 B 方案」取代），',
      '  在新增的同时给出 `supersedesMemoryId` 指向那条被替代的旧记忆——系统会据此让旧记忆按新事实的生效时间失效（不删除，仅降权）。',
      '  注意：只有「旧记忆已不再成立」才填 `supersedesMemoryId`；「同一件事的进展/补充」应当用 `update` 而不是新增 + 替代。',
      '',
      '## 判定要点',
      '- **这些候选来自关键词检索，可能全部只是用词巧合、与新记忆无关。**',
      '  若没有一条真正对应新记忆，必须返回 `add`。**不要为了「不浪费候选」而强行合并无关内容。**',
      '- 同一件事的**不同措辞**算等价（skip），不要因为用词不同就当新信息。',
      '- 新事实**推翻/纠正**旧事实时用 update（例如路径、状态、结论变了）。',
      '- 旧记忆里**仍然成立**的偏好/事实不要删除；偏好类通常是叠加而非替换。',
      '- 若同时与多条相关，只在**关系最直接的那一条**上操作，不要跨条目拼接不同主题的内容。',
      '',
      '## 输出格式',
      '只输出一个 JSON 对象，不要任何解释、不要 Markdown 代码围栏：',
      '{"action":"add|update|skip","memoryId":"……（update/skip 必填）","text":"……（update 必填，改写后的完整正文）","supersedesMemoryId":"……（add 且替代了某条旧记忆时必填，否则省略）","reason":"一句话说明"}'
    ].join('\n'),
    data: [
      '## 待写入的新记忆',
      body,
      '',
      '## 库中相似旧记忆（同一记忆项目）',
      list
    ].join('\n')
  };
}

/* 解析裁决结果：只接受规范 JSON；update 缺 text 或缺 memoryId 时降级为 add（宁多勿错）。 */
function parseMemoryConflictDecision(output, candidates) {
  const raw = stripCodeFence(String(output ?? '').trim());
  const parsed = parseJsonObject(raw);
  if (parsed === undefined) return { action: 'add' };
  const action = typeof parsed.action === 'string' ? parsed.action.trim().toLowerCase() : '';
  const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : '';
  const known = new Set(candidates.map((item) => String(item.id)));
  if (action === 'skip') {
    const memoryId = normalizePlainText(parsed.memoryId, 128);
    return known.has(memoryId) ? { action: 'skip', memoryId, reason } : { action: 'add' };
  }
  if (action === 'update') {
    const memoryId = normalizePlainText(parsed.memoryId, 128);
    const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
    /* 只认候选里出现过的 id，避免模型编造 id 去改无关记忆；正文过短也视为不可用。 */
    if (known.has(memoryId) && text.length >= 6) return { action: 'update', memoryId, text, reason };
    return { action: 'add' };
  }
  /* add + supersedesMemoryId：新增的同时标记「被替代的旧记忆」。
     同样只认候选里出现过的 id——编造的 id 会让无关记忆被误标失效。 */
  const supersedesMemoryId = normalizePlainText(parsed.supersedesMemoryId, 128);
  if (supersedesMemoryId && known.has(supersedesMemoryId)) {
    return { action: 'add', supersedesMemoryId, reason };
  }
  return { action: 'add' };
}
function normalizeRevisionSource(value) {
  return ['tool', 'ui', 'restore', 'distill'].includes(value) ? value : 'manual';
}
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
  '接口摘要',
  '接口约束',
  '排查记录',
  '决策记录'
]);
const CODE_TAGS = new Set(['工作项目', '项目场景', '项目架构', '项目约束', '模块路径', '模块约束', '项目摘要', '模块摘要', '接口摘要', '接口约束', '排查记录', '决策记录']);

/* ── 记忆格式（memory_formats）──
   格式 = 告诉模型「这次该产出哪些字段」的写入模板，而非必须匹配的类型契约。
   因此：不按 definition 做字段白名单校验（那会与「其余字段可自定义新增」冲突）。
   v12 起记忆有单独的 format_id 归属列（见 memories 表），故「这条记忆属于哪套格式」
   是显式落库的事实，不再靠字段名反推。
   必需字段（required）完全由各格式自己声明 —— 没有任何通用必需字段：
   「对象」「内容」只是内置代码类恰好使用的字段名，不是所有格式的义务。
   必需性由 missingFormatRequiredFields（宿主）与 memoryEditorJsonValid 的 format 参数（客户端）强制。 */
const MEMORY_FORMAT_FIELD_TYPES = new Set(['string', 'string[]']);
const MAX_FORMAT_NAME_LENGTH = 40;
const MAX_FORMAT_FIELDS = 24;
/* 内置格式 id：存量记忆与现有四字段契约都归它。 */
const MEMORY_FORMAT_CODE_ID = 'fmt-code';
const MEMORY_FORMAT_CODE_NAME = '代码类';
/* 内置「代码类」停用后，用它去筛选【启用中的自定义格式名】（v12.25，用户要求：
   「如果代码类自动判定为代码类了，但是『代码类』却停用了，这个时候应该用『代码』
   这词去筛选记忆格式」）。语义：用户停用内置代码类、自建了一套自己的代码格式
   （常命名为「代码」「代码规范」等）时，代码类语义的正文应交给那套自建格式。
   ⚠️ 只在内置代码类【停用】时启用；启用时直接归内置代码类，不做这层筛选
   （用户的明确前提：「如果不停用，那么就直接使用『代码类』格式」）。 */
const MEMORY_CODE_FORMAT_HINT_TERM = '代码';
const MEMORY_PRESET_FORMATS = Object.freeze([
  Object.freeze({
    id: MEMORY_FORMAT_CODE_ID,
    name: MEMORY_FORMAT_CODE_NAME,
    definition: Object.freeze({
      fields: Object.freeze([
        Object.freeze({ key: '位置', type: 'string[]', required: true, desc: '文件或项目路径' }),
        Object.freeze({ key: '对象', type: 'string[]', required: true, desc: '函数/组件/类名/接口名/API action/CSS class/事件/slot/hook' }),
        Object.freeze({ key: '内容', type: 'string', required: true, desc: '做了什么/约束/摘要/偏好' }),
        Object.freeze({ key: '踩坑', type: 'string', required: false, desc: '实际踩过的坑；没有则为空字符串' })
      ]),
      order: Object.freeze(['位置', '对象', '内容', '踩坑']),
      indent: 2
    })
  })
]);
const RECALL_PROFILES = Object.freeze({
  general: ['工作项目', '项目画像', '用户画像', '用户偏好', '项目场景', '项目约束', '项目架构', '模块路径', '模块约束', '项目摘要', '模块摘要', '接口摘要', '接口约束', '排查记录', '决策记录', '日常生活'],
  code: ['工作项目', '项目画像', '项目场景', '项目约束', '项目架构', '模块路径', '模块约束', '项目摘要', '模块摘要', '接口摘要', '接口约束', '决策记录'],
  scene: ['工作项目', '项目画像', '用户画像', '用户偏好', '项目场景', '项目约束', '项目架构', '模块路径', '模块约束', '项目摘要', '模块摘要', '接口摘要', '接口约束', '排查记录', '决策记录', '日常生活'],
  /* 约束档聚焦“必须遵守什么”：新增接口约束（接口层面的硬性限制）。 */
  constraint: ['项目约束', '模块约束', '接口约束', '用户画像', '项目画像', '用户偏好', '项目场景'],
  profile: ['用户画像', '用户偏好', '日常生活', '项目约束'],
  summary: ['项目摘要', '模块摘要', '项目场景', '项目架构', '接口摘要', '接口约束', '决策记录', '项目约束']
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

/* ── 记忆更新日志的差异记录 ──
   规则（用户明确要求）：只有「正文真的变了」才把 summary 写成结构化 JSON，供客户端渲染红绿差异；
   只改状态/固定/标签/项目时，summary 保持纯文本（改后正文），仅在末尾追加一行变化说明。
   客户端按标记字段判别：解析失败、缺标记、或旧记录（纯文本）一律按纯文本渲染，天然兼容。 */
const MEMORY_UPDATE_DIFF_FLAG = '__dshSessionKitDiff';

/* 活动日志用的记忆快照：只取与差异有关的字段。 */
function memoryActivitySnapshot(memory) {
  if (memory === undefined || memory === null) return null;
  return {
    text: String(memory.text ?? ''),
    status: normalizeStatus(memory.status),
    pinned: memory.pinned === true,
    tagNames: Array.isArray(memory.tags) ? memory.tags.map((tag) => String(tag)) : [],
    directoryName: String(memory.directoryName ?? ''),
    /* 事实时间纳入快照：自动截断（替代判定）与人工改期都要在日志里留痕。 */
    eventTime: Number(memory.eventTime) > 0 ? Number(memory.eventTime) : 0,
    validUntil: Number(memory.validUntil) > 0 ? Number(memory.validUntil) : 0
  };
}

/* 元数据变化清单（不含正文）：状态 / 固定召回 / 记忆项目 / 标签 / 事实时间。 */
function memoryMetadataChanges(before, after) {
  const changes = [];
  if (before === null || after === null) return changes;
  if (before.status !== after.status) changes.push({ key: 'status', before: before.status, after: after.status });
  if (before.pinned !== after.pinned) changes.push({ key: 'pinned', before: before.pinned, after: after.pinned });
  if (before.directoryName !== after.directoryName) changes.push({ key: 'directory', before: before.directoryName, after: after.directoryName });
  if (Number(before.eventTime) !== Number(after.eventTime)) changes.push({ key: 'eventTime', before: before.eventTime, after: after.eventTime });
  if (Number(before.validUntil) !== Number(after.validUntil)) changes.push({ key: 'validUntil', before: before.validUntil, after: after.validUntil });
  const beforeTags = new Set(before.tagNames);
  const afterTags = new Set(after.tagNames);
  const added = after.tagNames.filter((tag) => !beforeTags.has(tag));
  const removed = before.tagNames.filter((tag) => !afterTags.has(tag));
  if (added.length > 0 || removed.length > 0) changes.push({ key: 'tags', added, removed });
  return changes;
}

/* 变化行的短描述（纯文本分支追加用）。宿主端活动日志 summary 一贯直接写中文
   （如目录更新里的「（备注已更新）」），此处保持一致；状态也转成中文而非直出枚举值。 */
function memoryStatusChangeText(value) {
  return value === 'active' ? '激活' : '停用';
}

function memoryChangeLines(changes) {
  const lines = [];
  for (const change of changes) {
    if (change.key === 'status') lines.push(`状态：${memoryStatusChangeText(change.before)} → ${memoryStatusChangeText(change.after)}`);
    else if (change.key === 'pinned') lines.push(`固定召回：${change.before ? '开' : '关'} → ${change.after ? '开' : '关'}`);
    else if (change.key === 'directory') lines.push(`记忆项目：${change.before || '无'} → ${change.after || '无'}`);
    else if (change.key === 'eventTime') lines.push(`事件时间：${formatFactTime(change.before) || '无'} → ${formatFactTime(change.after) || '无'}`);
    else if (change.key === 'validUntil') lines.push(`有效至：${formatFactTime(change.before) || '无'} → ${formatFactTime(change.after) || '无'}`);
    else if (change.key === 'tags') {
      const parts = [];
      if (change.added.length > 0) parts.push(`+${change.added.join('、')}`);
      if (change.removed.length > 0) parts.push(`-${change.removed.join('、')}`);
      if (parts.length > 0) lines.push(`标签：${parts.join(' ')}`);
    }
  }
  return lines;
}

/* memory_update 的 summary 生成：
   正文变了 → JSON（before/after 正文 + 元数据变化清单）；
   正文没变 → 改后正文纯文本，若有元数据变化则追加一行说明。 */
function memoryUpdateActivitySummary(before, after, bodyChanged) {
  const afterText = String(after?.text ?? before?.text ?? '');
  const changes = memoryMetadataChanges(before, after);
  if (bodyChanged) {
    return JSON.stringify({
      [MEMORY_UPDATE_DIFF_FLAG]: 1,
      before: { text: String(before?.text ?? '') },
      after: { text: afterText },
      fields: changes
    });
  }
  const base = activitySummaryText(afterText);
  const lines = memoryChangeLines(changes);
  return lines.length === 0 ? base : `${base}\n\n${lines.join('\n')}`;
}

function normalizeDirectoryName(value) {
  const name = normalizePlainText(value, MAX_DIRECTORY_NAME_LENGTH).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ');
  if (name.length === 0) throw new MemoryError('invalid-directory-name', 'directory name must not be empty');
  return name;
}

/* 显式记忆请求的落点：用户没有指定记忆项目时固定写进 default，不跟随内容猜测目录，
   否则「帮我记住我叫喵喵」这类个人信息会被目录名打分算法甩进某个项目目录。
   与 PROTECTED_MEMORY_DIRECTORY_NAMES 同字面量、含义不同，故意分开命名。 */
const EXPLICIT_MEMORY_REQUEST_DIRECTORY = 'default';
/* 显式请求的标签兜底：仅当模型没给标签时生效（避免 memory_add 无标签时按正文瞎猜）。 */
const EXPLICIT_MEMORY_REQUEST_TAGS = ['用户偏好'];

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

/* ── 关系边：键规范化与权重 ──
   路径统一分隔符与大小写（Windows 路径大小写不敏感）；符号与标签统一小写。
   注意：此处【不做】反斜杠转义折叠（那是 repairMemoryPathEscapes 的职责），
   只统一分隔符，保证与库中存储值一致。 */
function normalizeEdgeKey(value) {
  return normalizePlainText(value, 512).replace(/\\/g, '/').toLowerCase();
}

/* 显示用的短键：绝对路径只保留末尾两段（…/lib/memory.js），
   避免在渲染里出现一长串前缀把真正的区分信息挤掉。
   非路径（符号/标签）原样返回，超长再从头部截断。 */
function shortEdgeKey(key, maxLength = 48) {
  const text = normalizePlainText(key, 512);
  if (text.length === 0) return '';
  const segments = text.split('/').filter(Boolean);
  const tail = segments.length >= 2 ? segments.slice(-2).join('/') : text;
  if (tail.length <= maxLength) return tail;
  return `…${tail.slice(-(maxLength - 1))}`;
}

/* 边的权重：文件/符号共享是强证据（1.0），标签共享是弱证据（0.5）。 */
function edgeWeightOf(kind) {
  return kind === 'same_tag' ? 0.5 : 1.0;
}

/* ══════════════════════════════════════════════════════════════════
   Embedder 抽象层：网络 API 与本地模型共用一条上层路径，只换 driver。
   这是 routeForDistill 模式在向量上的复用 —— 上层（回填/召回/降级）不关心底层是谁。

   两者对【召回质量】无差别（同模型同维度 → 同向量），差异全在工程侧：
     延迟（100~300ms vs 10~50ms）、稳定性（会失败 vs 基本不失败）、
     成本（计费 vs 免费）、批量能力、依赖（key+网络 vs 装模型）。
   ══════════════════════════════════════════════════════════════════ */

/* 把 baseUrl 规范成完整的 /embeddings 端点。
   兼容 "https://host/v1" 与已是完整 /embeddings 路径两种写法。 */
function embeddingEndpoint(baseUrl) {
  const base = normalizePlainText(baseUrl, 500).replace(/\/+$/u, '');
  if (!base) return '';
  return /\/embeddings$/iu.test(base) ? base : `${base}/embeddings`;
}

/* 模型标识归一化，让 HF 仓库 ID 的两种写法等价。
   背景：transformers.js 只用 REPO_ID_REGEX（只认正斜杠）判断"这是不是仓库 ID"：
      - 正斜杠 `Xenova/xxx`  → validModelId=true  → 走 remoteURL（缓存缺失时可自动下载）
      - 反斜杠 `Xenova\xxx`  → validModelId=false → 被当【相对路径】去 cwd 找，
        本机之所以仍能用，只是因为 FileCache.match 里 path.join 会把分隔符归一化、
        恰好命中已有缓存；一旦缓存缺失就会报 Local file missing。
   故这里把"仅两级且用反斜杠分隔"的写法统一转成正斜杠，让两种写法走同一条路径，
   同时让二者【指纹一致】——否则切换写法会让全部向量失效并触发全量重算。
   ⚠️ 绝对路径（盘符开头/UNC/以分隔符开头）必须原样保留，不能转。 */
function normalizeEmbeddingModelId(raw) {
  const text = normalizePlainText(raw, 300);
  if (!text) return '';
  /* 绝对路径形态：原样返回，交给 transformers 当路径处理 */
  if (/^[a-zA-Z]:[\\/]/u.test(text) || text.startsWith('\\\\') || text.startsWith('/')) return text;
  /* 仅两级、含反斜杠 → 视为仓库 ID 的另一种写法 */
  const segments = text.split(/[\\/]+/u).filter(Boolean);
  if (segments.length === 2 && text.includes('\\')) return segments.join('/');
  return text;
}

/* 池化方式判定。⚠️ 只看【模型名】这一段，不看整个字符串：
   原先用 /bge/iu.test(this.model)，填绝对路径时若路径中含连续 "bge" 三字母
   （如 D:\my-bge-models\jina-embeddings-v2-base-zh）会被误判成 BGE 而用 CLS 池化，
   而 jina 该用 mean —— 结果静默产出错误向量、检索质量下降却不报错。 */
function embeddingPoolingOf(modelId) {
  const text = normalizePlainText(modelId, 300);
  /* 取最后一段作为模型名（兼容 repo/org/name 与绝对路径） */
  const name = text.split(/[\\/]+/u).filter(Boolean).pop() ?? '';
  return /bge/iu.test(name) ? 'cls' : 'mean';
}

/* ── API Key 掩码契约（生成与识别必须成对，抽到一处避免再次漂移）──
   ⚠️ 历史事故：生成侧产出 `****1f63`（4 星号 + 末 4 位明文），识别侧却用 /^\*+$/
      要求"纯星号"，两者不匹配 → 掩码被当作真实 key 发出去：
      表现为「粘贴 key 测试通过 → 保存 → 再测试就 401 失败 → 重新粘贴才恢复」；
      更严重的是把掩码原样存回库，真实 key 被永久覆盖。
   识别规则同时接受两种形态：
     - 掩码格式 `****xxxx`（当前生成格式）
     - 纯星号 `****` 及以上（兼容旧前端/旧数据） */
function maskedApiKeyText(key) {
  const text = typeof key === 'string' ? key : '';
  return text.length > 0 ? `****${text.slice(-4)}` : '';
}

function isMaskedApiKey(value) {
  return typeof value === 'string' && /^\*{4}/u.test(value.trim());
}

/* 掩码 → 沿用已保存的 key；否则原样返回（含空串）。
   前端在 apiKey 输入框为空时会回传掩码占位，此处负责还原成真实 key。 */
function resolveApiKeyInput(incomingKey, currentKey) {
  if (isMaskedApiKey(incomingKey) && typeof currentKey === 'string' && currentKey.length > 0) return currentKey;
  return incomingKey;
}

/* 向量浮点数组 ↔ BLOB 互转（Float32，写入与读取必须同一精度）。 */
function vectorToBlob(vector) {
  const arr = Float32Array.from(vector);
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}
function blobToVector(blob) {
  if (blob === null || blob === undefined) return undefined;
  try {
    const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
    const arr = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
    return Array.from(arr);
  } catch {
    return undefined;
  }
}

/* 余弦相似度：两个等长向量。维度不等直接返回 0（换模型的典型症状）。 */
function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let normLeft = 0;
  let normRight = 0;
  for (let i = 0; i < left.length; i += 1) {
    dot += left[i] * right[i];
    normLeft += left[i] * left[i];
    normRight += right[i] * right[i];
  }
  if (normLeft === 0 || normRight === 0) return 0;
  return dot / (Math.sqrt(normLeft) * Math.sqrt(normRight));
}

/* 余弦 0~1 → 0~MEMORY_VECTOR_MAX_WEIGHT。非数值返回 0（缺席分量）。 */
function vectorWeight(score) {
  const value = Number(score);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MEMORY_VECTOR_MAX_WEIGHT, value * MEMORY_VECTOR_MAX_WEIGHT));
}

/* 给一个 Promise 加超时。本地推理走的是 transformers.js pipeline，
   它不接受 AbortSignal，无法真正中断 —— 故只能"超时后放弃等待"：
   后台任务仍会跑完（结果被丢弃），但调用方与 UI 能及时恢复，不会永久挂起。
   ⚠️ 定时器【不能 unref】：unref 后它不再是事件循环的活跃句柄，当被等的
      promise 永不 settle 且没有其它句柄时，进程会直接判定"无事可做"而退出，
      超时回调根本不执行（实测顶层 await 场景下 Node 直接 exit 13）。
      超时定时器必须能独立唤醒事件循环 —— 它本身就是"等不到也要动"的保证。
   ⚠️ 已 settle 时 clearTimeout，不会泄漏定时器。 */
function withTimeout(promise, timeoutMs, message) {
  const limit = Number(timeoutMs);
  if (!Number.isFinite(limit) || limit <= 0) return promise;
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), limit);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

/* embedding 的输入文本：正文 + 标签 + 目录名。
   ⚠️ 必须与 input_hash 的取材一致 —— 任何一项变化都该触发重算，
      只比 content_hash（仅覆盖正文）会漏掉"正文没变但标签变了"。 */
function embeddingInputText(body, tagNames, directoryName) {
  const parts = [String(body ?? '')];
  const tags = Array.isArray(tagNames) ? tagNames.filter(Boolean) : [];
  if (tags.length > 0) parts.push(tags.join(' '));
  const dir = normalizePlainText(directoryName, 200);
  if (dir) parts.push(dir);
  return parts.join('\n');
}

/* 远程 API（OpenAI 兼容 /embeddings）。失败抛错，由上层降级。 */
class RemoteEmbedder {
  constructor(provider) {
    this.provider = provider ?? {};
    this.endpoint = embeddingEndpoint(this.provider.baseUrl);
    /* 与 LocalEmbedder 用同一套归一化，保证同一模型在两种 provider 下指纹一致
       （远端模型名通常无分隔符，此调用对它是恒等变换）。 */
    this.model = normalizeEmbeddingModelId(this.provider.model) || normalizePlainText(this.provider.model, 200);
    this.apiKey = String(this.provider.apiKey ?? '');
    this.dimensions = Number.isSafeInteger(Number(this.provider.dimensions)) && Number(this.provider.dimensions) > 0
      ? Number(this.provider.dimensions) : 0;
    /* 配置维度另存一份供 init() 对账：init 会用实测长度覆盖 this.dimensions，
       不留底就无法发现"配置 2048 / 实际 1536"这类错位（与 LocalEmbedder 对称）。 */
    this.declaredDimensions = this.dimensions;
    this.timeoutMs = Number.isSafeInteger(Number(this.provider.timeoutMs)) && Number(this.provider.timeoutMs) > 0
      ? Number(this.provider.timeoutMs) : MEMORY_EMBEDDING_TIMEOUT_REMOTE;
  }

  async init() {
    if (!this.endpoint || !this.model) throw new Error('embedding endpoint or model is missing');
    const [probe] = await this.embedBatch(['ping']);
    if (!Array.isArray(probe) || probe.length === 0) throw new Error('embedding probe returned an empty vector');
    /* 维度对账：很多服务商【忽略】dimensions 参数而不报 400（如部分 OpenRouter 免费模型），
       也可能用户把维度填错。若不在此处比对，写入侧指纹（model#实测）与查询侧
       （MemoryStore.embeddingFingerprint 用 model#配置）会错位 → 统计恒显示 0/N、
       每次启动都白跑一轮回填，全程无任何报错。与 LocalEmbedder 的同名校验对称。 */
    if (this.declaredDimensions > 0 && this.declaredDimensions !== probe.length) {
      throw new Error(`remote embedding dimension mismatch: configured ${this.declaredDimensions} but provider returns ${probe.length}`);
    }
    this.dimensions = probe.length;
    return this;
  }

  async embedBatch(texts) {
    const list = Array.isArray(texts) ? texts.filter((t) => typeof t === 'string') : [];
    if (list.length === 0) return [];
    const headers = { 'content-type': 'application/json' };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const body = { model: this.model, input: list };
    if (this.dimensions > 0) body.dimensions = this.dimensions;
    let lastError;
    for (let attempt = 0; attempt <= MEMORY_EMBEDDING_MAX_RETRY; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error('embedding request timeout')), this.timeoutMs);
      if (typeof timer?.unref === 'function') timer.unref();
      try {
        const response = await fetch(this.endpoint, {
          method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal
        });
        /* 先取文本再自行解析：部分服务商（实测 openrouter.ai 错误路径）对未知端点
           返回 200 + HTML 落地页，直接 response.json() 只会抛出 "Unexpected token '<'"
           这类解析错误，把"地址配错了"误报成"响应格式异常"，用户拿不到正确排查方向。 */
        const text = await response.text();
        const looksHtml = /^\s*<(?:!doctype|html|\?xml)/iu.test(text);
        if (!response.ok) {
          const error = new Error(`embedding request failed: HTTP ${response.status}${looksHtml ? ' (HTML response)' : ''}`);
          /* 不可重试的 4xx（400/401/403/404…）：重试注定得到同样结果，只会白等退避。
             408/429 是瞬时状态、5xx 是服务端故障，继续重试。 */
          if (response.status < 500 && !MEMORY_EMBEDDING_RETRYABLE_STATUS.has(response.status)) {
            error.noRetry = true;
          }
          throw error;
        }
        if (looksHtml) {
          /* 地址指向网页属配置问题，重试必然拿到同一个 HTML。 */
          const error = new Error(`embedding endpoint returned HTML instead of JSON (HTTP ${response.status})`);
          error.noRetry = true;
          throw error;
        }
        let payload;
        try {
          payload = JSON.parse(text);
        } catch {
          const error = new Error('embedding response is not valid JSON');
          error.noRetry = true;
          throw error;
        }
        const rows = Array.isArray(payload?.data) ? payload.data : [];
        /* 按 index 排序（OpenAI 协议不保证顺序）。 */
        const sorted = rows.slice().sort((a, b) => (Number(a?.index) || 0) - (Number(b?.index) || 0));
        const vectors = sorted.map((row) => (Array.isArray(row?.embedding) ? row.embedding : []));
        if (vectors.length !== list.length) throw new Error('embedding response size mismatch');
        return vectors;
      } catch (error) {
        lastError = error;
        /* noRetry：配置类错误（鉴权/路径/参数），重试只是让用户多等退避。 */
        if (error?.noRetry === true) break;
        if (attempt < MEMORY_EMBEDDING_MAX_RETRY) {
          await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));   // 退避
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError ?? new Error('embedding request failed');
  }

  fingerprint() {
    return `${this.model}#${this.dimensions}`;
  }

  dispose() { /* 无外部资源 */ }
}

/* 本地模型。依赖 @huggingface/transformers（或等价实现），未安装时 init 抛错 → 上层降级。
   本机实测：desktop profile 未安装任何 ML 依赖、无 Ollama，故当前只支持远程 API。 */
class LocalEmbedder {
  constructor(provider) {
    this.provider = provider ?? {};
    /* 归一化模型标识：让 `Xenova\xxx` 与 `Xenova/xxx` 等价（详见函数注释）；
       绝对路径原样保留。 */
    this.model = normalizeEmbeddingModelId(this.provider.model);
    this.device = this.provider.device === 'gpu' ? 'gpu' : 'cpu';
    this.timeoutMs = Number.isSafeInteger(Number(this.provider.timeoutMs)) && Number(this.provider.timeoutMs) > 0
      ? Number(this.provider.timeoutMs) : MEMORY_EMBEDDING_TIMEOUT_LOCAL;
    /* 模型加载单独用更宽的上限：首次要从 HF 下载权重，5 秒必然误判失败。
       loadTimeoutMs 未单独配置时退回更大的保底值。 */
    const configuredLoad = Number(this.provider.loadTimeoutMs);
    this.loadTimeoutMs = Number.isSafeInteger(configuredLoad) && configuredLoad > 0
      ? configuredLoad
      : Math.max(MEMORY_EMBEDDING_TIMEOUT_LOCAL_LOAD, this.timeoutMs * 12);
    /* 用户手填的维度：本地推理【不消费】该值，但要用它校验实测结果。
       填错会导致配置侧指纹（model#填错值）与写入侧（model#实测值）不一致，
       界面统计恒显示 0/N —— 且不像远程会收到 HTTP 400，本地是静默的。 */
    this.declaredDimensions = Number.isSafeInteger(Number(this.provider.dimensions)) && Number(this.provider.dimensions) > 0
      ? Number(this.provider.dimensions) : 0;
    this.pipeline = null;
    this.dimensions = 0;
  }

  async init() {
    if (!this.model) throw new Error('embedding local model is missing');
    let transformers;
    try {
      transformers = require('@huggingface/transformers');
    } catch (error) {
      throw new Error(`local embedding requires @huggingface/transformers: ${error?.message ?? error}`);
    }
    /* BGE 系列需 CLS 池化（transformers.js 默认 mean 会静默产出偏差向量）。
       ⚠️ 判定只看模型名那一段（embeddingPoolingOf），不拿整个字符串做正则 ——
          填绝对路径时目录里含 "bge" 字样会被误判成 CLS，静默产出错误向量。
       ⚠️ pooling 必须同时传给【调用】，不能只在构建时给 —— 见 embedBatch 的注释。 */
    this.pooling = embeddingPoolingOf(this.model);
    /* ⚠️ pipeline() 内部可能长时间阻塞（下载权重 / 初始化 onnxruntime），
       必须加超时，否则整个请求会永久挂起、UI 停在「测试中…」。 */
    this.pipeline = await withTimeout(
      transformers.pipeline('feature-extraction', this.model, {
        device: this.device,
        pooling: this.pooling,
        normalize: true
      }),
      this.loadTimeoutMs,
      `local embedding model load timed out after ${Math.round(this.loadTimeoutMs / 1000)}s`
    );
    const [probe] = await this.embedBatch(['ping']);
    if (!Array.isArray(probe) || probe.length === 0) throw new Error('local embedding probe returned an empty vector');
    this.dimensions = probe.length;
    /* 维度校验：填错时立刻报错，而不是让指纹悄悄错位（本地没有服务端 400 兜底）。 */
    if (this.declaredDimensions > 0 && this.declaredDimensions !== this.dimensions) {
      throw new Error(`local embedding dimension mismatch: configured ${this.declaredDimensions} but model returns ${this.dimensions}`);
    }
    return this;
  }

  async embedBatch(texts) {
    const list = Array.isArray(texts) ? texts.filter((t) => typeof t === 'string') : [];
    if (list.length === 0) return [];
    if (this.pipeline === null) throw new Error('local embedder is not initialized');
    /* ⚠️ 必须在【每次调用】显式传 pooling，不能传 undefined：
       transformers.js 的 feature-extraction._call 里 pooling 的默认值是 'none'
       （解构默认只在 undefined 时生效，构建 pipeline 时给的 pooling 只是内部默认），
       一旦落到 'none'，输出会是三维 [batch, seq, hidden] 而非二维 [batch, hidden]，
       下面的切片就会按错误维度切出"假向量"（实测 bge-small-zh 得到 8 元素而非 512）。
       推理同样要限时：卡死的推理会让回填批次与连通测试一起挂住。 */
    const output = await withTimeout(
      this.pipeline(list, { pooling: this.pooling, normalize: true }),
      this.timeoutMs,
      `local embedding inference timed out after ${Math.round(this.timeoutMs / 1000)}s`
    );
    const vectors = this.vectorsFromOutput(output);
    if (vectors.length !== list.length) {
      throw new Error(`local embedding output shape mismatch: expected ${list.length} vectors, got ${vectors.length} (dims ${JSON.stringify(output?.dims ?? null)})`);
    }
    return vectors;
  }

  /* 把 pipeline 输出摊平成「每条一个向量」。
     兼容两种形状：[batch, hidden]（已池化）与 [batch, seq, hidden]（未池化）。
     后者只在 pooling 意外落到 'none' 时出现 —— 此时按最后一个维度取 hidden 维并做
     平均池化兜底，宁可多算一步也不要写出维度错误的假向量。 */
  vectorsFromOutput(output) {
    const dims = Array.isArray(output?.dims) ? output.dims : [];
    const data = output?.data ?? [];
    if (dims.length === 2) {
      const [rows, dim] = dims;
      const out = [];
      for (let i = 0; i < rows; i += 1) out.push(Array.from(data.slice(i * dim, (i + 1) * dim)));
      return out;
    }
    if (dims.length === 3) {
      const [rows, seq, dim] = dims;
      const out = [];
      for (let r = 0; r < rows; r += 1) {
        const base = r * seq * dim;
        const pooled = new Array(dim).fill(0);
        for (let s = 0; s < seq; s += 1) {
          const off = base + s * dim;
          for (let d = 0; d < dim; d += 1) pooled[d] += Number(data[off + d]) || 0;
        }
        for (let d = 0; d < dim; d += 1) pooled[d] /= seq;
        const norm = Math.sqrt(pooled.reduce((acc, x) => acc + x * x, 0));
        out.push(norm > 0 ? pooled.map((x) => x / norm) : pooled);
      }
      return out;
    }
    return [];
  }

  fingerprint() {
    return `${this.model}#${this.dimensions}`;
  }

  dispose() {
    /* 本地模型占数百 MB 内存，卸载时必须释放。 */
    try { this.pipeline?.dispose?.(); } catch { /* 忽略释放失败 */ }
    this.pipeline = null;
  }
}

/* 按 kind 创建 Embedder；未知/缺配置返回 undefined（上层按"未启用"处理）。 */
function createEmbedder(provider) {
  if (provider === null || typeof provider !== 'object') return undefined;
  if (provider.kind === 'remote') return new RemoteEmbedder(provider);
  if (provider.kind === 'local') return new LocalEmbedder(provider);
  return undefined;
}

/* 关系类型的归一化：非法值过滤后回落默认集（默认不含 same_tag）。 */
function normalizeEdgeKinds(value) {
  const list = Array.isArray(value) ? value : [];
  const filtered = list.filter((kind) => MEMORY_EDGE_ALL_KINDS.includes(kind));
  return filtered.length > 0 ? [...new Set(filtered)] : [...MEMORY_EDGE_DEFAULT_KINDS];
}

/* 跳数：1~MEMORY_RELATE_MAX_HOPS，非法值回落 1。 */
function clampRelateHops(value) {
  const number = Math.floor(Number(value));
  if (!Number.isSafeInteger(number) || number < 1) return 1;
  return Math.min(MEMORY_RELATE_MAX_HOPS, number);
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

/* ── 用户显式「记住」请求的识别与提示 ──
   只取用户消息的 text 分片：textBlocks 会把 tool-call 参数一并拼进来，
   重新读取历史消息时那些参数会污染提示正文与召回查询词。 */
function humanTextOfMessage(message) {
  if (!isHumanSource(message?.source)) return '';
  if (!Array.isArray(message.content)) return '';
  return message.content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

/* 一个句子是否是显式记忆请求。返回 { body } 或 { bare: true }，否则 undefined。
   bare 表示「是记忆请求，但没带对象」（记住：/帮我记一下/记住了）——
   这种情况要触发提示、但不该写记忆，由调用方区分处理。 */
function classifyMemoryRequestSentence(sentence) {
  const raw = normalizePlainText(sentence, MEMORY_REQUEST_MAX_LENGTH).replace(/\s+/g, ' ');
  if (raw.length < 2 || raw.length > MEMORY_REQUEST_MAX_LENGTH) return undefined;
  if (MEMORY_REQUEST_NEGATION.test(raw)) return undefined;
  if (MEMORY_REQUEST_GUARD.test(raw)) return undefined;
  /* 光杆优先：只有前缀（+可选符号）没有对象。必须先判它，否则动词回溯出的
     「帮我」「一下」这类碎片会被当成对象，写出垃圾记忆。 */
  if (MEMORY_REQUEST_BARE.test(raw)) {
    /* 带明确收尾语的光杆（「记住了先这样」「记下了吧」）不是请求，是应答。 */
    return MEMORY_REQUEST_STOPWORDS.test(raw) ? undefined : { bare: true };
  }
  for (const pattern of MEMORY_REQUEST_PATTERNS) {
    const matched = raw.match(pattern);
    if (matched === null) continue;
    const body = normalizePlainText(matched.groups?.body ?? matched.groups?.lead ?? '', MEMORY_REQUEST_MAX_LENGTH);
    if (body.length < 2) continue;
    /* 正文只是外壳/后缀/语气词的碎片组合 → 不是真内容。 */
    if (MEMORY_REQUEST_FRAGMENT_ONLY.test(body)) continue;
    return { body };
  }
  return undefined;
}

/* 兼容旧的「只要正文」调用点（写入侧判定用）。 */
function explicitMemoryRequestBody(sentence) {
  const result = classifyMemoryRequestSentence(sentence);
  return result === undefined ? undefined : result.body;
}

/* 用户消息 → 显式记忆请求。返回 { text, bodies, bare } 或 undefined。
   bodies 为空而 bare=true 表示「用户要求记住但没说记什么」。
   按行与句末标点切分而非整条匹配：用户常一条消息里既下达请求又附带上下文。 */
function explicitMemoryRequest(text) {
  const raw = normalizePlainText(text, MEMORY_REQUEST_MAX_LENGTH);
  if (raw.length === 0) return undefined;
  const bodies = [];
  let bare = false;
  const lines = raw.split(/[\n\r]+/u).map((line) => line.trim()).filter(Boolean);
  /* 跨行合并只处理一种写法：首行是「光杆请求」，下一行才是内容
     （「帮我记一下：\n我喜欢猫」）。整条消息无脑合并会把两个独立请求粘成一条
     （「记住A\n帮我记住B」→ body「A 帮我记住B」），故逐行先判、仅相邻两行做合并。 */
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const own = classifyMemoryRequestSentence(line);
    if (own !== undefined && own.body !== undefined) { bodies.push(own.body); continue; }
    if (own !== undefined && own.bare === true && index + 1 < lines.length) {
      const merged = classifyMemoryRequestSentence(`${line} ${lines[index + 1]}`);
      if (merged !== undefined && merged.body !== undefined) { bodies.push(merged.body); index++; continue; }
      bare = true;
      continue;
    }
    if (own !== undefined && own.bare === true) { bare = true; continue; }
    /* 逐句兜底：同一行里用句号/分号分隔的多个请求。 */
    for (const sentence of line.split(/[。！？!?；;]+/u)) {
      const result = classifyMemoryRequestSentence(sentence);
      if (result === undefined) continue;
      if (result.body !== undefined) bodies.push(result.body);
      else if (result.bare === true) bare = true;
    }
  }
  if (bodies.length === 0 && !bare) return undefined;
  return { text: raw, bodies: uniqueStrings(bodies, 4), bare };
}

/* 提示文案分两种：有对象 → 指示写入；无对象 → 指示追问，禁止凭空造记忆。
   格式说明由激活的格式动态生成（formats 由调用方 store.activeFormats() 传入）。
   v12：清单按用户原话（bodies）筛选后再注入 —— 手上已有待写入的正文，筛得很准。
   ⚠️ v12.19 去掉 `formats 为空 → 回落 MEMORY_PRESET_FORMATS` 的兜底：调用方给的
   已是【启用中】的格式清单，为空意味着用户把所有格式都停用了 —— 此时回落到内置
   常量会强行把「代码类」注入提示词，用户停用它的意图被无声推翻（实测踩坑）。 */
function explicitMemoryRequestHintText(bodies, formats) {
  const activeList = Array.isArray(formats) ? formats : [];
  const hasBodies = Array.isArray(bodies) && bodies.length > 0;
  /* 筛空时【不回退全量】（用户此前明确要求）：按用户原话没筛中任何格式时，
     宁可不注入清单、让模型写纯文本结论，也不塞一堆可能与本次无关的格式。
     ⚠️ 但【只有一套启用格式时不做筛选】（v12.24，与蒸馏/工具描述同口径）：
     那不算「回退全量」—— 全量就是这一套，无可选择时它就是本轮该用的格式。
     否则用户停用内置代码类、只留一套自建格式时，用户原话没提到该格式名就会
     注入空清单，模型拿不到任何字段定义。 */
  const injectFormats = !hasBodies || activeList.length === 1
    ? activeList
    : selectFormatsForText(activeList, bodies.join('\n'));
  const formatLines = buildFormatPromptLines(injectFormats);
  const requirements = [
    '要求：正文写成结论性陈述（不要复述「用户要求记住」这类过程语气）；',
    ...formatLines.map((line) => `${line}`),
    '**用户身份/偏好/习惯/生活类内容**：若没有贴合的格式，直接写纯文本结论，不要硬套 JSON。',
    'tags 必须填写，先归纳最多 1 个精准描述性标签（优先具体事件/对象/名称/场景，尽量复用项目内已有标签），再映射到稳定标签（用户偏好/用户画像/项目画像/项目架构/项目约束/模块路径/模块约束/项目场景/接口摘要/接口约束/项目摘要/模块摘要/排查记录/决策记录）；用户明确要求「每次都带上/固定召回」时把 pinned 设为 true；用户指定了记忆项目则传 directoryName，未指定则留空。'
  ].join('\n');
  if (!Array.isArray(bodies) || bodies.length === 0) {
    return [
      `${MEMORY_REQUEST_MARKER} · 用户表达了「记住」的意图，但没有说明要记住什么内容。`,
      '',
      '请用一句话追问用户想让你记住什么，然后按其回答调用 memory_add 写入长期记忆。',
      '禁止凭猜测自行构造记忆内容，也不要在没得到内容前调用 memory_add。'
    ].join('\n');
  }
  return [
    `${MEMORY_REQUEST_MARKER} · 用户显式要求记住以下内容，请在本轮立即调用 memory_add 工具把其中对后续对话长期有用的事实写入长期记忆：`,
    '',
    ...bodies.map((body) => `- ${body}`),
    '',
    requirements
  ].join('\n');
}

/* 判断两条用户消息是否同一条：便于「一条消息只追加一次提示」，同时容忍平台改写的 id 与内容。 */
function isSameUserMessage(left, right) {
  if (left === undefined || right === undefined) return false;
  if (left === right) return true;
  const leftId = normalizePlainText(left.id ?? '', 128);
  const rightId = normalizePlainText(right.id ?? '', 128);
  if (leftId && rightId && leftId === rightId) return true;
  const leftText = humanTextOfMessage(left);
  const rightText = humanTextOfMessage(right);
  return leftText.length > 0 && leftText === rightText;
}

/* 当前会话是否已为这条用户消息追加过提示。
   「本轮」的边界 = 被 claim 的那条用户消息（anchor）：提示就追加在它之后、轮尾位置，
   故只需检查 anchor 之后的消息，遇到下一条用户消息即停止。
   不能一见提示行就判 true——历史轮次的提示行会让之后所有请求永久失效（实测踩过）；
   也不能只依赖内核消息 id，平台重放/改写后 id 未必稳定，故叠加文本比对。 */
function hasPendingMemoryRequest(session, decidedMessages, anchor) {
  const anchorIndex = decidedMessages.findLastIndex((message) => isSameUserMessage(message, anchor));
  if (anchorIndex < 0) return false;
  for (let index = anchorIndex + 1; index < decidedMessages.length; index++) {
    const message = decidedMessages[index];
    if (isHumanMessage(message)) return false;
    if (hasMemorySource(message?.source, MEMORY_REQUEST_SOURCE)) return true;
    if (humanTextOfMessage(message).startsWith(MEMORY_REQUEST_MARKER)) return true;
  }
  return false;
}

/* 决定本次 pre-step 要注入的显式记忆请求：
   claims 是内核本步「新出现」的用户消息，能区分真实新输入与历史消息重放；
   已在轮尾提示过的同一条消息不重复追加。取最后一条命中的请求为准。 */
function pendingExplicitMemoryRequest(store, agent, claimedMessages, decision) {
  const claimed = Array.isArray(claimedMessages) ? claimedMessages.filter(isHumanMessage) : [];
  const last = claimed[claimed.length - 1];
  if (last === undefined) return undefined;
  const anchorIndex = decision.messages.findLastIndex((message) => isSameUserMessage(message, last));
  /* 找不到锚点（内核给定的 messages 与 claims 不同源）时保守放行：宁可多提示一次，也不漏记。 */
  if (anchorIndex >= 0 && hasPendingMemoryRequest(agent?.session, decision.messages, last)) return undefined;
  const text = humanTextOfMessage(last);
  const requested = explicitMemoryRequest(text);
  if (requested === undefined) return undefined;
  return { request: requested, anchor: last, insertAt: anchorIndex >= 0 ? anchorIndex + 1 : decision.messages.length };
}

/* 把所有命中请求的提示作为一条 user/message 追加到被 claim 的用户消息之后（轮尾）。
   返回本次要注入的请求（原话 + 对象），供紧随其后的 injectRecall 复用同一次判定。 */
function appendExplicitMemoryRequest(store, agent, claimedMessages, decision) {
  const requested = pendingExplicitMemoryRequest(store, agent, claimedMessages, decision);
  if (requested === undefined) return undefined;
  const insertAt = requested.insertAt;
  decision.messages = [
    ...decision.messages.slice(0, insertAt),
    createUserMessage({
      content: [{ type: 'text', text: explicitMemoryRequestHintText(requested.request.bodies, store.activeFormats()) }],
      source: { kind: MEMORY_REQUEST_SOURCE, form: 'notice', summary: 'memory request' }
    }),
    ...decision.messages.slice(insertAt)
  ];
  store.ctx.logger?.info?.(`[${PLUGIN_NAME}] explicit memory request detected: bodies=${requested.request.bodies.length} session=${String(agent?.session?.id ?? '')}`);
  return requested.request;
}

function normalizeStatus(value, fallback = 'inactive') {
  if (value === 'active') return 'active';
  if (value === 'inactive' || value === 'paused') return 'inactive';
  return fallback === 'active' ? 'active' : 'inactive';
}

function normalizeHashText(text) {
  return normalizePlainText(text).replace(/\s+/g, ' ').toLocaleLowerCase();
}

/* ── 记忆格式定义的规范化 ──
   规范化目标是「可安全 JSON 化 + 描述清晰」而非严格校验。
   必需字段完全由用户声明，没有任何通用必需集需要在这里补强：
   「对象」「内容」与其它字段一视同仁，用户完全可以只声明额外字段。 */
function normalizeFormatFieldKey(value) {
  return normalizePlainText(value, MAX_TAG_NAME_LENGTH).replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeFormatFields(value) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(value) ? value : []) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const key = normalizeFormatFieldKey(raw.key);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    const type = MEMORY_FORMAT_FIELD_TYPES.has(raw.type) ? raw.type : 'string';    const desc = normalizePlainText(raw.desc, 300);
    const required = raw.required === true;
    const field = { key, type, required };
    if (desc.length > 0) field.desc = desc;
    out.push(field);
    if (out.length >= MAX_FORMAT_FIELDS) break;
  }
  return out;
}

/* 格式定义 → 规范化对象。fields 至少 1 个才有效（空格式没有提示价值）。
   order 只保留在 fields 中出现过的键，并补齐 fields 里未列出的键（顺序稳定）。 */
function normalizeFormatDefinition(value) {
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { parsed = undefined; }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const fields = normalizeFormatFields(parsed.fields);
  if (fields.length === 0) return undefined;
  const keys = fields.map((field) => field.key);
  const declared = Array.isArray(parsed.order) ? parsed.order : [];
  const order = [];
  for (const raw of declared) {
    const key = normalizeFormatFieldKey(raw);
    if (keys.includes(key) && !order.includes(key)) order.push(key);
  }
  for (const key of keys) if (!order.includes(key)) order.push(key);
  const indent = Number.isSafeInteger(parsed.indent) && parsed.indent >= 0 && parsed.indent <= 8 ? parsed.indent : 2;
  /* 仅影响召回注入的展示形态，不改变落库正文、校验或关系索引。 */
  const injectPlainText = parsed.injectPlainText === true;
  return { fields, order, indent, injectPlainText };
}

/* 把格式定义渲染成给模型看的一行字段说明（提示词用）。
   与旧硬编码串同构：{"键":["字符串数组"],"键":"字符串"}，另附字段语义。 */
function describeFormatDefinition(definition) {
  const fields = Array.isArray(definition?.fields) ? definition.fields : [];
  const shape = fields.map((field) => field.type === 'string[]' ? `"${field.key}":["…"]` : `"${field.key}":"…"`).join(',');
  const notes = fields.filter((field) => typeof field.desc === 'string' && field.desc.length > 0)
    .map((field) => `${field.key}=${field.desc}`);
  return notes.length > 0 ? `{${shape}}（${notes.join('；')}）` : `{${shape}}`;
}

/* ── 格式定义在写入路径上的应用 ──
   引入 memories.format_id 之前，格式只用于生成提示词；有了归属列之后，写入侧可以按
   格式定义做必需字段校验与键序落库。三条硬约束（缺一即破坏兼容性）：
     ① 无归属（format_id = ''）与内置代码类完全走旧逻辑，行为零变化；
     ② 校验【只在写入路径】执行，读取/召回/注入一律宽容 —— 用户改了格式定义后，
        历史记忆不能因此变得不可读（这正是「格式是写入模板而非类型契约」的延续）；
     ③ 蒸馏等后台路径校验失败只丢弃 format_id，绝不丢记忆正文。 */

/* 空值判定（required 校验用）：空数组、空白串都视为「未提供」。
   与 structuredBodyWorthJson 的「非空」口径保持一致。 */
function isFormatFieldValueEmpty(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.every((item) => typeof item !== 'string' || item.trim().length === 0);
  return false;
}

/* formatOrder 是否「未声明」：用于把「归属了格式」与「无归属」两条路径分开。
   空数组、undefined、非数组都算未声明 —— 无归属记忆必须走旧的降级判定。 */
function declaredFormatOrderEmpty(order) {
  return !Array.isArray(order) || order.length === 0;
}

/* 按定义顺序重排正文键：order 里声明的键按 order 次序排在前，其余键（格式未声明的
   扩展字段）保持原有相对顺序追加在后。order 为空时原样返回 —— 无归属记忆的键序
   必须与改造前逐字节一致，否则会引发全库正文 hash 变化。 */
function reorderStructuredBodyByFormat(body, order) {
  const keys = Array.isArray(order) ? order.filter((key) => typeof key === 'string' && key.length > 0) : [];
  if (keys.length === 0) return body;
  const out = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(body, key)) out[key] = body[key];
  }
  for (const key of Object.keys(body)) {
    if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = body[key];
  }
  return out;
}

/* 必需字段校验：definition 中 required=true 的字段必须在正文里「非空」。
   只查必需性、不做白名单 —— 格式未声明的扩展字段一律保留（既有约定）。
   返回缺失的字段名数组，由调用方决定是拒绝写入还是丢弃 format_id 降级。 */
function missingFormatRequiredFields(body, definition) {
  const fields = Array.isArray(definition?.fields) ? definition.fields : [];
  const requiredKeys = fields.filter((field) => field.required === true).map((field) => field.key);
  if (requiredKeys.length === 0) return [];
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return requiredKeys;
  return requiredKeys.filter((key) => isFormatFieldValueEmpty(body[key]));
}

/* 从纯文本正文里按格式声明的字段抽取值，组装成该格式的 JSON（v12.6.2）。
   场景：本轮格式已确定（如角色类），模型却把正文写成「名称：X。年龄：…。灵根：…」
   这种字段式纯文本 —— 信息其实都在，只是没套 JSON 外壳。既然格式已知，
   就不该拒绝或退化成无归属，而应【直接按该格式需要的字段填充】。
   抽取规则（确定性、不猜测）：
     · 逐字段找「字段名：值」或「字段名:值」（字段名需在行首或紧跟分隔标点）；
     · 值取到【下一个字段名出现处】或文本结尾；
     · string[] 类型按换行/分号/顿号/竖线拆分（与 memoryConvertValueByType 同口径）。
   返回 { json, filled }：json 为组装出的对象（未抽到的字段不放入），filled 为命中字段数。
   一个字段都没抽到则返回 undefined —— 说明正文与格式无关，交由调用方走原路径。 */
function extractFormatFieldsFromText(text, definition) {
  const fields = Array.isArray(definition?.fields) ? definition.fields : [];
  if (fields.length === 0) return undefined;
  const raw = typeof text === 'string' ? text : String(text ?? '');
  if (raw.trim().length === 0) return undefined;
  const escapeRe = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /* 定位每个字段名首次出现的位置。
     ⚠️ 前置边界允许 0~4 个汉字修饰词：实测模型会写「标志性技能：」「核心技能：」这类
     带修饰的字段名，严格边界（行首/标点/空白）会漏掉它们。但后面必须紧跟冒号 ——
     这是「字段式写法」的强特征，可避免把叙述文本里的同名词误当字段。 */
  const located = [];
  for (const field of fields) {
    const key = String(field?.key ?? '').trim();
    if (key === '') continue;
    const match = new RegExp(`(?:^|[\\n。；;、,，\\s]|[\\u4e00-\\u9fa5]{1,4})${escapeRe(key)}\\s*[：:]`).exec(raw);
    if (match === null) continue;
    located.push({ key, type: field.type === 'string[]' ? 'string[]' : 'string', start: match.index, valueStart: match.index + match[0].length });
  }
  if (located.length === 0) return undefined;
  located.sort((left, right) => left.start - right.start);
  const json = {};
  let filled = 0;
  for (let index = 0; index < located.length; index += 1) {
    const current = located[index];
    const next = located[index + 1];
    let value = raw.slice(current.valueStart, next === undefined ? raw.length : next.start);
    value = value.replace(/^[\s。；;、,，]+/u, '').replace(/[\s。；;、,，]+$/u, '').trim();
    if (value.length === 0) continue;
    if (current.type === 'string[]') {
      /* ⚠️ 保守策略：整段作为【单个元素】，不猜列表边界。
         实测「技能：A（含顿号说明）、B（含顿号说明）」这类自由文本，无论按顿号、
         分号还是换行拆都会切碎描述（「回春粽（粽叶裹伤，一口下去筋续骨合、伤势尽消）」
         被顿号切成两半），语义断裂比形式不漂亮严重得多。
         故只在【换行】这一明确列表写法下才拆（模型要表达列表时用换行最规范）；
         单行内容一律整段保留，用户可事后在编辑弹窗里手动整理。 */
      const items = value.split(/\n+/u).map((item) => item.trim()).filter((item) => item.length > 0);
      json[current.key] = items.length > 0 ? items : [value];
    } else {
      json[current.key] = value;
    }
    filled += 1;
  }
  if (filled === 0) return undefined;
  return { json, filled };
}

/* 未声明字段校验（v12.2，用户要求多余字段也阻止保存）。
   ⚠️⚠️ 入参必须是【原始 JSON 键集合】（rawBodyKeys），不能用 structuredBodyForValidation
   的产物 —— 后者为了 required 校验会把全部已知键的中英文别名补成空值，拿它做多余字段
   检查会把「位置/paths/对象/symbols/内容/content/踩坑/pitfall」一律误判为多余，
   导致任何未声明全部四键的格式写入必然失败（实测踩坑：角色类六键正文被拒，错误信息
   列出那八个别名，模型被误导后放弃 formatId 改用纯文本，记忆最终无归属）。
   英文别名先归一成中文再比对；声明键本身及其别名都算「已声明」。 */
function extraFormatUndeclaredFields(rawBodyKeys, definition) {
  const fields = Array.isArray(definition?.fields) ? definition.fields : [];
  if (fields.length === 0) return [];
  const keys = Array.isArray(rawBodyKeys) ? rawBodyKeys.filter((key) => typeof key === 'string' && key.length > 0) : [];
  if (keys.length === 0) return [];
  /* 声明键 + 其全部别名（正文的键可能是任一别名形态）都算「已声明」。 */
  const declared = new Set();
  for (const field of fields) {
    const key = String(field?.key ?? '').trim();
    if (key === '') continue;
    declared.add(key);
    const aliasEntry = Object.keys(STRUCTURED_MEMORY_FIELD_ALIASES).find(
      (name) => STRUCTURED_MEMORY_FIELD_ALIASES[name].includes(key));
    if (aliasEntry !== undefined) {
      for (const alias of STRUCTURED_MEMORY_FIELD_ALIASES[aliasEntry]) declared.add(alias);
    }
  }
  return keys.filter((key) => !declared.has(key) && !['__proto__', 'constructor', 'prototype'].includes(key));
}

/* 解析结果（paths/symbols/content/pitfall/extra）→ 校验用键对象，供 required 校验。
   ⚠️ 必须把已知四键【全部】列出（即使是空值）：required 校验要看「键存在且非空」；
   同时把英文别名一并列出 —— 格式定义的字段名可能是英文（提示词的英文 key 通路），
   只列中文会让 required 为英文名的格式被误判为字段缺失。 */
function structuredBodyForValidation(structured) {
  if (structured === undefined) return undefined;
  return {
    '位置': structured.paths,
    'paths': structured.paths,
    '对象': structured.symbols,
    'symbols': structured.symbols,
    '内容': structured.content,
    'content': structured.content,
    '踩坑': structured.pitfall,
    'pitfall': structured.pitfall,
    ...(structured.extra ?? {})
  };
}

/* 原始 JSON 对象 → 规范化键集合（英文别名映射回中文规范名），供格式反推使用。
   必须基于【原始键】而非 structuredMemoryFields 的结果：后者会把缺失的已知字段补成
   空值，导致键集合恒含四个已知键，反推必然错判。
   ⚠️ 必须排除「载荷字段」——标签、formatId、summary/text/memory 等不是正文结构字段。
   尤其 formatId：它虽已登记进别名表（好让蒸馏能取到），但格式定义里永远不会声明它，
   若参与反推会让「正文键必须全部被格式声明」的子集判定恒为 false，反推彻底失效。 */
function structuredBodyKeys(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];
  const canonicalByRaw = new Map();
  for (const [field, aliases] of Object.entries(STRUCTURED_MEMORY_FIELD_ALIASES)) {
    if (STRUCTURED_MEMORY_PAYLOAD_FIELDS.has(field)) continue;
    for (const alias of aliases) canonicalByRaw.set(alias, aliases[0]);
  }
  const out = [];
  for (const rawKey of Object.keys(value)) {
    if (STRUCTURED_MEMORY_TAG_KEYS.has(rawKey)) continue;
    if (STRUCTURED_MEMORY_PAYLOAD_ONLY_KEYS.has(rawKey)) continue;
    if (STRUCTURED_MEMORY_PAYLOAD_ALIAS_KEYS.has(rawKey)) continue;
    if (['__proto__', 'constructor', 'prototype'].includes(rawKey)) continue;
    const canonical = canonicalByRaw.get(rawKey) ?? rawKey;
    if (!out.includes(canonical)) out.push(canonical);
  }
  return out;
}

/* 正文键集合反推格式（模型没给格式ID时的兜底）。判定规则（v12.3 两档）：
   ① 严格子集：正文键全部被该格式声明（原规则）→ 直接候选，覆盖率 = 正文键/声明键；
   ② 交集容错：严格档没人命中时，按「交集率 = 交集键数 / 正文键数」再挑一轮 ——
     这是为【格式刚被改版】的场景兜底：模型按旧字段形状输出（如角色类删了 对象/内容
     后模型仍给旧七键），严格子集必然失败，但交集率仍高达 5/7=0.71，理应认出角色类
     （用户语义：明明是角色、也有角色类格式，就不该「匹配不了」）。
     交集率阈值与唯一性要求（最高且明显领先 0.15，平手/接近即歧义不归属）防止误认。
   内置代码类不参与反推（固定归属规则见 resolveFormatIdForWrite）。
   宁可不归属也不错归属：只有核心两键（对象/内容）的正文不会被判成任何自定义格式。 */
const FORMAT_INFER_MIN_COVERAGE = 0.6;
/* 交集容错档的阈值：交集率下限 + 领先次名的最小差值。 */
const FORMAT_INFER_MIN_INTERSECTION = 0.5;
const FORMAT_INFER_LEAD_MARGIN = 0.15;
function inferFormatIdByKeys(bodyKeys, formats) {
  const keys = [...new Set((Array.isArray(bodyKeys) ? bodyKeys : []).map((key) => String(key ?? '')).filter((key) => key.length > 0))];
  if (keys.length === 0) return undefined;
  const strictCandidates = [];
  const fuzzyCandidates = [];
  for (const format of Array.isArray(formats) ? formats : []) {
    if (format?.id === MEMORY_FORMAT_CODE_ID) continue;
    const declared = (format?.definition?.fields ?? []).map((field) => field?.key).filter((key) => typeof key === 'string' && key.length > 0);
    if (declared.length === 0) continue;
    const declaredSet = new Set(declared);
    const intersection = keys.filter((key) => declaredSet.has(key));
    /* 交集为 0 的格式与正文毫无关系，两档都排除。 */
    if (intersection.length === 0) continue;
    if (keys.every((key) => declaredSet.has(key))) {
      const coverage = keys.length / declared.length;
      if (coverage >= FORMAT_INFER_MIN_COVERAGE) strictCandidates.push({ id: format.id, score: coverage, declared: declared.length });
      continue;
    }
    /* 非子集 → 交集容错档。两道门槛：
       ① 交集率 = 交集 / 正文键数 ≥ 0.5（至少一半的键被格式声明）；
       ② 多余率 = 多余键 / 正文键数 < 0.5（多数键是格式认识的才像）——
         防典型生活类形状 {对象,内容} 被某个声明了「内容」的格式拉走
         （正文 2 键交集 1 → 0.5 恰好压线，但多余率也是 0.5，② 把它挡下）。 */
    const intersectionRate = intersection.length / keys.length;
    const extraRate = (keys.length - intersection.length) / keys.length;
    if (intersectionRate >= FORMAT_INFER_MIN_INTERSECTION && extraRate < FORMAT_INFER_MIN_INTERSECTION) {
      fuzzyCandidates.push({ id: format.id, score: intersectionRate, declared: declared.length });
    }
  }
  const pick = (candidates) => {
    if (candidates.length === 0) return undefined;
    candidates.sort((left, right) => right.score - left.score || left.declared - right.declared);
    const [first, second] = candidates;
    if (second !== undefined && second.score === first.score && second.declared === first.declared) return undefined;
    return first.id;
  };
  /* 严格档优先；没人命中才用交集容错档（且要求唯一最高 + 明显领先，防误认）。 */
  const strict = pick(strictCandidates);
  if (strict !== undefined) return strict;
  if (fuzzyCandidates.length === 0) return undefined;
  fuzzyCandidates.sort((left, right) => right.score - left.score || left.declared - right.declared);
  const [top, runnerUp] = fuzzyCandidates;
  if (runnerUp !== undefined && top.score - runnerUp.score < FORMAT_INFER_LEAD_MARGIN) return undefined;
  return top.id;
}

/* ── 格式清单筛选（注入前的按需收缩）──
   为什么需要：清单是随激活格式数量线性增长的，几十条格式会把提示词与工具 schema
   撑大，并让模型的选择难度与 UUID 抄错率上升。程序在拼提示词之前已持有全部格式
   （listFormats 一次全表查询），故此处直接按本轮文本筛选，无需新增工具、无需额外
   LLM 往返 —— 这是相对「让模型调用工具查格式」方案的关键优势：
   蒸馏是旁路单轮补全（ctx.llm.stream 不带 tools），物理上无法调用任何工具。

   匹配依据【只取格式名称】：用户说「新建一个角色」就该筛出「角色类」。
   ⚠️ 为什么不匹配字段名/字段说明（实测踩坑）：这两层会被通用词击穿 ——
   「内容」「对象」是代码类与角色类【共有】的字段名，任何含这两个词的普通句子
   （如「今天把内容整理了一下」「他对象是医生」）都会让全部含该字段的格式命中，
   筛选等于形同虚设（实测：仅名称命中 0 条，含字段名命中 2 条）。
   名称是用户自己起的、行为完全可预期；字段说明属元数据，用户不会预期它参与匹配。

   代价（已知且接受）：正文不提类型词时（如直接写「楚兰亭，九窍冰魄灵根…」）
   会筛空 → 不注入任何格式 → 模型按纯文本结论写入。这是有意的取舍：
   宁可不结构化，也不让清单无限膨胀（按用户明确要求，不回退全量）。 */
const FORMAT_MATCH_MIN_TERM_LENGTH = 2;
/* 名称分词：中文按 2-gram 切（「角色类」→ 角色/色类），英文与数字按词切。
   2-gram 让「创建修仙角色」这类未含完整格式名的文本仍能命中「角色类」。
   ⚠️ 英文必须基于【原文本】分词、不能基于去空白的 compact：去空白会把
   「Reading Notes」粘成 ReadingNotes，正则只能切出连写整串，导致
   「reading notes」这样的正常写法匹配不上（这是本函数引入时的踩坑）。 */
function formatNameTerms(name) {
  const text = normalizePlainText(name, MAX_FORMAT_NAME_LENGTH);
  if (text.length === 0) return [];
  const terms = new Set();
  /* 整名（去空白）优先：命中即强证据。 */
  const compact = text.replace(/\s+/g, '');
  if (compact.length >= FORMAT_MATCH_MIN_TERM_LENGTH) terms.add(compact);
  /* 中文 2-gram：只取纯汉字片段，避免把「类」这类单字后缀当词。 */
  for (const segment of text.match(/[\p{Script=Han}]+/gu) ?? []) {
    if (segment.length >= FORMAT_MATCH_MIN_TERM_LENGTH && segment.length <= 4) terms.add(segment);
    for (let index = 0; index + 2 <= segment.length; index += 1) terms.add(segment.slice(index, index + 2));
  }
  /* 英文/数字词：基于原始文本切分（保留空格作为词边界）。 */
  for (const word of text.match(/[A-Za-z0-9]{2,}/g) ?? []) terms.add(word.toLocaleLowerCase());
  return [...terms].filter((term) => term.length >= FORMAT_MATCH_MIN_TERM_LENGTH);
}

/* 格式是否与本轮文本相关（只按名称）。haystack 应已小写化（英文比较用）。 */
function formatMatchesText(format, haystack) {
  if (haystack.length === 0) return false;
  for (const term of formatNameTerms(format.name)) {
    if (haystack.includes(term.toLocaleLowerCase())) return true;
  }
  return false;
}

/* 按「代码」这一语义关键词筛选启用中的自定义格式（v12.25）。
   仅在内置代码类【停用】时用于「代码类语义」的正文归属：
   取名称分词里含 MEMORY_CODE_FORMAT_HINT_TERM 的格式（如「代码」「代码规范」命中，
   「角色类」不命中）。返回 { format, matched }：
     · matched.length === 1 → 唯一命中，可直接归属；
     · matched.length > 1   → 多套命中，调用方【只在这几套里】按字段键选最贴合的一套；
     · matched.length === 0 → 一套都没有，归属为「无归属」（绝不跑到无关格式）。
   注意复用 formatNameTerms（中文 2-gram），故「代码类」本身也会命中「代码」——
   但内置代码类停用时它不在 activeFormats 里，不会进入本函数候选集。 */
function selectCodeHintFormats(formats) {
  const list = Array.isArray(formats) ? formats : [];
  const matched = list.filter((format) => (
    format.id !== MEMORY_FORMAT_CODE_ID
    && formatNameTerms(format.name).some((term) => term.includes(MEMORY_CODE_FORMAT_HINT_TERM))
  ));
  return { format: matched[0], matched };
}

/* 按本轮文本筛选要注入的格式。keepCodeFormat 为 true 时无条件保留【代码类语义的格式】：
   内置代码类启用时是 fmt-code 本身；它停用后（v12.25/v12.26）改保底到名称含「代码」的
   【全部】自定义格式 —— 与 resolveFormatIdForWrite 的归属口径保持一致：
   后者在多套含「代码」时只在这几套里按字段选，故这几套必须都注入，否则模型看不到
   它们的字段定义，字段匹配无从谈起。
   返回 [] 表示「筛空」——调用方据此完全不注入格式清单。 */
function selectFormatsForText(formats, text, { keepCodeFormat = true } = {}) {
  const list = Array.isArray(formats) ? formats : [];
  if (list.length === 0) return [];
  const haystack = normalizePlainText(text, Number.MAX_SAFE_INTEGER).toLocaleLowerCase();
  /* 保底目标集合：优先内置代码类；它不在清单里时，退到名称含「代码」的全部格式。 */
  const builtinCode = list.find((format) => format.id === MEMORY_FORMAT_CODE_ID);
  const codeHintIds = new Set(
    builtinCode === undefined ? [] : selectCodeHintFormats(list).matched.map((format) => format.id)
  );
  const fallbackIds = new Set();
  if (builtinCode !== undefined) fallbackIds.add(builtinCode.id);
  else for (const format of selectCodeHintFormats(list).matched) fallbackIds.add(format.id);
  const selected = list.filter((format) => {
    /* 内置代码类启用时，自定义「代码/代码规范」格式不参加自动候选：
       用户约定是“不停用代码类就直接使用代码类”。它们仍保留在 UI/显式选择中；
       这里只收紧程序自动选择，避免提示、determinedFormat、归属三处互相冲突。 */
    if (builtinCode !== undefined && format.id !== MEMORY_FORMAT_CODE_ID && codeHintIds.has(format.id)) return false;
    if (keepCodeFormat && fallbackIds.has(format.id)) return true;
    return formatMatchesText(format, haystack);
  });
  /* 保底格式始终保留：让代码类语义的记忆能稳定按结构化写入。 */
  return selected;
}

/* 自动写入/蒸馏的候选格式快照。undefined 表示调用方没有限制候选（UI/历史明确
   归属路径）；空数组表示本轮没有可用候选，不能退回全量 activeFormats。 */
function normalizeAllowedFormatIdSet(value) {
  if (value === undefined) return undefined;
  const values = value instanceof Set ? [...value] : (Array.isArray(value) ? value : []);
  return new Set(values.map((item) => normalizePlainText(item, 128)).filter(Boolean));
}

/* 蒸馏提示词里的「格式选择」段落 —— 由激活的格式动态生成。
   路由规则（与程序侧判定一致，见 shouldUseStructuredContent）：
     ① 先分代码类/非代码类：代码类 → 内置「代码类」格式（有则用，没有则用第一套激活格式）
     ② 非代码类 → 从其余激活格式里挑最贴合的一套
     ③ 都不贴合 → 直接输出纯文本，不要套 JSON
   与标签词表（tagCatalog）同构：把候选清单作为【数据】注入，并给出【选择规则】。 */
function buildFormatPromptLines(formats) {
  const list = Array.isArray(formats) ? formats : [];
  if (list.length === 0) return [];
  /* ⚠️ 以下三个公共片段必须在任何 return 之前声明（v12.22）。
     此前它们定义在函数中部，而 v12.19 新增的「无内置代码类」分支在其上方 return 时
     引用了它们 —— const 的暂时性死区（TDZ）让该分支直接抛
     「Cannot access 'tail' before initialization」，提示词构造失败、蒸馏整体不可用
     （实测活动日志出现 5 次该报错）。 */
  /* v12.31：tail 不再列举旧协议英文字段（paths/symbols/content/pitfall）——
     蒸馏协议已跟随记忆格式，正文键以所选格式的声明为准；旧字段列举会诱导模型
     在自定义格式之外输出旧四键，破坏「只输出格式声明字段」的约束。 */
  const tail = '；额外输出 tags 数组（见下方标签规则）与 formatId 字段（值为所选格式的「格式ID」，原样照抄），不要输出 memory、confidence 等其他字段。';
  /* 严格对齐禁令：正文键必须与所选格式声明完全一致。这是防「提示词惯性」的
     提示词层防线 —— content/pitfall 等字段名的后续规则行（结论性陈述/踩坑要求）
     不再点名具体字段（那些行只在对应字段被格式声明时才有意义），避免模型在
     清单没有 content 时仍被命令"必须有 content"。 */
  const strictLine = '- 正文字段必须与所选格式的声明【完全一致】：只输出该格式声明的字段，禁止补充清单里没有的字段（哪怕你觉得某个字段"应该有"，比如 content/内容 —— 格式没声明就不许出现）；格式声明的必需字段一个都不能少。';
  /* 一条记忆 = 一个格式实例（v12.5）：格式字段就是全部可写空间，放不下要并入字段或换格式，
     不许为同一件事再开第二条记忆 —— 程序侧会拦截同一轮的第二次 memory_add。 */
  const singleCallLine = '- 本轮只能调用一次 memory_add（一条记忆 = 一个格式实例）：格式声明的字段就是这条记忆的全部可写空间。若信息较多，请把它们压缩进已声明的字段（如把补充说明并入最相关的那个字段）；若确实放不下，就改选字段更贴合的格式后一次性写入；再放不下就不写。禁止为同一件事拆成多条记忆，也不要先写一条再补一条。';
  /* ⚠️ 内置代码类必须【按 id 精确查找】，找不到就是没有（v12.19）。
     此处原为 `?? list[0]` 兜底 —— 当 fmt-code 被用户停用而从清单消失后，兜底会把
     【list[0]（任意一套自定义格式）】当成「代码类」来介绍。实测踩坑：用户建了一套
     名为「代码」的自定义格式（字段为 位置与内容，两者均必需），停用内置代码类后提示词便把它当
     「代码类」输出（单格式时更会退化成「JSON 固定格式：{"位置":…,"内容":…}」），
     模型据此写出 位置/内容 形状的正文并归属到那套格式 —— 用户看到的就是
     「明明停用了代码类，蒸馏却仍按代码类走」。
     语义上「代码类」是内置格式的身份，不是「清单里的第一套」；停用后它就该缺席。 */
  const codeFormat = list.find((format) => format.id === MEMORY_FORMAT_CODE_ID);
  const codeHintIds = new Set(
    codeFormat === undefined ? [] : selectCodeHintFormats(list).matched.map((format) => format.id)
  );
  const otherFormats = list.filter((format) => format.id !== codeFormat?.id && !codeHintIds.has(format.id));
  /* 没有任何内置代码类时：v12.28 起先判「是否只剩一套可用格式」——
     只剩一套时【直接指定式提示】，与 memory_add 工具描述同口径（这是二者此前的差异根源：
     工具描述有指定式分支、蒸馏没有，导致同一场景下 memory_add 能归属而蒸馏产出无归属）。
     为何必须指定式：用户停用内置代码类、只留一套自建格式（如「代码」）时，原先的
     「平铺列表 + 都不贴合就写纯文本」会让模型自行判断「这段内容不贴合任何格式」而输出
     纯文本 —— 纯文本没有字段键、也没有「字段名：」写法，三条自动归属路径全数落空 →
     明明有唯一可用格式却归成 fmt=''（用户实测反馈）。 */
  if (codeFormat === undefined) {
    if (list.length === 1) {
      const only = list[0];
      const requiredKeys = only.definition.fields.filter((field) => field.required === true).map((field) => field.key);
      return [
        `- 唯一可用格式：「${only.name}」（格式ID：${only.id}）：${describeFormatDefinition(only.definition)}`,
        ...(requiredKeys.length > 0 ? [`  · 必需字段：${requiredKeys.join('、')}（缺失会被拒绝写入）`] : []),
        `  · 请【严格按该格式生成】JSON 正文，并把 formatId 输出为 ${only.id}（原样照抄，不要编造、不要写格式名称）。`,
        `  · 只输出该格式声明的字段，禁止补充其它字段。${tail}`,
        strictLine,
        singleCallLine
      ];
    }
    return [
      '- 从下列格式中选最贴合的一套（只选一套，选定后只输出该格式的字段）：',
      ...list.map((format) => `  · 「${format.name}」（格式ID：${format.id}）：${describeFormatDefinition(format.definition)}`),
      `  · 都不贴合 → 直接输出纯文本正文，不要套 JSON。${tail}`,
      '- 必须额外输出 formatId 字段，值就是你选中的那套格式的「格式ID」（原样照抄，不要编造、不要写格式名称）；清单里没有的格式不要传它的 id。',
      strictLine,
      singleCallLine
    ];
  }
  const lines = [];
  if (otherFormats.length === 0) {
    /* 只有一套格式：保持与改造前一致的表述；v12 补必需字段说明（与写入校验同口径）。 */
    const requiredKeys = codeFormat.definition.fields.filter((field) => field.required === true).map((field) => field.key);
    const requiredNote = requiredKeys.length > 0 ? `（必需字段：${requiredKeys.join('、')}，缺失会被拒绝写入）` : '';
    lines.push(`- JSON 固定格式：${describeFormatDefinition(codeFormat.definition)}${requiredNote}${tail}`);
    lines.push(strictLine);
    lines.push(singleCallLine);
    return lines;
  }
  lines.push('- 先判断本轮内容属于【代码类】还是【非代码类】，再按下述规则选择格式（只选一套：选定后只输出该格式的字段，不要把「代码类」的 位置/对象/踩坑 混进其它格式的输出）：');
  lines.push(`  · 代码类（涉及代码、文件、函数、接口、项目技术等）→ 使用「${codeFormat.name}」（格式ID：${codeFormat.id}）：${describeFormatDefinition(codeFormat.definition)}`);
  lines.push(...otherFormats.map((format) => `  · 非代码类 → 从以下格式中选最贴合的一套：「${format.name}」（格式ID：${format.id}）：${describeFormatDefinition(format.definition)}`));
  lines.push(`  · 所有格式都不贴合 → 直接输出纯文本正文，不要套 JSON。${tail}`);
  lines.push('- 判定依据看记忆内容本身的主题：内容描述的是代码/技术工作（或本轮工具操作过代码文件且内容与之相关）→ 代码类；内容是角色、日记、偏好等非技术主题时，即使本轮碰巧操作过代码文件，也按非代码类选格式，不要套代码类字段。');
  /* 格式归属：让模型把它选中的那套格式 id 一并输出，写入侧据此落 memories.format_id。
     模型给的 id 会被 SELECT 校验存在性（UUID 形态几乎不可能被编对，伪造会被当场丢弃并降级为反推）。 */
  lines.push('- 必须额外输出 formatId 字段，值就是你上面选中的那套格式的「格式ID」（原样照抄，不要编造、不要写格式名称）。');
  lines.push(strictLine);
  lines.push(singleCallLine);
  return lines;
}

/* 蒸馏 prompt 的「字段值要求」行：按当前注入清单实际声明的字段动态生成，
   不再硬编码点名 content/pitfall —— 清单里没有的字段，这里就不能出现
   （否则模型被命令"必须有 content"，新建角色时就会惯性多出内容字段，实测踩坑）。
   contentLine/pitfallLine 由调用方在格式清单确定后按需拼装；没有声明就不输出该行。 */
function buildFieldValueRuleLines(formats) {
  const list = Array.isArray(formats) ? formats : [];
  const declared = (key) => list.some((format) => (format?.definition?.fields ?? []).some((field) => field?.key === key));
  const lines = [];
  if (declared('内容') || declared('content')) {
    lines.push('- 内容（content）必须是结论性陈述，不能是思考过程、分析草稿、自问自答、计划或待办；不要出现 "Let me"、"I need to"、"让我"、"等等" 这类过程语气。写完后自检：这段话能否直接当作既有事实引用？不能就重写。');
  }
  if (declared('踩坑') || declared('pitfall')) {
    lines.push('- 踩坑（pitfall）只记录本轮真实发生过的排查失败、反直觉问题、容易重复踩的踩坑；没有实际踩坑过程时必须输出空字符串，不得猜测。');
  }
  return lines;
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

function normalizeRecallSettings(value, { stored = false } = {}) {
  const mode = value?.mode;
  if (mode === 'default') return DEFAULT_RECALL_SETTINGS;
  if (mode === 'exclude-temporary') return EXCLUDE_TEMPORARY_RECALL_SETTINGS;
  if (mode !== 'custom' && stored) return DEFAULT_RECALL_SETTINGS;
  if (mode !== 'custom') throw new MemoryError('invalid-recall-settings', 'recall settings mode is invalid', 400);
  const maxItems = Number(value?.maxItems);
  const segment1 = Number(value?.segments?.segment1);
  const requestedSegment2 = Number(value?.segments?.segment2);
  const requestedSegment3 = Number(value?.segments?.segment3);
  /* 段2/段3 配额均可变：不再随 maxItems 阈值强制清零，用户可在 0~5 内自由设置；
     段4>=3 校验兜底总预算（配额不够分时保存会被拒绝，客户端同步禁用保存按钮）。 */
  const segment2 = requestedSegment2;
  const segment3 = requestedSegment3;
  if (![maxItems, segment1, requestedSegment2, requestedSegment3].every(Number.isInteger)
    || maxItems < 8 || maxItems > 20
    || segment1 < 3 || segment1 > 5
    || segment2 < 0 || segment2 > 5
    || segment3 < 0 || segment3 > 5) {
    throw new MemoryError('invalid-recall-settings', 'custom recall settings are out of range', 400);
  }
  const segment4 = maxItems - segment1 - segment2 - segment3;
  if (segment4 < 3) throw new MemoryError('invalid-recall-settings', 'recall fallback segment must be at least 3', 400);
  return Object.freeze({ mode: 'custom', maxItems, segments: Object.freeze({ segment1, segment2, segment3, segment4 }) });
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

/* 数据目录解析：index.js 传入设置解析结果（default 或自定义绝对路径）；
   未传入时回落 profile 下的默认目录，保持旧行为不变。 */
function resolveDataDir(options) {
  const dir = typeof options?.dataDir === 'string' && options.dataDir.trim().length > 0
    ? options.dataDir.trim()
    : pluginDataDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function textBlocks(content) {
  return textBlocksWith(content, true);
}

/* 蒸馏专用：排除 reasoning 块。
   蒸馏的语义是"提炼长期结论"，而 assistant 的思维草稿（分析、自问自答、计划）
   不是知识；更严重的是，思维文本进入 transcript 后会被蒸馏模型误当作"助手说的话"
   原样回抄进 content，再被符号抽取抓出 "Let/The/What" 一类英文句首词污染"对象"字段。
   其余调用点（会话检索 searchableSessionRows、召回去重 existingMessageDedupText）
   必须保留 reasoning：它们要忠实检索/比对会话原文，排除会净损失内容。
   故此处不修改 textBlocks 本身，另立函数并只在 turnTranscript 的助手行使用。 */
function textBlocksWithoutReasoning(content) {
  return textBlocksWith(content, false);
}

function textBlocksWith(content, includeReasoning) {
  if (!Array.isArray(content)) return '';
  const parts = [];
  const visit = (block) => {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    else if (includeReasoning && block?.type === 'reasoning' && typeof block.text === 'string') parts.push(block.text);
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
      /* 助手行排除 reasoning：只把结论性正文交给蒸馏模型（见 textBlocksWithoutReasoning 注释）。 */
      const text = textBlocksWithoutReasoning(event.data?.message?.content);
      if (text) rows.push({ role: '助手', text });
      continue;
    }
    if (event.type === 'tool/call' && event.data?.turn === turn) {
      const name = normalizePlainText(event.data?.name, 120) || 'unknown';
      const rawArguments = normalizePlainText(event.data?.arguments, MAX_DISTILL_TOOL_ARG_CHARS);
      const args = rawArguments;
      /* tool 字段供「位置/对象」结构化提取使用；text 仍用于转录渲染，二者独立。 */
      rows.push({ role: '工具调用', text: args ? `${name}\n${args}` : name, tool: { name, arguments: event.data?.arguments } });
      continue;
    }
    /* tool/result 不进 transcript：实测工具结果占「请求+结果」体积的 83%
       （极端轮次 96%，单轮可达 23 万字符），且返回的是「被读对象的原文」而非本轮工作成果。
       工具请求（name + arguments）已完整说明做了什么：file_path、pattern、old/new_string 等。
       丢弃结果使中位 transcript 从约 1.3 万字符降到约 2~3 千，直接缩短 LLM 等待时间。 */
  }
  return rows;
}

/* ── 工具来源的「位置/对象」提取 ──
   设计（与用户确认）：
   - 位置 = read/edit/write 的 file_path ∪ grep 的 path。glob/pwsh/web_* 不参与
     （glob 的 path 是目录根、信息量低，read 已覆盖；pwsh command 噪声大）。
   - 对象 = grep 的 pattern 拆解出的标识符候选 → 交给 LLM 筛选出类名/函数名/方法名。
     不用工具「结果」文本：实测从命中内容正则收割会产出 Found/DSH/Desktop/Error/String
     等格式词与语言关键字（平均 23.9 个/次），且命中内容是被搜文件的正文，
     并非本轮工作的对象。
   - grep pattern 是 agent 主动写下的搜索词，等于它认定的关键符号，语义最贴近「对象」。 */

/* 读写类工具：参数里的文件路径进「位置」。仅这三类——grep/glob 的 path 是搜索根。 */
const PATH_TOOLS = new Set(['read', 'edit', 'write', 'str_replace_editor', 'multi_edit', 'read_image', 'notebook_edit']);
/* grep 的 path 是精确搜索目标（常为具体文件），同样进「位置」。 */
const GREP_TOOLS = new Set(['grep']);
const TOOL_PATH_KEYS = ['file_path', 'path', 'notebook_path', 'filePath'];

/* 从工具调用参数里取路径。参数是 JSON 字符串（实测 100% 可解析）。 */
function toolPathFromArguments(name, rawArguments) {
  if (!PATH_TOOLS.has(name) && !GREP_TOOLS.has(name)) return '';
  let args;
  try { args = JSON.parse(rawArguments); } catch { return ''; }
  if (args === null || typeof args !== 'object') return '';
  for (const key of TOOL_PATH_KEYS) {
    const value = args[key];
    if (typeof value === 'string' && value.trim().length > 0) return cleanDistillPath(value);
  }
  return '';
}

/* 编程语言关键词：pattern 里出现它们是为了限定定义形态，本身不是标识符。 */
const SYMBOL_KEYWORD_STOP = new Set([
  'function', 'class', 'const', 'let', 'var', 'return', 'async', 'await', 'if', 'else', 'for', 'while',
  'new', 'this', 'typeof', 'instanceof', 'export', 'import', 'default', 'extends', 'implements', 'interface',
  'type', 'enum', 'struct', 'impl', 'trait', 'fn', 'func', 'sub', 'def', 'public', 'private', 'protected',
  'static', 'void', 'int', 'string', 'bool', 'boolean', 'true', 'false', 'null', 'undefined', 'self'
]);
/* 通用词：形态像标识符但无定位价值（与 task.js 的对象黑名单同源，另补 JS 内置）。 */
const SYMBOL_COMMON_STOP = new Set([
  'error', 'string', 'number', 'array', 'object', 'json', 'promise', 'map', 'set', 'date', 'math', 'regexp',
  'found', 'line', 'matches', 'match', 'result', 'results', 'value', 'values', 'name', 'names', 'text',
  'true', 'false', 'null', 'undefined', 'console', 'window', 'document', 'process', 'require', 'module',
  'exports', 'then', 'catch', 'finally', 'async', 'await', 'push', 'slice', 'join', 'filter', 'reduce',
  'keys', 'entries', 'includes', 'indexof', 'foreach', 'tostring', 'length'
]);

/* 文件名/扩展名片段：pattern 里常见 "cordis.patch.yml"、"patch.yml" 这类文件名，
   按点号切开后会产出 yml/json/js 等无意义片段，需整体丢弃。 */
const SYMBOL_FILE_EXTENSIONS = new Set([
  'yml', 'yaml', 'json', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'md', 'css', 'scss', 'html', 'vue',
  'py', 'rb', 'go', 'rs', 'java', 'cs', 'cpp', 'c', 'h', 'sql', 'sh', 'ps1', 'bat', 'toml', 'ini', 'lock'
]);

/* 从正则元字符中剥离出裸标识符，并记录语法线索。 */
function stripRegexForSymbol(segment) {
  const raw = String(segment ?? '');
  /* 线索须在剥离前捕获：前置定义关键词 / 尾随左括号（函数调用）。 */
  const hasDefinitionKeyword = /\b(?:function|class|def|interface|struct|impl|trait|fn|func|sub|enum|type)\b/i.test(raw);
  const hasCallParen = /\\?\(\s*(?:\\s\*)?\)?\s*$/.test(raw) || /\\?\(/.test(raw);
  /* 转义序列整体丢弃（\b \B \s \d \w \. 等）——只丢反斜杠会把 \b 的 b 留成标识符。 */
  let text = raw.replace(/\\[A-Za-z]+/g, ' ');
  /* 正则元字符与结构符号丢弃；保留点号以支持 obj.method 形态。 */
  text = text.replace(/[()[\]{}?*+^$|\\/:;,=<>!~#%&'"`\s-]+/g, ' ').trim();
  return { text, hasDefinitionKeyword, hasCallParen };
}

/* grep pattern → 标识符候选。按 | 切分，逐段剥离正则语法。
   只保留形如标识符的 token；丢弃纯通配符（星号、路径 glob）、语言关键词与通用词。 */
function grepPatternSymbols(pattern) {
  const out = [];
  const seen = new Set();
  for (const segment of String(pattern ?? '').split('|')) {
    const { text, hasDefinitionKeyword, hasCallParen } = stripRegexForSymbol(segment);
    if (text.length === 0) continue;
    for (const token of text.split(/\s+/)) {
      let value = token.replace(/^\.+|\.+$/g, '').trim();
      if (value.length < 2 || seen.has(value)) continue;
      if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(value)) continue;
      /* 文件名整体丢弃：末段是已知扩展名（cordis.patch.yml、patch.yml）时不是符号。 */
      if (SYMBOL_FILE_EXTENSIONS.has(value.split('.').pop().toLocaleLowerCase())) continue;
      const core = value.includes('.') ? value.split('.').pop() : value;
      const lower = core.toLocaleLowerCase();
      if (SYMBOL_KEYWORD_STOP.has(lower) || SYMBOL_COMMON_STOP.has(lower)) continue;
      /* 只保留最后一段做检索键（obj.method → method 更有检索价值），
         但多段形态本身有定位意义，故保留原值。 */
      seen.add(value);
      out.push({ value, hasDefinitionKeyword, hasCallParen });
    }
  }
  return out;
}

/* 汇总本轮工具的「位置」与 grep 符号候选。 */
function collectToolSignals(rows) {
  const paths = [];
  const seenPath = new Set();
  const symbols = [];
  const seenSymbol = new Set();
  for (const row of rows) {
    if (row.role !== '工具调用' || row.tool === undefined) continue;
    const { name, arguments: rawArguments } = row.tool;
    const path = toolPathFromArguments(name, rawArguments);
    if (path && !seenPath.has(path)) {
      seenPath.add(path);
      paths.push(path);
    }
    if (!GREP_TOOLS.has(name)) continue;
    let args;
    try { args = JSON.parse(rawArguments); } catch { continue; }
    if (args === null || typeof args !== 'object' || typeof args.pattern !== 'string') continue;
    for (const symbol of grepPatternSymbols(args.pattern)) {
      if (seenSymbol.has(symbol.value)) continue;
      seenSymbol.add(symbol.value);
      symbols.push(symbol);
    }
  }
  return { paths, symbols };
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
    const slice = raw.slice(start, end + 1);
    try {
      const parsed = JSON.parse(slice);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
    } catch {}
    /* 模型在 JSON 后追加了文字、或连排了第二个对象时，lastIndexOf('}') 会跨过边界，
       切片仍非法。此时取「第一个平衡闭合的 }」再试一次。 */
    const balanced = firstBalancedObject(slice);
    if (balanced !== undefined) {
      try {
        const parsed = JSON.parse(balanced);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
      } catch {}
    }
  }
}

/* 从字符串起始的 { 出发，返回第一个括号平衡的完整对象子串（正确跳过字符串字面量内的括号）。 */
function firstBalancedObject(text) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return text.slice(0, index + 1);
    }
  }
  return undefined;
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
  /* 新增三标签的兜底判定：接口约束须同时含「接口」语义与「约束」语义，避免与
     接口摘要、模块约束互相抢标签；决策记录看选型/取舍类措辞；排查记录看诊断类措辞。 */
  if (/接口约束|API\s*约束|契约约束|接口.{0,6}(?:必须|不能|约定|限制)|(?:必须|不能|约定|限制).{0,6}接口/.test(haystack)) add('接口约束');
  /* 决策记录：不能用裸词「决策」——"自动决策逻辑""等待用户决策"里的决策是名词性
     技术词，会把普通描述误标成决策记录。改看选型/取舍/为何选择这类真正的决策叙述。 */
  if (/决策记录|技术选型|方案选型|选型|取舍|权衡|为何选择|决定采用|定案/.test(haystack)) add('决策记录');
  /* 排查记录：裸词「故障」「踩坑」太宽泛——"故障降级策略""避免踩坑"都是设计性
     描述而非排查过程，会误标。只认真正指向诊断动作的措辞。 */
  if (/排查记录|排查|定位根因|根因|复现|调试记录|报错原因|排查结论/.test(haystack)) add('排查记录');
  if (/[A-Za-z]:\\|(?:^|[\s`'"（(])(?:src|lib|app|packages|node_modules|\.dsh|components|pages)[\\/][\w.\\/ -]+|@[\w.-]+\//i.test(haystack)) add('模块路径');
  if (/生活|家庭|健康|饮食|运动|旅行|日常|习惯|个人/.test(haystack)) add('日常生活');
  if (/场景|上下文|背景|当前正在|持续优化|持续开发|项目状态|任务背景/.test(haystack)) add('项目场景');
  if (/工作|项目|客户|需求|计划|会议|任务|排期|交付|插件|代码|仓库/.test(haystack)) add('工作项目');
  return tags.length > 0 ? tags : ['工作项目'];
}

/* 保守的字符串包含归并（不是语义同义词识别）：原文/去空格精确命中优先。
   否则只有「已有标签包含候选」时才吸附，避免把更具体的新对象/场景降格为泛标签；
   多个候选时取长度差最小者，项目内频次只作平局决胜。短边 <4 字或长度差 >6 不并。
   真正的同义词（如「性能调优/性能优化」）需要同项目已有精确词或以后由用户确认别名，
   本函数不会凭语义猜测。 */
function mergeTagIntoCatalog(tag, catalog) {
  if (!Array.isArray(catalog) || catalog.length === 0) return tag;
  const compact = (value) => String(value).replace(/\s+/g, '');
  const candidate = compact(tag);
  if (!candidate) return tag;
  /* 原文完全一致优先于任何归一：update 已有标签不会因目录顺序或空格变体改名。
     其次才接受去空格精确等价，最后才是包含归并。 */
  for (const name of catalog) if (String(name) === String(tag)) return name;
  for (const name of catalog) {
    const existing = compact(name);
    if (existing && existing === candidate) return name;
  }
  /* 没有精确命中时才吸附到包含候选的更具体已有名称：先选最小长度差，
     再沿用目录顺序（项目内高频/较老标签优先）作为平局决胜。 */
  let best;
  for (let index = 0; index < catalog.length; index += 1) {
    const name = catalog[index];
    const existing = compact(name);
    if (!existing) continue;
    /* 仅当已有名称至少与候选同样具体时才吸附；不能把新提出的具体对象/场景
       降格成一个更泛的旧标签。 */
    if (existing.length < candidate.length) continue;
    const shorter = candidate;
    const longer = existing;
    const lengthDelta = longer.length - shorter.length;
    if (shorter.length < TAG_MERGE_MIN_SHORT_SIDE || lengthDelta > 6 || !longer.includes(shorter)) continue;
    const score = { lengthDelta, index };
    if (best === undefined
      || score.lengthDelta < best.score.lengthDelta
      || score.lengthDelta === best.score.lengthDelta && score.index < best.score.index) {
      best = { name, score };
    }
  }
  return best?.name ?? tag;
}

/* 标签归一化：模型（或用户）给出的标签优先，只做清洗与分档，不做"过滤成空即回落"的误判。
   - 预设标签必须命中 MEMORY_PRESET_TAGS 白名单；默认标签集合不由本函数改写。
   - 描述性标签作为自定义标签落库，不设白名单，保留具体实体/事件/场景名称。
   仅当确实没给出任何可用标签（或非 JSON 输出）时才回落 classifyTags 兜底。
   项目内已有标签的复用在写入层 canonicalizeMemoryTagNames 处理，以确保按目标项目作用域匹配。 */
function normalizeTagNames(value, fallbackText = '', transcriptText = '') {
  const provided = uniqueStrings(Array.isArray(value) ? value : [], MAX_TAGS_PER_MEMORY * 2)
    .map(normalizeTagName)
    .filter(Boolean);
  if (provided.length === 0) return classifyTags(fallbackText, transcriptText);
  const seen = new Set();
  const preset = [];
  const custom = [];
  for (const tag of provided) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    if (MEMORY_PRESET_TAGS.includes(tag)) preset.push(tag);
    else if (preset.length + custom.length < MAX_TAGS_PER_MEMORY) custom.push(tag);
  }
  /* 预设标签优先占位，描述性标签随后补足上限。 */
  return [...preset, ...custom].slice(0, MAX_TAGS_PER_MEMORY);
}

/* 写入层的项目内标签规范化：保留已有名称和全部预设标签，只把新描述标签映射到
   当前项目里已用过的精确/包含名称。每次写入最多新增一个新的自定义标签，防止
   一条记忆生成多个新词；update 时 preserveNames 中的旧标签原样保留。 */
function canonicalizeMemoryTagNames(value, catalog = [], preserveNames = [], existingNames = []) {
  const provided = uniqueStrings(Array.isArray(value) ? value : [], MAX_TAGS_PER_MEMORY)
    .map(normalizeTagName)
    .filter(Boolean);
  const preserved = new Set(uniqueStrings(Array.isArray(preserveNames) ? preserveNames : [], MAX_TAGS_PER_MEMORY).map(normalizeTagName).filter(Boolean));
  const existing = new Set(uniqueStrings(Array.isArray(existingNames) ? existingNames : [], Number.MAX_SAFE_INTEGER).map(normalizeTagName).filter(Boolean));
  const seen = new Set();
  const output = [];
  let newCustomTags = 0;
  for (const tag of provided) {
    let canonical = tag;
    if (!MEMORY_PRESET_TAGS.includes(tag) && !preserved.has(tag)) {
      canonical = mergeTagIntoCatalog(tag, catalog);
      const reused = canonical !== tag || existing.has(tag);
      if (!reused) {
        if (newCustomTags >= 1) continue;
        newCustomTags += 1;
      }
    }
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    output.push(canonical);
  }
  return output.slice(0, MAX_TAGS_PER_MEMORY);
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
  pitfall: ['踩坑', 'pitfall'],
  tags: ['标签', 'tags'],
  /* 事实时间（v11）：蒸馏产物可携带。登记进别名表是【必需的】——
     structuredMemoryField 按 field → 别名列表查找，未登记的字段永远返回 undefined，
     蒸馏抽到的日期会在 parseDistillation 处被静默丢弃（这是本字段引入时的踩坑）。 */
  eventTime: ['事件时间', 'eventTime', 'event_time'],
  validUntil: ['失效时间', 'validUntil', 'valid_until'],
  /* 格式归属（v12）：蒸馏产物携带，写入 memories.format_id。
     登记进别名表是【必需的】，与上面 eventTime 同理 —— 未登记的字段会被
     structuredMemoryExtras 当作「自定义扩展字段」原样写进正文（那样 format_id 会
     变成落库正文里的一个装饰性键，既污染 body 又让 hash 与格式无关地变化）。 */
  formatId: ['格式ID', '格式id', 'formatId', 'format_id']
});
const STRUCTURED_MEMORY_KNOWN_KEYS = new Set(Object.values(STRUCTURED_MEMORY_FIELD_ALIASES).flat());
/* tags 是"载荷字段"而非"正文结构字段"：它只作为标签来源被消费，
   不写进落库正文（注入体积不该携带标签，标签已由 memory_tag_links 承载）。 */
const STRUCTURED_MEMORY_TAG_KEYS = new Set(['标签', 'tags']);
const STRUCTURED_MEMORY_PAYLOAD_ONLY_KEYS = new Set(['summary', 'text', 'memory', 'pitfalls']);
/* 登记进别名表但【不属于正文结构】的字段：formatId（归属）、eventTime/validUntil（事实时间）
   都靠落库列承载，不写进 body。它们必须被排除在「正文键集合」之外，否则格式反推失效
   （格式定义永远不会声明 formatId，子集判定恒 false）。 */
const STRUCTURED_MEMORY_PAYLOAD_FIELDS = new Set(['tags', 'formatId', 'eventTime', 'validUntil']);
const STRUCTURED_MEMORY_PAYLOAD_ALIAS_KEYS = new Set(
  [...STRUCTURED_MEMORY_PAYLOAD_FIELDS].flatMap((field) => STRUCTURED_MEMORY_FIELD_ALIASES[field] ?? [])
);
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

/* 文本字段（内容/踩坑）的类型收敛：string 直取；string[] join 成多行（自定义格式
   可能把「内容」声明为数组）；标量 String 化；其余（null/对象）回落空串。 */
function normalizeStructuredTextField(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => typeof item === 'string' ? item : '').filter((item) => item.length > 0).join('\n');
  }
  return typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
}

/* allowExtraOnly（v12）：允许「只含自定义字段、不含任何已知保留名」的 JSON 也按结构化处理。
   这解除了「自定义格式必须声明 位置/对象/内容/踩坑 之一」的历史限制。
   ⚠️ 本函数只负责「有自定义键就算结构体」这一层；真正的把关在 prepareMemoryWrite：
   必须归属成功【且】正文键命中该格式声明的字段，才会采用这条路径 —— 否则
   {"foo":"bar"} 会被凭空补成某个格式的壳。 */
function structuredMemoryFields(value, { allowExtraOnly = false } = {}) {
  if (allowExtraOnly) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const structuralKeys = structuredBodyKeys(value);
    if (structuralKeys.length === 0) return undefined;
  } else if (!structuredMemoryHasKnownField(value)) {
    return undefined;
  }
  const pathsValue = structuredMemoryField(value, 'paths');
  const symbolsValue = structuredMemoryField(value, 'symbols');
  const contentValue = structuredMemoryField(value, 'content');
  const pitfallValue = structuredMemoryField(value, 'pitfall');
  /* 类型收敛口径（v12）：只强制【键存在】与「任一结构字段」这一识别门槛，不强制类型：
     位置/对象 接受 string —— 由 cleanStructuredMemoryFieldValues（normalizeDistillList）
     按分隔符拆成数组收敛；内容/踩坑 接受数组 —— 由 normalizeStructuredTextField join 成多行。
     原因：自定义格式可能把保留名声明为其它类型（日记类的「位置」= string），过去类型不符
     会让 memory_add 抛 invalid-memory-json、读取侧把整条记忆退化成纯文本；而下游消费者
     （索引/召回/重建）本就按收敛后的规范形状工作，去掉类型拒绝即可三条路径行为一致。
     必需性完全由归属格式的 required 决定，本函数不做任何必需字段判定。 */
  /* 「对象」「内容」不再是硬必需（v12 记忆格式归属改造）：
     过去这两行 `if (... === undefined) return undefined` 把「含对象+内容」当成结构化记忆的
     唯一探针，导致任何不声明这两个保留名的自定义格式都无法以 JSON 落库。
     现在改为【任一结构字段存在即视为结构化】（门槛交给 structuredMemoryHasKnownField），
     缺失的字段收敛为空值 —— 下游消费者（索引/召回/关系边/注入）本就按规范形状工作，
     空值不会破坏它们；必需性改由格式定义的 required 在【写入路径】把关。
     ⚠️ 附带约定：自定义格式若要其正文被识别为结构化 JSON，至少需声明
     位置/对象/内容/踩坑 之一（否则正文键集合与已知键无交集，会被当作纯文本 JSON 存下）。 */
  return {
    paths: cleanStructuredMemoryFieldValues(pathsValue),
    symbols: cleanStructuredMemoryFieldValues(symbolsValue),
    content: normalizePlainText(normalizeStructuredTextField(contentValue), Number.MAX_SAFE_INTEGER),
    pitfall: normalizePlainText(normalizeStructuredTextField(pitfallValue ?? ''), Number.MAX_SAFE_INTEGER),
    extra: structuredMemoryExtras(value)
  };
}

/* 结构化判定：决定这条记忆以 JSON 保存（active）还是裸文本保存。
   只看记忆自身内容，不扫 transcript —— 后者是整轮对话过程，只要本轮聊过"函数"二字
   就会把生活类记忆也判成结构化，属于越权判定。
   三档依据：① 显式代码特征词 ② 召回画像判为 code ③ 含代码标识符形态。
   ③ 是必需的：像「task_view 增加了 writtenFiles 字段」这种句子没有任何特征词，
   但全是标识符，若漏判会被当成生活类记忆存成裸文本，丢掉结构化检索能力。 */
function shouldUseStructuredContent(payload, toolSignals) {
  const paths = structuredMemoryField(payload, 'paths');
  const symbols = structuredMemoryField(payload, 'symbols');
  const content = structuredMemoryField(payload, 'content');
  if (Array.isArray(paths) && paths.length > 0) return true;
  if (Array.isArray(symbols) && symbols.length > 0) return true;
  /* ② 客观事实：本轮工具操作过代码后缀文件 → 必是代码类。
     这一层取代了原来「靠内容里的日常动词猜」的做法，误判率显著降低。 */
  if (toolSignalsIndicateCode(toolSignals)) return true;
  const haystack = String(content ?? '');
  if (detectRecallProfile(haystack) === 'code') return true;
  if (CODE_FEATURE_WORDS_RE.test(haystack)) return true;
  return hasCodeIdentifierShape(haystack);
}

/* 代码类特征词（收紧后）。
   ⚠️ 为什么移除日常动词：原正则含「优化/调整/修复/新增/修改/实现/方法/事件/参数/返回/接口」，
   它们同样是生活用语，会把生活类记忆误判为代码类（实测「调整了作息时间」「修复了水龙头」
   「优化了日程安排」全被误判）。判定代码类应依赖【工具操作了代码文件】这一客观事实
   （见 collectToolSignals + isMemoryCodeFile），本正则只作为「纯口述技术决策」的兜底。
   保留项限定为编程专有词、扩展名与框架名。 */
const CODE_FEATURE_WORDS_RE = /代码|源码|插件|仓库|依赖|编译|构建|打包|部署|重构|排查|断点|报错|异常栈|堆栈|函数|方法名|类名|接口|组件|数据库|迁移|表结构|字段类型|索引|缓存|序列化|正则|异步|并发|进程|线程|配置项|环境变量|命令行|文件|路径|\bclass\b|\bcss\b|\bAPI\b|\bapi\b|\baction\b|\broute\b|\bendpoint\b|\bslot\b|\bhook\b|\bUI\b|\bSQLite\b|\bFTS\b|\bBM25\b|\bReact\b|\bprimitives\b|\bnode\s+--check\b|\.[cm]?[jt]sx?\b/i;

/* 代码标识符形态：snake_case、camelCase、带点号/斜杠的多段标识符。
   只认「词内混有下划线或大小写切换」这类强形态，避免把正常英文单词误判；
   要求出现次数 >= 2，进一步压低误伤（单次出现可能是文件名巧合）。 */
function hasCodeIdentifierShape(text) {
  const matches = String(text ?? '').match(/\b(?:[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+|[a-z]+[A-Z][A-Za-z0-9]*|[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9_]+|[A-Za-z][A-Za-z0-9_-]*\/[A-Za-z][A-Za-z0-9_/-]+)\b/g) ?? [];
  /* 路径形态（C:\ 或 /usr/...）单独计，它们本身就是代码类强信号。 */
  const pathLike = /\b[A-Za-z]:\\\\|[A-Za-z]:\\|\/(?:usr|home|var|etc|opt)\//.test(String(text ?? ''));
  if (pathLike) return true;
  const unique = new Set(matches.filter((item) => item.length >= 4));
  return unique.size >= 2;
}

/* ── 代码文件后缀判定（判定「本轮是否在改代码」的客观依据）──
   为什么用后缀而不是工具名：read/edit 既可能操作 .js（代码），也可能操作 .jpg/.pdf（非代码）。
   实测：read_image 读旅行照片、read 读 PDF 都不该算代码类，只看工具名会误判。
   ⚠️ 清单与 task.js 的 CODE_FILE_EXTENSIONS 保持一致（沿用同一口径，避免两套标准）：
      .md/.json/.yml/.sql 等【不算】代码文件 —— task.js 注释明确「非代码文件…不提取，
      避免把英文单词、数据值当符号」。若将来要改口径，两处需同步。 */
const CODE_FILE_EXTENSIONS = new Set([
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts',
  'vue', 'svelte', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'styl',
  'py', 'rb', 'php', 'java', 'kt', 'kts', 'scala', 'groovy',
  'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'cs', 'go', 'rs', 'swift', 'm', 'mm',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'bat', 'cmd',
  'lua', 'pl', 'r', 'jl', 'dart', 'ex', 'exs', 'erl', 'hs', 'clj', 'el', 'vim'
]);

/* 无扩展名但属代码文件的特例（Dockerfile / Makefile 这类）。 */
const CODE_FILE_BASENAMES = new Set(['dockerfile', 'makefile', 'cmakelists.txt', 'rakefile', 'gemfile', 'procfile']);

function isMemoryCodeFile(filePath) {
  const value = String(filePath ?? '').trim();
  if (value.length === 0) return false;
  const base = value.split(/[\\/]/).pop() ?? '';
  if (CODE_FILE_BASENAMES.has(base.toLowerCase())) return true;
  const match = base.match(/\.([A-Za-z0-9]+)$/u);
  if (match === null) return false;
  return CODE_FILE_EXTENSIONS.has(match[1].toLowerCase());
}

/* 本轮工具是否操作过代码文件（读/写/改/搜代码文件）。
   ⚠️ 已排除 read_image：它只会操作图片等非代码文件，纳入会引入误判。
   与 PATH_TOOLS 的区别：那里含 read_image（用于提取「位置」），这里只取代码相关工具。
   工具名只是入口，真正的判据是【被操作文件的后缀】（见 isMemoryCodeFile）。 */
function toolSignalsIndicateCode(signals) {
  const paths = Array.isArray(signals?.paths) ? signals.paths : [];
  if (paths.some((path) => isMemoryCodeFile(path))) return true;
  /* grep 抽出的符号候选非空，说明本轮在按符号搜索代码（搜索目标已由 paths 覆盖）。 */
  const symbols = Array.isArray(signals?.symbols) ? signals.symbols : [];
  return symbols.length > 0;
}

/* ── 代码类判定（专用于 format_id 归属，与 shouldUseStructuredContent 严格区分）──
   ⚠️ 为什么不能直接复用 shouldUseStructuredContent：后者回答的是「要不要存 JSON」，
   它的前两条依据（位置非空 / 对象非空）是【结构化信号而非代码类信号】——
   角色类记忆的「对象」= ["楚兰亭"] 同样会命中，把非代码记忆判成代码类。
   本函数只取其中真正的代码类判据，并对自定义格式做排除：
     · 含自定义扩展字段（格式已声明其骨架）→ 不归代码类，避免「创建修仙角色」
       在代码轮被正文里的「文件」等字样误判（该混血正文是已实测踩过的坑）；
     · 「位置」【不能】作为代码类判据：它是通用保留键，用户完全可能建
       「藏宝图类」「地点记录类」等声明「位置」的自定义格式。 */
function detectCodeMemoryClass(payload, toolSignals, extra = {}) {
  const extraKeys = extra !== null && typeof extra === 'object' && !Array.isArray(extra) ? Object.keys(extra) : [];
  if (extraKeys.length > 0) return false;
  const content = structuredMemoryField(payload, 'content');
  const haystack = String(content ?? '');
  /* ① 客观事实：本轮工具操作过代码后缀文件（仅蒸馏路径可得，最强依据）。 */
  if (toolSignalsIndicateCode(toolSignals)) return true;
  /* ②~④ 纯文本/口述类判据。 */
  if (detectRecallProfile(haystack) === 'code') return true;
  if (CODE_FEATURE_WORDS_RE.test(haystack)) return true;
  return hasCodeIdentifierShape(haystack);
}

/* 折叠路径值里连续的转义反斜杠：记忆 JSON 注入会话后被模型回抄，路径会带
   \\、\\\\ 等多级转义进入 transcript；蒸馏正则原样捕获，不折叠则每轮翻倍
   （C:\Users → C:\\Users → C:\\\\Users…）。UNC（以 \\ 开头）保持原样。 */
function collapsePathBackslashes(value) {
  const text = normalizePlainText(value, Number.MAX_SAFE_INTEGER);
  if (text.length === 0 || text.startsWith('\\\\')) return text;
  return text.replace(/\\{2,}/gu, '\\');
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
  return collapsePathBackslashes(text);
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

/* 按格式字段声明收敛值类型：格式写 string[] 就一定落数组，写 string 就一定落字符串。
   模型可能把数组字段输出成单字符串（如角色类的「外貌」），不能把这种不稳定形态
   直接落库；这里与客户端 memoryConvertValueByType 使用同一分隔规则。 */
function normalizeFormatValueByType(value, type) {
  if (type === 'string[]') {
    if (Array.isArray(value)) return normalizeDistillList(value);
    if (typeof value === 'string') {
      const text = value.trim();
      if (text === '') return [];
      if (text.includes('|')) return normalizeDistillList(text.split('|'));
      return normalizeDistillList(text);
    }
    if (value === undefined || value === null) return [];
    return normalizeDistillList([String(value)]);
  }
  if (type === 'string') {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.filter((item) => typeof item === 'string' && item !== '').join(' | ');
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '';
  }
  return value;
}

function formatFieldType(definition, key) {
  const fields = Array.isArray(definition?.fields) ? definition.fields : [];
  const direct = fields.find((field) => field?.key === key);
  if (direct !== undefined) return direct.type;
  const aliasEntry = Object.keys(STRUCTURED_MEMORY_FIELD_ALIASES).find(
    (name) => (STRUCTURED_MEMORY_FIELD_ALIASES[name] ?? []).includes(key)
  );
  if (aliasEntry !== undefined) {
    const aliases = STRUCTURED_MEMORY_FIELD_ALIASES[aliasEntry];
    const aliased = fields.find((field) => aliases.includes(field?.key));
    if (aliased !== undefined) return aliased.type;
  }
  return undefined;
}

/* 结构化记忆正文：JSON 对象；中文 key 为规范输出，英文 key 可读入。
   已知字段：位置/paths、对象/symbols、内容/content、踩坑/pitfall；未知字段保留。
   formatOrder（v12 可选）：该记忆归属格式的 definition.order。传入时按声明顺序重排键，
   formatDefinition（v12.32）同时按字段 type 收敛值。不传（无归属记忆）时行为与改造前
   逐字节一致 —— 这一点是硬要求，否则会引发全库正文 hash 变化、去重失效。 */
function structuredContentBody(paths, symbols, content, pitfall, extra = {}, formatOrder = undefined, formatDefinition = undefined) {
  const positionType = formatFieldType(formatDefinition, '位置') ?? 'string[]';
  const symbolType = formatFieldType(formatDefinition, '对象') ?? 'string[]';
  const contentType = formatFieldType(formatDefinition, '内容') ?? 'string';
  const pitfallType = formatFieldType(formatDefinition, '踩坑') ?? 'string';
  const body = {
    '位置': normalizeFormatValueByType(cleanStructuredMemoryFieldValues(paths).map(collapsePathBackslashes), positionType),
    '对象': normalizeFormatValueByType(cleanStructuredMemoryFieldValues(symbols), symbolType),
    '内容': normalizeFormatValueByType(normalizePlainText(content ?? '', Number.MAX_SAFE_INTEGER), contentType),
    '踩坑': normalizeFormatValueByType(normalizePlainText(pitfall ?? '', Number.MAX_SAFE_INTEGER), pitfallType)
  };
  const extraKeys = [];
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (STRUCTURED_MEMORY_KNOWN_KEYS.has(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) continue;
    const declaredType = formatFieldType(formatDefinition, key);
    body[key] = declaredType === undefined ? value : normalizeFormatValueByType(value, declaredType);
    extraKeys.push(key);
  }
  /* 空壳字段的去留（v12 起按归属格式判定，比"有无自定义字段"更准）：
      · 有归属格式（declaredOrder 非空）：只有当某个壳字段【不被该格式声明】时才删空值 ——
        格式声明了「位置」就保留 位置:[]（它是格式的一部分），未声明的空壳才清掉。
      · 无归属（declaredOrder 为空）：保持既有行为 —— 存在扩展字段时删空壳，
        纯代码类路径四键恒在（这条是无归属记忆 hash 不变的前提）。 */
  const declaredOrder = Array.isArray(formatOrder) ? formatOrder.filter((key) => typeof key === 'string' && key.length > 0) : [];
  /* v12.2 有归属格式时按【声明白名单】收敛：未被格式声明的保留名一律剔除（含非空值）。
     背景：模型有提示词惯性（格式删了「内容」仍可能输出 content），旧逻辑只删空壳，
     非空的多余字段会漏进正文 —— 新建角色时多出「内容」字段即此因（实测）。
     剔除是「格式是唯一骨架」语义的自然延伸：声明的字段保留（空壳也是骨架一部分），
     未声明的无论空满都不要。 */
  if (declaredOrder.length > 0) {
    for (const key of ['位置', '对象', '内容', '踩坑']) {
      if (declaredOrder.includes(key)) continue;
      delete body[key];
    }
  } else {
    const shellKeys = ['位置', '对象', '踩坑'];
    const shouldDropShell = (key) => extraKeys.length > 0;
    if (extraKeys.length > 0) {
      for (const key of shellKeys) {
        if (!shouldDropShell(key)) continue;
        const value = body[key];
        if (Array.isArray(value) && value.length === 0) delete body[key];
        else if (typeof value === 'string' && value.length === 0) delete body[key];
      }
      if (body['内容'] === '') delete body['内容'];
    }
  }
  const ordered = declaredOrder.length > 0 ? reorderStructuredBodyByFormat(body, declaredOrder) : body;
  return JSON.stringify(ordered, null, 2);
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

/* 结构化落库。
   fallback = 工具来源信号 { paths, symbols }：模型未填某字段时用它补全。
   - 位置：只在模型给空时用工具路径补（read/edit/write 的 file_path、grep 的 path）。
     不再从正文正则收割——「位置」允许为空。
   - 对象：grep 候选符号作为补充，与模型给的取并集（模型优先）。
     不再从 transcript 正则收割：实测会产出 Found/DSH/Desktop/Error 等格式词与关键字。 */
function formatDistilledContent(payload, transcriptText = '', fallback = {}, codeFormatActive = true, distillFormat = undefined) {
  /* ── v12.31 格式驱动主路径：蒸馏输出协议跟随记忆格式 ──
     用户明确要求：「蒸馏协议是旧版本的固定记忆格式，现在有了记忆格式设计，
     那么之前的固定蒸馏协议应该去掉」。旧协议（提取 content → 四键重组）正是
     「蒸馏输出与格式字段对不上 → 无归属」的结构性矛盾来源：
       · 模型按格式输出的字段（如「代码」格式的 位置/内容）被截成 content 纯文本；
       · 或被 v12.20 的 codeFormatActive 门控拦下（那道门控针对「纯文本自动包装四键」，
         却连模型主动输出的结构也一并拦掉）；
       · 再由无 order 的 structuredContentBody 补出 对象/踩坑 空壳 → undeclared → 丢归属。
     格式驱动模式下（distillFormat 由 parseDistillation 按模型选的 formatId 解析，
     唯一格式时直接采用），模型输出什么字段就按该格式的 order 渲染什么，
     与写入层 L0 的校验天然一致。 */
  if (distillFormat !== undefined) {
    const fields = structuredMemoryFields(payload, { allowExtraOnly: true });
    if (fields === undefined) return '';
    const content = sanitizeDistilledContent(fields.content);
    const pitfall = sanitizeDistilledContent(fields.pitfall);
    const extraHasValue = Object.values(fields.extra ?? {}).some((value) => {
      if (typeof value === 'string') return value.trim().length > 0;
      if (Array.isArray(value)) return value.some((item) => typeof item === 'string' && item.trim().length > 0);
      return false;
    });
    /* 只排除「全空 payload」（无值得记忆的空输出示例）；不再用 ≥6 长度下限 ——
       自定义格式的字段可能是短值（如「名称：楚兰亭」仅 3 字符），旧协议的
       content≥6 检查是针对长文本字段设计的，照搬会误杀短字段格式的蒸馏产物。
       整条正文的长度下限由写入层统一兜底（addEphemeralMemory 的 body.length < 6）。 */
    const hasSubstance = fields.paths.length > 0 || fields.symbols.length > 0
      || content.length > 0 || pitfall.length > 0 || extraHasValue;
    if (!hasSubstance) return '';
    return structuredContentBody(fields.paths, fields.symbols, content, pitfall, fields.extra, distillFormat.definition.order, distillFormat.definition);
  }
  const payloadContent = structuredMemoryField(payload, 'content') ?? payload?.summary ?? payload?.text ?? payload?.memory ?? '';
  const rawPayloadContent = normalizePlainText(payloadContent, Number.MAX_SAFE_INTEGER);
  if (rawPayloadContent.length < 6) return '';
  const embedded = parseStructuredMemoryBody(rawPayloadContent);
  const content = sanitizeDistilledContent(embedded?.content ?? rawPayloadContent);
  if (content.length < 6) return '';
  const payloadPaths = normalizeDistillList(structuredMemoryField(payload, 'paths'));
  const payloadSymbols = normalizeDistillList(structuredMemoryField(payload, 'symbols'));
  const modelPaths = payloadPaths.length > 0 ? payloadPaths : embedded?.paths ?? [];
  const modelSymbols = payloadSymbols.length > 0 ? payloadSymbols : embedded?.symbols ?? [];
  const pitfallSource = structuredMemoryField(payload, 'pitfall') ?? payload?.pitfalls ?? embedded?.pitfall ?? '';
  const pitfall = sanitizeDistilledContent(normalizePlainText(pitfallSource, Number.MAX_SAFE_INTEGER));
  /* 模型自带扩展字段（= 已按自定义格式输出，如角色类/日记类）时尊重模型的选择：
     只用模型自己给的 位置/对象，不再用工具信号回填或合并 —— 否则本轮碰巧读写过
     代码文件时，工具路径会被并进自定义格式记忆，产出「代码类骨架+自定义字段」
     的混血正文（实测「创建修仙角色」在代码轮被并入了 位置/对象）。
     此路径同时修掉另一处隐性丢字段：过去非代码轮会 return content 把自定义字段丢掉。 */
  const payloadExtras = { ...structuredMemoryPayloadExtras(payload), ...(embedded?.extra ?? {}) };
  if (Object.keys(payloadExtras).length > 0) {
    return structuredContentBody(modelPaths, modelSymbols, content, pitfall, payloadExtras);
  }
  /* 判定是否按结构化 JSON 落库：把工具信号一并传入 —— 本轮若读写/搜索过代码文件，
     即视为代码类（比"内容里出现日常动词"可靠得多）。fallback 同时携带 paths/symbols。 */
  const structuredPayload = embedded !== undefined || shouldUseStructuredContent({ paths: modelPaths, symbols: modelSymbols, content }, fallback);
  if (!structuredPayload) return content;
  /* ⚠️ 内置「代码类」停用时不再按代码类骨架包装（v12.20）：下方 structuredContentBody
     会把正文改写成 {位置,对象,内容,踩坑} 四键。用户原则是停用后不参与蒸馏，
     故此处原样返回正文（保留纯文本）；已结构化（embedded 非空）的照旧走结构维护。 */
  if (!codeFormatActive && embedded === undefined) return content;
  const toolPaths = normalizeDistillList(fallback?.paths);
  const paths = modelPaths.length > 0 ? modelPaths : toolPaths;
  /* 模型优先：工具候选只补模型未提及的部分。 */
  const symbols = mergeSymbols(modelSymbols, normalizeDistillList((fallback?.symbols ?? []).map((entry) => entry?.value ?? entry)));
  return structuredContentBody(paths, symbols, content, pitfall, payloadExtras);
}

/* 对象合并：模型结果优先并保留其顺序，工具候选只追加未出现过的项。 */
function mergeSymbols(modelSymbols, toolSymbols) {
  const out = [];
  const seen = new Set();
  for (const symbol of [...modelSymbols, ...toolSymbols]) {
    const value = normalizePlainText(symbol, 240);
    if (value.length === 0 || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function normalizeDistilledMemoryText(text, transcriptText = '', fallback = {}, codeFormatActive = true) {
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
  if (!shouldUseStructuredContent({ content }, fallback)) return content;
  /* 内置「代码类」停用 → 不按代码类骨架包装（v12.20），原样保留纯文本。 */
  if (!codeFormatActive) return content;
  return structuredContentBody(
    normalizeDistillList(fallback?.paths),
    normalizeDistillList((fallback?.symbols ?? []).map((entry) => entry?.value ?? entry)),
    content,
    ''
  );
}

/* 结构化判定：只接受规范 JSON 对象，中文/英文 key 均可。 */
function structuredMemoryText(text) {
  return parseStructuredMemoryBody(text) !== undefined;
}

/* 所有写入入口共用：结构化 JSON 统一规范化；裸代码/项目正文自动包装为 JSON。 */
/* 对象字段里的「伪符号」：模型常把分类词（用户身份/用户偏好/项目约定）当符号填进来，
   它们不是代码标识符，不足以支撑 JSON 结构。 */
const STRUCTURED_MEMORY_PSEUDO_SYMBOLS = new Set([
  '用户身份', '用户信息', '用户偏好', '用户画像', '用户习惯', '用户需求', '用户要求',
  '项目约定', '项目信息', '项目背景', '项目偏好', '偏好', '身份', '习惯', '约定', '信息', '要求', '需求'
]);

/* 结构体是否「值得用 JSON 存」：只有真正带定位信息或自定义字段的才值得。
   判定依据（任一成立即可）：
     - 存在自定义字段 —— 用户按自定义格式新增的字段本身就是结构化价值
       （日记类的「日期/心情」等；没有这一条，对象为空的日记会被降级并丢字段）；
     - 位置 字段非空 —— 有文件路径，JSON 有实际检索价值；
     - 对象 字段含真符号（过滤掉「用户身份」这类分类词）—— 有可检索的代码符号；
     - 内容 命中代码特征词 —— 属代码类记忆。
   全部为空/纯生活偏好且无自定义字段时返回 false，调用方据此把它降级成裸文本。 */
function structuredBodyWorthJson(paths, symbols, content, extra = {}, toolSignals) {
  const extraKeys = extra !== null && typeof extra === 'object' && !Array.isArray(extra) ? Object.keys(extra) : [];
  if (extraKeys.length > 0) return true;
  if (Array.isArray(paths) && paths.length > 0) return true;
  const realSymbols = cleanStructuredMemoryFieldValues(symbols).filter((item) => !STRUCTURED_MEMORY_PSEUDO_SYMBOLS.has(item));
  if (realSymbols.length > 0) return true;
  return shouldUseStructuredContent({ content: content ?? '' }, toolSignals);
}

/* 结构体降级为裸文本：把「内容」抽出为正文字符串，丢弃全空的壳字段。
   这样「{位置:[],对象:["用户身份"],内容:"用户自称喵喵"}` 会存成「用户自称喵喵」，
   而不是套着空壳的 JSON（注入时省 token，也不再啰嗦）。 */
function collapseStructuredBodyToPlainText(paths, symbols, content, pitfall) {
  const parts = [];
  const body = normalizePlainText(content ?? '', Number.MAX_SAFE_INTEGER);
  if (body.length > 0) parts.push(body);
  const pit = normalizePlainText(pitfall ?? '', Number.MAX_SAFE_INTEGER);
  if (pit.length > 0) parts.push(`踩坑：${pit}`);
  /* 伪符号（「用户身份」这类分类词）不附到正文尾巴，它没有信息量。 */
  const pathList = cleanStructuredMemoryFieldValues(paths);
  const symbolList = cleanStructuredMemoryFieldValues(symbols).filter((item) => !STRUCTURED_MEMORY_PSEUDO_SYMBOLS.has(item));
  if (pathList.length > 0) parts.push(`位置：${pathList.join('、')}`);
  if (symbolList.length > 0) parts.push(`对象：${symbolList.join('、')}`);
  return parts.join('\n').trim();
}

/* 「字段：信息」逐行文本的解析（v12.12，与 client.js 的 memoryExtractFieldsFromText 同规则）。
   识别形态：
     字段：信息
     字段：信息
   或同行内以「。」「；」等分隔的「字段：信息」。要求 ≥2 个字段、字段名不重复。
   字段名允许 0~4 个汉字修饰词（「标志性技能：」），但必须紧跟冒号 —— 这是
   「字段式写法」的强特征，可避免把叙述文本里的同名词误当字段。 */
function parseFieldLines(text) {
  const raw = typeof text === 'string' ? text : String(text ?? '');
  if (raw.trim().length === 0) return undefined;
  /* ⚠️ 字段名不允许以单个拉丁字母开头：Windows 盘符（「C:\a\b.js」）会被
     「字母 + 冒号」误判成字段名，把路径值切碎（实测「位置：C:\a\b.js」解析出
     字段名 C，位置值丢失）。字段名以汉字开头（常见）或 2+ 字母/下划线开头即可。 */
  const pattern = /(?:^|[\n。；;、,，\s]|[\u4e00-\u9fa5]{0,4})((?:[\u4e00-\u9fa5][\u4e00-\u9fa5A-Za-z0-9_]{0,11})|(?:[A-Za-z_][A-Za-z0-9_]{1,11}))\s*[：:]/gu;
  const located = [];
  for (const match of raw.matchAll(pattern)) {
    const key = match[1].trim();
    if (key.length === 0) continue;
    located.push({ key, start: match.index, valueStart: match.index + match[0].length });
  }
  if (located.length < 2) return undefined;
  located.sort((left, right) => left.start - right.start);
  /* ⚠️ 精度保护：首个字段必须紧贴正文开头（允许前置空白）。
     否则「今天发生了很多事。注意：xxx\n提醒：yyy」这类散文会被误判成字段表 ——
     真正的字段式正文总是【以字段名开头】。 */
  if (!/^\s*$/.test(raw.slice(0, located[0].start))) return undefined;
  const seen = new Set();
  const unique = located.filter((item) => {
    if (seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
  if (unique.length < 2) return undefined;
  const json = {};
  for (let index = 0; index < unique.length; index += 1) {
    const current = unique[index];
    const next = unique[index + 1];
    let value = raw.slice(current.valueStart, next === undefined ? raw.length : next.start);
    value = value.replace(/^[\s。；;、,，]+/u, '').replace(/[\s。；;、,，]+$/u, '').trim();
    if (value.length === 0) continue;
    json[current.key] = value;
  }
  return Object.keys(json).length >= 2 ? json : undefined;
}

/* 无格式归属但有字段区分的正文 → 规范 JSON 落库（v12.12）。
   用户策略：蒸馏 / memory_add / memory_update 写入的记忆若【没匹配到格式】，
   但内容本身有字段区分 → 按 JSON 存储；没有字段区分 → 保持原来的纯文本。
   为什么存 JSON 而不是逐行文本：memory_relate 的关系边依赖
   parseStructuredMemoryBody(body) 从 JSON 提取 位置/对象，FTS 索引与按字段截断
   （limitStructuredMemoryText）也按 JSON 结构工作 —— JSON 是这些链路的载体。
   阅读便利由展示层负责（客户端把 JSON 渲染成「字段：信息」列表），存储层保持结构化。
   入参：字段名 → 值 的对象；返回规范 JSON 文本（缩进 2），不足 2 个字段则 undefined。 */
function fieldMapToStructuredJson(fieldMap) {
  if (fieldMap === null || typeof fieldMap !== 'object' || Array.isArray(fieldMap)) return undefined;
  const entries = Object.entries(fieldMap)
    .filter(([key]) => key.length > 0 && !['__proto__', 'constructor', 'prototype'].includes(key))
    .filter(([, value]) => {
      const text = typeof value === 'string' ? value.trim() : value;
      return !(text === '' || text === undefined || text === null);
    });
  if (entries.length < 2) return undefined;
  /* 键序保持出现顺序（对象字面量已保序），与「用户看到的字段顺序」一致。 */
  return JSON.stringify(Object.fromEntries(entries), null, 2);
}

/* 记忆正文规范化（所有写入入口的公共通道）。
   formatOrder（v12 可选）：归属格式的 definition.order，传入时正文按声明顺序落库。
   codeFormatActive（v12.20，默认 true）：内置「代码类」是否启用。传 false 时
     【不做代码类形状的自动包装】—— 用户原则是「内置格式只有激活时才常驻；停用后
     无论是否内置都不参与 memory_add/memory_update」。故停用后代码形状的正文按纯文本落库，
     不再被程序改写成 {位置,对象,内容,踩坑} 四键。
   ⚠️ 不传 formatOrder 时行为必须与改造前逐字节一致 —— 无归属记忆与旧库正文的 hash 不能变，
   否则会引发全库去重失效与「未修改却被判为已修改」的假修订。
   （调用方若无法确定格式状态，传默认 true 即保持旧行为。） */
function normalizeMemoryBodyForWrite(text, formatOrder = undefined, codeFormatActive = true) {
  const raw = normalizePlainText(text, Number.MAX_SAFE_INTEGER);
  if (raw.length === 0) return '';
  const embedded = parseStructuredMemoryBody(raw);
  if (embedded !== undefined) {
    const content = sanitizeDistilledContent(embedded.content);
    const pitfall = sanitizeDistilledContent(embedded.pitfall);
    const extras = structuredMemoryPayloadExtras(embedded.extra ?? {});
    /* 非代码类结构体降级成裸文本：模型常把「用户自称喵喵」也套成
       {位置:[],对象:["用户身份"],内容:"..."}，空壳字段只会徒增体积。
       ⚠️ 但「存在自定义字段」时不降级 —— 那是用户按自定义格式写入的有效结构；
       归属了格式的记忆同样不降级（格式已声明这是一套有效骨架）。 */
    if (declaredFormatOrderEmpty(formatOrder)
      && !structuredBodyWorthJson(embedded.paths, embedded.symbols, content, extras)) {
      return collapseStructuredBodyToPlainText(embedded.paths, embedded.symbols, content, pitfall);
    }
    return structuredContentBody(embedded.paths, embedded.symbols, content, pitfall, embedded.extra, formatOrder);
  }
  let parsedJson;
  const looksLikeStructuredJson = /^[{[]/.test(raw) && /["']?(?:位置|paths|对象|symbols|内容|content|踩坑|pitfall)["']?\s*:/.test(raw);
  if (/^[{[]/.test(raw)) {
    try { parsedJson = JSON.parse(raw); } catch {}
    if (structuredMemoryHasKnownField(parsedJson)) throw new MemoryError('invalid-memory-json', 'structured memory JSON is invalid');
  }
  /* v12.12 无格式归属 + 正文有字段区分 → 按 JSON 存储。
     用户策略：没匹配到格式但有字段区分 → JSON；没有字段区分 → 保持纯文本。
     这里处理【字段式纯文本】（「名称：甲\n年龄：20」），把它组装成规范 JSON 落库 ——
     结构化存储让 memory_relate 的关系边、FTS 索引与按字段截断都能正常工作；
     阅读便利交给展示层（客户端把 JSON 渲染成「字段：信息」列表）。
     ⚠️ 已有 JSON 的纯自定义字段（{"日期":..,"心情":..}）走下方 structuredBodyWorthJson
     的既有分支（extra 非空即保留 JSON），无需在此重复处理。 */
  if (declaredFormatOrderEmpty(formatOrder) && parsedJson === undefined && !/^\s*[{[]/.test(raw)) {
    const fieldMap = parseFieldLines(raw);
    if (fieldMap !== undefined) {
      const asJson = fieldMapToStructuredJson(fieldMap);
      if (asJson !== undefined) return asJson;
    }
  }
  const structured = shouldUseStructuredContent({ content: raw }, '');
  /* ⚠️ 内置「代码类」被停用时不再自动包装（v12.20）：下面这段会把代码形状的正文
     改写成 {位置,对象,内容,踩坑} 四键 —— 那是「按代码类格式落库」的行为。
     用户明确要求停用后不参与 memory_add/memory_update，故此处按纯文本原样落库。
     （注意判据仍保留：正文本身就是规范四键 JSON 的情况在上方 embedded 分支处理，
       不受此门控影响 —— 已归属/已结构化的正文照旧按结构维护。） */
  if (/^[{[]/.test(raw) && (looksLikeStructuredJson || parsedJson === undefined && structured)) throw new MemoryError('invalid-memory-json', 'structured memory JSON is invalid');
  if (!structured) return raw;
  if (!codeFormatActive) return raw;
  const content = sanitizeDistilledContent(raw);
  if (content.length === 0) return '';
  return structuredContentBody(
    extractDistillPaths(content),
    extractDistillSymbols(content),
    content,
    '',
    {},
    formatOrder
  );
}

function parseDistillation(text, transcriptText, fallback = {}, codeFormatActive = true, injectFormats = []) {
  const parsed = parseJsonObject(text);
  /* ── v12.31 蒸馏格式驱动：先定格式再解析正文 ──
     优先级：① 模型输出的 formatId（须在注入清单内且启用）；② 清单唯一时直接采用
     （协议里已明确要求抄 id，但模型偶尔漏抄 —— 唯一格式时无须它选，无歧义）。
     解析失败/歧义时 distillFormat=undefined，退回旧协议（向后兼容）。 */
  let distillFormat = undefined;
  if (parsed !== undefined && Array.isArray(injectFormats) && injectFormats.length > 0) {
    const claimed = normalizePlainText(structuredMemoryField(parsed, 'formatId'), 128);
    const claimedFormat = claimed.length > 0 ? injectFormats.find((format) => format.id === claimed) : undefined;
    if (claimedFormat !== undefined) distillFormat = claimedFormat;
    else if (injectFormats.length === 1) distillFormat = injectFormats[0];
  }
  /* 不在这里截断 JSON 字段：生成侧保留完整多行正文；上下文体积由注入侧按 content 字段单条限额保证。 */
  const memory = parsed === undefined
    ? normalizeDistilledMemoryText(stripCodeFence(text), transcriptText, fallback, codeFormatActive)
    : formatDistilledContent(parsed, transcriptText, fallback, codeFormatActive, distillFormat);
  if (memory.length < 6) return undefined;
  /* 标签以模型输出的 tags 为准（预设走白名单、描述性标签允许作为自定义标签落库）；
     模型未给（非 JSON 输出、旧格式）时才回落正则 classifyTags 兜底。 */
  const payloadTags = parsed === undefined ? undefined : structuredMemoryField(parsed, 'tags');
  /* 事实时间：模型只在对话里确有明确日期/期限时才给；解析失败（模型写错格式）时
     整条丢弃而不是抛错——蒸馏是后台流程，不能因为一个可选字段让整条记忆写不进去。 */
  let eventTime;
  let validUntil;
  if (parsed !== undefined) {
    try {
      eventTime = parseFactTime(structuredMemoryField(parsed, 'eventTime') ?? structuredMemoryField(parsed, 'event_time'), { label: 'eventTime' });
      validUntil = parseValidUntil(structuredMemoryField(parsed, 'validUntil') ?? structuredMemoryField(parsed, 'valid_until'));
      assertFactTimeOrder(eventTime, validUntil);
    } catch {
      eventTime = undefined;
      validUntil = undefined;
    }
  }
  /* 格式归属：模型选中的格式 id。写入侧会 SELECT 校验其存在性，不合法则丢弃并降级为
     键集合反推 —— 故此处只做文本提取，无法解析时返回 undefined（不抛错）。
     同事实时间：蒸馏是后台流程，可选字段不该让整条记忆写不进去。 */
  /* 只返回解析层已经认可的 formatId：模型抄了清单外的 active 格式时也必须清除，
     不能让写入侧 formatById 全量查询再次接纳一个模型看不到的格式。 */
  const formatId = parsed === undefined ? undefined : (distillFormat?.id ?? undefined);
  return { memory, tags: normalizeTagNames(payloadTags, memory, transcriptText), eventTime, validUntil, formatId };
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
/* 把毫秒格式化成可读时长。⚠️ 不要直接 Math.round(ms/1000)：600ms 会被显示成
   「1 秒」，用户按提示调超时会改错量级。小于 1 秒一律用毫秒表示。 */
function formatTimeoutDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value < 1000) return `${Math.round(value)} 毫秒`;
  const seconds = value / 1000;
  return `${Number.isInteger(seconds) ? seconds : Math.round(seconds * 10) / 10} 秒`;
}

/* 按错误信息给出针对性的排查方向（连通测试失败时展示）。
   目的：把"HTTP 401"这类原始信息翻译成"该去改哪里"，减少来回试错。 */
function embeddingTestHint(message, provider) {
  const text = String(message ?? '').toLowerCase();
  const isLocal = provider?.kind === 'local';
  if (text.includes('http 401') || text.includes('http 403') || text.includes('unauthorized')) {
    return '鉴权失败：请检查 API Key 是否正确、是否有该模型的权限。';
  }
  if (text.includes('http 404')) {
    return '端点不存在：请检查 API 地址是否已包含正确路径（多数服务需要以 /v1 结尾，插件会自动补 /embeddings）。';
  }
  /* 返回 HTML 而非 JSON：绝大多数是"地址指向了网页而不是 API 端点"。
     实测 openrouter.ai 对未知路径返回 200 + HTML 落地页，此时状态码正常，
     只有响应体形态能暴露问题。放在 404 之后：若状态码本身就是 404/401，
     那些分支的提示更精确；本分支兜住"状态码正常但内容是网页"的情况。 */
  if (text.includes('returned html') || text.includes('(html response)')) {
    return '接口返回的是网页(HTML)而不是 JSON：请确认 API 地址指向的是 /embeddings 端点，而不是服务商首页或文档页（多数服务需要以 /v1 结尾，插件会自动补 /embeddings）。';
  }
  if (text.includes('not valid json')) {
    return '响应不是合法 JSON：请确认 API 地址指向的是 /embeddings 端点（有些服务商会返回网页或纯文本）。';
  }
  /* HTTP 400 在配置阶段几乎总是"参数与服务商要求不符"，最常见的就是手填的维度。
     实测 dimensions=512 而模型实际 2048 → HTTP 400。 */
  if (text.includes('http 400')) {
    const configured = Number(provider?.dimensions);
    const dimHint = Number.isFinite(configured) && configured > 0
      ? `当前填写的维度是 ${configured}，`
      : '';
    return `参数被拒绝：${dimHint}请核对该模型支持的向量维度（填错会被服务商拒绝），或先清空维度让插件按接口返回值自动识别。`;
  }
  if (text.includes('http 5')) {
    return '服务商侧故障（5xx）：这不是本机配置问题，请稍后重试或联系服务商。';
  }
  if (text.includes('http 429')) {
    return '触发限流：请稍后重试，或确认账号额度是否用尽。';
  }
  /* 维度不匹配：本地由推理后对账发现（完全静默）；远程则由 init() 对账发现——
     很多服务商【忽略】dimensions 参数而不报 400，若不比对，只会表现为界面统计恒 0/N。 */
  if (text.includes('dimension mismatch')) {
    const actual = Number(String(message ?? '').match(/returns\s+(\d+)/iu)?.[1]);
    const declared = Number(provider?.dimensions);
    const pair = Number.isFinite(actual) && actual > 0
      ? `模型实际返回 ${actual} 维，而配置里填的是 ${Number.isFinite(declared) && declared > 0 ? declared : '?'} 维`
      : '填写的维度与该模型实际返回的不一致';
    return `维度不匹配：${pair}。请把「向量维度」改成 ${Number.isFinite(actual) && actual > 0 ? actual : '模型实际值'}，或直接清空该字段让插件自动识别。`;
  }
  /* 本地模型加载超时：与推理超时区分开——首次使用要下载权重，属正常耗时，
     给的是"等待/换小模型"的建议，而不是"检查网络"这类泛泛提示。 */
  if (isLocal && text.includes('model load timed out')) {
    const configuredLoad = Number(provider?.loadTimeoutMs);
    const duration = Number.isFinite(configuredLoad) && configuredLoad > 0
      ? formatTimeoutDuration(configuredLoad)
      : formatTimeoutDuration(MEMORY_EMBEDDING_TIMEOUT_LOCAL_LOAD);
    return `本地模型加载超时（当前上限 ${duration}）：首次使用需从 HuggingFace 下载模型权重（可能数百 MB），请确认网络可访问 huggingface.co；也可改用体积更小的模型，或改用「网络 API」。`;
  }
  /* ⚠️ 必须同时认 'timeout' 与 'timed out'：远程用 'request timeout'，
     本地超时消息用 'timed out after Ns'，只认前者会让本地超时落到通用兜底。 */
  if (text.includes('timeout') || text.includes('timed out') || text.includes('aborted')) {
    /* 用配置里的实际超时值，而不是硬编码 30/5 —— 否则用户自定义 timeoutMs 后提示会误导。 */
    const configured = Number(provider?.timeoutMs);
    const duration = Number.isFinite(configured) && configured > 0
      ? formatTimeoutDuration(configured)
      : (isLocal ? formatTimeoutDuration(MEMORY_EMBEDDING_TIMEOUT_LOCAL) : formatTimeoutDuration(MEMORY_EMBEDDING_TIMEOUT_REMOTE));
    if (isLocal) {
      return `本地推理超时（当前上限 ${duration}）：若模型较大或使用 CPU 推理，请调大超时或改用更小的模型；首次加载请稍后重试。`;
    }
    return `请求超时（当前上限 ${duration}）：请检查网络或代理，本地模型首次加载可能较慢。`;
  }
  if (text.includes('fetch failed') || text.includes('enotfound') || text.includes('econnrefused')) {
    return '无法连接：请检查地址拼写、服务是否已启动、以及本机能否访问该域名（代理/防火墙）。';
  }
  if (text.includes('size mismatch')) {
    return '返回条数与请求不一致：该端点可能不支持批量输入，或返回了非标准格式。';
  }
  if (text.includes('empty vector') || text.includes('returned an empty')) {
    return '返回空向量：请确认用的是 embedding 模型（对话模型通常不支持 /embeddings）。';
  }
  if (isLocal && (text.includes('transformers') || text.includes('not installed'))) {
    return '本地模型需要 @huggingface/transformers 依赖，当前环境未安装；可改用「网络 API」。';
  }
  if (text.includes('endpoint or model is missing')) {
    return '配置不完整：请填写 API 地址与模型名。';
  }
  return '请检查接口地址、API Key、模型名是否与该服务商文档一致。';
}

/* 结构分权重档位：由 customContext.structureWeights 传入（召回路径注入），
   未传时用降档默认值。两档的差异只在【权重数值】，标签判定逻辑完全相同。 */
function structureWeightsOf(customContext) {
  const w = customContext?.structureWeights;
  if (w !== undefined && Number.isFinite(w?.tier1) && Number.isFinite(w?.max1)) return w;
  return { tier1: STRUCTURE_TIER1_WEIGHT, max1: STRUCTURE_TIER1_MAX_WEIGHT };
}

function structureWeightForRow(row, customContext) {
  const weights = structureWeightsOf(customContext);
  let tier1 = 0;
  let tier2 = 0;
  for (const tag of rowTagNames(row)) {
    if (STABLE_TIER1_TAGS.has(tag)) tier1 += weights.tier1;
    else if (STABLE_TIER2_TAGS.has(tag)) tier2 += STRUCTURE_TIER2_WEIGHT;
  }
  return {
    tier1: Math.min(weights.max1, tier1),
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
      if (existing === undefined) { byId.set(rowId, row); continue; }
      /* 同 id 双路命中（如 FTS 与向量都召回同一条）时【合并字段】而不是二选一。
         原实现只按 bm25Weight(rank) 取高者，会把另一路独有的字段丢掉 ——
         最典型的是向量通道的 vectorScore（FTS 行没有该字段），导致向量分静默丢失、
         该条在评分矩阵里 vector 分量恒为 0。
         rank 仍取 bm25Weight 高者（保持原语义），vectorScore 取两者较大值。 */
      const keepIncoming = bm25Weight(row.rank) > bm25Weight(existing.rank);
      const merged = keepIncoming ? { ...existing, ...row } : { ...row, ...existing };
      if (existing.vectorScore !== undefined || row.vectorScore !== undefined) {
        merged.vectorScore = Math.max(existing.vectorScore ?? -1, row.vectorScore ?? -1);
      }
      byId.set(rowId, merged);
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
  const structure = structureWeightForRow(row, customContext);
  return {
    bm25: bm25Weight(row.rank),
    customTag: customTagWeightForRow(row, customContext),
    profileTag: tagWeightForRow(row, weights),
    structureTier1: structure.tier1,
    structureTier2: structure.tier2,
    recency: recencyWeightForRow(row, startedAt),
    /* 向量分量：余弦 0~1 映射到 0~MEMORY_VECTOR_MAX_WEIGHT。
       行上没有 vectorScore 时返回 0（embedding 关闭 / 该条无边），
       因此关闭状态下总分不变。 */
    vector: vectorWeight(row.vectorScore)
  };
}

/* 各段分量选择器（v8/v9 分段评分矩阵）：
   段1 底色：BM25+自定义+画像+结构一+时间(第一档曲线)——无第二档结构分（无该成员）；
   段2 临时：BM25+自定义+画像——无结构分（蒸馏自动标签质量参差）、无时间分（恒1.2零区分度）；
   段3 混合：全分量（结构一防第一档 vs 第二档倒挂）；
   段4 兜底：无结构一（成员不含第一档标签）。 */
const SEGMENT_COMPONENT_KEYS = {
  /* 段1 不加 vector：它是「身份通道」，职责是保底不漏（与查询无关），
     且其候选池（bottomTagCandidateRows）本就取不到向量候选。 */
  bottom: ['bm25', 'customTag', 'profileTag', 'structureTier1', 'recency'],
  ephemeral: ['bm25', 'customTag', 'profileTag'],
  /* 段3/段4 加 vector：这两个是「竞争段」，正需要查询相关性。
     ⚠️ embedding 关闭时 vectorScore 缺失 → vectorWeight 返回 0 → 加 0 不改变总分，
        因此关闭状态下排序与改动前逐字节相同。 */
  mixed: ['bm25', 'customTag', 'profileTag', 'structureTier1', 'structureTier2', 'recency', 'vector'],
  fallback: ['bm25', 'customTag', 'profileTag', 'structureTier2', 'recency', 'vector']
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

/* ═══ RRF 融合（段1 底色 / 段3 竞争 / 段4 兜底） ═══
   动机：加法矩阵把「词法 BM25 / 向量余弦 / 自定义标签」三路信号塞进同一个线性配方
   （0~8 / 0~10 / 0~28），量纲靠手工配平、跨库不稳；RRF 只看各路【排名】，天然免校准，
   且让「多路共识」的候选自然浮出——实测竞争段 MRR 0.468 → 0.529（零注入代价）。

   设计要点：
   1) 本函数用于 bottom/mixed/fallback 三段的【取 top-k 前排序】；段2（临时记忆）
      保持原矩阵：临时记忆不落库、无向量，标签恒为预设标签，三路里只有词法一路，
      RRF 会退化为词法排序、与原矩阵等价。
   2) 各段的段内成员约束由上游池划分保证（段1 必须带第一档标签、段2 只收临时记忆），
      与排序函数无关——换 RRF 不会改变任何段的成员资格范围。
   3) 三路排名来源：bm25Weight(rank) / vectorScore / customTagWeightForRow；
      某路分数全为 0 时该路不产生名单（不贡献任何名次分），与「通道未命中」语义一致。
      段1 池通常只有标签路 + boost 有效（详见 selectBottomSegment 注释）。
   4) 身份与时间信号（structure/recency）按 Hindsight 做法降为【乘性 boost、±10% 封顶】——
      次要信号可以微调位次，但不能推翻相关性共识。
   5) 同分 tie-break 沿用原矩阵（bm25 rank 升序 → updated_at 降序），保证同分行为可预测。
   6) 常量 RRF_K=10：k 只调节「名次优势的强度」，不改变任何一路内的排序（1/(k+1) > 1/(k+2)
      对任意 k 恒成立）；k 越大名次差异越平（k=60 时第 1 名与第 5 名仅差 6%），k 越小头部越占优。
      取 10 的依据：需满足 k > 3（否则「两路各排第 5」赢不过「单路排第 1」，共识失效），
      且在前 20 名内保持足够区分度（k=10 时第 1/第 20 名相差 2.7 倍）。 */
const RRF_K = 10;
/* customTag 通道权重 0.5：它是「辅助信号」而非独立召回通道（其候选多为其他路已命中者），
   等权会与真正的召回路平分话语权；实测加权版 MRR 略高（0.514 → 0.529）。 */
const RRF_TAG_WEIGHT = 0.5;
/* 过期降权系数（v11）：validUntil 已过的记忆在四段排序里乘 0.5。
   取 0.5 而非更低：过期记忆是「历史结论」而非「噪声」——降权要足以让位于现状，
   但不能让它跌出候选（问「当时为什么这么定」时它才是答案）。
   只作用于已声明 validUntil 的行，未声明的行乘 1，行为与引入前完全一致。 */
const FACT_TIME_EXPIRED_FACTOR = 0.5;

function rrfRankRows(rows, segment, startedAt, customContext) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  /* 单路名单构造：只收该路分数 > 0 的行，按分数降序（同分沿用原 tie-break）。 */
  const buildRankList = (scoreOf) => rows
    .map((row) => ({ row, s: scoreOf(row) }))
    .filter((entry) => entry.s > 0)
    .sort((left, right) => right.s - left.s
      || Number(left.row.rank ?? 0) - Number(right.row.rank ?? 0)
      || Number(right.row.updated_at ?? 0) - Number(left.row.updated_at ?? 0))
    .map((entry) => entry.row);
  const lists = [
    { list: buildRankList((row) => bm25Weight(row.rank)), weight: 1 },
    { list: buildRankList((row) => Math.max(0, Number(row.vectorScore ?? 0))), weight: 1 },
    { list: buildRankList((row) => customTagWeightForRow(row, customContext)), weight: RRF_TAG_WEIGHT }
  ];
  const fused = new Map();
  for (const { list, weight } of lists) {
    list.forEach((row, position) => {
      const id = normalizePlainText(row.id, 128);
      if (!id) return;
      fused.set(id, (fused.get(id) ?? 0) + weight / (RRF_K + position + 1));
    });
  }
  const weights = structureWeightsOf(customContext);
  return rows
    .map((row) => {
      const id = normalizePlainText(row.id, 128);
      const consensus = fused.get(id) ?? 0;
      const structure = structureWeightForRow(row, customContext);
      /* 身份/时间归一化到 0~1 后取均值，映射为 ±10% 乘性 boost（中性值 = 0.5）。 */
      const identity = (structure.tier1 / Math.max(1, weights.max1) + structure.tier2 / STRUCTURE_TIER2_MAX_WEIGHT) / 2;
      const recency = recencyWeightForRow(row, startedAt) / 1.2;
      const boost = 1 + 0.1 * ((identity + recency) / 2 - 0.5);
      /* 过期降权：validUntil 已过的记忆是【历史结论】而非现状，降到 0.5 倍，
         但只降权、不剔除——问「当时为什么这么决定」时它仍是正确答案。
         未声明 validUntil 的记忆不受影响（乘 1），行为与引入本字段前一致。 */
      const expiry = isFactTimeExpired(row.valid_until, startedAt) ? FACT_TIME_EXPIRED_FACTOR : 1;
      return { row, finalRank: consensus * boost * expiry };
    })
    .sort((left, right) => right.finalRank - left.finalRank
      || Number(left.row.rank ?? 0) - Number(right.row.rank ?? 0)
      || Number(right.row.updated_at ?? 0) - Number(left.row.updated_at ?? 0));
}

/* 段1 底色补足的标签优先级：靠前的标签先占名额。
   语义是「身份越接近用户本人/项目本体越优先」，与底色池的设计意图一致。 */
const BOTTOM_BACKFILL_TAG_ORDER = Object.freeze([
  '用户画像', '项目画像', '项目架构', '用户偏好', '模块路径', '项目约束'
]);

/* 段1 准入的相关性判定。段1 候选池是两类来源的并集：
   ① bottomTagCandidateRows 直取来的行（rank 恒为 0，没有 FTS 信息）
   ② FTS 命中且恰好带第一档标签的行（rank < 0，本身就是强相关）
   因此先看 FTS 命中，再看标签维度：自定义标签（用户归纳的描述性标签）或当前画像
   标签命中。三者皆无才算与查询无关，交给补足阶段按标签优先级兜底。 */
function bottomRowIsRelevant(row, customContext, profileWeights, allowProfileTagFallback) {
  if (Number(row?.rank) < 0) return true;
  if (customTagWeightForRow(row, customContext) > 0) return true;
  return allowProfileTagFallback && tagWeightForRow(row, profileWeights) > 0;
}

/* 段1 构建：先按相关性准入并竞争，名额不足时按 BOTTOM_BACKFILL_TAG_ORDER
   逐标签补足（每标签 1 条，排除已入选），总量受 segment1 席位约束。

   为什么不再无条件直取：固定召回（pinned）已经承担了「与查询无关也要注入」的
   职责；段1 若继续无条件直取，会在一句话里塞进 5 条与当前需求无关的
   底色记忆，既稀释上下文又挤掉真正相关的条目。 */
function selectBottomSegment(poolRows, count, profile, startedAt, customContext, profileWeights, allowProfileTagFallback) {
  if (count <= 0 || poolRows.length === 0) return [];
  /* 取 top-k 前的排序：与段3/段4 统一用 RRF（准入与补足逻辑完全不变）。
     为什么段1 也能用：池成员由 recall() 的划分保证【必须带第一档标签】
     （rowTagNames 命中 STABLE_TIER1_TAGS 才进 bottomPool），身份约束是结构性的，
     不依赖排序函数；RRF 只决定池内先后，不可能把非身份记忆带进段1。
     池内可用信号：标签路（customTag 命中查询词）+ 身份/时间 boost；
     词法路与向量路在段1 池里通常为空（bottomTagCandidateRows 的 rank 恒为 0、
     该 SQL 不查 memory_embeddings），此时 RRF 退化为「按身份+时间排序」——
     与原矩阵的差异在于：原矩阵的 structureTier1 是 0~20 加分，RRF 里是 ±10% 微调，
     因此相关性（标签命中）的话语权相对上升。 */
  const ranked = rrfRankRows(poolRows, 'bottom', startedAt, customContext);
  const selected = [];
  const selectedIds = new Set();
  const push = (entry) => {
    const id = normalizePlainText(entry.row?.id, 128);
    if (!id || selectedIds.has(id)) return false;
    selectedIds.add(id);
    selected.push(entry.row);
    return true;
  };
  for (const entry of ranked) {
    if (selected.length >= count) break;
    if (!bottomRowIsRelevant(entry.row, customContext, profileWeights, allowProfileTagFallback)) continue;
    push(entry);
  }
  if (selected.length >= count) return selected;
  /* 补足：按标签优先级，每个标签取该标签下排序最前的一条（已选中的自然被排除）。 */
  for (const tag of BOTTOM_BACKFILL_TAG_ORDER) {
    if (selected.length >= count) break;
    const entry = ranked.find((item) => !selectedIds.has(normalizePlainText(item.row?.id, 128))
      && rowTagNames(item.row).includes(tag));
    if (entry !== undefined) push(entry);
  }
  return selected;
}

/* 结构分权重档位（供模块级函数复用）：与 recall() 内同一判据。
   抽成函数是为了让 rerankRecallRows / searchMemories 这些拿不到 this 的路径
   也能用【完全相同】的档位，避免同一份数据出现两套排序。 */
function structureWeightsForStore(store) {
  const usable = store?.embedder !== undefined && store?.embedder !== null && store?.embeddingBackfilling !== true;
  return usable
    ? { tier1: STRUCTURE_TIER1_WEIGHT_REDUCED, max1: STRUCTURE_TIER1_MAX_WEIGHT_REDUCED }
    : { tier1: STRUCTURE_TIER1_WEIGHT_FULL, max1: STRUCTURE_TIER1_MAX_WEIGHT_FULL };
}

function rerankRecallRows(rows, profile, startedAt = now(), queryText = '', structureWeights = undefined) {  /* 兼容入口（memory_search 等工具路径沿用）：全分量合成，等价于竞争段的完整矩阵。 */
  const customContext = customTagMatchContext(queryText);
  /* 结构分档位与召回路径保持一致（调用方传入；未传则退回降档默认值）。 */
  if (structureWeights !== undefined) customContext.structureWeights = structureWeights;
  return rankRowsBySegment(rows, 'mixed', profile, startedAt, customContext)
    .map(({ row, parts }) => ({
      ...row,
      recall_profile: profile,
      ...parts,
      /* final_rank 从 mixed 段矩阵动态求和，而不是手写分量列表——
         手写列表在新增分量（如 vector）时会静默漏掉，导致该入口与段竞争结果不一致。 */
      final_rank: sumSegmentParts(parts, 'mixed')
    }));
}

/* 按段矩阵把分量求和。所有"总分"都应经此计算，避免手写分量列表漏项。 */
function sumSegmentParts(parts, segmentKey) {
  const keys = SEGMENT_COMPONENT_KEYS[segmentKey] ?? SEGMENT_COMPONENT_KEYS.fallback;
  let total = 0;
  for (const key of keys) total += Number(parts?.[key]) || 0;
  return total;
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
    /* 事实时间必须随行透出：临时记忆在段2 被选中后走同一套 packHits →
       memoryFromRow(row) 读取，缺这两列会让蒸馏抽到的日期在注入时刻静默丢失。
       内存 item 是 camelCase，本函数产出的是「数据库行形态」，故此处转 snake_case。 */
    event_time: Number(item.eventTime) > 0 ? Number(item.eventTime) : null,
    valid_until: Number(item.validUntil) > 0 ? Number(item.validUntil) : null,
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

/* ── 事实时间字段（event_time / valid_until） ──
   event_time ：正文所述事实的【发生/生效】时刻，用于区分「事实何时发生」与
                「记录何时写入」（created_at/updated_at 只回答后者）。
   valid_until：事实的【预期失效】时刻，用于让「临时方案/本周内有效」这类记忆
                自然过期（召回降权，而非剔除——问历史时它仍是答案）。
   两列均可空：NULL = 未声明，读取侧一律按「无事实时间」处理，全链路行为与
   未引入本字段时一致（向后兼容，旧记忆零迁移成本）。
   时间语义一律按【本地时区】解释，与时间搜索的日/周/月窗口口径保持一致
   （Date.parse('YYYY-MM-DD') 会按 UTC 零点解析，东八区会整体偏移 8 小时）。 */
const FACT_TIME_MIN_MS = Date.UTC(1970, 0, 1);
const FACT_TIME_MAX_MS = Date.UTC(2100, 0, 1);
const FACT_TIME_DATE_ONLY_RE = /^(\d{4})\s*(?:年|-|\/|\.)\s*(\d{1,2})\s*(?:月|-|\/|\.)\s*(\d{1,2})\s*(?:日|号)?$/u;
/* 日期 + 时间（可省略秒）：2026-09-29 14:30 / 2026-09-29T14:30:45 / 2026年9月29日 14:30。
   时分必须显式给出——只有日期时走上面的日期分支（末尾含当日末刻判定），不做猜测。 */
const FACT_TIME_WITH_CLOCK_RE = /^(\d{4})\s*(?:年|-|\/|\.)\s*(\d{1,2})\s*(?:月|-|\/|\.)\s*(\d{1,2})\s*(?:日|号)?[\sT]+(\d{1,2})\s*[:：时]\s*(\d{1,2})(?:\s*[:：分]\s*(\d{1,2}))?\s*秒?$/u;

/* 事实时间的「整日」判定：当日零点或当日末刻都算「只声明到天」。
   显示层据此决定是否渲染时分——user 填「2026-09-29」不该看到「00:00」，
   validUntil 的当日末刻也不该显示成「23:59」。 */
function isFactTimeWholeDay(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return false;
  const date = new Date(ms);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const end = start + 86400000 - 1;
  return ms === start || ms === end;
}

/* 解析结果三态：undefined = 未声明（含 null/空串）；number = 有效毫秒；抛错 = 非法输入。
   非法输入显式报错而非静默忽略——静默会让「传了却没生效」变得极难排查。
   支持三种形态：毫秒数 / 纯日期（按 endOfDay 取当日零点或末刻）/ 日期+时间。 */
function parseFactTime(value, { label = '时间', endOfDay = false } = {}) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number' || (typeof value === 'string' && /^-?\d+$/u.test(value.trim()))) {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number) || number < FACT_TIME_MIN_MS || number >= FACT_TIME_MAX_MS) {
      throw new MemoryError('invalid-fact-time', `${label} out of range`, 400);
    }
    return number;
  }
  const text = normalizePlainText(value, 60);
  if (!text) return undefined;
  /* 日期 + 时间：时分秒齐全，不做 endOfDay 处理（用户已明确给出时刻）。
     用与纯日期同一套回读校验，拒绝 2026-02-30 14:30 这类越界日期。 */
  const withClock = text.match(FACT_TIME_WITH_CLOCK_RE);
  if (withClock) {
    const year = Number(withClock[1]);
    const month = Number(withClock[2]);
    const day = Number(withClock[3]);
    const hour = Number(withClock[4]);
    const minute = Number(withClock[5]);
    const second = withClock[6] === undefined ? 0 : Number(withClock[6]);
    if (hour > 23 || minute > 59 || second > 59) {
      throw new MemoryError('invalid-fact-time', `${label} has an out-of-range time`, 400);
    }
    const date = new Date(year, month - 1, day, hour, minute, second, 0);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      throw new MemoryError('invalid-fact-time', `${label} is not a valid calendar date`, 400);
    }
    return date.getTime();
  }
  const dayOnly = text.match(FACT_TIME_DATE_ONLY_RE);
  if (dayOnly) {
    const year = Number(dayOnly[1]);
    const month = Number(dayOnly[2]);
    const day = Number(dayOnly[3]);
    const date = new Date(year, month - 1, day,
      endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
    /* 用回读校验拒绝 2026-02-30 这类越界日期（Date 会静默进位到下月）。 */
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      throw new MemoryError('invalid-fact-time', `${label} is not a valid calendar date`, 400);
    }
    return date.getTime();
  }
  const ms = Date.parse(text);
  if (!Number.isFinite(ms) || ms < FACT_TIME_MIN_MS || ms >= FACT_TIME_MAX_MS) {
    throw new MemoryError('invalid-fact-time', `${label} is not a recognizable date/time`, 400);
  }
  return ms;
}

/* valid_until 的日期省略时间时取「当日 23:59:59.999」：人的直觉是
   「到 10-06 为止仍然有效」，而非 10-06 零点即失效。 */
function parseValidUntil(value) {
  return parseFactTime(value, { label: 'validUntil', endOfDay: true });
}

/* 交叉校验：失效不得早于生效（同为已声明值时）。 */
function assertFactTimeOrder(eventTime, validUntil) {
  if (eventTime === undefined || validUntil === undefined) return;
  if (validUntil < eventTime) {
    throw new MemoryError('invalid-fact-time', 'validUntil must not be earlier than eventTime', 400);
  }
}

/* 过期判定：只在 validUntil 已声明时才可能为真；未声明 = 永不过期。
   nowMs < validUntil 视为仍有效（日期型 validUntil 已按当日末刻解析）。 */
function isFactTimeExpired(validUntil, atMs = now()) {
  const value = Number(validUntil);
  if (!Number.isFinite(value) || value <= 0) return false;
  return Number(atMs) > value;
}

/* 替代截断：新记忆取代旧记忆时，给旧记忆打上「失效时刻」。
   时间来源优先级：新记忆的 event_time（事实何时生效，精确）→ 新记忆的 created_at
   （状态型新记忆没有事件时间，写入时刻是「旧事实至少在此刻已不成立」的保守上界）。
   只写 valid_until，不动 status——旧记忆仍是历史答案，只是排序降权（见 RRF boost）。
   已有更早 valid_until 的不覆盖（保留更早的失效时刻，避免反复替代把区间越推越远）。 */
function supersedeMemoryValidity(db, supersededId, newMemoryId, stamp) {
  const id = normalizePlainText(supersededId, 128);
  const sourceId = normalizePlainText(newMemoryId, 128);
  if (!id || !sourceId || id === sourceId) return 0;
  let cutoff = Number(stamp) || now();
  try {
    const source = db.prepare('SELECT event_time, created_at FROM memories WHERE id = ?').get(sourceId);
    const eventTime = Number(source?.event_time) > 0 ? Number(source.event_time) : 0;
    cutoff = eventTime > 0 ? eventTime : (Number(source?.created_at) > 0 ? Number(source.created_at) : cutoff);
  } catch {
    /* 读取失败就退回 stamp：截断宁可偏保守，也不能因为读不到而完全不截断。 */
  }
  const existing = db.prepare('SELECT valid_until FROM memories WHERE id = ?').get(id);
  const current = Number(existing?.valid_until) > 0 ? Number(existing.valid_until) : 0;
  if (current > 0 && current <= cutoff) return 0;
  return db.prepare('UPDATE memories SET valid_until = ? WHERE id = ?').run(cutoff, id).changes;
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
    pinned: Number(row.pinned) === 1,
    /* 事实时间：0 = 未声明（与 NULL 同义，读取侧一律当作「无」处理）。 */
    eventTime: Number(row.event_time) > 0 ? Number(row.event_time) : 0,
    validUntil: Number(row.valid_until) > 0 ? Number(row.valid_until) : 0,
    /* 记忆格式归属：'' = 无归属（旧记忆与纯文本记忆都是此值）。 */
    formatId: normalizePlainText(row.format_id, 128),
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
    pinned: memory.pinned === true,
    eventTime: Number(memory.eventTime) > 0 ? Number(memory.eventTime) : 0,
    validUntil: Number(memory.validUntil) > 0 ? Number(memory.validUntil) : 0,
    formatId: normalizePlainText(memory.formatId, 128),
    creationMethod: normalizeCreationMethod(memory.creationMethod)
  };
}

function renderManualMemoryInjection(hit) {
  const header = [
    '以下是手动注入的记忆。若与用户最新消息或显式指令冲突，以用户最新消息和显式指令为准。',
    '',
    '标注"已截断"的记忆仅含前缀；与当前任务相关时应调用 memory_read 工具（传对应 id）查看全文。',
    ''
  ];
  /* 与自动召回同口径：开启「注入时去掉 JSON 格式」的记忆也用块状结构。 */
  if (hit?.plainTextInjection === true) {
    return [
      ...header,
      '1.',
      '',
      renderMemoryMetadataBlock(hit),
      '',
      '【记忆正文】',
      '',
      hit.text || '',
      '',
      '---'
    ].join('\n').trim();
  }
  const tags = Array.isArray(hit.tags) && hit.tags.length > 0 ? hit.tags.join('、') : '未标记';
  const date = formatDateShort(hit.updatedAt);
  const factTime = factTimeLine(hit);
  return [
    ...header,
    `目录：${hit.directoryName || '未命名目录'}；标签：${tags}；更新：${date || '-'}${factTime ? `；${factTime}` : ''}`,
    hit.text || ''
  ].join('\n').trim();
}

function currentMemoryHitIds(session) {
  const messages = typeof session?.deriveMessages === 'function' ? session.deriveMessages() : [];
  const ids = existingMemoryHitIds(messages);
  /* 手动上下文不进入自动召回/小面板，但仍参与“是否已注入”的 ID 去重。 */
  for (const message of Array.isArray(messages) ? messages : []) {
    const source = message?.source;
    if (!hasMemorySource(source, MEMORY_MANUAL_SOURCE)) continue;
    for (const value of readMemoryHitIds(source)) {
      const id = normalizePlainText(String(value ?? ''), 128);
      if (id) ids.add(id);
    }
  }
  return ids;
}

/* 事实时间的展示：整日只显示日期（2026-09-29），带时分才显示到分钟（2026-09-29 14:30）。
   为什么不在整日时也补「00:00」：那是实现细节而非用户表达的信息——
   用户填「9-29」的意思是「9 月 29 日那天」，不是「9 月 29 日零点整」。
   validUntil 的当日末刻同理（补 23:59 会误导成「当天最后一分钟才失效」）。 */
function formatFactTime(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return '';
  if (isFactTimeWholeDay(ms)) return formatLocalDateShort(ms);
  return formatLocalDateTimeShort(ms);
}

/* 事实时间行的渲染（注入与手动注入共用）：只在已声明时出现，未声明不占体积。
   过期的 validUntil 显式标注「已过期」——让模型知道这是历史结论而非现状。
   ⚠️ 一律用本地口径（formatFactTime / formatLocalDateShort），不能用 formatDateShort
   （UTC 口径）：日期型输入按本地零点解析，若按 UTC 渲染东八区会整体回退一天。 */
function factTimeLine(hit, atMs = now()) {
  const parts = [];
  const eventTime = Number(hit?.eventTime) > 0 ? formatFactTime(hit.eventTime) : '';
  if (eventTime) parts.push(`事件：${eventTime}`);
  const validUntilValue = Number(hit?.validUntil) > 0 ? Number(hit.validUntil) : 0;
  if (validUntilValue > 0) {
    const expired = isFactTimeExpired(validUntilValue, atMs);
    parts.push(`有效至：${formatFactTime(validUntilValue)}${expired ? '（已过期）' : ''}`);
  }
  return parts.join('；');
}

/* 注入展示层：格式开启 injectPlainText 时，把已落库 JSON 渲染成字段文本。
   只改变模型看到的文本，不改 memories.body、格式校验、关系索引或搜索索引。
   ⚠️ 字段之间用【空行】分隔（而不是单换行）：注入文本最终按 Markdown 渲染，
   单换行会被折叠成空格、字段全挤成一行（实测「顾铁衣」那条）；
   空行是段落边界，能稳定保留字段分行。
   数组项逐行「- 」是连续列表项，不会被折叠，保持原样。
   字符串字段内部的多段空行原样保留（空行不是字段分隔符，字段边界只认已声明字段名）。 */
function renderFormatInjectionText(text, format) {
  const raw = String(text ?? '');
  if (format?.definition?.injectPlainText !== true) return raw;
  const marker = '\n…（该记忆已截断';
  const markerIndex = raw.indexOf(marker);
  const bodyText = markerIndex >= 0 ? raw.slice(0, markerIndex) : raw;
  const suffix = markerIndex >= 0 ? raw.slice(markerIndex) : '';
  let parsed;
  try { parsed = JSON.parse(stripCodeFence(bodyText)); } catch { return raw; }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return raw;
  const fields = Array.isArray(format.definition.fields) ? format.definition.fields : [];
  const order = Array.isArray(format.definition.order) && format.definition.order.length > 0
    ? format.definition.order.map((key) => String(key)).filter((key, index, values) => values.indexOf(key) === index)
    : fields.map((field) => String(field?.key ?? '')).filter(Boolean);
  const keys = [...order, ...Object.keys(parsed).filter((key) => !order.includes(key))];
  const blocks = [];
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(parsed, key)) continue;
    const value = parsed[key];
    if (Array.isArray(value)) {
      if (value.length === 0) { blocks.push(`${key}：[]`); continue; }
      blocks.push([`${key}：`, ...value.map((item) => `- ${String(item ?? '')}`)].join('\n'));
      continue;
    }
    if (typeof value === 'string' && value.includes('\n')) {
      blocks.push(`${key}：\n${value}`);
      continue;
    }
    blocks.push(`${key}：${value === null || value === undefined ? '' : String(value)}`);
  }
  if (blocks.length === 0) return raw;
  return blocks.join('\n\n') + suffix;
}

/* 块状元数据（仅 injectPlainText 开启时使用）：
   把「目录/标签/更新」一行式拆成带标签的条目，并显式声明「元数据不是正文事实」，
   避免模型把标签、项目名、记录时间当成记忆内容。
   事实时间即使为空也占一行，保持结构稳定（用户明确要求的形态）。 */
function renderMemoryMetadataBlock(hit) {
  const tags = Array.isArray(hit?.tags) && hit.tags.length > 0 ? hit.tags.join('、') : '未标记';
  const date = formatDateShort(hit?.updatedAt);
  const eventTime = Number(hit?.eventTime) > 0 ? formatFactTime(hit.eventTime) : '';
  const validUntilValue = Number(hit?.validUntil) > 0 ? Number(hit.validUntil) : 0;
  const validUntil = validUntilValue > 0
    ? `${formatFactTime(validUntilValue)}${isFactTimeExpired(validUntilValue) ? '（已过期）' : ''}`
    : '';
  /* 事实时间未声明就不列出该行（用户要求）：与旧 factTimeLine 同口径——
     空值不占体积；已声明才出现，过期的 validUntil 标注「已过期」。 */
  const lines = [
    '【记忆元数据】',
    `- 项目：${hit?.directoryName || '未命名目录'}`,
    `- 标签：${tags}`,
    `- 记忆更新时间：${date || '-'}`
  ];
  if (eventTime) lines.push(`- 事件发生时间：${eventTime}`);
  if (validUntil) lines.push(`- 事件有效时间：${validUntil}`);
  lines.push('', '注意：以上元数据只用于来源、作用域、检索和时效判断，不属于记忆事实正文。');
  return lines.join('\n');
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
    /* 「固定召回」标记不进注入正文：固定与否由召回管线决定（pinned 只影响
       候选与席位），不是记忆事实的一部分，写在正文里只会污染语义（用户要求去掉）。 */
    const prefix = `${index + 1}.`;
    /* 开启「注入时去掉 JSON 格式」的记忆用块状结构：
         序号 → 元数据块 → 正文块 → 分隔线；
       未开启的保持原一行式元数据 + 原正文，行为不变。 */
    if (hit.plainTextInjection === true) {
      lines.push(prefix);
      lines.push('');
      lines.push(renderMemoryMetadataBlock(hit));
      lines.push('');
      lines.push('【记忆正文】');
      /* 正文块标题与正文之间空一行：与字段间空行同理由 —— 避免 Markdown
         把「【记忆正文】」标题和第一个字段折叠到同一行（用户实测反馈）。 */
      lines.push('');
      lines.push(hit.text);
      lines.push('');
      lines.push('---');
      lines.push('');
      return;
    }
    const tags = hit.tags.length > 0 ? hit.tags.join('、') : '未标记';
    const date = formatDateShort(hit.updatedAt);
    const factTime = factTimeLine(hit);
    lines.push(`${prefix} 目录：${hit.directoryName || '未命名目录'}；标签：${tags}${date ? `；更新：${date}` : ''}${factTime ? `；${factTime}` : ''}`);    lines.push(hit.text);
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
    if (!hasMemorySource(source, MEMORY_CONTEXT_SOURCE)) continue;
    for (const idValue of readMemoryHitIds(source)) {
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
    if (!hasMemorySource(source, MEMORY_CONTEXT_SOURCE)) continue;
    for (const idValue of readMemoryHitIds(source)) {
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

/* JSON 结构感知限额（v12 起按【全部字段】限额，不再只限「内容」）：
   每个字段独立适用 contentChars 上限 —— string 超长截断、string[] 整体序列化超长截断。
   背景：自定义格式（角色类「外貌」、日记类「事件」等）的字段值同样可能很长，
   只限「内容」会让一条记忆的注入体积被任意单个字段撑爆（实测单字段 800+ 字符）。
   返回 { text, truncated, truncatedKeys }，truncatedKeys 是被截断的字段名（供注入标注）。
   ⚠️ 截断必须【在原 JSON 对象上就地替换字段值】，不能经 structuredContentBody 重组：
   重组走「无归属」分支会按固定键序重排整条正文 —— 实测「{日期,心情,内容}」被截断后
   会变成「{内容,日期,心情}」，注入文本与归属格式的键序不符。落库正文恒不被此函数改动。 */
function limitStructuredMemoryText(text, contentChars) {
  const raw = typeof text === 'string' ? text : String(text ?? '');
  let structured = parseStructuredMemoryBody(raw);
  /* v12.12 纯自定义字段 JSON（不含任何已知保留名）也要按字段截断：
     这类正文现在会以 JSON 落库（无归属 + 有字段区分），但 parseStructuredMemoryBody
     要求含已知保留名，故此处会返回 undefined 并退化成 raw.slice —— 把 JSON 从中间
     切断，用户看到残缺的「{ "名称": "沈青…」。
     这里补一次「宽松结构化」尝试（allowExtraOnly），成功则走下方的逐字段截断路径。 */
  if (structured === undefined && /^\s*[{[]/.test(raw)) {
    let parsedLoose;
    try { parsedLoose = JSON.parse(raw); } catch { parsedLoose = undefined; }
    if (parsedLoose !== null && typeof parsedLoose === 'object' && !Array.isArray(parsedLoose)
      && Object.keys(parsedLoose).length > 0) {
      structured = structuredMemoryFields(parsedLoose, { allowExtraOnly: true });
    }
  }
  if (structured !== undefined) {
    let object;
    try { object = JSON.parse(raw); } catch { object = undefined; }
    if (object !== null && typeof object === 'object' && !Array.isArray(object)) {
      /* 逐字段判定：值序列化后超限才截。string 直接切；数组整体切（保留 JSON 形态）。 */
      const truncatedKeys = [];
      for (const [key, value] of Object.entries(object)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
        if (typeof value === 'string') {
          if (value.length > contentChars) { object[key] = value.slice(0, contentChars); truncatedKeys.push(key); }
          continue;
        }
        if (Array.isArray(value)) {
          if (value.every((item) => typeof item === 'string')) {
            /* 数组按【元素累积】截断：逐个累加元素直到再放不下为止，闭合数组后仍是合法 JSON。
               ⚠️ 不能用 serialized.slice + ']' —— 那会把字符串元素从中间切断，
               产出非法 JSON（JSON.parse 直接抛异常，实测踩坑）。 */
            const parts = [];
            let used = 2; /* '[]' 的开销 */
            for (const item of value) {
              const cost = JSON.stringify(item).length + (parts.length > 0 ? 1 : 0);
              if (used + cost > contentChars) break;
              parts.push(item);
              used += cost;
            }
            /* 只有真的没放完才算截断：放得下的数组必须原样保留、不得标记。
               （此处曾有无条件 push 的 bug，把 3 字符的 ['楚兰亭'] 也标成被截。） */
            if (parts.length < value.length) {
              /* 一个元素都放不下（单元素本身就超限）：保底放一个被切过的元素，
                 保证「截断且合法」。切法沿用字符串截断（contentChars 预留引号开销）。 */
              if (parts.length === 0) {
                object[key] = [value[0].slice(0, Math.max(0, contentChars - 2))];
              } else {
                object[key] = parts;
              }
              truncatedKeys.push(key);
            }
          }
          continue;
        }
        /* 非字符串/数组的值（数字等，理论上不该出现在记忆正文）原样保留。 */
      }
      if (truncatedKeys.length === 0) return { text: raw, truncated: false };
      return { text: JSON.stringify(object, null, 2), truncated: true, truncatedKeys };
    }
    /* 原对象不可用（理论不可能）才退回旧的单字段重组路径。 */
    if (structured.content.length <= contentChars) return { text: raw, truncated: false };
    return {
      text: structuredContentBody(structured.paths, structured.symbols, structured.content.slice(0, contentChars), structured.pitfall, structured.extra),
      truncated: true, truncatedKeys: ['内容']
    };
  }
  if (raw.length <= contentChars) return { text: raw, truncated: false };
  return { text: raw.slice(0, contentChars), truncated: true, truncatedKeys: [] };
}

/* 注入侧包装：任一字段超限被截时追加 id + memory_read 提示（v12 起全部字段共享 500 限额）。 */
function truncateMemoryTextForInjection(id, text) {
  const { text: limited, truncated, truncatedKeys } = limitStructuredMemoryText(text, RECALL_ITEM_CONTENT_CHARS);
  if (!truncated) return { text: limited, truncated: false };
  const keys = Array.isArray(truncatedKeys) && truncatedKeys.length > 0
    ? `（截断字段：${truncatedKeys.join('、')}）`
    : '';
  return { text: `${limited}\n…（该记忆已截断${keys} · id: ${id} · 调用 memory_read 工具可查看全文）`, truncated: true };
}

function packHits(rows, maxItems = RECALL_MAX_ITEMS) {
  /* v9：四段席位已在上游选定，条数即数量边界；
     单条体积由注入截断保证（JSON 的位置/对象/踩坑/未知字段完整保留，仅 content 受限 + memory_read 提示）。
     segment 随行透传：bottom/ephemeral/mixed/fallback 为四段竞争结果，pinned 为四段后补入的固定召回。 */
  const hits = [];
  for (const row of rows) {
    if (hits.length >= maxItems) break;
    const item = memoryFromRow(row, row.persisted !== false);
    const { text, truncated } = truncateMemoryTextForInjection(item.id, item.text);
    /* vectorScore 随行透出：评分阶段已用它，这里一并带出以便观察/诊断
       （与 rank 同待遇；缺向量时该字段不出现，避免 undefined 噪声）。 */
    const hit = { ...item, text, truncated, pinned: row.pinned === true, rank: Number(row.rank ?? 0), segment: typeof row.segment === 'string' ? row.segment : '' };
    if (Number.isFinite(row.vectorScore)) hit.vectorScore = Number(row.vectorScore);
    hits.push(hit);
  }
  return hits;
}

function renderMemoryToolList(memories) {
  if (!Array.isArray(memories) || memories.length === 0) return '未找到记忆。';
  return memories.map((memory, index) => {
    const tags = Array.isArray(memory.tags) && memory.tags.length > 0 ? memory.tags.join('、') : '未标记';
    const date = formatDateShort(memory.updatedAt);
    const factTime = factTimeLine(memory);
    return `${index + 1}. ${memory.id} · ${memory.directoryName || '未命名目录'} · ${memory.status || 'inactive'} · ${tags}${date ? ` · ${date}` : ''}${factTime ? ` · ${factTime}` : ''}\n${memory.text || ''}`;
  }).join('\n\n');
}

/* 搜索结果的分簇渲染：把扁平列表翻译成「同源簇」。
   簇由关系边（共享文件/符号）在【本次命中集内部】做连通分量得出，
   每簇标注共同键 —— 把「为什么这几条相关」这个隐含在图结构里的事实显式写出来。

   ⚠️ 措辞约束：某条单成员簇只表示【本次结果里它没有同伴】，
   不代表全库孤立，所以标注为「本组内无同伴」而非「孤立」。 */
function renderClusteredMemories(memories, clusters) {
  if (!Array.isArray(memories) || memories.length === 0) return '未找到记忆。';
  const byId = new Map(memories.map((memory) => [String(memory.id), memory]));
  const list = Array.isArray(clusters) ? clusters : [];
  /* 没有聚类信息（或全部单条）时，回落原来的扁平渲染。 */
  const multi = list.filter((cluster) => Array.isArray(cluster?.memoryIds) && cluster.memoryIds.length >= 2);
  if (multi.length === 0) return renderMemoryToolList(memories);

  const lines = [`找到 ${memories.length} 条（按结构关联分为 ${list.length} 组）：`, ''];
  let index = 0;
  list.forEach((cluster, clusterIndex) => {
    const ids = Array.isArray(cluster?.memoryIds) ? cluster.memoryIds : [];
    if (ids.length === 0) return;
    const commonKeys = Array.isArray(cluster?.commonKeys) ? cluster.commonKeys : [];
    const shared = commonKeys.length > 0
      ? `共同：${commonKeys.map((key) => `${key.label}×${key.count}`).join('、')}`
      : '本组内无同伴';
    lines.push(`【组 ${clusterIndex + 1} · ${ids.length} 条】${shared}`);
    for (const id of ids) {
      const memory = byId.get(String(id));
      if (memory === undefined) continue;
      index += 1;
      const tags = Array.isArray(memory.tags) && memory.tags.length > 0 ? memory.tags.join('、') : '未标记';
      const date = formatDateShort(memory.updatedAt);
      lines.push(`${index}. ${memory.id} · ${memory.tags?.length ? tags : '未标记'}${date ? ` · ${date}` : ''}`);
      lines.push(`   ${truncateMiddle(String(memory.text ?? '').replace(/\s+/gu, ' '), 180)}`);
    }
    lines.push('');
  });
  /* 兜底：聚类遗漏的条目（理论上不会发生）附在末尾，避免静默丢结果。 */
  const shown = new Set(list.flatMap((cluster) => (Array.isArray(cluster?.memoryIds) ? cluster.memoryIds : [])).map(String));
  const missing = memories.filter((memory) => !shown.has(String(memory.id)));
  if (missing.length > 0) {
    lines.push(`【未分组 ${missing.length} 条】`);
    for (const memory of missing) {
      index += 1;
      lines.push(`${index}. ${memory.id}`);
      lines.push(`   ${truncateMiddle(String(memory.text ?? '').replace(/\s+/gu, ' '), 180)}`);
    }
  }
  return lines.join('\n').trim();
}

/* 关系检索结果的文本渲染。
   强调「关系类型 + 跳数」的可解释性 —— 这是关系边相对词法/向量的核心优势：
   词法只能说「因为词像」，关系能说「因为共享文件 X」。 */
function renderRelationResult(value) {
  const lines = [];
  const origin = Array.isArray(value?.origin) ? value.origin[0] : undefined;
  if (origin !== undefined) {
    lines.push(`起点：${origin.id} · ${origin.directoryName || '未命名目录'}`);
    lines.push(`   ${truncateMiddle(String(origin.text ?? '').replace(/\s+/gu, ' '), 120)}`);
    lines.push('');
  }
  const related = Array.isArray(value?.related) ? value.related : [];
  if (related.length === 0) return lines.join('\n').trim() || '未找到关联记忆。';
  const kindLabel = { same_file: '同文件', same_symbol: '同符号', same_tag: '同标签' };
  const relations = Array.isArray(value?.relations) ? value.relations : [];
  lines.push(`结构关联 ${related.length} 条：`);
  lines.push('');
  related.forEach((memory, index) => {
    const relation = relations.find((item) => item?.to === memory.id);
    const label = relation === undefined ? '关联' : (kindLabel[relation.kind] ?? relation.kind);
    const hop = Number.isSafeInteger(memory.hop) ? memory.hop : 1;
    const score = Number.isFinite(memory.relationScore) ? ` · 关系分 ${Number(memory.relationScore).toFixed(2)}` : '';
    const tags = Array.isArray(memory.tags) && memory.tags.length > 0 ? memory.tags.join('、') : '未标记';
    lines.push(`${index + 1}. [${label} · ${hop} 跳${score}] ${memory.id}`);
    lines.push(`   标签：${tags}`);
    lines.push(`   ${truncateMiddle(String(memory.text ?? '').replace(/\s+/gu, ' '), 160)}`);
  });
  return lines.join('\n');
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
 * 快照当时存活的记忆注入行，并以注入消息 source.sections 内的 snapshot 段
 * （注入时命中记忆的结构化内容，与注入正文 1:1）展开为条目。由此：
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
      if (!hasMemorySource(source, MEMORY_CONTEXT_SOURCE)) continue;
      /* 行内 hitIds 是该行实际内容的权威清单（遗留重写行的快照可能仍是旧全量），
         快照仅为这些 id 提供召回时文本。 */
      const snapshots = new Map();
      for (const hit of readMemorySnapshot(source)) {
        const id = normalizePlainText(String(hit?.id ?? ''), 128);
        if (id) snapshots.set(id, hit);
      }
      for (const idValue of readMemoryHitIds(source)) {
        const id = normalizePlainText(String(idValue ?? ''), 128);
        if (!id || hits.some((hit) => hit.id === id)) continue;
        const snapshot = snapshots.get(id);
        hits.push({ id, text: String(snapshot?.text ?? ''), directoryName: String(snapshot?.directoryName ?? ''), tags: Array.isArray(snapshot?.tags) ? snapshot.tags.map(String) : [], pinned: snapshot?.pinned === true, segment: typeof snapshot?.segment === 'string' ? snapshot.segment : '' });
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
      /* 记忆类工具调用本身不构成检索内容（否则每次记忆检索都会检索到"检索过记忆"）。 */
      if (ACTIVE_RECALL_TOOL_NAMES.has(name)) continue;
      const callId = normalizePlainText(event.data?.callId, 128);
      const args = normalizePlainText(event.data?.arguments, 1200);
      rows.push({ session, turn, role: 'tool-call', text: args ? `${name}\n${args}` : name, seq: Number(event.seq) || 0, time, callId });
    }
    /* tool/result 不收集：结果行在 scoreConversationRow 恒得 0 分、必被 searchConversations
       过滤（score <= 0 continue），收集它们只会白白付 textBlocks 解析成本
       （工具结果实测占会话体积 83%）。工具「请求」已保留，能定位"读过/改过什么"。 */
    if (event.type === 'turn/end' && activeTurn === event.data?.turn) activeTurn = undefined;
  }
  return rows;
}

function conversationRowDedupeKey(row) {
  const sessionId = String(row.session?.id ?? row.session?.header?.id ?? '');
  return `${sessionId}:${Number.isSafeInteger(row.turn) ? row.turn : -1}:${row.role}:${String(row.text || '').slice(0, 80)}`;
}

/* 相关度打分：精确子串命中 12 分，词元命中按词长 1~6 分累加。
   纯时间范围查询（无词元）返回 1 分，使时间过滤本身即可产出结果。 */
function scoreConversationRow(row, terms, queryText, timeRange) {
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
    scope: toolName === 'memory_search' ? (args.scope === 'enabled' ? 'enabled' : 'all') : undefined,
    status: toolName === 'memory_search' ? (args.status ?? 'active') : undefined,
    limit: clampToolLimit(args.limit,
      toolName === 'memory_search' ? MEMORY_TOOL_DEFAULT_ITEMS : CONVERSATION_SEARCH_DEFAULT_RESULTS,
      toolName === 'memory_search' ? MEMORY_TOOL_MAX_ITEMS : CONVERSATION_SEARCH_MAX_RESULTS),
    ...(toolName === 'conversation_search'
      ? { sessionLimit: clampToolLimit(args.sessionLimit,
        timeRange === undefined ? CONVERSATION_SEARCH_DEFAULT_SESSIONS : CONVERSATION_SEARCH_TIME_DEFAULT_SESSIONS,
        CONVERSATION_SEARCH_MAX_SESSIONS) }
      : {}),
    ...(toolName === 'memory_search' && args.scope === 'enabled'
      ? { sessionId: normalizeToolSessionId(args.sessionId, args.fallbackSessionId) }
      : {}),
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
  constructor(ctx, options = {}) {
    this.ctx = ctx;
    this.ephemeral = new Map();
    this.distillQueues = new Map();
    this.activeRecallByTurn = new Map();
    this.ephemeralBoundaryCache = new Map();
    /* 当前活跃的 (agent, turn)：由 agent/pre-step 钩子每步刷新。
       用途只有一个 —— 让 memory_add 的【工具参数描述】也能按本轮内容筛选格式清单。
       工具 schema 是在轮次开始前投影的（defineTextDescription 回调无参），
       故回调需要一个「本轮是谁」的引用才能取到转录；这是唯一可靠的来源。 */
    this.activeTurnRef = null;
    /* 每轮已写入的 memory_add 记录：key = `${sessionId}:${turn}`，value = memoryId。
       用途：拦截「同一轮拆成多次 memory_add」—— 一条记忆只对应一个格式实例，
       格式字段就是全部可写空间，放不下应并入字段或换格式，而不是再开一条。
       只保留最近若干轮（见 pruneMemoryAddByTurn），避免长会话无限增长。 */
    this.memoryAddByTurn = new Map();
    /* 每轮【生成前】已确定的格式：key = `${sessionId}:${turn}`，value = formatId（仅非代码类）。
       设计前提（用户明确要求）：格式必须在【生成记忆之前】确定，再用该格式驱动生成；
       不允许「先生成、再事后猜格式」—— 事后猜只能靠代码特征词，实测会被「自成一方【法】则」
       这类跨词误匹配骗到（判成代码类，把角色记忆包成 位置/对象/内容/踩坑 四键）。
       来源：selectFormatsForText 在拼提示词时已按本轮文本筛出候选，若恰好命中唯一一套
       非代码格式，那套格式就是本轮已确定的格式 —— 此处留存，写入路径直接采用。 */
    this.turnDeterminedFormat = new Map();
    this.dataDir = resolveDataDir(options);
    this.dbPath = join(this.dataDir, 'memory.sqlite');
    this.ftsAvailable = false;
    this.ftsMode = 'LIKE fallback';
    this.ftsRebuilding = false;
    this.ftsRebuildTimer = null;
    this.ftsRebuildRestart = false;
    this.ftsRebuildClosed = false;
    this.ftsRebuildCursor = '';
    this.ftsRebuildExpectedVersion = null;
    this.ftsPendingOps = new Map();
    /* 关系边的后台重建状态（照抄 FTS 重建的字段风格）。 */
    this.edgeRebuilding = false;
    this.edgeRebuildTimer = null;
    this.edgeRebuildCursor = '';
    /* Embedding 状态：embedder 实例（undefined=未初始化 / null=初始化失败）、
       写入队列、回填状态、挂起集合。 */
    this.embedder = undefined;
    this.embeddingWriteQueue = [];
    this.embeddingQueueTimer = null;
    this.embeddingQueueRunning = false;
    this.embeddingBackfilling = false;
    this.embeddingBackfillTimer = null;
    this.embeddingBackfillProgress = null;
    this.embeddingPendingOps = new Map();
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
      /* ── 记忆格式（与 memory_tags 同构）──
         builtin = 1 表示内置格式：仅代码类扩展字段可编辑、格式名称固定、默认字段不可改/不可删、格式本身不可删除（内置「代码类」即此）。
         status 提供激活/停用：只有 active 的格式才会出现在「蒸馏可选格式清单」里。
         definition 存字段定义 JSON（fields/order/indent），仅用于生成提示词，不用于写入校验。 */
      CREATE TABLE IF NOT EXISTS memory_formats (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        builtin INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
        definition TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        directory_id TEXT NOT NULL REFERENCES memory_directories(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active', 'inactive')),
        content_hash TEXT NOT NULL,
        creation_method TEXT NOT NULL DEFAULT '' CHECK(creation_method IN ('', 'manual', 'auto-distill', 'manual-distill', 'memory_add', 'import')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_recalled_at INTEGER,
        pinned INTEGER NOT NULL DEFAULT 0,
        event_time INTEGER,
        valid_until INTEGER,
        format_id TEXT NOT NULL DEFAULT ''
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
      CREATE TABLE IF NOT EXISTS memory_revisions (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        text TEXT NOT NULL,
        hash TEXT NOT NULL,
        status TEXT,
        replaced_at INTEGER NOT NULL,
        replaced_by TEXT NOT NULL DEFAULT 'manual'
      );
      CREATE INDEX IF NOT EXISTS idx_memory_activity_logs_created ON memory_activity_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_memory_activity_logs_kind_created ON memory_activity_logs(kind, created_at);
      CREATE INDEX IF NOT EXISTS idx_memory_revisions_memory ON memory_revisions(memory_id, replaced_at DESC);
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
      /* ── 关系边（memory_relate 用）──
         from_id/to_id 双向各存一行，便于按 from 查；随 memories 删除级联。
         注：删除路径另有显式清理（dropMemoryEdges），不单纯依赖级联。 */
      CREATE TABLE IF NOT EXISTS memory_edges (
        from_id    TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        to_id      TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        kind       TEXT NOT NULL CHECK(kind IN ('same_file','same_symbol','same_tag')),
        weight     REAL NOT NULL DEFAULT 1.0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(from_id, to_id, kind)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_edges_from ON memory_edges(from_id, kind);
      CREATE INDEX IF NOT EXISTS idx_memory_edges_to ON memory_edges(to_id, kind);
      /* 倒排键表：memory → 键（file/symbol/tag）。
         作用：把「找共享同一键的同伴」从全表扫降为索引查。
         ⚠️ 全量重建时必须「一次查询 + JS 分组」，禁止逐键 SQL 查询
            （实测：逐键查询 10000 条需 37s，一次查询仅 211ms，差 161 倍）。 */
      CREATE TABLE IF NOT EXISTS memory_edge_keys (
        memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        kind      TEXT NOT NULL CHECK(kind IN ('file','symbol','tag')),
        key       TEXT NOT NULL,
        PRIMARY KEY(memory_id, kind, key)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_edge_keys_lookup ON memory_edge_keys(kind, key);
      /* ── 记忆向量（embedding 语义检索用）──
         独立表：memories 表有 10 处 SELECT m.*，把 1024 维 BLOB（4KB/条）放进去
         会让每次召回/搜索/列表都多读 4KB×N（10000 条 = 39MB），必须隔离。
         content_hash：正文指纹（判断正文是否变化）
         input_hash  ：embedding 输入指纹（含标签/目录名）——⚠️ 只比 content_hash 会漏掉
                       「正文没变但标签变了」的情况，导致向量过期而不自知
         model       ：模型指纹 model#dim，换模型/换维度时全部不可混算 */
      CREATE TABLE IF NOT EXISTS memory_embeddings (
        memory_id    TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
        content_hash TEXT NOT NULL,
        input_hash   TEXT NOT NULL,
        embedding    BLOB NOT NULL,
        model        TEXT NOT NULL,
        dim          INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_embeddings_model ON memory_embeddings(model);
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
    /* 固定召回列迁移：旧库补默认 0（不固定），已有记忆行为不变。 */
    if (memoryColumns.length > 0 && !memoryColumns.includes('pinned')) {
      this.db.exec('ALTER TABLE memories ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
    }
    /* 事实时间列迁移（v11）：event_time = 正文所述事实的发生/生效时刻，
       valid_until = 事实预期失效时刻；两列均可空，NULL 表示「未声明」，
       留空时全链路行为与未引入前完全一致（读取侧一律按未声明处理）。 */
    if (memoryColumns.length > 0 && !memoryColumns.includes('event_time')) {
      this.db.exec('ALTER TABLE memories ADD COLUMN event_time INTEGER');
    }
    if (memoryColumns.length > 0 && !memoryColumns.includes('valid_until')) {
      this.db.exec('ALTER TABLE memories ADD COLUMN valid_until INTEGER');
    }
    /* 记忆格式归属列（v12）：format_id 记录这条记忆按哪套记忆格式写入。
       '' = 无归属（与 creation_method 的空串惯例同构），旧记忆添加列后自动即为 ''，
       行为与引入前完全一致（读取侧一律按「无归属」处理，回退旧的「对象+内容」判定）。
       'fmt-code' = 内置代码类，'fmt-<uuid>' = 自定义格式（保持现有字符串主键不变）。 */
    if (memoryColumns.length > 0 && !memoryColumns.includes('format_id')) {
      this.db.exec("ALTER TABLE memories ADD COLUMN format_id TEXT NOT NULL DEFAULT ''");
    }
    /* 旧库默认空；非法历史值收敛为空而非猜测来源。 */
    this.db.prepare("UPDATE memories SET creation_method = '' WHERE creation_method NOT IN ('', 'manual', 'auto-distill', 'manual-distill', 'memory_add', 'import')").run();
    /* 旧库默认空；若历史测试/手工写入过非法值，收敛为空而非猜测来源。 */
    this.db.prepare("UPDATE memories SET creation_method = '' WHERE creation_method NOT IN ('', 'manual', 'auto-distill', 'manual-distill', 'memory_add', 'import')").run();
    this.ensureMemoryStatusSchema();
    this.ensureMemoryHashSchema();
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
    this.ensurePresetFormats();
    this.cleanupActivityLogs();
    const repairResult = this.repairMemoryPathEscapes();
    this.initFts();
    /* 关系边初始化放在最后：repairMemoryPathEscapes 会静默改写正文（且不经过
       reindexMemory），所以边必须在它之后重建，否则会基于旧正文建边。 */
    this.initMemoryEdges(repairResult);
    /* 向量初始化：同样在修复之后；内部三层判断，稳态零 API 调用。 */
    this.initMemoryEmbeddings();
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
          content_hash TEXT NOT NULL,
          creation_method TEXT NOT NULL DEFAULT '' CHECK(creation_method IN ('', 'manual', 'auto-distill', 'manual-distill', 'memory_add', 'import')),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          last_recalled_at INTEGER,
          pinned INTEGER NOT NULL DEFAULT 0,
          event_time INTEGER,
          valid_until INTEGER,
          format_id TEXT NOT NULL DEFAULT ''
        );
        INSERT INTO memories_migrated (id, directory_id, body, status, content_hash, creation_method, created_at, updated_at, last_recalled_at, pinned, event_time, valid_until, format_id)
          SELECT id, directory_id, body, CASE WHEN status = 'active' THEN 'active' ELSE 'inactive' END, content_hash, creation_method, created_at, updated_at, last_recalled_at, COALESCE(pinned, 0), event_time, valid_until, COALESCE(format_id, '') FROM memories;
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

  /* content_hash 按记忆项目唯一，而非全库唯一。旧库的 inline UNIQUE 无法用 DROP INDEX 移除，
     因此复用安全表重建模式迁移；现有库此前全局唯一，不会有同项目重复值。 */
  ensureMemoryHashSchema() {
    const row = this.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memories'").get();
    const sql = typeof row?.sql === 'string' ? row.sql : '';
    /* 列定义内任意位置出现 UNIQUE 即视为旧全局唯一约束（容忍 NOT NULL/UNIQUE 顺序差异）。 */
    if (!/content_hash[^,\n]*UNIQUE/i.test(sql)) {
      this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_directory_hash ON memories(directory_id, content_hash)');
      return;
    }
    this.db.exec('PRAGMA foreign_keys = OFF');
    try {
      this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE memories_scoped_hash (
          id TEXT PRIMARY KEY,
          directory_id TEXT NOT NULL REFERENCES memory_directories(id) ON DELETE CASCADE,
          body TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('active', 'inactive')),
          content_hash TEXT NOT NULL,
          creation_method TEXT NOT NULL DEFAULT '' CHECK(creation_method IN ('', 'manual', 'auto-distill', 'manual-distill', 'memory_add', 'import')),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          last_recalled_at INTEGER,
          pinned INTEGER NOT NULL DEFAULT 0,
          event_time INTEGER,
          valid_until INTEGER,
          format_id TEXT NOT NULL DEFAULT ''
        );
        INSERT INTO memories_scoped_hash (id, directory_id, body, status, content_hash, creation_method, created_at, updated_at, last_recalled_at, pinned, event_time, valid_until, format_id)
          SELECT id, directory_id, body, status, content_hash, creation_method, created_at, updated_at, last_recalled_at, pinned, event_time, valid_until, COALESCE(format_id, '') FROM memories;
        DROP TABLE memories;
        ALTER TABLE memories_scoped_hash RENAME TO memories;
        CREATE INDEX IF NOT EXISTS idx_memories_directory_status ON memories(directory_id, status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_memories_hash ON memories(content_hash);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_directory_hash ON memories(directory_id, content_hash);
        COMMIT;
      `);
    } catch (error) {
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

  /* 内置格式预置：照 ensurePresetTags 的双语句模式（先 OR IGNORE 插入，再 UPDATE 归位）。
     用固定 id 而非随机 id：内置「代码类」的 id 要在提示词与客户端快照里稳定可比。
     启动时只归位 builtin，不覆盖 definition（保留用户编辑过的名称与扩展字段）；
     预置字段（含「位置」必需）以 MEMORY_PRESET_FORMATS 常量为准，首次插入时写入。
     ⚠️ 启动【不得重置 status】（v12.15）：v12.13 起内置「代码类」的状态已可编辑，
     而此处原为 `SET builtin = 1, status = 'active'` —— 用户停用后一重启就被强行改回激活
     （实测反馈「内置的记忆格式，状态停用后，重启 dsh 会自动变为激活状态」）。
     这与标签的处理【有意不同】：预设标签本就只读（preset-tag-readonly），强制 active 是对的；
     而格式状态是可编辑的用户数据，必须尊重其现值。status 只由 setFormatStatus 变更。 */
  ensurePresetFormats() {
    const stamp = now();
    const insert = this.db.prepare('INSERT OR IGNORE INTO memory_formats (id, name, builtin, status, definition, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?)');
    const update = this.db.prepare('UPDATE memory_formats SET builtin = 1, updated_at = max(updated_at, ?) WHERE id = ?');
    for (const format of MEMORY_PRESET_FORMATS) {
      /* 首次插入用 active；已存在时 update 不碰 status，保留用户设置。 */
      insert.run(format.id, format.name, 'active', JSON.stringify(format.definition), stamp, stamp);
      update.run(stamp, format.id);
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

  recallSettings() {
    const raw = this.getSetting(MEMORY_SETTING_RECALL_SETTINGS);
    if (!raw) return DEFAULT_RECALL_SETTINGS;
    try {
      return normalizeRecallSettings(JSON.parse(raw), { stored: true });
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] invalid stored recall settings ignored:`, error);
      return DEFAULT_RECALL_SETTINGS;
    }
  }

  setRecallSettings(value) {
    const settings = normalizeRecallSettings(value);
    this.setSetting(MEMORY_SETTING_RECALL_SETTINGS, JSON.stringify(settings));
    return settings;
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

  /* 存量修复：折叠「位置」路径里累积的转义反斜杠（记忆 JSON 注入被模型回抄后再蒸馏，
     每轮翻倍）。body 有变化才写回；规范化后与同项目其他记忆完全重复的行直接删除
     （项目+content_hash 唯一约束）。在 initFts 之前执行，FTS 直接按修复后的 body 建索引。 */
  repairMemoryPathEscapes() {
    let repaired = 0;
    let removed = 0;
    try {
      const rows = this.db.prepare('SELECT id, directory_id, body FROM memories').all();
      for (const row of rows) {
        const parsed = parseStructuredMemoryBodyOnce(row.body);
        if (parsed === undefined) continue;
        const paths = parsed.paths.map(collapsePathBackslashes);
        if (paths.length === 0 || paths.every((value, index) => value === parsed.paths[index])) continue;
        /* 与 limitStructuredMemoryText 同理：在原 JSON 对象上就地替换「位置」值，
           不经 structuredContentBody 重组 —— 重组走「无归属」分支会重排键序，
           破坏归属格式的字段顺序（重启修复不该顺手改写正文形态）。 */
        let body;
        try {
          const object = JSON.parse(row.body);
          if (object !== null && typeof object === 'object' && !Array.isArray(object)) {
            const pathsKey = ['位置', 'paths'].find((key) => Object.prototype.hasOwnProperty.call(object, key));
            if (pathsKey !== undefined) {
              object[pathsKey] = paths;
              body = JSON.stringify(object, null, 2);
            }
          }
        } catch {}
        if (body === undefined) {
          body = structuredContentBody(paths, parsed.symbols, parsed.content, parsed.pitfall, parsed.extra);
        }
        if (body === row.body) continue;
        const hash = memoryHash(body);
        const duplicateId = this.persistentByHash(hash, row.directory_id);
        if (duplicateId !== undefined && duplicateId !== row.id) {
          this.db.prepare('DELETE FROM memory_tag_links WHERE memory_id = ?').run(row.id);
          this.db.prepare('DELETE FROM memory_fts WHERE id = ?').run(row.id);
          this.dropMemoryEdges(row.id);
          this.db.prepare('DELETE FROM memories WHERE id = ?').run(row.id);
          removed += 1;
          continue;
        }
        try {
          this.db.prepare('UPDATE memories SET body = ?, content_hash = ? WHERE id = ?').run(body, hash, row.id);
          repaired += 1;
        } catch {
          /* 唯一约束冲突：规范化后与其他行完全重复，按重复删除（等价去重）。 */
          this.db.prepare('DELETE FROM memory_tag_links WHERE memory_id = ?').run(row.id);
          this.db.prepare('DELETE FROM memory_fts WHERE id = ?').run(row.id);
          this.dropMemoryEdges(row.id);
          this.db.prepare('DELETE FROM memories WHERE id = ?').run(row.id);
          removed += 1;
        }
      }
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory path escape repair failed: ${String(error?.message ?? error)}`);
      return { repaired: 0, removed: 0, failed: true };
    }
    if (repaired > 0 || removed > 0) this.ctx.logger?.info?.(`[${PLUGIN_NAME}] memory path escape repair: ${repaired} repaired, ${removed} duplicates removed`);
    /* 返回值供 initMemoryEdges 判断：本次有实际改写时，边必须全量重建
       （本方法直接 UPDATE body，不经过 reindexMemory，边不会自动同步）。 */
    return { repaired, removed };
  }

  cleanupActivityLogs() {
    try {
      const cutoff = now() - ACTIVITY_RETENTION_MS;
      this.db.prepare('DELETE FROM memory_activity_logs WHERE created_at < ?').run(cutoff);
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] activity log cleanup failed:`, error);
    }
  }

  /* ══════════════════════════════════════════════════════════════
     关系边（memory_relate）：从 `位置`/`对象` 共享推导记忆间关系。
     三条性能红线（均有实测依据）：
     ① 全量重建必须「一次查询 + JS 分组」，禁止逐键 SQL 查询
        （实测：逐键 10000 条需 37s vs 一次查询 211ms，差 161 倍）；
     ② 单条重建挂载在 reindexMemory 的【早退分支之前】，
        否则 FTS 重建期间边会失效；
     ③ 标签边默认关闭（实测标签边 448 : 结构边 48 = 9:1，会淹没结构边）。
     ══════════════════════════════════════════════════════════════ */

  /* 标签边开关：默认关。开启后 hub 度数会显著上升，度数惩罚失效。 */
  edgeTagEdgesEnabled() {
    try {
      return this.getSetting(MEMORY_SETTING_EDGE_TAG_EDGES) === 'true';
    } catch {
      return false;
    }
  }

  setEdgeTagEdges(enabled) {
    this.setSetting(MEMORY_SETTING_EDGE_TAG_EDGES, enabled === true ? 'true' : 'false');
  }

  /* 单条记忆的标签名列表（边重建时可选使用）。 */
  tagNamesOfMemory(memoryId) {
    const id = normalizePlainText(memoryId, 128);
    if (!id) return [];
    try {
      return this.db.prepare(`
        SELECT t.name AS name FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id
        WHERE l.memory_id = ? AND t.status = 'active'`).all(id).map((r) => r.name).filter(Boolean);
    } catch {
      return [];
    }
  }

  /* 删除单条记忆的全部关系数据。三处 DELETE FROM memories 都要调用它：
     不单纯依赖 ON DELETE CASCADE（现有代码对级联也不完全信任，
     例如删除时手工清理 memory_tag_links / memory_fts）。 */
  dropMemoryEdges(memoryId) {
    const id = normalizePlainText(memoryId, 128);
    if (!id) return;
    try {
      this.db.prepare('DELETE FROM memory_edges WHERE from_id = ? OR to_id = ?').run(id, id);
      this.db.prepare('DELETE FROM memory_edge_keys WHERE memory_id = ?').run(id);
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory edge drop failed for ${id}:`, error);
    }
  }

  /* 单条记忆的边重建：幂等（先删后建）。
     纯文本记忆（无 `位置`/`对象`）直接返回，不建任何边。 */
  reindexMemoryEdges(memoryId) {
    const id = normalizePlainText(memoryId, 128);
    if (!id) return;
    try {
      /* 更新时同时清除入/出边，避免旧键在对端留下幽灵关系。 */
      this.dropMemoryEdges(id);
      const row = this.db.prepare('SELECT body, status FROM memories WHERE id = ?').get(id);
      if (row === undefined || row.status !== 'active') return;
      const parsed = parseStructuredMemoryBody(row.body);
      if (parsed === undefined) return;
      const includeTag = this.edgeTagEdgesEnabled();
      const insertKey = this.db.prepare('INSERT OR REPLACE INTO memory_edge_keys (memory_id, kind, key) VALUES (?, ?, ?)');
      this.db.exec('BEGIN');
      try {
        for (const value of parsed.paths) {
          const key = normalizeEdgeKey(value);
          if (key.length >= 2 && key.length <= 512) insertKey.run(id, 'file', key);
        }
        for (const value of parsed.symbols) {
          const key = normalizePlainText(value, 512).toLowerCase();
          if (key.length >= 2) insertKey.run(id, 'symbol', key);
        }
        if (includeTag) {
          for (const tag of this.tagNamesOfMemory(id)) {
            const key = normalizeTagName(tag);
            if (key.length >= 2) insertKey.run(id, 'tag', key);
          }
        }
        this.db.exec('COMMIT');
      } catch (error) {
        try { this.db.exec('ROLLBACK'); } catch { /* no active transaction */ }
        throw error;
      }
      this.linkEdgesFromKeys(id);
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory edge reindex failed for ${id}:`, error);
    }
  }

  /* 据倒排键表给单条记忆挂边（双向各一行）。
     单条记忆的键数很少（实测 1~10 个），故此处逐键查询可接受
     （10 次 × 约 116µs 固定开销 ≈ 1.2ms）。全量重建才必须用一次查询。 */
  linkEdgesFromKeys(memoryId) {
    const id = normalizePlainText(memoryId, 128);
    if (!id) return;
    const includeTag = this.edgeTagEdgesEnabled();
    const kindToEdge = { file: 'same_file', symbol: 'same_symbol', tag: 'same_tag' };
    const keys = this.db.prepare('SELECT kind, key FROM memory_edge_keys WHERE memory_id = ?').all(id);
    if (keys.length === 0) return;
    const lookup = this.db.prepare('SELECT memory_id FROM memory_edge_keys WHERE kind = ? AND key = ? AND memory_id != ?');
    const insertEdge = this.db.prepare(
      'INSERT OR REPLACE INTO memory_edges (from_id, to_id, kind, weight, updated_at) VALUES (?, ?, ?, ?, ?)');
    const stamp = now();
    this.db.exec('BEGIN');
    try {
      for (const { kind, key } of keys) {
        if (kind === 'tag' && !includeTag) continue;
        const edgeKind = kindToEdge[kind];
        if (edgeKind === undefined) continue;
        const weight = edgeWeightOf(edgeKind);
        for (const peer of lookup.all(kind, key, id)) {
          const peerId = normalizePlainText(peer.memory_id, 128);
          if (!peerId || peerId === id) continue;
          insertEdge.run(id, peerId, edgeKind, weight, stamp);
          insertEdge.run(peerId, id, edgeKind, weight, stamp);
        }
      }
      this.db.exec('COMMIT');
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* no active transaction */ }
      throw error;
    }
  }

  /* 全量重建所有边。
     ⚠️ 性能关键：必须「一次查询 + JS 分组」。
     实测（真实长尾共享语料，10000 条 / 约 4 万条边）：
       逐键查询 37,287ms  →  一次查询 211ms（161× 加速）
     根因：node:sqlite 的 prepare().all() 每次约 116µs 固定开销，
          瓶颈是 SQL 调用次数而非数据量（拆解实验：纯 INSERT 仅占 1%）。 */
  rebuildAllMemoryEdges() {
    const startedAt = now();
    try {
      const rows = this.db.prepare('SELECT id, body FROM memories WHERE status = ?').all('active');
      const includeTag = this.edgeTagEdgesEnabled();
      this.db.exec('DELETE FROM memory_edges');
      this.db.exec('DELETE FROM memory_edge_keys');

      /* ① 建倒排键 */
      const parsed = new Map();
      const insertKey = this.db.prepare('INSERT OR REPLACE INTO memory_edge_keys (memory_id, kind, key) VALUES (?, ?, ?)');
      this.db.exec('BEGIN');
      try {
        for (const row of rows) {
          const body = parseStructuredMemoryBody(row.body);
          parsed.set(row.id, body);
          if (body === undefined) continue;
          for (const value of body.paths) {
            const key = normalizeEdgeKey(value);
            if (key.length >= 2 && key.length <= 512) insertKey.run(row.id, 'file', key);
          }
          for (const value of body.symbols) {
            const key = normalizePlainText(value, 512).toLowerCase();
            if (key.length >= 2) insertKey.run(row.id, 'symbol', key);
          }
        }
        this.db.exec('COMMIT');
      } catch (error) {
        try { this.db.exec('ROLLBACK'); } catch { /* no active transaction */ }
        throw error;
      }
      if (includeTag) {
        const linkRows = this.db.prepare(`
          SELECT l.memory_id AS memory_id, t.name AS name FROM memory_tag_links l
          JOIN memory_tags t ON t.id = l.tag_id
          JOIN memories m ON m.id = l.memory_id
          WHERE t.status = 'active' AND m.status = 'active'`).all();
        this.db.exec('BEGIN');
        try {
          for (const link of linkRows) {
            const key = normalizeTagName(link.name);
            if (key.length >= 2) insertKey.run(link.memory_id, 'tag', key);
          }
          this.db.exec('COMMIT');
        } catch (error) {
          try { this.db.exec('ROLLBACK'); } catch { /* no active transaction */ }
          throw error;
        }
      }

      /* ② ★ 一次查询取回全部键，在 JS 里分组（161× 加速的来源） */
      const keyIndex = new Map();
      for (const row of this.db.prepare('SELECT memory_id, kind, key FROM memory_edge_keys').all()) {
        const composite = `${row.kind}\u001f${row.key}`;
        const bucket = keyIndex.get(composite);
        if (bucket === undefined) keyIndex.set(composite, [row.memory_id]);
        else bucket.push(row.memory_id);
      }

      /* ③ 内存内配对 + 批量插边 */
      const stamp = now();
      const buffer = [];
      let edgeCount = 0;
      const flush = () => {
        if (buffer.length === 0) return;
        const values = buffer.map(() => '(?,?,?,?,?)').join(', ');
        this.db.prepare(`INSERT OR REPLACE INTO memory_edges (from_id, to_id, kind, weight, updated_at) VALUES ${values}`)
          .run(...buffer.flat());
        buffer.length = 0;
      };
      this.db.exec('BEGIN');
      try {
        for (const row of rows) {
          const body = parsed.get(row.id);
          if (body === undefined) continue;
          const ownKeys = [
            ...body.paths.map((value) => ['file', normalizeEdgeKey(value)]),
            ...body.symbols.map((value) => ['symbol', normalizePlainText(value, 512).toLowerCase()])
          ];
          for (const [kind, key] of ownKeys) {
            if (key.length < 2) continue;
            const peers = keyIndex.get(`${kind}\u001f${key}`);
            if (peers === undefined) continue;
            const edgeKind = kind === 'file' ? 'same_file' : 'same_symbol';
            const weight = edgeWeightOf(edgeKind);
            for (const peer of peers) {
              if (peer === row.id) continue;
              buffer.push([row.id, peer, edgeKind, weight, stamp]);
              edgeCount += 1;
              if (buffer.length >= 500) flush();
            }
          }
        }
        flush();
        this.db.exec('COMMIT');
      } catch (error) {
        try { this.db.exec('ROLLBACK'); } catch { /* no active transaction */ }
        throw error;
      }

      this.setSetting(MEMORY_SETTING_EDGE_INDEX_VERSION, MEMORY_EDGE_INDEX_VERSION);
      const elapsedMs = now() - startedAt;
      this.ctx.logger?.info?.(`[${PLUGIN_NAME}] memory edges rebuilt: ${rows.length} memories, ${edgeCount} edges, ${elapsedMs}ms`);
      return { memories: rows.length, edges: edgeCount, elapsedMs };
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory edge rebuild failed:`, error);
      return { memories: 0, edges: 0, failed: true, error: String(error?.message ?? error) };
    }
  }

  /* 启动期边初始化。
     惰性策略：版本匹配且已有边 → 视为一致，直接跳过（稳态启动零成本）。
     首次启用或索引版本变化时全量重建；路径存量修复也会强制重建。 */
  initMemoryEdges(repairResult) {
    try {
      const count = Number(this.db.prepare('SELECT COUNT(*) AS c FROM memories WHERE status = ?').get('active')?.c) || 0;
      const existing = Number(this.db.prepare('SELECT COUNT(*) AS c FROM memory_edges').get()?.c) || 0;
      const versionChanged = this.getSetting(MEMORY_SETTING_EDGE_INDEX_VERSION) !== MEMORY_EDGE_INDEX_VERSION;
      const repaired = Number(repairResult?.repaired) || 0;
      const removed = Number(repairResult?.removed) || 0;
      if (versionChanged || repaired > 0 || removed > 0) {
        if (count <= MEMORY_EDGE_SYNC_REBUILD_MAX) this.rebuildAllMemoryEdges();
        else this.startEdgeRebuild();
        return;
      }
      if (count === 0) {
        if (existing > 0) this.rebuildAllMemoryEdges();
        return;
      }
      if (existing > 0) return;
      if (count <= MEMORY_EDGE_SYNC_REBUILD_MAX) {
        this.rebuildAllMemoryEdges();
        return;
      }
      this.startEdgeRebuild();
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory edge init failed:`, error);
    }
  }

  /* 后台分批重建：照抄 FTS 的 startFtsRebuild 模式（不阻塞启动）。 */
  startEdgeRebuild() {
    this.edgeRebuilding = true;
    this.edgeRebuildCursor = '';
    try {
      /* 后台全量重建必须先清掉旧入边和非活动节点残留键。 */
      this.db.exec('DELETE FROM memory_edges');
      this.db.exec('DELETE FROM memory_edge_keys');
      this.edgeRebuildTimer = setTimeout(() => this.runEdgeRebuildBatch(), 0);
    } catch (error) {
      this.edgeRebuilding = false;
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory edge rebuild start failed:`, error);
    }
  }

  /* 后台分批：每批 MEMORY_EDGE_REBUILD_BATCH_SIZE 行。
     实测批次 200 时全部批次 < 16ms（一帧），用户无感。 */
  runEdgeRebuildBatch() {
    try {
      const rows = this.db.prepare(`
        SELECT id FROM memories WHERE status = 'active' AND id > ? ORDER BY id LIMIT ${MEMORY_EDGE_REBUILD_BATCH_SIZE}
      `).all(this.edgeRebuildCursor);
      for (const row of rows) this.reindexMemoryEdges(row.id);
      if (rows.length > 0) this.edgeRebuildCursor = rows[rows.length - 1].id;
      if (rows.length === MEMORY_EDGE_REBUILD_BATCH_SIZE) {
        this.edgeRebuildTimer = setTimeout(() => this.runEdgeRebuildBatch(), 0);
        return;
      }
      this.setSetting(MEMORY_SETTING_EDGE_INDEX_VERSION, MEMORY_EDGE_INDEX_VERSION);
      this.edgeRebuilding = false;
      this.ctx.logger?.info?.(`[${PLUGIN_NAME}] memory edge background rebuild finished`);
    } catch (error) {
      this.edgeRebuilding = false;
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory edge background rebuild failed:`, error);
    }
  }

  /* 关系遍历：BFS 限跳 + 度数惩罚。
     为什么不用 PPR：PPR 分数是概率分布（Σ=1），单点分数随库规模按 1/N 漂移
     （实测 N=17→0.059、N=1000→0.001，降 59 倍），无法与现有评分分量同量纲。
     BFS 输出离散跳数 + 局部度数，天然免疫量纲漂移。
     度数惩罚 1/log(2+degree) 与 BM25 的 idf 同思路，抑制 hub 节点污染。 */
  relatedMemories(originId, options = {}) {
    const id = normalizePlainText(originId, 128);
    const empty = { origin: [], related: [], relations: [], count: 0 };
    if (!id) return empty;
    const hops = clampRelateHops(options.hops);
    const kinds = normalizeEdgeKinds(options.kinds);
    const limit = clampToolLimit(options.limit, MEMORY_RELATE_DEFAULT_ITEMS, MEMORY_RELATE_MAX_ITEMS);
    const placeholders = kinds.map(() => '?').join(', ');
    try {
      if (this.db.prepare("SELECT 1 FROM memories WHERE id = ? AND status = 'active'").get(id) === undefined) return empty;
      const outEdges = this.db.prepare(
        `SELECT e.to_id, e.kind FROM memory_edges e
         JOIN memories m ON m.id = e.to_id AND m.status = 'active'
         WHERE e.from_id = ? AND e.kind IN (${placeholders})`);
      /* 度数按【不同活动邻居】计数（COUNT DISTINCT）：一对记忆可能同时有 same_file
         与 same_symbol 两条边，若按边计数会重复放大度数、让惩罚偏重。
         hub 的定义是「连到多少个不同节点」，不是「有多少条边」。 */
      const degreeOf = this.db.prepare(
        `SELECT COUNT(DISTINCT e.to_id) AS c FROM memory_edges e
         JOIN memories m ON m.id = e.to_id AND m.status = 'active'
         WHERE e.from_id = ? AND e.kind IN (${placeholders})`);
      const penalty = (nodeId) => 1 / Math.log(2 + (Number(degreeOf.get(nodeId, ...kinds)?.c) || 0));

      const visited = new Map([[id, { hop: 0, score: 1, via: null }]]);
      let frontier = [id];
      for (let hop = 1; hop <= hops; hop += 1) {
        const next = [];
        for (const nodeId of frontier) {
          for (const edge of outEdges.all(nodeId, ...kinds)) {
            if (visited.has(edge.to_id)) continue;
            const parent = visited.get(nodeId);
            const score = parent.score * edgeWeightOf(edge.kind) * penalty(edge.to_id);
            visited.set(edge.to_id, { hop, score, via: { from: nodeId, kind: edge.kind } });
            next.push(edge.to_id);
          }
        }
        frontier = next;
        if (frontier.length === 0) break;
      }
      visited.delete(id);

      /* 三级 tie-break（分数 → 跳数 → id）保证排序确定性：同输入同输出。 */
      const ranked = [...visited.entries()]
        .sort((left, right) => right[1].score - left[1].score
          || left[1].hop - right[1].hop
          || (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
        .slice(0, limit);

      const fetch = this.db.prepare(`
        SELECT m.*, d.name AS directory_name,
          COALESCE((SELECT GROUP_CONCAT(t.id, char(31)) FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active'), '') AS tag_ids,
          COALESCE((SELECT GROUP_CONCAT(t.name, char(31)) FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active'), '') AS tag_names
        FROM memories m JOIN memory_directories d ON d.id = m.directory_id
        WHERE m.id = ? AND m.status = 'active'`);

      const related = [];
      const relations = [];
      for (const [nodeId, meta] of ranked) {
        const row = fetch.get(nodeId);
        if (row === undefined) continue;
        related.push({ ...memoryFromRow(row), hop: meta.hop, relationScore: meta.score });
        relations.push({ from: meta.via.from, to: nodeId, kind: meta.via.kind, hop: meta.hop });
      }
      const originRow = fetch.get(id);
      return {
        origin: originRow === undefined ? [] : [memoryFromRow(originRow)],
        related,
        relations,
        count: related.length
      };
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory relate failed for ${id}:`, error);
      return empty;
    }
  }

  /* 解析起点：memoryId 优先；否则用 query 走一次 searchMemories 取 top-1。 */
  resolveRelateOrigin(args = {}) {
    const explicit = normalizePlainText(args.memoryId, 128);
    if (explicit) return explicit;
    const query = normalizePlainText(args.query, MEMORY_REQUEST_MAX_LENGTH);
    if (!query) return '';
    try {
      const hits = this.searchMemories(query, { limit: 1, status: 'active', scope: 'all' });
      return normalizePlainText(hits?.[0]?.id, 128);
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory relate origin lookup failed:`, error);
      return '';
    }
  }

  /* 边统计（供 UI / 调试）。 */
  memoryEdgeStats() {
    try {
      const edges = Number(this.db.prepare('SELECT COUNT(*) AS c FROM memory_edges').get()?.c) || 0;
      const keys = Number(this.db.prepare('SELECT COUNT(*) AS c FROM memory_edge_keys').get()?.c) || 0;
      const memories = Number(this.db.prepare("SELECT COUNT(*) AS c FROM memories WHERE status = 'active'").get()?.c) || 0;
      const byKind = this.db.prepare('SELECT kind, COUNT(*) AS c FROM memory_edges GROUP BY kind').all();
      return { memories, edges, keys, byKind, tagEdgesEnabled: this.edgeTagEdgesEnabled(), rebuilding: this.edgeRebuilding === true };
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory edge stats failed:`, error);
      return { memories: 0, edges: 0, keys: 0, byKind: [], tagEdgesEnabled: false, rebuilding: false };
    }
  }

  /* ══════════════════════════════════════════════════════════════
     Embedding 语义检索（可选，默认关闭）
     与关系边的结构对照：
       关系边  同步执行（0.5ms，纯本地 SQL）→ 直接挂在 reindexMemory 里
       向量    必须异步（≤200ms，网络调用）→ 只入队，由独立队列消费
     三条性能红线（实测依据）：
       ① 单条写入必须异步：蒸馏基线 9626ms，向量 200ms 占 2%，但同步会卡住写入路径；
       ② 回填必须批量：1000 条逐条 3.3min vs 批量(32) 6.4s，差 30 倍；
       ③ 稳态零成本：模型指纹一致且无缺失时不发任何 API 调用。
     ══════════════════════════════════════════════════════════════ */

  embeddingEnabled() {
    try {
      return this.getBooleanSetting(MEMORY_SETTING_EMBEDDING_ENABLED, false);
    } catch {
      return false;
    }
  }

  /* 双槽存储：remote 与 local 各自保留最后一次保存的配置，active 指向生效的一侧。
     语义约定（用户明确要求）：「保存并使用」只落库当前接入方式那一槽，不影响另一槽
     已保存的配置 —— 于是"本地保存过 → 又保存远程 → 重启 → 本地配置仍在"成立。
     兼容旧数据：旧单槽键 embeddingProvider 是一份 provider JSON，读到时按 kind 归位。 */
  embeddingProviderSlots() {
    try {
      const dual = this.getSetting('embeddingProviders');
      if (typeof dual === 'string' && dual.length > 0) {
        const parsed = JSON.parse(dual);
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return {
            remote: parsed.remote && typeof parsed.remote === 'object' ? parsed.remote : null,
            local: parsed.local && typeof parsed.local === 'object' ? parsed.local : null,
            active: parsed.active === 'local' ? 'local' : 'remote'
          };
        }
        return { remote: null, local: null, active: 'remote' };
      }
      /* 旧单槽迁移：一次性把 legacy 值放进对应槽位（不删除旧键，回滚安全）。
         ⚠️ 必须直接读旧键 embeddingProvider —— 不能调 this.embeddingProvider()，
            那个方法现在走槽位读取（slots.active），而新槽位尚未建立时会返回
            undefined，导致 legacy 值永远读不到、迁移成为死代码。 */
      const legacyRaw = this.getSetting(MEMORY_SETTING_EMBEDDING_PROVIDER);
      if (typeof legacyRaw === 'string' && legacyRaw.length > 0) {
        const legacy = JSON.parse(legacyRaw);
        if (legacy !== null && typeof legacy === 'object' && !Array.isArray(legacy)) {
          return { remote: legacy.kind === 'remote' ? legacy : null, local: legacy.kind === 'local' ? legacy : null, active: legacy.kind === 'local' ? 'local' : 'remote' };
        }
      }
      return { remote: null, local: null, active: 'remote' };
    } catch {
      return { remote: null, local: null, active: 'remote' };
    }
  }

  saveEmbeddingProviderSlot(provider) {
    if (provider === null || provider === undefined || typeof provider !== 'object') return;
    const slots = this.embeddingProviderSlots();
    const kind = provider.kind === 'local' ? 'local' : 'remote';
    slots[kind] = provider;
    slots.active = kind;
    this.setSetting('embeddingProviders', JSON.stringify(slots));
  }

  embeddingProvider() {
    try {
      const slots = this.embeddingProviderSlots();
      const provider = slots[slots.active];
      return provider !== null && typeof provider === 'object' ? provider : undefined;
    } catch {
      return undefined;
    }
  }

  setEmbedding(input = {}) {
    const enabled = input.enabled === true;
    this.setBooleanSetting(MEMORY_SETTING_EMBEDDING_ENABLED, enabled);
    if (input.provider !== undefined) {
      const provider = input.provider === null ? null : input.provider;
      /* 双槽语义：provider=null 清空当前生效侧的槽位；对象则按 kind 落自己的槽位。 */
      if (provider === null) {
        const slots = this.embeddingProviderSlots();
        slots[slots.active] = null;
        this.setSetting('embeddingProviders', JSON.stringify(slots));
      } else {
        this.saveEmbeddingProviderSlot(provider);
      }
    }
    /* 关闭时不删除向量表（重开立即可用，语义同 inactive 保留）；
       但下次启用时若指纹变化仍会触发重建（见 initMemoryEmbeddings）。 */
    if (!enabled) this.stopEmbeddingBackfill();
    return { enabled: this.embeddingEnabled(), provider: this.embeddingProvider() };
  }

  /* 模型指纹：model#dim。⚠️ 必须含维度 —— 同一个 model 名配不同 dimensions
     参数会产出不同向量（OpenAI 系支持截短维度），只比 model 名会漏。
     ⚠️ 用户没填维度时（UI 默认留空）必须退回【实测维度】：否则写入侧用实测的
        model#2048、查询侧用 model#0，两侧永远对不上 —— 实测后果是界面恒显示
        「向量已覆盖 0/N 条」、每次启动白跑一轮回填并立即 stalled 停止。 */
  embeddingFingerprint() {
    const provider = this.embeddingProvider();
    if (provider === undefined) return '';
    const model = normalizePlainText(provider.model, 300);
    if (!model) return '';
    const dim = Number(provider.dimensions) || 0;
    if (dim > 0) return `${model}#${dim}`;
    return `${model}#${this.detectedEmbeddingDim(model, 0)}`;
  }

  /* 读回实测维度。仅在记录与当前 model、当前配置维度【都】匹配时有效：
     配置维度一变即失效 —— 用户可能改成了别的截短维度，必须重算而不是沿用旧值。 */
  detectedEmbeddingDim(model, configuredDim) {
    try {
      const raw = this.getSetting(MEMORY_SETTING_EMBEDDING_DETECTED);
      if (typeof raw !== 'string' || raw.length === 0) return 0;
      const at = raw.lastIndexOf('@');
      if (at <= 0) return 0;
      if ((Number(raw.slice(at + 1)) || 0) !== configuredDim) return 0;
      const head = raw.slice(0, at);
      const hash = head.lastIndexOf('#');
      if (hash <= 0) return 0;
      if (head.slice(0, hash) !== model) return 0;
      return Number(head.slice(hash + 1)) || 0;
    } catch {
      return 0;
    }
  }

  /* 记录实测维度（ensureEmbedder 在 init 成功后调用）。
     存成 `model#实测@配置`，供「配置维度留空」时补全指纹。 */
  rememberDetectedEmbeddingDim(dim) {
    try {
      const provider = this.embeddingProvider();
      const model = normalizePlainText(provider?.model, 300);
      const value = Number(dim) || 0;
      if (!model || value <= 0) return;
      const configured = Number(provider?.dimensions) || 0;
      this.setSetting(MEMORY_SETTING_EMBEDDING_DETECTED, `${model}#${value}@${configured}`);
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] embedding detected dim persist failed:`, error);
    }
  }

  /* 已就绪的 embedder 实例（惰性创建并缓存；失败时返回 undefined 并留痕）。 */
  async ensureEmbedder() {
    if (this.embedder !== undefined) return this.embedder ?? undefined;
    const provider = this.embeddingProvider();
    const instance = createEmbedder(provider);
    if (instance === undefined) { this.embedder = null; return undefined; }
    try {
      await instance.init();
      this.embedder = instance;
      /* init() 已把 this.dimensions 覆盖成实测长度 —— 落库供配置侧指纹补全。 */
      this.rememberDetectedEmbeddingDim(instance.dimensions);
      return instance;
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] embedding init failed; falling back to lexical recall:`, error);
      this.embedder = null;
      return undefined;
    }
  }

  /* 取一条记忆的 embedding 输入文本 + 其指纹。
     ⚠️ input_hash 覆盖「正文+标签+目录名」——只比 content_hash 会漏掉"正文没变但标签变了"。 */
  embeddingInputOf(memoryId) {
    const id = normalizePlainText(memoryId, 128);
    if (!id) return undefined;
    try {
      const row = this.db.prepare(`
        SELECT m.id, m.body, m.content_hash, d.name AS directory_name,
          COALESCE((SELECT GROUP_CONCAT(t.name, ' ') FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id
            WHERE l.memory_id = m.id AND t.status = 'active'), '') AS tag_names
        FROM memories m JOIN memory_directories d ON d.id = m.directory_id
        WHERE m.id = ?`).get(id);
      if (row === undefined) return undefined;
      const text = embeddingInputText(row.body, String(row.tag_names ?? '').split(/\s+/u).filter(Boolean), row.directory_name);
      return { id, text, contentHash: row.content_hash, inputHash: memoryHash(text) };
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] embedding input build failed for ${id}:`, error);
      return undefined;
    }
  }

  /* 单条向量重建：只入队，不执行（embedding 是网络/推理调用，绝不能在写入路径同步跑）。
     回填进行中则挂起，由回填收尾统一处理（照 ftsPendingOps 模式）。 */
  reindexMemoryEmbedding(memoryId) {
    const id = normalizePlainText(memoryId, 128);
    if (!id) return;
    if (!this.embeddingEnabled()) return;
    if (this.embeddingBackfilling === true) {
      this.embeddingPendingOps.set(id, 'index');
      return;
    }
    this.embeddingWriteQueue.push(id);
    if (this.embeddingQueueTimer === null) {
      this.embeddingQueueTimer = setTimeout(() => { void this.runEmbeddingWriteQueue(); }, 0);
    }
  }

  /* 消费写入队列：批量聚合后一次调用（批量是最大杠杆）。
     失败仅记 warn，不影响记忆本身已落库的事实。 */
  async runEmbeddingWriteQueue() {
    this.embeddingQueueTimer = null;
    if (this.embeddingQueueRunning === true) return;
    this.embeddingQueueRunning = true;
    try {
      while (this.embeddingWriteQueue.length > 0) {
        const batch = this.embeddingWriteQueue.splice(0, MEMORY_EMBEDDING_BATCH_SIZE);
        await this.embedAndStore(batch);
      }
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] embedding write queue failed:`, error);
    } finally {
      this.embeddingQueueRunning = false;
    }
  }

  /* 给一批记忆算向量并落库。返回成功条数。
     - 逐条比对 input_hash：未变化则跳过（幂等，不重复调用 API）
     - 单条失败只跳过该条（部分成功胜于全失败） */
  async embedAndStore(memoryIds, options = {}) {
    const ids = (Array.isArray(memoryIds) ? memoryIds : []).map((v) => normalizePlainText(v, 128)).filter(Boolean);
    if (ids.length === 0) return 0;
    const embedder = await this.ensureEmbedder();
    if (embedder === undefined) return 0;
    const fingerprint = embedder.fingerprint();
    /* 逐条准备输入；已是最新指纹的跳过 */
    const pending = [];
    for (const id of ids) {
      const input = this.embeddingInputOf(id);
      if (input === undefined) continue;
      if (options.forceRecompute !== true) {
        const existing = this.db.prepare('SELECT input_hash, model FROM memory_embeddings WHERE memory_id = ?').get(id);
        if (existing !== undefined && existing.input_hash === input.inputHash && existing.model === fingerprint) continue;
      }
      pending.push(input);
    }
    if (pending.length === 0) return 0;
    let stored = 0;
    /* 分片调用：一次请求不超过 batchSize */
    for (let offset = 0; offset < pending.length; offset += MEMORY_EMBEDDING_BATCH_SIZE) {
      const slice = pending.slice(offset, offset + MEMORY_EMBEDDING_BATCH_SIZE);
      let vectors;
      try {
        vectors = await embedder.embedBatch(slice.map((item) => item.text));
      } catch (error) {
        this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] embedding request failed; skipping ${slice.length} memories:`, error);
        continue;
      }
      const stamp = now();
      try {
        this.db.exec('BEGIN');
        const upsert = this.db.prepare(`
          INSERT INTO memory_embeddings (memory_id, content_hash, input_hash, embedding, model, dim, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(memory_id) DO UPDATE SET
            content_hash = excluded.content_hash, input_hash = excluded.input_hash,
            embedding = excluded.embedding, model = excluded.model, dim = excluded.dim, updated_at = excluded.updated_at`);
        for (let i = 0; i < slice.length; i += 1) {
          const vector = vectors[i];
          if (!Array.isArray(vector) || vector.length === 0) continue;
          upsert.run(slice[i].id, slice[i].contentHash, slice[i].inputHash, vectorToBlob(vector), fingerprint, vector.length, stamp);
          stored += 1;
        }
        this.db.exec('COMMIT');
      } catch (error) {
        try { this.db.exec('ROLLBACK'); } catch { /* no active transaction */ }
        this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] embedding store failed:`, error);
      }
    }
    return stored;
  }

  /* 缺向量的记忆数（按【当前模型指纹】判定：换模型后旧向量全部视为缺失）。 */
  countMemoriesMissingEmbedding() {
    try {
      const fingerprint = this.embeddingFingerprint();
      return Number(this.db.prepare(`
        SELECT COUNT(*) AS c FROM memories m
        WHERE m.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM memory_embeddings e WHERE e.memory_id = m.id AND e.model = ?)`
      ).get(fingerprint)?.c) || 0;
    } catch {
      return 0;
    }
  }

  /* 启动期向量初始化。三层判断，逐层短路（照 initFts 的版本戳模式）：
     ① 总开关关 → 直接返回（零成本）
     ② 指纹一致且无缺失 → 直接返回（稳态零 API 调用）
     ③ 否则 → 回填（库小同步、库大后台分批） */
  initMemoryEmbeddings() {
    if (!this.embeddingEnabled()) return;
    try {
      const stored = this.getSetting(MEMORY_SETTING_EMBEDDING_MODEL);
      const expected = this.embeddingFingerprint();
      if (!expected) return;
      const missing = this.countMemoriesMissingEmbedding();
      if (stored === expected && missing === 0) return;   // ② 稳态
      const total = Number(this.db.prepare("SELECT COUNT(*) AS c FROM memories WHERE status = 'active'").get()?.c) || 0;
      if (total === 0) return;
      /* 指纹变化（换模型/换维度）时旧向量不可混算 —— 不删旧行，靠 model 过滤重算，
         这样中断也安全（旧向量还在，新向量逐步补上，下次启动继续）。 */
      if (stored !== expected) {
        this.ctx.logger?.info?.(`[${PLUGIN_NAME}] embedding model changed (${stored ?? 'none'} → ${expected}); rebuilding all vectors`);
      }
      /* ⚠️ 只能后台分批，没有"同步跑完"这条路：
         init() 是构造函数同步调用的，此处无法 await；而 embedding 是网络调用。
         所以一律交给 startEmbeddingBackfill（setTimeout 分片），让它不阻塞启动。
         库 ≤128 条时它其实只有一批，实测 < 1 秒完成。 */
      this.startEmbeddingBackfill({ total, missing });
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory embedding init failed:`, error);
    }
  }

  /* 后台分批回填（照 startFtsRebuild 模式）：不阻塞启动，期间召回走纯词法。 */
  startEmbeddingBackfill(meta = {}) {
    if (this.embeddingBackfilling === true) return;
    this.embeddingBackfilling = true;
    this.embeddingBackfillProgress = { done: 0, total: Number(meta.total) || 0, startedAt: now() };
    const step = () => { void this.runEmbeddingBackfillBatch(); };
    this.embeddingBackfillTimer = setTimeout(step, 0);
  }

  stopEmbeddingBackfill() {
    if (this.embeddingBackfillTimer !== null) {
      clearTimeout(this.embeddingBackfillTimer);
      this.embeddingBackfillTimer = null;
    }
    this.embeddingBackfilling = false;
    /* 回填期间挂起的写入改走常规队列，避免丢更新。 */
    if (this.embeddingPendingOps.size > 0) {
      for (const id of this.embeddingPendingOps.keys()) this.embeddingWriteQueue.push(id);
      this.embeddingPendingOps.clear();
      if (this.embeddingQueueTimer === null) {
        this.embeddingQueueTimer = setTimeout(() => { void this.runEmbeddingWriteQueue(); }, 0);
      }
    }
  }

  /* 回填日志的配置描述：「网络 API · 模型 · 维度」/「本地模型 · 模型 · 维度」。
     三要素齐备才能在日志页一眼定位问题配置：只写模型名时，remote/local 同名
     或同模型不同维度的历史记录无法区分。 */
  embeddingBackfillConfigText() {
    const provider = this.embeddingProvider();
    const kindLabel = provider?.kind === 'local' ? '本地模型' : '网络 API';
    const model = String(provider?.model ?? '').trim() || '(未配置)';
    /* 维度口径与指纹一致：配置值 > 0 用配置值，否则用实测记录（embeddingDetected）补全 */
    const declared = Number(provider?.dimensions) || 0;
    const detected = Number(String(this.embeddingFingerprint() ?? '').split('#')[1]) || 0;
    const dim = declared > 0 ? declared : detected;
    return `${kindLabel} · ${model} · ${dim > 0 ? `${dim} 维` : '维度未定'}`;
  }

  /* 回填日志的 summary 文案：统一带【模式 · 模型 · 维度】，方便在日志页一眼定位是哪个配置出的问题。 */
  embeddingBackfillLogSummary(attempted, stored) {
    const config = this.embeddingBackfillConfigText();
    if (stored === undefined) return `Embedding 回填（${config}）：本批 ${attempted} 条全部写入失败，已停止`;
    return `Embedding 回填（${config}）：本批 ${attempted} 条，成功 ${stored} 条，失败 ${attempted - stored} 条（将自动重试）`;
  }

  /* 一批回填：取 N 条缺向量的记忆，算完写回。幂等 —— 只处理"缺的"。 */
  async runEmbeddingBackfillBatch() {
    if (this.embeddingBackfilling !== true) return;
    try {
      const fingerprint = this.embeddingFingerprint();
      const rows = this.db.prepare(`
        SELECT m.id FROM memories m
        WHERE m.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM memory_embeddings e WHERE e.memory_id = m.id AND e.model = ?)
        ORDER BY m.id LIMIT ?`).all(fingerprint, MEMORY_EMBEDDING_BATCH_SIZE * MEMORY_EMBEDDING_BACKFILL_MULTIPLIER);
      if (rows.length === 0) {
        this.finishEmbeddingBackfill();
        return;
      }
      const stored = await this.embedAndStore(rows.map((r) => r.id));
      this.embeddingBackfillProgress.done += stored;
      /* 若整批都没成功（例如 API 持续失败），停止以避免死循环刷日志。 */
      if (stored === 0) {
        this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] embedding backfill stalled; stopping (check embedding provider config)`);
        /* 写入日志页（activity log）：回填静默停止是"向量恒 0"难察觉的一环，
           不落库的话用户在 UI 里看不到任何失败痕迹。只写这一条，重试消耗不写。 */
        this.recordActivityLog('embedding_backfill', 'failed', {
          summary: this.embeddingBackfillLogSummary(rows.length),
          errorCode: 'backfill-stalled',
          errorMessage: `整批 ${rows.length} 条全部写入失败（单次请求重试与分片跳过均已尝试）。回填已停止；下次保存记忆或重启 DSH 会从缺失处继续。`
        });
        this.finishEmbeddingBackfill();
        return;
      }
      /* 部分成功也记一条（不写重试噪声），让进度可见；全批成功则不逐批刷屏，
         仅在收尾时写一条汇总（见 finishEmbeddingBackfill）。 */
      if (stored < rows.length) {
        this.recordActivityLog('embedding_backfill', 'success', {
          summary: this.embeddingBackfillLogSummary(rows.length, stored)
        });
      }
      this.embeddingBackfillTimer = setTimeout(() => { void this.runEmbeddingBackfillBatch(); }, 0);
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] embedding backfill batch failed:`, error);
      this.finishEmbeddingBackfill();
    }
  }

  /* 回填收尾：处理挂起的增量写入，写入模型指纹。 */
  async finishEmbeddingBackfill(meta = {}) {
    if (this.embeddingBackfillTimer !== null) {
      clearTimeout(this.embeddingBackfillTimer);
      this.embeddingBackfillTimer = null;
    }
    this.embeddingBackfilling = false;
    const fingerprint = this.embeddingFingerprint();
    try {
      if (fingerprint) this.setSetting(MEMORY_SETTING_EMBEDDING_MODEL, fingerprint);
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] embedding fingerprint persist failed:`, error);
    }
    /* 回填期间的挂起写入：转交常规队列。 */
    if (this.embeddingPendingOps.size > 0) {
      for (const id of this.embeddingPendingOps.keys()) this.embeddingWriteQueue.push(id);
      this.embeddingPendingOps.clear();
    }
    const progress = this.embeddingBackfillProgress;
    if (progress !== null && progress !== undefined) {
      const elapsed = now() - progress.startedAt;
      this.ctx.logger?.info?.(`[${PLUGIN_NAME}] embedding backfill finished: ${progress.done} stored in ${elapsed}ms${meta.reason ? ` (${meta.reason})` : ''}`);
      /* 完成汇总也写日志页（仅 1 条/轮回填）：如果中途有分片失败被 skip（部分成功），
         这里的 done < missing，用户能在 UI 看到实际缺口；全成功则是一条普通完成记录。 */
      this.recordActivityLog('embedding_backfill', 'success', {
        summary: `Embedding 回填完成（${this.embeddingBackfillConfigText()}）：本轮成功 ${progress.done}/${progress.missing ?? progress.done} 条`
      });
    }
    this.embeddingBackfillProgress = null;
    if (this.embeddingWriteQueue.length > 0 && this.embeddingQueueTimer === null) {
      this.embeddingQueueTimer = setTimeout(() => { void this.runEmbeddingWriteQueue(); }, 0);
    }
  }

  /* 向量候选：与查询余弦 >= 阈值的记忆。
     ⚠️ 必须设阈值 —— 只取 top-K 总会返回"最近的一条"，哪怕库中没有任何相关记忆。
     （graph-memory 用 0.70、mneme 用 0.65 + 自适应，均为此。） */
  async vectorCandidateRows(queryText, directoryIds, options = {}) {
    const text = normalizePlainText(queryText, MEMORY_REQUEST_MAX_LENGTH);
    if (!text || !Array.isArray(directoryIds) || directoryIds.length === 0) return [];
    const embedder = await this.ensureEmbedder();
    if (embedder === undefined) return [];
    let queryVector;
    try {
      const [vector] = await embedder.embedBatch([text]);
      if (!Array.isArray(vector) || vector.length === 0) return [];
      queryVector = vector;
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] embedding query failed; falling back to lexical:`, error);
      return [];
    }
    const fingerprint = embedder.fingerprint();
    const limit = clampToolLimit(options.limit, RECALL_MAX_ITEMS * 4, MEMORY_TOOL_MAX_ITEMS);
    const placeholders = directoryIds.map(() => '?').join(', ');
    let rows;
    try {
      /* 只取 id + 向量（向量从表里点查，正文回表）——避免把 BLOB 混进大查询。 */
      rows = this.db.prepare(`
        SELECT e.memory_id, e.embedding FROM memory_embeddings e
        JOIN memories m ON m.id = e.memory_id
        WHERE m.status = 'active' AND e.model = ? AND m.directory_id IN (${placeholders})`
      ).all(fingerprint, ...directoryIds);
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] embedding candidate read failed:`, error);
      return [];
    }
    const scored = [];
    /* 全量余弦表（不过 0.65 门槛）——供「向量守门」使用。
       复用同一次 query embedding，避免为守门再算一遍（本地推理开销大）。 */
    const allScores = new Map();
    for (const row of rows) {
      const vector = blobToVector(row.embedding);
      if (vector === undefined) continue;
      const score = cosineSimilarity(queryVector, vector);
      allScores.set(row.memory_id, score);
      if (score < MEMORY_VECTOR_MIN_SCORE) continue;
      scored.push({ id: row.memory_id, score });
    }
    if (options.scoreSink instanceof Map) {
      for (const [id, score] of allScores) options.scoreSink.set(id, score);
    }
    scored.sort((left, right) => right.score - left.score || (left.id < right.id ? -1 : 1));
    const top = scored.slice(0, limit);
    if (top.length === 0) return [];
    /* 回表取完整行（照 searchVector 的 Top-N 回表模式，只点查入选行）。 */
    const fetch = this.db.prepare(`
      SELECT m.*, d.name AS directory_name,
        COALESCE((SELECT GROUP_CONCAT(t.id, char(31)) FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active'), '') AS tag_ids,
        COALESCE((SELECT GROUP_CONCAT(t.name, char(31)) FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active'), '') AS tag_names
      FROM memories m JOIN memory_directories d ON d.id = m.directory_id
      WHERE m.id = ?`);
    const out = [];
    for (const item of top) {
      const row = fetch.get(item.id);
      if (row === undefined) continue;
      /* rank 恒为 0（无 BM25 信息）；vectorScore 走【独立字段】。
         ⚠️ 绝不能把余弦写进 rank —— 会被 bm25Weight clamp 到 [0,8] 并与 BM25 混量纲。 */
      out.push({ ...row, rank: 0, vectorScore: item.score });
    }
    return out;
  }

  /* 连通测试：用给定（或已保存的）配置真实发一次 embedding 请求，返回可读结果。
     ⚠️ 刻意【不复用 ensureEmbedder】——那个方法会缓存结果（成功缓存实例、失败缓存 null），
        而测试应当是【无副作用】的：测失败不应把 embedder 永久置为 null，
        测一份"待保存的候选配置"更不该覆盖当前生效的配置。
     因此这里临时构造一个 embedder、跑完即 dispose，不触碰 this.embedder。

     返回 { ok, ... }：
       ok=true  → { ok, dimensions, model, latencyMs, sample }（sample 为向量前几维，供肉眼确认）
       ok=false → { ok, code, message, hint }（hint 给出针对性的排查方向） */
  async testEmbedding(providerOverride = undefined) {
    const provider = providerOverride === undefined ? this.embeddingProvider() : providerOverride;
    if (provider === null || provider === undefined || typeof provider !== 'object') {
      return { ok: false, code: 'not-configured', message: '尚未配置 embedding 接口', hint: '请先填写接口类型、API 地址与模型名。' };
    }
    const embedder = createEmbedder(provider);
    if (embedder === undefined) {
      return { ok: false, code: 'invalid-provider', message: `无法识别的接口类型：${String(provider.kind ?? '')}`, hint: '接口类型只能是 remote（网络 API）或 local（本地模型）。' };
    }
    const startedAt = now();
    try {
      await embedder.init();
      const latencyMs = now() - startedAt;
      /* 再取一次真实向量做抽样展示（init 内部已探过一次，这里复用实例不再新建）。 */
      const [vector] = await embedder.embedBatch(['连通测试']);
      const dims = Array.isArray(vector) ? vector.length : embedder.dimensions;
      if (!Array.isArray(vector) || dims === 0) {
        return { ok: false, code: 'empty-vector', message: '接口返回了空向量', hint: '请确认该模型确实支持 /embeddings 端点（对话模型通常不支持）。' };
      }
      return {
        ok: true,
        dimensions: dims,
        model: normalizePlainText(provider.model, 200),
        kind: provider.kind === 'local' ? 'local' : 'remote',
        latencyMs,
        /* 抽样前 3 维：用于肉眼确认"返回的是向量"而不是异常值 */
        sample: vector.slice(0, 3).map((x) => Number(Number(x).toFixed(4)))
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, code: 'request-failed', message, hint: embeddingTestHint(message, provider) };
    } finally {
      try { embedder.dispose?.(); } catch { /* 忽略释放失败 */ }
    }
  }

  embeddingStats() {
    try {
      const enabled = this.embeddingEnabled();
      const fingerprint = this.embeddingFingerprint();
      const stored = this.getSetting(MEMORY_SETTING_EMBEDDING_MODEL);
      const total = Number(this.db.prepare("SELECT COUNT(*) AS c FROM memories WHERE status = 'active'").get()?.c) || 0;
      const embedded = fingerprint
        ? Number(this.db.prepare('SELECT COUNT(*) AS c FROM memory_embeddings WHERE model = ?').get(fingerprint)?.c) || 0
        : 0;
      const missing = this.countMemoriesMissingEmbedding();
      const progress = this.embeddingBackfillProgress;
      return {
        enabled,
        model: stored ?? null,
        expectedModel: fingerprint || null,
        modelMatches: Boolean(fingerprint) && stored === fingerprint,
        total,
        embedded,
        pending: this.embeddingWriteQueue.length,
        backfilling: this.embeddingBackfilling === true,
        backfillProgress: progress === null || progress === undefined
          ? null
          : { done: progress.done, missing }
      };
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] embedding stats failed:`, error);
      return { enabled: false, model: null, expectedModel: null, modelMatches: false, total: 0, embedded: 0, pending: 0, backfilling: false, backfillProgress: null };
    }
  }

  /* 释放 embedder（本地模型占数百 MB 内存，关闭插件时必须卸）。 */
  disposeEmbedder() {
    try { this.embedder?.dispose?.(); } catch { /* 忽略 */ }
    this.embedder = undefined;
  }

  /* 把一批记忆按关系边聚成「同源簇」——只在传入的这批记忆【内部】做连通分量，
     不引入未被选中的记忆。用于把扁平的搜索结果翻译成结构化的分组。

     为什么只在命中集内聚类：结果是「这批命中的记忆彼此之间的关联」，语义清晰；
     若扩到全库，会把用户没搜到的记忆拉进来，超出预期。
     因此某条显示为「独立」只表示【本次结果里它没有同伴】，不代表全库孤立，
     渲染时必须用「本组内」这类措辞，不可写成绝对孤立。

     返回 [{ memoryIds:[...], commonKeys:[{kind,label,count}], edgeCount, possibleEdges }]，
     按簇大小降序；簇内保持传入顺序（即搜索相关度序）。 */
  clusterMemoriesByRelation(memoryIds, options = {}) {
    const ids = (Array.isArray(memoryIds) ? memoryIds : [])
      .map((value) => normalizePlainText(value, 128))
      .filter(Boolean);
    if (ids.length === 0) return [];
    const kinds = normalizeEdgeKinds(options.kinds);
    const idSet = new Set(ids);
    try {
      /* 一次取回这批记忆的全部边（不做逐条查询：命中集可能较大）。 */
      const placeholders = ids.map(() => '?').join(', ');
      const edges = this.db.prepare(
        `SELECT from_id, to_id, kind FROM memory_edges
         WHERE from_id IN (${placeholders}) AND to_id IN (${placeholders}) AND kind IN (${kinds.map(() => '?').join(', ')})`
      ).all(...ids, ...ids, ...kinds);

      const adj = new Map(ids.map((id) => [id, new Set()]));
      const pairCount = new Map();
      for (const edge of edges) {
        if (edge.from_id === edge.to_id) continue;
        if (!idSet.has(edge.from_id) || !idSet.has(edge.to_id)) continue;
        adj.get(edge.from_id).add(edge.to_id);
        adj.get(edge.to_id).add(edge.from_id);
        const composite = edge.from_id < edge.to_id ? `${edge.from_id}\u001f${edge.to_id}` : `${edge.to_id}\u001f${edge.from_id}`;
        pairCount.set(composite, (pairCount.get(composite) ?? 0) + 1);
      }

      /* 连通分量（BFS）。按传入顺序遍历，保证同输入同输出。 */
      const visited = new Set();
      const clusters = [];
      for (const start of ids) {
        if (visited.has(start)) continue;
        visited.add(start);
        const members = [];
        const queue = [start];
        while (queue.length > 0) {
          const nodeId = queue.shift();
          members.push(nodeId);
          for (const peer of adj.get(nodeId)) {
            if (visited.has(peer)) continue;
            visited.add(peer);
            queue.push(peer);
          }
        }
        /* 簇内保持传入顺序（搜索相关度序），而不是 BFS 顺序。 */
        const order = new Map(ids.map((id, index) => [id, index]));
        members.sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));

        /* 统计簇内共同键：被 >=2 个成员共享的 file/symbol 键，作为「共同点」摘要。 */
        const keyCount = new Map();
        if (members.length >= 2) {
          const memberPlaceholders = members.map(() => '?').join(', ');
          const rows = this.db.prepare(
            `SELECT kind, key, COUNT(DISTINCT memory_id) AS c FROM memory_edge_keys
             WHERE memory_id IN (${memberPlaceholders}) AND kind IN ('file','symbol')
             GROUP BY kind, key HAVING c >= 2 ORDER BY c DESC, key ASC LIMIT 6`
          ).all(...members);
          for (const row of rows) keyCount.set(`${row.kind}\u001f${row.key}`, Number(row.c) || 0);
        }
        const commonKeys = [...keyCount.entries()].map(([composite, count]) => {
          const [kind, key] = composite.split('\u001f');
          return { kind, label: kind === 'file' ? shortEdgeKey(key) : key, count };
        });

        let edgeCount = 0;
        const possibleEdges = members.length * (members.length - 1) / 2;
        for (let i = 0; i < members.length; i += 1) {
          for (let j = i + 1; j < members.length; j += 1) {
            const composite = members[i] < members[j] ? `${members[i]}\u001f${members[j]}` : `${members[j]}\u001f${members[i]}`;
            if (pairCount.has(composite)) edgeCount += 1;
          }
        }
        clusters.push({ memoryIds: members, commonKeys, edgeCount, possibleEdges });
      }
      clusters.sort((left, right) => right.memoryIds.length - left.memoryIds.length);
      return clusters;
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory relation clustering failed:`, error);
      /* 失败时退化为「每条各自一簇」，不影响搜索结果本身。 */
      return ids.map((id) => ({ memoryIds: [id], commonKeys: [], edgeCount: 0, possibleEdges: 0 }));
    }
  }

  /* 清空活动日志：只删已落库的历史记录（memory_activity_logs），不动内存中的 activeActivities，
     进行中的活动结束后仍会正常落库，避免"清空前启动、清空后完成"的操作凭空消失。 */
  clearActivityLogs() {
    const removed = this.db.prepare('DELETE FROM memory_activity_logs').run().changes;
    return { removed: Number(removed) || 0 };
  }

  /* 直接落库一条活动日志（不经过 beginActivity 的"进行中"Map）。
     用于【无过程、只有结果】的事件 —— 典型如 embedding 回填的批次失败/完成：
     不需要在"进行中"列表出现，也不该被 stuck 兜底误回收。 */
  recordActivityLog(kind, outcome, details = {}) {
    try {
      this.db.prepare(`INSERT INTO memory_activity_logs (id, kind, outcome, session_id, turn, call_id, memory_id, summary, error_code, error_message, session_title, trigger_kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id('activity'), kind, outcome, details.sessionId ?? null, details.turn ?? null, details.callId ?? null, details.memoryId ?? null, details.summary ?? null, details.errorCode ?? null, details.errorMessage ?? null, details.sessionTitle || null, 'auto', now());
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] activity log write failed:`, error);
    }
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
    /* Embedding 清理：停掉回填与写入队列的定时器，并释放 embedder
       （LocalEmbedder 持数百 MB 内存，不释放会随插件重载累积）。 */
    if (this.embeddingBackfillTimer !== null) clearTimeout(this.embeddingBackfillTimer);
    this.embeddingBackfillTimer = null;
    this.embeddingBackfilling = false;
    if (this.embeddingQueueTimer !== null) clearTimeout(this.embeddingQueueTimer);
    this.embeddingQueueTimer = null;
    this.embeddingWriteQueue.length = 0;
    this.embeddingPendingOps.clear();
    this.disposeEmbedder();
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
    /* 关系边重建放在最前：边表与 FTS 是两个独立的派生索引，生命周期不应耦合。
       若放在末尾会被下面两个 return 跳过 —— FTS 重建期间（ftsAvailable=false）
       边将完全不更新，导致 memory_relate 返回过期结果。 */
    this.reindexMemoryEdges(memoryId);
    /* 向量同理放在早退之前；但它是【入队】而非执行（embedding 是网络调用，
       同步会卡住写入路径），故这里只是推一次队列。 */
    this.reindexMemoryEmbedding(memoryId);
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
    /* 记忆格式：与 tags 并列随快照下发（设置页与记忆弹窗都要用）。
       definition 是结构化对象，客户端可直接渲染字段清单。 */
    const formats = this.listFormats();
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
        /* 事实时间随快照透出：临时记忆在转正前就要能在卡片上显示/编辑这两项。 */
        eventTime: Number(item.eventTime) > 0 ? Number(item.eventTime) : 0,
        validUntil: Number(item.validUntil) > 0 ? Number(item.validUntil) : 0,
        /* 格式归属同样随快照透出：临时记忆的归属在蒸馏时就已定好。 */
        formatId: normalizePlainText(item.formatId, 128),
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
      recallSettings: this.recallSettings(),
      /* Embedding 状态与配置（apiKey 掩码回显：只回传是否存在与末 4 位，
         前端保存时回传掩码即表示"不改 key"）。 */
      embedding: (() => {
        const stats = this.embeddingStats();
        const provider = this.embeddingProvider();
        return {
          ...stats,
          provider: provider === undefined ? null : {
            kind: provider.kind === 'local' ? 'local' : 'remote',
            baseUrl: String(provider.baseUrl ?? ''),
            model: String(provider.model ?? ''),
            dimensions: Number(provider.dimensions) || 0,
            device: provider.device === 'gpu' ? 'gpu' : 'cpu',
            apiKeySet: typeof provider.apiKey === 'string' && provider.apiKey.length > 0,
            apiKeyMask: maskedApiKeyText(provider.apiKey)
          },
          /* 双槽：两侧各自最后一次保存的配置（掩码口径同上）。
             前端用它回填两个 tab 的表单 —— 保存远程后重启，本地 tab 仍能取回本地配置。 */
          providerSlots: (() => {
            const slots = this.embeddingProviderSlots();
            const shape = (provider) => provider === null || provider === undefined ? null : {
              kind: provider.kind === 'local' ? 'local' : 'remote',
              baseUrl: String(provider.baseUrl ?? ''),
              model: String(provider.model ?? ''),
              dimensions: Number(provider.dimensions) || 0,
              device: provider.device === 'gpu' ? 'gpu' : 'cpu',
              apiKeySet: typeof provider.apiKey === 'string' && provider.apiKey.length > 0,
              apiKeyMask: maskedApiKeyText(provider.apiKey)
            };
            return { remote: shape(slots.remote), local: shape(slots.local), active: slots.active };
          })()
        };
      })(),
      sessionId: sid,
      directories,
      tags,
      formats,
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

  /* 复用优先的标签落库：避免"蒸馏"/"蒸馏逻辑"这类同义碎片各占一个标签。
     判定保守化——仅当一个是另一个的子串且短者长度 ≥3、长度差 ≤2 时视为同一标签，
     防止过短标签（UI、tag）吞并无关标签，也避免把"UI样式"与"性能优化"误合并。
     只在"本次待建标签 vs 库中已有标签"之间判断，不回溯合并历史标签。 */
  reuseTagName(name) {
    const existing = this.db.prepare("SELECT name FROM memory_tags WHERE status = 'active'").all().map((row) => row.name).filter(Boolean);
    if (existing.includes(name)) return name;
    for (const candidate of existing) {
      const shorter = candidate.length <= name.length ? candidate : name;
      const longer = shorter === candidate ? name : candidate;
      if (shorter.length < TAG_REUSE_MIN_CHARS) continue;
      if (longer.length - shorter.length > TAG_REUSE_MAX_LENGTH_DELTA) continue;
      if (longer.includes(shorter)) return candidate;
    }
    return name;
  }

  /* 防标签爆炸的项目内「事实词表」：只统计当前作用域内 active 记忆实际使用的自定义标签，
     按项目内引用数降序、同数按创建时间升序。空作用域绝不回退全库，避免跨项目提示泄漏。
     limit=null 给写入规范化取该项目全部标签；蒸馏 prompt 使用默认的前 80 个。 */
  customTagCatalog(limit = MAX_TAG_CATALOG_SIZE, directoryIds = undefined) {
    const ids = [...new Set((Array.isArray(directoryIds) ? directoryIds : [])
      .map((value) => normalizePlainText(value, 128)).filter(Boolean))];
    if (ids.length === 0) return [];
    const limitSql = limit === null ? '' : 'LIMIT ?';
    const limitValue = limit === null ? [] : [Math.max(1, Math.min(1000, Math.floor(Number(limit) || MAX_TAG_CATALOG_SIZE)))];
    return this.db.prepare(`
      SELECT t.name AS name, COUNT(DISTINCT m.id) AS refs
      FROM memory_tags t
      JOIN memory_tag_links l ON l.tag_id = t.id
      JOIN memories m ON m.id = l.memory_id
      WHERE t.preset = 0 AND t.status = 'active' AND m.status = 'active'
        AND m.directory_id IN (${ids.map(() => '?').join(', ')})
      GROUP BY t.id
      ORDER BY refs DESC, t.created_at ASC, t.name ASC
      ${limitSql}
    `).all(...ids, ...limitValue).map((row) => String(row.name)).filter(Boolean);
  }

  canonicalMemoryTagNames(tagNames, directoryIds, preserveNames = []) {
    const catalog = this.customTagCatalog(null, directoryIds);
    /* 只查本次输入的精确登记状态，不扫全表；inactive 名称也视为已登记，
       不消耗新增标签额度，但 ensureTags 不会将其重新激活。 */
    const requested = uniqueStrings(Array.isArray(tagNames) ? tagNames : [], MAX_TAGS_PER_MEMORY).map(normalizeTagName).filter(Boolean);
    const existingNames = requested.length === 0
      ? []
      : this.db.prepare(`SELECT name FROM memory_tags WHERE name IN (${requested.map(() => '?').join(', ')})`).all(...requested).map((row) => row.name);
    return canonicalizeMemoryTagNames(tagNames, catalog, preserveNames, existingNames);
  }

  /* ── 记忆格式（memory_formats）──
     格式既用于生成给模型的候选清单，也通过 memories.format_id 参与写入校验、正文
     字段白名单和键序重排；格式定义本身仍独立存储，不需要 memory_tag_links 关联表。 */

  /* 全部格式（含内置与停用），按「内置优先 → 激活优先 → 名称」排序，供 UI 与提示词共用。 */
  listFormats() {
    const presetOrder = new Map(MEMORY_PRESET_FORMATS.map((format, index) => [format.id, index]));
    let rows = [];
    try {
      rows = this.db.prepare('SELECT id, name, builtin, status, definition, created_at, updated_at FROM memory_formats').all();
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory formats read failed:`, error);
      return [];
    }
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      builtin: row.builtin === 1,
      /* ⚠️ 不得按 builtin 强制 active（v12.16）：v12.13 起内置「代码类」状态已可编辑，
         此处原为 `row.builtin === 1 ? 'active' : normalizeStatus(...)` —— 它让 DB 里的
         inactive 在【读取层】被改写回 active，于是「停用后重启仍是激活」。
         这是与 ensurePresetFormats 并列的第二处重置点（写入侧已修，此处是读取侧）。
         统一按库中真实值收敛：只做非法值兜底，不再区分 builtin。 */
      status: normalizeStatus(row.status, 'active'),
      definition: normalizeFormatDefinition(row.definition) ?? { fields: [], order: [], indent: 2 },
      createdAt: Number(row.created_at) || 0,
      updatedAt: Number(row.updated_at) || 0
    })).sort((left, right) => {
      if (left.builtin !== right.builtin) return left.builtin ? -1 : 1;
      if (left.builtin && right.builtin) return (presetOrder.get(left.id) ?? 999) - (presetOrder.get(right.id) ?? 999);
      if (left.status !== right.status) return left.status === 'active' ? -1 : 1;
      return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
    });
  }

  /* 激活格式（供蒸馏提示词使用）：只取 status = active 的。
     注意 listFormats 已不再按 builtin 强制 active（v12.16），故这里如实反映用户设置。 */
  activeFormats() {
    return this.listFormats().filter((format) => format.status === 'active');
  }

  /* 内置「代码类」当前是否启用（v12.20）。
     用途：把「按代码类形状自动包装正文」（shouldUseStructuredContent → 四键 JSON）
     也纳入停用语义 —— 用户原则「内置格式只有在激活状态的时候才常驻；停用后无论是否
     内置，都不应参与注入和蒸馏、memory_add、memory_update」。
     停用后就该按纯文本落库，而不是仍被程序按代码类骨架改写。 */
  hasActiveCodeFormat() {
    return this.activeFormats().some((format) => format.id === MEMORY_FORMAT_CODE_ID);
  }

  /* 刷新「当前活跃轮次」引用（由 agent/pre-step 钩子每步调用）。
     只保存引用，不做任何 I/O —— 描述回调每次投影都会调用下方 formatsForToolDescription，
     若在那里读转录会产生不必要的开销与异常面。 */
  setActiveTurnRef(agent, turn) {
    this.activeTurnRef = (agent?.session !== undefined && Number.isSafeInteger(turn))
      ? { agent, turn }
      : null;
  }

  /* ★ 确定并留存「本轮生成前已确定的格式」（v12.6.1 从 formatsForToolDescription 抽出）。
     为什么要独立成方法：原实现把留存写在 formatsForToolDescription 的筛选流程里，
     而该方法有多条提前 return（无转录/转录为空）会【跳过留存】—— 那些情况下工具描述
     仍是「指定式」（因为全量里非代码格式恰好一套），但 determinedFormatFor 返回 undefined，
     写入路径退回旧的纯文本猜测（实测：谷清欢那条 fmt='' 即此因）。
     现在由 agent/pre-step 钩子每步直接调用，转录必然可得，不再依赖工具描述投影的路径。
     判据 = 【非代码格式恰好一套】：0 套（只有代码类）或多套（需模型选择）都清除。 */
  determineTurnFormat(agent, turn) {
    const sessionId = String(agent?.session?.id ?? '');
    if (!Number.isSafeInteger(turn)) return;
    const key = `${sessionId}:${turn}`;
    try {
      const rows = turnTranscript(agent.session, turn);
      const meaningful = Array.isArray(rows)
        ? rows.filter((row) => typeof row?.text === 'string' && row.text.trim().length > 0)
        : [];
      if (meaningful.length === 0) {
        this.turnDeterminedFormat.delete(key);
        return;
      }
      const active = this.activeFormats();
       /* 与蒸馏、memory_add 工具描述、显式「记住」提示同口径：
          仅一套激活格式时不做名称筛选；无可选择时它就是本轮格式。
          旧实现这里无条件 selectFormatsForText，导致单一自定义格式在本轮正文
          未出现格式名称时被筛空，而其它入口却直接注入/指定它。 */
       const selected = active.length === 1 ? active : selectFormatsForText(active, renderTranscript(meaningful));
      const nonCode = selected.filter((format) => format.id !== MEMORY_FORMAT_CODE_ID);
      if (nonCode.length === 1 && !selected.some((format) => format.id === MEMORY_FORMAT_CODE_ID)) {
        this.turnDeterminedFormat.set(key, nonCode[0].id);
        this.pruneTurnDeterminedFormat();
      } else {
        this.turnDeterminedFormat.delete(key);
      }
    } catch (error) {
      /* 重算异常时不能沿用同 key 的旧决定：提示词可能已退回全 active，
         旧格式会通过 prepareMemoryWrite 最高优先级分支与当前候选脱节。 */
      this.turnDeterminedFormat.delete(key);
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] determine turn format failed:`, error);
    }
  }

  /* 供 memory_add 的【工具参数描述】使用：按当前轮内容筛选格式清单。
     工具描述必须在轮次开始前投影，而 defineTextDescription 回调无参，
     故这里借 activeTurnRef 取回本轮转录，再走与蒸馏同一套 selectFormatsForText。
     任何一步取不到（无活跃轮次/转录为空/抛错）都退回全量 —— 描述内容宁可多，
     不可因筛选失败而让模型看不到任何格式。 */
  formatsForToolDescription() {
    const active = this.activeFormats();
    const ref = this.activeTurnRef;
    if (ref === null) return active;
    try {
      const rows = turnTranscript(ref.agent.session, ref.turn);
      if (!Array.isArray(rows) || rows.length === 0) return active;
      /* ⚠️ 空内容判定必须基于【原始行文本】，不能用 renderTranscript 的产物：
         渲染会给每行加上「### N. 角色」标题，即使正文全空白，渲染串也永不为空
         （实测 [{role:'用户',text:'   '}] → "### 1. 用户\n   "），
         用它做兜底会让「空转录」漏判、走进无意义的筛选。 */
      const meaningful = rows.filter((row) => typeof row?.text === 'string' && row.text.trim().length > 0);
      if (meaningful.length === 0) return active;
      const text = renderTranscript(meaningful);
      const selected = selectFormatsForText(active, text);
      /* 留存不在此处做（v12.6.1）：本方法有多条提前 return 会跳过留存，
         而工具描述仍显示「指定式」，导致描述与写入路径不一致。
         留存已抽到 determineTurnFormat，由 agent/pre-step 钩子每步调用。 */
      /* 筛空（只有「无内置代码类」时才可能）→ 保持空，让模型写纯文本；
         但若 active 本身为空则也返回空，语义一致。 */
      return selected;
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] format filter for tool description failed; falling back to all:`, error);
      return active;
    }
  }

  /* ── format_id 解析（写入路径）──
     三级优先级：① 调用方显式指定（工具参数/UI 选择）② 模型在蒸馏输出里给的「格式ID」
     ③ 正文键集合反推。任一级都必须通过「该 id 确实存在」的校验，否则降级到下一级 ——
     校验是必要的：UUID 形态让模型几乎编不出合法值，据 SELECT 结果即可当场识破伪造。 */
  formatById(formatId) {
    const value = normalizePlainText(formatId, 128);
    if (value.length === 0) return undefined;
    try {
      return this.listFormats().find((format) => format.id === value);
    } catch {
      return undefined;
    }
  }

  /* 把「候选 format_id + 已解析的正文」收敛为一个可落库的 id（'' = 无归属）。
     返回 { formatId, definition, missing, undeclared }：
       missing 非空 = 格式必需字段缺失；undeclared 非空 = 正文含格式未声明的字段。
     两者都由调用方决定是拒绝写入（工具/UI 路径，v12.2 起两者都拦）还是丢弃归属
     （蒸馏后台路径，绝不因格式问题丢正文）。
     bodyKeys 必须是【原始 JSON 键集合】（见 structuredBodyKeys），不能用已解析对象反推。
     toolSignals 仅蒸馏路径可得（本轮工具操作过哪些文件）；memory_add 路径传 undefined。
     allowInactive（v12.18）：显式指定的格式若已停用，是否仍采用。
       · false（默认）：停用格式视为无效 → 退回自动归属 → 通常落到「无归属」。
         用于【模型给出的 formatId】（工具参数/蒸馏输出）：模型可能照抄提示词里的
         「内置代码类为 fmt-code」而传一个已停用的 id，若照单采用就会出现
         「用户已停用该格式，记忆却仍被归属过去」（实测反馈）。
       · true：停用格式也照用。用于【用户明确操作/数据自带】的场景：
         UI 选择、编辑一条归属停用格式的旧记忆（其 format_id 就来自库里）、
         修订恢复（restoreRevision）等 —— 这些不是「猜」，而是既定事实。 */
  resolveFormatIdForWrite(candidateId, structured, bodyKeys = [], toolSignals = undefined, allowInactive = false, allowedFormatIds = undefined) {
    const validationBody = structuredBodyForValidation(structured);
    const allowed = normalizeAllowedFormatIdSet(allowedFormatIds);
    /* 显式指定（工具参数/UI 选择/记忆原有归属）：默认只接受【启用中】的格式。
       停用格式对模型而言是「不存在」（提示词不注入它），故模型给出停用 id 时应视为
       无效输入并退回自动归属，而不是照单全收。 */
    const explicit = this.formatById(candidateId);
    if (explicit !== undefined
      && (allowed === undefined || allowed.has(explicit.id))
      && (allowInactive || explicit.status === 'active')) {
      return {
        formatId: explicit.id,
        definition: explicit.definition,
        missing: missingFormatRequiredFields(validationBody, explicit.definition),
        undeclared: extraFormatUndeclaredFields(bodyKeys, explicit.definition)
      };
    }
    /* 键集合反推只对「已识别为结构化」的正文生效：纯文本记忆与格式无关，不猜归属。 */
    if (structured !== undefined) {
      /* ⚠️ 以下两条【自动归属】路径必须只认 active 格式（v12.14）：
         停用格式不参与提示词注入（三个注入点都经 activeFormats），模型根本不知道
         有这套格式；若自动归属仍把它算进来，就会出现「模型看不见、程序却按它归属」——
         且 strict 路径会因缺必需字段抛错，模型无法自纠（它不知道存在这套格式）。
         实测漏洞：formatById 不过滤 status，代码类停用后仍被自动归成 fmt-code。 */
      const activeFormats = this.activeFormats().filter((format) => allowed === undefined || allowed.has(format.id));
      /* ① 代码类优先：用 detectCodeMemoryClass 的真代码类判据（工具信号 + 文本特征），
         【不】用「位置/对象非空」这类结构化信号，也【不】用「位置」键存在与否
         ——「位置」是通用保留键，自定义格式完全可以声明它。 */
      const codeFormat = activeFormats.find((format) => format.id === MEMORY_FORMAT_CODE_ID);
      if (detectCodeMemoryClass({ content: structured.content }, toolSignals, structured.extra ?? {})) {
        if (codeFormat !== undefined) {
          /* 内置代码类【启用】→ 直接用它（用户明确前提：「如果不停用，那么就直接使用
             『代码类』格式」）。 */
          return {
            formatId: codeFormat.id,
            definition: codeFormat.definition,
            missing: missingFormatRequiredFields(validationBody, codeFormat.definition),
            undeclared: extraFormatUndeclaredFields(bodyKeys, codeFormat.definition)
          };
        }
        /* 内置代码类【停用】+ 判为代码类语义 → 用「代码」这词筛选启用中的自定义格式
           （v12.25，用户要求）。归属范围【严格限定在这几套候选内】（v12.26）：
             · 唯一命中 → 直接用；
             · 多套命中 → 在其中按字段键匹配选最贴合的一套；
             · 都选不出 / 一套都没命中 → 归【无归属】，绝不跑到名称不含「代码」的
               无关格式去（用户明确：「限定在含『代码』的候选中选…如果都不含『代码』时，
               就归『无归属』，不跑到无关格式」）。
           故此处命中代码类语义后【不再】继续走下方全量候选池的键集合反推。 */
        const hint = selectCodeHintFormats(activeFormats);
        const pool = Array.isArray(hint.matched) ? hint.matched : [];
        const picked = pool.length === 1
          ? pool[0]
          : (() => {
            if (pool.length === 0) return undefined;
            const inferred = inferFormatIdByKeys(bodyKeys, pool);
            return inferred === undefined ? undefined : pool.find((entry) => entry.id === inferred);
          })();
        if (picked !== undefined) {
          return {
            formatId: picked.id,
            definition: picked.definition,
            missing: missingFormatRequiredFields(validationBody, picked.definition),
            undeclared: extraFormatUndeclaredFields(bodyKeys, picked.definition)
          };
        }
        return { formatId: '', definition: undefined, missing: [], undeclared: [] };
      }
      const inferred = inferFormatIdByKeys(bodyKeys, activeFormats);
      const format = inferred === undefined ? undefined : activeFormats.find((entry) => entry.id === inferred);
      if (format !== undefined) {
        return {
          formatId: format.id,
          definition: format.definition,
          missing: missingFormatRequiredFields(validationBody, format.definition),
          undeclared: extraFormatUndeclaredFields(bodyKeys, format.definition)
        };
      }
    }
    return { formatId: '', definition: undefined, missing: [], undeclared: [] };
  }

  /* 写入前的统一入口：解析格式归属 → 生成正文 → 返回 { body, formatId }。
     strict = true（工具/UI/手动路径）：命中格式但必需字段缺失时抛错，让用户当场看到问题；
     strict = false（蒸馏等后台路径）：丢弃 format_id 降级为无归属，绝不因为格式问题丢正文。
     toolSignals 仅蒸馏路径可得，用于「本轮工具操作过代码文件 → 代码类」这一最强判据；
     memory_add/UI 路径传 undefined，代码类归属退化为文本特征判定（或不归属）。
     determinedFormat（v12.6）：本轮【生成前】已确定的格式（见 turnDeterminedFormat）。
     它的优先级高于一切事后猜测 —— 用户明确要求「先定格式、再用格式驱动生成」，
     不允许靠代码特征词事后猜（实测「自成一方【法】则」被跨词误匹配成「方法」→ 误判代码类，
     把角色记忆包成 位置/对象/内容/踩坑 四键）。传 undefined 时行为与改造前一致。 */
  prepareMemoryWrite(text, { formatId, strict = true, toolSignals = undefined, determinedFormat = undefined, allowInactiveFormat = false, allowedFormatIds = undefined } = {}) {
    const allowed = normalizeAllowedFormatIdSet(allowedFormatIds);
    const raw = normalizePlainText(text, Number.MAX_SAFE_INTEGER);
    if (raw.length === 0) return { body: '', formatId: '' };
    const structured = parseStructuredMemoryBody(raw);
    /* ⚠️ 原始 JSON 必须【无条件】解析：bodyKeys 是「未声明字段校验」与「键集合反推」的
       唯一依据，此前只在 structured === undefined 时才解析，导致正文是合法结构化 JSON
       （即绝大多数情况）时 bodyKeys 恒为空 —— 多余字段检查静默失效、反推也失效。 */
    let parsedJson;
    if (/^\s*[{[]/.test(raw)) {
      try { parsedJson = JSON.parse(raw); } catch { parsedJson = undefined; }
    }
    const bodyKeys = parsedJson === undefined ? [] : structuredBodyKeys(parsedJson);
    /* ── 生成前已定格式的优先处理（v12.6）──
       本轮若已确定非代码类格式（如「新建一个修仙角色」→ 角色类），则：
         · 正文已是 JSON → 归属直接用该格式（跳过特征词猜测与键集合反推）；
         · 正文是【字段式纯文本】（「名称：X。年龄：…」）→ v12.6.2 起直接按该格式
           声明的字段抽取值、组装成该格式的 JSON（信息本来就在，只是没套外壳），
           归属该格式；这比拒绝重试更符合「格式已知就直接按它填充」的语义；
         · 纯文本里连字段名都没有 → 与格式无关，strict 拒绝并指明该按哪些字段写，
           后台路径保持纯文本且不归属（绝不包装成代码类四键）。 */
    if (determinedFormat !== undefined
      && (allowed === undefined || allowed.has(determinedFormat.id))
      && determinedFormat.id !== MEMORY_FORMAT_CODE_ID
      && (determinedFormat.status === 'active' || allowInactiveFormat)) {
      /* ⚠️ 结构化判定必须用 allowExtraOnly：自定义格式（角色类/日记类）的字段
         完全不含已知保留名（位置/对象/内容/踩坑），parseStructuredMemoryBody 会返回
         undefined —— 若据此判「不是 JSON」，合法的角色类六键正文会被误拒。
         这里直接以「原始 JSON 是对象」为准，字段合法性交给下方 required/undeclared 校验。 */
      const isJsonObject = parsedJson !== null && typeof parsedJson === 'object' && !Array.isArray(parsedJson);
      let determinedStructured = isJsonObject
        ? (structured ?? structuredMemoryFields(parsedJson, { allowExtraOnly: true }))
        : undefined;
      let determinedKeys = bodyKeys;
      /* 字段式纯文本兜底：按格式字段抽取并组装（不猜测，只认「字段名：」这种确定写法）。 */
      if (determinedStructured === undefined) {
        const extracted = extractFormatFieldsFromText(raw, determinedFormat.definition);
        if (extracted !== undefined) {
          determinedStructured = structuredMemoryFields(extracted.json, { allowExtraOnly: true });
          determinedKeys = Object.keys(extracted.json);
        }
      }
      if (determinedStructured === undefined) {
        /* ⚠️ 纯文本兜底（v12.30，v12.31 起为最后防线）：正文既不是 JSON、也没有
           「字段名：」写法时，不直接放弃 —— 蒸馏输出协议已跟随记忆格式（v12.31），
           但模型仍可能不守协议输出叙述性纯文本（没有格式字段、也没有字段式写法），
           三条自动归属路径会全数落空。处理：把整段正文塞进该格式【第一个 string 类型
           字段】（优先「内容/content/摘要/正文/描述/说明」语义字段，取不到则取第一个
           string 字段）。字面量场景（UI 手动新建）不走 strict=false，若必填缺失仍会
           抛错提示用户 —— 行为不回退。 */
        const fallbackField = determinedFormat.definition.fields.find((field) => (
          field.type !== 'string[]' && ['内容', 'content', '摘要', '正文', '描述', '说明'].includes(field.key)
        )) ?? determinedFormat.definition.fields.find((field) => field.type !== 'string[]');
        if (fallbackField !== undefined && raw.trim().length >= 6) {
          const json = { [fallbackField.key]: raw.trim() };
          determinedStructured = structuredMemoryFields(json, { allowExtraOnly: true });
          determinedKeys = [fallbackField.key];
        }
      }
      if (determinedStructured === undefined) {
        const reason = 'memory-format-plain-text-rejected';
        const detail = `本轮已确定为「${determinedFormat.name}」格式，但正文里找不到该格式的字段。`
          + `请按这些字段写正文（可用 JSON，也可用「字段名：值」的形式）：${determinedFormat.definition.fields.map((field) => field.key).join('、')}。`;
        if (strict) throw new MemoryError(reason, detail);
        return { body: raw, formatId: '' };
      }
      const determinedBody = structuredBodyForValidation(determinedStructured);
      const missing = missingFormatRequiredFields(determinedBody, determinedFormat.definition);
      const undeclared = extraFormatUndeclaredFields(determinedKeys, determinedFormat.definition);
      if (missing.length > 0) {
        if (strict) throw new MemoryError('memory-format-required-missing', `format "${determinedFormat.id}" requires: ${missing.join(', ')}`);
        /* v12.30/v12.31：蒸馏路径（strict=false）缺失必填字段时【保留归属】——
           蒸馏输出协议已跟随记忆格式（v12.31），提示词明确允许「本轮确实没有对应信息的
           字段输出空值」（如「代码」格式的 位置=[]），这是协议的预期形态而非模型错误；
           空壳也是格式骨架的一部分（见 structuredContentBody 注释）。丢归属会让
           「停用内置代码类 + 唯一自建格式」的场景永远无归属（用户四次实测反馈）。
           L0 本身就表示格式已确定（determinedFormat 非空且非内置代码类），
           missing 只是本轮信息缺失，不是形状错误（形状错误走下方 undeclared）。
           strict=true（UI/工具路径）仍抛错：人工写入应提醒补全，不静默塞空壳。 */
        return { body: this.renderMemoryBody(raw, determinedStructured, determinedFormat.definition.order, determinedFormat.definition), formatId: determinedFormat.id };
      }
      if (undeclared.length > 0) {
        if (strict) throw new MemoryError('memory-format-undeclared-fields', `format "${determinedFormat.id}" does not declare: ${undeclared.join(', ')}`);
        return { body: this.renderMemoryBody(raw, determinedStructured, undefined), formatId: '' };
      }
      /* ⚠️ 落库源必须是【组装后的 JSON】，不能再用 raw：
         若 raw 是字段式纯文本，normalizeMemoryBodyForWrite(raw) 会把它当纯文本存下，
         抽取出的字段等于白抽（这正是本分支要避免的结果）。
         这里直接用 determinedStructured + 格式 order 渲染成规范正文。 */
      return { body: this.renderMemoryBody(raw, determinedStructured, determinedFormat.definition.order, determinedFormat.definition), formatId: determinedFormat.id };
    }
    /* 「只含自定义字段」的 JSON（不含任何已知保留名）：v12 起也允许按结构化处理，
       前提是它归属的格式确实声明了这些字段 —— 这样 {"日期":..,"心情":..} 这类
       完全不写 对象/内容的自定义格式才真正可用。归属未确定时不启用，
       避免把 {"foo":"bar"} 这种普通 JSON 误判成结构化记忆。 */
    const extraOnly = structured === undefined && bodyKeys.length > 0
      ? structuredMemoryFields(parsedJson, { allowExtraOnly: true })
      : undefined;
    const candidate = structured ?? extraOnly;
    const requestedId = normalizePlainText(formatId, 128);
    let resolved = this.resolveFormatIdForWrite(requestedId, candidate, bodyKeys, toolSignals, allowInactiveFormat, allowed);
    /* ★ 字段指纹匹配（v12.7，纯文本专属兜底）：
       「保存」这类短消息场景下，名称匹配（selectFormatsForText）与键集合反推都会失效
       —— 用户输入只有两个字、正文虽是「名称：X。年龄：…」的字段式纯文本但不带 JSON 键。
       此时对每个激活的非代码格式用 extractFormatFieldsFromText 试抽：正文里以
       「字段名：」形式出现的字段越多，越说明模型在按那套格式写。命中数 ≥2 且唯一最高
       （领先次名 ≥2）即归属该格式，并直接用抽取结果组装正文（这正是「格式已知就按它填充」）。
       代码类不参与（它有固定归属规则）；JSON 正文不走这里（已有键集合反推）。 */
    if (resolved.formatId === '' && structured === undefined && extraOnly === undefined
      && requestedId.length === 0 && !/^\s*[{[]/.test(raw)) {
      const fingerprint = this.matchFormatByFieldFingerprint(raw, allowed);
      if (fingerprint !== undefined) {
        const extracted = extractFormatFieldsFromText(raw, fingerprint.definition);
        if (extracted !== undefined && extracted.filled >= 2) {
          const fpStructured = structuredMemoryFields(extracted.json, { allowExtraOnly: true });
          const missing = missingFormatRequiredFields(structuredBodyForValidation(fpStructured), fingerprint.definition);
          if (missing.length === 0) {
            resolved = {
              formatId: fingerprint.id,
              definition: fingerprint.definition,
              missing: [],
              undeclared: []
            };
            /* 用抽取结果替换 candidate：下方落库要按组装后的 JSON 渲染。 */
            return {
              body: this.renderMemoryBody(raw, fpStructured, fingerprint.definition.order, fingerprint.definition),
              formatId: fingerprint.id
            };
          }
        }
      }
    }
    /* ★ extraOnly 的二次把关：即便归属成功，也必须确认「正文至少有键被该格式声明」。
       否则反推若给出一个与正文毫不相关的格式（键集合凑巧通过子集判定），
       就会把 {"foo":"bar"} 落成一条带格式归属的结构化记忆 —— 凭空造结构。
       不满足则退回纯文本语义（不使用 extraOnly）。 */
    const extraOnlyUsable = resolved.formatId !== '' && extraOnly !== undefined
      && Array.isArray(resolved.definition?.fields)
      && resolved.definition.fields.some((field) => bodyKeys.includes(field?.key));
    /* 显式给了 id 但没被采用：两种情形要分开（v12.18）。
       ① 格式【真的不存在】（模型编造/已被删除）→ explicitMissing，strict 路径抛错，
          让模型知道 id 无效并重试（悬空引用必须拦下）。
       ② 格式【存在但已停用】且调用方不放行 → 属「该格式不在本轮可选项里」，
          与「不存在」对模型而言等价，但【不该抛错】：模型无法知道它被停用，
          报错只会让它困惑甚至像历史上那样放弃传 formatId。静默退回自动归属即可 ——
          自动归属本身只认 active 格式，故最终落到「无归属」，正是用户期望的结果。 */
    const requestedRow = requestedId.length === 0 ? undefined : this.formatById(requestedId);
    const requestedUnavailable = requestedRow !== undefined
      && ((requestedRow.status !== 'active' && !allowInactiveFormat)
        || (allowed !== undefined && !allowed.has(requestedRow.id)));
    const explicitMissing = requestedId.length > 0 && resolved.formatId !== requestedId && !requestedUnavailable;
    /* v12.2 两种违规都拦（用户要求多余字段也阻止）：
       缺必需字段 + 含未声明字段，strict 路径都拒绝；蒸馏路径都只丢归属保正文。 */
    if (resolved.formatId !== '' && resolved.missing.length > 0) {
      if (strict) {
        throw new MemoryError('memory-format-required-missing', `format "${resolved.formatId}" requires: ${resolved.missing.join(', ')}`);
      }
      return { body: this.renderMemoryBody(raw, candidate, undefined), formatId: '' };
    }
    if (resolved.formatId !== '' && resolved.undeclared.length > 0) {
      if (strict) {
        throw new MemoryError('memory-format-undeclared-fields', `format "${resolved.formatId}" does not declare: ${resolved.undeclared.join(', ')}`);
      }
      return { body: this.renderMemoryBody(raw, candidate, undefined), formatId: '' };
    }
    if (explicitMissing && strict) {
      throw new MemoryError('format-not-found', 'memory format was not found', 404);
    }
    /* extraOnly 只在「归属成功 + 正文键命中格式声明」时采用：无归属的「纯自定义字段 JSON」
       维持旧行为（按纯文本落库），保证改造前后同输入同结果，且不会凭空造出结构。 */
    if (extraOnlyUsable) {
      return { body: this.renderMemoryBody(raw, extraOnly, resolved.definition?.order, resolved.definition), formatId: resolved.formatId };
    }
    if (resolved.formatId !== '' && candidate !== undefined) {
      return { body: this.renderMemoryBody(raw, candidate, resolved.definition?.order, resolved.definition), formatId: resolved.formatId };
    }
    return { body: normalizeMemoryBodyForWrite(raw, resolved.definition?.order, this.hasActiveCodeFormat()), formatId: resolved.formatId };
  }

  /* 把已解析的结构体渲染为落库正文（含正文净化与顺序重排）。
     extraOnly 路径必须走这里：normalizeMemoryBodyForWrite 会因为「无已知保留名」
     而拒绝把它当结构化，直接退回纯文本。 */
  renderMemoryBody(raw, structured, formatOrder, formatDefinition = undefined) {
    if (structured === undefined) return normalizeMemoryBodyForWrite(raw, formatOrder, this.hasActiveCodeFormat());
    const content = sanitizeDistilledContent(structured.content);
    const pitfall = sanitizeDistilledContent(structured.pitfall);
    return structuredContentBody(structured.paths, structured.symbols, content, pitfall, structured.extra, formatOrder, formatDefinition);
  }

  createFormat(input = {}) {
    const name = normalizePlainText(input.name, MAX_FORMAT_NAME_LENGTH).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ');
    if (name.length === 0) throw new MemoryError('invalid-format-name', 'format name must not be empty');
    const definition = normalizeFormatDefinition(input.definition ?? input);
    if (definition === undefined) throw new MemoryError('invalid-format-definition', 'format must declare at least one field');
    /* 名称全库唯一（v12.13，用户要求「格式名称已存在就直接阻止保存并提示错误」）：
       旧行为是 INSERT OR IGNORE + 活动日志记 duplicate —— 静默吞掉，UI 看起来像保存成功
       但列表里没变化。现在改成与 updateFormat 同款的显式抛错，让前端给出明确提示。 */
    const existing = this.db.prepare('SELECT id FROM memory_formats WHERE name = ?').get(name);
    if (existing !== undefined) throw new MemoryError('duplicate-format-name', 'format name is already in use');
    const activity = this.beginActivity('format_create', { sessionTitle: '', summary: activitySummaryText(name), triggerKind: 'manual' });
    try {
      this.db.prepare('INSERT INTO memory_formats (id, name, builtin, status, definition, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?, ?)')
        .run(id('fmt'), name, normalizeStatus(input.status, 'active'), JSON.stringify(definition), now(), now());
      this.finishActivity(activity, 'success');
    } catch (error) {
      this.finishActivity(activity, 'failed', { errorCode: error?.code, errorMessage: error?.message || String(error) });
      throw error;
    }
  }

  /* 编辑格式定义：内置「代码类」仅可添加/编辑扩展字段，名称固定、默认字段必须与预置定义完全一致；其它内置仍只读。 */
  updateFormat(input = {}) {
    const formatId = normalizePlainText(input.formatId ?? input.id, 128);
    const row = this.db.prepare('SELECT * FROM memory_formats WHERE id = ?').get(formatId);
    if (row === undefined) throw new MemoryError('format-not-found', 'format was not found', 404);
    const builtinPreset = row.builtin === 1 && formatId === MEMORY_FORMAT_CODE_ID
      ? MEMORY_PRESET_FORMATS.find((format) => format.id === MEMORY_FORMAT_CODE_ID)
      : undefined;
    /* 内置格式仅 fmt-code（代码类）允许编辑；以后新增的任何其它 builtin 默认继续只读。 */
    if (row.builtin === 1 && (formatId !== MEMORY_FORMAT_CODE_ID || builtinPreset === undefined)) {
      throw new MemoryError('preset-format-readonly', 'only the built-in code format can be edited');
    }
    const name = input.name === undefined
      ? row.name
      : normalizePlainText(input.name, MAX_FORMAT_NAME_LENGTH).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ');
    if (name.length === 0) throw new MemoryError('invalid-format-name', 'format name must not be empty');
    if (builtinPreset !== undefined && name !== row.name) {
      throw new MemoryError('preset-format-name-readonly', 'built-in code format name cannot be changed');
    }
    const definition = input.definition === undefined
      ? normalizeFormatDefinition(row.definition)
      : normalizeFormatDefinition(input.definition);
    if (definition === undefined) throw new MemoryError('invalid-format-definition', 'format must declare at least one field');

    /* 名称全库唯一：在写 SQL 前给出稳定错误，而不是泄漏 SQLite constraint 文案。 */
    const nameConflict = this.db.prepare('SELECT id FROM memory_formats WHERE name = ? AND id <> ?').get(name, formatId);
    if (nameConflict !== undefined) throw new MemoryError('duplicate-format-name', 'format name is already in use');

    if (builtinPreset !== undefined) {
      const presetDefinition = normalizeFormatDefinition(builtinPreset.definition);
      const presetKeys = new Set(presetDefinition.fields.map((field) => field.key));
      const incomingByKey = new Map(definition.fields.map((field) => [field.key, field]));
      for (const expected of presetDefinition.fields) {
        const actual = incomingByKey.get(expected.key);
        if (actual === undefined
          || actual.type !== expected.type
          || actual.required !== expected.required
          || String(actual.desc ?? '') !== String(expected.desc ?? '')) {
          throw new MemoryError('preset-format-fields-readonly', `default field "${expected.key}" cannot be edited or removed`);
        }
      }
      const expectedOrder = presetDefinition.order.filter((key) => presetKeys.has(key));
      const incomingPresetOrder = definition.order.filter((key) => presetKeys.has(key));
      if (incomingPresetOrder.length !== expectedOrder.length || incomingPresetOrder.some((key, index) => key !== expectedOrder[index])) {
        throw new MemoryError('preset-format-fields-readonly', 'default code-format field order cannot be changed');
      }
    }

    const activity = this.beginActivity('format_update', { sessionTitle: '', summary: activitySummaryText(name), triggerKind: 'manual' });
    try {
      this.db.prepare('UPDATE memory_formats SET name = ?, definition = ?, updated_at = ? WHERE id = ?')
        .run(name, JSON.stringify(definition), now(), formatId);
      this.finishActivity(activity, 'success');
    } catch (error) {
      this.finishActivity(activity, 'failed', { errorCode: error?.code, errorMessage: error?.message || String(error) });
      throw error;
    }
  }

  /* 激活/停用：仅非 fmt-code 内置格式保持只读；fmt-code 可按用户要求启停，
     普通自定义格式同样可切换状态。 */
  setFormatStatus(input = {}) {
    const formatId = normalizePlainText(input.formatId ?? input.id, 128);
    const row = this.db.prepare('SELECT * FROM memory_formats WHERE id = ?').get(formatId);
    if (row === undefined) throw new MemoryError('format-not-found', 'format was not found', 404);
    /* 内置格式的状态可编辑范围（v12.13，用户要求「内置的代码类状态可以编辑」）：
       仅 fmt-code（代码类）允许启停 —— 它是内置格式里唯一可编辑的一套（与 updateFormat 同口径）；
       以后新增的其它 builtin 默认继续只读。 */
    if (row.builtin === 1 && formatId !== MEMORY_FORMAT_CODE_ID) return;
    const nextStatus = normalizeStatus(input.status, 'active');
    const statusText = { active: '已启用', inactive: '已停用' };
    const summary = `${row.name}：${statusText[row.status] || row.status} → ${statusText[nextStatus] || nextStatus}`;
    const activity = this.beginActivity('format_update', { sessionTitle: '', summary: activitySummaryText(summary), triggerKind: 'manual' });
    try {
      this.db.prepare('UPDATE memory_formats SET status = ?, updated_at = ? WHERE id = ?').run(nextStatus, now(), formatId);
      this.finishActivity(activity, 'success', { summary: activitySummaryText(summary) });
    } catch (error) {
      this.finishActivity(activity, 'failed', { errorCode: error?.code, errorMessage: error?.message || String(error) });
      throw error;
    }
  }

  /* 删除格式：内置拒绝。已用该格式写过的记忆【正文不受影响】——字段名已固化在各自 body 里；
     但归属引用必须就地重置为 ''（无归属），否则会留下指向不存在格式的悬空 format_id，
     读取侧按 id 查定义会全部落空、卡片显示「归属未知」。 */
  deleteFormat(input = {}) {
    const formatId = normalizePlainText(input.formatId ?? input.id, 128);
    const row = this.db.prepare('SELECT * FROM memory_formats WHERE id = ?').get(formatId);
    if (row === undefined) throw new MemoryError('format-not-found', 'format was not found', 404);
    if (row.builtin === 1) throw new MemoryError('preset-format-readonly', 'builtin formats cannot be deleted');
    const activity = this.beginActivity('format_delete', { sessionTitle: '', summary: activitySummaryText(row.name), triggerKind: 'manual' });
    try {
      /* 重置在删除【之前】执行：若先删格式再重置而中途失败，会留下悬空引用。
         重置是幂等的（WHERE format_id = ?），失败重试无副作用。 */
      const reset = this.db.prepare("UPDATE memories SET format_id = '' WHERE format_id = ?").run(formatId).changes;
      this.db.prepare('DELETE FROM memory_formats WHERE id = ?').run(formatId);
      this.ctx.logger?.info?.(`[${PLUGIN_NAME}] memory format deleted ${JSON.stringify({ formatId, name: row.name, detached: reset })}`);
      this.finishActivity(activity, 'success');
    } catch (error) {
      this.finishActivity(activity, 'failed', { errorCode: error?.code, errorMessage: error?.message || String(error) });
      throw error;
    }
  }

  ensureTags(tagNames, { approximateReuse = true } = {}) {
    const requested = uniqueStrings(tagNames, MAX_TAGS_PER_MEMORY).map(normalizeTagName).filter(Boolean);
    const names = [...new Set(requested.map((name) => approximateReuse ? this.reuseTagName(name) : name))];
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

  setMemoryTags(memoryId, tagNames, { preserveNames = [] } = {}) {
    const memory = this.db.prepare('SELECT directory_id FROM memories WHERE id = ?').get(memoryId);
    const directoryIds = memory?.directory_id ? [memory.directory_id] : [];
    const canonicalNames = this.canonicalMemoryTagNames(tagNames, directoryIds, preserveNames);
    /* 此处已按目标项目规范化，关闭全库近似复用，防新标签被另一个项目里的泛词吞并。 */
    const tags = this.ensureTags(canonicalNames, { approximateReuse: false });
    this.db.prepare('DELETE FROM memory_tag_links WHERE memory_id = ?').run(memoryId);
    const insert = this.db.prepare('INSERT OR IGNORE INTO memory_tag_links (memory_id, tag_id) VALUES (?, ?)');
    for (const tag of tags.slice(0, MAX_TAGS_PER_MEMORY)) insert.run(memoryId, tag.id);
  }

  persistentByHash(hash, directoryId) {
    const scopeId = normalizePlainText(directoryId, 128);
    if (!scopeId) return undefined;
    return this.db.prepare('SELECT id FROM memories WHERE content_hash = ? AND directory_id = ?').get(hash, scopeId)?.id;
  }

  addEphemeralMemory({ text, tags, session, sourceTurn, distillUsage, directoryId, creationMethod, eventTime, validUntil, formatId, toolSignals, determinedFormat, allowedFormatIds }) {
    /* 格式归属在蒸馏阶段就解析好（strict:false —— 后台路径校验失败只丢归属，
       绝不因为格式问题丢正文）。toolSignals 让「本轮工具操作过代码文件」这一
       最强判据生效，这是蒸馏路径相对 memory_add 的独有能力。
       ⚠️ determinedFormat 必须一并传入（v12.28）：此前只有 memory_add 路径传它，
       蒸馏路径漏传 → L0「生成前已定格式」分支在蒸馏时完全不生效。当用户停用了内置
       代码类、只留一套自建格式（如「代码」）时，蒸馏产物是纯文本（既无 JSON 键供
       键集合反推、也无「字段名：」供字段指纹匹配），三条自动归属路径全数落空 →
       明明有唯一可用的格式却归成 fmt=''（实测反馈：「激活了自建的『代码』格式，
       但蒸馏没有使用它，而是无归属」）。 */
    const prepared = this.prepareMemoryWrite(text, {
      formatId,
      strict: false,
      toolSignals,
      determinedFormat,
      allowedFormatIds
    });
    const body = prepared.body;
    if (body.length < 6) return { status: 'skipped', reason: 'memory-too-short' };
    const hash = memoryHash(body);
    const targetDirectoryId = this.resolveToolDirectoryId(
      directoryId ? { directoryId } : {}, String(session.id), body, { asReadOnly: true }
    );
    const persistentId = this.persistentByHash(hash, targetDirectoryId);
    if (persistentId !== undefined) return { status: 'duplicate', memoryId: persistentId };
    /* 蒸馏抽到的事实时间：格式不合法时丢弃该字段而非拒绝整条记忆
       （蒸馏是后台流程，可选字段解析失败不该让内容丢失）。 */
    let factEventTime;
    let factValidUntil;
    try {
      factEventTime = parseFactTime(eventTime, { label: 'eventTime' });
      factValidUntil = parseValidUntil(validUntil);
      assertFactTimeOrder(factEventTime, factValidUntil);
    } catch {
      factEventTime = undefined;
      factValidUntil = undefined;
    }
    for (const item of this.ephemeral.values()) {
      if (item.hash === hash && item.directoryId === targetDirectoryId) {
        item.updatedAt = now();
        const distilled = normalizeTokenUsage(distillUsage);
        if (distilled !== undefined) item.distillUsage = distilled;
        if (!item.creationMethod) item.creationMethod = normalizeCreationMethod(creationMethod);
        if (Number.isSafeInteger(sourceTurn)) item.sourceTurn = sourceTurn;
        /* 同文重复只补空字段，不覆盖已有值（已有值多半更接近事实源）。 */
        if (factEventTime !== undefined && !(Number(item.eventTime) > 0)) item.eventTime = factEventTime;
        if (factValidUntil !== undefined && !(Number(item.validUntil) > 0)) item.validUntil = factValidUntil;
        if (prepared.formatId !== '' && !item.formatId) item.formatId = prepared.formatId;
        return { status: 'duplicate', memoryId: item.id };
      }
    }
    const stamp = now();
    const resolvedDirectoryId = targetDirectoryId ?? this.resolveToolDirectoryId(
      directoryId ? { directoryId } : {}, String(session.id), body
    );
    const directory = this.db.prepare('SELECT id, name FROM memory_directories WHERE id = ?').get(resolvedDirectoryId);
    const canonicalTags = this.canonicalMemoryTagNames(normalizeTagNames(tags, body), directory?.id ? [directory.id] : []);
    const item = {
      id: id('mem'),
      text: body,
      tags: canonicalTags,
      /* 蒸馏产物一律 active（原按正文是否 JSON 区分，会把纯文本记忆静默冻结）。 */
      status: 'active',
      directoryId: directory?.id ?? null,
      directoryName: directory?.name ?? null,
      hash,
      sourceSessionId: String(session.id),
      sourceSessionTitle: sessionTitle(session),
      sourceTurn: Number.isSafeInteger(sourceTurn) ? sourceTurn : undefined,
       creationMethod: normalizeCreationMethod(creationMethod),
      distillUsage: normalizeTokenUsage(distillUsage),
      eventTime: factEventTime,
      validUntil: factValidUntil,
      formatId: prepared.formatId,
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
      /* UI 手动新建：格式由用户在下拉里明确选定 → 放行停用格式（用户意图优先）。 */
      const prepared = this.prepareMemoryWrite(input.text, { formatId: input.formatId, strict: true, allowInactiveFormat: true });
      const body = prepared.body;
      if (body.length < 6) throw new MemoryError('invalid-memory-text', 'memory text must be at least 6 characters');
      const hash = memoryHash(body);
      const duplicate = this.persistentByHash(hash, directoryId);
      if (duplicate !== undefined) {
        this.finishActivity(activity, 'duplicate', { memoryId: duplicate, summary: activitySummaryText(body) });
        return duplicate;
      }
      const stamp = now();
      const persistentId = id('mem');
      /* UI 手动新建默认 manual；仅供未来导入入口以 options.creationMethod 显式标记 import。 */
      const creationMethod = normalizeCreationMethod(options.creationMethod) || 'manual';
      const eventTime = parseFactTime(input.eventTime, { label: 'eventTime' });
      const validUntil = parseValidUntil(input.validUntil);
      assertFactTimeOrder(eventTime, validUntil);
      this.db.prepare('INSERT INTO memories (id, directory_id, body, status, content_hash, creation_method, created_at, updated_at, last_recalled_at, event_time, valid_until, format_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)')
        .run(persistentId, directoryId, body, normalizeStatus(input.status, 'active'), hash, creationMethod, stamp, stamp, eventTime ?? null, validUntil ?? null, prepared.formatId);
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
      /* 格式归属优先取调用方显式给的，其次保留临时记忆上已解析的归属
         （蒸馏时算好的 formatId 不能在这一步丢掉），都没有则按正文反推。 */
      const prepared = this.prepareMemoryWrite(input.text ?? item.text, {
        formatId: input.formatId ?? item.formatId,
        strict: true,
        /* 转正：formatId 来自【UI/工具显式传参】或【临时记忆上已解析好的归属】
           （后者在蒸馏阶段已按 active 过滤过），都属既定事实，放行停用格式。 */
        allowInactiveFormat: true
      });
      /* 三态一致：UI 显式传空串就是清除归属，不能在 prepareMemoryWrite 的
         自动反推阶段又把正文重新归到某个 active 格式。updateMemory 已有同样门控；
         转正必须保持一致。 */
      const preparedFormatId = input.formatId === '' ? '' : prepared.formatId;
      const body = prepared.body;
      if (body.length < 6) throw new MemoryError('invalid-memory-text', 'memory text must be at least 6 characters');
      const directoryId = input.directoryId ? normalizePlainText(input.directoryId, 128) : this.resolveToolDirectoryId(input, item.sourceSessionId, body);
      const directory = this.db.prepare('SELECT id FROM memory_directories WHERE id = ?').get(directoryId);
      if (directory === undefined) throw new MemoryError('directory-not-found', 'directory was not found', 404);
      const hash = memoryHash(body);
      const duplicate = this.persistentByHash(hash, directoryId);
      if (duplicate !== undefined) {
        this.ephemeral.delete(memoryId);
        this.finishActivity(activity, 'duplicate', { memoryId: duplicate, summary: activitySummaryText(body) });
        return duplicate;
      }
      const tagNames = Array.isArray(input.tagNames) ? input.tagNames : item.tags;
      const stamp = now();
      const persistentId = id('mem');
      /* 事实时间随临时记忆转正一并落库（蒸馏抽取的字段不能在这一步丢掉）。 */
      const eventTime = parseFactTime(input.eventTime ?? item.eventTime, { label: 'eventTime' });
      const validUntil = parseValidUntil(input.validUntil ?? item.validUntil);
      assertFactTimeOrder(eventTime, validUntil);
      /* 临时记忆转正：创建方式与 last_recalled_at 均随迁，保留最初来源。 */
      this.db.prepare('INSERT INTO memories (id, directory_id, body, status, content_hash, creation_method, created_at, updated_at, last_recalled_at, pinned, event_time, valid_until, format_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(persistentId, directoryId, body, normalizeStatus(input.status, 'active'), hash, normalizeCreationMethod(item.creationMethod), stamp, stamp, Number(item.lastRecalledAt) || 0, input.pinned === true ? 1 : 0, eventTime ?? null, validUntil ?? null, preparedFormatId);
      this.setMemoryTags(persistentId, tagNames, { preserveNames: item.tags });
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
    const ephemeralPreviousTags = ephemeral !== undefined && Array.isArray(ephemeral.tags) ? [...ephemeral.tags] : [];
    /* 差异记录的前置快照（正文/状态/固定/标签/项目）：必须在改动前取，
       供 memoryUpdateActivitySummary 生成 before/after 对比。 */
    const beforeSnapshot = memoryActivitySnapshot(this.memoryById(memoryId));
    const manualActivity = options.logActivity === true ? this.beginActivity('memory_update', { memoryId, sessionId: ephemeral !== undefined ? String(ephemeral.sourceSessionId || '') : '', sessionTitle: ephemeral !== undefined ? String(ephemeral.sourceSessionTitle || '') : options.sessionTitle || '', ...(options.triggerKind === undefined ? {} : { triggerKind: options.triggerKind }), summary: '' }) : null;
    if (ephemeral !== undefined) {
      try {
        if (input.text !== undefined) {
          const prepared = this.prepareMemoryWrite(input.text, {
            formatId: input.formatId === undefined ? ephemeral.formatId : input.formatId,
            strict: true,
            /* 不传 formatId = 保留临时记忆已有归属（既定事实，可放行停用）；
               显式传入 id 时，只有 UI 的 allowInactiveFormat 才允许停用格式，
               memory_update 工具传入的停用 id 必须退回自动归属/无归属。 */
            allowInactiveFormat: input.formatId === undefined || options.allowInactiveFormat === true,
            allowedFormatIds: options.allowedFormatIds
          });
          const text = prepared.body;
          if (text.length < 6) throw new MemoryError('invalid-memory-text', 'memory text must be at least 6 characters');
          ephemeral.text = text;
          ephemeral.hash = memoryHash(text);
          ephemeral.formatId = input.formatId === '' ? '' : prepared.formatId;
        } else if (input.formatId !== undefined) {
          /* 只改归属、不改正文：同样按目标格式重排键序，保持正文与归属一致。 */
          const prepared = this.prepareMemoryWrite(ephemeral.text, {
            formatId: input.formatId,
            strict: true,
            allowInactiveFormat: options.allowInactiveFormat === true,
            allowedFormatIds: options.allowedFormatIds
          });
          ephemeral.text = prepared.body;
          ephemeral.hash = memoryHash(prepared.body);
          ephemeral.formatId = input.formatId === '' ? '' : prepared.formatId;
        }
        if (input.status !== undefined) ephemeral.status = normalizeStatus(input.status, ephemeral.status);
        if (input.directoryId !== undefined) {
          /* 临时记忆的项目可重指派：目录必须存在，空串表示清除为「无项目」。 */
          const directoryId = normalizePlainText(input.directoryId, 128);
          if (directoryId === '') {
            ephemeral.directoryId = null;
            ephemeral.directoryName = null;
          } else {
            const directory = this.db.prepare('SELECT id, name FROM memory_directories WHERE id = ?').get(directoryId);
            if (directory === undefined) throw new MemoryError('directory-not-found', 'directory was not found', 404);
            ephemeral.directoryId = directory.id;
            ephemeral.directoryName = directory.name;
          }
        }
        if (Array.isArray(input.tagNames)) {
          const directoryIds = ephemeral.directoryId ? [ephemeral.directoryId] : [];
          ephemeral.tags = this.canonicalMemoryTagNames(input.tagNames, directoryIds, ephemeralPreviousTags);
        }
        /* 事实时间三态与持久分支保持一致：undefined = 保持；''/null = 清除（归一为
           undefined 存内存，读取侧与 null 同判）；日期 = 覆盖并校验先后顺序。 */
        if (input.eventTime !== undefined) ephemeral.eventTime = parseFactTime(input.eventTime, { label: 'eventTime' });
        if (input.validUntil !== undefined) ephemeral.validUntil = parseValidUntil(input.validUntil);
        assertFactTimeOrder(ephemeral.eventTime, ephemeral.validUntil);
        ephemeral.updatedAt = now();
        const afterSnapshot = memoryActivitySnapshot(this.memoryById(memoryId));
        this.finishActivity(manualActivity, 'success', { memoryId, summary: memoryUpdateActivitySummary(beforeSnapshot, afterSnapshot, beforeSnapshot?.text !== afterSnapshot?.text) });
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
    const previousPersistentTags = Array.isArray(input.tagNames) ? this.tagNamesOfMemory(memoryId) : [];
    try {
      /* 格式归属三态（与事实时间同构）：undefined = 保持原值；'' 显式清除为无归属；
         其它 = 覆盖。正文未改时也要按目标格式重排键序，否则「改了格式但正文顺序还是旧格式」
         会让卡片显示与格式定义长期不一致。 */
      const requestedFormatId = input.formatId === undefined ? (row.format_id ?? '') : input.formatId;
      /* 停用格式的放行规则（v12.18）：
         · input.formatId === undefined → 用的是【库里原值】（保持归属）→ 放行，
           否则「编辑一条归属停用格式的旧记忆」会静默丢掉归属。
         · input.formatId 有值 → 来源由 options.allowInactiveFormat 决定：
           UI 明确选择传 true；模型工具调用不传（默认 false）→ 拒绝停用格式。 */
      const allowInactiveFormat = input.formatId === undefined || options.allowInactiveFormat === true;
      const prepared = this.prepareMemoryWrite(
        input.text === undefined ? row.body : input.text,
        {
          formatId: requestedFormatId,
          /* 无归属记忆改正文时必须走严格模式：反推出的格式若要求字段缺失，宁可拒绝，
             也好过静默写入一条「有归属但不符合定义」的记忆。 */
          strict: true,
          allowInactiveFormat,
          allowedFormatIds: options.allowedFormatIds
        }
      );
      const body = prepared.body;
      const formatId = input.formatId === '' ? '' : prepared.formatId;
      if (body.length < 6) throw new MemoryError('invalid-memory-text', 'memory text must be at least 6 characters');
      const directoryId = input.directoryId === undefined ? row.directory_id : normalizePlainText(input.directoryId, 128);
      if (this.db.prepare('SELECT id FROM memory_directories WHERE id = ?').get(directoryId) === undefined) throw new MemoryError('directory-not-found', 'directory was not found', 404);
      const status = normalizeStatus(input.status, row.status);
      const pinned = input.pinned === undefined ? (Number(row.pinned) === 1 ? 1 : 0) : (input.pinned === true ? 1 : 0);
      /* 事实时间：undefined = 保持原值；null/'' = 清除为未声明；其余 = 解析覆盖。
         传 null 清除是必需的——否则设错的日期永远改不回去。 */
      const eventTime = input.eventTime === undefined
        ? (Number(row.event_time) > 0 ? Number(row.event_time) : undefined)
        : parseFactTime(input.eventTime, { label: 'eventTime' });
      const validUntil = input.validUntil === undefined
        ? (Number(row.valid_until) > 0 ? Number(row.valid_until) : undefined)
        : parseValidUntil(input.validUntil);
      assertFactTimeOrder(eventTime, validUntil);
      const hash = memoryHash(body);
      const duplicate = this.persistentByHash(hash, directoryId);
      if (duplicate !== undefined && duplicate !== memoryId) throw new MemoryError('duplicate-memory', 'a memory with the same text already exists in this project', 409);
      /* 只有全部参数校验通过后才写修订；正文/标签/项目更新与修订落库保持原子。 */
      this.db.exec('BEGIN');
      try {
        if (body !== row.body) this.recordMemoryRevision(memoryId, row.body, row.status, options.triggerKind ?? 'ui');
        this.db.prepare('UPDATE memories SET directory_id = ?, body = ?, status = ?, content_hash = ?, pinned = ?, updated_at = ?, event_time = ?, valid_until = ?, format_id = ? WHERE id = ?')
          .run(directoryId, body, status, hash, pinned, now(), eventTime ?? null, validUntil ?? null, formatId, memoryId);
        if (Array.isArray(input.tagNames)) this.setMemoryTags(memoryId, input.tagNames, { preserveNames: previousPersistentTags });
        this.db.exec('COMMIT');
      } catch (error) {
        try { this.db.exec('ROLLBACK'); } catch {}
        throw error;
      }
      this.reindexMemory(memoryId);
      const afterSnapshot = memoryActivitySnapshot(this.memoryById(memoryId));
      this.finishActivity(manualActivity, 'success', { memoryId, summary: memoryUpdateActivitySummary(beforeSnapshot, afterSnapshot, beforeSnapshot?.text !== afterSnapshot?.text) });
    } catch (error) {
      this.finishActivity(manualActivity, 'failed', { memoryId, errorCode: error?.code, errorMessage: error?.message || String(error) });
      throw error;
    }
  }

  /* ── 正文修订历史 ──
     独立于 7 天活动日志：正文被替换时把旧正文整份存档，供历史查看与恢复。
     只记持久化记忆；恢复走 updateMemory（自动进活动日志），这里不重复记。 */
  recordMemoryRevision(memoryId, text, status, replacedBy) {
    try {
      this.db.prepare('INSERT INTO memory_revisions (id, memory_id, text, hash, status, replaced_at, replaced_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id('rev'), memoryId, text, memoryHash(text), normalizeStatus(status, 'active'), now(), normalizeRevisionSource(replacedBy));
      this.trimMemoryRevisions(memoryId);
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory revision record failed:`, error);
    }
  }

  listMemoryRevisions(memoryId, { limit = 20, offset = 0 } = {}) {
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const items = this.db.prepare('SELECT id, text, hash, status, replaced_at AS replacedAt, replaced_by AS replacedBy FROM memory_revisions WHERE memory_id = ? ORDER BY replaced_at DESC LIMIT ? OFFSET ?')
      .all(memoryId, safeLimit, safeOffset);
    const total = Number(this.db.prepare('SELECT COUNT(*) AS n FROM memory_revisions WHERE memory_id = ?').get(memoryId)?.n ?? 0);
    return { items, total, hasMore: safeOffset + items.length < total };
  }

  clearMemoryRevisions(memoryId) {
    const rows = this.db.prepare('SELECT id, text FROM memory_revisions WHERE memory_id = ? ORDER BY replaced_at DESC').all(memoryId);
    /* 清空也记日志：每个被清掉的版本各记一条（与单条删除同构，便于逐条复制回来），不合并。 */
    const activities = rows.map((row) => ({
      summary: activitySummaryText(row.text || ''),
      activity: this.beginActivity('memory_revision_delete', {
        memoryId,
        sessionId: '',
        sessionTitle: '',
        summary: activitySummaryText(row.text || ''),
        triggerKind: 'manual'
      })
    }));
    try {
      const removed = this.db.prepare('DELETE FROM memory_revisions WHERE memory_id = ?').run(memoryId).changes;
      for (const entry of activities) this.finishActivity(entry.activity, 'success', { memoryId, summary: entry.summary });
      return { removed, cleared: rows.length };
    } catch (error) {
      for (const entry of activities) {
        this.finishActivity(entry.activity, 'failed', { memoryId, errorCode: error?.code, errorMessage: error?.message || String(error) });
      }
      throw error;
    }
  }

  /* 删除单条修订（历史列表里的逐条删除）。 */
  deleteMemoryRevision(input = {}) {
    const memoryId = normalizePlainText(input.memoryId, 128);
    const revisionId = normalizePlainText(input.revisionId, 128);
    if (!memoryId || !revisionId) throw new MemoryError('invalid-revision', 'memoryId and revisionId are required', 400);
    const revision = this.db.prepare('SELECT text FROM memory_revisions WHERE id = ? AND memory_id = ?').get(revisionId, memoryId);
    if (revision === undefined) throw new MemoryError('revision-not-found', 'memory revision was not found', 404);
    const summary = activitySummaryText(revision.text || '');
    const activity = this.beginActivity('memory_revision_delete', { memoryId, sessionId: '', sessionTitle: '', summary, triggerKind: 'manual' });
    try {
      const removed = this.db.prepare('DELETE FROM memory_revisions WHERE id = ? AND memory_id = ?').run(revisionId, memoryId).changes;
      this.finishActivity(activity, 'success', { memoryId, summary });
      return { removed };
    } catch (error) {
      this.finishActivity(activity, 'failed', { memoryId, errorCode: error?.code, errorMessage: error?.message || String(error) });
      throw error;
    }
  }

  restoreMemoryRevision(input = {}, options = {}) {
    const memoryId = normalizePlainText(input.memoryId, 128);
    const revisionId = normalizePlainText(input.revisionId, 128);
    const revision = this.db.prepare('SELECT * FROM memory_revisions WHERE id = ? AND memory_id = ?').get(revisionId, memoryId);
    if (revision === undefined) throw new MemoryError('revision-not-found', 'memory revision was not found', 404);
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(memoryId);
    if (row === undefined) throw new MemoryError('memory-not-found', 'memory was not found', 404);
    /* 恢复历史版本：正文可能来自归属格式被修改前，按当前归属重排键序。
       用 strict:false —— 恢复是用户明确要求回到旧版，不能因格式校验拦住；
       若旧正文缺少当前格式的必需字段，则连归属一并退化为无归属（不留下不一致的引用）。 */
    /* 修订恢复：formatId 取自该修订行的原值（库中既定事实），放行停用格式。 */
    const restored = this.prepareMemoryWrite(revision.text, { formatId: row.format_id ?? '', strict: false, allowInactiveFormat: true });
    const after = restored.body;
    if (after.length < 6) throw new MemoryError('invalid-memory-text', 'memory text must be at least 6 characters');
    const hash = memoryHash(after);
    const duplicate = this.persistentByHash(hash, row.directory_id);
    if (duplicate !== undefined && duplicate !== memoryId) throw new MemoryError('duplicate-memory', 'a memory with the same text already exists in this project', 409);
    const beforeSnapshot = memoryActivitySnapshot(this.memoryById(memoryId));
    const activity = options.logActivity === true
      ? this.beginActivity('memory_update', { memoryId, sessionId: '', sessionTitle: '', summary: activitySummaryText(row.body), triggerKind: 'restore' })
      : null;
    try {
      /* 互换而非新增：目标版本升为当前正文，当前正文原地降为该版本（条数不变）。
         直接把该修订行的正文与时间改写为被替换下来的当前正文，历史长度因此不增长。 */
      this.db.prepare('UPDATE memory_revisions SET text = ?, hash = ?, status = ?, replaced_at = ?, replaced_by = ? WHERE id = ?')
        .run(row.body, memoryHash(row.body), row.status, now(), 'restore', revisionId);
      this.db.prepare('UPDATE memories SET body = ?, content_hash = ?, updated_at = ?, format_id = ? WHERE id = ?')
        .run(after, hash, now(), restored.formatId, memoryId);
      this.reindexMemory(memoryId);
      const afterSnapshot = memoryActivitySnapshot(this.memoryById(memoryId));
      this.finishActivity(activity, 'success', { memoryId, summary: memoryUpdateActivitySummary(beforeSnapshot, afterSnapshot, true) });
    } catch (error) {
      this.finishActivity(activity, 'failed', { memoryId, errorCode: error?.code, errorMessage: error?.message || String(error) });
      throw error;
    }
    return this.memoryById(memoryId);
  }

  trimMemoryRevisions(memoryId) {
    const cap = this.revisionCap();
    if (!Number.isSafeInteger(cap) || cap <= 0) return;
    this.db.prepare('DELETE FROM memory_revisions WHERE memory_id = ? AND id NOT IN (SELECT id FROM memory_revisions WHERE memory_id = ? ORDER BY replaced_at DESC, id DESC LIMIT ?)')
      .run(memoryId, memoryId, cap);
  }

  revisionCap() {
    try {
      const raw = Number(this.db.prepare("SELECT value FROM memory_settings WHERE key = 'memory_revision_cap'").get()?.value);
      return Number.isSafeInteger(raw) && raw > 0 ? raw : MEMORY_REVISION_CAP_DEFAULT;
    } catch {
      return MEMORY_REVISION_CAP_DEFAULT;
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
      this.dropMemoryEdges(memoryId);
      this.db.prepare('DELETE FROM memories WHERE id = ?').run(memoryId);
      /* 记忆已物理删除，修订历史随之清理，避免孤儿行。 */
      this.db.prepare('DELETE FROM memory_revisions WHERE memory_id = ?').run(memoryId);
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
    /* 时间窗命中四类时间任一即可：记录时间（created/updated）+ 事实时间（event_time/valid_until）。
       事实时间列可空：NULL 比较结果为 NULL（不命中该分支），但 created_at 恒有值，
       故「无事实时间的记忆」不会因此漏召回——扩窗只增不减。 */
    const timeSql = timeRange !== undefined ? 'AND ((m.created_at >= ? AND m.created_at < ?) OR (m.updated_at >= ? AND m.updated_at < ?) OR (m.event_time >= ? AND m.event_time < ?) OR (m.valid_until >= ? AND m.valid_until < ?))' : '';
    const timeArgs = timeRange !== undefined ? [timeRange.start, timeRange.end, timeRange.start, timeRange.end, timeRange.start, timeRange.end, timeRange.start, timeRange.end] : [];
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

  /* 固定召回候选：只要所属项目在该会话启用，就无条件进入注入集合。
     跳过 FTS 字面命中、相关性准入、标签门槛与本轮查询的一切筛选——
     「固定」的语义就是不依赖查询内容。返回行带 pinned 标记，供 packHits 区分。 */
  pinnedCandidateRows(directoryIds, options = {}) {
    if (!Array.isArray(directoryIds) || directoryIds.length === 0) return [];
    const directoryPlaceholders = directoryIds.map(() => '?').join(', ');
    const status = normalizePlainText(options.status, 16);
    const statusSql = status && status !== 'all' ? 'AND m.status = ?' : '';
    const statusArgs = status && status !== 'all' ? [normalizeStatus(status, 'active')] : [];
    return this.db.prepare(`
      SELECT m.*, d.name AS directory_name,
        COALESCE((SELECT GROUP_CONCAT(t.id, char(31)) FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active'), '') AS tag_ids,
        COALESCE((SELECT GROUP_CONCAT(t.name, char(31)) FROM memory_tag_links l JOIN memory_tags t ON t.id = l.tag_id WHERE l.memory_id = m.id AND t.status = 'active'), '') AS tag_names,
        0 AS rank
      FROM memories m JOIN memory_directories d ON d.id = m.directory_id
      WHERE m.directory_id IN (${directoryPlaceholders}) AND m.pinned = 1 ${statusSql}
    `).all(...directoryIds, ...statusArgs);
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

  async recall(sessionId, queryText, options = {}) {
    /* 四段式注入：段1/2/3 使用配置上限，段4 动态吸收总配额剩余名额。
       段4 = maxItems - 实际选中的段1 - 段2 - 段3；候选不足时自然吸收上游缺口。 */
    const recallConfig = options.recallSettings ?? this.recallSettings();
    const startedAt = now();
    const sessionIdText = String(sessionId ?? '');
    const deadline = startedAt + (options.timeBudgetMs ?? RECALL_TIME_BUDGET_MS);
    const enabled = this.enabledDirectoryIds(sessionId);
    if (enabled.length === 0 || now() > deadline) return [];
    const profile = options.profile ?? detectRecallProfile(queryText);
    const terms = extractSearchTerms(queryText);
    const profileTags = recallProfileTags(profile);
    /* 取数顺序说明：固定召回与查询内容无关，必须在「本轮查询无可检索词」的早退之前取到，
       否则一句无实词的提问（如「继续」）会把固定召回一起吞掉。 */
    const enabledSet = new Set(enabled);
    const pinnedRowsEarly = now() > deadline ? [] : this.pinnedCandidateRows(enabled, { status: 'active' });
    if (terms.length === 0 && profileTags.length === 0) {
      return pinnedRowsEarly.length === 0 ? [] : packHits(pinnedRowsEarly.map((row) => ({ ...row, pinned: true })), pinnedRowsEarly.length);
    }
    const placeholders = enabled.map(() => '?').join(', ');
    const maxItems = options.maxItems ?? recallConfig.maxItems;
    const customContext = customTagMatchContext(queryText);
    const profileWeights = recallProfileWeights(profile);
    const allowProfileTagFallback = profileAllowsTagFallback(profile);
    const activeTagNames = new Set(this.db.prepare("SELECT name FROM memory_tags WHERE status = 'active'").all().map((row) => row.name).filter(Boolean));
    const ephemeralRows = recallConfig.segments.segment2 > 0
      ? this.ephemeralSegmentRows(sessionIdText, enabledSet, terms, customContext, profileWeights, allowProfileTagFallback, activeTagNames)
      : [];
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
    /* 向量通道（第 6 条取数通道）：关闭/未就绪/超时都返回空数组，
       行为与改动前逐字节相同（空数组经 mergeRecallRows 无副作用）。
       ⚠️ 必须 await —— 它是异步的（query embedding 是一次网络/推理调用），
          这也是 recall 从同步改为 async 的唯一原因。 */
    let vectorRows;
    /* 向量守门用的全量余弦表：由 vectorCandidateRows 通过 scoreSink 回填（复用同一次
       query embedding，不额外消耗一次推理/网络调用）。为空 = 向量通道不可用，守门自动放行。 */
    const vectorScoreAll = new Map();
    const getVectorRows = async () => {
      if (vectorRows === undefined) {
        const usable = this.embeddingEnabled() && now() <= deadline && (await this.ensureEmbedder()) !== undefined;
        vectorRows = usable
          ? await this.vectorCandidateRows(queryText, enabled, { status: 'active', scoreSink: vectorScoreAll })
          : [];
      }
      return vectorRows;
    };
    /* 固定召回：只是多了 pinned 属性的普通记忆，照常参与各段竞争；
       复用早退前那次取数结果，避免重复查库。 */
    const pinnedRows = pinnedRowsEarly;
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
    /* 固定召回只是「多一个 pinned 属性」的普通记忆：它照常进入三池、照常按各段
       矩阵参与竞争，因此这里只做去重登记与标记，不再把它剔除出池。
       保证不漏由末尾的合并步骤负责（见 merged）。 */
    const pinnedSet = new Set();
    const pinnedRows_ = [];
    for (const row of pinnedRows) {
      const id = normalizePlainText(row?.id, 128);
      if (!id || pinnedSet.has(id)) continue;
      pinnedSet.add(id);
      pinnedRows_.push({ ...row, pinned: true });
    }
    permanentRows = mergeRecallRows(permanentRows, getCustomRows(), getBottomRows(), await getVectorRows());
    /* 结构分权重档位：由「embedding 是否真的可用」决定（此刻 ensureEmbedder 已跑完，
       this.embedder 有确定值：undefined=未初始化 / null=初始化失败 / 实例=可用）。
       ⚠️ 判据用「向量通道实际是否可用」而非仅看开关：
          - 开关关闭            → 语义分缺席 → 结构分用满档（独自承担身份排序）
          - 开关开但初始化失败   → 同样缺席   → 用满档（否则白降分却无补偿）
          - 回填进行中          → 多数记忆尚无向量 → 仍用满档，避免「只降不补」的净损失
          - 开关开且初始化成功且回填完成 → 降档，把话语权让给查询相关信号
       这样「降分」永远伴随「语义分补位」，不会出现净损失。 */
    const vectorUsable = this.embedder !== undefined && this.embedder !== null && this.embeddingBackfilling !== true;
    customContext.structureWeights = vectorUsable
      ? { tier1: STRUCTURE_TIER1_WEIGHT_REDUCED, max1: STRUCTURE_TIER1_MAX_WEIGHT_REDUCED }
      : { tier1: STRUCTURE_TIER1_WEIGHT_FULL, max1: STRUCTURE_TIER1_MAX_WEIGHT_FULL };
    /* 三池划分 */
    const bottomPool = [];
    const regularPool = [];
    const seen = new Set();
    for (const row of permanentRows) {
      const id = normalizePlainText(row?.id, 128);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      /* 固定记忆留在池里参与竞争，仅补上 pinned 标记供注入时区分。 */
      const tagged = pinnedSet.has(id) ? { ...row, pinned: true } : row;
      if (rowTagNames(tagged).some((tag) => STABLE_TIER1_TAGS.has(tag))) bottomPool.push(tagged);
      else regularPool.push(tagged);
    }
    /* 四段构建：每段用本段矩阵竞争选拔。
       每行带上 segment 标记（bottom/ephemeral/mixed/fallback），供注入快照记录
       「这条来自哪一段」，面板据此显示段位徽标。段位是「该轮竞争的结果」，
       同一条记忆在不同轮次可能落在不同段，故只随快照冻结、不写回记忆库。 */
    /* ═══ 段3/段4 的准入门槛（v10）—— 按段分工 ═══
       背景：段1（bottomRowIsRelevant）与段2（ephemeralSegmentRows 内联判定）本就有准入门槛，
             段3/段4 此前只做池内竞争、无任何门槛 → 弱匹配候选照样占席位，无关查询也被填满。

       段3/段4 是「查询相关性竞争段」，用两道门槛（都需通过）：
         ① BM25 门槛（词法层）：bm25Weight ≥ 6
            · 实测依据：本库所有查询命中里 67% 分数 <2（噪声主体），真实相关查询最高分普遍 8.00，
              无关查询最高分普遍 2.9~5.4（唯一例外见下）。
            · 只作用于「确有 FTS 信息」的行（rank < 0）；无 FTS 命中的行交由向量层判定。
         ② 向量守门（语义层）：余弦 ≥ 0.30
            · 实测依据：真相关查询的期望记忆余弦 0.279~0.735（中位 0.531），
              无关查询的全库最高余弦 -0.003~0.295（中位 0.118），两组仅在 0.28~0.30 处重叠 1 例。
            · 无向量数据（未启用/未回填/该条无向量）时【放行】，保证降级路径可用。
       ⚠️ 已知例外：单个稀有通用词（如「SQL」「join」在库内 df=1~2）会因 IDF 虚高拿到 ~6.9 分，
          越过 BM25 门槛；这是 BM25 在小库上的固有特性，非本门槛可解。

       实测效果（63 条库 / 37 正例 / 15 负例）：
         · 检索段精度 17.6% → 49.1%
         · 无关查询的检索段注入 2.07 → 0.00 条（15/15 完全干净，原为 7/15）
         · 捞到的标注相关条数 1.57 → 1.43（仅 −9%）
         · 注入总量 11.5 → 8.1 条

       ⚠️ 这两个数值是在本库（63 条 / 中文技术记忆 / 本地 jina-768）标定的经验值，
          换库、换 embedding 模型或库规模显著增长后应重新标定（评测脚本见 recall-eval）。 */
    const RECALL_BM25_FLOOR = 6;          /* 词法层门槛：0~8 刻度上的「强匹配」线 */
    const RECALL_VECTOR_GATE = 0.30;      /* 语义层门槛：余弦相似度（非百分制） */
    const bm25Pass = (row) => {
      const ranked = Number(row?.rank ?? 0) < 0;   /* rank≥0 = 无 FTS 信息，不参与词法门槛 */
      if (!ranked) return true;
      return bm25Weight(row.rank) >= RECALL_BM25_FLOOR;
    };
    const vectorPass = (row) => {
      /* 表为空 = 向量通道不可用（未启用/初始化失败/超时）→ 全部放行 */
      if (vectorScoreAll.size === 0) return true;
      const id = normalizePlainText(row?.id, 128);
      const score = vectorScoreAll.get(id);
      if (score === undefined || !Number.isFinite(score)) return true;   /* 该条无向量 → 放行 */
      return score >= RECALL_VECTOR_GATE;
    };

    /* 段构建：段3（mixed）与段4（fallback）走 RRF 融合，并施加上述两道门槛；
       段2（ephemeral）保持 v9 加法矩阵。
       · 段1：不经过本函数，由 selectBottomSegment 单独构建（准入 + 补足 + RRF 排序），
              且【只用向量守门、不用 BM25 门槛】——段1 的职责是「身份保底」，
              其成员多为与查询无关的身份记忆，BM25 天然低（实测段1 成员常为 0.5~5.3），
              若施加 BM25≥6 会把身份保底全部误杀（段1 退化成第二个段3）。
       注意：段3 席位为 0 时不会调用本函数（count=0 → 空数组），但段4 仍走 RRF，
       因此「段3 是否开席」与「用不用门槛」是两个独立开关。 */
    const segment = (poolRows, segmentKey, count) => {
      if (count <= 0) return [];
      if (segmentKey === 'mixed' || segmentKey === 'fallback') {
        const admitted = poolRows.filter((row) => bm25Pass(row) && vectorPass(row));
        return rrfRankRows(admitted, segmentKey, startedAt, customContext).slice(0, count).map((entry) => ({ ...entry.row, segment: segmentKey }));
      }
      return rankRowsBySegment(poolRows, segmentKey, profile, startedAt, customContext).slice(0, count).map((entry) => ({ ...entry.row, segment: segmentKey }));
    };
    const bottomCount = Math.min(recallConfig.segments.segment1, bottomPool.length);
    /* 段1 先按相关性准入、再按标签优先级补足，总量恒不超过 segment1 席位。
       ⚠️ 段1 只过【向量守门】，不吃 BM25 门槛（理由见上方注释：身份保底会遭误杀）。 */
    const bottomRows = selectBottomSegment(bottomPool.filter(vectorPass), bottomCount, profile, startedAt, customContext, profileWeights, allowProfileTagFallback).map((row) => ({ ...row, segment: 'bottom' }));
    const ephemeralCount = Math.min(recallConfig.segments.segment2, ephemeralRows.length);
    const ephemeralSelected = ephemeralCount > 0 ? segment(ephemeralRows, 'ephemeral', ephemeralCount) : [];
    const bottomSet = new Set(bottomRows.map((row) => normalizePlainText(row.id, 128)));
    const mixedPool = [
      ...bottomPool.filter((row) => !bottomSet.has(normalizePlainText(row.id, 128))),
      ...regularPool
    ];
    const mixedCount = Math.min(recallConfig.segments.segment3, mixedPool.length);
    const mixedRows = segment(mixedPool, 'mixed', mixedCount);
    const mixedSet = new Set(mixedRows.map((row) => normalizePlainText(row.id, 128)));
    const fallbackCount = Math.max(0, recallConfig.maxItems - bottomRows.length - ephemeralSelected.length - mixedRows.length);
    const fallbackPool = regularPool.filter((row) => !mixedSet.has(normalizePlainText(row.id, 128)));
    const fallbackRows = segment(fallbackPool, 'fallback', fallbackCount);
    const combined = [...bottomRows, ...ephemeralSelected, ...mixedRows, ...fallbackRows];
    /* 固定召回在四段筛选之后合并：固定记忆本身也是普通记忆，已在池中的会照常
       参与各段竞争并入选（去重后不会重复）；只在池外（未命中任何取数通道）的才
       经 missed 补入。因此固定记忆既不额外挤占各段席位，又保证一条都不漏。
       代价是注入总量可能超过 maxItems——maxItems 约束的是四段筛选规模，
       不是最终注入条数。固定记忆排在最前，便于模型优先读到。 */
    if (now() > deadline) return [];
    const combinedIds = new Set(combined.map((row) => normalizePlainText(row.id, 128)));
    /* 固定召回补入的行不属于四段竞争结果，标 'pinned'（面板用图钉图标表达，不显示段位徽标）。 */
    const missedPinned = pinnedRows_
      .filter((row) => !combinedIds.has(normalizePlainText(row.id, 128)))
      .map((row) => ({ ...row, segment: 'pinned' }));
    const merged = [...missedPinned, ...combined];
    if (merged.length === 0) return [];
    return packHits(merged, merged.length);
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
    /* 工具来源信号：位置候选与 grep 符号候选，作为「位置」「对象」的参考交给模型。
       候选数量设上限：无上限时一轮密集 grep 可产出 20+ 路径与 20+ 符号，
       会把 prompt 撑大并诱导模型逐条罗列，导致输出超长/截断。 */
    const signals = collectToolSignals(rows);
    const toolSignals = {
      paths: signals.paths.slice(0, MAX_DISTILL_PATH_CANDIDATES),
      symbols: signals.symbols.slice(0, MAX_DISTILL_SYMBOL_CANDIDATES)
    };
    context.toolPaths = toolSignals.paths.length;
    context.toolSymbols = toolSignals.symbols.length;
    /* 蒸馏只展示本会话启用项目的自定义标签词表；真正的标签归并等内容解析出目标项目后，
       在 addEphemeralMemory 写入点执行，避免把多个项目的标签混成一个分类空间。 */
    const enabledTagDirectories = this.enabledDirectoryIds(String(session.id));
    const tagCatalog = this.customTagCatalog(MAX_TAG_CATALOG_SIZE, enabledTagDirectories);
    context.tagCatalogSize = tagCatalog.length;
    context.tagCatalogDirectoryCount = enabledTagDirectories.length;
    context.toolPathsTotal = signals.paths.length;
    context.toolSymbolsTotal = signals.symbols.length;
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
      /* 格式清单按本轮转录筛选后再注入：转录里含本轮对话与被召回的旧记忆（后者
         本身带字段名），故「按内容筛」在这一步非常有效。筛空则不注入任何格式，
         模型按纯文本结论写入（见 selectFormatsForText 注释）。
         ⚠️ 但【只有一套启用格式时不做筛选】（v12.24）：selectFormatsForText 的无条件保留
         只针对内置 fmt-code，自建格式一律靠名称匹配 —— 用户停用内置代码类、只留一套
         自建的「代码」格式时，若本轮对话没提到「代码」二字，清单会被筛空，提示词里
         就一条格式信息都没有，模型只能写纯文本（实测：临时记忆 formatId='' 且正文是
         纯文本）。无可选择时不该筛选 —— 唯一的格式就是本轮该用的格式。 */
      const allActive = this.activeFormats();
      const injectFormats = allActive.length === 1 ? allActive : selectFormatsForText(allActive, transcriptText);
      context.injectedFormats = injectFormats.length;
      context.activeFormats = allActive.length;
      /* v12.31 蒸馏输出协议跟随记忆格式（用户明确要求：「蒸馏协议是旧版本的固定记忆格式，
         现在有了记忆格式设计，那么之前的固定蒸馏协议应该去掉」）：
         · 有可用格式 → 输出协议 = 所选格式的字段 + 写入元数据，不再要求
           {paths,symbols,content,tags} 固定四件套；
         · 没有可用格式 → 直接输出纯文本，不套任何固定 JSON 结构；标签由写入层根据
           正文与本轮转录归纳。解析器仍兼容旧 JSON，仅用于迁移/模型未遵循新提示词的降级，
           旧协议不再是生成协议。
         这从根上消除了「蒸馏器输出 content 纯文本总结 → 与格式字段对不上 → 无归属」的
         结构性矛盾：模型直接按格式字段输出，parseDistillation 按格式字段解析，
         L0 归属与正文形状天然一致。 */
      const formatDriven = injectFormats.length > 0;
      const prompt = [
        '你是 dsh-session-kit 的本地记忆蒸馏器。请只从下面这一轮对话中提取一条对未来对话长期有用的记忆正文。',
        '要求：',
        '- 只保留稳定事实、用户偏好、项目场景、项目约束、项目架构、模块约束、接口、接口约束、排查记录、决策记录、路径、函数、组件、类名、工作项目或日常生活信息。',
        ...(formatDriven
          ? [
            '- 输出一个 JSON 对象：字段就是下方清单里所选格式声明的字段（值类型也按其声明），并额外输出 tags 数组（见下方标签规则）与 formatId（值为你选中格式的「格式ID」，原样照抄）。不要输出格式未声明的其它字段。'
          ]
          : [
            '- 当前没有可用的记忆格式：直接输出一条结论性纯文本，不要套任何固定 JSON 结构，也不要输出 tags、formatId 等协议字段；标签由系统根据正文和本轮对话归纳。'
          ]),
        ...buildFormatPromptLines(injectFormats),
        /* 字段值要求行按【实际注入的格式】动态生成：清单里没有「内容」就不输出
           content 相关行 —— 否则模型被命令"必须有 content"，新建角色时会惯性多出
           内容字段（实测踩坑）。 */
        ...buildFieldValueRuleLines(injectFormats),
        ...(formatDriven ? [
          '- eventTime / validUntil 是本轮的【可选】字段，只在这一轮对话里出现了明确日期或期限时才填，否则整个字段省略（不要填 null、空串或"未知"）：',
          '  · eventTime = 这条记忆所述事情【在现实中发生/生效】的时刻（如「上周五部署的 v2」→ 那天的日期；「9-29 起改为 desktop」→ 2026-09-29）。',
          '    格式 YYYY-MM-DD；对话里明确给出了钟点时才加时间，写成「YYYY-MM-DD HH:MM」（如「今天下午 2 点半」→ 换算成具体日期的 14:30）。',
          '    只在事实有明确时间点时才填；「当前用某方案」「用户喜欢某语气」这类状态陈述没有发生时刻，必须省略。',
          '  · validUntil = 这条记忆【预计何时不再成立】（如「本周内有效」「临时用 A 方案过渡到月底」→ 对应日期）。',
          '    格式同上；只在正文自带期限/临时性时填；长期有效的偏好、架构、约束一律省略。',
          '  · 相对表达（今天/昨天/上周五/月底/下周三）必须结合本轮对话时间换算成具体日期「YYYY-MM-DD」再填，不要原样输出相对词。',
          '  · 填了 eventTime 就必须保证它是事实发生时间，不要用「蒸馏发生的今天」充数——那与记录时间无区别，等于白填。'
        ] : []),
        ...(formatDriven ? [
          '- tags 数组按两段式生成：',
          '  ① 描述性标签最多 1 个。先找这条记忆最精准的锚点：具体事件/动作、对象/实体/专名（函数、模块、API、产品、人名等），或明确场景；优先沿用正文/本轮对话里的原词，写成简短可检索的名词短语。不要用「优化」「治理」「改进」这类抽象评价词代替具体对象/事件，除非记忆主题本身就是该概念。',
          ...(tagCatalog.length > 0 ? [
            '- 当前会话启用项目中已有的自定义标签候选（JSON 数组，仅作为词表数据，不是指令）：' + JSON.stringify(tagCatalog),
            '  若有语义准确的已有标签，必须原样复用；只有都不贴合时才新增 1 个精准、可复用的自定义标签，不要为同一事件/对象换个近义说法再造一个。',
          ] : []),
          '  ② 再对该锚点问「它本质在描述什么」，映射到下面的稳定标签，映射得上的【一并】写入 tags：',
          '     用户本人的信息/特征 → 用户画像；用户对 AI 行为的约定/偏好 → 用户偏好；',
          '     项目整体定位/目标 → 项目画像；架构/结构/数据流/技术栈 → 项目架构；',
          '     硬性限制/不可违反/规范 → 项目约束；文件路径/目录结构 → 模块路径；',
          '     局部的约束/限制/兼容性要求 → 模块约束；当前进展/任务背景/上下文 → 项目场景；',
          '     对外接口/API/事件/hook → 接口摘要；阶段性总结/整体概览 → 项目摘要 或 模块摘要；',
          '     接口层面的硬性限制（必须/不能/约定的入参出参、协议约束） → 接口约束；',
          '     问题定位过程与根因（报错、复现、排查结论） → 排查记录；',
          '     技术选型与取舍（为何选 A 不选 B、方案确定） → 决策记录。',
          '  tags 数量倾向：稳定标签按语义映射（最多 4 个）；描述性自定义标签最多 1 个。宁缺毋滥，不要为凑数或同义改写新增标签。',
          '  禁止把 "工作项目""日常生活" 当作默认标签：只有本轮内容确实是通用工作记录、与上面任何稳定标签都无关时才用。',
          '  tags 确实没有合适内容时输出 ["工作项目"]，不要输出空数组。',
        ] : []),
        ...(formatDriven
          ? [
            '- 正文信息按所选格式的字段填写：格式声明了哪个字段，就把对应信息写进去；某字段本轮确实没有对应信息时，string 字段输出空字符串、string[] 字段输出空数组（不要虚构内容）。一份 JSON 只用一套格式的字段；内容和踩坑类字段允许使用换行。',
            '- 若所选格式声明了 paths（位置），涉及代码修改、排查、UI 组件或接口时尽量填写；确实没有具体对象时输出空数组，最多 6 条。',
            '- 若所选格式声明了 symbols（对象），只记录类名、函数名、方法名、组件名、接口名；不要记录变量名、常量名、属性名、配置项、数据库表名（噪音，数量过多且无定位价值）。非代码类格式里，对象可填涉及的人、事、物、主题等具名实体，最多 10 条。',
            '- 若下方给出「本轮 grep 候选符号」，请从中挑选属于「类/函数/方法」的写入 symbols，其余（变量、常量、属性）丢弃。判断依据是语法形态与用法上下文；注意不同语言的定义形式不同（JS 的 function/class、Python 的 def/class、Go 的 func/type、Rust 的 fn/struct 等）。',
            '- symbols 若同时来自你的判断与候选清单，以你的判断为准；候选清单只用于补全你未提及的函数/类名。'
          ]
          : [
            '- 没有可用格式时只保留结论性纯文本；不要套旧版 paths/symbols/content/pitfall 等固定字段，也不要输出任何 JSON 外壳。'
          ]),
        '- 不要记录一次性寒暄、临时状态、敏感密钥、无用过程。',
        '- 禁止写入源码行号（如 Line 289、第 289 行、client.js:289）；使用函数名、类名、字典键、CSS 选择器等稳定符号定位。',
        '- 禁止写入验证/完成证明段落（如 node --check 通过、烟测 43/43 通过）；这些不是长期知识。',
        ...(formatDriven
          ? ['- 如果没有值得记忆的内容，输出一个所有字段为空值并带 tags:["工作项目"] 的 JSON 对象（字段名仍按所选格式声明）。']
          : ['- 如果没有值得记忆的内容，输出「无」。']),
        ...(formatDriven
          ? [
            '- 输出严格 JSON，不要 Markdown。',
            '- 只输出一个 JSON 对象：第一个字符必须是 {，最后一个字符必须是 }。禁止在 JSON 之后追加任何解释、总结、补充说明或第二个 JSON；这些会被解析失败。'
          ]
          : [
            '- 只输出纯文本结论，不要 Markdown、JSON 外壳或额外解释。'
          ])
      ].join('\n');
      /* ⚠️ 指令与数据必须分成两条消息（v12.21）：某些 provider 强制要求首条为 system
         （实测 workbuddy 报「请求被安全策略拦截…first message is not system prompt」，
         蒸馏 28 次全部失败）。此前整段提示词挂在单条 user 消息上，触发了该限制。
         现在按消息角色拆分：指令（蒸馏器身份 + 全部约束/格式/标签规则）→ system；
         数据（会话信息 + 本轮转录 + 工具来源参考）→ user。 */
      const distillData = [
        '会话：',
        `- ID: ${String(session.id)}`,
        `- 名称: ${sessionTitle(session)}`,
        '',
        '本轮对话（含工具调用请求，即"读了哪个文件、搜了什么、改了什么"；不含工具返回的内容正文）：',
        transcriptText,
        ...(toolSignals.paths.length > 0 || toolSignals.symbols.length > 0 ? [
          '',
          '工具来源参考（由程序从本轮工具调用参数提取，供你填写「位置」「对象」时参考）：',
          ...(toolSignals.paths.length > 0 ? [`- 位置候选（工具读写的文件与 grep 的搜索目标）：${toolSignals.paths.join('、')}`] : []),
          ...(toolSignals.symbols.length > 0 ? [`- 本轮 grep 候选符号（含语法线索，请从中挑选类/函数/方法）：${
            toolSignals.symbols.map((symbol) => {
              const cue = symbol.hasDefinitionKeyword ? '定义' : symbol.hasCallParen ? '调用' : '';
              return cue ? `${symbol.value}(${cue})` : symbol.value;
            }).join('、')
          }`] : [])
        ] : [])
      ].join('\n');
      const messages = [
        createSystemMessage(prompt),
        createUserMessage({
          content: [{ type: 'text', text: distillData }],
          source: { kind: MEMORY_DISTILL_SOURCE, form: 'notice', summary: 'memory distill' }
        })
      ];
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
      /* 只取 text 块作蒸馏结果。reasoning 是模型的思考过程，不是可落库的知识；
         旧实现在无 text 时回退到 reasoning，会把分析草稿当成记忆正文写入。
         无 text 输出即判定本轮无可用产物，交由下方 no-usable-output 分支处理。 */
      const output = textBlocks.join('\n').trim();
      context.outputLength = output.length;
      this.ctx.logger?.info?.(`[${PLUGIN_NAME}] memory distillation output ${JSON.stringify({ ...context, textBlockCount: textBlocks.length, reasoningBlockCount: reasoningBlocks.length })}`);
      if (output.length === 0) {
        this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory distill produced no text output ${JSON.stringify(context)}`);
        return { status: 'skipped', reason: 'no-usable-output', turn };
      }
      /* v12.31：把注入清单传给解析层 —— 蒸馏输出协议已跟随记忆格式（提示词层 formatDriven），
         解析层据此按「模型选中的 formatId（或唯一格式）」的 order 直接渲染正文，
         不再走「提取 content → 四键重组」的旧协议。清单与提示词层完全同源，两端一致。 */
      const distilled = parseDistillation(output, transcriptText, toolSignals, this.hasActiveCodeFormat(), injectFormats);
      if (distilled === undefined) {
        this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory distill produced no usable memory ${JSON.stringify(context)}`);
        return { status: 'skipped', reason: 'no-usable-output', turn };
      }
      const distillUsage = normalizeTokenUsage(assembler.usage) ?? estimateDistillUsage(prompt, output);
      /* ★ 生成前已定格式（v12.28）：与 memory_add 路径同一口径 —— 由 determinedFormatFor
         用【此刻的完整转录】当场重算（此时模型回复已产生），交给 prepareMemoryWrite 的
         L0 分支直接采用。此前蒸馏路径漏传该参数，导致「用户停用内置代码类、只留一套
         自建格式」时，纯文本产物三条自动归属路径全数落空 → 明明有唯一可用格式却归成
         无归属（用户实测反馈）。 */
      const determinedFormat = this.determinedFormatFor(session.id, turn, agent);
      const stored = this.addEphemeralMemory({
        text: distilled.memory,
        tags: distilled.tags,
        session,
        sourceTurn: turn,
        creationMethod: triggerKind === 'auto' ? 'auto-distill' : 'manual-distill',
        distillUsage,
        eventTime: distilled.eventTime,
        validUntil: distilled.validUntil,
        formatId: distilled.formatId,
        /* 蒸馏路径独有的最强判据：本轮工具操作过哪些文件（含代码后缀判定）。 */
        toolSignals,
        determinedFormat,
        allowedFormatIds: injectFormats.map((format) => format.id)
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
    /* memory_add 与自动蒸馏是两种不同粒度的记忆来源：
       memory_add 可能只记录本轮的一个具体事实，auto-distill 则总结整轮对话，
       不能仅凭同一个 turn 就跳过其中一条，否则会丢失其它事实。
       是否重复应比较两条写入后实际正文的归一化结果，而不是比较调用参数或轮次。
       因此这里不做 turn 级跳过；精确重复由后续正文/hash 去重逻辑处理。 */
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
      if (!hasMemorySource(source, MEMORY_CONTEXT_SOURCE)) continue;
      if (readMemoryHitIds(source).length === 0) continue;
      injectedOnSurface.push(event);
    }
    if (injectedOnSurface.length === 0) return [];

    /* top-k 判定：本轮召回命中的保留，未命中的剔除 */
    const hitSet = new Set((Array.isArray(hitIds) ? hitIds : []).map((id) => normalizePlainText(String(id ?? ''), 128)).filter(Boolean));
    const ejected = [];
    const survivorsBySeq = new Map();
    for (const event of injectedOnSurface) {
      const messageHitIds = readMemoryHitIds(event.data.source).map((id) => normalizePlainText(String(id ?? ''), 128)).filter(Boolean);
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
        /* 段位从「原注入快照」里取回：keptHits 的正文是重读记忆库得到的，
           但段位是那一轮竞争的结果、库里没有，只能沿用快照冻结值。 */
        const segmentById = new Map();
        for (const snapshotHit of readMemorySnapshot(source)) {
          const snapshotId = normalizePlainText(String(snapshotHit?.id ?? ''), 128);
          if (snapshotId) segmentById.set(snapshotId, typeof snapshotHit?.segment === 'string' ? snapshotHit.segment : '');
        }
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
            formatId: memory.formatId ?? '',
            eventTime: Number(memory.eventTime) > 0 ? Number(memory.eventTime) : 0,
            validUntil: Number(memory.validUntil) > 0 ? Number(memory.validUntil) : 0,
            /* 固定标记取记忆库当前值：重写后的面板徽标与「下一轮会再注入」的事实一致，
               不冻结首次注入时的旧值（用户可在两轮之间取消固定）。 */
            pinned: memory.pinned === true,
            segment: segmentById.get(memory.id) ?? '',
            updatedAt: memory.updatedAt ?? 0
          };
        }).filter(Boolean);
        if (keptHits.length === 0) {
          session.append('user/message', createUserMessage({
            content: [],
            source: { kind: MEMORY_EJECT_PROVIDER }
          }), { surfaceOp: { op: 'replace', startSeq: event.seq, endSeq: event.seq }, sourceEventSeqs: [event.seq] });
          continue;
        }
        const renderedHits = this.prepareMemoryInjectionHits(keptHits);
        const text = renderMemoryInjection(renderedHits);
        session.append('user/message', {
          ...event.data,
          content: [{ type: 'text', text }],
          /* 重写使用与首次注入相同的 JSON 解析/截断链，并用新正文重建快照，
             保证面板、注入正文与模型上下文三者一致。
             注意：元数据存在 sections 内，必须整体重建，不能只覆盖顶层字段。 */
          source: buildMemorySource({
            kind: source.kind,
            hitIds: keptHits.map((hit) => hit.id),
            snapshot: renderedHits.map((hit) => ({ id: hit.id, text: hit.text, directoryName: hit.directoryName, tags: hit.tags, pinned: hit.pinned === true, segment: hit.segment ?? '' })),
            summary: `命中 ${keptHits.length} 条`
          })
        }, { surfaceOp: { op: 'replace', startSeq: event.seq, endSeq: event.seq }, sourceEventSeqs: [event.seq] });
      } else {
        session.append('user/message', createUserMessage({
          content: [],
          source: { kind: MEMORY_EJECT_PROVIDER }
        }), { surfaceOp: { op: 'replace', startSeq: event.seq, endSeq: event.seq }, sourceEventSeqs: [event.seq] });
      }
    }
    this.ctx.logger?.info?.(`[${PLUGIN_NAME}] memory eject: removed ${ejected.length} stale injected memories from session ${sessionId}`);
    return ejected;
  }

  async injectRecall(agent, claimedMessages, decision, signal, turn, requested) {
    if (decision.kind !== 'enter' || signal?.aborted) return decision;
    const sessionId = String(agent?.session?.id ?? '');
    /* 显式记忆请求：提示行已由 appendExplicitMemoryRequest 追加到轮尾（对本步模型可见），
       此处不再注入任何消息，只决定本步是否跳过记忆召回。 */
    const requestedText = typeof requested?.text === 'string' ? requested.text : '';
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
    /* 显式记忆请求轮：跳过记忆召回，避免召回内容挤占注意力、也避免本步先检索再写入。
       目录自动匹配与剔除照旧执行（不影响「原来功能」，且保持已注入记忆的缓存前缀稳定）。 */
    const skipRecall = requestedText.length > 0;
    let hits = [];
    let rawHitIds = [];
    if (!skipRecall) {
      try {
        hits = await this.recall(agent.session.id, directText, { recallSettings: this.recallSettings() });
        rawHitIds = hits.map((hit) => hit.id);
      } catch (error) {
        this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory recall failed:`, error);
      }
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
       正常轮直接剔除本轮未进 top-k 的已注入记忆，再注入本轮新召回。
       显式记忆请求轮（skipRecall=true）不做剔除：召回被跳过时 rawHitIds 为空集，
       会把全部已注入记忆误判为 stale 并清空，违背上文「保持缓存前缀稳定」的本意。 */
    const weakQuery = isWeakQueryText(directText);
    try {
      const ejected = this.ejectStaleInjectedMemories(agent.session, rawHitIds, weakQuery || skipRecall);
      if (ejected.length > 0) {
        baseContextMessages = typeof agent?.session?.deriveMessages === 'function' ? agent.session.deriveMessages() : baseContextMessages;
      }
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory eject failed:`, error);
    }
    if (!skipRecall) hits = filterFreshMemoryHits(hits, contextMessages(decision.messages));
    if (hits.length === 0 && matchedDirectories.length === 0) {
      return decision;
    }
    const renderedHits = this.prepareMemoryInjectionHits(hits);
    const content = [
      matchedDirectories.length > 0 ? autoMatchNoticeText(matchedDirectories) : '',
      renderedHits.length > 0 ? renderMemoryInjection(renderedHits) : ''
    ].filter(Boolean).join('\n\n');
    const message = createUserMessage({
      content: [{ type: 'text', text: content }],
      source: buildMemorySource({
        kind: MEMORY_CONTEXT_SOURCE,
        /* 注入时命中记忆的结构化快照（与正文 1:1）：随注入事件持久化，供记忆
           小面板跨重启解析文本（含临时记忆），并保证面板文本 = 模型当时实际所见。 */
        hitIds: renderedHits.map((hit) => hit.id),
        snapshot: renderedHits.map((hit) => ({ id: hit.id, text: hit.text ?? '', directoryName: hit.directoryName ?? '', tags: Array.isArray(hit.tags) ? hit.tags : [], pinned: hit.pinned === true, segment: typeof hit.segment === 'string' ? hit.segment : '' })),
        summary: matchedDirectories.length > 0 && hits.length > 0 ? `自动启用 ${matchedDirectories.length} 个项目，命中 ${hits.length} 条` : matchedDirectories.length > 0 ? `自动启用 ${matchedDirectories.length} 个项目` : `命中 ${hits.length} 条`
      })
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

  /* 召回注入展示：按记忆归属格式读取 injectPlainText 配置。
     关系/搜索/落库仍使用原始 body；这里只替换实际发给模型的 text，
     并由调用方把展示后的 text 写入注入快照，保证轨迹看到的内容与模型一致。
     plainTextInjection 标记该条是否走块状结构（元数据块 + 正文块 + 分隔线）：
     只有格式开启且正文确实转成功时才置位，避免转换失败后元数据块与 JSON 混搭。 */
  prepareMemoryInjectionHits(hits) {
    return (Array.isArray(hits) ? hits : []).map((hit) => {
      const format = this.formatById(hit?.formatId);
      const raw = hit?.text ?? '';
      const text = renderFormatInjectionText(raw, format);
      return {
        ...hit,
        text,
        plainTextInjection: format?.definition?.injectPlainText === true && text !== raw
      };
    });
  }

  injectMemoryIntoSession(sessionId, memoryId) {
    const sid = normalizePlainText(sessionId, 128);
    const idText = normalizePlainText(memoryId, 128);
    if (!sid) throw new MemoryError('invalid-session-id', 'sessionId is required', 400);
    if (!idText) throw new MemoryError('invalid-memory-id', 'memoryId is required', 400);
    const session = this.ctx.sessions?.get?.(sid);
    if (session === undefined || session === null) throw new MemoryError('session-not-found', 'session was not found', 404);
    if (typeof session.append !== 'function') throw new MemoryError('session-unavailable', 'session cannot accept messages', 409);
    const memory = this.memoryById(idText);
    if (memory === undefined) throw new MemoryError('memory-not-found', 'memory was not found', 404);
    const existingIds = currentMemoryHitIds(session);
    if (existingIds.has(memory.id)) {
      return { injected: false, duplicate: true, memoryId: memory.id, approxChars: 0 };
    }
    const limited = truncateMemoryTextForInjection(memory.id, memory.text ?? '');
    const hit = {
      id: memory.id,
      text: limited.text,
      truncated: limited.truncated,
      directoryName: memory.directoryName ?? '',
      tags: Array.isArray(memory.tags) ? memory.tags : [],
      formatId: memory.formatId ?? '',
      eventTime: Number(memory.eventTime) > 0 ? Number(memory.eventTime) : 0,
      validUntil: Number(memory.validUntil) > 0 ? Number(memory.validUntil) : 0,
      updatedAt: memory.updatedAt ?? 0,
      rank: 0
    };
    const renderedHit = this.prepareMemoryInjectionHits([hit])[0];
    const text = renderManualMemoryInjection(renderedHit);
    const message = createUserMessage({
      content: [{ type: 'text', text }],
      source: buildMemorySource({
        kind: MEMORY_MANUAL_SOURCE,
        hitIds: [memory.id],
        snapshot: [{ id: memory.id, text: renderedHit.text, directoryName: hit.directoryName, tags: hit.tags }],
        summary: '手动注入 1 条记忆'
      })
    });
    session.append('user/message', message, { surfaceOp: 'append' });
    return { injected: true, duplicate: false, memoryId: memory.id, approxChars: text.length };
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
        case 'inject-memory': {
          const sessionId = normalizePlainText(body.sessionId, 128);
          const result = this.injectMemoryIntoSession(sessionId, body.memoryId);
          return respond(res, 200, { ok: true, value: { ...this.snapshot(sessionId), injection: result } });
        }
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
             回退注入事件 hitIds（旧会话）；重启后可完整重算。
             命中与 newRecall 判定走 memoryHitsForTurn，与「记忆」视图同源。 */
          const { memories } = this.memoryHitsForTurn(session, turn);
          return respond(res, 200, { ok: true, value: { turn, hitIds: memories.map((memory) => memory.id), memories, mode: 'events' } });
        }
        case 'session-memory-view': {
          const sessionId = normalizePlainText(body.sessionId, 128);
          const session = this.ctx.sessions?.get?.(sessionId);
          if (session === undefined) throw new MemoryError('session-not-found', 'session was not found', 404);
          return respond(res, 200, { ok: true, value: this.sessionMemoryView(session) });
        }
        case 'create-directory': this.createDirectory(body); break;
        case 'update-directory': this.updateDirectory(body); break;
        case 'delete-directory': this.deleteDirectory(body); break;
        case 'create-tag': this.createTag(body); break;
        case 'set-tag-status': this.setTagStatus(body); break;
        /* 记忆格式：与 tags 三兄弟并列。内置格式的编辑/删除/停用由 store 侧拒绝或静默忽略。 */
        case 'create-format': this.createFormat(body); break;
        case 'update-format': this.updateFormat(body); break;
        case 'set-format-status': this.setFormatStatus(body); break;
        case 'delete-format': this.deleteFormat(body); break;
        case 'clear-activity-logs': {
          const cleared = this.clearActivityLogs();
          return respond(res, 200, { ok: true, value: { ...this.snapshot(body?.sessionId), ...cleared } });
        }
        case 'cleanup-token-usage': return respond(res, 200, { ok: true, value: this.cleanupTokenUsage() });
        case 'usage-overview': return respond(res, 200, { ok: true, value: this.usageOverview() });
        case 'delete-tag': this.deleteTag(body); break;
        case 'create-memory': this.createMemory(body, { logActivity: true }); break;
        case 'persist-memory': this.persistMemory(body, { logActivity: true }); break;
        /* UI 路径（记忆弹窗编辑）：格式由用户在下拉里选定，属明确意图 → 放行停用格式。
           （工具路径 updateToolMemory 不传该选项，故模型给出的停用 id 会被拒绝并退回自动归属。） */
        case 'update-memory': this.updateMemory(body, { logActivity: true, allowInactiveFormat: true }); break;
        case 'list-memory-revisions': {
          const memoryId = normalizePlainText(body.memoryId, 128);
          if (!memoryId) throw new MemoryError('invalid-memory-id', 'memoryId must not be empty', 400);
          return respond(res, 200, { ok: true, value: this.listMemoryRevisions(memoryId, { limit: body.limit, offset: body.offset }) });
        }
        case 'clear-memory-revisions': {
          const memoryId = normalizePlainText(body.memoryId, 128);
          if (!memoryId) throw new MemoryError('invalid-memory-id', 'memoryId must not be empty', 400);
          return respond(res, 200, { ok: true, value: this.clearMemoryRevisions(memoryId) });
        }
        case 'delete-memory-revision': {
          return respond(res, 200, { ok: true, value: this.deleteMemoryRevision(body) });
        }
        case 'restore-memory-revision': {
          const memory = this.restoreMemoryRevision(body, { logActivity: true });
          return respond(res, 200, { ok: true, value: { ...this.snapshot(body?.sessionId), restored: memory } });
        }
        case 'delete-memory': this.deleteMemory(body); break;
        case 'set-session-directory': this.setSessionDirectory(body); break;
        case 'set-auto-distill': this.setAutoDistill(body); break;
        case 'set-all-sessions-enabled': this.setAllSessionsEnabled(body); break;
        case 'set-first-turn-auto-match': this.setFirstTurnAutoMatch(body); break;
        case 'set-distill-model': this.setDistillModelOverride(body.modelSelection === null ? null : body.modelSelection); break;
        case 'set-recall-settings': this.setRecallSettings(body.recallSettings ?? body); break;
        case 'set-embedding': {
          /* 只接受 provider 的配置字段；apiKey 若回传掩码（与原值相同的占位）则保留原值， */
          /* 避免"前端回显掩码 → 保存 → key 被掩码覆盖"的经典事故。 */
          const incoming = body.provider;
          const current = this.embeddingProvider();
          let provider = incoming;
          if (incoming !== null && incoming !== undefined && typeof incoming === 'object') {
            const next = { ...incoming };
            next.apiKey = resolveApiKeyInput(next.apiKey, current?.apiKey);
            provider = next;
          }
          const result = this.setEmbedding({
            enabled: body.enabled === true,
            ...(body.provider === undefined ? {} : { provider })
          });
          /* 刚开启时立刻按惰性判断触发一次初始化（可能触发回填）。 */
          if (result.enabled) this.initMemoryEmbeddings();
          return respond(res, 200, { ok: true, value: { ...result, stats: this.embeddingStats() } });
        }
        case 'embedding-stats': return respond(res, 200, { ok: true, value: this.embeddingStats() });
        case 'test-embedding': {
          /* 连通测试。可选 body.provider：测「待保存的候选配置」而不动已保存的配置
             （用户在设置页改了地址还没保存时，也能先测通再存）。
             apiKey 回传掩码时沿用已保存的 key（与 set-embedding 同规则）。 */
          let candidate = body.provider;
          if (candidate !== null && candidate !== undefined && typeof candidate === 'object') {
            const current = this.embeddingProvider();
            candidate = { ...candidate };
            candidate.apiKey = resolveApiKeyInput(candidate.apiKey, current?.apiKey);
          }
          const result = await this.testEmbedding(body.provider === undefined ? undefined : candidate);
          return respond(res, 200, { ok: true, value: result });
        }
        case 'rebuild-embeddings': {
          const total = Number(this.db.prepare("SELECT COUNT(*) AS c FROM memories WHERE status = 'active'").get()?.c) || 0;
          const missing = this.countMemoriesMissingEmbedding();
          this.startEmbeddingBackfill({ total, missing });
          return respond(res, 200, { ok: true, value: { started: true, total, missing } });
        }
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

  /* 「记忆」视图的数据源：本会话固定注入 / 手动注入 / 自动注入三类。
     口径为「本会话全部注入历史」——自动注入直接复用 foldTurnContextMemory，
     它按轮回放 surface 存活集合，因此已 eject 的记忆不会出现，
     而每一轮的召回结果都被保留下来（重启后可完整重算，无额外存储）。 */
  /* 某一轮的记忆命中，含「本轮新召回」标记。
     轮次小面板（turn-memory-hits）与「记忆」视图（session-memory-view）共用这一份实现，
     避免 newRecall 的判定分叉成两套。foldMap 可传入以复用已折叠的结果，避免重复计算。 */
  memoryHitsForTurn(session, turn, foldMapArg) {
    const foldMap = foldMapArg ?? foldTurnContextMemory(sessionEvents(session));
    const hits = foldMap.get(turn) ?? [];
    /* 上一轮 = 小于 turn 的最大轮次；其命中集合即「上一轮已注入过的」。 */
    const previousTurn = [...foldMap.keys()]
      .filter((candidate) => Number.isSafeInteger(candidate) && candidate < turn)
      .sort((left, right) => right - left)[0];
    const previousIds = new Set(
      (previousTurn === undefined ? [] : foldMap.get(previousTurn) ?? [])
        .map((hit) => normalizePlainText(String(hit?.id ?? ''), 128))
        .filter(Boolean)
    );
    const memories = [];
    for (const hit of hits) {
      const id = normalizePlainText(String(hit?.id ?? ''), 128);
      if (!id) continue;
      const newRecall = !previousIds.has(id);
      /* 段位取自注入快照（旧快照无此字段则为空串，面板不显示徽标）。 */
      const segment = typeof hit?.segment === 'string' ? hit.segment : '';
      if (String(hit?.text ?? '') !== '') {
        memories.push({ ...hit, id, newRecall, segment });
        continue;
      }
      /* 遗留注入（无快照）的兜底：以记忆库实时解析，查不到（已删）丢弃 */
      const memory = this.memoryById(id);
      if (memory === undefined) continue;
      memories.push({
        id,
        text: memory.text ?? '',
        directoryName: memory.directoryName ?? '',
        tags: memory.tags ?? [],
        pinned: memory.pinned === true,
        newRecall,
        segment
      });
    }
    return { foldMap, memories };
  }

  sessionMemoryView(session) {
    const events = sessionEvents(session);
    const foldMap = foldTurnContextMemory(events);

    /* 自动注入：取最新一轮的召回结果作为「最新上下文」。
       轮次键升序排列，最后一个即当前最新已结束轮（未结束轮 fold 也会收尾写入）。
       命中与 newRecall 判定复用 memoryHitsForTurn（与小面板同源），
       本视图只在其上做 pinned 分流（手动注入那栏另行扫描）。 */
    const turns = [...foldMap.keys()].filter((turn) => Number.isSafeInteger(turn)).sort((left, right) => left - right);
    const latestTurn = turns.length > 0 ? turns[turns.length - 1] : undefined;
    const turnHits = latestTurn === undefined ? [] : this.memoryHitsForTurn(session, latestTurn, foldMap).memories;

    /* 手动注入按「哪些是最近一次注入的」判定：取最后一个手动注入行的 seq 为界。 */
    const manualSeqs = events
      .filter((event) => event?.type === 'user/message' && hasMemorySource(event.data?.source, MEMORY_MANUAL_SOURCE))
      .map((event) => event.seq);
    const latestManualSeq = manualSeqs.length > 0 ? Math.max(...manualSeqs) : undefined;

    const autoMemories = [];
    const pinnedMemories = [];
    for (const hit of turnHits) {
      /* 固定标记一律取快照值（即注入当时的 pinned），与轮次小面板保持一致——
         用户在小面板看到的是「那一轮注入了什么」，本视图同源同义，
         不因之后取消固定而改写历史。 */
      if (hit.pinned === true) pinnedMemories.push(hit);
      else autoMemories.push(hit);
    }

    /* 手动注入：不参与召回流程，走独立的 source kind，需单独扫事件流。
       只认 surface 上仍存活的行，被替换掉的（如会话删除轮次）不展示。 */
    const alive = new Set();
    const bySeq = new Map();
    for (const event of events) {
      bySeq.set(event.seq, event);
      if (isAppendSurfaceEvent(event)) alive.add(event.seq);
      else if (isReplacementSurfaceEvent(event)) {
        const start = Number(event.surfaceOp?.startSeq ?? event.surfaceOp?.start);
        const end = Number(event.surfaceOp?.endSeq ?? event.surfaceOp?.end);
        if (Number.isSafeInteger(start) && Number.isSafeInteger(end)) {
          for (let seq = start; seq <= end; seq++) alive.delete(seq);
        }
        alive.add(event.seq);
      }
    }
    const manualMemories = [];
    const seenManual = new Set();
    for (const seq of [...alive].sort((left, right) => left - right)) {
      const event = bySeq.get(seq);
      if (event?.type !== 'user/message') continue;
      const source = event.data?.source;
      if (!hasMemorySource(source, MEMORY_MANUAL_SOURCE)) continue;
      const snapshots = new Map();
      for (const hit of readMemorySnapshot(source)) {
        const id = normalizePlainText(String(hit?.id ?? ''), 128);
        if (id) snapshots.set(id, hit);
      }
      for (const idValue of readMemoryHitIds(source)) {
        const id = normalizePlainText(String(idValue ?? ''), 128);
        if (!id || seenManual.has(id)) continue;
        seenManual.add(id);
        const snapshot = snapshots.get(id);
        let text = String(snapshot?.text ?? '');
        let directoryName = String(snapshot?.directoryName ?? '');
        let tags = Array.isArray(snapshot?.tags) ? snapshot.tags.map(String) : [];
        if (text === '') {
          const memory = this.memoryById(id);
          if (memory === undefined) continue;
          text = memory.text ?? '';
          directoryName = memory.directoryName ?? '';
          tags = Array.isArray(memory.tags) ? memory.tags : [];
        }
        manualMemories.push({
          id, text, directoryName, tags,
          /* 一律取注入时的快照，与自动注入那两栏同一语义（反映「当时注入了什么」）。
             注意手动注入写入的 snapshot 本就不含 pinned 字段，故此项恒为 false，
             即手动注入栏不会出现 📌——这是有意为之，不是缺陷。 */
          pinned: snapshot?.pinned === true,
          /* 手动注入没有轮次概念：以最后一次手动注入行为界，该行带来的记忆视为「新注入」。 */
          newRecall: latestManualSeq !== undefined && seq === latestManualSeq
        });
      }
    }

    return {
      turn: latestTurn ?? null,
      turns: turns.length,
      pinned: pinnedMemories,
      manual: manualMemories,
      auto: autoMemories,
      autoTotal: turnHits.length
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
      pinned: ephemeral.pinned === true,
      eventTime: Number(ephemeral.eventTime) > 0 ? Number(ephemeral.eventTime) : 0,
      validUntil: Number(ephemeral.validUntil) > 0 ? Number(ephemeral.validUntil) : 0,
      formatId: ephemeral.formatId,
      creationMethod: ephemeral.creationMethod
    });
    const row = this.memoryRow(idText);
    return row === undefined ? undefined : compactMemory(memoryFromRow(row, true));
  }

  /* allowContentGuess=false 用于「用户显式要求记住」这一路径：用户没指定记忆项目时固定落
     default。注意不能只关掉内容打分——「唯一非 default 目录」「只启用了一个目录」这两条
     捷径同样会把记忆甩出 default，故它们也必须一起受该开关约束。
     其余调用方默认 true，行为与原来完全一致。 */
  /* asReadOnly=true 时只解析既有目录、绝不新建：冲突裁决在写库前调用，skip 分支不应留下空目录。 */
  resolveToolDirectoryId(input = {}, sessionId = '', text = '', { allowContentGuess = true, asReadOnly = false } = {}) {
    const directoryId = normalizePlainText(input.directoryId, 128);
    if (directoryId) {
      if (this.db.prepare('SELECT id FROM memory_directories WHERE id = ?').get(directoryId) === undefined) throw new MemoryError('directory-not-found', 'directory was not found', 404);
      return directoryId;
    }
    const directoryName = normalizePlainText(input.directoryName ?? input.directory, MAX_DIRECTORY_NAME_LENGTH);
    if (directoryName) {
      if (asReadOnly) {
        const row = this.db.prepare('SELECT id FROM memory_directories WHERE lower(name) = lower(?)').get(directoryName);
        return row?.id ?? null;
      }
      return this.ensureDirectory(directoryName);
    }
    if (allowContentGuess) {
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
    }
    if (asReadOnly) {
      const row = this.db.prepare('SELECT id FROM memory_directories WHERE name = ?').get(DEFAULT_MEMORY_DIRECTORY_NAME);
      return row?.id ?? null;
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
        /* run 可以是 async（如 memory_add 的冲突裁决要调 LLM）：返回的 Promise 需接住，
           否则异常逃逸成 unhandledRejection，既丢失日志也污染进程。 */
        const result = run();
        if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
          result.catch((error) => this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] async memory tool write failed:`, error));
        }
      } catch (error) {
        this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] async memory tool write failed:`, error);
      }
    }, 0);
    this.toolWriteTimers.add(timer);
    if (typeof timer?.unref === 'function') timer.unref();
    return timer;
  }

  /* explicit=true 表示该调用由「用户显式要求记住」触发：目录不按正文猜，标签缺省兜底为用户偏好。
     其余调用方保持原行为（目录按内容猜、标签按正文推断）。 */
  /* ── 新增记忆前的冲突裁决 ──
     流程：用新正文在**同一记忆项目内**检索相似旧记忆（FTS/BM25，只看 active，取前 3 条）→
     有候选才交给 LLM 判关系 → 返回 { action: 'add' | 'update' | 'skip', memoryId?, text?, reason? }。
     目标项目尚未创建时没有可比较的同项目候选，必须直接新增，绝不退回全库搜索。
     零候选时不调 LLM（常见路径零成本）；任何异常一律回退为 add，
     绝不让裁决失败挡住正常写入。 */
  async adjudicateMemoryAdd({ body, sessionId, agent, session, directoryId }) {
    if (!directoryId) return { action: 'add' };
    let candidates = [];
    try {
      candidates = this.searchMemories(body, {
        status: 'active',
        limit: MEMORY_CONFLICT_CANDIDATES,
        /* 目标目录已由调用方解析；候选检索始终限定在该项目。 */
        directoryId,
        fallbackSessionId: sessionId
      }) ?? [];
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory conflict candidate search failed:`, error);
      this.logConflictMissed('candidate-search-failed', directoryId, error);
      return { action: 'add' };
    }
    /* 只保留确有正文的候选，并去掉与新正文完全同文的（那种走哈希查重即可）。 */
    candidates = candidates.filter((item) => typeof item?.text === 'string' && item.text !== '' && item.text !== body);
    if (candidates.length === 0) return { action: 'add' };
    const route = routeForDistill(agent, session);
    if (route === undefined) {
      this.logConflictMissed('no-model-route', directoryId, `${candidates.length} candidates`);
      return { action: 'add' };
    }
    /* 裁决同样是旁路单轮补全：消息必须拆成 system（判定规则）+ user（新记忆与候选），
       否则强制首条为 system 的 provider 会直接拒绝（同蒸馏，v12.21）。 */
    const conflictPrompt = buildMemoryConflictPrompt(body, candidates);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('memory conflict timeout')), MEMORY_CONFLICT_TIMEOUT_MS);
    if (typeof timer?.unref === 'function') timer.unref();
    try {
      const messages = [
        createSystemMessage(conflictPrompt.instructions),
        createUserMessage({
          content: [{ type: 'text', text: conflictPrompt.data }],
          source: { kind: MEMORY_DISTILL_SOURCE, form: 'notice', summary: 'memory conflict check' }
        })
      ];
      const assembler = new BlockAssembler();
      for await (const chunk of this.ctx.llm.stream({
        provider: route.provider,
        model: route.model,
        messages,
        maxTokens: MEMORY_CONFLICT_MAX_OUTPUT_TOKENS,
        ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort }),
        sessionId: session?.id,
        purpose: 'memory-distill',
        signal: controller.signal
      })) {
        controller.signal.throwIfAborted();
        assembler.push(chunk);
      }
      const blocks = assembler.blocks();
      const finish = assembler.finish ?? { kind: 'stop' };
      /* 裁决也消耗 LLM：原先完全不记录，用量总览里只剩蒸馏，
         导致「冲突检测到底跑没跑、花了多少」在用量侧不可见。 */
      const conflictUsage = normalizeTokenUsage(assembler.usage);
      this.recordMemoryTokenUsage({
        kind: 'memory-conflict',
        directoryId: directoryId ?? null,
        sessionId: sessionId ? String(sessionId) : null,
        memoryScope: 'persistent',
        memoryId: null,
        model: `${route.provider}/${route.model}`,
        reasoning: route.reasoningEffort ?? null,
        tokens: conflictUsage?.totalTokens,
        createdAt: now()
      });
      const textBlocks = blocks.filter((block) => block.type === 'text').map((block) => block.text).filter(Boolean);
      const reasoningBlocks = blocks.filter((block) => block.type === 'reasoning').map((block) => block.text).filter(Boolean);
      const output = textBlocks.join('\n').trim();
      const blockTypes = blocks.map((block) => block.type);
      /* 裁决失败必须留痕，否则冲突检测静默失效、事后无从排查。三类根因分开记：
         1) 流以 error/aborted 收场——原先完全不检查 finish，会被误当成「空输出」；
         2) 无 text 块——推理模型把输出预算耗在 reasoning 上是常见成因，
            故把块类型与 reasoning 条数写进细节，便于下次直接定位；
         3) 有输出但解析不出动作（模型没按 JSON 契约作答）。 */
      if (finish.kind === 'error' || finish.kind === 'aborted') {
        const failureMessage = finish.failure?.message || `LLM stream finished with ${finish.kind}`;
        this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory conflict adjudication terminal failure ${JSON.stringify({ finish: finish.kind, message: failureMessage, candidates: candidates.length })}`);
        this.logConflictMissed(finish.kind === 'aborted' ? 'llm-timeout' : 'llm-failed', directoryId, failureMessage, candidates.length);
        return { action: 'add' };
      }
      if (output.length === 0) {
        this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory conflict adjudication produced no text output ${JSON.stringify({ blockTypes, reasoningBlockCount: reasoningBlocks.length, finish: finish.kind, candidates: candidates.length })}`);
        this.logConflictMissed('empty-output', directoryId, `块类型=${blockTypes.join(',') || '无'}；reasoning 块 ${reasoningBlocks.length} 个；finish=${finish.kind}`, candidates.length);
        return { action: 'add' };
      }
      /* 区分两种 add：模型确实判为「全新信息」 vs 输出没能解析出动作。 */
      const parsedAction = readConflictActionToken(output);
      const decision = parseMemoryConflictDecision(output, candidates);
      if (decision.action === 'add' && parsedAction !== 'add') {
        this.logConflictMissed('unparsed-output', directoryId, output.slice(0, 200), candidates.length);
      }
      if (decision.action !== 'add') {
        this.ctx.logger?.info?.(`[${PLUGIN_NAME}] memory conflict resolved ${JSON.stringify({ action: decision.action, memoryId: decision.memoryId ?? null, candidates: candidates.length })}`);
      }
      return decision;
    } catch (error) {
      /* 超时（abort）与真实调用失败分开记：超时是配置/负载问题，不是模型故障。 */
      const timedOut = controller.signal.aborted;
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory conflict adjudication failed; falling back to add:`, error);
      this.logConflictMissed(timedOut ? 'llm-timeout' : 'llm-failed', directoryId, error?.message || String(error), candidates.length);
      return { action: 'add' };
    } finally {
      clearTimeout(timer);
    }
  }

  /* 冲突检测未生效时的活动日志：记忆仍会正常新增，故 outcome 记 skipped（而非 failed），
     summary 写明原因，供日志页排查「为什么这次新增没做去重」。 */
  logConflictMissed(reason, directoryId, detail, candidateCount) {
    try {
      const activity = this.beginActivity('memory_conflict_missed', {
        sessionId: '',
        sessionTitle: '',
        summary: activitySummaryText(conflictMissedText(reason, detail, candidateCount)),
        triggerKind: 'tool'
      });
      this.finishActivity(activity, 'skipped', {
        summary: activitySummaryText(conflictMissedText(reason, detail, candidateCount))
      });
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory conflict missed log failed:`, error);
    }
  }

  /* 裁决改写了既有记忆（或判定等价）时，把结果落成一条会话消息：模型看得到、用户也看得到。
     与「显式记忆请求」提示同构——都是 user/message + 私有 source，不污染召回。 */
  notifyMemoryAddMerged(session, decision) {
    if (typeof session?.append !== 'function') return null;
    try {
      const message = createUserMessage({
        content: [{ type: 'text', text: conflictNoticeText(decision.action, decision.memoryId, decision.reason) }],
        source: { kind: MEMORY_CONFLICT_SOURCE, form: 'notice', summary: `memory ${decision.action} ${decision.memoryId}` }
      });
      const result = session.append('user/message', message, { surfaceOp: 'append' });
      return Number(result?.seq ?? NaN) >= 0 ? Number(result.seq) : null;
    } catch (error) {
      this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory conflict notice append failed:`, error);
      return null;
    }
  }

  /* 轮次登记表的清理：只保留最近 200 条，防长会话无限增长。
     不做基于时间的过期 —— 轮次边界本身已是天然隔离，清理只为封顶内存。 */
  pruneMemoryAddByTurn() {
    if (this.memoryAddByTurn.size <= 200) return;
    const excess = this.memoryAddByTurn.size - 200;
    let removed = 0;
    for (const key of this.memoryAddByTurn.keys()) {
      if (removed >= excess) break;
      this.memoryAddByTurn.delete(key);
      removed += 1;
    }
  }

  /* 生成前确定格式的登记表清理：与 memoryAddByTurn 同构（只封顶内存）。 */
  pruneTurnDeterminedFormat() {
    if (this.turnDeterminedFormat.size <= 200) return;
    const excess = this.turnDeterminedFormat.size - 200;
    let removed = 0;
    for (const key of this.turnDeterminedFormat.keys()) {
      if (removed >= excess) break;
      this.turnDeterminedFormat.delete(key);
      removed += 1;
    }
  }

  /* 取「本轮已确定的格式」（无则 undefined）。
     ⚠️ v12.6.3 关键修正：必须【当场用本轮转录重算】，不能只读 pre-step 预存的值。
     原因（实测 session-8973be18 turn=7）：pre-step 在 next() 之前执行，那一刻本轮助手
     回复尚未产生，转录里只有用户说的「保存」二字 —— 不含「角色」，筛不出角色类，
     预存值恒为空。而工具执行时转录已完整（含助手 reasoning 里的「角色类格式」与
     写好的正文），此时重算才拿得到正确格式。
     重算失败（无转录/异常）再回落到预存值，保证 pre-step 那条通路仍然有效。 */
  /* 字段指纹匹配（v12.7）：对纯文本正文，用每个激活非代码格式的字段清单试抽
     「字段名：」写法，命中数 ≥2 且唯一最高（领先次名 ≥2）者胜。
     这是「保存」类短消息场景的唯一可靠归属手段：用户输入太短撑不起名称匹配，
     正文无 JSON 键撑不起键集合反推，但字段式纯文本本身就携带格式指纹
     （「名称：…年龄：…灵根：…」对角色类是 6/6 命中，对日记类通常 ≤1）。 */
  matchFormatByFieldFingerprint(text, allowedFormatIds = undefined) {
    const raw = typeof text === 'string' ? text : String(text ?? '');
    const allowed = normalizeAllowedFormatIdSet(allowedFormatIds);
    if (raw.trim().length === 0) return undefined;
    const scored = [];
    for (const format of this.activeFormats()) {
      if (allowed !== undefined && !allowed.has(format.id)) continue;
      if (format.id === MEMORY_FORMAT_CODE_ID) continue;
      const declared = (format.definition?.fields ?? []).map((field) => field?.key).filter((key) => typeof key === 'string' && key.length > 0);
      if (declared.length === 0) continue;
      const extracted = extractFormatFieldsFromText(raw, format.definition);
      if (extracted === undefined) continue;
      scored.push({ id: format.id, definition: format.definition, filled: extracted.filled, declared: declared.length });
    }
    if (scored.length === 0) return undefined;
    scored.sort((left, right) => right.filled - left.filled || left.declared - right.declared);
    const [first, second] = scored;
    if (first.filled < 2) return undefined;
    if (second !== undefined && first.filled - second.filled < 2) return undefined;
    return first;
  }

  determinedFormatFor(sessionId, turn, agent = undefined) {
    if (!Number.isSafeInteger(turn)) return undefined;
    const key = `${String(sessionId || '')}:${turn}`;
    /* 优先当场重算：用 agent.session 取最新转录。 */
    if (agent?.session !== undefined) {
      try {
        const rows = turnTranscript(agent.session, turn);
        const meaningful = Array.isArray(rows)
          ? rows.filter((row) => typeof row?.text === 'string' && row.text.trim().length > 0)
          : [];
        if (meaningful.length > 0) {
          const active = this.activeFormats();
       /* 与蒸馏、memory_add 工具描述、显式「记住」提示同口径：
          仅一套激活格式时不做名称筛选；无可选择时它就是本轮格式。
          旧实现这里无条件 selectFormatsForText，导致单一自定义格式在本轮正文
          未出现格式名称时被筛空，而其它入口却直接注入/指定它。 */
       const selected = active.length === 1 ? active : selectFormatsForText(active, renderTranscript(meaningful));
          const nonCode = selected.filter((format) => format.id !== MEMORY_FORMAT_CODE_ID);
          if (nonCode.length === 1 && !selected.some((format) => format.id === MEMORY_FORMAT_CODE_ID)) {
            this.turnDeterminedFormat.set(key, nonCode[0].id);
            this.pruneTurnDeterminedFormat();
            return nonCode[0];
          }
          /* 重算明确得出「非代码格式不是恰好一套」→ 以重算为准，清掉预存值。 */
          this.turnDeterminedFormat.delete(key);
          return undefined;
        }
      } catch (error) {
        this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] determined format recompute failed:`, error);
      }
    }
    /* 重算不可用（无 agent/无转录）时回落预存值。
       ⚠️ 必须校验 status（v12.27，用户提醒「注入的记忆格式必须是激活状态」）：
       determinedFormat 会进入 prepareMemoryWrite 的【最高优先级分支】，而该分支
       不检查 status —— 若这里用 formatById（查全量）返回一个已停用的格式，
       停用格式就绕过了全部停用门控、直接生效。故预存值回落时也只认启用格式：
       格式在留存后被停用时，这里应当返回 undefined（视为本轮无既定格式）。 */
    const stored = this.formatById(this.turnDeterminedFormat.get(key));
    if (stored === undefined || stored.status !== 'active') {
      this.turnDeterminedFormat.delete(key);
      return undefined;
    }
    return stored;
  }

  addToolMemory(input = {}, sessionId = '', activityContext = {}, options = {}) {
    const explicit = options.explicit === true;
    /* activityUserMessageForToolCall 返回的字段名是 text（此前误读为 userText，导致摘要恒回退、
       且下方 explicit 判定恒为 false）。 */
    const userSummary = activityContext.text || input.text || input.content;
    /* ── 同一轮只允许一次 memory_add（v12.5）──
       设计前提：一条记忆 = 一个格式实例，格式声明的字段就是该条记忆的全部可写空间。
       模型遇到「格式里没有合适字段」时的错误做法是拆成第二条 memory_add（实测：角色类
       无「羁绊」字段，模型把角色卡与团队羁绊拆成两条，其中一条必然无归属）。
       正确做法是把信息并入已声明字段，或另择更贴合的格式；实在放不下就不写。
       拦在同步阶段（早于队列），第二次调用直接拒绝并给出可执行的纠正指引。
       turn 未知（activityContext.turn undefined）时不拦 —— 没有轮次边界就无法判定
       「同一轮」，宁可放行也不能误伤正常写入。 */
    const turn = Number.isSafeInteger(activityContext.turn) ? activityContext.turn : undefined;
    const addTurnKey = turn === undefined ? undefined : `${String(sessionId || '')}:${turn}`;
    if (addTurnKey !== undefined && this.memoryAddByTurn.has(addTurnKey)) {
      const previous = this.memoryAddByTurn.get(addTurnKey);
      const reason = 'duplicate-memory-add-in-turn';
      const detail = `本轮已写入过一条记忆（id: ${previous}）。一条记忆只能对应一个格式实例，`
        + '其字段由所选格式声明、就是该条记忆的全部可写空间：'
        + '若还有信息放不下，请把它并入已声明字段（或改选字段更贴合的格式）后重新调用一次 memory_add，'
        + '不要为同一件事拆成第二条记忆。';
      this.finishActivity(this.beginActivity('memory_add', {
        sessionId: '', sessionTitle: '', turn, callId: activityContext.callId,
        summary: activitySummaryText(userSummary), triggerKind: 'tool'
      }), 'failed', { errorCode: reason, errorMessage: detail });
      throw new MemoryError(reason, detail);
    }
    const activity = this.beginActivity('memory_add', { sessionId: '', sessionTitle: '', turn: activityContext.turn, callId: activityContext.callId, summary: activitySummaryText(userSummary), triggerKind: 'tool' });
    /* 同步校验（格式必需/多余字段、正文长度）先行：校验失败不占名额，
       模型修正后仍可在本轮重试。
       determinedFormat：本轮【生成前】已确定的格式（由工具描述筛选时留存）。
       模型没显式传 formatId 时用它兜底 —— 避免事后靠代码特征词猜（会误判）。 */
    const allowedFormatIds = this.formatsForToolDescription().map((format) => format.id);
    let prepared;
    try {
      prepared = this.prepareMemoryWrite(input.text ?? input.content, {
        formatId: input.formatId,
        strict: true,
        /* 传 activityContext.session（= exec.agent.session）：determinedFormatFor 会用
           它取【此刻】的完整转录当场重算 —— pre-step 预存时本轮回复尚未产生，值不可靠。 */
        determinedFormat: input.formatId === undefined
          ? this.determinedFormatFor(sessionId, activityContext.turn, activityContext.agent)
          : undefined,
        allowedFormatIds
      });
    } catch (error) {
      this.finishActivity(activity, 'failed', { errorCode: error?.code, errorMessage: error?.message || String(error) });
      throw error;
    }
    const body = prepared.body;
    if (body.length < 6) {
      this.finishActivity(activity, 'failed', { errorCode: 'invalid-memory-text', errorMessage: 'memory text must be at least 6 characters' });
      throw new MemoryError('invalid-memory-text', 'memory text must be at least 6 characters');
    }
    /* ⚠️ 占位登记放在【同步阶段、校验通过之后】：模型常在同一 step 并行发起多次
       memory_add（实测 session-8973be18），两次 execute 的同步段会先后跑完，而 run()
       走队列串行 —— 若登记写在 run() 里，第二次调用检查时第一次尚未登记，拦截形同虚设。
       先占位（callId），run() 成功后回填真实 memoryId；失败/未新增则在 run() 里释放。 */
    if (addTurnKey !== undefined) {
      this.memoryAddByTurn.set(addTurnKey, String(activityContext.callId ?? 'pending'));
      this.pruneMemoryAddByTurn();
    }
    /* reactivateInactive：只在「命中同项目同正文」与「语义等价跳过」两条路径开启——
       这两条都等价于用户又提了一遍同一件事，把先前停用的记忆自动启用符合直觉。
       ⚠️ 冲突裁决的 update（合并改写）路径必须关掉：裁决要调 LLM，耗时数秒，
       其间用户若手动停用了该记忆，合并收尾时的自动启用会把用户的停用悄悄翻回来
       （停用是用户明确的「别再用这条」，不该被后台流程覆盖）。
       注意 input.status 显式给出的情形不受本开关约束：那是本次调用明确要求的状态。 */
    const requestedMetadataFor = (memoryId, { reactivateInactive = true } = {}) => {
      const update = { memoryId };
      const existingMemory = this.memoryById(memoryId);
      const existingTags = existingMemory?.tags ?? [];
      const providedTags = (Array.isArray(input.tags) || Array.isArray(input.tagNames))
        ? uniqueStrings(input.tags ?? input.tagNames, MAX_TAGS_PER_MEMORY).map(normalizeTagName).filter(Boolean)
        : [];
      if (providedTags.length > 0 || explicit) {
        const requestedTags = providedTags.length > 0 ? providedTags : EXPLICIT_MEMORY_REQUEST_TAGS;
        update.tagNames = uniqueStrings([...requestedTags, ...existingTags], MAX_TAGS_PER_MEMORY);
      }
      if (input.status !== undefined) update.status = input.status;
      else if (reactivateInactive && existingMemory?.status === 'inactive') update.status = 'active';
      if (typeof input.pinned === 'boolean') update.pinned = input.pinned;
      if (input.eventTime !== undefined && input.eventTime !== null && String(input.eventTime).trim() !== '') update.eventTime = input.eventTime;
      if (input.validUntil !== undefined && input.validUntil !== null && String(input.validUntil).trim() !== '') update.validUntil = input.validUntil;
      return update;
    };
    const hasRequestedMetadata = (update) => Object.keys(update).length > 1;
    const run = async () => {
      try {
        const hash = memoryHash(body);
        const targetDirectoryId = this.resolveToolDirectoryId(input, sessionId, body, { allowContentGuess: !explicit, asReadOnly: true });
        const duplicate = targetDirectoryId ? this.persistentByHash(hash, targetDirectoryId) : undefined;
        if (duplicate !== undefined) {
          const metadata = requestedMetadataFor(duplicate);
          if (hasRequestedMetadata(metadata)) this.updateMemory(metadata, { logActivity: true, triggerKind: 'tool' });
          this.finishActivity(activity, 'duplicate', { memoryId: duplicate, summary: activitySummaryText(body) });
          /* 同项目同正文已存在：没有新记忆产生，释放占位。 */
          if (addTurnKey !== undefined) this.memoryAddByTurn.delete(addTurnKey);
          return;
        }
        /* ★ 写库前的冲突裁决：在**目标记忆项目内**检索相似旧记忆，让 LLM 判关系。
           update → 改写既有记忆（自动留修订）；skip → 语义等价，不新增；
           add（含裁决失败/无候选）→ 走下方原新增路径。
           目录以只读方式先解析：限定同一项目用，且 skip 分支不会留下空目录。 */
        const decision = await this.adjudicateMemoryAdd({
          body,
          sessionId,
          agent: activityContext.agent,
          session: activityContext.session,
          directoryId: targetDirectoryId
        });
        if (decision.action === 'update') {
          /* 合并进既有记忆时，模型为本次新增带上来的事实时间也要一并落进去——
             否则「上周五部署了 v2」这类带日期的记忆一旦被判为 update，
             日期会在合并路径上静默丢失（新增路径有、合并路径没有）。
             ⚠️ 只有本次确实带了【有效日期】才覆盖：空串/null 表示「这次没提日期」，
             不该把既有记忆的日期清掉——清空是 memory_update 工具的显式语义
             （传空串），不能让合并路径顺手代劳。 */
          /* 时序复核：裁决候选取自「当时 active」，但裁决要调 LLM（数秒），
             其间用户可能已手动停用该记忆。停用是明确的「别再用这条」，
             此时既不该把停用翻回来（reactivateInactive: false），也不该继续改写正文——
             直接放弃合并、改走新增，用户的停用与原文都保持原样。 */
          if (this.memoryById(decision.memoryId)?.status !== 'active') {
            this.ctx.logger?.info?.(`[${PLUGIN_NAME}] memory merge skipped: target ${decision.memoryId} is no longer active`);
            this.logConflictMissed('target-inactive', targetDirectoryId, `memory ${decision.memoryId} became inactive during adjudication`);
          } else {
            const mergedUpdate = { ...requestedMetadataFor(decision.memoryId, { reactivateInactive: false }), text: decision.text };
            this.updateMemory(mergedUpdate, { logActivity: true, triggerKind: 'tool' });
            this.finishActivity(activity, 'success', { memoryId: decision.memoryId, summary: activitySummaryText(body) });
            this.notifyMemoryAddMerged(activityContext.session, decision);
            /* 合并进既有记忆：本轮没有产生新记忆，释放占位，不占用「一轮一次」名额。 */
            if (addTurnKey !== undefined) this.memoryAddByTurn.delete(addTurnKey);
            return;
          }
        }
        if (decision.action === 'skip') {
          const metadata = requestedMetadataFor(decision.memoryId);
          if (hasRequestedMetadata(metadata)) this.updateMemory(metadata, { logActivity: true, triggerKind: 'tool' });
          this.finishActivity(activity, 'duplicate', { memoryId: decision.memoryId, summary: activitySummaryText(body) });
          this.notifyMemoryAddMerged(activityContext.session, decision);
          /* 语义等价跳过：同样没有新记忆，释放占位。 */
          if (addTurnKey !== undefined) this.memoryAddByTurn.delete(addTurnKey);
          return;
        }
        /* 复用裁决前解析出的目录；为 null（既有目录缺失）时才真正创建。 */
        const directoryId = targetDirectoryId ?? this.resolveToolDirectoryId(input, sessionId, body, { allowContentGuess: !explicit });
        /* 标签来源三级：模型显式给的 > 显式请求兜底（用户偏好） > 按正文推断。
           原行为（未给标签即按正文推断）只在非显式路径保留。 */
        const providedTags = Array.isArray(input.tags) || Array.isArray(input.tagNames)
          ? uniqueStrings(input.tags ?? input.tagNames, MAX_TAGS_PER_MEMORY).map(normalizeTagName).filter(Boolean)
          : [];
        const tagNames = providedTags.length > 0
          ? providedTags
          : explicit
            ? uniqueStrings(EXPLICIT_MEMORY_REQUEST_TAGS, MAX_TAGS_PER_MEMORY)
            : normalizeTagNames(undefined, body);
        const status = normalizeStatus(input.status, 'active');
        const stamp = now();
        const memoryId = id('mem');
        /* 事实时间：模型可显式给事件时间/失效时间；未给则留空（行为同旧版）。 */
        const eventTime = parseFactTime(input.eventTime, { label: 'eventTime' });
        const validUntil = parseValidUntil(input.validUntil);
        assertFactTimeOrder(eventTime, validUntil);
        this.db.prepare('INSERT INTO memories (id, directory_id, body, status, content_hash, creation_method, created_at, updated_at, last_recalled_at, pinned, event_time, valid_until, format_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)')
          .run(memoryId, directoryId, body, status, hash, 'memory_add', stamp, stamp, input.pinned === true ? 1 : 0, eventTime ?? null, validUntil ?? null, prepared.formatId);
        this.setMemoryTags(memoryId, tagNames);
        this.reindexMemory(memoryId);
        /* 冲突裁决判定「新记忆替代了某条旧记忆」时，给旧记忆打失效时刻（区间截断）。
           失败不影响新增——截断是增值能力，不能反过来阻断写入。 */
        if (decision.supersedesMemoryId !== undefined) {
          try {
            const changed = supersedeMemoryValidity(this.db, decision.supersedesMemoryId, memoryId, stamp);
            this.ctx.logger?.info?.(`[${PLUGIN_NAME}] memory superseded ${JSON.stringify({ superseded: decision.supersedesMemoryId, by: memoryId, changed })}`);
          } catch (error) {
            this.ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory supersede marking failed:`, error);
          }
        }
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
        /* 回填真实 memoryId（同步阶段占位的是 callId）。 */
        if (addTurnKey !== undefined) this.memoryAddByTurn.set(addTurnKey, memoryId);
      } catch (error) {
        this.finishActivity(activity, 'failed', { errorCode: error?.code, errorMessage: error?.message || String(error) });
        /* 写入失败：释放占位，让模型修正后能在同一轮重试（失败不该永久堵住本轮）。 */
        if (addTurnKey !== undefined) this.memoryAddByTurn.delete(addTurnKey);
        throw error;
      }
    };
    this.queueToolWrite(run);
    return { accepted: true };
  }

  stopMemory(input = {}) {
    const memoryId = normalizePlainText(input.memoryId, 128);
    if (!memoryId) throw new MemoryError('invalid-memory-id', 'memoryId must not be empty', 400);
    /* 补上活动日志：此前停用走 updateMemory 但未记日志，模型停用记忆在日志里完全不可见。
       正文未变，故 summary 为纯文本 + 「状态：active → inactive」一行（见 memoryUpdateActivitySummary）。 */
    this.updateMemory({ memoryId, status: 'inactive' }, { logActivity: true, triggerKind: 'tool' });
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
    const hasPinned = typeof input.pinned === 'boolean';
    /* 事实时间：'' / null = 清除为未声明；具体日期 = 覆盖；undefined = 保持不变。
       清除语义不能省——写错的日期得能改回去。 */
    const hasEventTime = input.eventTime !== undefined;
    const hasValidUntil = input.validUntil !== undefined;
    /* 格式归属：'' = 清除为无归属；具体 id = 覆盖；undefined = 保持不变。 */
    const hasFormatId = input.formatId !== undefined;
    if (!hasText && !hasStatus && !hasTags && !hasDirectory && !hasPinned && !hasEventTime && !hasValidUntil && !hasFormatId) throw new MemoryError('empty-update', 'provide text, tags, status, pinned, directory, eventTime, validUntil, or formatId to update', 400);
    const before = this.memoryById(memoryId);
    if (before === undefined) throw new MemoryError('memory-not-found', 'memory was not found', 404);
    const activity = this.beginActivity('memory_update', { sessionId: '', sessionTitle: '', memoryId, summary: activitySummaryText(before.text || `memory ${memoryId}`), triggerKind: 'tool' });
    const payload = { memoryId };
    if (hasText) payload.text = input.text ?? input.content;
    if (hasStatus) payload.status = input.status;
    if (hasTags) payload.tagNames = input.tags ?? input.tagNames;
    if (hasPinned) payload.pinned = input.pinned;
    if (hasEventTime) payload.eventTime = input.eventTime === null || input.eventTime === '' ? null : input.eventTime;
    if (hasValidUntil) payload.validUntil = input.validUntil === null || input.validUntil === '' ? null : input.validUntil;
    /* formatId 的三态直接透传：'' 与 null 都表示「清除为无归属」，updateMemory 按 '' 处理。 */
    if (hasFormatId) payload.formatId = input.formatId === null ? '' : input.formatId;
    if (input.directoryId !== undefined) payload.directoryId = input.directoryId;
    else if (input.directoryName !== undefined || input.directory !== undefined) payload.directoryId = this.resolveToolDirectoryId(input);
    const allowedFormatIds = this.formatsForToolDescription().map((format) => format.id);
    const run = () => {
      try {
        this.updateMemory(payload, { triggerKind: 'tool', allowedFormatIds });
        const memory = this.memoryById(memoryId);
        if (memory === undefined) throw new MemoryError('memory-not-found', 'memory was not found', 404);
        /* 差异 summary：before 取入参前的快照（L4984），after 取改动后的实况。 */
        const summary = memoryUpdateActivitySummary(memoryActivitySnapshot(before), memoryActivitySnapshot(memory), String(before.text ?? '') !== String(memory.text ?? ''));
        this.finishActivity(activity, 'success', { memoryId, summary });
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
    const signature = normalizeActiveRecallArgs(toolName, {
      ...args,
      fallbackSessionId: normalizeToolSessionId(exec.agent?.session?.id)
    });
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
    const enabled = input.scope === 'enabled' ? this.enabledDirectoryIds(sessionId) : null;
    const isAllowed = (directoryId) => enabled === null || enabled.includes(directoryId);
    const directoryId = normalizePlainText(input.directoryId, 128);
    if (directoryId) {
      if (this.db.prepare('SELECT id FROM memory_directories WHERE id = ?').get(directoryId) === undefined) throw new MemoryError('directory-not-found', 'directory was not found', 404);
      return isAllowed(directoryId) ? [directoryId] : [];
    }
    const directoryName = normalizePlainText(input.directoryName ?? input.directory, MAX_DIRECTORY_NAME_LENGTH);
    if (directoryName) {
      const row = this.db.prepare('SELECT id FROM memory_directories WHERE lower(name) = lower(?)').get(directoryName);
      return row !== undefined && isAllowed(row.id) ? [row.id] : [];
    }
    if (enabled !== null) return enabled;
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
    const wantedTags = normalizeDistillList(options.tags ?? options.tagNames, MAX_TAGS_PER_MEMORY);
    /* 纯时间/标签检索允许空词；terms 是 LIKE 回退的实际检索依据，
       无可检索词、时间范围或标签条件时不能退化成全库列表（含纯标点查询）。 */
    if (terms.length === 0 && timeRange === undefined && wantedTags.length === 0) return [];
    const placeholders = directoryIds.map(() => '?').join(', ');
    const status = normalizePlainText(options.status, 16);
    const statusSql = status && status !== 'all' ? 'AND m.status = ?' : '';
    const statusArgs = status && status !== 'all' ? [normalizeStatus(status, 'active')] : [];
    /* 时间窗命中四类时间任一即可：记录时间（created/updated）+ 事实时间（event_time/valid_until）。
       事实时间列可空：NULL 比较结果为 NULL（不命中该分支），但 created_at 恒有值，
       故「无事实时间的记忆」不会因此漏召回——扩窗只增不减。 */
    const timeSql = timeRange !== undefined ? 'AND ((m.created_at >= ? AND m.created_at < ?) OR (m.updated_at >= ? AND m.updated_at < ?) OR (m.event_time >= ? AND m.event_time < ?) OR (m.valid_until >= ? AND m.valid_until < ?))' : '';
    const timeArgs = timeRange !== undefined ? [timeRange.start, timeRange.end, timeRange.start, timeRange.end, timeRange.start, timeRange.end, timeRange.start, timeRange.end] : [];
    const customContext = customTagMatchContext(searchText || queryText);
    /* 结构分档位与召回路径一致：同一份数据不应出现两套排序。
       （searchMemories 是工具路径，拿得到 this，故直接用实例判据。） */
    customContext.structureWeights = structureWeightsForStore(this);
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
    if (wantedTags.length > 0) rows = rows.filter((row) => rowTagNames(row).some((tag) => wantedTags.includes(tag)));
    const profile = options.profile ?? detectRecallProfile(queryText);
    return rerankRecallRows(rows, profile, startedAt, searchText || queryText, customContext.structureWeights).slice(0, limit).map((row) => compactMemory(memoryFromRow(row, true)));
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

function memoryItemSchema(full = false) {
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
      pinned: { type: 'boolean', required: true },
      eventTime: { type: 'integer', required: true },
      validUntil: { type: 'integer', required: true },
      /* 记忆格式归属。compactMemory 与 memoryFromRow 都产出它，故必须在白名单里声明
         —— 本 schema 是 additionalProperties:false，漏声明会让所有返回记忆的工具
         （memory_search/memory_read/memory_update…）在输出校验阶段直接失败。 */
      formatId: { type: 'string', required: true },
      creationMethod: { type: 'string', required: true, enum: ['', 'manual', 'auto-distill', 'manual-distill', 'memory_add', 'import'] },
      /* full 变体：memoryFromRow 原始结果恒带 tagIds/persisted，compactMemory 结果
         不带（memory_read/memory_stop 沿用默认变体）。补声明以通过
         additionalProperties 白名单校验，字段本身不标 required 以兼容两种形态。 */
      ...(full ? {
        tagIds: { type: 'array', items: { type: 'string' } },
        persisted: { type: 'boolean' }
      } : {})
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
  /* memory_relate 的 origin/related 返回 memoryFromRow 原始结果（含 tagIds/persisted，
     related 每项另带 hop/relationScore），与 compactMemory 形态不同，须用 full 变体。 */
  const memoryFullItemSchema = memoryItemSchema(true);
  const memoryFullListSchema = {
    type: 'array',
    required: true,
    items: memoryFullItemSchema
  };
  const memoryRelatedListSchema = {
    type: 'array',
    required: true,
    items: {
      ...memoryFullItemSchema,
      properties: { ...memoryFullItemSchema.properties, hop: { type: 'integer' }, relationScore: { type: 'number' } }
    }
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
    tags: { type: 'array', items: { type: 'string' }, description: '记忆标签。必须主动填写：最多 1 个描述性自定义标签，优先用精准的具体事件/动作、对象/实体/专名（如函数、模块、API、产品、人名）或明确场景；尽量沿用正文/本轮对话原词，避免抽象泛词与同义变体。稳定标签仍按语义从现有预设体系中映射（用户偏好/用户画像/项目画像/项目架构/项目约束/模块路径/模块约束/项目场景/接口摘要/接口约束/项目摘要/模块摘要/排查记录/决策记录），映射得上的一并列出；写入端会优先精确复用当前项目已有标签，并对名称包含变体作保守归并；不会猜测纯语义近义词。不要用"工作项目"这类无区分度的泛词凑数。' },
    status: statusParam,
    pinned: { type: 'boolean', description: '固定召回：设为 true 后，只要该记忆所属项目在会话中启用，就保证被注入（与其他记忆一同参与相关性排序；排序未入选时在四段筛选之后额外补入，因此注入总量可能超过召回条数设置）。仅用于用户明确要求"每次都带上/固定召回/必须记住"的少数关键记忆，默认不要传。' },
    eventTime: { type: 'string', description: '事件发生时间：这条记忆所述事情**在现实中发生/生效**的时刻（不是「现在保存的时间」）。格式 YYYY-MM-DD，需要精确到分钟时用「YYYY-MM-DD HH:MM」（如 2026-09-29 14:30）；相对表达如「上周五」「昨天」先换算成具体日期。只在对话里出现了明确日期时填；「当前用某方案」这类没有发生时刻的状态陈述不要填。仅当它确实不同于记录时间时才有价值。' },
    validUntil: { type: 'string', description: '事件失效时间：这条记忆**预计何时不再成立**（如「本周内有效」「临时方案过渡到月底」）。格式 YYYY-MM-DD（按当日结束计），需要精确到分钟时用「YYYY-MM-DD HH:MM」。只在内容自带期限或临时性时填；长期有效的偏好/架构/约束不要填。到点后该记忆在召回里降权（不删除），并在注入时标注「已过期」。' },
    /* ⚠️ 不要把「内置代码类为 fmt-code」写进描述（v12.18）：代码类停用后它不在格式清单里，
       而这段硬编码会让模型照抄一个已停用的 id，导致记忆被归属到用户已停用的格式
       （实测反馈「代码类已停用，蒸馏时仍自动归属为代码类」）。
       改为「只从本轮清单里选」，清单本身由 formatsForToolDescription 动态注入。 */
    formatId: { type: 'string', description: '记忆格式归属 id（可选）：正文是按哪套记忆格式写的，就传【该格式在下方清单里给出的格式ID】（原样照抄，不要编造、不要写格式名称）；格式清单未提到某格式时不要传它的 id。不传则由程序按正文字段自动判定归属；格式定义里的必需字段缺失时写入会被拒绝。' }
  };
  const disposers = [];
  /* 工具描述随激活格式动态变化：把 defineTool 的返回值包一层 getter。
     依据：schema 在投影时才读取 definition.description（dsh-tools 的 schemaOf 每次解构），
     故 getter 会在每次生成工具 schema 时重新求值。defineTool 返回普通对象（未 freeze），
     可安全重定义（@deepseek-ai/dsh-tools 自身也用 Object.defineProperty 做 run_code 的动态描述）。
     ⚠️ 仅在「多于一套激活格式」时才改写：单格式下保持原静态描述，避免无谓变动。 */
  /* 工具描述动态化：把 defineTool 返回值包一层 parameters getter，
     在每次投影 schema 时重算描述。两种用法：
       · registerTool(def, () => '新 text 描述')            —— 改写 text 参数（memory_add）
       · registerTool(def, () => ({ formatId: '新描述' }))  —— 改写任意参数（memory_update）
     ⚠️ memory_update 此前用 defineTool 直接注册，其 formatId 描述里却写着「下方清单」，
     而该工具根本没有注入任何清单 —— 模型看不到可用格式与其字段定义，改正文时只能凭上下文猜
     （v12.29 补齐：与 memory_add 同口径注入清单，消除这处表述失配）。 */
  const registerTool = (definition, defineTextDescription) => {
    const registered = defineTool(definition);
    if (typeof defineTextDescription === 'function') {
      const originalParameters = registered.parameters;
      Object.defineProperty(registered, 'parameters', {
        enumerable: true,
        configurable: true,
        get: () => {
          const base = originalParameters;
          const produced = defineTextDescription();
          if (produced === undefined || produced === null) return base;
          /* 字符串 → 改写 text 参数（memory_add 的既有用法）。 */
          if (typeof produced === 'string') {
            if (produced.length === 0) return base;
            const textSpec = base?.properties?.text;
            if (textSpec === undefined) return base;
            return { ...base, properties: { ...base.properties, text: { ...textSpec, description: produced } } };
          }
          /* 对象 → 按参数名改写指定参数的 description（如 { formatId }）。 */
          if (typeof produced === 'object') {
            const properties = { ...(base?.properties ?? {}) };
            let changed = false;
            for (const [paramName, description] of Object.entries(produced)) {
              const spec = properties[paramName];
              if (spec === undefined || typeof description !== 'string' || description.length === 0) continue;
              properties[paramName] = { ...spec, description };
              changed = true;
            }
            return changed ? { ...base, properties } : base;
          }
          return base;
        }
      });
    }
    return registered;
  };
  /* 「可用格式清单」段生成器（v12.29）：供 memory_update 的 formatId 描述使用
     （memory_add 的 text 描述有自己的三段式分支逻辑，暂未合并以免引入回归）。
     返回 { lines, ids }：lines 是逐行说明，ids 是同批格式 id。 */
  const buildAvailableFormatsBlock = (formats) => {
    const list = Array.isArray(formats) ? formats : [];
    if (list.length === 0) return { lines: [], ids: [] };
    const nonCode = list.filter((format) => format.id !== MEMORY_FORMAT_CODE_ID);
    /* 唯一非代码格式 → 指定式（与工具描述/蒸馏同一口径）。 */
    if (nonCode.length === 1 && !list.some((format) => format.id === MEMORY_FORMAT_CODE_ID)) {
      const only = nonCode[0];
      const requiredKeys = only.definition.fields.filter((field) => field.required === true).map((field) => field.key);
      return {
        lines: [
          `本轮已确定为「${only.name}」格式，请【严格按该格式生成】正文，不要再另选格式：`,
          `格式ID：${only.id}`,
          `字段：${describeFormatDefinition(only.definition)}`,
          ...(requiredKeys.length > 0 ? [`必需字段：${requiredKeys.join('、')}（缺失会被拒绝写入）`] : []),
          `必须输出该 JSON 正文，并把 formatId 参数填为 ${only.id}；只输出上面声明的字段，禁止补充其它字段。`
        ],
        ids: [only.id]
      };
    }
    const hasCodeFormat = list.some((format) => format.id === MEMORY_FORMAT_CODE_ID);
    return {
      lines: [
        hasCodeFormat
          ? '先判断内容属于代码类还是非代码类，再按下列格式选择（只选一套，不要混用）：'
          : '从下列格式中选最贴合的一套（只选一套，不要混用）：',
        ...list.map((format) => `· ${format.builtin === true ? '（内置）' : ''}「${format.name}」（格式ID：${format.id}）：${describeFormatDefinition(format.definition)}`),
        '都不贴合时直接写纯文本正文，不要套 JSON 外壳。'
      ],
      ids: list.map((format) => format.id)
    };
  };
  disposers.push(tools.register(registerTool({
    name: 'memory_add',
    description: '新增一条长期记忆。只在用户明确要求记住、保存偏好/约束/项目事实，或当前信息明显需要长期保留时使用。用户说了「记住」「帮我记」「记一下」「保存下来」这类话时，本工具是唯一落库途径，必须调用；系统会另发一条提示列出用户要求记住的内容，按提示写入即可。默认写入当前会话启用的记忆项目，状态为 active。**同一轮最多调用一次**：一条记忆 = 一个格式实例，格式声明的字段就是全部可写空间；信息多就压缩进已声明字段或改选更贴合的格式，禁止为同一件事拆成多条记忆。',
    parameters: {
      text: { type: 'string', required: true, description: '记忆正文。写成 JSON 对象时，字段必须与所选【记忆格式】的声明完全一致：只输出该格式声明的字段（含必填的全部必需字段），禁止补充格式没有声明的字段（如 content/内容 —— 格式没声明就不许出现），也不要参照上下文里其它记忆的字段形状。字段名、类型、必需性都由该格式声明，没有任何通用必需字段。**用户身份、偏好、习惯、生活类信息若没有贴合的格式，一律直接写纯文本结论**，不要硬套 JSON 外壳。不要写源码行号或验证/测试通过段落；正文必须是结论性陈述，不能是思考过程或分析草稿。注意 tags 是独立参数，不要写进正文。' },
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
      /* 带上 agent/session：冲突裁决要用 routeForDistill(agent, session) 取模型路由。 */
      const activityContext = { ...activityUserMessageForToolCall(exec.agent?.session, exec.callId), agent: exec.agent, session: exec.agent?.session };
      /* 该调用是否由「用户显式要求记住」触发：影响目录与标签兜底（见 addToolMemory 注释）。
         判定复用同一套显式请求解析，只认用户手打原文，不认助手自己的措辞。
         字段名是 text —— 此前误写 userText 使该判定恒为 false，显式请求的目录/标签兜底从未生效。 */
      const explicit = explicitMemoryRequest(activityContext.text) !== undefined;
      return store.addToolMemory(args, sessionId, activityContext, { explicit });
    },
    presentCall: (args) => ({ card: 'generic', title: 'Memory add', kind: 'other', rawInput: args })
  }, () => {
    /* 工具 text 参数描述：把【实际可用的格式清单】注入给模型（v12.23）。
       ⚠️ 此处原为 `if (all.length <= 1) return undefined` —— 只有一套激活格式时
       退回【静态默认描述】，而静态描述里没有任何格式清单，模型因而不知道那套格式
       声明了哪些字段。该守卫在「唯一格式恰是内置代码类」的年代无害（其四键广为人知），
       但用户可停用内置代码类、自建自己的代码格式后就不成立了：实测用户停用「代码类」、
       建了只含 位置/内容 的「代码」格式，模型看不到该定义，便按库里旧记忆的惯性写成
       位置/对象/内容/踩坑 四键，导致归属失败（多余字段）→ fmt='' 无归属。
       现在改为：只要存在激活格式就注入清单；一套都没有时才走纯文本提示。 */
    const all = store.activeFormats();
    if (all.length === 0) {
      return '记忆正文。当前没有启用的记忆格式，请直接写纯文本结论，不要套 JSON 外壳。正文必须是结论性陈述，不能是思考过程或分析草稿。注意 tags 是独立参数，不要写进正文。';
    }
    /* 只有一套启用格式时【不做名称筛选】—— 无可选择，直接按它写即可。
       （formatsForToolDescription 的筛选只对内置代码类无条件保留，自建格式靠名称匹配；
       本轮对话没提到「代码」二字时会被筛空，反而让模型看不到唯一的格式。） */
    const active = all.length === 1 ? all : store.formatsForToolDescription();
    if (active.length === 0) {
      return '记忆正文。本轮没有匹配的记忆格式，请直接写纯文本结论，不要套 JSON 外壳。正文必须是结论性陈述，不能是思考过程或分析草稿。注意 tags 是独立参数，不要写进正文。';
    }
    /* ★ 生成前已确定唯一格式（v12.6）：直接指定该格式，不再让模型「先判断再选」。
       用户要求：格式应在【生成之前】确定，再用它驱动生成 —— 指定式提示比选择题式提示
       更不容易跑偏（选择题式下模型可能挑错、或干脆退回纯文本）。
       判据 = 【筛出的候选里非代码格式恰好一套】，与 turnDeterminedFormat 的留存逻辑一致：
         · 「新建一个修仙角色」→ [代码类, 角色类] → 非代码一套 → 已确定角色类 ✅
         · 「记录今天的日记」  → [代码类, 日记类] → 非代码一套 → 已确定日记类 ✅
         · 「记日记和读书笔记」→ [代码类, 日记类, 读书笔记] → 非代码两套 → 让模型选 ✅
         · 「改 memory.js」    → [代码类] → 非代码 0 套 → 让模型选 ✅
       selected 恒含代码类（保底格式），故不能以「清单只剩一套」判断。 */
    const nonCode = active.filter((format) => format.id !== MEMORY_FORMAT_CODE_ID);
    if (nonCode.length === 1 && !active.some((format) => format.id === MEMORY_FORMAT_CODE_ID)) {
      const only = nonCode[0];
      const requiredKeys = only.definition.fields.filter((field) => field.required === true).map((field) => field.key);
      return [
        `记忆正文。本轮已确定为「${only.name}」格式，请【严格按该格式生成】正文，不要再另选格式：`,
        `  · 格式ID：${only.id}`,
        `  · 字段：${describeFormatDefinition(only.definition)}`,
        ...(requiredKeys.length > 0 ? [`  · 必需字段：${requiredKeys.join('、')}（缺失会被拒绝写入）`] : []),
        `  · 必须输出该 JSON 正文，并把 formatId 参数填为 ${only.id}。`,
        '  · 只输出上面声明的字段，禁止补充其它字段。',
        /* 纠正历史误解：模型此前因「传 formatId 被拒」而学会用纯文本，那条经验已失效
           （当时是程序的多余字段误报 bug，已修复）。不写这句，模型会继续沿用纯文本。 */
        '  · 不要再写纯文本、也不要省略 formatId —— 传 JSON + formatId 现在会正常写入。',
        '不要写源码行号或验证/测试通过段落；正文必须是结论性陈述，不能是思考过程或分析草稿。注意 tags 是独立参数，不要写进正文。'
      ].join('\n');
    }
    /* 清单里没有内置代码类（用户已停用它）时，不能再写「先判断属于代码类还是非代码类」
       —— 那句引导会让模型把任意一套自定义格式（如名为「代码」的格式）当成代码类，
       实测用户停用代码类后仍出现「按代码类归属」。（v12.19） */
    const hasCodeFormat = active.some((format) => format.id === MEMORY_FORMAT_CODE_ID);
    return [
      hasCodeFormat
        ? '记忆正文。**先判断本轮内容属于代码类还是非代码类，再按下列格式选择**（只选一套，不要混用）：'
        : '记忆正文。**从下列格式中选最贴合的一套**（只选一套，不要混用）：',
      ...buildFormatPromptLines(active).map((line) => line.replace(/^- /, '  ')),
      '  · 都不贴合时直接写纯文本结论，不要套 JSON 外壳。',
      /* v12：不再点名「对象/内容」—— 它们只是代码类格式的字段名，不是通用必需字段。
         类型约束改为按字段类型表述：格式定义里 type 为 string[] 的填数组、为 string 的填字符串。
         必需性由所选格式的 required 决定（缺必需字段会被程序拒绝写入）。 */
      '  · 字段类型按所选格式的定义填：类型为 string[] 的必须是字符串数组，类型为 string 的必须是字符串；允许换行。',
      '  · 所选格式中标为必需的字段必须填写（缺失会被程序拒绝写入）。',
      '不要写源码行号或验证/测试通过段落；正文必须是结论性陈述，不能是思考过程或分析草稿。注意 tags 是独立参数，不要写进正文。'
    ].join('\n');
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
          /* 按关系边（共享文件/符号）在本次命中集内聚成的同源簇：把扁平列表
             翻译成分组结构。仅用于渲染，不影响 memories 本身的顺序与内容。 */
          clusters: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                memoryIds: { type: 'array', required: true, items: { type: 'string' } },
                commonKeys: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      kind: { type: 'string', required: true, enum: ['file', 'symbol'] },
                      label: { type: 'string', required: true },
                      count: { type: 'integer', required: true }
                    }
                  }
                },
                /* clusterMemoriesByRelation 恒带这两个统计字段。 */
                edgeCount: { type: 'integer' },
                possibleEdges: { type: 'integer' }
              }
            }
          },
          notice: { type: 'string' }
        }
      },
      render: (_args, value) => toolTextBlock(value.notice || renderClusteredMemories(value.memories, value.clusters))
    },
    execute(args, exec) {
      const guard = store.activeRecallGuard('memory_search', args, exec);
      if (guard.blocked) {
        exec.concludeTurn?.();
        return { memories: [], count: 0, clusters: [], notice: activeRecallAlreadySatisfiedText('memory_search') };
      }
      const memories = store.searchMemories(args.query, {
        ...args,
        fallbackSessionId: exec.agent?.session?.id,
        status: args.status ?? 'active',
        scope: args.scope ?? 'all'
      });
      /* 聚类只是渲染增强：关系索引重建中或失败时按空数组回落扁平渲染。 */
      const clusters = store.edgeRebuilding === true
        ? []
        : store.clusterMemoriesByRelation(memories.map((memory) => memory.id));
      return { memories, count: memories.length, clusters };
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
          /* memory 不能标 required：memoryId 无效、记忆不存在或已停用时 execute 只返回
             notice，标必填会让工具以「returned invalid output: missing required property
             "value.memory"」收场——模型看到的是工具基础设施报错，而不是语义化提示。
             与 memory_relate（origin/related 均非必填）保持同一契约风格。 */
          memory: { ...memorySchema },
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
  disposers.push(tools.register(registerTool({
    name: 'memory_update',
    description: '更新一条已有记忆的正文、标签、状态或所属记忆项目。只在用户明确要求修正/更新记忆，或需要消除旧记忆冲突时使用。',
    parameters: {
      memoryId: { type: 'string', required: true, description: '要更新的记忆 id。' },
      text: { type: 'string', description: '新的记忆正文；不提供则不修改正文。写成 JSON 对象时，字段必须与所属【记忆格式】的声明完全一致：只输出该格式声明的字段（含全部必需字段），禁止补充格式没有声明的字段，也不要参照其它记忆的字段形状。字段名、类型、必需性都由格式声明，没有通用必需字段。不要写源码行号或验证/测试通过段落。' },
      pinned: { type: 'boolean', description: '固定召回：设为 true 后，只要该记忆所属项目在会话中启用，就保证被注入（与其他记忆一同参与相关性排序；排序未入选时在四段筛选之后额外补入，因此注入总量可能超过召回条数设置）；false 取消固定。不提供则保持不变。' },
      ...commonMemoryParams,
      tags: { type: 'array', items: { type: 'string' }, description: '替换这条记忆的完整标签列表；不传则保持现有标签。尽量原样保留已有标签；新增时最多增加 1 个描述性自定义标签，优先用精准的具体事件/对象/名称/场景，写入端会按当前项目精确复用或保守归并名称包含项，不猜测纯语义近义词。稳定标签按原预设体系映射，不要改写已有预设标签。' },
      /* 放在 commonMemoryParams 之后：覆盖新增参数说明，明确标签/事实时间/格式归属的保持与覆盖语义。 */
      eventTime: { type: 'string', description: '事件发生时间：记忆所述事实的发生/生效时刻。格式 YYYY-MM-DD，需要精确到分钟时用「YYYY-MM-DD HH:MM」。**不提供则保持不变**；传空字符串 "" 清除该字段（回到未声明）；传日期则覆盖。仅在该时间确实不同于记录时间时才值得设置。' },
      validUntil: { type: 'string', description: '事件失效时间：记忆所述事实预计不再成立的时刻。格式 YYYY-MM-DD（按当日结束计），需要精确到分钟时用「YYYY-MM-DD HH:MM」。**不提供则保持不变**；传空字符串 "" 清除；传日期则覆盖。到点后该记忆在召回里降权并在注入时标注「已过期」。' },
      formatId: { type: 'string', description: '记忆格式归属 id。**不提供则保持不变**；传空字符串 "" 清除归属（回到无归属）；传 id 则覆盖（正文并按新格式的顺序重排；必需字段缺失会被拒绝）。' }
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
  }, () => {
    /* ★ memory_update 的 formatId 描述也要注入【实际可用的格式清单】（v12.29）。
       此前它用 defineTool 静态注册，描述里却写着「字段必须与所属记忆格式的声明完全一致」，
       模型看不到任何格式定义 —— 改正文时只能凭上下文猜字段（与 memory_add 的旧毛病同源）。
       保持三态语义（不提供=保持 / ''=清除 / id=覆盖）不变，只把「清单」补上。 */
    const all = store.activeFormats();
    const base = '记忆格式归属 id。**不提供则保持不变**；传空字符串 "" 清除归属（回到无归属）；传 id 则覆盖（正文并按新格式的顺序重排；必需字段缺失会被拒绝）。';
    if (all.length === 0) {
      return { formatId: `${base}当前没有启用的记忆格式，请不要传 formatId。` };
    }
    const block = buildAvailableFormatsBlock(all.length === 1 ? all : store.formatsForToolDescription());
    if (block.lines.length === 0) {
      return { formatId: `${base}本轮没有匹配的记忆格式，请不要传 formatId。` };
    }
    return {
      formatId: [
        base,
        ...block.lines.map((line) => `· ${line}`),
        `可用的格式ID：${block.ids.join('、')}（原样照抄，不要编造、不要写格式名称）。`
      ].join('\n')
    };
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
  disposers.push(tools.register(defineTool({
    name: 'memory_relate',
    description: '查询记忆之间的关系。适合回答「改这里会影响什么」「这个问题的解法在哪」「这些记忆为什么相关」。从一条记忆出发，沿共享的文件路径/符号找到结构上关联的记忆。与 memory_search 的区别：search 找「内容词面相关」的（可能含词形巧合），relate 找「结构上真正关联」的（共享具体文件或符号）。入参给 memoryId 或 query 二选一。',
    parameters: {
      memoryId: { type: 'string', description: '起点记忆 id（来自注入条目或 memory_search 结果）。与 query 二选一。' },
      query: { type: 'string', description: '用查询文本自动定位起点（内部先走一次记忆检索取最相关的一条作为起点）。与 memoryId 二选一。' },
      hops: { type: 'integer', description: `跳数 1-${MEMORY_RELATE_MAX_HOPS}，默认 1。2 跳会引入间接关联，仅在前 1 跳结果不足时使用。` },
      kinds: {
        type: 'array',
        items: { type: 'string', enum: [...MEMORY_EDGE_ALL_KINDS] },
        description: '限定关系类型，默认 same_file + same_symbol（同标签噪声大，默认不含）。'
      },
      limit: { type: 'integer', description: `最多返回条数，默认 ${MEMORY_RELATE_DEFAULT_ITEMS}，最大 ${MEMORY_RELATE_MAX_ITEMS}。` }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          origin: memoryFullListSchema,
          related: memoryRelatedListSchema,
          relations: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                from: { type: 'string', required: true },
                to: { type: 'string', required: true },
                kind: { type: 'string', required: true },
                hop: { type: 'integer', required: true }
              }
            }
          },
          count: { type: 'integer', required: true },
          notice: { type: 'string' }
        }
      },
      render: (_args, value) => toolTextBlock(value.notice || renderRelationResult(value))
    },
    execute(args) {
      /* 后台重建期间明确降级：不返回可能不一致的结果。 */
      if (store.edgeRebuilding === true) {
        return { origin: [], related: [], relations: [], count: 0, notice: '关系索引正在后台重建中，请稍后重试（或改用 memory_search）。' };
      }
      const originId = store.resolveRelateOrigin(args);
      if (!originId) {
        return { origin: [], related: [], relations: [], count: 0, notice: '未找到起点记忆：请提供 memoryId，或提供能命中已存记忆的 query。' };
      }
      const result = store.relatedMemories(originId, { hops: args.hops, kinds: args.kinds, limit: args.limit });
      if (result.related.length === 0) {
        return { ...result, notice: `记忆 ${originId} 没有结构关联的其他记忆（它可能是纯文本记忆，或关联项已被删除）。` };
      }
      return result;
    },
    presentCall: (args) => ({ card: 'generic', title: 'Memory relate', kind: 'other', rawInput: args })
  })));
  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}

/* 内置记忆使用说明（常驻系统提示，无需用户开启全局提示词）。
   重点覆盖用户显式「记住」的请求：插件会另行追加一条提示消息，但模型跳过提示直接
   调 memory_add 也必须落库，所以规则同时写在这里。
   末条覆盖关系检索：memory_relate 是纯按需工具（不进召回管线、不占注入预算），
   模型只能从工具列表知道它存在，故在此补一句「何时该用」——这是它唯一的常驻引导位。 */
const MEMORY_GUIDE_SECTION = 'dsh-session-kit:memory-guide';
const MEMORY_GUIDE_ORDER = 20;
const MEMORY_GUIDE_TEXT = [
  '## 长期记忆（dsh-session-kit）',
  '- 用户说「记住」「帮我记」「记一下」「保存下来」「别忘了」这类话时，必须调用 memory_add 工具把要记的内容写入长期记忆；系统会同时追加一条提示消息列出用户要求记住的内容，按它写入即可。用户要求「每次都带上/固定召回」时把 pinned 设为 true。',
  '- 写记忆时正文要是结论性陈述（不要复述"用户要求记住"这类过程语气）。用户身份/偏好/习惯/生活类内容**直接写纯文本**；只有代码/项目类记忆才用 {"位置":[...],"对象":[...],"内容":"...","踩坑":"..."} 的 JSON（「位置」「对象」为空时不要套 JSON）。并按两段式填 tags：描述性自定义标签最多 1 个，优先用精准的具体事件/对象/名称/场景且尽量复用当前项目已有标签，再映射到稳定标签（用户偏好/用户画像/项目画像/项目架构/项目约束/模块路径/模块约束/项目场景/接口摘要/接口约束/项目摘要/模块摘要/排查记录/决策记录）。',
  '- 用户指定了记忆项目就传 directoryName；没指定就不要猜，留空即可（默认项目的记忆对所有会话可见）。',
  '- 用户明确要求修正/更新记忆时用 memory_update，要求不再使用某条记忆时用 memory_stop；不要用 memory_add 堆叠同义新记忆。',
  '- 需要了解某条记忆的前后关联、改动影响面，或用户问「这个问题的解法在哪」「这些为什么相关」时，用 memory_relate（传 memoryId 或 query）沿共享的文件路径/符号找结构关联。它与 memory_search 互补：search 按内容词面匹配（可能有词形巧合），relate 按共享的文件或符号精确匹配；需要「真的相关」而非「词像」时用 relate。'
].join('\n');

/* 内置段落只在宿主提供 systemPrompt 服务时挂载；失败不影响记忆功能本体。 */
function installMemoryGuideSection(ctx) {
  if (typeof ctx.systemPrompt?.section !== 'function') return;
  try {
    ctx.systemPrompt.section(Object.freeze({ name: MEMORY_GUIDE_SECTION, order: MEMORY_GUIDE_ORDER, text: MEMORY_GUIDE_TEXT }));
  } catch (error) {
    ctx.logger?.warn?.(`[${PLUGIN_NAME}] memory guide section install failed:`, error);
  }
}

export async function installMemoryFeature(ctx, options = {}) {
  const store = new MemoryStore(ctx, options);
  const handle = (path, handler) => ctx.webServer.register({ kind: 'exact', path, handler });
  ctx.effect(() => handle(MEMORY_ROUTE, (req, res) => store.handle(req, res)), `${PLUGIN_NAME}: memory HTTP route`);
  ctx.effect(() => handle(MEMORY_DISTILL_ROUTE, (req, res) => store.handle(req, res)), `${PLUGIN_NAME}: memory distill HTTP route`);
  ctx.effect(() => handle('/dsh-session-kit/memory/activity', (req, res) => store.handleActivity(req, res)), `${PLUGIN_NAME}: memory activity route`);
  const tools = ctx.get?.('tools', false);
  if (typeof tools?.register === 'function') ctx.effect(() => registerMemoryTools(ctx, store, tools), `${PLUGIN_NAME}: memory tools`);
  installMemoryGuideSection(ctx);
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
      /* 刷新「当前活跃轮次」引用：仅供 memory_add 的工具参数描述按本轮内容筛选格式。
         必须在 next() 之前设置 —— 工具 schema 可能在下一步就投影。 */
      store.setActiveTurnRef(agent, turn);
      /* ★ 确定并留存「本轮生成前已确定的格式」（v12.6.1）：独立于工具描述投影，
         每步都算一次 —— 转录在此必然可得，不受 formatsForToolDescription 的
         提前 return 影响（那会让描述显示「指定式」而写入路径拿不到格式）。 */
      store.determineTurnFormat(agent, turn);
      const decision = await next();
      /* 显式记忆请求的提示先于召回注入追加到轮尾（引导模型本步调用 memory_add），
         并返回本步的用户原话给紧随其后的 injectRecall 做同一次判定。 */
      const requested = appendExplicitMemoryRequest(store, agent, messages, decision);
      return store.injectRecall(agent, messages, decision, signal, turn, requested);
    }, { prepend: true });
  }, `${PLUGIN_NAME}: memory runtime`);
  return store;
}
