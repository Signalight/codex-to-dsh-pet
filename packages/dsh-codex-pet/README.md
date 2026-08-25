# @signalight/dsh-codex-pet

A **DSH web-GUI pet runtime plugin** — one plugin that renders *any* Codex
spritesheet-atlas pet (v1 / v2) as a draggable desktop pet in the DeepSeek
Harness web GUI.

It is the runtime half of the
[`codex-to-dsh-pet`](https://github.com/Signalight/codex-to-dsh-pet) framework:
instead of building each pet into its own plugin bundle, you install this
plugin **once**, then add pets as plain data files — no per-pet code.

> The plugin ships one built-in example pet **`nastya` (娜斯佳)** — an original
> character (CC BY-NC 4.0, non-commercial) — so the registry is never empty.
> See `assets/nastya/`.

## Features

- Renders Codex spritesheet atlases (8 columns × 192×208 cells):
  - **v1** (1536×1872, 9 rows) — auto-detected;
  - **v2** (1536×2288, 11 rows) — adds 16 mouse-tracking "look" cells.
- Draggable (position persists across restarts), wave-on-hover,
  jump-on-double-click.
- **Opt-in mouse tracking (v2 only, default on)**: the «桌宠» settings section
  has an **Eye tracking** toggle; the UI notes it applies to v2 atlases only
  (v1 has no look cells, so the toggle is inert for v1 pets).
- Live activity poses: idle / waiting / running / review, driven by the
  conversation state.
- Progress bubble showing the running tool name or the live model text tail.
- Optional fixed-interval first-person LLM summaries, with a per-session journal
  shown when hovering the pet. Automatic summaries observe only requests completed
  after selecting a session; they do not backfill historical conversations. Right-
  click the pet to explicitly analyze prior unsummarized requests. This is disabled
  by default. Enabling it sends bounded excerpts of user, assistant, tool, and error
  content to the selected LLM and incurs that provider's usage/cost. Select a
  provider and model before enabling summaries. Cadence and bubble duration
  are configurable.
- Configurable completion, error and interruption voices, including per-track
  volume, bundled rotating takes and user-uploaded audio overrides.
- Zero per-pet code: the browser half is registry-driven from `/api/codex-pet/*`.

## Install

**Recommended — one command (needs pnpm):**

```powershell
# from npm
dsh plugin --profile web add @signalight/dsh-codex-pet

# or straight from GitHub
dsh plugin --profile web add github:Signalight/codex-to-dsh-pet#path:/packages/dsh-codex-pet
```

**Manual route (no pnpm):** from the repository root run

```powershell
.\install-runtime.ps1
```

This copies the package into `~/.dsh/profiles/node_modules/@signalight/dsh-codex-pet` and
registers the plugin row in `~/.dsh/profiles/web/cordis.patch.yml`. Then:

1. Hard-refresh `http://127.0.0.1:3080` (Ctrl+Shift+R) — the DSH profile hot-reloads
   `cordis.patch.yml`. If the pet still doesn't show, fully quit and relaunch the DSH
   desktop app (command-line users can restart `dsh web`).

Rollback: delete `~/.dsh/profiles/node_modules/@signalight/dsh-codex-pet` and restore the
`.bak` next to the patch file.

## Add a pet

A pet is a folder holding a `pet.json` manifest plus one atlas image. Drop it
into either source (user pets override built-ins on id collision):

- built-in: `packages/dsh-codex-pet/assets/<pet>/`
- user: `~/.dsh/pets/<pet>/` (survives plugin updates)

`pet.json`:

```json
{
  "id": "nastya",
  "displayName": "娜斯佳",
  "description": "娜斯佳 Nastya — original character (CC BY-NC 4.0).",
  "spritesheetPath": "spritesheet.webp",
  "spriteVersionNumber": 2,
  "size": 120,
  "pin": "bottom-right"
}
```

Only `id` and `spritesheetPath` are required. `spriteVersionNumber` is
auto-detected from the image dimensions when omitted; `size` (px width) and
`pin` (`top-left` / `bottom-right` / …) default to `120` and `bottom-right`.

**No manual editing needed**: in the DSH settings surface open the «桌宠»
section and click **导入桌宠 (webp / png / gif)** — the plugin writes the file
into `~/.dsh/pets/<name>/`, auto-detects the atlas version, and selects the new
pet. The pet id comes from the filename (`my-pet.webp` → `my-pet`); if that id
is already taken the plugin appends a `-2` / `-3` suffix instead of
overwriting the earlier pet (all Codex atlases are named `spritesheet.webp`,
so without this every import would clobber the previous one). Re-importing the
same id with the same typed display name updates that pet in place.

## Architecture

```
src/
├── index.js     host half: name/inject/apply, mounts service + routes
├── registry.js  scans assets/* + ~/.dsh/pets/*, normalizes Codex atlases
├── service.js   persisted selection + display config (~/.dsh/codex-pet.json)
├── routes.js    /api/codex-pet/* JSON API + /codex-pet/<id>/* assets
└── client.js    browser half: registry-driven overlay renderer
```

- **Host half** registers same-origin routes via the DSH web server
  (`ctx.webServer.register`), serving the pet list, state and atlas assets.
- **Browser half** fetches `/api/codex-pet/state`, renders the selected pet,
  mirrors drags back via `POST /api/codex-pet/set-config`, and seats a
  `settings.section` entry («桌宠») that edits the pet through the same API.

### API

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/codex-pet/pets` | GET | pet registry (list of definitions) |
| `/api/codex-pet/state` | GET | selected pet + display config |
| `/api/codex-pet/set-pet` | POST | `{ petId }` — switch pet |
| `/api/codex-pet/set-config` | POST | update display, `summary`, or `sound` settings |
| `/api/codex-pet/set-visible` | POST | `{ visible }` |
| `/api/codex-pet/import?id=<filename>&name=<displayName>` | POST | raw image body — import a Codex atlas |
| `/api/codex-pet/models` | GET | available LLM providers and models for summaries |
| `/api/codex-pet/summarize` | POST | summarize one completed assistant-request batch |
| `/api/codex-pet/journal?session=<id>&limit=<n>` | GET | recent persisted summaries (`&all=1` returns all records for manual coverage checks) |
| `/api/codex-pet/sound?track=<id>` | POST | upload a raw audio override (8 MiB maximum) |
| `/api/codex-pet/reset-sound?track=<id>` | POST | remove an audio override |
| `/codex-pet-sound?track=<id>` | GET | stream the effective `done`, `error`, or `interrupt` track |
| `/codex-pet/<id>/<file>` | GET | pet.json + spritesheet assets |

Summary journals are stored under `~/.dsh/codex-pet-journal/`. Uploaded voice
overrides are stored under `~/.dsh/pets/sounds/` and survive plugin updates.

## Roadmap

- [x] Settings section («桌宠» in the DSH settings surface: pet selector,
      show/hide, size, corner pin, bubble color/opacity, **eye tracking** —
      the last is v2-only and noted as such), backed by the plugin's own API.
- [x] In-GUI import button (upload a Codex atlas → auto-detect → install →
      select).
- [ ] In-GUI preview before import (live canvas frame preview).
- [x] Published to npm (`@signalight/dsh-codex-pet`) + `dsh-plugin` GitHub topic.

## License

MIT — see the repository root `LICENSE`.

### Built-in scenario voice / sound assets

The plugin ships 8 built-in scenario sounds under `assets/sounds/`
(`done-1~4.wav`, `error.wav`, `interrupt-1~3.wav`):

- **Attribution**: these sounds were generated by contributor **@yabo083**
  (PR #4) using **Qwen3-TTS VoiceDesign** and submitted with the plugin; they
  were reviewed and accepted into this package, and are distributed under MIT
  together with the plugin.
- **Generator license**: the Qwen3-TTS model repo is
  [Apache-2.0](https://github.com/QwenLM/Qwen3-TTS/blob/main/LICENSE); that
  license applies to the model repo only and does **not** change this project's
  license. Using Qwen3-TTS does not imply endorsement by Qwen.
- **Relationship to the character**: these lines are usually performed as the
  built-in example pet `nastya` (娜斯佳). That character is an **original
  character**, and its atlas is licensed **CC BY-NC 4.0** (non-commercial), so
  even though the sound files are MIT-licensed, using them as that character's
  voice keeps the character's **non-commercial** restriction in force; ask the
  character's author before any commercial use.
- **User audio**: you may upload your own audio to replace any scenario sound
  (Settings → 完成提示音); custom audio's copyright and license are your own
  responsibility.
