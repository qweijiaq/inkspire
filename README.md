# Inkspire · 用墨点燃灵感的地方

> 依据本目录 17 份产品、设计与工程文档实现的 **本地优先 Markdown 知识工作台**。
> 产品名 Inkspire，IP 角色「墨墨 Momo」。

实现进度与文档差距记录保存在本地，不随仓库提交。

## 初始文档

新安装会在 vault 里生成并且只依赖这三篇：

- **[项目介绍](./docs/initial/项目介绍.md)**：定位、四根支柱、技术架构、当前状态
- **[项目使用](./docs/initial/项目使用.md)**：安装、界面、快捷键、数据位置、排障
- **[Markdown 支持](./docs/initial/Markdown%20支持.md)**：支持哪些语法、每种语法的实际样式

每次修复或功能提交前必须同步这三篇，并运行 `npm run docs:check`；`npm run build` 会先自动执行该检查。

当前包含两个运行形态：**Tauri 2 桌面版**（Rust 内核 + 磁盘 `.md` vault + 独立桌宠窗口）与**浏览器预览版**（同一套界面，数据走 IndexedDB）。
架构边界、数据契约与交互规则严格对齐《技术架构与实现规范》《数据模型与Schema》《墨墨IP与UI设计规范》《多格式高质量导入研究》。

---

