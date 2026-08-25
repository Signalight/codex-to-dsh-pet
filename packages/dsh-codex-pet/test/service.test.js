/**
 * Unit tests for summary/sound config persistence,
 * the chime file lifecycle, and the LLM summarize call framing. Everything
 * runs against a temp DSH_HOME so the real '~/.dsh' is never touched.
 * @module dsh-codex-pet/test/service
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { appendFileSync, mkdtempSync, existsSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PetService } from '../src/service.js'
import { makeCodexPetRoutes, SOUND_ROUTE } from '../src/routes.js'
import { inject } from '../src/index.js'

const PET_ENTRY = {
  id: 'nastya',
  displayName: 'nastya',
  description: '',
  spriteVersionNumber: 2,
  size: 120,
  pin: 'bottom-right',
  cell: { width: 192, height: 208 },
  columns: 8,
  rows: 11,
  atlasUrl: '/codex-pet/nastya/spritesheet.webp',
  manifestUrl: '/codex-pet/nastya/pet.json',
}

function makeRegistry() {
  return {
    entries: [PET_ENTRY],
    byId: (id) => (id === PET_ENTRY.id ? PET_ENTRY : undefined),
    defaultEntry: () => PET_ENTRY,
    add() {},
  }
}

function makeService() {
  const home = mkdtempSync(join(tmpdir(), 'codex-pet-test-'))
  const env = { DSH_HOME: home }
  return new PetService({ registry: makeRegistry(), env })
}

/** A tiny scripted llm double covering the surface summarizeRequests touches. */
function makeLlm({ providers, models, chunks }) {
  const calls = []
  return {
    calls,
    listProviders: () => providers,
    listModels: async () => models,
    async *stream(options) {
      calls.push(options)
      for (const chunk of chunks) yield chunk
    },
  }
}

const STOP_OK = [
  { type: 'text-delta', index: 0, text: '完成了登录修复，' },
  { type: 'text-delta', index: 0, text: '跑了三组测试。' },
  { type: 'finish', reason: { kind: 'stop' } },
]

function validPayload() {
  return {
    sessionId: 'session-a',
    fromRequestSeq: 30,
    toRequestSeq: 45,
    requests: [
      { requestSeq: 30, turn: 3, step: 1, user: '修一下登录', assistant: '好的', error: '', actions: [{ tool: 'pwsh', detail: 'npm t', failed: false }] },
      { requestSeq: 45, turn: 3, step: 2, user: '', assistant: '已修复', error: '', actions: [] },
    ],
  }
}

test('fresh state exposes summary/sound defaults and no custom tracks', () => {
  const service = makeService()
  const st = service.state()
  assert.equal(st.summary.enabled, false)
  assert.equal(st.summary.intervalRequests, 5)
  assert.equal(st.summary.provider, '')
  assert.equal(st.sound.volume, 60)
  assert.deepEqual(st.hasCustomSounds, { done: false, error: false, interrupt: false })
})

test('load preserves an explicitly enabled persisted summary with a complete route', () => {
  const home = mkdtempSync(join(tmpdir(), 'codex-pet-test-'))
  writeFileSync(join(home, 'codex-pet.json'), JSON.stringify({ summary: { enabled: true, provider: 'p', model: 'm1' } }))
  const service = new PetService({ registry: makeRegistry(), env: { DSH_HOME: home } })
  assert.equal(service.state().summary.enabled, true)
})

test('load disables a legacy enabled summary without a complete route', () => {
  const home = mkdtempSync(join(tmpdir(), 'codex-pet-test-'))
  writeFileSync(join(home, 'codex-pet.json'), JSON.stringify({ summary: { enabled: true, provider: 'p' } }))
  const service = new PetService({ registry: makeRegistry(), env: { DSH_HOME: home } })
  assert.equal(service.state().summary.enabled, false)
})

test('setConfig clamps summary interval and persists enabled=false', () => {
  const service = makeService()
  service.setConfig({ summary: { intervalRequests: 999, enabled: false } })
  const st = service.state()
  assert.equal(st.summary.intervalRequests, 50)
  assert.equal(st.summary.enabled, false)
})

test('selecting a summary route does not enable summaries', () => {
  const service = makeService()
  service.setConfig({ summary: { provider: 'p', model: 'm1' } })
  const st = service.state()
  assert.equal(st.summary.provider, 'p')
  assert.equal(st.summary.model, 'm1')
  assert.equal(st.summary.enabled, false)
})

test('setConfig keeps non-numeric garbage at defaults for summary', () => {
  const service = makeService()
  service.setConfig({ summary: { intervalRequests: 'lots' } })
  assert.equal(service.state().summary.intervalRequests, 5)
})

