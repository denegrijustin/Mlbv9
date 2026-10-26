import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { defineConfig } from 'vitest/config'

// SINGLE_FILE=1 npm run build  ->  one self-contained dist/index.html (for sharing without a server)
const single = process.env.SINGLE_FILE === '1'

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), ...(single ? [viteSingleFile()] : [])],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
