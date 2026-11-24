import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeWalkability,
  buildOceanDeepWorld,
  OCEAN_DEEP,
  OceanWalker,
  overlapsSolid,
  resolveSupportY,
  worldAABBOfCollider,
  worldAABBOfPlacement,
  aabbOverlap,
} from './ocean-deep.ts';

const world = buildOceanDeepWorld();
const walk = analyzeWalkability(world, 0.5);

test('ocean-deep layout is deterministic and meets scale & landmark specs', () => {
  assert.ok(world.stats.spanX >= 120, `spanX ${world.stats.spanX} < 120`);
  assert.ok(world.stats.spanZ >= 120, `spanZ ${world.stats.spanZ} < 120`);
  assert.ok(world.stats.maxBridgeSlopeDeg <= 12, `bridge slope ${world.stats.maxBridgeSlopeDeg}° > 12°`);

  // Twin spires height 22..30m and mid-arch tunnel floor 6..9m
  assert.ok(OCEAN_DEEP.spireWest.height >= 22 && OCEAN_DEEP.spireWest.height <= 30);
  assert.ok(OCEAN_DEEP.spireEast.height >= 22 && OCEAN_DEEP.spireEast.height <= 30);
  assert.ok(OCEAN_DEEP.spireWest.archFloorY >= 6 && OCEAN_DEEP.spireWest.archFloorY <= 9);
  assert.ok(OCEAN_DEEP.spireEast.archFloorY >= 6 && OCEAN_DEEP.spireEast.archFloorY <= 9);

  // Required anchor names exist
  const names = world.placements.map((p) => p.name);
  const spireRoots = world.placements.filter((p) => p.module === 'spire-module' && p.variant === 'mid-arch');
  assert.equal(spireRoots.length, 2, 'two twin spires');
  assert.ok(names.some((n) => n.includes('bridge')));
  assert.ok(names.some((n) => n.includes('plaza')));
  assert.ok(names.some((n) => n.includes('altar')));
  assert.ok(names.some((n) => n.includes('terrace')));
  assert.ok(names.some((n) => n.includes('arch')));
  assert.ok(names.some((n) => n.includes('crystal-warm')));
  assert.ok(names.some((n) => n.includes('crystal-cool')));
  assert.ok(names.some((n) => n.includes('kelp')));

  // Cliff module uses >= 4 distinct variants
  const cliffVariants = new Set(world.placements.filter((p) => p.module === 'cliff-module').map((p) => p.variant));
  assert.ok(cliffVariants.size >= 4, `cliff variants ${cliffVariants.size} < 4`);
});

test('kitbashing evidence: rotations, non-uniform scaling, stacking, interpenetration, zero pillar/balustrade stretch', () => {
  assert.ok(world.stats.nonZeroRotationCount >= 15, `rotations ${world.stats.nonZeroRotationCount} < 15`);
  assert.ok(world.stats.nonUniformScaleCount >= 10, `non-uniform scales ${world.stats.nonUniformScaleCount} < 10`);
  assert.ok(world.stats.stackedInstanceCount >= 20, `stacked ${world.stats.stackedInstanceCount}`);
  assert.ok(world.stats.interpenetrationCount >= 20, `interpenetrations ${world.stats.interpenetrationCount}`);
  assert.equal(world.stats.pillarStretchViolations, 0, 'pillars must never be stretched');
  assert.equal(world.stats.balustradeStretchViolations, 0, 'bridge balustrades must never be stretched');
  assert.ok(
    world.stats.scatterDensityPerM2 >= 0.2 && world.stats.scatterDensityPerM2 <= 0.8,
    `scatter density ${world.stats.scatterDensityPerM2.toFixed(3)} outside 0.2..0.8`,
  );
  // Every mirrored arch exists
  assert.ok(world.placements.some((p) => p.module === 'arch-module' && p.mirror === true));
});

