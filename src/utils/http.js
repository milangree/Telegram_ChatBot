// 安全解析 Response JSON，避免空 body / HTML 触发 Unexpected end of JSON input

/**
 * 从 Response 安全读取 JSON。
 * - body 为空或非 JSON 时返回 fallback（默认 null）
 * - 不会因解析失败而抛错
 */
export async function readJsonSafe(response, fallback = null) {
  if (!response) return fallback

  let text = ''
  try {
    text = await response.text()
  } catch {
    return fallback
  }

  if (!text || !String(text).trim()) return fallback

  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}
