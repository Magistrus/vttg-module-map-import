/**
 * Точка входа модуля «Импорт карт».
 *
 * Регистрирует кнопку в тулбаре сцены и окно мастера импорта. Вся работа —
 * в мастере: сам модуль только подключает UI и хранит ссылку на API хоста.
 *
 * @module main
 */

import type { VttgModuleApi } from './types/vttg';

import { defineComponent, h, markRaw } from 'vue';

import ImportModal from './ui/ImportModal.vue';
import ToolbarButton from './ui/ToolbarButton.vue';

/** ID модуля — должен совпадать с `id` в module.json */
const MODULE_ID = 'map-import';

/** Порядок кнопки в тулбаре: после встроенных инструментов сцены */
const TOOLBAR_ORDER = 60;

VTTModules.register(MODULE_ID, (api: VttgModuleApi) => {
  /** ID открытого окна мастера — чтобы не плодить копии по второму клику */
  let openedModalId: string | null = null;

  /** Открывает окно мастера импорта. */
  function openImportModal(): void {
    if (openedModalId) {
      api.modals.close(openedModalId);
    }

    openedModalId = api.modals.open({
      moduleId: MODULE_ID,
      title: 'Импорт карты',
      component: markRaw(ImportModal),
      props: { api },
    });
  }

  // Обёртка нужна, чтобы прокинуть обработчик клика: слот отдаёт компоненту
  // только контекст тулбара (`isAdmin`, `activeTool`), а слушателей не вешает.
  const toolbarEntry = defineComponent({
    name: 'MapImportToolbarButton',
    // Слот отдаёт весь свой контекст пропсами; всё, чего мы не объявили
    // (`activeTool`), иначе осело бы атрибутами на <button> в DOM.
    inheritAttrs: false,
    props: {
      isAdmin: { type: Boolean, default: false },
    },
    setup(toolbarProps) {
      return () =>
        h(ToolbarButton, {
          isAdmin: toolbarProps.isAdmin,
          onOpen: openImportModal,
        });
    },
  });

  api.extensions.register({
    moduleId: MODULE_ID,
    slotName: 'toolbar:buttons',
    component: markRaw(toolbarEntry),
    order: TOOLBAR_ORDER,
    label: 'Импорт карты',
  });
});
