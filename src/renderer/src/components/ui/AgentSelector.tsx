import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/lib/store'
import { AgentIconComponent } from '@/lib/agent-icons'
import type { Agent } from '@/types'

interface AgentSelectorProps {
  className?: string
}

// Individual agent pill/badge
function AgentPill({ agent, isActive, onClick }: {
  agent: Agent
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-sm font-medium transition-all shrink-0",
        isActive
          ? "ring-2 ring-offset-1 ring-offset-background"
          : "opacity-70 hover:opacity-100"
      )}
      style={{
        backgroundColor: isActive ? agent.color : `${agent.color}40`,
        color: isActive ? '#fff' : agent.color,
        // Use agent color for the ring when active
        ...(isActive ? { '--tw-ring-color': agent.color } as React.CSSProperties : {})
      }}
      title={agent.name}
    >
      <AgentIconComponent icon={agent.icon} className="size-3.5" />
      <span>{agent.name}</span>
    </button>
  )
}

export function AgentSelector({ className }: AgentSelectorProps) {
  const { agents, activeAgentId, setActiveAgent, openSettings } = useAppStore()

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {agents.map((agent) => (
        <AgentPill
          key={agent.agent_id}
          agent={agent}
          isActive={activeAgentId === agent.agent_id}
          onClick={() => setActiveAgent(agent.agent_id)}
        />
      ))}

      {/* Add new agent button - opens settings in create mode */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          openSettings(null) // null = create new agent
        }}
        className="flex items-center justify-center size-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors shrink-0"
        title="Create new agent"
      >
        <Plus className="size-4" />
      </button>
    </div>
  )
}
