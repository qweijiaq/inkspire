import { useSyncExternalStore } from 'react'
import { vault } from './lib/vault'
import type { VaultState } from './lib/vault'

export function useVault(): VaultState {
  return useSyncExternalStore(vault.subscribe, vault.getSnapshot, vault.getSnapshot)
}

export { vault }
