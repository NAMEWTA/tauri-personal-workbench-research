import { createRootRoute, createRoute, createRouter, Navigate } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { AppShell } from '../components/layout/AppShell'
import { LoadingState } from '../components/ui/StateView'
import { ArchivesPage } from '../features/archives/ArchivesPage'
import { ArchiveDetailPage } from '../features/archives/ArchiveDetailPage'
import { ArchiveTypesPage } from '../features/archives/ArchiveTypesPage'
import { TodayPage } from '../features/today/TodayPage'
import { TasksPage } from '../features/tasks/TasksPage'
import { TrashPage } from '../features/trash/TrashPage'
import { SettingsPage } from '../features/settings/SettingsPage'
import { BackupPage } from '../features/backup/BackupPage'

const CalendarPage = lazy(() => import('../features/calendar/CalendarPage'))
const rootRoute = createRootRoute({ component: AppShell })
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => <Navigate to="/today" />,
})
const todayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/today',
  component: TodayPage,
})
const tasksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tasks',
  component: TasksPage,
})
const calendarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/calendar',
  component: () => (
    <Suspense fallback={<LoadingState label="正在载入日历…" />}>
      <CalendarPage />
    </Suspense>
  ),
})
const archivesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/archives',
  component: ArchivesPage,
})
const archiveDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/archives/$archiveId',
  component: ArchiveDetailPage,
})
const archiveTypesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/archive-types',
  component: ArchiveTypesPage,
})
const backupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/backup',
  component: BackupPage,
})
const trashRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/trash',
  component: TrashPage,
})
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/$section',
  component: SettingsPage,
})
const diagnosticsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/diagnostics',
  component: SettingsPage,
})
const routeTree = rootRoute.addChildren([
  indexRoute,
  todayRoute,
  tasksRoute,
  calendarRoute,
  archivesRoute,
  archiveDetailRoute,
  archiveTypesRoute,
  backupRoute,
  trashRoute,
  settingsRoute,
  diagnosticsRoute,
])

export const router = createRouter({ routeTree, defaultPreload: 'intent', scrollRestoration: true })
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
