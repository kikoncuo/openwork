import { useState, useMemo, useEffect } from 'react'
import { Plus, MessageSquare, Trash2, Pencil, Loader2, Settings, Phone, Clock, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
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
import { windowApi } from '@/api'
import type { Thread, Agent, ThreadSource } from '@/types'

// Thread source filter type - matches ThreadSource plus 'all'
type ThreadFilter = 'all' | ThreadSource

/**
 * Thread icon indicator based on source type.
 * Shows loading spinner when thread is active, otherwise shows source-specific icon.
 */
function ThreadLoadingIcon({ threadId, source }: { threadId: string; source?: string }): React.JSX.Element {
  const { isLoading } = useThreadStream(threadId)

  if (isLoading) {
    return <Loader2 className="size-4 shrink-0 text-status-info animate-spin" />
  }

  // Source-specific icons
  if (source === 'whatsapp') {
    return <Phone className="size-4 shrink-0 text-emerald-500" />
  }
  if (source === 'cronjob') {
    return <Clock className="size-4 shrink-0 text-blue-500" />
  }

  // Default: chat icon
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
          <ThreadLoadingIcon threadId={thread.thread_id} source={thread.source} />
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
    openGlobalSettings,
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

  // Filter state - persisted to localStorage
  const [filter, setFilter] = useState<ThreadFilter>(() => {
    const saved = localStorage.getItem('threadFilter') as ThreadFilter | null
    return saved || 'all'
  })

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Thread[] | null>(null)
  const [searchMeta, setSearchMeta] = useState<{
    totalThreads: number
    limitApplied: boolean
    searchLimit: number
  } | null>(null)
  const [isSearching, setIsSearching] = useState(false)

  // Debounce search input (300ms delay)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Persist filter to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('threadFilter', filter)
  }, [filter])

  // Server-side search effect
  useEffect(() => {
    // Clear results if search is empty
    if (!debouncedSearch.trim()) {
      setSearchResults(null)
      setSearchMeta(null)
      return
    }

    // Perform search
    setIsSearching(true)
    windowApi.threads.search(debouncedSearch, filter !== 'all' ? filter : undefined)
      .then(result => {
        setSearchResults(result.threads)
        setSearchMeta({
          totalThreads: result.totalThreads,
          limitApplied: result.limitApplied,
          searchLimit: result.searchLimit
        })
      })
      .catch(error => {
        console.error('[ThreadSidebar] Search error:', error)
        setSearchResults(null)
        setSearchMeta(null)
      })
      .finally(() => setIsSearching(false))
  }, [debouncedSearch, filter])

  // Count threads by source for filter dropdown
  const sourceCounts = useMemo(() => ({
    chat: threads.filter(t => !t.source || t.source === 'chat').length,
    whatsapp: threads.filter(t => t.source === 'whatsapp').length,
    cronjob: threads.filter(t => t.source === 'cronjob').length,
  }), [threads])

  // Filtered threads - use search results if searching, otherwise filter client-side by source
  const filteredThreads = useMemo(() => {
    // If we have search results from server, use those
    if (searchResults !== null) {
      return searchResults
    }

    // Otherwise, filter client-side by source only
    let result = threads

    if (filter === 'whatsapp') {
      result = result.filter(t => t.source === 'whatsapp')
    } else if (filter === 'cronjob') {
      result = result.filter(t => t.source === 'cronjob')
    } else if (filter === 'chat') {
      result = result.filter(t => !t.source || t.source === 'chat')
    }

    return result
  }, [threads, filter, searchResults])

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

  const handleFilterChange = (newFilter: string): void => {
    setFilter(newFilter as ThreadFilter)
    // Clear search when changing filter
    if (searchQuery) {
      setSearchQuery('')
      setSearchResults(null)
      setSearchMeta(null)
    }
  }

  // Check if we should show filter/search controls
  const hasMultipleSources = sourceCounts.whatsapp > 0 || sourceCounts.cronjob > 0

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

        {/* Search Input */}
        <div className="px-2 pb-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search threads..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-8 h-8 text-sm"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('')
                  setSearchResults(null)
                  setSearchMeta(null)
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 hover:text-foreground"
              >
                <X className="size-4 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>

        {/* Filter Dropdown - only show if there are multiple sources */}
        {hasMultipleSources && (
          <div className="px-2 pb-2">
            <select
              value={filter}
              onChange={(e) => handleFilterChange(e.target.value)}
              className="w-full h-8 px-2 text-xs bg-background border border-border rounded-sm cursor-pointer focus:ring-1 focus:ring-ring focus:outline-none"
            >
              <option value="all">All Threads ({threads.length})</option>
              <option value="chat">
                Chats ({sourceCounts.chat})
              </option>
              {sourceCounts.whatsapp > 0 && (
                <option value="whatsapp">
                  WhatsApp ({sourceCounts.whatsapp})
                </option>
              )}
              {sourceCounts.cronjob > 0 && (
                <option value="cronjob">
                  Scheduled ({sourceCounts.cronjob})
                </option>
              )}
            </select>
          </div>
        )}

        {/* Search Limit Warning */}
        {searchMeta?.limitApplied && (
          <div className="mx-2 mb-2 p-2 text-xs bg-yellow-500/10 border border-yellow-500/30 rounded text-yellow-600 dark:text-yellow-400">
            <span className="font-medium">Note:</span> Only searching your {searchMeta.searchLimit} most recent threads
            ({searchMeta.totalThreads} total). Consider deleting old threads for better search coverage.
          </div>
        )}

        {/* Searching Indicator */}
        {isSearching && (
          <div className="flex items-center justify-center py-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin mr-1" /> Searching...
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

            {filteredThreads.length === 0 && !isSearching && (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                {searchQuery
                  ? 'No threads match your search'
                  : filter === 'all'
                    ? 'No threads yet'
                    : filter === 'chat'
                      ? 'No chat threads'
                      : filter === 'whatsapp'
                        ? 'No WhatsApp threads'
                        : filter === 'cronjob'
                          ? 'No scheduled threads'
                          : 'No threads'}
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Global Settings Button */}
        <div className="p-2 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={() => openGlobalSettings()}
          >
            <Settings className="size-4" />
            Settings
          </Button>
        </div>
      </aside>
    </>
  )
}
