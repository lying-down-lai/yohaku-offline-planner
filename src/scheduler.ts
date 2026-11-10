import { addDays, format, isWeekend, parseISO, startOfDay } from 'date-fns'
import type { PlannerItem, PlannerSettings } from './model'
import { expandItems, type DisplayItem } from './recurrence'

export interface ScheduleResult {
  scheduled: Array<{ id: string; startAt: string; endAt: string }>
  unscheduled: Array<{ id: string; reason: string }>
  warnings: string[]
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
  const result: ScheduleResult = { scheduled: [], unscheduled: [], warnings: [] }
  const busy = items
    .filter(item => item.type === 'event' || (item.type === 'task' && !item.completedAt))
    .map(validSpan)
    .filter((span): span is Span => span !== null)
  for (const item of items) {
    if (item.type !== 'event' || item.completedAt || item.endAt) continue
    if (!item.startAt) {
      result.warnings.push(`「${item.title}」は開始・終了が不明なため、時間の衝突を完全には検証できません`)
      continue
    }
    const start = Date.parse(item.startAt)
    if (!Number.isFinite(start)) continue
    busy.push({ start, end: addDays(startOfDay(now), horizonDays + 1).getTime() })
    result.warnings.push(`「${item.title}」は終了時刻が不明なため、開始後の計画期間を空き時間とみなしません`)
  }

  const tasks = items
    .filter(item => item.type === 'task' && !item.completedAt && !validSpan(item))
    .sort((a, b) => {
      const aDeadline = a.deadline ? parseISO(a.deadline).getTime() : Infinity
      const bDeadline = b.deadline ? parseISO(b.deadline).getTime() : Infinity
      return aDeadline - bDeadline || (b.importance ?? 0) - (a.importance ?? 0) ||
        (settings.priorityTieBreaker === 'shorter' ? (a.estimatedMinutes ?? Infinity) - (b.estimatedMinutes ?? Infinity) : 0) ||
        a.createdAt.localeCompare(b.createdAt)
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
      const occurrenceDate = (task as DisplayItem).occurrenceDate
      if (occurrenceDate && format(day, 'yyyy-MM-dd') !== occurrenceDate) continue
      if ((!settings.includeWeekends && isWeekend(day)) || settings.excludedWeekdays?.includes(day.getDay())) continue
      const dayStart = localTimeOn(day, settings.workStart)
      const nextDay = addDays(day, 1)
      const nextDayAllowed = (settings.includeWeekends || !isWeekend(nextDay)) &&
        !settings.excludedWeekdays?.includes(nextDay.getDay())
      const sleepCutoff = nextDayAllowed
        ? localTimeOn(nextDay, settings.workStart) - settings.sleepTargetMinutes * 60_000 : Infinity
      const dayEnd = Math.min(localTimeOn(day, settings.workEnd), sleepCutoff)
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
      result.unscheduled.push({ id: task.id, reason: task.deadline && deadline < now.getTime()
        ? '期限が過ぎています' : '期限までの作業時間に空き枠がありません' })
    }
  }

  return result
}

export function conflictsWithExisting(candidate: PlannerItem, items: PlannerItem[]): boolean {
  if (!candidate.startAt || !candidate.endAt) return false
  const from = candidate.recurrence ? parseISO(candidate.recurrence.startsOn) : parseISO(candidate.startAt)
  const until = candidate.recurrence ? addDays(parseISO(candidate.recurrence.endsOn), 2) : addDays(parseISO(candidate.endAt), 1)
  const candidates = expandItems([candidate], from, until).map(validSpan).filter((span): span is Span => span !== null)
  const occupied = expandItems(items.filter(item => item.id !== candidate.id && !item.completedAt), from, until)
    .filter(item => !item.completedAt).map(validSpan).filter((span): span is Span => span !== null)
  return candidates.some(span => occupied.some(other => overlap(span, other)))
}
