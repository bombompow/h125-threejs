import * as THREE from 'three';

// Coordinates are in metres: +x points forward (nose), +y up, +z to the pilot's right.
// The ground is y = 0 and the main rotor mast sits near x = -0.25.
// Section angles (theta) are in degrees: 0 = right side, 90 = top, 180 = left, 270 = belly.

const MAST_X = -0.25;
const ROTOR_HUB_Y = 3.08;
const MAIN_ROTOR_RADIUS = 5.345; // 10.69 m diameter
const TAIL_ROTOR_RADIUS = 0.93; // 1.86 m diameter
const TAIL_ROTOR_POS = new THREE.Vector3(-6.45, 2.05, -0.2);

function createMaterials() {
  return {
    paint: new THREE.MeshPhysicalMaterial({
      color: 0xb3121f,
      metalness: 0.15,
      roughness: 0.35,
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
    seat: new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.9 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.8, roughness: 0.4 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 1, roughness: 0.3 }),
    skid: new THREE.MeshStandardMaterial({ color: 0x8c9198, metalness: 0.6, roughness: 0.35 }),
    blade: new THREE.MeshStandardMaterial({ color: 0x2b2d31, metalness: 0.2, roughness: 0.5 }),
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
      const list = indexLists[regionOf(xMid, thetaDeg)];
      const v00 = i * cols + j;
      const v10 = (i + 1) * cols + j;
      const v01 = i * cols + j + 1;
      const v11 = (i + 1) * cols + j + 1;
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
const FUSELAGE_PROFILES = [
  { x: 2.46, yb: 1.12, yt: 1.16, hw: 0.02, nt: 2, nb: 2 },
  { x: 2.4, yb: 0.88, yt: 1.5, hw: 0.4, nt: 2.2, nb: 2.2 },
  { x: 2.22, yb: 0.72, yt: 1.85, hw: 0.66, nt: 2.3, nb: 2.4 },
  { x: 1.9, yb: 0.64, yt: 2.1, hw: 0.8, nt: 2.4, nb: 2.6 },
  { x: 1.4, yb: 0.6, yt: 2.27, hw: 0.88, nt: 2.6, nb: 3.0 },
  { x: 0.7, yb: 0.59, yt: 2.34, hw: 0.91, nt: 2.8, nb: 3.2 },
  { x: -0.2, yb: 0.6, yt: 2.34, hw: 0.9, nt: 2.8, nb: 3.2 },
  { x: -0.85, yb: 0.66, yt: 2.3, hw: 0.86, nt: 2.8, nb: 3.0 },
  { x: -1.4, yb: 0.86, yt: 2.22, hw: 0.7, nt: 2.6, nb: 2.6 },
  { x: -1.9, yb: 1.15, yt: 2.1, hw: 0.48, nt: 2.4, nb: 2.4 },
  { x: -2.35, yb: 1.38, yt: 1.98, hw: 0.3, nt: 2.2, nb: 2.2 },
  { x: -2.9, yb: 1.48, yt: 1.93, hw: 0.23, nt: 2, nb: 2 },
  { x: -4.5, yb: 1.57, yt: 1.89, hw: 0.17, nt: 2, nb: 2 },
  { x: -6.1, yb: 1.66, yt: 1.86, hw: 0.1, nt: 2, nb: 2 },
  { x: -6.45, yb: 1.7, yt: 1.84, hw: 0.07, nt: 2, nb: 2 },
  { x: -6.5, yb: 1.76, yt: 1.78, hw: 0.01, nt: 2, nb: 2 },
];

// Which quads of the fuselage are glazing (1) rather than painted skin (0).
function fuselageRegion(x, t) {
  if (x > 2.44) return 0; // nose cap
  const windscreen =
    x > 1.08 &&
    inRange(t, 338, 202) &&
    !(x < 1.55 && inRange(t, 72, 108)) && // roof panel above the pilots
    !inRange(t, 86, 94); // centre frame
  const chin = x > 1.45 && (inRange(t, 222, 258) || inRange(t, 282, 318));
  const doorBand = inRange(t, 12, 70) || inRange(t, 110, 168);
  const frontDoor = x > 0.35 && x < 1.0 && doorBand;
  const rearDoor = x > -0.75 && x < 0.22 && doorBand;
  return windscreen || chin || frontDoor || rearDoor ? 1 : 0;
}

function buildFuselage(m) {
  const group = new THREE.Group();
  const geometry = loftGeometry(FUSELAGE_PROFILES, { regionOf: fuselageRegion, groups: 2, stepsPerSegment: 14 });
  const shell = new THREE.Mesh(geometry, [m.paint, m.glass]);
  shell.castShadow = true;
  group.add(shell);
  // Same surface seen from inside gives the cabin a dark lining behind the glass.
  group.add(new THREE.Mesh(geometry, [m.interior, m.hidden]));
  return group;
}

function buildCowling(m) {
  const profiles = [
    { x: 0.3, yb: 2.2, yt: 2.26, hw: 0.4, nt: 3.5, nb: 2 },
    { x: 0.15, yb: 2.2, yt: 2.62, hw: 0.56, nt: 3.5, nb: 2 },
    { x: -0.5, yb: 2.2, yt: 2.78, hw: 0.62, nt: 3.5, nb: 2 },
    { x: -1.4, yb: 2.15, yt: 2.76, hw: 0.6, nt: 3.5, nb: 2 },
    { x: -2.1, yb: 2.0, yt: 2.62, hw: 0.45, nt: 3, nb: 2 },
    { x: -2.5, yb: 1.9, yt: 2.4, hw: 0.25, nt: 2.5, nb: 2 },
    { x: -2.6, yb: 2.12, yt: 2.16, hw: 0.02, nt: 2, nb: 2 },
  ];
  const group = new THREE.Group();
  const cowl = new THREE.Mesh(loftGeometry(profiles, { stepsPerSegment: 12, radialSegments: 72 }), m.paint);
  cowl.castShadow = true;
  group.add(cowl);

  // Engine air intake grilles on both sides.
  for (const side of [1, -1]) {
    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.15, 0.02), m.grille);
    grille.position.set(-0.95, 2.5, side * 0.615);
    group.add(grille);
  }

  // Exhaust stack, angled back and slightly up.
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.42, 32, 1, true), m.exhaust);
  exhaust.rotation.z = Math.PI / 2 - 0.3;
  exhaust.position.set(-2.5, 2.42, 0);
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

  add(new THREE.BoxGeometry(2.5, 0.04, 1.4), m.cabin, 0.45, 0.74, 0); // floor
  add(new THREE.BoxGeometry(0.35, 0.3, 1.3), m.cabin, 1.72, 1.2, 0, 0.5); // instrument panel
  add(new THREE.BoxGeometry(0.25, 0.04, 1.32), m.grille, 1.62, 1.38, 0, 0.2); // glareshield

  for (const z of [0.42, -0.42]) {
    add(new THREE.BoxGeometry(0.5, 0.12, 0.5), m.seat, 0.75, 0.95, z);
    add(new THREE.BoxGeometry(0.1, 0.75, 0.5), m.seat, 0.48, 1.35, z, -0.12);
    add(new THREE.CylinderGeometry(0.015, 0.015, 0.55, 8), m.darkMetal, 1.08, 1.0, z, -0.25); // cyclic
  }
  for (const z of [0.55, 0, -0.55]) {
    add(new THREE.BoxGeometry(0.48, 0.12, 0.5), m.seat, -0.35, 0.95, z);
    add(new THREE.BoxGeometry(0.1, 0.72, 0.5), m.seat, -0.62, 1.34, z, -0.1);
  }
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
  mastFairing.position.y = 2.82;
  head.add(mastFairing);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.32, 16), m.darkMetal);
  mast.position.y = 2.98;
  head.add(mast);

  const swashplate = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 32), m.steel);
  swashplate.position.y = 2.92;
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

    const b = new THREE.Mesh(blade, m.blade);
    b.castShadow = true;
    arm.add(b);
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

  // Upper and ventral vertical fins.
  group.add(finMesh([[-5.72, 1.86], [-6.36, 2.86], [-6.62, 2.86], [-6.5, 1.8]], 0.05, m.paint));
  group.add(finMesh([[-5.95, 1.7], [-6.38, 1.16], [-6.58, 1.16], [-6.48, 1.72]], 0.05, m.paint));

  // Horizontal stabiliser through the boom.
  const span = 2.2;
  const stabGeometry = new THREE.ExtrudeGeometry(airfoilShape(0.46, 0.12), { depth: span, bevelEnabled: false });
  stabGeometry.translate(0, 0, -span / 2);
  const stab = new THREE.Mesh(stabGeometry, m.paint);
  stab.position.set(-4.95, 1.74, 0);
  stab.castShadow = true;
  group.add(stab);

  // End plate fins with navigation lights: red to port (left), green to starboard (right).
  for (const side of [1, -1]) {
    const plate = finMesh([[-4.98, 1.58], [-5.18, 2.08], [-5.42, 2.08], [-5.44, 1.58]], 0.035, m.paint);
    plate.position.z = side * (span / 2);
    group.add(plate);

    const light = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), side > 0 ? m.navGreen : m.navRed);
    light.position.set(-5.02, 1.74, side * (span / 2 + 0.03));
    group.add(light);
  }

  // Tail skid protecting the ventral fin.
  const skidCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-6.05, 1.42, 0),
    new THREE.Vector3(-6.4, 1.08, 0),
    new THREE.Vector3(-6.72, 1.12, 0),
  ]);
  group.add(new THREE.Mesh(new THREE.TubeGeometry(skidCurve, 24, 0.018, 8), m.skid));

  // Anti-collision beacon on the fin and white tail light.
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), m.navRed);
  beacon.position.set(-6.5, 2.9, 0);
  group.add(beacon);
  const tailLight = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), m.navWhite);
  tailLight.position.set(-6.52, 1.78, 0);
  group.add(tailLight);

  // Blade antenna on top of the boom.
  const antenna = finMesh([[-3.2, 1.9], [-3.32, 2.12], [-3.4, 2.12], [-3.42, 1.9]], 0.01, m.darkMetal);
  group.add(antenna);

  return group;
}

function buildSkids(m) {
  const group = new THREE.Group();
  const radius = 0.045;
  const track = 1.12;

  for (const x of [1.05, -0.65]) {
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
      [2.05, 0.38], [1.98, 0.22], [1.82, 0.09], [1.5, 0.06], [-1.6, 0.06], [-1.7, 0.07],
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
    step.position.set(0.15, 0.32, side * 0.98);
    group.add(step);
  }

  // Belly anti-collision light.
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), m.navRed);
  beacon.position.set(-0.6, 0.66, 0);
  group.add(beacon);

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
