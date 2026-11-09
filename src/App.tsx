import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { format, isSameDay, parseISO, startOfDay } from 'date-fns'
import { ja } from 'date-fns/locale'
import { db, replaceAll } from './db'
import { defaultSettings, newItem, type PlannerItem, type PlannerSettings } from './model'
import { conflictsWithExisting, scheduleTasks } from './scheduler'
import { InAppDelivery, dueReminders, type ReminderNotice } from './reminders'
import { createBackup, makeExtractionPrompt, makeImageExtractionPrompt, parseAiImport, parseBackup } from './transfer'

type Tab = 'today' | 'tasks' | 'calendar' | 'tools'
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

const tabs: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'today', label: '今日', icon: '◉' },
  { id: 'tasks', label: 'タスク', icon: '☑' },
  { id: 'calendar', label: '予定', icon: '▦' },
  { id: 'tools', label: 'ツール', icon: '◇' }
]

function dateTimeLocal(value: string | null): string {
  return value ? format(parseISO(value), "yyyy-MM-dd'T'HH:mm") : ''
}

function toIso(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function prettyDate(value: string | null, withDay = true): string {
  if (!value) return '未設定'
  return format(parseISO(value), withDay ? 'M月d日 (EEE) HH:mm' : 'HH:mm', { locale: ja })
}

function isToday(value: string | null): boolean {
  return Boolean(value && isSameDay(parseISO(value), new Date()))
}

function describeError(error: unknown): string {
  if (error && typeof error === 'object' && 'issues' in error && Array.isArray(error.issues)) {
    return String(error.issues[0]?.message ?? '形式が正しくありません')
  }
  if (error instanceof Error) return error.message.slice(0, 180)
  return '処理に失敗しました'
}

function saveTextFile(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function ItemEditor({ item, items, onClose, onSaved }: {
  item: PlannerItem
  items: PlannerItem[]
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [draft, setDraft] = useState(item)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = <K extends keyof PlannerItem>(key: K, value: PlannerItem[K]) => setDraft(current => ({ ...current, [key]: value }))

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const title = draft.title.trim()
    if (!title) { setError('タイトルを入力してください'); return }
    if (draft.type === 'event' && (!draft.startAt || !draft.endAt)) {
      setError('予定の開始と終了を入力してください'); return
    }
    if (Boolean(draft.startAt) !== Boolean(draft.endAt)) {
      setError('開始と終了は両方入力してください'); return
    }
    if (draft.startAt && draft.endAt && Date.parse(draft.endAt) <= Date.parse(draft.startAt)) {
      setError('終了は開始より後にしてください'); return
    }
    if (draft.type === 'task' && (!draft.estimatedMinutes || draft.estimatedMinutes < 1 || draft.estimatedMinutes > 1440)) {
      setError('所要時間は1～1440分で入力してください'); return
    }
    if (draft.type === 'task' && draft.deadline && draft.endAt && Date.parse(draft.endAt) > Date.parse(draft.deadline)) {
      setError('配置した時間が期限を超えています'); return
    }
    const saved: PlannerItem = {
      ...draft, title, notes: draft.notes.trim(), fixed: draft.type === 'event',
      updatedAt: new Date().toISOString()
    }
    if (conflictsWithExisting(saved, items) && !window.confirm('ほかの予定・タスクと時間が重なります。保存しますか？')) return
    setSaving(true)
    try {
      await db.items.put(saved)
      onSaved('保存しました')
    } catch (err) {
      setError(describeError(err))
    } finally {
      setSaving(false)
    }
  }

  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="editor" role="dialog" aria-modal="true" aria-label={draft.type === 'task' ? 'タスクの編集' : '予定の編集'}>
      <div className="editor-head">
        <div><p className="eyebrow">{draft.type === 'task' ? 'TASK' : 'EVENT'}</p><h2>{item.title ? '内容を編集' : draft.type === 'task' ? 'タスクを追加' : '予定を追加'}</h2></div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button>
      </div>
      <form onSubmit={submit} className="editor-form">
        <label>タイトル<input required autoFocus maxLength={200} value={draft.title} onChange={event => set('title', event.target.value)} placeholder={draft.type === 'task' ? '例：資料を仕上げる' : '例：打ち合わせ'} /></label>
        <label>メモ<textarea rows={3} maxLength={10000} value={draft.notes} onChange={event => set('notes', event.target.value)} placeholder="必要なことを自由にメモ" /></label>
        {draft.type === 'task' ? <>
          <div className="form-row">
            <label>所要時間（分）<input type="number" min="1" max="1440" value={draft.estimatedMinutes ?? ''} onChange={event => set('estimatedMinutes', event.target.value ? Number(event.target.value) : null)} /></label>
            <label>重要度<select value={draft.importance ?? ''} onChange={event => set('importance', event.target.value ? Number(event.target.value) : null)}>
              <option value="">未設定</option>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value} {value === 5 ? '高' : value === 1 ? '低' : ''}</option>)}
            </select></label>
          </div>
          <label>期限<input type="datetime-local" value={dateTimeLocal(draft.deadline)} onChange={event => set('deadline', toIso(event.target.value))} /></label>
        </> : null}
        <div className="form-row">
          <label>開始{draft.type === 'task' ? '（任意）' : ''}<input type="datetime-local" required={draft.type === 'event'} value={dateTimeLocal(draft.startAt)} onChange={event => set('startAt', toIso(event.target.value))} /></label>
          <label>終了{draft.type === 'task' ? '（任意）' : ''}<input type="datetime-local" required={draft.type === 'event'} value={dateTimeLocal(draft.endAt)} onChange={event => set('endAt', toIso(event.target.value))} /></label>
        </div>
        {draft.type === 'task' && draft.startAt && <button type="button" className="text-button" onClick={() => setDraft(current => ({ ...current, startAt: null, endAt: null }))}>配置を解除する</button>}
        <label>リマインダー<select value={draft.reminderMinutes ?? 'off'} onChange={event => set('reminderMinutes', event.target.value === 'off' ? null : Number(event.target.value))}>
          <option value="off">なし</option><option value="0">時間になったら</option><option value="10">10分前</option><option value="30">30分前</option><option value="60">1時間前</option><option value="1440">1日前</option>
        </select></label>
        {draft.needsReview && <label className="check-label"><input type="checkbox" checked={!draft.needsReview} onChange={event => set('needsReview', !event.target.checked)} />内容を確認した</label>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="editor-actions"><button type="button" className="button secondary" onClick={onClose}>キャンセル</button><button disabled={saving} className="button primary" type="submit">{saving ? '保存中…' : '保存する'}</button></div>
      </form>
    </section>
  </div>
}