test('load migrates the former turn interval to request cadence', () => {
  const home = mkdtempSync(join(tmpdir(), 'codex-pet-test-'))
  writeFileSync(join(home, 'codex-pet.json'), JSON.stringify({ summary: { intervalTurns: 7 } }))
  const service = new PetService({ registry: makeRegistry(), env: { DSH_HOME: home } })
  assert.equal(service.state().summary.intervalRequests, 7)
  assert.equal('intervalTurns' in service.state().summary, false)
})

test('setConfig preserves untouched scenario tracks', () => {
  const service = makeService()
  service.setConfig({ sound: { tracks: { error: { enabled: false, volume: 70 } } } })
  service.setConfig({ sound: { tracks: { done: { enabled: false, volume: 40 } } } })
  assert.deepEqual(service.state().sound.tracks.error, { enabled: false, volume: 70 })
})

test('sound upload stores an override, replaces other variants, reset removes', () => {
  const service = makeService()
  const wavHeader = Buffer.alloc(44)
  wavHeader.write('RIFF', 0, 'ascii')
  wavHeader.write('WAVE', 8, 'ascii')
  const mp3Frame = Buffer.from([0xff, 0xfb, 0x90, 0x00])

  service.saveSound(wavHeader)
  assert.equal(service.state().hasCustomSounds.done, true)
  assert.ok(service.customSoundFile().endsWith('done.wav'))

  service.saveSound(mp3Frame)
  assert.deepEqual(readdirSync(service.soundsDir), ['done.mp3'])

  service.resetSound()
  assert.equal(service.state().hasCustomSounds.done, false)
  assert.ok(!existsSync(service.soundsDir) || readdirSync(service.soundsDir).length === 0)
})

test('saveSound rejects non-audio bytes with a clear error', () => {
  const service = makeService()
  assert.throws(() => service.saveSound(Buffer.from('plain text')), /unsupported-audio/)
})

test('saveSound accepts a WebM EBML header', () => {
  const service = makeService()
  service.saveSound(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), 'error')
  assert.ok(service.customSoundFile('error').endsWith('error.webm'))
})

test('scenario pulses retain their owning session', () => {
  const service = makeService()
  service.pulse('error', 'session-a')
  const pulse = service.state().pulses.error
  assert.equal(pulse.sessionId, 'session-a')
  assert.ok(pulse.at > 0)
})

test('sound route rejects an unknown track instead of serving done', () => {
  let requestedTrack = null
  const service = { trackFile: (track) => { requestedTrack = track; return null } }
  const route = makeCodexPetRoutes({ service, getLlm: () => null }).find((item) => item.path === SOUND_ROUTE)
  const response = {
    status: null,
    body: '',
    writeHead(status) { this.status = status },
    end(body) { this.body = String(body) },
  }
  route.handler({ method: 'GET', url: SOUND_ROUTE + '?track=typo' }, response)
  assert.equal(response.status, 400)
  assert.match(response.body, /unknown-track/)
  assert.equal(requestedTrack, null)
})

test('journal route requires a session instead of aggregating sessions', () => {
  const service = { journalList: () => { throw new Error('should-not-read') } }
  const route = makeCodexPetRoutes({ service, getLlm: () => null }).find((item) => item.path === '/api/codex-pet/journal')
  const response = {
    status: null,
    body: '',
    writeHead(status) { this.status = status },
    end(body) { this.body = String(body) },
  }
  route.handler({ method: 'GET', url: '/api/codex-pet/journal?limit=30' }, response)
  assert.equal(response.status, 400)
  assert.match(response.body, /missing-session/)
})

test('journal route returns 500 when the synchronous read throws', async () => {
  const service = { journalList: () => { throw new Error('journal-read-failed') } }
  const route = makeCodexPetRoutes({ service, getLlm: () => null }).find((item) => item.path === '/api/codex-pet/journal')
  const response = await new Promise((resolve) => {
    route.handler({ method: 'GET', url: '/api/codex-pet/journal?session=session-a' }, {
      writeHead(status) { this.status = status },
      end(body) { resolve({ status: this.status, body: String(body) }) },
    })
  })
  assert.equal(response.status, 500)
	assert.match(response.body, /journal-read-failed/)
})

test('journal route returns all persisted records when requested for manual coverage', async () => {
	let listed = false
	const service = {
		journalList: () => { listed = true; return [] },
		journalRecords: (session) => [{ session, fromRequestSeq: 1, toRequestSeq: 9 }],
	}
	const route = makeCodexPetRoutes({ service, getLlm: () => null }).find((item) => item.path === '/api/codex-pet/journal')
	const response = await new Promise((resolve) => {
		route.handler({ method: 'GET', url: '/api/codex-pet/journal?session=session-a&all=1' }, {
			writeHead(status) { this.status = status },
			end(body) { resolve({ status: this.status, body: String(body) }) },
		})
	})
	assert.equal(response.status, 200)
	assert.equal(listed, false)
	assert.deepEqual(JSON.parse(response.body).records, [{ session: 'session-a', fromRequestSeq: 1, toRequestSeq: 9 }])
})

