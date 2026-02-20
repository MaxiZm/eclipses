import { geoGraticule, geoMercator, geoOrthographic, geoPath } from 'd3-geo';
import { SEA_LABELS } from './earthData.js';
import {
  altAzToXY,
  clamp,
  DEG,
  RAD,
  horizontalCoordinates,
  normalize180,
  normalize360,
  overlapFraction,
  sphereProject,
} from './simulation.js';

const STAR_FIELD = Array.from({ length: 160 }, (_, idx) => {
  const x = fract(Math.sin((idx + 1) * 13.197) * 43857.121);
  const y = fract(Math.sin((idx + 1) * 29.821) * 96211.337);
  const alpha = 0.2 + fract(Math.sin((idx + 1) * 7.17) * 1000) * 0.45;
  const size = 0.45 + fract(Math.sin((idx + 1) * 11.971) * 1000) * 1.6;
  return { x, y, alpha, size };
});

const COLORS = {
  base: '#040404',
  panel: '#090909',
  grid: 'rgba(255,255,255,0.14)',
  faint: 'rgba(255,255,255,0.08)',
  text: '#f6f6f6',
  muted: 'rgba(255,255,255,0.62)',
  line: 'rgba(255,255,255,0.55)',
  lineStrong: 'rgba(255,255,255,0.88)',
};

const LAND_STORE = {
  status: 'idle',
  features: [],
};
const LAND_DATA_URL = `${import.meta.env.BASE_URL}data/ne_50m_land.json`;

export const VIEWS = [
  {
    id: 'earth',
    name: 'Земля',
    description:
      'Одна и та же геометрия тени в двух проекциях: карта Меркатора (2D) и глобус (3D).',
    draw: drawEarthView,
  },
  {
    id: 'eclipticPole',
    name: 'Эклиптика',
    description:
      'Вид с северного полюса эклиптики: гелиоцентрическая схема Солнце-Земля-Луна с линией узлов.',
    draw: drawEcliptic,
  },
  {
    id: 'moonOrbitPlane',
    name: 'Орбита Луны',
    description:
      'Геоцентрический вид на Солнце в сечении плоскостью эклиптики: узлы, наклон орбиты Луны и текущая фаза.',
    draw: drawMoonOrbitPlane,
  },
  {
    id: 'observer',
    name: 'Горизонт',
    description:
      'Локальный горизонт с азимутальной сеткой и оценкой видимой фазы затмения для выбранной точки.',
    draw: drawObserver,
  },
  {
    id: 'sun',
    name: 'Вид от Солнца',
    description:
      'Плоская проекция Земли и Луны с точки зрения Солнца.',
    draw: drawSunView,
  },
  {
    id: 'cross',
    name: 'Разрез системы',
    description:
      'Геометрический разрез Солнце-Луна-Земля с умброй/пенумброй и радиусами тени в земной плоскости.',
    draw: drawCrossSection,
  },
];

function drawEarthView(ctx, model, viewport, options = {}) {
  if (options.earthMode === 'globe') {
    drawGlobe(ctx, model, viewport);
    return;
  }
  drawMercator(ctx, model, viewport);
}

