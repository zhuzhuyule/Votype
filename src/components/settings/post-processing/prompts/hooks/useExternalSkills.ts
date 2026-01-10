import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { LLMPrompt, LLMPromptSchema } from "../../../../../lib/types";

const ExternalSkillsArraySchema = z.array(LLMPromptSchema);

export function useExternalSkills() {
  const [externalSkills, setExternalSkills] = useState<LLMPrompt[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadExternalSkills = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const skills = await invoke("get_external_skills");
      const parsed = ExternalSkillsArraySchema.safeParse(skills);
      if (parsed.success) {
        setExternalSkills(parsed.data);
      } else {
        console.error("Failed to parse external skills:", parsed.error);
        setError("Failed to parse external skills");
      }
    } catch (e) {
      console.error("Failed to load external skills:", e);
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refreshExternalSkills = useCallback(async () => {
    setIsLoading(true);
    try {
      const skills = await invoke("refresh_external_skills");
      const parsed = ExternalSkillsArraySchema.safeParse(skills);
      if (parsed.success) {
        setExternalSkills(parsed.data);
      }
    } catch (e) {
      console.error("Failed to refresh external skills:", e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const openSkillsFolder = useCallback(async () => {
    try {
      await invoke("open_skills_folder");
    } catch (e) {
      console.error("Failed to open skills folder:", e);
    }
  }, []);

  useEffect(() => {
    loadExternalSkills();
  }, [loadExternalSkills]);

  return {
    externalSkills,
    isLoading,
    error,
    refreshExternalSkills,
    openSkillsFolder,
  };
}
