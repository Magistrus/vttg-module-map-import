/**
 * Чтение файла Universal VTT и разбор его содержимого.
 *
 * @module uvtt/parse
 */

import type { UvttMap } from './schema';

import { uvttMapSchema } from './schema';

/** Расширения, которые модуль принимает как Universal VTT */
export const UVTT_EXTENSIONS = ['.dd2vtt', '.uvtt', '.df2vtt', '.json'];

/** Расширения растровых карт, которые можно подложить вместо встроенной картинки */
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

/** Краткая сводка по разобранной карте — то, что показывается в мастере импорта */
export interface UvttSummary {
  /** Версия формата, как её объявил редактор */
  format: number | null;
  /** Ширина карты в пикселях (клетки × размер клетки) */
  widthPx: number;
  /** Высота карты в пикселях */
  heightPx: number;
  /** Размер клетки в пикселях */
  pixelsPerGrid: number;
  /** Число полилиний стен */
  wallCount: number;
  /** Число полилиний препятствий-объектов */
  objectWallCount: number;
  /** Число порталов (дверей/окон) */
  portalCount: number;
  /** Число источников света */
  lightCount: number;
  /** Есть ли встроенная картинка карты */
  hasImage: boolean;
  /** Свет уже впечён в картинку */
  bakedLighting: boolean;
}

/**
 * Читает файл как текст.
 *
 * `File.text()` есть во всех браузерах, где работает приложение; отдельный
 * `FileReader` тут не нужен.
 *
 * @param file - выбранный пользователем файл
 * @returns содержимое файла текстом
 */
async function readFileText(file: File): Promise<string> {
  return file.text();
}

/**
 * Проверяет, похоже ли имя файла на Universal VTT.
 *
 * @param fileName - имя файла
 * @returns true, если расширение известно модулю
 */
export function isUvttFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();

  return UVTT_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * Проверяет, похоже ли имя файла на растровую карту.
 *
 * @param fileName - имя файла
 * @returns true, если расширение известно модулю
 */
export function isImageFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();

  return IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * Разбирает файл Universal VTT.
 *
 * Содержимое файла — данные из внешнего мира, поэтому проверяется схемой, а не
 * принимается на веру: битый или чужой JSON должен дать понятную ошибку, а не
 * поехавшую сцену.
 *
 * @param file - выбранный пользователем файл
 * @returns разобранная карта
 * @throws Error с человекочитаемым описанием, если файл не разобрался
 */
export async function parseUvttFile(file: File): Promise<UvttMap> {
  const text = await readFileText(file);

  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(
      'Файл не является JSON. Dungeondraft экспортирует карту через '
        + '«File → Export → Universal VTT».',
    );
  }

  const parsed = uvttMapSchema.safeParse(raw);

  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];

    const where = firstIssue?.path.length
      ? ` (поле «${firstIssue.path.join('.')}»)`
      : '';

    throw new Error(
      `Файл не похож на Universal VTT${where}: ${
        firstIssue?.message ?? 'структура не распознана'
      }`,
    );
  }

  return parsed.data;
}

/**
 * Собирает сводку по карте для показа пользователю.
 *
 * @param map - разобранная карта
 * @returns сводка с размерами и количеством объектов
 */
export function summarizeUvtt(map: UvttMap): UvttSummary {
  const pixelsPerGrid = map.resolution.pixels_per_grid;

  return {
    format: map.format ?? null,
    widthPx: Math.round(map.resolution.map_size.x * pixelsPerGrid),
    heightPx: Math.round(map.resolution.map_size.y * pixelsPerGrid),
    pixelsPerGrid,
    wallCount: map.line_of_sight?.length ?? 0,
    objectWallCount: map.objects_line_of_sight?.length ?? 0,
    portalCount: map.portals?.length ?? 0,
    lightCount: map.lights?.length ?? 0,
    hasImage: Boolean(map.image),
    bakedLighting: map.environment?.baked_lighting ?? false,
  };
}

/**
 * Превращает встроенную в карту base64-картинку в `Blob`.
 *
 * @param base64 - содержимое поля `image`
 * @returns бинарные данные картинки
 * @throws Error если строка не декодируется
 */
export function decodeEmbeddedImage(base64: string): Blob {
  // Некоторые редакторы всё же пишут data-URL целиком — отрезаем префикс.
  const payload = base64.startsWith('data:')
    ? (base64.split(',')[1] ?? '')
    : base64;

  let binary: string;

  try {
    binary = atob(payload.replace(/\s/g, ''));
  } catch {
    throw new Error('Встроенная картинка карты повреждена (не base64)');
  }

  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: detectImageMime(bytes) });
}

/**
 * Определяет тип картинки по сигнатуре первых байт.
 *
 * Расширения у встроенной картинки нет, а серверу нужен осмысленный MIME:
 * по нему он решает, перекодировать ли файл в WebP.
 *
 * @param bytes - начало файла
 * @returns MIME-тип картинки
 */
function detectImageMime(bytes: Uint8Array): string {
  const isPng =
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e
    && bytes[3] === 0x47;

  if (isPng) {
    return 'image/png';
  }

  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;

  if (isJpeg) {
    return 'image/jpeg';
  }

  const isWebp =
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42
    && bytes[11] === 0x50;

  if (isWebp) {
    return 'image/webp';
  }

  return 'image/png';
}
