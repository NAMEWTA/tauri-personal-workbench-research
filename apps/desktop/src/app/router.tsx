import { createRootRoute, createRoute, createRouter, Navigate } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import type { ComponentType, LazyExoticComponent } from 'react'
import { AppShell } from '../components/layout/AppShell'
import { LoadingState } from '../components/ui/StateView'
import { TodayPage } from '../features/today/TodayPage'
import { TasksPage } from '../features/tasks/TasksPage'

const CalendarPage = lazy(() => import('../features/calendar/CalendarPage'))
const ArchivesPage = lazy(() =>
  import('../features/archives/ArchivesPage').then((m) => ({ default: m.ArchivesPage })),
)
const ArchiveDetailPage = lazy(() =>
  import('../features/archives/ArchiveDetailPage').then((m) => ({ default: m.ArchiveDetailPage })),
)
const ArchiveTypesPage = lazy(() =>
  import('../features/archives/ArchiveTypesPage').then((m) => ({ default: m.ArchiveTypesPage })),
)
const BackupPage = lazy(() =>
  import('../features/backup/BackupPage').then((m) => ({ default: m.BackupPage })),
)
const TrashPage = lazy(() =>
  import('../features/trash/TrashPage').then((m) => ({ default: m.TrashPage })),
)
const SettingsPage = lazy(() =>
  import('../features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })),
)
const lazyRoute = (Component: LazyExoticComponent<ComponentType>) => () => (
  <Suspense fallback={<LoadingState />}>
    <Component />
  </Suspense>
)
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
  component: lazyRoute(ArchivesPage),
})
const archiveDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/archives/$recordId',
  component: lazyRoute(ArchiveDetailPage),
})
const archiveTypesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/archive-collections',
  component: lazyRoute(ArchiveTypesPage),
})
const backupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/backup',
  component: lazyRoute(BackupPage),
})
const trashRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/trash',
  component: lazyRoute(TrashPage),
})
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/$section',
  component: lazyRoute(SettingsPage),
})
const diagnosticsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/diagnostics',
  component: lazyRoute(SettingsPage),
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
