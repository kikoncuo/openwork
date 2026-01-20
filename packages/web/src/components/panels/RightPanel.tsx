import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import {
  ListTodo,
  FolderTree,
  GitBranch,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  Circle,
  Clock,
  XCircle,
  GripHorizontal,
  Download,
  FolderSync,
  Loader2,
  Check,
  Folder,
  FolderOpen,
  File,
  FileText,
  FileCode,
  FileJson,
  Image,
  FileType,
  RefreshCw,
  Upload,
  AlertTriangle,
  HardDrive,
  RotateCcw
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/lib/store'
import { useThreadState } from '@/lib/thread-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { WorkspaceBrowser } from '@/components/workspace/WorkspaceBrowser'
import type { Todo } from '@/types'

const HEADER_HEIGHT = 40 // px
const HANDLE_HEIGHT = 6 // px
const MIN_CONTENT_HEIGHT = 60 // px
const COLLAPSE_THRESHOLD = 55 // px - auto-collapse when below this

interface SectionHeaderProps {
  title: string
  icon: React.ElementType
  badge?: number
  isOpen: boolean
  onToggle: () => void
}

function SectionHeader({
  title,
  icon: Icon,
  badge,
  isOpen,
  onToggle
}: SectionHeaderProps): React.JSX.Element {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-2 px-3 py-2.5 text-section-header hover:bg-background-interactive transition-colors shrink-0 w-full"
      style={{ height: HEADER_HEIGHT }}
    >
      <ChevronRight
        className={cn(
          'size-3.5 text-muted-foreground transition-transform duration-200',
          isOpen && 'rotate-90'
        )}
      />
      <Icon className="size-4" />
      <span className="flex-1 text-left">{title}</span>
      {badge !== undefined && badge > 0 && (
        <span className="text-[10px] text-muted-foreground tabular-nums">{badge}</span>
      )}
    </button>
  )
}

interface ResizeHandleProps {
  onDrag: (delta: number) => void
}

function ResizeHandle({ onDrag }: ResizeHandleProps): React.JSX.Element {
  const startYRef = useRef<number>(0)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      startYRef.current = e.clientY

      const handleMouseMove = (e: MouseEvent): void => {
        // Calculate total delta from drag start
        const totalDelta = e.clientY - startYRef.current
        onDrag(totalDelta)
      }

      const handleMouseUp = (): void => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'row-resize'
      document.body.style.userSelect = 'none'
    },
    [onDrag]
  )

  return (
    <div
      onMouseDown={handleMouseDown}
      className="group bg-border/50 hover:bg-primary/30 active:bg-primary/50 transition-colors cursor-row-resize flex items-center justify-center shrink-0 select-none"
      style={{ height: HANDLE_HEIGHT }}
    >
      <GripHorizontal className="size-4 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
    </div>
  )
}

