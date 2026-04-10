export interface LogColorRule {
  id: string
  label: string
  /** ECMAScript RegExp body (no slashes). Tested with flag `i`. */
  pattern: string
  /** CSS color (hex or any valid CSS color). */
  color: string
}

export const DEFAULT_LOG_COLOR_RULES: LogColorRule[] = [
  {
    id: 'rule-error',
    label: 'Error',
    pattern: 'ERROR|FATAL|\\bERR\\b',
    color: '#f28b82'
  },
  {
    id: 'rule-warn',
    label: 'Warning',
    pattern: 'WARN|WARNING',
    color: '#fdd663'
  },
  {
    id: 'rule-info',
    label: 'Info',
    pattern: '\\bINFO\\b',
    color: '#8ab4f8'
  },
  {
    id: 'rule-debug',
    label: 'Debug',
    pattern: 'DEBUG|TRACE|VERBOSE',
    color: '#9aa0a6'
  }
]
