<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { FileViewer } from '@file-viewer/vue3-full'

const currentFile = ref<File | null>(null)
const isDraggingOver = ref(false)
const fileInputEl = ref<HTMLInputElement | null>(null)

function openFilePicker(): void {
  fileInputEl.value?.click()
}

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) currentFile.value = file
  input.value = ''
}

function onDrop(event: DragEvent): void {
  isDraggingOver.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) currentFile.value = file
}

function onDragOver(): void {
  isDraggingOver.value = true
}

function onDragLeave(): void {
  isDraggingOver.value = false
}

function closeFile(): void {
  currentFile.value = null
}

onMounted(() => {
  window.api.onMenuOpenFile(openFilePicker)
})

onUnmounted(() => {
  window.electron.ipcRenderer.removeAllListeners('menu:open-file')
})
</script>

<template>
  <div
    class="flex h-full w-full flex-col bg-neutral-100 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
  >
    <input ref="fileInputEl" type="file" class="hidden" @change="onFileChange" />

    <header
      class="flex h-12 shrink-0 items-center gap-3 border-b border-neutral-200 px-4 dark:border-neutral-800"
    >
      <button
        type="button"
        class="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        @click="openFilePicker"
      >
        Open File
      </button>
      <span v-if="currentFile" class="truncate text-sm text-neutral-600 dark:text-neutral-400">
        {{ currentFile.name }}
      </span>
      <button
        v-if="currentFile"
        type="button"
        class="ml-auto rounded-md px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800"
        @click="closeFile"
      >
        Close
      </button>
    </header>

    <main class="relative min-h-0 flex-1">
      <FileViewer
        v-if="currentFile"
        :key="currentFile.name + currentFile.lastModified"
        :file="currentFile"
        :options="{ theme: 'system', toolbar: true }"
        class="h-full w-full"
      />

      <div
        v-else
        class="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center"
      >
        <p class="text-lg font-medium text-neutral-500 dark:text-neutral-400">
          Drop a file here, or click "Open File"
        </p>
        <p class="text-sm text-neutral-400 dark:text-neutral-600">
          PDF, Office documents, CAD, images, archives, and more
        </p>
      </div>

      <div
        v-if="isDraggingOver"
        class="pointer-events-none absolute inset-0 flex items-center justify-center border-4 border-dashed border-blue-500 bg-blue-500/10"
      >
        <p class="text-lg font-semibold text-blue-600 dark:text-blue-300">Drop to open</p>
      </div>
    </main>
  </div>
</template>
