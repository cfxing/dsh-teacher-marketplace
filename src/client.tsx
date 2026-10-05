import React, { useEffect, useMemo, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import clientCss from './client.css'

const PLUGIN_ID = 'dsh-teacher-marketplace'
const STORAGE_KEY = 'dsh.teacher-marketplace.saved'

type Teacher = {
  id: string
  presetId: string
  icon: string
  name: string
  subject: string
  description: string
  tags: string[]
  highlights: string[]
}

type View = 'market' | 'mine' | 'artifacts'

const TEACHERS: readonly Teacher[] = [
  {
    id: 'math',
    presetId: 'ai-math-teacher',
    icon: '∑',
    name: 'AI数学老师',
    subject: '数学',
    description: '初高中数学学习导师，重视理解、错题分析、举一反三与迁移。',
    tags: ['初高中', '错题分析', '举一反三', '学习动画'],
    highlights: ['概念讲解 → 例题 → 自己解释 → 变式', '结合错题库形成个性化学习记忆', '数学动态过程可生成学习动画'],
  },
  {
    id: 'physics',
    presetId: 'ai-physics-teacher',
    icon: 'F',
    name: 'AI物理老师',
    subject: '物理',
    description: '初高中物理学习导师，从现象、受力与实验出发建立物理模型。',
    tags: ['初高中', '受力分析', '实验', '举一反三'],
    highlights: ['现象 → 原理 → 公式 → 适用条件', '受力题先明确对象、力的来源和方向', '物理动态演示可生成学习动画'],
  },
]

export const inject = [
  'slots',
  'layout',
  'uiWorkspace',
  'remote',
  'remote.agentPresets',
  'sessions',
]

export function apply(ctx: Context): void {
  installStyles()

  const ui = ctx as any
  let dispose: (() => void) | undefined

  const open = (initialView: View = 'market'): void => {
    dispose?.()
    dispose = registerMainPanel(
      ctx,
      PLUGIN_ID,
      -2,
      () => (
        <TeacherMarketplace
          ctx={ctx}
          initialView={initialView}
          close={() => {
            dispose?.()
            dispose = undefined
          }}
        />
      ),
    )
  }

  ui.slots.inject('sidebar.footer.action', () => ui.slots.register(
    {
      name: 'sidebar.footer.action',
      id: 'teacher-marketplace',
      order: -8,
    },
    () => (
      <button
        className="dsh-teacher-launcher"
        title="智能体"
        aria-label="智能体"
        onClick={() => open('market')}
      >
        <span className="dsh-teacher-launcher-icon">师</span>
        <span>智能体</span>
      </button>
    ),
  ))

  ctx.effect(
    () => () => {
      dispose?.()
      dispose = undefined
    },
    'dsh-teacher-marketplace: workspace lifecycle',
  )
}

function registerMainPanel(
  ctx: Context,
  id: string,
  priority: number,
  render: (props: any) => React.ReactElement,
): () => void {
  const ui = ctx as any
  const layout = ui.layout as { selectPanel?: (id: string | null) => void }

  if (typeof layout.selectPanel !== 'function') {
    return ui.slots.register({ name: 'conversation', priority }, render)
  }

  const slots = ui.slots as {
    register(
      options: { name: 'main'; key: string },
      component: (props: any) => React.ReactElement,
    ): () => void
  }

  const remove = slots.register(
    { name: 'main', key: id },
    (props) => render(props),
  )

  try {
    layout.selectPanel(id)
  } catch (error) {
    remove()
    throw error
  }

  return remove
}

function installStyles(): void {
  const id = 'dsh-teacher-marketplace'
  if (document.querySelector(`style[data-plugin="${id}"]`)) return
  const tag = document.createElement('style')
  tag.dataset.plugin = id
  tag.textContent = clientCss
  document.head.appendChild(tag)
}

function readSaved(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const value = raw === null ? [] : JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value.filter((id): id is string => typeof id === 'string')
  } catch {
    return []
  }
}

function saveSaved(ids: string[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...new Set(ids)]))
  } catch {
    // Private browsing / disabled storage should not block the marketplace.
  }
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

