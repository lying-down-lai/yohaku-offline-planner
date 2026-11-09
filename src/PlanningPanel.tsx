import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { db } from './db'
import { newItem, type PlannerItem, type PlannerSettings } from './model'
import { makePlanningPrompt, parsePlanningProposal, type PlanningProposal } from './planning'

function dateLabel(value: string): string {
  return format(parseISO(value), 'M月d日 HH:mm')
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'issues' in error && Array.isArray(error.issues)) {
    return String(error.issues[0]?.message ?? '形式が正しくありません')
  }
  return error instanceof Error ? error.message.slice(0, 180) : '提案を確認できませんでした'
}

export function PlanningPanel({ items, settings, onApplied }: {
  items: PlannerItem[]
  settings: PlannerSettings
  onApplied: (message: string) => void
}) {
  const [prompt, setPrompt] = useState('')
  const [response, setResponse] = useState('')
  const [preview, setPreview] = useState<PlanningProposal | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [applying, setApplying] = useState(false)
  const byId = new Map(items.map(item => [item.id, item]))

  async function copyPrompt() {
    const text = makePlanningPrompt(items, settings)
    setPrompt(text)
    setError('')
    try {
      await navigator.clipboard.writeText(text)
      setMessage('計画用プロンプトをコピーしました')
    } catch {
      setMessage('コピーできませんでした。下のプロンプトを選択してコピーしてください')
    }
  }

  function checkProposal() {
    setError('')
    setMessage('')
    try { setPreview(parsePlanningProposal(response, items, settings)) }
    catch (error) { setPreview(null); setError(errorMessage(error)) }
  }

  async function applyProposal() {
    if (!preview) return
    const taskCount = preview.taskUpdates.length
    const sleepCount = preview.sleepBlocks.length
    if (!window.confirm(`タスク${taskCount}件の優先度・配置と、睡眠${sleepCount}件の仮予定を反映しますか？`)) return
    setApplying(true)
    setError('')
    try {
      await db.transaction('rw', db.items, db.settings, async () => {
        const latestItems = await db.items.toArray()
        const latestSettings = await db.settings.get('main') ?? settings
        const plan = parsePlanningProposal(response, latestItems, latestSettings)
        const latestById = new Map(latestItems.map(item => [item.id, item]))
        const updatedAt = new Date().toISOString()
        for (const update of plan.taskUpdates) {
          const current = latestById.get(update.id)!
          await db.items.update(update.id, {
            importance: update.importance,
            estimatedMinutes: update.estimatedMinutes,
            startAt: current.startAt ?? update.startAt,
            endAt: current.endAt ?? update.endAt,
            updatedAt
          })
        }
        for (const sleep of plan.sleepBlocks) {
          await db.items.add({
            ...newItem('event'),
            title: '睡眠',
            notes: `AIが提案した仮の睡眠枠。目安は${latestSettings.sleepTargetMinutes / 60}時間です。`,
            startAt: sleep.startAt,
            endAt: sleep.endAt,
            needsReview: true,
            reminderMinutes: null,
            sourceText: 'AI計画提案'
          })
        }
      })
      setResponse('')
      setPreview(null)
      onApplied(`タスク${taskCount}件と睡眠${sleepCount}件の提案を反映しました`)
    } catch (error) { setError(errorMessage(error)) }
    finally { setApplying(false) }
  }

  return <section className="panel">
    <div className="panel-head"><span className="panel-icon">✦</span><div><h2>AIに計画を提案してもらう</h2><p>今あるタスクと予定から、優先度・作業枠・睡眠枠の案を作ります。</p></div></div>
    <p className="hint">計画期間は今日から7日間。タスク名・メモ・予定がプロンプトに含まれます。外部AIへの送信はご自身で行います。</p>
    <div className="button-row"><button type="button" className="button secondary" onClick={() => void copyPrompt()}>現在の予定から計画用プロンプトをコピー</button></div>
    {prompt && <label className="json-label">生成したプロンプト<textarea readOnly rows={8} value={prompt} onFocus={event => event.target.select()} /></label>}
    <label className="json-label">AIが返した計画JSON<textarea rows={8} spellCheck={false} value={response} onChange={event => { setResponse(event.target.value); setPreview(null); setError('') }} placeholder={'{"schemaVersion":1,"kind":"scheduleProposal",...}'} /></label>
    <button type="button" className="button secondary" disabled={!response.trim()} onClick={checkProposal}>提案を検証して確認</button>
    {message && <p className="hint" role="status">{message}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {preview && <div className="plan-preview" aria-label="AI計画の確認">
      <h3>反映前の確認</h3>
      <p>タスク {preview.taskUpdates.length}件・睡眠の仮予定 {preview.sleepBlocks.length}件</p>
      <ul>{preview.taskUpdates.map(update => <li key={update.id}><strong>{byId.get(update.id)?.title ?? update.id}</strong> · 重要度 {byId.get(update.id)?.importance != null && byId.get(update.id)?.importance !== update.importance ? `${byId.get(update.id)?.importance}→` : ''}{update.importance} · 所要時間 {update.estimatedMinutes == null ? '未設定' : `${update.estimatedMinutes}分`} · {update.startAt && update.endAt ? `${dateLabel(update.startAt)}～${dateLabel(update.endAt)}` : byId.get(update.id)?.startAt ? '既存の配置を維持' : '未配置'}</li>)}</ul>
      {preview.sleepBlocks.length > 0 && <><h4>睡眠の仮予定</h4><ul>{preview.sleepBlocks.map(sleep => <li key={sleep.startAt}>{dateLabel(sleep.startAt)}～{dateLabel(sleep.endAt)}（要確認）</li>)}</ul></>}
      {preview.warnings.length > 0 && <><h4>AIからの注意点</h4><ul>{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></>}
      <button type="button" className="button primary" disabled={applying} onClick={() => void applyProposal()}>{applying ? '反映中…' : 'この提案を反映'}</button>
    </div>}
  </section>
}
