import { addDays, isSameDay, parseISO, startOfDay } from 'date-fns'
import { compareItemTime } from './model'
import type { DisplayItem } from './recurrence'

export interface FlowEntry {
  item: DisplayItem
  gapBeforeMinutes: number | null
}

/** A deadline alone does not occupy time; only scheduled spans define gaps. */
export function getTodayFlow(items: DisplayItem[], now: Date): FlowEntry[] {
  const dayStart = startOfDay(now).getTime()
  const nextDay = addDays(startOfDay(now), 1).getTime()
  const visible = items.filter(item => {
    if (item.completedAt) return false
    if (item.startAt && item.endAt) {
      return Date.parse(item.startAt) < nextDay && Date.parse(item.endAt) > dayStart
    }
    return Boolean((item.occurrenceDate && isSameDay(parseISO(item.occurrenceDate), now)) ||
      (item.startAt && isSameDay(parseISO(item.startAt), now)) ||
      (item.deadline && isSameDay(parseISO(item.deadline), now)))
  }).sort(compareItemTime)

  let latestEnd: number | null = null
  return visible.map(item => {
    let gapBeforeMinutes: number | null = null
    if (item.startAt && item.endAt) {
      const start = Date.parse(item.startAt)
      const end = Date.parse(item.endAt)
      if (end > start) {
        if (latestEnd !== null && start > latestEnd) {
          gapBeforeMinutes = Math.floor((start - latestEnd) / 60_000) || null
        }
        latestEnd = Math.max(latestEnd ?? end, end)
      }
    }
    return { item, gapBeforeMinutes }
  })
}

export function formatGap(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return hours ? `${hours}時間${remainder ? `${remainder}分` : ''}` : `${remainder}分`
}
