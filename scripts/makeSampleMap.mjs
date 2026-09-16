/**
 * Генерирует образец карты Universal VTT для ручной проверки импорта.
 *
 * Результат — `fixtures/sample.dd2vtt`: комната 8×6 клеток с внешними стенами,
 * перегородкой, дверью, окном и двумя источниками света. Картинка рисуется
 * прямо здесь (PNG собирается вручную, без зависимостей), чтобы образец не
 * требовал ни Dungeondraft, ни графического редактора.
 *
 * Запуск: node scripts/makeSampleMap.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

/** Размер клетки образца в пикселях */
const PIXELS_PER_GRID = 100;

/** Размер карты в клетках */
const MAP_SIZE = { x: 8, y: 6 };

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * Считает CRC32 буфера — нужен каждому чанку PNG.
 *
 * @param {Buffer} buffer - данные чанка
 * @returns {number} контрольная сумма
 */
function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;

    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Собирает чанк PNG с длиной, типом и контрольной суммой.
 *
 * @param {string} type - четырёхбуквенный тип чанка
 * @param {Buffer} data - содержимое чанка
 * @returns {Buffer} готовый чанк
 */
function pngChunk(type, data) {
  const length = Buffer.alloc(4);

  length.writeUInt32BE(data.length);

  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);

  crc.writeUInt32BE(crc32(typeAndData));

  return Buffer.concat([length, typeAndData, crc]);
}

/**
 * Рисует картинку карты: клетчатый пол с рамкой.
 *
 * @param {number} width - ширина в пикселях
 * @param {number} height - высота в пикселях
 * @returns {Buffer} PNG-файл
 */
function renderMapPng(width, height) {
  // По байту фильтра на строку + RGB на пиксель.
  const raw = Buffer.alloc(height * (1 + width * 3));

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 3);

    raw[rowStart] = 0;

    for (let x = 0; x < width; x += 1) {
      const onGridLine =
        x % PIXELS_PER_GRID === 0 || y % PIXELS_PER_GRID === 0;

      const nearBorder =
        x < 4 || y < 4 || x >= width - 4 || y >= height - 4;

      let color = [58, 52, 46];

      if (onGridLine) {
        color = [72, 65, 58];
      }

      if (nearBorder) {
        color = [30, 27, 24];
      }

      const offset = rowStart + 1 + x * 3;

      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
    }
  }

  const header = Buffer.alloc(13);

  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // бит на канал
  header[9] = 2; // цветовой тип: truecolor
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const image = renderMapPng(
  MAP_SIZE.x * PIXELS_PER_GRID,
  MAP_SIZE.y * PIXELS_PER_GRID,
);

const map = {
  format: 1,
  resolution: {
    map_origin: { x: 0, y: 0 },
    map_size: MAP_SIZE,
    pixels_per_grid: PIXELS_PER_GRID,
  },
  line_of_sight: [
    [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 6 },
      { x: 0, y: 6 },
      { x: 0, y: 0 },
    ],
    [
      { x: 4, y: 0 },
      { x: 4, y: 2 },
    ],
    [
      { x: 4, y: 4 },
      { x: 4, y: 6 },
    ],
  ],
  objects_line_of_sight: [
    [
      { x: 1, y: 4 },
      { x: 2, y: 4 },
      { x: 2, y: 5 },
      { x: 1, y: 5 },
      { x: 1, y: 4 },
    ],
  ],
  portals: [
    {
      position: { x: 4, y: 3 },
      bounds: [
        { x: 4, y: 2 },
        { x: 4, y: 4 },
      ],
      rotation: 1.5708,
      closed: true,
      freestanding: false,
    },
    {
      position: { x: 6, y: 0 },
      bounds: [
        { x: 5.5, y: 0 },
        { x: 6.5, y: 0 },
      ],
      rotation: 0,
      closed: true,
      freestanding: false,
    },
  ],
  lights: [
    {
      position: { x: 2, y: 2 },
      range: 3,
      intensity: 1,
      color: 'ffd9b3ff',
      shadows: true,
    },
    {
      position: { x: 6, y: 4 },
      range: 2,
      intensity: 0.6,
      color: 'b3d9ffff',
      shadows: true,
    },
  ],
  environment: {
    baked_lighting: false,
    ambient_light: '00000000',
  },
  image: image.toString('base64'),
};

const outDir = path.join(projectRoot, 'fixtures');

fs.mkdirSync(outDir, { recursive: true });

const outFile = path.join(outDir, 'sample.dd2vtt');

fs.writeFileSync(outFile, JSON.stringify(map));

console.log(`Образец карты: ${outFile}`);
console.log(
  `Карта ${MAP_SIZE.x}×${MAP_SIZE.y} клеток, стен: ${map.line_of_sight.length}, `
    + `дверей: ${map.portals.length}, огней: ${map.lights.length}`,
);
