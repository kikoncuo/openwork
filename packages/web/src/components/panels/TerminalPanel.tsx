import { useState, useRef, useEffect, useCallback } from 'react'
import { Plus, X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/lib/store'
import { useThreadState } from '@/lib/thread-context'
import { getClientSandbox } from '@/services/client-sandbox'
import type { TerminalEntry } from '@/types'

export function TerminalPanel(): React.JSX.Element {
  const { currentThreadId, activeAgentId } = useAppStore()
  const threadState = useThreadState(currentThreadId)
  const terminals = threadState?.terminals ?? []
  const activeTerminalId = threadState?.activeTerminalId ?? null
  const createTerminal = threadState?.createTerminal
  const closeTerminal = threadState?.closeTerminal
  const setActiveTerminal = threadState?.setActiveTerminal

  // Auto-create first terminal if none exist
  useEffect(() => {
    if (terminals.length === 0 && createTerminal) {
      createTerminal()
    }
  }, [terminals.length, createTerminal])

  const activeTerminal = terminals.find((t) => t.id === activeTerminalId) ?? null

  return (
    <div className="flex flex-col h-full">
      {/* Terminal tab bar */}
      <TerminalTabBar
        terminals={terminals}
        activeTerminalId={activeTerminalId}
        onSelect={(id) => setActiveTerminal?.(id)}
        onCreate={() => createTerminal?.()}
        onClose={(id) => closeTerminal?.(id)}
      />

      {/* Active terminal view */}
      {activeTerminal ? (
        <TerminalView
          terminal={activeTerminal}
          agentId={activeAgentId}
          threadId={currentThreadId}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
          No terminal open
        </div>
      )}
    </div>
  )
}

function TerminalTabBar({
  terminals,
  activeTerminalId,
  onSelect,
  onCreate,
  onClose
}: {
  terminals: Array<{ id: string; name: string; isRunning: boolean }>
  activeTerminalId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onClose: (id: string) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-0.5 px-1 py-1 border-b border-border/50 bg-background/30 overflow-x-auto">
      {terminals.map((t) => (
        <button
          key={t.id}
          onClick={() => onSelect(t.id)}
          className={cn(
            'flex items-center gap-1 px-2 py-0.5 rounded text-[10px] shrink-0 transition-colors',
            t.id === activeTerminalId
              ? 'bg-background-elevated text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-background-interactive'
          )}
        >
          {t.isRunning && <Loader2 className="size-2.5 animate-spin" />}
          <span>{t.name}</span>
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation()
              onClose(t.id)
            }}
            className="ml-0.5 p-0.5 rounded hover:bg-background-interactive"
          >
            <X className="size-2.5" />
          </span>
        </button>
      ))}
      <button
        onClick={onCreate}
        className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-background-interactive transition-colors shrink-0"
        title="New terminal"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  )
}

