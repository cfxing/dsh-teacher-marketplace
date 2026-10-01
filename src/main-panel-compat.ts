import React from 'react'
import type { Context } from '@deepseek-ai/cordis'

export function registerMainPanel(
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