test('base plugin starts without an LLM injection', () => {
  assert.deepEqual(inject, ['webServer'])
})

test('LLM routes report no-llm-service when the optional service is absent', async () => {
  const service = { summarizeRequests: () => { throw new Error('should-not-summarize') } }
  const routes = makeCodexPetRoutes({ service, getLlm: () => null })
  const call = (route, req) => new Promise((resolve) => {
    const response = {
      status: null,
      body: '',
      writeHead(status) { this.status = status },
      end(body) { this.body = String(body); resolve(this) },
    }
    route.handler(req, response)
  })
  const models = await call(routes.find((item) => item.path === '/api/codex-pet/models'), { method: 'GET' })
  assert.equal(models.status, 500)
  assert.match(models.body, /no-llm-service/)

  const request = new EventEmitter()
  request.method = 'POST'
  const summaryPromise = call(routes.find((item) => item.path === '/api/codex-pet/summarize'), request)
  request.emit('data', Buffer.from(JSON.stringify(validPayload())))
  request.emit('end')
  const summary = await summaryPromise
  assert.equal(summary.status, 400)
  assert.match(summary.body, /no-llm-service/)
})

test('journal filenames isolate punctuation and long same-prefix session ids', () => {
  const service = makeService()
  const punctuationA = 'a:b'
  const punctuationB = 'a?b'
  const prefix = 'x'.repeat(300)
  const longA = prefix + '-a'
  const longB = prefix + '-b'
  assert.notEqual(service.journalFileFor(punctuationA), service.journalFileFor(punctuationB))
  assert.notEqual(service.journalFileFor(longA), service.journalFileFor(longB))
  assert.throws(() => service.journalFileFor(''), /invalid-session-id/)
  assert.throws(() => service.journalList(''), /invalid-session-id/)
})

test('journal reads report corrupt JSONL with file and line', () => {
  const service = makeService()
  service.appendJournal({ sessionId: 'session-a', summary: 'ok' })
  appendFileSync(service.journalFileFor('session-a'), '{not json}\n', 'utf8')
  assert.throws(() => service.journalList('session-a'), /journal-invalid-jsonl:.*:2/)
})

test('summarizeRequests uses the explicit configured route verbatim', async () => {
  const service = makeService()
  service.setConfig({ summary: { enabled: true, provider: 'prov-b', model: 'm-mini' } })
  const llm = makeLlm({
    providers: [{ id: 'prov-b', name: 'B' }],
    models: [{ id: 'm-mini', name: 'Mini' }],
    chunks: STOP_OK,
  })
  const out = await service.summarizeRequests(llm, validPayload())
  assert.equal(out.provider, 'prov-b')
  assert.equal(out.model, 'm-mini')
  assert.equal(out.summary.includes('登录'), true)
  const call = llm.calls[0]
  assert.equal(call.provider, 'prov-b')
  assert.equal(call.model, 'm-mini')
  assert.equal(typeof call.system, 'string')
  assert.ok(call.messages.length === 1)
  assert.ok(call.maxTokens > 0)
})

test('summarizeRequests returns the persisted result without duplicate LLM calls', async () => {
  const service = makeService()
  service.setConfig({ summary: { enabled: true, provider: 'p', model: 'm1' } })
  const llm = makeLlm({
    providers: [{ id: 'p', name: 'P' }],
    models: [{ id: 'm1', name: 'M1' }],
    chunks: STOP_OK,
  })
  const first = await service.summarizeRequests(llm, validPayload())
  const second = await service.summarizeRequests(llm, validPayload())
  assert.deepEqual(second, first)
  assert.equal(llm.calls.length, 1)
  assert.equal(service.journalList('session-a').length, 1)
})

test('summarizeRequests rejects an enabled summary without an explicit route before streaming', async () => {
  const service = makeService()
  service.persist.summary.enabled = true
  const llm = makeLlm({
    providers: [{ id: 'prov-a', name: 'A' }, { id: 'prov-b', name: 'B' }],
    models: [{ id: 'm-cheap', name: 'Cheap' }],
    chunks: STOP_OK,
  })
  await assert.rejects(() => service.summarizeRequests(llm, validPayload()), /summary-route-not-configured/)
  assert.equal(llm.calls.length, 0)
})