function TerminalView({
  terminal,
  agentId,
  threadId
}: {
  terminal: { id: string; cwd: string; history: TerminalEntry[]; isRunning: boolean }
  agentId: string | null
  threadId: string | null
}): React.JSX.Element {
  const threadState = useThreadState(threadId)
  const appendTerminalEntry = threadState?.appendTerminalEntry
  const updateTerminalEntry = threadState?.updateTerminalEntry
  const setTerminalRunning = threadState?.setTerminalRunning

  const [inputValue, setInputValue] = useState('')
  const [historyIndex, setHistoryIndex] = useState(-1)
  const outputRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Sandbox config
  const [sandboxBackendType, setSandboxBackendType] = useState<'buddy' | 'local'>('buddy')
  const [localSandboxConfig, setLocalSandboxConfig] = useState<{ host: string; port: number }>({
    host: 'localhost',
    port: 8080
  })

  useEffect(() => {
    async function loadConfig(): Promise<void> {
      try {
        const config = await window.api.sandbox.getConfig()
        setSandboxBackendType(config.type)
        setLocalSandboxConfig({ host: config.localHost, port: config.localPort })
      } catch (e) {
        console.error('[TerminalView] Error loading sandbox config:', e)
      }
    }
    loadConfig()
  }, [])

  // Auto-scroll to bottom when history changes
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [terminal.history])

  // Focus input on mount and when terminal becomes active
  useEffect(() => {
    inputRef.current?.focus()
  }, [terminal.id])

  // Get user commands for history navigation
  const userCommands = terminal.history
    .filter((e) => e.source === 'user')
    .map((e) => e.command)

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && inputValue.trim() && !terminal.isRunning) {
        e.preventDefault()
        executeCommand(inputValue.trim())
        setInputValue('')
        setHistoryIndex(-1)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (userCommands.length > 0) {
          const newIndex = historyIndex < userCommands.length - 1 ? historyIndex + 1 : historyIndex
          setHistoryIndex(newIndex)
          setInputValue(userCommands[userCommands.length - 1 - newIndex] || '')
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (historyIndex > 0) {
          const newIndex = historyIndex - 1
          setHistoryIndex(newIndex)
          setInputValue(userCommands[userCommands.length - 1 - newIndex] || '')
        } else {
          setHistoryIndex(-1)
          setInputValue('')
        }
      }
    },
    [inputValue, terminal.isRunning, userCommands, historyIndex]
  )

  const executeCommand = useCallback(
    async (command: string) => {
      if (!appendTerminalEntry || !updateTerminalEntry || !setTerminalRunning) return

      const entryId = crypto.randomUUID()
      const entry: TerminalEntry = {
        id: entryId,
        command,
        output: '',
        exitCode: null,
        timestamp: new Date(),
        isStreaming: true,
        source: 'user'
      }

      appendTerminalEntry(terminal.id, entry)
      setTerminalRunning(terminal.id, true)

      try {
        if (sandboxBackendType === 'local') {
          // Local Docker: use ClientSandbox with streaming
          const workspace = agentId ? `/home/user/${agentId}` : '/home/user'
          const sandbox = getClientSandbox(localSandboxConfig.host, localSandboxConfig.port)
          let accumulatedOutput = ''

          const result = await sandbox.execute(
            command,
            terminal.cwd,
            120000,
            (_type, data) => {
              // Accumulate and stream output to terminal entry
              accumulatedOutput += data
              updateTerminalEntry(terminal.id, entryId, {
                output: accumulatedOutput
              })
            },
            workspace
          )

          updateTerminalEntry(terminal.id, entryId, {
            output: result.output === '<no output>' ? '' : result.output,
            exitCode: result.exitCode,
            isStreaming: false
          })
        } else {
          // E2B mode: use server endpoint
          if (!agentId) {
            updateTerminalEntry(terminal.id, entryId, {
              output: 'Error: No agent selected. Select an agent first.',
              exitCode: 1,
              isStreaming: false
            })
            return
          }

          const result = await window.api.workspace.executeTerminal(agentId, command, terminal.cwd)

          if (result.success) {
            const output = [result.stdout, result.stderr].filter(Boolean).join('\n')
            updateTerminalEntry(terminal.id, entryId, {
              output: output || '',
              exitCode: result.exitCode,
              isStreaming: false
            })
          } else {
            updateTerminalEntry(terminal.id, entryId, {
              output: result.error || 'Execution failed',
              exitCode: 1,
              isStreaming: false
            })
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        updateTerminalEntry(terminal.id, entryId, {
          output: `Error: ${message}`,
          exitCode: 1,
          isStreaming: false
        })
      } finally {
        setTerminalRunning(terminal.id, false)
      }
    },
    [
      terminal.id,
      terminal.cwd,
      terminal.history,
      agentId,
      sandboxBackendType,
      localSandboxConfig,
      appendTerminalEntry,
      updateTerminalEntry,
      setTerminalRunning
    ]
  )

  // Watch for agent execute tool calls
  const messages = threadState?.messages ?? []
  const processedToolCalls = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!appendTerminalEntry || !updateTerminalEntry) return

    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          if (
            ['execute', 'bash', 'run_command'].includes(tc.name) &&
            !processedToolCalls.current.has(tc.id)
          ) {
            processedToolCalls.current.add(tc.id)
            const command = (tc.args as { command?: string }).command || ''
            appendTerminalEntry(terminal.id, {
              id: tc.id,
              command,
              output: '',
              exitCode: null,
              timestamp: new Date(),
              isStreaming: true,
              source: 'agent'
            })
          }
        }
      }

      if (
        msg.role === 'tool' &&
        msg.tool_call_id &&
        processedToolCalls.current.has(msg.tool_call_id)
      ) {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
        updateTerminalEntry(terminal.id, msg.tool_call_id, {
          output: content,
          isStreaming: false,
          exitCode: 0
        })
      }
    }
  }, [messages, terminal.id, appendTerminalEntry, updateTerminalEntry])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Output area */}
      <div
        ref={outputRef}
        className="flex-1 overflow-auto p-2 font-mono text-xs leading-relaxed bg-background/50"
        onClick={() => inputRef.current?.focus()}
      >
        {terminal.history.length === 0 ? (
          <div className="text-muted-foreground/50 select-none">
            Terminal ready. Type a command and press Enter.
          </div>
        ) : (
          terminal.history.map((entry) => (
            <TerminalEntryView key={entry.id} entry={entry} />
          ))
        )}
      </div>

      {/* Command input */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-t border-border/50 bg-background/30 font-mono text-xs shrink-0">
        <span className="text-green-400 select-none">$</span>
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={terminal.isRunning}
          placeholder={terminal.isRunning ? 'Running...' : 'Enter command'}
          className="flex-1 bg-transparent outline-none text-foreground placeholder:text-muted-foreground/40 disabled:opacity-50"
          autoComplete="off"
          spellCheck={false}
        />
        {terminal.isRunning && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
      </div>
    </div>
  )
}

function TerminalEntryView({ entry }: { entry: TerminalEntry }): React.JSX.Element {
  return (
    <div className="mb-2">
      {/* Command line */}
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            'select-none',
            entry.source === 'agent' ? 'text-blue-400' : 'text-green-400'
          )}
        >
          $
        </span>
        <span className="text-foreground">{entry.command}</span>
        {entry.source === 'agent' && (
          <span className="text-[9px] px-1 py-0 rounded bg-blue-500/20 text-blue-400 font-medium select-none">
            Agent
          </span>
        )}
      </div>

      {/* Output */}
      {entry.output && (
        <pre className="text-muted-foreground whitespace-pre-wrap break-all mt-0.5 ml-4">
          {entry.output}
        </pre>
      )}

      {/* Streaming indicator */}
      {entry.isStreaming && !entry.output && (
        <div className="flex items-center gap-1 text-muted-foreground/50 mt-0.5 ml-4">
          <Loader2 className="size-2.5 animate-spin" />
          <span>Running...</span>
        </div>
      )}

      {/* Exit code badge for non-zero */}
      {!entry.isStreaming && entry.exitCode !== null && entry.exitCode !== 0 && (
        <span className="text-[9px] text-red-400 ml-4 mt-0.5 inline-block">
          exit {entry.exitCode}
        </span>
      )}
    </div>
  )
}
