import { useState } from 'react'
import { BarChart3, Users, Layers, MessageSquare, Bot, Package, Clock, Webhook, Plug, Phone, Play, Database, FileText, Globe } from 'lucide-react'
import { AdminOverview } from './AdminOverview'
import { AdminUsers } from './AdminUsers'
import { AdminTiers } from './AdminTiers'
import { AdminThreads } from './AdminThreads'
import { AdminAgents } from './AdminAgents'
import { AdminSkills } from './AdminSkills'
import { AdminCronjobs } from './AdminCronjobs'
import { AdminWebhooks } from './AdminWebhooks'
import { AdminConnections } from './AdminConnections'
import { AdminWhatsApp } from './AdminWhatsApp'
import { AdminRuns } from './AdminRuns'
import { AdminSQL } from './AdminSQL'
import { AdminSystemPrompt } from './AdminSystemPrompt'
import { AdminOpenRouter } from './AdminOpenRouter'

type AdminSection =
  | 'overview'
  | 'users'
  | 'tiers'
  | 'threads'
  | 'agents'
  | 'skills'
  | 'cronjobs'
  | 'webhooks'
  | 'connections'
  | 'whatsapp'
  | 'runs'
  | 'sql'
  | 'system-prompt'
  | 'openrouter'

const SECTIONS: Array<{ id: AdminSection; label: string; icon: typeof BarChart3 }> = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'tiers', label: 'Tiers', icon: Layers },
  { id: 'threads', label: 'Threads', icon: MessageSquare },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'skills', label: 'Skills', icon: Package },
  { id: 'cronjobs', label: 'Cronjobs', icon: Clock },
  { id: 'webhooks', label: 'Webhooks', icon: Webhook },
  { id: 'connections', label: 'Connections', icon: Plug },
  { id: 'whatsapp', label: 'WhatsApp', icon: Phone },
  { id: 'runs', label: 'Runs', icon: Play },
  { id: 'sql', label: 'SQL', icon: Database },
  { id: 'system-prompt', label: 'System Prompt', icon: FileText },
  { id: 'openrouter', label: 'OpenRouter', icon: Globe },
]

export function AdminTab() {
  const [activeSection, setActiveSection] = useState<AdminSection>('overview')

  return (
    <div className="flex gap-4 py-4 h-full">
      {/* Sidebar */}
      <div className="w-36 shrink-0 space-y-0.5">
        {SECTIONS.map((section) => (
          <button
            key={section.id}
            onClick={() => setActiveSection(section.id)}
            className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-sm rounded-sm transition-colors text-left ${
              activeSection === section.id
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            <section.icon className="size-4 shrink-0" />
            {section.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {activeSection === 'overview' && <AdminOverview />}
        {activeSection === 'users' && <AdminUsers />}
        {activeSection === 'tiers' && <AdminTiers />}
        {activeSection === 'threads' && <AdminThreads />}
        {activeSection === 'agents' && <AdminAgents />}
        {activeSection === 'skills' && <AdminSkills />}
        {activeSection === 'cronjobs' && <AdminCronjobs />}
        {activeSection === 'webhooks' && <AdminWebhooks />}
        {activeSection === 'connections' && <AdminConnections />}
        {activeSection === 'whatsapp' && <AdminWhatsApp />}
        {activeSection === 'runs' && <AdminRuns />}
        {activeSection === 'sql' && <AdminSQL />}
        {activeSection === 'system-prompt' && <AdminSystemPrompt />}
        {activeSection === 'openrouter' && <AdminOpenRouter />}
      </div>
    </div>
  )
}
