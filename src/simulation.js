export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

const AU_KM = 149597870.7;
const EARTH_RADIUS_KM = 6371.0;
const SUN_RADIUS_KM = 695700.0;
const MOON_RADIUS_KM = 1737.4;
const MOON_PERIGEE_KM = 363300;
const MOON_APOGEE_KM = 405500;
const LUNAR_INCLINATION_DEG = 5.145;
const EARTH_ROT_DEG_PER_HOUR = 15.041067;
const SUN_ECLIPTIC_DEG_PER_HOUR = 360 / (365.2422 * 24);
const MOON_ECLIPTIC_DEG_PER_HOUR = 13.176358 / 24;
const MOON_ANOMALY_DEG_PER_HOUR = 0.549;
const NODE_REGRESSION_DEG_PER_HOUR = -(360 / (18.613 * 365.2422 * 24));

export const INITIAL_PARAMS = getRealParameters(new Date());

export const CONTROL_GROUPS = [
  {
    title: 'Абсолютные орбитальные параметры',
    fields: [
      {
        key: 'ascendingNodeLon',
        label: 'Долгота восходящего узла Ω',
        min: 0,
        max: 360,
        step: 0.1,
        unit: '°',
      },
      {
        key: 'sunEclipticLon',
        label: 'Эклипт. долгота Солнца λ☉',
        min: 0,
        max: 360,
        step: 0.1,
        unit: '°',
      },
      {
        key: 'moonNodePhase',
        label: 'Фаза от узла (λ☾-Ω)',
        min: -180,
        max: 180,
        step: 0.1,
        unit: '°',
      },
      {
        key: 'moonDistanceMode',
        label: 'Расстояние Луны (0..1)',
        min: 0,
        max: 1,
        step: 0.001,
        unit: '',
      },
      {
        key: 'moonAnomaly',
        label: 'Лунная аномалия M☾',
        min: 0,
        max: 360,
        step: 0.1,
        unit: '°',
      },
    ],
  },
  {
    title: 'Позиция наблюдателя',
    fields: [
      { key: 'observerLat', label: 'Широта', min: -90, max: 90, step: 0.5, unit: '°' },
      { key: 'observerLon', label: 'Долгота', min: -180, max: 180, step: 0.5, unit: '°' },
      { key: 'observerTilt', label: 'Наклон глобуса', min: 0, max: 65, step: 1, unit: '°' },
      { key: 'earthRotation', label: 'Поворот Земли', min: 0, max: 360, step: 0.5, unit: '°' },
    ],
  },
];

export function getRealParameters(date = new Date()) {
  const julianDay = toJulianDate(date);
  const t = julianCenturies(julianDay);
  const gmst = greenwichSiderealDeg(julianDay);
  const sun = sunEclipticCoordinates(t);
  const moon = moonEclipticCoordinates(t);
  const ascendingNodeLon = normalize360(moon.nodeLonDeg);
  const moonNodePhase = normalize180(moon.lonDeg - ascendingNodeLon);
  const moonDistanceMode = clamp(
    (moon.distanceKm - MOON_PERIGEE_KM) / (MOON_APOGEE_KM - MOON_PERIGEE_KM),
    0,
    1,
  );

  return {
    ascendingNodeLon,
    sunEclipticLon: normalize360(sun.lonDeg),
    moonNodePhase,
    moonDistanceMode,
    moonAnomaly: normalize360(moon.meanAnomalyDeg),
    observerLat: 55,
    observerLon: 37,
    observerTilt: 18,
    earthRotation: gmst,
  };
}

