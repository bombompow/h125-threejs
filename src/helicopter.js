import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Coordinates are in metres: +x points forward (nose), +y up, +z to the pilot's right.
// The ground is y = 0 and the main rotor mast is at x = 0. Proportions follow the
// published H125 figures: 10.93 m fuselage, 12.94 m overall with rotors turning.
// Section angles (theta) are in degrees: 0 = right side, 90 = top, 180 = left, 270 = belly.

const MAST_X = 0;
const ROTOR_HUB_Y = 3.15;
const MAIN_ROTOR_RADIUS = 5.345; // 10.69 m diameter
const TAIL_ROTOR_RADIUS = 0.93; // 1.86 m diameter
const TAIL_ROTOR_POS = new THREE.Vector3(-7.35, 2.2, -0.22);

function createMaterials() {
  return {
    paint: new THREE.MeshPhysicalMaterial({
      color: 0xf3f4f6,
      metalness: 0.05,
      roughness: 0.32,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
    }),
    accent: new THREE.MeshPhysicalMaterial({
      color: 0x14284b,
      metalness: 0.3,
      roughness: 0.3,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
    }),
    stripe: new THREE.MeshPhysicalMaterial({
      color: 0x2f8fd8,
      metalness: 0.2,
      roughness: 0.3,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
    }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x5d7180,
      metalness: 0,
      roughness: 0.04,
      transparent: true,
      opacity: 0.32,
      envMapIntensity: 1.6,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    interior: new THREE.MeshStandardMaterial({ color: 0x2b2f35, roughness: 0.85, side: THREE.BackSide }),
    cabin: new THREE.MeshStandardMaterial({ color: 0x30353c, roughness: 0.8 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x262b33, roughness: 0.95 }),
    screen: new THREE.MeshStandardMaterial({ color: 0x0c1420, emissive: 0x1d4f7a, emissiveIntensity: 0.6, roughness: 0.2 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.8, roughness: 0.4 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 1, roughness: 0.3 }),
    skid: new THREE.MeshStandardMaterial({ color: 0x8c9198, metalness: 0.6, roughness: 0.35 }),
    blade: new THREE.MeshStandardMaterial({ color: 0x2b2d31, metalness: 0.2, roughness: 0.5 }),
    bladeTip: new THREE.MeshStandardMaterial({ color: 0xb9bdc2, metalness: 0.6, roughness: 0.35 }),
    grille: new THREE.MeshStandardMaterial({ color: 0x15171a, metalness: 0.4, roughness: 0.7 }),
    exhaust: new THREE.MeshStandardMaterial({
      color: 0x3b3430,
      metalness: 0.9,
      roughness: 0.55,
      side: THREE.DoubleSide,
    }),
    hidden: new THREE.MeshBasicMaterial({ visible: false }),
    navRed: new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff1a1a, emissiveIntensity: 2 }),
    navGreen: new THREE.MeshStandardMaterial({ color: 0x2aff6a, emissive: 0x1aff5a, emissiveIntensity: 2 }),
    navWhite: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.5 }),
  };
}

// ---------------------------------------------------------------------------
// Lofted surfaces: a list of cross sections along x, each a superellipse with
// separate exponents for the top and bottom halves, smoothly interpolated.
// ---------------------------------------------------------------------------

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function sampleProfiles(profiles, stepsPerSegment) {
  const keys = ['yb', 'yt', 'hw', 'nt', 'nb'];
  const out = [];
  const n = profiles.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = profiles[Math.max(i - 1, 0)];
    const p1 = profiles[i];
    const p2 = profiles[i + 1];
    const p3 = profiles[Math.min(i + 2, n - 1)];
    for (let s = 0; s < stepsPerSegment; s++) {
      const t = s / stepsPerSegment;
      const section = { x: p1.x + (p2.x - p1.x) * t };
      for (const k of keys) section[k] = catmullRom(p0[k], p1[k], p2[k], p3[k], t);
      section.hw = Math.max(section.hw, 0.001);
      out.push(section);
    }
  }
  out.push({ ...profiles[n - 1] });
  return out;
}

