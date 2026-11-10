import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import type { PlannerItem } from './model'

export interface GroupedRepeats { updates: PlannerItem[]; removeIds: string[] }

/** Match recurring starts; preserve per-occurrence duration and task attributes. */
export function groupRepeats(items: PlannerItem[]): GroupedRepeats {
  const buckets = new Map<string, PlannerItem[]>()
  for (const item of items) {
    if (item.recurrence || (item.type === 'event' && (!item.startAt || !item.endAt))) continue
    const anchor = item.startAt ?? item.deadline
    if (!anchor) continue
    const date = parseISO(anchor)
    if (!Number.isFinite(date.getTime())) continue
    const span = item.startAt && item.endAt ? Date.parse(item.endAt) - Date.parse(item.startAt) : null
    if (span !== null && span <= 0) continue
    const key = JSON.stringify([item.type, item.title.normalize('NFKC').trim().toLocaleLowerCase(),
      date.getDay(), format(date, 'HH:mm:ss'), item.notes,
      item.fixed, item.reminderMinutes,
      item.deadline ? [differenceInCalendarDays(parseISO(item.deadline), date), format(parseISO(item.deadline), 'HH:mm:ss')] : null,
      item.type === 'task' && Boolean(item.startAt)])
    buckets.set(key, [...(buckets.get(key) ?? []), item])
  }
  const updates: PlannerItem[] = []
  const removeIds: string[] = []
  for (const group of buckets.values()) {
    const sorted = group.sort((a, b) => Date.parse((a.startAt ?? a.deadline)!) - Date.parse((b.startAt ?? b.deadline)!))
    let run: PlannerItem[] = []
    let stepDays = 0
    const flush = () => {
      if (run.length < 2) { run = []; return }
      const first = run[0]
      const dates = run.map(item => format(parseISO((item.startAt ?? item.deadline)!), 'yyyy-MM-dd'))
      const sourceText = run.map(item => item.sourceText).filter(Boolean).join('\n')
      if (sourceText.length > 10000) { run = []; return }
      const occurrenceAttributes = { ...first.occurrenceAttributes }
      const occurrenceSlots = { ...first.occurrenceSlots }
      const endShape = (item: PlannerItem) => item.startAt && item.endAt
        ? `${differenceInCalendarDays(parseISO(item.endAt), parseISO(item.startAt))}:${format(parseISO(item.endAt), 'HH:mm:ss')}` : null
      for (let index = 1; index < run.length; index++) {
        const item = run[index]
        const date = dates[index]
        if (item.estimatedMinutes !== first.estimatedMinutes || item.importance !== first.importance) {
          occurrenceAttributes[date] = { estimatedMinutes: item.estimatedMinutes, importance: item.importance }
        }
        if (item.startAt && item.endAt && endShape(item) !== endShape(first)) {
          occurrenceSlots[date] = { startAt: item.startAt, endAt: item.endAt }
        }
      }
      updates.push({ ...first, sourceText, needsReview: run.some(item => item.needsReview),
        occurrenceAttributes, occurrenceSlots, aiAssessment: null,
        recurrence: { frequency: 'weekly', interval: stepDays / 7,
        startsOn: dates[0], endsOn: dates[dates.length - 1] },
        occurrenceCompletions: run.filter(item => Boolean(item.completedAt)).map(item =>
          format(parseISO((item.startAt ?? item.deadline)!), 'yyyy-MM-dd')),
        completedAt: null, updatedAt: new Date().toISOString() })
      removeIds.push(...run.slice(1).map(item => item.id))
      run = []
      stepDays = 0
    }
    for (const item of sorted) {
      if (run.length) {
        const difference = differenceInCalendarDays(parseISO((item.startAt ?? item.deadline)!),
          parseISO((run[run.length - 1].startAt ?? run[run.length - 1].deadline)!))
        if (difference <= 0 || difference % 7 !== 0 || difference > 365 * 7 ||
          (stepDays !== 0 && difference !== stepDays)) flush()
        else stepDays = difference
      }
      run.push(item)
    }
    flush()
  }
  return { updates, removeIds }
}
