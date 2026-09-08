<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { FileViewer } from '@file-viewer/vue3-full'

// ---------------------------------------------------------------------------
// Tabs — several files open at once, one visible at a time.
// ---------------------------------------------------------------------------
interface Tab {
  id: string
  file: File
}

const tabs = ref<Tab[]>([])
const activeTabId = ref<string | null>(null)
const activeFile = computed(() => tabs.value.find((t) => t.id === activeTabId.value)?.file ?? null)

function fileKey(file: File): string {
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || ''
  return `${rel}|${file.name}|${file.size}|${file.lastModified}`
}

function openFile(file: File): void {
  const key = fileKey(file)
  const existing = tabs.value.find((t) => fileKey(t.file) === key)
  if (existing) {
    activeTabId.value = existing.id
    return
  }
  const tab: Tab = { id: `${key}#${Date.now()}`, file }
  tabs.value.push(tab)
  activeTabId.value = tab.id
}

function closeTab(id: string): void {
  const index = tabs.value.findIndex((t) => t.id === id)
  if (index === -1) return
  tabs.value.splice(index, 1)
  if (activeTabId.value === id) {
    const next = tabs.value[index] ?? tabs.value[index - 1] ?? null
    activeTabId.value = next?.id ?? null
  }
}

// ---------------------------------------------------------------------------
// Folder sidebar — a directory tree shown when a folder is opened.
// The tree is built once into nested nodes, then flattened to visible rows
// according to which directories are expanded (no recursive component).
// ---------------------------------------------------------------------------
interface TreeNode {
  name: string
  path: string
  isDir: boolean
  children: TreeNode[]
  file?: File
}

interface Row {
  node: TreeNode
  depth: number
}

const folderName = ref<string | null>(null)
const treeRoots = ref<TreeNode[]>([])
const expandedDirs = ref<Set<string>>(new Set())
const folderInputEl = ref<HTMLInputElement | null>(null)
const fileInputEl = ref<HTMLInputElement | null>(null)
const isDraggingOver = ref(false)

function sortNodes(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  for (const n of nodes) if (n.children.length) sortNodes(n.children)
}

// Builds the tree from (file, path) pairs where `path` is relative to the
// opened folder, e.g. "src/index.ts".
function buildTree(entries: Array<{ file: File; path: string }>): TreeNode[] {
  const root: TreeNode = { name: '', path: '', isDir: true, children: [] }
  for (const { file, path } of entries) {
    const parts = path.split('/').filter(Boolean)
    let node = root
    parts.forEach((name, i) => {
      const isLast = i === parts.length - 1
      const childPath = parts.slice(0, i + 1).join('/')
      let child = node.children.find((c) => c.name === name)
      if (!child) {
        child = { name, path: childPath, isDir: !isLast, children: [] }
        node.children.push(child)
      }
      if (isLast) child.file = file
      node = child
    })
  }
  sortNodes(root.children)
  return root.children
}

const visibleRows = computed<Row[]>(() => {
  const out: Row[] = []
  const walk = (nodes: TreeNode[], depth: number): void => {
    for (const node of nodes) {
      out.push({ node, depth })
      if (node.isDir && expandedDirs.value.has(node.path)) walk(node.children, depth + 1)
    }
  }
  walk(treeRoots.value, 0)
  return out
})

function toggleDir(path: string): void {
  const next = new Set(expandedDirs.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  expandedDirs.value = next
}

function onRowClick(node: TreeNode): void {
  if (node.isDir) toggleDir(node.path)
  else if (node.file) openFile(node.file)
}

function loadFolder(name: string, entries: Array<{ file: File; path: string }>): void {
  folderName.value = name
  treeRoots.value = buildTree(entries)
  // Start fully collapsed — the user expands directories as needed.
  expandedDirs.value = new Set()
}

function closeFolder(): void {
  folderName.value = null
  treeRoots.value = []
  expandedDirs.value = new Set()
}

// ---------------------------------------------------------------------------
// Inputs — file picker, folder picker, and drag / drop (file or folder).
// ---------------------------------------------------------------------------
function openFilePicker(): void {
  fileInputEl.value?.click()
}

function openFolderPicker(): void {
  folderInputEl.value?.click()
}

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) openFile(file)
  input.value = ''
}

function onFolderChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  if (files.length) {
    const first = (files[0] as File & { webkitRelativePath: string }).webkitRelativePath
    const name = first.split('/')[0] || 'Folder'
    loadFolder(
      name,
      files.map((file) => ({
        file,
        path: (file as File & { webkitRelativePath: string }).webkitRelativePath
          .split('/')
          .slice(1)
          .join('/')
      }))
    )
  }
  input.value = ''
}

function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject))
}

async function walkDir(
  dir: FileSystemDirectoryEntry,
  prefix: string,
  out: Array<{ file: File; path: string }>
): Promise<void> {
  const reader = dir.createReader()
  let batch: FileSystemEntry[]
  do {
    batch = await readEntries(reader)
    for (const entry of batch) {
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) =>
          (entry as FileSystemFileEntry).file(resolve, reject)
        )
        out.push({ file, path: prefix + entry.name })
      } else {
        await walkDir(entry as FileSystemDirectoryEntry, prefix + entry.name + '/', out)
      }
    }
  } while (batch.length)
}

