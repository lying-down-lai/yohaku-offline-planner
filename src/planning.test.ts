import { expect, it } from 'vitest'
import { defaultSettings, newItem } from './model'
import { buildSchedulePreview, makePlanningPrompt, parseTaskAssessment, storedAssessment,
  tasksNeedingAssessment } from './planning'

const task = () => ({ ...newItem('task'), title: '資料作成', notes: '提出前に確認', estimatedMinutes: null,
  needsReview: true, deadline: new Date(2026, 10, 11, 17).toISOString() })
const response = (id: string, duration: number | null = 60) => JSON.stringify({ schemaVersion: 1,
  kind: 'taskAssessment', assessments: [{ id, importance: 4, estimatedMinutes: duration,
    ambiguous: false, dependencies: [] }] })

it('asks for strict compact JSON with no scheduling timestamps', () => {
  const item = task()
  const prompt = makePlanningPrompt([item], defaultSettings, new Date(2026, 10, 10, 8), 'Asia/Tokyo')
  expect(prompt).toContain('taskAssessment')
  expect(prompt).toContain('No markdown fences')
  expect(prompt).toContain('JSON Schema mode')
  expect(prompt).toContain(item.id)
  expect(prompt).toContain('needsReview is informational')
  expect(prompt).toContain('one physical line')
  expect(prompt).toContain('Do not wrap the whole object in quotes')
})

it('validates syntax, schema, IDs, known attributes and dependencies independently', () => {
  const item = task()
  expect(() => parseTaskAssessment('{bad', [item])).toThrow('JSON構文エラー')
  expect(() => parseTaskAssessment('{}', [item])).toThrow('スキーマエラー')
  expect(() => parseTaskAssessment(response('missing'), [item])).toThrow('無効なタスクID')
  expect(() => parseTaskAssessment(response(item.id, 20), [{ ...item, estimatedMinutes: 60 }])).toThrow('所要時間')
  expect(() => parseTaskAssessment(response(item.id).replace('"dependencies":[]', '"dependencies":["missing"]'), [item])).toThrow('依存先ID')
})

it('schedules uncertain tasks provisionally without mutating the original', () => {
  const item = task()
  const assessment = parseTaskAssessment(response(item.id), [item])
  const now = new Date(2026, 10, 10, 8)
  const plan = buildSchedulePreview([item], defaultSettings, now, assessment)
  expect(plan.result.scheduled).toHaveLength(1)
  expect(item.startAt).toBeNull()
  expect(item.needsReview).toBe(true)
})

it('reuses assessments until source data changes', () => {
  const item = task()
  const value = parseTaskAssessment(response(item.id), [item])[0]
  const saved = { ...item, aiAssessment: storedAssessment(item, value) }
  expect(tasksNeedingAssessment([saved])).toHaveLength(0)
  expect(tasksNeedingAssessment([{ ...saved, notes: '内容変更' }])).toHaveLength(1)
  expect(tasksNeedingAssessment([saved], [saved.id])).toHaveLength(1)
})

it('avoids repeated fixed events and leaves unknown duration unplaced', () => {
  const item = task()
  const event = { ...newItem('event'), title: '授業', startAt: new Date(2026, 10, 10, 9).toISOString(),
    endAt: new Date(2026, 10, 10, 10).toISOString(),
    recurrence: { frequency: 'daily' as const, interval: 1, startsOn: '2026-11-10', endsOn: '2026-11-11' } }
  const now = new Date(2026, 10, 10, 8)
  const plan = buildSchedulePreview([item, event], defaultSettings, now, parseTaskAssessment(response(item.id), [item, event]))
  expect(new Date(plan.result.scheduled[0].startAt).getHours()).toBe(10)
  expect(buildSchedulePreview([item], defaultSettings, now).result.unscheduled[0].reason).toContain('所要時間')
})
