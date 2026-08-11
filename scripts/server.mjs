/**
 * Простой статический сервер для демо-страницы.
 *
 * ПОЧЕМУ НЕ DEV-СЕРВЕР VITE. Он пропускает файлы через свой transform-
 * пайплайн. Собранный UMD-бандл при этом отдаётся не байт-в-байт: к нему
 * подшивается inline sourcemap, а результат кэшируется в памяти сервера и
 * не обновляется после пересборки. То есть проверять интеграцию пришлось бы
 * не на том файле, который уедет на host-страницу.
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

/**
 * Интерфейс, на котором слушаем. localhost — это только петлевой адрес:
 * дев-сервер не виден из локальной сети. Через переменную окружения HOST
 * можно открыть его наружу (например, 0.0.0.0), чтобы проверить виджет
 * с телефона в той же сети.
 */
const HOST = process.env.HOST ?? 'localhost';
const PORT = Number(process.env.PORT ?? 5173);
const ORIGIN = `http://${HOST}:${PORT}`;

const ENTRY = '/demo/index.html';

const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
]);

const server = createServer((req, res) => {
  // ORIGIN здесь нужен только как база для разбора относительного пути:
  // req.url приходит без схемы и хоста, а конструктору URL нужна полная.
  const url = new URL(req.url ?? '/', ORIGIN);
  const pathname = url.pathname === '/' ? ENTRY : decodeURIComponent(url.pathname);

  // normalize + проверка префикса
  const filePath = join(ROOT, normalize(pathname));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  stat(filePath)
    .then((info) => {
      if (!info.isFile()) throw new Error('not a file');
      res.writeHead(200, {
        'content-type': CONTENT_TYPES.get(extname(filePath)) ?? 'application/octet-stream',
        // Пересборка идёт в watch-режиме — кэш только мешает
        'cache-control': 'no-store, must-revalidate',
      });
      createReadStream(filePath).pipe(res);
    })
    .catch(() => {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
    });
});

server.listen(PORT, HOST, () => {
  console.log(`демо-страница: ${ORIGIN}${ENTRY}`);
});
