/**
 * Перевод карты Universal VTT в сущности сцены VTTG.
 *
 * Здесь живут все договорённости о системах координат и о том, как понятия
 * редакторов ложатся на понятия VTT: полилиния зрения → стена, портал → дверь,
 * `range` в клетках → радиус в пикселях.
 *
 * Функции чистые: ни сети, ни хостового API — только геометрия. Поэтому их
 * удобно проверять отдельно от импорта.
 *
 * @module uvtt/convert
 */

import type { VttgLightInput, VttgWallInput } from '@/types/vttg';

import type { UvttMap, UvttPoint } from './schema';

/** Цвет стены в редакторе стен VTTG */
const WALL_COLOR = '#FF0000';

/** Цвет двери */
const DOOR_COLOR = '#3B82F6';

/** Цвет скрытой двери */
const SECRET_DOOR_COLOR = '#8B5CF6';

/** Цвет окна */
const WINDOW_COLOR = '#00FFFF';

/** Толщина линии стены — та же, что у стен, нарисованных в приложении */
const WALL_LINE_WIDTH = 4;

/** Дистанция проксимити-зрения окна в футах (значение по умолчанию в VTTG) */
const WINDOW_PROXIMITY_FT = 30;

/** Цвет источника света, если редактор не дал разобрать свой */
const FALLBACK_LIGHT_COLOR = '#FFFFFF';

/** Тип портала, которым импортируются двери карты */
export type PortalKind = 'door' | 'secret-door' | 'window';

/** Настройки перевода карты в сущности сцены */
export interface ConvertOptions {
  /**
   * Во сколько раз пиксели готовой сцены отличаются от пикселей исходной карты.
   *
   * Сервер перекодирует загруженный фон и ужимает стороны больше 8192 px, из-за
   * чего сцена может оказаться мельче исходника. Множитель считается по РЕАЛЬНО
   * загруженной картинке — иначе стены разъезжаются с фоном.
   */
  scale: number;
  /** Импортировать препятствия от объектов (мебель, колонны) */
  importObjectWalls: boolean;
  /** Импортировать порталы */
  importPortals: boolean;
  /** Чем считать порталы карты */
  portalKind: PortalKind;
  /** Импортировать источники света */
  importLights: boolean;
  /** Доля радиуса, которая считается ярким светом (остальное — тусклый) */
  brightRatio: number;
}

/** Результат перевода карты */
export interface ConvertResult {
  /** Стены, двери и окна в координатах сцены */
  walls: VttgWallInput[];
  /** Источники света в координатах сцены */
  lights: VttgLightInput[];
}

/**
 * Проверяет, заданы ли координаты карты в глобальной системе исходного проекта.
 *
 * Редакторы расходятся: одни пишут геометрию относительно экспортированного
 * куска (0,0 — левый верхний угол картинки), другие — в координатах всей карты,
 * и тогда из них надо вычесть `map_origin`. Отличить можно по выходу за границы:
 * если точки не помещаются в размер карты, значит система координат глобальная.
 *
 * @param map - разобранная карта
 * @returns true, если из координат нужно вычитать `map_origin`
 */
function needsOriginShift(map: UvttMap): boolean {
  const origin = map.resolution.map_origin;

  if (!origin || (origin.x === 0 && origin.y === 0)) {
    return false;
  }

  const allPoints: UvttPoint[] = [
    ...(map.line_of_sight ?? []).flat(),
    ...(map.objects_line_of_sight ?? []).flat(),
    ...(map.portals ?? []).flatMap((portal) => portal.bounds),
    ...(map.lights ?? []).map((light) => light.position),
  ];

  if (allPoints.length === 0) {
    return false;
  }

  const maxX = Math.max(...allPoints.map((point) => point.x));
  const maxY = Math.max(...allPoints.map((point) => point.y));

  // Полклетки запаса: стены по краю карты законно стоят ровно на границе.
  return (
    maxX > map.resolution.map_size.x + 0.5
    || maxY > map.resolution.map_size.y + 0.5
  );
}

/**
 * Создаёт функцию перевода координат сетки в пиксели сцены.
 *
 * @param map - разобранная карта
 * @param scale - множитель из {@link ConvertOptions.scale}
 * @returns функция, превращающая точку карты в пиксели сцены
 */
function createPointMapper(
  map: UvttMap,
  scale: number,
): (point: UvttPoint) => { x: number; y: number } {
  const pixelsPerGrid = map.resolution.pixels_per_grid;
  const shift = needsOriginShift(map);
  const origin = map.resolution.map_origin;
  const offsetX = shift && origin ? origin.x : 0;
  const offsetY = shift && origin ? origin.y : 0;

  return (point) => ({
    x: (point.x - offsetX) * pixelsPerGrid * scale,
    y: (point.y - offsetY) * pixelsPerGrid * scale,
  });
}

/**
 * Разворачивает точки в плоский массив координат, который ждёт `Drawing`.
 *
 * @param points - точки полилинии в пикселях сцены
 * @returns массив вида `[x1, y1, x2, y2, …]`
 */
function flattenPoints(points: { x: number; y: number }[]): number[] {
  return points.flatMap((point) => [
    Math.round(point.x * 100) / 100,
    Math.round(point.y * 100) / 100,
  ]);
}