export function deriveSimulationState(base, simHours, startDate = new Date()) {
  const date = new Date(startDate.getTime() + simHours * 3600000);
  const julianDay = toJulianDate(date);
  const gmst = greenwichSiderealDeg(julianDay);
  const earthRotation = normalize360(base.earthRotation + simHours * EARTH_ROT_DEG_PER_HOUR);
  const sunEclipticLon = normalize360(base.sunEclipticLon + simHours * SUN_ECLIPTIC_DEG_PER_HOUR);
  const ascendingNodeLon = normalize360(base.ascendingNodeLon + simHours * NODE_REGRESSION_DEG_PER_HOUR);
  const moonNodePhase = normalize180(
    base.moonNodePhase + simHours * (MOON_ECLIPTIC_DEG_PER_HOUR - NODE_REGRESSION_DEG_PER_HOUR),
  );
  const moonEclipticLon = normalize360(ascendingNodeLon + moonNodePhase);
  const moonAnomaly = normalize360(base.moonAnomaly + simHours * MOON_ANOMALY_DEG_PER_HOUR);

  return {
    ...base,
    simHours,
    date,
    julianDay,
    gmst,
    earthRotation,
    sunEclipticLon,
    ascendingNodeLon,
    descendingNodeLon: normalize360(ascendingNodeLon + 180),
    moonNodePhase,
    moonEclipticLon,
    moonAnomaly,
  };
}

export function deriveModel(state) {
  const rotationOffsetDeg = normalize180(state.earthRotation - state.gmst);
  const astro = computeAstronomy(state.julianDay, state, rotationOffsetDeg);
  const track = buildGroundTrack(state.julianDay, state, rotationOffsetDeg);
  const observerToShadowKm = greatCircleDistanceKm(
    state.observerLat,
    state.observerLon,
    astro.centralLat,
    astro.centralLon,
  );

  return {
    ...state,
    ...astro,
    track,
    observerToShadowKm,
    shadowRadiusDeg: astro.penumbraRadiusDeg,
  };
}

export function findNextLocalEclipse(base, currentSimHours, startDate) {
  let t = currentSimHours + 24; // Step forward a bit to avoid finding the current eclipse

  for (let i = 0; i < 10000; i++) { // search up to ~800 years
    let state = deriveSimulationState(base, t, startDate);
    let rotationOffsetDeg = normalize180(state.earthRotation - state.gmst);
    let astro = computeAstronomy(state.julianDay, state, rotationOffsetDeg);

    // Find the next new moon
    let phase = astro.moonToSun; // -180 to 180
    if (phase < 0) phase += 360; // 0 to 360

    // Hours until next new moon
    let hoursToNewMoon = (360 - phase) / (MOON_ECLIPTIC_DEG_PER_HOUR - SUN_ECLIPTIC_DEG_PER_HOUR);
    t += hoursToNewMoon;

    // Refine the new moon time
    for (let j = 0; j < 3; j++) {
      state = deriveSimulationState(base, t, startDate);
      rotationOffsetDeg = normalize180(state.earthRotation - state.gmst);
      astro = computeAstronomy(state.julianDay, state, rotationOffsetDeg);
      t -= astro.moonToSun / (MOON_ECLIPTIC_DEG_PER_HOUR - SUN_ECLIPTIC_DEG_PER_HOUR);
    }

    state = deriveSimulationState(base, t, startDate);
    rotationOffsetDeg = normalize180(state.earthRotation - state.gmst);
    astro = computeAstronomy(state.julianDay, state, rotationOffsetDeg);

    // Check if there is a global eclipse
    if (astro.depth > 0) {
      // There is a global eclipse. Check if it's visible at the observer's location.
      let minDistance = Infinity;
      let bestT = t;
      let found = false;

      for (let hour = -6; hour <= 6; hour += 0.1) {
        const scanT = t + hour;
        const scanState = deriveSimulationState(base, scanT, startDate);
        const scanRotationOffsetDeg = normalize180(scanState.earthRotation - scanState.gmst);
        const scanAstro = computeAstronomy(scanState.julianDay, scanState, scanRotationOffsetDeg);

        const observerToShadowKm = greatCircleDistanceKm(
          scanState.observerLat,
          scanState.observerLon,
          scanAstro.centralLat,
          scanAstro.centralLon,
        );

        const penumbraRadiusKm = 6371.0 * Math.max(0, scanAstro.penumbraRadiusDeg || 0) * DEG;
        if (observerToShadowKm <= penumbraRadiusKm + 25) {
          found = true;
          if (observerToShadowKm < minDistance) {
            minDistance = observerToShadowKm;
            bestT = scanT;
          }
        }
      }

      if (found) {
        return bestT;
      }
    }

    // Step forward a bit to avoid finding the same new moon
    t += 24;
  }

  return null; // Not found
}