function drawMercator(ctx, model, viewport) {
  const { width, height } = viewport;
  paintFlatBackground(ctx, width, height);
  drawModeHeader(ctx, 'EARTH MAP / MERCATOR', width);

  const padX = 26;
  const padY = 46;
  const maxMapW = width - padX * 2;
  const maxMapH = height - padY - 20;
  const mapW = maxMapW;
  const mapH = Math.max(120, Math.min(maxMapH, Math.round(mapW * 0.5)));
  const mapY = padY + Math.round((maxMapH - mapH) * 0.5);
  const projection = createMercatorProjection(padX, mapY, mapW, mapH);

  ctx.fillStyle = '#080808';
  ctx.fillRect(padX, mapY, mapW, mapH);

  drawMapGrid(ctx, projection, padX, mapY, mapW, mapH);
  drawSolarIlluminationMap(ctx, model, projection, padX, mapY, mapW, mapH);
  drawMapContinents(ctx, projection, padX, mapY, mapW, mapH);
  drawSeaLabels(ctx, projection, padX, mapY, mapW, mapH);

  ctx.save();
  ctx.beginPath();
  ctx.rect(padX, mapY, mapW, mapH);
  ctx.clip();

  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 1.9;
  ctx.setLineDash([7, 4]);
  ctx.beginPath();
  let started = false;
  let prevX = 0;
  model.track.forEach((point, index) => {
    const projected = projectLonLat(projection, point.lon, point.lat);
    if (!projected) return;
    const [x, y] = projected;
    if (!started || Math.abs(x - prevX) > mapW * 0.45 || index === 0) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
    prevX = x;
  });
  ctx.stroke();
  ctx.setLineDash([]);

  const centerPoint = projectLonLat(projection, model.centralLon, model.centralLat);
  const penumbraRadiusDeg = clamp(model.penumbraRadiusDeg, 0, 89.5);
  const umbraRadiusDeg = clamp(model.umbraRadiusDeg, 0, 89.5);

  if (centerPoint && penumbraRadiusDeg > 0.05) {
    ctx.strokeStyle = 'rgba(255,255,255,0.66)';
    ctx.lineWidth = 1;
    drawSphericalCircleOnMap(
      ctx,
      projection,
      model.centralLat,
      model.centralLon,
      penumbraRadiusDeg,
      mapW,
    );
  }

  if (centerPoint && umbraRadiusDeg > 0.03) {
    ctx.fillStyle = `rgba(0,0,0,${0.5 + model.depth * 0.36})`;
    drawSphericalCircleOnMap(
      ctx,
      projection,
      model.centralLat,
      model.centralLon,
      umbraRadiusDeg,
      mapW,
      true,
    );
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1;
    drawSphericalCircleOnMap(
      ctx,
      projection,
      model.centralLat,
      model.centralLon,
      umbraRadiusDeg,
      mapW,
    );
  }

  if (centerPoint) {
    const [cx, cy] = centerPoint;
    drawCrosshair(ctx, cx, cy, 'rgba(255,255,255,0.95)', 7, 1.2);
  }
  ctx.restore();

  const observerPoint = projectLonLat(projection, model.observerLon, model.observerLat);
  if (observerPoint) {
    const [observerX, observerY] = observerPoint;
    ctx.fillStyle = '#ffffff';
    circle(ctx, observerX, observerY, 2.8, true);
    drawCrosshair(ctx, observerX, observerY, 'rgba(255,255,255,0.7)', 5, 1);
  }

  const subSolarPoint = projectLonLat(projection, model.subSolarLon, model.subSolarLat);
  const subLunarPoint = projectLonLat(projection, model.subLunarLon, model.subLunarLat);
  ctx.strokeStyle = 'rgba(255,255,255,0.42)';
  ctx.lineWidth = 1;
  if (subSolarPoint) {
    circle(ctx, subSolarPoint[0], subSolarPoint[1], 4.5);
    drawCrosshair(ctx, subSolarPoint[0], subSolarPoint[1], 'rgba(255,255,255,0.58)', 4, 1);
  }
  if (subLunarPoint) {
    circle(ctx, subLunarPoint[0], subLunarPoint[1], 3.6);
    drawCrosshair(ctx, subLunarPoint[0], subLunarPoint[1], 'rgba(255,255,255,0.5)', 3, 1);
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(padX, mapY, mapW, mapH);

  ctx.fillStyle = COLORS.muted;
  ctx.font = '500 11px IBM Plex Mono, monospace';
  ctx.fillText(
    `center ${model.centralLat.toFixed(1)} / ${model.centralLon.toFixed(1)}  depth ${(model.depth * 100).toFixed(1)}%  ${model.eclipseClass.toLowerCase()}`,
    padX + 8,
    height - 8,
  );
}

function drawGlobe(ctx, model, viewport) {
  const { width, height } = viewport;
  paintSpaceBackground(ctx, width, height);
  drawModeHeader(ctx, 'GLOBE / EARTH + LUNAR SHADOW', width);

  const cx = width * 0.5;
  const cy = height * 0.54;
  const radius = Math.min(width, height) * 0.34;
  const globeProjection = createOrthographicProjection(
    cx,
    cy,
    radius,
    model.earthRotation,
    model.observerTilt,
  );

  drawEarthDisc(ctx, {
    cx,
    cy,
    radius,
    rotationDeg: model.earthRotation,
    tiltDeg: model.observerTilt,
    subSolarLon: model.subSolarLon,
    subSolarLat: model.subSolarLat,
    projection: globeProjection,
  });

  const shadow = projectLonLat(globeProjection, model.centralLon, model.centralLat, 89.999);
  if (shadow) {
    const umbraPx = Math.max(2, radius * Math.sin((model.umbraRadiusDeg || 0) * DEG));
    const penumbraPx = Math.max(umbraPx + 1, radius * Math.sin((model.penumbraRadiusDeg || 0) * DEG));

    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    circle(ctx, shadow[0], shadow[1], penumbraPx, true);
    ctx.fillStyle = `rgba(0,0,0,${0.5 + model.depth * 0.35})`;
    circle(ctx, shadow[0], shadow[1], umbraPx, true);
    ctx.strokeStyle = 'rgba(255,255,255,0.78)';
    ctx.lineWidth = 1;
    circle(ctx, shadow[0], shadow[1], penumbraPx);
    drawCrosshair(ctx, shadow[0], shadow[1], 'rgba(255,255,255,0.86)', 7, 1.1);
  }

  ctx.fillStyle = COLORS.muted;
  ctx.font = '500 11px IBM Plex Mono, monospace';
  ctx.fillText(
    `shadow ${model.centralLat.toFixed(1)} / ${model.centralLon.toFixed(1)}   depth ${(model.depth * 100).toFixed(1)}%`,
    22,
    height - 10,
  );
}

function drawEcliptic(ctx, model, viewport) {
  const { width, height } = viewport;
  paintSpaceBackground(ctx, width, height);
  drawModeHeader(ctx, 'ECLIPTIC POLE / HELIOCENTRIC TOP VIEW', width);

  const ecl = model.geometry?.ecliptic;
  if (!ecl) return;

  const cx = width * 0.5;
  const cy = height * 0.54;
  const solarOrbitR = Math.min(width, height) * 0.34;
  const solarDistanceKm = vectorLength(ecl.earthFromSunKm);
  const worldScale = solarOrbitR / Math.max(1, solarDistanceKm);
  const lunarOrbitNominalR = clamp(384400 * worldScale, 10, 30);

  // Heliocentric top view from north ecliptic pole.
  const sunX = cx;
  const sunY = cy;
  const earthX = cx + ecl.earthFromSunKm.x * worldScale;
  const earthY = cy - ecl.earthFromSunKm.y * worldScale;
  const moonX = cx + ecl.moonFromSunKm.x * worldScale;
  const moonY = cy - ecl.moonFromSunKm.y * worldScale;

  // Ecliptic orbital ring (Earth around Sun).
  ctx.strokeStyle = 'rgba(255,255,255,0.24)';
  ctx.lineWidth = 1;
  circle(ctx, cx, cy, solarOrbitR);
  ctx.setLineDash([4, 6]);
  circle(ctx, earthX, earthY, lunarOrbitNominalR);
  ctx.setLineDash([]);

  // Lunar nodes line through Earth in top-down ecliptic view.
  const nodeDirX = ecl.nodeAscendingUnit.x;
  const nodeDirY = ecl.nodeAscendingUnit.y;
  const nodeNorm = Math.max(1e-9, Math.hypot(nodeDirX, nodeDirY));
  const nodeLen = lunarOrbitNominalR * 1.7;
  line(
    ctx,
    earthX - (nodeDirX / nodeNorm) * nodeLen,
    earthY + (nodeDirY / nodeNorm) * nodeLen,
    earthX + (nodeDirX / nodeNorm) * nodeLen,
    earthY - (nodeDirY / nodeNorm) * nodeLen,
    'rgba(255,255,255,0.74)',
    1.15,
  );

  // Geometry lines Sun->Earth, Earth->Moon and Sun->Moon.
  line(ctx, sunX, sunY, earthX, earthY, 'rgba(255,255,255,0.58)', 1.2);
  line(ctx, earthX, earthY, moonX, moonY, 'rgba(255,255,255,0.64)', 1.2);
  ctx.setLineDash([4, 4]);
  line(ctx, sunX, sunY, moonX, moonY, 'rgba(255,255,255,0.24)', 1);
  ctx.setLineDash([]);

  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  circle(ctx, sunX, sunY, 25, true);
  ctx.fillStyle = '#ffffff';
  circle(ctx, sunX, sunY, 11, true);

  const earthR = 12;
  ctx.fillStyle = '#4d4d4d';
  circle(ctx, earthX, earthY, earthR, true);
  ctx.strokeStyle = 'rgba(255,255,255,0.84)';
  circle(ctx, earthX, earthY, earthR);

  const moonR = clamp(
    earthR * (model.moonAngularRadiusDeg / Math.max(model.sunAngularRadiusDeg, 1e-6)),
    4,
    8,
  );
  ctx.fillStyle = '#1a1a1a';
  circle(ctx, moonX, moonY, moonR, true);
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  circle(ctx, moonX, moonY, moonR);

  drawCrosshair(ctx, earthX, earthY, 'rgba(255,255,255,0.58)', 5, 1);

  ctx.fillStyle = COLORS.muted;
  ctx.font = '500 11px IBM Plex Mono, monospace';
  ctx.fillText('sun', sunX - 12, sunY + 42);
  ctx.fillText('earth', earthX - 14, earthY + 32);
  ctx.fillText('moon', moonX - 12, moonY + 26);
  ctx.fillText(`node+ Ω=${model.ascendingNodeLon.toFixed(1)}°`, 18, height - 58);
  ctx.fillText(`elongation λ☾-λ☉=${model.moonToSun.toFixed(2)}°`, 18, height - 42);
  ctx.fillText(`moon ecliptic latitude β=${model.moonEclipticLat.toFixed(2)}°`, 18, height - 26);
  ctx.fillText(`vector frame: ecliptic xyz`, 18, height - 10);
}

function drawMoonOrbitPlane(ctx, model, viewport) {
  const { width, height } = viewport;
  paintFlatBackground(ctx, width, height);
  drawModeHeader(ctx, 'EARTH -> SUN / ECLIPTIC SECTION', width);

  const ecl = model.geometry?.ecliptic;
  if (!ecl) return;

  const padL = 64;
  const padR = 26;
  const padT = 62;
  const padB = 62;
  const left = padL;
  const right = width - padR;
  const top = padT;
  const bottom = height - padB;
  const centerY = (top + bottom) * 0.5;

  const deltaMoon = signedAngleDeg2D(ecl.sunFromEarthKm, ecl.moonFromEarthKm);
  const deltaAsc = signedAngleDeg2D(ecl.sunFromEarthKm, ecl.nodeAscendingUnit);
  const deltaDesc = signedAngleDeg2D(ecl.sunFromEarthKm, ecl.nodeDescendingUnit);
  const moonLatFromVector = Math.asin(
    clamp(ecl.moonFromEarthKm.z / Math.max(1e-9, vectorLength(ecl.moonFromEarthKm)), -1, 1),
  ) * RAD;
  const spanXDeg = clamp(
    Math.max(
      Math.abs(deltaMoon),
      Math.abs(deltaAsc),
      Math.abs(deltaDesc),
      14,
    ) + 8,
    20,
    85,
  );
  const spanYDeg = clamp(model.lunarInclinationDeg * 1.35, 6, 14);

  const toX = (deg) => left + ((deg + spanXDeg) / (spanXDeg * 2)) * (right - left);
  const toY = (deg) => centerY - (deg / spanYDeg) * ((bottom - top) * 0.44);

  // Grid.
  for (let y = -spanYDeg; y <= spanYDeg; y += 2) {
    line(
      ctx,
      left,
      toY(y),
      right,
      toY(y),
      Math.abs(y) < 1e-6 ? 'rgba(255,255,255,0.58)' : 'rgba(255,255,255,0.08)',
      Math.abs(y) < 1e-6 ? 1.25 : 1,
    );
  }
  for (let x = -spanXDeg; x <= spanXDeg; x += 10) {
    line(ctx, toX(x), top, toX(x), bottom, 'rgba(255,255,255,0.08)', 1);
  }

  // Moon orbit in ecliptic coordinates: beta(lambda) = i * sin(lambda - Omega).
  ctx.strokeStyle = 'rgba(255,255,255,0.76)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  let started = false;
  for (let xDeg = -spanXDeg; xDeg <= spanXDeg; xDeg += 0.5) {
    const betaDeg = model.lunarInclinationDeg * Math.sin((xDeg - deltaAsc) * DEG);
    const x = toX(xDeg);
    const y = toY(betaDeg);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();

  const sunX = toX(0);
  const sunY = toY(0);
  const sunR = clamp(model.sunAngularRadiusDeg * ((right - left) / (spanXDeg * 2)), 4.5, 12);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  circle(ctx, sunX, sunY, sunR * 2.2, true);
  ctx.fillStyle = '#ffffff';
  circle(ctx, sunX, sunY, sunR, true);

  // Nodes (where beta = 0).
  const nodeCandidates = [];
  for (let k = -2; k <= 2; k += 1) {
    nodeCandidates.push(deltaAsc + 360 * k);
    nodeCandidates.push(deltaDesc + 360 * k);
  }
  nodeCandidates.forEach((nodeDeg) => {
    if (nodeDeg < -spanXDeg - 1 || nodeDeg > spanXDeg + 1) return;
    const x = toX(nodeDeg);
    drawCrosshair(ctx, x, toY(0), 'rgba(255,255,255,0.8)', 5, 1.1);
  });

  // Current Moon point.
  const moonX = toX(deltaMoon);
  const moonY = toY(moonLatFromVector);
  const moonR = clamp(
    model.moonAngularRadiusDeg * ((right - left) / (spanXDeg * 2)),
    3.5,
    10,
  );
  ctx.fillStyle = '#141414';
  circle(ctx, moonX, moonY, moonR, true);
  ctx.strokeStyle = 'rgba(255,255,255,0.88)';
  circle(ctx, moonX, moonY, moonR);

  // Distance from ecliptic (beta).
  ctx.setLineDash([4, 4]);
  line(ctx, moonX, toY(0), moonX, moonY, 'rgba(255,255,255,0.4)', 1);
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,255,255,0.76)';
  circle(ctx, moonX, toY(0), 2, true);

  // Distance from ascending node along lambda.
  const fromNode = signedAngleDeg2D(ecl.nodeAscendingUnit, ecl.moonFromEarthKm);
  const nearestAsc = normalize180(deltaAsc);
  drawAxisBracket(ctx, toX(nearestAsc), toX(deltaMoon), toY(0) - 18, 'rgba(255,255,255,0.44)');

  ctx.fillStyle = COLORS.muted;
  ctx.font = '500 11px IBM Plex Mono, monospace';
  ctx.fillText('you are at Earth (observer), looking to Sun along x=0', left, top - 14);
  ctx.fillText('sun', sunX - 8, sunY + 22);
  ctx.fillText('moon', moonX - 12, moonY + 22);
  ctx.fillText(`node+ at ${deltaAsc.toFixed(2)}°`, left, bottom + 18);
  ctx.fillText(`delta lambda (moon-sun): ${deltaMoon.toFixed(2)}°`, left, bottom + 34);
  ctx.fillText(`distance from node+: ${Math.abs(fromNode).toFixed(2)}°`, left + 250, bottom + 34);
  ctx.fillText(`distance from ecliptic: β=${moonLatFromVector.toFixed(2)}°`, left + 488, bottom + 34);
  ctx.fillText(`inclination i=${model.lunarInclinationDeg.toFixed(3)}°`, right - 210, top - 14);
}

function drawObserver(ctx, model, viewport) {
  const { width, height } = viewport;
  const horizonY = height * 0.72;

  const localSky = computeTopocentricObserverSky(model);
  const sunHorizontal = localSky.sun;
  const moonHorizontal = localSky.moon;
  const localSepDeg = localSky.separationDeg;
  const sunAngularRadiusDeg = localSky.sunAngularRadiusDeg;
  const moonAngularRadiusDeg = localSky.moonAngularRadiusDeg;

  const daylight = clamp((sunHorizontal.altitude + 10) / 62, 0, 1);
  const topTone = Math.round(8 + daylight * 92);
  const bottomTone = Math.round(18 + daylight * 108);

  const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
  sky.addColorStop(0, gray(topTone));
  sky.addColorStop(1, gray(bottomTone));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, horizonY);

  const ground = ctx.createLinearGradient(0, horizonY, 0, height);
  ground.addColorStop(0, gray(26));
  ground.addColorStop(1, gray(10));
  ctx.fillStyle = ground;
  ctx.fillRect(0, horizonY, width, height - horizonY);

  drawMountainBand(ctx, width, horizonY + 3, '#171717', 0.23);
  drawMountainBand(ctx, width, horizonY + 8, '#111111', 0.17);
  line(ctx, 0, horizonY, width, horizonY, 'rgba(255,255,255,0.55)', 1);

  for (let i = 1; i < 6; i += 1) {
    const y = horizonY - i * ((horizonY - 36) / 6);
    line(ctx, 40, y, width - 40, y, 'rgba(255,255,255,0.08)', 1);
    ctx.fillStyle = 'rgba(255,255,255,0.38)';
    ctx.font = '500 10px IBM Plex Mono, monospace';
    ctx.fillText(`${i * 15}°`, 10, y + 3);
  }

  const azimuthLabels = [
    { az: 0, label: 'N' },
    { az: 90, label: 'E' },
    { az: 180, label: 'S' },
    { az: 270, label: 'W' },
  ];
  for (let az = 0; az < 360; az += 30) {
    const x = altAzToXY(az, 0, width, horizonY, 48).x;
    line(ctx, x, horizonY - 6, x, horizonY + 6, 'rgba(255,255,255,0.2)', 1);
  }
  azimuthLabels.forEach((item) => {
    const x = altAzToXY(item.az, 0, width, horizonY, 48).x;
    ctx.fillStyle = 'rgba(255,255,255,0.44)';
    ctx.font = '600 10px IBM Plex Mono, monospace';
    ctx.fillText(item.label, x - 3, horizonY + 18);
  });

  const sun = altAzToXY(sunHorizontal.azimuth, sunHorizontal.altitude, width, horizonY, 48);
  const moon = altAzToXY(moonHorizontal.azimuth, moonHorizontal.altitude, width, horizonY, 48);
  const sunR = 15;
  const moonR = clamp(sunR * (moonAngularRadiusDeg / Math.max(sunAngularRadiusDeg, 1e-6)), 10, 21);

  // Keep near-physical horizon criterion (with simple refraction allowance).
  const sunVisible = sunHorizontal.altitude > -0.8;
  const moonVisible = moonHorizontal.altitude > -0.8;

  if (sunVisible) {
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    circle(ctx, sun.x, sun.y, 30, true);
    ctx.fillStyle = '#ffffff';
    circle(ctx, sun.x, sun.y, sunR, true);
  } else {
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.setLineDash([4, 5]);
    circle(ctx, sun.x, horizonY + 10, sunR);
    ctx.setLineDash([]);
  }

  if (moonVisible) {
    // Moon marker on wide sky map (not angular scale).
    ctx.fillStyle = '#141414';
    circle(ctx, moon.x, moon.y, 5, true);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    circle(ctx, moon.x, moon.y, 5);
  } else {
    ctx.strokeStyle = 'rgba(255,255,255,0.36)';
    ctx.setLineDash([4, 5]);
    circle(ctx, moon.x, horizonY + 14, 5);
    ctx.setLineDash([]);
  }

  const rawLocalDepth = sunVisible && moonVisible
    ? overlapFraction(sunAngularRadiusDeg, moonAngularRadiusDeg, localSepDeg)
    : 0;
  const penumbraRadiusKm = 6371.0 * Math.max(0, model.penumbraRadiusDeg || 0) * DEG;
  const withinMapPenumbra = model.observerToShadowKm <= penumbraRadiusKm + 25;
  const localDepth = withinMapPenumbra ? rawLocalDepth : 0;
  if (localDepth > 0.0005 && sunVisible) {
    // Draw eclipse overlay around Sun using true local angular offset.
    const relative = relativeOffsetOnSkyDeg(
      sunHorizontal.azimuth,
      sunHorizontal.altitude,
      moonHorizontal.azimuth,
      moonHorizontal.altitude,
      localSepDeg,
    );
    const degToPx = sunR / Math.max(sunAngularRadiusDeg, 1e-6);
    const eclipseMoonX = sun.x + relative.dxDeg * degToPx;
    const eclipseMoonY = sun.y - relative.dyDeg * degToPx;

    ctx.fillStyle = `rgba(0,0,0,${0.5 + localDepth * 0.42})`;
    circle(ctx, eclipseMoonX, eclipseMoonY, moonR, true);
    ctx.strokeStyle = 'rgba(255,255,255,0.68)';
    ctx.lineWidth = 1;
    circle(ctx, eclipseMoonX, eclipseMoonY, moonR);
  }

  ctx.setLineDash([6, 5]);
  line(ctx, sun.x, sun.y, moon.x, moon.y, 'rgba(255,255,255,0.45)', 1);
  ctx.setLineDash([]);

  drawObserverInset(ctx, {
    x: width - 124,
    y: 44,
    size: 96,
    sunRadiusDeg: sunAngularRadiusDeg,
    moonRadiusDeg: moonAngularRadiusDeg,
    separationDeg: localSepDeg,
    visible: sunVisible && moonVisible,
    depth: localDepth,
  });

  drawModeHeader(ctx, 'LOCAL SKY / HORIZON', width);
  ctx.fillStyle = COLORS.muted;
  ctx.font = '500 11px IBM Plex Mono, monospace';
  ctx.fillText(`sun alt ${sunHorizontal.altitude.toFixed(1)}°`, 20, 58);
  ctx.fillText(`moon alt ${moonHorizontal.altitude.toFixed(1)}°`, 20, 74);
  ctx.fillText(`topocentric obscuration ${(localDepth * 100).toFixed(1)}%`, 20, 90);
  ctx.fillText(sunVisible ? 'sun above horizon' : 'sun below horizon', 20, 106);
}

