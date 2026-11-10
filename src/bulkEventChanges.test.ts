import { expect, it } from 'vitest'
import { newItem } from './model'
import { makeEventChangePrompt, validateEventChanges } from './bulkEventChanges'

const now = new Date('2026-11-10T00:00:00Z')
const event = () => ({ ...newItem('event'), title: '会議',
  startAt: '2026-11-11T09:00:00+09:00', endAt: '2026-11-11T10:00:00+09:00' })
const json = (id: string, startAt = '2026-11-11T11:00:00+09:00', endAt = '2026-11-11T12:00:00+09:00') =>
  JSON.stringify({ schemaVersion: 1, kind: 'eventTimeChanges', changes: [{ id,
    originalStartAt: '2026-11-11T09:00:00+09:00', originalEndAt: '2026-11-11T10:00:00+09:00', startAt, endAt }] })

it('gives the AI stable IDs and a single-line raw JSON output contract', () => {
  const item = event()
  const prompt = makeEventChangePrompt([item], '会議を2時間遅らせる', now, 'Asia/Tokyo')
  expect(prompt).toContain(item.id)
  expect(prompt).toContain('会議を2時間遅らせる')
  expect(prompt).toContain('one physical line')
  expect(prompt).toContain('Do not wrap the whole object in quotes')
})

it('validates a change without mutating its event', () => {
  const item = event()
  const changes = validateEventChanges(json(item.id), [item], now)
  expect(changes).toHaveLength(1)
  expect(item.startAt).toBe('2026-11-11T09:00:00+09:00')
})

it('accepts an empty proposal when no requested edit is feasible', () => {
  expect(validateEventChanges('{"schemaVersion":1,"kind":"eventTimeChanges","changes":[]}', [event()], now)).toEqual([])
})

it('rejects malformed, stale, unknown, overlapping, and past changes', () => {
  const item = event()
  const busy = { ...newItem('task'), title: '作業',
    startAt: '2026-11-11T11:30:00+09:00', endAt: '2026-11-11T12:30:00+09:00' }
  expect(() => validateEventChanges('{bad', [item], now)).toThrow('JSON構文エラー')
  expect(() => validateEventChanges('{}', [item], now)).toThrow('スキーマエラー')
  expect(() => validateEventChanges(json('missing'), [item], now)).toThrow('予定IDが無効')
  expect(() => validateEventChanges(json(item.id), [{ ...item, startAt: '2026-11-11T09:30:00+09:00' }], now)).toThrow('元の日時')
  expect(() => validateEventChanges(json(item.id), [item, busy], now)).toThrow('予定が重なります')
  expect(() => validateEventChanges(json(item.id, '2026-11-09T09:00:00+09:00'), [item], now)).toThrow('過去')
})

it('rejects recurring changes that collide on later occurrences', () => {
  const item = { ...event(), recurrence: { frequency: 'daily' as const, interval: 1,
    startsOn: '2026-11-11', endsOn: '2026-11-13' } }
  const busy = { ...newItem('event'), title: '別の会議',
    startAt: '2026-11-13T11:30:00+09:00', endAt: '2026-11-13T12:30:00+09:00' }
  expect(() => validateEventChanges(json(item.id), [item, busy], now)).toThrow('予定が重なります')
})
