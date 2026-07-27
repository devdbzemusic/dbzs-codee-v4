import { useCallback, useState } from "react";

const STORAGE_KEY = "dbzs-job-templates";

export interface JobTemplate {
  id: string;
  name: string;
  task_type: string;
  assigned_agent_role: string;
  priority: number;
  prompt_template: string;
}

function loadFromStorage(): JobTemplate[] {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    return raw ? (JSON.parse(raw) as JobTemplate[]) : [];
  } catch {
    return [];
  }
}

export function useJobTemplates() {
  const [templates, setTemplates] = useState<JobTemplate[]>(loadFromStorage);

  const persist = useCallback((next: JobTemplate[]) => {
    setTemplates(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch { /* storage full or unavailable */ }
  }, []);

  const saveTemplate = useCallback(
    (template: Omit<JobTemplate, "id">) => {
      const id = `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
      persist([...templates, { ...template, id }]);
    },
    [templates, persist],
  );

  const deleteTemplate = useCallback(
    (id: string) => {
      persist(templates.filter((t) => t.id !== id));
    },
    [templates, persist],
  );

  return { templates, saveTemplate, deleteTemplate };
}
