import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { LLMPrompt, LLMPromptSchema } from "../../../../../lib/types";

const ExternalSkillsArraySchema = z.array(LLMPromptSchema);

// Template for creating new skills
export interface SkillTemplate {
  id: string;
  name: string;
  description: string;
  instructions: string;
  icon: string | null;
  output_mode: string;
}

const SkillTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  instructions: z.string(),
  icon: z.string().nullable(),
  output_mode: z.string(),
});

const SkillTemplatesArraySchema = z.array(SkillTemplateSchema);

export function useExternalSkills() {
  const [externalSkills, setExternalSkills] = useState<LLMPrompt[]>([]);
  const [skillOrder, setSkillOrder] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadExternalSkills = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [userSkills, builtinSkills, savedOrder] = await Promise.all([
        invoke("get_all_skills"),
        invoke("get_builtin_skills"),
        invoke<string[]>("get_skills_order"),
      ]);

      const parsedUser = ExternalSkillsArraySchema.safeParse(userSkills);
      const parsedBuiltin = ExternalSkillsArraySchema.safeParse(builtinSkills);

      // Merge: user skills first (take priority), then fill in builtins
      // that don't have a user equivalent (by ID or by name).
      const userList = parsedUser.success ? parsedUser.data : [];
      const builtinList = parsedBuiltin.success ? parsedBuiltin.data : [];

      if (!parsedUser.success) {
        console.error("Failed to parse user skills:", parsedUser.error);
        setError("Failed to parse user skills");
      }

      const combined: LLMPrompt[] = [...userList];
      const usedIds = new Set(userList.map((s) => s.id));
      const usedNames = new Set(
        userList.map((s) => s.name.trim().toLowerCase()),
      );

      for (const builtin of builtinList) {
        // Skip if user already has a skill with the same ID or same name
        if (usedIds.has(builtin.id)) continue;
        if (usedNames.has(builtin.name.trim().toLowerCase())) continue;
        combined.push(builtin);
        usedIds.add(builtin.id);
        usedNames.add(builtin.name.trim().toLowerCase());
      }

      setExternalSkills(combined);

      if (Array.isArray(savedOrder)) {
        setSkillOrder(savedOrder);
      }
    } catch (e) {
      console.error("Failed to load skills:", e);
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refreshExternalSkills = useCallback(async () => {
    setIsLoading(true);
    try {
      const [userSkills, builtinSkills, savedOrder] = await Promise.all([
        invoke("get_all_skills"),
        invoke("get_builtin_skills"),
        invoke<string[]>("get_skills_order"),
      ]);

      const parsedUser = ExternalSkillsArraySchema.safeParse(userSkills);
      const parsedBuiltin = ExternalSkillsArraySchema.safeParse(builtinSkills);

      const userList = parsedUser.success ? parsedUser.data : [];
      const builtinList = parsedBuiltin.success ? parsedBuiltin.data : [];
      const combined: LLMPrompt[] = [...userList];
      const usedIds = new Set(userList.map((s) => s.id));
      const usedNames = new Set(
        userList.map((s) => s.name.trim().toLowerCase()),
      );
      for (const builtin of builtinList) {
        if (usedIds.has(builtin.id)) continue;
        if (usedNames.has(builtin.name.trim().toLowerCase())) continue;
        combined.push(builtin);
      }
      setExternalSkills(combined);
      if (Array.isArray(savedOrder)) {
        setSkillOrder(savedOrder);
      }
    } catch (e) {
      console.error("Failed to refresh skills:", e);
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

  // Load skills on first mount
  useEffect(() => {
    loadExternalSkills();
  }, [loadExternalSkills]);

  return {
    externalSkills,
    isLoading,
    error,
    refreshExternalSkills,
    openSkillsFolder,
    saveExternalSkill: async (skill: LLMPrompt) => {
      await invoke("save_external_skill", { skill });
    },
    getDefaultSkillContent: async (
      skillId: string,
    ): Promise<LLMPrompt | null> => {
      try {
        const result = await invoke<LLMPrompt | null>(
          "get_default_skill_content",
          {
            skillId,
          },
        );
        return result;
      } catch (e) {
        console.error("Failed to get default skill content:", e);
        return null;
      }
    },
    createSkill: async (skillData: Partial<LLMPrompt>): Promise<LLMPrompt> => {
      // Create a minimal skill object with defaults
      const skill: LLMPrompt = {
        id: "",
        name: skillData.name || "New Skill",
        description: skillData.description || "",
        instructions: skillData.instructions || "",
        model_id: skillData.model_id ?? null,
        icon: skillData.icon ?? null,
        skill_type: skillData.skill_type || "text",
        source: "user",
        confidence_check_enabled: skillData.confidence_check_enabled ?? false,
        confidence_threshold: skillData.confidence_threshold ?? 70,
        output_mode: skillData.output_mode || "polish",
        enabled: skillData.enabled ?? true,
        customized: false,
        locked: false,
      };
      const result = await invoke<LLMPrompt>("create_skill", { skill });
      await loadExternalSkills();
      return result;
    },
    deleteSkill: async (id: string) => {
      await invoke("delete_skill", { id });
      await loadExternalSkills();
    },
    // Template functions
    getSkillTemplates: async (): Promise<SkillTemplate[]> => {
      try {
        const templates = await invoke("get_skill_templates");
        const parsed = SkillTemplatesArraySchema.safeParse(templates);
        if (parsed.success) {
          return parsed.data;
        }
        console.error("Failed to parse skill templates:", parsed.error);
        return [];
      } catch (e) {
        console.error("Failed to get skill templates:", e);
        return [];
      }
    },
    createSkillFromTemplate: async (
      templateId: string,
    ): Promise<LLMPrompt | null> => {
      try {
        const result = await invoke<LLMPrompt>("create_skill_from_template", {
          templateId,
        });
        await loadExternalSkills();
        return result;
      } catch (e) {
        console.error("Failed to create skill from template:", e);
        toast.error("创建技能失败");
        return null;
      }
    },
    skillOrder,
    reorderSkills: async (order: string[]): Promise<void> => {
      try {
        await invoke("reorder_skills", { order });
        setSkillOrder(order);
        // Update local state to reflect new order
        setExternalSkills((prev) => {
          const orderMap = new Map(order.map((id, idx) => [id, idx]));
          return [...prev].sort((a, b) => {
            const posA = orderMap.get(a.id);
            const posB = orderMap.get(b.id);
            if (posA !== undefined && posB !== undefined) return posA - posB;
            if (posA !== undefined) return -1;
            if (posB !== undefined) return 1;
            return a.name.localeCompare(b.name);
          });
        });
      } catch (e) {
        console.error("Failed to reorder skills:", e);
        toast.error("排序失败");
      }
    },
  };
}
