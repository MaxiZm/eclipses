const DEG = Math.PI / 180;

const state = {
  ascendingNodeLon: 42,
  descendingNodeLon: 222,
  sunEclipticLon: 30,
  moonNodePhase: 5,
  moonDistanceMode: 0,
  moonAnomaly: 180,
  observerLat: 55,
  observerLon: 37,
  observerTilt: 18,
  earthRotation: 0,
};

const controlsConfig = [
  {
    title: 'Орбиты и узлы',
    fields: [
      ['ascendingNodeLon', 'Долгота восходящего узла, °', 0, 360, 1],
      ['descendingNodeLon', 'Долгота нисходящего узла, °', 0, 360, 1],
      ['moonNodePhase', 'Положение Луны относительно узла, °', -40, 40, 0.5],
    ],
  },
  {
    title: 'Солнце и Луна',
    fields: [
      ['sunEclipticLon', 'Эклиптическая долгота Солнца, °', 0, 360, 1],
      ['moonDistanceMode', 'Расстояние Луны (0=перигей, 1=апогей)', 0, 1, 0.01],
      ['moonAnomaly', 'Аномалия Луны, °', 0, 360, 1],
    ],
  },
  {
    title: 'Наблюдатель на Земле',
    fields: [
      ['observerLat', 'Широта наблюдателя, °', -90, 90, 1],
      ['observerLon', 'Долгота наблюдателя, °', -180, 180, 1],
      ['observerTilt', 'Угол взгляда для глобуса, °', 0, 60, 1],
      ['earthRotation', 'Поворот Земли, °', 0, 360, 1],
    ],
  },
];

const views = [
  {
    id: 'mercator',
    name: '1) Меркатор',
    description: 'Карта Земли в проекции Меркатора с дорожкой максимальной фазы затмения.',
    draw: drawMercator,
  },
  {
    id: 'globe',
    name: '2) Глобулярный вид',
    description: 'Диск Земли с возможностью менять положение наблюдателя и наклон оси просмотра.',
    draw: drawGlobe,
  },
  {
    id: 'eclipticPole',
    name: '3) От полюса эклиптики',
    description: 'Вид для оценки глубины затмения: положение Солнца и Луны в эклиптической плоскости.',
    draw: drawEclipticPole,
  },
  {
    id: 'observer',
    name: '4) От наблюдателя',
    description: 'Локальное небо для заданной широты и долготы наблюдателя.',
    draw: drawObserver,
  },
  {
    id: 'sun',
    name: '5) Вид от Солнца',
    description: 'Умбра и пенумбра на Земле в «солнечном» направлении.',
    draw: drawSunView,
  },
  {
    id: 'cross',
    name: '6) Поперечный разрез',
    description: 'Схематический поперечный разрез Солнце-Луна-Земля и конус тени.',
    draw: drawCrossSection,
  },
];

let activeView = views[0].id;

const controlsRoot = document.getElementById('controls');
const tabsRoot = document.getElementById('tabs');
const metricsRoot = document.getElementById('metrics');
const viewDescription = document.getElementById('viewDescription');
const canvas = document.getElementById('viewport');
const ctx = canvas.getContext('2d');

initControls();
initTabs();
render();

function initControls() {
  controlsConfig.forEach((group) => {
    const section = document.createElement('section');
    section.className = 'control-group';

    const title = document.createElement('h3');
    title.textContent = group.title;
    section.appendChild(title);

    group.fields.forEach(([key, label, min, max, step]) => {
      const wrapper = document.createElement('label');
      const caption = document.createElement('span');
      caption.textContent = label;

      const value = document.createElement('span');
      value.className = 'value';
      value.id = `${key}Value`;

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = min;
      slider.max = max;
      slider.step = step;
      slider.value = state[key];

      slider.addEventListener('input', (event) => {
        state[key] = Number(event.target.value);
        if (key === 'ascendingNodeLon') {
          state.descendingNodeLon = (state.ascendingNodeLon + 180) % 360;
          const descEl = document.querySelector('input[data-key="descendingNodeLon"]');
          if (descEl) descEl.value = state.descendingNodeLon;
        }
        updateControlValues();
        render();
      });

      slider.dataset.key = key;
      wrapper.append(caption, value, slider);
      section.appendChild(wrapper);
    });

    controlsRoot.appendChild(section);
  });
  updateControlValues();
}