function buildGroundTrack(julianDay, controls, rotationOffsetDeg) {
  const points = [];
  for (let hour = -6; hour <= 6.001; hour += 0.5) {
    const sampleControls = {
      ...controls,
      sunEclipticLon: normalize360(controls.sunEclipticLon + hour * SUN_ECLIPTIC_DEG_PER_HOUR),
      ascendingNodeLon: normalize360(controls.ascendingNodeLon + hour * NODE_REGRESSION_DEG_PER_HOUR),
      moonNodePhase: normalize180(
        controls.moonNodePhase + hour * (MOON_ECLIPTIC_DEG_PER_HOUR - NODE_REGRESSION_DEG_PER_HOUR),
      ),
      moonAnomaly: normalize360(controls.moonAnomaly + hour * MOON_ANOMALY_DEG_PER_HOUR),
    };
    sampleControls.moonEclipticLon = normalize360(
      sampleControls.ascendingNodeLon + sampleControls.moonNodePhase,
    );
    const sample = computeAstronomy(julianDay + hour / 24, sampleControls, rotationOffsetDeg);
    if (sample.depth > 0.001) {
      points.push({ lon: sample.centralLon, lat: sample.centralLat });
    }
  }
  return points;
}

function computeAstronomy(julianDay, controls, rotationOffsetDeg) {
  const t = julianCenturies(julianDay);
  const epsilonDeg = meanObliquityDeg(t);
  const gmstDeg = normalize360(greenwichSiderealDeg(julianDay) + rotationOffsetDeg);

  const sun = sunEclipticCoordinates(t);
  const correctedSunLon = normalize360(controls.sunEclipticLon);
  const correctedNodeLon = normalize360(controls.ascendingNodeLon);
  const correctedMoonLon = normalize360(controls.moonEclipticLon);
  const correctedMoonLat = clamp(
    LUNAR_INCLINATION_DEG * Math.sin(normalize180(correctedMoonLon - correctedNodeLon) * DEG),
    -12,
    12,
  );

  const moonDistanceKm = clamp(
    MOON_PERIGEE_KM + controls.moonDistanceMode * (MOON_APOGEE_KM - MOON_PERIGEE_KM),
    MOON_PERIGEE_KM,
    MOON_APOGEE_KM,
  );
  const sunDistanceKm = sun.distanceAu * AU_KM;

  const geometry = buildGeometryFrames({
    correctedSunLon,
    correctedMoonLon,
    correctedMoonLat,
    correctedNodeLon,
    moonDistanceKm,
    sunDistanceKm,
    epsilonDeg,
    gmstDeg,
  });
  const subSolarGeo = vectorToLatLon(geometry.earthFixed.sunFromEarthKm);
  const subLunarGeo = vectorToLatLon(geometry.earthFixed.moonFromEarthKm);
  const subSolarLat = subSolarGeo.latDeg;
  const subSolarLon = subSolarGeo.lonDeg;
  const subLunarLat = subLunarGeo.latDeg;
  const subLunarLon = subLunarGeo.lonDeg;

  const moonToSun = normalize180(correctedMoonLon - correctedSunLon);
  const moonNodePhase = normalize180(correctedMoonLon - correctedNodeLon);
  const sunToNode = normalize180(correctedSunLon - correctedNodeLon);

  const sunAngularRadiusDeg = Math.asin(clamp(SUN_RADIUS_KM / sunDistanceKm, -1, 1)) * RAD;
  const moonAngularRadiusDeg = Math.asin(clamp(MOON_RADIUS_KM / moonDistanceKm, -1, 1)) * RAD;
  const moonParallaxDeg = Math.asin(clamp(EARTH_RADIUS_KM / moonDistanceKm, -1, 1)) * RAD;
  const separationDeg = angularSeparationFromVectors(
    geometry.equatorial.sunFromEarthKm,
    geometry.equatorial.moonFromEarthKm,
  );
  const bestSeparationDeg = Math.max(0, separationDeg - moonParallaxDeg);
  const depth = overlapFraction(sunAngularRadiusDeg, moonAngularRadiusDeg, bestSeparationDeg);

  const sunVector = geometry.equatorial.sunFromEarthKm;
  const moonVector = geometry.equatorial.moonFromEarthKm;
  const sunView = sunViewProjection(sunVector, moonVector);

  let penumbraRadiusDeg = solveFootprintRadiusDeg(moonParallaxDeg, sunAngularRadiusDeg + moonAngularRadiusDeg);
  let coreRadiusDeg = solveFootprintRadiusDeg(moonParallaxDeg, Math.abs(sunAngularRadiusDeg - moonAngularRadiusDeg));
  if (depth <= 0) {
    penumbraRadiusDeg = 0;
    coreRadiusDeg = 0;
  }

  const shadowAxis = shadowAxisOnEarth(sunVector, moonVector, gmstDeg);

  return {
    gmstDeg,
    sunEclipticLon: correctedSunLon,
    moonEclipticLon: correctedMoonLon,
    moonNodePhase,
    moonAnomaly: normalize360(controls.moonAnomaly),
    ascendingNodeLon: correctedNodeLon,
    descendingNodeLon: normalize360(correctedNodeLon + 180),
    moonDistanceKm,
    sunDistanceKm,
    sunToNode,
    moonToSun,
    sunAngularRadiusDeg,
    moonAngularRadiusDeg,
    moonEclipticLat: correctedMoonLat,
    lunarInclinationDeg: LUNAR_INCLINATION_DEG,
    earthAngularRadiusFromSunDeg: sunView.earthAngularRadiusDeg,
    moonAngularRadiusFromSunDeg: sunView.moonAngularRadiusDeg,
    sunViewOffsetXDeg: sunView.offsetXDeg,
    sunViewOffsetYDeg: sunView.offsetYDeg,
    separationDeg,
    bestSeparationDeg,
    depth,
    subSolarLat,
    subSolarLon,
    subLunarLat,
    subLunarLon,
    centralLat: shadowAxis.latDeg,
    centralLon: shadowAxis.lonDeg,
    axisHitsEarth: shadowAxis.hitsEarth,
    umbraRadiusDeg: shadowAxis.hitsEarth ? coreRadiusDeg : 0,
    penumbraRadiusDeg,
    geometry,
    eclipseClass: classifyEclipse(
      bestSeparationDeg,
      sunAngularRadiusDeg,
      moonAngularRadiusDeg,
      depth,
      shadowAxis.hitsEarth,
    ),
  };
}

