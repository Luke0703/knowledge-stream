import { useState } from 'react'
import type { CategoryDto } from '../shared/api'

export function GenrePicker(props: {
  categories: CategoryDto[]
  initialSelectedIds: string[]
  submitLabel: string
  onSubmit: (ids: string[]) => void
}) {
  const [selected, setSelected] = useState(props.initialSelectedIds)
  const ids = props.categories.filter(category => selected.includes(category.id)).map(category => category.id)
  return <form onSubmit={event => { event.preventDefault(); if (ids.length) props.onSubmit(ids) }}>
    <div className="genre-list">{props.categories.map(category => <label key={category.id}>
      <input type="checkbox" checked={selected.includes(category.id)} onChange={event => setSelected(previous => event.target.checked ? [...previous, category.id] : previous.filter(id => id !== category.id))} />{category.name}
    </label>)}</div>
    <button disabled={ids.length === 0}>{props.submitLabel}</button>
  </form>
}

export function GenreSelectScreen(props: {
  categories: CategoryDto[]
  initialSelectedIds: string[]
  onSubmit: (ids: string[]) => void
}) {
  return <main className="genre-select">
    <h2>ジャンルを選んでください</h2>
    <p>見たいジャンルを1つ以上選んでください。複数選ぶと、どれかに当てはまる動画が流れます。</p>
    <GenrePicker {...props} submitLabel="このジャンルではじめる" />
  </main>
}
