/**
 * Apps Tab - Container for app integrations in Settings
 * Supports WhatsApp and Google Workspace integrations
 */

import { WhatsAppSettings } from './WhatsAppSettings'
import { GoogleWorkspaceSettings } from './GoogleWorkspaceSettings'
import { ExaSettings } from './ExaSettings'

export function AppsTab(): React.JSX.Element {
  return (
    <div className="space-y-6 py-4">
      <div>
        <div className="text-section-header mb-2">CONNECTED APPS</div>
        <p className="text-xs text-muted-foreground mb-4">
          Connect external apps to extend your assistant's capabilities. Connected apps provide additional tools for messaging, searching, and more.
        </p>
      </div>

      {/* WhatsApp Integration */}
      <WhatsAppSettings />

      {/* Google Workspace Integration */}
      <GoogleWorkspaceSettings />

      {/* Search and Datasets (Exa) Integration */}
      <ExaSettings />

      {/* Future apps can be added here */}
      {/* <SlackSettings /> */}
      {/* <TelegramSettings /> */}
    </div>
  )
}
