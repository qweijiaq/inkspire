export interface ConfirmOptions {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

let listener: ((req: Pending) => void) | null = null
let queue: Pending[] = []

export function setConfirmListener(fn: ((req: Pending) => void) | null) {
  listener = fn
  if (fn && queue.length) {
    const pending = queue
    queue = []
    pending.forEach((p) => fn(p))
  }
}

/** 手写确认弹窗，替代 window.confirm */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const req: Pending = { ...options, resolve }
    if (listener) listener(req)
    else queue.push(req)
  })
}