function ItemCard({ item, onEdit, onComplete, onReopen, onDelete }: {
  item: PlannerItem
  onEdit: (item: PlannerItem) => void
  onComplete: (item: PlannerItem) => void
  onReopen: (item: PlannerItem) => void
  onDelete: (item: PlannerItem) => void
}) {
  const time = item.startAt ? prettyDate(item.startAt) : item.deadline ? `期限 ${prettyDate(item.deadline)}` : '日時未設定'
  return <article className={`item-card ${item.completedAt ? 'is-done' : ''}`}>
    <div className={`item-marker ${item.type}`}>{item.type === 'task' ? '✓' : '●'}</div>
    <div className="item-body">
      <div className="item-topline"><span className="item-kind">{item.type === 'task' ? 'タスク' : '予定'}</span>{item.needsReview && <span className="review-tag">要確認</span>}{item.completedAt && <span className="done-tag">完了</span>}</div>
      <h3>{item.title}</h3>
      <p className="item-time">{time}{item.startAt && item.endAt ? ` – ${prettyDate(item.endAt, false)}` : ''}</p>
      {item.notes && <p className="item-notes">{item.notes}</p>}
      {item.type === 'task' && <p className="item-meta">{item.estimatedMinutes ?? '?'}分 · 重要度 {item.importance ?? '未設定'}</p>}
      <div className="item-actions">
        <button type="button" onClick={() => onEdit(item)}>編集</button>
        {item.type === 'task' && !item.completedAt && <button type="button" onClick={() => onComplete(item)}>完了にする</button>}
        {item.type === 'task' && item.completedAt && <button type="button" onClick={() => onReopen(item)}>未完了に戻す</button>}
        <button type="button" className="danger-link" onClick={() => onDelete(item)}>削除</button>
      </div>
    </div>
  </article>
}

