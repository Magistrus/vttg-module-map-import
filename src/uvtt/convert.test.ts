/**
 * Проверки перевода Universal VTT в сущности сцены.
 *
 * Здесь проверяется именно то, на чём импорт ломается молча: системы координат,
 * масштаб сжатого фона и порядок каналов в цвете Godot.
 */

import type { UvttMap } from './schema';

import { describe, expect, it } from 'vitest';

import { convertUvtt, normalizeColor, splitIntoSegments } from './convert';

/** Настройки по умолчанию для тестов: импортируем всё, масштаб 1:1 */
const baseOptions = {
  scale: 1,
  importObjectWalls: true,
  importPortals: true,
  portalKind: 'door' as const,
  importLights: true,
  brightRatio: 0.5,
};

/**
 * Собирает минимальную карту для теста.
 *
 * @param overrides - поля, которые нужно переопределить
 * @returns карта Universal VTT
 */
function makeMap(overrides: Partial<UvttMap> = {}): UvttMap {
  return {
    format: 1,
    resolution: {
      map_size: { x: 10, y: 8 },
      pixels_per_grid: 100,
    },
    ...overrides,
  };
}

describe('convertUvtt: координаты', () => {
  it('переводит клетки в пиксели по размеру клетки', () => {
    const map = makeMap({
      line_of_sight: [
        [
          { x: 0, y: 0 },
          { x: 2, y: 1.5 },
        ],
      ],
    });

    const { walls } = convertUvtt(map, baseOptions);

    expect(walls).toHaveLength(1);
    expect(walls[0]?.points).toEqual([0, 0, 200, 150]);
  });

  it('учитывает масштаб сжатого сервером фона', () => {
    const map = makeMap({
      line_of_sight: [
        [
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ],
      ],
    });

    const { walls } = convertUvtt(map, { ...baseOptions, scale: 0.5 });

    expect(walls[0]?.points).toEqual([50, 50, 100, 100]);
  });

  it('вычитает map_origin, когда координаты заданы в глобальной системе', () => {
    const map = makeMap({
      resolution: {
        map_origin: { x: 10, y: 10 },
        map_size: { x: 10, y: 8 },
        pixels_per_grid: 100,
      },
      line_of_sight: [
        [
          { x: 10, y: 10 },
          { x: 12, y: 11 },
        ],
      ],
    });

    const { walls } = convertUvtt(map, baseOptions);

    expect(walls[0]?.points).toEqual([0, 0, 200, 100]);
  });

  it('не трогает координаты, если они уже относительны экспортированному куску', () => {
    const map = makeMap({
      resolution: {
        map_origin: { x: 10, y: 10 },
        map_size: { x: 10, y: 8 },
        pixels_per_grid: 100,
      },
      line_of_sight: [
        [
          { x: 0, y: 0 },
          { x: 3, y: 3 },
        ],
      ],
    });

    const { walls } = convertUvtt(map, baseOptions);

    expect(walls[0]?.points).toEqual([0, 0, 300, 300]);
  });
});

describe('convertUvtt: стена — ровно один отрезок', () => {
  // В VTTG рендер стен и расчёт зрения берут из `points` только первые четыре
  // числа. Полилиния, отданная одной стеной, рисовалась бы одним отрезком, а
  // сквозь остальную стену было бы видно и ходить.

  it('режет полилинию из N точек на N − 1 отрезков', () => {
    const map = makeMap({
      line_of_sight: [
        [
          { x: 3, y: 15 },
          { x: 3, y: 3 },
          { x: 10, y: 3 },
          { x: 10, y: 5 },
        ],
      ],
    });

    const { walls } = convertUvtt(map, baseOptions);

    expect(walls.map((wall) => wall.points)).toEqual([
      [300, 1500, 300, 300],
      [300, 300, 1000, 300],
      [1000, 300, 1000, 500],
    ]);
  });

  it('у каждой стены ровно четыре числа', () => {
    const map = makeMap({
      line_of_sight: [
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 2, y: 1 },
          { x: 2, y: 3 },
        ],
      ],
      portals: [
        {
          position: { x: 5, y: 5 },
          bounds: [
            { x: 5, y: 4.5 },
            { x: 5, y: 5.5 },
          ],
          closed: true,
        },
      ],
    });

    const { walls } = convertUvtt(map, baseOptions);

    expect(walls.every((wall) => wall.points.length === 4)).toBe(true);
  });

  it('открытую ломаную стену не замыкает поперёк комнаты', () => {
    const map = makeMap({
      line_of_sight: [
        [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 4, y: 3 },
        ],
      ],
    });

    const { walls } = convertUvtt(map, baseOptions);

    expect(walls).toHaveLength(2);
    expect(walls.map((wall) => wall.points)).not.toContainEqual([400, 300, 0, 0]);
  });

  it('почти замкнутый контур объекта замыкает точно, без щели', () => {
    // Так Dungeondraft отдаёт круглые объекты: последняя точка не доходит
    // до первой на доли пикселя — в эту щель проскакивал бы луч зрения.
    const map = makeMap({
      objects_line_of_sight: [
        [
          { x: 1, y: 1 },
          { x: 2, y: 1 },
          { x: 2, y: 2 },
          { x: 1, y: 2 },
          { x: 1.004, y: 1.006 },
        ],
      ],
    });

    const { walls } = convertUvtt(map, baseOptions);
    const lastSegment = walls.at(-1)?.points ?? [];

    expect(walls).toHaveLength(4);
    expect(lastSegment.slice(2)).toEqual([100, 100]);
  });

  it('отрезок нулевой длины не создаёт', () => {
    expect(
      splitIntoSegments([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 50, y: 0 },
      ]),
    ).toEqual([[0, 0, 50, 0]]);
  });
});

