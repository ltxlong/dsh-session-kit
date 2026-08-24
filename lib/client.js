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
    const ARCHIVE_PREVIEW_LIMIT = 30;
    const TURNS_DEL_PATH = '/dsh-turns-del';
    const TURNS_DEL_TURN_PATH = '/dsh-turns-del/turn';
    const REGENERATE_PATH = '/dsh-turns-del-regenerate';
    const REGENERATE_TURN_PATH = '/dsh-turns-del-regenerate/turn';
    const EDIT_REGENERATE_TURN_PATH = '/dsh-turns-del-edit-regenerate/turn';
    const TURNS_DEL_PROVIDER = 'dsh-turns-del';
    const TURNS_DEL_MODEL = 'tombstone';
    const NS = 'dsh-session-kit';
    const TURNS_DEL_NS = 'dsh-turns-del';
    const inject = ['slots', 'locale', 'conversationEvents', 'sessions', 'workspaces', 'connection'];

    const zh = {
      manage: '会话管理',
      folder: '打开目录',
      export: '导出会话',
      archive: '打开归档',
      stats: '统计调用',
      archiveSession: '归档会话',
      forkSession: '分叉会话',
      renameSession: '重新命名',
      delete: '删除会话',
      title: '使用系统文件管理器打开会话目录',
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
      archiveSearchEmpty: '没有匹配的归档会话',
      archiveEmpty: '暂无已归档会话',
      archiveLoading: '正在加载归档…',
      archiveRestore: '恢复',
      archiveView: '查看',
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
      topicJump: '跳转到话题'
    };
    const en = {
      manage: 'Session manager',
      folder: 'Open folder',
      export: 'Export session',
      archive: 'Open archive',
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
      archiveSearchEmpty: 'No archived sessions match your search',
      archiveEmpty: 'No archived sessions',
      archiveLoading: 'Loading archive…',
      archiveRestore: 'Restore',
      archiveView: 'View',
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
      topicJump: 'Jump to topic'
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
    function BranchIcon() {
      return react.createElement(primitives.IconBranchOutline16, { size: 16 });
    }
    function RenameIcon() {
      return react.createElement(primitives.IconEditOutline16, { size: 16 });
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
      if (!Number.isFinite(value) || value <= 0) return '';
      return new Date(value).toLocaleString();
    }

    function archivePreviewRole(t, role) {
      if (role === 'user') return t('archiveRoleUser');
      if (role === 'assistant') return t('archiveRoleAssistant');
      return t('archiveRoleTool');
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

    function ArchivePreviewDialog({ preview, t, onClose, onLoadMore }) {
      const data = preview.data;
      const item = preview.item;
      const messages = Array.isArray(data?.messages) ? data.messages : [];
      const toolCalls = normalizeToolCalls(data?.toolCalls);
      const toolTotal = toolCalls.reduce((sum, entry) => sum + entry.count, 0);
      const title = data?.title || item?.title || t('archivePreviewTitle');
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
            react.createElement('div', { className: 'dsh-session-kit-preview-meta', title: data?.cwd || item?.cwd || item?.sessionId || '' },
              [formatArchiveTime(data?.updatedAt || item?.updatedAt), data?.cwd || item?.cwd || item?.sessionId].filter(Boolean).join(' · ')
            ),
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
          preview.loading && react.createElement('div', { className: 'dsh-session-kit-archive-empty' }, t('archivePreviewLoading')),
          !preview.loading && preview.error && react.createElement('div', { role: 'alert', className: 'dsh-session-kit-archive-error' }, `${t('archivePreviewFailed')}: ${preview.error}`),
          !preview.loading && !preview.error && messages.length === 0 && react.createElement('div', { className: 'dsh-session-kit-archive-empty' }, t('archivePreviewEmpty')),
          !preview.loading && !preview.error && messages.length > 0 && react.createElement('div', { className: 'dsh-session-kit-preview-list' },
            messages.map((message) => react.createElement(
              'article',
              { key: `${message.role}-${message.seq}`, className: `dsh-session-kit-preview-message dsh-session-kit-preview-message-${message.role}` },
              react.createElement('div', { className: 'dsh-session-kit-preview-role' }, archivePreviewRole(t, message.role)),
              react.createElement('pre', { className: 'dsh-session-kit-preview-text' }, message.text)
            )),
            preview.hasMore && react.createElement('div', { className: 'dsh-session-kit-preview-more' },
              react.createElement(primitives.Button, { variant: 'outline', disabled: preview.loadingMore, onClick: onLoadMore }, preview.loadingMore ? t('archiveLoadingMore') : t('archiveLoadMore'))
            )
          )
        ),
        footer: react.createElement(primitives.Button, { variant: 'outline', disabled: preview.loading, onClick: onClose }, t('archiveClose'))
      });
    }

    function ArchivedSessionsDialog({ open, t, onClose, refreshWorkspaces, refreshSessions, api, openSession }) {
      const [items, setItems] = react.useState([]);
      const [loading, setLoading] = react.useState(false);
      const [busyId, setBusyId] = react.useState(null);
      const [error, setError] = react.useState(null);
      const [notice, setNotice] = react.useState(null);
      const [search, setSearch] = react.useState('');
      const debouncedSearch = useDebouncedValue(search, 160);
      const [preview, setPreview] = react.useState({ open: false, loading: false, loadingMore: false, item: null, data: null, error: null, hasMore: false, nextOffset: 0 });
      const [deleteTarget, setDeleteTarget] = react.useState(null);
      const alive = react.useRef(true);
      const noticeTimer = react.useRef(undefined);
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
      const refreshShell = react.useCallback(async () => {
        const tasks = [refreshWorkspaces, refreshSessions]
          .filter((fn) => typeof fn === 'function')
          .map((fn) => Promise.resolve().then(() => fn()).catch(() => undefined));
        await Promise.all(tasks);
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
          await refreshShell();
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
      const view = async (item) => {
        if (busyId !== null || item.missing) return;
        setBusyId(item.sessionId);
        setError(null);
        clearNotice();
        const previewItem = { ...item };
        setPreview({ open: true, loading: true, loadingMore: false, item: previewItem, data: null, error: null, hasMore: false, nextOffset: 0 });
        try {
          const data = await archiveRequest(ARCHIVE_PREVIEW_ROUTE, { sessionId: item.sessionId, offset: 0, limit: ARCHIVE_PREVIEW_LIMIT });
          if (alive.current) setPreview({ open: true, loading: false, loadingMore: false, item: previewItem, data, error: null, hasMore: data?.hasMore === true, nextOffset: Number.isSafeInteger(data?.nextOffset) ? data.nextOffset : 0 });
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : String(reason);
          if (alive.current) setPreview({ open: true, loading: false, loadingMore: false, item: previewItem, data: null, error: message, hasMore: false, nextOffset: 0 });
        } finally {
          if (alive.current) setBusyId(null);
        }
      };
      const loadMorePreview = async () => {
        if (preview.loading || preview.loadingMore || !preview.hasMore || preview.item === null) return;
        const item = preview.item;
        const offset = Number.isSafeInteger(preview.nextOffset) ? preview.nextOffset : 0;
        setPreview((current) => ({ ...current, loadingMore: true, error: null }));
        try {
          const data = await archiveRequest(ARCHIVE_PREVIEW_ROUTE, { sessionId: item.sessionId, offset, limit: ARCHIVE_PREVIEW_LIMIT });
          if (!alive.current) return;
          setPreview((current) => {
            const currentMessages = Array.isArray(current.data?.messages) ? current.data.messages : [];
            const nextMessages = Array.isArray(data?.messages) ? data.messages : [];
            return {
              ...current,
              loadingMore: false,
              data: { ...(current.data || data || {}), ...(data || {}), messages: [...currentMessages, ...nextMessages] },
              hasMore: data?.hasMore === true,
              nextOffset: Number.isSafeInteger(data?.nextOffset) ? data.nextOffset : offset,
              error: null
            };
          });
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : String(reason);
          if (alive.current) setPreview((current) => ({ ...current, loadingMore: false, error: message }));
        }
      };
      const closePreview = () => {
        if (!preview.loading && !preview.loadingMore) setPreview({ open: false, loading: false, loadingMore: false, item: null, data: null, error: null, hasMore: false, nextOffset: 0 });
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
        if (busyId !== null || item.missing || typeof api?.sessions?.fork !== 'function') return;
        setBusyId(item.sessionId);
        setError(null);
        clearNotice();
        try {
          const response = await api.sessions.fork({ sessionId: item.sessionId });
          if (!response.result.ok) throw new Error(response.result.error?.code ?? 'fork-failed');
          openSession?.(response.result.value.sessionId);
          onClose();
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : String(reason);
          if (alive.current) setError(`${t('archiveForkFailed')}: ${message}`);
        } finally {
          if (alive.current) setBusyId(null);
        }
      };
      const normalizedSearch = debouncedSearch.trim().toLocaleLowerCase();
      const filteredItems = react.useMemo(() => {
        if (normalizedSearch === '') return items;
        return items.filter((item) => String(item.title || item.sessionId).toLocaleLowerCase().includes(normalizedSearch));
      }, [items, normalizedSearch]);
      const countText = normalizedSearch === ''
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
            react.createElement('div', { className: 'dsh-session-kit-archive-search' },
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
            notice && react.createElement('div', { role: 'status', className: 'dsh-session-kit-archive-notice' }, notice),
            error && react.createElement('div', { role: 'alert', className: 'dsh-session-kit-archive-error' }, error),
            loading && react.createElement('div', { className: 'dsh-session-kit-archive-empty' }, t('archiveLoading')),
            !loading && items.length === 0 && react.createElement('div', { className: 'dsh-session-kit-archive-empty' }, t('archiveEmpty')),
            !loading && items.length > 0 && filteredItems.length === 0 && react.createElement('div', { className: 'dsh-session-kit-archive-empty' }, t('archiveSearchEmpty')),
            !loading && filteredItems.length > 0 && react.createElement('div', { className: 'dsh-session-kit-archive-list' }, filteredItems.map((item) => react.createElement(
              'div',
              { key: item.sessionId, className: 'dsh-session-kit-archive-row' },
              react.createElement('div', { className: 'dsh-session-kit-archive-main' },
                react.createElement('div', { className: 'dsh-session-kit-archive-title', title: item.title }, item.title || item.sessionId),
                react.createElement('div', { className: 'dsh-session-kit-archive-meta', title: item.cwd || item.sessionId },
                  `${formatArchiveTime(item.updatedAt)} · ${item.cwd || item.sessionId}`,
                  item.missing ? ` · ${t('archiveMissing')}` : '',
                  item.running ? ` · ${t('running')}` : ''
                )
              ),
              react.createElement('div', { className: 'dsh-session-kit-archive-actions' },
                react.createElement(primitives.Button, { variant: 'outline', size: 'sm', disabled: busyId !== null || item.missing || typeof api?.sessions?.fork !== 'function', onClick: () => void forkSession(item) }, t('archiveContinueNew')),
                react.createElement(primitives.Button, { variant: 'outline', size: 'sm', disabled: busyId !== null || item.missing, onClick: () => void act(ARCHIVE_RESTORE_ROUTE, item) }, t('archiveRestore')),
                react.createElement(primitives.Button, { variant: 'outline', size: 'sm', disabled: busyId !== null || item.missing, onClick: () => void view(item) }, t('archiveView')),
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
            )))
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
        react.createElement(ArchivePreviewDialog, { preview, t, onClose: closePreview, onLoadMore: () => void loadMorePreview() })
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

    function SessionManagerButton({ sessionId, useSession, t, exporter, api, openSession, refreshWorkspaces, refreshSessions, archiveCurrentSession, forkCurrentSession, renameCurrentSession, getSessionTitle }) {
      const state = useSession((value) => value);
      const running = state?.running === true;
      const [open, setOpen] = react.useState(false);
      const [busy, setBusy] = react.useState(false);
      const [error, setError] = react.useState(null);
      const [confirmOpen, setConfirmOpen] = react.useState(false);
      const [archiveOpen, setArchiveOpen] = react.useState(false);
      const [renameOpen, setRenameOpen] = react.useState(false);
      const [renameDraft, setRenameDraft] = react.useState('');
      const [renameError, setRenameError] = react.useState(null);
      const [statsOpen, setStatsOpen] = react.useState(false);
      const [statsLoading, setStatsLoading] = react.useState(false);
      const [statsData, setStatsData] = react.useState(null);
      const [statsError, setStatsError] = react.useState(null);
      const anchor = react.createElement(
        'span',
        { className: 'dsh-session-kit-menu-anchor' },
        react.createElement(
          primitives.Button,
          { variant: 'outline', size: 'sm', onClick: () => setOpen((value) => !value), 'aria-expanded': open },
          t('manage'),
          react.createElement(primitives.IconChevronDownOutline14, { size: 14 })
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
      const openRename = () => {
        if (busy || !sessionId || typeof renameCurrentSession !== 'function') return;
        setRenameDraft(getSessionTitle?.(sessionId) ?? '');
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
        if (busy || !sessionId || title === '' || typeof renameCurrentSession !== 'function') {
          if (title === '') setRenameError(t('renameEmpty'));
          return;
        }
        setBusy(true);
        setError(null);
        setRenameError(null);
        try {
          await renameCurrentSession(sessionId, title);
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
        else if (id === 'export') exporter?.download?.(sessionId);
        else if (id === 'delete') setConfirmOpen(true);
      };
      const items = [
        { id: 'delete', label: t('delete'), icon: react.createElement(DeleteIcon), danger: true, disabled: unavailable },
        { id: 'stats', label: t('stats'), icon: react.createElement(StatsIcon), disabled: busy || !sessionId },
        { id: 'rename-session', label: t('renameSession'), icon: react.createElement(RenameIcon), disabled: busy || !sessionId || typeof renameCurrentSession !== 'function' },
        { id: 'fork-session', label: t('forkSession'), icon: react.createElement(BranchIcon), disabled: busy || !sessionId || typeof forkCurrentSession !== 'function' },
        { id: 'archive-session', label: t('archiveSession'), icon: react.createElement(ArchiveIcon), disabled: unavailable || !sessionId || typeof archiveCurrentSession !== 'function' },
        { id: 'folder', label: t('folder'), icon: react.createElement(FolderIcon), disabled: unavailable },
        { id: 'export', label: t('export'), icon: react.createElement(ExportIcon), disabled: unavailable || !exporter?.download },
        { id: 'archive', label: t('archive'), icon: react.createElement(ArchiveIcon), disabled: busy }
      ];
      return react.createElement(
        react.Fragment,
        null,
        react.createElement(primitives.Menu, { open, anchor, items, onSelect: select, onClose: () => setOpen(false), portal: false, align: 'end', compact: true }),
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
          api,
          openSession
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

    function UserTurnActionsLayer({ useSession, sessionId, delTurn, regenerateTurn, editRegenerateTurn, t }) {
      const order = useSession((snapshot) => snapshot.chat.order, sameTopicKeys);
      const nodes = useSession((snapshot) => snapshot.chat.nodes);
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

    function TopicQuickNav({ useSession, t }) {
      const order = useSession((snapshot) => snapshot.chat.order, sameTopicKeys);
      const nodes = useSession((snapshot) => snapshot.chat.nodes);
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
      const panelListRef = react.useRef(null);
      const topicsRef = react.useRef(topics);
      const activeLockRef = react.useRef(undefined);
      topicsRef.current = topics;
      const topicSig = react.useMemo(() => topics.map((topic) => topic.key).join('\n'), [topics]);
      const updatePanelScrollbar = react.useCallback(() => {
        const list = panelListRef.current;
        if (!(list instanceof HTMLElement) || list.scrollHeight <= list.clientHeight + 1) {
          setPanelScrollbar((current) => current.visible === false ? current : { visible: false, top: 0, height: 0 });
          return;
        }
        const trackHeight = list.clientHeight - 18;
        const height = Math.max(24, Math.round(trackHeight * list.clientHeight / list.scrollHeight));
        const top = Math.round(9 + (trackHeight - height) * list.scrollTop / Math.max(1, list.scrollHeight - list.clientHeight));
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
        list.addEventListener('scroll', onScroll, { passive: true });
        let observer = null;
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(updatePanelScrollbar);
          observer.observe(list);
        }
        return () => {
          list.removeEventListener('scroll', onScroll);
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
      let api;
      try {
        exporter = ctx.get('sessionLogDownload');
      } catch {}
      try {
        api = ctx.get('connection')?.api;
      } catch {}

      ctx.effect(() => {
        const style = document.createElement('style');
        style.dataset.plugin = NS;
        style.textContent = `
          .nL4_yW_sessionLogButton { display: none !important; }
          .dsh-session-kit-menu-anchor ~ [role="menu"] [role="menuitem"] { height: 42px; min-height: 42px; display: flex; justify-content: center; align-items: center; gap: 8px; text-align: center; padding: 0 16px; }
          .dsh-session-kit-menu-anchor ~ [role="menu"] [role="menuitem"] > span { flex: 0 0 auto; width: auto; margin: 0; }
          .dsh-session-kit-menu-anchor ~ [role="menu"] [role="menuitem"] > span:first-child { display: inline-flex; align-items: center; justify-content: center; }
          .dsh-session-kit-confirm { width: min(520px, calc(100vw - 32px)); box-sizing: border-box; }
          .dsh-session-kit-rename-modal { width: min(480px, calc(100vw - 32px)); box-sizing: border-box; }
          .dsh-session-kit-edit-modal { width: min(760px, calc(100vw - 32px)); box-sizing: border-box; }
          .dsh-session-kit-rename, .dsh-session-kit-edit { display: flex; flex-direction: column; gap: 8px; }
          .dsh-session-kit-rename-input { box-sizing: border-box; width: 100%; height: 38px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; outline: none; padding: 0 12px; }
          .dsh-session-kit-edit-textarea { box-sizing: border-box; width: 100%; min-height: 180px; max-height: min(52vh, 420px); resize: vertical; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; line-height: 1.55; outline: none; padding: 12px; }
          .dsh-session-kit-rename-input:focus, .dsh-session-kit-edit-textarea:focus { border-color: var(--dsw-alias-state-business-primary); box-shadow: 0 0 0 2px rgba(77, 107, 254, .14); }
          .dsh-session-kit-rename-error { color: var(--dsw-alias-state-error-primary); font-size: 13px; line-height: 1.5; }
          .dsh-session-kit-archive-modal, .dsh-session-kit-preview-modal { width: min(900px, calc(100vw - 32px)); box-sizing: border-box; }
          .dsh-session-kit-stats-modal { width: min(450px, calc(100vw - 32px)); box-sizing: border-box; }
          .dsh-session-kit-archive { display: flex; flex-direction: column; gap: 12px; max-height: min(68vh, 640px); overflow: hidden; }
          .dsh-session-kit-archive-head { display: flex; align-items: flex-start; justify-content: flex-end; gap: 16px; padding-bottom: 2px; }
          .dsh-session-kit-archive-description { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.55; }
          .dsh-session-kit-archive-toolbar { display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex: none; margin-left: auto; }
          .dsh-session-kit-archive-count { color: var(--dsw-alias-label-tertiary); font-size: 12px; white-space: nowrap; }
          .dsh-session-kit-archive-search { position: relative; display: flex; align-items: center; }
          .dsh-session-kit-archive-search-input { box-sizing: border-box; width: 100%; height: 36px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; outline: none; padding: 0 38px 0 12px; }
          .dsh-session-kit-archive-search-input:focus { border-color: var(--dsw-alias-state-business-primary); box-shadow: 0 0 0 2px rgba(77, 107, 254, .14); }
          .dsh-session-kit-archive-search-input::placeholder { color: var(--dsw-alias-label-tertiary); }
          .dsh-session-kit-archive-search-clear { position: absolute; right: 8px; width: 24px; height: 24px; display: grid; place-items: center; border: 0; border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
          .dsh-session-kit-archive-search-clear:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
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
          .dsh-session-kit-archive-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary); font-size: 12px; }
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
          .dsh-session-kit-preview { display: flex; flex-direction: column; gap: 12px; max-height: min(72vh, 720px); overflow: hidden; }
          .dsh-session-kit-preview-head { display: flex; flex-direction: column; gap: 4px; padding-bottom: 4px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
          .dsh-session-kit-preview-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary); font-weight: 700; }
          .dsh-session-kit-preview-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary); font-size: 12px; }
          .dsh-session-kit-preview-tools { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
          .dsh-session-kit-preview-tools-label { color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 650; }
          .dsh-session-kit-preview-tools-empty { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
          .dsh-session-kit-preview-tool-list { display: flex; flex-wrap: wrap; gap: 6px; }
          .dsh-session-kit-preview-tool-chip { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); padding: 3px 8px; font-size: 12px; line-height: 18px; }
          .dsh-session-kit-preview-list { display: flex; flex-direction: column; gap: 12px; overflow: auto; padding-right: 2px; }
          .dsh-session-kit-preview-more { display: flex; justify-content: center; padding: 4px 0 2px; }
          .dsh-session-kit-preview-message { display: flex; flex-direction: column; gap: 6px; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-base); }
          .dsh-session-kit-preview-message-user { background: rgba(77, 107, 254, .08); }
          .dsh-session-kit-preview-message-assistant { background: var(--dsw-alias-interactive-bg-hover); }
          .dsh-session-kit-preview-role { color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 650; }
          .dsh-session-kit-preview-text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 1.65; }
          .dsh-session-kit-topic-nav-host { position: fixed; z-index: 18; width: 340px; pointer-events: none; box-sizing: border-box; display: flex; align-items: center; justify-content: flex-end; transform: translateY(-50%); }
          .dsh-session-kit-topic-nav { pointer-events: none; position: relative; width: 100%; display: flex; align-items: center; justify-content: flex-end; color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 18px; }
          .dsh-session-kit-topic-title { position: absolute; width: 1px; height: 1px; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; overflow: hidden; }
          .dsh-session-kit-topic-marker-list { pointer-events: auto; display: flex; flex-direction: column; align-items: flex-end; justify-content: center; gap: 3px; max-height: none; margin: 0; padding: 9px 13px 9px 6px; list-style: none; overflow: visible; }
          .dsh-session-kit-topic-marker-item { height: 30px; margin: 0; padding: 0; display: flex; align-items: center; justify-content: flex-end; }
          .dsh-session-kit-topic-marker { width: 9px; height: 2px; border-radius: 999px; background: var(--dsw-alias-label-caption); opacity: .48; transition: width 140ms ease, height 140ms ease, background-color 140ms ease, opacity 140ms ease; }
          .dsh-session-kit-topic-marker[data-active] { width: 12px; height: 3px; background: var(--dsw-alias-state-business-primary); opacity: .92; }
          .dsh-session-kit-topic-panel { position: absolute; top: 50%; right: -1px; width: 322px; max-height: 347px; box-sizing: border-box; opacity: 0; pointer-events: none; transform: translateY(-50%) translateX(8px) scale(.98); transform-origin: right center; transition: opacity 120ms ease, transform 140ms ease; }
          .dsh-session-kit-topic-nav-host[data-open] .dsh-session-kit-topic-panel { opacity: 1; pointer-events: auto; transform: translateY(-50%) translateX(0) scale(1); }
          .dsh-session-kit-topic-panel-list { box-sizing: border-box; width: 100%; max-height: 347px; display: flex; flex-direction: column; gap: 3px; margin: 0; padding: 6px 6px 6px 6px; list-style: none; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; scrollbar-width: none; border: 1px solid color-mix(in srgb, var(--dsw-alias-border-l2) 68%, transparent); border-radius: 14px; background: color-mix(in srgb, var(--dsw-alias-bg-base) 92%, transparent); box-shadow: 0 12px 32px rgba(0,0,0,.12); backdrop-filter: blur(10px); }
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
          .dsh-session-kit-topic-panel-marker[data-active] { width: 12px; height: 3px; background: var(--dsw-alias-state-business-primary); opacity: .95; }
          .dsh-session-kit-topic-panel-text { min-width: 0; flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .dsh-session-kit-topic-panel-button:hover, .dsh-session-kit-topic-panel-button:focus-visible { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
          .dsh-session-kit-topic-panel-button:hover .dsh-session-kit-topic-panel-marker:not([data-active]), .dsh-session-kit-topic-panel-button:focus-visible .dsh-session-kit-topic-panel-marker:not([data-active]) { background: var(--dsw-alias-label-primary); opacity: .95; }
          .dsh-session-kit-topic-panel-button:focus-visible { outline: 2px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 45%, transparent); outline-offset: 1px; }
          .dsh-session-kit-topic-panel-button[data-active] { color: var(--dsw-alias-label-primary); font-weight: 600; }
          .dsh-session-kit-topic-panel-button[data-active]:not(:hover):not(:focus-visible) { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 9%, transparent); }
          @media (max-width: 760px) { .dsh-session-kit-topic-nav-host { display: none; } }
          @media (max-width: 640px) {
            .dsh-session-kit-archive-head { flex-direction: column; }
            .dsh-session-kit-archive-toolbar { width: 100%; justify-content: space-between; }
            .dsh-session-kit-archive-row, .dsh-session-kit-stats-row { grid-template-columns: 1fr; }
            .dsh-session-kit-archive-actions, .dsh-session-kit-stats-values { justify-content: flex-start; }
            .dsh-session-kit-preview, .dsh-session-kit-stats { max-height: min(76vh, 720px); }
          }
        `;
        document.head.appendChild(style);
        return () => style.remove();
      }, `${NS}: styles`);

      ctx.conversationEvents.register(turnsDelDefinition);
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${NS}: dictionaries`);
      ctx.effect(() => ctx.locale.register(TURNS_DEL_NS, { zh: turnsDelZh, en: turnsDelEn }), `${TURNS_DEL_NS}: dictionaries`);

      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: NS,
        order: 90,
        locale: NS,
        inject: () => ({
          t: (key) => ctx.locale?.t?.(NS, key) ?? zh[key] ?? key,
          exporter,
          api,
          openSession: (id) => ctx.sessions.open(id),
          refreshWorkspaces: () => ctx.workspaces.refresh(),
          refreshSessions: () => ctx.sessions.refresh(),
          archiveCurrentSession: (id) => ctx.workspaces.archiveSession(id),
          forkCurrentSession: (id) => ctx.sessions.fork({ sessionId: id, increaseTitle: true }),
          renameCurrentSession: async (id, title) => {
            const session = ctx.sessions.binding(id)?.session;
            if (session === undefined) throw new Error(`unknown session "${id}"`);
            const result = await session.rename(title);
            if (!result.ok) throw new Error(result.error?.message || result.error?.code || 'rename-failed');
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
          editRegenerateTurn: (turn, operationId, text) => postEditRegenerateTurn(sessionId, turn, operationId, text)
        })
      }, UserTurnActionsLayer));

      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: `${NS}-topic-nav`,
        order: 91,
        locale: NS,
        inject: () => ({ t: (key) => ctx.locale?.t?.(NS, key) ?? zh[key] ?? key })
      }, TopicQuickNav));
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
