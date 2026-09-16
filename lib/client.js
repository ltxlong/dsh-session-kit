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
    const SIDEBAR_ENTRIES_ROUTE = '/dsh-session-kit/sidebar-entries';
    /* 进行中活动"过期刷新"：条目已耗时超过 ACTIVITY_STUCK_REFRESH_MS 时拉一次 progress
       视图（与服务端 ACTIVITY_STUCK_TIMEOUT_MS 同为 6 分钟）。拉取动作本身会触发服务端
       activitySnapshot 前置的 reapStuckActivities，而服务端处理时刻必然不早于前端判定
       时刻，故该条目在服务端必已过兜底线、随本次响应一起消失——一次请求解决，无需
       复查循环与定时器。条目未超时零请求。 */
    const ACTIVITY_STUCK_REFRESH_MS = 6 * 60 * 1000;
    const DEFAULT_SIDEBAR_ENTRIES = Object.freeze({ memoryVisible: true, archiveVisible: true });
    let sidebarEntriesValue = DEFAULT_SIDEBAR_ENTRIES;
    const sidebarEntriesSubscribers = new Set();
    let sidebarEntriesNotifyQueued = false;
    function setSidebarEntriesValue(value) {
      sidebarEntriesValue = Object.freeze({ memoryVisible: value?.memoryVisible !== false, archiveVisible: value?.archiveVisible !== false });
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
    const MEMORY_MIN_TEXT_LENGTH = 6;
    const ARCHIVE_PREVIEW_LIMIT = 30;
    const ARCHIVE_PREVIEW_TOC_PAGE_SIZE = 10;
    const ARCHIVE_PREVIEW_MESSAGE_PAGE_SIZE = 30;
    const ARCHIVE_PREVIEW_SEARCH_DEBOUNCE_MS = 350;
    const ARCHIVE_LIST_PAGE_SIZE = 50;
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
    const TURNS_DEL_TURN_PATH = '/dsh-turns-del/turn';
    const REGENERATE_PATH = '/dsh-turns-del-regenerate';
    const REGENERATE_TURN_PATH = '/dsh-turns-del-regenerate/turn';
    const EDIT_REGENERATE_TURN_PATH = '/dsh-turns-del-edit-regenerate/turn';
    const TURNS_DEL_PROVIDER = 'dsh-turns-del';
    const NS = 'dsh-session-kit';
    const TURNS_DEL_NS = 'dsh-turns-del';
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
      memoryDesc: '管理本地记忆项目、标签和记忆条目。临时记忆默认不持久化，点击存储后才会写入本地 SQLite。',
      memoryStoreInfo: '本地库：{path} · 检索：{mode}',
      memorySearchPlaceholder: '搜索记忆、标签或项目',
      memoryAllDirectories: '全部项目',
      memoryNoDirectory: '无项目',
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
      memoryActivityStatus_running: '进行中',
      memoryActivityStatus_success: '成功',
      memoryActivityStatus_duplicate: '重复',
      memoryActivityStatus_skipped: '已跳过',
      memoryActivityStatus_failed: '失败',
      memorySettings: '设置',
      memorySettingsDesc: '配置蒸馏使用的模型和思考度。默认跟随当前会话输入框；设置自定义模型失败时会使用默认模型重试一次。',
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
      confirm: '确定要删除当前会话吗？删除后会话记录将被移除！',
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
      archiveSearchPlaceholder: '搜索会话名称',
      archiveSearchClear: '清空搜索',
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
      memoryDesc: 'Manage local memory projects, tags, and memory items. Temporary memories are not persisted until you click Store.',
      memoryStoreInfo: 'Local DB: {path} · Retrieval: {mode}',
      memorySearchPlaceholder: 'Search memories, tags, or project names',
      memoryAllDirectories: 'All project names',
      memoryNoDirectory: 'No project name',
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
      memoryActivityStatus_running: 'In progress',
      memoryActivityStatus_success: 'Success',
      memoryActivityStatus_duplicate: 'Duplicate',
      memoryActivityStatus_skipped: 'Skipped',
      memoryActivityStatus_failed: 'Failed',
      memorySettings: 'Settings',
      memorySettingsDesc: 'Choose the model and reasoning effort for distillation. By default it follows the current session input; if the custom model fails, the default model is retried once.',
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
      confirm: 'Delete this session? Its session record will be removed!',
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
      archiveSearchPlaceholder: 'Search session name',
      archiveSearchClear: 'Clear search',
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
      'turnMemory.countFiltered': '已显示 {shown} / {total} 条'
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
      'turnMemory.countFiltered': 'Showing {shown} / {total}'
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
      return react.createElement(primitives.IconFolderOpenOutline16, { size: 16 });
    }
    function DeleteIcon() {
      return react.createElement(primitives.IconTrashOutline16, { size: 16 });
    }
    function ExportIcon() {
      return react.createElement(primitives.IconDownloadOutline16, { size: 16 });
    }
    function ArchiveIcon({ size = 16 } = {}) {
      return react.createElement(primitives.IconArchiveOutline20, { size });
    }
    function StatsIcon() {
      return react.createElement(primitives.IconDataOutline16, { size: 16 });
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
      return react.createElement(primitives.IconEditOutline16, { size: 16 });
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
    function BranchIcon() {
      return react.createElement(primitives.IconBranchOutline16, { size: 16 });
    }
    function RenameIcon() {
      return react.createElement(primitives.IconEditOutline16, { size: 16 });
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

    /* 日志摘要：列表按两行省略，悬浮显示完整内容。
       原生 title 无法承载长文本与换行，故用自定义浮层；浮层位置按视口钳制，避免贴边溢出。
       收起带 140ms 延迟：指针从摘要移向浮层会经过间隙，若无延迟会立刻隐藏而无法阅读长文。 */
    function MemoryActivitySummary({ text, className }) {
      const [hover, setHover] = react.useState(false);
      const [truncated, setTruncated] = react.useState(false);
      const [position, setPosition] = react.useState(null);
      const anchorRef = react.useRef(null);
      const hideTimer = react.useRef(0);
      react.useLayoutEffect(() => {
        const anchor = anchorRef.current;
        if (!(anchor instanceof HTMLElement)) return undefined;
        const measure = () => {
          const next = anchor.scrollHeight > anchor.clientHeight + 1 || anchor.scrollWidth > anchor.clientWidth + 1;
          setTruncated(next);
          if (!next) {
            window.clearTimeout(hideTimer.current);
            setHover(false);
            setPosition(null);
          }
        };
        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
      }, [text]);
      const show = () => {
        if (!truncated) return;
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
          'aria-describedby': truncated ? 'dsh-session-kit-memory-activity-summary-tooltip' : undefined,
          style: truncated ? undefined : { cursor: 'default' }
        }, text),
        hover && truncated && position !== null
          ? reactDom.createPortal(react.createElement('div', {
            className: 'dsh-session-kit-memory-activity-summary-popup',
            id: 'dsh-session-kit-memory-activity-summary-tooltip',
            role: 'tooltip',
            onPointerEnter: show,
            onPointerLeave: scheduleHide,
            style: { left: `${position.left}px`, top: `${position.top}px`, width: `${position.width}px`, maxHeight: `${position.maxHeight}px` }
          }, text), document.body)
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
      const isMemoryKind = kind === 'memory_add' || kind === 'memory_update' || kind === 'memory_delete' || kind === 'directory_create' || kind === 'directory_update' || kind === 'directory_delete' || kind === 'tag_create' || kind === 'tag_update' || kind === 'tag_delete';
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

    function memoryFormatTime(value) {
      const time = Number(value);
      if (!Number.isFinite(time) || time <= 0) return '';
      const date = new Date(time);
      return Number.isFinite(date.getTime()) ? date.toLocaleString() : '';
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
      '接口摘要'
    ].map((tag, index) => [tag, index]));

    function memoryTagStatus(tag) {
      return tag?.status === 'inactive' ? 'inactive' : 'active';
    }

    function memoryOrderedTags(value) {
      return [...memorySafeArray(value)].sort((left, right) => {
        const leftPreset = left?.preset === true;
        const rightPreset = right?.preset === true;
        if (leftPreset !== rightPreset) return leftPreset ? -1 : 1;
        if (leftPreset && rightPreset) return (MEMORY_PRESET_TAG_ORDER.get(left?.name) ?? 999) - (MEMORY_PRESET_TAG_ORDER.get(right?.name) ?? 999);
        const leftStatus = memoryTagStatus(left);
        const rightStatus = memoryTagStatus(right);
        if (leftStatus !== rightStatus) return leftStatus === 'active' ? -1 : 1;
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

    function memoryMatches(memory, search) {
      const needle = String(search || '').trim().toLocaleLowerCase();
      if (!needle) return true;
      return [
        memory?.text,
        memory?.directoryName,
        memory?.sourceSessionId,
        memory?.sourceSessionTitle,
        ...memoryStringArray(memory?.tags)
      ].filter(Boolean).join('\n').toLocaleLowerCase().includes(needle);
    }

    function memoryEditorNeedsJson(text) {
      const raw = String(text ?? '').trim();
      return /^[{[]/.test(raw) || /代码|插件|仓库|文件|路径|函数|方法|组件|class|css|接口|API|action|route|endpoint|slot|hook|事件|参数|返回|实现|修改|修复|优化|新增|调整|重构|排查|位置：|对象：|内容：|踩坑：|[A-Za-z]:\\|\.[cm]?[jt]sx?\b/i.test(raw);
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
          react.createElement('span', { className: `dsh-session-kit-memory-select-chevron${open ? ' dsh-session-kit-memory-select-chevron-open' : ''}`, 'aria-hidden': 'true' }, react.createElement(primitives.IconChevronDownOutline14, { size: 14 }))
        ),
        open && react.createElement('div', { className: 'dsh-session-kit-memory-select-panel', role: 'menu' },
          searchable && react.createElement('div', { className: 'dsh-session-kit-memory-select-search' },
            react.createElement('span', { className: 'dsh-session-kit-memory-select-search-icon', 'aria-hidden': 'true' }, react.createElement(primitives.IconSearchOutline16, { size: 14 })),
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
              option.id === selected?.id && react.createElement(primitives.IconCheckOutline16, { size: 16 })
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

    function ModalTitleWithEntryToggle({ title, visible, onToggleVisible, label }) {
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
        )
      );
    }

    function MemoryManagementDialog({ open, t, sessionId, onClose, getSessionTitle, getCurrentUserMessage, getModelSelection, getModelDirectory, updateSidebarEntries }) {
      const sidebarEntries = useSidebarEntries();
      const loadedOnceRef = react.useRef(false);
      const [snapshot, setSnapshot] = react.useState(null);
      const [loading, setLoading] = react.useState(false);
      const [busy, setBusy] = react.useState(false);
      const [busyAction, setBusyAction] = react.useState(null);
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
      const [memoryPages, setMemoryPages] = react.useState({ projects: 1, temporary: 1, memories: 1 });
      const [directoryFilter, setDirectoryFilter] = react.useState('all');
      const [newMemoryOpen, setNewMemoryOpen] = react.useState(false);
      const [newMemoryText, setNewMemoryText] = react.useState('');
      const [newMemoryNotice, setNewMemoryNotice] = react.useState(null);
      const [newMemoryDirectoryId, setNewMemoryDirectoryId] = react.useState('');
      const [newMemoryStatus, setNewMemoryStatus] = react.useState('active');
      const [newMemoryTagNames, setNewMemoryTagNames] = react.useState([]);
      const [newDirectoryOpen, setNewDirectoryOpen] = react.useState(false);
      const [newDirectoryName, setNewDirectoryName] = react.useState('');
      const [newDirectoryRemark, setNewDirectoryRemark] = react.useState('');
      const [newTagOpen, setNewTagOpen] = react.useState(false);
      const [newTagName, setNewTagName] = react.useState('');
      const [projectEditor, setProjectEditor] = react.useState(null);
      const [editor, setEditor] = react.useState(null);
      /* 编辑弹窗内的“美化格式”结果提示：只在本表单显示，不复用全局 notice/error 层。 */
      const [editorNotice, setEditorNotice] = react.useState(null);
      const [deleteTarget, setDeleteTarget] = react.useState(null);
      const [copiedDirectoryId, setCopiedDirectoryId] = react.useState(null);
      const directoryCopyTimer = react.useRef(0);
      /* 日志“删除记忆”条目旁的复制按钮：记录刚复制的日志 id 以显示勾选反馈。 */
      const [copiedLogId, setCopiedLogId] = react.useState(null);
      const logCopyTimer = react.useRef(0);
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
      const modelOptions = [
        { value: '', label: t('memoryFollowSessionModel') },
        ...memorySafeArray(modelDirectoryState.groups).flatMap((group) => memorySafeArray(group?.models).map((model) => ({
          value: JSON.stringify({ provider: group.id, model: model.id }),
          label: `${group.name || group.id} / ${model.name || model.id}`
        })))
      ];
      const draftModelValue = distillModelDraft?.provider && distillModelDraft?.model ? JSON.stringify({ provider: distillModelDraft.provider, model: distillModelDraft.model }) : '';
      const selectedModelGroup = memorySafeArray(modelDirectoryState.groups).find((group) => group.id === distillModelDraft?.provider);
      const selectedModel = memorySafeArray(selectedModelGroup?.models).find((model) => model.id === distillModelDraft?.model);
      const reasoningOptions = selectedModel?.reasoning ? [
        ...(selectedModel.reasoning.defaultEffort === undefined ? [{ value: '', label: t('memoryProviderDefault') }] : []),
        ...memorySafeArray(selectedModel.reasoning.efforts).map((effort) => ({ value: effort.id, label: effort.name || effort.id }))
      ] : [];
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
        setLoading(!loadedOnceRef.current);
        setError(null);
        try {
          const value = await memoryFetchSnapshot(sessionId);
          setSnapshot(value);
          loadedOnceRef.current = true;
        } catch (reason) {
          setError(`${t('memoryFailed')}: ${memoryErrorMessage(t, reason)}`);
        } finally {
          setLoading(false);
        }
      }, [open, sessionId, t]);
      const tokenCleanupStartedRef = react.useRef(false);
      react.useEffect(() => {
        if (!open) {
          tokenCleanupStartedRef.current = false;
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
      /* 切换 tab（无论目标页）都拉一次 progress 视图：借服务端 activitySnapshot('progress')
         的 reapStuckActivities 触发超时兜底清理，让卡住的活动在任意操作后都能被扫到。 */
      const firstMemoryTabRef = react.useRef(memoryTab);
      react.useEffect(() => {
        if (!open) {
          firstMemoryTabRef.current = memoryTab;
          return undefined;
        }
        if (firstMemoryTabRef.current === memoryTab) return undefined;
        firstMemoryTabRef.current = memoryTab;
        void loadActivity('progress');
      }, [open, memoryTab, loadActivity]);
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
      react.useEffect(() => {
        setMemoryPages({ projects: 1, temporary: 1, memories: 1 });
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
      const runAction = async (payload, successText) => {
        if (busy) return null;
        const isDistillNow = payload?.action === 'distill-now';
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
        setBusy(true);
        setBusyAction(payload?.action || 'action');
        setError(null);
        setNotice(null);
        try {
          const value = await memoryPostAction(sessionId, payload);
          setSnapshot(value);
          void loadActivity('progress');
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
          setBusy(false);
          setBusyAction(null);
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
      const visibleTemporaryMemories = memories.filter((memory) => memory.persisted !== true && memoryDirectoryMatchesFilter(memory) && memoryMatches(memory, search));
      const visiblePersistedMemories = memories.filter((memory) => memory.persisted === true && memoryDirectoryMatchesFilter(memory) && memoryMatches(memory, search));
      const visibleTags = tags.filter((tag) => !normalizedMemorySearch || String(tag?.name || '').toLocaleLowerCase().includes(normalizedMemorySearch));
      const projectPage = memoryPagination(visibleDirectories, memoryPages.projects);
      const temporaryPage = memoryPagination(visibleTemporaryMemories, memoryPages.temporary);
      const persistedPage = memoryPagination(visiblePersistedMemories, memoryPages.memories);
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
        const value = await runAction({ action: 'create-memory', text: newMemoryText, directoryId: newMemoryDirectoryId, status: newMemoryStatus, tagNames: newMemoryTagNames }, t('memorySaved'));
        if (value !== null) {
          setNewMemoryText('');
          setNewMemoryNotice(null);
          setNewMemoryDirectoryId('');
          setNewMemoryStatus('active');
          setNewMemoryTagNames([]);
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
        }, t('memorySaved'));
        if (value === null) return;
        if (currentSessionId && original !== undefined && projectEditor.allSessionsForSession !== true && projectEditor.manualEnabled !== original.manualEnabled) {
          const enabledValue = await runAction({ action: 'set-session-directory', directoryId: projectEditor.directoryId, enabled: projectEditor.manualEnabled }, t('memorySaved'));
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
          tagNames: memoryStringArray(memory.tags)
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
        const payload = editor.persisted
          ? { action: 'update-memory', memoryId: editor.memoryId, text: editor.text, status: editor.status, directoryId: editor.directoryId, tagNames: editor.tagNames }
          : { action: 'update-memory', memoryId: editor.memoryId, text: editor.text, status: editor.status, tagNames: editor.tagNames };
        const value = await runAction(payload, t('memorySaved'));
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
        await runAction({ action: 'persist-memory', memoryId: memory.id, directoryId, status: memory.status === 'active' ? 'active' : 'inactive', tagNames: memoryStringArray(memory.tags) }, t('memoryStored'));
      };
      const toggleMemoryStatus = (memory) => {
        void runAction({ action: 'update-memory', memoryId: memory.id, status: memory.status === 'active' ? 'inactive' : 'active' }, t('memorySaved'));
      };
      const toggleTagStatus = (tag) => {
        if (tag?.preset === true) return;
        const nextStatus = memoryTagStatus(tag) === 'active' ? 'inactive' : 'active';
        void runAction({ action: 'set-tag-status', tagId: tag.id, status: nextStatus }, t('memorySaved'));
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
      /* 复制“删除记忆”日志的正文（完整内容已写入日志，这里复制的就是完整摘要）。 */
      const copyLogSummary = async (item) => {
        const text = String(item?.summary ?? '');
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
      const renderDirectory = (directory) => {
        const copied = copiedDirectoryId === directory.id;
        return react.createElement('article', { key: directory.id, className: 'dsh-session-kit-memory-directory-card' },
          react.createElement('div', { className: 'dsh-session-kit-memory-row-head' },
            react.createElement('button', { type: 'button', className: 'dsh-session-kit-memory-link-title', title: directory.name, disabled: busy, onClick: () => openProjectEditor(directory) }, directory.name),
            react.createElement('span', { className: 'dsh-session-kit-memory-count', title: t('memoryProjectCountHelp') }, `${directory.activeMemoryCount || 0}/${directory.memoryCount || 0}`),
            react.createElement(primitives.Button, { variant: 'ghost', size: 'sm', className: `dsh-session-kit-memory-directory-copy${copied ? ' dsh-session-kit-memory-directory-copy-copied' : ''}`, icon: copied ? react.createElement(primitives.IconCheckOutline16, { size: 14 }) : react.createElement(primitives.IconCopyOutline16, { size: 14 }), disabled: busy, onClick: () => void copyDirectoryId(directory), title: copied ? t('memoryCopied') : t('memoryCopyProjectId'), 'aria-label': copied ? t('memoryCopied') : t('memoryCopyProjectId') })
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
              disabled: busy || !currentSessionId || directory.allSessionsForSession === true,
              'aria-pressed': directory.manualEnabled === true,
              'aria-label': directory.manualEnabled ? t('memoryManualOn') : t('memoryManualOff'),
              onClick: () => void runAction({ action: 'set-session-directory', directoryId: directory.id, enabled: !directory.manualEnabled }, t('memorySaved'))
            }, renderSwitch(directory.manualEnabled === true), react.createElement('span', null, directory.manualEnabled ? t('memoryManualOn') : t('memoryManualOff'))),
            react.createElement(primitives.Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: () => openProjectEditor(directory) }, t('memoryEdit')),
            react.createElement(primitives.Button, { variant: 'outline', size: 'sm', className: 'dsh-session-kit-memory-danger-button', disabled: busy || directory.protected === true || Number(directory.memoryCount || 0) > 0, title: directory.protected === true ? t('memoryProjectProtected') : Number(directory.memoryCount || 0) > 0 ? t('memoryProjectHasMemories') : undefined, onClick: () => setDeleteTarget({ type: 'directory', id: directory.id, title: directory.name }) }, t('memoryDelete'))
          )
        );
      };
      const renderTag = (tag) => {
        const active = memoryTagStatus(tag) === 'active';
        return react.createElement('span', { key: tag.id, className: `dsh-session-kit-memory-tag-chip${active ? '' : ' dsh-session-kit-memory-tag-chip-inactive'}` },
          react.createElement(primitives.Button, {
            variant: 'outline',
            className: 'dsh-session-kit-memory-auto-distill-button dsh-session-kit-memory-tag-toggle-button',
            disabled: busy || tag.preset === true,
            'aria-pressed': active,
            'aria-label': active ? t('memoryActivated') : t('memoryDeactivated'),
            title: active ? t('memoryActivated') : t('memoryDeactivated'),
            onClick: () => toggleTagStatus(tag)
          }, renderSwitch(active), react.createElement('span', { className: 'dsh-session-kit-memory-tag-chip-label', title: tag.name }, tag.name)),
          !tag.preset && react.createElement(primitives.Button, {
            variant: 'outline',
            className: 'dsh-session-kit-memory-tag-delete-button',
            icon: react.createElement(primitives.IconCloseOutline16, { size: 14 }),
            disabled: busy,
            onClick: () => setDeleteTarget({ type: 'tag', id: tag.id, title: tag.name }),
            title: `${t('memoryDelete')} ${tag.name}`,
            'aria-label': `${t('memoryDelete')} ${tag.name}`
          })
        );
      };
      const renderTagChecks = (selectedNames, toggle) => activeTags.length === 0
        ? react.createElement('div', { className: 'dsh-session-kit-memory-muted' }, t('memoryTagsEmpty'))
        : react.createElement('div', { className: 'dsh-session-kit-memory-checks' }, activeTags.map((tag) => react.createElement('label', { key: tag.id, className: 'dsh-session-kit-memory-check' },
          react.createElement('input', { type: 'checkbox', checked: memoryStringArray(selectedNames).includes(tag.name), disabled: busy, onChange: () => toggle(tag.name) }),
          react.createElement('span', null, tag.name)
        )));
      const renderMemory = (memory) => {
        const isPersisted = memory.persisted === true;
        return react.createElement('article', { key: `${isPersisted ? 'stored' : 'tmp'}:${memory.id}`, className: `dsh-session-kit-memory-card${isPersisted ? '' : ' dsh-session-kit-memory-card-ephemeral'}` },
          react.createElement('div', { className: 'dsh-session-kit-memory-card-top' },
            react.createElement('div', { className: 'dsh-session-kit-memory-badges' },
              react.createElement('span', { className: `dsh-session-kit-memory-badge${memory.status === 'active' ? ' dsh-session-kit-memory-badge-active' : ''}` }, memoryStatusLabel(t, memory.status)),
              react.createElement('span', { className: 'dsh-session-kit-memory-badge dsh-session-kit-memory-badge-project', title: memory.directoryName || '' }, memory.directoryName || t('memoryNoDirectory'))
            ),
            react.createElement('div', { className: 'dsh-session-kit-memory-card-actions' },
              react.createElement(primitives.Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: () => toggleMemoryStatus(memory) }, memory.status === 'active' ? t('memoryInactive') : t('memoryActive')),
              react.createElement(primitives.Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: () => beginEdit(memory) }, t('memoryEdit')),
              react.createElement(primitives.Button, { variant: 'outline', size: 'sm', className: 'dsh-session-kit-memory-danger-button', disabled: busy, onClick: () => setDeleteTarget({ type: 'memory', id: memory.id, title: memory.text?.slice(0, 32) || memory.id }) }, t('memoryDelete'))
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
               isPersisted && react.createElement('span', { className: 'dsh-session-kit-memory-meta-creation-method' }, fillTemplate(t('memoryCreationMethod'), { method: memoryCreationMethodLabel(t, memory.creationMethod) })),
              !isPersisted && react.createElement('span', { className: 'dsh-session-kit-memory-usage' }, memoryItemUsageText(memory, t)),
              isPersisted && react.createElement('span', { className: 'dsh-session-kit-memory-usage dsh-session-kit-memory-meta-lastrecalled' }, fillTemplate(t('memoryLastRecalledAt'), { time: memory.lastRecalledAt > 0 ? memoryTime(memory.lastRecalledAt) : '-' }))
            )
          ),
          !isPersisted && react.createElement('div', { className: 'dsh-session-kit-memory-card-store-row' },
            react.createElement('span', { className: 'dsh-session-kit-memory-usage' }, fillTemplate(t('memoryLastRecalledAt'), { time: memory.lastRecalledAt > 0 ? memoryTime(memory.lastRecalledAt) : '-' })),
            react.createElement(primitives.Button, { variant: 'outline', size: 'sm', disabled: busy || directories.length === 0, title: memory.directoryName || undefined, onClick: () => void storeMemory(memory) }, t('memoryStore'))
          )
        );
      };
      const renderPagination = (id, pageInfo) => pageInfo.pageCount <= 1 ? null : react.createElement('div', { className: 'dsh-session-kit-memory-pagination' },
        react.createElement(primitives.Button, { variant: 'outline', size: 'sm', disabled: busy || pageInfo.page <= 1, onClick: () => setMemoryPage(id, pageInfo.page - 1) }, t('memoryPrevPage')),
        react.createElement('span', { className: 'dsh-session-kit-memory-pagination-text' }, fillTemplate(t('memoryPagination'), { page: pageInfo.page, pages: pageInfo.pageCount, total: pageInfo.total })),
        react.createElement(primitives.Button, { variant: 'outline', size: 'sm', disabled: busy || pageInfo.page >= pageInfo.pageCount, onClick: () => setMemoryPage(id, pageInfo.page + 1) }, t('memoryNextPage'))
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
            react.createElement('span', { className: 'dsh-session-kit-memory-donut-legend-active' }, `${t('memoryActivated')} ${activationActive}`),
            react.createElement('span', { className: 'dsh-session-kit-memory-donut-legend-inactive' }, `${t('memoryDeactivated')} ${activationInactive}`)
          )
        );
      };
      const renderSectionHeader = (title, counts) => react.createElement('div', { className: 'dsh-session-kit-memory-section-title' },
        react.createElement('span', { className: 'dsh-session-kit-memory-section-name' }, title),
        react.createElement('span', { className: 'dsh-session-kit-memory-section-counts' },
          react.createElement('span', { className: 'dsh-session-kit-memory-section-count dsh-session-kit-memory-section-count-active' }, `${t('memoryActivated')} ${counts.active}`),
          react.createElement('span', { className: 'dsh-session-kit-memory-section-count dsh-session-kit-memory-section-count-inactive' }, `${t('memoryDeactivated')} ${counts.inactive}`)
        ),
        react.createElement('span', { 'aria-hidden': 'true' })
      );
      const renderMemoryCollection = (id, title, pageInfo, emptyText, totalCount, counts) => react.createElement(react.Fragment, null,
        renderSectionHeader(title, counts),
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
        const kindEntries = usageEntries(activeWindow.kinds, (entry) => entry.key === 'auto-distill' ? t('memoryUsageKindAuto') : entry.key === 'manual-distill' ? t('memoryUsageKindManual') : entry.key === 'memory_add' ? 'memory_add' : entry.key || t('memoryUsageUnknownModel'));
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
        if (memoryTab === 'temporary') return renderMemoryCollection('temporary', t('memoryEphemeralListTitle'), temporaryPage, t('memoryTemporaryEmpty'), memories.filter((memory) => memory.persisted !== true).length, memoryStatusCounts(visibleTemporaryMemories, (memory) => memory.status === 'active'));
        if (memoryTab === 'memories') return renderMemoryCollection('memories', t('memoryPersistedListTitle'), persistedPage, t('memoryPersistedEmpty'), memories.filter((memory) => memory.persisted === true).length, memoryStatusCounts(visiblePersistedMemories, (memory) => memory.status === 'active'));
        if (memoryTab === 'progress') return react.createElement('div', { className: 'dsh-session-kit-memory-activity-list' },
          progressItems.length === 0 ? react.createElement('div', { className: 'dsh-session-kit-archive-empty' }, t('memoryNoActivities')) : progressItems.map((item) => react.createElement('article', { key: item.id, className: 'dsh-session-kit-memory-activity-card' },
            react.createElement('div', { className: 'dsh-session-kit-memory-activity-head' }, react.createElement('strong', null, memoryActivityKindLabel(t, item)), react.createElement('span', { className: `dsh-session-kit-memory-badge${memoryActivityBadgeClass(item.status)}` }, t(`memoryActivityStatus_${item.status}`) || item.status)),
            (item.sessionTitle || item.sessionId) && react.createElement('div', { className: 'dsh-session-kit-memory-muted dsh-session-kit-memory-activity-summary' }, `${item.sessionTitle || t('memoryUnknownSession')} · ${item.sessionId || '-'}`),
            react.createElement('div', { className: 'dsh-session-kit-memory-muted dsh-session-kit-memory-activity-summary' }, item.summary || (item.kind === 'distill' || item.kind === 'memory_add' || item.kind === 'directory_create' || item.kind === 'directory_update' || item.kind === 'directory_delete' || item.kind === 'tag_create' || item.kind === 'tag_update' || item.kind === 'tag_delete' ? t('memoryActivityPendingSummary') : item.kind === 'memory_update' || item.kind === 'memory_delete' ? t('memoryActivityMemorySummary') : '-')),
            react.createElement('div', { className: 'dsh-session-kit-memory-muted dsh-session-kit-memory-activity-time' }, `${t('memoryActivityStartedAt')}：${formatActivityClockTime(item.startedAt) || '-'} · ${t('memoryActivityElapsed')}：${memoryActivityElapsedText(t, item.startedAt, progressTick)}`)
          ))
        );
        if (memoryTab === 'logs') return react.createElement('div', { className: 'dsh-session-kit-memory-logs' },
          react.createElement('div', { className: 'dsh-session-kit-memory-logs-bar' },
            react.createElement('div', { className: 'dsh-session-kit-memory-section-title dsh-session-kit-memory-logs-title' }, t('memoryLogsRetentionHint')),
            react.createElement(primitives.Button, { variant: 'outline', size: 'sm', className: 'dsh-session-kit-memory-logs-clear', disabled: busy || loading || logItems.length === 0, onClick: () => setClearLogsOpen(true) }, busyAction === 'clear-activity-logs' ? t('memoryLogsClearing') : t('memoryLogsClear'))
          ),
          react.createElement('div', { className: 'dsh-session-kit-memory-activity-list' },
            logItems.length === 0 ? react.createElement('div', { className: 'dsh-session-kit-archive-empty' }, t('memoryNoActivityLogs')) : logItems.map((item) => react.createElement('article', { key: item.id, className: 'dsh-session-kit-memory-activity-card' },
              react.createElement('div', { className: 'dsh-session-kit-memory-activity-head' },
                react.createElement('span', { className: 'dsh-session-kit-memory-activity-head-main' },
                  react.createElement('strong', null, memoryActivityKindLabel(t, item)),
                  /* 删除记忆：标题右侧复制按钮，复制该条日志的完整正文。 */
                  item.kind === 'memory_delete' && react.createElement(primitives.Button, {
                    variant: 'ghost',
                    size: 'sm',
                    className: `dsh-session-kit-memory-activity-copy${copiedLogId === item.id ? ' dsh-session-kit-memory-activity-copy-copied' : ''}`,
                    icon: copiedLogId === item.id ? react.createElement(primitives.IconCheckOutline16, { size: 14 }) : react.createElement(primitives.IconCopyOutline16, { size: 14 }),
                    disabled: busy,
                    onClick: () => void copyLogSummary(item),
                    title: copiedLogId === item.id ? t('memoryLogCopied') : t('memoryLogCopy'),
                    'aria-label': copiedLogId === item.id ? t('memoryLogCopied') : t('memoryLogCopy')
                  })
                ),
                react.createElement('span', { className: `dsh-session-kit-memory-badge${memoryActivityBadgeClass(item.outcome)}` }, t(`memoryActivityStatus_${item.outcome}`) || item.outcome)
              ),
              (item.sessionTitle || item.sessionId) && react.createElement('div', { className: 'dsh-session-kit-memory-muted dsh-session-kit-memory-activity-summary' }, `${item.sessionTitle || t('memoryUnknownSession')} · ${item.sessionId || '-'}`),
              item.summary ? react.createElement(MemoryActivitySummary, { text: item.summary, className: 'dsh-session-kit-memory-muted' }) : react.createElement('div', { className: 'dsh-session-kit-memory-muted dsh-session-kit-memory-activity-summary' }, '-'),
              (item.errorMessage || item.errorCode) && react.createElement('div', { className: 'dsh-session-kit-memory-activity-error' }, `${t('memoryActivityErrorReason')}：${[item.errorCode, item.errorMessage].filter(Boolean).join(' · ') || '-'}`),
              react.createElement('div', { className: 'dsh-session-kit-memory-muted dsh-session-kit-memory-activity-time' }, `${t('memoryActivityTime')}：${formatArchiveTime(item.createdAt) || '-'}`),
              logHasMore && item === logItems[logItems.length - 1] && react.createElement(primitives.Button, { variant: 'outline', size: 'sm', onClick: () => void loadActivity('logs', logBefore, true) }, t('memoryLoadMore'))
            ))
          )
        );
        if (memoryTab === 'settings') return react.createElement('div', { className: 'dsh-session-kit-memory-settings dsh-session-kit-memory-panel' },
          react.createElement('div', { className: 'dsh-session-kit-memory-section-title' }, t('memorySettings')),
          react.createElement('p', { className: 'dsh-session-kit-compaction-desc' }, t('memorySettingsDesc')),
          react.createElement('div', { className: 'dsh-session-kit-memory-settings-current' }, snapshot?.distillModelOverride ? `${snapshot.distillModelOverride.provider}/${snapshot.distillModelOverride.model}${snapshot.distillModelOverride.reasoningEffort ? ` · ${snapshot.distillModelOverride.reasoningEffort}` : ''}` : t('memoryFollowingSessionModel')),
          react.createElement('label', { className: 'dsh-session-kit-global-prompt-field' },
            react.createElement('span', null, t('memoryDistillModel')),
            react.createElement(MemorySelect, {
              value: distillModelDraft?.provider && distillModelDraft?.model ? JSON.stringify({ provider: distillModelDraft.provider, model: distillModelDraft.model }) : '',
              options: modelOptions,
              disabled: busy || loading || modelDirectoryState.status !== 'ready' || modelDirectoryState.groups.length === 0,
              placeholder: modelDirectoryState.status === 'loading' ? t('memoryModelLoading') : t('memoryNoModels'),
              ariaLabel: t('memoryDistillModel'),
              searchable: true,
              searchPlaceholder: t('memorySearchModels'),
              onChange: (value) => {
                if (!value) { setDistillModelDraft(null); return; }
                try { setDistillModelDraft(JSON.parse(value)); } catch { setDistillModelDraft(null); }
              }
            })
          ),
          reasoningOptions.length > 0 && react.createElement('label', { className: 'dsh-session-kit-global-prompt-field' },
            react.createElement('span', null, t('memoryReasoningEffort')),
            react.createElement(MemorySelect, {
              value: distillModelDraft?.reasoningEffort || selectedModel?.reasoning?.defaultEffort || '',
              options: reasoningOptions,
              disabled: busy || loading,
              placeholder: t('memoryProviderDefault'),
              ariaLabel: t('memoryReasoningEffort'),
              onChange: (value) => setDistillModelDraft((current) => current ? { ...current, ...(value ? { reasoningEffort: value } : { reasoningEffort: undefined }) } : current)
            })
          ),
          react.createElement(primitives.Button, { variant: 'outline', className: 'dsh-session-kit-memory-settings-save', disabled: busy || loading || distillModelDraft === undefined, onClick: () => void runAction({ action: 'set-distill-model', modelSelection: distillModelDraft }, t('memorySaved')) }, t('memorySave')),
        );
        return react.createElement(react.Fragment, null,
          renderSectionHeader(t('memoryTagListTitle'), memoryStatusCounts(visibleTags, (tag) => memoryTagStatus(tag) === 'active')),
          visibleTags.length === 0
            ? react.createElement('div', { className: 'dsh-session-kit-archive-empty' }, tags.length === 0 ? t('memoryTagsEmpty') : t('memoryNoMatches'))
            : react.createElement('div', { className: 'dsh-session-kit-memory-tag-list dsh-session-kit-memory-tag-list-panel' }, visibleTags.map(renderTag))
        );
      };
      const confirmDelete = async () => {
        if (deleteTarget === null) return;
        const target = deleteTarget;
        setDeleteTarget(null);
        if (target.type === 'directory') await runAction({ action: 'delete-directory', directoryId: target.id }, t('memoryDeleted'));
        else if (target.type === 'tag') await runAction({ action: 'delete-tag', tagId: target.id }, t('memoryDeleted'));
        else await runAction({ action: 'delete-memory', memoryId: target.id }, t('memoryDeleted'));
        if (target.type === 'directory' && directoryFilter === target.id) setDirectoryFilter('all');
      };
      const editorDirectory = editor?.directoryId ? directoryById.get(editor.directoryId) : undefined;
      const activeErrorLayer = newMemoryOpen ? 'newMemory' : newDirectoryOpen ? 'newDirectory' : newTagOpen ? 'newTag' : projectEditor !== null ? 'projectEditor' : editor !== null ? 'editor' : null;
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
            snapshot && react.createElement('p', { className: 'dsh-session-kit-memory-store-info' }, fillTemplate(t('memoryStoreInfo'), { path: snapshot.dbPath || '-', mode: snapshot.ftsMode || (snapshot.ftsEnabled ? 'FTS5 + BM25' : 'LIKE') })),
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
                  search !== '' && react.createElement('button', { type: 'button', className: 'dsh-session-kit-archive-search-clear', onClick: () => setSearch(''), 'aria-label': t('archiveSearchClear'), title: t('archiveSearchClear') }, react.createElement(primitives.IconCloseOutline16, { size: 14 }))
                ),
                react.createElement('div', { className: 'dsh-session-kit-memory-top-actions' },
                  react.createElement(primitives.Button, { variant: 'outline', size: 'md', disabled: busy, onClick: () => setNewDirectoryOpen(true) }, t('memoryNewDirectory')),
                  react.createElement(primitives.Button, { variant: 'outline', size: 'md', disabled: busy, onClick: () => setNewTagOpen(true) }, t('memoryNewTag')),
                  react.createElement(primitives.Button, { variant: 'outline', size: 'md', disabled: busy || directories.length === 0, onClick: () => { setNewMemoryNotice(null); setNewMemoryDirectoryId(directoryFilter !== 'all' && directoryFilter !== 'ephemeral' ? directoryFilter : directories[0]?.id || ''); setNewMemoryOpen(true); } }, t('memoryNewMemory'))
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
              react.createElement(primitives.Button, { variant: 'outline', className: 'dsh-session-kit-memory-auto-distill-button', disabled: busy || loading, 'aria-pressed': autoDistillEnabled, onClick: () => void runAction({ action: 'set-auto-distill', enabled: !autoDistillEnabled }, t('memorySaved')) }, renderSwitch(autoDistillEnabled), react.createElement('span', null, t('memoryAutoDistill'))),
              react.createElement(primitives.Button, { variant: 'outline', className: 'dsh-session-kit-memory-all-sessions-button', disabled: busy || loading, 'aria-pressed': allSessionsDirectoryEnabled, onClick: () => void runAction({ action: 'set-all-sessions-enabled', enabled: !allSessionsDirectoryEnabled }, t('memorySaved')) }, renderSwitch(allSessionsDirectoryEnabled), react.createElement('span', null, t('memoryAllSessionsDirectory'))),
              react.createElement(primitives.Button, { variant: 'outline', className: 'dsh-session-kit-memory-first-match-button', disabled: busy || loading, 'aria-pressed': firstTurnAutoMatchEnabled, onClick: () => void runAction({ action: 'set-first-turn-auto-match', enabled: !firstTurnAutoMatchEnabled }, t('memorySaved')) }, renderSwitch(firstTurnAutoMatchEnabled), react.createElement('span', null, t('memoryFirstTurnAutoMatch')))
            ),
            react.createElement(primitives.Button, {
              variant: 'outline',
              disabled: busy || loading || !currentSessionId,
              icon: busyAction === 'distill-now' ? react.createElement(DistillHourglassIcon, { size: 16 }) : react.createElement(primitives.IconSparkle16, { size: 16 }),
              onClick: () => {
                const selection = getModelSelection?.(currentSessionId);
                void runAction({ action: 'distill-now', ...(selection ? { modelSelection: selection } : {}) }, t('memoryDistillDone'));
              }
            }, t('memoryDistillNow')),
            react.createElement(primitives.Button, { variant: 'outline', disabled: busy, onClick: onClose }, t('memoryClose'))
          )
        }),
        react.createElement(primitives.Modal, {
          open: open && newMemoryOpen,
          onClose: () => { if (!busy) { setNewMemoryOpen(false); setNewMemoryNotice(null); } },
          title: t('memoryNewMemory'),
          closeLabel: t('memoryCancel'),
          className: 'dsh-session-kit-memory-form-modal',
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
                  disabled: busy || newMemoryText.trim() === '',
                  title: t('memoryBeautifyFormat'),
                  onClick: beautifyNewMemoryText
                }, t('memoryBeautifyFormat'))
              ),
              react.createElement('textarea', { id: 'dsh-session-kit-new-memory-text', className: 'dsh-session-kit-global-prompt-textarea dsh-session-kit-memory-editor-textarea', value: newMemoryText, disabled: busy, rows: 5, onChange: (event) => { setNewMemoryText(event.currentTarget.value); setNewMemoryNotice(null); }, 'aria-label': t('memoryText') })
            ),
            react.createElement('label', { className: 'dsh-session-kit-global-prompt-field' },
              react.createElement('span', null, t('memorySelectDirectory')),
              react.createElement(MemorySelect, { value: newMemoryDirectoryId, options: directories.length === 0 ? [{ value: '', label: t('memoryNoDirectories'), disabled: true }] : directoryOptions, disabled: busy || directories.length === 0, placeholder: t('memorySelectDirectory'), ariaLabel: t('memorySelectDirectory'), searchable: true, searchPlaceholder: t('memorySearchDirectories'), onChange: setNewMemoryDirectoryId })
            ),
            react.createElement('div', { className: 'dsh-session-kit-memory-form-status' },
              react.createElement(primitives.Button, {
                variant: 'outline',
                size: 'sm',
                className: 'dsh-session-kit-memory-manual-toggle-button',
                disabled: busy,
                'aria-pressed': newMemoryStatus === 'active',
                'aria-label': t('memoryActive'),
                onClick: () => setNewMemoryStatus(newMemoryStatus === 'active' ? 'inactive' : 'active')
              }, renderSwitch(newMemoryStatus === 'active'), react.createElement('span', null, newMemoryStatus === 'active' ? t('memoryActivated') : t('memoryDeactivated')))
            ),
            react.createElement('label', { className: 'dsh-session-kit-global-prompt-field' },
              react.createElement('span', null, t('memorySelectTags')),
              renderTagChecks(newMemoryTagNames, toggleNewMemoryTag)
            )
          ),
          footer: react.createElement(react.Fragment, null,
            react.createElement(primitives.Button, { variant: 'outline', disabled: busy, onClick: () => { setNewMemoryOpen(false); setNewMemoryNotice(null); } }, t('memoryCancel')),
            react.createElement(primitives.Button, { variant: 'outline', disabled: busy || newMemoryText.trim() === '' || !newMemoryDirectoryId, onClick: () => void createMemory() }, busy ? t('memorySaving') : t('memorySave'))
          )
        }),
        react.createElement(primitives.Modal, {
          open: open && newDirectoryOpen,
          onClose: () => { if (!busy) setNewDirectoryOpen(false); },
          title: t('memoryNewDirectory'),
          closeLabel: t('memoryCancel'),
          className: 'dsh-session-kit-memory-form-modal',
          children: react.createElement('div', { className: 'dsh-session-kit-memory-form' },
            renderFormError('newDirectory'),
            react.createElement('label', { className: 'dsh-session-kit-global-prompt-field' },
              react.createElement('span', null, t('memoryDirectoryName')),
              react.createElement('input', { className: 'dsh-session-kit-rename-input', value: newDirectoryName, disabled: busy, onChange: (event) => setNewDirectoryName(event.currentTarget.value), 'aria-label': t('memoryDirectoryName') })
            ),
            react.createElement('label', { className: 'dsh-session-kit-global-prompt-field' },
              react.createElement('span', null, t('memoryRemark')),
              react.createElement('textarea', { className: 'dsh-session-kit-memory-mini-textarea', value: newDirectoryRemark, disabled: busy, rows: 2, maxLength: 500, placeholder: t('memoryRemarkPlaceholder'), onChange: (event) => setNewDirectoryRemark(event.currentTarget.value), 'aria-label': t('memoryRemark') })
            )
          ),
          footer: react.createElement(react.Fragment, null,
            react.createElement(primitives.Button, { variant: 'outline', disabled: busy, onClick: () => setNewDirectoryOpen(false) }, t('memoryCancel')),
            react.createElement(primitives.Button, { variant: 'outline', disabled: busy || newDirectoryName.trim() === '', onClick: () => void createDirectory() }, busy ? t('memorySaving') : t('memoryCreate'))
          )
        }),
        react.createElement(primitives.Modal, {
          open: open && newTagOpen,
          onClose: () => { if (!busy) setNewTagOpen(false); },
          title: t('memoryNewTag'),
          closeLabel: t('memoryCancel'),
          className: 'dsh-session-kit-memory-form-modal',
          children: react.createElement('div', { className: 'dsh-session-kit-memory-form' },
            renderFormError('newTag'),
            react.createElement('label', { className: 'dsh-session-kit-global-prompt-field' },
              react.createElement('span', null, t('memoryTagName')),
              react.createElement('input', { className: 'dsh-session-kit-rename-input', value: newTagName, disabled: busy, onChange: (event) => setNewTagName(event.currentTarget.value), 'aria-label': t('memoryTagName') })
            )
          ),
          footer: react.createElement(react.Fragment, null,
            react.createElement(primitives.Button, { variant: 'outline', disabled: busy, onClick: () => setNewTagOpen(false) }, t('memoryCancel')),
            react.createElement(primitives.Button, { variant: 'outline', disabled: busy || newTagName.trim() === '', onClick: () => void createTag() }, busy ? t('memorySaving') : t('memoryCreate'))
          )
        }),
        projectEditor && react.createElement(primitives.Modal, {
          open: open && projectEditor !== null,
          onClose: () => { if (!busy) setProjectEditor(null); },
          title: t('memoryEditProject'),
          closeLabel: t('memoryCancel'),
          className: 'dsh-session-kit-memory-form-modal',
          children: react.createElement('div', { className: 'dsh-session-kit-memory-form' },
            renderFormError('projectEditor'),
            react.createElement('label', { className: 'dsh-session-kit-global-prompt-field' },
              react.createElement('span', null, t('memoryDirectoryName')),
              react.createElement('input', { className: 'dsh-session-kit-rename-input', value: projectEditor.name, disabled: busy || projectEditor.protected, onChange: (event) => { const value = event.currentTarget.value; setProjectEditor((current) => current && { ...current, name: value }); }, 'aria-label': t('memoryDirectoryName') })
            ),
            react.createElement('label', { className: 'dsh-session-kit-global-prompt-field' },
              react.createElement('span', null, t('memoryRemark')),
              react.createElement('textarea', { className: 'dsh-session-kit-memory-mini-textarea', value: projectEditor.remark, disabled: busy, rows: 2, maxLength: 500, placeholder: t('memoryRemarkPlaceholder'), onChange: (event) => { const value = event.currentTarget.value; setProjectEditor((current) => current && { ...current, remark: value }); }, 'aria-label': t('memoryRemark') })
            ),
            react.createElement(primitives.Button, {
              variant: 'outline',
              size: 'sm',
              className: 'dsh-session-kit-memory-manual-toggle-button',
              disabled: busy || !currentSessionId || projectEditor.allSessionsForSession === true,
              'aria-pressed': projectEditor.manualEnabled === true,
              onClick: () => setProjectEditor((current) => current && { ...current, manualEnabled: !current.manualEnabled })
            },
              renderSwitch(projectEditor.manualEnabled === true),
              react.createElement('span', null, projectEditor.manualEnabled === true ? t('memoryManualOn') : t('memoryManualOff'))
            )
          ),
          footer: react.createElement(react.Fragment, null,
            react.createElement(primitives.Button, { variant: 'outline', disabled: busy, onClick: () => setProjectEditor(null) }, t('memoryCancel')),
            react.createElement(primitives.Button, { variant: 'outline', disabled: busy || projectEditor.name.trim() === '', onClick: () => void saveProjectEditor() }, busy ? t('memorySaving') : t('memorySave'))
          )
        }),
        editor && react.createElement(primitives.Modal, {
          open: open && editor !== null,
          onClose: () => { if (!busy) { setEditor(null); setEditorNotice(null); } },
          title: t('memoryEdit'),
          closeLabel: t('memoryCancel'),
          className: 'dsh-session-kit-memory-form-modal',
          children: react.createElement('div', { className: 'dsh-session-kit-memory-form' },
            renderEditorFeedback(),
            react.createElement('div', { className: 'dsh-session-kit-global-prompt-field' },
              react.createElement('div', { className: 'dsh-session-kit-memory-editor-head' },
                react.createElement('label', { htmlFor: `dsh-session-kit-memory-editor-text-${editor.memoryId}` }, t('memoryText')),
                editor !== null && react.createElement(primitives.Button, {
                  variant: 'outline',
                  size: 'sm',
                  className: 'dsh-session-kit-memory-beautify-button',
                  disabled: busy || editor.text.trim() === '',
                  title: t('memoryBeautifyFormat'),
                  onClick: beautifyEditorText
                }, t('memoryBeautifyFormat'))
              ),
              react.createElement('textarea', { id: `dsh-session-kit-memory-editor-text-${editor.memoryId}`, className: 'dsh-session-kit-global-prompt-textarea dsh-session-kit-memory-editor-textarea', value: editor.text, disabled: busy, rows: 6, onChange: (event) => { const value = event.currentTarget.value; setEditor((current) => current && { ...current, text: value }); setEditorNotice(null); }, 'aria-label': t('memoryText') })
            ),
            react.createElement('label', { className: 'dsh-session-kit-global-prompt-field' },
              react.createElement('span', null, t('memorySelectDirectory')),
              react.createElement(MemorySelect, { value: editor.directoryId, options: directoryOptions, disabled: busy || directories.length === 0, placeholder: editorDirectory?.name || t('memorySelectDirectory'), ariaLabel: t('memorySelectDirectory'), searchable: true, searchPlaceholder: t('memorySearchDirectories'), onChange: (value) => setEditor((current) => current && { ...current, directoryId: value }) })
            ),
            react.createElement('div', { className: 'dsh-session-kit-memory-form-status' },
              react.createElement(primitives.Button, {
                variant: 'outline',
                size: 'sm',
                className: 'dsh-session-kit-memory-manual-toggle-button',
                disabled: busy,
                'aria-pressed': editor.status === 'active',
                'aria-label': t('memoryActive'),
                onClick: () => setEditor((current) => current && { ...current, status: current.status === 'active' ? 'inactive' : 'active' })
              }, renderSwitch(editor.status === 'active'), react.createElement('span', null, editor.status === 'active' ? t('memoryActivated') : t('memoryDeactivated')))
            ),
            react.createElement('label', { className: 'dsh-session-kit-global-prompt-field' },
              react.createElement('span', null, t('memorySelectTags')),
              renderTagChecks(editor.tagNames, toggleEditorTag)
            )
          ),
          footer: react.createElement(react.Fragment, null,
            react.createElement(primitives.Button, { variant: 'outline', disabled: busy, onClick: () => { setEditor(null); setEditorNotice(null); } }, t('memoryCancel')),
            react.createElement(primitives.Button, { variant: 'outline', disabled: busy || editor.text.trim() === '', onClick: () => void saveEditor() }, busy ? t('memorySaving') : t('memorySave'))
          )
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
          onConfirm: () => void confirmDelete(),
          busy
        }),
        react.createElement(DeleteConfirmDialog, {
          open: open && clearLogsOpen,
          t,
          title: t('memoryLogsClearConfirmTitle'),
          message: t('memoryLogsClearConfirmDesc'),
          confirmLabel: t('memoryLogsClear'),
          onCancel: () => setClearLogsOpen(false),
          onConfirm: () => void confirmClearLogs(),
          busy
        })
      );
    }

    function ToolStatsDialog({ open, t, stats, loading, error, onClose }) {
      const toolCalls = normalizeToolCalls(stats?.toolCalls);
      const total = Number.isFinite(Number(stats?.total)) ? Number(stats.total) : toolCalls.reduce((sum, entry) => sum + entry.count, 0);
      const success = Number.isFinite(Number(stats?.success)) ? Number(stats.success) : toolCalls.reduce((sum, entry) => sum + entry.success, 0);
      const failed = Number.isFinite(Number(stats?.failed)) ? Number(stats.failed) : toolCalls.reduce((sum, entry) => sum + entry.failed, 0);
      const pending = Number.isFinite(Number(stats?.pending)) ? Number(stats.pending) : toolCalls.reduce((sum, entry) => sum + entry.pending, 0);
      return react.createElement(primitives.Modal, {
        open,
        onClose,
        title: t('statsTitle'),
        closeLabel: t('archiveClose'),
        className: 'dsh-session-kit-stats-modal',
        children: react.createElement('div', { className: 'dsh-session-kit-stats' },
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
        ),
        footer: react.createElement(primitives.Button, { variant: 'outline', disabled: loading, onClick: onClose }, t('archiveClose'))
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
              icon: react.createElement(primitives.IconCopyOutline16, { size: 14 }),
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
                  react.createElement('span', { className: 'dsh-session-kit-preview-search-icon', 'aria-hidden': 'true' }, react.createElement(primitives.IconSearchOutline16, { size: 15 })),
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
                  }, react.createElement(primitives.IconCloseOutline16, { size: 14 }))
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
          icon: copiedKey === `attr:${attr.key}` ? react.createElement(primitives.IconCheckOutline16, { size: 14 }) : react.createElement(primitives.IconCopyOutline16, { size: 14 }),
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
                  react.createElement('span', { className: 'dsh-session-kit-preview-search-icon', 'aria-hidden': 'true' }, react.createElement(primitives.IconSearchOutline16, { size: 15 })),
                  react.createElement('input', {
                    className: 'dsh-session-kit-preview-search-input',
                    value: search,
                    placeholder: t('archivePreviewSearchPlaceholder'),
                    onChange: (event) => setSearch(event.currentTarget.value),
                    'aria-label': t('archivePreviewSearchPlaceholder')
                  }),
                  search !== '' && react.createElement('button', { type: 'button', className: 'dsh-session-kit-preview-search-clear', onClick: () => setSearch(''), 'aria-label': t('archiveSearchClear'), title: t('archiveSearchClear') }, react.createElement(primitives.IconCloseOutline16, { size: 14 }))
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
          react.createElement(primitives.IconChevronDownOutline14, { size: 14 })
        )
      );
      const filteredItems = react.useMemo(() => {
        return items.filter((item) => {
          const titleMatched = normalizedSearch === '' || String(item.title || item.sessionId).toLocaleLowerCase().includes(normalizedSearch);
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
          open: open && !preview.open,
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
                react.createElement('span', { className: 'dsh-session-kit-archive-search-icon', 'aria-hidden': 'true' }, react.createElement(primitives.IconSearchOutline16, { size: 15 })),
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
                }, react.createElement(primitives.IconCloseOutline16, { size: 14 }))
              ),
              react.createElement('span', { className: 'dsh-session-kit-archive-workdir-menu', ref: workdirMenuRef },
                workdirAnchor,
                workdirMenuOpen && react.createElement('div', { className: 'dsh-session-kit-archive-workdir-panel', role: 'dialog', 'aria-label': t('archiveWorkdirLabel') },
                  react.createElement('div', { className: 'dsh-session-kit-archive-workdir-search dsh-session-kit-archive-search-with-icon' },
                    react.createElement('span', { className: 'dsh-session-kit-archive-search-icon', 'aria-hidden': 'true' }, react.createElement(primitives.IconSearchOutline16, { size: 15 })),
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
                    }, react.createElement(primitives.IconCloseOutline16, { size: 14 }))
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
                      item.id === workdirFilter && react.createElement(primitives.IconCheckOutline16, { size: 14 })
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
                      react.createElement('span', { className: 'dsh-session-kit-archive-meta-icon', 'aria-hidden': 'true' }, react.createElement(primitives.IconFolderOpenOutline16, { size: 14 })),
                      react.createElement('span', { className: 'dsh-session-kit-archive-meta-text', title: item.cwd || item.sessionId }, item.cwd || item.sessionId)
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

    function DeleteConfirmDialog({ open, t, onCancel, onConfirm, busy, title, message, confirmLabel }) {
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
            { style: { display: 'inline-flex', width: 16, height: 28, alignItems: 'center', justifyContent: 'center', color: 'var(--dsw-alias-state-error-primary)', flex: 'none' } },
            react.createElement(primitives.IconWarningOutline16, { size: 16 })
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
            style: { color: 'var(--dsw-alias-state-error-primary)', borderColor: 'var(--dsw-alias-state-error-primary)' }
          }, confirmLabel || t('delete'))
        )
      });
    }

    function SessionManagerButton({ sessionId: sessionIdProp, useSession, t, exporter, openSession, refreshWorkspaces, refreshSessions, archiveCurrentSession, forkCurrentSession, renameCurrentSession, getSessionTitle, getCurrentUserMessage, getModelSelection, getModelDirectory, updateSidebarEntries }) {
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
          react.createElement('span', { className: `dsh-session-kit-menu-chevron${open ? ' dsh-session-kit-menu-chevron-open' : ''}`, 'aria-hidden': 'true' }, react.createElement(primitives.IconChevronDownOutline14, { size: 14 }))
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
             ctx.sessions.open 对已打开会话不会重读磁盘（旧绑定缓存着失败状态）。
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
          onClose: () => setMemoryOpen(false)
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

    function SidebarMemoryButton({ wide, useSessions, t, getSessionTitle, getCurrentUserMessage, getModelSelection, getModelDirectory, updateSidebarEntries }) {
      const sidebarEntries = useSidebarEntries();
      const [open, setOpen] = react.useState(false);
      const useSessionsSafe = typeof useSessions === 'function' ? useSessions : () => undefined;
      const sessions = useSessionsSafe((value) => value);
      const sessionId = String(sessions?.current ?? '');
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
      return left.length === right.length && left.every((item, index) => item.key === right[index].key && item.turn === right[index].turn && item.text === right[index].text && item.host === right[index].host);
    }

    function HiddenSessionLogDownloadHeaderAction() {
      return null;
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
          result.push({ key: String(node.key ?? key), turn, text: topicContentText(node.data?.content) });
        }
        return result;
      }, [order, nodes]);
      const targetSig = react.useMemo(() => targets.map((target) => `${target.key}:${target.turn}:${target.text}`).join('\n'), [targets]);
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
          for (const target of targets) {
            const row = userActionRowForKey(target.key);
            let record = hosts.current.get(target.key);
            if (record === undefined) {
              const host = document.createElement('span');
              host.dataset.dshUserTurnActions = target.key;
              host.style.display = 'contents';
              record = { host, turn: target.turn, text: target.text };
              hosts.current.set(target.key, record);
            } else {
              record.turn = target.turn;
              record.text = target.text;
            }
            const parent = row === null ? null : userActionHostParent(row, record.host);
            if (parent === null) {
              record.host.remove();
              continue;
            }
            if (record.host.parentElement !== parent) parent.appendChild(record.host);
            next.push({ key: target.key, turn: target.turn, text: target.text, host: record.host });
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
          react.createElement(EditRegenerateAction, { turn: target.turn, text: target.text, editRegenerateTurn, useSession, t }),
          react.createElement(RegenerateAction, { turn: target.turn, regenerateTurn, useSession, t }),
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
        loadingOlder ? react.createElement(primitives.IconLoadingOutline16, {}) : react.createElement(primitives.IconChevronUpOutline14, { size: 16 })
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
        react.createElement(primitives.IconChevronDownOutline14, { size: 16 })
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
        react.createElement(primitives.IconChevronUpOutline14, { size: 16 })
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
        react.createElement(primitives.IconChevronDownOutline14, { size: 16 })
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

    let turnsDelOwnerSequence = 0;
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

    function rowsForTurnTail(tailRow) {
      const rows = [tailRow];
      let cursor = tailRow.previousElementSibling;
      while (cursor instanceof HTMLElement) {
        if (isTurnTailFlowRow(cursor)) break;
        rows.push(cursor);
        cursor = cursor.previousElementSibling;
      }
      return rows;
    }

    function turnsDelRows(marker, startTurn, endTurn) {
      const list = marker.closest('[data-chat-flow-kind="turn-tail"]')?.parentElement;
      if (list === undefined || list === null) return [];
      const rows = [];
      const seen = new Set();
      for (const tailRow of list.querySelectorAll('[data-chat-flow-kind="turn-tail"]')) {
        const turn = tailTurn(tailRow);
        if (turn === undefined || turn < startTurn || turn > endTurn) continue;
        for (const row of rowsForTurnTail(tailRow)) {
          if (seen.has(row)) continue;
          seen.add(row);
          rows.push(row);
        }
      }
      return rows;
    }

    function concealTurnsDelRange(marker, startTurn, endTurn) {
      const owner = `${String(startTurn)}-${String(endTurn)}-${String(++turnsDelOwnerSequence)}`;
      const changed = [];
      for (const element of turnsDelRows(marker, startTurn, endTurn)) {
        changed.push({ element, hidden: element.hidden });
        element.dataset.dshTurnsDelOwner = owner;
        element.hidden = true;
      }
      return () => {
        for (const entry of changed) {
          if (entry.element.dataset.dshTurnsDelOwner !== owner) continue;
          delete entry.element.dataset.dshTurnsDelOwner;
          entry.element.hidden = entry.hidden;
        }
      };
    }

    /* 删除/重生成成功后的即时反馈：官方聊天视图按 append-origin 事件渲染人类记录，
       不会因替换事件撤除已渲染的行；标记组件又依赖轮次 tail 槽位重渲染才挂载。
       这里直接全局扫描 DOM 隐藏对应轮次的行，桥接到下一次视图重建。 */
    function concealTurnsDelRangeGlobally(startTurn, endTurn) {
      if (typeof document === 'undefined'
        || !Number.isSafeInteger(startTurn) || startTurn < 0
        || !Number.isSafeInteger(endTurn) || endTurn < startTurn) return;
      const owner = `${String(startTurn)}-${String(endTurn)}-${String(++turnsDelOwnerSequence)}`;
      for (const tailRow of document.querySelectorAll('[data-chat-flow-kind="turn-tail"]')) {
        const turn = tailTurn(tailRow);
        if (turn === undefined || turn < startTurn || turn > endTurn) continue;
        for (const row of rowsForTurnTail(tailRow)) {
          row.dataset.dshTurnsDelOwner = owner;
          row.hidden = true;
        }
      }
    }

    function TurnsDelMarker({ matched }) {
      const markerRef = react.useRef(null);
      react.useLayoutEffect(() => {
        const marker = markerRef.current;
        if (marker === null) return;
        const list = marker.closest('[data-chat-flow-kind="turn-tail"]')?.parentElement;
        if (list === undefined || list === null) return;
        let restore = concealTurnsDelRange(marker, matched.startTurn, matched.endTurn);
        const observer = new MutationObserver(() => {
          restore();
          restore = concealTurnsDelRange(marker, matched.startTurn, matched.endTurn);
        });
        observer.observe(list, { childList: true, subtree: true });
        return () => {
          observer.disconnect();
          restore();
        };
      }, [matched.startTurn, matched.endTurn]);
      return react.createElement('span', { ref: markerRef, 'data-dsh-turns-del': matched.startTurn, hidden: true });
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

    function RegenerateAction({ messageId, turn, regenerateTurns, regenerateTurn, useSession, t }) {
      const running = useSession((snapshot) => snapshot.running);
      const queued = useSession((snapshot) => snapshot.queue.length > 0);
      const subagent = useSession((snapshot) => snapshot.subagent);
      const [pending, setPending] = react.useState(false);
      const operationId = react.useRef(null);
      const [error, setError] = react.useState(null);
      const alive = react.useRef(true);
      react.useEffect(() => {
        alive.current = true;
        return () => { alive.current = false; };
      }, []);
      if (subagent !== null) return null;
      const unavailable = running || queued || pending;
      const regenerate = async () => {
        if (unavailable) return;
        operationId.current ??= crypto.randomUUID();
        setPending(true);
        setError(null);
        try {
          const result = typeof turn === 'number' ? await regenerateTurn(turn, operationId.current) : await regenerateTurns(messageId, operationId.current);
          if (result.ok) {
            const deletion = result.value?.deletion;
            concealTurnsDelRangeGlobally(deletion?.turn, deletion?.endTurn);
          }
          if (!result.ok) {
            if (result.error.code === 'PROMPT_NOT_FOUND' || result.error.code === 'PROMPT_AMBIGUOUS' || result.error.code === 'PROMPT_UNSUPPORTED') throw new Error('PROMPT_NOT_FOUND');
            if (result.error.code === 'AGENT_BUSY') throw new Error('AGENT_BUSY');
            if (result.error.code === 'TURN_COMPACTED') throw new Error('TURN_COMPACTED');
            if (result.error.code === 'QUEUE_NOT_EMPTY') throw new Error('QUEUE_NOT_EMPTY');
            throw new Error('REGENERATE_FAILED');
          }
          if (alive.current) setPending(false);
        } catch (reason) {
          if (!alive.current) return;
          setPending(false);
          const code = reason instanceof Error ? reason.message : '';
          if (code === 'PROMPT_NOT_FOUND') setError(t('regenerate.prompt'));
          else if (code === 'AGENT_BUSY') setError(t('error.busy'));
          else if (code === 'TURN_COMPACTED') setError(t('error.compacted'));
          else if (code === 'QUEUE_NOT_EMPTY') setError(t('regenerate.queue'));
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
          }, pending ? react.createElement(primitives.IconLoadingOutline16, {}) : react.createElement(primitives.IconRefreshOutline16, {}))
        ),
        error !== null && react.createElement('span', { role: 'alert', title: error, style: turnsDelErrorStyle }, error)
      );
    }

    function EditRegenerateAction({ turn, text, editRegenerateTurn, useSession, t }) {
      const running = useSession((snapshot) => snapshot.running);
      const queued = useSession((snapshot) => snapshot.queue.length > 0);
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
      if (subagent !== null || typeof editRegenerateTurn !== 'function') return null;
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
          const result = await editRegenerateTurn(turn, operationId.current, draft);
          if (result.ok) {
            const deletion = result.value?.deletion;
            concealTurnsDelRangeGlobally(deletion?.turn, deletion?.endTurn);
          }
          if (!result.ok) {
            if (result.error.code === 'PROMPT_NOT_FOUND' || result.error.code === 'PROMPT_AMBIGUOUS' || result.error.code === 'PROMPT_UNSUPPORTED') throw new Error('PROMPT_NOT_FOUND');
            if (result.error.code === 'AGENT_BUSY') throw new Error('AGENT_BUSY');
            if (result.error.code === 'TURN_COMPACTED') throw new Error('TURN_COMPACTED');
            if (result.error.code === 'QUEUE_NOT_EMPTY') throw new Error('QUEUE_NOT_EMPTY');
            throw new Error('EDIT_REGENERATE_FAILED');
          }
          if (alive.current) {
            setPending(false);
            setOpen(false);
          }
        } catch (reason) {
          if (!alive.current) return;
          setPending(false);
          const code = reason instanceof Error ? reason.message : '';
          if (code === 'PROMPT_NOT_FOUND') setError(t('regenerate.prompt'));
          else if (code === 'AGENT_BUSY') setError(t('error.busy'));
          else if (code === 'TURN_COMPACTED') setError(t('error.compacted'));
          else if (code === 'QUEUE_NOT_EMPTY') setError(t('regenerate.queue'));
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
          }, pending ? react.createElement(primitives.IconLoadingOutline16, {}) : react.createElement(primitives.IconEditOutline16, {}))
        ),
        react.createElement(EditRegenerateDialog, { open, t, value: draft, error, busy: pending, onChange: setDraft, onCancel: close, onConfirm: () => void confirm() })
      );
    }

    function TurnsDelAction({ messageId, turn, delTurns, delTurn, useSession, t }) {
      const running = useSession((snapshot) => snapshot.running);
      const subagent = useSession((snapshot) => snapshot.subagent);
      const [open, setOpen] = react.useState(false);
      const [pending, setPending] = react.useState(false);
      const [error, setError] = react.useState(null);
      const alive = react.useRef(true);
      react.useEffect(() => {
        alive.current = true;
        return () => {
          alive.current = false;
        };
      }, []);
      if (subagent !== null) return null;
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
            concealTurnsDelRangeGlobally(result.value?.turn, result.value?.endTurn);
            setOpen(false);
            return;
          }
          if (result.error.code === 'AGENT_BUSY') setError(t('error.busy'));
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
          }, react.createElement(primitives.IconTrashOutline16, {}))
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
        || typeof event.surfaceOp !== 'object'
        || !Array.isArray(event.data?.content)
        || event.data.content.length !== 0) return undefined;
      const source = event.data.source;
      if (source?.kind !== 'plugin'
        || source?.plugin !== TURNS_DEL_PROVIDER
        || source?.form !== 'notice') return undefined;
      let meta = {};
      try {
        const parsed = JSON.parse(source.summary ?? '');
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

    function selectTurnsDelTurn(owner) {
      const data = owner.turn.data.get(TURNS_DEL_NS);
      return data?.hidden === true ? data : null;
    }

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

    function postTurnsDelTurn(sessionId, turn) {
      return postTurnsDelAction(TURNS_DEL_TURN_PATH, sessionId, undefined, { turn });
    }

    function postRegenerateTurns(sessionId, assistantMessageId, operationId) {
      return postTurnsDelAction(REGENERATE_PATH, sessionId, assistantMessageId, { operationId });
    }

    function postRegenerateTurn(sessionId, turn, operationId) {
      return postTurnsDelAction(REGENERATE_TURN_PATH, sessionId, undefined, { turn, operationId });
    }

    function postEditRegenerateTurn(sessionId, turn, operationId, text) {
      return postTurnsDelAction(EDIT_REGENERATE_TURN_PATH, sessionId, undefined, { turn, operationId, text });
    }

    function DistillTurnAction({ turn, messageId, distillTurn, useSession, t }) {
      const running = useSession((snapshot) => snapshot.running);
      const queued = useSession((snapshot) => snapshot.queue.length > 0);
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
      if (subagent !== null || typeof distillTurn !== 'function') return null;
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
          }, pending ? react.createElement(DistillHourglassIcon, {}) : done ? react.createElement(primitives.IconCheckOutline16, {}) : react.createElement(primitives.IconSparkle16, { size: 16 }))
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
      if (subagent !== null || typeof getTurnMemoryHits !== 'function') return null;
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
                react.createElement('span', { className: 'dsh-session-kit-turn-memory-panel-count' }, countText),
                react.createElement('button', {
                  type: 'button',
                  className: 'dsh-session-kit-turn-memory-search-toggle',
                  'aria-label': t('turnMemory.search'),
                  title: t('turnMemory.search'),
                  'aria-pressed': searchOpen,
                  onClick: () => setSearchOpen((value) => !value)
                }, react.createElement(primitives.IconSearchOutline16, { size: 14 }))
              )
            ),
            /* 搜索行默认收起；点击标题右侧图标后显示并聚焦，输入即筛选下方条目。 */
            searchOpen && !loading && error === null && react.createElement('div', { className: 'dsh-session-kit-turn-memory-search' },
              react.createElement('span', { className: 'dsh-session-kit-turn-memory-search-icon', 'aria-hidden': 'true' }, react.createElement(primitives.IconSearchOutline16, { size: 13 })),
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
              }, react.createElement(primitives.IconCloseOutline16, { size: 13 }))
            ),
            loading && react.createElement('div', { className: 'dsh-session-kit-turn-memory-muted' }, '…'),
            error !== null && react.createElement('div', { role: 'alert', className: 'dsh-session-kit-turn-memory-error' }, error),
            !loading && error === null && keyword !== '' && visibleMemories.length === 0 && react.createElement('div', { className: 'dsh-session-kit-turn-memory-muted' }, t('turnMemory.searchEmpty')),
            !loading && error === null && visibleMemories.map((memory) => react.createElement('div', {
              key: memory.id,
              className: 'dsh-session-kit-turn-memory-item'
            },
              react.createElement('div', { className: 'dsh-session-kit-memory-meta-row dsh-session-kit-turn-memory-item-meta-row' },
                react.createElement('span', { className: 'dsh-session-kit-memory-meta-value' }, memory.directoryName || t('memoryNoDirectory'))
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

    function FailedTurnActions({ matched, delTurn, regenerateTurn, distillTurn, useSession, t }) {
      const anchorRef = react.useRef(null);
      const [portalHost, setPortalHost] = react.useState(null);
      react.useLayoutEffect(() => {
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
      }, [matched.turn]);
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
        const value = await sidebarEntriesRequest('POST', { memoryVisible: next?.memoryVisible !== false, archiveVisible: next?.archiveVisible !== false });
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
          .nL4_yW_sessionLogButton,
          .pTsq1a_sessionLogButton,
          button[class*="sessionLogButton"] { display: none !important; }
          .uEy0Ta_slot,
          .uEy0Ta_rail,
          nav[aria-label="轮次导航"],
          nav[aria-label="Turn navigation"] { display: none !important; }
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
          


          html body[data-dsh-desktop-mode] [data-slot="sidebar.footer.action"] { display: unset !important; width: 100% !important; }
          [data-slot="sidebar.footer.action"] { display: unset !important; width: 100% !important; }
          .dsh-session-kit-sidebar-row { flex: none; align-items: center; gap: 8px; width: calc(100% + 4px); margin: 4px -2px; display: flex; }
          .dsh-session-kit-sidebar-rail-row { justify-content: center; width: 36px; margin: 8px 0 10px; }
          .dsh-session-kit-sidebar-trigger { box-sizing: border-box; cursor: pointer; width: auto; min-width: 0; height: 42px; color: var(--dsw-alias-label-primary); background: 0 0; border: none; border-radius: 12px; flex: 1; align-items: center; gap: 8px; margin: 0; padding: 0 10px 0 8px; font-family: inherit; font-size: 14px; line-height: 22px; display: flex; overflow: hidden; }
          .dsh-session-kit-sidebar-trigger:hover { background: var(--dsw-alias-interactive-bg-hover); }
          .dsh-session-kit-sidebar-trigger.dsh-session-kit-sidebar-rail { corner-shape: round; border-radius: 50%; flex: none; justify-content: center; gap: 0; width: 36px; height: 36px; margin: 0; padding: 0; }
          .dsh-session-kit-sidebar-label { white-space: nowrap; overflow: hidden; }
           .dsh-session-kit-memory-modal { width: min(1180px, calc(100vw - 32px)); box-sizing: border-box; }
          .dsh-session-kit-memory-modal [class*="header"] { position: relative; }
          .dsh-session-kit-modal-title { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
          .dsh-session-kit-modal-title-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .dsh-session-kit-entry-visibility-toggle { flex: none; max-width: min(42vw, 280px); gap: 6px; }
          .dsh-session-kit-entry-visibility-toggle > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .dsh-session-kit-modal-title-notice { position: absolute; left: 50%; top: 22px; width: 50%; max-width: 50%; min-height: 28px; box-sizing: border-box; margin: 0 !important; padding: 4px 10px !important; transform: translateX(-50%); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center; pointer-events: none; z-index: 1; }
          .dsh-session-kit-modal-title-notice + .dsh-session-kit-modal-title-notice { top: 54px; }
          .dsh-session-kit-memory-modal > [class*="content"] > [class*="body"] { margin-top: 0; }
          .dsh-session-kit-memory { display: flex; flex-direction: column; gap: 12px; height: min(74vh, 760px); max-height: min(74vh, 760px); overflow: hidden; padding-right: 0; color: var(--dsw-alias-label-primary); }
          .dsh-session-kit-memory-store-info { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
          .dsh-session-kit-memory-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; flex: none; }
          .dsh-session-kit-memory-top-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; align-items: center; min-width: 0; }
          .dsh-session-kit-memory-form-modal { width: min(550px, calc(100vw - 32px)); min-width: min(550px, calc(100vw - 32px)); box-sizing: border-box; }
          /* 覆盖 DSH Modal 内部间距，仅限本插件表单弹窗（结构固定：dialog > content > header, body） */
          .dsh-session-kit-memory-form-modal > div:first-child > div:first-child { padding-bottom: 0; }
          .dsh-session-kit-memory-form-modal > div:first-child > div:nth-child(2) { margin-top: 8px; }
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
          .dsh-session-kit-memory-donut-legend { display: flex; flex-direction: column; align-items: center; gap: 2px; width: 100%; }
          .dsh-session-kit-memory-donut-legend-active { color: var(--dsw-alias-state-success-primary, #12a150); font-size: 11px; line-height: 15px; font-variant-numeric: tabular-nums; }
          .dsh-session-kit-memory-donut-legend-inactive { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 15px; font-variant-numeric: tabular-nums; }
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
          .dsh-session-kit-memory-activity-summary-popup { position: fixed; z-index: 1500; box-sizing: border-box; overflow-y: auto; overscroll-behavior: contain; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-inverted); border-radius: 10px; background: var(--dsw-specific-menu); box-shadow: var(--dsw-shadow-lv3); color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 18px; white-space: pre-wrap; overflow-wrap: anywhere; }
          .dsh-session-kit-memory-activity-head-main { min-width: 0; display: inline-flex; align-items: center; gap: 2px; }
          .dsh-session-kit-memory-activity-head-main > strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .dsh-session-kit-memory-activity-copy { flex: none; width: 24px; min-width: 24px; height: 24px; padding: 0; border-radius: 6px; color: var(--dsw-alias-label-secondary); }
          .dsh-session-kit-memory-activity-copy:hover:not(:disabled) { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
          .dsh-session-kit-memory-activity-copy-copied { color: var(--dsw-alias-state-success-primary, #12a150); }
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
          /* 项目备注：最多两行，超出省略；全文通过原生 title 悬浮提示。 */
          .dsh-session-kit-memory-directory-remark { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; user-select: none; }
          .dsh-session-kit-memory-directory-copy { flex: none; width: 28px; min-width: 28px; height: 28px; padding: 0; border-radius: 8px; color: var(--dsw-alias-label-secondary); }
          .dsh-session-kit-memory-directory-copy:hover:not(:disabled) { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
          .dsh-session-kit-memory-directory-copy-copied { color: var(--dsw-alias-state-success-primary, #12a150); }
          .dsh-session-kit-memory-badge, .dsh-session-kit-memory-tag-chip { max-width: 220px; display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; padding: 2px 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .dsh-session-kit-memory-badge-active { border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #12a150) 44%, var(--dsw-alias-border-l2)); color: var(--dsw-alias-state-success-primary, #12a150); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #12a150) 9%, transparent); }
          .dsh-session-kit-memory-tag-list { display: flex; flex-wrap: wrap; gap: 6px; }
          .dsh-session-kit-memory-tag-list-panel { align-content: flex-start; gap: 8px; }
          .dsh-session-kit-memory-tag-list-panel .dsh-session-kit-memory-tag-chip { box-sizing: border-box; max-width: 420px; min-height: 32px; align-items: center; justify-content: center; gap: 0; font-size: 13px; line-height: 20px; padding: 0; }
          .dsh-session-kit-memory-tag-chip-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .dsh-session-kit-memory-tag-chip-inactive { opacity: .68; }
          .dsh-session-kit-memory-tag-toggle-button { max-width: 360px; min-height: 32px; height: 32px; gap: 6px; padding: 0 10px !important; border: 0 !important; border-radius: 999px 0 0 999px !important; background: transparent !important; box-shadow: none !important; }
          .dsh-session-kit-memory-tag-toggle-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover) !important; }
          .dsh-session-kit-memory-tag-delete-button { flex: none; width: 32px; min-width: 32px; height: 32px; min-height: 32px; padding: 0 !important; border: 0 !important; border-radius: 0 999px 999px 0 !important; background: transparent !important; box-shadow: none !important; }
          .dsh-session-kit-memory-tag-delete-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover) !important; }
          .dsh-session-kit-memory-tag-delete-button > svg { flex: none; display: block; }
          .dsh-session-kit-memory-tag-delete-button:hover { color: var(--dsw-alias-state-error-primary); }
          .dsh-session-kit-memory-mini-textarea { box-sizing: border-box; width: 100%; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; outline: none; min-height: 64px; max-height: 200px; resize: vertical; line-height: 1.5; padding: 8px 10px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--dsw-alias-label-caption) 48%, transparent) transparent; }
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
          .dsh-session-kit-memory-select-root { position: relative; display: inline-flex; width: 100%; min-width: 0; }
          .dsh-session-kit-memory-select-button { width: 100%; min-width: 0; height: 36px; min-height: 36px; justify-content: space-between; border-radius: 10px !important; }
          .dsh-session-kit-memory-select-label { min-width: 0; flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
          .dsh-session-kit-memory-select-chevron { flex: none; display: inline-flex; align-items: center; justify-content: center; transform: rotate(0deg); transition: transform 180ms ease; }
          .dsh-session-kit-memory-select-chevron-open { transform: rotate(180deg); }
          .dsh-session-kit-memory-select-panel { position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 1200; box-sizing: border-box; width: 100%; min-width: 0; max-height: 252px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; padding: 4px; border: 1px solid var(--dsw-alias-border-inverted); border-radius: 10px; background: var(--dsw-specific-menu); box-shadow: var(--dsw-shadow-lv3); }
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
          .dsh-session-kit-memory-meta-tags-row { align-items: flex-start; }
          .dsh-session-kit-memory-meta-tags { min-width: 0; flex: 1; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; }
          .dsh-session-kit-memory-meta-tags > span { overflow: visible; }
          .dsh-session-kit-memory-meta-tag-chip { display: inline-flex; align-items: center; max-width: 100%; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
          .dsh-session-kit-memory-meta-tags-empty { white-space: normal !important; }
          .dsh-session-kit-memory-meta-time-row { flex-wrap: wrap; }
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
          .dsh-session-kit-turn-memory-panel { position: fixed; z-index: 1400; box-sizing: border-box; width: 362px; max-width: calc(100vw - 32px); max-height: 320px; overflow: hidden; display: flex; flex-direction: column; padding: 10px 6px; border: 1px solid var(--dsw-alias-border-inverted); border-radius: 10px; background: var(--dsw-specific-menu); box-shadow: var(--dsw-shadow-lv3); }
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
          .dsh-session-kit-memory-editor { margin-bottom: 2px; background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 5%, var(--dsw-alias-bg-base)); }
          .dsh-session-kit-memory-editor-textarea { min-height: 140px; scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--dsw-alias-label-caption) 48%, transparent) transparent; }
          /* “记忆内容”标题与“美化格式”按钮同行：标题可压缩省略，按钮保持完整。 */
          .dsh-session-kit-memory-editor-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
          .dsh-session-kit-memory-editor-head > span, .dsh-session-kit-memory-editor-head > label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary); font-weight: 650; cursor: pointer; }
          .dsh-session-kit-memory-beautify-button { flex: none; gap: 6px; }
          .dsh-session-kit-memory-form-notice { padding: 5px 10px; border: 1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 42%, transparent); border-radius: 8px; background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 8%, transparent); color: var(--dsw-alias-state-business-primary); font-size: 12px; line-height: 17px; }
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
          .dsh-session-kit-archive-workdir-panel { box-sizing: border-box; position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 1100; width: 100%; min-width: 100%; max-width: 100%; display: flex; flex-direction: column; gap: 4px; padding: 6px; border: 1px solid var(--dsw-alias-border-inverted); border-radius: 12px; background: var(--dsw-specific-menu); box-shadow: var(--dsw-shadow-lv3); }
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
          .dsh-session-kit-archive-meta-icon { flex: none; display: inline-flex; align-items: center; justify-content: center; color: var(--dsw-alias-label-tertiary); }
          .dsh-session-kit-archive-meta-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .dsh-session-kit-archive-meta-status { flex: none; white-space: nowrap; }
          .dsh-session-kit-archive-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
          .dsh-session-kit-archive-error { color: var(--dsw-alias-state-error-primary); background: rgba(239, 68, 68, .1); border-radius: 10px; padding: 8px 10px; font-size: 13px; line-height: 1.5; }
          /* 归档弹窗的标题区提示比记忆弹窗窄：固定 38% 宽度 */
          .dsh-session-kit-archive-modal .dsh-session-kit-modal-title-notice { width: 38%; max-width: 38%; }
          .dsh-session-kit-stats { display: flex; flex-direction: column; gap: 12px; max-height: min(68vh, 520px); overflow: hidden; }
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
          .dsh-session-kit-preview-body { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: 12px; }
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

      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: 'session-log-download',
        priority: -1,
        order: -1000
      }, HiddenSessionLogDownloadHeaderAction));

      const sessionManagerFace = () => ({
        t: ctx.locale?.bind?.(NS) ?? ((key) => zh[key] ?? key),
        exporter,
        openSession: (id) => ctx.sessions.open(id),
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
        inject: (sessionId) => ({ delTurns: (assistantMessageId) => postTurnsDel(sessionId, assistantMessageId) })
      }, TurnsDelAction));

      ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
        name: 'conversation.chat.turnTail',
        select: selectTurnsDelTurn
      }, TurnsDelMarker));

      ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
        name: 'conversation.chat.turnTail',
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
          regenerateTurn: (turn, operationId) => postRegenerateTurn(sessionId, turn, operationId),
          editRegenerateTurn: (turn, operationId, text) => postEditRegenerateTurn(sessionId, turn, operationId, text),
          distillTurn: (turn) => {
            const modelSelection = getCurrentModelSelection(ctx, sessionId);
            return memoryPostAction(sessionId, { action: 'distill-turn', turn, ...(modelSelection ? { modelSelection } : {}) });
          },
          getTurnMemoryHits: ({ turn }) => memoryPostAction(sessionId, { action: 'turn-memory-hits', ...(Number.isSafeInteger(turn) ? { turn } : {}) }),
          hooks: { conversation: ctx.uiConversation.binding(sessionId).snapshot }
        })
      }, UserTurnActionsLayer));

      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: `${NS}-heading-nav`,
        order: 89,
        locale: NS,
        inject: (sessionId) => ({
          sessionId,
          t: ctx.locale?.bind?.(NS) ?? ((key) => zh[key] ?? key)
        })
      }, HeadingQuickNav));

      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: `${NS}-archive`,
        order: 2,
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
      }, TopicQuickNav));
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});



