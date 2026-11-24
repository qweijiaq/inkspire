export interface AiAction {
  id: string
  label: string
  category: '写作' | '结构' | '知识' | '代码' | '工作'
  hint: string
  prompt: string
}

export const AI_ACTIONS: AiAction[] = [
  // 写作（12）
  { id: 'write-continue', label: '续写下一段', category: '写作', hint: '接住当前段落继续写', prompt: '基于光标前的上下文，续写一到两段。保持原有语气和 Markdown 结构，不要重复已写内容。' },
  { id: 'write-expand', label: '扩写到两倍', category: '写作', hint: '保留信息，增加细节与例子', prompt: '把选中的内容扩写到约两倍长度，补充具体细节、例子或推理过程，不添加空洞套话。' },
  { id: 'write-tighten', label: '精简一半', category: '写作', hint: '删冗余，保留关键信息', prompt: '把选中内容压缩到约一半长度，保留事实、结论和必要限定条件，删掉重复与铺垫。' },
  { id: 'write-polish', label: '润色语句', category: '写作', hint: '顺句、去口头禅', prompt: '润色选中文字：修正语病、调整语序、统一术语，保持原意和作者语气。' },
  { id: 'write-casual', label: '改成口语', category: '写作', hint: '像在跟朋友解释', prompt: '把选中内容改写成自然的口语表达，短句为主，保留专业术语但解释清楚。' },
  { id: 'write-formal', label: '改成正式报告', category: '写作', hint: '客观、克制、可引用', prompt: '把选中内容改写成正式报告语气：客观、克制、结构清楚，避免感叹句和口语词。' },
  { id: 'write-human', label: '降低 AI 味', category: '写作', hint: '去模板腔和排比', prompt: '重写选中内容，去掉模板腔、空泛排比和过度总结，让句子更像具体的人写的。' },
  { id: 'write-xhs', label: '写成小红书', category: '写作', hint: '标题 + 短段落 + 清单', prompt: '把选中内容改写成小红书笔记：一个抓人的标题、短段落、适量 emoji、结尾一个具体问题。' },
  { id: 'write-thread', label: '写成推文串', category: '写作', hint: '拆成 5~8 条', prompt: '把选中内容拆成 5~8 条推文串，每条独立可读，用编号标注，最后一条给出结论。' },
  { id: 'write-titles', label: '生成五个标题', category: '写作', hint: '不同角度，不标题党', prompt: '为当前文档生成 5 个标题，分别从问题、结论、方法、反常识、读者收益角度切入，避免标题党。' },
  { id: 'write-quotes', label: '提炼金句', category: '写作', hint: '可独立传播的句子', prompt: '从选中内容里提炼 3~5 句可以独立传播的金句，保留原文观点，不发明新事实。' },
  { id: 'write-opening', label: '改写开头', category: '写作', hint: '前三句抓住人', prompt: '重写当前文档的开头三句：直接进入问题或场景，删掉背景铺垫和“随着……发展”式开场。' },

  // 结构（10）
  { id: 'struct-outline', label: '生成大纲', category: '结构', hint: '按现有内容重组', prompt: '为当前文档生成一份两级大纲，只使用文中已有的观点；缺失的环节用「待补」标出。' },
  { id: 'struct-reorder', label: '重组段落', category: '结构', hint: '按论证顺序重排', prompt: '把选中段落按“问题 → 证据 → 推论 → 结论”的顺序重排，必要时补一句过渡，不改变事实。' },
  { id: 'struct-transition', label: '加过渡句', category: '结构', hint: '补段与段之间的桥', prompt: '在选中内容中找出段落跳跃处，补 2~4 句过渡，说明上一段和下一段的逻辑关系。' },
  { id: 'struct-split', label: '拆分长段', category: '结构', hint: '一段一个意思', prompt: '把选中的长段落拆成若干短段，每段只承担一个意思，保留原句信息。' },
  { id: 'struct-merge', label: '合并冗余段', category: '结构', hint: '去重复论证', prompt: '找出选中内容里重复或高度相似的段落，合并成一段，并指出删掉了哪些重复信息。' },
  { id: 'struct-glossary', label: '提取术语表', category: '结构', hint: '术语 + 一句话解释', prompt: '从当前文档提取术语，输出 Markdown 表格：术语、英文、一句话解释、首次出现位置。' },
  { id: 'struct-toc', label: '生成目录', category: '结构', hint: '按标题层级', prompt: '根据当前文档标题生成嵌套目录，使用 Markdown 列表；不要编造不存在的章节。' },
  { id: 'struct-logic', label: '检查逻辑跳跃', category: '结构', hint: '标出缺证据的地方', prompt: '检查选中内容的论证链，列出逻辑跳跃、未证明的前提和缺失的证据，按严重程度排序。' },
  { id: 'struct-duplicate', label: '找重复内容', category: '结构', hint: '句意级去重', prompt: '找出当前文档中意思重复的句子或段落，引用原句并给出合并建议。' },
  { id: 'struct-contradiction', label: '找前后矛盾', category: '结构', hint: '事实/口径冲突', prompt: '检查当前文档前后是否存在事实、数字、术语或结论冲突；逐条引用冲突的两处原文。' },

  // 知识（10）
  { id: 'know-explain', label: '解释概念', category: '知识', hint: '给没背景的人讲清', prompt: '用简洁中文解释选中的概念，先给一句话定义，再说明它解决什么问题、常见误解是什么。' },
  { id: 'know-examples', label: '举三个例子', category: '知识', hint: '具体、不同场景', prompt: '为选中的概念举 3 个具体例子，分别来自不同场景，并说明每个例子对应概念的哪一部分。' },
  { id: 'know-analogy', label: '用类比说明', category: '知识', hint: '一个准确类比 + 边界', prompt: '用一个日常类比解释选中概念，并明确指出这个类比在哪里不成立。' },
  { id: 'know-counter', label: '给反例', category: '知识', hint: '挑战当前结论', prompt: '为选中的观点构造 2~3 个反例或边界情况，说明在什么条件下原结论不成立。' },
  { id: 'know-quiz', label: '生成测验', category: '知识', hint: '5 题 + 答案', prompt: '根据当前文档生成 5 道测验题（3 道选择、2 道简答），附答案与解析。' },
  { id: 'know-cards', label: '生成记忆卡片', category: '知识', hint: '问答对', prompt: '把当前文档提炼成 8 张问答式记忆卡片，问题要具体，答案不超过 60 字。' },
  { id: 'know-concepts', label: '提取关键概念', category: '知识', hint: '概念 + 关系', prompt: '提取当前文档的关键概念，用列表给出概念、定义、与文中其他概念的关系。' },
  { id: 'know-links', label: '建议双链', category: '知识', hint: '可连接的笔记', prompt: '根据当前文档内容，建议 3~5 个应该建立的 [[双链]]，说明连接理由和连接位置。' },
  { id: 'know-tags', label: '建议标签', category: '知识', hint: '少而准', prompt: '为当前文档建议 3~6 个标签，优先复用文末已有标签，不要生造宽泛标签。' },
  { id: 'know-related', label: '找相关笔记', category: '知识', hint: '跨库连接', prompt: '结合提供的库内参考笔记，找出与当前文档最相关的 3 篇，说明相关点和可合并/对照的内容。' },

  // 代码（8）
  { id: 'code-explain', label: '解释代码', category: '代码', hint: '逐段说明意图', prompt: '解释选中代码在做什么：输入、输出、关键步骤、边界条件；不要逐行翻译语法。' },
  { id: 'code-comment', label: '加注释', category: '代码', hint: '解释为什么，不是是什么', prompt: '为选中代码补充必要注释，重点解释不明显的意图、边界和为什么这样做，避免废话注释。' },
  { id: 'code-bug', label: '找 bug', category: '代码', hint: '按可能性排序', prompt: '审查选中代码，列出潜在 bug、竞态、空值、越界和错误处理问题，按可能性排序并给出修复。' },
  { id: 'code-perf', label: '优化性能', category: '代码', hint: '先测量再改', prompt: '分析选中代码的性能瓶颈，给出 2~3 个优化方案，标注预期收益和复杂度代价。' },
  { id: 'code-ts', label: '转 TypeScript', category: '代码', hint: '补类型，不改逻辑', prompt: '把选中代码转成 TypeScript，补齐类型和边界处理，不改变运行逻辑。' },
  { id: 'code-test', label: '写单元测试', category: '代码', hint: '覆盖正常与边界', prompt: '为选中代码写单元测试，覆盖正常路径、边界值和错误分支；说明测试框架假设。' },
  { id: 'code-regex', label: '生成正则', category: '代码', hint: '带解释和样例', prompt: '根据描述生成正则表达式，给出 5 个匹配样例、3 个不匹配样例，并解释每个分组。' },
  { id: 'code-error', label: '解释报错', category: '代码', hint: '定位 + 修复', prompt: '解释选中的报错信息：最可能的原因、如何验证、如何修复；给出最小修改建议。' },

  // 工作（10）
  { id: 'work-minutes', label: '会议纪要', category: '工作', hint: '结论 / 分歧 / 待办', prompt: '把选中内容整理成会议纪要：结论、关键分歧、待办（负责人/截止时间）、待确认问题。' },
  { id: 'work-actions', label: '提取行动项', category: '工作', hint: '任务列表', prompt: '从选中内容提取行动项，输出 Markdown 任务列表，每条包含动词、对象、负责人（若文中提到）。' },
  { id: 'work-decision', label: '决策记录', category: '工作', hint: 'ADR 格式', prompt: '把选中内容整理成决策记录：背景、选项、决定、理由、影响、复审时间。' },
  { id: 'work-risks', label: '风险清单', category: '工作', hint: '概率 / 影响 / 缓解', prompt: '识别当前项目/文档中的风险，输出表格：风险、概率、影响、触发信号、缓解动作。' },
  { id: 'work-requirements', label: '需求拆解', category: '工作', hint: '用户价值 → 任务', prompt: '把选中需求拆成可交付任务，按用户价值排序，标注依赖和验收标准。' },
  { id: 'work-story', label: '用户故事', category: '工作', hint: 'As a… I want…', prompt: '把选中需求改写成 3~5 条用户故事，格式：作为…我希望…以便…；附 Acceptance Criteria。' },
  { id: 'work-acceptance', label: '验收标准', category: '工作', hint: '可测试', prompt: '为选中功能写验收标准，使用 Given/When/Then，覆盖正常、边界和失败场景。' },
  { id: 'work-weekly', label: '写周报', category: '工作', hint: '结果 / 进行中 / 风险', prompt: '把选中内容整理成周报：本周结果、进行中、阻塞与风险、下周计划；结果尽量量化。' },
  { id: 'work-retro', label: '项目复盘', category: '工作', hint: '做对 / 做错 / 下次', prompt: '对选中内容做项目复盘：做对了什么、做错了什么、意外发现、下次具体改变。' },
  { id: 'work-brief', label: '给上级的简报', category: '工作', hint: '一页结论先行', prompt: '把选中内容压缩成一页上级简报：结论先行、3 个依据、需要决策的事项、风险。' },
]

export const AI_ACTION_COUNT = AI_ACTIONS.length
