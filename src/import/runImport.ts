/**
 * Сценарий импорта: от разобранного файла до готовой сцены в мире.
 *
 * Порядок шагов важен и объясняется в комментариях: сначала фон, потом сцена,
 * потом геометрия — иначе не из чего считать масштаб и некуда класть стены.
 *
 * @module import/runImport
 */

import type { ConvertOptions, PortalKind } from '@/uvtt/convert';
import type { UvttMap } from '@/uvtt/schema';
import type { VttgLightingSettings, VttgModuleApi } from '@/types/vttg';

import { convertUvtt } from '@/uvtt/convert';
import { decodeEmbeddedImage } from '@/uvtt/parse';

/** Папка в мире, куда кладутся фоны импортированных карт */
const MAPS_FOLDER = 'maps';

/** Настройки, которые пользователь задаёт в мастере импорта */
export interface ImportSettings {
  /** Название будущей сцены */
  sceneName: string;
  /** Импортировать препятствия от объектов */
  importObjectWalls: boolean;
  /** Импортировать порталы (двери/окна) */
  importPortals: boolean;
  /** Чем считать порталы карты */
  portalKind: PortalKind;
  /** Импортировать источники света */
  importLights: boolean;
  /** Сделать сцену тёмной, чтобы импортированный свет был виден */
  darkScene: boolean;
  /** Открыть сцену сразу после импорта */
  openAfterImport: boolean;
}

/** Что импортируем: разобранный файл и, возможно, отдельная картинка карты */
export interface ImportSource {
  /** Разобранная карта */
  map: UvttMap;
  /** Имя исходного файла (из него получается имя фона) */
  fileName: string;
  /** Отдельный файл картинки, если во встроенном поле `image` её нет */
  imageFile: File | null;
}

/** Итог импорта для показа пользователю */
export interface ImportResult {
  /** ID созданной сцены */
  sceneId: string;
  /** Ширина сцены в пикселях */
  width: number;
  /** Высота сцены в пикселях */
  height: number;
  /** Сколько стен, дверей и окон создано */
  wallCount: number;
  /** Сколько источников света создано */
  lightCount: number;
  /** Предупреждение сервера при загрузке фона (сжатие и т.п.) */
  uploadWarning?: string;
  /** Во сколько раз сцена отличается от исходной карты (1 — один в один) */
  scale: number;
}

/** Шаг импорта, о котором мастер сообщает пользователю */
export type ImportStage =
  | 'upload'
  | 'measure'
  | 'scene'
  | 'walls'
  | 'lights'
  | 'done';

/** Колбэк прогресса: шаг и доля выполнения (0–1) */
export type ProgressCallback = (stage: ImportStage, progress: number) => void;

/** Доля радиуса, считающаяся ярким светом (как у света, поставленного вручную) */
export const BRIGHT_RATIO = 0.5;

/**
 * Приводит имя файла к безопасному виду для папки мира.
 *
 * Сервер и так отрезает путь из имени, но кириллица и пробелы в URL ассета
 * читаются тяжело — оставляем latin/цифры/дефисы.
 *
 * @param rawName - исходное имя файла
 * @returns имя без расширения, пригодное для файловой системы
 */
function sanitizeBaseName(rawName: string): string {
  const withoutExtension = rawName.replace(/\.[^.]+$/, '');

  const normalized = withoutExtension
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'map';
}

/**
 * Подбирает расширение файла по MIME-типу.
 *
 * @param mimeType - тип загружаемых данных
 * @returns расширение с точкой
 */
function extensionForMime(mimeType: string): string {
  if (mimeType === 'image/jpeg') {
    return '.jpg';
  }

  if (mimeType === 'image/webp') {
    return '.webp';
  }

  return '.png';
}

/**
 * Измеряет реальные размеры загруженной картинки.
 *
 * Именно загруженной, а не исходной: сервер перекодирует изображение в WebP и
 * ужимает стороны больше 8192 px. Если взять размеры из файла карты, стены и
 * свет разъедутся с фоном ровно на коэффициент сжатия.
 *
 * @param imageUrl - URL картинки на сервере мира
 * @returns размеры в пикселях
 * @throws Error если картинка не загрузилась
 */
function measureImage(
  imageUrl: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };

    image.onerror = () => {
      reject(new Error('Не удалось прочитать загруженный фон сцены'));
    };

    image.src = imageUrl;
  });
}

/**
 * Отдаёт управление браузеру, чтобы интерфейс успел перерисоваться.
 *
 * @returns промис, разрешающийся на следующем кадре
 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/**
 * Собирает настройки освещения сцены.
 *
 * @param darkScene - делать ли сцену тёмной
 * @returns настройки освещения
 */
