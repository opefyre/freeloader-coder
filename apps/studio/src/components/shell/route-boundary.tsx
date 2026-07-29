import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { House } from "@phosphor-icons/react/House";
import { Warning } from "@phosphor-icons/react/Warning";
import { Component, type ErrorInfo, type ReactNode } from "react";

import type { StudioView } from "../../routing.js";
import { Button } from "../ui/button.js";

type Props = {
  children: ReactNode;
  route: StudioView;
  navigate: (view: StudioView) => void;
  recover: () => void;
};

type State = {
  failed: boolean;
  recoveryKey: number;
};

export class RouteBoundary extends Component<Props, State> {
  override state: State = { failed: false, recoveryKey: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo) {
    // The local demo intentionally does not emit stack traces or source paths.
  }

  override componentDidUpdate(previous: Props) {
    if (previous.route !== this.props.route && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  private retry = () => {
    this.props.recover();
    this.setState((state) => ({
      failed: false,
      recoveryKey: state.recoveryKey + 1,
    }));
  };

  private returnToOverview = () => {
    this.props.recover();
    this.props.navigate("overview");
  };

  override render() {
    if (this.state.failed) {
      return (
        <section
          role="alert"
          aria-labelledby="workspace-recovery-title"
          className="grid min-h-[28rem] place-items-center rounded-[2rem] bg-card p-6 text-center"
        >
          <div className="max-w-md">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-amber-400/12 text-amber-700 dark:text-amber-300">
              <Warning size={28} weight="fill" />
            </span>
            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              Workspace contained
            </p>
            <h2 id="workspace-recovery-title" className="mt-2 text-2xl font-semibold">
              This workspace could not render
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              The surrounding Studio remains safe. No task, provider, repository,
              or external service was changed.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Button onClick={this.retry}>
                <ArrowClockwise />
                Retry workspace
              </Button>
              <Button variant="secondary" onClick={this.returnToOverview}>
                <House />
                Return to overview
              </Button>
            </div>
          </div>
        </section>
      );
    }

    return <div key={this.state.recoveryKey}>{this.props.children}</div>;
  }
}

export function WorkspaceLoading() {
  return (
    <section
      className="grid min-h-[28rem] place-items-center rounded-[2rem] bg-card p-6"
      role="status"
      aria-live="polite"
      aria-label="Loading workspace"
    >
      <div className="text-center">
        <span className="mx-auto block size-10 animate-pulse rounded-2xl bg-primary/15 motion-reduce:animate-none" />
        <strong className="mt-4 block text-sm">Preparing this workspace</strong>
        <span className="mt-1 block text-xs text-muted-foreground">
          The shell and your current route remain available.
        </span>
      </div>
    </section>
  );
}

export function SyntheticRouteFailure({ active }: { active: boolean }) {
  if (active) {
    throw new Error("Synthetic route failure.");
  }
  return null;
}
