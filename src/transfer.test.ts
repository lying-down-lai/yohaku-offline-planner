import { describe, expect, it } from 'vitest'
import { defaultSettings, newItem } from './model'
import { createBackup, makeExtractionPrompt, makeImageExtractionPrompt, parseAiImport, parseBackup, withoutDuplicateEvents } from './transfer'

describe('validated JSON transfer', () => {
  it('instructs both extraction workflows to return offset-aware datetimes with seconds', () => {
    for (const prompt of [makeExtractionPrompt(), makeImageExtractionPrompt()]) {
      expect(prompt).toContain('YYYY-MM-DDTHH:mm:ss±HH:mm')
      expect(prompt).toContain('Use 24-hour time')
      expect(prompt).toContain('If a full date and time cannot be determined, use null')
      expect(prompt).toContain('Timezone (IANA):')
    }
  })

  it('gives image extraction its own source instructions', () => {
    const prompt = makeImageExtractionPrompt()
    expect(prompt).toContain('Image(s) attached to this message')
    expect(prompt).toContain('Match each title to its date column, time row')
    expect(prompt).toContain('sourceText must contain a short transcription')
    expect(prompt).not.toContain('INPUT_TEXT:')
  })

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

  it('restores older backups with a default sleep target', () => {
    const olderSettings = { id: 'main', workStart: '09:00', workEnd: '18:00', includeWeekends: false }
    const restored = parseBackup(JSON.stringify({
      schemaVersion: 1, exportedAt: new Date().toISOString(), settings: olderSettings, items: []
    }))
    expect(restored.settings.sleepTargetMinutes).toBe(480)
  })

  it('rejects invalid event times before import', () => {
    expect(() => parseAiImport(JSON.stringify({ schemaVersion: 1, items: [{
      type: 'event', title: '不正な予定', startAt: '2026-11-09T12:00:00+09:00',
      endAt: '2026-11-09T11:00:00+09:00', deadline: null, estimatedMinutes: null,
      importance: null, fixed: true, needsReview: false, sourceText: '不正な予定'
    }] }))).toThrow()
  })

  it('skips repeated fixed events from screenshots without hiding incomplete ones', () => {
    const existing = { ...newItem('event'), title: '  授業 ', startAt: '2026-11-09T09:00:00+09:00', endAt: '2026-11-09T10:00:00+09:00' }
    const repeated = { ...newItem('event'), title: '授業', startAt: '2026-11-09T00:00:00Z', endAt: '2026-11-09T01:00:00Z' }
    const incomplete = { ...newItem('event'), title: '授業', needsReview: true }
    const result = withoutDuplicateEvents([repeated, incomplete], [existing])
    expect(result.duplicates).toEqual([repeated])
    expect(result.items).toEqual([incomplete])
  })
})