function buildGeometryFrames(options) {
  const {
    correctedSunLon,
    correctedMoonLon,
    correctedMoonLat,
    correctedNodeLon,
    moonDistanceKm,
    sunDistanceKm,
    epsilonDeg,
    gmstDeg,
  } = options;

  // Canonical vectors: first in ecliptic frame, then rotated with matrices.
  const sunFromEarthEcliptic = sphericalToCartesian(sunDistanceKm, correctedSunLon, 0);
  const moonFromEarthEcliptic = sphericalToCartesian(
    moonDistanceKm,
    correctedMoonLon,
    correctedMoonLat,
  );
  const earthFromSunEcliptic = scaleVector(sunFromEarthEcliptic, -1);
  const moonFromSunEcliptic = addVector(earthFromSunEcliptic, moonFromEarthEcliptic);

  const eclipticToEquatorialMatrix = rotationMatrixX(epsilonDeg);
  const equatorialToEarthFixedMatrix = rotationMatrixZ(-gmstDeg);

  const sunFromEarthEquatorial = applyMatrix3(eclipticToEquatorialMatrix, sunFromEarthEcliptic);
  const moonFromEarthEquatorial = applyMatrix3(eclipticToEquatorialMatrix, moonFromEarthEcliptic);
  const sunFromEarthFixed = applyMatrix3(equatorialToEarthFixedMatrix, sunFromEarthEquatorial);
  const moonFromEarthFixed = applyMatrix3(equatorialToEarthFixedMatrix, moonFromEarthEquatorial);

  const nodeAscendingEcliptic = sphericalToCartesian(1, correctedNodeLon, 0);
  const nodeDescendingEcliptic = scaleVector(nodeAscendingEcliptic, -1);
  const inclination = LUNAR_INCLINATION_DEG * DEG;
  const omega = correctedNodeLon * DEG;
  const moonOrbitNormalEcliptic = normalizeVector({
    x: Math.sin(inclination) * Math.sin(omega),
    y: -Math.sin(inclination) * Math.cos(omega),
    z: Math.cos(inclination),
  });

  return {
    ecliptic: {
      sunFromEarthKm: sunFromEarthEcliptic,
      moonFromEarthKm: moonFromEarthEcliptic,
      earthFromSunKm: earthFromSunEcliptic,
      moonFromSunKm: moonFromSunEcliptic,
      nodeAscendingUnit: nodeAscendingEcliptic,
      nodeDescendingUnit: nodeDescendingEcliptic,
      moonOrbitNormalUnit: moonOrbitNormalEcliptic,
    },
    equatorial: {
      sunFromEarthKm: sunFromEarthEquatorial,
      moonFromEarthKm: moonFromEarthEquatorial,
    },
    earthFixed: {
      sunFromEarthKm: sunFromEarthFixed,
      moonFromEarthKm: moonFromEarthFixed,
    },
  };
}