export function RightPanel(): React.JSX.Element {
  const { currentThreadId } = useAppStore()
  const threadState = useThreadState(currentThreadId)
  const todos = threadState?.todos ?? []
  const workspaceFiles = threadState?.workspaceFiles ?? []
  const subagents = threadState?.subagents ?? []
  const containerRef = useRef<HTMLDivElement>(null)

  const [tasksOpen, setTasksOpen] = useState(true)
  const [filesOpen, setFilesOpen] = useState(true)
  const [agentsOpen, setAgentsOpen] = useState(true)

  // Store content heights in pixels (null = auto/equal distribution)
  const [tasksHeight, setTasksHeight] = useState<number | null>(null)
  const [filesHeight, setFilesHeight] = useState<number | null>(null)
  const [agentsHeight, setAgentsHeight] = useState<number | null>(null)

  // Track drag start heights
  const dragStartHeights = useRef<{ tasks: number; files: number; agents: number } | null>(null)

  // Calculate available content height
  const getAvailableContentHeight = useCallback(() => {
    if (!containerRef.current) return 0
    const totalHeight = containerRef.current.clientHeight

    // Subtract headers (always visible)
    let used = HEADER_HEIGHT * 3

    // Subtract handles (only between open panels)
    if (tasksOpen && (filesOpen || agentsOpen)) used += HANDLE_HEIGHT
    if (filesOpen && agentsOpen) used += HANDLE_HEIGHT

    return Math.max(0, totalHeight - used)
  }, [tasksOpen, filesOpen, agentsOpen])

  // Get current heights for each panel's content area
  const getContentHeights = useCallback(() => {
    const available = getAvailableContentHeight()
    const openCount = [tasksOpen, filesOpen, agentsOpen].filter(Boolean).length

    if (openCount === 0) {
      return { tasks: 0, files: 0, agents: 0 }
    }

    const defaultHeight = available / openCount

    return {
      tasks: tasksOpen ? (tasksHeight ?? defaultHeight) : 0,
      files: filesOpen ? (filesHeight ?? defaultHeight) : 0,
      agents: agentsOpen ? (agentsHeight ?? defaultHeight) : 0
    }
  }, [
    getAvailableContentHeight,
    tasksOpen,
    filesOpen,
    agentsOpen,
    tasksHeight,
    filesHeight,
    agentsHeight
  ])

  // Handle resize between tasks and the next open section
  const handleTasksResize = useCallback(
    (totalDelta: number) => {
      if (!dragStartHeights.current) {
        const heights = getContentHeights()
        dragStartHeights.current = { ...heights }
      }

      const start = dragStartHeights.current
      const available = getAvailableContentHeight()

      // Determine which panel is being resized against
      const otherStart = filesOpen ? start.files : start.agents

      // Calculate new heights with proper clamping
      let newTasksHeight = start.tasks + totalDelta
      let newOtherHeight = otherStart - totalDelta

      // Clamp both to min height
      if (newTasksHeight < MIN_CONTENT_HEIGHT) {
        newTasksHeight = MIN_CONTENT_HEIGHT
        newOtherHeight = otherStart + (start.tasks - MIN_CONTENT_HEIGHT)
      }
      if (newOtherHeight < MIN_CONTENT_HEIGHT) {
        newOtherHeight = MIN_CONTENT_HEIGHT
        newTasksHeight = start.tasks + (otherStart - MIN_CONTENT_HEIGHT)
      }

      // Ensure total doesn't exceed available (accounting for third panel if open)
      const thirdPanelHeight = filesOpen && agentsOpen ? (agentsHeight ?? available / 3) : 0
      const maxForTwo = available - thirdPanelHeight
      if (newTasksHeight + newOtherHeight > maxForTwo) {
        const excess = newTasksHeight + newOtherHeight - maxForTwo
        if (totalDelta > 0) {
          newOtherHeight = Math.max(MIN_CONTENT_HEIGHT, newOtherHeight - excess)
        } else {
          newTasksHeight = Math.max(MIN_CONTENT_HEIGHT, newTasksHeight - excess)
        }
      }

      setTasksHeight(newTasksHeight)
      if (filesOpen) {
        setFilesHeight(newOtherHeight)
      } else if (agentsOpen) {
        setAgentsHeight(newOtherHeight)
      }

      // Auto-collapse if below threshold
      if (newTasksHeight < COLLAPSE_THRESHOLD) {
        setTasksOpen(false)
      }
      if (newOtherHeight < COLLAPSE_THRESHOLD) {
        if (filesOpen) setFilesOpen(false)
        else if (agentsOpen) setAgentsOpen(false)
      }
    },
    [getContentHeights, getAvailableContentHeight, filesOpen, agentsOpen, agentsHeight]
  )

  // Handle resize between files and agents
  const handleFilesResize = useCallback(
    (totalDelta: number) => {
      if (!dragStartHeights.current) {
        const heights = getContentHeights()
        dragStartHeights.current = { ...heights }
      }

      const start = dragStartHeights.current
      const available = getAvailableContentHeight()
      const tasksH = tasksOpen ? (tasksHeight ?? available / 3) : 0
      const maxForFilesAndAgents = available - tasksH

      // Calculate new heights with proper clamping
      let newFilesHeight = start.files + totalDelta
      let newAgentsHeight = start.agents - totalDelta

      // Clamp both to min height
      if (newFilesHeight < MIN_CONTENT_HEIGHT) {
        newFilesHeight = MIN_CONTENT_HEIGHT
        newAgentsHeight = start.agents + (start.files - MIN_CONTENT_HEIGHT)
      }
      if (newAgentsHeight < MIN_CONTENT_HEIGHT) {
        newAgentsHeight = MIN_CONTENT_HEIGHT
        newFilesHeight = start.files + (start.agents - MIN_CONTENT_HEIGHT)
      }

      // Ensure total doesn't exceed available
      if (newFilesHeight + newAgentsHeight > maxForFilesAndAgents) {
        const excess = newFilesHeight + newAgentsHeight - maxForFilesAndAgents
        if (totalDelta > 0) {
          newAgentsHeight = Math.max(MIN_CONTENT_HEIGHT, newAgentsHeight - excess)
        } else {
          newFilesHeight = Math.max(MIN_CONTENT_HEIGHT, newFilesHeight - excess)
        }
      }

      setFilesHeight(newFilesHeight)
      setAgentsHeight(newAgentsHeight)

      // Auto-collapse if below threshold
      if (newFilesHeight < COLLAPSE_THRESHOLD) {
        setFilesOpen(false)
      }
      if (newAgentsHeight < COLLAPSE_THRESHOLD) {
        setAgentsOpen(false)
      }
    },
    [getContentHeights, getAvailableContentHeight, tasksOpen, tasksHeight]
  )

  // Reset drag start on mouse up
  useEffect(() => {
    const handleMouseUp = (): void => {
      dragStartHeights.current = null
    }
    document.addEventListener('mouseup', handleMouseUp)
    return () => document.removeEventListener('mouseup', handleMouseUp)
  }, [])

  // Reset heights when panels open/close to redistribute
  useEffect(() => {
    setTasksHeight(null)
    setFilesHeight(null)
    setAgentsHeight(null)
  }, [tasksOpen, filesOpen, agentsOpen])

  // Calculate heights in an effect (refs can't be accessed during render)
  const [heights, setHeights] = useState({ tasks: 0, files: 0, agents: 0 })
  useEffect(() => {
    setHeights(getContentHeights())
  }, [getContentHeights])

  return (
    <aside
      ref={containerRef}
      className="flex h-full w-full flex-col border-l border-border bg-sidebar overflow-hidden"
    >
      {/* TASKS */}
      <div className="flex flex-col shrink-0 border-b border-border">
        <SectionHeader
          title="TASKS"
          icon={ListTodo}
          badge={todos.length}
          isOpen={tasksOpen}
          onToggle={() => setTasksOpen((prev) => !prev)}
        />
        {tasksOpen && (
          <div className="overflow-auto" style={{ height: heights.tasks }}>
            <TasksContent />
          </div>
        )}
      </div>

      {/* Resize handle after TASKS */}
      {tasksOpen && (filesOpen || agentsOpen) && <ResizeHandle onDrag={handleTasksResize} />}

      {/* FILES */}
      <div className="flex flex-col shrink-0 border-b border-border">
        <SectionHeader
          title="FILES"
          icon={FolderTree}
          badge={workspaceFiles.length}
          isOpen={filesOpen}
          onToggle={() => setFilesOpen((prev) => !prev)}
        />
        {filesOpen && (
          <div className="overflow-auto" style={{ height: heights.files }}>
            <FilesContent />
          </div>
        )}
      </div>

      {/* Resize handle after FILES */}
      {filesOpen && agentsOpen && <ResizeHandle onDrag={handleFilesResize} />}

      {/* AGENTS */}
      <div className="flex flex-col shrink-0">
        <SectionHeader
          title="AGENTS"
          icon={GitBranch}
          badge={subagents.length}
          isOpen={agentsOpen}
          onToggle={() => setAgentsOpen((prev) => !prev)}
        />
        {agentsOpen && (
          <div className="overflow-auto" style={{ height: heights.agents }}>
            <AgentsContent />
          </div>
        )}
      </div>
    </aside>
  )
}

