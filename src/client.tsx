import React, { useEffect, useMemo, useRef, useState } from 'react'
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
  const artifactManager = new ArtifactManager(ctx)
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
          artifactManager={artifactManager}
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
      artifactManager.dispose()
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

async function selectTeacherSession(ctx: any, presetId: string): Promise<any> {
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
  if (current !== presetId) {
    const result = await remote.select(session.id, presetId)
    if (!result.ok) throw new Error(result.error?.message ?? '教师智能体切换失败。')
  }

  // This is a native DeepSeek Harness Session. The marketplace only observes it;
  // it does not create or own a second plugin-local session.
  return session
}

/** 跳转：让宿主打开指定会话（产物通常就在该会话的对话里可播放）。 */
async function openSessionInHost(ctx: any, sessionId: string | null): Promise<void> {
  if (!sessionId) return
  ctx?.uiWorkspace?.openSession?.(sessionId)
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
 * 会话事件窗口（SessionEventWindow.entries）里的每一项是
 * SessionEventLikeEntry = { type:'event'|'transient', event: SessionEvent }。
 * SessionEvent 是判别联合（type: 'tool/result' | 'assistant/message' | …）。
 * 教师产物（html / 视频 / 图片 / 文件）主要出现在两类事件：
 *   - tool/result.message.content —— file / image 内容块
 *   - tool/result.meta          —— 工具私有的产物描述（常见 filename / path / url）
 * 这里按事件 type 做定点抽取，不再递归扫描事件对象的任意字段，
 * 避免把 turn / step / preset 等非产物字段误当成产物。
 * meta 的具体字段名属工具私有，仍需按实机结果核对 nameOfFile / urlOfValue。
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
  /** 附件服务托管的字节引用 id；通过 SessionFace.readAttachment 读取渲染。 */
  attachmentId?: string
}

type ArtifactDebug = {
  sourceConnected: boolean
  entryCount: number
  eventCount: number
  eventTypes: string[]
  lastEvents: string[]
  error?: string
}

type ArtifactManagerSnapshot = {
  artifacts: Artifact[]
  session: any | null
  sessionId: string | null
  debug: ArtifactDebug
}

/**
 * 学习产物管理器与 UI 生命周期解耦。
 *
 * 关键点：TeacherMarketplace 只是一个面板，点击“开始学习”后会被 close()
 * 卸载；Harness Session 本身不会消失。因此事件订阅不能放在面板组件的
 * useEffect 里，否则面板一关，后续老师生成的 HTML / 视频就没人监听了。
 *
 * ArtifactManager 在 apply() 生命周期内常驻：
 *   Harness Session -> eventSource -> ArtifactManager -> React 面板
 */
class ArtifactManager {
  private readonly listeners = new Set<() => void>()
  private ref: any | null = null
  private unsubscribe: (() => void) | undefined
  private snapshotValue: ArtifactManagerSnapshot = {
    artifacts: [],
    session: null,
    sessionId: null,
    debug: {
      sourceConnected: false,
      entryCount: 0,
      eventCount: 0,
      eventTypes: [],
      lastEvents: [],
    },
  }

  constructor(private readonly ctx: any) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot(): ArtifactManagerSnapshot {
    return this.snapshotValue
  }

