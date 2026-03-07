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
      // Load user/imported skills, builtin skills, and saved order
      const [userSkills, builtinSkills, skillOrder] = await Promise.all([
        invoke("get_all_skills"),
        invoke("get_builtin_skills"),
        invoke<string[]>("get_skills_order"),
      ]);

      const parsedUser = SkillsArraySchema.safeParse(userSkills);
      const parsedBuiltin = SkillsArraySchema.safeParse(builtinSkills);

      if (parsedUser.success && parsedBuiltin.success) {
        // Combine builtin and user skills
        const combined = [...parsedBuiltin.data, ...parsedUser.data];

        // Apply saved ordering
        if (Array.isArray(skillOrder) && skillOrder.length > 0) {
          const orderMap = new Map(skillOrder.map((id, idx) => [id, idx]));
          combined.sort((a, b) => {
            const posA = orderMap.get(a.id);
            const posB = orderMap.get(b.id);
            if (posA !== undefined && posB !== undefined) return posA - posB;
            if (posA !== undefined) return -1;
            if (posB !== undefined) return 1;
            return 0;
          });
        }

        setSkills(combined);
      } else {
        console.error(
          "Failed to parse skills:",
          parsedUser.error || parsedBuiltin.error,
        );
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
          confidence_check_enabled: skillData.confidence_check_enabled ?? false,
          confidence_threshold: skillData.confidence_threshold ?? 70,
          output_mode: skillData.output_mode || "polish",
          enabled: skillData.enabled ?? true,
          customized: false,
          locked: false,
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
