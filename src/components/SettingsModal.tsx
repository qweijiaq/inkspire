import { useRef, useState } from 'react'
import { vault, useVault } from '../store'
import { Momo } from './Momo'
import { clearAICache, listModels, testConnection } from '../lib/ai'
import { PROVIDER_PRESETS, apiKeyFor, defaultEmbeddingModel, defaultImageModel, needsApiKey, presetOf, isLocalProvider } from '../lib/providers'
import { Select } from './ui/Select'
import { Slider } from './ui/Slider'
import { NumberField } from './ui/NumberField'
import { SuggestionInput } from './ui/SuggestionInput'
import { confirmDialog } from '../lib/dialog'
import { isTauri, platform } from '../lib/platform'
import type { AppSettings, AISettings, ProviderId } from '../types'
import { addMemory, removeMemory, useMemories } from '../lib/memories'
import { useDialogA11y } from './ui/useDialogA11y'
import { Icon } from './ui/Icon'

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const state = useVault()
  const s = state.settings
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [modelsBusy, setModelsBusy] = useState(false)
  const [vaultPath, setVaultPath] = useState(s.vaultPath || state.vaultRoot || '')
  const [memoryText, setMemoryText] = useState('')
  const [section, setSection] = useState('appearance')
  const memories = useMemories()
  const [modelsError, setModelsError] = useState<string | null>(null)
  const modalRef = useRef<HTMLDivElement | null>(null)
  useDialogA11y(modalRef, onClose)

  const update = (patch: Partial<AppSettings>) => void vault.updateSettings(patch)
  const updateAI = (patch: Partial<AISettings>) => void vault.updateSettings({ ai: patch })
  const preset = presetOf(s.ai.provider)
  const keyRequired = needsApiKey(s.ai.provider)
  const isDemo = s.ai.provider === 'demo'
  const toggle = (on: boolean, fn: () => void) => ({
    role: 'switch' as const,
    tabIndex: 0,
    'aria-checked': on,
    onClick: fn,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        fn()
      }
    },
  })

  const changeProvider = async (provider: ProviderId) => {
    const next = presetOf(provider)
    setModels([])
    setModelsError(null)
    setTestResult(null)
    const known = s.ai.keys?.[provider] || ''
    updateAI({
      provider,
      baseUrl: next.baseUrl,
      model: next.defaultModel,
      embeddingModel: defaultEmbeddingModel(provider),
      imageModel: defaultImageModel(provider),
      apiKey: known,
    })
    if (!known) {
      // 桌面端 Key 在系统钥匙串里，切换服务商后按需读回来，输入框不会莫名清空
      const loaded = await vault.loadProviderKey(provider)
      const current = vault.state.settings.ai
      if (loaded && current.provider === provider && !current.apiKey) {
        updateAI({ apiKey: loaded, keys: { ...(current.keys ?? {}), [provider]: loaded } })
      }
    }
  }

  const currentAIWithKey = async (): Promise<AISettings | null> => {
    const current = vault.state.settings.ai
    if (!needsApiKey(current.provider) || apiKeyFor(current)) return current
    const loaded = await vault.ensureProviderKey(current.provider)
    if (!loaded) return null
    const next = { ...current, apiKey: loaded, keys: { ...(current.keys ?? {}), [current.provider]: loaded } }
    updateAI({ apiKey: loaded, keys: next.keys })
    return next
  }

  const refreshModels = async () => {
    setModelsBusy(true)
    setModelsError(null)
    try {
      const ai = await currentAIWithKey()
      if (!ai) {
        setModelsError('还没有配置 API Key')
        return
      }
      const rows = await listModels(ai)
      if (!rows.length) setModelsError('服务返回了空的模型列表')
      setModels(rows)
    } catch (e: any) {
      setModelsError(e?.message ?? String(e))
    } finally {
      setModelsBusy(false)
    }
  }

  const runTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const ai = await currentAIWithKey()
      if (!ai) {
        setTestResult({ ok: false, msg: '还没有配置 API Key：先在钥匙串里保存，或在这里填写' })
        return
      }
      const reply = await testConnection(ai)
      setTestResult({ ok: true, msg: `连接成功：${reply.slice(0, 80)}` })
    } catch (e: any) {
      setTestResult({ ok: false, msg: e?.message ?? String(e) })
    } finally {
      setTesting(false)
    }
  }

  const ledger = state.aiLedger
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const startOfMonth = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1).getTime()
  const costToday = ledger.filter((row) => row.at >= startOfDay.getTime()).reduce((n, row) => n + row.cost, 0)
  const costMonth = ledger.filter((row) => row.at >= startOfMonth).reduce((n, row) => n + row.cost, 0)
  const costTotal = ledger.reduce((n, row) => n + row.cost, 0)
  const byModel = [...ledger.reduce((map, row) => {
    const cur = map.get(row.model) ?? { model: row.model, calls: 0, images: 0, cost: 0, kind: row.kind }
    cur.calls += 1
    cur.images += row.images
    cur.cost += row.cost
    map.set(row.model, cur)
    return map
  }, new Map<string, { model: string; calls: number; images: number; cost: number; kind: string }>()).values()]
    .sort((a, b) => b.cost - a.cost)
  const money = (n: number) => `¥${n < 1 ? n.toFixed(3) : n.toFixed(2)}`

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings-modal" ref={modalRef} role="dialog" aria-modal="true" aria-label="设置">
        <div className="modal-head">
          <Momo mood="happy" className="momo-mini" />
          <h3>设置</h3>
          <button className="close" onClick={onClose} aria-label="关闭设置">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="modal-body">
          <div className="settings-nav">
            {[
              ['appearance', '外观'],
              ['pet', '墨墨'],
              ['editing', '编辑'],
              ['ai', 'AI'],
              ['memory', '记忆'],
              ['data', '数据'],
              ['about', '关于'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={section === id ? 'on' : ''}
                aria-current={section === id ? 'page' : undefined}
                onClick={() => setSection(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className={`settings-group${section === 'appearance' ? ' on' : ''}`} data-section="appearance">
            <h4>外观</h4>
            <div className="field">
              <label>主题</label>
              <div className="seg">
                <button className={s.theme === 'paper' ? 'on' : ''} onClick={() => update({ theme: 'paper' })}>
                  <Icon name="sun" size={14} /> 纸张漫画
                </button>
                <button className={s.theme === 'night' ? 'on' : ''} onClick={() => update({ theme: 'night' })}>
                  <Icon name="moon" size={14} /> 夜间漫画
                </button>
              </div>
            </div>
            <div className="row-flex">
              <div className="field">
                <label>正文字号</label>
                <Slider value={s.fontSize} min={14} max={22} step={1} onChange={(v) => update({ fontSize: v })} format={(v) => `${v}px`} ariaLabel="正文字号" />
              </div>
              <div className="field">
                <label>行宽</label>
                <Slider value={s.lineWidth} min={560} max={1100} step={20} onChange={(v) => update({ lineWidth: v })} format={(v) => `${v}px`} ariaLabel="正文行宽" />
              </div>
            </div>
            <div className="field">
              <label>字体</label>
              <div className="seg">
                <button className={s.fontFamily === 'sans' ? 'on' : ''} onClick={() => update({ fontFamily: 'sans' })}>
                  无衬线
                </button>
                <button className={s.fontFamily === 'serif' ? 'on' : ''} onClick={() => update({ fontFamily: 'serif' })}>
                  衬线
                </button>
                <button className={s.fontFamily === 'mono' ? 'on' : ''} onClick={() => update({ fontFamily: 'mono' })}>
                  等宽
                </button>
              </div>
            </div>
            <div className={`switch${s.typewriter ? ' on' : ''}`} {...toggle(s.typewriter, () => update({ typewriter: !s.typewriter }))}>
              <span>打字机模式（光标始终居中）</span>
              <span className="sw" />
            </div>
            <div className={`switch${s.focusMode ? ' on' : ''}`} {...toggle(s.focusMode, () => update({ focusMode: !s.focusMode }))}>
              <span>专注模式（隐藏侧栏与桌宠）</span>
              <span className="sw" />
            </div>
          </div>

          <div className={`settings-group${section === 'pet' ? ' on' : ''}`} data-section="pet">
            <h4>墨墨</h4>
            <div className={`switch${s.showPet ? ' on' : ''}`} {...toggle(s.showPet, () => update({ showPet: !s.showPet }))}>
              <span>显示桌面上的墨墨</span>
              <span className="sw" />
            </div>
            <div className={`switch${s.petLines ? ' on' : ''}`} {...toggle(s.petLines, () => update({ petLines: !s.petLines }))}>
              <span>台词气泡</span>
              <span className="sw" />
            </div>
            <div className="field">
              <label>墨墨的语气</label>
              <div className="persona-row">
                {([
                  ['gentle', '温柔'],
                  ['curious', '好奇'],
                  ['strict', '严谨'],
                  ['sassy', '毒舌'],
                ] as const).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={(s.persona ?? 'gentle') === id ? 'on' : ''}
                    onClick={() => update({ persona: id })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="hint">只影响 AI 的语气和追问方式，不改变事实判断；记忆和来源仍然可见。</div>
            </div>
            <div className="settings-note">墨墨会根据状态切换 6 种表情：打字时专注、停笔 1.5 秒后开心、长时间空闲会打瞌睡。点它一下有惊喜。</div>
          </div>

          <div className={`settings-group${section === 'editing' ? ' on' : ''}`} data-section="editing">
            <h4>编辑</h4>
            <div className="field">
              <label>自动保存防抖（毫秒）</label>
              <NumberField value={s.autosaveMs} min={300} max={5000} step={100} suffix="ms" onChange={(v) => update({ autosaveMs: v })} ariaLabel="自动保存防抖" />
            </div>
            <div className={`switch${s.sourceMode ? ' on' : ''}`} {...toggle(s.sourceMode, () => update({ sourceMode: !s.sourceMode }))}>
              <span>默认使用源码模式</span>
              <span className="sw" />
            </div>
          </div>

          <div className={`settings-group${section === 'ai' ? ' on' : ''}`} data-section="ai">
            <h4>AI 接口</h4>
            <div className={`switch${s.ai.enabled ? ' on' : ''}`} {...toggle(s.ai.enabled, () => updateAI({ enabled: !s.ai.enabled }))}>
              <span>启用 AI 功能</span>
              <span className="sw" />
            </div>
            <div className={`switch${s.privacyLocalOnly ? ' on' : ''}`} {...toggle(!!s.privacyLocalOnly, () => update({ privacyLocalOnly: !s.privacyLocalOnly }))}>
              <span>隐私模式（只允许本地/离线模型）</span>
              <span className="sw" />
            </div>
            {s.privacyLocalOnly && !isLocalProvider(s.ai.provider) && (
              <div className="settings-note" style={{ color: 'var(--coral-strong)' }}>
                当前服务商是云端接口。隐私模式下 AI 请求会被拦下，请切到 Ollama / LM Studio，或关闭隐私模式。
              </div>
            )}

            <div className="field" style={{ marginTop: 10 }}>
              <label>服务商 · {PROVIDER_PRESETS.length} 个预设</label>
              <Select
                value={s.ai.provider}
                onChange={(v) => void changeProvider(v as ProviderId)}
                ariaLabel="AI 服务商"
                options={PROVIDER_PRESETS.map((p) => ({ value: p.id, label: p.label, hint: p.id === 'demo' ? '免 Key' : undefined }))}
              />
              <div className="hint">
                {preset.hint}
                {preset.keyUrl && (
                  <button
                    onClick={() => void platform.openExternal(preset.keyUrl)}
                    style={{ marginLeft: 6, color: 'var(--brand)', fontWeight: 800, textDecoration: 'underline' }}
                  >
                    去获取 Key ↗
                  </button>
                )}
              </div>
            </div>

            {!isDemo && (
              <div className="field">
                <label>Base URL</label>
                <input
                  type="text"
                  value={s.ai.baseUrl}
                  onChange={(e) => updateAI({ baseUrl: e.target.value })}
                  data-tip={s.ai.baseUrl}
                  placeholder={preset.baseUrl || 'https://api.anthropic.com（留空使用官方端点）'}
                />
                <div className="hint">{s.ai.provider === 'anthropic' ? 'Claude 使用 Messages API，留空即官方地址' : '兼容 OpenAI 的 /chat/completions 端点'}</div>
              </div>
            )}

            {keyRequired && (
              <div className="field">
                <label>API Key</label>
                <input
                  type="password"
                  value={s.ai.apiKey}
                  onChange={(e) => updateAI({ apiKey: e.target.value, keys: { ...(s.ai.keys ?? {}), [s.ai.provider]: e.target.value } })}
                  placeholder="sk-…（仅保存在本机，按服务商分别记忆）"
                />
                <div className="hint">
                  密钥保存在系统钥匙串；这里留空表示使用已保存的 Key，输入新值会覆盖。不会写进文档备份。
                  <button
                    style={{ marginLeft: 6, color: 'var(--brand)', fontWeight: 800 }}
                    onClick={async () => {
                      const k = await vault.ensureProviderKey(s.ai.provider)
                      if (k) updateAI({ apiKey: k, keys: { ...(s.ai.keys ?? {}), [s.ai.provider]: k } })
                      else vault.flash('钥匙串里没有这个服务商的 Key', 'error')
                    }}
                  >
                    从钥匙串读取
                  </button>
                </div>
              </div>
            )}

            <div className="row-flex">
              <div className="field">
                <label>模型</label>
                <SuggestionInput
                  value={s.ai.model}
                  onChange={(v) => updateAI({ model: v })}
                  options={[...new Set([...models, ...preset.suggestedModels, s.ai.model].filter(Boolean))]}
                  placeholder={preset.defaultModel}
                  ariaLabel="模型名称"
                />
              </div>
              <div className="field" style={{ maxWidth: 142 }}>
                <label>温度</label>
                <NumberField value={s.ai.temperature} min={0} max={2} step={0.1} precision={1} onChange={(v) => updateAI({ temperature: v })} ariaLabel="Temperature" />
              </div>
            </div>

            <div className="field">
              <label>语义检索模型（embedding）</label>
              <SuggestionInput
                value={s.ai.embeddingModel || defaultEmbeddingModel(s.ai.provider)}
                onChange={(v) => updateAI({ embeddingModel: v })}
                options={[...new Set([defaultEmbeddingModel(s.ai.provider), 'text-embedding-v3', 'text-embedding-3-small', 'nomic-embed-text'].filter(Boolean))]}
                placeholder={defaultEmbeddingModel(s.ai.provider) || '当前服务商没有默认 embedding 模型'}
                ariaLabel="语义检索模型"
              />
              <div className="hint">搜索面板的「语义」模式用它建立本机索引；Anthropic / 演示模式不支持向量检索。</div>
            </div>

            <div className="field">
              <label>封面生图模型</label>
              <SuggestionInput
                value={s.ai.imageModel || defaultImageModel(s.ai.provider)}
                onChange={(v) => updateAI({ imageModel: v })}
                options={[...new Set([defaultImageModel(s.ai.provider), 'qwen-image-3.0-pro', 'gpt-image-1'].filter(Boolean))]}
                placeholder={defaultImageModel(s.ai.provider) || '当前服务商没有默认生图模型'}
                ariaLabel="封面生图模型"
              />
              <div className="hint">只用于「生成封面」；图内不放中文，封面会存到 vault 的 assets/covers。</div>
            </div>

            <div className="field">
              <label>上下文预算</label>
              <Slider
                value={s.ai.contextChars || 6000}
                min={2000}
                max={16000}
                step={1000}
                onChange={(v) => updateAI({ contextChars: v })}
                format={(v) => `${Math.round(v / 1000)}k 字`}
                ariaLabel="上下文预算"
              />
              <div className="hint">每次请求最多带入的正文/相关笔记字数，越大越准，也越贵。</div>
            </div>

            <div className="field">
              <label>每日字符预算</label>
              <input
                type="number"
                min={0}
                step={5000}
                value={s.ai.dailyCharBudget || 0}
                onChange={(e) => updateAI({ dailyCharBudget: Math.max(0, Number(e.target.value) || 0) })}
                aria-label="每日字符预算"
              />
              <div className="hint">输入 + 输出字符总数；0 表示不限制。超出后所有文本 AI 入口会被拦下，图片不受影响。</div>
            </div>

            <div className="settings-note">
              本机累计：{state.aiUsage.calls} 次调用 · 输入 {(state.aiUsage.inputChars / 1000).toFixed(1)}k 字符 · 输出{' '}
              {(state.aiUsage.outputChars / 1000).toFixed(1)}k 字符
            </div>
            <div className="settings-note">
              今日：{state.aiUsageDay.chars.toLocaleString()} 字符
              {s.ai.dailyCharBudget ? ` / ${s.ai.dailyCharBudget.toLocaleString()}` : ' · 未设上限'} · {state.aiUsageDay.calls} 次
              <button style={{ marginLeft: 8, color: 'var(--brand)', fontWeight: 800 }} onClick={() => vault.resetAiUsageToday()}>
                清零今日
              </button>
            </div>

            <div className="ai-ledger">
              <div className="ai-ledger-head">
                <b>费用估算</b>
                <span>今日 {money(costToday)} · 本月 {money(costMonth)} · 累计 {money(costTotal)}</span>
              </div>
              {byModel.length ? (
                <div className="ai-ledger-rows">
                  {byModel.slice(0, 6).map((row) => (
                    <div key={row.model} className="ai-ledger-row">
                      <span className="ai-ledger-model" title={row.model}>{row.model}</span>
                      <small>
                        {row.calls} 次{row.images ? ` · ${row.images} 张图` : ''}
                      </small>
                      <b>{money(row.cost)}</b>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="ai-ledger-empty">还没有费用记录。启用 AI 后的文本、embedding 和图片调用会按内置单价估算。</div>
              )}
              <div className="hint">
                单价：qwen3.8-flash 输入 ¥0.8 / 输出 ¥2.7 每百万 token；qwen-image-3.0-pro ¥0.25/1K 张、¥0.5/2K 张，编辑另计输入 ¥0.02/张；text-embedding-v3 ¥0.514/百万 token。按字符估算，实际以百炼账单为准。
              </div>
              <button className="tbtn" onClick={() => vault.resetAiLedger()} disabled={!ledger.length}>
                清零账本
              </button>
            </div>

            <div className="row-flex" style={{ gap: 8 }}>
              <button className="tbtn" onClick={() => void runTest()} disabled={testing}>
                {testing ? '测试中…' : '测试连接'}
              </button>
              <button className="tbtn" onClick={() => void refreshModels()} disabled={modelsBusy || isDemo}>
                {modelsBusy ? '读取中…' : models.length ? `刷新模型（${models.length}）` : '刷新模型列表'}
              </button>
            </div>

            {models.length > 0 && (
              <div className="settings-note" style={{ maxHeight: 120, overflowY: 'auto' }}>
                可用模型：{models.slice(0, 80).join(' · ')}
                {models.length > 80 ? ' …' : ''}
              </div>
            )}
            {modelsError && (
              <div className="settings-note" style={{ color: 'var(--coral-strong)' }}>
                {modelsError}
              </div>
            )}
            {testResult && (
              <div className="settings-note" style={{ color: testResult.ok ? 'var(--mint-strong)' : 'var(--coral-strong)' }}>
                {testResult.msg}
              </div>
            )}
          </div>

          <div className={`settings-group${section === 'memory' ? ' on' : ''}`} data-section="memory">
            <h4>墨墨的记忆</h4>
            <div className="settings-note" style={{ marginBottom: 8 }}>
              只存你主动写下的偏好与目标，本机保存、可见可删；AI 会用它调整语气和取舍，不当作事实引用。
            </div>
            <div className="memory-list">
              {!memories.length && <span className="memory-empty">还没有记忆。比如「解释时先给结论」。</span>}
              {memories.map((m) => (
                <span className="memory-chip" key={m.id}>
                  {m.text}
                  <button type="button" onClick={() => removeMemory(m.id)} aria-label="删除这条记忆"><Icon name="close" size={11} /></button>
                </span>
              ))}
            </div>
            <div className="row-flex" style={{ gap: 6, marginTop: 8 }}>
              <input
                className="settings-input"
                value={memoryText}
                onChange={(e) => setMemoryText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    addMemory(memoryText)
                    setMemoryText('')
                  }
                }}
                placeholder="例如：解释概念时先给一句话结论"
                aria-label="新增记忆"
              />
              <button
                className="tbtn"
                type="button"
                disabled={!memoryText.trim()}
                onClick={() => { addMemory(memoryText); setMemoryText('') }}
              >
                添加
              </button>
            </div>
          </div>

          <div className={`settings-group${section === 'data' ? ' on' : ''}`} data-section="data">
            <h4>数据</h4>
            {isTauri && (
              <div className="field">
                <label>保存位置</label>
                <div className="row-flex" style={{ gap: 6 }}>
                  <input
                    className="settings-input"
                    value={vaultPath}
                    onChange={(e) => setVaultPath(e.target.value)}
                    placeholder="/Users/you/Documents/Inkspire"
                    aria-label="保存位置"
                  />
                  <button
                    className="tbtn primary"
                    type="button"
                    onClick={async () => {
                      const target = vaultPath.trim()
                      if (!target) {
                        const ok = await confirmDialog({
                          title: '恢复默认保存位置',
                          message: '将改回 ~/Documents/Inkspire，并重新加载。旧目录里的文档不会被移动。',
                          confirmText: '恢复并重载',
                        })
                        if (ok) await vault.setVaultPath('')
                        return
                      }
                      const ok = await confirmDialog({
                        title: '切换保存位置',
                        message: `将从 ${target} 读取文档并重新加载。旧目录不会自动搬移，请先确认新目录存在或允许创建。`,
                        confirmText: '切换并重载',
                      })
                      if (ok) await vault.setVaultPath(target)
                    }}
                  >
                    应用
                  </button>
                </div>
                <div className="hint">输入绝对路径；留空 = ~/Documents/Inkspire。切换后自动重载，不会自动搬移旧文档。</div>
              </div>
            )}
            {isTauri && state.vaultRoot && (
              <div className="settings-note" style={{ marginBottom: 10 }}>
                桌面 vault：<b style={{ color: 'var(--ink)' }}>{state.vaultRoot}</b>
                <div style={{ marginTop: 6 }}>
                  <button className="tbtn" onClick={() => void platform.revealVault()}>在 Finder 中打开</button>
                </div>
              </div>
            )}
            <div className="row-flex">
              <button className="tbtn" onClick={() => void vault.exportBackup()}>
                <Icon name="download" size={15} /> 导出全部数据
              </button>
              <label className="tbtn" style={{ textAlign: 'center' }}>
                <Icon name="upload" size={15} /> 导入备份
                <input
                  type="file"
                  accept="application/json"
                  style={{ display: 'none' }}
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    try {
                      const data = JSON.parse(await file.text())
                      if (!Array.isArray(data.docs)) throw new Error('备份文件格式不正确')
                      const ok = await confirmDialog({
                        title: '恢复备份',
                        message: `将用备份中的 ${data.docs.length} 篇文档覆盖当前数据，此操作不可撤销。`,
                        confirmText: '覆盖恢复',
                        danger: true,
                      })
                      if (!ok) return
                      await vault.importBackup(data)
                      onClose()
                    } catch (err: any) {
                      vault.flash(`导入失败：${err.message}`, 'error')
                    }
                  }}
                />
              </label>
            </div>
            <div className="row-flex" style={{ marginTop: 8 }}>
              <button
                className="tbtn"
                onClick={() => {
                  const n = clearAICache()
                  vault.flash(n ? `已清理 ${n} 条 AI 结果缓存` : '没有需要清理的 AI 缓存', 'success')
                }}
              >
                清理 AI 结果缓存
              </button>
            </div>
            <div className="settings-note">
              {isTauri
                ? '桌面版：文档以纯 .md 文件保存在你的 vault 目录，收藏与版本快照缓存在本机；恢复备份会直接写回 vault。建议把 vault 交给 Git 或 iCloud 同步。'
                : '浏览器预览：文档保存在 IndexedDB 中，恢复备份只影响当前浏览器。建议定期导出备份，或使用桌面版把内容落成磁盘上的 .md。'}
            </div>
          </div>

          <div className={`settings-group${section === 'about' ? ' on' : ''}`} data-section="about">
            <h4>关于</h4>
            <div style={{ fontSize: 12, lineHeight: 1.9, color: 'var(--ink-soft)' }}>
              Inkspire v0.1 · 用墨点燃灵感的地方
              <br />
              技术栈：React + TypeScript + CodeMirror 6（浏览器本地优先；同一套 UI 可套 Tauri 壳成为桌面端）
              <br />
              IP：墨墨 Momo · 数据：全部留在你的设备上
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>设置会立即生效并持久保存</span>
          <div className="right">
            <button className="tbtn primary" onClick={onClose}>
              完成
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
