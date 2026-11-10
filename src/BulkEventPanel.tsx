import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { db } from './db'
import type { PlannerItem } from './model'
import { makeEventChangePrompt, validateEventChanges, type EventTimeChange } from './bulkEventChanges'

const label = (value: string) => format(parseISO(value), 'yyyy年M月d日 HH:mm')
const messageOf = (error: unknown) => error instanceof Error ? error.message.slice(0, 250) : '検証できませんでした'

export function BulkEventPanel({ items, onApplied }: { items: PlannerItem[]; onApplied: (message: string) => void }) {
  const [instruction, setInstruction] = useState('')
  const [prompt, setPrompt] = useState('')
  const [response, setResponse] = useState('')
  const [preview, setPreview] = useState<EventTimeChange[] | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [applying, setApplying] = useState(false)
  const titles = new Map(items.map(item => [item.id, item.title]))

  async function copyPrompt() {
    if (!instruction.trim()) { setError('変更したい内容を入力してください'); return }
    const next = makeEventChangePrompt(items, instruction)
    setPrompt(next); setError(''); setMessage(''); setPreview(null)
    try { await navigator.clipboard.writeText(next); setMessage('予定変更用プロンプトをコピーしました') }
    catch { setMessage('コピーできませんでした。下の欄からコピーしてください') }
  }

  function check() {
    setError(''); setMessage(''); setPreview(null)
    try { setPreview(validateEventChanges(response, items)) }
    catch (err) { setError(messageOf(err)) }
  }

  async function apply() {
    if (!preview || applying) return
    setApplying(true); setError('')
    try {
      await db.transaction('rw', db.items, async () => {
        const latest = await db.items.toArray()
        const checked = validateEventChanges(response, latest)
        const byId = new Map(latest.map(item => [item.id, item]))
        const updatedAt = new Date().toISOString()
        await db.items.bulkPut(checked.map(change => ({ ...byId.get(change.id)!,
          startAt: change.startAt, endAt: change.endAt, updatedAt })))
      })
      setResponse(''); setPreview(null)
      onApplied(`${preview.length}件の予定時刻を変更しました`)
    } catch (err) { setError(messageOf(err)); setPreview(null) }
    finally { setApplying(false) }
  }

  return <section className="panel">
    <div className="panel-head"><span className="panel-icon">↻</span><div><h2>AIで予定時刻をまとめて変更</h2><p>変更したい内容をAIに伝え、返答を確認してから反映します。</p></div></div>
    <label className="json-label">変更の指示<textarea rows={3} value={instruction} onChange={event => { setInstruction(event.target.value); setPreview(null) }} placeholder="例：来週の会議をすべて30分遅らせて。終了も30分遅らせて。" /></label>
    <div className="button-row"><button type="button" className="button secondary" disabled={!instruction.trim() || !items.some(item => item.type === 'event')} onClick={() => void copyPrompt()}>予定変更用プロンプトをコピー</button></div>
    {prompt && <label className="json-label">生成したプロンプト<textarea readOnly rows={7} value={prompt} onFocus={event => event.target.select()} /></label>}
    <label className="json-label">AIが返した eventTimeChanges JSON<textarea rows={7} spellCheck={false} value={response}
      onChange={event => { setResponse(event.target.value); setPreview(null); setError('') }}
      placeholder={'{"schemaVersion":1,"kind":"eventTimeChanges","changes":[]}'} /></label>
    <button type="button" className="button secondary" disabled={!response.trim()} onClick={check}>変更案を検証して確認</button>
    {message && <p className="hint" role="status">{message}</p>}
    {error && <p className="form-error" role="alert">{error}。JSONを直すか、プロンプトを再送してください。予定は変更されていません。</p>}
    {preview && <div className="plan-preview" aria-label="予定変更の確認"><h3>変更前の確認</h3><p>{preview.length}件の予定を変更します。</p>
      <ul>{preview.map(change => <li key={change.id}><strong>{titles.get(change.id)}</strong> · {label(change.originalStartAt)}～{label(change.originalEndAt)} → {label(change.startAt)}～{label(change.endAt)}</li>)}</ul>
      <button type="button" className="button primary" disabled={applying} onClick={() => void apply()}>{applying ? '反映中…' : 'この変更案を承認して反映'}</button>
    </div>}
    <p className="hint">固定予定や配置済みタスクとの重なり、過去日時、ID、元の日時をアプリが確認します。繰り返し予定は系列全体の時刻が変わり、個別に変更済みの回はそのまま残ります。</p>
  </section>
}
