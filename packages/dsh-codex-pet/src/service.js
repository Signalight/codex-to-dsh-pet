/**
 * Pet service — owns the persisted selection + display config and exposes the
 * read/update methods the JSON routes call. State persists to
 * '${DSH_HOME:-~/.dsh}/codex-pet.json' so a drag or resize survives a restart.
 * @module dsh-codex-pet/service
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectImageExt, detectSpriteVersion, dshHome, petEntryView, resolvePetManifest, userPetsDir } from './registry.js'

const PERSIST_FILE = 'codex-pet.json'
const DEFAULT_DISPLAY = {
  visible: true,
  size: 120,
  pin: 'bottom-right',
  left: null,
  top: null,
  bubbleTheme: 'gray',
  bubbleOpacity: 94,
  // v2 atlases only: the pet's eyes track the pointer (the 16 "look" cells).
  // v1 atlases have no look cells, so this setting has no effect on them.
  mouseTracking: true,
}

export function persistPath(env = process.env) {
  return join(dshHome(env), PERSIST_FILE)
}

export class PetService {
  constructor({ registry, env = process.env }) {
    this.registry = registry
    this.file = persistPath(env)
    this.petsDir = userPetsDir(env)
    // NOTE: keep the persisted snapshot off the name "state" — `state` is also
    // the read method, and an instance property would shadow it.
    this.persist = this.load()
    if (!registry.byId(this.persist.petId)) {
      const fallback = registry.defaultEntry()
      this.persist.petId = fallback ? fallback.id : null
    }
  }

  load() {
    const base = { petId: null, display: { ...DEFAULT_DISPLAY } }
    if (!existsSync(this.file)) return base
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
      const display = { ...DEFAULT_DISPLAY, ...(parsed.display || {}) }
      return {
        petId: typeof parsed.petId === 'string' ? parsed.petId : null,
        display,
      }
    } catch {
      return base
    }
  }

  save() {
    try {
      writeFileSync(this.file, JSON.stringify(this.persist, null, 2) + '\n', 'utf8')
    } catch (error) {
      console.warn('[dsh-codex-pet] could not persist state:', error)
    }
  }

  pets() {
    return this.registry.entries.map(petEntryView)
  }

  state() {
    const entry = this.registry.byId(this.persist.petId)
    return {
      petId: this.persist.petId,
      display: this.persist.display,
      pet: entry ? petEntryView(entry) : null,
      pets: this.pets(),
    }
  }

  setPetId(petId) {
    if (typeof petId !== 'string' || !this.registry.byId(petId)) throw new Error('invalid-pet')
    this.persist.petId = petId
    this.save()
    return this.state()
  }

  setConfig(patch) {
    const d = this.persist.display
    if (typeof patch.size === 'number') d.size = Math.max(32, Math.min(512, Math.round(patch.size)))
    if (typeof patch.pin === 'string') d.pin = patch.pin
    if (typeof patch.left === 'number') d.left = Math.max(0, Math.round(patch.left))
    if (typeof patch.top === 'number') d.top = Math.max(0, Math.round(patch.top))
    if (typeof patch.visible === 'boolean') d.visible = patch.visible
    if (typeof patch.mouseTracking === 'boolean') d.mouseTracking = patch.mouseTracking
    if (typeof patch.bubbleTheme === 'string') d.bubbleTheme = patch.bubbleTheme
    if (typeof patch.bubbleOpacity === 'number') d.bubbleOpacity = Math.max(0, Math.min(100, Math.round(patch.bubbleOpacity)))
    this.save()
    return this.state()
  }

  setVisible(visible) {
    if (typeof visible !== 'boolean') throw new Error('invalid-visible')
    this.persist.display.visible = visible
    this.save()
    return this.state()
  }

  /**
   * Import one uploaded Codex atlas: derive a filesystem-safe kebab id (from
   * the raw id or a generated fallback), keep the display name as-is (Chinese
   * allowed), save the spritesheet + pet.json, register and select it.
   *
   * The id never silently reuses an existing one: re-importing the same pet
   * (same id AND an explicitly typed display name) updates that pet in place,
   * while any other collision gets a unique '-2' / '-3' suffix. Codex atlases
   * all ship as 'spritesheet.webp', so without this every import would
   * overwrite the previous one's folder.
   */
  importPet(rawId, displayName, buffer) {
    const base = String(rawId || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || ('pet-' + Date.now().toString(36))
    if (!/^[a-z0-9][a-z0-9-]*$/.test(base)) throw new Error('invalid-id')
    const typedName = String(displayName || '').trim().slice(0, 80)
    const name = typedName || base
    if (!buffer || buffer.length === 0) throw new Error('empty-file')
    const ext = detectImageExt(buffer)
    if (ext === null) throw new Error('unsupported-image (use .webp/.png/.gif)')
    const version = detectSpriteVersion(buffer)
    if (version === null) throw new Error('not-a-codex-atlas (expected 1536x1872 v1 or 1536x2288 v2)')

    // Update-in-place only when the user re-imports the same pet on purpose
    // (same id and the same explicitly typed name); any other collision gets a
    // fresh suffixed id so previously imported pets are never overwritten.
    const existing = this.registry.byId(base)
    const isUpdate = existing !== undefined && typedName !== '' && existing.displayName === typedName
    let id = base
    let n = 2
    while (!isUpdate && (this.registry.byId(id) || existsSync(join(this.petsDir, id)))) {
      id = base + '-' + n
      n += 1
    }

    const dir = join(this.petsDir, id)
    mkdirSync(dir, { recursive: true })
    const file = 'spritesheet' + ext
    writeFileSync(join(dir, file), buffer)
    const manifest = { id, displayName: name, spritesheetPath: file, spriteVersionNumber: version }
    writeFileSync(join(dir, 'pet.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')

    const entry = resolvePetManifest(manifest, dir, { assetPrefix: '/codex-pet' })
    if (entry === undefined) throw new Error('manifest-invalid')
    this.registry.add(entry)
    this.persist.petId = id
    this.save()
    return this.state()
  }

  /**
   * Apply a resolved settings-section value back into the persisted runtime
   * state (visible / mouseTracking / size / pin / petId). Changing the pin
   * clears any dragged left/top so the new corner takes effect immediately.
   */
  applySettingsSection(section) {
    if (!section || typeof section !== 'object') return
    const d = this.persist.display
    if (typeof section.visible === 'boolean') d.visible = section.visible
    if (typeof section.mouseTracking === 'boolean') d.mouseTracking = section.mouseTracking
    if (typeof section.size === 'number') d.size = Math.max(32, Math.min(512, Math.round(section.size)))
    if (typeof section.pin === 'string') {
      if (d.pin !== section.pin) {
        d.pin = section.pin
        d.left = null
        d.top = null
      }
    }
    if (typeof section.petId === 'string' && this.registry.byId(section.petId)) {
      this.persist.petId = section.petId
    }
    this.save()
  }
}
