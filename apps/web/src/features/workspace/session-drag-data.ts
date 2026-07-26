/**
 * Native half of the session drag contract: the plain session id.
 *
 * The Electron tear-off drop target is a native window outside the app's React
 * drag system and reads this exact mime. The in-app split view reads the richer
 * surface-route payload when present (see split-view/dnd/split-drag-payload),
 * falling back to this id — so a sidebar session drag lands in both worlds.
 */
export const SESSION_DRAG_MIME_TYPE = 'application/x-cradle-session'
