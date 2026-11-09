import { addDays, isWeekend, parseISO, startOfDay } from 'date-fns'
import type { PlannerItem, PlannerSettings } from './model'

export interface ScheduleResult {
  scheduled: Array<{ id: string; startAt: string; endAt: string }>
  unscheduled: Array<{ id: string; reason: string }>
}

type Span = { start: number; end: number }
const quarterHour = 15 * 60_000

function minutesOfDay(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

function roundUp(time: number): number {
  return Math.ceil(time / quarterHour) * quarterHour
}

function localTimeOn(day: Date, value: string): number {
  const minutes = minutesOfDay(value)
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60).getTime()
}

function validSpan(item: PlannerItem): Span | null {
  if (!item.startAt || !item.endAt) return null
  const start = parseISO(item.startAt).getTime()
  const end = parseISO(item.endAt).getTime()
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null
}

function overlap(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end
}

/** Pure scheduling logic: no browser, database or UI dependencies. */
export function scheduleTasks(
  items: PlannerItem[],
  now: Date,
  settings: PlannerSettings,
  horizonDays = 30
): ScheduleResult {
  const result: ScheduleResult = { scheduled: [], unscheduled: [] }
  const busy = items
    .filter(item => item.type === 'event' || (item.type === 'task' && !item.completedAt))
    .map(validSpan)
    .filter((span): span is Span => span !== null)

  const tasks = items
    .filter(item => item.type === 'task' && !item.completedAt && !item.needsReview && !validSpan(item))
    .sort((a, b) => {
      const aDeadline = a.deadline ? parseISO(a.deadline).getTime() : Infinity
      const bDeadline = b.deadline ? parseISO(b.deadline).getTime() : Infinity
      return aDeadline - bDeadline || (b.importance ?? 0) - (a.importance ?? 0) || a.createdAt.localeCompare(b.createdAt)
    })

  for (const task of tasks) {
    const duration = task.estimatedMinutes
    if (duration === null || !Number.isFinite(duration) || duration <= 0) {
      result.unscheduled.push({ id: task.id, reason: '所要時間を設定してください' })
      continue
    }
    const deadline = task.deadline ? parseISO(task.deadline).getTime() : Infinity
    let chosen: Span | null = null

    for (let dayOffset = 0; dayOffset <= horizonDays && !chosen; dayOffset++) {
      const day = addDays(startOfDay(now), dayOffset)
      if (!settings.includeWeekends && isWeekend(day)) continue
      const dayStart = localTimeOn(day, settings.workStart)
      const dayEnd = localTimeOn(day, settings.workEnd)
      let cursor = roundUp(Math.max(dayStart, now.getTime()))
      const latestEnd = Math.min(dayEnd, deadline)

      while (cursor + duration * 60_000 <= latestEnd) {
        const candidate = { start: cursor, end: cursor + duration * 60_000 }
        const conflict = busy.find(span => overlap(candidate, span))
        if (!conflict) {
          chosen = candidate
          break
        }
        cursor = roundUp(Math.max(cursor + quarterHour, conflict.end))
      }
    }

    if (chosen) {
      busy.push(chosen)
      result.scheduled.push({
        id: task.id,
        startAt: new Date(chosen.start).toISOString(),
        endAt: new Date(chosen.end).toISOString()
      })
    } else {
      result.unscheduled.push({ id: task.id, reason: '期限までの空き時間がありません' })
    }
  }

  return result
}

export function conflictsWithExisting(candidate: PlannerItem, items: PlannerItem[]): boolean {
  const span = validSpan(candidate)
  return Boolean(span && items.some(item => item.id !== candidate.id && !item.completedAt && (() => {
    const other = validSpan(item)
    return other ? overlap(span, other) : false
  })()))
}
