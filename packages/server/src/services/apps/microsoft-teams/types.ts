/**
 * Microsoft Teams Types for Server
 */

export interface MicrosoftTokens {
  access_token: string
  refresh_token: string
  expiry_date: number
  scope: string
}

export interface TeamsConnectionStatus {
  connected: boolean
  email: string | null
  displayName: string | null
  connectedAt: number | null
  services: {
    teams: boolean
    chats: boolean
    users: boolean
    search: boolean
  }
}

export interface TeamsTeam {
  id: string
  displayName: string
  description?: string
  isArchived?: boolean
}

export interface TeamsChannel {
  id: string
  displayName: string
  description?: string
  membershipType?: string
}

export interface TeamsTeamMember {
  id: string
  displayName: string
  email?: string
  roles: string[]
}

export interface TeamsMessage {
  id: string
  createdDateTime: string
  body: string
  from: string
  fromId?: string
  importance?: string
  webUrl?: string
  attachments?: TeamsAttachment[]
  mentions?: TeamsMention[]
}

export interface TeamsAttachment {
  id: string
  contentType: string
  name?: string
  contentUrl?: string
}

export interface TeamsMention {
  id: number
  mentionText: string
  mentioned: {
    user?: {
      id: string
      displayName: string
    }
  }
}

export interface TeamsChat {
  id: string
  chatType: 'oneOnOne' | 'group' | 'meeting'
  topic?: string
  members: TeamsChatMember[]
  lastUpdatedDateTime?: string
}

export interface TeamsChatMember {
  id: string
  displayName: string
  email?: string
}

export interface TeamsUser {
  id: string
  displayName: string
  mail?: string
  userPrincipalName?: string
  jobTitle?: string
  department?: string
  officeLocation?: string
}

export interface SendMessageResult {
  messageId: string
  createdDateTime: string
}

export interface CreateChatResult {
  chatId: string
  chatType: string
}

export interface SearchResult {
  messages: TeamsMessage[]
  totalCount: number
}
