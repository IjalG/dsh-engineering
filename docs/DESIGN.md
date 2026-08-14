# dsh-nas 设计文档（dsh-engineering 工程能力全家桶 · NAS 桌面系统）

> 状态：设计定稿，开发中（M1 进行中）
> 更新：2026-08-14

## 1. 定位与理念

dsh-nas 是 DSH Web GUI 内的一套「网页仿操作系统」办公工作台：侧边栏入口，默认嵌在
侧边栏中使用，可一键放大为全屏桌面（图标桌面 + 可拖拽窗口 + 任务栏）。根目录即会话
工作区，用户与 agent 在其中协同编辑办公文件。

一切皆插件（参考 deepseek-harness 的插件化理念）：**dsh-nas 是系统，其余办公能力是
软件**。系统提供桌面、窗口、文件管理、应用注册表与系统级服务；文档、邮箱等以独立
插件包注册为桌面应用。只装系统能跑（缺软件时优雅降级），按需安装软件，未来新增
能力都是新软件包，不侵入系统。

## 2. 包架构

| 包 | 角色 | 内容 |
|---|---|---|
| `dsh-nas` | 系统 | 桌面环境（内嵌/全屏两态）、窗口系统、任务栏、桌面图标、文件管理器、回收站、设置应用、应用注册表（host service + client slot）、全文检索、计划任务与通知 |
| `dsh-office` | 软件 | 文档四件套应用：Word（TipTap 富文本）、Excel（自研网格）、PPT（画布编辑器）、PDF（阅读/合并/拆分/提取）；OCR 扫描识别（视觉模型独立配置） |
| `dsh-mail` | 软件 | 邮箱应用：IMAP 收件/搜索/附件保存 + SMTP 草稿/发送（审批 + 幂等账本）；先 mock 后接真 |
| `dsh-engineering-all` | 聚合 | 全家桶聚合包 + 管理面板（已有） |

依赖方向：软件包 -> dsh-nas（应用注册协议），dsh-nas 不依赖任何软件包。

## 3. 应用注册协议（系统/软件契约）

host 侧（dsh-nas 提供 `nas.apps` service）：
- `ctx.apps.register({ id, name, icon, fileExts, windowKind, version })`
- 软件包 apply 时注册；卸载/停用自动移除

client 侧（dsh-nas 声明 slots，软件包注入）：
- `nas.app.meta`（list，root）：应用元数据（名称/图标/描述）→ 桌面图标与任务栏渲染
- `nas.app.window`（keyed，root）：key = windowKind → 窗口内容渲染器
- `nas.app.command`（list，root，可选）：应用级动作（如 office 的「新建文档」右键菜单）

文件路由：双击文件 → 按扩展名查 host 注册表 → 打开对应 windowKind 窗口；无匹配 →
「未安装可处理此格式的软件」提示（附建议安装的包名）。

## 4. 桌面系统设计（dsh-nas）

### 4.1 两态布局

- **内嵌态**：桌面渲染在侧边栏区域内（窄卡片布局）：顶部应用图标行/网格、底部「放大」
  按钮；文件管理器以紧凑列表呈现。窗口在侧栏内层叠（简化标题栏）。
- **全屏态**：点「放大」→ 全屏桌面（fixed 覆盖，经 `shell.overlay` 或独立 fixed 层）：
  桌面图标网格、可拖拽/缩放/最大化窗口、任务栏（运行中窗口 + 应用启动器 + 时钟）。
- 两态共享同一窗口状态模型（useNasStore），仅布局与交互密度不同；切换不丢状态。
- 交互规范：键盘可达（Esc 退出全屏、窗口焦点闭环、图标方向键导航）、移动端 390px
  触控目标、两态尺寸自适应（内嵌 ~280-380px，全屏任意）。

### 4.2 窗口系统

- 自研轻量 React 窗口管理器：WindowProvider（z 序、焦点、位置/尺寸、最小化/最大化/关闭）
- 窗口类型：文件窗口（按扩展名路由到软件渲染器）、系统窗口（文件管理器/回收站/设置/搜索/计划任务）
- 最小化进任务栏；窗口关闭前有未保存编辑时确认

### 4.3 桌面图标与任务栏

- 图标：我的文件、回收站、搜索、计划任务、设置 + 已注册软件（office/邮箱…）
- 任务栏（全屏态）：开始/应用启动器、运行中窗口、系统托盘（通知角标）

### 4.4 文件管理器（系统核心应用）

- 双栏/列表视图：目录树 + 文件列表；面包屑；按名称/类型/修改时间排序
- 操作：新建文件/文件夹、重命名、移动、复制、删除（进回收站）、上传下载
- 全部操作走审计与可回滚（复用 beyond-workscope 的授权/回滚体系：根目录 = 会话工作区）
- 预览：文本/图片/PDF 内联预览；Office 文件预览由对应软件提供（未装软件时提示）

### 4.5 回收站

- 删除 = 移入回收站（`.nas/trash/`，可恢复）；清空回收站 = 不可逆删除（二次确认 + 审计）

### 4.6 系统级服务（内置于 dsh-nas）

