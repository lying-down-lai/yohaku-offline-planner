import { describe, expect, it } from 'vitest'
import { defaultSettings, newItem } from './model'
import { createBackup, parseAiImport, parseBackup } from './transfer'

describe('validated JSON transfer', () => {
  it('retains uncertain events for review', () => {
    const result = parseAiImport(JSON.stringify({
      schemaVersion: 1,
      items: [{ type: 'event', title: '打ち合わせ', startAt: null, endAt: null, deadline: null,
        estimatedMinutes: null, importance: null, fixed: true, needsReview: false, sourceText: '打ち合わせ' }]
    }))
    expect(result[0].needsReview).toBe(true)
    expect(result[0].completedAt).toBeNull()
  })

  it('round trips a backup with settings and items', () => {
    const item = { ...newItem('task'), title: '確認する' }
    const restored = parseBackup(createBackup([item], defaultSettings))
    expect(restored.items).toEqual([item])
    expect(restored.settings).toEqual(defaultSettings)
  })

  it('rejects invalid event times before import', () => {
    expect(() => parseAiImport(JSON.stringify({ schemaVersion: 1, items: [{
      type: 'event', title: '不正な予定', startAt: '2026-11-09T12:00:00+09:00',
      endAt: '2026-11-09T11:00:00+09:00', deadline: null, estimatedMinutes: null,
      importance: null, fixed: true, needsReview: false, sourceText: '不正な予定'
    }] }))).toThrow()
  })
})
