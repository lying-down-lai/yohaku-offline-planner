import { describe, expect, it } from 'vitest'
import { newItem, type PlannerItem, type PlannerSettings } from './model'
import { scheduleTasks } from './scheduler'

const settings: PlannerSettings = { id: 'main', workStart: '09:00', workEnd: '18:00', includeWeekends: false }
const at = (hour: number, minute = 0) => new Date(2026, 10, 9, hour, minute)

function task(overrides: Partial<PlannerItem> = {}): PlannerItem {
  return { ...newItem('task'), title: '資料作成', estimatedMinutes: 60, ...overrides }
}

function event(start: Date, end: Date): PlannerItem {
  return { ...newItem('event'), title: '会議', startAt: start.toISOString(), endAt: end.toISOString() }
}

describe('scheduleTasks', () => {
  it('places tasks after fixed events without overlap', () => {
    const result = scheduleTasks([event(at(9), at(10)), task()], at(8), settings)
    expect(result.scheduled).toHaveLength(1)
    expect(result.scheduled[0].startAt).toBe(at(10).toISOString())
    expect(result.scheduled[0].endAt).toBe(at(11).toISOString())
  })

  it('leaves a task unscheduled when no slot ends by its deadline', () => {
    const result = scheduleTasks([event(at(9), at(10)), task({ deadline: at(9, 30).toISOString() })], at(8), settings)
    expect(result.scheduled).toHaveLength(0)
    expect(result.unscheduled).toHaveLength(1)
  })

  it('does not invent duration or schedule an unreviewed import', () => {
    const result = scheduleTasks([task({ estimatedMinutes: null }), task({ needsReview: true })], at(8), settings)
    expect(result.scheduled).toHaveLength(0)
    expect(result.unscheduled).toHaveLength(1)
  })

  it('never changes completion state and avoids collisions between new tasks', () => {
    const result = scheduleTasks([task(), task(), task({ completedAt: at(7).toISOString() })], at(8), settings)
    expect(result.scheduled).toHaveLength(2)
    expect(result.scheduled[0].endAt).toBe(result.scheduled[1].startAt)
  })
})
