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
    const GLOBAL_PROMPT_ROUTE = '/dsh-session-kit/global-prompt';
    const GLOBAL_PROMPT_MAX_TEXT_LENGTH = 200000;
    const ARCHIVE_PREVIEW_LIMIT = 30;
    const ARCHIVE_PREVIEW_TOC_PAGE_SIZE = 10;
    const ARCHIVE_PREVIEW_MESSAGE_PAGE_SIZE = 30;
    const ARCHIVE_PREVIEW_SEARCH_DEBOUNCE_MS = 350;
    const ARCHIVE_LIST_PAGE_SIZE = 50;
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
    const TURNS_DEL_MODEL = 'tombstone';
    const NS = 'dsh-session-kit';
    const TURNS_DEL_NS = 'dsh-turns-del';
    const inject = ['slots', 'locale', 'uiConversation', 'sessions', 'workspaces', 'remote', 'remote.session'];

    const zh = {
      manage: '会话管理',
      folder: '打开目录',
      export: '导出会话',
      archive: '打开归档',
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
      archivePage: '第 {current} / {total} 页',
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
      archivePage: 'Page {current} / {total}',
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
      'edit.failed': '编辑后重新生成失败，请重试。'
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
      'edit.failed': 'Could not edit and regenerate. Try again.'
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
    function ArchiveIcon() {
      return react.createElement(primitives.IconArchiveOutline20, { size: 16 });
    }
    function StatsIcon() {
      return react.createElement(primitives.IconDataOutline16, { size: 16 });
    }
    function CompactionIcon() {
      return react.createElement(primitives.IconSettingsOutline16, { size: 16 });
    }
    function GlobalPromptIcon() {
      return react.createElement(primitives.IconEditOutline16, { size: 16 });
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

    function formatArchiveTime(value) {
      const time = Number(value);
      if (!Number.isFinite(time) || time <= 0) return '';
      const date = new Date(time);
      if (!Number.isFinite(date.getTime())) return '';
      return date.toLocaleString();
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
      const NumberInput = ({ value, min, max, onChange }) => react.createElement('input', {
        className: 'dsh-session-kit-compaction-number',
        type: 'number',
        min,
        max,
        step: 1,
        value,
        disabled: !enabled,
        onChange: (event) => onChange(intValue(event.currentTarget.value, value, min, max))
      });
      const renderNumberField = (labelKey, helpKey, value, min, max, onChange, defaultValue) => react.createElement('div', { className: 'dsh-session-kit-compaction-field dsh-session-kit-compaction-field--row' },
        react.createElement('div', { className: 'dsh-session-kit-compaction-field-text' },
          react.createElement('span', null, t(labelKey)),
          react.createElement('p', null, t(helpKey).replace('{default}', String(defaultValue)))
        ),
        react.createElement(NumberInput, { value, min, max, onChange })
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
      const pendingScrollKeyRef = react.useRef(null);
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
      const scrollToMessage = (message) => {
        const scroll = () => {
          const target = Array.from(listRef.current?.querySelectorAll?.('[data-preview-message-key]') || []).find((node) => node.getAttribute('data-preview-message-key') === message.key);
          if (target instanceof HTMLElement) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
        };
        const targetPage = Number.isSafeInteger(message.matchIndex) ? Math.floor(message.matchIndex / ARCHIVE_PREVIEW_MESSAGE_PAGE_SIZE) : Math.floor(Math.max(0, (message.messageIndex ?? message.displayIndex - 1)) / ARCHIVE_PREVIEW_MESSAGE_PAGE_SIZE);
        const clearSearch = search.trim() !== '' && !Number.isSafeInteger(message.matchIndex);
        if (clearSearch) {
          submittedSearchRef.current = '';
          serverSearchRef.current = '';
          setSearch('');
        }
        if (targetPage !== messagePage || clearSearch) {
          pendingScrollKeyRef.current = message.key;
          onMessagePage?.(targetPage, clearSearch ? '' : undefined);
          return;
        }
        scroll();
      };
      react.useEffect(() => {
        const key = pendingScrollKeyRef.current;
        if (key === null) return;
        const target = Array.from(listRef.current?.querySelectorAll?.('[data-preview-message-key]') || []).find((node) => node.getAttribute('data-preview-message-key') === key);
        if (target instanceof HTMLElement) {
          pendingScrollKeyRef.current = null;
          target.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }
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
            react.createElement('div', { className: 'dsh-session-kit-preview-attrs' }, attrs.map((attr) => react.createElement(
              'div',
              { key: attr.key, className: 'dsh-session-kit-preview-attr-card', title: attr.value },
              react.createElement('div', { className: 'dsh-session-kit-preview-attr-label' }, attr.label),
              react.createElement('div', { className: 'dsh-session-kit-preview-attr-value' }, attr.value)
            ))),
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
              react.createElement('div', { className: 'dsh-session-kit-preview-toc-list' }, indexedUserMessages.map(renderTocItem)),
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

    function ArchivedSessionsDialog({ open, t, onClose, refreshWorkspaces, refreshSessions, openSession, exporter, renameCurrentSession, forkCurrentSession }) {
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
          open: open && !preview.open && deleteTarget === null,
          onClose: close,
          title: t('archiveTitle'),
          closeLabel: t('archiveClose'),
          className: 'dsh-session-kit-archive-modal',
          children: react.createElement(
            'div',
            { className: 'dsh-session-kit-archive' },
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
            notice && react.createElement('div', { role: 'status', className: 'dsh-session-kit-archive-notice' }, notice),
            error && react.createElement('div', { role: 'alert', className: 'dsh-session-kit-archive-error' }, error),
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
              archivePageCount > 1 && react.createElement('div', { className: 'dsh-session-kit-archive-pager' },
                react.createElement(primitives.Button, { variant: 'outline', size: 'sm', disabled: busyId !== null || archiveCurrentPage <= 0, onClick: () => setArchivePage((value) => Math.max(0, value - 1)), 'aria-label': t('archivePreviewPrev') }, '‹'),
                react.createElement('span', { className: 'dsh-session-kit-archive-page-text' }, t('archivePage').replace('{current}', String(archiveCurrentPage + 1)).replace('{total}', String(archivePageCount))),
                react.createElement(primitives.Button, { variant: 'outline', size: 'sm', disabled: busyId !== null || archiveCurrentPage >= archivePageCount - 1, onClick: () => setArchivePage((value) => Math.min(archivePageCount - 1, value + 1)), 'aria-label': t('archivePreviewNext') }, '›')
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

    function SessionManagerButton({ sessionId, useSession, t, exporter, openSession, refreshWorkspaces, refreshSessions, archiveCurrentSession, forkCurrentSession, renameCurrentSession, getSessionTitle }) {
      const state = useSession((value) => value);
      const running = state?.running === true;
      const [open, setOpen] = react.useState(false);
      const [busy, setBusy] = react.useState(false);
      const [error, setError] = react.useState(null);
      const [confirmOpen, setConfirmOpen] = react.useState(false);
      const [archiveOpen, setArchiveOpen] = react.useState(false);
      const [globalPromptOpen, setGlobalPromptOpen] = react.useState(false);
      const [compactionOpen, setCompactionOpen] = react.useState(false);
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
        if (id === 'compaction-config') {
          if (!busy) setCompactionOpen(true);
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
        { id: 'stats', label: t('stats'), icon: react.createElement(StatsIcon), disabled: busy || !sessionId },
        { id: 'rename-session', label: t('renameSession'), icon: react.createElement(RenameIcon), disabled: busy || !sessionId || typeof renameCurrentSession !== 'function' },
        { id: 'fork-session', label: t('forkSession'), icon: react.createElement(BranchIcon), disabled: busy || !sessionId || typeof forkCurrentSession !== 'function' },
        { id: 'archive-session', label: t('archiveSession'), icon: react.createElement(ArchiveIcon), disabled: unavailable || !sessionId || typeof archiveCurrentSession !== 'function' },
        { id: 'folder', label: t('folder'), icon: react.createElement(FolderIcon), disabled: unavailable },
        { id: 'export', label: t('export'), icon: react.createElement(ExportIcon), disabled: unavailable || !exporter?.download },
        { id: 'global-prompt', label: t('globalPrompt'), icon: react.createElement(GlobalPromptIcon), disabled: busy },
        { id: 'compaction-config', label: t('compactionConfig'), icon: react.createElement(CompactionIcon), disabled: busy },
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
          forkCurrentSession
        }),
        react.createElement(GlobalPromptDialog, {
          open: globalPromptOpen,
          t,
          onClose: () => setGlobalPromptOpen(false)
        }),
        react.createElement(CompactionConfigDialog, {
          open: compactionOpen,
          t,
          sessionId,
          onClose: () => setCompactionOpen(false)
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

    function topicContentText(content) {
      if (!Array.isArray(content)) return '';
      return content.map((block) => block?.type === 'text' && typeof block.text === 'string' ? block.text : '').join('');
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

    function UserTurnActionsLayer({ useSession, useConversation, useChat, sessionId, delTurn, regenerateTurn, editRegenerateTurn, t }) {
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
        if (typeof document === 'undefined' || !sessionId || typeof delTurn !== 'function' || typeof regenerateTurn !== 'function' || typeof editRegenerateTurn !== 'function') return;
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
      }, [targetSig, sessionId, delTurn, regenerateTurn, editRegenerateTurn]);
      if (portalTargets.length === 0) return null;
      return react.createElement(
        react.Fragment,
        null,
        portalTargets.map((target) => reactDom.createPortal(react.createElement(
          react.Fragment,
          null,
          react.createElement(EditRegenerateAction, { turn: target.turn, text: target.text, editRegenerateTurn, useSession, t }),
          react.createElement(RegenerateAction, { turn: target.turn, regenerateTurn, useSession, t }),
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
      const panelListRef = react.useRef(null);
      const topicsRef = react.useRef(topics);
      const activeLockRef = react.useRef(undefined);
      const loadOlderTriggerRef = react.useRef(0);
      const loadOlderInFlightRef = react.useRef(false);
      const loadOlderReleaseTimerRef = react.useRef(0);
      const wheelEndTimerRef = react.useRef(0);
      topicsRef.current = topics;
      const topicSig = react.useMemo(() => topics.map((topic) => topic.key).join('\n'), [topics]);
      react.useEffect(() => {
        if (!loadingOlder) return;
        loadOlderInFlightRef.current = true;
      }, [loadingOlder]);
      react.useEffect(() => () => {
        window.clearTimeout(loadOlderReleaseTimerRef.current);
        window.clearTimeout(wheelEndTimerRef.current);
      }, []);
      const triggerLoadOlder = react.useCallback(() => {
        if (!hasMore || loadingOlder || loadOlderInFlightRef.current || typeof loadOlder !== 'function') return;
        const now = performance.now();
        if (loadOlderTriggerRef.current > now) return;
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
            }, 300);
          });
      }, [hasMore, loadingOlder, loadOlder]);
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
      if (event.type !== 'assistant/message'
        || typeof event.surfaceOp !== 'object'
        || event.data.message.content.length !== 0
        || event.data.message.source.provider !== TURNS_DEL_PROVIDER
        || event.data.message.source.model !== TURNS_DEL_MODEL
        || !Number.isSafeInteger(event.data.turn)
        || event.data.turn < 0) return undefined;
      const endTurn = event.data.endTurn ?? event.data.turn;
      if (!Number.isSafeInteger(endTurn) || endTurn < event.data.turn) return undefined;
      return { startTurn: event.data.turn, endTurn };
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

    function FailedTurnActions({ matched, delTurn, regenerateTurn, useSession, t }) {
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
          .dsh-session-kit-archive-search-clear { position: absolute; right: 8px; width: 24px; height: 24px; display: grid; place-items: center; border: 0; border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
          .dsh-session-kit-archive-search-clear:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
          .dsh-session-kit-archive-list { display: flex; flex: 1 1 auto; min-height: 0; flex-direction: column; gap: 10px; overflow-y: auto; overflow-x: hidden; padding-right: 8px; scrollbar-gutter: stable; }
          .dsh-session-kit-archive-pager { flex: none; display: flex; align-items: center; justify-content: center; gap: 8px; padding-top: 2px; }
          .dsh-session-kit-archive-page-text { min-width: 76px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; text-align: center; white-space: nowrap; }
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
          .dsh-session-kit-archive-notice { color: var(--dsw-alias-label-primary); background: rgba(34, 197, 94, .12); border-radius: 10px; padding: 8px 10px; font-size: 13px; line-height: 1.5; }
          .dsh-session-kit-archive-error { color: var(--dsw-alias-state-error-primary); background: rgba(239, 68, 68, .1); border-radius: 10px; padding: 8px 10px; font-size: 13px; line-height: 1.5; }
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
          .dsh-session-kit-preview-attr-card { min-width: 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-base); padding: 9px 10px; display: flex; flex-direction: column; gap: 4px; }
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
          .dsh-session-kit-preview-search-clear { position: absolute; right: 8px; width: 24px; height: 24px; display: grid; place-items: center; border: 0; border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
          .dsh-session-kit-preview-search-clear:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
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
          .dsh-session-kit-topic-marker[data-active] { width: 9px; height: 3px; background: var(--dsw-alias-state-business-primary); opacity: .92; }
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
          .dsh-session-kit-topic-panel-marker[data-active] { width: 9px; height: 3px; background: var(--dsw-alias-state-business-primary); opacity: .95; }
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

      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: NS,
        order: 90,
        locale: NS,
        inject: () => ({
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
          getSessionTitle: (id) => ctx.sessions.list.getSnapshot().byId[id]?.displayTitle ?? ''
        })
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
          regenerateTurn: (turn, operationId) => postRegenerateTurn(sessionId, turn, operationId)
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