  /** 页面重新打开/插件热重载后，自动接回当前最新 Harness Session。 */
  watchLatestSession(): void {
    const byId = this.ctx.sessions?.list?.getSnapshot?.().byId ?? {}
    const live = (Object.values(byId) as any[])
      .filter((item: any) => !item.removed && item.blank !== true)
      .sort((a: any, b: any) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
    if (live?.id) this.watchSession(live.id)
  }

  watchSession(sessionId: string): void {
    if (this.snapshotValue.sessionId === sessionId && this.ref !== null) return

    this.stopCurrentSession()

    const sessions = this.ctx.sessions
    if (!sessions || typeof sessions.retain !== 'function') return

    try {
      const ref = sessions.retain(sessionId, { source: 'controllerOperation' })
      this.ref = ref
      this.snapshotValue = {
        artifacts: [],
        session: ref.binding?.session ?? null,
        sessionId,
        debug: {
          sourceConnected: false,
          entryCount: 0,
          eventCount: 0,
          eventTypes: [],
          lastEvents: [],
        },
      }

      // 当前版本的公开 ClientSession 直接暴露 eventSource；旧运行时兼容 binding.eventSource。
      const source = ref.binding?.session?.eventSource ?? ref.binding?.eventSource

      const sync = (): void => {
        try {
          const window = source?.getSnapshot?.()
          const entries = window?.entries ?? []
          const events = entries
            .filter((entry: any) => entry?.type === 'event')
            .map((entry: any) => entry?.event)
            .filter((event: any) => event && typeof event === 'object')
          const eventTypes: string[] = [...new Set(events.map((event: any) => String(event.type ?? 'unknown')))] as string[]
          const lastEvents = events.slice(-8).map((event: any) => {
            try {
              return JSON.stringify({
                type: event.type,
                seq: event.seq,
                data: event.data,
              }).slice(0, 1200)
            } catch {
              return '[无法序列化 event]'
            }
          })
          const artifacts = extractArtifacts(entries)
          this.snapshotValue = {
            artifacts,
            session: ref.binding?.session ?? this.snapshotValue.session,
            sessionId,
            debug: {
              sourceConnected: Boolean(source),
              entryCount: entries.length,
              eventCount: events.length,
              eventTypes,
              lastEvents,
            },
          }
          this.emit()
        } catch (reason) {
          this.snapshotValue = {
            ...this.snapshotValue,
            debug: {
              ...this.snapshotValue.debug,
              sourceConnected: Boolean(source),
              error: errorMessage(reason),
            },
          }
          this.emit()
        }
      }

      // 当前版本的公开 ClientSession 直接暴露 eventSource；部分旧运行时
      // retain() 返回的 binding 也暴露同一个 source，因此两者兼容。
      if (source && typeof source.subscribe === 'function') {
        this.unsubscribe = source.subscribe(sync)
      }
      sync()
    } catch {
      this.ref = null
      this.snapshotValue = {
        artifacts: [],
        session: null,
        sessionId: null,
        debug: {
          sourceConnected: false,
          entryCount: 0,
          eventCount: 0,
          eventTypes: [],
          lastEvents: [],
        },
      }
    }
  }

  dispose(): void {
    this.stopCurrentSession()
    this.listeners.clear()
  }

  private stopCurrentSession(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    try {
      this.ref?.release?.()
    } catch {
      // Ignore release failures during plugin shutdown/session switching.
    }
    this.ref = null
    this.snapshotValue = {
      artifacts: [],
      session: null,
      sessionId: null,
      debug: {
        sourceConnected: false,
        entryCount: 0,
        eventCount: 0,
        eventTypes: [],
        lastEvents: [],
      },
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

function kindOfName(name: string): ArtifactKind {
  const lower = name.toLowerCase()
  if (/\.html?$/.test(lower)) return 'html'
  if (/\.(mp4|webm|mov|m4v)$/.test(lower)) return 'video'
  if (/\.(png|jpe?g|gif|webp|svg)$/.test(lower)) return 'image'
  return 'file'
}

/** 从字符串里找出可能是"文件路径/文件名"的尾巴（去掉标点与杂讯）。 */
function fileNameTail(value: string): string | undefined {
  if (value.trim() === '') return undefined
  const m = value.match(/([^/\\\s"'`(){}\[\],;:]*\.(?:html?|mp4|webm|mov|m4v|png|jpe?g|gif|webp|svg|pdf))(?:[)\]}])?$/i)
  return m ? m[1] : undefined
}

/** 判断一个字符串是否真的可当 URL 用（避免把普通文本当链接）。 */
function isUrlLike(value: string): boolean {
  return /^(https?:|blob:|data:|file:)/i.test(value)
}

/** 提取文本里的 markdown 引用，兼容图片 ![alt](<path>) 与普通链接 [alt](<path>)，
 *  用于识别贴在回复里生成的视频/图片/文件。 */
function markdownRefsFrom(text: string): Array<{ alt: string; url: string }> {
  // 生成器既会输出 [视频](<绝对路径>)，也会输出 [视频](绝对路径)。
  // 后者不能只按“图片语法”解析，否则 tool/call 已生成的视频不会进入产物列表。
  return Array.from(text.matchAll(/!?\[([^\]]*?)\]\(\s*(?:<([^<>]+)>|([^)]*?))\s*\)/g)).map(m => ({
    alt: m[1] ?? '',
    url: (m[2] ?? m[3] ?? '').trim(),
  }))
}

/** 从一个"可能的产物对象"里收集 id/文件名/路径。值精确对应 file/image 内容块。 */
function collectContentBlocks(content: unknown, out: Artifact[]): void {
  if (!Array.isArray(content)) return
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const rec = block as Record<string, unknown>
    if (rec['type'] === 'file' || rec['type'] === 'image') {
      const att = rec['attachment']
      const name = (att !== null && typeof att === 'object')
        ? (att as Record<string, unknown>)['name']
        : undefined
      const attachmentId = (att !== null && typeof att === 'object')
        ? (att as Record<string, unknown>)['attachmentId']
        : undefined
      const title = typeof name === 'string' && name !== ''
        ? name
        : (rec['type'] === 'image' ? '图片产物' : '文件产物')
      const next: Omit<Artifact, 'id'> = {
        kind: rec['type'] === 'image' ? 'image' : kindOfName(title),
        title,
      }
      if (typeof attachmentId === 'string') next.attachmentId = attachmentId
      pushArtifact(out, next)
    }
  }
}

/**
 * 从一个事件里取产物：只读明确的 data 字段，不递归整棵事件树。
 * SessionEvent 结构：{ type, seq, time, data: { turn, step, message, meta? } }。
 * 产物信息在 data.message.content（file/image/text 内容块）与
 * data.meta（工具私有的产物描述）。旧版误读 event.message 顶层，现改为 data.*。
 */
function collectFromEvent(event: unknown, out: Artifact[]): void {
  if (event === null || typeof event !== 'object') return

  // 不同 Harness/工具版本对 tool/result 的 payload 包装层并不完全一致：
  // 有的放在 data.message.content，有的直接是 data.content / data.result，
  // 还有工具把文件引用放进 artifact/output/result 的对象里。
  // 因此这里不再押注单一字段路径，而是对“产物相关字段”做有限深度扫描。
  const seen = new Set<object>()

  const visit = (value: unknown, depth: number): void => {
    if (value === null || value === undefined || depth > 5) return

    if (typeof value === 'string') {
      // markdown 图片引用：![alt](</abs/path.mp4>)
      // 教师常用它把生成的视频/图片贴进 assistant 消息文本里。
      for (const ref of markdownRefsFrom(value)) {
        const refUrl = ref.url
        const tail = fileNameTail(refUrl)
        if (tail !== undefined && isUrlLike(refUrl)) {
          pushArtifact(out, { kind: kindOfName(tail), title: ref.alt !== '' ? ref.alt : decodeURIComponent(tail), url: refUrl })
        } else if (tail !== undefined) {
          // 宿主工作区绝对路径（非 http/blob）：不可内联，仅记录 path 供跳转。
          pushArtifact(out, { kind: kindOfName(tail), title: ref.alt !== '' ? ref.alt : decodeURIComponent(tail), path: refUrl })
        }
      }

      const body = htmlBodyFrom(value)
      if (body !== undefined) {
        pushArtifact(out, { kind: 'html', title: htmlTitleFrom(body) ?? '学习文档', html: body })
        return
      }
      // tool/call.arguments 通常是 JSON 字符串：{"html":"<!doctype html>..."} 或
      // {"path": "/abs/ComplexEquation.mp4"}。解一层再继续，才能拿到真正产物引用。
      try {
        const parsed = JSON.parse(value)
        if (parsed !== value) visit(parsed, depth + 1)
      } catch {
        // 普通文本不是产物，忽略。
      }
      return
    }

    if (typeof value !== 'object') return
    if (seen.has(value as object)) return
    seen.add(value as object)

    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }

    const rec = value as Record<string, unknown>

    // openmaic_widget 的真正 HTML 产物直接位于 tool/result.meta.html，
    // 或经过 JSON 包装后位于 tool/call.data.arguments.html。
    const directHtml = rec['html']
    if (typeof directHtml === 'string') {
      const body = htmlBodyFrom(directHtml)
      if (body !== undefined) {
        pushArtifact(out, { kind: 'html', title: htmlTitleFrom(body) ?? '学习文档', html: body })
      }
    }

    // 标准 file/image 内容块。
    if (rec['type'] === 'file' || rec['type'] === 'image') {
      collectContentBlocks([rec], out)
    }

    // 产物对象常见的直接引用字段。arguments 一定要纳入：tool/call 的
    // data.arguments 是 JSON 字符串 {"path": "...mp4", "html": "..."}，
    // 必须解出来才能拿到 dshmath-manim / dsh_im_return_file 生成的视频。
    const artifactish = ['data', 'artifact', 'artifacts', 'attachment', 'attachments', 'output', 'outputs', 'result', 'content', 'message', 'meta', 'file', 'files', 'arguments']
    for (const key of artifactish) {
      if (key in rec) visit(rec[key], depth + 1)
    }

    // 对明确的 URL/路径/文件名字段直接收集；不会把普通文本当成产物。
    for (const key of ['url', 'src', 'href', 'uri', 'previewUrl', 'playUrl', 'file', 'filename', 'name', 'path']) {
      const value = rec[key]
      if (typeof value === 'string') {
        const body = htmlBodyFrom(value)
        if (body !== undefined) {
          pushArtifact(out, { kind: 'html', title: '学习文档', html: body })
        } else if (isUrlLike(value)) {
          pushArtifact(out, { kind: kindOfName(value), title: fileNameTail(value) ?? '学习资源', url: value })
        } else {
          const tail = fileNameTail(value)
          if (tail !== undefined) {
            pushArtifact(out, { kind: kindOfName(tail), title: decodeURIComponent(tail), path: value })
          }
        }
      }
    }
  }

  visit(event, 0)
}

/** 工具私有 meta 的宽容探测：只认明确的 filename/path/url/html 字段。 */
function collectFromMeta(meta: Record<string, unknown>, out: Artifact[]): void {
  const candidate = (value: unknown): void => {
    if (typeof value !== 'string' || value.trim() === '') return
    const body = htmlBodyFrom(value)
    if (body !== undefined) {
      pushArtifact(out, { kind: 'html', title: '学习文档', html: body })
      return
    }
    if (isUrlLike(value)) {
      pushArtifact(out, { kind: kindOfName(value), title: fileNameTail(value) ?? '学习资源', url: value })
      return
    }
    const tail = fileNameTail(value)
    if (tail !== undefined) {
      pushArtifact(out, {
        kind: kindOfName(tail),
        title: decodeURIComponent(tail),
        // 有明确 /api/file 鉴权读端点时，把会话内相对路径扩成可预览 URL。
        path: value,
      })
    }
  }

  for (const key of ['url', 'src', 'href', 'uri', 'previewUrl', 'playUrl', 'file', 'filename', 'name', 'path']) {
    const v = meta[key]
    if (v === undefined) continue
    if (typeof v === 'string') candidate(v)
    else if (Array.isArray(v)) for (const item of v) candidate(item)
    else if (v !== null && typeof v === 'object') {
      for (const k of ['url', 'path', 'name', 'filename', 'html']) {
        const inner = (v as Record<string, unknown>)[k]
        if (typeof inner === 'string') candidate(inner)
      }
    }
  }
}

function pushArtifact(out: Artifact[], art: Omit<Artifact, 'id'>): void {
  const key = art.url ?? art.html ?? art.path ?? art.attachmentId ?? art.title
  if (out.some(existing => (existing.url ?? existing.html ?? existing.path ?? existing.attachmentId ?? existing.title) === key)) return
  out.push({ id: `art-${out.length}`, ...art })
}

function extractArtifacts(entries: readonly unknown[]): Artifact[] {
  const out: Artifact[] = []
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') continue
    const rec = entry as Record<string, unknown>
    if (rec['type'] !== 'event') continue // 过滤掉 'transient' 直播帧
    const event = rec['event']
    if (event === null || typeof event !== 'object') continue
    const etype = (event as Record<string, unknown>)['type']
    // GenUI / HTML 产物经常在 tool/call 的参数里生成，随后由原生 renderer
    // 直接渲染成页面；如果只监听 tool/result / assistant/message，就只能
    // 看到“已渲染”的说明文本，抓不到真正的 HTML 源。
    if (etype !== 'tool/call' && etype !== 'tool/result' && etype !== 'assistant/message') continue
    collectFromEvent(event, out)
  }
  return out
}

/** 从一段文本里识别 html 文档片段。 */
function htmlTitleFrom(html: string): string | undefined {
  const match = html.match(/<title[^>]*>\s*([^<]+?)\s*<\/title>/i)
  return match?.[1]?.trim() || undefined
}

function htmlBodyFrom(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (/^\s*<(!doctype|html|head|body|div|main|section|article|svg)/i.test(text)) return text

  // Tool 常把 HTML 放在 markdown code fence 中；先去掉 fence 再识别。
  const fenced = text.match(/^\s*```(?:html?|xhtml)?\s*\n([\s\S]*?)\n```\s*$/i)
  if (fenced?.[1] && /^\s*<(!doctype|html|head|body|div|main|section|article|svg)/i.test(fenced[1])) {
    return fenced[1]
  }
  return undefined
}

function TeacherMarketplace({ ctx, artifactManager, initialView, close }: {
  ctx: Context
  artifactManager: ArtifactManager
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

  // 学习产物由常驻 ArtifactManager 维护，不随 marketplace 面板卸载而停止。
  const [, forceArtifactUpdate] = useState(0)
  const [activeTab, setActiveTab] = useState<Artifact | null>(null)
  const artifactSnapshot = artifactManager.snapshot()
  const activeArtifacts = artifactSnapshot.artifacts
  const activeSession = artifactSnapshot.session

  useEffect(() => {
    // 打开面板时先接回已有 Harness Session；这样即使插件页面之前被关闭，
    // 或插件热重载过，也能从当前 Session 的事件窗口恢复历史产物。
    artifactManager.watchLatestSession()
    return artifactManager.subscribe(() => {
      forceArtifactUpdate(value => value + 1)
      setActiveTab(current => current)
    })
  }, [artifactManager])

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
      const session = await selectTeacherSession(ctx, teacher.presetId)
      artifactManager.watchSession(session.id)
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
    const active = activeTab !== null && activeArtifacts.some(item => item.id === activeTab.id)
      ? activeTab
      : (activeArtifacts[0] ?? null)
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
            <ArtifactDebugPanel debug={artifactSnapshot.debug} sessionId={artifactSnapshot.sessionId} />
          ) : (
            <ArtifactPreview
              artifact={active}
              session={activeSession}
              key={active.id}
              onOpenInSession={() => { void openSessionInHost(ctx, artifactSnapshot.sessionId) }}
            />
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

function ArtifactDebugPanel({ debug, sessionId }: { debug: ArtifactDebug; sessionId: string | null }): React.ReactElement {
  return (
    <div style={{ padding: 24, overflow: 'auto', height: '100%', fontFamily: 'monospace', fontSize: 12 }}>
      <h2 style={{ fontFamily: 'inherit' }}>产物调试信息</h2>
      <div>Session ID: {sessionId ?? '无'}</div>
      <div>eventSource: {debug.sourceConnected ? '已连接' : '未连接'}</div>
      <div>entries: {debug.entryCount}</div>
      <div>events: {debug.eventCount}</div>
      <div>event types: {debug.eventTypes.join(', ') || '无'}</div>
      {debug.error && <pre>读取事件失败：{debug.error}</pre>}
      <h3>最近 8 个事件（每个最多 1200 字符）</h3>
      {debug.lastEvents.length === 0 ? (
        <div>暂无事件。请先开始学习并让老师生成一次 HTML。</div>
      ) : (
        debug.lastEvents.map((item, index) => (
          <pre key={index} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginBottom: 12 }}>{item}</pre>
        ))
      )}
    </div>
  )
}


function ArtifactPreview({ artifact, session, onOpenInSession }: {
  artifact: Artifact
  session: any
  onOpenInSession?: () => void
}): React.ReactElement {
  const objectUrl = useAttachmentObjectUrl(session, artifact)
  const workspaceUrl = useWorkspaceFileObjectUrl(artifact.path)
  const url = objectUrl ?? workspaceUrl ?? artifact.url
  const useObjectUrl = (objectUrl ?? workspaceUrl) !== undefined && artifact.url === undefined
  const jump = (): void => { onOpenInSession?.() }

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
  if ((artifact.kind === 'video') && url !== undefined) {
    return <VideoArtifactPlayer artifact={artifact} url={url} />
  }
  if ((artifact.kind === 'image') && url !== undefined) {
    return <img className="dsh-artifact-media" src={url} alt={artifact.title} />
  }
  if ((artifact.kind === 'html' || artifact.kind === 'file') && url !== undefined) {
    return <iframe className="dsh-artifact-frame" title={artifact.title} src={url} sandbox="allow-scripts allow-same-origin" />
  }
  if (url !== undefined && !useObjectUrl) {
    return <iframe className="dsh-artifact-frame" title={artifact.title} src={url} sandbox="allow-scripts allow-same-origin" />
  }
  if (artifact.attachmentId !== undefined && url === undefined) {
    return (
      <div className="dsh-artifact-path">
        <div className="dsh-teacher-empty-icon">〙</div>
        <h2>{artifact.title}</h2>
        <span className="dsh-artifact-note">附件读取中或不可在此预览，可跳转到会话中打开查看。</span>
        {onOpenInSession !== undefined && (
          <button className="dsh-teacher-primary" onClick={jump}>在会话中打开</button>
        )}
      </div>
    )
  }
  if (artifact.path !== undefined) {
    return (
      <div className="dsh-artifact-path">
        <div className="dsh-teacher-empty-icon">〙</div>
        <h2>已定位产物文件</h2>
        <p>{artifact.path}</p>
        <span className="dsh-artifact-note">该文件为宿主工作区文件，读取失败或暂不可预览，可跳转到会话中打开查看。</span>
        {onOpenInSession !== undefined && (
          <button className="dsh-teacher-primary" onClick={jump}>在会话中打开</button>
        )}
      </div>
    )
  }
  return (
    <div className="dsh-artifacts-empty">
      <span>无法在此预览此产物</span>
      {onOpenInSession !== undefined && (
        <button className="dsh-teacher-primary" onClick={jump}>在会话中打开</button>
      )}
    </div>
  )
}

/** 视频产物优先在工作台内播放，并提供浏览器原生画中画入口。 */
function VideoArtifactPlayer({ artifact, url }: { artifact: Artifact; url: string }): React.ReactElement {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [pipError, setPipError] = useState('')

  const togglePictureInPicture = async (): Promise<void> => {
    const video = videoRef.current as (HTMLVideoElement & {
      requestPictureInPicture?: () => Promise<unknown>
    }) | null
    if (video === null) return
    setPipError('')
    try {
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture()
      } else if (typeof video.requestPictureInPicture === 'function') {
        await video.requestPictureInPicture()
      } else {
        setPipError('当前宿主不支持画中画，请使用播放器底部控件播放。')
      }
    } catch {
      setPipError('画中画暂时不可用，请先点击播放后再试。')
    }
  }

  return (
    <div className="dsh-artifact-video-shell">
      <video
        ref={videoRef}
        className="dsh-artifact-media"
        src={url}
        controls
        autoPlay
        muted
        playsInline
        preload="metadata"
        aria-label={artifact.title}
      />
      <div className="dsh-artifact-video-actions">
        <button type="button" className="dsh-teacher-secondary" onClick={() => { void togglePictureInPicture() }}>
          ⛶ 画中画播放
        </button>
        {pipError !== '' && <span className="dsh-artifact-note">{pipError}</span>}
      </div>
    </div>
  )
}

/** 通过 SessionFace.readAttachment(attachmentId) 把附件字节转成 blob URL，供预览渲染。 */
function useAttachmentObjectUrl(session: any, artifact: Artifact): string | undefined {
  const attachmentId = artifact.attachmentId
  const [url, setUrl] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (attachmentId === undefined) {
      setUrl(undefined)
      return
    }
    if (!session || typeof session.readAttachment !== 'function') {
      setUrl(undefined)
      return
    }
    let alive = true
    let objectUrl: string | undefined
    session
      .readAttachment(attachmentId)
      .then((result: any) => {
        if (!alive || !result?.ok) return
        const data = result.value?.data
        if (!(data instanceof Uint8Array) && !(data instanceof ArrayBuffer)) return
        const bytes = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
        const mediaType = result.value?.attachment?.mediaType
        const type = typeof mediaType === 'string' && mediaType !== ''
          ? mediaType
          : mediaTypeOfName(artifact.title)
        const blob = new Blob([bytes as ArrayBuffer], { type })
        objectUrl = URL.createObjectURL(blob)
        if (alive) setUrl(objectUrl)
      })
      .catch(() => {
        if (alive) setUrl(undefined)
      })
    return () => {
      alive = false
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl)
    }
  }, [session, artifact.attachmentId, artifact.title])

  return url
}

