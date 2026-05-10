"use client";

import type { MainTabId } from "@/lib/workspaceSession";

type AppNavProps = {
  active: MainTabId;
  onSelect: (tab: MainTabId) => void;
  /** When a job is in progress, Home shows the pipeline; still allow switching to Company. */
  pipelineBusy?: boolean;
};

export function AppNav({ active, onSelect, pipelineBusy }: AppNavProps) {
  return (
    <nav className="appNav" aria-label="Workspace">
      <div className="appNav__brand">Artifex</div>
      <ul className="appNav__list">
        <li>
          <button
            type="button"
            className={`appNav__tab${active === "home" ? " appNav__tab--active" : ""}`}
            onClick={() => onSelect("home")}
            aria-current={active === "home" ? "page" : undefined}
          >
            <span className="appNav__tabIcon" aria-hidden>
              ◎
            </span>
            <span className="appNav__tabLabel">Home</span>
            {pipelineBusy && active !== "home" ? (
              <span className="appNav__badge" title="Generation in progress">
                Live
              </span>
            ) : null}
          </button>
        </li>
        <li>
          <button
            type="button"
            className={`appNav__tab${active === "company" ? " appNav__tab--active" : ""}`}
            onClick={() => onSelect("company")}
            aria-current={active === "company" ? "page" : undefined}
          >
            <span className="appNav__tabIcon" aria-hidden>
              ⌁
            </span>
            <span className="appNav__tabLabel">Company</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