export default function App() {
  const items = useLiveQuery(() => db.items.toArray(), [], [])
  const storedSettings = useLiveQuery(() => db.settings.get('main'), [])
  const settings = storedSettings ?? defaultSettings
  const [tab, setTab] = useState<Tab>('today')
  const [editing, setEditing] = useState<PlannerItem | null>(null)
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [toast, setToast] = useState('')
  const [notices, setNotices] = useState<ReminderNotice[]>([])
  const [aiText, setAiText] = useState('')
  const [shownPrompt, setShownPrompt] = useState<'text' | 'image' | null>(null)
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null)
  const [online, setOnline] = useState(navigator.onLine)
  const [savingSettings, setSavingSettings] = useState(false)

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    const capture = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPrompt) }
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    window.addEventListener('beforeinstallprompt', capture)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
      window.removeEventListener('beforeinstallprompt', capture)
    }
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 4500)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    const delivery = new InAppDelivery(notice => setNotices(current => [...current, notice]))
    let running = false
    const check = async () => {
      if (running || document.visibilityState !== 'visible') return
      running = true
      try {
        for (const notice of dueReminders(items, new Date())) {
          if (await db.reminders.get(notice.key)) continue
          try {
            await db.reminders.add({ key: notice.key, itemId: notice.itemId, firedAt: new Date().toISOString() })
            await delivery.deliver(notice)
          } catch { /* Another open tab already recorded this reminder. */ }
        }
      } finally { running = false }
    }
    void check()
    const timer = setInterval(() => { void check() }, 60_000)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', check); window.removeEventListener('focus', check) }
  }, [items])

  const activeTasks = useMemo(() => items.filter(item => item.type === 'task' && !item.completedAt), [items])
  const completedTasks = useMemo(() => items.filter(item => item.type === 'task' && item.completedAt), [items])
  const reviewEvents = useMemo(() => items.filter(item => item.type === 'event' && item.needsReview), [items])
  const reviewCount = items.filter(item => item.needsReview).length
  const todayItems = items.filter(item => !item.completedAt && (isToday(item.startAt) || (!item.startAt && isToday(item.deadline))))
    .sort((a, b) => (a.startAt ?? a.deadline ?? '').localeCompare(b.startAt ?? b.deadline ?? ''))
  const calendarItems = items.filter(item => item.startAt && format(parseISO(item.startAt), 'yyyy-MM-dd') === selectedDate)
    .sort((a, b) => (a.startAt ?? '').localeCompare(b.startAt ?? ''))
  const unscheduledCount = activeTasks.filter(item => !item.startAt && !item.needsReview).length
  const todayCount = todayItems.length

  function saved(message: string) { setEditing(null); setToast(message) }

  async function complete(item: PlannerItem) {
    if (!window.confirm(`「${item.title}」を完了にしますか？`)) return
    await db.items.update(item.id, { completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    setToast('完了として記録しました')
  }

  async function reopen(item: PlannerItem) {
    await db.items.update(item.id, { completedAt: null, updatedAt: new Date().toISOString() })
    setToast('未完了に戻しました')
  }

  async function remove(item: PlannerItem) {
    if (!window.confirm(`「${item.title}」を削除しますか？`)) return
    await db.transaction('rw', db.items, db.reminders, async () => {
      await db.items.delete(item.id)
      await db.reminders.where('itemId').equals(item.id).delete()
    })
    setToast('削除しました')
  }

  async function autoSchedule() {
    const result = scheduleTasks(items, new Date(), settings)
    if (result.scheduled.length) {
      const now = new Date().toISOString()
      await db.transaction('rw', db.items, async () => {
        for (const entry of result.scheduled) await db.items.update(entry.id, { startAt: entry.startAt, endAt: entry.endAt, updatedAt: now })
      })
    }
    setToast(`${result.scheduled.length}件を配置しました${result.unscheduled.length ? `。${result.unscheduled.length}件は未配置です` : ''}`)
  }

  async function updateSettings(next: PlannerSettings) {
    if (next.workStart >= next.workEnd) { setToast('作業終了時刻は開始時刻より後にしてください'); return }
    setSavingSettings(true)
    try { await db.settings.put(next); setToast('設定を保存しました') }
    catch (error) { setToast(describeError(error)) }
    finally { setSavingSettings(false) }
  }

  async function importAi() {
    try {
      const imported: PlannerItem[] = []
      for (const item of parseAiImport(aiText)) {
        imported.push({
          ...item,
          needsReview: item.needsReview || conflictsWithExisting(item, [...items, ...imported]) ||
            Boolean(item.type === 'task' && item.deadline && item.endAt && Date.parse(item.endAt) > Date.parse(item.deadline))
        })
      }
      if (!imported.length) { setToast('取り込む項目がありません'); return }
      const review = imported.filter(item => item.needsReview).length
      if (!window.confirm(`${imported.length}件を追加します。${review ? `うち${review}件は確認が必要です。` : ''}続けますか？`)) return
      await db.items.bulkAdd(imported)
      setAiText('')
      setTab('tasks')
      setToast(`${imported.length}件を取り込みました`)
    } catch (error) { setToast(`JSONを確認してください: ${describeError(error)}`) }
  }

  async function restore(file: File | undefined) {
    if (!file) return
    try {
      const parsed = parseBackup(await file.text())
      if (!window.confirm(`現在のデータを${parsed.items.length}件のバックアップで置き換えます。続けますか？`)) return
      await replaceAll(parsed.items, parsed.settings)
      setToast('バックアップを復元しました')
    } catch (error) { setToast(`復元できませんでした: ${describeError(error)}`) }
  }

  async function copyPrompt(source: 'text' | 'image') {
    try {
      await navigator.clipboard.writeText(source === 'image' ? makeImageExtractionPrompt() : makeExtractionPrompt())
      setShownPrompt(source)
      setToast(source === 'image' ? '画像用プロンプトをコピーしました' : 'プロンプトをコピーしました')
    }
    catch { setToast('コピーできませんでした。ブラウザの権限を確認してください') }
  }

  const cardHandlers = { onEdit: setEditing, onComplete: complete, onReopen: reopen, onDelete: remove }

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>余白<span className="brand-dot">.</span></span></div>
      <span className={`status ${online ? '' : 'offline'}`}><span className="status-dot" />{online ? '端末に保存' : 'オフライン'}</span>
    </header>

    <main className="main-content">
      {notices.length > 0 && <section className="notice-list" aria-live="polite">{notices.map(notice => <div className="notice" key={notice.key}><span className="notice-symbol">✦</span><div><strong>{notice.title}</strong><p>{notice.message}</p></div><button type="button" aria-label="通知を閉じる" onClick={() => setNotices(current => current.filter(entry => entry.key !== notice.key))}>×</button></div>)}</section>}
      {tab === 'today' && <>
        <section className="page-intro"><p className="eyebrow">YOUR SPACE, YOUR PACE</p><h1>今日を、<br /><em>心地よく整える。</em></h1><p className="intro-date">{format(new Date(), 'yyyy年M月d日 EEEE', { locale: ja })}</p></section>
        <div className="overview-grid">
          <div className="overview-card dark"><span>今日の予定とタスク</span><strong>{todayCount}<small>件</small></strong><p>目の前のことから、ひとつずつ。</p></div>
          <div className="overview-card light"><span>配置待ちのタスク</span><strong>{unscheduledCount}<small>件</small></strong><button type="button" onClick={() => setTab('tasks')}>確認する <span aria-hidden="true">↗</span></button></div>
        </div>
        <div className="section-heading"><div><p className="eyebrow">TODAY'S FLOW</p><h2>今日の流れ</h2></div><button className="link-arrow" type="button" onClick={() => setTab('calendar')}>予定を見る ↗</button></div>
        {todayItems.length ? <div className="cards">{todayItems.map(item => <ItemCard key={item.id} item={item} {...cardHandlers} />)}</div> : <div className="empty-state"><span className="empty-illustration">✳</span><h3>今日はまだ余白があります</h3><p>予定やタスクを追加して、一日を整えましょう。</p><button className="button primary" type="button" onClick={() => setEditing(newItem('task'))}>タスクを追加</button></div>}
        {reviewCount > 0 && <button type="button" className="review-banner" onClick={() => setTab('tasks')}>確認が必要な項目が{reviewCount}件あります <span>→</span></button>}
      </>}

      {tab === 'tasks' && <>
        <section className="page-title"><p className="eyebrow">TO-DO LIST</p><h1>タスク</h1><p>やることを整理して、空いている時間に配置できます。</p></section>
        <div className="toolbar"><button className="button primary" type="button" onClick={() => setEditing(newItem('task'))}>＋ タスクを追加</button><button className="button secondary" type="button" onClick={() => void autoSchedule()} disabled={!unscheduledCount}>空き時間に配置</button></div>
        <div className="section-heading compact"><h2>進行中 <span className="count">{activeTasks.length}</span></h2></div>
        {activeTasks.length ? <div className="cards">{activeTasks.slice().sort((a, b) => Number(b.needsReview) - Number(a.needsReview) || (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999')).map(item => <ItemCard key={item.id} item={item} {...cardHandlers} />)}</div> : <div className="empty-state"><span className="empty-illustration">✓</span><h3>進行中のタスクはありません</h3><p>新しいタスクを追加しましょう。</p></div>}
        {reviewEvents.length > 0 && <><div className="section-heading compact"><h2>確認が必要な予定 <span className="count">{reviewEvents.length}</span></h2></div><div className="cards">{reviewEvents.map(item => <ItemCard key={item.id} item={item} {...cardHandlers} />)}</div></>}
        {completedTasks.length > 0 && <details className="completed-section"><summary>完了したタスク <span>{completedTasks.length}</span></summary><div className="cards">{completedTasks.map(item => <ItemCard key={item.id} item={item} {...cardHandlers} />)}</div></details>}
      </>}

      {tab === 'calendar' && <>
        <section className="page-title"><p className="eyebrow">CALENDAR</p><h1>予定</h1><p>決まった予定と、配置したタスクを見渡せます。</p></section>
        <div className="toolbar"><label className="date-picker">表示する日<input type="date" value={selectedDate} onChange={event => setSelectedDate(event.target.value)} /></label><button className="button primary" type="button" onClick={() => setEditing(newItem('event'))}>＋ 予定を追加</button></div>
        <div className="section-heading compact"><h2>{format(startOfDay(new Date(`${selectedDate}T00:00:00`)), 'M月d日 EEEE', { locale: ja })}</h2><span className="count">{calendarItems.length}件</span></div>
        {calendarItems.length ? <div className="cards">{calendarItems.map(item => <ItemCard key={item.id} item={item} {...cardHandlers} />)}</div> : <div className="empty-state"><span className="empty-illustration">○</span><h3>この日は空いています</h3><p>予定を入れるか、そのまま余白を楽しみましょう。</p></div>}
      </>}

      {tab === 'tools' && <>
        <section className="page-title"><p className="eyebrow">YOUR SETTINGS</p><h1>ツールと設定</h1><p>データはこの端末のブラウザ内に保存されます。</p></section>
        <section className="panel"><div className="panel-head"><span className="panel-icon">◷</span><div><h2>作業する時間</h2><p>自動配置で使う時間帯を設定します。</p></div></div>
          <div className="form-row settings-row"><label>開始<input type="time" value={settings.workStart} onChange={event => void updateSettings({ ...settings, workStart: event.target.value })} disabled={savingSettings} /></label><label>終了<input type="time" value={settings.workEnd} onChange={event => void updateSettings({ ...settings, workEnd: event.target.value })} disabled={savingSettings} /></label></div>
          <label className="check-label"><input type="checkbox" checked={settings.includeWeekends} onChange={event => void updateSettings({ ...settings, includeWeekends: event.target.checked })} />週末も配置する</label>
        </section>
        <section className="panel"><div className="panel-head"><span className="panel-icon">⇄</span><div><h2>バックアップ</h2><p>JSONファイルに保存・復元できます。</p></div></div><div className="button-row"><button type="button" className="button secondary" onClick={() => saveTextFile(createBackup(items, settings), `yohaku-backup-${format(new Date(), 'yyyy-MM-dd')}.json`)}>バックアップを保存</button><label className="button secondary file-button">ファイルから復元<input type="file" accept=".json,application/json" onChange={event => { void restore(event.target.files?.[0]); event.target.value = '' }} /></label></div><p className="hint">復元すると現在のデータは置き換わります。端末間の自動同期はありません。</p></section>
        <section className="panel"><div className="panel-head"><span className="panel-icon">✧</span><div><h2>外部AIから取り込む</h2><p>文章や予定の画像を外部AIに読み取らせ、結果だけ取り込みます。</p></div></div><ol className="steps"><li>文章用または画像用のプロンプトをコピーし、外部AIに文章または画像と一緒に送る</li><li>返ってきたJSONを下に貼り付ける</li><li>日時と内容を確認して取り込む</li></ol><div className="button-row"><button type="button" className="button secondary" onClick={() => void copyPrompt('text')}>抽出用プロンプトをコピー</button><button type="button" className="button secondary" onClick={() => void copyPrompt('image')}>画像から予定を抽出するプロンプトをコピー</button><button type="button" className="button secondary" onClick={() => setShownPrompt(value => value ? null : 'text')}>{shownPrompt ? 'プロンプトを閉じる' : 'プロンプトを表示'}</button></div>{shownPrompt && <textarea readOnly rows={10} value={shownPrompt === 'image' ? makeImageExtractionPrompt() : makeExtractionPrompt()} aria-label={shownPrompt === 'image' ? '画像用プロンプト' : '抽出用プロンプト'} style={{ marginTop: 14 }} />}<label className="json-label">AIが返したJSON<textarea rows={7} spellCheck={false} value={aiText} onChange={event => setAiText(event.target.value)} placeholder={'{"schemaVersion":1,"items":[]}'} /></label><button type="button" className="button primary" disabled={!aiText.trim()} onClick={() => void importAi()}>JSONを検証して取り込む</button><p className="hint">取り込んだ日時や内容は編集できます。不明な予定は「要確認」として残ります。</p></section>
        <section className="panel"><div className="panel-head"><span className="panel-icon">▣</span><div><h2>アプリとして使う</h2><p>ホーム画面に追加すると、全画面に近い表示で使えます。</p></div></div>{installPrompt ? <button className="button primary" type="button" onClick={() => { void installPrompt.prompt(); setInstallPrompt(null) }}>インストールする</button> : <p className="hint">Android: ブラウザの「インストール」または「ホーム画面に追加」。iPhone: Safariの共有メニューから「ホーム画面に追加」。</p>}<p className="hint">リマインダーはアプリを開いているときに表示されます。</p></section>
      </>}
    </main>

    <nav className="bottom-nav" aria-label="メインメニュー">{tabs.map(entry => <button key={entry.id} type="button" className={tab === entry.id ? 'active' : ''} onClick={() => setTab(entry.id)}><span className="nav-icon" aria-hidden="true">{entry.icon}</span><span>{entry.label}</span></button>)}</nav>
    {editing && <ItemEditor key={editing.id} item={editing} items={items} onClose={() => setEditing(null)} onSaved={saved} />}
    {toast && <div className="toast" role="status">{toast}<button type="button" onClick={() => setToast('')} aria-label="閉じる">×</button></div>}
  </div>
}