/** 通过宿主的鉴权读端点 GET /api/file?path=<绝对路径> 把工作区文件读成 blob URL。
 *  视频/图片/HTML 这类产物在会话里以绝对路径引用，宿主的 SessionMediaReferences
 *  注册了 /api/file 处理这些路径的字节读取，本端拉取后即可内联播放。 */
function useWorkspaceFileObjectUrl(path: string | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (path === undefined || path === '') {
      setUrl(undefined)
      return
    }
    let alive = true
    let objectUrl: string | undefined
    let controller = new AbortController()
    void (async () => {
      try {
        const res = await fetch(`/api/file?path=${encodeURIComponent(path)}`, {
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const blob = await res.blob()
        if (!alive) return
        objectUrl = URL.createObjectURL(blob)
        if (alive) setUrl(objectUrl)
      } catch {
        if (alive) setUrl(undefined)
      }
    })()
    return () => {
      alive = false
      controller.abort()
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl)
    }
  }, [path])

  return url
}

/** 从文件名扩展名推断一个可播放/可内嵌的 MIME（附件 FileAttachmentRef 不带 mediaType）。 */
function mediaTypeOfName(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.mp4')) return 'video/mp4'
  if (lower.endsWith('.webm')) return 'video/webm'
  if (lower.endsWith('.mov')) return 'video/quicktime'
  if (lower.endsWith('.m4v')) return 'video/x-m4v'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html'
  if (lower.endsWith('.pdf')) return 'application/pdf'
  return 'application/octet-stream'
}
