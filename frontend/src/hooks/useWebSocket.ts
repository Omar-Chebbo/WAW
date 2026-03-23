/**
 * hooks/useWebSocket.ts
 * Opens a persistent WebSocket connection and exposes real-time
 * progress messages to any component that needs them.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import type { ProgressEvent } from '../types'

export function useWebSocket(sessionId: string) {
  const [messages, setMessages] = useState<ProgressEvent[]>([])
  const [connected, setConnected]  = useState(false)
  const wsRef = useRef<WebSocket | null>(null)

  // Keep the latest progress per method so progress bars update
  const [latestByMethod, setLatestByMethod] = useState<Record<string, ProgressEvent>>({})

  useEffect(() => {
    if (!sessionId) return

    const wsUrl = `ws://${window.location.host}/ws/${sessionId}`
    const ws    = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen  = () => setConnected(true)
    ws.onclose = () => setConnected(false)

    ws.onmessage = (evt) => {
      try {
        const msg: ProgressEvent = JSON.parse(evt.data)
        setMessages(prev => [...prev.slice(-99), msg])   // keep last 100
        if (msg.method) {
          setLatestByMethod(prev => ({ ...prev, [msg.method!]: msg }))
        }
      } catch { /* ignore malformed messages */ }
    }

    // Ping every 25 s to keep the connection alive through proxies
    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send('ping')
    }, 25_000)

    return () => {
      clearInterval(ping)
      ws.close()
    }
  }, [sessionId])

  const clearMessages = useCallback(() => {
    setMessages([])
    setLatestByMethod({})
  }, [])

  return { messages, latestByMethod, connected, clearMessages }
}