test('summarizeRequests reports a configured provider that is no longer registered', async () => {
  const service = makeService()
  service.setConfig({ summary: { enabled: true, provider: 'prov-b', model: 'm-cheap' } })
  const llm = makeLlm({
    providers: [{ id: 'prov-a', name: 'A' }],
    models: [{ id: 'm-cheap', name: 'Cheap' }],
    chunks: STOP_OK,
  })
  await assert.rejects(() => service.summarizeRequests(llm, validPayload()), /summary-provider-not-found-prov-b/)
  assert.equal(llm.calls.length, 0)
})

test('summarizeRequests truncates the reply to the configured maxChars', async () => {
  const service = makeService()
  service.setConfig({ summary: { enabled: true, provider: 'p', model: 'm1', maxChars: 60 } })
  const longChunks = [
    { type: 'text-delta', index: 0, text: '啊'.repeat(300) },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
  const llm = makeLlm({ providers: [{ id: 'p', name: 'P' }], models: [{ id: 'm1', name: 'M1' }], chunks: longChunks })
  const out = await service.summarizeRequests(llm, validPayload())
  assert.ok(out.summary.length <= 60)
})

test('summarizeRequests surfaces a non-stop finish as a thrown error', async () => {
  const service = makeService()
  service.setConfig({ summary: { enabled: true, provider: 'p', model: 'm1' } })
  const llm = makeLlm({
    providers: [{ id: 'p', name: 'P' }],
    models: [{ id: 'm1', name: 'M1' }],
    chunks: [{ type: 'finish', reason: { kind: 'error', failure: { message: 'boom', code: 'X' } } }],
  })
  await assert.rejects(() => service.summarizeRequests(llm, validPayload()), /summary-llm-error/)
})

test('summarizeRequests rejects an EOF after text deltas without journaling', async () => {
  const service = makeService()
  service.setConfig({ summary: { enabled: true, provider: 'p', model: 'm1' } })
  const llm = makeLlm({
    providers: [{ id: 'p', name: 'P' }],
    models: [{ id: 'm1', name: 'M1' }],
    chunks: [{ type: 'text-delta', index: 0, text: 'partial reply' }],
  })
  await assert.rejects(() => service.summarizeRequests(llm, validPayload()), /summary-llm-stream-incomplete/)
  assert.deepEqual(service.journalList('session-a'), [])
})

test('summarizeRequests validates the browser payload', async () => {
  const service = makeService()
  const llm = makeLlm({ providers: [{ id: 'p', name: 'P' }], models: [], chunks: STOP_OK })
  await assert.rejects(() => service.summarizeRequests(llm, { sessionId: 'session-a', fromRequestSeq: 5, toRequestSeq: 2, requests: [] }), /invalid-request-range/)
  await assert.rejects(() => service.summarizeRequests(llm, { ...validPayload(), sessionId: '' }), /invalid-session-id/)
  await assert.rejects(() => service.summarizeRequests(llm, { ...validPayload(), fromRequestSeq: '30' }), /invalid-request-range/)
  await assert.rejects(() => service.summarizeRequests(llm, { sessionId: 'session-a', fromRequestSeq: 1, toRequestSeq: 2 }), /invalid-requests/)
  await assert.rejects(() => service.summarizeRequests(llm, { ...validPayload(), requests: [{ ...validPayload().requests[0], step: 0 }] }), /invalid-request-record/)
  service.setConfig({ summary: { enabled: true, provider: 'p', model: 'm1' } })
  const empty = makeLlm({ providers: [], models: [], chunks: [] })
  await assert.rejects(() => service.summarizeRequests(empty, validPayload()), /no-llm-provider/)
})

test('summarizeRequests rejects disabled generation without starting an LLM stream', async () => {
  const service = makeService()
  const llm = makeLlm({ providers: [{ id: 'p', name: 'P' }], models: [{ id: 'm1', name: 'M1' }], chunks: STOP_OK })
  await assert.rejects(() => service.summarizeRequests(llm, validPayload()), /summary-disabled/)
  assert.equal(llm.calls.length, 0)
})

test('summarizeRequests shares one in-flight generation for an identical range', async () => {
  const service = makeService()
  service.setConfig({ summary: { enabled: true, provider: 'p', model: 'm1' } })
  let release
  const started = new Promise((resolve) => { release = resolve })
  const llm = makeLlm({
    providers: [{ id: 'p', name: 'P' }],
    models: [{ id: 'm1', name: 'M1' }],
    chunks: [],
  })
  let streams = 0
  llm.stream = async function * (options) {
    streams += 1
    llm.calls.push(options)
    await started
    yield * STOP_OK
  }
  const first = service.summarizeRequests(llm, validPayload())
  const second = service.summarizeRequests(llm, validPayload())
  release()
  const [one, two] = await Promise.all([first, second])
  assert.deepEqual(two, one)
  assert.equal(streams, 1)
  assert.equal(service.journalList('session-a').length, 1)
})
