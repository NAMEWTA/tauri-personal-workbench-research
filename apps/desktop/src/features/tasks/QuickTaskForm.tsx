import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useCreateTask } from './mutations'
import { useLayoutStore } from '../../stores/layout'

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

export function QuickTaskForm() {
  const [title, setTitle] = useState('')
  const create = useCreateTask()
  const selectTask = useLayoutStore((state) => state.selectTask)
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const value = title.trim()
    if (!value) return
    create.mutate(
      { title: value, status: 'todo', priority: 'normal', allDay: false, timezone },
      {
        onSuccess: (task) => {
          setTitle('')
          selectTask(task.id)
        },
      },
    )
  }
  return (
    <form className="quick-add" onSubmit={submit}>
      <Plus size={17} />
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="快速添加任务"
        aria-label="任务标题"
      />
      <button className="button primary" disabled={create.isPending || !title.trim()}>
        添加
      </button>
    </form>
  )
}
