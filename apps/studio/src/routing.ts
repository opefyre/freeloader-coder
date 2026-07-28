export const studioViews = [
  "overview",
  "projects",
  "conversation",
  "work",
  "providers",
  "integrations",
  "evidence",
  "help",
  "releases",
  "trust",
  "settings"
] as const;

export type StudioView = (typeof studioViews)[number];

const routes: Record<StudioView, string> = {
  overview: "/",
  projects: "/projects",
  conversation: "/conversation",
  work: "/work",
  providers: "/providers",
  integrations: "/integrations",
  evidence: "/evidence",
  help: "/help",
  releases: "/releases",
  trust: "/trust",
  settings: "/settings"
};

export function routeForView(view: StudioView): string {
  return routes[view];
}

export function viewFromLocation(location: {
  readonly pathname: string;
  readonly search: string;
}): StudioView {
  const pathname = normalizePath(location.pathname);
  const legacyView = new URLSearchParams(location.search).get("view");
  if (
    pathname === "/" &&
    studioViews.includes(legacyView as StudioView)
  ) {
    return legacyView as StudioView;
  }

  const route = studioViews.find((view) => routes[view] === pathname);
  if (route) return route;

  return "overview";
}

export function canonicalStudioUrl(url: URL, view: StudioView): URL {
  const canonical = new URL(url);
  canonical.pathname = routeForView(view);
  canonical.searchParams.delete("view");
  return canonical;
}

function normalizePath(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  const normalized = pathname.replace(/\/+$/, "");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}
