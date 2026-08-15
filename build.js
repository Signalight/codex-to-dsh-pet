/* Build the browser bundle: locate the spritesheet, derive the pet name from
 * its filename, auto-detect the sprite version from the image dimensions, inline
 * the image as a data URI, and inject the effective config into lib/client.js.
 *
 * Workflow: drop `<petname>.webp` here → `node build.js` → `.\install-to-dsh.ps1`
 * produces a plugin named `<petname>`. No config.json needed for standard pets.
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
const sheet = fs.readFileSync(sheetPath);

// 3) Auto-detect image dimensions + Codex sprite version from the header.
// Codex atlases are fixed-size: 1536x1872 = v1 (9 rows), 1536x2288 = v2 (11 rows,
// includes the 16 look cells that enable mouse tracking).
function detectDimensions(buffer) {
  if (buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buffer.toString('ascii', 12, 16);
    if (chunk === 'VP8X' && buffer.length >= 30) {
      return { width: 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)), height: 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)) };
    }
    if (chunk === 'VP8L' && buffer.length >= 25) {
      const b0 = buffer[21], b1 = buffer[22], b2 = buffer[23], b3 = buffer[24];
      return { width: ((b1 & 0x3f) << 8 | b0) + 1, height: ((b3 & 0x0f) << 10 | (b2 << 2) | (b1 >> 6)) + 1 };
    }
    if (chunk === 'VP8 ' && buffer.length >= 27) {
      return { width: (buffer[23] | (buffer[24] << 8)) & 0x3fff, height: (buffer[25] | (buffer[26] << 8)) & 0x3fff };
    }
  }
  if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 10) {
    const sig = buffer.toString('ascii', 0, 6);
    if (sig === 'GIF87a' || sig === 'GIF89a') {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    }
  }
  return null;
}

function detectSpriteVersion(buffer) {
  const dim = detectDimensions(buffer);
  if (!dim) return null;
  if (dim.width === 1536 && dim.height === 1872) return 1;
  if (dim.width === 1536 && dim.height === 2288) return 2;
  return null;
}

const detectedVersion = detectSpriteVersion(sheet);
let spriteVersionNumber;
if (detectedVersion) {
  spriteVersionNumber = detectedVersion; // auto-detect wins for standard Codex atlases
  if (config.spriteVersionNumber != null && config.spriteVersionNumber !== detectedVersion) {
    console.warn(`提示: 图集尺寸看起来是 v${detectedVersion}，忽略 config.json 里的 spriteVersionNumber=${config.spriteVersionNumber}`);
  }
} else if (config.spriteVersionNumber != null) {
  spriteVersionNumber = config.spriteVersionNumber;
} else {
  spriteVersionNumber = 2;
}

// 4) Resolve the effective config: name/label default to the spritesheet filename.
// When the spritesheetPath was stale (file renamed), also ignore the stale name/label.
const effective = Object.assign({}, config, {
  name: (stalePath ? null : config.name) || sheetBase,
  label: (stalePath ? null : config.label) || sheetBase,
  spriteVersionNumber,
});

// 5) Inline the spritesheet and inject the effective config.
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

// 6) Persist the effective config so install-to-dsh.ps1 reads the same name.
fs.writeFileSync(effectivePath, JSON.stringify(effective, null, 2) + '\n', 'utf8');

console.log(`wrote lib/client.js (${(out.length / 1024 / 1024).toFixed(2)} MB)`);
console.log(`pet name: ${effective.name}   spriteVersionNumber: v${spriteVersionNumber}   (${sheetBase}: ${detectDimensions(sheet).width}x${detectDimensions(sheet).height})`);
console.log(`config: ${Object.keys(config).length ? 'config.json' : '默认（名字取自图集文件名）'}`);
