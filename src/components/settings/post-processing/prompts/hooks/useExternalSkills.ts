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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadExternalSkills = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Use the new unified command
      const skills = await invoke("get_all_skills");
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
      // Use the new unified command
      const skills = await invoke("get_all_skills");
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
        compliance_check_enabled: skillData.compliance_check_enabled ?? false,
        compliance_threshold: skillData.compliance_threshold ?? 20,
        output_mode: skillData.output_mode || "polish",
        enabled: skillData.enabled ?? true,
        customized: false,
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
    reorderSkills: async (order: string[]): Promise<void> => {
      try {
        await invoke("reorder_skills", { order });
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
