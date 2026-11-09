import { parseISO } from 'date-fns'
import type { PlannerItem } from './model'

export interface ReminderNotice {
  key: string
  itemId: string
  title: string
  message: string
}

/** Delivery can later be replaced by Web Push without changing reminder rules. */
export interface NotificationDelivery {
  deliver(notice: ReminderNotice): void | Promise<void>
}

export class InAppDelivery implements NotificationDelivery {
  constructor(private readonly show: (notice: ReminderNotice) => void) {}

  deliver(notice: ReminderNotice): void {
    this.show(notice)
  }
}

export function dueReminders(items: PlannerItem[], now: Date): ReminderNotice[] {
  const notices: ReminderNotice[] = []
  for (const item of items) {
    if (item.completedAt || item.reminderMinutes === null || item.needsReview) continue
    const target = item.startAt ?? (item.type === 'task' ? item.deadline : null)
    if (!target) continue
    const targetTime = parseISO(target).getTime()
    const remindAt = targetTime - item.reminderMinutes * 60_000
    if (now.getTime() < remindAt || now.getTime() > targetTime + 24 * 60 * 60_000) continue
    if (item.type === 'event' && now.getTime() > targetTime) continue
    if (item.type === 'task' && item.startAt && item.endAt && now.getTime() > parseISO(item.endAt).getTime()) continue
    notices.push({
      key: `${item.id}:${target}`,
      itemId: item.id,
      title: item.title,
      message: item.type === 'event' ? '予定の時間が近づいています' : item.startAt ? 'タスクの開始時間が近づいています' : now.getTime() > targetTime ? '期限を過ぎています' : '期限が近づいています'
    })
  }
  return notices
}