function drawSunView(ctx, model, viewport) {
  const { width, height } = viewport;
  paintFlatBackground(ctx, width, height);
  drawModeHeader(ctx, 'VIEW FROM SUN / FLAT EARTH-MOON PROJECTION', width);

  for (let i = 0; i <= 16; i += 1) {
    const y = 24 + i * (height / 16);
    line(ctx, 0, y, width, y + (i % 2 === 0 ? 12 : -12), 'rgba(255,255,255,0.05)', 1);
  }

  const cx = width * 0.53;
  const cy = height * 0.53;
  const radius = Math.min(width, height) * 0.3;
  const rotationFromSun = -model.subSolarLon;
  const tiltFromSun = -model.subSolarLat;

  drawEarthDisc(ctx, {
    cx,
    cy,
    radius,
    rotationDeg: rotationFromSun,
    tiltDeg: tiltFromSun,
    subSolarLon: model.subSolarLon,
    subSolarLat: model.subSolarLat,
  });

  const maxOffset = Math.max(
    Math.abs(model.sunViewOffsetXDeg),
    Math.abs(model.sunViewOffsetYDeg),
    0.18,
  );
  const compressionDeg = maxOffset * 1.2;
  const moonScale = (radius * 0.95) / compressionDeg;
  const moonX = cx + model.sunViewOffsetXDeg * moonScale;
  const moonY = cy - model.sunViewOffsetYDeg * moonScale;
  const moonR = clamp(
    radius *
      (model.moonAngularRadiusFromSunDeg / Math.max(model.earthAngularRadiusFromSunDeg, 1e-6)),
    radius * 0.2,
    radius * 0.38,
  );

  // Moon disk in solar viewpoint (same line of sight as sunlight).
  ctx.fillStyle = '#0f0f0f';
  circle(ctx, moonX, moonY, moonR, true);
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 1.1;
  circle(ctx, moonX, moonY, moonR);
  ctx.setLineDash([5, 4]);
  line(ctx, cx, cy, moonX, moonY, 'rgba(255,255,255,0.38)', 1);
  ctx.setLineDash([]);

  const spot = sphereProject(
    model.centralLat,
    model.centralLon,
    radius,
    cx,
    cy,
    tiltFromSun,
    rotationFromSun,
  );
  if (spot.visible) {
    ctx.fillStyle = `rgba(0,0,0,${0.52 + model.depth * 0.35})`;
    circle(ctx, spot.x, spot.y, model.umbraRadiusDeg * 2.2, true);
    ctx.strokeStyle = 'rgba(255,255,255,0.84)';
    ctx.lineWidth = 1.15;
    circle(ctx, spot.x, spot.y, model.penumbraRadiusDeg * 1.7);
    drawCrosshair(ctx, spot.x, spot.y, 'rgba(255,255,255,0.9)', 7, 1.1);
  }

  ctx.fillStyle = COLORS.muted;
  ctx.font = '500 11px IBM Plex Mono, monospace';
  ctx.fillText(
    `moon offset ${model.sunViewOffsetXDeg.toFixed(3)}° / ${model.sunViewOffsetYDeg.toFixed(3)}°`,
    24,
    height - 26,
  );
  ctx.fillText(
    `flat projection (distance scale compressed)`,
    24,
    height - 10,
  );
}

