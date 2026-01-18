declare const __APP_VERSION__: string

interface AgentBadgeProps {
  className?: string
  style?: React.CSSProperties
}

export function AgentBadge({ className, style }: AgentBadgeProps) {
  return (
    <div className={className} style={style}>
      <div
        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs"
        style={{
          backgroundColor: 'rgba(139, 92, 246, 0.1)',
          border: '1px solid rgba(139, 92, 246, 0.3)',
          color: '#8B5CF6',
        }}
      >
        <span className="font-bold uppercase tracking-wider">BUDDY</span>
        <span className="font-mono opacity-70">{__APP_VERSION__}</span>
      </div>
    </div>
  )
}
