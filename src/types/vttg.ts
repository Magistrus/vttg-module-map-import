/**
 * Типы хостового API VTTG, которыми пользуется модуль.
 *
 * Хост (репозиторий `vttg`) не публикует пакет с типами для авторов модулей,
 * поэтому здесь описана ровно та часть `ClientModuleAPI`, которую модуль
 * действительно вызывает. Источник правды — `docs/MODULES.md` хоста; при
 * расхождении верить документации хоста, а не этому файлу.
 *
 * @module types/vttg
 */

import type { Component } from 'vue';

/** Настройки сетки сцены (подмножество `GridSettings` хоста). */
export interface VttgGridSettings {
  /** `fixed` — сетка по умолчанию, `custom` — свой размер клетки */
  type: 'fixed' | 'custom';
  /** Форма клетки */
  shape?: 'square' | 'hex';
  /** Размер клетки в пикселях сцены */
  cellSize: number;
  /** Цвет линий сетки */
  color: string;
  /** Видна ли сетка */
  visible: boolean;
  /** Смещение сетки по X в пикселях */
  offsetX?: number;
  /** Смещение сетки по Y в пикселях */
  offsetY?: number;
  /** Сколько единиц измерения в одной клетке (обычно 5 футов) */
  scale?: number;
  /** Единица измерения расстояний */
  units?: string;
  /** Прозрачность линий сетки (0–1) */
  opacity?: number;
}

/** Настройки освещения сцены. */
export interface VttgLightingSettings {
  /** Уровень тьмы: 0 — день, 1 — полная тьма */
  darknessLevel: number;
  /** Запрет менять уровень тьмы из UI */
  darknessLevelLock: boolean;
  /** Глобальное освещение */
  globalIllumination: {
    /** Включено ли */
    enabled: boolean;
    /** Порог тьмы, после которого оно отключается */
    threshold: number;
  };
  /** Видимость иконок источников света у мастера */
  lightControlsVisible: boolean;
}

/** Стена/дверь/окно сцены (подмножество `Drawing` хоста, без `id`). */
export interface VttgWallInput {
  /** Тип линии */
  type: 'wall' | 'door' | 'window' | 'secret-door' | 'landscape';
  /** Плоский массив координат `[x1, y1, x2, y2, …]` в пикселях сцены */
  points: number[];
  /** Цвет линии в редакторе стен */
  color: string;
  /** Толщина линии */
  width: number;
  /** Видна только мастеру (у стен — всегда true) */
  adminOnly?: boolean;
  /** Замкнутый контур (полигон) */
  closed?: boolean;
  /** Состояние двери */
  doorState?: 'open' | 'closed';
  /** Блокирует движение */
  blocksMovement?: boolean;
  /** Блокирует зрение */
  blocksVision?: boolean;
  /** Блокирует свет */
  blocksLight?: boolean;
  /** Продвинутое ограничение зрения */
  vision?: 'none' | 'normal' | 'limited' | 'proximity' | 'reverseProximity';
  /** Продвинутое ограничение света */
  light?: 'none' | 'normal' | 'limited' | 'proximity' | 'reverseProximity';
  /** Адаптивное затухание (окна) */
  attenuation?: boolean;
  /** Дистанция проксимити-зрения в футах */
  visionProximityThreshold?: number;
  /** Дистанция проксимити-света в футах */
  lightProximityThreshold?: number;
}

/** Источник света сцены (подмножество `LightSource` хоста, без `id`). */
export interface VttgLightInput {
  /** X центра источника в пикселях сцены */
  x: number;
  /** Y центра источника в пикселях сцены */
  y: number;
  /** Радиус яркого света в пикселях */
  brightRadius: number;
  /** Радиус тусклого света в пикселях */
  dimRadius: number;
  /** Интенсивность (0–1) */
  intensity: number;
  /** Цвет света (hex `#RRGGBB`) */
  color: string;
  /** Угол конуса в градусах (360 — круг) */
  angle: number;
  /** Направление конуса в градусах */
  rotation: number;
  /** Включён ли источник */
  enabled: boolean;
  /** Диапазон тьмы, в котором источник светит */
  darknessActivation?: { min: number; max: number };
}

/** Сцена мира (то, что возвращает `api.scene.createScene`). */
export interface VttgScene {
  /** Идентификатор сцены */
  id: string;
  /** Название сцены */
  name: string;
  /** Ширина в пикселях */
  width: number;
  /** Высота в пикселях */
  height: number;
  /** Относительный путь фонового изображения */
  backgroundImage: string;
}

