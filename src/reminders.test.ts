import { describe, expect, it } from 'vitest'
import { newItem } from './model'
import { dueReminders } from './reminders'

describe('dueReminders', () => {
  it('shows an upcoming event when its reminder time arrives', () => {
    const item = { ...newItem('event'), title: '会議', startAt: '2026-11-09T10:00:00+09:00', reminderMinutes: 10 }
    expect(dueReminders([item], new Date('2026-11-09T09:49:00+09:00'))).toHaveLength(0)
    expect(dueReminders([item], new Date('2026-11-09T09:50:00+09:00'))).toHaveLength(1)
  })

  it('does not remind for completed or unreviewed items', () => {
    const item = { ...newItem('task'), title: '確認', deadline: '2026-11-09T10:00:00+09:00' }
    const now = new Date('2026-11-09T09:55:00+09:00')
    expect(dueReminders([{ ...item, completedAt: now.toISOString() }, { ...item, id: 'uncertain', needsReview: true }], now)).toHaveLength(0)
  })

  it('does not describe an already missed event as upcoming', () => {
    const event = { ...newItem('event'), title: '過去の会議', startAt: '2026-11-09T09:00:00+09:00', endAt: '2026-11-09T10:00:00+09:00', reminderMinutes: 10 }
    expect(dueReminders([event], new Date('2026-11-09T15:00:00+09:00'))).toHaveLength(0)
  })
})