function drawCrossSection(ctx, model, viewport) {
  const { width, height } = viewport;
  paintSpaceBackground(ctx, width, height);
  drawModeHeader(ctx, 'SUN-MOON-EARTH / SHADOW SECTION', width);

  const axisY = height * 0.55;
  const sunX = width * 0.14;
  const moonX = width * 0.47;
  const earthX = width * 0.82;
  const sunR = 52;
  const earthR = 64;
  const moonR = clamp(
    24 * (model.moonAngularRadiusDeg / Math.max(model.sunAngularRadiusDeg, 1e-6)),
    14,
    30,
  );
  const moonY = axisY - clamp(model.bestSeparationDeg * 160, -74, 74);

  const penumbraEarthR = earthR * Math.sin(clamp(model.penumbraRadiusDeg, 0, 89) * DEG);
  const coreEarthR = earthR * Math.sin(clamp(model.umbraRadiusDeg, 0, 89) * DEG);

  line(ctx, 18, axisY, width - 18, axisY, 'rgba(255,255,255,0.24)', 1);
  ctx.setLineDash([4, 6]);
  line(ctx, moonX, 38, moonX, height - 24, 'rgba(255,255,255,0.14)', 1);
  line(ctx, earthX, 38, earthX, height - 24, 'rgba(255,255,255,0.14)', 1);
  ctx.setLineDash([]);

  // Penumbra envelope.
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.moveTo(moonX + moonR, moonY - moonR * 1.08);
  ctx.lineTo(earthX, axisY - penumbraEarthR);
  ctx.lineTo(earthX, axisY + penumbraEarthR);
  ctx.lineTo(moonX + moonR, moonY + moonR * 1.08);
  ctx.closePath();
  ctx.fill();

  // Umbra or antumbra core envelope.
  if (coreEarthR > 0.5) {
    ctx.fillStyle = `rgba(0,0,0,${0.54 + model.depth * 0.28})`;
    ctx.beginPath();
    ctx.moveTo(moonX + moonR, moonY - moonR * 0.72);
    ctx.lineTo(earthX, axisY - coreEarthR);
    ctx.lineTo(earthX, axisY + coreEarthR);
    ctx.lineTo(moonX + moonR, moonY + moonR * 0.72);
    ctx.closePath();
    ctx.fill();
  }

  // Solar ray limits.
  line(ctx, sunX, axisY - sunR, earthX + earthR + 20, axisY - penumbraEarthR * 1.35, 'rgba(255,255,255,0.46)', 1);
  line(ctx, sunX, axisY + sunR, earthX + earthR + 20, axisY + penumbraEarthR * 1.35, 'rgba(255,255,255,0.46)', 1);

  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  circle(ctx, sunX, axisY, sunR + 22, true);
  ctx.fillStyle = '#ffffff';
  circle(ctx, sunX, axisY, sunR, true);

  ctx.fillStyle = '#191919';
  circle(ctx, moonX, moonY, moonR, true);
  ctx.strokeStyle = 'rgba(255,255,255,0.84)';
  ctx.lineWidth = 1;
  circle(ctx, moonX, moonY, moonR);

  const earthFill = ctx.createRadialGradient(
    earthX - earthR * 0.3,
    axisY - earthR * 0.3,
    8,
    earthX,
    axisY,
    earthR,
  );
  earthFill.addColorStop(0, '#505050');
  earthFill.addColorStop(1, '#1a1a1a');
  ctx.fillStyle = earthFill;
  circle(ctx, earthX, axisY, earthR, true);
  ctx.strokeStyle = 'rgba(255,255,255,0.72)';
  circle(ctx, earthX, axisY, earthR);

  ctx.strokeStyle = 'rgba(255,255,255,0.38)';
  circle(ctx, earthX, axisY, penumbraEarthR);
  if (coreEarthR > 0.5) {
    ctx.strokeStyle = 'rgba(255,255,255,0.78)';
    circle(ctx, earthX, axisY, coreEarthR);
  }

  ctx.fillStyle = COLORS.muted;
  ctx.font = '500 11px IBM Plex Mono, monospace';
  ctx.fillText('sun', sunX - 12, axisY + 90);
  ctx.fillText('moon', moonX - 15, axisY + 90);
  ctx.fillText('earth', earthX - 15, axisY + 90);
  ctx.fillText(`penumbra ${(model.penumbraRadiusDeg || 0).toFixed(2)}°`, 18, height - 28);
  ctx.fillText(`core ${(model.umbraRadiusDeg || 0).toFixed(2)}°`, 18, height - 12);
  ctx.fillText(`not to scale: distance ${Math.round(model.moonDistanceKm).toLocaleString('ru-RU')} km`, width - 320, height - 12);
}

