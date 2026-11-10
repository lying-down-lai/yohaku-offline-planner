import { useState } from 'react'
import { addDays, format, parseISO, startOfDay } from 'date-fns'
import { db } from './db'
import type { PlannerItem, PlannerSettings } from './model'
import { expandItems } from './recurrence'
import { buildSchedulePreview, makePlanningPrompt, parseTaskAssessment,
  storedAssessment, tasksNeedingAssessment, type SchedulePreview } from './planning'

const dateLabel = (value: string) => format(parseISO(value), 'M月d日 HH:mm')
const errorMessage = (error: unknown) => error instanceof Error ? error.message.slice(0, 240) : '検証に失敗しました'

export function PlanningPanel({ items, settings, onApplied }: {
  items: PlannerItem[]; settings: PlannerSettings; onApplied: (message: string) => void
}) {
  const [prompt, setPrompt] = useState('')
  const [response, setResponse] = useState('')
  const [preview, setPreview] = useState<SchedulePreview | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [applying, setApplying] = useState(false)
  const byId = new Map(items.map(item => [item.id, item]))
  const pending = tasksNeedingAssessment(items, selected)

  async function copyPrompt() {
    const text = makePlanningPrompt(items, settings, new Date(), undefined, selected)
    setPrompt(text); setError('')
    try { await navigator.clipboard.writeText(text); setMessage('見積もり用プロンプトをコピーしました') }
    catch { setMessage('コピーできませんでした。下の欄からコピーしてください') }
  }

  function calculate() {
    setError(''); setMessage(''); setPreview(null)
    try {
      const assessments = response.trim() ? parseTaskAssessment(response, items) : []
      const allowed = new Set(pending.map(item => item.id))
      const extra = assessments.find(value => !allowed.has(value.id))
      if (extra) throw new Error(`今回の評価対象外のタスクID: ${extra.id}`)
      setPreview(buildSchedulePreview(items, settings, new Date(), assessments))
    } catch (err) { setError(errorMessage(err)) }
  }

  async function apply() {
    if (!preview) return
    if (!window.confirm(`タスク${preview.result.scheduled.length}件の仮配置と、AI見積もり${preview.assessments.length}件を反映しますか？`)) return
    setApplying(true); setError('')
    try {
      await db.transaction('rw', db.items, db.settings, async () => {
        const latest = await db.items.toArray()
        const latestSettings = await db.settings.get('main') ?? settings
        const assessments = response.trim() ? parseTaskAssessment(response, latest) : []
        const current = buildSchedulePreview(latest, latestSettings, new Date(), assessments)
        if (JSON.stringify(current.result) !== JSON.stringify(preview.result)) {
          throw new Error('予定が変わりました。もう一度「計画を計算」を押してください')
        }
        const expanded = expandItems(current.effectiveItems, startOfDay(new Date()), addDays(startOfDay(new Date()), 8))
        const occurrences = new Map(expanded.map(item => [item.id, item]))
        const base = new Map(latest.map(item => [item.id, item]))
        const updatedAt = new Date().toISOString()
        const changes = new Map<string, Partial<PlannerItem>>()
        for (const value of assessments) changes.set(value.id, { aiAssessment: storedAssessment(base.get(value.id)!, value), updatedAt })
        for (const slot of current.result.scheduled) {
          const item = occurrences.get(slot.id)
          if (item?.seriesId && item.occurrenceDate) {
            const original = base.get(item.seriesId)!
            const previous = changes.get(original.id) ?? {}
            changes.set(original.id, { ...previous, occurrenceSlots: { ...(previous.occurrenceSlots ?? original.occurrenceSlots),
              [item.occurrenceDate]: { startAt: slot.startAt, endAt: slot.endAt } }, updatedAt })
          } else changes.set(slot.id, { ...(changes.get(slot.id) ?? {}), startAt: slot.startAt, endAt: slot.endAt, updatedAt })
        }
        for (const [id, change] of changes) await db.items.update(id, change)
      })
      setResponse(''); setPreview(null); setSelected([])
      onApplied('見積もりと仮配置を反映しました。タスクの完了は記録していません')
    } catch (err) { setError(errorMessage(err)); setPreview(null) }
    finally { setApplying(false) }
  }

  return <section className="panel">
    <div className="panel-head"><span className="panel-icon">✦</span><div><h2>AIの見積もりと仮の計画</h2><p>AIは重要度・所要時間を見積もり、時間枠はアプリが計算します。</p></div></div>
    <p className="hint">AIなしでも、保存済みの所要時間で計画できます。要確認のタスクも仮配置の対象です。外部AIへの送信はご自身で行います。</p>
    <details><summary>評価するタスクを選ぶ（変更されたタスクは自動選択）</summary>
      {items.filter(item => item.type === 'task' && !item.completedAt).map(item =>
        <label className="check-label" key={item.id}><input type="checkbox" checked={selected.includes(item.id)}
          onChange={event => setSelected(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} />{item.title}</label>)}
    </details>
    <p className="hint">今回のAI評価対象: {pending.length}件。既存の見積もりはタスク内容が変わらない限り再利用します。</p>
    <div className="button-row"><button type="button" className="button secondary" onClick={() => void copyPrompt()}>見積もり用プロンプトをコピー</button></div>
    {prompt && <label className="json-label">生成したプロンプト<textarea readOnly rows={8} value={prompt} onFocus={event => event.target.select()} /></label>}
    <label className="json-label">AIが返した taskAssessment JSON（AIなしなら空欄）
      <textarea rows={8} spellCheck={false} value={response} onChange={event => { setResponse(event.target.value); setPreview(null); setError('') }}
        placeholder={'{"schemaVersion":1,"kind":"taskAssessment","assessments":[]}'} /></label>
    <button type="button" className="button secondary" onClick={calculate}>検証して仮の計画を計算</button>
    {message && <p className="hint" role="status">{message}</p>}
    {error && <p className="form-error" role="alert">{error}。JSONを修正するか、プロンプトを再送してから再計算してください。既存の予定は変更されていません。</p>}
    {preview && <div className="plan-preview" aria-label="仮の計画の確認">
      <h3>反映前の確認</h3><p>AI見積もり {preview.assessments.length}件 · 仮配置 {preview.result.scheduled.length}件 · 未配置 {preview.result.unscheduled.length}件</p>
      <ul>{preview.result.scheduled.map(slot => <li key={slot.id}><strong>{byId.get(slot.id)?.title ?? preview.effectiveItems.find(item => slot.id.startsWith(`${item.id}::`))?.title ?? slot.id}</strong> · {dateLabel(slot.startAt)}～{dateLabel(slot.endAt)}</li>)}</ul>
      {preview.result.unscheduled.length > 0 && <><h4>未配置</h4><ul>{preview.result.unscheduled.map(entry => <li key={entry.id}>{byId.get(entry.id)?.title ?? entry.id}: {entry.reason}</li>)}</ul></>}
      {preview.result.warnings.map((warning, index) => <p className="hint" key={index}>{warning}</p>)}
      <button type="button" className="button primary" disabled={applying} onClick={() => void apply()}>{applying ? '反映中…' : 'この仮計画を承認して反映'}</button>
    </div>}
  </section>
}
