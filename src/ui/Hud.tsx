import { CITIES, type CityId } from '../config';

export interface HudProps {
  readonly score: number;
  readonly collectedCount: number;
  readonly multiplier: number;
  readonly frozen: boolean;
  readonly cityId: CityId;
  readonly onCityChange: (city: CityId) => void;
  readonly onReset: () => void;
}

/**
 * Игровая панель
 *
 * Вся вёрстка — position: absolute внутри корня виджета. Никакого fixed:
 * под transform у #cms-canvas он привязался бы к полотну конструктора,
 * а не к вьюпорту
 */
export function Hud({
  score,
  collectedCount,
  multiplier,
  frozen,
  cityId,
  onCityChange,
  onReset,
}: HudProps): React.JSX.Element {
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

      <div className={comboClass} title={frozen ? 'рост множителя заморожен' : 'комбо'}>
        ×{multiplier.toFixed(1)}
        {frozen && <span className="pokemap-hud__freeze">заморожено</span>}
      </div>

      <span className="pokemap-hud__spacer" />

      <select
        className="pokemap-hud__select"
        value={cityId}
        onChange={(event) => {
          onCityChange(event.target.value as CityId);
        }}
        aria-label="Город"
      >
        {Object.entries(CITIES).map(([id, city]) => (
          <option key={id} value={id}>
            {city.name}
          </option>
        ))}
      </select>

      <button className="pokemap-hud__button" type="button" onClick={onReset}>
        сбросить
      </button>
    </div>
  );
}
