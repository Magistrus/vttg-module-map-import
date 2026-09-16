/**
 * Проверки чтения файла Universal VTT на настоящем образце карты.
 *
 * Образец лежит в `fixtures/sample.dd2vtt` и генерируется скриптом
 * `scripts/makeSampleMap.mjs` — так тест проверяет ровно тот файл, которым
 * предлагается проверять импорт руками.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  decodeEmbeddedImage,
  isImageFileName,
  isUvttFileName,
  parseUvttFile,
  summarizeUvtt,
} from './parse';

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/sample.dd2vtt',
);

/**
 * Оборачивает файл с диска в `File`, как это делает браузер.
 *
 * @param filePath - путь к файлу
 * @returns файл для парсера
 */
function readAsFile(filePath: string): File {
  return new File([readFileSync(filePath)], path.basename(filePath));
}

describe('parseUvttFile', () => {
  it('разбирает образец карты и считает сводку', async () => {
    const map = await parseUvttFile(readAsFile(fixturePath));
    const summary = summarizeUvtt(map);

    expect(summary).toMatchObject({
      widthPx: 800,
      heightPx: 600,
      pixelsPerGrid: 100,
      wallCount: 3,
      objectWallCount: 1,
      portalCount: 2,
      lightCount: 2,
      hasImage: true,
      bakedLighting: false,
    });
  });

  it('объясняет, что файл не JSON', async () => {
    const file = new File(['это не json'], 'broken.dd2vtt');

    await expect(parseUvttFile(file)).rejects.toThrow(/не является JSON/);
  });

  it('объясняет, какого поля не хватает', async () => {
    const file = new File([JSON.stringify({ format: 1 })], 'empty.dd2vtt');

    await expect(parseUvttFile(file)).rejects.toThrow(/resolution/);
  });
});

describe('decodeEmbeddedImage', () => {
  it('достаёт из карты картинку PNG', async () => {
    const map = await parseUvttFile(readAsFile(fixturePath));
    const blob = decodeEmbeddedImage(map.image ?? '');
    const head = new Uint8Array(await blob.arrayBuffer()).slice(0, 4);

    expect(blob.type).toBe('image/png');
    expect(Array.from(head)).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('понимает картинку, записанную целиком как data-URL', () => {
    const blob = decodeEmbeddedImage(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
    );

    expect(blob.type).toBe('image/png');
  });
});

describe('распознавание имён файлов', () => {
  it('принимает известные расширения карт', () => {
    expect(isUvttFileName('dungeon.dd2vtt')).toBe(true);
    expect(isUvttFileName('dungeon.UVTT')).toBe(true);
    expect(isUvttFileName('dungeon.png')).toBe(false);
  });

  it('принимает известные расширения картинок', () => {
    expect(isImageFileName('dungeon.WebP')).toBe(true);
    expect(isImageFileName('dungeon.dd2vtt')).toBe(false);
  });
});
