import { idb } from './db'
import { isTauri, platform } from './platform'

const urlCache = new Map<string, string>()

/** 保存二进制资源：桌面写 vault/assets，浏览器预览写 IndexedDB assets store */
export async function saveAsset(path: string, blob: Blob): Promise<string> {
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
    urlCache.set(path, url)
    return url
  } catch {
    return null
  }
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',')
  const mime = head.match(/data:([^;]+)/)?.[1] ?? 'image/png'
  const binary = atob(body ?? '')
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