function sectionPoint(section, thetaRad, target) {
  const c = Math.cos(thetaRad);
  const s = Math.sin(thetaRad);
  const cy = (section.yb + section.yt) / 2;
  const ry = (section.yt - section.yb) / 2;
  const n = s >= 0 ? section.nt : section.nb;
  const e = 2 / n;
  target.set(
    section.x,
    cy + ry * Math.sign(s) * Math.pow(Math.abs(s), e),
    section.hw * Math.sign(c) * Math.pow(Math.abs(c), e)
  );
  return target;
}

/**
 * Builds a closed lofted surface. `regionOf(x, thetaDeg)` returns a material
 * group index for each quad, so one grid can be split into paint and glass
 * with the same vertices and normals along the seams.
 */
function loftGeometry(profiles, { stepsPerSegment = 10, radialSegments = 96, regionOf = () => 0, groups = 1 } = {}) {
  const sections = sampleProfiles(profiles, stepsPerSegment);
  const rows = sections.length;
  const cols = radialSegments + 1;
  const positions = new Float32Array(rows * cols * 3);
  const uvs = new Float32Array(rows * cols * 2);
  const xMin = sections[rows - 1].x;
  const xMax = sections[0].x;
  const p = new THREE.Vector3();

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const theta = (j / radialSegments) * Math.PI * 2;
      sectionPoint(sections[i], theta, p);
      const k = i * cols + j;
      positions.set([p.x, p.y, p.z], k * 3);
      uvs.set([(p.x - xMin) / (xMax - xMin), j / radialSegments], k * 2);
    }
  }

  // Normals from central differences on the grid, wrapping around the section.
  const normals = new Float32Array(rows * cols * 3);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const du = new THREE.Vector3();
  const dv = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const get = (i, j, v) => v.fromArray(positions, (i * cols + j) * 3);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const jw = j % radialSegments;
      get(Math.max(i - 1, 0), jw, a);
      get(Math.min(i + 1, rows - 1), jw, b);
      du.subVectors(a, b); // points towards +x for rows ordered nose to tail
      get(i, (jw + 1) % radialSegments, a);
      get(i, (jw - 1 + radialSegments) % radialSegments, b);
      dv.subVectors(a, b);
      nrm.crossVectors(du, dv);
      if (nrm.lengthSq() < 1e-10 || sections[i].hw < 0.02) {
        nrm.set(i === 0 ? 1 : i === rows - 1 ? -1 : 0, 0, 0);
        if (nrm.lengthSq() === 0) nrm.crossVectors(du, dv);
      }
      nrm.normalize();
      normals.set([nrm.x, nrm.y, nrm.z], (i * cols + j) * 3);
    }
  }

  const indexLists = Array.from({ length: groups }, () => []);
  for (let i = 0; i < rows - 1; i++) {
    const xMid = (sections[i].x + sections[i + 1].x) / 2;
    for (let j = 0; j < radialSegments; j++) {
      const thetaDeg = ((j + 0.5) / radialSegments) * 360;
      const v00 = i * cols + j;
      const v10 = (i + 1) * cols + j;
      const v01 = i * cols + j + 1;
      const v11 = (i + 1) * cols + j + 1;
      const list = indexLists[regionOf(xMid, thetaDeg)];
      // Rows run from nose (+x) to tail, so this winding faces outwards.
      list.push(v00, v01, v10, v10, v01, v11);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  const all = [];
  indexLists.forEach((list, g) => {
    geometry.addGroup(all.length, list.length, g);
    all.push(...list);
  });
  geometry.setIndex(all);
  return geometry;
}

const inRange = (deg, from, to) => (from <= to ? deg >= from && deg <= to : deg >= from || deg <= to);

// ---------------------------------------------------------------------------
// Fuselage
// ---------------------------------------------------------------------------

// x, belly y, roof y, half width, top/bottom superellipse exponents.
// Blunt rounded nose, long flat-floored cabin, rear fuselage whose belly sweeps
// up into a long tapering tail boom.
const FUSELAGE_PROFILES = [
  { x: 3.31, yb: 1.245, yt: 1.255, hw: 0.002, nt: 2, nb: 2 },
  { x: 3.3, yb: 1.2, yt: 1.3, hw: 0.06, nt: 2, nb: 2 },
  { x: 3.25, yb: 0.98, yt: 1.62, hw: 0.42, nt: 2.2, nb: 2.2 },
  { x: 3.12, yb: 0.84, yt: 1.9, hw: 0.62, nt: 2.3, nb: 2.4 },
  { x: 2.9, yb: 0.74, yt: 2.1, hw: 0.76, nt: 2.4, nb: 2.6 },
  { x: 2.55, yb: 0.66, yt: 2.25, hw: 0.85, nt: 2.6, nb: 2.9 },
  { x: 2.05, yb: 0.62, yt: 2.33, hw: 0.9, nt: 2.8, nb: 3.2 },
  { x: 1.2, yb: 0.6, yt: 2.37, hw: 0.92, nt: 3.0, nb: 3.4 },
  { x: 0.2, yb: 0.6, yt: 2.37, hw: 0.92, nt: 3.0, nb: 3.4 },
  { x: -0.45, yb: 0.64, yt: 2.36, hw: 0.9, nt: 3.0, nb: 3.2 },
  { x: -1.0, yb: 0.8, yt: 2.33, hw: 0.84, nt: 2.8, nb: 3.0 },
  { x: -1.6, yb: 1.06, yt: 2.28, hw: 0.7, nt: 2.6, nb: 2.6 },
  { x: -2.2, yb: 1.34, yt: 2.22, hw: 0.48, nt: 2.4, nb: 2.3 },
  { x: -2.7, yb: 1.52, yt: 2.16, hw: 0.33, nt: 2.1, nb: 2.1 },
  { x: -3.3, yb: 1.62, yt: 2.12, hw: 0.27, nt: 2, nb: 2 },
  { x: -5.0, yb: 1.72, yt: 2.08, hw: 0.2, nt: 2, nb: 2 },
  { x: -6.9, yb: 1.82, yt: 2.05, hw: 0.12, nt: 2, nb: 2 },
  { x: -7.35, yb: 1.86, yt: 2.04, hw: 0.08, nt: 2, nb: 2 },
  { x: -7.45, yb: 1.93, yt: 1.97, hw: 0.01, nt: 2, nb: 2 },
];

const PAINT = 0;
const GLASS = 1;

// Livery stripe above the dark lower body (whose line is in fuselagePaint).
const STRIPE_HEIGHT = 0.07;
const STRIPE_END_X = -2.6;

// Which quads of the fuselage are glazing rather than paint.
function fuselageRegion(x, t) {
  const noseCap = x > 3.28;
  const windscreen =
    x > 1.95 &&
    inRange(t, 338, 202) &&
    !(x < 2.15 && inRange(t, 72, 108)) && // roof panel above the pilots
    !inRange(t, 86, 94); // centre frame
  const chin = x > 2.45 && (inRange(t, 224, 258) || inRange(t, 282, 316));
  const doorBand = inRange(t, 12, 72) || inRange(t, 108, 168);
  const frontDoor = x > 1.0 && x < 1.85 && doorBand;
  const rearDoor = x > -0.2 && x < 0.88 && doorBand;
  return !noseCap && (windscreen || chin || frontDoor || rearDoor) ? GLASS : PAINT;
}

/**
 * Paint with detail drawn per pixel from the object-space position, so livery
 * boundaries and panel seams stay crisp regardless of mesh resolution.
 * `glsl` runs after the base colour is set and may change `diffuseColor`,
 * using `p` (object-space position) and `seam(distance)`.
 */
function detailedPaint(base, glsl, uniforms = {}) {
  const material = base.clone();
  // Every instance shares the same onBeforeCompile source, so key programs by the injected code.
  material.customProgramCacheKey = () => glsl;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    const declarations = Object.keys(uniforms)
      .map((name) => `uniform vec3 ${name};`)
      .join('\n');
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        ${declarations}
        varying vec3 vObjPos;
        // 1 on a seam line of half width 4 mm, antialiased, 0 elsewhere.
        float seam(float d) {
          float aa = fwidth(d) * 1.2;
          return 1.0 - smoothstep(0.004, 0.004 + aa, abs(d));
        }`
      )
      .replace('#include <color_fragment>', `#include <color_fragment>\n{ vec3 p = vObjPos;\n${glsl}\n}`);
  };
  return material;
}