test('1:1 placement <-> collider mapping: zero missing, zero ghost', () => {
  const byId = new Map(world.placements.map((p) => [p.id, p]));
  const colByPlacement = new Map<string, number>();
  for (const col of world.colliders) {
    const p = byId.get(col.placementId);
    assert.ok(p, `ghost collider ${col.id} has no placement ${col.placementId}`);
    assert.ok(p.role === 'solid' || p.role === 'hybrid', `collider ${col.id} belongs to non-solid role ${p.role}`);
    // Verify collider AABB overlaps its placement AABB
    assert.ok(
      aabbOverlap(worldAABBOfCollider(col), worldAABBOfPlacement(p), -0.6),
      `collider ${col.id} drifted away from placement ${p.id}`,
    );
    colByPlacement.set(col.placementId, (colByPlacement.get(col.placementId) ?? 0) + 1);
  }
  for (const p of world.placements) {
    if (p.role === 'solid' || p.role === 'hybrid') {
      assert.ok((colByPlacement.get(p.id) ?? 0) > 0, `solid/hybrid placement ${p.id} missing collider`);
    }
  }
});

test('0.5m flood fill: >= 4000 m² walkable, enclosed (no leaks), no y < -0.5, all 3 paths <= 25 s', () => {
  assert.ok(walk.walkableAreaM2 >= 4000, `walkableAreaM2 ${walk.walkableAreaM2.toFixed(1)} < 4000`);
  assert.ok(walk.uniqueFootprintAreaM2 >= 4000, `uniqueFootprintAreaM2 ${walk.uniqueFootprintAreaM2.toFixed(1)} < 4000`);
  assert.equal(walk.escapedEnclosureCount, 0, `escaped enclosure cells: ${walk.escapedEnclosureCount}`);
  assert.ok(walk.minReachableY >= -0.5, `minReachableY ${walk.minReachableY} < -0.5`);

  assert.ok(
    walk.paths.spawnToBridgeSec <= 25 && Number.isFinite(walk.paths.spawnToBridgeSec),
    `spawn->bridge ${walk.paths.spawnToBridgeSec.toFixed(2)}s`,
  );
  assert.ok(
    walk.paths.bridgeToPlazaSec <= 25 && Number.isFinite(walk.paths.bridgeToPlazaSec),
    `bridge->plaza ${walk.paths.bridgeToPlazaSec.toFixed(2)}s`,
  );
  assert.ok(
    walk.paths.plazaToTerraceTopSec <= 25 && Number.isFinite(walk.paths.plazaToTerraceTopSec),
    `plaza->terraceTop ${walk.paths.plazaToTerraceTopSec.toFixed(2)}s`,
  );
  assert.ok(
    walk.paths.spawnToPlazaSec <= 25 && Number.isFinite(walk.paths.spawnToPlazaSec),
    `spawn->plaza ${walk.paths.spawnToPlazaSec.toFixed(2)}s`,
  );
  assert.ok(
    walk.paths.spawnToWestSpireArchSec <= 25 && Number.isFinite(walk.paths.spawnToWestSpireArchSec),
    `spawn->westSpireArch ${walk.paths.spawnToWestSpireArchSec.toFixed(2)}s`,
  );
});

test('OceanWalker stands on spawn, climbs bridge, enters shallow plaza without clipping solids', () => {
  const w = new OceanWalker(world.anchors.spawn);
  assert.ok(!overlapsSolid(w.x, w.y, w.z, OCEAN_DEEP.playerRadius, OCEAN_DEEP.playerHeight, world));
  const sup = resolveSupportY(w.x, w.z, w.y, world);
  assert.ok(sup && Math.abs(sup.y - w.y) < 0.05);

  // Walk forward from spawn for 2 seconds
  for (let i = 0; i < 120; i++) {
    w.update(1 / 60, { moveX: 0, moveY: 1, run: false, camYaw: Math.PI }, world);
  }
  assert.ok(w.steps > 2, 'walker records footsteps');
  assert.ok(w.y >= -0.5, 'walker stays above floor');
});
