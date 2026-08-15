/* Build the browser bundle: inline the spritesheet as a data URI and inject the
 * config.json into lib/client.js. Run `node build.js` after editing config.json
 * or swapping the spritesheet. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.join(root, 'lib', 'client.template.js');
const configPath = path.join(root, 'config.json');
const outPath = path.join(root, 'lib', 'client.js');

const template = fs.readFileSync(templatePath, 'utf8');

let config = {};
if (fs.existsSync(configPath)) {
  try {
    // 容忍 UTF-8 BOM（Windows 下编辑器/PowerShell 常会写入）
    const raw = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
    config = JSON.parse(raw);
  } catch (err) {
    throw new Error(`config.json 不是合法 JSON: ${err.message}`);
  }
}

const sheetRel = config.spritesheetPath || 'spritesheet.webp';
const sheetPath = path.join(root, sheetRel);
if (!fs.existsSync(sheetPath)) {
  throw new Error(`找不到图集: ${sheetPath}（请在 config.json 里设置 spritesheetPath）`);
}
const sheet = fs.readFileSync(sheetPath);

const ext = path.extname(sheetPath).toLowerCase();
const mime = { '.webp': 'image/webp', '.png': 'image/png', '.gif': 'image/gif' }[ext] || 'image/webp';
const dataUri = `data:${mime};base64,${sheet.toString('base64')}`;

if (!template.includes('__CONFIG_JSON__') || !template.includes('__SPRITESHEET_DATA_URI__')) {
  throw new Error('模板缺少 __CONFIG_JSON__ 或 __SPRITESHEET_DATA_URI__ 占位符');
}

const configJson = JSON.stringify(config);
const out = template
  .replace('__CONFIG_JSON__', configJson)
  .replace('__SPRITESHEET_DATA_URI__', dataUri);

fs.writeFileSync(outPath, out, 'utf8');

console.log(`wrote lib/client.js (${(out.length / 1024 / 1024).toFixed(2)} MB)`);
console.log(`spritesheet: ${path.relative(root, sheetPath)} (${mime})`);
console.log(`config: ${Object.keys(config).length ? 'config.json' : '（默认配置）'}`);