const glslFloat = (v) => v.toFixed(3);

// White with a dark lower body and thin blue stripe, plus door and access
// panel seams.
function fuselagePaint(m) {
  return detailedPaint(
    m.paint,
    `
    float line = p.x > -0.5 ? 0.98 : 0.98 + (-0.5 - p.x) * 0.42;
    if (p.y < line) diffuseColor.rgb = accentColor;
    else if (p.y < line + ${glslFloat(STRIPE_HEIGHT)} && p.x > ${glslFloat(STRIPE_END_X)}) diffuseColor.rgb = stripeColor;

    float s = 0.0;
    bool side = abs(p.z) > 0.45;
    // Front and rear cabin doors.
    if (side && p.y > 0.8 && p.y < 2.3) {
      s = max(s, seam(p.x - 1.93));
      s = max(s, seam(p.x - 0.94));
      s = max(s, seam(p.x + 0.26));
    }
    if (side && p.x > -0.26 && p.x < 1.93) s = max(s, seam(p.y - 0.8));
    // Baggage hold doors behind the cabin.
    if (side && p.x < -0.55 && p.x > -1.45) {
      s = max(s, seam(p.y - 2.0));
      s = max(s, seam(p.y - line - 0.16));
    }
    if (side && p.y < 2.0 && p.y > line + 0.16) {
      s = max(s, seam(p.x + 0.55));
      s = max(s, seam(p.x + 1.45));
    }
    // Tail boom joint and a removable belly panel.
    s = max(s, seam(p.x + 2.75));
    if (abs(p.z) < 0.5 && p.y < 0.7 && p.x > 0.2 && p.x < 2.0) s = max(s, seam(abs(p.z) - 0.35));
    diffuseColor.rgb *= 1.0 - 0.55 * s;
    `,
    { accentColor: { value: m.accent.color }, stripeColor: { value: m.stripe.color } }
  );
}

