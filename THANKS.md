# 致谢 / Thanks

dsh-engineering（dsh-nas 办公桌面系统与 dsh-office / dsh-mail 应用）站在众多优秀
开源项目的肩膀上。没有它们，这个项目不可能达到现在的完成度。向每一位作者与
贡献者致谢：

## 办公引擎与文档处理

| 项目 | 用途 | 协议 |
|---|---|---|
| [Univer](https://github.com/dream-num/univer)（dream-num 团队） | 在线表格引擎：dsh-office 表格应用的全部 UI 与公式/格式/筛选能力，均基于 Univer 构建 | Apache-2.0 |
| [HyperFormula](https://github.com/handsontable/hyperformula)（Handsontable） | 表格公式计算引擎（服务端校验/计算，与 Univer 引擎互补） | GPL-3.0（含商业授权选项） |
| [TipTap](https://github.com/ueberdosis/tiptap) | Word 富文本编辑器内核 | MIT |
| [docx](https://github.com/dolanmiu/docx)（Dolan Miu） | Word 文档读写（生成/合并/拆分/盖章/分页） | MIT |
| [mammoth.js](https://github.com/mwilliamson/mammoth.js)（Michael Williamson） | docx 转 HTML（Word 打开渲染） | BSD-2-Clause |
| [ExcelJS](https://github.com/exceljs/exceljs) | xlsx 读写桥接（与 Univer 之间的文件 I/O） | MIT |
| [PptxGenJS](https://github.com/gitbrent/PptxGenJS)（Brent Ely） | PPT 生成与导出 | MIT |
| [pdf-lib](https://github.com/Hopding/pdf-lib)（Andrew Dillon） | PDF 生成/合并/拆分/提取（含中文子集嵌入） | MIT |
| [pdf-lib/fontkit](https://github.com/foliojs/fontkit) | PDF 字体嵌入 | MIT |
| [pdfjs-dist](https://github.com/mozilla/pdf.js)（Mozilla） | PDF 阅读器渲染 | Apache-2.0 |
| [jszip](https://github.com/Stuk/jszip)（Stuart Knightley） | ZIP/xlsx 底层处理 | MIT/GPL-3.0（双许可） |

## 通信与后端

| 项目 | 用途 | 协议 |
|---|---|---|
| [Nodemailer](https://github.com/nodemailer/nodemailer)（Andris Reinman） | SMTP 邮件发送 | MIT |
| [imapflow](https://github.com/postalsys/imapflow)（Postal Systems） | IMAP 收件/搜索/附件 | MIT |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | 本地持久化数据库 | MIT |
| [mailsplit](https://github.com/andris9/mailsplit) | MIME 解析 | MIT |

## 工程基础

| 项目 | 用途 | 协议 |
|---|---|---|
| [React](https://github.com/facebook/react)（Meta） | UI 框架 | MIT |
| [Cordis](https://github.com/cordiverse/cordis)（Shigma） | 插件化运行时（本工程的一切皆插件基础） | MIT |
| [TypeScript](https://github.com/microsoft/TypeScript)（Microsoft） | 类型系统 | Apache-2.0 |
| [tsdown](https://github.com/rolldown/tsdown) | 构建工具 | MIT |

## 说明

- 部分项目（如 HyperFormula）采用 GPL-3.0 等传染性协议，仅在遵循其协议的前提下
  使用；如需商用请购买相应商业授权或替换实现。
- 本致谢列表随依赖变化持续维护，欢迎补充遗漏。
