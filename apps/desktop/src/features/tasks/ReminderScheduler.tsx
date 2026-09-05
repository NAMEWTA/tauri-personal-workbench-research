import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { tasksQuery } from './queries'

export function ReminderScheduler() {
  const query = useQuery(tasksQuery('all'))
  const notified = useRef(new Set<string>())

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    let active = true
    const check = () => {
      if (!active || Notification.permission !== 'granted') return
      const now = Date.now()
      for (const task of query.data ?? []) {
        for (const reminder of task.reminders ?? []) {
          const key = `${task.id}:${reminder}`
          const timestamp = new Date(reminder).getTime()
          if (notified.current.has(key) || !Number.isFinite(timestamp) || timestamp > now) continue
          try {
            new Notification(task.title, { body: '任务提醒时间到了。' })
            notified.current.add(key)
          } catch {
            // 通知创建失败时保留待发送状态，下一轮继续尝试。
          }
        }
      }
    }
    if (
      Notification.permission === 'default' &&
      (query.data ?? []).some((task) => (task.reminders ?? []).length > 0)
    ) {
      void Notification.requestPermission()
        .then(check)
        .catch(() => {
          // 浏览器暂时拒绝请求权限时，保留提醒并等待下次检查。
        })
    }
    check()
    const timer = window.setInterval(check, 30_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [query.data])

  return null
}
