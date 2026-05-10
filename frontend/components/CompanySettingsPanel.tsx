"use client";

import type { RefObject } from "react";

import { ComposioContextBlock } from "@/components/ComposioContextBlock";
import { ReferenceFilesBlock, type ReferenceFilesHandle } from "@/components/ReferenceFilesBlock";

type CompanySettingsPanelProps = {
  company: string;
  companyContextText: string;
  pipelineBusy?: boolean;
  onChangeCompany: (value: string) => void;
  onChangeCompanyContextText: (value: string) => void;
  onMergeCompanyDocumentSections: (sections: string[]) => void;
  brandingFilesRef?: RefObject<ReferenceFilesHandle | null>;
};

export function CompanySettingsPanel({
  company,
  companyContextText,
  pipelineBusy,
  onChangeCompany,
  onChangeCompanyContextText,
  onMergeCompanyDocumentSections,
  brandingFilesRef,
}: CompanySettingsPanelProps) {
  return (
    <div className="companyPanel">
      {pipelineBusy ? (
        <div className="companyPanel__notice" role="status">
          A generation is running. Switch to <strong>Home</strong> to follow concept art and the 3D preview.
        </div>
      ) : null}
      <header className="companyPanel__header">
        <h1 className="companyPanel__title">Company</h1>
        <p className="companyPanel__lede">
          Project-wide settings: organization name, connected sources via Composio, and branding documents that apply
          to every model you generate.
        </p>
      </header>

      <section className="panel companyPanel__section">
        <h2 className="panel__h">Company name</h2>
        <p className="panel__muted">Used across generations for brand-aware concepts and specs.</p>
        <div className="field field--flushBottom">
          <label className="field__label" htmlFor="company-settings-name">
            Display name
          </label>
          <input
            id="company-settings-name"
            className="input"
            placeholder="e.g. Acme Beverages"
            value={company}
            onChange={(e) => onChangeCompany(e.target.value)}
            autoComplete="organization"
          />
        </div>
      </section>

      <section className="panel companyPanel__section">
        <h2 className="panel__h">Connected context (Composio)</h2>
        <p className="panel__muted">Link Google Drive, Notion, or other toolkits and pull text into your company context.</p>
        <ComposioContextBlock disabled={false} onMergeDocumentSections={onMergeCompanyDocumentSections} />
      </section>

      <section className="panel companyPanel__section">
        <h2 className="panel__h">Branding &amp; guides</h2>
        <p className="panel__muted">
          Paste tone, colors, logo rules, or upload PDFs and images. Content is merged into company context (separate
          from each model&apos;s optional context on Home).
        </p>
        <div className="field">
          <label className="field__label" htmlFor="company-context-docs">
            Company context <span className="field__optional">optional</span>
          </label>
          <textarea
            id="company-context-docs"
            className="textarea"
            placeholder="Brand voice, palette hex codes, packaging constraints… Separate sections with a blank line."
            value={companyContextText}
            onChange={(e) => onChangeCompanyContextText(e.target.value)}
            rows={5}
          />
          <p className="field__hint">Up to 12 sections; blank lines split sections.</p>
        </div>
        <div className="field field--flushBottom">
          <ReferenceFilesBlock
            ref={brandingFilesRef}
            disabled={false}
            onMergeDocumentSections={onMergeCompanyDocumentSections}
          />
        </div>
      </section>
    </div>
  );
}
