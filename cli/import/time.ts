// Exports give clock times without a time zone. These turn a clock time in a named zone into
// a moment, and a moment back into a clock time for printing.

export type ClockTime = { year: number; month: number; day: number; hour: number; minute: number; second: number }

export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

export function momentOf(clock: ClockTime, zone: string): number {
  const asUtc = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second)
  // The zone's offset depends on the moment, which is what we are looking for. Two rounds
  // settle it, also around a clock change.
  const guess = asUtc - offsetAt(asUtc, zone)
  return asUtc - offsetAt(guess, zone)
}

export function clockTimeOf(moment: number, zone: string): ClockTime {
  const parts: Record<string, number> = {}
  for (const { type, value } of formatterFor(zone).formatToParts(moment)) parts[type] = Number(value)
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour!,
    minute: parts.minute!,
    second: parts.second!,
  }
}

function offsetAt(moment: number, zone: string): number {
  const clock = clockTimeOf(moment, zone)
  const asUtc = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second)
  return asUtc - Math.floor(moment / 1000) * 1000
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    formatters.set(zone, formatter)
  }
  return formatter
}
