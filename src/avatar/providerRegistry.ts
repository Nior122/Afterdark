/**
 * Provider registry.
 *
 * The UI only ever renders what `listProviders()` returns, and each entry reports its
 * own availability, privacy class and cost. That means adding or removing a backend is
 * a one-line change here and the interface stays honest — a provider that needs an
 * $800/month plan or a GPU server simply does not appear as a choice.
 */
import type { AvatarProvider } from './types'
import { createLocalFitProvider } from './providers/localFit'
import { createAvaturnProvider } from './providers/avaturn'
import { createLamProvider } from './providers/lam'

export type { AvatarProvider, AvatarAsset, AvatarRequest, ProgressReport, PrivacyClass, CostClass } from './types'

export interface ProviderRegistry {
  all: AvatarProvider[]
  byId: (id: string) => AvatarProvider | undefined
  /** Provider ids whose availability check passed. */
  available: () => Promise<{ provider: AvatarProvider; reason?: string }[]>
}

let registry: ProviderRegistry | null = null

/**
 * Build the registry. `textureSize` follows the quality setting so Lite mode does not
 * spend 1024x1024 of rasterisation on a device that is already struggling.
 */
export function getProviders(textureSize = 1024): ProviderRegistry {
  if (registry) return registry

  const all: AvatarProvider[] = [
    createLocalFitProvider({ textureSize }),
    createAvaturnProvider(),
    createLamProvider(),
  ]

  registry = {
    all,
    byId: (id) => all.find((p) => p.id === id),
    available: async () => {
      const out: { provider: AvatarProvider; reason?: string }[] = []
      for (const provider of all) {
        const availability = provider.availability ? await provider.availability() : { ready: true as const }
        if (availability.ready) out.push({ provider })
        else out.push({ provider, reason: availability.reason })
      }
      return out
    },
  }
  return registry
}

/** Reset the cache — used when the quality setting changes the texture size. */
export function resetProviders(): void {
  registry = null
}

export const DEFAULT_PROVIDER_ID = 'local-fit'
