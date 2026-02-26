import { useEffect, useState, useMemo, useCallback } from 'react'
import { Loader2, AlertCircle, FileCode } from 'lucide-react'
import { useCurrentThread } from '@/lib/thread-context'
import { useAppStore } from '@/lib/store'
import { getFileType, isBinaryFile, getPrettyRendererType } from '@/lib/file-types'
import { CodeViewer } from './CodeViewer'
import { ImageViewer } from './ImageViewer'
import { MediaViewer } from './MediaViewer'
import { PDFViewer } from './PDFViewer'
import { BinaryFileViewer } from './BinaryFileViewer'
import { MarkdownViewer } from './MarkdownViewer'
import { CsvViewer } from './CsvViewer'
import { HtmlPreviewViewer } from './HtmlPreviewViewer'

interface FileViewerProps {
  filePath: string
  threadId: string
}

export function FileViewer({ filePath, threadId }: FileViewerProps) {
  const { fileContents, setFileContents } = useCurrentThread(threadId)
  const { activeAgentId } = useAppStore()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [binaryContent, setBinaryContent] = useState<string | null>(null)
  const [sandboxEnabled, setSandboxEnabled] = useState(false)
  const [sandboxConfig, setSandboxConfig] = useState<{ type: 'buddy' | 'local'; localHost: string; localPort: number } | null>(null)

  // Load sandbox config on mount
  useEffect(() => {
    async function loadSandboxConfig() {
      try {
        const config = await window.api.sandbox.getConfig()
        setSandboxConfig(config)
      } catch (e) {
        console.error('[FileViewer] Error loading sandbox config:', e)
      }
    }
    loadSandboxConfig()
  }, [])

  // Check sandbox status on mount
  useEffect(() => {
    async function checkSandboxStatus() {
      try {
        const status = await window.api.workspace.sandboxStatus(threadId)
        setSandboxEnabled(status.enabled)
      } catch (e) {
        console.error('[FileViewer] Error checking sandbox status:', e)
        setSandboxEnabled(false)
      }
    }
    checkSandboxStatus()
  }, [threadId])

  // Get file type info
  const fileName = filePath.split('/').pop() || filePath
  const fileTypeInfo = useMemo(() => getFileType(fileName), [fileName])
  const isBinary = useMemo(() => isBinaryFile(fileName), [fileName])
  const prettyType = useMemo(() => getPrettyRendererType(fileName), [fileName])

  // Get cached content or load it
  const content = fileContents[filePath]

  // Save handler for pretty renderers
  const handleSaveFile = useCallback(async (newContent: string) => {
    if (sandboxConfig?.type === 'local') {
      const workspace = activeAgentId ? `/home/user/${activeAgentId}` : '/home/user'
      const baseUrl = `http://${sandboxConfig.localHost}:${sandboxConfig.localPort}`
      const response = await fetch(`${baseUrl}/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content: newContent, workspace })
      })
      const result = await response.json()
      if (!result.success) throw new Error(result.error || 'Write failed')
    } else if (activeAgentId) {
      await window.api.workspace.backupWriteFile(activeAgentId, filePath, newContent)
    }
    setFileContents(filePath, newContent)
  }, [sandboxConfig, activeAgentId, filePath, setFileContents])

  // Reset state when filePath changes
  useEffect(() => {
    setError(null)
    setBinaryContent(null)
  }, [filePath])

  // Load file content (text or binary depending on file type)
  // Uses backup-first approach for E2B, direct fetch for local Docker
  useEffect(() => {
    async function loadFile() {
      // Skip if already loaded
      if (content !== undefined || binaryContent !== null) {
        return
      }

      // Wait for sandbox config to load
      if (!sandboxConfig) {
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        let loaded = false

        // Binary files: load as base64
        if (isBinary) {
          if (sandboxConfig.type === 'local') {
            try {
              const workspace = activeAgentId ? `/home/user/${activeAgentId}` : '/home/user'
              const baseUrl = `http://${sandboxConfig.localHost}:${sandboxConfig.localPort}`
              const response = await fetch(`${baseUrl}/read`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: filePath, workspace, binary: true })
              })
              const result = await response.json()
              if (result.success && result.content) {
                setBinaryContent(result.content)
                loaded = true
              }
            } catch (localErr) {
              console.log('[FileViewer] Local Docker binary read failed:', localErr)
            }
          } else if (activeAgentId) {
            try {
              const backupResult = await window.api.workspace.backupReadFile(activeAgentId, filePath)
              if (backupResult.success && backupResult.content !== undefined) {
                if (backupResult.encoding === 'base64') {
                  setBinaryContent(backupResult.content)
                } else {
                  setBinaryContent(btoa(backupResult.content))
                }
                loaded = true
              }
            } catch (backupErr) {
              console.log('[FileViewer] Backup binary read failed:', backupErr)
            }
          }

          if (!loaded) {
            setError('Binary file could not be loaded')
          }
          return
        }

        // Text files: load as utf-8
        // LOCAL DOCKER MODE: Fetch directly from container
        if (sandboxConfig.type === 'local') {
          try {
            const workspace = activeAgentId ? `/home/user/${activeAgentId}` : '/home/user'
            const baseUrl = `http://${sandboxConfig.localHost}:${sandboxConfig.localPort}`
            const response = await fetch(`${baseUrl}/read`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: filePath, workspace })
            })
            const result = await response.json()
            if (result.success && result.content) {
              // Remove line numbers from content (format is "1\tline content")
              const fileContent = result.content
                .split('\n')
                .map((line: string) => line.replace(/^\d+\t/, ''))
                .join('\n')
              setFileContents(filePath, fileContent)
              loaded = true
            }
          } catch (localErr) {
            console.log('[FileViewer] Local Docker read failed:', localErr)
          }
        } else {
          // E2B/BUDDY MODE: Use backup-first approach
          // Step 1: Try backup first (always available, no sandbox needed)
          if (activeAgentId) {
            try {
              const backupResult = await window.api.workspace.backupReadFile(activeAgentId, filePath)
              if (backupResult.success && backupResult.content !== undefined) {
                setFileContents(filePath, backupResult.content)
                loaded = true
              }
            } catch (backupErr) {
              console.log('[FileViewer] Backup read failed, will try sandbox:', backupErr)
            }
          }

          // Step 2: Fallback to sandbox if backup didn't have the file
          if (!loaded && sandboxEnabled) {
            try {
              const sandboxResult = await window.api.workspace.sandboxReadFile(threadId, filePath)
              if (sandboxResult.success && sandboxResult.content !== undefined) {
                setFileContents(filePath, sandboxResult.content)
                loaded = true
              }
            } catch (sandboxErr) {
              console.log('[FileViewer] Sandbox read failed:', sandboxErr)
            }
          }
        }

        if (!loaded) {
          setError('File not found in backup or sandbox')
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to read file')
      } finally {
        setIsLoading(false)
      }
    }

    loadFile()
  }, [threadId, filePath, content, binaryContent, setFileContents, isBinary, sandboxEnabled, activeAgentId, sandboxConfig])

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin mr-2" />
        <span>Loading file...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground gap-3 p-8">
        <AlertCircle className="size-10 text-status-critical" />
        <div className="text-center">
          <div className="font-medium text-foreground mb-1">Failed to load file</div>
          <div className="text-sm">{error}</div>
        </div>
      </div>
    )
  }

  if (content === undefined && binaryContent === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <FileCode className="size-6 mr-2" />
        <span>No content</span>
      </div>
    )
  }

  // Route to appropriate viewer based on file type
  if (fileTypeInfo.type === 'image' && binaryContent) {
    return (
      <ImageViewer 
        filePath={filePath} 
        base64Content={binaryContent} 
        mimeType={fileTypeInfo.mimeType || 'image/png'}
      />
    )
  }

  if (fileTypeInfo.type === 'video' && binaryContent) {
    return (
      <MediaViewer 
        filePath={filePath} 
        base64Content={binaryContent} 
        mimeType={fileTypeInfo.mimeType || 'video/mp4'}
        mediaType="video"
      />
    )
  }

  if (fileTypeInfo.type === 'audio' && binaryContent) {
    return (
      <MediaViewer 
        filePath={filePath} 
        base64Content={binaryContent} 
        mimeType={fileTypeInfo.mimeType || 'audio/mpeg'}
        mediaType="audio"
      />
    )
  }

  if (fileTypeInfo.type === 'pdf' && binaryContent) {
    return <PDFViewer filePath={filePath} base64Content={binaryContent} />
  }

  if (fileTypeInfo.type === 'binary') {
    return <BinaryFileViewer filePath={filePath} size={undefined} />
  }

  // Pretty renderers for supported file types
  if (content !== undefined && prettyType === 'markdown') {
    return <MarkdownViewer filePath={filePath} content={content} onSave={handleSaveFile} />
  }
  if (content !== undefined && prettyType === 'csv') {
    return <CsvViewer filePath={filePath} content={content} onSave={handleSaveFile} />
  }
  if (content !== undefined && prettyType === 'html') {
    return <HtmlPreviewViewer filePath={filePath} content={content} onSave={handleSaveFile} />
  }

  // Default to code/text viewer
  if (content !== undefined) {
    return <CodeViewer filePath={filePath} content={content} />
  }

  return null
}
