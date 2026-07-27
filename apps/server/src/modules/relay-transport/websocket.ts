import WebSocket from 'ws'

/**
 * Closes a relay websocket without allowing ws's asynchronous connection
 * abort error to escape after transport listeners have been removed.
 */
export function closeRelayWebSocket(ws: WebSocket): void {
  ws.removeAllListeners()
  if (ws.readyState === WebSocket.CLOSED) {
    return
  }
  // Aborting an in-flight upgrade emits an error on the next tick, so keep one
  // listener installed after teardown to prevent an uncaught process error.
  ws.once('error', () => {})
  if (ws.readyState === WebSocket.OPEN) {
    ws.close()
    return
  }
  ws.terminate()
}
