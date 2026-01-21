import * as React from "react"
import { ChevronDown, Check } from "lucide-react"
import { cn } from "@/lib/utils"

// Simple select using native HTML select with custom styling
// For more complex needs, consider using Radix UI Select

interface SelectProps {
  value?: string
  onValueChange?: (value: string) => void
  disabled?: boolean
  children: React.ReactNode
}

interface SelectTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode
}

interface SelectValueProps {
  placeholder?: string
}

interface SelectContentProps {
  children: React.ReactNode
}

interface SelectItemProps {
  value: string
  children: React.ReactNode
  disabled?: boolean
}

const SelectContext = React.createContext<{
  value?: string
  displayValue?: React.ReactNode
  onSelect?: (value: string, display: React.ReactNode) => void
  open: boolean
  setOpen: (open: boolean) => void
}>({
  open: false,
  setOpen: () => {}
})

const Select = ({ value, onValueChange, disabled, children }: SelectProps) => {
  const [open, setOpen] = React.useState(false)
  const [displayValue, setDisplayValue] = React.useState<React.ReactNode>(null)

  const handleSelect = React.useCallback((newValue: string, display: React.ReactNode) => {
    onValueChange?.(newValue)
    setDisplayValue(display)
    setOpen(false)
  }, [onValueChange])

  return (
    <SelectContext.Provider value={{ value, displayValue, onSelect: handleSelect, open, setOpen }}>
      <div className="relative">
        {React.Children.map(children, child => {
          if (React.isValidElement(child)) {
            return React.cloneElement(child as React.ReactElement<{ disabled?: boolean }>, { disabled })
          }
          return child
        })}
      </div>
    </SelectContext.Provider>
  )
}

const SelectTrigger = React.forwardRef<HTMLButtonElement, SelectTriggerProps>(
  ({ className, children, disabled, ...props }, ref) => {
    const { open, setOpen } = React.useContext(SelectContext)

    return (
      <button
        type="button"
        ref={ref}
        className={cn(
          "flex h-9 w-full items-center justify-between rounded-sm border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        onClick={() => setOpen(!open)}
        disabled={disabled}
        {...props}
      >
        {children}
        <ChevronDown className={cn("size-4 opacity-50 transition-transform", open && "rotate-180")} />
      </button>
    )
  }
)
SelectTrigger.displayName = "SelectTrigger"

const SelectValue = ({ placeholder }: SelectValueProps) => {
  const { value, displayValue } = React.useContext(SelectContext)

  if (!value) {
    return <span className="text-muted-foreground">{placeholder}</span>
  }

  return <span>{displayValue || value}</span>
}

const SelectContent = ({ children }: SelectContentProps) => {
  const { open, setOpen } = React.useContext(SelectContext)
  const ref = React.useRef<HTMLDivElement>(null)

  // Close on click outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open, setOpen])

  if (!open) return null

  return (
    <div
      ref={ref}
      className="absolute z-50 mt-1 w-full rounded-sm border border-border bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95"
    >
      {children}
    </div>
  )
}

const SelectItem = ({ value: itemValue, children, disabled }: SelectItemProps) => {
  const { value, onSelect } = React.useContext(SelectContext)
  const isSelected = value === itemValue

  return (
    <div
      className={cn(
        "relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground",
        disabled && "pointer-events-none opacity-50",
        isSelected && "bg-accent/50"
      )}
      onClick={() => {
        if (!disabled) {
          onSelect?.(itemValue, children)
        }
      }}
    >
      {isSelected && (
        <span className="absolute left-2 flex size-3.5 items-center justify-center">
          <Check className="size-4" />
        </span>
      )}
      {children}
    </div>
  )
}

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem }
