import { useState, useEffect, useCallback } from 'react'
import { Clock, AlertCircle, Check, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'

interface CronBuilderProps {
  value: string
  onChange: (value: string) => void
  onValidation?: (valid: boolean, error?: string) => void
}

type Frequency = 'every_minute' | 'every_5_minutes' | 'every_15_minutes' | 'every_30_minutes' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom'

const WEEKDAYS = [
  { value: '0', label: 'Sun' },
  { value: '1', label: 'Mon' },
  { value: '2', label: 'Tue' },
  { value: '3', label: 'Wed' },
  { value: '4', label: 'Thu' },
  { value: '5', label: 'Fri' },
  { value: '6', label: 'Sat' },
]

export function CronBuilder({ value, onChange, onValidation }: CronBuilderProps) {
  const [frequency, setFrequency] = useState<Frequency>('daily')
  const [minute, setMinute] = useState('0')
  const [hour, setHour] = useState('9')
  const [dayOfMonth, setDayOfMonth] = useState('1')
  const [selectedDays, setSelectedDays] = useState<string[]>(['1']) // Monday by default
  const [customExpression, setCustomExpression] = useState('')

  const [validation, setValidation] = useState<{
    valid: boolean
    error?: string
    nextRuns?: number[]
    humanReadable?: string
  } | null>(null)
  const [validating, setValidating] = useState(false)

  // Parse existing cron expression to set initial state
  useEffect(() => {
    if (!value) return

    const parts = value.split(' ')
    if (parts.length < 5) {
      setFrequency('custom')
      setCustomExpression(value)
      return
    }

    const [min, hr, dom, , dow] = parts

    // Detect frequency from expression
    if (min === '*' && hr === '*' && dom === '*' && dow === '*') {
      setFrequency('every_minute')
    } else if (min === '*/5' && hr === '*' && dom === '*' && dow === '*') {
      setFrequency('every_5_minutes')
    } else if (min === '*/15' && hr === '*' && dom === '*' && dow === '*') {
      setFrequency('every_15_minutes')
    } else if (min === '*/30' && hr === '*' && dom === '*' && dow === '*') {
      setFrequency('every_30_minutes')
    } else if (min !== '*' && hr === '*' && dom === '*' && dow === '*') {
      setFrequency('hourly')
      setMinute(min)
    } else if (min !== '*' && hr !== '*' && dom === '*' && dow === '*') {
      setFrequency('daily')
      setMinute(min)
      setHour(hr)
    } else if (min !== '*' && hr !== '*' && dom === '*' && dow !== '*') {
      setFrequency('weekly')
      setMinute(min)
      setHour(hr)
      setSelectedDays(dow.split(','))
    } else if (min !== '*' && hr !== '*' && dom !== '*' && dow === '*') {
      setFrequency('monthly')
      setMinute(min)
      setHour(hr)
      setDayOfMonth(dom)
    } else {
      setFrequency('custom')
      setCustomExpression(value)
    }
  }, [])

  // Build cron expression from selections
  const buildCronExpression = useCallback((): string => {
    switch (frequency) {
      case 'every_minute':
        return '* * * * *'
      case 'every_5_minutes':
        return '*/5 * * * *'
      case 'every_15_minutes':
        return '*/15 * * * *'
      case 'every_30_minutes':
        return '*/30 * * * *'
      case 'hourly':
        return `${minute} * * * *`
      case 'daily':
        return `${minute} ${hour} * * *`
      case 'weekly':
        return `${minute} ${hour} * * ${selectedDays.join(',')}`
      case 'monthly':
        return `${minute} ${hour} ${dayOfMonth} * *`
      case 'custom':
        return customExpression
      default:
        return '0 9 * * *'
    }
  }, [frequency, minute, hour, dayOfMonth, selectedDays, customExpression])

  // Validate expression when it changes
  const validateExpression = useCallback(async (expr: string) => {
    if (!expr) {
      setValidation(null)
      onValidation?.(false, 'Empty expression')
      return
    }

    setValidating(true)
    try {
      const result = await window.api.cronjobs.validateCron(expr)
      setValidation(result)
      onValidation?.(result.valid, result.error)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Validation failed'
      setValidation({ valid: false, error: errorMessage })
      onValidation?.(false, errorMessage)
    } finally {
      setValidating(false)
    }
  }, [onValidation])

  // Update cron expression and validate when inputs change
  useEffect(() => {
    const expr = buildCronExpression()
    onChange(expr)
    validateExpression(expr)
  }, [frequency, minute, hour, dayOfMonth, selectedDays, customExpression, buildCronExpression, onChange, validateExpression])

  // Handle weekday toggle
  const toggleDay = (day: string) => {
    setSelectedDays(prev => {
      if (prev.includes(day)) {
        // Don't allow deselecting all days
        if (prev.length === 1) return prev
        return prev.filter(d => d !== day)
      }
      return [...prev, day].sort((a, b) => parseInt(a) - parseInt(b))
    })
  }

  // Format next run time
  const formatNextRun = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleString()
  }

  return (
    <div className="space-y-4">
      {/* Frequency Selector */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Frequency</label>
        <select
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as Frequency)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <option value="every_minute">Every minute</option>
          <option value="every_5_minutes">Every 5 minutes</option>
          <option value="every_15_minutes">Every 15 minutes</option>
          <option value="every_30_minutes">Every 30 minutes</option>
          <option value="hourly">Hourly</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="custom">Custom</option>
        </select>
      </div>

      {/* Time Picker (for hourly, daily, weekly, monthly) */}
      {(frequency === 'hourly' || frequency === 'daily' || frequency === 'weekly' || frequency === 'monthly') && (
        <div className="flex gap-4">
          {frequency !== 'hourly' && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Hour (0-23)</label>
              <select
                value={hour}
                onChange={(e) => setHour(e.target.value)}
                className="flex h-10 w-24 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i.toString()}>
                    {i.toString().padStart(2, '0')}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-2">
            <label className="text-sm font-medium">Minute (0-59)</label>
            <select
              value={minute}
              onChange={(e) => setMinute(e.target.value)}
              className="flex h-10 w-24 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {Array.from({ length: 60 }, (_, i) => (
                <option key={i} value={i.toString()}>
                  {i.toString().padStart(2, '0')}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Day of Week Selector (for weekly) */}
      {frequency === 'weekly' && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Days of Week</label>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((day) => (
              <button
                key={day.value}
                type="button"
                onClick={() => toggleDay(day.value)}
                className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
                  selectedDays.includes(day.value)
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background border-border hover:border-primary/50'
                }`}
              >
                {day.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Day of Month Selector (for monthly) */}
      {frequency === 'monthly' && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Day of Month</label>
          <select
            value={dayOfMonth}
            onChange={(e) => setDayOfMonth(e.target.value)}
            className="flex h-10 w-32 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {Array.from({ length: 31 }, (_, i) => (
              <option key={i + 1} value={(i + 1).toString()}>
                {i + 1}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Custom Expression Input */}
      {frequency === 'custom' && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Cron Expression</label>
          <Input
            value={customExpression}
            onChange={(e) => setCustomExpression(e.target.value)}
            placeholder="* * * * *"
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Format: minute hour day-of-month month day-of-week
          </p>
        </div>
      )}

      {/* Generated Expression Display */}
      <div className="p-3 bg-muted/50 rounded-md border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Generated Expression</span>
          {validating ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : validation ? (
            validation.valid ? (
              <Check className="size-4 text-status-nominal" />
            ) : (
              <AlertCircle className="size-4 text-status-critical" />
            )
          ) : null}
        </div>
        <code className="text-sm font-mono">{buildCronExpression()}</code>

        {validation && (
          <div className="mt-2">
            {validation.valid ? (
              <>
                {validation.humanReadable && (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Clock className="size-3" />
                    {validation.humanReadable}
                  </p>
                )}
                {validation.nextRuns && validation.nextRuns.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs text-muted-foreground mb-1">Next runs:</p>
                    <ul className="text-xs text-muted-foreground space-y-0.5">
                      {validation.nextRuns.slice(0, 3).map((run, i) => (
                        <li key={i}>{formatNextRun(run)}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-status-critical">
                {validation.error || 'Invalid expression'}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
