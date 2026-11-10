import { describe, expect, it } from 'vitest'
import { defaultSettings, newItem, type PlannerItem, type PlannerSettings } from './model'
import { scheduleTasks } from './scheduler'

const settings: PlannerSettings = { ...defaultSettings }
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

  it('does not invent duration and can provisionally schedule an unreviewed import', () => {
    const result = scheduleTasks([task({ estimatedMinutes: null }), task({ needsReview: true })], at(8), settings)
    expect(result.scheduled).toHaveLength(1)
    expect(result.unscheduled).toHaveLength(1)
  })

  it('never changes completion state and avoids collisions between new tasks', () => {
    const result = scheduleTasks([task(), task(), task({ completedAt: at(7).toISOString() })], at(8), settings)
    expect(result.scheduled).toHaveLength(2)
    expect(result.scheduled[0].endAt).toBe(result.scheduled[1].startAt)
  })

  it('skips weekends and explicitly excluded weekdays', () => {
    const friday = new Date(2026, 10, 13, 19)
    const result = scheduleTasks([task()], friday, { ...settings, excludedWeekdays: [1] }, 5)
    expect(new Date(result.scheduled[0].startAt).getDay()).toBe(2)
  })

  it('avoids unknown event endings', () => {
    const unknownEnd = { ...newItem('event'), title: '終了不明', startAt: at(9).toISOString(), endAt: null }
    const result = scheduleTasks([unknownEnd, task()], at(8), settings, 1)
    expect(result.warnings[0]).toContain('終了時刻が不明')
    expect(result.scheduled).toHaveLength(0)
    expect(result.unscheduled[0].reason).toContain('空き枠がありません')
  })

  it('uses instants rather than timestamp strings when offsets differ', () => {
    const plusEight = (instant: Date) => `${new Date(instant.getTime() + 8 * 60 * 60_000).toISOString().slice(0, 19)}+08:00`
    const shifted = { ...newItem('event'), title: '時差のある予定',
      startAt: plusEight(at(9)), endAt: plusEight(at(10)) }
    const result = scheduleTasks([shifted, task()], at(8), settings, 1)
    expect(result.scheduled[0].startAt).toBe(at(10).toISOString())
  })

  it('does not place a task in the past and reports an expired deadline', () => {
    const result = scheduleTasks([task({ deadline: at(7).toISOString() })], at(8), settings, 1)
    expect(result.scheduled).toHaveLength(0)
    expect(result.unscheduled[0].reason).toContain('期限が過ぎ')
  })
})
