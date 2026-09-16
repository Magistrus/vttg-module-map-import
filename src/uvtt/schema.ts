/**
 * Схема формата Universal VTT (`.dd2vtt`, `.uvtt`, `.json`).
 *
 * Формат придуман для Dungeondraft, но его же экспортируют Dungeon Alchemist,
 * Arkenforge и ряд других редакторов — поэтому парсер один на всех, а различия
 * редакторов живут в `convert.ts`.
 *
 * Схема НАРОЧНО мягкая: поля, которых нет в старых версиях формата (`format`
 * 0.2–0.3 не знает `objects_line_of_sight`), объявлены опциональными, а
 * неизвестные поля просто игнорируются. Валидируется только то, без чего
 * импорт не имеет смысла.
 *
 * @module uvtt/schema
 */

import { z } from 'zod';

/** Точка в координатах СЕТКИ (не в пикселях): 1.0 — одна клетка */
export const uvttPointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

/** Полилиния стены — последовательность точек */
export const uvttPolylineSchema = z.array(uvttPointSchema);

/**
 * Портал — дверь или окно. Что именно, формат не различает: у портала есть
 * только геометрия и признак «закрыт». Тип двери выбирает пользователь при
 * импорте.
 */
export const uvttPortalSchema = z.object({
  /** Центр портала в координатах сетки */
  position: uvttPointSchema,
  /** Две крайние точки полотна двери */
  bounds: z.array(uvttPointSchema),
  /** Поворот в радианах (нужен только самому редактору) */
  rotation: z.number().optional(),
  /** Закрыт ли портал на момент экспорта */
  closed: z.boolean().optional(),
  /** Портал стоит сам по себе, не врезан в стену */
  freestanding: z.boolean().optional(),
});

/** Источник света */
export const uvttLightSchema = z.object({
  /** Позиция в координатах сетки */
  position: uvttPointSchema,
  /** Радиус свечения в КЛЕТКАХ */
  range: z.number(),
  /** Яркость; редакторы пишут сюда и значения больше единицы */
  intensity: z.number(),
  /** Цвет в виде hex-строки (Godot отдаёт `RRGGBBAA`) */
  color: z.string(),
  /** Отбрасывает ли источник тени */
  shadows: z.boolean().optional(),
});

/** Разрешение карты: где она начинается, какая по размеру и сколько пикселей в клетке */
export const uvttResolutionSchema = z.object({
  /** Смещение экспортированного куска в координатах сетки исходной карты */
  map_origin: uvttPointSchema.optional(),
  /** Размер карты В КЛЕТКАХ */
  map_size: uvttPointSchema,
  /** Сколько пикселей приходится на клетку */
  pixels_per_grid: z.number().positive(),
});

/** Освещение сцены целиком */
export const uvttEnvironmentSchema = z.object({
  /** Свет уже «впечён» в картинку — свои источники добавлять не нужно */
  baked_lighting: z.boolean().optional(),
  /** Цвет общего освещения (пустая строка — не задан) */
  ambient_light: z.string().optional(),
});

/** Карта в формате Universal VTT */
export const uvttMapSchema = z.object({
  /** Версия формата (0.2–1.0) */
  format: z.number().optional(),
  resolution: uvttResolutionSchema,
  /** Стены и прочие препятствия зрению */
  line_of_sight: z.array(uvttPolylineSchema).optional(),
  /** Препятствия от объектов (мебель и т.п.); появились в формате 1.0 */
  objects_line_of_sight: z.array(uvttPolylineSchema).optional(),
  /** Двери и окна */
  portals: z.array(uvttPortalSchema).optional(),
  /** Источники света */
  lights: z.array(uvttLightSchema).optional(),
  environment: uvttEnvironmentSchema.optional(),
  /** Картинка карты в base64 (без префикса `data:`) */
  image: z.string().optional(),
});

/** Точка в координатах сетки */
export type UvttPoint = z.infer<typeof uvttPointSchema>;

/** Портал (дверь/окно) */
export type UvttPortal = z.infer<typeof uvttPortalSchema>;

/** Источник света */
export type UvttLight = z.infer<typeof uvttLightSchema>;

/** Карта Universal VTT */
export type UvttMap = z.infer<typeof uvttMapSchema>;
