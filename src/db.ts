import Dexie, { type EntityTable } from 'dexie'
import type { PlannerItem, PlannerSettings, ReminderRecord } from './model'

class PlannerDB extends Dexie {
  items!: EntityTable<PlannerItem, 'id'>
  settings!: EntityTable<PlannerSettings, 'id'>
  reminders!: EntityTable<ReminderRecord, 'key'>

  constructor() {
    super('yohaku-planner')
    this.version(1).stores({
      items: 'id, type, startAt, deadline, completedAt',
      settings: 'id',
      reminders: 'key, itemId'
    })
    this.version(2).stores({
      items: 'id, type, startAt, deadline, completedAt',
      settings: 'id',
      reminders: 'key, itemId'
    }).upgrade(tx => tx.table('settings').toCollection().modify(setting => {
      if (setting.sleepTargetMinutes == null) setting.sleepTargetMinutes = 480
    }))
  }
}

export const db = new PlannerDB()

export async function replaceAll(items: PlannerItem[], settings: PlannerSettings): Promise<void> {
  await db.transaction('rw', db.items, db.settings, db.reminders, async () => {
    await db.items.clear()
    await db.settings.clear()
    await db.reminders.clear()
    await db.items.bulkAdd(items)
    await db.settings.add(settings)
  })
}
