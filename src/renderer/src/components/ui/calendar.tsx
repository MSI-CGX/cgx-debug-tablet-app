import type { DayPickerProps } from 'react-day-picker'
import { DayPicker } from 'react-day-picker'

import { cn } from '@/lib/utils'

import 'react-day-picker/style.css'

export type CalendarProps = DayPickerProps

export function Calendar({ className, ...props }: CalendarProps): JSX.Element {
  return <DayPicker className={cn('rdp-root', 'lmdb-day-picker', className)} {...props} />
}