async function onDrop(event: DragEvent): Promise<void> {
  isDraggingOver.value = false

  const items = event.dataTransfer?.items
  const dirEntry = items
    ? Array.from(items)
        .map((i) => i.webkitGetAsEntry())
        .find((e): e is FileSystemDirectoryEntry => !!e && e.isDirectory)
    : undefined

  if (dirEntry) {
    const entries: Array<{ file: File; path: string }> = []
    await walkDir(dirEntry, '', entries)
    if (entries.length) loadFolder(dirEntry.name, entries)
    return
  }

  const file = event.dataTransfer?.files?.[0]
  if (file) openFile(file)
}

function onDragOver(): void {
  isDraggingOver.value = true
}

function onDragLeave(): void {
  isDraggingOver.value = false
}

onMounted(() => {
  window.api.onMenuOpenFile(openFilePicker)
  window.api.onMenuOpenFolder(openFolderPicker)
})

onUnmounted(() => {
  window.electron.ipcRenderer.removeAllListeners('menu:open-file')
  window.electron.ipcRenderer.removeAllListeners('menu:open-folder')
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
    <input
      ref="folderInputEl"
      type="file"
      class="hidden"
      webkitdirectory
      multiple
      @change="onFolderChange"
    />

    <header
      class="flex h-12 shrink-0 items-center gap-2 border-b border-neutral-200 px-4 dark:border-neutral-800"
    >
      <button
        type="button"
        class="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        @click="openFilePicker"
      >
        Open File
      </button>
      <button
        type="button"
        class="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-200 dark:border-neutral-700 dark:hover:bg-neutral-800"
        @click="openFolderPicker"
      >
        Open Folder
      </button>
    </header>

    <!-- Tab bar -->
    <div
      v-if="tabs.length"
      class="flex h-9 shrink-0 items-stretch gap-px overflow-x-auto border-b border-neutral-200 bg-neutral-200/60 dark:border-neutral-800 dark:bg-neutral-800/60"
    >
      <div
        v-for="tab in tabs"
        :key="tab.id"
        class="group flex max-w-[16rem] shrink-0 cursor-pointer items-center gap-2 border-r border-neutral-200 px-3 text-sm dark:border-neutral-800"
        :class="
          tab.id === activeTabId
            ? 'bg-neutral-100 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100'
            : 'text-neutral-500 hover:bg-neutral-100/60 dark:hover:bg-neutral-900/60'
        "
        @click="activeTabId = tab.id"
      >
        <span class="truncate">{{ tab.file.name }}</span>
        <button
          type="button"
          class="rounded p-0.5 text-neutral-400 opacity-0 hover:bg-neutral-300 group-hover:opacity-100 dark:hover:bg-neutral-700"
          :class="{ 'opacity-100': tab.id === activeTabId }"
          aria-label="Close tab"
          @click.stop="closeTab(tab.id)"
        >
          <svg
            viewBox="0 0 14 14"
            class="h-3 w-3"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M3 3l8 8M11 3l-8 8" stroke-linecap="round" />
          </svg>
        </button>
      </div>
    </div>

    <div class="flex min-h-0 flex-1">
      <!-- Directory sidebar -->
      <aside
        v-if="folderName"
        class="flex w-64 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950"
      >
        <div
          class="flex h-8 shrink-0 items-center gap-2 border-b border-neutral-200 px-2 text-xs font-semibold tracking-wide uppercase dark:border-neutral-800"
        >
          <span class="truncate">{{ folderName }}</span>
          <button
            type="button"
            class="ml-auto rounded p-0.5 text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800"
            aria-label="Close folder"
            @click="closeFolder"
          >
            <svg
              viewBox="0 0 14 14"
              class="h-3 w-3"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M3 3l8 8M11 3l-8 8" stroke-linecap="round" />
            </svg>
          </button>
        </div>
        <div class="min-h-0 flex-1 overflow-auto py-1 text-sm">
          <button
            v-for="row in visibleRows"
            :key="row.node.path"
            type="button"
            class="flex w-full items-center gap-1 py-0.5 pr-2 text-left hover:bg-neutral-200 dark:hover:bg-neutral-800"
            :class="{
              'bg-neutral-200 dark:bg-neutral-800':
                !row.node.isDir && activeFile && activeFile === row.node.file
            }"
            :style="{ paddingLeft: `${row.depth * 12 + 8}px` }"
            @click="onRowClick(row.node)"
          >
            <span v-if="row.node.isDir" class="w-3 shrink-0 text-neutral-400">
              {{ expandedDirs.has(row.node.path) ? '▾' : '▸' }}
            </span>
            <span v-else class="w-3 shrink-0" />
            <span class="truncate" :class="{ 'text-neutral-500': row.node.isDir }">
              {{ row.node.name }}
            </span>
          </button>
        </div>
      </aside>

      <!-- Viewer -->
      <main class="relative min-h-0 flex-1">
        <FileViewer
          v-if="activeFile"
          :key="activeTabId ?? ''"
          :file="activeFile"
          :options="{ theme: 'system', toolbar: true }"
          class="h-full w-full"
        />

        <div
          v-else
          class="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center"
        >
          <p class="text-lg font-medium text-neutral-500 dark:text-neutral-400">
            Drop a file or folder here, or use "Open File" / "Open Folder"
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
  </div>
</template>
