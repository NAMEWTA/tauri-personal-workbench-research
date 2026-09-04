import { create } from 'zustand'

type Theme = 'light' | 'dark' | 'system'
type InspectorSelection = { kind: 'task'; id: string } | { kind: 'archive'; id: string }
type LayoutStore = {
  sidebarCollapsed: boolean
  inspectorOpen: boolean
  inspectorWidth: number
  theme: Theme
  editorDirty: boolean
  selection?: InspectorSelection
  toggleSidebar: () => void
  toggleInspector: () => void
  setInspectorWidth: (width: number) => void
  setTheme: (theme: Theme) => void
  setEditorDirty: (dirty: boolean) => void
  applyPreferences: (preferences: {
    theme: Theme
    sidebarCollapsed: boolean
    inspectorWidth: number
  }) => void
  selectTask: (id: string) => void
  selectArchive: (id: string) => void
  clearSelection: () => void
}

export const useLayoutStore = create<LayoutStore>((set, get) => ({
  sidebarCollapsed: false,
  inspectorOpen: false,
  inspectorWidth: 344,
  theme: 'system',
  editorDirty: false,
  selection: undefined,
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  toggleInspector: () => {
    const current = get()
    if (current.inspectorOpen && current.editorDirty && !confirmDiscardChanges()) return
    set((state) => ({
      inspectorOpen: !state.inspectorOpen,
      editorDirty: state.inspectorOpen ? false : state.editorDirty,
    }))
  },
  setInspectorWidth: (width) => set({ inspectorWidth: Math.min(480, Math.max(300, width)) }),
  setTheme: (theme) => set({ theme }),
  setEditorDirty: (dirty) => set({ editorDirty: dirty }),
  applyPreferences: ({ theme, sidebarCollapsed, inspectorWidth }) =>
    set({ theme, sidebarCollapsed, inspectorWidth: Math.min(480, Math.max(300, inspectorWidth)) }),
  selectTask: (id) => {
    const current = get()
    if (current.selection?.kind === 'task' && current.selection.id === id) {
      set({ inspectorOpen: true })
      return
    }
    if (current.editorDirty && !confirmDiscardChanges()) return
    set({ selection: { kind: 'task', id }, inspectorOpen: true, editorDirty: false })
  },
  selectArchive: (id) => {
    const current = get()
    if (current.selection?.kind === 'archive' && current.selection.id === id) {
      set({ inspectorOpen: true })
      return
    }
    if (current.editorDirty && !confirmDiscardChanges()) return
    set({ selection: { kind: 'archive', id }, inspectorOpen: true, editorDirty: false })
  },
  clearSelection: () => {
    if (get().editorDirty && !confirmDiscardChanges()) return
    set({ selection: undefined, inspectorOpen: false, editorDirty: false })
  },
}))

function confirmDiscardChanges() {
  return (
    typeof window === 'undefined' ||
    typeof window.confirm !== 'function' ||
    window.confirm('当前编辑有未保存更改，确定放弃吗？')
  )
}