function currentBlankSession(ctx: any): any | undefined {
  const byId = ctx.sessions?.list?.getSnapshot?.().byId ?? {}
  return Object.values(byId).find((session: any) => (
    session.blank === true
    && (session.retainedBy?.mainView ?? 0) > 0
  ))
}

async function waitForBlankSession(ctx: any, timeoutMs = 10000): Promise<any> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const current = currentBlankSession(ctx)
    if (current !== undefined) return current
    await new Promise(resolve => window.setTimeout(resolve, 100))
  }
  throw new Error('新的学习会话没有及时打开，请再试一次。')
}

async function selectTeacherSession(ctx: any, presetId: string): Promise<void> {
  const remote = ctx.remote?.agentPresets
  if (remote === undefined || typeof remote.select !== 'function') {
    throw new Error('当前 Harness 没有提供 Agent Preset 选择服务。')
  }

  let session = currentBlankSession(ctx)

  // Reuse an already blank Session instead of making a redundant new Session.
  if (session === undefined) {
    ctx.uiWorkspace.startSession()
    session = await waitForBlankSession(ctx)
  }

  const current = session.projectionValues?.agentPreset
  if (current === presetId) return

  const result = await remote.select(session.id, presetId)
  if (!result.ok) throw new Error(result.error?.message ?? '教师智能体切换失败。')
}

async function loadAvailablePresets(ctx: any): Promise<Set<string>> {
  try {
    const result = await ctx.remote?.agentPresets?.list?.()
    if (!result?.ok) return new Set()
    return new Set(
      (result.value?.presets ?? [])
        .filter((preset: any) => preset.broken === undefined)
        .map((preset: any) => preset.id),
    )
  } catch {
    return new Set()
  }
}

/* ------------------------------------------------------------------ *
 * 学习产物识别
 *
 * 教师在工作区中生成的 html / 视频 / 图片 / 文件，会以会话事件的方式
 * 落在 Client 的 SessionEventWindow 里。这里对事件做防御式探测：
 * 只要事件数据里出现带可渲染地址或文件路径的可识别产物，就抽取出来。
 * 字段名与宿主真实的产物结构可能略有差异，需实机验证后按反馈校准。
 * ------------------------------------------------------------------ */

type ArtifactKind = 'html' | 'video' | 'image' | 'file'

type Artifact = {
  id: string
  kind: ArtifactKind
  title: string
  /** 可直连渲染的源地址（同源 / blob / data 均可）。 */
  url?: string
  /** 文件路径（取不到可渲染地址时给用户定位使用）。 */
  path?: string
  /** html 型产物若直接携带代码片段，则用 srcdoc 渲染。 */
  html?: string
}

function kindOfName(name: string): ArtifactKind {
  const lower = name.toLowerCase()
  if (/\.html?$/.test(lower)) return 'html'
  if (/\.(mp4|webm|mov|m4v)$/.test(lower)) return 'video'
  if (/\.(png|jpe?g|gif|webp|svg)$/.test(lower)) return 'image'
  return 'file'
}

function urlCandidates(value: unknown): Array<string | undefined> {
  const out: Array<string | undefined> = []
  if (typeof value === 'string') {
    if (/^(https?:|blob:|data:|file:|)[^:]*\/(.)+/i.test(value)) out.push(value)
    return out
  }
  if (value !== null && typeof value === 'object') {
    const rec = value as Record<string, unknown>
    for (const key of ['url', 'src', 'href', 'uri', 'previewUrl', 'playUrl']) {
      const v = rec[key]
      if (typeof v === 'string' && v.trim() !== '') out.push(v)
    }
  }
  return out
}

function nameCandidates(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value !== null && typeof value === 'object') {
    const rec = value as Record<string, unknown>
    for (const key of ['name', 'title', 'fileName', 'filename', 'path']) {
      const v = rec[key]
      if (typeof v === 'string' && v.trim() !== '') return v
    }
    const path = rec['path']
    if (typeof path === 'string') return path
  }
  return undefined
}

