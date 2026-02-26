import { useState, useEffect } from 'react'
import { Loader2, Trash2, Download, FolderOpen, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { useAppStore } from '@/lib/store'

interface Skill {
  skill_id: string
  name: string
  description: string | null
  source_url: string
  folder_path: string
  file_count: number
  user_id: string
  created_at: number
  updated_at: number
}

interface AgentConfig {
  enabled_skills?: string[]
}

export function SkillsTab() {
  const agents = useAppStore((s) => s.agents)
  const activeAgentId = useAppStore((s) => s.activeAgentId)

  const [loading, setLoading] = useState(true)
  const [skills, setSkills] = useState<Skill[]>([])
  const [downloadUrl, setDownloadUrl] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [deletingSkillId, setDeletingSkillId] = useState<string | null>(null)

  // Agent skills activation state
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null)
  const [loadingAgentConfig, setLoadingAgentConfig] = useState(false)
  const [savingSkillToggle, setSavingSkillToggle] = useState<string | null>(null)

  // Load skills on mount
  useEffect(() => {
    loadSkills()
  }, [])

  // Set default selected agent
  useEffect(() => {
    if (!selectedAgentId && agents.length > 0) {
      setSelectedAgentId(activeAgentId || agents[0].agent_id)
    }
  }, [agents, activeAgentId, selectedAgentId])

  // Load agent config when selected agent changes
  useEffect(() => {
    if (selectedAgentId) {
      loadAgentConfig(selectedAgentId)
    }
  }, [selectedAgentId])

  async function loadSkills() {
    setLoading(true)
    try {
      const loadedSkills = await window.api.skills.list()
      setSkills(loadedSkills)
    } catch (error) {
      console.error('[SkillsTab] Failed to load skills:', error)
    } finally {
      setLoading(false)
    }
  }

  async function loadAgentConfig(agentId: string) {
    setLoadingAgentConfig(true)
    try {
      const config = await window.api.agents.getConfig(agentId) as Record<string, unknown> | null
      if (config) {
        // Parse enabled_skills if it's a JSON string
        let enabledSkills: string[] = []
        if (typeof config.enabled_skills === 'string') {
          try {
            enabledSkills = JSON.parse(config.enabled_skills)
          } catch {
            enabledSkills = []
          }
        } else if (Array.isArray(config.enabled_skills)) {
          enabledSkills = config.enabled_skills
        }
        setAgentConfig({ ...config, enabled_skills: enabledSkills })
      } else {
        setAgentConfig(null)
      }
    } catch (error) {
      console.error('[SkillsTab] Failed to load agent config:', error)
      setAgentConfig(null)
    } finally {
      setLoadingAgentConfig(false)
    }
  }

  async function handleDownload() {
    if (!downloadUrl.trim()) return

    setDownloading(true)
    setDownloadError(null)

    try {
      const skill = await window.api.skills.download(downloadUrl.trim())
      setSkills(prev => [skill, ...prev])
      setDownloadUrl('')
    } catch (error) {
      console.error('[SkillsTab] Download error:', error)
      setDownloadError(error instanceof Error ? error.message : 'Failed to download skill')
    } finally {
      setDownloading(false)
    }
  }

  async function handleDelete(skillId: string) {
    setDeletingSkillId(skillId)
    try {
      await window.api.skills.delete(skillId)
      setSkills(prev => prev.filter(s => s.skill_id !== skillId))

      // Remove skill from all agent configs
      if (agentConfig?.enabled_skills?.includes(skillId)) {
        setAgentConfig(prev => ({
          ...prev,
          enabled_skills: prev?.enabled_skills?.filter(id => id !== skillId) || []
        }))
      }
    } catch (error) {
      console.error('[SkillsTab] Delete error:', error)
    } finally {
      setDeletingSkillId(null)
    }
  }

  async function handleToggleSkill(skillId: string) {
    if (!selectedAgentId) return

    setSavingSkillToggle(skillId)
    try {
      const currentEnabled = agentConfig?.enabled_skills || []
      const isEnabled = currentEnabled.includes(skillId)
      const newEnabled = isEnabled
        ? currentEnabled.filter(id => id !== skillId)
        : [...currentEnabled, skillId]

      await window.api.agents.updateConfig(selectedAgentId, {
        enabled_skills: newEnabled
      })

      setAgentConfig(prev => ({
        ...prev,
        enabled_skills: newEnabled
      }))
    } catch (error) {
      console.error('[SkillsTab] Toggle skill error:', error)
    } finally {
      setSavingSkillToggle(null)
    }
  }

  function isSkillEnabled(skillId: string): boolean {
    return agentConfig?.enabled_skills?.includes(skillId) || false
  }

  function formatGitHubUrl(url: string): string {
    try {
      const parsed = new URL(url)
      const parts = parsed.pathname.split('/')
      if (parts.length >= 5) {
        return `${parts[1]}/${parts[2]}/${parts.slice(4).join('/')}`
      }
      return url
    } catch {
      return url
    }
  }

  return (
    <div className="space-y-6 py-4">
      {/* Skills Library Section */}
      <div>
        <div className="text-section-header mb-2">SKILLS LIBRARY</div>
        <p className="text-xs text-muted-foreground mb-4">
          Download skills from GitHub to extend your agent's capabilities.
        </p>
      </div>

      {/* Download Form */}
      <div className="flex gap-2">
        <Input
          value={downloadUrl}
          onChange={(e) => setDownloadUrl(e.target.value)}
          placeholder="https://github.com/owner/repo/tree/branch/path/to/skill"
          className="flex-1"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && downloadUrl.trim() && !downloading) {
              handleDownload()
            }
          }}
        />
        <Button
          onClick={handleDownload}
          disabled={!downloadUrl.trim() || downloading}
        >
          {downloading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <>
              <Download className="size-4 mr-2" />
              Download
            </>
          )}
        </Button>
      </div>

      {downloadError && (
        <p className="text-sm text-status-critical">{downloadError}</p>
      )}

      {/* Skills List */}
      <div className="space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : skills.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            <FolderOpen className="size-8 mx-auto mb-2 opacity-50" />
            <p>No skills installed</p>
            <p className="text-xs mt-1">Enter a GitHub URL above to download a skill</p>
          </div>
        ) : (
          skills.map((skill) => (
            <div
              key={skill.skill_id}
              className="p-3 border border-border rounded-sm bg-background-elevated"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className="p-1.5 rounded bg-primary/20">
                    <FolderOpen className="size-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{skill.name}</div>
                    {skill.description && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {skill.description}
                      </div>
                    )}
                    <a
                      href={skill.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-1 truncate"
                    >
                      <ExternalLink className="size-3 shrink-0" />
                      <span className="truncate">{formatGitHubUrl(skill.source_url)}</span>
                    </a>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => handleDelete(skill.skill_id)}
                  disabled={deletingSkillId === skill.skill_id}
                  className="text-muted-foreground hover:text-destructive shrink-0"
                >
                  {deletingSkillId === skill.skill_id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      <Separator />

      {/* Agent Skills Section */}
      <div>
        <div className="text-section-header mb-2">AGENT SKILLS</div>
        <p className="text-xs text-muted-foreground mb-4">
          Enable skills for each agent.
        </p>
      </div>

      {/* Agent Selector */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Agent</label>
        <select
          value={selectedAgentId || ''}
          onChange={(e) => setSelectedAgentId(e.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {agents.map((agent) => (
            <option key={agent.agent_id} value={agent.agent_id}>
              {agent.name}
            </option>
          ))}
        </select>
      </div>

      {/* Skills for Selected Agent */}
      <div className="space-y-2">
        {loadingAgentConfig ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : skills.length === 0 ? (
          <div className="text-center py-4 text-sm text-muted-foreground">
            <p>No skills available</p>
            <p className="text-xs mt-1">Download skills above to enable them for agents</p>
          </div>
        ) : (
          skills.map((skill) => (
            <div
              key={skill.skill_id}
              className={`flex items-center justify-between p-3 border rounded-sm transition-colors ${
                isSkillEnabled(skill.skill_id)
                  ? 'border-border bg-background-elevated'
                  : 'border-border/50 bg-background opacity-60'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{skill.name}</div>
                {skill.description && (
                  <div className="text-xs text-muted-foreground">
                    {skill.description}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {savingSkillToggle === skill.skill_id && (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                )}
                <Switch
                  checked={isSkillEnabled(skill.skill_id)}
                  onCheckedChange={() => handleToggleSkill(skill.skill_id)}
                  disabled={savingSkillToggle === skill.skill_id}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
