import { useState, useMemo } from 'react'
import { Plus, MessageSquare, Trash2, Pencil, Loader2, Settings, Phone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAppStore } from '@/lib/store'
import { useThreadStream } from '@/lib/thread-context'
import { cn, formatRelativeTime, truncate } from '@/lib/utils'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger
} from '@/components/ui/context-menu'
import { AgentIconComponent } from '@/lib/agent-icons'
import type { Thread, Agent } from '@/types'

// Thread source filter type
type ThreadFilter = 'all' | 'chat' | 'whatsapp'

// Thread loading indicator that subscribes to the stream context
function ThreadLoadingIcon({ threadId, isWhatsApp }: { threadId: string; isWhatsApp?: boolean }): React.JSX.Element {
  const { isLoading } = useThreadStream(threadId)

  if (isLoading) {
    return <Loader2 className="size-4 shrink-0 text-status-info animate-spin" />
  }

  if (isWhatsApp) {
    return <Phone className="size-4 shrink-0 text-emerald-500" />
  }

  return <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
}

// Agent icon indicator with color
function AgentIndicator({ agent }: { agent?: Agent }): React.JSX.Element | null {
  if (!agent) return null
  return (
    <div
      className="shrink-0"
      style={{ color: agent.color }}
      title={agent.name}
    >
      <AgentIconComponent icon={agent.icon} size={14} />
    </div>
  )
}

