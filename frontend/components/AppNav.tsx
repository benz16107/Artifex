"use client";

import type { JobPayload } from "@/lib/api";
import { isTerminalJobStatus } from "@/lib/flow";
import { jobPortfolioThumbUrl } from "@/lib/jobPortfolioThumb";
import type { MainTabId } from "@/lib/workspaceSession";

type AppNavProps = {
  active: MainTabId;
  onSelect: (tab: MainTabId) => void;
  /** When a job is in progress, Home shows the pipeline; still allow switching to Company. */
  pipelineBusy?: boolean;
  /** Background + finished runs, newest / live first (same ordering as Home gallery). */
  recentPrototypes: JobPayload[];
  selectedJobId: string | null;
  onOpenRecentPrototype: (job: JobPayload) => void | Promise<void>;
};

export function AppNav({
  active,
  onSelect,
  pipelineBusy,
  recentPrototypes,
  selectedJobId,
  onOpenRecentPrototype,
}: AppNavProps) {
  return (
    <nav className="appNav" aria-label="Workspace">
      <div className="appNav__brand">Artifex</div>
      {recentPrototypes.length > 0 ? (
        <section className="appNav__recent" aria-labelledby="app-nav-recent-heading">
          <h2 id="app-nav-recent-heading" className="appNav__recentHeading">
            Recent prototypes
          </h2>
          <ul className="appNav__recentList">
            {recentPrototypes.map((proto) => {
              const thumb = jobPortfolioThumbUrl(proto);
              const idea = proto.prompt.trim() || "Untitled idea";
              const live = !isTerminalJobStatus(proto.status);
              const isActive = active !== "home" && selectedJobId === proto.job_id;
              return (
                <li key={proto.job_id}>
                  <button
                    type="button"
                    className={`appNav__recentBtn${isActive ? " appNav__recentBtn--active" : ""}`}
                    onClick={() => void onOpenRecentPrototype(proto)}
                    title={proto.prompt.trim() ? proto.prompt : undefined}
                  >
                    <span
                      className={`appNav__recentThumbWrap${thumb ? "" : " appNav__recentThumbWrap--placeholder"}`}
                      aria-hidden
                    >
                      {thumb ? (
                        <img className="appNav__recentThumb" src={thumb} alt="" width={36} height={36} loading="lazy" />
                      ) : null}
                    </span>
                    <span className="appNav__recentMeta">
                      <span className="appNav__recentTitle">{idea}</span>
                      {live ? <span className="appNav__recentLive">In progress</span> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
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
