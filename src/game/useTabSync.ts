import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { isCollectRecord, type CollectRecord, type ProgressState } from './progress';

const CHANNEL_NAME = 'pokemap-widget/progress';

/**
 * Синхронизация прогресса между вкладками
 *
 * Транспорт — BroadcastChannel: он адресует документы одного origin, работает
 * без сервера и не требует опроса. Альтернатива, событие storage у
 * localStorage, приходит только в ДРУГИЕ вкладки и только при записи, то есть
 * навязывает запись на диск как способ передачи сообщения
 *
 * Разрешение конфликтов живёт не здесь, а в progress.ts: слияние
 * коммутативно и идемпотентно, поэтому канал может доставлять сообщения в
 * любом порядке, дублировать их и терять — состояние всё равно сойдётся
 */
export type SyncMessage =
  | { readonly kind: 'collected'; readonly by: string; readonly record: CollectRecord }
  | { readonly kind: 'reset'; readonly by: string; readonly at: number }
  | { readonly kind: 'hello'; readonly by: string }
  | {
      readonly kind: 'state';
      readonly by: string;
      readonly records: readonly CollectRecord[];
      readonly resetAt: number;
    };

export interface TabSyncHandlers {
  readonly onRecord: (record: CollectRecord) => void;
  readonly onReset: (at: number) => void;
  /** Ответ на hello: отдать своё состояние соседям */
  readonly getState: () => ProgressState;
  readonly onState: (records: readonly CollectRecord[], resetAt: number) => void;
}

export interface TabSync {
  readonly instanceId: string;
  readonly publishRecord: (record: CollectRecord) => void;
  readonly publishReset: (at: number) => void;
}

function createInstanceId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `tab-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  }
}

export function useTabSync(handlers: TabSyncHandlers): TabSync {
  // Идентификатор постоянен на всё время жизни экземпляра: он участвует в
  // разрешении ничьих при слиянии, поэтому меняться не должен
  const [instanceId] = useState(createInstanceId);
  const channelRef = useRef<BroadcastChannel | null>(null);

  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    // BroadcastChannel есть не везде, и виджет обязан работать без него —
    // просто без синхронизации
    if (typeof BroadcastChannel === 'undefined') return undefined;

    let channel: BroadcastChannel;
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
    } catch {
      return undefined;
    }
    channelRef.current = channel;

    const onMessage = (event: MessageEvent<unknown>): void => {
      const data = event.data;
      if (typeof data !== 'object' || data === null) return;

      const message = data as Partial<SyncMessage> & Record<string, unknown>;
      // Своё эхо игнорируем: канал не доставляет отправителю, но дубликат
      // всё равно был бы безвреден
      if (typeof message.by !== 'string' || message.by === instanceId) return;

      switch (message.kind) {
        case 'collected':
          if (isCollectRecord(message['record'])) {
            handlersRef.current.onRecord(message['record']);
          }
          return;

        case 'reset': {
          const at = message['at'];
          if (typeof at === 'number' && Number.isFinite(at)) handlersRef.current.onReset(at);
          return;
        }

        case 'hello': {
          // Новая вкладка открылась — делимся журналом, чтобы она догналась
          const state = handlersRef.current.getState();
          channel.postMessage({
            kind: 'state',
            by: instanceId,
            records: [...state.records.values()],
            resetAt: state.resetAt,
          } satisfies SyncMessage);
          return;
        }

        case 'state': {
          const raw = message['records'];
          const resetAt = message['resetAt'];
          if (!Array.isArray(raw)) return;
          handlersRef.current.onState(
            raw.filter(isCollectRecord),
            typeof resetAt === 'number' && Number.isFinite(resetAt) ? resetAt : 0,
          );
          return;
        }

        default:
          return;
      }
    };

    channel.addEventListener('message', onMessage);
    // Представляемся: соседи пришлют состояние, и мы догонимся
    channel.postMessage({ kind: 'hello', by: instanceId } satisfies SyncMessage);

    return () => {
      channel.removeEventListener('message', onMessage);
      channel.close();
      channelRef.current = null;
    };
  }, [instanceId]);

  const publishRecord = useCallback(
    (record: CollectRecord): void => {
      channelRef.current?.postMessage({
        kind: 'collected',
        by: instanceId,
        record,
      } satisfies SyncMessage);
    },
    [instanceId],
  );

  const publishReset = useCallback(
    (at: number): void => {
      channelRef.current?.postMessage({ kind: 'reset', by: instanceId, at } satisfies SyncMessage);
    },
    [instanceId],
  );

  // Мемоизируем результат целиком: он уходит в зависимости эффектов снаружи
  return useMemo(
    () => ({ instanceId, publishRecord, publishReset }),
    [instanceId, publishRecord, publishReset],
  );
}
