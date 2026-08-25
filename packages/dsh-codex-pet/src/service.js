/**
 * Pet service — owns the persisted selection + display config and exposes the
 * read/update methods the JSON routes call. State persists to
 * '${DSH_HOME:-~/.dsh}/codex-pet.json' so a drag or resize survives a restart.
 *
 * Two feature sections live beside the original display config:
 * - summary: periodic model-request summaries (interval, model route, bubble).
 * - sound:   the task-finished chime (enabled/volume); the audio file itself
 *            lives on disk ('~/.dsh/pets/sounds/done.*' overrides the built-in
 *            assets/sounds/done.wav) so users can replace it freely.
 * @module dsh-codex-pet/service
 */

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
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

/** Periodic request-summary defaults. A route must be selected before enabling. */
const DEFAULT_SUMMARY = {
  enabled: false,
  intervalRequests: 5,
  provider: '',
  model: '',
  maxChars: 220,
  bubbleSeconds: 12,
}

/** Scenario voice defaults; volume is 0..100. */
const DEFAULT_SOUND = {
  enabled: true,
  volume: 60,
  // Per-scenario switches and relative volume (final = master × track).
  tracks: {
    done: { enabled: true, volume: 100 },
    error: { enabled: true, volume: 100 },
    interrupt: { enabled: true, volume: 100 },
  },
}

/** User-replaceable chime directory: '${DSH_HOME:-~/.dsh}/pets/sounds'. */
export function userSoundsDir(env = process.env) {
  return join(dshHome(env), 'pets', 'sounds')
}

const SOUND_EXTS = ['.wav', '.mp3', '.ogg', '.m4a', '.flac', '.webm']
/** Scenario tracks that can each carry an override file and their own volume. */
const TRACK_IDS = ['done', 'error', 'interrupt']

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback
}

/** Normalize one untrusted summary section into the persisted shape. */
function sanitizeSummary(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const interval = src.intervalRequests ?? src.intervalTurns
  const provider = typeof src.provider === 'string' ? src.provider.trim().slice(0, 120) : ''
  const model = typeof src.model === 'string' ? src.model.trim().slice(0, 160) : ''
  return {
    enabled: src.enabled === true && provider !== '' && model !== '',
    intervalRequests: clampInt(interval, 1, 50, DEFAULT_SUMMARY.intervalRequests),
    provider,
    model,
    maxChars: clampInt(src.maxChars, 60, 800, DEFAULT_SUMMARY.maxChars),
    bubbleSeconds: clampInt(src.bubbleSeconds, 3, 120, DEFAULT_SUMMARY.bubbleSeconds),
  }
}

/** Normalize one untrusted sound section into the persisted shape. */
function sanitizeSound(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  // Per-scenario tracks; the legacy "events" toggles migrate onto switches.
  const rawTracks = src.tracks && typeof src.tracks === 'object' ? src.tracks : {}
  const rawEvents = src.events && typeof src.events === 'object' ? src.events : {}
  const tracks = {}
  for (const id of TRACK_IDS) {
    const raw = rawTracks[id] && typeof rawTracks[id] === 'object' ? rawTracks[id] : {}
    const legacyEnabled = rawEvents[id] !== undefined ? rawEvents[id] !== false : undefined
    tracks[id] = {
      enabled: raw.enabled !== undefined ? raw.enabled !== false : (legacyEnabled !== undefined ? legacyEnabled : true),
      volume: clampInt(raw.volume, 0, 100, 100),
    }
  }
  return {
    enabled: src.enabled !== false,
    volume: clampInt(src.volume, 0, 100, DEFAULT_SOUND.volume),
    tracks,
  }
}

export function persistPath(env = process.env) {
  return join(dshHome(env), PERSIST_FILE)
}

export class PetService {
  constructor({ registry, env = process.env, packageRoot }) {
    this.registry = registry
    this.env = env ?? process.env
    this.file = persistPath(this.env)
    this.petsDir = userPetsDir(this.env)
    this.soundsDir = userSoundsDir(this.env)
    // Scenario-event pulses carry their owning session so another tab/session
    // cannot react to an unrelated agent event.
    this.pulses = {
      error: { at: 0, sessionId: '' },
      interrupt: { at: 0, sessionId: '' },
    }
    // Per-session summary journal: one JSONL line per generated summary, so
    // the user can look back at the AI-view project progress any time.
    this.journalDir = join(dshHome(this.env), 'codex-pet-journal')
    this.summaryInflight = new Map()
    // Built-in fallback chime shipped under <packageRoot>/assets/sounds/.
    this.builtInSoundDir = packageRoot ? join(packageRoot, 'assets', 'sounds') : null
    // NOTE: keep the persisted snapshot off the name "state" — `state` is also
    // the read method, and an instance property would shadow it.
    this.persist = this.load()
    if (!registry.byId(this.persist.petId)) {
      const fallback = registry.defaultEntry()
      this.persist.petId = fallback ? fallback.id : null
    }
  }

