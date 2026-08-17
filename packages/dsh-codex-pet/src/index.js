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

/** Services required before the pet can mount its routes. */
export const inject = ['webServer']

/** Register the pet service and its API + asset routes on the context. */
export function apply(ctx, config = {}) {
  const registry = config.registry ?? loadPetRegistry({
    packageRoot: petPackageRoot(import.meta.url),
  })
  const service = new PetService({ ...config, registry })
  const routes = makeCodexPetRoutes({ service })

  // cordis ctx.effect runs its callback immediately and treats the returned
  // function as the fiber disposer, so the routes unregister on dispose.
  ctx.effect(() => {
    const disposers = routes.map((route) => ctx.webServer.register(route))
    return () => { for (const dispose of disposers) dispose() }
  }, 'codex-pet: routes')
}

export { loadPetRegistry, petPackageRoot, petEntryView, userPetsDir } from './registry.js'
export { PetService, persistPath } from './service.js'
export { makeCodexPetRoutes, PET_API_PREFIX, PET_ASSET_PREFIX } from './routes.js'
