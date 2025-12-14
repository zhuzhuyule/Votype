import type { TFunction } from "i18next";
import type { ModelInfo } from "../types";

/**
 * Get the translated name for a model
 * @param model - The model info object
 * @param t - The translation function from useTranslation
 * @returns The translated model name, or the original name if no translation exists
 */
export function getTranslatedModelName(model: ModelInfo, t: TFunction): string {
  const translationKey = `models.${model.id}.name`;
  const translated = t(translationKey, { defaultValue: "" });
  if (translated !== "") return translated;

  // Backwards compatibility: older locale files kept onboarding model strings here.
  const onboardingKey = `onboarding.models.${model.id}.name`;
  const onboardingTranslated = t(onboardingKey, { defaultValue: "" });
  if (onboardingTranslated !== "") return onboardingTranslated;

  return translated !== "" ? translated : model.name;
}

/**
 * Get the translated description for a model
 * @param model - The model info object
 * @param t - The translation function from useTranslation
 * @returns The translated model description, or the original description if no translation exists
 */
export function getTranslatedModelDescription(
  model: ModelInfo,
  t: TFunction,
): string {
  const translationKey = `models.${model.id}.description`;
  const translated = t(translationKey, { defaultValue: "" });
  if (translated !== "") return translated;

  // Backwards compatibility: older locale files kept onboarding model strings here.
  const onboardingKey = `onboarding.models.${model.id}.description`;
  const onboardingTranslated = t(onboardingKey, { defaultValue: "" });
  if (onboardingTranslated !== "") return onboardingTranslated;

  // If backend provided a translation key, attempt it before falling back to raw.
  const directKeyTranslated = t(model.description, { defaultValue: "" });
  if (directKeyTranslated !== "") return directKeyTranslated;

  return model.description;
}
