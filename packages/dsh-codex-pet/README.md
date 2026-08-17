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
- Live activity poses: idle / waiting / running / review, driven by the
  conversation state.
- Progress bubble showing the running tool name or the live model text tail.
- Zero per-pet code: the browser half is registry-driven from `/api/codex-pet/*`.

## Install

**Recommended — one command (needs pnpm):**

```powershell
# from npm (once published)
dsh plugin --profile web add @signalight/dsh-codex-pet

# or straight from GitHub (no npm account needed)
dsh plugin --profile web add github:Signalight/codex-to-dsh-pet#path:/packages/dsh-codex-pet
```

**Manual route (no pnpm):** from the repository root run

```powershell
.\install-runtime.ps1
```

This copies the package into `~/.dsh/profiles/node_modules/@signalight/dsh-codex-pet` and
registers the plugin row in `~/.dsh/profiles/web/cordis.patch.yml`. Then:

1. Stop the running `dsh web` process.
2. Run `dsh web` again.
3. Hard-refresh `http://127.0.0.1:3080` (Ctrl+Shift+R).

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
pet. The pet id comes from the filename (`my-pet.webp` → `my-pet`).

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
| `/api/codex-pet/set-config` | POST | `{ size?, pin?, left?, top?, visible? }` |
| `/api/codex-pet/set-visible` | POST | `{ visible }` |
| `/api/codex-pet/import?name=<id>` | POST | raw image body — import a Codex atlas |
| `/codex-pet/<id>/<file>` | GET | pet.json + spritesheet assets |

## Roadmap

- [x] Settings section («桌宠» in the DSH settings surface: pet selector,
      show/hide, size, corner pin), backed by the plugin's own API.
- [x] In-GUI import button (upload a Codex atlas → auto-detect → install →
      select).
- [ ] In-GUI preview before import (live canvas frame preview).
- [ ] Publish to npm + the `dsh-plugin` GitHub topic (marketplace).

## License

MIT — see the repository root `LICENSE`.
