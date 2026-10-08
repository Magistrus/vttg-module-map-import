<script setup lang="ts">
  /**
   * Мастер импорта карты: выбор файла → разбор → настройки → импорт.
   *
   * Окно рисуется внутри `UDraggableModal` хоста, поэтому здесь только
   * содержимое: ни заголовка, ни кнопки закрытия.
   */

  import type { ImportResult, ImportSettings, ImportStage } from '@/import/runImport';
  import type { UvttSummary } from '@/uvtt/parse';
  import type { UvttMap } from '@/uvtt/schema';
  import type { VttgModuleApi } from '@/types/vttg';

  import { computed, ref } from 'vue';
  import { z } from 'zod';

  import { BRIGHT_RATIO, runImport } from '@/import/runImport';
  import { convertUvtt } from '@/uvtt/convert';
  import {
    isImageFileName,
    isUvttFileName,
    parseUvttFile,
    summarizeUvtt,
  } from '@/uvtt/parse';

  const props = defineProps<{
    /** API модуля, выданное хостом */
    api: VttgModuleApi;
    /** ID модуля (подставляет хост) */
    moduleId?: string;
  }>();

  /**
   * Ключ, под которым в БД мира лежат запомненные настройки импорта.
   *
   * `v2` — с режимом «авто» для проёмов. Выбор, сохранённый прежней версией
   * под старым ключом, сознательно не подхватывается: там у всех порталов был
   * один тип, и однажды выбранные «окна» молча доставались каждой следующей
   * карте — вместе с запертыми входными дверями.
   */
  const SETTINGS_KEY = 'import-defaults-v2';

  /**
   * Что из настроек мастера запоминается между импортами — только то, что
   * зависит от вкуса мастера, а не от карты. Свет и тьма решаются по каждому
   * файлу заново: у карты со впечённым светом их надо выключать всегда.
   *
   * Сохранённое значение пришло из базы мира, поэтому проверяется схемой:
   * незнакомое или битое поле просто не применяется.
   */
  const storedPreferencesSchema = z
    .object({
      importObjectWalls: z.boolean(),
      importPortals: z.boolean(),
      portalKind: z.enum(['auto', 'door', 'secret-door', 'window']),
      openAfterImport: z.boolean(),
    })
    .partial();

  /** Подписи шагов импорта */
  const STAGE_LABELS: Record<ImportStage, string> = {
    upload: 'Загрузка фона на сервер…',
    measure: 'Проверка размеров картинки…',
    scene: 'Создание сцены…',
    walls: 'Создание стен и дверей…',
    lights: 'Расстановка источников света…',
    done: 'Готово',
  };

  const map = ref<UvttMap | null>(null);
  const summary = ref<UvttSummary | null>(null);
  const sourceFileName = ref('');
  const imageFile = ref<File | null>(null);
  const parseError = ref<string | null>(null);
  const importError = ref<string | null>(null);
  const isDragging = ref(false);
  const isImporting = ref(false);
  const stage = ref<ImportStage>('upload');
  const stageProgress = ref(0);
  const result = ref<ImportResult | null>(null);

  const settings = ref<ImportSettings>({
    sceneName: '',
    importObjectWalls: true,
    importPortals: true,
    portalKind: 'auto',
    importLights: true,
    darkScene: true,
    openAfterImport: true,
  });

  /**
   * Подтягивает запомненные настройки мастера из базы мира.
   *
   * Запускается сразу при создании окна, а разбор файла его дожидается:
   * иначе настройки, пришедшие ПОСЛЕ выбора файла, перезаписали бы решения,
   * принятые по самому файлу.
   *
   * @returns промис, разрешающийся, когда настройки применены (или их нет)
   */
  async function restorePreferences(): Promise<void> {
    try {
      const stored = await props.api.settings.get(
        props.moduleId ?? 'map-import',
        SETTINGS_KEY,
      );

      const parsed = storedPreferencesSchema.safeParse(stored);

      if (parsed.success) {
        settings.value = { ...settings.value, ...parsed.data };
      }
    } catch {
      // Настроек ещё нет или их не отдали — работаем со значениями по умолчанию.
    }
  }

  const preferencesReady = restorePreferences();

  const isGM = computed(() => props.api.scene.isGM());

  /** Нужна ли отдельная картинка: в файле карты её нет */
  const needsImageFile = computed(
    () => Boolean(summary.value) && !summary.value?.hasImage,
  );

  const canImport = computed(
    () =>
      Boolean(map.value)
      && isGM.value
      && !isImporting.value
      && (!needsImageFile.value || Boolean(imageFile.value)),
  );

  /**
   * Сколько отрезков стен получится с текущими настройками.
   *
   * Считается тем же конвертером, что и сам импорт: полилиния карты режется
   * на отрезки, и их число не равно числу полилиний из сводки.
   */
  const plannedWallCount = computed(() => {
    const parsedMap = map.value;

    if (!parsedMap) {
      return 0;
    }

    return convertUvtt(parsedMap, {
      scale: 1,
      importObjectWalls: settings.value.importObjectWalls,
      importPortals: settings.value.importPortals,
      portalKind: settings.value.portalKind,
      importLights: false,
      brightRatio: BRIGHT_RATIO,
    }).walls.length;
  });

  /**
   * Разбирает выбранный файл карты.
   *
   * @param file - файл `.dd2vtt` / `.uvtt` / `.json`
   */
  async function loadUvttFile(file: File): Promise<void> {
    parseError.value = null;
    importError.value = null;
    result.value = null;

    try {
      const parsed = await parseUvttFile(file);
      const parsedSummary = summarizeUvtt(parsed);

      // Дожидаемся запомненных настроек ДО решений по файлу, иначе пришедшие
      // позже они перезаписали бы выключенный свет у карты со впечённым светом.
      await preferencesReady;

      map.value = parsed;
      summary.value = parsedSummary;
      sourceFileName.value = file.name;

      if (!settings.value.sceneName) {
        settings.value.sceneName = file.name.replace(/\.[^.]+$/, '');
      }

      // Свет решается по файлу: впечённый в картинку второй раз не
      // накладываем, а без огней тёмная сцена была бы просто чёрной.
      const shouldImportLights =
        !parsedSummary.bakedLighting && parsedSummary.lightCount > 0;

      settings.value.importLights = shouldImportLights;
      settings.value.darkScene = shouldImportLights;
    } catch (error) {
      map.value = null;
      summary.value = null;
      parseError.value =
        error instanceof Error ? error.message : 'Не удалось разобрать файл';
    }
  }

  /**
   * Разбирает список файлов: карта и, возможно, картинка к ней.
   *
   * @param files - файлы из input или drop
   */
  async function handleFiles(files: FileList | null): Promise<void> {
    if (!files) {
      return;
    }

    for (const file of Array.from(files)) {
      if (isUvttFileName(file.name)) {
        await loadUvttFile(file);
      } else if (isImageFileName(file.name)) {
        imageFile.value = file;
      }
    }
  }

  /**
   * Обрабатывает выбор файлов через системный диалог.
   *
   * @param event - событие input[type=file]
   */
  function handleFileInput(event: Event): void {
    const input = event.target;

    if (input instanceof HTMLInputElement) {
      void handleFiles(input.files);
      input.value = '';
    }
  }

  /**
   * Обрабатывает перетаскивание файлов в окно.
   *
   * @param event - событие drop
   */
  function handleDrop(event: DragEvent): void {
    isDragging.value = false;
    void handleFiles(event.dataTransfer?.files ?? null);
  }

  /** Запускает импорт с текущими настройками. */
  async function startImport(): Promise<void> {
    const parsedMap = map.value;

    if (!parsedMap || !canImport.value) {
      return;
    }

    isImporting.value = true;
    importError.value = null;
    result.value = null;
    stage.value = 'upload';
    stageProgress.value = 0;

    try {
      const imported = await runImport(
        props.api,
        {
          map: parsedMap,
          fileName: sourceFileName.value,
          imageFile: imageFile.value,
        },
        settings.value,
        (nextStage, progress) => {
          stage.value = nextStage;
          stageProgress.value = progress;
        },
      );

      result.value = imported;

      props.api.notifications.success(
        'Карта импортирована',
        `Сцена «${settings.value.sceneName}»: ${imported.wallCount} стен, `
          + `${imported.lightCount} источников света`,
      );

      // Запоминаем только вкус мастера; имя сцены, свет и тьма — свои у карты.
      void props.api.settings.set(props.moduleId ?? 'map-import', SETTINGS_KEY, {
        importObjectWalls: settings.value.importObjectWalls,
        importPortals: settings.value.importPortals,
        portalKind: settings.value.portalKind,
        openAfterImport: settings.value.openAfterImport,
      });
    } catch (error) {
      importError.value =
        error instanceof Error ? error.message : 'Импорт не удался';

      props.api.notifications.error('Импорт не удался', importError.value);
    } finally {
      isImporting.value = false;
    }
  }
