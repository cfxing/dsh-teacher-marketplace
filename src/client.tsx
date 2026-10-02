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

type Tab = 'marketplace' | 'mine'

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
  'remote.agentPresets',
  'sessions',
]

export function apply(ctx: Context): void {
  installStyles()

  const ui = ctx as any
  let dispose: (() => void) | undefined

  const open = (): void => {
    dispose?.()
    dispose = registerMainPanel(
      ctx,
      PLUGIN_ID,
      -2,
      () => (
        <TeacherMarketplace
          ctx={ctx}
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
        onClick={open}
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

function TeacherMarketplace({ ctx, close }: { ctx: Context; close: () => void }) {
  const [tab, setTab] = useState<Tab>('marketplace')
  const [saved, setSaved] = useState<string[]>(readSaved)
  const [available, setAvailable] = useState<Set<string>>(() => new Set())
  const [loadingPreset, setLoadingPreset] = useState('')
  const [selected, setSelected] = useState<Teacher | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let alive = true
    void loadAvailablePresets(ctx).then(ids => {
      if (alive) setAvailable(ids)
    })
    return () => {
      alive = false
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

  return (
    <div className="dsh-teacher-shell">
      <header className="dsh-teacher-header">
        <div className="dsh-teacher-heading">
          <button className="dsh-teacher-back" onClick={close} aria-label="返回">‹</button>
          <div>
            <h1>智能体</h1>
            <p>选择一个老师，直接开始学习，不需要了解 Agent 或 Skill。</p>
          </div>
        </div>
      </header>

      <nav className="dsh-teacher-tabs" aria-label="智能体分类">
        <button className={tab === 'marketplace' ? 'active' : ''} onClick={() => setTab('marketplace')}>
          智能体广场
        </button>
        <button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>
          我的智能体{saved.length > 0 ? ` · ${saved.length}` : ''}
        </button>
      </nav>

      <main className="dsh-teacher-main">
        {error && (
          <div className="dsh-teacher-error" role="alert">
            <span>{error}</span>
            <button onClick={() => setError('')}>关闭</button>
          </div>
        )}
        {notice && <div className="dsh-teacher-notice">{notice}</div>}

        {tab === 'marketplace' && (
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

        {tab === 'mine' && (
          <>
            {savedTeachers.length === 0 ? (
              <div className="dsh-teacher-empty">
                <div className="dsh-teacher-empty-icon">☆</div>
                <h2>还没有添加老师</h2>
                <p>去智能体广场添加你常用的老师，他们会出现在这里。</p>
                <button className="dsh-teacher-primary" onClick={() => setTab('marketplace')}>
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
