import AsyncStorage from '@react-native-async-storage/async-storage'
import type { InfiniteData } from '@tanstack/react-query'

import type { GetChatSessionsBySessionIdMessagePreviewsResponse } from '@/api-gen'

type ChatHistoryPage = GetChatSessionsBySessionIdMessagePreviewsResponse
export type ChatHistoryCacheData = InfiniteData<ChatHistoryPage, string | null>

const CACHE_VERSION = 1
const CACHE_PREFIX = '@cradle/mobile/chat-history'

function cacheKey(connectionUrl: string, sessionId: string): string {
  return `${CACHE_PREFIX}/${connectionUrl}/${sessionId}`
}

export async function readChatHistoryCache(
  connectionUrl: string,
  sessionId: string,
): Promise<ChatHistoryCacheData | null> {
  const raw = await AsyncStorage.getItem(cacheKey(connectionUrl, sessionId))
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as {
      version?: number
      data?: ChatHistoryCacheData
    }
    if (parsed.version !== CACHE_VERSION || !parsed.data || !Array.isArray(parsed.data.pages)) {
      return null
    }
    return parsed.data
  }
  catch {
    return null
  }
}

export async function writeChatHistoryCache(
  connectionUrl: string,
  sessionId: string,
  data: ChatHistoryCacheData,
): Promise<void> {
  await AsyncStorage.setItem(cacheKey(connectionUrl, sessionId), JSON.stringify({
    data,
    version: CACHE_VERSION,
  }))
}
