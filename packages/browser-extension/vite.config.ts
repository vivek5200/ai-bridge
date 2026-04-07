import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';

// Custom plugin to copy manifest.json and static files to dist
function copyStaticFiles() {
  return {
    name: 'copy-static-files',
    writeBundle() {
      // Copy manifest.json
      fs.copyFileSync(
        resolve(__dirname, 'src/manifest.json'),
        resolve(__dirname, 'dist/manifest.json')
      );

      // Copy popup.html
      fs.copyFileSync(
        resolve(__dirname, 'src/popup.html'),
        resolve(__dirname, 'dist/popup.html')
      );

      // Copy offscreen.html
      fs.copyFileSync(
        resolve(__dirname, 'src/offscreen.html'),
        resolve(__dirname, 'dist/offscreen.html')
      );

      // Copy content.css
      fs.copyFileSync(
        resolve(__dirname, 'src/content.css'),
        resolve(__dirname, 'dist/content.css')
      );

      // Create icons directory with placeholder
      const iconsDir = resolve(__dirname, 'dist/icons');
      if (!fs.existsSync(iconsDir)) {
        fs.mkdirSync(iconsDir, { recursive: true });
      }

      // Copy icons if they exist, otherwise create placeholder SVGs
      const sizes = [16, 48, 128];
      for (const size of sizes) {
        const src = resolve(__dirname, `src/icons/icon${size}.png`);
        const dest = resolve(iconsDir, `icon${size}.png`);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
        }
      }
    },
  };
}

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background.ts'),
        content: resolve(__dirname, 'src/content.ts'),
        offscreen: resolve(__dirname, 'src/offscreen.ts'),
        popup: resolve(__dirname, 'src/popup.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        format: 'es',
      },
    },
    target: 'esnext',
    minify: false, // Easier debugging during development
    sourcemap: 'inline',
  },
  plugins: [copyStaticFiles()],
});
