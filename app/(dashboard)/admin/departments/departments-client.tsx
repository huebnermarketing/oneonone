'use client'

import { useState, useId } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Building2, Users, Pencil, Trash2, X, Loader2 } from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { plural } from '@/lib/ui'

interface Department {
  id: string
  name: string
  _count: {
    users: number
  }
}

interface DepartmentsClientProps {
  departments: Department[]
}

export function DepartmentsClient({ departments: initialDepartments }: DepartmentsClientProps) {
  const router = useRouter()
  const { toastError } = useToast()
  const [departments, setDepartments] = useState(initialDepartments)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [editName, setEditName] = useState('')
  const [loading, setLoading] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const newNameId = useId()
  const editNameId = useId()

  const handleAdd = async () => {
    if (!newName.trim()) return
    setLoading(true)
    try {
      const response = await fetch('/api/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      })
      
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create department')
      }
      
      const dept = await response.json()
      setDepartments([...departments, { ...dept, _count: { users: 0 } }])
      setNewName('')
      setIsAddOpen(false)
      router.refresh()
    } catch (error: unknown) {
      toastError(error instanceof Error ? error.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = async (id: string) => {
    if (!editName.trim()) return
    setLoading(true)
    try {
      const response = await fetch(`/api/departments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim() }),
      })
      
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update department')
      }
      
      setDepartments(departments.map(d => 
        d.id === id ? { ...d, name: editName.trim() } : d
      ))
      setEditingId(null)
      setEditName('')
      router.refresh()
    } catch (error: unknown) {
      toastError(error instanceof Error ? error.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    setLoading(true)
    try {
      const response = await fetch(`/api/departments/${id}`, {
        method: 'DELETE',
      })
      
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete department')
      }
      
      setDepartments(departments.filter(d => d.id !== id))
      setDeleteConfirm(null)
      router.refresh()
    } catch (error: unknown) {
      toastError(error instanceof Error ? error.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const startEdit = (dept: Department) => {
    setEditingId(dept.id)
    setEditName(dept.name)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-dark-gray dark:text-white mb-2">Departments</h1>
          <p className="text-medium-gray">Manage departments and teams</p>
        </div>
        <button
          type="button"
          onClick={() => setIsAddOpen(true)}
          className="flex items-center gap-2 px-5 py-3 bg-dark-gray dark:bg-white text-white dark:text-dark-gray rounded-xl font-medium hover:bg-charcoal dark:hover:bg-off-white transition-all"
        >
          <Plus className="w-5 h-5" />
          Add Department
        </button>
      </div>

      {/* Add Department Form */}
      {isAddOpen && (
        <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-dark-gray dark:text-white">New Department</h3>
            <button
              type="button"
              onClick={() => {
                setIsAddOpen(false)
                setNewName('')
              }}
              aria-label="Close new department form"
              className="p-1 hover:bg-off-white dark:hover:bg-charcoal rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-medium-gray" aria-hidden="true" />
            </button>
          </div>
          <div className="flex gap-3">
            <label htmlFor={newNameId} className="sr-only">Department name</label>
            <input
              id={newNameId}
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Department name"
              className="flex-1 px-4 py-3 rounded-xl border border-off-white dark:border-medium-gray/20 bg-off-white dark:bg-charcoal text-dark-gray dark:text-white focus:outline-none focus:ring-2 focus:ring-dark-gray/20 dark:focus:ring-white/20"
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              autoFocus
            />
            <button
              type="button"
              onClick={handleAdd}
              disabled={loading || !newName.trim()}
              aria-label="Add department"
              className="px-6 py-3 bg-dark-gray dark:bg-white text-white dark:text-dark-gray rounded-xl font-medium hover:bg-charcoal dark:hover:bg-off-white disabled:opacity-50 transition-all"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> : 'Add'}
            </button>
          </div>
        </div>
      )}

      {/* Departments Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {departments.length === 0 ? (
          <div className="col-span-full text-center py-12">
            <Building2 className="w-16 h-16 text-light-gray mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-dark-gray dark:text-white mb-2">No departments yet</h3>
            <p className="text-medium-gray mb-4">Create your first department to organize your team</p>
            <button
              type="button"
              onClick={() => setIsAddOpen(true)}
              className="inline-flex items-center gap-2 px-5 py-3 bg-dark-gray dark:bg-white text-white dark:text-dark-gray rounded-xl font-medium hover:bg-charcoal dark:hover:bg-off-white transition-all"
            >
              <Plus className="w-5 h-5" />
              Add Department
            </button>
          </div>
        ) : (
          departments.map((dept) => (
            <div
              key={dept.id}
              className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-6 hover:shadow-card transition-all"
            >
              {editingId === dept.id ? (
                <div className="space-y-3">
                  <label htmlFor={editNameId} className="sr-only">Department name</label>
                  <input
                    id={editNameId}
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-4 py-2 rounded-xl border border-off-white dark:border-medium-gray/20 bg-off-white dark:bg-charcoal text-dark-gray dark:text-white focus:outline-none focus:ring-2 focus:ring-dark-gray/20 dark:focus:ring-white/20"
                    onKeyDown={(e) => e.key === 'Enter' && handleEdit(dept.id)}
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleEdit(dept.id)}
                      disabled={loading || !editName.trim()}
                      className="flex-1 px-4 py-2 bg-dark-gray dark:bg-white text-white dark:text-dark-gray rounded-xl text-sm font-medium hover:bg-charcoal dark:hover:bg-off-white disabled:opacity-50 transition-all"
                    >
                      {loading ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(null)
                        setEditName('')
                      }}
                      className="px-4 py-2 text-sm font-medium text-medium-gray hover:text-dark-gray dark:hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : deleteConfirm === dept.id ? (
                <div className="space-y-3">
                  <p className="text-sm text-red-500 font-medium">
                    Delete {dept.name}? {dept._count.users > 0 && `This will affect ${plural(dept._count.users, 'employee')}.`}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleDelete(dept.id)}
                      disabled={loading}
                      className="flex-1 px-4 py-2 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 disabled:opacity-50 transition-all"
                    >
                      {loading ? 'Deleting...' : 'Delete'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm(null)}
                      className="px-4 py-2 text-sm font-medium text-medium-gray hover:text-dark-gray dark:hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-12 h-12 rounded-2xl bg-off-white dark:bg-dark-gray flex items-center justify-center">
                      <Building2 className="w-6 h-6 text-dark-gray dark:text-white" />
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => startEdit(dept)}
                        className="p-2 hover:bg-off-white dark:hover:bg-dark-gray rounded-lg transition-colors"
                        title="Edit"
                        aria-label={`Edit ${dept.name}`}
                      >
                        <Pencil className="w-4 h-4 text-light-gray hover:text-dark-gray dark:hover:text-white" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteConfirm(dept.id)}
                        className="p-2 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                        title="Delete"
                        aria-label={`Delete ${dept.name}`}
                      >
                        <Trash2 className="w-4 h-4 text-light-gray hover:text-red-500" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <h3 className="font-semibold text-dark-gray dark:text-white mb-1">{dept.name}</h3>
                  <div className="flex items-center gap-2 text-medium-gray">
                    <Users className="w-4 h-4" aria-hidden="true" />
                    <span className="text-sm">{plural(dept._count.users, 'employee')}</span>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
