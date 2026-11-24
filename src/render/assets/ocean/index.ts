export { getOceanMaterials, applyVerticalAO, normalizeForMerge, type OceanMaterials } from './materials.ts';
export { createCliffModule, getCliffGeometry, type CliffVariant } from './cliff-module.ts';
export { createSpireModule, type SpireVariant } from './spire-module.ts';
export { createArchModule, type ArchVariant } from './arch-module.ts';
export { createPillarModule, getPillarGeometry } from './pillar-module.ts';
export { createBridgeDeck, type BridgeDeckOpts } from './bridge-deck.ts';
export { createStairModule, type StairOpts } from './stair-module.ts';
export { createTerraceModule, type TerraceOpts } from './terrace-module.ts';
export { createAltarModule } from './altar-module.ts';
export {
  createCrystalCluster,
  getCrystalClusterGeometry,
  getCrystalPlinthGeometry,
  type CrystalVariant,
} from './crystal-cluster.ts';
export { createKelpModule, getKelpGeometry, getRubbleGeometry, type KelpVariant } from './kelp.ts';
