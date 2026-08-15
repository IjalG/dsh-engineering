/**
 * The `engineering-plugins` locale dictionaries for the group card.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title': '工程插件',
  'description': 'dsh-engineering 全家桶：工程能力插件的统一概览与管理入口。',
  'expand': '展开',
  'collapse': '收起',
  'member.beyond.name': '超越工作区',
  'member.beyond.description': '感知工作区之外的环境，确认制授权与会话级子工作区。',
  'member.status.running': '运行中',
  'member.status.missing': '未安装',
  'member.workspaces': '子工作区',
  'member.audit': '最近审计',
  'member.manage.hint': '管理入口：会话「会话信息」选项卡',
  'member.noData': '暂无数据',
  'member.nas.name': '工作台（dsh-nas）',
  'member.nas.description': '仿 OS 桌面：窗口系统、文件管理器、回收站、应用注册表。关闭后不再注入系统提示词与文件接口（省 token）。',
  'member.nas.status.running': '运行中',
  'member.nas.status.disabled': '已关闭',
  'member.nas.toggle.enable': '启用',
  'member.nas.toggle.disable': '关闭',
  'member.toggle.updating': '切换中…',
} satisfies Record<string, string>

/** Key union for this namespace. */
export type EngineeringPluginsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'title': 'Engineering Plugins',
  'description': 'dsh-engineering family: unified overview and entry points for engineering plugins.',
  'expand': 'Show plugins',
  'collapse': 'Hide plugins',
  'member.beyond.name': 'Beyond-workscope',
  'member.beyond.description': 'Perceive beyond the workspace; confirm-gated grants and session sub-workspaces.',
  'member.status.running': 'running',
  'member.status.missing': 'not installed',
  'member.workspaces': 'sub-workspaces',
  'member.audit': 'recent audit',
  'member.manage.hint': 'Manage in the session info tab of a conversation',
  'member.noData': 'no data',
  'member.nas.name': 'Workspace (dsh-nas)',
  'member.nas.description': 'OS-like desktop: window system, file manager, trash, app registry. Disabling stops the prompt section and file API (saves tokens).',
  'member.nas.status.running': 'running',
  'member.nas.status.disabled': 'disabled',
  'member.nas.toggle.enable': 'Enable',
  'member.nas.toggle.disable': 'Disable',
  'member.toggle.updating': 'Updating…',
} satisfies Record<EngineeringPluginsKey, string>