function drawModeHeader(ctx, title, width) {
  ctx.fillStyle = COLORS.text;
  ctx.font = '600 12px IBM Plex Mono, monospace';
  ctx.fillText(title, 18, 24);
  line(ctx, 18, 32, width - 18, 32, 'rgba(255,255,255,0.16)', 1);
}

function createMercatorProjection(padX, padY, width, height) {
  const scale = width / (Math.PI * 2);
  return geoMercator()
    .scale(scale)
    .translate([padX + width * 0.5, padY + height * 0.5])
    .precision(0.2);
}

function createOrthographicProjection(cx, cy, radius, rotationDeg, tiltDeg) {
  return geoOrthographic()
    .translate([cx, cy])
    .scale(radius)
    .clipAngle(90)
    .precision(0.25)
    .rotate([-rotationDeg, -tiltDeg, 0]);
}

function projectLonLat(projection, lon, lat, maxAbsLat = 85) {
  return projection([normalize180(lon), clamp(lat, -maxAbsLat, maxAbsLat)]);
}

function getLandFeatures() {
  if (LAND_STORE.status === 'idle') {
    LAND_STORE.status = 'loading';
    fetch(LAND_DATA_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        LAND_STORE.features = Array.isArray(data?.features) ? data.features : [];
        LAND_STORE.status = 'ready';
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('land-data-ready'));
        }
      })
      .catch(() => {
        LAND_STORE.status = 'error';
        LAND_STORE.features = [];
      });
  }
  return LAND_STORE.features;
}