describe('convertUvtt: стены и порталы', () => {
  it('пропускает вырожденные полилинии из одной точки', () => {
    const map = makeMap({
      line_of_sight: [[{ x: 1, y: 1 }]],
    });

    expect(convertUvtt(map, baseOptions).walls).toHaveLength(0);
  });

  it('не берёт стены объектов, когда это выключено', () => {
    const map = makeMap({
      line_of_sight: [
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
      ],
      objects_line_of_sight: [
        [
          { x: 2, y: 2 },
          { x: 3, y: 3 },
        ],
      ],
    });

    const { walls } = convertUvtt(map, {
      ...baseOptions,
      importObjectWalls: false,
    });

    expect(walls).toHaveLength(1);
  });

  it('делает из портала дверь и переносит её состояние', () => {
    const map = makeMap({
      portals: [
        {
          position: { x: 1, y: 1 },
          bounds: [
            { x: 1, y: 0.5 },
            { x: 1, y: 1.5 },
          ],
          closed: false,
        },
      ],
    });

    const { walls } = convertUvtt(map, baseOptions);

    expect(walls[0]?.type).toBe('door');
    expect(walls[0]?.doorState).toBe('open');
    expect(walls[0]?.points).toEqual([100, 50, 100, 150]);
  });

  it('делает из портала окно с проксимити-зрением', () => {
    const map = makeMap({
      portals: [
        {
          position: { x: 1, y: 1 },
          bounds: [
            { x: 1, y: 0.5 },
            { x: 1, y: 1.5 },
          ],
          closed: true,
        },
      ],
    });

    const { walls } = convertUvtt(map, {
      ...baseOptions,
      portalKind: 'window',
    });

    expect(walls[0]?.type).toBe('window');
    expect(walls[0]?.vision).toBe('proximity');
    expect(walls[0]?.blocksVision).toBe(false);
  });
});

describe('convertUvtt: режим «как в редакторе» для порталов', () => {
  const map = makeMap({
    portals: [
      {
        position: { x: 9, y: 26 },
        bounds: [
          { x: 8, y: 26 },
          { x: 9, y: 26 },
        ],
        closed: true,
      },
      {
        position: { x: 3, y: 16 },
        bounds: [
          { x: 3, y: 15.12 },
          { x: 3, y: 16.5 },
        ],
        closed: false,
      },
    ],
  });

  it('закрытый портал делает дверью, открытый — окном', () => {
    const { walls } = convertUvtt(map, { ...baseOptions, portalKind: 'auto' });

    expect(walls.map((wall) => wall.type)).toEqual(['door', 'window']);
    expect(walls[0]?.doorState).toBe('closed');
  });

  it('ручной выбор применяет один тип ко всем порталам', () => {
    const { walls } = convertUvtt(map, { ...baseOptions, portalKind: 'window' });

    expect(walls.map((wall) => wall.type)).toEqual(['window', 'window']);
  });
});

describe('convertUvtt: свет', () => {
  it('переводит радиус из клеток в пиксели и делит на яркий и тусклый', () => {
    const map = makeMap({
      lights: [
        {
          position: { x: 2, y: 3 },
          range: 4,
          intensity: 1,
          color: 'ffd9b3ff',
        },
      ],
    });

    const { lights } = convertUvtt(map, baseOptions);

    expect(lights[0]).toMatchObject({
      x: 200,
      y: 300,
      dimRadius: 400,
      brightRadius: 200,
      color: '#FFD9B3',
      intensity: 1,
      angle: 360,
      enabled: true,
    });
  });

  it('срезает яркость больше единицы', () => {
    const map = makeMap({
      lights: [
        {
          position: { x: 0, y: 0 },
          range: 1,
          intensity: 2,
          color: 'ffffff',
        },
      ],
    });

    expect(convertUvtt(map, baseOptions).lights[0]?.intensity).toBe(1);
  });

  it('не берёт свет, когда это выключено', () => {
    const map = makeMap({
      lights: [
        {
          position: { x: 0, y: 0 },
          range: 1,
          intensity: 1,
          color: 'ffffff',
        },
      ],
    });

    expect(
      convertUvtt(map, { ...baseOptions, importLights: false }).lights,
    ).toHaveLength(0);
  });
});

describe('normalizeColor', () => {
  it('берёт первые шесть символов у цвета Godot (альфа в конце)', () => {
    expect(normalizeColor('ffd9b380')).toBe('#FFD9B3');
  });

  it('понимает короткую и обычную запись', () => {
    expect(normalizeColor('#abc')).toBe('#AABBCC');
    expect(normalizeColor('#A1B2C3')).toBe('#A1B2C3');
  });

  it('падает на белый, если цвет не разобрать', () => {
    expect(normalizeColor('не цвет')).toBe('#FFFFFF');
  });
});
