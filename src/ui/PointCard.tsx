import { useEffect } from 'react';

import type { GamePoint } from '../data/points';
import type { Rarity } from '../types';

const RARITY_LABEL: Record<Rarity, string> = {
  legendary: 'легендарная',
  epic: 'эпическая',
  rare: 'редкая',
  common: 'обычная',
};

export interface PointCardProps {
  readonly point: GamePoint;
  readonly available: boolean;
  readonly collected: boolean;
  readonly multiplier: number;
  readonly onCollect: (pointId: string) => void;
  readonly onClose: () => void;
  readonly onNeedEnrichment: (pointId: string) => void;
}

/**
 * Карточка выбранной точки
 *
 * ТРАФИК ИЗОБРАЖЕНИЙ. Адреса миниатюр приезжают вместе с обогащением, но сами
 * файлы не загружаются, пока карточка не открыта: <img> появляется в DOM
 * только здесь. Поэтому требование «разумный трафик при панорамировании»
 * выполняется по построению — при движении по карте не скачивается ни одного
 * байта картинок, сколько бы точек ни было на экране
 */
export function PointCard({
  point,
  available,
  collected,
  multiplier,
  onCollect,
  onClose,
  onNeedEnrichment,
}: PointCardProps): React.JSX.Element {
  useEffect(() => {
    if (!point.enriched) onNeedEnrichment(point.id);
  }, [point.enriched, point.id, onNeedEnrichment]);

  const reward = Math.floor(point.basePoints * multiplier);

  return (
    <div className="pokemap-card" role="dialog" aria-label={point.title}>
      <button className="pokemap-card__close" type="button" onClick={onClose} aria-label="Закрыть">
        ×
      </button>

      {point.thumbnailUrl ? (
        <img
          className="pokemap-card__image"
          src={point.thumbnailUrl}
          alt={point.title}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className="pokemap-card__image pokemap-card__image--empty">
          {point.enriched ? 'без изображения' : 'загрузка…'}
        </div>
      )}

      <div className="pokemap-card__body">
        <div className={`pokemap-card__rarity pokemap-card__rarity--${point.rarity}`}>
          {RARITY_LABEL[point.rarity]} · {point.basePoints} очк.
        </div>

        <b className="pokemap-card__title">{point.title}</b>

        {point.description && <div className="pokemap-card__desc">{point.description}</div>}

        {collected ? (
          <div className="pokemap-card__status">уже собрана</div>
        ) : available ? (
          <button
            className="pokemap-card__collect"
            type="button"
            onClick={() => {
              onCollect(point.id);
            }}
          >
            собрать · {reward} очк.
            {multiplier > 1 ? ` (×${multiplier.toFixed(1)})` : ''}
          </button>
        ) : (
          <div className="pokemap-card__status">подойдите ближе</div>
        )}
      </div>
    </div>
  );
}
