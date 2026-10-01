import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-teacher-marketplace'
export const inject: string[] = []

export function apply(_ctx: Context): void {
  // Client UI and Agent Preset composition are loaded through the package
  // exports / cordis.patch.yml. The node half intentionally has no runtime
  // behavior of its own.
}