function shadowAxisOnEarth(sunVector, moonVector, gmstDeg) {
  const axisDirection = normalizeVector(scaleVector(sunVector, -1));
  const intersection = lineSphereIntersection(moonVector, axisDirection, EARTH_RADIUS_KM);

  let surfacePoint;
  let hitsEarth = false;
  if (intersection) {
    surfacePoint = intersection;
    hitsEarth = true;
  } else {
    const tClosest = -dotVector(moonVector, axisDirection);
    const closestPoint = addVector(moonVector, scaleVector(axisDirection, tClosest));
    const norm = magnitudeVector(closestPoint);
    if (norm < 1e-9) {
      const fallback = normalizeVector(scaleVector(moonVector, -1));
      surfacePoint = scaleVector(fallback, EARTH_RADIUS_KM);
    } else {
      surfacePoint = scaleVector(closestPoint, EARTH_RADIUS_KM / norm);
    }
  }

  const geo = vectorToEarthLatLon(surfacePoint, gmstDeg);
  return {
    hitsEarth,
    latDeg: geo.latDeg,
    lonDeg: geo.lonDeg,
  };
}

function sunViewProjection(sunVector, moonVector) {
  const earthFromSun = normalizeVector(scaleVector(sunVector, -1));
  const moonFromSun = normalizeVector(addVector(moonVector, scaleVector(sunVector, -1)));

  const reference = Math.abs(earthFromSun.z) > 0.93 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 };
  let axisX = crossVector(reference, earthFromSun);
  axisX = normalizeVector(axisX);
  const axisY = normalizeVector(crossVector(earthFromSun, axisX));

  const x = Math.atan2(dotVector(moonFromSun, axisX), dotVector(moonFromSun, earthFromSun)) * RAD;
  const y = Math.atan2(dotVector(moonFromSun, axisY), dotVector(moonFromSun, earthFromSun)) * RAD;

  const moonDistanceFromSunKm = magnitudeVector(addVector(moonVector, scaleVector(sunVector, -1)));
  const earthAngularRadiusDeg = Math.asin(clamp(EARTH_RADIUS_KM / magnitudeVector(sunVector), -1, 1)) * RAD;
  const moonAngularRadiusDeg = Math.asin(clamp(MOON_RADIUS_KM / moonDistanceFromSunKm, -1, 1)) * RAD;

  return {
    offsetXDeg: x,
    offsetYDeg: y,
    earthAngularRadiusDeg,
    moonAngularRadiusDeg,
  };
}

function lineSphereIntersection(origin, direction, radiusKm) {
  const b = 2 * dotVector(origin, direction);
  const c = dotVector(origin, origin) - radiusKm * radiusKm;
  const discriminant = b * b - 4 * c;
  if (discriminant < 0) return null;

  const sqrtDisc = Math.sqrt(discriminant);
  const t1 = (-b - sqrtDisc) / 2;
  const t2 = (-b + sqrtDisc) / 2;
  const candidates = [t1, t2].filter((value) => value > 0);
  if (candidates.length === 0) return null;
  const t = Math.min(...candidates);
  return addVector(origin, scaleVector(direction, t));
}

