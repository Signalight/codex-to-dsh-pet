/**
 * dsh-codex-pet host half — builds the Codex atlas pet registry once at
 * startup and mounts the '/api/codex-pet/*' JSON API plus the '/codex-pet/<id>/*'
 * asset routes on the DSH web server. The browser half (the './client' export)
 * renders the selected pet, drives it through those same-origin endpoints, and
 * seats a settings section that edits them directly. Adding a pet means
 * dropping a <pet>/pet.json + <pet>/spritesheet.webp into assets/ or
 * ~/.dsh/pets — never touching host or client code.
 * @module dsh-codex-pet
 */

import { loadPetRegistry, petPackageRoot } from './registry.js'
import { PetService } from './service.js'
import { makeCodexPetRoutes, PET_API_PREFIX, PET_ASSET_PREFIX } from './routes.js'

/** Stable cordis plugin name (matches cordis.patch.yml insert id). */
export const name = 'codex-pet'

/**
 * The web server is required to mount the base pet. LLM is optional because
 * summary routes report a clear error when an adapter is not installed.
 */
export const inject = ['webServer']

/** Register the pet service and its API + asset routes on the context. */
export function apply(ctx, config = {}) {
  const registry = config.registry ?? loadPetRegistry({
    packageRoot: petPackageRoot(import.meta.url),
  })
  const service = new PetService({ ...config, registry, packageRoot: petPackageRoot(import.meta.url) })
  // Optional services are resolved through Cordis rather than a fiber property.
  const getLlm = () => config.llm ?? ctx.get('llm') ?? null
  const routes = makeCodexPetRoutes({ service, getLlm })

  // cordis ctx.effect runs its callback immediately and treats the returned
  // function as the fiber disposer, so the routes unregister on dispose.
  ctx.effect(() => {
    const disposers = routes.map((route) => ctx.webServer.register(route))
    return () => { for (const dispose of disposers) dispose() }
  }, 'codex-pet: routes')

  // Scenario voice lines: pulse on step/turn errors. User interrupts are NOT
  // visible here — the agent loop never dispatches agent/turn-stopping on an
  // abort (it throws into the catch before the dispatch), so the browser half
  // detects them from the conversation snapshot instead.
  ctx.effect(() => {
    const offError = ctx.on('agent/error', ({ agent }) => service.pulse('error', agent.id))
    return () => { offError?.() }
  }, 'codex-pet: scenario-events')
}

export { loadPetRegistry, petPackageRoot, petEntryView, userPetsDir } from './registry.js'
export { PetService, persistPath, userSoundsDir, SUMMARY_TIMEOUT_MS } from './service.js'
export { makeCodexPetRoutes, PET_API_PREFIX, PET_ASSET_PREFIX, SOUND_ROUTE } from './routes.js'
