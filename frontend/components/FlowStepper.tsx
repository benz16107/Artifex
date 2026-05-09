"use client";

export type FlowStepId = "describe" | "references" | "mesh" | "export";

type StepDef = { id: FlowStepId; label: string; short: string };

const STEPS: StepDef[] = [
  { id: "describe", label: "Describe", short: "1" },
  { id: "references", label: "Concept art", short: "2" },
  { id: "mesh", label: "3D build", short: "3" },
  { id: "export", label: "Export", short: "4" },
];

type FlowStepperProps = {
  active: FlowStepId;
  failed?: boolean;
};

export function FlowStepper({ active, failed }: FlowStepperProps) {
  const activeIndex = STEPS.findIndex((s) => s.id === active);

  return (
    <nav className="flowStepper" aria-label="Progress">
      <ol className="flowStepper__list">
        {STEPS.map((step, index) => {
          const done = index < activeIndex;
          const current = index === activeIndex;
          const stateClass = failed && current ? "is-error" : current ? "is-current" : done ? "is-done" : "";
          return (
            <li
              key={step.id}
              className={`flowStepper__item ${stateClass}`}
              aria-current={current ? "step" : undefined}
            >
              <span className="flowStepper__dot" aria-hidden>
                {done ? "✓" : step.short}
              </span>
              <span className="flowStepper__label">{step.label}</span>
              {index < STEPS.length - 1 ? <span className="flowStepper__connector" aria-hidden /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
