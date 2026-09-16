<script setup lang="ts">
  /**
   * Кнопка модуля в левом тулбаре сцены.
   *
   * Слот `toolbar:buttons` передаёт компоненту контекст `{ isAdmin, activeTool }`
   * — берём из него `isAdmin`, чтобы у игроков кнопки не было вовсе: импорт всё
   * равно доступен только мастеру.
   *
   * Иконки хоста (`UIcon`) модулю недоступны, а классы Tailwind у него свои,
   * поэтому кнопка нарисована собственным CSS и inline-SVG.
   */

  const props = withDefaults(
    defineProps<{
      /** Является ли текущий пользователь мастером (приходит из слота) */
      isAdmin?: boolean;
    }>(),
    { isAdmin: false },
  );

  const emit = defineEmits<{
    /** Пользователь нажал кнопку */
    open: [];
  }>();

  /** Обрабатывает клик по кнопке. */
  function handleClick(): void {
    emit('open');
  }
</script>

<template>
  <button
    v-if="props.isAdmin"
    class="mi-toolbar-button"
    type="button"
    title="Импорт карты (Dungeondraft / Universal VTT)"
    @click="handleClick"
  >
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12.5 20.5 9 19l-6 2V5l6-2 6 2 6-2v10" />
      <path d="M9 3v16" />
      <path d="M15 5v6" />
      <path d="M16 19h6" />
      <path d="M19 16v6" />
    </svg>
  </button>
</template>

<style scoped>
  .mi-toolbar-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    color: var(--ui-text-muted, #a1a1aa);
    cursor: pointer;
    background: transparent;
    border: none;
    border-radius: 8px;
    transition: background-color 0.15s ease, color 0.15s ease;
  }

  .mi-toolbar-button:hover {
    color: var(--ui-text, #e5e7eb);
    background-color: var(--ui-bg-elevated, rgb(255 255 255 / 8%));
  }

  .mi-toolbar-button svg {
    width: 20px;
    height: 20px;
  }
</style>
