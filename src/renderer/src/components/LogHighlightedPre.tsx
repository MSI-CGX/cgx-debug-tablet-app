import { matchLogLineColor } from '@/lib/logLineColor'
import type { LogColorRule } from '../../../preload/types'

type Props = {
  text: string
  rules: LogColorRule[]
}

export default function LogHighlightedPre({ text, rules }: Props): JSX.Element {
  const lines = text.split(/\r?\n/)
  const defaultColor = 'var(--color-foreground)'
  return (
    <pre className="content log-content">
      {lines.map((line, i) => (
        <span
          key={i}
          style={{ color: matchLogLineColor(line, rules) ?? defaultColor }}
        >
          {line}
          {i < lines.length - 1 ? '\n' : ''}
        </span>
      ))}
    </pre>
  )
}
