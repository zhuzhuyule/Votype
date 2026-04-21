import type { CachedModel } from "./types";

export function getModelDisplayName(
  model: Pick<CachedModel, "custom_label" | "name" | "model_id">,
): string {
  const custom = model.custom_label?.trim();
  if (custom) return custom;
  const name = model.name?.trim();
  if (name && name !== model.model_id) return name;
  return model.model_id;
}
