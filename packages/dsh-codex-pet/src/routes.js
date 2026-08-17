/**
 * Pet HTTP routes — the browser half talks to the host through plain
 * same-origin JSON endpoints ('/api/codex-pet/*') and loads each pet's atlas
 * from the '/codex-pet/<id>/*' asset route (the same pattern as the
 * dsh-web-ui family's '/api/pet' + '/pet/<id>' routes). The asset route is one
 * prefix registration serving every registry entry, so adding a pet never
 * touches route wiring.
 * @module dsh-codex-pet/routes
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { petEntryView } from './registry.js'

export const PET_API_PREFIX = '/api/codex-pet'
export const PET_ASSET_PREFIX = '/codex-pet'

const MANIFEST_FILE = 'pet.json'
const MIME_BY_EXT = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json',
}

function mimeFor(file) {
  const dot = file.lastIndexOf('.')
  if (dot < 0) return 'application/octet-stream'
  return MIME_BY_EXT[file.slice(dot).toLowerCase()] ?? 'application/octet-stream'
}

/** Write one JSON response. */
function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** Require the method or answer 405. */
function requireMethod(req, res, method) {
  if (req.method === method) return true
  json(res, 405, { ok: false, error: 'method-not-allowed' })
  return false
}

/** Read a JSON request body (bounded). */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 64 * 1024) {
        reject(new Error('body-too-large'))
        queueMicrotask(() => req.destroy())
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) { resolve({}); return }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { reject(new Error('invalid-json')) }
    })
    req.on('error', reject)
  })
}

/** Read a raw (binary) request body, bounded. */
function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new Error('file-too-large'))
        queueMicrotask(() => req.destroy())
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** Wrap one async service call as a GET JSON route. */
function getRoute(path, run) {
  return {
    kind: 'exact',
    path,
    handler: (req, res) => {
      if (!requireMethod(req, res, 'GET')) return
      Promise.resolve(run()).then((value) => json(res, 200, value), (error) => {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    },
  }
}

/** Wrap one async service call as a POST JSON route (body passed through). */
function postRoute(path, run) {
  return {
    kind: 'exact',
    path,
    handler: (req, res) => {
      if (!requireMethod(req, res, 'POST')) return Promise.resolve()
      return readJsonBody(req).then((body) => {
        const record = (typeof body === 'object' && body !== null) ? body : {}
        return Promise.resolve(run(record)).then(
          (value) => json(res, 200, value),
          (error) => json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) }),
        )
      }, (error) => {
        json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    },
  }
}

/**
 * The one asset handler behind the '/codex-pet' prefix. Serves exactly the
 * files a manifest declares: pet.json and the declared spritesheet path.
 * Entries without a manifest file get a synthesized pet.json.
 */
function assetHandler(registry) {
  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end()
      return
    }
    let pathname
    try {
      pathname = new URL(req.url ?? '/', 'http://codex-pet.local').pathname
    } catch {
      res.writeHead(400)
      res.end()
      return
    }
    const segments = pathname.split('/').filter((segment) => segment !== '')
    if (segments[0] !== 'codex-pet' || segments[1] === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    let id
    try {
      id = decodeURIComponent(segments[1])
    } catch {
      res.writeHead(400)
      res.end()
      return
    }
    const entry = registry.byId(id)
    if (entry === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    const rest = []
    for (const segment of segments.slice(2)) {
      let decoded
      try {
        decoded = decodeURIComponent(segment)
      } catch {
        res.writeHead(400)
        res.end()
        return
      }
      rest.push(decoded)
    }
    const rel = rest.join('/')
    let file
    let synthesized = false
    if (rest.length === 1 && rest[0] === MANIFEST_FILE) {
      const manifestFile = join(entry.dir, MANIFEST_FILE)
      if (existsSync(manifestFile)) file = manifestFile
      else synthesized = true
    } else if (rest.length > 0 && rel === entry.spritesheetPath) {
      file = join(entry.dir, entry.spritesheetPath)
    }
    if (synthesized) {
      const body = Buffer.from(JSON.stringify(petEntryView(entry), null, 2), 'utf8')
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': String(body.byteLength),
        'cache-control': 'no-cache',
      })
      if (req.method === 'HEAD') { res.end(); return }
      res.end(body)
      return
    }
    if (file === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    readFile(file).then((body) => {
      res.writeHead(200, {
        'content-type': mimeFor(file),
        'content-length': String(body.byteLength),
        'cache-control': 'no-cache',
      })
      if (req.method === 'HEAD') { res.end(); return }
      res.end(body)
    }, () => {
      res.writeHead(404)
      res.end()
    })
  }
}

/** Upload route: import one Codex atlas (raw body) into the user pets dir. */
function importRoute(service) {
  return {
    kind: 'exact',
    path: PET_API_PREFIX + '/import',
    handler: (req, res) => {
      if (!requireMethod(req, res, 'POST')) return
      let id = ''
      let name = ''
      try {
        const params = new URL(req.url ?? '/', 'http://codex-pet.local').searchParams
        id = params.get('id') ?? ''
        name = params.get('name') ?? ''
      } catch {
        json(res, 400, { ok: false, error: 'invalid-url' })
        return
      }
      readRawBody(req, 20 * 1024 * 1024).then((buffer) => {
        json(res, 200, service.importPet(id, name, buffer))
      }, (error) => {
        json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    },
  }
}

/** Build the full route family (API + assets) for one service. */
export function makeCodexPetRoutes({ service }) {
  return [
    getRoute(PET_API_PREFIX + '/pets', () => ({ pets: service.pets() })),
    getRoute(PET_API_PREFIX + '/state', () => service.state()),
    postRoute(PET_API_PREFIX + '/set-pet', (body) => service.setPetId(body.petId)),
    postRoute(PET_API_PREFIX + '/set-config', (body) => service.setConfig(body)),
    postRoute(PET_API_PREFIX + '/set-visible', (body) => service.setVisible(body.visible)),
    importRoute(service),
    { kind: 'prefix', path: PET_ASSET_PREFIX, handler: assetHandler(service.registry) },
  ]
}
