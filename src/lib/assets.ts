import { idb } from './db'
import { isTauri, platform } from './platform'

const urlCache = new Map<string, string>()
const MAX_CACHED_URLS = 160

function rememberUrl(path: string, url: string) {
  const old = urlCache.get(path)
  if (old) URL.revokeObjectURL(old)
  urlCache.set(path, url)
  // 长会话打开大量图片时，淘汰最旧的 blob URL，避免内存只增不减。
  while (urlCache.size > MAX_CACHED_URLS) {
    const first = urlCache.keys().next().value as string | undefined
    if (!first) break
    const stale = urlCache.get(first)
    if (stale) URL.revokeObjectURL(stale)
    urlCache.delete(first)
  }
}

/** 资源被同名覆盖或删除后，让下一次读取重新取 Blob。 */
export function forgetAssetUrl(path: string) {
  const old = urlCache.get(path)
  if (old) URL.revokeObjectURL(old)
  urlCache.delete(path)
}

/** 保存二进制资源：桌面写 vault/assets，浏览器预览写 IndexedDB assets store */
export async function saveAsset(path: string, blob: Blob): Promise<string> {
  forgetAssetUrl(path)
  if (isTauri) {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    return platform.vaultAssetWrite(path, bytes)
  }
  await idb.put('assets', { path, blob }, `file:${path}`)
  return path
}

/** 读取资源为可直接给 <img> 的 blob URL；桌面与浏览器预览共用接口 */
export async function assetUrl(path: string): Promise<string | null> {
  if (urlCache.has(path)) return urlCache.get(path) ?? null
  try {
    let blob: Blob | null = null
    if (isTauri) {
      const bytes = await platform.vaultAssetRead(path)
      if (bytes.length) {
        const copy = new Uint8Array(bytes.length)
        copy.set(bytes)
        blob = new Blob([copy])
      }
    } else {
      const row = await idb.get<{ blob: Blob }>('assets', `file:${path}`)
      blob = row?.blob ?? null
    }
    if (!blob) return null
    const url = URL.createObjectURL(blob)
    rememberUrl(path, url)
    return url
  } catch {
    return null
  }
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',')
  const mime = head.match(/data:([^;]+)/)?.[1] ?? 'image/png'
  const binary = /;base64/i.test(head) ? atob(body ?? '') : decodeURIComponent(body ?? '')
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/** 读取 vault/IndexedDB 资源并转成 data URL，用于 HTML/PDF 导出内联 */
export async function assetDataUrl(path: string): Promise<string | null> {
  try {
    let blob: Blob | null = null
    if (isTauri) {
      const bytes = await platform.vaultAssetRead(path)
      if (bytes.length) {
        const copy = new Uint8Array(bytes.length)
        copy.set(bytes)
        blob = new Blob([copy])
      }
    } else {
      const row = await idb.get<{ blob: Blob }>('assets', `file:${path}`)
      blob = row?.blob ?? null
    }
    if (!blob) return null
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}
