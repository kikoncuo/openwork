# App Connection System

This document explains how to connect external apps to OpenWork and understand connection health monitoring.

## Overview

OpenWork supports connecting external apps like WhatsApp to extend your AI assistant's capabilities. Connected apps allow your agents to:
- Send and receive messages
- Search chat history
- Interact with contacts

## Connecting Apps

### WhatsApp

1. Navigate to **Settings > Apps**
2. Click **Connect** on the WhatsApp card
3. A QR code will appear
4. Open WhatsApp on your phone
5. Go to **Settings > Linked Devices > Link a Device**
6. Scan the QR code

Once connected, you'll see a green "Connected" badge with your phone number.

## Connection Health Monitoring

The system continuously monitors your app connections and alerts you when issues occur.

### Health Statuses

| Status | Badge Color | Meaning |
|--------|-------------|---------|
| **Healthy** | Green | Connection is working normally |
| **Warning** | Yellow | Connection may have issues, check recommended actions |
| **Critical** | Red | Connection is not functioning, immediate action needed |

### Common Warnings

**"Phone appears offline"**
- Your phone lost internet connection
- WhatsApp was closed on your phone
- **Action**: Check your phone's internet connection

**"No recent activity"**
- No messages sent or received for over 30 minutes
- Connection may have become stale
- **Action**: Try reconnecting

### Warning Banner

When a connection needs attention, a yellow warning banner appears with:
- Description of the issue
- Recommended action
- **Reconnect** button to fix the issue

### Reconnecting

Click the **Reconnect** button to:
1. Disconnect the current session
2. Start a fresh connection
3. Scan a new QR code if needed

## Auto-Agent Response

Once WhatsApp is connected, you can enable automatic AI responses:

1. Toggle **Auto-Agent Response** on
2. Select an **Agent** to handle messages
3. Set **Thread Timeout** (default: 30 minutes)
4. Choose a **Workspace Path** for file access

When enabled:
- Incoming WhatsApp messages trigger the selected agent
- The agent generates a response
- The response is sent back via WhatsApp
- Conversation context is maintained within the timeout period

## Troubleshooting

### QR Code Not Appearing
- Check your internet connection
- Refresh the page and try again
- Make sure no other WhatsApp Web sessions are active

### Messages Not Being Received
- Check the connection health status
- Verify your phone has internet access
- Try disconnecting and reconnecting

### Agent Not Responding
- Ensure Auto-Agent Response is enabled
- Verify an agent is selected
- Check the workspace path is valid
- Look for errors in the sidebar
