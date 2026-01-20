import { useState, useEffect } from 'react'
import { Folder, Check, ChevronDown, Upload, Cloud, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover'
import { useCurrentThread } from '@/lib/thread-context'
import { cn } from '@/lib/utils'
import { WorkspaceBrowser } from '@/components/workspace/WorkspaceBrowser'

interface WorkspacePickerProps {
  threadId: string
}

export function WorkspacePicker({ threadId }: WorkspacePickerProps): React.JSX.Element {
  const { workspacePath, setWorkspacePath, setWorkspaceFiles } = useCurrentThread(threadId)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sandboxEnabled, setSandboxEnabled] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<string | null>(null)

  // Check sandbox status on mount
  useEffect(() => {
    async function checkSandboxStatus() {
      if (threadId) {
        try {
          const status = await window.api.workspace.sandboxStatus(threadId)
          setSandboxEnabled(status.enabled)
        } catch (e) {
          console.error('[WorkspacePicker] Error checking sandbox status:', e)
          setSandboxEnabled(false)
        }
      }
    }
    checkSandboxStatus()
  }, [threadId])

  // Load workspace path and files for current thread
  useEffect(() => {
    async function loadWorkspace(): Promise<void> {
      if (threadId) {
        const path = await window.api.workspace.get(threadId)
        setWorkspacePath(path)

        // If sandbox is enabled, load from sandbox. Otherwise, load from local disk.
        if (sandboxEnabled) {
          try {
            const result = await window.api.workspace.sandboxFiles(threadId)
            if (result.success && result.files) {
              setWorkspaceFiles(result.files.map(f => ({
                path: f.path,
                is_dir: f.is_dir
              })))
            }
          } catch (e) {
            console.error('[WorkspacePicker] Error loading sandbox files:', e)
          }
        } else if (path) {
          const result = await window.api.workspace.loadFromDisk(threadId)
          if (result.success && result.files) {
            setWorkspaceFiles(result.files)
          }
        }
      }
    }
    loadWorkspace()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, sandboxEnabled])

  async function handleSelectFolder(selectedPath: string): Promise<void> {
    setLoading(true)
    try {
      if (sandboxEnabled) {
        // Upload folder to E2B sandbox
        setUploadProgress('Uploading files...')
        const uploadResult = await window.api.workspace.sandboxUploadFolder(threadId, selectedPath)
        if (uploadResult.success) {
          setUploadProgress(`Uploaded ${uploadResult.filesUploaded} files`)
          setWorkspacePath(selectedPath)
          // Reload sandbox files
          const filesResult = await window.api.workspace.sandboxFiles(threadId)
          if (filesResult.success && filesResult.files) {
            setWorkspaceFiles(filesResult.files.map(f => ({
              path: f.path,
              is_dir: f.is_dir
            })))
          }
          setTimeout(() => setUploadProgress(null), 2000)
        } else {
          setUploadProgress(`Error: ${uploadResult.error}`)
          setTimeout(() => setUploadProgress(null), 3000)
        }
      } else {
        // Set the workspace path (server validates and returns the resolved path)
        const result = await window.api.workspace.set(threadId, selectedPath)
        if (result) {
          setWorkspacePath(result)
          // Load files from disk
          const filesResult = await window.api.workspace.loadFromDisk(threadId)
          if (filesResult.success && filesResult.files) {
            setWorkspaceFiles(filesResult.files)
          }
        }
      }
      setPopoverOpen(false)
    } catch (e) {
      console.error('[WorkspacePicker] Set folder error:', e)
      setUploadProgress(null)
    } finally {
      setLoading(false)
    }
  }

  function openBrowser() {
    setPopoverOpen(false)
    setBrowserOpen(true)
  }

  const folderName = workspacePath?.split('/').pop()

  return (
    <>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'h-7 px-2 text-xs gap-1.5',
              workspacePath ? 'text-foreground' : 'text-amber-500'
            )}
            disabled={!threadId}
          >
            {sandboxEnabled ? (
              <Cloud className="size-3.5" />
            ) : (
              <Folder className="size-3.5" />
            )}
            <span className="max-w-[120px] truncate">
              {sandboxEnabled
                ? (workspacePath ? folderName : 'Upload folder')
                : (workspacePath ? folderName : 'Select workspace')}
            </span>
            <ChevronDown className="size-3 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="start">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {sandboxEnabled ? 'E2B Cloud Sandbox' : 'Workspace Folder'}
              </div>
              {sandboxEnabled && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-blue-500/20 text-blue-400 font-medium">
                  E2B
                </span>
              )}
            </div>

            {uploadProgress && (
              <div className="flex items-center gap-2 p-2 rounded-md bg-background-secondary border border-border text-xs">
                {uploadProgress.startsWith('Error') ? (
                  <span className="text-status-critical">{uploadProgress}</span>
                ) : uploadProgress.startsWith('Uploading') ? (
                  <>
                    <Loader2 className="size-3 animate-spin" />
                    <span>{uploadProgress}</span>
                  </>
                ) : (
                  <>
                    <Check className="size-3 text-status-nominal" />
                    <span className="text-status-nominal">{uploadProgress}</span>
                  </>
                )}
              </div>
            )}

            {workspacePath ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 p-2 rounded-md bg-background-secondary border border-border">
                  <Check className="size-3.5 text-status-nominal shrink-0" />
                  <span className="text-sm truncate flex-1" title={workspacePath}>
                    {folderName}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground font-mono truncate" title={workspacePath}>
                  {workspacePath}
                </p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {sandboxEnabled
                    ? 'Files from this folder have been uploaded to the E2B cloud sandbox. The agent works in the sandbox, not on your local files.'
                    : 'The agent will read and write files in this folder.'}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-8 text-xs"
                  onClick={openBrowser}
                  disabled={loading}
                >
                  {sandboxEnabled ? 'Upload Different Folder' : 'Change Folder'}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {sandboxEnabled
                    ? 'Select a local folder to upload to the E2B cloud sandbox. The agent will work on copies of your files in the cloud.'
                    : 'Select a folder for the agent to work in. The agent will read and write files directly to this location.'}
                </p>
                <Button
                  variant="default"
                  size="sm"
                  className="w-full h-8 text-xs"
                  onClick={openBrowser}
                  disabled={loading}
                >
                  {sandboxEnabled ? (
                    <>
                      <Upload className="size-3.5 mr-1.5" />
                      Upload Folder
                    </>
                  ) : (
                    <>
                      <Folder className="size-3.5 mr-1.5" />
                      Select Folder
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <WorkspaceBrowser
        open={browserOpen}
        onOpenChange={setBrowserOpen}
        onSelect={handleSelectFolder}
        initialPath={workspacePath || undefined}
      />
    </>
  )
}
