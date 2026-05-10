"use client";

export type FlowStepId = "references" | "mesh" | "export" | "production" | "supplier";

type StepDef = { id: FlowStepId; label: string; short: string };

const STEPS: StepDef[] = [
  { id: "references", label: "Concept art", short: "1" },
  { id: "mesh", label: "3D build", short: "2" },
  { id: "export", label: "Export", short: "3" },
  { id: "production", label: "Production", short: "4" },
  { id: "supplier", label: "Suppliers", short: "5" },
];

type FlowStepperProps = {
  active: FlowStepId;
  failed?: boolean;
  /** Jump to a stage (replaces per-step Back). */
  onSelectStep?: (step: FlowStepId) => void;
  /** Steps not yet reached on an in-progress run (future steps). */
  isStepLocked?: (step: FlowStepId) => boolean;
  /** Disable all step controls (e.g. while a request is in flight). */
  selectDisabled?: boolean;
};

export function FlowStepper({ active, failed, onSelectStep, isStepLocked, selectDisabled }: FlowStepperProps) {
  const activeIndex = STEPS.findIndex((s) => s.id === active);

  return (
    <div className="flowStepperWrap">
      <nav className="flowStepper" aria-label="Progress">
        <ol className="flowStepper__list">
          {STEPS.map((step, index) => {
            const done = index < activeIndex;
            const current = index === activeIndex;
            const stateClass = failed && current ? "is-error" : current ? "is-current" : done ? "is-done" : "";
            const locked = Boolean(isStepLocked?.(step.id));
            const disabled = Boolean(selectDisabled || locked || !onSelectStep);
            return (
              <li
                key={step.id}
                className={`flowStepper__item ${stateClass}`}
                aria-current={current ? "step" : undefined}
              >
                <div className="flowStepper__itemMain">
                  <span className="flowStepper__dot" aria-hidden>
                    {done ? "✓" : step.short}
                  </span>
                  <div className="flowStepper__itemCol">
                    <button
                      type="button"
                      className="flowStepper__stepBtn"
                      disabled={disabled}
                      onClick={() => onSelectStep?.(step.id)}
                      aria-label={`Open ${step.label} stage`}
                    >
                      {step.label}
                    </button>
                  </div>
                </div>
                {index < STEPS.length - 1 ? <span className="flowStepper__connector" aria-hidden /> : null}
              </li>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}
