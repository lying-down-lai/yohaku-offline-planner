import {
  addDays, addMonths, addWeeks, addYears, differenceInCalendarDays,
  differenceInCalendarMonths, differenceInCalendarYears, format, parseISO,
  startOfDay, subDays
} from 'date-fns'
import type { PlannerItem, RecurrenceRule } from './model'

export type DisplayItem = PlannerItem & { seriesId?: string; occurrenceDate?: string }

const datePattern = /^\d{4}-\d{2}-\d{2}$/

export function validDateKey(value: string): boolean {
  if (!datePattern.test(value)) return false
  const date = parseISO(value)
  return Number.isFinite(date.getTime()) && format(date, 'yyyy-MM-dd') === value
}

export function validRecurrence(rule: RecurrenceRule): boolean {
  return validDateKey(rule.startsOn) && validDateKey(rule.endsOn) &&
    rule.startsOn <= rule.endsOn && Number.isInteger(rule.interval) &&
    rule.interval >= 1 && rule.interval <= 365 &&
    ['daily', 'weekly', 'monthly', 'yearly'].includes(rule.frequency)
}

function onCycle(rule: RecurrenceRule, index: number): Date {
  const anchor = parseISO(rule.startsOn)
  const count = index * rule.interval
  switch (rule.frequency) {
    case 'daily': return addDays(anchor, count)
    case 'weekly': return addWeeks(anchor, count)
    case 'monthly': return addMonths(anchor, count)
    case 'yearly': return addYears(anchor, count)
  }
}

/** The anchor is used for every step, so monthly dates do not drift after short months. */
export function recurrenceDates(rule: RecurrenceRule, from: Date, untilExclusive: Date): string[] {
  if (!validRecurrence(rule) || untilExclusive <= from) return []
  const anchor = parseISO(rule.startsOn)
  const distance = rule.frequency === 'daily' ? differenceInCalendarDays(from, anchor)
    : rule.frequency === 'weekly' ? differenceInCalendarDays(from, anchor) / 7
      : rule.frequency === 'monthly' ? differenceInCalendarMonths(from, anchor)
        : differenceInCalendarYears(from, anchor)
  const firstIndex = Math.max(0, Math.floor(distance / rule.interval) - 2)
  const dates: string[] = []
  for (let index = firstIndex; index < firstIndex + 10000; index++) {
    const date = onCycle(rule, index)
    const key = format(date, 'yyyy-MM-dd')
    if (key > rule.endsOn || date >= untilExclusive) break
    if (date >= from && key >= rule.startsOn) dates.push(key)
  }
  return dates
}

function moveLocalTime(value: string, dateKey: string, dayOffset = 0): string {
  const original = parseISO(value)
  const day = addDays(parseISO(dateKey), dayOffset)
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(),
    original.getHours(), original.getMinutes(), original.getSeconds(), original.getMilliseconds()).toISOString()
}

export function occurrenceId(seriesId: string, dateKey: string): string {
  return `${seriesId}::${dateKey}`
}

export function expandOccurrence(item: PlannerItem, dateKey: string): DisplayItem {
  if (!item.recurrence) return item
  const templateStart = item.startAt
  const templateEnd = item.endAt
  const endOffset = templateStart && templateEnd
    ? differenceInCalendarDays(parseISO(templateEnd), parseISO(templateStart)) : 0
  const slot = item.occurrenceSlots?.[dateKey]
  const attributes = item.occurrenceAttributes?.[dateKey]
  const startAt = slot?.startAt ?? (templateStart ? moveLocalTime(templateStart, dateKey) : null)
  const endAt = slot?.endAt ?? (templateEnd ? moveLocalTime(templateEnd, dateKey, endOffset) : null)
  const deadlineOffset = item.deadline
    ? differenceInCalendarDays(parseISO(item.deadline), parseISO(item.recurrence.startsOn)) : 0
  const deadline = item.deadline ? moveLocalTime(item.deadline, dateKey, deadlineOffset) : null
  return {
    ...item,
    id: occurrenceId(item.id, dateKey),
    seriesId: item.id,
    occurrenceDate: dateKey,
    startAt,
    endAt,
    deadline,
    estimatedMinutes: attributes ? attributes.estimatedMinutes : item.estimatedMinutes,
    importance: attributes ? attributes.importance : item.importance,
    completedAt: item.occurrenceCompletions?.includes(dateKey) ? item.updatedAt : null
  }
}

/** Non-recurring items remain as-is. Recurring items are projected, never stored as copies. */
export function expandItems(items: PlannerItem[], from: Date, untilExclusive: Date): DisplayItem[] {
  const result: DisplayItem[] = []
  for (const item of items) {
    if (!item.recurrence) { result.push(item); continue }
    const spanDays = item.startAt && item.endAt
      ? Math.max(0, differenceInCalendarDays(parseISO(item.endAt), parseISO(item.startAt))) : 0
    const lookback = subDays(startOfDay(from), spanDays + 1)
    for (const date of recurrenceDates(item.recurrence, lookback, untilExclusive)) {
      const occurrence = expandOccurrence(item, date)
      const start = occurrence.startAt ? Date.parse(occurrence.startAt) : parseISO(date).getTime()
      const end = occurrence.endAt ? Date.parse(occurrence.endAt) : addDays(parseISO(date), 1).getTime()
      if (start < untilExclusive.getTime() && end > from.getTime()) result.push(occurrence)
    }
  }
  return result
}

export function recurrenceLabel(rule: RecurrenceRule): string {
  const unit = { daily: '日', weekly: '週', monthly: 'か月', yearly: '年' }[rule.frequency]
  const cycle = rule.interval === 1
    ? { daily: '毎日', weekly: '毎週', monthly: '毎月', yearly: '毎年' }[rule.frequency]
    : `${rule.interval}${unit}ごと`
  return `${cycle} · ${rule.endsOn}まで`
}
