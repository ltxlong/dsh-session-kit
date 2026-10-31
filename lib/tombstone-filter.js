/**
 * `llm/stream` 请求过滤器：在请求进入任何 provider 适配器之前剔除「空墓碑」。
 *
 * 背景：轮次删除与记忆剔除都以 user/message 替换事件（墓碑）遮蔽被删内容。
 * 墓碑本身不该进入模型上下文——它只是表面占位节点 + 插件私有台账凭据。
 * 历史上这个「不进上下文」的行为依赖各个适配器/协议库各自丢弃空 content：
 *   - `llm-deepseek`（dsh 适配器）：content.length === 0 → continue
 *   - pi-ai 三条协议：anthropic 过滤最严；openai-completions 数组跳过；
 *     openai-responses 是唯一漏口（字符串 "" → {type:'input_text',text:''} 仍发送）
 * 严格网关会对这种空内容做二次校验并返回 400（content cannot be empty）。
 * 因此在插件层主动剔除，才能不依赖下游实现细节、对所有渠道生效。
 *
 * 识别口径：只看 `source.kind`，不看 content 形态。
 * 这让 `content: []` 与 `content: [{type:'text',text:'[轮次已删除]'}]` 两种
 * 墓碑在模型侧完全等价——content 不再承担「被识别」的职责。
 */

/** 轮次删除墓碑的生产者来源。必须与 index.js 的 TURNS_DEL_PROVIDER 一致。 */
export const TOMBSTONE_SOURCE_TURNS_DEL = 'dsh-session-kit-turns-del';

 /** 记忆剔除墓碑的生产者来源。必须与 memory.js 的 MEMORY_EJECT_PROVIDER 一致。 */
export const TOMBSTONE_SOURCE_MEMORY_EJECT = 'dsh-session-kit-memory-eject';

 /* 记忆剔除墓碑分两种语义，判据是来源上的 ejectReason 字段：
   - 'disabled'：该记忆被用户停用。此时墓碑正文携带一句可见提示，**必须放行**，
     让模型知道「这条记忆已失效」，避免它继续沿用被停用的约定（如语气、
     称呼、工作流偏好）。这类墓碑不参与剔除。
   - 'stale' / 缺省：该记忆仍启用，只是本轮没进 top-k。下一轮它可能又被召回，
     对模型声明「已停用」会造成自相矛盾的指令，因此保持静默（零宽空格 + 剔除）。 */
 export const MEMORY_EJECT_REASON_DISABLED = 'disabled';

 const TOMBSTONE_SOURCE_KINDS = new Set([TOMBSTONE_SOURCE_TURNS_DEL, TOMBSTONE_SOURCE_MEMORY_EJECT]);

 /**
  * 判定一条消息是否应从模型上下文中剔除。
  *
  * 只认来源标识，不认 content 内容。例外：记忆剔除墓碑若标注 ejectReason='disabled'，
  * 其正文是有意保留给模型看的提示，不剔除。
  *
  * @param message - 一条已链式的模型消息（role/content/source）。
  * @returns 该消息是否应被剔除。
  */
 export function isTombstoneMessage(message) {
   const source = message?.source;
   const kind = source?.kind;
   if (typeof kind !== 'string' || !TOMBSTONE_SOURCE_KINDS.has(kind)) return false;
   if (kind === TOMBSTONE_SOURCE_MEMORY_EJECT && source?.ejectReason === MEMORY_EJECT_REASON_DISABLED) return false;
   return true;
 }

/**
 * 从请求消息数组中剔除墓碑，返回新的请求选项。
 *
 * `options` 已被 agent-loop 的 `markAgentLoopRequest(Object.freeze({...}))` 冻结，
 * 因此有变化时必须构造新对象，不能原地修改。
 * 无变化时返回原对象：保持对象身份稳定，零额外分配。
 *
 * @param options - `llm/stream` 收到的完整请求。
 * @returns 剔除墓碑后的请求（必要时为新对象）。
 */
export function filterTombstonesFromRequest(options) {
  const messages = options?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return options;
  const kept = messages.filter((message) => !isTombstoneMessage(message));
  if (kept.length === messages.length) return options;
  return { ...options, messages: kept };
}
