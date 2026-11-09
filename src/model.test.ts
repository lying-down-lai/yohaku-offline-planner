import { expect, it } from 'vitest'
import { compareItemTime, newItem } from './model'

it('orders displayed items by actual time across UTC offsets', () => {
  const later = { ...newItem('event'), title: '後', startAt: '2026-11-09T09:00:00+08:00' }
  const earlier = { ...newItem('event'), title: '先', startAt: '2026-11-09T09:30:00+09:00' }
  const deadline = { ...newItem('task'), title: '期限', deadline: '2026-11-09T10:00:00+09:00' }

  expect([later, deadline, earlier].sort(compareItemTime).map(item => item.title))
    .toEqual(['先', '後', '期限'])
})
