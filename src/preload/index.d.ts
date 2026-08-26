import { ElectronAPI } from '@electron-toolkit/preload'

interface FileViewerApi {
  onMenuOpenFile: (callback: () => void) => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: FileViewerApi
  }
}
