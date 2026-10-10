import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        // image-worker：sharp 图片处理子进程（Linux 上隔离 glib 冲突）
        entry: ['electron/main.ts', 'electron/image-worker.ts'],
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: [
                'ffmpeg-static',
                'ffprobe-static',
                'sharp',
                'electron'
              ]
            }
          }
        }
      },
      preload: {
        input: 'electron/preload.ts',
        vite: {
          build: {
            outDir: 'dist-electron'
          }
        }
      },
      renderer: {}
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  build: {
    outDir: 'dist-renderer',
    emptyOutDir: true
  },
  server: {
    port: 5173
  }
})
