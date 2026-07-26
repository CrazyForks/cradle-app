/** Unix-seconds formatters shared by cards, rows, and the issue detail header. */

export function formatShortDate(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) {
    return ''
  }
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(unixSeconds * 1000),
  )
}

export function formatRelativeAge(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) {
    return ''
  }
  const minutes = Math.floor((Date.now() - unixSeconds * 1000) / 60_000)
  if (minutes < 1) {
    return 'now'
  }
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h`
  }
  return `${Math.floor(hours / 24)}d`
}