/**
 * Собирает обычную стену из полилинии.
 *
 * @param points - плоский массив координат
 * @returns стена для сцены
 */
function buildWall(points: number[]): VttgWallInput {
  return {
    type: 'wall',
    points,
    color: WALL_COLOR,
    width: WALL_LINE_WIDTH,
    adminOnly: true,
    blocksMovement: true,
    blocksVision: true,
    blocksLight: true,
  };
}

/**
 * Собирает портал (дверь, скрытую дверь или окно) из его границ.
 *
 * Окно в VTTG — не «дверь, которую видно насквозь», а стена с проксимити-зрением:
 * сквозь неё видно вблизи. Поэтому набор полей у окна отличается от дверей.
 *
 * @param points - плоский массив координат полотна
 * @param kind - чем считать портал
 * @param closed - был ли портал закрыт на момент экспорта
 * @returns стена-портал для сцены
 */
function buildPortal(
  points: number[],
  kind: PortalKind,
  closed: boolean,
): VttgWallInput {
  if (kind === 'window') {
    return {
      type: 'window',
      points,
      color: WINDOW_COLOR,
      width: WALL_LINE_WIDTH,
      adminOnly: true,
      blocksMovement: true,
      blocksVision: false,
      blocksLight: false,
      vision: 'proximity',
      light: 'proximity',
      attenuation: true,
      visionProximityThreshold: WINDOW_PROXIMITY_FT,
      lightProximityThreshold: WINDOW_PROXIMITY_FT,
    };
  }

  return {
    type: kind,
    points,
    color: kind === 'secret-door' ? SECRET_DOOR_COLOR : DOOR_COLOR,
    width: WALL_LINE_WIDTH,
    adminOnly: true,
    blocksMovement: true,
    blocksVision: true,
    blocksLight: true,
    doorState: closed ? 'closed' : 'open',
  };
}

/**
 * Приводит цвет редактора к hex-виду `#RRGGBB`.
 *
 * Dungeondraft построен на Godot, а `Color.to_html()` там отдаёт `RRGGBBAA` —
 * альфа в КОНЦЕ строки. Поэтому у восьмисимвольного значения берутся первые
 * шесть символов, а не последние.
 *
 * @param raw - цвет из файла карты
 * @returns цвет вида `#RRGGBB`
 */
export function normalizeColor(raw: string): string {
  const hex = raw.trim().replace(/^#/, '');

  if (/^[0-9a-f]{8}$/i.test(hex)) {
    return `#${hex.slice(0, 6).toUpperCase()}`;
  }

  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return `#${hex.toUpperCase()}`;
  }

  if (/^[0-9a-f]{3}$/i.test(hex)) {
    const [r = '0', g = '0', b = '0'] = hex.split('');

    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }

  return FALLBACK_LIGHT_COLOR;
}

/**
 * Приводит яркость редактора к диапазону источника света VTTG (0–1).
 *
 * Редакторы пишут в `intensity` и значения больше единицы (Dungeondraft —
 * вплоть до 2). Интенсивность VTTG — доля, поэтому лишнее срезается.
 *
 * @param raw - яркость из файла карты
 * @returns значение в диапазоне 0–1
 */
function normalizeIntensity(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) {
    return 0.5;
  }

  return Math.min(1, Math.max(0.05, raw));
}

/**
 * Переводит карту в стены и источники света сцены.
 *
 * @param map - разобранная карта
 * @param options - настройки импорта
 * @returns стены и источники света в координатах сцены
 */
export function convertUvtt(
  map: UvttMap,
  options: ConvertOptions,
): ConvertResult {
  const toScenePoint = createPointMapper(map, options.scale);
  const pixelsPerGrid = map.resolution.pixels_per_grid * options.scale;

  const walls: VttgWallInput[] = [];

  const wallPolylines = [
    ...(map.line_of_sight ?? []),
    ...(options.importObjectWalls ? (map.objects_line_of_sight ?? []) : []),
  ];

  for (const polyline of wallPolylines) {
    // Одна точка стеной быть не может: рисовать нечего, а серверу такая запись
    // всё равно ляжет в базу мусором.
    if (polyline.length < 2) {
      continue;
    }

    walls.push(buildWall(flattenPoints(polyline.map(toScenePoint))));
  }

  if (options.importPortals) {
    for (const portal of map.portals ?? []) {
      if (portal.bounds.length < 2) {
        continue;
      }

      walls.push(
        buildPortal(
          flattenPoints(portal.bounds.map(toScenePoint)),
          options.portalKind,
          portal.closed ?? true,
        ),
      );
    }
  }

  const lights: VttgLightInput[] = [];

  if (options.importLights) {
    for (const light of map.lights ?? []) {
      const position = toScenePoint(light.position);
      const dimRadius = light.range * pixelsPerGrid;

      lights.push({
        x: Math.round(position.x * 100) / 100,
        y: Math.round(position.y * 100) / 100,
        brightRadius: Math.round(dimRadius * options.brightRatio),
        dimRadius: Math.round(dimRadius),
        intensity: normalizeIntensity(light.intensity),
        color: normalizeColor(light.color),
        angle: 360,
        rotation: 0,
        enabled: true,
        darknessActivation: { min: 0, max: 1 },
      });
    }
  }

  return { walls, lights };
}
