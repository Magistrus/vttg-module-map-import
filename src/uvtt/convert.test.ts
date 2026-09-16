/**
 * Проверки перевода Universal VTT в сущности сцены.
 *
 * Здесь проверяется именно то, на чём импорт ломается молча: системы координат,
 * масштаб сжатого фона и порядок каналов в цвете Godot.
 */

import type { UvttMap } from './schema';

import { describe, expect, it } from 'vitest';

import { convertUvtt, normalizeColor } from './convert';

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
