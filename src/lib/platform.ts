/** 运行环境适配层：Tauri 桌面端走 Rust 命令，浏览器预览走 IndexedDB 回退 */

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: call } = await import('@tauri-apps/api/core')
  return call<T>(cmd, args)
}

export interface VaultSignature {
  files: number
  modified: number
  bytes: number
  hash: string
}

export interface VaultFile {
  path: string
  content: string
  modified: number
  size: number
}

export interface VaultInfo {
  root: string
  files: number
}

export interface RustBlock {
  kind: string
  level: number
  line: number
  start: number
  end: number
  text: string
}

export interface DocSnapshot {
  text: string
  revision: number
  blocks: RustBlock[]
}

export interface DocPatch {
  revision: number
  blocks: RustBlock[]
}

export interface RemoteSearchHit {
  path: string
  title: string
  line: number
  snippet: string
  score: number
}

export interface AiStreamRequest {
  id: string
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
  messages: { role: string; content: string }[]
}

export interface AiTestRequest {
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
}

export interface EmbeddingsRequest {
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  input: string[]
}

export interface ImageRequest {
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  prompt: string
  size: string
  /** 参考图 data URL；传了就按图编辑 */
  image?: string
}

export const platform = {
  isTauri,

  async vaultInfo(): Promise<VaultInfo | null> {
    if (!isTauri) return null
    return invoke<VaultInfo>('vault_root_info')
  },

  async vaultList(): Promise<VaultFile[]> {
    if (!isTauri) return []
    return invoke<VaultFile[]>('vault_list')
  },

  async vaultSignature(): Promise<VaultSignature> {
    if (!isTauri) return { files: 0, modified: 0, bytes: 0, hash: '' }
    return invoke<VaultSignature>('vault_signature')
  },

  async vaultWrite(path: string, content: string): Promise<{ modified: number; size: number }> {
    if (!isTauri) return { modified: Date.now(), size: content.length }
    return invoke('vault_write', { path, content })
  },

  async vaultDirs(): Promise<string[]> {
    return invoke<string[]>('vault_dirs')
  },

  async vaultMkdir(path: string): Promise<string> {
    return invoke<string>('vault_mkdir', { path })
  },

  async vaultDelete(path: string): Promise<void> {
    if (!isTauri) return
    await invoke('vault_delete', { path })
  },

  async vaultRename(from: string, to: string): Promise<void> {
    if (!isTauri) return
    await invoke('vault_rename', { from, to })
  },

  async vaultRenameDir(from: string, to: string): Promise<void> {
    if (!isTauri) return
    await invoke('vault_rename_dir', { from, to })
  },

  async vaultDeleteDir(path: string): Promise<void> {
    if (!isTauri) return
    await invoke('vault_delete_dir', { path })
  },

  async revealVault(): Promise<void> {
    if (!isTauri) return
    await invoke('vault_reveal')
  },

  async loadSettings(): Promise<Record<string, unknown> | null> {
    if (!isTauri) return null
    const raw = await invoke<string | null>('settings_load')
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  },

  async saveSettings(settings: unknown): Promise<void> {
    if (!isTauri) return
    await invoke('settings_save', { json: JSON.stringify(settings) })
  },

  async saveExport(name: string, blob: Blob): Promise<string> {
    if (!isTauri) return ''
    const buf = new Uint8Array(await blob.arrayBuffer())
    return invoke<string>('save_export', { name, data: Array.from(buf) })
  },

  async openPath(path: string): Promise<void> {
    if (!isTauri || !path) return
    await invoke('open_path', { path })
  },

  async openExternal(url: string): Promise<void> {
    if (!url) return
    if (isTauri) {
      await invoke('open_external', { url })
      return
    }
    window.open(url, '_blank', 'noopener')
  },

  async petOpen(): Promise<void> {
    if (!isTauri) return
    await invoke('pet_open')
  },

  async petClose(): Promise<void> {
    if (!isTauri) return
    await invoke('pet_close')
  },

  async petMood(mood: string, line?: string | null): Promise<void> {
    if (!isTauri) return
    await invoke('pet_mood', { mood, line: line ?? null })
  },

  async petActivate(): Promise<void> {
    if (!isTauri) return
    await invoke('pet_activate')
  },

  async startWindowDrag(): Promise<void> {
    if (!isTauri) return
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().startDragging()
  },

  async listen<T>(event: string, cb: (payload: T) => void): Promise<() => void> {
    if (!isTauri) return () => {}
    const { listen } = await import('@tauri-apps/api/event')
    return listen<T>(event, (e) => cb(e.payload))
  },

  async emit(event: string, payload?: unknown): Promise<void> {
    if (!isTauri) return
    const { emit } = await import('@tauri-apps/api/event')
    await emit(event, payload)
  },

  async docOpen(path: string): Promise<DocSnapshot> {
    return invoke<DocSnapshot>('doc_open', { path })
  },

  async docApply(path: string, baseRevision: number, changes: { from: number; to: number; insert: string }[]): Promise<DocPatch> {
    return invoke<DocPatch>('doc_apply', { path, baseRevision, changes })
  },

  async docReset(path: string, text: string): Promise<DocPatch> {
    return invoke<DocPatch>('doc_reset', { path, text })
  },

  async indexRebuild(): Promise<number> {
    if (!isTauri) return 0
    return invoke<number>('index_rebuild')
  },

  async searchDocs(query: string, limit = 50): Promise<RemoteSearchHit[]> {
    if (!isTauri) return []
    return invoke<RemoteSearchHit[]>('search_docs', { query, limit })
  },

  async secretSet(provider: string, value: string): Promise<void> {
    if (!isTauri) return
    await invoke('secret_set', { provider, value })
  },

  async secretGet(provider: string): Promise<string> {
    if (!isTauri) return ''
    return (await invoke<string | null>('secret_get', { provider })) ?? ''
  },

  async secretDelete(provider: string): Promise<void> {
    if (!isTauri) return
    await invoke('secret_delete', { provider })
  },

  async aiModels(req: { provider: string; baseUrl: string; apiKey: string }): Promise<string[]> {
    if (!isTauri) return []
    return invoke<string[]>('ai_models', { req })
  },

  /** 桌面端：连接测试同样走 Rust，避免 CORS 误报 */
  async aiTest(req: AiTestRequest): Promise<string> {
    if (!isTauri) throw new Error('not in tauri')
    return invoke<string>('ai_test', { req })
  },

  /** 桌面端：embedding 同样走 Rust，避免 webview CORS */
  async aiEmbeddings(req: EmbeddingsRequest): Promise<number[][]> {
    if (!isTauri) throw new Error('not in tauri')
    return invoke<number[][]>('ai_embeddings', { req })
  },

  async aiImage(req: ImageRequest): Promise<{ b64?: string; url?: string }> {
    if (!isTauri) throw new Error('not in tauri')
    return invoke<{ b64?: string; url?: string }>('ai_image', { req })
  },

  async vaultAssetWrite(path: string, data: Uint8Array): Promise<string> {
    if (!isTauri) return path
    return invoke<string>('vault_asset_write', { path, data: Array.from(data) })
  },

  async vaultAssetRead(path: string): Promise<Uint8Array> {
    if (!isTauri) return new Uint8Array()
    const rows = await invoke<number[]>('vault_asset_read', { path })
    return new Uint8Array(rows)
  },

  /** 桌面端：AI 流式请求走 Rust（避免 webview CORS 限制） */
  async aiStream(req: AiStreamRequest, onDelta: (text: string) => void, signal?: AbortSignal): Promise<string> {
    if (!isTauri) throw new Error('not in tauri')
    const offs: (() => void)[] = []
    let full = ''
    let settled = false
    let resolveDone: () => void = () => {}
    let rejectDone: (e: Error) => void = () => {}
    const done = new Promise<void>((resolve, reject) => {
      resolveDone = () => {
        if (!settled) {
          settled = true
          resolve()
        }
      }
      rejectDone = (e) => {
        if (!settled) {
          settled = true
          reject(e)
        }
      }
    })

    offs.push(
      await this.listen<{ id: string; delta: string }>('inkspire:ai:delta', (p) => {
        if (p.id !== req.id) return
        full += p.delta
        onDelta(p.delta)
      }),
    )
    offs.push(await this.listen<{ id: string }>('inkspire:ai:done', (p) => p.id === req.id && resolveDone()))
    offs.push(
      await this.listen<{ id: string; message: string }>('inkspire:ai:error', (p) => {
        if (p.id === req.id) rejectDone(new Error(p.message))
      }),
    )
    const onAbort = () => resolveDone()
    signal?.addEventListener('abort', onAbort)

    try {
      await invoke('ai_stream', { req })
      await done
    } finally {
      offs.splice(0).forEach((f) => f())
      signal?.removeEventListener('abort', onAbort)
    }
    return full
  }
}
