import { defineConfig } from 'vite';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';

const PORT = 5287;

/** First private IPv4 address, so the QR code on a laptop points phones at a reachable URL. */
function lanAddress(): string | null {
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(net.address)) return net.address;
    }
  }
  return null;
}

export default defineConfig(({ command }) => {
  const lan = command === 'serve' ? lanAddress() : null;
  return {
    base: './',
    server: { port: PORT, host: true },
    preview: { port: PORT + 1, host: true },
    define: {
      __DEV_LAN_ORIGIN__: JSON.stringify(lan ? `http://${lan}:${PORT}` : ''),
    },
    build: {
      target: 'es2022',
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        input: {
          main: resolve(import.meta.dirname, 'index.html'),
          controller: resolve(import.meta.dirname, 'controller.html'),
          marker: resolve(import.meta.dirname, 'marker.html'),
        },
      },
    },
    test: { include: ['tests/**/*.test.ts'] },
  } as never;
});
