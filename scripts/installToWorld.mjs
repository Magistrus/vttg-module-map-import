/**
 * Копирует собранный модуль в папку мира VTTG.
 *
 * Использование:
 *   node scripts/installToWorld.mjs "D:/путь/к/папке/мира"
 *   VTTG_WORLD_PATH="D:/путь/к/папке/мира" pnpm install:world
 *
 * Папка мира — та, где лежат `world.db` и подпапка `assets`. Модуль ставится
 * в `<папка мира>/modules/map-import/`.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** Идентификатор модуля — совпадает с `id` в module.json */
const MODULE_ID = 'map-import';

const projectRoot = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);

const worldPath = process.argv[2] ?? process.env.VTTG_WORLD_PATH;

if (!worldPath) {
  console.error(
    'Укажите папку мира: node scripts/installToWorld.mjs "D:/.../worlds/my-world"',
  );

  process.exit(1);
}

if (!fs.existsSync(worldPath)) {
  console.error(`Папки мира не существует: ${worldPath}`);
  process.exit(1);
}

const distDir = path.join(projectRoot, 'dist');

if (!fs.existsSync(path.join(distDir, 'client.js'))) {
  console.error('Сначала соберите модуль: pnpm build');
  process.exit(1);
}

const targetDir = path.join(worldPath, 'modules', MODULE_ID);

fs.mkdirSync(targetDir, { recursive: true });

/** Файлы сборки, которые нужны миру */
const files = ['client.js', 'styles.css'];

for (const file of files) {
  const source = path.join(distDir, file);

  if (!fs.existsSync(source)) {
    continue;
  }

  fs.copyFileSync(source, path.join(targetDir, file));
  console.log(`✓ ${file}`);
}

fs.copyFileSync(
  path.join(projectRoot, 'module.json'),
  path.join(targetDir, 'module.json'),
);

console.log('✓ module.json');
console.log(`Модуль установлен: ${targetDir}`);
console.log('Перезагрузите мир: настройки → «Управление модулями».');
