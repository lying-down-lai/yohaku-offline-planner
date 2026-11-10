import { expect, it } from 'vitest'
import { defaultSettings, newItem } from './model'
import { groupRepeats } from './groupRepeats'
import { expandItems } from './recurrence'
import { createBackup, parseBackup } from './transfer'

const event = (day: number, hour = 10) => ({ ...newItem('event'), title: '定例会',
  startAt: new Date(2026, 10, day, hour).toISOString(),
  endAt: new Date(2026, 10, day, hour + 1).toISOString() })

it('automatically groups three consecutive same-title, same-weekday fixed events without losing occurrences', () => {
  const items = [event(3), event(10), event(17)]
  const grouped = groupRepeats(items)
  expect(grouped.updates).toHaveLength(1)
  expect(grouped.removeIds).toHaveLength(2)
  const dates = expandItems(grouped.updates, new Date(2026, 10, 1), new Date(2026, 10, 18))
  expect(dates.map(item => item.occurrenceDate)).toEqual(['2026-11-03', '2026-11-10', '2026-11-17'])
})

it('infers two-week cycles but preserves differing times', () => {
  expect(groupRepeats([event(3), event(10)]).updates).toHaveLength(1)
  expect(groupRepeats([event(3), event(10, 11), event(17)]).removeIds).toHaveLength(1)
  expect(groupRepeats([event(3), event(17)]).updates[0].recurrence?.interval).toBe(2)
})

it('keeps the review flag when one grouped occurrence needs confirmation', () => {
  const grouped = groupRepeats([event(3), { ...event(10), needsReview: true }])
  expect(grouped.updates[0].needsReview).toBe(true)
})

it('ignores importance and duration for grouping while preserving each occurrence', () => {
  const first = { ...event(3), importance: 1, estimatedMinutes: 30 }
  const second = { ...event(10), importance: 5, estimatedMinutes: 90,
    endAt: new Date(2026, 10, 10, 12).toISOString() }
  const grouped = groupRepeats([first, second])
  expect(grouped.updates).toHaveLength(1)
  const restored = parseBackup(createBackup(grouped.updates, defaultSettings)).items
  const occurrences = expandItems(restored, new Date(2026, 10, 3), new Date(2026, 10, 11))
  expect(occurrences.map(item => item.importance)).toEqual([1, 5])
  expect(occurrences.map(item => item.estimatedMinutes)).toEqual([30, 90])
  expect(new Date(occurrences[1].endAt!).getHours()).toBe(12)
})