function htmlBodyFrom(value: unknown): string | undefined {
  if (typeof value === 'string' && /^\s*<(!doctype|html)/i.test(value)) return value
  if (value !== null && typeof value === 'object') {
    const rec = value as Record<string, unknown>
    for (const key of ['html', 'content', 'code', 'body']) {
      const v = rec[key]
      if (typeof v === 'string' && /<(!doctype|html|body|div)/i.test(v)) return v
    }
  }
  return undefined
}

/** 递归扫描一个对象的叶子值，找出所有可能代表一个"产物"的对象节点。 */
function collectArtifactNodes(node: unknown, depth: number, seen: Set<object>, out: unknown[]): void {
  if (depth > 6 || node === null || node === undefined) return
  if (typeof node !== 'object') return
  if (typeof (node as object) === 'object' && (node as object) !== null) {
    if (seen.has(node as object)) return
    seen.add(node as object)
  }

  const rec = node as Record<string, unknown>
  const name = nameCandidates(rec)
  const hasUrl = urlCandidates(rec).some(Boolean)

  if ((name !== undefined && hasUrl) || htmlBodyFrom(rec) !== undefined || hasUrl) {
    out.push(node)
    return
  }

  for (const value of Object.values(rec)) {
    if (typeof value === 'object' && value !== null) {
      collectArtifactNodes(value, depth + 1, seen, out)
    }
  }
}

function extractArtifacts(events: readonly unknown[]): Artifact[] {
  const nodes: unknown[] = []
  const seen = new Set<object>()
  const bodies: string[] = []
  const urls: string[] = []
  const paths: string[] = []

  const scanValue = (value: unknown): void => {
    if (typeof value === 'string') {
      const body = htmlBodyFrom(value)
      if (body !== undefined) bodies.push(body)
      else {
        const t = (value.trim().match(/\S+$/) ?? [''])[0]
        if (t.startsWith('/') || t.includes('/')) paths.push(value)
      }
      return
    }
    collectArtifactNodes(value, 0, seen, nodes)
  }

  for (const entry of events as Array<Record<string, unknown>>) {
    const event = deepField(entry, 'event') ?? entry
    if (event === null || typeof event !== 'object') continue
    const data = deepField(event, 'data')
    if (data !== undefined) scanValue(data)
    for (const value of Object.values(event)) {
      if (value !== data) scanValue(value)
    }
  }

  for (const node of nodes) {
    const rec = node as Record<string, unknown>
    const path = typeof rec['path'] === 'string' ? rec['path'] : undefined
    const name = nameCandidates(rec) ?? path ?? '学习产物'
    if (path) paths.push(path)
    for (const u of urlCandidates(rec)) if (u) urls.push(u)
    const body = htmlBodyFrom(rec)
    if (body) bodies.push(body)
  }

  const artifacts: Artifact[] = []
  let serial = 0

  for (const body of bodies) {
    const le = body.length
    artifacts.push({
      id: `html-${serial++}`,
      kind: 'html',
      title: `学习文档 ${artifacts.length + 1}`,
      html: body,
    })
    void le
  }

  for (const u of urls) {
    const name = u.split(/[\\/]/).pop() ?? ''
    artifacts.push({
      id: `url-${serial++}`,
      kind: kindOfName(name),
      title: name ? decodeURIComponent(name) : `资源 ${artifacts.length + 1}`,
      url: u,
    })
  }

  for (const p of paths) {
    const name = p.split(/[\\/]/).pop() ?? p
    artifacts.push({
      id: `path-${serial++}`,
      kind: kindOfName(name),
      title: name ? decodeURIComponent(name) : `文件 ${artifacts.length + 1}`,
      path: p,
    })
  }

  // 去重并过滤掉明显是纯文本的工具输出。
  const unique = new Map<string, Artifact>()
  for (const art of artifacts) {
    const key = art.url ?? art.html ?? art.path ?? art.id
    if (!unique.has(key)) unique.set(key, art)
  }
  return [...unique.values()].filter(art => art.url !== undefined || art.html !== undefined || art.path !== undefined)
}

