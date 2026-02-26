/**
 * Email allowlist — controls which emails can register.
 * Stores the list in system_settings with key "allowed_emails" as a JSON array.
 * When the list is empty, registration is open to everyone.
 */

import { getSystemSetting, setSystemSetting } from './admin.js'

const SETTING_KEY = 'allowed_emails'

/**
 * Get the current list of allowed emails.
 */
export async function getAllowedEmails(): Promise<string[]> {
  const raw = await getSystemSetting(SETTING_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Check if an email is allowed to register.
 * If the allowlist is empty, all emails are allowed (open registration).
 */
export async function isEmailAllowed(email: string): Promise<boolean> {
  const allowed = await getAllowedEmails()
  if (allowed.length === 0) return true
  return allowed.includes(email.toLowerCase())
}

/**
 * Set the full allowlist (replaces existing list).
 */
export async function setAllowedEmails(emails: string[]): Promise<void> {
  const normalized = emails.map(e => e.toLowerCase().trim()).filter(Boolean)
  const unique = [...new Set(normalized)]
  await setSystemSetting(SETTING_KEY, JSON.stringify(unique))
}

/**
 * Add an email to the allowlist.
 */
export async function addAllowedEmail(email: string): Promise<string[]> {
  const current = await getAllowedEmails()
  const normalized = email.toLowerCase().trim()
  if (!normalized || current.includes(normalized)) return current
  current.push(normalized)
  await setSystemSetting(SETTING_KEY, JSON.stringify(current))
  return current
}

/**
 * Remove an email from the allowlist.
 */
export async function removeAllowedEmail(email: string): Promise<string[]> {
  const current = await getAllowedEmails()
  const normalized = email.toLowerCase().trim()
  const updated = current.filter(e => e !== normalized)
  await setSystemSetting(SETTING_KEY, JSON.stringify(updated))
  return updated
}