// Engine and gearbox cowl panels.
function cowlPaint(m) {
  return detailedPaint(
    m.paint,
    `
    float s = 0.0;
    s = max(s, seam(p.x - 0.95));
    s = max(s, seam(p.x + 1.05));
    s = max(s, seam(p.x + 2.2));
    if (abs(p.z) > 0.3) s = max(s, seam(p.y - 2.32));
    diffuseColor.rgb *= 1.0 - 0.5 * s;

    // Engine air intakes on both sides: dark recess with horizontal slats.
    if (abs(p.z) > 0.5 && p.x < -0.3 && p.x > -0.9 && p.y > 2.44 && p.y < 2.66) {
      float slat = step(0.5, fract((p.y - 2.44) / 0.036));
      diffuseColor.rgb = mix(vec3(0.03), vec3(0.16), slat);
      float rim = max(seam(p.x + 0.3), max(seam(p.x + 0.9), max(seam(p.y - 2.44), seam(p.y - 2.66))));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55), rim);
    }
    `
  );
}

function buildFuselage(m) {
  const group = new THREE.Group();
  const geometry = loftGeometry(FUSELAGE_PROFILES, { regionOf: fuselageRegion, groups: 2, stepsPerSegment: 14 });
  const shell = new THREE.Mesh(geometry, [fuselagePaint(m), m.glass]);
  shell.castShadow = true;
  group.add(shell);
  // Same surface seen from inside gives the cabin a dark lining behind the glass.
  group.add(new THREE.Mesh(geometry, [m.interior, m.hidden]));
  return group;
}

