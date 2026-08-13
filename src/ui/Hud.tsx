export interface HudProps {
  readonly score: number;
  readonly collectedCount: number;
  readonly multiplier: number;
  readonly frozen: boolean;
}

/**
 * Игровая панель
 *
 * Вся вёрстка — position: absolute внутри корня виджета. Никакого fixed:
 * под transform у #cms-canvas он привязался бы к полотну конструктора,
 * а не к вьюпорту
 */
export function Hud({ score, collectedCount, multiplier, frozen }: HudProps): React.JSX.Element {
  const comboClass = [
    'pokemap-hud__combo',
    multiplier > 1 ? 'pokemap-hud__combo--active' : '',
    frozen ? 'pokemap-hud__combo--frozen' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="pokemap-hud">
      <div className="pokemap-hud__stat">
        <span className="pokemap-hud__label">очки</span>
        <b className="pokemap-hud__score">{score}</b>
      </div>

      <div className="pokemap-hud__stat">
        <span className="pokemap-hud__label">собрано</span>
        <b>{collectedCount}</b>
      </div>

      <div className={comboClass} title={frozen ? 'комбо заморожено' : 'комбо'}>
        ×{multiplier.toFixed(1)}
        {frozen && <span className="pokemap-hud__freeze">заморожено</span>}
      </div>
    </div>
  );
}
