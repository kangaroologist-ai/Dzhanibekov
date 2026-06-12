import { INERTIA, PRESETS, invariants, implicitMidpointStep } from '../src/physics.js';

const initial = PRESETS.middle;
const reference = invariants(initial, INERTIA);
let omega = { ...initial };

const steps = 20000;
const dt = 0.004;

for (let index = 0; index < steps; index += 1) {
  omega = implicitMidpointStep(omega, dt, INERTIA);
}

const current = invariants(omega, INERTIA);
const energyDrift = Math.abs(current.energy / reference.energy - 1);
const momentumDrift = Math.abs(current.angularMomentumSq / reference.angularMomentumSq - 1);
const tolerance = 5e-10;

console.log(`energy drift: ${energyDrift}`);
console.log(`angular momentum squared drift: ${momentumDrift}`);
console.log(`final omega: (${omega.x.toFixed(6)}, ${omega.y.toFixed(6)}, ${omega.z.toFixed(6)})`);

if (energyDrift > tolerance || momentumDrift > tolerance) {
  process.exitCode = 1;
}