// ============ Content Components ============

const STATUS_CONFIG = {
  pending: {
    icon: Circle,
    badge: 'outline' as const,
    label: 'PENDING',
    color: 'text-muted-foreground'
  },
  in_progress: {
    icon: Clock,
    badge: 'info' as const,
    label: 'IN PROGRESS',
    color: 'text-status-info'
  },
  completed: {
    icon: CheckCircle2,
    badge: 'nominal' as const,
    label: 'DONE',
    color: 'text-status-nominal'
  },
  cancelled: {
    icon: XCircle,
    badge: 'critical' as const,
    label: 'CANCELLED',
    color: 'text-muted-foreground'
  }
}

function TasksContent(): React.JSX.Element {
  const { currentThreadId } = useAppStore()
  const threadState = useThreadState(currentThreadId)
  const todos = threadState?.todos ?? []
  const [completedExpanded, setCompletedExpanded] = useState(false)

  if (todos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center text-sm text-muted-foreground py-8 px-4">
        <ListTodo className="size-8 mb-2 opacity-50" />
        <span>No tasks yet</span>
        <span className="text-xs mt-1">Tasks appear when the agent creates them</span>
      </div>
    )
  }

  const inProgress = todos.filter((t) => t.status === 'in_progress')
  const pending = todos.filter((t) => t.status === 'pending')
  const completed = todos.filter((t) => t.status === 'completed')
  const cancelled = todos.filter((t) => t.status === 'cancelled')

  // Completed section includes both completed and cancelled
  const doneItems = [...completed, ...cancelled]

  const done = completed.length
  const total = todos.length
  const progress = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <div>
      {/* Progress bar */}
      <div className="p-3 border-b border-border/50">
        <div className="flex items-center justify-between mb-1.5 text-xs">
          <span className="text-muted-foreground">PROGRESS</span>
          <span className="font-mono">
            {done}/{total}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-background overflow-hidden">
          <div
            className="h-full bg-status-nominal transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Todo list */}
      <div className="p-3 space-y-2">
        {/* Completed/Cancelled Section (Collapsible) */}
        {doneItems.length > 0 && (
          <div className="mb-1">
            <button
              onClick={() => setCompletedExpanded(!completedExpanded)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2 w-full"
            >
              {completedExpanded ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
              <span className="uppercase tracking-wider font-medium">
                Completed ({doneItems.length})
              </span>
            </button>
            {completedExpanded && (
              <div className="space-y-2 pl-5 mb-3">
                {doneItems.map((todo) => (
                  <TaskItem key={todo.id} todo={todo} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* In Progress Section */}
        {inProgress.map((todo) => (
          <TaskItem key={todo.id} todo={todo} />
        ))}

        {/* Pending Section */}
        {pending.map((todo) => (
          <TaskItem key={todo.id} todo={todo} />
        ))}
      </div>
    </div>
  )
}

function TaskItem({ todo }: { todo: Todo }): React.JSX.Element {
  const config = STATUS_CONFIG[todo.status]
  const Icon = config.icon
  const isDone = todo.status === 'completed' || todo.status === 'cancelled'

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-sm border border-border p-3',
        isDone && 'opacity-50'
      )}
    >
      <Icon className={cn('size-4 shrink-0 mt-0.5', config.color)} />
      <span className={cn('flex-1 text-sm', isDone && 'line-through')}>{todo.content}</span>
      <Badge variant={config.badge} className="shrink-0 text-[10px]">
        {config.label}
      </Badge>
    </div>
  )
}

function FilesContent(): React.JSX.Element {
  const { currentThreadId, threads } = useAppStore()
  const threadState = useThreadState(currentThreadId)
  const workspaceFiles = threadState?.workspaceFiles ?? []
  const workspacePath = threadState?.workspacePath ?? null
  const setWorkspacePath = threadState?.setWorkspacePath
  const setWorkspaceFiles = threadState?.setWorkspaceFiles
  const [syncing, setSyncing] = useState(false)
  const [syncSuccess, setSyncSuccess] = useState(false)
  const [sandboxEnabled, setSandboxEnabled] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)

  // Get current thread's agent_id - used to track when agent changes
  const currentThread = threads.find(t => t.thread_id === currentThreadId)
  const agentId = currentThread?.agent_id

  // Backup status state
  const [backupStatus, setBackupStatus] = useState<{
    schedulerActive: boolean
    backup: { fileCount: number; totalSize: number; updatedAt: number } | null
  } | null>(null)
  const [sandboxError, setSandboxError] = useState(false)
  const [restoring, setRestoring] = useState(false)

  // Check sandbox status on mount and when agent changes
  useEffect(() => {
    async function checkSandboxStatus(): Promise<void> {
      // Guard: only check sandbox status if agentId is defined to prevent race conditions
      // when a new thread is created but the threads array hasn't updated yet
      if (currentThreadId && agentId) {
        try {
          const status = await window.api.workspace.sandboxStatus(currentThreadId)
          setSandboxEnabled(status.enabled)
          setSandboxError(false)
        } catch (e) {
          console.error('[FilesContent] Error checking sandbox status:', e)
          setSandboxEnabled(false)
          // Check if this looks like a sandbox error
          const errorMsg = e instanceof Error ? e.message : String(e)
          if (errorMsg.toLowerCase().includes('sandbox') || errorMsg.toLowerCase().includes('paused')) {
            setSandboxError(true)
          }
        }
      }
    }
    checkSandboxStatus()
  }, [currentThreadId, agentId])  // Added agentId dependency

  // Fetch backup status periodically when sandbox is enabled
  // Also refetch when agent changes since backups are per-agent
  useEffect(() => {
    // Guard: only fetch backup status if agentId is defined
    if (!currentThreadId || !sandboxEnabled || !agentId) {
      setBackupStatus(null)
      return
    }

    async function fetchBackupStatus(): Promise<void> {
      try {
        const result = await window.api.workspace.sandboxBackupStatus(currentThreadId!)
        if (result.success) {
          setBackupStatus({
            schedulerActive: result.schedulerActive,
            backup: result.backup
          })
        }
      } catch (e) {
        console.error('[FilesContent] Error fetching backup status:', e)
      }
    }

    // Fetch immediately
    fetchBackupStatus()

    // Poll every 30 seconds
    const interval = setInterval(fetchBackupStatus, 30000)
    return () => clearInterval(interval)
  }, [currentThreadId, sandboxEnabled, agentId])  // Added agentId dependency

  // Handle manual backup
  async function handleManualBackup(): Promise<void> {
    if (!currentThreadId) return
    try {
      const result = await window.api.workspace.sandboxBackup(currentThreadId)
      if (result.success && result.backup) {
        setBackupStatus(prev => prev ? { ...prev, backup: result.backup! } : null)
      }
    } catch (e) {
      console.error('[FilesContent] Manual backup error:', e)
    }
  }

  // Handle restore from backup
  async function handleRestore(): Promise<void> {
    if (!currentThreadId) return
    setRestoring(true)
    try {
      const result = await window.api.workspace.sandboxRestore(currentThreadId)
      if (result.success) {
        console.log(`[FilesContent] Restored ${result.filesRestored} files to new sandbox ${result.sandboxId}`)
        setSandboxError(false)
        // Reload sandbox files
        const filesResult = await window.api.workspace.sandboxFiles(currentThreadId)
        if (filesResult.success && filesResult.files && setWorkspaceFiles) {
          setWorkspaceFiles(filesResult.files.map(f => ({
            path: f.path,
            is_dir: f.is_dir
          })))
        }
      } else {
        console.error('[FilesContent] Restore failed:', result.error)
      }
    } catch (e) {
      console.error('[FilesContent] Restore error:', e)
    } finally {
      setRestoring(false)
    }
  }

  // Load workspace path and files for current thread
  // Also reload when agent changes (since each agent has its own sandbox)
  useEffect(() => {
    async function loadWorkspace(): Promise<void> {
      if (currentThreadId && setWorkspacePath && setWorkspaceFiles) {
        const path = await window.api.workspace.get(currentThreadId)
        setWorkspacePath(path)

        // If sandbox is enabled, load from sandbox. Otherwise, load from local disk.
        // Note: API still uses threadId - backend resolves to agentId
        // Guard: only load sandbox files if agentId is defined to prevent race conditions
        // when a new thread is created but the threads array hasn't updated yet
        if (sandboxEnabled && agentId) {
          try {
            const result = await window.api.workspace.sandboxFiles(currentThreadId)
            if (result.success && result.files) {
              setWorkspaceFiles(result.files.map(f => ({
                path: f.path,
                is_dir: f.is_dir
              })))
            }
          } catch (e) {
            console.error('[FilesContent] Error loading sandbox files:', e)
          }
        } else if (path) {
          // Load files from local disk
          const result = await window.api.workspace.loadFromDisk(currentThreadId)
          if (result.success && result.files) {
            setWorkspaceFiles(result.files)
          }
        }
      }
    }
    loadWorkspace()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentThreadId, sandboxEnabled, agentId])  // Added agentId dependency

  // Listen for file changes from the workspace watcher
  useEffect(() => {
    if (!currentThreadId || !setWorkspaceFiles) return

    const cleanup = window.api.workspace.onFilesChanged(currentThreadId, async (data: { threadId: string; workspacePath: string }) => {
      // Only reload if the event is for the current thread
      if (data.threadId === currentThreadId) {
        console.log('[FilesContent] Files changed, reloading...', data)
        const result = await window.api.workspace.loadFromDisk(currentThreadId)
        if (result.success && result.files) {
          setWorkspaceFiles(result.files)
        }
      }
    })

    return cleanup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentThreadId])

  // Open the workspace browser dialog
  function handleSelectFolder(): void {
    setBrowserOpen(true)
  }

  // Handle folder selection from WorkspaceBrowser (receives full path)
  async function handleBrowserSelect(selectedPath: string): Promise<void> {
    if (!currentThreadId || !setWorkspacePath || !setWorkspaceFiles) return
    setSyncing(true)
    try {
      setWorkspacePath(selectedPath)

      // If sandbox is enabled, upload the folder to the sandbox
      if (sandboxEnabled) {
        console.log('[FilesContent] Uploading folder to E2B sandbox:', selectedPath)
        const uploadResult = await window.api.workspace.sandboxUploadFolder(currentThreadId, selectedPath)
        if (uploadResult.success) {
          console.log(`[FilesContent] Uploaded ${uploadResult.filesUploaded} files to sandbox`)
          // Reload sandbox files
          const filesResult = await window.api.workspace.sandboxFiles(currentThreadId)
          if (filesResult.success && filesResult.files) {
            setWorkspaceFiles(filesResult.files.map(f => ({
              path: f.path,
              is_dir: f.is_dir
            })))
          }
          setSyncSuccess(true)
          setTimeout(() => setSyncSuccess(false), 2000)
        } else {
          console.error('[FilesContent] Upload to sandbox failed:', uploadResult.error)
        }
      } else {
        // Set workspace path on server
        await window.api.workspace.set(currentThreadId, selectedPath)
        // Load files from the newly selected local folder
        const result = await window.api.workspace.loadFromDisk(currentThreadId)
        if (result.success && result.files) {
          setWorkspaceFiles(result.files)
        }
      }
    } catch (e) {
      console.error('[FilesContent] Select folder error:', e)
    } finally {
      setSyncing(false)
    }
  }

  // Handle sync to disk - downloads files from E2B sandbox to local folder
  async function handleSyncToDisk(): Promise<void> {
    if (!currentThreadId) return

    // If no files, just select a folder
    if (workspaceFiles.length === 0) {
      await handleSelectFolder()
      return
    }

    // Only works with sandbox enabled
    if (!sandboxEnabled) {
      console.warn('[FilesContent] Sync to disk only works with E2B sandbox enabled')
      return
    }

    setSyncing(true)
    try {
      const result = await window.api.workspace.sandboxSyncToLocal(currentThreadId)
      if (result.success) {
        console.log(`[FilesContent] Synced ${result.filesDownloaded} files to local folder`)
        setSyncSuccess(true)
        // Reset success indicator after 2 seconds
        setTimeout(() => setSyncSuccess(false), 2000)
      } else {
        console.error('[FilesContent] Sync to local failed:', result.error)
      }
    } catch (e) {
      console.error('[FilesContent] Sync to disk error:', e)
    } finally {
      setSyncing(false)
    }
  }

  // Handle refresh - reload file list
  const [refreshing, setRefreshing] = useState(false)
  async function handleRefresh(): Promise<void> {
    if (!currentThreadId || !setWorkspaceFiles) return
    setRefreshing(true)
    try {
      if (sandboxEnabled) {
        const result = await window.api.workspace.sandboxFiles(currentThreadId)
        if (result.success && result.files) {
          setWorkspaceFiles(result.files.map(f => ({
            path: f.path,
            is_dir: f.is_dir
          })))
        }
      } else if (workspacePath) {
        const result = await window.api.workspace.loadFromDisk(currentThreadId)
        if (result.success && result.files) {
          setWorkspaceFiles(result.files)
        }
      }
    } catch (e) {
      console.error('[FilesContent] Refresh error:', e)
    } finally {
      setRefreshing(false)
    }
  }

  // Format relative time for backup
  function formatRelativeTime(timestamp: number): string {
    const now = Date.now()
    const diff = now - timestamp
    const minutes = Math.floor(diff / 60000)
    if (minutes < 1) return 'just now'
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.floor(hours / 24)}d ago`
  }

  return (
    <>
      <div className="flex flex-col h-full">
        {/* Recovery banner when sandbox is disconnected but backup exists */}
        {sandboxError && backupStatus?.backup && (
          <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border-b border-amber-500/30 text-amber-400">
            <AlertTriangle className="size-4 shrink-0" />
            <span className="text-xs flex-1">
              Sandbox disconnected. {backupStatus.backup.fileCount} files backed up.
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRestore}
              disabled={restoring}
              className="h-5 px-2 text-[10px] bg-amber-500/20 hover:bg-amber-500/30 text-amber-300"
            >
              {restoring ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <RotateCcw className="size-3" />
              )}
              <span className="ml-1">Recover</span>
            </Button>
          </div>
        )}

        {/* Header with action buttons */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/50 bg-background/30">
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            {sandboxEnabled && (
              <span className="text-[9px] px-1 py-0.5 rounded bg-blue-500/20 text-blue-400 font-medium shrink-0">
                E2B
              </span>
            )}
            <span
              className="text-[10px] text-muted-foreground truncate"
              title={workspacePath || undefined}
            >
              {workspacePath ? workspacePath.split('/').pop() : 'No folder linked'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {/* Refresh button - only show when there are files or sandbox is enabled */}
            {(workspaceFiles.length > 0 || sandboxEnabled) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefresh}
                disabled={refreshing || !currentThreadId}
                className="h-5 px-1.5"
                title="Refresh file list"
              >
                <RefreshCw className={cn("size-3", refreshing && "animate-spin")} />
              </Button>
            )}
            {/* Upload button - always show when sandbox is enabled */}
            {sandboxEnabled && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSelectFolder}
                disabled={syncing || !currentThreadId}
                className="h-5 px-1.5 text-[10px]"
                title="Upload a local folder to E2B sandbox"
              >
                <Upload className="size-3" />
                <span className="ml-1">Upload</span>
              </Button>
            )}
            {/* Download/Sync button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={sandboxEnabled ? handleSyncToDisk : (workspaceFiles.length > 0 ? handleSyncToDisk : handleSelectFolder)}
              disabled={syncing || !currentThreadId || (sandboxEnabled && workspaceFiles.length === 0)}
              className="h-5 px-1.5 text-[10px]"
              title={
                sandboxEnabled
                  ? `Download files from E2B sandbox to ${workspacePath || 'local folder'}`
                  : workspaceFiles.length > 0
                    ? 'Sync files to disk'
                    : workspacePath
                      ? 'Change folder'
                      : 'Link sync folder'
              }
            >
              {syncing ? (
                <Loader2 className="size-3 animate-spin" />
              ) : syncSuccess ? (
                <Check className="size-3 text-status-nominal" />
              ) : sandboxEnabled ? (
                <Download className="size-3" />
              ) : workspaceFiles.length > 0 ? (
                <Download className="size-3" />
              ) : (
                <FolderSync className="size-3" />
              )}
              <span className="ml-1">
                {sandboxEnabled
                  ? 'Download'
                  : workspaceFiles.length > 0
                    ? 'Sync'
                    : workspacePath
                      ? 'Change'
                      : 'Link'}
              </span>
            </Button>
          </div>
        </div>

        {/* Backup status indicator (only when sandbox is enabled and has backup) */}
        {sandboxEnabled && backupStatus?.backup && !sandboxError && (
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/30 bg-background/20 text-[10px]">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <HardDrive className="size-3" />
              <span>
                Backed up: {backupStatus.backup.fileCount} files ({formatSize(backupStatus.backup.totalSize)})
              </span>
              <span className="text-muted-foreground/70">
                · {formatRelativeTime(backupStatus.backup.updatedAt)}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleManualBackup}
              className="h-4 px-1.5 text-[9px] text-muted-foreground hover:text-foreground"
              title="Backup now"
            >
              <HardDrive className="size-2.5" />
              <span className="ml-1">Backup</span>
            </Button>
          </div>
        )}

        {/* File tree or empty state */}
        {workspaceFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center text-sm text-muted-foreground py-8 px-4 flex-1">
            <FolderTree className="size-8 mb-2 opacity-50" />
            <span>No workspace files</span>
            <span className="text-xs mt-1">
              {sandboxEnabled
                ? 'Click "Upload" to upload a local folder to the E2B sandbox'
                : workspacePath
                  ? `Linked to ${workspacePath.split('/').pop()}`
                  : 'Click "Link" to set a sync folder'}
            </span>
          </div>
        ) : (
          <div className="py-1 overflow-auto flex-1">
            <FileTree files={workspaceFiles} />
          </div>
        )}
      </div>

      {/* Workspace browser dialog */}
      <WorkspaceBrowser
        open={browserOpen}
        onOpenChange={setBrowserOpen}
        onSelect={handleBrowserSelect}
        initialPath={workspacePath || undefined}
      />
    </>
  )
}

// ============ File Tree Components ============

interface FileInfo {
  path: string
  is_dir?: boolean
  size?: number
  modified_at?: string
}

interface TreeNode {
  name: string
  path: string
  is_dir: boolean
  size?: number
  children: TreeNode[]
}

function buildFileTree(files: FileInfo[]): TreeNode[] {
  const root: TreeNode[] = []
  const nodeMap = new Map<string, TreeNode>()

  // Sort files so directories come first, then alphabetically
  const sortedFiles = [...files].sort((a, b) => {
    const aIsDir = a.is_dir ?? false
    const bIsDir = b.is_dir ?? false
    if (aIsDir && !bIsDir) return -1
    if (!aIsDir && bIsDir) return 1
    return a.path.localeCompare(b.path)
  })

  for (const file of sortedFiles) {
    // Normalize path - remove leading slash
    const normalizedPath = file.path.startsWith('/') ? file.path.slice(1) : file.path
    const parts = normalizedPath.split('/')
    const fileName = parts[parts.length - 1]

    const node: TreeNode = {
      name: fileName,
      path: file.path,
      is_dir: file.is_dir ?? false,
      size: file.size,
      children: []
    }

    if (parts.length === 1) {
      // Root level item
      root.push(node)
      nodeMap.set(normalizedPath, node)
    } else {
      // Nested item - find or create parent directories
      let currentPath = ''
      let parentChildren = root

      for (let i = 0; i < parts.length - 1; i++) {
        currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i]

        let parentNode = nodeMap.get(currentPath)
        if (!parentNode) {
          // Create implicit directory node
          parentNode = {
            name: parts[i],
            path: '/' + currentPath,
            is_dir: true,
            children: []
          }
          parentChildren.push(parentNode)
          nodeMap.set(currentPath, parentNode)
        }
        parentChildren = parentNode.children
      }

      // Add node to parent
      parentChildren.push(node)
      nodeMap.set(normalizedPath, node)
    }
  }

  // Sort children of each node (dirs first, then alphabetically)
  function sortChildren(nodes: TreeNode[]): void {
    nodes.sort((a, b) => {
      if (a.is_dir && !b.is_dir) return -1
      if (!a.is_dir && b.is_dir) return 1
      return a.name.localeCompare(b.name)
    })
    nodes.forEach((n) => sortChildren(n.children))
  }
  sortChildren(root)

  return root
}

function FileTree({ files }: { files: FileInfo[] }): React.JSX.Element {
  const tree = useMemo(() => buildFileTree(files), [files])
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Start with all directories expanded
    const dirs = new Set<string>()
    files.forEach((f) => {
      if (f.is_dir ?? false) dirs.add(f.path)
    })
    return dirs
  })

  const toggleExpand = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  return (
    <div className="select-none">
      {tree.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          depth={0}
          expanded={expanded}
          onToggle={toggleExpand}
        />
      ))}
    </div>
  )
}

function FileTreeNode({
  node,
  depth,
  expanded,
  onToggle
}: {
  node: TreeNode
  depth: number
  expanded: Set<string>
  onToggle: (path: string) => void
}): React.JSX.Element {
  const { currentThreadId } = useAppStore()
  const threadState = useThreadState(currentThreadId)
  const openFile = threadState?.openFile
  const isExpanded = expanded.has(node.path)
  const hasChildren = node.children.length > 0
  const paddingLeft = 8 + depth * 16

  const handleClick = (): void => {
    if (node.is_dir) {
      onToggle(node.path)
    } else if (openFile) {
      // Open file in a new tab
      openFile(node.path, node.name)
    }
  }

  return (
    <>
      <div
        onClick={handleClick}
        className={cn(
          'flex items-center gap-1.5 py-1 pr-3 text-xs hover:bg-background-interactive cursor-pointer'
        )}
        style={{ paddingLeft }}
      >
        {/* Expand/collapse chevron for directories */}
        {node.is_dir ? (
          <span className="w-3.5 flex items-center justify-center shrink-0">
            {hasChildren &&
              (isExpanded ? (
                <ChevronDown className="size-3 text-muted-foreground" />
              ) : (
                <ChevronRight className="size-3 text-muted-foreground" />
              ))}
          </span>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}

        {/* Icon */}
        <FileIcon name={node.name} isDir={node.is_dir} isOpen={isExpanded} />

        {/* Name */}
        <span className="truncate flex-1">{node.name}</span>

        {/* Size for files */}
        {!node.is_dir && node.size !== undefined && (
          <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
            {formatSize(node.size)}
          </span>
        )}
      </div>

      {/* Children */}
      {node.is_dir &&
        isExpanded &&
        node.children.map((child) => (
          <FileTreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
          />
        ))}
    </>
  )
}

function FileIcon({
  name,
  isDir,
  isOpen
}: {
  name: string
  isDir: boolean
  isOpen?: boolean
}): React.JSX.Element {
  if (isDir) {
    return isOpen ? (
      <FolderOpen className="size-3.5 text-amber-500 shrink-0" />
    ) : (
      <Folder className="size-3.5 text-amber-500 shrink-0" />
    )
  }

  // Get file extension
  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() : ''

  // Map extensions to icons and colors
  switch (ext) {
    case 'ts':
    case 'tsx':
      return <FileCode className="size-3.5 text-blue-400 shrink-0" />
    case 'js':
    case 'jsx':
      return <FileCode className="size-3.5 text-yellow-400 shrink-0" />
    case 'json':
      return <FileJson className="size-3.5 text-yellow-600 shrink-0" />
    case 'md':
    case 'mdx':
      return <FileText className="size-3.5 text-muted-foreground shrink-0" />
    case 'py':
      return <FileCode className="size-3.5 text-green-400 shrink-0" />
    case 'css':
    case 'scss':
    case 'sass':
      return <FileCode className="size-3.5 text-pink-400 shrink-0" />
    case 'html':
      return <FileCode className="size-3.5 text-orange-400 shrink-0" />
    case 'svg':
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
      return <Image className="size-3.5 text-purple-400 shrink-0" />
    case 'yml':
    case 'yaml':
      return <FileType className="size-3.5 text-red-400 shrink-0" />
    default:
      return <File className="size-3.5 text-muted-foreground shrink-0" />
  }
}

function AgentsContent(): React.JSX.Element {
  const { currentThreadId } = useAppStore()
  const threadState = useThreadState(currentThreadId)
  const subagents = threadState?.subagents ?? []

  if (subagents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center text-sm text-muted-foreground py-8 px-4">
        <GitBranch className="size-8 mb-2 opacity-50" />
        <span>No subagent tasks</span>
        <span className="text-xs mt-1">Subagents appear when spawned</span>
      </div>
    )
  }

  return (
    <div className="p-3 space-y-2">
      {subagents.map((agent) => (
        <div key={agent.id} className="p-3 rounded-sm border border-border">
          <div className="flex items-center gap-2 text-sm font-medium">
            <GitBranch className="size-3.5 text-status-info" />
            <span className="flex-1">{agent.name}</span>
            <span
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded',
                agent.status === 'pending' && 'bg-muted text-muted-foreground',
                agent.status === 'running' && 'bg-status-info/20 text-status-info',
                agent.status === 'completed' && 'bg-status-nominal/20 text-status-nominal',
                agent.status === 'failed' && 'bg-status-critical/20 text-status-critical'
              )}
            >
              {agent.status.toUpperCase()}
            </span>
          </div>
          {agent.description && (
            <p className="text-xs text-muted-foreground mt-1">{agent.description}</p>
          )}
        </div>
      ))}
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
