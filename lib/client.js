window.__ModuleLoader__.load({
  id: 'dsh-session-kit',
  factory: (require) => {
    const module = { exports: {} };
    const react = require('react');
    const reactDom = require('react-dom');
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
    const exports = module.exports;

    const OPEN_ROUTE = '/dsh-session-kit/open-folder';
    const DELETE_ROUTE = '/dsh-session-kit/delete';
    const ARCHIVE_LIST_ROUTE = '/dsh-session-kit/archive/list';
    const ARCHIVE_RESTORE_ROUTE = '/dsh-session-kit/archive/restore';
    const ARCHIVE_DELETE_ROUTE = '/dsh-session-kit/archive/delete';
    const ARCHIVE_PREVIEW_ROUTE = '/dsh-session-kit/archive/preview';
    const TOOL_STATS_ROUTE = '/dsh-session-kit/tool-stats';
    const COMPACTION_CONFIG_ROUTE = '/dsh-session-kit/compaction-config';
    const REPAIR_SESSION_ROUTE = '/dsh-session-kit/repair-session';
    /* 桌面壳的「重新加载界面」通道（与开发者菜单按钮同一路由）。
       路由要求空 body 与同源 Origin——浏览器 fetch 默认满足。 */
    const DESKTOP_RELOAD_ROUTE = '/api/desktop/developer/reload';
    const GLOBAL_PROMPT_ROUTE = '/dsh-session-kit/global-prompt';
    const MEMORY_ROUTE = '/dsh-session-kit/memory';
    const MEMORY_STORAGE_ROUTE = '/dsh-session-kit/memory-storage';
    const TASK_ROUTE = '/dsh-session-kit/tasks';
    const SIDEBAR_ENTRIES_ROUTE = '/dsh-session-kit/sidebar-entries';
    const TASK_AUTO_INJECT_ROUTE = '/dsh-session-kit/task-auto-inject';
    /* 进行中活动"过期刷新"：条目已耗时超过 ACTIVITY_STUCK_REFRESH_MS 时拉一次 progress
       视图（与服务端 ACTIVITY_STUCK_TIMEOUT_MS 同为 6 分钟）。拉取动作本身会触发服务端
       activitySnapshot 前置的 reapStuckActivities，而服务端处理时刻必然不早于前端判定
       时刻，故该条目在服务端必已过兜底线、随本次响应一起消失——一次请求解决，无需
       复查循环与定时器。条目未超时零请求。 */
    const ACTIVITY_STUCK_REFRESH_MS = 6 * 60 * 1000;
    const DEFAULT_SIDEBAR_ENTRIES = Object.freeze({ memoryVisible: true, archiveVisible: true, taskVisible: true, leftNavEnabled: true, rightNavEnabled: true, memoryTabVisible: true });
    let sidebarEntriesValue = DEFAULT_SIDEBAR_ENTRIES;
    const sidebarEntriesSubscribers = new Set();
    let sidebarEntriesNotifyQueued = false;
    function setSidebarEntriesValue(value) {
      sidebarEntriesValue = Object.freeze({
        memoryVisible: value?.memoryVisible !== false,
        archiveVisible: value?.archiveVisible !== false,
        taskVisible: value?.taskVisible !== false,
        leftNavEnabled: value?.leftNavEnabled !== false,
        rightNavEnabled: value?.rightNavEnabled !== false,
        memoryTabVisible: value?.memoryTabVisible !== false
      });
      /* 左右导航开关同步到根节点：CSS 据此决定是否隐藏 DSH 原生轮次导航轨
         （session-kit 右导航开启时由它替代原生轨，关闭时恢复原生轨）。 */
      const navRoot = document.documentElement;
      navRoot.dataset.dshSessionKitLeftNav = sidebarEntriesValue.leftNavEnabled ? 'on' : 'off';
      navRoot.dataset.dshSessionKitRightNav = sidebarEntriesValue.rightNavEnabled ? 'on' : 'off';
      if (sidebarEntriesNotifyQueued) return;
      sidebarEntriesNotifyQueued = true;
      queueMicrotask(() => {
        sidebarEntriesNotifyQueued = false;
        for (const subscriber of [...sidebarEntriesSubscribers]) subscriber();
      });
    }
    function useSidebarEntries() {
      return react.useSyncExternalStore(
        (subscriber) => { sidebarEntriesSubscribers.add(subscriber); return () => sidebarEntriesSubscribers.delete(subscriber); },
        () => sidebarEntriesValue,
        () => DEFAULT_SIDEBAR_ENTRIES
      );
    }
    const GLOBAL_PROMPT_MAX_TEXT_LENGTH = 200000;
    const MEMORY_PAGE_SIZE = 30;
    /* 「标签」tab 自定义标签的分页大小。默认（预设）标签恒为置顶的固定 16 个，
       不参与分页计数——分页只切「非默认标签」那一段。 */
    const MEMORY_TAG_PAGE_SIZE = 50;
    const MEMORY_MIN_TEXT_LENGTH = 6;
    const ARCHIVE_PREVIEW_LIMIT = 30;
    const ARCHIVE_PREVIEW_TOC_PAGE_SIZE = 10;
    const ARCHIVE_PREVIEW_MESSAGE_PAGE_SIZE = 30;
    const ARCHIVE_PREVIEW_SEARCH_DEBOUNCE_MS = 350;
    const ARCHIVE_LIST_PAGE_SIZE = 50;
    const TASK_LIST_PAGE_SIZE = 10;
    /* 「全部」页签状态占比圆环：扇区顺序与配色（与状态 pill 同源变量）。 */
    const TASK_STATUS_CHART_ORDER = ['not_started', 'active', 'paused', 'completed', 'abandoned'];
    const TASK_STATUS_CHART_COLORS = {
      not_started: 'var(--dsw-alias-label-secondary)',
      active: 'var(--dsw-alias-state-business-primary)',
      paused: 'var(--dsw-alias-state-warning-primary, #d89614)',
      completed: 'var(--dsw-alias-state-success-primary, #12a150)',
      abandoned: 'var(--dsw-alias-state-error-primary)'
    };
    /* 提取任务失败原因 → 文案键。与服务端 extractTaskFromSession 返回的 reason 一一对应。 */
    const TASK_EXTRACT_REASON_KEYS = {
      'no-session': 'taskExtractReasonNoSession',
      'no-events': 'taskExtractReasonNoEvents',
      'no-todos': 'taskExtractReasonNoTodos',
      'empty-todos': 'taskExtractReasonEmptyTodos'
    };
    /* 任务附加信息（summary）输入上限，与服务端 TASK_SUMMARY_MAX_LENGTH 保持一致。 */
    const TASK_SUMMARY_MAX_LENGTH = 5000;
    /* 新建任务时可录入的子任务行数上限，与服务端 MANUAL_TASK_ITEM_LIMIT 保持一致。 */
    const TASK_ITEM_INPUT_LIMIT = 50;
    /* 详情弹窗操作明细的单次展示上限，超出时给出截断提示。 */
    const TASK_DETAIL_OP_LIMIT = 100;
    const TOPIC_NAV_AUTO_LOAD_OLDER_MAX_ROUNDS = 3;
    const TOPIC_NAV_AUTO_LOAD_OLDER_DELAY_MS = 120;
    const COMPACTION_DEFAULT_RATIO = 0.8;
    const COMPACTION_DEFAULT_RETAIN_RATIO = 0.16;
    const COMPACTION_DEFAULT_MAX_TOKENS = 8192;
    const COMPACTION_DEFAULT_RETRIES = 1;
    const COMPACTION_MIN_PERCENT = 60;
    const COMPACTION_MAX_PERCENT = 90;
    const COMPACTION_MIN_RETAIN_PERCENT = 1;
    const COMPACTION_MAX_RETAIN_PERCENT = 30;
    const COMPACTION_MIN_MAX_TOKENS = 256;
    const COMPACTION_MAX_MAX_TOKENS = 65536;
    const COMPACTION_MIN_RETRIES = 0;
    const COMPACTION_MAX_RETRIES = 10;
    const TURNS_DEL_PATH = '/dsh-turns-del';
    const TURNS_DEL_RANGES_PATH = '/dsh-turns-del/ranges';
    const TURNS_DEL_TURN_PATH = '/dsh-turns-del/turn';
    const REGENERATE_PATH = '/dsh-turns-del-regenerate';
    const REGENERATE_TURN_PATH = '/dsh-turns-del-regenerate/turn';
    const EDIT_REGENERATE_TURN_PATH = '/dsh-turns-del-edit-regenerate/turn';
    const TURNS_DEL_PROVIDER = 'dsh-session-kit-turns-del';
    const NS = 'dsh-session-kit';
    const TURNS_DEL_NS = 'dsh-turns-del';
    /* 「记忆」视图的专用文案命名空间。 */
    const SESSION_MEMORY_NS = 'dsh-session-kit-session-memory';
    const inject = ['slots', 'locale', 'uiConversation', 'sessions', 'workspaces', 'remote', 'remote.session', 'modelDirectories'];

    const zh = {
      manage: '会话管理',
      folder: '打开目录',
      export: '导出会话',
      archive: '打开归档',
      archiveManage: '归档',
      globalPrompt: '全局提示',
      globalPromptTitle: '全局提示词设置',
      globalPromptDesc: '启用后，dsh-session-kit 会通过 systemPrompt.section 在运行时注入这段系统提示词。\n不修改官方代码或配置文件。\n停用或卸载插件后，这段提示词不会继续生效。',
      globalPromptEnable: '启用',
      globalPromptText: '全局提示词',
      globalPromptPlaceholder: '例如：除非用户明确要求其他语言，否则始终使用中文回答。',
      globalPromptSave: '保存',
      globalPromptSaved: '已保存',
      globalPromptSaving: '保存中…',
      globalPromptSaveSuccess: '全局提示已保存',
      globalPromptFailed: '保存全局提示失败',
      globalPromptServiceUnavailable: '全局提示服务未加载，请重启 dsh web 后刷新页面。',
      globalPromptTooLarge: '全局提示词过长，请缩短后再保存。',
      memory: '记忆',
      memoryHideSidebarEntry: '隐藏侧边栏记忆入口',
      memoryShowSidebarEntry: '显示侧边栏记忆入口',
      archiveHideSidebarEntry: '隐藏侧边栏归档入口',
      archiveShowSidebarEntry: '显示侧边栏归档入口',
      memoryTitle: '记忆管理',
      taskManage: '任务',
      taskMenuTitle: '任务管理',
      taskTitle: '任务管理',
      taskHideSidebarEntry: '隐藏侧边栏任务入口',
      taskShowSidebarEntry: '显示侧边栏任务入口',
      taskEntryToggleHint: '只有「进行中」的任务才参与自动注入',
      taskDesc: '任务档案记录任务全过程的文件读写、操作与踩坑，跨会话与上下文压缩后依然完整。',
      taskSearchPlaceholder: '搜索任务、项目或关联会话名称/ID',
      taskFilterNotStarted: '未开始',
      taskFilterActive: '进行中',
      taskFilterPaused: '已暂停',
      taskFilterCompleted: '已完成',
      taskFilterAbandoned: '已放弃',
      taskFilterAll: '全部',
      taskPagination: '第 {page} / {pages} 页，共 {total} 条',
      taskPrevPage: '上一页',
      taskNextPage: '下一页',
      taskEmpty: '暂无任务档案。执行含任务列表（todo）的会话后会自动记录。',
      taskLoadFailed: '任务档案加载失败',
      taskItems: '子任务',
      taskItemsLabel: '初始子任务',
      taskItemPlaceholder: '子任务内容',
      taskItemAdd: '添加子任务',
      taskItemRemove: '删除该行',
      taskCreateOkWithItems: '已新增任务（{count} 个子任务）',
      taskCreateStatusTip1: '新建的任务，默认状态为「未开始」，不会参与自动注入。',
      taskCreateStatusTip2: '只有状态为「进行中」的任务才会参与自动注入。',
      taskOperations: '操作明细',
      taskPitfalls: '踩坑',
      taskContextMarks: '上下文变更',
      taskInject: '注入当前会话',
      taskInjectHint: '把任务完整档案注入当前会话上下文',
      taskInjectOk: '已注入任务档案（约 {chars} 字符）',
      taskInjectNoSession: '请先打开一个会话',
      taskInjectConfirm: '确定要将任务「{name}」的完整档案注入当前会话吗？\n档案将作为一条用户消息加入当前会话上下文。',
      taskProgress: '进度',
      taskProject: '项目',
      taskSessions: '涉及会话',
      taskSessionsEmpty: '暂无涉及会话',
      taskSessionCopyId: '点击复制会话 ID',
      taskSessionIdCopied: '已复制会话 ID',
      taskSessionIdCopyFailed: '复制会话 ID 失败',
      taskMemoryDirs: '记忆项目',
      taskCreatedAt: '创建时间',
      taskUpdatedAt: '更新时间',
      taskCwd: '工作目录',
      taskSummary: '附加信息',
      taskObjects: '对象',
      taskItemFiles: '读 {read} / 写 {written}',
      taskTurnRange: '轮次 {from}-{to}',
      taskSessionTurns: '轮次 {from}-{to}',
      taskContextKey: '字段',
      taskTruncatedHint: '仅显示前 {shown} 条，共 {total} 条',
      taskStatusNotStarted: '未开始',
      taskStatusActive: '进行中',
      taskStatusPaused: '已暂停',
      taskStatusCompleted: '已完成',
      taskStatusAbandoned: '已放弃',
      taskItemPending: '待处理',
      taskItemInProgress: '进行中',
      taskItemCompleted: '已完成',
      taskItemBlocked: '受阻',
      taskItemAborted: '已中断',
      taskBack: '返回列表',
      taskDetailTitle: '任务详情',
      taskEdit: '编辑',
      taskDelete: '删除',
      taskEditTitle: '编辑任务',
      taskNameLabel: '任务名称',
      taskStatusField: '状态',
      taskSave: '保存',
      taskCancel: '取消',
      taskAdd: '新增任务',
      taskAddTitle: '新增任务',
      taskExtract: '提取当前会话任务',
      taskExtractHint: '从当前会话的 todo 列表提取任务档案；已有档案时不会重复写入',
      taskExtractOk: '已提取任务「{name}」（{count} 个子任务）',
      taskExtractExists: '该会话已有任务档案「{name}」，未重复写入',
      taskExtractFailed: '提取任务失败',
      taskAutoInject: '自动注入未完成任务',
      taskAutoInjectHint: '开启后，每轮开始前会自动匹配本会话的未完成任务并向模型提示；关闭后不再自动注入',
      taskAutoInjectOn: '已开启自动注入未完成任务',
      taskAutoInjectOff: '已关闭自动注入未完成任务',
      taskAutoInjectFailed: '切换自动注入失败',
      taskExtractReasonNoSession: '提取失败：未指定会话，请先打开一个会话',
      taskExtractReasonNoEvents: '提取失败：读不到该会话的事件流（会话可能未落盘或已被归档）',
      taskExtractReasonNoTodos: '提取失败：当前会话没有 todo 列表，任务档案的子任务来源于 todo',
      taskExtractReasonEmptyTodos: '提取失败：该会话的 todo 列表为空，没有可提取的子任务',
      taskSummaryLabel: '附加信息',
      taskSummaryPlaceholder: '任务目标、约束、注意事项…',
      taskCreateOk: '任务已创建',
      taskCreateFailed: '任务创建失败',
      taskUpdateOk: '任务已保存',
      taskUpdateFailed: '任务保存失败',
      taskComplete: '标记完成',
      taskCompleteOk: '任务已标记完成',
      taskCompleteStale: '任务信息已过期，请刷新列表后重试',
      taskItemExpand: '展开子任务明细',
      taskItemDetailEmpty: '该子任务暂无操作记录',
      taskChartTotal: '全部任务',
      taskChartLegend: '{label} {count} 条（{percent}%）',
      taskDeleteConfirm: '确定要删除任务「{name}」吗？\n任务将移入回收站，30 天自动清除；\n在此之前可随时恢复。',
      taskDeleteFailed: '任务删除失败',
      taskDeleteOk: '已移入回收站',
      trashTitle: '回收站',
      trashEmpty: '回收站是空的。删除的任务会在这里保留 30 天。',
      trashLoading: '正在加载回收站…',
      trashLoadFailed: '回收站加载失败',
      trashSearchPlaceholder: '搜索回收站',
      trashSearchEmpty: '没有匹配的任务',
      trashRestore: '恢复',
      trashRestoreOk: '任务已恢复',
      trashRestoreFailed: '任务恢复失败',
      trashPurge: '彻底删除',
      trashPurgeConfirm: '确定要彻底删除任务「{name}」吗？\n任务档案（子任务、操作明细、踩坑）将被永久删除；\n此操作不可恢复。',
      trashPurgeOk: '任务已彻底删除',
      trashPurgeFailed: '彻底删除失败',
      memoryDesc: '管理本地记忆项目、标签和记忆条目。临时记忆默认不持久化，点击存储后才会写入本地 SQLite。',
      memoryStoreInfo: '本地库：{path} · 检索：{mode}',
      /* 「检索」说明的组合片段：词法 + 语义（embedding）。分片而非整句，
         是为了让"维度未知/回填中"这类情形能自然降级而不出现空括号。 */
      memoryRetrievalLexicalOnly: '{lexical}（语义检索未开启）',
      memoryRetrievalHybrid: '{lexical} + 向量语义检索（{detail}）',
      memoryEmbeddingDim: '{dim} 维',
      memoryEmbeddingCovered: '已向量化 {embedded}/{total}',
      memoryEmbeddingDisabled: '未开启',
      memoryEmbeddingBackfilling: '向量化中 {embedded}/{total}',
      memorySearchPlaceholder: '搜索记忆、标签或项目',
      memoryAllDirectories: '全部项目',
      memoryNoDirectory: '无项目',
      memoryProjectFilterHint: '点击筛选该项目的记忆',
      memoryProjectFilterClear: '清除项目筛选',
      memoryProjectFilterPinned: '只看固定注入',
      settingsNavLabel: 'session-kit',
      settingsModuleNavTitle: '左右导航设置',
      settingsLeftNavToggle: '使用session-kit的左导航',
      settingsRightNavToggle: '使用session-kit的右导航',
      settingsModuleMemoryTabTitle: '记忆tab显示设置',
      settingsMemoryTabToggle: '会话里显示记忆tab',
      settingsMemoryTabHint: '开启后，会话顶部导航中会在「轨迹」右侧显示「记忆」；关闭后该 tab 不再出现。',
      settingsSave: '保存',
      settingsSaving: '保存中…',
      /* Embedding 卡的「保存」按钮专用文案：保存即生效（含首次触发向量回填），
         用「保存并使用」比单纯「保存」更能说明它会立刻改变检索行为。
         ⚠️ 不能直接改 settingsSave —— 它被另外 4 个模块的保存按钮共用。 */
      settingsEmbeddingSave: '保存并使用',
      settingsEmbeddingSaving: '保存中…',
      settingsSaved: '保存成功',
      settingsSaveFailed: '保存失败',
      settingsLoadFailed: '读取失败',
      settingsModuleEmbeddingTitle: 'Embedding 语义检索',
      settingsEmbeddingToggle: '开启 embedding',
      settingsEmbeddingHint: '开启后会为已有记忆自动计算向量（后台分批，不阻塞对话）；接口不可用时自动降级为纯词法检索。更换模型或维度后需重建向量，系统会自动识别。',
      settingsEmbeddingLoading: '读取配置中…',
      settingsEmbeddingOff: '未开启',
      settingsEmbeddingStatus: '向量已覆盖 {embedded}/{total} 条记忆',
      settingsEmbeddingBackfilling: '正在后台回填向量：已完成 {done} 条',
      settingsEmbeddingKindRemote: '网络 API',
      settingsEmbeddingKindLocal: '本地模型',
      settingsEmbeddingBaseUrl: 'API 地址',
      settingsEmbeddingApiKey: 'API Key',
      settingsEmbeddingModel: '模型名',
      settingsEmbeddingModelPath: '本地模型路径',
      settingsEmbeddingDimensions: '向量维度',
      settingsEmbeddingTest: '测试连通',
      settingsEmbeddingTesting: '测试中…',
      settingsEmbeddingTestOk: '连通成功',
      settingsEmbeddingTestFailed: '连通失败',
      /* 「现用模式」徽标：前缀 + 模式名（模式名直接复用 settingsEmbeddingKindRemote/Local）。 */
      settingsEmbeddingCurrent: '现用模式：{mode}',
      settingsEmbeddingTestOkDetail: '返回 {dims} 维向量，耗时 {ms} ms；前 3 维：{sample}',
      memoryEphemeral: '临时',
      memoryPersisted: '已存储',
      memoryActive: '激活',
      memoryInactive: '停用',
      memoryActivated: '已激活',
      memoryDeactivated: '已停用',
      memoryManualOn: '当前会话已启用',
      memoryManualOff: '当前会话未启用',
      memoryDirectories: '项目',
      memoryDirectoryListTitle: '记忆项目',
      memoryEphemeralListTitle: '临时记忆（重启后丢失）',
      memoryPersistedListTitle: '永久记忆',
      memoryTags: '标签',
      memoryTagListTitle: '记忆标签',
      memoryItems: '记忆',
      memoryEmpty: '暂无记忆。完成一轮对话后会自动生成临时记忆，也可以点击蒸馏当前会话最后一轮。',
      memoryTemporaryEmpty: '暂无临时记忆。完成一轮对话后会自动生成，也可以点击蒸馏当前会话最后一轮。',
      memoryPersistedEmpty: '暂无已存储记忆。',
      memoryTagsEmpty: '暂无标签。',
      memoryNoMatches: '没有匹配结果。',
      memoryProjectHasMemories: '该项目仍有记忆，不能删除。',
      memoryProjectActive: '已激活',
      memoryProjectCountHelp: '激活记忆数 / 该项目全部记忆数',
      memoryPagination: '第 {page} / {pages} 页，共 {total} 条',
      memoryPrevPage: '上一页',
      memoryNextPage: '下一页',
      memoryActivationTitle: '激活占比',
      memoryLoading: '正在加载记忆…',
      memoryFailed: '记忆服务失败',
      memoryAutoDistill: '自动蒸馏每次对话',
      memoryAllSessionsDirectory: '全部会话启用default',
      memoryFirstTurnAutoMatch: '对话自动匹配项目',
      memoryDistillNow: '蒸馏当前会话最后一轮',
      memoryDistillDone: '蒸馏完成',
      memoryDistillDuplicate: '已存在相同记忆',
      memoryDistillRetrySuccess: '已使用默认模型重试成功',
      memoryDistillFailed: '蒸馏失败：{reason}',
      memoryDistillSkipped: '蒸馏已跳过：{reason}',
      memoryDistillReasonNoUserTranscript: '没有可用的用户对话内容',
      memoryDistillReasonTranscriptTooShort: '对话内容太短',
      memoryDistillReasonNoRoute: '没有可用的模型路由',
      memoryDistillReasonNoUsableOutput: '模型没有生成可用记忆',
      memoryProgress: '进行',
      memoryLogs: '日志',
      memoryNoActivities: '当前没有进行中的任务',
      memoryActivityPendingSummary: '当前用户消息摘要暂不可用',
      memoryActivityMemorySummary: '记忆内容摘要暂不可用',
      memoryNoActivityLogs: '暂无日志',
      memoryOverview: '总览',
      memoryUsageTitle: 'Token 消耗（最近：只保留三个月数据）',
      memoryUsageToday: '今天',
      memoryUsageWeek: '本周',
      memoryUsageMonth: '本月',
      memoryUsageRecent: '最近',
      memoryUsageModels: '模型占比',
      memoryUsageEmpty: '暂无记忆消耗记录',
      memoryUsageUnknownModel: '未知模型',
      memoryUsageTokensUnit: 'tok',
      memoryUsageKinds: '类型占比',
      memoryUsageProjects: '项目占比',
      memoryUsageKindAuto: '自动蒸馏',
      memoryUsageKindManual: '手动蒸馏',
      memoryUsageKindConflict: '冲突裁决',
      memoryUsageUnknownProject: '未知项目',
      memoryUsageOther: '其他',
      memoryLogsRetentionHint: '日志（仅保留7天）',
      memoryLogsClear: '一键清空',
      memoryLogsClearing: '清空中…',
      memoryLogsCleared: '已清空 {n} 条日志',
      memoryLogsClearConfirmTitle: '清空日志',
      memoryLogsClearConfirmDesc: '将永久删除全部日志记录（进行中的任务不受影响）。\n此操作不可撤销。',
      memoryUnknownSession: '未知会话',
      memoryLoadMore: '加载更多',
      memoryActivityErrorReason: '失败原因',
      memoryLogCopy: '复制记忆内容',
      memoryLogCopied: '已复制记忆内容',
      memoryLogCopyEmpty: '这条日志没有可复制的内容。',
      memoryLogCopyBefore: '复制旧版本正文',
      memoryLogCopiedBefore: '已复制旧版本正文',
      memoryLogCopyBeforeEmpty: '这条日志没有旧版本正文。',
      memoryActivityTime: '操作时间',
      memoryActivityStartedAt: '开始时间',
      memoryActivityElapsed: '已耗时',
      memoryActivityDurationHours: '{h} 小时 {m} 分',
      memoryActivityDurationMinutes: '{m} 分 {s} 秒',
      memoryActivityDurationSeconds: '{s} 秒',
      memoryActivityKind_distill: '蒸馏',
      memoryActivityKind_distill_auto: '自动蒸馏',
      memoryActivityKind_distill_manual: '手动蒸馏',
      memoryActivityKind_directory_create: '新增项目',
      memoryActivityKind_directory_update: '更新项目',
      memoryActivityKind_directory_delete: '删除项目',
      memoryActivityKind_tag_create: '新增标签',
      memoryActivityKind_tag_update: '更新标签',
      memoryActivityKind_tag_delete: '删除标签',
      memoryActivitySourceTool: '工具操作',
      memoryActivitySourceManual: '手动操作',
      memoryActivityKind_memory_add: '新增记忆',
      memoryActivityKind_memory_update: '更新记忆',
      memoryActivityKind_memory_delete: '删除记忆',
      memoryActivityKind_memory_revision_delete: '删除记忆版本',
      memoryActivityKind_memory_conflict_missed: '冲突检测未生效',
      memoryActivityKind_embedding_backfill: '向量回填',
      memoryActivityKind_embedding_backfill: '向量回填',
      memoryActivityStatus_running: '进行中',
      memoryActivityStatus_success: '成功',
      memoryActivityStatus_duplicate: '重复',
      memoryActivityStatus_skipped: '已跳过',
      memoryActivityStatus_failed: '失败',
      memoryActivityDiffTitle: '正文差异',
      memoryActivityDiffBefore: '修改前',
      memoryActivityDiffAfter: '修改后',
      memoryActivityDiffNone: '正文未变',
      memoryActivityDiffLegacy: '该次更新未记录差异（旧日志）',
      memoryActivityDiffFields: '其他变化',
      memoryActivityDiffHover: '悬浮查看修改前后差异',
      memoryActivityDiffFieldStatus: '状态',
      memoryActivityDiffFieldPinned: '固定召回',
      memoryActivityDiffFieldDirectory: '记忆项目',
      memoryActivityDiffFieldTags: '标签',
      memoryActivityDiffOn: '开',
      memoryActivityDiffOff: '关',
      memoryActivityDiffNoneValue: '无',
      memoryActivityDiffActive: '激活',
      memoryActivityDiffInactive: '停用',
      memorySettings: '设置',
      memoryDistillSettings: '蒸馏模型设置',
      memorySettingsDesc: '配置蒸馏使用的模型和思考度。默认跟随当前会话输入框；设置自定义模型失败时会使用默认模型重试一次。',
      memoryRecallSettings: '记忆召回设置',
      memoryRecallSettingsDesc: '配置每轮自动召回的总数量和四段配额。段4根据总数量和前3段动态计算。',
      memoryStorageTitle: '记忆保存目录设置',
      memoryStorageDesc: '记忆与任务档案共用的本地 SQLite 库位置。切换后需重启 DSH 才生效。\n不会自动搬移已有数据，新目录从空库开始（原目录数据仍保留，切回即可恢复）。',
      memoryStorageMode: '保存位置',
      memoryStorageModeDefault: '默认',
      memoryStorageModeCustom: '自定义',
      memoryStorageDefaultHint: '使用 profile 下的 .dsh-session-kit 目录',
      memoryStorageCustomPath: '自定义目录',
      memoryStorageCustomPlaceholder: '绝对路径，例如 D:\\dsh-memory',
      memoryStoragePick: '选择目录',
      memoryStoragePicking: '选择中…',
      memoryStorageCurrent: '当前生效',
      memoryStorageRestart: '已保存，重启 DSH 后生效。',
      memoryStorageNoRestart: '已保存，与当前生效目录一致。',
      memoryStoragePathNotAbsolute: '请填写绝对路径（例如 D:\\dsh-memory）。',
      memoryStoragePathIsDefault: '该路径就是默认目录，请直接使用「默认」模式。',
      memoryStoragePathNotADirectory: '该路径已存在但不是文件夹（可能是个文件），请选择一个文件夹路径。',
      memoryStoragePathUnusable: '该目录不可用：无法创建或没有写入权限，请换一个目录。',
      memoryStorageInvalid: '目录设置无效，请检查后重试。',
      memoryStorageFailed: '保存记忆数据目录失败',
      memoryStorageNoPicker: '当前环境不支持目录选择器，请手动填写路径。',
      memoryRecallDedupNote: '段间记忆去重：段1 选走后不再进入段3；段3 选走后不再进入段4。',
      memoryRecallOrderNote: '按 段1 → 段2 → 段3 → 段4 顺序选拔记忆。',
      memoryRecallPinnedNote: '固定召回的记忆（固定注入）不受这里的总数量限制。',
      memoryRecallMode: '召回模式',
      memoryRecallModeDefault: '默认 - 最多20条',
      memoryRecallModeExcludeTemporary: '临时记忆不参与召回 - 最多15条',
      memoryRecallModeCustom: '自定义配置 - 最多8~20条',
      memoryRecallMax: '最多召回数量',
      memoryRecallSegment1: '段1 底色',
      memoryRecallSegment2: '段2 临时',
      memoryRecallSegment3: '段3 混合',
      memoryRecallSegment4: '段4 兜底（动态）',
      memoryRecallSegmentDynamic: '总数 - 段1 - 段2 - 段3',
      memoryRecallSegment1Hint: '底色池记忆，标签：用户偏好、用户画像、项目画像、项目架构、项目约束、模块路径',
      memoryRecallSegment2Hint: '普通池的临时记忆',
      memoryRecallSegment3Hint: '底色池剩余 + 普通池',
      memoryRecallSegment4Hint: '普通池剩余的永久记忆',
      memoryRecallInvalid: '召回配置无效：段4必须至少为3，且四段配额之和必须等于总数。',
      memoryRecallRange6To20: '范围：8~20条',
      memoryDistillModel: '蒸馏模型',
      memoryReasoningEffort: '思考度',
      memoryProviderDefault: '提供商默认',
      memoryModelLoading: '正在加载模型列表…',
      memorySearchModels: '搜索模型',
      memoryNoModels: '没有可用模型',
      memoryFollowSessionModel: '恢复跟随当前会话',
      memoryFollowingSessionModel: '当前跟随会话输入框',
      memoryNewMemory: '新建记忆',
      memoryNewDirectory: '新建项目',
      memoryDirectoryName: '项目名称',
      memoryRemark: '备注',
      memoryRemarkPlaceholder: '选填，最多 500 字；仅本地展示，不参与召回与注入',
      memoryRemarkEmpty: '暂无备注',
      memoryCreate: '创建',
      memorySave: '保存',
      memorySaved: '已保存',
      memorySaving: '保存中…',
      memoryStored: '已存储',
      memoryStore: '存储',
      memoryEdit: '编辑',
      memoryDelete: '删除',
      memoryHistory: '版本历史',
      memoryHistoryTitle: '正文版本历史',
      memoryHistoryEmpty: '这条记忆还没有历史版本。',
      memoryHistoryCurrent: '当前版本',
      memoryHistoryCurrentHint: '正在使用的正文',
      memoryHistoryRestore: '恢复此版本',
      memoryHistoryRestored: '已恢复该版本',
      memoryHistoryRestoreSame: '该版本与当前正文相同，无需恢复。',
      memoryHistoryCopy: '复制此版本',
      memoryHistoryCopied: '已复制此版本正文',
      memoryHistoryClear: '清空历史',
      memoryHistoryCleared: '已清空 {count} 个历史版本',
      memoryHistoryClearConfirm: '确定清空这条记忆的全部 {count} 个历史版本吗？此操作不可撤销。',
      memoryHistoryDelete: '删除此版本',
      memoryHistoryDeleteConfirm: '确定删除这个历史版本吗？此操作不可撤销。',
      memoryHistoryDeleted: '已删除该历史版本',
      memoryHistoryRestoreConfirm: '确定用这个版本覆盖当前正文吗？当前正文会作为历史版本保留。',
      memoryHistoryDiff: '对比当前版本',
      memoryHistoryDiffHint: '绿色为当前正文新增的行，红色为此版本独有的行。',
      memoryHistoryCount: '共 {count} 个历史版本',
      memoryHistorySource_tool: '模型更新',
      memoryHistorySource_ui: '手动编辑',
      memoryHistorySource_restore: '恢复版本',
      memoryHistorySource_distill: '蒸馏更新',
      memoryInject: '注入当前会话',
      memoryInjectConfirm: '确定将这条记忆注入当前会话吗？\n手动注入的记忆不会显示在记忆小面板中，\n只是作为普通的上下文，不参与自动召回流程。',
      memoryInjected: '已注入当前会话',
      memoryAlreadyInjected: '该记忆已在当前会话上下文中',
      memoryInjectNoSession: '请先打开一个会话',
      memoryInjectFailed: '注入记忆失败',
      memoryDeleted: '已删除',
      memoryCopied: '已复制项目 ID',
      memoryCopyProjectId: '复制项目 ID',
      memoryEditProject: '编辑项目',
      memoryProjectProtected: '默认项目不能删除',
      memoryDirectoryId: '项目 ID',
      memoryCancel: '取消',
      memoryClose: '关闭',
      memoryText: '记忆内容',
      memoryInvalidText: '记忆内容太短，至少需要 6 个字符。',
       memoryInvalidJson: '编辑记忆必须是有效的结构化 JSON 对象。',
      memoryBeautifyFormat: '美化格式',
      memoryBeautifyDone: '已转为结构化 JSON 格式',
      memoryBeautifyAlready: '已是规范的结构化 JSON 格式',
      memoryBeautifySkipped: '当前内容不需要转换为 JSON 格式。',
      memoryBeautifyFailed: '无法安全修复 JSON：请手动补齐缺失的引号、逗号或闭合括号后再试。',
      memorySelectDirectory: '选择项目',
      memorySearchDirectories: '搜索项目',
      memorySelectTags: '标签（可多选）',
      memoryPinned: '固定注入',
      memoryPinnedOn: '已固定',
      memoryPinnedOff: '未固定',
      memoryPinnedHelp: '打开后，只要该记忆所属项目在本会话启用，就保证被注入：与其他记忆一同参与相关性排序，排序未入选时在四段筛选之后额外补入，因此注入总量可能超过召回条数设置。',
      memorySearchTags: '搜索标签',
      memoryOnlySelectedTags: '只显示已选',
      memoryMoreTagsHint: '还有 {rest} 个标签没显示，可搜索或勾选「只显示已选」',
      memoryNewTag: '新建标签',
      memoryTagName: '标签名称',
      memorySource: '来源：{title} ({id})',
      memoryCreatedAt: '创建：{time}',
      memoryUpdatedAt: '更新：{time}',
       memoryCreationMethod: '方式：{method}',
       memoryCreationMethodUnknown: '-',
       memoryCreationMethodManual: '手动创建',
       memoryCreationMethodAutoDistill: '自动蒸馏',
       memoryCreationMethodManualDistill: '手动蒸馏',
       memoryCreationMethodMemoryAdd: 'memory_add',
       memoryCreationMethodImport: '导入',
      memoryLastRecalledAt: '最新召回：{time}',
      memoryFactTimeExpiredBadge: '（事件已过期）',
      memoryEventTimeLabel: '事件发生时间',
      memoryValidUntilLabel: '事件失效时间',
      /* 原生日期控件（type=date）自带格式提示与日历，占位说明不再写 YYYY-MM-DD，
         只说明「留空代表什么」——这句是控件本身表达不了的语义。 */
      memoryEventTimePlaceholder: '留空表示未声明（该记忆没有明确发生时刻）',
      memoryValidUntilPlaceholder: '留空表示长期有效（永不过期）',
      /* 时间（可选）：填了才精确到分钟，留空 = 只声明到天。
         这一对标签只用于无障碍（aria-label）——界面上时间框不显示文字标签，
         它的含义由同行的事件/失效标签与下方 placeholder 表达。 */
      memoryEventClockLabel: '事件发生时间的时分',
      memoryValidUntilClockLabel: '事件失效时间的时分',
      memoryClockPlaceholder: 'HH:MM（可留空）',
      memoryEventClockHint: '按 24 小时制填 HH:MM 或 HH:MM:SS；留空表示只精确到天，显示时也只有日期。',
      memoryValidUntilClockHint: '按 24 小时制填 HH:MM 或 HH:MM:SS；留空表示失效到当天结束。',
      memoryInvalidClock: '时间格式不正确：请填 HH:MM（或 HH:MM:SS），也可留空。',
      memoryClockWithoutDate: '填了时间就必须先选日期（时间不能脱离日期单独存在）。',
      memoryInvalidDate: '日期格式不正确：请填 YYYY-MM-DD 或留空。',
      memoryInvalidDateOrder: '失效时间不能早于事件时间。',
      memoryDistillUsage: '用量：{total} tok',
      memoryDistillUsageEstimated: '用量：约 {total} tok',
      memoryDistillUsageUnknown: '用量：-',
      memoryConfirmDelete: '确定删除这条记忆吗？',
      memoryConfirmDeleteTag: '确定删除标签「{name}」吗？',
      memoryConfirmDeleteDirectory: '确定删除项目「{name}」及其下所有记忆吗？',
      memoryNoDirectories: '暂无项目，请先新建项目后再持久化记忆。',
      memoryStoreRequiresActive: '存储前请先把该临时记忆设为激活。',
      compactionConfig: '压缩配置',
      compactionConfigTitle: '上下文自动压缩配置',
      compactionConfigDesc: '只由 dsh-session-kit 在运行时应用，不修改官方或预设配置文件。\n关闭或卸载插件后，DSH 会恢复官方默认压缩配置。',
      compactionConfigEnable: '启用自定义压缩配置',
      compactionConfigThreshold: '自动压缩触发阈值',
      compactionConfigThresholdHelp: '达到模型上下文窗口的该比例时，在下一步请求前尝试自动压缩。\n官方默认 {default}%',
      compactionConfigRetain: '压缩时保留最近原文',
      compactionConfigRetainHelp: '压缩会把较早历史折叠为摘要，同时逐字保留最近一段原文。必须小于触发阈值。\n官方默认 {default}%',
      compactionConfigMaxTokens: '摘要输出上限 maxTokens',
      compactionConfigMaxTokensHelp: '用于压缩摘要那次模型调用的输出 token 上限；官方默认 {default}',
      compactionConfigRetries: '压缩重试次数 compactionRetries',
      compactionConfigRetriesHelp: '压缩后仍高于触发阈值时，额外重试多少次；官方默认 {default}',
      compactionConfigOverflowRetries: '溢出恢复重试 maxOverflowRetries',
      compactionConfigOverflowRetriesHelp: '模型明确报上下文溢出后，最多自动压缩并重试多少次；官方默认 {default}',
      compactionConfigCurrent: '当前：{percent}%',
      compactionConfigDynamicRecommend: '动态推荐：{percent}%',
      compactionConfigSave: '保存',
      compactionConfigSaved: '已保存',
      compactionConfigSaveSuccess: '压缩配置已保存',
      compactionConfigSaving: '保存中…',
      compactionConfigReset: '恢复官方默认',
      compactionConfigFailed: '保存压缩配置失败',
      compactionConfigInvalidRatio: '保留比例必须小于触发阈值。',
      compactionConfigServiceUnavailable: '压缩配置服务未加载，请重启 dsh web 后刷新页面。',
      repairSession: '修复会话',
      repairSessionTitle: '修复当前会话',
      repairSessionDesc: '清除 dsh-session-kit 写进会话日志的越界字段。\n被删除轮次的原生消息会保留并恢复显示。',
      repairSessionOldVersion: '修复加载失败的旧版本会话。',
      repairSessionAction: '修复',
      repairSessionRunning: '修复会话失败：SESSION_RUNNING，会话正在运行，当前无法修复',
      repairSessionSuccess: '修复完成：处理 {events} 处，清理字段 {fields} 个，移除墓碑/事件 {dropped} 个。',
      repairSessionNoChange: '未发现需要清理的内容。',
      repairSessionFailed: '修复会话失败',
      repairSessionUnavailable: '当前会话暂不可修复（会话未落盘或服务未加载）。',
      repairSessionTombstone: '删除墓碑',
      repairSessionStillUnloadable: '字段已清理，但该会话仍无法加载（存在与插件无关的历史格式问题）。',
      repairSessionReloading: '修复完成，页面即将自动刷新以加载修复后的会话…',
      repairSessionLive: '修复会话失败：SESSION_LIVE，会话已加载，当前无法修复',
      repairSessionAutoReload: '修复成功后，会自动重新加载界面。',
      stats: '统计调用',
      archiveSession: '归档会话',
      forkSession: '分叉会话',
      renameSession: '重新命名',
      delete: '删除会话',
      title: '使用系统文件管理器打开当前会话文件夹',
      deleteTitle: '删除本会话',
      renameTitle: '重新命名会话',
      renamePlaceholder: '输入新的会话名称',
      renameConfirm: '保存',
      renameEmpty: '名称不能为空',
      confirm: '确定要删除当前会话吗？删除后会话记录将被移除，该会话的子代理（子智能体）会话日志也将一并删除！',
      cancel: '取消',
      running: '会话运行中，无法删除',
      failed: '操作失败',
      archiveSessionFailed: '归档会话失败',
      forkSessionFailed: '分叉会话失败',
      forkUnavailable: '当前回合尚未结束，无法分叉',
      renameSessionFailed: '重新命名失败',
      archiveTitle: '归档会话管理',
      archiveDescription: '显示已归档（侧边栏隐藏）的会话，可直接查看内容、恢复到会话列表或删除。',
      archiveCount: '已归档 {count} 个会话',
      archiveFilteredCount: '已显示 {shown} / {total} 个会话',
      archiveSearchPlaceholder: '搜索会话名称或ID',
      archiveSearchClear: '清空搜索',
      archiveSessionIdLabel: 'ID',
      archiveSessionIdCopied: 'ID已复制',
      archiveWorkdirLabel: '工作目录',
      archiveWorkdirSearchPlaceholder: '搜索工作目录',
      archiveWorkdirSearchEmpty: '没有匹配的工作目录',
      archiveAllWorkdirs: '全部工作目录',
      archiveMissingWorkdir: '无工作目录',
      archiveSearchEmpty: '没有匹配的归档会话',
      archiveEmpty: '暂无已归档会话',
      archiveLoading: '正在加载归档…',
      archiveRestore: '恢复',
      archiveView: '查看',
      archiveExport: '导出',
      archiveContinueNew: '新聊天中继续',
      archiveFolder: '文件夹',
      archiveForkFailed: '新聊天中继续失败',
      archiveFolderFailed: '打开文件夹失败',
      archiveFolderOpened: '已打开会话文件夹',
      archiveDelete: '删除',
      archiveDeleteConfirm: '确定要删除归档会话「{title}」吗？\n删除后会话记录将被移除！',
      archiveRestored: '已恢复归档会话',
      archiveDeleted: '已删除归档会话',
      archivePreviewTitle: '查看归档会话',
      archivePreviewSessionId: '会话ID',
      archivePreviewCwd: '工作目录',
      archivePreviewCreatedAt: '创建时间',
      archivePreviewUpdatedAt: '最后活跃时间',
      archivePreviewUnknown: '未知',
      archivePreviewSearchPlaceholder: '搜索当前会话',
      archivePreviewSearchEmpty: '没有匹配的对话',
      archivePreviewMessageCount: '{shown} / {total} 条',
      archivePreviewUserToc: '用户对话目录',
      archivePreviewRename: '重新命名',
      archivePreviewExport: '导出会话',
      archivePreviewPrev: '上一页',
      archivePreviewNext: '下一页',
      archivePreviewPage: '第 {page} / {total} 页',
      archivePreviewRenameFailed: '重新命名失败',
      archivePreviewExportUnavailable: '导出服务不可用',
      archivePreviewCopy: '复制',
      archivePreviewCopied: '已复制',
      archivePreviewFootnotes: '脚注',
      archivePreviewExpand: '展开',
      archivePreviewCollapse: '收起',
      archivePreviewLoading: '正在加载会话内容…',
      archivePreviewEmpty: '此会话暂无可预览内容',
      archivePreviewFailed: '加载归档会话失败',
      archiveLoadMore: '加载更多',
      archiveLoadingMore: '正在加载更多…',
      archiveToolStats: '工具调用统计',
      archiveToolStatsEmpty: '无工具调用',
      archiveToolStatsTotal: '共 {count} 次',
      statsTitle: '本会话工具调用统计',
      statsLoading: '正在统计工具调用…',
      statsEmpty: '本会话暂无工具调用',
      statsFailed: '统计工具调用失败',
      statsTotal: '总调用 {count} 次',
      statsSuccess: '成功 {count}',
      statsFailedCount: '失败 {count}',
      statsPending: '未完成 {count}',
      statsCopySessionId: '复制会话ID',
      statsSessionIdCopied: '已复制会话ID',
      statsSessionIdCopyFailed: '复制会话ID失败',
      statsSessionIdMissing: '当前无会话ID可复制',
      archiveRoleUser: '用户',
      archiveRoleAssistant: '助手',
      archiveRoleTool: '工具',
      archiveMissing: '会话文件不存在',
      archiveClose: '关闭',
      topics: '话题',
      topicNav: '用户话题快捷导航',
      topicUntitled: '未命名话题',
      topicJump: '跳转到话题',
      headings: '标题',
      headingNav: '一级标题快捷导航',
      headingUntitled: '未命名标题',
      headingJump: '跳转到标题',
      topicBackToTop: '回到顶部',
      topicBackToBottom: '回到底部',
      topicLoadOlder: '加载更早消息',
      topicLoadingOlder: '正在加载更早消息…',
      exportUnavailable: '导出功能不可用',
      exportFailed: '导出会话失败'
    };
    const en = {
      manage: 'Session manager',
      folder: 'Open folder',
      export: 'Export session',
      archive: 'Open archive',
      archiveManage: 'Archive',
      globalPrompt: 'Global prompt',
      globalPromptTitle: 'Global prompt settings',
      globalPromptDesc: 'When enabled, dsh-session-kit injects this system prompt at runtime through systemPrompt.section. It does not modify official code or config files. Disabling or uninstalling the plugin stops this prompt from taking effect.',
      globalPromptEnable: 'Enable global prompt',
      globalPromptText: 'Global prompt text',
      globalPromptPlaceholder: 'Example: Unless the user explicitly asks for another language, always answer in Chinese.',
      globalPromptSave: 'Save',
      globalPromptSaved: 'Saved',
      globalPromptSaving: 'Saving…',
      globalPromptSaveSuccess: 'Global prompt saved',
      globalPromptFailed: 'Failed to save global prompt',
      globalPromptServiceUnavailable: 'Global prompt service is not loaded. Restart dsh web, then refresh the page.',
      globalPromptTooLarge: 'The global prompt is too large. Shorten it and try again.',
      memory: 'Memory',
      memoryHideSidebarEntry: 'Hide the sidebar memory entry',
      memoryShowSidebarEntry: 'Show the sidebar memory entry',
      archiveHideSidebarEntry: 'Hide the sidebar archive entry',
      archiveShowSidebarEntry: 'Show the sidebar archive entry',
      memoryTitle: 'Memory manager',
      taskManage: 'Tasks',
      taskMenuTitle: 'Task manager',
      taskTitle: 'Task manager',
      taskHideSidebarEntry: 'Hide the sidebar task entry',
      taskShowSidebarEntry: 'Show the sidebar task entry',
      taskEntryToggleHint: 'Only "Active" tasks take part in auto-injection',
      taskDesc: 'Task archives record every file read/write, operation, and pitfall across the whole task — intact across sessions and compaction.',
      taskSearchPlaceholder: 'Search tasks, projects, or related session names/IDs',
      taskFilterNotStarted: 'Not started',
      taskFilterActive: 'Active',
      taskFilterPaused: 'Paused',
      taskFilterCompleted: 'Completed',
      taskFilterAbandoned: 'Abandoned',
      taskFilterAll: 'All',
      taskPagination: 'Page {page} / {pages}, {total} items',
      taskPrevPage: 'Previous',
      taskNextPage: 'Next',
      taskEmpty: 'No task archives yet. They are recorded automatically once a session uses a todo list.',
      taskLoadFailed: 'Failed to load task archives',
      taskItems: 'Subtasks',
      taskItemsLabel: 'Initial subtasks',
      taskItemPlaceholder: 'Subtask content',
      taskItemAdd: 'Add subtask',
      taskItemRemove: 'Remove this row',
      taskCreateOkWithItems: 'Task created ({count} subtasks)',
      taskCreateStatusTip1: 'A new task defaults to "Not started" and does not participate in auto-injection.',
      taskCreateStatusTip2: 'Only tasks with status "Active" participate in auto-injection.',
      taskOperations: 'Operations',
      taskPitfalls: 'Pitfalls',
      taskContextMarks: 'Context changes',
      taskInject: 'Inject into session',
      taskInjectHint: 'Inject the full task archive into the current session context',
      taskInjectOk: 'Injected task archive (~{chars} chars)',
      taskInjectNoSession: 'Open a session first',
      taskInjectConfirm: 'Inject the full archive of task "{name}" into the current session?\nThe archive will be added as a user message to the session context.',
      taskProgress: 'Progress',
      taskProject: 'Project',
      taskSessions: 'Sessions',
      taskSessionsEmpty: 'No sessions yet',
      taskSessionCopyId: 'Click to copy session ID',
      taskSessionIdCopied: 'Session ID copied',
      taskSessionIdCopyFailed: 'Failed to copy session ID',
      taskMemoryDirs: 'Memory projects',
      taskCreatedAt: 'Created',
      taskUpdatedAt: 'Updated',
      taskCwd: 'Working directory',
      taskSummary: 'Summary',
      taskObjects: 'Objects',
      taskItemFiles: 'read {read} / write {written}',
      taskTurnRange: 'turns {from}-{to}',
      taskSessionTurns: 'turns {from}-{to}',
      taskContextKey: 'Field',
      taskTruncatedHint: 'Showing the first {shown} of {total}',
      taskStatusNotStarted: 'Not started',
      taskStatusActive: 'Active',
      taskStatusPaused: 'Paused',
      taskStatusCompleted: 'Completed',
      taskStatusAbandoned: 'Abandoned',
      taskItemPending: 'Pending',
      taskItemInProgress: 'In progress',
      taskItemCompleted: 'Completed',
      taskItemBlocked: 'Blocked',
      taskItemAborted: 'Aborted',
      taskBack: 'Back to list',
      taskDetailTitle: 'Task detail',
      taskEdit: 'Edit',
      taskDelete: 'Delete',
      taskEditTitle: 'Edit task',
      taskNameLabel: 'Task name',
      taskStatusField: 'Status',
      taskSave: 'Save',
      taskCancel: 'Cancel',
      taskAdd: 'New task',
      taskAddTitle: 'New task',
      taskExtract: 'Extract session task',
      taskExtractHint: 'Build a task archive from this session\'s todo list; skipped when an archive already exists',
      taskExtractOk: 'Extracted task "{name}" ({count} subtasks)',
      taskExtractExists: 'This session already has task "{name}"; nothing was written',
      taskExtractFailed: 'Failed to extract task',
      taskAutoInject: 'Auto-inject unfinished tasks',
      taskAutoInjectHint: 'When on, unfinished tasks of this session are matched and hinted before each turn; when off, nothing is auto-injected',
      taskAutoInjectOn: 'Auto-injection of unfinished tasks enabled',
      taskAutoInjectOff: 'Auto-injection of unfinished tasks disabled',
      taskAutoInjectFailed: 'Failed to toggle auto-injection',
      taskExtractReasonNoSession: 'Extract failed: no session specified — open a session first',
      taskExtractReasonNoEvents: 'Extract failed: cannot read this session\'s event stream (not persisted or archived)',
      taskExtractReasonNoTodos: 'Extract failed: this session has no todo list; subtasks come from todos',
      taskExtractReasonEmptyTodos: 'Extract failed: the todo list is empty, nothing to extract',
      taskSummaryLabel: 'Extra info',
      taskSummaryPlaceholder: 'Goals, constraints, notes…',
      taskCreateOk: 'Task created',
      taskCreateFailed: 'Failed to create task',
      taskUpdateOk: 'Task saved',
      taskUpdateFailed: 'Failed to save task',
      taskComplete: 'Mark completed',
      taskCompleteOk: 'Task marked as completed',
      taskCompleteStale: 'Task info is stale — refresh the list and retry',
      taskItemExpand: 'Expand subtask details',
      taskItemDetailEmpty: 'No operations recorded for this subtask',
      taskChartTotal: 'All tasks',
      taskChartLegend: '{label}: {count} ({percent}%)',
      taskDeleteConfirm: 'Delete task "{name}"?\nThe task moves to the trash and is purged automatically after 30 days;\nit can be restored until then.',
      taskDeleteFailed: 'Failed to delete task',
      taskDeleteOk: 'Moved to trash',
      trashTitle: 'Trash',
      trashEmpty: 'Trash is empty. Deleted tasks stay here for 30 days.',
      trashLoading: 'Loading trash…',
      trashLoadFailed: 'Failed to load trash',
      trashSearchPlaceholder: 'Search trash',
      trashSearchEmpty: 'No matching tasks',
      trashRestore: 'Restore',
      trashRestoreOk: 'Task restored',
      trashRestoreFailed: 'Failed to restore task',
      trashPurge: 'Delete permanently',
      trashPurgeConfirm: 'Permanently delete task "{name}"?\nThe task archive (subtasks, operations, pitfalls) will be removed for good;\nthis cannot be undone.',
      trashPurgeOk: 'Task permanently deleted',
      trashPurgeFailed: 'Failed to delete permanently',
      memoryDesc: 'Manage local memory projects, tags, and memory items. Temporary memories are not persisted until you click Store.',
      memoryStoreInfo: 'Local DB: {path} · Retrieval: {mode}',
      memoryRetrievalLexicalOnly: '{lexical} (semantic search off)',
      memoryRetrievalHybrid: '{lexical} + vector semantic search ({detail})',
      memoryEmbeddingDim: '{dim} dims',
      memoryEmbeddingCovered: '{embedded}/{total} vectorized',
      memoryEmbeddingDisabled: 'off',
      memoryEmbeddingBackfilling: 'vectorizing {embedded}/{total}',
      memorySearchPlaceholder: 'Search memories, tags, or project names',
      memoryAllDirectories: 'All project names',
      memoryNoDirectory: 'No project name',
      memoryProjectFilterHint: 'Click to filter memories of this project',
      memoryProjectFilterClear: 'Clear project filter',
      memoryProjectFilterPinned: 'Pinned only',
      settingsNavLabel: 'session-kit',
      settingsModuleNavTitle: 'Left & right navigation',
      settingsLeftNavToggle: 'Use session-kit left navigation',
      settingsRightNavToggle: 'Use session-kit right navigation',
      settingsModuleMemoryTabTitle: 'Memory tab display',
      settingsMemoryTabToggle: 'Show the Memory tab in sessions',
      settingsMemoryTabHint: 'When on, a "Memory" tab appears beside "Trajectory" in the session header. When off, the tab is removed.',
      settingsSave: 'Save',
      settingsSaving: 'Saving…',
      settingsEmbeddingSave: 'Save & use',
      settingsEmbeddingSaving: 'Saving…',
      settingsSaved: 'Saved',
      settingsSaveFailed: 'Save failed',
      settingsLoadFailed: 'Load failed',
      settingsModuleEmbeddingTitle: 'Embedding semantic search',
      settingsEmbeddingToggle: 'Enable embedding',
      settingsEmbeddingHint: 'When on, vectors are computed for existing memories in the background (never blocking the conversation). If the endpoint fails, recall automatically falls back to lexical search. Changing the model or dimensions rebuilds vectors automatically.',
      settingsEmbeddingLoading: 'Loading configuration…',
      settingsEmbeddingOff: 'Off',
      settingsEmbeddingStatus: 'Vectors cover {embedded}/{total} memories',
      settingsEmbeddingBackfilling: 'Backfilling vectors: {done} done',
      settingsEmbeddingKindRemote: 'Remote API',
      settingsEmbeddingKindLocal: 'Local model',
      settingsEmbeddingBaseUrl: 'API base URL',
      settingsEmbeddingApiKey: 'API key',
      settingsEmbeddingModel: 'Model',
      settingsEmbeddingModelPath: 'Local model path',
      settingsEmbeddingDimensions: 'Dimensions',
      settingsEmbeddingTest: 'Test connection',
      settingsEmbeddingTesting: 'Testing…',
      settingsEmbeddingTestOk: 'Connection OK',
      settingsEmbeddingTestFailed: 'Connection failed',
      settingsEmbeddingCurrent: 'Mode: {mode}',
      settingsEmbeddingTestOkDetail: 'Returned a {dims}-dim vector in {ms} ms; first 3 values: {sample}',
      memoryEphemeral: 'Temporary',
      memoryPersisted: 'Stored',
      memoryActive: 'Active',
      memoryInactive: 'Inactive',
      memoryActivated: 'Activated',
      memoryDeactivated: 'Deactivated',
      memoryManualOn: 'Enabled for this session',
      memoryManualOff: 'Disabled for this session',
      memoryDirectories: 'Project names',
      memoryDirectoryListTitle: 'Memory projects',
      memoryEphemeralListTitle: 'Temporary memories (lost after restart)',
      memoryPersistedListTitle: 'Permanent memories',
      memoryTags: 'Tags',
      memoryTagListTitle: 'Memory tags',
      memoryItems: 'Memories',
      memoryEmpty: 'No memories yet. Finish a turn to auto-distill one, or click Distill latest turn of current session.',
      memoryTemporaryEmpty: 'No temporary memories yet. Finish a turn to auto-distill one, or click Distill latest turn of current session.',
      memoryPersistedEmpty: 'No stored memories yet.',
      memoryTagsEmpty: 'No tags yet.',
      memoryNoMatches: 'No matches.',
      memoryProjectHasMemories: 'This project still has memories and cannot be deleted.',
      memoryProjectActive: 'Activated',
      memoryProjectCountHelp: 'Active memories / all memories in this project',
      memoryPagination: 'Page {page} / {pages}, {total} items',
      memoryPrevPage: 'Previous page',
      memoryNextPage: 'Next page',
      memoryActivationTitle: 'Activation',
      memoryLoading: 'Loading memories…',
      memoryFailed: 'Memory service failed',
      memoryAutoDistill: 'Auto-distill every turn',
      memoryAllSessionsDirectory: 'Enable default for all chats',
      memoryFirstTurnAutoMatch: 'Auto-match projects on each turn',
      memoryDistillNow: 'Distill latest turn of current session',
      memoryDistillDone: 'Distillation complete',
      memoryDistillDuplicate: 'Duplicate memory already exists',
      memoryDistillRetrySuccess: 'Retried successfully with the default model',
      memoryDistillFailed: 'Distillation failed: {reason}',
      memoryDistillSkipped: 'Distillation skipped: {reason}',
      memoryDistillReasonNoUserTranscript: 'No usable user transcript',
      memoryDistillReasonTranscriptTooShort: 'Transcript is too short',
      memoryDistillReasonNoRoute: 'No usable model route',
      memoryDistillReasonNoUsableOutput: 'The model produced no usable memory',
      memoryProgress: 'In progress',
      memoryLogs: 'Logs',
      memoryNoActivities: 'No active tasks',
      memoryActivityPendingSummary: 'Current user message summary unavailable',
      memoryActivityMemorySummary: 'Memory content summary unavailable',
      memoryNoActivityLogs: 'No activity logs',
      memoryOverview: 'Overview',
      memoryUsageTitle: 'Token usage (recent: only the last three months)',
      memoryUsageToday: 'Today',
      memoryUsageWeek: 'This week',
      memoryUsageMonth: 'This month',
      memoryUsageRecent: 'Recent',
      memoryUsageModels: 'Model share',
      memoryUsageEmpty: 'No memory usage recorded yet',
      memoryUsageUnknownModel: 'Unknown model',
      memoryUsageTokensUnit: 'tok',
      memoryUsageKinds: 'Type share',
      memoryUsageProjects: 'Project share',
      memoryUsageKindAuto: 'Auto distill',
      memoryUsageKindManual: 'Manual distill',
      memoryUsageKindConflict: 'Conflict check',
      memoryUsageUnknownProject: 'Unknown project',
      memoryUsageOther: 'Other',
      memoryLogsRetentionHint: 'Logs (kept 7 days)',
      memoryLogsClear: 'Clear all',
      memoryLogsClearing: 'Clearing…',
      memoryLogsCleared: 'Cleared {n} log entries',
      memoryLogsClearConfirmTitle: 'Clear logs',
      memoryLogsClearConfirmDesc: 'All log entries will be permanently deleted (running tasks are unaffected).\nThis cannot be undone.',
      memoryUnknownSession: 'Unknown session',
      memoryLoadMore: 'Load more',
      memoryActivityErrorReason: 'Failure reason',
      memoryLogCopy: 'Copy memory content',
      memoryLogCopied: 'Memory content copied',
      memoryLogCopyEmpty: 'This log entry has no copyable content.',
      memoryLogCopyBefore: 'Copy previous version',
      memoryLogCopiedBefore: 'Previous version copied',
      memoryLogCopyBeforeEmpty: 'This log entry has no previous version.',
      memoryActivityTime: 'Operation time',
      memoryActivityStartedAt: 'Started at',
      memoryActivityElapsed: 'Elapsed',
      memoryActivityDurationHours: '{h}h {m}m',
      memoryActivityDurationMinutes: '{m}m {s}s',
      memoryActivityDurationSeconds: '{s}s',
      memoryActivityKind_distill: 'Distillation',
      memoryActivityKind_distill_auto: 'Auto distillation',
      memoryActivityKind_distill_manual: 'Manual distillation',
      memoryActivityKind_directory_create: 'Add project',
      memoryActivityKind_directory_update: 'Update project',
      memoryActivityKind_directory_delete: 'Delete project',
      memoryActivityKind_tag_create: 'Add tag',
      memoryActivityKind_tag_update: 'Update tag',
      memoryActivityKind_tag_delete: 'Delete tag',
      memoryActivitySourceTool: 'Tool',
      memoryActivitySourceManual: 'Manual',
      memoryActivityKind_memory_add: 'Add memory',
      memoryActivityKind_memory_update: 'Update memory',
      memoryActivityKind_memory_delete: 'Delete memory',
      memoryActivityKind_memory_revision_delete: 'Delete memory version',
      memoryActivityKind_memory_conflict_missed: 'Conflict check skipped',
      memoryActivityKind_embedding_backfill: 'Embedding backfill',
      memoryActivityStatus_running: 'In progress',
      memoryActivityStatus_success: 'Success',
      memoryActivityStatus_duplicate: 'Duplicate',
      memoryActivityStatus_skipped: 'Skipped',
      memoryActivityStatus_failed: 'Failed',
      memoryActivityDiffTitle: 'Content diff',
      memoryActivityDiffBefore: 'Before',
      memoryActivityDiffAfter: 'After',
      memoryActivityDiffNone: 'Content unchanged',
      memoryActivityDiffLegacy: 'No diff recorded for this update (legacy log)',
      memoryActivityDiffFields: 'Other changes',
      memoryActivityDiffHover: 'Hover to see the before/after diff',
      memoryActivityDiffFieldStatus: 'Status',
      memoryActivityDiffFieldPinned: 'Pinned',
      memoryActivityDiffFieldDirectory: 'Project',
      memoryActivityDiffFieldTags: 'Tags',
      memoryActivityDiffOn: 'on',
      memoryActivityDiffOff: 'off',
      memoryActivityDiffNoneValue: 'none',
      memoryActivityDiffActive: 'Active',
      memoryActivityDiffInactive: 'Inactive',      memorySettings: 'Settings',
      memoryDistillSettings: 'Model distillation',
      memorySettingsDesc: 'Choose the model and reasoning effort for distillation. By default it follows the current session input; if the custom model fails, the default model is retried once.',
      memoryRecallSettings: 'Memory recall settings',
      memoryRecallSettingsDesc: 'Configure the per-turn recall total and four segment quotas. Segment 4 is calculated from the total and segments 1-3.',
      memoryStorageTitle: 'Memory save directory',
      memoryStorageDesc: 'Location of the local SQLite database shared by memories and task archives. Changing it takes effect after restarting DSH.\nExisting data is not moved, the new directory starts empty (the old directory is kept, switch back to restore it).',
      memoryStorageMode: 'Location',
      memoryStorageModeDefault: 'Default',
      memoryStorageModeCustom: 'Custom',
      memoryStorageDefaultHint: 'Use the .dsh-session-kit directory under the profile',
      memoryStorageCustomPath: 'Custom directory',
      memoryStorageCustomPlaceholder: 'Absolute path, e.g. D:\\dsh-memory',
      memoryStoragePick: 'Choose directory',
      memoryStoragePicking: 'Choosing…',
      memoryStorageCurrent: 'Currently active',
      memoryStorageRestart: 'Saved. Takes effect after restarting DSH.',
      memoryStorageNoRestart: 'Saved. Same as the currently active directory.',
      memoryStoragePathNotAbsolute: 'Enter an absolute path (e.g. D:\\dsh-memory).',
      memoryStoragePathIsDefault: 'That path is the default directory; use "Default" mode instead.',
      memoryStoragePathNotADirectory: 'That path exists but is not a folder (it may be a file); choose a folder path.',
      memoryStoragePathUnusable: 'That directory is unusable: it cannot be created or is not writable. Pick another one.',
      memoryStorageInvalid: 'Invalid directory setting. Check it and try again.',
      memoryStorageFailed: 'Failed to save the memory data directory',
      memoryStorageNoPicker: 'No directory picker is available here; enter the path manually.',
      memoryRecallDedupNote: 'Cross-segment dedup: a memory picked by segment 1 never enters segment 3, and one picked by segment 3 never enters segment 4.',
      memoryRecallOrderNote: 'Memories are selected in the order segment 1 → segment 2 → segment 3 → segment 4.',
      memoryRecallPinnedNote: 'Pinned memories (always injected) are not limited by the total count here.',
      memoryRecallMode: 'Recall mode',
      memoryRecallModeDefault: 'Default - up to 20',
      memoryRecallModeExcludeTemporary: 'Exclude temporary memories - up to 15',
      memoryRecallModeCustom: 'Custom - 8 to 20',
      memoryRecallMax: 'Maximum recalled memories',
      memoryRecallSegment1: 'Segment 1 Base',
      memoryRecallSegment2: 'Segment 2 Temporary',
      memoryRecallSegment3: 'Segment 3 Mixed',
      memoryRecallSegment4: 'Segment 4 Fallback (dynamic)',
      memoryRecallSegmentDynamic: 'Total - segment 1 - segment 2 - segment 3',
      memoryRecallSegment1Hint: 'Base pool memories, tags: user preferences, user profile, project profile, project architecture, project constraints, module paths',
      memoryRecallSegment2Hint: 'Temporary memories from the regular pool',
      memoryRecallSegment3Hint: 'Base pool remainder + regular pool',
      memoryRecallSegment4Hint: 'Remaining permanent memories from the regular pool',
      memoryRecallInvalid: 'Invalid recall settings: segment 4 must be at least 3 and quotas must add up to the total.',
      memoryRecallRange6To20: 'Range: 8-20',
      memoryDistillModel: 'Distillation model',
      memoryReasoningEffort: 'Reasoning effort',
      memoryProviderDefault: 'Provider default',
      memoryModelLoading: 'Loading models…',
      memorySearchModels: 'Search models',
      memoryNoModels: 'No models available',
      memoryFollowSessionModel: 'Follow current session',
      memoryFollowingSessionModel: 'Following the session input model',
      memoryNewMemory: 'New memory',
      memoryNewDirectory: 'New project name',
      memoryDirectoryName: 'Project name',
      memoryRemark: 'Remark',
      memoryRemarkPlaceholder: 'Optional, up to 500 chars; local display only, never recalled or injected',
      memoryRemarkEmpty: 'No remark',
      memoryCreate: 'Create',
      memorySave: 'Save',
      memorySaved: 'Saved',
      memorySaving: 'Saving…',
      memoryStored: 'Stored',
      memoryStore: 'Store',
      memoryEdit: 'Edit',
      memoryDelete: 'Delete',
      memoryHistory: 'Version history',
      memoryHistoryTitle: 'Body version history',
      memoryHistoryEmpty: 'This memory has no version history yet.',
      memoryHistoryCurrent: 'Current version',
      memoryHistoryCurrentHint: 'The body in use',
      memoryHistoryRestore: 'Restore this version',
      memoryHistoryRestored: 'Version restored',
      memoryHistoryRestoreSame: 'This version matches the current body; nothing to restore.',
      memoryHistoryCopy: 'Copy this version',
      memoryHistoryCopied: 'Version body copied',
      memoryHistoryClear: 'Clear history',
      memoryHistoryCleared: 'Cleared {count} versions',
      memoryHistoryClearConfirm: 'Delete all {count} versions of this memory? This cannot be undone.',
      memoryHistoryDelete: 'Delete this version',
      memoryHistoryDeleteConfirm: 'Delete this version? This cannot be undone.',
      memoryHistoryDeleted: 'Version deleted',
      memoryHistoryRestoreConfirm: 'Overwrite the current body with this version? The current body is kept as a version.',
      memoryHistoryDiff: 'Diff with current',
      memoryHistoryDiffHint: 'Green lines exist only in the current body; red lines only in this version.',
      memoryHistoryCount: '{count} versions',
      memoryHistorySource_tool: 'Model update',
      memoryHistorySource_ui: 'Manual edit',
      memoryHistorySource_restore: 'Restore',
      memoryHistorySource_distill: 'Distill update',
      memoryInject: 'Inject into current session',
      memoryInjectConfirm: 'Inject this memory into the current session?\nA manually injected memory will not appear in the memory panel;\nit is ordinary context and does not participate in automatic recall.',
      memoryInjected: 'Injected into current session',
      memoryAlreadyInjected: 'This memory is already in the current session context',
      memoryInjectNoSession: 'Open a session first',
      memoryInjectFailed: 'Failed to inject memory',
      memoryDeleted: 'Deleted',
      memoryCopied: 'Project ID copied',
      memoryCopyProjectId: 'Copy project ID',
      memoryEditProject: 'Edit project',
      memoryProjectProtected: 'System fallback projects cannot be deleted',
      memoryDirectoryId: 'Project ID',
      memoryCancel: 'Cancel',
      memoryClose: 'Close',
      memoryText: 'Memory text',
      memoryInvalidText: 'Memory text is too short (at least 6 characters).',
       memoryInvalidJson: 'Edited memories must be a valid structured JSON object.',
      memoryBeautifyFormat: 'Beautify format',
      memoryBeautifyDone: 'Converted to structured JSON',
      memoryBeautifyAlready: 'Already normalized structured JSON',
      memoryBeautifySkipped: 'This content does not need JSON conversion.',
      memoryBeautifyFailed: 'Cannot safely repair the JSON. Add the missing quotes, commas or closing brackets and try again.',
      memorySelectDirectory: 'Select project name',
      memorySearchDirectories: 'Search projects',
      memorySelectTags: 'Tags (multi-select)',
      memoryPinned: 'Always inject',
      memoryPinnedOn: 'Pinned',
      memoryPinnedOff: 'Not pinned',
      memoryPinnedHelp: 'When on, this memory is always injected while its project is enabled in this session: it competes for relevance like any other memory, and if it is not selected it is added after the four segments are chosen, so the injected total may exceed the recall count setting.',
      memorySearchTags: 'Search tags',
      memoryOnlySelectedTags: 'Only selected',
      memoryMoreTagsHint: '{rest} more tags — search or check "Only selected"',
      memoryNewTag: 'New tag',
      memoryTagName: 'Tag name',
      memorySource: 'Source: {title} ({id})',
      memoryCreatedAt: 'Created: {time}',
      memoryUpdatedAt: 'Updated: {time}',
       memoryCreationMethod: 'Method: {method}',
       memoryCreationMethodUnknown: '-',
       memoryCreationMethodManual: 'Manual creation',
       memoryCreationMethodAutoDistill: 'Auto distill',
       memoryCreationMethodManualDistill: 'Manual distill',
       memoryCreationMethodMemoryAdd: 'memory_add',
       memoryCreationMethodImport: 'Import',
      memoryLastRecalledAt: 'Last recalled: {time}',
      memoryFactTimeExpiredBadge: '(event expired)',
      memoryEventTimeLabel: 'Event time (when the described fact happened)',
      memoryValidUntilLabel: 'Valid until (when this memory stops holding; empty = long-lived)',
      /* The native date input shows its own format hint, so the title only explains
         what an empty value means — the one thing the control cannot express. */
      memoryEventTimePlaceholder: 'Empty = not declared (no explicit moment for this fact)',
      memoryValidUntilPlaceholder: 'Empty = never expires',
      /* These two labels exist only for accessibility (aria-label); the clock input shows
         no visible label — its meaning comes from the row label and the placeholder. */
      memoryEventClockLabel: 'Clock time of the event',
      memoryValidUntilClockLabel: 'Clock time of the expiry',
      memoryClockPlaceholder: 'HH:MM (optional)',
      memoryEventClockHint: '24-hour HH:MM or HH:MM:SS. Leave empty to keep day precision — the display then shows the date only.',
      memoryValidUntilClockHint: '24-hour HH:MM or HH:MM:SS. Leave empty to expire at the end of that day.',
      memoryInvalidClock: 'Invalid time: use HH:MM (or HH:MM:SS), or leave it empty.',
      memoryClockWithoutDate: 'A time needs a date — pick the date first.',
      memoryInvalidDate: 'Invalid date: use YYYY-MM-DD or leave empty.',
      memoryInvalidDateOrder: 'Valid-until cannot be earlier than event time.',
      memoryDistillUsage: 'Usage: {total} tok',
      memoryDistillUsageEstimated: 'Usage: ~{total} tok',
      memoryDistillUsageUnknown: 'Usage: -',
      memoryConfirmDelete: 'Delete this memory?',
      memoryConfirmDeleteTag: 'Delete tag "{name}"?',
      memoryConfirmDeleteDirectory: 'Delete project name "{name}" and all its memories?',
      memoryNoDirectories: 'No project names yet. Create one before persisting memories.',
      memoryStoreRequiresActive: 'Activate this temporary memory before storing it.',
      compactionConfig: 'Compaction config',
      compactionConfigTitle: 'Automatic context compaction config',
      compactionConfigDesc: 'Applied only at runtime by dsh-session-kit; it does not modify official or preset config files.\nDisabling or uninstalling the plugin restores the DSH defaults.',
      compactionConfigEnable: 'Use custom compaction config',
      compactionConfigThreshold: 'Auto compaction threshold',
      compactionConfigThresholdHelp: 'When the conversation reaches this fraction of the model context window, DSH attempts automatic compaction before the next step.\nOfficial default is {default}%',
      compactionConfigRetain: 'Recent verbatim retention',
      compactionConfigRetainHelp: 'Compaction folds older history into a summary while preserving recent original text verbatim. Must be lower than the threshold.\nOfficial default is {default}%',
      compactionConfigMaxTokens: 'Summary maxTokens',
      compactionConfigMaxTokensHelp: 'Output token cap for the model call that writes the compaction summary; official default is {default}',
      compactionConfigRetries: 'compactionRetries',
      compactionConfigRetriesHelp: 'Extra attempts when the conversation remains above the threshold after compaction; official default is {default}',
      compactionConfigOverflowRetries: 'maxOverflowRetries',
      compactionConfigOverflowRetriesHelp: 'How many automatic compact-and-retry recoveries to allow after the model reports context overflow; official default is {default}',
      compactionConfigCurrent: 'Current: {percent}%',
      compactionConfigDynamicRecommend: 'Dynamic recommendation: {percent}%',
      compactionConfigSave: 'Save',
      compactionConfigSaved: 'Saved',
      compactionConfigSaveSuccess: 'Compaction config saved',
      compactionConfigSaving: 'Saving…',
      compactionConfigReset: 'Restore official default',
      compactionConfigFailed: 'Failed to save compaction config',
      compactionConfigInvalidRatio: 'Retention must be lower than the trigger threshold.',
      compactionConfigServiceUnavailable: 'Compaction config service is not loaded. Restart dsh web, then refresh the page.',
      repairSession: 'Repair session',
      repairSessionTitle: 'Repair current session',
      repairSessionDesc: 'Clears the out-of-schema fields dsh-session-kit wrote into the session log.\nMessages of deleted turns are kept and become visible again.',
      repairSessionOldVersion: 'Repairs older-version sessions that fail to load.',
      repairSessionAction: 'Repair',
      repairSessionRunning: 'Repair failed: SESSION_RUNNING. The session is running and cannot be repaired right now.',
      repairSessionSuccess: 'Repair complete: {events} change(s), {fields} field(s) cleared, {dropped} tombstone/event(s) removed.',
      repairSessionNoChange: 'Nothing needed clearing.',
      repairSessionFailed: 'Failed to repair the session',
      repairSessionUnavailable: 'This session cannot be repaired right now (not persisted, or the service is not loaded).',
      repairSessionTombstone: 'deletion tombstone',
      repairSessionStillUnloadable: 'Fields were cleared, but the session still cannot load (an unrelated historical format problem remains).',
      repairSessionReloading: 'Repair complete. The page will reload shortly to load the repaired session…',
      repairSessionLive: 'Repair failed: SESSION_LIVE. The session is loaded and cannot be repaired right now.',
      repairSessionAutoReload: 'Once the repair succeeds, the interface reloads automatically.',
      stats: 'Call stats',
      archiveSession: 'Archive session',
      forkSession: 'Fork session',
      renameSession: 'Rename',
      delete: 'Delete session',
      title: 'Open the session folder in the system file manager',
      deleteTitle: 'Delete this session',
      renameTitle: 'Rename session',
      renamePlaceholder: 'Enter a new session name',
      renameConfirm: 'Save',
      renameEmpty: 'Name cannot be empty',
      confirm: 'Delete this session? Its session record will be removed, and its subagent session logs will be deleted as well!',
      cancel: 'Cancel',
      running: 'The session is running and cannot be deleted',
      failed: 'Operation failed',
      archiveSessionFailed: 'Failed to archive session',
      forkSessionFailed: 'Failed to fork session',
      forkUnavailable: 'the current turn is still open; it cannot be forked here',
      renameSessionFailed: 'Failed to rename session',
      archiveTitle: 'Archived sessions',
      archiveDescription: 'Shows archived (sidebar-hidden) sessions. View content directly, restore them to the list, or delete them.',
      archiveCount: '{count} archived sessions',
      archiveFilteredCount: 'Showing {shown} / {total} sessions',
      archiveSearchPlaceholder: 'Search session name or ID',
      archiveSearchClear: 'Clear search',
      archiveSessionIdLabel: 'ID',
      archiveSessionIdCopied: 'ID copied',
      archiveWorkdirLabel: 'Working directory',
      archiveWorkdirSearchPlaceholder: 'Search working directory',
      archiveWorkdirSearchEmpty: 'No matching working directories',
      archiveAllWorkdirs: 'All working directories',
      archiveMissingWorkdir: 'No working directory',
      archiveSearchEmpty: 'No archived sessions match your search',
      archiveEmpty: 'No archived sessions',
      archiveLoading: 'Loading archive…',
      archiveRestore: 'Restore',
      archiveView: 'View',
      archiveExport: 'Export',
      archiveContinueNew: 'Continue in new chat',
      archiveFolder: 'Folder',
      archiveForkFailed: 'Could not continue in new chat',
      archiveFolderFailed: 'Could not open folder',
      archiveFolderOpened: 'Opened session folder',
      archiveDelete: 'Delete',
      archiveDeleteConfirm: 'Delete archived session "{title}"? Its session record will be removed.',
      archiveRestored: 'Archived session restored',
      archiveDeleted: 'Archived session deleted',
      archivePreviewTitle: 'View archived session',
      archivePreviewSessionId: 'Session ID',
      archivePreviewCwd: 'Working directory',
      archivePreviewCreatedAt: 'Created',
      archivePreviewUpdatedAt: 'Last active',
      archivePreviewUnknown: 'Unknown',
      archivePreviewSearchPlaceholder: 'Search this session',
      archivePreviewSearchEmpty: 'No messages match your search',
      archivePreviewMessageCount: '{shown} / {total} messages',
      archivePreviewUserToc: 'User message directory',
      archivePreviewRename: 'Rename',
      archivePreviewExport: 'Export session',
      archivePreviewPrev: 'Previous',
      archivePreviewNext: 'Next',
      archivePreviewPage: 'Page {page} / {total}',
      archivePreviewRenameFailed: 'Rename failed',
      archivePreviewExportUnavailable: 'Export service unavailable',
      archivePreviewCopy: 'Copy',
      archivePreviewCopied: 'Copied',
      archivePreviewFootnotes: 'Footnotes',
      archivePreviewExpand: 'Expand',
      archivePreviewCollapse: 'Collapse',
      archivePreviewLoading: 'Loading session content…',
      archivePreviewEmpty: 'This session has no previewable content',
      archivePreviewFailed: 'Failed to load archived session',
      archiveLoadMore: 'Load more',
      archiveLoadingMore: 'Loading more…',
      archiveToolStats: 'Tool call stats',
      archiveToolStatsEmpty: 'No tool calls',
      archiveToolStatsTotal: '{count} total',
      statsTitle: 'This session tool call stats',
      statsLoading: 'Counting tool calls…',
      statsEmpty: 'This session has no tool calls',
      statsFailed: 'Failed to count tool calls',
      statsTotal: '{count} total calls',
      statsSuccess: '{count} succeeded',
      statsFailedCount: '{count} failed',
      statsPending: '{count} pending',
      statsCopySessionId: 'Copy session ID',
      statsSessionIdCopied: 'Session ID copied',
      statsSessionIdCopyFailed: 'Failed to copy session ID',
      statsSessionIdMissing: 'No session ID to copy',
      archiveRoleUser: 'User',
      archiveRoleAssistant: 'Assistant',
      archiveRoleTool: 'Tool',
      archiveMissing: 'Session file is missing',
      archiveClose: 'Close',
      topics: 'Topics',
      topicNav: 'User topic quick navigation',
      topicUntitled: 'Untitled topic',
      topicJump: 'Jump to topic',
      headings: 'Headings',
      headingNav: 'Level-one heading quick navigation',
      headingUntitled: 'Untitled heading',
      headingJump: 'Jump to heading',
      topicBackToTop: 'Back to top',
      topicBackToBottom: 'Back to bottom',
      topicLoadOlder: 'Load older messages',
      topicLoadingOlder: 'Loading older messages…',
      exportUnavailable: 'Export is unavailable',
      exportFailed: 'Failed to export session'
    };
    const turnsDelZh = {
      'action.del': '此轮到后续全删除',
      'action.busy': '任务运行时不能删除会话轮次',
      'dialog.title': '此轮到后续全删除？',
      'dialog.description': '这会从当前 Session 和后续模型上下文中移除当前轮及其后所有轮次的提问、回答与工具记录，但不会删除整个 Session。',
      'dialog.cancel': '取消',
      'dialog.confirm': '删除',
      'dialog.deleting': '正在删除…',
      'error.busy': '任务正在运行，请结束后再删除。',
      'error.compacted': '选中轮次或后续轮次已被压缩、混合，或与已删除范围重叠，无法安全删除。',
      'error.unavailable': '这一轮已变化、不存在或已被删除。',
      'error.generic': '删除失败，请重试。',
      'regenerate.action': '重新生成',
      'regenerate.busy': '任务运行或队列中有待处理提问时不能重新生成',
      'regenerate.failed': '重新生成失败，请重试。',
      'regenerate.queue': '输入队列中有待处理提问，请等待后再重新生成。',
      'regenerate.prompt': '此轮没有可安全重新发送的纯文本用户提问。',
      'regenerate.ambiguous': '该轮存在多条用户提问，无法确定要重新发送哪一条。请点该提问所在行的按钮。',
      'regenerate.unsupported': '该轮提问包含附件或非文本内容，无法安全重新发送。',
      'regenerate.unclosed': '该轮尚未收尾（可能刚被手动停止），请稍等片刻后重试。',
      'edit.action': '编辑后重新生成',
      'edit.title': '编辑用户消息后重新生成',
      'edit.placeholder': '编辑用户消息',
      'edit.confirm': '保存并重新生成',
      'edit.empty': '消息不能为空',
      'edit.failed': '编辑后重新生成失败，请重试。',
      'distill.action': '蒸馏本轮对话',
      'distill.busy': '任务运行或队列中有待处理提问时不能蒸馏本轮对话',
      'distill.done': '已蒸馏',
      'distill.failed': '蒸馏本轮对话失败，请重试。',
      'distill.skipped': '蒸馏已跳过：{reason}',
      'distill.reason.no-user-transcript': '没有可用的用户对话内容',
      'distill.reason.transcript-too-short': '对话内容太短',
      'distill.reason.no-route': '没有可用的模型路由',
      'distill.reason.no-usable-output': '模型没有生成可用记忆',
      'turnMemory.action': '记忆',
      'turnMemory.tip': '本轮上下文的记忆快照',
      'turnMemory.title': '本轮上下文的记忆快照',
      'turnMemory.empty': '本轮上下文没有注入记忆',
      'turnMemory.failed': '获取本轮记忆失败，请重试。',
      'turnMemory.count': '{count} 条',
      'turnMemory.search': '搜索记忆',
      'turnMemory.searchPlaceholder': '搜索标签或内容',
      'turnMemory.searchClear': '清空搜索',
      'turnMemory.searchEmpty': '没有匹配的记忆',
      'turnMemory.countFiltered': '已显示 {shown} / {total} 条',
      'turnMemory.pinned': '固定召回的记忆',
      'turnMemory.newRecall': '本轮新召回的记忆',
      'turnMemory.pinnedSearch': '固定召回 固定记忆'
    };
    /* 「记忆」视图（conversation.view 的 session-kit tab）字典。 */
    const sessionMemoryZh = {
      'view.label': '记忆',
      'view.title': '当前会话记忆注入的快照',
      'view.loading': '正在读取记忆…',
      'view.failed': '读取记忆失败，请重试。',
      'view.empty': '本会话还没有注入任何记忆。',
      'view.sectionPinned': '固定注入',
      'view.sectionPinnedHint': '本轮上下文中被固定召回的记忆',
      'view.sectionManual': '手动注入',
      'view.sectionManualHint': '由你手动注入到当前会话的记忆',
      'view.sectionAuto': '自动注入',
      'view.sectionAutoHint': '本轮上下文中被自动召回的记忆',
      'view.turnBadge': '第 {turn} 轮',
      'view.turnBadgeLatest': '第 {turn} 轮（最新轮次）',
      'view.legendPinned': '固定注入 {count} 条 · {percent}%',
      'view.legendAuto': '自动注入 {count} 条 · {percent}%',
      'view.pieLabel': '本轮注入构成：固定注入 {pinnedPercent}%，自动注入 {autoPercent}%',
      'view.count': '{count} 条',
      'view.refresh': '刷新',
      'view.searchPlaceholder': '搜索标签或内容',
      'view.searchEmpty': '没有匹配的记忆',
      'view.searchClear': '清空搜索',
      'view.search': '搜索记忆',
      /* 图钉悬浮提示。注意不能复用 turnMemory.pinned——那个键注册在 TURNS_DEL_NS
         命名空间（turnsDelZh/En），本视图的 t 绑定 SESSION_MEMORY_NS，取不到会原样
         回显键名。故此处自带一份。 */
      'view.pinnedTip': '固定召回的记忆',
      'view.newRecallTip': '本轮新召回的记忆',
      'view.newRecallCount': '其中本轮新召回 {count} 条',
      /* 段位徽标：显示在记忆项目右侧。固定召回不显示段位（已有图钉图标表达）。
         文案与「记忆召回设置」里的四段命名保持一致（段1 底色 / 段2 临时 / 段3 混合 / 段4 兜底）。 */
      'view.segmentBottom': '段 1 底色',
      'view.segmentEphemeral': '段 2 临时',
      'view.segmentMixed': '段 3 混合',
      'view.segmentFallback': '段 4 兜底',
      'view.segmentTip': '该轮召回竞争中所属的段位',
      /* 自动注入的四段构成（图表下方居中一行）：前缀 + 「[ 段 N 名称 ] M 条」重复。 */
      'view.segmentBreakdown': '自动注入构成：',
      'view.segmentCount': '{count} 条'
    };
    const sessionMemoryEn = {
      'view.label': 'Memory',
      'view.title': 'Memory injection snapshot for the current session',
      'view.loading': 'Loading memory…',
      'view.failed': 'Failed to load memory. Please retry.',
      'view.empty': 'No memory has been injected into this session yet.',
      'view.sectionPinned': 'Pinned',
      'view.sectionPinnedHint': 'Memories pinned into the latest context',
      'view.sectionManual': 'Manual',
      'view.sectionManualHint': 'Memories you injected into the current session by hand',
      'view.sectionAuto': 'Automatic',
      'view.sectionAutoHint': 'Memories recalled automatically for the latest turn',
      'view.turnBadge': 'Turn {turn}',
      'view.turnBadgeLatest': 'Turn {turn} (latest)',
      'view.legendPinned': 'Pinned {count} · {percent}%',
      'view.legendAuto': 'Automatic {count} · {percent}%',
      'view.pieLabel': 'This turn: pinned {pinnedPercent}%, automatic {autoPercent}%',
      'view.count': '{count}',
      'view.refresh': 'Refresh',
      'view.searchPlaceholder': 'Search tags or content',
      'view.searchEmpty': 'No matching memory',
      'view.searchClear': 'Clear search',
      'view.search': 'Search memory',
      'view.pinnedTip': 'Pinned memory',
      'view.newRecallTip': 'Newly recalled this turn',
      'view.newRecallCount': '{count} newly recalled this turn',
      'view.segmentBottom': 'Segment 1 base',
      'view.segmentEphemeral': 'Segment 2 temporary',
      'view.segmentMixed': 'Segment 3 mixed',
      'view.segmentFallback': 'Segment 4 fallback',
      'view.segmentTip': 'Segment this memory won in the latest recall',
      'view.segmentBreakdown': 'Injected segments: ',
      'view.segmentCount': '{count}'
    };
    const turnsDelEn = {
      'action.del': 'Delete from this turn onward',
      'action.busy': 'Turns cannot be deleted while the task is running',
      'dialog.title': 'Delete from this turn onward?',
      'dialog.description': 'This removes this turn and every later turn, including their prompts, responses, and tool records, from this Session and future model context. It does not delete the Session.',
      'dialog.cancel': 'Cancel',
      'dialog.confirm': 'Delete through latest turn',
      'dialog.deleting': 'Deleting…',
      'error.busy': 'Wait for the task to finish before deleting.',
      'error.compacted': 'The selected or a later turn is compacted, mixed, or overlaps an existing deleted range and cannot be safely deleted.',
      'error.unavailable': 'This turn changed, no longer exists, or was already deleted.',
      'error.generic': 'Could not delete the turns. Try again.',
      'regenerate.action': 'Regenerate',
      'regenerate.busy': 'Cannot regenerate while the task or queued input is active',
      'regenerate.failed': 'Could not regenerate. Try again.',
      'regenerate.queue': 'Wait for queued input to finish before regenerating.',
      'regenerate.prompt': 'This turn has no safe text-only user prompt that can be sent again.',
      'regenerate.ambiguous': 'This turn has multiple user prompts, so the one to resend is unclear. Use the button on the prompt row you want.',
      'regenerate.unsupported': 'This turn\'s prompt contains attachments or non-text content and cannot be resent safely.',
      'regenerate.unclosed': 'This turn has not been finalized yet (it may have just been stopped). Please retry shortly.',
      'edit.action': 'Edit and regenerate',
      'edit.title': 'Edit user message and regenerate',
      'edit.placeholder': 'Edit user message',
      'edit.confirm': 'Save and regenerate',
      'edit.empty': 'Message cannot be empty',
      'edit.failed': 'Could not edit and regenerate. Try again.',
      'distill.action': 'Distill this turn',
      'distill.busy': 'Cannot distill while the task or queued input is active',
      'distill.done': 'Distilled',
      'distill.failed': 'Could not distill this turn. Try again.',
      'distill.skipped': 'Distillation skipped: {reason}',
      'distill.reason.no-user-transcript': 'No usable user transcript',
      'distill.reason.transcript-too-short': 'Transcript is too short',
      'distill.reason.no-route': 'No usable model route',
      'distill.reason.no-usable-output': 'The model produced no usable memory',
      'turnMemory.action': 'Memory',
      'turnMemory.tip': 'Memory snapshot for this turn context',
      'turnMemory.title': 'Memory snapshot for this turn context',
      'turnMemory.empty': 'No memories were injected in this turn context',
      'turnMemory.failed': 'Could not load memories for this turn. Try again.',
      'turnMemory.count': '{count}',
      'turnMemory.search': 'Search memories',
      'turnMemory.searchPlaceholder': 'Search tags or content',
      'turnMemory.searchClear': 'Clear search',
      'turnMemory.searchEmpty': 'No matching memories',
      'turnMemory.countFiltered': 'Showing {shown} / {total}',
      'turnMemory.pinned': 'Pinned memory',
      'turnMemory.newRecall': 'Newly recalled this turn',
      'turnMemory.pinnedSearch': 'pinned'
    };

    const request = async (route, sessionId) => {
      const response = await fetch(route, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) throw new Error(data.error?.code || data.error || `HTTP ${response.status}`);
    };

    const useTopicLayoutEffect = react.useLayoutEffect;

    function FolderIcon() {
      return react.createElement(primitives.IconFolderOpenOutlineRegular, { size: 16 });
    }
    function DeleteIcon() {
      return react.createElement(primitives.IconTrashOutlineRegular, { size: 16 });
    }
    function ExportIcon() {
      return react.createElement(primitives.IconDownloadOutlineRegular, { size: 16 });
    }
    function ArchiveIcon({ size = 16 } = {}) {
      return react.createElement(primitives.IconArchiveOutlineRegular, { size });
    }
    function StatsIcon() {
      return react.createElement(primitives.IconDataOutlineRegular, { size: 16 });
    }
    function CompactionIcon({ size = 16 }) {
      return react.createElement('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.35,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true'
      },
        react.createElement('path', { d: 'M10.95 2.05a3.25 3.25 0 0 0-4.42 4.42L2.6 10.4a1.55 1.55 0 0 0 0 2.19l.81.81a1.55 1.55 0 0 0 2.19 0l3.93-3.93a3.25 3.25 0 0 0 4.42-4.42l-2.06 2.06-2.13-.53-.53-2.13 2.12-2.4Z' })
      );
    }
    function GlobalPromptIcon() {
      return react.createElement(primitives.IconEditOutlineRegular, { size: 16 });
    }
    function FileDoneOutlined({ size = 16, className } = {}) {
      return react.createElement('svg', {
        width: size,
        height: size,
        className,
        viewBox: '64 64 896 896',
        fill: 'currentColor',
        focusable: 'false',
        'aria-hidden': 'true'
      }, react.createElement('path', { d: 'M688 312v-48c0-4.4-3.6-8-8-8H296c-4.4 0-8 3.6-8 8v48c0 4.4 3.6 8 8 8h384c4.4 0 8-3.6 8-8zm-392 88c-4.4 0-8 3.6-8 8v48c0 4.4 3.6 8 8 8h184c4.4 0 8-3.6 8-8v-48c0-4.4-3.6-8-8-8H296zm376 116c-119.3 0-216 96.7-216 216s96.7 216 216 216 216-96.7 216-216-96.7-216-216-216zm107.5 323.5C750.8 868.2 712.6 884 672 884s-78.8-15.8-107.5-44.5C535.8 810.8 520 772.6 520 732s15.8-78.8 44.5-107.5C593.2 595.8 631.4 580 672 580s78.8 15.8 107.5 44.5C808.2 653.2 824 691.4 824 732s-15.8 78.8-44.5 107.5zM761 656h-44.3c-2.6 0-5 1.2-6.5 3.3l-63.5 87.8-23.1-31.9a7.92 7.92 0 00-6.5-3.3H573c-6.5 0-10.3 7.4-6.5 12.7l73.8 102.1c3.2 4.4 9.7 4.4 12.9 0l114.2-158c3.9-5.3.1-12.7-6.4-12.7zM440 852H208V148h560v344c0 4.4 3.6 8 8 8h56c4.4 0 8-3.6 8-8V108c0-17.7-14.3-32-32-32H168c-17.7 0-32 14.3-32 32v784c0 17.7 14.3 32 32 32h272c4.4 0 8-3.6 8-8v-56c0-4.4-3.6-8-8-8z' }));
    }
    function MemoryIcon({ size = 16, className } = {}) {
      return react.createElement(FileDoneOutlined, { size, className });
    }
    function TaskIcon({ size = 16 }) {
      return react.createElement(primitives.IconListPenOutlineRegular, { size });
    }
    function BranchIcon() {
      return react.createElement(primitives.IconBranchOutlineRegular, { size: 16 });
    }
    function RenameIcon() {
      return react.createElement(primitives.IconEditOutlineRegular, { size: 16 });
    }
    function DurationClockIcon({ size = 14 }) {
      return react.createElement('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.25,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true'
      },
        react.createElement('circle', { cx: 8, cy: 8, r: 5.25 }),
        react.createElement('path', { d: 'M8 4.75V8l2.25 1.5' })
      );
    }

    /* 「修复会话」图标：时钟（修复=回到某个时间点的会话状态）。 */
    function RepairSessionIcon({ size = 16 } = {}) {
      return react.createElement('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.35,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true'
      },
        react.createElement('circle', { cx: 8, cy: 8, r: 5.25 }),
        react.createElement('path', { d: 'M8 4.75V8l2.25 1.5' })
      );
    }

    function DistillHourglassIcon({ size = 16 }) {
      return react.createElement('svg', {
        className: 'dsh-session-kit-distill-hourglass',
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.35,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true'
      },
        react.createElement('path', { d: 'M4.75 2.25h6.5M4.75 13.75h6.5M5.25 2.75c0 2.65 1.55 3.72 2.75 5.25-1.2 1.53-2.75 2.6-2.75 5.25M10.75 2.75c0 2.65-1.55 3.72-2.75 5.25 1.2 1.53 2.75 2.6 2.75 5.25' }),
        react.createElement('path', { className: 'dsh-session-kit-distill-hourglass-sand', d: 'M6.35 4.65h3.3M6.65 11.35h2.7' })
      );
    }

    async function archiveRequest(route, body = {}) {
      const response = await fetch(route, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) throw new Error(data.error?.code || data.error || `HTTP ${response.status}`);
      return data.value;
    }

    async function sidebarEntriesRequest(method, value) {
      const response = await fetch(SIDEBAR_ENTRIES_ROUTE, {
        method,
        ...(method === 'POST' ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) } : {})
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) throw new Error(data.error?.code || data.error || `HTTP ${response.status}`);
      return data.value;
    }

    /* 任务自动注入开关：GET 读值，POST 写值（{ enabled }）。 */
    async function taskAutoInjectRequest(method, value) {
      const response = await fetch(TASK_AUTO_INJECT_ROUTE, {
        method,
        ...(method === 'POST' ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) } : {})
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) throw new Error(data.error?.code || data.error || `HTTP ${response.status}`);
      return data.value;
    }

    /* 会话ID匹配前的归一化：剥掉可选的 "session-" 前缀并转小写。
       该前缀不携带定位信息（库存中 136/144 条带、8 条不带），剥掉后两种写法可互相匹配；
       注意它在旧格式里是公共前缀，绝不能参与前缀/子串匹配。 */
    function normalizedSessionId(sessionId) {
      const id = String(sessionId ?? '').trim().toLocaleLowerCase();
      return id.startsWith('session-') ? id.slice(8) : id;
    }

    /* 归档列表展示用的短会话ID：取最后一段并截断 8 位。
       与 host 侧 archivedHeaderTitle 的 "Session xxxxxxxx" 兜底命名同口径——
       旧格式 "session-<uuid>" 若直接截前 8 位会一律得到 "session-"，完全无法区分。 */
    function shortArchiveSessionId(sessionId) {
      const id = String(sessionId ?? '');
      if (id === '') return '';
      const tail = id.slice(id.lastIndexOf('-') + 1);
      return (tail.length >= 8 ? tail : id).slice(0, 8);
    }

    function formatArchiveTime(value) {
      const time = Number(value);
      if (!Number.isFinite(time) || time <= 0) return '';
      const date = new Date(time);
      if (!Number.isFinite(date.getTime())) return '';
      return date.toLocaleString();
    }

    function formatActivityClockTime(value) {
      const time = Number(value);
      if (!Number.isFinite(time) || time <= 0) return '';
      const date = new Date(time);
      if (!Number.isFinite(date.getTime())) return '';
      return date.toLocaleTimeString();
    }

    /* 进行中活动已耗时：由 startedAt 起算到当前时刻；nowTick 仅用于触发重算，
       不参与计算本身（避免计时器节流导致的累计误差）。 */
    function memoryActivityElapsedText(t, startedAt, nowTick) {
      void nowTick;
      const start = Number(startedAt);
      if (!Number.isFinite(start) || start <= 0) return '-';
      const totalSeconds = Math.max(0, Math.floor((Date.now() - start) / 1000));
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      if (hours > 0) return t('memoryActivityDurationHours').replace('{h}', String(hours)).replace('{m}', String(minutes));
      if (minutes > 0) return t('memoryActivityDurationMinutes').replace('{m}', String(minutes)).replace('{s}', String(seconds));
      return t('memoryActivityDurationSeconds').replace('{s}', String(seconds));
    }

    function archivePreviewRole(t, role) {
      if (role === 'user') return t('archiveRoleUser');
      if (role === 'assistant') return t('archiveRoleAssistant');
      return t('archiveRoleTool');
    }

    function archivePreviewMarkdownLabels(t) {
      return {
        code: {
          copyLabel: t('archivePreviewCopy'),
          copiedLabel: t('archivePreviewCopied')
        },
        footnotes: t('archivePreviewFootnotes')
      };
    }

    class ArchivePreviewRenderBoundary extends react.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error };
      }
      componentDidCatch(error) {
        globalThis.console?.error?.('[dsh-session-kit] archive preview render failed', error);
      }
      componentDidUpdate(prevProps) {
        if (prevProps.resetKey !== this.props.resetKey && this.state.error !== null) this.setState({ error: null });
      }
      render() {
        if (this.state.error !== null) return react.createElement('pre', { className: 'dsh-session-kit-preview-plain' }, String(this.props.fallbackText || ''));
        return this.props.children;
      }
    }

    function useDebouncedValue(value, delay) {
      const [debounced, setDebounced] = react.useState(value);
      react.useEffect(() => {
        const id = window.setTimeout(() => setDebounced(value), delay);
        return () => window.clearTimeout(id);
      }, [value, delay]);
      return debounced;
    }

    function normalizeToolCalls(value) {
      return Array.isArray(value) ? value.map((entry) => ({
        name: typeof entry?.name === 'string' && entry.name.trim() ? entry.name.trim() : 'unknown',
        count: Number.isFinite(Number(entry?.count)) ? Number(entry.count) : 0,
        success: Number.isFinite(Number(entry?.success)) ? Number(entry.success) : 0,
        failed: Number.isFinite(Number(entry?.failed)) ? Number(entry.failed) : 0,
        pending: Number.isFinite(Number(entry?.pending)) ? Number(entry.pending) : 0
      })).filter((entry) => entry.count > 0) : [];
    }

    function memoryArrays(value) {
      return Array.isArray(value) ? value : [];
    }

    function memoryStringArray(value) {
      return memoryArrays(value).map((item) => String(item || '').trim()).filter(Boolean);
    }

    function memoryUrl(sessionId) {
      return sessionId ? `${MEMORY_ROUTE}?sessionId=${encodeURIComponent(String(sessionId))}` : MEMORY_ROUTE;
    }

    async function memoryFetchSnapshot(sessionId) {
      const response = await fetch(memoryUrl(sessionId));
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) throw new Error(data.error?.code || data.error || `HTTP ${response.status}`);
      return data.value || {};
    }

    async function memoryActivityFetch(view, limit = 50, before) {
      const params = new URLSearchParams({ view, limit: String(limit) });
      if (before !== undefined && before !== null) params.set('before', String(before));
      const response = await fetch(`/dsh-session-kit/memory/activity?${params.toString()}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) throw new Error(data.error?.code || data.error || `HTTP ${response.status}`);
      return data.value || { items: [], hasMore: false, nextBefore: null };
    }

    async function memoryUsageOverviewFetch(sessionId) {
      const value = await memoryPostAction(sessionId, { action: 'usage-overview' });
      return value && typeof value === 'object' ? value : null;
    }

    function memoryActivityBadgeClass(status) {
      if (status === 'running') return ' dsh-session-kit-memory-activity-badge-running';
      if (status === 'success') return ' dsh-session-kit-memory-activity-badge-success';
      if (status === 'failed') return ' dsh-session-kit-memory-activity-badge-failed';
      return '';
    }

    /* ── memory_update 日志的差异解析与渲染 ──
       宿主端只在「正文真的变了」时把 summary 写成带标记的 JSON；
       其余情况（纯文本、旧记录、其他 kind）解析失败即按原文本渲染，天然兼容。 */
    const MEMORY_DIFF_FLAG = '__dshSessionKitDiff';

    function readActivitySummary(summary) {
      const raw = typeof summary === 'string' ? summary : '';
      if (raw === '' || raw.charCodeAt(0) !== 123 /* '{' */) return { text: raw, diff: null };
      try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object' || parsed[MEMORY_DIFF_FLAG] !== 1) return { text: raw, diff: null };
        const before = typeof parsed.before?.text === 'string' ? parsed.before.text : '';
        const after = typeof parsed.after?.text === 'string' ? parsed.after.text : '';
        return { text: after, diff: { before, after, fields: Array.isArray(parsed.fields) ? parsed.fields : [] } };
      } catch {
        return { text: raw, diff: null };
      }
    }

    /* 通用 LCS 差异：对任意「条目序列」求最短编辑脚本。
       调用方用 keyOf 把条目映射成比较键（行/句都直接比文本），
       超过阈值时退化为「整体替换」，避免超长输入拖慢渲染。 */
    function lcsDiff(beforeItems, afterItems, keyOf, maxItems) {
      const key = typeof keyOf === 'function' ? keyOf : (item) => item;
      if (beforeItems.length > maxItems || afterItems.length > maxItems) {
        return [
          ...beforeItems.map((item) => ({ type: 'removed', text: item })),
          ...afterItems.map((item) => ({ type: 'added', text: item }))
        ];
      }
      const n = beforeItems.length;
      const m = afterItems.length;
      /* lcs[i][j] = beforeItems[i..] 与 afterItems[j..] 的最长公共子序列长度 */
      const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
      for (let i = n - 1; i >= 0; i -= 1) {
        for (let j = m - 1; j >= 0; j -= 1) {
          lcs[i][j] = key(beforeItems[i]) === key(afterItems[j])
            ? lcs[i + 1][j + 1] + 1
            : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
        }
      }
      const rows = [];
      let i = 0;
      let j = 0;
      while (i < n && j < m) {
        if (key(beforeItems[i]) === key(afterItems[j])) { rows.push({ type: 'same', text: beforeItems[i] }); i += 1; j += 1; }
        else if (lcs[i + 1][j] >= lcs[i][j + 1]) { rows.push({ type: 'removed', text: beforeItems[i] }); i += 1; }
        else { rows.push({ type: 'added', text: afterItems[j] }); j += 1; }
      }
      while (i < n) { rows.push({ type: 'removed', text: beforeItems[i] }); i += 1; }
      while (j < m) { rows.push({ type: 'added', text: afterItems[j] }); j += 1; }
      return rows;
    }

    /* 行级差异：记忆正文通常几十行，O(n·m) 完全够用。 */
    const MEMORY_DIFF_MAX_LINES = 400;
    function memoryLineDiff(beforeText, afterText) {
      return lcsDiff(String(beforeText).split('\n'), String(afterText).split('\n'), undefined, MEMORY_DIFF_MAX_LINES);
    }

    /* ── 段级（句子级）差异 ──
       记忆正文的 JSON 结构体里，「内容」「踩坑」两个长文本字段各自独占一整行
       （JSON.stringify(body, null, 2) 只缩进结构、不缩进值），行级 diff 会把这
       一整行当原子，改两个字就整行变色。故对行级配对出的 removed/added 行对
       再做一次段级 diff，把粒度降到「句」。
       切分标点：中英文逗号、句号、分号、感叹号、问号；标点归入前一段，
       避免标点自己变成一段而在 diff 里乱跑。 */
    const MEMORY_DIFF_SEGMENT_BREAK = /[，。；！？,.;!?]/;
    const MEMORY_DIFF_MAX_SEGMENTS = 600;
    function splitDiffSegments(text) {
      const raw = String(text);
      if (raw === '') return [''];
      const segments = [];
      let buffer = '';
      for (const ch of raw) {
        buffer += ch;
        if (MEMORY_DIFF_SEGMENT_BREAK.test(ch)) { segments.push(buffer); buffer = ''; }
      }
      if (buffer !== '') segments.push(buffer);
      return segments.length > 0 ? segments : [''];
    }

    /* 段级 diff：只对行级判为 changed 的行对调用（same 行必然全 same，白算）。 */
    function memorySegmentDiff(beforeText, afterText) {
      return lcsDiff(splitDiffSegments(beforeText), splitDiffSegments(afterText), undefined, MEMORY_DIFF_MAX_SEGMENTS);
    }

    /* 把行级结果里「相邻的 removed 块 + 紧随的 added 块」配对，逐对做段级 diff。
       配不上的（纯删或纯加）保持整行状态；行数不等时按序号一一配对，多出的不配对。 */
    function refineLineDiffWithSegments(rows) {
      const out = [];
      let index = 0;
      while (index < rows.length) {
        if (rows[index].type === 'same') { out.push(rows[index]); index += 1; continue; }
        const removed = [];
        const added = [];
        while (index < rows.length && rows[index].type === 'removed') { removed.push(rows[index]); index += 1; }
        while (index < rows.length && rows[index].type === 'added') { added.push(rows[index]); index += 1; }
        if (removed.length === 0 || added.length === 0) {
          /* 纯删或纯加：保持原样 */
          for (const row of removed) out.push(row);
          for (const row of added) out.push(row);
          continue;
        }
        const pairs = Math.min(removed.length, added.length);
        for (let k = 0; k < pairs; k += 1) {
          const segments = memorySegmentDiff(removed[k].text, added[k].text);
          const hasChangedSegment = segments.some((seg) => seg.type !== 'same');
          if (hasChangedSegment) {
            /* 段级结果作为「行内片段」挂在行对象上，供渲染层做行内高亮 */
            out.push({ type: 'changed', before: removed[k].text, after: added[k].text, segments });
          } else {
            /* 段级判定无差异（行不同但段全同，例如仅有换行差异）：退回删+加两行，避免静默吞掉内容。 */
            out.push(removed[k]);
            out.push(added[k]);
          }
        }
        for (let k = pairs; k < removed.length; k += 1) out.push(removed[k]);
        for (let k = pairs; k < added.length; k += 1) out.push(added[k]);
      }
      return out;
    }

    /* 元数据变化（状态/固定/项目/标签）文案化。 */
    function memoryDiffFieldLines(t, fields) {
      const lines = [];
      for (const field of Array.isArray(fields) ? fields : []) {
        if (field?.key === 'status') {
          const label = (value) => (value === 'active' ? t('memoryActivityDiffActive') : t('memoryActivityDiffInactive'));
          lines.push(`${t('memoryActivityDiffFieldStatus')}：${label(field.before)} → ${label(field.after)}`);
        } else if (field?.key === 'pinned') {
          const label = (value) => (value === true ? t('memoryActivityDiffOn') : t('memoryActivityDiffOff'));
          lines.push(`${t('memoryActivityDiffFieldPinned')}：${label(field.before)} → ${label(field.after)}`);
        } else if (field?.key === 'directory') {
          const label = (value) => (value ? String(value) : t('memoryActivityDiffNoneValue'));
          lines.push(`${t('memoryActivityDiffFieldDirectory')}：${label(field.before)} → ${label(field.after)}`);
        } else if (field?.key === 'tags') {
          const parts = [];
          if (Array.isArray(field.added) && field.added.length > 0) parts.push(`+${field.added.join('、')}`);
          if (Array.isArray(field.removed) && field.removed.length > 0) parts.push(`-${field.removed.join('、')}`);
          if (parts.length > 0) lines.push(`${t('memoryActivityDiffFieldTags')}：${parts.join(' ')}`);
        }
      }
      return lines;
    }

    /* 行内片段渲染：changed 行的 segments 里，same 段按普通文本、removed/added 段套高亮。
       removed 段用删除线 + 红底，added 段用绿底；标点已归入前段，故不会出现孤立的标点片段。 */
    function renderDiffSegments(segments) {
      const nodes = [];
      segments.forEach((segment, index) => {
        if (segment.type === 'same') {
          nodes.push(segment.text === '' ? null : segment.text);
          return;
        }
        nodes.push(react.createElement('span', {
          key: `seg-${segment.type}-${index}`,
          className: `dsh-session-kit-memory-diff-seg dsh-session-kit-memory-diff-seg-${segment.type}`
        }, segment.text === '' ? '\u00a0' : segment.text));
      });
      return nodes.filter((node) => node !== null);
    }

    /* 浮层里的差异块：红绿行级 diff + 元数据变化清单。 */
    function MemoryActivityDiff({ diff, t }) {
      const rows = refineLineDiffWithSegments(memoryLineDiff(diff.before, diff.after));
      const fieldLines = memoryDiffFieldLines(t, diff.fields);
      const hasTextChange = diff.before !== diff.after;
      return react.createElement('div', { className: 'dsh-session-kit-memory-diff' },
        hasTextChange
          ? react.createElement('div', { className: 'dsh-session-kit-memory-diff-block' },
            react.createElement('div', { className: 'dsh-session-kit-memory-diff-title' }, `${t('memoryActivityDiffBefore')} → ${t('memoryActivityDiffAfter')}`),
            react.createElement('div', { className: 'dsh-session-kit-memory-diff-body' }, rows.map((row, index) => {
              /* changed 行：单行内展示「旧段删除 + 新段新增」，行内高亮到句。 */
              if (row.type === 'changed') {
                return react.createElement('div', {
                  key: `changed-${index}`,
                  className: 'dsh-session-kit-memory-diff-line dsh-session-kit-memory-diff-line-changed'
                }, react.createElement('span', { className: 'dsh-session-kit-memory-diff-sign' }, '~'),
                react.createElement('span', { className: 'dsh-session-kit-memory-diff-inline' },
                  renderDiffSegments(row.segments)));
              }
              return react.createElement('div', {
                key: `${row.type}-${index}`,
                className: `dsh-session-kit-memory-diff-line dsh-session-kit-memory-diff-line-${row.type}`
              }, react.createElement('span', { className: 'dsh-session-kit-memory-diff-sign' }, row.type === 'added' ? '+' : row.type === 'removed' ? '-' : ' '), row.text === '' ? '\u00a0' : row.text);
            }))
          )
          : react.createElement('div', { className: 'dsh-session-kit-memory-diff-title' }, t('memoryActivityDiffNone')),
        fieldLines.length > 0
          ? react.createElement('div', { className: 'dsh-session-kit-memory-diff-fields' },
            react.createElement('div', { className: 'dsh-session-kit-memory-diff-title' }, t('memoryActivityDiffFields')),
            fieldLines.map((line, index) => react.createElement('div', { key: `field-${index}`, className: 'dsh-session-kit-memory-diff-field' }, line)))
          : null
      );
    }

    /* 日志摘要：列表按两行省略，悬浮显示完整内容。
       原生 title 无法承载长文本与换行，故用自定义浮层；浮层位置按视口钳制，避免贴边溢出。
       收起带 140ms 延迟：指针从摘要移向浮层会经过间隙，若无延迟会立刻隐藏而无法阅读长文。 */
    function MemoryActivitySummary({ text, className, diff, t }) {
      const [hover, setHover] = react.useState(false);
      const [truncated, setTruncated] = react.useState(false);
      const [position, setPosition] = react.useState(null);
      const anchorRef = react.useRef(null);
      const hideTimer = react.useRef(0);
      /* 差异对象可能是 undefined（调用方未传）；只有真拿到 before/after 才算有差异。 */
      const hasDiff = diff !== null && diff !== undefined;
      /* 有差异记录时，即便正文没被截断也允许悬浮（差异只在浮层里看）。 */
      const hoverable = truncated || hasDiff;
      react.useLayoutEffect(() => {
        const anchor = anchorRef.current;
        if (!(anchor instanceof HTMLElement)) return undefined;
        const measure = () => {
          const next = anchor.scrollHeight > anchor.clientHeight + 1 || anchor.scrollWidth > anchor.clientWidth + 1;
          setTruncated(next);
          /* 无差异记录且未截断时才收起浮层；有差异时正文未截断也要保留悬浮入口。 */
          if (!next && !hasDiff) {
            window.clearTimeout(hideTimer.current);
            setHover(false);
            setPosition(null);
          }
        };
        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
      }, [text, diff]);      const show = () => {
        if (!hoverable) return;
        window.clearTimeout(hideTimer.current);
        setHover(true);
      };
      const scheduleHide = () => {
        window.clearTimeout(hideTimer.current);
        hideTimer.current = window.setTimeout(() => { setHover(false); setPosition(null); }, 140);
      };
      react.useEffect(() => () => window.clearTimeout(hideTimer.current), []);
      react.useEffect(() => {
        if (!hover) return undefined;
        const place = () => {
          const anchor = anchorRef.current;
          if (!(anchor instanceof HTMLElement)) return;
          const rect = anchor.getBoundingClientRect();
          const width = Math.min(window.innerWidth * 0.5, Math.max(0, window.innerWidth - 24));
          const left = Math.max(12, (window.innerWidth - width) / 2);
          const below = rect.bottom + 8;
          setPosition({ left, top: below, width, maxHeight: Math.max(120, window.innerHeight - below - 12) });
        };
        place();
        window.addEventListener('scroll', place, true);
        window.addEventListener('resize', place);
        return () => {
          window.removeEventListener('scroll', place, true);
          window.removeEventListener('resize', place);
        };
      }, [hover]);
      /* 键盘聚焦给出与悬浮一致的提示，保持可访问性。 */
      return react.createElement('div', { className: `${className ?? ''} dsh-session-kit-memory-activity-summary-wrap`.trim() },
        react.createElement('div', {
          ref: anchorRef,
          className: 'dsh-session-kit-memory-activity-summary dsh-session-kit-memory-activity-summary-clamp',
          tabIndex: 0,
          onPointerEnter: show,
          onPointerLeave: scheduleHide,
          onFocus: show,
          onBlur: scheduleHide,
          'aria-describedby': hoverable ? 'dsh-session-kit-memory-activity-summary-tooltip' : undefined,
          style: hoverable ? undefined : { cursor: 'default' }
        }, text),
        hover && hoverable && position !== null
          ? reactDom.createPortal(react.createElement('div', {
            className: `dsh-session-kit-memory-activity-summary-popup${hasDiff ? ' dsh-session-kit-memory-activity-summary-popup-diff' : ''}`,
            id: 'dsh-session-kit-memory-activity-summary-tooltip',
            role: 'tooltip',
            onPointerEnter: show,
            onPointerLeave: scheduleHide,
            style: { left: `${position.left}px`, top: `${position.top}px`, width: `${position.width}px`, maxHeight: `${position.maxHeight}px` }
          }, hasDiff ? react.createElement(MemoryActivityDiff, { diff, t }) : text), document.body)
          : null
      );
    }

    const USAGE_PIE_COLORS = ['#4e7cff', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6', '#e879f9', '#94a3b8'];

    /* 记忆用量环形图：SVG stroke-dasharray 分段，无第三方图表依赖 */
    function UsageDonut({ entries }) {
      const total = entries.reduce((sum, entry) => sum + entry.value, 0);
      if (!(total > 0)) return null;
      const segments = [];
      let accumulated = 0;
      for (const entry of entries) {
        const share = entry.value / total * 100;
        segments.push({ color: entry.color, dash: `${share} ${100 - share}`, offset: 25 - accumulated });
        accumulated += share;
      }
      return react.createElement('svg', { viewBox: '0 0 42 42', className: 'dsh-session-kit-memory-usage-donut', role: 'img' },
        react.createElement('circle', { cx: 21, cy: 21, r: 15.9155, fill: 'none', stroke: 'var(--dsw-alias-interactive-bg-hover)', strokeWidth: 7 }),
        segments.map((segment, index) => react.createElement('circle', {
          key: index,
          cx: 21,
          cy: 21,
          r: 15.9155,
          fill: 'none',
          stroke: segment.color,
          strokeWidth: 7,
          strokeDasharray: segment.dash,
          strokeDashoffset: segment.offset
        }))
      );
    }
    function memoryActivityKindLabel(t, item) {
      const kind = String(item?.kind || '');
      if (kind === 'embedding_backfill') return t('memoryActivityKind_embedding_backfill') || kind;
      const isMemoryKind = kind === 'memory_add' || kind === 'memory_update' || kind === 'memory_delete' || kind === 'memory_revision_delete' || kind === 'memory_conflict_missed' || kind === 'directory_create' || kind === 'directory_update' || kind === 'directory_delete' || kind === 'tag_create' || kind === 'tag_update' || kind === 'tag_delete';
      const manualName = isMemoryKind ? t(`memoryActivityKind_${kind}`) || '' : '';
      if (item?.triggerKind === 'tool') return `${kind}${manualName ? ` ${manualName}` : ''}`;
      if (manualName) return manualName;
      if (kind === 'distill') {
        const trigger = item?.triggerKind === 'auto' ? '_auto' : '_manual';
        return t(`memoryActivityKind_${kind}${trigger}`) || t('memoryActivityKind_distill') || kind || '-';
      }
      return kind || '-';
    }

    async function memoryPostAction(sessionId, payload) {
      const response = await fetch(MEMORY_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, ...payload })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) throw new Error(data.error?.code || data.error?.message || data.error || `HTTP ${response.status}`);
      return data.value || {};
    }

    /* ── 任务档案 HTTP 客户端 ── */

    async function taskFetch(params) {
      const query = new URLSearchParams(params).toString();
      const response = await fetch(`${TASK_ROUTE}?${query}`, { method: 'GET' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) throw new Error(data.error || `HTTP ${response.status}`);
      return data.value || {};
    }

    /* 任务路由 POST（createTask/deleteTask/restoreTask/purgeTask/purgeTrash 等）。 */
    async function taskPost(body) {
      const response = await fetch(TASK_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) throw new Error(data.error || `HTTP ${response.status}`);
      return data.value || {};
    }

    /* 返回 { tasks, total }：total 为当前筛选（状态 + 搜索）下的全库命中总数。 */
    async function taskListPage(params) {
      const value = await taskFetch({ action: 'list', ...params });
      const tasks = Array.isArray(value.tasks) ? value.tasks : [];
      return { tasks, total: Number.isFinite(Number(value.total)) ? Number(value.total) : tasks.length };
    }

    /* 任务搜索的关联会话匹配：关键词按会话名称（包含，大小写不敏感）或会话ID
       （剥掉新旧格式的 session- 前缀后全等——旧格式的公共前缀会让任何部分输入
       命中整库，故只认全量）命中会话，把命中的会话ID随 keyword 交给服务端按
       task_sessions 关联过滤任务。titleMap 为 会话ID → 显示标题（客户端会话快照，
       含归档）。标题不在客户端快照里的会话（如冷会话）搜不到，属已知边界。 */
    function taskSearchSessionIds(titleMap, keyword) {
      const normalizedKeyword = String(keyword ?? '').trim().toLocaleLowerCase();
      if (normalizedKeyword === '' || titleMap === null || typeof titleMap !== 'object') return [];
      const keywordId = normalizedSessionId(normalizedKeyword);
      const ids = [];
      for (const [id, entry] of Object.entries(titleMap)) {
        /* 快照值是会话对象（displayTitle）也可能已是标题字符串，两种形态都认。 */
        const title = typeof entry === 'string' ? entry : String(entry?.displayTitle ?? '');
        const normalizedId = normalizedSessionId(id);
        const matched = (normalizedId !== '' && normalizedId === keywordId)
          || (title !== '' && title.toLocaleLowerCase().includes(normalizedKeyword));
        if (matched && !ids.includes(id)) ids.push(id);
      }
      return ids.slice(0, 100);
    }

    async function taskList(params) {
      return (await taskListPage(params)).tasks;
    }

    async function taskView(taskId) {
      return taskFetch({ action: 'view', taskId });
    }

    async function taskDetail(taskId, itemId) {
      /* 详情需要上下文变更列表，显式带上 include=context。 */
      return taskFetch({ action: 'detail', taskId, include: 'ops,pitfalls,context', ...(itemId ? { itemId } : {}) });
    }

    function statusKeySuffix(status) {
      return String(status || '').split(/[_\s]+/u).map((part) => part.replace(/^./u, (c) => c.toUpperCase())).join('');
    }

    function taskStatusLabel(t, status) {
      return t(`taskStatus${statusKeySuffix(status)}`) || status || '';
    }

    function taskItemStatusLabel(t, status) {
      return t(`taskItem${statusKeySuffix(status)}`) || status || '';
    }

    function memoryErrorMessage(t, reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      if (message === 'HTTP 404') return '记忆服务未加载，请重启 dsh web 后刷新页面。';
      if (message === 'directory-has-memories') return t('memoryProjectHasMemories');
      if (message === 'preset-tag-readonly') return '默认标签不能删除。';
      if (message === 'default-directory-readonly') return '默认项目不能改名或删除。';
      if (message === 'duplicate-memory') return '已存在相同内容的记忆。';
      if (message === 'invalid-memory-text') return t('memoryInvalidText');
       if (message === 'invalid-memory-json') return t('memoryInvalidJson');
      return message;
    }

    /* 目录选择：按可用性依次尝试，返回绝对路径或 null（用户取消）。
       1) 桌面壳原生选择器：Windows 下由 dsh-plugin-desktop 安装
          window.__DSH_DESKTOP_PICK_DIRECTORY__（走 /_dsh/desktop/pick-directory）；
          macOS 下 preload 暴露 __DSH_DIRECTORY_PICKER__.pick()。
       2) 官方 seam ctx.uiWorkspace.pickDirectory()：仅在组合挂载了 native
          后端时可用；当前组合是 browse 后端，调用会抛
          "needs the native capability"。因此它只能作为兜底，且失败不能
          覆盖前面更可靠通道的结果。
       全部不可用时抛错，由调用方提示用户手动填写路径。 */
    async function pickAnyDirectory(seamPick) {
      const desktopPick = globalThis.__DSH_DESKTOP_PICK_DIRECTORY__;
      if (typeof desktopPick === 'function') return await desktopPick();
      const nativePicker = globalThis.__DSH_DIRECTORY_PICKER__;
      if (nativePicker !== undefined && typeof nativePicker.pick === 'function') return await nativePicker.pick();
      if (typeof seamPick === 'function') return await seamPick();
      throw new Error('NO_DIRECTORY_PICKER');
    }

    function memoryFormatTime(value) {
      const time = Number(value);
      if (!Number.isFinite(time) || time <= 0) return '';
      const date = new Date(time);
      return Number.isFinite(date.getTime()) ? date.toLocaleString() : '';
    }

    /* 事实时间的展示与编辑：一律走【本地】口径。
       ⚠️ 不能用 toISOString()：服务端按本地零点解析 YYYY-MM-DD，若这里按 UTC 渲染，
       东八区会整体回退一天（填 2026-09-29 显示成 2026-09-28）。 */
    function memoryFormatLocalDate(value) {
      const time = Number(value);
      if (!Number.isFinite(time) || time <= 0) return '';
      const date = new Date(time);
      if (!Number.isFinite(date.getTime())) return '';
      const pad = (part) => String(part).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    function memoryFormatLocalClock(value) {
      const time = Number(value);
      if (!Number.isFinite(time) || time <= 0) return '';
      const date = new Date(time);
      if (!Number.isFinite(date.getTime())) return '';
      const pad = (part) => String(part).padStart(2, '0');
      return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    /* 编辑器输入框的回填值：无值 → 空串（与「清除」同形，语义一致）。
       日期与时间分两个输入框承载，故这里各取一段。 */
    function memoryDateInputValue(value) {
      return memoryFormatLocalDate(value);
    }

    function memoryClockInputValue(value) {
      const time = Number(value);
      if (!Number.isFinite(time) || time <= 0) return '';
      const date = new Date(time);
      if (!Number.isFinite(date.getTime())) return '';
      const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
      /* 整日（含 validUntil 的当日末刻）回填成空时间框，避免把内部默认值显示成用户输入。 */
      if (time === start || time === start + 86400000 - 1) return '';
      return memoryFormatLocalClock(time);
    }

    /* 事实时间的编辑校验：日期接受 YYYY-MM-DD 或空；时间接受 HH:MM / HH:MM:SS 或空。
       返回 { ok, value }；前端先挡住非法输入，避免走后端再弹错误。 */
    function memoryValidateDateInput(raw) {
      const text = String(raw ?? '').trim();
      if (text === '') return { ok: true, value: '' };
      const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (match === null) return { ok: false, value: text };
      const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
      const probe = new Date(year, month - 1, day);
      if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) {
        return { ok: false, value: text };
      }
      return { ok: true, value: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
    }

    function memoryValidateClockInput(raw) {
      const text = String(raw ?? '').trim();
      if (text === '') return { ok: true, value: '' };
      const match = text.match(/^(\d{1,2})\s*[:：]\s*(\d{1,2})(?:\s*[:：]\s*(\d{1,2}))?$/);
      if (match === null) return { ok: false, value: text };
      const [hour, minute, second] = [Number(match[1]), Number(match[2]), match[3] === undefined ? 0 : Number(match[3])];
      if (hour > 23 || minute > 59 || second > 59) return { ok: false, value: text };
      const pad = (part) => String(part).padStart(2, '0');
      /* 秒为 0 时省略秒段，保持输入框简洁（14:30 而非 14:30:00）。 */
      return { ok: true, value: second === 0 ? `${pad(hour)}:${pad(minute)}` : `${pad(hour)}:${pad(minute)}:${pad(second)}` };
    }

    /* 日期 + 时间合成一个提交值：时间留空 = 整日（只传日期，服务端按当日零点/末刻处理）。 */
    function memoryCombineFactTime(dateText, clockText) {
      const date = String(dateText ?? '').trim();
      if (date === '') return '';
      const clock = String(clockText ?? '').trim();
      return clock === '' ? date : `${date} ${clock}`;
    }

    function memoryStatusLabel(t, status) {
      return status === 'active' ? t('memoryActivated') : t('memoryDeactivated');
    }

    function memoryCreationMethodLabel(t, method) {
      switch (method) {
        case 'manual': return t('memoryCreationMethodManual');
        case 'auto-distill': return t('memoryCreationMethodAutoDistill');
        case 'manual-distill': return t('memoryCreationMethodManualDistill');
        case 'memory_add': return t('memoryCreationMethodMemoryAdd');
        case 'import': return t('memoryCreationMethodImport');
        default: return t('memoryCreationMethodUnknown');
      }
    }

    function memoryUsageText(t, usage) {
      const total = Number(usage?.totalTokens ?? 0);
      if (!Number.isFinite(total) || total <= 0) return t('memoryDistillUsageUnknown');
      return t(usage?.estimated === true ? 'memoryDistillUsageEstimated' : 'memoryDistillUsage').replace('{total}', String(total));
    }

    function fillTemplate(template, values) {
      return Object.entries(values || {}).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value ?? '')), String(template || ''));
    }

    /* 「检索」说明：词法（FTS5/BM25 或 LIKE）+ 语义（embedding 向量）。
       开启时拼维度+覆盖统计；关闭时若库里有向量数据（宿主端统计不随开关清零），
       仍展示维度/覆盖并追加「未开启」，保留关闭前后的对比信息量；
       完全没有数据（全新库）才退回纯词法文案，避免出现"已向量化 0/0"的噪音。
       维度取配置值；配置留空（0）时退回实测指纹里的维度（形如 model#2048）。 */
    function retrievalModeText(snapshot, t) {
      const lexical = snapshot.ftsMode || (snapshot.ftsEnabled ? 'FTS5 + BM25' : 'LIKE');
      const embedding = snapshot.embedding;
      const configured = Number(embedding?.provider?.dimensions) || 0;
      const detected = Number(String(embedding?.expectedModel ?? '').split('#')[1]) || 0;
      const dim = configured > 0 ? configured : detected;
      const total = Number(embedding?.total) || 0;
      const embedded = Number(embedding?.embedded) || 0;
      const hasStats = dim > 0 || total > 0;
      if (embedding?.enabled !== true) {
        if (!hasStats) return fillTemplate(t('memoryRetrievalLexicalOnly'), { lexical });
        const disabledDetail = [
          dim > 0 ? fillTemplate(t('memoryEmbeddingDim'), { dim }) : '',
          fillTemplate(t('memoryEmbeddingCovered'), { embedded, total }),
          t('memoryEmbeddingDisabled')
        ].filter(Boolean).join(' · ');
        return fillTemplate(t('memoryRetrievalHybrid'), { lexical, detail: disabledDetail });
      }
      const detail = [
        dim > 0 ? fillTemplate(t('memoryEmbeddingDim'), { dim }) : '',
        embedding.backfilling === true
          ? fillTemplate(t('memoryEmbeddingBackfilling'), { embedded, total })
          : fillTemplate(t('memoryEmbeddingCovered'), { embedded, total })
      ].filter(Boolean).join(' · ');
      return fillTemplate(t('memoryRetrievalHybrid'), { lexical, detail });
    }

    function memorySafeArray(value) {
      return Array.isArray(value) ? value : [];
    }

    const MEMORY_PRESET_TAG_ORDER = new Map([
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
    ].map((tag, index) => [tag, index]));

    function memoryTagStatus(tag) {
      return tag?.status === 'inactive' ? 'inactive' : 'active';
    }

    function memoryOrderedTags(value) {
      /* 自定义标签只按名称稳定排序，不按启用状态分组：状态若参与排序，开关一次
         就会把标签挪到另一段（甚至跨页），看起来像「开关触发了重新排序」。
         启用状态由胶囊样式与开关本身表达，位置保持不动。 */
      return [...memorySafeArray(value)].sort((left, right) => {
        const leftPreset = left?.preset === true;
        const rightPreset = right?.preset === true;
        if (leftPreset !== rightPreset) return leftPreset ? -1 : 1;
        if (leftPreset && rightPreset) return (MEMORY_PRESET_TAG_ORDER.get(left?.name) ?? 999) - (MEMORY_PRESET_TAG_ORDER.get(right?.name) ?? 999);
        return String(left?.name || '').localeCompare(String(right?.name || ''), undefined, { sensitivity: 'base' });
      });
    }

    function memoryTime(value) {
      return memoryFormatTime(value) || '-';
    }

    /* 记忆卡片标签 chips：完整显示每个标签（不截断），容器 flex-wrap 自动换行；
       无标签时返回占位符文本。 */
    function memoryTagChips(memory, t, createElement) {
      const tags = memoryStringArray(memory?.tags);
      if (tags.length === 0) return createElement('span', { className: 'dsh-session-kit-memory-meta-tags-empty' }, '-');
      return tags.map((tag) => createElement('span', { key: tag, className: 'dsh-session-kit-memory-meta-tag-chip', title: tag }, tag));
    }

    function memoryCompactTokens(value) {
      const number = Math.round(Number(value));
      if (!Number.isSafeInteger(number) || number < 0) return undefined;
      const scaled = (candidate) => candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10);
      if (number < 1000) return String(number);
      if (number < 1000000) return `${scaled(number / 1000)}K`;
      return `${scaled(number / 1000000)}M`;
    }

    function memoryItemUsageText(memory, t) {
      const usage = memory?.distillUsage;
      if (usage === undefined || usage === null || typeof usage !== 'object') return t('memoryDistillUsageUnknown');
      const total = memoryCompactTokens(usage.totalTokens);
      if (total === undefined) return t('memoryDistillUsageUnknown');
      return fillTemplate(t(usage.estimated === true ? 'memoryDistillUsageEstimated' : 'memoryDistillUsage'), { total });
    }

    /* 固定召回的搜索别名：搜索"固定召回"/"固定记忆"时只返回固定记忆。
       放在 substring 匹配之前：这两个词几乎不会出现在正文里，作为筛选语义更自然；
       其他关键词仍走正文/目录/标签的常规匹配。 */
    const PINNED_SEARCH_ALIASES = new Set(['固定召回', '固定记忆', '固定', 'pinned']);
    function memoryMatches(memory, search) {
      const needle = String(search || '').trim().toLocaleLowerCase();
      if (!needle) return true;
      if (PINNED_SEARCH_ALIASES.has(needle)) return memory?.pinned === true;
      return [
        memory?.text,
        memory?.directoryName,
        memory?.sourceSessionId,
        memory?.sourceSessionTitle,
        ...memoryStringArray(memory?.tags)
      ].filter(Boolean).join('\n').toLocaleLowerCase().includes(needle);
    }

    function memoryEditorNeedsJson(text) {
      /* 只认结构性信号：显式 JSON 开头，或结构化记忆的行前缀字段（行首）。
         不再用关键词猜测（路径/插件/优化/修改/C:\ 之类）——普通句子只要提到
         这些词就会被拦成「必须是结构化 JSON」，导致纯文本记忆无法编辑保存；
         服务端对普通文本本就放行（最多自动转换），无需客户端预拦。 */
      const raw = String(text ?? '').trim();
      return /^[{[]/.test(raw) || /^(位置|对象|内容|踩坑)\s*[：:]/m.test(raw);
    }

    function memoryEditorJsonValid(text) {
      const raw = String(text ?? '').trim();
      if (raw === '') return false;
      try {
        const value = JSON.parse(raw);
        if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
        const field = (...keys) => keys.find((key) => Object.prototype.hasOwnProperty.call(value, key));
        const pathsKey = field('位置', 'paths');
        const symbolsKey = field('对象', 'symbols');
        const contentKey = field('内容', 'content');
        const pitfallKey = field('踩坑', 'pitfall');
        if (pathsKey === undefined || symbolsKey === undefined || contentKey === undefined) return false;
        if (!Array.isArray(value[pathsKey]) || !value[pathsKey].every((item) => typeof item === 'string')) return false;
        if (!Array.isArray(value[symbolsKey]) || !value[symbolsKey].every((item) => typeof item === 'string')) return false;
        if (typeof value[contentKey] !== 'string') return false;
        return pitfallKey === undefined || typeof value[pitfallKey] === 'string';
      } catch {
        return false;
      }
    }

    /* 结构化记忆字段别名与旧的“位置/对象/内容/踩坑”行前缀格式共用同一套键名，
       美化格式只做确定性转换：字段边界必须来自 JSON 结构本身或行前缀，不做猜测。 */
    const MEMORY_STRUCTURED_FIELD_ALIASES = Object.freeze({
      paths: ['位置', 'paths'],
      symbols: ['对象', 'symbols'],
      content: ['内容', 'content'],
      pitfall: ['踩坑', 'pitfall']
    });
    const MEMORY_STRUCTURED_KNOWN_KEYS = new Set(Object.values(MEMORY_STRUCTURED_FIELD_ALIASES).flat());
    const MEMORY_STRUCTURED_BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
    const MEMORY_STRUCTURED_META_FIELD_VALUES = new Set(['位置', '对象', '内容', '踩坑']);
    const MEMORY_LEGACY_FIELD_PATTERN = /^(位置|对象|内容|踩坑)\s*[：:]\s?/;

    function memoryPlainText(value) {
      return typeof value === 'string' ? value.replace(/\u0000/g, '').trim() : '';
    }

    function memoryUniqTextList(items) {
      const list = [];
      for (const item of Array.isArray(items) ? items : []) {
        const text = memoryPlainText(item).replace(/\s+/g, ' ').trim();
        if (text === '' || MEMORY_STRUCTURED_META_FIELD_VALUES.has(text) || list.includes(text)) continue;
        list.push(text);
      }
      return list;
    }

    function memoryUniqPathList(items) {
      const list = [];
      for (const item of Array.isArray(items) ? items : []) {
        const text = memoryPlainText(item).replace(/[，。；;、,]+$/u, '').replace(/[\\/]+$/, '').trim();
        if (text === '' || MEMORY_STRUCTURED_META_FIELD_VALUES.has(text) || list.includes(text)) continue;
        list.push(text);
      }
      return list;
    }

    function memoryStructuredFieldValue(value, field) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
      for (const key of MEMORY_STRUCTURED_FIELD_ALIASES[field] ?? []) {
        if (Object.prototype.hasOwnProperty.call(value, key)) return value[key];
      }
      return undefined;
    }

    function memoryStructuredExtras(value) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
      return Object.fromEntries(Object.entries(value).filter(([key]) => !MEMORY_STRUCTURED_KNOWN_KEYS.has(key) && !MEMORY_STRUCTURED_BLOCKED_KEYS.has(key)));
    }

    /* 字段校验与服务端 structuredMemoryFields 同规则：位置/对象为字符串数组，内容为字符串，踩坑可选字符串。 */
    function memoryStructuredFields(value) {
      const pathsValue = memoryStructuredFieldValue(value, 'paths');
      const symbolsValue = memoryStructuredFieldValue(value, 'symbols');
      const contentValue = memoryStructuredFieldValue(value, 'content');
      const pitfallValue = memoryStructuredFieldValue(value, 'pitfall');
      if (!Array.isArray(pathsValue) || !pathsValue.every((item) => typeof item === 'string')) return undefined;
      if (!Array.isArray(symbolsValue) || !symbolsValue.every((item) => typeof item === 'string')) return undefined;
      if (typeof contentValue !== 'string') return undefined;
      if (pitfallValue !== undefined && typeof pitfallValue !== 'string') return undefined;
      return {
        paths: memoryUniqPathList(pathsValue),
        symbols: memoryUniqTextList(symbolsValue),
        content: memoryPlainText(contentValue),
        pitfall: pitfallValue === undefined ? '' : memoryPlainText(pitfallValue),
        extra: memoryStructuredExtras(value)
      };
    }

    /* 规范正文：固定中文 key 顺序，2 空格缩进，保留未知字段（剔除原型污染键）。 */
    function memoryStructuredBody(fields) {
      const body = {
        '位置': fields.paths,
        '对象': fields.symbols,
        '内容': fields.content,
        '踩坑': fields.pitfall
      };
      for (const [key, value] of Object.entries(fields.extra ?? {})) {
        if (MEMORY_STRUCTURED_KNOWN_KEYS.has(key) || MEMORY_STRUCTURED_BLOCKED_KEYS.has(key)) continue;
        body[key] = value;
      }
      return JSON.stringify(body, null, 2);
    }

    /* 旧行前缀正文：三行体（位置/对象/内容）与历史四行体（踩坑在内容前或后），内容可多行。
       字段名只在首次出现时开新字段，因此正文里再次出现的“位置：”等按字面文本留在当前字段内。 */
    function memoryLegacyFields(text) {
      const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
      const values = {};
      const order = [];
      let current = null;
      for (const line of lines) {
        const match = line.match(MEMORY_LEGACY_FIELD_PATTERN);
        /* 字段名只在首次出现时开新字段：正文里再次出现的“位置：”等按字面文本续行。 */
        if (match !== null && values[match[1]] === undefined) {
          current = match[1];
          order.push(current);
          values[current] = line.slice(match[0].length);
          continue;
        }
        if (current === null) {
          if (line.trim() !== '') return undefined;
          continue;
        }
        values[current] = `${values[current]}\n${line}`;
      }
      /* 只接受 位置 → 对象 → 内容 的历史顺序，踩坑可缺席、可位于内容前或后。 */
      if (values['位置'] === undefined || values['对象'] === undefined || values['内容'] === undefined) return undefined;
      if (order.indexOf('位置') > order.indexOf('对象') || order.indexOf('对象') > order.indexOf('内容')) return undefined;
      const listValue = (raw) => {
        const value = memoryPlainText(raw);
        if (value === '' || /^[-—－]+$/.test(value)) return [];
        return memoryUniqTextList(value.split(/[，,、;；|]+/u));
      };
      const textValue = (raw) => {
        const value = memoryPlainText(raw);
        return /^[-—－]+$/.test(value) ? '' : value;
      };
      return {
        paths: listValue(values['位置']),
        symbols: listValue(values['对象']),
        content: textValue(values['内容']),
        pitfall: values['踩坑'] === undefined ? '' : textValue(values['踩坑']),
        extra: {}
      };
    }

    function memoryStripCodeFence(text) {
      const value = memoryPlainText(text);
      const fenced = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
      return fenced ? fenced[1].trim() : value;
    }

    function memoryJsonObjectSlice(text) {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      return start >= 0 && end > start ? text.slice(start, end + 1) : undefined;
    }

    /* 以下四个修复步骤只处理“不改变字段边界”的语法损坏，任何一步失败即放弃该候选。 */
    function memoryStripTrailingCommas(text) {
      return text.replace(/,(\s*[}\]])/g, '$1');
    }

    function memoryEscapeJsonNewlines(text) {
      let out = '';
      let inDouble = false;
      for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (inDouble) {
          if (char === '\\') { out += char + (text[index + 1] ?? ''); index += 1; continue; }
          if (char === '"') { inDouble = false; out += char; continue; }
          if (char === '\n') { out += '\\n'; continue; }
          if (char === '\r') continue;
          if (char === '\t') { out += '\\t'; continue; }
          out += char;
          continue;
        }
        if (char === '"') inDouble = true;
        out += char;
      }
      return inDouble ? undefined : out;
    }

    function memoryNormalizeJsonQuotes(text) {
      const source = text.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
      let out = '';
      let inDouble = false;
      let inSingle = false;
      for (let index = 0; index < source.length; index += 1) {
        const char = source[index];
        if (inDouble) {
          if (char === '\\') { out += char + (source[index + 1] ?? ''); index += 1; continue; }
          if (char === '"') inDouble = false;
          out += char;
          continue;
        }
        if (inSingle) {
          if (char === '\\') { out += char + (source[index + 1] ?? ''); index += 1; continue; }
          if (char === "'") { inSingle = false; out += '"'; continue; }
          out += char === '"' ? '\\"' : char;
          continue;
        }
        if (char === '"') { inDouble = true; out += char; continue; }
        if (char === "'") { inSingle = true; out += '"'; continue; }
        out += char;
      }
      return inSingle ? undefined : out;
    }

    /* 仅对结构化字段名的裸 key 补引号，且只在字符串外部生效。 */
    function memoryQuoteBareJsonKeys(text) {
      let out = '';
      let inDouble = false;
      for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (inDouble) {
          if (char === '\\') { out += char + (text[index + 1] ?? ''); index += 1; continue; }
          if (char === '"') inDouble = false;
          out += char;
          continue;
        }
        if (char === '"') { inDouble = true; out += char; continue; }
        if (char === '{' || char === ',') {
          out += char;
          const match = text.slice(index + 1).match(/^(\s*)([^\s:,"'{}[\]]+)(\s*):/);
          if (match !== null && MEMORY_STRUCTURED_KNOWN_KEYS.has(match[2])) {
            out += `${match[1]}"${match[2]}"${match[3]}:`;
            index += match[0].length;
          }
          continue;
        }
        out += char;
      }
      return out;
    }

    function memoryParseStructuredFields(text) {
      const value = JSON.parse(text);
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
      return memoryStructuredFields(value);
    }

    /* 严格 JSON → 去 code fence/外围说明 → 有限修复组合，逐级尝试，全部失败即认为不可安全修复。 */
    function memoryStructuredFieldsFromJsonText(text) {
      const source = memoryPlainText(text);
      if (source === '') return undefined;
      const fenced = memoryStripCodeFence(source);
      const bases = [fenced];
      const sliced = memoryJsonObjectSlice(fenced);
      if (sliced !== undefined && sliced !== fenced) bases.push(sliced);
      for (const base of bases) {
        try {
          const fields = memoryParseStructuredFields(base);
          if (fields !== undefined) return fields;
        } catch {}
      }
      const repairs = [memoryStripTrailingCommas, memoryNormalizeJsonQuotes, memoryEscapeJsonNewlines, memoryQuoteBareJsonKeys];
      for (const base of bases) {
        for (let mask = 1; mask < (1 << repairs.length); mask += 1) {
          let value = base;
          for (let bit = 0; bit < repairs.length; bit += 1) {
            if ((mask & (1 << bit)) === 0) continue;
            const transformed = repairs[bit](value);
            if (transformed === undefined) { value = undefined; break; }
            value = transformed;
          }
          if (value === undefined) continue;
          try {
            const fields = memoryParseStructuredFields(value);
            if (fields !== undefined) return fields;
          } catch {}
        }
      }
      return undefined;
    }

    /* 美化格式主入口：返回 status = formatted | already | not-applicable | failed。
       formatted 才携带新正文；failed 表示看起来是 JSON 但无法安全修复，调用方保留原文。
       只做两类确定性转换：旧“位置/对象/内容”行前缀 → JSON；损坏 JSON → 修复。
       普通文本（含代码/项目类裸文本）不改写，避免靠猜测补出位置/对象字段。 */
    function memoryBeautifyBody(text) {
      const trimmed = memoryPlainText(text);
      if (trimmed === '') return { status: 'not-applicable' };
      const structured = memoryStructuredFieldsFromJsonText(trimmed);
      if (structured !== undefined) {
        const body = memoryStructuredBody(structured);
        return body === trimmed ? { status: 'already' } : { status: 'formatted', text: body };
      }
      const legacy = memoryLegacyFields(trimmed);
      if (legacy !== undefined) return { status: 'formatted', text: memoryStructuredBody(legacy) };
      if (/^[{[]/.test(trimmed)) return { status: 'failed' };
      return { status: 'not-applicable' };
    }

    function memoryPagination(items, page, pageSize = MEMORY_PAGE_SIZE) {
      const list = memorySafeArray(items);
      const pageCount = Math.max(1, Math.ceil(list.length / pageSize));
      const safePage = Math.min(Math.max(1, Number(page) || 1), pageCount);
      const start = (safePage - 1) * pageSize;
      return {
        items: list.slice(start, start + pageSize),
        page: safePage,
        pageCount,
        total: list.length
      };
    }

    function MemorySelect({ value, options, disabled, placeholder, ariaLabel, onChange, searchable = false, searchPlaceholder }) {
      const [open, setOpen] = react.useState(false);
      const [query, setQuery] = react.useState('');
      const rootRef = react.useRef(null);
      const searchInputRef = react.useRef(null);
      const normalizedOptions = memorySafeArray(options).map((option) => ({
        ...option,
        id: String(option.value)
      }));
      const selected = normalizedOptions.find((option) => option.id === String(value));
      const label = selected?.label || placeholder || '';
      const trimmedQuery = query.trim().toLowerCase();
      const visibleOptions = !searchable || trimmedQuery === ''
        ? normalizedOptions
        : normalizedOptions.filter((option) => String(option.label ?? '').toLowerCase().includes(trimmedQuery));
      react.useEffect(() => {
        if (!open) {
          setQuery('');
          return;
        }
        const onPointerDown = (event) => {
          if (!(event.target instanceof Node)) return;
          if (rootRef.current?.contains(event.target) === true) return;
          setOpen(false);
        };
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
          document.removeEventListener('pointerdown', onPointerDown);
          document.removeEventListener('keydown', onKeyDown);
        };
      }, [open]);
      react.useEffect(() => {
        if (!open || !searchable) return;
        const id = typeof window !== 'undefined' ? window.requestAnimationFrame(() => searchInputRef.current?.focus()) : 0;
        return () => {
          if (typeof window !== 'undefined') window.cancelAnimationFrame(id);
        };
      }, [open, searchable]);
      const selectOption = (option) => {
        if (option.disabled) return;
        setOpen(false);
        onChange?.(option.value);
      };
      return react.createElement('span', { ref: rootRef, className: 'dsh-session-kit-memory-select-root' },
        react.createElement(primitives.Button, {
          variant: 'outline',
          size: 'md',
          disabled,
          className: 'dsh-session-kit-memory-select-button',
          onClick: () => {
            if (!disabled) setOpen((current) => !current);
          },
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          'aria-label': ariaLabel || placeholder || label
        },
          react.createElement('span', { className: 'dsh-session-kit-memory-select-label', title: label }, label),
          react.createElement('span', { className: `dsh-session-kit-memory-select-chevron${open ? ' dsh-session-kit-memory-select-chevron-open' : ''}`, 'aria-hidden': 'true' }, react.createElement(primitives.IconChevronDownOutlineRegular, { size: 14 }))
        ),
        open && react.createElement('div', { className: 'dsh-session-kit-memory-select-panel', role: 'menu' },
          searchable && react.createElement('div', { className: 'dsh-session-kit-memory-select-search' },
            react.createElement('span', { className: 'dsh-session-kit-memory-select-search-icon', 'aria-hidden': 'true' }, react.createElement(primitives.IconSearchOutlineRegular, { size: 14 })),
            react.createElement('input', {
              ref: searchInputRef,
              type: 'text',
              className: 'dsh-session-kit-memory-select-search-input',
              value: query,
              placeholder: searchPlaceholder || placeholder || '',
              'aria-label': searchPlaceholder || ariaLabel || placeholder || '',
              onChange: (event) => setQuery(event.currentTarget.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter' && visibleOptions.length > 0 && !visibleOptions[0].disabled) {
                  event.preventDefault();
                  selectOption(visibleOptions[0]);
                }
              },
              onClick: (event) => event.stopPropagation(),
              onPointerDown: (event) => event.stopPropagation()
            })
          ),
          visibleOptions.length === 0
            ? react.createElement('div', { className: 'dsh-session-kit-memory-select-empty' }, '—')
            : visibleOptions.map((option) => react.createElement('button', {
              key: option.id,
              type: 'button',
              role: 'menuitem',
              disabled: option.disabled,
              className: 'dsh-session-kit-memory-select-option',
              'data-selected': option.id === selected?.id || undefined,
              onClick: () => selectOption(option)
            },
              react.createElement('span', { className: 'dsh-session-kit-memory-select-option-label', title: option.label }, option.label),
              option.id === selected?.id && react.createElement(primitives.IconCheckOutlineRegular, { size: 16 })
            ))
        )
      );
    }

    function getCurrentModelSelection(ctx, sessionId) {
      try {
        const binding = ctx.sessions?.binding?.(String(sessionId || ''));
        const projected = binding?.session?.projections?.faceOf?.('modelSelection')?.getSnapshot?.();
        const selected = projected?.next;
        if (selected?.provider && selected?.model) return { provider: selected.provider, model: selected.model, ...(selected.reasoningEffort ? { reasoningEffort: selected.reasoningEffort } : {}) };
        const directory = ctx.modelDirectories?.directoryFor?.(String(sessionId || ''));
        const current = directory?.store?.getSnapshot?.()?.current;
        if (current?.provider && current?.model) return { provider: current.provider, model: current.model, ...(current.reasoningEffort ? { reasoningEffort: current.reasoningEffort } : {}) };
      } catch {}
      return undefined;
    }

    function renderToggleSwitch(enabled) {
      return react.createElement('span', { className: `dsh-session-kit-toggle-switch${enabled ? ' dsh-session-kit-toggle-switch-on' : ''}`, 'aria-hidden': 'true' },
        react.createElement('span', { className: 'dsh-session-kit-toggle-switch-knob' })
      );
    }

    /* ── 记忆保存目录 HTTP 客户端（两处共用：DSH 设置页 + 记忆管理弹窗的设置 tab）──
       为什么必须共用：保存目录走【独立路由】MEMORY_STORAGE_ROUTE（记忆库可迁出
       memory.sqlite 之外），宿主端会返回一组错误码，客户端要把它们映射成本地化文案。
       这段映射若在两处各写一份，宿主端新增错误码时漏改一侧，就会出现
       「弹窗提示正常、设置页显示原始错误码」的不一致。
       客户端只负责「请求 + 错误码→文案 + draft 归一化」，状态与提示展示仍由调用方管理。 */
    const MemoryStorageClient = {
      /* 从服务端响应值构造草稿（两处共用同一归一化规则）。 */
      draftFrom(value) {
        return {
          mode: value?.mode === 'custom' ? 'custom' : 'default',
          customPath: String(value?.customPath || '')
        };
      },
      /* 读取当前设置。失败抛错（文案已本地化），由调用方决定如何展示。 */
      async load(t) {
        const response = await fetch(MEMORY_STORAGE_ROUTE);
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok !== true) {
          throw new Error(data.error?.code || data.error || `HTTP ${response.status}`);
        }
        return data.value ?? {};
      },
      /* 保存设置。返回 { value, restartRequired }；错误码在此统一映射为文案。 */
      async save(t, { mode, customPath }) {
        const response = await fetch(MEMORY_STORAGE_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode, customPath })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok !== true) {
          const code = data.error?.code || data.error;
          if (code === 'memory-storage-path-not-absolute') throw new Error(t('memoryStoragePathNotAbsolute'));
          if (code === 'memory-storage-path-is-default') throw new Error(t('memoryStoragePathIsDefault'));
          if (code === 'memory-storage-path-not-a-directory') throw new Error(t('memoryStoragePathNotADirectory'));
          if (code === 'memory-storage-path-unusable') throw new Error(t('memoryStoragePathUnusable'));
          if (code === 'invalid-memory-storage-path' || code === 'invalid-memory-storage-mode') throw new Error(t('memoryStorageInvalid'));
          throw new Error(code || `HTTP ${response.status}`);
        }
        return data.value ?? {};
      },
      /* 「无可用目录选择器」判定：含全部通道缺失，以及官方 seam 在 browse 后端抛出的
         native capability 拒绝。这两者都不是"保存失败"，而是"本环境不支持弹窗选目录"，
         应引导用户手填而非报错。 */
      isNoPicker(reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        return message === 'NO_DIRECTORY_PICKER' || message.includes('native capability');
      }
    };

    /* ── 记忆召回设置的纯逻辑（模块级，供两处 UI 共用）──
       抽出原因：这段含「缩减总量时优先减段2、增加时优先补段3」的双向调整逻辑，
       若两处各写一份，改一处漏一处会直接导致配额算错（段4 由前三段推导）。
       全部为纯函数：输入当前配置，输出新配置，不碰 React 状态。 */

    const RECALL_SETTINGS_DEFAULT = Object.freeze({
      mode: 'default', maxItems: 20,
      segments: Object.freeze({ segment1: 5, segment2: 5, segment3: 5, segment4: 5 })
    });

    /* 切换召回模式：default / exclude-temporary 各有一套固定配额，custom 沿用当前值。 */
    function recallSettingsForMode(mode, current) {
      if (mode === 'default') {
        return { mode, maxItems: 20, segments: { segment1: 5, segment2: 5, segment3: 5, segment4: 5 } };
      }
      if (mode === 'exclude-temporary') {
        return { mode, maxItems: 15, segments: { segment1: 5, segment2: 0, segment3: 5, segment4: 5 } };
      }
      return { ...current, mode: 'custom' };
    }

    /* 调整单个段位：段1 下限 3，其余下限 0，上限均为 5；段4 由 maxItems 推导（不可手改）。 */
    function recallSettingsForSegment(current, key, value) {
      const segments = {
        ...current.segments,
        [key]: Math.max(key === 'segment1' ? 3 : 0, Math.min(5, Math.trunc(Number(value) || 0)))
      };
      const segment4 = Math.max(0, current.maxItems - segments.segment1 - segments.segment2 - segments.segment3);
      return { ...current, mode: 'custom', segments: { ...segments, segment4 } };
    }

    /* 调整总量（8~20）：缩减时优先减段2再减段3，增加时反向先补段3再补段2。
       段2/段3 均不再被 maxItems 阈值强制清零（配额可变，由用户自由调整），
       段4>=3 校验兜底总预算；缩减语义：段4 保持原值不变、缺口全部从段2/段3 扣，
       在旧状态合法（段4>=3）的前提下新状态天然仍合法，无需额外守卫。 */
    function recallSettingsForMax(current, value) {
      const previousMax = current.maxItems;
      const maxItems = Math.max(8, Math.min(20, Math.trunc(Number(value) || 8)));
      let segment2 = current.segments.segment2;
      let segment3 = current.segments.segment3;
      if (maxItems < previousMax) {
        /* 缩减总量时，20→15 优先从临时段2减，15→10 再从混合段3减。 */
        let reduction = previousMax - maxItems;
        const fromSegment2 = Math.min(reduction, segment2);
        segment2 -= fromSegment2;
        reduction -= fromSegment2;
        segment3 = Math.max(0, segment3 - Math.min(reduction, segment3));
      } else if (maxItems > previousMax) {
        /* 增加总量时按相反方向恢复：先补段3，再补段2。 */
        let addition = maxItems - previousMax;
        const toSegment3 = Math.min(addition, 5 - segment3);
        segment3 += toSegment3;
        addition -= toSegment3;
        segment2 += Math.min(addition, 5 - segment2);
      }
      const segments = { ...current.segments, segment2, segment3 };
      const segment4 = Math.max(0, maxItems - segments.segment1 - segment2 - segment3);
      return { ...current, mode: 'custom', maxItems, segments: { ...segments, segment4 } };
    }

    /* 配额合法性（与宿主端 normalizeRecallSettings 同规则）——不合法时禁用保存。 */
    function recallSettingsValid(settings) {
      if (settings?.mode !== 'custom') return true;
      const maxItems = settings.maxItems;
      const seg = settings.segments ?? {};
      return maxItems >= 8 && maxItems <= 20
        && seg.segment1 >= 3 && seg.segment1 <= 5
        && seg.segment2 >= 0 && seg.segment2 <= 5
        && seg.segment3 >= 0 && seg.segment3 <= 5
        && seg.segment4 >= 3;
    }

    function ModalTitleWithEntryToggle({ title, visible, onToggleVisible, label, hint }) {
      if (typeof onToggleVisible !== 'function') return title;
      const enabled = visible !== false;
      return react.createElement('span', { className: 'dsh-session-kit-modal-title' },
        react.createElement('span', { className: 'dsh-session-kit-modal-title-label' }, title),
        react.createElement(primitives.Tooltip, { label, side: 'bottom', delayMs: 500 },
          react.createElement(primitives.Button, {
            variant: 'outline',
            size: 'sm',
            className: 'dsh-session-kit-entry-visibility-toggle',
            'aria-pressed': enabled,
            'aria-label': label,
            title: label,
            onClick: () => { void Promise.resolve(onToggleVisible(!enabled)).catch(() => undefined); }
          }, renderToggleSwitch(enabled), react.createElement('span', null, label))
        ),
        /* 可选说明文字：仅任务弹窗传入，用于解释该开关之外的相关规则。 */
        typeof hint === 'string' && hint !== ''
          ? react.createElement('span', { className: 'dsh-session-kit-modal-title-hint' }, hint)
          : null
      );
    }

    /* 编辑/删除类动作走「静默」路径：完成后不触发 GET 刷新（load/loadActivity），
       也不拿 POST 返回的整份快照覆盖界面——整表替换会造成列表抖动、计数跳变，
       还可能冲掉并发动作的本地状态。变更由 applyLocalSnapshotPatch 按请求参数
       在本地精准落地；下次打开弹窗时 load() 自然取到服务端最新数据。 */
    const MEMORY_QUIET_ACTIONS = new Set(['update-memory', 'update-directory', 'set-session-directory', 'delete-memory', 'delete-directory', 'delete-tag', 'set-tag-status']);

    function MemoryManagementDialog({ open, t, sessionId, onClose, getSessionTitle, getCurrentUserMessage, getModelSelection, getModelDirectory, updateSidebarEntries, pickDirectory }) {
      const sidebarEntries = useSidebarEntries();
      const loadedOnceRef = react.useRef(false);
      const [snapshot, setSnapshot] = react.useState(null);
      /* snapshot 请求序号：避免弹窗打开时的旧 GET 晚于蒸馏 POST 返回，覆盖新快照。 */
      const snapshotRequestRef = react.useRef(0);
      const [loading, setLoading] = react.useState(false);
      /* 动作级忙碌标记：发请求时只禁用发起它的那个按钮，不锁整个弹窗（全局 busy
         会让「蒸馏最后一轮」这类长动作期间所有按钮失效、新建项目/标签/记忆子弹窗
         的保存按钮误显「保存中…」）。id 形如 "action" 或 "action:目标"——同一动作
         作用于不同目标（不同记忆卡片的注入/删除/固定）互不影响；同 id 重复触发
         （含快速双击，state 尚未重渲染）由 ref 同步拦截。 */
      const [busyActions, setBusyActions] = react.useState(() => new Set());
      const busyActionsRef = react.useRef(new Set());
      const isActionBusy = (action, key) => busyActions.has(key === undefined ? action : `${action}:${key}`);
      const beginActionBusy = (id) => {
        busyActionsRef.current.add(id);
        setBusyActions((current) => { const next = new Set(current); next.add(id); return next; });
      };
      const endActionBusy = (id) => {
        busyActionsRef.current.delete(id);
        setBusyActions((current) => { const next = new Set(current); next.delete(id); return next; });
      };
      const [error, setError] = react.useState(null);
      const [notice, setNotice] = react.useState(null);
      const [search, setSearch] = react.useState('');
      const [memoryTab, setMemoryTab] = react.useState('overview');
      const [usageOverview, setUsageOverview] = react.useState(null);
      const [usageLoading, setUsageLoading] = react.useState(false);
      const [usagePeriod, setUsagePeriod] = react.useState('today');
      /* 总览数值默认紧凑格式（K/M）：点击已选中的统计卡片在紧凑/原始间切换 */
      const [usageCompact, setUsageCompact] = react.useState(true);
      const formatUsageNumber = (value) => {
        const number = Math.round(Number(value) || 0);
        if (!usageCompact) return number.toLocaleString();
        if (number < 1000) return String(number);
        const scaled = number < 1000000 ? number / 1000 : number / 1000000;
        const suffix = number < 1000000 ? 'K' : 'M';
        const formatted = scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10;
        return `${formatted}${suffix}`;
      };
      const loadUsageOverview = react.useCallback(async () => {
        setUsageLoading(true);
        try {
          const value = await memoryUsageOverviewFetch(sessionId);
          setUsageOverview(value && typeof value === 'object' ? value : null);
        } catch {
          setUsageOverview(null);
        } finally {
          setUsageLoading(false);
        }
      }, [sessionId]);
      react.useEffect(() => {
        if (!open || memoryTab !== 'overview') return undefined;
        void loadUsageOverview();
        return undefined;
      }, [open, memoryTab, loadUsageOverview]);
      const [progressItems, setProgressItems] = react.useState([]);
      /* 本地秒级 tick：仅驱动"进行"卡片已耗时的重算走动，不发起任何网络请求；
         弹窗打开且"进行"页有活动时才启动。 */
      const [progressTick, setProgressTick] = react.useState(0);
      react.useEffect(() => {
        if (!open || memoryTab !== 'progress' || progressItems.length === 0) return undefined;
        const timer = window.setInterval(() => setProgressTick((value) => value + 1), 1000);
        return () => window.clearInterval(timer);
      }, [open, memoryTab, progressItems.length]);
      const [logItems, setLogItems] = react.useState([]);
      const [logBefore, setLogBefore] = react.useState(null);
      const [logHasMore, setLogHasMore] = react.useState(false);
      const [clearLogsOpen, setClearLogsOpen] = react.useState(false);
      const [memoryPages, setMemoryPages] = react.useState({ projects: 1, temporary: 1, memories: 1, tags: 1 });
      const [directoryFilter, setDirectoryFilter] = react.useState('all');
      /* 「临时/记忆」两个列表各自的项目筛选：directoryId（''=未筛选）+ pinned（只看
         固定注入）。点卡片左上角的项目徽章设置项目，区块标题右侧的胶囊 X 清除、
         图钉切换「只看固定注入」。临时记忆没有固定注入语义，图钉筛选下自然为空。 */
      const [tabProjectFilters, setTabProjectFilters] = react.useState({
        temporary: { directoryId: '', pinned: false },
        memories: { directoryId: '', pinned: false }
      });
      const [newMemoryOpen, setNewMemoryOpen] = react.useState(false);
      const [newMemoryText, setNewMemoryText] = react.useState('');
      const [newMemoryNotice, setNewMemoryNotice] = react.useState(null);
      const [newMemoryDirectoryId, setNewMemoryDirectoryId] = react.useState('');
      const [newMemoryStatus, setNewMemoryStatus] = react.useState('active');
      const [newMemoryTagNames, setNewMemoryTagNames] = react.useState([]);
      /* 事实时间（可选）：与编辑弹窗同形，日期与时间分开填。
         时间留空 = 只声明到天（显示也只有日期）；填了才精确到分钟。 */
      const [newMemoryEventTime, setNewMemoryEventTime] = react.useState('');
      const [newMemoryEventClock, setNewMemoryEventClock] = react.useState('');
      const [newMemoryValidUntil, setNewMemoryValidUntil] = react.useState('');
      const [newMemoryValidUntilClock, setNewMemoryValidUntilClock] = react.useState('');
      /* 标签勾选区的过滤条件：新建/编辑各持一份，避免两边串味。 */
      const [newMemoryTagQuery, setNewMemoryTagQuery] = react.useState('');
      const [newMemoryTagOnlySelected, setNewMemoryTagOnlySelected] = react.useState(false);
      const [newDirectoryOpen, setNewDirectoryOpen] = react.useState(false);
      const [newDirectoryName, setNewDirectoryName] = react.useState('');
      const [newDirectoryRemark, setNewDirectoryRemark] = react.useState('');
      const [newTagOpen, setNewTagOpen] = react.useState(false);
      const [newTagName, setNewTagName] = react.useState('');
      const [projectEditor, setProjectEditor] = react.useState(null);
      const [editor, setEditor] = react.useState(null);
      /* 正文版本历史：historyTarget 为记忆对象（null 表示未打开）；
         列表按 replaced_at 倒序分页拉取，currentText 来自快照用于置顶显示。 */
      const [historyTarget, setHistoryTarget] = react.useState(null);
      const [historyItems, setHistoryItems] = react.useState([]);
      const [historyTotal, setHistoryTotal] = react.useState(0);
      const [historyHasMore, setHistoryHasMore] = react.useState(false);
      const [historyLoading, setHistoryLoading] = react.useState(false);
      const [historyBusyId, setHistoryBusyId] = react.useState(null);
      /* 确认弹窗：{kind:'restore'|'delete'|'clear', revision?} —— 三种操作共用同一个确认框。 */
      const [historyConfirm, setHistoryConfirm] = react.useState(null);
      /* 差异视图：{revision} —— 与该条历史版本对比当前正文。 */
      const [historyDiffTarget, setHistoryDiffTarget] = react.useState(null);
      const [historyCopiedId, setHistoryCopiedId] = react.useState(null);
      const historyCopyTimer = react.useRef(0);
      const [editorTagQuery, setEditorTagQuery] = react.useState('');
      const [editorTagOnlySelected, setEditorTagOnlySelected] = react.useState(false);
      /* 编辑弹窗内的“美化格式”结果提示：只在本表单显示，不复用全局 notice/error 层。 */
      const [editorNotice, setEditorNotice] = react.useState(null);
      const [deleteTarget, setDeleteTarget] = react.useState(null);
      const [memoryInjectTarget, setMemoryInjectTarget] = react.useState(null);
      const [copiedDirectoryId, setCopiedDirectoryId] = react.useState(null);
      const directoryCopyTimer = react.useRef(0);
      /* 日志“删除记忆”条目旁的复制按钮：记录刚复制的日志 id 以显示勾选反馈。 */
      const [copiedLogId, setCopiedLogId] = react.useState(null);
      const logCopyTimer = react.useRef(0);
      /* 「复制旧版本正文」独立状态：与上面整条正文的复制互不干扰，
         否则同一行的两个按钮会同时显示已复制勾选。 */
      const [copiedBeforeLogId, setCopiedBeforeLogId] = react.useState(null);
      const logCopyBeforeTimer = react.useRef(0);
      const currentSessionId = String(sessionId || snapshot?.sessionId || '');
      const autoDistillEnabled = snapshot?.autoDistillEnabled === true;
      const allSessionsDirectoryEnabled = snapshot?.allSessionsDirectoryEnabled === true;
      const firstTurnAutoMatchEnabled = snapshot?.firstTurnAutoMatchEnabled === true;
      const memoryDirectoryPriority = (name) => name === 'default' ? 0 : 1;
      const directories = [...memorySafeArray(snapshot?.directories)].sort((left, right) => {
        const priorityDiff = memoryDirectoryPriority(left?.name) - memoryDirectoryPriority(right?.name);
        if (priorityDiff !== 0) return priorityDiff;
        return Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0) || String(left?.name || '').localeCompare(String(right?.name || ''), undefined, { sensitivity: 'base' });
      });
      const tags = memoryOrderedTags(snapshot?.tags);
      const activeTags = tags.filter((tag) => memoryTagStatus(tag) === 'active');
      const memories = memorySafeArray(snapshot?.memories);
      const directoryById = react.useMemo(() => new Map(directories.map((directory) => [directory.id, directory])), [directories]);
      const directoryOptions = directories.map((directory) => ({ value: directory.id, label: directory.name }));
      const tabItems = [
        { id: 'overview', label: t('memoryOverview') },
        { id: 'projects', label: t('memoryDirectories'), count: directories.length },
        { id: 'temporary', label: t('memoryEphemeral'), count: memories.filter((memory) => memory.persisted !== true).length },
        { id: 'memories', label: t('memoryItems'), count: memories.filter((memory) => memory.persisted === true).length },
        { id: 'tags', label: t('memoryTags'), count: tags.length },
        { id: 'progress', label: t('memoryProgress'), count: progressItems.length },
        { id: 'logs', label: t('memoryLogs') },
        { id: 'settings', label: t('memorySettings') }
      ];
      const modelDirectory = react.useMemo(() => {
        try { return getModelDirectory?.(currentSessionId); } catch { return undefined; }
      }, [getModelDirectory, currentSessionId]);
      const modelDirectoryStore = modelDirectory?.store;
      const emptyDirectoryState = react.useMemo(() => ({ current: null, groups: [], status: 'idle', error: null }), []);
      const [modelDirectoryState, setModelDirectoryState] = react.useState(() => modelDirectoryStore?.getSnapshot?.() ?? emptyDirectoryState);
      const [distillModelDraft, setDistillModelDraft] = react.useState(undefined);
      react.useEffect(() => {
        const store = modelDirectory?.store;
        if (!store) { setModelDirectoryState(emptyDirectoryState); return undefined; }
        setModelDirectoryState(store.getSnapshot?.() ?? emptyDirectoryState);
        const unsubscribe = store.subscribe?.(() => setModelDirectoryState(store.getSnapshot?.() ?? emptyDirectoryState));
        if (modelDirectoryState.status === 'idle' && currentSessionId) void modelDirectory.load?.().catch(() => undefined);
        return typeof unsubscribe === 'function' ? unsubscribe : undefined;
      }, [modelDirectory, currentSessionId, emptyDirectoryState]);
      react.useEffect(() => {
        if (distillModelDraft !== undefined || snapshot === null) return;
        setDistillModelDraft(snapshot.distillModelOverride ?? modelDirectoryState.current ?? null);
      }, [snapshot, modelDirectoryState.current, distillModelDraft]);
      const [recallSettingsDraft, setRecallSettingsDraft] = react.useState(undefined);
      const recallSettingsDirtyRef = react.useRef(false);
      /* 记忆数据保存目录：与记忆库解耦的独立设置路由（存在 storageDomain，
         不在 memory.sqlite 内），因此单独加载，不随记忆快照走。 */
      const [storageDir, setStorageDir] = react.useState(null);
      const [storageDirDraft, setStorageDirDraft] = react.useState({ mode: 'default', customPath: '' });
      const [storageDirNotice, setStorageDirNotice] = react.useState(null);
      const [storageDirError, setStorageDirError] = react.useState(null);
      const [storagePicking, setStoragePicking] = react.useState(false);
      const [storageSaving, setStorageSaving] = react.useState(false);
      const loadStorageDir = react.useCallback(async () => {
        try {
          const next = await MemoryStorageClient.load(t);
          setStorageDir(next);
          setStorageDirDraft(MemoryStorageClient.draftFrom(next));
          setStorageDirError(null);
        } catch (reason) {
          setStorageDirError(`${t('memoryStorageFailed')}: ${memoryErrorMessage(t, reason)}`);
        }
      }, [t]);
      react.useEffect(() => {
        if (!open || memoryTab !== 'settings') return undefined;
        void loadStorageDir();
        return undefined;
      }, [open, memoryTab, loadStorageDir]);
      react.useEffect(() => {
        if (snapshot?.recallSettings !== undefined && !recallSettingsDirtyRef.current) setRecallSettingsDraft(snapshot.recallSettings);
      }, [snapshot?.recallSettings]);
      const recallSettings = recallSettingsDraft ?? snapshot?.recallSettings ?? { mode: 'default', maxItems: 20, segments: { segment1: 5, segment2: 5, segment3: 5, segment4: 5 } };
      /* 本弹窗的设置 tab 里，三块设置已全部抽为共享组件（与「DSH 设置 › session-kit」复用）：
         蒸馏模型 → DistillModelSettingsCard；召回配额 → RecallSettingsCard（计算走模块级
         纯函数 recallSettingsFor*）；Embedding → EmbeddingSettingsModule。
         此处只保留状态与保存动作，不再重复实现 UI，避免两处漂移。 */
      const loadActivity = react.useCallback(async (view, before = null, append = false) => {
        try {
          const value = await memoryActivityFetch(view, 50, before);
          if (view === 'progress') {
            setProgressItems(memorySafeArray(value.items));
          } else {
            setLogItems((current) => append ? [...current, ...memorySafeArray(value.items)] : memorySafeArray(value.items));
            setLogBefore(value.nextBefore ?? null);
            setLogHasMore(value.hasMore === true);
          }
        } catch (reason) {
          setError(`${t('memoryFailed')}: ${reason instanceof Error ? reason.message : String(reason)}`);
        }
      }, [t]);
      const load = react.useCallback(async () => {
        if (!open) return;
        const requestId = snapshotRequestRef.current + 1;
        snapshotRequestRef.current = requestId;
        setLoading(!loadedOnceRef.current);
        setError(null);
        try {
          const value = await memoryFetchSnapshot(sessionId);
          if (snapshotRequestRef.current !== requestId || !open) return;
          setSnapshot(value);
          loadedOnceRef.current = true;
        } catch (reason) {
          if (snapshotRequestRef.current !== requestId || !open) return;
          setError(`${t('memoryFailed')}: ${memoryErrorMessage(t, reason)}`);
        } finally {
          if (snapshotRequestRef.current === requestId) setLoading(false);
        }
      }, [open, sessionId, t]);
      const tokenCleanupStartedRef = react.useRef(false);
      react.useEffect(() => {
        if (!open) {
          tokenCleanupStartedRef.current = false;
          snapshotRequestRef.current += 1;
          return undefined;
        }
        if (tokenCleanupStartedRef.current) return undefined;
        tokenCleanupStartedRef.current = true;
        void memoryPostAction(sessionId, { action: 'cleanup-token-usage' })
          .then(() => Promise.all([
            load(),
            loadActivity('progress'),
            memoryTab === 'overview' ? loadUsageOverview() : Promise.resolve()
          ]))
          .catch(() => undefined);
        return undefined;
      }, [open, sessionId, load, loadActivity, loadUsageOverview, memoryTab]);
      react.useEffect(() => {
        void load();
      }, [load]);
      react.useEffect(() => {
        if (!open) return undefined;
        void loadActivity('progress');
      }, [open, loadActivity]);
      /* 切换 tab：collection 页签刷新共享 snapshot；progress 仍拉 activity 以触发
         服务端卡住活动清理；logs 由自己的 effect 拉取；settings 不额外请求。 */
      const firstMemoryTabRef = react.useRef(memoryTab);
      react.useEffect(() => {
        if (!open) {
          firstMemoryTabRef.current = memoryTab;
          return undefined;
        }
        if (firstMemoryTabRef.current === memoryTab) return undefined;
        firstMemoryTabRef.current = memoryTab;
        if (memoryTab === 'projects' || memoryTab === 'temporary' || memoryTab === 'memories' || memoryTab === 'tags' || memoryTab === 'overview') {
          void load();
        }
        void loadActivity('progress');
      }, [open, memoryTab, load, loadActivity]);
      /* 过期刷新：任一条目已耗时超过 ACTIVITY_STUCK_REFRESH_MS（与服务端兜底线同为
         6 分钟）时拉一次 progress 视图。拉取动作本身触发服务端 activitySnapshot 前置的
         reapStuckActivities，且服务端处理时刻必然不早于前端判定时刻，该条目必已过兜底
         线、随本次响应消失——一次请求解决。inFlight 防重入（秒级 tick 在请求返回前会
         反复满足条件）；多超时条目共享同一次拉取，服务端逐条清理、互不影响。 */
      const staleRefreshInFlightRef = react.useRef(false);
      const hasStuckActivity = react.useMemo(() => {
        const threshold = Date.now() - ACTIVITY_STUCK_REFRESH_MS;
        return progressItems.some((item) => Number(item?.startedAt ?? 0) > 0 && Number(item.startedAt) <= threshold);
      }, [progressItems, progressTick]);
      react.useEffect(() => {
        if (!open || !hasStuckActivity || staleRefreshInFlightRef.current) return undefined;
        staleRefreshInFlightRef.current = true;
        void loadActivity('progress').finally(() => { staleRefreshInFlightRef.current = false; });
        return undefined;
      }, [open, hasStuckActivity, loadActivity]);
      react.useEffect(() => {
        if (!open || memoryTab !== 'logs') return undefined;
        void loadActivity('logs');
      }, [open, memoryTab, loadActivity]);
      react.useEffect(() => {
        if (!open) return;
        setNotice(null);
        setError(null);
      }, [open]);
      react.useEffect(() => {
        if (!notice) return;
        const timer = window.setTimeout(() => setNotice(null), 2600);
        return () => window.clearTimeout(timer);
      }, [notice]);
      react.useEffect(() => {
        if (!error) return;
        const timer = window.setTimeout(() => setError(null), 3000);
        return () => window.clearTimeout(timer);
      }, [error]);
      react.useEffect(() => () => window.clearTimeout(directoryCopyTimer.current), []);
      react.useEffect(() => () => window.clearTimeout(logCopyTimer.current), []);
      react.useEffect(() => () => window.clearTimeout(logCopyBeforeTimer.current), []);
      react.useEffect(() => () => window.clearTimeout(historyCopyTimer.current), []);
      react.useEffect(() => {
        setMemoryPages({ projects: 1, temporary: 1, memories: 1, tags: 1 });
      }, [search]);
      const distillStatusText = (value) => {
        const status = value?.distill?.status;
        if (status === 'created') return value?.distill?.retry?.outcome === 'success' ? t('memoryDistillRetrySuccess') : t('memoryDistillDone');
        if (status === 'duplicate') return t('memoryDistillDuplicate');
        if (status === 'skipped' || status === 'failed') {
          const reasonKey = `memoryDistillReason${String(value.distill.reason || '').split('-').map((part) => part ? part[0].toUpperCase() + part.slice(1) : '').join('')}`;
          const reason = t(reasonKey) === reasonKey ? String(value.distill.reason || '') : t(reasonKey);
          return t(status === 'failed' ? 'memoryDistillFailed' : 'memoryDistillSkipped').replace('{reason}', reason);
        }
        return null;
      };
      /* 记忆数据目录：选目录 → 写入草稿；保存 → POST 设置。
         不改动记忆快照，只刷新本区块状态并给出重启提示。 */
      const chooseStorageDir = async () => {
        if (storagePicking || storageSaving) return;
        setStoragePicking(true);
        setStorageDirError(null);
        setStorageDirNotice(null);
        try {
          const picked = await pickAnyDirectory(pickDirectory);
          if (typeof picked === 'string' && picked.length > 0) {
            setStorageDirDraft({ mode: 'custom', customPath: picked });
          }
        } catch (reason) {
          /* 无可用选择器 → 引导手填，而非报"保存失败"。 */
          setStorageDirError(MemoryStorageClient.isNoPicker(reason)
            ? t('memoryStorageNoPicker')
            : `${t('memoryStorageFailed')}: ${memoryErrorMessage(t, reason)}`);
        } finally {
          setStoragePicking(false);
        }
      };
      const saveStorageDir = async () => {
        if (storageSaving || storagePicking) return;
        const customPath = String(storageDirDraft.customPath || '').trim();
        if (storageDirDraft.mode === 'custom' && customPath.length === 0) {
          setStorageDirError(t('memoryStoragePathNotAbsolute'));
          return;
        }
        setStorageSaving(true);
        setStorageDirError(null);
        setStorageDirNotice(null);
        try {
          const next = await MemoryStorageClient.save(t, { mode: storageDirDraft.mode, customPath });
          setStorageDir(next);
          setStorageDirDraft(MemoryStorageClient.draftFrom(next));
          setStorageDirNotice(next.restartRequired === true ? t('memoryStorageRestart') : t('memoryStorageNoRestart'));
        } catch (reason) {
          setStorageDirError(`${t('memoryStorageFailed')}: ${reason instanceof Error ? reason.message : String(reason)}`);
        } finally {
          setStorageSaving(false);
        }
      };
      /* 编辑/删除后的本地精准更新：只改动受影响的那一条数据（不整表替换）。
         计数等派生值里，本地能可靠推导的一并维护（如删除记忆时项目计数 -1），
         其余等下次打开弹窗的 load() 与服务端对齐。 */
      /* 服务端快照里的单条记忆：update-memory 的乐观补丁没有覆盖的字段（事实时间等）
         从权威响应里取——客户端自行拼日期解析会与服务端口径漂移（本地时区/当日末刻）。 */
      const serverMemoryById = (snapshot, memoryId) => {
        if (snapshot == null) return undefined;
        return memorySafeArray(snapshot.memories).find((memory) => memory?.id === memoryId);
      };
      const applyLocalSnapshotPatch = (action, payload, serverSnapshot) => {
        if (action === 'delete-memory') {
          setSnapshot((current) => {
            if (current == null) return current;
            const removed = memorySafeArray(current.memories).find((memory) => memory.id === payload.memoryId);
            return {
              ...current,
              memories: memorySafeArray(current.memories).filter((memory) => memory.id !== payload.memoryId),
              directories: memorySafeArray(current.directories).map((directory) => {
                if (removed?.directoryId !== directory.id) return directory;
                return {
                  ...directory,
                  memoryCount: Math.max(0, Number(directory.memoryCount || 0) - 1),
                  activeMemoryCount: removed.status === 'active' ? Math.max(0, Number(directory.activeMemoryCount || 0) - 1) : Number(directory.activeMemoryCount || 0)
                };
              })
            };
          });
        } else if (action === 'delete-directory') {
          setSnapshot((current) => current == null ? current : { ...current, directories: memorySafeArray(current.directories).filter((directory) => directory.id !== payload.directoryId) });
        } else if (action === 'delete-tag') {
          setSnapshot((current) => {
            if (current == null) return current;
            const removedName = memorySafeArray(current.tags).find((tag) => tag.id === payload.tagId)?.name;
            return {
              ...current,
              tags: memorySafeArray(current.tags).filter((tag) => tag.id !== payload.tagId),
              memories: removedName === undefined
                ? memorySafeArray(current.memories)
                : memorySafeArray(current.memories).map((memory) => {
                  const names = memoryStringArray(memory.tags);
                  return names.includes(removedName) ? { ...memory, tags: names.filter((name) => name !== removedName) } : memory;
                })
            };
          });
        } else if (action === 'set-tag-status') {
          setSnapshot((current) => current == null ? current : {
            ...current,
            tags: memorySafeArray(current.tags).map((tag) => (
              tag.id === payload.tagId ? { ...tag, status: payload.status } : tag
            ))
          });
        } else if (action === 'update-memory') {
          setSnapshot((current) => {
            if (current == null) return current;
            return {
              ...current,
              memories: memorySafeArray(current.memories).map((memory) => {
                if (memory.id !== payload.memoryId) return memory;
                const next = { ...memory };
                if (payload.text !== undefined) next.text = payload.text;
                if (payload.status !== undefined) next.status = payload.status;
                if (payload.pinned !== undefined) next.pinned = payload.pinned;
                if (payload.tagNames !== undefined) next.tags = memoryStringArray(payload.tagNames);
                if (payload.directoryId !== undefined) {
                  next.directoryId = payload.directoryId;
                  /* 空串=清除为「无项目」，名称一并置空；否则从本地项目表取名。 */
                  next.directoryName = payload.directoryId === '' ? null : (directoryById.get(payload.directoryId)?.name ?? memory.directoryName);
                }
                /* 事实时间不在乐观补丁范围（payload 只有字符串，解析口径在服务端）：
                   一律采用响应快照里的权威值——编辑器改完失效时间的瞬间，卡片的
                   「（事件已过期）」徽标就实时出现/消失。响应异常缺失时清零兜底，
                   宁可少显示也不显示过期的错误状态。 */
                const serverMemory = serverMemoryById(serverSnapshot, payload.memoryId);
                if (serverMemory !== undefined) {
                  next.eventTime = Number(serverMemory.eventTime) > 0 ? Number(serverMemory.eventTime) : 0;
                  next.validUntil = Number(serverMemory.validUntil) > 0 ? Number(serverMemory.validUntil) : 0;
                } else {
                  next.eventTime = 0;
                  next.validUntil = 0;
                }
                next.updatedAt = Date.now();
                return next;
              })
            };
          });
        } else if (action === 'update-directory') {
          setSnapshot((current) => current == null ? current : {
            ...current,
            directories: memorySafeArray(current.directories).map((directory) => (
              directory.id === payload.directoryId ? { ...directory, name: payload.name ?? directory.name, remark: payload.remark ?? directory.remark } : directory
            ))
          });
        } else if (action === 'set-session-directory') {
          setSnapshot((current) => current == null ? current : {
            ...current,
            directories: memorySafeArray(current.directories).map((directory) => (
              directory.id === payload.directoryId ? { ...directory, manualEnabled: payload.enabled === true } : directory
            ))
          });
        }
      };
      const runAction = async (payload, successText, actionKey) => {
        const action = payload?.action || 'action';
        const actionId = actionKey === undefined ? action : `${action}:${actionKey}`;
        const isDistillNow = action === 'distill-now';
        if (busyActionsRef.current.has(actionId)) return null;
        const optimisticActivityId = isDistillNow ? `local-activity-${Date.now()}-${Math.random().toString(36).slice(2)}` : null;
        if (optimisticActivityId !== null) {
          setProgressItems((current) => [...current, {
            id: optimisticActivityId,
            kind: 'distill',
            triggerKind: 'manual',
            status: 'running',
            sessionId: String(sessionId || ''),
            sessionTitle: getSessionTitle?.(sessionId) || '',
            summary: getCurrentUserMessage?.(sessionId) || '',
            startedAt: Date.now()
          }]);
        }
        beginActionBusy(actionId);
        setError(null);
        setNotice(null);
        try {
          const value = await memoryPostAction(sessionId, payload);
          if (MEMORY_QUIET_ACTIONS.has(action)) {
            /* 编辑/删除：不触发 GET 刷新，也不用 POST 返回的整份快照覆盖界面，
               只在本地精准落地本次变更（见 applyLocalSnapshotPatch）。 */
            applyLocalSnapshotPatch(action, payload, value);
          } else {
            setSnapshot(value);
            /* POST 返回快照先立即更新；再用受保护的 GET 确认服务端当前 ephemeral 状态，
               防止并发/后台蒸馏导致本地快照落后。 */
            void load();
            void loadActivity('progress');
          }
          const distillNotice = isDistillNow ? distillStatusText(value) : null;
          const distillFailed = value?.distill?.status === 'failed' || value?.distill?.status === 'skipped';
          if (distillNotice && distillFailed) setError(distillNotice);
          else if (distillNotice) setNotice(distillNotice);
          else if (successText && !isDistillNow) setNotice(successText);
          return value;
        } catch (reason) {
          setError(`${t('memoryFailed')}: ${memoryErrorMessage(t, reason)}`);
          return null;
        } finally {
          if (optimisticActivityId !== null) setProgressItems((current) => current.filter((item) => item.id !== optimisticActivityId));
          endActionBusy(actionId);
        }
      };
      const confirmClearLogs = async () => {
        setClearLogsOpen(false);
        const removed = await runAction({ action: 'clear-activity-logs' }, null);
        if (removed === null) return; /* 失败时 runAction 已置错误文案，保留现有列表 */
        setLogItems([]);
        setLogBefore(null);
        setLogHasMore(false);
        setNotice(fillTemplate(t('memoryLogsCleared'), { n: String(removed?.removed ?? 0) }));
      };
      const normalizedMemorySearch = String(search || '').trim().toLocaleLowerCase();
      const selectedDirectory = directoryById.get(directoryFilter);
      const visibleDirectories = directories.filter((directory) => {
        if (!normalizedMemorySearch) return true;
        return [directory.name, directory.id, typeof directory.remark === 'string' ? directory.remark : ''].filter(Boolean).join('\n').toLocaleLowerCase().includes(normalizedMemorySearch);
      });
      const memoryDirectoryMatchesFilter = (memory) => {
        if (directoryFilter === 'all') return true;
        if (directoryFilter === 'ephemeral') return memory.persisted !== true;
        return memory.directoryId === directoryFilter || memory.directoryName === selectedDirectory?.name;
      };
      const visibleTemporaryMemories = memories.filter((memory) => memory.persisted !== true && memoryDirectoryMatchesFilter(memory) && memoryMatches(memory, search) && (tabProjectFilters.temporary.directoryId === '' || memory.directoryId === tabProjectFilters.temporary.directoryId) && (tabProjectFilters.temporary.pinned !== true || memory.pinned === true));
      const visiblePersistedMemories = memories.filter((memory) => memory.persisted === true && memoryDirectoryMatchesFilter(memory) && memoryMatches(memory, search) && (tabProjectFilters.memories.directoryId === '' || memory.directoryId === tabProjectFilters.memories.directoryId) && (tabProjectFilters.memories.pinned !== true || memory.pinned === true));
      const visibleTags = tags.filter((tag) => !normalizedMemorySearch || String(tag?.name || '').toLocaleLowerCase().includes(normalizedMemorySearch));
      /* 标签区分两段：默认（预设）标签恒为置顶的固定 16 个、不参与分页；
         自定义标签才是会被分页切分的那一段。 */
      const visiblePresetTags = visibleTags.filter((tag) => tag?.preset === true);
      const visibleCustomTags = visibleTags.filter((tag) => tag?.preset !== true);
      const projectPage = memoryPagination(visibleDirectories, memoryPages.projects);
      const temporaryPage = memoryPagination(visibleTemporaryMemories, memoryPages.temporary);
      const persistedPage = memoryPagination(visiblePersistedMemories, memoryPages.memories);
      const tagPage = memoryPagination(visibleCustomTags, memoryPages.tags, MEMORY_TAG_PAGE_SIZE);
      const setMemoryPage = (id, page) => setMemoryPages((current) => ({ ...current, [id]: page }));
      const toggleNewMemoryTag = (tagName) => {
        setNewMemoryTagNames((value) => {
          const tags = new Set(memoryStringArray(value));
          if (tags.has(tagName)) tags.delete(tagName);
          else tags.add(tagName);
          return [...tags];
        });
      };
      const createDirectory = async () => {
        if (newDirectoryName.trim() === '') {
          setError(t('renameEmpty'));
          return;
        }
        const value = await runAction({ action: 'create-directory', name: newDirectoryName, remark: newDirectoryRemark }, t('memorySaved'));
        if (value !== null) {
          setNewDirectoryName('');
          setNewDirectoryRemark('');
          setNewDirectoryOpen(false);
        }
      };
      const createTag = async () => {
        if (newTagName.trim() === '') {
          setError(t('renameEmpty'));
          return;
        }
        const value = await runAction({ action: 'create-tag', name: newTagName }, t('memorySaved'));
        if (value !== null) {
          setNewTagName('');
          setNewTagOpen(false);
        }
      };
      const beautifyNewMemoryText = () => {
        const result = memoryBeautifyBody(newMemoryText);
        if (result.status === 'failed') {
          setError(t('memoryBeautifyFailed'));
          setNewMemoryNotice(null);
          return;
        }
        setError(null);
        if (result.status === 'not-applicable') {
          setNewMemoryNotice(t('memoryBeautifySkipped'));
          return;
        }
        if (result.status === 'already') {
          setNewMemoryNotice(t('memoryBeautifyAlready'));
          return;
        }
        setNewMemoryText(result.text);
        setNewMemoryNotice(t('memoryBeautifyDone'));
      };
      const createMemory = async () => {
        if (newMemoryText.trim().length < MEMORY_MIN_TEXT_LENGTH) {
          setError(t('memoryInvalidText'));
          return;
        }
        if (!newMemoryDirectoryId) {
          setError(t('memoryNoDirectories'));
          return;
        }
        /* 事实时间校验与编辑弹窗口径一致：日期/时间格式非法或「失效早于生效」当场拦下。
           时间留空 = 只声明到天（提交纯日期，服务端按当日零点/末刻处理）。 */
        const eventCheck = memoryValidateDateInput(newMemoryEventTime);
        const eventClockCheck = memoryValidateClockInput(newMemoryEventClock);
        const validCheck = memoryValidateDateInput(newMemoryValidUntil);
        const validClockCheck = memoryValidateClockInput(newMemoryValidUntilClock);
        if (!eventCheck.ok || !validCheck.ok) {
          setError(t('memoryInvalidDate'));
          return;
        }
        if (!eventClockCheck.ok || !validClockCheck.ok) {
          setError(t('memoryInvalidClock'));
          return;
        }
        /* 时间框填了但日期框空 → 无意义（时间无所依附），明确提示而不是静默忽略。 */
        if (eventCheck.value === '' && eventClockCheck.value !== '') {
          setError(t('memoryClockWithoutDate'));
          return;
        }
        if (validCheck.value === '' && validClockCheck.value !== '') {
          setError(t('memoryClockWithoutDate'));
          return;
        }
        const eventFactTime = memoryCombineFactTime(eventCheck.value, eventClockCheck.value);
        const validFactTime = memoryCombineFactTime(validCheck.value, validClockCheck.value);
        if (eventFactTime !== '' && validFactTime !== '' && validFactTime < eventFactTime) {
          setError(t('memoryInvalidDateOrder'));
          return;
        }
        const value = await runAction({
          action: 'create-memory',
          text: newMemoryText,
          directoryId: newMemoryDirectoryId,
          status: newMemoryStatus,
          tagNames: newMemoryTagNames,
          /* 空串由服务端按「未声明」处理（parseFactTime 对空串返回 undefined）。
             日期+时间已合成「YYYY-MM-DD HH:MM」；只填日期时为纯日期，服务端按整日处理。 */
          eventTime: eventFactTime,
          validUntil: validFactTime
        }, t('memorySaved'));
        if (value !== null) {
          setNewMemoryText('');
          setNewMemoryNotice(null);
          setNewMemoryDirectoryId('');
          setNewMemoryStatus('active');
          setNewMemoryTagNames([]);
          setNewMemoryEventTime('');
          setNewMemoryEventClock('');
          setNewMemoryValidUntil('');
          setNewMemoryValidUntilClock('');
          setNewMemoryOpen(false);
        }
      };
      const openProjectEditor = (directory) => {
        setProjectEditor({
          directoryId: directory.id,
          name: directory.name || '',
          remark: typeof directory.remark === 'string' ? directory.remark : '',
          manualEnabled: directory.manualEnabled === true,
          protected: directory.protected === true,
          allSessionsForSession: directory.allSessionsForSession === true
        });
      };
      const saveProjectEditor = async () => {
        if (projectEditor === null) return;
        if (projectEditor.name.trim() === '') {
          setError(t('renameEmpty'));
          return;
        }
        const original = directoryById.get(projectEditor.directoryId);
        const value = await runAction({
          action: 'update-directory',
          directoryId: projectEditor.directoryId,
          name: projectEditor.protected ? original?.name || projectEditor.name : projectEditor.name,
          remark: projectEditor.remark
        }, t('memorySaved'), projectEditor.directoryId);
        if (value === null) return;
        if (currentSessionId && original !== undefined && projectEditor.allSessionsForSession !== true && projectEditor.manualEnabled !== original.manualEnabled) {
          const enabledValue = await runAction({ action: 'set-session-directory', directoryId: projectEditor.directoryId, enabled: projectEditor.manualEnabled }, t('memorySaved'), projectEditor.directoryId);
          if (enabledValue === null) return;
        }
        setProjectEditor(null);
      };
      const beginEdit = (memory) => {
        setEditorNotice(null);
        setEditor({
          memoryId: memory.id,
          persisted: memory.persisted === true,
          text: memory.text || '',
          status: memory.status === 'active' ? 'active' : 'inactive',
          directoryId: memory.directoryId || directories[0]?.id || '',
          tagNames: memoryStringArray(memory.tags),
          pinned: memory.pinned === true,
          /* 事实时间：编辑器内用「日期 + 时间」两个输入框承载；空串 = 清除（未声明）。
             与卡片展示同源，避免「界面显示一个值、保存下去另一个值」。 */
          eventTime: memoryDateInputValue(memory.eventTime),
          eventClock: memoryClockInputValue(memory.eventTime),
          validUntil: memoryDateInputValue(memory.validUntil),
          validUntilClock: memoryClockInputValue(memory.validUntil)
        });
      };
      /* 美化格式：只改写编辑框文本，不触发保存；无法安全修复时保留原文并给出提示。 */
      const beautifyEditorText = () => {
        if (editor === null) return;
        const result = memoryBeautifyBody(editor.text);
        if (result.status === 'failed') {
          setError(t('memoryBeautifyFailed'));
          setEditorNotice(null);
          return;
        }
        setError(null);
        if (result.status === 'not-applicable') {
          setEditorNotice(t('memoryBeautifySkipped'));
          return;
        }
        if (result.status === 'already') {
          setEditorNotice(t('memoryBeautifyAlready'));
          return;
        }
        setEditor((current) => current && { ...current, text: result.text });
        setEditorNotice(t('memoryBeautifyDone'));
      };
      const toggleEditorTag = (tagName) => {
        setEditor((value) => {
          if (value === null) return value;
          const tags = new Set(memoryStringArray(value.tagNames));
          if (tags.has(tagName)) tags.delete(tagName);
          else tags.add(tagName);
          return { ...value, tagNames: [...tags] };
        });
      };
      const saveEditor = async () => {
        if (editor === null) return;
        if (memoryEditorNeedsJson(editor.text) && !memoryEditorJsonValid(editor.text)) {
          setError(t('memoryInvalidJson'));
          return;
        }
        if (editor.text.trim().length < MEMORY_MIN_TEXT_LENGTH) {
          setError(t('memoryInvalidText'));
          return;
        }
        /* 事实时间前端校验：日期/时间格式非法、时间无日期、或「失效早于生效」都当场拦下，
           不发请求（后端也会拒，但这里能给出更直接的提示）。 */
        const eventCheck = memoryValidateDateInput(editor.eventTime);
        const eventClockCheck = memoryValidateClockInput(editor.eventClock);
        const validCheck = memoryValidateDateInput(editor.validUntil);
        const validClockCheck = memoryValidateClockInput(editor.validUntilClock);
        if (!eventCheck.ok || !validCheck.ok) {
          setError(t('memoryInvalidDate'));
          return;
        }
        if (!eventClockCheck.ok || !validClockCheck.ok) {
          setError(t('memoryInvalidClock'));
          return;
        }
        if ((eventCheck.value === '' && eventClockCheck.value !== '') || (validCheck.value === '' && validClockCheck.value !== '')) {
          setError(t('memoryClockWithoutDate'));
          return;
        }
        const eventFactTime = memoryCombineFactTime(eventCheck.value, eventClockCheck.value);
        const validFactTime = memoryCombineFactTime(validCheck.value, validClockCheck.value);
        if (eventFactTime !== '' && validFactTime !== '' && validFactTime < eventFactTime) {
          setError(t('memoryInvalidDateOrder'));
          return;
        }
        /* 空串显式传下去 = 清除该字段（与「不传 = 保持不变」区分开）。 */
        const factTimeFields = { eventTime: eventFactTime, validUntil: validFactTime };
        const payload = editor.persisted
          ? { action: 'update-memory', memoryId: editor.memoryId, text: editor.text, status: editor.status, directoryId: editor.directoryId, tagNames: editor.tagNames, pinned: editor.pinned === true, ...factTimeFields }
          : { action: 'update-memory', memoryId: editor.memoryId, text: editor.text, status: editor.status, directoryId: editor.directoryId, tagNames: editor.tagNames, ...factTimeFields };
        /* editor 子键：与卡片上的状态/固定开关（同 action 不同入口）互不阻塞。 */
        const value = await runAction(payload, t('memorySaved'), `editor:${editor.memoryId}`);
        if (value !== null) {
          setEditor(null);
          setEditorNotice(null);
        }
      };
      const storeMemory = async (memory) => {
        const directoryId = memory.directoryId || (directoryFilter !== 'all' && directoryFilter !== 'ephemeral' ? directoryFilter : '') || directories[0]?.id || '';
        if (!directoryId) {
          setError(t('memoryNoDirectories'));
          return;
        }
        await runAction({ action: 'persist-memory', memoryId: memory.id, directoryId, status: memory.status === 'active' ? 'active' : 'inactive', tagNames: memoryStringArray(memory.tags) }, t('memoryStored'), memory.id);
      };
      const toggleMemoryStatus = (memory) => {
        void runAction({ action: 'update-memory', memoryId: memory.id, status: memory.status === 'active' ? 'inactive' : 'active' }, t('memorySaved'), `status:${memory.id}`);
      };
      /* 卡片上的固定注入开关：切换只改 pinned，不动正文/标签/目录。
         只认布尔取反，避免 undefined（老快照缺字段）被当成「已开启」而误关。 */
      const toggleMemoryPinned = (memory) => {
        void runAction({ action: 'update-memory', memoryId: memory.id, pinned: memory.pinned !== true }, t('memorySaved'), `pin:${memory.id}`);
      };
      const toggleTagStatus = (tag) => {
        if (tag?.preset === true) return;
        const nextStatus = memoryTagStatus(tag) === 'active' ? 'inactive' : 'active';
        void runAction({ action: 'set-tag-status', tagId: tag.id, status: nextStatus }, t('memorySaved'), tag.id);
      };
      const copyDirectoryId = async (directory) => {
        try {
          await navigator.clipboard?.writeText?.(directory.id);
          setCopiedDirectoryId(directory.id);
          setNotice(t('memoryCopied'));
          window.clearTimeout(directoryCopyTimer.current);
          directoryCopyTimer.current = window.setTimeout(() => setCopiedDirectoryId(null), 1600);
        } catch {
          setError(`${t('memoryFailed')}: ${directory.id}`);
        }
      };
      const renderSwitch = renderToggleSwitch;
      /* 复制“删除记忆”日志的正文（完整内容已写入日志，这里复制的就是完整摘要）。
         注意：memory_update 的 summary 可能是差异 JSON，必须先解析出正文再复制，避免抄出一坨 JSON。 */
      const copyLogSummary = async (item) => {
        const text = String(readActivitySummary(item?.summary).text ?? '');
        if (text === '') {
          setError(t('memoryLogCopyEmpty'));
          return;
        }
        try {
          await navigator.clipboard?.writeText?.(text);
          setCopiedLogId(item.id);
          setNotice(t('memoryLogCopied'));
          window.clearTimeout(logCopyTimer.current);
          logCopyTimer.current = window.setTimeout(() => setCopiedLogId(null), 1600);
        } catch {
          setError(`${t('memoryFailed')}: ${t('memoryLogCopy')}`);
        }
      };
      /* 复制「更新记忆」日志里的旧版本正文：正文有改动时 summary 是差异 JSON，
         旧版本正文就存在 before.text 里（readActivitySummary 已解析出来）。
         正文未变的更新不产生 diff，此时按钮不渲染。 */
      const copyLogBeforeText = async (item) => {
        const diff = readActivitySummary(item?.summary).diff;
        const text = String(diff?.before ?? '');
        if (text === '') {
          setError(t('memoryLogCopyBeforeEmpty'));
          return;
        }
        try {
          await navigator.clipboard?.writeText?.(text);
          setCopiedBeforeLogId(item.id);
          setNotice(t('memoryLogCopiedBefore'));
          window.clearTimeout(logCopyBeforeTimer.current);
          logCopyBeforeTimer.current = window.setTimeout(() => setCopiedBeforeLogId(null), 1600);
        } catch {
          setError(`${t('memoryFailed')}: ${t('memoryLogCopyBefore')}`);
        }
      };
      /* ── 正文版本历史 ── */
      const HISTORY_PAGE_SIZE = 10;
      const loadHistoryPage = async (memory, offset) => {
        setHistoryLoading(true);
        try {
          const value = await memoryPostAction(currentSessionId, {
            action: 'list-memory-revisions',
            memoryId: memory.id,
            limit: HISTORY_PAGE_SIZE,
            offset
          });
          const items = Array.isArray(value?.items) ? value.items : [];
          setHistoryItems((current) => (offset === 0 ? items : [...current, ...items]));
          setHistoryTotal(Number(value?.total) || 0);
          setHistoryHasMore(value?.hasMore === true);
        } catch (reason) {
          setError(`${t('memoryFailed')}: ${reason instanceof Error ? reason.message : String(reason)}`);
        } finally {
          setHistoryLoading(false);
        }
      };
      const openMemoryHistory = (memory) => {
        setHistoryTarget(memory);
        setHistoryItems([]);
        setHistoryTotal(0);
        setHistoryHasMore(false);
        setHistoryCopiedId(null);
        setHistoryConfirm(null);
        setHistoryDiffTarget(null);
        void loadHistoryPage(memory, 0);
      };
      const restoreMemoryRevision = async (revision) => {
        if (historyTarget === null || historyBusyId !== null) return;
        setHistoryBusyId(revision.id);
        try {
          const value = await memoryPostAction(currentSessionId, {
            action: 'restore-memory-revision',
            memoryId: historyTarget.id,
            revisionId: revision.id
          });
          setSnapshot(value);
          /* 当前正文已被替换，同步 historyTarget，否则顶部「当前版本」与差异基准仍是旧正文。 */
          if (value?.restored !== undefined && value.restored !== null) setHistoryTarget(value.restored);
          setNotice(t('memoryHistoryRestored'));
          /* 恢复本身会再产生一条修订（被替换掉的当前正文），故重新从第一页拉。 */
          await loadHistoryPage(historyTarget, 0);
        } catch (reason) {
          setError(`${t('memoryFailed')}: ${reason instanceof Error ? reason.message : String(reason)}`);
        } finally {
          setHistoryBusyId(null);
        }
      };
      const clearMemoryHistory = async () => {
        if (historyTarget === null || historyBusyId !== null) return;
        setHistoryBusyId('clear');
        try {
          const value = await memoryPostAction(currentSessionId, {
            action: 'clear-memory-revisions',
            memoryId: historyTarget.id
          });
          setHistoryItems([]);
          setHistoryTotal(0);
          setHistoryHasMore(false);
          setNotice(fillTemplate(t('memoryHistoryCleared'), { count: Number(value?.removed) || 0 }));
        } catch (reason) {
          setError(`${t('memoryFailed')}: ${reason instanceof Error ? reason.message : String(reason)}`);
        } finally {
          setHistoryBusyId(null);
        }
      };
      /* 删除单条历史版本：删完重拉第一页，避免分页游标错位。 */
      const deleteMemoryRevision = async (revision) => {
        if (historyTarget === null || historyBusyId !== null) return;
        setHistoryBusyId(revision.id);
        try {
          await memoryPostAction(currentSessionId, {
            action: 'delete-memory-revision',
            memoryId: historyTarget.id,
            revisionId: revision.id
          });
          setNotice(t('memoryHistoryDeleted'));
          await loadHistoryPage(historyTarget, 0);
        } catch (reason) {
          setError(`${t('memoryFailed')}: ${reason instanceof Error ? reason.message : String(reason)}`);
        } finally {
          setHistoryBusyId(null);
        }
      };
      /* 确认弹窗文案与执行体：三种破坏性操作共用同一个确认框。 */
      const historyConfirmSpec = (() => {
        if (historyConfirm === null) return null;
        if (historyConfirm.kind === 'clear') {
          return { message: fillTemplate(t('memoryHistoryClearConfirm'), { count: historyTotal }), label: t('memoryHistoryClear'), run: () => clearMemoryHistory() };
        }
        if (historyConfirm.kind === 'delete') {
          return { message: t('memoryHistoryDeleteConfirm'), label: t('memoryHistoryDelete'), run: () => deleteMemoryRevision(historyConfirm.revision) };
        }
        return { message: t('memoryHistoryRestoreConfirm'), label: t('memoryHistoryRestore'), danger: false, run: () => restoreMemoryRevision(historyConfirm.revision) };
      })();
      const confirmHistoryAction = async () => {
        const spec = historyConfirmSpec;
        setHistoryConfirm(null);
        if (spec !== null) await spec.run();
      };
      const copyRevisionText = async (revision) => {
        const text = String(revision?.text ?? '');
        if (text === '') return;
        try {
          await navigator.clipboard?.writeText?.(text);
          setHistoryCopiedId(revision.id);
          window.clearTimeout(historyCopyTimer.current);
          historyCopyTimer.current = window.setTimeout(() => setHistoryCopiedId(null), 1600);
        } catch {
          setError(`${t('memoryFailed')}: ${t('memoryHistoryCopy')}`);
        }
      };
      const historySourceLabel = (source) => t(`memoryHistorySource_${String(source || 'ui')}`) || t('memoryHistorySource_ui');
      const renderDirectory = (directory) => {
        const copied = copiedDirectoryId === directory.id;
        return react.createElement('article', { key: directory.id, className: 'dsh-session-kit-memory-directory-card' },
          react.createElement('div', { className: 'dsh-session-kit-memory-row-head' },
            react.createElement('button', { type: 'button', className: 'dsh-session-kit-memory-link-title', title: directory.name, onClick: () => openProjectEditor(directory) }, directory.name),
            react.createElement('span', { className: 'dsh-session-kit-memory-count', title: t('memoryProjectCountHelp') }, `${directory.activeMemoryCount || 0}/${directory.memoryCount || 0}`),
            react.createElement(primitives.Button, { variant: 'ghost', size: 'sm', className: `dsh-session-kit-memory-directory-copy${copied ? ' dsh-session-kit-memory-directory-copy-copied' : ''}`, icon: copied ? react.createElement(primitives.IconCheckOutlineRegular, { size: 14 }) : react.createElement(primitives.IconCopyOutlineRegular, { size: 14 }), onClick: () => void copyDirectoryId(directory), title: copied ? t('memoryCopied') : t('memoryCopyProjectId'), 'aria-label': copied ? t('memoryCopied') : t('memoryCopyProjectId') })
          ),
          /* 项目备注：仅非空时渲染（老数据/未填写不占位）；两行省略，悬浮 title 显示全文。 */
          typeof directory.remark === 'string' && directory.remark !== '' && react.createElement('div', {
            className: 'dsh-session-kit-memory-directory-remark',
            title: directory.remark
          }, directory.remark),
          react.createElement('div', { className: 'dsh-session-kit-memory-card-actions' },
            react.createElement('span', { className: 'dsh-session-kit-memory-directory-statuses' },
              directory.enabledForSession && react.createElement('span', { className: 'dsh-session-kit-memory-badge dsh-session-kit-memory-badge-active' }, t('memoryProjectActive')),
              directory.protected && react.createElement('span', { className: 'dsh-session-kit-memory-badge' }, t('memoryProjectProtected'))
            ),
            react.createElement(primitives.Button, {
              variant: 'outline',
              size: 'sm',
              className: 'dsh-session-kit-memory-manual-toggle-button',
              disabled: !currentSessionId || directory.allSessionsForSession === true || isActionBusy('set-session-directory', directory.id),
              'aria-pressed': directory.manualEnabled === true,
              'aria-label': directory.manualEnabled ? t('memoryManualOn') : t('memoryManualOff'),
              onClick: () => void runAction({ action: 'set-session-directory', directoryId: directory.id, enabled: !directory.manualEnabled }, t('memorySaved'), directory.id)
            }, renderSwitch(directory.manualEnabled === true), react.createElement('span', null, directory.manualEnabled ? t('memoryManualOn') : t('memoryManualOff'))),
            react.createElement(primitives.Button, { variant: 'outline', size: 'sm', onClick: () => openProjectEditor(directory) }, t('memoryEdit')),
            react.createElement(primitives.Button, { variant: 'outline', size: 'sm', className: 'dsh-session-kit-memory-danger-button', disabled: isActionBusy('delete-directory', directory.id) || directory.protected === true || Number(directory.memoryCount || 0) > 0, title: directory.protected === true ? t('memoryProjectProtected') : Number(directory.memoryCount || 0) > 0 ? t('memoryProjectHasMemories') : undefined, onClick: () => setDeleteTarget({ type: 'directory', id: directory.id, title: directory.name }) }, t('memoryDelete'))
          )
        );
      };
      const renderTag = (tag) => {
        const active = memoryTagStatus(tag) === 'active';
        return react.createElement('span', { key: tag.id, className: `dsh-session-kit-memory-tag-chip${active ? '' : ' dsh-session-kit-memory-tag-chip-inactive'}` },
          react.createElement(primitives.Button, {
            variant: 'outline',
            className: 'dsh-session-kit-memory-auto-distill-button dsh-session-kit-memory-tag-toggle-button',
            disabled: tag.preset === true || isActionBusy('set-tag-status', tag.id),
            'aria-pressed': active,
            'aria-label': active ? t('memoryActivated') : t('memoryDeactivated'),
            title: active ? t('memoryActivated') : t('memoryDeactivated'),
            onClick: () => toggleTagStatus(tag)
          }, renderSwitch(active), react.createElement('span', { className: 'dsh-session-kit-memory-tag-chip-label', title: tag.name }, tag.name)),
          !tag.preset && react.createElement(primitives.Button, {
            variant: 'outline',
            className: 'dsh-session-kit-memory-tag-delete-button',
            icon: react.createElement(primitives.IconCloseOutlineRegular, { size: 14 }),
            disabled: isActionBusy('delete-tag', tag.id),
            onClick: () => setDeleteTarget({ type: 'tag', id: tag.id, title: tag.name }),
            title: `${t('memoryDelete')} ${tag.name}`,
            'aria-label': `${t('memoryDelete')} ${tag.name}`
          })
        );
      };
      /* 标签勾选区的默认可见上限：超出后只显示提示，靠搜索/仅显示已选收敛。
         不改成滚动容器，避免弹窗内出现第二条独立滚动条。 */
      const TAG_CHECK_VISIBLE_LIMIT = 25;
      /* 标签勾选区（新建/编辑共用）：标题行是「标签（可多选）」+ 搜索框 + 仅显示已选。
         返回值拆成 { head, list }，由调用方放进各自的 label 里；这样标签多时
         头部行仍贴着标题，不会把搜索框推到几十行标签下面。 */
      /* disabled：由调用方传入所属弹窗自己的动作忙碌态（如 create-memory），
         只冻结该弹窗的标签勾选区，不影响其他区域。 */
      const renderTagChecks = (selectedNames, toggle, query, setQuery, onlySelected, setOnlySelected, disabled) => {
        const selected = memoryStringArray(selectedNames);
        const normalizedQuery = String(query || '').trim().toLocaleLowerCase();
        const matched = activeTags.filter((tag) => {
          if (onlySelected && !selected.includes(tag.name)) return false;
          if (normalizedQuery !== '' && !String(tag?.name || '').toLocaleLowerCase().includes(normalizedQuery)) return false;
          return true;
        });
        const visible = matched.slice(0, TAG_CHECK_VISIBLE_LIMIT);
        const head = react.createElement('div', { className: 'dsh-session-kit-memory-tag-picker-head' },
          react.createElement('span', { className: 'dsh-session-kit-memory-tag-picker-label' }, t('memorySelectTags')),
          react.createElement('input', {
            type: 'search',
            className: 'dsh-session-kit-memory-tag-picker-search',
            value: query,
            disabled: disabled || activeTags.length === 0,
            placeholder: t('memorySearchTags'),
            onChange: (event) => setQuery(event.currentTarget.value),
            'aria-label': t('memorySearchTags')
          }),
          react.createElement('label', { className: 'dsh-session-kit-memory-tag-picker-only' },
            react.createElement('input', {
              type: 'checkbox',
              checked: onlySelected,
              disabled: disabled || activeTags.length === 0,
              onChange: () => setOnlySelected(!onlySelected)
            }),
            react.createElement('span', null, t('memoryOnlySelectedTags'))
          )
        );
        let list;
        if (activeTags.length === 0) list = react.createElement('div', { className: 'dsh-session-kit-memory-muted' }, t('memoryTagsEmpty'));
        else if (matched.length === 0) list = react.createElement('div', { className: 'dsh-session-kit-memory-muted' }, t('memoryNoMatches'));
        else list = react.createElement('div', { className: 'dsh-session-kit-memory-checks' },
          visible.map((tag) => react.createElement('label', { key: tag.id, className: 'dsh-session-kit-memory-check' },
            react.createElement('input', { type: 'checkbox', checked: selected.includes(tag.name), disabled, onChange: () => toggle(tag.name) }),
            react.createElement('span', null, tag.name)
          )),
          /* 截断提示按剩余条数显示（而非总数-上限值），这样搜索收敛后提示会同步变小。 */
          matched.length > visible.length && react.createElement('div', { className: 'dsh-session-kit-memory-checks-more' },
            fillTemplate(t('memoryMoreTagsHint'), { rest: String(matched.length - visible.length) }))
        );
        return { head, list };
      };
      const renderMemory = (memory) => {
        const isPersisted = memory.persisted === true;
        return react.createElement('article', { key: `${isPersisted ? 'stored' : 'tmp'}:${memory.id}`, className: `dsh-session-kit-memory-card${isPersisted ? '' : ' dsh-session-kit-memory-card-ephemeral'}` },
          react.createElement('div', { className: 'dsh-session-kit-memory-card-top' },
            react.createElement('div', { className: 'dsh-session-kit-memory-badges' },
              /* 状态开关：就地切换 active/inactive，省掉卡片右侧那个「激活/停用」按钮的动作。
                 文案与编辑弹窗内的状态开关保持同构（已激活/已停用）。 */
              react.createElement(primitives.Button, {
                variant: 'outline',
                size: 'sm',
                className: `dsh-session-kit-memory-status-toggle${memory.status === 'active' ? ' dsh-session-kit-memory-status-toggle-on' : ''}`,
                disabled: isActionBusy('update-memory', `status:${memory.id}`),
                'aria-pressed': memory.status === 'active',
                'aria-label': t('memoryActive'),
                onClick: () => toggleMemoryStatus(memory)
              }, renderSwitch(memory.status === 'active'), react.createElement('span', null, memoryStatusLabel(t, memory.status))),
              memory.directoryId
                ? react.createElement('button', {
                  type: 'button',
                  className: 'dsh-session-kit-memory-badge dsh-session-kit-memory-badge-project dsh-session-kit-memory-badge-project-clickable',
                  title: t('memoryProjectFilterHint'),
                  'aria-label': `${t('memoryProjectFilterHint')}：${memory.directoryName || t('memoryNoDirectory')}`,
                  onClick: () => setTabProjectFilters((current) => {
                    /* 换项目时保留图钉的「只看固定注入」开关状态。 */
                    const pinned = current[memoryTab]?.pinned === true;
                    return { ...current, [memoryTab]: { directoryId: memory.directoryId, pinned } };
                  })
                }, memory.directoryName || t('memoryNoDirectory'))
                : react.createElement('span', { className: 'dsh-session-kit-memory-badge dsh-session-kit-memory-badge-project', title: memory.directoryName || '' }, memory.directoryName || t('memoryNoDirectory')),
              /* 固定注入开关：紧跟在项目名右侧，可直接在卡片上切换。
                 只对已存储记忆呈现——临时记忆没有 pinned 语义。 */
              isPersisted && react.createElement(primitives.Button, {
                variant: 'outline',
                size: 'sm',
                className: `dsh-session-kit-memory-pin-toggle${memory.pinned === true ? ' dsh-session-kit-memory-pin-toggle-on' : ''}`,
                disabled: isActionBusy('update-memory', `pin:${memory.id}`),
                title: t('memoryPinnedHelp'),
                'aria-pressed': memory.pinned === true,
                'aria-label': t('memoryPinned'),
                onClick: () => void toggleMemoryPinned(memory)
              }, renderSwitch(memory.pinned === true), react.createElement('span', null, t('memoryPinned')))
            ),
            react.createElement('div', { className: 'dsh-session-kit-memory-card-actions' },
              react.createElement(primitives.Button, { variant: 'outline', size: 'sm', disabled: !currentSessionId || isActionBusy('inject-memory', memory.id), onClick: () => setMemoryInjectTarget(memory) }, t('memoryInject')),
              /* 版本历史：只对已落盘记忆呈现（临时记忆不记录修订）。 */
              isPersisted && react.createElement(primitives.Button, {
                variant: 'outline',
                size: 'sm',
                className: 'dsh-session-kit-memory-history-button',
                icon: react.createElement(primitives.IconClockOutlineRegular, { size: 14 }),
                title: t('memoryHistory'),
                'aria-label': t('memoryHistory'),
                onClick: () => openMemoryHistory(memory)
              }, t('memoryHistory')),
              react.createElement(primitives.Button, { variant: 'outline', size: 'sm', onClick: () => beginEdit(memory) }, t('memoryEdit')),
              react.createElement(primitives.Button, { variant: 'outline', size: 'sm', className: 'dsh-session-kit-memory-danger-button', disabled: isActionBusy('delete-memory', memory.id), onClick: () => setDeleteTarget({ type: 'memory', id: memory.id, title: memory.text?.slice(0, 32) || memory.id }) }, t('memoryDelete'))
            )
          ),
          react.createElement('pre', { className: 'dsh-session-kit-memory-text' }, memory.text || ''),
          react.createElement('div', { className: 'dsh-session-kit-memory-meta' },
            react.createElement('div', { className: 'dsh-session-kit-memory-meta-row dsh-session-kit-memory-meta-tags-row' },
              react.createElement('span', { className: 'dsh-session-kit-memory-meta-tags' },
                memoryTagChips(memory, t, react.createElement)
              )
            ),
            memory.sourceSessionId && react.createElement('div', { className: 'dsh-session-kit-memory-meta-row' }, react.createElement('span', null, fillTemplate(t('memorySource'), { title: memory.sourceSessionTitle || '-', id: memory.sourceSessionId }))),
            react.createElement('div', { className: 'dsh-session-kit-memory-meta-row dsh-session-kit-memory-meta-time-row' },
              react.createElement('span', null, fillTemplate(t('memoryCreatedAt'), { time: memoryTime(memory.createdAt) })),
              react.createElement('span', null, fillTemplate(t('memoryUpdatedAt'), { time: memoryTime(memory.updatedAt) })),
              /* 事实时间：卡片底部不展开显示具体日期（需要看详情去编辑框），
                 只在「声明了 validUntil 且已过期」时显示黄色徽标「（事件已过期）」——
                 过期不等于无效（问历史时它仍是答案），所以不隐藏记忆本身。 */
              Number(memory.validUntil) > 0 && Date.now() > Number(memory.validUntil) && react.createElement('span', { className: 'dsh-session-kit-memory-meta-facttime-expired' }, t('memoryFactTimeExpiredBadge')),
               isPersisted && react.createElement('span', { className: 'dsh-session-kit-memory-meta-creation-method' }, fillTemplate(t('memoryCreationMethod'), { method: memoryCreationMethodLabel(t, memory.creationMethod) })),
              !isPersisted && react.createElement('span', { className: 'dsh-session-kit-memory-usage' }, memoryItemUsageText(memory, t)),
              isPersisted && react.createElement('span', { className: 'dsh-session-kit-memory-usage dsh-session-kit-memory-meta-lastrecalled' }, fillTemplate(t('memoryLastRecalledAt'), { time: memory.lastRecalledAt > 0 ? memoryTime(memory.lastRecalledAt) : '-' }))
            )
          ),
          !isPersisted && react.createElement('div', { className: 'dsh-session-kit-memory-card-store-row' },
            react.createElement('span', { className: 'dsh-session-kit-memory-usage' }, fillTemplate(t('memoryLastRecalledAt'), { time: memory.lastRecalledAt > 0 ? memoryTime(memory.lastRecalledAt) : '-' })),
            react.createElement(primitives.Button, { variant: 'outline', size: 'sm', disabled: directories.length === 0 || isActionBusy('persist-memory', memory.id), title: memory.directoryName || undefined, onClick: () => void storeMemory(memory) }, t('memoryStore'))
          )
        );
      };
      const renderPagination = (id, pageInfo) => pageInfo.pageCount <= 1 ? null : react.createElement('div', { className: 'dsh-session-kit-memory-pagination' },
        react.createElement(primitives.Button, { variant: 'outline', size: 'sm', disabled: pageInfo.page <= 1, onClick: () => setMemoryPage(id, pageInfo.page - 1) }, t('memoryPrevPage')),
        react.createElement('span', { className: 'dsh-session-kit-memory-pagination-text' }, fillTemplate(t('memoryPagination'), { page: pageInfo.page, pages: pageInfo.pageCount, total: pageInfo.total })),
        react.createElement(primitives.Button, { variant: 'outline', size: 'sm', disabled: pageInfo.page >= pageInfo.pageCount, onClick: () => setMemoryPage(id, pageInfo.page + 1) }, t('memoryNextPage'))
      );
      const memoryStatusCounts = (items, isActive) => {
        const active = items.filter((item) => isActive(item) === true).length;
        return { active, inactive: items.length - active };
      };
      /* 持久化记忆激活占比：按项目精确计数求和（不受 1200 条快照截断影响） */
      let activationTotal = 0;
      let activationActive = 0;
      for (const directory of directories) {
        activationTotal += Number(directory.memoryCount) || 0;
        activationActive += Number(directory.activeMemoryCount) || 0;
      }
      const activationInactive = activationTotal - activationActive;
      const activationPercent = activationTotal > 0 ? Math.round((activationActive / activationTotal) * 100) : null;
      const renderActivationDonut = () => {
        const radius = 30;
        const circumference = 2 * Math.PI * radius;
        const activeLength = activationPercent === null ? 0 : (activationPercent / 100) * circumference;
        const centerLabel = activationPercent === null ? '—' : `${activationPercent}%`;
        const ariaLabel = activationPercent === null
          ? t('memoryActivationTitle')
          : `${t('memoryActivationTitle')} ${activationPercent}% · ${t('memoryActivated')} ${activationActive} / ${activationTotal}`;
        return react.createElement('div', { className: 'dsh-session-kit-memory-tabs-footer' },
          react.createElement('div', { className: 'dsh-session-kit-memory-donut-title' }, t('memoryPersistedListTitle')),
          react.createElement('div', { className: 'dsh-session-kit-memory-donut-title' }, t('memoryActivationTitle')),
          react.createElement('div', { className: 'dsh-session-kit-memory-donut-wrap' },
            react.createElement('svg', { className: 'dsh-session-kit-memory-donut', viewBox: '0 0 72 72', role: 'img', 'aria-label': ariaLabel },
              react.createElement('circle', { cx: 36, cy: 36, r: radius, fill: 'none', strokeWidth: 8, className: 'dsh-session-kit-memory-donut-track' }),
              activeLength > 0 && react.createElement('circle', {
                cx: 36,
                cy: 36,
                r: radius,
                fill: 'none',
                strokeWidth: 8,
                strokeLinecap: 'round',
                className: 'dsh-session-kit-memory-donut-active',
                strokeDasharray: `${activeLength} ${circumference - activeLength}`,
                transform: 'rotate(-90 36 36)'
              })
            ),
            react.createElement('span', { className: 'dsh-session-kit-memory-donut-center' }, centerLabel)
          ),
          react.createElement('div', { className: 'dsh-session-kit-memory-donut-legend' },
            /* 上下两行统计：文字与数字分列对齐（两行的文字左对齐、数字右对齐）。
               原先「已激活 3」连写成一个 span，数字宽度随位数变化导致两行错位。 */
            react.createElement('span', { className: 'dsh-session-kit-memory-donut-legend-row dsh-session-kit-memory-donut-legend-active' },
              react.createElement('span', { className: 'dsh-session-kit-memory-donut-legend-label' }, t('memoryActivated')),
              react.createElement('span', { className: 'dsh-session-kit-memory-donut-legend-value' }, String(activationActive))
            ),
            react.createElement('span', { className: 'dsh-session-kit-memory-donut-legend-row dsh-session-kit-memory-donut-legend-inactive' },
              react.createElement('span', { className: 'dsh-session-kit-memory-donut-legend-label' }, t('memoryDeactivated')),
              react.createElement('span', { className: 'dsh-session-kit-memory-donut-legend-value' }, String(activationInactive))
            )
          )
        );
      };
      /* 项目筛选胶囊：样式与「标签」页的标签胶囊同款，把开关换成搜索图标；
         图钉切换「只看固定注入」（默认无色轮廓，激活变有色实心），X 清除筛选。 */
      const projectFilterChip = (tabKey) => {
        const filter = tabProjectFilters[tabKey];
        if (!filter || !filter.directoryId) return null;
        const name = directoryById.get(filter.directoryId)?.name || filter.directoryId;
        const pinnedOnly = filter.pinned === true;
        return react.createElement('span', { key: 'project-filter', className: 'dsh-session-kit-memory-tag-chip dsh-session-kit-memory-project-filter-chip' },
          react.createElement('span', { className: 'dsh-session-kit-memory-project-filter-head' },
            react.createElement(primitives.IconSearchOutlineRegular, { size: 12, 'aria-hidden': 'true' }),
            /* 固定注入只对已存储记忆存在——「临时」列表的胶囊不显示图钉。 */
            tabKey === 'memories' && react.createElement('button', {
              type: 'button',
              className: `dsh-session-kit-memory-project-filter-pin${pinnedOnly ? ' dsh-session-kit-memory-project-filter-pin-active' : ''}`,
              'aria-pressed': pinnedOnly,
              'aria-label': t('memoryProjectFilterPinned'),
              title: t('memoryProjectFilterPinned'),
              onClick: () => setTabProjectFilters((current) => ({ ...current, [tabKey]: { ...current[tabKey], pinned: current[tabKey].pinned !== true } }))
            }, '📌'),
            react.createElement('span', { className: 'dsh-session-kit-memory-tag-chip-label', title: name }, name)
          ),
          react.createElement(primitives.Button, {
            variant: 'outline',
            className: 'dsh-session-kit-memory-tag-delete-button',
            icon: react.createElement(primitives.IconCloseOutlineRegular, { size: 12 }),
            'aria-label': t('memoryProjectFilterClear'),
            title: t('memoryProjectFilterClear'),
            onClick: () => setTabProjectFilters((current) => ({ ...current, [tabKey]: { directoryId: '', pinned: false } }))
          })
        );
      };
      const renderSectionHeader = (title, counts, filterChip) => react.createElement('div', { className: 'dsh-session-kit-memory-section-title' },
        react.createElement('span', { className: 'dsh-session-kit-memory-section-name-group' },
          react.createElement('span', { className: 'dsh-session-kit-memory-section-name' }, title),
          filterChip !== undefined ? filterChip : null
        ),
        react.createElement('span', { className: 'dsh-session-kit-memory-section-counts' },
          react.createElement('span', { className: 'dsh-session-kit-memory-section-count dsh-session-kit-memory-section-count-active' }, `${t('memoryActivated')} ${counts.active}`),
          react.createElement('span', { className: 'dsh-session-kit-memory-section-count dsh-session-kit-memory-section-count-inactive' }, `${t('memoryDeactivated')} ${counts.inactive}`)
        ),
        react.createElement('span', { 'aria-hidden': 'true' })
      );
      const renderMemoryCollection = (id, title, pageInfo, emptyText, totalCount, counts, filterChip) => react.createElement(react.Fragment, null,
        renderSectionHeader(title, counts, filterChip),
        pageInfo.total === 0
          ? react.createElement('div', { className: 'dsh-session-kit-archive-empty' }, normalizedMemorySearch && totalCount > 0 ? t('memoryNoMatches') : emptyText)
          : react.createElement(react.Fragment, null,
            react.createElement('div', { className: 'dsh-session-kit-memory-list' }, pageInfo.items.map(renderMemory)),
            renderPagination(id, pageInfo)
          )
      );
      const usageWindowItems = [
        { id: 'today', label: t('memoryUsageToday') },
        { id: 'week', label: t('memoryUsageWeek') },
        { id: 'month', label: t('memoryUsageMonth') },
        { id: 'recent', label: t('memoryUsageRecent') }
      ];
      const usageChart = (title, entries, total) => react.createElement('div', { className: 'dsh-session-kit-memory-usage-chart' },
        react.createElement(UsageDonut, { entries }),
        react.createElement('div', { className: 'dsh-session-kit-memory-usage-legend' },
          react.createElement('div', { className: 'dsh-session-kit-memory-section-title' }, title),
          react.createElement('div', { className: 'dsh-session-kit-memory-usage-legend-grid' }, entries.map((entry) => {
            const percent = Math.round(entry.value / Math.max(1, total) * 100);
            return react.createElement('div', { key: entry.label, className: 'dsh-session-kit-memory-usage-legend-row' },
              react.createElement('span', { className: 'dsh-session-kit-memory-usage-dot', style: { background: entry.color } }),
              react.createElement('span', { className: 'dsh-session-kit-memory-usage-legend-label', title: entry.label }, entry.label),
              react.createElement('span', { className: 'dsh-session-kit-memory-usage-legend-value' }, `${formatUsageNumber(entry.value)} · ${percent}%`)
            );
          }))
        )
      );
      const usageEntries = (items, toLabel) => {
        const entries = (Array.isArray(items) ? items : [])
          .map((entry) => ({ label: toLabel(entry), value: Number(entry.tokens) || 0 }))
          .filter((entry) => entry.value > 0);
        if (entries.length <= 5) return entries.map((entry, index) => ({ ...entry, color: USAGE_PIE_COLORS[index % USAGE_PIE_COLORS.length] }));
        const visible = entries.slice(0, 5);
        const otherValue = entries.slice(5).reduce((sum, entry) => sum + entry.value, 0);
        return [...visible, { label: t('memoryUsageOther'), value: otherValue }]
          .map((entry, index) => ({ ...entry, color: USAGE_PIE_COLORS[index % USAGE_PIE_COLORS.length] }));
      };
      const renderUsageOverview = () => {
        const activeWindow = usageOverview?.[usagePeriod] ?? { total: 0, models: [], kinds: [], projects: [] };
        const total = Number(activeWindow.total) || 0;
        const modelEntries = usageEntries(activeWindow.models, (entry) => entry.key || t('memoryUsageUnknownModel'));
        const kindEntries = usageEntries(activeWindow.kinds, (entry) => entry.key === 'auto-distill' ? t('memoryUsageKindAuto') : entry.key === 'manual-distill' ? t('memoryUsageKindManual') : entry.key === 'memory-conflict' ? t('memoryUsageKindConflict') : entry.key === 'memory_add' ? 'memory_add' : entry.key || t('memoryUsageUnknownModel'));
        const projectEntries = usageEntries(activeWindow.projects, (entry) => entry.name || t('memoryUsageUnknownProject'));
        const hasData = modelEntries.length > 0 || kindEntries.length > 0 || projectEntries.length > 0;
        return react.createElement('div', { className: 'dsh-session-kit-memory-usage' },
          react.createElement('div', { className: 'dsh-session-kit-memory-section-title' }, t('memoryUsageTitle')),
          !usageLoading && !hasData && react.createElement('div', { className: 'dsh-session-kit-archive-empty' }, t('memoryUsageEmpty')),
          (usageLoading || usageOverview !== null) && react.createElement('div', { className: 'dsh-session-kit-memory-usage-cards' },
            usageWindowItems.map((item) => react.createElement('button', {
              key: item.id,
              type: 'button',
              className: `dsh-session-kit-memory-usage-card${usagePeriod === item.id ? ' dsh-session-kit-memory-usage-card-active' : ''}`,
              onClick: () => {
                if (usagePeriod === item.id) setUsageCompact((value) => !value);
                else setUsagePeriod(item.id);
              },
            },
              react.createElement('span', { className: 'dsh-session-kit-memory-usage-card-label' }, item.label),
              react.createElement('span', { className: 'dsh-session-kit-memory-usage-card-value' }, formatUsageNumber(usageOverview?.[item.id]?.total ?? 0))
            ))
          ),
          !usageLoading && hasData && modelEntries.length > 0 && usageChart(t('memoryUsageModels'), modelEntries, total),
          !usageLoading && hasData && kindEntries.length > 0 && usageChart(t('memoryUsageKinds'), kindEntries, total),
          !usageLoading && hasData && projectEntries.length > 0 && usageChart(t('memoryUsageProjects'), projectEntries, total)
        );
      };
      const renderTabPanel = () => {
        if (memoryTab === 'overview') return renderUsageOverview();
        if (memoryTab === 'projects') return react.createElement(react.Fragment, null,
          renderSectionHeader(t('memoryDirectoryListTitle'), memoryStatusCounts(visibleDirectories, (directory) => directory.enabledForSession === true)),
          projectPage.total === 0
            ? react.createElement('div', { className: 'dsh-session-kit-archive-empty' }, directories.length === 0 ? t('memoryNoDirectories') : t('memoryNoMatches'))
            : react.createElement(react.Fragment, null,
              react.createElement('div', { className: 'dsh-session-kit-memory-directory-list' }, projectPage.items.map(renderDirectory)),
              renderPagination('projects', projectPage)
            )
        );
        if (memoryTab === 'temporary') return renderMemoryCollection('temporary', t('memoryEphemeralListTitle'), temporaryPage, t('memoryTemporaryEmpty'), memories.filter((memory) => memory.persisted !== true).length, memoryStatusCounts(visibleTemporaryMemories, (memory) => memory.status === 'active'), projectFilterChip('temporary'));
        if (memoryTab === 'memories') return renderMemoryCollection('memories', t('memoryPersistedListTitle'), persistedPage, t('memoryPersistedEmpty'), memories.filter((memory) => memory.persisted === true).length, memoryStatusCounts(visiblePersistedMemories, (memory) => memory.status === 'active'), projectFilterChip('memories'));
        if (memoryTab === 'progress') return react.createElement('div', { className: 'dsh-session-kit-memory-activity-list' },
          progressItems.length === 0 ? react.createElement('div', { className: 'dsh-session-kit-archive-empty' }, t('memoryNoActivities')) : progressItems.map((item) => react.createElement('article', { key: item.id, className: 'dsh-session-kit-memory-activity-card' },
            react.createElement('div', { className: 'dsh-session-kit-memory-activity-head' }, react.createElement('strong', null, memoryActivityKindLabel(t, item)), react.createElement('span', { className: `dsh-session-kit-memory-badge${memoryActivityBadgeClass(item.status)}` }, t(`memoryActivityStatus_${item.status}`) || item.status)),
            (item.sessionTitle || item.sessionId) && react.createElement('div', { className: 'dsh-session-kit-memory-muted dsh-session-kit-memory-activity-summary' }, `${item.sessionTitle || t('memoryUnknownSession')} · ${item.sessionId || '-'}`),
            react.createElement('div', { className: 'dsh-session-kit-memory-muted dsh-session-kit-memory-activity-summary' }, (() => {
              const parsed = readActivitySummary(item.summary);
              return parsed.text || (item.kind === 'distill' || item.kind === 'memory_add' || item.kind === 'directory_create' || item.kind === 'directory_update' || item.kind === 'directory_delete' || item.kind === 'tag_create' || item.kind === 'tag_update' || item.kind === 'tag_delete' ? t('memoryActivityPendingSummary') : item.kind === 'memory_update' || item.kind === 'memory_delete' || item.kind === 'memory_revision_delete' || item.kind === 'memory_conflict_missed' ? t('memoryActivityMemorySummary') : '-');
            })()),
            react.createElement('div', { className: 'dsh-session-kit-memory-muted dsh-session-kit-memory-activity-time' }, `${t('memoryActivityStartedAt')}：${formatActivityClockTime(item.startedAt) || '-'} · ${t('memoryActivityElapsed')}：${memoryActivityElapsedText(t, item.startedAt, progressTick)}`)
          ))
        );
        if (memoryTab === 'logs') return react.createElement('div', { className: 'dsh-session-kit-memory-logs' },
          react.createElement('div', { className: 'dsh-session-kit-memory-logs-bar' },
            react.createElement('div', { className: 'dsh-session-kit-memory-section-title dsh-session-kit-memory-logs-title' }, t('memoryLogsRetentionHint')),
            react.createElement(primitives.Button, { variant: 'outline', size: 'sm', className: 'dsh-session-kit-memory-logs-clear', disabled: loading || logItems.length === 0 || isActionBusy('clear-activity-logs'), onClick: () => setClearLogsOpen(true) }, isActionBusy('clear-activity-logs') ? t('memoryLogsClearing') : t('memoryLogsClear'))
          ),
          react.createElement('div', { className: 'dsh-session-kit-memory-activity-list' },
            logItems.length === 0 ? react.createElement('div', { className: 'dsh-session-kit-archive-empty' }, t('memoryNoActivityLogs')) : logItems.map((item) => react.createElement('article', { key: item.id, className: 'dsh-session-kit-memory-activity-card' },
              react.createElement('div', { className: 'dsh-session-kit-memory-activity-head' },
                react.createElement('span', { className: 'dsh-session-kit-memory-activity-head-main' },
                  react.createElement('strong', null, memoryActivityKindLabel(t, item)),
                  /* 删除记忆 / 删除记忆版本：标题右侧复制按钮，复制该条日志的完整正文
                     （版本删除的 summary 存的就是被删掉的版本正文，可直接复制回来）。 */
                  (item.kind === 'memory_delete' || item.kind === 'memory_revision_delete') && react.createElement(primitives.Button, {
                    variant: 'ghost',
                    size: 'sm',
                    className: `dsh-session-kit-memory-activity-copy${copiedLogId === item.id ? ' dsh-session-kit-memory-activity-copy-copied' : ''}`,
                    icon: copiedLogId === item.id ? react.createElement(primitives.IconCheckOutlineRegular, { size: 14 }) : react.createElement(primitives.IconCopyOutlineRegular, { size: 14 }),
                    onClick: () => void copyLogSummary(item),
                    title: copiedLogId === item.id ? t('memoryLogCopied') : t('memoryLogCopy'),
                    'aria-label': copiedLogId === item.id ? t('memoryLogCopied') : t('memoryLogCopy')
                  }),
                  /* 更新记忆且正文确实变了（summary 是差异 JSON）：复制旧版本正文。
                     正文未变的更新不产生 diff，不渲染此按钮。 */
                  item.kind === 'memory_update' && readActivitySummary(item.summary).diff !== null && react.createElement(primitives.Button, {
                    variant: 'ghost',
                    size: 'sm',
                    className: `dsh-session-kit-memory-activity-copy dsh-session-kit-memory-activity-copy-text${copiedBeforeLogId === item.id ? ' dsh-session-kit-memory-activity-copy-copied' : ''}`,
                    icon: copiedBeforeLogId === item.id ? react.createElement(primitives.IconCheckOutlineRegular, { size: 14 }) : react.createElement(primitives.IconCopyOutlineRegular, { size: 14 }),
                    onClick: () => void copyLogBeforeText(item),
                    title: copiedBeforeLogId === item.id ? t('memoryLogCopiedBefore') : t('memoryLogCopyBefore'),
                    'aria-label': copiedBeforeLogId === item.id ? t('memoryLogCopiedBefore') : t('memoryLogCopyBefore')
                  }, t(copiedBeforeLogId === item.id ? 'memoryLogCopiedBefore' : 'memoryLogCopyBefore'))
                ),
                react.createElement('span', { className: `dsh-session-kit-memory-badge${memoryActivityBadgeClass(item.outcome)}` }, t(`memoryActivityStatus_${item.outcome}`) || item.outcome)
              ),
              (item.sessionTitle || item.sessionId) && react.createElement('div', { className: 'dsh-session-kit-memory-muted dsh-session-kit-memory-activity-summary' }, `${item.sessionTitle || t('memoryUnknownSession')} · ${item.sessionId || '-'}`),
              item.summary ? (() => {
                const parsed = readActivitySummary(item.summary);
                return react.createElement(MemoryActivitySummary, { text: parsed.text, diff: parsed.diff, className: 'dsh-session-kit-memory-muted', t });
              })() : react.createElement('div', { className: 'dsh-session-kit-memory-muted dsh-session-kit-memory-activity-summary' }, '-'),
              (item.errorMessage || item.errorCode) && react.createElement('div', { className: 'dsh-session-kit-memory-activity-error' }, `${t('memoryActivityErrorReason')}：${[item.errorCode, item.errorMessage].filter(Boolean).join(' · ') || '-'}`),
              react.createElement('div', { className: 'dsh-session-kit-memory-muted dsh-session-kit-memory-activity-time' }, `${t('memoryActivityTime')}：${formatArchiveTime(item.createdAt) || '-'}`),
              logHasMore && item === logItems[logItems.length - 1] && react.createElement(primitives.Button, { variant: 'outline', size: 'sm', onClick: () => void loadActivity('logs', logBefore, true) }, t('memoryLoadMore'))
            ))
          )
        );
        if (memoryTab === 'settings') return react.createElement('div', { className: 'dsh-session-kit-memory-settings dsh-session-kit-memory-panel' },
          react.createElement('div', { className: 'dsh-session-kit-memory-section-title' }, t('memorySettings')),
          /* 记忆蒸馏使用模型：与其他模块（记忆召回设置、记忆保存目录设置）保持一致的卡片外观。
             与「DSH 设置 › session-kit」共用 DistillModelSettingsCard —— UI 只有一份实现，
             两处的差异只在容器 class（variant='memory'）与状态来源。 */
          react.createElement(DistillModelSettingsCard, {
            t,
            variant: 'memory',
            current: snapshot?.distillModelOverride ?? null,
            draft: distillModelDraft,
            onDraftChange: setDistillModelDraft,
            groups: modelDirectoryState.groups,
            directoryStatus: modelDirectoryState.status,
            loading,
            saving: isActionBusy('set-distill-model'),
            onSave: () => runAction({ action: 'set-distill-model', modelSelection: distillModelDraft }, t('memorySaved'))
          }),
          /* 记忆召回设置：与「DSH 设置 › session-kit」共用 RecallSettingsCard ——
             UI 与配额计算都只有一份实现（计算走模块级纯函数 recallSettingsFor*）。 */
          react.createElement(RecallSettingsCard, {
            t,
            variant: 'memory',
            settings: recallSettings,
            onSettingsChange: (next) => { recallSettingsDirtyRef.current = true; setRecallSettingsDraft(next); },
            loading,
            saving: isActionBusy('set-recall-settings'),
            onSave: () => {
              recallSettingsDirtyRef.current = false;
              return runAction({ action: 'set-recall-settings', recallSettings }, t('memorySaved'));
            }
          }),
          /* 记忆保存目录设置：与「DSH 设置 › session-kit」共用 StorageSettingsCard ——
             UI 只有一份实现。它走独立路由（记忆库可迁出 memory.sqlite 之外），
             故数据加载与保存由本弹窗注入（loadStorageDir / saveStorageDir / chooseStorageDir）。 */
          react.createElement(StorageSettingsCard, {
            t,
            variant: 'memory',
            value: storageDir,
            draft: storageDirDraft,
            onDraftChange: (next) => { setStorageDirNotice(null); setStorageDirError(null); setStorageDirDraft(next); },
            notice: storageDirNotice,
            error: storageDirError,
            loading,
            saving: storageSaving,
            picking: storagePicking,
            onPick: chooseStorageDir,
            onSave: saveStorageDir
          }),
          /* Embedding 语义检索：与 DSH 设置页共用同一个组件（variant='memory' 换卡片外观）。
             降级（接口失败→纯词法）、回填（首次开启自动补算历史记忆）、换模型重建
             全部由宿主端自动处理，此处只需开关 + 连接配置。 */
          react.createElement(EmbeddingSettingsModule, { t, variant: 'memory', onSaved: () => void load() })
        );
        return react.createElement(react.Fragment, null,
          renderSectionHeader(t('memoryTagListTitle'), memoryStatusCounts(visibleTags, (tag) => memoryTagStatus(tag) === 'active')),
          /* 默认标签区：固定置顶，不参与分页，也不被分页控件改动。 */
          visiblePresetTags.length > 0 && react.createElement('div', { className: 'dsh-session-kit-memory-tag-list dsh-session-kit-memory-tag-list-panel' }, visiblePresetTags.map(renderTag)),
          /* 分隔线：把「默认标签」与「自定义标签」两段视觉上分开。
             标签搜索已由弹窗顶部的全局搜索框覆盖，此处不再重复提供。 */
          react.createElement('div', { className: 'dsh-session-kit-memory-tag-separator' }),
          visibleCustomTags.length === 0
            ? react.createElement('div', { className: 'dsh-session-kit-archive-empty' }, tags.length === 0 ? t('memoryTagsEmpty') : t('memoryNoMatches'))
            : tagPage.items.length === 0
              ? react.createElement('div', { className: 'dsh-session-kit-archive-empty' }, t('memoryNoMatches'))
              : react.createElement(react.Fragment, null,
                react.createElement('div', { className: 'dsh-session-kit-memory-tag-list dsh-session-kit-memory-tag-list-panel' }, tagPage.items.map(renderTag)),
                renderPagination('tags', tagPage)
              )
        );
      };
      const confirmMemoryInject = async () => {
        if (memoryInjectTarget === null) return;
        const target = memoryInjectTarget;
        setMemoryInjectTarget(null);
        if (!currentSessionId) {
          setNotice(t('memoryInjectNoSession'));
          return;
        }
        const actionId = `inject-memory:${target.id}`;
        if (busyActionsRef.current.has(actionId)) return;
        beginActionBusy(actionId);
        setError(null);
        setNotice(null);
        try {
          const value = await memoryPostAction(currentSessionId, { action: 'inject-memory', memoryId: target.id });
          if (value?.injection?.duplicate) setNotice(t('memoryAlreadyInjected'));
          else if (value?.injection?.injected) setNotice(t('memoryInjected'));
          else setNotice(t('memoryInjectFailed'));
          if (value && Array.isArray(value.memories)) setSnapshot(value);
        } catch (reason) {
          setError(`${t('memoryInjectFailed')}: ${reason instanceof Error ? reason.message : String(reason)}`);
        } finally {
          endActionBusy(actionId);
        }
      };

      const confirmDelete = async () => {
        if (deleteTarget === null) return;
        const target = deleteTarget;
        setDeleteTarget(null);
        if (target.type === 'directory') await runAction({ action: 'delete-directory', directoryId: target.id }, t('memoryDeleted'), target.id);
        else if (target.type === 'tag') await runAction({ action: 'delete-tag', tagId: target.id }, t('memoryDeleted'), target.id);
        else await runAction({ action: 'delete-memory', memoryId: target.id }, t('memoryDeleted'), target.id);
        if (target.type === 'directory' && directoryFilter === target.id) setDirectoryFilter('all');
      };
      const editorDirectory = editor?.directoryId ? directoryById.get(editor.directoryId) : undefined;
      const activeErrorLayer = newMemoryOpen ? 'newMemory' : newDirectoryOpen ? 'newDirectory' : newTagOpen ? 'newTag' : projectEditor !== null ? 'projectEditor' : editor !== null ? 'editor' : null;
      /* 各子弹窗自己的动作忙碌态：只冻结所属弹窗的控件，不影响弹窗外的其他按钮。 */
      const newMemorySaving = isActionBusy('create-memory');
      const newDirectorySaving = isActionBusy('create-directory');
      const newTagSaving = isActionBusy('create-tag');
      const projectEditorSaving = projectEditor !== null && (isActionBusy('update-directory', projectEditor.directoryId) || isActionBusy('set-session-directory', projectEditor.directoryId));
      const editorSaving = editor !== null && isActionBusy('update-memory', `editor:${editor.memoryId}`);
      const renderFormError = (layer) => react.createElement('div', { className: 'dsh-session-kit-memory-form-error-slot' },
        error !== null && activeErrorLayer === layer ? react.createElement('div', { role: 'alert', className: 'dsh-session-kit-memory-form-error' }, error) : null
      );
      /* 编辑记忆的错误与“美化格式”提示共用一个反馈槽；只有同时存在时才叠加两条高度。 */
      const renderEditorFeedback = () => react.createElement('div', { className: 'dsh-session-kit-memory-form-error-slot dsh-session-kit-memory-form-feedback-slot' },
        error !== null && activeErrorLayer === 'editor' ? react.createElement('div', { role: 'alert', className: 'dsh-session-kit-memory-form-error' }, error) : null,
        editorNotice !== null && react.createElement('div', { role: 'status', className: 'dsh-session-kit-memory-form-notice' }, editorNotice)
      );
      return react.createElement(react.Fragment, null,
        react.createElement(primitives.Modal, {
          open,
          onClose,
          title: react.createElement(ModalTitleWithEntryToggle, {
            title: t('memoryTitle'),
            visible: sidebarEntries?.memoryVisible,
            onToggleVisible: (memoryVisible) => updateSidebarEntries?.({ ...sidebarEntries, memoryVisible }),
            label: t(sidebarEntries?.memoryVisible === false ? 'memoryHideSidebarEntry' : 'memoryShowSidebarEntry'),
            t
          }),
          closeLabel: t('memoryClose'),
          className: 'dsh-session-kit-memory-modal',
          children: react.createElement('div', { className: 'dsh-session-kit-memory' },
            notice && react.createElement('div', { role: 'status', className: 'dsh-session-kit-compaction-success dsh-session-kit-modal-title-notice' }, notice),
            activeErrorLayer === null && error && react.createElement('div', { role: 'alert', className: 'dsh-session-kit-compaction-error dsh-session-kit-modal-title-notice' }, error),
            react.createElement('p', { className: 'dsh-session-kit-compaction-desc' }, t('memoryDesc')),
            snapshot && react.createElement('p', { className: 'dsh-session-kit-memory-store-info' }, fillTemplate(t('memoryStoreInfo'), { path: snapshot.dbPath || '-', mode: retrievalModeText(snapshot, t) })),
            loading && !loadedOnceRef.current && react.createElement('div', { className: 'dsh-session-kit-archive-empty' }, t('memoryLoading')),
            (!loading || loadedOnceRef.current) && react.createElement(react.Fragment, null,
              react.createElement('div', { className: 'dsh-session-kit-memory-toolbar' },
                react.createElement('div', { className: 'dsh-session-kit-archive-search' },
                  react.createElement('input', {
                    className: 'dsh-session-kit-archive-search-input',
                    value: search,
                    placeholder: t('memorySearchPlaceholder'),
                    onChange: (event) => setSearch(event.currentTarget.value),
                    'aria-label': t('memorySearchPlaceholder')
                  }),
                  search !== '' && react.createElement('button', { type: 'button', className: 'dsh-session-kit-archive-search-clear', onClick: () => setSearch(''), 'aria-label': t('archiveSearchClear'), title: t('archiveSearchClear') }, react.createElement(primitives.IconCloseOutlineRegular, { size: 14 }))
                ),
                react.createElement('div', { className: 'dsh-session-kit-memory-top-actions' },
                  react.createElement(primitives.Button, { variant: 'outline', size: 'md', onClick: () => setNewDirectoryOpen(true) }, t('memoryNewDirectory')),
                  react.createElement(primitives.Button, { variant: 'outline', size: 'md', onClick: () => setNewTagOpen(true) }, t('memoryNewTag')),
                  react.createElement(primitives.Button, { variant: 'outline', size: 'md', disabled: directories.length === 0, onClick: () => { setNewMemoryNotice(null); setNewMemoryDirectoryId(directoryFilter !== 'all' && directoryFilter !== 'ephemeral' ? directoryFilter : directories[0]?.id || ''); setNewMemoryOpen(true); } }, t('memoryNewMemory'))
                )
              ),
              react.createElement('div', { className: 'dsh-session-kit-memory-grid' },
                react.createElement('nav', { className: 'dsh-session-kit-memory-tabs', 'aria-label': t('memoryTitle') },
                  tabItems.map((item) => react.createElement('button', {
                    key: item.id,
                    type: 'button',
                    className: `dsh-session-kit-memory-tab${memoryTab === item.id ? ' dsh-session-kit-memory-tab-active' : ''}`,
                    'aria-current': memoryTab === item.id ? 'page' : undefined,
                    onClick: () => setMemoryTab(item.id)
                  },
                    react.createElement('span', { className: 'dsh-session-kit-memory-tab-label' }, item.label),
                    item.count !== undefined && react.createElement('span', { className: 'dsh-session-kit-memory-tab-count' }, item.count)
                  )),
                  renderActivationDonut()
                ),
                react.createElement('main', { className: 'dsh-session-kit-memory-main' }, renderTabPanel())
              )
            )
          ),
          footer: react.createElement(react.Fragment, null,
            react.createElement('span', { className: 'dsh-session-kit-memory-footer-left' },
              react.createElement(primitives.Button, { variant: 'outline', className: 'dsh-session-kit-memory-auto-distill-button', disabled: loading || isActionBusy('set-auto-distill'), 'aria-pressed': autoDistillEnabled, onClick: () => void runAction({ action: 'set-auto-distill', enabled: !autoDistillEnabled }, t('memorySaved')) }, renderSwitch(autoDistillEnabled), react.createElement('span', null, t('memoryAutoDistill'))),
              react.createElement(primitives.Button, { variant: 'outline', className: 'dsh-session-kit-memory-all-sessions-button', disabled: loading || isActionBusy('set-all-sessions-enabled'), 'aria-pressed': allSessionsDirectoryEnabled, onClick: () => void runAction({ action: 'set-all-sessions-enabled', enabled: !allSessionsDirectoryEnabled }, t('memorySaved')) }, renderSwitch(allSessionsDirectoryEnabled), react.createElement('span', null, t('memoryAllSessionsDirectory'))),
              react.createElement(primitives.Button, { variant: 'outline', className: 'dsh-session-kit-memory-first-match-button', disabled: loading || isActionBusy('set-first-turn-auto-match'), 'aria-pressed': firstTurnAutoMatchEnabled, onClick: () => void runAction({ action: 'set-first-turn-auto-match', enabled: !firstTurnAutoMatchEnabled }, t('memorySaved')) }, renderSwitch(firstTurnAutoMatchEnabled), react.createElement('span', null, t('memoryFirstTurnAutoMatch')))
            ),
            react.createElement(primitives.Button, {
              variant: 'outline',
              disabled: loading || !currentSessionId || isActionBusy('distill-now'),
              icon: isActionBusy('distill-now') ? react.createElement(DistillHourglassIcon, { size: 16 }) : react.createElement(primitives.IconSparkleRegular, { size: 16 }),
              onClick: () => {
                const selection = getModelSelection?.(currentSessionId);
                void runAction({ action: 'distill-now', ...(selection ? { modelSelection: selection } : {}) }, t('memoryDistillDone'));
              }
            }, t('memoryDistillNow')),
            react.createElement(primitives.Button, { variant: 'outline', onClick: onClose }, t('memoryClose'))
          )
        }),
        react.createElement(primitives.Modal, {
          open: open && newMemoryOpen,
          onClose: () => { if (!newMemorySaving) { setNewMemoryOpen(false); setNewMemoryNotice(null); } },
          title: t('memoryNewMemory'),
          closeLabel: t('memoryCancel'),
          className: 'dsh-session-kit-memory-form-modal dsh-session-kit-memory-editor-modal',
          children: react.createElement('div', { className: 'dsh-session-kit-memory-form' },
            react.createElement('div', { className: 'dsh-session-kit-memory-form-error-slot dsh-session-kit-memory-form-feedback-slot' },
              error !== null && activeErrorLayer === 'newMemory' ? react.createElement('div', { role: 'alert', className: 'dsh-session-kit-memory-form-error' }, error) : null,
              newMemoryNotice !== null && react.createElement('div', { role: 'status', className: 'dsh-session-kit-memory-form-notice' }, newMemoryNotice)
            ),
            react.createElement('div', { className: 'dsh-session-kit-global-prompt-field' },
              react.createElement('div', { className: 'dsh-session-kit-memory-editor-head' },
                react.createElement('label', { htmlFor: 'dsh-session-kit-new-memory-text' }, t('memoryText')),
                react.createElement(primitives.Button, {
                  variant: 'outline',
                  size: 'sm',
                  className: 'dsh-session-kit-memory-beautify-button',
                  disabled: newMemoryText.trim() === '',
                  title: t('memoryBeautifyFormat'),
                  onClick: beautifyNewMemoryText
                }, t('memoryBeautifyFormat'))
              ),
              react.createElement('textarea', { id: 'dsh-session-kit-new-memory-text', className: 'dsh-session-kit-global-prompt-textarea dsh-session-kit-memory-editor-textarea', value: newMemoryText, disabled: newMemorySaving, rows: 5, onChange: (event) => { setNewMemoryText(event.currentTarget.value); setNewMemoryNotice(null); }, 'aria-label': t('memoryText') })
            ),
            react.createElement('label', { className: 'dsh-session-kit-global-prompt-field' },
              react.createElement('span', null, t('memorySelectDirectory')),
              react.createElement(MemorySelect, { value: newMemoryDirectoryId, options: directories.length === 0 ? [{ value: '', label: t('memoryNoDirectories'), disabled: true }] : directoryOptions, disabled: newMemorySaving || directories.length === 0, placeholder: t('memorySelectDirectory'), ariaLabel: t('memorySelectDirectory'), searchable: true, searchPlaceholder: t('memorySearchDirectories'), onChange: setNewMemoryDirectoryId })
            ),
            react.createElement('div', { className: 'dsh-session-kit-memory-form-status' },
              react.createElement(primitives.Button, {
                variant: 'outline',
                size: 'sm',
                className: 'dsh-session-kit-memory-manual-toggle-button',
                disabled: newMemorySaving,
                'aria-pressed': newMemoryStatus === 'active',
                'aria-label': t('memoryActive'),
                onClick: () => setNewMemoryStatus(newMemoryStatus === 'active' ? 'inactive' : 'active')
              }, renderSwitch(newMemoryStatus === 'active'), react.createElement('span', null, newMemoryStatus === 'active' ? t('memoryActivated') : t('memoryDeactivated')))
            ),
            /* 事实时间（可选）：与编辑弹窗同款。每组 = 一行「标签 + 日期框 + 时间框」，
               时间框无独立标签（它的含义由同行标签 + placeholder 表达），避免右侧多出一行说明。
               留空即未声明——留空的 validUntil 让记忆永不过期，留空的 eventTime 表示「状态陈述」。 */
            react.createElement('div', { className: 'dsh-session-kit-memory-form-facttime' },
              react.createElement('div', { className: 'dsh-session-kit-memory-facttime-row' },
                react.createElement('span', { className: 'dsh-session-kit-memory-facttime-label' }, t('memoryEventTimeLabel')),
                /* 原生日期控件：type=date 会忽略 placeholder（浏览器自绘 mm/dd/yyyy 占位），
                   故占位说明改挂在 title 上；值恒为 YYYY-MM-DD，空串 = 未声明。 */
                react.createElement('input', {
                  type: 'date',
                  className: 'dsh-session-kit-rename-input dsh-session-kit-memory-date-input',
                  value: newMemoryEventTime,
                  disabled: newMemorySaving,
                  title: t('memoryEventTimePlaceholder'),
                  onChange: (event) => { setNewMemoryEventTime(event.currentTarget.value); setNewMemoryNotice(null); },
                  'aria-label': t('memoryEventTimeLabel')
                }),
                react.createElement('input', {
                  type: 'text',
                  className: 'dsh-session-kit-rename-input dsh-session-kit-memory-clock-input',
                  value: newMemoryEventClock,
                  disabled: newMemorySaving,
                  placeholder: t('memoryClockPlaceholder'),
                  title: t('memoryEventClockHint'),
                  onChange: (event) => { setNewMemoryEventClock(event.currentTarget.value); setNewMemoryNotice(null); },
                  'aria-label': t('memoryEventClockLabel')
                })
              ),
              react.createElement('div', { className: 'dsh-session-kit-memory-facttime-row' },
                react.createElement('span', { className: 'dsh-session-kit-memory-facttime-label' }, t('memoryValidUntilLabel')),
                react.createElement('input', {
                  type: 'date',
                  className: 'dsh-session-kit-rename-input dsh-session-kit-memory-date-input',
                  value: newMemoryValidUntil,
                  disabled: newMemorySaving,
                  title: t('memoryValidUntilPlaceholder'),
                  onChange: (event) => { setNewMemoryValidUntil(event.currentTarget.value); setNewMemoryNotice(null); },
                  'aria-label': t('memoryValidUntilLabel')
                }),
                react.createElement('input', {
                  type: 'text',
                  className: 'dsh-session-kit-rename-input dsh-session-kit-memory-clock-input',
                  value: newMemoryValidUntilClock,
                  disabled: newMemorySaving,
                  placeholder: t('memoryClockPlaceholder'),
                  title: t('memoryValidUntilClockHint'),
                  onChange: (event) => { setNewMemoryValidUntilClock(event.currentTarget.value); setNewMemoryNotice(null); },
                  'aria-label': t('memoryValidUntilClockLabel')
                })
              )
            ),
            react.createElement('div', { className: 'dsh-session-kit-memory-tag-picker-field' },
              (() => { const picker = renderTagChecks(newMemoryTagNames, toggleNewMemoryTag, newMemoryTagQuery, setNewMemoryTagQuery, newMemoryTagOnlySelected, setNewMemoryTagOnlySelected, newMemorySaving); return [picker.head, picker.list]; })()
            )
          ),
          footer: react.createElement(react.Fragment, null,
            react.createElement(primitives.Button, { variant: 'outline', disabled: newMemorySaving, onClick: () => { setNewMemoryOpen(false); setNewMemoryNotice(null); } }, t('memoryCancel')),
            react.createElement(primitives.Button, { variant: 'outline', disabled: newMemorySaving || newMemoryText.trim() === '' || !newMemoryDirectoryId, onClick: () => void createMemory() }, newMemorySaving ? t('memorySaving') : t('memorySave'))
          )
        }),
        react.createElement(primitives.Modal, {
          open: open && newDirectoryOpen,
          onClose: () => { if (!newDirectorySaving) setNewDirectoryOpen(false); },
          title: t('memoryNewDirectory'),
          closeLabel: t('memoryCancel'),
          className: 'dsh-session-kit-memory-form-modal',
          children: react.createElement('div', { className: 'dsh-session-kit-memory-form' },
            renderFormError('newDirectory'),
            react.createElement('label', { className: 'dsh-session-kit-global-prompt-field' },
              react.createElement('span', null, t('memoryDirectoryName')),
              react.createElement('input', { className: 'dsh-session-kit-rename-input', value: newDirectoryName, disabled: newDirectorySaving, onChange: (event) => setNewDirectoryName(event.currentTarget.value), 'aria-label': t('memoryDirectoryName') })
            ),
            react.createElement('label', { className: 'dsh-session-kit-global-prompt-field' },
              react.createElement('span', null, t('memoryRemark')),
              react.createElement('textarea', { className: 'dsh-session-kit-memory-mini-textarea', value: newDirectoryRemark, disabled: newDirectorySaving, rows: 2, maxLength: 500, placeholder: t('memoryRemarkPlaceholder'), onChange: (event) => setNewDirectoryRemark(event.currentTarget.value), 'aria-label': t('memoryRemark') })
            )
          ),
          footer: react.createElement(react.Fragment, null,
            react.createElement(primitives.Button, { variant: 'outline', disabled: newDirectorySaving, onClick: () => setNewDirectoryOpen(false) }, t('memoryCancel')),
            react.createElement(primitives.Button, { variant: 'outline', disabled: newDirectorySaving || newDirectoryName.trim() === '', onClick: () => void createDirectory() }, newDirectorySaving ? t('memorySaving') : t('memoryCreate'))
          )
        }),
        react.createElement(primitives.Modal, {
          open: open && newTagOpen,
          onClose: () => { if (!newTagSaving) setNewTagOpen(false); },
          title: t('memoryNewTag'),
          closeLabel: t('memoryCancel'),
          className: 'dsh-session-kit-memory-form-modal',
          children: react.createElement('div', { className: 'dsh-session-kit-memory-form' },
            renderFormError('newTag'),
            react.createElement('label', { className: 'dsh-session-kit-global-prompt-field' },
              react.createElement('span', null, t('memoryTagName')),
              react.createElement('input', { className: 'dsh-session-kit-rename-input', value: newTagName, disabled: newTagSaving, onChange: (event) => setNewTagName(event.currentTarget.value), 'aria-label': t('memoryTagName') })
            )
          ),
          footer: react.createElement(react.Fragment, null,
            react.createElement(primitives.Button, { variant: 'outline', disabled: newTagSaving, onClick: () => setNewTagOpen(false) }, t('memoryCancel')),
            react.createElement(primitives.Button, { variant: 'outline', disabled: newTagSaving || newTagName.trim() === '', onClick: () => void createTag() }, newTagSaving ? t('memorySaving') : t('memoryCreate'))
          )
        }),
        projectEditor && react.createElement(primitives.Modal, {
          open: open && projectEditor !== null,
          onClose: () => { if (!projectEditorSaving) setProjectEditor(null); },
          title: t('memoryEditProject'),
          closeLabel: t('memoryCancel'),
          className: 'dsh-session-kit-memory-form-modal',
          children: react.createElement('div', { className: 'dsh-session-kit-memory-form' },
            renderFormError('projectEditor'),
            react.createElement('label', { className: 'dsh-session-kit-global-prompt-field' },
              react.createElement('span', null, t('memoryDirectoryName')),
              react.createElement('input', { className: 'dsh-session-kit-rename-input', value: projectEditor.name, disabled: projectEditorSaving || projectEditor.protected, onChange: (event) => { const value = event.currentTarget.value; setProjectEditor((current) => current && { ...current, name: value }); }, 'aria-label': t('memoryDirectoryName') })
            ),
            react.createElement('label', { className: 'dsh-session-kit-global-prompt-field' },
              react.createElement('span', null, t('memoryRemark')),
              react.createElement('textarea', { className: 'dsh-session-kit-memory-mini-textarea', value: projectEditor.remark, disabled: projectEditorSaving, rows: 2, maxLength: 500, placeholder: t('memoryRemarkPlaceholder'), onChange: (event) => { const value = event.currentTarget.value; setProjectEditor((current) => current && { ...current, remark: value }); }, 'aria-label': t('memoryRemark') })
            ),
            react.createElement(primitives.Button, {
              variant: 'outline',
              size: 'sm',
              className: 'dsh-session-kit-memory-manual-toggle-button',
              disabled: projectEditorSaving || !currentSessionId || projectEditor.allSessionsForSession === true,
              'aria-pressed': projectEditor.manualEnabled === true,
              onClick: () => setProjectEditor((current) => current && { ...current, manualEnabled: !current.manualEnabled })
            },
              renderSwitch(projectEditor.manualEnabled === true),
              react.createElement('span', null, projectEditor.manualEnabled === true ? t('memoryManualOn') : t('memoryManualOff'))
            )
          ),
          footer: react.createElement(react.Fragment, null,
            react.createElement(primitives.Button, { variant: 'outline', disabled: projectEditorSaving, onClick: () => setProjectEditor(null) }, t('memoryCancel')),
            react.createElement(primitives.Button, { variant: 'outline', disabled: projectEditorSaving || projectEditor.name.trim() === '', onClick: () => void saveProjectEditor() }, projectEditorSaving ? t('memorySaving') : t('memorySave'))
          )
        }),
        editor && react.createElement(primitives.Modal, {
          open: open && editor !== null,
          onClose: () => { if (!editorSaving) { setEditor(null); setEditorNotice(null); } },
          title: t('memoryEdit'),
          closeLabel: t('memoryCancel'),
          className: 'dsh-session-kit-memory-form-modal dsh-session-kit-memory-editor-modal',
          children: react.createElement('div', { className: 'dsh-session-kit-memory-form' },
            renderEditorFeedback(),
            react.createElement('div', { className: 'dsh-session-kit-global-prompt-field' },
              react.createElement('div', { className: 'dsh-session-kit-memory-editor-head' },
                react.createElement('label', { htmlFor: `dsh-session-kit-memory-editor-text-${editor.memoryId}` }, t('memoryText')),
                editor !== null && react.createElement(primitives.Button, {
                  variant: 'outline',
                  size: 'sm',
                  className: 'dsh-session-kit-memory-beautify-button',
                  disabled: editor.text.trim() === '',
                  title: t('memoryBeautifyFormat'),
                  onClick: beautifyEditorText
                }, t('memoryBeautifyFormat'))
              ),
              react.createElement('textarea', { id: `dsh-session-kit-memory-editor-text-${editor.memoryId}`, className: 'dsh-session-kit-global-prompt-textarea dsh-session-kit-memory-editor-textarea', value: editor.text, disabled: editorSaving, rows: 5, onChange: (event) => { const value = event.currentTarget.value; setEditor((current) => current && { ...current, text: value }); setEditorNotice(null); }, 'aria-label': t('memoryText') })
            ),
            react.createElement('label', { className: 'dsh-session-kit-global-prompt-field' },
              react.createElement('span', null, t('memorySelectDirectory')),
              react.createElement(MemorySelect, { value: editor.directoryId, options: directoryOptions, disabled: editorSaving || directories.length === 0, placeholder: editorDirectory?.name || t('memorySelectDirectory'), ariaLabel: t('memorySelectDirectory'), searchable: true, searchPlaceholder: t('memorySearchDirectories'), onChange: (value) => setEditor((current) => current && { ...current, directoryId: value }) })
            ),
            react.createElement('div', { className: 'dsh-session-kit-memory-form-status' },
              react.createElement(primitives.Button, {
                variant: 'outline',
                size: 'sm',
                className: 'dsh-session-kit-memory-manual-toggle-button',
                disabled: editorSaving,
                'aria-pressed': editor.status === 'active',
                'aria-label': t('memoryActive'),
                onClick: () => setEditor((current) => current && { ...current, status: current.status === 'active' ? 'inactive' : 'active' })
              }, renderSwitch(editor.status === 'active'), react.createElement('span', null, editor.status === 'active' ? t('memoryActivated') : t('memoryDeactivated')))
            ),
            /* 固定注入开关：与卡片顶部那个是同一个字段的两处入口，编辑时无需关掉弹窗去卡片上切。
               文案用「已固定/未固定」表达当前状态（与上方状态开关的「已激活/已停用」同构）；
               卡片顶部那个是操作入口，仍用「固定注入」动作名。
               只对已存储记忆呈现——临时记忆没有 pinned 语义。 */
            editor.persisted && react.createElement('div', { className: 'dsh-session-kit-memory-form-status' },
              react.createElement(primitives.Button, {
                variant: 'outline',
                size: 'sm',
                className: 'dsh-session-kit-memory-manual-toggle-button',
                disabled: editorSaving,
                title: t('memoryPinnedHelp'),
                'aria-pressed': editor.pinned === true,
                'aria-label': t('memoryPinned'),
                onClick: () => setEditor((current) => current && { ...current, pinned: current.pinned !== true })
              }, renderSwitch(editor.pinned === true), react.createElement('span', null, editor.pinned === true ? t('memoryPinnedOn') : t('memoryPinnedOff')))
            ),
            /* 事实时间（可选）：每组一行「标签 + 日期框 + 时间框」。
               时间框自己不占标签（含义由同行标签与 placeholder 表达），避免多出一行说明。
               两者都可留空：留空的 validUntil = 长期有效，留空的 eventTime = 状态陈述无发生时刻。 */
            react.createElement('div', { className: 'dsh-session-kit-memory-form-facttime' },
              react.createElement('div', { className: 'dsh-session-kit-memory-facttime-row' },
                react.createElement('span', { className: 'dsh-session-kit-memory-facttime-label' }, t('memoryEventTimeLabel')),
                /* 原生日期控件：type=date 忽略 placeholder，说明文字挂 title；
                   值恒为 YYYY-MM-DD（与后端解析口径一致），空串 = 未声明。 */
                react.createElement('input', {
                  type: 'date',
                  className: 'dsh-session-kit-rename-input dsh-session-kit-memory-date-input',
                  value: editor.eventTime,
                  disabled: editorSaving,
                  title: t('memoryEventTimePlaceholder'),
                  onChange: (event) => { const value = event.currentTarget.value; setEditor((current) => current && { ...current, eventTime: value }); },
                  'aria-label': t('memoryEventTimeLabel')
                }),
                react.createElement('input', {
                  type: 'text',
                  className: 'dsh-session-kit-rename-input dsh-session-kit-memory-clock-input',
                  value: editor.eventClock,
                  disabled: editorSaving,
                  placeholder: t('memoryClockPlaceholder'),
                  title: t('memoryEventClockHint'),
                  onChange: (event) => { const value = event.currentTarget.value; setEditor((current) => current && { ...current, eventClock: value }); },
                  'aria-label': t('memoryEventClockLabel')
                })
              ),
              react.createElement('div', { className: 'dsh-session-kit-memory-facttime-row' },
                react.createElement('span', { className: 'dsh-session-kit-memory-facttime-label' }, t('memoryValidUntilLabel')),
                react.createElement('input', {
                  type: 'date',
                  className: 'dsh-session-kit-rename-input dsh-session-kit-memory-date-input',
                  value: editor.validUntil,
                  disabled: editorSaving,
                  title: t('memoryValidUntilPlaceholder'),
                  onChange: (event) => { const value = event.currentTarget.value; setEditor((current) => current && { ...current, validUntil: value }); },
                  'aria-label': t('memoryValidUntilLabel')
                }),
                react.createElement('input', {
                  type: 'text',
                  className: 'dsh-session-kit-rename-input dsh-session-kit-memory-clock-input',
                  value: editor.validUntilClock,
                  disabled: editorSaving,
                  placeholder: t('memoryClockPlaceholder'),
                  title: t('memoryValidUntilClockHint'),
                  onChange: (event) => { const value = event.currentTarget.value; setEditor((current) => current && { ...current, validUntilClock: value }); },
                  'aria-label': t('memoryValidUntilClockLabel')
                })
              )
            ),
            react.createElement('div', { className: 'dsh-session-kit-memory-tag-picker-field' },
              (() => { const picker = renderTagChecks(editor.tagNames, toggleEditorTag, editorTagQuery, setEditorTagQuery, editorTagOnlySelected, setEditorTagOnlySelected, editorSaving); return [picker.head, picker.list]; })()
            )
          ),
          footer: react.createElement(react.Fragment, null,
            react.createElement(primitives.Button, { variant: 'outline', disabled: editorSaving, onClick: () => { setEditor(null); setEditorNotice(null); } }, t('memoryCancel')),
            react.createElement(primitives.Button, { variant: 'outline', disabled: editorSaving || editor.text.trim() === '', onClick: () => void saveEditor() }, editorSaving ? t('memorySaving') : t('memorySave'))
          )
        }),
        historyTarget !== null && react.createElement(primitives.Modal, {
          open: open && historyTarget !== null,
          onClose: () => { if (historyBusyId === null) { setHistoryTarget(null); setHistoryDiffTarget(null); } },
          title: t('memoryHistoryTitle'),
          closeLabel: t('memoryCancel'),
          className: 'dsh-session-kit-memory-history-modal',
          children: react.createElement('div', { className: 'dsh-session-kit-memory-history' },
            /* 当前版本置顶：历史列表只含「被替换掉的」正文，当前正文在 memories 表里。 */
            react.createElement('div', { className: 'dsh-session-kit-memory-history-item dsh-session-kit-memory-history-item-current' },
              react.createElement('div', { className: 'dsh-session-kit-memory-history-head' },
                react.createElement('span', { className: 'dsh-session-kit-memory-history-badge' }, t('memoryHistoryCurrent')),
                react.createElement('span', { className: 'dsh-session-kit-memory-history-meta' }, t('memoryHistoryCurrentHint'))
              ),
              react.createElement('pre', { className: 'dsh-session-kit-memory-history-text' }, historyTarget.text || '')
            ),
            !historyLoading && historyItems.length === 0 && react.createElement('div', { className: 'dsh-session-kit-memory-muted' }, t('memoryHistoryEmpty')),
            historyItems.map((revision) => {
              const busy = historyBusyId !== null;
              return react.createElement('div', {
                key: revision.id,
                className: 'dsh-session-kit-memory-history-item'
              },
                react.createElement('div', { className: 'dsh-session-kit-memory-history-head' },
                  react.createElement('span', { className: 'dsh-session-kit-memory-history-meta' },
                    `${formatArchiveTime(revision.replacedAt) || '-'} · ${historySourceLabel(revision.replacedBy)}`),
                  react.createElement(primitives.Button, {
                    variant: 'ghost',
                    size: 'sm',
                    className: `dsh-session-kit-memory-activity-copy${historyCopiedId === revision.id ? ' dsh-session-kit-memory-activity-copy-copied' : ''}`,
                    icon: historyCopiedId === revision.id ? react.createElement(primitives.IconCheckOutlineRegular, { size: 14 }) : react.createElement(primitives.IconCopyOutlineRegular, { size: 14 }),
                    title: t('memoryHistoryCopy'),
                    'aria-label': t('memoryHistoryCopy'),
                    onClick: () => void copyRevisionText(revision)
                  }),
                  react.createElement(primitives.Button, {
                    variant: 'outline',
                    size: 'sm',
                    className: `dsh-session-kit-memory-history-diff-button${historyDiffTarget?.id === revision.id ? ' dsh-session-kit-memory-history-diff-on' : ''}`,
                    title: t('memoryHistoryDiff'),
                    'aria-label': t('memoryHistoryDiff'),
                    'aria-pressed': historyDiffTarget?.id === revision.id,
                    onClick: () => setHistoryDiffTarget((current) => (current?.id === revision.id ? null : revision))
                  }, t('memoryHistoryDiff')),
                  react.createElement(primitives.Button, {
                    variant: 'outline',
                    size: 'sm',
                    disabled: busy,
                    onClick: () => setHistoryConfirm({ kind: 'restore', revision })
                  }, historyBusyId === revision.id ? t('memorySaving') : t('memoryHistoryRestore')),
                  react.createElement(primitives.Button, {
                    variant: 'outline',
                    size: 'sm',
                    className: 'dsh-session-kit-memory-danger-button dsh-session-kit-memory-history-delete-button',
                    icon: react.createElement(primitives.IconTrashOutlineRegular, { size: 14 }),
                    disabled: busy,
                    title: t('memoryHistoryDelete'),
                    'aria-label': t('memoryHistoryDelete'),
                    onClick: () => setHistoryConfirm({ kind: 'delete', revision })
                  })
                ),
                react.createElement('pre', { className: 'dsh-session-kit-memory-history-text' }, revision.text || ''),
                /* 差异块：把该版本当 before、当前正文当 after，复用活动日志那套红绿行级渲染。 */
                historyDiffTarget?.id === revision.id && react.createElement('div', { className: 'dsh-session-kit-memory-history-diff' },
                  react.createElement('div', { className: 'dsh-session-kit-memory-history-diff-hint' }, t('memoryHistoryDiffHint')),
                  react.createElement(MemoryActivityDiff, {
                    diff: { before: String(revision.text ?? ''), after: String(historyTarget.text ?? ''), fields: [] },
                    t
                  })
                )
              );
            }),
            historyHasMore && react.createElement(primitives.Button, {
              variant: 'outline',
              size: 'sm',
              disabled: historyLoading,
              onClick: () => void loadHistoryPage(historyTarget, historyItems.length)
            }, historyLoading ? t('memoryLoading') : t('memoryLoadMore'))
          ),
          footer: react.createElement(react.Fragment, null,
            react.createElement('span', { className: 'dsh-session-kit-memory-history-count' },
              fillTemplate(t('memoryHistoryCount'), { count: historyTotal })),
            react.createElement(primitives.Button, {
              variant: 'outline',
              disabled: historyBusyId !== null || historyTotal === 0,
              onClick: () => setHistoryConfirm({ kind: 'clear' })
            }, historyBusyId === 'clear' ? t('memorySaving') : t('memoryHistoryClear')),
            react.createElement(primitives.Button, { variant: 'outline', onClick: () => setHistoryTarget(null) }, t('memoryCancel'))
          )
        }),
        /* 三种破坏性操作（恢复/删除单条/清空）共用同一个确认框。 */
        react.createElement(DeleteConfirmDialog, {
          open: open && historyConfirm !== null,
          t,
          title: historyConfirmSpec?.label || t('memoryHistoryTitle'),
          message: historyConfirmSpec?.message || '',
          confirmLabel: historyConfirmSpec?.label,
          danger: historyConfirmSpec?.danger !== false,
          busy: historyBusyId !== null,
          onCancel: () => setHistoryConfirm(null),
          onConfirm: () => void confirmHistoryAction()
        }),
        react.createElement(DeleteConfirmDialog, {
          open: open && memoryInjectTarget !== null,
          t,
          title: t('memoryInject'),
          message: t('memoryInjectConfirm'),
          confirmLabel: t('memoryInject'),
          onCancel: () => setMemoryInjectTarget(null),
          onConfirm: () => void confirmMemoryInject()
        }),
        react.createElement(DeleteConfirmDialog, {
          open: open && deleteTarget !== null,
          t,
          title: t('memoryDelete'),
          message: deleteTarget?.type === 'directory'
            ? fillTemplate(t('memoryConfirmDeleteDirectory'), { name: deleteTarget?.title || '' })
            : deleteTarget?.type === 'tag'
              ? fillTemplate(t('memoryConfirmDeleteTag'), { name: deleteTarget?.title || '' })
              : t('memoryConfirmDelete'),
          confirmLabel: t('memoryDelete'),
          onCancel: () => setDeleteTarget(null),
          onConfirm: () => void confirmDelete()
        }),
        react.createElement(DeleteConfirmDialog, {
          open: open && clearLogsOpen,
          t,
          title: t('memoryLogsClearConfirmTitle'),
          message: t('memoryLogsClearConfirmDesc'),
          confirmLabel: t('memoryLogsClear'),
          onCancel: () => setClearLogsOpen(false),
          onConfirm: () => void confirmClearLogs()
        })
      );
    }

    /* 标题栏右侧的“复制会话ID”。Modal 的 header 是固定结构（h2 + 关闭按钮），
       没有插槽，故把 title 传成 flex 节点：标题文字与按钮并排，CSS 让 h2 撑满，
       按钮即呈现在标题右边。复制结果的提示按用户要求放在底部、与“关闭”同一行。 */
    function ToolStatsDialog({ open, t, stats, loading, error, onClose, sessionId }) {
      const toolCalls = normalizeToolCalls(stats?.toolCalls);
      const total = Number.isFinite(Number(stats?.total)) ? Number(stats.total) : toolCalls.reduce((sum, entry) => sum + entry.count, 0);
      const success = Number.isFinite(Number(stats?.success)) ? Number(stats.success) : toolCalls.reduce((sum, entry) => sum + entry.success, 0);
      const failed = Number.isFinite(Number(stats?.failed)) ? Number(stats.failed) : toolCalls.reduce((sum, entry) => sum + entry.failed, 0);
      const pending = Number.isFinite(Number(stats?.pending)) ? Number(stats.pending) : toolCalls.reduce((sum, entry) => sum + entry.pending, 0);
      const [copyState, setCopyState] = react.useState(null);
      const copyTimer = react.useRef(0);
      /* 关闭对话框时清掉计时器，避免在已卸载的组件上置状态。 */
      react.useEffect(() => () => { window.clearTimeout(copyTimer.current); }, []);
      /* 每次打开重新开始，不残留上一次的提示。 */
      react.useEffect(() => {
        if (open) return;
        window.clearTimeout(copyTimer.current);
        setCopyState(null);
      }, [open]);
      const copySessionId = async () => {
        window.clearTimeout(copyTimer.current);
        const text = String(sessionId ?? '').trim();
        if (text === '') {
          setCopyState({ kind: 'error', text: t('statsSessionIdMissing') });
          return;
        }
        let ok = false;
        try {
          ok = (await primitives.writeClipboard(text)) !== false;
        } catch {
          ok = false;
        }
        setCopyState({ kind: ok ? 'ok' : 'error', text: ok ? t('statsSessionIdCopied') : t('statsSessionIdCopyFailed') });
        if (ok) copyTimer.current = window.setTimeout(() => setCopyState(null), 1600);
      };
      return react.createElement(primitives.Modal, {
        open,
        onClose,
        /* title 保持纯字符串：Modal 会把 title 同时用作 h2 内容与 aria-label，
           传节点会让 aria-label 收到对象、触发 React 告警并破坏无障碍。
           按钮改放在 body 首位，由 CSS 绝对定位到标题行右侧（见下方样式）。 */
        title: t('statsTitle'),
        closeLabel: t('archiveClose'),
        className: 'dsh-session-kit-stats-modal',
        children: react.createElement(react.Fragment, null,
          react.createElement('div', { className: 'dsh-session-kit-stats-title-actions' },
            react.createElement(primitives.Button, {
              variant: 'outline',
              size: 'sm',
              className: 'dsh-session-kit-stats-copy-id',
              icon: react.createElement(primitives.IconCopyOutlineRegular, { size: 14 }),
              onClick: () => void copySessionId(),
              title: t('statsCopySessionId'),
              'aria-label': t('statsCopySessionId')
            }, t('statsCopySessionId'))
          ),
          react.createElement('div', { className: 'dsh-session-kit-stats' },
            loading && react.createElement('div', { className: 'dsh-session-kit-archive-empty' }, t('statsLoading')),
            !loading && error && react.createElement('div', { role: 'alert', className: 'dsh-session-kit-archive-error' }, `${t('statsFailed')}: ${error}`),
            !loading && !error && react.createElement(react.Fragment, null,
              react.createElement('div', { className: 'dsh-session-kit-stats-summary' },
                react.createElement('span', null, t('statsTotal').replace('{count}', String(total))),
                react.createElement('span', null, t('statsSuccess').replace('{count}', String(success))),
                react.createElement('span', null, t('statsFailedCount').replace('{count}', String(failed))),
                pending > 0 && react.createElement('span', null, t('statsPending').replace('{count}', String(pending)))
              ),
              toolCalls.length === 0
                ? react.createElement('div', { className: 'dsh-session-kit-archive-empty' }, t('statsEmpty'))
                : react.createElement('div', { className: 'dsh-session-kit-stats-list' }, toolCalls.map((entry) => react.createElement('div', { key: entry.name, className: 'dsh-session-kit-stats-row' },
                  react.createElement('div', { className: 'dsh-session-kit-stats-name', title: entry.name }, entry.name),
                  react.createElement('div', { className: 'dsh-session-kit-stats-values' },
                    react.createElement('span', null, `×${entry.count}`),
                    entry.success > 0 && react.createElement('span', null, t('statsSuccess').replace('{count}', String(entry.success))),
                    entry.failed > 0 && react.createElement('span', { className: 'dsh-session-kit-stats-failed' }, t('statsFailedCount').replace('{count}', String(entry.failed))),
                    entry.pending > 0 && react.createElement('span', null, t('statsPending').replace('{count}', String(entry.pending)))
                  )
                )))
            )
          )
        ),
        /* 提示与“关闭”同行：左侧提示、右侧按钮。 */
        footer: react.createElement('div', { className: 'dsh-session-kit-stats-footer' },
          react.createElement('span', {
            className: `dsh-session-kit-stats-copy-status${copyState?.kind === 'error' ? ' dsh-session-kit-stats-copy-status-error' : ''}`,
            role: copyState?.kind === 'error' ? 'alert' : undefined,
            'aria-live': 'polite'
          }, copyState?.text ?? ''),
          react.createElement(primitives.Button, { variant: 'outline', disabled: loading, onClick: onClose }, t('archiveClose'))
        )
      });
    }

    function percentFromRatio(value, fallback, min, max) {
      const percent = Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) : fallback;
      return Math.min(max, Math.max(min, percent));
    }

    function intValue(value, fallback, min, max) {
      const number = Math.trunc(Number(value));
      return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
    }

    function ratioValue(value, fallback) {
      const number = Number(value);
      return Number.isFinite(number) && number > 0 && number <= 1 ? number : fallback;
    }

    function positiveIntegerValue(value, fallback) {
      const number = Number(value);
      return Number.isInteger(number) && number > 0 ? number : fallback;
    }

    function nonNegativeIntegerValue(value, fallback) {
      const number = Number(value);
      return Number.isInteger(number) && number >= 0 ? number : fallback;
    }

    function normalizeCompactionDefaults(value = {}) {
      return {
        thresholdRatio: ratioValue(value.thresholdRatio, COMPACTION_DEFAULT_RATIO),
        retainRatio: ratioValue(value.retainRatio, COMPACTION_DEFAULT_RETAIN_RATIO),
        maxTokens: positiveIntegerValue(value.maxTokens, COMPACTION_DEFAULT_MAX_TOKENS),
        compactionRetries: nonNegativeIntegerValue(value.compactionRetries, COMPACTION_DEFAULT_RETRIES),
        maxOverflowRetries: nonNegativeIntegerValue(value.maxOverflowRetries, COMPACTION_DEFAULT_RETRIES)
      };
    }

    function percentLabel(value, fallback) {
      return String(Math.round(ratioValue(value, fallback) * 100));
    }

    function recommendedRetainPercent(thresholdPercent, defaults) {
      const fallbackFactor = COMPACTION_DEFAULT_RETAIN_RATIO / COMPACTION_DEFAULT_RATIO;
      const defaultThreshold = ratioValue(defaults?.thresholdRatio, COMPACTION_DEFAULT_RATIO);
      const defaultRetain = ratioValue(defaults?.retainRatio, COMPACTION_DEFAULT_RETAIN_RATIO);
      const factor = defaultThreshold > 0 ? defaultRetain / defaultThreshold : fallbackFactor;
      return Math.min(COMPACTION_MAX_RETAIN_PERCENT, Math.max(COMPACTION_MIN_RETAIN_PERCENT, Math.round(Number(thresholdPercent) * factor)));
    }

    function compactionConfigUrl(sessionId) {
      return sessionId ? `${COMPACTION_CONFIG_ROUTE}?sessionId=${encodeURIComponent(String(sessionId))}` : COMPACTION_CONFIG_ROUTE;
    }

    function compactConfigErrorMessage(t, reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      if (message === 'HTTP 404') return t('compactionConfigServiceUnavailable');
      return message;
    }

    function globalPromptErrorMessage(t, reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      if (message === 'HTTP 404') return t('globalPromptServiceUnavailable');
      if (message === 'text-too-large') return t('globalPromptTooLarge');
      return message;
    }

    function GlobalPromptDialog({ open, t, onClose }) {
      const loadedOnceRef = react.useRef(false);
      const [enabled, setEnabled] = react.useState(false);
      const [text, setText] = react.useState('');
      const [loading, setLoading] = react.useState(true);
      const [saveState, setSaveState] = react.useState('idle');
      const [error, setError] = react.useState(null);
      const applyValue = (value = {}) => {
        setEnabled(value.enabled === true);
        setText(typeof value.text === 'string' ? value.text : '');
      };
      react.useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setLoading(!loadedOnceRef.current);
        setError(null);
        setSaveState((state) => state === 'saved' ? 'idle' : state);
        (async () => {
          try {
            const response = await fetch(GLOBAL_PROMPT_ROUTE);
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.ok !== true) throw new Error(data.error?.code || data.error || `HTTP ${response.status}`);
            if (!cancelled) {
              applyValue(data.value || {});
              loadedOnceRef.current = true;
            }
          } catch (reason) {
            if (!cancelled) setError(globalPromptErrorMessage(t, reason));
          } finally {
            if (!cancelled) setLoading(false);
          }
        })();
        return () => {
          cancelled = true;
        };
      }, [open]);
      const save = async () => {
        if (saveState === 'saving') return;
        if (text.length > GLOBAL_PROMPT_MAX_TEXT_LENGTH) {
          setError(t('globalPromptTooLarge'));
          return;
        }
        setSaveState('saving');
        setError(null);
        const nextPayload = { enabled, text };
        try {
          const response = await fetch(GLOBAL_PROMPT_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(nextPayload)
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || data.ok !== true) throw new Error(data.error?.code || data.error || `HTTP ${response.status}`);
          applyValue(data.value || nextPayload);
          setSaveState('saved');
          window.setTimeout(() => setSaveState('idle'), 1400);
        } catch (reason) {
          setError(`${t('globalPromptFailed')}: ${globalPromptErrorMessage(t, reason)}`);
          setSaveState('idle');
        }
      };
      return react.createElement(primitives.Modal, {
        open,
        onClose,
        title: t('globalPromptTitle'),
        closeLabel: t('archiveClose'),
        className: 'dsh-session-kit-global-prompt-modal',
        children: react.createElement('div', { className: 'dsh-session-kit-global-prompt' },
          saveState === 'saved' && react.createElement('div', { role: 'status', className: 'dsh-session-kit-compaction-success' }, t('globalPromptSaveSuccess')),
          error && react.createElement('div', { role: 'alert', className: 'dsh-session-kit-compaction-error' }, error),
          loading && !loadedOnceRef.current && react.createElement('div', { className: 'dsh-session-kit-archive-empty' }, t('archiveLoading')),
          (!loading || loadedOnceRef.current) && react.createElement(react.Fragment, null,
            react.createElement('p', { className: 'dsh-session-kit-compaction-desc' }, t('globalPromptDesc')),
            react.createElement('label', { className: 'dsh-session-kit-compaction-toggle' },
              react.createElement('input', { type: 'checkbox', checked: enabled, onChange: (event) => setEnabled(event.currentTarget.checked) }),
              react.createElement('span', null, t('globalPromptEnable'))
            ),
            react.createElement('label', { className: 'dsh-session-kit-global-prompt-field' },
              react.createElement('span', null, t('globalPromptText')),
              react.createElement('textarea', {
                className: 'dsh-session-kit-global-prompt-textarea',
                value: text,
                disabled: !enabled || saveState === 'saving',
                placeholder: t('globalPromptPlaceholder'),
                rows: 10,
                maxLength: GLOBAL_PROMPT_MAX_TEXT_LENGTH,
                onChange: (event) => setText(event.currentTarget.value),
                'aria-label': t('globalPromptText')
              }),
              react.createElement('small', null, `${String(text.length)} / ${String(GLOBAL_PROMPT_MAX_TEXT_LENGTH)}`)
            )
          )
        ),
        footer: react.createElement(react.Fragment, null,
          react.createElement(primitives.Button, { variant: 'outline', disabled: loading || saveState === 'saving', onClick: onClose }, t('archiveClose')),
          react.createElement(primitives.Button, { variant: 'outline', disabled: loading || saveState === 'saving', onClick: () => void save() }, saveState === 'saving' ? t('globalPromptSaving') : saveState === 'saved' ? t('globalPromptSaved') : t('globalPromptSave'))
        )
      });
    }

    function CompactionNumberInput({ value, min, max, disabled, onChange }) {
      return react.createElement('input', {
        className: 'dsh-session-kit-compaction-number',
        type: 'number',
        min,
        max,
        step: 1,
        value,
        disabled,
        onChange: (event) => onChange(intValue(event.currentTarget.value, value, min, max))
      });
    }

    function CompactionConfigDialog({ open, t, sessionId, onClose }) {
      const loadedOnceRef = react.useRef(false);
      const [enabled, setEnabled] = react.useState(false);
      const [thresholdPercent, setThresholdPercent] = react.useState(COMPACTION_DEFAULT_RATIO * 100);
      const [retainPercent, setRetainPercent] = react.useState(COMPACTION_DEFAULT_RETAIN_RATIO * 100);
      const [maxTokens, setMaxTokens] = react.useState(COMPACTION_DEFAULT_MAX_TOKENS);
      const [compactionRetries, setCompactionRetries] = react.useState(COMPACTION_DEFAULT_RETRIES);
      const [maxOverflowRetries, setMaxOverflowRetries] = react.useState(COMPACTION_DEFAULT_RETRIES);
      const [defaults, setDefaults] = react.useState(() => normalizeCompactionDefaults());
      const [loading, setLoading] = react.useState(true);
      const [saveState, setSaveState] = react.useState('idle');
      const [error, setError] = react.useState(null);
      const applyValue = (value = {}, nextDefaults = defaults) => {
        setDefaults(nextDefaults);
        const nextRetain = percentFromRatio(value.retainRatio, nextDefaults.retainRatio * 100, COMPACTION_MIN_RETAIN_PERCENT, COMPACTION_MAX_RETAIN_PERCENT);
        const nextThreshold = percentFromRatio(value.thresholdRatio, nextDefaults.thresholdRatio * 100, COMPACTION_MIN_PERCENT, COMPACTION_MAX_PERCENT);
        setEnabled(value.enabled === true);
        setRetainPercent(nextRetain);
        setThresholdPercent(nextThreshold);
        setMaxTokens(intValue(value.maxTokens, nextDefaults.maxTokens, COMPACTION_MIN_MAX_TOKENS, COMPACTION_MAX_MAX_TOKENS));
        setCompactionRetries(intValue(value.compactionRetries, nextDefaults.compactionRetries, COMPACTION_MIN_RETRIES, COMPACTION_MAX_RETRIES));
        setMaxOverflowRetries(intValue(value.maxOverflowRetries, nextDefaults.maxOverflowRetries, COMPACTION_MIN_RETRIES, COMPACTION_MAX_RETRIES));
      };
      react.useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setLoading(!loadedOnceRef.current);
        setError(null);
        setSaveState((state) => state === 'saved' ? 'idle' : state);
        (async () => {
          try {
            const response = await fetch(compactionConfigUrl(sessionId));
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.ok !== true) throw new Error(data.error?.code || data.error || `HTTP ${response.status}`);
            if (!cancelled) {
              applyValue(data.value || {}, normalizeCompactionDefaults(data.defaults));
              loadedOnceRef.current = true;
            }
          } catch (reason) {
            if (!cancelled) setError(compactConfigErrorMessage(t, reason));
          } finally {
            if (!cancelled) setLoading(false);
          }
        })();
        return () => {
          cancelled = true;
        };
      }, [open, sessionId]);
      const payload = (override = {}) => ({
        enabled,
        thresholdRatio: thresholdPercent / 100,
        retainRatio: retainPercent / 100,
        maxTokens,
        compactionRetries,
        maxOverflowRetries,
        ...override
      });
      const savePayload = async (nextPayload) => {
        if (saveState === 'saving') return;
        if (nextPayload.enabled && nextPayload.retainRatio >= nextPayload.thresholdRatio) {
          setError(t('compactionConfigInvalidRatio'));
          return;
        }
        setSaveState('saving');
        setError(null);
        try {
          const response = await fetch(compactionConfigUrl(sessionId), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(nextPayload)
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || data.ok !== true) throw new Error(data.error?.code || data.error || `HTTP ${response.status}`);
          applyValue(data.value || nextPayload, normalizeCompactionDefaults(data.defaults || defaults));
          setSaveState('saved');
          window.setTimeout(() => setSaveState('idle'), 1400);
        } catch (reason) {
          setError(`${t('compactionConfigFailed')}: ${compactConfigErrorMessage(t, reason)}`);
          setSaveState('idle');
        }
      };
      const save = () => void savePayload(payload());
      const resetPayload = {
        enabled: false,
        thresholdRatio: defaults.thresholdRatio,
        retainRatio: defaults.retainRatio,
        maxTokens: defaults.maxTokens,
        compactionRetries: defaults.compactionRetries,
        maxOverflowRetries: defaults.maxOverflowRetries
      };
      const reset = () => {
        applyValue(resetPayload);
        void savePayload(resetPayload);
      };
      const setRetain = (value) => {
        const next = Math.min(COMPACTION_MAX_RETAIN_PERCENT, Math.max(COMPACTION_MIN_RETAIN_PERCENT, Number(value)));
        setRetainPercent(next);
      };
      const setThreshold = (value) => {
        const next = Math.min(COMPACTION_MAX_PERCENT, Math.max(COMPACTION_MIN_PERCENT, Number(value)));
        setThresholdPercent(next);
      };
      const renderNumberField = (labelKey, helpKey, value, min, max, onChange, defaultValue) => react.createElement('div', { className: 'dsh-session-kit-compaction-field dsh-session-kit-compaction-field--row' },
        react.createElement('div', { className: 'dsh-session-kit-compaction-field-text' },
          react.createElement('span', null, t(labelKey)),
          react.createElement('p', null, t(helpKey).replace('{default}', String(defaultValue)))
        ),
        react.createElement(CompactionNumberInput, { value, min, max, disabled: !enabled, onChange })
      );
      return react.createElement(primitives.Modal, {
        open,
        onClose,
        title: t('compactionConfigTitle'),
        closeLabel: t('archiveClose'),
        className: 'dsh-session-kit-compaction-modal',
        children: react.createElement('div', { className: 'dsh-session-kit-compaction' },
          saveState === 'saved' && react.createElement('div', { role: 'status', className: 'dsh-session-kit-compaction-success' }, t('compactionConfigSaveSuccess')),
          error && react.createElement('div', { role: 'alert', className: 'dsh-session-kit-compaction-error' }, error),
          loading && !loadedOnceRef.current && react.createElement('div', { className: 'dsh-session-kit-archive-empty' }, t('archiveLoading')),
          (!loading || loadedOnceRef.current) && react.createElement(react.Fragment, null,
            react.createElement('p', { className: 'dsh-session-kit-compaction-desc' }, t('compactionConfigDesc')),
            react.createElement('label', { className: 'dsh-session-kit-compaction-toggle' },
              react.createElement('input', { type: 'checkbox', checked: enabled, onChange: (event) => setEnabled(event.currentTarget.checked) }),
              react.createElement('span', null, t('compactionConfigEnable'))
            ),
            react.createElement('div', { className: 'dsh-session-kit-compaction-field' },
              react.createElement('div', { className: 'dsh-session-kit-compaction-field-head' },
                react.createElement('span', null, t('compactionConfigThreshold')),
                react.createElement('strong', null, t('compactionConfigCurrent').replace('{percent}', String(thresholdPercent)))
              ),
              react.createElement('div', { className: 'dsh-session-kit-compaction-slider-wrap' },
                react.createElement('input', {
                  className: 'dsh-session-kit-compaction-slider',
                  type: 'range',
                  min: COMPACTION_MIN_PERCENT,
                  max: COMPACTION_MAX_PERCENT,
                  step: 1,
                  value: thresholdPercent,
                  disabled: !enabled,
                  onChange: (event) => setThreshold(event.currentTarget.value)
                }),
                react.createElement('div', { className: 'dsh-session-kit-compaction-scale' },
                  react.createElement('span', null, `${COMPACTION_MIN_PERCENT}%`),
                  react.createElement('span', null, `${COMPACTION_MAX_PERCENT}%`)
                )
              ),
              react.createElement('p', { className: 'dsh-session-kit-compaction-help' }, t('compactionConfigThresholdHelp').replace('{default}', percentLabel(defaults.thresholdRatio, COMPACTION_DEFAULT_RATIO)))
            ),
            react.createElement('div', { className: 'dsh-session-kit-compaction-field' },
              react.createElement('div', { className: 'dsh-session-kit-compaction-field-head' },
                react.createElement('span', null, t('compactionConfigRetain')),
                react.createElement('strong', null, t('compactionConfigCurrent').replace('{percent}', String(retainPercent)))
              ),
              react.createElement('div', { className: 'dsh-session-kit-compaction-slider-wrap' },
                react.createElement('div', { className: 'dsh-session-kit-compaction-dynamic-recommend' }, t('compactionConfigDynamicRecommend').replace('{percent}', String(recommendedRetainPercent(thresholdPercent, defaults)))),
                react.createElement('input', {
                  className: 'dsh-session-kit-compaction-slider',
                  type: 'range',
                  min: COMPACTION_MIN_RETAIN_PERCENT,
                  max: COMPACTION_MAX_RETAIN_PERCENT,
                  step: 1,
                  value: retainPercent,
                  disabled: !enabled,
                  onChange: (event) => setRetain(event.currentTarget.value)
                }),
                react.createElement('div', { className: 'dsh-session-kit-compaction-scale' },
                  react.createElement('span', null, `${COMPACTION_MIN_RETAIN_PERCENT}%`),
                  react.createElement('span', null, `${COMPACTION_MAX_RETAIN_PERCENT}%`)
                )
              ),
              react.createElement('p', { className: 'dsh-session-kit-compaction-help' }, t('compactionConfigRetainHelp').replace('{default}', percentLabel(defaults.retainRatio, COMPACTION_DEFAULT_RETAIN_RATIO)))
            ),
            renderNumberField('compactionConfigMaxTokens', 'compactionConfigMaxTokensHelp', maxTokens, COMPACTION_MIN_MAX_TOKENS, COMPACTION_MAX_MAX_TOKENS, setMaxTokens, defaults.maxTokens),
            renderNumberField('compactionConfigRetries', 'compactionConfigRetriesHelp', compactionRetries, COMPACTION_MIN_RETRIES, COMPACTION_MAX_RETRIES, setCompactionRetries, defaults.compactionRetries),
            renderNumberField('compactionConfigOverflowRetries', 'compactionConfigOverflowRetriesHelp', maxOverflowRetries, COMPACTION_MIN_RETRIES, COMPACTION_MAX_RETRIES, setMaxOverflowRetries, defaults.maxOverflowRetries)
          )
        ),
        footer: react.createElement(react.Fragment, null,
          react.createElement(primitives.Button, { variant: 'outline', disabled: loading || saveState === 'saving', onClick: reset }, t('compactionConfigReset')),
          react.createElement(primitives.Button, { variant: 'outline', disabled: loading || saveState === 'saving', onClick: onClose }, t('archiveClose')),
          react.createElement(primitives.Button, { variant: 'outline', disabled: loading || saveState === 'saving', onClick: save }, saveState === 'saving' ? t('compactionConfigSaving') : saveState === 'saved' ? t('compactionConfigSaved') : t('compactionConfigSave'))
        )
      });
    }

    function ArchivePreviewMessage({ message, t, markdownLabels, copiedKey, copyMessage, expanded, onToggle }) {
      const contentRef = react.useRef(null);
      const maxHeight = message.role === 'user' ? 100 : 60;
      const [collapsible, setCollapsible] = react.useState(false);
      react.useLayoutEffect(() => {
        const el = contentRef.current;
        if (!(el instanceof HTMLElement)) {
          setCollapsible(false);
          return;
        }
        let frame = 0;
        const measure = () => {
          frame = 0;
          setCollapsible(el.scrollHeight > maxHeight + 1);
        };
        const schedule = () => {
          if (frame !== 0) return;
          frame = window.requestAnimationFrame(measure);
        };
        schedule();
        let observer = null;
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(schedule);
          observer.observe(el);
        }
        return () => {
          if (frame !== 0) window.cancelAnimationFrame(frame);
          observer?.disconnect();
        };
      }, [message.text, message.role, maxHeight]);
      const collapsed = collapsible && !expanded;
      const timeValue = Number(message.time);
      const time = formatArchiveTime(timeValue);
      const isoTime = time && Number.isFinite(timeValue) ? new Date(timeValue).toISOString() : undefined;
      const text = String(message.text || '');
      return react.createElement(
        'article',
        { className: `dsh-session-kit-preview-message dsh-session-kit-preview-message-${message.role}`, 'data-preview-message-key': message.key },
        react.createElement('div', { className: 'dsh-session-kit-preview-timeline', 'aria-hidden': true },
          react.createElement('span', { className: 'dsh-session-kit-preview-seq' }, String(message.displayIndex))
        ),
        react.createElement('div', { className: 'dsh-session-kit-preview-message-card' },
          react.createElement('div', { className: 'dsh-session-kit-preview-message-head' },
            react.createElement('div', { className: 'dsh-session-kit-preview-role' }, archivePreviewRole(t, message.role)),
            time && react.createElement('time', { className: 'dsh-session-kit-preview-message-time', dateTime: isoTime }, time),
            react.createElement(primitives.Button, {
              variant: 'ghost',
              size: 'sm',
              className: 'dsh-session-kit-preview-copy',
              icon: react.createElement(primitives.IconCopyOutlineRegular, { size: 14 }),
              onClick: () => void copyMessage(message),
              'aria-label': t('archivePreviewCopy'),
              title: t('archivePreviewCopy')
            }, copiedKey === message.key ? t('archivePreviewCopied') : t('archivePreviewCopy'))
          ),
          react.createElement('div', { ref: contentRef, className: 'dsh-session-kit-preview-text', 'data-collapsed': collapsed || undefined, style: { '--dsh-session-kit-preview-content-max-height': `${maxHeight}px` } },
            react.createElement(ArchivePreviewRenderBoundary, { resetKey: message.key, fallbackText: text },
              react.createElement(primitives.MarkdownText, { text, labels: markdownLabels })
            )
          ),
          collapsible && react.createElement('div', { className: 'dsh-session-kit-preview-message-foot' },
            react.createElement(primitives.Button, {
              variant: 'outline',
              size: 'sm',
              className: 'dsh-session-kit-preview-expand',
              onClick: onToggle
            }, expanded ? t('archivePreviewCollapse') : t('archivePreviewExpand'))
          )
        )
      );
    }

    function ArchivePreviewDialogUnused({ preview, t, onClose, onSearch, onMessagePage, onTocPage, onRename, onExport, canExport, canRename }) {
      const data = preview.data;
      const item = preview.item;
      const messages = Array.isArray(data?.messages) ? data.messages : [];
      const userMessages = Array.isArray(data?.userMessages) ? data.userMessages : [];
      const toolCalls = normalizeToolCalls(data?.toolCalls);
      const toolTotal = toolCalls.reduce((sum, entry) => sum + entry.count, 0);
      const title = data?.title || item?.title || t('archivePreviewTitle');
      const sessionId = data?.sessionId || item?.sessionId || '';
      const [search, setSearch] = react.useState('');
      const debouncedSearch = useDebouncedValue(search, 160);
      const [tocPage, setTocPage] = react.useState(0);
      const [messagePage, setMessagePage] = react.useState(0);
      const [expandedKeys, setExpandedKeys] = react.useState(() => new Set());
      const [copiedKey, setCopiedKey] = react.useState(null);
      const listRef = react.useRef(null);
      const pendingScrollKeyRef = react.useRef(null);
      const copyTimer = react.useRef(0);
      const previewKey = `${preview.open ? 'open' : 'closed'}:${sessionId}`;
      const markdownLabels = react.useMemo(() => archivePreviewMarkdownLabels(t), [t]);
      react.useEffect(() => {
        setSearch('');
        setTocPage(0);
        setMessagePage(0);
        setExpandedKeys(new Set());
        setCopiedKey(null);
        pendingScrollKeyRef.current = null;
        window.clearTimeout(copyTimer.current);
      }, [previewKey]);
      react.useEffect(() => () => window.clearTimeout(copyTimer.current), []);
      const normalizedSearch = debouncedSearch.trim().toLocaleLowerCase();
      const indexedMessages = react.useMemo(() => messages.map((message, index) => ({
        ...message,
        key: `${message.role}-${message.seq}-${index}`,
        displayIndex: index + 1
      })), [messages]);
      const visibleMessages = react.useMemo(() => {
        if (normalizedSearch === '') return indexedMessages;
        return indexedMessages.filter((message) => `${archivePreviewRole(t, message.role)}\n${String(message.title || '')}\n${String(message.text || '')}`.toLocaleLowerCase().includes(normalizedSearch));
      }, [indexedMessages, normalizedSearch, t]);
      react.useEffect(() => {
        setMessagePage(0);
      }, [normalizedSearch]);
      react.useEffect(() => {
        const key = pendingScrollKeyRef.current;
        if (key === null) return;
        const target = listRef.current?.querySelector?.(`[data-preview-message-key="${CSS.escape(String(key))}"]`);
        if (target instanceof HTMLElement) {
          pendingScrollKeyRef.current = null;
          target.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }
      }, [visibleMessages, messagePage]);
      const unknown = t('archivePreviewUnknown');
      const attrs = [
        { key: 'sessionId', label: t('archivePreviewSessionId'), value: String(sessionId || unknown) },
        { key: 'cwd', label: t('archivePreviewCwd'), value: String(data?.cwd || item?.cwd || unknown) },
        { key: 'createdAt', label: t('archivePreviewCreatedAt'), value: formatArchiveTime(data?.createdAt || item?.createdAt) || unknown },
        { key: 'updatedAt', label: t('archivePreviewUpdatedAt'), value: formatArchiveTime(data?.updatedAt || item?.updatedAt) || unknown }
      ];
      const copyMessage = async (message) => {
        const ok = await primitives.writeClipboard(String(message.text || ''));
        if (ok === false) return;
        window.clearTimeout(copyTimer.current);
        setCopiedKey(message.key);
        copyTimer.current = window.setTimeout(() => setCopiedKey(null), 1600);
      };
      const renderAttr = (attr) => react.createElement(
        'div',
        { key: attr.key, className: 'dsh-session-kit-preview-attr-card', title: attr.value },
        react.createElement('div', { className: 'dsh-session-kit-preview-attr-label' }, attr.label),
        react.createElement('div', { className: 'dsh-session-kit-preview-attr-value' }, attr.value)
      );
      const messagePageTotal = Math.max(1, Math.ceil(visibleMessages.length / ARCHIVE_PREVIEW_MESSAGE_PAGE_SIZE));
      const safeMessagePage = Math.min(messagePage, messagePageTotal - 1);
      react.useEffect(() => {
        if (messagePage !== safeMessagePage) setMessagePage(safeMessagePage);
      }, [messagePage, safeMessagePage]);
      const pagedMessages = react.useMemo(() => visibleMessages.slice(safeMessagePage * ARCHIVE_PREVIEW_MESSAGE_PAGE_SIZE, (safeMessagePage + 1) * ARCHIVE_PREVIEW_MESSAGE_PAGE_SIZE), [visibleMessages, safeMessagePage]);
      const messageCountText = t('archivePreviewMessageCount')
        .replace('{shown}', String(visibleMessages.length))
        .replace('{total}', String(indexedMessages.length));
      const userToc = react.useMemo(() => indexedMessages.filter((message) => message.role === 'user'), [indexedMessages]);
      const tocPageTotal = Math.max(1, Math.ceil(userToc.length / ARCHIVE_PREVIEW_TOC_PAGE_SIZE));
      const safeTocPage = Math.min(tocPage, tocPageTotal - 1);
      react.useEffect(() => {
        if (tocPage !== safeTocPage) setTocPage(safeTocPage);
      }, [tocPage, safeTocPage]);
      const pagedUserToc = react.useMemo(() => userToc.slice(safeTocPage * ARCHIVE_PREVIEW_TOC_PAGE_SIZE, (safeTocPage + 1) * ARCHIVE_PREVIEW_TOC_PAGE_SIZE), [userToc, safeTocPage]);
      const pageText = (page, total) => t('archivePreviewPage').replace('{page}', String(page + 1)).replace('{total}', String(total));
      const renderPager = (page, total, setPage) => total > 1 && react.createElement(
        'div',
        { className: 'dsh-session-kit-preview-pager' },
        react.createElement(primitives.Button, { variant: 'outline', size: 'sm', disabled: page <= 0, onClick: () => setPage((value) => Math.max(0, value - 1)) }, t('archivePreviewPrev')),
        react.createElement('span', { className: 'dsh-session-kit-preview-page-text' }, pageText(page, total)),
        react.createElement(primitives.Button, { variant: 'outline', size: 'sm', disabled: page >= total - 1, onClick: () => setPage((value) => Math.min(total - 1, value + 1)) }, t('archivePreviewNext'))
      );
      const messageTitle = (message) => {
        const text = normalizeTopicText(message.title || message.text || '');
        return text.length > 48 ? `${text.slice(0, 48)}…` : text || `${archivePreviewRole(t, message.role)} ${String(message.displayIndex)}`;
      };
      const scrollToPreviewMessage = (message) => {
        const scroll = () => {
          const target = listRef.current?.querySelector?.(`[data-preview-message-key="${CSS.escape(String(message.key))}"]`);
          if (target instanceof HTMLElement) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
        };
        const source = normalizedSearch === '' ? indexedMessages : visibleMessages;
        const index = source.findIndex((item) => item.key === message.key);
        if (index >= 0) {
          setMessagePage(Math.floor(index / ARCHIVE_PREVIEW_MESSAGE_PAGE_SIZE));
          pendingScrollKeyRef.current = message.key;
          window.requestAnimationFrame(scroll);
          return;
        }
        pendingScrollKeyRef.current = message.key;
        setMessagePage(Math.floor(Math.max(0, indexedMessages.findIndex((item) => item.key === message.key)) / ARCHIVE_PREVIEW_MESSAGE_PAGE_SIZE));
        setSearch('');
      };
      const toggleMessage = (message) => setExpandedKeys((current) => {
        const next = new Set(current);
        if (next.has(message.key)) next.delete(message.key);
        else next.add(message.key);
        return next;
      });
      const renderTocItem = (message) => react.createElement(
        'button',
        {
          key: message.key,
          type: 'button',
          className: 'dsh-session-kit-preview-toc-item',
          onClick: () => scrollToPreviewMessage(message),
          title: messageTitle(message)
        },
        react.createElement('span', { className: 'dsh-session-kit-preview-toc-index' }, String(message.displayIndex)),
        react.createElement('span', { className: 'dsh-session-kit-preview-toc-text' }, messageTitle(message))
      );
      const renderMessage = (message) => react.createElement(ArchivePreviewMessage, {
        key: message.key,
        message,
        t,
        markdownLabels,
        copiedKey,
        copyMessage,
        expanded: expandedKeys.has(message.key),
        onToggle: () => toggleMessage(message)
      });
      return react.createElement(primitives.Modal, {
        open: preview.open,
        onClose,
        title: t('archivePreviewTitle'),
        closeLabel: t('archiveClose'),
        className: 'dsh-session-kit-preview-modal',
        children: react.createElement(
          'div',
          { className: 'dsh-session-kit-preview' },
          react.createElement('div', { className: 'dsh-session-kit-preview-head' },
            react.createElement('div', { className: 'dsh-session-kit-preview-title', title }, title),
            react.createElement('div', { className: 'dsh-session-kit-preview-attrs' }, attrs.map(renderAttr)),
            react.createElement('div', { className: 'dsh-session-kit-preview-tools' },
              react.createElement('div', { className: 'dsh-session-kit-preview-tools-label' },
                t('archiveToolStats'),
                ' · ',
                t('archiveToolStatsTotal').replace('{count}', String(toolTotal))
              ),
              toolCalls.length === 0
                ? react.createElement('div', { className: 'dsh-session-kit-preview-tools-empty' }, t('archiveToolStatsEmpty'))
                : react.createElement('div', { className: 'dsh-session-kit-preview-tool-list' }, toolCalls.map((entry) => react.createElement(
                  'span',
                  { key: entry.name, className: 'dsh-session-kit-preview-tool-chip', title: `${entry.name} ×${entry.count}` },
                  entry.name,
                  ' ×',
                  String(entry.count)
                )))
            )
          ),
          react.createElement('div', { className: 'dsh-session-kit-preview-body' },
            react.createElement('aside', { className: 'dsh-session-kit-preview-sidebar', 'aria-label': t('archivePreviewUserToc') },
              react.createElement('div', { className: 'dsh-session-kit-preview-sidebar-title' }, t('archivePreviewUserToc')),
              react.createElement('div', { className: 'dsh-session-kit-preview-toc-list' }, pagedUserToc.map(renderTocItem)),
              renderPager(safeTocPage, tocPageTotal, setTocPage)
            ),
            react.createElement('section', { className: 'dsh-session-kit-preview-main' },
              react.createElement('div', { className: 'dsh-session-kit-preview-search-row' },
                react.createElement('div', { className: 'dsh-session-kit-preview-search dsh-session-kit-preview-search-with-icon' },
                  react.createElement('span', { className: 'dsh-session-kit-preview-search-icon', 'aria-hidden': 'true' }, react.createElement(primitives.IconSearchOutlineRegular, { size: 15 })),
                  react.createElement('input', {
                    className: 'dsh-session-kit-preview-search-input',
                    value: search,
                    placeholder: t('archivePreviewSearchPlaceholder'),
                    onChange: (event) => setSearch(event.currentTarget.value),
                    disabled: preview.loading,
                    'aria-label': t('archivePreviewSearchPlaceholder')
                  }),
                  search !== '' && react.createElement('button', {
                    type: 'button',
                    className: 'dsh-session-kit-preview-search-clear',
                    onClick: () => setSearch(''),
                    'aria-label': t('archiveSearchClear'),
                    title: t('archiveSearchClear')
                  }, react.createElement(primitives.IconCloseOutlineRegular, { size: 14 }))
                ),
                react.createElement('span', { className: 'dsh-session-kit-preview-count' }, messageCountText)
              ),
              preview.loading && react.createElement('div', { className: 'dsh-session-kit-archive-empty' }, t('archivePreviewLoading')),
              !preview.loading && preview.error && react.createElement('div', { role: 'alert', className: 'dsh-session-kit-archive-error' }, `${t('archivePreviewFailed')}: ${preview.error}`),
              !preview.loading && !preview.error && messages.length === 0 && react.createElement('div', { className: 'dsh-session-kit-archive-empty' }, t('archivePreviewEmpty')),
              !preview.loading && !preview.error && messages.length > 0 && visibleMessages.length === 0 && react.createElement('div', { className: 'dsh-session-kit-archive-empty' }, t('archivePreviewSearchEmpty')),
              !preview.loading && !preview.error && visibleMessages.length > 0 && react.createElement(react.Fragment, null,
                react.createElement('div', { className: 'dsh-session-kit-preview-list', ref: listRef },
                  pagedMessages.map(renderMessage),
                  preview.hasMore && react.createElement('div', { className: 'dsh-session-kit-preview-more' },
                    react.createElement(primitives.Button, { variant: 'outline', disabled: preview.loadingMore, onClick: onLoadMore }, preview.loadingMore ? t('archiveLoadingMore') : t('archiveLoadMore'))
                  )
                ),
                renderPager(safeMessagePage, messagePageTotal, setMessagePage)
              )
            )
          )
        ),
        footer: react.createElement(primitives.Button, { variant: 'outline', disabled: preview.loading, onClick: onClose }, t('archiveClose'))
      });
    }

    function ArchivePreviewDialog({ preview, t, onClose, onSearch, onMessagePage, onTocPage, onRename, onExport, canExport, canRename }) {
      const data = preview.data;
      const hasData = data !== null;
      const initialLoading = preview.loading && !hasData;
      const tocRefreshing = preview.loadingMore || (preview.loading && (preview.loadingScope === 'toc' || preview.loadingScope === 'both'));
      const messagesRefreshing = preview.loadingMore || initialLoading || (preview.loading && (preview.loadingScope === 'messages' || preview.loadingScope === 'both'));
      const previewBusy = tocRefreshing || messagesRefreshing;
      const item = preview.item;
      const messages = Array.isArray(data?.messages) ? data.messages : [];
      const userMessages = Array.isArray(data?.userMessages) ? data.userMessages : [];
      const toolCalls = normalizeToolCalls(data?.toolCalls);
      const toolTotal = toolCalls.reduce((sum, entry) => sum + entry.count, 0);
      const title = data?.title || item?.title || t('archivePreviewTitle');
      const sessionId = data?.sessionId || item?.sessionId || '';
      const [search, setSearch] = react.useState(String(data?.search || ''));
      const [expandedKeys, setExpandedKeys] = react.useState(() => new Set());
      const [copiedKey, setCopiedKey] = react.useState(null);
      const listRef = react.useRef(null);
      const pendingScrollRef = react.useRef(null);
      const scrollAlignTimerRef = react.useRef(0);
      const copyTimer = react.useRef(0);
      const submittedSearchRef = react.useRef(String(data?.search || ''));
      const serverSearchRef = react.useRef(String(data?.search || ''));
      const markdownLabels = react.useMemo(() => archivePreviewMarkdownLabels(t), [t]);
      react.useEffect(() => {
        window.clearTimeout(copyTimer.current);
        submittedSearchRef.current = '';
        serverSearchRef.current = '';
        setSearch('');
        setExpandedKeys(new Set());
        setCopiedKey(null);
        pendingScrollRef.current = null;
        window.clearTimeout(scrollAlignTimerRef.current);
        return () => window.clearTimeout(copyTimer.current);
      }, [sessionId]);
      react.useEffect(() => {
        if (preview.loading) return;
        const nextServerSearch = String(data?.search || '');
        const previousServerSearch = serverSearchRef.current;
        serverSearchRef.current = nextServerSearch;
        submittedSearchRef.current = nextServerSearch;
        setSearch((current) => current === previousServerSearch ? nextServerSearch : current);
      }, [data?.search, preview.loading]);
      react.useEffect(() => {
        const normalized = search.trim();
        if (normalized === submittedSearchRef.current) return;
        if (normalized === '') {
          submittedSearchRef.current = normalized;
          onSearch?.(normalized);
          return;
        }
        const timer = window.setTimeout(() => {
          submittedSearchRef.current = normalized;
          onSearch?.(normalized);
        }, ARCHIVE_PREVIEW_SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
      }, [search, onSearch]);
      const indexedMessages = react.useMemo(() => messages.map((message, index) => ({
        ...message,
        key: `${message.role}-${message.seq}`,
        displayIndex: Number.isSafeInteger(message.displayIndex) ? message.displayIndex : index + 1,
        matchIndex: Number.isSafeInteger(message.matchIndex) ? message.matchIndex : index
      })), [messages]);
      const indexedUserMessages = react.useMemo(() => userMessages.map((message, index) => ({
        ...message,
        key: `${message.role}-${message.seq}`,
        displayIndex: Number.isSafeInteger(message.displayIndex) ? message.displayIndex : (Number.isSafeInteger(message.messageIndex) ? message.messageIndex + 1 : index + 1),
        messageIndex: Number.isSafeInteger(message.messageIndex) ? message.messageIndex : index
      })), [userMessages]);
      const totalMessages = Number.isSafeInteger(data?.totalMatchedMessages) ? data.totalMatchedMessages : indexedMessages.length;
      const totalUserMessages = Number.isSafeInteger(data?.totalUserMessages) ? data.totalUserMessages : indexedUserMessages.length;
      const messagePage = Number.isSafeInteger(data?.offset) ? Math.floor(data.offset / ARCHIVE_PREVIEW_MESSAGE_PAGE_SIZE) : 0;
      const tocPage = Number.isSafeInteger(data?.tocOffset) ? Math.floor(data.tocOffset / ARCHIVE_PREVIEW_TOC_PAGE_SIZE) : 0;
      const messagePageTotal = Math.max(1, Math.ceil(totalMessages / ARCHIVE_PREVIEW_MESSAGE_PAGE_SIZE));
      const tocPageTotal = Math.max(1, Math.ceil(totalUserMessages / ARCHIVE_PREVIEW_TOC_PAGE_SIZE));
      const messageCountText = t('archivePreviewMessageCount').replace('{shown}', String(indexedMessages.length)).replace('{total}', String(totalMessages));
      const hasMessages = totalMessages > 0;
      const currentSearch = String(data?.search ?? '');
      const unknown = t('archivePreviewUnknown');
      const attrs = [
        { key: 'sessionId', label: t('archivePreviewSessionId'), value: String(sessionId || unknown), copyable: true },
        { key: 'cwd', label: t('archivePreviewCwd'), value: String(data?.cwd || item?.cwd || unknown), copyable: true },
        { key: 'createdAt', label: t('archivePreviewCreatedAt'), value: formatArchiveTime(data?.createdAt || item?.createdAt) || unknown },
        { key: 'updatedAt', label: t('archivePreviewUpdatedAt'), value: formatArchiveTime(data?.updatedAt || item?.updatedAt) || unknown }
      ];
      const copyAttr = async (attr) => {
        const ok = await primitives.writeClipboard(String(attr.value));
        if (ok === false) return;
        window.clearTimeout(copyTimer.current);
        setCopiedKey(`attr:${attr.key}`);
        copyTimer.current = window.setTimeout(() => setCopiedKey(null), 1600);
      };
      const renderAttr = (attr) => react.createElement(
        'div',
        { key: attr.key, className: 'dsh-session-kit-preview-attr-card', title: attr.value },
        react.createElement('div', { className: 'dsh-session-kit-preview-attr-label' }, attr.label),
        react.createElement('div', { className: 'dsh-session-kit-preview-attr-value' }, attr.value),
        attr.copyable && attr.value !== unknown && react.createElement(primitives.Button, {
          variant: 'ghost',
          size: 'sm',
          className: `dsh-session-kit-preview-attr-copy${copiedKey === `attr:${attr.key}` ? ' dsh-session-kit-preview-attr-copy-copied' : ''}`,
          icon: copiedKey === `attr:${attr.key}` ? react.createElement(primitives.IconCheckOutlineRegular, { size: 14 }) : react.createElement(primitives.IconCopyOutlineRegular, { size: 14 }),
          disabled: preview.loading,
          onClick: () => void copyAttr(attr),
          title: copiedKey === `attr:${attr.key}` ? t('archivePreviewCopied') : t('archivePreviewCopy'),
          'aria-label': `${t('archivePreviewCopy')} · ${attr.label}`
        })
      );
      const copyMessage = async (message) => {
        const ok = await primitives.writeClipboard(String(message.text || ''));
        if (ok === false) return;
        window.clearTimeout(copyTimer.current);
        setCopiedKey(message.key);
        copyTimer.current = window.setTimeout(() => setCopiedKey(null), 1600);
      };
      const toggleMessage = (message) => setExpandedKeys((current) => {
        const next = new Set(current);
        if (next.has(message.key)) next.delete(message.key);
        else next.add(message.key);
        return next;
      });
      const pageText = (page, total) => t('archivePreviewPage').replace('{page}', String(page + 1)).replace('{total}', String(total));
      const renderPager = (page, total, onPage, pending = previewBusy) => {
        const safeTotal = Math.max(1, Number.isSafeInteger(total) ? total : Math.trunc(Number(total) || 1));
        const normalizedPage = Number.isSafeInteger(page) ? page : Math.trunc(Number(page) || 0);
        const safePage = Math.min(Math.max(0, normalizedPage), safeTotal - 1);
        const goPage = (nextPage) => {
          if (typeof onPage !== 'function') return;
          const safeNextPage = Math.min(Math.max(0, nextPage), safeTotal - 1);
          try {
            onPage(safeNextPage);
          } catch (reason) {
            globalThis.console?.error?.('[dsh-session-kit] archive preview pagination failed', reason);
          }
        };
        return safeTotal > 1 && react.createElement(
          'div',
          { className: 'dsh-session-kit-preview-pager' },
          react.createElement(primitives.Button, { variant: 'outline', size: 'sm', disabled: safePage <= 0 || pending, onClick: () => goPage(safePage - 1) }, t('archivePreviewPrev')),
          react.createElement('span', { className: 'dsh-session-kit-preview-page-text' }, pageText(safePage, safeTotal)),
          react.createElement(primitives.Button, { variant: 'outline', size: 'sm', disabled: safePage >= safeTotal - 1 || pending, onClick: () => goPage(safePage + 1) }, t('archivePreviewNext'))
        );
      };
      /* 逐帧对齐滚动：列表刚挂载时高度未稳定，scrollIntoView 的平滑滚动会停在过期位置；
         每帧重算目标与视口顶部的差值并直接校正 scrollTop，直到收敛。 */
      const scrollMessageIntoView = (key) => {
        const list = listRef.current;
        if (!(list instanceof HTMLElement)) return false;
        const target = Array.from(list.querySelectorAll('[data-preview-message-key]')).find((node) => node.getAttribute('data-preview-message-key') === key);
        if (!(target instanceof HTMLElement)) return false;
        /* 取消上一次的对齐循环，避免两次跳转的循环互相拉扯 */
        window.clearTimeout(scrollAlignTimerRef.current);
        let attempts = 0;
        let stableFrames = 0;
        const align = () => {
          const listRect = list.getBoundingClientRect();
          const rect = target.getBoundingClientRect();
          const delta = Math.round(rect.top - listRect.top);
          /* 2px 死区：亚像素/内容微移造成的 ±1-2px 偏移不再矫正，避免震荡 */
          if (Math.abs(delta) > 2) list.scrollTop += delta;
          attempts += 1;
          stableFrames = Math.abs(delta) <= 2 ? stableFrames + 1 : 0;
          if (stableFrames < 2 && attempts < 15) scrollAlignTimerRef.current = window.setTimeout(align, 60);
        };
        align();
        return true;
      };
      const scrollToMessage = (message) => {
        /* 索引空间：搜索态且目标在匹配集内用 matchIndex（匹配列表），否则用 messageIndex（完整会话列表） */
        const index = Number.isSafeInteger(message.matchIndex)
          ? message.matchIndex
          : Math.max(0, Number.isSafeInteger(message.messageIndex) ? message.messageIndex : (Number.isSafeInteger(message.displayIndex) ? message.displayIndex - 1 : 0));
        const targetPage = Math.floor(index / ARCHIVE_PREVIEW_MESSAGE_PAGE_SIZE);
        const clearSearch = search.trim() !== '' && !Number.isSafeInteger(message.matchIndex);
        if (clearSearch) {
          submittedSearchRef.current = '';
          serverSearchRef.current = '';
          setSearch('');
        }
        if (targetPage !== messagePage || clearSearch) {
          pendingScrollRef.current = { key: message.key, index };
          onMessagePage?.(targetPage, clearSearch ? '' : undefined);
          return;
        }
        scrollMessageIntoView(message.key);
      };
      react.useEffect(() => {
        const pending = pendingScrollRef.current;
        if (pending === null) return undefined;
        if (scrollMessageIntoView(pending.key)) return undefined;
        /* 自愈：目标应在本页但 DOM 未就绪 → 下一帧重试；目标不在本页（陈旧跳转）→ 放弃，不永久滞留 */
        const offset = Number.isSafeInteger(data?.offset) ? data.offset : 0;
        if (pending.index >= offset && pending.index < offset + messages.length) {
          const raf = window.requestAnimationFrame(() => {
            if (pendingScrollRef.current !== null) scrollMessageIntoView(pending.key);
          });
          return () => window.cancelAnimationFrame(raf);
        }
        pendingScrollRef.current = null;
        return undefined;
      }, [messages, messagePage]);
      const messageTitle = (message) => {
        const text = normalizeTopicText(message.title || message.text || '');
        return text.length > 56 ? `${text.slice(0, 56)}…` : text || `${archivePreviewRole(t, message.role)} ${String(message.displayIndex)}`;
      };
      const renderMessage = (message) => react.createElement(
        'div',
        { key: message.key, className: 'dsh-session-kit-preview-message-wrap', 'data-preview-message-key': message.key },
        react.createElement(ArchivePreviewMessage, {
          message,
          t,
          markdownLabels,
          copiedKey,
          copyMessage,
          expanded: expandedKeys.has(message.key),
          onToggle: () => toggleMessage(message)
        })
      );
      const renderTocItem = (message, disabled = previewBusy) => react.createElement(
        'button',
        {
          key: message.key,
          type: 'button',
          className: 'dsh-session-kit-preview-toc-item',
          disabled,
          onClick: () => scrollToMessage(message),
          title: messageTitle(message)
        },
        react.createElement('span', { className: 'dsh-session-kit-preview-toc-index' }, String(message.displayIndex)),
        react.createElement('span', { className: 'dsh-session-kit-preview-toc-text' }, messageTitle(message))
      );
      return react.createElement(primitives.Modal, {
        open: preview.open,
        onClose,
        title: t('archivePreviewTitle'),
        closeLabel: t('archiveClose'),
        className: 'dsh-session-kit-preview-modal',
        children: react.createElement(
          'div',
          { className: 'dsh-session-kit-preview' },
          react.createElement('div', { className: 'dsh-session-kit-preview-head' },
            react.createElement('div', { className: 'dsh-session-kit-preview-title-row' },
              react.createElement('div', { className: 'dsh-session-kit-preview-title', title }, title),
              react.createElement('div', { className: 'dsh-session-kit-preview-actions' },
                react.createElement(primitives.Button, { variant: 'outline', size: 'sm', icon: react.createElement(RenameIcon), disabled: preview.loading || !canRename, onClick: onRename }, t('archivePreviewRename')),
                react.createElement(primitives.Button, { variant: 'outline', size: 'sm', icon: react.createElement(ExportIcon), disabled: preview.loading || !canExport, onClick: onExport }, t('archivePreviewExport'))
              )
            ),
            react.createElement('div', { className: 'dsh-session-kit-preview-attrs' }, attrs.map(renderAttr)),
            react.createElement('div', { className: 'dsh-session-kit-preview-tools' },
              react.createElement('div', { className: 'dsh-session-kit-preview-tools-label' }, t('archiveToolStats'), ' · ', t('archiveToolStatsTotal').replace('{count}', String(toolTotal))),
              toolCalls.length === 0
                ? react.createElement('div', { className: 'dsh-session-kit-preview-tools-empty' }, t('archiveToolStatsEmpty'))
                : react.createElement('div', { className: 'dsh-session-kit-preview-tool-list' }, toolCalls.map((entry) => react.createElement('span', { key: entry.name, className: 'dsh-session-kit-preview-tool-chip', title: `${entry.name} ×${entry.count}` }, entry.name, ' ×', String(entry.count))))
            )
          ),
          react.createElement('div', { className: 'dsh-session-kit-preview-body' },
            react.createElement('aside', { className: 'dsh-session-kit-preview-sidebar', 'aria-label': t('archivePreviewUserToc') },
              react.createElement('div', { className: 'dsh-session-kit-preview-sidebar-title' }, t('archivePreviewUserToc')),
              react.createElement('div', { className: 'dsh-session-kit-preview-toc-list' }, indexedUserMessages.map((message) => renderTocItem(message))),
              renderPager(tocPage, tocPageTotal, onTocPage, preview.tocLoading)
            ),
            react.createElement('section', { className: 'dsh-session-kit-preview-main' },
              react.createElement('div', { className: 'dsh-session-kit-preview-search-row' },
                react.createElement('div', { className: 'dsh-session-kit-preview-search dsh-session-kit-preview-search-with-icon' },
                  react.createElement('span', { className: 'dsh-session-kit-preview-search-icon', 'aria-hidden': 'true' }, react.createElement(primitives.IconSearchOutlineRegular, { size: 15 })),
                  react.createElement('input', {
                    className: 'dsh-session-kit-preview-search-input',
                    value: search,
                    placeholder: t('archivePreviewSearchPlaceholder'),
                    onChange: (event) => setSearch(event.currentTarget.value),
                    'aria-label': t('archivePreviewSearchPlaceholder')
                  }),
                  search !== '' && react.createElement('button', { type: 'button', className: 'dsh-session-kit-preview-search-clear', onClick: () => setSearch(''), 'aria-label': t('archiveSearchClear'), title: t('archiveSearchClear') }, react.createElement(primitives.IconCloseOutlineRegular, { size: 14 }))
                ),
                react.createElement('span', { className: 'dsh-session-kit-preview-count' }, messageCountText)
              ),
              messagesRefreshing && react.createElement('div', { className: 'dsh-session-kit-archive-empty' }, t('archivePreviewLoading')),
              !messagesRefreshing && preview.error && react.createElement('div', { role: 'alert', className: 'dsh-session-kit-archive-error' }, `${t('archivePreviewFailed')}: ${preview.error}`),
              !messagesRefreshing && !preview.error && totalMessages === 0 && react.createElement('div', { className: 'dsh-session-kit-archive-empty' }, search.trim() === '' ? t('archivePreviewEmpty') : t('archivePreviewSearchEmpty')),
              !messagesRefreshing && !preview.error && totalMessages > 0 && react.createElement(react.Fragment, null,
                react.createElement('div', { className: 'dsh-session-kit-preview-list', ref: listRef }, indexedMessages.map(renderMessage)),
                renderPager(messagePage, messagePageTotal, onMessagePage)
              )
            )
          )
        ),
        footer: react.createElement(primitives.Button, { variant: 'outline', disabled: preview.loading, onClick: onClose }, t('archiveClose'))
      });
    }

    function ArchivedSessionsDialog({ open, t, onClose, refreshWorkspaces, refreshSessions, openSession, exporter, renameCurrentSession, forkCurrentSession, updateSidebarEntries }) {
      const sidebarEntries = useSidebarEntries();
      const [items, setItems] = react.useState([]);
      const [loading, setLoading] = react.useState(false);
      const [busyId, setBusyId] = react.useState(null);
      const [error, setError] = react.useState(null);
      const [notice, setNotice] = react.useState(null);
      const [search, setSearch] = react.useState('');
      const [workdirFilter, setWorkdirFilter] = react.useState('');
      const [workdirMenuOpen, setWorkdirMenuOpen] = react.useState(false);
      const [workdirSearch, setWorkdirSearch] = react.useState('');
      const [archivePage, setArchivePage] = react.useState(0);
      const debouncedSearch = useDebouncedValue(search, 160);
      const [preview, setPreview] = react.useState({ open: false, loading: false, loadingScope: null, loadingMore: false, item: null, data: null, error: null, hasMore: false, nextOffset: 0 });
      const [deleteTarget, setDeleteTarget] = react.useState(null);
      const [previewRenameOpen, setPreviewRenameOpen] = react.useState(false);
      const [previewRenameDraft, setPreviewRenameDraft] = react.useState('');
      const [previewRenameError, setPreviewRenameError] = react.useState(null);
      const alive = react.useRef(true);
      const previewRequestRef = react.useRef(0);
      /* 行内「复制会话ID」的短暂反馈状态：值为 sessionId 表示已复制。 */
      const [copiedSessionId, setCopiedSessionId] = react.useState(null);
      const copiedSessionIdTimer = react.useRef(0);
      // Keep the two server-backed cursors independent while either request is in flight.
      const previewPageRef = react.useRef({ messagePage: 0, tocPage: 0 });
      const previewFirstPageCacheRef = react.useRef(new Map());
      const noticeTimer = react.useRef(undefined);
      const workdirMenuRef = react.useRef(null);
      const workdirSearchInputRef = react.useRef(null);
      const clearNotice = () => {
        window.clearTimeout(noticeTimer.current);
        noticeTimer.current = undefined;
        setNotice(null);
      };
      const showNotice = (message) => {
        window.clearTimeout(noticeTimer.current);
        setNotice(message);
        noticeTimer.current = window.setTimeout(() => {
          noticeTimer.current = undefined;
          if (alive.current) setNotice(null);
        }, 3500);
      };
      const refreshShell = react.useCallback(async (archiveValue) => {
        // Apply archive-set changes before refreshing sessions; otherwise a stale
        // session-list refresh can briefly render an archived/deleted session as restored.
        if (typeof refreshWorkspaces === 'function') await Promise.resolve().then(() => refreshWorkspaces(archiveValue)).catch(() => undefined);
        if (typeof refreshSessions === 'function') await Promise.resolve().then(() => refreshSessions()).catch(() => undefined);
      }, [refreshWorkspaces, refreshSessions]);
      const load = react.useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
          const value = await archiveRequest(ARCHIVE_LIST_ROUTE, {});
          if (alive.current) setItems(Array.isArray(value) ? value : []);
        } catch (reason) {
          if (alive.current) setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
          if (alive.current) setLoading(false);
        }
      }, []);
      react.useEffect(() => {
        alive.current = true;
        return () => {
          alive.current = false;
          window.clearTimeout(noticeTimer.current);
          window.clearTimeout(copiedSessionIdTimer.current);
        };
      }, []);
      react.useEffect(() => {
        if (!open) return;
        clearNotice();
        void load();
      }, [open, load]);
      const act = async (route, item) => {
        const deleting = route === ARCHIVE_DELETE_ROUTE;
        if (busyId !== null || (deleting && item.running) || (!deleting && item.missing)) return;
        setBusyId(item.sessionId);
        setError(null);
        clearNotice();
        try {
          const value = await archiveRequest(route, { sessionId: item.sessionId });
          if (alive.current) setItems(Array.isArray(value?.items) ? value.items : []);
          await refreshShell(value);
          if (alive.current) showNotice(deleting ? t('archiveDeleted') : t('archiveRestored'));
        } catch (reason) {
          if (alive.current) setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
          if (alive.current) setBusyId(null);
        }
      };
      const requestDelete = (item) => {
        if (busyId !== null || item.running) return;
        setError(null);
        clearNotice();
        setDeleteTarget(item);
      };
      const cancelDelete = () => {
        if (busyId === null) setDeleteTarget(null);
      };
      const confirmDelete = async () => {
        if (deleteTarget === null) return;
        const item = deleteTarget;
        setDeleteTarget(null);
        await act(ARCHIVE_DELETE_ROUTE, item);
      };
      const loadPreviewPage = async (request) => {
        const requestId = ++previewRequestRef.current;
        try {
          const data = await archiveRequest(ARCHIVE_PREVIEW_ROUTE, request);
          if (requestId !== previewRequestRef.current || !alive.current) return null;
          return data;
        } catch (reason) {
          if (requestId !== previewRequestRef.current || !alive.current) return null;
          throw reason;
        }
      };
      const mergePreviewData = (previous, next, scope) => {
        if (previous === null || scope === 'initial' || scope === 'both') return next;
        if (scope === 'toc') {
          return {
            ...previous,
            ...next,
            messages: previous.messages,
            totalMessages: previous.totalMessages,
            totalMatchedMessages: previous.totalMatchedMessages,
            offset: previous.offset,
            limit: previous.limit,
            nextOffset: previous.nextOffset,
            hasMore: previous.hasMore
          };
        }
        return {
          ...previous,
          ...next,
          userMessages: previous.userMessages,
          totalUserMessages: previous.totalUserMessages,
          tocOffset: previous.tocOffset,
          tocLimit: previous.tocLimit,
          tocHasMore: previous.tocHasMore
        };
      };
      const normalizePreviewSearch = (value) => String(value || '').trim();
      const firstPageCacheKey = (sessionId) => String(sessionId || '');
      const canUsePreviewFirstPageCache = (request, scope) => {
        if (firstPageCacheKey(request.sessionId) === '' || normalizePreviewSearch(request.search) !== '') return false;
        if (scope === 'toc') return request.tocOffset === 0;
        if (scope === 'messages') return request.offset === 0;
        return request.offset === 0 && request.tocOffset === 0;
      };
      const maybeWithPreviewItemMeta = (data, previewItem) => {
        if (!previewItem) return data;
        return {
          ...data,
          title: previewItem.title || data?.title,
          cwd: previewItem.cwd ?? data?.cwd,
          createdAt: previewItem.createdAt ?? data?.createdAt,
          updatedAt: previewItem.updatedAt ?? data?.updatedAt
        };
      };
      const rememberPreviewFirstPage = (data) => {
        if (data === null || typeof data !== 'object') return;
        if (firstPageCacheKey(data.sessionId) === '' || normalizePreviewSearch(data.search) !== '') return;
        if (data.offset !== 0 || data.tocOffset !== 0) return;
        previewFirstPageCacheRef.current.set(firstPageCacheKey(data.sessionId), data);
      };
      const applyPreviewPage = async ({ sessionId, previewItem, messagePage, tocPage, search = '', opening = false, area = 'main' }) => {
        const cursor = previewPageRef.current;
        const scope = opening ? 'initial' : area === 'toc' ? 'toc' : area === 'both' ? 'both' : 'messages';
        const nextMessagePage = Number.isSafeInteger(messagePage) ? Math.max(0, messagePage) : cursor.messagePage;
        const nextTocPage = Number.isSafeInteger(tocPage) ? Math.max(0, tocPage) : cursor.tocPage;
        previewPageRef.current = { messagePage: nextMessagePage, tocPage: nextTocPage };
        const request = {
          sessionId,
          offset: nextMessagePage * ARCHIVE_PREVIEW_MESSAGE_PAGE_SIZE,
          limit: ARCHIVE_PREVIEW_MESSAGE_PAGE_SIZE,
          tocOffset: nextTocPage * ARCHIVE_PREVIEW_TOC_PAGE_SIZE,
          tocLimit: ARCHIVE_PREVIEW_TOC_PAGE_SIZE,
          search
        };
        const cachedFirstPage = canUsePreviewFirstPageCache(request, scope) ? previewFirstPageCacheRef.current.get(firstPageCacheKey(sessionId)) : undefined;
        if (cachedFirstPage !== undefined) {
          previewRequestRef.current += 1;
          setPreview((current) => {
            const cachedData = maybeWithPreviewItemMeta(cachedFirstPage, previewItem ?? current.item);
            const merged = mergePreviewData(current.data, cachedData, scope);
            return {
              ...current,
              open: true,
              loading: false,
              loadingScope: null,
              loadingMore: false,
              item: previewItem ?? current.item,
              data: merged,
              hasMore: merged?.hasMore === true,
              nextOffset: Number.isSafeInteger(merged?.nextOffset) ? merged.nextOffset : request.offset,
              error: null
            };
          });
          return;
        }
        setPreview((current) => ({
          ...current,
          open: true,
          loading: true,
          loadingScope: scope,
          loadingMore: false,
          item: previewItem ?? current.item,
          error: null,
          ...opening ? { data: null } : {}
        }));
        try {
          const data = await loadPreviewPage(request);
          if (data === null) return;
          rememberPreviewFirstPage(data);
          setPreview((current) => {
            const merged = mergePreviewData(current.data, data, scope);
            return {
              ...current,
              open: true,
              loading: false,
              loadingScope: null,
              loadingMore: false,
              item: previewItem ?? current.item,
              data: merged,
              hasMore: merged?.hasMore === true,
              nextOffset: Number.isSafeInteger(merged?.nextOffset) ? merged.nextOffset : request.offset,
              error: null
            };
          });
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : String(reason);
          if (alive.current) setPreview((current) => ({
            ...current,
            loading: false,
            loadingScope: null,
            loadingMore: false,
            error: message
          }));
        }
      };
      const view = async (item) => {
        if (busyId !== null || item.missing) return;
        setBusyId(item.sessionId);
        setError(null);
        clearNotice();
        const previewItem = { ...item };
        previewPageRef.current = { messagePage: 0, tocPage: 0 };
        setPreview({ open: true, loading: true, loadingMore: false, item: previewItem, data: null, error: null, hasMore: false, nextOffset: 0 });
        await applyPreviewPage({ sessionId: item.sessionId, previewItem, messagePage: 0, tocPage: 0, opening: true });
        if (alive.current) setBusyId(null);
      };
      const applyPreviewPageRef = react.useRef(null);
      applyPreviewPageRef.current = applyPreviewPage;
      const previewSessionId = preview.item?.sessionId;
      const previewSearch = preview.data?.search ?? '';
      const searchPreview = react.useCallback((search) => {
        if (!previewSessionId) return;
        previewPageRef.current = { messagePage: 0, tocPage: 0 };
        void applyPreviewPageRef.current?.({ sessionId: previewSessionId, messagePage: 0, tocPage: 0, search, area: 'both' });
      }, [previewSessionId]);
      const changePreviewMessagePage = (page, searchOverride) => {
        if (!previewSessionId) return;
        const nextMessagePage = Math.max(0, page);
        previewPageRef.current = { ...previewPageRef.current, messagePage: nextMessagePage };
        void applyPreviewPageRef.current?.({ sessionId: previewSessionId, messagePage: nextMessagePage, search: searchOverride === undefined ? previewSearch : searchOverride, area: 'messages' });
      };
      const changePreviewTocPage = (page, searchOverride) => {
        if (!previewSessionId) return;
        const nextTocPage = Math.max(0, page);
        previewPageRef.current = { ...previewPageRef.current, tocPage: nextTocPage };
        void applyPreviewPageRef.current?.({ sessionId: previewSessionId, tocPage: nextTocPage, search: searchOverride === undefined ? previewSearch : searchOverride, area: 'toc' });
      };
      const openPreviewRename = () => {
        if (!previewSessionId || typeof renameCurrentSession !== 'function' || busyId !== null) return;
        setPreviewRenameDraft(String(preview.data?.title || preview.item?.title || ''));
        setPreviewRenameError(null);
        setPreviewRenameOpen(true);
      };
      const closePreviewRename = () => {
        if (busyId !== null) return;
        setPreviewRenameOpen(false);
        setPreviewRenameError(null);
      };
      const confirmPreviewRename = async () => {
        const title = previewRenameDraft.trim();
        if (!previewSessionId || title === '' || typeof renameCurrentSession !== 'function') {
          if (title === '') setPreviewRenameError(t('renameEmpty'));
          return;
        }
        setBusyId(previewSessionId);
        setPreviewRenameError(null);
        try {
          const value = await renameCurrentSession(previewSessionId, title);
          const acceptedTitle = value?.title || title;
          setPreview((current) => ({
            ...current,
            item: current.item ? { ...current.item, title: acceptedTitle } : current.item,
            data: current.data ? { ...current.data, title: acceptedTitle } : current.data
          }));
          setItems((current) => current.map((entry) => String(entry.sessionId) === String(previewSessionId) ? { ...entry, title: acceptedTitle } : entry));
          setPreviewRenameOpen(false);
          await refreshSessions?.();
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : String(reason);
          setPreviewRenameError(`${t('renameSessionFailed')}: ${message}`);
        } finally {
          if (alive.current) setBusyId(null);
        }
      };
      const exportPreview = async () => {
        if (!previewSessionId || typeof exporter?.download !== 'function') return;
        try {
          await exporter.download(previewSessionId);
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : String(reason);
          if (alive.current) setError(`${t('archivePreviewExportUnavailable')}: ${message}`);
        }
      };
      const exportArchived = async (item) => {
        if (busyId !== null || item.missing || typeof exporter?.download !== 'function') {
          if (typeof exporter?.download !== 'function') setError(t('exportUnavailable'));
          return;
        }
        setBusyId(item.sessionId);
        setError(null);
        clearNotice();
        try {
          await exporter.download(item.sessionId);
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : String(reason);
          if (alive.current) setError(`${t('exportFailed')}: ${message}`);
        } finally {
          if (alive.current) setBusyId(null);
        }
      };
      const closePreview = () => {
        if (!preview.loading && !preview.loadingMore) {
          previewRequestRef.current += 1;
          setPreviewRenameOpen(false);
          setPreviewRenameError(null);
          setPreview({ open: false, loading: false, loadingMore: false, item: null, data: null, error: null, hasMore: false, nextOffset: 0 });
        }
      };
      const openFolder = async (item) => {
        if (busyId !== null || item.missing) return;
        setBusyId(item.sessionId);
        setError(null);
        clearNotice();
        try {
          await request(OPEN_ROUTE, item.sessionId);
          if (alive.current) showNotice(t('archiveFolderOpened'));
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : String(reason);
          if (alive.current) setError(`${t('archiveFolderFailed')}: ${message}`);
        } finally {
          if (alive.current) setBusyId(null);
        }
      };
      const forkSession = async (item) => {
        if (busyId !== null || item.missing || typeof forkCurrentSession !== 'function') return;
        setBusyId(item.sessionId);
        setError(null);
        clearNotice();
        try {
          const childId = await forkCurrentSession(item.sessionId);
          if (childId !== undefined) openSession?.(childId);
          onClose();
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : String(reason);
          if (alive.current) setError(`${t('archiveForkFailed')}: ${message}`);
        } finally {
          if (alive.current) setBusyId(null);
        }
      };
      const normalizedSearch = debouncedSearch.trim().toLocaleLowerCase();
      const workdirOptions = react.useMemo(() => {
        const values = Array.from(new Set(items.map((item) => typeof item.cwd === 'string' && item.cwd.length > 0 ? item.cwd : '__missing__')));
        values.sort((left, right) => {
          if (left === '__missing__') return 1;
          if (right === '__missing__') return -1;
          return left.localeCompare(right);
        });
        return values;
      }, [items]);
      react.useEffect(() => {
        if (workdirFilter !== '' && !workdirOptions.includes(workdirFilter)) setWorkdirFilter('');
      }, [workdirFilter, workdirOptions]);
      const workdirMenuItems = react.useMemo(() => [
        { id: '', label: t('archiveAllWorkdirs') },
        ...workdirOptions.map((cwd) => ({ id: cwd, label: cwd === '__missing__' ? t('archiveMissingWorkdir') : cwd }))
      ], [workdirOptions, t]);
      const normalizedWorkdirSearch = workdirSearch.trim().toLocaleLowerCase();
      const visibleWorkdirMenuItems = react.useMemo(() => {
        if (normalizedWorkdirSearch === '') return workdirMenuItems;
        return [
          workdirMenuItems[0],
          ...workdirMenuItems.slice(1).filter((item) => String(item.label).toLocaleLowerCase().includes(normalizedWorkdirSearch))
        ];
      }, [workdirMenuItems, normalizedWorkdirSearch]);
      const selectedWorkdirLabel = workdirMenuItems.find((item) => item.id === workdirFilter)?.label ?? t('archiveAllWorkdirs');
      const selectWorkdir = (id) => {
        setWorkdirFilter(id);
        setWorkdirMenuOpen(false);
      };
      react.useEffect(() => {
        if (!workdirMenuOpen) {
          setWorkdirSearch('');
          return;
        }
        const focusTimer = window.setTimeout(() => workdirSearchInputRef.current?.focus?.(), 0);
        const onPointerDown = (event) => {
          const root = workdirMenuRef.current;
          if (root !== null && event.target instanceof Node && root.contains(event.target)) return;
          setWorkdirMenuOpen(false);
        };
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setWorkdirMenuOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
          window.clearTimeout(focusTimer);
          document.removeEventListener('pointerdown', onPointerDown);
          document.removeEventListener('keydown', onKeyDown);
        };
      }, [workdirMenuOpen]);
      const workdirAnchor = react.createElement(
        'span',
        { className: 'dsh-session-kit-archive-workdir-anchor' },
        react.createElement(
          primitives.Button,
          {
            variant: 'outline',
            size: 'sm',
            disabled: loading || workdirOptions.length === 0,
            onClick: () => setWorkdirMenuOpen((value) => !value),
            'aria-expanded': workdirMenuOpen,
            'aria-haspopup': 'listbox',
            'aria-label': t('archiveWorkdirLabel'),
            title: selectedWorkdirLabel
          },
          react.createElement('span', { className: 'dsh-session-kit-archive-workdir-label' }, selectedWorkdirLabel),
          react.createElement(primitives.IconChevronDownOutlineRegular, { size: 14 })
        )
      );
      const copyArchivedSessionId = async (item) => {
        const text = String(item?.sessionId ?? '').trim();
        if (text === '') return;
        window.clearTimeout(copiedSessionIdTimer.current);
        let ok = false;
        try {
          ok = (await primitives.writeClipboard(text)) !== false;
        } catch {
          ok = false;
        }
        if (!alive.current) return;
        if (!ok) {
          showNotice(t('statsSessionIdCopyFailed'));
          return;
        }
        setCopiedSessionId(text);
        copiedSessionIdTimer.current = window.setTimeout(() => {
          if (alive.current) setCopiedSessionId(null);
        }, 1600);
      };
      const filteredItems = react.useMemo(() => {
        return items.filter((item) => {
          const sessionId = normalizedSessionId(item.sessionId);
          /* 会话ID只认完整匹配（前缀/子串一律不命中：旧格式 "session-<uuid>" 的公共前缀
             会让任何部分输入命中整库）。但 "session-" 前缀不算匹配信息、且库存里两种写法都有
             （136/144 带前缀、8 条不带），故两侧都剥掉前缀再比，用户带不带前缀都能查到。
             行内胶囊展示的是短ID，仅便于肉眼区分，不参与搜索。 */
          const titleMatched = normalizedSearch === ''
            || String(item.title || item.sessionId).toLocaleLowerCase().includes(normalizedSearch)
            || (sessionId !== '' && sessionId === normalizedSessionId(normalizedSearch));
          const itemWorkdir = typeof item.cwd === 'string' && item.cwd.length > 0 ? item.cwd : '__missing__';
          const workdirMatched = workdirFilter === '' || itemWorkdir === workdirFilter;
          return titleMatched && workdirMatched;
        });
      }, [items, normalizedSearch, workdirFilter]);
      const filtered = normalizedSearch !== '' || workdirFilter !== '';
      const archivePageCount = Math.max(1, Math.ceil(filteredItems.length / ARCHIVE_LIST_PAGE_SIZE));
      const archiveCurrentPage = Math.min(archivePage, archivePageCount - 1);
      const pagedArchiveItems = react.useMemo(() => filteredItems.slice(archiveCurrentPage * ARCHIVE_LIST_PAGE_SIZE, archiveCurrentPage * ARCHIVE_LIST_PAGE_SIZE + ARCHIVE_LIST_PAGE_SIZE), [filteredItems, archiveCurrentPage]);
      react.useEffect(() => {
        if (archivePage !== archiveCurrentPage) setArchivePage(archiveCurrentPage);
      }, [archivePage, archiveCurrentPage]);
      react.useEffect(() => {
        setArchivePage(0);
      }, [normalizedSearch, workdirFilter]);
      const countText = !filtered
        ? t('archiveCount').replace('{count}', String(items.length))
        : t('archiveFilteredCount').replace('{shown}', String(filteredItems.length)).replace('{total}', String(items.length));
      const close = () => {
        if (busyId === null) onClose();
      };
      return react.createElement(
        react.Fragment,
        null,
        react.createElement(primitives.Modal, {
          /* 预览打开时归档弹窗必须保持 open：若随预览置为 false，宿主 Modal 会把它
             当作用户关闭而触发 onClose，预览关掉后归档弹窗就没了。预览渲染在其后、
             叠在上层，与记忆/任务弹窗的父子叠加模式一致。 */
          open,
          onClose: close,
          title: react.createElement(ModalTitleWithEntryToggle, {
            title: t('archiveTitle'),
            visible: sidebarEntries?.archiveVisible,
            onToggleVisible: (archiveVisible) => updateSidebarEntries?.({ ...sidebarEntries, archiveVisible }),
            label: t(sidebarEntries?.archiveVisible === false ? 'archiveHideSidebarEntry' : 'archiveShowSidebarEntry'),
            t
          }),
          closeLabel: t('archiveClose'),
          className: 'dsh-session-kit-archive-modal',
          children: react.createElement(
            'div',
            { className: 'dsh-session-kit-archive' },
            /* 提示/错误与记忆管理弹窗一致：绝对定位悬浮在标题区（title-notice） */
            notice && react.createElement('div', { role: 'status', className: 'dsh-session-kit-compaction-success dsh-session-kit-modal-title-notice' }, notice),
            error && react.createElement('div', { role: 'alert', className: 'dsh-session-kit-compaction-error dsh-session-kit-modal-title-notice' }, error),
            react.createElement('div', { className: 'dsh-session-kit-archive-head' },
              react.createElement('div', { className: 'dsh-session-kit-archive-toolbar' },
                react.createElement('span', { className: 'dsh-session-kit-archive-count' }, countText)
              )
            ),
            react.createElement('div', { className: 'dsh-session-kit-archive-filter-row' },
              react.createElement('div', { className: 'dsh-session-kit-archive-search dsh-session-kit-archive-search-with-icon' },
                react.createElement('span', { className: 'dsh-session-kit-archive-search-icon', 'aria-hidden': 'true' }, react.createElement(primitives.IconSearchOutlineRegular, { size: 15 })),
                react.createElement('input', {
                  className: 'dsh-session-kit-archive-search-input',
                  value: search,
                  placeholder: t('archiveSearchPlaceholder'),
                  onChange: (event) => setSearch(event.currentTarget.value),
                  disabled: loading,
                  'aria-label': t('archiveSearchPlaceholder')
                }),
                search !== '' && react.createElement('button', {
                  type: 'button',
                  className: 'dsh-session-kit-archive-search-clear',
                  onClick: () => setSearch(''),
                  'aria-label': t('archiveSearchClear'),
                  title: t('archiveSearchClear')
                }, react.createElement(primitives.IconCloseOutlineRegular, { size: 14 }))
              ),
              react.createElement('span', { className: 'dsh-session-kit-archive-workdir-menu', ref: workdirMenuRef },
                workdirAnchor,
                workdirMenuOpen && react.createElement('div', { className: 'dsh-session-kit-archive-workdir-panel', role: 'dialog', 'aria-label': t('archiveWorkdirLabel') },
                  react.createElement('div', { className: 'dsh-session-kit-archive-workdir-search dsh-session-kit-archive-search-with-icon' },
                    react.createElement('span', { className: 'dsh-session-kit-archive-search-icon', 'aria-hidden': 'true' }, react.createElement(primitives.IconSearchOutlineRegular, { size: 15 })),
                    react.createElement('input', {
                      ref: workdirSearchInputRef,
                      className: 'dsh-session-kit-archive-workdir-search-input dsh-session-kit-archive-search-input',
                      value: workdirSearch,
                      placeholder: t('archiveWorkdirSearchPlaceholder'),
                      onChange: (event) => setWorkdirSearch(event.currentTarget.value),
                      'aria-label': t('archiveWorkdirSearchPlaceholder')
                    }),
                    workdirSearch !== '' && react.createElement('button', {
                      type: 'button',
                      className: 'dsh-session-kit-archive-search-clear',
                      onClick: () => setWorkdirSearch(''),
                      'aria-label': t('archiveSearchClear'),
                      title: t('archiveSearchClear')
                    }, react.createElement(primitives.IconCloseOutlineRegular, { size: 14 }))
                  ),
                  react.createElement('div', { className: 'dsh-session-kit-archive-workdir-options', role: 'listbox', 'aria-label': t('archiveWorkdirLabel') },
                    visibleWorkdirMenuItems.map((item) => react.createElement('button', {
                      key: item.id,
                      type: 'button',
                      role: 'option',
                      className: `dsh-session-kit-archive-workdir-option${item.id === workdirFilter ? ' dsh-session-kit-archive-workdir-option-selected' : ''}`,
                      'aria-selected': item.id === workdirFilter,
                      title: item.label,
                      onClick: () => selectWorkdir(item.id)
                    },
                      react.createElement('span', { className: 'dsh-session-kit-archive-workdir-option-label' }, item.label),
                      item.id === workdirFilter && react.createElement(primitives.IconCheckOutlineRegular, { size: 14 })
                    )),
                    normalizedWorkdirSearch !== '' && visibleWorkdirMenuItems.length <= 1 && react.createElement('div', { className: 'dsh-session-kit-archive-workdir-empty' }, t('archiveWorkdirSearchEmpty'))
                  )
                )
              )
            ),
            loading && react.createElement('div', { className: 'dsh-session-kit-archive-empty' }, t('archiveLoading')),
            !loading && items.length === 0 && react.createElement('div', { className: 'dsh-session-kit-archive-empty' }, t('archiveEmpty')),
            !loading && items.length > 0 && filteredItems.length === 0 && react.createElement('div', { className: 'dsh-session-kit-archive-empty' }, t('archiveSearchEmpty')),
            !loading && filteredItems.length > 0 && react.createElement(react.Fragment, null,
              react.createElement('div', { className: 'dsh-session-kit-archive-list' }, pagedArchiveItems.map((item) => react.createElement(
                'div',
                { key: item.sessionId, className: 'dsh-session-kit-archive-row' },
                react.createElement('div', { className: 'dsh-session-kit-archive-main' },
                  react.createElement('div', { className: 'dsh-session-kit-archive-title', title: item.title }, item.title || item.sessionId),
                  react.createElement('div', { className: 'dsh-session-kit-archive-meta', title: `${formatArchiveTime(item.updatedAt)} · ${item.cwd || item.sessionId}` },
                    react.createElement('span', { className: 'dsh-session-kit-archive-meta-item dsh-session-kit-archive-meta-time' },
                      react.createElement('span', { className: 'dsh-session-kit-archive-meta-icon', 'aria-hidden': 'true' }, react.createElement(DurationClockIcon, { size: 14 })),
                      react.createElement('span', { className: 'dsh-session-kit-archive-meta-text' }, formatArchiveTime(item.updatedAt) || t('archivePreviewUnknown'))
                    ),
                    react.createElement('span', { className: 'dsh-session-kit-archive-meta-item dsh-session-kit-archive-meta-cwd' },
                      react.createElement('span', { className: 'dsh-session-kit-archive-meta-icon', 'aria-hidden': 'true' }, react.createElement(primitives.IconFolderOpenOutlineRegular, { size: 14 })),
                      react.createElement('span', { className: 'dsh-session-kit-archive-meta-text', title: item.cwd || item.sessionId }, item.cwd || item.sessionId)
                    ),
                    /* 会话ID按前端截断显示（完整值在 title 与复制按钮里），与搜索的「名称或ID」提示呼应。 */
                    react.createElement('span', { className: 'dsh-session-kit-archive-meta-item dsh-session-kit-archive-meta-session' },
                      react.createElement(primitives.Button, {
                        variant: 'ghost',
                        size: 'sm',
                        className: `dsh-session-kit-archive-session-copy${copiedSessionId === item.sessionId ? ' dsh-session-kit-archive-session-copy-copied' : ''}`,
                        icon: react.createElement(copiedSessionId === item.sessionId ? primitives.IconCheckOutlineRegular : primitives.IconCopyOutlineRegular, { size: 14 }),
                        disabled: busyId !== null,
                        onClick: () => void copyArchivedSessionId(item),
                        title: `${t('statsCopySessionId')} · ${item.sessionId}`,
                        'aria-label': `${t('statsCopySessionId')} ${item.sessionId}`
                      }, copiedSessionId === item.sessionId ? t('archiveSessionIdCopied') : `${t('archiveSessionIdLabel')} ${shortArchiveSessionId(item.sessionId)}`)
                    ),
                    item.missing ? react.createElement('span', { className: 'dsh-session-kit-archive-meta-status' }, t('archiveMissing')) : null,
                    item.running ? react.createElement('span', { className: 'dsh-session-kit-archive-meta-status' }, t('running')) : null
                  )
                ),
                react.createElement('div', { className: 'dsh-session-kit-archive-actions' },
                  react.createElement(primitives.Button, { variant: 'outline', size: 'sm', disabled: busyId !== null || item.missing || typeof forkCurrentSession !== 'function', onClick: () => void forkSession(item) }, t('archiveContinueNew')),
                  react.createElement(primitives.Button, { variant: 'outline', size: 'sm', disabled: busyId !== null || item.missing, onClick: () => void act(ARCHIVE_RESTORE_ROUTE, item) }, t('archiveRestore')),
                  react.createElement(primitives.Button, { variant: 'outline', size: 'sm', disabled: busyId !== null || item.missing, onClick: () => void view(item) }, t('archiveView')),
                  react.createElement(primitives.Button, { variant: 'outline', size: 'sm', disabled: busyId !== null || item.missing || typeof exporter?.download !== 'function', onClick: () => void exportArchived(item) }, t('archiveExport')),
                  react.createElement(primitives.Button, { variant: 'outline', size: 'sm', disabled: busyId !== null || item.missing, onClick: () => void openFolder(item) }, t('archiveFolder')),
                  react.createElement(primitives.Button, {
                    variant: 'outline',
                    size: 'sm',
                    disabled: busyId !== null || item.running,
                    icon: react.createElement(DeleteIcon),
                    onClick: () => requestDelete(item),
                    style: { color: 'var(--dsw-alias-state-error-primary)', borderColor: 'var(--dsw-alias-state-error-primary)' }
                  }, t('archiveDelete'))
                )
              ))),
              archivePageCount > 1 && react.createElement('div', { className: 'dsh-session-kit-preview-pager' },
                react.createElement(primitives.Button, { variant: 'outline', size: 'sm', disabled: busyId !== null || archiveCurrentPage <= 0, onClick: () => setArchivePage((value) => Math.max(0, value - 1)) }, t('archivePreviewPrev')),
                react.createElement('span', { className: 'dsh-session-kit-preview-page-text' }, t('archivePreviewPage').replace('{page}', String(archiveCurrentPage + 1)).replace('{total}', String(archivePageCount))),
                react.createElement(primitives.Button, { variant: 'outline', size: 'sm', disabled: busyId !== null || archiveCurrentPage >= archivePageCount - 1, onClick: () => setArchivePage((value) => Math.min(archivePageCount - 1, value + 1)) }, t('archivePreviewNext'))
              )
            )
          ),
          footer: react.createElement(primitives.Button, { variant: 'outline', disabled: busyId !== null, onClick: close }, t('archiveClose'))
        }),
        react.createElement(DeleteConfirmDialog, {
          open: open && !preview.open && deleteTarget !== null,
          t,
          title: t('archiveDelete'),
          message: t('archiveDeleteConfirm').replace('{title}', deleteTarget?.title || deleteTarget?.sessionId || ''),
          confirmLabel: t('archiveDelete'),
          onCancel: cancelDelete,
          onConfirm: () => void confirmDelete(),
          busy: busyId !== null
        }),
        react.createElement(ArchivePreviewDialog, {
          preview,
          t,
          onClose: closePreview,
          onSearch: searchPreview,
          onMessagePage: changePreviewMessagePage,
          onTocPage: changePreviewTocPage,
          onRename: openPreviewRename,
          onExport: () => void exportPreview(),
          canRename: typeof renameCurrentSession === 'function',
          canExport: typeof exporter?.download === 'function'
        }),
        react.createElement(RenameDialog, {
          open: previewRenameOpen,
          t,
          value: previewRenameDraft,
          error: previewRenameError,
          busy: busyId !== null,
          onChange: setPreviewRenameDraft,
          onCancel: closePreviewRename,
          onConfirm: () => void confirmPreviewRename()
        })
      );
    }

    function RenameDialog({ open, t, value, error, busy, onChange, onCancel, onConfirm }) {
      return react.createElement(primitives.Modal, {
        open,
        onClose: onCancel,
        title: t('renameTitle'),
        closeLabel: t('cancel'),
        className: 'dsh-session-kit-rename-modal',
        children: react.createElement('div', { className: 'dsh-session-kit-rename' },
          react.createElement('input', {
            className: 'dsh-session-kit-rename-input',
            value,
            placeholder: t('renamePlaceholder'),
            disabled: busy,
            autoFocus: true,
            onChange: (event) => onChange(event.currentTarget.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter' && !busy) onConfirm();
            },
            'aria-label': t('renamePlaceholder')
          }),
          error && react.createElement('div', { role: 'alert', className: 'dsh-session-kit-rename-error' }, error)
        ),
        footer: react.createElement(
          react.Fragment,
          null,
          react.createElement(primitives.Button, { variant: 'outline', disabled: busy, onClick: onCancel }, t('cancel')),
          react.createElement(primitives.Button, { variant: 'outline', disabled: busy || value.trim() === '', onClick: onConfirm }, t('renameConfirm'))
        )
      });
    }

    function EditRegenerateDialog({ open, t, value, error, busy, onChange, onCancel, onConfirm }) {
      const textareaRef = react.useRef(null);
      react.useEffect(() => {
        if (!open) return;
        const frame = window.requestAnimationFrame(() => {
          const textarea = textareaRef.current;
          if (!(textarea instanceof HTMLTextAreaElement)) return;
          textarea.focus();
          const end = textarea.value.length;
          textarea.setSelectionRange(end, end);
        });
        return () => window.cancelAnimationFrame(frame);
      }, [open]);
      return react.createElement(primitives.Modal, {
        open,
        onClose: onCancel,
        title: t('edit.title'),
        closeLabel: t('dialog.cancel'),
        className: 'dsh-session-kit-edit-modal',
        children: react.createElement('div', { className: 'dsh-session-kit-edit' },
          react.createElement('textarea', {
            ref: textareaRef,
            className: 'dsh-session-kit-edit-textarea',
            value,
            placeholder: t('edit.placeholder'),
            disabled: busy,
            autoFocus: true,
            rows: 8,
            onChange: (event) => onChange(event.currentTarget.value),
            'aria-label': t('edit.placeholder')
          }),
          error && react.createElement('div', { role: 'alert', className: 'dsh-session-kit-rename-error' }, error)
        ),
        footer: react.createElement(
          react.Fragment,
          null,
          react.createElement(primitives.Button, { variant: 'outline', disabled: busy, onClick: onCancel }, t('dialog.cancel')),
          react.createElement(primitives.Button, { variant: 'outline', disabled: busy || value.trim() === '', onClick: onConfirm }, busy ? t('dialog.deleting') : t('edit.confirm'))
        )
      });
    }

    function RepairSessionDialog({ open, t, busy, result, error, onClose, onRepair }) {
      const changed = result?.changed === true;
      const fieldCount = Object.values(result?.removed || {}).reduce((sum, n) => sum + n, 0);
      const dropCount = Object.values(result?.dropped || {}).reduce((sum, n) => sum + n, 0);
      /* 逐项列出清掉了什么，便于确认修复范围。 */
      const detailRows = [];
      if (result) {
        for (const [key, count] of Object.entries(result.removed || {})) detailRows.push(`${key} × ${count}`);
        for (const [key, count] of Object.entries(result.dropped || {})) {
          detailRows.push(`${key === 'turn-tombstone' ? t('repairSessionTombstone') : key} × ${count}`);
        }
      }
      return react.createElement(primitives.Modal, {
        open,
        onClose: busy ? () => undefined : onClose,
        title: t('repairSessionTitle'),
        closeLabel: t('cancel'),
        className: 'dsh-session-kit-confirm',
        children: react.createElement(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 12, color: 'var(--dsw-alias-label-secondary)', lineHeight: '20px', overflowWrap: 'anywhere' } },
          /* 首行说明该修复适用于哪类会话：加载失败的旧版本会话（v0 迁移链拒绝的那类）。 */
          react.createElement('span', null, t('repairSessionOldVersion')),
          /* 其余说明行独立成元素，行间距由 gap 控制。 */
          ...t('repairSessionDesc').split('\n').map((row) => react.createElement('span', null, row)),
          react.createElement('span', { style: { color: 'var(--dsw-alias-label-primary)' } }, t('repairSessionAutoReload')),
          error && react.createElement('span', { role: 'alert', style: { color: 'var(--dsw-alias-state-error-primary)' } }, error),
          result && react.createElement('span', {
            style: { fontSize: 12, color: changed ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)' }
          }, changed
            ? t('repairSessionSuccess').replace('{events}', String(result.repairedEvents)).replace('{fields}', String(fieldCount)).replace('{dropped}', String(dropCount))
            : t('repairSessionNoChange')),
          detailRows.length > 0 && react.createElement('span', {
            style: { fontSize: 12, opacity: 0.75 }
          }, detailRows.join(' · ')),
          result && result.loadableAfter === false && react.createElement('span', {
            style: { fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' }
          }, t('repairSessionStillUnloadable')),
          result?.changed === true && result?.loadableAfter !== false && react.createElement('span', {
            style: { fontSize: 12, color: 'var(--dsw-alias-state-success-primary, var(--dsw-alias-label-primary))' }
          }, t('repairSessionReloading'))
        ),
        footer: react.createElement(
          react.Fragment,
          null,
          react.createElement(primitives.Button, { variant: 'outline', onClick: onClose, disabled: busy }, t('cancel')),
          react.createElement(primitives.Button, { variant: 'outline', disabled: busy, onClick: onRepair }, busy ? `${t('repairSessionAction')}…` : t('repairSessionAction'))
        )
      });
    }

    function DeleteConfirmDialog({ open, t, onCancel, onConfirm, busy, title, message, confirmLabel, danger = true }) {
      const confirmStyle = danger
        ? { color: 'var(--dsw-alias-state-error-primary)', borderColor: 'var(--dsw-alias-state-error-primary)' }
        : { color: 'var(--dsw-alias-state-business-primary)', borderColor: 'color-mix(in srgb, var(--dsw-alias-state-business-primary) 50%, transparent)' };
      return react.createElement(primitives.Modal, {
        open,
        onClose: onCancel,
        title: title || t('delete'),
        closeLabel: t('cancel'),
        className: 'dsh-session-kit-confirm',
        children: react.createElement(
          'div',
          { style: { display: 'flex', alignItems: 'flex-start', gap: 8, color: 'var(--dsw-alias-label-secondary)', lineHeight: '28px', whiteSpace: 'pre-line', overflowWrap: 'anywhere' } },
          react.createElement(
            'span',
            { style: { display: 'inline-flex', width: 16, height: 28, alignItems: 'center', justifyContent: 'center', color: danger ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-business-primary)', flex: 'none' } },
            react.createElement(primitives.IconWarningOutlineRegular, { size: 16 })
          ),
          react.createElement('span', { style: { minWidth: 0 } }, message || t('confirm'))
        ),
        footer: react.createElement(
          react.Fragment,
          null,
          react.createElement(primitives.Button, { variant: 'outline', autoFocus: true, onClick: onCancel }, t('cancel')),
          react.createElement(primitives.Button, {
            variant: 'outline',
            disabled: busy,
            onClick: onConfirm,
            style: confirmStyle
          }, confirmLabel || t('delete'))
        )
      });
    }

    /* 设置页「左/右导航」开关的门卫：关闭时不挂载对应浮动导航（store 变化即时生效）。 */
    function HeadingQuickNavGate(props) {
      const sidebarEntries = useSidebarEntries();
      if (sidebarEntries.leftNavEnabled === false) return null;
      return react.createElement(HeadingQuickNav, props);
    }
    function TopicQuickNavGate(props) {
      const sidebarEntries = useSidebarEntries();
      if (sidebarEntries.rightNavEnabled === false) return null;
      return react.createElement(TopicQuickNav, props);
    }

    /* DSH 设置弹窗的 session-kit 分节：模块化区块（边框+圆角），
       之后的其他模块设置照此结构追加。开关先改草稿，「保存」才持久化生效。 */
    function SessionKitSettingsSection({ t, updateSidebarEntries, resolveModelDirectory, pickDirectory }) {
      const sidebarEntries = useSidebarEntries();
      const [draft, setDraft] = react.useState(() => ({
        leftNavEnabled: sidebarEntries.leftNavEnabled !== false,
        rightNavEnabled: sidebarEntries.rightNavEnabled !== false
      }));
      const [saving, setSaving] = react.useState(false);
      const [savedNotice, setSavedNotice] = react.useState('');
      const savedNoticeTimer = react.useRef(0);
      react.useEffect(() => () => window.clearTimeout(savedNoticeTimer.current), []);
      const showSavedNotice = (text) => {
        window.clearTimeout(savedNoticeTimer.current);
        setSavedNotice(text);
        savedNoticeTimer.current = window.setTimeout(() => setSavedNotice(''), 2000);
      };
      const dirty = draft.leftNavEnabled !== (sidebarEntries.leftNavEnabled !== false)
        || draft.rightNavEnabled !== (sidebarEntries.rightNavEnabled !== false);
      const save = async () => {
        if (saving || !dirty) return;
        setSaving(true);
        try {
          await updateSidebarEntries?.({ ...sidebarEntries, leftNavEnabled: draft.leftNavEnabled, rightNavEnabled: draft.rightNavEnabled });
          showSavedNotice(t('settingsSaved'));
        } catch (reason) {
          showSavedNotice(`${t('settingsSaveFailed')}：${reason instanceof Error ? reason.message : String(reason)}`);
        } finally {
          setSaving(false);
        }
      };
      const row = (label, enabled, onChange) => react.createElement('button', {
        type: 'button',
        className: 'dsh-session-kit-settings-row',
        onClick: () => setDraft((current) => ({ ...current, [onChange]: !enabled }))
      },
        react.createElement('span', { className: 'dsh-session-kit-settings-row-label' }, label),
        renderToggleSwitch(enabled)
      );
      return react.createElement('div', { className: 'dsh-session-kit-settings' },
        react.createElement('div', { className: 'dsh-session-kit-settings-module' },
          react.createElement('div', { className: 'dsh-session-kit-settings-module-title' }, t('settingsModuleNavTitle')),
          row(t('settingsLeftNavToggle'), draft.leftNavEnabled, 'leftNavEnabled'),
          row(t('settingsRightNavToggle'), draft.rightNavEnabled, 'rightNavEnabled'),
          react.createElement('div', { className: 'dsh-session-kit-settings-module-foot' },
            savedNotice !== '' && react.createElement('span', { role: 'status', className: 'dsh-session-kit-settings-module-status' }, savedNotice),
            react.createElement(primitives.Button, {
              variant: 'outline',
              size: 'sm',
              disabled: saving || !dirty,
              onClick: () => void save()
            }, saving ? t('settingsSaving') : t('settingsSave'))
          )
        ),
        /* 「记忆tab显示设置」：独立模块、独立草稿与保存态，
           与上方导航模块互不牵连（各自 dirty / saving / 提示）。 */
        react.createElement(SessionMemoryTabSettingsModule, { t, updateSidebarEntries }),
        /* 「记忆蒸馏使用模型」：与记忆管理弹窗的设置 tab 同一份 UI 与同一份设置
           （set-distill-model 是全局设置）。放在 Embedding 上方，与弹窗内的顺序一致。 */
        react.createElement(DistillSettingsModule, { t, resolveModelDirectory }),
        /* 「记忆召回设置」：与弹窗同一份 UI；配额计算走模块级纯函数，两处结果一致。
           顺序与弹窗内一致：蒸馏 → 召回 → 保存目录 → Embedding。 */
        react.createElement(RecallSettingsModule, { t }),
        /* 「记忆保存目录设置」：走独立路由（记忆库可迁出 memory.sqlite 之外），
           目录选择器由宿主注入（设置页组件拿不到 ctx）。 */
        react.createElement(StorageSettingsModule, { t, pickDirectory }),
        /* 「Embedding 语义检索」：默认关闭；开启后才展开 API 配置。
           降级（接口失败 → 纯词法）、回填（首次开启自动补算历史记忆）、
           换模型重建（指纹变化）全部由宿主端自动处理，此处只需开关 + 配置。 */
        react.createElement(EmbeddingSettingsModule, { t })
      );
    }

    /* 记忆蒸馏使用模型设置（纯展示组件，两处复用：DSH 设置页 + 记忆管理弹窗的设置 tab）。
       值、草稿、模型列表与保存动作全部由调用方注入 —— 两个宿主各自管理状态，
       但 UI 只有这一份实现，避免两处漂移。

       variant 决定容器与字段的 class：
         'settings' → dsh-session-kit-settings-*（DSH 设置页的卡片）
         'memory'   → dsh-session-kit-memory-*（记忆弹窗的卡片）
       locale 键（memoryDistillSettings 等）都注册在主命名空间 NS，两处都取得到。 */
    function DistillModelSettingsCard({
      t, variant = 'settings',
      current, draft, onDraftChange,
      groups, directoryStatus,
      loading = false, saving = false, notice = '', onSave
    }) {
      const isSettings = variant !== 'memory';
      const rootClass = isSettings ? 'dsh-session-kit-settings-module' : 'dsh-session-kit-memory-distill';
      const titleClass = isSettings ? 'dsh-session-kit-settings-module-title' : 'dsh-session-kit-memory-section-title';
      const descClass = isSettings ? 'dsh-session-kit-settings-module-hint' : 'dsh-session-kit-compaction-desc';
      const currentClass = isSettings ? 'dsh-session-kit-settings-current' : 'dsh-session-kit-memory-settings-current';
      const fieldClass = isSettings ? 'dsh-session-kit-settings-field' : 'dsh-session-kit-global-prompt-field';
      const footClass = isSettings ? 'dsh-session-kit-settings-module-foot' : 'dsh-session-kit-memory-embedding-foot';
      /* 字段标签：设置页用统一的 field-label 小字，弹窗沿用原有 span 样式。 */
      const fieldLabel = (text) => (isSettings
        ? react.createElement('span', { className: 'dsh-session-kit-settings-field-label' }, text)
        : react.createElement('span', null, text));

      const safeGroups = memorySafeArray(groups);
      const modelOptions = [
        { value: '', label: t('memoryFollowingSessionModel') },
        ...safeGroups.flatMap((group) => memorySafeArray(group?.models).map((model) => ({
          value: JSON.stringify({ provider: group.id, model: model.id }),
          label: `${group.name || group.id} / ${model.name || model.id}`
        })))
      ];
      const selectedGroup = safeGroups.find((group) => group.id === draft?.provider);
      const selectedModel = memorySafeArray(selectedGroup?.models).find((model) => model.id === draft?.model);
      const reasoningOptions = selectedModel?.reasoning ? [
        ...(selectedModel.reasoning.defaultEffort === undefined ? [{ value: '', label: t('memoryProviderDefault') }] : []),
        ...memorySafeArray(selectedModel.reasoning.efforts).map((effort) => ({ value: effort.id, label: effort.name || effort.id }))
      ] : [];
      const currentText = current?.provider && current?.model
        ? `${current.provider}/${current.model}${current.reasoningEffort ? ` · ${current.reasoningEffort}` : ''}`
        : t('memoryFollowingSessionModel');
      const selectDisabled = loading || directoryStatus !== 'ready' || safeGroups.length === 0;

      return react.createElement('div', { className: rootClass },
        react.createElement('div', { className: titleClass }, t('memoryDistillSettings')),
        react.createElement('p', { className: descClass }, t('memorySettingsDesc')),
        react.createElement('div', { className: currentClass }, currentText),
        react.createElement('label', { className: fieldClass },
          fieldLabel(t('memoryDistillModel')),
          react.createElement(MemorySelect, {
            value: draft?.provider && draft?.model ? JSON.stringify({ provider: draft.provider, model: draft.model }) : '',
            options: modelOptions,
            disabled: selectDisabled,
            placeholder: directoryStatus === 'loading' ? t('memoryModelLoading') : t('memoryNoModels'),
            ariaLabel: t('memoryDistillModel'),
            searchable: true,
            searchPlaceholder: t('memorySearchModels'),
            onChange: (value) => {
              if (!value) { onDraftChange(null); return; }
              try { onDraftChange(JSON.parse(value)); } catch { onDraftChange(null); }
            }
          })
        ),
        reasoningOptions.length > 0 && react.createElement('label', { className: fieldClass },
          fieldLabel(t('memoryReasoningEffort')),
          react.createElement(MemorySelect, {
            value: draft?.reasoningEffort || selectedModel?.reasoning?.defaultEffort || '',
            options: reasoningOptions,
            disabled: loading,
            placeholder: t('memoryProviderDefault'),
            ariaLabel: t('memoryReasoningEffort'),
            onChange: (value) => onDraftChange(draft ? { ...draft, ...(value ? { reasoningEffort: value } : { reasoningEffort: undefined }) } : draft)
          })
        ),
        react.createElement('div', { className: footClass },
          notice !== '' && react.createElement('span', { role: 'status', className: 'dsh-session-kit-settings-module-status' }, notice),
          react.createElement(primitives.Button, {
            variant: 'outline',
            size: isSettings ? 'sm' : undefined,
            className: isSettings ? undefined : 'dsh-session-kit-memory-settings-save',
            disabled: loading || saving || draft === undefined,
            onClick: () => void onSave?.()
          }, saving ? t('settingsSaving') : t('memorySave'))
        )
      );
    }

    /* 设置页的蒸馏模型设置：自管状态（拉 snapshot 取当前值 + 拉模型目录取可选列表，
       保存走 set-distill-model —— 全局设置，不依赖 sessionId）。
       与记忆弹窗共用 DistillModelSettingsCard，UI 只有一份。 */
    function DistillSettingsModule({ t, resolveModelDirectory }) {
      const [loadState, setLoadState] = react.useState('loading');
      const [current, setCurrent] = react.useState(null);
      const [draft, setDraft] = react.useState(undefined);
      const [directoryState, setDirectoryState] = react.useState({ current: null, groups: [], status: 'idle' });
      const [saving, setSaving] = react.useState(false);
      const [notice, setNotice] = react.useState('');
      const noticeTimer = react.useRef(0);
      react.useEffect(() => () => window.clearTimeout(noticeTimer.current), []);
      const showNotice = (text) => {
        window.clearTimeout(noticeTimer.current);
        setNotice(text);
        noticeTimer.current = window.setTimeout(() => setNotice(''), 3000);
      };

      /* 模型目录：设置页没有会话上下文，由宿主注入的 resolveModelDirectory 自行定位
         （内部按「当前保留在主视图的会话」取 directoryFor）。 */
      const directory = react.useMemo(() => {
        try { return resolveModelDirectory?.(); } catch { return undefined; }
      }, [resolveModelDirectory]);
      react.useEffect(() => {
        const store = directory?.store;
        if (!store) { setDirectoryState({ current: null, groups: [], status: 'idle' }); return undefined; }
        const read = () => setDirectoryState(store.getSnapshot?.() ?? { current: null, groups: [], status: 'idle' });
        read();
        const unsubscribe = store.subscribe?.(read);
        void directory.load?.().catch(() => undefined);
        return typeof unsubscribe === 'function' ? unsubscribe : undefined;
      }, [directory]);

      const load = react.useCallback(async () => {
        try {
          const value = await memoryPostAction('', { action: 'snapshot' });
          const override = value?.distillModelOverride ?? null;
          setCurrent(override);
          setDraft(override);
          setLoadState('ready');
        } catch (reason) {
          setLoadState('failed');
          showNotice(`${t('settingsLoadFailed')}：${reason instanceof Error ? reason.message : String(reason)}`);
        }
      }, [t]);
      react.useEffect(() => { void load(); }, [load]);

      /* 草稿未就绪时用当前值兜底（模型目录到位后 current 可能才有值）。 */
      const effectiveDraft = draft !== undefined ? draft : (current ?? directoryState.current ?? null);

      const save = async () => {
        if (saving) return;
        setSaving(true);
        try {
          await memoryPostAction('', { action: 'set-distill-model', modelSelection: effectiveDraft });
          setCurrent(effectiveDraft);
          setDraft(effectiveDraft);
          showNotice(t('memorySaved'));
        } catch (reason) {
          showNotice(`${t('settingsSaveFailed')}：${reason instanceof Error ? reason.message : String(reason)}`);
        } finally {
          setSaving(false);
        }
      };

      return react.createElement(DistillModelSettingsCard, {
        t,
        current,
        draft: effectiveDraft,
        onDraftChange: setDraft,
        groups: directoryState.groups,
        directoryStatus: loadState === 'loading' ? 'loading' : directoryState.status,
        loading: loadState === 'loading',
        saving,
        notice,
        onSave: save
      });
    }

    /* 记忆召回设置卡片（纯展示，两处复用：DSH 设置页 + 记忆管理弹窗的设置 tab）。
       值、草稿变更、保存动作全部由调用方注入；配额计算走模块级纯函数
       （recallSettingsForMode / recallSettingsForSegment / recallSettingsForMax），
       保证两处算出的配额完全一致。

       variant 决定容器与字段 class：
         'settings' → dsh-session-kit-settings-*（设置页卡片）
         'memory'   → dsh-session-kit-memory-*（弹窗卡片） */
    function RecallSettingsCard({
      t, variant = 'settings',
      settings, onSettingsChange,
      loading = false, saving = false, notice = '', onSave
    }) {
      const isSettings = variant !== 'memory';
      const rootClass = isSettings ? 'dsh-session-kit-settings-module' : 'dsh-session-kit-memory-recall';
      const titleClass = isSettings ? 'dsh-session-kit-settings-module-title' : 'dsh-session-kit-memory-section-title';
      const descClass = isSettings ? 'dsh-session-kit-settings-module-hint' : 'dsh-session-kit-compaction-desc';
      const noteClass = isSettings ? 'dsh-session-kit-settings-module-hint' : 'dsh-session-kit-memory-recall-note';
      const fieldClass = isSettings ? 'dsh-session-kit-settings-field' : 'dsh-session-kit-global-prompt-field';
      const footClass = isSettings ? 'dsh-session-kit-settings-module-foot' : 'dsh-session-kit-memory-embedding-foot';
      const fieldLabel = (text) => (isSettings
        ? react.createElement('span', { className: 'dsh-session-kit-settings-field-label' }, text)
        : react.createElement('span', null, text));

      const current = settings ?? RECALL_SETTINGS_DEFAULT;
      const valid = recallSettingsValid(current);
      const isCustom = current.mode === 'custom';

      /* 滑块：两处共用同一份实现（含刻度点渲染），仅 aria-label 由调用方给。 */
      const slider = (min, max, value, disabled, onChange, ariaLabel) => {
        const numericValue = Math.max(min, Math.min(max, Number(value) || min));
        return react.createElement('div', { className: `dsh-session-kit-memory-recall-slider${disabled ? ' dsh-session-kit-memory-recall-slider-disabled' : ''}` },
          react.createElement('input', {
            className: 'dsh-session-kit-memory-recall-slider-input',
            type: 'range', min, max, step: 1, value: numericValue, disabled,
            'aria-label': ariaLabel, 'aria-valuemin': min, 'aria-valuemax': max, 'aria-valuenow': numericValue,
            onChange
          }),
          react.createElement('div', { className: 'dsh-session-kit-memory-recall-slider-track', 'aria-hidden': 'true' },
            Array.from({ length: max - min + 1 }, (_, index) => {
              const tick = min + index;
              const tickPercent = max === min ? 0 : (index / (max - min)) * 100;
              const state = tick === numericValue ? 'current' : 'upcoming';
              return react.createElement('span', { key: tick, className: `dsh-session-kit-memory-recall-slider-dot dsh-session-kit-memory-recall-slider-dot-${state}`, style: { left: `${tickPercent}%` } },
                state === 'current' ? react.createElement('span', { className: 'dsh-session-kit-memory-recall-slider-dot-inner' }) : null
              );
            })
          )
        );
      };

      const segmentRows = [
        ['segment1', 'memoryRecallSegment1', 3],
        ['segment2', 'memoryRecallSegment2', 0],
        ['segment3', 'memoryRecallSegment3', 0],
        ['segment4', 'memoryRecallSegment4', 0]
      ];

      return react.createElement('div', { className: rootClass },
        react.createElement('div', { className: titleClass }, t('memoryRecallSettings')),
        react.createElement('p', { className: descClass }, t('memoryRecallSettingsDesc')),
        react.createElement('p', { className: noteClass }, t('memoryRecallDedupNote')),
        react.createElement('p', { className: noteClass }, t('memoryRecallOrderNote')),
        react.createElement('p', { className: noteClass }, t('memoryRecallPinnedNote')),
        react.createElement('label', { className: fieldClass },
          fieldLabel(t('memoryRecallMode')),
          react.createElement(MemorySelect, {
            value: current.mode,
            options: [
              { value: 'default', label: t('memoryRecallModeDefault') },
              { value: 'exclude-temporary', label: t('memoryRecallModeExcludeTemporary') },
              { value: 'custom', label: t('memoryRecallModeCustom') }
            ],
            disabled: loading,
            ariaLabel: t('memoryRecallMode'),
            searchable: false,
            onChange: (mode) => onSettingsChange(recallSettingsForMode(mode, current))
          })
        ),
        react.createElement('div', { className: 'dsh-session-kit-memory-recall-field' },
          react.createElement('div', { className: 'dsh-session-kit-memory-recall-field-head' },
            react.createElement('span', null, t('memoryRecallMax')),
            react.createElement('strong', { className: isCustom ? 'dsh-session-kit-memory-recall-custom-value' : undefined }, current.maxItems)),
          isCustom && slider(8, 20, current.maxItems, loading, (event) => onSettingsChange(recallSettingsForMax(current, event.currentTarget.value)), t('memoryRecallMax')),
          isCustom && react.createElement('input', { className: 'dsh-session-kit-memory-recall-number', type: 'number', min: 8, max: 20, step: 1, value: current.maxItems, disabled: loading, onChange: (event) => onSettingsChange(recallSettingsForMax(current, event.currentTarget.value)) })
        ),
        react.createElement('div', { className: 'dsh-session-kit-memory-recall-segments' },
          segmentRows.map(([key, labelKey, min]) => {
            const value = current.segments[key];
            const editable = isCustom && key !== 'segment4';
            return react.createElement('div', { className: 'dsh-session-kit-memory-recall-field dsh-session-kit-memory-recall-segment-field', key },
              react.createElement('div', { className: 'dsh-session-kit-memory-recall-field-head' },
                react.createElement('span', { className: 'dsh-session-kit-memory-recall-label' },
                  react.createElement('span', null, t(labelKey)),
                  react.createElement(primitives.Tooltip, { label: t(`${labelKey}Hint`), side: 'top', delayMs: 300 },
                    react.createElement('span', { className: 'dsh-session-kit-memory-recall-hint-icon', role: 'img', 'aria-label': t(`${labelKey}Hint`), tabIndex: 0 },
                      react.createElement(primitives.IconWarningOutlineRegular, { size: 14 })
                    )
                  )
                ),
                react.createElement('strong', { className: isCustom ? 'dsh-session-kit-memory-recall-custom-value' : undefined }, value)),
              editable && slider(min, 5, value,
                loading,
                (event) => onSettingsChange(recallSettingsForSegment(current, key, event.currentTarget.value)), t(labelKey)),
              key === 'segment4' && react.createElement('small', null, t('memoryRecallSegmentDynamic'))
            );
          })
        ),
        !valid && react.createElement('div', { role: 'alert', className: 'dsh-session-kit-memory-form-error' }, t('memoryRecallInvalid')),
        react.createElement('div', { className: footClass },
          notice !== '' && react.createElement('span', { role: 'status', className: 'dsh-session-kit-settings-module-status' }, notice),
          react.createElement(primitives.Button, {
            variant: 'outline',
            size: isSettings ? 'sm' : undefined,
            className: isSettings ? undefined : 'dsh-session-kit-memory-settings-save',
            disabled: loading || saving || !valid,
            onClick: () => void onSave?.()
          }, saving ? t('settingsSaving') : t('memorySave'))
        )
      );
    }

    /* 设置页的召回设置：自管状态（拉 snapshot 取当前配额，保存走 set-recall-settings）。 */
    function RecallSettingsModule({ t }) {
      const [loadState, setLoadState] = react.useState('loading');
      const [settings, setSettings] = react.useState(null);
      const [saving, setSaving] = react.useState(false);
      const [notice, setNotice] = react.useState('');
      const noticeTimer = react.useRef(0);
      react.useEffect(() => () => window.clearTimeout(noticeTimer.current), []);
      const showNotice = (text) => {
        window.clearTimeout(noticeTimer.current);
        setNotice(text);
        noticeTimer.current = window.setTimeout(() => setNotice(''), 3000);
      };

      const load = react.useCallback(async () => {
        try {
          const value = await memoryPostAction('', { action: 'snapshot' });
          setSettings(value?.recallSettings ?? RECALL_SETTINGS_DEFAULT);
          setLoadState('ready');
        } catch (reason) {
          setLoadState('failed');
          showNotice(`${t('settingsLoadFailed')}：${reason instanceof Error ? reason.message : String(reason)}`);
        }
      }, [t]);
      react.useEffect(() => { void load(); }, [load]);

      const save = async () => {
        if (saving) return;
        setSaving(true);
        try {
          await memoryPostAction('', { action: 'set-recall-settings', recallSettings: settings });
          showNotice(t('memorySaved'));
        } catch (reason) {
          showNotice(`${t('settingsSaveFailed')}：${reason instanceof Error ? reason.message : String(reason)}`);
        } finally {
          setSaving(false);
        }
      };

      return react.createElement(RecallSettingsCard, {
        t,
        settings,
        onSettingsChange: setSettings,
        loading: loadState === 'loading',
        saving,
        notice,
        onSave: save
      });
    }

    /* 记忆保存目录设置卡片（纯展示，两处复用：DSH 设置页 + 记忆管理弹窗的设置 tab）。
       与前两块不同，它走【独立路由】MEMORY_STORAGE_ROUTE（记忆库可迁出 memory.sqlite 之外），
       因此数据加载与保存由调用方注入（fetchStorage / onSave），卡片只负责渲染与交互。

       variant 决定容器与字段 class：
         'settings' → dsh-session-kit-settings-*（设置页卡片）
         'memory'   → dsh-session-kit-memory-*（弹窗卡片） */
    function StorageSettingsCard({
      t, variant = 'settings',
      value, draft, onDraftChange,
      notice = null, error = null,
      loading = false, saving = false, picking = false,
      onPick, onSave
    }) {
      const isSettings = variant !== 'memory';
      const rootClass = isSettings ? 'dsh-session-kit-settings-module' : 'dsh-session-kit-memory-storage';
      const titleClass = isSettings ? 'dsh-session-kit-settings-module-title' : 'dsh-session-kit-memory-section-title';
      const descClass = isSettings ? 'dsh-session-kit-settings-module-hint' : 'dsh-session-kit-compaction-desc';
      const currentClass = isSettings ? 'dsh-session-kit-settings-current' : 'dsh-session-kit-memory-settings-current';
      const fieldClass = isSettings ? 'dsh-session-kit-settings-field' : 'dsh-session-kit-global-prompt-field';
      const footClass = isSettings ? 'dsh-session-kit-settings-module-foot' : 'dsh-session-kit-memory-embedding-foot';
      const fieldLabel = (text) => (isSettings
        ? react.createElement('span', { className: 'dsh-session-kit-settings-field-label' }, text)
        : react.createElement('span', null, text));
      const busy = loading || saving || picking;
      const mode = draft?.mode === 'custom' ? 'custom' : 'default';

      return react.createElement('div', { className: rootClass },
        react.createElement('div', { className: titleClass }, t('memoryStorageTitle')),
        react.createElement('p', { className: descClass }, t('memoryStorageDesc')),
        react.createElement('div', { className: 'dsh-session-kit-memory-storage-field' },
          react.createElement('label', { className: fieldClass },
            fieldLabel(t('memoryStorageMode')),
            react.createElement(MemorySelect, {
              value: mode,
              options: [
                { value: 'default', label: t('memoryStorageModeDefault') },
                { value: 'custom', label: t('memoryStorageModeCustom') }
              ],
              disabled: busy,
              ariaLabel: t('memoryStorageMode'),
              searchable: false,
              onChange: (next) => onDraftChange({ ...draft, mode: next === 'custom' ? 'custom' : 'default' })
            })
          ),
          mode === 'default'
            ? react.createElement('div', { className: currentClass }, `${t('memoryStorageDefaultHint')}${value?.defaultPath ? ` · ${value.defaultPath}` : ''}`)
            : react.createElement('div', { className: 'dsh-session-kit-memory-storage-path' },
                react.createElement('input', {
                  className: 'dsh-session-kit-rename-input dsh-session-kit-memory-storage-input',
                  value: String(draft?.customPath ?? ''),
                  disabled: busy,
                  placeholder: t('memoryStorageCustomPlaceholder'),
                  'aria-label': t('memoryStorageCustomPath'),
                  onChange: (event) => onDraftChange({ ...draft, customPath: event.currentTarget.value })
                }),
                react.createElement(primitives.Button, {
                  variant: 'outline',
                  className: 'dsh-session-kit-memory-storage-pick',
                  disabled: busy,
                  onClick: () => void onPick?.()
                }, t(picking ? 'memoryStoragePicking' : 'memoryStoragePick'))
              ),
          value?.activePath && react.createElement('div', { className: 'dsh-session-kit-memory-muted dsh-session-kit-memory-storage-active' }, `${t('memoryStorageCurrent')}：${value.activePath}`)
        ),
        notice && react.createElement('div', { role: 'status', className: 'dsh-session-kit-compaction-success' }, notice),
        error && react.createElement('div', { role: 'alert', className: 'dsh-session-kit-memory-form-error' }, error),
        react.createElement('div', { className: footClass },
          react.createElement(primitives.Button, {
            variant: 'outline',
            size: isSettings ? 'sm' : undefined,
            className: isSettings ? undefined : 'dsh-session-kit-memory-settings-save',
            disabled: busy,
            onClick: () => void onSave?.()
          }, t('memorySave'))
        )
      );
    }

    /* 设置页的保存目录：自管状态（走 MEMORY_STORAGE_ROUTE 独立路由）。
       目录选择器由宿主注入（设置页组件拿不到 ctx，无法直接取 uiWorkspace.pickDirectory）。 */
    function StorageSettingsModule({ t, pickDirectory }) {
      const [value, setValue] = react.useState(null);
      const [draft, setDraft] = react.useState({ mode: 'default', customPath: '' });
      const [notice, setNotice] = react.useState(null);
      const [error, setError] = react.useState(null);
      const [picking, setPicking] = react.useState(false);
      const [saving, setSaving] = react.useState(false);
      const [loading, setLoading] = react.useState(true);

      const load = react.useCallback(async () => {
        try {
          const next = await MemoryStorageClient.load(t);
          setValue(next);
          setDraft(MemoryStorageClient.draftFrom(next));
          setError(null);
        } catch (reason) {
          setError(`${t('memoryStorageFailed')}: ${memoryErrorMessage(t, reason)}`);
        } finally {
          setLoading(false);
        }
      }, [t]);
      react.useEffect(() => { void load(); }, [load]);

      const pick = async () => {
        if (picking || saving) return;
        setPicking(true);
        setError(null);
        setNotice(null);
        try {
          const picked = await pickAnyDirectory(pickDirectory);
          if (typeof picked === 'string' && picked.length > 0) setDraft({ mode: 'custom', customPath: picked });
        } catch (reason) {
          /* 无可用选择器 → 引导手填，而非报"保存失败"。 */
          setError(MemoryStorageClient.isNoPicker(reason)
            ? t('memoryStorageNoPicker')
            : `${t('memoryStorageFailed')}: ${memoryErrorMessage(t, reason)}`);
        } finally {
          setPicking(false);
        }
      };

      const save = async () => {
        if (saving || picking) return;
        const customPath = String(draft.customPath || '').trim();
        if (draft.mode === 'custom' && customPath.length === 0) {
          setError(t('memoryStoragePathNotAbsolute'));
          return;
        }
        setSaving(true);
        setError(null);
        setNotice(null);
        try {
          const next = await MemoryStorageClient.save(t, { mode: draft.mode, customPath });
          setValue(next);
          setDraft(MemoryStorageClient.draftFrom(next));
          setNotice(next.restartRequired === true ? t('memoryStorageRestart') : t('memoryStorageNoRestart'));
        } catch (reason) {
          setError(`${t('memoryStorageFailed')}: ${reason instanceof Error ? reason.message : String(reason)}`);
        } finally {
          setSaving(false);
        }
      };

      return react.createElement(StorageSettingsCard, {
        t,
        value,
        draft,
        onDraftChange: (next) => { setNotice(null); setError(null); setDraft(next); },
        notice,
        error,
        loading,
        saving,
        picking,
        onPick: pick,
        onSave: save
      });
    }

    /* Embedding 语义检索设置（两处复用：DSH 设置页 + 记忆管理弹窗的设置 tab）。
       只暴露「开关 + 连接配置」两项 —— 模型指纹、回填游标、降级状态都是宿主端
       内部状态（照 ftsTokenizerVersion 的先例，不上 UI）。
       apiKey 以掩码回显；保存时回传掩码即表示"不改 key"（宿主端识别并保留原值）。

       variant 决定外层容器 class（两处上下文的卡片样式不同）：
         'settings' → dsh-session-kit-settings-module（设置页自带边框卡片）
         'memory'   → dsh-session-kit-memory-distill（记忆弹窗的卡片外观）
       其余（locale 键、字段、保存逻辑）完全共用。locale 键都在主命名空间 NS，
       而记忆弹窗的 t 是 sessionMemoryText（非 view. 前缀回退主 NS），故两边都取得到。 */
    function EmbeddingSettingsModule({ t, variant = 'settings', onSaved }) {
      const rootClass = variant === 'memory'
        ? 'dsh-session-kit-memory-embedding'
        : 'dsh-session-kit-settings-module';
      const titleClass = variant === 'memory'
        ? 'dsh-session-kit-memory-section-title'
        : 'dsh-session-kit-settings-module-title';
      const hintClass = variant === 'memory'
        ? 'dsh-session-kit-memory-muted'
        : 'dsh-session-kit-settings-module-hint';
      const [loadState, setLoadState] = react.useState('loading');   // loading | ready | failed
      const [enabled, setEnabled] = react.useState(false);
      const [kind, setKind] = react.useState('remote');              // remote | local
      /* 两种接入方式的输入各自成桶、按 kind 分开保存。
         原先 baseUrl/apiKey/model/dimensions 是共享 state：从「网络 API」切到「本地模型」
         会把另一侧的模型名带过去（而两边 model 语义完全不同——一个是远端模型 ID，
         一个是本地路径/ONNX 仓库 ID），用户被迫重填。现在切换只换"读哪一桶"，互不覆盖。 */
      const [kindFields, setKindFields] = react.useState(() => ({
        remote: { baseUrl: '', apiKey: '', apiKeyMask: '', model: '', dimensions: '' },
        local: { model: '', dimensions: '' }
      }));
      const fields = kindFields[kind] ?? {};
      const patchFields = (patch) => setKindFields((current) => ({
        ...current,
        [kind]: { ...(current[kind] ?? {}), ...patch }
      }));
      /* 以下别名让 save/runTest/渲染保持原样可读：读到的始终是"当前选中那桶"的值。 */
      const baseUrl = fields.baseUrl ?? '';
      const apiKey = fields.apiKey ?? '';
      const apiKeyMask = fields.apiKeyMask ?? '';
      const model = fields.model ?? '';
      const dimensions = fields.dimensions ?? '';
      const [stats, setStats] = react.useState(null);
      const [saving, setSaving] = react.useState(false);
      /* 连通测试：独立于 saving 的忙碌态（测的是"候选配置"，不落库）。 */
      const [testing, setTesting] = react.useState(false);
      const [testResult, setTestResult] = react.useState(null);   // { ok, ... } | null
      const [notice, setNotice] = react.useState('');
      const noticeTimer = react.useRef(0);
      /* 连通结果自动消失：成功 6 秒（够看清维度/耗时），失败 12 秒
         （失败信息更长、且常需要照着 hint 去改配置，留久一点）。
         与 notice 用独立定时器，避免两者互相清掉对方的计时。 */
      const testResultTimer = react.useRef(0);
      react.useEffect(() => () => {
        window.clearTimeout(noticeTimer.current);
        window.clearTimeout(testResultTimer.current);
      }, []);

      const showNotice = (text) => {
        window.clearTimeout(noticeTimer.current);
        setNotice(text);
        noticeTimer.current = window.setTimeout(() => setNotice(''), 3000);
      };

      /* 展示连通结果并安排自动消失。传 null 表示立即清除（如再次点击测试时）。 */
      const showTestResult = (result) => {
        window.clearTimeout(testResultTimer.current);
        setTestResult(result);
        if (result === null) return;
        const ttl = result.ok === true ? 6000 : 12000;
        testResultTimer.current = window.setTimeout(() => setTestResult(null), ttl);
      };

      /* 拉取当前配置（走 snapshot 的 embedding 字段）。 */
      const load = react.useCallback(async () => {
        try {
          const value = await memoryPostAction('', { action: 'snapshot' });
          const info = value?.embedding ?? {};
          setEnabled(info.enabled === true);
          setStats(info);
          /* 双槽回填：两侧各取各的已保存配置（providerSlots.remote/local），
             生效侧决定初始选中的 tab。这样"保存远程 → 重启 → 本地 tab 仍能取回本地配置"。
             另保留旧字段 info.provider 的回填作为兼容（宿主未带 providerSlots 时）。 */
          const slots = info.providerSlots ?? null;
          if (slots !== null && typeof slots === 'object') {
            setKind(slots.active === 'local' ? 'local' : 'remote');
            setKindFields((current) => ({
              remote: {
                ...(current.remote ?? {}),
                ...(slots.remote ? {
                  baseUrl: String(slots.remote.baseUrl ?? ''),
                  model: String(slots.remote.model ?? ''),
                  dimensions: slots.remote.dimensions ? String(slots.remote.dimensions) : '',
                  apiKeyMask: String(slots.remote.apiKeyMask ?? '')
                } : {})
              },
              local: {
                ...(current.local ?? {}),
                ...(slots.local ? {
                  model: String(slots.local.model ?? ''),
                  dimensions: slots.local.dimensions ? String(slots.local.dimensions) : ''
                } : {})
              }
            }));
          } else {
            const provider = info.provider ?? null;
            if (provider !== null) {
              const nextKind = provider.kind === 'local' ? 'local' : 'remote';
              setKind(nextKind);
              /* 落库的 provider 只回填【它自己那一桶】，不动另一桶 ——
                 否则用户在本地模式填到一半、保存远端配置后，本地那桶会被清掉。 */
              setKindFields((current) => ({
                ...current,
                [nextKind]: nextKind === 'local'
                  ? {
                    ...(current.local ?? {}),
                    model: String(provider.model ?? ''),
                    dimensions: provider.dimensions ? String(provider.dimensions) : ''
                  }
                  : {
                    ...(current.remote ?? {}),
                    baseUrl: String(provider.baseUrl ?? ''),
                    model: String(provider.model ?? ''),
                    dimensions: provider.dimensions ? String(provider.dimensions) : '',
                    apiKeyMask: String(provider.apiKeyMask ?? '')
                  }
              }));
            }
          }
          setLoadState('ready');
        } catch (reason) {
          setLoadState('failed');
          showNotice(`${t('settingsLoadFailed')}：${reason instanceof Error ? reason.message : String(reason)}`);
        }
      }, [t]);
      react.useEffect(() => { void load(); }, [load]);

      const save = async () => {
        if (saving) return;
        setSaving(true);
        try {
          const provider = kind === 'local'
            ? { kind: 'local', model: model.trim(), device: 'cpu', dimensions: Number(dimensions) || 0 }
            /* apiKey 留空表示不改（回传掩码给宿主端识别）；填了才覆盖。 */
            : { kind: 'remote', baseUrl: baseUrl.trim(), model: model.trim(), dimensions: Number(dimensions) || 0, apiKey: apiKey === '' ? apiKeyMask : apiKey };
          const value = await memoryPostAction('', { action: 'set-embedding', enabled, provider });
          setStats(value?.stats ?? null);
          /* 保存成功后只清当前桶的明文 key，并回填掩码；另一桶不动。 */
          if (apiKey !== '') patchFields({ apiKey: '', apiKeyMask: String(value?.stats?.apiKeyMask ?? '') });
          showNotice(t('settingsSaved'));
          await load();
          /* 通知宿主（记忆弹窗/settings 页）重拉 snapshot：顶部「检索」说明行的
             开关状态/维度/覆盖数来自弹窗自己的 snapshot，组件内部刷新够不到它。 */
          if (typeof onSaved === 'function') {
            try {
              void onSaved(value?.stats ?? null);
            } catch (error) {
              /* 通知失败不影响保存本身的成功语义 */
            }
          }
        } catch (reason) {
          showNotice(`${t('settingsSaveFailed')}：${reason instanceof Error ? reason.message : String(reason)}`);
        } finally {
          setSaving(false);
        }
      };

      /* 连通测试：把【当前表单里的候选配置】发给宿主端真跑一次请求。
         不落库、不改已保存的配置（宿主端用临时 embedder，跑完即释放）。
         好处：可以"先测通再保存"，避免存了错 key 才发现。 */
      const runTest = async () => {
        if (testing || saving) return;
        setTesting(true);
        showTestResult(null);   // 立即清掉上一次结果（含它的定时器），避免旧结论残留
        try {
          const provider = kind === 'local'
            ? { kind: 'local', model: model.trim(), device: 'cpu', dimensions: Number(dimensions) || 0 }
            /* apiKey 留空时回传掩码，宿主端会沿用已保存的 key（与保存同规则）。 */
            : { kind: 'remote', baseUrl: baseUrl.trim(), model: model.trim(), dimensions: Number(dimensions) || 0, apiKey: apiKey === '' ? apiKeyMask : apiKey };
          const value = await memoryPostAction('', { action: 'test-embedding', provider });
          const result = value ?? { ok: false, message: t('settingsEmbeddingTestFailed') };
          showTestResult(result);
          /* 连通成功 → 把【实测维度】自动回填进输入框：
             服务商若忽略 dimensions 参数，实测值才是权威（指纹用它才不会错位）；
             用户手填值与实测一致时不动（保留"明确声明"的语义）。 */
          if (result.ok === true && Number.isSafeInteger(result.dimensions) && result.dimensions > 0) {
            const actual = String(result.dimensions);
            if (dimensions !== actual) patchFields({ dimensions: actual });
          }
        } catch (reason) {
          showTestResult({ ok: false, message: reason instanceof Error ? reason.message : String(reason) });
        } finally {
          setTesting(false);
        }
      };

      if (loadState === 'loading') {
        return react.createElement('div', { className: rootClass },
          react.createElement('div', { className: titleClass }, t('settingsModuleEmbeddingTitle')),
          react.createElement('div', { className: hintClass }, t('settingsEmbeddingLoading'))
        );
      }

      /* 字段输入框。onChange 统一包一层：任何配置改动都清掉上一次的连通结论——
         否则用户改了地址后，界面上还挂着"上一次地址"的成功提示，会误导。 */
      const field = (label, value, onChange, placeholder, type) => react.createElement('label', {
        className: 'dsh-session-kit-settings-field'
      },
        react.createElement('span', { className: 'dsh-session-kit-settings-field-label' }, label),
        react.createElement('input', {
          className: 'dsh-session-kit-settings-field-input',
          type: type ?? 'text',
          value,
          placeholder: placeholder ?? '',
          onChange: (event) => {
            showTestResult(null);
            onChange(event.target.value);
          }
        })
      );

      const statusLine = stats === null ? ''
        : stats.backfilling
          ? t('settingsEmbeddingBackfilling').replace('{done}', String(stats.backfillProgress?.done ?? 0))
          : stats.enabled
            ? t('settingsEmbeddingStatus').replace('{embedded}', String(stats.embedded ?? 0)).replace('{total}', String(stats.total ?? 0))
            : t('settingsEmbeddingOff');

      /* 左下角「现用模式」徽标：显示【已保存并生效】的接入方式，形如「现用模式：网络 API」，
         绿色 + 边框的小标签。
         数据源取 stats.provider（宿主端回传的落库 provider），因此：
           - 表单改了还没保存 → 徽标不变（与"现用"语义一致，避免误导）
           - 未开启 / 无 provider → 不渲染（返回空串，由渲染处跳过） */
      const currentModeLabel = (() => {
        if (stats === null || stats.enabled !== true) return '';
        const provider = stats.provider;
        if (provider === null || provider === undefined) return '';
        const mode = provider.kind === 'local' ? t('settingsEmbeddingKindLocal') : t('settingsEmbeddingKindRemote');
        return t('settingsEmbeddingCurrent').replace('{mode}', mode);
      })();

      return react.createElement('div', { className: rootClass },
        react.createElement('div', { className: titleClass }, t('settingsModuleEmbeddingTitle')),
        react.createElement('button', {
          type: 'button',
          className: 'dsh-session-kit-settings-row',
          'aria-pressed': enabled,
          onClick: () => setEnabled((value) => !value)
        },
          react.createElement('span', { className: 'dsh-session-kit-settings-row-label' }, t('settingsEmbeddingToggle')),
          renderToggleSwitch(enabled)
        ),
        react.createElement('div', { className: hintClass }, t('settingsEmbeddingHint')),
        /* 开启后才展开配置项，避免空输入框阵列。 */
        enabled && react.createElement('div', { className: 'dsh-session-kit-settings-fields' },
          react.createElement('div', { className: 'dsh-session-kit-settings-kind', role: 'radiogroup', 'aria-label': t('settingsModuleEmbeddingTitle') },
            ['remote', 'local'].map((option) => react.createElement('button', {
              key: option,
              type: 'button',
              role: 'radio',
              'aria-checked': kind === option,
              className: `dsh-session-kit-settings-kind-item${kind === option ? ' is-active' : ''}`,
              onClick: () => { showTestResult(null); setKind(option); }
            },
              /* 选中态在左侧显示打勾：原先只有边框变色，扫视时不够醒目。 */
              react.createElement('span', {
                className: 'dsh-session-kit-settings-kind-check',
                'aria-hidden': 'true'
              }, kind === option ? react.createElement(primitives.IconCheckOutlineRegular, { size: 14 }) : null),
              react.createElement('span', { className: 'dsh-session-kit-settings-kind-label' },
                option === 'remote' ? t('settingsEmbeddingKindRemote') : t('settingsEmbeddingKindLocal'))))
          ),
          kind === 'remote' && field(t('settingsEmbeddingBaseUrl'), baseUrl, (v) => patchFields({ baseUrl: v }), 'https://api.example.com/v1'),
          kind === 'remote' && field(t('settingsEmbeddingApiKey'), apiKey, (v) => patchFields({ apiKey: v }), apiKeyMask !== '' ? apiKeyMask : 'sk-...', 'password'),
          kind === 'local' && field(t('settingsEmbeddingModelPath'), model, (v) => patchFields({ model: v }), 'Xenova/bge-small-zh-v1.5'),
          kind === 'remote' && field(t('settingsEmbeddingModel'), model, (v) => patchFields({ model: v }), 'text-embedding-v4'),
          field(t('settingsEmbeddingDimensions'), dimensions, (v) => patchFields({ dimensions: v }), '1024', 'number')
        ),
        /* 连通测试结果：成功显示维度/耗时/抽样，失败显示原因 + 排查方向。
           放在字段区下方、状态行上方，与「保存」按钮同一视觉层级。 */
        enabled && testResult !== null && react.createElement('div', {
          role: testResult.ok === true ? 'status' : 'alert',
          className: `dsh-session-kit-settings-embedding-test${testResult.ok === true ? ' is-ok' : ' is-fail'}`
        },
          react.createElement('div', { className: 'dsh-session-kit-settings-embedding-test-title' },
            testResult.ok === true ? t('settingsEmbeddingTestOk') : t('settingsEmbeddingTestFailed')),
          testResult.ok === true
            ? react.createElement('div', { className: 'dsh-session-kit-settings-embedding-test-detail' },
                t('settingsEmbeddingTestOkDetail')
                  .replace('{dims}', String(testResult.dimensions ?? '?'))
                  .replace('{ms}', String(testResult.latencyMs ?? '?'))
                  .replace('{sample}', Array.isArray(testResult.sample) ? testResult.sample.join(', ') : '-'))
            : react.createElement('div', { className: 'dsh-session-kit-settings-embedding-test-detail' },
                String(testResult.message ?? ''),
                testResult.hint ? react.createElement('div', { className: 'dsh-session-kit-settings-embedding-test-hint' }, String(testResult.hint)) : null)
        ),
        statusLine !== '' && react.createElement('div', { className: hintClass }, statusLine),
        react.createElement('div', { className: variant === 'memory' ? 'dsh-session-kit-memory-embedding-foot' : 'dsh-session-kit-settings-module-foot' },
          /* 左下角：当前【已保存并生效】的接入方式徽标（绿色 + 边框的小标签）。
             未开启或无 provider 时 currentModeLabel 为空串 → 整个标签不渲染。
             徽标文案已含「现用模式：」前缀，故 title 复用同一文案、不再另加前缀。 */
          currentModeLabel !== '' && react.createElement('span', {
            className: 'dsh-session-kit-settings-mode-badge',
            title: currentModeLabel
          }, currentModeLabel),
          notice !== '' && react.createElement('span', { role: 'status', className: 'dsh-session-kit-settings-module-status' }, notice),
          /* 连通测试按钮：仅在开启且有可测配置时可用。 */
          enabled && react.createElement(primitives.Button, {
            variant: 'outline',
            size: 'sm',
            disabled: testing || saving,
            onClick: () => void runTest()
          }, testing ? t('settingsEmbeddingTesting') : t('settingsEmbeddingTest')),
          react.createElement(primitives.Button, {
            variant: 'outline',
            size: 'sm',
            disabled: saving,
            onClick: () => void save()
          }, saving ? t('settingsEmbeddingSaving') : t('settingsEmbeddingSave'))
        )
      );
    }

    /* 设置 › session-kit › 记忆tab显示设置。
       写入走既有的 sidebar-entries 通道（与导航开关同一份持久化配置），
       仅提交自己这一项，其余字段沿用当前值以免覆盖。 */
    function SessionMemoryTabSettingsModule({ t, updateSidebarEntries }) {
      const sidebarEntries = useSidebarEntries();
      const [enabled, setEnabled] = react.useState(sidebarEntries.memoryTabVisible !== false);
      const [saving, setSaving] = react.useState(false);
      const [notice, setNotice] = react.useState('');
      const noticeTimer = react.useRef(0);
      react.useEffect(() => () => window.clearTimeout(noticeTimer.current), []);
      /* 外部值变化（其它入口改动或首次拉取到位）时同步草稿，避免停留在陈旧状态。 */
      react.useEffect(() => {
        setEnabled(sidebarEntries.memoryTabVisible !== false);
      }, [sidebarEntries.memoryTabVisible]);
      const showNotice = (text) => {
        window.clearTimeout(noticeTimer.current);
        setNotice(text);
        noticeTimer.current = window.setTimeout(() => setNotice(''), 2000);
      };
      const current = sidebarEntries.memoryTabVisible !== false;
      const dirty = enabled !== current;
      const save = async () => {
        if (saving || !dirty) return;
        setSaving(true);
        try {
          await updateSidebarEntries?.({ ...sidebarEntries, memoryTabVisible: enabled });
          showNotice(t('settingsSaved'));
        } catch (reason) {
          showNotice(`${t('settingsSaveFailed')}：${reason instanceof Error ? reason.message : String(reason)}`);
        } finally {
          setSaving(false);
        }
      };
      return react.createElement('div', { className: 'dsh-session-kit-settings-module' },
        react.createElement('div', { className: 'dsh-session-kit-settings-module-title' }, t('settingsModuleMemoryTabTitle')),
        react.createElement('button', {
          type: 'button',
          className: 'dsh-session-kit-settings-row',
          'aria-pressed': enabled,
          onClick: () => setEnabled((value) => !value)
        },
          react.createElement('span', { className: 'dsh-session-kit-settings-row-label' }, t('settingsMemoryTabToggle')),
          renderToggleSwitch(enabled)
        ),
        react.createElement('div', { className: 'dsh-session-kit-settings-module-hint' }, t('settingsMemoryTabHint')),
        react.createElement('div', { className: 'dsh-session-kit-settings-module-foot' },
          notice !== '' && react.createElement('span', { role: 'status', className: 'dsh-session-kit-settings-module-status' }, notice),
          react.createElement(primitives.Button, {
            variant: 'outline',
            size: 'sm',
            disabled: saving || !dirty,
            onClick: () => void save()
          }, saving ? t('settingsSaving') : t('settingsSave'))
        )
      );
    }

    function SessionManagerButton({ sessionId: sessionIdProp, useSession, t, exporter, openSession, refreshWorkspaces, refreshSessions, archiveCurrentSession, forkCurrentSession, renameCurrentSession, getSessionTitle, getSessionTitleMap, getCurrentUserMessage, getModelSelection, getModelDirectory, updateSidebarEntries }) {
      const state = useSession((value) => value);
      const sessionId = sessionIdProp || state?.sessionId || '';
      const running = state?.running === true;
      const [open, setOpen] = react.useState(false);
      const [busy, setBusy] = react.useState(false);
      const [error, setError] = react.useState(null);
      const [confirmOpen, setConfirmOpen] = react.useState(false);
      const [archiveOpen, setArchiveOpen] = react.useState(false);
      const [globalPromptOpen, setGlobalPromptOpen] = react.useState(false);
      const [memoryOpen, setMemoryOpen] = react.useState(false);
      const [tasksOpen, setTasksOpen] = react.useState(false);
      const [compactionOpen, setCompactionOpen] = react.useState(false);
      const [repairOpen, setRepairOpen] = react.useState(false);
      const [repairBusy, setRepairBusy] = react.useState(false);
      const [repairResult, setRepairResult] = react.useState(null);
      const [repairError, setRepairError] = react.useState(null);
      const [renameOpen, setRenameOpen] = react.useState(false);
      const [renameTargetId, setRenameTargetId] = react.useState(sessionId || '');
      const [renameDraft, setRenameDraft] = react.useState('');
      const [renameError, setRenameError] = react.useState(null);
      const [statsOpen, setStatsOpen] = react.useState(false);
      const [statsLoading, setStatsLoading] = react.useState(false);
      const [statsData, setStatsData] = react.useState(null);
      const [statsError, setStatsError] = react.useState(null);
      react.useEffect(() => {
        const root = document.documentElement;
        if (open) root.dataset.dshSessionKitMenuOpen = 'true';
        else if (root.dataset.dshSessionKitMenuOpen === 'true') delete root.dataset.dshSessionKitMenuOpen;
        return () => {
          if (root.dataset.dshSessionKitMenuOpen === 'true') delete root.dataset.dshSessionKitMenuOpen;
        };
      }, [open]);
      const anchor = react.createElement(
        'span',
        { className: 'dsh-session-kit-menu-anchor', onPointerEnter: () => setOpen(true) },
        react.createElement(
          primitives.Button,
          {
            variant: 'outline',
            size: 'sm',
            onClick: () => setOpen(true),
            onFocus: () => setOpen(true),
            'aria-haspopup': 'menu',
            'aria-expanded': open
          },
          t('manage'),
          react.createElement('span', { className: `dsh-session-kit-menu-chevron${open ? ' dsh-session-kit-menu-chevron-open' : ''}`, 'aria-hidden': 'true' }, react.createElement(primitives.IconChevronDownOutlineRegular, { size: 14 }))
        )
      );
      const unavailable = running || busy;
      const run = async (route) => {
        if (unavailable || !sessionId) return;
        setBusy(true);
        setError(null);
        try {
          await request(route, sessionId);
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
          setBusy(false);
        }
      };
      const loadStats = async () => {
        if (busy || !sessionId) return;
        setStatsOpen(true);
        setStatsLoading(true);
        setStatsError(null);
        setStatsData(null);
        try {
          const value = await archiveRequest(TOOL_STATS_ROUTE, { sessionId });
          setStatsData(value);
        } catch (reason) {
          setStatsError(reason instanceof Error ? reason.message : String(reason));
        } finally {
          setStatsLoading(false);
        }
      };
      const archiveSession = async () => {
        if (unavailable || !sessionId || typeof archiveCurrentSession !== 'function') return;
        setBusy(true);
        setError(null);
        try {
          await archiveCurrentSession(sessionId);
          await Promise.all([refreshWorkspaces, refreshSessions]
            .filter((fn) => typeof fn === 'function')
            .map((fn) => Promise.resolve().then(() => fn()).catch(() => undefined)));
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : String(reason);
          setError(`${t('archiveSessionFailed')}: ${message}`);
        } finally {
          setBusy(false);
        }
      };
      const forkSession = async () => {
        if (busy || !sessionId || typeof forkCurrentSession !== 'function') return;
        setBusy(true);
        setError(null);
        try {
          const childId = await forkCurrentSession(sessionId);
          if (childId !== undefined) openSession?.(childId);
        } catch (reason) {
          const code = reason?.rpcError?.code || (reason instanceof Error ? reason.message : String(reason));
          const friendly = code === 'fork-unavailable' ? t('forkUnavailable') : code;
          setError(`${t('forkSessionFailed')}: ${friendly}`);
        } finally {
          setBusy(false);
        }
      };
      const openRename = (targetId = sessionId) => {
        if (busy || !targetId || typeof renameCurrentSession !== 'function') return;
        setRenameTargetId(targetId);
        setRenameDraft(getSessionTitle?.(targetId) ?? '');
        setRenameError(null);
        setRenameOpen(true);
      };
      const closeRename = () => {
        if (busy) return;
        setRenameOpen(false);
        setRenameError(null);
      };
      const confirmRename = async () => {
        const title = renameDraft.trim();
        const targetId = renameTargetId || sessionId;
        if (busy || !targetId || title === '' || typeof renameCurrentSession !== 'function') {
          if (title === '') setRenameError(t('renameEmpty'));
          return;
        }
        setBusy(true);
        setError(null);
        setRenameError(null);
        try {
          await renameCurrentSession(targetId, title);
          setRenameOpen(false);
          await refreshSessions?.();
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : String(reason);
          setRenameError(`${t('renameSessionFailed')}: ${message}`);
        } finally {
          setBusy(false);
        }
      };
      const openRepair = () => {
        if (!sessionId) {
          setError(t('repairSessionUnavailable'));
          return;
        }
        setRepairResult(null);
        setRepairError(null);
        setRepairOpen(true);
      };
      const runRepair = async () => {
        if (repairBusy) return;
        if (running) {
          setRepairError(t('repairSessionRunning'));
          return;
        }
        setRepairBusy(true);
        setRepairError(null);
        try {
          const value = await archiveRequest(REPAIR_SESSION_ROUTE, { sessionId });
          setRepairResult(value ?? {});
          /* 修复成功且验证可加载时，自动重载界面以重新加载该会话：
             已打开会话的绑定缓存着失败状态，重开不会重读磁盘。
             优先触发桌面壳的官方重载路由（POST /api/desktop/developer/reload，
             即「重新加载界面」按钮的通道），失败时降级为普通整页刷新。
             延迟 3s 让用户先看清修复结果。 */
          if (value?.changed === true && value?.loadableAfter !== false) {
            setRepairError(null);
            setTimeout(() => {
              fetch(DESKTOP_RELOAD_ROUTE, { method: 'POST', credentials: 'same-origin' })
                .then((response) => {
                  if (response.ok) return undefined;      // 壳层即将重载渲染进程
                  window.location.reload();               // 壳层不可用：普通刷新
                  return undefined;
                })
                .catch(() => { window.location.reload(); });
            }, 3000);
          } else if (value?.changed === true) {
            setRepairError(t('repairSessionStillUnloadable'));
          }
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : String(reason);
          const friendlyMessage = message === 'SESSION_LIVE'
            ? t('repairSessionLive')
            : message === 'SESSION_RUNNING'
              ? t('repairSessionRunning')
              : `${t('repairSessionFailed')}: ${message}`;
          setRepairError(friendlyMessage);
        } finally {
          setRepairBusy(false);
        }
      };
      const select = (id) => {
        setOpen(false);
        if (id === 'archive') {
          if (!busy) setArchiveOpen(true);
          return;
        }
        if (id === 'global-prompt') {
          if (!busy) setGlobalPromptOpen(true);
          return;
        }
        if (id === 'memory') {
          if (!busy) setMemoryOpen(true);
          return;
        }
        if (id === 'tasks') {
          if (!busy) setTasksOpen(true);
          return;
        }
        if (id === 'compaction-config') {
          if (!busy) setCompactionOpen(true);
          return;
        }
        if (id === 'repair-session') {
          if (!busy) openRepair();
          return;
        }
        if (id === 'stats') {
          if (!busy && sessionId) void loadStats();
          return;
        }
        if (id === 'archive-session') {
          void archiveSession();
          return;
        }
        if (id === 'fork-session') {
          void forkSession();
          return;
        }
        if (id === 'rename-session') {
          openRename();
          return;
        }
        if (unavailable) return;
        if (id === 'folder') void run(OPEN_ROUTE);
        else if (id === 'export') {
          if (typeof exporter?.download !== 'function') {
            setError(t('exportUnavailable'));
            return;
          }
          Promise.resolve().then(() => exporter.download(sessionId)).catch((reason) => setError(`${t('exportFailed')}: ${reason instanceof Error ? reason.message : String(reason)}`));
        } else if (id === 'delete') setConfirmOpen(true);
      };
      const items = [
        { id: 'delete', label: t('delete'), icon: react.createElement(DeleteIcon), danger: true, disabled: unavailable },
        { id: 'memory', label: t('memoryTitle'), icon: react.createElement(MemoryIcon), disabled: busy },
        { id: 'tasks', label: t('taskMenuTitle'), icon: react.createElement(TaskIcon), disabled: busy },
        { id: 'stats', label: t('stats'), icon: react.createElement(StatsIcon), disabled: busy || !sessionId },
        { id: 'rename-session', label: t('renameSession'), icon: react.createElement(RenameIcon), disabled: busy || !sessionId || typeof renameCurrentSession !== 'function' },
        { id: 'fork-session', label: t('forkSession'), icon: react.createElement(BranchIcon), disabled: busy || !sessionId || typeof forkCurrentSession !== 'function' },
        { id: 'archive-session', label: t('archiveSession'), icon: react.createElement(ArchiveIcon), disabled: unavailable || !sessionId || typeof archiveCurrentSession !== 'function' },
        { id: 'folder', label: t('folder'), icon: react.createElement(FolderIcon), disabled: unavailable },
        { id: 'export', label: t('export'), icon: react.createElement(ExportIcon), disabled: unavailable || !exporter?.download },
        { id: 'global-prompt', label: t('globalPrompt'), icon: react.createElement(GlobalPromptIcon), disabled: busy },
        { id: 'compaction-config', label: t('compactionConfig'), icon: react.createElement(CompactionIcon), disabled: busy },
        { id: 'repair-session', label: t('repairSession'), icon: react.createElement(RepairSessionIcon, { size: 16 }), disabled: busy || !sessionId },
        { id: 'archive', label: t('archive'), icon: react.createElement(ArchiveIcon), disabled: busy }
      ];
      return react.createElement(
        react.Fragment,
        null,
        react.createElement(primitives.Menu, { open, anchor, items, onSelect: select, onClose: () => setOpen(false), portal: false, align: 'start', compact: true, closeOnPointerLeave: true }),
        react.createElement(RenameDialog, {
          open: renameOpen,
          t,
          value: renameDraft,
          error: renameError,
          busy,
          onChange: setRenameDraft,
          onCancel: closeRename,
          onConfirm: () => void confirmRename()
        }),
        react.createElement(DeleteConfirmDialog, {
          open: confirmOpen,
          t,
          onCancel: () => setConfirmOpen(false),
          onConfirm: () => {
            setConfirmOpen(false);
            void run(DELETE_ROUTE);
          },
          busy
        }),
        react.createElement(ArchivedSessionsDialog, {
          open: archiveOpen,
          t,
          onClose: () => setArchiveOpen(false),
          refreshWorkspaces,
          refreshSessions,
          openSession,
          exporter,
          renameCurrentSession,
          forkCurrentSession,
          updateSidebarEntries
        }),
        react.createElement(GlobalPromptDialog, {
          open: globalPromptOpen,
          t,
          onClose: () => setGlobalPromptOpen(false)
        }),
        react.createElement(MemoryManagementDialog, {
          open: memoryOpen,
          t,
          sessionId,
          getSessionTitle,
          getCurrentUserMessage: () => currentUserMessageText(state),
          getModelSelection,
          getModelDirectory,
          updateSidebarEntries,
          pickDirectory: () => ctx.get('uiWorkspace')?.pickDirectory?.(),
          onClose: () => setMemoryOpen(false)
        }),
        react.createElement(TaskManagerDialog, {
          open: tasksOpen,
          t,
          sessionId,
          getSessionTitle,
          getSessionTitleMap,
          updateSidebarEntries,
          onClose: () => setTasksOpen(false)
        }),
        react.createElement(CompactionConfigDialog, {
          open: compactionOpen,
          t,
          sessionId,
          onClose: () => setCompactionOpen(false)
        }),
        react.createElement(RepairSessionDialog, {
          open: repairOpen,
          t,
          busy: repairBusy,
          result: repairResult,
          error: repairError,
          onClose: () => {
            if (!repairBusy) setRepairOpen(false);
          },
          onRepair: () => void runRepair()
        }),
        react.createElement(ToolStatsDialog, {
          open: statsOpen,
          t,
          sessionId,
          stats: statsData,
          loading: statsLoading,
          error: statsError,
          onClose: () => {
            if (!statsLoading) setStatsOpen(false);
          }
        }),
        error && react.createElement('span', { role: 'alert', title: error, style: { marginLeft: 8, color: 'var(--dsw-alias-state-error-primary)' } }, error)
      );
    }

    function SidebarFooterButton({ wide, label, icon, expanded, onClick }) {
      return react.createElement(
        'div',
        { className: `dsh-session-kit-sidebar-row${wide ? '' : ' dsh-session-kit-sidebar-rail-row'}` },
        react.createElement(
          'button',
          {
            type: 'button',
            className: `dsh-session-kit-sidebar-trigger${wide ? '' : ' dsh-session-kit-sidebar-rail'}`,
            'aria-haspopup': 'dialog',
            'aria-expanded': expanded,
            'aria-label': label,
            onClick
          },
          icon,
          wide && react.createElement('span', { className: 'dsh-session-kit-sidebar-label' }, label)
        )
      );
    }

    function SidebarMemoryButton({ wide, useSessions, t, getSessionTitle, getCurrentUserMessage, getModelSelection, getModelDirectory, updateSidebarEntries, pickDirectory }) {
      const sidebarEntries = useSidebarEntries();
      const [open, setOpen] = react.useState(false);
      const useSessionsSafe = typeof useSessions === 'function' ? useSessions : () => undefined;
      const sessions = useSessionsSafe((value) => value);
      /* 当前主会话：内核 0.1.7 的 list 快照无 current 字段，用 mainView 保留计数判定（官方同款）。 */
      const sessionId = String(Object.values(sessions?.byId ?? {}).find((session) => (session?.retainedBy?.mainView ?? 0) > 0)?.id ?? '');
      return react.createElement(
        react.Fragment,
        null,
        sidebarEntries.memoryVisible === true && react.createElement(SidebarFooterButton, {
          wide,
          label: t('memory'),
          icon: react.createElement(MemoryIcon, { size: wide ? 16 : 18 }),
          expanded: open,
          onClick: () => setOpen(true)
        }),
        react.createElement(MemoryManagementDialog, {
          open,
          t,
          sessionId,
          getSessionTitle,
          getCurrentUserMessage,
          getModelSelection,
          getModelDirectory,
          updateSidebarEntries,
          pickDirectory,
          onClose: () => setOpen(false)
        })
      );
    }

    /* ── 任务管理弹窗 ── */

    function TaskManagerDialog({ open, t, sessionId, onClose, updateSidebarEntries, getSessionTitle, getSessionTitleMap }) {
      const sidebarEntries = useSidebarEntries();
      const [loading, setLoading] = react.useState(false);
      const [error, setError] = react.useState('');
      const [tasks, setTasks] = react.useState([]);
      const [total, setTotal] = react.useState(0);
      const [page, setPage] = react.useState(0);
      const [filter, setFilter] = react.useState('active');
      const [search, setSearch] = react.useState('');
      /* 搜索经服务端全库匹配，输入防抖后再请求。 */
      const [debouncedSearch, setDebouncedSearch] = react.useState('');
      const searchRequestRef = react.useRef(0);
      const [detail, setDetail] = react.useState(null);
      const [detailLoading, setDetailLoading] = react.useState(false);
      /* 详情弹窗子任务展开明细：item.id → { expanded, loading, error, operations, pitfalls }。 */
      const [itemDetails, setItemDetails] = react.useState({});
      const [notice, setNotice] = react.useState('');
      const [copiedTaskSessionId, setCopiedTaskSessionId] = react.useState('');
      const copyTaskSessionIdTimer = react.useRef(0);
      const detailRequestRef = react.useRef(0);
      /* 自动注入未完成任务：全局开关（默认开启）。 */
      const [autoInject, setAutoInject] = react.useState(true);
      const [autoInjectBusy, setAutoInjectBusy] = react.useState(false);

      const toggleAutoInject = react.useCallback(async (next) => {
        if (autoInjectBusy) return;
        setAutoInjectBusy(true);
        setError('');
        setNotice('');
        try {
          const value = await taskAutoInjectRequest('POST', { enabled: next });
          setAutoInject(value?.enabled !== false);
          setNotice(t(next ? 'taskAutoInjectOn' : 'taskAutoInjectOff'));
        } catch (reason) {
          setError(t('taskAutoInjectFailed') + (reason instanceof Error ? `：${reason.message}` : ''));
        } finally {
          setAutoInjectBusy(false);
        }
      }, [autoInjectBusy, t]);

      const copyTaskSessionId = react.useCallback(async (value) => {
        const text = String(value ?? '').trim();
        if (text === '') return;
        window.clearTimeout(copyTaskSessionIdTimer.current);
        setError('');
        try {
          const copied = await primitives.writeClipboard(text);
          if (copied === false) throw new Error('clipboard-write-failed');
          setCopiedTaskSessionId(text);
          copyTaskSessionIdTimer.current = window.setTimeout(() => {
            setCopiedTaskSessionId((current) => current === text ? '' : current);
          }, 1600);
        } catch {
          setError(t('taskSessionIdCopyFailed'));
        }
      }, [t]);

      /* 涉及会话的标题解析：task_sessions 里的会话ID与客户端快照的键可能差一个
         session- 前缀（宿主新旧 ID 格式并存，旧任务关联的冷/归档会话也常不在
         快照里），直接查 getSessionTitle 落空时，用 getSessionTitleMap 按「剥前缀
         后全等」兜底再对一遍——映射含归档，能找回大部分旧会话的名称。 */
      const taskSessionTitle = (id) => {
        let title = '';
        try { title = getSessionTitle?.(id) || ''; } catch { title = ''; }
        if (title !== '') return title;
        const target = normalizedSessionId(id);
        if (target === '') return '';
        const map = typeof getSessionTitleMap === 'function' ? getSessionTitleMap() : undefined;
        if (map === null || typeof map !== 'object') return '';
        for (const [key, entry] of Object.entries(map)) {
          if (normalizedSessionId(key) === target) {
            return typeof entry === 'string' ? entry : String(entry?.displayTitle ?? '');
          }
        }
        return '';
      };

      react.useEffect(() => () => window.clearTimeout(copyTaskSessionIdTimer.current), []);

      react.useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => window.clearTimeout(timer);
      }, [search]);

      const load = react.useCallback(async ({ silent = false, filter: filterOverride, page: pageOverride } = {}) => {
        /* 允许显式覆盖筛选与页码：新建任务后需立刻按「未开始」拉取，
           而此刻 state 尚未更新，闭包里的 filter/page 仍是旧值。 */
        const status = filterOverride ?? filter;
        const pageIndex = pageOverride ?? page;
        const requestId = searchRequestRef.current + 1;
        searchRequestRef.current = requestId;
        if (!silent) setLoading(true);
        setError('');
        try {
          const result = await taskListPage({
            status,
            keyword: debouncedSearch,
            /* 关键词同时按关联会话匹配（名称包含或会话ID全等），命中的会话ID
               交给服务端做 task_sessions 关联过滤；getter 现取现用，保证拿到
               当前会话快照，故不进 deps（load 身份驱动刷新，见上方 effect）。 */
            sessionIds: taskSearchSessionIds(typeof getSessionTitleMap === 'function' ? getSessionTitleMap() : undefined, debouncedSearch).join(','),
            limit: TASK_LIST_PAGE_SIZE,
            offset: pageIndex * TASK_LIST_PAGE_SIZE
          });
          /* 丢弃过期响应（搜索/翻页快速切换时）。 */
          if (searchRequestRef.current !== requestId) return;
          setTasks(result.tasks);
          setTotal(result.total);
        } catch (reason) {
          if (searchRequestRef.current !== requestId) return;
          setError(t('taskLoadFailed') + (reason instanceof Error ? `：${reason.message}` : ''));
          setTasks([]);
          setTotal(0);
        } finally {
          if (searchRequestRef.current === requestId && !silent) setLoading(false);
        }
      }, [t, filter, debouncedSearch, page]);

      /* 「全部」页签状态占比（圆环图）：与筛选/搜索无关，仅在打开、轮询与数据变更时刷新。 */
      const [statusStats, setStatusStats] = react.useState(null);

      const loadStats = react.useCallback(async () => {
        try {
          setStatusStats(await taskFetch({ action: 'stats' }));
        } catch {
          /* 占比拉取失败静默：图表沿用上次数据 */
        }
      }, []);

      /* 筛选或搜索变化时回到第一页，避免停留在越界页码。 */
      react.useEffect(() => { setPage(0); }, [filter, debouncedSearch]);

      react.useEffect(() => {
        if (!open) {
          detailRequestRef.current += 1;
          setDetail(null);
          setDetailLoading(false);
          setItemDetails({});
          setEditing(null);
          setDeleting(null);
          setInjectTarget(null);
          setCreating(null);
          setExpandedIds(new Set());
          setItemViews({});
          setItemLoadingIds(new Set());
          setNotice('');
          setSearch('');
          setDebouncedSearch('');
          setPage(0);
          return undefined;
        }
        void load();
        void loadStats();
        /* 打开时清理回收站：彻底删除超过 30 天的软删任务（失败静默，不阻塞列表）。 */
        void taskPost({ action: 'purgeTrash' }).catch(() => undefined);
        /* 打开时同步开关当前值（全局配置，可能被其他窗口改过）。 */
        void taskAutoInjectRequest('GET')
          .then((value) => setAutoInject(value?.enabled !== false))
          .catch(() => undefined);
        return undefined;
      }, [open, load]);

      /* 数据刷新时机：弹窗打开、筛选/搜索/翻页（load 身份变化触发上方 effect）、
         以及各变更回调（新建/编辑/删除/标记完成/提取/回收站恢复）。不做定时轮询。 */

      /* ── 回收站：完整任务卡片，仅隐藏「编辑」「注入当前会话」── */
      const [trashOpen, setTrashOpen] = react.useState(false);
      const [trashLoading, setTrashLoading] = react.useState(false);
      const [trashBusy, setTrashBusy] = react.useState(false);
      const [trashError, setTrashError] = react.useState('');
      const [trashNotice, setTrashNotice] = react.useState('');
      const [trashItems, setTrashItems] = react.useState([]);
      const [trashPurgeTarget, setTrashPurgeTarget] = react.useState(null);
      /* 回收站搜索：防抖后带 keyword 拉取（服务端对名称/项目名做子串匹配）。 */
      const [trashSearch, setTrashSearch] = react.useState('');
      const [trashDebouncedSearch, setTrashDebouncedSearch] = react.useState('');
      /* 回收站分页：与任务管理同款（每页 TASK_LIST_PAGE_SIZE，上一页/下一页）。 */
      const [trashPage, setTrashPage] = react.useState(0);
      const [trashTotal, setTrashTotal] = react.useState(0);
      const trashPageCount = Math.max(1, Math.ceil(trashTotal / TASK_LIST_PAGE_SIZE));
      const trashRequestRef = react.useRef(0);

      react.useEffect(() => {
        const timer = window.setTimeout(() => setTrashDebouncedSearch(trashSearch.trim()), 300);
        return () => window.clearTimeout(timer);
      }, [trashSearch]);

      /* 搜索词变化回到第一页，避免停留在越界页码。 */
      react.useEffect(() => { setTrashPage(0); }, [trashDebouncedSearch]);

      const loadTrash = react.useCallback(async () => {
        const requestId = trashRequestRef.current + 1;
        trashRequestRef.current = requestId;
        setTrashLoading(true);
        setTrashError('');
        try {
          const value = await taskFetch({
            action: 'trash',
            limit: TASK_LIST_PAGE_SIZE,
            offset: trashPage * TASK_LIST_PAGE_SIZE,
            ...(trashDebouncedSearch !== '' ? { keyword: trashDebouncedSearch } : {})
          });
          if (trashRequestRef.current !== requestId) return;
          const tasks = Array.isArray(value.tasks) ? value.tasks : [];
          const totalCount = Number.isFinite(Number(value.total)) ? Number(value.total) : tasks.length;
          setTrashItems(tasks);
          setTrashTotal(totalCount);
          /* 清掉末页最后一条后当前页可能越界，回退到新的最后一页。 */
          if (tasks.length === 0 && trashPage > 0 && totalCount > 0) {
            setTrashPage(Math.max(0, Math.ceil(totalCount / TASK_LIST_PAGE_SIZE) - 1));
          }
        } catch (reason) {
          if (trashRequestRef.current !== requestId) return;
          setTrashError(t('trashLoadFailed') + (reason instanceof Error ? `：${reason.message}` : ''));
          setTrashItems([]);
          setTrashTotal(0);
        } finally {
          if (trashRequestRef.current === requestId) setTrashLoading(false);
        }
      }, [t, trashDebouncedSearch, trashPage]);

      const trashRestore = react.useCallback(async (task) => {
        if (trashBusy) return;
        setTrashBusy(true);
        setTrashError('');
        try {
          await taskPost({ action: 'restoreTask', taskId: task.id });
          setTrashNotice(t('trashRestoreOk'));
          await loadTrash();
          void load({ silent: true });
          void loadStats();
        } catch (reason) {
          setTrashError(t('trashRestoreFailed') + (reason instanceof Error ? `：${reason.message}` : ''));
        } finally {
          setTrashBusy(false);
        }
      }, [trashBusy, loadTrash, load, t]);

      const requestTrashPurge = react.useCallback((task) => setTrashPurgeTarget(task), []);

      const trashConfirmPurge = react.useCallback(async () => {
        if (trashBusy || trashPurgeTarget === null) return;
        setTrashBusy(true);
        setTrashError('');
        try {
          await taskPost({ action: 'purgeTask', taskId: trashPurgeTarget.id });
          setTrashPurgeTarget(null);
          setTrashNotice(t('trashPurgeOk'));
          await loadTrash();
        } catch (reason) {
          setTrashError(t('trashPurgeFailed') + (reason instanceof Error ? `：${reason.message}` : ''));
        } finally {
          setTrashBusy(false);
        }
      }, [trashBusy, trashPurgeTarget, loadTrash, t]);

      react.useEffect(() => {
        if (!trashOpen) {
          setTrashSearch('');
          setTrashDebouncedSearch('');
          setTrashPage(0);
          setTrashTotal(0);
          return undefined;
        }
        setTrashNotice('');
        setTrashPurgeTarget(null);
        void loadTrash();
        return undefined;
      }, [trashOpen, loadTrash]);

      /* 打开详情：按需拉取明细，避免列表页承载大量数据。 */
      const closeDetail = react.useCallback(() => {
        detailRequestRef.current += 1;
        setDetail(null);
        setDetailLoading(false);
        setItemDetails({});
      }, []);

      const openDetail = react.useCallback(async (task) => {
        const requestId = detailRequestRef.current + 1;
        detailRequestRef.current = requestId;
        setDetail(null);
        setItemDetails({});
        setDetailLoading(true);
        setError('');
        try {
          const [view, ops] = await Promise.all([taskView(task.id), taskDetail(task.id)]);
          if (detailRequestRef.current !== requestId) return;
          setDetail({ view, ops });
        } catch (reason) {
          if (detailRequestRef.current === requestId) setError(t('taskLoadFailed') + (reason instanceof Error ? `：${reason.message}` : ''));
        } finally {
          if (detailRequestRef.current === requestId) setDetailLoading(false);
        }
      }, [t]);

      /* 展开子任务明细：首次懒加载按 item 过滤的操作/踩坑并缓存；收起再展开可重试。 */
      const toggleItemDetail = react.useCallback((viewId, item) => {
        const current = itemDetails[item.id] ?? {};
        const expanded = current.expanded === true;
        setItemDetails((map) => ({ ...map, [item.id]: { ...current, expanded: !expanded } }));
        if (expanded || current.operations !== undefined || current.loading === true) return;
        setItemDetails((map) => ({ ...map, [item.id]: { ...map[item.id], loading: true, error: undefined } }));
        taskDetail(viewId, item.id).then((value) => {
          setItemDetails((map) => ({ ...map, [item.id]: {
            ...map[item.id],
            loading: false,
            operations: Array.isArray(value.operations) ? value.operations : [],
            pitfalls: Array.isArray(value.pitfalls) ? value.pitfalls : []
          } }));
        }).catch((reason) => {
          setItemDetails((map) => ({ ...map, [item.id]: { ...map[item.id], loading: false, error: reason instanceof Error ? reason.message : String(reason) } }));
        });
      }, [itemDetails]);

      /* 注入：先确认，再通过工具接口执行，使档案以 user 消息进入会话上下文。 */
      const [injectTarget, setInjectTarget] = react.useState(null);
      const [injectBusy, setInjectBusy] = react.useState(false);

      const requestInject = react.useCallback((task) => {
        if (!sessionId) {
          setNotice(t('taskInjectNoSession'));
          return;
        }
        setInjectTarget(task);
      }, [sessionId, t]);

      const confirmInject = react.useCallback(async () => {
        if (injectTarget === null || injectBusy) return;
        setInjectBusy(true);
        try {
          const response = await fetch(TASK_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId, action: 'inject', taskId: injectTarget.id })
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || data.ok !== true) throw new Error(data.error || `HTTP ${response.status}`);
          setInjectTarget(null);
          setNotice(t('taskInjectOk').replace('{chars}', String(data.value?.approxChars ?? '?')));
          /* 注入会建立会话关联（touchSession），静默刷新让「会话」计数立即更新。 */
          void load({ silent: true });
        } catch (reason) {
          setInjectTarget(null);
          setNotice(reason instanceof Error ? reason.message : String(reason));
        } finally {
          setInjectBusy(false);
        }
      }, [injectTarget, injectBusy, sessionId, load, t]);

      /* 编辑/删除：任务可改名、改任务状态、整档删除。 */
      const [editing, setEditing] = react.useState(null);
      const [editBusy, setEditBusy] = react.useState(false);
      const [deleting, setDeleting] = react.useState(null);
      const [deleteBusy, setDeleteBusy] = react.useState(false);

      const openEdit = react.useCallback(async (task) => {
        setEditing({ task, name: task.name, status: task.status, summary: '' });
        try {
          const view = await taskView(task.id);
          setEditing((current) => current && { ...current, summary: view?.summary ?? '' });
        } catch {
          /* 附加信息加载失败不阻塞编辑 */
        }
      }, []);

      const saveEdit = react.useCallback(async () => {
        if (editing === null || editBusy) return;
        const name = editing.name.trim();
        if (name === '') return;
        setEditBusy(true);
        setError('');
        try {
          const response = await fetch(TASK_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'updateTask', taskId: editing.task.id, revision: editing.task.revision, name, status: editing.status, summary: editing.summary })
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || data.ok !== true) throw new Error(data.value?.notice || data.error || `HTTP ${response.status}`);
          setEditing(null);
          setNotice(t('taskUpdateOk'));
          if (detail?.view?.id === editing.task.id) setDetail(null);
          void load();
          void loadStats();
        } catch (reason) {
          setError(t('taskUpdateFailed') + (reason instanceof Error ? `：${reason.message}` : ''));
        } finally {
          setEditBusy(false);
        }
      }, [editing, editBusy, detail, load, t]);

      const requestDelete = react.useCallback((task) => setDeleting(task), []);

      const confirmDelete = react.useCallback(async () => {
        if (deleting === null || deleteBusy) return;
        setDeleteBusy(true);
        setError('');
        try {
          const response = await fetch(TASK_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'deleteTask', taskId: deleting.id })
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || data.ok !== true) throw new Error(data.error || `HTTP ${response.status}`);
          setDeleting(null);
          setNotice(t('taskDeleteOk'));
          if (detail?.view?.id === deleting.id) setDetail(null);
          void load();
          void loadStats();
        } catch (reason) {
          setError(t('taskDeleteFailed') + (reason instanceof Error ? `：${reason.message}` : ''));
        } finally {
          setDeleteBusy(false);
        }
      }, [deleting, deleteBusy, detail, load, t]);

      /* 一键标记完成：跳过编辑弹窗直接置 completed（乐观锁提交，revision 取列表快照）。
         活已干完但最后 1~2 个 todo 没勾时，任务会卡在进行中，此按钮兜底。 */
      const [completingId, setCompletingId] = react.useState(null);

      const markCompleted = react.useCallback(async (task) => {
        if (completingId !== null) return;
        setCompletingId(task.id);
        setError('');
        try {
          await taskPost({ action: 'updateTask', taskId: task.id, revision: task.revision, status: 'completed' });
          setNotice(t('taskCompleteOk'));
          void load({ silent: true });
          void loadStats();
        } catch (reason) {
          setError(reason instanceof Error && reason.message === 'update-failed'
            ? t('taskCompleteStale')
            : t('taskUpdateFailed') + (reason instanceof Error ? `：${reason.message}` : ''));
        } finally {
          setCompletingId(null);
        }
      }, [completingId, load, t]);

      /* 新增任务：手动建档（可指定状态与附加信息）；不关联当前会话，
         会话关联由「注入当前会话」或该会话真实参与任务时建立。 */
      const [creating, setCreating] = react.useState(null);
      const [createBusy, setCreateBusy] = react.useState(false);

      const openCreate = react.useCallback(() => {
        /* items：动态子任务输入行，默认给一行空输入便于直接录入。 */
        setCreating({ name: '', summary: '', items: [''] });
      }, []);

      /* 新建时的有效子任务（去掉空白行）：用于计数、禁用保存与提交。 */
      const createItems = react.useMemo(
        () => (creating?.items ?? []).map((item) => String(item ?? '').trim()).filter((item) => item !== ''),
        [creating]
      );

      const saveCreate = react.useCallback(async () => {
        /* 至少需要一个子任务：新建的任务必须有可推进的内容。 */
        if (creating === null || creating.name.trim() === '' || createItems.length === 0 || createBusy) return;
        setCreateBusy(true);
        setError('');
        try {
          /* 提交已验证过内容的行；服务端还会再做一次去重与清洗。 */
          const response = await fetch(TASK_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'createTask', name: creating.name.trim(), status: 'not_started', summary: creating.summary, items: createItems })
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || data.ok !== true) throw new Error(data.error || `HTTP ${response.status}`);
          setCreating(null);
          setNotice(fillTemplate(t('taskCreateOkWithItems'), { count: createItems.length }));
          /* 新建后切到「未开始」并回到第一页。
             若当前已在「未开始」，setFilter 值不变、不会触发加载 effect，
             此时需显式补一次加载，否则新任务不会出现在列表里。 */
          const alreadyOnNotStarted = filter === 'not_started';
          setFilter('not_started');
          setPage(0);
          if (alreadyOnNotStarted) void load({ filter: 'not_started', page: 0, silent: true });
          void loadStats();
        } catch (reason) {
          setError(t('taskCreateFailed') + (reason instanceof Error ? `：${reason.message}` : ''));
        } finally {
          setCreateBusy(false);
        }
      }, [creating, createBusy, sessionId, t, createItems, filter, load]);

      /* 从当前会话的 todo 提取任务档案：服务端会去重（已有档案则不重复写入）。 */
      const [extractBusy, setExtractBusy] = react.useState(false);
      const extractFromSession = react.useCallback(async () => {
        if (extractBusy) return;
        if (!sessionId) {
          setError(t('taskExtractReasonNoSession'));
          return;
        }
        setExtractBusy(true);
        setError('');
        setNotice('');
        try {
          const response = await fetch(TASK_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'extractSessionTask', sessionId })
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || data.ok !== true) {
            const reason = String(data.error ?? data.value?.reason ?? '');
            /* 按服务端返回的原因给出具体说明；未知原因带上原始代码/状态码便于排查。 */
            const key = TASK_EXTRACT_REASON_KEYS[reason];
            const fallback = reason || `HTTP ${response.status}`;
            setError(key !== undefined ? t(key) : `${t('taskExtractFailed')}（${fallback}）`);
            return;
          }
          const value = data.value ?? {};
          setNotice(
            value.created === false
              ? fillTemplate(t('taskExtractExists'), { name: value.name || '-' })
              : fillTemplate(t('taskExtractOk'), { name: value.name || '-', count: value.itemCount ?? 0 })
          );
          /* 让新任务立即可见：切到「全部」并回到第一页，随后重载。 */
          if (value.created !== false) {
            setFilter('all');
            setPage(0);
          }
          void load();
          void loadStats();
        } catch (reason) {
          setError(t('taskExtractFailed') + (reason instanceof Error ? `：${reason.message}` : ''));
        } finally {
          setExtractBusy(false);
        }
      }, [extractBusy, sessionId, t, load]);

      /* 子任务展开：点击统计项按需拉取 task_view 的子任务列表并缓存。 */
      const [expandedIds, setExpandedIds] = react.useState(new Set());
      const [itemViews, setItemViews] = react.useState({});
      const [itemLoadingIds, setItemLoadingIds] = react.useState(new Set());
      /* 涉及会话展开：与子任务同样按需拉取 task_view.sessions 并缓存。 */
      const [expandedSessionIds, setExpandedSessionIds] = react.useState(new Set());
      const [sessionViews, setSessionViews] = react.useState({});
      const [sessionLoadingIds, setSessionLoadingIds] = react.useState(new Set());

      const toggleSessions = react.useCallback(async (task) => {
        const next = new Set(expandedSessionIds);
        if (next.has(task.id)) {
          next.delete(task.id);
          setExpandedSessionIds(next);
          return;
        }
        next.add(task.id);
        setExpandedSessionIds(next);
        if (sessionViews[task.id] !== undefined) return;
        const loading = new Set(sessionLoadingIds);
        loading.add(task.id);
        setSessionLoadingIds(loading);
        try {
          const view = await taskView(task.id);
          setSessionViews((current) => ({ ...current, [task.id]: view?.sessions ?? [] }));
        } catch (reason) {
          setError(t('taskLoadFailed') + (reason instanceof Error ? `：${reason.message}` : ''));
          const collapsed = new Set(expandedSessionIds);
          collapsed.delete(task.id);
          setExpandedSessionIds(collapsed);
        } finally {
          setSessionLoadingIds((current) => {
            const alive = new Set(current);
            alive.delete(task.id);
            return alive;
          });
        }
      }, [expandedSessionIds, sessionViews, sessionLoadingIds, t]);

      const toggleItems = react.useCallback(async (task) => {
        const next = new Set(expandedIds);
        if (next.has(task.id)) {
          next.delete(task.id);
          setExpandedIds(next);
          return;
        }
        next.add(task.id);
        setExpandedIds(next);
        if (itemViews[task.id] !== undefined) return;
        const loading = new Set(itemLoadingIds);
        loading.add(task.id);
        setItemLoadingIds(loading);
        try {
          const view = await taskView(task.id);
          setItemViews((current) => ({ ...current, [task.id]: view?.items ?? [] }));
        } catch (reason) {
          setError(t('taskLoadFailed') + (reason instanceof Error ? `：${reason.message}` : ''));
          const collapsed = new Set(expandedIds);
          collapsed.delete(task.id);
          setExpandedIds(collapsed);
        } finally {
          setItemLoadingIds((current) => {
            const alive = new Set(current);
            alive.delete(task.id);
            return alive;
          });
        }
      }, [expandedIds, itemViews, itemLoadingIds, t]);

      const visible = tasks;
      /* 总页数按筛选命中总数推算；页码越界时收敛回最后一页。 */
      const taskPageCount = Math.max(1, Math.ceil(total / TASK_LIST_PAGE_SIZE));
      react.useEffect(() => {
        if (page > taskPageCount - 1) setPage(taskPageCount - 1);
      }, [page, taskPageCount]);

      /* 详情叠加：详情打开时列表弹窗保持可见，仅不响应关闭（避免一次 Escape 关两层）。 */
      const detailOpen = open && (detail !== null || detailLoading);
      const closeList = react.useCallback(() => {
        if (!detailOpen) onClose();
      }, [detailOpen, onClose]);

      const renderFilterButton = (value, label) => react.createElement(
        primitives.Button,
        {
          variant: 'outline',
          size: 'sm',
          'aria-pressed': filter === value,
          className: filter === value ? 'dsh-session-kit-task-filter-active' : undefined,
          onClick: () => setFilter(value)
        },
        label
      );

      /* 「全部」页签状态占比圆环：SVG stroke-dasharray 百分比叠加（无需图表库），
         配色与状态 pill 同源；图例行可点击切换到对应筛选。 */
      const renderStatusChart = () => {
        const counts = statusStats?.counts ?? {};
        const total = Number(statusStats?.total) || 0;
        const slices = TASK_STATUS_CHART_ORDER
          .map((status) => ({ status, count: Number(counts[status]) || 0 }))
          .filter((entry) => entry.count > 0)
          .map((entry) => ({ ...entry, percent: total > 0 ? (entry.count / total) * 100 : 0 }));
        let accumulated = 0;
        const segments = slices.map((entry) => {
          const segment = react.createElement('circle', {
            key: entry.status,
            cx: 21,
            cy: 21,
            r: 15.9155,
            fill: 'none',
            stroke: TASK_STATUS_CHART_COLORS[entry.status],
            strokeWidth: 5.5,
            strokeDasharray: `${entry.percent} ${100 - entry.percent}`,
            strokeDashoffset: 25 - accumulated
          });
          accumulated += entry.percent;
          return segment;
        });
        return react.createElement(
          'div',
          { className: 'dsh-session-kit-task-chart' },
          react.createElement(
            'svg',
            {
              className: 'dsh-session-kit-task-chart-donut',
              /* 42×42 视窗：r=15.9155 的周长恰为 100（dasharray 百分比技法），
                 外缘 15.9155 + 5.5/2 = 18.67 < 21，圆环完整不被裁切。 */
              viewBox: '0 0 42 42',
              width: 136,
              height: 136,
              preserveAspectRatio: 'xMidYMid meet',
              /* 内联锁定正方形视口：防止上游/全局 svg 规则或 flex 拉伸把圆变椭圆。 */
              style: { width: '136px', height: '136px', flex: 'none' },
              role: 'img',
              'aria-label': t('taskChartTotal')
            },
            total === 0 ? react.createElement('circle', { cx: 21, cy: 21, r: 15.9155, fill: 'none', stroke: 'var(--dsw-alias-border-l2)', strokeWidth: 5.5 }) : null,
            segments,
            react.createElement('text', { className: 'dsh-session-kit-task-chart-total-value', x: 21, y: 20.5, textAnchor: 'middle' }, String(total)),
            react.createElement('text', { className: 'dsh-session-kit-task-chart-total-label', x: 21, y: 27, textAnchor: 'middle' }, t('taskChartTotal'))
          ),
          react.createElement(
            'div',
            { className: 'dsh-session-kit-task-chart-legend' },
            slices.map((entry) => react.createElement(
              'button',
              {
                type: 'button',
                key: entry.status,
                className: 'dsh-session-kit-task-chart-legend-item',
                title: taskStatusLabel(t, entry.status),
                onClick: () => setFilter(entry.status)
              },
              react.createElement('span', { className: 'dsh-session-kit-task-chart-dot', style: { background: TASK_STATUS_CHART_COLORS[entry.status] } }),
              fillTemplate(t('taskChartLegend'), { label: taskStatusLabel(t, entry.status), count: entry.count, percent: Math.round(entry.percent) })
            ))
          )
        );
      };

      const renderListItem = (task, { trash = false } = {}) => {
        const counts = task.itemCounts ?? { total: 0, done: 0, inProgress: 0 };
        const total = Math.max(0, Number(counts.total) || 0);
        const done = Math.min(total, Math.max(0, Number(counts.done) || 0));
        const progress = total > 0 ? Math.round((done / total) * 100) : 0;
        const expanded = expandedIds.has(task.id);
        const itemList = itemViews[task.id];
        const itemLoading = itemLoadingIds.has(task.id);
        const sessionsExpanded = expandedSessionIds.has(task.id);
        const sessionList = sessionViews[task.id];
        const sessionLoading = sessionLoadingIds.has(task.id);
        return react.createElement(
          'article',
          { key: task.id, className: `dsh-session-kit-task-card dsh-session-kit-task-card-${task.status}`, 'aria-label': task.name },
          react.createElement(
            'div',
            { className: 'dsh-session-kit-task-card-head' },
            react.createElement(
              'div',
              { className: 'dsh-session-kit-task-card-title-wrap' },
              react.createElement('h3', { className: 'dsh-session-kit-task-card-name', title: task.name }, task.name),
              task.projectName ? react.createElement('span', { className: 'dsh-session-kit-task-card-project', title: task.projectName }, task.projectName) : null
            ),
            react.createElement(
              'div',
              { className: 'dsh-session-kit-task-card-head-actions' },
              react.createElement('span', { className: `dsh-session-kit-task-status dsh-session-kit-task-status-${task.status}` }, taskStatusLabel(t, task.status)),
              /* 回收站卡片：无「编辑」，恢复按钮顶替其位置；删除按钮变「彻底删除」。 */
              trash
                ? react.createElement(primitives.Button, { variant: 'outline', size: 'sm', className: 'dsh-session-kit-task-card-head-btn', disabled: trashBusy, onClick: () => void trashRestore(task) }, t('trashRestore'))
                : react.createElement(primitives.Button, { variant: 'outline', size: 'sm', className: 'dsh-session-kit-task-card-head-btn', onClick: () => openEdit(task) }, t('taskEdit')),
              trash
                ? react.createElement(primitives.Button, { variant: 'outline', size: 'sm', className: 'dsh-session-kit-task-card-head-btn dsh-session-kit-task-card-head-btn-danger', disabled: trashBusy, title: t('trashPurge'), onClick: () => requestTrashPurge(task) }, t('trashPurge'))
                : react.createElement(primitives.Button, { variant: 'outline', size: 'sm', className: 'dsh-session-kit-task-card-head-btn dsh-session-kit-task-card-head-btn-danger', title: t('taskDelete'), onClick: () => requestDelete(task) }, t('taskDelete'))
            )
          ),
          react.createElement(
            'div',
            { className: 'dsh-session-kit-task-progress-row' },
            react.createElement('span', { className: 'dsh-session-kit-task-progress-label' }, t('taskProgress')),
            react.createElement('strong', { className: 'dsh-session-kit-task-progress-value' }, `${done}/${total}`),
            react.createElement('span', { className: 'dsh-session-kit-task-progress-percent' }, `${progress}%`)
          ),
          react.createElement(
            'div',
            { className: 'dsh-session-kit-task-progress-track', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': progress, 'aria-label': `${t('taskProgress')} ${progress}%` },
            react.createElement('span', { className: 'dsh-session-kit-task-progress-fill', style: { width: `${progress}%` } })
          ),
          react.createElement(
            'div',
            { className: 'dsh-session-kit-task-card-stats' },
            react.createElement('button', {
              type: 'button',
              className: `dsh-session-kit-task-stat dsh-session-kit-task-stat-toggle${expanded ? ' dsh-session-kit-task-stat-toggle-open' : ''}`,
              'aria-expanded': expanded,
              title: t('taskItems'),
              onClick: () => void toggleItems(task)
            },
              react.createElement('strong', null, total),
              react.createElement('span', null, t('taskItems')),
              react.createElement(expanded ? primitives.IconChevronUpOutlineRegular : primitives.IconChevronDownOutlineRegular, { size: 14, className: 'dsh-session-kit-task-stat-chevron' })
            ),
            react.createElement('span', { className: 'dsh-session-kit-task-stat' }, react.createElement('strong', null, done), react.createElement('span', null, t('taskStatusCompleted'))),
            react.createElement('button', {
              type: 'button',
              className: `dsh-session-kit-task-stat dsh-session-kit-task-stat-toggle${sessionsExpanded ? ' dsh-session-kit-task-stat-toggle-open' : ''}`,
              'aria-expanded': sessionsExpanded,
              title: t('taskSessions'),
              onClick: () => void toggleSessions(task)
            },
              react.createElement('strong', null, task.sessionCount ?? 0),
              react.createElement('span', null, t('taskSessions')),
              react.createElement(sessionsExpanded ? primitives.IconChevronUpOutlineRegular : primitives.IconChevronDownOutlineRegular, { size: 14, className: 'dsh-session-kit-task-stat-chevron' })
            )
          ),
          expanded ? react.createElement(
            'div',
            { className: 'dsh-session-kit-task-card-items' },
            itemLoading && (itemList === undefined || itemList.length === 0)
              ? react.createElement('div', { className: 'dsh-session-kit-task-card-item dsh-session-kit-task-card-item-loading' }, react.createElement(primitives.IconLoadingOutlineRegular, { size: 14 }))
              : (itemList ?? []).map((item) => react.createElement(
                'div',
                { key: item.id, className: 'dsh-session-kit-task-card-item' },
                item.status === 'completed'
                  ? react.createElement(primitives.IconCheckOutlineRegular, { size: 14, className: 'dsh-session-kit-task-card-item-check' })
                  : react.createElement('span', { className: 'dsh-session-kit-task-card-item-check dsh-session-kit-task-card-item-check-none', 'aria-hidden': true }),
                react.createElement('span', { className: `dsh-session-kit-task-item-status dsh-session-kit-task-item-status-${item.status}` }, taskItemStatusLabel(t, item.status)),
                react.createElement('span', { className: 'dsh-session-kit-task-card-item-name' }, item.name)
              ))
          ) : null,
          sessionsExpanded ? react.createElement(
            'div',
            { className: 'dsh-session-kit-task-card-items dsh-session-kit-task-card-sessions' },
            sessionLoading && (sessionList === undefined || sessionList.length === 0)
              ? react.createElement('div', { className: 'dsh-session-kit-task-card-item dsh-session-kit-task-card-item-loading' }, react.createElement(primitives.IconLoadingOutlineRegular, { size: 14 }))
              : (sessionList ?? []).length === 0
                ? react.createElement('div', { className: 'dsh-session-kit-task-card-item dsh-session-kit-task-card-item-name' }, t('taskSessionsEmpty'))
                : (sessionList ?? []).map((session) => {
                  let title = '';
                  try { title = session.title || taskSessionTitle(session.id) || ''; } catch { title = ''; }
                  return react.createElement(
                    'div',
                    { key: session.id, className: 'dsh-session-kit-task-card-item' },
                    title ? react.createElement('span', { className: 'dsh-session-kit-task-session-id', title: title }, title) : null,
                    react.createElement('button', {
                      type: 'button',
                      className: `dsh-session-kit-task-session-copy${copiedTaskSessionId === session.id ? ' dsh-session-kit-task-session-copy-copied' : ''}`,
                      title: copiedTaskSessionId === session.id ? t('taskSessionIdCopied') : t('taskSessionCopyId'),
                      'aria-label': `${copiedTaskSessionId === session.id ? t('taskSessionIdCopied') : t('taskSessionCopyId')} ${session.id}`,
                      onClick: (event) => { event.stopPropagation(); void copyTaskSessionId(session.id); }
                    },
                      session.id,
                      copiedTaskSessionId === session.id ? react.createElement(primitives.IconCheckOutlineRegular, { size: 12, 'aria-hidden': true }) : null
                    ),
                    Array.isArray(session.turnRange) && (session.turnRange[0] !== null || session.turnRange[1] !== null)
                      ? react.createElement('span', { className: 'dsh-session-kit-task-session-turns' }, fillTemplate(t('taskSessionTurns'), { from: session.turnRange[0] ?? '?', to: session.turnRange[1] ?? '?' }))
                      : null,
                    react.createElement('span', { className: 'dsh-session-kit-task-card-item-meta dsh-session-kit-task-session-time' }, `${memoryFormatTime(session.firstAt)} ~ ${memoryFormatTime(session.lastAt)}`)
                  );
                })
          ) : null,
          react.createElement(
            'div',
            { className: 'dsh-session-kit-task-card-actions' },
            react.createElement(primitives.Button, { variant: 'outline', size: 'sm', onClick: () => void openDetail(task) }, t('taskDetailTitle')),
            /* 「任务详情」旁的一键完成：活干完了但 todo 漏勾时兜底，不必进编辑弹窗。 */
            !trash && task.status !== 'completed' ? react.createElement(primitives.Button, {
              variant: 'outline',
              size: 'sm',
              disabled: completingId !== null,
              title: t('taskComplete'),
              onClick: () => void markCompleted(task)
            }, t('taskComplete')) : null,
            /* 「任务详情」右侧：创建/更新时间，整体靠左紧贴按钮，不参与右侧推挤。 */
            react.createElement(
              'span',
              { className: 'dsh-session-kit-task-card-times' },
              `${t('taskCreatedAt')}：${memoryFormatTime(task.createdAt) || '-'}`,
              react.createElement('span', { className: 'dsh-session-kit-task-card-times-sep' }, '·'),
              `${t('taskUpdatedAt')}：${memoryFormatTime(task.updatedAt) || '-'}`
            ),
            trash || task.status === 'completed' ? null : react.createElement(primitives.Button, { variant: 'outline', size: 'sm', title: t('taskInjectHint'), onClick: () => requestInject(task) }, t('taskInject'))
          )
        );
      };

      const renderDetail = () => {
        if (detailLoading) return react.createElement('div', { className: 'dsh-session-kit-task-empty' }, '…');
        if (detail === null) return null;
        const view = detail.view ?? {};
        const ops = detail.ops ?? {};
        const meta = (label, value) => value ? react.createElement('div', { className: 'dsh-session-kit-task-card-meta' }, `${label}：${value}`) : null;
        /* 项目与工作目录合并一行：projectName 由 cwd 派生（git 仓库名或末段名），
           两者在 git 子目录场景下互补，故以「项目（路径）」形式同排展示。 */
        const projectMeta = () => {
          const projectName = view.projectName ?? '';
          const cwd = view.cwd ?? '';
          if (!projectName && !cwd) return null;
          if (!projectName) return meta(t('taskCwd'), cwd);
          if (!cwd || cwd === projectName) return meta(t('taskProject'), projectName);
          return react.createElement(
            'div',
            { className: 'dsh-session-kit-task-card-meta' },
            `${t('taskProject')}：${projectName}`,
            react.createElement('span', { className: 'dsh-session-kit-task-meta-path', title: cwd }, `（${cwd}）`)
          );
        };
        const turnText = (range) => Array.isArray(range) && (range[0] !== null || range[1] !== null)
          ? fillTemplate(t('taskTurnRange'), { from: range[0] ?? '?', to: range[1] ?? '?' })
          : '';
        /* 操作行/踩坑行渲染（任务级区与子任务展开面板共用）。 */
        const renderOpsRows = (operations) => (Array.isArray(operations) ? operations : []).slice(0, TASK_DETAIL_OP_LIMIT).map((op, index) => {
          const objects = Array.isArray(op.objects) ? op.objects.filter(Boolean) : [];
          const mainText = `${op.path || op.content || ''}${op.count > 1 ? ` ×${op.count}` : ''}`;
          return react.createElement(
            'div',
            { key: `${op.callId ?? index}`, className: `dsh-session-kit-task-op${op.isError ? ' dsh-session-kit-task-op-error' : ''}` },
            react.createElement(
              'div',
              { className: 'dsh-session-kit-task-op-main' },
              react.createElement('span', { className: 'dsh-session-kit-task-op-kind' }, op.kind),
              react.createElement('span', { className: 'dsh-session-kit-task-op-text', title: mainText }, mainText)
            ),
            objects.length > 0
              ? react.createElement(
                'div',
                { className: 'dsh-session-kit-task-op-objects', title: objects.join('\n') },
                react.createElement('span', { className: 'dsh-session-kit-task-op-objects-label' }, `${t('taskObjects')}：`),
                objects.join(' · ')
              )
              : null
          );
        });
        const renderPitfallRows = (pitfalls) => (Array.isArray(pitfalls) ? pitfalls : []).map((pit, index) => react.createElement(
          'div',
          { key: `pit-${index}`, className: 'dsh-session-kit-task-pitfall' },
          `(${pit.kind}) ${pit.detail}${pit.count > 1 ? ` ×${pit.count}` : ''}`
        ));
        return react.createElement(
          'div',
          { className: 'dsh-session-kit-task-detail' },
          projectMeta(),
          meta(t('taskCreatedAt'), memoryFormatTime(view.createdAt)),
          meta(t('taskUpdatedAt'), memoryFormatTime(view.updatedAt)),
          meta(t('taskSummary'), view.summary),
          Array.isArray(view.memoryDirectories) && view.memoryDirectories.length > 0
            ? react.createElement('div', { className: 'dsh-session-kit-task-card-meta' }, `${t('taskMemoryDirs')}：${view.memoryDirectories.map((d) => d.name).join('、')}`)
            : null,
          react.createElement('div', { className: 'dsh-session-kit-task-section-title' }, `${t('taskItems')}（${(view.items ?? []).length}）`),
          (view.items ?? []).map((item) => {
            const itemState = itemDetails[item.id] ?? {};
            const itemExpanded = itemState.expanded === true;
            return react.createElement(
              react.Fragment,
              { key: item.id },
              react.createElement(
                'div',
                { className: 'dsh-session-kit-task-item' },
                /* 与卡片内子任务清单一致：已完成打勾，未完成留同宽占位符对齐。 */
                item.status === 'completed'
                  ? react.createElement(primitives.IconCheckOutlineRegular, { size: 14, className: 'dsh-session-kit-task-item-check' })
                  : react.createElement('span', { className: 'dsh-session-kit-task-item-check dsh-session-kit-task-item-check-none', 'aria-hidden': true }),
                react.createElement('span', { className: 'dsh-session-kit-task-item-status dsh-session-kit-task-item-status-' + item.status }, taskItemStatusLabel(t, item.status)),
                react.createElement('span', { className: 'dsh-session-kit-task-item-name', title: item.name }, item.name),
                turnText(item.turnRange) ? react.createElement('span', { className: 'dsh-session-kit-task-item-sub' }, turnText(item.turnRange)) : null,
                react.createElement('span', { className: 'dsh-session-kit-task-item-meta' }, `${t('taskOperations')} ${item.opCount ?? 0} · ${t('taskPitfalls')} ${item.pitfallCount ?? 0}`),
                react.createElement('span', { className: 'dsh-session-kit-task-item-files' }, fillTemplate(t('taskItemFiles'), { read: item.files?.read ?? 0, written: item.files?.written ?? 0 })),
                react.createElement('button', {
                  type: 'button',
                  className: 'dsh-session-kit-task-item-expand',
                  'aria-expanded': itemExpanded,
                  'aria-label': t('taskItemExpand'),
                  title: t('taskItemExpand'),
                  onClick: () => toggleItemDetail(view.id, item)
                }, itemExpanded ? react.createElement(primitives.IconChevronUpOutlineRegular, { size: 14 }) : react.createElement(primitives.IconChevronDownOutlineRegular, { size: 14 }))
              ),
              itemExpanded ? react.createElement(
                'div',
                { className: 'dsh-session-kit-task-item-detail-panel' },
                itemState.loading === true
                  ? react.createElement('div', { className: 'dsh-session-kit-task-item-panel-status' }, react.createElement(primitives.IconLoadingOutlineRegular, { size: 14 }))
                  : itemState.error !== undefined
                    ? react.createElement('div', { className: 'dsh-session-kit-task-item-panel-status dsh-session-kit-task-op-error' }, itemState.error)
                    : (itemState.operations ?? []).length === 0 && (itemState.pitfalls ?? []).length === 0
                      ? react.createElement('div', { className: 'dsh-session-kit-task-item-panel-status' }, t('taskItemDetailEmpty'))
                      : react.createElement(
                        react.Fragment,
                        null,
                        renderOpsRows(itemState.operations),
                        (itemState.operations ?? []).length > TASK_DETAIL_OP_LIMIT
                          ? react.createElement('div', { className: 'dsh-session-kit-task-truncated-hint' }, fillTemplate(t('taskTruncatedHint'), { shown: TASK_DETAIL_OP_LIMIT, total: (itemState.operations ?? []).length }))
                          : null,
                        (itemState.pitfalls ?? []).length > 0 ? renderPitfallRows(itemState.pitfalls) : null
                      )
              ) : null
            );
          }),
          /* 操作明细：主行保持原样，objects（符号/命令/模式）以次要行补充。 */
          react.createElement('div', { className: 'dsh-session-kit-task-section-title' }, `${t('taskOperations')}（${(ops.operations ?? []).length}）`),
          renderOpsRows(ops.operations),
          /* 数量截断提示：超出上限时说明仅展示前 N 条，避免静默省略。 */
          (ops.operations ?? []).length > TASK_DETAIL_OP_LIMIT
            ? react.createElement('div', { className: 'dsh-session-kit-task-truncated-hint' }, fillTemplate(t('taskTruncatedHint'), { shown: TASK_DETAIL_OP_LIMIT, total: (ops.operations ?? []).length }))
            : null,
          (ops.pitfalls ?? []).length > 0 ? react.createElement('div', { className: 'dsh-session-kit-task-section-title' }, `${t('taskPitfalls')}（${ops.pitfalls.length}）`) : null,
          renderPitfallRows(ops.pitfalls),
          /* 上下文变更：需 include=context，后端已支持。 */
          Array.isArray(ops.contextMarks) && ops.contextMarks.length > 0
            ? react.createElement(react.Fragment, null,
              react.createElement('div', { className: 'dsh-session-kit-task-section-title' }, `${t('taskContextMarks')}（${ops.contextMarks.length}）`),
              ops.contextMarks.map((mark, index) => {
                const valueText = mark.prevValue ? `${mark.prevValue} → ${mark.value}` : (mark.value ?? '');
                return react.createElement(
                  'div',
                  { key: `ctx-${index}`, className: 'dsh-session-kit-task-context-mark' },
                  react.createElement('span', { className: 'dsh-session-kit-task-context-key', title: mark.key }, mark.key),
                  react.createElement('span', { className: 'dsh-session-kit-task-context-value', title: valueText }, valueText),
                  react.createElement('span', { className: 'dsh-session-kit-task-context-time' }, memoryFormatTime(mark.at))
                );
              }))
            : null,
          /* 涉及会话明细：轮次 + 首次/最近时间。 */
          Array.isArray(view.sessions) && view.sessions.length > 0
            ? react.createElement(react.Fragment, null,
              react.createElement('div', { className: 'dsh-session-kit-task-section-title' }, `${t('taskSessions')}（${view.sessions.length}）`),
              view.sessions.map((session) => {
                /* 优先显示会话标题（含归档），快照查不到时回退 id；悬浮始终显示完整 id。 */
                let title = '';
                try { title = session.title || taskSessionTitle(session.id) || ''; } catch { title = ''; }
                return react.createElement(
                  'div',
                  { key: session.id, className: 'dsh-session-kit-task-session-row' },
                  title ? react.createElement('span', { className: 'dsh-session-kit-task-session-id', title: title }, title) : null,
                  react.createElement('button', {
                    type: 'button',
                    className: `dsh-session-kit-task-session-copy${copiedTaskSessionId === session.id ? ' dsh-session-kit-task-session-copy-copied' : ''}`,
                    title: copiedTaskSessionId === session.id ? t('taskSessionIdCopied') : t('taskSessionCopyId'),
                    'aria-label': `${copiedTaskSessionId === session.id ? t('taskSessionIdCopied') : t('taskSessionCopyId')} ${session.id}`,
                    onClick: (event) => { event.stopPropagation(); void copyTaskSessionId(session.id); }
                  },
                    session.id,
                    copiedTaskSessionId === session.id ? react.createElement(primitives.IconCheckOutlineRegular, { size: 12, 'aria-hidden': true }) : null
                  ),
                  Array.isArray(session.turnRange) && (session.turnRange[0] !== null || session.turnRange[1] !== null)
                    ? react.createElement('span', { className: 'dsh-session-kit-task-session-turns' }, fillTemplate(t('taskSessionTurns'), { from: session.turnRange[0] ?? '?', to: session.turnRange[1] ?? '?' }))
                    : null,
                  react.createElement('span', { className: 'dsh-session-kit-task-session-time' }, `${memoryFormatTime(session.firstAt)} ~ ${memoryFormatTime(session.lastAt)}`)
                );
              }))
            : null
        );
      };

      return react.createElement(react.Fragment, null,
        react.createElement(primitives.Modal, {
        open,
        onClose: closeList,
        title: react.createElement(ModalTitleWithEntryToggle, {
          title: t('taskTitle'),
          visible: sidebarEntries?.taskVisible,
          onToggleVisible: (taskVisible) => updateSidebarEntries?.({ ...sidebarEntries, taskVisible }),
          label: t(sidebarEntries?.taskVisible === false ? 'taskHideSidebarEntry' : 'taskShowSidebarEntry'),
          hint: t('taskEntryToggleHint'),
          t
        }),
        closeLabel: t('archiveClose'),
        className: 'dsh-session-kit-task-modal',
        footer: react.createElement(
          'div',
          { className: 'dsh-session-kit-task-footer' },
          react.createElement(
            'div',
            { className: 'dsh-session-kit-task-footer-left' },
            /* 最左边：自动注入未完成任务开关（全局）。关闭后不再自动匹配注入。
               滑块外观沿用标题栏的 renderToggleSwitch；按钮尺寸与「关闭」一致（默认 md）。 */
            react.createElement(primitives.Tooltip, { label: t('taskAutoInjectHint'), side: 'top', delayMs: 500 },
              react.createElement(primitives.Button, {
                variant: 'outline',
                className: 'dsh-session-kit-entry-visibility-toggle',
                'aria-pressed': autoInject,
                'aria-label': t('taskAutoInject'),
                title: t('taskAutoInjectHint'),
                disabled: autoInjectBusy,
                onClick: () => void toggleAutoInject(!autoInject)
              }, renderToggleSwitch(autoInject), react.createElement('span', null, t('taskAutoInject')))
            ),
            /* 其右：从当前会话的 todo 提取任务档案（已有档案则去重不重复写入）。 */
            react.createElement(primitives.Button, {
              variant: 'outline',
              disabled: loading || extractBusy,
              title: t('taskExtractHint'),
              onClick: () => void extractFromSession()
            }, t('taskExtract'))
          ),
          react.createElement(primitives.Button, { variant: 'outline', disabled: loading, onClick: onClose }, t('archiveClose'))
        ),
        children: react.createElement(
          'div',
          { className: 'dsh-session-kit-task-root' },
          react.createElement(
            'div',
            { className: 'dsh-session-kit-task-toolbar' },
            react.createElement(
              'div',
              { className: 'dsh-session-kit-task-toolbar-left' },
              react.createElement(
                'div',
                { className: 'dsh-session-kit-task-filters', role: 'group', 'aria-label': t('taskTitle') },
                renderFilterButton('not_started', t('taskFilterNotStarted')),
                renderFilterButton('active', t('taskFilterActive')),
                renderFilterButton('paused', t('taskFilterPaused')),
                renderFilterButton('completed', t('taskFilterCompleted')),
                renderFilterButton('abandoned', t('taskFilterAbandoned')),
                renderFilterButton('all', t('taskFilterAll'))
              ),
              react.createElement(primitives.Button, { variant: 'outline', size: 'sm', className: 'dsh-session-kit-task-add-button', onClick: openCreate }, t('taskAdd'))
            ),
            react.createElement(
              'div',
              { className: 'dsh-session-kit-task-search-wrap' },
              react.createElement('input', {
                className: 'dsh-session-kit-task-search',
                type: 'search',
                value: search,
                placeholder: t('taskSearchPlaceholder'),
                'aria-label': t('taskSearchPlaceholder'),
                onChange: (event) => setSearch(event.target.value)
              }),
              search !== '' ? react.createElement('button', { type: 'button', className: 'dsh-session-kit-task-search-clear', 'aria-label': t('archiveSearchClear'), title: t('archiveSearchClear'), onClick: () => setSearch('') }, react.createElement(primitives.IconCloseOutlineRegular, { size: 14 })) : null
            ),
            react.createElement(primitives.Button, { variant: 'outline', size: 'sm', className: 'dsh-session-kit-task-trash-button', onClick: () => setTrashOpen(true) }, t('trashTitle')),
            react.createElement('span', { className: 'dsh-session-kit-task-result-count', 'aria-live': 'polite' }, String(total))
          ),
          filter === 'all' && statusStats !== null ? renderStatusChart() : null,
          error !== '' ? react.createElement('div', { role: 'alert', className: 'dsh-session-kit-task-error' }, error) : null,
          loading
            ? react.createElement('div', { className: 'dsh-session-kit-task-empty' }, '…')
            : visible.length === 0
              ? react.createElement('div', { className: 'dsh-session-kit-task-empty' }, t('taskEmpty'))
              : react.createElement(
                react.Fragment,
                null,
                react.createElement('div', { className: 'dsh-session-kit-task-list' }, visible.map(renderListItem)),
                taskPageCount > 1 && react.createElement(
                  'div',
                  { className: 'dsh-session-kit-memory-pagination' },
                  react.createElement(primitives.Button, { variant: 'outline', size: 'sm', disabled: page <= 0, onClick: () => setPage((value) => Math.max(0, value - 1)) }, t('taskPrevPage')),
                  react.createElement('span', { className: 'dsh-session-kit-memory-pagination-text' }, fillTemplate(t('taskPagination'), { page: page + 1, pages: taskPageCount, total })),
                  react.createElement(primitives.Button, { variant: 'outline', size: 'sm', disabled: page >= taskPageCount - 1, onClick: () => setPage((value) => Math.min(taskPageCount - 1, value + 1)) }, t('taskNextPage'))
                )
              )
        )
      }),
      react.createElement(primitives.Modal, {
        open: detailOpen,
        onClose: closeDetail,
        title: detail?.view?.name
          ? `${detail.view.name} · ${taskStatusLabel(t, detail.view.status)}`
          : t('taskDetailTitle'),
        closeLabel: t('archiveClose'),
        className: 'dsh-session-kit-task-detail-modal',
        footer: react.createElement(primitives.Button, { variant: 'outline', onClick: closeDetail }, t('taskBack')),
        children: renderDetail()
      }),
      react.createElement(primitives.Modal, {
        open: open && creating !== null,
        onClose: () => { if (!createBusy) setCreating(null); },
        title: t('taskAddTitle'),
        closeLabel: t('archiveClose'),
        className: 'dsh-session-kit-task-edit-modal',
        footer: react.createElement(
          react.Fragment,
          null,
          react.createElement(primitives.Button, { variant: 'outline', disabled: createBusy, onClick: () => setCreating(null) }, t('taskCancel')),
          react.createElement(primitives.Button, {
            variant: 'outline',
            disabled: createBusy || creating === null || creating.name.trim() === '' || createItems.length === 0,
            onClick: () => void saveCreate(),
            style: { color: 'var(--dsw-alias-state-business-primary)', borderColor: 'color-mix(in srgb, var(--dsw-alias-state-business-primary) 50%, transparent)' }
          }, t('taskSave'))
        ),
        children: creating === null ? null : react.createElement(
          'div',
          { className: 'dsh-session-kit-task-edit-fields' },
          /* 状态说明：新建默认为「未开始」，只有「进行中」参与自动注入。 */
          react.createElement('div', { className: 'dsh-session-kit-task-create-tip' },
            t('taskCreateStatusTip1'),
            react.createElement('br'),
            t('taskCreateStatusTip2')
          ),
          react.createElement(
            'div',
            { className: 'dsh-session-kit-task-edit-field' },
            react.createElement('label', { htmlFor: 'dsh-session-kit-task-create-name' }, t('taskNameLabel')),
            react.createElement('input', {
              id: 'dsh-session-kit-task-create-name',
              className: 'dsh-session-kit-task-edit-input',
              type: 'text',
              value: creating.name,
              disabled: createBusy,
              autoFocus: true,
              maxLength: 500,
              placeholder: t('taskNameLabel'),
              onChange: (event) => { const value = event.currentTarget.value; setCreating((current) => current && { ...current, name: value }); },
              onKeyDown: (event) => { if (event.key === 'Enter' && !createBusy) void saveCreate(); }
            })
          ),
          react.createElement(
            'div',
            { className: 'dsh-session-kit-task-edit-field' },
            react.createElement('label', { htmlFor: 'dsh-session-kit-task-create-summary' }, t('taskSummaryLabel')),
            react.createElement('textarea', {
              id: 'dsh-session-kit-task-create-summary',
              className: 'dsh-session-kit-task-edit-textarea',
              value: creating.summary,
              disabled: createBusy,
              maxLength: TASK_SUMMARY_MAX_LENGTH,
              rows: 4,
              placeholder: t('taskSummaryPlaceholder'),
              onChange: (event) => { const value = event.currentTarget.value; setCreating((current) => current && { ...current, summary: value }); }
            })
          ),
          /* 初始子任务：动态增删的输入行；留空的行提交时自动忽略。 */
          react.createElement(
            'div',
            { className: 'dsh-session-kit-task-edit-field' },
            react.createElement(
              'div',
              { className: 'dsh-session-kit-task-item-editor-head' },
              react.createElement('label', null, `${t('taskItemsLabel')}（${createItems.length}）`),
              /* 添加一行：与标签同行、靠右。 */
              react.createElement(primitives.Button, {
                variant: 'outline',
                size: 'sm',
                className: 'dsh-session-kit-task-item-editor-add',
                disabled: createBusy || (creating.items ?? []).length >= TASK_ITEM_INPUT_LIMIT,
                onClick: () => setCreating((current) => current && { ...current, items: [...current.items, ''] })
              }, t('taskItemAdd'))
            ),
            react.createElement(
              'div',
              { className: 'dsh-session-kit-task-item-editor' },
              (creating.items ?? []).map((item, index) => react.createElement(
                'div',
                { key: `item-${index}`, className: 'dsh-session-kit-task-item-editor-row' },
                react.createElement('input', {
                  className: 'dsh-session-kit-task-edit-input',
                  type: 'text',
                  value: item,
                  disabled: createBusy,
                  maxLength: 500,
                  placeholder: t('taskItemPlaceholder'),
                  'aria-label': `${t('taskItemsLabel')} ${index + 1}`,
                  onChange: (event) => {
                    const value = event.currentTarget.value;
                    setCreating((current) => current && {
                      ...current,
                      items: current.items.map((entry, i) => (i === index ? value : entry))
                    });
                  },
                  /* 回车：末行则追加新行，否则聚焦下一行，便于连续录入。 */
                  onKeyDown: (event) => {
                    if (event.key !== 'Enter' || createBusy) return;
                    event.preventDefault();
                    setCreating((current) => {
                      if (current === null) return current;
                      const list = [...current.items];
                      if (index === list.length - 1) list.push('');
                      return { ...current, items: list };
                    });
                  }
                }),
                react.createElement(primitives.Button, {
                  variant: 'outline',
                  size: 'sm',
                  className: 'dsh-session-kit-task-item-editor-remove',
                  disabled: createBusy,
                  title: t('taskItemRemove'),
                  'aria-label': t('taskItemRemove'),
                  onClick: () => setCreating((current) => {
                    if (current === null) return current;
                    const list = current.items.filter((entry, i) => i !== index);
                    /* 至少保留一行，避免无输入框可用。 */
                    return { ...current, items: list.length > 0 ? list : [''] };
                  })
                }, react.createElement(DeleteIcon, { size: 14 }))
              ))
            )
          )
        )
      }),
      react.createElement(primitives.Modal, {
        open: open && editing !== null,
        onClose: () => { if (!editBusy) setEditing(null); },
        title: t('taskEditTitle'),
        closeLabel: t('archiveClose'),
        className: 'dsh-session-kit-task-edit-modal',
        footer: react.createElement(
          react.Fragment,
          null,
          react.createElement(primitives.Button, { variant: 'outline', disabled: editBusy, onClick: () => setEditing(null) }, t('taskCancel')),
          react.createElement(primitives.Button, {
            variant: 'outline',
            disabled: editBusy || editing === null || editing.name.trim() === '',
            onClick: () => void saveEdit(),
            style: { color: 'var(--dsw-alias-state-business-primary)', borderColor: 'color-mix(in srgb, var(--dsw-alias-state-business-primary) 50%, transparent)' }
          }, t('taskSave'))
        ),
        children: editing === null ? null : react.createElement(
          'div',
          { className: 'dsh-session-kit-task-edit-fields' },
          react.createElement(
            'div',
            { className: 'dsh-session-kit-task-edit-field' },
            react.createElement('label', { htmlFor: 'dsh-session-kit-task-edit-name' }, t('taskNameLabel')),
            react.createElement('input', {
              id: 'dsh-session-kit-task-edit-name',
              className: 'dsh-session-kit-task-edit-input',
              type: 'text',
              value: editing.name,
              disabled: editBusy,
              autoFocus: true,
              maxLength: 500,
              onChange: (event) => { const value = event.currentTarget.value; setEditing((current) => current && { ...current, name: value }); },
              onKeyDown: (event) => { if (event.key === 'Enter' && !editBusy) void saveEdit(); }
            })
          ),
          react.createElement(
            'div',
            { className: 'dsh-session-kit-task-edit-field' },
            react.createElement('label', { htmlFor: 'dsh-session-kit-task-edit-status' }, t('taskStatusField')),
            react.createElement('select', {
              id: 'dsh-session-kit-task-edit-status',
              className: 'dsh-session-kit-task-edit-select',
              value: editing.status,
              disabled: editBusy,
              onChange: (event) => { const value = event.currentTarget.value; setEditing((current) => current && { ...current, status: value }); }
            },
              ['not_started', 'active', 'paused', 'completed', 'abandoned'].map((status) => react.createElement('option', { key: status, value: status }, taskStatusLabel(t, status)))
            )
          ),
          react.createElement(
            'div',
            { className: 'dsh-session-kit-task-edit-field' },
            react.createElement('label', { htmlFor: 'dsh-session-kit-task-edit-summary' }, t('taskSummaryLabel')),
            react.createElement('textarea', {
              id: 'dsh-session-kit-task-edit-summary',
              className: 'dsh-session-kit-task-edit-textarea',
              value: editing.summary,
              disabled: editBusy,
              maxLength: TASK_SUMMARY_MAX_LENGTH,
              rows: 4,
              placeholder: t('taskSummaryPlaceholder'),
              onChange: (event) => { const value = event.currentTarget.value; setEditing((current) => current && { ...current, summary: value }); }
            })
          )
        )
      }),
      react.createElement(DeleteConfirmDialog, {
        open: open && injectTarget !== null,
        t,
        danger: false,
        onCancel: () => { if (!injectBusy) setInjectTarget(null); },
        onConfirm: () => void confirmInject(),
        busy: injectBusy,
        title: t('taskInject'),
        message: fillTemplate(t('taskInjectConfirm'), { name: injectTarget?.name ?? '' }),
        confirmLabel: t('taskInject')
      }),
      react.createElement(DeleteConfirmDialog, {
        open: open && deleting !== null,
        t,
        onCancel: () => { if (!deleteBusy) setDeleting(null); },
        onConfirm: () => void confirmDelete(),
        busy: deleteBusy,
        title: t('taskDelete'),
        message: fillTemplate(t('taskDeleteConfirm'), { name: deleting?.name ?? '' }),
        confirmLabel: t('taskDelete')
      }),
      react.createElement(primitives.Modal, {
        open: trashOpen,
        onClose: () => { if (!trashBusy) setTrashOpen(false); },
        title: t('trashTitle'),
        className: 'dsh-session-kit-trash-modal',
        footer: react.createElement(primitives.Button, { variant: 'outline', disabled: trashBusy, onClick: () => setTrashOpen(false) }, t('archiveClose')),
        children: react.createElement(
          'div',
          { className: 'dsh-session-kit-task-root' },
          react.createElement(
            'div',
            { className: 'dsh-session-kit-task-search-wrap' },
            react.createElement('input', {
              className: 'dsh-session-kit-task-search',
              type: 'search',
              value: trashSearch,
              placeholder: t('trashSearchPlaceholder'),
              'aria-label': t('trashSearchPlaceholder'),
              onChange: (event) => setTrashSearch(event.target.value)
            }),
            trashSearch !== '' ? react.createElement('button', { type: 'button', className: 'dsh-session-kit-task-search-clear', 'aria-label': t('archiveSearchClear'), title: t('archiveSearchClear'), onClick: () => setTrashSearch('') }, react.createElement(primitives.IconCloseOutlineRegular, { size: 14 })) : null
          ),
          trashError !== '' ? react.createElement('div', { role: 'alert', className: 'dsh-session-kit-task-error' }, trashError) : null,
          trashNotice !== '' ? react.createElement('div', { className: 'dsh-session-kit-trash-notice' }, trashNotice) : null,
          trashLoading
            ? react.createElement('div', { className: 'dsh-session-kit-task-empty' }, t('trashLoading'))
            : trashItems.length === 0
              ? react.createElement('div', { className: 'dsh-session-kit-task-empty' }, trashDebouncedSearch !== '' ? t('trashSearchEmpty') : t('trashEmpty'))
              : react.createElement(
                react.Fragment,
                null,
                react.createElement('div', { className: 'dsh-session-kit-task-list' }, trashItems.map((task) => renderListItem(task, { trash: true }))),
                trashPageCount > 1 && react.createElement(
                  'div',
                  { className: 'dsh-session-kit-memory-pagination' },
                  react.createElement(primitives.Button, { variant: 'outline', size: 'sm', disabled: trashPage <= 0, onClick: () => setTrashPage((value) => Math.max(0, value - 1)) }, t('taskPrevPage')),
                  react.createElement('span', { className: 'dsh-session-kit-memory-pagination-text' }, fillTemplate(t('taskPagination'), { page: trashPage + 1, pages: trashPageCount, total: trashTotal })),
                  react.createElement(primitives.Button, { variant: 'outline', size: 'sm', disabled: trashPage >= trashPageCount - 1, onClick: () => setTrashPage((value) => Math.min(trashPageCount - 1, value + 1)) }, t('taskNextPage'))
                )
              )
        )
      }),
      react.createElement(DeleteConfirmDialog, {
        open: trashOpen && trashPurgeTarget !== null,
        t,
        busy: trashBusy,
        title: t('trashPurge'),
        message: fillTemplate(t('trashPurgeConfirm'), { name: trashPurgeTarget?.name ?? '' }),
        confirmLabel: t('trashPurge'),
        onCancel: () => { if (!trashBusy) setTrashPurgeTarget(null); },
        onConfirm: () => void trashConfirmPurge()
      })
      );
    }

    /* ── 回收站弹窗已内联在 TaskManagerDialog 中（复用 renderListItem 渲染完整卡片） ── */

    function SidebarTaskLauncher({ wide, t, useSessions, updateSidebarEntries }) {
      const sidebarEntries = useSidebarEntries();
      const [open, setOpen] = react.useState(false);
      const useSessionsSafe = typeof useSessions === 'function' ? useSessions : () => undefined;
      const sessions = useSessionsSafe((value) => value);
      /* 当前主会话：内核 0.1.7 的 list 快照无 current 字段，用 mainView 保留计数判定（官方同款）。 */
      const sessionId = String(Object.values(sessions?.byId ?? {}).find((session) => (session?.retainedBy?.mainView ?? 0) > 0)?.id ?? '');
      /* 会话快照（含归档）：任务详情的「涉及会话」用它把 id 显示为标题。 */
      const sessionTitleOf = react.useCallback((id) => String(sessions?.byId?.[id]?.displayTitle ?? ''), [sessions]);
      return react.createElement(
        react.Fragment,
        null,
        sidebarEntries.taskVisible === true && react.createElement(SidebarFooterButton, {
          wide,
          label: t('taskManage'),
          icon: react.createElement(TaskIcon, { size: wide ? 16 : 18 }),
          expanded: open,
          onClick: () => setOpen(true)
        }),
        react.createElement(TaskManagerDialog, {
          open,
          t,
          sessionId,
          getSessionTitle: sessionTitleOf,
          getSessionTitleMap: () => sessions?.byId ?? {},
          updateSidebarEntries,
          onClose: () => setOpen(false)
        })
      );
    }

    function SidebarArchiveLauncher({ wide, t, exporter, openSession, refreshWorkspaces, refreshSessions, renameCurrentSession, forkCurrentSession, updateSidebarEntries }) {
      const sidebarEntries = useSidebarEntries();
      const [open, setOpen] = react.useState(false);
      return react.createElement(
        react.Fragment,
        null,
        sidebarEntries.archiveVisible === true && react.createElement(SidebarFooterButton, {
          wide,
          label: t('archiveManage'),
          icon: react.createElement(ArchiveIcon, { size: wide ? 16 : 18 }),
          expanded: open,
          onClick: () => setOpen(true)
        }),
        react.createElement(ArchivedSessionsDialog, {
          open,
          t,
          onClose: () => setOpen(false),
          refreshWorkspaces,
          refreshSessions,
          openSession,
          exporter,
          renameCurrentSession,
          forkCurrentSession,
          updateSidebarEntries
        })
      );
    }

    function topicContentText(content) {
      if (!Array.isArray(content)) return '';
      return content.map((block) => block?.type === 'text' && typeof block.text === 'string' ? block.text : '').join('');
    }

    function activitySummaryText(value, maxLength = 180) {
      const text = String(value ?? '').replace(/\s+/g, ' ').trim();
      return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}…` : text;
    }

    function currentUserMessageText(snapshot) {
      const chat = snapshot?.chat ?? chatSnapshotFrom(snapshot) ?? snapshot;
      const order = Array.isArray(chat?.order) ? chat.order : [];
      const nodes = chat?.nodes;
      for (let index = order.length - 1; index >= 0; index -= 1) {
        const node = typeof nodes?.get === 'function' ? nodes.get(order[index]) : undefined;
        if (node?.kind !== 'user' && node?.kind !== 'steering') continue;
        const text = topicContentText(node.data?.content);
        if (text) return activitySummaryText(text);
      }
      const legacyNodes = Array.isArray(chat?.legacy?.nodes) ? chat.legacy.nodes : Array.isArray(snapshot?.nodes) ? snapshot.nodes : [];
      for (let index = legacyNodes.length - 1; index >= 0; index -= 1) {
        const node = legacyNodes[index];
        if (node?.kind !== 'user' && node?.kind !== 'steering') continue;
        const text = topicContentText(node.data?.content ?? node.content);
        if (text) return activitySummaryText(text);
      }
      if (typeof document !== 'undefined') {
        const rows = Array.from(document.querySelectorAll('[data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]'));
        for (let index = rows.length - 1; index >= 0; index -= 1) {
          const text = activitySummaryText(rows[index]?.textContent || '');
          if (text) return text;
        }
      }
      return '';
    }

    function normalizeTopicText(text) {
      return String(text ?? '').replace(/\s+/g, ' ').trim();
    }

    function topicRows() {
      return Array.from(document.querySelectorAll('[data-chat-anchor-key]')).filter((row) => row instanceof HTMLElement && !row.hidden && row.getClientRects().length > 0);
    }

    function rowForTopic(topic) {
      const key = typeof topic === 'string' ? topic : topic?.key;
      if (typeof key !== 'string' || key.length === 0) return null;
      for (const row of topicRows()) {
        if (row.dataset.chatAnchorKey === key) return row;
      }
      return null;
    }

    function topicScrollport(row) {
      return row?.closest('[data-conversation-scroll]') ?? document.querySelector('[data-conversation-scroll]') ?? document.scrollingElement ?? document.documentElement;
    }

    function sameTopicLayout(left, right) {
      return left.top === right.top && left.right === right.right && left.bottom === right.bottom && left.hidden === right.hidden;
    }

    function sameTopicKeys(left, right) {
      return Array.isArray(left) && left.length === right.length && left.every((key, index) => key === right[index]);
    }

    function computeTopicLayout(row) {
      const scrollport = topicScrollport(row);
      const rect = scrollport instanceof HTMLElement ? scrollport.getBoundingClientRect() : { top: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth };
      const composer = scrollport instanceof HTMLElement ? scrollport.querySelector('[data-composer-seat]') : null;
      const composerTop = composer instanceof HTMLElement ? composer.getBoundingClientRect().top : rect.bottom;
      return {
        top: Math.round(rect.top + Math.max(96, composerTop - rect.top) / 2),
        right: Math.max(11, Math.round(window.innerWidth - rect.right + 13)),
        bottom: 0,
        hidden: rect.width < 760
      };
    }

    function syncTopicNav(topics, setActiveKey, setLayout, setVisibleKeys, activeLockRef) {
      if (topics.length === 0) {
        setActiveKey(null);
        setVisibleKeys((current) => current.length === 0 ? current : []);
        setLayout((current) => sameTopicLayout(current, { top: current.top, right: current.right, bottom: current.bottom, hidden: true }) ? current : { ...current, hidden: true });
        return;
      }
      const rows = topics.map((topic) => ({ topic, row: rowForTopic(topic) })).filter((entry) => entry.row !== null);
      const visibleKeys = rows.map((entry) => entry.topic.key);
      setVisibleKeys((current) => sameTopicKeys(current, visibleKeys) ? current : visibleKeys);
      const firstRow = rows[0]?.row ?? null;
      const layout = computeTopicLayout(firstRow);
      setLayout((current) => sameTopicLayout(current, layout) ? current : layout);
      if (firstRow === null) {
        setActiveKey(null);
        return;
      }
      const locked = activeLockRef?.current;
      if (locked !== undefined && locked.until > performance.now() && rows.some((entry) => entry.topic.key === locked.key)) {
        setActiveKey(locked.key);
        return;
      }
      if (activeLockRef !== undefined) activeLockRef.current = undefined;
      const scrollport = topicScrollport(firstRow);
      const rect = scrollport instanceof HTMLElement ? scrollport.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
      const composer = scrollport instanceof HTMLElement ? scrollport.querySelector('[data-composer-seat]') : null;
      const bottom = composer instanceof HTMLElement ? Math.min(rect.bottom, composer.getBoundingClientRect().top) : rect.bottom;
      const focusY = rect.top + Math.max(1, bottom - rect.top) / 2;
      let next = rows[0]?.topic.key ?? topics[0].key;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const entry of rows) {
        const rowRect = entry.row.getBoundingClientRect();
        const center = (rowRect.top + rowRect.bottom) / 2;
        const distance = Math.abs(center - focusY);
        if (distance < bestDistance) {
          bestDistance = distance;
          next = entry.topic.key;
        }
      }
      setActiveKey(next);
    }

    function scrollTopOf(scrollport) {
      return scrollport === document.scrollingElement || scrollport === document.documentElement || scrollport === document.body ? window.scrollY : scrollport.scrollTop;
    }

    function scrollToTop(scrollport, top, behavior) {
      const scroll = { top: Math.max(0, Math.round(top)), behavior };
      if (scrollport === document.scrollingElement || scrollport === document.documentElement || scrollport === document.body) window.scrollTo(scroll);
      else scrollport.scrollTo(scroll);
    }

    function scrollTopicRowIntoView(row, behavior) {
      const scrollport = topicScrollport(row);
      if (!(scrollport instanceof HTMLElement)) {
        row.scrollIntoView({ block: 'center', behavior });
        return;
      }
      const scrollRect = scrollport === document.scrollingElement || scrollport === document.documentElement || scrollport === document.body
        ? { top: 0, bottom: window.innerHeight }
        : scrollport.getBoundingClientRect();
      const composer = scrollport.querySelector('[data-composer-seat]');
      const bottom = composer instanceof HTMLElement ? Math.min(scrollRect.bottom, composer.getBoundingClientRect().top) : scrollRect.bottom;
      const viewportHeight = Math.max(1, bottom - scrollRect.top);
      const rowRect = row.getBoundingClientRect();
      const targetTop = scrollTopOf(scrollport) + rowRect.top - scrollRect.top - Math.max(0, (viewportHeight - rowRect.height) / 2);
      scrollToTop(scrollport, targetTop, behavior);
    }

    function scrollToTopic(topic) {
      const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const behavior = reduceMotion ? 'auto' : 'smooth';
      let tries = 0;
      const attempt = () => {
        const row = rowForTopic(topic);
        if (row !== null) {
          scrollTopicRowIntoView(row, behavior);
          window.requestAnimationFrame(() => {
            const refreshed = rowForTopic(topic);
            if (refreshed !== null) scrollTopicRowIntoView(refreshed, 'auto');
          });
          return;
        }
        if (tries++ < 4) window.requestAnimationFrame(attempt);
      };
      attempt();
    }

    function headingScrollport() {
      return document.querySelector('[data-conversation-scroll]') ?? document.scrollingElement ?? document.documentElement;
    }

    function headingRowForNodeKey(nodeKey) {
      const key = String(nodeKey);
      const scrollport = headingScrollport();
      const roots = scrollport instanceof HTMLElement ? [scrollport, document] : [document];
      for (const root of roots) {
        for (const row of root.querySelectorAll('[data-chat-anchor-key]')) {
          if (!(row instanceof HTMLElement)) continue;
          if (row.dataset.chatAnchorKey === key && !row.hidden && row.getClientRects().length > 0) return row;
        }
      }
      return null;
    }

    function headingElementsForNodeKeys(nodeKeys = []) {
      const entries = [];
      const seenRows = new Set();
      for (const nodeKey of nodeKeys) {
        const row = headingRowForNodeKey(nodeKey);
        if (row === null || seenRows.has(row)) continue;
        seenRows.add(row);
        const levelIndexes = new Map();
        Array.from(row.querySelectorAll('h1, h2, h3')).forEach((heading) => {
          if (!(heading instanceof HTMLElement) || heading.hidden || heading.getClientRects().length === 0) return;
          const level = Number(heading.tagName.slice(1));
          if (!Number.isSafeInteger(level) || level < 1 || level > 3) return;
          const index = levelIndexes.get(level) ?? 0;
          levelIndexes.set(level, index + 1);
          entries.push({ heading, nodeKey: String(nodeKey), index, level });
        });
      }
      const preferredLevel = [1, 2, 3].find((level) => entries.some((entry) => entry.level === level));
      return preferredLevel === undefined ? [] : entries.filter((entry) => entry.level === preferredLevel);
    }

    function headingKeyForElement(heading, nodeKey, index, used) {
      const level = /^H[1-3]$/.test(heading.tagName) ? heading.tagName.toLowerCase() : 'h';
      const base = `dsh-heading-${encodeURIComponent(String(nodeKey))}-${level}-${String(index + 1)}`;
      let key = base;
      let suffix = 2;
      while (used.has(key)) key = `${base}-${String(suffix++)}`;
      heading.dataset.dshSessionKitHeadingKey = key;
      used.add(key);
      return key;
    }

    function collectHeadingTopics(t, nodeKeys) {
      const used = new Set();
      const result = [];
      headingElementsForNodeKeys(nodeKeys).forEach(({ heading, nodeKey, index, level }) => {
        const key = headingKeyForElement(heading, nodeKey, index, used);
        const fullTitle = normalizeTopicText(heading.textContent) || `${t('headingUntitled')} ${String(result.length + 1)}`;
        result.push({
          key,
          nodeKey,
          index,
          level,
          title: fullTitle.length > 64 ? `${fullTitle.slice(0, 64)}…` : fullTitle,
          fullTitle
        });
      });
      return result;
    }

    function headingForTopic(topic) {
      const key = typeof topic === 'string' ? topic : topic?.key;
      if (typeof key !== 'string' || key.length === 0) return null;
      const nodeKeys = typeof topic?.nodeKey === 'string' ? [topic.nodeKey] : [];
      const entries = headingElementsForNodeKeys(nodeKeys);
      for (const { heading } of entries) {
        if (heading.dataset.dshSessionKitHeadingKey === key) return heading;
      }
      return null;
    }

    function sameHeadingTopics(left, right) {
      return Array.isArray(left) && left.length === right.length && left.every((item, index) => item.key === right[index].key && item.nodeKey === right[index].nodeKey && item.index === right[index].index && item.level === right[index].level && item.fullTitle === right[index].fullTitle);
    }

    function activeTopicKeyFromViewport(topics) {
      if (!Array.isArray(topics) || topics.length === 0) return null;
      const rows = topics.map((topic) => ({ topic, row: rowForTopic(topic) })).filter((entry) => entry.row !== null);
      const firstRow = rows[0]?.row ?? null;
      if (firstRow === null) return null;
      const scrollport = topicScrollport(firstRow);
      const rect = scrollport instanceof HTMLElement ? scrollport.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
      const composer = scrollport instanceof HTMLElement ? scrollport.querySelector('[data-composer-seat]') : null;
      const bottom = composer instanceof HTMLElement ? Math.min(rect.bottom, composer.getBoundingClientRect().top) : rect.bottom;
      const focusY = rect.top + Math.max(1, bottom - rect.top) / 2;
      let next = rows[0].topic.key;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const entry of rows) {
        const rowRect = entry.row.getBoundingClientRect();
        const center = (rowRect.top + rowRect.bottom) / 2;
        const distance = Math.abs(center - focusY);
        if (distance < bestDistance) {
          bestDistance = distance;
          next = entry.topic.key;
        }
      }
      return next;
    }

    function headingNodeKeysForTopicLevel(order, nodes, topicKey) {
      if (typeof topicKey !== 'string' || topicKey.length === 0) return [];
      let start = -1;
      for (let index = 0; index < order.length; index += 1) {
        const key = order[index];
        const node = nodes.get(key);
        if (String(node?.key ?? key) === topicKey) {
          start = index;
          break;
        }
      }
      if (start < 0) return [];
      const result = [];
      for (let index = start; index < order.length; index += 1) {
        const key = order[index];
        const node = nodes.get(key);
        if (node === undefined) continue;
        if (index > start && node.kind === 'user') break;
        if (node.visibility === 'hidden') continue;
        result.push(String(node.key ?? key));
      }
      return result;
    }

    function sameHeadingLayout(left, right) {
      return left.top === right.top && left.left === right.left && left.hidden === right.hidden;
    }

    function computeHeadingLayout(row) {
      const scrollport = topicScrollport(row) ?? headingScrollport();
      const rect = scrollport instanceof HTMLElement ? scrollport.getBoundingClientRect() : { top: 0, left: 0, bottom: window.innerHeight, width: window.innerWidth };
      const composer = scrollport instanceof HTMLElement ? scrollport.querySelector('[data-composer-seat]') : null;
      const composerTop = composer instanceof HTMLElement ? composer.getBoundingClientRect().top : rect.bottom;
      return {
        top: Math.round(rect.top + Math.max(96, composerTop - rect.top) / 2),
        left: Math.max(11, Math.round(rect.left + 13)),
        hidden: rect.width < 760
      };
    }

    function syncHeadingNav(headings, setActiveKey, setLayout, setVisibleKeys, activeLockRef, scopeRows) {
      if (headings.length === 0) {
        setActiveKey(null);
        setVisibleKeys((current) => current.length === 0 ? current : []);
        setLayout((current) => sameHeadingLayout(current, { top: current.top, left: current.left, hidden: true }) ? current : { ...current, hidden: true });
        return;
      }
      const rows = headings.map((heading) => ({ heading, row: headingForTopic(heading) })).filter((entry) => entry.row !== null);
      const visibleKeys = rows.map((entry) => entry.heading.key);
      setVisibleKeys((current) => sameTopicKeys(current, visibleKeys) ? current : visibleKeys);
      const firstRow = rows[0]?.row ?? scopeRows?.[0] ?? null;
      const layout = computeHeadingLayout(firstRow);
      setLayout((current) => sameHeadingLayout(current, layout) ? current : layout);
      if (rows.length === 0) {
        setActiveKey(null);
        return;
      }
      const locked = activeLockRef?.current;
      if (locked !== undefined && locked.until > performance.now() && rows.some((entry) => entry.heading.key === locked.key)) {
        setActiveKey(locked.key);
        return;
      }
      if (activeLockRef !== undefined) activeLockRef.current = undefined;
      const scrollport = topicScrollport(firstRow);
      const rect = scrollport instanceof HTMLElement ? scrollport.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
      const composer = scrollport instanceof HTMLElement ? scrollport.querySelector('[data-composer-seat]') : null;
      const bottom = composer instanceof HTMLElement ? Math.min(rect.bottom, composer.getBoundingClientRect().top) : rect.bottom;
      const focusY = rect.top + Math.max(1, bottom - rect.top) / 2;
      let next = rows[0]?.heading.key ?? headings[0].key;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const entry of rows) {
        const rowRect = entry.row.getBoundingClientRect();
        const center = (rowRect.top + rowRect.bottom) / 2;
        const distance = Math.abs(center - focusY);
        if (distance < bestDistance) {
          bestDistance = distance;
          next = entry.heading.key;
        }
      }
      setActiveKey(next);
    }

    function scrollToHeading(topic) {
      const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const behavior = reduceMotion ? 'auto' : 'smooth';
      let tries = 0;
      const attempt = () => {
        const row = headingForTopic(topic);
        if (row !== null) {
          scrollTopicRowIntoView(row, behavior);
          window.requestAnimationFrame(() => {
            const refreshed = headingForTopic(topic);
            if (refreshed !== null) scrollTopicRowIntoView(refreshed, 'auto');
          });
          return;
        }
        if (tries++ < 4) window.requestAnimationFrame(attempt);
      };
      attempt();
    }

    const EMPTY_CHAT_ORDER = Object.freeze([]);
    const EMPTY_CHAT_NODES = Object.freeze(new Map());

    function chatSnapshotFrom(snapshot) {
      return snapshot?.order !== undefined || snapshot?.nodes !== undefined
        ? snapshot
        : snapshot?.views?.get?.('chat') ?? snapshot?.chat;
    }

    function selectChatOrderSnapshot(snapshot) {
      return chatSnapshotFrom(snapshot)?.order ?? EMPTY_CHAT_ORDER;
    }

    function selectChatNodesSnapshot(snapshot) {
      return chatSnapshotFrom(snapshot)?.nodes ?? EMPTY_CHAT_NODES;
    }

    function chooseChatHook(useChat, useConversation, useSession) {
      if (typeof useChat === 'function') return useChat;
      if (typeof useConversation === 'function') return useConversation;
      return useSession;
    }

    function useChatOrder(useChat, useConversation, useSession) {
      return chooseChatHook(useChat, useConversation, useSession)(selectChatOrderSnapshot, sameTopicKeys);
    }

    function useChatNodes(useChat, useConversation, useSession) {
      return chooseChatHook(useChat, useConversation, useSession)(selectChatNodesSnapshot);
    }

    function sameUserTurnTargets(left, right) {
      return Array.isArray(left) && left.length === right.length && left.every((item, index) => item.key === right[index].key && item.turn === right[index].turn && item.text === right[index].text);
    }

    function turnOfChatNode(node) {
      const location = node?.location;
      if ((location?.kind === 'turn' || location?.kind === 'step') && Number.isSafeInteger(location.turn?.turn)) return location.turn.turn;
      const turn = node?.data?.turn;
      return Number.isSafeInteger(turn) ? turn : undefined;
    }

    function userActionRowForKey(key) {
      for (const row of document.querySelectorAll('[data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]')) {
        if (!(row instanceof HTMLElement)) continue;
        if (row.dataset.chatFlowKey === key || row.dataset.chatAnchorKey === key) return row;
      }
      return null;
    }

    function userActionHostParent(row, host) {
      const buttons = Array.from(row.querySelectorAll('button')).filter((button) => button instanceof HTMLElement && !host.contains(button));
      for (const button of buttons) {
        const parent = button.closest('div');
        if (parent instanceof HTMLElement && row.contains(parent)) return parent;
      }
      return null;
    }

    function samePortalTargets(left, right) {
      return left.length === right.length && left.every((item, index) => item.key === right[index].key && item.turn === right[index].turn && item.promptSeq === right[index].promptSeq && item.text === right[index].text && item.host === right[index].host);
    }

    function UserTurnActionsLayer({ useSession, useConversation, useChat, sessionId, delTurn, regenerateTurn, editRegenerateTurn, distillTurn, t }) {
      const order = useChatOrder(useChat, useConversation, useSession);
      const nodes = useChatNodes(useChat, useConversation, useSession);
      const targets = react.useMemo(() => {
        const result = [];
        for (const key of order) {
          const node = nodes.get(key);
          if (node?.kind !== 'user' && node?.kind !== 'steering') continue;
          const turn = turnOfChatNode(node);
          if (!Number.isSafeInteger(turn)) continue;
          /* anchorSeq 是内核 user 节点的提问事件序号，服务端据此在一轮多条提问时
             精确定位被点击的那一条。 */
          const promptSeq = Number.isSafeInteger(node.anchorSeq) ? node.anchorSeq : undefined;
          result.push({ key: String(node.key ?? key), turn, promptSeq, text: topicContentText(node.data?.content) });
        }
        return result;
      }, [order, nodes]);
      const targetSig = react.useMemo(() => targets.map((target) => `${target.key}:${target.turn}:${target.promptSeq}:${target.text}`).join('\n'), [targets]);
      const hosts = react.useRef(new Map());
      const [portalTargets, setPortalTargets] = react.useState([]);
      useTopicLayoutEffect(() => {
        if (typeof document === 'undefined' || !sessionId || typeof delTurn !== 'function' || typeof regenerateTurn !== 'function' || typeof editRegenerateTurn !== 'function' || typeof distillTurn !== 'function') return;
        let active = true;
        let frame = 0;
        const reconcile = () => {
          frame = 0;
          if (!active) return;
          const next = [];
          const seen = new Set();
          const domRows = Array.from(document.querySelectorAll('[data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]')).filter((row) => row instanceof HTMLElement);
           const domTargets = domRows.map((row, index) => {
             const turn = Number(row.dataset.chatTurn);
             if (!Number.isSafeInteger(turn)) return null;
             const key = row.dataset.chatFlowKey || row.dataset.chatAnchorKey || row.dataset.chatNodeKey || `dsh-user-turn-${turn}-${index}`;
             /* 用 key 精确匹配快照节点，而不是用 turn 撞第一条：一轮有多条提问时，
                后者会让两行按钮拿到同一条文本与同一个 seq。 */
             const snapshotTarget = targets.find((item) => item.key === String(key)) ?? targets.find((item) => item.turn === turn);
             return { key: String(key), turn, promptSeq: snapshotTarget?.promptSeq, text: snapshotTarget?.text ?? '' };
           }).filter(Boolean);
           const actionTargets = domTargets.length > 0 ? domTargets : targets;
           for (const target of actionTargets) {
            const row = userActionRowForKey(target.key) ?? domRows.find((item) => Number(item.dataset.chatTurn) === target.turn) ?? null;
            let record = hosts.current.get(target.key);
            if (record === undefined) {
              const host = document.createElement('span');
              host.dataset.dshUserTurnActions = target.key;
              host.style.display = 'contents';
              record = { host, turn: target.turn, promptSeq: target.promptSeq, text: target.text };
              hosts.current.set(target.key, record);
            } else {
              record.turn = target.turn;
              record.promptSeq = target.promptSeq;
              record.text = target.text;
            }
            const parent = row === null ? null : (userActionHostParent(row, record.host) ?? row);
            if (parent === null) {
              record.host.remove();
              continue;
            }
            if (record.host.parentElement !== parent) parent.appendChild(record.host);
            next.push({ key: target.key, turn: target.turn, promptSeq: target.promptSeq, text: target.text, host: record.host });
            seen.add(target.key);
          }
          for (const [key, record] of hosts.current) {
            if (seen.has(key)) continue;
            record.host.remove();
            hosts.current.delete(key);
          }
          setPortalTargets((current) => samePortalTargets(current, next) ? current : next);
        };
        const schedule = () => {
          if (frame !== 0) return;
          frame = window.requestAnimationFrame(reconcile);
        };
        const observer = new MutationObserver(schedule);
        observer.observe(document.body, { childList: true, subtree: true });
        schedule();
        return () => {
          active = false;
          if (frame !== 0) window.cancelAnimationFrame(frame);
          observer.disconnect();
          for (const record of hosts.current.values()) record.host.remove();
          hosts.current.clear();
          setPortalTargets([]);
        };
      }, [targetSig, sessionId, delTurn, regenerateTurn, editRegenerateTurn, distillTurn]);
      if (portalTargets.length === 0) return null;
      return react.createElement(
        react.Fragment,
        null,
        portalTargets.map((target) => reactDom.createPortal(react.createElement(
          react.Fragment,
          null,
          react.createElement(EditRegenerateAction, { turn: target.turn, text: target.text, promptSeq: target.promptSeq, editRegenerateTurn, useSession, t }),
          react.createElement(RegenerateAction, { turn: target.turn, promptSeq: target.promptSeq, regenerateTurn, useSession, t }),
          react.createElement(DistillTurnAction, { turn: target.turn, distillTurn, useSession, t }),
          react.createElement(TurnsDelAction, { turn: target.turn, delTurn, useSession, t })
        ), target.host, target.key))
      );
    }

    function TopicQuickNav({ useSession, useConversation, useChat, sessionId, loadOlder, t }) {
      const order = useChatOrder(useChat, useConversation, useSession);
      const nodes = useChatNodes(useChat, useConversation, useSession);
      const hasMore = useSession((snapshot) => snapshot.hasMore);
      const loadingOlder = useSession((snapshot) => snapshot.loadingOlder);
      const topics = react.useMemo(() => {
        const result = [];
        for (const key of order) {
          const node = nodes.get(key);
          if (node?.kind !== 'user' || node.visibility === 'hidden') continue;
          const topicKey = String(node.key ?? key);
          const fullTitle = normalizeTopicText(topicContentText(node.data?.content));
          const fallback = `${t('topicUntitled')} ${String(result.length + 1)}`;
          const title = fullTitle || fallback;
          result.push({
            key: topicKey,
            title: title.length > 64 ? `${title.slice(0, 64)}…` : title,
            fullTitle: title
          });
        }
        return result;
      }, [order, nodes, t]);
      const [activeKey, setActiveKey] = react.useState(null);
      const [layout, setLayout] = react.useState({ top: 96, right: 22, bottom: 150, hidden: true });
      const [visibleKeys, setVisibleKeys] = react.useState([]);
      const [panelOpen, setPanelOpen] = react.useState(false);
      const [panelScrollbar, setPanelScrollbar] = react.useState({ visible: false, top: 0, height: 0 });
      const [panelScrollState, setPanelScrollState] = react.useState({ atTop: true, atBottom: true, scrollable: false });
      const [autoLoadOlderTick, setAutoLoadOlderTick] = react.useState(0);
      const panelListRef = react.useRef(null);
      const topicsRef = react.useRef(topics);
      const activeLockRef = react.useRef(undefined);
      const loadOlderTriggerRef = react.useRef(0);
      const loadOlderInFlightRef = react.useRef(false);
      const loadOlderReleaseTimerRef = react.useRef(0);
      const autoLoadOlderRoundsRef = react.useRef(0);
      const autoLoadOlderTimerRef = react.useRef(0);
      const wheelEndTimerRef = react.useRef(0);
      topicsRef.current = topics;
      const topicSig = react.useMemo(() => topics.map((topic) => topic.key).join('\n'), [topics]);
      react.useEffect(() => {
        if (!loadingOlder) return;
        loadOlderInFlightRef.current = true;
      }, [loadingOlder]);
      react.useEffect(() => () => {
        window.clearTimeout(loadOlderReleaseTimerRef.current);
        window.clearTimeout(autoLoadOlderTimerRef.current);
        window.clearTimeout(wheelEndTimerRef.current);
      }, []);
      react.useEffect(() => {
        autoLoadOlderRoundsRef.current = 0;
        loadOlderInFlightRef.current = false;
        window.clearTimeout(autoLoadOlderTimerRef.current);
        window.clearTimeout(loadOlderReleaseTimerRef.current);
      }, [sessionId]);
      const triggerLoadOlder = react.useCallback((force = false) => {
        if (!hasMore || loadingOlder || loadOlderInFlightRef.current || typeof loadOlder !== 'function') return false;
        const now = performance.now();
        if (!force && loadOlderTriggerRef.current > now) return false;
        loadOlderTriggerRef.current = now + 600;
        loadOlderInFlightRef.current = true;
        window.clearTimeout(loadOlderReleaseTimerRef.current);
        Promise.resolve()
          .then(() => loadOlder())
          .catch(() => undefined)
          .finally(() => {
            window.clearTimeout(loadOlderReleaseTimerRef.current);
            loadOlderReleaseTimerRef.current = window.setTimeout(() => {
              loadOlderInFlightRef.current = false;
              setAutoLoadOlderTick((value) => value + 1);
            }, 300);
          });
        return true;
      }, [hasMore, loadingOlder, loadOlder]);
      react.useEffect(() => {
        if (topics.length > 0 || !hasMore || loadingOlder || loadOlderInFlightRef.current || typeof loadOlder !== 'function') {
          if (topics.length > 0 || !hasMore) autoLoadOlderRoundsRef.current = 0;
          window.clearTimeout(autoLoadOlderTimerRef.current);
          return;
        }
        if (autoLoadOlderRoundsRef.current >= TOPIC_NAV_AUTO_LOAD_OLDER_MAX_ROUNDS) return;
        window.clearTimeout(autoLoadOlderTimerRef.current);
        autoLoadOlderTimerRef.current = window.setTimeout(() => {
          if (topicsRef.current.length > 0 || autoLoadOlderRoundsRef.current >= TOPIC_NAV_AUTO_LOAD_OLDER_MAX_ROUNDS) return;
          const started = triggerLoadOlder(true);
          if (started) autoLoadOlderRoundsRef.current += 1;
        }, TOPIC_NAV_AUTO_LOAD_OLDER_DELAY_MS);
        return () => window.clearTimeout(autoLoadOlderTimerRef.current);
      }, [topics.length, hasMore, loadingOlder, loadOlder, triggerLoadOlder, autoLoadOlderTick]);
      const scrollPanelToTop = react.useCallback(() => {
        const list = panelListRef.current;
        if (list instanceof HTMLElement) list.scrollTo({ top: 0, behavior: 'smooth' });
      }, []);
      const scrollPanelToBottom = react.useCallback(() => {
        const list = panelListRef.current;
        if (list instanceof HTMLElement) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
      }, []);
      const handleTopicArrowUp = react.useCallback(() => {
        const list = panelListRef.current;
        if (!(list instanceof HTMLElement)) return;
        if (list.scrollTop > 1) {
          scrollPanelToTop();
          return;
        }
        triggerLoadOlder();
      }, [scrollPanelToTop, triggerLoadOlder]);
      const updatePanelScrollbar = react.useCallback(() => {
        const list = panelListRef.current;
        if (!(list instanceof HTMLElement) || list.scrollHeight <= list.clientHeight + 1) {
          setPanelScrollbar((current) => current.visible === false ? current : { visible: false, top: 0, height: 0 });
          setPanelScrollState((current) => current.atTop && current.atBottom && !current.scrollable ? current : { atTop: true, atBottom: true, scrollable: false });
          return;
        }
        const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
        const atTop = list.scrollTop <= 1;
        const atBottom = maxScrollTop - list.scrollTop <= 1;
        setPanelScrollState((current) => current.atTop === atTop && current.atBottom === atBottom && current.scrollable === true ? current : { atTop, atBottom, scrollable: true });
        const trackInset = 9;
        const trackHeight = Math.max(24, list.clientHeight - trackInset * 2);
        const height = Math.min(trackHeight, Math.max(24, Math.round(trackHeight * list.clientHeight / list.scrollHeight)));
        const top = Math.round(list.offsetTop + trackInset + (trackHeight - height) * list.scrollTop / Math.max(1, list.scrollHeight - list.clientHeight));
        const next = { visible: true, top, height };
        setPanelScrollbar((current) => current.visible === next.visible && current.top === next.top && current.height === next.height ? current : next);
      }, []);
      react.useEffect(() => {
        if (typeof document === 'undefined' || !panelOpen) return;
        if (activeKey === null || activeKey === undefined) return;
        const locked = activeLockRef.current;
        const panelFollowPaused = locked !== undefined && locked.until > performance.now();
        if (!panelFollowPaused) {
          const button = document.querySelector(`.dsh-session-kit-topic-panel-button[data-topic-key="${CSS.escape(String(activeKey))}"]`);
          const list = panelListRef.current;
          if (button instanceof HTMLElement && list instanceof HTMLElement) {
            const buttonRect = button.getBoundingClientRect();
            const listRect = list.getBoundingClientRect();
            const buttonCenter = (buttonRect.top + buttonRect.bottom) / 2;
            const listCenter = (listRect.top + listRect.bottom) / 2;
            list.scrollTo({ top: Math.max(0, Math.round(list.scrollTop + buttonCenter - listCenter)), behavior: 'auto' });
          }
        }
        window.requestAnimationFrame(updatePanelScrollbar);
      }, [activeKey, panelOpen, updatePanelScrollbar]);
      react.useEffect(() => {
        if (!panelOpen) {
          setPanelScrollbar((current) => current.visible === false ? current : { visible: false, top: 0, height: 0 });
          return;
        }
        const list = panelListRef.current;
        if (!(list instanceof HTMLElement)) return;
        updatePanelScrollbar();
        const onScroll = () => updatePanelScrollbar();
        const onWheel = (event) => {
          const upward = event.deltaY < 0;
          if (upward && list.scrollTop <= 1) event.preventDefault();
          window.clearTimeout(wheelEndTimerRef.current);
          wheelEndTimerRef.current = window.setTimeout(() => {
            if (!upward || list.scrollTop > 1) return;
            triggerLoadOlder();
          }, 100);
        };
        list.addEventListener('scroll', onScroll, { passive: true });
        list.addEventListener('wheel', onWheel, { passive: false });
        let observer = null;
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(updatePanelScrollbar);
          observer.observe(list);
        }
        return () => {
          list.removeEventListener('scroll', onScroll);
          list.removeEventListener('wheel', onWheel);
          window.clearTimeout(wheelEndTimerRef.current);
          observer?.disconnect();
        };
      }, [panelOpen, updatePanelScrollbar, triggerLoadOlder]);
      useTopicLayoutEffect(() => {
        if (typeof document === 'undefined') return;
        let frame = 0;
        let scrollports = [];
        let resizeObserver = null;
        const run = () => {
          frame = 0;
          syncTopicNav(topicsRef.current, setActiveKey, setLayout, setVisibleKeys, activeLockRef);
        };
        const schedule = () => {
          if (frame !== 0) return;
          frame = window.requestAnimationFrame(run);
        };
        const bindScrollports = () => {
          const next = Array.from(document.querySelectorAll('[data-conversation-scroll]')).filter((item) => item instanceof HTMLElement);
          if (next.length === scrollports.length && next.every((item, index) => item === scrollports[index])) return;
          for (const item of scrollports) item.removeEventListener('scroll', schedule);
          resizeObserver?.disconnect();
          resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
          scrollports = next;
          for (const item of scrollports) {
            item.addEventListener('scroll', schedule, { passive: true });
            resizeObserver?.observe(item);
            const composer = item.querySelector('[data-composer-seat]');
            if (composer instanceof HTMLElement) resizeObserver?.observe(composer);
          }
        };
        bindScrollports();
        schedule();
        const observer = new MutationObserver(() => {
          bindScrollports();
          schedule();
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'data-chat-anchor-key'] });
        window.addEventListener('resize', schedule, { passive: true });
        return () => {
          if (frame !== 0) window.cancelAnimationFrame(frame);
          observer.disconnect();
          resizeObserver?.disconnect();
          window.removeEventListener('resize', schedule);
          for (const item of scrollports) item.removeEventListener('scroll', schedule);
        };
      }, [topicSig]);
      const visibleKeySet = react.useMemo(() => new Set(visibleKeys), [visibleKeys]);
      const visibleTopics = react.useMemo(() => topics.filter((topic) => visibleKeySet.has(topic.key)), [topics, visibleKeySet]);
      const markerTopics = react.useMemo(() => {
        const windowSize = 10;
        if (visibleTopics.length <= windowSize) return visibleTopics;
        const activeIndex = Math.max(0, visibleTopics.findIndex((topic) => topic.key === activeKey));
        const start = Math.min(Math.max(0, activeIndex - 4), Math.max(0, visibleTopics.length - windowSize));
        return visibleTopics.slice(start, start + windowSize);
      }, [visibleTopics, activeKey]);
      const showTopicArrowUp = loadingOlder || hasMore || panelScrollState.scrollable;
      const showTopicArrowDown = panelScrollState.scrollable;
      const showTopicPanelControls = showTopicArrowUp || showTopicArrowDown;
      const renderTopicArrowUp = () => showTopicArrowUp && react.createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-session-kit-topic-panel-control dsh-session-kit-topic-panel-control-up',
          disabled: loadingOlder || (!hasMore && panelScrollState.atTop),
          'data-loading': loadingOlder || undefined,
          'aria-label': loadingOlder ? t('topicLoadingOlder') : (panelScrollState.atTop ? t('topicLoadOlder') : t('topicBackToTop')),
          title: loadingOlder ? t('topicLoadingOlder') : (panelScrollState.atTop ? t('topicLoadOlder') : t('topicBackToTop')),
          onClick: handleTopicArrowUp
        },
        loadingOlder ? react.createElement(primitives.IconLoadingOutlineRegular, {}) : react.createElement(primitives.IconChevronUpOutlineRegular, { size: 16 })
      );
      const renderTopicArrowDown = () => showTopicArrowDown && react.createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-session-kit-topic-panel-control dsh-session-kit-topic-panel-control-down',
          disabled: panelScrollState.atBottom,
          'aria-label': t('topicBackToBottom'),
          title: t('topicBackToBottom'),
          onClick: scrollPanelToBottom
        },
        react.createElement(primitives.IconChevronDownOutlineRegular, { size: 16 })
      );
      if (typeof document === 'undefined' || visibleTopics.length === 0 || layout.hidden) return null;
      return reactDom.createPortal(
        react.createElement(
          'aside',
          {
            className: 'dsh-session-kit-topic-nav-host',
            style: { top: layout.top, right: layout.right },
            'aria-label': t('topicNav'),
            'data-open': panelOpen || undefined,
            onFocus: () => setPanelOpen(true),
            onBlur: (event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setPanelOpen(false);
            }
          },
          react.createElement(
            'nav',
            { className: 'dsh-session-kit-topic-nav' },
            react.createElement('div', { className: 'dsh-session-kit-topic-title' }, t('topics')),
            !panelOpen && react.createElement(
              'ol',
              {
                className: 'dsh-session-kit-topic-marker-list',
                'aria-hidden': true,
                onMouseEnter: () => setPanelOpen(true)
              },
              markerTopics.map((topic) => react.createElement(
                'li',
                { key: topic.key, className: 'dsh-session-kit-topic-marker-item', 'data-topic-key': topic.key },
                react.createElement('span', {
                  className: 'dsh-session-kit-topic-marker',
                  'data-active': topic.key === activeKey || undefined
                })
              ))
            ),
            react.createElement(
              'div',
              { className: 'dsh-session-kit-topic-panel', onMouseLeave: () => { activeLockRef.current = undefined; setPanelOpen(false); } },
              showTopicPanelControls && react.createElement(
                'div',
                { className: 'dsh-session-kit-topic-panel-controls' },
                renderTopicArrowUp(),
                renderTopicArrowDown()
              ),
              react.createElement(
                'ol',
                { className: 'dsh-session-kit-topic-panel-list', ref: panelListRef },
                visibleTopics.map((topic) => react.createElement(
                  'li',
                  { key: topic.key, className: 'dsh-session-kit-topic-panel-item' },
                  react.createElement(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-session-kit-topic-panel-button',
                      'aria-label': `${t('topicJump')}: ${topic.fullTitle}`,
                      'aria-current': topic.key === activeKey ? 'location' : undefined,
                      'data-topic-key': topic.key,
                      'data-active': topic.key === activeKey || undefined,
                      onClick: () => {
                        activeLockRef.current = { key: topic.key, until: performance.now() + 1000 };
                        setActiveKey(topic.key);
                        scrollToTopic(topic);
                      }
                    },
                    react.createElement('span', { className: 'dsh-session-kit-topic-panel-text', title: topic.fullTitle }, topic.fullTitle),
                    react.createElement('span', { className: 'dsh-session-kit-topic-panel-marker', 'data-active': topic.key === activeKey || undefined }, null)
                  )
                ))
              ),
              showTopicPanelControls && react.createElement(
                'div',
                { className: 'dsh-session-kit-topic-panel-controls dsh-session-kit-topic-panel-controls-bottom' },
                renderTopicArrowDown(),
                renderTopicArrowUp()
              ),
              panelScrollbar.visible && react.createElement('span', {
                className: 'dsh-session-kit-topic-panel-scrollbar',
                style: { top: panelScrollbar.top, height: panelScrollbar.height },
                'aria-hidden': true
              })
            )
          )
        ),
        document.body
      );
    }

    function HeadingQuickNav({ useSession, useConversation, useChat, sessionId, t }) {
      const order = useChatOrder(useChat, useConversation, useSession);
      const nodes = useChatNodes(useChat, useConversation, useSession);
      const topics = react.useMemo(() => {
        const result = [];
        for (const key of order) {
          const node = nodes.get(key);
          if (node?.kind !== 'user' || node.visibility === 'hidden') continue;
          result.push({ key: String(node.key ?? key) });
        }
        return result;
      }, [order, nodes]);
      const topicSig = react.useMemo(() => topics.map((topic) => topic.key).join('\n'), [topics]);
      const [activeTopicKey, setActiveTopicKey] = react.useState(null);
      const headingNodeKeys = react.useMemo(() => headingNodeKeysForTopicLevel(order, nodes, activeTopicKey), [order, nodes, activeTopicKey]);
      const headingNodeSig = react.useMemo(() => `${activeTopicKey ?? ''}\n${headingNodeKeys.join('\n')}`, [activeTopicKey, headingNodeKeys]);
      const [headings, setHeadings] = react.useState([]);
      const [activeKey, setActiveKey] = react.useState(null);
      const [layout, setLayout] = react.useState({ top: 96, left: 22, hidden: true });
      const [visibleKeys, setVisibleKeys] = react.useState([]);
      const [panelOpen, setPanelOpen] = react.useState(false);
      const [panelScrollbar, setPanelScrollbar] = react.useState({ visible: false, top: 0, height: 0 });
      const [panelScrollState, setPanelScrollState] = react.useState({ atTop: true, atBottom: true, scrollable: false });
      const panelListRef = react.useRef(null);
      const headingHostRef = react.useRef(null);
      const headingsRef = react.useRef(headings);
      const activeLockRef = react.useRef(undefined);
      const wheelEndTimerRef = react.useRef(0);
      headingsRef.current = headings;
      react.useEffect(() => () => {
        window.clearTimeout(wheelEndTimerRef.current);
      }, []);
      const scrollPanelToTop = react.useCallback(() => {
        const list = panelListRef.current;
        if (list instanceof HTMLElement) list.scrollTo({ top: 0, behavior: 'smooth' });
      }, []);
      const scrollPanelToBottom = react.useCallback(() => {
        const list = panelListRef.current;
        if (list instanceof HTMLElement) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
      }, []);
      const updatePanelScrollbar = react.useCallback(() => {
        const list = panelListRef.current;
        if (!(list instanceof HTMLElement) || list.scrollHeight <= list.clientHeight + 1) {
          setPanelScrollbar((current) => current.visible === false ? current : { visible: false, top: 0, height: 0 });
          setPanelScrollState((current) => current.atTop && current.atBottom && !current.scrollable ? current : { atTop: true, atBottom: true, scrollable: false });
          return;
        }
        const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
        const atTop = list.scrollTop <= 1;
        const atBottom = maxScrollTop - list.scrollTop <= 1;
        setPanelScrollState((current) => current.atTop === atTop && current.atBottom === atBottom && current.scrollable === true ? current : { atTop, atBottom, scrollable: true });
        const trackInset = 9;
        const trackHeight = Math.max(24, list.clientHeight - trackInset * 2);
        const height = Math.min(trackHeight, Math.max(24, Math.round(trackHeight * list.clientHeight / list.scrollHeight)));
        const top = Math.round(list.offsetTop + trackInset + (trackHeight - height) * list.scrollTop / Math.max(1, list.scrollHeight - list.clientHeight));
        const next = { visible: true, top, height };
        setPanelScrollbar((current) => current.visible === next.visible && current.top === next.top && current.height === next.height ? current : next);
      }, []);
      react.useEffect(() => {
        if (typeof document === 'undefined' || !panelOpen) return;
        if (activeKey === null || activeKey === undefined) return;
        const locked = activeLockRef.current;
        const panelFollowPaused = locked !== undefined && locked.until > performance.now();
        if (!panelFollowPaused) {
          const button = document.querySelector(`.dsh-session-kit-heading-panel-button[data-heading-key="${CSS.escape(String(activeKey))}"]`);
          const list = panelListRef.current;
          if (button instanceof HTMLElement && list instanceof HTMLElement) {
            const buttonRect = button.getBoundingClientRect();
            const listRect = list.getBoundingClientRect();
            const buttonCenter = (buttonRect.top + buttonRect.bottom) / 2;
            const listCenter = (listRect.top + listRect.bottom) / 2;
            list.scrollTo({ top: Math.max(0, Math.round(list.scrollTop + buttonCenter - listCenter)), behavior: 'auto' });
          }
        }
        window.requestAnimationFrame(updatePanelScrollbar);
      }, [activeKey, panelOpen, updatePanelScrollbar]);
      react.useEffect(() => {
        if (!panelOpen) {
          setPanelScrollbar((current) => current.visible === false ? current : { visible: false, top: 0, height: 0 });
          return;
        }
        const list = panelListRef.current;
        if (!(list instanceof HTMLElement)) return;
        updatePanelScrollbar();
        const onScroll = () => updatePanelScrollbar();
        const onWheel = () => {
          window.clearTimeout(wheelEndTimerRef.current);
          wheelEndTimerRef.current = window.setTimeout(updatePanelScrollbar, 80);
        };
        list.addEventListener('scroll', onScroll, { passive: true });
        list.addEventListener('wheel', onWheel, { passive: true });
        let observer = null;
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(updatePanelScrollbar);
          observer.observe(list);
        }
        return () => {
          list.removeEventListener('scroll', onScroll);
          list.removeEventListener('wheel', onWheel);
          window.clearTimeout(wheelEndTimerRef.current);
          observer?.disconnect();
        };
      }, [panelOpen, updatePanelScrollbar]);
      useTopicLayoutEffect(() => {
        if (typeof document === 'undefined') return;
        let frame = 0;
        let scrollports = [];
        let resizeObserver = null;
        const run = () => {
          frame = 0;
          const host = headingHostRef.current;
          if (!(host instanceof HTMLElement) || !host.matches(':hover')) setPanelOpen(false);
          const topicKey = activeTopicKeyFromViewport(topics);
          setActiveTopicKey((current) => current === topicKey ? current : topicKey);
          const scopedNodeKeys = headingNodeKeysForTopicLevel(order, nodes, topicKey);
          const scopeRows = scopedNodeKeys.map((key) => headingRowForNodeKey(key)).filter((row) => row !== null);
          const next = collectHeadingTopics(t, scopedNodeKeys);
          headingsRef.current = next;
          setHeadings((current) => sameHeadingTopics(current, next) ? current : next);
          syncHeadingNav(next, setActiveKey, setLayout, setVisibleKeys, activeLockRef, scopeRows);
        };
        const schedule = () => {
          if (frame !== 0) return;
          frame = window.requestAnimationFrame(run);
        };
        const bindScrollports = () => {
          const next = Array.from(document.querySelectorAll('[data-conversation-scroll]')).filter((item) => item instanceof HTMLElement);
          if (next.length === scrollports.length && next.every((item, index) => item === scrollports[index])) return;
          for (const item of scrollports) item.removeEventListener('scroll', schedule);
          resizeObserver?.disconnect();
          resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
          scrollports = next;
          for (const item of scrollports) {
            item.addEventListener('scroll', schedule, { passive: true });
            resizeObserver?.observe(item);
            const composer = item.querySelector('[data-composer-seat]');
            if (composer instanceof HTMLElement) resizeObserver?.observe(composer);
          }
        };
        bindScrollports();
        schedule();
        const observer = new MutationObserver(() => {
          bindScrollports();
          schedule();
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
        window.addEventListener('resize', schedule, { passive: true });
        return () => {
          if (frame !== 0) window.cancelAnimationFrame(frame);
          observer.disconnect();
          resizeObserver?.disconnect();
          window.removeEventListener('resize', schedule);
          for (const item of scrollports) item.removeEventListener('scroll', schedule);
        };
      }, [sessionId, t, topicSig, headingNodeSig]);
      const visibleKeySet = react.useMemo(() => new Set(visibleKeys), [visibleKeys]);
      const visibleHeadings = react.useMemo(() => headings.filter((heading) => visibleKeySet.has(heading.key)), [headings, visibleKeySet]);
      const markerHeadings = react.useMemo(() => {
        const windowSize = 10;
        if (visibleHeadings.length <= windowSize) return visibleHeadings;
        const activeIndex = Math.max(0, visibleHeadings.findIndex((heading) => heading.key === activeKey));
        const start = Math.min(Math.max(0, activeIndex - 4), Math.max(0, visibleHeadings.length - windowSize));
        return visibleHeadings.slice(start, start + windowSize);
      }, [visibleHeadings, activeKey]);
      const showHeadingArrowUp = panelScrollState.scrollable;
      const showHeadingArrowDown = panelScrollState.scrollable;
      const showHeadingPanelControls = showHeadingArrowUp || showHeadingArrowDown;
      const renderHeadingArrowUp = () => showHeadingArrowUp && react.createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-session-kit-topic-panel-control dsh-session-kit-topic-panel-control-up',
          disabled: panelScrollState.atTop,
          'aria-label': t('topicBackToTop'),
          title: t('topicBackToTop'),
          onClick: scrollPanelToTop
        },
        react.createElement(primitives.IconChevronUpOutlineRegular, { size: 16 })
      );
      const renderHeadingArrowDown = () => showHeadingArrowDown && react.createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-session-kit-topic-panel-control dsh-session-kit-topic-panel-control-down',
          disabled: panelScrollState.atBottom,
          'aria-label': t('topicBackToBottom'),
          title: t('topicBackToBottom'),
          onClick: scrollPanelToBottom
        },
        react.createElement(primitives.IconChevronDownOutlineRegular, { size: 16 })
      );
      if (typeof document === 'undefined' || visibleHeadings.length === 0 || layout.hidden) return null;
      return reactDom.createPortal(
        react.createElement(
          'aside',
          {
            ref: headingHostRef,
            className: 'dsh-session-kit-topic-nav-host dsh-session-kit-heading-nav-host',
            style: { top: layout.top, left: layout.left },
            'aria-label': t('headingNav'),
            'data-open': panelOpen || undefined,
            onPointerMove: (event) => {
              if (event.pointerType === 'mouse') setPanelOpen(true);
            },
            onPointerLeave: () => { activeLockRef.current = undefined; setPanelOpen(false); },
            onFocus: () => setPanelOpen(true),
            onBlur: (event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setPanelOpen(false);
            }
          },
          react.createElement(
            'nav',
            { className: 'dsh-session-kit-topic-nav dsh-session-kit-heading-nav' },
            react.createElement('div', { className: 'dsh-session-kit-topic-title' }, t('headings')),
            !panelOpen && react.createElement(
              'ol',
              {
                className: 'dsh-session-kit-topic-marker-list dsh-session-kit-heading-marker-list',
                'aria-hidden': true
              },
              markerHeadings.map((heading) => react.createElement(
                'li',
                { key: heading.key, className: 'dsh-session-kit-topic-marker-item dsh-session-kit-heading-marker-item', 'data-heading-key': heading.key },
                react.createElement('span', {
                  className: 'dsh-session-kit-topic-marker dsh-session-kit-heading-marker',
                  'data-active': heading.key === activeKey || undefined
                })
              ))
            ),
            react.createElement(
              'div',
              { className: 'dsh-session-kit-topic-panel dsh-session-kit-heading-panel', onMouseLeave: () => { activeLockRef.current = undefined; setPanelOpen(false); } },
              showHeadingPanelControls && react.createElement(
                'div',
                { className: 'dsh-session-kit-topic-panel-controls' },
                renderHeadingArrowUp(),
                renderHeadingArrowDown()
              ),
              react.createElement(
                'ol',
                { className: 'dsh-session-kit-topic-panel-list dsh-session-kit-heading-panel-list', ref: panelListRef },
                visibleHeadings.map((heading) => react.createElement(
                  'li',
                  { key: heading.key, className: 'dsh-session-kit-topic-panel-item dsh-session-kit-heading-panel-item' },
                  react.createElement(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-session-kit-topic-panel-button dsh-session-kit-heading-panel-button',
                      'aria-label': `${t('headingJump')}: ${heading.fullTitle}`,
                      'aria-current': heading.key === activeKey ? 'location' : undefined,
                      'data-heading-key': heading.key,
                      'data-active': heading.key === activeKey || undefined,
                      onClick: () => {
                        activeLockRef.current = { key: heading.key, until: performance.now() + 1000 };
                        setActiveKey(heading.key);
                        scrollToHeading(heading);
                      }
                    },
                    react.createElement('span', { className: 'dsh-session-kit-topic-panel-marker dsh-session-kit-heading-panel-marker', 'data-active': heading.key === activeKey || undefined }, null),
                    react.createElement('span', { className: 'dsh-session-kit-topic-panel-text dsh-session-kit-heading-panel-text', title: heading.fullTitle }, heading.fullTitle)
                  )
                ))
              ),
              showHeadingPanelControls && react.createElement(
                'div',
                { className: 'dsh-session-kit-topic-panel-controls dsh-session-kit-topic-panel-controls-bottom' },
                renderHeadingArrowDown(),
                renderHeadingArrowUp()
              ),
              panelScrollbar.visible && react.createElement('span', {
                className: 'dsh-session-kit-topic-panel-scrollbar dsh-session-kit-heading-panel-scrollbar',
                style: { top: panelScrollbar.top, height: panelScrollbar.height },
                'aria-hidden': true
              })
            )
          )
        ),
        document.body
      );
    }

    function tailTurn(row) {
      const value = row.querySelector('[data-turn-tail]')?.getAttribute('data-turn-tail')
        ?? row.querySelector('[data-dsh-turns-del]')?.getAttribute('data-dsh-turns-del')
        ?? row.querySelector('[data-dsh-failed-turn-actions-anchor]')?.getAttribute('data-dsh-failed-turn-actions-anchor');
      const turn = value === null || value === undefined ? Number.NaN : Number(value);
      return Number.isSafeInteger(turn) ? turn : undefined;
    }

    function isTurnTailFlowRow(row) {
      return row.getAttribute('data-chat-flow-kind') === 'turn-tail';
    }

    /* 删除/重生成成功后的即时反馈：官方聊天视图按 append-origin 事件渲染人类记录，
       不会因替换事件撤除已渲染的行；标记组件又依赖轮次 tail 槽位重渲染才挂载。
       这里直接全局扫描 DOM 隐藏对应轮次的行，桥接到下一次视图重建。 */
    function readPersistedTurnsDelRanges(sessionId) {
      if (typeof localStorage === 'undefined' || typeof sessionId !== 'string' || sessionId.length === 0) return [];
      try {
        const value = JSON.parse(localStorage.getItem(`dsh-session-kit:deleted-turns:${sessionId}`) || '[]');
        return Array.isArray(value) ? value.filter((range) => Number.isSafeInteger(range?.startTurn) && range.startTurn >= 0 && Number.isSafeInteger(range?.endTurn) && range.endTurn >= range.startTurn) : [];
      } catch { return []; }
    }

    function persistTurnsDelRange(sessionId, startTurn, endTurn) {
      if (typeof localStorage === 'undefined' || typeof sessionId !== 'string' || sessionId.length === 0
        || !Number.isSafeInteger(startTurn) || startTurn < 0
        || !Number.isSafeInteger(endTurn) || endTurn < startTurn) return;
      const ranges = readPersistedTurnsDelRanges(sessionId);
      if (!ranges.some((range) => range.startTurn === startTurn && range.endTurn === endTurn)) ranges.push({ startTurn, endTurn });
      try { localStorage.setItem(`dsh-session-kit:deleted-turns:${sessionId}`, JSON.stringify(ranges)); } catch {}
    }

    const turnsDelRangesRequests = new Map();
    function fetchTurnsDelRanges(sessionId) {
      if (typeof sessionId !== 'string' || sessionId.length === 0) return Promise.resolve([]);
      const cached = turnsDelRangesRequests.get(sessionId);
      if (cached !== undefined) return cached;
      const request = fetch(`${TURNS_DEL_RANGES_PATH}?sessionId=${encodeURIComponent(sessionId)}`)
        .then((response) => response.json())
        .then((result) => Array.isArray(result?.value)
          ? result.value.filter((range) => Number.isSafeInteger(range?.startTurn) && range.startTurn >= 0 && Number.isSafeInteger(range?.endTurn) && range.endTurn >= range.startTurn)
          : [])
        .catch(() => []);
      turnsDelRangesRequests.set(sessionId, request);
      return request;
    }

    /* 当前会话的删除范围：本地缓存立即可用，服务端日志（v4 墓碑）是持久真源。
       每个会话只维护一个 DOM 观察者，避免每个轮次各挂一个观察者。 */
    const turnsDelRangesBySession = new Map();
    const turnsDelGuards = new Map();
    function turnsDelRangesOf(sessionId) {
      if (typeof sessionId !== 'string' || sessionId.length === 0) return [];
      const merged = new Map();
      for (const range of readPersistedTurnsDelRanges(sessionId)) merged.set(`${range.startTurn}:${range.endTurn}`, range);
      for (const range of turnsDelRangesBySession.get(sessionId) ?? []) merged.set(`${range.startTurn}:${range.endTurn}`, range);
      return [...merged.values()].sort((left, right) => left.startTurn - right.startTurn);
    }

    function applyTurnsDelRanges(sessionId) {
      for (const range of turnsDelRangesOf(sessionId)) concealTurnsDelRangeGlobally(range.startTurn, range.endTurn);
    }

    /* 订阅一个会话的删除范围：首次订阅时拉取服务端真源并启动共享观察者。 */
    function subscribeTurnsDelRanges(sessionId) {
      if (typeof sessionId !== 'string' || sessionId.length === 0) return () => {};
      let guard = turnsDelGuards.get(sessionId);
      if (guard === undefined) {
        const observer = typeof MutationObserver === 'function' && typeof document !== 'undefined'
          ? new MutationObserver(() => applyTurnsDelRanges(sessionId))
          : null;
        observer?.observe(document.body, { childList: true, subtree: true });
        guard = { count: 0, observer };
        turnsDelGuards.set(sessionId, guard);
        void fetchTurnsDelRanges(sessionId).then((ranges) => {
          if (ranges.length === 0) return;
          const known = turnsDelRangesBySession.get(sessionId) ?? [];
          const merged = new Map(known.map((range) => [`${range.startTurn}:${range.endTurn}`, range]));
          for (const range of ranges) merged.set(`${range.startTurn}:${range.endTurn}`, range);
          turnsDelRangesBySession.set(sessionId, [...merged.values()]);
          for (const range of ranges) persistTurnsDelRange(sessionId, range.startTurn, range.endTurn);
          applyTurnsDelRanges(sessionId);
        });
      }
      guard.count += 1;
      applyTurnsDelRanges(sessionId);
      return () => {
        const current = turnsDelGuards.get(sessionId);
        if (current === undefined) return;
        current.count -= 1;
        if (current.count > 0) return;
        current.observer?.disconnect();
        turnsDelGuards.delete(sessionId);
      };
    }

    /* React 拥有官方聊天行的 hidden 属性：后续重渲染会把它清掉，而 childList
       观察不到属性回写，于是隐藏只在删除当下有效、重启后丢失。这里改用插件私有
       属性 + 一条样式规则隐藏，React 不管理该属性，重渲染也不会还原。 */
    const TURNS_DEL_HIDDEN_ATTR = 'data-dsh-turns-del-hidden';
    let turnsDelStyleInjected = false;
    function ensureTurnsDelHiddenStyle() {
      if (turnsDelStyleInjected || typeof document === 'undefined') return;
      const head = document.head ?? document.documentElement;
      if (head === null || head === undefined) return;
      const style = document.createElement('style');
      style.setAttribute('data-dsh-session-kit', 'turns-del-hidden');
      style.textContent = `[${TURNS_DEL_HIDDEN_ATTR}]{display:none !important}`;
      head.appendChild(style);
      turnsDelStyleInjected = true;
    }

    function concealTurnsDelRangeGlobally(startTurn, endTurn) {
      if (typeof document === 'undefined'
        || !Number.isSafeInteger(startTurn) || startTurn < 0
        || !Number.isSafeInteger(endTurn) || endTurn < startTurn) return;
      const dialogSelector = '[role="dialog"], [aria-modal="true"]';
      const rowSelector = '[data-chat-flow-kind], [data-chat-anchor-key]';
      const isChatRow = (row) => row instanceof HTMLElement
        && row.closest(dialogSelector) === null;
      const collectRows = (root) => {
        const candidates = Array.from(root.querySelectorAll(rowSelector)).filter(isChatRow);
        /* 一个聊天行可能同时包含带 data-chat-anchor-key 的子节点；只保留最外层
           带标记的节点，避免同一行被重复计入索引。 */
        return candidates.filter((row) => {
          let parent = row.parentElement;
          while (parent !== null && parent !== root) {
            if (parent.matches(rowSelector)) return false;
            parent = parent.parentElement;
          }
          return true;
        });
      };
      const scrollports = Array.from(document.querySelectorAll('[data-conversation-scroll]'))
        .filter((root) => root instanceof HTMLElement && root.closest(dialogSelector) === null && !root.hidden && root.getClientRects().length > 0)
        .map((root) => ({ root, rows: collectRows(root) }))
        .filter((entry) => entry.rows.length > 0);
      /* 正常情况下只有一个活动会话滚动容器；取可见聊天行最多的容器，避免
         其他 portal/预览容器的 tail 干扰当前会话。没有标记滚动容器时退回 body。 */
      const active = scrollports.sort((left, right) => right.rows.length - left.rows.length)[0];
      const rows = active?.rows ?? collectRows(document.body);
      if (rows.length === 0) return;
      ensureTurnsDelHiddenStyle();
      const mark = (row) => row.setAttribute(TURNS_DEL_HIDDEN_ATTR, '');
      const hideRange = (from, to) => {
        const first = Math.max(0, from);
        const last = Math.min(rows.length - 1, to);
        for (let index = first; index <= last; index += 1) mark(rows[index]);
      };
      /* Prefer Chat's explicit per-row turn identity; tombstone markers can then hide
         the exact v4 turn even when a footer row is virtualized or rearranged. */
      for (const row of rows) {
        const turn = Number(row.getAttribute('data-chat-turn'));
        if (Number.isSafeInteger(turn) && turn >= startTurn && turn <= endTurn) mark(row);
      }
      const tails = rows
        .map((row, index) => ({ row, index, turn: tailTurn(row) }))
        .filter((entry) => isTurnTailFlowRow(entry.row) && entry.turn !== undefined);
      let boundaryIndex = -1;
      const lastTailIndex = tails.length > 0 ? tails[tails.length - 1].index : -1;
      const lastTailTurn = lastTailIndex >= 0 ? (tails[tails.length - 1].turn ?? -Infinity) : -Infinity;
      for (const entry of tails) {
        if (entry.turn < startTurn) {
          boundaryIndex = entry.index;
          continue;
        }
        if (entry.turn > endTurn) break;
        /* 区间是 (上一个保留 tail, 当前目标 tail]：不隐藏前一个保留 tail，
           同时包含当前目标轮次的用户/助手行与 tail 行。 */
        hideRange(boundaryIndex + 1, entry.index);
        boundaryIndex = entry.index;
      }
      /* 手动停止轮次可能没有 tail：删除范围延伸到最后一个已结束轮次时，
         隐藏最后一个可读 tail 之后的尾部行，但不包含仍保留的 lastTail 本身。 */
      if (lastTailIndex >= 0 && endTurn > lastTailTurn && startTurn <= lastTailTurn + 1) {
        hideRange(lastTailIndex + 1, rows.length - 1);
        return;
      }
      /* 没有任何可读 tail 且从第一轮开始删除：当前容器中的所有聊天行都在范围内。 */
      if (lastTailIndex < 0 && startTurn <= 1) hideRange(0, rows.length - 1);
      /* 中间 tail-less 轮次之后仍有未删除的 tail-less 轮次时无法仅凭 DOM 边界
         精确区分，宁可保留并等待下一次视图折叠，也不误伤未删除轮次。 */
    }

    /* 重启恢复守卫。必须挂在会被真实渲染的槽位上：assistant-actions 正是删除
       按钮所在的槽位（已验证会挂载）；turnTail 槽位在本环境未触发，历史实现
       依赖它的 select 结果，因此重启后的恢复逻辑从未执行。 */
    function TurnsDelRestoreGuard({ sessionId }) {
      react.useLayoutEffect(() => {
        if (typeof sessionId !== 'string' || sessionId.length === 0) return;
        return subscribeTurnsDelRanges(sessionId);
      }, [sessionId]);
      return null;
    }

    function TurnsDelMarker({ turn, sessionId }) {
      /* turnTail 的 ownerProps.turn 是轮次实体（含 .turn 编号），不是数字；
         旧写法 Number.isSafeInteger(turn) 恒为 false，订阅从未生效。兼容两种形态。 */
      const turnNumber = Number.isSafeInteger(turn) ? turn : (Number.isSafeInteger(turn?.turn) ? turn.turn : undefined);
      react.useLayoutEffect(() => {
        if (!Number.isSafeInteger(turnNumber)) return;
        return subscribeTurnsDelRanges(sessionId);
      }, [turnNumber, sessionId]);
      /* 保持非空内容：turn-tail 节点在 closing 为空时以 tail 是否为 null
         决定是否渲染整行，返回 null 会改变官方尾部行的布局。 */
      return react.createElement('span', { 'data-dsh-turns-del-marker': String(turnNumber ?? ''), hidden: true });
    }

    const turnsDelActionStyle = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 28,
      height: 28,
      padding: 6,
      border: 'none',
      borderRadius: 28,
      background: 'transparent',
      color: 'var(--dsw-alias-label-tertiary)',
      cursor: 'pointer'
    };
    const turnsDelConfirmStyle = { color: 'var(--dsw-alias-state-error-primary)' };
    const turnsDelErrorStyle = { color: 'var(--dsw-alias-state-error-primary)', fontSize: 13, lineHeight: 1.5 };

    const regenerateActionStyle = { ...turnsDelActionStyle, opacity: 1 };

    function RegenerateAction({ messageId, turn, promptSeq, regenerateTurns, regenerateTurn, useSession, t }) {
      const running = useSession((snapshot) => snapshot.running);
      const queued = useSession((snapshot) => (snapshot.queue?.length ?? 0) > 0);
      const subagent = useSession((snapshot) => snapshot.subagent);
      const [pending, setPending] = react.useState(false);
      const operationId = react.useRef(null);
      const [error, setError] = react.useState(null);
      const alive = react.useRef(true);
      react.useEffect(() => {
        alive.current = true;
        return () => { alive.current = false; };
      }, []);
      if (subagent != null) return null;
      const unavailable = running || queued || pending;
      const regenerate = async () => {
        if (unavailable) return;
        operationId.current ??= crypto.randomUUID();
        setPending(true);
        setError(null);
        try {
          const result = typeof turn === 'number' ? await regenerateTurn(turn, operationId.current, promptSeq) : await regenerateTurns(messageId, operationId.current);
          if (result.ok) {
            const deletion = result.value?.deletion;
            concealTurnsDelRangeGlobally(deletion?.turn, deletion?.endTurn);
          }
          if (!result.ok) {
            /* 三个错误码曾合并成同一句提示，掩盖了真实原因（把“该轮有多条提问”
               显示成“没有可重发的提问”），排查时被误导。现在各归其位。 */
            if (result.error.code === 'PROMPT_NOT_FOUND') throw new Error('PROMPT_NOT_FOUND');
            if (result.error.code === 'PROMPT_AMBIGUOUS') throw new Error('PROMPT_AMBIGUOUS');
            if (result.error.code === 'PROMPT_UNSUPPORTED') throw new Error('PROMPT_UNSUPPORTED');
            if (result.error.code === 'TURN_NOT_CLOSED') throw new Error('TURN_NOT_CLOSED');
            if (result.error.code === 'AGENT_BUSY') throw new Error('AGENT_BUSY');
            if (result.error.code === 'TURN_COMPACTED') throw new Error('TURN_COMPACTED');
            if (result.error.code === 'QUEUE_NOT_EMPTY') throw new Error('QUEUE_NOT_EMPTY');
            /* 服务端已按真实原因分类；带上原文，避免再次显示成笼统的“任务正在运行”。 */
            throw new Error(`VERBATIM:${result.error.message || result.error.code}`);
          }
          if (alive.current) setPending(false);
        } catch (reason) {
          if (!alive.current) return;
          setPending(false);
          const raw = reason instanceof Error ? reason.message : '';
          if (raw === 'PROMPT_NOT_FOUND') setError(t('regenerate.prompt'));
          else if (raw === 'PROMPT_AMBIGUOUS') setError(t('regenerate.ambiguous'));
          else if (raw === 'PROMPT_UNSUPPORTED') setError(t('regenerate.unsupported'));
          else if (raw === 'TURN_NOT_CLOSED') setError(t('regenerate.unclosed'));
          else if (raw === 'AGENT_BUSY') setError(t('error.busy'));
          else if (raw === 'TURN_COMPACTED') setError(t('error.compacted'));
          else if (raw === 'QUEUE_NOT_EMPTY') setError(t('regenerate.queue'));
          else if (raw.startsWith('VERBATIM:')) setError(raw.slice('VERBATIM:'.length) || t('regenerate.failed'));
          else setError(t('regenerate.failed'));
        }
      };
      return react.createElement(
        react.Fragment,
        null,
        react.createElement(
          primitives.Tooltip,
          { label: unavailable ? t('regenerate.busy') : t('regenerate.action'), side: 'bottom' },
          react.createElement('button', {
            type: 'button',
            'data-dsh-turns-del-action': 'regenerate',
            className: 'dsh-session-kit-turn-action',
            style: { ...regenerateActionStyle, opacity: unavailable ? 0.4 : 1, cursor: unavailable ? 'default' : 'pointer' },
            'aria-label': t('regenerate.action'),
            'aria-disabled': unavailable || undefined,
            onClick: regenerate
          }, pending ? react.createElement(primitives.IconLoadingOutlineRegular, {}) : react.createElement(primitives.IconRefreshOutlineRegular, {}))
        ),
        error !== null && react.createElement('span', { role: 'alert', title: error, style: turnsDelErrorStyle }, error)
      );
    }

    function EditRegenerateAction({ turn, text, promptSeq, editRegenerateTurn, useSession, t }) {
      const running = useSession((snapshot) => snapshot.running);
      const queued = useSession((snapshot) => (snapshot.queue?.length ?? 0) > 0);
      const subagent = useSession((snapshot) => snapshot.subagent);
      const [open, setOpen] = react.useState(false);
      const [draft, setDraft] = react.useState(text || '');
      const [pending, setPending] = react.useState(false);
      const [error, setError] = react.useState(null);
      const operationId = react.useRef(null);
      const alive = react.useRef(true);
      react.useEffect(() => {
        alive.current = true;
        return () => { alive.current = false; };
      }, []);
      react.useEffect(() => {
        if (!open) setDraft(text || '');
      }, [text, open]);
      if (subagent != null || typeof editRegenerateTurn !== 'function') return null;
      const unavailable = running || queued || pending;
      const close = () => {
        if (pending) return;
        setOpen(false);
        setError(null);
        setDraft(text || '');
      };
      const confirm = async () => {
        if (unavailable) return;
        if (draft.trim() === '') {
          setError(t('edit.empty'));
          return;
        }
        operationId.current ??= crypto.randomUUID();
        setPending(true);
        setError(null);
        try {
          const result = await editRegenerateTurn(turn, operationId.current, draft, promptSeq);
          if (result.ok) {
            const deletion = result.value?.deletion;
            concealTurnsDelRangeGlobally(deletion?.turn, deletion?.endTurn);
          }
          if (!result.ok) {
            if (result.error.code === 'PROMPT_NOT_FOUND') throw new Error('PROMPT_NOT_FOUND');
            if (result.error.code === 'PROMPT_AMBIGUOUS') throw new Error('PROMPT_AMBIGUOUS');
            if (result.error.code === 'PROMPT_UNSUPPORTED') throw new Error('PROMPT_UNSUPPORTED');
            if (result.error.code === 'TURN_NOT_CLOSED') throw new Error('TURN_NOT_CLOSED');
            if (result.error.code === 'AGENT_BUSY') throw new Error('AGENT_BUSY');
            if (result.error.code === 'TURN_COMPACTED') throw new Error('TURN_COMPACTED');
            if (result.error.code === 'QUEUE_NOT_EMPTY') throw new Error('QUEUE_NOT_EMPTY');
            throw new Error(`VERBATIM:${result.error.message || result.error.code}`);
          }
          if (alive.current) {
            setPending(false);
            setOpen(false);
          }
        } catch (reason) {
          if (!alive.current) return;
          setPending(false);
          const raw = reason instanceof Error ? reason.message : '';
          if (raw === 'PROMPT_NOT_FOUND') setError(t('regenerate.prompt'));
          else if (raw === 'PROMPT_AMBIGUOUS') setError(t('regenerate.ambiguous'));
          else if (raw === 'PROMPT_UNSUPPORTED') setError(t('regenerate.unsupported'));
          else if (raw === 'TURN_NOT_CLOSED') setError(t('regenerate.unclosed'));
          else if (raw === 'AGENT_BUSY') setError(t('error.busy'));
          else if (raw === 'TURN_COMPACTED') setError(t('error.compacted'));
          else if (raw === 'QUEUE_NOT_EMPTY') setError(t('regenerate.queue'));
          else if (raw.startsWith('VERBATIM:')) setError(raw.slice('VERBATIM:'.length) || t('edit.failed'));
          else setError(t('edit.failed'));
        }
      };
      return react.createElement(
        react.Fragment,
        null,
        react.createElement(
          primitives.Tooltip,
          { label: unavailable ? t('regenerate.busy') : t('edit.action'), side: 'bottom' },
          react.createElement('button', {
            type: 'button',
            'data-dsh-turns-del-action': 'edit-regenerate',
            className: 'dsh-session-kit-turn-action',
            style: { ...regenerateActionStyle, opacity: unavailable ? 0.4 : 1, cursor: unavailable ? 'default' : 'pointer' },
            'aria-label': t('edit.action'),
            'aria-disabled': unavailable || undefined,
            onClick: unavailable ? undefined : () => {
              setDraft(text || '');
              setError(null);
              setOpen(true);
            }
          }, pending ? react.createElement(primitives.IconLoadingOutlineRegular, {}) : react.createElement(primitives.IconEditOutlineRegular, {}))
        ),
        react.createElement(EditRegenerateDialog, { open, t, value: draft, error, busy: pending, onChange: setDraft, onCancel: close, onConfirm: () => void confirm() })
      );
    }

    function TurnsDelAction({ messageId, turn, sessionId, delTurns, delTurn, useSession, t }) {
      const running = useSession((snapshot) => snapshot.running);
      const subagent = useSession((snapshot) => snapshot.subagent);
      const [open, setOpen] = react.useState(false);
      const [pending, setPending] = react.useState(false);
      const [error, setError] = react.useState(null);
      const alive = react.useRef(true);
      react.useEffect(() => {
        alive.current = true;
        const ranges = readPersistedTurnsDelRanges(sessionId).filter((range) => Number.isSafeInteger(turn) && turn >= range.startTurn && turn <= range.endTurn);
        const applyPersistedRanges = () => {
          for (const range of ranges) concealTurnsDelRangeGlobally(range.startTurn, range.endTurn);
        };
        if (ranges.length > 0) applyPersistedRanges();
        const observer = ranges.length > 0 && typeof MutationObserver === 'function' && typeof document !== 'undefined'
          ? new MutationObserver(applyPersistedRanges)
          : null;
        if (observer !== null) observer.observe(document.body, { childList: true, subtree: true });
        return () => {
          alive.current = false;
          observer?.disconnect();
        };
      }, [sessionId, turn]);
      if (subagent != null) return null;
      const unavailable = running || pending;
      const close = () => {
        if (pending) return;
        setOpen(false);
        setError(null);
      };
      const confirm = () => {
        if (unavailable) return;
        setPending(true);
        setError(null);
        (typeof turn === 'number' ? delTurn(turn) : delTurns(messageId)).then((result) => {
          if (!alive.current) return;
          setPending(false);
          if (result.ok) {
            persistTurnsDelRange(sessionId, result.value?.turn, result.value?.endTurn);
            concealTurnsDelRangeGlobally(result.value?.turn, result.value?.endTurn);
            setOpen(false);
            return;
          }
          if (result.error.code === 'AGENT_BUSY') setError(t('error.busy'));
          else if (result.error.code === 'DELETE_FAILED') setError(result.error.message || t('error.generic'));
          else if (result.error.code === 'TURN_COMPACTED') setError(t('error.compacted'));
          else if (result.error.code === 'TARGET_NOT_FOUND' || result.error.code === 'TURN_NOT_CLOSED') setError(t('error.unavailable'));
          else setError(t('error.generic'));
        }).catch(() => {
          if (!alive.current) return;
          setPending(false);
          setError(t('error.generic'));
        });
      };
      return react.createElement(
        react.Fragment,
        null,
        react.createElement(
          primitives.Tooltip,
          { label: running ? t('action.busy') : t('action.del'), side: 'bottom' },
          react.createElement('button', {
            type: 'button',
            'data-dsh-turns-del-action': 'delete',
            className: 'dsh-session-kit-turn-action dsh-session-kit-turn-action-danger',
            style: { ...turnsDelActionStyle, opacity: running ? 0.4 : 1, cursor: running ? 'default' : 'pointer' },
            'aria-label': t('action.del'),
            'aria-disabled': running || undefined,
            onClick: running ? undefined : () => {
              setOpen(true);
              setError(null);
            }
          }, react.createElement(primitives.IconTrashOutlineRegular, {}))
        ),
        react.createElement(primitives.Modal, {
          open,
          onClose: close,
          closeLabel: t('dialog.cancel'),
          title: t('dialog.title'),
          description: t('dialog.description'),
          footer: react.createElement(
            react.Fragment,
            null,
            react.createElement(primitives.Button, { variant: 'outline', autoFocus: true, disabled: pending, onClick: close }, t('dialog.cancel')),
            react.createElement(primitives.Button, { variant: 'outline', style: turnsDelConfirmStyle, disabled: pending || running, onClick: confirm }, pending ? t('dialog.deleting') : t('dialog.confirm'))
          ),
          children: error !== null && react.createElement('div', { style: turnsDelErrorStyle, role: 'alert' }, error)
        })
      );
    }

    function deletedTurnsDelRange(event) {
      /* v3 墓碑：空 content 的 user/message 替换，元数据在 source.summary 的 JSON */
      if (event.type !== 'user/message'
        || event.surfaceOp?.op !== 'replace'
        || !Array.isArray(event.data?.content)
        || event.data.content.length !== 0) return undefined;
      const source = event.data?.source;
      /* v4 may rewrite legacy producer kinds; empty replacement + turn range is the durable marker. */
      let meta = {};
      try {
        const parsed = JSON.parse(source?.summary ?? '');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed;
      } catch { meta = {}; }
      const startTurn = meta.turn;
      const endTurn = meta.endTurn ?? meta.turn;
      if (!Number.isSafeInteger(startTurn) || startTurn < 0) return undefined;
      if (!Number.isSafeInteger(endTurn) || endTurn < startTurn) return undefined;
      return { startTurn, endTurn };
    }

    const turnsDelDefinition = {
      kind: TURNS_DEL_NS,
      match: (event) => {
        const range = deletedTurnsDelRange(event);
        return range === undefined ? null : { id: String(range.startTurn), role: 'start' };
      },
      start: (_context, match) => {
        const range = deletedTurnsDelRange(match.event);
        if (range === undefined) throw new Error('turns-del start requires a deletion tombstone');
        return range;
      },
      update: (context) => context.state,
      publication: () => 'immediate',
      buildLocationData: (context, scope) => {
        if (scope !== 'turn' || context.state === undefined) return null;
        return {
          kind: 'turn',
          turn: context.state.startTurn,
          key: TURNS_DEL_NS,
          value: { hidden: true, startTurn: context.state.startTurn, endTurn: context.state.endTurn }
        };
      }
    };

    function selectFailedTurnActions(owner) {
      const turn = owner.turn;
      const reason = turn?.end?.data?.reason;
      if (reason?.kind !== 'error' || !Number.isSafeInteger(turn?.turn)) return null;
      const closing = turn.data?.get?.('turn-tail')?.closing;
      if (typeof closing?.finalNode?.messageId === 'string') return null;
      return { turn: turn.turn };
    }

    async function postTurnsDelAction(path, sessionId, assistantMessageId, extra = {}) {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, assistantMessageId, ...extra })
      });
      const value = await response.json();
      if (typeof value !== 'object' || value === null || typeof value.ok !== 'boolean') throw new Error(`turns-del returned HTTP ${String(response.status)}`);
      return value;
    }

    function postTurnsDel(sessionId, assistantMessageId) {
      return postTurnsDelAction(TURNS_DEL_PATH, sessionId, assistantMessageId);
    }

    /* promptSeq 只在用户消息行上有值（该行提问的事件序号）；助手消息行不带，
       由服务端按“该助手消息之前最近一条提问”反推。 */
    function promptSeqField(promptSeq) {
      return Number.isSafeInteger(promptSeq) && promptSeq >= 0 ? { promptSeq } : {};
    }

    function postTurnsDelTurn(sessionId, turn) {
      return postTurnsDelAction(TURNS_DEL_TURN_PATH, sessionId, undefined, { turn });
    }

    function postRegenerateTurns(sessionId, assistantMessageId, operationId) {
      return postTurnsDelAction(REGENERATE_PATH, sessionId, assistantMessageId, { operationId });
    }

    function postRegenerateTurn(sessionId, turn, operationId, promptSeq) {
      return postTurnsDelAction(REGENERATE_TURN_PATH, sessionId, undefined, { turn, operationId, ...promptSeqField(promptSeq) });
    }

    function postEditRegenerateTurn(sessionId, turn, operationId, text, promptSeq) {
      return postTurnsDelAction(EDIT_REGENERATE_TURN_PATH, sessionId, undefined, { turn, operationId, text, ...promptSeqField(promptSeq) });
    }

    function DistillTurnAction({ turn, messageId, distillTurn, useSession, t }) {
      const running = useSession((snapshot) => snapshot.running);
      const queued = useSession((snapshot) => (snapshot.queue?.length ?? 0) > 0);
      const subagent = useSession((snapshot) => snapshot.subagent);
      const [pending, setPending] = react.useState(false);
      const [done, setDone] = react.useState(false);
      const [error, setError] = react.useState(null);
      const doneTimer = react.useRef(0);
      const alive = react.useRef(true);
      react.useEffect(() => {
        alive.current = true;
        return () => {
          alive.current = false;
          window.clearTimeout(doneTimer.current);
        };
      }, []);
      if (subagent != null || typeof distillTurn !== 'function') return null;
      const unavailable = running || queued || pending;
      const distill = async () => {
        if (unavailable) return;
        window.clearTimeout(doneTimer.current);
        setPending(true);
        setDone(false);
        setError(null);
        try {
          const value = await distillTurn(Number.isSafeInteger(turn) ? turn : messageId);
          if (!alive.current) return;
          const status = value?.distill?.status;
          if (status === 'created' || status === 'duplicate') {
            setDone(true);
          } else if (status === 'skipped') {
            const reasonKey = `distill.reason.${String(value.distill.reason || '')}`;
            const reason = t(reasonKey) === reasonKey ? String(value.distill.reason || '') : t(reasonKey);
            setError(t('distill.skipped').replace('{reason}', reason));
          } else {
            setError(t('distill.failed'));
          }
          if (status !== 'created' && status !== 'duplicate') return;
          doneTimer.current = window.setTimeout(() => {
            if (alive.current) setDone(false);
          }, 1600);
        } catch {
          if (alive.current) setError(t('distill.failed'));
        } finally {
          if (alive.current) setPending(false);
        }
      };
      return react.createElement(
        react.Fragment,
        null,
        react.createElement(
          primitives.Tooltip,
          { label: pending ? t('distill.action') : done ? t('distill.done') : unavailable ? t('distill.busy') : t('distill.action'), side: 'bottom' },
          react.createElement('button', {
            type: 'button',
            'data-dsh-turns-del-action': 'distill',
            className: 'dsh-session-kit-turn-action',
            style: { ...regenerateActionStyle, opacity: unavailable ? 0.4 : 1, cursor: unavailable ? 'default' : 'pointer' },
            'aria-label': t('distill.action'),
            'aria-disabled': unavailable || undefined,
            onClick: unavailable ? undefined : () => void distill()
          }, pending ? react.createElement(DistillHourglassIcon, {}) : done ? react.createElement(primitives.IconCheckOutlineRegular, {}) : react.createElement(primitives.IconSparkleRegular, { size: 16 }))
        ),
        error !== null && react.createElement('span', { role: 'alert', title: error, style: turnsDelErrorStyle }, error)
      );
    }

    function TurnMemoryAction({ messageId, turn, getTurnMemoryHits, useSession, t }) {
      const subagent = useSession((snapshot) => snapshot.subagent);
      const [open, setOpen] = react.useState(false);
      const [loading, setLoading] = react.useState(false);
      const [error, setError] = react.useState(null);
      const [memories, setMemories] = react.useState([]);
      const [searchOpen, setSearchOpen] = react.useState(false);
      const [query, setQuery] = react.useState('');
      const [pos, setPos] = react.useState(null);
      const searchInputRef = react.useRef(null);
      /* 搜索框展开后聚焦（面板经 portal 渲染，等一帧再取焦点更稳）。 */
      react.useEffect(() => {
        if (!searchOpen) return;
        const frame = window.requestAnimationFrame(() => {
          searchInputRef.current?.focus?.();
        });
        return () => window.cancelAnimationFrame(frame);
      }, [searchOpen]);
      /* 面板收起时同时重置搜索，避免下次打开时列表仍被过滤却没有可见输入框。 */
      react.useEffect(() => {
        if (open) return;
        setSearchOpen(false);
        setQuery('');
      }, [open]);
      const rootRef = react.useRef(null);
      const panelRef = react.useRef(null);
      const alive = react.useRef(true);
      react.useEffect(() => {
        alive.current = true;
        return () => {
          alive.current = false;
        };
      }, []);
      react.useLayoutEffect(() => {
        if (!open) {
          setPos(null);
          return;
        }
        const measure = () => {
          const rect = rootRef.current?.getBoundingClientRect();
          if (rect === undefined) return;
          const panelWidth = 360;
          const gap = 6;
          let left = rect.left + rect.width / 2 - panelWidth / 2;
          left = Math.max(8, Math.min(left, window.innerWidth - panelWidth - 8));
          const spaceAbove = rect.top;
          const spaceBelow = window.innerHeight - rect.bottom;
          const placeAbove = spaceAbove > spaceBelow && spaceAbove > 160;
          setPos({ left, ...(placeAbove ? { bottom: window.innerHeight - rect.top + gap } : { top: rect.bottom + gap }) });
        };
        measure();
        window.addEventListener('resize', measure);
        window.addEventListener('scroll', measure, true);
        return () => {
          window.removeEventListener('resize', measure);
          window.removeEventListener('scroll', measure, true);
        };
      }, [open]);
      react.useEffect(() => {
        if (!open) return;
        const onPointerDown = (event) => {
          if (!(event.target instanceof Node)) return;
          if (rootRef.current?.contains(event.target) === true) return;
          if (panelRef.current?.contains(event.target) === true) return;
          setOpen(false);
        };
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
          document.removeEventListener('pointerdown', onPointerDown);
          document.removeEventListener('keydown', onKeyDown);
        };
      }, [open]);
      if (subagent != null || typeof getTurnMemoryHits !== 'function') return null;
      const load = async () => {
        if (loading) return;
        setLoading(true);
        setError(null);
        try {
          const value = await getTurnMemoryHits({ messageId, turn });
          if (!alive.current) return;
          setMemories(Array.isArray(value?.memories) ? value.memories : []);
        } catch {
          if (alive.current) setError(t('turnMemory.failed'));
        } finally {
          if (alive.current) setLoading(false);
        }
      };
      const toggle = () => {
        const next = !open;
        setOpen(next);
        if (next && memories.length === 0 && !loading) void load();
      };
      const title = t('turnMemory.title');
      /* 面板搜索按标签与正文筛选（memoryMatches 还会命中项目名/来源会话，与记忆管理弹窗行为一致）。 */
      const keyword = query.trim();
      const visibleMemories = keyword === '' ? memories : memories.filter((memory) => memoryMatches(memory, keyword));
      const countText = keyword === ''
        ? fillTemplate(t('turnMemory.count'), { count: memories.length })
        : fillTemplate(t('turnMemory.countFiltered'), { shown: visibleMemories.length, total: memories.length });
      const newRecallCount = memories.filter((memory) => memory.newRecall === true).length;
      return react.createElement(
        'span',
        { ref: rootRef, className: 'dsh-session-kit-turn-memory-tag' },
        react.createElement(
          primitives.Tooltip,
          { label: t('turnMemory.tip'), side: 'bottom' },
          react.createElement('button', {
            type: 'button',
            className: 'dsh-session-kit-turn-action dsh-session-kit-turn-memory-trigger',
            'data-dsh-turns-del-action': 'turn-memory',
            'aria-haspopup': 'dialog',
            'aria-expanded': open,
            'aria-label': t('turnMemory.tip'),
            onClick: toggle
          },
            react.createElement(MemoryIcon, { size: 16 }),
            react.createElement('span', { className: 'dsh-session-kit-turn-memory-label' }, t('turnMemory.action'))
          )
        ),
        open && reactDom.createPortal(react.createElement('div', {
          ref: panelRef,
          className: 'dsh-session-kit-turn-memory-panel',
          role: 'dialog',
          'aria-label': title,
          style: pos ?? { left: 0, top: 0, visibility: 'hidden' }
        },
          react.createElement('div', { className: 'dsh-session-kit-turn-memory-panel-scroll' },
            !loading && error === null && react.createElement('div', { className: 'dsh-session-kit-turn-memory-panel-title' },
              react.createElement('span', { className: 'dsh-session-kit-turn-memory-panel-title-main' },
                react.createElement(MemoryIcon, { size: 14 }),
                react.createElement('span', null, title)
              ),
              react.createElement('span', { className: 'dsh-session-kit-turn-memory-panel-title-right' },
                react.createElement('span', { className: 'dsh-session-kit-turn-memory-panel-count' },
                   countText,
                   newRecallCount > 0 && react.createElement('span', { className: 'dsh-session-kit-turn-memory-new-count' }, ` (+${newRecallCount})`)
                 ),
                react.createElement('button', {
                  type: 'button',
                  className: 'dsh-session-kit-turn-memory-search-toggle',
                  'aria-label': t('turnMemory.search'),
                  title: t('turnMemory.search'),
                  'aria-pressed': searchOpen,
                  onClick: () => setSearchOpen((value) => !value)
                }, react.createElement(primitives.IconSearchOutlineRegular, { size: 14 }))
              )
            ),
            /* 搜索行默认收起；点击标题右侧图标后显示并聚焦，输入即筛选下方条目。 */
            searchOpen && !loading && error === null && react.createElement('div', { className: 'dsh-session-kit-turn-memory-search' },
              react.createElement('span', { className: 'dsh-session-kit-turn-memory-search-icon', 'aria-hidden': 'true' }, react.createElement(primitives.IconSearchOutlineRegular, { size: 13 })),
              react.createElement('input', {
                ref: searchInputRef,
                className: 'dsh-session-kit-turn-memory-search-input',
                value: query,
                placeholder: t('turnMemory.searchPlaceholder'),
                onChange: (event) => setQuery(event.currentTarget.value),
                'aria-label': t('turnMemory.searchPlaceholder')
              }),
              query !== '' && react.createElement('button', {
                type: 'button',
                className: 'dsh-session-kit-turn-memory-search-clear',
                onClick: () => setQuery(''),
                'aria-label': t('turnMemory.searchClear'),
                title: t('turnMemory.searchClear')
              }, react.createElement(primitives.IconCloseOutlineRegular, { size: 13 }))
            ),
            loading && react.createElement('div', { className: 'dsh-session-kit-turn-memory-muted' }, '…'),
            error !== null && react.createElement('div', { role: 'alert', className: 'dsh-session-kit-turn-memory-error' }, error),
            !loading && error === null && keyword !== '' && visibleMemories.length === 0 && react.createElement('div', { className: 'dsh-session-kit-turn-memory-muted' }, t('turnMemory.searchEmpty')),
            !loading && error === null && visibleMemories.map((memory) => react.createElement('div', {
              key: memory.id,
              className: 'dsh-session-kit-turn-memory-item'
            },
              react.createElement('div', { className: 'dsh-session-kit-memory-meta-row dsh-session-kit-turn-memory-item-meta-row' },
                react.createElement('span', { className: 'dsh-session-kit-memory-meta-value' }, memory.directoryName || t('memoryNoDirectory')),
                memory.newRecall === true && react.createElement('span', {
                  className: 'dsh-session-kit-turn-memory-new-recall',
                  title: t('turnMemory.newRecall'),
                  'aria-label': t('turnMemory.newRecall'),
                  role: 'img',
                  key: 'new-recall'
                }, '+'),
                memory.pinned === true && react.createElement('span', {
                  className: 'dsh-session-kit-turn-memory-pinned',
                  title: t('turnMemory.pinned'),
                  'aria-label': t('turnMemory.pinned'),
                  role: 'img',
                  key: 'pinned'
                }, '📌')
              ),
              react.createElement('div', { className: 'dsh-session-kit-memory-meta-row dsh-session-kit-memory-meta-tags-row dsh-session-kit-turn-memory-item-tags-row' },
                react.createElement('span', { className: 'dsh-session-kit-memory-meta-tags' },
                  memoryTagChips(memory, t, react.createElement)
                )
              ),
              react.createElement('div', { className: 'dsh-session-kit-turn-memory-item-text' }, memory.text)
            ))
          )
        ), document.body)
      );
    }

    /* ── 「记忆」视图：注册进 conversation.view，紧随「轨迹」tab 之后 ──
       三栏分别展示本会话的固定注入 / 手动注入 / 自动注入记忆。
       数据口径为「本会话全部注入历史」：宿主端 sessionMemoryView 复用
       foldTurnContextMemory 按轮回放 surface 存活集合，已 eject 的记忆不出现。 */
    /* 段位徽标文案：只认四段（bottom/ephemeral/mixed/fallback）。
       其余情况（旧快照无 segment、pinned 补入、未知值）返回 null → 不渲染徽标。
       段位是「该轮召回竞争的结果」，同一条记忆在不同轮次可能落在不同段。 */
    function memorySegmentLabel(t, segment) {
      if (segment === 'bottom') return t('view.segmentBottom');
      if (segment === 'ephemeral') return t('view.segmentEphemeral');
      if (segment === 'mixed') return t('view.segmentMixed');
      if (segment === 'fallback') return t('view.segmentFallback');
      return null;
    }

    function SessionMemorySection({ title, hint, memories, t, expanded, onToggle }) {
      /* 本轮新召回数：与条目行里的绿色 + 同源（都读 memory.newRecall），
         保证「N 条 (+K)」的 K 与列表里可见的 + 个数一致。 */
      const newCount = memories.filter((memory) => memory.newRecall === true).length;
      return react.createElement('div', { className: 'dsh-session-kit-session-memory-section' },
        react.createElement('button', {
          type: 'button',
          className: 'dsh-session-kit-session-memory-section-head',
          'aria-expanded': expanded,
          onClick: onToggle
        },
          react.createElement('span', { className: 'dsh-session-kit-session-memory-chevron', 'data-open': expanded }, expanded ? '▾' : '▸'),
          react.createElement('span', { className: 'dsh-session-kit-session-memory-section-title' }, title),
          react.createElement('span', { className: 'dsh-session-kit-session-memory-section-count' },
            fillTemplate(t('view.count'), { count: memories.length }),
            newCount > 0 && react.createElement('span', {
              className: 'dsh-session-kit-turn-memory-new-count',
              title: t('view.newRecallTip'),
              'aria-label': fillTemplate(t('view.newRecallCount'), { count: newCount })
            }, ` (+${newCount})`)
          )
        ),
        hint ? react.createElement('div', { className: 'dsh-session-kit-session-memory-section-hint' }, hint) : null,
        expanded && memories.length === 0 && react.createElement('div', { className: 'dsh-session-kit-session-memory-muted' }, '—'),
        expanded && memories.map((memory) => react.createElement('div', {
          key: `${title}:${memory.id}`,
          className: 'dsh-session-kit-session-memory-item'
        },
          /* 首行：目录名占满剩余宽度，标记（段位徽标 + 新召回 +、固定 📌）被推到该行最右端。
             与插件其他复用 memory-meta-row 的地方区分，故加专用类限定。
             标记顺序：段位徽标（紧跟目录名右侧）→ 新召回 + → 固定 📌。
             固定召回不显示段位徽标（图钉已表达其身份，避免重复）。 */
          react.createElement('div', { className: 'dsh-session-kit-memory-meta-row dsh-session-kit-session-memory-item-meta' },
            react.createElement('span', { className: 'dsh-session-kit-memory-meta-value' }, memory.directoryName || t('memoryNoDirectory')),
            memory.pinned !== true && memorySegmentLabel(t, memory.segment) !== null && react.createElement('span', {
              className: `dsh-session-kit-session-memory-segment dsh-session-kit-session-memory-segment-${memory.segment}`,
              title: t('view.segmentTip'),
              role: 'img',
              'aria-label': memorySegmentLabel(t, memory.segment)
            }, memorySegmentLabel(t, memory.segment)),
            memory.newRecall === true && react.createElement('span', {
              className: 'dsh-session-kit-turn-memory-new-recall',
              /* 原生 title 悬浮提示，文案走本视图自己的命名空间键（不用 turnMemory.*，
                 那些键属于 TURNS_DEL_NS，本视图取不到会回显键名）。 */
              title: t('view.newRecallTip'),
              'aria-label': t('view.newRecallTip'),
              role: 'img'
            }, '+'),
            memory.pinned === true && react.createElement('span', {
              className: 'dsh-session-kit-turn-memory-pinned',
              title: t('view.pinnedTip'),
              'aria-label': t('view.pinnedTip'),
              role: 'img'
            }, '📌')
          ),
          Array.isArray(memory.tags) && memory.tags.length > 0 && react.createElement('div', { className: 'dsh-session-kit-memory-meta-row dsh-session-kit-memory-meta-tags-row' },
            react.createElement('span', { className: 'dsh-session-kit-memory-meta-tags' }, memoryTagChips(memory, t, react.createElement))
          ),
          react.createElement('div', { className: 'dsh-session-kit-session-memory-item-text' }, memory.text)
        ))
      );
    }

    /* 圆饼图：用 SVG circle + stroke-dasharray 画环形图，两段首尾相接。
       半径 26、周长 2πr；第一段（固定注入）画 pinnedPercent 长度，
       第二段用 stroke-dashoffset 前移到第一段末尾，画余下长度。
       空值（total=0）时不渲染，由调用方判定。 */
    function SessionMemoryPie({ pinnedPercent, autoPercent, totalCount, label }) {
      const size = 64;
      const stroke = 13;
      const radius = (size - stroke) / 2;
      const circumference = 2 * Math.PI * radius;
      const pinnedLength = (pinnedPercent / 100) * circumference;
      const autoLength = circumference - pinnedLength;
      return react.createElement('div', {
        className: 'dsh-session-kit-session-memory-pie',
        role: 'img',
        'aria-label': label,
        title: label
      },
        react.createElement('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true', focusable: 'false' },
          /* 轨道底色：百分比为 0 的那一段不会画出来，用底色补全视觉圆环。 */
          react.createElement('circle', {
            cx: size / 2,
            cy: size / 2,
            r: radius,
            fill: 'none',
            strokeWidth: stroke,
            className: 'dsh-session-kit-session-memory-pie-track'
          }),
          pinnedPercent > 0 && react.createElement('circle', {
            cx: size / 2,
            cy: size / 2,
            r: radius,
            fill: 'none',
            strokeWidth: stroke,
            className: 'dsh-session-kit-session-memory-pie-arc',
            'data-kind': 'pinned',
            strokeDasharray: `${pinnedLength} ${circumference - pinnedLength}`,
            strokeDashoffset: 0
          }),
          autoPercent > 0 && react.createElement('circle', {
            cx: size / 2,
            cy: size / 2,
            r: radius,
            fill: 'none',
            strokeWidth: stroke,
            className: 'dsh-session-kit-session-memory-pie-arc',
            'data-kind': 'auto',
            strokeDasharray: `${autoLength} ${circumference - autoLength}`,
            strokeDashoffset: -pinnedLength
          })
        ),
        /* 圆心放本轮注入总数：环形两段已表达比例，放总数比放某一个百分比更不易误读
           （后者会被当成整体占比）。总数由 pinnedCount + autoCount 推得。 */
        react.createElement('span', { className: 'dsh-session-kit-session-memory-pie-center' }, String(totalCount))
      );
    }

    function SessionMemoryView({ sessionId, getSessionMemoryView, t }) {
      const [loading, setLoading] = react.useState(true);
      const [error, setError] = react.useState(null);
      const [data, setData] = react.useState(null);
      const [query, setQuery] = react.useState('');
      const [collapsed, setCollapsed] = react.useState({});
      const alive = react.useRef(true);
      react.useEffect(() => {
        alive.current = true;
        return () => {
          alive.current = false;
        };
      }, []);
      const load = react.useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
          const value = await getSessionMemoryView();
          if (!alive.current) return;
          setData(value ?? null);
        } catch {
          if (alive.current) setError(t('view.failed'));
        } finally {
          if (alive.current) setLoading(false);
        }
      }, [getSessionMemoryView, t]);
      /* 会话切换或轮次推进后重新取数：sessionId 变化必然重载。 */
      react.useEffect(() => {
        void load();
      }, [load, sessionId]);
      const keyword = query.trim();
      const pick = (list) => {
        const source = Array.isArray(list) ? list : [];
        return keyword === '' ? source : source.filter((memory) => memoryMatches(memory, keyword));
      };
      const pinned = pick(data?.pinned);
      const manual = pick(data?.manual);
      const auto = pick(data?.auto);
      const total = (Array.isArray(data?.pinned) ? data.pinned.length : 0)
        + (Array.isArray(data?.manual) ? data.manual.length : 0)
        + (Array.isArray(data?.auto) ? data.auto.length : 0);
      const toggle = (key) => setCollapsed((value) => ({ ...value, [key]: value[key] !== true }));
      /* 圆饼图数据：分母为本轮注入总数（固定 + 自动），两者占比相加为 100%。
         未过滤前的原始条数才是「本轮注入构成」，因此不受搜索框影响。 */
      const pinnedCount = Array.isArray(data?.pinned) ? data.pinned.length : 0;
      const autoCount = Array.isArray(data?.auto) ? data.auto.length : 0;
      const pieTotal = pinnedCount + autoCount;
      /* 自动注入的四段构成：同样取未过滤的原始 data.auto（与饼图口径一致，不受搜索影响）。
         段位来自注入快照；老快照无 segment 的条目计入 unknown，不参与四段显示。 */
      const segmentBreakdown = (() => {
        const order = ['bottom', 'ephemeral', 'mixed', 'fallback'];
        const counts = { bottom: 0, ephemeral: 0, mixed: 0, fallback: 0 };
        let unknown = 0;
        for (const memory of Array.isArray(data?.auto) ? data.auto : []) {
          if (Object.prototype.hasOwnProperty.call(counts, memory?.segment)) counts[memory.segment] += 1;
          else unknown += 1;
        }
        return { order, counts, unknown, labeled: order.reduce((sum, key) => sum + counts[key], 0) };
      })();
      const percentOf = (part) => (pieTotal === 0 ? 0 : Math.round((part / pieTotal) * 100));
      const pinnedPercent = percentOf(pinnedCount);
      /* 余数归自动，保证两段之和恒为 100%（避免两次四舍五入后相加为 99% 或 101%）。 */
      const autoPercent = pieTotal === 0 ? 0 : 100 - pinnedPercent;
      return react.createElement('div', { className: 'dsh-session-kit-session-memory' },
        react.createElement('div', { className: 'dsh-session-kit-session-memory-head' },
          react.createElement('span', { className: 'dsh-session-kit-session-memory-head-main' },
            react.createElement(MemoryIcon, { size: 15 }),
            react.createElement('span', { className: 'dsh-session-kit-session-memory-head-title' }, t('view.title'))
          ),
          data?.turn !== null && data?.turn !== undefined && react.createElement('span', { className: 'dsh-session-kit-session-memory-turn' },
            fillTemplate(t('view.turnBadgeLatest'), { turn: data.turn })),
          react.createElement('button', {
            type: 'button',
            className: 'dsh-session-kit-session-memory-refresh',
            title: t('view.refresh'),
            'aria-label': t('view.refresh'),
            disabled: loading,
            onClick: () => void load()
          }, '↻')
        ),
        /* 圆饼图：仅在本轮确有注入时显示；搜索框上方，
           故先于搜索行渲染。总数为 0 时不占用垂直空间。 */
        !loading && error === null && pieTotal > 0 && react.createElement('div', { className: 'dsh-session-kit-session-memory-pie-row' },
          react.createElement(SessionMemoryPie, { pinnedPercent, autoPercent, totalCount: pieTotal, label: fillTemplate(t('view.pieLabel'), { pinnedPercent, autoPercent }) }),
          react.createElement('div', { className: 'dsh-session-kit-session-memory-pie-legend' },
            react.createElement('div', { className: 'dsh-session-kit-session-memory-pie-item' },
              react.createElement('span', { className: 'dsh-session-kit-session-memory-pie-swatch', 'data-kind': 'pinned', 'aria-hidden': 'true' }),
              react.createElement('span', { className: 'dsh-session-kit-session-memory-pie-text' },
                fillTemplate(t('view.legendPinned'), { count: pinnedCount, percent: pinnedPercent }))
            ),
            react.createElement('div', { className: 'dsh-session-kit-session-memory-pie-item' },
              react.createElement('span', { className: 'dsh-session-kit-session-memory-pie-swatch', 'data-kind': 'auto', 'aria-hidden': 'true' }),
              react.createElement('span', { className: 'dsh-session-kit-session-memory-pie-text' },
                fillTemplate(t('view.legendAuto'), { count: autoCount, percent: autoPercent }))
            )
          )
        ),
        /* 自动注入的四段构成：图表下方单独一行、居中显示，只列数量非 0 的段。
           格式：「自动注入构成：[ 段 1 底色 ] 3 条  [ 段 3 混合 ] 5 条」。
           与图例分开（图例表达固定/自动占比，此行表达自动注入内部的段位分布）。 */
        !loading && error === null && pieTotal > 0 && segmentBreakdown.labeled > 0 && react.createElement('div', { className: 'dsh-session-kit-session-memory-segments' },
          react.createElement('span', { className: 'dsh-session-kit-session-memory-segments-label' }, t('view.segmentBreakdown')),
          segmentBreakdown.order
            .filter((key) => segmentBreakdown.counts[key] > 0)
            .map((key) => react.createElement('span', {
              key,
              className: `dsh-session-kit-session-memory-segments-item dsh-session-kit-session-memory-segments-item-${key}`
            },
              react.createElement('span', { className: 'dsh-session-kit-session-memory-segments-name' }, `[ ${memorySegmentLabel(t, key)} ]`),
              react.createElement('span', { className: 'dsh-session-kit-session-memory-segments-count' }, fillTemplate(t('view.segmentCount'), { count: segmentBreakdown.counts[key] }))
            ))
        ),
        react.createElement('div', { className: 'dsh-session-kit-session-memory-search' },
          react.createElement('span', { className: 'dsh-session-kit-session-memory-search-icon', 'aria-hidden': 'true' },
            react.createElement(primitives.IconSearchOutlineRegular, { size: 13 })),
          react.createElement('input', {
            className: 'dsh-session-kit-session-memory-search-input',
            value: query,
            placeholder: t('view.searchPlaceholder'),
            'aria-label': t('view.searchPlaceholder'),
            onChange: (event) => setQuery(event.currentTarget.value)
          }),
          query !== '' && react.createElement('button', {
            type: 'button',
            className: 'dsh-session-kit-session-memory-search-clear',
            'aria-label': t('view.searchClear'),
            title: t('view.searchClear'),
            onClick: () => setQuery('')
          }, react.createElement(primitives.IconCloseOutlineRegular, { size: 13 }))
        ),
        loading && react.createElement('div', { className: 'dsh-session-kit-session-memory-muted' }, t('view.loading')),
        error !== null && react.createElement('div', { role: 'alert', className: 'dsh-session-kit-session-memory-error' }, error),
        !loading && error === null && total === 0 && react.createElement('div', { className: 'dsh-session-kit-session-memory-muted' }, t('view.empty')),
        !loading && error === null && keyword !== '' && pinned.length + manual.length + auto.length === 0
          && react.createElement('div', { className: 'dsh-session-kit-session-memory-muted' }, t('view.searchEmpty')),
        !loading && error === null && react.createElement('div', { className: 'dsh-session-kit-session-memory-body' },
          react.createElement(SessionMemorySection, {
            title: t('view.sectionPinned'),
            hint: t('view.sectionPinnedHint'),
            memories: pinned,
            t,
            expanded: collapsed.pinned !== true,
            onToggle: () => toggle('pinned')
          }),
          react.createElement(SessionMemorySection, {
            title: t('view.sectionAuto'),
            hint: t('view.sectionAutoHint'),
            memories: auto,
            t,
            expanded: collapsed.auto !== true,
            onToggle: () => toggle('auto')
          }),
          react.createElement(SessionMemorySection, {
            title: t('view.sectionManual'),
            hint: t('view.sectionManualHint'),
            memories: manual,
            t,
            expanded: collapsed.manual !== true,
            onToggle: () => toggle('manual')
          })
        )
      );
    }

    /* conversation.chat.turnTail 在当前内核（0.1.7-rc.2）声明为 list 槽：list 渲染既不消费
       options.select，也不注入 matched（select 仅 chain 槽生效）。此前组件直接解构 matched，
       于是每次渲染都因 matched === undefined 抛 TypeError，并被槽位错误边界永久 abdicate。
       这里改为双兼容：chain 槽沿用注入的 matched，list 槽由组件自身从 ownerProps.turn 选择，
       未命中返回 null（与官方 DeliverablesTail 的自选择写法一致）。 */
    function FailedTurnActions({ matched: injectedMatch, turn: failedTurn, delTurn, regenerateTurn, distillTurn, useSession, t }) {
      const matched = injectedMatch === undefined ? selectFailedTurnActions({ turn: failedTurn }) : injectedMatch;
      const anchorRef = react.useRef(null);
      const [portalHost, setPortalHost] = react.useState(null);
      react.useLayoutEffect(() => {
        if (matched === null) return;
        const anchor = anchorRef.current;
        if (anchor === null) return;
        const root = anchor.closest('[data-turn-tail]');
        if (!(root instanceof HTMLElement)) return;
        const host = document.createElement('span');
        host.dataset.dshFailedTurnActions = String(matched.turn);
        host.style.display = 'contents';
        let active = true;
        let frame = 0;
        const findActionRow = () => Array.from(root.children).find((child) => child instanceof HTMLElement && !child.contains(anchor) && Array.from(child.querySelectorAll('button')).some((button) => !host.contains(button)));
        const placeHost = () => {
          const actionRow = findActionRow();
          if (!(actionRow instanceof HTMLElement)) return false;
          const buttons = Array.from(actionRow.querySelectorAll('button')).filter((button) => !host.contains(button));
          const branchButton = buttons.at(-1);
          if (branchButton instanceof HTMLElement) {
            let before = branchButton;
            while (before.parentElement instanceof HTMLElement && before.parentElement !== actionRow) before = before.parentElement;
            if (before.parentElement === actionRow) {
              if (host.parentElement !== actionRow || host.nextSibling !== before) actionRow.insertBefore(host, before);
              return true;
            }
          }
          if (host.parentElement !== actionRow) actionRow.appendChild(host);
          return true;
        };
        if (placeHost()) setPortalHost(host);
        const schedulePlaceHost = () => {
          if (frame !== 0) return;
          frame = window.requestAnimationFrame(() => {
            frame = 0;
            if (!active) return;
            if (placeHost()) setPortalHost(host);
            else setPortalHost(null);
          });
        };
        const observer = new MutationObserver(schedulePlaceHost);
        observer.observe(root, { childList: true, subtree: true });
        if (host.parentElement === null) schedulePlaceHost();
        return () => {
          active = false;
          if (frame !== 0) window.cancelAnimationFrame(frame);
          observer.disconnect();
          setPortalHost(null);
          host.remove();
        };
      }, [matched === null ? null : matched.turn]);
      if (matched === null) return null;
      const actions = react.createElement(
        react.Fragment,
        null,
        react.createElement(RegenerateAction, { turn: matched.turn, regenerateTurn, useSession, t }),
        react.createElement(DistillTurnAction, { turn: matched.turn, distillTurn, useSession, t }),
        react.createElement(TurnsDelAction, { turn: matched.turn, delTurn, useSession, t })
      );
      return react.createElement(
        'span',
        {
          ref: anchorRef,
          'data-dsh-failed-turn-actions-anchor': matched.turn,
          style: portalHost === null ? { display: 'inline-flex', alignItems: 'center', gap: 10, marginLeft: -6 } : { display: 'contents' }
        },
        portalHost === null ? actions : reactDom.createPortal(actions, portalHost)
      );
    }

    function apply(ctx) {
      const updateSidebarEntries = async (next) => {
        const value = await sidebarEntriesRequest('POST', {
          memoryVisible: next?.memoryVisible !== false,
          archiveVisible: next?.archiveVisible !== false,
          taskVisible: next?.taskVisible !== false,
          leftNavEnabled: next?.leftNavEnabled !== false,
          rightNavEnabled: next?.rightNavEnabled !== false,
          memoryTabVisible: next?.memoryTabVisible !== false
        });
        setSidebarEntriesValue(value);
        return value;
      };
      void sidebarEntriesRequest('GET').then(setSidebarEntriesValue).catch(() => undefined);
      let exporter;
      try {
        exporter = ctx.get('sessionLogDownload');
      } catch {}

      ctx.effect(() => {
        const style = document.createElement('style');
        style.dataset.plugin = NS;
        style.textContent = `
          /* 右导航（话题导航）开启时隐藏 DSH 原生轮次导航轨（由它替代）；
             右导航在设置里关闭时（data-dsh-session-kit-right-nav="off"）恢复显示原生轨。 */
          html:not([data-dsh-session-kit-right-nav="off"]) .uEy0Ta_slot,
          html:not([data-dsh-session-kit-right-nav="off"]) .uEy0Ta_rail,
          html:not([data-dsh-session-kit-right-nav="off"]) nav[aria-label="轮次导航"],
          html:not([data-dsh-session-kit-right-nav="off"]) nav[aria-label="Turn navigation"] { display: none !important; }
          .dsh-session-kit-menu-anchor { display: inline-flex; }
          .dsh-session-kit-menu-chevron { display: inline-flex; align-items: center; justify-content: center; transform: rotate(0deg); transition: transform 180ms ease; transform-origin: 50% 50%; }
          .dsh-session-kit-menu-chevron-open { transform: rotate(180deg); }
          .dsh-session-kit-menu-anchor ~ [role="menu"] { left: calc(50% - 19px); transform: translateX(-50%); z-index: 1100; }
          html[data-dsh-session-kit-menu-open="true"] .dsh-session-kit-topic-nav-host { opacity: 0 !important; visibility: hidden !important; pointer-events: none !important; }
          .dsh-session-kit-menu-anchor ~ [role="menu"] [role="menuitem"] { height: 42px; min-height: 42px; display: flex; justify-content: center; align-items: center; gap: 8px; text-align: center; padding: 0 16px; }
          .dsh-session-kit-menu-anchor ~ [role="menu"] [role="menuitem"] > span { flex: 0 0 auto; width: auto; margin: 0; }
          .dsh-session-kit-menu-anchor ~ [role="menu"] [role="menuitem"] > span:first-child { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; }
          .dsh-session-kit-confirm { width: min(520px, calc(100vw - 32px)); box-sizing: border-box; }
          .dsh-session-kit-rename-modal { width: min(480px, calc(100vw - 32px)); box-sizing: border-box; }
          .dsh-session-kit-edit-modal { width: min(760px, calc(100vw - 32px)); box-sizing: border-box; }
          .dsh-session-kit-rename, .dsh-session-kit-edit { display: flex; flex-direction: column; gap: 8px; }
          .dsh-session-kit-rename-input { box-sizing: border-box; width: 100%; height: 38px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; outline: none; padding: 0 12px; }
          .dsh-session-kit-edit-textarea { box-sizing: border-box; width: 100%; min-height: 180px; max-height: min(52vh, 420px); resize: vertical; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; line-height: 1.55; outline: none; padding: 12px; }
          .dsh-session-kit-rename-input:focus, .dsh-session-kit-edit-textarea:focus { border-color: var(--dsw-alias-state-business-primary); box-shadow: 0 0 0 2px rgba(77, 107, 254, .14); }
          .dsh-session-kit-rename-error { color: var(--dsw-alias-state-error-primary); font-size: 13px; line-height: 1.5; }
          .dsh-session-kit-archive-modal, .dsh-session-kit-preview-modal { width: min(1100px, calc(100vw - 32px)); box-sizing: border-box; }
           @media (prefers-reduced-motion: reduce) { .dsh-session-kit-topic-panel, .dsh-session-kit-topic-marker, .dsh-session-kit-menu-chevron { transition: none !important; } }
          .dsh-session-kit-stats-modal { width: min(450px, calc(100vw - 32px)); box-sizing: border-box; }
          .dsh-session-kit-compaction-modal, .dsh-session-kit-global-prompt-modal { width: min(640px, calc(100vw - 32px)); box-sizing: border-box; }
          .dsh-session-kit-compaction, .dsh-session-kit-global-prompt { display: flex; flex-direction: column; gap: 14px; max-height: min(68vh, 620px); overflow-y: auto; padding-right: 4px; color: var(--dsw-alias-label-primary); }
          .dsh-session-kit-compaction-desc, .dsh-session-kit-compaction-help { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.6; white-space: pre-line; }
          .dsh-session-kit-compaction-error { padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 42%, transparent); border-radius: 10px; background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent); color: var(--dsw-alias-state-error-primary); font-size: 13px; line-height: 1.5; white-space: pre-line; }
          .dsh-session-kit-compaction-success { padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary, #12a150) 42%, transparent); border-radius: 10px; background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #12a150) 8%, transparent); color: var(--dsw-alias-state-success-primary, #12a150); font-size: 13px; line-height: 1.5; }
          .dsh-session-kit-compaction-toggle { display: flex; align-items: center; gap: 10px; min-height: 32px; color: var(--dsw-alias-label-primary); font-size: 14px; }
          .dsh-session-kit-compaction-field { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-base); }
          .dsh-session-kit-compaction-field-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; color: var(--dsw-alias-label-secondary); }
          .dsh-session-kit-compaction-field-head strong { color: var(--dsw-alias-label-primary); font-size: 18px; font-weight: 650; }
          .dsh-session-kit-compaction-slider-wrap { display: flex; flex-direction: column; gap: 4px; }
          .dsh-session-kit-compaction-dynamic-recommend { align-self: center; color: var(--dsw-alias-state-business-primary); font-size: 12px; font-weight: 650; line-height: 18px; }
          .dsh-session-kit-compaction-slider { width: 100%; accent-color: var(--dsw-alias-state-business-primary); }
          .dsh-session-kit-compaction-slider:disabled { opacity: .45; }
          .dsh-session-kit-compaction-scale { display: flex; justify-content: space-between; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
          .dsh-session-kit-compaction-field--row { display: grid; grid-template-columns: minmax(0, 1fr) 132px; align-items: center; gap: 14px; }
          .dsh-session-kit-compaction-field-text { min-width: 0; display: flex; flex-direction: column; gap: 4px; color: var(--dsw-alias-label-secondary); font-size: 13px; }
          .dsh-session-kit-compaction-field-text > span { color: var(--dsw-alias-label-primary); font-weight: 650; }
          .dsh-session-kit-compaction-field-text > p { margin: 0; color: var(--dsw-alias-label-secondary); line-height: 1.5; }
          .dsh-session-kit-compaction-number { box-sizing: border-box; width: 100%; height: 36px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; outline: none; padding: 0 10px; }
          .dsh-session-kit-compaction-number:disabled { opacity: .45; }
          .dsh-session-kit-compaction-number:focus { border-color: var(--dsw-alias-state-business-primary); box-shadow: 0 0 0 2px rgba(77, 107, 254, .14); }
          .dsh-session-kit-global-prompt-field { display: flex; flex-direction: column; gap: 8px; color: var(--dsw-alias-label-secondary); font-size: 13px; }
          .dsh-session-kit-global-prompt-field > span { color: var(--dsw-alias-label-primary); font-weight: 650; }
          .dsh-session-kit-global-prompt-field > small { align-self: flex-end; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
          .dsh-session-kit-global-prompt-textarea { box-sizing: border-box; width: 100%; min-height: 220px; max-height: min(48vh, 420px); resize: vertical; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 1.6; outline: none; padding: 12px; }
          .dsh-session-kit-global-prompt-textarea:disabled { opacity: .55; }
          .dsh-session-kit-global-prompt-textarea:focus { border-color: var(--dsw-alias-state-business-primary); box-shadow: 0 0 0 2px rgba(77, 107, 254, .14); }
          


          /* 桌面壳的 sidebar-footer-styles 会给 slot 锚节点加 overflow-y:auto；
             按规范这对会迫使 overflow-x 计算为 auto。收起侧边栏后锚节点内容盒仅约 28px，
             36px 圆形按钮必溢出，于是出现横向滚动条；此处显式声明 overflow-x: hidden，
             只去掉横向滚动条，保留桌面壳的 overflow-y: auto（launcher 过多时仍可纵向滚动）。 */
          html body[data-dsh-desktop-mode] [data-slot="sidebar.footer.action"] { display: unset !important; width: 100% !important; overflow-x: hidden !important; }
          [data-slot="sidebar.footer.action"] { display: unset !important; width: 100% !important; overflow-x: hidden !important; }
          .dsh-session-kit-sidebar-row { flex: none; align-items: center; gap: 8px; width: calc(100% + 4px); margin: 0 -2px; display: flex; }
          .dsh-session-kit-sidebar-rail-row { justify-content: center; width: 36px; margin: 0; }
          .dsh-session-kit-sidebar-trigger { box-sizing: border-box; cursor: pointer; width: auto; min-width: 0; height: 42px; color: var(--dsw-alias-label-primary); background: 0 0; border: none; border-radius: 12px; flex: 1; align-items: center; gap: 8px; margin: 0; padding: 0 10px 0 8px; font-family: inherit; font-size: 14px; line-height: 22px; display: flex; overflow: hidden; }
          .dsh-session-kit-sidebar-trigger:hover { background: var(--dsw-alias-interactive-bg-hover); }
          .dsh-session-kit-sidebar-trigger.dsh-session-kit-sidebar-rail { corner-shape: round; border-radius: 50%; flex: none; justify-content: center; gap: 0; width: 36px; height: 36px; margin: 0; padding: 0; }
          .dsh-session-kit-sidebar-label { white-space: nowrap; overflow: hidden; }

          /* ── 任务管理弹窗 ── */
          /* 固定 80vh：dialog 已知是 flex column，须让 content 吃掉 header/footer 之外的剩余高度，
             再让 body 撑满 content，内部列表才有确定的滚动高度。 */
          .dsh-session-kit-task-modal, .dsh-session-kit-trash-modal { width: min(1040px, calc(100vw - 32px)); height: 80vh; box-sizing: border-box; }
          .dsh-session-kit-task-modal > [class*="content"], .dsh-session-kit-trash-modal > [class*="content"] { flex: 1; min-height: 0; }
          .dsh-session-kit-task-modal > [class*="content"] > [class*="body"], .dsh-session-kit-trash-modal > [class*="content"] > [class*="body"] { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
          .dsh-session-kit-task-detail-modal { width: min(900px, calc(100vw - 32px)); height: 80vh; box-sizing: border-box; }
          .dsh-session-kit-task-detail-modal > [class*="content"] { flex: 1; min-height: 0; }
          .dsh-session-kit-task-detail-modal > [class*="content"] > [class*="body"] { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
          /* flex: 1 让 root 撑满弹窗剩余高度，列表才能按剩余空间滚动。 */
          .dsh-session-kit-task-root { display: flex; flex-direction: column; gap: 10px; flex: 1; min-height: 0; color: var(--dsw-alias-label-primary); }
          .dsh-session-kit-task-toolbar { display: grid; grid-template-columns: auto minmax(220px, 1fr) auto auto; align-items: center; gap: 10px; padding: 2px 0; }
          .dsh-session-kit-task-toolbar-left { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
          /* 「新增任务」按钮：圆角与筛选按钮组一致（11px）。
             size="sm" 默认 14px，故需覆盖；用 !important 确保盖过 primitives 的样式表顺序。 */
          .dsh-session-kit-task-add-button { border-radius: 11px !important; }
          .dsh-session-kit-task-filters { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 3px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 11px; background: var(--dsw-alias-bg-base); }
          .dsh-session-kit-task-filters > button { border: 0; border-radius: 8px; background: transparent; box-shadow: none; color: var(--dsw-alias-label-secondary); white-space: nowrap; transition: background-color .16s ease, color .16s ease; }
          .dsh-session-kit-task-filters > button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
          .dsh-session-kit-task-filters > button.dsh-session-kit-task-filter-active { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, var(--dsw-alias-bg-base)); color: var(--dsw-alias-state-business-primary); }
          .dsh-session-kit-task-search-wrap { position: relative; display: flex; align-items: center; min-width: 0; }
          .dsh-session-kit-task-search { width: 100%; min-width: 0; box-sizing: border-box; height: 36px; padding: 0 38px 0 12px; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; outline: none; transition: border-color .16s ease, box-shadow .16s ease; }
          /* type="search" 的原生清除按钮会和自定义清除按钮叠成两个 ×；隐藏原生，保留最右侧的自定义按钮。 */
          .dsh-session-kit-task-search::-webkit-search-cancel-button { -webkit-appearance: none; appearance: none; display: none; }
          .dsh-session-kit-task-search::placeholder { color: var(--dsw-alias-label-tertiary); }
          .dsh-session-kit-task-search:focus-visible { border-color: var(--dsw-alias-state-business-primary); box-shadow: 0 0 0 2px rgba(77, 107, 254, .14); }
          .dsh-session-kit-task-search-clear { position: absolute; right: 6px; top: 50%; width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 999px; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; transform: translateY(-50%); }
          .dsh-session-kit-task-search-clear:hover, .dsh-session-kit-task-search-clear:focus-visible { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); outline: none; }
          .dsh-session-kit-task-result-count { min-width: 52px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 20px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
          .dsh-session-kit-task-trash-button { border-radius: 11px !important; }

          /* ── 回收站弹窗（固定宽高与任务管理一致，列表复用任务卡片样式） ── */
          .dsh-session-kit-trash-notice { padding: 8px 12px; border-radius: 10px; background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #12a150) 10%, transparent); color: var(--dsw-alias-state-success-primary, #12a150); font-size: 13px; line-height: 1.5; }
          .dsh-session-kit-task-notice, .dsh-session-kit-task-error { padding: 9px 11px; border-radius: 10px; font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
          .dsh-session-kit-task-notice { border: 1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 36%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 8%, transparent); color: var(--dsw-alias-state-business-primary); }
          .dsh-session-kit-task-error { border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 42%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent); color: var(--dsw-alias-state-error-primary); }
          .dsh-session-kit-task-empty { flex: 1; min-height: 180px; display: flex; align-items: center; justify-content: center; box-sizing: border-box; padding: 32px 16px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 14px; color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px; text-align: center; }
          /* flex: 1 占满工具栏与分页之间的剩余高度；任务不足时收缩到内容高度。 */
          .dsh-session-kit-task-list { display: flex; flex-direction: column; gap: 10px; flex: 1 1 auto; min-height: 0; overflow: auto; padding: 2px 3px 3px 2px; scrollbar-gutter: stable; }
          /* flex: none 防止卡片在滚动容器内被压缩——否则展开的子任务会被自身 overflow: hidden 裁掉。
             overflow: hidden 保留用于裁剪左侧状态色条圆角；卡片高度随内容增长。 */
          .dsh-session-kit-task-card { position: relative; display: flex; flex-direction: column; gap: 11px; flex: none; box-sizing: border-box; min-width: 0; padding: 14px 15px 13px 17px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; background: var(--dsw-alias-bg-base); overflow: hidden; transition: border-color .18s ease, background-color .18s ease, box-shadow .18s ease; }
          .dsh-session-kit-task-card::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 3px; background: var(--dsw-alias-label-tertiary); opacity: .55; }
          .dsh-session-kit-task-card:hover { border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 38%, var(--dsw-alias-border-l2)); background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 3%, var(--dsw-alias-bg-base)); box-shadow: 0 4px 14px color-mix(in srgb, var(--dsw-alias-state-business-primary) 9%, transparent); }
          .dsh-session-kit-task-card-not_started::before { background: var(--dsw-alias-label-tertiary); opacity: 1; }
          .dsh-session-kit-task-card-active::before { background: var(--dsw-alias-state-business-primary); opacity: 1; }
          .dsh-session-kit-task-card-completed::before { background: var(--dsw-alias-state-success-primary, #12a150); opacity: 1; }
          .dsh-session-kit-task-card-paused::before { background: var(--dsw-alias-state-warning-primary, #d89614); opacity: 1; }
          .dsh-session-kit-task-card-abandoned::before { background: var(--dsw-alias-state-error-primary); opacity: 1; }
          .dsh-session-kit-task-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; min-width: 0; }
          .dsh-session-kit-task-card-title-wrap { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
          .dsh-session-kit-task-card-name { margin: 0; font-size: 15px; line-height: 21px; font-weight: 650; color: var(--dsw-alias-label-primary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .dsh-session-kit-task-card-project { min-width: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 17px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .dsh-session-kit-task-status { flex: none; font-size: 12px; line-height: 18px; padding: 2px 9px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-interactive-bg-hover); }
          .dsh-session-kit-task-status-not_started { color: var(--dsw-alias-label-secondary); border-color: var(--dsw-alias-border-l2); background: color-mix(in srgb, var(--dsw-alias-label-secondary) 10%, transparent); }
          .dsh-session-kit-task-status-active { border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 42%, var(--dsw-alias-border-l2)); color: var(--dsw-alias-state-business-primary); background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 9%, transparent); }
          .dsh-session-kit-task-status-completed { border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #12a150) 42%, var(--dsw-alias-border-l2)); color: var(--dsw-alias-state-success-primary, #12a150); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #12a150) 9%, transparent); }
          .dsh-session-kit-task-status-paused { border-color: color-mix(in srgb, var(--dsw-alias-state-warning-primary, #d89614) 42%, var(--dsw-alias-border-l2)); color: var(--dsw-alias-state-warning-primary, #d89614); background: color-mix(in srgb, var(--dsw-alias-state-warning-primary, #d89614) 9%, transparent); }
          .dsh-session-kit-task-status-abandoned { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 42%, var(--dsw-alias-border-l2)); color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 9%, transparent); }
          .dsh-session-kit-task-chart { display: flex; align-items: center; justify-content: center; gap: 24px; flex: none; min-height: 152px; padding: 6px 0; }
          .dsh-session-kit-task-chart-donut { width: 136px; height: 136px; flex: none; }
          .dsh-session-kit-task-chart-total-value { fill: var(--dsw-alias-label-primary); font-size: 7.5px; font-weight: 600; }
          .dsh-session-kit-task-chart-total-label { fill: var(--dsw-alias-label-tertiary); font-size: 3.2px; }
          .dsh-session-kit-task-chart-legend { display: flex; min-width: 0; flex: 0 1 auto; max-width: 60%; flex-direction: column; justify-content: center; gap: 4px; }
          .dsh-session-kit-task-chart-legend-item { display: flex; align-items: center; gap: 8px; min-height: 26px; padding: 2px 8px; border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; cursor: pointer; text-align: left; }
          .dsh-session-kit-task-chart-legend-item:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
          .dsh-session-kit-task-chart-dot { width: 9px; height: 9px; flex: none; border-radius: 50%; }
          .dsh-session-kit-task-progress-row { display: flex; align-items: baseline; gap: 7px; }
          .dsh-session-kit-task-progress-label { color: var(--dsw-alias-label-secondary); font-size: 12px; }
          .dsh-session-kit-task-progress-value { color: var(--dsw-alias-label-primary); font-size: 13px; font-variant-numeric: tabular-nums; }
          .dsh-session-kit-task-progress-percent { margin-left: auto; color: var(--dsw-alias-label-tertiary); font-size: 12px; font-variant-numeric: tabular-nums; }
          .dsh-session-kit-task-progress-track { height: 6px; border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover); overflow: hidden; }
          .dsh-session-kit-task-progress-fill { display: block; height: 100%; border-radius: inherit; background: var(--dsw-alias-state-business-primary); transition: width .22s ease; }
          .dsh-session-kit-task-card-completed .dsh-session-kit-task-progress-fill { background: var(--dsw-alias-state-success-primary, #12a150); }
          .dsh-session-kit-task-card-stats { display: flex; flex-wrap: wrap; gap: 7px; }
          .dsh-session-kit-task-stat { display: inline-flex; align-items: center; gap: 5px; min-height: 25px; box-sizing: border-box; padding: 3px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 17px; }
          .dsh-session-kit-task-stat strong { color: var(--dsw-alias-label-primary); font-size: 12px; font-variant-numeric: tabular-nums; }
          .dsh-session-kit-task-stat-toggle { cursor: pointer; align-items: center; font-family: inherit; box-shadow: none; transition: background-color .16s ease, border-color .16s ease; }
          .dsh-session-kit-task-stat-toggle:hover { border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 38%, var(--dsw-alias-border-l2)); background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 6%, transparent); color: var(--dsw-alias-label-primary); }
          .dsh-session-kit-task-stat-toggle-open { border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 38%, var(--dsw-alias-border-l2)); }
          .dsh-session-kit-task-stat-chevron { display: inline-flex; color: var(--dsw-alias-label-tertiary); }
          .dsh-session-kit-task-stat-toggle:hover .dsh-session-kit-task-stat-chevron, .dsh-session-kit-task-stat-toggle-open .dsh-session-kit-task-stat-chevron { color: var(--dsw-alias-state-business-primary); }
          .dsh-session-kit-task-card-items { display: flex; flex-direction: column; gap: 6px; flex: none; }
          .dsh-session-kit-task-card-sessions { gap: 4px; }
          .dsh-session-kit-task-card-sessions .dsh-session-kit-task-session-id { flex: 0 1 auto; }
          .dsh-session-kit-task-card-item { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 7px 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-bg-base); font-size: 13px; }
          .dsh-session-kit-task-card-item-check { flex: none; display: inline-flex; color: var(--dsw-alias-state-success-primary, #12a150); }
          .dsh-session-kit-task-card-item-check-none { width: 14px; }
          .dsh-session-kit-task-card-item-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary); }
          .dsh-session-kit-task-card-item-loading { justify-content: center; padding: 9px; color: var(--dsw-alias-label-tertiary); }
          .dsh-session-kit-task-card-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding-top: 1px; }
          .dsh-session-kit-task-card-actions > button { min-height: 32px; }
          /* 时间紧贴「任务详情」按钮右侧、整体靠左；仅最后一个按钮（注入）被推到最右。 */
          .dsh-session-kit-task-card-actions > button:last-child { margin-left: auto; }
          .dsh-session-kit-task-card-times { min-width: 0; flex: 0 1 auto; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .dsh-session-kit-task-card-times-sep { margin: 0 6px; opacity: .7; }
          .dsh-session-kit-task-card-head-actions { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 6px; flex: none; min-width: 0; }
          .dsh-session-kit-task-card-head-actions > button { min-height: 28px; padding: 0 9px; border-radius: 8px; font-size: 12px; line-height: 18px; }
          .dsh-session-kit-task-card-head-actions .dsh-session-kit-task-card-head-btn-danger { color: var(--dsw-alias-state-error-primary); }
          .dsh-session-kit-task-card-head-actions .dsh-session-kit-task-card-head-btn-danger:hover { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 55%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent); }
          .dsh-session-kit-task-edit-modal { width: min(480px, calc(100vw - 32px)); box-sizing: border-box; }
          /* 分页控件固定在弹窗底部，不参与弹性收缩。 */
          .dsh-session-kit-task-modal .dsh-session-kit-memory-pagination { flex: none; padding-top: 2px; }
          /* 弹窗底部：左侧「自动注入开关 + 提取当前会话任务」，右侧「关闭」。 */
          .dsh-session-kit-task-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; }
          .dsh-session-kit-task-footer-left { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
          .dsh-session-kit-task-edit-fields { display: flex; flex-direction: column; gap: 14px; min-width: min(340px, 60vw); padding: 2px 4px 4px; }
          /* 初始子任务动态输入行 */
          .dsh-session-kit-task-create-tip { padding: 8px 10px; border: 1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 28%, var(--dsw-alias-border-l2)); border-radius: 10px; background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 7%, transparent); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
          .dsh-session-kit-task-item-editor-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
          .dsh-session-kit-task-item-editor { display: flex; flex-direction: column; gap: 6px; max-height: 220px; overflow-y: auto; padding-right: 2px; }
          .dsh-session-kit-task-item-editor-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
          .dsh-session-kit-task-item-editor-row > input { flex: 1 1 auto; min-width: 0; }
          /* 删除按钮：小圆角方形图标按钮，与输入框等高；悬浮变红以示危险操作。 */
          .dsh-session-kit-task-item-editor-remove { flex: none; width: 36px; min-width: 36px; height: 36px; padding: 0; border-radius: 4px; display: inline-flex; align-items: center; justify-content: center; transition: color .16s ease, border-color .16s ease, background-color .16s ease; }
          .dsh-session-kit-task-item-editor-remove:hover:not(:disabled) { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 55%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent); }
          /* 添加子任务：小圆角，与删除按钮风格统一。 */
          .dsh-session-kit-task-item-editor-add { border-radius: 4px; }
          .dsh-session-kit-task-edit-field { display: flex; flex-direction: column; gap: 5px; }
          .dsh-session-kit-task-edit-field label { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; font-weight: 500; }
          .dsh-session-kit-task-edit-field input, .dsh-session-kit-task-edit-field select { min-height: 36px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; outline: none; transition: border-color .16s ease, box-shadow .16s ease; }
          .dsh-session-kit-task-edit-field textarea { min-height: 84px; padding: 8px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 20px; resize: vertical; outline: none; transition: border-color .16s ease, box-shadow .16s ease; }
          .dsh-session-kit-task-edit-field input::placeholder, .dsh-session-kit-task-edit-field textarea::placeholder { color: var(--dsw-alias-label-tertiary); }
          .dsh-session-kit-task-edit-field input:focus-visible, .dsh-session-kit-task-edit-field select:focus-visible, .dsh-session-kit-task-edit-field textarea:focus-visible { border-color: var(--dsw-alias-state-business-primary); box-shadow: 0 0 0 2px rgba(77, 107, 254, .14); }
          /* 滚动条：任务管理统一 6px 细胶囊 —— 任务列表、任务详情、附加信息框、
             初始子任务编辑区四处一致。
             注意两点（实测得出）：
             ① 不写 scrollbar-width/scrollbar-color —— 它们与 ::-webkit-scrollbar 共存时
                会让 Chromium 实际占宽变大（声明 8px 时实际渲染为 10px）；
             ② ::-webkit-scrollbar 只声明 width/height，附加 background 等同样会撑宽。 */
          @supports selector(::-webkit-scrollbar) {
            .dsh-session-kit-task-list::-webkit-scrollbar,
            .dsh-session-kit-task-detail::-webkit-scrollbar,
            .dsh-session-kit-task-item-editor::-webkit-scrollbar,
            .dsh-session-kit-task-edit-field textarea::-webkit-scrollbar { width: 6px; height: 6px; }
            .dsh-session-kit-task-list::-webkit-scrollbar-button,
            .dsh-session-kit-task-detail::-webkit-scrollbar-button,
            .dsh-session-kit-task-item-editor::-webkit-scrollbar-button,
            .dsh-session-kit-task-edit-field textarea::-webkit-scrollbar-button { -webkit-appearance: none !important; appearance: none !important; display: none !important; width: 0 !important; height: 0 !important; }
            .dsh-session-kit-task-list::-webkit-scrollbar-thumb,
            .dsh-session-kit-task-detail::-webkit-scrollbar-thumb,
            .dsh-session-kit-task-item-editor::-webkit-scrollbar-thumb,
            .dsh-session-kit-task-edit-field textarea::-webkit-scrollbar-thumb { border-radius: 999px; background: color-mix(in srgb, var(--dsw-alias-label-caption) 48%, transparent); }
            .dsh-session-kit-task-list::-webkit-scrollbar-thumb:hover,
            .dsh-session-kit-task-detail::-webkit-scrollbar-thumb:hover,
            .dsh-session-kit-task-item-editor::-webkit-scrollbar-thumb:hover,
            .dsh-session-kit-task-edit-field textarea::-webkit-scrollbar-thumb:hover { background: color-mix(in srgb, var(--dsw-alias-label-caption) 62%, transparent); }
            .dsh-session-kit-task-list::-webkit-scrollbar-track,
            .dsh-session-kit-task-detail::-webkit-scrollbar-track,
            .dsh-session-kit-task-item-editor::-webkit-scrollbar-track,
            .dsh-session-kit-task-edit-field textarea::-webkit-scrollbar-track { background: transparent; }
          }
          /* Firefox 不支持 ::-webkit-scrollbar，用标准属性近似（仅 Firefox 生效，
             放在 @-moz-document 内以免干扰 Chromium 的 6px 宽度）。 */
          @-moz-document url-prefix() {
            .dsh-session-kit-task-list,
            .dsh-session-kit-task-detail,
            .dsh-session-kit-task-item-editor,
            .dsh-session-kit-task-edit-field textarea { scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--dsw-alias-label-caption) 48%, transparent) transparent; }
          }
          .dsh-session-kit-task-detail { display: flex; flex-direction: column; gap: 10px; flex: 1; min-height: 0; overflow: auto; padding: 2px 3px 3px 2px; scrollbar-gutter: stable; }
          .dsh-session-kit-task-card-meta { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
          .dsh-session-kit-task-meta-path { color: var(--dsw-alias-label-tertiary); }
          .dsh-session-kit-task-item-status-active { color: var(--dsw-alias-state-business-primary); background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent); }
          .dsh-session-kit-task-item-status-completed { color: var(--dsw-alias-state-success-primary, #12a150); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #12a150) 10%, transparent); }
          .dsh-session-kit-task-item-status-paused { color: var(--dsw-alias-state-warning-primary, #d89614); background: color-mix(in srgb, var(--dsw-alias-state-warning-primary, #d89614) 10%, transparent); }
          .dsh-session-kit-task-item-status-blocked, .dsh-session-kit-task-item-status-aborted { color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }
          .dsh-session-kit-task-section-title { padding-top: 5px; border-top: 1px solid var(--dsw-alias-border-l2); font-size: 12px; line-height: 18px; font-weight: 650; color: var(--dsw-alias-label-secondary); margin-top: 4px; }
          .dsh-session-kit-task-item { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 7px 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-bg-base); font-size: 13px; }
          .dsh-session-kit-task-item-expand { margin-left: auto; flex: none; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; }
          .dsh-session-kit-task-item-expand:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
          .dsh-session-kit-task-item-detail-panel { display: flex; flex-direction: column; gap: 6px; min-width: 0; margin: 4px 0 2px 16px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-bg-base); }
          .dsh-session-kit-task-item-panel-status { display: flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
          .dsh-session-kit-task-item-check { flex: none; display: inline-flex; color: var(--dsw-alias-state-success-primary, #12a150); }
          .dsh-session-kit-task-item-check-none { width: 14px; }
          .dsh-session-kit-task-item-status { flex: none; font-size: 11px; line-height: 17px; padding: 1px 6px; border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
          .dsh-session-kit-task-item-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary); }
          .dsh-session-kit-task-item-meta { flex: none; margin-left: auto; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
          .dsh-session-kit-task-op { display: flex; flex-direction: column; gap: 3px; min-width: 0; padding: 6px 8px; border-radius: 8px; background: var(--dsw-alias-interactive-bg-hover); font-size: 12px; color: var(--dsw-alias-label-secondary); }
          .dsh-session-kit-task-op-main { display: flex; gap: 8px; min-width: 0; }
          .dsh-session-kit-task-op-kind { flex: none; color: var(--dsw-alias-label-tertiary); min-width: 44px; }
          .dsh-session-kit-task-op-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .dsh-session-kit-task-op-objects { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-left: 52px; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
          .dsh-session-kit-task-op-objects-label { color: var(--dsw-alias-label-tertiary); opacity: .8; }
          .dsh-session-kit-task-op-error .dsh-session-kit-task-op-text { color: var(--dsw-alias-state-error-primary); }
          .dsh-session-kit-task-item-sub { flex: none; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
          .dsh-session-kit-task-item-files { flex: none; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
          .dsh-session-kit-task-context-mark { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 6px 9px; border-radius: 8px; background: var(--dsw-alias-interactive-bg-hover); font-size: 12px; color: var(--dsw-alias-label-secondary); }
          .dsh-session-kit-task-context-key { flex: none; min-width: 88px; color: var(--dsw-alias-label-tertiary); }
          .dsh-session-kit-task-context-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary); }
          .dsh-session-kit-task-context-time { flex: none; margin-left: auto; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
          .dsh-session-kit-task-session-row { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 6px 9px; border-radius: 8px; background: var(--dsw-alias-interactive-bg-hover); font-size: 12px; color: var(--dsw-alias-label-secondary); }
          .dsh-session-kit-task-session-id { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary); }
          .dsh-session-kit-task-session-copy { display: inline-flex; align-items: center; gap: 4px; flex: none; border: 0; padding: 0; background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 11px; font-variant-numeric: tabular-nums; text-align: left; cursor: pointer; }
          .dsh-session-kit-task-session-copy:hover { color: var(--dsw-alias-label-primary); text-decoration: underline; }
          .dsh-session-kit-task-session-copy:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; border-radius: 2px; }
          .dsh-session-kit-task-session-copy-copied { color: var(--dsw-alias-state-success-primary); }
          .dsh-session-kit-task-session-turns { flex: none; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
          .dsh-session-kit-task-session-time { flex: none; margin-left: auto; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
          .dsh-session-kit-task-truncated-hint { padding: 5px 2px; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; text-align: center; }
          .dsh-session-kit-task-pitfall { padding: 7px 9px; border-left: 3px solid var(--dsw-alias-state-warning-primary, #d89614); border-radius: 6px; background: color-mix(in srgb, var(--dsw-alias-state-warning-primary, #d89614) 8%, transparent); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
          @media (prefers-reduced-motion: reduce) { .dsh-session-kit-task-filters > button, .dsh-session-kit-task-search, .dsh-session-kit-task-card, .dsh-session-kit-task-progress-fill { transition: none !important; } }
          @media (max-width: 760px) { .dsh-session-kit-task-toolbar { grid-template-columns: minmax(0, 1fr) auto auto; } .dsh-session-kit-task-toolbar-left { grid-column: 1 / -1; } .dsh-session-kit-task-filters { width: max-content; max-width: 100%; } .dsh-session-kit-task-search-wrap { grid-column: 1; } .dsh-session-kit-task-trash-button { grid-column: 2; } .dsh-session-kit-task-result-count { grid-column: 3; } .dsh-session-kit-task-card-head { gap: 8px; } }
          @media (max-width: 460px) { .dsh-session-kit-task-modal, .dsh-session-kit-trash-modal, .dsh-session-kit-task-detail-modal, .dsh-session-kit-task-edit-modal { width: calc(100vw - 20px); } .dsh-session-kit-task-toolbar { grid-template-columns: 1fr; } .dsh-session-kit-task-toolbar-left, .dsh-session-kit-task-search-wrap, .dsh-session-kit-task-result-count { grid-column: 1; width: 100%; } .dsh-session-kit-task-trash-button { grid-column: 1; justify-self: start; } .dsh-session-kit-task-result-count { text-align: left; } .dsh-session-kit-task-filters { width: max-content; max-width: 100%; } .dsh-session-kit-task-card-head { flex-direction: column; } .dsh-session-kit-task-status, .dsh-session-kit-task-card-head-actions { align-self: flex-start; justify-content: flex-start; } .dsh-session-kit-task-card-actions > button { flex: 1 1 auto; } }
           .dsh-session-kit-memory-modal { width: min(1180px, calc(100vw - 32px)); max-height: 100%; box-sizing: border-box; }
          /* 记忆管理弹窗的限高与内部滚动：与新建/编辑记忆弹窗【同一套约束】。
             两者若不统一，会出现「一个被 max-height 压缩、另一个不受限」的不对称，
             同样的固定内容高度会渲染出不同总高（用户可见的高度不一致）。
             补齐三项与 memory-form-modal 对称：content 可伸缩、body 承担滚动、header/footer 不被压缩。
             注意 body 这里是 overflow:hidden（内部 .dsh-session-kit-memory 自己滚动），
             与编辑弹窗的 body 直接 overflow-y:auto 是两种结构、效果等价。 */
          .dsh-session-kit-memory-modal > [class*="content"] { flex: 1 1 auto; min-height: 0; }
          .dsh-session-kit-memory-modal > [class*="content"] > [class*="body"] { flex: 1 1 auto; min-height: 0; overflow: hidden; }
          .dsh-session-kit-memory-modal > [class*="content"] > [class*="header"],
          .dsh-session-kit-memory-modal > [class*="footer"] { flex: none; }
          .dsh-session-kit-memory-modal [class*="header"] { position: relative; }
          .dsh-session-kit-modal-title { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
          .dsh-session-kit-modal-title-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .dsh-session-kit-entry-visibility-toggle { flex: none; max-width: min(42vw, 280px); gap: 6px; }
          .dsh-session-kit-entry-visibility-toggle > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          /* 标题区可选说明文字（仅任务弹窗使用）：弱化色、单行省略，跟随开关右侧。 */
          .dsh-session-kit-modal-title-hint { flex: none; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
          .dsh-session-kit-modal-title-notice { position: absolute; left: 50%; top: 22px; width: 50%; max-width: 50%; min-height: 28px; box-sizing: border-box; margin: 0 !important; padding: 4px 10px !important; transform: translateX(-50%); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center; pointer-events: none; z-index: 1; }
          .dsh-session-kit-modal-title-notice + .dsh-session-kit-modal-title-notice { top: 54px; }
          .dsh-session-kit-memory-modal > [class*="content"] > [class*="body"] { margin-top: 0; }
          /* 固定高度 min(74vh, 760px) 是「记忆内容区」的期望高度；再叠加 flex: 1 1 auto + min-height: 0，
             使窗口不够高时它随 body 一起收缩（内部各区自行滚动），而不是溢出后被 body 裁掉。
             用长度上限而非 max-height:100%：百分比要依赖 body 高度已确定，flex 链上存在解析不确定的情况。 */
          .dsh-session-kit-memory { display: flex; flex-direction: column; gap: 12px; flex: 1 1 auto; min-height: 0; height: min(74vh, 760px); max-height: min(74vh, 760px); overflow: hidden; padding-right: 0; color: var(--dsw-alias-label-primary); }
          .dsh-session-kit-memory-store-info { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
          .dsh-session-kit-memory-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; flex: none; }
          .dsh-session-kit-memory-top-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; align-items: center; min-width: 0; }
          /* 表单弹窗（新建/编辑记忆、目录、标签）的宽度与限高统一见下方 memory-form-modal 规则块，
             此处不再重复声明——同一选择器拆两处写会让后续调整漏改一处。 */
          /* 正文版本历史弹窗 */
          .dsh-session-kit-memory-history-modal { width: min(680px, calc(100vw - 32px)); max-height: 100%; box-sizing: border-box; }
          /* 历史弹窗内部已是固定高度滚动区（max-height 60vh），这里补 max-height:100% 只是
             防御「窗口很矮时 60vh 仍高于可用高度」的极端情况，与表单弹窗同源问题。 */
          .dsh-session-kit-memory-history-modal > [class*="content"] { flex: 1 1 auto; min-height: 0; }
          .dsh-session-kit-memory-history-modal > [class*="content"] > [class*="body"] { overflow-y: auto; min-height: 0; }
          .dsh-session-kit-memory-history-modal > [class*="content"] > [class*="header"],
          .dsh-session-kit-memory-history-modal > [class*="footer"] { flex: none; }
          .dsh-session-kit-memory-history { display: flex; flex-direction: column; gap: 10px; max-height: min(60vh, 520px); overflow-y: auto; padding-right: 2px; }
          .dsh-session-kit-memory-history-item { display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-interactive-bg-hover); padding: 10px 12px; }
          .dsh-session-kit-memory-history-item-current { border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 45%, var(--dsw-alias-border-l2)); background: var(--dsw-alias-bg-base); }
          .dsh-session-kit-memory-history-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
          .dsh-session-kit-memory-history-badge { flex: none; padding: 1px 8px; border-radius: 999px; background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent); color: var(--dsw-alias-state-business-primary); font-size: 12px; line-height: 18px; }
          .dsh-session-kit-memory-history-meta { min-width: 0; flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
          .dsh-session-kit-memory-history-text { max-height: 160px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; line-height: 1.55; }
          .dsh-session-kit-memory-history-count { margin-right: auto; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
          .dsh-session-kit-memory-history-button { gap: 6px; }
          /* 差异视图：复用活动日志的红绿行级渲染，外加一层浅底与提示行。 */
          .dsh-session-kit-memory-history-diff { margin-top: 2px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-base); }
          .dsh-session-kit-memory-history-diff-hint { margin-bottom: 6px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
          .dsh-session-kit-memory-history-diff-button { flex: none; white-space: nowrap; }
          .dsh-session-kit-memory-history-diff-on { color: var(--dsw-alias-state-business-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 55%, var(--dsw-alias-border-l2)); background: var(--dsw-alias-interactive-bg-hover); }
          /* 覆盖 DSH Modal 内部间距，仅限本插件表单弹窗。
             ⚠️ 不要用 :nth-child 猜层级：Modal 的真实结构是
             dialog > .content >（.header > h2.title + button.close）, .description, .body，以及 .dialog 直属的 .footer。
             这里的属性选择器 [class*="content"]/[class*="body"] 与任务弹窗同款：
             CSS module 类名带哈希后缀，只有前缀匹配才是稳的。 */
          .dsh-session-kit-memory-form-modal > [class*="content"] > [class*="body"] { margin-top: 8px; }
          /* 表单弹窗限高：.dialog 是 flex column 但没有 max-height，内容一长（长正文 + 时间输入 + 标签区）
             就整体溢出视口；Modal 的 .dialog 带 overflow:hidden，溢出的部分既不滚动也不可点，
             顶部连同右上角关闭按钮一起被裁——表现为「关闭按钮只有底边能 hover/点击」。
             这里给弹窗设上限，让 content 吃满剩余高度、body 内部滚动，header（含关闭按钮）与 footer 恒定可见。
             ⚠️ 用 max-height:100% 而不是 calc(100vh - 48px)：Modal 的 .root 顶部内边距是
             max(24px, --dsh-frame-overlay-top)（桌面壳标题栏会让它大于 24px），按视口硬算会仍差十几像素，
             百分比则精确对齐 .root 的内容盒（inset:0 → 高度确定，百分比可解析）。 */
          .dsh-session-kit-memory-form-modal {
            width: min(555px, calc(100vw - 32px));
            min-width: min(555px, calc(100vw - 32px));
            max-height: 100%;
            box-sizing: border-box;
          }
          .dsh-session-kit-memory-form-modal > [class*="content"] { flex: 1 1 auto; min-height: 0; }
          .dsh-session-kit-memory-form-modal > [class*="content"] > [class*="body"] {
            flex: 1 1 auto;
            min-height: 0;
            overflow-y: auto;
            overflow-x: hidden;
            scrollbar-gutter: stable;
          }
          /* 新建/编辑记忆弹窗：高度与「记忆管理」弹窗一致。
             「记忆管理」把固定高度 min(74vh, 760px) 加在 body 内的 .dsh-session-kit-memory 上；
             这里把同一份高度公式加在 body 自身上，并把 margin-top 归零（记忆管理弹窗也是 0）——
             两个弹窗的 header/footer/gap/padding 同源，于是总高一致。
             height 配 flex: 0 1 auto（而非上一条的 1 1 auto）：常规窗口取这个固定高度，
             窗口过矮时仍可被 max-height:100% 压缩（min-height:0 已就位），
             不会重现「弹窗溢出视口、关闭按钮被裁」的问题。
             ⚠️ 本条必须排在上一条之后：两条选择器特异度相同（各 1 类 + 2 属性），靠源码顺序覆盖 flex。 */
          .dsh-session-kit-memory-editor-modal > [class*="content"] > [class*="body"] {
            margin-top: 0;
            flex: 0 1 auto;
            height: min(74vh, 760px);
          }
          /* header 与 footer 必须保持原尺寸：在 flex column 里它们是可压缩项，
             一旦被压扁，关闭按钮的可点击区域会小于视觉尺寸（热区错位）。
             flex: none 让它们按内容高度固定，滚动只发生在 body 内。 */
          .dsh-session-kit-memory-form-modal > [class*="content"] > [class*="header"],
          .dsh-session-kit-memory-form-modal > [class*="footer"] { flex: none; }
          .dsh-session-kit-memory-form { display: flex; flex-direction: column; gap: 12px; padding: 0; border: 0; border-radius: 0; background: transparent; color: var(--dsw-alias-label-primary); }
          .dsh-session-kit-memory-form-status { display: flex; justify-content: center; }
          .dsh-session-kit-memory-form-status > .dsh-session-kit-memory-manual-toggle-button { width: 100%; }
          .dsh-session-kit-memory-form-error-slot { flex: none; min-height: 30px; display: flex; flex-direction: column; justify-content: center; }
          .dsh-session-kit-memory-form-error { padding: 5px 10px; border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 42%, transparent); border-radius: 8px; background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent); color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 17px; white-space: pre-line; }
          .dsh-session-kit-memory-form-feedback-slot { gap: 4px; }
          .dsh-session-kit-memory-grid { min-height: 0; flex: 1 1 auto; display: grid; grid-template-columns: minmax(122px, 162px) minmax(0, 1fr); gap: 12px; overflow: hidden; }
          .dsh-session-kit-memory-tabs { min-height: 0; min-width: 0; display: flex; flex-direction: column; gap: 6px; padding: 8px 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; background: var(--dsw-alias-bg-base); overflow-y: auto; overflow-x: hidden; }
          .dsh-session-kit-memory-tabs-footer { flex: none; margin-top: auto; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 4px 2px; border-top: 1px solid var(--dsw-alias-border-l2); }
          .dsh-session-kit-memory-donut-title { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 14px; }
          .dsh-session-kit-memory-donut-wrap { position: relative; width: 72px; height: 72px; }
          .dsh-session-kit-memory-donut { display: block; width: 72px; height: 72px; }
          .dsh-session-kit-memory-donut-track { stroke: color-mix(in srgb, var(--dsw-alias-label-tertiary) 45%, transparent); }
          .dsh-session-kit-memory-donut-active { stroke: var(--dsw-alias-state-success-primary, #12a150); transition: stroke-dasharray 240ms ease; }
          .dsh-session-kit-memory-donut-center { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 18px; font-weight: 650; font-variant-numeric: tabular-nums; }
          /* 上下两行统计：整个图例是一个两列 grid（文字 | 数字），两行共用列宽
             → 文字左对齐成一条线、数字右对齐成一条线。
             每行用 display: contents 让自身不生成盒子、其子项直接成为 grid item
             （display: contents 只影响布局盒，不影响 CSS 选择器匹配，
              故下面用 .legend-active > .legend-label 的写法仍能上色）。 */
          .dsh-session-kit-memory-donut-legend { display: grid; grid-template-columns: auto auto; align-items: baseline; justify-content: center; column-gap: 8px; row-gap: 2px; width: 100%; }
          .dsh-session-kit-memory-donut-legend-row { display: contents; }
          .dsh-session-kit-memory-donut-legend-label { text-align: left; white-space: nowrap; font-size: 11px; line-height: 15px; }
          .dsh-session-kit-memory-donut-legend-value { text-align: right; font-size: 11px; line-height: 15px; font-variant-numeric: tabular-nums; font-weight: 600; }
          .dsh-session-kit-memory-donut-legend-active > .dsh-session-kit-memory-donut-legend-label,
          .dsh-session-kit-memory-donut-legend-active > .dsh-session-kit-memory-donut-legend-value { color: var(--dsw-alias-state-success-primary, #12a150); }
          .dsh-session-kit-memory-donut-legend-inactive > .dsh-session-kit-memory-donut-legend-label,
          .dsh-session-kit-memory-donut-legend-inactive > .dsh-session-kit-memory-donut-legend-value { color: var(--dsw-alias-label-tertiary); }
          .dsh-session-kit-memory-tab { width: 100%; min-width: 0; height: 40px; display: flex; align-items: center; justify-content: space-between; gap: 6px; border: 0; border-radius: 10px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font: inherit; font-size: 13px; line-height: 20px; padding: 0 6px; text-align: left; }
          .dsh-session-kit-memory-tab:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
          .dsh-session-kit-memory-tab-active { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent); color: var(--dsw-alias-state-business-primary); }
          .dsh-session-kit-memory-tab-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .dsh-session-kit-memory-tab-count { flex: none; min-width: 22px; height: 20px; display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 1; font-variant-numeric: tabular-nums; padding: 0 5px; }
          .dsh-session-kit-memory-tab-active .dsh-session-kit-memory-tab-count { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent); color: var(--dsw-alias-state-business-primary); }
          .dsh-session-kit-memory-usage { display: flex; flex-direction: column; gap: 12px; min-height: 0; height: 100%; overflow: hidden; padding-right: 0; }
          .dsh-session-kit-memory-usage > .dsh-session-kit-memory-section-title { flex: none; }
          .dsh-session-kit-memory-usage > .dsh-session-kit-memory-usage-cards { flex: none; }
          .dsh-session-kit-memory-usage-cards { position: relative; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
          .dsh-session-kit-memory-usage-card { display: flex; flex-direction: column; gap: 3px; min-width: 0; min-height: 58px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 11px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary); cursor: pointer; font: inherit; padding: 8px 10px; text-align: left; transition: border-color .16s ease, background-color .16s ease, color .16s ease, box-shadow .16s ease, transform .16s ease; }
          .dsh-session-kit-memory-usage-card:hover:not(:disabled) { border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 48%, var(--dsw-alias-border-l2)); background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 5%, var(--dsw-alias-bg-base)); color: var(--dsw-alias-label-primary); box-shadow: 0 2px 8px color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent); transform: translateY(-1px); }
          .dsh-session-kit-memory-usage-card:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
          /* 选中 tab 与其它 tab 的 hover 态完全一致，避免鼠标进入/离开产生跳变 */
          .dsh-session-kit-memory-usage-card-active,
          .dsh-session-kit-memory-usage-card-active:hover:not(:disabled) {
            border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 48%, var(--dsw-alias-border-l2));
            background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 5%, var(--dsw-alias-bg-base));
            color: var(--dsw-alias-label-primary);
            transform: translateY(-1px);
            box-shadow: 0 2px 8px color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent);
          }
          .dsh-session-kit-memory-usage-card-label { color: var(--dsw-alias-label-secondary); font-size: 12px; }
          .dsh-session-kit-memory-usage-card-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary); font-size: 18px; font-weight: 650; font-variant-numeric: tabular-nums; }
          /* 左侧抵消 SVG 圆环自身的 viewBox 透明边缘；右侧文字直接贴 padding，保持与 tab 文字基准对齐 */
          .dsh-session-kit-memory-usage-chart { display: flex; align-items: center; gap: 16px; min-height: 0; flex: 1 1 0; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l2); border-radius: 11px; background: var(--dsw-alias-bg-base); padding: 10px 12px 10px 8px; }
          .dsh-session-kit-memory-usage-donut { width: min(112px, 100%); height: auto; aspect-ratio: 1; flex: none; }
          .dsh-session-kit-memory-usage-legend { display: flex; flex-direction: column; gap: 5px; min-width: 0; flex: 1; }
          .dsh-session-kit-memory-usage-legend-grid { display: grid; grid-template-rows: repeat(3, minmax(0, auto)); grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); column-gap: 12px; row-gap: 3px; }
          .dsh-session-kit-memory-usage-legend-row { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; }
          .dsh-session-kit-memory-usage-dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
          .dsh-session-kit-memory-usage-legend-label { color: var(--dsw-alias-label-primary); min-width: 0; flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .dsh-session-kit-memory-usage-legend-value { color: var(--dsw-alias-label-tertiary); flex: none; font-variant-numeric: tabular-nums; }
          @media (prefers-reduced-motion: reduce) { .dsh-session-kit-memory-usage-card { transition: none; } }
          .dsh-session-kit-memory-main { min-height: 0; min-width: 0; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; overflow-x: hidden; padding-right: 0; scrollbar-gutter: auto; }
          .dsh-session-kit-memory-panel, .dsh-session-kit-memory-editor { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; background: var(--dsw-alias-bg-base); }
          .dsh-session-kit-memory-settings-current { padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
          .dsh-session-kit-memory-settings-save { align-self: flex-end; }
          /* 蒸馏模型卡片：与 .dsh-session-kit-memory-storage / .dsh-session-kit-memory-recall
             同一套外观（边框 + 圆角 14px + 同底色），三者在设置 tab 里视觉统一。
             它紧跟 tab 标题（panel 的 gap 仅 10px），补 6px 让“标题→首卡片”的间距
             接近“卡片→卡片”（gap 10 + margin 20）。 */
          .dsh-session-kit-memory-distill { display: flex; flex-direction: column; gap: 12px; margin-top: 6px; padding: 16px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; background: color-mix(in srgb, var(--dsw-alias-bg-base) 88%, var(--dsw-alias-bg-layer-1)); }
          .dsh-session-kit-memory-storage { display: flex; flex-direction: column; gap: 12px; margin-top: 20px; padding: 16px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; background: color-mix(in srgb, var(--dsw-alias-bg-base) 88%, var(--dsw-alias-bg-layer-1)); }
          /* Embedding 卡片（记忆弹窗设置 tab 内的实例）：与 storage 卡片同款外观。
             settings-row 自带 margin: 0 -8px（为设置页的 14px 内边距设计），
             本卡片内边距 16px，需归零避免溢出卡片边界。 */
          .dsh-session-kit-memory-embedding { display: flex; flex-direction: column; gap: 12px; margin-top: 20px; padding: 16px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; background: color-mix(in srgb, var(--dsw-alias-bg-base) 88%, var(--dsw-alias-bg-layer-1)); }
          .dsh-session-kit-memory-embedding > .dsh-session-kit-settings-row { margin: 0; }
          .dsh-session-kit-memory-embedding > .dsh-session-kit-memory-muted { margin: 0; }
          /* 配置区与底部按钮行：弹窗宽度较窄，去掉设置页的横向内边距并让按钮右对齐。 */
          .dsh-session-kit-memory-embedding > .dsh-session-kit-settings-fields { margin-top: 0; padding: 0; }
          .dsh-session-kit-memory-embedding-foot { display: flex; align-items: center; justify-content: flex-end; gap: 12px; }
          .dsh-session-kit-memory-embedding-foot > .dsh-session-kit-settings-module-status { margin-right: auto; }
          /* 「已配置模式」徽标：底栏左下角，绿色文字 + 绿色边框的小标签（margin-right:auto 顶左）。
             ⚠️ 类名与「蒸馏模型卡片」的 dsh-session-kit-settings-current 区分开，
                那个是带 padding/边框/背景的卡片样式，复用它会把徽标撑成大卡片。 */
          .dsh-session-kit-settings-mode-badge { flex: 0 0 auto; margin-right: auto; padding: 2px 8px; border: 1px solid var(--dsw-alias-state-success-primary); border-radius: 999px; font-size: 12px; line-height: 18px; white-space: nowrap; color: var(--dsw-alias-state-success-primary); }
          .dsh-session-kit-memory-storage-field { display: flex; flex-direction: column; gap: 7px; padding: 11px 13px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 11px; background: var(--dsw-alias-bg-base); }
          .dsh-session-kit-memory-storage-path { display: flex; align-items: center; gap: 8px; }
          .dsh-session-kit-memory-storage-input { flex: 1 1 auto; min-width: 0; }
          /* 按钮文字（含"选择中…"）不换行、不压缩：flex 容器里输入框吃掉
             全部收缩，按钮按内容保持宽度，避免窄容器下文字折成两行。 */
          .dsh-session-kit-memory-storage-pick { flex: 0 0 auto; min-width: 104px; white-space: nowrap; }
          .dsh-session-kit-memory-storage-active { font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
          .dsh-session-kit-memory-recall { display: flex; flex-direction: column; gap: 12px; margin-top: 20px; padding: 16px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; background: color-mix(in srgb, var(--dsw-alias-bg-base) 88%, var(--dsw-alias-bg-layer-1)); }
          .dsh-session-kit-memory-recall-field { display: flex; flex-direction: column; gap: 7px; padding: 11px 13px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 11px; background: var(--dsw-alias-bg-base); }
          .dsh-session-kit-memory-recall-mode { padding: 10px 12px; border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }
          .dsh-session-kit-memory-recall-note { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
          .dsh-session-kit-memory-recall-summary { display: flex; flex-wrap: wrap; gap: 8px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
          .dsh-session-kit-memory-recall-summary span { padding: 3px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: var(--dsw-alias-bg-base); }
          .dsh-session-kit-memory-recall-segments { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: stretch; gap: 10px; }
          .dsh-session-kit-memory-recall-segment-field { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-content: start; align-items: center; gap: 7px 10px; min-width: 0; }
          .dsh-session-kit-memory-recall-segment-field .dsh-session-kit-memory-recall-field-head { grid-column: 1 / -1; min-height: 22px; }
          .dsh-session-kit-memory-recall-segment-field .dsh-session-kit-memory-recall-progress { grid-column: 1 / -1; }
          .dsh-session-kit-memory-recall-segment-field .dsh-session-kit-memory-recall-slider { grid-column: 1 / -1; }
          .dsh-session-kit-memory-recall-segment-field .dsh-session-kit-memory-recall-number { grid-column: 2; }
          .dsh-session-kit-memory-recall-segment-field small { grid-column: 1 / -1; min-height: 18px; }
          .dsh-session-kit-memory-recall-field-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; }
          .dsh-session-kit-memory-recall-field-head span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .dsh-session-kit-memory-recall-label { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
          /* 中文字形的视觉中心略低于行盒几何中心，图标整体下移 1px 才能与文字水平对齐。 */
          .dsh-session-kit-memory-recall-hint-icon { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 14px; height: 14px; line-height: 1; transform: translateY(1px); color: var(--dsw-alias-label-tertiary); cursor: help; }
          .dsh-session-kit-memory-recall-hint-icon > svg { display: block; }
          .dsh-session-kit-memory-recall-hint-icon:hover { color: var(--dsw-alias-label-secondary); }
          .dsh-session-kit-memory-recall-field-head strong { color: var(--dsw-alias-label-primary); font-size: 16px; font-weight: 600; }
          .dsh-session-kit-memory-recall-slider { position: relative; grid-column: 1 / -1; width: 100%; height: 32px; min-width: 0; border-radius: 8px; }
          .dsh-session-kit-memory-recall-slider-disabled { opacity: .45; }
          .dsh-session-kit-memory-recall-slider-disabled .dsh-session-kit-memory-recall-slider-input { cursor: not-allowed; }
          .dsh-session-kit-memory-recall-slider-input { position: absolute; z-index: 2; inset: 0; width: 100%; height: 32px; margin: 0; padding: 0; opacity: 0; cursor: pointer; }
          /* 轨道默认淡化，鼠标悬浮时恢复当前亮度；禁用时不响应悬浮。 */
          .dsh-session-kit-memory-recall-slider-track { position: absolute; top: 13px; right: 7px; left: 7px; height: 6px; border-radius: 999px; background: color-mix(in srgb, var(--dsw-alias-border-l2) 45%, transparent); pointer-events: none; transition: background-color .14s ease; }
          .dsh-session-kit-memory-recall-slider:hover .dsh-session-kit-memory-recall-slider-track { background: var(--dsw-alias-border-l2); }
          .dsh-session-kit-memory-recall-slider-disabled:hover .dsh-session-kit-memory-recall-slider-track { background: color-mix(in srgb, var(--dsw-alias-border-l2) 45%, transparent); }
          /* RSuite graduated 风格：普通刻度是小实心圆，当前值是带边框的圆形手柄。 */
          .dsh-session-kit-memory-recall-slider-dot { display: block; position: absolute; top: 50%; width: 6px; height: 6px; aspect-ratio: 1 / 1; box-sizing: border-box; border: 0; border-radius: 50% !important; background: var(--dsw-alias-label-tertiary); clip-path: circle(50%); transform: translate(-50%, -50%); }
          .dsh-session-kit-memory-recall-slider-dot-current { display: inline-flex; align-items: center; justify-content: center; inline-size: 14px; block-size: 14px; width: 14px; height: 14px; min-width: 14px; min-height: 14px; max-width: 14px; max-height: 14px; box-sizing: border-box; border: 0; border-radius: 9999px !important; background: var(--dsw-alias-state-success-primary, #12a150); overflow: hidden; transition: transform .14s ease, box-shadow .14s ease; }
          .dsh-session-kit-memory-recall-slider-dot-inner { display: block; inline-size: 10px; block-size: 10px; width: 10px; height: 10px; min-width: 10px; min-height: 10px; max-width: 10px; max-height: 10px; box-sizing: border-box; border: 0; border-radius: 9999px !important; background: var(--dsw-alias-bg-base); clip-path: circle(50%); }
          .dsh-session-kit-memory-recall-slider:hover .dsh-session-kit-memory-recall-slider-dot-current { box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-success-primary, #12a150) 20%, transparent), 0 2px 8px color-mix(in srgb, var(--dsw-alias-state-success-primary, #12a150) 32%, transparent); transform: translate(-50%, -50%) scale(1.12); }
          .dsh-session-kit-memory-recall-slider-disabled:hover .dsh-session-kit-memory-recall-slider-dot-current { box-shadow: none; transform: translate(-50%, -50%); }
          .dsh-session-kit-memory-recall-slider-dot-upcoming { border: 0; background: var(--dsw-alias-label-tertiary); }
          .dsh-session-kit-memory-recall-number { box-sizing: border-box; width: 84px; height: 32px; min-width: 0; align-self: end; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; padding: 0 8px; }
          .dsh-session-kit-memory-recall-number:focus { border-color: var(--dsw-alias-state-business-primary); outline: none; box-shadow: 0 0 0 2px rgba(77, 107, 254, .14); }
          .dsh-session-kit-memory-recall-progress { height: 6px; overflow: hidden; border-radius: 999px; background: var(--dsw-alias-border-l2); }
          .dsh-session-kit-memory-recall-progress-fill { display: block; height: 100%; border-radius: inherit; background: var(--dsw-alias-state-business-primary); transition: width .16s ease; }
          .dsh-session-kit-memory-recall-custom-value { color: var(--dsw-alias-state-success-primary, #12a150) !important; }
          .dsh-session-kit-memory-recall-progress-fill-custom { background: var(--dsw-alias-state-success-primary, #12a150); }
          .dsh-session-kit-memory-recall-field small { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
          @media (max-width: 760px) { .dsh-session-kit-memory-recall-segments { grid-template-columns: 1fr; } }
          .dsh-session-kit-memory-logs { display: flex; flex-direction: column; gap: 10px; min-width: 0; min-height: 0; width: 100%; align-self: stretch; box-sizing: border-box; }
          /* 与标签列表标题同构：1fr auto 1fr 网格——提示居左（第1列），按钮占第2列即整行水平居中；
             标题覆盖用双类选择器，避免被更靠后的 .memory-section-title 的 display:grid 同优先级覆盖 */
          .dsh-session-kit-memory-logs-bar { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; flex: none; }
          .dsh-session-kit-memory-section-title.dsh-session-kit-memory-logs-title { display: block; grid-column: 1; justify-self: start; min-width: 0; }
          .dsh-session-kit-memory-logs-clear { grid-column: 2; justify-self: center; }
          .dsh-session-kit-memory-activity-list { display: flex; flex-direction: column; gap: 10px; }
          .dsh-session-kit-memory-activity-card { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-interactive-bg-hover); }
          .dsh-session-kit-memory-badge.dsh-session-kit-memory-activity-badge-running { border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 44%, var(--dsw-alias-border-l2)); color: var(--dsw-alias-state-business-primary); background: linear-gradient(90deg, color-mix(in srgb, var(--dsw-alias-state-business-primary) 8%, transparent), color-mix(in srgb, var(--dsw-alias-state-business-primary) 22%, transparent), color-mix(in srgb, var(--dsw-alias-state-business-primary) 8%, transparent)); background-size: 200% 100%; animation: dsh-session-kit-activity-wave 1400ms linear infinite; }
          .dsh-session-kit-memory-activity-summary { overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
          /* 悬浮摘要：列表仍为两行省略；浮层承载完整内容，可滚动。 */
          .dsh-session-kit-memory-activity-summary-wrap { display: block; min-width: 0; }
          .dsh-session-kit-memory-activity-summary-clamp { cursor: default; outline: none; }
          .dsh-session-kit-memory-activity-summary-clamp:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; border-radius: 6px; }
          .dsh-session-kit-memory-activity-summary-popup { position: fixed; z-index: 1500; box-sizing: border-box; overflow-y: auto; overscroll-behavior: contain; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-inverted); border-radius: 10px; background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-base, var(--dsw-specific-menu))); box-shadow: var(--dsw-shadow-lv3); color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 18px; white-space: pre-wrap; overflow-wrap: anywhere; }
          /* ── memory_update 的前后差异（浮层内） ── */
          .dsh-session-kit-memory-activity-summary-popup-diff { white-space: normal; padding: 10px 12px; }
          .dsh-session-kit-memory-diff { display: flex; flex-direction: column; gap: 8px; }
          .dsh-session-kit-memory-diff-title { font-size: 11px; line-height: 16px; font-weight: 600; color: var(--dsw-alias-label-secondary); letter-spacing: .02em; }
          .dsh-session-kit-memory-diff-body { display: flex; flex-direction: column; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; overflow: hidden; font-family: var(--dsw-font-family-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); font-size: 11px; line-height: 17px; }
          .dsh-session-kit-memory-diff-line { display: flex; gap: 6px; padding: 1px 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
          .dsh-session-kit-memory-diff-sign { flex: none; width: 8px; text-align: center; opacity: .7; user-select: none; }
          .dsh-session-kit-memory-diff-line-same { color: var(--dsw-alias-label-secondary); }
          .dsh-session-kit-memory-diff-line-removed { color: var(--dsw-alias-state-error-primary, #d43b3b); background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d43b3b) 12%, transparent); text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d43b3b) 55%, transparent); }
          .dsh-session-kit-memory-diff-line-added { color: var(--dsw-alias-state-success-primary, #12a150); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #12a150) 12%, transparent); }
          /* changed 行：不整行加底色/删除线，交给行内片段着色；符号用 ~ 与删改语义区分。 */
          .dsh-session-kit-memory-diff-line-changed { color: var(--dsw-alias-label-primary); }
          .dsh-session-kit-memory-diff-line-changed > .dsh-session-kit-memory-diff-sign { color: var(--dsw-alias-state-business-primary, #4a7dff); opacity: .9; }
          .dsh-session-kit-memory-diff-inline { min-width: 0; }
          /* 行内片段：removed 段划线变红、added 段底色变绿，same 段继承行色。 */
          .dsh-session-kit-memory-diff-seg-removed { color: var(--dsw-alias-state-error-primary, #d43b3b); background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d43b3b) 16%, transparent); text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d43b3b) 60%, transparent); border-radius: 3px; }
          .dsh-session-kit-memory-diff-seg-added { color: var(--dsw-alias-state-success-primary, #12a150); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #12a150) 16%, transparent); border-radius: 3px; }
          .dsh-session-kit-memory-diff-fields { display: flex; flex-direction: column; gap: 2px; }
          .dsh-session-kit-memory-diff-field { font-size: 11px; line-height: 17px; color: var(--dsw-alias-label-secondary); }
          .dsh-session-kit-memory-activity-head-main { min-width: 0; display: inline-flex; align-items: center; gap: 2px; }
          .dsh-session-kit-memory-activity-head-main > strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .dsh-session-kit-memory-activity-copy { flex: none; width: 24px; min-width: 24px; height: 24px; padding: 0; border-radius: 6px; color: var(--dsw-alias-label-secondary); }
          .dsh-session-kit-memory-activity-copy:hover:not(:disabled) { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
          .dsh-session-kit-memory-activity-copy-copied { color: var(--dsw-alias-state-success-primary, #12a150); }
          /* 带文字的复制按钮：覆盖纯图标按钮的固定 24px 宽度，否则文字会被压出。
             与 .dsh-session-kit-memory-activity-copy 同用时后者先声明，此处覆盖。 */
          .dsh-session-kit-memory-activity-copy-text { width: auto; min-width: 0; padding: 0 8px; gap: 4px; }
          .dsh-session-kit-memory-activity-time { font-size: 12px; opacity: 0.75; }
          .dsh-session-kit-memory-activity-error { color: var(--dsw-alias-state-error-primary, #d43b3b); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
          .dsh-session-kit-memory-badge.dsh-session-kit-memory-activity-badge-success { color: var(--dsw-alias-state-success-primary, #12a150); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #12a150) 44%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #12a150) 9%, transparent); }
          .dsh-session-kit-memory-badge.dsh-session-kit-memory-activity-badge-failed { color: var(--dsw-alias-state-error-primary, #d43b3b); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d43b3b) 44%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d43b3b) 9%, transparent); }
          @keyframes dsh-session-kit-activity-wave { from { background-position: 200% 0; } to { background-position: -200% 0; } }
          .dsh-session-kit-memory-activity-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
          .dsh-session-kit-memory-section-title { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px; font-weight: 700; }
          .dsh-session-kit-memory-section-counts { display: inline-flex; align-items: center; gap: 6px; justify-self: center; }
          .dsh-session-kit-memory-section-count { display: inline-flex; align-items: center; padding: 1px 10px; border-radius: 999px; border: 1px solid transparent; font-size: 12px; line-height: 18px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
          .dsh-session-kit-memory-section-count-active { color: var(--dsw-alias-state-success-primary, #12a150); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #12a150) 44%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #12a150) 9%, transparent); }
          .dsh-session-kit-memory-section-count-inactive { color: var(--dsw-alias-label-tertiary); background: var(--dsw-alias-interactive-bg-hover); }
          .dsh-session-kit-memory-muted { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
          .dsh-session-kit-memory-inline-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; }
          .dsh-session-kit-memory-directory-list, .dsh-session-kit-memory-list { display: flex; flex-direction: column; gap: 10px; }
          .dsh-session-kit-memory-directory-card, .dsh-session-kit-memory-card { display: flex; flex-direction: column; gap: 9px; padding: 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-interactive-bg-hover); }
          .dsh-session-kit-memory-card { background: var(--dsw-alias-bg-base); }
          .dsh-session-kit-memory-card-ephemeral { border-style: dashed; background: var(--dsw-alias-bg-base); }
          .dsh-session-kit-memory-row-head, .dsh-session-kit-memory-card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; min-width: 0; }
          .dsh-session-kit-memory-link-title { flex: 1 1 auto; min-width: 0; border: 0; background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; text-align: left; font: inherit; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0; }
          .dsh-session-kit-memory-link-title:hover, .dsh-session-kit-memory-link-title:focus-visible { color: var(--dsw-alias-state-business-primary); outline: none; }
          .dsh-session-kit-memory-directory-title { min-width: 0; flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary); font-weight: 650; line-height: 30px; }
          .dsh-session-kit-memory-count { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 30px; font-variant-numeric: tabular-nums; }
          .dsh-session-kit-memory-badges { min-width: 0; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
          /* 记忆卡片顶行的徽章与两个开关对齐成同一高度（28px）：
             基类徽章是 24px（2px*2 内边距 + 18px 行高 + 1px*2 边框），比开关矮 4px，同行会显得参差。
             只作用于记忆卡片的徽章——目录卡片、活动卡片的徽章保持原尺寸不变。 */
          .dsh-session-kit-memory-badges .dsh-session-kit-memory-badge { box-sizing: border-box; height: 28px; min-height: 28px; padding: 0 8px; }
          /* 卡片左上角的状态开关：与固定注入开关同尺寸，但用成功色表达 active。 */
          .dsh-session-kit-memory-status-toggle { flex: none; min-height: 28px; height: 28px; gap: 6px; align-items: center; padding: 0 9px !important; border-radius: 999px !important; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
          .dsh-session-kit-memory-status-toggle-on { color: var(--dsw-alias-state-success-primary, #12a150); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #12a150) 44%, var(--dsw-alias-border-l2)) !important; background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #12a150) 9%, transparent) !important; }
          /* 项目备注：最多两行，超出省略；全文通过原生 title 悬浮提示。 */
          .dsh-session-kit-memory-directory-remark { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; user-select: none; }
          .dsh-session-kit-memory-directory-copy { flex: none; width: 28px; min-width: 28px; height: 28px; padding: 0; border-radius: 8px; color: var(--dsw-alias-label-secondary); }
          .dsh-session-kit-memory-directory-copy:hover:not(:disabled) { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
          .dsh-session-kit-memory-directory-copy-copied { color: var(--dsw-alias-state-success-primary, #12a150); }
          .dsh-session-kit-memory-badge, .dsh-session-kit-memory-tag-chip { max-width: 220px; display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; padding: 2px 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .dsh-session-kit-memory-badge-active { border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #12a150) 44%, var(--dsw-alias-border-l2)); color: var(--dsw-alias-state-success-primary, #12a150); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #12a150) 9%, transparent); }
          .dsh-session-kit-memory-pin-toggle { flex: none; max-width: 220px; min-height: 28px; height: 28px; gap: 6px; align-items: center; padding: 0 9px !important; border-radius: 999px !important; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
          .dsh-session-kit-memory-pin-toggle-on { color: var(--dsw-alias-state-business-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 44%, var(--dsw-alias-border-l2)) !important; background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 9%, transparent) !important; }
          .dsh-session-kit-memory-tag-list { display: flex; flex-wrap: wrap; gap: 6px; }
          .dsh-session-kit-memory-tag-separator { flex: none; height: 0; margin: 2px 0; border-top: 1px solid var(--dsw-alias-border-l2); }
          .dsh-session-kit-memory-tag-list-panel { align-content: flex-start; gap: 8px; }
          .dsh-session-kit-memory-tag-list-panel .dsh-session-kit-memory-tag-chip { box-sizing: border-box; max-width: 420px; min-height: 32px; align-items: center; justify-content: center; gap: 0; font-size: 13px; line-height: 20px; padding: 0; }
          .dsh-session-kit-memory-tag-chip-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .dsh-session-kit-memory-tag-chip-inactive { opacity: .68; }
          .dsh-session-kit-memory-tag-toggle-button { max-width: 360px; min-height: 32px; height: 32px; gap: 6px; padding: 0 10px !important; border: 0 !important; border-radius: 999px 0 0 999px !important; background: transparent !important; box-shadow: none !important; }
          .dsh-session-kit-memory-tag-toggle-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover) !important; }
          .dsh-session-kit-memory-tag-delete-button { flex: none; width: 32px; min-width: 32px; height: 32px; min-height: 32px; padding: 0 !important; border: 0 !important; border-radius: 0 999px 999px 0 !important; background: transparent !important; box-shadow: none !important; }
          /* 卡片左上角项目徽章的可点击态：点击筛选当前列表的项目。 */
          .dsh-session-kit-memory-badge-project-clickable { cursor: pointer; font-family: inherit; }
          .dsh-session-kit-memory-badge-project-clickable:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-selected, var(--dsw-alias-interactive-bg-hover)); }
          /* 区块标题右侧的项目筛选胶囊：与标签胶囊同款，紧贴标题文字，X 为紧凑尺寸。
             高度压到与标题/计数的 20px 行高一致，出现时不会撑高标题行。 */
          .dsh-session-kit-memory-section-name-group { min-width: 0; display: inline-flex; align-items: center; gap: 6px; }
          .dsh-session-kit-memory-section-title .dsh-session-kit-memory-project-filter-chip { max-width: 320px; height: 20px; min-height: 20px; padding-top: 0; padding-bottom: 0; }
          .dsh-session-kit-memory-project-filter-head { min-width: 0; display: inline-flex; align-items: center; gap: 4px; color: var(--dsw-alias-label-secondary); }
          .dsh-session-kit-memory-project-filter-pin { flex: none; padding: 0; border: 0; background: transparent; cursor: pointer; font-size: 12px; line-height: 1; user-select: none; filter: grayscale(1); opacity: 0.55; }
          .dsh-session-kit-memory-project-filter-pin:hover { filter: grayscale(0.6); opacity: 0.85; }
          .dsh-session-kit-memory-project-filter-pin-active { filter: none; opacity: 1; }
          /* DSH 设置弹窗的 session-kit 分节：模块区块（边框+圆角）+ 开关行。 */
          .dsh-session-kit-settings { display: flex; flex-direction: column; gap: 16px; padding: 4px 2px 16px; }
          .dsh-session-kit-settings-module { display: flex; flex-direction: column; gap: 2px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; padding: 12px 14px; }
          .dsh-session-kit-settings-module-title { font-size: 13px; line-height: 20px; font-weight: 700; color: var(--dsw-alias-label-primary); margin-bottom: 6px; }
          .dsh-session-kit-settings-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 34px; padding: 4px 8px; margin: 0 -8px; border: 0; border-radius: 8px; background: transparent; cursor: pointer; font-family: inherit; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-primary); text-align: left; }
          .dsh-session-kit-settings-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
          .dsh-session-kit-settings-row-label { min-width: 0; }
          /* 设置项说明：开关行下方的补充解释，弱化颜色、允许换行。 */
          .dsh-session-kit-settings-module-hint { margin-top: 4px; padding: 0 8px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
          .dsh-session-kit-settings-module-foot { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 8px; }
          .dsh-session-kit-settings-module-status { min-width: 0; margin-right: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-success-primary); }
          /* Embedding 设置的连接配置区：开启开关后才渲染，故用纵向堆叠而非行式布局。 */
          .dsh-session-kit-settings-fields { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; padding: 0 8px; }
          .dsh-session-kit-settings-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
          .dsh-session-kit-settings-field-label { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
          /* 「当前生效值」展示（蒸馏模型卡片）：与记忆弹窗内的同款元素外观一致。 */
          .dsh-session-kit-settings-current { padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
          /* 蒸馏卡片在设置页的纵向间距：settings-module 的 gap 仅 2px（为开关行设计），
             而本卡片含「当前值 + 下拉字段」，需要更松的行距。 */
          .dsh-session-kit-settings-module > .dsh-session-kit-settings-current { margin-top: 8px; }
          .dsh-session-kit-settings-module > .dsh-session-kit-settings-field { margin-top: 10px; }
          .dsh-session-kit-settings-field-input { width: 100%; box-sizing: border-box; min-height: 30px; padding: 4px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 13px; line-height: 20px; }
          .dsh-session-kit-settings-field-input:focus { outline: none; border-color: var(--dsw-alias-state-business-primary); }
          .dsh-session-kit-settings-field-input::placeholder { color: var(--dsw-alias-label-tertiary); }
          /* 接口类型二选一：分段控件，选中态用业务主色区分。 */
          .dsh-session-kit-settings-kind { display: flex; gap: 6px; }
          .dsh-session-kit-settings-kind-item { flex: 1 1 0; min-width: 0; min-height: 30px; padding: 4px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: transparent; cursor: pointer; font-family: inherit; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); display: flex; align-items: center; justify-content: center; gap: 4px; }
          .dsh-session-kit-settings-kind-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
          .dsh-session-kit-settings-kind-item.is-active { border-color: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-state-business-primary); background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 8%, transparent); }
          /* 左侧打勾：未选中时也占位，避免选中瞬间文字左右跳动。 */
          .dsh-session-kit-settings-kind-check { display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; flex: 0 0 14px; }
          .dsh-session-kit-settings-kind-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          /* 连通测试结果块：成功/失败用状态色区分，失败时额外给排查方向。 */
          .dsh-session-kit-settings-embedding-test { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
          .dsh-session-kit-settings-embedding-test.is-ok { border-color: var(--dsw-alias-state-success-primary); color: var(--dsw-alias-state-success-primary); }
          .dsh-session-kit-settings-embedding-test.is-fail { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
          .dsh-session-kit-settings-embedding-test-title { font-weight: 700; }
          .dsh-session-kit-settings-embedding-test-detail { color: var(--dsw-alias-label-secondary); }
          .dsh-session-kit-settings-embedding-test-hint { margin-top: 2px; color: var(--dsw-alias-label-tertiary); }
          .dsh-session-kit-memory-project-filter-chip .dsh-session-kit-memory-tag-delete-button { flex: none; width: 18px; min-width: 18px; height: 18px; min-height: 18px; padding: 0 !important; border: 0 !important; border-radius: 999px !important; background: transparent !important; box-shadow: none !important; }
          .dsh-session-kit-memory-project-filter-chip .dsh-session-kit-memory-tag-delete-button:hover { color: var(--dsw-alias-state-error-primary); }
          .dsh-session-kit-memory-tag-delete-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover) !important; }
          .dsh-session-kit-memory-tag-delete-button > svg { flex: none; display: block; }
          .dsh-session-kit-memory-tag-delete-button:hover { color: var(--dsw-alias-state-error-primary); }
          /* 注意：不可在此声明 scrollbar-width/scrollbar-color —— 与下方 ::-webkit-scrollbar
             共存时 Chromium 会退回原生渲染（出现上下三角、宽度变大），webkit 规则被压制。 */
          .dsh-session-kit-memory-mini-textarea { box-sizing: border-box; width: 100%; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; outline: none; min-height: 64px; max-height: 200px; resize: vertical; line-height: 1.5; padding: 8px 10px; overflow-y: auto; }
          .dsh-session-kit-memory-mini-textarea:focus { border-color: var(--dsw-alias-state-business-primary); box-shadow: 0 0 0 2px rgba(77, 107, 254, .14); }
          @supports selector(::-webkit-scrollbar) {
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar:vertical,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar:vertical { width: 6px; }
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar:horizontal,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar:horizontal { height: 0; }
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-button,
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-button:single-button,
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-button:double-button,
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-button:vertical,
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-button:horizontal,
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-button:start,
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-button:end,
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-button:decrement,
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-button:increment,
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-button:single-button:vertical,
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-button:single-button:horizontal,
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-button:single-button:start,
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-button:single-button:end,
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-button:single-button:decrement,
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-button:single-button:increment,
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-button:vertical:start,
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-button:vertical:end,
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-button:vertical:decrement,
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-button:vertical:increment,
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-button:horizontal:start,
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-button:horizontal:end,
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-button:horizontal:decrement,
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-button:horizontal:increment,
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-button:vertical:start:decrement,
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-button:vertical:end:increment,
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-button:horizontal:start:decrement,
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-button:horizontal:end:increment,
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-button:single-button:vertical:start:decrement,
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-button:single-button:vertical:end:increment,
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-button:single-button:horizontal:start:decrement,
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-button:single-button:horizontal:end:increment,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-button,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-button:single-button,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-button:double-button,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-button:vertical,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-button:horizontal,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-button:start,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-button:end,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-button:decrement,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-button:increment,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-button:single-button:vertical,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-button:single-button:horizontal,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-button:single-button:start,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-button:single-button:end,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-button:single-button:decrement,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-button:single-button:increment,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-button:vertical:start,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-button:vertical:end,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-button:vertical:decrement,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-button:vertical:increment,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-button:horizontal:start,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-button:horizontal:end,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-button:horizontal:decrement,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-button:horizontal:increment,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-button:vertical:start:decrement,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-button:vertical:end:increment,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-button:horizontal:start:decrement,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-button:horizontal:end:increment,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-button:single-button:vertical:start:decrement,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-button:single-button:vertical:end:increment,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-button:single-button:horizontal:start:decrement,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-button:single-button:horizontal:end:increment { -webkit-appearance: none !important; appearance: none !important; width: 0 !important; height: 0 !important; min-width: 0 !important; min-height: 0 !important; max-width: 0 !important; max-height: 0 !important; display: none !important; visibility: hidden !important; background: transparent !important; background-image: none !important; border: 0 !important; box-shadow: none !important; }
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-thumb,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-thumb { border-radius: 999px; background: color-mix(in srgb, var(--dsw-alias-label-caption) 48%, transparent); }
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-thumb:hover,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-thumb:hover { background: color-mix(in srgb, var(--dsw-alias-label-caption) 62%, transparent); }
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-track,
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-track-piece,
            .dsh-session-kit-memory-mini-textarea::-webkit-scrollbar-corner,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-track,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-track-piece,
            .dsh-session-kit-memory-editor-textarea::-webkit-scrollbar-corner { background: transparent !important; border: 0 !important; }
          }
          /* Firefox 不支持 ::-webkit-scrollbar，用标准属性近似（仅 Firefox 生效，
             放在 @-moz-document 内以免压制 Chromium 的 webkit 规则）。 */
          @-moz-document url-prefix() {
            .dsh-session-kit-memory-mini-textarea,
            .dsh-session-kit-memory-editor-textarea { scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--dsw-alias-label-caption) 48%, transparent) transparent; }
          }
          .dsh-session-kit-memory-select-root { position: relative; display: inline-flex; width: 100%; min-width: 0; }
          .dsh-session-kit-memory-select-button { width: 100%; min-width: 0; height: 36px; min-height: 36px; justify-content: space-between; border-radius: 10px !important; }
          .dsh-session-kit-memory-select-label { min-width: 0; flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
          .dsh-session-kit-memory-select-chevron { flex: none; display: inline-flex; align-items: center; justify-content: center; transform: rotate(0deg); transition: transform 180ms ease; }
          .dsh-session-kit-memory-select-chevron-open { transform: rotate(180deg); }
          .dsh-session-kit-memory-select-panel { position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 1200; box-sizing: border-box; width: 100%; min-width: 0; max-height: 252px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; padding: 4px; border: 1px solid var(--dsw-alias-border-inverted); border-radius: 10px; background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-base, var(--dsw-specific-menu))); box-shadow: var(--dsw-shadow-lv3); }
          .dsh-session-kit-memory-select-option { width: 100%; height: 36px; min-height: 36px; display: flex; align-items: center; gap: 8px; border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; font: inherit; font-size: 13px; line-height: 20px; text-align: left; padding: 0 10px; }
          .dsh-session-kit-memory-select-option:hover:not(:disabled), .dsh-session-kit-memory-select-option[data-selected] { background: var(--dsw-alias-interactive-bg-hover); }
          .dsh-session-kit-memory-select-option:disabled { opacity: .45; cursor: not-allowed; }
          .dsh-session-kit-memory-select-option-label { min-width: 0; flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .dsh-session-kit-memory-select-search { position: relative; display: flex; align-items: stretch; min-width: 0; flex: none; margin: 2px 2px 4px; }
          .dsh-session-kit-memory-select-search-icon { position: absolute; left: 10px; top: 0; bottom: 0; display: inline-flex; align-items: center; justify-content: center; color: var(--dsw-alias-label-tertiary); pointer-events: none; z-index: 1; }
          .dsh-session-kit-memory-select-search-input { box-sizing: border-box; width: 100%; height: 30px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 20px; padding: 0 10px 0 30px; outline: none; }
          .dsh-session-kit-memory-select-search-input:focus { border-color: var(--dsw-alias-state-business-primary); box-shadow: 0 0 0 2px rgba(77, 107, 254, .14); }
          .dsh-session-kit-memory-select-search-input::placeholder { color: var(--dsw-alias-label-tertiary); }
          .dsh-session-kit-memory-select-empty { padding: 10px 12px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; text-align: center; }
          .dsh-session-kit-memory-card-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
          .dsh-session-kit-memory-directory-statuses { margin-right: auto; min-width: 0; display: inline-flex; align-items: center; flex-wrap: wrap; gap: 6px; }
          .dsh-session-kit-memory-footer-left { margin-right: auto; min-width: 0; display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
          .dsh-session-kit-memory-auto-distill-button, .dsh-session-kit-memory-all-sessions-button, .dsh-session-kit-memory-first-match-button, .dsh-session-kit-memory-manual-toggle-button { gap: 6px; }
          .dsh-session-kit-toggle-switch { flex: none; box-sizing: border-box; width: 26px; height: 15px; display: inline-flex; align-items: center; padding: 2px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: var(--dsw-alias-bg-base); transition: background 160ms ease, border-color 160ms ease; }
          .dsh-session-kit-toggle-switch-knob { width: 9px; height: 9px; border-radius: 999px; background: var(--dsw-alias-label-tertiary); transform: translateX(0); transition: transform 160ms ease, background 160ms ease; }
          .dsh-session-kit-toggle-switch-on { border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #12a150) 58%, var(--dsw-alias-border-l2)); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #12a150) 18%, transparent); }
          .dsh-session-kit-toggle-switch-on .dsh-session-kit-toggle-switch-knob { background: var(--dsw-alias-state-success-primary, #12a150); transform: translateX(11px); }
          .dsh-session-kit-memory-manual-toggle-button:disabled .dsh-session-kit-toggle-switch, .dsh-session-kit-memory-tag-toggle-button:disabled .dsh-session-kit-toggle-switch { opacity: .6; }
          .dsh-session-kit-memory-auto-distill-button, .dsh-session-kit-memory-all-sessions-button, .dsh-session-kit-memory-first-match-button, .dsh-session-kit-memory-manual-toggle-button, .dsh-session-kit-entry-visibility-toggle { gap: 6px; }
          .dsh-session-kit-memory-danger-button { color: var(--dsw-alias-state-error-primary) !important; border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 58%, var(--dsw-alias-border-l2)) !important; }
          .dsh-session-kit-memory-danger-button:hover:not(:disabled) { border-color: var(--dsw-alias-state-error-primary) !important; background: var(--dsw-alias-interactive-bg-hover-danger, color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent)) !important; }
          .dsh-session-kit-memory-danger-button:disabled { color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 65%, var(--dsw-alias-label-disabled, transparent)) !important; }
          .dsh-session-kit-memory-text { max-height: 180px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-markdown-code-block, var(--dsw-alias-interactive-bg-hover)); border-radius: 10px; padding: 10px 12px; font: inherit; font-size: 13px; line-height: 1.55; }
          .dsh-session-kit-memory-meta { display: flex; flex-direction: column; gap: 4px; padding-left: 10px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
          .dsh-session-kit-memory-meta-row { min-width: 0; display: flex; align-items: center; gap: 8px; }
          .dsh-session-kit-memory-meta-row > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          /* 项目/标签行：值允许换行显示，标签 chips 完整不截断 */
          .dsh-session-kit-memory-meta-value { white-space: normal !important; overflow-wrap: anywhere; }
          /* 记忆小面板：项目名占满剩余宽度，📌 固定标记贴在该行最右 */
          .dsh-session-kit-turn-memory-item-meta-row .dsh-session-kit-memory-meta-value { flex: 1 1 auto; }
          .dsh-session-kit-turn-memory-pinned { flex: 0 0 auto; cursor: help; font-size: 12px; line-height: 1; user-select: none; }
          .dsh-session-kit-turn-memory-new-recall { flex: 0 0 auto; cursor: help; color: var(--dsw-alias-state-success-primary); font-size: 14px; font-weight: 700; line-height: 1; user-select: none; }
          .dsh-session-kit-memory-meta-tags-row { align-items: flex-start; }
          .dsh-session-kit-memory-meta-tags { min-width: 0; flex: 1; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; }
          .dsh-session-kit-memory-meta-tags > span { overflow: visible; }
          .dsh-session-kit-memory-meta-tag-chip { display: inline-flex; align-items: center; max-width: 100%; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
          .dsh-session-kit-memory-meta-tags-empty { white-space: normal !important; }
          .dsh-session-kit-memory-meta-time-row { flex-wrap: wrap; }
          /* 事实时间过期徽标：卡片底部不再显示「事件/有效至」具体日期，
             只在过期时亮出黄色警示——具体时间值在编辑框里查看。 */
          .dsh-session-kit-memory-meta-facttime-expired { color: var(--dsw-alias-state-warning-primary, #d89614); }
          /* 事实时间：每组一行 = 标签 + 日期框 + 时间框，三者同行对齐。
             标签定宽（两行标签等宽 → 输入框左边缘对齐）；日期框与时间框【等宽】：
             各 flex:1 1 0 + min-width:0，平分标签之外的剩余宽度，两端对齐。
             窄容器下整体换行（flex-wrap），标签与两个输入框保持同组不拆散。 */
          .dsh-session-kit-memory-form-facttime { display: flex; flex-direction: column; gap: 10px; }
          .dsh-session-kit-memory-facttime-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
          .dsh-session-kit-memory-facttime-label {
            flex: 0 0 auto;
            min-width: 88px;
            color: var(--dsw-alias-label-primary);
            font-size: 13px;
            font-weight: 650;
            white-space: nowrap;
          }
          /* 两个输入框等宽：basis 0 + grow 1 让它们精确平分剩余空间（含 flex-wrap 场景）。
             min-width 保底 120px，避免极窄容器下被压成不可用的窄条。 */
          .dsh-session-kit-memory-facttime-row > .dsh-session-kit-memory-date-input,
          .dsh-session-kit-memory-facttime-row > .dsh-session-kit-memory-clock-input { flex: 1 1 0; min-width: 120px; }
          .dsh-session-kit-memory-clock-input { text-align: center; font-variant-numeric: tabular-nums; }
          /* 原生日期控件（type=date）：必须声明 color-scheme，否则暗色主题下浏览器仍按
             浅色渲染日历图标（深色图标 + 深色输入框背景 = 几乎不可见）。
             light dark 让浏览器跟随系统/宿主的配色方案自绘，不写死单一主题。
             高度与同行的 rename-input（38px）保持一致；text-transform:none 防止某些
             字体把日期里的数字做样式化处理。 */
          .dsh-session-kit-memory-date-input {
            color-scheme: light dark;
            height: 38px;
            min-width: 0;
            font-variant-numeric: tabular-nums;
            cursor: text;
          }
          .dsh-session-kit-memory-date-input:disabled { cursor: not-allowed; }
          /* 日历图标在部分 Chromium 版本里不跟随 color-scheme，用 filter 兜一层：
             暗色下浅色主题图标会偏暗，invert 后恢复可见（不影响已跟随主题的浏览器）。 */
          .dsh-session-kit-memory-date-input::-webkit-calendar-picker-indicator { cursor: pointer; opacity: .75; }
          .dsh-session-kit-memory-date-input::-webkit-calendar-picker-indicator:hover { opacity: 1; }
          .dsh-session-kit-memory-date-input:disabled::-webkit-calendar-picker-indicator { cursor: not-allowed; opacity: .4; }
          .dsh-session-kit-memory-pagination { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 2px 0; }
          .dsh-session-kit-memory-pagination-text { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; font-variant-numeric: tabular-nums; }
          .dsh-session-kit-memory-meta-time-row > .dsh-session-kit-memory-meta-lastrecalled { margin-left: auto; }
          .dsh-session-kit-memory-usage { min-width: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .dsh-session-kit-memory-card-store-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-left: 10px; }
          .dsh-session-kit-turn-memory-tag { position: relative; display: inline-flex; min-width: 0; }
          .dsh-session-kit-turn-action { transition: color 140ms ease, background 140ms ease; }
          .dsh-session-kit-turn-action:hover:not([aria-disabled="true"]) { color: var(--dsw-alias-label-primary) !important; background: var(--dsw-alias-interactive-bg-hover) !important; }
          .dsh-session-kit-turn-action.dsh-session-kit-turn-action-danger:hover:not([aria-disabled="true"]) { color: var(--dsw-alias-state-error-primary) !important; background: var(--dsw-alias-interactive-bg-hover-danger, color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent)) !important; }
          .dsh-session-kit-turn-memory-trigger { display: inline-flex; align-items: center; gap: 4px; border: 0; border-radius: 999px; background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 12px; line-height: 18px; padding: 6px; cursor: pointer; }
          .dsh-session-kit-turn-memory-trigger:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
          .dsh-session-kit-turn-memory-trigger > svg { flex: none; display: block; }
          .dsh-session-kit-turn-memory-label { min-width: 0; white-space: nowrap; }
          .dsh-session-kit-turn-memory-panel { position: fixed; z-index: 1400; box-sizing: border-box; width: 362px; max-width: calc(100vw - 32px); max-height: 320px; overflow: hidden; display: flex; flex-direction: column; padding: 10px 6px; border: 1px solid var(--dsw-alias-border-inverted); border-radius: 10px; background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-base, var(--dsw-specific-menu))); box-shadow: var(--dsw-shadow-lv3); }
          .dsh-session-kit-turn-memory-panel-scroll { min-height: 0; max-height: 300px; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; gap: 8px; padding: 0 6px; scrollbar-gutter: stable both-edges; }
          .dsh-session-kit-turn-memory-panel-scroll::-webkit-scrollbar { width: 3px; height: 3px; background: transparent; }
          .dsh-session-kit-turn-memory-panel-scroll::-webkit-scrollbar:vertical { width: 3px; }
          .dsh-session-kit-turn-memory-panel-scroll::-webkit-scrollbar:horizontal { height: 0; }
          .dsh-session-kit-turn-memory-panel-scroll::-webkit-scrollbar-button { width: 0 !important; height: 0 !important; display: none !important; background: transparent !important; border: 0 !important; }
          .dsh-session-kit-turn-memory-panel-scroll::-webkit-scrollbar-thumb { border-radius: 999px; background: color-mix(in srgb, var(--dsw-alias-label-caption) 48%, transparent); }
          .dsh-session-kit-turn-memory-panel-scroll::-webkit-scrollbar-thumb:hover { background: color-mix(in srgb, var(--dsw-alias-label-caption) 62%, transparent); }
          .dsh-session-kit-turn-memory-panel-scroll::-webkit-scrollbar-track,
          .dsh-session-kit-turn-memory-panel-scroll::-webkit-scrollbar-track-piece,
          .dsh-session-kit-turn-memory-panel-scroll::-webkit-scrollbar-corner { background: transparent !important; border: 0 !important; }
          .dsh-session-kit-turn-memory-panel-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
          .dsh-session-kit-turn-memory-panel-title-main { min-width: 0; display: inline-flex; align-items: center; gap: 6px; }
          .dsh-session-kit-turn-memory-panel-title-main > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .dsh-session-kit-turn-memory-panel-title-main > svg { flex: none; display: block; }
          .dsh-session-kit-turn-memory-panel-count { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; font-variant-numeric: tabular-nums; white-space: nowrap; }
          .dsh-session-kit-turn-memory-new-count { color: var(--dsw-alias-state-success-primary); font-weight: 600; }
          .dsh-session-kit-turn-memory-panel-title-right { flex: none; display: inline-flex; align-items: center; gap: 6px; }
          .dsh-session-kit-turn-memory-search-toggle { box-sizing: border-box; flex: none; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; padding: 0; margin: 0; appearance: none; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; line-height: 0; transition: background-color .15s ease, color .15s ease; }
          .dsh-session-kit-turn-memory-search-toggle:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
          .dsh-session-kit-turn-memory-search-toggle[aria-pressed="true"] { color: var(--dsw-alias-state-business-primary); background: var(--dsw-alias-interactive-bg-hover); }
          .dsh-session-kit-turn-memory-search { position: relative; display: flex; align-items: center; min-width: 0; }
          .dsh-session-kit-turn-memory-search-icon { position: absolute; left: 9px; top: 50%; display: inline-flex; align-items: center; justify-content: center; color: var(--dsw-alias-label-tertiary); pointer-events: none; transform: translateY(-50%); z-index: 1; }
          .dsh-session-kit-turn-memory-search-input { box-sizing: border-box; width: 100%; height: 28px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; line-height: 18px; outline: none; padding: 0 28px 0 27px; }
          .dsh-session-kit-turn-memory-search-input:focus { border-color: var(--dsw-alias-state-business-primary); box-shadow: 0 0 0 2px rgba(77, 107, 254, .14); }
          .dsh-session-kit-turn-memory-search-input::placeholder { color: var(--dsw-alias-label-tertiary); }
          .dsh-session-kit-turn-memory-search-clear { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); box-sizing: border-box; width: 20px; height: 20px; flex: none; display: inline-flex; align-items: center; justify-content: center; padding: 0; margin: 0; appearance: none; border: 0; border-radius: 999px; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; line-height: 0; transition: background-color .15s ease, color .15s ease; }
          .dsh-session-kit-turn-memory-search-clear:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
          .dsh-session-kit-turn-memory-muted { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
          .dsh-session-kit-turn-memory-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }
          .dsh-session-kit-turn-memory-item { display: flex; flex-direction: column; gap: 4px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-interactive-bg-hover); padding: 8px 10px; }
          /* 小面板条目复用记忆卡片 meta 行结构（项目一行/标签行 chips 换行），字号沿用面板 12px */
          .dsh-session-kit-turn-memory-item-meta-row, .dsh-session-kit-turn-memory-item-tags-row { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
          .dsh-session-kit-turn-memory-item-tags-row .dsh-session-kit-memory-meta-tag-chip { font-size: 11px; line-height: 16px; padding: 0 6px; }
          .dsh-session-kit-turn-memory-item-text { color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
          /* ── 「记忆」视图（conversation.view 的 session-kit tab） ── */
          .dsh-session-kit-session-memory { display: flex; flex-direction: column; gap: 10px; box-sizing: border-box; width: 100%; max-width: 860px; margin: 0 auto; padding: 16px 20px 32px; }
          .dsh-session-kit-session-memory-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
          .dsh-session-kit-session-memory-head-main { min-width: 0; display: inline-flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 600; }
          .dsh-session-kit-session-memory-head-main > svg { flex: none; display: block; }
          .dsh-session-kit-session-memory-head-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .dsh-session-kit-session-memory-turn { flex: none; padding: 1px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; font-variant-numeric: tabular-nums; }
          .dsh-session-kit-session-memory-refresh { box-sizing: border-box; flex: none; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; margin-left: auto; padding: 0; appearance: none; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; font: inherit; font-size: 14px; line-height: 1; transition: background-color .15s ease, color .15s ease; }
          .dsh-session-kit-session-memory-refresh:hover:not(:disabled) { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
          .dsh-session-kit-session-memory-refresh:disabled { opacity: .45; cursor: default; }
          .dsh-session-kit-session-memory-search { position: relative; display: flex; align-items: center; min-width: 0; }
          /* 圆饼图：位于搜索框上方，左侧环形图 + 右侧图例，整体居中。 */
          .dsh-session-kit-session-memory-pie-row { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 10px 16px; padding: 2px 0 4px; }
          .dsh-session-kit-session-memory-pie { position: relative; flex: none; display: inline-flex; align-items: center; justify-content: center; width: 64px; height: 64px; }
          .dsh-session-kit-session-memory-pie svg { display: block; }
          .dsh-session-kit-session-memory-pie-arc { transform: rotate(-90deg); transform-origin: 50% 50%; transform-box: fill-box; transition: stroke-dasharray 220ms ease, stroke-dashoffset 220ms ease; }
          .dsh-session-kit-session-memory-pie-track { stroke: var(--dsw-alias-interactive-bg-hover); }
          .dsh-session-kit-session-memory-pie-arc[data-kind="pinned"] { stroke: var(--dsw-alias-state-business-primary, #4d6bfe); }
          .dsh-session-kit-session-memory-pie-arc[data-kind="auto"] { stroke: var(--dsw-alias-state-success-primary, #12a150); }
          .dsh-session-kit-session-memory-pie-center { position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); text-align: center; color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 600; line-height: 1; font-variant-numeric: tabular-nums; pointer-events: none; }
          .dsh-session-kit-session-memory-pie-legend { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
          .dsh-session-kit-session-memory-pie-item { display: flex; align-items: center; gap: 6px; min-width: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
          .dsh-session-kit-session-memory-pie-swatch { flex: none; width: 8px; height: 8px; border-radius: 2px; }
          .dsh-session-kit-session-memory-pie-swatch[data-kind="pinned"] { background: var(--dsw-alias-state-business-primary, #4d6bfe); }
          .dsh-session-kit-session-memory-pie-swatch[data-kind="auto"] { background: var(--dsw-alias-state-success-primary, #12a150); }
          .dsh-session-kit-session-memory-pie-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
          /* 自动注入的四段构成：图表下方单独一行、居中，格式「自动注入构成：[ 段 1 底色 ] 3 条 …」。
             配色与条目行段位徽标一致；数量非 0 的段才渲染（由 JS 过滤）。 */
          .dsh-session-kit-session-memory-segments { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: center; gap: 4px 12px; padding: 0 0 4px; min-width: 0; }
          .dsh-session-kit-session-memory-segments-label { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; white-space: nowrap; }
          .dsh-session-kit-session-memory-segments-item { display: inline-flex; align-items: baseline; gap: 4px; font-size: 11px; line-height: 16px; white-space: nowrap; font-variant-numeric: tabular-nums; }
          .dsh-session-kit-session-memory-segments-count { font-weight: 600; }
          .dsh-session-kit-session-memory-segments-item-bottom { color: var(--dsw-alias-state-business-primary); }
          .dsh-session-kit-session-memory-segments-item-ephemeral { color: var(--dsw-alias-state-warning-primary, #d89614); }
          .dsh-session-kit-session-memory-segments-item-mixed { color: var(--dsw-alias-state-success-primary, #12a150); }
          .dsh-session-kit-session-memory-segments-item-fallback { color: var(--dsw-alias-label-secondary); }
          .dsh-session-kit-session-memory-search-icon { position: absolute; left: 9px; top: 50%; display: inline-flex; align-items: center; justify-content: center; color: var(--dsw-alias-label-tertiary); pointer-events: none; transform: translateY(-50%); z-index: 1; }
          .dsh-session-kit-session-memory-search-input { box-sizing: border-box; width: 100%; height: 30px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; line-height: 18px; outline: none; padding: 0 28px 0 27px; }
          .dsh-session-kit-session-memory-search-input:focus { border-color: var(--dsw-alias-state-business-primary); box-shadow: 0 0 0 2px rgba(77, 107, 254, .14); }
          .dsh-session-kit-session-memory-search-input::placeholder { color: var(--dsw-alias-label-tertiary); }
          .dsh-session-kit-session-memory-search-clear { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); box-sizing: border-box; width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; padding: 0; margin: 0; appearance: none; border: 0; border-radius: 999px; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; line-height: 0; }
          .dsh-session-kit-session-memory-search-clear:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
          .dsh-session-kit-session-memory-body { display: flex; flex-direction: column; gap: 10px; }
          .dsh-session-kit-session-memory-section { display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-base)); padding: 10px 12px; }
          .dsh-session-kit-session-memory-section-head { display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0; padding: 0; appearance: none; border: 0; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; text-align: left; }
          .dsh-session-kit-session-memory-section-head:hover { color: var(--dsw-alias-state-business-primary); }
          .dsh-session-kit-session-memory-chevron { flex: none; width: 12px; display: inline-flex; justify-content: center; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 1; }
          .dsh-session-kit-session-memory-section-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .dsh-session-kit-session-memory-section-count { flex: none; margin-left: auto; color: var(--dsw-alias-label-tertiary); font-size: 12px; font-weight: 400; line-height: 18px; font-variant-numeric: tabular-nums; }
          .dsh-session-kit-session-memory-section-hint { padding-left: 18px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
          .dsh-session-kit-session-memory-item { display: flex; flex-direction: column; gap: 4px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-interactive-bg-hover); padding: 8px 10px; }
          /* 首行：目录名自适应宽度，段位徽标紧跟其右侧，其余标记（+ / 📌）钉在行尾。
             auto 边距只给「组内第一个尾部标记」（+ 优先，否则 📌），把尾部标记推到右侧；
             若加在 📌 上会让 + 与 📌 被拉开。 */
          .dsh-session-kit-session-memory-item-meta .dsh-session-kit-memory-meta-value { flex: 0 1 auto; min-width: 0; }
          .dsh-session-kit-session-memory-item-meta .dsh-session-kit-turn-memory-new-recall { flex: 0 0 auto; margin-left: auto; }
          .dsh-session-kit-session-memory-item-meta .dsh-session-kit-turn-memory-pinned { flex: 0 0 auto; }
          /* 无 + 时由 📌 承担推右（:only-of-type 不适用，用相邻兄弟判定）。 */
          .dsh-session-kit-session-memory-item-meta .dsh-session-kit-memory-meta-value + .dsh-session-kit-turn-memory-pinned { margin-left: auto; }
          /* 段位徽标：紧跟目录名右侧，不参与推右。四种段位用不同色调区分。 */
          .dsh-session-kit-session-memory-segment { flex: 0 0 auto; padding: 0 6px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); font-size: 11px; line-height: 16px; white-space: nowrap; cursor: help; user-select: none; }
          .dsh-session-kit-session-memory-segment-bottom { color: var(--dsw-alias-state-business-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 42%, var(--dsw-alias-border-l2)); background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 9%, transparent); }
          .dsh-session-kit-session-memory-segment-ephemeral { color: var(--dsw-alias-state-warning-primary, #d89614); border-color: color-mix(in srgb, var(--dsw-alias-state-warning-primary, #d89614) 42%, var(--dsw-alias-border-l2)); background: color-mix(in srgb, var(--dsw-alias-state-warning-primary, #d89614) 9%, transparent); }
          .dsh-session-kit-session-memory-segment-mixed { color: var(--dsw-alias-state-success-primary, #12a150); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #12a150) 42%, var(--dsw-alias-border-l2)); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #12a150) 9%, transparent); }
          .dsh-session-kit-session-memory-segment-fallback { color: var(--dsw-alias-label-secondary); }
          /* 段位徽标是尾部标记组的一员：它独自存在时（+ 与 📌 都不在）也要把行尾留白。 */
          .dsh-session-kit-session-memory-item-meta .dsh-session-kit-session-memory-segment:last-child { margin-left: auto; }
          .dsh-session-kit-session-memory-item-text { max-height: 200px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 1.55; }
          .dsh-session-kit-session-memory-muted { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; padding: 2px 0; }
          .dsh-session-kit-session-memory-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }
          .dsh-session-kit-memory-editor { margin-bottom: 2px; background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 5%, var(--dsw-alias-bg-base)); }
          /* 注意：同 mini-textarea，不声明 scrollbar-width/scrollbar-color（会压制 webkit 规则）。 */
          .dsh-session-kit-memory-editor-textarea { min-height: 140px; }
          /* “记忆内容”标题与“美化格式”按钮同行：标题可压缩省略，按钮保持完整。 */
          .dsh-session-kit-memory-editor-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
          .dsh-session-kit-memory-editor-head > span, .dsh-session-kit-memory-editor-head > label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary); font-weight: 650; cursor: pointer; }
          .dsh-session-kit-memory-beautify-button { flex: none; gap: 6px; }
          .dsh-session-kit-memory-form-notice { padding: 5px 10px; border: 1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 42%, transparent); border-radius: 8px; background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 8%, transparent); color: var(--dsw-alias-state-business-primary); font-size: 12px; line-height: 17px; }
          .dsh-session-kit-memory-tag-picker-field { display: flex; flex-direction: column; gap: 8px; }
          .dsh-session-kit-memory-tag-picker-head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
          .dsh-session-kit-memory-tag-picker-label { flex: none; color: var(--dsw-alias-label-primary); font-weight: 650; }
          .dsh-session-kit-memory-tag-picker-search { box-sizing: border-box; flex: 1 1 130px; min-width: 0; height: 28px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; line-height: 18px; outline: none; padding: 0 9px; }
          .dsh-session-kit-memory-tag-picker-search:focus { border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 42%, var(--dsw-alias-border-l2)); }
          .dsh-session-kit-memory-tag-picker-search:disabled { opacity: .6; cursor: not-allowed; }
          .dsh-session-kit-memory-tag-picker-only { flex: none; display: inline-flex; align-items: center; gap: 5px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; cursor: pointer; }
          .dsh-session-kit-memory-tag-picker-only:has(input:disabled) { opacity: .6; cursor: not-allowed; }
          .dsh-session-kit-memory-checks-more { flex-basis: 100%; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; text-align: center; }
          .dsh-session-kit-memory-checks { display: flex; flex-wrap: wrap; gap: 8px; }
          .dsh-session-kit-memory-check { display: inline-flex; align-items: center; gap: 6px; min-height: 28px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; padding: 2px 9px; cursor: pointer; }
          .dsh-session-kit-memory-check:has(input:checked) { color: var(--dsw-alias-state-business-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 42%, var(--dsw-alias-border-l2)); background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 8%, transparent); }
          .dsh-session-kit-memory-status-toggle { margin-right: auto; }
          .dsh-session-kit-distill-hourglass { display: inline-block; transform-origin: 50% 50%; animation: dsh-session-kit-distill-hourglass-rotate 1800ms linear infinite; }
          .dsh-session-kit-distill-hourglass-sand { animation: dsh-session-kit-distill-hourglass-sand 1800ms ease-in-out infinite; transform-origin: 50% 50%; }
          @keyframes dsh-session-kit-distill-hourglass-rotate { 0% { transform: rotate(0deg); } 70% { transform: rotate(360deg); } 100% { transform: rotate(360deg); } }
          @keyframes dsh-session-kit-distill-hourglass-sand { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }
          @supports selector(::-webkit-scrollbar) { .dsh-session-kit-memory-tabs::-webkit-scrollbar, .dsh-session-kit-memory-main::-webkit-scrollbar, .dsh-session-kit-memory-text::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; } .dsh-session-kit-memory-tabs::-webkit-scrollbar-thumb, .dsh-session-kit-memory-main::-webkit-scrollbar-thumb, .dsh-session-kit-memory-text::-webkit-scrollbar-thumb { border-radius: 999px; background: color-mix(in srgb, var(--dsw-alias-label-caption) 48%, transparent); } }
          @supports selector(::-webkit-scrollbar) { .dsh-session-kit-memory-text::-webkit-scrollbar { width: 3px; height: 3px; } }
          @media (prefers-reduced-motion: reduce) { .dsh-session-kit-memory *, .dsh-session-kit-toggle-switch, .dsh-session-kit-toggle-switch-knob, .dsh-session-kit-memory-activity-badge-running { animation: none !important; transition: none !important; } }
          @media (max-width: 760px) { .dsh-session-kit-memory-toolbar, .dsh-session-kit-memory-grid { grid-template-columns: 1fr; } .dsh-session-kit-memory-top-actions { justify-content: flex-start; } .dsh-session-kit-memory-footer-left { width: 100%; margin-right: 0; } }
          .dsh-session-kit-archive { display: flex; flex-direction: column; gap: 12px; max-height: min(68vh, 640px); overflow: hidden; }
          .dsh-session-kit-archive-head { display: flex; align-items: flex-start; justify-content: flex-end; gap: 16px; padding-bottom: 2px; }
          .dsh-session-kit-archive-description { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.55; }
          .dsh-session-kit-archive-toolbar { display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex: none; margin-left: auto; }
          .dsh-session-kit-archive-count { color: var(--dsw-alias-label-tertiary); font-size: 12px; white-space: nowrap; }
          .dsh-session-kit-archive-filter-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(180px, 260px); gap: 10px; align-items: center; }
          .dsh-session-kit-archive-search { position: relative; display: flex; align-items: center; min-width: 0; }
          .dsh-session-kit-archive-search-icon { position: absolute; left: 12px; top: 50%; display: inline-flex; align-items: center; justify-content: center; color: var(--dsw-alias-label-tertiary); pointer-events: none; transform: translateY(-50%); z-index: 1; }
          .dsh-session-kit-archive-search-input { box-sizing: border-box; width: 100%; height: 36px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; outline: none; padding: 0 38px 0 12px; }
          .dsh-session-kit-archive-search-with-icon .dsh-session-kit-archive-search-input { padding-left: 36px; }
          .dsh-session-kit-archive-workdir-menu { position: relative; width: 100%; min-width: 0; display: inline-flex; }
          .dsh-session-kit-archive-workdir-anchor { width: 100%; min-width: 0; display: flex; }
          .dsh-session-kit-archive-workdir-anchor > button { box-sizing: border-box; width: 100%; height: 36px; justify-content: space-between; border-radius: 10px; font-size: 13px; line-height: 20px; padding: 0 12px; }
          .dsh-session-kit-archive-workdir-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .dsh-session-kit-archive-workdir-panel { box-sizing: border-box; position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 1100; width: 100%; min-width: 100%; max-width: 100%; display: flex; flex-direction: column; gap: 4px; padding: 6px; border: 1px solid var(--dsw-alias-border-inverted); border-radius: 12px; background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-base, var(--dsw-specific-menu))); box-shadow: var(--dsw-shadow-lv3); }
          .dsh-session-kit-archive-workdir-search { position: relative; display: flex; align-items: center; min-width: 0; flex: none; }
          .dsh-session-kit-archive-workdir-search-input { height: 36px; }
          .dsh-session-kit-archive-workdir-options { display: flex; flex-direction: column; gap: 2px; max-height: min(280px, 45vh); overflow-y: auto; overflow-x: hidden; }
          .dsh-session-kit-archive-workdir-option { box-sizing: border-box; width: 100%; min-width: 0; height: 36px; min-height: 36px; display: flex; align-items: center; justify-content: space-between; gap: 8px; border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 20px; text-align: left; padding: 0 10px; cursor: pointer; }
          .dsh-session-kit-archive-workdir-option:hover { background: var(--dsw-alias-interactive-bg-hover); }
          .dsh-session-kit-archive-workdir-option:focus-visible { outline: 2px solid rgba(77, 107, 254, .35); outline-offset: 1px; }
          .dsh-session-kit-archive-workdir-option-selected { background: var(--dsw-alias-interactive-bg-hover); }
          .dsh-session-kit-archive-workdir-option-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .dsh-session-kit-archive-workdir-empty { padding: 8px 10px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; text-align: center; }
          .dsh-session-kit-archive-search-input:focus { border-color: var(--dsw-alias-state-business-primary); box-shadow: 0 0 0 2px rgba(77, 107, 254, .14); }
          .dsh-session-kit-archive-search-input::placeholder { color: var(--dsw-alias-label-tertiary); }
          .dsh-session-kit-archive-search-clear { position: absolute; right: 7px; top: 50%; transform: translateY(-50%); box-sizing: border-box; width: 22px; height: 22px; flex: none; display: inline-flex; align-items: center; justify-content: center; padding: 0; margin: 0; appearance: none; border: 0; border-radius: 999px; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; line-height: 0; transition: background-color .15s ease, color .15s ease; }
          .dsh-session-kit-archive-search-clear:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
          .dsh-session-kit-archive-search-clear:active { background: var(--dsw-alias-interactive-bg-active); color: var(--dsw-alias-label-primary); }
          .dsh-session-kit-archive-search-clear:focus-visible { outline: 2px solid rgba(77, 107, 254, .35); outline-offset: 1px; color: var(--dsw-alias-label-primary); }
          .dsh-session-kit-archive-list { display: flex; flex: 1 1 auto; min-height: 0; flex-direction: column; gap: 10px; overflow-y: auto; overflow-x: hidden; padding-right: 8px; scrollbar-gutter: stable; }
          @supports selector(::-webkit-scrollbar) {
            .dsh-session-kit-archive-list::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
            .dsh-session-kit-archive-list::-webkit-scrollbar:vertical { width: 6px; }
            .dsh-session-kit-archive-list::-webkit-scrollbar:horizontal { height: 0; }
            .dsh-session-kit-archive-list::-webkit-scrollbar-button,
            .dsh-session-kit-archive-list::-webkit-scrollbar-button:single-button,
            .dsh-session-kit-archive-list::-webkit-scrollbar-button:vertical,
            .dsh-session-kit-archive-list::-webkit-scrollbar-button:horizontal,
            .dsh-session-kit-archive-list::-webkit-scrollbar-button:vertical:start:decrement,
            .dsh-session-kit-archive-list::-webkit-scrollbar-button:vertical:end:increment,
            .dsh-session-kit-archive-list::-webkit-scrollbar-button:horizontal:start:decrement,
            .dsh-session-kit-archive-list::-webkit-scrollbar-button:horizontal:end:increment { -webkit-appearance: none !important; appearance: none !important; width: 0 !important; height: 0 !important; min-width: 0 !important; min-height: 0 !important; display: none !important; background: transparent !important; background-image: none !important; border: 0 !important; box-shadow: none !important; }
            .dsh-session-kit-archive-list::-webkit-scrollbar-thumb { border-radius: 999px; background: color-mix(in srgb, var(--dsw-alias-label-caption) 48%, transparent); }
            .dsh-session-kit-archive-list::-webkit-scrollbar-thumb:hover { background: color-mix(in srgb, var(--dsw-alias-label-caption) 62%, transparent); }
            .dsh-session-kit-archive-list::-webkit-scrollbar-track,
            .dsh-session-kit-archive-list::-webkit-scrollbar-track-piece,
            .dsh-session-kit-archive-list::-webkit-scrollbar-corner { background: transparent !important; border: 0 !important; }
          }
          @-moz-document url-prefix() { .dsh-session-kit-archive-list { scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--dsw-alias-label-caption) 48%, transparent) transparent; } }
          .dsh-session-kit-archive-empty { padding: 30px 12px; text-align: center; color: var(--dsw-alias-label-secondary); border: 1px dashed var(--dsw-alias-border-l2); border-radius: 12px; }
          .dsh-session-kit-archive-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-interactive-bg-hover); }
          .dsh-session-kit-archive-main { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
          .dsh-session-kit-archive-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary); font-weight: 600; }
          .dsh-session-kit-archive-meta { min-width: 0; display: flex; align-items: center; gap: 10px; overflow: hidden; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
          .dsh-session-kit-archive-meta-item { min-width: 0; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
          .dsh-session-kit-archive-meta-time { flex: none; }
          .dsh-session-kit-archive-meta-cwd { flex: 1 1 auto; }
          .dsh-session-kit-archive-meta-session { flex: none; }
          .dsh-session-kit-archive-session-copy { flex: none; height: 22px; padding: 0 6px; font-size: 12px; font-family: var(--dsw-font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace); color: var(--dsw-alias-label-tertiary); }
          .dsh-session-kit-archive-session-copy:hover { color: var(--dsw-alias-label-secondary); }
          .dsh-session-kit-archive-session-copy-copied { color: var(--dsw-alias-state-success-primary); }
          .dsh-session-kit-archive-meta-icon { flex: none; display: inline-flex; align-items: center; justify-content: center; color: var(--dsw-alias-label-tertiary); }
          .dsh-session-kit-archive-meta-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .dsh-session-kit-archive-meta-status { flex: none; white-space: nowrap; }
          .dsh-session-kit-archive-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
          .dsh-session-kit-archive-error { color: var(--dsw-alias-state-error-primary); background: rgba(239, 68, 68, .1); border-radius: 10px; padding: 8px 10px; font-size: 13px; line-height: 1.5; }
          /* 归档弹窗的标题区提示比记忆弹窗窄：固定 38% 宽度 */
          .dsh-session-kit-archive-modal .dsh-session-kit-modal-title-notice { width: 38%; max-width: 38%; }
          .dsh-session-kit-stats { display: flex; flex-direction: column; gap: 12px; max-height: min(68vh, 520px); overflow: hidden; }
          /* 标题右侧的“复制会话ID”：Modal 的 title 会被同时用作 h2 内容与
             aria-label，传节点会破坏无障碍并触发告警，故 title 保持纯字符串，
             按钮改由 body 首位绝对定位到标题行。定位基准是 Modal 的 .dialog
             （其自带 position: relative）；右偏移避开关闭按钮（28px 宽 + 14px 内边距）。
             垂直位置与 .header 的 padding-top(22px) 对齐，使按钮与标题中线齐平。 */
          .dsh-session-kit-stats-modal { position: relative; }
          .dsh-session-kit-stats-title-actions { position: absolute; top: 20px; right: 50px; display: flex; align-items: center; gap: 8px; }
          .dsh-session-kit-stats-copy-id { flex: 0 0 auto; white-space: nowrap; }
          /* 底部：提示在左、关闭按钮在右，同一行；提示为空时不占视觉高度。 */
          .dsh-session-kit-stats-footer { display: flex; align-items: center; justify-content: flex-end; gap: 12px; width: 100%; }
          .dsh-session-kit-stats-copy-status { flex: 1 1 auto; min-width: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.5; }
          .dsh-session-kit-stats-copy-status-error { color: var(--dsw-alias-state-error-primary); }
          .dsh-session-kit-stats-summary { display: flex; flex-wrap: wrap; gap: 8px; }
          .dsh-session-kit-stats-summary > span { border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); padding: 4px 10px; font-size: 12px; line-height: 18px; }
          .dsh-session-kit-stats-list { display: flex; flex: 1 1 auto; min-height: 0; flex-direction: column; gap: 8px; overflow-y: auto; overflow-x: hidden; padding-right: 8px; scrollbar-gutter: stable; }
          @supports selector(::-webkit-scrollbar) {
            .dsh-session-kit-stats-list::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
            .dsh-session-kit-stats-list::-webkit-scrollbar:vertical { width: 6px; }
            .dsh-session-kit-stats-list::-webkit-scrollbar:horizontal { height: 0; }
            .dsh-session-kit-stats-list::-webkit-scrollbar-button,
            .dsh-session-kit-stats-list::-webkit-scrollbar-button:single-button,
            .dsh-session-kit-stats-list::-webkit-scrollbar-button:vertical,
            .dsh-session-kit-stats-list::-webkit-scrollbar-button:horizontal,
            .dsh-session-kit-stats-list::-webkit-scrollbar-button:vertical:start:decrement,
            .dsh-session-kit-stats-list::-webkit-scrollbar-button:vertical:end:increment,
            .dsh-session-kit-stats-list::-webkit-scrollbar-button:horizontal:start:decrement,
            .dsh-session-kit-stats-list::-webkit-scrollbar-button:horizontal:end:increment { -webkit-appearance: none !important; appearance: none !important; width: 0 !important; height: 0 !important; min-width: 0 !important; min-height: 0 !important; display: none !important; background: transparent !important; background-image: none !important; border: 0 !important; box-shadow: none !important; }
            .dsh-session-kit-stats-list::-webkit-scrollbar-thumb { border-radius: 999px; background: color-mix(in srgb, var(--dsw-alias-label-caption) 48%, transparent); }
            .dsh-session-kit-stats-list::-webkit-scrollbar-thumb:hover { background: color-mix(in srgb, var(--dsw-alias-label-caption) 62%, transparent); }
            .dsh-session-kit-stats-list::-webkit-scrollbar-track,
            .dsh-session-kit-stats-list::-webkit-scrollbar-track-piece,
            .dsh-session-kit-stats-list::-webkit-scrollbar-corner { background: transparent !important; border: 0 !important; }
          }
          @-moz-document url-prefix() { .dsh-session-kit-stats-list { scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--dsw-alias-label-caption) 48%, transparent) transparent; } }
          .dsh-session-kit-stats-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-base); }
          .dsh-session-kit-stats-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary); font-weight: 650; }
          .dsh-session-kit-stats-values { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
          .dsh-session-kit-stats-failed { color: var(--dsw-alias-state-error-primary); }
          .dsh-session-kit-preview { display: flex; flex-direction: column; gap: 10px; height: min(76vh, 760px); max-height: min(76vh, 760px); overflow: hidden; }
          .dsh-session-kit-preview-head { flex: none; display: flex; flex-direction: column; gap: 10px; padding-bottom: 10px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
          .dsh-session-kit-preview-title-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; }
          .dsh-session-kit-preview-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary); font-weight: 700; }
          .dsh-session-kit-preview-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex: none; }
          .dsh-session-kit-preview-attrs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
          .dsh-session-kit-preview-attr-card { position: relative; min-width: 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-base); padding: 9px 10px; display: flex; flex-direction: column; gap: 4px; }
          .dsh-session-kit-preview-attr-card:has(> .dsh-session-kit-preview-attr-copy) { padding-right: 36px; }
          .dsh-session-kit-preview-attr-copy { position: absolute; top: 7px; right: 7px; width: 24px; min-width: 24px; height: 24px; padding: 0 !important; color: var(--dsw-alias-label-secondary) !important; }
          .dsh-session-kit-preview-attr-copy:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover) !important; color: var(--dsw-alias-label-secondary) !important; }
          .dsh-session-kit-preview-attr-copy:active:not(:disabled) { background: var(--dsw-alias-interactive-bg-active) !important; color: var(--dsw-alias-label-secondary) !important; }
          .dsh-session-kit-preview-attr-copy-copied, .dsh-session-kit-preview-attr-copy-copied:hover:not(:disabled) { color: var(--dsw-alias-state-success-primary, #12a150) !important; }
          .dsh-session-kit-preview-attr-label { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 16px; }
          .dsh-session-kit-preview-attr-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px; font-weight: 600; }
          .dsh-session-kit-preview-tools { display: flex; flex-direction: column; gap: 10px; margin-top: 0; }
          .dsh-session-kit-preview-tools-label { color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 650; }
          .dsh-session-kit-preview-tools-empty { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
          .dsh-session-kit-preview-tool-list { display: flex; flex-wrap: wrap; gap: 6px; }
          .dsh-session-kit-preview-tool-chip { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); padding: 3px 8px; font-size: 12px; line-height: 18px; }
          .dsh-session-kit-preview-body { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: 10px; }
          .dsh-session-kit-preview-sidebar { min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-base); overflow: hidden; }
          .dsh-session-kit-preview-sidebar-title { flex: none; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; font-weight: 650; }
          .dsh-session-kit-preview-toc-list { flex: none; height: 336px; min-height: 336px; max-height: 336px; overflow-y: hidden; overflow-x: hidden; display: flex; flex-direction: column; gap: 4px; padding-right: 0; scrollbar-gutter: auto; }
          .dsh-session-kit-preview-toc-item { box-sizing: border-box; width: 100%; min-height: 30px; display: flex; align-items: center; gap: 8px; border: 0; border-radius: 9px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; text-align: left; font: inherit; font-size: 12px; line-height: 18px; padding: 5px 6px; }
          .dsh-session-kit-preview-toc-item:hover, .dsh-session-kit-preview-toc-item:focus-visible { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); outline: none; }
          .dsh-session-kit-preview-toc-index { flex: none; min-width: 22px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
          .dsh-session-kit-preview-toc-text { min-width: 0; flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .dsh-session-kit-preview-pager { flex: none; display: flex; align-items: center; justify-content: center; gap: 8px; padding-top: 4px; }
          .dsh-session-kit-preview-page-text { min-width: 76px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; text-align: center; white-space: nowrap; }
          .dsh-session-kit-preview-main { min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 10px; }
          .dsh-session-kit-preview-search-row { flex: none; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; }
          .dsh-session-kit-preview-search { position: relative; display: flex; align-items: center; min-width: 0; }
          .dsh-session-kit-preview-search-icon { position: absolute; left: 12px; top: 50%; display: inline-flex; align-items: center; justify-content: center; color: var(--dsw-alias-label-tertiary); pointer-events: none; transform: translateY(-50%); z-index: 1; }
          .dsh-session-kit-preview-count { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; white-space: nowrap; }
          .dsh-session-kit-preview-search-input { box-sizing: border-box; width: 100%; height: 36px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; outline: none; padding: 0 38px 0 12px; }
          .dsh-session-kit-preview-search-with-icon .dsh-session-kit-preview-search-input { padding-left: 36px; }
          .dsh-session-kit-preview-search-input:focus { border-color: var(--dsw-alias-state-business-primary); box-shadow: 0 0 0 2px rgba(77, 107, 254, .14); }
          .dsh-session-kit-preview-search-input::placeholder { color: var(--dsw-alias-label-tertiary); }
          .dsh-session-kit-preview-search-clear { position: absolute; right: 7px; top: 50%; transform: translateY(-50%); box-sizing: border-box; width: 22px; height: 22px; flex: none; display: inline-flex; align-items: center; justify-content: center; padding: 0; margin: 0; appearance: none; border: 0; border-radius: 999px; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; line-height: 0; transition: background-color .15s ease, color .15s ease; }
          .dsh-session-kit-preview-search-clear:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
          .dsh-session-kit-preview-search-clear:active { background: var(--dsw-alias-interactive-bg-active); color: var(--dsw-alias-label-primary); }
          .dsh-session-kit-preview-search-clear:focus-visible { outline: 2px solid rgba(77, 107, 254, .35); outline-offset: 1px; color: var(--dsw-alias-label-primary); }
          .dsh-session-kit-preview-list { --dsh-session-kit-preview-message-gap: 12px; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: var(--dsh-session-kit-preview-message-gap); overflow-y: auto; overflow-x: hidden; padding-right: 8px; scrollbar-gutter: stable; }
          .dsh-session-kit-preview-toc-list,
          .dsh-session-kit-preview-list { --dsh-session-kit-preview-scrollbar-thumb: rgba(100, 116, 139, .48); --dsh-session-kit-preview-scrollbar-thumb-hover: rgba(100, 116, 139, .62); }
          @supports (color: color-mix(in srgb, black 50%, transparent)) {
            .dsh-session-kit-preview-toc-list,
            .dsh-session-kit-preview-list { --dsh-session-kit-preview-scrollbar-thumb: color-mix(in srgb, var(--dsw-alias-label-caption) 48%, transparent); --dsh-session-kit-preview-scrollbar-thumb-hover: color-mix(in srgb, var(--dsw-alias-label-caption) 62%, transparent); }
          }
          @-moz-document url-prefix() {
            .dsh-session-kit-preview-toc-list,
            .dsh-session-kit-preview-list { scrollbar-width: thin; scrollbar-color: var(--dsh-session-kit-preview-scrollbar-thumb) transparent; }
          }
          .dsh-session-kit-preview-toc-list::-webkit-scrollbar,
          .dsh-session-kit-preview-list::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
          .dsh-session-kit-preview-toc-list::-webkit-scrollbar:vertical,
          .dsh-session-kit-preview-list::-webkit-scrollbar:vertical { width: 6px; }
          .dsh-session-kit-preview-toc-list::-webkit-scrollbar:horizontal,
          .dsh-session-kit-preview-list::-webkit-scrollbar:horizontal { height: 0; }
          .dsh-session-kit-preview-toc-list::-webkit-scrollbar-button,
          .dsh-session-kit-preview-toc-list::-webkit-scrollbar-button:single-button,
          .dsh-session-kit-preview-toc-list::-webkit-scrollbar-button:vertical,
          .dsh-session-kit-preview-toc-list::-webkit-scrollbar-button:horizontal,
          .dsh-session-kit-preview-toc-list::-webkit-scrollbar-button:vertical:start:decrement,
          .dsh-session-kit-preview-toc-list::-webkit-scrollbar-button:vertical:end:increment,
          .dsh-session-kit-preview-toc-list::-webkit-scrollbar-button:horizontal:start:decrement,
          .dsh-session-kit-preview-toc-list::-webkit-scrollbar-button:horizontal:end:increment,
          .dsh-session-kit-preview-list::-webkit-scrollbar-button,
          .dsh-session-kit-preview-list::-webkit-scrollbar-button:single-button,
          .dsh-session-kit-preview-list::-webkit-scrollbar-button:vertical,
          .dsh-session-kit-preview-list::-webkit-scrollbar-button:horizontal,
          .dsh-session-kit-preview-list::-webkit-scrollbar-button:vertical:start:decrement,
          .dsh-session-kit-preview-list::-webkit-scrollbar-button:vertical:end:increment,
          .dsh-session-kit-preview-list::-webkit-scrollbar-button:horizontal:start:decrement,
          .dsh-session-kit-preview-list::-webkit-scrollbar-button:horizontal:end:increment { -webkit-appearance: none !important; appearance: none !important; width: 0 !important; height: 0 !important; min-width: 0 !important; min-height: 0 !important; inline-size: 0 !important; block-size: 0 !important; display: none !important; visibility: hidden !important; background: transparent !important; background-image: none !important; border: 0 !important; box-shadow: none !important; }
          .dsh-session-kit-preview-toc-list::-webkit-scrollbar-thumb,
          .dsh-session-kit-preview-list::-webkit-scrollbar-thumb { border-radius: 999px; background: var(--dsh-session-kit-preview-scrollbar-thumb); }
          .dsh-session-kit-preview-toc-list::-webkit-scrollbar-thumb:hover,
          .dsh-session-kit-preview-list::-webkit-scrollbar-thumb:hover { background: var(--dsh-session-kit-preview-scrollbar-thumb-hover); }
          .dsh-session-kit-preview-toc-list::-webkit-scrollbar-track,
          .dsh-session-kit-preview-toc-list::-webkit-scrollbar-track-piece,
          .dsh-session-kit-preview-toc-list::-webkit-scrollbar-corner,
          .dsh-session-kit-preview-list::-webkit-scrollbar-track,
          .dsh-session-kit-preview-list::-webkit-scrollbar-track-piece,
          .dsh-session-kit-preview-list::-webkit-scrollbar-corner { background: transparent !important; border: 0 !important; }
          .dsh-session-kit-preview-message-wrap { min-width: 0; }
          .dsh-session-kit-preview-more { display: flex; justify-content: center; padding: 4px 0 2px; }
          .dsh-session-kit-preview-message { display: grid; grid-template-columns: 42px minmax(0, 1fr); gap: 10px; align-items: stretch; padding: 0; border: 0; border-radius: 0; background: transparent; }
          .dsh-session-kit-preview-timeline { position: relative; display: flex; justify-content: center; }
          .dsh-session-kit-preview-timeline::before { content: ''; position: absolute; top: 28px; bottom: calc(-1 * var(--dsh-session-kit-preview-message-gap) - 14px); left: 50%; border-left: 1px dashed color-mix(in srgb, var(--dsw-alias-label-caption) 54%, transparent); pointer-events: none; transform: translateX(-50%); }
          .dsh-session-kit-preview-list > .dsh-session-kit-preview-message:last-child .dsh-session-kit-preview-timeline::before,
          .dsh-session-kit-preview-list > .dsh-session-kit-preview-message-wrap:last-child .dsh-session-kit-preview-timeline::before { display: none; }
          .dsh-session-kit-preview-seq { position: relative; z-index: 1; width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1; font-variant-numeric: tabular-nums; }
          .dsh-session-kit-preview-message-card { --dsh-session-kit-preview-action-gap: 12px; min-width: 0; display: flex; flex-direction: column; gap: 0; padding: 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-base); overflow: hidden; }
          .dsh-session-kit-preview-message-user .dsh-session-kit-preview-message-card { background: rgba(77, 107, 254, .08); }
          .dsh-session-kit-preview-message-assistant .dsh-session-kit-preview-message-card { background: var(--dsw-alias-interactive-bg-hover); }
          .dsh-session-kit-preview-message-head { flex: none; display: flex; align-items: center; gap: 8px; min-width: 0; padding: 10px 12px 0; margin-bottom: 0; }
          .dsh-session-kit-preview-role { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; font-weight: 650; }
          .dsh-session-kit-preview-message-time { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; white-space: nowrap; }
          .dsh-session-kit-preview-copy { margin-left: auto; flex: none; height: 26px; padding: 0 8px; font-size: 12px; }
          .dsh-session-kit-preview-text { min-width: 0; color: var(--dsw-alias-label-primary); position: relative; display: flow-root; margin: 0 12px var(--dsh-session-kit-preview-action-gap); padding-top: 0; }
          .dsh-session-kit-preview-text > :first-child,
          .dsh-session-kit-preview-text > *:first-child > :first-child { margin-top: 0 !important; }
          .dsh-session-kit-preview-text > :last-child,
          .dsh-session-kit-preview-text > *:last-child > :last-child { margin-bottom: 0 !important; }
          .dsh-session-kit-preview-text[data-collapsed] { max-height: var(--dsh-session-kit-preview-content-max-height, 50px); overflow: hidden; }
          .dsh-session-kit-preview-plain { margin: 0; white-space: pre-wrap; word-break: break-word; font: inherit; line-height: inherit; color: inherit; background: transparent; }
          .dsh-session-kit-preview-message-foot { flex: none; display: flex; justify-content: flex-end; padding: 0 12px 10px; }
          .dsh-session-kit-preview-expand { height: 28px; }
          .dsh-session-kit-topic-nav-host { position: fixed; z-index: 8; width: 340px; pointer-events: none; box-sizing: border-box; display: flex; align-items: center; justify-content: flex-end; transform: translateY(-50%); }
          .dsh-session-kit-topic-nav { pointer-events: none; position: relative; width: 100%; display: flex; align-items: center; justify-content: flex-end; color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 18px; }
          .dsh-session-kit-topic-title { position: absolute; width: 1px; height: 1px; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; overflow: hidden; }
          .dsh-session-kit-topic-marker-list { pointer-events: auto; display: flex; flex-direction: column; align-items: flex-end; justify-content: center; gap: 3px; max-height: none; margin: 0; padding: 9px 13px 9px 6px; list-style: none; overflow: visible; }
          .dsh-session-kit-topic-marker-item { height: 30px; margin: 0; padding: 0; display: flex; align-items: center; justify-content: flex-end; }
          .dsh-session-kit-topic-marker { width: 9px; height: 2px; border-radius: 999px; background: var(--dsw-alias-label-caption); opacity: .48; transition: width 140ms ease, height 140ms ease, background-color 140ms ease, opacity 140ms ease; }
          .dsh-session-kit-topic-marker[data-active] { width: 9px; height: 2px; background: var(--dsw-alias-label-primary); opacity: .92; }
          .dsh-session-kit-topic-panel { position: absolute; top: 50%; right: -1px; width: 322px; max-height: 347px; box-sizing: border-box; display: flex; flex-direction: column; opacity: 0; pointer-events: none; transform: translateY(-50%) translateX(8px) scale(.98); transform-origin: right center; transition: opacity 120ms ease, transform 140ms ease; border: 1px solid color-mix(in srgb, var(--dsw-alias-border-l2) 68%, transparent); border-radius: 14px; background: color-mix(in srgb, var(--dsw-alias-bg-base) 92%, transparent); box-shadow: 0 12px 32px rgba(0,0,0,.12); backdrop-filter: blur(10px); overflow: hidden; }
          .dsh-session-kit-topic-nav-host[data-open] .dsh-session-kit-topic-panel { opacity: 1; pointer-events: auto; transform: translateY(-50%) translateX(0) scale(1); }
          .dsh-session-kit-topic-panel-controls { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-border-l2) 62%, transparent); background: color-mix(in srgb, var(--dsw-alias-bg-base) 86%, transparent); }
          .dsh-session-kit-topic-panel-controls-bottom { border-top: 1px solid color-mix(in srgb, var(--dsw-alias-border-l2) 62%, transparent); border-bottom: 0; }
          .dsh-session-kit-topic-panel-control { box-sizing: border-box; width: 100%; height: 32px; display: grid; place-items: center; border: 0; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; }
          .dsh-session-kit-topic-panel-controls .dsh-session-kit-topic-panel-control:only-child { grid-column: 1 / -1; }
          .dsh-session-kit-topic-panel-control + .dsh-session-kit-topic-panel-control { border-left: 1px solid color-mix(in srgb, var(--dsw-alias-border-l2) 52%, transparent); }
          .dsh-session-kit-topic-panel-control:hover:not(:disabled), .dsh-session-kit-topic-panel-control:focus-visible { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
          .dsh-session-kit-topic-panel-control:disabled { cursor: default; opacity: .45; }
          .dsh-session-kit-topic-panel-control[data-loading] { opacity: .78; }
          .dsh-session-kit-topic-panel-control[data-loading] svg { animation: dsh-session-kit-spin 900ms linear infinite; }
          .dsh-session-kit-topic-panel-list { box-sizing: border-box; width: 100%; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 3px; margin: 0; padding: 6px 6px 6px 6px; list-style: none; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; scrollbar-width: none; }
          .dsh-session-kit-topic-panel-list::-webkit-scrollbar { width: 0; height: 0; background: transparent; }
          .dsh-session-kit-topic-panel-list::-webkit-scrollbar-button,
          .dsh-session-kit-topic-panel-list::-webkit-scrollbar-button:single-button,
          .dsh-session-kit-topic-panel-list::-webkit-scrollbar-button:vertical:start:decrement,
          .dsh-session-kit-topic-panel-list::-webkit-scrollbar-button:vertical:end:increment,
          .dsh-session-kit-topic-panel-list::-webkit-scrollbar-button:horizontal:start:decrement,
          .dsh-session-kit-topic-panel-list::-webkit-scrollbar-button:horizontal:end:increment { -webkit-appearance: none !important; appearance: none !important; width: 0 !important; height: 0 !important; min-width: 0 !important; min-height: 0 !important; display: none !important; background: transparent !important; border: 0 !important; }
          .dsh-session-kit-topic-panel-list::-webkit-scrollbar-thumb { background: transparent; border-radius: 999px; }
          .dsh-session-kit-topic-panel-list::-webkit-scrollbar-track,
          .dsh-session-kit-topic-panel-list::-webkit-scrollbar-track-piece { background: transparent; border: 0; }
          .dsh-session-kit-topic-panel-scrollbar { position: absolute; right: 2px; width: 2px; border-radius: 999px; background: color-mix(in srgb, var(--dsw-alias-label-caption) 55%, transparent); pointer-events: none; opacity: .55; transition: opacity 120ms ease; }
          .dsh-session-kit-topic-panel:hover .dsh-session-kit-topic-panel-scrollbar { opacity: .72; }
          @-moz-document url-prefix() { .dsh-session-kit-topic-panel-list { scrollbar-width: none; } }
          .dsh-session-kit-topic-panel-item { min-width: 0; margin: 0; padding: 0; }
          .dsh-session-kit-topic-panel-button { box-sizing: border-box; width: 100%; height: 30px; display: flex; flex-direction: row; align-items: center; justify-content: flex-end; gap: 10px; border: 0; border-radius: 9px; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; text-align: right; font: inherit; font-size: 13px; line-height: 30px; padding: 0 6px 0 6px; overflow: hidden; white-space: nowrap; transition: color 120ms ease, background-color 120ms ease; }
          .dsh-session-kit-topic-panel-marker { width: 9px; height: 2px; border-radius: 999px; background: var(--dsw-alias-label-caption); opacity: .55; flex: 0 0 auto; margin-right: 2px; }
          .dsh-session-kit-topic-panel-marker[data-active] { width: 9px; height: 2px; background: var(--dsw-alias-label-primary); opacity: .95; }
          .dsh-session-kit-topic-panel-text { min-width: 0; flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .dsh-session-kit-topic-panel-button:hover, .dsh-session-kit-topic-panel-button:focus-visible { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
          .dsh-session-kit-topic-panel-button:hover .dsh-session-kit-topic-panel-marker:not([data-active]), .dsh-session-kit-topic-panel-button:focus-visible .dsh-session-kit-topic-panel-marker:not([data-active]) { background: var(--dsw-alias-label-primary); opacity: .95; }
          .dsh-session-kit-topic-panel-button:focus-visible { outline: 2px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 45%, transparent); outline-offset: 1px; }
          .dsh-session-kit-topic-panel-button[data-active] { color: var(--dsw-alias-label-primary); font-weight: 600; }
          .dsh-session-kit-topic-panel-button[data-active]:not(:hover):not(:focus-visible) { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 9%, transparent); }
          .dsh-session-kit-heading-nav-host { justify-content: flex-start; }
          .dsh-session-kit-heading-nav { justify-content: flex-start; }
          .dsh-session-kit-heading-marker-list { align-items: flex-start; padding: 9px 6px 9px 13px; }
          .dsh-session-kit-heading-marker-item { justify-content: flex-start; }
          .dsh-session-kit-heading-panel { left: 0; right: auto; transform: translateY(-50%) translateX(-8px) scale(.98); transform-origin: left center; background: var(--dsw-alias-bg-base); backdrop-filter: none; -webkit-backdrop-filter: none; }
          .dsh-session-kit-heading-panel-button { justify-content: flex-start; text-align: left; }
          .dsh-session-kit-heading-panel-scrollbar { left: 2px; right: auto; }
          @keyframes dsh-session-kit-spin { to { transform: rotate(360deg); } }
          @media (max-width: 760px) { .dsh-session-kit-topic-nav-host { display: none; } }
          @media (max-width: 640px) {
            .dsh-session-kit-archive-head { flex-direction: column; }
            .dsh-session-kit-preview-title-row { align-items: flex-start; flex-direction: column; }
            .dsh-session-kit-preview-actions { width: 100%; justify-content: flex-start; }
            .dsh-session-kit-archive-filter-row { grid-template-columns: 1fr; }
            .dsh-session-kit-archive-toolbar { width: 100%; justify-content: space-between; }
            .dsh-session-kit-archive-row, .dsh-session-kit-stats-row { grid-template-columns: 1fr; }
            .dsh-session-kit-preview-attrs { grid-template-columns: 1fr; }
            .dsh-session-kit-preview-message { grid-template-columns: 34px minmax(0, 1fr); }
            .dsh-session-kit-archive-actions, .dsh-session-kit-stats-values { justify-content: flex-start; }
            .dsh-session-kit-preview, .dsh-session-kit-stats { max-height: min(76vh, 720px); }
          }
        `;
        document.head.appendChild(style);
        return () => style.remove();
      }, `${NS}: styles`);

      ctx.uiConversation.events.register(turnsDelDefinition);
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${NS}: dictionaries`);
      ctx.effect(() => ctx.locale.register(TURNS_DEL_NS, { zh: turnsDelZh, en: turnsDelEn }), `${TURNS_DEL_NS}: dictionaries`);

      const sessionManagerFace = () => ({
        t: ctx.locale?.bind?.(NS) ?? ((key) => zh[key] ?? key),
        exporter,
        /* 内核 0.1.7 的 sessions 服务无 open()，打开会话由 uiWorkspace.openSession 承担。 */
        openSession: (id) => ctx.get('uiWorkspace')?.openSession?.(id),
        refreshWorkspaces: (value) => {
          if (Array.isArray(value?.archivedSessionIds) && typeof ctx.workspaces?.list?.replaceArchived === 'function') ctx.workspaces.list.replaceArchived(value.archivedSessionIds);
        },
        refreshSessions: () => ctx.sessions.refresh(),
        archiveCurrentSession: (id) => ctx.workspaces.archiveSession(id),
        forkCurrentSession: (id) => ctx.sessions.fork({ sessionId: id, increaseTitle: true }),
        renameCurrentSession: async (id, title) => {
          const local = ctx.sessions.binding(id)?.session;
          const result = local === undefined
            ? await ctx.remote.session.rename({ sessionId: id, title })
            : await local.rename(title);
          if (!result.ok) throw new Error(result.error?.message || result.error?.code || 'rename-failed');
          await ctx.sessions.refresh().catch(() => undefined);
          return result.value;
        },
        getSessionTitle: (id) => ctx.sessions.list.getSnapshot().byId[id]?.displayTitle ?? '',
        /* 任务搜索按会话名称/会话ID匹配时用：整份 会话ID → 标题 映射（含归档）。 */
        getSessionTitleMap: () => ctx.sessions.list.getSnapshot().byId ?? {},
        getCurrentUserMessage: (id) => currentUserMessageText(ctx.sessions.binding(id)?.session?.getSnapshot?.()),
        getModelSelection: (id) => getCurrentModelSelection(ctx, id),
        getModelDirectory: (id) => {
          try { return ctx.modelDirectories?.directoryFor?.(String(id || '')); } catch { return undefined; }
        },
        updateSidebarEntries
      });

      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: NS,
        order: 90,
        locale: NS,
        inject: sessionManagerFace
      }, SessionManagerButton));

      ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
        name: 'conversation.chat.assistant-actions',
        id: `${TURNS_DEL_NS}-regenerate`,
        order: 0,
        locale: TURNS_DEL_NS,
        inject: (sessionId) => ({
          regenerateTurns: (assistantMessageId, operationId) => postRegenerateTurns(sessionId, assistantMessageId, operationId)
        })
      }, RegenerateAction));

      ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
        name: 'conversation.chat.assistant-actions',
        id: `${TURNS_DEL_NS}-distill`,
        order: 10,
        locale: TURNS_DEL_NS,
        inject: (sessionId) => ({
          distillTurn: (identifier) => {
            const modelSelection = getCurrentModelSelection(ctx, sessionId);
            const payload = Number.isSafeInteger(identifier) ? { turn: identifier } : { messageId: identifier };
            return memoryPostAction(sessionId, { action: 'distill-turn', ...payload, ...(modelSelection ? { modelSelection } : {}) });
          }
        })
      }, DistillTurnAction));

      ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
        name: 'conversation.chat.assistant-actions',
        id: `${TURNS_DEL_NS}-turn-memory`,
        order: 80,
        locale: TURNS_DEL_NS,
        inject: (sessionId) => ({
          getTurnMemoryHits: ({ messageId, turn }) => memoryPostAction(sessionId, { action: 'turn-memory-hits', ...(Number.isSafeInteger(turn) ? { turn } : {}), ...(messageId ? { messageId } : {}) })
        })
      }, TurnMemoryAction));

      ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
        name: 'conversation.chat.assistant-actions',
        id: TURNS_DEL_NS,
        order: 90,
        locale: TURNS_DEL_NS,
        inject: (sessionId) => ({ sessionId, delTurns: (assistantMessageId) => postTurnsDel(sessionId, assistantMessageId) })
      }, TurnsDelAction));

      ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
        name: 'conversation.chat.turnTail',
        id: `${TURNS_DEL_NS}-marker`,
        inject: (sessionId) => ({ sessionId })
      }, TurnsDelMarker));

      ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
        name: 'conversation.chat.turnTail',
        id: `${TURNS_DEL_NS}-failed-actions`,
        locale: TURNS_DEL_NS,
        select: selectFailedTurnActions,
        inject: (sessionId) => ({
          delTurn: (turn) => postTurnsDelTurn(sessionId, turn),
          regenerateTurn: (turn, operationId) => postRegenerateTurn(sessionId, turn, operationId),
          distillTurn: (turn) => {
            const modelSelection = getCurrentModelSelection(ctx, sessionId);
            return memoryPostAction(sessionId, { action: 'distill-turn', turn, ...(modelSelection ? { modelSelection } : {}) });
          }
        })
      }, FailedTurnActions));

      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: `${TURNS_DEL_NS}-user-actions`,
        order: 92,
        locale: TURNS_DEL_NS,
        inject: (sessionId) => ({
          delTurn: (turn) => postTurnsDelTurn(sessionId, turn),
          regenerateTurn: (turn, operationId, promptSeq) => postRegenerateTurn(sessionId, turn, operationId, promptSeq),
          editRegenerateTurn: (turn, operationId, text, promptSeq) => postEditRegenerateTurn(sessionId, turn, operationId, text, promptSeq),
          distillTurn: (turn) => {
            const modelSelection = getCurrentModelSelection(ctx, sessionId);
            return memoryPostAction(sessionId, { action: 'distill-turn', turn, ...(modelSelection ? { modelSelection } : {}) });
          },
          getTurnMemoryHits: ({ turn }) => memoryPostAction(sessionId, { action: 'turn-memory-hits', ...(Number.isSafeInteger(turn) ? { turn } : {}) }),
          hooks: { conversation: ctx.uiConversation.binding(sessionId).snapshot }
        })
      }, UserTurnActionsLayer));

      /* 会话级恢复守卫：会话头部工具槽随会话打开而挂载，可靠地触发一次
         “拉取删除范围并隐藏对应轮次”，不依赖聊天行或挂起轮次的渲染细节。 */
      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: `${TURNS_DEL_NS}-restore-guard`,
        order: 95,
        inject: (sessionId) => ({ sessionId })
      }, TurnsDelRestoreGuard));

      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: `${NS}-heading-nav`,
        order: 89,
        locale: NS,
        inject: (sessionId) => ({
          sessionId,
          t: ctx.locale?.bind?.(NS) ?? ((key) => zh[key] ?? key)
        })
      }, HeadingQuickNavGate));

      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: `${NS}-tasks`,
        order: 2,
        locale: NS,
        /* useSessions 由标准 kit 自动注入；此处只需补 updateSidebarEntries。 */
        inject: () => ({ updateSidebarEntries })
      }, SidebarTaskLauncher));

      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: `${NS}-archive`,
        order: 3,
        locale: NS,
        inject: sessionManagerFace
      }, SidebarArchiveLauncher));

      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: `${NS}-memory`,
        order: 1,
        locale: NS,
        inject: () => ({
          getSessionTitle: (id) => ctx.sessions.list.getSnapshot().byId[id]?.displayTitle ?? '',
          getCurrentUserMessage: (id) => currentUserMessageText(ctx.sessions.binding(id)?.session?.getSnapshot?.()),
          getModelSelection: (id) => getCurrentModelSelection(ctx, id),
          getModelDirectory: (id) => {
            try { return ctx.modelDirectories?.directoryFor?.(String(id || '')); } catch { return undefined; }
          },
          pickDirectory: () => ctx.get('uiWorkspace')?.pickDirectory?.(),
          updateSidebarEntries
        })
      }, SidebarMemoryButton));

      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: `${NS}-topic-nav`,
        order: 91,
        locale: NS,
        inject: (sessionId) => ({
          t: ctx.locale?.bind?.(NS) ?? ((key) => zh[key] ?? key),
          loadOlder: () => ctx.sessions.scope(sessionId)?.get('conversation')?.loadOlder()
        })
      }, TopicQuickNavGate));

      /* 「记忆」tab：注册进 conversation.view，order 20 使其紧随「轨迹」(order 10) 之后。
         用独立 id，避免落入官方已有 cell 而遮蔽它们。 */
      ctx.effect(() => ctx.locale.register(SESSION_MEMORY_NS, { zh: sessionMemoryZh, en: sessionMemoryEn }), `${SESSION_MEMORY_NS}: dictionaries`);
      /* 视图文案优先取专用命名空间，缺失时回退主命名空间（memoryNoDirectory、turnMemory.* 在主空间）。 */
      const sessionMemoryText = (key) => {
        if (key.startsWith('view.')) return (ctx.locale?.bind?.(SESSION_MEMORY_NS) ?? ((k) => sessionMemoryZh[k] ?? k))(key);
        return (ctx.locale?.bind?.(NS) ?? ((k) => zh[k] ?? k))(key);
      };
      /* 「记忆」tab：注册进 conversation.view，order 20 使其紧随「轨迹」(order 10) 之后。
         用独立 id，避免落入官方已有 cell 而遮蔽它们。
         显隐由设置里的 memoryTabVisible 控制：槽位注册无法「隐藏但仍保留」，
         因此按其值动态注册/注销——关闭时该 tab 从会话顶部导航彻底消失，
         若当时正停在该视图，渲染器回退到其它视图（chat）。 */
      ctx.slots.inject('conversation.view', () => {
        let dispose = null;
        const sync = () => {
          const visible = sidebarEntriesValue.memoryTabVisible !== false;
          if (visible && dispose === null) {
            dispose = ctx.slots.register({
              name: 'conversation.view',
              id: `${NS}-memory-view`,
              order: 20,
              locale: SESSION_MEMORY_NS,
              label: () => sessionMemoryText('view.label'),
              inject: (sessionId) => ({
                sessionId,
                t: sessionMemoryText,
                getSessionMemoryView: () => memoryPostAction(sessionId, { action: 'session-memory-view' })
              })
            }, SessionMemoryView);
          } else if (!visible && dispose !== null) {
            dispose();
            dispose = null;
          }
        };
        sync();
        sidebarEntriesSubscribers.add(sync);
        /* 槽位塌陷或插件卸载时注销订阅与已注册条目。 */
        return () => {
          sidebarEntriesSubscribers.delete(sync);
          if (dispose !== null) {
            dispose();
            dispose = null;
          }
        };
      });

      /* DSH 设置弹窗的 session-kit 分节（settings.section 由 settings-general 声明）。 */
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: `${NS}-settings`,
        order: 50,
        locale: NS,
        label: () => (ctx.locale?.bind?.(NS) ?? ((key) => zh[key] ?? key))('settingsNavLabel'),
        inject: () => ({
          t: ctx.locale?.bind?.(NS) ?? ((key) => zh[key] ?? key),
          updateSidebarEntries,
          /* 设置弹窗没有会话上下文，模型目录由宿主侧定位：
             取「当前保留在主视图」的会话 id（内核 0.1.7 的 list 快照无 current 字段，
             用 retainedBy.mainView 判定，与插件内其他处同款），拿不到时退化为全局目录。 */
          resolveModelDirectory: () => {
            try {
              let id = '';
              try {
                const snapshot = ctx.sessions?.list?.getSnapshot?.();
                id = String(Object.values(snapshot?.byId ?? {}).find((session) => (session?.retainedBy?.mainView ?? 0) > 0)?.id ?? '');
              } catch { id = ''; }
              return ctx.modelDirectories?.directoryFor?.(id) ?? ctx.modelDirectories?.directoryFor?.('') ?? undefined;
            } catch { return undefined; }
          },
          /* 目录选择器：与记忆弹窗同源（官方 uiWorkspace seam），设置页自身拿不到 ctx。 */
          pickDirectory: () => ctx.get('uiWorkspace')?.pickDirectory?.()
        })
      }, SessionKitSettingsSection));
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});



