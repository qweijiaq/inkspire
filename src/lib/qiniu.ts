import type { QiniuSettings } from '../types'

/** Qiniu 上传域名；区域不同只是入口不同，policy/token 算法一致。 */
const UPLOAD_HOSTS: Record<string, string> = {
  z0: 'https://upload.qiniup.com',
  z1: 'https://upload-z1.qiniup.com',
  z2: 'https://upload-z2.qiniup.com',
  na0: 'https://upload-na0.qiniup.com',
  as0: 'https://upload-as0.qiniup.com',
  'cn-east-2': 'https://upload-cn-east-2.qiniup.com',
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function textToBase64Url(text: string): string {
  return bytesToBase64Url(new TextEncoder().encode(text))
}

function normalizeDomain(raw: string): string {
  const value = raw.trim().replace(/\/+$/, '')
  if (!value) return ''
  return /^https?:\/\//i.test(value) ? value : `https://${value}`
}

function safeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|#?&=%\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || `image-${Date.now()}`
}

async function hmacSha1(secret: string, text: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('当前环境不支持 WebCrypto，无法生成七牛上传签名')
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text))
  return bytesToBase64Url(new Uint8Array(signature))
}

export function qiniuReady(config: QiniuSettings | undefined, secret: string): config is QiniuSettings {
  return !!config?.enabled && !!config.accessKey && !!config.bucket && !!normalizeDomain(config.domain) && !!secret
}

/** 生成七牛上传 token（策略 1 小时有效，key 由本函数决定）。 */
export async function qiniuUploadToken(config: QiniuSettings, secret: string, key: string): Promise<string> {
  const policy = {
    scope: `${config.bucket}:${key}`,
    deadline: Math.floor(Date.now() / 1000) + 3600,
    returnBody: '{"key":"$(key)","hash":"$(etag)","fsize":$(fsize)}',
  }
  const encodedPolicy = textToBase64Url(JSON.stringify(policy))
  const signature = await hmacSha1(secret, encodedPolicy)
  return `${config.accessKey}:${signature}:${encodedPolicy}`
}

export async function uploadBlobToQiniu(blob: Blob, fileName: string, config: QiniuSettings, secret: string): Promise<string> {
  if (!qiniuReady(config, secret)) throw new Error('七牛云未配置完整（AccessKey / SecretKey / Bucket / Domain）')
  const domain = normalizeDomain(config.domain)
  const prefix = config.prefix.trim().replace(/^\/+|\/+$/g, '')
  const now = new Date()
  const datePath = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`
  const key = [prefix, datePath, `${Date.now()}-${safeFileName(fileName)}`].filter(Boolean).join('/')
  const token = await qiniuUploadToken(config, secret, key)
  const form = new FormData()
  form.append('token', token)
  form.append('key', key)
  form.append('file', blob, safeFileName(fileName))
  const endpoint = UPLOAD_HOSTS[config.zone] ?? UPLOAD_HOSTS.z0
  const res = await fetch(endpoint, { method: 'POST', body: form })
  const text = await res.text()
  if (!res.ok) throw new Error(`七牛上传失败 (${res.status})：${text.slice(0, 180)}`)
  let returnedKey = key
  try {
    returnedKey = JSON.parse(text)?.key || key
  } catch {
    /* 有些 bucket 不返回 JSON，按请求 key 拼 URL */
  }
  return `${domain}/${returnedKey.replace(/^\/+/, '')}`
}

export async function uploadDataUrlToQiniu(dataUrl: string, fileName: string, config: QiniuSettings, secret: string): Promise<string> {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/)
  if (!match) throw new Error('不是有效的 data URL')
  const mime = match[1] || 'image/png'
  const raw = match[2] ? atob(match[3]) : decodeURIComponent(match[3])
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return uploadBlobToQiniu(new Blob([bytes], { type: mime }), fileName, config, secret)
}
