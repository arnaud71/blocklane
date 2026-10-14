import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

export function startServer(): ReturnType<typeof createApp> {
  const config = loadConfig();
  const server = createApp({ config });
  server.on('error', () => {
    console.error(
      'The HTTP server could not listen. Check HOST, PORT and whether another process uses the port.',
    );
    process.exitCode = 1;
  });
  server.listen(config.port, config.host, () => {
    console.info(`Blockchain observer listening on ${config.host}:${config.port}`);
  });
  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    startServer();
  } catch {
    console.error(
      'Server configuration is invalid. Check host, port, upstream URLs, rate limit and trusted proxy settings.',
    );
    process.exitCode = 1;
  }
}
