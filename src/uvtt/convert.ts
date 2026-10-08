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

/**
 * Насколько близко (в клетках) последняя точка контура должна подойти к
 * первой, чтобы контур считался замкнутым. Dungeondraft обходит круглые
 * объекты почти полностью, но не до конца — остаётся зазор в доли пикселя.
 */
const CLOSURE_TOLERANCE_CELLS = 0.05;

/** Тип стены, которым становится конкретный портал */
export type PortalWallType = 'door' | 'secret-door' | 'window';

/**
 * Чем считать порталы карты.
 *
 * `auto` — по состоянию в редакторе: закрытый портал — дверь, открытый — окно.
 * Universal VTT двери и окна не различает, а Dungeondraft отдаёт окна
 * открытыми, двери — закрытыми; поэтому это догадка, а не данные формата.
 */
export type PortalKind = 'auto' | PortalWallType;

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
 * Округляет координату до сотых пикселя — точнее сцене не нужно, а запись в
 * базе становится короче.
 *
 * @param value - координата в пикселях сцены
 * @returns округлённая координата
 */
function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Замыкает почти замкнутый контур: последнюю точку, подошедшую к первой ближе
 * {@link CLOSURE_TOLERANCE_CELLS}, ставит ровно в первую.
 *
 * Иначе между концами контура остаётся щель в доли пикселя, и луч зрения
 * может в неё проскочить. Открытые ломаные (стены между проёмами) не
 * трогаются: замкнуть их значило бы провести стену поперёк комнаты.
 *
 * @param line - точки полилинии в клетках
 * @returns та же полилиния, замкнутая точно, если была замкнута почти
 */
function snapClosure(line: UvttPoint[]): UvttPoint[] {
  const first = line[0];
  const last = line.at(-1);

  if (!first || !last || line.length < 3) {
    return line;
  }

  const gap = Math.hypot(first.x - last.x, first.y - last.y);

  if (gap === 0 || gap > CLOSURE_TOLERANCE_CELLS) {
    return line;
  }

  return [...line.slice(0, -1), first];
}

/**
 * Режет полилинию на отрезки из двух точек.
 *
 * В VTTG одна стена — это ровно один отрезок: рендер стен и расчёт зрения
 * берут из `points` только первые четыре числа. Полилиния из N точек, отданная
 * одной стеной, рисовалась бы одним первым отрезком, а зрение и движение
 * перекрывал бы только он — сквозь остальную стену было бы видно и ходить.
 *
 * @param points - точки полилинии в пикселях сцены
 * @returns отрезки вида `[x1, y1, x2, y2]`; вырожденные (нулевой длины) пропущены
 */
export function splitIntoSegments(points: { x: number; y: number }[]): number[][] {
  const segments: number[][] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];

    if (!start || !end) {
      continue;
    }

    const segment = [
      roundCoordinate(start.x),
      roundCoordinate(start.y),
      roundCoordinate(end.x),
      roundCoordinate(end.y),
    ];

    const isDegenerate = segment[0] === segment[2] && segment[1] === segment[3];

    if (!isDegenerate) {
      segments.push(segment);
    }
  }

  return segments;
}

/**
 * Выбирает тип стены для конкретного портала.
 *
 * @param kind - выбор пользователя в мастере
 * @param closed - был ли портал закрыт в редакторе
 * @returns тип стены портала
 */
function resolvePortalWallType(kind: PortalKind, closed: boolean): PortalWallType {
  if (kind !== 'auto') {
    return kind;
  }

  return closed ? 'door' : 'window';
}

/**
 * Собирает обычную стену из отрезка.
 *
 * @param points - отрезок `[x1, y1, x2, y2]`
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
 * @param points - отрезок полотна `[x1, y1, x2, y2]`
 * @param kind - тип стены портала
 * @param closed - был ли портал закрыт на момент экспорта
 * @returns стена-портал для сцены
 */
function buildPortal(
  points: number[],
  kind: PortalWallType,
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

  // Каждая полилиния режется на отрезки: в VTTG стена — ровно один отрезок
  // (см. `splitIntoSegments`). Полилиния из одной точки даёт ноль отрезков и
  // пропускается сама собой.
  for (const polyline of wallPolylines) {
    const scenePoints = snapClosure(polyline).map(toScenePoint);

    for (const segment of splitIntoSegments(scenePoints)) {
      walls.push(buildWall(segment));
    }
  }

  if (options.importPortals) {
    for (const portal of map.portals ?? []) {
      const closed = portal.closed ?? true;
      const wallType = resolvePortalWallType(options.portalKind, closed);

      for (const segment of splitIntoSegments(portal.bounds.map(toScenePoint))) {
        walls.push(buildPortal(segment, wallType, closed));
      }
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
