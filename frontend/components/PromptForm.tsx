"use client";

import { ComposioContextBlock } from "@/components/ComposioContextBlock";

type PromptFormProps = {
  value: string;
  company: string;
  documentsText: string;
  loading: boolean;
  samples: string[];
  disabled?: boolean;
  onChange: (value: string) => void;
  onChangeCompany: (value: string) => void;
  onChangeDocumentsText: (value: string) => void;
  onMergeDocumentSections: (sections: string[]) => void;
  onSubmit: () => void;
};

export function PromptForm({
  value,
  company,
  documentsText,
  loading,
  samples,
  disabled,
  onChange,
  onChangeCompany,
  onChangeDocumentsText,
  onMergeDocumentSections,
  onSubmit,
}: PromptFormProps) {
  const blocked = Boolean(disabled) || loading;
  const canSubmit = value.trim().length >= 3 && !blocked;

  return (
    <div className="compose">
      <header className="compose__header">
        <h2 className="compose__title">New prototype</h2>
        <p className="compose__lede">
          Describe the object. We generate brand-aware reference images first; after you approve, we run 3D
          reconstruction.
        </p>
      </header>

      <div className="field">
        <label className="field__label" htmlFor="company">
          Company / brand <span className="field__optional">optional</span>
        </label>
        <input
          id="company"
          className="input"
          placeholder="e.g. Acme Beverages"
          value={company}
          onChange={(event) => onChangeCompany(event.target.value)}
          disabled={blocked}
          autoComplete="organization"
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="prompt">
          Product idea <span className="field__req">required</span>
        </label>
        <textarea
          id="prompt"
          className="textarea textarea--prompt"
          placeholder='Example: "Sugar-free mint tin with matte black finish and embossed logo on the lid."'
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={blocked}
          rows={5}
        />
        <p className="field__hint">Be specific about materials, shape, and any text or logo placement.</p>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="docs">
          Context documents <span className="field__optional">optional</span>
        </label>
        <textarea
          id="docs"
          className="textarea"
          placeholder="Paste excerpts: tone, colors, claims, packaging rules… Separate sections with a blank line."
          value={documentsText}
          onChange={(event) => onChangeDocumentsText(event.target.value)}
          disabled={blocked}
          rows={4}
        />
        <p className="field__hint">Up to 12 sections; blank lines split sections.</p>
        <ComposioContextBlock disabled={blocked} onMergeDocumentSections={onMergeDocumentSections} />
      </div>

      <div className="compose__actions">
        <button type="button" className="button button--primary" onClick={onSubmit} disabled={!canSubmit}>
          {loading ? "Starting…" : "Generate concept art"}
        </button>
      </div>

      {samples.length > 0 ? (
        <div className="samplesBlock">
          <p className="samplesBlock__label">Try an example</p>
          <div className="samples">
            {samples.map((sample) => (
              <button
                key={sample}
                type="button"
                className="sample"
                onClick={() => onChange(sample)}
                disabled={blocked}
              >
                {sample}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
