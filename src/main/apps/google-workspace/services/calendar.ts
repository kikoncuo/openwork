/**
 * Calendar Service - API wrapper for Google Calendar operations
 */

import { calendar_v3, google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import type { CalendarEvent, CreateEventInput, UpdateEventInput } from '../types'

export class CalendarService {
  private calendar: calendar_v3.Calendar

  constructor(auth: OAuth2Client) {
    this.calendar = google.calendar({ version: 'v3', auth })
  }

  /**
   * Get events from a calendar within a date range
   * @param calendarId Calendar ID (default: 'primary')
   * @param startDate Start date as ISO string
   * @param endDate End date as ISO string
   * @param maxResults Maximum number of results (default: 50)
   */
  async getEvents(
    calendarId: string = 'primary',
    startDate: string,
    endDate: string,
    maxResults: number = 50
  ): Promise<CalendarEvent[]> {
    try {
      const response = await this.calendar.events.list({
        calendarId,
        timeMin: startDate,
        timeMax: endDate,
        maxResults,
        singleEvents: true,
        orderBy: 'startTime'
      })

      const events = response.data.items || []
      return events.map(event => this.mapEvent(event))
    } catch (error) {
      console.error('[Calendar] Get events error:', error)
      throw error
    }
  }

  /**
   * Create a new calendar event
   * @param calendarId Calendar ID (default: 'primary')
   * @param event Event details
   */
  async createEvent(calendarId: string = 'primary', event: CreateEventInput): Promise<CalendarEvent> {
    try {
      const response = await this.calendar.events.insert({
        calendarId,
        requestBody: {
          summary: event.summary,
          description: event.description,
          location: event.location,
          start: this.parseDateTime(event.start),
          end: this.parseDateTime(event.end),
          attendees: event.attendees?.map(email => ({ email }))
        }
      })

      return this.mapEvent(response.data)
    } catch (error) {
      console.error('[Calendar] Create event error:', error)
      throw error
    }
  }

  /**
   * Update an existing calendar event
   * @param calendarId Calendar ID (default: 'primary')
   * @param eventId Event ID
   * @param updates Updates to apply
   */
  async updateEvent(
    calendarId: string = 'primary',
    eventId: string,
    updates: UpdateEventInput
  ): Promise<CalendarEvent> {
    try {
      // First get the existing event
      const existing = await this.calendar.events.get({
        calendarId,
        eventId
      })

      const requestBody: calendar_v3.Schema$Event = {
        ...existing.data
      }

      if (updates.summary !== undefined) {
        requestBody.summary = updates.summary
      }
      if (updates.description !== undefined) {
        requestBody.description = updates.description
      }
      if (updates.location !== undefined) {
        requestBody.location = updates.location
      }
      if (updates.start !== undefined) {
        requestBody.start = this.parseDateTime(updates.start)
      }
      if (updates.end !== undefined) {
        requestBody.end = this.parseDateTime(updates.end)
      }
      if (updates.attendees !== undefined) {
        requestBody.attendees = updates.attendees.map(email => ({ email }))
      }

      const response = await this.calendar.events.update({
        calendarId,
        eventId,
        requestBody
      })

      return this.mapEvent(response.data)
    } catch (error) {
      console.error('[Calendar] Update event error:', error)
      throw error
    }
  }

  /**
   * Delete a calendar event
   * @param calendarId Calendar ID (default: 'primary')
   * @param eventId Event ID
   */
  async deleteEvent(calendarId: string = 'primary', eventId: string): Promise<void> {
    try {
      await this.calendar.events.delete({
        calendarId,
        eventId
      })
    } catch (error) {
      console.error('[Calendar] Delete event error:', error)
      throw error
    }
  }

  /**
   * Map Google Calendar event to our CalendarEvent type
   */
  private mapEvent(event: calendar_v3.Schema$Event): CalendarEvent {
    return {
      id: event.id || '',
      summary: event.summary || '(No Title)',
      description: event.description || undefined,
      start: event.start?.dateTime || event.start?.date || '',
      end: event.end?.dateTime || event.end?.date || '',
      attendees: event.attendees?.map(a => a.email || '').filter(Boolean),
      location: event.location || undefined
    }
  }

  /**
   * Parse date/time string to Google Calendar format
   * Supports both ISO datetime strings and date-only strings
   */
  private parseDateTime(dateTime: string): calendar_v3.Schema$EventDateTime {
    // Check if it's a date-only string (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateTime)) {
      return { date: dateTime }
    }

    // It's a full datetime
    return { dateTime }
  }
}
