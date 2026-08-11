import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,

    proxy: {
      '/api': {
        /*
          127.0.0.1, not "localhost", on purpose. Node 17+ resolves "localhost" to ::1 first on
          Windows, while Kestrel may only be listening on the IPv4 loopback -- which surfaces as an
          opaque proxy failure even though the API is running. An explicit IPv4 address removes the
          ambiguity. Must match applicationUrl in src/DSR.API/Properties/launchSettings.json.
        */
        target: 'http://127.0.0.1:5199',
        changeOrigin: true,
        secure: false,

        /*
          Without this handler an unreachable API produces a bare 500 with no body, which looks like
          a server bug in the DSR code rather than "the API is not running". Return a response in
          the same envelope the client already understands so the UI shows a real message.
        */
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            const reason = err.code === 'ECONNREFUSED'
              ? 'The API is not running on http://127.0.0.1:5199. Start it with: cd src/DSR.API && dotnet run'
              : `Proxy error contacting the API: ${err.message}`;

            console.error(`\n[vite-proxy] ${reason}\n`);

            if (res.writableEnded) return;
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ succeeded: false, message: reason, data: null, errors: null }));
          });
        },
      },
    },
  },

  build: { outDir: 'dist', sourcemap: true },
});