/** 在嵌套对象里按 `.` 路径读字段（用于取 `event.data` 等）。 */
function deepField(root: unknown, keyPath: string): unknown {
  const parts = keyPath.split('.')
  let cur: unknown = root
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

function TeacherMarketplace({ ctx, initialView, close }: {
  ctx: Context
  initialView: View
  close: () => void
}) {
  const [view, setView] = useState<View>(initialView)
  const [saved, setSaved] = useState<string[]>(readSaved)
  const [available, setAvailable] = useState<Set<string>>(() => new Set())
  const [loadingPreset, setLoadingPreset] = useState('')
  const [selected, setSelected] = useState<Teacher | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // 学习产物：订阅当前保留会话的事件窗口，抽取工具生成的内容。
  const [activeArtifacts, setActiveArtifacts] = useState<Artifact[]>([])
  const [activeTab, setActiveTab] = useState<Artifact | null>(null)

  useEffect(() => {
    let alive = true
    void loadAvailablePresets(ctx).then(ids => {
      if (alive) setAvailable(ids)
    })
    return () => {
      alive = false
    }
  }, [ctx])

  useEffect(() => {
    const sessions: any = (ctx as any).sessions
    if (!sessions || typeof sessions.retain !== 'function') {
      setNotice('当前环境未提供会话订阅能力，学习产物暂不可用。')
      return
    }

    const list = sessions.list?.getSnapshot?.()
    const byId = list?.byId ?? {}
    const live = (Object.values(byId) as any[])
      .filter((s: any) => s.blank !== true && !s.removed)
      .sort((a: any, b: any) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
    if (live === undefined || typeof live.id !== 'string') return

    const ref = sessions.retain(live.id, { source: 'controllerOperation' })
    let sub: (() => void) | undefined
    let cancelled = false

    const sync = (): void => {
      if (cancelled) return
      try {
        const window = ref.binding?.eventSource?.getSnapshot?.()
        const entries = window?.entries ?? []
        const arts = extractArtifacts(entries)
        setActiveArtifacts(arts)
        if (arts.length > 0) {
          setActiveTab(prev => prev ?? arts[0])
        }
      } catch {
        // 事件窗口未就绪时跳过本轮抽取。
      }
    }

    const source = ref.binding?.eventSource
    if (source && typeof source.subscribe === 'function') {
      sub = source.subscribe(sync)
    }
    sync()

    return () => {
      cancelled = true
      sub?.()
      try {
        ref.release?.()
      } catch {
        // 释放失败不影响插件卸载。
      }
    }
  }, [ctx])

  const savedTeachers = useMemo(
    () => TEACHERS.filter(teacher => saved.includes(teacher.id)),
    [saved],
  )

  const toggleSaved = (teacher: Teacher): void => {
    setError('')
    setNotice('')
    setSaved(current => {
      const next = current.includes(teacher.id)
        ? current.filter(id => id !== teacher.id)
        : [...current, teacher.id]
      saveSaved(next)
      return next
    })
    setNotice(saved.includes(teacher.id) ? '已从我的智能体移除。' : '已加入我的智能体。')
  }

  const start = async (teacher: Teacher): Promise<void> => {
    setLoadingPreset(teacher.presetId)
    setError('')
    setNotice('')
    try {
      await selectTeacherSession(ctx, teacher.presetId)
      close()
    } catch (reason) {
      setError(errorMessage(reason))
      // A missing preset is usually a deployment/configuration issue. Keep the
      // marketplace open so the learner can still inspect other teachers.
    } finally {
      setLoadingPreset('')
    }
  }

  const unavailableReason = (teacher: Teacher): string | undefined => {
    if (available.size === 0) return undefined
    return available.has(teacher.presetId) ? undefined : '教师 Preset 未安装或当前不可用'
  }

  const renderTeacher = (teacher: Teacher, mine = false): React.ReactElement => {
    const unavailable = unavailableReason(teacher)
    const starting = loadingPreset === teacher.presetId
    return (
      <article className="dsh-teacher-card" key={teacher.id}>
        <div className="dsh-teacher-avatar">{teacher.icon}</div>
        <div className="dsh-teacher-card-body">
          <div className="dsh-teacher-title-row">
            <div>
              <h3>{teacher.name}</h3>
              <span className="dsh-teacher-subtitle">{teacher.subject} · DeepSeek Harness</span>
            </div>
            {saved.includes(teacher.id) && <span className="dsh-teacher-saved">已添加</span>}
          </div>
          <p>{teacher.description}</p>
          <div className="dsh-teacher-tags">
            {teacher.tags.map(tag => <span key={tag}>{tag}</span>)}
          </div>
          {unavailable !== undefined && (
            <div className="dsh-teacher-warning">{unavailable}</div>
          )}
          <div className="dsh-teacher-actions">
            <button
              className="dsh-teacher-secondary"
              onClick={() => setSelected(teacher)}
            >
              查看老师
            </button>
            <button
              className="dsh-teacher-secondary"
              onClick={() => toggleSaved(teacher)}
            >
              {mine ? '移除' : (saved.includes(teacher.id) ? '移除' : '添加')}
            </button>
            <button
              className="dsh-teacher-primary"
              disabled={starting || unavailable !== undefined}
              onClick={() => { void start(teacher) }}
            >
              {starting ? '正在进入…' : '开始学习'}
            </button>
          </div>
        </div>
      </article>
    )
  }

  const renderArtifacts = (): React.ReactElement => {
    const active = activeTab
    return (
      <div className="dsh-artifacts">
        <section className="dsh-artifacts-list">
          {activeArtifacts.length === 0 ? (
            <div className="dsh-teacher-empty compact">
              <div className="dsh-teacher-empty-icon">◇</div>
              <h2>还没有学习产物</h2>
              <p>先开始学习，老师生成的文档、动画、视频会展示在这里，不再被折叠在工具里。</p>
              <button className="dsh-teacher-primary" onClick={() => setView('market')}>
                去开始学习
              </button>
            </div>
          ) : (
            activeArtifacts.map(art => (
              <button
                key={art.id}
                className={`dsh-artifact-item${active?.id === art.id ? ' active' : ''}`}
                onClick={() => setActiveTab(art)}
              >
                <span className="dsh-artifact-kind">{kindGlyph(art.kind)}</span>
                <span className="dsh-artifact-title">{art.title}</span>
              </button>
            ))
          )}
        </section>
        <section className="dsh-artifacts-preview">
          {active === null ? (
            <div className="dsh-artifacts-empty">
              <span>从左侧选择一项产物预览</span>
            </div>
          ) : (
            <ArtifactPreview artifact={active} key={active.id} />
          )}
        </section>
      </div>
    )
  }

  return (
    <div className="dsh-teacher-shell">
      <aside className="dsh-teacher-rail">
        <div className="dsh-teacher-rail-head">
          <span className="dsh-teacher-rail-brand">学习工作台</span>
          <button className="dsh-teacher-new" onClick={() => setView('market')}>＋ 新建学习</button>
        </div>
        <nav className="dsh-teacher-rail-nav" aria-label="学习工作台导航">
          <div className="dsh-teacher-rail-group">学习</div>
          <button className={view === 'market' ? 'active' : ''} onClick={() => setView('market')}>
            <span className="dsh-teacher-rail-icon">▦</span>智能体广场
          </button>
          <button className={view === 'mine' ? 'active' : ''} onClick={() => setView('mine')}>
            <span className="dsh-teacher-rail-icon">☆</span>我的智能体
            {saved.length > 0 ? <em>{saved.length}</em> : null}
          </button>
          <button className={view === 'artifacts' ? 'active' : ''} onClick={() => setView('artifacts')}>
            <span className="dsh-teacher-rail-icon">◇</span>学习产物
          </button>
        </nav>
        <div className="dsh-teacher-rail-foot">
          <button className="dsh-teacher-back" onClick={close} aria-label="返回">返回</button>
        </div>
      </aside>

      <main className="dsh-teacher-main">
        {error && (
          <div className="dsh-teacher-error" role="alert">
            <span>{error}</span>
            <button onClick={() => setError('')}>关闭</button>
          </div>
        )}
        {notice && <div className="dsh-teacher-notice">{notice}</div>}

        {view === 'market' && (
          <>
            <section className="dsh-teacher-hero">
              <div>
                <span className="dsh-teacher-kicker">学习助手</span>
                <h2>今天想和哪位老师学习？</h2>
                <p>老师已经配置好教学方式、错题记忆和学习动画能力。你只需要选择老师。</p>
              </div>
              <span className="dsh-teacher-hero-mark">◌</span>
            </section>
            <div className="dsh-teacher-grid">
              {TEACHERS.map(teacher => renderTeacher(teacher))}
            </div>
          </>
        )}

        {view === 'mine' && (
          <>
            {savedTeachers.length === 0 ? (
              <div className="dsh-teacher-empty">
                <div className="dsh-teacher-empty-icon">☆</div>
                <h2>还没有添加老师</h2>
                <p>去智能体广场添加你常用的老师，他们会出现在这里。</p>
                <button className="dsh-teacher-primary" onClick={() => setView('market')}>
                  去智能体广场
                </button>
              </div>
            ) : (
              <div className="dsh-teacher-grid">
                {savedTeachers.map(teacher => renderTeacher(teacher, true))}
              </div>
            )}
          </>
        )}

        {view === 'artifacts' && renderArtifacts()}
      </main>

      {selected !== null && (
        <div
          className="dsh-teacher-overlay"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setSelected(null)
          }}
        >
          <article className="dsh-teacher-detail">
            <header>
              <div className="dsh-teacher-avatar large">{selected.icon}</div>
              <div>
                <h2>{selected.name}</h2>
                <p>{selected.subject}学习导师</p>
              </div>
              <button onClick={() => setSelected(null)} aria-label="关闭">×</button>
            </header>
            <div className="dsh-teacher-detail-body">
              <p className="dsh-teacher-detail-description">{selected.description}</p>
              <h3>能帮你做什么</h3>
              <div className="dsh-teacher-highlights">
                {selected.highlights.map(item => <div key={item}>✓ {item}</div>)}
              </div>
              <div className="dsh-teacher-tags detail">
                {selected.tags.map(tag => <span key={tag}>{tag}</span>)}
              </div>
            </div>
            <footer>
              <button className="dsh-teacher-secondary" onClick={() => toggleSaved(selected)}>
                {saved.includes(selected.id) ? '从我的智能体移除' : '添加到我的智能体'}
              </button>
              <button
                className="dsh-teacher-primary"
                disabled={loadingPreset === selected.presetId || unavailableReason(selected) !== undefined}
                onClick={() => { void start(selected) }}
              >
                {loadingPreset === selected.presetId ? '正在进入…' : '开始学习'}
              </button>
            </footer>
          </article>
        </div>
      )}
    </div>
  )
}