function updateControlValues() {
  Object.keys(state).forEach((key) => {
    const el = document.getElementById(`${key}Value`);
    if (el) {
      el.textContent = Number(state[key]).toFixed(key === 'moonDistanceMode' ? 2 : 1);
    }
  });
}

function initTabs() {
  views.forEach((view) => {
    const btn = document.createElement('button');
    btn.className = `tab ${view.id === activeView ? 'active' : ''}`;
    btn.textContent = view.name;
    btn.addEventListener('click', () => {
      activeView = view.id;
      syncTabs();
      render();
    });
    btn.dataset.id = view.id;
    tabsRoot.appendChild(btn);
  });
}

function syncTabs() {
  tabsRoot.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.id === activeView);
  });
}

function render() {
  const derived = deriveModel(state);
  const view = views.find((v) => v.id === activeView);
  viewDescription.textContent = view.description;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  view.draw(ctx, derived);

  drawMetrics(derived);
}

function deriveModel(s) {
  const moonDistanceKm = 363300 + s.moonDistanceMode * (405500 - 363300);
  const sunToNode = normalize180(s.sunEclipticLon - s.ascendingNodeLon);
  const moonEclipticLon = s.ascendingNodeLon + s.moonNodePhase;
  const moonToSun = normalize180(moonEclipticLon - s.sunEclipticLon);

  const alignment = Math.max(0, 1 - Math.abs(moonToSun) / 18);
  const nodeFactor = Math.max(0, 1 - Math.abs(s.moonNodePhase) / 22);
  const distanceFactor = 1 - s.moonDistanceMode * 0.35;
  const depth = clamp(alignment * nodeFactor * distanceFactor, 0, 1);

  const centralLat = clamp(s.moonNodePhase * 1.6 - sunToNode * 0.1, -70, 70);
  const centralLon = normalize180(-s.sunEclipticLon + s.earthRotation * 1.2);

  return {
    ...s,
    moonDistanceKm,
    sunToNode,
    moonEclipticLon,
    moonToSun,
    depth,
    centralLat,
    centralLon,
    shadowRadiusDeg: 9 + (1 - depth) * 8 + s.moonDistanceMode * 4,
  };
}

function drawMetrics(m) {
  const items = [
    ['Глубина затмения', `${(m.depth * 100).toFixed(1)} %`],
    ['Отклонение Луны от Солнца', `${m.moonToSun.toFixed(2)}°`],
    ['Солнце относительно узла', `${m.sunToNode.toFixed(2)}°`],
    ['Расстояние до Луны', `${Math.round(m.moonDistanceKm).toLocaleString('ru-RU')} км`],
    ['Центр тени (широта)', `${m.centralLat.toFixed(2)}°`],
    ['Центр тени (долгота)', `${m.centralLon.toFixed(2)}°`],
  ];

  metricsRoot.innerHTML = '';
  for (const [k, v] of items) {
    const div = document.createElement('div');
    div.className = 'metric';
    div.innerHTML = `<div class="k">${k}</div><div class="v">${v}</div>`;
    metricsRoot.appendChild(div);
  }
}

function drawMercator(ctx, m) {
  const { width, height } = ctx.canvas;
  const pad = 40;
  const w = width - pad * 2;
  const h = height - pad * 2;

  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 1;
  for (let lat = -60; lat <= 60; lat += 30) {
    const y = latToY(lat, pad, h);
    line(ctx, pad, y, pad + w, y, '#1a1a1a');
  }
  for (let lon = -180; lon <= 180; lon += 30) {
    const x = lonToX(lon, pad, w);
    line(ctx, x, pad, x, pad + h, '#1a1a1a');
  }

  ctx.fillStyle = '#111';
  ctx.fillRect(pad, pad, w, h);

  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let lon = -180; lon <= 180; lon += 2) {
    const lat = m.centralLat + Math.sin((lon + m.earthRotation) * DEG) * 12 * (1 - m.moonDistanceMode * 0.4);
    const x = lonToX(lon, pad, w);
    const y = latToY(lat, pad, h);
    if (lon === -180) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  const cx = lonToX(m.centralLon, pad, w);
  const cy = latToY(m.centralLat, pad, h);
  ctx.fillStyle = `rgba(255,255,255,${0.03 + m.depth * 0.12})`;
  const rx = (m.shadowRadiusDeg / 180) * w;
  const ry = (m.shadowRadiusDeg / 140) * h;
  ellipse(ctx, cx, cy, rx, ry, true);

  marker(ctx, cx, cy, '#fff');
}

