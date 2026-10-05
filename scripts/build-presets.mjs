import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const presetsDir = resolve(root, 'src/presets')

// 插件本体与「基础能力」注释是固定的宿主级装配，不随 Preset 增删变化，
// 单独维护在这里，避免每次合并时重复手写。
const header = `# 教师智能体市场：页面插件 + 两个教育类 Agent Preset。
# 注意：本文件由 scripts/build-presets.mjs 从 src/presets/*.yml 自动生成，请勿手改。
#
# 基础能力（由 web profile 宿主层统一加载，Preset 不重复挂载以避免 eager mount 重复实例化）：
#   dsh-wrong-question
#   dshmath-manim

- insert:
    - id: dsh-teacher-marketplace
      name: dsh-teacher-marketplace
`
const presetFiles = (await readdir(presetsDir)).filter(file => file.endsWith('.yml')).sort()
const presetContents = await Promise.all(presetFiles.map(file => readFile(resolve(presetsDir, file), 'utf8')))
const presetList = presetContents.join('\n')

// yml 顶层是 "- id: xxx ..." 的文档列表；直接拼在 header 的 "- insert:" 列表下。
// 每个 preset 文件内缩进 2 格，插入后整体再缩进 4 格对齐 "- insert:" 的子项。
const body = presetList
  .split('\n')
  .map(line => (line === '' ? '' : '    ' + line))
  .join('\n')

await mkdir(resolve(root, 'lib'), { recursive: true })
await writeFile(resolve(root, 'cordis.patch.yml'), header + body + '\n', 'utf8')