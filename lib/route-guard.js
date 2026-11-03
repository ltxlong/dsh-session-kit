/**
 * 权鉴方案：插件 HTTP 路由的统一入口栅栏（dsh-session-kit）。
 *
 * 背景：本插件用 `ctx.webServer.register({ kind: 'exact' })` 自注册路由，
 * 而宿主 `dsh-host-webserver` 明确「不提供服务器级认证或来源策略」，鉴权
 * 只挂在 `dsh-client-connection` 自己注册的 `/api` 前缀路由上。因此这些
 * 第三方 exact 路由既不过 BrowserAuth、也不过 Host/Origin 栅栏：
 *   - 任意本机进程裸请求可直写（memory 库、会话删除、全局提示词等）；
 *   - 浏览器侧 DNS rebinding / 跨站简单请求（text/plain）同样可写。
 *
 * 本模块把「证明请求来自 owner」这一步收敛成唯一实现，被 index.js /
 * memory.js / task.js 三个注册点复用。语义对齐 dsh-session-manager
 * 0.7.5 + 其后收紧版（b5f1887）：
 *   - 无 connection 服务或 `admit` 方法缺失 → 503（fail-closed）
 *   - `admit(req)` 抛错 → 403
 *   - `admit(req)` 返回非对象 → 401
 *   - 返回 `{ rejection }` → 透传 401 / 403
 *   - `admission.peer` 缺失或非对象 → 401
 *   - `peer.principal.kind !== "owner"` → 403（缺省即拒绝，绝不缺省放行）
 *
 * 三条硬约束：
 *   1. 判定必须在读取 body 之前完成 —— 拒绝请求不该消耗请求体。
 *   2. 用软取 `ctx.get('connection', false)`，不写进 inject：本插件也可能
 *      被装在无 Web 载体的组合里，硬注入会让插件整体不激活；缺失时回
 *      503 比「静默不加载」更容易诊断。
 *   3. 本模块零依赖、不 import 任何宿主包，避免与 index.js 形成循环依赖。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ⚠️ 新增 HTTP 路由时必读（这是唯一的正确做法）
 * ═══════════════════════════════════════════════════════════════════════
 * 本插件所有路由都是 `ctx.webServer.register({ kind: 'exact' })` 自注册的，
 * 宿主不会给它们做任何鉴权。因此新增路由**绝不允许**直接调用
 * `ctx.webServer.register(...)`，必须走所在模块已有的包装器：
 *
 *   · lib/index.js   —— 用同文件内的 `handle(path, fn, options)`
 *   · lib/memory.js  —— 用 installMemoryFeature 内的 `handle(path, handler, routeOptions)`
 *   · lib/task.js    —— 用与 tasks 路由相同的 `fenceRoute({...}) ? taskHandler(...) : undefined` 包装
 *
 * 正确示例（index.js / memory.js）：
 *     handle('/dsh-session-kit/xxx', async (req, res) => { ... });
 *
 * 正确示例（task.js）：
 *     handler: (req, res) => (fenceRoute({ ctx, req, res, respond }) ? fn(req, res) : undefined)
 *
 * 包装器已替你完成两件事，不需要重复做：
 *     1. 鉴权（owner-only + fail-closed）；2. POST 强制 application/json。
 *
 * 例外：将来若有二进制上传或流式上行路由，传 `{ jsonBody: false }`
 * （index.js / memory.js）或 `fenceRoute({ ..., jsonBody: false })`（task.js）
 * 显式豁免内容类型门禁 —— 鉴权仍然保留，不可豁免。
 *
 * 自检方法（新增路由后手工跑一遍，确认注册点仍然只有 3 处）：
 *     grep -n "ctx.webServer.register(" lib/index.js lib/memory.js lib/task.js
 * 期望输出恰好 3 行。出现第 4 行就说明有新路由绕过了包装层。
 * （不要用 lib/*.js 通配：本文件的说明文字里也含有该字符串，会多出几行。）
 * ═══════════════════════════════════════════════════════════════════════
 */