## 快速开始

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # 产物在 dist/
```

桌面版（需要 Rust 工具链）：

```bash
npm run desktop        # tauri dev：编译 Rust 并打开桌面窗口
npm run desktop:build  # 打包 .app
```

也可以直接打开 Alma 右侧栏的 **Preview** 标签查看浏览器版。桌面版首次启动会创建 vault：`~/Documents/Inkspire`；设置 → 数据 → 保存位置可以改到任意目录（切换后重载，不自动搬移旧文档）。

---

## 已实现（对照《实现任务分解》P0）

| 工单 | 能力 | 落点 |
|---|---|---|
| T-001 | Tauri 2 外壳、主窗 + 透明桌宠窗、三栏布局 | `src-tauri/` `src/App.tsx` |
| T-002 | 文档模型：纯 Markdown + YAML Front Matter；磁盘 vault 读写 | `src-tauri/src/vault.rs` `src/lib/md.ts` |
| T-003 | Rust 文件存储 + IndexedDB 元数据缓存（收藏/版本） | `vault.rs` `src/lib/db.ts` |
| T-004 | 设置中心（主题/字号/行宽/AI/数据备份） | `src/components/SettingsModal.tsx` |
| T-005/007 | ropey 镜像 + 块索引；CM6 虚拟滚动 | `src-tauri/src/doc.rs` `EditorPane.tsx`，实测 8000 行 P95 ≈ 1ms |
| T-006 | Markdown 解析与行内渲染（GFM / 表格 / 任务列表） | `src/editor/livePreview.ts` |
| T-009/010 | 编辑内核、源码 / 行内双模式、自动保存（防抖 800ms） | `EditorPane.tsx` `vault.ts` |
| T-011 | 纸张 / 夜间双主题与漫画风排版（粗描边 + 硬阴影 + 圆角） | `src/styles/app.css` |
| T-012 | 本地版本历史与回滚（最多 40 个快照） | `src/components/VersionsModal.tsx` |
| T-013 | 文件树、收藏、最近打开、重命名/移动/删除/新建 | `src/components/Sidebar.tsx` |
| T-014 | 全文检索（多词匹配、全部命中优先、中文二元组、命中高亮、跳转定位） | `vault.search()` `Sidebar.tsx` |
| T-015 | 大纲导航（标题实时提取 + 点击平滑跳转） | `src/components/Outline.tsx` |
| T-016/017 | AI 流式代理（Rust reqwest + SSE）+ 建议态 UI | `src-tauri/src/ai.rs` `src/lib/ai.ts` |
| C3/C4/C5 | 续写、润色、精简、总结、翻译、生成小标题；采纳才写入 | `EditorPane.tsx` |
| T-029~033 | 多格式导入：`.md/.txt/.html/.docx/.pdf/.epub` + `.zip` / 整文件夹 + 章节预览 + 质量报告 | `src/lib/importers/*` |
| D1~D4 | 墨墨参数化 SVG（6 态）、桌宠状态机、台词气泡、Markdown 元素 IP 化 | `src/components/Momo.tsx` `Pet.tsx` |
| E1~E4 | 独立透明桌宠窗口、状态联动、台词、点击互动；新增功能条（速记/主窗/设置/隐藏）、今日字数、45s 空闲入睡 | `src-tauri/src/lib.rs` `PetWindow.tsx` |
| G4 | 命令面板 ⌘K、快捷键、数据导出/恢复 | `CommandPalette.tsx` |

### 额外衔接（文档里的 P1 能力，顺手做了基础版）

- **双链**：`[[笔记]]` 行内渲染、未解析链接灰显、反向链接 / 出链面板、双击跳转、目标不存在时一键创建。
- **标签**：行内 `#tag` 自动收集、标签面板、按标签筛选。
- **导入质量报告**：六维评分（文本提取 / 结构 / 章节切分 / 表格 / 图片 / 公式）+ 确定性诊断（页码残留、标题跳跃、扫描件、内容过短等），低分进入「待确认」而不是静默写入。
- **块命令**：行首 `/` 唤出标题、列表、任务、引用、表格、代码块、公式、Mermaid、AI 续写等插入命令；表格也可用 `⌘⇧T` 直接插入。
- **每日笔记与模板**：`⌘⇧D` 打开今日日记；命令面板可从会议纪要、读书笔记、周报、项目计划模板新建。
- **文档移动**：文件行悬停可直接移动到其他文件夹。
- **文件夹重命名**：文件夹行悬停可直接改名，目录内文档一起移动，双链标题不变。
- **AI 改写 diff**：改写结果按词级 diff 显示删除/新增，并给出 `+N / -M` 字符统计；续写/总结建议在光标处显示幽灵文本，采纳才写入。
- **C14 智能图解（POC）**：`⌘⇧G` 生成六种图；预览通过结构 + 真实 DOM 文字测量后写入 `figure` 代码块，可导出 2x PNG；AI 菜单可先出整篇视觉提纲（单节重生成、未插入提纲可恢复），也可生成封面图、用参考图继续修改并保存到 `assets/covers/`；全文可一键润色排版；封面有每篇/每日额度；HTML/EPUB/DOCX/打印 PDF 会内联本地图片和图解。视频仍未做。
- **知识图谱**：命令面板打开双链图谱，按连接度布局，孤岛一眼可见，点节点跳转。
- **文档体检**：命令面板打开，扫描断链、孤岛、重复标题、空 / 短文、90 天未更新和超大文档；点条目直接跳到位置。
- **AI 助手抽屉**：顶部星标打开右侧 420px 抽屉，不再挤在 250px 侧栏。
- **语义检索**：关键词 + 中文二元组 + 真实 embedding（阿里云 `text-embedding-v3`）+ 本机 n-gram 兜底；向量缓存在本地。AI 问答会先用语义召回相关笔记，失败自动回退关键词。
- **相关笔记**：大纲底部点「相关笔记」，按当前文档语义推荐 4 篇，点击跳转。
- **全文润色排版**：AI 菜单可通读整篇正文，统一标题层级、段落和列表；长文自动分段处理，不限字数；结果按配对行 diff 预览，采纳后才替换正文。
- **文件树手动排序**：文档可拖动排序或拖入文件夹，顺序保存在本机；编辑正文不会改变文章位置。
- **AI 操作日志**：AI 菜单或命令面板打开日志，逐条查看行级 diff，并可回放到某次写入之前；每篇保留最近 20 条。
- **AI 每日预算**：设置里可设每日字符上限，超限后文本 AI 入口会被拦下；图片调用不受影响。
- **费用账本**：按内置公开单价估算文本 token、embedding 和生图费用，设置里显示今日 / 本月 / 累计与分模型明细。
- **外部变更监听**：桌面端每 20 秒检查一次 vault；不在编辑时自动合并 iCloud / Git / 其它编辑器的修改，有未保存内容时延后并提示。命令面板也可手动刷新。
- **备份**：全部数据导出为 JSON，可一键恢复。

---

## 桌面架构（Tauri 2 + Rust）

| 文档定稿 | 当前实现 | 状态 |
|---|---|---|
| Tauri 2 外壳、多窗口 | `src-tauri/`：主窗口 + 独立桌宠窗口（透明 / 无边框 / 置顶 / 跨空间） | ✅ |
| vault 纯 `.md` 为真相源 | Rust `vault.rs`：递归扫描、原子写入（tmp + rename）、重命名/删除/目录穿越防护；默认 `~/Documents/Inkspire` | ✅ |
| 设置持久化 | Rust `settings.rs` → `~/Library/Application Support/com.inkspire.desktop/settings.json` | ✅ |
| AI 统一编排层 | Rust `ai.rs`：reqwest + SSE 流式解析，事件回传主窗（绕开 webview CORS） | ✅（Provider 抽象仍在前端） |
| 桌宠独立窗口 | `pet.html` + `PetWindow.tsx`，Rust 定位到右下角、置顶、跨空间常驻 | ✅ |
| SQLite + FTS5 + sqlite-vec | `docs` + `docs_fts`（trigram）已落地；`vectors` 等表待建 | ⏳ 部分 |
| ropey + 块索引 + 增量解析 | `doc.rs`：ropey 镜像 + UTF-16 changeset + pulldown-cmark 块索引；落盘仍为全文写 | ⏳ 部分 |
| 导入解析跑 Node 子进程 | pdf.js / mammoth / JSZip 目前在 webview 内执行，接口与 §6.2 对齐 | ⏳ 待下沉 |
| typeshare 生成类型 | 手写 `src/types.ts`，字段与 Schema 文档一一对应 | ⏳ 待生成 |

**双形态**：同一套前端在 Tauri 里自动走 Rust 命令 + 磁盘 vault；在浏览器预览里回退到 IndexedDB（`src/lib/platform.ts` 负责切换）。所以 `npm run dev` 依然可以直接预览，功能不缩水。

## 导入管线（本次重点修复）

上一版最容易踩的坑是「一本 PDF 被切成上百章」。本实现按《多格式高质量导入研究》§4.5 重做：

1. **格式探测**：扩展名 + magic bytes（`%PDF-` / ZIP 内 `mimetype`、`word/document.xml`）+ 内容嗅探。
2. **章节层级选择**：从 H1/H2/H3 中找「出现 ≥2 次的最浅层级」作为切章层级；只有 1 个 H1 + 多个 H2 时按书名页模式切 H2。
3. **粒度收敛**：
   - 短章合并（< 360 字），但**绝不把长章吞进短序言**；
   - 长章拆分（> 12000 字）；
   - 总量上限 60 章，超出时不断合并最短的相邻对；
   - 只有标题、没有正文的空章节（书名页）直接丢弃。
4. **PDF 专项**：按字号聚类识别标题、合并跨行段落、去除页眉页脚/页码、康熙部首兼容映射（Chrome 导出的 PDF 常把「一」抽成「⼀」）、扫描件直接报错而不是产出空文档。
5. **EPUB 专项**：`container.xml → OPF → spine` 顺序解析，优先用 nav/NCX 的目录标题，短 spine 项合并，图片按需内联（限 24 张 / 单张 600KB）。
6. **质量闸门**：确定性评分与诊断，低分/高风险必须经过导入预览确认。

导入预览支持逐章勾选、合并为单篇或拆分多篇，并显示质量六维与诊断原因。

---

## AI 服务商

与 ThinRead 对齐的 13 个预设，可在「设置 → AI 接口」切换；每个服务商独立记住 Key，模型可手填或点「刷新模型列表」从 `/models` 拉取：

| 分组 | 服务商 |
|---|---|
| 免 Key | 演示模式（本地固定样例）、本地 Ollama、本地 LM Studio |
| 国内托管 | DeepSeek、智谱 GLM、Moonshot Kimi、阿里云百炼、OpenDesign |
| 海外托管 | OpenAI、Anthropic Claude、OpenRouter |
| 聚合网关 | OpenCode Zen / Console、OpenCode Go |

- Claude 走独立的 Messages API（`x-api-key` + `anthropic-version`），其余走 OpenAI 兼容的 `/chat/completions`
- 桌面版请求由 Rust 发出，浏览器预览直接 `fetch`；两条路径解析同一套 SSE
- 「隐私模式」开启后只允许演示模式 / 本地 Ollama / LM Studio，云端请求会被拦下
- API Key 存系统钥匙串（keyring），设置文件与导出备份都不含明文 Key
- 建议态会带「来源」chips（文档·行号，可跳转），并支持上下文预算、相关笔记召回、1 小时结果缓存与本机用量统计
- 演示模式不联网、不产生费用，专门用来体验建议态交互
- 写作类请求自动关闭各家「思考模式」（百炼 Qwen / DeepSeek），首 token 从几十秒降到 1 秒内

## UI 组件（全手写，无原生控件）

界面里除了操作系统级文件选择器与窗口边框，全部控件都是自己实现的，保证和「粗描边 + 硬阴影 + 圆角贴纸」的视觉语言一致：

| 组件 | 文件 | 说明 |
|---|---|---|
| `Select` | `src/components/ui/Select.tsx` | portal 弹出层、键盘上下/回车/Esc、选中态勾选 |
| `Slider` | `ui/Slider.tsx` | 指针拖拽 + 方向键，实时数值，轨道粗描边 |
| `NumberField` | `ui/NumberField.tsx` | 手写 −/+ 步进，无原生 spinner |
| `Checkbox` | `ui/Checkbox.tsx` | 薄荷绿勾选块，支持整行点击 |
| `SuggestionInput` | `ui/SuggestionInput.tsx` | 模型名建议下拉，可自由输入 |
| `ConfirmHost` | `ui/ConfirmHost.tsx` | Promise 版确认弹窗，替代 `window.confirm`，层级高于设置弹窗 |

表单控件统一 36px 高、2px 描边、9px 圆角，标签与控件左对齐，设置页无横向溢出（实测 `scrollWidth === clientWidth`）。

## 快捷键

| 快捷键 | 动作 |
|---|---|
| `⌘K` | 命令面板（含正文检索） |
| `⌘N` | 新建文档 |
| `⌘⇧D` | 今日笔记 |
| `⌘J` | AI 续写（光标处） |
| `⌘S` | 立即保存 |
| `⌘⇧F` | 全局搜索 |
| `⌘/` | 行内 / 源码切换 |
| `⌘B` | 收起 / 展开侧栏 |
| `⌘\` | 显示 / 隐藏桌宠 |
| 双击 `[[双链]]` | 跳转（目标不存在则创建） |

---

## 目录结构

```
src/
├── App.tsx                 # 布局、快捷键、弹层编排
├── store.ts                # useSyncExternalStore 封装
├── types.ts                # 数据契约（对齐 Schema 文档）
├── components/             # TopBar / Sidebar / Outline / EditorPane / Pet / 各弹层
├── editor/livePreview.ts   # CodeMirror 行内渲染装饰
├── lib/
│   ├── db.ts               # IndexedDB
│   ├── vault.ts            # 文档 CRUD、自动保存、版本、搜索、双链、备份
│   ├── md.ts               # Front Matter、标题、双链、标签、字数
│   ├── ai.ts               # Provider 流式调用 + 分场景 prompt
│   └── importers/          # pdf / epub / docx / html / md / 章节与质量
└── styles/app.css          # 设计令牌 + 双主题 + 漫画风组件
```

---

## 数据与隐私

- 文档、设置、版本快照全部保存在本机，不上传任何服务器。桌面版正文是磁盘上的 `.md`，浏览器预览使用 IndexedDB。
- AI 为可选能力：不填 API Key 时所有 AI 入口会引导去设置页，不会静默失败。
- 建议定期「设置 → 导出全部数据」备份；导出文件不包含 API Key。
- 旧版种子文档迁移时先归档到 vault 的 `.trash/`，不会直接删除；保存失败会按文档保留错误状态，避免被其它文档的保存覆盖。

---

## 还没做（文档中的 P1/P2）

- 签名与公证、原生菜单栏
- 自动关联推荐、跨库问答的完整向量索引
- Notion 数据库结构、附件本地化
- C14 视频、PNG 资产批量导出与费用精确到账单
- 长列表完整虚拟化（目前用 content-visibility 跳过离屏布局）、同步与移动端真机适配