</script>

<template>
  <div class="mi-root">
    <p
      v-if="!isGM"
      class="mi-alert mi-alert--error"
    >
      Импорт карт доступен только мастеру.
    </p>

    <!-- Приём файла -->
    <label
      class="mi-drop"
      :class="{ 'mi-drop--active': isDragging }"
      @dragover.prevent="isDragging = true"
      @dragleave.prevent="isDragging = false"
      @drop.prevent="handleDrop"
    >
      <input
        class="mi-drop__input"
        type="file"
        accept=".dd2vtt,.uvtt,.df2vtt,.json,.png,.jpg,.jpeg,.webp"
        multiple
        @change="handleFileInput"
      >

      <span class="mi-drop__title">
        Перетащите файл карты или нажмите, чтобы выбрать
      </span>

      <span class="mi-drop__hint">
        Universal VTT: .dd2vtt, .uvtt, .json — экспорт Dungeondraft
        («File → Export → Universal VTT»), Dungeon Alchemist, Arkenforge
      </span>
    </label>

    <p
      v-if="parseError"
      class="mi-alert mi-alert--error"
    >
      {{ parseError }}
    </p>

    <!-- Сводка по файлу -->
    <div
      v-if="summary"
      class="mi-summary"
    >
      <div class="mi-summary__row">
        <span class="mi-summary__key">Файл</span>
        <span class="mi-summary__value">{{ sourceFileName }}</span>
      </div>

      <div class="mi-summary__row">
        <span class="mi-summary__key">Размер карты</span>

        <span class="mi-summary__value">
          {{ summary.widthPx }} × {{ summary.heightPx }} px,
          клетка {{ summary.pixelsPerGrid }} px
        </span>
      </div>

      <div class="mi-summary__row">
        <span class="mi-summary__key">Найдено</span>

        <span class="mi-summary__value">
          стен: {{ summary.wallCount }},
          объектов: {{ summary.objectWallCount }},
          дверей: {{ summary.portalCount }},
          огней: {{ summary.lightCount }}
        </span>
      </div>

      <p
        v-if="summary.bakedLighting"
        class="mi-alert mi-alert--info"
      >
        В карте свет уже впечён в картинку — импорт источников света выключен,
        иначе сцена окажется засвечена дважды.
      </p>

      <p
        v-if="needsImageFile"
        class="mi-alert mi-alert--warning"
      >
        В файле нет встроенной картинки. Добавьте файл изображения карты
        (PNG/JPG/WebP) тем же перетаскиванием.
        <template v-if="imageFile">
          Выбрано: <b>{{ imageFile.name }}</b>
        </template>
      </p>
    </div>

    <!-- Настройки импорта -->
    <div
      v-if="summary"
      class="mi-form"
    >
      <label class="mi-field">
        <span class="mi-field__label">Название сцены</span>

        <input
          v-model="settings.sceneName"
          class="mi-input"
          type="text"
          placeholder="Название сцены"
        >
      </label>

      <label class="mi-check">
        <input
          v-model="settings.importObjectWalls"
          type="checkbox"
        >
        <span>
          Стены объектов ({{ summary.objectWallCount }}) — мебель, колонны
        </span>
      </label>

      <label class="mi-check">
        <input
          v-model="settings.importPortals"
          type="checkbox"
        >
        <span>Двери и проёмы ({{ summary.portalCount }})</span>
      </label>

      <label
        v-if="settings.importPortals"
        class="mi-field"
      >
        <span class="mi-field__label">Чем считать проёмы карты</span>

        <select
          v-model="settings.portalKind"
          class="mi-input"
        >
          <option value="auto">Как в редакторе: закрытые — двери, открытые — окна</option>
          <option value="door">Все — обычные двери</option>
          <option value="secret-door">Все — скрытые двери</option>
          <option value="window">Все — окна (видно вблизи)</option>
        </select>
      </label>

      <label class="mi-check">
        <input
          v-model="settings.importLights"
          type="checkbox"
        >
        <span>Источники света ({{ summary.lightCount }})</span>
      </label>

      <label class="mi-check">
        <input
          v-model="settings.darkScene"
          type="checkbox"
        >
        <span>Сделать сцену тёмной — иначе импортированный свет не виден</span>
      </label>

      <label class="mi-check">
        <input
          v-model="settings.openAfterImport"
          type="checkbox"
        >
        <span>Открыть сцену после импорта</span>
      </label>

      <p class="mi-hint">
        Будет создано отрезков стен: {{ plannedWallCount }}. Сцена создаётся скрытой —
        покажите её игрокам, когда закончите правки.
      </p>
    </div>

    <!-- Прогресс и итог -->
    <div
      v-if="isImporting"
      class="mi-progress"
    >
      <span>{{ STAGE_LABELS[stage] }}</span>

      <div class="mi-progress__track">
        <div
          class="mi-progress__bar"
          :style="{ width: `${Math.round(stageProgress * 100)}%` }"
        />
      </div>
    </div>

    <p
      v-if="importError"
      class="mi-alert mi-alert--error"
    >
      {{ importError }}
    </p>

    <div
      v-if="result"
      class="mi-alert mi-alert--success"
    >
      Сцена создана: {{ result.width }} × {{ result.height }} px,
      стен — {{ result.wallCount }}, источников света — {{ result.lightCount }}.

      <template v-if="result.scale < 0.999">
        Фон был сжат сервером (×{{ result.scale.toFixed(3) }}) — геометрия
        пересчитана под сжатую картинку.
      </template>

      <template v-if="result.uploadWarning">
        {{ result.uploadWarning }}
      </template>
    </div>

    <div class="mi-actions">
      <button
        class="mi-button mi-button--primary"
        type="button"
        :disabled="!canImport"
        @click="startImport"
      >
        Импортировать
      </button>
    </div>
  </div>
