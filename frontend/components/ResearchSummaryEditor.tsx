"use client";

import { useEffect, useId, useMemo, useRef } from "react";

import type { ResearchBrief, ResearchBriefField } from "@/lib/api";
import { RESEARCH_BRIEF_SECTIONS } from "@/lib/researchSummary";

type ResearchSummaryEditorProps = {
  brief: ResearchBrief;
  onChange: (next: ResearchBrief) => void;
  disabled?: boolean;
  /** Smaller card density — used inside the Home portfolio preview where vertical space is tight. */
  compact?: boolean;
  /** Optional eyebrow shown above the cards. */
  eyebrow?: string;
};

const SECTION_ICONS: Record<ResearchBriefField, string> = {
  brand_snapshot: "01",
  visual_packaging_cues: "02",
  category_competitive_notes: "03",
  financial_snapshot: "04",
  corporate_strategy: "05",
};

export function ResearchSummaryEditor({
  brief,
  onChange,
  disabled = false,
  compact = false,
  eyebrow,
}: ResearchSummaryEditorProps) {
  const baseId = useId();

  const handleField = (key: ResearchBriefField) => (value: string) => {
    onChange({ ...brief, [key]: value });
  };

  const filledCount = useMemo(
    () => RESEARCH_BRIEF_SECTIONS.filter((s) => (brief[s.key] ?? "").trim().length > 0).length,
    [brief],
  );

  return (
    <div
      className={`researchEditor${compact ? " researchEditor--compact" : ""}`}
      role="group"
      aria-label="Research summary"
    >
      <header className="researchEditor__header">
        <div className="researchEditor__eyebrowRow">
          {eyebrow ? <span className="researchEditor__eyebrow">{eyebrow}</span> : null}
          <span className="researchEditor__progress" aria-live="polite">
            {filledCount}/{RESEARCH_BRIEF_SECTIONS.length} sections drafted
          </span>
        </div>
        <p className="researchEditor__lead">
          Each section feeds the image model. Edit anything that looks off — financial signals and corporate
          strategy will shape the product&rsquo;s archetype, materials, and visual tone.
        </p>
      </header>
      <ol className="researchEditor__cards">
        {RESEARCH_BRIEF_SECTIONS.map((section) => {
          const value = brief[section.key] ?? "";
          const filled = value.trim().length > 0;
          const fieldId = `${baseId}-${section.key}`;
          return (
            <li
              key={section.key}
              className={`researchEditor__card${filled ? " is-filled" : " is-empty"}`}
            >
              <div className="researchEditor__cardHead">
                <span className="researchEditor__cardIndex" aria-hidden>
                  {SECTION_ICONS[section.key]}
                </span>
                <div className="researchEditor__cardHeading">
                  <label htmlFor={fieldId} className="researchEditor__cardTitle">
                    {section.label}
                  </label>
                  <p className="researchEditor__cardDesc">{section.description}</p>
                </div>
              </div>
              <AutoSizingTextarea
                id={fieldId}
                className="researchEditor__cardInput"
                value={value}
                onChange={(v) => handleField(section.key)(v)}
                placeholder={section.placeholder}
                disabled={disabled}
                spellCheck
                maxLength={4000}
                rows={compact ? 3 : 4}
              />
            </li>
          );
        })}
      </ol>
    </div>
  );
}

type AutoSizingTextareaProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  rows?: number;
  maxLength?: number;
  disabled?: boolean;
  spellCheck?: boolean;
};

function AutoSizingTextarea({
  id,
  value,
  onChange,
  placeholder,
  className,
  rows = 3,
  maxLength,
  disabled,
  spellCheck,
}: AutoSizingTextareaProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.style.height = "auto";
    const next = Math.min(node.scrollHeight, 480);
    node.style.height = `${next}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      id={id}
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      maxLength={maxLength}
      disabled={disabled}
      spellCheck={spellCheck}
    />
  );
}