function sphericalToCartesian(distance, lonDeg, latDeg) {
  const lon = lonDeg * DEG;
  const lat = latDeg * DEG;
  const cosLat = Math.cos(lat);
  return {
    x: distance * cosLat * Math.cos(lon),
    y: distance * cosLat * Math.sin(lon),
    z: distance * Math.sin(lat),
  };
}

function vectorToLatLon(vector) {
  const norm = magnitudeVector(vector);
  const latDeg = Math.asin(clamp(vector.z / norm, -1, 1)) * RAD;
  const lonDeg = normalize180(Math.atan2(vector.y, vector.x) * RAD);
  return {
    latDeg,
    lonDeg,
  };
}

function vectorToEarthLatLon(vector, gmstDeg) {
  const norm = magnitudeVector(vector);
  const dec = Math.asin(clamp(vector.z / norm, -1, 1)) * RAD;
  const ra = normalize360(Math.atan2(vector.y, vector.x) * RAD);
  return {
    latDeg: dec,
    lonDeg: normalize180(ra - gmstDeg),
  };
}

function angularSeparationFromVectors(a, b) {
  const aNorm = normalizeVector(a);
  const bNorm = normalizeVector(b);
  const cosSeparation = clamp(dotVector(aNorm, bNorm), -1, 1);
  return Math.acos(cosSeparation) * RAD;
}

function addVector(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scaleVector(vector, scalar) {
  return { x: vector.x * scalar, y: vector.y * scalar, z: vector.z * scalar };
}

function dotVector(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function crossVector(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function magnitudeVector(vector) {
  return Math.sqrt(dotVector(vector, vector));
}

function normalizeVector(vector) {
  const norm = magnitudeVector(vector);
  if (norm < 1e-12) return { x: 1, y: 0, z: 0 };
  return scaleVector(vector, 1 / norm);
}

function rotationMatrixX(angleDeg) {
  const angle = angleDeg * DEG;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    [1, 0, 0],
    [0, c, -s],
    [0, s, c],
  ];
}

function rotationMatrixZ(angleDeg) {
  const angle = angleDeg * DEG;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    [c, -s, 0],
    [s, c, 0],
    [0, 0, 1],
  ];
}

function applyMatrix3(matrix, vector) {
  return {
    x: matrix[0][0] * vector.x + matrix[0][1] * vector.y + matrix[0][2] * vector.z,
    y: matrix[1][0] * vector.x + matrix[1][1] * vector.y + matrix[1][2] * vector.z,
    z: matrix[2][0] * vector.x + matrix[2][1] * vector.y + matrix[2][2] * vector.z,
  };
}

function classifyEclipse(bestSeparationDeg, sunRadiusDeg, moonRadiusDeg, depth, axisHitsEarth) {
  if (depth <= 0.0005) return 'Нет солнечного затмения';
  const radiusDiff = Math.abs(moonRadiusDeg - sunRadiusDeg);
  if (axisHitsEarth && bestSeparationDeg <= radiusDiff) {
    return moonRadiusDeg >= sunRadiusDeg
      ? 'Полное солнечное затмение'
      : 'Кольцеобразное солнечное затмение';
  }
  if (bestSeparationDeg < sunRadiusDeg + moonRadiusDeg) {
    return 'Частное солнечное затмение';
  }
  return 'Нет солнечного затмения';
}

export function overlapFraction(sunRadiusDeg, moonRadiusDeg, separationDeg) {
  const r1 = sunRadiusDeg;
  const r2 = moonRadiusDeg;
  const d = separationDeg;

  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) {
    if (r2 >= r1) return 1;
    return clamp((r2 * r2) / (r1 * r1), 0, 1);
  }

  const r1Sq = r1 * r1;
  const r2Sq = r2 * r2;
  const alpha = 2 * Math.acos(clamp((d * d + r1Sq - r2Sq) / (2 * d * r1), -1, 1));
  const beta = 2 * Math.acos(clamp((d * d + r2Sq - r1Sq) / (2 * d * r2), -1, 1));
  const area =
    0.5 * r1Sq * (alpha - Math.sin(alpha)) +
    0.5 * r2Sq * (beta - Math.sin(beta));
  return clamp(area / (Math.PI * r1Sq), 0, 1);
}