- **全文检索**：better-sqlite3 FTS5 + 中文分词，索引工作区文本/Office/PDF/邮件（邮件由
  dsh-mail 写入索引）；搜索窗口 + 文件管理器内搜索
- **计划任务 + 通知**：host 端 node-cron；任务（定时执行 agent 动作/命令/通知）；
  Webhook 通知（幂等键 + 指数退避 + 状态机，对齐 OAgent 通知设计）
- **设置应用**：NAS 偏好（主题跟随 DSH、桌面图标布局持久化、语言）、软件包管理
  （已装/未装/推荐）
- **凭据/配置存储**：`~/.dsh/dsh-nas.json`（0600）；软件凭据（邮箱 SMTP/IMAP、OCR 视觉
  端点）由各软件存 `~/.dsh/dsh-<pkg>.json`（0600），不落库不进记忆

## 5. 软件能力映射（对齐 OAgent 办公功能）

OAgent（`~/桌面/codes/agent/1`）办公能力 → dsh 软件包映射：

| OAgent 能力 | 落点 | 技术选型 |
|---|---|---|
| Word 创建/检查/编辑 | dsh-office | TipTap（富文本）+ docx 库（导出）+ mammoth（导入） |
| Excel 读写/公式保留 | dsh-office | exceljs（读写）+ 自研网格编辑器 |
| PPT 创建/逐页预览 | dsh-office | pptxgenjs（生成）+ 画布幻灯片编辑器（自研） |
| PDF 提取/合并/拆分 | dsh-office | pdf-lib（合并/拆分）+ pdfjs-dist（渲染） |
| Office→PDF 转换 | dsh-office | LibreOffice headless（本机已装，缺时报错） |
| 邮件收/发 | dsh-mail | nodemailer（SMTP）+ imapflow（IMAP）；mock 先行 |
| OCR 扫描识别 | dsh-office | 插件独立配置 OpenAI 兼容视觉端点；untrusted + 审批 |
| 全文检索 | dsh-nas | better-sqlite3 FTS5 + 中文分词 |
| 定时任务 | dsh-nas | node-cron（host） |
| 通知/Webhook | dsh-nas | 幂等账本 + 指数退避 |
| 文件管理/工作区 | dsh-nas | beyond-workscope 体系 |
| 高风险幂等账本 | dsh-nas/软件 | SQLite 状态机 running/succeeded/failed/uncertain |
| 工具安全边界 | 全局 | 危险操作走确认卡片审批（复用现有审批流） |

## 6. 用户与 agent 协同

- **v1 审阅流**：agent 编辑文件 → 生成变更记录（快照 diff）→ 桌面通知 + 文件窗口内
  diff 视图 → 用户接受/拒绝/手改 → 接受才落盘；全程审计，可回滚
- **v2 实时并发**：CRDT（预留：文件版本号 + 变更日志，架构上不堵路）

## 7. 数据与安全

- 文件数据：会话工作区；隐藏系统目录 `.nas/`（回收站/索引/审计）
- 配置/凭据：`~/.dsh/dsh-nas.json` / `dsh-office.json` / `dsh-mail.json`（0600，不入库）
- 危险操作（删除、发邮件、外发 OCR、Webhook）：确认卡片审批 + 幂等账本
- 邮件正文/OCR 结果标记 untrusted，不得作为指令来源或直接进长期记忆

## 8. 技术选型汇总

- host：Node 22 + Cordis service；better-sqlite3、node-cron、nodemailer、imapflow、
  docx、exceljs、pptxgenjs、pdf-lib、mammoth、pdfjs-dist（按包拆分）
- client：React 18 + TipTap + 自研窗口管理器/网格/画布；官方 SDK（@deepseek-ai/* rc.6，
  @linxin666 聚合）；shared/tsdown.client.ts 构建预设；无 emoji；中文 locale
- 检索：SQLite FTS5 + 中文分词器

## 9. 里程碑

- **M1 系统骨架（dsh-nas）**：包脚手架、应用注册协议、内嵌+全屏两态桌面、窗口系统、
  文件管理器、回收站、设置应用、审计与回滚接入
- **M2 系统服务**：全文检索、计划任务 + 通知、桌面图标/任务栏完善
- **M3 软件·dsh-office**：四件套预览与编辑、Office→PDF、OCR
- **M4 软件·dsh-mail**：IMAP 收件/搜索/附件 + SMTP 草稿/发送（mock → 真实）
- **M5 协同与打磨**：agent 审阅流（diff/接受/拒绝）、移动端适配、性能与无障碍

## 10. 验收基线

- 每包 typecheck + 单测；构建用 shared/tsdown.client.ts；无 emoji 检查
- 内嵌态 390px 无横向溢出；全屏态窗口拖拽/缩放/层叠可用；键盘可达
- 只装 dsh-nas：桌面/文件/回收站/搜索/定时全可用，双击 Office 文件提示缺软件
- 装 dsh-office/dsh-mail 后：应用图标出现、双击路由正确、编辑-保存-重开闭环
- 危险操作全部走审批；删除可恢复；审计可查