function buildCowling(m) {
  // Main gearbox and engine fairing: nearly cabin width, flat topped, ending
  // abruptly at the exhaust.
  const profiles = [
    { x: 1.25, yb: 2.25, yt: 2.3, hw: 0.5, nt: 3.5, nb: 2 },
    { x: 1.05, yb: 2.25, yt: 2.62, hw: 0.74, nt: 3.5, nb: 2 },
    { x: 0.5, yb: 2.25, yt: 2.8, hw: 0.8, nt: 3.5, nb: 2 },
    { x: -0.6, yb: 2.22, yt: 2.82, hw: 0.74, nt: 3.5, nb: 2 },
    { x: -1.6, yb: 2.15, yt: 2.72, hw: 0.62, nt: 3.2, nb: 2 },
    { x: -2.25, yb: 2.05, yt: 2.55, hw: 0.45, nt: 3, nb: 2 },
    { x: -2.45, yb: 2.02, yt: 2.4, hw: 0.3, nt: 2.5, nb: 2 },
    { x: -2.5, yb: 2.18, yt: 2.22, hw: 0.02, nt: 2, nb: 2 },
  ];
  const group = new THREE.Group();
  const cowl = new THREE.Mesh(loftGeometry(profiles, { stepsPerSegment: 12, radialSegments: 72 }), cowlPaint(m));
  cowl.castShadow = true;
  group.add(cowl);

  // Exhaust stack, angled back and slightly up.
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.42, 32, 1, true), m.exhaust);
  exhaust.rotation.z = Math.PI / 2 - 0.3;
  exhaust.position.set(-2.55, 2.36, 0);
  exhaust.castShadow = true;
  group.add(exhaust);
  return group;
}

function buildCabinInterior(m) {
  const group = new THREE.Group();
  const add = (geometry, material, x, y, z, rz = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.rotation.z = rz;
    group.add(mesh);
    return mesh;
  };

  const rounded = (w, h, d, r = 0.04) => new RoundedBoxGeometry(w, h, d, 3, r);

  add(new THREE.BoxGeometry(2.4, 0.04, 1.3), m.cabin, 1.1, 0.76, 0); // floor

  // Instrument panel with two dimly lit displays, under a glareshield.
  add(rounded(0.3, 0.32, 1.25, 0.05), m.cabin, 2.55, 1.2, 0, 0.5);
  add(rounded(0.26, 0.05, 1.3, 0.02), m.grille, 2.47, 1.38, 0, 0.2);
  for (const z of [0.3, -0.3]) {
    add(new THREE.PlaneGeometry(0.22, 0.17), m.screen, 2.46, 1.24, z).rotation.set(0, -Math.PI / 2, -0.5);
  }

  const seat = (x, z, back) => {
    add(rounded(0.46, 0.1, 0.46), m.seat, x, 0.95, z);
    add(rounded(0.1, back, 0.44), m.seat, x - 0.25, 0.97 + back / 2, z, -0.12);
    add(rounded(0.08, 0.16, 0.26), m.seat, x - 0.3, 1.04 + back, z, -0.12); // headrest
  };
  for (const z of [0.42, -0.42]) {
    seat(1.58, z, 0.62);
    add(new THREE.CylinderGeometry(0.015, 0.015, 0.55, 8), m.darkMetal, 1.93, 1.0, z, -0.25); // cyclic
  }
  // Collective lever beside the left (pilot's) seat.
  add(new THREE.CylinderGeometry(0.014, 0.014, 0.45, 8), m.darkMetal, 1.6, 0.98, -0.12, 1.2);
  for (const z of [0.5, 0, -0.5]) seat(0.38, z, 0.58);

  return group;
}

