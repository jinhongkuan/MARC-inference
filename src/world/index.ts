/**
 * The synthetic world: hidden agreements first, then the documents they leave behind.
 *
 * Nothing here is visible to an engine except the `Corpus` that `render` returns.
 */

export { buildWorld, DEFAULT_WORLD_CONFIG, REGIONS, type WorldConfig } from "./generate.ts";
export {
  type Agreement, type Arrangement, escalated, type Owner, rateOn, trueRelationships, type TruthKey, truthId,
  type Vendor, type World,
} from "./model.ts";
export { DEFAULT_RENDER_CONFIG, render, type RenderConfig, type Rendered } from "./render.ts";
