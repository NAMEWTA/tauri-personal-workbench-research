import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Save, Trash2 } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import {
  createArchiveField,
  createArchiveType,
  deleteArchiveField,
  deleteArchiveType,
  updateArchiveField,
  updateArchiveType,
} from '../../generated/api/sdk.gen'
import type {
  ArchiveFieldDefinition,
  ArchiveFieldInput,
  ArchiveTypeInput,
} from '../../generated/api/types.gen'
import { requireData } from '../../lib/http/client'
import { archiveKeys, archiveTypesQuery } from './queries'

const emptyType: ArchiveTypeInput = {
  name: '',
  icon: 'FolderKanban',
  color: '#527A9E',
  sortOrder: 0,
}
const emptyField: ArchiveFieldInput = {
  key: '',
  label: '',
  valueType: 'text',
  group: '扩展属性',
  required: false,
  sensitive: false,
  options: [],
  sortOrder: 0,
}

export function ArchiveTypesPage() {
  const queryClient = useQueryClient()
  const types = useQuery(archiveTypesQuery)
  const [selectedId, setSelectedId] = useState('')
  const activeSelectedId = selectedId || types.data?.[0]?.id || ''
  const selected = types.data?.find((item) => item.id === activeSelectedId)
  const [typeDraft, setTypeDraft] = useState<ArchiveTypeInput>(emptyType)
  const effectiveTypeDraft = typeDraft.name
    ? typeDraft
    : selected
      ? {
          name: selected.name,
          icon: selected.icon,
          color: selected.color,
          sortOrder: selected.sortOrder,
        }
      : emptyType
  const [newTypeName, setNewTypeName] = useState('')
  const [fieldDraft, setFieldDraft] = useState<ArchiveFieldInput>(emptyField)
  const [editingField, setEditingField] = useState<ArchiveFieldDefinition>()
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: archiveKeys.types })
  }
  const createType = useMutation({
    mutationFn: async (body: ArchiveTypeInput) =>
      requireData((await createArchiveType({ body, throwOnError: true })).data),
    onSuccess: async (item) => {
      setNewTypeName('')
      setTypeDraft({
        name: item.name,
        icon: item.icon,
        color: item.color,
        sortOrder: item.sortOrder,
      })
      await refresh()
      setSelectedId(item.id)
    },
  })
  const saveType = useMutation({
    mutationFn: async (body: ArchiveTypeInput) =>
      requireData(
        (
          await updateArchiveType({
            path: { typeId: activeSelectedId },
            body,
            throwOnError: true,
          })
        ).data,
      ),
    onSuccess: refresh,
  })
  const removeType = useMutation({
    mutationFn: async () => {
      await deleteArchiveType({ path: { typeId: activeSelectedId }, throwOnError: true })
    },
    onSuccess: async () => {
      setSelectedId('')
      await refresh()
    },
  })
  const saveField = useMutation({
    mutationFn: async () =>
      editingField
        ? requireData(
            (
              await updateArchiveField({
                path: { fieldId: editingField.id },
                body: fieldDraft,
                throwOnError: true,
              })
            ).data,
          )
        : requireData(
            (
              await createArchiveField({
                path: { typeId: activeSelectedId },
                body: fieldDraft,
                throwOnError: true,
              })
            ).data,
          ),
    onSuccess: async () => {
      setEditingField(undefined)
      setFieldDraft(emptyField)
      await refresh()
    },
  })
  const removeField = useMutation({
    mutationFn: async (fieldId: string) => {
      await deleteArchiveField({ path: { fieldId }, throwOnError: true })
    },
    onSuccess: refresh,
  })
  const editField = (field: ArchiveFieldDefinition) => {
    setEditingField(field)
    setFieldDraft({
      key: field.key,
      label: field.label,
      valueType: field.valueType,
      group: field.group,
      required: field.required,
      sensitive: field.sensitive,
      options: field.options,
      defaultValue: field.defaultValue,
      sortOrder: field.sortOrder,
    })
  }
  return (
    <div className="page archive-types-page">
      <div className="page-header">
        <div>
          <Link className="back-link" to="/archives">
            <ArrowLeft size={15} />
            档案
          </Link>
          <h1>档案类型</h1>
        </div>
      </div>
      <div className="type-manager">
        <aside className="type-list">
          {types.data?.map((item) => (
            <button
              key={item.id}
              className={activeSelectedId === item.id ? 'active' : ''}
              onClick={() => {
                setSelectedId(item.id)
                setTypeDraft({
                  name: item.name,
                  icon: item.icon,
                  color: item.color,
                  sortOrder: item.sortOrder,
                })
              }}
            >
              <span style={{ backgroundColor: item.color }} />
              <strong>{item.name}</strong>
              <small>{item.fields.length} 个属性</small>
            </button>
          ))}
          <form
            className="new-type-form"
            onSubmit={(event) => {
              event.preventDefault()
              if (newTypeName.trim())
                createType.mutate({
                  ...emptyType,
                  name: newTypeName.trim(),
                  sortOrder: types.data?.length ?? 0,
                })
            }}
          >
            <input
              value={newTypeName}
              onChange={(event) => setNewTypeName(event.target.value)}
              placeholder="新类型名称"
              aria-label="新类型名称"
            />
            <button className="button" disabled={!newTypeName.trim() || createType.isPending}>
              <Plus size={15} />
              创建
            </button>
          </form>
        </aside>
        {selected ? (
          <div className="type-editor">
            <section>
              <div className="section-heading">
                <h2>类型设置</h2>
                <button
                  className="button danger-quiet"
                  onClick={() => {
                    if (confirm('仅未创建档案的类型可以删除，继续？')) removeType.mutate()
                  }}
                >
                  <Trash2 size={15} />
                  删除
                </button>
              </div>
              <div className="type-settings-grid">
                <label>
                  名称
                  <input
                    value={effectiveTypeDraft.name}
                    onChange={(event) =>
                      setTypeDraft({ ...effectiveTypeDraft, name: event.target.value })
                    }
                  />
                </label>
                <label>
                  颜色
                  <input
                    type="color"
                    value={effectiveTypeDraft.color}
                    onChange={(event) =>
                      setTypeDraft({ ...effectiveTypeDraft, color: event.target.value })
                    }
                  />
                </label>
                <label>
                  图标标识
                  <input
                    value={effectiveTypeDraft.icon}
                    onChange={(event) =>
                      setTypeDraft({ ...effectiveTypeDraft, icon: event.target.value })
                    }
                  />
                </label>
                <label>
                  排序
                  <input
                    type="number"
                    value={effectiveTypeDraft.sortOrder}
                    onChange={(event) =>
                      setTypeDraft({ ...effectiveTypeDraft, sortOrder: Number(event.target.value) })
                    }
                  />
                </label>
              </div>
              <button
                className="button primary"
                onClick={() => saveType.mutate(effectiveTypeDraft)}
                disabled={!effectiveTypeDraft.name.trim() || saveType.isPending}
              >
                <Save size={15} />
                保存类型
              </button>
            </section>
            <section>
              <div className="section-heading">
                <h2>扩展属性</h2>
              </div>
              <div className="field-definition-list">
                {selected.fields.map((field) => (
                  <div key={field.id}>
                    <button onClick={() => editField(field)}>
                      <strong>{field.label}</strong>
                      <small>
                        {field.key} · {field.valueType}
                        {field.required ? ' · 必填' : ''}
                      </small>
                    </button>
                    <button
                      className="icon-button"
                      onClick={() => removeField.mutate(field.id)}
                      aria-label="删除属性"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <form
                className="field-definition-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  saveField.mutate()
                }}
              >
                <div className="field-pair">
                  <label>
                    属性名称
                    <input
                      required
                      value={fieldDraft.label}
                      onChange={(event) =>
                        setFieldDraft({ ...fieldDraft, label: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    属性键
                    <input
                      required
                      value={fieldDraft.key}
                      onChange={(event) =>
                        setFieldDraft({ ...fieldDraft, key: event.target.value })
                      }
                    />
                  </label>
                </div>
                <div className="field-pair">
                  <label>
                    字段类型
                    <select
                      value={fieldDraft.valueType}
                      onChange={(event) =>
                        setFieldDraft({
                          ...fieldDraft,
                          valueType: event.target.value as ArchiveFieldInput['valueType'],
                          options: event.target.value === 'select' ? fieldDraft.options : [],
                        })
                      }
                    >
                      <option value="text">单行文本</option>
                      <option value="multiline">多行文本</option>
                      <option value="number">数字</option>
                      <option value="date">日期</option>
                      <option value="datetime">日期时间</option>
                      <option value="boolean">开关</option>
                      <option value="select">选项</option>
                    </select>
                  </label>
                  <label>
                    分组
                    <input
                      value={fieldDraft.group}
                      onChange={(event) =>
                        setFieldDraft({ ...fieldDraft, group: event.target.value })
                      }
                    />
                  </label>
                </div>
                {fieldDraft.valueType === 'select' && (
                  <label>
                    选项（逗号分隔）
                    <input
                      value={fieldDraft.options.join(',')}
                      onChange={(event) =>
                        setFieldDraft({
                          ...fieldDraft,
                          options: event.target.value
                            .split(',')
                            .map((value) => value.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </label>
                )}
                <div className="field-options">
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={fieldDraft.required}
                      onChange={(event) =>
                        setFieldDraft({ ...fieldDraft, required: event.target.checked })
                      }
                    />
                    必填
                  </label>
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={fieldDraft.sensitive}
                      onChange={(event) =>
                        setFieldDraft({ ...fieldDraft, sensitive: event.target.checked })
                      }
                    />
                    敏感
                  </label>
                </div>
                <div className="editor-actions">
                  <button
                    type="button"
                    className="button"
                    onClick={() => {
                      setEditingField(undefined)
                      setFieldDraft(emptyField)
                    }}
                  >
                    {editingField ? '取消编辑' : '清空'}
                  </button>
                  <button
                    className="button primary"
                    disabled={
                      !fieldDraft.label.trim() || !fieldDraft.key.trim() || saveField.isPending
                    }
                  >
                    {editingField ? '保存属性' : '添加属性'}
                  </button>
                </div>
              </form>
            </section>
          </div>
        ) : (
          <p className="quiet-empty">请选择或创建档案类型。</p>
        )}
      </div>
    </div>
  )
}
