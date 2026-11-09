export type ItemType = 'task' | 'event'

export interface PlannerItem {
  id: string
  type: ItemType
  title: string
  notes: string
  startAt: string | null
  endAt: string | null
  deadline: string | null
  estimatedMinutes: number | null
  importance: number | null
  fixed: boolean
  needsReview: boolean
  sourceText: string
  completedAt: string | null
  reminderMinutes: number | null
  createdAt: string
  updatedAt: string
}

export interface PlannerSettings {
  id: 'main'
  workStart: string
  workEnd: string
  includeWeekends: boolean
  sleepTargetMinutes: number
}

export interface ReminderRecord {
  key: string
  itemId: string
  firedAt: string
}

export function compareItemTime(a: PlannerItem, b: PlannerItem): number {
  const time = (item: PlannerItem) => {
    const value = item.startAt ?? item.deadline
    return value ? Date.parse(value) : Number.MAX_SAFE_INTEGER
  }
  return time(a) - time(b)
}

export const defaultSettings: PlannerSettings = {
  id: 'main',
  workStart: '09:00',
  workEnd: '18:00',
  includeWeekends: false,
  sleepTargetMinutes: 480
}

export function newItem(type: ItemType): PlannerItem {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    type,
    title: '',
    notes: '',
    startAt: null,
    endAt: null,
    deadline: null,
    estimatedMinutes: null,
    importance: null,
    fixed: type === 'event',
    needsReview: false,
    sourceText: '',
    completedAt: null,
    reminderMinutes: 10,
    createdAt: now,
    updatedAt: now
  }
}
