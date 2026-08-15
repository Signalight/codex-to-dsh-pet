/* Build the browser bundle: locate the spritesheet, derive the pet name from
 * its filename, inline the image as a data URI, and inject the effective config
 * into lib/client.js. Run `node build.js` after dropping/renaming a spritesheet.
 *
 * Workflow: drop `<petname>.webp` here → `node build.js` → `.\install-to-dsh.ps1`
 * produces a plugin named `<petname>`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.join(root, 'lib', 'client.template.js');
const configPath = path.join(root, 'config.json');
const effectivePath = path.join(root, 'config.effective.json');
const outPath = path.join(root, 'lib', 'client.js');

const template = fs.readFileSync(templatePath, 'utf8');

// 1) Read optional user config (tolerate a UTF-8 BOM).
let config = {};
if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (err) {
    throw new Error(`config.json 不是合法 JSON: ${err.message}`);
  }
}

// 2) Locate the spritesheet.
//   - config.spritesheetPath, if that file actually exists;
//   - otherwise auto-detect the single .webp/.png/.gif. A stale spritesheetPath
//     means the user renamed the file, so we ignore the stale name/label too.
let sheetPath = null;
let stalePath = false;
if (config.spritesheetPath) {
  const p = path.resolve(root, config.spritesheetPath);
  if (fs.existsSync(p)) {
    sheetPath = p;
  } else {
    stalePath = true; // configured path is missing -> renamed, fall back to auto-detect
  }
}
if (!sheetPath) {
  const imgs = fs.readdirSync(root).filter((f) => /\.(webp|png|gif)$/i.test(f));
  if (imgs.length === 1) {
    sheetPath = path.join(root, imgs[0]);
  } else if (imgs.length === 0) {
    throw new Error('本目录没有图集（.webp/.png/.gif）。请把图集命名成宠物名（如 fluffy.webp）放到这里，或在 config.json 里设置 spritesheetPath。');
  } else {
    throw new Error(`本目录有多张图集，请用 config.json 的 spritesheetPath 指定：${imgs.join(', ')}`);
  }
}
const sheetBase = path.basename(sheetPath, path.extname(sheetPath)); // e.g. "fluffy"

// 3) Resolve the effective config: name/label default to the spritesheet filename.
// When the spritesheetPath was stale (file renamed), also ignore the stale name/label.
const effective = Object.assign({}, config, {
  name: (stalePath ? null : config.name) || sheetBase,
  label: (stalePath ? null : config.label) || sheetBase,
});

// 4) Inline the spritesheet and inject the effective config.
const sheet = fs.readFileSync(sheetPath);
const ext = path.extname(sheetPath).toLowerCase();
const mime = { '.webp': 'image/webp', '.png': 'image/png', '.gif': 'image/gif' }[ext] || 'image/webp';
const dataUri = `data:${mime};base64,${sheet.toString('base64')}`;

if (!template.includes('__CONFIG_JSON__') || !template.includes('__SPRITESHEET_DATA_URI__')) {
  throw new Error('模板缺少 __CONFIG_JSON__ 或 __SPRITESHEET_DATA_URI__ 占位符');
}
const out = template
  .replace('__CONFIG_JSON__', JSON.stringify(effective))
  .replace('__SPRITESHEET_DATA_URI__', dataUri);
fs.writeFileSync(outPath, out, 'utf8');

// 5) Persist the effective config so install-to-dsh.ps1 reads the same name.
fs.writeFileSync(effectivePath, JSON.stringify(effective, null, 2) + '\n', 'utf8');

console.log(`wrote lib/client.js (${(out.length / 1024 / 1024).toFixed(2)} MB)`);
console.log(`pet name: ${effective.name}   (from ${path.relative(root, sheetPath)})`);
console.log(`config: ${Object.keys(config).length ? 'config.json' : '默认（名字取自图集文件名）'}`);