function solveFootprintRadiusDeg(parallaxDeg, targetOffsetDeg) {
  if (parallaxDeg <= 0 || targetOffsetDeg <= 0) return 0;
  const numerator = Math.sin(targetOffsetDeg * DEG);
  const denominator = Math.sin(parallaxDeg * DEG);
  if (denominator <= 0) return 0;
  const ratio = numerator / denominator;
  if (ratio >= 1) return 89.5;
  return Math.asin(clamp(ratio, -1, 1)) * RAD;
}

function sunEclipticCoordinates(t) {
  const l0 = normalize360(280.46646 + 36000.76983 * t + 0.0003032 * t * t);
  const meanAnomalyDeg = normalize360(
    357.52911 + 35999.05029 * t - 0.0001537 * t * t + (t * t * t) / 24490000,
  );
  const meanAnomaly = meanAnomalyDeg * DEG;

  const equationOfCenter =
    (1.914602 - 0.004817 * t - 0.000014 * t * t) * Math.sin(meanAnomaly) +
    (0.019993 - 0.000101 * t) * Math.sin(2 * meanAnomaly) +
    0.000289 * Math.sin(3 * meanAnomaly);

  const lonDeg = normalize360(l0 + equationOfCenter);
  const distanceAu =
    1.00014 - 0.01671 * Math.cos(meanAnomaly) - 0.00014 * Math.cos(2 * meanAnomaly);

  return {
    lonDeg,
    distanceAu,
    meanAnomalyDeg,
  };
}

function moonEclipticCoordinates(t) {
  const meanLonDeg = normalize360(
    218.3164477 +
      481267.88123421 * t -
      0.0015786 * t * t +
      (t * t * t) / 538841 -
      (t * t * t * t) / 65194000,
  );
  const meanElongationDeg = normalize360(
    297.8501921 +
      445267.1114034 * t -
      0.0018819 * t * t +
      (t * t * t) / 545868 -
      (t * t * t * t) / 113065000,
  );
  const sunAnomalyDeg = normalize360(
    357.5291092 + 35999.0502909 * t - 0.0001536 * t * t + (t * t * t) / 24490000,
  );
  const meanAnomalyDeg = normalize360(
    134.9633964 +
      477198.8675055 * t +
      0.0087414 * t * t +
      (t * t * t) / 69699 -
      (t * t * t * t) / 14712000,
  );
  const argumentOfLatitudeDeg = normalize360(
    93.2720950 +
      483202.0175233 * t -
      0.0036539 * t * t -
      (t * t * t) / 3526000 +
      (t * t * t * t) / 863310000,
  );
  const nodeLonDeg = normalize360(
    125.04452 -
      1934.136261 * t +
      0.0020708 * t * t +
      (t * t * t) / 450000,
  );

  const d = meanElongationDeg * DEG;
  const m = sunAnomalyDeg * DEG;
  const mPrime = meanAnomalyDeg * DEG;
  const f = argumentOfLatitudeDeg * DEG;
  const e = 1 - 0.002516 * t - 0.0000074 * t * t;

  const lonDeg =
    meanLonDeg +
    6.289 * Math.sin(mPrime) +
    1.274 * Math.sin(2 * d - mPrime) +
    0.658 * Math.sin(2 * d) +
    0.214 * Math.sin(2 * mPrime) -
    0.186 * e * Math.sin(m) -
    0.114 * Math.sin(2 * f) -
    0.059 * Math.sin(2 * d - 2 * mPrime) -
    0.057 * e * Math.sin(2 * d - m - mPrime) +
    0.053 * Math.sin(2 * d + mPrime) +
    0.046 * e * Math.sin(2 * d - m) +
    0.041 * e * Math.sin(m - mPrime) -
    0.035 * Math.sin(d) -
    0.031 * e * Math.sin(m + mPrime) -
    0.015 * Math.sin(2 * f - 2 * d) +
    0.011 * Math.sin(2 * d - mPrime - 2 * f);

  const latDeg =
    5.128 * Math.sin(f) +
    0.280 * Math.sin(mPrime + f) +
    0.277 * Math.sin(mPrime - f) +
    0.173 * Math.sin(2 * d - f) +
    0.055 * Math.sin(2 * d - mPrime + f) +
    0.046 * Math.sin(2 * d - mPrime - f) +
    0.033 * Math.sin(2 * d + f) +
    0.017 * Math.sin(2 * mPrime + f) +
    0.009 * Math.sin(2 * d + mPrime - f) +
    0.009 * e * Math.sin(2 * d - m + f) +
    0.008 * e * Math.sin(2 * d - m - f);

  const distanceKm =
    385000.56 -
    20905 * Math.cos(mPrime) -
    3699 * Math.cos(2 * d - mPrime) -
    2956 * Math.cos(2 * d) -
    570 * Math.cos(2 * mPrime) +
    246 * Math.cos(2 * mPrime - 2 * d) -
    205 * e * Math.cos(m - 2 * d) -
    171 * Math.cos(mPrime + 2 * d) -
    152 * e * Math.cos(mPrime + m - 2 * d) -
    129 * Math.cos(mPrime - 2 * d);

  return {
    lonDeg: normalize360(lonDeg),
    latDeg: clamp(latDeg, -8.5, 8.5),
    distanceKm,
    meanAnomalyDeg,
    nodeLonDeg,
  };
}