</template>

<style scoped>
  .mi-root {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 420px;
    max-width: 560px;
    font-size: 14px;
    color: var(--ui-text, #e5e7eb);
  }

  .mi-drop {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 18px;
    text-align: center;
    cursor: pointer;
    border: 1px dashed var(--ui-border-accented, #52525b);
    border-radius: 10px;
    transition: border-color 0.15s ease, background-color 0.15s ease;
  }

  .mi-drop:hover,
  .mi-drop--active {
    border-color: var(--ui-primary, #3b82f6);
    background-color: var(--ui-bg-elevated, rgb(255 255 255 / 4%));
  }

  .mi-drop__input {
    display: none;
  }

  .mi-drop__title {
    font-weight: 600;
  }

  .mi-drop__hint,
  .mi-hint {
    font-size: 12px;
    color: var(--ui-text-muted, #a1a1aa);
  }

  .mi-summary {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px;
    background-color: var(--ui-bg-elevated, rgb(255 255 255 / 4%));
    border-radius: 10px;
  }

  .mi-summary__row {
    display: flex;
    gap: 8px;
    align-items: baseline;
    justify-content: space-between;
  }

  .mi-summary__key {
    color: var(--ui-text-muted, #a1a1aa);
    white-space: nowrap;
  }

  .mi-summary__value {
    text-align: right;
  }

  .mi-form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .mi-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .mi-field__label {
    font-size: 12px;
    color: var(--ui-text-muted, #a1a1aa);
  }

  .mi-input {
    padding: 6px 10px;
    color: inherit;
    background-color: var(--ui-bg, rgb(0 0 0 / 20%));
    border: 1px solid var(--ui-border-accented, #52525b);
    border-radius: 8px;
  }

  .mi-check {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    cursor: pointer;
  }

  .mi-alert {
    padding: 8px 10px;
    font-size: 13px;
    border-radius: 8px;
  }

  .mi-alert--error {
    color: #fecaca;
    background-color: rgb(239 68 68 / 15%);
  }

  .mi-alert--warning {
    color: #fde68a;
    background-color: rgb(245 158 11 / 15%);
  }

  .mi-alert--info {
    color: #bfdbfe;
    background-color: rgb(59 130 246 / 15%);
  }

  .mi-alert--success {
    color: #bbf7d0;
    background-color: rgb(34 197 94 / 15%);
  }

  .mi-progress {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
  }

  .mi-progress__track {
    height: 6px;
    overflow: hidden;
    background-color: var(--ui-bg-accented, rgb(255 255 255 / 10%));
    border-radius: 999px;
  }

  .mi-progress__bar {
    height: 100%;
    background-color: var(--ui-primary, #3b82f6);
    transition: width 0.15s ease;
  }

  .mi-actions {
    display: flex;
    justify-content: flex-end;
  }

  .mi-button {
    padding: 7px 16px;
    font-weight: 600;
    color: inherit;
    cursor: pointer;
    background-color: var(--ui-bg-elevated, rgb(255 255 255 / 8%));
    border: none;
    border-radius: 8px;
  }

  .mi-button--primary {
    color: #fff;
    background-color: var(--ui-primary, #3b82f6);
  }

  .mi-button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
</style>
