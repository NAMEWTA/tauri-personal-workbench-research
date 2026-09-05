import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { tasksQuery } from './queries'

export function ReminderScheduler() {
  const query = useQuery(tasksQuery('all'))
  const notified = useRef(new Set<string>())

  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'default' &&
      (query.data ?? []).some((task) => (task.reminders ?? []).length > 0)
    ) {
      void Notification.requestPermission()
    }
    const check = () => {
      if (typeof window === 'undefined' || !('Notification' in window)) return
      const now = Date.now()
      for (const task of query.data ?? []) {
        for (const reminder of task.reminders ?? []) {
          const key = `${task.id}:${reminder}`
          if (notified.current.has(key) || new Date(reminder).getTime() > now) continue
          notified.current.add(key)
          if (Notification.permission === 'granted') {
            new Notification(task.title, { body: '任务提醒时间到了。' })
          }
        }
      }
    }
    check()
    const timer = window.setInterval(check, 30_000)
    return () => window.clearInterval(timer)
  }, [query.data])

  return null
}