// ---------------------------------------------------------------------------
// Aerofoils and rotors
// ---------------------------------------------------------------------------

/** Symmetric NACA 00xx section in the xy plane, leading edge at x = 0, trailing edge at x = -chord. */
function airfoilShape(chord, thickness, points = 24) {
  const shape = new THREE.Shape();
  const yAt = (u) =>
    5 * thickness * chord * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u ** 2 + 0.2843 * u ** 3 - 0.1036 * u ** 4);
  for (let i = 0; i <= points; i++) {
    const u = (1 - Math.cos((i / points) * Math.PI)) / 2;
    const fn = i === 0 ? 'moveTo' : 'lineTo';
    shape[fn](-u * chord, yAt(u));
  }
  for (let i = points - 1; i > 0; i--) {
    const u = (1 - Math.cos((i / points) * Math.PI)) / 2;
    shape.lineTo(-u * chord, -yAt(u));
  }
  shape.closePath();
  return shape;
}

/** A blade whose span runs along +x from `root` to `tip`, chord along z with the leading edge at +z. */
function bladeGeometry(root, tip, chord, thickness) {
  const geometry = new THREE.ExtrudeGeometry(airfoilShape(chord, thickness), {
    depth: tip - root,
    bevelEnabled: false,
    steps: 1,
  });
  geometry.translate(chord * 0.25, 0, root - tip); // quarter chord on the pitch axis, span along -z
  geometry.rotateY(-Math.PI / 2); // span -z -> +x, leading edge +x -> +z
  geometry.translate(root, 0, 0);
  geometry.computeVertexNormals();
  return geometry;
}

function buildMainRotor(m) {
  const head = new THREE.Group();
  head.position.set(MAST_X, 0, 0);

  const mastFairing = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 0.32, 32), m.paint);
  mastFairing.position.y = 2.92;
  head.add(mastFairing);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.32, 16), m.darkMetal);
  mast.position.y = 3.06;
  head.add(mast);

  const swashplate = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 32), m.steel);
  swashplate.position.y = 3.0;
  head.add(swashplate);

  const rotor = new THREE.Group();
  rotor.position.y = ROTOR_HUB_Y;
  head.add(rotor);

  // Starflex hub: a three-armed star plate with a domed cap.
  const star = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 3), m.darkMetal);
  rotor.add(star);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), m.darkMetal);
  cap.position.y = 0.03;
  rotor.add(cap);

  const blade = bladeGeometry(0.55, MAIN_ROTOR_RADIUS, 0.35, 0.12);
  for (let i = 0; i < 3; i++) {
    const arm = new THREE.Group();
    arm.rotation.y = (i / 3) * Math.PI * 2;
    rotor.add(arm);

    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.07, 0.14), m.steel);
    sleeve.position.x = 0.38;
    arm.add(sleeve);

    const pitchLink = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.17, 8), m.steel);
    pitchLink.position.set(0.24, -0.09, 0.09);
    arm.add(pitchLink);

    // Blades sag a little at rest.
    const b = new THREE.Mesh(blade, m.blade);
    b.rotation.z = -0.018;
    b.castShadow = true;
    arm.add(b);

    // Light grey erosion cap on the tip.
    const tipCap = new THREE.Mesh(bladeGeometry(MAIN_ROTOR_RADIUS - 0.25, MAIN_ROTOR_RADIUS + 0.002, 0.352, 0.125), m.bladeTip);
    tipCap.rotation.z = -0.018;
    arm.add(tipCap);
  }

  return { head, rotor };
}