function kindGlyph(kind: ArtifactKind): string {
  switch (kind) {
    case 'html': return '⌘'
    case 'video': return '▶'
    case 'image': return '♪'
    default: return '〙'
  }
}

function ArtifactPreview({ artifact }: { artifact: Artifact }): React.ReactElement {
  if (artifact.html !== undefined) {
    return (
      <iframe
        className="dsh-artifact-frame"
        title={artifact.title}
        srcDoc={artifact.html}
        sandbox="allow-scripts allow-same-origin"
      />
    )
  }
  if (artifact.kind === 'video' && artifact.url !== undefined) {
    return <video className="dsh-artifact-media" src={artifact.url} controls autoPlay muted />
  }
  if (artifact.kind === 'image' && artifact.url !== undefined) {
    return <img className="dsh-artifact-media" src={artifact.url} alt={artifact.title} />
  }
  if (artifact.url !== undefined) {
    return <iframe className="dsh-artifact-frame" title={artifact.title} src={artifact.url} sandbox="allow-scripts allow-same-origin" />
  }
  if (artifact.path !== undefined) {
    return (
      <div className="dsh-artifact-path">
        <div className="dsh-teacher-empty-icon">〙</div>
        <h2>已定位产物文件</h2>
        <p>{artifact.path}</p>
        <span className="dsh-artifact-note">该文件未提供可直连预览地址，请在会话中打开查看。</span>
      </div>
    )
  }
  return (
    <div className="dsh-artifacts-empty">
      <span>无法预览此产物</span>
    </div>
  )
}