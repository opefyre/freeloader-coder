import { PrefetchPageLinks, useLocation } from "react-router";
import { HomeChatLauncher } from "#/components/features/home/home-chat-launcher";
import { LlmNotConfiguredBanner } from "#/components/features/home/llm-not-configured-banner";
import {
  isOnboardingPreviewActive,
  OnboardingHost,
} from "#/components/features/onboarding";

<PrefetchPageLinks page="/conversations/:conversationId" />;

function HomeScreen() {
  const location = useLocation();
  const isPreview = isOnboardingPreviewActive(location.search);
  const isPipelineStudio =
    import.meta.env.VITE_PIPELINE_STUDIO === "true" ||
    new URLSearchParams(location.search).get("pipeline") === "1";

  return (
    <div
      data-testid="home-screen"
      className="custom-scrollbar-always h-full overflow-y-auto rounded-xl bg-transparent px-4 md:px-0 lg:px-[42px]"
    >
      <div className="md:px-4 lg:px-0">
        <LlmNotConfiguredBanner />
      </div>

      <HomeChatLauncher />

      {!isPipelineStudio && !isPreview ? <OnboardingHost /> : null}
    </div>
  );
}

export default HomeScreen;