function buildTailRotor(m) {
  const group = new THREE.Group();
  group.position.copy(TAIL_ROTOR_POS);

  const gearbox = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 16), m.darkMetal);
  gearbox.scale.set(1.2, 1, 0.9);
  gearbox.position.z = 0.12;
  group.add(gearbox);

  const rotor = new THREE.Group();
  group.add(rotor);

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 16), m.steel);
  hub.rotation.x = Math.PI / 2;
  rotor.add(hub);

  // Two blades in the xy plane, spinning about z.
  const blade = bladeGeometry(0.08, TAIL_ROTOR_RADIUS, 0.16, 0.1);
  blade.rotateX(Math.PI / 2);
  for (let i = 0; i < 2; i++) {
    const b = new THREE.Mesh(blade, m.blade);
    b.rotation.z = i * Math.PI + 0.6; // parked at an angle so it clears the fin in side view
    b.castShadow = true;
    rotor.add(b);
  }

  return { group, rotor };
}

// ---------------------------------------------------------------------------
// Tail surfaces, skids and small details
// ---------------------------------------------------------------------------

function finMesh(points, thickness, material) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: thickness * 0.4,
    bevelSize: thickness * 0.4,
    bevelSegments: 3,
  });
  geometry.translate(0, 0, -thickness / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  return mesh;
}

function buildTail(m) {
  const group = new THREE.Group();

  // Upper and ventral vertical fins, in the dark livery colour.
  group.add(finMesh([[-6.55, 2.05], [-7.25, 3.05], [-7.55, 3.05], [-7.45, 1.98]], 0.05, m.accent));
  group.add(finMesh([[-6.8, 1.85], [-7.25, 1.25], [-7.48, 1.25], [-7.42, 1.9]], 0.05, m.accent));

  // Horizontal stabiliser through the boom.
  const span = 2.2;
  const stabGeometry = new THREE.ExtrudeGeometry(airfoilShape(0.46, 0.12), { depth: span, bevelEnabled: false });
  stabGeometry.translate(0, 0, -span / 2);
  const stab = new THREE.Mesh(stabGeometry, m.paint);
  stab.position.set(-5.9, 1.92, 0);
  stab.castShadow = true;
  group.add(stab);

  // End plate fins with navigation lights: red to port (left), green to starboard (right).
  for (const side of [1, -1]) {
    const plate = finMesh([[-5.93, 1.74], [-6.13, 2.26], [-6.37, 2.26], [-6.39, 1.74]], 0.035, m.accent);
    plate.position.z = side * (span / 2);
    group.add(plate);

    const light = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), side > 0 ? m.navGreen : m.navRed);
    light.position.set(-5.97, 1.92, side * (span / 2 + 0.03));
    group.add(light);
  }

  // Tail skid protecting the ventral fin.
  const skidCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-6.95, 1.55, 0),
    new THREE.Vector3(-7.3, 1.15, 0),
    new THREE.Vector3(-7.62, 1.2, 0),
  ]);
  group.add(new THREE.Mesh(new THREE.TubeGeometry(skidCurve, 24, 0.018, 8), m.skid));

  // Anti-collision beacon on the fin and white tail light.
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), m.navRed);
  beacon.position.set(-7.45, 3.09, 0);
  group.add(beacon);
  const tailLight = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), m.navWhite);
  tailLight.position.set(-7.47, 1.95, 0);
  group.add(tailLight);

  // Blade antenna on top of the boom.
  const antenna = finMesh([[-4.0, 2.05], [-4.12, 2.27], [-4.2, 2.27], [-4.22, 2.05]], 0.01, m.darkMetal);
  group.add(antenna);

  return group;
}

