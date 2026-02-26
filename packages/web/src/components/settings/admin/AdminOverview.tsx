import { useState, useEffect } from 'react'
import { Loader2, Users, MessageSquare, Bot, Package, Clock, Webhook, Plug, Phone, MessageCircle, Play } from 'lucide-react'
import type { AdminStats } from '@/types'

export function AdminOverview() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadStats()
  }, [])

  async function loadStats() {
    try {
      const data = await window.api.admin.getStats()
      setStats(data)
    } catch (e) {
      console.error('Failed to load admin stats:', e)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!stats) {
    return <div className="text-center py-12 text-sm text-muted-foreground">Failed to load stats</div>
  }

  const cards = [
    { label: 'Users', value: stats.totalUsers, icon: Users, color: 'text-blue-400' },
    { label: 'Threads', value: stats.totalThreads, icon: MessageSquare, color: 'text-purple-400' },
    { label: 'Agents', value: stats.totalAgents, icon: Bot, color: 'text-green-400' },
    { label: 'Skills', value: stats.totalSkills, icon: Package, color: 'text-amber-400' },
    { label: 'Cronjobs', value: stats.totalCronjobs, icon: Clock, color: 'text-teal-400' },
    { label: 'Webhooks', value: stats.totalWebhooks, icon: Webhook, color: 'text-pink-400' },
    { label: 'Connections', value: stats.totalAppConnections, icon: Plug, color: 'text-indigo-400' },
    { label: 'WA Contacts', value: stats.totalWhatsAppContacts, icon: Phone, color: 'text-emerald-400' },
    { label: 'WA Chats', value: stats.totalWhatsAppChats, icon: MessageCircle, color: 'text-lime-400' },
    { label: 'Runs', value: stats.totalRuns, icon: Play, color: 'text-orange-400' },
  ]

  return (
    <div className="space-y-4">
      <div className="text-section-header">DASHBOARD OVERVIEW</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {cards.map((card) => (
          <div
            key={card.label}
            className="p-3 border border-border rounded-sm bg-background-elevated"
          >
            <div className="flex items-center gap-2 mb-1">
              <card.icon className={`size-4 ${card.color}`} />
              <span className="text-xs text-muted-foreground">{card.label}</span>
            </div>
            <div className="text-2xl font-bold">{card.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