function meanObliquityDeg(t) {
  return 23.439291 - 0.0130042 * t - 0.00000016 * t * t + 0.000000504 * t * t * t;
}

function julianCenturies(julianDay) {
  return (julianDay - 2451545.0) / 36525;
}

function toJulianDate(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

function greenwichSiderealDeg(julianDay) {
  const t = julianCenturies(julianDay);
  const theta =
    280.46061837 +
    360.98564736629 * (julianDay - 2451545.0) +
    0.000387933 * t * t -
    (t * t * t) / 38710000;
  return normalize360(theta);
}

export function horizontalCoordinates(observerLat, declination, hourAngleDeg) {
  const lat = observerLat * DEG;
  const dec = declination * DEG;
  const hourAngle = hourAngleDeg * DEG;

  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle);
  const altitude = Math.asin(clamp(sinAlt, -1, 1));
  const denom = Math.cos(altitude) * Math.cos(lat);
  const safeDenom = Math.abs(denom) < 1e-8 ? 1e-8 : denom;
  const cosAz = clamp((Math.sin(dec) - Math.sin(altitude) * Math.sin(lat)) / safeDenom, -1, 1);
  let azimuth = Math.acos(cosAz);
  if (Math.sin(hourAngle) > 0) {
    azimuth = 2 * Math.PI - azimuth;
  }
  return {
    altitude: altitude * RAD,
    azimuth: azimuth * RAD,
  };
}

export function sphereProject(lat, lon, radius, cx, cy, tiltDeg, rotDeg) {
  const latR = lat * DEG;
  const lonR = (lon + rotDeg) * DEG;
  const tilt = tiltDeg * DEG;

  const x = Math.cos(latR) * Math.sin(lonR);
  const y0 = Math.sin(latR);
  const z0 = Math.cos(latR) * Math.cos(lonR);

  const y = y0 * Math.cos(tilt) - z0 * Math.sin(tilt);
  const z = y0 * Math.sin(tilt) + z0 * Math.cos(tilt);

  return {
    x: cx + x * radius,
    y: cy - y * radius,
    z,
    visible: z >= 0,
  };
}

export function altAzToXY(azimuth, altitude, width, horizonY, pad = 56) {
  const x = pad + ((azimuth % 360) / 360) * (width - pad * 2);
  const y = horizonY - ((altitude + 8) / 98) * (horizonY - 24);
  return { x, y };
}

export function greatCircleDistanceKm(latA, lonA, latB, lonB) {
  const lat1 = latA * DEG;
  const lat2 = latB * DEG;
  const dLat = (latB - latA) * DEG;
  const dLon = (lonB - lonA) * DEG;
  const sinHalfLat = Math.sin(dLat / 2);
  const sinHalfLon = Math.sin(dLon / 2);
  const a =
    sinHalfLat * sinHalfLat +
    Math.cos(lat1) * Math.cos(lat2) * sinHalfLon * sinHalfLon;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

export function normalize180(angle) {
  let value = angle % 360;
  if (value > 180) value -= 360;
  if (value < -180) value += 360;
  return value;
}

export function normalize360(angle) {
  let value = angle % 360;
  if (value < 0) value += 360;
  return value;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

