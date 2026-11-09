import { expect, it } from 'vitest'
import { newItem } from './model'
import { formatGap, getTodayFlow } from './todayFlow'

it('shows free time between occupied spans and ignores deadline-only tasks', () => {
  const now = new Date('2026-11-09T09:00:00+09:00')
  const first = { ...newItem('event'), title: '授業', startAt: '2026-11-09T09:00:00+09:00', endAt: '2026-11-09T10:00:00+09:00' }
  const deadline = { ...newItem('task'), title: '提出', deadline: '2026-11-09T10:30:00+09:00' }
  const second = { ...newItem('event'), title: '会議', startAt: '2026-11-09T11:30:00+09:00', endAt: '2026-11-09T12:00:00+09:00' }
  const flow = getTodayFlow([second, deadline, first], now)
  expect(flow.map(entry => [entry.item.title, entry.gapBeforeMinutes])).toEqual([
    ['授業', null], ['提出', null], ['会議', 90]
  ])
  expect(formatGap(90)).toBe('1時間30分')
})

it('uses the latest end of overlapping appointments and includes overnight sleep', () => {
  const now = new Date('2026-11-09T08:00:00+09:00')
  const sleep = { ...newItem('event'), title: '睡眠', startAt: '2026-11-08T23:00:00+09:00', endAt: '2026-11-09T07:00:00+09:00' }
  const first = { ...newItem('event'), title: '長い予定', startAt: '2026-11-09T08:00:00+09:00', endAt: '2026-11-09T11:00:00+09:00' }
  const overlapping = { ...newItem('event'), title: '重なる予定', startAt: '2026-11-09T10:00:00+09:00', endAt: '2026-11-09T12:00:00+09:00' }
  const later = { ...newItem('event'), title: '午後', startAt: '2026-11-09T13:00:00+09:00', endAt: '2026-11-09T14:00:00+09:00' }
  expect(getTodayFlow([later, first, overlapping, sleep], now).map(entry => entry.gapBeforeMinutes))
    .toEqual([null, 60, null, 60])
})