function drawMapGrid(ctx, projection, padX, padY, width, height) {
  const path = geoPath(projection, ctx);
  const graticule = geoGraticule().step([30, 30]);

  ctx.save();
  ctx.beginPath();
  ctx.rect(padX, padY, width, height);
  ctx.clip();

  ctx.strokeStyle = COLORS.faint;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  path(graticule());
  ctx.stroke();

  // Equator and prime meridian accents.
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  path({ type: 'LineString', coordinates: [[-180, 0], [180, 0]] });
  path({ type: 'LineString', coordinates: [[0, -85], [0, 85]] });
  ctx.stroke();
  ctx.restore();
}

function drawSolarIlluminationMap(ctx, model, projection, padX, padY, width, height) {
  const latStep = 4;
  const lonStep = 4;
  const dec = model.subSolarLat * DEG;

  ctx.save();
  ctx.beginPath();
  ctx.rect(padX, padY, width, height);
  ctx.clip();

  for (let lat = -84; lat < 84; lat += latStep) {
    const latR = (lat + latStep * 0.5) * DEG;
    const sinLat = Math.sin(latR);
    const cosLat = Math.cos(latR);
    for (let lon = -180; lon < 180; lon += lonStep) {
      const lonCenter = lon + lonStep * 0.5;
      const hourAngle = normalize180(lonCenter - model.subSolarLon) * DEG;
      const cosZenith =
        sinLat * Math.sin(dec) +
        cosLat * Math.cos(dec) * Math.cos(hourAngle);
      if (cosZenith < 0) {
        const p00 = projectLonLat(projection, lon, lat);
        const p10 = projectLonLat(projection, lon + lonStep, lat);
        const p11 = projectLonLat(projection, lon + lonStep, lat + latStep);
        const p01 = projectLonLat(projection, lon, lat + latStep);
        if (!p00 || !p10 || !p11 || !p01) continue;
        const xs = [p00[0], p10[0], p11[0], p01[0]];
        if (Math.max(...xs) - Math.min(...xs) > width * 0.62) continue;

        const alpha = clamp(Math.pow(-cosZenith, 0.7) * 0.54, 0.03, 0.54);
        ctx.fillStyle = `rgba(0,0,0,${alpha})`;
        ctx.beginPath();
        ctx.moveTo(p00[0], p00[1]);
        ctx.lineTo(p10[0], p10[1]);
        ctx.lineTo(p11[0], p11[1]);
        ctx.lineTo(p01[0], p01[1]);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  // Visual terminator guide.
  ctx.strokeStyle = 'rgba(255,255,255,0.32)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  let started = false;
  let prevX = 0;
  for (let lon = -180; lon <= 180; lon += 2) {
    const lat = solveTerminatorLat(lon, model.subSolarLat, model.subSolarLon);
    const projected = projectLonLat(projection, lon, lat);
    if (!projected) continue;
    const [x, y] = projected;
    if (!started || Math.abs(x - prevX) > width * 0.5) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
    prevX = x;
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function solveTerminatorLat(lonDeg, subSolarLatDeg, subSolarLonDeg) {
  // Solve altitude(lat)=0 for this longitude with Newton steps.
  const dec = subSolarLatDeg * DEG;
  const h = normalize180(lonDeg - subSolarLonDeg) * DEG;
  if (Math.abs(Math.cos(dec)) < 1e-6) {
    return -subSolarLatDeg;
  }
  let lat = 0;
  for (let i = 0; i < 8; i += 1) {
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    const f =
      sinLat * Math.sin(dec) +
      cosLat * Math.cos(dec) * Math.cos(h);
    const df =
      cosLat * Math.sin(dec) -
      sinLat * Math.cos(dec) * Math.cos(h);
    const safeDf = Math.abs(df) < 1e-6 ? (df < 0 ? -1e-6 : 1e-6) : df;
    lat -= f / safeDf;
    lat = clamp(lat, -Math.PI / 2 + 1e-4, Math.PI / 2 - 1e-4);
  }
  if (!Number.isFinite(lat)) return 0;
  return lat * RAD;
}

function sphericalDestination(latDeg, lonDeg, radiusDeg, bearingDeg) {
  const lat1 = latDeg * DEG;
  const lon1 = lonDeg * DEG;
  const dist = radiusDeg * DEG;
  const br = bearingDeg * DEG;

  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinDist = Math.sin(dist);
  const cosDist = Math.cos(dist);

  const lat2 = Math.asin(
    clamp(sinLat1 * cosDist + cosLat1 * sinDist * Math.cos(br), -1, 1),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(br) * sinDist * cosLat1,
      cosDist - sinLat1 * Math.sin(lat2),
    );

  return {
    lat: lat2 * RAD,
    lon: normalize180(lon2 * RAD),
  };
}

function drawSphericalCircleOnMap(
  ctx,
  projection,
  centerLat,
  centerLon,
  radiusDeg,
  mapWidth,
  fill = false,
) {
  if (radiusDeg <= 0) return;
  ctx.beginPath();
  let started = false;
  let prevX = 0;
  for (let bearing = 0; bearing <= 360; bearing += 2) {
    const point = sphericalDestination(centerLat, centerLon, radiusDeg, bearing);
    const projected = projectLonLat(projection, point.lon, point.lat);
    if (!projected) continue;
    const [x, y] = projected;
    if (!started || Math.abs(x - prevX) > mapWidth * 0.45) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
    prevX = x;
  }
  if (fill) ctx.fill();
  else ctx.stroke();
}

function drawMapContinents(ctx, projection, padX, padY, width, height) {
  const features = getLandFeatures();
  if (!features.length) return;
  const path = geoPath(projection, ctx);
  ctx.save();
  ctx.beginPath();
  ctx.rect(padX, padY, width, height);
  ctx.clip();

  features.forEach((feature) => {
    ctx.beginPath();
    path(feature);
    ctx.fillStyle = '#1f1f1f';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 0.7;
    ctx.stroke();
  });
  ctx.restore();
}

function drawSeaLabels(ctx, projection, padX, padY, width, height) {
  ctx.fillStyle = 'rgba(255,255,255,0.42)';
  ctx.font = '500 10px IBM Plex Mono, monospace';
  SEA_LABELS.forEach((label) => {
    const projected = projectLonLat(projection, label.lon, label.lat);
    if (!projected) return;
    const [x, y] = projected;
    ctx.fillText(label.name, x - 34, y);
  });
}

function drawEarthDisc(ctx, options) {
  const {
    cx,
    cy,
    radius,
    rotationDeg,
    tiltDeg,
    subSolarLon,
    subSolarLat,
    projection,
  } = options;
  const globeProjection =
    projection ?? createOrthographicProjection(cx, cy, radius, rotationDeg, tiltDeg);

  const ocean = ctx.createRadialGradient(
    cx - radius * 0.3,
    cy - radius * 0.3,
    radius * 0.15,
    cx,
    cy,
    radius,
  );
  ocean.addColorStop(0, '#4b4b4b');
  ocean.addColorStop(1, '#1a1a1a');
  ctx.fillStyle = ocean;
  circle(ctx, cx, cy, radius, true);

  ctx.save();
  circlePath(ctx, cx, cy, radius);
  ctx.clip();

  const sunlight = projectLonLat(globeProjection, subSolarLon, subSolarLat, 89.999);
  if (sunlight) {
    const day = ctx.createRadialGradient(
      sunlight[0],
      sunlight[1],
      radius * 0.15,
      sunlight[0],
      sunlight[1],
      radius * 1.25,
    );
    day.addColorStop(0, 'rgba(255,255,255,0.33)');
    day.addColorStop(1, 'rgba(0,0,0,0.8)');
    ctx.fillStyle = day;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }

  drawGlobeGraticule(ctx, globeProjection);
  drawGlobeContinents(ctx, globeProjection);
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 1.1;
  circle(ctx, cx, cy, radius);

  const halo = ctx.createRadialGradient(cx, cy, radius * 0.92, cx, cy, radius * 1.13);
  halo.addColorStop(0, 'rgba(255,255,255,0)');
  halo.addColorStop(1, 'rgba(255,255,255,0.16)');
  ctx.fillStyle = halo;
  circle(ctx, cx, cy, radius * 1.13, true);
}

function drawGlobeGraticule(ctx, projection) {
  const path = geoPath(projection, ctx);
  const graticule = geoGraticule().step([30, 30]);
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  path(graticule());
  ctx.stroke();
}

function drawGlobeContinents(ctx, projection) {
  const features = getLandFeatures();
  if (!features.length) return;
  const path = geoPath(projection, ctx);
  features.forEach((feature) => {
    ctx.beginPath();
    path(feature);
    ctx.fillStyle = '#242424';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.24)';
    ctx.lineWidth = 0.65;
    ctx.stroke();
  });
}

function drawMountainBand(ctx, width, baseY, color, amplitude) {
  const height = 46 + amplitude * 62;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, baseY);
  for (let x = 0; x <= width; x += 12) {
    const wave = Math.sin(x * 0.011) * height * 0.24;
    const wave2 = Math.sin(x * 0.029 + 1.2) * height * 0.13;
    const y = baseY - (height * 0.38 + wave + wave2);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(width, baseY);
  ctx.closePath();
  ctx.fill();
}

function paintFlatBackground(ctx, width, height) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, COLORS.base);
  gradient.addColorStop(1, COLORS.panel);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function paintSpaceBackground(ctx, width, height) {
  paintFlatBackground(ctx, width, height);
  STAR_FIELD.forEach((star) => {
    ctx.fillStyle = `rgba(255,255,255,${star.alpha})`;
    circle(ctx, star.x * width, star.y * height, star.size, true);
  });
}

function drawObserverInset(ctx, options) {
  const {
    x,
    y,
    size,
    sunRadiusDeg,
    moonRadiusDeg,
    separationDeg,
    visible,
    depth,
  } = options;
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  roundRect(ctx, x, y, size, size, 10, true);
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  roundRect(ctx, x, y, size, size, 10);

  const cx = x + size * 0.5;
  const cy = y + size * 0.5;
  const sunR = size * 0.24;
  const moonR = clamp(
    sunR * (moonRadiusDeg / Math.max(sunRadiusDeg, 1e-6)),
    sunR * 0.6,
    sunR * 1.45,
  );
  const sepPx = separationDeg * (sunR / Math.max(sunRadiusDeg, 1e-6));

  ctx.fillStyle = visible ? '#ffffff' : 'rgba(255,255,255,0.35)';
  circle(ctx, cx, cy, sunR, true);
  ctx.fillStyle = '#151515';
  circle(ctx, cx + sepPx, cy, moonR, true);
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  circle(ctx, cx + sepPx, cy, moonR);

  ctx.fillStyle = 'rgba(255,255,255,0.58)';
  ctx.font = '500 9px IBM Plex Mono, monospace';
  ctx.fillText(`${(depth * 100).toFixed(1)}%`, x + 8, y + size - 8);
}

function sphericalSeparationDeg(az1Deg, alt1Deg, az2Deg, alt2Deg) {
  const az1 = az1Deg * DEG;
  const alt1 = alt1Deg * DEG;
  const az2 = az2Deg * DEG;
  const alt2 = alt2Deg * DEG;
  const cosSep =
    Math.sin(alt1) * Math.sin(alt2) +
    Math.cos(alt1) * Math.cos(alt2) * Math.cos(az1 - az2);
  return Math.acos(clamp(cosSep, -1, 1)) * RAD;
}

function computeTopocentricObserverSky(model) {
  const earthFixed = model.geometry?.earthFixed;
  if (!earthFixed) {
    const sun = horizontalCoordinates(
      model.observerLat,
      model.subSolarLat,
      normalize180(model.observerLon - model.subSolarLon),
    );
    const moon = horizontalCoordinates(
      model.observerLat,
      model.subLunarLat,
      normalize180(model.observerLon - model.subLunarLon),
    );
    return {
      sun,
      moon,
      separationDeg: sphericalSeparationDeg(sun.azimuth, sun.altitude, moon.azimuth, moon.altitude),
      sunAngularRadiusDeg: model.sunAngularRadiusDeg,
      moonAngularRadiusDeg: model.moonAngularRadiusDeg,
    };
  }

  const observer = earthFixedObserverVector(model.observerLat, model.observerLon, 6371.0);
  const sunTopo = subtractVector(earthFixed.sunFromEarthKm, observer);
  const moonTopo = subtractVector(earthFixed.moonFromEarthKm, observer);

  const sun = topocentricHorizontalFromEcef(sunTopo, model.observerLat, model.observerLon);
  const moon = topocentricHorizontalFromEcef(moonTopo, model.observerLat, model.observerLon);

  const sunDistanceKm = vectorLength(sunTopo);
  const moonDistanceKm = vectorLength(moonTopo);
  const sunAngularRadiusDeg =
    model.sunAngularRadiusDeg * (model.sunDistanceKm / Math.max(1, sunDistanceKm));
  const moonAngularRadiusDeg =
    model.moonAngularRadiusDeg * (model.moonDistanceKm / Math.max(1, moonDistanceKm));

  return {
    sun,
    moon,
    separationDeg: angleBetweenVectorsDeg(sunTopo, moonTopo),
    sunAngularRadiusDeg,
    moonAngularRadiusDeg,
  };
}

function vectorLength(vector) {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function subtractVector(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function earthFixedObserverVector(latDeg, lonDeg, radiusKm) {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const cosLat = Math.cos(lat);
  return {
    x: radiusKm * cosLat * Math.cos(lon),
    y: radiusKm * cosLat * Math.sin(lon),
    z: radiusKm * Math.sin(lat),
  };
}

function topocentricHorizontalFromEcef(vector, latDeg, lonDeg) {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);

  const east = -sinLon * vector.x + cosLon * vector.y;
  const north = -sinLat * cosLon * vector.x - sinLat * sinLon * vector.y + cosLat * vector.z;
  const up = cosLat * cosLon * vector.x + cosLat * sinLon * vector.y + sinLat * vector.z;

  const horizontalNorm = Math.max(1e-12, Math.hypot(east, north));
  return {
    azimuth: normalize360(Math.atan2(east, north) * RAD),
    altitude: Math.atan2(up, horizontalNorm) * RAD,
  };
}

function angleBetweenVectorsDeg(a, b) {
  const aLen = Math.max(1e-9, vectorLength(a));
  const bLen = Math.max(1e-9, vectorLength(b));
  const cosSep = clamp((a.x * b.x + a.y * b.y + a.z * b.z) / (aLen * bLen), -1, 1);
  return Math.acos(cosSep) * RAD;
}

function relativeOffsetOnSkyDeg(sunAzDeg, sunAltDeg, moonAzDeg, moonAltDeg, separationDeg) {
  const altSun = sunAltDeg * DEG;
  const altMoon = moonAltDeg * DEG;
  const deltaAz = normalize180(moonAzDeg - sunAzDeg) * DEG;
  const sep = separationDeg * DEG;
  const positionAngle = Math.atan2(
    Math.sin(deltaAz),
    Math.cos(altSun) * Math.tan(altMoon) - Math.sin(altSun) * Math.cos(deltaAz),
  );
  return {
    dxDeg: sep * Math.sin(positionAngle) * RAD,
    dyDeg: sep * Math.cos(positionAngle) * RAD,
  };
}

function signedAngleDeg2D(from, to) {
  const aX = from.x;
  const aY = from.y;
  const bX = to.x;
  const bY = to.y;
  const crossZ = aX * bY - aY * bX;
  const dot = aX * bX + aY * bY;
  return Math.atan2(crossZ, dot) * RAD;
}

function gray(value) {
  const v = clamp(Math.round(value), 0, 255);
  return `rgb(${v}, ${v}, ${v})`;
}

function fract(value) {
  return value - Math.floor(value);
}

function line(ctx, x1, y1, x2, y2, color, width = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function circlePath(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

function circle(ctx, x, y, r, fill = false) {
  circlePath(ctx, x, y, r);
  if (fill) ctx.fill();
  else ctx.stroke();
}

function drawAxisBracket(ctx, x1, x2, y, color) {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  line(ctx, left, y, right, y, color, 1);
  line(ctx, left, y - 5, left, y + 5, color, 1);
  line(ctx, right, y - 5, right, y + 5, color, 1);
}

function roundRect(ctx, x, y, width, height, radius, fill = false) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
  if (fill) ctx.fill();
  else ctx.stroke();
}

function drawCrosshair(ctx, x, y, color, size = 6, width = 1) {
  line(ctx, x - size, y, x + size, y, color, width);
  line(ctx, x, y - size, x, y + size, color, width);
}
