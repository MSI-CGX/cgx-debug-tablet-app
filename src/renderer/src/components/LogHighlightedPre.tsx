import type { LogHighlightRule } from '../../../preload/types'
import { colorForLogLine } from '@/lib/logLineColor'

type LogHighlightedPreProps = {
  content: string
  rules: LogHighlightRule[]
}

export default function LogHighlightedPre({
  content,
  rules
}: LogHighlightedPreProps): JSX.Element {
  const lines = content.split('\n')
  return (
    <pre className="content log-highlight-pre">
      {lines.map((line, i) => {
        const color = colorForLogLine(line, rules)
        return (
          <span key={i} style={color ? { color } : undefined}>
            {line}
            {i < lines.length - 1 ? '\n' : ''}
          </span>
        )
      })}
    </pre>
  )
}
