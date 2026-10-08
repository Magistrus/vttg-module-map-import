/**
 * Копирует собранный модуль в папку мира VTTG и снимает его хэш-пин.
 *
 * Использование:
 *   node scripts/installToWorld.mjs "D:/путь/к/папке/мира"
 *   VTTG_WORLD_PATH="D:/путь/к/папке/мира" pnpm install:world
 *
 * Папка мира — та, где лежат `world.db` и подпапка `assets`. Модуль ставится
 * в `<папка мира>/modules/map-import/`.
 *
 * ПРО ПИН. Приложение фиксирует хэш кода модуля при первом появлении
 * (`<данные установки>/installed-modules.json`) и дальше требует точного
 * совпадения: так ловится подмена файлов уже установленного модуля. Для
 * разработчика это значит, что КАЖДАЯ пересборка выглядит как подмена —
 * сервер молча перестаёт отдавать манифест клиенту, и модуль исчезает из
 * «Управления модулями». Снять пин из приложения нечем, поэтому это делает
 * сам скрипт: удаляет записи `<мир>:<id модуля>`, и ближайшее чтение
 * пиннит новую сборку заново.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** Идентификатор модуля — совпадает с `id` в module.json */
const MODULE_ID = 'map-import';

/** Имя файла-реестра хэш-пинов в корне данных установки */
const PIN_REGISTRY_FILENAME = 'installed-modules.json';

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

revokeModulePins();

console.log('Перезагрузите мир: настройки → «Управление модулями».');

/**
 * Ищет корень данных установки приложения.
 *
 * Путь может быть перенесён пользователем, поэтому сначала спрашиваем сам
 * лаунчер (`data-location.json` в userData), а уже потом берём userData как
 * есть. Переменная окружения перекрывает обе догадки.
 *
 * @returns путь к данным установки или null, если найти не удалось
 */
function resolveInstallDataPath() {
  if (process.env.VTTG_DATA_PATH) {
    return process.env.VTTG_DATA_PATH;
  }

  const appData =
    process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');

  const userDataPath = path.join(appData, 'vttg');
  const locationFile = path.join(userDataPath, 'data-location.json');

  if (fs.existsSync(locationFile)) {
    try {
      const location = JSON.parse(fs.readFileSync(locationFile, 'utf8'));

      if (typeof location?.path === 'string' && location.path) {
        return location.path;
      }
    } catch {
      // Битый файл — не повод падать: попробуем userData как есть.
    }
  }

  return fs.existsSync(userDataPath) ? userDataPath : null;
}

/**
 * Снимает хэш-пины этого модуля во всех мирах установки.
 *
 * Ключ реестра — `<id мира>:<id модуля>`, а id мира скрипту неизвестен, потому
 * что живёт в базе приложения. Снимаем пины по суффиксу: лишних не бывает —
 * все они про этот же модуль, и каждый перепиннится при первом чтении.
 */
function revokeModulePins() {
  const installDataPath = resolveInstallDataPath();

  if (!installDataPath) {
    console.warn(
      'Данные установки не найдены — если модуль не появится в списке, '
        + `удалите записи «…:${MODULE_ID}» из ${PIN_REGISTRY_FILENAME} вручную.`,
    );

    return;
  }

  const registryPath = path.join(installDataPath, PIN_REGISTRY_FILENAME);

  if (!fs.existsSync(registryPath)) {
    return;
  }

  let registry;

  try {
    registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch {
    console.warn(`Реестр пинов не читается: ${registryPath}`);

    return;
  }

  if (typeof registry !== 'object' || registry === null) {
    return;
  }

  const suffix = `:${MODULE_ID}`;
  const kept = {};
  const removed = [];

  for (const [key, record] of Object.entries(registry)) {
    if (key.endsWith(suffix)) {
      removed.push(key);
    } else {
      kept[key] = record;
    }
  }

  if (removed.length === 0) {
    return;
  }

  fs.writeFileSync(registryPath, `${JSON.stringify(kept, null, 2)}\n`);

  console.log(`✓ снят хэш-пин: ${removed.join(', ')}`);
}
