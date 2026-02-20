import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CONTROL_GROUPS,
  INITIAL_PARAMS,
  clamp,
  deriveModel,
  deriveSimulationState,
  findNextLocalEclipse,
  getRealParameters,
} from './simulation.js';
import { VIEWS } from './views.js';

const SPEED_MIN = 1;
const SPEED_MAX = 10000000;
const SPEED_PRESETS = [1, 60, 3600, 86400, 604800, 10000000];
const EARTH_MODES = [
  { key: 'map', label: '2D КАРТА' },
  { key: 'globe', label: '3D ГЛОБУС' },
];

export default function App() {
  const [params, setParams] = useState(INITIAL_PARAMS);
  const [activeViewId, setActiveViewId] = useState(VIEWS[0].id);
  const [earthMode, setEarthMode] = useState('map');
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(3600);
  const [simHours, setSimHours] = useState(0);
  const [startDate, setStartDate] = useState(() => new Date());
  const [landDataVersion, setLandDataVersion] = useState(0);
  const [viewport, setViewport] = useState({
    cssWidth: 960,
    cssHeight: 540,
    pixelWidth: 960,
    pixelHeight: 540,
    dpr: 1,
  });

  const frameRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!isPlaying) return undefined;
    let rafId = 0;
    let prev = performance.now();

    const tick = (now) => {
      const elapsedMs = now - prev;
      prev = now;
      setSimHours((current) => current + (elapsedMs / 3600000) * speed);
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [isPlaying, speed]);

  useEffect(() => {
    if (!frameRef.current) return undefined;

    const updateViewport = () => {
      if (!frameRef.current) return;
      const rect = frameRef.current.getBoundingClientRect();
      const cssWidth = Math.max(260, Math.floor(rect.width));
      const cssHeight = Math.max(220, Math.floor(rect.height));
      const dpr = window.devicePixelRatio || 1;
      setViewport({
        cssWidth,
        cssHeight,
        pixelWidth: Math.round(cssWidth * dpr),
        pixelHeight: Math.round(cssHeight * dpr),
        dpr,
      });
    };

    updateViewport();
    const observer = new ResizeObserver(updateViewport);
    observer.observe(frameRef.current);
    window.addEventListener('resize', updateViewport);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateViewport);
    };
  }, []);

  useEffect(() => {
    const onLandDataReady = () => setLandDataVersion((value) => value + 1);
    window.addEventListener('land-data-ready', onLandDataReady);
    return () => window.removeEventListener('land-data-ready', onLandDataReady);
  }, []);

  const liveState = useMemo(
    () => deriveSimulationState(params, simHours, startDate),
    [params, simHours, startDate],
  );
  const model = useMemo(() => deriveModel(liveState), [liveState]);
  const activeView = useMemo(
    () => VIEWS.find((item) => item.id === activeViewId) ?? VIEWS[0],
    [activeViewId],
  );
  const simDate = useMemo(
    () => new Date(startDate.getTime() + simHours * 3600000),
    [startDate, simHours],
  );
  const speedSliderValue = useMemo(() => speedToSlider(speed), [speed]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = viewport.pixelWidth;
    canvas.height = viewport.pixelHeight;
    canvas.style.width = `${viewport.cssWidth}px`;
    canvas.style.height = `${viewport.cssHeight}px`;

    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
    activeView.draw(
      context,
      model,
      {
        width: viewport.cssWidth,
        height: viewport.cssHeight,
      },
      { earthMode },
    );
  }, [activeView, earthMode, landDataVersion, model, viewport]);

  const metrics = useMemo(
    () => [
      { key: 'class', label: 'Класс', value: model.eclipseClass },
      { key: 'depth', label: 'Глубина', value: `${(model.depth * 100).toFixed(1)}%` },
      { key: 'offset', label: 'Луна-Солнце', value: `${model.moonToSun.toFixed(2)}°` },
      {
        key: 'moonDistance',
        label: 'Луна',
        value: `${Math.round(model.moonDistanceKm).toLocaleString('ru-RU')} км`,
      },
      { key: 'centerLat', label: 'Широта тени', value: `${model.centralLat.toFixed(2)}°` },
      { key: 'centerLon', label: 'Долгота тени', value: `${model.centralLon.toFixed(2)}°` },
      {
        key: 'observerDistance',
        label: 'До тени',
        value: `${Math.round(model.observerToShadowKm).toLocaleString('ru-RU')} км`,
      },
      { key: 'clock', label: 'Время', value: formatClock(simDate) },
    ],
    [model, simDate],
  );
  const activeViewDescription = useMemo(() => {
    if (activeView.id !== 'earth') return activeView.description;
    return earthMode === 'globe'
      ? 'Тот же центр тени, дорожка и освещенность, что на карте, но в 3D-проекции глобуса.'
      : 'Карта Меркатора: зона дня/ночи, континенты, дорожка тени и текущее пятно затмения.';
  }, [activeView, earthMode]);
  const modeLabel = useMemo(() => {
    if (activeView.id !== 'earth') return activeView.name;
    return earthMode === 'globe' ? 'Земля / 3D' : 'Земля / 2D';
  }, [activeView, earthMode]);

  const updateField = (key, value) => {
    setParams((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="app-shell">
      <header className="topbar panel">
        <div className="brand">
          <p className="brand-title">ECLIPSE / ATLAS</p>
          <p className="brand-subtitle">black-white realtime simulator</p>
        </div>
        <div className="status-cluster">
          <div className="status-chip">
            <span className={`status-dot ${isPlaying ? 'live' : ''}`} />
            <strong>{isPlaying ? 'PLAY' : 'PAUSE'}</strong>
          </div>
          <div className="status-chip mono">{formatSpeed(speed)}</div>
          <div className="status-chip mono">{formatClock(simDate)}</div>
        </div>
      </header>

      <main className="workspace">
        <aside className="panel controls-panel">
          <section className="playback-card">
            <h2>SIMULATION</h2>

            <div className="play-buttons">
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => setIsPlaying((current) => !current)}
              >
                {isPlaying ? 'Пауза' : 'Старт'}
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setParams(getRealParameters(startDate));
                  setSimHours(0);
                  setIsPlaying(false);
                }}
              >
                Реальные
              </button>
            </div>
            <button
              className="btn"
              type="button"
              style={{ width: '100%', marginBottom: '0.65rem' }}
              onClick={() => {
                const nextT = findNextLocalEclipse(params, simHours, startDate);
                if (nextT !== null) {
                  setSimHours(nextT);
                  setIsPlaying(false);
                } else {
                  alert('Затмение не найдено в ближайшие 800 лет.');
                }
              }}
            >
              Следующее затмение в этой точке
            </button>

            <label className="control-line">
              <div className="control-head">
                <span>Скорость</span>
                <strong>{formatSpeed(speed)}</strong>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                step="0.1"
                value={speedSliderValue}
                onChange={(event) => setSpeed(sliderToSpeed(Number(event.target.value)))}
              />
            </label>

            <div className="preset-row">
              {SPEED_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={`chip ${speed === preset ? 'active' : ''}`}
                  onClick={() => setSpeed(preset)}
                >
                  {formatSpeed(preset)}
                </button>
              ))}
            </div>

            <label className="control-line">
              <div className="control-head">
                <span>Старт</span>
                <strong>{formatDate(startDate)}</strong>
              </div>
              <input
                type="datetime-local"
                value={toDateInputValue(startDate)}
                onChange={(event) => {
                  const date = new Date(event.target.value);
                  if (!Number.isNaN(date.getTime())) setStartDate(date);
                }}
              />
            </label>
          </section>

          {CONTROL_GROUPS.map((group) => (
            <section className="control-group" key={group.title}>
              <h3>{group.title}</h3>
              {group.fields.map((field) => (
                <label className="control-line" key={field.key}>
                  <div className="control-head">
                    <span>{field.label}</span>
                    <strong>{formatValue(params[field.key], field.unit)}</strong>
                  </div>
                  <input
                    type="range"
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    value={params[field.key]}
                    onChange={(event) => updateField(field.key, Number(event.target.value))}
                  />
                </label>
              ))}
            </section>
          ))}
        </aside>

        <section className="panel stage-panel">
          <div className="tabs-wrap">
            <div className="tabs">
              {VIEWS.map((view) => (
                <button
                  key={view.id}
                  type="button"
                  className={`tab ${activeViewId === view.id ? 'active' : ''}`}
                  onClick={() => setActiveViewId(view.id)}
                >
                  {view.name}
                </button>
              ))}
            </div>
            {activeView.id === 'earth' && (
              <div className="subtabs">
                {EARTH_MODES.map((mode) => (
                  <button
                    key={mode.key}
                    type="button"
                    className={`subtab ${earthMode === mode.key ? 'active' : ''}`}
                    onClick={() => setEarthMode(mode.key)}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="canvas-frame" ref={frameRef}>
            <canvas
              className="viewport-canvas"
              ref={canvasRef}
              aria-label="Визуализация солнечного затмения"
            />
          </div>

          <footer className="stage-meta">
            <p className="view-description">{activeViewDescription}</p>
            <p className="mode-label">{modeLabel}</p>
          </footer>
        </section>
      </main>

      <section className="panel metrics-grid">
        {metrics.map((metric) => (
          <article key={metric.key} className="metric-card">
            <p className="metric-label">{metric.label}</p>
            <p className="metric-value">{metric.value}</p>
          </article>
        ))}
      </section>
    </div>
  );
}

function formatValue(value, unit) {
  if (unit === '') {
    if (Math.abs(value) < 1) return value.toFixed(3);
    return value.toFixed(2);
  }
  return `${value.toFixed(1)}${unit}`;
}

function formatSpeed(speed) {
  return `${Math.round(speed).toLocaleString('ru-RU')}x`;
}

function speedToSlider(speed) {
  const min = Math.log10(SPEED_MIN);
  const max = Math.log10(SPEED_MAX);
  const clamped = clamp(speed, SPEED_MIN, SPEED_MAX);
  return ((Math.log10(clamped) - min) / (max - min)) * 100;
}

function sliderToSpeed(sliderValue) {
  const min = Math.log10(SPEED_MIN);
  const max = Math.log10(SPEED_MAX);
  const value = min + (clamp(sliderValue, 0, 100) / 100) * (max - min);
  return Math.max(1, Math.round(10 ** value));
}

const clockFormatter = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'medium',
  timeStyle: 'medium',
});

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatClock(date) {
  return clockFormatter.format(date);
}

function formatDate(date) {
  return dateFormatter.format(date);
}

function toDateInputValue(date) {
  const timezoneOffset = date.getTimezoneOffset() * 60000;
  const localDate = new Date(date.getTime() - timezoneOffset);
  return localDate.toISOString().slice(0, 16);
}
