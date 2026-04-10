import type { LogColorRule } from '../../../preload/types'

export function matchLogLineColor(line: string, rules: LogColorRule[]): string | null {
  for (const r of rules) {
    try {
      const re = new RegExp(r.pattern, 'i')
      if (re.test(line)) return r.color
    } catch {
      continue
    }
  }
  return null
}
