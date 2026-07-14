import { useState, useEffect } from 'react'
import { Shield, ShieldCheck, ShieldOff, Trash2, UserPlus, Crown } from 'lucide-react'
import { useApi } from '../hooks/useApi'

interface User {
  id: string
  email: string
  name: string | null
  tier: 'free' | 'premium'
  role: 'master' | 'admin' | 'user'
  expiresAt: string | null
  createdAt: string
}

export function AdminPanel() {
  const { get, post, patch, del } = useApi()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newName, setNewName] = useState('')
  const [newTier, setNewTier] = useState<'free' | 'premium'>('free')

  const loadUsers = async () => {
    try {
      const data = await get<{ users: User[] }>('/api/admin/users')
      setUsers(data.users)
    } catch {
      setError('Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadUsers() }, [])

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await post('/api/admin/users', {
        email: newEmail,
        password: newPassword,
        name: newName,
        tier: newTier,
      })
      setShowCreateModal(false)
      setNewEmail('')
      setNewPassword('')
      setNewName('')
      setNewTier('free')
      loadUsers()
    } catch {
      setError('Failed to create user')
    }
  }

  const handleTierChange = async (userId: string, newTier: 'free' | 'premium') => {
    try {
      await patch(`/api/admin/users/${userId}/tier`, { tier: newTier })
      loadUsers()
    } catch {
      setError('Failed to update tier')
    }
  }

  const handleDelete = async (userId: string) => {
    if (!confirm('Delete this user?')) return
    try {
      await del(`/api/admin/users/${userId}`)
      loadUsers()
    } catch {
      setError('Failed to delete user')
    }
  }

  if (loading) {
    return <div className="text-zinc-400">Loading users...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Crown className="w-6 h-6 text-yellow-400" />
          <h1 className="text-2xl font-bold text-zinc-50">Admin Panel</h1>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-zinc-50 text-zinc-900 rounded-lg font-medium hover:bg-zinc-200 transition-colors"
        >
          <UserPlus className="w-4 h-4" />
          Add User
        </button>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase">User</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Role</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Tier</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Created</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                <td className="px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-zinc-50">{user.name || 'No name'}</p>
                    <p className="text-xs text-zinc-500">{user.email}</p>
                  </div>
                </td>
                <td className="px-4 py-3">
                  {user.role === 'master' ? (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                      <Crown className="w-3 h-3" />
                      Master
                    </span>
                  ) : user.role === 'admin' ? (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30">
                      <ShieldCheck className="w-3 h-3" />
                      Admin
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-zinc-500/20 text-zinc-400 border border-zinc-500/30">
                      <Shield className="w-3 h-3" />
                      User
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {user.tier === 'premium' ? (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      Premium
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-zinc-500/20 text-zinc-400 border border-zinc-500/30">
                      Free
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-zinc-500">
                  {new Date(user.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => handleTierChange(user.id, user.tier === 'premium' ? 'free' : 'premium')}
                      className={`p-1.5 rounded-lg transition-colors ${
                        user.tier === 'premium'
                          ? 'text-zinc-400 hover:text-amber-400 hover:bg-amber-400/10'
                          : 'text-zinc-400 hover:text-emerald-400 hover:bg-emerald-400/10'
                      }`}
                      title={user.tier === 'premium' ? 'Downgrade to Free' : 'Upgrade to Premium'}
                    >
                      {user.tier === 'premium' ? <ShieldOff className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => handleDelete(user.id)}
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                      title="Delete user"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {users.length === 0 && (
          <div className="px-4 py-8 text-center text-zinc-500">No users found</div>
        )}
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-zinc-900 rounded-xl border border-zinc-800 p-6 space-y-4">
            <h2 className="text-lg font-bold text-zinc-50">Create User</h2>
            <form onSubmit={handleCreateUser} className="space-y-3">
              <input
                type="email"
                placeholder="Email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-50 text-sm focus:outline-none focus:border-zinc-600"
                required
              />
              <input
                type="password"
                placeholder="Password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-50 text-sm focus:outline-none focus:border-zinc-600"
                required
              />
              <input
                type="text"
                placeholder="Name (optional)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-50 text-sm focus:outline-none focus:border-zinc-600"
              />
              <select
                value={newTier}
                onChange={(e) => setNewTier(e.target.value as 'free' | 'premium')}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-50 text-sm focus:outline-none focus:border-zinc-600"
              >
                <option value="free">Free</option>
                <option value="premium">Premium</option>
              </select>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 py-2 bg-zinc-800 text-zinc-400 rounded-lg text-sm hover:bg-zinc-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-zinc-50 text-zinc-900 rounded-lg text-sm font-medium hover:bg-zinc-200 transition-colors"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
