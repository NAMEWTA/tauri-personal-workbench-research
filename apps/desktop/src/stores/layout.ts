import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'light' | 'dark' | 'system'
type InspectorSelection = { kind: 'task'; id: string } | { kind: 'archive'; id: string }
type LayoutStore = {
  sidebarCollapsed: boolean
  inspectorOpen: boolean
  inspectorWidth: number
  theme: Theme
  selection?: InspectorSelection
  toggleSidebar: () => void
  toggleInspector: () => void
  setInspectorWidth: (width: number) => void
  setTheme: (theme: Theme) => void
  selectTask: (id: string) => void
  selectArchive: (id: string) => void
  clearSelection: () => void
}

export const useLayoutStore = create<LayoutStore>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      inspectorOpen: false,
      inspectorWidth: 344,
      theme: 'system',
      selection: undefined,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      toggleInspector: () => set((state) => ({ inspectorOpen: !state.inspectorOpen })),
      setInspectorWidth: (width) => set({ inspectorWidth: Math.min(480, Math.max(300, width)) }),
      setTheme: (theme) => set({ theme }),
      selectTask: (id) => set({ selection: { kind: 'task', id }, inspectorOpen: true }),
      selectArchive: (id) => set({ selection: { kind: 'archive', id }, inspectorOpen: true }),
      clearSelection: () => set({ selection: undefined, inspectorOpen: false }),
    }),
    {
      name: 'workbench-layout',
      partialize: ({ sidebarCollapsed, inspectorWidth, theme }) => ({
        sidebarCollapsed,
        inspectorWidth,
        theme,
      }),
    },
  ),
)