function buildLightingSettings(darkScene: boolean): VttgLightingSettings {
  return {
    darknessLevel: darkScene ? 1 : 0,
    darknessLevelLock: false,
    globalIllumination: { enabled: !darkScene, threshold: 1 },
    lightControlsVisible: true,
  };
}

/**
 * Выполняет импорт карты в новую сцену мира.
 *
 * @param api - API модуля, выданное хостом
 * @param source - разобранная карта и её файлы
 * @param settings - выбор пользователя в мастере
 * @param onProgress - колбэк прогресса
 * @returns сведения о созданной сцене
 * @throws Error если нет прав, картинки или сервер отклонил создание сцены
 */
export async function runImport(
  api: VttgModuleApi,
  source: ImportSource,
  settings: ImportSettings,
  onProgress: ProgressCallback,
): Promise<ImportResult> {
  if (!api.scene.isGM()) {
    throw new Error('Импорт карт доступен только мастеру');
  }

  // 1. Фон. Он нужен раньше сцены: по РЕАЛЬНОМУ размеру загруженной картинки
  // считается масштаб, а по нему — размеры сцены и координаты стен.
  const imageBlob = source.imageFile ?? extractEmbeddedImage(source.map);

  if (!imageBlob) {
    throw new Error(
      'В файле нет встроенной картинки карты — выберите файл изображения '
        + 'отдельно (Dungeondraft умеет экспортировать Universal VTT без картинки)',
    );
  }

  onProgress('upload', 0);

  const baseName = sanitizeBaseName(
    source.imageFile?.name ?? source.fileName,
  );

  const fileName = `${baseName}-${Date.now()}${extensionForMime(imageBlob.type)}`;

  const uploaded = await api.assets.upload(MAPS_FOLDER, fileName, imageBlob);

  onProgress('measure', 0);

  const imageUrl = api.assets.resolveUrl(uploaded.relativePath);

  if (!imageUrl) {
    throw new Error('Сервер вернул пустой путь загруженного фона');
  }

  const measured = await measureImage(imageUrl);

  const sourceWidth =
    source.map.resolution.map_size.x * source.map.resolution.pixels_per_grid;

  // Масштаб считаем по ширине: пропорции сервер сохраняет (`fit: inside`),
  // поэтому одного измерения достаточно.
  const scale = sourceWidth > 0 ? measured.width / sourceWidth : 1;

  // 2. Сцена. Размер клетки — исходный `pixels_per_grid` с учётом масштаба,
  // тип сетки `custom`: `fixed` игнорирует свой cellSize и рисует сетку по 50 px.
  onProgress('scene', 0);

  const cellSize =
    source.map.resolution.pixels_per_grid * scale;

  const scene = await api.scene.createScene({
    name: settings.sceneName.trim() || baseName,
    width: measured.width,
    height: measured.height,
    backgroundImage: uploaded.relativePath,
    gridSettings: {
      type: 'custom',
      shape: 'square',
      cellSize: Math.round(cellSize * 100) / 100,
      visible: true,
      offsetX: 0,
      offsetY: 0,
      scale: 5,
      units: 'ft',
    },
    visibility: 'hidden',
    visionSettings: { playerVisionEnabled: false, fogOfWarEnabled: true },
    lightingSettings: buildLightingSettings(settings.darkScene),
  });

  // 3. Геометрия.
  const convertOptions: ConvertOptions = {
    scale,
    importObjectWalls: settings.importObjectWalls,
    importPortals: settings.importPortals,
    portalKind: settings.portalKind,
    importLights: settings.importLights,
    brightRatio: BRIGHT_RATIO,
  };

  const { walls, lights } = convertUvtt(source.map, convertOptions);

  onProgress('walls', 0);

  // Все стены — одним вызовом: хост сам режет их на пачки (одна запись в базу
  // и одна рассылка на пачку), а один вызов отменяется одним Ctrl+Z. Дробление
  // здесь превращало бы отмену импорта в серию Ctrl+Z по куску карты за раз.
  if (walls.length > 0) {
    api.scene.addWalls(scene.id, walls);
  }

  onProgress('walls', 1);

  // Даём интерфейсу перерисоваться: у большой карты стен тысячи.
  await nextFrame();

  onProgress('lights', 0);

  if (lights.length > 0) {
    api.scene.addLights(scene.id, lights);
  }

  onProgress('done', 1);

  if (settings.openAfterImport) {
    api.scene.openScene(scene.id);
  }

  return {
    sceneId: scene.id,
    width: measured.width,
    height: measured.height,
    wallCount: walls.length,
    lightCount: lights.length,
    uploadWarning: uploaded.warning,
    scale,
  };
}

/**
 * Достаёт встроенную картинку карты, если она есть.
 *
 * @param map - разобранная карта
 * @returns данные картинки или null
 */
function extractEmbeddedImage(map: UvttMap): Blob | null {
  if (!map.image) {
    return null;
  }

  return decodeEmbeddedImage(map.image);
}
