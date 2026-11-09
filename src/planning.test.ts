import { expect, it } from 'vitest'
import { defaultSettings, newItem } from './model'
import { makePlanningPrompt, parsePlanningProposal } from './planning'

const now = new Date('2026-11-09T00:00:00Z')
const settings = { ...defaultSettings, workStart: '00:00', workEnd: '23:59', includeWeekends: true }

function proposal(taskId: string, startAt: string | null, endAt: string | null, sleepBlocks: Array<{ startAt: string; endAt: string }> = []) {
  return JSON.stringify({ schemaVersion: 1, kind: 'scheduleProposal', taskUpdates: [
    { id: taskId, importance: 4, estimatedMinutes: 60, startAt, endAt }
  ], sleepBlocks, warnings: [] })
}

it('includes current task details and constraints in the portable planning prompt', () => {
  const task = { ...newItem('task'), title: '課題', notes: '提出前に確認', deadline: '2026-11-11T12:00:00+09:00' }
  const prompt = makePlanningPrompt([task], settings, now, 'Asia/Tokyo')
  expect(prompt).toContain(task.id)
  expect(prompt).toContain('提出前に確認')
  expect(prompt).toContain('SLEEP_TARGET: 480 minutes')
  expect(prompt).toContain('Never move or delete a fixed event')
  expect(prompt).toContain('scheduleProposal')
})

it('accepts a nonconflicting proposed task and sleep block', () => {
  const task = { ...newItem('task'), title: '課題', estimatedMinutes: null, deadline: '2026-11-11T12:00:00+09:00' }
  const plan = parsePlanningProposal(proposal(task.id,
    '2026-11-10T10:00:00+09:00', '2026-11-10T11:00:00+09:00',
    [{ startAt: '2026-11-10T23:00:00+09:00', endAt: '2026-11-11T07:00:00+09:00' }]), [task], settings, now)
  expect(plan.taskUpdates[0].importance).toBe(4)
  expect(plan.sleepBlocks).toHaveLength(1)
})

it('rejects overlap with a fixed appointment and deadline violations', () => {
  const task = { ...newItem('task'), title: '課題', estimatedMinutes: null, deadline: '2026-11-10T10:30:00+09:00' }
  const event = { ...newItem('event'), title: '授業', startAt: '2026-11-10T10:00:00+09:00', endAt: '2026-11-10T11:00:00+09:00' }
  const text = proposal(task.id, '2026-11-10T10:00:00+09:00', '2026-11-10T11:00:00+09:00')
  expect(() => parsePlanningProposal(text, [task, event], settings, now)).toThrow('期限')
  expect(() => parsePlanningProposal(text, [{ ...task, deadline: null }, event], settings, now)).toThrow('重なって')
})

it('rejects moving an already scheduled task or fabricating completion', () => {
  const task = { ...newItem('task'), title: '課題', estimatedMinutes: 60,
    startAt: '2026-11-10T10:00:00+09:00', endAt: '2026-11-10T11:00:00+09:00' }
  expect(() => parsePlanningProposal(proposal(task.id,
    '2026-11-10T12:00:00+09:00', '2026-11-10T13:00:00+09:00'), [task], settings, now)).toThrow('既存の配置')
  expect(() => parsePlanningProposal(proposal(task.id, null, null).replace('"warnings":[]', '"warnings":[],"completedAt":"2026-11-10T13:00:00+09:00"'), [task], settings, now)).toThrow()
})

it('rejects a reversed task interval before it can be saved', () => {
  const task = { ...newItem('task'), title: '課題' }
  expect(() => parsePlanningProposal(proposal(task.id,
    '2026-11-10T11:00:00+09:00', '2026-11-10T10:00:00+09:00'), [task], settings, now))
    .toThrow('終了は開始より後')
})
