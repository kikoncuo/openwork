import { User, Bot, CheckCircle2, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Message, HITLRequest } from '@/types'
import { ToolCallRenderer } from './ToolCallRenderer'
import { StreamingMarkdown } from './StreamingMarkdown'

interface ToolResultInfo {
  content: string | unknown
  is_error?: boolean
}

interface MessageBubbleProps {
  message: Message
  isStreaming?: boolean
  toolResults?: Map<string, ToolResultInfo>
  pendingApproval?: HITLRequest | null
  toolDecisions?: Map<string, 'approve' | 'reject'>
  onApprovalDecision?: (decision: 'approve' | 'reject' | 'edit') => void
  onToolDecision?: (toolCallId: string, decision: 'approve' | 'reject') => void
  onApproveAll?: () => void
  onRejectAll?: () => void
  onSubmitAllDecisions?: () => void
}

export function MessageBubble({
  message,
  isStreaming,
  toolResults,
  pendingApproval,
  toolDecisions,
  onApprovalDecision,
  onToolDecision,
  onApproveAll,
  onRejectAll,
  onSubmitAllDecisions
}: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isTool = message.role === 'tool'

  // Hide tool result messages - they're shown inline with tool calls
  if (isTool) {
    return null
  }

  const getIcon = () => {
    if (isUser) return <User className="size-4" />
    return <Bot className="size-4" />
  }

  const getLabel = () => {
    if (isUser) return 'YOU'
    return 'AGENT'
  }

  const renderContent = () => {
    if (typeof message.content === 'string') {
      // Empty content
      if (!message.content.trim()) {
        return null
      }

      // Use streaming markdown for assistant messages, plain text for user messages
      if (isUser) {
        return (
          <div className="whitespace-pre-wrap text-sm">
            {message.content}
          </div>
        )
      }
      return (
        <StreamingMarkdown isStreaming={isStreaming}>
          {message.content}
        </StreamingMarkdown>
      )
    }

    // Handle content blocks
    const renderedBlocks = message.content.map((block, index) => {
      if (block.type === 'text' && block.text) {
        // Use streaming markdown for assistant text blocks
        if (isUser) {
          return (
            <div key={index} className="whitespace-pre-wrap text-sm">
              {block.text}
            </div>
          )
        }
        return (
          <StreamingMarkdown key={index} isStreaming={isStreaming}>
            {block.text}
          </StreamingMarkdown>
        )
      }
      return null
    }).filter(Boolean)

    return renderedBlocks.length > 0 ? renderedBlocks : null
  }

  const content = renderContent()
  const hasToolCalls = message.tool_calls && message.tool_calls.length > 0

  // Don't render if there's no content and no tool calls
  if (!content && !hasToolCalls) {
    return null
  }

  return (
    <div className="flex gap-3 overflow-hidden">
      {/* Left avatar column - shows for agent/tool */}
      <div className="w-8 shrink-0">
        {!isUser && (
          <div className="flex size-8 items-center justify-center rounded-sm bg-status-info/10 text-status-info">
            {getIcon()}
          </div>
        )}
      </div>

      {/* Content column - always same width */}
      <div className="flex-1 min-w-0 space-y-2 overflow-hidden">
        <div className={cn(
          "text-section-header",
          isUser && "text-right"
        )}>
          {getLabel()}
        </div>

        {content && (
          <div className={cn(
            "rounded-sm p-3 overflow-hidden",
            isUser ? "bg-primary/10" : "bg-card"
          )}>
            {content}
          </div>
        )}

        {/* Tool calls */}
        {hasToolCalls && (() => {
          // Check if we have multiple pending tool calls (batch mode)
          const pendingToolCalls = pendingApproval?.tool_calls || (pendingApproval?.tool_call ? [pendingApproval.tool_call] : [])
          const pendingIds = new Set(pendingToolCalls.map(tc => tc.id))
          const pendingNames = new Set(pendingToolCalls.map(tc => tc.name))
          const isBatchMode = pendingToolCalls.length > 1

          // Find which tool calls in this message need approval
          const toolCallsNeedingApproval = message.tool_calls!.filter(tc => {
            const result = toolResults?.get(tc.id)
            if (pendingIds.has(tc.id)) return true
            // Fallback: match by name if no result
            if (pendingNames.has(tc.name) && !result) return true
            return false
          })

          const showBatchFooter = isBatchMode && toolCallsNeedingApproval.length > 0

          // Calculate batch stats
          const decidedCount = toolCallsNeedingApproval.filter(tc => toolDecisions?.has(tc.id)).length
          const totalCount = toolCallsNeedingApproval.length
          const allDecided = decidedCount === totalCount

          return (
            <div className="space-y-2 overflow-hidden">
              {message.tool_calls!.map((toolCall, index) => {
                const result = toolResults?.get(toolCall.id)

                // Check if this tool call needs approval
                let needsApproval = false
                if (pendingApproval) {
                  if (pendingIds.has(toolCall.id)) {
                    needsApproval = true
                  } else if (pendingNames.has(toolCall.name) && !result) {
                    needsApproval = true
                  }
                }

                const currentDecision = toolDecisions?.get(toolCall.id)

                return (
                  <ToolCallRenderer
                    key={`${toolCall.id || `tc-${index}`}-${needsApproval ? 'pending' : 'done'}`}
                    toolCall={toolCall}
                    result={result?.content}
                    isError={result?.is_error}
                    needsApproval={needsApproval}
                    isBatchMode={isBatchMode && needsApproval}
                    currentDecision={currentDecision}
                    onApprovalDecision={needsApproval && !isBatchMode ? onApprovalDecision : undefined}
                    onDecisionChange={needsApproval && isBatchMode && onToolDecision ? (decision) => onToolDecision(toolCall.id, decision) : undefined}
                  />
                )
              })}

              {/* Batch approval footer */}
              {showBatchFooter && (
                <div className="border border-amber-500/30 bg-amber-500/5 rounded-sm p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      {allDecided ? (
                        <CheckCircle2 className="size-4 text-status-nominal" />
                      ) : (
                        <span className="text-xs font-mono">{decidedCount}/{totalCount}</span>
                      )}
                      <span>{allDecided ? 'All tools decided' : 'Select decisions for all tools'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={onRejectAll}
                        className="px-2 py-1 text-xs border border-border rounded-sm hover:bg-background-interactive transition-colors flex items-center gap-1"
                      >
                        <XCircle className="size-3" />
                        Reject All
                      </button>
                      <button
                        onClick={onApproveAll}
                        className="px-2 py-1 text-xs border border-border rounded-sm hover:bg-background-interactive transition-colors flex items-center gap-1"
                      >
                        <CheckCircle2 className="size-3" />
                        Approve All
                      </button>
                      <button
                        onClick={onSubmitAllDecisions}
                        disabled={!allDecided}
                        className={cn(
                          "px-3 py-1 text-xs rounded-sm transition-colors",
                          allDecided
                            ? "bg-status-nominal text-background hover:bg-status-nominal/90"
                            : "bg-muted text-muted-foreground cursor-not-allowed"
                        )}
                      >
                        Submit Decisions
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })()}
      </div>

      {/* Right avatar column - shows for user */}
      <div className="w-8 shrink-0">
        {isUser && (
          <div className="flex size-8 items-center justify-center rounded-sm bg-primary/10 text-primary">
            {getIcon()}
          </div>
        )}
      </div>
    </div>
  )
}