function drawGlobe(ctx, m) {
  const { width, height } = ctx.canvas;
  const cx = width * 0.5;
  const cy = height * 0.53;
  const r = Math.min(width, height) * 0.36;

  ctx.fillStyle = '#111';
  circle(ctx, cx, cy, r, true);
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1;
  circle(ctx, cx, cy, r);

  ctx.strokeStyle = '#1e1e1e';
  for (let lat = -60; lat <= 60; lat += 30) {
    const rr = r * Math.cos(lat * DEG);
    ellipse(ctx, cx, cy, rr, r * 0.24);
  }

  const rot = m.earthRotation * DEG;
  for (let lon = -120; lon <= 120; lon += 30) {
    const x = cx + Math.sin((lon * DEG) + rot) * r;
    line(ctx, x, cy - r * 0.9, x, cy + r * 0.9, '#1e1e1e');
  }

  const p = sphereProject(m.centralLat, m.centralLon, r, cx, cy, m.observerTilt, m.earthRotation);
  if (p.visible) {
    ctx.fillStyle = `rgba(255,255,255,${0.05 + m.depth * 0.15})`;
    circle(ctx, p.x, p.y, r * 0.12 + m.shadowRadiusDeg * 0.5, true);
    marker(ctx, p.x, p.y, '#fff');
  }

  const obs = sphereProject(m.observerLat, m.observerLon, r, cx, cy, m.observerTilt, m.earthRotation);
  if (obs.visible) {
    marker(ctx, obs.x, obs.y, '#888');
  }
}

function drawEclipticPole(ctx, m) {
  const { width, height } = ctx.canvas;
  const midY = height * 0.5;
  const left = 120;
  const right = width - 120;

  line(ctx, left, midY, right, midY, '#333', 1);
  const nodeX = lerp(left, right, (m.ascendingNodeLon % 360) / 360);
  line(ctx, nodeX, midY - 90, nodeX, midY + 90, '#555', 1);

  const sunX = lerp(left, right, (m.sunEclipticLon % 360) / 360);
  const moonX = lerp(left, right, ((m.moonEclipticLon % 360) + 360) / 360);

  ctx.fillStyle = '#fff';
  circle(ctx, sunX, midY, 16, true);
  ctx.fillStyle = '#888';
  circle(ctx, moonX, midY - m.moonNodePhase * 3, 12 + (1 - m.moonDistanceMode) * 5, true);

  ctx.fillStyle = '#666';
  ctx.font = '14px Inter, sans-serif';
  ctx.fillText('Эклиптика', left + 8, midY - 10);
  ctx.fillStyle = '#aaa';
  ctx.font = '14px Inter, sans-serif';
  ctx.fillText(`Глубина: ${(m.depth * 100).toFixed(1)}%`, left + 8, midY + 32);

  const barW = right - left;
  ctx.fillStyle = '#111';
  ctx.fillRect(left, height - 70, barW, 20);
  ctx.fillStyle = '#fff';
  ctx.fillRect(left, height - 70, barW * m.depth, 20);
}

function drawObserver(ctx, m) {
  const { width, height } = ctx.canvas;
  const horizonY = height * 0.7;
  line(ctx, 60, horizonY, width - 60, horizonY, '#333', 1);

  const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
  skyGrad.addColorStop(0, '#080808');
  skyGrad.addColorStop(1, '#000');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, width, horizonY);

  const azSun = (m.sunEclipticLon - m.observerLon + 360) % 360;
  const altSun = 50 - Math.abs(m.observerLat) * 0.3;
  const azMoon = (m.moonEclipticLon - m.observerLon + 360) % 360;
  const altMoon = altSun - m.moonToSun * 0.35;

  const sun = altAzToXY(azSun, altSun, width, horizonY);
  const moon = altAzToXY(azMoon, altMoon, width, horizonY);

  ctx.fillStyle = '#fff';
  circle(ctx, sun.x, sun.y, 18, true);
  ctx.fillStyle = `rgba(80,80,80,${0.3 + m.depth * 0.6})`;
  circle(ctx, moon.x, moon.y, 15 + (1 - m.moonDistanceMode) * 4, true);
  ctx.strokeStyle = '#333';
  ctx.setLineDash([7, 6]);
  line(ctx, sun.x, sun.y, moon.x, moon.y, '#333');
  ctx.setLineDash([]);

  ctx.fillStyle = '#777';
  ctx.font = '14px Inter, sans-serif';
  ctx.fillText('Локальный горизонт наблюдателя', 70, horizonY + 30);
}

