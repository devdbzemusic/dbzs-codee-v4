import type {
  SkillPrecondition,
  SkillPreconditionResult
} from "@/runtime/skill/skillContracts";

export interface SkillPreconditionContext {
  userMessage: string;
  workspaceRoot?: string;
  pathExists?: (workspaceRoot: string, relativePath: string) => Promise<boolean>;
  manualConfirmations?: Record<string, boolean>;
}

export async function evaluateSkillPreconditions(
  preconditions: SkillPrecondition[],
  context: SkillPreconditionContext
): Promise<SkillPreconditionResult[]> {
  const text = context.userMessage.toLowerCase();
  const results: SkillPreconditionResult[] = [];
  for (const condition of preconditions) {
    let passed = false;
    switch (condition.evaluator) {
      case "has_active_workspace":
        passed = Boolean(context.workspaceRoot);
        break;
      case "has_product_idea":
        passed = /\b(idee|idea|produkt|product|mvp|saas|app|service)\b/i.test(text);
        break;
      case "has_feature_request":
        passed = /\b(feature|funktion|implement|build|entwickl|hinzufügen)\b/i.test(text);
        break;
      case "manual_confirmation":
        passed = context.manualConfirmations?.[condition.id] === true;
        break;
      case "workspace_file_exists":
      case "workspace_file_missing": {
        const exists = Boolean(
          context.workspaceRoot &&
          condition.value &&
          context.pathExists &&
          (await context.pathExists(context.workspaceRoot, condition.value))
        );
        passed = condition.evaluator === "workspace_file_exists" ? exists : !exists;
        break;
      }
    }
    results.push({
      preconditionId: condition.id,
      passed,
      message: passed ? condition.description : `Nicht erfüllt: ${condition.description}`,
      checkedAt: new Date().toISOString()
    });
  }
  return results;
}
