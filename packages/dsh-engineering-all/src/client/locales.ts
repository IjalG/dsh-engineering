/**
 * The `engineering-plugins` locale dictionaries for the group card.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title': '工程插件',
  'description': 'dsh-engineering 全家桶：工程能力插件的统一概览与管理入口。',
  'expand': '展开',
  'collapse': '收起',
  'empty': '本家族暂无可用插件。',
  'hiddenByWebUi': 'beyond-workscope 已由 dsh-web-ui 全家桶统一管理，此处不重复展示。',
  'member.beyond.name': '超越工作区',
  'member.beyond.description': '感知工作区之外的环境，确认制授权与会话级子工作区。',
  'member.status.running': '运行中',
  'member.status.missing': '未安装',
  'member.workspaces': '子工作区',
  'member.audit': '最近审计',
  'member.manage.hint': '管理入口：会话「会话信息」选项卡',
  'member.noData': '暂无数据',
} satisfies Record<string, string>

/** Key union for this namespace. */
export type EngineeringPluginsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'title': 'Engineering Plugins',
  'description': 'dsh-engineering family: unified overview and entry points for engineering plugins.',
  'expand': 'Show plugins',
  'collapse': 'Hide plugins',
  'empty': 'No engineering family plugins available.',
  'hiddenByWebUi': 'beyond-workscope is managed by the dsh-web-ui family and is not duplicated here.',
  'member.beyond.name': 'Beyond-workscope',
  'member.beyond.description': 'Perceive beyond the workspace; confirm-gated grants and session sub-workspaces.',
  'member.status.running': 'running',
  'member.status.missing': 'not installed',
  'member.workspaces': 'sub-workspaces',
  'member.audit': 'recent audit',
  'member.manage.hint': 'Manage in the session info tab of a conversation',
  'member.noData': 'no data',
} satisfies Record<EngineeringPluginsKey, string>
