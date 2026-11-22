/**
 * Shared GLM model lineup — the SINGLE source of truth for every
 * user-facing GLM model list (v70/v71).
 *
 * Why a shared module: the same lineup was previously hand-copied in FOUR
 * places (ProviderManagerDialog quick-pick, ProviderManagerDialog Built-in
 * card dropdown, /api/providers/models curated branch, /api/providers/fix-model
 * fallback) and each copy drifted — new flagship models never appeared.
 * Now every consumer maps over ZAI_MODELS / ZAI_MODEL_IDS so adding a model
 * here updates every surface at once.
 *
 * Order: newest first. ZAI_DEFAULT_MODEL is deliberately the OLDER glm-4.6 —
 * it protects the owner's existing saved default from silent change.
 */
export interface ZaiModel {
  id: string
  name: string
}

export const ZAI_MODELS: ZaiModel[] = [
  { id: 'glm-5.3', name: 'GLM-5.3 (newest flagship)' },
  { id: 'glm-5.3-flash', name: 'GLM-5.3-Flash (fast flagship)' },
  { id: 'glm-5.2', name: 'GLM-5.2' },
  { id: 'glm-5.1', name: 'GLM-5.1' },
  { id: 'glm-5', name: 'GLM-5' },
  { id: 'glm-4.7', name: 'GLM-4.7' },
  { id: 'glm-4.6', name: 'GLM-4.6 (recommended default)' },
  { id: 'glm-4.5', name: 'GLM-4.5' },
  { id: 'glm-4-flash', name: 'GLM-4 Flash (fast)' },
  { id: 'glm-4v', name: 'GLM-4V (vision)' },
  { id: 'glm-4v-flash', name: 'GLM-4V Flash (vision fast)' },
  { id: 'glm-4-air', name: 'GLM-4 Air (light)' },
  { id: 'glm-4-airx', name: 'GLM-4 AirX (fast light)' },
]

export const ZAI_MODEL_IDS: string[] = ZAI_MODELS.map((m) => m.id)

/** Deliberately the proven default — NOT the newest flagship. */
export const ZAI_DEFAULT_MODEL = 'glm-4.6'