function buildSkids(m) {
  const group = new THREE.Group();
  const radius = 0.045;
  const track = 1.12;

  for (const x of [1.55, -0.3]) {
    const points = [
      [-track, 0.07], [-1.08, 0.3], [-0.95, 0.52], [-0.6, 0.62], [0, 0.63],
      [0.6, 0.62], [0.95, 0.52], [1.08, 0.3], [track, 0.07],
    ].map(([z, y]) => new THREE.Vector3(x, y, z));
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 64, radius, 12), m.skid);
    tube.castShadow = true;
    group.add(tube);
  }

  for (const side of [1, -1]) {
    const z = side * track;
    const points = [
      [2.75, 0.4], [2.68, 0.22], [2.5, 0.09], [2.2, 0.06], [-1.2, 0.06], [-1.3, 0.07],
    ].map(([x, y]) => new THREE.Vector3(x, y, z));
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 96, radius, 12), m.skid);
    tube.castShadow = true;
    group.add(tube);

    for (const end of [points[0], points[points.length - 1]]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), m.skid);
      cap.position.copy(end);
      group.add(cap);
    }

    // Boarding step on the cross tube.
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.14), m.darkMetal);
    step.position.set(1.55, 0.3, side * 1.02);
    group.add(step);
  }

  // Belly anti-collision light.
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), m.navRed);
  beacon.position.set(-0.3, 0.66, 0);
  group.add(beacon);

  return group;
}

// Door handles, pitot tubes, antennas, landing light and cargo hook.
function buildDetails(m) {
  const group = new THREE.Group();
  const add = (geometry, material, x, y, z) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };

  for (const side of [1, -1]) {
    // Door handles, just proud of the skin near each door's trailing edge.
    add(new THREE.BoxGeometry(0.14, 0.025, 0.025), m.steel, 1.06, 1.45, side * 0.935);
    add(new THREE.BoxGeometry(0.14, 0.025, 0.025), m.steel, -0.12, 1.45, side * 0.935);
    // Baggage hold latch.
    add(new THREE.BoxGeometry(0.08, 0.02, 0.02), m.steel, -0.75, 1.6, side * 0.83);

    // Pitot tubes on short masts above the windscreen.
    const mast = add(new THREE.BoxGeometry(0.03, 0.1, 0.01), m.darkMetal, 2.1, 2.38, side * 0.22);
    mast.rotation.z = -0.4;
    const tube = add(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 8), m.steel, 2.16, 2.43, side * 0.22);
    tube.rotation.z = Math.PI / 2;
  }

  // Swept VHF blade antenna under the belly and a GPS puck on the cowl.
  const blade = add(new THREE.BoxGeometry(0.2, 0.16, 0.012), m.darkMetal, -0.9, 0.72, 0);
  blade.rotation.z = -0.35;
  add(new THREE.CylinderGeometry(0.05, 0.06, 0.02, 20), m.grille, -1.5, 2.73, 0);

  // Retractable landing light under the chin.
  const light = add(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 24), m.steel, 2.6, 0.68, 0);
  light.rotation.z = 0.5;
  add(new THREE.CircleGeometry(0.06, 24), m.navWhite, 2.6, 0.66, 0).rotation.set(Math.PI / 2, 0.5, 0);

  // Cargo hook under the centre of gravity.
  add(new THREE.BoxGeometry(0.16, 0.06, 0.1), m.darkMetal, 0, 0.58, 0);

  return group;
}

/** Builds the H125 and returns its root object plus an `update` for animation. */
export function createH125() {
  const m = createMaterials();
  const root = new THREE.Group();
  root.name = 'H125';

  root.add(buildFuselage(m));
  root.add(buildCowling(m));
  root.add(buildCabinInterior(m));
  root.add(buildTail(m));
  root.add(buildSkids(m));
  root.add(buildDetails(m));

  const main = buildMainRotor(m);
  root.add(main.head);

  const tail = buildTailRotor(m);
  root.add(tail.group);

  root.traverse((o) => {
    if (o.isMesh && o.material !== m.glass) o.receiveShadow = true;
  });

  return {
    root,
    materials: m,
    // speed is 0..1; full speed is slowed from the real ~390 rpm so the blades stay readable.
    update(dt, speed) {
      main.rotor.rotation.y -= speed * Math.PI * 2 * 3 * dt; // clockwise seen from above
      tail.rotor.rotation.z += speed * Math.PI * 2 * 15 * dt;
    },
  };
}
