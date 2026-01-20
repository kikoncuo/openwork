import {
  Bot,
  Sparkles,
  Code,
  Pen,
  Search,
  Terminal,
  Brain,
  Shield,
  type LucideIcon
} from 'lucide-react'
import type { AgentIcon } from '@/types'

export const AGENT_ICON_MAP: Record<AgentIcon, LucideIcon> = {
  bot: Bot,
  sparkles: Sparkles,
  code: Code,
  pen: Pen,
  search: Search,
  terminal: Terminal,
  brain: Brain,
  shield: Shield,
}

export const AGENT_ICON_LABELS: Record<AgentIcon, string> = {
  bot: 'Robot',
  sparkles: 'Creative',
  code: 'Developer',
  pen: 'Writer',
  search: 'Research',
  terminal: 'DevOps',
  brain: 'Analysis',
  shield: 'Security',
}

interface AgentIconProps {
  icon: AgentIcon
  className?: string
  size?: number
}

export function AgentIconComponent({ icon, className, size = 16 }: AgentIconProps) {
  const IconComponent = AGENT_ICON_MAP[icon] || Bot
  return <IconComponent className={className} size={size} />
}