// Individual thread list item component
function ThreadListItem({
  thread,
  agent,
  agents,
  isSelected,
  isEditing,
  editingTitle,
  onSelect,
  onDelete,
  onStartEditing,
  onSaveTitle,
  onCancelEditing,
  onEditingTitleChange,
  onReassignToAgent
}: {
  thread: Thread
  agent?: Agent
  agents: Agent[]
  isSelected: boolean
  isEditing: boolean
  editingTitle: string
  onSelect: () => void
  onDelete: () => void
  onStartEditing: () => void
  onSaveTitle: () => void
  onCancelEditing: () => void
  onEditingTitleChange: (value: string) => void
  onReassignToAgent: (agentId: string) => void
}): React.JSX.Element {
  const isWhatsApp = thread.source === 'whatsapp'
  const { isLoading } = useThreadStream(thread.thread_id)

  // Show attention indicator when:
  // - Thread is NOT selected AND
  // - Thread needs_attention is true OR thread is currently loading (tool running)
  const showAttentionIndicator = !isSelected && (thread.needs_attention || isLoading)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            'group flex items-center gap-2 rounded-sm px-3 py-2 cursor-pointer transition-colors overflow-hidden',
            isSelected
              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
              : 'hover:bg-sidebar-accent/50',
            showAttentionIndicator && 'border-l-2 border-l-emerald-500'
          )}
          onClick={() => {
            if (!isEditing) {
              onSelect()
            }
          }}
        >
          <AgentIndicator agent={agent} />
          <ThreadLoadingIcon threadId={thread.thread_id} isWhatsApp={isWhatsApp} />
          <div className="flex-1 min-w-0 overflow-hidden">
            {isEditing ? (
              <input
                type="text"
                value={editingTitle}
                onChange={(e) => onEditingTitleChange(e.target.value)}
                onBlur={onSaveTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSaveTitle()
                  if (e.key === 'Escape') onCancelEditing()
                }}
                className="w-full bg-background border border-border rounded px-1 py-0.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <div className="text-sm truncate block">
                  {thread.title || truncate(thread.thread_id, 20)}
                </div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {formatRelativeTime(thread.updated_at)}
                </div>
              </>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="opacity-0 group-hover:opacity-100 shrink-0"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onStartEditing}>
          <Pencil className="size-4 mr-2" />
          Rename
        </ContextMenuItem>
        {agents.length > 1 && (
          <>
            <ContextMenuSeparator />
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <div
                  className="size-3 rounded-full mr-2"
                  style={{ backgroundColor: agent?.color || '#888' }}
                />
                Assign to Agent
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {agents.map((a) => (
                  <ContextMenuItem
                    key={a.agent_id}
                    onClick={() => onReassignToAgent(a.agent_id)}
                    disabled={a.agent_id === thread.agent_id}
                  >
                    <div
                      className="size-3 rounded-full mr-2"
                      style={{ backgroundColor: a.color }}
                    />
                    {a.name}
                    {a.agent_id === thread.agent_id && ' (current)'}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onClick={onDelete}
        >
          <Trash2 className="size-4 mr-2" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function ThreadSidebar(): React.JSX.Element {
  const {
    threads,
    currentThreadId,
    createThread,
    selectThread,
    deleteThread,
    updateThread,
    openSettings,
    agents,
    reassignThreadToAgent
  } = useAppStore()

  // Create agent lookup map for quick access
  const agentMap = useMemo(() => {
    const map = new Map<string, typeof agents[0]>()
    for (const agent of agents) {
      map.set(agent.agent_id, agent)
    }
    return map
  }, [agents])

  const [editingThreadId, setEditingThreadId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [filter, setFilter] = useState<ThreadFilter>('all')

  // Filter threads based on selected filter
  const filteredThreads = useMemo(() => {
    if (filter === 'all') return threads
    if (filter === 'whatsapp') return threads.filter(t => t.source === 'whatsapp')
    // 'chat' filter - show threads that are not from WhatsApp
    return threads.filter(t => t.source !== 'whatsapp')
  }, [threads, filter])

  // Count threads by source for filter badges
  const whatsappCount = useMemo(() => threads.filter(t => t.source === 'whatsapp').length, [threads])
  const chatCount = useMemo(() => threads.filter(t => t.source !== 'whatsapp').length, [threads])

  const startEditing = (threadId: string, currentTitle: string): void => {
    setEditingThreadId(threadId)
    setEditingTitle(currentTitle || '')
  }

  const saveTitle = async (): Promise<void> => {
    if (editingThreadId && editingTitle.trim()) {
      await updateThread(editingThreadId, { title: editingTitle.trim() })
    }
    setEditingThreadId(null)
    setEditingTitle('')
  }

  const cancelEditing = (): void => {
    setEditingThreadId(null)
    setEditingTitle('')
  }

  const handleNewThread = async (): Promise<void> => {
    await createThread({ title: `Thread ${new Date().toLocaleDateString()}` })
  }

  return (
    <>
      <aside className="flex h-full w-full flex-col border-r border-border bg-sidebar overflow-hidden">
        {/* New Thread Button - with dynamic safe area padding when zoomed out */}
        <div className="p-2" style={{ paddingTop: 'calc(8px + var(--sidebar-safe-padding, 0px))' }}>
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2" onClick={handleNewThread}>
            <Plus className="size-4" />
            New Thread
          </Button>
        </div>

        {/* Filter Buttons */}
        {(whatsappCount > 0 || filter !== 'all') && (
          <div className="px-2 pb-2 flex gap-1">
            <Button
              variant={filter === 'all' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setFilter('all')}
            >
              All
              <span className="ml-1 text-muted-foreground">{threads.length}</span>
            </Button>
            <Button
              variant={filter === 'chat' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setFilter('chat')}
            >
              <MessageSquare className="size-3 mr-1" />
              Chats
              {chatCount > 0 && <span className="ml-1 text-muted-foreground">{chatCount}</span>}
            </Button>
            <Button
              variant={filter === 'whatsapp' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setFilter('whatsapp')}
            >
              <Phone className="size-3 mr-1 text-emerald-500" />
              WhatsApp
              {whatsappCount > 0 && <span className="ml-1 text-muted-foreground">{whatsappCount}</span>}
            </Button>
          </div>
        )}

        {/* Thread List */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-2 space-y-1 overflow-hidden">
            {filteredThreads.map((thread) => (
              <ThreadListItem
                key={thread.thread_id}
                thread={thread}
                agent={thread.agent_id ? agentMap.get(thread.agent_id) : undefined}
                agents={agents}
                isSelected={currentThreadId === thread.thread_id}
                isEditing={editingThreadId === thread.thread_id}
                editingTitle={editingTitle}
                onSelect={() => selectThread(thread.thread_id)}
                onDelete={() => deleteThread(thread.thread_id)}
                onStartEditing={() => startEditing(thread.thread_id, thread.title || '')}
                onSaveTitle={saveTitle}
                onCancelEditing={cancelEditing}
                onEditingTitleChange={setEditingTitle}
                onReassignToAgent={(agentId) => reassignThreadToAgent(thread.thread_id, agentId)}
              />
            ))}

            {filteredThreads.length === 0 && (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                {filter === 'all' && 'No threads yet'}
                {filter === 'chat' && 'No chat threads'}
                {filter === 'whatsapp' && 'No WhatsApp threads'}
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Settings Button */}
        <div className="p-2 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={() => openSettings()} // undefined = edit active agent
          >
            <Settings className="size-4" />
            Settings
          </Button>
        </div>
      </aside>
    </>
  )
}
