/**
 * Проверка сетевого клиента на локальном сервере, который ведёт себя как
 * раздражённая Википедия: отвечает 429, просит подождать, падает с 500
 *
 * Реальный 429 у чужого публичного сервиса намеренно не вызывается
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { HttpError, fetchJson, httpStats } from '../src/data/httpClient';

let bad = 0;
const ok = (c: boolean, m: string): void => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m);
  if (!c) bad += 1;
};

const hits = new Map<string, number>();
const starts: number[] = [];
let concurrentNow = 0;
let concurrentPeak = 0;

function handler(req: IncomingMessage, res: ServerResponse): void {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  const hit = (hits.get(path) ?? 0) + 1;
  hits.set(path, hit);
  concurrentNow += 1;
  concurrentPeak = Math.max(concurrentPeak, concurrentNow);
  const start = Date.now();

  const finish = (status: number, body: string, headers: Record<string, string> = {}): void => {
    // Небольшая задержка, чтобы параллельность вообще была наблюдаема
    setTimeout(() => {
      concurrentNow -= 1;
      starts.push(start);
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(body);
    }, 60);
  };

  if (path === '/ok') return finish(200, '{"ok":true}');
  if (path === '/limited') {
    return hit <= 2 ? finish(429, '{}', { 'retry-after': '1' }) : finish(200, '{"ok":true}');
  }
  if (path === '/limited-bare') return hit <= 1 ? finish(429, '{}') : finish(200, '{"ok":true}');
  if (path === '/bad') return finish(400, '{}');
  if (path === '/always429') return finish(429, '{}');
  return finish(404, '{}');
}

const server = createServer(handler);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const never = new AbortController().signal;

console.log('429 с заголовком Retry-After:');
{
  const before = httpStats.retries;
  const t0 = Date.now();
  await fetchJson(`${base}/limited`, never);
  ok(hits.get('/limited') === 3, 'сервер получил 3 попытки (2 отказа + успех)');
  ok(httpStats.retries - before === 2, 'клиент засчитал 2 повтора');
  ok(Date.now() - t0 >= 2000, `паузы взяты из Retry-After: ${Date.now() - t0} мс`);
}

console.log('\n429 без заголовка — своя экспонента:');
{
  const before = httpStats.rateLimited;
  await fetchJson(`${base}/limited-bare`, never);
  ok(httpStats.rateLimited - before === 1, 'счётчик 429 увеличился, запрос доехал');
}

console.log('\nНеповторяемая ошибка:');
{
  try {
    await fetchJson(`${base}/bad`, never);
    ok(false, '400 должен бросить');
  } catch (error) {
    ok(error instanceof HttpError && error.status === 400, '400 → HttpError со статусом');
  }
  ok(hits.get('/bad') === 1, '400 не повторялся — ровно одна попытка');
}

console.log('\nИсчерпание попыток:');
{
  try {
    await fetchJson(`${base}/always429`, never);
    ok(false, 'должно было бросить');
  } catch (error) {
    ok(error instanceof HttpError && error.status === 429, 'бросает HttpError 429');
  }
  ok(hits.get('/always429') === 4, `${hits.get('/always429') ?? 0} попытки (1 + 3 повтора)`);
}

console.log('\nПараллельность и интервал:');
{
  starts.length = 0;
  concurrentPeak = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: 6 }, () => fetchJson(`${base}/ok`, never)));
  const elapsed = Date.now() - t0;

  ok(concurrentPeak <= 2, `одновременно не больше 2 (пик ${concurrentPeak})`);
  const sorted = [...starts].sort((a, b) => a - b);
  const gaps = sorted.slice(1).map((s, i) => s - (sorted[i] ?? 0));
  ok(Math.min(...gaps) >= 150, `интервал выдержан (минимальный ${Math.min(...gaps)} мс)`);
  ok(elapsed >= 5 * 220, `6 запросов заняли ${elapsed} мс — залпом не ушли`);
}

console.log('\nОтмена:');
{
  const controller = new AbortController();
  const promise = fetchJson(`${base}/always429`, controller.signal);
  setTimeout(() => {
    controller.abort(new Error('размонтирование'));
  }, 100);

  const t0 = Date.now();
  try {
    await promise;
    ok(false, 'должно было отклониться');
  } catch (error) {
    ok(String(error).includes('размонтирование'), 'отклонено причиной отмены');
    ok(Date.now() - t0 < 2000, `пауза прервана за ${Date.now() - t0} мс`);
  }
}

server.close();
console.log(bad ? `\n${bad} проверок провалено` : '\nВсе проверки пройдены');
if (bad) process.exitCode = 1;