function drawSunView(ctx, m) {
  const { width, height } = ctx.canvas;
  const cx = width * 0.5;
  const cy = height * 0.5;
  const r = Math.min(width, height) * 0.28;

  ctx.fillStyle = '#111';
  circle(ctx, cx, cy, r, true);
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  circle(ctx, cx, cy, r);

  const x = cx + (m.centralLon / 180) * r;
  const y = cy - (m.centralLat / 90) * r;
  const rr = r * (m.shadowRadiusDeg / 55);

  ctx.fillStyle = `rgba(255,255,255,${0.04 + m.depth * 0.14})`;
  circle(ctx, x, y, rr, true);

  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  circle(ctx, x, y, rr * 1.85);
  marker(ctx, x, y, '#fff');
}

function drawCrossSection(ctx, m) {
  const { width, height } = ctx.canvas;
  const y = height * 0.5;

  const sunX = 140;
  const moonX = width * 0.45;
  const earthX = width - 170;

  ctx.fillStyle = '#fff';
  circle(ctx, sunX, y, 58, true);
  ctx.fillStyle = '#777';
  circle(ctx, moonX, y - m.moonNodePhase * 2.2, 26 + (1 - m.moonDistanceMode) * 6, true);
  ctx.fillStyle = '#222';
  circle(ctx, earthX, y, 68, true);
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1;
  circle(ctx, earthX, y, 68);

  ctx.fillStyle = `rgba(255,255,255,${0.03 + m.depth * 0.08})`;
  ctx.beginPath();
  ctx.moveTo(moonX + 18, y - 22 - m.moonNodePhase * 2.2);
  ctx.lineTo(earthX, y - 18 - m.depth * 36);
  ctx.lineTo(earthX, y + 18 + m.depth * 36);
  ctx.lineTo(moonX + 18, y + 22 - m.moonNodePhase * 2.2);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#333';
  line(ctx, sunX, y - 58, earthX + 80, y - 120, '#333');
  line(ctx, sunX, y + 58, earthX + 80, y + 120, '#333');

  ctx.fillStyle = '#777';
  ctx.font = '14px Inter, sans-serif';
  ctx.fillText('Солнце', sunX - 30, y + 95);
  ctx.fillText('Луна', moonX - 20, y + 95);
  ctx.fillText('Земля', earthX - 22, y + 95);
}

function latToY(lat, pad, h) {
  return pad + h * (0.5 - lat / 180);
}

function lonToX(lon, pad, w) {
  return pad + ((lon + 180) / 360) * w;
}

function altAzToXY(azimuth, altitude, width, horizonY) {
  const x = 60 + ((azimuth % 360) / 360) * (width - 120);
  const y = horizonY - ((altitude + 10) / 100) * (horizonY - 30);
  return { x, y };
}

function sphereProject(lat, lon, r, cx, cy, tiltDeg, rotDeg) {
  const latR = lat * DEG;
  const lonR = (lon + rotDeg) * DEG;
  const tilt = tiltDeg * DEG;

  const x = Math.cos(latR) * Math.sin(lonR);
  const y0 = Math.sin(latR);
  const z0 = Math.cos(latR) * Math.cos(lonR);

  const y = y0 * Math.cos(tilt) - z0 * Math.sin(tilt);
  const z = y0 * Math.sin(tilt) + z0 * Math.cos(tilt);

  return {
    x: cx + x * r,
    y: cy - y * r,
    visible: z > 0,
  };
}

function marker(ctx, x, y, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  line(ctx, x - 8, y, x + 8, y, color, 2);
  line(ctx, x, y - 8, x, y + 8, color, 2);
}

function line(ctx, x1, y1, x2, y2, color = '#222', width = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function circle(ctx, x, y, r, fill = false) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  fill ? ctx.fill() : ctx.stroke();
}

function ellipse(ctx, x, y, rx, ry, fill = false) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  fill ? ctx.fill() : ctx.stroke();
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function normalize180(angle) {
  let a = angle % 360;
  if (a > 180) a -= 360;
  if (a < -180) a += 360;
  return a;
}