/** Параметры создаваемой сцены. */
export interface VttgSceneCreateInput {
  /** Название сцены */
  name: string;
  /** Ширина в пикселях */
  width: number;
  /** Высота в пикселях */
  height: number;
  /** Относительный путь фонового изображения */
  backgroundImage?: string;
  /** Частичные настройки сетки */
  gridSettings?: Partial<VttgGridSettings>;
  /** Видимость сцены для игроков */
  visibility?: 'hidden' | 'visible' | 'navigable';
  /** Настройки зрения и тумана войны */
  visionSettings?: {
    playerVisionEnabled: boolean;
    fogOfWarEnabled: boolean;
  };
  /** Настройки освещения */
  lightingSettings?: VttgLightingSettings;
}

/** Результат загрузки файла в папку мира. */
export interface VttgAssetUploadResult {
  /** URL раздачи файла сервером мира */
  url: string;
  /** Путь относительно корня мира — его кладут в поля сущностей */
  relativePath: string;
  /** Предупреждение сервера (например, о сжатии изображения) */
  warning?: string;
}

/** Часть `ClientModuleAPI`, которой пользуется модуль. */
export interface VttgModuleApi {
  /** Сцена: чтение и запись */
  scene: {
    /** Является ли текущий пользователь мастером */
    isGM: () => boolean;
    /** Создаёт сцену и ждёт подтверждения сервера */
    createScene: (input: VttgSceneCreateInput) => Promise<VttgScene>;
    /** Добавляет стены/двери/окна; возвращает их ID */
    addWalls: (sceneId: string, walls: readonly VttgWallInput[]) => string[];
    /** Добавляет источники света; возвращает их ID */
    addLights: (sceneId: string, lights: readonly VttgLightInput[]) => string[];
    /** Открывает сцену у текущего пользователя */
    openScene: (sceneId: string) => boolean;
  };

  /** Файлы мира */
  assets: {
    /** Загружает файл в папку мира */
    upload: (
      folderPath: string,
      fileName: string,
      data: Blob,
    ) => Promise<VttgAssetUploadResult>;
    /** Превращает относительный путь в URL для браузера */
    resolveUrl: (relativePath: string) => string | null;
  };

  /** Модальные окна модуля */
  modals: {
    /** Открывает окно; возвращает его ID */
    open: (options: {
      moduleId: string;
      component: Component;
      title?: string;
      props?: Record<string, unknown>;
    }) => string;
    /** Закрывает окно по ID */
    close: (modalId: string) => void;
    /** Закрывает все окна модуля */
    closeAll: (moduleId: string) => void;
  };

  /** Тост-уведомления */
  notifications: {
    /** Информационное уведомление */
    info: (title: string, description?: string) => void;
    /** Предупреждение */
    warning: (title: string, description?: string) => void;
    /** Ошибка */
    error: (title: string, description?: string) => void;
    /** Успех */
    success: (title: string, description?: string) => void;
  };

  /** Персистентные настройки модуля (хранятся в БД мира) */
  settings: {
    /** Читает значение настройки */
    get: (moduleId: string, key: string) => Promise<unknown>;
    /** Сохраняет значение настройки */
    set: (moduleId: string, key: string, value: unknown) => Promise<void>;
  };

  /** UI-расширения (слоты хоста) */
  extensions: {
    /** Регистрирует компонент в слоте */
    register: (registration: {
      moduleId: string;
      slotName: string;
      component: Component;
      order?: number;
      label?: string;
    }) => void;
    /** Снимает регистрацию компонента */
    unregister: (moduleId: string, slotName: string) => void;
  };

  /** Хуки жизненного цикла клиента */
  hooks: {
    /** Подписка на событие; возвращает ID подписки */
    on: (event: string, handler: (...args: unknown[]) => void) => number;
    /** Одноразовая подписка */
    once: (event: string, handler: (...args: unknown[]) => void) => number;
    /** Отписка по ID */
    off: (hookId: number) => void;
  };
}

declare global {
  /** Точка регистрации модулей, которую создаёт хост */
  // eslint-disable-next-line vars-on-top, no-var
  var VTTModules: {
    /** Регистрирует модуль по его ID */
    register: (
      moduleId: string,
      initFn: (api: VttgModuleApi) => void | Promise<void>,
    ) => void;
  };
}
