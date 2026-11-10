import { describe, expect, it } from 'vitest'
import { newItem, defaultSettings } from './model'
import { expandItems, recurrenceDates } from './recurrence'
import { conflictsWithExisting, scheduleTasks } from './scheduler'
import { getTodayFlow } from './todayFlow'
import { createBackup, parseBackup } from './transfer'
import { dueReminders } from './reminders'

const day = (date: number, hour = 0) => new Date(2026, 10, date, hour)
const iso = (date: number, hour: number) => day(date, hour).toISOString()

describe('recurring items', () => {
  it('uses the anchor day for monthly repeats and includes the end date', () => {
    const dates = recurrenceDates({ frequency: 'monthly', interval: 1, startsOn: '2026-01-31', endsOn: '2026-03-31' },
      new Date(2026, 0, 1), new Date(2026, 3, 1))
    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
  })

  it('shows both an overnight occurrence and the next occurrence on the same day', () => {
    const event = { ...newItem('event'), title: '夜勤', startAt: iso(10, 23), endAt: iso(11, 1),
      recurrence: { frequency: 'daily' as const, interval: 1, startsOn: '2026-11-10', endsOn: '2026-11-12' } }
    const expanded = expandItems([event], day(11), day(12))
    expect(expanded.map(item => item.occurrenceDate)).toEqual(['2026-11-10', '2026-11-11'])
    expect(getTodayFlow(expanded, day(11, 12)).map(entry => entry.item.title)).toEqual(['夜勤', '夜勤'])
  })

  it('keeps task completion and reminders separate for each occurrence', () => {
    const task = { ...newItem('task'), title: '体操', startAt: iso(10, 9), endAt: iso(10, 10),
      recurrence: { frequency: 'daily' as const, interval: 1, startsOn: '2026-11-10', endsOn: '2026-11-12' },
      occurrenceCompletions: ['2026-11-10'] }
    const occurrences = expandItems([task], day(10), day(12))
    expect(occurrences.map(item => Boolean(item.completedAt))).toEqual([true, false])
    expect(dueReminders(occurrences, new Date(2026, 10, 11, 8, 55))).toHaveLength(1)
  })

  it('schedules undated repeated tasks on their own dates', () => {
    const task = { ...newItem('task'), title: '片付け', estimatedMinutes: 60,
      recurrence: { frequency: 'daily' as const, interval: 1, startsOn: '2026-11-10', endsOn: '2026-11-11' } }
    const expanded = expandItems([task], day(10), day(12))
    const result = scheduleTasks(expanded, day(10, 8), defaultSettings, 2)
    expect(result.scheduled).toHaveLength(2)
    expect(result.scheduled.map(slot => new Date(slot.startAt).getDate())).toEqual([10, 11])
  })

  it('detects a conflict on a later repeat and preserves the series in backup', () => {
    const repeat = { ...newItem('event'), title: '会議', startAt: iso(10, 10), endAt: iso(10, 11),
      recurrence: { frequency: 'daily' as const, interval: 1, startsOn: '2026-11-10', endsOn: '2026-11-12' } }
    const other = { ...newItem('event'), title: '別の会議', startAt: iso(12, 10), endAt: iso(12, 11) }
    expect(conflictsWithExisting(repeat, [other])).toBe(true)
    const restored = parseBackup(createBackup([repeat], defaultSettings))
    expect(restored.items).toHaveLength(1)
    expect(restored.items[0].recurrence).toEqual(repeat.recurrence)
  })

  it('round trips per-occurrence completion and scheduled slots', () => {
    const task = { ...newItem('task'), title: '片付け',
      recurrence: { frequency: 'daily' as const, interval: 1, startsOn: '2026-11-10', endsOn: '2026-11-12' },
      occurrenceCompletions: ['2026-11-10'],
      occurrenceSlots: { '2026-11-11': { startAt: iso(11, 9), endAt: iso(11, 10) } } }
    const restored = parseBackup(createBackup([task], defaultSettings)).items[0]
    expect(restored.occurrenceCompletions).toEqual(['2026-11-10'])
    expect(restored.occurrenceSlots).toEqual(task.occurrenceSlots)
  })
})
