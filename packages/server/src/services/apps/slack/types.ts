export interface SlackConnectionStatus {
  connected: boolean
  error?: string
}

export interface SlackToolInfo {
  id: string
  name: string
  description: string
  requireApproval: boolean
}
