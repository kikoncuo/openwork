/**
 * Apps Tab - Container for app integrations in Settings
 * Currently supports WhatsApp, designed to be extensible for future apps
 */

import { WhatsAppSettings } from './WhatsAppSettings'

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

      {/* Future apps can be added here */}
      {/* <SlackSettings /> */}
      {/* <TelegramSettings /> */}
    </div>
  )
}
