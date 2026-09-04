import { useLayoutStore } from './layout'

describe('workspace layout state', () => {
  beforeEach(() => {
    useLayoutStore.setState({
      sidebarCollapsed: false,
      inspectorOpen: false,
      inspectorWidth: 344,
      theme: 'system',
      editorDirty: false,
      selection: undefined,
    })
  })

  it('applies and clamps preferences from the workspace API', () => {
    useLayoutStore.getState().applyPreferences({
      theme: 'dark',
      sidebarCollapsed: true,
      inspectorWidth: 999,
    })
    const state = useLayoutStore.getState()
    expect(state.theme).toBe('dark')
    expect(state.sidebarCollapsed).toBe(true)
    expect(state.inspectorWidth).toBe(480)
  })

  it('does not persist layout changes through browser storage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    useLayoutStore.getState().setTheme('light')
    useLayoutStore.getState().toggleSidebar()
    expect(setItem).not.toHaveBeenCalled()
    setItem.mockRestore()
  })

  it('guards inspector transitions while an editor has unsaved changes', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const store = useLayoutStore.getState()

    store.selectTask('task-a')
    store.setEditorDirty(true)
    store.selectTask('task-b')
    expect(useLayoutStore.getState().selection).toEqual({ kind: 'task', id: 'task-a' })
    expect(confirm).toHaveBeenCalledWith('当前编辑有未保存更改，确定放弃吗？')

    store.toggleInspector()
    expect(useLayoutStore.getState().inspectorOpen).toBe(true)

    confirm.mockReturnValue(true)
    store.selectArchive('archive-a')
    expect(useLayoutStore.getState().selection).toEqual({ kind: 'archive', id: 'archive-a' })
    expect(useLayoutStore.getState().editorDirty).toBe(false)

    useLayoutStore.getState().setEditorDirty(true)
    confirm.mockReturnValue(false)
    store.clearSelection()
    expect(useLayoutStore.getState().selection).toEqual({ kind: 'archive', id: 'archive-a' })

    confirm.mockReturnValue(true)
    store.clearSelection()
    expect(useLayoutStore.getState().selection).toBeUndefined()
    confirm.mockRestore()
  })
})