const PLUGIN_LABEL = 'dsh-session-kit';

/** 是否为 JSON 内容类型（允许 `application/json; charset=utf-8` 这类带参数写法）。 */
export function isJsonContentType(value) {
  return typeof value === 'string' && value.split(';', 1)[0].trim().toLowerCase() === 'application/json';
}

/**
 * 判断本次请求是否有权进入 handler。
 *
 * @param {object} ctx - Cordis 插件上下文。
 * @param {object} req - node:http IncomingMessage。
 * @returns {{ok: true} | {ok: false, status: number, code: string, message: string}}
 */
export function checkRouteAccess(ctx, req) {
  let connection;
  try {
    connection = ctx.get?.('connection', false);
  } catch {
    connection = undefined;
  }
  if (connection === undefined || connection === null || typeof connection.admit !== 'function') {
    return {
      ok: false,
      status: 503,
      code: 'auth-unavailable',
      message: 'DSH 认证服务未就绪或不可用，为保护数据安全已拒绝请求'
    };
  }

  let admission;
  try {
    admission = connection.admit(req);
  } catch (error) {
    ctx.logger?.warn?.(`[${PLUGIN_LABEL}] route auth threw:`, error);
    return { ok: false, status: 403, code: 'auth-error', message: '认证检查失败' };
  }

  if (admission === undefined || admission === null || typeof admission !== 'object') {
    return { ok: false, status: 401, code: 'unauthorized', message: '需要有效的 DSH 会话凭证' };
  }

  if ('rejection' in admission) {
    const status = typeof admission.rejection === 'number' ? admission.rejection : 401;
    return {
      ok: false,
      status,
      code: status === 403 ? 'forbidden' : 'unauthorized',
      message: status === 403 ? '请求未通过 DSH 信任检查或跨站防护' : '需要有效的 DSH 会话凭证'
    };
  }

  const peer = admission.peer;
  if (peer === undefined || peer === null || typeof peer !== 'object') {
    return { ok: false, status: 401, code: 'unauthorized', message: '缺少有效 Peer 凭证' };
  }

  /* 严格相等：缺省 kind 也拒绝。曾见「kind 存在且非 owner 才拒绝」的写法，
     那等于把缺失字段当成 owner，是 fail-open。 */
  if (peer.principal?.kind !== 'owner') {
    return { ok: false, status: 403, code: 'forbidden', message: '该操作需要 owner 权限' };
  }

  return { ok: true };
}

/**
 * 路由入口栅栏：鉴权 + 仅 POST 强制 JSON，两件事一次性做完。
 * 通过返回 true，调用方继续执行原 handler；不通过已在 res 上写完响应。
 *
 * @param {object} options
 * @param {object} options.ctx - Cordis 插件上下文。
 * @param {object} options.req - node:http IncomingMessage。
 * @param {object} options.res - node:http ServerResponse。
 * @param {Function} options.respond - 该模块自己的 respond(res, status, payload)。
 * @param {boolean} [options.jsonBody=true] - POST 是否强制 application/json；
 *        将来若有二进制/流式上行路由，须显式传 false 豁免。
 * @returns {boolean} true=放行
 */
export function fenceRoute({ ctx, req, res, respond, jsonBody = true }) {
  const verdict = checkRouteAccess(ctx, req);
  if (verdict.ok !== true) {
    respond(res, verdict.status, { ok: false, error: { code: verdict.code, message: verdict.message } });
    return false;
  }

  /* 只在 POST 上判内容类型：GET/HEAD 无体，OPTIONS 与 405 语义由 handler 自己决定，
     不要在这里抢答，否则会改变既有端点的错误码。 */
  if (jsonBody === true && req.method === 'POST' && isJsonContentType(req.headers?.['content-type']) !== true) {
    respond(res, 415, { ok: false, error: { code: 'invalid-request', message: 'application/json required' } });
    return false;
  }

  return true;
}
