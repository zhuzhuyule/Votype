import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { LLMPrompt, LLMPromptSchema } from "../../../../../lib/types";

const SkillsArraySchema = z.array(LLMPromptSchema);

export interface UseSkillsReturn {
  skills: LLMPrompt[];
  isLoading: boolean;
  error: string | null;
  refreshSkills: () => Promise<void>;
  saveSkill: (skill: LLMPrompt) => Promise<void>;
  createSkill: (skill: Partial<LLMPrompt>) => Promise<LLMPrompt>;
  deleteSkill: (id: string) => Promise<void>;
  openSkillsFolder: () => Promise<void>;
}

/**
 * Unified hook for managing all skills (user, imported)
 * Replaces both useExternalSkills and parts of usePrompts
 */
export function useSkills(): UseSkillsReturn {
  const [skills, setSkills] = useState<LLMPrompt[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSkills = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await invoke("get_all_skills");
      const parsed = SkillsArraySchema.safeParse(result);
      if (parsed.success) {
        setSkills(parsed.data);
      } else {
        console.error("Failed to parse skills:", parsed.error);
        setError("Failed to parse skills");
      }
    } catch (e) {
      console.error("Failed to load skills:", e);
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refreshSkills = useCallback(async () => {
    await loadSkills();
  }, [loadSkills]);

  const saveSkill = useCallback(
    async (skill: LLMPrompt) => {
      try {
        await invoke("save_external_skill", { skill });
        await loadSkills();
      } catch (e) {
        console.error("Failed to save skill:", e);
        throw e;
      }
    },
    [loadSkills],
  );

  const createSkill = useCallback(
    async (skillData: Partial<LLMPrompt>): Promise<LLMPrompt> => {
      try {
        const defaultSkill: LLMPrompt = {
          id: "",
          name: skillData.name || "New Skill",
          description: skillData.description || "",
          instructions: skillData.instructions || "",
          model_id: skillData.model_id || null,
          icon: skillData.icon || null,
          skill_type: skillData.skill_type || "text",
          source: "user",
          compliance_check_enabled: skillData.compliance_check_enabled || false,
          compliance_threshold: skillData.compliance_threshold || 20,
          output_mode: skillData.output_mode || "polish",
          enabled: skillData.enabled ?? true,
          customized: false,
        };

        const newSkill = await invoke<LLMPrompt>("create_skill", {
          skill: defaultSkill,
        });
        await loadSkills();
        return newSkill;
      } catch (e) {
        console.error("Failed to create skill:", e);
        throw e;
      }
    },
    [loadSkills],
  );

  const deleteSkill = useCallback(
    async (id: string) => {
      try {
        await invoke("delete_skill", { id });
        await loadSkills();
      } catch (e) {
        console.error("Failed to delete skill:", e);
        throw e;
      }
    },
    [loadSkills],
  );

  const openSkillsFolder = useCallback(async () => {
    try {
      await invoke("open_skills_folder");
    } catch (e) {
      console.error("Failed to open skills folder:", e);
    }
  }, []);

  // Load skills on mount
  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  return {
    skills,
    isLoading,
    error,
    refreshSkills,
    saveSkill,
    createSkill,
    deleteSkill,
    openSkillsFolder,
  };
}
