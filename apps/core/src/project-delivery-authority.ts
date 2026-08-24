import type { DeliveryPlanContent, DeliveryPlanDraft } from "../../../packages/orchestration/src/delivery-plan.js";

type DeliveryItem = DeliveryPlanContent["items"][number];

const OWNER_FACING_TITLE = /\b(ui|ux|frontend|visual|responsive|component|page|screen|owner experience|user experience)\b/i;
const OWNER_FACING_FILE = /(^|\/)(?:app\/)?(?:pages?|screens?|components?|ui)(\/|$)|(^|\/)index\.html$|\.(?:html|css|tsx|jsx)$/i;

export function isOwnerFacingUiDeliveryItem(item: Pick<DeliveryItem, "title" | "allowedFiles">) {
  return OWNER_FACING_TITLE.test(item.title) || item.allowedFiles.some((path) => OWNER_FACING_FILE.test(path));
}

export function assertOwnerFacingUiDeliveryValidation(plan: Pick<DeliveryPlanContent | DeliveryPlanDraft, "items">) {
  for (const item of plan.items) {
    if (item.type !== "subtask" || !isOwnerFacingUiDeliveryItem(item)) continue;
    if (!item.validationProfiles.includes("build") || !item.validationProfiles.includes("visual")) throw new Error(`${item.id} changes the owner-facing experience but lacks build and visual journey validation.`);
  }
}
