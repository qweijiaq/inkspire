import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const docs = [
  { file: 'docs/initial/项目介绍.md', title: '项目介绍', needles: ['# 项目介绍', '## 四根支柱', '## 技术架构', '## 当前状态'] },
  { file: 'docs/initial/项目使用.md', title: '项目使用', needles: ['# 项目使用', '## 安装与启动', '## 界面', '## 数据存在哪', '## 文档同步规则'] },
  {
    file: 'docs/initial/Markdown 支持.md',
    title: 'Markdown 支持',
    needles: ['# Markdown 支持', '## 文本', '## 代码', '## 表格', '## Mermaid', '## 源码模式'],
  },
]

const failures = []
const read = (file) => {
  const full = path.join(root, file)
  if (!fs.existsSync(full)) {
    failures.push(`缺少 ${file}`)
    return ''
  }
  return fs.readFileSync(full, 'utf8')
}

for (const doc of docs) {
  const text = read(doc.file)
  if (!text) continue
  if (!text.startsWith('---')) failures.push(`${doc.file} 缺少 frontmatter`)
  for (const needle of doc.needles) {
    if (!text.includes(needle)) failures.push(`${doc.file} 缺少章节：${needle}`)
  }
}

const md = read('docs/initial/Markdown 支持.md')
const syntax = [
  ['粗体', '**粗体**'],
  ['斜体', '*斜体*'],
  ['删除线', '~~删除线~~'],
  ['行内代码', '`行内代码`'],
  ['代码块', '```ts'],
  ['任务列表', '- [x]'],
  ['引用', '> 引用'],
  ['提示卡', '> [!tip]'],
  ['表格', '| 能力 |'],
  ['数学', '$$'],
  ['Mermaid', '```mermaid'],
  ['双链', '[[项目介绍]]'],
  ['高亮', '==高亮文本=='],
  ['上标', 'mc^2^'],
  ['下标', 'H~2~O'],
  ['脚注', '[^garden]'],
  ['定义列表', '\n: 定义会缩进'],
  ['裸链接', 'https://alma.now'],
  ['TOC', '[TOC]'],
  ['Setext 标题', '\n===\n'],
  ['标题 ID', '{#custom-id}'],
  ['kbd', '<kbd>⌘K</kbd>'],
  ['emoji 短码', ':sparkles:'],
  ['分割线', '\n---\n'],
]
for (const [name, needle] of syntax) {
  if (md && !md.includes(needle)) failures.push(`Markdown 支持.md 未覆盖：${name}`)
}

const vaultSource = read('src/lib/vault.ts')
for (const file of ['项目介绍.md', '项目使用.md', 'Markdown 支持.md']) {
  if (vaultSource && !vaultSource.includes(`docs/initial/${file}?raw`)) {
    failures.push(`vault.ts 未引用 docs/initial/${file}`)
  }
}

const usage = read('docs/initial/项目使用.md')
for (const needle of ['AI 动作库', '50', '桌宠互动', '多级文件夹', '保存位置', '共学', '复习', '最近阅读', 'AI 出题', '墨墨的记忆', '考考我', '本周报告', '遗忘预警', '语气']) {
  if (usage && !usage.includes(needle)) failures.push(`项目使用.md 未覆盖：${needle}`)
}

const readme = read('README.md')
for (const name of ['项目介绍', '项目使用', 'Markdown 支持']) {
  if (readme && !readme.includes(name)) failures.push(`README.md 未提及初始文档：${name}`)
}
if (failures.length) {
  console.error('文档检查失败：')
  for (const item of failures) console.error(`- ${item}`)
  process.exit(1)
}

console.log(`文档检查通过：${docs.length} 篇初始文档，Markdown 示例 ${syntax.length} 类，README 与初始文档齐备。`)
