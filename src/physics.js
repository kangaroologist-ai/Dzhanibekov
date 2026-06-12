export const INERTIA = Object.freeze({
  x: 1.0,
  y: 2.0,
  z: 3.2,
});

export const PRESETS = Object.freeze({
  middle: { x: 0.04, y: 2.15, z: 0.06 },
  min: { x: 2.05, y: 0.04, z: 0.04 },
  max: { x: 0.04, y: 0.04, z: 1.85 },
});

export function eulerDerivative(omega, inertia = INERTIA) {
  const { x: i1, y: i2, z: i3 } = inertia;
  return {
    x: ((i2 - i3) / i1) * omega.y * omega.z,
    y: ((i3 - i1) / i2) * omega.z * omega.x,
    z: ((i1 - i2) / i3) * omega.x * omega.y,
  };
}

export function invariants(omega, inertia = INERTIA) {
  const { x: i1, y: i2, z: i3 } = inertia;
  const energy = 0.5 * (i1 * omega.x ** 2 + i2 * omega.y ** 2 + i3 * omega.z ** 2);
  const angularMomentumSq =
    i1 ** 2 * omega.x ** 2 + i2 ** 2 * omega.y ** 2 + i3 ** 2 * omega.z ** 2;

  return {
    energy,
    angularMomentumSq,
    angularMomentum: Math.sqrt(Math.max(angularMomentumSq, 0)),
    ratio: angularMomentumSq / Math.max(2 * energy, Number.EPSILON),
  };
}

export function implicitMidpointStep(omega, dt, inertia = INERTIA) {
  if (dt === 0) return { ...omega };

  const { x: i1, y: i2, z: i3 } = inertia;
  const a1 = (i2 - i3) / i1;
  const a2 = (i3 - i1) / i2;
  const a3 = (i1 - i2) / i3;

  let mid = { ...omega };

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const f = {
      x: a1 * mid.y * mid.z,
      y: a2 * mid.z * mid.x,
      z: a3 * mid.x * mid.y,
    };

    const residual = [
      mid.x - omega.x - 0.5 * dt * f.x,
      mid.y - omega.y - 0.5 * dt * f.y,
      mid.z - omega.z - 0.5 * dt * f.z,
    ];

    if (norm3(residual) < 1e-13) break;

    const jacobian = [
      [1, -0.5 * dt * a1 * mid.z, -0.5 * dt * a1 * mid.y],
      [-0.5 * dt * a2 * mid.z, 1, -0.5 * dt * a2 * mid.x],
      [-0.5 * dt * a3 * mid.y, -0.5 * dt * a3 * mid.x, 1],
    ];

    const delta = solve3x3(jacobian, residual);
    mid = {
      x: mid.x - delta[0],
      y: mid.y - delta[1],
      z: mid.z - delta[2],
    };

    if (norm3(delta) < 1e-13) break;
  }

  return {
    x: 2 * mid.x - omega.x,
    y: 2 * mid.y - omega.y,
    z: 2 * mid.z - omega.z,
  };
}

export function stepWithSubsteps(omega, duration, baseStep, inertia = INERTIA, onSubstep) {
  let current = omega;
  let remaining = Math.max(duration, 0);

  while (remaining > 1e-12) {
    const h = Math.min(baseStep, remaining);
    const next = implicitMidpointStep(current, h, inertia);
    const midpoint = {
      x: 0.5 * (current.x + next.x),
      y: 0.5 * (current.y + next.y),
      z: 0.5 * (current.z + next.z),
    };

    if (onSubstep) onSubstep({ previous: current, next, midpoint, dt: h });
    current = next;
    remaining -= h;
  }

  return current;
}

function norm3(values) {
  return Math.hypot(values[0], values[1], values[2]);
}

function solve3x3(matrix, vector) {
  const [a, b, c] = matrix[0];
  const [d, e, f] = matrix[1];
  const [g, h, i] = matrix[2];
  const [j, k, l] = vector;

  const det =
    a * (e * i - f * h) -
    b * (d * i - f * g) +
    c * (d * h - e * g);

  if (Math.abs(det) < 1e-15) return [0, 0, 0];

  const dx =
    j * (e * i - f * h) -
    b * (k * i - f * l) +
    c * (k * h - e * l);
  const dy =
    a * (k * i - f * l) -
    j * (d * i - f * g) +
    c * (d * l - k * g);
  const dz =
    a * (e * l - k * h) -
    b * (d * l - k * g) +
    j * (d * h - e * g);

  return [dx / det, dy / det, dz / det];
}