  load() {
    const base = { petId: null, display: { ...DEFAULT_DISPLAY }, summary: { ...DEFAULT_SUMMARY }, sound: { ...DEFAULT_SOUND } }
    if (!existsSync(this.file)) return base
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
      return {
        petId: typeof parsed.petId === 'string' ? parsed.petId : null,
        display: { ...DEFAULT_DISPLAY, ...(parsed.display || {}) },
        summary: sanitizeSummary(parsed.summary),
        sound: sanitizeSound(parsed.sound),
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

  /** The user-uploaded override ('<track>.<ext>') for one track, or null. */
  customSoundFile(track = 'done') {
    if (!TRACK_IDS.includes(track)) return null
    if (!existsSync(this.soundsDir)) return null
    let names = []
    try { names = readdirSync(this.soundsDir) } catch { return null }
    for (const ext of SOUND_EXTS) {
      if (names.includes(track + ext)) {
        const file = join(this.soundsDir, track + ext)
        if (existsSync(file)) return file
      }
    }
    return null
  }

  /**
   * Store one uploaded track override. Any other extension of the same track
   * is removed so exactly one override per track exists at a time.
   */
  saveSound(buffer, track = 'done') {
    if (!TRACK_IDS.includes(track)) throw new Error('unknown-track')
    const ext = detectAudioExt(buffer)
    if (ext === null) throw new Error('unsupported-audio (use .wav/.mp3/.ogg/.m4a/.flac/.webm)')
    if (!buffer || buffer.length === 0) throw new Error('empty-file')
    if (buffer.length > 8 * 1024 * 1024) throw new Error('file-too-large (max 8MB)')
    mkdirSync(this.soundsDir, { recursive: true })
    for (const other of SOUND_EXTS) {
      if (other !== ext) rmSync(join(this.soundsDir, track + other), { force: true })
    }
    writeFileSync(join(this.soundsDir, track + ext), buffer)
    return this.state()
  }

  /** Remove one track's override; the built-in audio takes over again. */
  resetSound(track = 'done') {
    if (!TRACK_IDS.includes(track)) throw new Error('unknown-track')
    for (const ext of SOUND_EXTS) rmSync(join(this.soundsDir, track + ext), { force: true })
    return this.state()
  }

  /** Record a scenario event so the next state poll plays its voice line. */
  pulse(kind, sessionId = '') {
    if (kind !== 'error' && kind !== 'interrupt') return
    const previous = this.pulses[kind].at
    this.pulses[kind] = {
      at: Math.max(Date.now(), previous + 1),
      sessionId: typeof sessionId === 'string' ? sessionId : '',
    }
  }

  /**
   * Resolve a scenario track's audio file: the user override first, then the
   * built-in takes ('<track>-1.wav' …) rotating randomly so repeated triggers
   * vary, then the plain legacy '<track>.<ext>' file.
   */
  trackFile(track) {
    if (!TRACK_IDS.includes(track)) return null
    const custom = this.customSoundFile(track)
    if (custom) return custom
    if (this.builtInSoundDir) {
      const takes = readdirSyncSafe(this.builtInSoundDir)
        .filter((name) => name.startsWith(track + '-') && SOUND_EXTS.some((ext) => name.endsWith(ext)))
      if (takes.length) {
        return join(this.builtInSoundDir, takes[Math.floor(Math.random() * takes.length)])
      }
    }
    for (const ext of SOUND_EXTS) {
      const file = this.builtInSoundDir && join(this.builtInSoundDir, track + ext)
      if (file && existsSync(file)) return file
    }
    return null
  }

  /** Journal file for one exact session id, hashed for filesystem safety. */
  journalFileFor(sessionId) {
    const id = requireSessionId(sessionId)
    return join(this.journalDir, createHash('sha256').update(id).digest('hex') + '.jsonl')
  }

  /** Append one summary record to the session's JSONL journal. */
  appendJournal(record) {
    requireSessionId(record && record.sessionId)
    mkdirSync(this.journalDir, { recursive: true })
    appendFileSync(this.journalFileFor(record.sessionId), JSON.stringify(record) + '\n', 'utf8')
  }

  /** Latest journal records for one session, newest first. */
  journalList(sessionId, limit = 50) {
    const records = this.journalRecords(sessionId)
    return records.slice(-clampInt(limit, 1, 200, 50)).reverse()
  }

  /** All journal records for one session in append order. */
  journalRecords(sessionId) {
    const file = this.journalFileFor(sessionId)
    if (!existsSync(file)) return []
    const records = []
    const lines = readFileSync(file, 'utf8').split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      if (!line) continue
      try {
        records.push(JSON.parse(line))
      } catch {
        throw new Error('journal-invalid-jsonl:' + file + ':' + (index + 1))
      }
    }
    return records
  }

  state() {
    const entry = this.registry.byId(this.persist.petId)
    return {
      petId: this.persist.petId,
      display: this.persist.display,
      summary: this.persist.summary,
      sound: this.persist.sound,
      pet: entry ? petEntryView(entry) : null,
      pets: this.pets(),
      hasCustomSounds: {
        done: this.customSoundFile('done') !== null,
        error: this.customSoundFile('error') !== null,
        interrupt: this.customSoundFile('interrupt') !== null,
      },
      pulses: { ...this.pulses },
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
    if (patch.summary && typeof patch.summary === 'object') {
      this.persist.summary = sanitizeSummary({ ...this.persist.summary, ...patch.summary })
    }
    if (patch.sound && typeof patch.sound === 'object') {
      const tracks = patch.sound.tracks && typeof patch.sound.tracks === 'object'
        ? { ...this.persist.sound.tracks, ...patch.sound.tracks }
        : this.persist.sound.tracks
      this.persist.sound = sanitizeSound({ ...this.persist.sound, ...patch.sound, tracks })
    }
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
   * Summarize one batch of completed assistant model requests through the configured LLM route.
   * The browser half assembles the transcript from its live conversation
   * snapshot (the same data the native trajectory view reads); this side only
   * frames the auxiliary call. Both summary.provider and summary.model must
   * be explicitly selected before the feature can run.
   */
  async summarizeRequests(llm, payload) {
    const { sessionId, fromRequestSeq, toRequestSeq, requests } = validateSummaryPayload(payload)
    const existing = this.journalRecords(sessionId).find((record) => (
      record.sessionId === sessionId
      && record.fromRequestSeq === fromRequestSeq
      && record.toRequestSeq === toRequestSeq
    ))
    if (existing) return summaryResult(existing)
    const cfg = this.persist.summary
    if (cfg.enabled !== true) throw new Error('summary-disabled')
    const key = JSON.stringify([sessionId, fromRequestSeq, toRequestSeq])
    const inFlight = this.summaryInflight.get(key)
    if (inFlight) return inFlight
    const run = async () => {
      const route = await resolveSummaryRoute(llm, cfg)
      const framed = '请根据以下 JSON 记录，总结这个 AI 编码助手刚完成的批次（每条记录是一次模型请求的关键动作）：\n' + JSON.stringify(requests)
      const messages = [createUserTextMessage(framed)]
      const text = await streamText(llm, {
        provider: route.provider,
        model: route.model,
        messages,
        system: SUMMARY_SYSTEM_PROMPT,
        maxTokens: 512,
        signal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS),
      })
      const trimmed = text.trim().slice(0, cfg.maxChars)
      if (trimmed.length === 0) throw new Error('summary-model-produced-no-text')
      const record = {
        sessionId,
        fromRequestSeq,
        toRequestSeq,
        requestCount: requests.length,
        provider: route.provider,
        model: route.model,
        summary: trimmed,
        createdAt: new Date().toISOString(),
      }
      this.appendJournal(record)
      return summaryResult(record)
    }
    const promise = run()
    this.summaryInflight.set(key, promise)
    promise.then(() => this.summaryInflight.delete(key), () => this.summaryInflight.delete(key))
    return promise
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

/** Aux-call deadline: bounded so a stuck provider cannot hold the HTTP request. */
export const SUMMARY_TIMEOUT_MS = 90_000

const SUMMARY_SYSTEM_PROMPT = [
  '你是桌宠形态的 AI 编码助手本人。输入的 JSON 是你刚完成的一批模型请求的结构化记录（用户指令摘要、你自己的动作、工具调用序列、错误信息）。',
  '请用第一人称向主人播报这批请求的进展：我做了什么、用了哪些关键工具、有没有遇到错误。',
  '要求：使用第一人称"我"；只输出播报正文本身；不超过 100 字；语气自然口语化、像桌宠在说话；不要标题、编号、Markdown 或任何解释。',
].join('\n')

/** Validate one browser-supplied summary request. */
function validateSummaryPayload(payload) {
  const body = payload && typeof payload === 'object' ? payload : {}
  const sessionId = requireSessionId(body.sessionId)
  const { fromRequestSeq, toRequestSeq } = body
  if (!Number.isSafeInteger(fromRequestSeq) || !Number.isSafeInteger(toRequestSeq) || fromRequestSeq < 0 || toRequestSeq < fromRequestSeq) throw new Error('invalid-request-range')
  if (!Array.isArray(body.requests) || body.requests.length === 0 || body.requests.length > 50) throw new Error('invalid-requests')
  let previousSeq = fromRequestSeq - 1
  const requests = body.requests.map((request) => {
    if (!request || typeof request !== 'object') throw new Error('invalid-request-record')
    if (!Number.isSafeInteger(request.requestSeq) || request.requestSeq < fromRequestSeq || request.requestSeq > toRequestSeq || request.requestSeq <= previousSeq) {
      throw new Error('invalid-request-record')
    }
    if (!Number.isSafeInteger(request.turn) || request.turn < 0 || !Number.isSafeInteger(request.step) || request.step < 1) throw new Error('invalid-request-record')
    previousSeq = request.requestSeq
    const actions = Array.isArray(request.actions) ? request.actions.slice(0, 80) : []
    return {
      requestSeq: request.requestSeq,
      turn: request.turn,
      step: request.step,
      user: typeof request.user === 'string' ? request.user.slice(0, 400) : '',
      assistant: typeof request.assistant === 'string' ? request.assistant.slice(0, 400) : '',
      error: typeof request.error === 'string' ? request.error.slice(0, 200) : '',
      actions: actions.map((a) => ({
        tool: String(a && a.tool ? a.tool : '?').slice(0, 60),
        detail: typeof (a && a.detail) === 'string' ? a.detail.slice(0, 120) : '',
        failed: !!(a && a.failed),
      })),
    }
  })
  if (requests[0].requestSeq !== fromRequestSeq || requests[requests.length - 1].requestSeq !== toRequestSeq) throw new Error('invalid-request-range')
  return { sessionId, fromRequestSeq, toRequestSeq, requests }
}

function requireSessionId(sessionId) {
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) throw new Error('invalid-session-id')
  return sessionId
}

function summaryResult(record) {
  return {
    summary: record.summary,
    provider: record.provider,
    model: record.model,
    fromRequestSeq: record.fromRequestSeq,
    toRequestSeq: record.toRequestSeq,
    requestCount: record.requestCount,
  }
}

/**
 * Pick the explicitly configured LLM route for one aux summary call.
 */
async function resolveSummaryRoute(llm, cfg) {
  if (!cfg.provider || !cfg.model) throw new Error('summary-route-not-configured')
  const providers = llm.listProviders()
  if (providers.length === 0) throw new Error('no-llm-provider-registered')
  const provider = providers.find((item) => item.id === cfg.provider)
  if (!provider) throw new Error('summary-provider-not-found-' + cfg.provider)
  return { provider: provider.id, model: cfg.model }
}

/** One plugin-sourced user message carrying plain text (dsh-llm vocabulary). */
function createUserTextMessage(text) {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'dsh-codex-pet' },
  }
}

/**
 * Run one streaming completion and join its text deltas. Only an explicit stop
 * finish is successful; a truncated iterator must not be journaled as a reply.
 */
async function streamText(llm, options) {
  let text = ''
  let finish = null
  for await (const chunk of llm.stream(options)) {
    if (chunk.type === 'text-delta') text += chunk.text
    else if (chunk.type === 'finish') finish = chunk.reason
  }
  if (!finish) throw new Error('summary-llm-stream-incomplete')
  if (finish.kind !== 'stop') {
    if (finish.kind === 'aborted' || finish.kind === 'error') {
      throw new Error('summary-llm-' + finish.kind + ': ' + ((finish.failure && finish.failure.message) || 'unknown'))
    }
    throw new Error('summary-llm-finish-' + finish.kind)
  }
  return text
}

/** List a directory's file names; [] on any error (missing dir, permissions). */
function readdirSyncSafe(dir) {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/** Detect an audio container from the header bytes, or null. */
function detectAudioExt(buffer) {
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE') return '.wav'
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 3) === 'ID3') return '.mp3'
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return '.mp3'
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'OggS') return '.ogg'
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') return '.m4a'
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'fLaC') return '.flac'
  if (buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return '.webm'
  return null
}
